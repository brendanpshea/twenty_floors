import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
} from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import type { FloorPlan } from '../core/types';
import { CellKind } from '../core/types';
import { Bake } from './bake';
import type { Fow } from './fow';
import type { ThemeLook } from './themeLooks';
import { CELL, STEP, clamp, hash2 } from './util';

export const WALL_HEIGHT = 1.6;
/** Warrens walls are lower and flatter so tunnels stay readable. */
const WALL_HEIGHT_ROUGH = 1.15;
const WATER_DEPTH = 0.45;
const CHUNK = 16;
const CLIFF_DROP = 14;
const INSET = 0.07;

export interface FloorBuild {
  group: Group;
  /** Meshes that make up the opaque static floor (toggle shadows on these). */
  solids: Mesh[];
  floorMaterial: MeshLambertMaterial;
  /** Where creatures stand per cell (NaN where not standable). */
  groundY: Float32Array;
  /** Height of the pickable surface per cell (NaN where none). */
  topH: Float32Array;
  bake: Bake;
  /** Base (floor-level) height of each wall cell, NaN elsewhere. For picking under occlusion. */
  wallBase: Float32Array;
  dispose(): void;
}

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  cell: number[] = [];
  /** Wall base height for the occlusion shader, -999 for non-wall vertices. */
  wb: number[] = [];
}

type V = Float32Array; // x, y, z, r, g, b
type Pt3 = [number, number, number];
type Band = [number, number, number, number];

const rgbOf = (hex: number): number[] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const mix3 = (a: number[], b: number[], t: number): number[] => [
  a[0]! + (b[0]! - a[0]!) * t,
  a[1]! + (b[1]! - a[1]!) * t,
  a[2]! + (b[2]! - a[2]!) * t,
];
const scale3 = (a: number[], k: number): number[] => [a[0]! * k, a[1]! * k, a[2]! * k];

const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const BANDS_WALL: Record<string, Band[]> = {
  dressed: [
    [0, 0.14, 1.18, 1.1],
    [0.14, 0.55, 0.82, 0.8],
    [0.55, 1, 0.94, 0.6],
  ],
  rough: [
    [0, 0.5, 1.0, 0.86],
    [0.5, 1, 0.82, 0.55],
  ],
  jagged: [
    [0, 0.4, 0.95, 0.75],
    [0.4, 1, 0.72, 0.42],
  ],
};
const BANDS_CLIFF: Band[] = [
  [0, 0.18, 0.85, 0.4],
  [0.18, 0.5, 0.4, 0.12],
  [0.5, 1, 0.12, 0],
];
const BANDS_RISER: Band[] = [[0, 1, 0.95, 0.7]];

const LAVA_FRAG_HEAD = `#include <common>
uniform float uTime;
uniform vec3 uLavaHot;
uniform vec3 uLavaCrust;
varying vec2 vLavaP;
float lvH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lvN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lvH(i), lvH(i + vec2(1.0, 0.0)), f.x), mix(lvH(i + vec2(0.0, 1.0)), lvH(i + vec2(1.0, 1.0)), f.x), f.y);
}
float lvF(vec2 p) { return lvN(p) * 0.55 + lvN(p * 2.1 + 5.3) * 0.3 + lvN(p * 4.3 + 11.7) * 0.15; }`;
const LAVA_FRAG_BODY = `{
  vec2 q = vLavaP * 0.5 + vec2(uTime * 0.05, uTime * 0.018);
  vec2 w = vec2(lvF(q + uTime * 0.03), lvF(q.yx + 7.7 - uTime * 0.025));
  float n = lvF(q * 1.3 + w * 1.6);
  float crust = smoothstep(0.47, 0.58, n);
  float edge = smoothstep(0.0, 0.08, abs(n - 0.5));
  float pulse = 0.9 + 0.1 * sin(uTime * 0.9 + vLavaP.x * 0.6 + vLavaP.y * 0.8);
  vec3 hot = mix(uLavaHot, vec3(1.0, 0.62, 0.16), smoothstep(0.2, 0.0, n));
  vec3 lv = hot * (0.72 * pulse);
  lv += vec3(0.5, 0.25, 0.04) * (1.0 - edge) * (1.0 - crust);
  lv = mix(lv, uLavaCrust, crust * (0.7 + 0.3 * edge));
  diffuseColor.rgb *= lv;
}`;

export function buildFloor(plan: FloorPlan, look: ThemeLook, fow: Fow): FloorBuild {
  const W = plan.width;
  const H = plan.height;
  const { kinds, elevation } = plan;
  const bake = new Bake(plan, look);
  const S = new Float32Array(3);

  const kindAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= W || y >= H ? CellKind.Void : kinds[y * W + x]!;
  const isWalkKind = (k: number): boolean => k === CellKind.Floor || k === CellKind.Door || k === CellKind.Water;
  const elevAt = (x: number, y: number): number => elevation[y * W + x]! * STEP;

  /** Standing surface height of a walkable cell (water bed for water). */
  const surface = (x: number, y: number): number => {
    const e = elevAt(x, y);
    return kindAt(x, y) === CellKind.Water ? e - WATER_DEPTH : e;
  };

  const style = look.wallStyle;
  const wallH = style === 'rough' ? WALL_HEIGHT_ROUGH : WALL_HEIGHT;
  const cornerDY = (cx: number, cy: number): number => {
    if (style === 'rough') return (hash2(cx, cy, 7) - 0.5) * 0.12;
    if (style === 'jagged') return Math.pow(hash2(cx, cy, 9), 2.2) * 0.85 - 0.12;
    return 0;
  };
  const cornerDXZ = (cx: number, cy: number, axis: number): number => {
    if (style === 'rough') return (hash2(cx, cy, 11 + axis) - 0.5) * 0.3;
    if (style === 'jagged') return (hash2(cx, cy, 13 + axis) - 0.5) * 0.26;
    return 0;
  };

  // Highest walkable elevation near each cell (box of radius REF_R), -Infinity if none.
  const REF_R = 4;
  const refMax = new Float32Array(W * H).fill(-Infinity);
  {
    const tmp = new Float32Array(W * H).fill(-Infinity);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let m = -Infinity;
        for (let xx = Math.max(0, x - REF_R); xx <= Math.min(W - 1, x + REF_R); xx++) {
          if (isWalkKind(kinds[y * W + xx]!)) m = Math.max(m, elevAt(xx, y));
        }
        tmp[y * W + x] = m;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let m = -Infinity;
        for (let yy = Math.max(0, y - REF_R); yy <= Math.min(H - 1, y + REF_R); yy++) m = Math.max(m, tmp[yy * W + x]!);
        refMax[y * W + x] = m;
      }
    }
  }
  const wallTops = new Float32Array(W * H).fill(NaN);
  const wallBase = new Float32Array(W * H).fill(NaN);
  const wallTop = (x: number, y: number): number => {
    const i = y * W + x;
    let v = wallTops[i]!;
    if (v === v) return v;
    let m = elevAt(x, y);
    let walk = false;
    let chasm = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = kindAt(nx, ny);
        if (isWalkKind(nk)) {
          m = Math.max(m, elevAt(nx, ny));
          walk = true;
        } else if (nk === CellKind.Chasm) chasm = true;
      }
    }
    const varAmt = style === 'rough' ? 0.18 : style === 'jagged' ? 0.55 : 0.06;
    let extra = 0;
    if (!walk && chasm) {
      // Far cavern wall: rise with the nearby platforms so it reads as a vast wall.
      const r = refMax[i]!;
      if (r > m) m = r;
      extra = 0.8 + hash2(x, y, 17) * 1.2;
    }
    wallBase[i] = m;
    v = m + wallH + extra + (hash2(x, y, 5) - 0.5) * varAmt;
    wallTops[i] = v;
    return v;
  };

  const groundY = new Float32Array(W * H).fill(NaN);
  const topH = new Float32Array(W * H).fill(NaN);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = kindAt(x, y);
      const i = y * W + x;
      if (k === CellKind.Floor || k === CellKind.Door) {
        groundY[i] = elevAt(x, y) + 0.04;
        topH[i] = elevAt(x, y) + 0.04;
      } else if (k === CellKind.Water) {
        groundY[i] = elevAt(x, y) - WATER_DEPTH * 0.7;
        topH[i] = elevAt(x, y) - 0.2;
      } else if (k === CellKind.Wall) {
        topH[i] = wallTop(x, y);
      }
    }
  }

  // ---- emit helpers ------------------------------------------------------
  const va: V = new Float32Array(6);
  const vb: V = new Float32Array(6);
  const vc: V = new Float32Array(6);
  const vd: V = new Float32Array(6);

  const setV = (v: V, x: number, y: number, z: number, alb: number[], shade: number): void => {
    bake.sample(x, z, S);
    v[0] = x;
    v[1] = y;
    v[2] = z;
    v[3] = alb[0]! * S[0]! * shade;
    v[4] = alb[1]! * S[1]! * shade;
    v[5] = alb[2]! * S[2]! * shade;
  };

  let curBase = -999;
  const tri = (buf: Buf, a: V, b: V, c: V, cell: number, hx: number, hy: number, hz: number): void => {
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const uz = b[2]! - a[2]!;
    const wx = c[0]! - a[0]!;
    const wy = c[1]! - a[1]!;
    const wz = c[2]! - a[2]!;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len;
    ny /= len;
    nz /= len;
    let p = b;
    let q = c;
    if (nx * hx + ny * hy + nz * hz < 0) {
      p = c;
      q = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, p, q]) {
      buf.pos.push(v[0]!, v[1]!, v[2]!);
      buf.nor.push(nx, ny, nz);
      buf.col.push(v[3]!, v[4]!, v[5]!);
      buf.cell.push(cell);
      buf.wb.push(curBase);
    }
  };
  const quad = (buf: Buf, a: V, b: V, c: V, d: V, cell: number, hx: number, hy: number, hz: number): void => {
    tri(buf, a, b, c, cell, hx, hy, hz);
    tri(buf, a, c, d, cell, hx, hy, hz);
  };

  /** A vertical face between top points A, B and bottom y values, split into shaded bands. */
  const side = (
    buf: Buf,
    cell: number,
    pa: Pt3,
    pb: Pt3,
    ga: [number, number],
    gb: [number, number],
    botA: number,
    botB: number,
    bands: Band[],
    alb: number[],
    nx: number,
    nz: number,
    jitter: number,
  ): void => {
    for (let bi = 0; bi < bands.length; bi++) {
      const [t0, t1, s0, s1] = bands[bi]!;
      const j = 1 + (hash2(cell, bi, 21) - 0.5) * jitter;
      const put = (t: number, end: 0 | 1, v: V, shade: number): void => {
        const p = end ? pb : pa;
        const g = end ? gb : ga;
        const bot = end ? botB : botA;
        setV(v, p[0] + (g[0] - p[0]) * t, p[1] + (bot - p[1]) * t, p[2] + (g[1] - p[2]) * t, alb, shade * j);
      };
      put(t0, 0, va, s0);
      put(t0, 1, vb, s0);
      put(t1, 1, vc, s1);
      put(t1, 0, vd, s1);
      quad(buf, va, vb, vc, vd, cell, nx, 0, nz);
    }
  };

  /** Brightness by depth below the fade reference; cliffs fade to a black void. */
  const FADE_D = [0, 2.5, 6, 11, 18];
  const FADE_S = [0.9, 0.42, 0.16, 0.05, 0];
  const fadeAt = (d: number): number => {
    if (d <= 0) return FADE_S[0]!;
    for (let i = 1; i < FADE_D.length; i++) {
      if (d <= FADE_D[i]!) {
        const t = (d - FADE_D[i - 1]!) / (FADE_D[i]! - FADE_D[i - 1]!);
        return FADE_S[i - 1]! + (FADE_S[i]! - FADE_S[i - 1]!) * t;
      }
    }
    return 0;
  };
  // Lava themes: the chasm is a river of slag a short way below the lowest floor.
  const lava = look.lava;
  let lavaY = -Infinity;
  if (lava) {
    let low = 0;
    for (let i = 0; i < W * H; i++) {
      if (isWalkKind(kinds[i]!)) low = Math.min(low, surface(i % W, (i / W) | 0));
    }
    lavaY = low - lava.depth;
  }
  const lavaTint = rgbOf(lava ? lava.color : 0);

  /** A cliff/void-facing face from the top edge down to botY, fading by depth below fadeTop. */
  const fadeFace = (
    buf: Buf,
    cell: number,
    pa: Pt3,
    pb: Pt3,
    ga: [number, number],
    gb: [number, number],
    botY: number,
    fadeTop: number,
    alb: number[],
    nx: number,
    nz: number,
  ): void => {
    if (lava) botY = Math.max(botY, lavaY);
    const yTop = Math.max(pa[1], pb[1]);
    const ys: number[] = [yTop];
    for (const d of FADE_D) {
      const y = fadeTop - d;
      if (y < yTop - 0.01 && y > botY + 0.01) ys.push(y);
    }
    ys.push(botY);
    for (let k = 0; k + 1 < ys.length; k++) {
      const y0 = ys[k]!;
      const y1 = ys[k + 1]!;
      const rowPt = (end: 0 | 1, y: number, first: boolean, v: V): void => {
        const p = end ? pb : pa;
        const g = end ? gb : ga;
        const yy = first ? (end ? pb[1] : pa[1]) : y;
        const t = (p[1] - yy) / Math.max(0.001, p[1] - botY);
        let sh = fadeAt(fadeTop - yy);
        let col = alb;
        if (lava) {
          // Lit from below: the rock near the molten surface picks up its glow.
          const lt = clamp(1 - (yy - lavaY) / 2.6, 0, 1);
          const k = lt * lt * 0.85;
          col = mix3(alb, lavaTint, k);
          sh = Math.max(sh, k * 0.9);
        }
        setV(v, p[0] + (g[0] - p[0]) * t, yy, p[2] + (g[1] - p[2]) * t, col, sh);
      };
      rowPt(0, y0, k === 0, va);
      rowPt(1, y0, k === 0, vb);
      rowPt(1, y1, false, vc);
      rowPt(0, y1, false, vd);
      quad(buf, va, vb, vc, vd, cell, nx, 0, nz);
    }
  };

  const box = (
    buf: Buf,
    cell: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    alb: number[],
  ): void => {
    setV(va, x0, y1, z0, alb, 1.1);
    setV(vb, x1, y1, z0, alb, 1.1);
    setV(vc, x1, y1, z1, alb, 1.1);
    setV(vd, x0, y1, z1, alb, 1.1);
    quad(buf, va, vb, vc, vd, cell, 0, 1, 0);
    const faces: [number, number, number, number, number, number, number][] = [
      [x0, z0, x1, z0, 0, -1, 0.9],
      [x1, z0, x1, z1, 1, 0, 0.8],
      [x1, z1, x0, z1, 0, 1, 0.95],
      [x0, z1, x0, z0, -1, 0, 0.75],
    ];
    for (const [ax, az, bx, bz, nx, nz, sh] of faces) {
      setV(va, ax, y1, az, alb, sh);
      setV(vb, bx, y1, bz, alb, sh);
      setV(vc, bx, y0, bz, alb, sh * 0.7);
      setV(vd, ax, y0, az, alb, sh * 0.7);
      quad(buf, va, vb, vc, vd, cell, nx, 0, nz);
    }
  };

  // ---- palette -----------------------------------------------------------
  const fA = rgbOf(look.floorA);
  const fB = rgbOf(look.floorB);
  const wA = rgbOf(look.wall);
  const wB = rgbOf(look.wall2);
  const capC = rgbOf(look.cap);
  const woodC = rgbOf(look.prop.wood);
  const bedC = rgbOf(look.waterBed);
  const waterC = rgbOf(look.water);
  const glowC = rgbOf(look.chasmGlow);
  const stoneC = rgbOf(look.prop.stone);
  const stoneDark = rgbOf(look.prop.stoneDark);
  const stoneGrey = rgbOf(0x8d8678);
  const carpetC = rgbOf(0x5a2e34);
  const bridgeWood = rgbOf(0x9a7448);
  const vnoise = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi2 = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi2;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi2, 91);
    const b = hash2(xi + 1, yi2, 91);
    const c = hash2(xi, yi2 + 1, 91);
    const d = hash2(xi + 1, yi2 + 1, 91);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };

  // ---- main pass ---------------------------------------------------------
  const chunks = new Map<number, Buf>();
  const cw = Math.ceil(W / CHUNK);
  const chunkOf = (x: number, y: number): Buf => {
    const key = Math.floor(y / CHUNK) * cw + Math.floor(x / CHUNK);
    let b = chunks.get(key);
    if (!b) {
      b = new Buf();
      chunks.set(key, b);
    }
    return b;
  };
  const waterBuf = new Buf();
  const glowBuf = new Buf();
  const lavaBuf = new Buf();
  let minElev = 0;
  const chasmCells: number[] = [];

  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const idx = cy * W + cx;
      const k = kinds[idx]!;
      const x0 = cx * CELL;
      const z0 = cy * CELL;
      const x1 = x0 + CELL;
      const z1 = z0 + CELL;
      if (k === CellKind.Void) continue;
      if (k === CellKind.Chasm) {
        chasmCells.push(idx);
        continue;
      }

      const buf = chunkOf(cx, cy);

      if (k === CellKind.Wall) {
        const top = wallTop(cx, cy);
        curBase = wallBase[idx]!;
        const alb = mix3(wA, wB, hash2(cx, cy, 2));
        const corner = (i: number, j: number): Pt3 => [
          i * CELL + cornerDXZ(i, j, 0),
          top + cornerDY(i, j),
          j * CELL + cornerDXZ(i, j, 1),
        ];
        const c00 = corner(cx, cy);
        const c10 = corner(cx + 1, cy);
        const c11 = corner(cx + 1, cy + 1);
        const c01 = corner(cx, cy + 1);
        const capAlb = scale3(capC, 1 + 0.5 * hash2(cx, cy, 4));
        setV(va, c00[0], c00[1], c00[2], capAlb, 0.9);
        setV(vb, c10[0], c10[1], c10[2], capAlb, 0.9);
        setV(vc, c11[0], c11[1], c11[2], capAlb, 0.9);
        setV(vd, c01[0], c01[1], c01[2], capAlb, 0.9);
        quad(buf, va, vb, vc, vd, idx, 0, 1, 0);
        const edges: [Pt3, Pt3, [number, number], [number, number]][] = [
          [c00, c10, [x0, z0], [x1, z0]],
          [c10, c11, [x1, z0], [x1, z1]],
          [c11, c01, [x1, z1], [x0, z1]],
          [c01, c00, [x0, z1], [x0, z0]],
        ];
        for (let d = 0; d < 4; d++) {
          const nx = cx + DIRS[d]![0];
          const ny = cy + DIRS[d]![1];
          const nk = kindAt(nx, ny);
          const [pa, pb, ga, gb] = edges[d]!;
          let bands: Band[] | null = null;
          let botA = 0;
          let botB = 0;
          let gA = ga;
          let gB = gb;
          if (isWalkKind(nk)) {
            bands = BANDS_WALL[style]!;
            botA = botB = surface(nx, ny);
          } else if (nk === CellKind.Chasm) {
            const ref = refMax[idx]!;
            const fadeTop = (ref > -1e9 ? Math.max(ref, 0) : 0) + wallH;
            fadeFace(buf, idx, pa, pb, ga, gb, Math.min(0, elevAt(cx, cy)) - CLIFF_DROP, fadeTop, alb, DIRS[d]![0], DIRS[d]![1]);
            continue;
          } else if (nk === CellKind.Wall) {
            const nt = wallTop(nx, ny);
            if (top - nt > 0.01) {
              bands = BANDS_WALL[style]!;
              // Vertical step continuous with the neighbour's jittered cap.
              botA = nt + (pa[1] - top);
              botB = nt + (pb[1] - top);
              gA = [pa[0], pa[2]];
              gB = [pb[0], pb[2]];
            }
          }
          if (!bands) continue;
          side(buf, idx, pa, pb, gA, gB, botA, botB, bands, alb, DIRS[d]![0], DIRS[d]![1], 0.18);
        }
        curBase = -999;
        continue;
      }

      // Floor, Door, Water
      const g = surface(cx, cy);
      minElev = Math.min(minElev, g);
      let alb: number[];
      let cracked = false;
      let off = 0;
      let isBridge = false;
      if (k === CellKind.Water) alb = bedC;
      else {
        const hA = hash2(cx, cy, 1);
        const hB = hash2(cx, cy, 3);
        let nearWall = false;
        let chasmN = 0;
        for (let d = 0; d < 4; d++) {
          const nk = kindAt(cx + DIRS[d]![0], cy + DIRS[d]![1]);
          if (nk === CellKind.Wall) nearWall = true;
          if (nk === CellKind.Chasm) chasmN++;
        }
        if (look.id === 'warrens') {
          // Packed earth with stone patches, darker toward walls.
          alb = mix3(fA, fB, vnoise(cx * 0.45, cy * 0.45));
          const patch = vnoise(cx * 0.3 + 40, cy * 0.3 + 7);
          if (patch > 0.58) alb = mix3(alb, stoneGrey, Math.min(1, (patch - 0.58) * 5) * 0.8);
          alb = scale3(alb, 0.84 + 0.3 * hB);
          if (nearWall) alb = scale3(alb, 0.8);
        } else {
          alb = scale3(mix3(fA, fB, hA), 0.88 + 0.24 * hB);
          cracked = hash2(cx, cy, 51) < 0.07;
          if (cracked) alb = scale3(alb, 0.72);
          if (hash2(cx, cy, 52) < 0.06) off = (hash2(cx, cy, 53) - 0.5) * 0.05;
          if (look.id === 'crypt') {
            const r = plan.roomIds[idx]!;
            const room = r >= 0 ? plan.rooms[r] : undefined;
            if (room) {
              const bw = room.bounds.x1 - room.bounds.x0 + 1;
              const bh = room.bounds.y1 - room.bounds.y0 + 1;
              if (Math.min(bw, bh) >= 7 && Math.max(bw, bh) >= 9) {
                const along = bw >= bh;
                const mid = along ? (room.bounds.y0 + room.bounds.y1) / 2 : (room.bounds.x0 + room.bounds.x1) / 2;
                const c = along ? cy : cx;
                const lo = along ? room.bounds.x0 + 1 : room.bounds.y0 + 1;
                const hi = along ? room.bounds.x1 - 1 : room.bounds.y1 - 1;
                const pos = along ? cx : cy;
                if (Math.abs(c - mid) <= 0.51 && pos >= lo && pos <= hi) {
                  alb = scale3(mix3(carpetC, alb, 0.22), 0.85 + 0.25 * hB);
                  cracked = false;
                }
              }
            }
          }
        }
        if (k === CellKind.Door) alb = mix3(alb, woodC, 0.65);
        // Bridge: floor with chasm on both sides along one axis reads as wooden planks.
        const chasmNS = kindAt(cx, cy - 1) === CellKind.Chasm && kindAt(cx, cy + 1) === CellKind.Chasm;
        const chasmEW = kindAt(cx - 1, cy) === CellKind.Chasm && kindAt(cx + 1, cy) === CellKind.Chasm;
        if (chasmNS || chasmEW) {
          isBridge = true;
          alb = scale3(mix3(bridgeWood, alb, 0.12), 0.85 + 0.3 * hB);
        }
      }
      if (cx === plan.entrance.x && cy === plan.entrance.y) alb = mix3(alb, stoneC, 0.5);
      const groove = scale3(alb, look.groove);
      const yi = g + 0.04 + off;
      setV(va, x0 + INSET, yi, z0 + INSET, alb, 1);
      setV(vb, x1 - INSET, yi, z0 + INSET, alb, 1);
      setV(vc, x1 - INSET, yi, z1 - INSET, alb, 1);
      setV(vd, x0 + INSET, yi, z1 - INSET, alb, 1);
      quad(buf, va, vb, vc, vd, idx, 0, 1, 0);
      if (cracked) {
        const a0 = hash2(cx, cy, 54) * 6.28;
        let px = x0 + 1 + Math.cos(a0) * 0.7;
        let pz = z0 + 1 + Math.sin(a0) * 0.7;
        const cc = scale3(alb, 0.35);
        for (let seg = 0; seg < 3; seg++) {
          const ang = a0 + Math.PI + (hash2(cx, cy, 55 + seg) - 0.5) * 1.6;
          const nx2 = Math.min(x1 - 0.12, Math.max(x0 + 0.12, px + Math.cos(ang) * 0.55));
          const nz2 = Math.min(z1 - 0.12, Math.max(z0 + 0.12, pz + Math.sin(ang) * 0.55));
          const ex = -(nz2 - pz);
          const ez = nx2 - px;
          const el = Math.hypot(ex, ez) || 1;
          const w2 = 0.035;
          const yc = yi + 0.004;
          setV(va, px + (ex / el) * w2, yc, pz + (ez / el) * w2, cc, 1);
          setV(vb, nx2 + (ex / el) * w2, yc, nz2 + (ez / el) * w2, cc, 1);
          setV(vc, nx2 - (ex / el) * w2, yc, nz2 - (ez / el) * w2, cc, 1);
          setV(vd, px - (ex / el) * w2, yc, pz - (ez / el) * w2, cc, 1);
          quad(buf, va, vb, vc, vd, idx, 0, 1, 0);
          px = nx2;
          pz = nz2;
        }
      }
      if (isBridge) {
        const railC = scale3(woodC, 0.75);
        for (let d = 0; d < 4; d++) {
          if (kindAt(cx + DIRS[d]![0], cy + DIRS[d]![1]) !== CellKind.Chasm) continue;
          const o0 = d === 0 ? [x0, z0] : d === 1 ? [x1 - 0.1, z0] : d === 2 ? [x0, z1 - 0.1] : [x0, z0];
          const horiz = d === 0 || d === 2;
          const bx0 = o0[0]!;
          const bz0 = o0[1]!;
          box(buf, idx, bx0, g + 0.3, bz0, bx0 + (horiz ? CELL : 0.1), g + 0.42, bz0 + (horiz ? 0.1 : CELL), railC);
          box(buf, idx, bx0, g, bz0, bx0 + 0.12, g + 0.42, bz0 + 0.12, railC);
        }
      }
      const O: [number, number][] = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      const In: [number, number][] = [
        [x0 + INSET, z0 + INSET],
        [x1 - INSET, z0 + INSET],
        [x1 - INSET, z1 - INSET],
        [x0 + INSET, z1 - INSET],
      ];
      for (let d = 0; d < 4; d++) {
        const o0 = O[d]!;
        const o1 = O[(d + 1) % 4]!;
        const i0 = In[d]!;
        const i1 = In[(d + 1) % 4]!;
        setV(va, o0[0], g, o0[1], groove, 1);
        setV(vb, o1[0], g, o1[1], groove, 1);
        setV(vc, i1[0], yi, i1[1], alb, 0.85);
        setV(vd, i0[0], yi, i0[1], alb, 0.85);
        quad(buf, va, vb, vc, vd, idx, DIRS[d]![0] * 0.4, 1, DIRS[d]![1] * 0.4);
      }
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS[d]![0];
        const ny = cy + DIRS[d]![1];
        const nk = kindAt(nx, ny);
        if (nk === CellKind.Wall) continue;
        const o0 = O[d]!;
        const o1 = O[(d + 1) % 4]!;
        let bands: Band[] | null = null;
        let bot = 0;
        if (nk === CellKind.Chasm && isBridge) {
          // A bridge is a thin plank deck: a slim wooden edge, then open void.
          const o0c = O[d]!;
          const o1c = O[(d + 1) % 4]!;
          side(buf, idx, [o0c[0], g, o0c[1]], [o1c[0], g, o1c[1]], o0c, o1c, g - 0.3, g - 0.3, [[0, 1, 0.8, 0.5]], scale3(alb, 0.7), DIRS[d]![0], DIRS[d]![1], 0.1);
          continue;
        }
        if (nk === CellKind.Chasm) {
          const o0c = O[d]!;
          const o1c = O[(d + 1) % 4]!;
          fadeFace(buf, idx, [o0c[0], g, o0c[1]], [o1c[0], g, o1c[1]], o0c, o1c, g - 24, g, mix3(alb, stoneC, 0.35), DIRS[d]![0], DIRS[d]![1]);
          continue;
        } else if (nk === CellKind.Void) {
          bands = BANDS_CLIFF;
          bot = g - 3;
        } else if (isWalkKind(nk)) {
          const sh = surface(nx, ny);
          if (g - sh > 0.05) {
            bands = BANDS_RISER;
            bot = sh;
          }
        }
        if (!bands) continue;
        side(buf, idx, [o0[0], g, o0[1]], [o1[0], g, o1[1]], o0, o1, bot, bot, bands, mix3(alb, stoneC, 0.35), DIRS[d]![0], DIRS[d]![1], 0.1);
      }
      if (k === CellKind.Door) {
        const open = (dx: number, dy: number): boolean => isWalkKind(kindAt(cx + dx, cy + dy));
        const alongX = open(-1, 0) && open(1, 0);
        const alongZ = open(0, -1) && open(0, 1);
        const frame = mix3(stoneC, stoneDark, 0.3);
        const yt = g + 1.5;
        const xm = x0 + 1;
        const zm = z0 + 1;
        if (alongZ && !alongX) {
          box(buf, idx, x0, g, zm - 0.42, x0 + 0.42, yt, zm + 0.42, frame);
          box(buf, idx, x1 - 0.42, g, zm - 0.42, x1, yt, zm + 0.42, frame);
          box(buf, idx, x0, yt, zm - 0.5, x0 + 0.55, yt + 0.12, zm + 0.5, frame);
          box(buf, idx, x1 - 0.55, yt, zm - 0.5, x1, yt + 0.12, zm + 0.5, frame);
        } else if (alongX && !alongZ) {
          box(buf, idx, xm - 0.42, g, z0, xm + 0.42, yt, z0 + 0.42, frame);
          box(buf, idx, xm - 0.42, g, z1 - 0.42, xm + 0.42, yt, z1, frame);
          box(buf, idx, xm - 0.5, yt, z0, xm + 0.5, yt + 0.12, z0 + 0.55, frame);
          box(buf, idx, xm - 0.5, yt, z1 - 0.55, xm + 0.5, yt + 0.12, z1, frame);
        }
      }
      if (k === CellKind.Water) {
        const wy = elevAt(cx, cy) - 0.2;
        const a2 = scale3(waterC, 0.9 + 0.2 * hash2(cx, cy, 6));
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const qx = x0 + sx;
            const qz = z0 + sy;
            setV(va, qx, wy, qz, a2, 1);
            setV(vb, qx + 1, wy, qz, a2, 1);
            setV(vc, qx + 1, wy, qz + 1, a2, 1);
            setV(vd, qx, wy, qz + 1, a2, 1);
            quad(waterBuf, va, vb, vc, vd, idx, 0, 1, 0);
          }
        }
      }
    }
  }

  // Chasm glow far below (or, in lava themes, the molten surface a little below the floors).
  const depthY = lava ? lavaY : minElev - CLIFF_DROP - 2;
  for (const idx of chasmCells) {
    const cx = idx % W;
    const cy = (idx / W) | 0;
    const x0 = cx * CELL;
    const z0 = cy * CELL;
    const a = scale3(glowC, 0.35 + 0.65 * hash2(cx, cy, 8));
    for (const v of [va, vb, vc, vd]) {
      v[3] = a[0]!;
      v[4] = a[1]!;
      v[5] = a[2]!;
    }
    va[0] = x0; va[1] = depthY; va[2] = z0;
    vb[0] = x0 + CELL; vb[1] = depthY; vb[2] = z0;
    vc[0] = x0 + CELL; vc[1] = depthY; vc[2] = z0 + CELL;
    vd[0] = x0; vd[1] = depthY; vd[2] = z0 + CELL;
    if (lava) {
      for (const v of [va, vb, vc, vd]) {
        v[3] = 1;
        v[4] = 1;
        v[5] = 1;
      }
      quad(lavaBuf, va, vb, vc, vd, idx, 0, 1, 0);
    } else quad(glowBuf, va, vb, vc, vd, idx, 0, 1, 0);
  }

  // ---- build meshes ------------------------------------------------------
  const group = new Group();
  group.name = 'floor';
  const disposables: { dispose(): void }[] = [];
  const toGeo = (b: Buf): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3));
    g.setAttribute('cellIdx', new BufferAttribute(new Float32Array(b.cell), 1));
    g.setAttribute('wbase', new BufferAttribute(new Float32Array(b.wb), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    disposables.push(g);
    return g;
  };

  const floorMat = new MeshLambertMaterial({ vertexColors: true });
  fow.patch(floorMat, { occlude: true, hero: true });
  disposables.push(floorMat);
  const solids: Mesh[] = [];
  for (const b of chunks.values()) {
    if (b.pos.length === 0) continue;
    const m = new Mesh(toGeo(b), floorMat);
    m.receiveShadow = true;
    group.add(m);
    solids.push(m);
  }

  if (waterBuf.pos.length) {
    const wm = new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: look.waterOpacity,
      depthWrite: false,
      side: DoubleSide,
    });
    fow.patch(wm, { water: true });
    disposables.push(wm);
    const mesh = new Mesh(toGeo(waterBuf), wm);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  if (glowBuf.pos.length || lavaBuf.pos.length) {
    if (lava && lavaBuf.pos.length) {
      // One extra draw call: a flat animated slag surface over every chasm cell.
      const lm = new MeshBasicMaterial({ vertexColors: true, fog: false });
      fow.patch(lm);
      const fowCompile = lm.onBeforeCompile;
      const fowKey = lm.customProgramCacheKey();
      lm.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, r) => {
        fowCompile(shader, r);
        shader.uniforms.uLavaHot = { value: new Color(lava.color) };
        shader.uniforms.uLavaCrust = { value: new Color(lava.crust) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vLavaP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLavaP = position.xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', LAVA_FRAG_HEAD)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${LAVA_FRAG_BODY}`);
      };
      lm.customProgramCacheKey = () => `${fowKey}-lava`;
      disposables.push(lm);
      const lmesh = new Mesh(toGeo(lavaBuf), lm);
      lmesh.frustumCulled = false;
      group.add(lmesh);
    }
    if (glowBuf.pos.length) {
      const gm = new MeshBasicMaterial({ vertexColors: true, fog: false });
      fow.patch(gm);
      disposables.push(gm);
      const mesh = new Mesh(toGeo(glowBuf), gm);
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    const n = look.moteCount;
    if (n > 0) {
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const ci = new Float32Array(n);
      const mc = new Color(look.moteColor);
      for (let i = 0; i < n; i++) {
        const idx = chasmCells[Math.floor(hash2(i, 1, 31) * chasmCells.length)]!;
        const cx = idx % W;
        const cy = (idx / W) | 0;
        pos[i * 3] = (cx + hash2(i, 2, 32)) * CELL;
        pos[i * 3 + 1] = lava ? lavaY + 0.4 + hash2(i, 3, 33) * 7 : depthY + 2 + hash2(i, 3, 33) * (CLIFF_DROP + 1);
        pos[i * 3 + 2] = (cy + hash2(i, 4, 34)) * CELL;
        const k = 0.4 + 0.6 * hash2(i, 5, 35);
        col[i * 3] = mc.r * k;
        col[i * 3 + 1] = mc.g * k;
        col[i * 3 + 2] = mc.b * k;
        ci[i] = idx;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setAttribute('cellIdx', new BufferAttribute(ci, 1));
      disposables.push(geo);
      const pm = new PointsMaterial({
        size: 0.16,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      fow.patch(pm, { motes: true });
      disposables.push(pm);
      const pts = new Points(geo, pm);
      pts.frustumCulled = false;
      group.add(pts);
    }
  }

  return {
    group,
    solids,
    floorMaterial: floorMat,
    groundY,
    topH,
    bake,
    wallBase,
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

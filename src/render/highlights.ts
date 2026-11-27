import { CanvasTexture, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, LinearFilter, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Group } from 'three';
import type { CellHighlight, HighlightStyle } from '../core/types';
import { CELL } from './util';

/** 'drop' is internal: a danger marker over a chasm / lava cell (hatched, with downward chevrons), hovering at the rim. */
type HlKey = HighlightStyle | 'drop';
const STYLES: HlKey[] = ['move', 'path', 'target', 'area', 'danger', 'drop'];
const T = 64;

interface StyleArt {
  fill: string;
  line: string;
  lineWidth: number;
  hatch?: string;
  dot?: boolean;
}

/** Highlight palettes, picked per theme so every style stays legible on the floor colour. */
export type HighlightPalette = 'default' | 'warm' | 'cool' | 'green';

const BASE_ART: Record<HighlightStyle, StyleArt> = {
  move: { fill: 'rgba(110,175,255,0.17)', line: 'rgba(150,200,255,0.95)', lineWidth: 3 },
  path: { fill: 'rgba(0,0,0,0)', line: 'rgba(255,255,255,1)', lineWidth: 3, dot: true },
  target: { fill: 'rgba(255,60,50,0.16)', line: 'rgba(255,70,55,1)', lineWidth: 5 },
  area: { fill: 'rgba(255,150,40,0.16)', line: 'rgba(255,175,70,0.95)', lineWidth: 3, hatch: 'rgba(255,170,60,0.45)' },
  danger: { fill: 'rgba(90,0,12,0.34)', line: 'rgba(170,20,30,0.95)', lineWidth: 3, hatch: 'rgba(120,10,20,0.5)' },
};

const PALETTES: Record<HighlightPalette, Partial<Record<HighlightStyle, Partial<StyleArt>>>> = {
  default: {},
  // Red/orange lit floors: blue-green move, magenta target, violet area, bright-rimmed danger.
  warm: {
    move: { fill: 'rgba(70,230,255,0.24)', line: 'rgba(150,250,255,1)' },
    target: { fill: 'rgba(255,60,210,0.24)', line: 'rgba(255,90,225,1)' },
    area: { fill: 'rgba(170,110,255,0.24)', line: 'rgba(200,150,255,1)', hatch: 'rgba(200,150,255,0.5)' },
    danger: { fill: 'rgba(20,0,40,0.4)', line: 'rgba(255,235,90,1)', hatch: 'rgba(255,235,90,0.5)' },
  },
  // Blue / lavender / white floors: green move so it does not melt into the floor.
  cool: {
    move: { fill: 'rgba(60,230,130,0.24)', line: 'rgba(150,255,190,1)' },
    area: { fill: 'rgba(255,150,40,0.22)', line: 'rgba(255,170,60,1)', hatch: 'rgba(255,170,60,0.55)' },
    danger: { fill: 'rgba(110,0,20,0.4)', line: 'rgba(255,60,70,1)', hatch: 'rgba(200,20,30,0.55)' },
  },
  // Green / murky olive floors: cyan move.
  green: {
    move: { fill: 'rgba(60,200,255,0.24)', line: 'rgba(150,230,255,1)' },
    danger: { fill: 'rgba(110,0,20,0.4)', line: 'rgba(255,60,70,1)', hatch: 'rgba(200,20,30,0.55)' },
  },
};

/** 4x4 atlas of tiles, indexed by a 4-bit mask of OUTER edges (N=1, E=2, S=4, W=8). */
function makeDropAtlas(palette: HighlightPalette): CanvasTexture {
  const art: StyleArt = { ...BASE_ART.danger, ...PALETTES[palette].danger };
  const c = document.createElement('canvas');
  c.width = c.height = T * 4;
  const g = c.getContext('2d')!;
  // Tile 0 (top-left) holds the whole marker.
  g.beginPath();
  g.rect(0, 0, T, T);
  g.clip();
  g.fillStyle = 'rgba(12,4,8,0.62)';
  g.fillRect(2, 2, T - 4, T - 4);
  g.fillStyle = art.fill;
  g.fillRect(2, 2, T - 4, T - 4);
  g.strokeStyle = art.hatch ?? art.line;
  g.lineWidth = 3;
  for (let i = -T; i < T; i += 10) {
    g.beginPath();
    g.moveTo(i, T);
    g.lineTo(i + T, 0);
    g.stroke();
  }
  g.strokeStyle = art.line;
  g.lineWidth = 5;
  g.strokeRect(3, 3, T - 6, T - 6);
  // Two downward chevrons: dark outline under a bright stroke so they read on any hatch colour.
  for (const dy of [10, 26]) {
    g.beginPath();
    g.moveTo(14, 14 + dy - 4);
    g.lineTo(T / 2, 14 + dy + 10);
    g.lineTo(T - 14, 14 + dy - 4);
    g.lineJoin = 'miter';
    g.strokeStyle = 'rgba(10,0,6,0.95)';
    g.lineWidth = 11;
    g.stroke();
    g.strokeStyle = 'rgba(255,245,225,1)';
    g.lineWidth = 6;
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function makeAtlas(style: HlKey, palette: HighlightPalette = 'default'): CanvasTexture {
  if (style === 'drop') return makeDropAtlas(palette);
  const art: StyleArt = { ...BASE_ART[style], ...PALETTES[palette][style] };
  const c = document.createElement('canvas');
  c.width = c.height = T * 4;
  const g = c.getContext('2d')!;
  for (let m = 0; m < 16; m++) {
    const ox = (m % 4) * T;
    const oy = Math.floor(m / 4) * T;
    g.save();
    g.beginPath();
    g.rect(ox, oy, T, T);
    g.clip();
    if (art.dot) {
      if (m === 0) {
        g.fillStyle = 'rgba(40,110,230,1)';
        g.beginPath();
        g.arc(ox + T / 2, oy + T / 2, 13, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = art.line;
        g.beginPath();
        g.arc(ox + T / 2, oy + T / 2, 9, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      continue;
    }
    const inN = m & 1 ? 3 : 0;
    const inE = m & 2 ? 3 : 0;
    const inS = m & 4 ? 3 : 0;
    const inW = m & 8 ? 3 : 0;
    g.fillStyle = art.fill;
    g.fillRect(ox + inW, oy + inN, T - inW - inE, T - inN - inS);
    if (art.hatch) {
      g.strokeStyle = art.hatch;
      g.lineWidth = 2;
      for (let i = -T; i < T; i += 12) {
        g.beginPath();
        g.moveTo(ox + i, oy + T);
        g.lineTo(ox + i + T, oy);
        g.stroke();
      }
    }
    g.strokeStyle = art.line;
    g.lineWidth = art.lineWidth;
    g.lineCap = 'butt';
    const h = art.lineWidth / 2;
    const line = (x0: number, y0: number, x1: number, y1: number): void => {
      g.beginPath();
      g.moveTo(ox + x0, oy + y0);
      g.lineTo(ox + x1, oy + y1);
      g.stroke();
    };
    const e0 = (m & 8 ? 3 : 0) - (m & 8 ? h : 0);
    const e1 = T - (m & 2 ? 3 : 0) + (m & 2 ? h : 0);
    if (m & 1) line(e0, 3 + h, e1, 3 + h);
    if (m & 4) line(e0, T - 3 - h, e1, T - 3 - h);
    if (m & 8) line(3 + h, 0, 3 + h, T);
    if (m & 2) line(T - 3 - h, 0, T - 3 - h, T);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Instanced flat quads above cells (one InstancedMesh per style, atlas tile chosen per instance). */
export class Highlights {
  private meshes = new Map<HlKey, InstancedMesh>();
  private mats = new Map<HlKey, MeshBasicMaterial>();
  private textures: CanvasTexture[] = [];
  private palette: HighlightPalette = 'default';
  private geos: PlaneGeometry[] = [];
  private counts: Record<HlKey, number> = { move: 0, path: 0, target: 0, area: 0, danger: 0, drop: 0 };
  private occ: Record<HlKey, Uint8Array> = {
    drop: new Uint8Array(0),
    move: new Uint8Array(0),
    path: new Uint8Array(0),
    target: new Uint8Array(0),
    area: new Uint8Array(0),
    danger: new Uint8Array(0),
  };
  private w = 0;
  private h = 0;

  constructor(private readonly parent: Group) {
    for (const s of STYLES) {
      const tex = makeAtlas(s);
      this.textures.push(tex);
      const mat = new MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: false,
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aTile;')
          .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = (vMapUv + vec2(mod(aTile, 4.0), 3.0 - floor(aTile / 4.0))) * 0.25;
#endif`,
          );
      };
      mat.customProgramCacheKey = () => 'hl-atlas';
      this.mats.set(s, mat);
      this.makeMesh(s, 128);
    }
  }

  /** Redraw the style atlases in a theme's palette (cheap; once per floor). No-op if unchanged. */
  setPalette(p: HighlightPalette): void {
    if (p === this.palette) return;
    this.palette = p;
    const old = this.textures;
    this.textures = [];
    for (const s of STYLES) {
      const tex = makeAtlas(s, p);
      this.textures.push(tex);
      this.mats.get(s)!.map = tex;
    }
    for (const t of old) t.dispose();
  }

  /** Tell the highlighter the grid size (call on floor load). */
  setGrid(w: number, h: number): void {
    this.w = w;
    this.h = h;
    for (const s of STYLES) this.occ[s] = new Uint8Array(w * h);
  }

  private makeMesh(style: HlKey, capacity: number): InstancedMesh {
    const old = this.meshes.get(style);
    if (old) {
      this.parent.remove(old);
      old.dispose();
    }
    const geo = new PlaneGeometry(CELL * 0.98, CELL * 0.98).rotateX(-Math.PI / 2);
    geo.setAttribute('aTile', new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage));
    this.geos.push(geo);
    const m = new InstancedMesh(geo, this.mats.get(style)!, capacity);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.visible = false;
    this.parent.add(m);
    this.meshes.set(style, m);
    return m;
  }

  /**
   * `groundAt` returns the world Y of the walkable surface of a cell. `hazardAt` returns the rim height for chasm / lava
   * cells (markers hover there instead of at the pit bottom) and null for ordinary cells; a 'danger' highlight on a hazard
   * cell is drawn as the hatched drop marker.
   */
  set(cells: CellHighlight[], groundAt: (x: number, y: number) => number, hazardAt?: (x: number, y: number) => number | null): void {
    const { w, h } = this;
    const need: Record<HlKey, number> = { move: 0, path: 0, target: 0, area: 0, danger: 0, drop: 0 };
    const keyOf = (c: CellHighlight): { key: HlKey; hy: number | null } => {
      const hy = hazardAt ? hazardAt(c.pos.x, c.pos.y) : null;
      return { key: hy !== null && c.style === 'danger' ? 'drop' : c.style, hy };
    };
    const keys = cells.map(keyOf);
    for (const k of keys) need[k.key]++;
    for (const s of STYLES) {
      let m = this.meshes.get(s)!;
      if (need[s] > m.instanceMatrix.count) m = this.makeMesh(s, Math.max(need[s], m.instanceMatrix.count * 2));
      this.counts[s] = 0;
      m.count = 0;
      this.occ[s].fill(0);
    }
    cells.forEach((c, ci) => {
      if (c.pos.x >= 0 && c.pos.y >= 0 && c.pos.x < w && c.pos.y < h) this.occ[keys[ci]!.key][c.pos.y * w + c.pos.x] = 1;
    });
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci]!;
      const style = keys[ci]!.key;
      const hy = keys[ci]!.hy;
      const m = this.meshes.get(style)!;
      const i = this.counts[style]++;
      const a = m.instanceMatrix.array as Float32Array;
      const o = i * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0;
      a[o + 12] = c.pos.x * CELL + CELL / 2;
      a[o + 13] = hy !== null ? hy + (style === 'drop' ? 0.4 : 0.1) : groundAt(c.pos.x, c.pos.y) + 0.07;
      a[o + 14] = c.pos.y * CELL + CELL / 2;
      a[o + 15] = 1;
      let mask = 0;
      if (style !== 'path' && style !== 'drop') {
        const g = this.occ[style];
        const x = c.pos.x;
        const y = c.pos.y;
        if (y <= 0 || !g[(y - 1) * w + x]) mask |= 1;
        if (x >= w - 1 || !g[y * w + x + 1]) mask |= 2;
        if (y >= h - 1 || !g[(y + 1) * w + x]) mask |= 4;
        if (x <= 0 || !g[y * w + x - 1]) mask |= 8;
      }
      (m.geometry.getAttribute('aTile') as InstancedBufferAttribute).array[i] = mask;
    }
    for (const s of STYLES) {
      const m = this.meshes.get(s)!;
      m.count = this.counts[s];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      (m.geometry.getAttribute('aTile') as InstancedBufferAttribute).needsUpdate = true;
    }
  }

  update(time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.5);
    this.mats.get('target')!.opacity = 0.8 + 0.2 * pulse;
    this.mats.get('area')!.opacity = 0.85 + 0.15 * pulse;
    this.mats.get('danger')!.opacity = 0.8 + 0.2 * Math.sin(time * 3);
    this.mats.get('drop')!.opacity = 0.85 + 0.15 * pulse;
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      this.parent.remove(m);
      m.dispose();
    }
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    for (const g of this.geos) g.dispose();
    this.meshes.clear();
  }
}

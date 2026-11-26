import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K, NEI4, NEI8, dist, fbm2 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';

/**
 * The Sundered Depths: verticality.
 *
 * 1. Heights first. The main path climbs (or descends) 8-11 steps from
 *    entrance to boss with +/-3 jitter so the route winds up and down; side
 *    rooms perch above or below their parent (treasure 3-5 steps, others 2-3).
 * 2. Platforms (rounded superellipses, sometimes L-shaped) are walked out over
 *    the plane in cardinal directions, each separated from its parent by a gap
 *    of at least |height difference|+1 cells so a staircase fits in between.
 * 3. Bridges are straight, axis-aligned strips 1 or 2 cells wide through rows
 *    (or columns) where both platforms have cells. Their heights come from the
 *    Lipschitz solver with a random style per bridge: 'mid' spreads the slope,
 *    'high'/'low' climb one step per cell near one end (stairs).
 * 4. Everything is dilated by 3-6 cells of Chasm (noisy radius) and the rest is
 *    cave wall. The entrance and boss platforms (and sometimes a treasure
 *    perch) have their unused sides erased back to rock so they hug the cliff,
 *    which is where torches go.
 * 5. The boss platform is large with terraces rising toward its far side.
 *    Crystals cluster on chasm edges, broken colonnades stand in the middle.
 *
 * One set piece per floor: a tiered amphitheatre for the boss, a second bridge
 * to the boss island, a landing in the middle of the longest bridge, the
 * well (a combat platform that is a ring around a hole into the chasm), or the
 * mesa (a stepped rock mound in the middle of the roomiest combat platform).
 *
 * Tunables: height span 8-11, jitter 3, gap formula, dilation 3-6, crystal counts.
 */

interface Plat {
  id: number;
  role: RoomRole;
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  e: number;
  cells: number[];
  rowMin: Int16Array;
  rowMax: Int16Array;
  colMin: Int16Array;
  colMax: Int16Array;
  /** Directions (0 +x, 1 +y, 2 -x, 3 -y) used by bridges. */
  used: Set<number>;
}

/** A carved bridge: its first lane (for length and midpoint) and every cell of it. */
interface BridgeLog {
  lane: Array<[number, number]>;
  cells: Array<[number, number]>;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const x0 = (p: Plat): number => p.cx - p.hx;
const x1 = (p: Plat): number => p.cx + p.hx;
const y0 = (p: Plat): number => p.cy - p.hy;
const y1 = (p: Plat): number => p.cy + p.hy;

/** What a sibling platform theme changes about the depths recipe. Omitted fields keep the depths values. */
export interface PlatformOptions {
  /** Replaces the crystal-and-colonnade decoration. */
  decorate?: (ctx: DecorCtx) => void;
}

export function genDepths(graph: MissionGraph, rng: Rng, depth: number, opts: PlatformOptions = {}): Layout {
  void depth;
  const n = graph.roles.length;
  const elevs = planHeights(graph, rng);
  const W = Math.max(52, Math.min(62, Math.round(48 + n * 1.5) + rng.int(-2, 4)));
  const H = Math.max(52, Math.min(62, Math.round(48 + n * 1.5) + rng.int(-2, 4)));
  const g = new Grid(W, H);
  const plats = placePlatforms(graph, rng, W, H, elevs);
  const seed = rng.int(1, 1e9);
  // Set piece for this floor.
  let piece: 'amphitheatre' | 'twinBridge' | 'landing' | 'well' | 'mesa' = rng.pick(['amphitheatre', 'twinBridge', 'landing', 'well', 'mesa'] as const);
  // The well and the mesa need the roomiest combat platform, and that one must be at least 9 cells across.
  let featureHost = -1;
  if (piece === 'well' || piece === 'mesa') {
    for (const p of plats) {
      if (p.role !== 'combat' || Math.min(p.hx, p.hy) < 4) continue;
      if (featureHost < 0 || p.hx * p.hy > (plats[featureHost] as Plat).hx * (plats[featureHost] as Plat).hy) featureHost = p.id;
    }
    if (featureHost < 0) piece = 'twinBridge';
  }
  for (const p of plats) {
    const host = p.id === featureHost;
    carvePlatform(g, p, seed, rng, plats, graph, piece === 'amphitheatre', host && piece === 'well', host && piece === 'mesa');
  }

  // Bridges.
  const edges: Array<[number, number]> = [];
  const bridgeLog: BridgeLog[] = [];
  for (const [a, b] of graph.edges) {
    if (!bridge(g, plats[a] as Plat, plats[b] as Plat, rng, true, bridgeLog)) throw new GenFail('no bridge row');
    edges.push([a, b]);
  }
  if (piece === 'landing') {
    const longest = bridgeLog.reduce<BridgeLog | null>((best, s) => (!best || s.lane.length > best.lane.length ? s : best), null);
    if (longest && longest.lane.length >= 8 && carveLanding(g, longest)) piece = 'landing';
    else piece = 'twinBridge'; // no long span to rest on: give the boss a second bridge instead
  }
  if (piece === 'twinBridge') {
    // The boss platform is an island reached by two bridges (different lanes, so different heights).
    const boss = graph.roles.indexOf('boss');
    const par = graph.parent[boss] as number;
    if (!bridge(g, plats[par] as Plat, plats[boss] as Plat, rng, true)) throw new GenFail('no second bridge');
  }
  for (const [a, b] of graph.optional) {
    if (Math.abs((plats[a] as Plat).e - (plats[b] as Plat).e) <= 4 && bridge(g, plats[a] as Plat, plats[b] as Plat, rng, false)) {
      edges.push([a, b]);
    }
  }
  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((g.room[i] as number) >= 0 && g.kinds[i] === K.Floor) fixed[i] = 1;
  if (!solveElevation(g, fixed, () => rng.weighted(['mid', 'high', 'low'] as const, [0.35, 0.4, 0.25]))) {
    throw new GenFail('depths elevation unsolved');
  }

  fillChasm(g, plats, seed, rng);

  const accent = rng.pick([0x55d8ff, 0xa070ff, 0x55d8ff]);
  return { grid: g, roles: graph.roles, edges, decorate: opts.decorate ?? ((ctx) => decorate(ctx, accent)), setPiece: piece };
}

// ---------------------------------------------------------------------------

function planHeights(graph: MissionGraph, rng: Rng): number[] {
  const n = graph.roles.length;
  const boss = graph.roles.indexOf('boss');
  const dir = rng.chance(0.5) ? 1 : -1;
  const T = rng.int(8, 11);
  const e: number[] = new Array<number>(n).fill(0);
  e[boss] = dir * T;
  for (let k = 1; k < boss; k++) e[k] = Math.round((dir * T * k) / boss + rng.int(-3, 3));
  for (let k = 1; k < boss; k++) e[k] = Math.max((e[k - 1] as number) - 5, Math.min((e[k - 1] as number) + 5, e[k] as number));
  for (let k = boss - 1; k >= 1; k--) e[k] = Math.max((e[k + 1] as number) - 5, Math.min((e[k + 1] as number) + 5, e[k] as number));
  for (let i = boss + 1; i < n; i++) {
    const p = graph.parent[i] as number;
    const role = graph.roles[i] as RoomRole;
    const mag = role === 'treasure' ? rng.int(3, 5) : rng.int(2, 3);
    e[i] = (e[p] as number) + (rng.chance(0.5) ? mag : -mag);
  }
  let lo = 999;
  let hi = -999;
  for (const v of e) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (hi - lo < 8) throw new GenFail('height span too small');
  return e;
}

function placePlatforms(graph: MissionGraph, rng: Rng, W: number, H: number, elevs: number[]): Plat[] {
  for (let restart = 0; restart < 10; restart++) {
    const plats = tryPlacePlatforms(graph, rng, W, H, elevs);
    if (plats) return plats;
  }
  throw new GenFail('platform placement');
}

function tryPlacePlatforms(graph: MissionGraph, rng: Rng, W: number, H: number, elevs: number[]): Plat[] | null {
  const n = graph.roles.length;
  const plats: Plat[] = [];
  const inDir: number[] = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const role = graph.roles[i] as RoomRole;
    const r =
      role === 'boss' ? rng.range(6, 7.2) : role === 'treasure' ? rng.range(2.6, 3.4) : role === 'entrance' ? rng.range(3, 4) : rng.range(3.4, 4.8);
    const hx = Math.max(3, Math.round(r * rng.range(0.85, 1.15)));
    const hy = Math.max(3, Math.round(r * rng.range(0.85, 1.15)));
    const mk = (cx: number, cy: number): Plat => ({
      id: i,
      role,
      cx,
      cy,
      hx,
      hy,
      e: elevs[i] as number,
      cells: [],
      rowMin: new Int16Array(H).fill(-1),
      rowMax: new Int16Array(H).fill(-1),
      colMin: new Int16Array(W).fill(-1),
      colMax: new Int16Array(W).fill(-1),
      used: new Set<number>(),
    });
    const inside = (p: Plat): boolean => x0(p) >= 5 && y0(p) >= 5 && x1(p) <= W - 6 && y1(p) <= H - 6;
    if (i === 0) {
      let placed: Plat | null = null;
      for (let t = 0; t < 30 && !placed; t++) {
        const p = mk(rng.int(hx + 5, W - hx - 6), rng.int(hy + 5, H - hy - 6));
        if (inside(p)) placed = p;
      }
      if (!placed) return null;
      plats.push(placed);
      continue;
    }
    const pi = graph.parent[i] as number;
    const par = plats[pi] as Plat;
    const gapBase = Math.max(4, Math.abs((elevs[i] as number) - par.e) + 1);
    let placed: Plat | null = null;
    let dirUsed = 0;
    for (let t = 0; t < 40 && !placed; t++) {
      const weights = [0, 1, 2, 3].map((d) => {
        const pd = inDir[pi] as number;
        if (pd < 0) return 1;
        return d === (pd + 2) % 4 ? 0 : d === pd ? 1.5 : 3;
      });
      const d = rng.weighted([0, 1, 2, 3], weights);
      const gap = gapBase + rng.int(0, 3);
      const [dx, dy] = DIRS[d] as readonly [number, number];
      let cx: number;
      let cy: number;
      if (dx !== 0) {
        const off = Math.floor(Math.min(par.hy, hy) * 0.6);
        cx = par.cx + dx * (par.hx + gap + 1 + hx);
        cy = par.cy + rng.int(-off, off);
      } else {
        const off = Math.floor(Math.min(par.hx, hx) * 0.6);
        cy = par.cy + dy * (par.hy + gap + 1 + hy);
        cx = par.cx + rng.int(-off, off);
      }
      const p = mk(cx, cy);
      if (!inside(p)) continue;
      let ok = true;
      for (const q of plats) {
        if (q === par) continue;
        if (!(x1(p) + 3 < x0(q) || x0(p) > x1(q) + 3 || y1(p) + 3 < y0(q) || y0(p) > y1(q) + 3)) ok = false;
      }
      if (!ok) continue;
      // The bridge corridor between parent and child must not run through a third platform.
      const sx0 = Math.max(x0(p), x0(par));
      const sx1 = Math.min(x1(p), x1(par));
      const sy0 = Math.max(y0(p), y0(par));
      const sy1 = Math.min(y1(p), y1(par));
      const rx0 = dx !== 0 ? Math.min(x1(p), x1(par)) : sx0;
      const rx1 = dx !== 0 ? Math.max(x0(p), x0(par)) : sx1;
      const ry0 = dy !== 0 ? Math.min(y1(p), y1(par)) : sy0;
      const ry1 = dy !== 0 ? Math.max(y0(p), y0(par)) : sy1;
      for (const q of plats) {
        if (q === par) continue;
        if (!(rx1 + 1 < x0(q) || rx0 - 1 > x1(q) || ry1 + 1 < y0(q) || ry0 - 1 > y1(q))) ok = false;
      }
      if (!ok) continue;
      placed = p;
      dirUsed = d;
    }
    if (!placed) return null;
    inDir[i] = dirUsed;
    plats.push(placed);
  }
  return plats;
}

/** a^e for e in {2,3,4} using multiplications only (deterministic across engines). */
function superPow(a: number, e: number): number {
  const a2 = a * a;
  return e === 2 ? a2 : e === 3 ? a2 * a : a2 * a2;
}

function carvePlatform(g: Grid, p: Plat, seed: number, rng: Rng, plats: Plat[], graph: MissionGraph, amphitheatre: boolean, well: boolean, mesa: boolean): void {
  const exp = rng.pick([2, 2, 2, 3, 3, 4]);
  const notchRoll = p.role !== 'entrance' && p.role !== 'treasure' && rng.chance(0.45) ? rng.int(0, 3) : -1;
  // A notch beside the well's hole would pinch the ring shut; the mesa keeps its platform whole too.
  const notch = well || mesa ? -1 : notchRoll;
  // A second, smaller lobe makes the outline irregular rather than a rounded box.
  const lobe = p.role === 'combat' && rng.chance(0.45) ? { sx: rng.chance(0.5) ? 1 : -1, sy: rng.chance(0.5) ? 1 : -1 } : null;
  const inside = new Set<number>();
  for (let y = y0(p); y <= y1(p); y++) {
    for (let x = x0(p); x <= x1(p); x++) {
      const nx = (x - p.cx) / (p.hx + 0.5);
      const ny = (y - p.cy) / (p.hy + 0.5);
      const v = superPow(Math.abs(nx), exp) + superPow(Math.abs(ny), exp);
      const lx = (x - (p.cx + (lobe ? lobe.sx * p.hx * 0.45 : 0))) / (p.hx * 0.62 + 0.5);
      const ly = (y - (p.cy + (lobe ? lobe.sy * p.hy * 0.45 : 0))) / (p.hy * 0.62 + 0.5);
      const inLobe = lobe !== null && lx * lx + ly * ly <= 1;
      if (!inLobe && v > 1 + (fbm2(seed, x * 0.3, y * 0.3) - 0.5) * 0.5) continue;
      if (notch >= 0 && !inLobe) {
        const sx = notch & 1 ? 1 : -1;
        const sy = notch & 2 ? 1 : -1;
        if (nx * sx > 0.3 && ny * sy > 0.3) continue;
      }
      inside.add(y * g.w + x);
    }
  }
  // Largest 4-connected component around the centre, then prune spurs.
  const start = p.cy * g.w + p.cx;
  if (!inside.has(start)) inside.add(start);
  const keep = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop() as number;
    for (const [dx, dy] of NEI4) {
      const j = i + dy * g.w + dx;
      if (inside.has(j) && !keep.has(j)) {
        keep.add(j);
        stack.push(j);
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const i of [...keep]) {
      let c = 0;
      for (const [dx, dy] of NEI4) if (keep.has(i + dy * g.w + dx)) c++;
      if (c < 2) keep.delete(i);
    }
  }
  if (keep.size < 20) throw new GenFail('platform too small');

  // Terraces: the boss platform rises toward the side away from its parent.
  let fx = 0;
  let fy = 0;
  if (p.role === 'boss') {
    const par = plats[graph.parent[p.id] as number] as Plat;
    const vx = p.cx - par.cx;
    const vy = p.cy - par.cy;
    if (Math.abs(vx) >= Math.abs(vy)) fx = Math.sign(vx);
    else fy = Math.sign(vy);
  }
  const mound = !well && !mesa && p.role === 'combat' && p.hx * p.hy >= 24 && rng.chance(0.4);
  for (const i of keep) {
    const x = i % g.w;
    const y = (i / g.w) | 0;
    let e = p.e;
    if (p.role === 'boss' && amphitheatre) {
      // Tiered arena: the rim is two steps above the sunken floor, stepping down toward the middle.
      const rr = dist((x - p.cx) / (p.hx + 0.5), (y - p.cy) / (p.hy + 0.5));
      if (rr > 0.45) e += 1;
      if (rr > 0.75) e += 1;
    } else if (p.role === 'boss') {
      const t = fx !== 0 ? ((x - p.cx) * fx) / p.hx : ((y - p.cy) * fy) / p.hy;
      if (t > 0.25) e += 1;
      if (t > 0.6) e += 1;
    } else if (mesa) {
      // Stepped rock mound: a 3x3 summit two steps up, ringed by a one-step shoulder.
      const ring = Math.max(Math.abs(x - p.cx), Math.abs(y - p.cy));
      if (ring <= 1) e += 2;
      else if (ring === 2) e += 1;
    } else if (mound && Math.abs(x - p.cx) <= 1 && Math.abs(y - p.cy) <= 1) e += 1;
    g.floor(x, y, e, p.id);
    p.cells.push(i);
    if (p.rowMin[y] === -1 || x < (p.rowMin[y] as number)) p.rowMin[y] = x;
    if (x > (p.rowMax[y] as number)) p.rowMax[y] = x;
    if (p.colMin[x] === -1 || y < (p.colMin[x] as number)) p.colMin[x] = y;
    if (y > (p.colMax[x] as number)) p.colMax[x] = y;
  }
  if (well) {
    // The hole: nine cells round the centre drop into the chasm, leaving a ring to fight on.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g.kinds[g.idx(p.cx + dx, p.cy + dy)] = K.Chasm;
  }
}

/** Carve a straight 1 or 2 wide strip between two platforms. Returns false if no clean row exists. */
function bridge(g: Grid, a: Plat, b: Plat, rng: Rng, mandatory: boolean, log?: BridgeLog[]): boolean {
  const horizontal = x1(a) < x0(b) || x1(b) < x0(a);
  const vertical = y1(a) < y0(b) || y1(b) < y0(a);
  if (!horizontal && !vertical) return false;
  const useH = horizontal && (!vertical || Math.abs(a.cx - b.cx) >= Math.abs(a.cy - b.cy));
  const wide = rng.chance(0.4);
  const [lo, hi] = useH ? (x1(a) < x0(b) ? [a, b] : [b, a]) : y1(a) < y0(b) ? [a, b] : [b, a];
  const mins = useH ? [lo.rowMax, hi.rowMin] : [lo.colMax, hi.colMin];
  const rangeLo = useH ? Math.max(y0(a), y0(b)) : Math.max(x0(a), x0(b));
  const rangeHi = useH ? Math.min(y1(a), y1(b)) : Math.min(x1(a), x1(b));
  if (rangeHi - rangeLo < 2) return false;
  const mid = (rangeLo + rangeHi) / 2 + rng.range(-1, 1);
  const lanes: number[] = [];
  for (let s = rangeLo; s <= rangeHi; s++) lanes.push(s);
  lanes.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  const maxLen = mandatory ? 40 : 14;
  for (const widthTry of wide ? [2, 1] : [1]) {
    for (const s of lanes) {
      if (s + widthTry - 1 > rangeHi) continue;
      const strips: Array<Array<[number, number]>> = [];
      let ok = true;
      for (let k = 0; k < widthTry && ok; k++) {
        const lane = s + k;
        const from = mins[0]?.[lane] ?? -1;
        const to = mins[1]?.[lane] ?? -1;
        if (from < 0 || to < 0 || to - from < 4 || to - from - 1 > maxLen) {
          ok = false;
          break;
        }
        const cells: Array<[number, number]> = [];
        for (let t = from + 1; t < to; t++) {
          const x = useH ? t : lane;
          const y = useH ? lane : t;
          if (g.kinds[g.idx(x, y)] !== K.Void) ok = false;
          cells.push([x, y]);
        }
        strips.push(cells);
      }
      if (!ok) continue;
      // Not alongside anything else (other than the two platforms).
      const own = new Set(strips.flat().map(([x, y]) => g.idx(x, y)));
      for (const [x, y] of strips.flat()) {
        for (const [dx, dy] of NEI8) {
          const j = g.idx(x + dx, y + dy);
          if (g.kinds[j] === K.Floor && !own.has(j) && g.room[j] !== a.id && g.room[j] !== b.id) ok = false;
          else if (g.kinds[j] === K.Floor && !own.has(j) && g.room[j] === -1) ok = false;
        }
      }
      if (!ok) continue;
      for (const [x, y] of strips.flat()) g.floor(x, y, 0, -1);
      log?.push({ lane: strips[0] as Array<[number, number]>, cells: strips.flat() });
      const da = useH ? (a.cx < b.cx ? 0 : 2) : a.cy < b.cy ? 1 : 3;
      a.used.add(da);
      b.used.add((da + 2) % 4);
      return true;
    }
  }
  return false;
}

function fillChasm(g: Grid, plats: Plat[], seed: number, rng: Rng): void {
  const { w, h } = g;
  const chasm = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g.kinds[y * w + x] !== K.Floor) continue;
      const r = 3 + fbm2(seed + 7, x * 0.13, y * 0.13) * 3.2;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 2 || ny < 2 || nx > w - 3 || ny > h - 3) continue;
          chasm[ny * w + nx] = 1;
        }
      }
    }
  }
  // Entrance, boss and sometimes a treasure perch hug the cliff on their unused sides.
  for (const p of plats) {
    if (!(p.role === 'entrance' || p.role === 'boss' || (p.role === 'treasure' && rng.chance(0.5)))) continue;
    for (let d = 0; d < 4; d++) {
      if (p.used.has(d)) continue;
      const [dx, dy] = DIRS[d] as readonly [number, number];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!chasm[i]) continue;
          if ((x - p.cx) * dx + (y - p.cy) * dy <= (dx !== 0 ? p.hx : p.hy) * 0.2) continue;
          if (Math.abs(x - p.cx) > p.hx + 6 || Math.abs(y - p.cy) > p.hy + 6) continue;
          // Stay clear of any other walkable cell.
          let near = false;
          for (let yy = -2; yy <= 2 && !near; yy++) {
            for (let xx = -2; xx <= 2; xx++) {
              const j = (y + yy) * w + x + xx;
              if (g.inb(x + xx, y + yy) && g.kinds[j] === K.Floor && g.room[j] !== p.id) {
                near = true;
                break;
              }
            }
          }
          if (!near) chasm[i] = 0;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) if (chasm[i] && g.kinds[i] === K.Void) g.kinds[i] = K.Chasm;
}

// ---------------------------------------------------------------------------

function decorate(ctx: DecorCtx, accent: number): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];
  const nearChasm = (x: number, y: number): boolean => {
    for (const [dx, dy] of NEI8) if (g.kind(x + dx, y + dy) === K.Chasm) return true;
    return false;
  };
  const crystal = (x: number, y: number): boolean => {
    const ok = props.place('crystal', x, y, rng.int(0, 3), true);
    if (ok) props.tint.set(g.idx(x, y), rng.chance(0.25) ? (accent === 0x55d8ff ? 0xa070ff : 0x55d8ff) : accent);
    return ok;
  };

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const rimCells = (): number[] => cells.filter((i) => props.free(...at(i)) && nearChasm(...at(i)));
    const count = r.role === 'boss' ? rng.int(7, 10) : r.role === 'combat' ? rng.int(3, 5) : rng.int(2, 3);
    let placed = 0;
    for (let c = 0; c < count * 2 && placed < count; c++) {
      const rim = rimCells();
      if (!rim.length) break;
      const [sx, sy] = at(rng.pick(rim));
      if (crystal(sx, sy)) placed++;
      for (const [dx, dy] of rng.shuffle([...NEI8]).slice(0, rng.int(0, 2))) {
        if (placed >= count) break;
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && nearChasm(x, y) && crystal(x, y)) placed++;
      }
    }

    // Ruined colonnade: two staggered rows of broken pillars through the middle.
    if (r.role === 'boss' || (r.role === 'combat' && rng.chance(0.6))) {
      const inner = cells.filter((i) => (edge[i] as number) >= 3);
      if (inner.length) {
        const [px, py] = at(rng.pick(inner));
        const alongX = rng.chance(0.5);
        const len = r.role === 'boss' ? 3 : 2;
        for (let k = -len; k <= len; k++) {
          if (k === 0 && r.role !== 'boss') continue;
          for (const off of [-2, 2]) {
            if ((k + (off > 0 ? 1 : 0)) % 2 !== 0) continue;
            const x = alongX ? px + k * 2 : px + off;
            const y = alongX ? py + off : py + k * 2;
            if (g.inb(x, y) && (edge[g.idx(x, y)] as number) >= 2) props.place('broken_pillar', x, y, rng.int(0, 3), true);
          }
        }
      }
    }

    // Chains dangle over the edge, rubble and bones lie about.
    const rim = rimCells();
    rng.shuffle(rim);
    for (let k = 0; k < Math.min(rim.length, rng.int(2, 4)); k++) props.place('chain', ...at(rim[k] as number), rng.int(0, 3), false);
    for (let k = 0; k < 3; k++) {
      const spot = cells.filter((i) => props.free(...at(i)));
      if (!spot.length) break;
      props.place(rng.chance(0.5) ? 'rubble' : 'bones', ...at(rng.pick(spot)), rng.int(0, 3), false);
    }
  }
  // Chains and rubble on the bridges.
  const strip: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor) strip.push(i);
  rng.shuffle(strip);
  for (let k = 0; k < Math.min(strip.length, 5); k++) props.place(k < 3 ? 'chain' : 'rubble', ...at(strip[k] as number), rng.int(0, 3), false);
}

/** Carve a 3x3 rest platform on the middle of a long bridge strip, if the surroundings are clear. */
function carveLanding(g: Grid, bridge: BridgeLog): boolean {
  const strip = bridge.lane;
  const mid = strip[strip.length >> 1] as [number, number];
  // Both lanes of a two-cell bridge are the bridge's own.
  const own = new Set(bridge.cells.map(([x, y]) => g.idx(x, y)));
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = mid[0] + dx;
      const y = mid[1] + dy;
      if (!g.inb(x, y)) return false;
      const i = g.idx(x, y);
      if (g.kinds[i] === K.Floor && !own.has(i) && g.room[i] !== -1) return false;
      // Another bridge running alongside would merge with the landing.
      if (g.kinds[i] === K.Floor && !own.has(i)) return false;
    }
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g.floor(mid[0] + dx, mid[1] + dy, 0, -1);
  return true;
}

import type { FloorPlan, GridPos, NavGrid, ReachableCell } from '../core/types';
import { CellKind, MAX_STEP_UP } from '../core/types';
import { lineOfSight } from './sight';
import { PROP_OBSTACLE } from './obstacles';

/** 0 = blocked, 1 = normal, 2 = water. Blocking props make a cell blocked. */
export function buildCost(plan: FloorPlan): Uint8Array {
  const n = plan.width * plan.height;
  const cost = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = plan.kinds[i];
    cost[i] = k === CellKind.Floor || k === CellKind.Door ? 1 : k === CellKind.Water ? 2 : 0;
  }
  for (const p of plan.props) {
    if (p.blocking && p.pos.x >= 0 && p.pos.y >= 0 && p.pos.x < plan.width && p.pos.y < plan.height) {
      cost[p.pos.y * plan.width + p.pos.x] = 0;
    }
  }
  return cost;
}

/** Cost of stepping from cell fi to adjacent cell ti, or 0 if illegal (index-based, allocation-free). */
function stepCostIdx(
  cost: Uint8Array,
  elev: Int8Array,
  w: number,
  fi: number,
  ti: number,
  dx: number,
  dy: number,
): number {
  const c = cost[ti] as number;
  if (c === 0 || cost[fi] === 0) return 0;
  const de = (elev[ti] as number) - (elev[fi] as number);
  if (de > MAX_STEP_UP || de < -MAX_STEP_UP) return 0;
  if (dx !== 0 && dy !== 0) {
    if (cost[fi + dx] === 0 || cost[fi + dy * w] === 0) return 0;
  }
  return c;
}

/** Flood over legal steps from `from` (used by validation and prop repair). 1 = reachable. */
export function floodReach(plan: FloorPlan, from: GridPos, cost?: Uint8Array): Uint8Array {
  const { width: w, height: h } = plan;
  const c = cost ?? buildCost(plan);
  const seen = new Uint8Array(w * h);
  const start = from.y * w + from.x;
  if (!c[start]) return seen;
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  queue[qt++] = start;
  seen[start] = 1;
  while (qh < qt) {
    const i = queue[qh++] as number;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j]) continue;
        if (stepCostIdx(c, plan.elevation, w, i, j, dx, dy) === 0) continue;
        seen[j] = 1;
        queue[qt++] = j;
      }
    }
  }
  return seen;
}

/** Binary min-heap of (key, index) pairs in preallocated typed arrays. */
class Heap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  clear(): void {
    this.size = 0;
  }
  push(key: number, val: number): void {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2);
      nk.set(this.keys);
      const nv = new Int32Array(this.vals.length * 2);
      nv.set(this.vals);
      this.keys = nk;
      this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= key) break;
      this.keys[i] = this.keys[p] as number;
      this.vals[i] = this.vals[p] as number;
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }
  /** Removes the minimum; read it via `topKey` / return value. */
  pop(): number {
    const top = this.vals[0] as number;
    const key = this.keys[--this.size] as number;
    const val = this.vals[this.size] as number;
    let i = 0;
    const n = this.size;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && (this.keys[c + 1] as number) < (this.keys[c] as number)) c++;
      if ((this.keys[c] as number) >= key) break;
      this.keys[i] = this.keys[c] as number;
      this.vals[i] = this.vals[c] as number;
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

export function createNavGrid(plan: FloorPlan): NavGrid {
  const w = plan.width;
  const h = plan.height;
  const n = w * h;
  const cost = buildCost(plan);
  const elev = plan.elevation;
  const kinds = plan.kinds;
  const chasmHazard = plan.chasmHazard ?? 'fall';
  const waterHazard = plan.waterHazard ?? 'water';

  // Hazardous blocking props by cell (0 none, 1 fire, 2 spikes), built on first use.
  let obstacle: Uint8Array | null = null;

  // Scratch buffers reused across queries so hover-time pathing does not allocate.
  const g = new Float32Array(n);
  const stamp = new Int32Array(n);
  const closed = new Int32Array(n);
  const parent = new Int32Array(n);
  let gen = 0;
  const heap = new Heap(Math.max(256, n));

  const inb = (p: GridPos): boolean => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const blocksSight = (i: number): boolean => kinds[i] === CellKind.Wall || kinds[i] === CellKind.Void;

  // Cells that stop an attack's path for cover: walls, rock and blocking props (props never stop
  // sight). Built on the first cover query, so grids made only for pathing do not pay for it.
  let solid: Uint8Array | null = null;
  const isSolid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    if (solid === null) {
      solid = new Uint8Array(n);
      for (let i = 0; i < n; i++) solid[i] = kinds[i] === CellKind.Wall || kinds[i] === CellKind.Void ? 1 : 0;
      for (const p of plan.props) {
        if (p.blocking && p.pos.x >= 0 && p.pos.y >= 0 && p.pos.x < w && p.pos.y < h) solid[p.pos.y * w + p.pos.x] = 1;
      }
    }
    return solid[y * w + x] === 1;
  };

  /**
   * Walks the segment from the centre of cell (cx, cy) to the point (bx, by), given in tenths of a
   * cell (the centre of cell (x, y) is (10x, 10y)) and ending inside cell (ex, ey). Returns 0 if
   * nothing solid lies between, 1 if something does, 2 if it only squeezes past a corner where
   * exactly one of the two cells meeting there is solid. Integer arithmetic, no allocation.
   */
  function trace(cx: number, cy: number, bx: number, by: number, ex: number, ey: number): number {
    const dx = bx - cx * 10;
    const dy = by - cy * 10;
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    let x = cx;
    let y = cy;
    let nx = 5; // tenths from the start to the next vertical cell boundary
    let ny = 5;
    let result = 0;
    for (let guard = w + h + 4; (x !== ex || y !== ey) && guard > 0; guard--) {
      let stepX: boolean;
      let stepY: boolean;
      if (adx === 0) {
        stepX = false;
        stepY = true;
      } else if (ady === 0) {
        stepX = true;
        stepY = false;
      } else {
        const c = nx * ady - ny * adx;
        stepX = c <= 0;
        stepY = c >= 0;
      }
      if (stepX && stepY) {
        const sa = isSolid(x + sx, y);
        const sb = isSolid(x, y + sy);
        if (sa && sb) return 1;
        if (sa || sb) result = 2;
      }
      if (stepX) {
        x += sx;
        nx += 10;
      }
      if (stepY) {
        y += sy;
        ny += 10;
      }
      if ((x !== ex || y !== ey) && isSolid(x, y)) return 1;
    }
    return result;
  }

  function coverBetween(a: GridPos, t: GridPos): 0 | 2 | 5 {
    if (!inb(a) || !inb(t) || (a.x === t.x && a.y === t.y)) return 0;
    if (!hasLineOfSight(a, t)) return 0;
    const centre = trace(a.x, a.y, t.x * 10, t.y * 10, t.x, t.y);
    let blocked = 0;
    for (let k = 0; k < 4; k++) {
      const bx = t.x * 10 + (k & 1 ? 4 : -4);
      const by = t.y * 10 + (k & 2 ? 4 : -4);
      if (trace(a.x, a.y, bx, by, t.x, t.y) === 1) blocked++;
    }
    if (blocked >= 3) return 5;
    if (blocked >= 1 || centre !== 0) return 2;
    return 0;
  }

  function stepCost(from: GridPos, to: GridPos): number {
    if (!inb(from) || !inb(to)) return Infinity;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if ((dx === 0 && dy === 0) || dx > 1 || dx < -1 || dy > 1 || dy < -1) return Infinity;
    const c = stepCostIdx(cost, elev, w, from.y * w + from.x, to.y * w + to.x, dx, dy);
    return c === 0 ? Infinity : c;
  }

  function hasLineOfSight(a: GridPos, b: GridPos): boolean {
    if (!inb(a) || !inb(b)) return false;
    return lineOfSight(kinds, w, a.x, a.y, b.x, b.y);
  }

  function findPath(
    from: GridPos,
    to: GridPos,
    opts?: { blocked?: (p: GridPos) => boolean; maxCost?: number },
  ): GridPos[] | null {
    if (!inb(from) || !inb(to)) return null;
    const s = from.y * w + from.x;
    const t = to.y * w + to.x;
    if (!cost[s] || !cost[t]) return null;
    if (s === t) return [];
    const blocked = opts?.blocked;
    const maxCost = opts?.maxCost ?? Infinity;
    if (blocked && blocked({ x: to.x, y: to.y })) return null;
    gen++;
    heap.clear();
    stamp[s] = gen;
    g[s] = 0;
    parent[s] = -1;
    heap.push(hCost(s, t), s);
    let found = false;
    while (heap.size > 0) {
      const i = heap.pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      if (i === t) {
        found = true;
        break;
      }
      const x = i % w;
      const y = (i / w) | 0;
      const gi = g[i] as number;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (closed[j] === gen) continue;
          const sc = stepCostIdx(cost, elev, w, i, j, dx, dy);
          if (sc === 0) continue;
          const ng = gi + sc;
          if (ng > maxCost) continue;
          if (stamp[j] === gen && (g[j] as number) <= ng) continue;
          if (blocked && blocked({ x: nx, y: ny })) continue;
          stamp[j] = gen;
          g[j] = ng;
          parent[j] = i;
          heap.push(hCost(j, t, ng), j);
        }
      }
    }
    if (!found) return null;
    const path: GridPos[] = [];
    for (let i = t; i !== s; i = parent[i] as number) path.push({ x: i % w, y: (i / w) | 0 });
    path.reverse();
    return path;
  }

  /** A* key: f scaled so ties break toward cells closer to the goal (straighter paths). */
  function hCost(i: number, t: number, gv = 0): number {
    const dx = Math.abs((i % w) - (t % w));
    const dy = Math.abs(((i / w) | 0) - ((t / w) | 0));
    const hh = dx > dy ? dx : dy;
    return (gv + hh) * 128 + hh;
  }

  function reachable(
    from: GridPos,
    budget: number,
    opts?: { blocked?: (p: GridPos) => boolean },
  ): ReachableCell[] {
    const out: ReachableCell[] = [];
    if (!inb(from)) return out;
    const s = from.y * w + from.x;
    if (!cost[s]) return out;
    const blocked = opts?.blocked;
    gen++;
    heap.clear();
    stamp[s] = gen;
    g[s] = 0;
    heap.push(0, s);
    while (heap.size > 0) {
      const i = heap.pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      const gi = g[i] as number;
      out.push({ pos: { x: i % w, y: (i / w) | 0 }, cost: gi });
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (closed[j] === gen) continue;
          const sc = stepCostIdx(cost, elev, w, i, j, dx, dy);
          if (sc === 0) continue;
          const ng = gi + sc;
          if (ng > budget) continue;
          if (stamp[j] === gen && (g[j] as number) <= ng) continue;
          if (blocked && blocked({ x: nx, y: ny })) continue;
          stamp[j] = gen;
          g[j] = ng;
          heap.push(ng, j);
        }
      }
    }
    return out;
  }

  return {
    width: w,
    height: h,
    inBounds: inb,
    isWalkable: (p) => inb(p) && (cost[p.y * w + p.x] as number) !== 0,
    stepCost,
    hasLineOfSight,
    elevationAt: (p) => (inb(p) ? (elev[p.y * w + p.x] as number) : 0),
    hazardAt: (p) => {
      if (!inb(p)) return 'none';
      const k = kinds[p.y * w + p.x];
      if (k === CellKind.Chasm) return chasmHazard;
      if (k === CellKind.Water) return waterHazard;
      return 'none';
    },
    coverBetween,
    obstacleAt: (p) => {
      if (!inb(p)) return 'none';
      if (obstacle === null) {
        obstacle = new Uint8Array(n);
        for (const q of plan.props) {
          const k = q.blocking ? PROP_OBSTACLE[q.type] : undefined;
          if (k && q.pos.x >= 0 && q.pos.y >= 0 && q.pos.x < w && q.pos.y < h) obstacle[q.pos.y * w + q.pos.x] = k === 'fire' ? 1 : 2;
        }
      }
      const o = obstacle[p.y * w + p.x];
      return o === 1 ? 'fire' : o === 2 ? 'spikes' : 'none';
    },
    findPath,
    reachable,
  };
}

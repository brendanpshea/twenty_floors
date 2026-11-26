import type { FloorPlan, GridPos, NavGrid, ReachableCell } from '../core/types';
import { CellKind, MAX_STEP_UP } from '../core/types';

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

  // Scratch buffers reused across queries so hover-time pathing does not allocate.
  const g = new Float32Array(n);
  const stamp = new Int32Array(n);
  const closed = new Int32Array(n);
  const parent = new Int32Array(n);
  let gen = 0;
  const heap = new Heap(Math.max(256, n));

  const inb = (p: GridPos): boolean => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const blocksSight = (i: number): boolean => kinds[i] === CellKind.Wall || kinds[i] === CellKind.Void;

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
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    // Canonical endpoint order makes the test symmetric.
    if (ay * w + ax > by * w + bx) {
      [ax, bx] = [bx, ax];
      [ay, by] = [by, ay];
    }
    if (blocksSight(ay * w + ax) || blocksSight(by * w + bx)) return false;
    const nx = Math.abs(bx - ax);
    const ny = Math.abs(by - ay);
    const sx = bx > ax ? 1 : -1;
    const sy = by > ay ? 1 : -1;
    let x = ax;
    let y = ay;
    let ix = 0;
    let iy = 0;
    while (ix < nx || iy < ny) {
      const d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
      if (d === 0) {
        // Exactly through a corner: blocked only if both side cells block.
        if (blocksSight(y * w + x + sx) && blocksSight((y + sy) * w + x)) return false;
        x += sx;
        y += sy;
        ix++;
        iy++;
      } else if (d < 0) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      if ((x !== bx || y !== by) && blocksSight(y * w + x)) return false;
    }
    return true;
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
    findPath,
    reachable,
  };
}

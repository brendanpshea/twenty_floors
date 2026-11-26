import type { GridPos, NavGrid, ReachableCell } from '../../core/types';
import { MAX_STEP_UP } from '../../core/types';

export interface OpenRoomOptions {
  /** Solid cells (block movement and sight). */
  walls?: GridPos[];
  /** Cells that block movement but not sight. */
  chasms?: GridPos[];
  elevation?: (p: GridPos) => number;
}

/** A tiny rectangular NavGrid for tests and the balance simulation. The real one lives in src/gen. */
export function createOpenRoomNav(width: number, height: number, opts: OpenRoomOptions = {}): NavGrid {
  const walls = new Set((opts.walls ?? []).map((p) => p.y * width + p.x));
  const chasms = new Set((opts.chasms ?? []).map((p) => p.y * width + p.x));
  const key = (p: GridPos): number => p.y * width + p.x;
  const inBounds = (p: GridPos): boolean => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const isWalkable = (p: GridPos): boolean => inBounds(p) && !walls.has(key(p)) && !chasms.has(key(p));
  const elevationAt = (p: GridPos): number => opts.elevation?.(p) ?? 0;

  const stepCost = (from: GridPos, to: GridPos): number => {
    if (!isWalkable(from) || !isWalkable(to)) return Infinity;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return Infinity;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable({ x: from.x + dx, y: from.y }) || !isWalkable({ x: from.x, y: from.y + dy })) return Infinity;
    }
    if (Math.abs(elevationAt(to) - elevationAt(from)) > MAX_STEP_UP) return Infinity;
    return 1;
  };

  const hasLineOfSight = (a: GridPos, b: GridPos): boolean => {
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx - dy;
    while (x !== b.x || y !== b.y) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if ((x !== b.x || y !== b.y) && (!inBounds({ x, y }) || walls.has(y * width + x))) return false;
    }
    return true;
  };

  const neighbors = (p: GridPos): GridPos[] => {
    const out: GridPos[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        out.push({ x: p.x + dx, y: p.y + dy });
      }
    }
    return out;
  };

  /** Dijkstra from `from`; returns cost and parent maps. */
  const search = (
    from: GridPos,
    budget: number,
    blocked: ((p: GridPos) => boolean) | undefined,
    goal?: GridPos,
  ): { cost: Map<number, number>; parent: Map<number, number> } => {
    const cost = new Map<number, number>([[key(from), 0]]);
    const parent = new Map<number, number>();
    const open: { k: number; c: number }[] = [{ k: key(from), c: 0 }];
    while (open.length > 0) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((open[i] as { c: number }).c < (open[bi] as { c: number }).c) bi = i;
      const cur = open.splice(bi, 1)[0] as { k: number; c: number };
      if (cur.c > (cost.get(cur.k) ?? Infinity)) continue;
      if (goal && cur.k === key(goal)) break;
      const p = { x: cur.k % width, y: Math.floor(cur.k / width) };
      for (const n of neighbors(p)) {
        const sc = stepCost(p, n);
        if (!Number.isFinite(sc) || (blocked && blocked(n))) continue;
        const nc = cur.c + sc;
        if (nc > budget || nc >= (cost.get(key(n)) ?? Infinity)) continue;
        cost.set(key(n), nc);
        parent.set(key(n), cur.k);
        open.push({ k: key(n), c: nc });
      }
    }
    return { cost, parent };
  };

  return {
    width,
    height,
    inBounds,
    isWalkable,
    stepCost,
    hasLineOfSight,
    elevationAt,
    findPath(from, to, o) {
      const { cost, parent } = search(from, o?.maxCost ?? Infinity, o?.blocked, to);
      if (!cost.has(key(to))) return null;
      const path: GridPos[] = [];
      let k = key(to);
      while (k !== key(from)) {
        path.push({ x: k % width, y: Math.floor(k / width) });
        k = parent.get(k) as number;
      }
      return path.reverse();
    },
    reachable(from, budget, o): ReachableCell[] {
      const { cost } = search(from, budget, o?.blocked);
      return [...cost.entries()].map(([k, c]) => ({ pos: { x: k % width, y: Math.floor(k / width) }, cost: c }));
    },
  };
}

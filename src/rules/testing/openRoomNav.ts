import type { GridPos, NavGrid, ReachableCell } from '../../core/types';
import { MAX_STEP_UP } from '../../core/types';
import { cellsBetween } from '../terrain';

export interface OpenRoomOptions {
  /** Solid cells (block movement and sight). */
  walls?: GridPos[];
  /** Cells that block movement but not sight. */
  chasms?: GridPos[];
  elevation?: (p: GridPos) => number;
  /** Cells of lava: like chasms they block movement and not sight, and a creature forced into one burns. */
  lava?: GridPos[];
  /** Walkable ice cells (hazard 'ice'): a pushed creature landing on one slides a cell further. */
  ice?: GridPos[];
  /** Walkable shallow water cells (hazard 'water', difficult terrain: entering costs 2). */
  water?: GridPos[];
  /** Cells of fire (a brazier): not walkable; a creature pushed against one is slammed for fire damage. */
  fire?: GridPos[];
  /** Cells of spikes (stalagmites): not walkable; a creature pushed against one is slammed for piercing damage. */
  spikes?: GridPos[];
  /** Blocking props (not walkable, sight passes): half cover (+2) for a target behind one. */
  props?: GridPos[];
  /** Overrides the computed cover entirely (props and this are the only sources of cover in the arena). */
  cover?: (attacker: GridPos, target: GridPos) => 0 | 2 | 5;
}

/** A tiny rectangular NavGrid for tests and the balance simulation. The real one lives in src/gen. */
export function createOpenRoomNav(width: number, height: number, opts: OpenRoomOptions = {}): NavGrid {
  const walls = new Set((opts.walls ?? []).map((p) => p.y * width + p.x));
  const chasms = new Set((opts.chasms ?? []).map((p) => p.y * width + p.x));
  const lava = new Set((opts.lava ?? []).map((p) => p.y * width + p.x));
  const ice = new Set((opts.ice ?? []).map((p) => p.y * width + p.x));
  const water = new Set((opts.water ?? []).map((p) => p.y * width + p.x));
  const fire = new Set((opts.fire ?? []).map((p) => p.y * width + p.x));
  const spikes = new Set((opts.spikes ?? []).map((p) => p.y * width + p.x));
  const props = new Set((opts.props ?? []).map((p) => p.y * width + p.x));
  const key = (p: GridPos): number => p.y * width + p.x;
  const inBounds = (p: GridPos): boolean => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const isWalkable = (p: GridPos): boolean => inBounds(p) && !walls.has(key(p)) && !chasms.has(key(p)) && !lava.has(key(p)) && !props.has(key(p)) && !fire.has(key(p)) && !spikes.has(key(p));
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
    return water.has(key(to)) ? 2 : 1;
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
    hazardAt: (p) => {
      if (!inBounds(p)) return 'none';
      const k = key(p);
      if (chasms.has(k)) return 'fall';
      if (lava.has(k)) return 'lava';
      if (ice.has(k)) return 'ice';
      if (water.has(k)) return 'water';
      return 'none';
    },
    obstacleAt: (p) => (inBounds(p) ? (fire.has(key(p)) ? 'fire' : spikes.has(key(p)) ? 'spikes' : 'none') : 'none'),
    coverBetween: (a, b) => {
      if (opts.cover) return opts.cover(a, b);
      return cellsBetween(a, b).some((p) => props.has(key(p))) ? 2 : 0;
    },
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

import type { Rng } from '../core/rng';
import type { FloorPlan, GridPos, NavGrid, ThemeId } from '../core/types';
import { CellKind } from '../core/types';
import { GenFail, Grid, K, NEI8 } from './grid';
import type { PropLayer, RoomInfo } from './layout';
import { buildCost, createNavGrid, floodReach } from './nav';
import { refreshWalls } from './walls';

/** Warm haven light placed on every rest spot. */
/** Failure counters for tuning (not part of the API). */
export const restDebug: Record<string, number> = {};
const bump = (k: string): void => {
  restDebug[k] = (restDebug[k] ?? 0) + 1;
};

export const REST_LIGHT = { color: 0xffb060, intensity: 1.6, radius: 6.5 };

const FIGHT_RANGE = 7;
const MIN_SLOT_DISTANCE = 5;

/**
 * Cell-level rule for a rest spot (see FloorPlan.restSpots): a prop-free Floor cell with at
 * least two walkable neighbours, outside combat/boss rooms, at least 5 walking cells from
 * every monster slot and never within 7 walking cells *with line of sight* of one.
 */
export function restCellProblem(plan: FloorPlan, nav: NavGrid, c: GridPos): string | null {
  const w = plan.width;
  if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= plan.height) return 'out of bounds';
  const i = c.y * w + c.x;
  if (plan.kinds[i] !== CellKind.Floor) return 'not a plain floor cell';
  if (plan.props.some((p) => p.pos.x === c.x && p.pos.y === c.y)) return 'has a prop';
  if (plan.spawns.some((s) => s.pos.x === c.x && s.pos.y === c.y)) return 'on a spawn slot';
  if ((c.x === plan.entrance.x && c.y === plan.entrance.y) || (c.x === plan.exit.x && c.y === plan.exit.y)) return 'on entrance/exit';
  const id = plan.roomIds[i] as number;
  if (id >= 0) {
    const role = plan.rooms[id]?.role;
    if (role !== 'entrance' && role !== 'treasure') return `inside a ${role} room`;
  }
  let open = 0;
  for (const [dx, dy] of NEI8) if (nav.isWalkable({ x: c.x + dx, y: c.y + dy })) open++;
  if (open < 2) return 'fewer than 2 walkable neighbours';
  const cost = new Map<number, number>();
  for (const r of nav.reachable(c, FIGHT_RANGE)) cost.set(r.pos.y * w + r.pos.x, r.cost);
  for (const s of plan.spawns) {
    if (s.role === 'chest') continue;
    const d = cost.get(s.pos.y * w + s.pos.x);
    if (d === undefined) continue;
    if (d < MIN_SLOT_DISTANCE) return `only ${d} cells from a monster slot`;
    if (nav.hasLineOfSight(c, s.pos)) return `within ${d} cells and sight of a monster slot`;
  }
  return null;
}

/** All rest-spot rules for a finished plan (cells, order, reachability, no blocking). */
export function restSetProblems(plan: FloorPlan): string[] {
  const errs: string[] = [];
  const w = plan.width;
  const spots = plan.restSpots;
  if (!Array.isArray(spots) || spots.length !== 2) return [`need exactly 2 rest spots, found ${spots?.length}`];
  const nav = createNavGrid(plan);
  spots.forEach((s, k) => {
    const p = restCellProblem(plan, nav, s);
    if (p) errs.push(`rest spot ${k} (${s.x},${s.y}): ${p}`);
  });
  const [a, b] = spots as [GridPos, GridPos];
  if (a.x === b.x && a.y === b.y) errs.push('rest spots coincide');
  if (errs.length) return errs;
  // Order along the route.
  const dist = new Map<number, number>();
  for (const r of nav.reachable(plan.entrance, Infinity)) dist.set(r.pos.y * w + r.pos.x, r.cost);
  const nearest = (s: GridPos): number => {
    let best = Infinity;
    for (const [dx, dy] of NEI8) {
      const d = dist.get((s.y + dy) * w + s.x + dx);
      if (d !== undefined) best = Math.min(best, d);
    }
    return best;
  };
  if (!(nearest(a) < nearest(b))) errs.push('rest spots are not in route order');
  // Reachable without entering the boss room.
  const boss = plan.rooms.find((r) => r.role === 'boss');
  const noBoss = buildCost(plan);
  if (boss) for (let i = 0; i < noBoss.length; i++) if (plan.roomIds[i] === boss.id) noBoss[i] = 0;
  const reach = floodReach(plan, plan.entrance, noBoss);
  for (const s of spots) {
    const ok = reach[s.y * w + s.x] === 1 || NEI8.some(([dx, dy]) => reach[(s.y + dy) * w + s.x + dx] === 1);
    if (!ok) errs.push(`rest spot ${s.x},${s.y} not reachable without entering the boss room`);
  }
  // The rest entity occupies its cell: nothing may depend on walking through it.
  if (!restKeepsConnectivity(plan, spots)) errs.push('rest spots block a path');
  return errs;
}

function restKeepsConnectivity(plan: FloorPlan, spots: GridPos[]): boolean {
  const w = plan.width;
  const cost = buildCost(plan);
  for (const s of spots) cost[s.y * w + s.x] = 0;
  const reach = floodReach(plan, plan.entrance, cost);
  const targets: GridPos[] = [plan.exit, ...plan.rooms.map((r) => r.center), ...plan.spawns.map((s) => s.pos)];
  return targets.every((t) => reach[t.y * w + t.x] === 1);
}

// ---------------------------------------------------------------------------
// Placement

interface Run {
  cells: number[];
}

export interface RestResult {
  /** 0 = purpose-built nook on the intended passage, 1 = nook elsewhere on the route, 2 = existing passage cell, 3 = any quiet cell. */
  tiers: number[];
  nooks: Array<{ cells: number[]; rest: number }>;
  /** The shortest route from entrance to boss (cell indices), used to light the main path. */
  path: number[];
}

/**
 * Pick two rest spots. The intended site is a small alcove (2x2 or 3x2) carved off a passage
 * (tunnel, corridor, bridge landing) midway along the main route and on the approach to the
 * boss. Carving converts Void/Wall/Chasm cells into Floor and re-derives the walls. Each
 * candidate is checked against the same rules `validateFloor` enforces and rolled back if it
 * fails. Less ideal placements are used only when no nook fits (reported in `tiers`).
 */
export function placeRestSpots(g: Grid, plan: FloorPlan, props: PropLayer, infos: RoomInfo[], rng: Rng): RestResult {
  const w = g.w;
  const boss = infos.find((r) => r.role === 'boss') as RoomInfo;
  const nav0 = createNavGrid(plan);
  const path = nav0.findPath(plan.entrance, boss.center);
  if (!path) throw new GenFail('no route to boss');
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (const c of path) {
    const i = c.y * w + c.x;
    if (g.room[i] === -1) {
      if (!cur) {
        cur = { cells: [] };
        runs.push(cur);
      }
      cur.cells.push(i);
    } else cur = null;
  }
  if (runs.length === 0) throw new GenFail('route has no passages');
  const lastRun = runs.length - 1;
  const firstRun = runs.length >= 3 ? Math.min(lastRun - 1, Math.max(1, Math.floor(runs.length / 2))) : 0;
  const result: RestResult = { tiers: [], nooks: [], path: path.map((c) => c.y * w + c.x) };
  const spots: GridPos[] = [];
  const blockedSpots = (): Set<number> => new Set(spots.map((s) => s.y * w + s.x));

  const spotDist: number[] = [];
  let lastD = 0;
  const distMap = new Map<number, number>();
  for (const r of nav0.reachable(plan.entrance, Infinity)) distMap.set(r.pos.y * w + r.pos.x, r.cost);
  const bossDist = distMap.get(boss.center.y * w + boss.center.x) ?? 1;
  const checkCell = (cell: number, ref: number): boolean => {
    const c = { x: cell % w, y: (cell / w) | 0 };
    // Route order: the first spot well before the boss, the second clearly after the first.
    const d = distMap.get(ref);
    if (d === undefined) {
      bump('ref unreachable');
      return false;
    }
    lastD = d;
    if (spots.length === 0 ? d > bossDist * 0.8 || d < 4 : d < (spotDist[0] ?? 0) + 6 || d > bossDist) {
      bump(spots.length === 0 ? 'order0' : 'order1');
      return false;
    }
    const nav = createNavGrid(plan);
    const prob = restCellProblem(plan, nav, c);
    if (prob) {
      bump(prob.replace(/\d+/g, 'N'));
      return false;
    }
    // Placing it (and the earlier spot) must not cut the floor.
    const cost = buildCost(plan);
    for (const i of blockedSpots()) cost[i] = 0;
    cost[cell] = 0;
    const reach = floodReach(plan, plan.entrance, cost);
    const targets: GridPos[] = [plan.exit, ...infos.map((r) => r.center), ...plan.spawns.map((s) => s.pos)];
    const okc = targets.every((t) => reach[t.y * w + t.x] === 1);
    if (!okc) bump('blocks path');
    return okc;
  };

  let carves = 0;
  const tryNook = (face: number, dx: number, dy: number, width: number, start: number, tier: number): boolean => {
    const px = face % w;
    const py = (face / w) | 0;
    const lx = -dy;
    const ly = dx;
    const cells: number[] = [];
    for (let a = 0; a < width; a++) {
      for (let t = 1; t <= 2; t++) {
        const x = px + dx * t + lx * (start + a);
        const y = py + dy * t + ly * (start + a);
        if (x < 3 || y < 3 || x > g.w - 4 || y > g.h - 4) return false;
        const k = g.kinds[y * w + x] as number;
        if (k !== K.Void && k !== K.Wall && k !== K.Chasm) return false;
        cells.push(y * w + x);
      }
    }
    const inNook = new Set(cells);
    // Ring: nothing walkable may touch the nook except the passage row it opens onto.
    for (let a = -1; a <= width; a++) {
      for (let t = 0; t <= 3; t++) {
        const x = px + dx * t + lx * (start + a);
        const y = py + dy * t + ly * (start + a);
        if (!g.inb(x, y)) return false;
        const i = y * w + x;
        if (inNook.has(i)) continue;
        const walk = g.walkable(x, y);
        if (t === 0) {
          if (walk && g.kinds[i] === K.Door && a >= 0 && a < width) return false;
        } else if (walk) return false;
      }
    }
    // The cell right in front of the opening must be free to step through.
    if (props.occ[face] === 2) return false;

    const x0 = Math.min(...cells.map((c) => c % w)) - 2;
    const x1 = Math.max(...cells.map((c) => c % w)) + 2;
    const y0 = Math.min(...cells.map((c) => (c / w) | 0)) - 2;
    const y1 = Math.max(...cells.map((c) => (c / w) | 0)) + 2;
    carves++;
    const saved = snapshot(g, x0, y0, x1, y1);
    for (const c of cells) {
      const x = c % w;
      const y = (c / w) | 0;
      // Match the passage cell in front of it when there is one, otherwise the opening cell.
      const fx = px + lx * ((x - px) * lx + (y - py) * ly);
      const fy = py + ly * ((x - px) * lx + (y - py) * ly);
      const front = g.walkable(fx, fy) ? (g.elev[fy * w + fx] as number) : (g.elev[face] as number);
      g.kinds[c] = K.Floor;
      g.elev[c] = front;
      g.room[c] = -1;
    }
    refreshWalls(g, x0, y0, x1, y1);
    let ok = true;
    bump('carved');
    // Local elevation sanity.
    for (const c of cells) {
      const x = c % w;
      const y = (c / w) | 0;
      for (const [ex, ey] of NEI8) {
        if (g.walkable(x + ex, y + ey) && Math.abs((g.elev[(y + ey) * w + x + ex] as number) - (g.elev[c] as number)) > 1) ok = false;
      }
    }
    if (!ok) bump('elevation');
    // Rest cell: back row, centre-most.
    const back = cells.filter((c) => {
      const t = (c % w - px) * dx + (((c / w) | 0) - py) * dy;
      return t === 2;
    });
    const rest = back[Math.floor(back.length / 2) - (back.length === 2 && rng.chance(0.5) ? 1 : 0)] as number;
    if (ok && checkCell(rest, face)) {
      spots.push({ x: rest % w, y: (rest / w) | 0 });
      spotDist.push(lastD);
      result.tiers.push(tier);
      result.nooks.push({ cells, rest });
      return true;
    }
    restore(g, saved);
    return false;
  };

  const tryRun = (run: Run, tier: number, budget: number): boolean => {
    const n = run.cells.length;
    const mid = (n - 1) * rng.range(0.35, 0.65);
    const order = run.cells.map((c, k) => ({ c, k })).sort((a, b) => Math.abs(a.k - mid) + rng.next() * 1.5 - (Math.abs(b.k - mid) + rng.next() * 1.5));
    const startCarves = carves;
    for (const { c } of order) {
      if (g.kinds[c] !== K.Floor) continue;
      const dirs = rng.shuffle([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as Array<[number, number]>);
      for (const [dx, dy] of dirs) {
        const options = rng.shuffle([
          [3, -1],
          [3, 0],
          [3, -2],
          [2, 0],
          [2, -1],
        ] as Array<[number, number]>);
        for (const [width, start] of options) {
          if (carves - startCarves >= budget) return false;
          if (tryNook(c, dx, dy, width, start, tier)) return true;
        }
      }
    }
    return false;
  };

  const tryExisting = (cells: number[], tier: number, budget: number): boolean => {
    let tries = 0;
    for (const c of cells) {
      if (g.kinds[c] !== K.Floor || props.occ[c] !== 0 || props.keepFree[c]) continue;
      if (tries++ > budget) return false;
      if (checkCell(c, c)) {
        spots.push({ x: c % w, y: (c / w) | 0 });
        spotDist.push(lastD);
        result.tiers.push(tier);
        return true;
      }
    }
    return false;
  };

  const targets = [firstRun, lastRun];
  const fractions = [0.45, 0.88];
  for (let k = 0; k < 2; k++) {
    const target = runs[targets[k] as number] as Run;
    let ok = tryRun(target, 0, 220);
    if (!ok) {
      // Any other passage on the route, preferring the intended side of the midpoint.
      const others = runs.filter((r, idx) => r !== target && (k === 0 ? idx < lastRun : idx > 0));
      for (const r of others) {
        if (tryRun(r, 1, 120)) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) ok = tryExisting(rng.shuffle(target.cells.slice()), 2, 60);
    if (!ok) {
      const at = path[Math.floor(path.length * (fractions[k] as number))] as GridPos;
      const all: number[] = [];
      for (let i = 0; i < g.w * g.h; i++) if (g.kinds[i] === K.Floor && (g.room[i] === -1 || infos[g.room[i] as number]?.role === 'entrance' || infos[g.room[i] as number]?.role === 'treasure')) all.push(i);
      all.sort((a, b) => Math.max(Math.abs((a % w) - at.x), Math.abs(((a / w) | 0) - at.y)) - Math.max(Math.abs((b % w) - at.x), Math.abs(((b / w) | 0) - at.y)));
      ok = tryExisting(all, 3, 400);
    }
    if (!ok) throw new GenFail('no rest spot site');
  }
  plan.restSpots = spots;
  return result;
}

interface Snapshot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kinds: number[];
  elev: number[];
  room: number[];
}

function snapshot(g: Grid, x0: number, y0: number, x1: number, y1: number): Snapshot {
  const s: Snapshot = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(g.w - 1, x1), y1: Math.min(g.h - 1, y1), kinds: [], elev: [], room: [] };
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = y * g.w + x;
      s.kinds.push(g.kinds[i] as number);
      s.elev.push(g.elev[i] as number);
      s.room.push(g.room[i] as number);
    }
  }
  return s;
}

function restore(g: Grid, s: Snapshot): void {
  let k = 0;
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = y * g.w + x;
      g.kinds[i] = s.kinds[k] as number;
      g.elev[i] = s.elev[k] as number;
      g.room[i] = s.room[k] as number;
      k++;
    }
  }
}

/** Furnish a carved nook: torches on its walls and a themed fire/crystal in a back corner when it is wide enough. */
export function dressNook(g: Grid, props: PropLayer, nook: { cells: number[]; rest: number }, theme: ThemeId, rng: Rng): void {
  const w = g.w;
  const others = nook.cells.filter((c) => c !== nook.rest);
  let torches = 0;
  for (const c of rng.shuffle(others.slice())) {
    if (torches >= 1) break;
    const x = c % w;
    const y = (c / w) | 0;
    const dir = props.wallDir(x, y, rng);
    if (dir >= 0 && props.place('torch', x, y, dir, false)) torches++;
  }
  const deco = theme === 'crypt' || theme === 'sewers' ? 'brazier' : theme === 'warrens' ? 'campfire' : 'crystal';
  const small = theme === 'warrens' ? 'bones' : theme === 'crypt' || theme === 'sewers' ? 'rubble' : 'chain';
  if (nook.cells.length >= 6) {
    // A themed light beside the rest cell (never on it).
    const rx = nook.rest % w;
    const ry = (nook.rest / w) | 0;
    const near = others.slice().sort((a, b) => Math.abs((a % w) - rx) + Math.abs(((a / w) | 0) - ry) - (Math.abs((b % w) - rx) + Math.abs(((b / w) | 0) - ry)));
    for (const c of near) if (props.place(deco, c % w, (c / w) | 0, 0, true)) break;
  } else {
    for (const c of others) if (props.place(small, c % w, (c / w) | 0, rng.int(0, 3), false)) break;
  }
}

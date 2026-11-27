import type { Creature, GridPos, Hazard, NavGrid, Size } from '../core/types';
import { isAlive } from './util';

/**
 * Terrain rules shared by the combat engine and the AIs (so what the AI plans is what the engine does):
 * forced movement into hazards, ice slides, climbing out, cover and the Shove size rule.
 */

/** A hazard that hurts: a creature forced into it falls (bludgeoning) or burns (fire) and climbs back out. */
export type DeadlyHazard = 'fall' | 'lava';

export function isDeadly(h: Hazard): h is DeadlyHazard {
  return h === 'fall' || h === 'lava';
}

const SIZE_RANK: Record<Size, number> = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4 };

/** SRD Unarmed Strike (Shove): only a target no more than one size larger than the shover. */
export function canShoveSize(shover: Size, target: Size): boolean {
  return SIZE_RANK[target] <= SIZE_RANK[shover] + 1;
}

const pos = (p: GridPos): GridPos => ({ x: p.x, y: p.y });

/**
 * EXPERIMENT switches (src/balance/terrainExp): every variant of the rules for "does thinking pay" lives here and the defaults
 * are today's rules. Nothing changes unless a variant is adopted. Mutable so the harness can try them one at a time.
 */
export const TERRAIN_TUNING = {
  /** A creature that falls into a pit or lava is out of the fight (untargetable, no turn) and climbs out, Prone, at the end of its next turn. */
  fallsTakeTurn: false,
  /** d6 per floor depth for a fall or lava (1 today) and for a slam against fire or spikes (0.5 today: one per two depths). */
  fallDicePerDepth: 1,
  slamDicePerDepth: 0.5,
  /** The target of a shove has disadvantage on its save when an ally of the shover is next to it or it is Prone. */
  shoveHelpAdvantage: false,
  /** The hero's Shove is a bonus action (once per turn) instead of replacing an attack. */
  shoveBonusAction: false,
  /** A minion (role 'minion' or CR below a quarter of the depth) pushed into a fall or lava is simply removed. */
  minionsDieInFall: false,
  /** Cover bonuses to AC and Dexterity saves (2 and 5 in the SRD) and the bonus to hit from 2+ elevation steps above (1 today). */
  coverHalf: 2,
  coverThreeQuarters: 5,
  heightBonus: 1,
  /** A melee attacker has advantage when an ally of its side stands directly opposite the target (2014 optional rule). */
  flanking: false,
};

/** Dice of a fall or lava for a floor depth. */
export function fallDice(depth: number): number {
  return Math.max(1, Math.ceil(depth * TERRAIN_TUNING.fallDicePerDepth));
}

/** An obstacle that hurts a creature thrown against it: fire (a brazier, a forge) or spikes (stalagmites, a palisade). */
export type ObstacleKind = 'fire' | 'spikes';

/** The obstacle in a cell ('none' when the nav grid has no `obstacleAt`). */
export function obstacleOf(nav: NavGrid, p: GridPos): ObstacleKind | null {
  const o = nav.obstacleAt?.(p);
  return o === 'fire' || o === 'spikes' ? o : null;
}

/**
 * HOUSE RULE: a creature slammed into an obstacle takes 1d6 per TWO floor depths (minimum 1d6): fire or piercing damage.
 * Returns the dice count (1 on floors 1 and 2, 2 on floors 3 and 4, ... 10 on floors 19 and 20).
 */
export function slamDice(depth: number): number {
  return Math.max(1, Math.ceil(depth * TERRAIN_TUNING.slamDicePerDepth));
}

/** A cell that is neither walkable nor a pit: a wall, solid prop or out of bounds. */
function solid(nav: NavGrid, p: GridPos): boolean {
  return !nav.inBounds(p) || (!nav.isWalkable(p) && !isDeadly(nav.hazardAt(p)) && obstacleOf(nav, p) === null);
}

/** A diagonal step may not cut a solid corner. */
function cornerOk(nav: NavGrid, from: GridPos, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return true;
  return !solid(nav, { x: from.x + dx, y: from.y }) && !solid(nav, { x: from.x, y: from.y + dy });
}

export interface PushPlan {
  /** Cells the creature is moved through, in order (empty when it cannot move). The last is the hazard cell when `hazard` is set. */
  path: GridPos[];
  /** Set when the forced movement ends in a pit or lava. */
  hazard?: { kind: DeadlyHazard; at: GridPos };
  /** True when an ice cell carried it one cell further. */
  slid: boolean;
  /** Set when the movement ends against fire or spikes: the creature stops in the last free cell and takes damage. */
  obstacle?: { kind: ObstacleKind; at: GridPos };
  /** True when the creature ends in a shallow-water cell (HOUSE RULE: knocked Prone). */
  water?: boolean;
}

/**
 * Plan forced movement of up to `cells` cells in direction (dx, dy) from `from`. It stops at walls, creatures and
 * steps that are too steep; it does NOT stop at a drop or lava: the creature goes in. If it ends on 'ice' it slides
 * one more cell the same way when that cell is free (possibly into a hazard). Pure: nothing is moved.
 */
export function planPush(nav: NavGrid, occupied: (p: GridPos) => boolean, from: GridPos, dx: number, dy: number, cells: number, opts: { ignore?: ReadonlySet<string> } = {}): PushPlan {
  const ign = opts.ignore;
  const path: GridPos[] = [];
  let cur = pos(from);
  if (dx === 0 && dy === 0) return { path, slid: false };
  for (let i = 0; i < cells; i++) {
    const next = { x: cur.x + dx, y: cur.y + dy };
    if (!nav.inBounds(next)) break;
    const ob = obstacleOf(nav, next);
    // A creature that ignores a hazard (a flier, Boots, a Ring) is not forced into it: the push stops short, with no damage.
    if ((ob && ign?.has(ob)) || (ign?.has(nav.hazardAt(next)) && (isDeadly(nav.hazardAt(next)) || nav.hazardAt(next) === 'water' && false))) break;
    if (ob && cornerOk(nav, cur, dx, dy) && !occupied(next)) return { path, obstacle: { kind: ob, at: pos(next) }, slid: false, ...(path.length > 0 && nav.hazardAt(cur) === 'water' ? { water: true } : {}) };
    const h = nav.hazardAt(next);
    if (isDeadly(h)) {
      if (!cornerOk(nav, cur, dx, dy) || occupied(next)) break;
      path.push(next);
      return { path, hazard: { kind: h, at: pos(next) }, slid: false };
    }
    if (!nav.isWalkable(next) || occupied(next) || !Number.isFinite(nav.stepCost(cur, next))) break;
    path.push(next);
    cur = next;
  }
  if (path.length > 0 && nav.hazardAt(cur) === 'ice' && !ign?.has('ice')) {
    const next = { x: cur.x + dx, y: cur.y + dy };
    const slideOb = nav.inBounds(next) ? obstacleOf(nav, next) : null;
    if (slideOb && cornerOk(nav, cur, dx, dy) && !occupied(next)) return { path, obstacle: { kind: slideOb, at: pos(next) }, slid: true };
    if (nav.inBounds(next) && !occupied(next)) {
      const h = nav.hazardAt(next);
      if (isDeadly(h)) {
        if (cornerOk(nav, cur, dx, dy)) {
          path.push(next);
          return { path, hazard: { kind: h, at: pos(next) }, slid: true };
        }
      } else if (nav.isWalkable(next) && Number.isFinite(nav.stepCost(cur, next))) {
        path.push(next);
        return { path, slid: true };
      }
    }
  }
  return { path, slid: false, ...(path.length > 0 && nav.hazardAt(path[path.length - 1] as GridPos) === 'water' && !ign?.has('water') ? { water: true } : {}) };
}

/**
 * What a push is worth to the pusher, in expected-damage units: the fall or lava (1d6 per depth), a slam (1d6 per two
 * depths), water's Prone (more with allies next to the target), a kill bonus. `resist` gives the target's damage multiplier
 * (0 for an immune creature: a fire-immune devil gains nothing from lava). Shared by the AIs. 0 when nothing happens.
 */
export function pushValue(plan: PushPlan, depth: number, targetHp: number, alliesAdjacent: number, resist: (type: 'bludgeoning' | 'fire' | 'piercing') => number = () => 1, extras: { minion?: boolean; turnValue?: number } = {}): number {
  const KILL = 20;
  if (plan.hazard) {
    // Experiment variants: a minion is removed outright; a fall that takes the victim's next turn is worth that turn's damage.
    if (TERRAIN_TUNING.minionsDieInFall && extras.minion) return Math.max(targetHp, 10) + KILL;
    const fall = fallDice(depth) * 3.5 * resist(plan.hazard.kind === 'fall' ? 'bludgeoning' : 'fire');
    // (A creature the fall cannot hurt is not worth locking in the pit: the fight would never end.)
    const tempo = TERRAIN_TUNING.fallsTakeTurn && fall > 0 ? (extras.turnValue ?? 8) : 0;
    return fall + 3 + tempo + (targetHp <= fall ? KILL : 0);
  }
  if (plan.obstacle) {
    const dmg = slamDice(depth) * 3.5 * resist(plan.obstacle.kind === 'fire' ? 'fire' : 'piercing');
    return dmg + (targetHp <= dmg ? KILL : 0);
  }
  if (plan.water) return 1.5 + 2 * alliesAdjacent;
  return 0;
}

/**
 * Where a creature that went into a hazard cell climbs out: the nearest free walkable, non-hazard cell to the
 * hazard cell; ties go to the cell closest to where the creature was pushed from (so the cell itself, when free).
 */
export function climbOutCell(nav: NavGrid, occupied: (p: GridPos) => boolean, hazardCell: GridPos, pushedFrom: GridPos): GridPos | null {
  for (let r = 1; r <= 8; r++) {
    let best: { p: GridPos; d: number } | undefined;
    for (let y = hazardCell.y - r; y <= hazardCell.y + r; y++) {
      for (let x = hazardCell.x - r; x <= hazardCell.x + r; x++) {
        if (Math.max(Math.abs(x - hazardCell.x), Math.abs(y - hazardCell.y)) !== r) continue;
        const p = { x, y };
        if (!nav.inBounds(p) || !nav.isWalkable(p) || isDeadly(nav.hazardAt(p)) || occupied(p)) continue;
        const d = (x - pushedFrom.x) ** 2 + (y - pushedFrom.y) ** 2;
        if (!best || d < best.d) best = { p, d };
      }
    }
    if (best) return best.p;
  }
  return null;
}

/** True when the cell has a pit or lava next to it (8-way), whatever stands on the other side. */
export function nextToHazard(nav: NavGrid, p: GridPos): boolean {
  return pushDirections(nav, p).length > 0;
}

/** Directions (dx, dy) in which a shove from the opposite side would send a creature standing on `p` into a hazard. */
export function pushDirections(nav: NavGrid, p: GridPos): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = { x: p.x + dx, y: p.y + dy };
      if (nav.inBounds(n) && (isDeadly(nav.hazardAt(n)) || obstacleOf(nav, n) !== null) && cornerOk(nav, p, dx, dy)) out.push({ dx, dy });
    }
  }
  return out;
}

/**
 * Cells where a pusher could stand to shove a creature on `p` into a hazard (the cell opposite each hazard
 * neighbour; the pusher must be able to stand there). Used by the AIs to judge how exposed a cell is.
 */
export function pusherCells(nav: NavGrid, p: GridPos): GridPos[] {
  const out: GridPos[] = [];
  for (const d of pushDirections(nav, p)) {
    const q = { x: p.x - d.dx, y: p.y - d.dy };
    if (nav.inBounds(q) && nav.isWalkable(q)) out.push(q);
  }
  return out;
}

/**
 * True when a creature on `p` could be shoved into a hazard by one of `pushers` (creatures of the other side)
 * that can get to the cell opposite the drop with its walking speed. Ignores who else stands there.
 */
export function exposedToPush(nav: NavGrid, p: GridPos, pushers: Pick<Creature, 'pos' | 'speed'>[]): boolean {
  const cells = pusherCells(nav, p);
  if (cells.length === 0) return false;
  return cells.some((q) => pushers.some((o) => Math.max(Math.abs(o.pos.x - q.x), Math.abs(o.pos.y - q.y)) <= o.speed));
}

// ----------------------------------------------------------------------------- cover

/** The cells strictly between two cells along the line of sight (Bresenham, the same walk as the nav's sight test). */
export function cellsBetween(a: GridPos, b: GridPos): GridPos[] {
  const out: GridPos[] = [];
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
    if (x !== b.x || y !== b.y) out.push({ x, y });
  }
  return out;
}

/**
 * Cover a target at `to` has against an attack or effect from `from`: the larger of the nav grid's cover (props,
 * wall corners) and Half Cover (+2) from another living creature standing in a cell between them (SRD: a creature
 * gives Half Cover). Only counts at 2 or more cells apart. `except` lists creatures to ignore (the attacker, the target).
 */
export function coverFor(nav: NavGrid, creatures: Creature[], from: GridPos, to: GridPos, except: string[] = []): 0 | 2 | 5 {
  if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) < 2) return 0;
  let cover: 0 | 2 | 5 = nav.coverBetween(from, to);
  if (cover === 5) return 5;
  const between = cellsBetween(from, to);
  if (between.some((p) => creatures.some((o) => isAlive(o) && !except.includes(o.id) && o.pos.x === p.x && o.pos.y === p.y))) cover = 2;
  return cover;
}

/** The AC / Dexterity-save bonus of the cover between two cells under the current rules (2 and 5 in the SRD; see TERRAIN_TUNING). */
export function coverBonusFor(nav: NavGrid, creatures: Creature[], from: GridPos, to: GridPos, except: string[] = []): number {
  const c = coverFor(nav, creatures, from, to, except);
  return c === 5 ? TERRAIN_TUNING.coverThreeQuarters : c === 2 ? TERRAIN_TUNING.coverHalf : 0;
}

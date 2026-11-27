import type { ActionDef, CombatApi, Command, Creature, GameEvent, GridPos, NavGrid } from '../core/types';
import { hasCondition } from './conditions';
import { averageDice } from './dice';
import { areHostile, chebyshev, isAlive } from './util';

/** Hard cap on commands per AI turn; reaching it forces endTurn. */
export const MAX_AI_STEPS = 12;

const UTILITY_EFFECTS = ['dash', 'disengage', 'dodge', 'aggressive', 'actionSurge', 'breakFree'];
/** Score given to landing a condition, in "expected damage" units. */
const CONTROL_VALUE = 4;
const KILL_BONUS = 20;

function isOffense(a: ActionDef): boolean {
  if (a.cost !== 'action') return false;
  // Spells are chosen by the hero policy (spellPolicy.ts), never by the generic AI.
  if (a.effects?.includes('spell')) return false;
  if (a.effects?.some((e) => UTILITY_EFFECTS.includes(e))) return false;
  if (a.targeting.kind === 'self' && !a.multiattack) return false;
  if (a.targeting.kind === 'creature' && a.targeting.friendly) return false;
  return !!(a.attack || a.save || a.multiattack || a.damage?.length);
}

function firstSub(c: Creature, a: ActionDef): ActionDef | undefined {
  for (const id of a.multiattack ?? []) {
    const s = c.actions.find((x) => x.id === id);
    if (s) return s;
  }
  return undefined;
}

function isMeleeOption(c: Creature, a: ActionDef): boolean {
  const d = a.multiattack ? firstSub(c, a) : a;
  return !!d && d.targeting.kind === 'creature' && d.targeting.melee;
}

function isRangedOption(c: Creature, a: ActionDef): boolean {
  const d = a.multiattack ? firstSub(c, a) : a;
  return !!d && d.targeting.kind === 'creature' && !d.targeting.melee;
}

/** Distance from which an action can be used, for approach planning (normal range for ranged attacks). */
function reachOf(c: Creature, a: ActionDef): number {
  const d = a.multiattack ? firstSub(c, a) : a;
  if (!d) return 0;
  if (d.targeting.kind === 'creature') return d.targeting.range;
  if (d.targeting.kind === 'point') return d.targeting.range === 0 ? d.targeting.area.size : d.targeting.range;
  return 0;
}

function singleValue(combat: CombatApi, a: ActionDef, target: Creature): number {
  const chance = combat.hitChance(a.id, target.id) ?? 1;
  const dmg = (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
  let v: number;
  if (a.attack) v = dmg * chance;
  else if (a.save) v = dmg * (chance + (a.save.halfOnSave ? (1 - chance) * 0.5 : 0));
  else v = dmg;
  if (a.applies && !target.conditionImmunities.includes(a.applies.condition) && !hasCondition(target, a.applies.condition)) {
    v += CONTROL_VALUE * (a.attack || a.save ? chance : 1);
  }
  return v;
}

function valueOf(combat: CombatApi, c: Creature, a: ActionDef, target: Creature): number {
  let v = 0;
  if (a.multiattack) {
    for (const id of a.multiattack) {
      const s = c.actions.find((x) => x.id === id);
      if (s) v += singleValue(combat, s, target);
    }
  } else {
    v = singleValue(combat, a, target);
  }
  if (v >= target.hp) v += KILL_BONUS;
  return v;
}

function pointOk(nav: NavGrid, c: Creature, a: ActionDef, p: GridPos): boolean {
  if (a.targeting.kind !== 'point') return false;
  if (a.targeting.range === 0) return true;
  const d = chebyshev(c.pos, p);
  return d <= a.targeting.range && (d <= 1 || nav.hasLineOfSight(c.pos, p));
}

interface Choice {
  actionId: string;
  targetId?: string;
  point?: GridPos;
  score: number;
  recharge: boolean;
  melee: boolean;
}

function bestChoices(combat: CombatApi, nav: NavGrid, c: Creature, hostiles: Creature[]): Choice[] {
  const out: Choice[] = [];
  for (const a of c.actions) {
    if (!isOffense(a) || !combat.canUse(a.id).ok) continue;
    const recharge = a.recharge !== undefined;
    const melee = isMeleeOption(c, a);
    if (a.targeting.kind === 'point') {
      const candidates: GridPos[] = a.targeting.range === 0 ? [c.pos] : hostiles.map((h) => h.pos);
      let best: Choice | undefined;
      for (const p of candidates) {
        if (!pointOk(nav, c, a, p)) continue;
        let score = 0;
        const cells = combat.areaCells(a.id, p);
        for (const o of combat.creatures()) {
          if (!isAlive(o) || (a.targeting.range === 0 && o === c)) continue;
          if (!cells.some((q) => q.x === o.pos.x && q.y === o.pos.y)) continue;
          const v = valueOf(combat, c, a, o);
          score += areHostile(c, o) ? v : -v;
        }
        if (score > 0 && (!best || score > best.score)) best = { actionId: a.id, point: p, score, recharge, melee };
      }
      if (best) out.push(best);
      continue;
    }
    let best: Choice | undefined;
    for (const id of combat.validTargets(a.id)) {
      const t = combat.creature(id);
      if (!t) continue;
      const score = valueOf(combat, c, a, t) + (t.id === 'player' ? 0.01 : 0);
      if (!best || score > best.score) best = { actionId: a.id, targetId: id, score, recharge, melee };
    }
    if (best) out.push(best);
  }
  return out;
}

function pathPrefix(nav: NavGrid, from: GridPos, path: GridPos[], budget: number, occupied: (p: GridPos) => boolean): GridPos[] {
  const out: GridPos[] = [];
  let cost = 0;
  let cur = from;
  for (const p of path) {
    const sc = nav.stepCost(cur, p);
    if (!Number.isFinite(sc) || cost + sc > budget + 1e-9 || occupied(p)) break;
    cost += sc;
    out.push(p);
    cur = p;
  }
  return out;
}

function pathCost(nav: NavGrid, from: GridPos, path: GridPos[]): number {
  let cost = 0;
  let cur = from;
  for (const p of path) {
    cost += nav.stepCost(cur, p);
    cur = p;
  }
  return cost;
}

/** Choose the next command for the active creature. Always returns something executable. */
export function chooseCommand(combat: CombatApi, nav: NavGrid): Command {
  const c = combat.creature(combat.activeId);
  const end: Command = { type: 'endTurn' };
  if (!c || combat.isOver || !isAlive(c)) return end;
  const turn = combat.turn;
  const hostiles = combat.creatures().filter((o) => isAlive(o) && areHostile(c, o));
  if (hostiles.length === 0) return end;
  const occupiedByOther = (p: GridPos): boolean =>
    combat.creatures().some((o) => isAlive(o) && o !== c && o.pos.x === p.x && o.pos.y === p.y);
  const adjacent = hostiles.some((h) => chebyshev(c.pos, h.pos) <= 1);
  const options = c.actions.filter(isOffense);
  const rangedOptions = options.filter((a) => isRangedOption(c, a) && combat.canUse(a.id).ok);

  // Hit and run: a creature with Nimble Escape and a ranged attack backs off and shoots.
  if (c.traits.includes('nimbleEscape') && adjacent && rangedOptions.length > 0) {
    const retreat = retreatCell(combat, nav, c, hostiles, rangedOptions);
    if (retreat) {
      if (!hasCondition(c, 'disengaged') && combat.canUse('disengage').ok) return { type: 'action', actionId: 'disengage' };
      if (hasCondition(c, 'disengaged')) {
        const path = nav.findPath(c.pos, retreat, { blocked: occupiedByOther, maxCost: turn.movementLeft });
        if (path && path.length > 0) return { type: 'move', path };
      }
    }
  }

  const meleeOptions = options.filter((a) => isMeleeOption(c, a));
  const meleeFirst = prefersMelee(c, options);
  // Melee-minded creatures walk up to their target rather than trading ranged shots at distance.
  if (!turn.actionUsed && meleeFirst && !adjacent && meleeOptions.length > 0) {
    const cmd = cellMove(combat, nav, c, hostiles, meleeOptions.filter((a) => combat.canUse(a.id).ok), occupiedByOther);
    if (cmd) return cmd;
  }

  // Attack from where we stand.
  if (!turn.actionUsed) {
    const all = bestChoices(combat, nav, c, hostiles);
    const rech = all.filter((x) => x.recharge);
    let choices = rech.length > 0 ? rech : all;
    if (rech.length === 0 && adjacent && choices.some((x) => x.melee)) choices = choices.filter((x) => x.melee);
    if (choices.length > 0) {
      const pool = choices;
      const pick = pool.reduce((a, b) => (b.score > a.score ? b : a));
      const closer = closeToNormalRange(combat, nav, c, pick, occupiedByOther);
      if (closer) return closer;
      const cmd: Command = { type: 'action', actionId: pick.actionId };
      if (pick.targetId !== undefined) cmd.targetId = pick.targetId;
      if (pick.point !== undefined) cmd.point = pick.point;
      return cmd;
    }
  }

  // Move: only before attacking, or after a dash granted extra movement.
  const mayMove = !turn.actionUsed || turn.movementLeft > c.speed || (meleeFirst && !adjacent);
  if (!mayMove || turn.movementLeft <= 0) return end;
  const usable = options.filter((a) => combat.canUse(a.id).ok || turn.actionUsed);
  if (usable.length === 0) return end;

  const cellCmd = cellMove(combat, nav, c, hostiles, meleeFirst && meleeOptions.length > 0 ? meleeOptions : usable, occupiedByOther);
  if (cellCmd) return cellCmd;

  // Close the distance toward the nearest reachable enemy.
  let best: { path: GridPos[]; cost: number } | undefined;
  for (const h of hostiles) {
    const raw = nav.findPath(c.pos, h.pos, {
      blocked: (p) => !(p.x === h.pos.x && p.y === h.pos.y) && occupiedByOther(p),
    });
    if (!raw || raw.length === 0) continue;
    const path = raw.slice(0, -1);
    const cost = pathCost(nav, c.pos, path);
    if (!best || cost < best.cost) best = { path, cost };
  }
  if (!best || best.path.length === 0) return end;

  if (!turn.actionUsed && best.cost > turn.movementLeft) {
    if (combat.canUse('aggressive').ok) return { type: 'action', actionId: 'aggressive' };
    if (combat.canUse('dash').ok) return { type: 'action', actionId: 'dash' };
  }
  const walk = pathPrefix(nav, c.pos, best.path, turn.movementLeft, occupiedByOther);
  if (walk.length === 0) return end;
  return { type: 'move', path: walk };
}

function retreatCell(
  combat: CombatApi,
  nav: NavGrid,
  c: Creature,
  hostiles: Creature[],
  ranged: ActionDef[],
): GridPos | undefined {
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of combat.reachable()) {
    const dists = hostiles.map((h) => chebyshev(cell.pos, h.pos));
    if (Math.min(...dists) < 2) continue;
    const shootable = ranged.some((a) => {
      const t = a.targeting;
      if (t.kind !== 'creature') return false;
      return hostiles.some((h) => {
        const d = chebyshev(cell.pos, h.pos);
        return d <= t.range && nav.hasLineOfSight(cell.pos, h.pos);
      });
    });
    if (!shootable) continue;
    const score = Math.min(...dists) * 10 - cell.cost;
    if (!best || score > best.score) best = { pos: cell.pos, score };
  }
  return best?.pos;
}

/**
 * Run the active creature's whole turn with the AI. Loops chooseCommand and
 * execute until the turn passes; a hard cap forces endTurn.
 */
export function runAiTurn(combat: CombatApi, nav: NavGrid): GameEvent[] {
  return runTurnWith(combat, (cb) => chooseCommand(cb, nav));
}

export function runTurnWith(combat: CombatApi, choose: (c: CombatApi) => Command): GameEvent[] {
  const events: GameEvent[] = [];
  if (combat.isOver) return events;
  const startId = combat.activeId;
  const startRound = combat.round;
  const turnPassed = (): boolean => combat.isOver || combat.activeId !== startId || combat.round !== startRound;
  for (let i = 0; i < MAX_AI_STEPS && !turnPassed(); i++) {
    let cmd = choose(combat);
    try {
      events.push(...combat.execute(cmd));
    } catch {
      cmd = { type: 'endTurn' };
      events.push(...combat.execute(cmd));
    }
    if (cmd.type === 'endTurn') return events;
  }
  if (!turnPassed()) events.push(...combat.execute({ type: 'endTurn' }));
  return events;
}

/** A long-range shot has disadvantage: if a nearby cell is within normal range, walk there first. */
function closeToNormalRange(
  combat: CombatApi,
  nav: NavGrid,
  c: Creature,
  pick: { actionId: string; targetId?: string },
  occupied: (p: GridPos) => boolean,
): Command | null {
  const a = c.actions.find((x) => x.id === pick.actionId);
  const target = pick.targetId ? combat.creature(pick.targetId) : undefined;
  if (!a || !target || a.targeting.kind !== 'creature' || a.targeting.melee || a.targeting.longRange === undefined) return null;
  const normal = a.targeting.range;
  if (chebyshev(c.pos, target.pos) <= normal || combat.turn.movementLeft <= 0) return null;
  let best: { pos: GridPos; cost: number } | undefined;
  for (const cell of combat.reachable()) {
    if (chebyshev(cell.pos, target.pos) > normal || !nav.hasLineOfSight(cell.pos, target.pos)) continue;
    if (!best || cell.cost < best.cost) best = cell;
  }
  if (!best) return null;
  const path = nav.findPath(c.pos, best.pos, { blocked: occupied, maxCost: combat.turn.movementLeft });
  return path && path.length > 0 ? { type: 'move', path } : null;
}

/** Move to the cheapest reachable cell from which one of `opts` could hit something. */
function cellMove(
  combat: CombatApi,
  nav: NavGrid,
  c: Creature,
  hostiles: Creature[],
  opts: ActionDef[],
  occupied: (p: GridPos) => boolean,
): Command | null {
  let bestCell: { pos: GridPos; cost: number } | undefined;
  for (const cell of combat.reachable()) {
    const ok = opts.some((a) => {
      const reach = reachOf(c, a);
      const isPoint = a.targeting.kind === 'point';
      return hostiles.some((h) => {
        const d = chebyshev(cell.pos, h.pos);
        return d <= reach && (d <= 1 || isPoint || nav.hasLineOfSight(cell.pos, h.pos));
      });
    });
    if (ok && (!bestCell || cell.cost < bestCell.cost)) bestCell = cell;
  }
  if (!bestCell) return null;
  const path = nav.findPath(c.pos, bestCell.pos, { blocked: occupied, maxCost: combat.turn.movementLeft });
  return path && path.length > 0 ? { type: 'move', path } : null;
}

/** True if the creature's melee attacks are at least as good as its ranged ones (and it is not a hit-and-run shooter). */
function prefersMelee(c: Creature, options: ActionDef[]): boolean {
  if (c.traits.includes('nimbleEscape')) return false;
  const avg = (a: ActionDef): number => {
    const parts = a.multiattack ? a.multiattack.flatMap((id) => c.actions.find((x) => x.id === id)?.damage ?? []) : (a.damage ?? []);
    return parts.reduce((t, p) => t + averageDice(p.dice), 0);
  };
  let melee = 0;
  let ranged = 0;
  for (const a of options) {
    if (isMeleeOption(c, a)) melee = Math.max(melee, avg(a));
    else if (isRangedOption(c, a)) ranged = Math.max(ranged, avg(a));
  }
  return melee > 0 && melee >= ranged;
}

import type { ActionDef, CombatApi, Command, Creature, DamageType, GameEvent, GridPos, NavGrid } from '../core/types';
import { attacksLeft } from './combat';
import { hasCondition } from './conditions';
import { averageDice } from './dice';
import { tacticCommand } from './tacticAi';
import { exposedToPush } from './terrain';
import { areHostile, chebyshev, isAlive } from './util';

/** Hard cap on commands per AI turn; reaching it forces endTurn. (A level 20 hero: four attacks, two surges, moves, bonus actions.) */
export const MAX_AI_STEPS = 24;

const UTILITY_EFFECTS = ['dash', 'disengage', 'dodge', 'aggressive', 'actionSurge', 'breakFree', 'blink'];
/** Score given to landing a condition, in "expected damage" units. */
export const CONTROL_VALUE = 4;
export const KILL_BONUS = 20;

/** Multiplier of a damage type against a target: 0 immune, 0.5 resistant, 2 vulnerable. */
export function typeFactor(t: Pick<Creature, 'immunities' | 'resistances' | 'vulnerabilities'>, type: DamageType): number {
  if (t.immunities.includes(type)) return 0;
  let f = 1;
  if (t.resistances.includes(type)) f *= 0.5;
  if (t.vulnerabilities.includes(type)) f *= 2;
  return f;
}

/** Expected damage of an action's dice against a target, with resistances and immunities applied. */
export function damageAgainst(a: ActionDef, t: Pick<Creature, 'immunities' | 'resistances' | 'vulnerabilities'>): number {
  return (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice) * typeFactor(t, p.type), 0);
}

/** Deterministic pseudo-random in [0, 1) from a string and a number, so attention can split without an Rng. */
export function jitter(key: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * How much a monster wants to hit this target compared with another of equal worth: the hero draws somewhat
 * more attention than an ally, and a deterministic per-round wobble lets the ally be picked now and then.
 */
function attention(combat: CombatApi, c: Creature, t: Creature): number {
  if (c.faction !== 'enemy') return 1;
  // The hero's armor is usually better than an ally's, so raw expected damage already favours the ally: the weight corrects for that.
  const base = t.faction === 'player' ? 1.6 : 1;
  return base * (0.5 + jitter(`${c.id}>${t.id}`, combat.round));
}

export function isOffense(a: ActionDef, cost: ActionDef['cost'] = 'action'): boolean {
  if (a.cost !== cost) return false;
  // Spells are chosen by the hero policy (spellPolicy.ts), never by the generic AI.
  if (a.effects?.includes('spell')) return false;
  if (a.effects?.some((e) => UTILITY_EFFECTS.includes(e))) return false;
  if (a.targeting.kind === 'self' && !a.multiattack) return false;
  if (a.targeting.kind === 'creature' && a.targeting.friendly) return false;
  return !!(a.attack || a.save || a.multiattack || a.damage?.length || a.applies);
}

/** Turn-denying: Command (Grovel) and anything that applies paralyzed, stunned, incapacitated or unconscious. */
export function denialAction(a: ActionDef): boolean {
  const c = a.applies?.condition;
  return a.id === 'command' || a.effects?.includes('command') === true || c === 'paralyzed' || c === 'stunned' || c === 'incapacitated' || c === 'unconscious';
}

/**
 * HOUSE RULE (solo balance, turn denial): a monster does not use a turn-denying action on the same target on two
 * turns in a row (the first success already costs the hero a turn; the second is not allowed to chain).
 */
const lastDenial = new WeakMap<CombatApi, Map<string, { targetId: string; round: number }>>();
function denialBlocked(combat: CombatApi, c: Creature, a: ActionDef, targetId: string): boolean {
  if (!denialAction(a)) return false;
  const last = lastDenial.get(combat)?.get(c.id + ':' + a.id);
  return !!last && last.targetId === targetId && last.round >= combat.round - 1;
}
function noteDenial(combat: CombatApi, c: Creature, cmd: Command): void {
  if (cmd.type !== 'action' || !cmd.targetId) return;
  const a = c.actions.find((x) => x.id === cmd.actionId);
  if (!a || !denialAction(a)) return;
  let m = lastDenial.get(combat);
  if (!m) lastDenial.set(combat, (m = new Map()));
  m.set(c.id + ':' + a.id, { targetId: cmd.targetId, round: combat.round });
}

function firstSub(c: Creature, a: ActionDef): ActionDef | undefined {
  for (const id of a.multiattack ?? []) {
    const s = c.actions.find((x) => x.id === id);
    if (s) return s;
  }
  return undefined;
}

export function isMeleeOption(c: Creature, a: ActionDef): boolean {
  const d = a.multiattack ? firstSub(c, a) : a;
  return !!d && d.targeting.kind === 'creature' && d.targeting.melee;
}

export function isRangedOption(c: Creature, a: ActionDef): boolean {
  const d = a.multiattack ? firstSub(c, a) : a;
  return !!d && d.targeting.kind === 'creature' && !d.targeting.melee;
}

/** Distance from which an action can be used, for approach planning (normal range for ranged attacks). */
export function reachOf(c: Creature, a: ActionDef): number {
  const d = a.multiattack ? firstSub(c, a) : a;
  if (!d) return 0;
  if (d.targeting.kind === 'creature') return d.targeting.range;
  if (d.targeting.kind === 'point') return d.targeting.range === 0 ? d.targeting.area.size : d.targeting.range;
  return 0;
}

function singleValue(combat: CombatApi, a: ActionDef, target: Creature): number {
  const chance = combat.hitChance(a.id, target.id) ?? 1;
  const dmg = damageAgainst(a, target);
  let v: number;
  if (a.attack) v = dmg * chance;
  else if (a.save) v = dmg * (chance + (a.save.halfOnSave ? (1 - chance) * 0.5 : 0));
  else v = dmg;
  if (a.applies && !target.conditionImmunities.includes(a.applies.condition) && !hasCondition(target, a.applies.condition)) {
    let control = CONTROL_VALUE;
    // Control that allies can exploit (prone, restrained, paralyzed, stunned) is worth more with allies at the target.
    if (['prone', 'restrained', 'paralyzed', 'stunned', 'incapacitated'].includes(a.applies.condition)) {
      const me = combat.creature(combat.activeId);
      const near = me ? combat.creatures().filter((o) => isAlive(o) && o !== me && !areHostile(me, o) && chebyshev(o.pos, target.pos) <= 1).length : 0;
      control += 3 * near + (a.applies.condition === 'paralyzed' || a.applies.condition === 'stunned' ? 6 : 0);
    }
    v += control * (a.attack || a.save ? chance : 1);
  }
  return v;
}

export function valueOf(combat: CombatApi, c: Creature, a: ActionDef, target: Creature): number {
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

export function pointOk(nav: NavGrid, c: Creature, a: ActionDef, p: GridPos): boolean {
  if (a.targeting.kind !== 'point') return false;
  if (a.targeting.range === 0) return true;
  const d = chebyshev(c.pos, p);
  return d <= a.targeting.range && (d <= 1 || nav.hasLineOfSight(c.pos, p));
}

export interface Choice {
  actionId: string;
  targetId?: string;
  point?: GridPos;
  score: number;
  recharge: boolean;
  melee: boolean;
}

export function bestChoices(combat: CombatApi, nav: NavGrid, c: Creature, hostiles: Creature[], cost: ActionDef['cost'] = 'action'): Choice[] {
  const out: Choice[] = [];
  for (const a of c.actions) {
    if (!isOffense(a, cost) || !combat.canUse(a.id).ok) continue;
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
        // An area that catches two or more enemies beats a single strike; limited-use spells are spent while they are fresh.
        if (cells.length > 0 && combat.creatures().filter((o) => isAlive(o) && areHostile(c, o) && cells.some((q) => q.x === o.pos.x && q.y === o.pos.y)).length >= 2) score *= 1.3;
        if (a.uses && (c.resources[a.uses.resource]?.current ?? 0) > 0) score *= 1.6;
        if (score > 0 && (!best || score > best.score)) best = { actionId: a.id, point: p, score, recharge, melee };
      }
      if (best) out.push(best);
      continue;
    }
    let best: Choice | undefined;
    for (const id of combat.validTargets(a.id)) {
      const t = combat.creature(id);
      if (!t) continue;
      if (denialBlocked(combat, c, a, id)) continue;
      let score = valueOf(combat, c, a, t) * attention(combat, c, t) + (t.id === 'player' ? 0.01 : 0);
      if (a.uses && (c.resources[a.uses.resource]?.current ?? 0) > 0) score *= 1.6;
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
  const cmd = chooseCommandInner(combat, nav);
  const c = combat.creature(combat.activeId);
  if (c) noteDenial(combat, c, cmd);
  return cmd;
}

function chooseCommandInner(combat: CombatApi, nav: NavGrid): Command {
  const c = combat.creature(combat.activeId);
  const end: Command = { type: 'endTurn' };
  if (!c || combat.isOver || !isAlive(c)) return end;
  const turn = combat.turn;
  const hostiles = combat.creatures().filter((o) => isAlive(o) && areHostile(c, o));
  if (hostiles.length === 0) return end;
  const occupiedByOther = (p: GridPos): boolean =>
    combat.creatures().some((o) => isAlive(o) && o !== c && o.pos.x === p.x && o.pos.y === p.y);
  const adjacent = hostiles.some((h) => chebyshev(c.pos, h.pos) <= 1);
  const options = c.actions.filter((a) => isOffense(a));
  const rangedOptions = options.filter((a) => isRangedOption(c, a) && combat.canUse(a.id).ok);
  // Extra Attack: attacks left in the current Attack action can be made (and moved between) after the action is used.
  const extra = attacksLeft(combat) > 0 && turn.actionUsed;

  // Bonus actions of monsters (a heal, a gaze, a spiritual weapon): used when sensible, before the main action.
  if (c.faction === 'enemy' && !turn.bonusUsed) {
    const bonus = bonusCommand(combat, nav, c, hostiles);
    if (bonus) return bonus;
  }

  // An action-cost heal (Healing Word and the like) for a friend below half health, before attacking.
  if (c.faction === 'enemy' && !turn.actionUsed) {
    for (const a of c.actions) {
      if (a.cost !== 'action' || !a.heal || a.damage || !combat.canUse(a.id).ok || a.targeting.kind === 'point') continue;
      if (a.targeting.kind === 'self') {
        if (c.hp <= c.maxHp * 0.4) return { type: 'action', actionId: a.id };
      } else if (a.targeting.kind === 'creature') {
        const t = combat.validTargets(a.id).map((id) => combat.creature(id) as Creature).filter((o) => o.hp <= o.maxHp * 0.4).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
        if (t) return { type: 'action', actionId: a.id, targetId: t.id };
      }
    }
  }

  // Roles: brute, archer, caster, skirmisher, leader, lurker, guard (tacticAi.ts) decide first; null lets the generic logic act.
  if (c.faction === 'enemy') {
    const roleCmd = tacticCommand(combat, nav, c, hostiles);
    if (roleCmd) return roleCmd;
  }

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
  // A spell or area that beats the best melee routine by a clear margin (an area catching two enemies, a fresh limited-use
  // spell, a control effect) is used from where the creature stands instead of first walking up to hit.
  if (c.faction === 'enemy' && (!turn.actionUsed || extra) && !adjacent && options.some((a) => !isMeleeOption(c, a))) {
    const picks = bestChoices(combat, nav, c, hostiles);
    const meleeBest = Math.max(0, ...picks.filter((x) => x.melee).map((x) => x.score));
    const special = picks.filter((x) => !x.melee && x.score > meleeBest * 1.25 && (x.point !== undefined || c.actions.find((a) => a.id === x.actionId)?.uses !== undefined || c.actions.find((a) => a.id === x.actionId)?.applies !== undefined));
    if (special.length > 0) {
      const pick = special.reduce((a, b) => (b.score > a.score ? b : a));
      const out: Command = { type: 'action', actionId: pick.actionId };
      if (pick.targetId !== undefined) out.targetId = pick.targetId;
      if (pick.point !== undefined) out.point = pick.point;
      return out;
    }
  }
  const meleeFirst = prefersMelee(c, options);
  // Melee-minded creatures walk up to their target rather than trading ranged shots at distance.
  if ((!turn.actionUsed || extra) && meleeFirst && !adjacent && meleeOptions.length > 0) {
    const cmd = cellMove(combat, nav, c, hostiles, meleeOptions.filter((a) => combat.canUse(a.id).ok), occupiedByOther);
    if (cmd) return cmd;
  }

  // Attack from where we stand.
  if (!turn.actionUsed || extra) {
    const all = bestChoices(combat, nav, c, hostiles);
    const rech = all.filter((x) => x.recharge);
    let choices = rech.length > 0 ? rech : all;
    // Adjacent: fight in melee, unless nothing melee can hurt anything (immunities): then a ranged or thrown attack of another type.
    if (rech.length === 0 && adjacent && choices.some((x) => x.melee && x.score > 0)) {
      const meleeBest = Math.max(...choices.filter((x) => x.melee).map((x) => x.score));
      // Even next to an enemy, an area or limited-use spell worth clearly more than the melee routine is cast.
      choices = choices.filter((x) => x.melee || (c.faction === 'enemy' && x.point !== undefined && x.score > meleeBest * 1.4));
    }
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
  const mayMove = !turn.actionUsed || extra || turn.movementLeft > c.speed || (meleeFirst && !adjacent);
  if (!mayMove || turn.movementLeft <= 0) return end;
  const usable = options.filter((a) => combat.canUse(a.id).ok || turn.actionUsed);
  if (usable.length === 0) return end;

  const cellCmd = cellMove(combat, nav, c, hostiles, meleeFirst && meleeOptions.length > 0 ? meleeOptions : usable, occupiedByOther);
  if (cellCmd) return cellCmd;

  // Close the distance toward the nearest reachable enemy.
  let best: { path: GridPos[]; cost: number; rank: number } | undefined;
  for (const h of hostiles) {
    const raw = nav.findPath(c.pos, h.pos, {
      blocked: (p) => !(p.x === h.pos.x && p.y === h.pos.y) && occupiedByOther(p),
    });
    if (!raw || raw.length === 0) continue;
    const path = raw.slice(0, -1);
    const cost = pathCost(nav, c.pos, path);
    // Monsters lean toward the hero: an ally has to be clearly closer to be chased instead.
    const rank = c.faction === 'enemy' && h.faction !== 'player' ? cost * 1.25 + 1 : cost;
    if (!best || rank < best.rank) best = { path, cost, rank };
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

/** A monster's bonus action: heal itself or a hurt friend below half health, else the best attack, gaze or control effect now in range. */
function bonusCommand(combat: CombatApi, nav: NavGrid, c: Creature, hostiles: Creature[]): Command | null {
  const bonus = c.actions.filter((a) => a.cost === 'bonus' && !a.effects?.some((e) => UTILITY_EFFECTS.includes(e)) && !a.effects?.includes('spell') && combat.canUse(a.id).ok);
  if (bonus.length === 0) return null;
  for (const a of bonus) {
    if (!a.heal) continue;
    if (a.targeting.kind === 'self') {
      if (c.hp <= c.maxHp * 0.5) return { type: 'action', actionId: a.id };
    } else if (a.targeting.kind === 'creature') {
      const t = combat
        .validTargets(a.id)
        .map((id) => combat.creature(id) as Creature)
        .filter((o) => o.hp <= o.maxHp * 0.5)
        .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
      if (t) return { type: 'action', actionId: a.id, targetId: t.id };
    }
  }
  const pool = bestChoices(combat, nav, c, hostiles, 'bonus').filter((x) => x.score > 0);
  if (pool.length === 0) return null;
  const pick = pool.reduce((a, b) => (b.score > a.score ? b : a));
  const cmd: Command = { type: 'action', actionId: pick.actionId };
  if (pick.targetId !== undefined) cmd.targetId = pick.targetId;
  if (pick.point !== undefined) cmd.point = pick.point;
  return cmd;
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
    // Hazard awareness: among equally cheap cells, one a shove could send us from into a drop or lava comes last.
    const rank = cell.cost + (ok && exposedToPush(nav, cell.pos, hostiles) ? 0.25 : 0);
    if (ok && (!bestCell || rank < bestCell.cost)) bestCell = { pos: cell.pos, cost: rank };
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

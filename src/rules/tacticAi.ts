import type { ActionDef, CombatApi, Command, Creature, GridPos, MonsterTactic, NavGrid } from '../core/types';
import { SHOVE_PUSH_ID, SHOVE_TRIP_ID } from './actions';
import { CONTROL_VALUE, KILL_BONUS, bestChoices, isMeleeOption, isOffense, isRangedOption, jitter, reachOf, valueOf, type Choice } from './ai';
import { actionCost, combatDepth } from './combat';
import { hasCondition, isIncapacitated } from './conditions';
import { creatureTactic } from './tactics';
import { exposedToPush, planPush, pushValue } from './terrain';
import { areHostile, chebyshev, isAlive } from './util';

/**
 * Behaviour by tactic for monsters (see MonsterTactic). `tacticCommand` is asked first by the generic AI
 * (`chooseCommand`): it returns the next command, or null to let the generic "walk up and hit" logic act.
 * Every branch is bounded: a creature makes at most two repositioning moves per turn, waiting is `endTurn`,
 * and holding back gives way (round 12) to fighting, so no tactic can stall a fight for ever.
 *
 *  - brute: closes and hits; shoves a target into a drop or lava when that beats its attack (or one turn in three
 *    when the geometry is there), and shoves Prone a target its allies are fighting.
 *  - archer: keeps its distance, shoots from cells with line of sight, cover and high ground, retreats from melee when
 *    that provokes nothing (or after a Disengage that costs no action), and avoids cells a shove could send it from.
 *  - caster: as the archer, and places areas to catch the most enemies without catching its own side.
 *  - skirmisher: picks the least protected target, prefers one its allies already fight, strikes and withdraws.
 *  - leader: stays behind its allies and uses ranged options; fights fully when alone, cornered, or after round 12.
 *  - lurker: while unseen it approaches only through cells out of the heroes' sight (its first attack gets advantage
 *    from the combat engine); once seen it fights as a brute.
 *  - guard: holds its post until an enemy is within reach or 4 cells or it is hurt, shooting if it has a bow;
 *    then it is a brute.
 *
 * Hazard awareness for all of them lives in `exposedToPush` (never end in a cell next to a drop or lava with a
 * pusher in reach when an equal cell exists) and in `cellMove` (ai.ts), the generic cell chooser.
 */

/** Rounds after which holding back (leader, lurker) gives way to fighting. */
const PATIENCE_ROUNDS = 12;
const MOVES_PER_TURN = 2;
const SHOVE_HAZARD_TURN_SHARE = 0.34;
const SHOVE_TRIP_TURN_SHARE = 0.4;
/** A trip that is this much better than the attack is made every time. */
const SHOVE_TRIP_CLEAR_WIN = 1.25;

interface Mem {
  start: GridPos;
  alerted: boolean;
  round: number;
  moves: number;
  retreated: boolean;
  disengaged: boolean;
}
const memory = new WeakMap<CombatApi, Map<string, Mem>>();

interface Ctx {
  combat: CombatApi;
  nav: NavGrid;
  c: Creature;
  hostiles: Creature[];
  allies: Creature[];
  mem: Mem;
  tactic: MonsterTactic;
  occ: (p: GridPos) => boolean;
}

const cmd = (a: { id: string }, extra: { targetId?: string; point?: GridPos } = {}): Command => {
  const out: Command = { type: 'action', actionId: a.id };
  if (extra.targetId !== undefined) out.targetId = extra.targetId;
  if (extra.point !== undefined) out.point = extra.point;
  return out;
};
const END: Command = { type: 'endTurn' };
const sign = (n: number): number => Math.sign(n);

function memOf(combat: CombatApi, c: Creature): Mem {
  let all = memory.get(combat);
  if (!all) memory.set(combat, (all = new Map()));
  let m = all.get(c.id);
  if (!m) {
    m = { start: { x: c.pos.x, y: c.pos.y }, alerted: false, round: combat.round, moves: 0, retreated: false, disengaged: false };
    all.set(c.id, m);
  }
  if (m.round !== combat.round) {
    m.round = combat.round;
    m.moves = 0;
    m.retreated = false;
    m.disengaged = false;
  }
  return m;
}

/** The next command for a monster with a tactic, or null for the generic AI. */
export function tacticCommand(combat: CombatApi, nav: NavGrid, c: Creature, hostiles: Creature[]): Command | null {
  const tactic = creatureTactic(c);
  if (!tactic) return null;
  const others = combat.creatures().filter((o) => isAlive(o) && o !== c);
  const ctx: Ctx = {
    combat,
    nav,
    c,
    hostiles,
    allies: others.filter((o) => !areHostile(c, o) && !isIncapacitated(o)),
    mem: memOf(combat, c),
    tactic,
    occ: (p) => others.some((o) => o.pos.x === p.x && o.pos.y === p.y),
  };
  switch (tactic) {
    case 'brute':
      return bruteCommand(ctx);
    case 'archer':
    case 'caster':
      return rangedCommand(ctx);
    case 'skirmisher':
      return skirmisherCommand(ctx);
    case 'leader':
      return leaderCommand(ctx);
    case 'lurker':
      return lurkerCommand(ctx);
    case 'guard':
      return guardCommand(ctx);
  }
}

// ------------------------------------------------------------------ helpers

function cells(ctx: Ctx): { pos: GridPos; cost: number }[] {
  return [{ pos: ctx.c.pos, cost: 0 }, ...ctx.combat.reachable()];
}

function moveTo(ctx: Ctx, to: GridPos): Command | null {
  const { nav, c, combat } = ctx;
  if (to.x === c.pos.x && to.y === c.pos.y) return null;
  const path = nav.findPath(c.pos, to, { blocked: ctx.occ, maxCost: combat.turn.movementLeft });
  if (!path || path.length === 0) return null;
  ctx.mem.moves += 1;
  return { type: 'move', path };
}

const exposed = (ctx: Ctx, p: GridPos): boolean => exposedToPush(ctx.nav, p, ctx.hostiles);

const adjacentHostiles = (ctx: Ctx, p: GridPos): Creature[] => ctx.hostiles.filter((h) => chebyshev(p, h.pos) <= 1);

const nearestDist = (ctx: Ctx, p: GridPos): number => (ctx.hostiles.length === 0 ? 99 : Math.min(...ctx.hostiles.map((h) => chebyshev(p, h.pos))));

/** Leaving the cells next to enemies provokes opportunity attacks unless they cannot react or we Disengaged. */
function leavingIsFree(ctx: Ctx): boolean {
  if (hasCondition(ctx.c, 'disengaged')) return true;
  return adjacentHostiles(ctx, ctx.c.pos).every((h) => isIncapacitated(h) || !h.actions.some((a) => a.attack && a.targeting.kind === 'creature' && a.targeting.melee));
}

/** Disengage that costs no action (Nimble Escape): the command to take before a withdrawal, or null. */
function freeDisengage(ctx: Ctx): Command | null {
  const a = ctx.c.actions.find((x) => x.id === 'disengage');
  if (!a || ctx.mem.disengaged || hasCondition(ctx.c, 'disengaged') || ctx.combat.turn.bonusUsed) return null;
  if (actionCost(ctx.c, a) !== 'bonus' || !ctx.combat.canUse('disengage').ok) return null;
  ctx.mem.disengaged = true;
  return { type: 'action', actionId: 'disengage' };
}

/** Ranged and area offense the creature owns (planning: ignores whether a target is in range right now). */
function rangedOptions(ctx: Ctx): ActionDef[] {
  return ctx.c.actions.filter((a) => isOffense(a) && (isRangedOption(ctx.c, a) || a.targeting.kind === 'point'));
}

/** The farthest distance from which any ranged or area option can strike. */
function strikeRange(ctx: Ctx, options: ActionDef[]): number {
  let r = 0;
  for (const a of options) {
    const t = a.targeting;
    if (t.kind === 'creature') r = Math.max(r, t.range);
    else if (t.kind === 'point') r = Math.max(r, t.range === 0 ? t.area.size : t.range);
  }
  return r;
}

function canShootFrom(ctx: Ctx, p: GridPos, range: number): boolean {
  return ctx.hostiles.some((h) => {
    const d = chebyshev(p, h.pos);
    return d <= range && (d <= 1 || ctx.nav.hasLineOfSight(p, h.pos));
  });
}

function coverAgainst(ctx: Ctx, p: GridPos): number {
  let best = 0;
  for (const h of ctx.hostiles) if (chebyshev(p, h.pos) >= 2 && ctx.nav.hasLineOfSight(h.pos, p)) best = Math.max(best, ctx.nav.coverBetween(h.pos, p));
  return best;
}

/** The best single-target ranged or area attack available now (areas aimed to catch many and spare friends). */
function strikeNow(ctx: Ctx, includeMelee: boolean): Command | null {
  const { combat, nav, c, hostiles } = ctx;
  if (combat.turn.actionUsed) return null;
  const all: Choice[] = bestChoices(combat, nav, c, hostiles).filter((x) => x.score > 0 && (includeMelee || !x.melee));
  if (ctx.tactic === 'caster' || ctx.tactic === 'leader') {
    const area = bestArea(ctx);
    if (area) all.push(area);
  }
  const rech = all.filter((x) => x.recharge);
  const pool = rech.length > 0 ? rech : all;
  if (pool.length === 0) return null;
  const pick = pool.reduce((a, b) => (b.score > a.score ? b : a));
  return cmd({ id: pick.actionId }, { ...(pick.targetId !== undefined ? { targetId: pick.targetId } : {}), ...(pick.point !== undefined ? { point: pick.point } : {}) });
}

/** Areas for casters: tried at every enemy and at the cells around them, scored by enemies hit minus friends hit. */
function bestArea(ctx: Ctx): Choice | null {
  const { combat, nav, c, hostiles } = ctx;
  let best: Choice | null = null;
  for (const a of c.actions) {
    if (!isOffense(a) || a.targeting.kind !== 'point' || !combat.canUse(a.id).ok) continue;
    const t = a.targeting;
    const seen = new Set<string>();
    const candidates: GridPos[] = [];
    const add = (p: GridPos): void => {
      const k = `${p.x},${p.y}`;
      if (seen.has(k) || !nav.inBounds(p)) return;
      seen.add(k);
      candidates.push(p);
    };
    if (t.range === 0 && t.area.shape === 'sphere') add(c.pos);
    else for (const h of hostiles) {
      add(h.pos);
      if (t.range > 0 && t.area.shape === 'sphere') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add({ x: h.pos.x + dx, y: h.pos.y + dy });
    }
    for (const p of candidates) {
      if (t.range > 0 && !(chebyshev(c.pos, p) <= t.range && (chebyshev(c.pos, p) <= 1 || nav.hasLineOfSight(c.pos, p)))) continue;
      if (t.range === 0 && t.area.shape !== 'sphere' && p.x === c.pos.x && p.y === c.pos.y) continue;
      let score = 0;
      const area = combat.areaCells(a.id, p);
      for (const o of combat.creatures()) {
        if (!isAlive(o) || (t.range === 0 && o === c) || !area.some((q) => q.x === o.pos.x && q.y === o.pos.y)) continue;
        const v = valueOf(combat, c, a, o);
        score += areHostile(c, o) ? v : -v * 1.5;
      }
      if (score > 0 && (!best || score > best.score)) best = { actionId: a.id, point: p, score, recharge: a.recharge !== undefined, melee: false };
    }
  }
  return best;
}

// ------------------------------------------------------------------ shoving

/** Expected damage of the creature's best melee option on a target (with the kill bonus). */
function meleeValue(ctx: Ctx, t: Creature): number {
  let best = 0;
  for (const a of ctx.c.actions) {
    if (!isOffense(a) || !isMeleeOption(ctx.c, a)) continue;
    best = Math.max(best, valueOf(ctx.combat, ctx.c, a, t));
  }
  return best;
}

/** A shove the creature should make now, or null. Never shoves a friend (shoves only target enemies). */
function shoveChoice(ctx: Ctx): Command | null {
  const { combat, nav, c } = ctx;
  if (combat.turn.actionUsed || !combat.canUse(SHOVE_PUSH_ID).ok) return null;
  const depth = combatDepth(combat);
  const targets = combat.validTargets(SHOVE_PUSH_ID).map((id) => combat.creature(id) as Creature);
  const roll = jitter(`${c.id}:shove`, combat.round);
  let best: { cmd: Command; value: number; attack: number; share: number; sure: number } | null = null;
  for (const t of targets) {
    if (t.dead || t.hp <= 0) continue;
    const fail = combat.hitChance(SHOVE_PUSH_ID, t.id) ?? 0;
    // With Multiattack the shove replaces only the first attack: what it costs is that attack, not the whole sequence.
    const seq = c.actions.find((a) => a.multiattack !== undefined && a.multiattack.length > 1);
    const first = seq?.multiattack ? c.actions.find((a) => a.id === (seq.multiattack as string[])[0]) : undefined;
    const attack = Math.max(0, meleeValue(ctx, t) - (first ? valueOf(combat, c, first, t) : 0));
    const plan = planPush(nav, (p) => ctx.occ(p) && !(p.x === t.pos.x && p.y === t.pos.y), t.pos, sign(t.pos.x - c.pos.x), sign(t.pos.y - c.pos.y), 1);
    // Every kind of push target counts: a drop or lava, fire or spikes (a slam), water (Prone, worth more with allies at the target).
    const alliesAtTarget = ctx.allies.filter((o) => chebyshev(o.pos, t.pos) <= 1).length;
    const pv = pushValue(plan, depth, t.hp, alliesAtTarget);
    if (pv > 0) {
      const value = fail * pv;
      if (!best || value > best.value) best = { cmd: cmd({ id: SHOVE_PUSH_ID }, { targetId: t.id }), value, attack, share: SHOVE_HAZARD_TURN_SHARE, sure: 1 };
    }
    // Knocking prone helps allies that are fighting it (advantage on their melee attacks).
    const fighting = ctx.allies.filter((o) => chebyshev(o.pos, t.pos) <= 1).length;
    if (fighting > 0 && !hasCondition(t, 'prone') && !t.conditionImmunities.includes('prone')) {
      const failTrip = combat.hitChance(SHOVE_TRIP_ID, t.id) ?? 0;
      const value = failTrip * (CONTROL_VALUE + 2.5 * fighting);
      if (!best || value > best.value) best = { cmd: cmd({ id: SHOVE_TRIP_ID }, { targetId: t.id }), value, attack, share: SHOVE_TRIP_TURN_SHARE, sure: SHOVE_TRIP_CLEAR_WIN };
    }
  }
  if (!best) return null;
  return best.value >= best.attack * best.sure || roll < best.share ? best.cmd : null;
}

// ------------------------------------------------------------------- brute

function bruteCommand(ctx: Ctx): Command | null {
  return shoveChoice(ctx);
}

// ----------------------------------------------------------- archer and caster

function rangedCell(ctx: Ctx, p: GridPos, cost: number, range: number): number {
  const { nav, hostiles } = ctx;
  const near = nearestDist(ctx, p);
  let s = -cost * 0.3;
  if (canShootFrom(ctx, p, range)) {
    s += 20 + Math.min(near, 5) * 2;
  } else {
    s -= near;
  }
  s -= adjacentHostiles(ctx, p).length * 12;
  s += coverAgainst(ctx, p) * 1.2;
  const target = hostiles.reduce<Creature | undefined>((b, h) => (!b || chebyshev(p, h.pos) < chebyshev(p, b.pos) ? h : b), undefined);
  if (target) {
    const up = nav.elevationAt(p) - nav.elevationAt(target.pos);
    if (up >= 2) s += 3 + Math.min(up, 4) * 0.5;
  }
  if (exposed(ctx, p)) s -= 6;
  return s;
}

function rangedCommand(ctx: Ctx): Command | null {
  const { combat, c } = ctx;
  const options = rangedOptions(ctx);
  if (options.length === 0) return null; // nothing to keep a distance for: fights as a brute
  const turn = combat.turn;
  const range = strikeRange(ctx, options);
  const here = rangedCell(ctx, c.pos, 0, range);
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of cells(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
    const s = rangedCell(ctx, cell.pos, cell.cost, range);
    if (!best || s > best.score) best = { pos: cell.pos, score: s };
  }
  const touching = adjacentHostiles(ctx, c.pos).length > 0;
  const margin = turn.actionUsed ? 4 : 2;
  const worthMoving = best !== undefined && best.score > here + margin && turn.movementLeft > 0 && ctx.mem.moves < MOVES_PER_TURN;
  if (worthMoving && best) {
    if (!touching || leavingIsFree(ctx)) {
      const m = moveTo(ctx, best.pos);
      if (m) return m;
    } else {
      const d = freeDisengage(ctx);
      if (d) return d;
    }
  }
  if (!turn.actionUsed) {
    // A caster at range uses its best area or spell; an archer its best shot. Melee only when nothing else will do.
    const shot = strikeNow(ctx, touching);
    if (shot) return shot;
  }
  return null;
}

// ---------------------------------------------------------------- skirmisher

function protection(ctx: Ctx, t: Creature): number {
  const defenders = ctx.combat.creatures().filter((o) => isAlive(o) && o !== t && !areHostile(t, o) && chebyshev(o.pos, t.pos) <= 1).length;
  return t.ac + 2 * defenders;
}

function skirmisherCommand(ctx: Ctx): Command | null {
  const { combat, c, hostiles } = ctx;
  const turn = combat.turn;
  // Goblins and their kin already have the hit-and-run of Nimble Escape with a bow (ai.ts).
  if (c.traits.includes('nimbleEscape') && rangedOptions(ctx).length > 0) return null;
  if (!turn.actionUsed) {
    const scored = hostiles
      .map((t) => ({ t, s: meleeValue(ctx, t) * 0.5 - protection(ctx, t) * 0.4 + 3 * ctx.allies.filter((o) => chebyshev(o.pos, t.pos) <= 1).length - 0.15 * chebyshev(c.pos, t.pos) }))
      .sort((a, b) => b.s - a.s);
    const target = scored[0]?.t;
    if (!target) return null;
    const melee = c.actions.filter((a) => isOffense(a) && isMeleeOption(c, a) && combat.canUse(a.id).ok && combat.validTargets(a.id).includes(target.id));
    const strike = melee.reduce<ActionDef | undefined>((b, a) => (!b || valueOf(combat, c, a, target) > valueOf(combat, c, b, target) ? a : b), undefined);
    if (strike) return cmd(strike, { targetId: target.id });
    if (turn.movementLeft > 0 && ctx.mem.moves < MOVES_PER_TURN && melee.length === 0 && c.actions.some((a) => isOffense(a) && isMeleeOption(c, a))) {
      let best: { pos: GridPos; score: number } | undefined;
      for (const cell of cells(ctx)) {
        if (cell.cost === 0 || ctx.occ(cell.pos) || chebyshev(cell.pos, target.pos) > 1) continue;
        const s = -cell.cost - 3 * adjacentHostiles(ctx, cell.pos).filter((h) => h !== target).length - (exposed(ctx, cell.pos) ? 4 : 0);
        if (!best || s > best.score) best = { pos: cell.pos, score: s };
      }
      if (best) {
        const m = moveTo(ctx, best.pos);
        if (m) return m;
      }
    }
    return null;
  }
  // After striking: withdraw when it provokes nothing (or after a free Disengage), out of the enemies' reach.
  if (turn.movementLeft > 0 && !ctx.mem.retreated && ctx.mem.moves < MOVES_PER_TURN && adjacentHostiles(ctx, c.pos).length > 0) {
    let best: { pos: GridPos; score: number } | undefined;
    for (const cell of cells(ctx)) {
      if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
      const near = nearestDist(ctx, cell.pos);
      if (near < 2) continue;
      const s = Math.min(near, 6) * 3 - cell.cost * 0.2 - (exposed(ctx, cell.pos) ? 5 : 0) + coverAgainst(ctx, cell.pos);
      if (!best || s > best.score) best = { pos: cell.pos, score: s };
    }
    if (best) {
      if (leavingIsFree(ctx)) {
        ctx.mem.retreated = true;
        const m = moveTo(ctx, best.pos);
        if (m) return m;
      } else {
        const d = freeDisengage(ctx);
        if (d) return d;
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------- leader

/** Allies standing between a cell and a hostile: near the straight line and closer than the hostile. */
function screened(ctx: Ctx, p: GridPos, h: Creature): boolean {
  const dh = chebyshev(p, h.pos);
  return ctx.allies.some((a) => {
    if (chebyshev(p, a.pos) >= dh) return false;
    const vx = h.pos.x - p.x;
    const vy = h.pos.y - p.y;
    const len2 = vx * vx + vy * vy;
    if (len2 === 0) return false;
    const t = ((a.pos.x - p.x) * vx + (a.pos.y - p.y) * vy) / len2;
    if (t <= 0 || t >= 1) return false;
    const px = p.x + t * vx - a.pos.x;
    const py = p.y + t * vy - a.pos.y;
    return Math.hypot(px, py) <= 1.2;
  });
}

function leaderCell(ctx: Ctx, p: GridPos, cost: number, range: number): number {
  const { hostiles } = ctx;
  let s = -cost * 0.3;
  for (const h of hostiles) if (screened(ctx, p, h)) s += 6;
  s += Math.min(nearestDist(ctx, p), 6) * 1.2;
  s -= adjacentHostiles(ctx, p).length * 14;
  if (range > 0 && canShootFrom(ctx, p, range)) s += 10;
  if (exposed(ctx, p)) s -= 6;
  return s;
}

function leaderCommand(ctx: Ctx): Command | null {
  const { combat, c } = ctx;
  const turn = combat.turn;
  const alone = ctx.allies.filter((a) => isAlive(a)).length === 0;
  if (alone || combat.round > PATIENCE_ROUNDS) return bruteCommand(ctx);
  const options = rangedOptions(ctx);
  const range = strikeRange(ctx, options);
  const here = leaderCell(ctx, c.pos, 0, range);
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of cells(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
    const s = leaderCell(ctx, cell.pos, cell.cost, range);
    if (!best || s > best.score) best = { pos: cell.pos, score: s };
  }
  const touching = adjacentHostiles(ctx, c.pos).length > 0;
  if (best && best.score > here + 2 && turn.movementLeft > 0 && ctx.mem.moves < MOVES_PER_TURN) {
    if (!touching || leavingIsFree(ctx)) {
      const m = moveTo(ctx, best.pos);
      if (m) return m;
    } else {
      const d = freeDisengage(ctx);
      if (d) return d;
    }
  }
  if (touching) return bruteCommand(ctx); // cornered: fights (the generic AI attacks what is adjacent)
  if (!turn.actionUsed) {
    const shot = strikeNow(ctx, false);
    if (shot) return shot;
  }
  return END; // holds its ground behind its allies
}

// -------------------------------------------------------------------- lurker

/** Steps of the shortest walk from a cell to the nearest enemy (Infinity when there is none). */
function walkDistance(ctx: Ctx, from: GridPos): number {
  let best = Infinity;
  for (const h of ctx.hostiles) {
    const path = ctx.nav.findPath(from, h.pos, { blocked: (p) => ctx.occ(p) && !(p.x === h.pos.x && p.y === h.pos.y) });
    if (path) best = Math.min(best, path.length);
  }
  return best;
}

function lurkerCommand(ctx: Ctx): Command | null {
  const { combat, nav, c, hostiles } = ctx;
  const turn = combat.turn;
  const seen = hostiles.some((h) => nav.hasLineOfSight(h.pos, c.pos));
  if (seen || c.hp < c.maxHp || combat.round > PATIENCE_ROUNDS || turn.actionUsed) return bruteCommand(ctx);
  // Can it strike this turn (reach a cell next to an enemy)? Then the generic logic does it (advantage comes from the engine).
  const reach = Math.max(1, ...c.actions.filter((a) => isOffense(a) && isMeleeOption(c, a)).map((a) => reachOf(c, a)));
  if (cells(ctx).some((cell) => hostiles.some((h) => chebyshev(cell.pos, h.pos) <= reach))) return bruteCommand(ctx);
  // Otherwise creep closer (by walking distance) along cells no enemy can see; with none, wait unseen.
  const here = walkDistance(ctx, c.pos);
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of cells(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
    if (hostiles.some((h) => nav.hasLineOfSight(h.pos, cell.pos))) continue;
    const d = walkDistance(ctx, cell.pos);
    if (d >= here) continue;
    const s = -d * 2 - cell.cost * 0.1 - (exposed(ctx, cell.pos) ? 3 : 0);
    if (!best || s > best.score) best = { pos: cell.pos, score: s };
  }
  if (best && turn.movementLeft > 0 && ctx.mem.moves < MOVES_PER_TURN) {
    const m = moveTo(ctx, best.pos);
    if (m) return m;
  }
  return END;
}

// --------------------------------------------------------------------- guard

function guardCommand(ctx: Ctx): Command | null {
  const { combat, c, hostiles } = ctx;
  const m = ctx.mem;
  const trigger = Math.max(4, ...c.actions.filter((a) => isOffense(a) && isMeleeOption(c, a)).map((a) => reachOf(c, a)));
  if (!m.alerted && (c.hp < c.maxHp || hostiles.some((h) => chebyshev(c.pos, h.pos) <= trigger))) m.alerted = true;
  if (m.alerted) return bruteCommand(ctx);
  // Holding the post: shoot from it if there is something to shoot at, else wait.
  if (!combat.turn.actionUsed && rangedOptions(ctx).length > 0) {
    const shot = strikeNow(ctx, false);
    if (shot) return shot;
    // Nothing in range from the post: step (at most 3 cells from it) to a cell it can shoot from.
    if (combat.turn.movementLeft > 0 && m.moves < MOVES_PER_TURN) {
      const range = strikeRange(ctx, rangedOptions(ctx));
      let best: { pos: GridPos; score: number } | undefined;
      for (const cell of cells(ctx)) {
        if (cell.cost === 0 || ctx.occ(cell.pos) || chebyshev(cell.pos, m.start) > 3 || !canShootFrom(ctx, cell.pos, range)) continue;
        const sc = -chebyshev(cell.pos, m.start) - (exposed(ctx, cell.pos) ? 4 : 0);
        if (!best || sc > best.score) best = { pos: cell.pos, score: sc };
      }
      if (best) {
        const mv = moveTo(ctx, best.pos);
        if (mv) return mv;
      }
    }
  }
  return END;
}

import type { ActionDef, CombatApi, Command, CompanionStance, Creature, GridPos, NavGrid } from '../core/types';
import { SHOVE_PUSH_ID } from './actions';
import { KILL_BONUS, chooseCommand, damageAgainst, isOffense, typeFactor, valueOf } from './ai';
import { attacksLeft, combatDepth } from './combat';
import { hasCondition } from './conditions';
import { getCompanion } from './companion';
import { spellCommand } from './spellPolicy';
import { averageDice } from './dice';
import { archerRetreat, heroUpkeep } from './sim';
import { creatureTactic } from './tactics';
import { TERRAIN_TUNING, exposedToPush, planPush, pushValue, type PushPlan } from './terrain';
import { areHostile, chebyshev, isAlive } from './util';

/**
 * The EXPERT scripted hero: the specification of what "good play" means in this game, and the yardstick the balance
 * harness uses against the naive `playerPolicy`. Same signature, same upkeep (healing, Second Wind, Action Surge,
 * off-hand attacks); what differs is how it fights, in this order each time it is asked:
 *
 *  1. Hold a chokepoint when outnumbered. With three or more melee enemies and none next to it, it steps to (or
 *     stays on) a cell where at most two enemies can reach it, and Dodges for up to two rounds to let them come.
 *  2. Use the terrain. It shoves an adjacent enemy into a drop or lava (Shove: Push) when the odds and the depth make
 *     that worth more than its attack, prefers the Push-mastery weapon and Thunderwave when they send an enemy in,
 *     and steps to the cell from which such a shove is possible when the shove is worth it and the step is free.
 *  3. Choose its target by worth, not by who is nearest: casters, leaders and healers first when reachable, then
 *     whoever it can kill, then the wounded.
 *  4. Move well. It closes on the target it wants, takes cover (and avoids standing where an enemy could shove it into
 *     a drop) on the way, and keeps away from hazard edges when a brute is next to it. It never leaves an enemy's reach
 *     for a small gain (that provokes an opportunity attack).
 *
 * It reads the same combat state a player sees (positions, hit chances, hazards, cover); it never reads the dice.
 */

const HOLD_ROUNDS = 2;

/** Behaviours of the expert that can be switched off one at a time (the ablation harness in src/balance does this). All default to on. */
export interface ExpertOptions {
  /** Hold a real chokepoint when outnumbered by approaching melee enemies. OFF by default: measured at -6 clears on floor 6 and neutral elsewhere. */
  hold?: boolean;
  /** Step to a cell from which a Shove: Push sends an enemy into a hazard. */
  setup?: boolean;
  /** Step away from a drop edge when a brute could shove the hero over it. */
  safe?: boolean;
  /** Target casters, leaders, healers and archers first. */
  priority?: boolean;
  /** Focus fire: prefer the wounded and the killable. */
  focus?: boolean;
  /** Throw a javelin at an adjacent enemy that resists the sword (never to stay at range). */
  throws?: boolean;
  /** Approach shooters through cover. */
  cover?: boolean;
  /** Play a ranged hero as an archer: keep range, use cover and height, kite, melee only when cornered. */
  archer?: boolean;
  /** Shove enemies (Shove: Push, Push mastery bonus, Thunderwave) into hazards. */
  shove?: boolean;
  /** Use the Shove: Push action itself (off: only Push-mastery weapons, Tactical Master and Thunderwave push; an experiment switch). */
  shoveAction?: boolean;
}
const ALL_ON: Required<ExpertOptions> = { hold: false, setup: true, safe: true, priority: true, focus: true, throws: true, cover: true, shove: true, shoveAction: true, archer: true };

interface HoldMemory {
  round: number;
  count: number;
  lastMin: number;
  prevMin: number | undefined;
  holdingRound: number;
}
const holds = new WeakMap<CombatApi, HoldMemory>();

/** The stance an expert uses for a companion: ranged healers and blasters hang back, the skirmisher stays close. */
export function expertStance(companionId: string): CompanionStance {
  const role = getCompanion(companionId)?.role;
  return role === 'skirmisher' ? 'close' : 'back';
}

const isWeapon = (a: ActionDef): boolean => !!a.attack && !a.effects?.includes('spell') && !a.effects?.includes('offhand') && (a.id.startsWith('atk_') || a.id.startsWith('throw_') || a.id === 'unarmed');

interface Ctx {
  o: Required<ExpertOptions>;
  /** The hero fights mainly with a ranged weapon (the Archer kit): it keeps its distance and shoots. */
  archer: boolean;
  combat: CombatApi;
  nav: NavGrid;
  c: Creature;
  enemies: Creature[];
  allies: Creature[];
  depth: number;
  occ: (p: GridPos) => boolean;
}

const cmd = (a: { id: string }, extra: { targetId?: string; point?: GridPos } = {}): Command => {
  const out: Command = { type: 'action', actionId: a.id };
  if (extra.targetId !== undefined) out.targetId = extra.targetId;
  if (extra.point !== undefined) out.point = extra.point;
  return out;
};

/** What a push is worth to the shover: a fall or lava, a slam into fire or spikes, water's Prone, a kill when it would die. */
function pushVal(ctx: Ctx, plan: PushPlan, target: Creature): number {
  const near = ctx.allies.filter((a) => a.faction !== 'player' && chebyshev(a.pos, target.pos) <= 1).length + 1;
  const turnValue = Math.max(0, ...target.actions.map((a) => (a.damage ?? []).reduce((s, d) => s + averageDice(d.dice), 0) * (a.multiattack ? a.multiattack.length : 1)));
  const minion = target.faction === 'enemy' && target.level < ctx.depth / 4;
  return pushValue(plan, ctx.depth, target.hp, near, (ty) => typeFactor(target, ty), { minion, turnValue });
}

/** How much the expert wants this enemy dead first. */
function priority(ctx: Ctx, e: Creature): number {
  let p = 0;
  const t = ctx.o.priority ? creatureTactic(e) : undefined;
  if (t === 'caster') p += 8;
  else if (t === 'leader') p += 6;
  else if (t === 'archer') p += 4;
  if (e.actions.some((a) => a.heal)) p += 8;
  if (ctx.o.focus) p += 6 * (1 - e.hp / e.maxHp);
  // An archer shoots first whatever would hurt it most: the enemies that can reach it this turn, by what they deal.
  if (ctx.archer && chebyshev(ctx.c.pos, e.pos) <= e.speed + 1) {
    const dmg = Math.max(0, ...e.actions.map((a) => (a.multiattack ? a.multiattack.reduce((t, id) => t + damageOf(e, id), 0) : (a.damage ?? []).reduce((t, d) => t + averageDice(d.dice), 0))));
    p += Math.min(6, dmg / 5);
  }
  return p;
}

function damageOf(e: Creature, id: string): number {
  const a = e.actions.find((x) => x.id === id);
  return a ? (a.damage ?? []).reduce((t, d) => t + averageDice(d.dice), 0) : 0;
}

const isRangedEnemy = (e: Creature): boolean => e.actions.some((a) => isOffense(a) && a.targeting.kind === 'creature' && !a.targeting.melee && a.targeting.range >= 4);

/** Experiment (flanking rule): a step to a cell next to an enemy with an ally directly opposite it, when nobody is flanked yet. */
function flankStep(ctx: Ctx): Command | null {
  const { c, enemies, allies } = ctx;
  const flankedNow = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1 && allies.some((a) => a.pos.x === 2 * e.pos.x - c.pos.x && a.pos.y === 2 * e.pos.y - c.pos.y));
  if (flankedNow) return null;
  const touching = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
  let best: { pos: GridPos; cost: number } | undefined;
  for (const cell of cellsHere(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos) || (touching && !freeStep(ctx, cell.pos))) continue;
    for (const e of enemies) {
      if (chebyshev(cell.pos, e.pos) !== 1) continue;
      const ox = 2 * e.pos.x - cell.pos.x;
      const oy = 2 * e.pos.y - cell.pos.y;
      if (!allies.some((a) => a.faction === 'ally' && a.pos.x === ox && a.pos.y === oy)) continue;
      if (exposedToPush(ctx.nav, cell.pos, enemies)) continue;
      if (!best || cell.cost < best.cost) best = cell;
    }
  }
  return best ? stepTo(ctx, best.pos) : null;
}

function sign(n: number): number {
  return Math.sign(n);
}

/**
 * How many enemies can reach a creature standing on a cell p at once: the walkable cells next to it that an enemy can walk
 * to without passing through p (a doorway or corridor leaves one or two; open ground eight).
 */
function openNeighbors(ctx: Ctx, p: GridPos): number {
  const ring: GridPos[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const q = { x: p.x + dx, y: p.y + dy };
      if (ctx.nav.inBounds(q) && ctx.nav.isWalkable(q) && !ctx.allies.some((a) => a.pos.x === q.x && a.pos.y === q.y)) ring.push(q);
    }
  }
  const reach = new Set<string>();
  for (const e of ctx.enemies) {
    if (chebyshev(e.pos, p) > 24) continue;
    for (const cell of ctx.nav.reachable(e.pos, 24, { blocked: (q) => q.x === p.x && q.y === p.y })) reach.add(cell.pos.x + ',' + cell.pos.y);
  }
  return ring.filter((q) => reach.has(q.x + ',' + q.y)).length;
}

/** Whether any enemy is within a move and a sword stroke (so a javelin would be a worse use of the turn). */
function canReachInMelee(ctx: Ctx): boolean {
  const reach = ctx.combat.turn.movementLeft + 1;
  return ctx.enemies.some((e) => chebyshev(ctx.c.pos, e.pos) <= reach);
}

function cellsHere(ctx: Ctx): { pos: GridPos; cost: number }[] {
  return [{ pos: ctx.c.pos, cost: 0 }, ...ctx.combat.reachable()];
}

function stepTo(ctx: Ctx, to: GridPos): Command | null {
  if (to.x === ctx.c.pos.x && to.y === ctx.c.pos.y) return null;
  const path = ctx.nav.findPath(ctx.c.pos, to, { blocked: ctx.occ, maxCost: ctx.combat.turn.movementLeft });
  return path && path.length > 0 ? { type: 'move', path } : null;
}

/** Leaving every enemy that is next to us provokes; a cell is a free step when it stays next to all of them (or none is adjacent). */
function freeStep(ctx: Ctx, to: GridPos): boolean {
  if (hasCondition(ctx.c, 'disengaged')) return true;
  return ctx.enemies.filter((e) => chebyshev(ctx.c.pos, e.pos) <= 1).every((e) => chebyshev(to, e.pos) <= 1);
}

// ----------------------------------------------------------------- strike plays

interface Play {
  command: Command;
  value: number;
}

/** The best use of the attacks it has left from where it stands, including shoves and pushes into hazards. */
function bestStrike(ctx: Ctx): Play | null {
  const { combat, c } = ctx;
  let best: Play | null = null;
  const consider = (command: Command, value: number): void => {
    if (!best || value > best.value) best = { command, value };
  };
  // Thrown javelins are for a hero with nothing better: a fighter with a sword closes in rather than lobbing them.
  const hasMelee = c.actions.some((x) => x.id.startsWith('atk_') && x.targeting.kind === 'creature' && x.targeting.melee);
  for (const a of c.actions) {
    if (!isWeapon(a) || !combat.canUse(a.id).ok) continue;
    const thrown = hasMelee && a.id.startsWith('throw_');
    // A javelin is for when the sword is the wrong tool (a slashing-resistant ooze next to us), never for staying at range.
    if (thrown && !ctx.o.throws) continue;
    const closeIn = canReachInMelee(ctx);
    // Lobbing javelins from range instead of closing in only gives the enemy free turns: measured, it costs clears.
    if (thrown && !closeIn) continue;
    // Push mastery, or Tactical Master (the engine picks Push when it lands the target in a hazard): a hit can push the target.
    const push = a.effects?.includes('mastery:push') === true || (a.effects?.some((e) => e.startsWith('tmOwn:')) === true && c.resources['_tacticalMaster'] !== undefined);
    for (const id of combat.validTargets(a.id)) {
      const e = combat.creature(id) as Creature;
      if (thrown && closeIn) {
        // Only when the sword's damage type is resisted or immune and the javelin's is not.
        const swordType = c.actions.find((m) => m.id.startsWith('atk_') && m.targeting.kind === 'creature' && m.targeting.melee)?.damage?.[0]?.type;
        const throwType = a.damage?.[0]?.type;
        if (!swordType || !throwType || !(typeFactor(e, swordType) <= 0.5 && typeFactor(e, throwType) > 0.5)) continue;
      }
      let v = valueOf(combat, c, a, e) + priority(ctx, e);
      // Two-weapon fighting: a Light main-hand attack earns the off-hand attack that follows it (heroUpkeep makes it).
      if (a.effects?.includes('lightAttack')) {
        const off = c.actions.find((x) => x.effects?.includes('offhand'));
        if (off) v += damageAgainst(off, e) * (combat.hitChance(a.id, e.id) ?? 0.6) * 0.9;
      }
      if (ctx.o.shove && push && chebyshev(c.pos, e.pos) <= 1) {
        const plan = planPush(ctx.nav, (p) => ctx.occ(p) && !(p.x === e.pos.x && p.y === e.pos.y), e.pos, sign(e.pos.x - c.pos.x), sign(e.pos.y - c.pos.y), 2);
        v += (combat.hitChance(a.id, e.id) ?? 0.5) * pushVal(ctx, plan, e);
      }
      consider(cmd(a, { targetId: id }), v);
    }
  }
  // Shove: Push into a hazard.
  if (ctx.o.shove && ctx.o.shoveAction && combat.canUse(SHOVE_PUSH_ID).ok) {
    for (const id of combat.validTargets(SHOVE_PUSH_ID)) {
      const e = combat.creature(id) as Creature;
      const plan = planPush(ctx.nav, (p) => ctx.occ(p) && !(p.x === e.pos.x && p.y === e.pos.y), e.pos, sign(e.pos.x - c.pos.x), sign(e.pos.y - c.pos.y), 1);
      const pv = pushVal(ctx, plan, e);
      if (pv <= 0) continue;
      const fail = combat.hitChance(SHOVE_PUSH_ID, id) ?? 0;
      consider(cmd({ id: SHOVE_PUSH_ID }, { targetId: id }), fail * pv + priority(ctx, e));
    }
  }
  // Thunderwave and the like: an area that pushes (never one that would catch a friend).
  for (const a of c.actions) {
    if (!ctx.o.shove || !a.effects?.includes('thunderwavePush') || a.targeting.kind !== 'point' || !combat.canUse(a.id).ok) continue;
    for (const aim of ctx.enemies) {
      if (a.targeting.range > 0 && chebyshev(c.pos, aim.pos) > a.targeting.range) continue;
      const area = combat.areaCells(a.id, aim.pos);
      const inside = combat.creatures().filter((o) => isAlive(o) && o !== c && area.some((q) => q.x === o.pos.x && q.y === o.pos.y));
      if (inside.some((o) => !areHostile(c, o))) continue;
      let v = 0;
      for (const o of inside) {
        v += valueOf(combat, c, a, o) + priority(ctx, o);
        const plan = planPush(ctx.nav, () => false, o.pos, sign(o.pos.x - c.pos.x), sign(o.pos.y - c.pos.y), 2);
        v += (combat.hitChance(a.id, o.id) ?? 0.5) * pushVal(ctx, plan, o);
      }
      if (inside.length > 0) consider(cmd(a, { point: aim.pos }), v);
    }
  }
  return best;
}

/** A cell from which a Shove: Push would send an enemy into a hazard, worth stepping to. */
function shoveSetup(ctx: Ctx, baseline: number): { pos: GridPos; value: number } | null {
  const { combat } = ctx;
  if (!ctx.o.shoveAction || ctx.c.actions.length === 0 || combat.turn.actionUsed || combat.turn.movementLeft <= 0) return null;
  let best: { pos: GridPos; value: number } | null = null;
  for (const cell of cellsHere(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos) || !freeStep(ctx, cell.pos)) continue;
    for (const e of ctx.enemies) {
      if (chebyshev(cell.pos, e.pos) !== 1 || e.size === 'huge') continue;
      const plan = planPush(ctx.nav, (p) => ctx.occ(p) && !(p.x === e.pos.x && p.y === e.pos.y), e.pos, sign(e.pos.x - cell.pos.x), sign(e.pos.y - cell.pos.y), 1);
      const pv = pushVal(ctx, plan, e);
      if (pv <= 0) continue;
      const fail = combat.hitChance(SHOVE_PUSH_ID, e.id) ?? 0.5;
      let v = fail * pv + priority(ctx, e) - (exposedToPush(ctx.nav, cell.pos, ctx.enemies) ? 4 : 0);
      v -= cell.cost * 0.2;
      if (v > baseline * 1.1 && (!best || v > best.value)) best = { pos: cell.pos, value: v };
    }
  }
  return best;
}

// ----------------------------------------------------------------------- moving

/** Value of a cell for fighting from: what it can strike, how exposed it is, cover from ranged enemies, a chokepoint. */
function cellValue(ctx: Ctx, p: GridPos, cost: number, outnumbered: boolean): number {
  const { c, combat, nav, enemies } = ctx;
  let best = 0;
  for (const a of c.actions) {
    if (!isWeapon(a) || a.targeting.kind !== 'creature') continue;
    const reach = a.targeting.melee ? a.targeting.range : (a.targeting.longRange ?? a.targeting.range);
    for (const e of enemies) {
      const d = chebyshev(p, e.pos);
      if (d > reach || (d > 1 && !nav.hasLineOfSight(p, e.pos))) continue;
      const hit = combat.hitChance(a.id, e.id) ?? 0.5;
      best = Math.max(best, damageAgainst(a, e) * hit + priority(ctx, e) + (damageAgainst(a, e) * hit >= e.hp ? KILL_BONUS : 0));
    }
  }
  let s = best - cost * 0.2;
  const adjacent = enemies.filter((e) => chebyshev(p, e.pos) <= 1).length;
  s -= Math.max(0, adjacent - 1) * 2.5;
  if (exposedToPush(nav, p, enemies)) s -= 5;
  // Cover against ranged enemies in sight.
  let cover = 0;
  for (const e of enemies) if (isRangedEnemy(e) && chebyshev(p, e.pos) >= 2 && nav.hasLineOfSight(e.pos, p)) cover = Math.max(cover, nav.coverBetween(e.pos, p));
  s += cover * 0.8;
  if (outnumbered && openNeighbors(ctx, p) <= 2) s += 6;
  return s;
}

/** Walking steps from a cell to the nearest of the wanted enemies. */
function walkTo(ctx: Ctx, from: GridPos, wanted: Creature[]): number {
  let best = Infinity;
  for (const e of wanted) {
    const path = ctx.nav.findPath(from, e.pos, { blocked: (p) => ctx.occ(p) && !(p.x === e.pos.x && p.y === e.pos.y) });
    if (path) best = Math.min(best, path.length);
  }
  return best;
}

// ------------------------------------------------------------------------ policy

/** Hold a REAL chokepoint (at most two cells from which enemies can reach the hero) within one move, and only when it is safe to wait. */
function holdPlan(ctx: Ctx, mem: HoldMemory): Command | null {
  const { combat, c, nav, enemies } = ctx;
  const turn = combat.turn;
  const touching = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
  const melee = enemies.filter((e) => !isRangedEnemy(e));
  // Only against a crowd of melee enemies, none of whom shoots the hero while he waits, who are really coming.
  if (melee.length < 3 || melee.length !== enemies.length || touching) return null;
  const approaching = mem.prevMin === undefined || mem.lastMin < mem.prevMin;
  if (!approaching || mem.count >= HOLD_ROUNDS + 1) return null;
  const buddies = ctx.allies.filter((a) => a.faction === 'ally');
  const here = openNeighbors(ctx, c.pos);
  if (here <= 2) {
    mem.holdingRound = combat.round;
    if (turn.actionUsed) return { type: 'endTurn' };
    const shot = bestStrike(ctx);
    if (shot) return shot.command;
    return combat.canUse('dodge').ok ? { type: 'action', actionId: 'dodge' } : null;
  }
  if (turn.actionUsed || turn.movementLeft <= 0 || mem.count >= HOLD_ROUNDS) return null;
  let spot: { pos: GridPos; score: number } | undefined;
  for (const cell of cellsHere(ctx)) {
    if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
    if (openNeighbors(ctx, cell.pos) > 2 || exposedToPush(nav, cell.pos, enemies)) continue;
    // The companion must not be left out in the open behind the hero's back: it stays within 3 cells of the spot.
    if (buddies.some((b) => chebyshev(b.pos, cell.pos) > 3)) continue;
    const score = -cell.cost * 0.3 - Math.min(...enemies.map((e) => chebyshev(cell.pos, e.pos))) * 0.2;
    if (!spot || score > spot.score) spot = { pos: cell.pos, score };
  }
  if (!spot) return null;
  mem.holdingRound = combat.round;
  return stepTo(ctx, spot.pos);
}

// -------------------------------------------------------------------------------- the Archer

/** The main ranged weapon attack (the longbow), if the hero has one and shoots better than it fights. */
function rangedWeapon(c: Creature): ActionDef | undefined {
  return c.actions.find((a) => a.id.startsWith('atk_') && a.targeting.kind === 'creature' && !a.targeting.melee);
}

function isArcher(c: Creature): boolean {
  return rangedWeapon(c) !== undefined && c.abilities.dex >= c.abilities.str;
}

/** How good a cell is to shoot from: in range with a clear line, out of melee, behind cover, on high ground, off the drop edges. */
function archerCell(ctx: Ctx, p: GridPos, cost: number, range: number): number {
  const { nav, enemies } = ctx;
  const near = Math.min(...enemies.map((e) => chebyshev(p, e.pos)));
  let s = -cost * 0.3;
  const canShoot = enemies.some((e) => chebyshev(p, e.pos) <= range && (chebyshev(p, e.pos) <= 1 || nav.hasLineOfSight(p, e.pos)));
  if (canShoot) s += 20 + Math.min(near, 5) * 2;
  else s -= near;
  s -= enemies.filter((e) => chebyshev(p, e.pos) <= 1).length * 12;
  // Enemies that could reach the cell next turn threaten it: the farther the better.
  s -= enemies.filter((e) => chebyshev(p, e.pos) <= e.speed + 1 && !isRangedEnemy(e)).length * 1.5;
  let cover = 0;
  for (const e of enemies) if (chebyshev(p, e.pos) >= 2 && nav.hasLineOfSight(e.pos, p)) cover = Math.max(cover, nav.coverBetween(e.pos, p));
  s += cover * 1.2;
  const nearest = enemies.reduce((b, e) => (chebyshev(p, e.pos) < chebyshev(p, b.pos) ? e : b), enemies[0] as Creature);
  const up = nav.elevationAt(p) - nav.elevationAt(nearest.pos);
  if (up >= 2) s += 3 + Math.min(up, 4) * 0.5;
  if (exposedToPush(nav, p, enemies)) s -= 6;
  return s;
}

/** A firing cell must beat the current one by this much to be worth a step (stepping away from the companion costs). */
export const ARCHER_MOVE_MARGIN = { value: 12 };

/** The Archer's turn: step to a better firing cell first, shoot, then kite; blades only when it cannot get away. Null: fall through. */
function archerCommand(ctx: Ctx): Command | null {
  const { combat, c, enemies } = ctx;
  const bow = rangedWeapon(c) as ActionDef;
  const range = bow.targeting.kind === 'creature' ? bow.targeting.range : 8;
  const turn = combat.turn;
  const touching = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
  const here = archerCell(ctx, c.pos, 0, range);
  const striking = !turn.actionUsed || attacksLeft(combat) > 0;
  const betterCell = (margin: number): GridPos | null => {
    let best: { pos: GridPos; score: number } | undefined;
    for (const cell of cellsHere(ctx)) {
      if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
      const sc = archerCell(ctx, cell.pos, cell.cost, range);
      if (!best || sc > best.score) best = { pos: cell.pos, score: sc };
    }
    return best && best.score > here + margin ? best.pos : null;
  };
  if (striking) {
    // Before the first shot: a better firing cell, if leaving provokes nothing.
    if (!turn.actionUsed && turn.movementLeft > 0 && (!touching || canLeaveFree(ctx))) {
      const cell = betterCell(ARCHER_MOVE_MARGIN.value);
      if (cell) {
        const m = stepTo(ctx, cell);
        if (m) return m;
      }
    }
    const strike = bestStrike(ctx);
    if (strike) return strike.command;
    return null;
  }
  // After the attacks: kite along the room if that provokes nothing.
  if (turn.movementLeft > 0 && (!touching || canLeaveFree(ctx))) {
    const cell = betterCell(ARCHER_MOVE_MARGIN.value);
    if (cell) {
      const m = stepTo(ctx, cell);
      if (m) return m;
    }
  }
  return { type: 'endTurn' };
}

/** Walking away from the enemies next to the hero provokes nothing: none is adjacent, they are all helpless, or the hero Disengaged. */
function canLeaveFree(ctx: Ctx): boolean {
  if (hasCondition(ctx.c, 'disengaged')) return true;
  return ctx.enemies.filter((e) => chebyshev(ctx.c.pos, e.pos) <= 1).every((e) => e.conditions.some((x) => ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(x.condition)));
}

export function makeExpertPolicy(options: ExpertOptions = {}): (combat: CombatApi, nav: NavGrid) => Command {
  const o: Required<ExpertOptions> = { ...ALL_ON, ...options };
  return (combat, nav) => {
    const c = combat.creature(combat.activeId) as Creature;
    const upkeep = heroUpkeep(combat, c);
    if (upkeep) return upkeep;
    const others = combat.creatures().filter((x) => isAlive(x) && x !== c);
    const enemies = others.filter((x) => areHostile(c, x));
    if (enemies.length === 0) return chooseCommand(combat, nav);
    const ctx: Ctx = {
      o,
      archer: o.archer && isArcher(c),
      combat,
      nav,
      c,
      enemies,
      allies: others.filter((x) => !areHostile(c, x)),
      depth: combatDepth(combat),
      occ: (p) => others.some((x) => x.pos.x === p.x && x.pos.y === p.y),
    };
    const turn = combat.turn;
    const striking = !turn.actionUsed || attacksLeft(combat) > 0;
    const touching = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);

    // Spells (Magic Initiate) follow the shared spell logic.
    const cast = spellCommand(combat, c);
    if (cast) return cast;

    // The Archer plays from range (see archerCommand).
    if (ctx.archer) {
      const shot = archerCommand(ctx);
      if (shot) return shot;
    }

    // 1. Hold a real chokepoint against an approaching melee crowd.
    let mem = holds.get(combat);
    if (!mem) holds.set(combat, (mem = { round: -1, count: 0, lastMin: 99, prevMin: undefined, holdingRound: -1 }));
    if (mem.round !== combat.round) {
      if (mem.holdingRound === mem.round) mem.count += 1;
      mem.prevMin = mem.round === -1 ? undefined : mem.lastMin;
      mem.lastMin = Math.min(...enemies.map((e) => chebyshev(c.pos, e.pos)));
      mem.round = combat.round;
    }
    if (o.hold) {
      const hold = holdPlan(ctx, mem);
      if (hold) return hold;
    }
    const outnumbered = enemies.filter((e) => !isRangedEnemy(e)).length >= 3;

    // Experiment variants: a Shove that is a bonus action is made on top of the attacks, and flanking is worth a step.
    if (TERRAIN_TUNING.shoveBonusAction && o.shoveAction && !turn.bonusUsed && combat.canUse(SHOVE_PUSH_ID).ok) {
      let pick: { id: string; v: number } | undefined;
      for (const id of combat.validTargets(SHOVE_PUSH_ID)) {
        const e = combat.creature(id) as Creature;
        const plan = planPush(nav, (p) => ctx.occ(p) && !(p.x === e.pos.x && p.y === e.pos.y), e.pos, sign(e.pos.x - c.pos.x), sign(e.pos.y - c.pos.y), 1);
        const pv = pushVal(ctx, plan, e) * (combat.hitChance(SHOVE_PUSH_ID, id) ?? 0);
        if (pv > 2 && (!pick || pv > pick.v)) pick = { id, v: pv };
      }
      if (pick) return { type: 'action', actionId: SHOVE_PUSH_ID, targetId: pick.id };
    }
    if (TERRAIN_TUNING.flanking && !turn.actionUsed && turn.movementLeft > 0) {
      const flank = flankStep(ctx);
      if (flank) return flank;
    }

    // 2. Terrain and 3. the best target now.
    const strike = striking ? bestStrike(ctx) : null;
    if (striking) {
      const setup = o.setup ? shoveSetup(ctx, strike ? strike.value : 0) : null;
      if (setup) {
        const m = stepTo(ctx, setup.pos);
        if (m) return m;
      }
      if (strike) {
        if (o.safe && turn.movementLeft > 0 && exposedToPush(nav, c.pos, enemies)) {
          const here = cellValue(ctx, c.pos, 0, outnumbered);
          let safer: { pos: GridPos; score: number } | undefined;
          for (const cell of cellsHere(ctx)) {
            if (cell.cost === 0 || ctx.occ(cell.pos) || !freeStep(ctx, cell.pos)) continue;
            const sc = cellValue(ctx, cell.pos, cell.cost, outnumbered);
            if (sc > here + 3 && (!safer || sc > safer.score)) safer = { pos: cell.pos, score: sc };
          }
          if (safer) {
            const m = stepTo(ctx, safer.pos);
            if (m) return m;
          }
        }
        return strike.command;
      }
    }

    // 4. Nothing to strike from here: close in as the generic logic does, except that when every enemy shoots it
    // approaches through cells with cover and away from drop edges.
    if (o.cover && !turn.actionUsed && turn.movementLeft > 0 && !touching && enemies.every(isRangedEnemy)) {
      const wanted = enemies;
      const nowDist = walkTo(ctx, c.pos, wanted);
      let step: { pos: GridPos; score: number } | undefined;
      for (const cell of cellsHere(ctx)) {
        if (cell.cost === 0 || ctx.occ(cell.pos)) continue;
        const d = walkTo(ctx, cell.pos, wanted);
        if (!(d < nowDist)) continue;
        let cov = 0;
        for (const e of wanted) if (nav.hasLineOfSight(e.pos, cell.pos)) cov = Math.max(cov, nav.coverBetween(e.pos, cell.pos));
        const sc = -d * 2 + cov * 0.8 - (exposedToPush(nav, cell.pos, enemies) ? 3 : 0) - cell.cost * 0.05;
        if (!step || sc > step.score) step = { pos: cell.pos, score: sc };
      }
      if (step) {
        const m = stepTo(ctx, step.pos);
        if (m) return m;
      }
    }

    // Archers kite; everything else the shared logic.
    const kite = archerRetreat(combat, nav, c);
    if (kite) return kite;
    return chooseCommand(combat, nav);
  };
}

/** The expert hero with every behaviour on. */
export const expertPolicy: (combat: CombatApi, nav: NavGrid) => Command = makeExpertPolicy();

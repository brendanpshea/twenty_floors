import type { ActionDef, CombatApi, Command, CompanionRole, CompanionStance, Creature, GameEvent, GridPos, NavGrid } from '../core/types';
import { damageAgainst, runTurnWith } from './ai';
import { getCompanion } from './companion';
import { hasCondition } from './conditions';
import { averageDice } from './dice';
import { concentratingOn, isSpellAction } from './spells';
import { exposedToPush, nextToHazard } from './terrain';
import { areHostile, chebyshev, isAlive, isFriendlySide } from './util';

/**
 * The companion's brain. The game plays the companion; the player only picks a stance:
 *
 * - 'close': stays within 2 cells of the hero and engages what threatens the hero (enemies next to the hero first).
 * - 'back': keeps its distance (about 5 cells from enemies when it can), prefers ranged options and spells,
 *   retreats (Disengaging first when it can) rather than fighting in melee, and still heals from afar.
 * - 'focus': goes for the hero's last target (`focusTargetId`) by the best means, falling back to 'close'.
 *
 * Role behaviour sits on top: the healer heals the hero below about 60% (itself when critical) and buffs at the
 * start of hard fights; the blaster prefers areas that catch two or more enemies and NEVER aims one where it
 * would reach the hero or itself; the skirmisher sets up Sneak Attack (the hero's adjacent target, or a
 * Teleport and strike). It always terminates (same bounded loop as the monster AI), keeps clear of doorways
 * the hero may need while another cell will do, and avoids the edge of a chasm.
 */

const MOVES_PER_TURN = 2;

/** The last creature the hero attacked in a list of events, for the 'focus' stance. */
export function heroLastTarget(events: GameEvent[], heroId = 'player'): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as GameEvent;
    if (e.type === 'attackRoll' && e.attackerId === heroId && !e.reaction) return e.targetId;
    if (e.type === 'actionUsed' && e.creatureId === heroId && e.targetId !== undefined) return e.targetId;
  }
  return undefined;
}

interface Memory {
  key: string;
  moves: number;
}
const memory = new WeakMap<CombatApi, Memory>();

interface Ctx {
  combat: CombatApi;
  nav: NavGrid;
  c: Creature;
  hero: Creature | undefined;
  enemies: Creature[];
  stance: CompanionStance;
  focus: Creature | undefined;
  role: CompanionRole;
  hard: boolean;
  mem: Memory;
}

const cmd = (a: ActionDef, extra: { targetId?: string; point?: GridPos } = {}): Command => {
  const out: Command = { type: 'action', actionId: a.id };
  if (extra.targetId !== undefined) out.targetId = extra.targetId;
  if (extra.point !== undefined) out.point = extra.point;
  return out;
};

const END: Command = { type: 'endTurn' };

// -------------------------------------------------------------------- geometry

const RING: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/** A cell that splits its walkable neighbourhood in two or more arcs: a doorway or a corridor. */
export function isChokepoint(nav: NavGrid, p: GridPos): boolean {
  const open = RING.map(([dx, dy]) => nav.isWalkable({ x: p.x + dx, y: p.y + dy }));
  let arcs = 0;
  for (let i = 0; i < 8; i++) if (open[i] && !open[(i + 7) % 8]) arcs++;
  return arcs >= 2;
}

/** A cell next to an open drop or lava (hazard cells), or to a pit-like gap (not walkable, yet sight passes over it). */
export function isChasmEdge(nav: NavGrid, p: GridPos): boolean {
  if (nextToHazard(nav, p)) return true;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const q = { x: p.x + dx, y: p.y + dy };
    const beyond = { x: p.x + 2 * dx, y: p.y + 2 * dy };
    if (nav.inBounds(q) && !nav.isWalkable(q) && nav.inBounds(beyond) && nav.hasLineOfSight(p, beyond)) return true;
  }
  return false;
}

function occupiedBy(combat: CombatApi, c: Creature, p: GridPos): boolean {
  return combat.creatures().some((o) => isAlive(o) && o !== c && o.pos.x === p.x && o.pos.y === p.y);
}

function minDist(p: GridPos, list: Creature[]): number {
  return list.length === 0 ? 99 : Math.min(...list.map((o) => chebyshev(p, o.pos)));
}

// ----------------------------------------------------------------------- values

function expectedDamage(ctx: Ctx, a: ActionDef, t: Creature): number {
  const { combat, c } = ctx;
  if (a.effects?.includes('magicMissile')) return 3 * damageAgainst(a, t);
  if (a.multiattack) {
    let sum = 0;
    for (const id of a.multiattack) {
      const sub = c.actions.find((x) => x.id === id);
      if (sub) sum += expectedDamage(ctx, sub, t);
    }
    return sum;
  }
  const chance = combat.hitChance(a.id, t.id) ?? 0.5;
  let v = damageAgainst(a, t);
  if (a.effects?.includes('scorchingRays')) v *= 3;
  if (a.attack) v *= chance;
  else if (a.save) v *= chance + (a.save.halfOnSave ? (1 - chance) * 0.5 : 0);
  if (a.applies && !t.conditionImmunities.includes(a.applies.condition) && !hasCondition(t, a.applies.condition)) v += 2 * chance;
  const sneak = c.resources['_sneakAttack'];
  if (sneak && a.attack && !isSpellAction(a)) v += sneak.current * 3.5 * 0.7 * chance;
  return v;
}

/** How much the companion wants a given enemy, by stance: the hero's attackers and the hero's own target first. */
function priority(ctx: Ctx, e: Creature): number {
  const { hero, c, stance, focus } = ctx;
  let p = 10;
  if (hero && chebyshev(e.pos, hero.pos) <= 1) p += 6;
  if (focus && e.id === focus.id) p += stance === 'focus' ? 30 : 6;
  p += 8 * (1 - e.hp / e.maxHp);
  p -= 0.4 * chebyshev(c.pos, e.pos);
  return p;
}

function hardFight(enemies: Creature[], hero: Creature | undefined): boolean {
  if (!hero) return enemies.length >= 3;
  const total = enemies.reduce((s, e) => s + e.maxHp, 0);
  return enemies.length >= 3 || total >= hero.maxHp || enemies.some((e) => e.level >= hero.level * 0.5 + 1);
}

// ----------------------------------------------------------------------- spells

const isHeal = (a: ActionDef): boolean => !!a.heal && !a.damage;

function usable(ctx: Ctx, id: string): ActionDef | undefined {
  const a = ctx.c.actions.find((x) => x.id === id);
  return a && ctx.combat.canUse(a.id).ok ? a : undefined;
}

function healAmount(a: ActionDef): number {
  return a.heal ? averageDice(a.heal) : 0;
}

/** Heals for the healer: Healing Word and Mass Healing Word (bonus action), Cure Wounds and Mass Cure Wounds (action). */
function healPlay(ctx: Ctx, bonus: boolean): Command | null {
  const { combat, c, hero } = ctx;
  const friends = [hero, c].filter((x): x is Creature => !!x && isAlive(x));
  const hurt = friends.filter((f) => f.hp / f.maxHp <= 0.6);
  if (hurt.length === 0) return null;
  const heroHurt = hero && isAlive(hero) && hero.hp / hero.maxHp <= 0.6 ? hero : undefined;
  const selfCritical = c.hp / c.maxHp <= 0.3;
  const target = heroHurt ?? (selfCritical ? c : undefined);
  const worth = (a: ActionDef, t: Creature): boolean => t.maxHp - t.hp >= healAmount(a) * 0.7 || t.hp / t.maxHp <= 0.35;
  const spells = c.actions.filter((a) => isSpellAction(a) && isHeal(a) && combat.canUse(a.id).ok);
  const mass = spells.filter((a) => a.targeting.kind === 'point');
  const single = spells.filter((a) => a.targeting.kind === 'creature');
  // Both hurt: a mass heal is worth the use.
  if (hurt.length >= 2) {
    for (const a of mass.filter((x) => (x.cost === 'bonus') === bonus)) {
      if (a.targeting.kind !== 'point') continue;
      const point = a.targeting.range === 0 ? c.pos : hero ? hero.pos : c.pos;
      if (a.targeting.range > 0 && chebyshev(c.pos, point) > a.targeting.range) continue;
      const cells = combat.areaCells(a.id, point);
      const covered = hurt.filter((f) => cells.some((q) => q.x === f.pos.x && q.y === f.pos.y));
      if (covered.length >= 2 && covered.some((f) => worth(a, f))) return cmd(a, { point });
    }
  }
  if (!target) return null;
  for (const a of single.filter((x) => (x.cost === 'bonus') === bonus)) {
    if (!combat.validTargets(a.id).includes(target.id) || !worth(a, target)) continue;
    return cmd(a, { targetId: target.id });
  }
  // Mass Cure Wounds on a badly hurt hero alone.
  if (!bonus && heroHurt && heroHurt.hp / heroHurt.maxHp <= 0.45) {
    for (const a of mass.filter((x) => x.cost === 'action')) {
      if (a.targeting.kind === 'point' && chebyshev(c.pos, heroHurt.pos) <= a.targeting.range && worth(a, heroHurt)) return cmd(a, { point: heroHurt.pos });
    }
  }
  return null;
}

/** Buffs at the start of a hard fight (healer): Spirit Guardians, Death Ward, Aid, Bless, Shield of Faith. */
function buffPlay(ctx: Ctx, bonus: boolean): Command | null {
  const { combat, c, hero, enemies } = ctx;
  if (!hero || !isAlive(hero) || !ctx.hard || combat.round > 3) return null;
  const concentrating = concentratingOn(c) !== null;
  if (bonus) {
    const sof = usable(ctx, 'spell_shield_of_faith');
    if (sof && !concentrating && combat.validTargets(sof.id).includes(hero.id)) return cmd(sof, { targetId: hero.id });
    return null;
  }
  const near = enemies.filter((e) => chebyshev(c.pos, e.pos) <= 3).length;
  const guard = usable(ctx, 'spell_spirit_guardians');
  if (guard && !concentrating && near >= 2) return cmd(guard, { point: c.pos });
  const ward = usable(ctx, 'spell_death_ward');
  if (ward && !hero.resources['_deathWard'] && combat.validTargets(ward.id).includes(hero.id) && hero.hp / hero.maxHp <= 0.8) return cmd(ward, { targetId: hero.id });
  const aid = usable(ctx, 'spell_aid');
  if (aid && !hero.resources['_aid'] && combat.validTargets(aid.id).includes(hero.id)) return cmd(aid, { targetId: hero.id });
  const bless = usable(ctx, 'spell_bless');
  if (bless && !concentrating && combat.validTargets(bless.id).includes(hero.id)) return cmd(bless, { targetId: hero.id });
  return null;
}

interface Play {
  command: Command;
  value: number;
}

/** The best attack or damaging spell from where the companion stands. Areas never include the hero, the companion or another friend. */
function attackPlay(ctx: Ctx): Play | null {
  const { combat, c, enemies, stance } = ctx;
  let best: Play | null = null;
  const consider = (p: Play): void => {
    if (!best || p.value > best.value) best = p;
  };
  const concentrating = concentratingOn(c) !== null;
  const friends = combat.creatures().filter((o) => isAlive(o) && isFriendlySide(o));
  for (const a of c.actions) {
    if (a.cost !== 'action' || isHeal(a) || !combat.canUse(a.id).ok) continue;
    const fx = a.effects ?? [];
    if (['dash', 'disengage', 'dodge', 'aggressive', 'actionSurge', 'breakFree', 'deathWard', 'aid', 'bless', 'shieldOfFaith', 'spiritGuardians'].some((e) => fx.includes(e))) continue;
    const limited = a.uses !== undefined;
    // Limited uses are spent when worth it: always in a hard fight, otherwise only for a clearly good value.
    const conserve = limited ? (ctx.hard ? 0 : 4) : 0;
    const melee = a.targeting.kind === 'creature' && a.targeting.melee;
    const stanceWeight = stance === 'back' && melee ? 0.4 : 1;
    if (a.targeting.kind === 'creature' && !a.targeting.friendly) {
      for (const id of combat.validTargets(a.id)) {
        const t = combat.creature(id);
        if (!t || !areHostile(c, t)) continue;
        const v = expectedDamage(ctx, a, t);
        const w = priority(ctx, t) / 10;
        consider({ command: cmd(a, { targetId: id }), value: (v * w - conserve) * stanceWeight + (v >= t.hp ? 5 : 0) });
      }
    } else if (a.targeting.kind === 'point' && (a.damage || fx.includes('sleep'))) {
      const t = a.targeting;
      if (fx.includes('sleep') && concentrating) continue;
      const candidates: GridPos[] = t.range === 0 && t.area.shape === 'sphere' ? [c.pos] : enemies.map((e) => e.pos);
      for (const p of candidates) {
        if (t.range > 0 && chebyshev(c.pos, p) > t.range) continue;
        if (t.range === 0 && p.x === c.pos.x && p.y === c.pos.y && t.area.shape !== 'sphere') continue;
        const cells = combat.areaCells(a.id, p);
        const inCells = (o: Creature): boolean => cells.some((q) => q.x === o.pos.x && q.y === o.pos.y);
        // HARD RULE: never where it would reach the hero, the companion itself or any other friend.
        if (friends.some((f) => inCells(f) && !(t.range === 0 && f === c && t.area.shape !== 'sphere'))) continue;
        const inside = enemies.filter(inCells);
        if (inside.length === 0) continue;
        let v = 0;
        if (fx.includes('sleep')) {
          if (inside.length < 2) continue;
          v = inside.reduce((s, e) => s + (combat.hitChance(a.id, e.id) ?? 0.5) * 9, 0);
        } else {
          v = inside.reduce((s, e) => s + expectedDamage(ctx, a, e) * (priority(ctx, e) / 10), 0);
        }
        if (inside.length < 2 && limited) v *= 0.6;
        consider({ command: cmd(a, { point: p }), value: v - conserve });
      }
    }
  }
  const out = best as Play | null;
  return out && out.value > 0 ? out : null;
}

// --------------------------------------------------------------------- movement

interface Cell {
  pos: GridPos;
  cost: number;
}

function cells(ctx: Ctx): Cell[] {
  return [{ pos: ctx.c.pos, cost: 0 }, ...ctx.combat.reachable()];
}

/** The longest distance at which the companion has something to do to an enemy (melee is 1). */
function strikeRange(ctx: Ctx): number {
  let r = 1;
  for (const a of ctx.c.actions) {
    if (a.cost !== 'action' || isHeal(a) || !ctx.combat.canUse(a.id).ok) continue;
    if (a.targeting.kind === 'creature' && !a.targeting.friendly && !a.targeting.melee) r = Math.max(r, Math.min(a.targeting.range, 8));
    if (a.targeting.kind === 'point' && a.damage) r = Math.max(r, a.targeting.range === 0 ? a.targeting.area.size : Math.min(a.targeting.range, 8));
  }
  return r;
}

function positionScore(ctx: Ctx, p: GridPos, cost: number, range: number): number {
  const { nav, hero, enemies, stance, focus } = ctx;
  let s = -cost * 0.25;
  if (isChokepoint(nav, p)) s -= 6;
  if (isChasmEdge(nav, p)) s -= 5;
  // Never where an enemy could shove it into the drop (or lava): worse than merely standing at an edge.
  if (exposedToPush(nav, p, enemies)) s -= 4;
  const dHero = hero ? chebyshev(p, hero.pos) : 0;
  const near = minDist(p, enemies);
  const canStrike = enemies.some((e) => chebyshev(p, e.pos) <= range && (chebyshev(p, e.pos) <= 1 || nav.hasLineOfSight(p, e.pos)));
  if (stance === 'close') {
    s -= Math.max(0, dHero - 2) * 6;
    if (canStrike) s += 7;
    if (range > 1 && near <= 1) s -= 4;
  } else if (stance === 'back') {
    s += Math.min(near, 6) * 2;
    if (near < 3) s -= 6;
    s -= Math.max(0, dHero - 7) * 2;
    if (canStrike && near >= 3) s += 5;
  } else {
    s -= Math.max(0, dHero - 4);
    if (focus) {
      const d = chebyshev(p, focus.pos);
      if (d <= range && (d <= 1 || nav.hasLineOfSight(p, focus.pos))) s += 12;
      else s -= d * 0.5;
    } else if (canStrike) s += 7;
  }
  // Not stepping on a cell next to a drop or in a doorway matters most beside the hero.
  return s;
}

function moveCommand(ctx: Ctx, to: GridPos): Command | null {
  const { nav, combat, c } = ctx;
  if (to.x === c.pos.x && to.y === c.pos.y) return null;
  const path = nav.findPath(c.pos, to, { blocked: (p) => occupiedBy(combat, c, p), maxCost: combat.turn.movementLeft });
  if (!path || path.length === 0) return null;
  ctx.mem.moves += 1;
  return { type: 'move', path };
}

/** Walk to the best cell for the stance, if it is clearly better than where we stand. */
function reposition(ctx: Ctx, margin = 2): Command | null {
  if (ctx.combat.turn.movementLeft <= 0 || ctx.mem.moves >= MOVES_PER_TURN) return null;
  const range = strikeRange(ctx);
  let here = -Infinity;
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of cells(ctx)) {
    const s = positionScore(ctx, cell.pos, cell.cost, range);
    if (cell.cost === 0) here = s;
    if (!best || s > best.score) best = { pos: cell.pos, score: s };
  }
  if (!best || best.score < here + margin) return null;
  return moveCommand(ctx, best.pos);
}

/** Melee: attack an adjacent enemy, or walk to the best cell beside the most wanted one. */
function engage(ctx: Ctx): Command | null {
  const { combat, c, enemies } = ctx;
  const melee = c.actions.filter((a) => a.cost === 'action' && !isSpellAction(a) && a.targeting.kind === 'creature' && a.targeting.melee && combat.canUse(a.id).ok);
  if (melee.length === 0) return null;
  let bestHit: { a: ActionDef; t: Creature; v: number } | undefined;
  for (const a of melee) {
    for (const id of combat.validTargets(a.id)) {
      const t = combat.creature(id) as Creature;
      const v = expectedDamage(ctx, a, t) * (priority(ctx, t) / 10) + (expectedDamage(ctx, a, t) >= t.hp ? 5 : 0);
      if (!bestHit || v > bestHit.v) bestHit = { a, t, v };
    }
  }
  const adjacent = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
  // Beside an enemy already: fight it rather than provoke by walking off (unless a better one is a short step away and none threatens).
  if (bestHit && (adjacent || combat.turn.movementLeft <= 0 || ctx.mem.moves >= MOVES_PER_TURN)) return cmd(bestHit.a, { targetId: bestHit.t.id });
  if (ctx.mem.moves >= MOVES_PER_TURN || combat.turn.movementLeft <= 0) return null;
  const sorted = [...enemies].sort((x, y) => priority(ctx, y) - priority(ctx, x));
  let plan: { cell: Cell; score: number } | undefined;
  for (const e of sorted.slice(0, 4)) {
    for (const cell of cells(ctx)) {
      if (chebyshev(cell.pos, e.pos) > 1 || occupiedBy(combat, c, cell.pos)) continue;
      const score = priority(ctx, e) * 2 + positionScore(ctx, cell.pos, cell.cost, 1);
      if (!plan || score > plan.score) plan = { cell, score };
    }
  }
  if (!plan) return null;
  if (plan.cell.cost === 0 && bestHit) return cmd(bestHit.a, { targetId: bestHit.t.id });
  return moveCommand(ctx, plan.cell.pos);
}

/** Skirmisher: Teleport next to the wanted enemy for the advantage that turns on Sneak Attack. */
function blinkPlay(ctx: Ctx): Command | null {
  const { combat, c, enemies, nav, hero } = ctx;
  const blink = usable(ctx, 'blink');
  if (!blink || blink.targeting.kind !== 'point' || ctx.stance === 'back' || ctx.mem.moves >= MOVES_PER_TURN) return null;
  const range = blink.targeting.range;
  const sorted = [...enemies].sort((x, y) => priority(ctx, y) - priority(ctx, x));
  const target = sorted[0];
  if (!target) return null;
  const adjacent = chebyshev(c.pos, target.pos) <= 1;
  const flanked = combat.creatures().some((o) => o !== c && isAlive(o) && isFriendlySide(o) && !hasCondition(o, 'incapacitated') && chebyshev(o.pos, target.pos) <= 1);
  // Already beside it with a friend on the other side: Sneak Attack applies without the Teleport.
  if (adjacent && flanked) return null;
  let best: { pos: GridPos; score: number } | undefined;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const p = { x: c.pos.x + dx, y: c.pos.y + dy };
      if (chebyshev(p, c.pos) > range || chebyshev(p, target.pos) > 1 || (p.x === target.pos.x && p.y === target.pos.y)) continue;
      if (!nav.inBounds(p) || !nav.isWalkable(p) || occupiedBy(combat, c, p)) continue;
      if (chebyshev(c.pos, p) > 1 && !nav.hasLineOfSight(c.pos, p)) continue;
      if (adjacent && chebyshev(p, c.pos) === 0) continue;
      // 'close': never blink away from the hero's side.
      if (ctx.stance === 'close' && hero && chebyshev(p, hero.pos) > 3) continue;
      let score = 0;
      if (isChokepoint(nav, p)) score -= 6;
      if (isChasmEdge(nav, p)) score -= 5;
      if (hero) score -= Math.max(0, chebyshev(p, hero.pos) - 2) * 2;
      // Fewer other enemies around the landing cell.
      score -= enemies.filter((e) => e !== target && chebyshev(e.pos, p) <= 1).length * 3;
      if (!best || score > best.score) best = { pos: p, score };
    }
  }
  if (!best) return null;
  return cmd(blink, { point: best.pos });
}

/** In 'back' stance with an enemy next to us: Disengage (a bonus action when we have the rogue's) and walk away. */
function retreat(ctx: Ctx): Command | null {
  const { combat, c, enemies } = ctx;
  if (combat.turn.movementLeft <= 0 || ctx.mem.moves >= MOVES_PER_TURN) return null;
  const adjacent = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
  const near = minDist(c.pos, enemies);
  if (near >= 4) return null;
  const range = strikeRange(ctx);
  const here = positionScore(ctx, c.pos, 0, range);
  let best: { pos: GridPos; score: number } | undefined;
  for (const cell of cells(ctx)) {
    if (cell.cost === 0) continue;
    const s = positionScore(ctx, cell.pos, cell.cost, range);
    if (!best || s > best.score) best = { pos: cell.pos, score: s };
  }
  if (!best || best.score <= here + 3) return null;
  if (adjacent && !hasCondition(c, 'disengaged')) {
    const d = usable(ctx, 'cunning_disengage');
    if (d) return cmd(d);
  }
  return moveCommand(ctx, best.pos);
}

// ------------------------------------------------------------------------ brain

/** The next command for the active companion. Always executable; 'endTurn' when nothing useful is left. */
export function chooseCompanionCommand(combat: CombatApi, nav: NavGrid, stance: CompanionStance, focusTargetId?: string): Command {
  const c = combat.creature(combat.activeId);
  if (!c || combat.isOver || !isAlive(c) || c.faction !== 'ally') return END;
  const enemies = combat.creatures().filter((o) => isAlive(o) && areHostile(c, o));
  if (enemies.length === 0) return END;
  const hero = combat.creature('player');
  const def = getCompanion(c.defId);
  const role: CompanionRole = def?.role ?? 'skirmisher';
  const key = `${combat.round}:${combat.activeId}`;
  let mem = memory.get(combat);
  if (!mem || mem.key !== key) {
    mem = { key, moves: 0 };
    memory.set(combat, mem);
  }
  const focus = focusTargetId !== undefined ? enemies.find((e) => e.id === focusTargetId) : undefined;
  const ctx: Ctx = { combat, nav, c, hero, enemies, stance, focus, role, hard: hardFight(enemies, hero), mem };
  const turn = combat.turn;

  // 1. Bonus action: heals, a blink, a shield.
  if (!turn.bonusUsed) {
    const heal = healPlay(ctx, true);
    if (heal) return heal;
    const buff = buffPlay(ctx, true);
    if (buff) return buff;
    if (role === 'skirmisher') {
      if (stance === 'back' && enemies.some((e) => chebyshev(c.pos, e.pos) <= 1)) {
        const r = retreat(ctx);
        if (r) return r;
      }
      const b = blinkPlay(ctx);
      if (b) return b;
    }
  }

  // 2. The action.
  if (!turn.actionUsed) {
    const heal = healPlay(ctx, false);
    if (heal) return heal;
    const buff = buffPlay(ctx, false);
    if (buff) return buff;
    // A healer who wants a touch heal walks next to the hero first.
    if (role === 'healer' && hero && isAlive(hero) && hero.hp / hero.maxHp <= 0.5 && chebyshev(c.pos, hero.pos) > 1) {
      const touch = usable(ctx, 'spell_cure_wounds');
      if (touch && turn.movementLeft > 0 && ctx.mem.moves < MOVES_PER_TURN) {
        let adj: Cell | undefined;
        for (const cell of cells(ctx)) if (chebyshev(cell.pos, hero.pos) <= 1 && (!adj || cell.cost < adj.cost)) adj = cell;
        if (adj && adj.cost > 0) {
          const m = moveCommand(ctx, adj.pos);
          if (m) return m;
        }
      }
    }
    // Stance 'back': back away first when enemies are close and a better spot is in reach.
    if (stance === 'back') {
      const r = retreat(ctx);
      if (r) return r;
    }
    const play = role === 'skirmisher' ? null : attackPlay(ctx);
    const melee = role === 'skirmisher' || !play ? engage(ctx) : null;
    if (play && (!melee || play.value >= 0)) return play.command;
    if (melee) return melee;
    // Nothing to do from here: walk to where the stance wants us (toward a target in range).
    const r = reposition(ctx, 0.5);
    if (r) return r;
    const fallback = attackPlay(ctx);
    if (fallback) return fallback.command;
  }

  // 3. Afterwards: tidy up the position.
  if (turn.movementLeft > 0) {
    if (stance === 'back') {
      const r = retreat(ctx);
      if (r) return r;
    }
    const adjacentEnemy = enemies.some((e) => chebyshev(c.pos, e.pos) <= 1);
    if (!adjacentEnemy || stance === 'back') {
      const r = reposition(ctx, 3);
      if (r) return r;
    }
  }
  return END;
}

/** Run the active companion's whole turn. Bounded like the monster AI: it always ends. */
export function runCompanionTurn(combat: CombatApi, nav: NavGrid, stance: CompanionStance, focusTargetId?: string): GameEvent[] {
  return runTurnWith(combat, (cb) => chooseCompanionCommand(cb, nav, stance, focusTargetId));
}

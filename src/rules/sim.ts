import { Rng } from '../core/rng';
import type { Command, CombatApi, Creature, GameEvent, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { chooseCommand, damageAgainst, runAiTurn, runTurnWith } from './ai';
import { spellCommand } from './spellPolicy';
import { maxDice } from './dice';
import { toCreature } from './character';
import { attacksLeft, createCombat } from './combat';
import { instantiateMonster } from './monster';
import { flagPool, hasFlag } from './util';
import { createOpenRoomNav } from './testing/openRoomNav';

export type PolicyFn = (combat: CombatApi, nav: NavGrid) => Command;

export interface SimOptions {
  /** Number of seeded fights to run. Default 200. */
  fights?: number;
  /** Base seed; fight i uses seed + i. Default 1. */
  seed?: number;
  /** Arena. Default: an open 16x12 room. */
  nav?: NavGrid;
  /** Starting distance between hero and monsters, in cells. Default 6. */
  startDistance?: number;
  /** Fights lasting longer than this many rounds count as lost. Default 50. */
  maxRounds?: number;
  /** Replace the scripted player policy. */
  policy?: (combat: CombatApi, nav: NavGrid) => Command;
}

export interface SimResult {
  fights: number;
  wins: number;
  winRate: number;
  avgRounds: number;
  /** Mean hit points left at the end, counting losses as 0. */
  avgHpRemaining: number;
  /** Mean fraction of max HP left at the end, counting losses as 0. */
  avgHpFraction: number;
  /** Mean HP fraction left over won fights only (0 if none won). */
  avgHpFractionOnWin: number;
  timeouts: number;
}

export interface SingleFight {
  won: boolean;
  rounds: number;
  hpLeft: number;
  maxHp: number;
  timedOut: boolean;
  events: GameEvent[];
}

/**
 * Scripted hero: Second Wind below half HP, a potion when low, Action Surge
 * when it lets another attack land, otherwise attack the best target or close in.
 */
export function playerPolicy(combat: CombatApi, nav: NavGrid): Command {
  const c = combat.creature(combat.activeId) as Creature;
  // The naive hero keeps the old automation of Tactical Master (Graze becomes Sap); the smart choice is for the expert and for humans.
  if (!hasFlag(c, 'tacticalAuto')) c.resources['_tacticalAuto'] = flagPool('tacticalAuto');
  const upkeep = heroUpkeep(combat, c);
  if (upkeep) return upkeep;
  const cast = spellCommand(combat, c);
  if (cast) return cast;
  const kite = archerRetreat(combat, nav, c);
  if (kite) return kite;
  return chooseCommand(combat, nav);
}

/**
 * What every scripted hero does before thinking about the enemy (shared by the naive and the expert policy): heal when
 * the next enemy round could kill, break free, the off-hand attack of two-weapon fighting, Action Surge, Cure Wounds.
 */
export function heroUpkeep(combat: CombatApi, c: Creature): Command | null {
  const threat = incomingMax(combat, c);
  const missing = c.maxHp - c.hp;
  // Heal when the next enemy round could plausibly kill us (or we are below half), and it is worth a bonus action.
  const needsHeal = missing >= 5 && (c.hp <= c.maxHp * 0.5 || c.hp <= threat * 0.85);
  if (needsHeal && combat.canUse('second_wind').ok) return { type: 'action', actionId: 'second_wind' };
  if (needsHeal && combat.canUse('spell_healing_word').ok) return { type: 'action', actionId: 'spell_healing_word', targetId: c.id };
  if (needsHeal && (c.hp <= c.maxHp * 0.4 || c.hp <= threat * 0.85)) {
    for (const a of c.actions) {
      if (a.id.startsWith('drink_') && combat.canUse(a.id).ok) return { type: 'action', actionId: a.id };
    }
  }
  if (combat.canUse('break_free').ok) return { type: 'action', actionId: 'break_free' };
  // Two-weapon fighting: the off-hand attack follows a main-hand Light attack (a free action with Nick, else the bonus action).
  const off = c.actions.find((a) => a.effects?.includes('offhand'));
  if (off && combat.canUse(off.id).ok) {
    const t = combat
      .validTargets(off.id)
      .map((id) => combat.creature(id) as Creature)
      .sort((x, y) => x.hp - y.hp)[0];
    if (t) return { type: 'action', actionId: off.id, targetId: t.id };
  }
  if (attacksLeft(combat) === 0 && combat.canUse('action_surge').ok) {
    const canHit = c.actions.some((a) => a.attack && combat.validTargets(a.id).length > 0);
    if (canHit && shouldSurge(combat, c)) return { type: 'action', actionId: 'action_surge' };
  }
  if (c.hp <= c.maxHp * 0.35 && combat.canUse('spell_cure_wounds').ok && !combat.turn.actionUsed && !c.actions.some((a) => a.id.startsWith('drink_') && combat.canUse(a.id).ok)) {
    return { type: 'action', actionId: 'spell_cure_wounds', targetId: c.id };
  }
  return null;
}

/**
 * Action Surge is kept for when it matters (HOUSE RULE for the scripted hero; a hero with a single attack per
 * action surges as soon as it can, as it always did): against a boss, in a crowd of three or more, when it can
 * finish an enemy, or when the hero is hurt.
 */
function shouldSurge(combat: CombatApi, c: Creature): boolean {
  const attacks = c.resources['_attacks']?.current ?? 1;
  if (attacks <= 1) return true;
  const hostiles = combat.creatures().filter((o) => !o.dead && o.hp > 0 && o.faction === 'enemy');
  if (hostiles.length === 0) return false;
  let perAttack = 0;
  for (const a of c.actions) {
    if (!a.attack || !(a.id.startsWith('atk_') || a.id.startsWith('throw_'))) continue;
    for (const id of combat.validTargets(a.id)) {
      const t = combat.creature(id) as Creature;
      perAttack = Math.max(perAttack, damageAgainst(a, t) * (combat.hitChance(a.id, id) ?? 0.5));
    }
  }
  const round = attacks * perAttack;
  const boss = hostiles.some((h) => MONSTERS.find((m) => m.id === h.defId)?.role === 'boss');
  const finish = hostiles.some((h) => h.hp <= round * 1.15);
  return boss || finish || hostiles.length >= 3 || c.hp <= c.maxHp * 0.5;
}

/**
 * Archers shoot, then use the rest of their movement to back away from
 * enemies that are not yet adjacent (so no opportunity attack is provoked).
 */
export function archerRetreat(combat: CombatApi, nav: NavGrid, c: Creature): Command | null {
  if ((globalThis as { __NOKITE?: boolean }).__NOKITE) return null;
  const turn = combat.turn;
  if (!turn.actionUsed || turn.movementLeft <= 0 || attacksLeft(combat) > 0) return null;
  const main = c.actions.find((a) => a.id.startsWith('atk_') && a.targeting.kind === 'creature' && !a.targeting.melee);
  if (!main) return null;
  const hostiles = combat.creatures().filter((o) => !o.dead && o.hp > 0 && o.faction === 'enemy');
  if (hostiles.length === 0) return null;
  const minDist = (p: { x: number; y: number }): number => Math.min(...hostiles.map((h) => Math.max(Math.abs(p.x - h.pos.x), Math.abs(p.y - h.pos.y))));
  const here = minDist(c.pos);
  if (here <= 1) return null;
  let best: { pos: { x: number; y: number }; score: number } | undefined;
  for (const cell of combat.reachable()) {
    const d = minDist(cell.pos);
    if (d <= here) continue;
    const los = hostiles.some((h) => nav.hasLineOfSight(cell.pos, h.pos)) ? 100 : 0;
    const score = los + d * 10 - cell.cost;
    if (!best || score > best.score) best = { pos: cell.pos, score };
  }
  if (!best) return null;
  const occupied = (p: { x: number; y: number }): boolean => combat.creatures().some((o) => !o.dead && o.hp > 0 && o !== c && o.pos.x === p.x && o.pos.y === p.y);
  const path = nav.findPath(c.pos, best.pos, { blocked: occupied, maxCost: turn.movementLeft });
  return path && path.length > 0 ? { type: 'move', path } : null;
}

export function defaultArena(): NavGrid {
  return createOpenRoomNav(16, 12);
}

/** Run one fight to the end and return the outcome with its full event list. */
export function simulateOne(pc: PlayerCharacter, monsterDefs: MonsterDef[], seed: number, opts: SimOptions = {}): SingleFight {
  const nav = opts.nav ?? defaultArena();
  const rng = new Rng(seed);
  const dist = opts.startDistance ?? 6;
  const maxRounds = opts.maxRounds ?? 50;
  const policy = opts.policy ?? playerPolicy;
  const midY = Math.floor(nav.height / 2);
  const hero = toCreature(pc, { x: 2, y: midY });
  const foes = monsterDefs.map((d, i) => {
    const row = midY + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2);
    return instantiateMonster(d, `m_${i}`, { x: Math.min(nav.width - 2, 2 + dist), y: row });
  });
  const combat = createCombat([hero, ...foes], nav, rng);
  const events: GameEvent[] = [...combat.begin()];
  let timedOut = false;
  while (!combat.isOver) {
    if (combat.round > maxRounds) {
      timedOut = true;
      break;
    }
    const active = combat.creature(combat.activeId) as Creature;
    if (active.id === 'player') events.push(...runTurnWith(combat, (cb) => policy(cb, nav)));
    else events.push(...runAiTurn(combat, nav));
  }
  const won = combat.winner === 'player' && !timedOut;
  return { won, rounds: combat.round, hpLeft: won ? hero.hp : 0, maxHp: hero.maxHp, timedOut, events };
}

/** Run many seeded fights of `pc` against `monsterDefs` (one instance of each entry) and summarize. */
export function simulateFight(pc: PlayerCharacter, monsterDefs: MonsterDef[], opts: SimOptions = {}): SimResult {
  const n = opts.fights ?? 200;
  const seed = opts.seed ?? 1;
  let wins = 0;
  let rounds = 0;
  let hp = 0;
  let frac = 0;
  let fracWin = 0;
  let timeouts = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateOne(pc, monsterDefs, seed + i, opts);
    rounds += r.rounds;
    hp += r.hpLeft;
    frac += r.hpLeft / r.maxHp;
    if (r.won) {
      wins++;
      fracWin += r.hpLeft / r.maxHp;
    }
    if (r.timedOut) timeouts++;
  }
  return {
    fights: n,
    wins,
    winRate: wins / n,
    avgRounds: rounds / n,
    avgHpRemaining: hp / n,
    avgHpFraction: frac / n,
    avgHpFractionOnWin: wins > 0 ? fracWin / wins : 0,
    timeouts,
  };
}

/** Worst-case damage the nearby enemies could deal to `c` on their next turns (no crits doubled). */
function incomingMax(combat: CombatApi, c: Creature): number {
  let total = 0;
  for (const h of combat.creatures()) {
    if (h.dead || h.hp <= 0 || h.faction !== 'enemy') continue;
    const d = Math.max(Math.abs(h.pos.x - c.pos.x), Math.abs(h.pos.y - c.pos.y));
    let best = 0;
    for (const a of h.actions) {
      if (a.cost !== 'action' || !a.damage) {
        if (!a.multiattack) continue;
      }
      let dmg = (a.damage ?? []).reduce((s, p) => s + maxDice(p.dice), 0);
      if (a.multiattack) dmg = a.multiattack.reduce((s, id) => s + (h.actions.find((x) => x.id === id)?.damage ?? []).reduce((t, p) => t + maxDice(p.dice), 0), 0);
      const t = a.targeting;
      const reach = t.kind === 'creature' ? (t.melee ? t.range : (t.longRange ?? t.range)) : t.kind === 'point' ? t.range : 0;
      if (d <= h.speed + reach) best = Math.max(best, dmg);
    }
    total += best;
  }
  return total;
}

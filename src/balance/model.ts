import { Rng, floorSeed, hashSeed } from '../core/rng';
import { themeForDepth } from '../core/themes';
import type { Ability, ActionDef, Condition, DamageType, MonsterDef } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { generateFloor } from '../gen';
import { buildEncounters } from '../rules';
import { routeToBoss } from './floor';

/**
 * A quick model of floors 1 to 20, for seeing how the encounter tuning is going
 * before the real hero can reach those levels.
 *
 * It is a MODEL, not the game. The floors, the monsters placed on them and the
 * monsters' numbers are the real ones (generateFloor, buildEncounters, MONSTERS).
 * The party and the fighting are simplified:
 *
 * - The hero is a basic sword-and-shield Champion Fighter whose level equals
 *   the floor (see fighterAt), with the longsword's Sap mastery. An optional ally is the same Fighter some levels
 *   lower. Neither exists in the rules engine above level 3.
 * - Combat has no grid. Distance is reduced to one rule: the party acts first,
 *   and a monster with no ranged or area action spends the first round
 *   closing in. After that everyone can reach everyone; area effects catch
 *   each party member three times in four.
 * - Monsters use their most damaging available action each turn. Conditions
 *   are reduced to three effects: cannot act, attacks at disadvantage, is
 *   attacked at advantage.
 * - The party walks the main route to the boss, rests by a simple rule (two
 *   short rests per long rest, two long-rest sites per floor) and starts every
 *   floor fresh.
 *
 * Read its numbers as a trend across floors and a way to compare tunings, and
 * calibrate against the real simulation (simulateRun) where both exist.
 */

// ---------------------------------------------------------------------------
// The party

export interface FighterStats {
  level: number;
  maxHp: number;
  ac: number;
  toHit: number;
  attacks: number;
  /** Weapon damage: 1d8 + this. */
  damageBonus: number;
  /** Lowest d20 roll that is a critical hit. */
  critFrom: number;
  saves: Record<Ability, number>;
  conMod: number;
  secondWindUses: number;
  actionSurges: number;
}

const at = (level: number, steps: Array<[number, number]>): number => {
  let v = 0;
  for (const [from, value] of steps) if (level >= from) v = value;
  return v;
};

/**
 * A basic Fighter (Champion) at a given level, SRD 5.2.1 progression, sword and shield with the
 * Defense style. Hit points are the maximum per level (the game's solo rule). Gear follows the
 * design doc's schedule: better armor early, +1 items from floor 4, +2 from about 9, +3 from about 15.
 */
export function fighterAt(level: number): FighterStats {
  const L = Math.max(1, Math.min(20, Math.floor(level)));
  const pb = 2 + Math.floor((L - 1) / 4);
  // Ability score improvements at 4, 6, 8, 12, 14, 16, 19: Strength to 20 first, then Constitution.
  const strMod = at(L, [[1, 3], [4, 4], [6, 5]]);
  const conMod = at(L, [[1, 2], [8, 3], [12, 4], [14, 5]]);
  const armor = at(L, [[1, 16], [3, 17], [5, 18]]); // chain mail, splint, plate
  const armorMagic = at(L, [[1, 0], [5, 1], [10, 2], [16, 3]]);
  const shieldMagic = at(L, [[1, 0], [8, 1], [13, 2]]);
  const weaponMagic = at(L, [[1, 0], [4, 1], [9, 2], [15, 3]]);
  return {
    level: L,
    maxHp: L * (10 + conMod),
    ac: armor + armorMagic + 2 + shieldMagic + 1,
    toHit: pb + strMod + weaponMagic,
    attacks: at(L, [[1, 1], [5, 2], [11, 3], [20, 4]]),
    damageBonus: strMod + weaponMagic,
    critFrom: at(L, [[1, 20], [3, 19], [15, 18]]),
    saves: { str: strMod + pb, dex: 1, con: conMod + pb, int: -1, wis: 0, cha: 1 },
    conMod,
    secondWindUses: at(L, [[1, 2], [4, 3], [10, 4]]),
    actionSurges: at(L, [[1, 0], [2, 1], [17, 2]]),
  };
}

interface Member {
  stats: FighterStats;
  hero: boolean;
  hp: number;
  secondWind: number;
  actionSurge: number;
  hitDice: number;
  lastStand: boolean;
  potions: number;
  /** Simplified conditions, in own turns remaining. */
  noAct: number;
  hampered: number;
  exposed: number;
  saveEnds: Array<{ ability: Ability; dc: number; effect: 'noAct' | 'hampered' | 'exposed' }>;
}

function member(stats: FighterStats, hero: boolean, potions: number): Member {
  return {
    stats,
    hero,
    hp: stats.maxHp,
    secondWind: stats.secondWindUses,
    actionSurge: stats.actionSurges,
    hitDice: stats.level,
    lastStand: hero,
    potions: hero ? potions : 0,
    noAct: 0,
    hampered: 0,
    exposed: 0,
    saveEnds: [],
  };
}

// ---------------------------------------------------------------------------
// Dice

function roll(rng: Rng, dice: string, crit = false): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  if (!m) return Number(dice) || 0;
  let total = m[3] ? Number(m[3]) : 0;
  const n = Number(m[1]) * (crit ? 2 : 1);
  for (let i = 0; i < n; i++) total += rng.die(Number(m[2]));
  return Math.max(0, total);
}

function average(dice: string): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  if (!m) return Number(dice) || 0;
  return (Number(m[1]) * (Number(m[2]) + 1)) / 2 + (m[3] ? Number(m[3]) : 0);
}

function d20(rng: Rng, mode: number): number {
  const a = rng.die(20);
  if (mode === 0) return a;
  const b = rng.die(20);
  return mode > 0 ? Math.max(a, b) : Math.min(a, b);
}

// ---------------------------------------------------------------------------
// Monsters

interface Foe {
  def: MonsterDef;
  hp: number;
  /** Action ids currently spent (recharge) or used up (limited uses). */
  spent: Set<string>;
  used: Set<string>;
  /** Hit by the longsword's Sap mastery: disadvantage on its next attack roll. */
  sapped: boolean;
}

const mod = (score: number): number => Math.floor((score - 10) / 2);

const NO_ACT: ReadonlySet<Condition> = new Set<Condition>(['paralyzed', 'stunned', 'charmed', 'unconscious'] as Condition[]);
const HAMPER: ReadonlySet<Condition> = new Set<Condition>(['restrained', 'blinded', 'prone', 'poisoned', 'frightened'] as Condition[]);
const EXPOSE: ReadonlySet<Condition> = new Set<Condition>(['paralyzed', 'stunned', 'unconscious', 'restrained', 'blinded', 'prone'] as Condition[]);

function isArea(a: ActionDef): boolean {
  return a.targeting.kind === 'point' || (a.targeting.kind === 'self' && !!a.save);
}

/** Rough expected damage of one action against the party, used only to choose between actions. */
function expected(def: MonsterDef, a: ActionDef, ac: number, depth = 0): number {
  if (a.multiattack && depth < 2) {
    let sum = 0;
    for (const id of a.multiattack) {
      const sub = def.actions.find((x) => x.id === id);
      if (sub) sum += expected(def, sub, ac, depth + 1);
    }
    return sum;
  }
  if (a.heal) return 0;
  const dmg = (a.damage ?? []).reduce((s, p) => s + average(p.dice), 0);
  const control = a.applies ? 4 + def.cr : 0;
  let p = 0.6;
  if (a.attack) p = Math.min(0.95, Math.max(0.05, (21 + a.attack.bonus - ac) / 20));
  else if (a.save) p = a.save.halfOnSave ? 0.8 : 0.6;
  return (dmg + control) * p * (isArea(a) ? 1.5 : 1);
}

function chooseAction(foe: Foe, ac: number): ActionDef | undefined {
  let best: ActionDef | undefined;
  let bestValue = 0;
  for (const a of foe.def.actions) {
    if (a.cost !== 'action' || foe.spent.has(a.id) || foe.used.has(a.id)) continue;
    const v = expected(foe.def, a, ac);
    if (v > bestValue) {
      bestValue = v;
      best = a;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One fight

interface FightResult {
  won: boolean;
  rounds: number;
  allyDown: boolean;
}

function hurt(m: Member, amount: number): void {
  m.hp -= amount;
  if (m.hp <= 0 && m.lastStand) {
    m.lastStand = false;
    m.hp = 1;
  }
}

function afflict(rng: Rng, target: Member, a: ActionDef): void {
  const ap = a.applies;
  if (!ap) return;
  const effects: Array<'noAct' | 'hampered' | 'exposed'> = [];
  if (NO_ACT.has(ap.condition)) effects.push('noAct');
  if (HAMPER.has(ap.condition)) effects.push('hampered');
  if (EXPOSE.has(ap.condition)) effects.push('exposed');
  for (const e of effects) {
    if (ap.saveEnds) {
      if (!target.saveEnds.some((s) => s.effect === e)) target.saveEnds.push({ ...ap.saveEnds, effect: e });
      target[e] = Math.max(target[e], 99);
    } else {
      // No duration means "until removed" (a web, say): the model gives it two turns.
      target[e] = Math.max(target[e], ap.rounds ?? 2);
    }
  }
  void rng;
}

function resolve(rng: Rng, foe: Foe, a: ActionDef, party: Member[], target: Member, depth = 0): void {
  if (a.multiattack && depth < 2) {
    for (const id of a.multiattack) {
      const sub = foe.def.actions.find((x) => x.id === id);
      const living = party.filter((m) => m.hp > 0);
      if (sub && living.length) resolve(rng, foe, sub, party, target.hp > 0 ? target : (living[0] as Member), depth + 1);
    }
    return;
  }
  if (a.recharge) foe.spent.add(a.id);
  if (a.uses) foe.used.add(a.id);
  const targets = isArea(a) ? party.filter((m) => m.hp > 0 && (m === target || rng.chance(0.75))) : [target];
  for (const t of targets) {
    if (t.hp <= 0) continue;
    let hit = true;
    let crit = false;
    if (a.attack) {
      const r = d20(rng, (t.exposed > 0 ? 1 : 0) - (foe.sapped ? 1 : 0));
      foe.sapped = false;
      crit = r === 20;
      hit = r !== 1 && (crit || r + a.attack.bonus >= t.stats.ac);
    }
    if (!hit) continue;
    let saved = false;
    if (a.save) saved = rng.die(20) + t.stats.saves[a.save.ability] >= a.save.dc;
    let dmg = 0;
    for (const p of a.damage ?? []) dmg += roll(rng, p.dice, crit);
    if (a.save && !a.attack) dmg = saved ? (a.save.halfOnSave ? Math.floor(dmg / 2) : 0) : dmg;
    if (dmg > 0) hurt(t, dmg);
    if (t.hp > 0 && !saved) afflict(rng, t, a);
  }
}

const PHYSICAL: DamageType[] = ['slashing', 'bludgeoning', 'piercing'];

/** The Fighter carries a sword, a mace and a spear: against a monster, the kindest damage type applies. */
function weaponMultiplier(def: MonsterDef): number {
  let best = 0;
  for (const t of PHYSICAL) {
    const k = def.immunities.includes(t) ? 0 : def.resistances.includes(t) ? 0.5 : def.vulnerabilities.includes(t) ? 2 : 1;
    best = Math.max(best, k);
  }
  return best;
}

function memberTurn(rng: Rng, m: Member, foes: Foe[], bossFight: boolean, round: number): void {
  const acts = m.noAct <= 0;
  if (acts) {
    // Bonus action: Second Wind, else a potion.
    if (m.hp < m.stats.maxHp * 0.5 && m.secondWind > 0) {
      m.secondWind--;
      m.hp = Math.min(m.stats.maxHp, m.hp + rng.die(10) + m.stats.level);
    } else if (m.hp < m.stats.maxHp * 0.4 && m.potions > 0) {
      m.potions--;
      m.hp = Math.min(m.stats.maxHp, m.hp + roll(rng, potionDice(m.stats.level)));
    }
    let swings = m.stats.attacks;
    const foeHp = foes.reduce((s, f) => s + Math.max(0, f.hp), 0);
    if (m.actionSurge > 0 && (bossFight ? round === 1 : foeHp > m.stats.attacks * 14 * 3)) {
      m.actionSurge--;
      swings *= 2;
    }
    for (let i = 0; i < swings; i++) {
      const living = foes.filter((f) => f.hp > 0);
      if (!living.length) break;
      const target = living.reduce((a, b) => (b.hp < a.hp ? b : a));
      const r = d20(rng, m.hampered > 0 ? -1 : 0);
      const crit = r >= m.stats.critFrom;
      if (r === 1 || !(crit || r + m.stats.toHit >= target.def.ac)) continue;
      const dmg = (roll(rng, '1d8', crit) + m.stats.damageBonus) * weaponMultiplier(target.def);
      target.hp -= Math.floor(dmg);
      target.sapped = true;
    }
  }
  // End of turn: durations tick, save-ends effects are rolled.
  for (const e of ['noAct', 'hampered', 'exposed'] as const) if (m[e] > 0 && m[e] < 90) m[e]--;
  m.saveEnds = m.saveEnds.filter((s) => {
    if (rng.die(20) + m.stats.saves[s.ability] >= s.dc) {
      m[s.effect] = 0;
      return false;
    }
    return true;
  });
}

function fight(rng: Rng, party: Member[], defs: MonsterDef[], bossFight: boolean): FightResult {
  const foes: Foe[] = defs.map((def) => ({ def, hp: def.hp, spent: new Set(), used: new Set(), sapped: false }));
  const hero = party[0] as Member;
  type Turn = { member?: Member; foe?: Foe; init: number };
  const order: Turn[] = [
    ...party.map((m) => ({ member: m, init: rng.die(20) + 1 })),
    ...foes.map((f) => ({ foe: f, init: rng.die(20) + mod(f.def.abilities.dex) })),
  ].sort((a, b) => b.init - a.init);
  // The party opens (a fight starts when the hero walks in), and melee-only monsters need a round to arrive.
  order.sort((a, b) => (a.member ? 0 : 1) - (b.member ? 0 : 1));
  const canReach = (f: Foe): boolean => f.def.actions.some((a) => isArea(a) || (a.targeting.kind === 'creature' && !a.targeting.melee && !a.targeting.friendly));
  let allyDown = false;
  for (let round = 1; round <= 40; round++) {
    for (const turn of order) {
      if (round === 1 && turn.foe && !canReach(turn.foe)) continue;
      if (hero.hp <= 0) return { won: false, rounds: round, allyDown };
      if (foes.every((f) => f.hp <= 0)) return { won: true, rounds: round, allyDown };
      if (turn.member) {
        if (turn.member.hp > 0) memberTurn(rng, turn.member, foes, bossFight, round);
      } else if (turn.foe && turn.foe.hp > 0) {
        const foe = turn.foe;
        for (const id of [...foe.spent]) {
          const a = foe.def.actions.find((x) => x.id === id);
          if (a?.recharge && rng.die(6) >= a.recharge) foe.spent.delete(id);
        }
        const living = party.filter((m) => m.hp > 0);
        if (!living.length) continue;
        const meanAc = living.reduce((s, m) => s + m.stats.ac, 0) / living.length;
        const action = chooseAction(foe, meanAc);
        if (!action) continue;
        const target = living.length > 1 && !rng.chance(0.55) ? (living[1] as Member) : (living[0] as Member);
        resolve(rng, foe, action, party, target);
        if (party.length > 1 && (party[1] as Member).hp <= 0) allyDown = true;
      }
    }
  }
  return { won: false, rounds: 40, allyDown };
}

// ---------------------------------------------------------------------------
// One floor

function potionDice(level: number): string {
  return level >= 17 ? '10d4+20' : level >= 11 ? '8d4+8' : level >= 5 ? '4d4+4' : '2d4+2';
}

function shortRest(rng: Rng, party: Member[]): void {
  for (const m of party) {
    while (m.hitDice > 0 && m.hp < m.stats.maxHp - (5 + m.stats.conMod)) {
      m.hitDice--;
      m.hp = Math.min(m.stats.maxHp, m.hp + rng.die(10) + m.stats.conMod);
    }
    m.secondWind = Math.min(m.stats.secondWindUses, m.secondWind + 1);
    m.actionSurge = m.stats.actionSurges;
  }
}

function longRest(party: Member[]): void {
  for (const m of party) {
    m.hp = m.stats.maxHp;
    m.secondWind = m.stats.secondWindUses;
    m.actionSurge = m.stats.actionSurges;
    m.hitDice = Math.min(m.stats.level, m.hitDice + Math.max(1, Math.floor(m.stats.level / 2)));
  }
}

export interface ModelOptions {
  /** Add a second Fighter this many levels below the hero (never below level 1). Omit for a solo hero. */
  allyLevelGap?: number;
  /** Healing potions the hero carries onto each floor. Default: two per level up to six, as the scripted shopper buys. */
  potions?: number;
  /** Hero level minus floor number. Default 0 (the hero gains a level per floor). */
  levelOffset?: number;
}

export interface FloorOutcome {
  cleared: boolean;
  /** Where the hero fell: 'boss' or 'room'. */
  diedIn?: 'boss' | 'room';
  /** Hero hit points entering the boss room, as a fraction of maximum (only if reached). */
  bossEntryHp?: number;
  fights: number;
  rounds: number;
  allyDowned: boolean;
  /** XP of the monsters on the route. */
  xp: number;
}

export function modelFloor(runSeed: number, depth: number, opts: ModelOptions = {}): FloorOutcome {
  const seed = floorSeed(runSeed, depth);
  const plan = generateFloor({ seed, depth, theme: themeForDepth(depth) });
  const placed = buildEncounters(plan, MONSTERS, new Rng(hashSeed(seed, 'encounters')));
  const rng = new Rng(hashSeed(seed, 'model'));
  const level = depth + (opts.levelOffset ?? 0);
  const party: Member[] = [member(fighterAt(level), true, opts.potions ?? Math.min(6, 2 * level))];
  if (opts.allyLevelGap !== undefined) party.push(member(fighterAt(Math.max(1, level - opts.allyLevelGap)), false, 0));
  const hero = party[0] as Member;

  const route = routeToBoss(plan).filter((id) => placed.some((m) => m.roomId === id));
  const out: FloorOutcome = { cleared: false, fights: 0, rounds: 0, allyDowned: false, xp: 0 };
  let shortRests = 2;
  let sites = 0;
  for (let i = 0; i < route.length; i++) {
    const roomId = route[i] as number;
    const boss = plan.rooms.find((r) => r.id === roomId)?.role === 'boss';
    // Rest sites: one becomes available about midway, the other at the boss's door.
    if (i === Math.floor(route.length / 2) || boss) sites++;
    // Rest the way the scripted hero of the real simulation does: a short rest when hurt or when
    // Second Wind or Action Surge is spent, a long rest at a site when that was not enough.
    const hurtBelow = (f: number): boolean => party.some((m) => m.hp < m.stats.maxHp * f);
    const spent = (): boolean => party.some((m) => m.secondWind < m.stats.secondWindUses || m.actionSurge < m.stats.actionSurges);
    if ((hurtBelow(0.6) || spent()) && shortRests > 0) {
      shortRests--;
      shortRest(rng, party);
    }
    if (sites > 0 && (hurtBelow(boss ? 0.8 : 0.6) || (boss && shortRests === 0))) {
      sites--;
      longRest(party);
      shortRests = 2;
    }
    if (boss) out.bossEntryHp = hero.hp / hero.stats.maxHp;
    const defs = placed.filter((m) => m.roomId === roomId).map((m) => MONSTERS.find((d) => d.id === m.creature.defId) as MonsterDef);
    out.xp += defs.reduce((s, d) => s + d.xp, 0);
    const result = fight(rng, party, defs, boss);
    out.fights++;
    out.rounds += result.rounds;
    if (result.allyDown) out.allyDowned = true;
    if (!result.won) {
      out.diedIn = boss ? 'boss' : 'room';
      return out;
    }
    // After a won fight a downed ally is back on their feet, barely; lingering effects end.
    for (const m of party) {
      if (m.hp <= 0) m.hp = 1;
      m.noAct = m.hampered = m.exposed = 0;
      m.saveEnds = [];
    }
  }
  out.cleared = true;
  return out;
}

export interface ModelSummary {
  depth: number;
  theme: string;
  runs: number;
  /** Share of runs that clear the floor at the first attempt. */
  clearRate: number;
  /** Of the failures, the share that died to the boss. */
  bossShare: number;
  /** Mean hero hit points entering the boss room (fraction of maximum). */
  bossEntryHp: number;
  /** Share of runs in which the ally was knocked out at least once. */
  allyDownRate: number;
  /** Mean rounds per fight. */
  roundsPerFight: number;
  /** Mean XP of the monsters fought on the route. */
  xp: number;
}

export function modelDepth(depth: number, runSeeds: number[], opts: ModelOptions = {}): ModelSummary {
  let clears = 0;
  let bossDeaths = 0;
  let entry = 0;
  let entries = 0;
  let allyDown = 0;
  let fights = 0;
  let rounds = 0;
  let xp = 0;
  for (const s of runSeeds) {
    const o = modelFloor(s, depth, opts);
    if (o.cleared) clears++;
    else if (o.diedIn === 'boss') bossDeaths++;
    if (o.bossEntryHp !== undefined) {
      entry += o.bossEntryHp;
      entries++;
    }
    if (o.allyDowned) allyDown++;
    fights += o.fights;
    rounds += o.rounds;
    xp += o.xp;
  }
  const n = runSeeds.length;
  return {
    depth,
    theme: themeForDepth(depth),
    runs: n,
    clearRate: clears / n,
    bossShare: n - clears > 0 ? bossDeaths / (n - clears) : 0,
    bossEntryHp: entries ? entry / entries : 0,
    allyDownRate: allyDown / n,
    roundsPerFight: fights ? rounds / fights : 0,
    xp: xp / n,
  };
}

export function formatModel(rows: ModelSummary[]): string {
  const head = 'floor theme     clear  boss-share  hp@boss  ally-down  rounds  route-xp';
  const lines = rows.map(
    (r) =>
      `${String(r.depth).padStart(5)} ${r.theme.padEnd(9)} ${(r.clearRate * 100).toFixed(0).padStart(4)}%  ${(r.bossShare * 100).toFixed(0).padStart(9)}%  ${(r.bossEntryHp * 100).toFixed(0).padStart(6)}%  ${(r.allyDownRate * 100).toFixed(0).padStart(8)}%  ${r.roundsPerFight.toFixed(1).padStart(6)}  ${r.xp.toFixed(0).padStart(8)}`,
  );
  return [head, ...lines].join('\n');
}

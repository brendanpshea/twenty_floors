import type { Rng } from '../core/rng';
import type {
  Ability,
  AbilityScores,
  ActionDef,
  CompanionDef,
  CompanionFeature,
  CompanionInfo,
  CompanionRole,
  CompanionState,
  Creature,
  GridPos,
  PlayerCharacter,
  ResourcePool,
} from '../core/types';
import { CELL_FEET } from '../core/types';
import { COMPANIONS } from '../data/companions';
import { aggressiveAction, standardActions } from './actions';
import { casterFor, getSpell, spellPoolKey, spellToAction, type Caster } from './spells';
import { rollDice, withModifier } from './dice';
import { abilityMod, clone, flagPool } from './util';

/**
 * Companions: the hero's AI-played travelling partner (docs/DESIGN.md, "Companions").
 *
 * OUR OWN PROGRESSION. The creature's SRD stat block is what it is at companion level 1. The table below (one
 * for all three companions, shaped by role) raises it as the hero levels; nothing here is the tabletop
 * "sidekick" rules, which are not in the SRD. Companion level = hero level - 2 (minimum 1); the hero first
 * brings one at level 4, so the first companion is level 2 and the last (hero 20) level 18.
 *
 *   level   proficiency   AC bonus   flat damage   extra die      saving throw proficiencies
 *   1-2     +2            +0         +0            0              none
 *   3-4     +2            +0         +0..+1        0              first
 *   5-8     +3            +1         +1..+2        1 (level 5)    first
 *   9-12    +4            +2         +2..+3        2 (level 9)    first, second (from 9)
 *   13-16   +5            +3         +4..+5        3 (level 13)   first, second
 *   17-18   +6            +4         +5            4 (level 17)   first, second, third (from 15)
 *
 * - Flat damage: +1 per three levels on the first damage part of an attack roll. Extra dice: one more die of the
 *   scaling attack's own type every four levels (the Sphinx's radiant claws, the Pseudodragon's poison sting).
 * - Hit points: the stat block's, plus (role die + Constitution modifier) for every level above 1. Healer 6,
 *   blaster 5, skirmisher 7.
 * - Ability bumps (+2, maximum 20) at levels 4, 6, 8, 10, 12, 14 and 16, into the role's casting or attack ability,
 *   Dexterity (the natural attacks) and Constitution.
 * - Spell uses per long rest: a kit entry's `uses` at the level it unlocks, +1 for every six levels after.
 * - Spell attack and save DC: from the casting ability (healer Intelligence, others Wisdom) and the proficiency bonus.
 * - HOUSE RULE: the flying companions (Sphinx 40 ft, Pseudodragon 60 ft) use their fly speed as walking speed
 *   and pay 1 for shallow water. They still cannot cross chasms: the navigation grid treats them as impassable
 *   for everyone, hero included.
 */

export interface CompanionRow {
  level: number;
  proficiencyBonus: number;
  acBonus: number;
  flatDamage: number;
  extraDice: number;
}

/** The shared progression row for a companion level (1..18). */
export function companionProgression(level: number): CompanionRow {
  const l = Math.max(1, Math.floor(level));
  return {
    level: l,
    proficiencyBonus: 2 + Math.floor((l - 1) / 4),
    acBonus: Math.floor((l - 1) / 4),
    flatDamage: Math.floor((l - 1) / 3),
    extraDice: Math.floor((l - 1) / 4),
  };
}

interface RoleRule {
  hpPerLevel: number;
  hitDie: number;
  casting: Ability;
  /** [companion level, ability, amount] */
  bumps: [number, Ability, number][];
  saves: Ability[];
}

const ROLE_RULES: Record<CompanionRole, RoleRule> = {
  healer: {
    hpPerLevel: 6,
    hitDie: 6,
    casting: 'int',
    bumps: [[4, 'int', 2], [6, 'dex', 2], [8, 'int', 2], [10, 'dex', 2], [12, 'int', 2], [14, 'con', 2], [16, 'wis', 2]],
    saves: ['wis', 'con', 'dex'],
  },
  blaster: {
    hpPerLevel: 5,
    hitDie: 6,
    casting: 'wis',
    bumps: [[4, 'wis', 2], [6, 'dex', 2], [8, 'wis', 2], [10, 'dex', 2], [12, 'wis', 2], [14, 'con', 2], [16, 'wis', 2]],
    saves: ['con', 'dex', 'wis'],
  },
  skirmisher: {
    hpPerLevel: 7,
    hitDie: 8,
    casting: 'wis',
    bumps: [[4, 'dex', 2], [6, 'con', 2], [8, 'dex', 2], [10, 'con', 2], [12, 'dex', 2], [14, 'con', 2], [16, 'dex', 2]],
    saves: ['dex', 'con', 'wis'],
  },
};

/** Fly speeds in feet (the SRD stat blocks; the data's `speedFt` is walking only). */
const FLY_FT: Record<string, number> = { sphinx_of_wonder: 40, pseudodragon: 60 };

/** Natural attacks that grow an extra die every four levels: [action id, damage part index]. */
const EXTRA_DICE: Record<string, [string, number][]> = {
  sphinx_of_wonder: [['rend', 1]],
  pseudodragon: [['sting', 0]],
};

export function getCompanion(id: string): CompanionDef | undefined {
  return COMPANIONS.find((c) => c.id === id);
}

export function requireCompanion(id: string): CompanionDef {
  const c = getCompanion(id);
  if (!c) throw new Error(`Unknown companion: ${id}`);
  return c;
}

/** A companion is this many levels below the hero. */
export const COMPANION_LEVEL_OFFSET = 2;

/** Companion level alongside a hero of this level: two lower, at least 1. */
export function companionLevel(heroLevel: number): number {
  return Math.max(1, Math.floor(heroLevel) - COMPANION_LEVEL_OFFSET);
}

/** Ability scores at a companion level: the stat block's plus the role's bumps, at most 20 (a higher base stays). */
export function companionAbilities(def: CompanionDef, level: number): AbilityScores {
  const out: AbilityScores = { ...def.base.abilities };
  for (const [at, ability, amount] of ROLE_RULES[def.role].bumps) {
    if (level >= at) out[ability] = Math.max(out[ability], Math.min(20, out[ability] + amount));
  }
  return out;
}

export function companionMaxHp(def: CompanionDef, level: number): number {
  const conMod = abilityMod(companionAbilities(def, level).con);
  return def.base.hp + (Math.max(1, level) - 1) * Math.max(1, ROLE_RULES[def.role].hpPerLevel + conMod);
}

/** The casting ability's caster numbers at a companion level (cantrips scale at levels 5, 11, 17). */
export function companionCaster(def: CompanionDef, level: number): Caster {
  const rule = ROLE_RULES[def.role];
  return casterFor(rule.casting, companionAbilities(def, level), level);
}

/** Kit entries unlocked at a level. */
export function kitAt(def: CompanionDef, level: number): CompanionFeature[] {
  return def.kit.filter((f) => f.level <= level);
}

/** Uses per long rest of a kit entry at a companion level. */
export function usesAt(feature: CompanionFeature, level: number): number {
  return (feature.uses ?? 1) + Math.floor(Math.max(0, level - feature.level) / 6);
}

/** Spells of the kit that are cast in combat (the Prayer of Healing is for between fights). */
const OUT_OF_COMBAT_ONLY = new Set(['prayer_of_healing']);

function scaleNatural(def: CompanionDef, a: ActionDef, row: CompanionRow, abilities: AbilityScores): ActionDef {
  const base = def.base.abilities;
  const dexDelta = abilityMod(abilities.dex) - abilityMod(base.dex);
  const out: ActionDef = clone(a);
  if (out.attack) out.attack.bonus += row.proficiencyBonus - 2 + dexDelta;
  if (out.save) out.save.dc += row.proficiencyBonus - 2 + (abilityMod(abilities.con) - abilityMod(base.con));
  const parts = out.damage;
  if (parts && parts.length > 0) {
    if (out.attack) parts[0] = { ...parts[0]!, dice: withModifier(parts[0]!.dice, row.flatDamage + dexDelta) };
    for (const [id, index] of EXTRA_DICE[def.id] ?? []) {
      const part = parts[index];
      if (id === a.id && part && row.extraDice > 0) {
        const m = /^(\d+)d(\d+)(.*)$/.exec(part.dice);
        if (m) parts[index] = { ...part, dice: `${Number(m[1]) + row.extraDice}d${m[2]}${m[3] ?? ''}` };
      }
    }
  }
  return out;
}

function describeAttack(a: ActionDef): string {
  const parts: string[] = [];
  if (a.attack) parts.push(`${a.attack.bonus >= 0 ? '+' : ''}${a.attack.bonus} to hit`);
  if (a.save) parts.push(`${a.save.ability.toUpperCase()} save DC ${a.save.dc}`);
  if (a.damage) parts.push(a.damage.map((d) => `${d.dice} ${d.type}`).join(' + '));
  return parts.length > 0 ? `${parts.join(', ')}. ${a.description}` : a.description;
}

/** Pools the companion has at a level, at full: spell uses, Burst of Ingenuity and its hidden Hit Dice. */
export function companionResources(def: CompanionDef, level: number): Record<string, ResourcePool> {
  const out: Record<string, ResourcePool> = {};
  for (const f of kitAt(def, level)) {
    const n = usesAt(f, level);
    if (f.spellId) {
      const spell = getSpell(f.spellId);
      if (spell && spell.level >= 1) out[spellPoolKey(f.spellId)] = { name: spell.name, current: n, max: n, refresh: 'longRest' };
    }
    if (f.effect === 'burstOfIngenuity') out['burstOfIngenuity'] = { name: 'Burst of Ingenuity', current: n, max: n, refresh: 'longRest' };
  }
  // Hit Dice for short rests (hidden: the key starts with an underscore).
  out['_hitDice'] = { name: 'Hit Dice', current: level, max: level, refresh: 'longRest' };
  return out;
}

/** HP and pools of a freshly met (or fully rested) companion at a hero level. */
export function newCompanionState(id: string, heroLevel: number = 4): CompanionState {
  const def = requireCompanion(id);
  const level = companionLevel(heroLevel);
  return { id, hp: companionMaxHp(def, level), resources: companionResources(def, level), stance: 'close' };
}

/**
 * The combat creature for a companion beside a hero of `heroLevel`: id 'companion', faction 'ally', the stat
 * block's actions scaled to its level plus its kit. `state` (hit points, spent uses) is applied when given.
 * `pos` is where it stands (the game places it next to the hero).
 */
export function createCompanion(def: CompanionDef, heroLevel: number, state?: CompanionState, pos: GridPos = { x: 0, y: 0 }): Creature {
  const level = companionLevel(heroLevel);
  const row = companionProgression(level);
  const rule = ROLE_RULES[def.role];
  const abilities = companionAbilities(def, level);
  const caster = companionCaster(def, level);
  const kit = kitAt(def, level);
  const effects = new Set(kit.map((f) => f.effect).filter((e): e is string => e !== undefined));
  const baseDex = abilityMod(def.base.abilities.dex);

  const actions: ActionDef[] = def.base.actions.map((a) => {
    const s = scaleNatural(def, a, row, abilities);
    return { ...s, description: describeAttack(s) };
  });
  if (effects.has('doubleBite')) {
    actions.push({
      id: 'double_bite',
      name: 'Double Bite',
      description: 'Two bites in one action. Sneak Attack still applies once per turn.',
      icon: 'bite',
      cost: 'action',
      targeting: { kind: 'creature', melee: true, range: 1 },
      multiattack: ['bite', 'bite'],
    });
  }
  if (effects.has('blink')) {
    const range = effects.has('farBlink') ? 12 : 8;
    const recharge = effects.has('blinkEver') ? 2 : effects.has('blinkSteady') ? 3 : 4;
    actions.push({
      id: 'blink',
      name: 'Teleport',
      description: `Bonus action: blink up to ${range * CELL_FEET} ft to an open space you can see (recharge ${recharge}-6). The attack right after is made from hiding: advantage.`,
      icon: 'special',
      cost: 'bonus',
      targeting: { kind: 'point', range, area: { shape: 'sphere', size: 0 } },
      recharge,
      effects: ['blink'],
    });
  }
  if (effects.has('cunningAction')) {
    actions.push(
      { id: 'cunning_dash', name: 'Cunning Action: Dash', description: 'Bonus action: gain extra movement equal to your speed.', icon: 'dash', cost: 'bonus', targeting: { kind: 'self' }, effects: ['dash'] },
      {
        id: 'cunning_disengage',
        name: 'Cunning Action: Disengage',
        description: 'Bonus action: your movement provokes no opportunity attacks this turn.',
        icon: 'disengage',
        cost: 'bonus',
        targeting: { kind: 'self' },
        effects: ['disengage'],
      },
    );
  }

  const resources: Record<string, ResourcePool> = companionResources(def, level);
  for (const f of kit) {
    if (!f.spellId || OUT_OF_COMBAT_ONLY.has(f.spellId)) continue;
    const spell = getSpell(f.spellId);
    if (!spell) continue;
    const a = spellToAction(spell, caster);
    const n = usesAt(f, level);
    if (spell.level >= 1) a.description = a.description.replace(' Once per long rest.', ` ${n} per long rest.`);
    actions.push(a);
  }
  actions.push(...standardActions());
  if (def.base.traits.includes('aggressive')) actions.push(aggressiveAction());

  // Hidden engine flags for the kit's passive features.
  const flags: Record<string, string> = {
    magicResistance: 'magicResistance',
    burstGreater: 'burstGreater',
    uncannyDodge: 'uncannyDodge',
    evasion: 'evasion',
    elusive: 'elusive',
  };
  for (const [effect, flag] of Object.entries(flags)) if (effects.has(effect)) resources['_' + flag] = flagPool(flag);
  if (effects.has('sneakAttack')) resources['_sneakAttack'] = { name: 'Sneak Attack', current: 1 + Math.floor((level - 1) / 2), max: 0, refresh: 'longRest' };
  const fly = FLY_FT[def.id];
  if (fly !== undefined) resources['_flying'] = flagPool('flying');

  const maxHp = companionMaxHp(def, level);
  const dexNow = abilityMod(abilities.dex);
  const saves = rule.saves.slice(0, level >= 15 ? 3 : level >= 9 ? 2 : level >= 3 ? 1 : 0);
  const visual = [...def.visualTiers].reverse().find((t) => t.fromLevel <= level)?.visual ?? def.visualTiers[0]?.visual ?? def.base.visual;
  const hp = state ? Math.max(1, Math.min(maxHp, state.hp)) : maxHp;
  if (state) {
    for (const [key, pool] of Object.entries(resources)) {
      const saved = state.resources[key];
      if (saved) pool.current = Math.max(0, Math.min(pool.max, saved.current));
    }
  }
  const speedFt = Math.max(def.base.speedFt, fly ?? 0) + (effects.has('fleet') ? 10 : 0);
  return {
    id: 'companion',
    defId: def.id,
    name: def.name,
    faction: 'ally',
    pos: { x: pos.x, y: pos.y },
    size: def.base.size,
    level,
    abilities,
    proficiencyBonus: row.proficiencyBonus,
    saveProficiencies: saves,
    ac: def.base.ac + (dexNow - baseDex) + row.acBonus,
    maxHp,
    hp,
    tempHp: 0,
    speed: Math.round(speedFt / CELL_FEET),
    resistances: [...def.base.resistances, ...(effects.has('fireResistance') ? (['fire'] as const) : [])],
    vulnerabilities: [...def.base.vulnerabilities],
    immunities: [...def.base.immunities],
    conditionImmunities: [...def.base.conditionImmunities],
    conditions: [],
    traits: [...def.base.traits],
    actions,
    resources,
    visual: { ...visual },
    dead: false,
  };
}

/** What the hub's picker shows for a companion at a level (`heroLevel`: the hero's level on the next floor). */
export function companionInfo(def: CompanionDef, heroLevel: number): CompanionInfo {
  const level = companionLevel(heroLevel);
  const c = createCompanion(def, heroLevel);
  const unlocked = kitAt(def, level);
  const next = def.kit.find((f) => f.level > level);
  const summaries = [
    ...c.actions
      .filter((a) => def.base.actions.some((b) => b.id === a.id) && a.cost === 'action' && a.id !== 'multiattack')
      .map((a) => `${a.name}: ${describeAttack(a)}`),
    ...unlocked.map((f) => `${f.name}: ${f.summary}`),
  ];
  const info: CompanionInfo = {
    id: def.id,
    name: def.name,
    role: def.role,
    description: def.description,
    level,
    maxHp: c.maxHp,
    ac: c.ac,
    summaries,
    visual: { ...c.visual },
  };
  if (next) info.nextUnlock = { level: next.level, summary: `${next.name}: ${next.summary}` };
  return info;
}

/** All companions as the hub offers them, for a hero who will be `heroLevelNextFloor` on the next floor. */
export function companionOptions(heroLevelNextFloor: number): CompanionInfo[] {
  return COMPANIONS.map((def) => companionInfo(def, heroLevelNextFloor));
}

/** The state to store after a fight: hit points (a downed companion returns at 1) and spent uses. */
export function syncCompanion(state: CompanionState, creature: Creature): CompanionState {
  const next = clone(state);
  const aided = creature.resources['_aid']?.current ?? 0;
  const cap = creature.maxHp - aided;
  next.hp = creature.dead || creature.hp <= 0 ? 1 : Math.max(1, Math.min(cap, creature.hp));
  for (const [key, pool] of Object.entries(next.resources)) {
    const c = creature.resources[key];
    if (c) pool.current = Math.max(0, Math.min(pool.max, c.current));
  }
  return next;
}

/**
 * A short rest for the companion: it spends its Hit Dice (role die plus Constitution, at least 1 each) while at
 * least an average die of hit points is missing or it is below half health, as the hero's rest does.
 */
export function companionShortRest(state: CompanionState, def: CompanionDef, heroLevel: number, rng: Rng): { state: CompanionState; healed: number } {
  const level = companionLevel(heroLevel);
  const rule = ROLE_RULES[def.role];
  const con = abilityMod(companionAbilities(def, level).con);
  const max = companionMaxHp(def, level);
  const next = clone(state);
  const dice = next.resources['_hitDice'] ?? { name: 'Hit Dice', current: level, max: level, refresh: 'longRest' as const };
  next.resources['_hitDice'] = dice;
  const avg = (rule.hitDie + 1) / 2 + con;
  let healed = 0;
  while (dice.current > 0 && next.hp < max && (max - next.hp >= avg || next.hp < max * 0.5)) {
    const gain = Math.min(Math.max(1, rng.die(rule.hitDie) + con), max - next.hp);
    next.hp += gain;
    healed += gain;
    dice.current -= 1;
  }
  return { state: next, healed };
}

/** A long rest: full hit points, every use and Hit Die, sized for the hero's level (the hub rests after leveling). */
export function companionLongRest(state: CompanionState, def: CompanionDef, heroLevel: number): CompanionState {
  const level = companionLevel(heroLevel);
  return { ...clone(state), hp: companionMaxHp(def, level), resources: companionResources(def, level) };
}

/** Would a rest do anything for the companion? */
export function companionNeedsRest(state: CompanionState, def: CompanionDef, heroLevel: number): boolean {
  const level = companionLevel(heroLevel);
  const full = companionResources(def, level);
  return state.hp < companionMaxHp(def, level) || Object.entries(full).some(([k, p]) => (state.resources[k]?.current ?? 0) < p.max);
}

/**
 * Prayer of Healing, cast between fights (a Sphinx of Wonder from companion level 8): restores 2d8 plus its casting
 * modifier to the hero and to itself, and uses one of its daily casts.
 */
export function companionPrayer(
  pc: PlayerCharacter,
  state: CompanionState,
  def: CompanionDef,
  heroLevel: number,
  rng: Rng,
): { pc: PlayerCharacter; state: CompanionState; healed: number } | { error: string } {
  const level = companionLevel(heroLevel);
  if (!kitAt(def, level).some((f) => f.spellId === 'prayer_of_healing')) return { error: `${def.name} does not know Prayer of Healing yet` };
  const key = spellPoolKey('prayer_of_healing');
  const pool = state.resources[key];
  if (!pool || pool.current < 1) return { error: 'Already prayed: it returns on a long rest' };
  const max = companionMaxHp(def, level);
  if (pc.hp >= pc.maxHp && state.hp >= max) return { error: 'Nobody needs healing' };
  const caster = companionCaster(def, level);
  const dice = withModifier('2d8', caster.mod);
  const nextState = clone(state);
  (nextState.resources[key] as ResourcePool).current -= 1;
  const heroGain = Math.min(rollDice(rng, dice).total, pc.maxHp - pc.hp);
  const selfGain = Math.min(rollDice(rng, dice).total, max - nextState.hp);
  nextState.hp += selfGain;
  return { pc: { ...pc, hp: pc.hp + heroGain }, state: nextState, healed: heroGain + selfGain };
}

/** The role's hit die and casting ability, for the AI and tests. */
export function companionRole(def: CompanionDef): { hitDie: number; casting: Ability; hpPerLevel: number } {
  const r = ROLE_RULES[def.role];
  return { hitDie: r.hitDie, casting: r.casting, hpPerLevel: r.hpPerLevel };
}

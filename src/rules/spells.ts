import type {
  Ability,
  AbilityScores,
  ActionDef,
  CharacterBuild,
  Creature,
  DamagePart,
  DamageType,
  ResourcePool,
  SpellDef,
} from '../core/types';
import { SPELLS } from '../data/spells';
import { withModifier } from './dice';
import { abilityMod, proficiencyForLevel } from './util';

/**
 * Spell engine, pure part: which spells exist, who may pick them, and how a
 * known SpellDef becomes an ActionDef for a given caster. The combat rules for
 * the spell effects live in combat.ts (they need rolls, conditions and turns).
 */

/** Resource-pool key and action-id conventions. */
export const spellPoolKey = (spellId: string): string => `spell:${spellId}`;
export const spellActionId = (spellId: string): string => `spell_${spellId}`;
export const isSpellAction = (a: ActionDef): boolean => a.effects?.includes('spell') === true;

/** Spells the engine fully implements (Cleric and Wizard lists; Druid-only spells are left out). */
export const IMPLEMENTED_SPELL_IDS: ReadonlySet<string> = new Set([
  'acid_splash',
  'chill_touch',
  'fire_bolt',
  'poison_spray',
  'ray_of_frost',
  'shocking_grasp',
  'true_strike',
  'sacred_flame',
  'resistance',
  'magic_missile',
  'burning_hands',
  'shield',
  'thunderwave',
  'sleep',
  'false_life',
  'chromatic_orb',
  'ice_knife',
  'ray_of_sickness',
  'mage_armor',
  'cure_wounds',
  'healing_word',
  'bless',
  'guiding_bolt',
  'shield_of_faith',
  'inflict_wounds',
  'bane',
  'command',
]);

/**
 * Implemented but not offered at creation: Mage Armor only helps an unarmored
 * hero, every starting kit wears armor and the game has no way to take it off,
 * so offering it would be a trap. The engine support (computeAc, castOutOfCombat) is tested.
 */
export const HIDDEN_FROM_CREATION: ReadonlySet<string> = new Set(['mage_armor']);

export function getSpell(id: string): SpellDef | undefined {
  return SPELLS.find((s) => s.id === id);
}

/** Spells a Magic Initiate of this list may pick at this level, implemented and offered only. */
export function offeredSpells(list: 'cleric' | 'wizard', level: 0 | 1): SpellDef[] {
  return SPELLS.filter(
    (s) => s.lists.includes(list) && s.level === level && IMPLEMENTED_SPELL_IDS.has(s.id) && !HIDDEN_FROM_CREATION.has(s.id),
  );
}

export const MI_ABILITIES: Ability[] = ['int', 'wis', 'cha'];
export const MI_KEYS = { cantrip1: 'mi_cantrip1', cantrip2: 'mi_cantrip2', spell: 'mi_spell', ability: 'mi_ability' } as const;

/** Ids of the spells the build knows (Magic Initiate choices). */
export function knownSpellIds(build: CharacterBuild): string[] {
  const c = build.choices;
  return [c[MI_KEYS.cantrip1], c[MI_KEYS.cantrip2], c[MI_KEYS.spell]].filter(
    (x): x is string => typeof x === 'string' && IMPLEMENTED_SPELL_IDS.has(x),
  );
}

export function knownSpells(build: CharacterBuild): SpellDef[] {
  return knownSpellIds(build)
    .map(getSpell)
    .filter((s): s is SpellDef => s !== undefined);
}

/** One long-rest pool per known level-1 spell, named after the spell. */
export function spellPools(build: CharacterBuild): Record<string, ResourcePool> {
  const out: Record<string, ResourcePool> = {};
  for (const s of knownSpells(build)) {
    if (s.level >= 1) out[spellPoolKey(s.id)] = { name: s.name, current: 1, max: 1, refresh: 'longRest' };
  }
  return out;
}

export interface Caster {
  ability: Ability;
  /** Spellcasting ability modifier. */
  mod: number;
  dexMod: number;
  pb: number;
  /** Character level (cantrip scaling uses it). */
  level: number;
  /** Spell attack bonus: proficiency + ability modifier. */
  attack: number;
  /** Spell save DC: 8 + proficiency + ability modifier. */
  dc: number;
}

export function casterFor(ability: Ability, abilities: AbilityScores, level: number): Caster {
  const mod = abilityMod(abilities[ability]);
  const pb = proficiencyForLevel(level);
  return { ability, mod, dexMod: abilityMod(abilities.dex), pb, level, attack: pb + mod, dc: 8 + pb + mod };
}

/** 0 for levels 1-4, then 1, 2, 3 at levels 5, 11 and 17. */
export function cantripTier(level: number): 0 | 1 | 2 | 3 {
  return level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;
}

export function scaledDamage(spell: SpellDef, level: number): DamagePart[] {
  const base = spell.damage ?? [];
  if (spell.level !== 0 || !spell.cantripScaling) return base.map((d) => ({ ...d }));
  const tier = cantripTier(level);
  const dice = tier === 0 ? base[0]?.dice : spell.cantripScaling[tier - 1];
  return base.map((d, i) => (i === 0 && dice ? { dice, type: d.type } : { ...d }));
}

/** Extra radiant dice of True Strike at a character level, or undefined below level 5. */
export function trueStrikeBonusDice(level: number): string | undefined {
  const tier = cantripTier(level);
  return tier === 0 ? undefined : `${tier}d6`;
}

const CHROMATIC_ORDER: DamageType[] = ['fire', 'lightning', 'cold', 'acid', 'thunder', 'poison'];

/**
 * Chromatic Orb's type is chosen automatically at casting: a type the target
 * is vulnerable to, else the first of fire, lightning, cold, acid, thunder,
 * poison that it neither resists nor is immune to, else fire.
 */
export function chromaticOrbType(target: Pick<Creature, 'vulnerabilities' | 'resistances' | 'immunities'>): DamageType {
  const vuln = CHROMATIC_ORDER.find((t) => target.vulnerabilities.includes(t) && !target.immunities.includes(t));
  if (vuln) return vuln;
  return CHROMATIC_ORDER.find((t) => !target.resistances.includes(t) && !target.immunities.includes(t)) ?? 'fire';
}

/** Name of the spell the creature is concentrating on, or null. */
export function concentratingOn(c: Creature): string | null {
  const p = c.resources['_concentration'];
  return p && p.current > 0 ? p.name : null;
}

/** Value of an effect id of the form `key:value`. */
export function fxVal(a: ActionDef, key: string): string | undefined {
  const hit = a.effects?.find((e) => e.startsWith(`${key}:`));
  return hit?.slice(key.length + 1);
}

const fmt = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** Turn a known spell into an ActionDef for this caster. */
export function spellToAction(spell: SpellDef, caster: Caster): ActionDef {
  const effects: string[] = ['spell', ...(spell.effects ?? [])];
  if (spell.concentration) effects.push(`concentration:${spell.durationRounds ?? 10}`);
  const damage = scaledDamage(spell, caster.level);
  const a: ActionDef = {
    id: spellActionId(spell.id),
    name: spell.name,
    description: spell.description,
    icon: spell.icon ?? (spell.resolution === 'heal' ? 'heal' : 'spell'),
    cost: spell.castingTime,
    targeting: spell.targeting.kind === 'self' ? { kind: 'self' } : JSON.parse(JSON.stringify(spell.targeting)),
  };
  // Thunderwave is a 15-foot emanation in SRD 5.2 (the data approximates it as a cone): a sphere centered on the caster.
  if (spell.id === 'thunderwave') a.targeting = { kind: 'point', range: 0, area: { shape: 'sphere', size: 3 } };
  const stat: string[] = [];
  if (spell.resolution === 'attack') {
    a.attack = { bonus: caster.attack };
    stat.push(`${fmt(caster.attack)} to hit`);
  }
  if (spell.resolution === 'save' && spell.save) {
    a.save = { ability: spell.save.ability, dc: caster.dc, halfOnSave: spell.save.halfOnSave };
    stat.push(`${spell.save.ability.toUpperCase()} save DC ${caster.dc}`);
  }
  if (damage.length > 0) {
    a.damage = damage;
    stat.push(damage.map((d) => `${d.dice} ${d.type}`).join(' + '));
  }
  if (spell.heal) {
    a.heal = spell.addsModifier ? withModifier(spell.heal, caster.mod) : spell.heal;
    stat.push(`heals ${a.heal}`);
  }
  if (spell.applies && spell.id !== 'sleep') {
    a.applies = { condition: spell.applies.condition };
    if (spell.applies.rounds !== undefined) a.applies.rounds = spell.applies.rounds;
  }
  if (spell.id === 'ice_knife') effects.push(`burstDc:${caster.dc}`, 'burstDice:2d6');
  if (spell.id === 'false_life') effects.push('tempHp:2d4+4');
  if (spell.level >= 1) a.uses = { resource: spellPoolKey(spell.id), amount: 1 };
  a.effects = effects;
  a.description = `${stat.length > 0 ? `${stat.join(', ')}. ` : ''}${spell.description}${spell.level >= 1 ? ' Once per long rest.' : ''}`;
  return a;
}

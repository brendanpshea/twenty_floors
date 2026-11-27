import { ATTUNEMENT_LIMIT, QUICK_SLOTS } from '../core/types';
import { Rng, hashSeed } from '../core/rng';
import type {
  Ability,
  AbilityScores,
  ActionDef,
  CharacterBuild,
  BackgroundInfo,
  BuildPreset,
  ChoiceSlot,
  CreationOptions,
  DamagePart,
  PassiveEffect,
  Creature,
  ItemDef,
  ItemRarity,
  WeaponMastery,
  ItemStack,
  LevelUpPreview,
  PlayerCharacter,
  ResourcePool,
} from '../core/types';
import { standardActions } from './actions';
import { BACKGROUNDS, featFlags } from './backgrounds';
import {
  MI_ABILITIES,
  casterFor,
  getSpell,
  knownSpells,
  spellPools,
  spellToAction,
  trueStrikeBonusDice,
  type Caster,
} from './spells';
import { CLASSES, classInfo, getClass, masteryKey, type ClassDef } from './classes';
import { averageDice, rollDice } from './dice';
import { getItem, itemCatalog, requireItem } from './items';
import { describePassive } from './describe';
import { scheduledGear } from './gearSchedule';
import { PASSIVE_FLAGS, hovers, activePassives, applyAbilityPassives, attunedIds, creaturePassives, tickTimedEffects, addTimedEffect, hasPassive, passiveAcBonus, passiveMaxHp, weaponPassives } from './passives';
import { SPECIES, getSpecies, speciesFlagPools, type SpeciesDef } from './species';
import { ABILITIES, abilityMod, clone, flagPool, proficiencyForLevel } from './util';


export const STARTING_GOLD = 10;
export const STARTING_POTIONS = 2;
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY = {
  budget: 27,
  min: 8,
  max: 15,
  costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } as Record<number, number>,
};

export function getCreationOptions(): CreationOptions {
  return {
    species: SPECIES.map((s) => s.info),
    classes: CLASSES.map(classInfo),
    backgrounds: BACKGROUNDS,
    standardArray: [...STANDARD_ARRAY],
    pointBuy: { ...POINT_BUY, costs: { ...POINT_BUY.costs } },
  };
}

/**
 * Background increases following a preset's priority: +2 to the first of the background's three abilities in
 * priority order and +1 to the second (abilities missing from the priority list rank last, in the background's order).
 */
export function assignIncreases(bg: BackgroundInfo, priority: Ability[]): Partial<Record<Ability, number>> {
  const rank = (a: Ability): number => {
    const i = priority.indexOf(a);
    return i < 0 ? 99 : i;
  };
  const [first, second] = [...bg.abilityOptions].sort((x, y) => rank(x) - rank(y));
  return { [first as Ability]: 2, [second as Ability]: 1 };
}

/** A valid CharacterBuild from a class preset and a background (default skills, Magic Initiate picks and casting ability). */
export function buildFromPreset(
  preset: BuildPreset,
  backgroundId: string,
  opts: { name?: string; speciesId?: string; classId?: string; featChoices?: Record<string, string> } = {},
): CharacterBuild {
  const bg = BACKGROUNDS.find((b) => b.id === backgroundId);
  if (!bg) throw new Error(`Unknown background: ${backgroundId}`);
  const inc = assignIncreases(bg, preset.abilityPriority);
  const build: CharacterBuild = {
    name: opts.name ?? 'Hero',
    speciesId: opts.speciesId ?? 'human',
    classId: opts.classId ?? 'fighter',
    backgroundId,
    baseAbilities: { ...preset.abilities },
    abilityIncreases: inc,
    skills: ['perception', 'survival'],
    choices: { ...preset.choices },
  };
  if (bg.feat && bg.feat.choices.length > 0) {
    const final = finalAbilities(build);
    for (const slot of bg.feat.choices) {
      if (slot.key === 'mi_ability') {
        build.choices[slot.key] = MI_ABILITIES.reduce((best, a) => (final[a] > final[best] ? a : best), MI_ABILITIES[0] as Ability);
      } else if (slot.group) {
        const used = bg.feat.choices.filter((x) => x.group === slot.group && build.choices[x.key] !== undefined).map((x) => build.choices[x.key]);
        build.choices[slot.key] = (slot.options.find((o) => !used.includes(o.id)) as { id: string }).id;
      } else {
        build.choices[slot.key] = (slot.options[0] as { id: string }).id;
      }
    }
    Object.assign(build.choices, opts.featChoices ?? {});
  }
  return build;
}

/** Ability scores after the background's increases. */
export function finalAbilities(build: CharacterBuild): AbilityScores {
  const out = { ...build.baseAbilities };
  for (const a of ABILITIES) out[a] += build.abilityIncreases[a] ?? 0;
  // Level-up choices: Ability Score Improvements ("asi4", "asi6", ...) in level order, then the Epic Boon.
  const keys = Object.keys(build.choices ?? {})
    .filter((k) => /^asi\d+$/.test(k))
    .sort((x, y) => Number(x.slice(3)) - Number(y.slice(3)));
  for (const k of keys) {
    for (const part of (build.choices[k] as string).split(',')) {
      const m = /^(str|dex|con|int|wis|cha)\+(\d)$/.exec(part);
      if (m) out[m[1] as Ability] = Math.max(out[m[1] as Ability], Math.min(20, out[m[1] as Ability] + Number(m[2])));
    }
  }
  const boon = build.choices?.['epicBoon'];
  if (boon) {
    const best: Ability = out.str >= out.dex ? 'str' : 'dex';
    out[best] = boon === 'combatProwess' ? Math.min(30, out[best] + 1) : Math.min(20, out[best] + 2);
  }
  return out;
}

function classOf(build: CharacterBuild): ClassDef {
  const c = getClass(build.classId);
  if (!c) throw new Error(`Unknown class: ${build.classId}`);
  return c;
}

function speciesOf(build: CharacterBuild): SpeciesDef {
  const s = getSpecies(build.speciesId);
  if (!s) throw new Error(`Unknown species: ${build.speciesId}`);
  return s;
}

export function validateBuild(build: CharacterBuild): string[] {
  const errors: string[] = [];
  const name = build.name?.trim() ?? '';
  if (name.length < 1 || name.length > 24) errors.push('Name must be 1 to 24 characters.');
  const species = getSpecies(build.speciesId);
  if (!species) errors.push(`Unknown species: ${build.speciesId}`);
  const cls = getClass(build.classId);
  if (!cls) errors.push(`Unknown class: ${build.classId}`);
  const bg = BACKGROUNDS.find((b) => b.id === build.backgroundId);
  if (!bg) errors.push(`Unknown background: ${build.backgroundId}`);

  const scores = ABILITIES.map((a) => build.baseAbilities?.[a]);
  if (scores.some((s) => typeof s !== 'number' || !Number.isInteger(s))) {
    errors.push('Ability scores must be whole numbers.');
  } else {
    const nums = scores as number[];
    const isStandard = [...nums].sort((a, b) => b - a).join(',') === STANDARD_ARRAY.join(',');
    const inRange = nums.every((n) => n >= POINT_BUY.min && n <= POINT_BUY.max);
    const cost = inRange ? nums.reduce((s, n) => s + (POINT_BUY.costs[n] as number), 0) : Infinity;
    if (!isStandard && !(inRange && cost <= POINT_BUY.budget)) {
      errors.push(`Ability scores must be the standard array or a point buy of at most ${POINT_BUY.budget} points (scores ${POINT_BUY.min}-${POINT_BUY.max}).`);
    }
  }

  const inc = build.abilityIncreases ?? {};
  const positive: number[] = [];
  for (const [key, value] of Object.entries(inc)) {
    if (!ABILITIES.includes(key as Ability)) errors.push(`Unknown ability in increases: ${key}`);
    else if (bg && !bg.abilityOptions.includes(key as Ability)) errors.push(`${bg.name} cannot raise ${key}.`);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2) errors.push(`Invalid increase for ${key}.`);
    else if (value > 0) positive.push(value);
  }
  const pattern = positive.sort((a, b) => b - a).join(',');
  if (pattern !== '2,1' && pattern !== '1,1,1') errors.push('Ability increases must be +2/+1 or +1/+1/+1.');
  else if (ABILITIES.some((a) => (build.baseAbilities?.[a] ?? 0) + (inc[a] ?? 0) > 20)) errors.push('Ability scores cannot exceed 20.');

  if (cls) {
    const skills = build.skills ?? [];
    if (skills.length !== cls.skillChoices.count) errors.push(`Choose exactly ${cls.skillChoices.count} skills.`);
    if (new Set(skills).size !== skills.length) errors.push('Skills must be distinct.');
    for (const s of skills) {
      if (!cls.skillChoices.from.includes(s)) errors.push(`${s} is not a ${cls.name} skill.`);
      if (bg?.skills.includes(s)) errors.push(`${s} is already granted by the background.`);
    }
    const choices = build.choices ?? {};
    for (const slot of cls.choices) {
      const picked = choices[slot.key];
      if (picked === undefined) errors.push(`Missing choice: ${slot.name}.`);
      else if (!slot.options.some((o) => o.id === picked)) errors.push(`Invalid ${slot.name}: ${picked}.`);
    }
    const featSlots = bg?.feat?.choices ?? [];
    for (const key of Object.keys(choices)) {
      if (key !== 'masteries' && !cls.choices.some((s) => s.key === key) && !featSlots.some((s) => s.key === key)) {
        errors.push(`Unknown choice: ${key}.`);
      }
    }
  }
  // Origin feat choices (Magic Initiate: two distinct cantrips, a level 1 spell and a casting ability).
  if (bg?.feat) {
    const choices = build.choices ?? {};
    const byGroup = new Map<string, string[]>();
    for (const slot of bg.feat.choices) {
      const picked = choices[slot.key];
      if (picked === undefined) errors.push(`Missing choice: ${slot.name}.`);
      else if (!slot.options.some((o) => o.id === picked)) errors.push(`Invalid ${slot.name}: ${picked}.`);
      else if (slot.group) byGroup.set(slot.group, [...(byGroup.get(slot.group) ?? []), picked]);
    }
    for (const [group, picks] of byGroup) {
      if (new Set(picks).size !== picks.length) errors.push(`Choose different options for each ${group.replace('mi_', '')} slot.`);
    }
  }
  return errors;
}

/** HP gained at one level: hit die maximum (solo-balance rule) + CON modifier + species bonus, at least 1. */
function hpPerLevel(build: CharacterBuild): number {
  const cls = classOf(build);
  const sp = speciesOf(build);
  return Math.max(1, cls.hitDie + abilityMod(finalAbilities(build).con) + sp.hpPerLevel);
}

function characterResources(build: CharacterBuild, level: number): Record<string, ResourcePool> {
  return {
    ...clone(classOf(build).resourcesAt(level)),
    ...clone(speciesOf(build).resources),
    ...spellPools(build),
    // HOUSE RULE "Last Stand": replaces death saves; refreshes on entering a floor, not on a short rest.
    lastStand: { name: 'Last Stand', current: 1, max: 1, refresh: 'floor' as const },
  };
}

export function createCharacter(build: CharacterBuild): PlayerCharacter {
  const errors = validateBuild(build);
  if (errors.length > 0) throw new Error(`Invalid character: ${errors.join(' ')}`);
  const cls = classOf(build);
  const kit = cls.kits.find((k) => k.id === build.choices['startingKit']);
  if (!kit) throw new Error('Invalid starting kit');
  const inventory: ItemStack[] = clone(kit.items);
  addToStack(inventory, 'potion_healing', STARTING_POTIONS);
  const maxHp = hpPerLevel(build);
  return {
    build: clone({ ...build, name: build.name.trim(), choices: { ...build.choices, masteries: build.choices['masteries'] ?? kit.masteredKinds.join(',') } }),
    level: 1,
    maxHp,
    hp: maxHp,
    hitDiceLeft: 1,
    resources: characterResources(build, 1),
    inventory,
    equipped: { ...kit.equipped },
    gold: STARTING_GOLD,
  };
}

function addToStack(inv: ItemStack[], itemId: string, qty: number): void {
  const s = inv.find((x) => x.itemId === itemId);
  if (s) s.quantity += qty;
  else inv.push({ itemId, quantity: qty });
}

// ------------------------------------------------------------------ equipment

/** Fighting styles the hero has: the level-1 style and, from level 7 (Champion), a second one. */
function fightingStyles(pc: PlayerCharacter): string[] {
  return [pc.build.choices['fightingStyle'], pc.build.choices['fightingStyle2']].filter((s): s is string => typeof s === 'string');
}

/** Ability scores with the worn and equipped item passives applied (Gauntlets of Ogre Power, Headband of Intellect...). */
export function effectiveAbilities(pc: PlayerCharacter): AbilityScores {
  return applyAbilityPassives(finalAbilities(pc.build), creaturePassives(pc));
}

export function computeAc(pc: PlayerCharacter): number {
  const dex = abilityMod(effectiveAbilities(pc).dex);
  const armor = pc.equipped.armor ? getItem(pc.equipped.armor)?.armor : undefined;
  let ac = 10 + dex;
  // Mage Armor: an unarmored hero's base AC becomes 13 + Dexterity modifier (until the next long rest).
  if (!armor && (pc.resources['_mageArmor']?.current ?? 0) > 0) ac = 13 + dex;
  if (armor) {
    const cap = armor.dexCap;
    ac = armor.baseAc + (cap === undefined ? dex : Math.min(dex, cap));
    if (fightingStyles(pc).includes('defense')) ac += 1;
    ac += (pc.equipped.armor ? getItem(pc.equipped.armor)?.magicBonus : 0) ?? 0;
  }
  const shield = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  if (shield?.kind === 'shield') ac += (shield.shieldBonus ?? 2) + (shield.magicBonus ?? 0);
  return ac + passiveAcBonus(pc);
}

/**
 * Engine effect ids for a weapon mastery property. Nick is handled by the off-hand action (weaponActions).
 * Cleave carries the ability modifier the second attack's damage leaves out.
 * `tactical` (Fighter 9, Tactical Master): HOUSE RULE for the automation, a Graze weapon uses Sap instead
 * (Push, Sap and Slow are the only properties it may be swapped for, and Graze is the weakest to give up).
 */
function masteryEffects(mastery: WeaponMastery | undefined, mod: number, pb: number, tactical = false): string[] {
  if (tactical && mastery === 'graze') mastery = 'sap';
  switch (mastery) {
    case 'cleave':
      return [`mastery:cleave:${Math.max(0, mod)}`];
    case 'slow':
      return ['mastery:slow'];
    case 'vex':
      return ['mastery:vex'];
    case 'sap':
      return ['mastery:sap'];
    case 'push':
      return ['mastery:push'];
    case 'graze':
      return [`mastery:graze:${Math.max(0, mod)}`];
    case 'topple':
      return [`mastery:topple:${8 + mod + pb}`];
    default:
      return [];
  }
}

/** Weapon kinds (base item ids) whose mastery the hero can use: build.choices.masteries, else the starting kit's. */
export function masteredKinds(pc: PlayerCharacter): string[] {
  const raw = pc.build.choices['masteries'];
  if (raw !== undefined) return raw.split(',').filter((x) => x.length > 0);
  return classOf(pc.build).kits.find((k) => k.id === pc.build.choices['startingKit'])?.masteredKinds ?? [];
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * Equipment slots: `mainHand` + `offHand` are the melee set (weapon + shield, or two Light weapons) and `ranged`
 * is a bow or crossbow the hero switches to freely when shooting. A character saved before the ranged slot
 * existed may hold a bow in `mainHand`: this returns a normalized copy (bow to `ranged`, a carried melee weapon
 * promoted to `mainHand`). The stored character is never changed; the game may persist the result.
 */
export function migrateEquipment(pc: PlayerCharacter): PlayerCharacter {
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const w = main?.weapon;
  if (!main || !w || w.melee || w.properties.includes('thrown') || pc.equipped.ranged) return pc;
  const next = clone(pc);
  next.equipped.ranged = main.id;
  delete next.equipped.mainHand;
  const shieldOn = next.equipped.offHand !== undefined;
  const carried = next.inventory
    .map((s) => getItem(s.itemId))
    .filter((i): i is ItemDef => !!i?.weapon?.melee && !i.weapon.properties.includes('thrown'))
    .filter((i) => !(shieldOn && i.weapon?.properties.includes('twoHanded')));
  const best = carried.sort((a, b) => averageDice((b.weapon as NonNullable<ItemDef['weapon']>).damage.dice) - averageDice((a.weapon as NonNullable<ItemDef['weapon']>).damage.dice))[0];
  if (best) next.equipped.mainHand = best.id;
  return next;
}

function weaponAction(
  item: ItemDef,
  mode: 'attack' | 'throw',
  opts: {
    abilities: AbilityScores;
    pb: number;
    styles: string[];
    twoHands: boolean;
    mastered?: boolean;
    /** Tactical Master (Fighter 9) is active. */
    tactical?: boolean;
    /** Off-hand attack of two-weapon fighting: no modifier on the damage unless negative (or the style). */
    offhand?: { free: boolean };
    /** The weapon's attack has a Light off-hand partner. */
    lightPair?: boolean;
    /** Spellcasting ability modifier replacing the weapon's own (True Strike). */
    modOverride?: number;
    /** The weapon-only passives of the item that work for the hero (weaponDamage, weaponCritDamage, critRange). */
    passives?: PassiveEffect[];
  },
): ActionDef {
  const w = item.weapon as NonNullable<ItemDef['weapon']>;
  const str = abilityMod(opts.abilities.str);
  const dex = abilityMod(opts.abilities.dex);
  const finesse = w.properties.includes('finesse');
  const ranged = !w.melee && mode === 'attack';
  const mod = opts.modOverride ?? (ranged ? dex : finesse ? Math.max(str, dex) : str);
  const archery = ranged && opts.styles.includes('archery') ? 2 : 0;
  const mb = item.magicBonus ?? 0;
  const bonus = mod + opts.pb + archery + mb;
  const dice = opts.twoHands && w.versatileDice ? w.versatileDice : w.damage.dice;
  const dmgMod = opts.offhand && !opts.styles.includes('twoWeaponFighting') ? Math.min(0, mod) : mod;
  const dmgDice = `${dice}${dmgMod + mb === 0 ? '' : fmtMod(dmgMod + mb)}`;
  const masteryFx = opts.mastered ? masteryEffects(w.mastery, mod, opts.pb, opts.tactical) : [];
  // SRD Heavy property: disadvantage with a Heavy weapon if Strength (melee) or Dexterity (ranged) is below 13.
  const heavyFx = w.properties.includes('heavy') && mode === 'attack' && (ranged ? opts.abilities.dex : opts.abilities.str) < 13 ? ['heavyDisadvantage'] : [];
  // Item passives on the weapon: flat extra damage parts; riders against some creature types and the critical effects travel as effects.
  const extraParts: DamagePart[] = [];
  const passiveFx: string[] = [];
  for (const p of opts.passives ?? []) {
    if (p.type === 'weaponDamage') {
      if (p.versus && p.versus.length > 0) passiveFx.push(`bane:${p.dice}:${p.damageType ?? w.damage.type}:${p.versus.join('/')}`);
      else extraParts.push({ dice: p.dice, type: p.damageType ?? w.damage.type });
    } else if (p.type === 'weaponCritDamage') passiveFx.push(`critdmg:${p.dice}:${p.damageType ?? w.damage.type}`);
    else if (p.type === 'critRange') passiveFx.push(`crit:${p.from}`);
  }
  const base = { cost: 'action' as const, attack: { bonus }, damage: [{ dice: dmgDice, type: w.damage.type }, ...extraParts] };
  if (mode === 'throw') {
    const r = w.range ?? { normal: 4, long: 12 };
    return {
      ...base,
      id: `throw_${item.id}`,
      name: `Throw ${item.name}`,
      description: `${fmtMod(bonus)} to hit, ${dmgDice} ${w.damage.type}. Range ${r.normal * 5} ft.`,
      icon: 'thrown',
      ...(masteryFx.length > 0 ? { effects: masteryFx } : {}),
      targeting: { kind: 'creature', melee: false, range: r.normal, longRange: r.long },
    };
  }
  const gwf = !ranged && opts.twoHands && opts.styles.includes('greatWeaponFighting');
  const loadingFx = w.properties.includes('loading') ? ['loading'] : [];
  // Tactical Master (HOUSE RULE: the replacement is chosen by the engine, see combat.ts): the weapon's own property travels with the action.
  const tmFx = opts.tactical && opts.mastered && w.mastery ? [`tmOwn:${w.mastery}:${Math.max(0, mod)}`] : [];
  const fx = [...(gwf ? ['greatWeaponFighting'] : []), ...masteryFx, ...tmFx, ...passiveFx, ...heavyFx, ...loadingFx, ...(opts.lightPair ? ['lightAttack'] : [])];
  if (opts.offhand) {
    const nick = opts.offhand.free;
    return {
      ...base,
      id: `offhand_${item.id}`,
      name: `Off-hand: ${item.name}`,
      description: `${nick ? 'Nick: made as part of your Attack action. ' : 'Bonus action after attacking with your main hand. '}${fmtMod(bonus)} to hit, ${dmgDice} ${w.damage.type}.`,
      icon: 'melee',
      cost: nick ? 'free' : 'bonus',
      effects: ['offhand', ...fx],
      targeting: { kind: 'creature', melee: true, range: 1 },
    };
  }
  const common = {
    ...base,
    id: `atk_${item.id}`,
    name: item.name,
    description: `${fmtMod(bonus)} to hit, ${dmgDice} ${w.damage.type}.`,
    ...(fx.length > 0 ? { effects: fx } : {}),
  };
  if (ranged) {
    const r = w.range ?? { normal: 8, long: 24 };
    return { ...common, icon: 'ranged', targeting: { kind: 'creature', melee: false, range: r.normal, longRange: r.long } };
  }
  return { ...common, icon: 'melee', targeting: { kind: 'creature', melee: true, range: w.properties.includes('reach') ? 2 : 1 } };
}

const isLight = (i: ItemDef | undefined): boolean => !!i?.weapon?.melee && i.weapon.properties.includes('light');

/** The off-hand Light weapon that pairs with the main hand for two-weapon fighting, if any. */
function offhandPartner(pc: PlayerCharacter): ItemDef | undefined {
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const off = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  if (!main || !off || !isLight(main) || !isLight(off)) return undefined;
  const owned = pc.inventory.find((s) => s.itemId === main.id)?.quantity ?? 1;
  return off.id === main.id && owned < 2 ? undefined : off;
}

/** Weapon attack actions: main-hand melee, the ranged slot, the off-hand attack, and thrown weapons. */
function weaponActions(pcRaw: PlayerCharacter, abilities: AbilityScores, pb: number): ActionDef[] {
  const pc = migrateEquipment(pcRaw);
  const styles = fightingStyles(pc);
  const tactical = classOf(pc.build).flagsAt(pc.level).includes('tacticalMaster');
  const kinds = masteredKinds(pc);
  const mastered = (i: ItemDef): boolean => kinds.includes(i.baseId ?? i.id);
  const hasWeapon = (i: ItemDef | undefined): i is ItemDef => !!i?.weapon;
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const rangedItem = pc.equipped.ranged ? getItem(pc.equipped.ranged) : undefined;
  const out: ActionDef[] = [];
  const shieldOn = pc.equipped.offHand !== undefined && getItem(pc.equipped.offHand)?.kind === 'shield';
  const partner = offhandPartner(pc);
  if (hasWeapon(main)) {
    const w = main.weapon as NonNullable<ItemDef['weapon']>;
    const twoHands = w.properties.includes('twoHanded') || (w.properties.includes('versatile') && !shieldOn && !partner);
    out.push(weaponAction(main, 'attack', { abilities, pb, styles, tactical, twoHands, mastered: mastered(main), lightPair: partner !== undefined, passives: weaponPassives(pc, main) }));
  }
  if (hasWeapon(rangedItem)) out.push(weaponAction(rangedItem, 'attack', { abilities, pb, styles, tactical, twoHands: false, mastered: mastered(rangedItem), passives: weaponPassives(pc, rangedItem) }));
  if (hasWeapon(main) && partner) {
    // Nick: the extra attack of the Light property is made as part of the Attack action (once per turn) instead of a bonus action.
    // SRD: the mastery of the weapon that makes the extra attack (the off-hand one) decides.
    const nick = mastered(partner) && partner.weapon?.mastery === 'nick';
    out.push(weaponAction(partner, 'attack', { abilities, pb, styles, tactical, twoHands: false, mastered: mastered(partner), offhand: { free: nick }, passives: weaponPassives(pc, partner) }));
  }
  const carried = pc.inventory
    .map((s) => getItem(s.itemId))
    .filter(hasWeapon)
    .filter((i, idx, arr) => arr.findIndex((x) => x.id === i.id) === idx);
  for (const item of carried) {
    const w = item.weapon as NonNullable<ItemDef['weapon']>;
    if (w.properties.includes('thrown')) {
      out.push(weaponAction(item, 'throw', { abilities, pb, styles, tactical, twoHands: false, mastered: mastered(item), passives: weaponPassives(pc, item) }));
    }
  }
  if (out.length === 0) {
    const mod = abilityMod(abilities.str);
    out.push({
      id: 'unarmed',
      name: 'Unarmed Strike',
      description: `${fmtMod(mod + pb)} to hit, ${Math.max(1, 1 + mod)} bludgeoning.`,
      icon: 'melee',
      cost: 'action',
      targeting: { kind: 'creature', melee: true, range: 1 },
      attack: { bonus: mod + pb },
      damage: [{ dice: String(Math.max(1, 1 + mod)), type: 'bludgeoning' }],
    });
  }
  return out;
}

/** True Strike: one attack with the main-hand (else ranged) weapon using the spellcasting ability, plus radiant dice from level 5. */
function trueStrikeAction(pcRaw: PlayerCharacter, abilities: AbilityScores, pb: number, caster: Caster): ActionDef | undefined {
  const pc = migrateEquipment(pcRaw);
  const id = pc.equipped.mainHand ?? pc.equipped.ranged;
  const item = id ? getItem(id) : undefined;
  if (!item?.weapon) return undefined;
  const w = item.weapon;
  const shieldOn = pc.equipped.offHand !== undefined && getItem(pc.equipped.offHand)?.kind === 'shield';
  const twoHands = w.properties.includes('twoHanded') || (w.properties.includes('versatile') && !shieldOn);
  const base = weaponAction(item, 'attack', { abilities, pb, styles: fightingStyles(pc), twoHands, modOverride: caster.mod });
  const extra = trueStrikeBonusDice(caster.level);
  const damage = [...(base.damage ?? []), ...(extra ? [{ dice: extra, type: 'radiant' as const }] : [])];
  const fx = (base.effects ?? []).filter((e) => !e.startsWith('mastery:') && e !== 'lightAttack');
  return {
    ...base,
    id: 'spell_true_strike',
    name: 'True Strike',
    icon: 'spell',
    description: `${fmtMod(base.attack?.bonus ?? 0)} to hit, ${damage.map((d) => `${d.dice} ${d.type}`).join(' + ')}. One attack with ${item.name} using your spellcasting ability${extra ? `, plus ${extra} radiant` : ''}.`,
    damage,
    effects: ['spell', 'weaponAttack', 'trueStrike', ...fx],
  };
}

/** The quick slots (QUICK_SLOTS, in core/types): stacks of consumables that can be used in a fight (a stack is as many of one item as the hero carries). */

/** The item ids in the quick slots: the hero's own choice (kept to what it still carries), else its first four consumable stacks. */
export function quickSlotIds(pc: PlayerCharacter): string[] {
  const carried = (id: string): boolean => getItem(id)?.consumable !== undefined && pc.inventory.some((s) => s.itemId === id && s.quantity > 0);
  const chosen = pc.quick;
  if (chosen) return chosen.filter(carried).slice(0, QUICK_SLOTS);
  return pc.inventory.filter((s) => carried(s.itemId)).map((s) => s.itemId).slice(0, QUICK_SLOTS);
}

/** Put a consumable in a quick slot (0-3), or empty the slot with null. The other slots keep what they hold. */
export function setQuickSlot(pc: PlayerCharacter, slot: number, itemId: string | null): PlayerCharacter {
  if (slot < 0 || slot >= QUICK_SLOTS) throw new Error('No such quick slot');
  if (itemId !== null && !getItem(itemId)?.consumable) throw new Error('Only consumables go in a quick slot');
  if (itemId !== null && !pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) throw new Error('You do not carry that');
  const next = clone(pc);
  const row: (string | null)[] = Array.from({ length: QUICK_SLOTS }, (_, i) => quickSlotIds(pc)[i] ?? null);
  row[slot] = itemId;
  next.quick = row.filter((id, i): id is string => id !== null && row.indexOf(id) === i);
  return next;
}

/** Resource-pool key of an item's spell charges (they refill on a long rest and persist between fights). */
export const itemChargeKey = (itemId: string, spellId: string): string => `charge:${itemId}:${spellId}`;
export const itemSpellActionId = (itemId: string, spellId: string): string => `itemspell_${itemId}_${spellId}`;

/** Spells granted by wands, staffs and other items: one action each, with charges that return on a long rest. */
function grantItemSpells(pc: PlayerCharacter, abilities: AbilityScores, actions: ActionDef[], resources: Record<string, ResourcePool>): void {
  const mod = Math.max(0, abilityMod(abilities.int), abilityMod(abilities.wis), abilityMod(abilities.cha));
  const pb = proficiencyForLevel(pc.level);
  const caster = { ...casterFor('cha', abilities, pc.level), mod, attack: pb + mod, dc: 8 + pb + mod };
  for (const ap of activePassives(pc)) {
    const p = ap.passive;
    if (p.type !== 'castSpell' || p.charges <= 0) continue;
    const spell = getSpell(p.spellId);
    const item = getItem(ap.itemId);
    if (!spell || !item) continue;
    const base = spellToAction(spell, caster);
    const key = itemChargeKey(ap.itemId, p.spellId);
    const action: ActionDef = { ...base, id: itemSpellActionId(ap.itemId, p.spellId), name: `${spell.name} (${item.name})`, uses: { resource: key, amount: 1 } };
    if (p.saveDc !== undefined && action.save) action.save = { ...action.save, dc: p.saveDc };
    if (p.attackBonus !== undefined && action.attack) action.attack = { bonus: p.attackBonus };
    action.description = `${base.description.replace(' Once per long rest.', '')} From ${item.name}: ${p.charges} charge${p.charges === 1 ? '' : 's'}, back after a long rest.`;
    actions.push(action);
    const old = pc.resources[key];
    resources[key] = { name: `${item.name}: ${spell.name}`, current: old ? Math.min(old.current, p.charges) : p.charges, max: p.charges, refresh: 'longRest' };
  }
}

/** Extra walking speed from passives, in cells. */
function passiveSpeed(pc: PlayerCharacter): number {
  return creaturePassives(pc).reduce((n, p) => n + (p.type === 'speedBonus' ? p.cells : 0), 0);
}

/** The passives the combat engine reads as hidden resource flags (they are not shown to the player). */
function applyPassiveFlags(pc: PlayerCharacter, resources: Record<string, ResourcePool>): void {
  const ps = creaturePassives(pc);
  const pool = (name: string, current: number): ResourcePool => ({ name, current, max: 0, refresh: 'longRest' });
  const save = ps.reduce((n, p) => n + (p.type === 'saveBonus' ? p.amount : 0), 0);
  if (save !== 0) resources[PASSIVE_FLAGS.saveBonus] = pool('Save bonus', save);
  if (hasPassive(pc, 'initiativeAdvantage')) resources[PASSIVE_FLAGS.initAdv] = flagPool('initAdv');
  if (hasPassive(pc, 'critImmunity')) resources[PASSIVE_FLAGS.critImmunity] = flagPool('critImmunity');
  if (hasPassive(pc, 'displacement')) resources[PASSIVE_FLAGS.displacement] = flagPool('displacement');
  const regen = ps.reduce((n, p) => n + (p.type === 'regeneration' ? p.amount : 0), 0);
  if (regen > 0) resources[PASSIVE_FLAGS.regeneration] = pool('Regeneration', regen);
  if (hovers(pc)) {
    resources['_hover'] = flagPool('hover');
    for (const h of ['fall', 'lava'] as const) resources[PASSIVE_FLAGS.ignorePrefix + h] = flagPool('ignore_' + h);
  }
  for (const p of ps) if (p.type === 'ignoreHazard') resources[PASSIVE_FLAGS.ignorePrefix + p.hazard] = flagPool('ignore_' + p.hazard);
}

export function toCreature(pc: PlayerCharacter, pos: { x: number; y: number }): Creature {
  const cls = classOf(pc.build);
  const sp = speciesOf(pc.build);
  const abilities = effectiveAbilities(pc);
  const pb = proficiencyForLevel(pc.level);
  const actions: ActionDef[] = [...weaponActions(pc, abilities, pb)];

  const resources: Record<string, ResourcePool> = clone(pc.resources);
  for (const f of [...sp.flags, ...cls.flagsAt(pc.level), ...featFlags(pc.build.backgroundId)]) resources['_' + f] = flagPool(f);
  if (pc.build.choices['epicBoon'] === 'combatProwess') resources['_combatProwess'] = flagPool('combatProwess');
  // Extra Attack: attacks per Attack action, and how many of each thrown weapon are carried (one throw per weapon per attack).
  const attacks = cls.attacksAt?.(pc.level) ?? 1;
  if (attacks > 1) resources['_attacks'] = { name: 'Attacks', current: attacks, max: 0, refresh: 'longRest' };
  for (const stack of pc.inventory) {
    const item = getItem(stack.itemId);
    if (item?.weapon?.properties.includes('thrown') && stack.quantity > 0) {
      resources[`_carry_${item.id}`] = { name: item.name, current: stack.quantity, max: 0, refresh: 'longRest' };
    }
  }

  if (resources['secondWind']) {
    actions.push({
      id: 'second_wind',
      name: 'Second Wind',
      description: `Bonus action: regain 1d10 + ${pc.level} hit points${cls.flagsAt(pc.level).includes('tacticalShift') ? ', then move up to half your speed without provoking opportunity attacks' : ''}.`,
      icon: 'heal',
      cost: 'bonus',
      targeting: { kind: 'self' },
      heal: `1d10+${pc.level}`,
      uses: { resource: 'secondWind', amount: 1 },
      effects: ['secondWind'],
    });
  }
  if (resources['actionSurge']) {
    actions.push({
      id: 'action_surge',
      name: 'Action Surge',
      description: 'Take one additional action this turn (a full new Attack action, with all its attacks). Usable once per turn, after you have used your action.',
      icon: 'surge',
      cost: 'free',
      targeting: { kind: 'self' },
      uses: { resource: 'actionSurge', amount: 1 },
      effects: ['actionSurge'],
    });
  }
  actions.push(...standardActions());
  const quick = quickSlotIds(pc);
  for (const stack of pc.inventory) {
    const item = getItem(stack.itemId);
    if (!item?.consumable || stack.quantity <= 0 || !quick.includes(item.id)) continue;
    const key = `item:${item.id}`;
    resources[key] = { name: item.name, current: stack.quantity, max: stack.quantity, refresh: 'longRest' };
    if (item.consumable.effect === 'timed') {
      const lines = item.consumable.passives.map(describePassive).filter((t): t is string => t !== null);
      actions.push({
        id: `use_${item.id}`,
        name: item.name,
        description: `Bonus action: use for ${item.consumable.fights === 1 ? 'this fight' : `${item.consumable.fights} fights`}${item.consumable.hover ? ' (narrow flight)' : ''}${lines.length ? `: ${lines.join('; ')}` : ''}.`,
        icon: 'potion',
        cost: 'bonus',
        targeting: { kind: 'self' },
        uses: { resource: key, amount: 1 },
        effects: [`timedUse:${item.id}`],
      });
      continue;
    }
    actions.push({
      id: `drink_${item.id}`,
      name: item.name,
      description: `Bonus action: drink to regain ${item.consumable.dice} hit points.`,
      icon: 'potion',
      cost: 'bonus',
      targeting: { kind: 'self' },
      heal: item.consumable.dice,
      uses: { resource: key, amount: 1 },
    });
  }

  // Spells from the origin feat (Magic Initiate): cantrips at will, the level 1 spell once per long rest.
  const known = knownSpells(pc.build);
  if (known.length > 0) {
    const ability = MI_ABILITIES.includes(pc.build.choices['mi_ability'] as Ability) ? (pc.build.choices['mi_ability'] as Ability) : 'int';
    const caster = casterFor(ability, abilities, pc.level);
    const armored = pc.equipped.armor !== undefined;
    for (const spell of known) {
      let action: ActionDef | undefined;
      if (spell.id === 'true_strike') action = trueStrikeAction(pc, abilities, pb, caster);
      else if (spell.id === 'mage_armor' && armored) action = undefined;
      else action = spellToAction(spell, caster);
      if (!action) continue;
      actions.push(action);
      if (action.uses && !resources[action.uses.resource]) {
        resources[action.uses.resource] = { name: spell.name, current: 1, max: 1, refresh: 'longRest' };
      }
    }
  }

  grantItemSpells(pc, abilities, actions, resources);
  applyPassiveFlags(pc, resources);
  const armor = pc.equipped.armor ? getItem(pc.equipped.armor)?.armor : undefined;
  const tooWeak = armor?.strRequirement !== undefined && abilities.str < armor.strRequirement;
  return {
    id: 'player',
    defId: cls.id,
    name: pc.build.name,
    faction: 'player',
    pos: { x: pos.x, y: pos.y },
    size: 'medium',
    level: pc.level,
    abilities,
    proficiencyBonus: pb,
    saveProficiencies: [...cls.saves],
    ac: computeAc(pc),
    maxHp: pc.maxHp + passiveMaxHp(pc),
    // Full health stays full when an item raises the maximum.
    hp: pc.hp >= pc.maxHp ? pc.maxHp + passiveMaxHp(pc) : pc.hp,
    // Temporary hit points from False Life cast between fights last until the next long rest.
    tempHp: pc.resources['_tempHp']?.current ?? 0,
    // Armor without enough Strength costs 10 ft of speed (SRD 5.2).
    speed: Math.max(0, sp.speed - (tooWeak ? 2 : 0) + passiveSpeed(pc)),
    resistances: [...new Set([...sp.resistances, ...creaturePassives(pc).flatMap((p) => (p.type === 'resistance' ? [p.damageType] : []))])],
    vulnerabilities: [],
    immunities: creaturePassives(pc).flatMap((p) => (p.type === 'immunity' ? [p.damageType] : [])),
    conditionImmunities: creaturePassives(pc).flatMap((p) => (p.type === 'conditionImmunity' ? [p.condition] : [])),
    conditions: [],
    traits: [],
    actions,
    resources,
    visual: { ...sp.info.visual },
    dead: false,
  };
}

/** A new PlayerCharacter with hit points, resources and consumed items copied back from the creature. */
export function syncFromCreature(pc: PlayerCharacter, creature: Creature): PlayerCharacter {
  const next = clone(pc);
  next.hp = Math.max(0, Math.min(next.maxHp, creature.hp));
  for (const [key, pool] of Object.entries(next.resources)) {
    const c = creature.resources[key];
    if (c) pool.current = Math.max(0, Math.min(pool.max, c.current));
  }
  // Hidden state that outlives a fight until the next long rest (max 0, so a long rest clears it): False Life's temporary HP and Mage Armor.
  const temp = Math.max(0, creature.tempHp);
  if (temp > 0 || next.resources['_tempHp']) next.resources['_tempHp'] = { name: 'Temporary HP', current: temp, max: 0, refresh: 'longRest' };
  if ((creature.resources['_mageArmor']?.current ?? 0) > 0) next.resources['_mageArmor'] = { name: 'Mage Armor', current: 1, max: 0, refresh: 'longRest' };
  let withTimed = next;
  for (const [key, pool] of Object.entries(creature.resources)) {
    if (!key.startsWith('item:')) continue;
    const id = key.slice('item:'.length);
    const stack = next.inventory.find((s) => s.itemId === id);
    const def = getItem(id);
    // A timed consumable used in the fight starts its effect (this fight counts, so it is ticked below).
    if (stack && def?.consumable?.effect === 'timed' && pool.current < stack.quantity) {
      withTimed = addTimedEffect(withTimed, { id: def.id, name: def.name, passives: def.consumable.passives, fightsLeft: def.consumable.fights, ...(def.consumable.hover ? { hover: true } : {}) });
    }
    if (stack) stack.quantity = Math.max(0, pool.current);
  }
  if (withTimed !== next) next.timed = withTimed.timed;
  next.inventory = next.inventory.filter((s) => s.quantity > 0);
  // Item spell charges outlive the fight until the next long rest.
  for (const [key, pool] of Object.entries(creature.resources)) if (key.startsWith('charge:')) next.resources[key] = { ...pool, current: Math.max(0, Math.min(pool.max, pool.current)) };
  // A fight has been fought: timed effects run down.
  return tickTimedEffects(next);
}

// -------------------------------------------------------------------- levelling

/** An ASI option that would still raise something (every named score below 20). */
function asiUseful(abilities: AbilityScores, id: string): boolean {
  return id.split(',').every((part) => {
    const m = /^(str|dex|con|int|wis|cha)\+(\d)$/.exec(part);
    return !!m && abilities[m[1] as Ability] < 20;
  });
}

/** The weapon mastery a new mastery slot offers: base weapons with a mastery property not yet known, carried ones first. */
function masterySlot(pc: PlayerCharacter, toLevel: number): ChoiceSlot {
  const known = masteredKinds(pc);
  const carried = new Set(pc.inventory.map((s) => getItem(s.itemId)?.baseId ?? s.itemId));
  const options = [...itemCatalog()]
    .filter((i) => i.kind === 'weapon' && i.weapon?.mastery && i.baseId === undefined && !i.magicBonus && !known.includes(i.id))
    .sort((a, b) => Number(carried.has(b.id)) - Number(carried.has(a.id)) || a.name.localeCompare(b.name))
    .map((i) => ({ id: i.id, name: i.name, description: `Mastery: ${i.weapon?.mastery}${carried.has(i.id) ? ' (you carry one)' : ''}.` }));
  return { key: masteryKey(toLevel), name: 'Weapon Mastery', options };
}

/** The choices a level-up asks for, with ASI options trimmed to those that still raise a score. */
function levelSlots(pc: PlayerCharacter, to: number): ChoiceSlot[] {
  const cls = classOf(pc.build);
  const abilities = finalAbilities(pc.build);
  const out: ChoiceSlot[] = [];
  for (const slot of cls.levelChoices[to] ?? []) {
    let options = slot.options.map((o) => ({ ...o }));
    if (slot.key.startsWith('asi')) options = options.filter((o) => asiUseful(abilities, o.id));
    if (slot.key === 'fightingStyle2') options = options.filter((o) => !fightingStyles(pc).includes(o.id));
    out.push({ ...slot, options });
  }
  if ((cls.weaponMasteriesAt?.(to) ?? 0) > (cls.weaponMasteriesAt?.(pc.level) ?? 0)) {
    const slot = masterySlot(pc, to);
    if (slot.options.length > 0) out.push(slot);
  }
  return out;
}

export function previewLevelUp(pc: PlayerCharacter): LevelUpPreview | null {
  const cls = classOf(pc.build);
  if (pc.level >= cls.maxLevel) return null;
  const to = pc.level + 1;
  const feats = cls.features.filter((f) => f.level === to).map((f) => `${f.name}: ${f.summary}`);
  const row = cls.resourcesAt(to);
  const before = cls.resourcesAt(pc.level);
  for (const [key, pool] of Object.entries(row)) {
    const old = before[key];
    if (old && pool.max > old.max) feats.push(`${pool.name}: ${old.max} to ${pool.max} uses.`);
  }
  const attacks = cls.attacksAt?.(to) ?? 1;
  const slots = levelSlots(pc, to);
  if (slots.some((s) => s.key.startsWith('asi'))) feats.push('Hit points rise retroactively if the improvement raises your Constitution modifier.');
  if (cls.weaponMasteriesAt && cls.weaponMasteriesAt(to) > cls.weaponMasteriesAt(pc.level)) feats.push(`Weapon Mastery: you can now use ${cls.weaponMasteriesAt(to)} weapon kinds.`);
  if (attacks > (cls.attacksAt?.(pc.level) ?? 1)) feats.push(`Attack action: ${attacks} attacks.`);
  return { fromLevel: pc.level, toLevel: to, hpGain: hpPerLevel(pc.build), featureSummaries: feats, choices: slots };
}

/**
 * Sensible picks for every choice of the next level-up (for autoplay, quick builds and the balance runs):
 * ASIs raise the better of Strength or Dexterity to 20 and then Constitution; the second fighting style fits
 * the wielded gear; a new weapon mastery is the first offered (a weapon you carry); the Epic Boon is Combat Prowess.
 */
export function suggestedLevelChoices(pc: PlayerCharacter): Record<string, string> {
  const preview = previewLevelUp(pc);
  const out: Record<string, string> = {};
  if (!preview) return out;
  const ab = finalAbilities(pc.build);
  const primary: Ability = ab.str >= ab.dex ? 'str' : 'dex';
  const pair = (a: Ability, b: Ability): string => {
    const order = ABILITIES.indexOf(a) < ABILITIES.indexOf(b) ? [a, b] : [b, a];
    return `${order[0]}+1,${order[1]}+1`;
  };
  for (const slot of preview.choices) {
    const has = (id: string): boolean => slot.options.some((o) => o.id === id);
    let pick: string | undefined;
    if (slot.key.startsWith('asi')) {
      const wish = [
        ab[primary] <= 18 ? `${primary}+2` : '',
        ab[primary] === 19 ? pair(primary, 'con') : '',
        ab.con <= 18 ? 'con+2' : '',
        pair('con', primary === 'str' ? 'dex' : 'str'),
        `${primary === 'str' ? 'dex' : 'str'}+2`,
      ];
      pick = wish.find((id) => id !== '' && has(id));
    } else if (slot.key === 'fightingStyle2') {
      const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
      const pref = main?.weapon?.properties.includes('twoHanded') ? ['greatWeaponFighting', 'defense'] : pc.equipped.ranged && !pc.equipped.mainHand ? ['archery', 'defense'] : ['defense', 'archery', 'twoWeaponFighting'];
      pick = pref.find(has);
    } else if (slot.key === 'epicBoon') {
      pick = 'combatProwess';
    }
    out[slot.key] = pick ?? (slot.options[0] as { id: string }).id;
  }
  return out;
}

export function applyLevelUp(pc: PlayerCharacter, choices: Record<string, string>): PlayerCharacter {
  const preview = previewLevelUp(pc);
  if (!preview) throw new Error('Already at maximum level');
  const cls = classOf(pc.build);
  const next = clone(pc);
  const conBefore = abilityMod(finalAbilities(pc.build).con);
  for (const slot of preview.choices) {
    const picked = choices[slot.key];
    if (!picked || !slot.options.some((o) => o.id === picked)) throw new Error(`Invalid or missing choice: ${slot.name}`);
    next.build.choices[slot.key] = picked;
    if (slot.key.startsWith('mastery')) next.build.choices['masteries'] = [...masteredKinds(pc), picked].join(',');
  }
  next.level = preview.toLevel;
  // A higher Constitution modifier counts for every level already taken (SRD), then the new level's hit points.
  const retro = (abilityMod(finalAbilities(next.build).con) - conBefore) * pc.level;
  const gain = hpPerLevel(next.build) + Math.max(0, retro);
  next.maxHp += gain;
  next.hp += gain;
  next.hitDiceLeft += 1;
  for (const [key, pool] of Object.entries(cls.resourcesAt(next.level))) {
    const old = next.resources[key];
    next.resources[key] = old
      ? { ...pool, current: Math.max(0, Math.min(pool.max, old.current + (pool.max - old.max))) }
      : { ...pool };
  }
  return next;
}

// ------------------------------------------------------------------------ rests

function hitDieAverage(pc: PlayerCharacter): number {
  return (classOf(pc.build).hitDie + 1) / 2 + abilityMod(finalAbilities(pc.build).con);
}

/** True if the next Hit Die would be spent by an optimal short rest. */
function wouldSpendDie(pc: PlayerCharacter): boolean {
  const missing = pc.maxHp - pc.hp;
  if (pc.hitDiceLeft <= 0 || missing <= 0) return false;
  return missing >= hitDieAverage(pc) || pc.hp < pc.maxHp * 0.5;
}

/** Would a short rest do anything? For the HUD. */
export function shortRestGain(pc: PlayerCharacter): { hp: boolean; resources: boolean } {
  const cls = classOf(pc.build);
  const resources = Object.entries(pc.resources).some(
    ([key, pool]) => pool.current < pool.max && (pool.refresh === 'shortRest' || (cls.shortRestRecovery[key] ?? 0) > 0),
  );
  return { hp: wouldSpendDie(pc), resources };
}

/**
 * SRD 5.2 short rest. Spends Hit Dice one at a time (class hit die + CON,
 * at least 1 each) while a die is left and at least an average die of HP is
 * missing, or the hero is below half HP with anything missing. Second Wind
 * regains one use, Action Surge its use. Last Stand is untouched. The
 * 2-per-long-rest limit is the caller's job.
 */
export function takeShortRest(pc: PlayerCharacter, rng: Rng): { pc: PlayerCharacter; healed: number; hitDiceSpent: number } {
  const cls = classOf(pc.build);
  const con = abilityMod(effectiveAbilities(pc).con);
  const double = hasPassive(pc, 'doubleHitDiceHealing');
  const next = clone(pc);
  let healed = 0;
  let spent = 0;
  while (wouldSpendDie(next)) {
    const roll = Math.max(1, rng.die(cls.hitDie) + con) * (double ? 2 : 1);
    const gain = Math.min(roll, next.maxHp - next.hp);
    next.hp += gain;
    healed += gain;
    next.hitDiceLeft -= 1;
    spent += 1;
  }
  for (const [key, pool] of Object.entries(next.resources)) {
    if (pool.refresh === 'shortRest') pool.current = pool.max;
    else {
      const n = cls.shortRestRecovery[key];
      if (n) pool.current = Math.min(pool.max, pool.current + n);
    }
  }
  return { pc: next, healed, hitDiceSpent: spent };
}

/** Would a long rest do anything? */
export function longRestGain(pc: PlayerCharacter): boolean {
  return (
    pc.hp < pc.maxHp ||
    pc.hitDiceLeft < pc.level ||
    Object.entries(pc.resources).some(([key, pool]) => key !== 'lastStand' && pool.current < pool.max)
  );
}

/** Long rest: full HP, all Hit Dice, every resource except Last Stand (that returns on entering a floor). */
export function longRest(pc: PlayerCharacter): PlayerCharacter {
  const next = clone(pc);
  next.hp = next.maxHp;
  next.hitDiceLeft = next.level;
  for (const [key, pool] of Object.entries(next.resources)) if (key !== 'lastStand') pool.current = pool.max;
  return next;
}

/** Entering a floor restores Last Stand (once per floor, however many long rests). */
export function enterFloor(pc: PlayerCharacter): PlayerCharacter {
  const next = clone(pc);
  const ls = next.resources['lastStand'];
  if (ls) ls.current = ls.max;
  for (const pool of Object.values(next.resources)) if (pool.refresh === 'floor') pool.current = pool.max;
  return next;
}

// -------------------------------------------------------------------- hub helpers

/** Gold for clearing a floor. */
/** Economy tuning (mutable for the balance harness). */
// Re-tune: the real economy paid 30 to 60% of what the gear schedule costs at shop prices; scaled so cumulative gold covers it with 25% spare (src/balance/economy.test.ts).
export const ECONOMY = { rewardBase: 250, rewardPerDepth: 125 };

export function floorReward(depth: number): number {
  return ECONOMY.rewardBase + ECONOMY.rewardPerDepth * depth;
}

/**
 * Gating for shops and loot, in one place. Magic bonuses unlock at these depths.
 * Nothing magic is sold or found on floors 1-3.
 */
export const ITEM_GATING = {
  /** First depth at which a +N item may be in the shop. */
  shopMagicMinDepth: { 1: 4, 2: 9, 3: 15 } as Record<number, number>,
  /** Random +N items per shop once unlocked. 0: magic beyond the gear schedule is found in chests, not bought. */
  shopMagicSlots: 0,
  /** First depth at which a chest may hold a +1 weapon or shield, and the chance per chest. */
  chestMagicMinDepth: 4,
  chestMagicChance: 0.12,
  /** Mundane gear on sale: price cap = base + perDepth * depth, and slots. */
  shopCostCapBase: 40,
  shopCostCapPerDepth: 40,
  weaponSlots: 3,
  armorSlots: 2,
  /** The shop sells plain gear and consumables, never permanent magic. True would add the +N version of what the hero carries when the gear schedule expects it. */
  shopScheduledMagic: false,
  /** How many kinds of healing potion a shop sells (the strongest ones unlocked), and the most items on a hero's shelf. */
  shopPotionKinds: 2,
  /** Other potions and oils on the shelf (Resistance, Giant Strength, Speed...), each of a different family, from the rarities unlocked at the depth. */
  shopElixirSlots: 3,
  /** The chance that a boss chest holds a magic find at silver (gold 1.5 times, bronze half), from the gated depth. Boss chests are where the powerful items are. */
  bossChestMagicChance: 0.75,
  shopMaxItems: 12,
  /** First depth that sells Greater Healing. */
  greaterPotionMinDepth: 3,
  /** First depth of each higher healing potion (sold when the catalog has it): a potion that heals 7 is no help to a hero of 100 hit points. */
  potionMinDepth: { potion_superior_healing: 9, potion_supreme_healing: 15 } as Record<string, number>,
  /** First depth at which a magic item of each rarity (rings, cloaks, wands, weapons of slaying...) is sold or found; legendary items are never sold or found in chests. */
  wonderMinDepth: { uncommon: 4, rare: 9, veryRare: 15 } as Partial<Record<ItemRarity, number>>,
  /** Magic items of their own per shop (0: chests only), and the price cap as a multiple of the floor reward at that depth. */
  shopWonderSlots: 0,
  shopWonderCostFactor: 4,
  /** Share of the magic finds of a chest that are one of these items instead of +N gear. */
  chestWonderShare: 0.5,
};

/** The strongest healing potion in a list (what a sensible buyer stocks up on). */
export function bestPotion(items: readonly ItemDef[]): ItemDef | undefined {
  return items.filter((i) => i.consumable?.effect === 'heal' && i.cost > 0).sort((a, b) => averageDice((b.consumable as { dice: string }).dice) - averageDice((a.consumable as { dice: string }).dice))[0];
}

const isMundane = (i: ItemDef): boolean => !i.magicBonus && i.baseId === undefined;

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];

/** A magic item that is not just +N gear: it has a rarity of its own (see data/magicItems). */
export function isWonder(i: ItemDef): boolean {
  return i.rarity !== undefined && i.rarity !== 'common' && !i.magicBonus && i.cost > 0 && i.kind !== 'consumable';
}

/** The magic items on offer at `depth`: only the rarities unlocked by then (none before the first gated depth). */
export function wondersAt(depth: number): ItemDef[] {
  const unlocked = (r: ItemRarity | undefined): boolean => {
    const min = r ? ITEM_GATING.wonderMinDepth[r] : undefined;
    return min !== undefined && depth >= min;
  };
  return [...itemCatalog()].filter((i) => isWonder(i) && unlocked(i.rarity)).sort((x, y) => x.id.localeCompare(y.id));
}

function pickSome<T>(items: T[], n: number, rng: Rng): T[] {
  return rng.shuffle([...items]).slice(0, n);
}

/**
 * Items on sale when about to enter `depth`: a curated, deterministic-per-depth
 * selection (potions, a few weapons, a few armor upgrades and a shield), plus
 * rare magic stock from the depths listed in ITEM_GATING.
 */
export function shopStock(depth: number, pc?: PlayerCharacter): ItemDef[] {
  const g = ITEM_GATING;
  const rng = new Rng(hashSeed(depth, 'shop'));
  const cap = g.shopCostCapBase + g.shopCostCapPerDepth * depth;
  const all = [...itemCatalog()].sort((x, y) => x.id.localeCompare(y.id));
  const mundane = all.filter((i) => i.cost > 0 && isMundane(i) && i.cost <= cap);
  // Each group in order of importance: when the shelf is full, the last groups give way first.
  const out: ItemDef[] = [];
  // Consumables: the strongest healing potions sold at this depth (a potion that heals 7 is no help to a hero of 100 hit points).
  const potionIds = ['potion_healing', ...(depth >= g.greaterPotionMinDepth ? ['potion_greater_healing'] : []), ...Object.entries(g.potionMinDepth).filter(([, min]) => depth >= min).map(([id]) => id)];
  const potions = potionIds.map((id) => all.find((i) => i.id === id && i.cost > 0)).filter((i): i is ItemDef => !!i).sort((x, y) => x.cost - y.cost);
  out.push(...potions.slice(-g.shopPotionKinds));
  // Other potions and oils: one each of a few families, from the rarities unlocked here (legendary ones are never sold).
  const elixirs = all.filter((i) => {
    const min = i.rarity ? g.wonderMinDepth[i.rarity] : undefined;
    return i.kind === 'consumable' && i.consumable?.effect === 'timed' && i.cost > 0 && min !== undefined && depth >= min;
  });
  const family = (i: ItemDef): string => (i.id.startsWith('potion_of_resistance') ? 'resistance' : i.id.startsWith('potion_of_giant_strength') ? 'giant' : i.id);
  const families = [...new Set(elixirs.map(family))];
  for (const f of pickSome(families, g.shopElixirSlots, rng)) {
    const members = elixirs.filter((i) => family(i) === f);
    // Giant Strength: the strongest unlocked. Resistance: any one type.
    out.push(f === 'giant' ? (members.sort((x, y) => y.cost - x.cost)[0] as ItemDef) : (members[rng.int(0, members.length - 1)] as ItemDef));
  }
  // The scheduled gear for this level is always on offer (see gearSchedule.ts): with a hero, the upgrade of what it carries
  // (and the plain armor of a new tier, as the cheaper step); without one, that of every starting kit.
  const wanted = new Set<string>();
  const level = pc?.level ?? depth;
  const carried = pc ? [pc.equipped] : CLASSES.flatMap((c) => c.kits.map((k) => k.equipped));
  for (const eq of carried) {
    const have = Object.values(eq);
    const haveKinds = have.map((id) => (id ? (getItem(id)?.baseId ?? id) : ''));
    for (const id of Object.values(scheduledGear(level, eq))) {
      if (have.includes(id)) continue;
      const def = getItem(id);
      if (def?.magicBonus && !g.shopScheduledMagic) {
        if (def.baseId && !haveKinds.includes(def.baseId)) wanted.add(def.baseId);
        continue;
      }
      wanted.add(id);
      if (def?.baseId && !haveKinds.includes(def.baseId)) wanted.add(def.baseId);
    }
  }
  out.push(...all.filter((i) => wanted.has(i.id) && i.cost > 0));
  // Plain gear: a shield, the best affordable armors (so upgrades exist at every tier) and a few weapons.
  out.push(...mundane.filter((i) => i.kind === 'shield').slice(0, 1));
  // (For a hero: no armor weaker than what it wears, and no weapon it already holds.)
  const wornAc = pc?.equipped.armor ? (getItem(pc.equipped.armor)?.armor?.baseAc ?? 0) : 0;
  const held = pc ? Object.values(pc.equipped).map((id) => (id ? (getItem(id)?.baseId ?? id) : '')) : [];
  const armors = mundane.filter((i) => i.kind === 'armor' && (i.armor?.baseAc ?? 0) >= wornAc && !held.includes(i.id)).sort((x, y) => (y.armor?.baseAc ?? 0) - (x.armor?.baseAc ?? 0));
  out.push(...armors.slice(0, g.armorSlots));
  out.push(...pickSome(mundane.filter((i) => i.kind === 'weapon'), g.weaponSlots, rng).filter((i) => !held.includes(i.id)));
  // Magic beyond the schedule is treasure, found in chests; these two are off (0 slots) unless a variant turns them on.
  const magicOk = (i: ItemDef): boolean => {
    const bonus = i.magicBonus ?? 0;
    const min = g.shopMagicMinDepth[bonus];
    return bonus > 0 && min !== undefined && depth >= min && i.cost > 0 && i.kind !== 'consumable';
  };
  if (g.shopMagicSlots > 0) out.push(...pickSome(all.filter(magicOk), g.shopMagicSlots, rng));
  const wonderCap = floorReward(depth) * g.shopWonderCostFactor;
  if (g.shopWonderSlots > 0) out.push(...pickSome(wondersAt(depth).filter((i) => i.cost <= wonderCap), g.shopWonderSlots, rng));
  const unique = [...new Map(out.map((i) => [i.id, i])).values()];
  // With no hero the schedule of every kit is listed, so the cap applies only to a hero's own shop.
  const kept = pc ? unique.slice(0, g.shopMaxItems) : unique;
  return kept.sort((x, y) => x.cost - y.cost || x.name.localeCompare(y.name));
}

export function buyItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const item = requireItem(itemId);
  if (item.cost <= 0) throw new Error(`${item.name} is not for sale`);
  if (pc.gold < item.cost) throw new Error(`Not enough gold for ${item.name}`);
  const next = clone(pc);
  next.gold = Math.round((next.gold - item.cost) * 100) / 100;
  addToStack(next.inventory, itemId, 1);
  return next;
}

/**
 * Whether an item can be equipped, with a reason when equipping it will put
 * something away (a Two-Handed weapon and a shield cannot be used together).
 */
interface EquipPlan {
  slot: 'armor' | 'mainHand' | 'offHand' | 'ranged';
  /** Item ids put away from their slots by this change. */
  clears: ('mainHand' | 'offHand')[];
  reason?: string;
}

/** Where an item goes and what it displaces; shared by canEquip and equipItem. */
function planEquip(pc: PlayerCharacter, item: ItemDef): EquipPlan {
  if (item.kind === 'armor') return { slot: 'armor', clears: [] };
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const off = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  if (item.kind === 'shield') {
    if (main?.weapon?.properties.includes('twoHanded')) {
      return { slot: 'offHand', clears: ['mainHand'], reason: `${main.name} needs both hands: it is put away to carry the shield.` };
    }
    return { slot: 'offHand', clears: [] };
  }
  const w = item.weapon as NonNullable<ItemDef['weapon']>;
  // Bows and crossbows have their own slot and are switched to freely. HOUSE RULE: a shield stays on while shooting
  // (we do not model stowing it for a two-handed bow), so it keeps its AC bonus at all times.
  if (!w.melee && !w.properties.includes('thrown')) return { slot: 'ranged', clears: [] };
  if (w.properties.includes('twoHanded')) {
    if (!off) return { slot: 'mainHand', clears: [] };
    const what = off.kind === 'shield' ? 'the shield' : 'the off-hand weapon';
    return { slot: 'mainHand', clears: ['offHand'], reason: `${item.name} needs both hands: ${what} is put away.` };
  }
  const light = isLight(item);
  // A second Light weapon goes to the off hand for two-weapon fighting when the main hand holds a Light weapon and there is no shield.
  if (light && isLight(main) && !off && (main?.id !== item.id || (pc.inventory.find((s) => s.itemId === item.id)?.quantity ?? 0) >= 2)) {
    return { slot: 'offHand', clears: [], reason: `${item.name} goes in your off hand for two-weapon fighting.` };
  }
  // A new main-hand weapon that is not Light cannot pair with an off-hand weapon.
  if (off && off.kind !== 'shield' && !light) {
    return { slot: 'mainHand', clears: ['offHand'], reason: `${item.name} is not Light: the off-hand weapon is put away.` };
  }
  return { slot: 'mainHand', clears: [] };
}

type WornKey = keyof NonNullable<PlayerCharacter['worn']>;

/** Which worn key a wondrous item takes: its slot, and for a ring the first free ring slot (else it replaces the first). */
function wornKeyFor(pc: PlayerCharacter, item: ItemDef): WornKey | undefined {
  if (item.kind !== 'wondrous' || !item.slot) return undefined;
  if (item.slot !== 'ring') return item.slot;
  const w = pc.worn ?? {};
  if (w.ring === item.id) return 'ring';
  if (w.ring2 === item.id) return 'ring2';
  if (!w.ring) return 'ring';
  if (!w.ring2) return 'ring2';
  return 'ring';
}

/** Attunement state: the ids the hero is attuned to and how many more it can take. */
export function attunementStatus(pc: PlayerCharacter): { ids: string[]; used: number; limit: number; free: number } {
  const ids = attunedIds(pc);
  return { ids, used: ids.length, limit: ATTUNEMENT_LIMIT, free: ATTUNEMENT_LIMIT - ids.length };
}

/** Whether the hero can attune to an item now (owned, needs attunement, not yet attuned, a free slot). */
export function canAttune(pc: PlayerCharacter, itemId: string): { ok: boolean; reason?: string } {
  const item = getItem(itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (!pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) return { ok: false, reason: `You do not own ${item.name}` };
  if (!item.attunement) return { ok: false, reason: `${item.name} needs no attunement` };
  if (attunedIds(pc).includes(itemId)) return { ok: false, reason: `You are already attuned to ${item.name}` };
  if (attunedIds(pc).length >= ATTUNEMENT_LIMIT) return { ok: false, reason: `You can attune to only ${ATTUNEMENT_LIMIT} items: end one attunement first` };
  return { ok: true };
}

export function attuneItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const can = canAttune(pc, itemId);
  if (!can.ok) throw new Error(can.reason);
  const next = clone(pc);
  next.attuned = [...attunedIds(pc), itemId];
  return next;
}

export function unattuneItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  if (!attunedIds(pc).includes(itemId)) throw new Error('You are not attuned to that item');
  const next = clone(pc);
  next.attuned = attunedIds(pc).filter((id) => id !== itemId);
  return next;
}

/** Take a worn item off (it stays in the pack; its attunement ends). */
export function removeWorn(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const next = clone(pc);
  const worn = { ...(next.worn ?? {}) };
  let found = false;
  for (const k of Object.keys(worn) as WornKey[]) {
    if (worn[k] === itemId) {
      delete worn[k];
      found = true;
    }
  }
  if (!found) throw new Error('That item is not worn');
  next.worn = worn;
  next.attuned = attunedIds(pc).filter((id) => id !== itemId);
  return next;
}

export function canEquip(pc: PlayerCharacter, itemId: string): { ok: boolean; reason?: string; unequips?: string } {
  const item = getItem(itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (!pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) return { ok: false, reason: `You do not own ${item.name}` };
  if (item.kind === 'consumable') return { ok: false, reason: `${item.name} cannot be equipped` };
  if (item.kind === 'wondrous') {
    const key = wornKeyFor(pc, item);
    if (!key) return { ok: false, reason: `${item.name} works from your pack${item.attunement ? ': attune to it' : ''}` };
    const out: { ok: boolean; reason?: string; unequips?: string } = { ok: true };
    const there = pc.worn?.[key];
    if (there && there !== itemId) out.unequips = there;
    if (item.attunement && !attunedIds(pc).includes(itemId)) {
      out.reason = attunedIds(pc).length < ATTUNEMENT_LIMIT ? `${item.name} will attune to you.` : `You are attuned to ${ATTUNEMENT_LIMIT} items already: ${item.name} will not work until you end one attunement.`;
    }
    return out;
  }
  const plan = planEquip(pc, item);
  const out: { ok: boolean; reason?: string; unequips?: string } = { ok: true };
  const gone = plan.clears[0] ? pc.equipped[plan.clears[0]] : undefined;
  if (gone) out.unequips = gone;
  if (plan.reason) out.reason = plan.reason;
  return out;
}

export function equipItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const item = requireItem(itemId);
  if (!pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) throw new Error(`You do not own ${item.name}`);
  if (item.kind === 'consumable') throw new Error(`${item.name} cannot be equipped`);
  const next = clone(migrateEquipment(pc));
  if (item.kind === 'wondrous') {
    const key = wornKeyFor(next, item);
    if (!key) throw new Error(`${item.name} works from your pack`);
    const worn = { ...(next.worn ?? {}) };
    const replaced = worn[key];
    if (replaced === itemId) return next;
    worn[key] = itemId;
    next.worn = worn;
    // The replaced item is no longer worn, so its attunement ends; a new item that needs attunement attunes when a slot is free.
    if (replaced) next.attuned = attunedIds(next).filter((id) => id !== replaced);
    if (item.attunement && canAttune(next, itemId).ok) next.attuned = [...attunedIds(next), itemId];
    return next;
  }
  const plan = planEquip(next, item);
  for (const c of plan.clears) delete next.equipped[c];
  next.equipped[plan.slot] = itemId;
  return next;
}

/**
 * Use a consumable outside combat (currently healing potions). Returns a new
 * character and the hit points actually restored. Throws if the character
 * does not own the item, it is not a consumable, or there is nothing to heal.
 */
export function useConsumable(pc: PlayerCharacter, itemId: string, rng: Rng): { pc: PlayerCharacter; healed: number } {
  const item = requireItem(itemId);
  if (!item.consumable) throw new Error(`${item.name} cannot be used`);
  const effect = item.consumable;
  const stack = pc.inventory.find((s) => s.itemId === itemId && s.quantity > 0);
  if (!stack) throw new Error(`You do not have ${item.name}`);
  if (effect.effect === 'timed') {
    const used = addTimedEffect(pc, { id: item.id, name: item.name, passives: effect.passives, fightsLeft: effect.fights, ...(effect.hover ? { hover: true } : {}) });
    const s2 = used.inventory.find((x) => x.itemId === itemId) as ItemStack;
    s2.quantity -= 1;
    used.inventory = used.inventory.filter((x) => x.quantity > 0);
    return { pc: used, healed: 0 };
  }
  if (pc.hp >= pc.maxHp) throw new Error('Already at full health');
  const next = clone(pc);
  const healed = Math.min(rollDice(rng, effect.dice).total, next.maxHp - next.hp);
  next.hp += healed;
  const s = next.inventory.find((x) => x.itemId === itemId) as ItemStack;
  s.quantity -= 1;
  next.inventory = next.inventory.filter((x) => x.quantity > 0);
  return { pc: next, healed };
}

/** Tunable chest loot (mutable for the balance harness). */
export const CHEST_RULE = { goldMin: 50, goldMax: 100, goldPerDepthMin: 34, goldPerDepthMax: 68, extraPotionChance: 0.25 };

/** How well a chest's lock was opened: the result of its puzzle ('none': skipped or failed, a forced lock still pays a little). */
export type ChestGrade = 'gold' | 'silver' | 'bronze' | 'none';

/** What each grade pays, relative to silver (silver is what an instantly opened chest pays): gold = full, silver 75% of it, bronze 50%, none 25%. */
export const CHEST_GRADES: Record<ChestGrade, { gold: number; item: number; potionExtra: number; magic: number }> = {
  gold: { gold: 4 / 3, item: 1, potionExtra: 0.5, magic: 1.5 },
  silver: { gold: 1, item: 1, potionExtra: 0.25, magic: 1 },
  bronze: { gold: 2 / 3, item: 0.6, potionExtra: 0, magic: 0.5 },
  none: { gold: 1 / 3, item: 0, potionExtra: 0, magic: 0 },
};

/** The boss chest pays about this many ordinary chests of gold, and holds a Potion of Healing and often a second. */
export const BOSS_CHEST_FACTOR = 2.5;

export interface ChestLootOptions {
  /** The puzzle result (default 'silver': an instantly opened chest). */
  grade?: ChestGrade;
  /** The floor's boss chest: pays BOSS_CHEST_FACTOR chests of gold, one or two potions, and from the gated depth a real chance of magic gear (of the depth's tier, 40%). */
  boss?: boolean;
  /**
   * How many ordinary chests the floor has. Each chest's gold is divided so a floor's treasure at silver stays what the economy
   * expects whatever the count: ordinary chests pay R / (n + 2.5) each and the boss chest 2.5 times that (R = the rolled gold of
   * one chest, as before). The potion in an ordinary chest becomes a chance of min(1, 1 / n) and its magic find a chance of 1 / n of before (a floor's total stays about what one chest gave). Omitted: one chest, as before.
   */
  chestsOnFloor?: number;
  /**
   * How well each item suits the hero opening the chest (see lootFit in lootFit.ts). Given, a magic find is drawn with these
   * weights instead of evenly, so chests lean toward gear the build can use. Whether a chest holds a find, its gold and its
   * potions do not change. Omitted: an even draw, as before.
   */
  fit?: (item: ItemDef) => number;
}

/**
 * What a treasure chest holds on `depth`: gold, Potions of Healing and, from the gated depths, now and then +N gear. The shared
 * rule for the game and the balance simulation. With no options it is the instant-open chest of before (silver, one chest).
 */
export function chestLoot(depth: number, rng: Rng, opts: ChestLootOptions = {}): { gold: number; items: ItemStack[] } {
  const c = CHEST_RULE;
  const g = CHEST_GRADES[opts.grade ?? 'silver'];
  const boss = opts.boss === true;
  const n = opts.chestsOnFloor;
  const roll = rng.int(c.goldMin + c.goldPerDepthMin * depth, c.goldMax + c.goldPerDepthMax * depth);
  const share = n === undefined ? 1 : 1 / (Math.max(1, n) + BOSS_CHEST_FACTOR);
  const gold = Math.round(roll * g.gold * share * (boss ? BOSS_CHEST_FACTOR : 1));
  const items: ItemStack[] = [];
  // Potions: as before one guaranteed (silver/gold) plus a chance of a second; with several chests the guarantee becomes a chance.
  const potionChance = (n === undefined ? 1 : Math.min(1, 1 / Math.max(1, n))) * g.item;
  const extra = rng.chance(c.extraPotionChance * (g.potionExtra / 0.25));
  const given = boss ? 1 : n === undefined ? (g.item === 1 ? 1 : rng.chance(potionChance) ? 1 : 0) : rng.chance(potionChance) ? 1 : 0;
  // A boss chest holds a potion and a second one half the time (a gold grade always); ordinary chests as before.
  const bossExtra = boss && (opts.grade === 'gold' || rng.chance(0.5));
  const potions = given + (!boss && given > 0 && extra ? 1 : 0) + (bossExtra ? 1 : 0);
  if (potions > 0) items.push({ itemId: 'potion_healing', quantity: potions });
  // Magic find from the gated depth on (never on floors 1-3). A boss chest has a real chance and pays out of the depth's tier.
  const minDepth = ITEM_GATING.chestMagicMinDepth;
  const chance = boss ? ITEM_GATING.bossChestMagicChance : ITEM_GATING.chestMagicChance / (n === undefined ? 1 : Math.max(1, n));
  if (depth >= minDepth && g.magic > 0 && rng.chance(chance * g.magic)) {
    const tier = boss ? (depth >= ITEM_GATING.shopMagicMinDepth[3]! ? 3 : depth >= ITEM_GATING.shopMagicMinDepth[2]! ? 2 : 1) : 1;
    const wantArmor = boss;
    // Named gear with a bonus (Dragon Scale Mail, Shield of the Cavalier) also waits for its rarity to unlock.
    const rarityOpen = (i: ItemDef): boolean => {
      const min = i.rarity && i.rarity !== 'common' ? ITEM_GATING.wonderMinDepth[i.rarity] : 0;
      return min !== undefined && depth >= min;
    };
    const finds = [...itemCatalog()]
      .filter((i) => i.magicBonus === tier && rarityOpen(i) && (i.kind === 'weapon' || i.kind === 'shield' || (wantArmor && i.kind === 'armor')))
      .sort((x, y) => x.id.localeCompare(y.id));
    // Half of the finds are one of the magic items of their own: a boss chest pays out of the top unlocked rarity, an ordinary chest of any unlocked one.
    const fit = opts.fit;
    const draw = (from: ItemDef[]): ItemDef => (fit ? rng.weighted(from, from.map((i) => Math.max(fit(i), 0))) : rng.pick(from));
    const wonders = wondersAt(depth);
    const topRank = wonders.reduce((m, i) => Math.max(m, RARITY_ORDER.indexOf(i.rarity as ItemRarity)), 0);
    // The top unlocked rarity is the boss chest's; an ordinary chest holds the lesser ones (all of them while only one is unlocked).
    const lesser = wonders.filter((i) => RARITY_ORDER.indexOf(i.rarity as ItemRarity) < topRank);
    const wonderPool = boss ? wonders.filter((i) => RARITY_ORDER.indexOf(i.rarity as ItemRarity) === topRank) : lesser.length > 0 ? lesser : wonders;
    const pool = finds.length > 0 ? finds : [...itemCatalog()].filter((i) => i.magicBonus === 1 && (i.kind === 'weapon' || i.kind === 'shield')).sort((x, y) => x.id.localeCompare(y.id));
    // The coin between a wonder and plain +N gear is tossed as before. For a known hero, a side with nothing of use gives
    // way to the other when that one has something (deep down, an ordinary chest's +1 gear is behind what the hero carries).
    let wonder = wonderPool.length > 0 && rng.chance(ITEM_GATING.chestWonderShare);
    if (fit) {
      const useful = (from: ItemDef[]): boolean => from.some((i) => fit(i) >= 1);
      if (wonder && !useful(wonderPool) && useful(pool)) wonder = false;
      else if (!wonder && wonderPool.length > 0 && !useful(pool) && useful(wonderPool)) wonder = true;
    }
    if (wonder) {
      items.push({ itemId: draw(wonderPool).id, quantity: 1 });
      return { gold, items };
    }
    if (pool.length > 0) items.push({ itemId: draw(pool).id, quantity: 1 });
  }
  return { gold, items };
}

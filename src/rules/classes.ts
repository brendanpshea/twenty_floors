import type { Ability, AbilityScores, BuildPreset, ChoiceOption, ChoiceSlot, ClassInfo, ItemStack, ResourcePool, Skill } from '../core/types';
import { FIGHTER_LEVELS, FIGHTER_MAX_LEVEL, fighterFlagsUpTo, fighterLevel } from '../data/fighter';

export interface ClassFeature {
  level: number;
  name: string;
  summary: string;
}

export interface StartingKit {
  id: string;
  name: string;
  description: string;
  items: ItemStack[];
  equipped: { mainHand?: string; offHand?: string; ranged?: string; armor?: string };
  /** Weapon kinds (base item ids) the hero knows masteries for (SRD 5.2: three at level 1). */
  masteredKinds: string[];
}

/** Data-driven class. Adding a class means adding an entry to CLASSES. */
export interface ClassDef {
  id: string;
  name: string;
  description: string;
  hitDie: number;
  primaryAbilities: Ability[];
  saves: Ability[];
  skillChoices: { count: number; from: Skill[] };
  recommendedAbilities: AbilityScores;
  /** Coherent starting builds; the first is the default (Quick start) and matches `recommendedAbilities`. */
  presets: BuildPreset[];
  maxLevel: number;
  /** Choices made at level 1, including the kit choice (options mirror `kits`). */
  choices: ChoiceSlot[];
  kits: StartingKit[];
  /** Choices offered when reaching a level (key: new level). */
  levelChoices: Record<number, ChoiceSlot[]>;
  features: ClassFeature[];
  /** Resource pools at a given level. */
  resourcesAt(level: number): Record<string, ResourcePool>;
  /** Resource key -> uses regained on a short rest, for pools that refresh partially. */
  shortRestRecovery: Record<string, number>;
  /** Hidden combat flags at a level (see util.hasFlag). */
  flagsAt(level: number): string[];
  /** Attacks made with one Attack action (Extra Attack). */
  attacksAt?(level: number): number;
  /** Weapon kinds whose mastery property can be used at a level. */
  weaponMasteriesAt?(level: number): number;
}

const FIGHTING_STYLES: ChoiceOption[] = [
  { id: 'defense', name: 'Defense', description: '+1 AC while wearing armor.' },
  { id: 'archery', name: 'Archery', description: '+2 to attack rolls with ranged weapons.' },
  {
    id: 'greatWeaponFighting',
    name: 'Great Weapon Fighting',
    description: 'Treat a 1 or 2 on a damage die as a 3 when wielding a melee weapon with two hands.',
  },
  {
    id: 'twoWeaponFighting',
    name: 'Two-Weapon Fighting',
    description: 'When you make the extra Light-weapon attack with your off hand, you add your ability modifier to its damage.',
  },
];

const ABILITY_NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const ABILITY_ORDER: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Every Ability Score Improvement option: +2 to one score or +1 to two (ids "str+2" and "str+1,dex+1"). */
export function asiOptions(): ChoiceOption[] {
  const out: ChoiceOption[] = ABILITY_ORDER.map((a) => ({ id: `${a}+2`, name: `+2 ${ABILITY_NAMES[a]}`, description: `Raise ${ABILITY_NAMES[a]} by 2 (maximum 20).` }));
  for (let i = 0; i < ABILITY_ORDER.length; i++) {
    for (let j = i + 1; j < ABILITY_ORDER.length; j++) {
      const a = ABILITY_ORDER[i] as Ability;
      const b = ABILITY_ORDER[j] as Ability;
      out.push({ id: `${a}+1,${b}+1`, name: `+1 ${ABILITY_NAMES[a]}, +1 ${ABILITY_NAMES[b]}`, description: `Raise ${ABILITY_NAMES[a]} and ${ABILITY_NAMES[b]} by 1 each (maximum 20).` });
    }
  }
  return out;
}

export const ASI_LEVELS: readonly number[] = FIGHTER_LEVELS.filter((r) => r.abilityScoreImprovement).map((r) => r.level);
export const asiKey = (level: number): string => `asi${level}`;
export const MASTERY_LEVELS: readonly number[] = FIGHTER_LEVELS.filter((r, i, a) => r.level > 1 && r.weaponMasteries > (a[i - 1]?.weaponMasteries ?? 0)).map((r) => r.level);
export const masteryKey = (level: number): string => `mastery${level}`;

/** Static slots per level: the ASI, the second fighting style (7) and the Epic Boon (19). Mastery slots are dynamic (character.ts). */
function fighterLevelChoices(): Record<number, ChoiceSlot[]> {
  const out: Record<number, ChoiceSlot[]> = {};
  for (const level of ASI_LEVELS) out[level] = [{ key: asiKey(level), name: 'Ability Score Improvement', options: asiOptions() }];
  out[7] = [
    {
      key: 'fightingStyle2',
      name: 'Additional Fighting Style',
      group: 'fightingStyle',
      options: FIGHTING_STYLES.map((o) => ({ ...o })),
    },
  ];
  out[19] = [
    {
      key: 'epicBoon',
      name: 'Epic Boon',
      options: [
        {
          id: 'combatProwess',
          name: 'Boon of Combat Prowess',
          description: 'Peerless Aim: once per turn, when you miss with an attack roll, you hit instead. Also +1 to your best of Strength or Dexterity (maximum 30).',
        },
        {
          id: 'improvement',
          name: 'Ability Score Improvement',
          description: 'The SRD allows another feat instead: raise your best of Strength or Dexterity by 2 (maximum 20).',
        },
      ],
    },
  ];
  return out;
}

/** Summaries where this game differs from the SRD wording in src/data/fighter.ts (automation, missing rules). */
const SUMMARY_OVERRIDES: Record<string, string> = {
  'Ability Score Improvement': 'Raise one ability score by 2 or two scores by 1 (maximum 20). Other feats are not offered in this game.',
  'Weapon Mastery': 'You know the masteries of three weapon kinds at level 1 (more at 4, 10 and 16): Slow, Vex, Sap, Topple, Push, Graze, Nick and Cleave are all implemented.',
  Indomitable:
    'When you fail a saving throw you can reroll it with a bonus equal to your fighter level. HOUSE RULE: used automatically on a failed save against an effect that would take your turn away or deal heavy damage. Uses return on a long rest.',
  'Tactical Master': 'Your mastered weapons can use Push, Sap or Slow in place of their own property. Chosen automatically: a Graze weapon uses Sap instead.',
  'Champion: Remarkable Athlete': 'You have advantage on initiative rolls, and after a critical hit you can move half your speed without provoking attacks.',
  'Champion: Heroic Warrior': 'In combat, you gain Heroic Inspiration at the start of any turn you begin without it.',
  'Champion: Survivor': 'At the start of each of your turns you regain 5 + your Constitution modifier hit points while bloodied and still standing (death saves are replaced by Last Stand).',
  'Epic Boon': 'You gain Boon of Combat Prowess (or an Ability Score Improvement instead).',
};

/** Features by level straight from the data table, minus Tactical Mind (it needs ability checks, which this game does not have). */
function fighterFeatures(): ClassFeature[] {
  const out: ClassFeature[] = [];
  for (const row of FIGHTER_LEVELS) {
    for (const f of row.features) {
      if (f.name === 'Tactical Mind') continue;
      out.push({ level: row.level, name: f.name, summary: SUMMARY_OVERRIDES[f.name] ?? f.summary });
    }
  }
  return out;
}

/** General hero rule shown with every class. */
export const LAST_STAND_SUMMARY = 'Last Stand (house rule): once per floor, damage that would drop you to 0 HP leaves you at 1 HP instead. It does not return on a short rest.';

const SECOND_WIND = 'secondWind';
const ACTION_SURGE = 'actionSurge';
const INDOMITABLE = 'indomitable';

const KITS: StartingKit[] = [
  {
    id: 'a',
    name: 'Sword and Shield',
    description: 'Chain mail, longsword, shield and 4 javelins.',
    items: [
      { itemId: 'chain_mail', quantity: 1 },
      { itemId: 'longsword', quantity: 1 },
      { itemId: 'shield', quantity: 1 },
      { itemId: 'javelin', quantity: 4 },
    ],
    equipped: { armor: 'chain_mail', mainHand: 'longsword', offHand: 'shield' },
    masteredKinds: ['longsword', 'javelin', 'shortsword'],
  },
  {
    id: 'b',
    name: 'Greatsword',
    description: 'Chain mail, greatsword and 4 javelins.',
    items: [
      { itemId: 'chain_mail', quantity: 1 },
      { itemId: 'greatsword', quantity: 1 },
      { itemId: 'javelin', quantity: 4 },
    ],
    equipped: { armor: 'chain_mail', mainHand: 'greatsword' },
    masteredKinds: ['greatsword', 'javelin', 'longsword'],
  },
  {
    id: 'c',
    name: 'Archer',
    description: 'Scale mail, a longbow, and a shortsword and scimitar to fight with when enemies close in.',
    items: [
      { itemId: 'scale_mail', quantity: 1 },
      { itemId: 'longbow', quantity: 1 },
      { itemId: 'shortsword', quantity: 1 },
      { itemId: 'scimitar', quantity: 1 },
    ],
    equipped: { armor: 'scale_mail', mainHand: 'shortsword', offHand: 'scimitar', ranged: 'longbow' },
    masteredKinds: ['longbow', 'shortsword', 'scimitar'],
  },
];

export const FIGHTER: ClassDef = {
  id: 'fighter',
  name: 'Fighter',
  description: 'A master of weapons and armor, tough enough to stand alone in the dark.',
  hitDie: 10,
  primaryAbilities: ['str', 'dex'],
  saves: ['str', 'con'],
  skillChoices: {
    count: 2,
    from: ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'persuasion', 'perception', 'survival'],
  },
  recommendedAbilities: { str: 15, con: 14, dex: 13, cha: 12, wis: 10, int: 8 },
  presets: [
    {
      id: 'defender',
      name: 'Defender',
      description: 'Sword and shield in chain mail: the sturdiest start, with javelins for the approach.',
      abilities: { str: 15, con: 14, dex: 13, cha: 12, wis: 10, int: 8 },
      choices: { fightingStyle: 'defense', startingKit: 'a' },
      abilityPriority: ['str', 'con', 'dex'],
    },
    {
      id: 'great_weapon',
      name: 'Great Weapon',
      description: 'A greatsword in chain mail: hit hard, with Great Weapon Fighting smoothing the dice.',
      abilities: { str: 15, con: 14, dex: 13, cha: 12, wis: 10, int: 8 },
      choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'b' },
      abilityPriority: ['str', 'con', 'dex'],
    },
    {
      id: 'archer',
      name: 'Archer',
      description: 'Dexterity first: shoot with a longbow while foes approach, then fight with a shortsword and scimitar.',
      abilities: { dex: 15, con: 14, str: 13, cha: 12, wis: 10, int: 8 },
      choices: { fightingStyle: 'archery', startingKit: 'c' },
      abilityPriority: ['dex', 'con', 'str'],
    },
  ],
  maxLevel: FIGHTER_MAX_LEVEL,
  choices: [
    {
      key: 'fightingStyle',
      name: 'Fighting Style',
      group: 'fightingStyle',
      options: FIGHTING_STYLES,
    },
    {
      key: 'startingKit',
      name: 'Starting Kit',
      options: KITS.map((k) => ({ id: k.id, name: k.name, description: k.description })),
    },
  ],
  kits: KITS,
  levelChoices: fighterLevelChoices(),
  features: fighterFeatures(),
  resourcesAt(level) {
    const row = fighterLevel(level);
    const out: Record<string, ResourcePool> = {
      [SECOND_WIND]: { name: 'Second Wind', current: row.secondWindUses, max: row.secondWindUses, refresh: 'longRest' },
    };
    if (row.actionSurgeUses > 0) out[ACTION_SURGE] = { name: 'Action Surge', current: row.actionSurgeUses, max: row.actionSurgeUses, refresh: 'shortRest' };
    if (row.indomitableUses > 0) out[INDOMITABLE] = { name: 'Indomitable', current: row.indomitableUses, max: row.indomitableUses, refresh: 'longRest' };
    return out;
  },
  shortRestRecovery: { [SECOND_WIND]: 1 },
  flagsAt(level) {
    // Remarkable Athlete (3) also lets a critical hit start a free half-speed move (the data lists only its initiative half).
    return [...fighterFlagsUpTo(level), ...(level >= 3 ? ['remarkableAthlete'] : [])];
  },
  attacksAt: (level) => fighterLevel(level).attacks,
  weaponMasteriesAt: (level) => fighterLevel(level).weaponMasteries,
};

export const CLASSES: ClassDef[] = [FIGHTER];

export function getClass(id: string): ClassDef | undefined {
  return CLASSES.find((c) => c.id === id);
}

export function classInfo(def: ClassDef): ClassInfo {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    hitDie: def.hitDie,
    primaryAbilities: def.primaryAbilities,
    featureSummaries: [...def.features.filter((f) => f.level === 1).map((f) => `${f.name}: ${f.summary}`), LAST_STAND_SUMMARY],
    skillChoices: def.skillChoices,
    choices: def.choices,
    recommendedAbilities: def.recommendedAbilities,
    presets: def.presets.map((p) => ({ ...p, abilities: { ...p.abilities }, choices: { ...p.choices }, abilityPriority: [...p.abilityPriority] })),
  };
}

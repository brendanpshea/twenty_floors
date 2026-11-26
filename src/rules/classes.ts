import type { Ability, AbilityScores, BuildPreset, ChoiceSlot, ClassInfo, ItemStack, ResourcePool, Skill } from '../core/types';

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
}

/** General hero rule shown with every class. */
export const LAST_STAND_SUMMARY = 'Last Stand (house rule): once per floor, damage that would drop you to 0 HP leaves you at 1 HP instead. It does not return on a short rest.';

const SECOND_WIND = 'secondWind';
const ACTION_SURGE = 'actionSurge';

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
  maxLevel: 3,
  choices: [
    {
      key: 'fightingStyle',
      name: 'Fighting Style',
      options: [
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
      ],
    },
    {
      key: 'startingKit',
      name: 'Starting Kit',
      options: KITS.map((k) => ({ id: k.id, name: k.name, description: k.description })),
    },
  ],
  kits: KITS,
  levelChoices: {},
  features: [
    { level: 1, name: 'Fighting Style', summary: 'You chose a fighting style that sharpens your combat.' },
    {
      level: 1,
      name: 'Second Wind',
      summary: 'Bonus action: regain 1d10 + your fighter level hit points. Two uses; a short rest restores one, a long rest all.',
    },
    {
      level: 1,
      name: 'Weapon Mastery',
      summary: 'You know the masteries of three weapon kinds (your starting kit, plus a fill): Slow, Vex, Sap, Topple, Push and Graze are implemented; Cleave and Nick are not.',
    },
    { level: 2, name: 'Action Surge', summary: 'Once per rest, take one additional action on your turn.' },
    { level: 3, name: 'Champion: Improved Critical', summary: 'Your attacks score a critical hit on a roll of 19 or 20.' },
    { level: 3, name: 'Champion: Remarkable Athlete', summary: 'You have advantage on initiative rolls.' },
  ],
  resourcesAt(level) {
    const out: Record<string, ResourcePool> = {
      [SECOND_WIND]: { name: 'Second Wind', current: 2, max: 2, refresh: 'longRest' },
    };
    if (level >= 2) out[ACTION_SURGE] = { name: 'Action Surge', current: 1, max: 1, refresh: 'shortRest' };
    return out;
  },
  shortRestRecovery: { [SECOND_WIND]: 1 },
  flagsAt(level) {
    return level >= 3 ? ['crit19', 'initAdv'] : [];
  },
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

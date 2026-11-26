import type { Ability, BackgroundInfo, ChoiceSlot, FeatInfo, SpellDef } from '../core/types';
import { MI_ABILITIES, MI_KEYS, offeredSpells } from './spells';

const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

const spellOptions = (spells: SpellDef[]): ChoiceSlot['options'] =>
  spells.map((s) => ({ id: s.id, name: s.name, description: s.description }));

function magicInitiate(list: 'cleric' | 'wizard'): FeatInfo {
  const listName = list === 'cleric' ? 'Cleric' : 'Wizard';
  const cantrips = spellOptions(offeredSpells(list, 0));
  return {
    id: `magic_initiate_${list}`,
    name: `Magic Initiate (${listName})`,
    description: `You learned a little ${listName.toLowerCase()} magic: two cantrips and one level 1 spell from the ${listName} list.`,
    summaries: [
      'Two cantrips you can cast at will, and one level 1 spell you can cast once per long rest (a long rest happens only at rest sites and in the hub).',
      'Spell attack bonus = proficiency + your spellcasting ability modifier; spell save DC = 8 + proficiency + that modifier.',
      'Cantrip damage grows at character levels 5, 11 and 17.',
      'You choose Intelligence, Wisdom or Charisma as your spellcasting ability.',
    ],
    choices: [
      { key: MI_KEYS.cantrip1, name: 'Cantrip 1', options: cantrips, group: 'mi_cantrip' },
      { key: MI_KEYS.cantrip2, name: 'Cantrip 2', options: cantrips, group: 'mi_cantrip' },
      { key: MI_KEYS.spell, name: 'Level 1 spell', options: spellOptions(offeredSpells(list, 1)) },
      {
        key: MI_KEYS.ability,
        name: 'Spellcasting ability',
        options: MI_ABILITIES.map((a) => ({ id: a, name: ABILITY_NAMES[a], description: `Your spell attacks and save DCs use ${ABILITY_NAMES[a]}.` })),
      },
    ],
  };
}

/** SRD 5.2 backgrounds, each with its origin feat. */
export const BACKGROUNDS: BackgroundInfo[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    description: 'You trained as a fighter in a war band or militia.',
    abilityOptions: ['str', 'dex', 'con'],
    skills: ['athletics', 'intimidation'],
    feat: {
      id: 'savage_attacker',
      name: 'Savage Attacker',
      description: 'You have trained to deal particularly damaging strikes.',
      summaries: ["Once per turn, when you hit with a weapon attack, roll the weapon's damage dice twice and use the higher roll."],
      choices: [],
    },
  },
  {
    id: 'criminal',
    name: 'Criminal',
    description: 'You earned a living in the shadows, by theft or worse.',
    abilityOptions: ['dex', 'con', 'int'],
    skills: ['sleightOfHand', 'stealth'],
    feat: {
      id: 'alert',
      name: 'Alert',
      description: 'You are always on the lookout for danger.',
      summaries: ['You add your proficiency bonus to your initiative rolls.'],
      choices: [],
    },
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'You spent years studying lore in libraries and cloisters.',
    abilityOptions: ['con', 'int', 'wis'],
    skills: ['arcana', 'history'],
    feat: magicInitiate('wizard'),
  },
  {
    id: 'acolyte',
    name: 'Acolyte',
    description: 'You served in a temple, tending rites and the faithful.',
    abilityOptions: ['int', 'wis', 'cha'],
    skills: ['insight', 'religion'],
    feat: magicInitiate('cleric'),
  },
];

export function getBackground(id: string): BackgroundInfo | undefined {
  return BACKGROUNDS.find((b) => b.id === id);
}

/** Hidden combat flags granted by a background's origin feat. */
export function featFlags(backgroundId: string): string[] {
  if (backgroundId === 'soldier') return ['savageAttacker'];
  if (backgroundId === 'criminal') return ['alert'];
  return [];
}

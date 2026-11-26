import type { BackgroundInfo } from '../core/types';

/** SRD 5.2 backgrounds. Origin feats are not implemented in this milestone. */
export const BACKGROUNDS: BackgroundInfo[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    description: 'You trained as a fighter in a war band or militia.',
    abilityOptions: ['str', 'dex', 'con'],
    skills: ['athletics', 'intimidation'],
  },
  {
    id: 'criminal',
    name: 'Criminal',
    description: 'You earned a living in the shadows, by theft or worse.',
    abilityOptions: ['dex', 'con', 'int'],
    skills: ['sleightOfHand', 'stealth'],
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'You spent years studying lore in libraries and cloisters.',
    abilityOptions: ['con', 'int', 'wis'],
    skills: ['arcana', 'history'],
  },
  {
    id: 'acolyte',
    name: 'Acolyte',
    description: 'You served in a temple, tending rites and the faithful.',
    abilityOptions: ['int', 'wis', 'cha'],
    skills: ['insight', 'religion'],
  },
];

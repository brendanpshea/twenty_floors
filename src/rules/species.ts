import type { DamageType, ResourcePool, SpeciesInfo } from '../core/types';
import { flagPool } from './util';

/** Data-driven species. Only traits that have an effect in this game are listed. */
export interface SpeciesDef {
  info: SpeciesInfo;
  /** Walking speed in cells. */
  speed: number;
  resistances: DamageType[];
  hpPerLevel: number;
  /** Hidden flags set on the combat creature (see util.hasFlag). */
  flags: string[];
  /** Resource pools granted to the character. */
  resources: Record<string, ResourcePool>;
}

const HERO_VISUAL = { model: 'hero_knight' };

export const SPECIES: SpeciesDef[] = [
  {
    info: {
      id: 'human',
      name: 'Human',
      description: 'Versatile and driven, humans make their mark wherever they go.',
      traitSummaries: ['Resourceful: once per floor, your first missed attack roll is automatically rerolled (Heroic Inspiration).'],
      visual: HERO_VISUAL,
    },
    speed: 6,
    resistances: [],
    hpPerLevel: 0,
    flags: [],
    resources: { inspiration: { name: 'Heroic Inspiration', current: 1, max: 1, refresh: 'floor' } },
  },
  {
    info: {
      id: 'dwarf',
      name: 'Dwarf',
      description: 'Stout folk of stone and forge, hard to kill and harder to poison.',
      traitSummaries: [
        'Dwarven Resilience: resistance to poison damage and advantage on saves against being poisoned.',
        'Dwarven Toughness: +1 hit point per level.',
      ],
      visual: HERO_VISUAL,
    },
    speed: 6,
    resistances: ['poison'],
    hpPerLevel: 1,
    flags: ['saveAdv_poisoned'],
    resources: {},
  },
  {
    info: {
      id: 'elf',
      name: 'Elf',
      description: 'Graceful and long-lived, with a bloodline that wards the mind.',
      traitSummaries: ['Fey Ancestry: advantage on saving throws to avoid or end the charmed condition.'],
      visual: HERO_VISUAL,
    },
    speed: 6,
    resistances: [],
    hpPerLevel: 0,
    flags: ['saveAdv_charmed'],
    resources: {},
  },
];

export function getSpecies(id: string): SpeciesDef | undefined {
  return SPECIES.find((s) => s.info.id === id);
}

export function speciesFlagPools(def: SpeciesDef): Record<string, ResourcePool> {
  const out: Record<string, ResourcePool> = {};
  for (const f of def.flags) out['_' + f] = flagPool(f);
  return out;
}

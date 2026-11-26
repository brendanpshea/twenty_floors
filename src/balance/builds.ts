import type { CharacterBuild } from '../core/types';

/**
 * The standard scripted heroes used for balance work. All take the Defense style (measured best for every kit; Archery and Great Weapon Fighting are available through the `style` argument). Kit a/b are STR-first
 * (standard array 15/14/13... via the recommended spread); kit c is DEX-first.
 */
export function heroBuild(kit: 'a' | 'b' | 'c' | string, species = 'human', style?: string): CharacterBuild {
  const archer = kit === 'c';
  return {
    name: 'Sim',
    speciesId: species,
    classId: 'fighter',
    backgroundId: 'soldier',
    baseAbilities: archer
      ? { str: 10, dex: 15, con: 14, int: 8, wis: 12, cha: 13 }
      : { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 13 },
    abilityIncreases: archer ? { dex: 2, con: 1 } : { str: 2, con: 1 },
    skills: ['perception', 'survival'],
    choices: { fightingStyle: style ?? 'defense', startingKit: kit },
  };
}

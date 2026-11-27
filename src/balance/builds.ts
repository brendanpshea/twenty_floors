import type { Ability, CharacterBuild } from '../core/types';
import { buildFromPreset } from '../rules';
import { FIGHTER } from '../rules/classes';

const PRESET_BY_KIT: Record<string, string> = { a: 'defender', b: 'great_weapon', c: 'archer' };

/**
 * The standard scripted heroes used for balance work: the same presets the creation screen offers
 * (kit a Defender, kit b Great Weapon, kit c Archer), with the preset's fighting style unless `style`
 * overrides it. `background` picks the origin feat (soldier: Savage Attacker, criminal: Alert, sage and
 * acolyte: Magic Initiate with the default picks of `buildFromPreset`; see `casterBuild` for tuned picks).
 */
export function heroBuild(kit: 'a' | 'b' | 'c' | string, species = 'human', style?: string, background = 'soldier'): CharacterBuild {
  const preset = FIGHTER.presets.find((p) => p.id === (PRESET_BY_KIT[kit] ?? 'defender')) ?? (FIGHTER.presets[0] as (typeof FIGHTER.presets)[number]);
  const build = buildFromPreset(preset, background, { name: 'Sim', speciesId: species });
  build.choices['startingKit'] = kit;
  if (style) build.choices['fightingStyle'] = style;
  return build;
}

export interface CasterPicks {
  cantrip1?: string;
  cantrip2?: string;
  spell?: string;
}

/**
 * A Magic Initiate hero with the ability scores arranged for the casting stat: Sage raises Intelligence
 * (+2) and Constitution (+1), Acolyte raises Charisma (+2) and Wisdom (+1). The rest of the standard array
 * keeps Strength 15 and Constitution 14 with the kit-a Defender style.
 */
export function casterBuild(background: 'sage' | 'acolyte', kit: string = 'a', picks: CasterPicks = {}, style?: string): CharacterBuild {
  const sage = background === 'sage';
  const base = sage
    ? { str: 15, con: 14, int: 13, dex: 12, wis: 10, cha: 8 }
    : { str: 15, con: 14, cha: 13, dex: 12, wis: 10, int: 8 };
  const ability: Ability = sage ? 'int' : 'cha';
  const build = heroBuild(kit, 'human', style, background);
  build.baseAbilities = base;
  build.abilityIncreases = sage ? { int: 2, con: 1 } : { cha: 2, wis: 1 };
  build.choices['mi_ability'] = ability;
  const defaults = sage
    ? { cantrip1: 'fire_bolt', cantrip2: 'ray_of_frost', spell: 'magic_missile' }
    : { cantrip1: 'sacred_flame', cantrip2: 'resistance', spell: 'guiding_bolt' };
  build.choices['mi_cantrip1'] = picks.cantrip1 ?? defaults.cantrip1;
  build.choices['mi_cantrip2'] = picks.cantrip2 ?? defaults.cantrip2;
  build.choices['mi_spell'] = picks.spell ?? defaults.spell;
  return build;
}

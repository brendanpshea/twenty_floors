import type { CharacterBuild, PlayerCharacter } from '../core/types';
import {
  applyLevelUp,
  buildFromPreset,
  createCharacter,
  getCreationOptions,
  migrateEquipment,
  previewLevelUp,
  suggestedLevelChoices,
  validateBuild,
} from '../rules';

/** Dev choices for a quick-built hero (?preset=, ?background=, ?spell=). */
export interface QuickOptions {
  /** A BuildPreset id, or a loose spelling of one ("greatweapon" for "great_weapon"). Default: the first preset. */
  preset?: string;
  /** A background id. Default: the first background. */
  background?: string;
  /** The first-level spell a Magic Initiate background picks. */
  spell?: string;
  name?: string;
}

const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cantrips and the first-level spell a Magic Initiate hero takes when nothing says otherwise. */
const FEAT_DEFAULTS: Record<string, string> = {
  mi_cantrip1: 'fire_bolt',
  mi_cantrip2: 'true_strike',
  mi_spell: 'magic_missile',
};
const ACOLYTE_DEFAULTS: Record<string, string> = {
  mi_cantrip1: 'sacred_flame',
  mi_cantrip2: 'resistance',
  mi_spell: 'cure_wounds',
};

/** A valid ready-made hero (a Fighter), for ?depth=, ?autoplay= and tests. */
export function quickBuild(name = 'Aldric', opts: QuickOptions = {}): CharacterBuild {
  const options = getCreationOptions();
  const cls = options.classes.find((c) => c.id === 'fighter') ?? options.classes[0];
  const bg = options.backgrounds.find((b) => loose(b.id) === loose(opts.background ?? '')) ?? options.backgrounds[0];
  const species = options.species[0];
  if (!cls || !bg || !species) throw new Error('No creation options available');
  const presets = cls.presets ?? [];
  const preset = presets.find((p) => loose(p.id) === loose(opts.preset ?? '') || loose(p.name) === loose(opts.preset ?? '')) ?? presets[0];
  if (!preset) throw new Error(`Class ${cls.id} has no build preset`);
  const defaults = bg.id === 'acolyte' ? ACOLYTE_DEFAULTS : FEAT_DEFAULTS;
  const featChoices: Record<string, string> = {};
  for (const slot of bg.feat?.choices ?? []) {
    const wanted = slot.key === 'mi_spell' && opts.spell ? opts.spell : defaults[slot.key];
    if (wanted && slot.options.some((o) => o.id === wanted)) featChoices[slot.key] = wanted;
  }
  const build = buildFromPreset(preset, bg.id, { name: opts.name ?? name, speciesId: species.id, classId: cls.id, featChoices });
  const errors = validateBuild(build);
  if (errors.length > 0) throw new Error(`quickBuild is invalid: ${errors.join(' ')}`);
  return build;
}

/** The level-up picks a sensible hero takes (every slot filled, including the Ability Score Improvement). */
export function defaultLevelChoices(pc: PlayerCharacter): Record<string, string> {
  return suggestedLevelChoices(pc);
}

/** A quick-built hero levelled up to `level` (as far as the rules allow). */
export function quickCharacter(level = 1, opts: QuickOptions = {}): PlayerCharacter {
  let pc = migrateEquipment(createCharacter(quickBuild(opts.name ?? 'Aldric', opts)));
  while (pc.level < level && previewLevelUp(pc)) pc = applyLevelUp(pc, defaultLevelChoices(pc));
  return pc;
}

import type { Ability, CharacterBuild, PlayerCharacter } from '../core/types';
import { applyLevelUp, createCharacter, getCreationOptions, previewLevelUp, validateBuild } from '../rules';

/** A valid ready-made Fighter, for ?depth=, ?autoplay= and tests. */
export function quickBuild(name = 'Aldric'): CharacterBuild {
  const opts = getCreationOptions();
  const cls = opts.classes.find((c) => c.id === 'fighter') ?? opts.classes[0];
  const bg = opts.backgrounds[0];
  const species = opts.species[0];
  if (!cls || !bg || !species) throw new Error('No creation options available');
  const skills = cls.skillChoices.from.filter((s) => !bg.skills.includes(s)).slice(0, cls.skillChoices.count);
  // The class's first preset gives a coherent hero (abilities, fighting style, kit); without one, the first option of every choice.
  const preset = cls.presets?.[0];
  const choices: Record<string, string> = {};
  for (const slot of cls.choices) {
    const wanted = preset?.choices[slot.key];
    const pick = slot.options.find((o) => o.id === wanted) ?? slot.options[0];
    if (pick) choices[slot.key] = pick.id;
  }
  // Background increases: +2 and +1 to the background's options that the preset favours most.
  const priority: Ability[] = preset?.abilityPriority ?? [];
  const rank = (x: Ability): number => {
    const i = priority.indexOf(x);
    return i < 0 ? priority.length : i;
  };
  const [a, b] = [...bg.abilityOptions].sort((x, y) => rank(x) - rank(y));
  const build: CharacterBuild = {
    name,
    speciesId: species.id,
    classId: cls.id,
    backgroundId: bg.id,
    baseAbilities: { ...(preset?.abilities ?? cls.recommendedAbilities) },
    abilityIncreases: a && b ? { [a]: 2, [b]: 1 } : {},
    skills,
    choices,
  };
  const errors = validateBuild(build);
  if (errors.length > 0) throw new Error(`quickBuild is invalid: ${errors.join(' ')}`);
  return build;
}

/** Take the first option of every choice a level-up asks for. */
export function defaultLevelChoices(pc: PlayerCharacter): Record<string, string> {
  const preview = previewLevelUp(pc);
  const choices: Record<string, string> = {};
  for (const slot of preview?.choices ?? []) {
    const first = slot.options[0];
    if (first) choices[slot.key] = first.id;
  }
  return choices;
}

/** A quick-built hero levelled up to `level`. */
export function quickCharacter(level = 1): PlayerCharacter {
  let pc = createCharacter(quickBuild());
  while (pc.level < level && previewLevelUp(pc)) pc = applyLevelUp(pc, defaultLevelChoices(pc));
  return pc;
}

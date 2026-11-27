import type { PlayerCharacter } from '../../core/types';
import { applyLevelUp, buildFromPreset, createCharacter, migrateEquipment, previewLevelUp, suggestedLevelChoices } from '../character';
import { FIGHTER } from '../classes';

/** A ready-made Fighter from one of the class presets ('defender', 'great_weapon', 'archer'), levelled up with sensible picks. For tests. */
export function presetHero(presetId: 'defender' | 'great_weapon' | 'archer', level = 1): PlayerCharacter {
  const preset = FIGHTER.presets.find((p) => p.id === presetId);
  if (!preset) throw new Error(`No preset ${presetId}`);
  let pc = migrateEquipment(createCharacter(buildFromPreset(preset, 'soldier', { name: 'Tester' })));
  while (pc.level < level && previewLevelUp(pc)) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  return pc;
}

/** The hero with extra items in the pack. */
export function withItems(pc: PlayerCharacter, ...ids: string[]): PlayerCharacter {
  const next = JSON.parse(JSON.stringify(pc)) as PlayerCharacter;
  for (const id of ids) {
    const s = next.inventory.find((x) => x.itemId === id);
    if (s) s.quantity += 1;
    else next.inventory.push({ itemId: id, quantity: 1 });
  }
  return next;
}

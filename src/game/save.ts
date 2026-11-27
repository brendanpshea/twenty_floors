import type { CompanionState, HelpMode, PlayerSkill, PlayerCharacter, QualityLevel, SaveGame } from '../core/types';
import { getCompanion, migrateEquipment } from '../rules';
import { QUALITY_KEY, SAVE_KEY } from './deps';
import type { RunState, StorageLike } from './deps';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validCharacter(c: unknown): c is PlayerCharacter {
  if (!isRecord(c)) return false;
  const b = c['build'];
  if (!isRecord(b) || typeof b['name'] !== 'string' || typeof b['classId'] !== 'string' || typeof b['speciesId'] !== 'string') {
    return false;
  }
  if (!isRecord(b['baseAbilities']) || !isRecord(b['choices'])) return false;
  return (
    finite(c['level']) &&
    finite(c['maxHp']) &&
    finite(c['hp']) &&
    finite(c['gold']) &&
    isRecord(c['resources']) &&
    Array.isArray(c['inventory']) &&
    isRecord(c['equipped'])
  );
}

/** A saved companion, or undefined when it is missing or not one we know (the save is still good without it). */
function validCompanion(c: unknown): CompanionState | undefined {
  if (!isRecord(c) || typeof c['id'] !== 'string' || !getCompanion(c['id'])) return undefined;
  const stance = c['stance'];
  if (!finite(c['hp']) || !isRecord(c['resources'])) return undefined;
  if (stance !== 'close' && stance !== 'back' && stance !== 'focus') return undefined;
  return c as unknown as CompanionState;
}

/** Parse and validate a save. Anything corrupt or from another version counts as no save. */
export function parseSave(raw: string | null): SaveGame | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data['version'] !== 1) return null;
    const depth = data['depth'];
    if (!finite(depth) || !Number.isInteger(depth) || depth < 1 || depth > 20) return null;
    if (!finite(data['runSeed']) || !finite(data['shortRestsLeft'])) return null;
    if (!validCharacter(data['character'])) return null;
    const save = data as unknown as SaveGame;
    if (save.help !== 'guided' && save.help !== 'standard') delete save.help;
    // An old save has no rating: the run starts a new one. A damaged one is dropped, not fatal.
    const rating = (data as { puzzleSkill?: unknown })['puzzleSkill'];
    if (!isRecord(rating) || !finite(rating['overall']) || !isRecord(rating['byKind']) || !isRecord(rating['playedByKind']) || !finite(rating['played'])) delete save.puzzleSkill;
    const companion = validCompanion(data['companion']);
    if (companion) save.companion = companion;
    else delete save.companion;
    return save;
  } catch {
    return null;
  }
}

export function loadSave(storage: StorageLike): SaveGame | null {
  try {
    return parseSave(storage.get(SAVE_KEY));
  } catch {
    return null;
  }
}

export function writeSave(storage: StorageLike, run: RunState): void {
  const save: SaveGame = {
    version: 1,
    runSeed: run.runSeed,
    depth: run.depth,
    character: run.pc,
    shortRestsLeft: run.shortRestsLeft,
  };
  if (run.companion) save.companion = run.companion;
  if (run.help) save.help = run.help;
  if (run.puzzleSkill) save.puzzleSkill = run.puzzleSkill;
  try {
    storage.set(SAVE_KEY, JSON.stringify(save));
  } catch (e) {
    console.warn('Could not write save', e);
  }
}

export function deleteSave(storage: StorageLike): void {
  try {
    storage.remove(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function runFromSave(save: SaveGame): RunState {
  const out: RunState = {
    runSeed: save.runSeed,
    depth: save.depth,
    // Older saves held a bow in the main hand; move it to the ranged slot.
    pc: migrateEquipment(JSON.parse(JSON.stringify(save.character)) as PlayerCharacter),
    shortRestsLeft: save.shortRestsLeft,
  };
  if (save.help) out.help = save.help;
  if (save.puzzleSkill) out.puzzleSkill = JSON.parse(JSON.stringify(save.puzzleSkill)) as PlayerSkill;
  if (save.companion) out.companion = JSON.parse(JSON.stringify(save.companion)) as CompanionState;
  return out;
}

export function loadQuality(storage: StorageLike): QualityLevel | null {
  try {
    const q = storage.get(QUALITY_KEY);
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

export function saveQuality(storage: StorageLike, q: QualityLevel): void {
  try {
    storage.set(QUALITY_KEY, q);
  } catch {
    /* ignore */
  }
}

import type { PlayerCharacter, QualityLevel, SaveGame } from '../core/types';
import { migrateEquipment } from '../rules';
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
    return data as unknown as SaveGame;
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
  return {
    runSeed: save.runSeed,
    depth: save.depth,
    // Older saves held a bow in the main hand; move it to the ranged slot.
    pc: migrateEquipment(JSON.parse(JSON.stringify(save.character)) as PlayerCharacter),
    shortRestsLeft: save.shortRestsLeft,
  };
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

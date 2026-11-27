import { describe, it } from 'vitest';
import { appendRow, measureFloor } from './floorFit.shared';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Shard 3 of the floor fit (opt-in: FIT=1). Floors 3,7,11,15,19; multipliers FIT_MULTS; FIT_RUNS runs each; FIT_POLICY expert|naive. */
describe('floor fit shard 3', () => {
  it.skipIf(!env['FIT'])('REPORT shard 3', () => {
    const floors = (env['FIT_FLOORS'] ?? '3,7,11,15,19').split(',').map(Number).filter((d) => [3,7,11,15,19].includes(d));
    const mults = (env['FIT_MULTS'] ?? '0.3,0.6,1,1.6').split(',').map(Number);
    const runs = Number(env['FIT_RUNS'] ?? 24);
    const seed0 = Number(env['FIT_SEED0'] ?? 30000);
    for (const d of floors) for (const m of mults) appendRow(measureFloor(d, m, runs, seed0, env['FIT_POLICY'] ?? 'expert', env['FIT_KIT'] ?? 'a', env['FIT_COMPANION'] ?? 'blink_dog', env['FIT_THEME'] as never), (env['TEMP'] ?? '.') + '/' + (env['FIT_OUT'] ?? 'fit.jsonl'));
  }, 3_000_000);
});

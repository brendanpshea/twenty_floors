import { describe, it } from 'vitest';
import { runTuneShard } from './roomTune.shared';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Shard 2 of 4 of the fight-based tuner (opt-in: ROOM_TUNE=1). See roomTune.ts. */
describe('room tune shard 2', () => {
  it.skipIf(!env['ROOM_TUNE'])('REPORT shard 2', () => {
    runTuneShard(2, 4, env);
  }, 3_000_000);
});

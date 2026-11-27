import { describe, it } from 'vitest';
import { runTuneShard } from './roomTune.shared';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Shard 3 of 4 of the fight-based tuner (opt-in: ROOM_TUNE=1). See roomTune.ts. */
describe('room tune shard 3', () => {
  it.skipIf(!env['ROOM_TUNE'])('REPORT shard 3', () => {
    runTuneShard(3, 4, env);
  }, 3_000_000);
});

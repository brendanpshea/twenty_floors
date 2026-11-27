import { describe, it } from 'vitest';
import { runShard } from './roomFit.shared';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Shard 2 of 4 of the room-level fit (opt-in: ROOMS=1). See rooms.ts. */
describe('room fit shard 2', () => {
  it.skipIf(!env['ROOMS'])('REPORT shard 2', () => {
    runShard(2, 4, env);
  }, 3_000_000);
});

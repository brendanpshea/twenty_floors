import { describe, it } from 'vitest';
import * as nodeFs from 'node:fs';
import { themeForDepth } from '../core/themes';
import { emptyOpp, instrumentedExpert, runVariantShard } from './terrainExp';
import { measureRooms } from './rooms';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Shard 3 of 4 of the terrain experiment (opt-in: TERRAIN=1 for variants, TERRAIN_OPP=1 for the opportunity count). */
describe('terrain experiment shard 3', () => {
  it.skipIf(!env['TERRAIN'])('REPORT variants shard 3', () => {
    runVariantShard(3, 4, env);
  }, 3_000_000);

  it.skipIf(!env['TERRAIN_OPP'])('REPORT opportunity shard 3', () => {
    for (let depth = 1; depth <= 20; depth++) {
      if (depth % 4 !== 3) continue;
      const stats = emptyOpp();
      measureRooms(themeForDepth(depth), depth, { floors: Number(env['TERRAIN_FLOORS'] ?? 14), seed0: 9000 + depth * 50, policyFn: instrumentedExpert(stats) });
      (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync((env['TEMP'] ?? '.') + '/opp.jsonl', JSON.stringify({ depth, theme: themeForDepth(depth), ...stats }) + '\n');
    }
  }, 3_000_000);
});

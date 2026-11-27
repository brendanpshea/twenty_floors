import * as nodeFs from 'node:fs';
import { allPairings } from './roomFit.shared';
import { ROOM_TUNE, tunePairing } from './roomTune';

/**
 * One shard of the fight-based tuner: tunes its share of the pairings and appends one JSON row per pairing to
 * $TEMP/$ROOM_TUNE_OUT (default roomTune.jsonl). ROOM_TUNE_MIN_DEPTH (default 4: the floors with a companion) and
 * ROOM_TUNE_FLOORS narrow or widen the run. Merge the rows into src/rules/encounterTable.ts (budget, bossScale, modelClear).
 */
export function runTuneShard(shard: number, shards: number, env: Record<string, string | undefined>): void {
  const minDepth = Number(env['ROOM_TUNE_MIN_DEPTH'] ?? 4);
  const mine = allPairings()
    .filter((p) => p.depth >= minDepth)
    .filter((_, i) => i % shards === shard);
  const file = (env['TEMP'] ?? '.') + '/' + (env['ROOM_TUNE_OUT'] ?? 'roomTune.jsonl');
  const floors = Number(env['ROOM_TUNE_FLOORS'] ?? ROOM_TUNE.floors);
  for (const p of mine) {
    const r = tunePairing(p.theme, p.depth, { floors });
    (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync(file, JSON.stringify({ ...r, target: ROOM_TUNE.target(p.depth) }) + '\n');
  }
}

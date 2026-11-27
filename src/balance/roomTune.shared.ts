import * as nodeFs from 'node:fs';
import { allPairings } from './roomFit.shared';
import { ROOM_TUNE, polishPairing, tunePairing } from './roomTune';

/**
 * One shard of the fight-based tuner: tunes its share of the pairings and appends one JSON row per pairing to
 * $TEMP/$ROOM_TUNE_OUT (default roomTune.jsonl). ROOM_TUNE_MIN_DEPTH (default 4: the floors with a companion) narrows or widens
 * the run and ROOM_TUNE_SEED0 picks other floors: tuning twice on different floors and averaging the two budgets
 * steadies the result. Merge the rows into src/rules/encounterTable.ts (budget, bossScale, modelClear).
 */
export function runTuneShard(shard: number, shards: number, env: Record<string, string | undefined>): void {
  const minDepth = Number(env['ROOM_TUNE_MIN_DEPTH'] ?? 4);
  const mine = allPairings()
    .filter((p) => p.depth >= minDepth)
    .filter((_, i) => i % shards === shard);
  const file = (env['TEMP'] ?? '.') + '/' + (env['ROOM_TUNE_OUT'] ?? 'roomTune.jsonl');
  for (const p of mine) {
    const r = tunePairing(p.theme, p.depth, env['ROOM_TUNE_SEED0'] ? { seed0: Number(env['ROOM_TUNE_SEED0']) } : {});
    // Then the budget once more, against the clear rate of a large pooled sample (slow, so only with ROOM_TUNE_POLISH=1).
    const polished = env['ROOM_TUNE_POLISH'] !== '1' ? undefined : polishPairing(p.theme, p.depth);
    if (polished) {
      r.entry.budget = polished.budget;
      r.entry.modelClear = Math.round(polished.predicted * 100) / 100;
      r.predicted = polished.predicted;
      r.measurements += polished.measurements;
    }
    (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync(file, JSON.stringify({ ...r, target: ROOM_TUNE.target(p.depth), combatTarget: ROOM_TUNE.combatLoss(p.depth), bossTarget: ROOM_TUNE.bossLoss(p.depth) }) + '\n');
  }
}

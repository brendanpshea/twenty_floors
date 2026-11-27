import { describe, expect, it } from 'vitest';
import { fixedPairings } from './roomFit.shared';
import { ATTRITION, measureRooms, predictClear } from './rooms';

/**
 * Calibration of the attrition model (opt-in: ROOMS_CAL=1): fits `lossScale` (and a rest allowance) so the predicted first-attempt
 * floor clear rates match the real-engine expert measurements of the 20 fixed-run floors (40 runs each, fresh seeds, after the
 * re-tune). Prints the grid, the best fit and the RMSE.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// Real-engine expert first-attempt clears, floors 1..20 (src/balance/floorFit, seeds 130000+, 40 runs; floor 13 re-measured).
export const REAL_EXPERT = [0.88, 0.8, 0.85, 0.7, 0.68, 0.8, 0.8, 0.65, 0.78, 0.88, 0.78, 0.78, 0.62, 0.75, 0.73, 0.7, 0.73, 0.83, 0.75, 0.57];

describe('attrition model calibration', () => {
  it('has the fixed-run targets', () => expect(REAL_EXPERT).toHaveLength(20));
  it.skipIf(!env['ROOMS_CAL'])('REPORT fit lossScale', () => {
    const reports = fixedPairings().map((p) => measureRooms(p.theme, p.depth, { floors: Number(env['ROOMS_FLOORS'] ?? 20), seed0: 800 }));
    let best = { scale: 1, rest: 0.35, pots: 3, lr: 0.75, rmse: 9 };
    for (const scale of [1, 1.3, 1.6, 2, 2.5, 3, 4]) {
      for (const rest of [0.2, 0.35]) {
        for (const pots of [0, 1, 3]) {
          for (const lr of [0.5, 0.75, 0.9]) {
            const prm = { ...ATTRITION, lossScale: scale, shortRestHeal: rest, potions: pots, longRestBelow: lr };
            const pred = reports.map((r) => predictClear(r, 800, prm));
            const rmse = Math.sqrt(pred.reduce((s, p, i) => s + (p - (REAL_EXPERT[i] as number)) ** 2, 0) / pred.length);
            if (rmse < best.rmse) best = { scale, rest, pots, lr, rmse };
          }
        }
      }
    }
    const pred = reports.map((r) => predictClear(r, 3000, { ...ATTRITION, lossScale: best.scale, shortRestHeal: best.rest, potions: best.pots, longRestBelow: best.lr }));
    console.log(`BEST ${JSON.stringify(best)}`);
    console.log('PRED vs REAL: ' + pred.map((p, i) => `${i + 1}:${Math.round(p * 100)}/${Math.round((REAL_EXPERT[i] as number) * 100)}`).join(' '));
    const mean = (REAL_EXPERT as number[]).reduce((a, b) => a + b, 0) / 20;
    const sst = (REAL_EXPERT as number[]).reduce((a, b) => a + (b - mean) ** 2, 0);
    const sse = pred.reduce((s, p, i) => s + (p - (REAL_EXPERT[i] as number)) ** 2, 0);
    console.log(`R2 ${(1 - sse / sst).toFixed(2)}`);
    expect(best.rmse).toBeLessThan(1);
  }, 600_000);
});

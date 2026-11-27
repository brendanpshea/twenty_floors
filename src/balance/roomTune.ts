import type { ThemeId } from '../core/types';
import { ENCOUNTER_TUNING } from '../rules';
import type { ThemeDepthTuning } from '../rules/encounterTable';
import { measureRooms, predictClear, type PairingReport } from './rooms';

/**
 * The fight-based tuner. For one theme on one floor it searches the room budget (and, where the boss room is not the
 * hardest fight, the boss-room scale) with the room harness of rooms.ts: every combat room and boss room of a few
 * generated floors is fought once from a rested party, and `predictClear` turns those fights into a first-attempt clear
 * rate. The same seeds are fought at every budget tried, so the search compares like with like and needs few fights:
 * about six measurements of a dozen floors per pairing, a few seconds each.
 *
 * Run it for every pairing (four shards, a few minutes in all) and paste the table it prints:
 *   ROOM_TUNE=1 npx vitest run src/balance/roomTune --disableConsoleIntercept
 */
export const ROOM_TUNE = {
  /** First-attempt clear rate aimed at, by floor (the expert scripted hero with a Blink Dog from floor 4). */
  target: (depth: number): number => (depth <= 3 ? 0.85 : depth <= 10 ? 0.75 : depth <= 19 ? 0.67 : 0.58),
  /** Close enough: stop searching within this of the target. */
  tolerance: 0.04,
  floors: 12,
  seed0: 500,
  /** Budget multipliers the search may reach, relative to the entry it starts from. */
  minFactor: 0.2,
  maxFactor: 6,
  maxSteps: 7,
  /** The boss room should cost the hero at least this multiple of an ordinary room's mean loss, and not more than the upper one. */
  bossPeak: [1.25, 2.6] as [number, number],
  bossScaleRange: [0.5, 4] as [number, number],
  bossScaleStep: 1.5,
  outerPasses: 3,
};

export interface TuneResult {
  theme: ThemeId;
  depth: number;
  entry: ThemeDepthTuning;
  /** Predicted clear rate with the chosen entry, and what the entry it started from gave. */
  predicted: number;
  before: number;
  combatLoss: number;
  bossLoss: number;
  companionDowns: number;
  measurements: number;
}

function entryFor(theme: ThemeId, depth: number): ThemeDepthTuning {
  const table = (ENCOUNTER_TUNING.themeTuning[theme] ??= {});
  const table2 = table as Record<number, ThemeDepthTuning>;
  return (table2[depth] ??= { budget: ENCOUNTER_TUNING.budgetByLevel[depth - 1] as number });
}

/** Tune one pairing in place (ENCOUNTER_TUNING.themeTuning holds the result) and report it. */
export function tunePairing(theme: ThemeId, depth: number, opts: { floors?: number; seed0?: number } = {}): TuneResult {
  const t = ROOM_TUNE;
  const entry = entryFor(theme, depth);
  const target = t.target(depth);
  let count = 0;
  const measure = (): { clear: number; report: PairingReport } => {
    count++;
    const report = measureRooms(theme, depth, { floors: opts.floors ?? t.floors, seed0: opts.seed0 ?? t.seed0 });
    return { clear: predictClear(report), report };
  };
  const start = entry.budget;
  let best = measure();
  const before = best.clear;

  /** Search the budget for the target clear rate, by bracketing and then halving the gap on a log scale. */
  const fitBudget = (): void => {
    let bestBudget = entry.budget;
    let lo: number | undefined; // a budget that is too easy (clear above target)
    let hi: number | undefined; // a budget that is too hard
    let cur = { budget: entry.budget, ...best };
    for (let step = 0; step < t.maxSteps; step++) {
      if (Math.abs(cur.clear - target) <= t.tolerance) break;
      if (cur.clear > target) lo = cur.budget;
      else hi = cur.budget;
      let next: number;
      if (lo !== undefined && hi !== undefined) next = Math.sqrt(lo * hi);
      else if (lo !== undefined) next = lo * 1.6;
      else next = (hi as number) / 1.6;
      next = Math.round(Math.min(start * t.maxFactor, Math.max(start * t.minFactor, next)));
      if (next === cur.budget || (lo !== undefined && hi !== undefined && Math.abs(hi - lo) / lo < 0.04)) break;
      entry.budget = next;
      cur = { budget: next, ...measure() };
      if (Math.abs(cur.clear - target) < Math.abs(best.clear - target)) {
        best = cur;
        bestBudget = next;
      }
    }
    if (entry.budget !== bestBudget) {
      entry.budget = bestBudget;
    }
  };

  for (let pass = 0; pass < t.outerPasses; pass++) {
    fitBudget();
    // The boss room should be the floor's peak. If it is not (or towers over everything), move its scale and fit again.
    const c = best.report.combat.meanLoss;
    const b = best.report.boss.meanLoss;
    const scale = entry.bossScale ?? 1;
    let wanted = scale;
    if (best.report.boss.n > 0 && c > 0.02) {
      if (b < c * t.bossPeak[0]) wanted = Math.min(t.bossScaleRange[1], scale * t.bossScaleStep);
      else if (b > c * t.bossPeak[1]) wanted = Math.max(t.bossScaleRange[0], scale / t.bossScaleStep);
    }
    if (wanted === scale || pass === t.outerPasses - 1) break;
    entry.bossScale = Math.round(wanted * 100) / 100;
    const tried = measure();
    const peakBefore = Math.abs(Math.log((b + 0.01) / (c * 1.8 + 0.01)));
    const peakAfter = Math.abs(Math.log((tried.report.boss.meanLoss + 0.01) / (tried.report.combat.meanLoss * 1.8 + 0.01)));
    if (peakAfter >= peakBefore) {
      // The scale did not help (an escort the cast cannot fill, or a boss that is the danger by itself): put it back.
      if (scale === 1) delete entry.bossScale;
      else entry.bossScale = scale;
      break;
    }
    best = tried;
  }
  // Leave the table holding exactly what `best` measured.
  const final = measure();
  entry.modelClear = Math.round(final.clear * 100) / 100;
  return {
    theme,
    depth,
    entry: { ...entry },
    predicted: final.clear,
    before,
    combatLoss: final.report.combat.meanLoss,
    bossLoss: final.report.boss.meanLoss,
    companionDowns: final.report.outcomes.filter((o) => o.companionDowned).length / Math.max(1, final.report.outcomes.length),
    measurements: count,
  };
}

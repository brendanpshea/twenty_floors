import type { MonsterDef, ThemeId } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { ENCOUNTER_TUNING } from '../rules';
import type { ThemeDepthTuning } from '../rules/encounterTable';
import { measureRooms, predictClear } from './rooms';

/**
 * The fight-based tuner. It tunes one theme on one floor by HEALTH LOST PER FIGHT, measured with the room harness of
 * rooms.ts (each room fought once, from a rested party: the expert scripted hero in the gear schedule, with a Blink Dog
 * from floor 4):
 *
 *  1. the room budget, until an ordinary room costs the hero the target share of its hit points on average;
 *  2. the boss and the boss-room scale, until the boss room costs its own, higher target. Each boss of the theme that
 *     suits the floor is tried and the one that comes nearest is kept, so a boss that is deadly by itself gives way.
 *
 * Mean loss per fight is a steady number (dozens of fights per measurement), where a floor's clear rate is not, and the
 * two searches do not disturb each other (the boss scale leaves ordinary rooms alone). The same seeds are fought at every
 * setting tried. It is built to be FAST: one pass, small samples (about 25 ordinary fights and 12 boss fights per
 * measurement), a handful of measurements per pairing. Every pairing from floor 4, on four shards, takes about two minutes:
 *
 *   ROOM_TUNE=1 npx vitest run src/balance/roomTune --disableConsoleIntercept
 *
 * `predictClear` (the attrition model of rooms.ts) is reported for each result but is not what is searched for.
 */
export const ROOM_TUNE = {
  /** The share of its hit points an ordinary room should cost the hero on average, and the boss room, by floor. */
  combatLoss: (depth: number): number => (depth <= 10 ? 0.21 : 0.24),
  bossLoss: (depth: number): number => (depth <= 10 ? 0.42 : depth <= 19 ? 0.47 : 0.54),
  /** The clear rate those losses are meant to give (for the report). */
  target: (depth: number): number => (depth <= 3 ? 0.85 : depth <= 10 ? 0.75 : depth <= 19 ? 0.67 : 0.58),
  tolerance: 0.02,
  bossTolerance: 0.04,
  bossSwapBeyond: 0.12,
  combatFloors: 6,
  bossFloors: 12,
  seed0: 500,
  /** Budget multipliers the search may reach, relative to the entry it starts from. */
  budgetFactor: [0.15, 8] as [number, number],
  bossScaleRange: [0.3, 5] as [number, number],
  maxSteps: 4,
  /** Rounds of nudging the loss targets toward the clear-rate target, and how near is near enough. */
  passes: 1,
  clearTolerance: 0.06,
  /** Bosses tried for a floor: challenge rating from this share of the depth up to the depth plus one. */
  bossCr: [0.45, 1] as [number, number],
};

export interface TuneResult {
  theme: ThemeId;
  depth: number;
  entry: ThemeDepthTuning;
  combatLoss: number;
  bossLoss: number;
  /** The attrition model's first-attempt clear rate for the result, and for the entry it started from. */
  predicted: number;
  before: number;
  companionDowns: number;
  measurements: number;
}

function entryFor(theme: ThemeId, depth: number): ThemeDepthTuning {
  const table = (ENCOUNTER_TUNING.themeTuning[theme] ??= {}) as Record<number, ThemeDepthTuning>;
  return (table[depth] ??= { budget: ENCOUNTER_TUNING.budgetByLevel[depth - 1] as number });
}

/**
 * Find the x in [min, max] where the rising function f(x) is nearest to `target`: bracket by steps of `grow`, then halve
 * the gap on a log scale. Returns the best x tried and its value.
 */
function search(f: (x: number) => number, start: number, min: number, max: number, target: number, tol: number, steps: number): { x: number; y: number; n: number } {
  let best = { x: start, y: f(start) };
  let cur = best;
  let lo: number | undefined; // too low a value
  let hi: number | undefined;
  let n = 1;
  for (let i = 0; i < steps; i++) {
    if (Math.abs(cur.y - target) <= tol) break;
    if (cur.y < target) lo = cur.x;
    else hi = cur.x;
    let next = lo !== undefined && hi !== undefined ? Math.sqrt(lo * hi) : lo !== undefined ? lo * 1.7 : (hi as number) / 1.7;
    next = Math.min(max, Math.max(min, next));
    if (Math.abs(next - cur.x) / cur.x < 0.03) break;
    cur = { x: next, y: f(next) };
    n++;
    if (Math.abs(cur.y - target) < Math.abs(best.y - target)) best = cur;
  }
  return { ...best, n };
}

/** The bosses of a theme that suit a floor (see ROOM_TUNE.bossCr); the entry's own boss is always among them. */
export function bossCandidates(theme: ThemeId, depth: number, current?: string): MonsterDef[] {
  const [lo, hi] = ROOM_TUNE.bossCr;
  return MONSTERS.filter((m) => m.role === 'boss' && m.themes.includes(theme) && (m.id === current || (m.cr >= depth * lo && m.cr <= depth * hi + 1)));
}

/** Tune one pairing in place (ENCOUNTER_TUNING.themeTuning holds the result) and report it. */
export function tunePairing(theme: ThemeId, depth: number, opts: { seed0?: number } = {}): TuneResult {
  const t = ROOM_TUNE;
  const seed0 = opts.seed0 ?? t.seed0;
  const entry = entryFor(theme, depth);
  let count = 0;
  const whole = (): ReturnType<typeof measureRooms> => measureRooms(theme, depth, { floors: t.combatFloors, seed0 });
  const before = predictClear(whole());

  // The loss targets start from the table in ROOM_TUNE and are then nudged, at most twice, until the attrition model's
  // clear rate for the measured fights is near the floor's target: how much loss a floor can bear depends on how spiky its
  // fights are, which the means alone do not say.
  const start = entry.budget;
  let combatTarget = t.combatLoss(depth);
  let bossTarget = t.bossLoss(depth);
  for (let pass = 0; pass < t.passes; pass++) {
    // 1. Ordinary rooms: the budget.
    const combat = search(
      (budget) => {
        entry.budget = Math.round(budget);
        return measureRooms(theme, depth, { floors: t.combatFloors, seed0, only: 'combat' }).combat.meanLoss;
      },
      entry.budget,
      start * t.budgetFactor[0],
      start * t.budgetFactor[1],
      combatTarget,
      t.tolerance,
      t.maxSteps,
    );
    entry.budget = Math.round(combat.x);
    count += combat.n;

    // 2. The boss room: each suitable boss with its best scale; keep the one nearest the target (the current boss on a tie).
    const wanted = bossTarget;
    const own = { boss: entry.boss, scale: entry.bossScale ?? 1 };
    let bestBoss: { boss: string | undefined; scale: number; loss: number } | undefined;
    const candidates = bossCandidates(theme, depth, own.boss).sort((a, b) => (a.id === own.boss ? -1 : b.id === own.boss ? 1 : a.cr - b.cr));
    for (const cand of candidates.length > 0 ? candidates.map((m) => m.id) : [own.boss]) {
      if (cand) entry.boss = cand;
      const r = search(
        (scale) => {
          entry.bossScale = Math.round(scale * 100) / 100;
          return measureRooms(theme, depth, { floors: t.bossFloors, seed0, only: 'boss' }).boss.meanLoss;
        },
        cand === own.boss ? own.scale : 1,
        t.bossScaleRange[0],
        t.bossScaleRange[1],
        wanted,
        t.bossTolerance,
        3,
      );
      count += r.n;
      if (!bestBoss || Math.abs(r.y - wanted) < Math.abs(bestBoss.loss - wanted) - 0.02) bestBoss = { boss: cand, scale: Math.round(r.x * 100) / 100, loss: r.y };
      // Another boss is only tried when this one is far from the target at every scale (it is deadly, or harmless, by itself).
    if (Math.abs(r.y - wanted) <= t.bossSwapBeyond) break;
    }
    if (bestBoss) {
      if (bestBoss.boss) entry.boss = bestBoss.boss;
      if (bestBoss.scale === 1) delete entry.bossScale;
      else entry.bossScale = bestBoss.scale;
    }

    if (pass === t.passes - 1) break;
    const check = predictClear(measureRooms(theme, depth, { floors: t.bossFloors, seed0 }));
    count += 2;
    const miss = check - t.target(depth);
    if (Math.abs(miss) <= t.clearTolerance) break;
    const nudge = Math.max(-0.06, Math.min(0.06, miss * 0.3));
    combatTarget = Math.max(0.12, Math.min(0.4, combatTarget + nudge));
    bossTarget = Math.max(0.3, Math.min(0.65, bossTarget + nudge * 0.8));
  }

  const final = measureRooms(theme, depth, { floors: t.bossFloors, seed0 });
  count += 1;
  const predicted = predictClear(final);
  entry.modelClear = Math.round(predicted * 100) / 100;
  return {
    theme,
    depth,
    entry: { ...entry },
    combatLoss: final.combat.meanLoss,
    bossLoss: final.boss.meanLoss,
    predicted,
    before,
    companionDowns: final.outcomes.filter((o) => o.companionDowned).length / Math.max(1, final.outcomes.length),
    measurements: count,
  };
}

/**
 * The last step: with boss and boss scale settled, move the budget until the attrition model's clear rate for a LARGE
 * sample (several sets of floors together) is at the floor's target. The loss-based search above gets every pairing into
 * the right region with few fights; this corrects what the means do not show (how spiky the fights are) on enough fights
 * that the result holds on floors it has not seen.
 */
export function polishPairing(theme: ThemeId, depth: number, seedSets: number[] = [500, 2000, 4000], floors = 12): { budget: number; predicted: number; measurements: number } {
  const t = ROOM_TUNE;
  const entry = entryFor(theme, depth);
  const clear = (): number => {
    const parts = seedSets.map((seed0) => measureRooms(theme, depth, { floors, seed0 }));
    const first = parts[0] as ReturnType<typeof measureRooms>;
    return predictClear({
      ...first,
      outcomes: parts.flatMap((p) => p.outcomes),
      routeRooms: parts.reduce((n, p) => n + p.routeRooms, 0) / parts.length,
      sideRooms: parts.reduce((n, p) => n + p.sideRooms, 0) / parts.length,
    });
  };
  const start = entry.budget;
  // A bigger budget lowers the clear rate, so the search rises on (1 - clear).
  const r = search(
    (budget) => {
      entry.budget = Math.round(budget);
      return 1 - clear();
    },
    start,
    start * 0.4,
    start * 2.5,
    1 - t.target(depth),
    0.04,
    6,
  );
  entry.budget = Math.round(r.x);
  entry.modelClear = Math.round((1 - r.y) * 100) / 100;
  return { budget: entry.budget, predicted: 1 - r.y, measurements: r.n * seedSets.length };
}

import { describe, expect, it } from 'vitest';
import { floorSeed } from '../core/rng';
import { themeForDepth } from '../core/themes';
import { createNavGrid, generateFloor } from '../gen';
import { expertPolicy, expertStance, playerPolicy, type PolicyFn } from '../rules';
import { heroBuild } from './builds';
import { simulateRun, type RunSummary } from './index';

/**
 * Skill gap: the same seeded floors played by the naive scripted hero (`playerPolicy`) and by the expert
 * (`expertPolicy`: shoves into hazards, holds chokepoints, takes cover, picks targets). Thinking should pay.
 *
 * Default run: the expert never does meaningfully worse than the naive hero on floors with chasms (the depths on floor
 * 3) over a small sample; the deep foundry floors are left to the opt-in report because they are slow. Opt-in report (slow):
 *
 *   SKILL_GAP=1 [BALANCE_RUNS=150] npx vitest run src/balance/skillGap.test.ts --disableConsoleIntercept -t REPORT
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const report = !!env['SKILL_GAP'];
const runs = Number(env['BALANCE_RUNS'] ?? 150);
const seeds = (n: number, from = 7000): number[] => Array.from({ length: n }, (_, i) => from + i);
const pct = (n: number, d: number): string => `${Math.round((n / Math.max(1, d)) * 100)}%`;

function runWith(policy: PolicyFn, n: number, floors: number, companion = false): RunSummary {
  const stance = expertStance('blink_dog');
  return simulateRun(heroBuild('a', 'human', 'defense'), seeds(n), {
    floors,
    policy,
    gear: 'schedule',
    keepGoing: true,
    ...(companion ? { companion: { id: 'blink_dog', stance } } : {}),
  });
}

/** What the generator provides at measurement time (posts, formations, cover, hazards), over floors 1 to 8. */
function generatorFeatures(): string {
  let posts = 0;
  let spawns = 0;
  let formations = 0;
  let rooms = 0;
  let coverPairs = 0;
  let hazards = 0;
  const names = new Set<string>();
  for (let depth = 1; depth <= 8; depth++) {
    const plan = generateFloor({ seed: floorSeed(7000, depth), depth, theme: themeForDepth(depth) });
    const nav = createNavGrid(plan);
    for (const s of plan.spawns) if (s.role !== 'chest') {
      spawns++;
      if (s.post) posts++;
    }
    for (const r of plan.rooms) {
      rooms++;
      if (r.formation) {
        formations++;
        names.add(r.formation);
      }
    }
    if (plan.chasmHazard || plan.waterHazard) hazards++;
    for (let y = 0; y < plan.height; y += 2) {
      for (let x = 0; x < plan.width; x += 2) {
        const a = { x, y };
        const b = { x: x + 3, y };
        if (nav.isWalkable(a) && nav.isWalkable(b) && nav.hasLineOfSight(a, b) && nav.coverBetween(a, b) > 0) coverPairs++;
      }
    }
  }
  return `spawn slots with a post ${posts}/${spawns}; rooms with a formation ${formations}/${rooms} (${[...names].join(', ') || 'none'}); floors with hazard flags ${hazards}/8; cover pairs found ${coverPairs}`;
}

describe('skill gap', () => {
  it('the expert is never meaningfully worse than the naive hero on floors with chasms', () => {
    // Floor 3 (the depths, a chasm floor), run through the first three floors with paired seeds.
    const n = 40;
    const naive = runWith(playerPolicy, n, 3);
    const expert = runWith(expertPolicy, n, 3);
    const rate = (s: RunSummary): number => (s.floors[2]?.firstAttemptClears ?? 0) / Math.max(1, s.floors[2]?.runs ?? 1);
    expect(rate(expert), `depths: expert ${rate(expert)} vs naive ${rate(naive)}`).toBeGreaterThanOrEqual(rate(naive) - 0.2);
  }, 120_000);

  it.skipIf(!report)('REPORT first-attempt clear rates, naive vs expert, floors 1 to 8 (Defender, Blink Dog from floor 4)', () => {
    const t0 = Date.now();
    const naive = runWith(playerPolicy, runs, 8, true);
    const t1 = Date.now();
    const expert = runWith(expertPolicy, runs, 8, true);
    const t2 = Date.now();
    console.log(`GENERATOR at measurement time: ${generatorFeatures()}`);
    console.log(`SKILL GAP, ${runs} runs per policy (naive ${((t1 - t0) / 1000).toFixed(0)} s, expert ${((t2 - t1) / 1000).toFixed(0)} s)`);
    console.log('floor | naive first-try | expert first-try | gap (points) | naive attempts/clear | expert attempts/clear');
    for (let i = 0; i < 8; i++) {
      const a = naive.floors[i]!;
      const b = expert.floors[i]!;
      const gap = Math.round((b.firstAttemptClears / b.runs - a.firstAttemptClears / a.runs) * 100);
      console.log(`${i + 1} | ${pct(a.firstAttemptClears, a.runs)} | ${pct(b.firstAttemptClears, b.runs)} | ${gap >= 0 ? '+' : ''}${gap} | ${(a.attempts / a.runs).toFixed(2)} | ${(b.attempts / b.runs).toFixed(2)}`);
    }
    console.log(`completed within the attempt cap: naive ${pct(naive.completed * runs, runs)}, expert ${pct(expert.completed * runs, runs)}`);
    expect(naive.floors).toHaveLength(8);
  }, 14_400_000);
});

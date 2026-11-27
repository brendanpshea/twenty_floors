import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expertStance, makeExpertPolicy, playerPolicy, type PolicyFn } from '../rules';
import { heroBuild } from './builds';
import { simulateRun, type RunSummary } from './index';

/**
 * Ablation of the expert hero: the same seeded runs played with the naive policy, the full expert, and the expert
 * with ONE behaviour switched off at a time. Each variant writes its per-seed first-attempt outcomes to the temp
 * directory (abl_<variant>_<seed0>.json) so chunks can be run one invocation at a time and merged afterwards into
 * PAIRED differences against the naive hero (same seeds) with their standard errors.
 *
 *   ABLATION=1 [BALANCE_RUNS=150] [ABLATION_VARIANTS=naive,all,hold] [ABLATION_SEED0=7000] [ABLATION_FLOORS=8]
 *     npx vitest run src/balance/ablation.test.ts --disableConsoleIntercept -t REPORT
 *
 * Variants: 'naive', 'all' (expert, everything on) and an ExpertOptions flag name (the expert with that flag OFF).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const on = !!env['ABLATION'];
const runs = Number(env['BALANCE_RUNS'] ?? 150);
const floors = Number(env['ABLATION_FLOORS'] ?? 8);
const seed0 = Number(env['ABLATION_SEED0'] ?? 7000);
const seeds = Array.from({ length: runs }, (_, i) => seed0 + i);

function play(policy: PolicyFn): RunSummary {
  return simulateRun(heroBuild('a', 'human', 'defense'), seeds, {
    floors,
    policy,
    gear: 'schedule',
    keepGoing: true,
    companion: { id: 'blink_dog', stance: expertStance('blink_dog') },
  });
}

/** Paired difference b - a in first-attempt clears on a floor, in percentage points, with its standard error. */
export function paired(a: RunSummary, b: RunSummary, floor: number): { diff: number; se: number } {
  const fa = a.floors[floor - 1]!.firstTryBySeed;
  const fb = b.floors[floor - 1]!.firstTryBySeed;
  const d = seeds.map((s) => Number(fb[s] ?? false) - Number(fa[s] ?? false));
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  const v = d.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, d.length - 1);
  return { diff: mean * 100, se: Math.sqrt(v / d.length) * 100 };
}

describe('expert ablation', () => {
  it('the paired-difference helper is exact on a hand-made pair', () => {
    const mk = (hits: boolean[]): RunSummary => ({ runs: hits.length, completed: 1, floors: [{ firstTryBySeed: Object.fromEntries(hits.map((h, i) => [seed0 + i, h])) } as never] });
    const a = mk(seeds.map((_, i) => i % 2 === 0));
    const b = mk(seeds.map(() => true));
    expect(paired(a, b, 1).diff).toBeCloseTo(50, 5);
  });

  it.skipIf(!on)('REPORT run the chosen variants and write their per-seed outcomes to the temp dir', () => {
    const variants = (env['ABLATION_VARIANTS'] ?? 'naive,all').split(',').filter(Boolean);
    const dir = env['TEMP'] ?? '.';
    for (const v of variants) {
      const policy = v === 'naive' ? playerPolicy : v === 'all' ? makeExpertPolicy() : makeExpertPolicy({ [v]: false });
      const t0 = Date.now();
      const s = play(policy);
      const out = { variant: v, seed0, runs, floors: s.floors.map((f) => f.firstTryBySeed) };
      writeFileSync(dir + '/abl_' + v + '_' + seed0 + '.json', JSON.stringify(out));
      const rates = s.floors.map((f) => Math.round((f.firstAttemptClears / f.runs) * 100)).join(' ');
      console.log('ABLATION ' + v + ' seed0 ' + seed0 + ' runs ' + runs + ': ' + rates + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    }
    expect(variants.length).toBeGreaterThan(0);
  }, 14_400_000);
});

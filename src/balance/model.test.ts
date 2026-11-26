import { describe, expect, it } from 'vitest';
import { fighterAt, formatModel, modelDepth, modelFloor } from './model';

// The table for every floor, skipped unless BALANCE_MODEL=1:
//   BALANCE_MODEL=1 BALANCE_N=300 BALANCE_ALLY=2 npx vitest run src/balance/model.test.ts --disableConsoleIntercept
// BALANCE_ALLY is the ally's level gap ("none" for a solo hero; default 2).
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => 1000 + i);

describe('the quick party model', () => {
  it('gives the Fighter a sane progression from level 1 to 20', () => {
    const one = fighterAt(1);
    expect(one).toMatchObject({ maxHp: 12, ac: 19, toHit: 5, attacks: 1, critFrom: 20 });
    expect(fighterAt(5).attacks).toBe(2);
    expect(fighterAt(11).attacks).toBe(3);
    expect(fighterAt(20).attacks).toBe(4);
    for (let l = 2; l <= 20; l++) {
      const a = fighterAt(l - 1);
      const b = fighterAt(l);
      expect(b.maxHp).toBeGreaterThan(a.maxHp);
      expect(b.ac).toBeGreaterThanOrEqual(a.ac);
      expect(b.toHit).toBeGreaterThanOrEqual(a.toHit);
    }
    expect(fighterAt(20).toHit).toBe(14);
  });

  it('is deterministic for a seed', () => {
    expect(modelFloor(1234, 2, { allyLevelGap: 2 })).toEqual(modelFloor(1234, 2, { allyLevelGap: 2 }));
  });

  it('agrees roughly with the real simulation where both exist, and an ally helps', () => {
    // The real engine's scripted solo hero clears floors 1 to 3 about 90%, 75% and 70% of the time.
    // The model is cruder (too hard on floor 1, too easy on floor 3), so the bounds are loose.
    for (const depth of [1, 2, 3]) {
      const solo = modelDepth(depth, seeds(150));
      expect(solo.clearRate, `floor ${depth} solo`).toBeGreaterThan(0.45);
      const duo = modelDepth(depth, seeds(150), { allyLevelGap: 2 });
      expect(duo.clearRate, `floor ${depth} with an ally`).toBeGreaterThanOrEqual(solo.clearRate);
    }
  }, 60_000);

  it.skipIf(env['BALANCE_MODEL'] !== '1')(
    'table',
    () => {
      const n = Number(env['BALANCE_N'] ?? 300);
      const gap = env['BALANCE_ALLY'] === 'none' ? undefined : Number(env['BALANCE_ALLY'] ?? 2);
      const rows = Array.from({ length: 20 }, (_, i) => modelDepth(i + 1, seeds(n), gap === undefined ? {} : { allyLevelGap: gap }));
      console.log(`\n${gap === undefined ? 'Solo hero' : `Hero with an ally ${gap} levels lower`}, ${n} runs per floor\n${formatModel(rows)}\n`);
    },
    600_000,
  );
});

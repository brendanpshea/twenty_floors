import { describe, expect, it } from 'vitest';
import type { CompanionStance } from '../core/types';
import { heroBuild } from './builds';
import { formatSummary, scheduleGear, simulateRun, type FloorStats } from './index';
import { createCharacter, applyLevelUp, suggestedLevelChoices, computeAc } from '../rules';

/**
 * Companions in the balance harness.
 *
 * Default run: a few seeded runs prove that every companion can travel floors 4 to 6 in every stance, and that the
 * gear schedule is applied. Dev report (slow, opt-in), first-attempt clear rates with the REAL engine for floors 1 to 20:
 *
 *   BALANCE_COMPANIONS=1 [BALANCE_RUNS=100] [BALANCE_ONLY=blink_dog] npx vitest run src/balance/companion.test.ts --disableConsoleIntercept
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const report = !!env['BALANCE_COMPANIONS'];
const runs = Number(env['BALANCE_RUNS'] ?? 100);
const only = env['BALANCE_ONLY'] ?? '';
const IDS = ['sphinx_of_wonder', 'pseudodragon', 'blink_dog'];

describe('companions in the balance harness', () => {
  it('the gear schedule follows the design: splint, plate, then magic armor, weapons and shields', () => {
    let pc = createCharacter(heroBuild('a', 'human', 'defense'));
    while (pc.level < 20) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
    const at = (level: number): ReturnType<typeof scheduleGear> => scheduleGear({ ...pc, level });
    expect(at(1).equipped.armor).toBe('chain_mail');
    expect(at(3).equipped.armor).toBe('splint');
    expect(at(5).equipped.armor).toBe('plate_plus1');
    expect(at(10).equipped.armor).toBe('plate_plus2');
    expect(at(16).equipped.armor).toBe('plate_plus3');
    expect(at(4).equipped.mainHand).toBe('longsword_plus1');
    expect(at(15).equipped.mainHand).toBe('longsword_plus3');
    expect(at(8).equipped.offHand).toBe('shield_plus1');
    expect(at(13).equipped.offHand).toBe('shield_plus2');
    expect(computeAc(at(20))).toBeGreaterThan(computeAc(at(1)));
  });

  it('each companion in each stance travels floors 4 to 5 for a couple of seeded runs', () => {
    for (const id of IDS) {
      for (const stance of ['close', 'back', 'focus'] as CompanionStance[]) {
        const s = simulateRun(heroBuild('a', 'human', 'defense'), [1001, 1002], { floors: 5, companion: { id, stance }, gear: 'schedule', keepGoing: true });
        expect(s.floors).toHaveLength(5);
        for (const f of s.floors) expect(f.runs).toBe(2);
        // Floors 1 to 3 have no companion.
        expect(s.floors.slice(0, 3).every((f) => f.companionDowns === 0)).toBe(true);
      }
    }
  }, 300_000);

  it.skipIf(!report)('REPORT first-attempt clear rates, floors 1 to 20, per companion', () => {
    const seeds = Array.from({ length: runs }, (_, i) => 5000 + i);
    const table: Record<string, FloorStats[]> = {};
    for (const id of IDS) {
      if (only && !id.includes(only)) continue;
      const t0 = Date.now();
      const s = simulateRun(heroBuild('a', 'human', 'defense'), seeds, { floors: 20, companion: { id, stance: 'close' }, gear: 'schedule', keepGoing: true });
      table[id] = s.floors;
      console.log(formatSummary(`${id} (close), ${runs} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s`, s));
      const pct = s.floors.map((f) => `${f.depth}:${Math.round((f.firstAttemptClears / f.runs) * 100)}`).join(' ');
      console.log(`TABLE ${id} first-try % by floor: ${pct}`);
      const killers: Record<string, number> = {};
      for (const f of s.floors.slice(3)) for (const [k, n] of Object.entries(f.deathsByKiller)) killers[k] = (killers[k] ?? 0) + n;
      console.log(`KILLERS ${id}: ` + Object.entries(killers).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k}:${n}`).join(' '));
      console.log(`DOWNS ${id}: ` + s.floors.map((f) => (f.attempts > 0 ? (f.companionDowns / f.attempts).toFixed(1) : '-')).join(' '));
    }
    expect(Object.keys(table).length).toBeGreaterThan(0);
  }, 14_400_000);
});

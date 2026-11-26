import { describe, expect, it } from 'vitest';
import { THEME_RANGE, planRunThemes } from '../core/themes';
import type { ThemeId } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { ENCOUNTER_TUNING, levelBudgetAt } from '../rules';
import type { ThemeTuning } from '../rules/encounterTable';
import { bossFor, formatTable, tunePair, tunePairs } from './tune';

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('theme tuning table', () => {
  it('covers every theme and floor a randomized run can produce, with a real boss of that theme', () => {
    for (const [theme, depth] of tunePairs()) {
      const e = ENCOUNTER_TUNING.themeTuning[theme]?.[depth];
      expect(e, `${theme} at ${depth}`).toBeDefined();
      expect(e?.budget).toBeGreaterThan(0);
      const boss = MONSTERS.find((m) => m.id === e?.boss);
      expect(boss?.themes, `${theme} at ${depth}: ${e?.boss}`).toContain(theme);
    }
  });

  it('a tuned pairing replaces the per-depth budget and boss', () => {
    const e = ENCOUNTER_TUNING.themeTuning.hold?.[9];
    expect(levelBudgetAt(9, 'hold')).toBe(e?.budget);
    expect(levelBudgetAt(2, 'crypt')).toBe(ENCOUNTER_TUNING.budgetByLevel[1]);
  });

  it('randomized runs never repeat a theme, keep it at most two floors, and end in the lair', () => {
    for (let seed = 0; seed < 300; seed++) {
      const run = planRunThemes(seed, { fixedFloors: seed % 2 ? 0 : 3 });
      expect(run).toHaveLength(20);
      expect(run[19]).toBe('lair');
      const blocks = run.filter((t, i) => run[i - 1] !== t);
      expect(new Set(blocks).size).toBe(blocks.length);
      for (let i = 2; i < 20; i++) expect(run[i] === run[i - 1] && run[i] === run[i - 2]).toBe(false);
      expect(planRunThemes(seed, { fixedFloors: seed % 2 ? 0 : 3 })).toEqual(run);
    }
    expect(planRunThemes(5).slice(0, 3)).toEqual(['warrens', 'crypt', 'depths']);
  });

  it('randomized runs only use tuned pairings', () => {
    for (let seed = 0; seed < 300; seed++) {
      planRunThemes(seed, { fixedFloors: seed % 2 ? 0 : 3 }).forEach((theme, i) => {
        expect(i + 1).toBeGreaterThanOrEqual(THEME_RANGE[theme][0]);
        expect(i + 1).toBeLessThanOrEqual(THEME_RANGE[theme][1]);
      });
    }
  });

  it('bosses are never far above the party', () => {
    for (const [theme, depth] of tunePairs()) {
      const boss = bossFor(theme, depth);
      // One over is allowed where the theme has no boss at or below the floor (ice on floor 10).
      if (boss && depth >= 5) expect(boss.cr, `${theme} at ${depth}`).toBeLessThanOrEqual(depth + 1);
    }
  });

  // BALANCE_TUNE=1 re-tunes the whole table (slow); BALANCE_TUNE=sewers,hold only those themes.
  // It prints the new table between TABLE-BEGIN and TABLE-END; paste it over the one in
  // src/rules/encounterTable.ts.
  it.runIf(env['BALANCE_TUNE'])(
    'prints a re-tuned table',
    () => {
      const only = env['BALANCE_TUNE'] === '1' ? undefined : (env['BALANCE_TUNE'] as string).split(',');
      const table = JSON.parse(JSON.stringify(ENCOUNTER_TUNING.themeTuning)) as ThemeTuning;
      for (const [theme, depth] of tunePairs()) {
        if (only && !only.includes(theme)) continue;
        (table[theme as ThemeId] ??= {})[depth] = tunePair(theme, depth);
      }
      console.log(`TABLE-BEGIN\n${formatTable(table)}TABLE-END`);
    },
    4 * 60 * 60 * 1000,
  );
});

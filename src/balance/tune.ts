import { THEME_RANGE, themeForDepth } from '../core/themes';
import type { MonsterDef, ThemeId } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { ENCOUNTER_TUNING } from '../rules';
import type { ThemeDepthTuning, ThemeTuning } from '../rules/encounterTable';
import { modelDepth } from './model';

/**
 * The tuner behind src/rules/encounterTable.ts. For every theme and every floor it may turn up on
 * (THEME_RANGE) it picks a boss by rule and then searches room budgets with the quick party model
 * until first-attempt clears land near the target. Floors 1 to 3 on their fixed themes are tuned
 * against the real engine and are left out.
 *
 * Regenerate after changing monsters or encounter rules:
 *   BALANCE_TUNE=1 npx vitest run src/balance/tune.test.ts --disableConsoleIntercept
 */

/** Starting points for the search: a solo hero's per-room budget by level. */
const BASE = [36, 130, 140, 160, 325, 390, 490, 650, 845, 1040, 1235, 1430, 1690, 1885, 2145, 2470, 2925, 3250, 3575, 4160];

export const TUNE = {
  /** From this floor on the party is the hero plus an ally two levels lower; before it, the hero alone. */
  allyFromDepth: 4,
  allyLevelGap: 2,
  targetSolo: 0.75,
  targetParty: 0.68,
  soloSteps: [0.5, 0.75, 1, 1.5, 2, 3],
  partySteps: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12],
  runs: 100,
};

/**
 * The boss for a theme at a depth: the strongest of the theme's bosses the party can face
 * (challenge rating at most the depth; one less on floor 4 and before), taking turns with the
 * runner-up on even floors when that one is strong enough, so two floors of one theme differ.
 */
export function bossFor(theme: ThemeId, depth: number): MonsterDef | undefined {
  const bosses = MONSTERS.filter((m) => m.role === 'boss' && m.themes.includes(theme)).sort((a, b) => b.cr - a.cr || a.id.localeCompare(b.id));
  if (bosses.length === 0) return undefined;
  const cap = depth <= 4 ? Math.max(1, depth - 1) : depth;
  const able = bosses.filter((m) => m.cr <= cap);
  if (able.length === 0) return bosses[bosses.length - 1];
  const second = able[1];
  return second && second.cr >= depth * 0.6 && depth % 2 === 0 ? second : able[0];
}

export function isFixedTunedPair(theme: ThemeId, depth: number): boolean {
  return depth <= 3 && themeForDepth(depth) === theme;
}

/** Tune one theme on one floor. Leaves ENCOUNTER_TUNING.themeTuning holding the chosen entry. */
export function tunePair(theme: ThemeId, depth: number): ThemeDepthTuning {
  const party = depth >= TUNE.allyFromDepth;
  const target = party ? TUNE.targetParty : TUNE.targetSolo;
  const steps = party ? TUNE.partySteps : TUNE.soloSteps;
  const seeds = Array.from({ length: TUNE.runs }, (_, i) => 7000 + i);
  const boss = bossFor(theme, depth)?.id;
  const table = (ENCOUNTER_TUNING.themeTuning[theme] ??= {});
  let best: ThemeDepthTuning | undefined;
  for (const k of steps) {
    const entry: ThemeDepthTuning = { budget: Math.round((BASE[depth - 1] as number) * k), ...(boss ? { boss } : {}) };
    table[depth] = entry;
    const r = modelDepth(depth, seeds, { theme, cachePlans: true, ...(party ? { allyLevelGap: TUNE.allyLevelGap } : {}) });
    entry.modelClear = Math.round(r.clearRate * 100) / 100;
    if (!best || Math.abs(r.clearRate - target) < Math.abs((best.modelClear as number) - target)) best = entry;
    if (r.clearRate < target - 0.3) break;
  }
  table[depth] = best as ThemeDepthTuning;
  return best as ThemeDepthTuning;
}

/** Every pairing the table should hold. */
export function tunePairs(): Array<[ThemeId, number]> {
  const out: Array<[ThemeId, number]> = [];
  for (const [theme, [lo, hi]] of Object.entries(THEME_RANGE) as Array<[ThemeId, [number, number]]>) {
    for (let d = lo; d <= hi; d++) if (!isFixedTunedPair(theme, d)) out.push([theme, d]);
  }
  return out;
}

export function formatTable(t: ThemeTuning): string {
  const lines: string[] = [];
  for (const theme of Object.keys(THEME_RANGE) as ThemeId[]) {
    const rows = t[theme];
    if (!rows) continue;
    lines.push(`  ${theme}: {`);
    for (const d of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
      const e = rows[d] as ThemeDepthTuning;
      lines.push(`    ${d}: { budget: ${e.budget}${e.boss ? `, boss: '${e.boss}'` : ''}${e.modelClear !== undefined ? `, modelClear: ${e.modelClear}` : ''} },`);
    }
    lines.push('  },');
  }
  return `export const THEME_TUNING: ThemeTuning = {\n${lines.join('\n')}\n};\n`;
}

import { describe, it } from 'vitest';
import type { CharacterBuild, PlayerCharacter } from '../core/types';
import { createCharacter } from '../rules';
import { FIGHTER } from '../rules/classes';
import { buildFromPreset } from '../rules';
import { simulateRun, type RunSummary } from './index';
import { casterBuild, heroBuild } from './builds';

/**
 * Dev report, skipped in normal runs: BALANCE_REPORT=1 npx vitest run src/balance/report.test.ts
 * Optional BALANCE_RUNS (default 300) and BALANCE_ONLY (substring filter on the label).
 * First-attempt clear rates on floors 1-3 for a normal (resting, shopping) player.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const on = !!env['BALANCE_REPORT'];
const runs = Number(env['BALANCE_RUNS'] ?? 300);
const only = env['BALANCE_ONLY'] ?? '';
const seeds = Array.from({ length: runs }, (_, i) => 1000 + i);

function row(label: string, s: RunSummary): string {
  const pct = (floor: number): string => {
    const f = s.floors[floor - 1];
    return f ? `${((f.firstAttemptClears / f.runs) * 100).toFixed(0).padStart(3)}%` : '   -';
  };
  return `${label.padEnd(50)} F1 ${pct(1)}  F2 ${pct(2)}  F3 ${pct(3)}  completed ${(s.completed * 100).toFixed(0)}%`;
}

/** The Archer as it was before weapon sets: only the bow, in hand, with no blades to fall back on. */
const bowOnly = (build: CharacterBuild): PlayerCharacter => {
  const pc = createCharacter(build);
  return { ...pc, equipped: { armor: pc.equipped.armor as string, ranged: 'longbow' } };
};

/** The old Archer: Strength-first abilities (the Defender preset's) with the Archer kit and style. */
const oldArcher = (): CharacterBuild => {
  const defender = FIGHTER.presets[0] as (typeof FIGHTER.presets)[number];
  const b = buildFromPreset(defender, 'soldier', { name: 'Sim' });
  b.choices['startingKit'] = 'c';
  b.choices['fightingStyle'] = 'archery';
  return b;
};

const builds: [string, CharacterBuild, ((b: CharacterBuild) => PlayerCharacter)?][] = [
  ['preset Defender: kit a, Defense (soldier)', heroBuild('a', 'human', 'defense')],
  ['preset Great Weapon: kit b, GWF (soldier)', heroBuild('b', 'human', 'greatWeaponFighting')],
  ['preset Archer: kit c, Archery (soldier)', heroBuild('c', 'human', 'archery')],
  ['Defender + Criminal (Alert)', heroBuild('a', 'human', 'defense', 'criminal')],
  ['Defender + Sage (Magic Initiate, wizard picks)', casterBuild('sage')],
  ['Defender + Acolyte (Magic Initiate, cleric picks)', casterBuild('acolyte')],
  ['kit b Defense (soldier)', heroBuild('b', 'human', 'defense')],
  ['kit c Defense (soldier)', heroBuild('c', 'human', 'defense')],
  ['kit c Two-Weapon Fighting (soldier)', heroBuild('c', 'human', 'twoWeaponFighting')],
  ['Archer before: STR-first, bow only', oldArcher(), bowOnly],
  ['Archer Part 2 only: DEX-first, bow only', heroBuild('c', 'human', 'archery'), bowOnly],
];

describe.skipIf(!on)('balance report', () => {
  it('prints first-attempt clear rates', () => {
    for (const [label, b, make] of builds) {
      if (only && !label.includes(only)) continue;
      console.log(row(label, simulateRun(b, seeds, make ? { makePc: make } : {})));
    }
  }, 3_600_000);
});

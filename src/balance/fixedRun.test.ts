import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TUNING, expertPolicy, expertStance, playerPolicy } from '../rules';
import { heroBuild } from './builds';
import { simulateRun } from './index';

/**
 * Real-engine measurement of the fixed run (floors 1..N, hero plus a companion from floor 4), one chunk per invocation.
 * Writes a JSON summary to the temp directory (run_<policy>_<gear>_<companion>_<seed0>.json) that `tools`-style scripts
 * merge. Opt-in:
 *
 *   FIXED_RUN=1 [FIXED_POLICY=naive|expert] [FIXED_GEAR=shop|schedule] [FIXED_FLOORS=20] [BALANCE_RUNS=25]
 *     [FIXED_SEED0=20000] [FIXED_KIT=a|b|c] [FIXED_COMPANION=blink_dog|pseudodragon|sphinx_of_wonder] [FIXED_BACKGROUND=soldier]
 *     npx vitest run src/balance/fixedRun.test.ts --disableConsoleIntercept -t REPORT
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const on = !!env['FIXED_RUN'];

describe('fixed run measurement', () => {
  it.skipIf(!on)('REPORT one chunk of the fixed run', () => {
    const policyName = env['FIXED_POLICY'] ?? 'expert';
    const gear = (env['FIXED_GEAR'] ?? 'shop') as 'shop' | 'schedule';
    const floors = Number(env['FIXED_FLOORS'] ?? 20);
    const runs = Number(env['BALANCE_RUNS'] ?? 25);
    const seed0 = Number(env['FIXED_SEED0'] ?? 20000);
    const kit = env['FIXED_KIT'] ?? 'a';
    const companion = env['FIXED_COMPANION'] ?? 'blink_dog';
    const background = env['FIXED_BACKGROUND'] ?? 'soldier';
    // FIXED_SCALE='1,1,1,0.6,...' overrides ENCOUNTER_TUNING.depthScale for this chunk (used by the tuning loop).
    const scale = (env['FIXED_SCALE'] ?? '').split(',').filter(Boolean).map(Number);
    if (scale.length > 0) ENCOUNTER_TUNING.depthScale = Array.from({ length: 20 }, (_, i) => scale[i] ?? 1);
    const policy = policyName === 'naive' ? playerPolicy : expertPolicy;
    const seeds = Array.from({ length: runs }, (_, i) => seed0 + i);
    const t0 = Date.now();
    const s = simulateRun(heroBuild(kit, 'human', kit === 'c' ? undefined : 'defense', background), seeds, {
      floors,
      policy,
      gear,
      keepGoing: true,
      companion: { id: companion, stance: policyName === 'naive' ? 'close' : expertStance(companion) },
    });
    const out = {
      policy: policyName,
      gear,
      kit,
      companion,
      background,
      seed0,
      runs,
      floors: s.floors.map((f) => ({
        depth: f.depth,
        runs: f.runs,
        firstTry: f.firstAttemptClears,
        attempts: f.attempts,
        deathsByRole: f.deathsByRole,
        deathsByKiller: f.deathsByKiller,
        companionDowns: f.companionDowns,
        potions: f.potionsUsed,
        forced: f.forced,
        rooms: f.rooms,
      })),
    };
    writeFileSync(`${env['TEMP'] ?? '.'}/run_${policyName}_${gear}_${kit}_${companion}_${background}_${seed0}.json`, JSON.stringify(out));
    console.log(`RUN ${policyName} ${gear} kit ${kit} ${companion} ${background} seed0 ${seed0} runs ${runs} (${((Date.now() - t0) / 1000).toFixed(0)} s): ` + s.floors.map((f) => Math.round((f.firstAttemptClears / f.runs) * 100)).join(' '));
    expect(s.floors).toHaveLength(floors);
  }, 14_400_000);
});

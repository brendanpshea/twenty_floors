import * as nodeFs from 'node:fs';
import type { CompanionState, PlayerCharacter, ThemeId } from '../core/types';
import { ENCOUNTER_TUNING, applyLevelUp, companionLongRest, createCharacter, enterFloor, expertPolicy, expertStance, makeExpertPolicy, playerPolicy, requireCompanion, suggestedLevelChoices } from '../rules';
import { heroBuild } from './builds';
import { scheduleGear, simulateFloor } from './index';

/** A hero at the floor's level in the design gear schedule, rested, with a Blink Dog of the right level from floor 4. */
export function arriveAt(depth: number, kit = 'a', companionId = 'blink_dog'): { pc: PlayerCharacter; companion?: CompanionState } {
  let pc = createCharacter(heroBuild(kit, 'human', kit === 'c' ? undefined : 'defense'));
  while (pc.level < depth) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  pc = enterFloor(scheduleGear(pc));
  if (depth < 4) return { pc };
  return { pc, companion: companionLongRest({ id: companionId, hp: 1, resources: {}, stance: 'close' }, requireCompanion(companionId), pc.level) };
}

export interface FitRow {
  depth: number;
  mult: number;
  runs: number;
  clears: number;
  bossDeaths: number;
  roomDeaths: number;
  downs: number;
  policy: string;
  killers: Record<string, number>;
}

/** First-attempt clear rate of one floor at a budget multiplier (independent floors: no chaining). */
export function measureFloor(depth: number, mult: number, runs: number, seed0: number, policyName = 'expert', kit = 'a', companionId = 'blink_dog', theme?: ThemeId): FitRow {
  const scale = ENCOUNTER_TUNING.depthScale.slice();
  scale[depth - 1] = mult;
  ENCOUNTER_TUNING.depthScale = scale;
  const { pc, companion } = arriveAt(depth, kit, companionId);
  // 'expert-no<flag>' switches one expert behaviour off (ablation on a single floor).
  const policy = policyName === 'naive' ? playerPolicy : policyName.startsWith('expert-no') ? makeExpertPolicy({ [policyName.slice(9)]: false }) : expertPolicy;
  const stance = policyName === 'naive' ? 'close' : expertStance(companionId);
  let clears = 0;
  let boss = 0;
  let room = 0;
  let downs = 0;
  const killers: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const r = simulateFloor(pc, { runSeed: seed0 + i, depth, policy, ...(theme ? { theme } : {}), ...(companion ? { companion: { id: companionId, stance, state: companion } } : {}) });
    if (r.cleared) clears++;
    else if (r.death?.role === 'boss') boss++;
    else room++;
    if (!r.cleared && r.death) {
      const k = r.death.killer === 'timeout' ? 'timeout:' + [...new Set(r.log[r.log.length - 1]?.monsters ?? [])].join('+') : r.death.killer;
      killers[k] = (killers[k] ?? 0) + 1;
    }
    downs += r.companionDowns ?? 0;
  }
  return { depth, mult, runs, clears, bossDeaths: boss, roomDeaths: room, downs, policy: policyName, killers };
}

export function appendRow(row: FitRow, file: string): void {
  (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync(file, JSON.stringify(row) + '\n');
}

import * as nodeFs from 'node:fs';
import type { CompanionState, PlayerCharacter, ThemeId } from '../core/types';
import { ENCOUNTER_TUNING, bestPotion, shopStock, applyLevelUp, companionLongRest, createCharacter, enterFloor, expertPolicy, expertStance, makeExpertPolicy, playerPolicy, requireCompanion, suggestedLevelChoices } from '../rules';
import { heroBuild } from './builds';
import { scheduleGear, simulateFloor } from './index';

/** A hero at the floor's level in the design gear schedule, rested, with a Blink Dog of the right level from floor 4. */
export function arriveAt(depth: number, kit = 'a', companionId = 'blink_dog'): { pc: PlayerCharacter; companion?: CompanionState } {
  // Kit 'h' (experiment): the Defender with a warhammer (Push mastery, 1d8 versatile like the longsword) and its mastery.
  let pc = createCharacter(heroBuild(kit === 'h' ? 'a' : kit, 'human', kit === 'c' ? undefined : 'defense'));
  if (kit === 'h') pc = hammerKit(pc);
  while (pc.level < depth) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  pc = enterFloor(scheduleGear(pc));
  // What the hub's autoShop leaves a hero with: four of the best healing potion on sale at this depth (the starting two on floor 1).
  const potion = depth > 1 && !(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.['FIT_NO_POTIONS'] ? bestPotion(shopStock(depth, pc)) : undefined;
  if (potion) pc = { ...pc, inventory: [...pc.inventory.filter((s) => !s.itemId.startsWith('potion')), { itemId: potion.id, quantity: 4 }] };
  if (depth < 4) return { pc };
  return { pc, companion: companionLongRest({ id: companionId, hp: 1, resources: {}, stance: 'close' }, requireCompanion(companionId), pc.level) };
}

/** The Defender's kit with a warhammer in the main hand and Push among the mastered kinds (a Hammer-and-shield variant). */
export function hammerKit(pc: PlayerCharacter): PlayerCharacter {
  const next = JSON.parse(JSON.stringify(pc)) as PlayerCharacter;
  if (!next.inventory.some((s) => s.itemId === 'warhammer')) next.inventory.push({ itemId: 'warhammer', quantity: 1 });
  next.equipped.mainHand = 'warhammer';
  const kinds = (next.build.choices['masteries'] ?? 'longsword').split(',').filter((k) => k && k !== 'longsword');
  next.build.choices['masteries'] = ['warhammer', ...kinds, 'javelin'].join(',');
  return next;
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

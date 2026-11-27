import { describe, expect, it } from 'vitest';
import { CHEST_RULE, applyLevelUp, computeAc, createCharacter, floorReward, getItem, longRest, suggestedLevelChoices } from '../rules';
import type { PlayerCharacter } from '../core/types';
import { heroBuild } from './builds';
import { scheduleGear, shop } from './run';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Average gold of the chests of one floor at depth d (see economy.test.ts). */
const chestGold = (d: number): number => (CHEST_RULE.goldMin + CHEST_RULE.goldMax) / 2 + ((CHEST_RULE.goldPerDepthMin + CHEST_RULE.goldPerDepthMax) / 2) * d;

const bonusOf = (id: string | undefined): number => (id ? getItem(id)?.magicBonus ?? 0 : 0);

/**
 * Hub visits 1..19 with the average gold of the floors, buying as the real hub does. A hero has what the schedule gives
 * when its Armor Class and the +N of its weapon, bow and shield are at least those of the scheduled hero of the same kit.
 */
function play(kit: string): { depth: number; ok: boolean; have: string; want: string; gold: number; ac: number }[] {
  const start = createCharacter(heroBuild(kit, 'human', kit === 'c' ? undefined : 'defense'));
  let pc: PlayerCharacter = start;
  let ref: PlayerCharacter = start;
  const rows = [];
  for (let cleared = 1; cleared <= 19; cleared++) {
    pc = longRest({ ...pc, gold: pc.gold + floorReward(cleared) + chestGold(cleared) });
    while (pc.level < cleared + 1) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
    pc = shop(pc, cleared + 1);
    while (ref.level < cleared + 1) ref = applyLevelUp(ref, suggestedLevelChoices(ref));
    ref = scheduleGear(ref);
    const lacks: string[] = [];
    if (computeAc(pc) < computeAc(ref)) lacks.push(`AC ${computeAc(pc)} < ${computeAc(ref)}`);
    // (The Archer's second scimitar is left out: the shop sells one of an item, and a +N pair would need two copies.)
    for (const slot of ['mainHand', 'ranged', 'offHand'] as const) {
      if (slot === 'offHand' && getItem(ref.equipped.offHand ?? '')?.kind !== 'shield') continue;
      if (ref.equipped[slot] && bonusOf(pc.equipped[slot]) < bonusOf(ref.equipped[slot])) lacks.push(`${slot} ${pc.equipped[slot]} < ${ref.equipped[slot]}`);
    }
    rows.push({ depth: cleared + 1, ok: lacks.length === 0, have: JSON.stringify(pc.equipped), want: lacks.join('; '), gold: Math.round(pc.gold), ac: computeAc(pc) });
  }
  return rows;
}

describe('the shop delivers the gear schedule', () => {
  for (const kit of ['a', 'b', 'c']) {
    it(`kit ${kit}: at every hub the scheduled gear for the next floor has been bought`, () => {
      const rows = play(kit);
      if (env['SHOP_REPORT']) for (const r of rows) console.log(`SHOP kit ${kit} floor ${r.depth} ok ${r.ok} gold ${r.gold} ac ${r.ac} lacks ${r.want} have ${r.have}`);
      for (const r of rows) expect(r.ok, `floor ${r.depth}: lacks ${r.want}; have ${r.have}`).toBe(true);
    });
  }
});

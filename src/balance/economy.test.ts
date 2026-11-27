import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ITEMS } from '../data/items';
import { CHEST_RULE, ECONOMY, floorReward, resetItemCatalog, setItemCatalog } from '../rules';

/**
 * Economy check (analytic, no simulation): the gold a player collects up to floor N (the hub reward of every floor cleared
 * plus about one chest per floor at its average) against the cost of the gear schedule of `scheduleGear` (splint at 3, plate
 * at 5, +1 armor from 5, +2 from 10, +3 from 16; +1 weapons from 4, +2 from 9, +3 from 15; a +1 shield from 8, +2 from 13),
 * priced at the shop's prices (each item bought once when first owned). Potions are not counted: they come from chests.
 */
beforeAll(() => setItemCatalog(ITEMS));
afterAll(() => resetItemCatalog());

const cost = (id: string): number => ITEMS.find((i) => i.id === id)?.cost ?? 0;
const at = (level: number, steps: [number, number][]): number => steps.reduce((v, [from, n]) => (level >= from ? n : v), 0);
const magic = (base: string, n: number): string => (n > 0 && ITEMS.some((i) => i.id === `${base}_plus${n}`) ? `${base}_plus${n}` : base);

/** Items the schedule has the hero own at `level` (armor, main weapon, shield). */
function owned(level: number): string[] {
  const armor = level >= 5 ? 'plate' : level >= 3 ? 'splint' : 'chain_mail';
  return [magic(armor, at(level, [[5, 1], [10, 2], [16, 3]])), magic('longsword', at(level, [[4, 1], [9, 2], [15, 3]])), magic('shield', at(level, [[8, 1], [13, 2]]))];
}

export function curves(): { floor: number; gold: number; gear: number }[] {
  const seen = new Set<string>();
  let gear = 0;
  let gold = 0;
  const out: { floor: number; gold: number; gear: number }[] = [];
  for (let floor = 1; floor <= 20; floor++) {
    // Entering floor N+1 the hero has cleared N floors and is level N+1: the hub shops with the gold of floors 1..N.
    gold += floorReward(floor) + (CHEST_RULE.goldMin + CHEST_RULE.goldMax) / 2 + ((CHEST_RULE.goldPerDepthMin + CHEST_RULE.goldPerDepthMax) / 2) * floor;
    for (const id of owned(floor + 1)) {
      if (!seen.has(id)) {
        seen.add(id);
        gear += cost(id);
      }
    }
    out.push({ floor, gold, gear });
  }
  return out;
}

describe('economy', () => {
  it('cumulative gold covers the scheduled gear with about 25% to spare at the key hubs', () => {
    const rows = curves();
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.['ECONOMY_REPORT']) {
      for (const r of rows) console.log(`ECON floor ${r.floor} gold ${Math.round(r.gold)} gear ${Math.round(r.gear)} ratio ${(r.gold / Math.max(1, r.gear)).toFixed(2)}`);
    }
    for (const r of rows) {
      // Spend on potions and the rest is not counted, so the bar is that the gear alone is affordable with spare.
      expect(r.gold, `floor ${r.floor}: gold ${r.gold} vs gear ${r.gear}`).toBeGreaterThanOrEqual(r.gear * 1.25);
    }
    expect(ECONOMY.rewardBase).toBeGreaterThan(0);
  });
});

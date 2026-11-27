import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ITEMS } from '../data/items';
import { BOSS_CHEST_FACTOR, CHEST_GRADES, CHEST_RULE, ITEM_GATING, chestLoot, type ChestGrade } from './character';
import { resetItemCatalog, setItemCatalog } from './items';

beforeAll(() => setItemCatalog(ITEMS));
afterAll(() => resetItemCatalog());

const N = 3000;
const mean = (depth: number, opts: Parameters<typeof chestLoot>[2]): { gold: number; potions: number; magic: number } => {
  let gold = 0;
  let potions = 0;
  let magic = 0;
  for (let i = 0; i < N; i++) {
    const r = chestLoot(depth, new Rng(i + 1), opts);
    gold += r.gold;
    for (const s of r.items) {
      if (s.itemId === 'potion_healing') potions += s.quantity;
      else magic += s.quantity;
    }
  }
  return { gold: gold / N, potions: potions / N, magic: magic / N };
};
const baseGold = (depth: number): number => (CHEST_RULE.goldMin + CHEST_RULE.goldMax) / 2 + ((CHEST_RULE.goldPerDepthMin + CHEST_RULE.goldPerDepthMax) / 2) * depth;

describe('chestLoot with grades, boss chests and several chests per floor', () => {
  it('with no options it is the instant-open chest of before (same draws, same result as an explicit silver chest)', () => {
    for (let i = 0; i < 200; i++) {
      for (const depth of [1, 5, 12]) expect(chestLoot(depth, new Rng(i))).toEqual(chestLoot(depth, new Rng(i), { grade: 'silver' }));
    }
  });

  it('the grade ladder: gold = full, silver 75%, bronze 50%, none 25% of the gold; none holds no item', () => {
    const depth = 6;
    const g = (grade: ChestGrade): number => mean(depth, { grade }).gold;
    const gold = g('gold');
    expect(g('silver') / gold).toBeCloseTo(0.75, 1);
    expect(g('bronze') / gold).toBeCloseTo(0.5, 1);
    expect(g('none') / gold).toBeCloseTo(0.25, 1);
    expect(gold).toBeGreaterThan(g('silver'));
    for (let i = 0; i < 300; i++) expect(chestLoot(depth, new Rng(i), { grade: 'none' }).items).toEqual([]);
    expect(CHEST_GRADES.silver.gold).toBe(1);
    // Silver and gold always hold a potion; bronze sometimes.
    for (let i = 0; i < 300; i++) expect(chestLoot(depth, new Rng(i), { grade: 'gold' }).items.some((s) => s.itemId === 'potion_healing')).toBe(true);
    const bronzePotions = mean(depth, { grade: 'bronze' }).potions;
    expect(bronzePotions).toBeGreaterThan(0.3);
    expect(bronzePotions).toBeLessThan(0.9);
    // Magic gear: never on floors 1-3, none for a skipped lock, more for a gold grade.
    expect(mean(2, { grade: 'gold' }).magic).toBe(0);
    expect(mean(8, { grade: 'none' }).magic).toBe(0);
    expect(mean(8, { grade: 'gold' }).magic).toBeGreaterThan(mean(8, { grade: 'bronze' }).magic);
  });

  it('chestsOnFloor divides the gold: a floor at silver pays what one chest used to, whatever the count', () => {
    for (const depth of [1, 5, 10, 20]) {
      const one = mean(depth, {}).gold;
      for (const n of [1, 3, 4, 6]) {
        const ordinary = mean(depth, { chestsOnFloor: n }).gold;
        const boss = mean(depth, { chestsOnFloor: n, boss: true }).gold;
        const total = ordinary * n + boss;
        expect(total / one, `depth ${depth}, ${n} chests`).toBeGreaterThan(0.97);
        expect(total / one, `depth ${depth}, ${n} chests`).toBeLessThan(1.03);
        expect(boss / ordinary).toBeCloseTo(BOSS_CHEST_FACTOR, 1);
      }
      expect(one).toBeCloseTo(baseGold(depth), -1);
    }
  });

  it('the boss chest: about 2.5 chests of gold, a potion and often a second, and usually magic gear from the gated depth', () => {
    const depth = ITEM_GATING.chestMagicMinDepth;
    const ordinary = mean(depth, { chestsOnFloor: 4 });
    const boss = mean(depth, { chestsOnFloor: 4, boss: true });
    expect(boss.gold / ordinary.gold).toBeCloseTo(2.5, 1);
    expect(boss.potions).toBeGreaterThan(1.3);
    expect(boss.potions).toBeLessThan(1.7);
    for (let i = 0; i < 100; i++) expect(chestLoot(depth, new Rng(i), { boss: true, grade: 'gold' }).items.find((s) => s.itemId === 'potion_healing')?.quantity).toBe(2);
    // Boss chests are where the powerful items are: most hold a find at silver, every one at gold.
    expect(boss.magic).toBeGreaterThan(0.65);
    expect(boss.magic).toBeLessThan(0.85);
    expect(mean(depth, { chestsOnFloor: 4, boss: true, grade: 'gold' }).magic).toBe(1);
    expect(mean(3, { boss: true }).magic).toBe(0);
    // Deeper boss chests pay out of the deeper tier (+2 from the shop's second tier, +3 from the third).
    const tier = (depth: number): number[] => {
      const seen = new Set<number>();
      for (let i = 0; i < 600; i++) for (const s of chestLoot(depth, new Rng(i), { boss: true }).items) {
        const b = ITEMS.find((x) => x.id === s.itemId)?.magicBonus;
        if (b) seen.add(b);
      }
      return [...seen];
    };
    expect(tier(9)).toEqual([2]);
    expect(tier(16)).toEqual([3]);
  });

  it('is deterministic per seed for every option', () => {
    for (const grade of ['gold', 'silver', 'bronze', 'none'] as ChestGrade[]) {
      for (const boss of [false, true]) {
        for (let i = 0; i < 50; i++) expect(chestLoot(9, new Rng(i), { grade, boss, chestsOnFloor: 4 })).toEqual(chestLoot(9, new Rng(i), { grade, boss, chestsOnFloor: 4 }));
      }
    }
  });

  it('REPORT expected treasure per floor, before and after (4 chests and the boss chest)', () => {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    if (!env['CHEST_REPORT']) return;
    for (const depth of [1, 3, 5, 8, 12, 16, 20]) {
      const before = mean(depth, {});
      const ord = mean(depth, { chestsOnFloor: 4 });
      const boss = mean(depth, { chestsOnFloor: 4, boss: true });
      const allGold = mean(depth, { chestsOnFloor: 4, grade: 'gold' });
      const allGoldBoss = mean(depth, { chestsOnFloor: 4, grade: 'gold', boss: true });
      console.log(`CHEST depth ${depth}: before gold ${before.gold.toFixed(0)}, potions ${before.potions.toFixed(2)}, magic ${before.magic.toFixed(2)} | after (silver) gold ${(ord.gold * 4 + boss.gold).toFixed(0)}, potions ${(ord.potions * 4 + boss.potions).toFixed(2)}, magic ${(ord.magic * 4 + boss.magic).toFixed(2)} | all gold grade ${(allGold.gold * 4 + allGoldBoss.gold).toFixed(0)}`);
    }
  });
});

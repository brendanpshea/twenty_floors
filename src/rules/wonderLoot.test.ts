import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ITEM_GATING, chestLoot, floorReward, isWonder, shopStock, wondersAt } from './character';
import { getItem, itemCatalog } from './items';

describe('magic items in the real catalog, shops and chests', () => {
  it('the default catalog holds the data items and the magic items', () => {
    expect(itemCatalog().length).toBeGreaterThan(450);
    expect(getItem('mace_plus1')).toBeDefined();
    expect(itemCatalog().filter(isWonder).length).toBeGreaterThan(150);
  });

  it('nothing of their own is sold or found before the first gated depth, and rarities unlock in order', () => {
    for (const d of [1, 2, 3]) {
      expect(wondersAt(d)).toEqual([]);
      expect(shopStock(d).some(isWonder)).toBe(false);
    }
    const rarities = (d: number): Set<string | undefined> => new Set(wondersAt(d).map((i) => i.rarity));
    expect([...rarities(4)]).toEqual(['uncommon']);
    expect(rarities(8).has('rare')).toBe(false);
    expect(rarities(9).has('rare')).toBe(true);
    expect(rarities(14).has('veryRare')).toBe(false);
    expect(rarities(15).has('veryRare')).toBe(true);
    for (const d of [4, 9, 15, 20]) expect(rarities(d).has('legendary')).toBe(false);
  });

  it('shops stock magic items from the gated depth, deterministically and within a price cap', () => {
    for (const d of [4, 9, 15]) {
      const mine = shopStock(d).filter(isWonder);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.length).toBeLessThanOrEqual(ITEM_GATING.shopWonderSlots);
      for (const i of mine) expect(i.cost).toBeLessThanOrEqual(floorReward(d) * ITEM_GATING.shopWonderCostFactor);
      expect(shopStock(d).map((i) => i.id)).toEqual(shopStock(d).map((i) => i.id));
    }
  });

  it('chests hold them from the gated depth, a boss chest from the top unlocked rarity', () => {
    const found = (depth: number, boss: boolean): string[] => {
      const out: string[] = [];
      for (let i = 0; i < 4000; i++) for (const s of chestLoot(depth, new Rng(i + 1), boss ? { boss: true, grade: 'gold' } : {}).items) if (isWonder(getItem(s.itemId) as never)) out.push(s.itemId);
      return out;
    };
    expect(found(3, true)).toEqual([]);
    expect(found(5, false).length).toBeGreaterThan(0);
    const boss = found(16, true);
    expect(boss.length).toBeGreaterThan(0);
    for (const id of boss) expect(getItem(id)?.rarity).toBe('veryRare');
    // The magic find rate itself is unchanged: wonders replace some of the +N finds, they do not add to them.
    let magic = 0;
    for (let i = 0; i < 4000; i++) if (chestLoot(5, new Rng(i + 1)).items.some((s) => s.itemId !== 'potion_healing')) magic++;
    expect(magic / 4000).toBeGreaterThan(0.08);
    expect(magic / 4000).toBeLessThan(0.16);
  });
});

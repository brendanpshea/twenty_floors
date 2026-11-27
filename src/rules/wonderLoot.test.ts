import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { ITEM_GATING, chestLoot, floorReward, isWonder, shopStock, wondersAt } from './character';
import { getItem, itemCatalog } from './items';
import { presetHero } from './testing/heroes';

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

  it('shops sell plain gear and consumables, never permanent magic, and keep the shelf short', () => {
    for (const preset of ['defender', 'great_weapon', 'archer'] as const) {
      for (const d of [1, 4, 9, 15, 20]) {
        const pc = presetHero(preset, d);
        const stock = shopStock(d, pc);
        expect(stock.some((i) => isWonder(i) || i.magicBonus), `${preset} ${d}`).toBe(false);
        for (const i of stock) expect(i.kind === 'consumable' || i.rarity === undefined || i.rarity === 'common', i.id).toBe(true);
        expect(stock.length, `${preset} ${d}`).toBeLessThanOrEqual(ITEM_GATING.shopMaxItems);
        const potions = stock.filter((i) => i.kind === 'consumable');
        expect(potions.filter((i) => i.consumable?.effect === 'heal').length).toBeLessThanOrEqual(ITEM_GATING.shopPotionKinds);
        const others = potions.filter((i) => i.consumable?.effect === 'timed');
        expect(others.length).toBeLessThanOrEqual(ITEM_GATING.shopElixirSlots);
        if (d < 4) expect(others.length).toBe(0);
        else expect(others.length).toBeGreaterThan(0);
        // Never a legendary potion, and never two of one family.
        expect(others.some((i) => i.rarity === 'legendary')).toBe(false);
        expect(others.filter((i) => i.id.startsWith('potion_of_resistance')).length).toBeLessThanOrEqual(1);
        expect(others.filter((i) => i.id.startsWith('potion_of_giant_strength')).length).toBeLessThanOrEqual(1);
        expect(shopStock(d, pc).map((i) => i.id)).toEqual(stock.map((i) => i.id));
      }
    }
  });

  it('with shopScheduledMagic on the shop adds the +N version of what the hero carries, and nothing else magic', () => {
    ITEM_GATING.shopScheduledMagic = true;
    try {
      for (const d of [5, 10, 16]) {
        const pc = presetHero('defender', d);
        const magic = shopStock(d, pc).filter((i) => i.magicBonus);
        expect(magic.length).toBeGreaterThan(0);
        expect(shopStock(d, pc).some(isWonder)).toBe(false);
        const carried = Object.values(pc.equipped).map((id) => getItem(id as string)?.baseId ?? id);
        for (const i of magic) expect(carried.includes(i.baseId as string) || i.kind === 'armor', i.id).toBe(true);
      }
    } finally {
      ITEM_GATING.shopScheduledMagic = false;
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

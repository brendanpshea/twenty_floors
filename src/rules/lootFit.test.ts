import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ItemDef } from '../core/types';
import { chestLoot, equipItem } from './character';
import { compareItem } from './compare';
import { getItem, itemCatalog, requireItem } from './items';
import { lootFit, lootFitFor } from './lootFit';
import { presetHero, withItems } from './testing/heroes';

const item = (id: string): ItemDef => requireItem(id);
const byName = (name: string): ItemDef => itemCatalog().find((i) => i.name === name) as ItemDef;

/** Magic finds of 3000 gold-grade boss chests at a depth, with or without the hero's fit. */
function finds(depth: number, fit?: (i: ItemDef) => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 3000; i++) {
    for (const s of chestLoot(depth, new Rng(i + 1), { boss: true, grade: 'gold', ...(fit ? { fit } : {}) }).items) {
      if (s.itemId !== 'potion_healing') out.push(s.itemId);
    }
  }
  return out;
}

describe('lootFit: how well a find suits the hero', () => {
  it('a weapon the hero fights with outweighs one of another build, and nothing weighs zero', () => {
    const defender = presetHero('defender');
    expect(lootFit(defender, item('longsword_plus1'))).toBeGreaterThan(lootFit(defender, item('greataxe_plus1')) * 5);
    expect(lootFit(defender, item('shield_plus1'))).toBeGreaterThan(lootFit(defender, item('longbow_plus1')) * 2);
    const archer = presetHero('archer');
    expect(lootFit(archer, item('longbow_plus1'))).toBeGreaterThan(lootFit(archer, item('greataxe_plus1')) * 5);
    const great = presetHero('great_weapon');
    expect(lootFit(great, item('shield_plus1'))).toBeLessThan(lootFit(great, item(`${great.equipped.mainHand}_plus1`)));
    for (const i of itemCatalog()) if (i.kind !== 'consumable') expect(lootFit(defender, i), i.id).toBeGreaterThan(0);
  });

  it('something already owned is nearly worthless', () => {
    const pc = equipItem(withItems(presetHero('defender'), 'longsword_plus1'), 'longsword_plus1');
    expect(lootFit(pc, item('longsword_plus1'))).toBeLessThan(0.2);
    expect(lootFit(presetHero('defender'), item('longsword_plus1'))).toBeGreaterThan(10);
  });

  it('a worn item counts only for what it does for this hero', () => {
    const defender = presetHero('defender');
    // Bracers of Defense need bare arms and no shield; a Strength item helps a Strength build, an Intelligence one does not.
    expect(lootFit(defender, byName('Bracers of Defense'))).toBeLessThan(1);
    expect(lootFit(defender, byName('Gauntlets of Ogre Power'))).toBeGreaterThan(lootFit(defender, byName('Headband of Intellect')) * 3);
    expect(lootFit(defender, byName('Ring of Protection'))).toBeGreaterThan(5);
    // Gauntlets that set Strength to 19 do nothing for a hero already there.
    const strong = presetHero('defender', 20);
    strong.build.baseAbilities = { ...strong.build.baseAbilities, str: 20 };
    expect(lootFit(strong, byName('Gauntlets of Ogre Power'))).toBeLessThan(1);
  });
});

describe('chestLoot with a fit', () => {
  it('changes only which find is drawn: the same chests hold a find, with the same gold and potions', () => {
    const fit = lootFitFor(presetHero('archer'));
    for (let i = 0; i < 400; i++) {
      for (const depth of [3, 6, 12, 18]) {
        const plain = chestLoot(depth, new Rng(i), { boss: i % 2 === 0, chestsOnFloor: 3 });
        const fitted = chestLoot(depth, new Rng(i), { boss: i % 2 === 0, chestsOnFloor: 3, fit });
        expect(fitted.gold).toBe(plain.gold);
        expect(fitted.items.length).toBe(plain.items.length);
        expect(fitted.items.find((s) => s.itemId === 'potion_healing')).toEqual(plain.items.find((s) => s.itemId === 'potion_healing'));
      }
    }
  });

  it('leans toward upgrades for the build without closing off the rest', () => {
    for (const preset of ['defender', 'great_weapon', 'archer'] as const) {
      const pc = presetHero(preset);
      const share = (ids: string[]): number => ids.filter((id) => compareItem(pc, id)?.verdict === 'upgrade').length / ids.length;
      const even = finds(6);
      const fitted = finds(6, lootFitFor(pc));
      expect(fitted.length).toBe(even.length);
      expect(share(fitted), preset).toBeGreaterThan(0.7);
      expect(share(fitted), preset).toBeGreaterThan(share(even) + 0.25);
      // Still a draw, not a filter: plenty of different items turn up, some of them not upgrades.
      expect(new Set(fitted).size).toBeGreaterThan(25);
      expect(share(fitted)).toBeLessThan(1);
    }
  });

  it('the hero\'s own weapon kinds come up most', () => {
    const archer = presetHero('archer');
    const fitted = finds(6, lootFitFor(archer));
    const count = (id: string): number => fitted.filter((x) => x === id).length;
    expect(count('longbow_plus1')).toBeGreaterThan(count('greataxe_plus1') * 5);
    expect(getItem('longbow_plus1')).toBeDefined();
  });
});

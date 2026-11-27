import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUICK_SLOTS } from '../core/types';
import { Rng } from '../core/rng';
import type { Creature, ItemDef, PlayerCharacter } from '../core/types';
import { createCharacter, quickSlotIds, setQuickSlot, toCreature } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { addTimedEffect } from './passives';
import { flightPath, planPush } from './terrain';
import { FIXTURE_ITEMS, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const potion = (id: string, dice: string): ItemDef => ({ id, name: id, kind: 'consumable', description: id, cost: 10, consumable: { effect: 'heal', dice } });
const POTIONS = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => potion(id, `${i + 1}d4`));

beforeAll(() => setItemCatalog([...FIXTURE_ITEMS, ...POTIONS]));
afterAll(() => resetItemCatalog());

function withPotions(ids: string[]): PlayerCharacter {
  const pc = createCharacter(makeBuild());
  return { ...pc, inventory: [...pc.inventory.filter((s) => !s.itemId.startsWith('potion')), ...ids.map((itemId) => ({ itemId, quantity: 3 }))] };
}

describe('quick slots', () => {
  it('four stacks of consumables are usable in a fight, the rest wait in the pack', () => {
    const pc = withPotions(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(quickSlotIds(pc)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const c = toCreature(pc, { x: 1, y: 1 });
    expect(c.actions.filter((a) => a.id.startsWith('drink_')).map((a) => a.id)).toEqual(['drink_p1', 'drink_p2', 'drink_p3', 'drink_p4']);
    expect(c.resources['item:p1']?.current).toBe(3);
    expect(QUICK_SLOTS).toBe(4);
  });

  it('a slot can be set to another stack or emptied', () => {
    const pc = withPotions(['p1', 'p2', 'p3', 'p4', 'p5']);
    const swapped = setQuickSlot(pc, 1, 'p5');
    expect(quickSlotIds(swapped)).toEqual(['p1', 'p5', 'p3', 'p4']);
    expect(toCreature(swapped, { x: 1, y: 1 }).actions.some((a) => a.id === 'drink_p2')).toBe(false);
    expect(quickSlotIds(setQuickSlot(swapped, 0, null))).toEqual(['p5', 'p3', 'p4']);
    expect(() => setQuickSlot(pc, 4, 'p1')).toThrow();
    expect(() => setQuickSlot(pc, 0, 'longsword')).toThrow();
  });
});

describe('narrow flight', () => {
  const chasm = Array.from({ length: 5 }, (_, i) => ({ x: 5, y: 1 + i }));
  const nav = createOpenRoomNav(12, 8, { chasms: chasm });
  const flyer = (): PlayerCharacter => addTimedEffect(createCharacter(makeBuild()), { id: 'fly', name: 'Flight', passives: [], fightsLeft: 1, hover: true });

  it('crosses a chasm and lands on the far side, which a walker cannot', () => {
    const hero = toCreature(flyer(), { x: 4, y: 3 });
    hero.speed = 6;
    const foe = instantiateMonster(mon({ id: 'f', name: 'f', hp: 50, ac: 10 }), 'f', { x: 10, y: 6 });
    const combat = createCombat([hero, foe], nav, new Rng(1), {});
    combat.begin();
    for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'move', path: [{ x: 5, y: 3 }, { x: 6, y: 3 }] });
    expect(hero.pos).toEqual({ x: 6, y: 3 });
    // It may not stop over the pit.
    expect(() => combat.execute({ type: 'move', path: [{ x: 5, y: 3 }] })).toThrow();
    // A walker cannot cross.
    const walker = toCreature(createCharacter(makeBuild()), { x: 4, y: 3 });
    const c2 = createCombat([walker, instantiateMonster(mon({ id: 'g', name: 'g' }), 'g', { x: 10, y: 6 })], nav, new Rng(1), {});
    c2.begin();
    for (let i = 0; i < 10 && c2.activeId !== 'player'; i++) c2.execute({ type: 'endTurn' });
    expect(() => c2.execute({ type: 'move', path: [{ x: 5, y: 3 }, { x: 6, y: 3 }] })).toThrow();
  });

  it('cannot be shoved into the pit and flightPath finds the way over', () => {
    const c: Creature = toCreature(flyer(), { x: 4, y: 3 });
    expect(c.resources['_ignore_fall']).toBeDefined();
    expect(planPush(nav, () => false, { x: 4, y: 3 }, 1, 0, 2).path.length).toBeGreaterThan(0);
    expect(planPush(nav, () => false, { x: 4, y: 3 }, 1, 0, 2, { ignore: new Set(['fall', 'lava']) }).path).toEqual([]);
    const over = flightPath(nav, { x: 4, y: 3 }, { x: 6, y: 3 }, 6) ?? [];
    expect(over).toHaveLength(2);
    expect(over[1]).toEqual({ x: 6, y: 3 });
    expect(over[0]?.x).toBe(5);
    expect(flightPath(nav, { x: 4, y: 3 }, { x: 5, y: 3 }, 6)).toBeNull();
    expect(flightPath(nav, { x: 4, y: 3 }, { x: 6, y: 3 }, 1)).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemDef, PlayerCharacter } from '../core/types';
import { addTimedEffect } from './passives';
import { attuneItem, createCharacter, equipItem, longRest, syncFromCreature, toCreature, useConsumable } from './character';
import { createCombat } from './combat';
import { hubAttunement, hubItemNotes, hubQuickSlots, timedView } from './hubNotes';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { Rng } from '../core/rng';
import { FIXTURE_ITEMS, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const ITEMS: ItemDef[] = [
  { id: 'cloak_x', name: 'Cloak X', kind: 'wondrous', description: '', cost: 100, slot: 'cloak', attunement: true, passives: [{ type: 'acBonus', amount: 1 }, { type: 'resistance', damageType: 'fire' }] },
  { id: 'ring_y', name: 'Ring Y', kind: 'wondrous', description: '', cost: 100, slot: 'ring', passives: [{ type: 'saveBonus', amount: 1 }] },
  { id: 'wand_z', name: 'Wand Z', kind: 'wondrous', description: '', cost: 100, passives: [{ type: 'castSpell', spellId: 'magic_missile', charges: 3 }] },
  { id: 'boots_f', name: 'Boots F', kind: 'wondrous', description: '', cost: 100, slot: 'feet', passives: [{ type: 'flight' }] },
  { id: 'potion_fly', name: 'Potion of Flying', kind: 'consumable', description: '', cost: 100, consumable: { effect: 'timed', passives: [], fights: 3, hover: true } },
  { id: 'potion_hero', name: 'Potion of Heroism', kind: 'consumable', description: '', cost: 100, consumable: { effect: 'timed', passives: [{ type: 'acBonus', amount: 2 }], fights: 1 } },
  { id: 'potion_h', name: 'Potion H', kind: 'consumable', description: '', cost: 10, consumable: { effect: 'heal', dice: '2d4+2' } },
];
beforeAll(() => setItemCatalog([...FIXTURE_ITEMS, ...ITEMS]));
afterAll(() => resetItemCatalog());

const own = (...ids: string[]): PlayerCharacter => {
  const pc = createCharacter(makeBuild());
  return { ...pc, inventory: [...pc.inventory, ...ids.map((itemId) => ({ itemId, quantity: 1 }))] };
};

describe('hub item notes', () => {
  it('describes effects, attunement, equip state and comparisons per owned item', () => {
    const pc = own('cloak_x', 'ring_y', 'wand_z', 'potion_h');
    const n = hubItemNotes(pc);
    expect(n['cloak_x']).toMatchObject({ canEquip: true, needsAttunement: true, attuned: false, canAttune: true, inert: true, quickable: false });
    expect(n['cloak_x']?.effects).toEqual(['+1 to AC', 'Resistance to fire damage']);
    expect(n['cloak_x']?.compare?.verdict).toBe('upgrade');
    expect(n['ring_y']).toMatchObject({ canEquip: true, needsAttunement: false, inert: false });
    expect(n['wand_z']?.effects).toEqual(['Cast Magic Missile, 3 charges per long rest']);
    expect(n['wand_z']?.canEquip).toBe(false);
    expect(n['wand_z']?.reason).toMatch(/pack/);
    expect(n['potion_h']).toMatchObject({ quickable: true, canEquip: false });
    const worn = equipItem(pc, 'cloak_x');
    const w = hubItemNotes(worn)['cloak_x'];
    expect(w).toMatchObject({ wornIn: 'cloak', attuned: true, inert: false, canEquip: false });
    expect(hubAttunement(worn)).toEqual({ used: 1, limit: 3 });
    expect(hubAttunement(attuneItem(own('cloak_x'), 'cloak_x'))).toEqual({ used: 1, limit: 3 });
  });

  it('shows the four quick slots with stack sizes', () => {
    const pc = own('potion_h', 'potion_fly');
    const slots = hubQuickSlots(pc);
    expect(slots).toHaveLength(4);
    expect(slots.filter((s) => s !== null).map((s) => s?.itemId)).toContain('potion_h');
    expect(slots[3]).toBeNull();
  });
});

describe('timed consumables and the flight passive', () => {
  it('a flight item hovers; a timed potion is used outside a fight and runs down', () => {
    const boots = toCreature(equipItem(own('boots_f'), 'boots_f'), { x: 1, y: 1 });
    expect(boots.resources['_hover']).toBeDefined();
    let pc = useConsumable(own('potion_hero'), 'potion_hero', new Rng(1)).pc;
    expect(pc.inventory.some((s) => s.itemId === 'potion_hero')).toBe(false);
    expect(timedView(pc)).toEqual([{ name: 'Potion of Heroism', fightsLeft: 1, detail: '+2 to AC' }]);
    expect(toCreature(pc, { x: 1, y: 1 }).ac).toBe(toCreature(own(), { x: 1, y: 1 }).ac + 2);
    pc = syncFromCreature(pc, toCreature(pc, { x: 1, y: 1 }));
    expect(timedView(pc)).toEqual([]);
    pc = useConsumable(addTimedEffect(own('potion_fly'), { id: 'a', name: 'a', passives: [], fightsLeft: 1 }), 'potion_fly', new Rng(1)).pc;
    expect(timedView(pc).map((t) => t.name).sort()).toEqual(['Potion of Flying', 'a']);
  });

  it('a use_ action exists for a timed stack in a quick slot, applies in the fight, and carries over', () => {
    const pc = own('potion_fly', 'potion_hero');
    const hero = toCreature(pc, { x: 3, y: 3 });
    expect(hero.actions.map((a) => a.id)).toContain('use_potion_hero');
    const foe = instantiateMonster(mon({ id: 'f', name: 'f', hp: 50, ac: 10 }), 'f', { x: 10, y: 6 });
    const combat = createCombat([hero, foe], createOpenRoomNav(12, 8), new Rng(1), {});
    combat.begin();
    for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    const ac = hero.ac;
    combat.execute({ type: 'action', actionId: 'use_potion_hero' });
    expect(hero.ac).toBe(ac + 2);
    for (let i = 0; i < 10 && (combat.activeId !== 'player' || combat.turn.bonusUsed); i++) combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'action', actionId: 'use_potion_fly' });
    expect(hero.resources['_hover']).toBeDefined();
    const after = longRest(syncFromCreature(pc, hero));
    // Heroism lasted this fight only; flying (3 fights) has 2 left.
    expect(timedView(after).map((t) => `${t.name}:${t.fightsLeft}`)).toEqual(['Potion of Flying:2']);
  });
});

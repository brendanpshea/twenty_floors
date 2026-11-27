import { describe, expect, it } from 'vitest';
import { getItem } from '../rules';
import { itemCatalog } from '../rules/items';
import { SAVE_KEY } from './deps';
import { FloorSession } from './floorSession';
import { HubFlow } from './hubFlow';
import { quickCharacter } from './quickBuild';
import { parseSave, runFromSave, writeSave } from './save';
import { makeHarness } from './testing/fakes';

/** A hero carrying a wondrous item that needs attunement and a worn slot. */
function heroWithWonder() {
  const pc = quickCharacter(10);
  let id = '';
  // Magic items are chest treasure, not shop stock: take one from the catalog.
  id = itemCatalog().find((i) => i.attunement === true && i.slot === 'neck' && i.cost > 0)?.id ?? '';
  expect(id, 'no attuned neck item in the catalog').not.toBe('');
  pc.inventory.push({ itemId: id, quantity: 1 });
  pc.gold = 9000;
  return { pc, id };
}

describe('the hub and magic items', () => {
  it('the model carries item notes, attunement and the quick slots', () => {
    const h = makeHarness();
    const { pc, id } = heroWithWonder();
    const hub = new HubFlow(pc, 10, h.audio, 1);
    const m = hub.model();
    expect(m.itemNotes?.[id]?.needsAttunement).toBe(true);
    expect(m.itemNotes?.[id]?.inert).toBe(true);
    expect(m.attunement).toEqual({ used: 0, limit: 3 });
    expect(m.quickSlots).toHaveLength(4);
    expect(m.quickSlots?.some((q) => q?.itemId === 'potion_healing')).toBe(true);
  });

  it('equip, attune, unattune and unequip go through the rules', () => {
    const h = makeHarness();
    const { pc, id } = heroWithWonder();
    const hub = new HubFlow(pc, 10, h.audio, 1);
    hub.handle({ type: 'equip', itemId: id });
    expect(hub.pc.worn?.neck).toBe(id);
    let m = hub.handle({ type: 'attune', itemId: id });
    expect(m.attunement?.used).toBe(1);
    expect(m.itemNotes?.[id]?.attuned).toBe(true);
    expect(m.itemNotes?.[id]?.inert).toBe(false);
    m = hub.handle({ type: 'unattune', itemId: id });
    expect(m.attunement?.used).toBe(0);
    hub.handle({ type: 'attune', itemId: id });
    m = hub.handle({ type: 'unequip', itemId: id });
    expect(hub.pc.worn?.neck).toBeUndefined();
    // Taking it off also ends the attunement.
    expect(m.attunement?.used).toBe(0);
  });

  it('a rejected item action is reported and changes nothing', () => {
    const h = makeHarness();
    const said: string[] = [];
    const hub = new HubFlow(quickCharacter(3), 3, h.audio, 1, (t) => said.push(t));
    const before = JSON.stringify(hub.pc);
    hub.handle({ type: 'attune', itemId: 'longsword' });
    expect(said.length).toBeGreaterThan(0);
    expect(JSON.stringify(hub.pc)).toBe(before);
  });

  it('setQuickSlot puts a consumable in a slot, or clears it', () => {
    const h = makeHarness();
    const pc = quickCharacter(5);
    pc.inventory.push({ itemId: 'potion_greater_healing', quantity: 2 });
    const hub = new HubFlow(pc, 5, h.audio, 1);
    let m = hub.handle({ type: 'setQuickSlot', slot: 1, itemId: 'potion_greater_healing' });
    expect(m.quickSlots?.[1]).toEqual({ itemId: 'potion_greater_healing', count: 2 });
    m = hub.handle({ type: 'setQuickSlot', slot: 1, itemId: null });
    expect(m.quickSlots?.[1]).toBeNull();
    // A weapon is not a consumable: refused.
    const said: string[] = [];
    const hub2 = new HubFlow(quickCharacter(5), 5, h.audio, 1, (t) => said.push(t));
    hub2.handle({ type: 'setQuickSlot', slot: 0, itemId: 'longsword' });
    expect(said.length).toBe(1);
  });

  it('the bot, with gold to spare, buys a wondrous upgrade and attunes it', () => {
    const h = makeHarness();
    const pc = quickCharacter(12);
    pc.gold = 20000;
    const hub = new HubFlow(pc, 12, h.audio, 1);
    const { bought } = hub.autoShop();
    const wondrous = bought.filter((id) => getItem(id)?.attunement === true);
    // Whatever it bought that needs attunement, it attuned (the limit allowing).
    for (const id of wondrous.slice(0, 3)) expect(hub.pc.attuned ?? []).toContain(id);
    expect(hub.pc.gold).toBeLessThan(20000);
  });
});

describe('timed effects and quick slots persist', () => {
  it('timed and quick are saved with the character and come back', () => {
    const h = makeHarness();
    const pc = quickCharacter(5);
    pc.timed = [{ id: 'potion_of_flying', name: 'Potion of Flying', passives: [{ type: 'flight' }], fightsLeft: 2, hover: true }];
    pc.quick = ['potion_healing'];
    writeSave(h.storage, { runSeed: 1, depth: 6, pc, shortRestsLeft: 2 });
    const run = runFromSave(parseSave(h.storage.get(SAVE_KEY)) as NonNullable<ReturnType<typeof parseSave>>);
    expect(run.pc.timed).toEqual(pc.timed);
    expect(run.pc.quick).toEqual(['potion_healing']);
  });

  it('a timed potion drunk out of combat starts its effect, shows in the HUD and goes down in the pack', async () => {
    const h = makeHarness({ reveal: true, peace: true });
    const pc = quickCharacter(5);
    pc.inventory.push({ itemId: 'potion_of_flying', quantity: 1 });
    pc.quick = ['potion_healing', 'potion_of_flying'];
    const s = new FloorSession(h.deps, { runSeed: 3, depth: 5, pc, shortRestsLeft: 2 }, 1);
    await s.enter();
    // Listed with its stack count, and drinkable at full health (it needs no wound).
    const action = h.ui.hud?.actions.find((a) => a.id === 'use_potion_of_flying');
    expect(action?.name).toBe('Potion of Flying ×1');
    expect(action?.enabled).toBe(true);
    s.handleIntent({ type: 'selectAction', actionId: 'use_potion_of_flying' });
    expect(s.state.pc.timed?.map((t) => t.id)).toContain('potion_of_flying');
    expect(s.state.pc.inventory.some((x) => x.itemId === 'potion_of_flying')).toBe(false);
    expect(h.ui.hud?.player.timed?.[0]?.name).toBe('Potion of Flying');
    expect(h.ui.hud?.player.timed?.[0]?.fightsLeft).toBeGreaterThan(0);
  });

  it('a healing potion in the explore list is named with its count and still needs a wound', async () => {
    const h = makeHarness({ reveal: true, peace: true });
    const s = new FloorSession(h.deps, { runSeed: 3, depth: 2, pc: quickCharacter(2), shortRestsLeft: 2 }, 1);
    await s.enter();
    const potion = h.ui.hud?.actions.find((a) => a.id === 'drink_potion_healing');
    expect(potion?.name).toMatch(/^Potion of Healing ×\d+$/);
    expect(potion?.enabled).toBe(false);
  });
});

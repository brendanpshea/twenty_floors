import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, Command, Creature, ItemDef, PlayerCharacter } from '../core/types';
import { MAGIC_ITEMS } from '../data/magicItems';
import { addTimedEffect, timedEffects } from './passives';
import { createCharacter, equipItem, itemChargeKey, itemSpellActionId, longRest, syncFromCreature, toCreature, computeAc, attuneItem } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { getSpell } from './spells';
import { makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const casters = MAGIC_ITEMS.filter((i) => i.passives?.some((p) => p.type === 'castSpell'));

/** A hero carrying the item: worn in its slot (attuned when needed) or in the pack. */
function holder(item: ItemDef, level = 5): PlayerCharacter {
  let pc = createCharacter(makeBuild());
  pc = { ...pc, level, inventory: [...pc.inventory, { itemId: item.id, quantity: 1 }] };
  if (item.slot) pc = equipItem(pc, item.id);
  else if (item.attunement) pc = attuneItem(pc, item.id);
  return pc;
}

function foeAt(id: string, x: number, y: number): Creature {
  return instantiateMonster(mon({ id, name: id, hp: 400, ac: 10, abilities: { str: 1, dex: 1, con: 10, int: 10, wis: 10, cha: 10 } }), id, { x, y });
}

function commandFor(a: ActionDef, hero: Creature, foe: Creature): Command {
  if (a.targeting.kind === 'self') return { type: 'action', actionId: a.id };
  if (a.targeting.kind === 'point') return { type: 'action', actionId: a.id, point: { x: foe.pos.x, y: foe.pos.y } };
  return { type: 'action', actionId: a.id, targetId: a.heal ? hero.id : foe.id };
}

describe('wands, staffs and other items that grant spells', () => {
  it('every castSpell passive in the data names a spell in the spell list', () => {
    expect(casters.length).toBeGreaterThanOrEqual(8);
    for (const it of casters) for (const p of it.passives ?? []) if (p.type === 'castSpell') expect(getSpell(p.spellId), `${it.id}: ${p.spellId}`).toBeDefined();
  });

  it('grants one action per spell with charges as a long-rest pool, and none while the item does not work', () => {
    const wand = MAGIC_ITEMS.find((i) => i.id === 'wand_of_magic_missiles') as ItemDef;
    const c = toCreature(holder(wand), { x: 2, y: 2 });
    const a = c.actions.find((x) => x.id === itemSpellActionId(wand.id, 'magic_missile')) as ActionDef;
    expect(a).toBeDefined();
    expect(a.uses?.resource).toBe(itemChargeKey(wand.id, 'magic_missile'));
    expect(c.resources[itemChargeKey(wand.id, 'magic_missile')]).toMatchObject({ current: 5, max: 5, refresh: 'longRest' });
    // Not owned: nothing.
    expect(toCreature(createCharacter(makeBuild()), { x: 2, y: 2 }).actions.some((x) => x.id.startsWith('itemspell_'))).toBe(false);
    // A worn item that needs attunement does nothing until attuned.
    const staff = MAGIC_ITEMS.find((i) => i.id === 'cloak_of_arachnida') as ItemDef;
    const plain = { ...holder(staff), attuned: [] };
    expect(toCreature(plain, { x: 2, y: 2 }).actions.some((x) => x.id.startsWith('itemspell_'))).toBe(false);
  });

  it('every spell an item grants can be cast in a fight, spends a charge, and the charges survive the fight until a long rest', () => {
    for (const item of casters) {
      const pc = holder(item);
      const hero = toCreature(pc, { x: 3, y: 3 });
      hero.hp = Math.max(1, hero.hp - 5);
      hero.maxHp = Math.max(hero.maxHp, 100);
      const foe = foeAt('f', 4, 3);
      const combat = createCombat([hero, foe], createOpenRoomNav(12, 8), new Rng(7), {});
      combat.begin();
      for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
      const granted = hero.actions.filter((x) => x.id.startsWith('itemspell_'));
      expect(granted.length, item.id).toBeGreaterThan(0);
      for (const a of granted) {
        const key = a.uses?.resource as string;
        const before = hero.resources[key]?.current as number;
        expect(before, `${item.id} ${a.id}`).toBeGreaterThan(0);
        // One action per turn: take a fresh turn for each spell.
        for (let i = 0; i < 12 && (combat.turn.actionUsed || combat.activeId !== 'player'); i++) combat.execute({ type: 'endTurn' });
        expect(combat.canUse(a.id).ok, `${item.id} ${a.id}: ${combat.canUse(a.id).reason ?? ''}`).toBe(true);
        combat.execute(commandFor(a, hero, foe));
        expect(hero.resources[key]?.current, `${item.id} ${a.id} charge`).toBe(before - 1);
      }
      const synced = syncFromCreature(pc, hero);
      const spent = Object.entries(synced.resources).filter(([k, p]) => k.startsWith('charge:') && p.current < p.max);
      expect(spent.length, item.id).toBeGreaterThan(0);
      const rested = longRest(synced);
      for (const [k, p] of Object.entries(rested.resources)) if (k.startsWith('charge:')) expect(p.current).toBe(p.max);
    }
  });

  it('a wand of magic missiles hurts the foe, and the staff of healing heals the holder', () => {
    const wand = MAGIC_ITEMS.find((i) => i.id === 'wand_of_magic_missiles') as ItemDef;
    const hero = toCreature(holder(wand), { x: 3, y: 3 });
    const foe = foeAt('f', 6, 3);
    const combat = createCombat([hero, foe], createOpenRoomNav(12, 8), new Rng(3), {});
    combat.begin();
    for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'action', actionId: itemSpellActionId(wand.id, 'magic_missile'), targetId: 'f' });
    expect(foe.hp).toBeLessThan(400);

    const staff = MAGIC_ITEMS.find((i) => i.id === 'staff_of_healing') as ItemDef;
    const h2 = toCreature(holder(staff), { x: 3, y: 3 });
    h2.maxHp = 100;
    h2.hp = 20;
    const c2 = createCombat([h2, foeAt('g', 10, 6)], createOpenRoomNav(12, 8), new Rng(4), {});
    c2.begin();
    for (let i = 0; i < 10 && c2.activeId !== 'player'; i++) c2.execute({ type: 'endTurn' });
    c2.execute({ type: 'action', actionId: itemSpellActionId(staff.id, 'cure_wounds'), targetId: 'player' });
    expect(h2.hp).toBeGreaterThan(20);
  });
});

describe('timed effects (fights left)', () => {
  it('apply their passives while they last and run down one fight at a time', () => {
    const base = createCharacter(makeBuild());
    let pc = addTimedEffect(base, { id: 'heroism', name: 'Heroism', passives: [{ type: 'acBonus', amount: 2 }, { type: 'saveBonus', amount: 1 }], fightsLeft: 2 });
    expect(computeAc(pc)).toBe(computeAc(base) + 2);
    expect(toCreature(pc, { x: 0, y: 0 }).resources['_saveBonus']?.current).toBe(1);
    pc = syncFromCreature(pc, toCreature(pc, { x: 0, y: 0 }));
    expect(timedEffects(pc)[0]?.fightsLeft).toBe(1);
    expect(computeAc(pc)).toBe(computeAc(base) + 2);
    pc = syncFromCreature(pc, toCreature(pc, { x: 0, y: 0 }));
    expect(timedEffects(pc)).toEqual([]);
    expect(computeAc(pc)).toBe(computeAc(base));
    // The same effect again renews, it does not stack.
    const twice = addTimedEffect(addTimedEffect(base, { id: 'x', name: 'x', passives: [{ type: 'acBonus', amount: 1 }], fightsLeft: 1 }), { id: 'x', name: 'x', passives: [{ type: 'acBonus', amount: 1 }], fightsLeft: 3 });
    expect(timedEffects(twice)).toHaveLength(1);
    expect(computeAc(twice)).toBe(computeAc(base) + 1);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTUNEMENT_LIMIT, type ItemDef, type PassiveEffect, type PlayerCharacter, type WornSlot } from '../core/types';
import { attuneItem, attunementStatus, canAttune, canEquip, computeAc, createCharacter, equipItem, removeWorn, toCreature, unattuneItem } from './character';
import { compareItem } from './compare';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, makeBuild } from './testing/fixtures';

const worn = (id: string, slot: WornSlot | undefined, passives: PassiveEffect[], attunement = false): ItemDef => ({
  id,
  name: id,
  kind: 'wondrous',
  description: id,
  cost: 100,
  ...(slot ? { slot } : {}),
  attunement,
  passives,
});

const ITEMS: ItemDef[] = [
  worn('ring_a', 'ring', [{ type: 'acBonus', amount: 1 }]),
  worn('ring_b', 'ring', [{ type: 'saveBonus', amount: 1 }]),
  worn('ring_c', 'ring', [{ type: 'resistance', damageType: 'fire' }]),
  worn('cloak_a', 'cloak', [{ type: 'acBonus', amount: 1 }], true),
  worn('belt_a', 'belt', [{ type: 'setAbility', ability: 'str', score: 19 }], true),
  worn('head_a', 'head', [{ type: 'abilityBonus', ability: 'int', amount: 2 }], true),
  worn('neck_a', 'neck', [{ type: 'critImmunity' }], true),
  worn('stone', undefined, [{ type: 'saveBonus', amount: 1 }], true),
];

beforeAll(() => setItemCatalog([...FIXTURE_ITEMS, ...ITEMS]));
afterAll(() => resetItemCatalog());

function owner(...ids: string[]): PlayerCharacter {
  const pc = createCharacter(makeBuild());
  return { ...pc, inventory: [...pc.inventory, ...ids.map((itemId) => ({ itemId, quantity: 1 }))] };
}

describe('worn slots and attunement', () => {
  it('equips a worn item into its slot and keeps it in the pack list', () => {
    const pc = equipItem(owner('ring_a'), 'ring_a');
    expect(pc.worn?.ring).toBe('ring_a');
    expect(computeAc(pc)).toBe(computeAc(owner()) + 1);
  });

  it('fills ring then ring2, then replaces the first ring', () => {
    let pc = owner('ring_a', 'ring_b', 'ring_c');
    pc = equipItem(pc, 'ring_a');
    pc = equipItem(pc, 'ring_b');
    expect(pc.worn).toMatchObject({ ring: 'ring_a', ring2: 'ring_b' });
    expect(canEquip(pc, 'ring_c').unequips).toBe('ring_a');
    pc = equipItem(pc, 'ring_c');
    expect(pc.worn).toMatchObject({ ring: 'ring_c', ring2: 'ring_b' });
  });

  it('auto-attunes a worn item when a slot is free, and an attuned item works', () => {
    const pc = equipItem(owner('cloak_a'), 'cloak_a');
    expect(pc.attuned).toEqual(['cloak_a']);
    expect(computeAc(pc)).toBe(computeAc(owner()) + 1);
  });

  it('allows at most three attunements; the fourth item is worn but does nothing', () => {
    let pc = owner('cloak_a', 'belt_a', 'head_a', 'neck_a');
    for (const id of ['cloak_a', 'belt_a', 'head_a', 'neck_a']) pc = equipItem(pc, id);
    expect(pc.attuned).toHaveLength(ATTUNEMENT_LIMIT);
    expect(pc.worn?.neck).toBe('neck_a');
    expect(pc.attuned).not.toContain('neck_a');
    expect(attunementStatus(pc)).toMatchObject({ used: 3, limit: 3, free: 0 });
    expect(canAttune(pc, 'neck_a').ok).toBe(false);
    expect(() => attuneItem(pc, 'neck_a')).toThrow();
    expect(canEquip(owner('cloak_a', 'belt_a', 'head_a', 'neck_a'), 'neck_a').ok).toBe(true);
    // Ending one attunement frees the slot.
    const freed = attuneItem(unattuneItem(pc, 'belt_a'), 'neck_a');
    expect(freed.attuned).toContain('neck_a');
    expect(freed.attuned).not.toContain('belt_a');
  });

  it('removing a worn item ends its attunement', () => {
    const pc = removeWorn(equipItem(owner('cloak_a'), 'cloak_a'), 'cloak_a');
    expect(pc.worn?.cloak).toBeUndefined();
    expect(pc.attuned).toEqual([]);
    expect(computeAc(pc)).toBe(computeAc(owner()));
  });

  it('a slotless charm works from the pack through attunement, not equipping', () => {
    const pc = owner('stone');
    expect(canEquip(pc, 'stone').ok).toBe(false);
    expect(() => equipItem(pc, 'stone')).toThrow();
    expect(attuneItem(pc, 'stone').attuned).toEqual(['stone']);
    expect(compareItem(pc, 'stone')).toBeNull();
    // While attuned it works from the pack.
    expect(toCreature(attuneItem(pc, 'stone'), { x: 0, y: 0 }).resources['_saveBonus']?.current).toBe(1);
    expect(toCreature(pc, { x: 0, y: 0 }).resources['_saveBonus']).toBeUndefined();
  });

  it('compareItem reports passives and AC for a worn item, and what it replaces', () => {
    const base = owner();
    const c1 = compareItem(base, 'ring_a');
    expect(c1?.verdict).toBe('upgrade');
    expect(c1?.changes.some((c) => c.label === 'Armor Class')).toBe(true);
    const c2 = compareItem(base, 'ring_c');
    expect(c2?.verdict).toBe('upgrade');
    expect(c2?.changes.find((c) => c.label === 'Effect')?.to).toBe('Resistance to fire damage');
    const wearing = { ...equipItem(owner('ring_a', 'ring_b'), 'ring_a') };
    const c3 = compareItem(equipItem(wearing, 'ring_b'), 'ring_c');
    expect(c3?.verdict).toBe('tradeoff');
    expect(compareItem(wearing, 'ring_a')?.verdict).toBe('owned');
  });
});

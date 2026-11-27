import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { Command, Creature, ItemDef, PlayerCharacter } from '../core/types';
import { MAGIC_ITEMS } from '../data/magicItems';
import { createCharacter, itemSpellActionId, toCreature } from './character';
import { createCombat } from './combat';
import { expertPolicy } from './expertPolicy';
import { itemCatalog, resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { playerPolicy } from './sim';
import { makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const POTION: ItemDef = { id: 'potion_might', name: 'Potion of Might', kind: 'consumable', description: '', cost: 100, consumable: { effect: 'timed', passives: [{ type: 'acBonus', amount: 2 }], fights: 1 } };
beforeAll(() => setItemCatalog([...itemCatalog(), POTION]));
afterAll(() => resetItemCatalog());

function setup(itemId: string, foes: { id: string; x: number; y: number; defId?: string }[], tweak?: (h: Creature) => void) {
  const pc: PlayerCharacter = { ...createCharacter(makeBuild()), level: 5 };
  const withItem = { ...pc, inventory: [...pc.inventory, { itemId, quantity: 1 }], attuned: [itemId] };
  const hero = toCreature(withItem, { x: 2, y: 3 });
  hero.maxHp = hero.hp = Math.max(hero.hp, 60);
  delete hero.resources['secondWind'];
  hero.actions = hero.actions.filter((a) => !a.id.startsWith('drink_'));
  tweak?.(hero);
  const monsters = foes.map((f) => instantiateMonster(mon({ id: f.defId ?? f.id, name: f.id, hp: 200, ac: 12 }), f.id, { x: f.x, y: f.y }));
  const combat = createCombat([hero, ...monsters], createOpenRoomNav(16, 8), new Rng(5), {});
  combat.begin();
  for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
  return { combat, hero };
}

const policies: [string, (c: never, n: never) => Command][] = [['naive', playerPolicy as never], ['expert', expertPolicy as never]];

describe.each(policies)('item spells in the %s policy', (_name, policy) => {
  it('throws a fireball at a group and no ally in the blast', () => {
    const { combat } = setup('wand_of_fireballs', [{ id: 'a', x: 10, y: 3 }, { id: 'b', x: 11, y: 3 }, { id: 'c', x: 10, y: 4 }]);
    const cmd = policy(combat as never, createOpenRoomNav(16, 8) as never);
    expect(cmd).toMatchObject({ type: 'action', actionId: itemSpellActionId('wand_of_fireballs', 'fireball') });
  });

  it('uses a healing staff like a potion when hurt, not when healthy', () => {
    const hurt = setup('staff_of_healing', [{ id: 'a', x: 12, y: 3 }], (h) => (h.hp = 15));
    expect(policy(hurt.combat as never, createOpenRoomNav(16, 8) as never)).toMatchObject({ actionId: expect.stringContaining('itemspell_staff_of_healing') });
    const fine = setup('staff_of_healing', [{ id: 'a', x: 12, y: 3 }]);
    const c = policy(fine.combat as never, createOpenRoomNav(16, 8) as never);
    expect((c as { actionId?: string }).actionId ?? '').not.toContain('itemspell_staff_of_healing');
  });

  it('uses a timed potion once in a boss fight, not against ordinary foes', () => {
    const boss = setup('potion_might', [{ id: 'boss', x: 12, y: 3, defId: 'goblin_boss' }]);
    expect(policy(boss.combat as never, createOpenRoomNav(16, 8) as never)).toMatchObject({ actionId: 'use_potion_might' });
    const plain = setup('potion_might', [{ id: 'g', x: 12, y: 3 }]);
    expect((policy(plain.combat as never, createOpenRoomNav(16, 8) as never) as { actionId?: string }).actionId ?? '').not.toBe('use_potion_might');
  });
});

it('the data wands exist for the tests above', () => {
  expect(MAGIC_ITEMS.some((i) => i.id === 'wand_of_fireballs')).toBe(true);
});

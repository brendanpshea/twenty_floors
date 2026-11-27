import { describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent, MonsterDef, OngoingDamage } from '../core/types';
import { toCreature } from './character';
import { createCombat } from './combat';
import { hasCondition, makeCondition } from './conditions';
import { instantiateMonster } from './monster';
import { ScriptedRng, mon } from './testing/fixtures';
import { presetHero } from './testing/heroes';
import { createOpenRoomNav } from './testing/openRoomNav';

const arena = createOpenRoomNav(16, 9);
const slash: ActionDef = { id: 'slash', name: 'Slash', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 20 }, damage: [{ dice: '1d4', type: 'slashing' }] };
const engulf: ActionDef = {
  id: 'engulf',
  name: 'Engulf',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  save: { ability: 'dex', dc: 40, halfOnSave: false },
  applies: { condition: 'restrained', saveEnds: { ability: 'str', dc: 40 }, ongoing: { damage: [{ dice: '1d6', type: 'acid' }], when: 'sourceTurnStart' } },
};
const torch: ActionDef = {
  ...slash,
  id: 'torch',
  name: 'Torch',
  damage: [{ dice: '1d4', type: 'fire' }],
  applies: { condition: 'burning', saveEnds: { ability: 'dex', dc: 40 }, ongoing: { damage: [{ dice: '1d4', type: 'fire' }] } },
};
const brute = (over: Partial<MonsterDef> = {}): MonsterDef => mon({ id: 'brute', name: 'Brute', hp: 500, ac: 10, actions: [slash, engulf, torch], ...over });

function hero(): Creature {
  const h = toCreature(presetHero('great_weapon', 1), { x: 3, y: 4 });
  h.maxHp = h.hp = 300;
  return h;
}

/** Begin a fight and pass turns until `id` acts. */
function fight(creatures: Creature[], activeId: string) {
  const rng = new ScriptedRng(1);
  const combat = createCombat(creatures, arena, rng, {});
  combat.begin();
  for (let i = 0; i < 30 && combat.activeId !== activeId; i++) combat.execute({ type: 'endTurn' });
  return { combat, rng };
}
const damageTo = (ev: GameEvent[], id: string) => ev.filter((e): e is Extract<GameEvent, { type: 'damage' }> => e.type === 'damage' && e.targetId === id);
const ongoing = (o: OngoingDamage): OngoingDamage => o;

describe('ongoing damage on a condition', () => {
  it('hurts the holder at the start of each of its own turns, credited to the source, with no save', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    const { combat, rng } = fight([h, b], 'b');
    h.conditions.push(makeCondition('burning', null, 'b', undefined, undefined, ongoing({ damage: [{ dice: '1d6', type: 'fire' }] })));
    rng.queue = [4];
    const ev = combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('player');
    const hits = damageTo(ev, 'player');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ amount: 4, damageType: 'fire', sourceId: 'b' });
    expect(h.hp).toBe(296);
    // No save was rolled for it.
    expect(ev.some((e) => e.type === 'saveRoll')).toBe(false);
  });

  it('applies resistances and immunities through the normal damage path', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    h.immunities = ['fire'];
    const { combat, rng } = fight([h, b], 'b');
    h.conditions.push(makeCondition('burning', null, 'b', undefined, undefined, ongoing({ damage: [{ dice: '1d6', type: 'fire' }] })));
    rng.queue = [4];
    combat.execute({ type: 'endTurn' });
    expect(h.hp).toBe(300);
  });

  it('stops when the condition ends or the source is dead', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    const { combat, rng } = fight([h, b], 'b');
    h.conditions.push(makeCondition('burning', null, 'b', undefined, undefined, ongoing({ damage: [{ dice: '1d6', type: 'fire' }] })));
    b.hp = 0;
    b.dead = true;
    rng.queue = [4];
    combat.execute({ type: 'endTurn' });
    expect(h.hp).toBe(300);
  });

  it("'sourceTurnStart' hurts the holder at the start of the source's turn, not its own", () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    const { combat, rng } = fight([h, b], 'player');
    h.conditions.push(makeCondition('restrained', null, 'b', undefined, undefined, ongoing({ damage: [{ dice: '1d6', type: 'acid' }], when: 'sourceTurnStart' })));
    rng.queue = [5];
    const ev = combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('b');
    expect(damageTo(ev, 'player')[0]).toMatchObject({ amount: 5, damageType: 'acid', sourceId: 'b' });
    expect(h.hp).toBe(295);
    // The holder's own next turn adds nothing.
    rng.queue = [6];
    combat.execute({ type: 'endTurn' });
    expect(h.hp).toBe(295);
  });

  it('is applied by an action together with its condition, and ends with the condition', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    const { combat, rng } = fight([h, b], 'b');
    // DC 40: the hero fails the save, so the Engulf lands.
    rng.queue = [1];
    combat.execute({ type: 'action', actionId: 'engulf', targetId: 'player' });
    const held = h.conditions.find((c) => c.condition === 'restrained');
    expect(held?.sourceId).toBe('b');
    expect(held?.ongoing).toEqual({ damage: [{ dice: '1d6', type: 'acid' }], when: 'sourceTurnStart' });
    // Removing the condition ends the damage: simulate the escape.
    h.conditions = h.conditions.filter((c) => c !== held);
    expect(hasCondition(h, 'restrained')).toBe(false);
  });

  it("Burning from an attack carries 1d4-style fire damage and ends with a successful save at the end of the holder's turn", () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = hero();
    const { combat, rng } = fight([h, b], 'b');
    rng.queue = [15, 2, 3];
    combat.execute({ type: 'action', actionId: 'torch', targetId: 'player' });
    const burning = h.conditions.find((c) => c.condition === 'burning');
    expect(burning?.saveEnds).toEqual({ ability: 'dex', dc: 40 });
    expect(burning?.ongoing?.damage).toEqual([{ dice: '1d4', type: 'fire' }]);
    // Lower the DC so the hero's end-of-turn save succeeds and the fire goes out.
    if (burning?.saveEnds) burning.saveEnds.dc = 1;
    rng.queue = [3];
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('player');
    expect(hasCondition(h, 'burning')).toBe(true);
    // The hero's turn ends: the save (DC 1) succeeds and the fire goes out.
    rng.queue = [20];
    combat.execute({ type: 'endTurn' });
    expect(hasCondition(h, 'burning')).toBe(false);
    const hpAfter = h.hp;
    rng.queue = [4, 4];
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('player');
    expect(h.hp).toBe(hpAfter);
  });
});

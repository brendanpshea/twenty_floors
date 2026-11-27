import { describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent, MonsterDef } from '../core/types';
import { toCreature } from './character';
import { createCombat, attacksLeft } from './combat';
import { attackModeFromConditions, autoFailsSave, effectiveSpeed, hasCondition, isIncapacitated, makeCondition, saveMode } from './conditions';
import { instantiateMonster } from './monster';
import { ScriptedRng, mon } from './testing/fixtures';
import { presetHero } from './testing/heroes';
import { createOpenRoomNav } from './testing/openRoomNav';

const arena = createOpenRoomNav(16, 9);
const slash: ActionDef = { id: 'slash', name: 'Slash', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 20 }, damage: [{ dice: '1d4', type: 'slashing' }] };
const triple: ActionDef = { id: 'multi', name: 'Multiattack', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, multiattack: ['slash', 'slash', 'slash'] };
const bonusJab: ActionDef = { ...slash, id: 'jab', name: 'Jab', cost: 'bonus' };
const gaze: ActionDef = {
  id: 'gaze',
  name: 'Gaze',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: false, range: 6 },
  save: { ability: 'con', dc: 15, halfOnSave: false },
  applies: { condition: 'restrained', saveEnds: { ability: 'con', dc: 15 }, thenOnFail: { condition: 'petrified' } },
};
const brute = (over: Partial<MonsterDef> = {}): MonsterDef => mon({ id: 'brute', name: 'Brute', hp: 500, ac: 10, actions: [slash, triple, bonusJab, gaze], ...over });

function heroCreature(level = 1, at = { x: 3, y: 4 }): Creature {
  const h = toCreature(presetHero('great_weapon', level), at);
  h.maxHp = h.hp = 300;
  return h;
}
const slow = (c: Creature): void => void c.conditions.push(makeCondition('slowed', null));
const stone = (c: Creature): void => void c.conditions.push(makeCondition('petrified', null));

/** Begin a fight and pass turns until `id` acts. */
function fight(creatures: Creature[], activeId: string, rng = new ScriptedRng(1)) {
  const combat = createCombat(creatures, arena, rng, {});
  combat.begin();
  for (let i = 0; i < 30 && combat.activeId !== activeId; i++) combat.execute({ type: 'endTurn' });
  return { combat, rng };
}
const count = (ev: GameEvent[], type: GameEvent['type']): number => ev.filter((e) => e.type === type).length;

describe('slowed', () => {
  it('halves speed, rounding down, never below 1 cell', () => {
    const c = instantiateMonster(brute(), 'b', { x: 1, y: 1 });
    expect(effectiveSpeed(c)).toBe(6);
    slow(c);
    expect(effectiveSpeed(c)).toBe(3);
    c.speed = 5;
    expect(effectiveSpeed(c)).toBe(2);
    c.speed = 1;
    expect(effectiveSpeed(c)).toBe(1);
  });

  it('turns a Multiattack into its first attack only', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = heroCreature();
    const { combat, rng } = fight([h, b], 'b');
    slow(b);
    rng.queue = [10, 2];
    const ev = combat.execute({ type: 'action', actionId: 'multi', targetId: 'player' });
    expect(count(ev, 'attackRoll')).toBe(1);
  });

  it('gives a hero with Extra Attack one attack', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = heroCreature(5);
    const atk = h.actions.find((a) => a.id.startsWith('atk_'))!;
    const { combat } = fight([h, b], 'player');
    expect(attacksLeft(combat)).toBeGreaterThan(1);
    slow(h);
    expect(attacksLeft(combat)).toBe(1);
    combat.execute({ type: 'action', actionId: atk.id, targetId: 'b' });
    expect(attacksLeft(combat)).toBe(0);
    expect(combat.canUse(atk.id).ok).toBe(false);
  });

  it('forbids the action after a bonus action', () => {
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    const h = heroCreature();
    const { combat } = fight([h, b], 'b');
    slow(b);
    combat.execute({ type: 'action', actionId: 'jab', targetId: 'player' });
    expect(combat.canUse('slash').ok).toBe(false);
    expect(combat.canUse('slash').reason).toMatch(/Slowed/);
  });

  it('takes no opportunity attack: a slowed monster lets a hero walk away', () => {
    const run = (slowed: boolean): number => {
      const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
      const h = heroCreature();
      const { combat } = fight([h, b], 'player');
      if (slowed) slow(b);
      return count(combat.execute({ type: 'move', path: [{ x: 2, y: 4 }] }), 'attackRoll');
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });
});

describe('petrified', () => {
  it('is incapacitated with speed 0, advantage against it, automatic Strength and Dexterity failures', () => {
    const h = heroCreature();
    const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
    stone(h);
    expect(isIncapacitated(h)).toBe(true);
    expect(effectiveSpeed(h)).toBe(0);
    expect(attackModeFromConditions(b, h, true).adv).toBe(true);
    expect(autoFailsSave(h, 'str')).toBe(true);
    expect(autoFailsSave(h, 'dex')).toBe(true);
    expect(autoFailsSave(h, 'con')).toBe(false);
    expect(saveMode(h, 'con')).toBe('normal');
  });

  it('resists all damage', () => {
    const dealt = (petrified: boolean): number => {
      const b = instantiateMonster(brute(), 'b', { x: 4, y: 4 });
      const bigHit: MonsterDef = brute({ actions: [{ ...slash, damage: [{ dice: '10d1', type: 'fire' }] }] });
      const a = instantiateMonster(bigHit, 'a', { x: 5, y: 4 });
      b.faction = 'ally';
      if (petrified) stone(b);
      const { combat, rng } = fight([heroCreature(1, { x: 9, y: 8 }), b, a], 'a');
      rng.queue = [10, 10];
      combat.execute({ type: 'action', actionId: 'slash', targetId: 'b' });
      return 500 - b.hp;
    };
    expect(dealt(false)).toBe(10);
    expect(dealt(true)).toBe(5);
  });

  it('two-stage: first failure restrains, a second failure at the end of its turn petrifies, and the hero loses the fight', () => {
    const b = instantiateMonster(brute(), 'b', { x: 6, y: 4 });
    const h = heroCreature();
    const { combat, rng } = fight([h, b], 'b');
    rng.queue = [1];
    combat.execute({ type: 'action', actionId: 'gaze', targetId: 'player' });
    expect(h.conditions.map((c) => c.condition)).toEqual(['restrained']);
    expect(h.conditions[0]?.thenOnFail).toEqual({ condition: 'petrified' });
    for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    rng.queue = [1];
    const ev = combat.execute({ type: 'endTurn' });
    expect(hasCondition(h, 'petrified')).toBe(true);
    expect(hasCondition(h, 'restrained')).toBe(false);
    expect(h.conditions[0]?.saveEnds).toBeUndefined();
    expect(combat.isOver).toBe(true);
    expect(combat.winner).toBe('enemy');
    expect(ev.some((e) => e.type === 'combatEnd')).toBe(true);
  });

  it('two-stage: a success at the end of the turn ends the Restrained effect and nothing follows', () => {
    const b = instantiateMonster(brute(), 'b', { x: 6, y: 4 });
    const h = heroCreature();
    const { combat, rng } = fight([h, b], 'b');
    rng.queue = [1];
    combat.execute({ type: 'action', actionId: 'gaze', targetId: 'player' });
    for (let i = 0; i < 10 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    rng.queue = [20];
    combat.execute({ type: 'endTurn' });
    expect(h.conditions).toEqual([]);
    expect(combat.isOver).toBe(false);
  });

  it('a petrified monster counts as defeated: the fight is won and it is gone', () => {
    const b = instantiateMonster(brute(), 'b', { x: 6, y: 4 });
    const h = heroCreature();
    b.conditions.push(makeCondition('restrained', null, 'player', { ability: 'con', dc: 15 }, { condition: 'petrified' }));
    const { combat, rng } = fight([h, b], 'b');
    rng.queue = [1];
    combat.execute({ type: 'endTurn' });
    expect(combat.isOver).toBe(true);
    expect(combat.winner).toBe('player');
    expect(b.dead).toBe(true);
  });

  it('is restored on the player side after a won fight', () => {
    const b = instantiateMonster(brute({ hp: 1 }), 'b', { x: 4, y: 4 });
    const ally = instantiateMonster(brute(), 'ally', { x: 2, y: 4 });
    ally.faction = 'ally';
    stone(ally);
    const h = heroCreature();
    const { combat, rng } = fight([h, b, ally], 'player');
    rng.queue = [20, 6];
    combat.execute({ type: 'action', actionId: h.actions.find((a) => a.id.startsWith('atk_'))!.id, targetId: 'b' });
    expect(b.hp).toBe(0);
    expect(combat.winner).toBe('player');
    expect(hasCondition(ally, 'petrified')).toBe(false);
  });
});

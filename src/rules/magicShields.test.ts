import { describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent, MonsterDef, PlayerCharacter } from '../core/types';
import { attuneItem, canEquip, computeAc, equipItem, toCreature } from './character';
import { createCombat } from './combat';
import { compareItem } from './compare';
import { instantiateMonster } from './monster';
import { requireItem } from './items';
import { ScriptedRng, mon } from './testing/fixtures';
import { presetHero, withItems } from './testing/heroes';
import { createOpenRoomNav } from './testing/openRoomNav';

/** A hero holding the shield, attuned to it. */
function bearer(shieldId: string, preset: 'defender' | 'great_weapon' = 'defender'): PlayerCharacter {
  const on = equipItem(withItems(presetHero(preset), shieldId), shieldId);
  return requireItem(shieldId).attunement ? attuneItem(on, shieldId) : on;
}

const bow: ActionDef = { id: 'bow', name: 'Longbow', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 30, longRange: 120 }, attack: { bonus: 5 }, damage: [{ dice: '1d8+2', type: 'piercing' }] };
const ray: ActionDef = { ...bow, id: 'ray', name: 'Fire Ray', effects: ['magic'], damage: [{ dice: '2d6', type: 'fire' }] };
const hex: ActionDef = { id: 'hex', name: 'Hex', description: '', cost: 'action', effects: ['magic'], targeting: { kind: 'creature', melee: false, range: 12 }, save: { ability: 'wis', dc: 13, halfOnSave: false }, damage: [{ dice: '2d6', type: 'psychic' }] };
const club: ActionDef = { id: 'club', name: 'Club', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 5 }, damage: [{ dice: '1d6+2', type: 'bludgeoning' }] };
const archerDef: MonsterDef = mon({ id: 'test_archer', name: 'Archer', hp: 200, ac: 10, actions: [bow, ray, hex, club] });
const arena = createOpenRoomNav(16, 9);

type Roll = Extract<GameEvent, { type: 'attackRoll' }>;

/** The archer at (10,4) uses `actionId` on `targetId`; the hero stands at (3,4) and a friend, if asked for, `gap` cells east of it. */
function shoot(pc: PlayerCharacter, actionId: string, targetId: 'player' | 'friend', opts: { gap?: number; queue?: number[]; archerAt?: number } = {}): { ev: GameEvent[]; h: Creature; friend?: Creature } {
  const h = toCreature(pc, { x: 3, y: 4 });
  h.maxHp = h.hp = 300;
  const f = instantiateMonster(archerDef, 'f', { x: opts.archerAt ?? 10, y: 4 });
  const creatures = [h, f];
  let friend: Creature | undefined;
  if (opts.gap !== undefined) {
    friend = instantiateMonster(mon({ id: 'test_friend', name: 'Friend', hp: 200, ac: 10 }), 'friend', { x: 3 + opts.gap, y: 4 });
    friend.faction = 'ally';
    creatures.push(friend);
  }
  const rng = new ScriptedRng(1);
  const combat = createCombat(creatures, arena, rng, {});
  combat.begin();
  for (let i = 0; i < 30 && combat.activeId !== 'f'; i++) combat.execute({ type: 'endTurn' });
  rng.queue = opts.queue ?? [10, 4, 4];
  const ev = combat.execute({ type: 'action', actionId, targetId });
  return friend ? { ev, h, friend } : { ev, h };
}
const rollOf = (ev: GameEvent[]): Roll => ev.find((e) => e.type === 'attackRoll') as Roll;

describe('Arrow-Catching Shield', () => {
  const pc = bearer('arrow_catching_shield');
  it('is a shield with +2 Armor Class against ranged attack rolls only', () => {
    expect(computeAc(pc)).toBe(computeAc(bearer('shield')));
    const ac = computeAc(pc);
    // A roll that meets the plain Armor Class hits in melee and misses from range.
    const need = ac - 5;
    expect(rollOf(shoot(pc, 'club', 'player', { queue: [need, 3], archerAt: 4 }).ev).outcome).toBe('hit');
    expect(rollOf(shoot(pc, 'bow', 'player', { queue: [need, 3] }).ev).outcome).toBe('miss');
    expect(rollOf(shoot(pc, 'bow', 'player', { queue: [need + 2, 3] }).ev).outcome).toBe('hit');
    expect(rollOf(shoot(bearer('shield'), 'bow', 'player', { queue: [need, 3] }).ev).outcome).toBe('hit');
  });
  it('takes a ranged attack aimed at a friend beside it, once a round, and not one aimed at a friend farther off', () => {
    const near = shoot(pc, 'bow', 'friend', { gap: 1 });
    expect(rollOf(near.ev).targetId).toBe('player');
    expect(near.friend?.hp).toBe(200);
    expect(rollOf(shoot(pc, 'bow', 'friend', { gap: 2 }).ev).targetId).toBe('friend');
    expect(rollOf(shoot(pc, 'club', 'friend', { gap: 1, archerAt: 5 }).ev).targetId).toBe('friend');
    // A spell attack is a ranged attack roll too.
    expect(rollOf(shoot(pc, 'ray', 'friend', { gap: 1 }).ev).targetId).toBe('player');
    expect(rollOf(shoot(bearer('shield'), 'bow', 'friend', { gap: 1 }).ev).targetId).toBe('friend');
  });
  it('does nothing unattuned', () => {
    const loose = equipItem(withItems(presetHero('defender'), 'arrow_catching_shield'), 'arrow_catching_shield');
    expect(rollOf(shoot(loose, 'bow', 'friend', { gap: 1 }).ev).targetId).toBe('friend');
  });
});

describe('Shield of Missile Attraction', () => {
  const pc = bearer('shield_of_missile_attraction');
  it('halves damage from ranged weapon attacks, not from spells or melee', () => {
    const dmg = (who: PlayerCharacter, action: string, at?: number): number => 300 - shoot(who, action, 'player', { queue: [19, 6, 6], ...(at ? { archerAt: at } : {}) }).h.hp;
    const plain = bearer('shield');
    expect(dmg(pc, 'bow')).toBe(Math.floor(dmg(plain, 'bow') / 2));
    expect(dmg(pc, 'ray')).toBe(dmg(plain, 'ray'));
    expect(dmg(pc, 'club', 4)).toBe(dmg(plain, 'club', 4));
  });
  it('its curse drags ranged weapon attacks within 10 ft onto the bearer, every time, but not spell attacks', () => {
    expect(rollOf(shoot(pc, 'bow', 'friend', { gap: 2 }).ev).targetId).toBe('player');
    expect(rollOf(shoot(pc, 'bow', 'friend', { gap: 3 }).ev).targetId).toBe('friend');
    expect(rollOf(shoot(pc, 'ray', 'friend', { gap: 1 }).ev).targetId).toBe('friend');
  });
});

describe('Spellguard Shield', () => {
  const pc = bearer('spellguard_shield');
  it('gives spell attacks disadvantage and leaves weapon attacks alone', () => {
    expect(rollOf(shoot(pc, 'ray', 'player').ev).mode).toBe('disadvantage');
    expect(rollOf(shoot(pc, 'bow', 'player').ev).mode).toBe('normal');
    expect(rollOf(shoot(bearer('shield'), 'ray', 'player').ev).mode).toBe('normal');
  });
  it('gives advantage on saves against magic', () => {
    const save = (who: PlayerCharacter): Extract<GameEvent, { type: 'saveRoll' }> => shoot(who, 'hex', 'player', { queue: [3, 15, 1, 1] }).ev.find((e) => e.type === 'saveRoll') as Extract<GameEvent, { type: 'saveRoll' }>;
    expect(save(pc).d20).toBe(15);
    expect(save(bearer('shield')).d20).toBe(3);
  });
});

describe('Animated Shield', () => {
  it('goes with a two-handed weapon: nothing is put away, the shield bonus counts and the weapon keeps both hands', () => {
    const great = presetHero('great_weapon');
    const main = great.equipped.mainHand as string;
    expect(requireItem(main).weapon?.properties).toContain('twoHanded');
    const owner = withItems(great, 'animated_shield');
    expect(canEquip(owner, 'animated_shield').unequips).toBeUndefined();
    const on = attuneItem(equipItem(owner, 'animated_shield'), 'animated_shield');
    expect(on.equipped.mainHand).toBe(main);
    expect(on.equipped.offHand).toBe('animated_shield');
    expect(computeAc(on)).toBe(computeAc(great) + 2);
    expect(compareItem(great, 'animated_shield')?.replaces).toEqual([]);
    // An ordinary shield still puts the great weapon away.
    expect(equipItem(withItems(great, 'shield'), 'shield').equipped.mainHand).toBeUndefined();
    // And a two-handed weapon taken up later leaves the floating shield where it is.
    const sword = equipItem(withItems(bearer('animated_shield'), 'greatsword'), 'greatsword');
    expect(sword.equipped.offHand).toBe('animated_shield');
    expect(sword.equipped.mainHand).toBe('greatsword');
  });
  it('lets a versatile weapon be swung in two hands', () => {
    const dice = (who: PlayerCharacter): string | undefined => toCreature(who, { x: 0, y: 0 }).actions.find((a) => a.id.startsWith('atk_'))?.damage?.[0]?.dice;
    const plain = bearer('shield');
    expect(requireItem(plain.equipped.mainHand as string).weapon?.versatileDice).toBeDefined();
    expect(dice(bearer('animated_shield'))).not.toBe(dice(plain));
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, CombatApi, Creature, GameEvent, GridPos, MonsterDef, NavGrid } from '../core/types';
import { createCharacter, toCreature } from './character';
import { createCombat, pushPreview } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';
import { flagPool } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const at = (x: number, y: number): GridPos => ({ x, y });
const nav: NavGrid = createOpenRoomNav(16, 9);

const club: ActionDef = {
  id: 'club',
  name: 'Club',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus: 6 },
  damage: [{ dice: '1d6+1', type: 'bludgeoning' }],
};

function hero(x: number, y: number, flags: string[] = [], over: Partial<Creature> = {}): Creature {
  const h = toCreature(createCharacter(makeBuild()), at(x, y));
  h.maxHp = h.hp = 300;
  h.ac = 1;
  delete h.resources['lastStand'];
  for (const f of flags) h.resources['_' + f] = flagPool(f);
  return Object.assign(h, over);
}

function foe(id: string, x: number, y: number, over: Partial<MonsterDef> = {}, flags: string[] = []): Creature {
  const c = instantiateMonster(mon({ id, name: id, hp: 60, ac: 1, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, actions: [club], ...over }), id, at(x, y));
  for (const f of flags) c.resources['_' + f] = flagPool(f);
  return c;
}

function start(creatures: Creature[], active: string, net: NavGrid = nav): { combat: CombatApi; rng: ScriptedRng; events: GameEvent[] } {
  const rng = new ScriptedRng(7);
  const combat = createCombat(creatures, net, rng);
  const events = [...combat.begin()];
  for (let i = 0; i < 40 && combat.activeId !== active; i++) events.push(...combat.execute({ type: 'endTurn' }));
  return { combat, rng, events };
}

const feats = (ev: GameEvent[], id: string): Extract<GameEvent, { type: 'feature' }>[] => ev.filter((e): e is Extract<GameEvent, { type: 'feature' }> => e.type === 'feature' && e.id === id);
const logs = (ev: GameEvent[]): string[] => ev.filter((e): e is Extract<GameEvent, { type: 'log' }> => e.type === 'log').map((e) => e.text);

describe('structured feature events (each comes right before its log line)', () => {
  it('sneakAttack, with the extra damage as amount', () => {
    const rogue = foe('rogue', 5, 4);
    rogue.resources['_sneakAttack'] = { name: 'Sneak Attack', current: 2, max: 0, refresh: 'longRest' };
    const pal = foe('pal', 4, 5);
    const { combat, rng } = start([hero(4, 4), rogue, pal], 'rogue');
    rng.queue = [15, 3, 4, 4];
    const ev = combat.execute({ type: 'action', actionId: 'club', targetId: 'player' });
    const f = feats(ev, 'sneakAttack');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ creatureId: 'rogue', targetId: 'player', label: 'Sneak Attack' });
    expect(f[0]?.amount).toBeGreaterThan(0);
    const i = ev.findIndex((e) => e.type === 'feature');
    expect(ev[i + 1]).toEqual({ type: 'log', text: 'rogue lands a Sneak Attack!' });
  });

  it('cleave', () => {
    const h = hero(4, 4);
    const sword = h.actions.find((a) => a.id.startsWith('atk_')) as ActionDef;
    sword.effects = [...(sword.effects ?? []), 'mastery:cleave:3'];
    const { combat, rng } = start([h, foe('a', 5, 4), foe('b', 5, 5)], 'player');
    rng.queue = [15, 3, 15, 3];
    const ev = combat.execute({ type: 'action', actionId: sword.id, targetId: 'a' });
    expect(feats(ev, 'cleave')).toHaveLength(1);
    expect(feats(ev, 'cleave')[0]).toMatchObject({ creatureId: 'player', targetId: 'b' });
  });

  it('peerlessAim', () => {
    const { combat, rng } = start([hero(4, 4, ['combatProwess']), foe('a', 5, 4, { ac: 30 })], 'player');
    rng.queue = [2, 3];
    const ev = combat.execute({ type: 'action', actionId: (combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef).id, targetId: 'a' });
    expect(feats(ev, 'peerlessAim')).toHaveLength(1);
    expect(logs(ev).some((l) => l.includes('Peerless Aim'))).toBe(true);
  });

  it('savageAttacker only when the second roll is higher', () => {
    const h = hero(4, 4, ['savageAttacker']);
    const { combat, rng } = start([h, foe('a', 5, 4)], 'player');
    const id = (combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef).id;
    rng.queue = [15, 1, 8];
    const ev = combat.execute({ type: 'action', actionId: id, targetId: 'a' });
    expect(feats(ev, 'savageAttacker')).toHaveLength(1);
  });

  it('uncannyDodge', () => {
    const rogue = foe('rogue', 5, 4, {}, ['uncannyDodge']);
    const { combat, rng } = start([hero(4, 4), rogue], 'player');
    rng.queue = [15, 3];
    const ev = combat.execute({ type: 'action', actionId: (combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef).id, targetId: 'rogue' });
    expect(feats(ev, 'uncannyDodge')).toEqual([{ type: 'feature', creatureId: 'rogue', id: 'uncannyDodge', label: 'Uncanny Dodge', targetId: 'player' }]);
  });

  const burst: ActionDef = {
    id: 'burst',
    name: 'Burst',
    description: '',
    cost: 'action',
    targeting: { kind: 'point', range: 10, area: { shape: 'sphere', size: 2 } },
    save: { ability: 'dex', dc: 13, halfOnSave: true },
    damage: [{ dice: '10d10', type: 'fire' }],
  };

  it('evasion', () => {
    const h = hero(4, 4, ['evasion']);
    const { combat, rng } = start([h, foe('mage', 10, 4, { actions: [burst] })], 'mage');
    rng.queue = [20, 3];
    const ev = combat.execute({ type: 'action', actionId: 'burst', point: at(5, 4) });
    expect(feats(ev, 'evasion')).toHaveLength(1);
  });

  it('indomitable rerolls a failed save against heavy damage', () => {
    const h = hero(4, 4);
    h.resources['indomitable'] = { name: 'Indomitable', current: 1, max: 1, refresh: 'longRest' };
    h.maxHp = h.hp = 100;
    const { combat, rng } = start([h, foe('mage', 10, 4, { actions: [burst] })], 'mage');
    // Ten damage dice come first, then the failed save, then the reroll.
    rng.queue = [...Array<number>(10).fill(5), 1, 18];
    const ev = combat.execute({ type: 'action', actionId: 'burst', point: at(5, 4) });
    expect(feats(ev, 'indomitable')).toHaveLength(1);
    expect(feats(ev, 'indomitable')[0]?.amount).toBe(h.level);
  });

  it('burstOfIngenuity', () => {
    const h = hero(4, 4);
    const sphinx = foe('sphinx', 4, 6);
    sphinx.faction = 'ally';
    sphinx.resources['burstOfIngenuity'] = { name: 'Burst of Ingenuity', current: 1, max: 1, refresh: 'longRest' };
    const caster = foe('mage', 12, 4, { actions: [{ ...burst, save: { ability: 'dex', dc: 12, halfOnSave: true }, damage: [{ dice: '1d4', type: 'fire' }] }] });
    const { combat, rng } = start([h, sphinx, caster], 'mage');
    rng.queue = [3, 10];
    const ev = combat.execute({ type: 'action', actionId: 'burst', point: at(4, 4) });
    expect(feats(ev, 'burstOfIngenuity')).toHaveLength(1);
    expect(feats(ev, 'burstOfIngenuity')[0]).toMatchObject({ creatureId: 'sphinx', targetId: 'player', amount: 2 });
  });

  it('heroicRally emits a feature and a normal heal event', () => {
    const h = hero(4, 4, ['heroicRally'], { hp: 20 });
    const { events } = start([h, foe('a', 8, 4)], 'player');
    expect(feats(events, 'heroicRally')).toHaveLength(1);
    expect(events.some((e) => e.type === 'heal' && e.targetId === 'player' && e.amount > 0)).toBe(true);
  });

  it('shield, then concentration start and end', () => {
    const mage = foe('mage', 5, 4, {
      actions: [
        club,
        { id: 'shield', name: 'Shield', description: '', cost: 'reaction', targeting: { kind: 'self' }, effects: ['shield'], uses: { resource: 'spell:shield', amount: 1 } },
        { id: 'bl', name: 'Bless', description: '', cost: 'action', targeting: { kind: 'self' }, effects: ['bless'] },
      ],
      ac: 10,
    });
    const { combat, rng } = start([hero(4, 4), mage], 'mage');
    const begin = combat.execute({ type: 'action', actionId: 'bl' });
    expect(feats(begin, 'concentrationStart')).toHaveLength(1);
    combat.execute({ type: 'endTurn' });
    mage.resources['spell:shield'] = { name: 'Shield', current: 1, max: 1, refresh: 'longRest' };
    // The hero's hit lands only because of a roll that Shield turns into a miss; the damage then breaks concentration if it lands.
    rng.queue = [6];
    const hit = combat.execute({ type: 'action', actionId: (combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef).id, targetId: 'mage' });
    expect(feats(hit, 'shield')).toHaveLength(1);
    // Concentration ends when damage breaks it.
    const mage2 = foe('mage2', 5, 4, { actions: [club, { id: 'bl', name: 'Bless', description: '', cost: 'action', targeting: { kind: 'self' }, effects: ['bless'] }] });
    const s2 = start([hero(4, 4), mage2], 'mage2');
    s2.combat.execute({ type: 'action', actionId: 'bl' });
    s2.combat.execute({ type: 'endTurn' });
    s2.rng.queue = [18, 18, 5, 1, 1]; // robust to advantage or not: the Constitution save always fails
    const ev = s2.combat.execute({ type: 'action', actionId: (s2.combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef).id, targetId: 'mage2' });
    expect(feats(ev, 'concentrationEnd')).toHaveLength(1);
  });

  it('ambush (lurker) and lastStand', () => {
    const walls = [3, 4, 5].map((y) => at(8, y));
    const wall = createOpenRoomNav(16, 9, { walls });
    const spider = foe('spider', 9, 4, {}, ['tactic_lurker']);
    const { events, combat } = start([hero(7, 4), spider], 'player', wall);
    void events;
    combat.execute({ type: 'endTurn' });
    spider.pos = at(8, 6);
    combat.execute({ type: 'endTurn' });
    // The lurker attacks the hero from (8,6)... bring them together.
    const h2 = hero(5, 4);
    const sp2 = foe('spider', 6, 4, {}, ['tactic_lurker']);
    const rng = new ScriptedRng(3);
    const c2 = createCombat([h2, sp2], wall, rng);
    c2.begin();
    // They see each other: no ambush. Out of sight: ambush.
    const wallBetween = createOpenRoomNav(16, 9, { walls: [at(6, 3), at(6, 4), at(6, 5)] });
    const h3 = hero(5, 4);
    const sp3 = foe('spider', 7, 4, {}, ['tactic_lurker']);
    const c3 = createCombat([h3, sp3], wallBetween, new ScriptedRng(3));
    const ev3 = [...c3.begin()];
    for (let i = 0; i < 10 && c3.activeId !== 'spider'; i++) ev3.push(...c3.execute({ type: 'endTurn' }));
    sp3.pos = at(5, 5); // steps round to the hero
    const hit = c3.execute({ type: 'action', actionId: 'club', targetId: 'player' });
    expect(feats(hit, 'ambush')).toHaveLength(1);
    // Last Stand.
    const h4 = hero(4, 4, [], { hp: 3 });
    h4.resources['lastStand'] = { name: 'Last Stand', current: 1, max: 1, refresh: 'floor' };
    const s4 = start([h4, foe('a', 5, 4)], 'a');
    s4.rng.queue = [18, 6, 6];
    const ls = s4.combat.execute({ type: 'action', actionId: 'club', targetId: 'player' });
    expect(feats(ls, 'lastStand')).toHaveLength(1);
  });

  it('tacticalShift with Second Wind', () => {
    const h = hero(4, 4, ['tacticalShift'], { hp: 100 });
    h.actions.push({ id: 'second_wind', name: 'Second Wind', description: '', cost: 'bonus', targeting: { kind: 'self' }, heal: '1d10', effects: ['secondWind'] });
    const { combat } = start([h, foe('a', 8, 4)], 'player');
    const ev = combat.execute({ type: 'action', actionId: 'second_wind' });
    expect(feats(ev, 'tacticalShift')).toHaveLength(1);
  });
});

describe('speed 0 and Dash/Disengage', () => {
  it('a restrained or grappled creature cannot Dash or Disengage, and is told why', () => {
    const h = hero(4, 4);
    h.conditions.push({ condition: 'grappled', rounds: null });
    const { combat } = start([h, foe('a', 5, 4)], 'player');
    expect(combat.canUse('dash')).toEqual({ ok: false, reason: 'You cannot move' });
    expect(combat.canUse('disengage')).toEqual({ ok: false, reason: 'You cannot move' });
    h.conditions.length = 0;
    expect(combat.canUse('dash').ok).toBe(true);
  });
});

describe('Shove with Multiattack and pushPreview', () => {
  const brute = (): Creature =>
    foe('brute', 3, 4, {
      abilities: { str: 22, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 4,
      actions: [
        { ...club, id: 'a1', attack: { bonus: 20 } },
        { ...club, id: 'a2', attack: { bonus: 20 } },
        { id: 'multi', name: 'Multiattack', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, multiattack: ['a1', 'a2'] },
      ],
    });

  it('a shove replaces the first attack of the sequence; the rest of the sequence still strikes', () => {
    const h = hero(4, 4);
    const b = brute();
    const { combat, rng } = start([h, b], 'brute');
    rng.queue = [1, 15, 3];
    const ev = combat.execute({ type: 'action', actionId: 'shove_trip', targetId: 'player' });
    expect(ev.filter((e) => e.type === 'attackRoll')).toHaveLength(1);
    expect(h.conditions.some((c) => c.condition === 'prone')).toBe(true);
    expect(combat.turn.actionUsed).toBe(true);
  });

  it('pushPreview shows the hazard and 1d6 per depth for a push, and nothing without a drop', () => {
    const net = createOpenRoomNav(16, 9, { chasms: [at(6, 4)], lava: [at(2, 6)] });
    const h = hero(4, 4);
    const f = foe('f', 5, 4);
    const g = foe('g', 5, 5);
    const rng = new ScriptedRng(2);
    const combat = createCombat([h, f, g], net, rng, { depth: 7 });
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    expect(pushPreview(combat, 'shove_push', 'f')).toEqual({ hazard: 'fall', damage: '7d6' });
    expect(pushPreview(combat, 'shove_push', 'g')).toBeNull();
    expect(pushPreview(combat, 'shove_trip', 'f')).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, Creature, GameEvent, NavGrid } from '../core/types';
import { applyLevelUp, createCharacter, enterFloor, takeShortRest, syncFromCreature, toCreature } from './character';
import { computeAreaCells, createCombat } from './combat';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { FIXTURE_ITEMS, ScriptedRng, fixtureMonster, makeBuild, mon, spawn, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(12, 8);

function hero(x: number, y: number, build: Parameters<typeof makeBuild>[0] = {}, level = 1): Creature {
  let pc = createCharacter(makeBuild({ speciesId: 'dwarf', ...build }));
  for (let i = 1; i < level; i++) pc = applyLevelUp(pc, {});
  const c = toCreature(pc, { x, y });
  // Most tests want a mortal hero; Last Stand has its own tests.
  delete c.resources['lastStand'];
  return c;
}

function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Start a fight where `activeId` acts first, with scripted dice available afterwards. */
function arena(creatures: Creature[], activeId = 'player', grid: NavGrid = nav): { combat: CombatApi; rng: ScriptedRng } {
  const rng = new ScriptedRng(7);
  const combat = startCombat(creatures, grid, rng, activeId);
  return { combat, rng };
}

const customAction = (over: Partial<ActionDef> & Pick<ActionDef, 'id'>): ActionDef => ({
  name: over.id,
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  ...over,
});

function custom(id: string, x: number, y: number, actions: ActionDef[], over: Partial<Parameters<typeof mon>[0]> = {}): Creature {
  return instantiateMonster(mon({ id, name: id, actions, ...over }), id, { x, y });
}

describe('initiative and turn order', () => {
  it('orders by initiative, player winning ties', () => {
    const rng = new ScriptedRng(1);
    const h = hero(1, 1);
    const r = spawn('giant_rat', 'rat', 5, 1);
    const combat = createCombat([r, h], nav, rng);
    rng.queue = [11, 10]; // rat 11+0, hero 10+1
    const events = combat.begin();
    expect(combat.order).toEqual(['player', 'rat']);
    expect(events[0]).toMatchObject({ type: 'combatStart', order: ['player', 'rat'] });
    expect(events.some((e) => e.type === 'roundStart')).toBe(true);
    expect(combat.activeId).toBe('player');
    expect(combat.round).toBe(1);
  });

  it('puts a higher roller first and advances rounds', () => {
    const rng = new ScriptedRng(1);
    const combat = createCombat([hero(1, 1), spawn('giant_rat', 'rat', 5, 1)], nav, rng);
    rng.queue = [1, 20];
    combat.begin();
    expect(combat.order).toEqual(['rat', 'player']);
    expect(combat.activeId).toBe('rat');
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('player');
    const ev = combat.execute({ type: 'endTurn' });
    expect(combat.round).toBe(2);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['turnEnd', 'roundStart', 'turnStart']));
  });

  it('refuses begin twice and execute before begin', () => {
    const c = createCombat([hero(1, 1), spawn('giant_rat', 'rat', 5, 1)], nav, new Rng(1));
    expect(() => c.execute({ type: 'endTurn' })).toThrow();
    c.begin();
    expect(() => c.begin()).toThrow();
  });
});

describe('attack rolls', () => {
  it('hits, deals damage and ends the fight on a kill', () => {
    const { combat, rng } = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    rng.queue = [7, 5, 1]; // 7+5 = 12 vs AC 12 hits; 5+3 = 8 damage kills a 7 HP rat (Savage Attacker's second damage roll, a 1, is lower)
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    const roll = ofType(ev, 'attackRoll')[0]!;
    expect(roll).toMatchObject({ d20: 7, bonus: 5, total: 12, targetAc: 12, outcome: 'hit', mode: 'normal', reaction: false });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 8, damageType: 'slashing', hpAfter: 0, crit: false });
    expect(ofType(ev, 'death')[0]?.creatureId).toBe('rat');
    expect(ofType(ev, 'combatEnd')[0]?.winner).toBe('player');
    expect(combat.isOver).toBe(true);
    expect(combat.winner).toBe('player');
    expect(() => combat.execute({ type: 'endTurn' })).toThrow(/over/);
  });

  it('misses below AC without damage', () => {
    const { combat, rng } = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    rng.queue = [6];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev, 'attackRoll')[0]?.outcome).toBe('miss');
    expect(ofType(ev, 'damage')).toHaveLength(0);
  });

  it('natural 1 always misses and natural 20 always hits and crits with doubled dice', () => {
    const a = arena([hero(3, 3), custom('wall', 4, 3, [], { ac: 5 })]);
    a.rng.queue = [1];
    expect(ofType(a.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' }), 'attackRoll')[0]?.outcome).toBe('fumble');
    const b = arena([hero(3, 3), custom('wall', 4, 3, [], { ac: 40, hp: 100 })]);
    b.rng.queue = [20, 8, 8];
    const ev = b.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' });
    expect(ofType(ev, 'attackRoll')[0]?.outcome).toBe('crit');
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 8 + 8 + 3, crit: true });
  });

  it('Champion crits on 19', () => {
    const { combat, rng } = arena([hero(3, 3, {}, 3), custom('wall', 4, 3, [], { ac: 40, hp: 100 })]);
    rng.queue = [19, 1, 1];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' });
    expect(ofType(ev, 'attackRoll')[0]?.outcome).toBe('crit');
  });

  it('uses advantage and disadvantage from conditions', () => {
    const a = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    (a.combat.creature('rat') as Creature).conditions.push({ condition: 'restrained', rounds: null });
    a.rng.queue = [3, 18, 1];
    const r1 = ofType(a.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' }), 'attackRoll')[0]!;
    expect(r1).toMatchObject({ mode: 'advantage', d20: 18, dice: [3, 18] });

    const b = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    (b.combat.creature('player') as Creature).conditions.push({ condition: 'poisoned', rounds: null });
    b.rng.queue = [18, 4];
    const r2 = ofType(b.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' }), 'attackRoll')[0]!;
    expect(r2).toMatchObject({ mode: 'disadvantage', d20: 4 });

    // Advantage and disadvantage cancel.
    const c = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    (c.combat.creature('player') as Creature).conditions.push({ condition: 'poisoned', rounds: null });
    (c.combat.creature('rat') as Creature).conditions.push({ condition: 'restrained', rounds: null });
    c.rng.queue = [9, 1];
    expect(ofType(c.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' }), 'attackRoll')[0]).toMatchObject({ mode: 'normal', dice: [9] });
  });

  it('gives disadvantage on ranged attacks with a hostile adjacent or at long range', () => {
    const wide = createOpenRoomNav(40, 8);
    const a = arena([hero(1, 3), spawn('giant_rat', 'rat', 9, 3)], 'player', wide); // distance 8 > normal range 6
    a.rng.queue = [10, 10];
    expect(ofType(a.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' }), 'attackRoll')[0]?.mode).toBe('disadvantage');
    const b = arena([hero(1, 3), spawn('giant_rat', 'rat', 4, 3)], 'player', wide);
    b.rng.queue = [10, 10];
    expect(ofType(b.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' }), 'attackRoll')[0]?.mode).toBe('normal');
    const c = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)], 'player', wide);
    c.rng.queue = [10, 10];
    expect(ofType(c.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' }), 'attackRoll')[0]?.mode).toBe('disadvantage');
    // Beyond long range is illegal.
    const d = arena([hero(1, 3), spawn('giant_rat', 'rat', 30, 3)], 'player', wide);
    expect(() => d.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' })).toThrow(/Invalid target/);
  });

  it('requires line of sight for ranged attacks', () => {
    const walled = createOpenRoomNav(12, 8, { walls: [{ x: 5, y: 3 }] });
    const { combat } = arena([hero(2, 3), spawn('giant_rat', 'rat', 8, 3)], 'player', walled);
    expect(combat.validTargets('throw_javelin')).toEqual([]);
    expect(() => combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' })).toThrow();
  });

  it('house rule: ranged attackers 2+ elevation steps above get +1', () => {
    const high = createOpenRoomNav(12, 8, { elevation: (p) => (p.x <= 2 ? 2 : 0) });
    const a = arena([hero(1, 3), spawn('giant_rat', 'rat', 6, 3)], 'player', high);
    a.rng.queue = [10];
    expect(ofType(a.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' }), 'attackRoll')[0]?.bonus).toBe(6);
    const low = createOpenRoomNav(12, 8, { elevation: (p) => (p.x <= 2 ? 1 : 0) });
    const b = arena([hero(1, 3), spawn('giant_rat', 'rat', 6, 3)], 'player', low);
    b.rng.queue = [10];
    expect(ofType(b.combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'rat' }), 'attackRoll')[0]?.bonus).toBe(5);
  });

  it('crits automatically on a hit against a paralyzed adjacent target', () => {
    const { combat, rng } = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    (combat.creature('rat') as Creature).conditions.push({ condition: 'paralyzed', rounds: null });
    rng.queue = [15, 3, 5, 5];
    expect(ofType(combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' }), 'attackRoll')[0]).toMatchObject({ outcome: 'crit', mode: 'advantage' });
  });

  it('human Heroic Inspiration rerolls the first miss', () => {
    const h = hero(3, 3, { speciesId: 'human' });
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 4, 3)]);
    rng.queue = [2, 15, 1];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ev.some((e) => e.type === 'log' && e.text.includes('Heroic Inspiration'))).toBe(true);
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ d20: 15, outcome: 'hit' });
    expect(h.resources['inspiration']?.current).toBe(0);
  });
});

describe('hitChance matches reality', () => {
  function empirical(setup: (i: number) => { combat: CombatApi; id: string }, trials = 3000): { p: number; claimed: number } {
    let hits = 0;
    let claimed = 0;
    for (let i = 0; i < trials; i++) {
      const { combat, id } = setup(i);
      if (i === 0) claimed = combat.hitChance(id, 'foe') as number;
      const ev = combat.execute({ type: 'action', actionId: id, targetId: 'foe' });
      const o = ofType(ev, 'attackRoll')[0]!.outcome;
      if (o === 'hit' || o === 'crit') hits++;
    }
    return { p: hits / trials, claimed };
  }
  const make = (i: number, ac: number, level = 1, cond?: Creature['conditions'][number]['condition'], who: 'foe' | 'player' = 'foe') => {
    const h = hero(3, 3, {}, level);
    const foe = custom('foe', 4, 3, [], { ac, hp: 9999 });
    if (cond) (who === 'foe' ? foe : h).conditions.push({ condition: cond, rounds: null });
    const rng = new Rng(1000 + i);
    return { combat: startCombat([h, foe], nav, rng, 'player'), id: 'atk_longsword' };
  };

  it('normal roll', () => {
    const r = empirical((i) => make(i, 15));
    expect(r.claimed).toBeCloseTo(0.55, 10);
    expect(Math.abs(r.p - r.claimed)).toBeLessThan(0.035);
  });

  it('advantage and disadvantage', () => {
    const adv = empirical((i) => make(i, 15, 1, 'restrained'));
    expect(adv.claimed).toBeCloseTo(1 - 0.45 * 0.45, 10);
    expect(Math.abs(adv.p - adv.claimed)).toBeLessThan(0.035);
    const dis = empirical((i) => make(i, 15, 1, 'poisoned', 'player'));
    expect(dis.claimed).toBeCloseTo(0.55 * 0.55, 10);
    expect(Math.abs(dis.p - dis.claimed)).toBeLessThan(0.035);
  });

  it('includes natural 1/20 and the Champion crit range', () => {
    const impossible = empirical((i) => make(i, 40), 2000);
    expect(impossible.claimed).toBeCloseTo(0.05, 10);
    const champ = empirical((i) => make(i, 40, 3), 2000);
    expect(champ.claimed).toBeCloseTo(0.1, 10);
    expect(Math.abs(champ.p - 0.1)).toBeLessThan(0.03);
    const trivial = make(0, 1);
    expect(trivial.combat.hitChance('atk_longsword', 'foe')).toBeCloseTo(0.95, 10);
  });

  it('save-based actions report the failed-save chance', () => {
    const drake = spawn('fire_drake', 'foe', 4, 3);
    const h = hero(3, 3);
    const combat = startCombat([h, drake], nav, new Rng(3), 'foe');
    // hero DEX +1 vs DC 12: needs 11+, succeeds on 10/20, so fails 50%
    expect(combat.hitChance('fire_burst', 'player')).toBeCloseTo(0.5, 10);
    expect(combat.hitChance('dodge', 'player')).toBeNull();
  });
});

describe('damage rules', () => {
  const hit = (target: Creature, type: Parameters<typeof customAction>[0]['damage'], dice = '10') => {
    void type;
    void dice;
    return target;
  };
  void hit;

  function strike(damage: string, type: NonNullable<ActionDef['damage']>[number]['type'], target: Creature, tempHp = 0) {
    const attacker = custom('atk', 3, 3, [customAction({ id: 'zap', attack: { bonus: 20 }, damage: [{ dice: damage, type }] })]);
    target.tempHp = tempHp;
    if (target.faction === 'enemy') attacker.faction = 'player';
    const { combat, rng } = arena([attacker, target], 'atk');
    rng.queue = [10];
    const ev = combat.execute({ type: 'action', actionId: 'zap', targetId: target.id });
    return { ev, dmg: ofType(ev, 'damage')[0]!, target };
  }

  it('applies resistance, vulnerability and immunity', () => {
    const skeleton = spawn('skeleton', 'sk', 4, 3);
    expect(strike('10', 'bludgeoning', skeleton).dmg).toMatchObject({ amount: 20, modifier: 'vulnerable' });
    expect(strike('10', 'poison', spawn('skeleton', 'sk', 4, 3)).dmg).toMatchObject({ amount: 0, modifier: 'immune' });
    const dwarf = hero(4, 3);
    expect(strike('9', 'poison', dwarf).dmg).toMatchObject({ amount: 4, modifier: 'resisted' });
    expect(strike('9', 'fire', hero(4, 3)).dmg).toMatchObject({ amount: 9, modifier: 'none' });
  });

  it('absorbs damage with temporary hit points first', () => {
    const t = hero(4, 3);
    const hp = t.hp;
    const { dmg, target } = strike('5', 'fire', t, 3);
    expect(dmg.amount).toBe(5);
    expect(target.tempHp).toBe(0);
    expect(target.hp).toBe(hp - 2);
  });

  it('kills the player at 0 HP with no death saves and ends the fight', () => {
    const t = hero(4, 3);
    const { ev, target } = strike('99', 'fire', t);
    expect(target.dead).toBe(true);
    expect(ofType(ev, 'death')[0]?.creatureId).toBe('player');
    expect(ofType(ev, 'combatEnd')[0]?.winner).toBe('enemy');
  });

  it('heals without exceeding max HP', () => {
    const h = hero(3, 3);
    h.hp = 3;
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 8, 3)]);
    rng.queue = [5];
    const ev = combat.execute({ type: 'action', actionId: 'second_wind' });
    expect(ofType(ev, 'heal')[0]).toMatchObject({ amount: 6, hpAfter: 9 });
    expect(h.resources['secondWind']?.current).toBe(1);
  });
});

describe('movement and opportunity attacks', () => {
  it('walks a path, spends movement and emits a move event', () => {
    const { combat } = arena([hero(3, 3), spawn('giant_rat', 'rat', 10, 6)]);
    const ev = combat.execute({ type: 'move', path: [{ x: 4, y: 3 }, { x: 5, y: 3 }] });
    expect(ofType(ev, 'move')[0]?.path).toEqual([{ x: 4, y: 3 }, { x: 5, y: 3 }]);
    expect(combat.creature('player')?.pos).toEqual({ x: 5, y: 3 });
    expect(combat.turn.movementLeft).toBe(4);
    expect(combat.reachable().every((c) => c.cost <= 4)).toBe(true);
  });

  it('rejects illegal paths without changing state', () => {
    const { combat } = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    const before = JSON.stringify(combat.creatures());
    expect(() => combat.execute({ type: 'move', path: [{ x: 4, y: 3 }] })).toThrow(/occupied/);
    expect(() => combat.execute({ type: 'move', path: [{ x: 5, y: 5 }] })).toThrow(/contiguous/);
    const far = Array.from({ length: 7 }, (_, i) => ({ x: 3, y: 4 + i }));
    expect(() => combat.execute({ type: 'move', path: far.slice(0, 4).concat([{ x: 3, y: 8 }, { x: 3, y: 9 }, { x: 3, y: 10 }]) })).toThrow();
    expect(() => combat.execute({ type: 'move', path: [] })).toThrow();
    // cannot pass through a living creature even if the end cell is free
    expect(() => combat.execute({ type: 'move', path: [{ x: 4, y: 3 }, { x: 5, y: 3 }] })).toThrow(/occupied/);
    expect(JSON.stringify(combat.creatures())).toBe(before);
    expect(combat.turn.movementLeft).toBe(6);
  });

  it('provokes an opportunity attack when leaving reach, once per round', () => {
    const { combat, rng } = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    rng.queue = [2];
    const ev = combat.execute({ type: 'move', path: [{ x: 2, y: 3 }, { x: 1, y: 3 }] });
    const roll = ofType(ev, 'attackRoll')[0]!;
    expect(roll).toMatchObject({ attackerId: 'rat', targetId: 'player', reaction: true });
    expect(ev.findIndex((e) => e.type === 'attackRoll')).toBeLessThan(ev.findIndex((e) => e.type === 'move'));
    expect(ofType(ev, 'attackRoll')).toHaveLength(1);
    expect(combat.creature('player')?.pos).toEqual({ x: 1, y: 3 });
  });

  it('does not provoke after Disengage, and moving within reach does not provoke', () => {
    const a = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    a.combat.execute({ type: 'action', actionId: 'disengage' });
    const ev = a.combat.execute({ type: 'move', path: [{ x: 2, y: 3 }, { x: 1, y: 3 }] });
    expect(ofType(ev, 'attackRoll')).toHaveLength(0);
    const b = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    expect(ofType(b.combat.execute({ type: 'move', path: [{ x: 3, y: 4 }] }), 'attackRoll')).toHaveLength(0);
  });

  it('stops the move when the mover dies to an opportunity attack', () => {
    const h = hero(3, 3);
    h.hp = 1;
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 4, 3)]);
    rng.queue = [20, 6, 6];
    const ev = combat.execute({ type: 'move', path: [{ x: 2, y: 3 }, { x: 1, y: 3 }] });
    expect(ofType(ev, 'move')).toHaveLength(0);
    expect(h.pos).toEqual({ x: 3, y: 3 });
    expect(h.dead).toBe(true);
    expect(combat.isOver).toBe(true);
  });

  it('dash adds movement; Dodge imposes disadvantage on attackers', () => {
    const a = arena([hero(1, 1), spawn('giant_rat', 'rat', 10, 6)]);
    a.combat.execute({ type: 'action', actionId: 'dash' });
    expect(a.combat.turn.movementLeft).toBe(12);
    expect(() => a.combat.execute({ type: 'action', actionId: 'dodge' })).toThrow(/No action/);
    const b = arena([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)]);
    b.combat.execute({ type: 'action', actionId: 'dodge' });
    b.combat.execute({ type: 'endTurn' });
    b.rng.queue = [15, 4];
    expect(ofType(b.combat.execute({ type: 'action', actionId: 'slash', targetId: 'player' }), 'attackRoll')[0]).toMatchObject({ mode: 'disadvantage', d20: 4 });
  });
});

describe('conditions', () => {
  const scare = customAction({
    id: 'scare',
    targeting: { kind: 'creature', melee: false, range: 10 },
    save: { ability: 'wis', dc: 50, halfOnSave: false },
    applies: { condition: 'blinded', rounds: 1 },
  });

  it('counts rounds from the source creature turns', () => {
    const caster = custom('caster', 6, 3, [scare]);
    const h = hero(2, 3);
    const { combat } = arena([h, caster], 'caster');
    const ev = combat.execute({ type: 'action', actionId: 'scare', targetId: 'player' });
    expect(ofType(ev, 'conditionAdded')[0]).toMatchObject({ creatureId: 'player', condition: 'blinded' });
    expect(h.conditions).toHaveLength(1);
    combat.execute({ type: 'endTurn' }); // end of the caster's turn: still on its first following turn
    expect(h.conditions).toHaveLength(1);
    combat.execute({ type: 'endTurn' }); // hero's turn ends: not the source's turn
    expect(h.conditions).toHaveLength(1);
    const ev2 = combat.execute({ type: 'endTurn' }); // caster's next turn ends
    expect(ofType(ev2, 'conditionRemoved')[0]?.condition).toBe('blinded');
    expect(h.conditions).toHaveLength(0);
  });

  it('repeats saves at the end of the holder turn', () => {
    const fear = customAction({
      id: 'fear',
      targeting: { kind: 'creature', melee: false, range: 10 },
      save: { ability: 'wis', dc: 50, halfOnSave: false },
      applies: { condition: 'frightened', saveEnds: { ability: 'wis', dc: 1 } },
    });
    const h = hero(2, 3);
    const { combat } = arena([h, custom('caster', 6, 3, [fear])], 'caster');
    combat.execute({ type: 'action', actionId: 'fear', targetId: 'player' });
    expect(h.conditions[0]).toMatchObject({ condition: 'frightened', rounds: null });
    combat.execute({ type: 'endTurn' });
    const ev = combat.execute({ type: 'endTurn' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ creatureId: 'player', dc: 1, success: true });
    expect(ofType(ev, 'conditionRemoved')[0]?.condition).toBe('frightened');
  });

  it('skips the turns of incapacitated creatures and auto-fails STR/DEX saves', () => {
    const rat = spawn('giant_rat', 'rat', 8, 3);
    const { combat } = arena([hero(2, 3), rat]);
    rat.conditions.push({ condition: 'paralyzed', rounds: null });
    for (let i = 0; i < 3; i++) {
      const ev = combat.execute({ type: 'endTurn' });
      expect(combat.activeId).toBe('player');
      expect(ev.some((e) => e.type === 'log' && e.text.includes('incapacitated'))).toBe(true);
    }
    const drake = spawn('fire_drake', 'drake', 4, 3);
    const h = hero(3, 3);
    h.hp = h.maxHp = 100;
    h.conditions.push({ condition: 'paralyzed', rounds: null });
    const b = arena([h, drake], 'drake');
    const ev = b.combat.execute({ type: 'action', actionId: 'fire_burst' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ d20: 0, success: false });
  });

  it('wolf bite knocks prone; prone creatures stand up at turn start for half their speed', () => {
    const w = spawn('wolf', 'wolf', 4, 3);
    const h = hero(3, 3);
    h.hp = h.maxHp = 100;
    const { combat, rng } = arena([h, w], 'wolf');
    rng.queue = [20, 6, 6, 1]; // crit; damage dice; failed STR save
    const ev = combat.execute({ type: 'action', actionId: 'bite', targetId: 'player' });
    expect(ofType(ev, 'conditionAdded')[0]?.condition).toBe('prone');
    const ev2 = combat.execute({ type: 'endTurn' });
    expect(ofType(ev2, 'conditionRemoved')[0]?.condition).toBe('prone');
    expect(combat.turn.movementLeft).toBe(3);
  });

  it('availableActions adds Break Free while restrained, and Large creatures occupy one cell', () => {
    const h = hero(3, 3);
    const ogre = spawn('ogre', 'ogre', 5, 3);
    expect(ogre.size).toBe('large');
    const { combat } = arena([h, ogre]);
    expect(combat.availableActions().map((a) => a.id)).not.toContain('break_free');
    expect(combat.availableActions().length).toBe(h.actions.length);
    h.conditions.push({ condition: 'restrained', rounds: null });
    expect(combat.availableActions().map((a) => a.id)).toContain('break_free');
    h.conditions.length = 0;
    // The hero can step into the cell right next to the ogre: it blocks exactly its own cell.
    expect(() => combat.execute({ type: 'move', path: [{ x: 4, y: 3 }] })).not.toThrow();
    expect(() => combat.execute({ type: 'move', path: [{ x: 5, y: 3 }] })).toThrow(/occupied/);
  });

  it('keeps a restraint until broken; Break Free is a generated STR check action', () => {
    const h = hero(3, 3);
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 9, 6)]);
    expect(combat.canUse('break_free').ok).toBe(false);
    h.conditions.push({ condition: 'restrained', rounds: null });
    expect(combat.canUse('break_free').ok).toBe(true);
    rng.queue = [2];
    combat.execute({ type: 'action', actionId: 'break_free' });
    expect(h.conditions).toHaveLength(1);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [20];
    const ev = combat.execute({ type: 'action', actionId: 'break_free' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ ability: 'str', dc: 12, success: true });
    expect(h.conditions).toHaveLength(0);
  });

  it('restrained creatures have no movement', () => {
    const h = hero(3, 3);
    h.conditions.push({ condition: 'restrained', rounds: null });
    const { combat } = arena([h, spawn('giant_rat', 'rat', 9, 6)]);
    expect(combat.turn.movementLeft).toBe(0);
  });
});

describe('resources', () => {
  it('Second Wind: two uses, bonus action, then none', () => {
    const h = hero(1, 1);
    h.hp = 2;
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 10, 6)]);
    rng.queue = [3, 3];
    combat.execute({ type: 'action', actionId: 'second_wind' });
    expect(h.hp).toBe(2 + 4);
    expect(() => combat.execute({ type: 'action', actionId: 'second_wind' })).toThrow(/bonus/);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'action', actionId: 'second_wind' });
    expect(h.resources['secondWind']?.current).toBe(0);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(combat.canUse('second_wind')).toMatchObject({ ok: false });
  });

  it('Action Surge grants a second action after the first is used', () => {
    const h = hero(3, 3, {}, 2);
    const { combat, rng } = arena([h, custom('wall', 4, 3, [], { ac: 5, hp: 500 })]);
    expect(combat.canUse('action_surge')).toMatchObject({ ok: false });
    rng.queue = [15, 1];
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' });
    expect(() => combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' })).toThrow(/No action/);
    combat.execute({ type: 'action', actionId: 'action_surge' });
    expect(combat.turn.actionUsed).toBe(false);
    rng.queue = [15, 1];
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'wall' });
    expect(h.resources['actionSurge']?.current).toBe(0);
  });

  it('potions heal as a bonus action and sync back to the inventory', () => {
    const pc = createCharacter(makeBuild({ speciesId: 'dwarf' }));
    const h = toCreature(pc, { x: 1, y: 1 });
    h.hp = 1;
    const { combat, rng } = arena([h, spawn('giant_rat', 'rat', 10, 6)]);
    rng.queue = [4, 4];
    const ev = combat.execute({ type: 'action', actionId: 'drink_potion_healing' });
    expect(ofType(ev, 'heal')[0]?.amount).toBe(10);
    expect(h.resources['item:potion_healing']?.current).toBe(1);
    const synced = syncFromCreature(pc, h);
    expect(synced.inventory.find((s) => s.itemId === 'potion_healing')?.quantity).toBe(1);
    expect(synced.hp).toBe(11);
  });

  it('recharge abilities are spent and come back on a roll', () => {
    const drake = spawn('fire_drake', 'drake', 4, 3);
    const h = hero(3, 3);
    h.hp = h.maxHp = 200;
    const { combat, rng } = arena([h, drake], 'drake');
    combat.execute({ type: 'action', actionId: 'fire_burst' });
    expect(combat.canUse('fire_burst')).toMatchObject({ ok: false, reason: 'Recharging' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [3];
    let ev = combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('drake');
    expect(combat.canUse('fire_burst').ok).toBe(false);
    combat.execute({ type: 'endTurn' });
    rng.queue = [6];
    ev = combat.execute({ type: 'endTurn' });
    expect(ev.some((e) => e.type === 'log' && e.text.includes('recharges'))).toBe(true);
    expect(combat.canUse('fire_burst').ok).toBe(true);
  });

  it('multiattack resolves each sub-attack', () => {
    const { combat, rng } = arena([hero(3, 3), spawn('goblin_boss', 'boss', 4, 3)], 'boss');
    rng.queue = [20, 1, 1, 20, 1, 1];
    const ev = combat.execute({ type: 'action', actionId: 'multiattack', targetId: 'player' });
    expect(ofType(ev, 'attackRoll')).toHaveLength(2);
  });
});

describe('areas', () => {
  it('sphere covers the right cells and the fire burst hits only creatures inside', () => {
    const drake = spawn('fire_drake', 'drake', 5, 4);
    const near = hero(6, 4);
    near.hp = near.maxHp = 100;
    const far = custom('far', 10, 4, []);
    const { combat, rng } = arena([near, drake, far], 'drake');
    expect(combat.areaCells('fire_burst', { x: 0, y: 0 })).toHaveLength(21); // radius 2
    rng.queue = [6, 6, 6, 6, 20];
    const ev = combat.execute({ type: 'action', actionId: 'fire_burst' });
    expect(ofType(ev, 'damage').map((d) => d.targetId)).toEqual(['player']);
    expect(ofType(ev, 'damage')[0]?.amount).toBe(12); // half of 24 on a successful save
    expect(far.hp).toBe(far.maxHp);
    expect(drake.hp).toBe(drake.maxHp);
  });

  it('full damage on a failed save', () => {
    const drake = spawn('fire_drake', 'drake', 5, 4);
    const near = hero(6, 4);
    near.hp = near.maxHp = 100;
    const { combat, rng } = arena([near, drake], 'drake');
    rng.queue = [6, 6, 6, 6, 1];
    expect(ofType(combat.execute({ type: 'action', actionId: 'fire_burst' }), 'damage')[0]?.amount).toBe(24);
  });

  it('point-targeted spheres respect range and hit everyone inside, allies included', () => {
    const bomb = customAction({
      id: 'bomb',
      targeting: { kind: 'point', range: 6, area: { shape: 'sphere', size: 1 } },
      save: { ability: 'dex', dc: 50, halfOnSave: true },
      damage: [{ dice: '4', type: 'fire' }],
    });
    const thrower = custom('thrower', 1, 1, [bomb]);
    const ally = custom('ally', 5, 1, []);
    const h = hero(6, 2);
    h.hp = h.maxHp = 100;
    const { combat } = arena([thrower, ally, h], 'thrower');
    expect(combat.areaCells('bomb', { x: 5, y: 1 })).toHaveLength(9);
    expect(() => combat.execute({ type: 'action', actionId: 'bomb', point: { x: 11, y: 7 } })).toThrow(/point/);
    const ev = combat.execute({ type: 'action', actionId: 'bomb', point: { x: 5, y: 1 } });
    expect(ofType(ev, 'damage').map((d) => d.targetId).sort()).toEqual(['ally', 'player']);
  });

  it('lines and cones follow the aimed direction and never include the caster', () => {
    const line = computeAreaCells(nav, { x: 2, y: 3 }, { x: 8, y: 3 }, 0, { shape: 'line', size: 4 });
    expect(line.map((p) => `${p.x},${p.y}`).sort()).toEqual(['3,3', '4,3', '5,3', '6,3']);
    const cone = computeAreaCells(nav, { x: 2, y: 3 }, { x: 8, y: 3 }, 0, { shape: 'cone', size: 3 });
    const keys = new Set(cone.map((p) => `${p.x},${p.y}`));
    expect(keys.has('5,3')).toBe(true);
    expect(keys.has('6,3')).toBe(false);
    expect(keys.has('1,3')).toBe(false);
    expect(keys.has('2,3')).toBe(false);
    expect(keys.has('5,4')).toBe(true);
    expect(keys.has('3,6')).toBe(false);
  });
});

describe('traits', () => {
  it('Undead Fortitude can keep a zombie at 1 HP, but not against crits', () => {
    const z = spawn('zombie', 'z', 4, 3);
    z.hp = 3;
    const { combat, rng } = arena([hero(3, 3), z]);
    rng.queue = [15, 6, 12]; // hit, damage, CON save 12+3 >= 5+9
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'z' });
    expect(z.hp).toBe(1);
    expect(z.dead).toBe(false);
    expect(ofType(ev, 'damage')[0]?.hpAfter).toBe(1);
    expect(ofType(ev, 'death')).toHaveLength(0);

    const z2 = spawn('zombie', 'z', 4, 3);
    z2.hp = 3;
    const b = arena([hero(3, 3), z2]);
    b.rng.queue = [20, 4, 4];
    b.combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'z' });
    expect(z2.dead).toBe(true);
  });

  it('Pack Tactics grants advantage when an ally is next to the target', () => {
    const w1 = spawn('wolf', 'w1', 4, 3);
    const w2 = spawn('wolf', 'w2', 4, 4);
    const { combat, rng } = arena([hero(3, 3), w1, w2], 'w1');
    rng.queue = [3, 14, 1, 1];
    expect(ofType(combat.execute({ type: 'action', actionId: 'bite', targetId: 'player' }), 'attackRoll')[0]?.mode).toBe('advantage');
    const lone = arena([hero(3, 3), spawn('wolf', 'w1', 4, 3)], 'w1');
    lone.rng.queue = [3, 14];
    expect(ofType(lone.combat.execute({ type: 'action', actionId: 'bite', targetId: 'player' }), 'attackRoll')[0]?.mode).toBe('normal');
  });

  it('Nimble Escape makes Disengage a bonus action; Aggressive adds a bonus dash', () => {
    const gob = spawn('goblin_minion', 'g', 3, 3);
    const { combat } = arena([hero(8, 6), gob], 'g');
    combat.execute({ type: 'action', actionId: 'dodge' });
    expect(() => combat.execute({ type: 'action', actionId: 'dash' })).toThrow();
    combat.execute({ type: 'action', actionId: 'disengage' });
    expect(combat.turn.bonusUsed).toBe(true);

    const brute = instantiateMonster(mon({ id: 'brute', traits: ['aggressive'] }), 'b', { x: 1, y: 1 });
    const b = arena([hero(10, 6), brute], 'b');
    b.combat.execute({ type: 'action', actionId: 'aggressive' });
    expect(b.combat.turn.movementLeft).toBe(12);
    expect(b.combat.turn.actionUsed).toBe(false);
  });
});

describe('command validation', () => {
  it('throws clear errors and leaves state untouched', () => {
    const { combat } = arena([hero(3, 3), spawn('giant_rat', 'rat', 8, 3)]);
    expect(() => combat.execute({ type: 'action', actionId: 'nope' })).toThrow(/Unknown action/);
    expect(() => combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' })).toThrow(/Invalid target/);
    expect(() => combat.execute({ type: 'action', actionId: 'atk_longsword' })).toThrow(/Invalid target/);
    expect(() => combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'ghost' })).toThrow();
    expect(combat.turn.actionUsed).toBe(false);
    expect(combat.validTargets('atk_longsword')).toEqual([]);
    expect(combat.validTargets('throw_javelin')).toEqual(['rat']);
    expect(combat.canUse('atk_longsword')).toMatchObject({ ok: true });
  });

  it('does not target the dead and refuses actions on another creature turn', () => {
    const rat = spawn('giant_rat', 'rat', 4, 3);
    rat.dead = true;
    rat.hp = 0;
    const other = spawn('giant_rat', 'rat2', 9, 5);
    const { combat } = arena([hero(3, 3), rat, other]);
    expect(combat.validTargets('atk_longsword')).toEqual([]);
    // dead creatures do not block movement
    expect(() => combat.execute({ type: 'move', path: [{ x: 4, y: 3 }] })).not.toThrow();
  });
});

describe('Last Stand (house rule) and Vex', () => {
  const lethal = customAction({ id: 'smash', attack: { bonus: 30 }, damage: [{ dice: '99', type: 'fire' }] });

  it('keeps the hero at 1 HP once, logs it right after the damage, and only for the player', () => {
    const h = hero(3, 3);
    h.resources['lastStand'] = toCreature(createCharacter(makeBuild()), { x: 0, y: 0 }).resources['lastStand']!;
    expect(h.resources['lastStand']).toMatchObject({ max: 1, current: 1, refresh: 'floor' });
    const orc = custom('orc', 4, 3, [lethal]);
    const { combat, rng } = arena([h, orc], 'orc');
    rng.queue = [10];
    const ev = combat.execute({ type: 'action', actionId: 'smash', targetId: 'player' });
    const i = ev.findIndex((e) => e.type === 'damage');
    expect(ev[i]).toMatchObject({ hpAfter: 1 });
    expect(ev[i + 1]).toMatchObject({ type: 'log', text: 'Last Stand! Sim clings on at 1 HP.'.replace('Sim', h.name) });
    expect(h.hp).toBe(1);
    expect(h.dead).toBe(false);
    expect(h.resources['lastStand']?.current).toBe(0);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [10];
    const ev2 = combat.execute({ type: 'action', actionId: 'smash', targetId: 'player' });
    expect(ev2.some((e) => e.type === 'death')).toBe(true);
    expect(h.dead).toBe(true);
  });

  it('is not available to monsters and resets with enterFloor but not shortRest', () => {
    const rat = spawn('giant_rat', 'rat', 4, 3);
    expect(rat.resources['lastStand']).toBeUndefined();
    const pc0 = createCharacter(makeBuild());
    const spent = { ...pc0, resources: { ...pc0.resources, lastStand: { ...pc0.resources['lastStand']!, current: 0 } } };
    expect(takeShortRest(spent, new Rng(1)).pc.resources['lastStand']?.current).toBe(0);
    expect(enterFloor(spent).resources['lastStand']?.current).toBe(1);
  });

  it('Vex gives advantage on the next attack against the same target', () => {
    const pc = createCharacter(makeBuild({ speciesId: 'dwarf', choices: { fightingStyle: 'defense', startingKit: 'c' } }));
    const h = toCreature(pc, { x: 3, y: 3 });
    const { combat, rng } = arena([h, custom('wall', 4, 3, [], { ac: 5, hp: 500 })]);
    rng.queue = [15, 3];
    const first = ofType(combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'wall' }), 'attackRoll')[0]!;
    expect(first.mode).toBe('normal');
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [3, 12, 1];
    const second = ofType(combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'wall' }), 'attackRoll')[0]!;
    expect(second.mode).toBe('advantage');
    expect(second.d20).toBe(12);
  });
});

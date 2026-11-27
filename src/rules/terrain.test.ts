import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, Creature, GameEvent, GridPos, MonsterDef, NavGrid } from '../core/types';
import { SHOVE_PUSH_ID, SHOVE_TRIP_ID } from './actions';
import { applyLevelUp, createCharacter, suggestedLevelChoices, toCreature } from './character';
import { attacksLeft, combatDepth, createCombat } from './combat';
import { singleHitProbability } from './conditions';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { climbOutCell, planPush } from './terrain';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav, type OpenRoomOptions } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const W = 14;
const H = 9;
const arena = (o: OpenRoomOptions = {}): NavGrid => createOpenRoomNav(W, H, o);

function hero(x: number, y: number, o: { hp?: number; lastStand?: boolean; level?: number } = {}): Creature {
  let pc = createCharacter(makeBuild());
  while (pc.level < (o.level ?? 1)) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  const h = toCreature(pc, { x, y });
  h.maxHp = Math.max(h.maxHp, o.hp ?? 200);
  h.hp = o.hp ?? 200;
  if (!o.lastStand) delete h.resources['lastStand'];
  return h;
}

/** A weakling foe: Strength and Dexterity 1, so a rolled 1 fails any save. */
function foe(id: string, x: number, y: number, over: Partial<MonsterDef> = {}): Creature {
  return instantiateMonster(mon({ id, name: id, hp: 100, ac: 10, abilities: { str: 1, dex: 1, con: 10, int: 10, wis: 10, cha: 10 }, ...over }), id, { x, y });
}

interface Setup {
  combat: CombatApi;
  rng: ScriptedRng;
}

function start(creatures: Creature[], nav: NavGrid, active: string, depth?: number, seed = 1): Setup {
  const rng = new ScriptedRng(seed);
  const combat = createCombat(creatures, nav, rng, depth === undefined ? {} : { depth });
  combat.begin();
  for (let i = 0; i < 50 && combat.activeId !== active; i++) combat.execute({ type: 'endTurn' });
  return { combat, rng };
}

const noLogs = (ev: GameEvent[]): GameEvent[] => ev.filter((e) => e.type !== 'log');
const shapes = (ev: GameEvent[]): string[] => noLogs(ev).map((e) => e.type);
const at = (x: number, y: number): GridPos => ({ x, y });
const chasmRow = (y: number, x0 = 0, x1 = W - 1): GridPos[] => Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, y));

describe('Shove (SRD Unarmed Strike)', () => {
  it('is generated for the hero as two actions and consumes one attack', () => {
    const h = hero(3, 3, { level: 5 });
    const f = foe('f', 4, 3);
    const { combat } = start([h, f], arena(), 'player');
    const names = combat.availableActions().map((a) => a.name);
    expect(names).toContain('Shove: Push');
    expect(names).toContain('Shove: Trip');
    expect(attacksLeft(combat)).toBe(2);
    const first = combat.execute({ type: 'action', actionId: SHOVE_TRIP_ID, targetId: 'f' });
    expect(first.some((e) => e.type === 'saveRoll')).toBe(true);
    // A level 5 hero can shove and then strike with the remaining attack.
    expect(attacksLeft(combat)).toBe(1);
    const atk = combat.availableActions().find((a) => a.id.startsWith('atk_')) as ActionDef;
    expect(combat.canUse(atk.id).ok).toBe(true);
    const second = combat.execute({ type: 'action', actionId: atk.id, targetId: 'f' });
    expect(second.some((e) => e.type === 'attackRoll')).toBe(true);
    expect(attacksLeft(combat)).toBe(0);
  });

  it('uses the target better save against 8 + Strength modifier + proficiency, and a failure knocks prone', () => {
    const h = hero(3, 3);
    const f = foe('f', 4, 3);
    const { combat, rng } = start([h, f], arena(), 'player');
    rng.queue = [1];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_TRIP_ID, targetId: 'f' });
    const save = ev.find((e) => e.type === 'saveRoll') as Extract<GameEvent, { type: 'saveRoll' }>;
    expect(save.dc).toBe(8 + 3 + 2);
    expect(save.success).toBe(false);
    expect(f.conditions.some((c) => c.condition === 'prone')).toBe(true);
    expect(ev.some((e) => e.type === 'conditionAdded' && e.condition === 'prone')).toBe(true);
    // A success does nothing.
    const g = foe('g', 4, 3);
    const s2 = start([hero(3, 3), g], arena(), 'player');
    s2.rng.queue = [20];
    s2.combat.execute({ type: 'action', actionId: SHOVE_TRIP_ID, targetId: 'g' });
    expect(g.conditions).toHaveLength(0);
  });

  it('picks the better of Strength and Dexterity for the target', () => {
    const h = hero(3, 3);
    const f = foe('f', 4, 3, { abilities: { str: 1, dex: 20, con: 10, int: 10, wis: 10, cha: 10 } });
    const { combat, rng } = start([h, f], arena(), 'player');
    rng.queue = [5];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    const save = ev.find((e) => e.type === 'saveRoll') as Extract<GameEvent, { type: 'saveRoll' }>;
    expect(save.ability).toBe('dex');
    expect(save.bonus).toBe(5);
    // DC 13 against +5: it needs 8 or more on the d20, so 13 of 20 succeed and the shove lands 7 times in 20.
    expect(combat.hitChance(SHOVE_PUSH_ID, 'f')).toBeCloseTo(7 / 20, 10);
  });

  it('cannot shove a target more than one size larger', () => {
    const h = hero(3, 3);
    const ogre = foe('ogre', 4, 3, { size: 'huge' });
    const { combat } = start([h, ogre], arena(), 'player');
    expect(combat.validTargets(SHOVE_PUSH_ID)).not.toContain('ogre');
    expect(combat.validTargets(SHOVE_TRIP_ID)).not.toContain('ogre');
    const big = foe('big', 3, 4, { size: 'large' });
    const s = start([hero(3, 3), big], arena(), 'player');
    expect(s.combat.validTargets(SHOVE_PUSH_ID)).toContain('big');
  });

  it('pushes 5 ft away and stops at a wall without moving', () => {
    const h = hero(3, 3);
    const f = foe('f', 4, 3);
    const { combat, rng } = start([h, f], arena({ walls: [at(5, 3)] }), 'player');
    rng.queue = [1];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(f.pos).toEqual(at(4, 3));
    expect(ev.some((e) => e.type === 'move')).toBe(false);
    const g = foe('g', 4, 3);
    const s = start([hero(3, 3), g], arena(), 'player');
    s.rng.queue = [1];
    const ev2 = s.combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'g' });
    expect(g.pos).toEqual(at(5, 3));
    expect(ev2.filter((e) => e.type === 'move')).toEqual([{ type: 'move', creatureId: 'g', path: [at(5, 3)] }]);
  });
});

describe('forced movement into hazards (HOUSE RULE: 1d6 per floor depth)', () => {
  const pit = arena({ chasms: chasmRow(3, 5, 6) });

  it('shove into a chasm at depth 1: move, hazard, damage, prone, climb out, in that order', () => {
    const h = hero(3, 3);
    const f = foe('f', 4, 3);
    const { combat, rng } = start([h, f], pit, 'player', 1);
    rng.queue = [1, 4];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(shapes(ev)).toEqual(['actionUsed', 'saveRoll', 'move', 'hazard', 'damage', 'conditionAdded', 'move']);
    const e = noLogs(ev);
    expect(e[2]).toEqual({ type: 'move', creatureId: 'f', path: [at(5, 3)] });
    expect(e[3]).toEqual({ type: 'hazard', creatureId: 'f', hazard: 'fall', at: at(5, 3), sourceId: 'player' });
    expect(e[4]).toMatchObject({ type: 'damage', targetId: 'f', sourceId: 'player', amount: 4, damageType: 'bludgeoning', hpAfter: 96 });
    expect(e[5]).toEqual({ type: 'conditionAdded', creatureId: 'f', condition: 'prone' });
    // It climbs out onto the cell it was pushed from.
    expect(e[6]).toEqual({ type: 'move', creatureId: 'f', path: [at(4, 3)] });
    expect(f.pos).toEqual(at(4, 3));
    expect(f.conditions.some((c) => c.condition === 'prone')).toBe(true);
  });

  it('rolls one d6 per floor depth', () => {
    for (const depth of [1, 3, 10]) {
      const f = foe('f', 4, 3);
      const { combat, rng } = start([hero(3, 3), f], pit, 'player', depth);
      expect(combatDepth(combat)).toBe(depth);
      rng.queue = [1, ...Array<number>(depth).fill(3)];
      const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
      const dmg = ev.find((e) => e.type === 'damage') as Extract<GameEvent, { type: 'damage' }>;
      expect(dmg.amount).toBe(3 * depth);
    }
    // Default depth is 1.
    const f = foe('f', 4, 3);
    const { combat, rng } = start([hero(3, 3), f], pit, 'player');
    expect(combatDepth(combat)).toBe(1);
    rng.queue = [1, 6, 6];
    const dmg = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' }).find((e) => e.type === 'damage') as Extract<GameEvent, { type: 'damage' }>;
    expect(dmg.amount).toBe(6);
  });

  it('a creature killed by the fall is gone: no climb out, the fight ends', () => {
    const f = foe('f', 4, 3, { hp: 5 });
    const { combat, rng } = start([hero(3, 3), f], pit, 'player', 4);
    rng.queue = [1, 6, 6, 6, 6];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(shapes(ev)).toEqual(['actionUsed', 'saveRoll', 'move', 'hazard', 'damage', 'death', 'combatEnd']);
    expect(f.dead).toBe(true);
    expect(f.pos).toEqual(at(5, 3));
    expect(combat.winner).toBe('player');
  });

  it('lava burns with fire damage', () => {
    const f = foe('f', 4, 3);
    const nav = arena({ lava: [at(5, 3)] });
    const { combat, rng } = start([hero(3, 3), f], nav, 'player', 2);
    rng.queue = [1, 5, 5];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(noLogs(ev).find((e) => e.type === 'hazard')).toMatchObject({ hazard: 'lava', at: at(5, 3) });
    expect(noLogs(ev).find((e) => e.type === 'damage')).toMatchObject({ amount: 10, damageType: 'fire' });
    expect(f.pos).toEqual(at(4, 3));
  });

  it('climbs out onto the nearest free cell when the cell it came from is taken, ties going to the pushed-from cell', () => {
    // Origin (4,3) is the pushed-from cell; with it free the creature returns there.
    const nav = arena({ chasms: [at(5, 3)] });
    expect(climbOutCell(nav, () => false, at(5, 3), at(4, 3))).toEqual(at(4, 3));
    // With the origin occupied, the next nearest free cell to the pit that is closest to the origin.
    const taken = (p: GridPos): boolean => p.x === 4 && p.y === 3;
    const out = climbOutCell(nav, taken, at(5, 3), at(4, 3)) as GridPos;
    expect(Math.max(Math.abs(out.x - 5), Math.abs(out.y - 3))).toBe(1);
    expect(out).toEqual(at(4, 2));
    // It never climbs onto another hazard.
    const wide = arena({ chasms: [at(5, 3), at(5, 2), at(5, 4), at(4, 2)] });
    const out2 = climbOutCell(wide, () => false, at(5, 3), at(4, 3)) as GridPos;
    expect(wide.hazardAt(out2)).toBe('none');
  });

  it('a diagonal shove into a pit that would cut a wall corner stops short', () => {
    const nav = arena({ chasms: [at(5, 4)], walls: [at(5, 3)] });
    const plan = planPush(nav, () => false, at(4, 3), 1, 1, 1);
    expect(plan.path).toHaveLength(0);
  });

  it('flying creatures are not exempt (no fly flag exists yet): they fall like anyone else', () => {
    const f = foe('bat', 4, 3, { speedFt: 60, description: 'a bat with a fly speed' });
    const { combat, rng } = start([hero(3, 3), f], pit, 'player', 1);
    rng.queue = [1, 2];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'bat' });
    expect(ev.some((e) => e.type === 'hazard')).toBe(true);
  });

  it('the Push mastery pushes 10 ft into lava (and into a chasm)', () => {
    for (const [nav, kind] of [
      [arena({ lava: [at(6, 3)] }), 'lava'],
      [arena({ chasms: [at(6, 3)] }), 'fall'],
    ] as const) {
      const h = hero(3, 3);
      const sword = h.actions.find((a) => a.id.startsWith('atk_')) as ActionDef;
      sword.effects = [...(sword.effects ?? []), 'mastery:push'];
      const f = foe('f', 4, 3, { ac: 1 });
      const { combat, rng } = start([h, f], nav, 'player', 1);
      rng.queue = [15, 6, 6, 6, 6, 6, 6];
      const ev = combat.execute({ type: 'action', actionId: sword.id, targetId: 'f' });
      const hz = noLogs(ev).find((e) => e.type === 'hazard');
      expect(hz).toMatchObject({ hazard: kind, at: at(6, 3), sourceId: 'player' });
      const i = noLogs(ev).findIndex((e) => e.type === 'move');
      // The forced move goes through the free cell into the pit in one path.
      expect(noLogs(ev)[i]).toEqual({ type: 'move', creatureId: 'f', path: [at(5, 3), at(6, 3)] });
    }
  });

  it('Thunderwave pushes creatures that fail the save into lava', () => {
    const h = hero(6, 3);
    const caster = foe('mage', 3, 3, {
      actions: [
        {
          id: 'tw',
          name: 'Thunderwave',
          description: '',
          cost: 'action',
          targeting: { kind: 'point', range: 0, area: { shape: 'cone', size: 3 } },
          save: { ability: 'con', dc: 30, halfOnSave: true },
          damage: [{ dice: '1d4', type: 'thunder' }],
          effects: ['thunderwavePush'],
        },
      ],
    });
    const nav = arena({ lava: [at(8, 3)] });
    const { combat, rng } = start([h, caster], nav, 'mage', 1);
    // The damage die comes first, then the Constitution save, then the fall.
    rng.queue = [2, 1, 2, 2];
    const ev = combat.execute({ type: 'action', actionId: 'tw', point: at(6, 3) });
    expect(noLogs(ev).find((e) => e.type === 'hazard')).toMatchObject({ creatureId: 'player', hazard: 'lava', at: at(8, 3), sourceId: 'mage' });
    expect(noLogs(ev).find((e) => e.type === 'move' && e.creatureId === 'player')).toEqual({ type: 'move', creatureId: 'player', path: [at(7, 3), at(8, 3)] });
    expect(h.pos).toEqual(at(7, 3));
    expect(h.conditions.some((c) => c.condition === 'prone')).toBe(true);
  });

  it('the hero shoved in by a monster takes the fall; Last Stand can trigger on it', () => {
    const brute = foe('brute', 3, 3, { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4 });
    const h = hero(4, 3, { hp: 3, lastStand: true });
    const nav = arena({ chasms: [at(5, 3)] });
    const { combat, rng } = start([h, brute], nav, 'brute', 5);
    rng.queue = [1, 6, 6, 6, 6, 6];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'player' });
    expect(noLogs(ev).find((e) => e.type === 'hazard')).toMatchObject({ creatureId: 'player', hazard: 'fall', sourceId: 'brute' });
    expect(noLogs(ev).find((e) => e.type === 'damage')).toMatchObject({ targetId: 'player', amount: 30, hpAfter: 1 });
    expect(h.hp).toBe(1);
    expect(h.resources['lastStand']?.current).toBe(0);
    expect(h.pos).toEqual(at(4, 3));
    expect(h.conditions.some((c) => c.condition === 'prone')).toBe(true);
    expect(ev.some((e) => e.type === 'death')).toBe(false);
  });

  it('without Last Stand the hero can be shoved to death', () => {
    const brute = foe('brute', 3, 3, { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4 });
    const h = hero(4, 3, { hp: 3 });
    const { combat, rng } = start([h, brute], arena({ chasms: [at(5, 3)] }), 'brute', 5);
    rng.queue = [1, 6, 6, 6, 6, 6];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'player' });
    expect(ev.some((e) => e.type === 'death' && e.creatureId === 'player')).toBe(true);
    expect(combat.winner).toBe('enemy');
  });

  it('forced movement never provokes opportunity attacks', () => {
    const h = hero(2, 3);
    const buddy = foe('buddy', 2, 4);
    buddy.faction = 'ally';
    const f = foe('f', 3, 3);
    const { combat, rng } = start([h, buddy, f], arena(), 'player');
    rng.queue = [1];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(f.pos).toEqual(at(4, 3));
    expect(ev.some((e) => e.type === 'attackRoll')).toBe(false);
  });
});

describe('ice', () => {
  it('a pushed creature landing on ice slides one more cell, even into a chasm', () => {
    const nav = arena({ ice: [at(5, 3)], chasms: [at(6, 3)] });
    const f = foe('f', 4, 3);
    const { combat, rng } = start([hero(3, 3), f], nav, 'player', 1);
    rng.queue = [1, 2];
    const ev = combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(shapes(ev)).toEqual(['actionUsed', 'saveRoll', 'move', 'hazard', 'damage', 'conditionAdded', 'move']);
    // One move: onto the ice and off it, into the chasm; then the climb out.
    expect(noLogs(ev)[2]).toEqual({ type: 'move', creatureId: 'f', path: [at(5, 3), at(6, 3)] });
    expect(noLogs(ev)[3]).toMatchObject({ type: 'hazard', hazard: 'fall', at: at(6, 3) });
    expect(f.pos).toEqual(at(5, 3));
  });

  it('slides onto a free ordinary cell, and not when it is blocked or the push did not move it', () => {
    const nav = arena({ ice: [at(5, 3)] });
    const f = foe('f', 4, 3);
    const s = start([hero(3, 3), f], nav, 'player');
    s.rng.queue = [1];
    s.combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' });
    expect(f.pos).toEqual(at(6, 3));
    // Blocked by a creature behind the ice: it stays on the ice.
    const g = foe('g', 4, 3);
    const wall = foe('wall', 6, 3);
    const s2 = start([hero(3, 3), g, wall], nav, 'player');
    s2.rng.queue = [1];
    s2.combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'g' });
    expect(g.pos).toEqual(at(5, 3));
    // Standing on ice and shoved against a wall: no move, no slide.
    const plan = planPush(arena({ ice: [at(4, 3)], walls: [at(5, 3)] }), () => false, at(4, 3), 1, 0, 1);
    expect(plan.path).toHaveLength(0);
  });

  it('standing up from prone on ice costs all the remaining movement (HOUSE RULE)', () => {
    const nav = arena({ ice: [at(4, 3)] });
    const f = foe('f', 4, 3);
    f.conditions.push({ condition: 'prone', rounds: null });
    const s = start([hero(3, 3), f], nav, 'f');
    expect(f.conditions.some((c) => c.condition === 'prone')).toBe(false);
    expect(s.combat.turn.movementLeft).toBe(0);
    // Off the ice it costs half the speed, as before.
    const g = foe('g', 4, 4);
    g.conditions.push({ condition: 'prone', rounds: null });
    const s2 = start([hero(3, 3), g], nav, 'g');
    expect(s2.combat.turn.movementLeft).toBe(g.speed - Math.floor(g.speed / 2));
  });
});

describe('cover (SRD)', () => {
  const archer = (x: number, y: number): Creature =>
    foe('archer', x, y, {
      actions: [
        {
          id: 'bow',
          name: 'Bow',
          description: '',
          cost: 'action',
          targeting: { kind: 'creature', melee: false, range: 12, longRange: 24 },
          attack: { bonus: 5 },
          damage: [{ dice: '1d4', type: 'piercing' }],
        },
      ],
    });

  it('adds 2 or 5 to the target AC in the attack roll and in hitChance, exactly', () => {
    for (const cover of [0, 2, 5] as const) {
      const h = hero(3, 3);
      const a = archer(8, 3);
      const nav = arena({ cover: () => cover });
      const { combat, rng } = start([h, a], nav, 'archer');
      const expected = singleHitProbability(5, h.ac + cover, 20);
      expect(combat.hitChance('bow', 'player')).toBeCloseTo(expected, 10);
      rng.queue = [h.ac + cover - 5]; // exactly enough to hit with cover = the total equals the AC
      const roll = combat.execute({ type: 'action', actionId: 'bow', targetId: 'player' }).find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
      expect(roll.targetAc).toBe(h.ac + cover);
      expect(roll.outcome).toBe('hit');
      // One less misses.
      const h2 = hero(3, 3);
      const s2 = start([h2, archer(8, 3)], nav, 'archer');
      s2.rng.queue = [h2.ac + cover - 6];
      const miss = s2.combat.execute({ type: 'action', actionId: 'bow', targetId: 'player' }).find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
      expect(miss.outcome).toBe('miss');
    }
  });

  it('a blocking prop between attacker and target gives half cover; adjacent targets get none', () => {
    const h = hero(3, 3);
    const a = archer(8, 3);
    const behind = start([h, a], arena({ props: [at(5, 3)] }), 'archer');
    expect(behind.combat.hitChance('bow', 'player')).toBeCloseTo(singleHitProbability(5, h.ac + 2, 20), 10);
    const open = start([hero(3, 3), archer(8, 3)], arena(), 'archer');
    expect(open.combat.hitChance('bow', 'player')).toBeCloseTo(singleHitProbability(5, h.ac, 20), 10);
    const close = start([hero(3, 3), archer(4, 3)], arena({ cover: () => 5 }), 'archer');
    // Adjacent: shooting at point-blank has disadvantage but no cover.
    const adj = close.combat.hitChance('bow', 'player') as number;
    expect(adj).toBeCloseTo(singleHitProbability(5, h.ac, 20) ** 2, 10);
  });

  it('another creature between attacker and target is half cover', () => {
    const h = hero(3, 3);
    const a = archer(8, 3);
    const buddy = foe('buddy', 5, 3);
    const s = start([h, a, buddy], arena(), 'archer');
    expect(s.combat.hitChance('bow', 'player')).toBeCloseTo(singleHitProbability(5, h.ac + 2, 20), 10);
    // Not in the line: no cover.
    const off = start([hero(3, 3), archer(8, 3), foe('buddy', 5, 5)], arena(), 'archer');
    expect(off.combat.hitChance('bow', 'player')).toBeCloseTo(singleHitProbability(5, h.ac, 20), 10);
    // Dead creatures give none.
    const dead = foe('dead', 5, 3);
    dead.hp = 0;
    dead.dead = true;
    const d = start([hero(3, 3), archer(8, 3), dead], arena(), 'archer');
    expect(d.combat.hitChance('bow', 'player')).toBeCloseTo(singleHitProbability(5, h.ac, 20), 10);
  });

  it('applies to Dexterity saves against an area with a point of origin (cover between the burst and the target)', () => {
    const blasterActions: ActionDef[] = [
      {
        id: 'burst',
        name: 'Burst',
        description: '',
        cost: 'action',
        targeting: { kind: 'point', range: 10, area: { shape: 'sphere', size: 2 } },
        save: { ability: 'dex', dc: 14, halfOnSave: true },
        damage: [{ dice: '1d4', type: 'fire' }],
      },
    ];
    const run = (cover: 0 | 2 | 5): { bonus: number; dc: number } => {
      const { combat } = start([hero(3, 3), foe('blaster', 8, 3, { actions: blasterActions })], arena({ cover: () => cover }), 'blaster');
      const roll = combat.execute({ type: 'action', actionId: 'burst', point: at(5, 3) }).find((e) => e.type === 'saveRoll' && e.creatureId === 'player') as Extract<GameEvent, { type: 'saveRoll' }>;
      return { bonus: roll.bonus, dc: roll.dc };
    };
    expect(run(0).bonus).toBe(1);
    expect(run(2).bonus).toBe(3);
    expect(run(5).bonus).toBe(6);
  });
});

describe('determinism', () => {
  it('the same seed gives the same shove, fall and climb', () => {
    const play = (): GameEvent[] => {
      const f = foe('f', 4, 3, { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
      const rng = new Rng(42);
      const combat = createCombat([hero(3, 3), f], arena({ chasms: [at(5, 3)] }), rng, { depth: 7 });
      const ev = combat.begin();
      for (let i = 0; i < 6 && combat.activeId !== 'player'; i++) ev.push(...combat.execute({ type: 'endTurn' }));
      ev.push(...combat.execute({ type: 'action', actionId: SHOVE_PUSH_ID, targetId: 'f' }));
      return ev;
    };
    expect(play()).toEqual(play());
  });
});

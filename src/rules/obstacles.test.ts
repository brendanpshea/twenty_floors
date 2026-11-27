import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Creature, GameEvent, GridPos, MonsterDef, NavGrid } from '../core/types';
import { runAiTurn } from './ai';
import { createCharacter, toCreature } from './character';
import { createCombat, pushPreview } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { planPush, slamDice } from './terrain';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav, type OpenRoomOptions } from './testing/openRoomNav';
import { flagPool } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const at = (x: number, y: number): GridPos => ({ x, y });
const arena = (o: OpenRoomOptions = {}): NavGrid => createOpenRoomNav(16, 9, o);

function hero(x: number, y: number): Creature {
  const h = toCreature(createCharacter(makeBuild()), at(x, y));
  h.maxHp = h.hp = 400;
  delete h.resources['lastStand'];
  return h;
}
function foe(id: string, x: number, y: number, over: Partial<MonsterDef> = {}, flags: string[] = []): Creature {
  const c = instantiateMonster(mon({ id, name: id, hp: 200, ac: 10, abilities: { str: 1, dex: 1, con: 10, int: 10, wis: 10, cha: 10 }, ...over }), id, at(x, y));
  for (const f of flags) c.resources['_' + f] = flagPool(f);
  return c;
}
function run(net: NavGrid, depth: number, dice: number[]): { ev: GameEvent[]; f: Creature } {
  const f = foe('f', 4, 4);
  const rng = new ScriptedRng(3);
  const combat = createCombat([hero(3, 4), f], net, rng, { depth });
  combat.begin();
  for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
  rng.queue = [1, ...dice];
  return { ev: combat.execute({ type: 'action', actionId: 'shove_push', targetId: 'f' }), f };
}
const noLogs = (ev: GameEvent[]): GameEvent[] => ev.filter((e) => e.type !== 'log');

describe('obstacles: fire and spikes (HOUSE RULE: 1d6 per two floor depths, minimum 1d6)', () => {
  it('slam dice by depth: 1 on floors 1-2, 2 on 3-4, 6 on 11-12, 10 on 19-20', () => {
    expect([1, 2, 3, 4, 11, 12, 19, 20].map(slamDice)).toEqual([1, 1, 2, 2, 6, 6, 10, 10]);
  });

  it('stops in the last free cell and takes the damage, as a feature then a damage event', () => {
    for (const [depth, dice] of [[1, 1], [4, 2], [11, 6], [20, 10]] as const) {
      const { ev, f } = run(arena({ spikes: [at(5, 4)] }), depth, Array<number>(dice).fill(3));
      const e = noLogs(ev);
      expect(e.map((x) => x.type)).toEqual(['actionUsed', 'saveRoll', 'feature', 'damage']);
      expect(e[2]).toMatchObject({ type: 'feature', id: 'slam', label: 'Slammed!', creatureId: 'f', amount: 3 * dice });
      expect(e[3]).toMatchObject({ type: 'damage', targetId: 'f', amount: 3 * dice, damageType: 'piercing', sourceId: 'player' });
      expect(f.pos).toEqual(at(4, 4)); // it did not enter the cell
    }
  });

  it('fire burns; a push two cells long moves it to the free cell first', () => {
    const { ev, f } = run(arena({ fire: [at(5, 4)] }), 3, [2, 5]);
    expect(noLogs(ev).find((e) => e.type === 'damage')).toMatchObject({ damageType: 'fire', amount: 7 });
    expect(f.pos).toEqual(at(4, 4));
    // With the obstacle one cell further the creature moves one cell then stops: path first, then the slam.
    const f2 = foe('f2', 4, 4);
    const plan = planPush(arena({ spikes: [at(6, 4)] }), () => false, f2.pos, 1, 0, 2);
    expect(plan.path).toEqual([at(5, 4)]);
    expect(plan.obstacle).toEqual({ kind: 'spikes', at: at(6, 4) });
  });

  it('a missing obstacleAt method means no obstacles', () => {
    const net = arena();
    const bare = { ...net, obstacleAt: undefined } as NavGrid;
    expect(planPush(bare, () => false, at(4, 4), 1, 0, 1).obstacle).toBeUndefined();
  });

  it('can kill', () => {
    const f = foe('f', 4, 4, { hp: 5 });
    const rng = new ScriptedRng(3);
    const combat = createCombat([hero(3, 4), f], arena({ spikes: [at(5, 4)] }), rng, { depth: 20 });
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    rng.queue = [1, ...Array<number>(10).fill(6)];
    const ev = combat.execute({ type: 'action', actionId: 'shove_push', targetId: 'f' });
    expect(ev.some((e) => e.type === 'death' && e.creatureId === 'f')).toBe(true);
  });
});

describe('water and ice', () => {
  it('a creature forced into shallow water is knocked Prone (HOUSE RULE)', () => {
    const { ev, f } = run(arena({ water: [at(5, 4)] }), 3, []);
    expect(noLogs(ev).map((e) => e.type)).toEqual(['actionUsed', 'saveRoll', 'move', 'conditionAdded']);
    expect(f.pos).toEqual(at(5, 4));
    expect(f.conditions.some((c) => c.condition === 'prone')).toBe(true);
  });

  it('ice still slides', () => {
    const { f } = run(arena({ ice: [at(5, 4)] }), 3, []);
    expect(f.pos).toEqual(at(6, 4));
  });
});

describe('pushPreview', () => {
  function preview(net: NavGrid, depth: number): ReturnType<typeof pushPreview> {
    const combat = createCombat([hero(3, 4), foe('f', 4, 4)], net, new ScriptedRng(3), { depth });
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    return pushPreview(combat, 'shove_push', 'f');
  }
  it('describes every outcome', () => {
    expect(preview(arena({ chasms: [at(5, 4)] }), 7)).toEqual({ hazard: 'fall', damage: '7d6' });
    expect(preview(arena({ lava: [at(5, 4)] }), 2)).toEqual({ hazard: 'lava', damage: '2d6' });
    expect(preview(arena({ fire: [at(5, 4)] }), 7)).toEqual({ hazard: 'fire', damage: '4d6' });
    expect(preview(arena({ spikes: [at(5, 4)] }), 1)).toEqual({ hazard: 'spikes', damage: '1d6' });
    expect(preview(arena({ water: [at(5, 4)] }), 5)).toEqual({ hazard: 'water', prone: true });
    expect(preview(arena({ ice: [at(5, 4)] }), 5)).toEqual({ hazard: 'ice' });
    expect(preview(arena(), 5)).toBeNull();
  });
});

describe('the AI uses obstacles', () => {
  it('a brute slams the hero against spikes when that is worth more than its attack', () => {
    const brute = foe('brute', 3, 4, { abilities: { str: 22, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4, actions: [{ id: 'poke', name: 'Poke', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 4 }, damage: [{ dice: '1d4', type: 'piercing' }] }] }, ['tactic_brute']);
    let slammed = false;
    for (let seed = 1; seed <= 20 && !slammed; seed++) {
      const b = foe('brute' + seed, 3, 4, { abilities: brute.abilities, proficiencyBonus: 4, actions: brute.actions }, ['tactic_brute']);
      const h = hero(4, 4);
      const net = arena({ spikes: [at(5, 4)] });
      const combat = createCombat([h, b], net, new ScriptedRng(seed), { depth: 16 });
      combat.begin();
      for (let i = 0; i < 20 && combat.activeId !== b.id; i++) combat.execute({ type: 'endTurn' });
      slammed = runAiTurn(combat, net).some((e) => e.type === 'feature' && e.id === 'slam');
    }
    expect(slammed).toBe(true);
  });
});
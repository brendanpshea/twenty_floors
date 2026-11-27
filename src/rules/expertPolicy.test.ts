import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, CombatApi, Creature, GameEvent, GridPos, MonsterDef, MonsterTactic, NavGrid } from '../core/types';
import { runTurnWith } from './ai';
import { createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { expertPolicy, expertStance, makeExpertPolicy } from './expertPolicy';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav, type OpenRoomOptions } from './testing/openRoomNav';
import { chebyshev, flagPool } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const at = (x: number, y: number): GridPos => ({ x, y });
const arena = (o: OpenRoomOptions = {}, w = 20, h = 11): NavGrid => createOpenRoomNav(w, h, o);

function hero(x: number, y: number): Creature {
  const h = toCreature(createCharacter(makeBuild()), at(x, y));
  h.maxHp = h.hp = 500;
  delete h.resources['lastStand'];
  return h;
}

const club: ActionDef = {
  id: 'club',
  name: 'Club',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus: 4 },
  damage: [{ dice: '1d6+1', type: 'bludgeoning' }],
};
const bow: ActionDef = {
  id: 'bow',
  name: 'Bow',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: false, range: 10, longRange: 30 },
  attack: { bonus: 4 },
  damage: [{ dice: '1d6+2', type: 'piercing' }],
};

function foe(id: string, x: number, y: number, tactic?: MonsterTactic, over: Partial<MonsterDef> = {}): Creature {
  const c = instantiateMonster(mon({ id, name: id, hp: 40, ac: 12, abilities: { str: 6, dex: 6, con: 10, int: 10, wis: 10, cha: 10 }, actions: [club], ...over }), id, at(x, y));
  if (tactic) c.resources[`_tactic_${tactic}`] = flagPool(`tactic_${tactic}`);
  return c;
}

function heroTurn(creatures: Creature[], nav: NavGrid, depth = 1, seed = 5, policy = expertPolicy): { combat: CombatApi; play: () => GameEvent[] } {
  const combat = createCombat(creatures, nav, new ScriptedRng(seed), { depth });
  combat.begin();
  for (let i = 0; i < 60 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
  return { combat, play: () => runTurnWith(combat, (c) => policy(c, nav)) };
}

const used = (ev: GameEvent[]): string[] => ev.filter((e): e is Extract<GameEvent, { type: 'actionUsed' }> => e.type === 'actionUsed').map((e) => e.actionId);

describe('expert hero policy', () => {
  it('shoves an enemy into a chasm when the depth makes that worth more than a sword stroke', () => {
    const nav = arena({ chasms: [at(8, 5)] });
    const { play } = heroTurn([hero(6, 5), foe('f', 7, 5)], nav, 10);
    const ev = play();
    expect(used(ev)).toContain('shove_push');
    expect(ev.some((e) => e.type === 'hazard')).toBe(true);
  });

  it('does not bother at depth 1 when its sword does more', () => {
    const nav = arena({ chasms: [at(8, 5)] });
    const { play } = heroTurn([hero(6, 5), foe('f', 7, 5, undefined, { hp: 200 })], nav, 1);
    expect(used(play())).not.toContain('shove_push');
  });

  it('steps round to the far side of an enemy at the edge to push it in', () => {
    // The enemy at (8,5) has the drop at (9,5) behind it; the hero starts above and to the left.
    const nav = arena({ chasms: [at(9, 5)] });
    const f = foe('f', 8, 5, undefined, { speedFt: 0 });
    const h = hero(6, 3);
    const { play } = heroTurn([h, f], nav, 12);
    const ev = play();
    expect(used(ev)).toContain('shove_push');
    expect(h.pos.x).toBeLessThan(f.pos.x + 0); // it pushed from the west side
  });

  it('goes for the caster first when it can reach it', () => {
    const nav = arena();
    const brute = foe('brute', 6, 5, 'brute');
    const mage = foe('mage', 6, 6, 'caster', { actions: [club], ac: 12 });
    const { play } = heroTurn([hero(5, 5), brute, mage], nav, 1);
    const ev = play();
    const first = ev.find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
    expect(first.targetId).toBe('mage');
  });

  it('finishes a nearly dead enemy', () => {
    const nav = arena();
    const weak = foe('weak', 6, 4, 'brute', { hp: 40 });
    weak.hp = 2;
    const { play } = heroTurn([hero(5, 5), foe('fresh', 6, 5, 'brute'), weak], nav, 1);
    const ev = play();
    expect((ev.find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>).targetId).toBe('weak');
  });

  it('outnumbered by melee enemies it holds a cell where at most two can reach it', () => {
    // A 1-wide corridor three cells long (x 6 to 8): inside it at most two cells touch the hero.
    const walls: GridPos[] = [];
    for (let x = 6; x <= 8; x++) for (let y = 0; y < 11; y++) if (y !== 5) walls.push(at(x, y));
    const nav = arena({ walls });
    const foes = [foe('a', 14, 4, 'brute'), foe('b', 14, 5, 'brute'), foe('c', 14, 6, 'brute')];
    const h = hero(4, 5);
    // Holding a chokepoint is an option (off by default: it measured neutral to harmful).
    const { play } = heroTurn([h, ...foes], nav, 1, 5, makeExpertPolicy({ hold: true }));
    play();
    // It stands in the corridor or at its mouth (x 5 to 8 on the corridor row), not out in the open where all three reach it.
    expect(h.pos.y).toBe(5);
    expect(h.pos.x).toBeGreaterThanOrEqual(5);
    expect(h.pos.x).toBeLessThanOrEqual(8);
  });

  it('keeps away from a drop edge a brute could shove it over when another cell does as well', () => {
    const nav = arena({ chasms: [at(10, 4), at(10, 5), at(10, 6)] });
    const h = hero(4, 5);
    const brute = foe('brute', 9, 5, 'brute');
    const { play } = heroTurn([h, brute], nav, 5);
    play();
    expect(chebyshev(h.pos, brute.pos)).toBeLessThanOrEqual(1);
    expect(h.pos.x).toBeLessThan(9);
  });

  it('every fight it takes terminates', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const nav = arena({ chasms: [at(10, 2), at(10, 8)], props: [at(7, 5)] });
      const foes = [foe('a', 14, 4, 'archer', { actions: [club, bow] }), foe('b', 15, 6, 'brute'), foe('c', 15, 5, 'guard')];
      const combat = createCombat([toCreature(createCharacter(makeBuild()), at(3, 5)), ...foes], nav, new ScriptedRng(seed), { depth: 4 });
      combat.begin();
      let guard = 0;
      while (!combat.isOver && combat.round < 60 && guard++ < 800) {
        if (combat.activeId === 'player') runTurnWith(combat, (c) => expertPolicy(c, nav));
        else combat.execute({ type: 'endTurn' });
      }
      expect(guard).toBeLessThan(800);
    }
  });

  it('is deterministic', () => {
    const run = (): GameEvent[] => {
      const nav = arena({ chasms: [at(8, 5)] });
      const { play } = heroTurn([hero(6, 5), foe('f', 7, 5)], nav, 6, 9);
      return play();
    };
    expect(run()).toEqual(run());
  });

  it('keeps the ranged companions back and the skirmisher close', () => {
    expect(expertStance('pseudodragon')).toBe('back');
    expect(expertStance('sphinx_of_wonder')).toBe('back');
    expect(expertStance('blink_dog')).toBe('close');
  });
});

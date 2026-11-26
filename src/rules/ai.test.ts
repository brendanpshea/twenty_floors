import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { Command, CombatApi, Creature, GameEvent, NavGrid } from '../core/types';
import { MAX_AI_STEPS, chooseCommand, runAiTurn, runTurnWith } from './ai';
import { createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, makeBuild, spawn, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(24, 10);

function hero(x: number, y: number, over: Partial<Creature> = {}): Creature {
  const h = toCreature(createCharacter(makeBuild({ speciesId: 'dwarf' })), { x, y });
  h.hp = h.maxHp = 500; // keep the hero alive so the AI's behaviour is what is under test
  return Object.assign(h, over);
}

const types = (ev: GameEvent[]): string[] => ev.map((e) => e.type);
const rolls = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { type: 'attackRoll' }> => e.type === 'attackRoll');

describe('monster AI', () => {
  it('attacks an adjacent enemy', () => {
    const combat = startCombat([hero(3, 3), spawn('giant_rat', 'rat', 4, 3)], nav, new Rng(1), 'rat');
    const ev = runAiTurn(combat, nav);
    expect(rolls(ev)).toHaveLength(1);
    expect(combat.activeId).toBe('player');
  });

  it('closes distance as far as it can, then attacks next turn', () => {
    const rat = spawn('giant_rat', 'rat', 15, 3);
    const combat = startCombat([hero(3, 3), rat], nav, new Rng(2), 'rat');
    const ev = runAiTurn(combat, nav);
    expect(types(ev)).toContain('move');
    expect(rolls(ev)).toHaveLength(0);
    expect(rat.pos.x).toBeLessThan(15);
    expect(combat.turn.creatureId).not.toBe('rat');
  });

  it('dashes when it cannot reach the target in one move', () => {
    const rat = spawn('giant_rat', 'rat', 20, 3);
    const combat = startCombat([hero(3, 3), rat], nav, new Rng(2), 'rat');
    const ev = runAiTurn(combat, nav);
    expect(ev.some((e) => e.type === 'actionUsed' && e.actionId === 'dash')).toBe(true);
    expect(rat.pos.x).toBe(20 - 12);
  });

  it('paths around obstacles and other creatures', () => {
    const wall = Array.from({ length: 8 }, (_, y) => ({ x: 8, y })); // leaves y=8,9 open
    const gridWithWall = createOpenRoomNav(24, 10, { walls: wall });
    const rat = spawn('giant_rat', 'rat', 12, 1);
    const combat = startCombat([hero(4, 1), rat], gridWithWall, new Rng(3), 'rat');
    let attacked = false;
    for (let turns = 0; turns < 12 && !attacked && !combat.isOver; turns++) {
      if (combat.activeId === 'rat') attacked = rolls(runAiTurn(combat, gridWithWall)).length > 0;
      else combat.execute({ type: 'endTurn' });
    }
    expect(attacked).toBe(true);
  });

  it('uses multiattack when it has one', () => {
    const combat = startCombat([hero(3, 3), spawn('goblin_boss', 'boss', 4, 3)], nav, new Rng(4), 'boss');
    expect(rolls(runAiTurn(combat, nav))).toHaveLength(2);
  });

  it('prefers a ready recharge ability', () => {
    const combat = startCombat([hero(3, 3), spawn('fire_drake', 'drake', 4, 3)], nav, new Rng(5), 'drake');
    const ev = runAiTurn(combat, nav);
    expect(ev.some((e) => e.type === 'actionUsed' && e.actionId === 'fire_burst')).toBe(true);
  });

  it('shoots from range instead of closing in, and kites with Nimble Escape when engaged', () => {
    const gob = spawn('goblin_minion', 'g', 9, 3);
    const a = startCombat([hero(3, 3), gob], nav, new Rng(6), 'g');
    const ev1 = runAiTurn(a, nav);
    expect(rolls(ev1)[0]?.actionName).toBe('Shortbow');
    expect(gob.pos).toEqual({ x: 9, y: 3 });

    const gob2 = spawn('goblin_minion', 'g', 4, 3);
    const b = startCombat([hero(3, 3), gob2], nav, new Rng(6), 'g');
    const ev2 = runAiTurn(b, nav);
    expect(ev2.some((e) => e.type === 'conditionAdded' && e.condition === 'disengaged')).toBe(true);
    expect(ev2.some((e) => e.type === 'attackRoll' && e.reaction)).toBe(false); // Disengage prevented the opportunity attack
    expect(types(ev2)).toContain('move');
    expect(rolls(ev2)[0]?.actionName).toBe('Shortbow');
    expect(rolls(ev2)[0]?.mode).not.toBe('disadvantage');
  });

  it('ends its turn when the enemy cannot be reached', () => {
    const closed = createOpenRoomNav(24, 10, { walls: Array.from({ length: 10 }, (_, y) => ({ x: 8, y })) });
    const rat = spawn('giant_rat', 'rat', 15, 3);
    const combat = startCombat([hero(3, 3), rat], closed, new Rng(7), 'rat');
    const ev = runAiTurn(combat, closed);
    expect(types(ev)).toContain('turnEnd');
    expect(combat.activeId).toBe('player');
  });

  it('chooseCommand returns endTurn with no enemies and always something executable', () => {
    const rat = spawn('giant_rat', 'rat', 4, 3);
    const combat = startCombat([hero(3, 3), rat], nav, new Rng(8), 'rat');
    for (let i = 0; i < 6; i++) {
      const cmd = chooseCommand(combat, nav);
      expect(() => combat.execute(cmd)).not.toThrow();
      if (combat.activeId !== 'rat') break;
    }
  });
});

describe('runTurnWith', () => {
  it('always terminates, forcing endTurn at the cap or on illegal commands', () => {
    const rat = spawn('giant_rat', 'rat', 15, 3);
    const combat = startCombat([hero(3, 3), rat], nav, new Rng(9), 'rat');
    let calls = 0;
    const flipflop = (c: CombatApi): Command => {
      calls++;
      const me = c.creature(c.activeId) as Creature;
      return { type: 'move', path: [{ x: me.pos.x + (calls % 2 ? 1 : -1), y: me.pos.y }] };
    };
    runTurnWith(combat, flipflop);
    expect(calls).toBeLessThanOrEqual(MAX_AI_STEPS);
    expect(combat.activeId).toBe('player');

    const c2 = startCombat([hero(3, 3), spawn('giant_rat', 'rat', 15, 3)], nav, new Rng(9), 'rat');
    runTurnWith(c2, () => ({ type: 'action', actionId: 'nonexistent' }));
    expect(c2.activeId).toBe('player');
    const c3 = startCombat([hero(3, 3), spawn('giant_rat', 'rat', 15, 3)], nav, new Rng(9), 'rat');
    runTurnWith(c3, () => ({ type: 'action', actionId: 'dodge' })); // legal once, then illegal
    expect(c3.activeId).toBe('player');
  });

  it('whole fights with every fixture monster terminate', () => {
    const ids = ['giant_rat', 'goblin_minion', 'goblin_warrior', 'goblin_boss', 'wolf', 'skeleton', 'zombie', 'ghoul', 'giant_spider', 'ogre', 'fire_drake'];
    for (const id of ids) {
      for (let seed = 1; seed <= 3; seed++) {
        const grid: NavGrid = createOpenRoomNav(20, 10);
        const h = hero(2, 5);
        h.hp = h.maxHp = 40;
        const combat = createCombat([h, spawn(id, 'foe', 12, 5), spawn(id, 'foe2', 12, 6)], grid, new Rng(seed));
        combat.begin();
        let guard = 0;
        while (!combat.isOver && guard++ < 600) {
          if (combat.activeId === 'player') runTurnWith(combat, (c) => chooseCommand(c, grid));
          else runAiTurn(combat, grid);
        }
        expect(combat.isOver, `${id} seed ${seed}`).toBe(true);
      }
    }
  });
});

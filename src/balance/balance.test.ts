import { describe, expect, it } from 'vitest';
import { floorSeed } from '../core/rng';
import { themeForDepth } from '../core/themes';
import { generateFloor } from '../gen';
import { createCharacter, floorReward, previewLevelUp } from '../rules';
import { heroBuild } from './builds';
import { hubVisit, routeToBoss, shop, simulateFloor, simulateRun, type RunSummary } from './index';

const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => 1000 + i);
const firstTry = (s: RunSummary, floor: number): number => {
  const f = s.floors[floor - 1]!;
  return f.firstAttemptClears / f.runs;
};

describe('floor simulation', () => {
  it('routes from the entrance room to the boss room through the room graph', () => {
    for (const depth of [1, 2, 3]) {
      const plan = generateFloor({ seed: floorSeed(7, depth), depth, theme: themeForDepth(depth) });
      const route = routeToBoss(plan);
      expect(plan.rooms.find((r) => r.id === route[0])?.role).toBe('entrance');
      expect(plan.rooms.find((r) => r.id === route.at(-1))?.role).toBe('boss');
      for (let i = 1; i < route.length; i++) {
        expect(plan.rooms.find((r) => r.id === route[i - 1])?.neighbors).toContain(route[i]);
      }
    }
  });

  it('is deterministic and reports what happened', () => {
    const pc = createCharacter(heroBuild('a'));
    const a = simulateFloor(pc, { runSeed: 1000, depth: 1 });
    const b = simulateFloor(pc, { runSeed: 1000, depth: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log.length).toBeGreaterThan(0);
    expect(a.cleared || a.death !== undefined).toBe(true);
    if (!a.cleared) expect(['combat', 'boss', 'treasure', 'passage']).toContain(a.death?.role);
    // A different attempt changes the dice, not the floor: same rooms and monsters are fought first.
    const c = simulateFloor(pc, { runSeed: 1000, depth: 1, attempt: 1 });
    expect(c.log[0]?.monsters).toEqual(a.log[0]?.monsters);
  });

  it('never mutates the character it is given', () => {
    const pc = createCharacter(heroBuild('b'));
    const before = JSON.stringify(pc);
    simulateFloor(pc, { runSeed: 1001, depth: 2 });
    expect(JSON.stringify(pc)).toBe(before);
  });
});

describe('hub visit', () => {
  it('rests, pays the reward, levels up and spends gold sensibly', () => {
    const pc = { ...createCharacter(heroBuild('c')), hp: 3, gold: 10 };
    const next = hubVisit(pc, 1);
    expect(next.hp).toBe(next.maxHp);
    expect(next.level).toBe(2);
    expect(previewLevelUp(next)?.toLevel).toBe(3);
    const potions = next.inventory.find((s) => s.itemId === 'potion_healing')?.quantity ?? 0;
    expect(potions).toBeGreaterThanOrEqual(2);
    expect(next.gold).toBeLessThan(50 + 0 * floorReward(1));
  });

  it('does not buy armor the hero is too weak for', () => {
    const pc = { ...createCharacter(heroBuild('c')), gold: 400 };
    expect(shop(pc, 3).equipped.armor).not.toBe('chain_mail');
  });
});

describe('balance bounds (loose: a change that wrecks the game should fail here)', () => {
  it('kit a clears each floor on the first try at a sane rate, and the boss is the dangerous part', () => {
    const s = simulateRun(heroBuild('a'), seeds(100));
    for (const floor of [1, 2, 3]) {
      const rate = firstTry(s, floor);
      expect(rate, `floor ${floor} first-attempt clear rate`).toBeGreaterThan(0.45);
      expect(rate, `floor ${floor} first-attempt clear rate`).toBeLessThan(0.97);
    }
    expect(s.completed).toBeGreaterThan(0.9);
    for (const f of s.floors) {
      const meanBossArrival = f.bossArrivalHpSum / Math.max(1, f.bossEntryCount);
      expect(meanBossArrival).toBeGreaterThan(0.4);
      expect(meanBossArrival).toBeLessThan(0.95);
    }
    // Per fight, the boss room is deadlier than the average ordinary combat room.
    for (const f of s.floors) {
      let bn = 0;
      let bd = 0;
      let rn = 0;
      let rd = 0;
      for (const [k, e] of Object.entries(f.rooms)) {
        if (k.startsWith('boss')) {
          bn += e.n;
          bd += e.deaths;
        } else if (k.startsWith('combat')) {
          rn += e.n;
          rd += e.deaths;
        }
      }
      expect(bd / bn, `floor ${f.depth} boss vs average combat room`).toBeGreaterThan(rd / rn);
    }
  }, 30_000);

  it('the other kits stay in a playable range', () => {
    for (const kit of ['b', 'c']) {
      const s = simulateRun(heroBuild(kit), seeds(60));
      for (const floor of [1, 2, 3]) {
        expect(firstTry(s, floor), `kit ${kit} floor ${floor}`).toBeGreaterThan(0.2);
        expect(firstTry(s, floor), `kit ${kit} floor ${floor}`).toBeLessThan(0.98);
      }
    }
  }, 30_000);
});

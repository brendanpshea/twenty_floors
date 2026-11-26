import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyLevelUp, createCharacter } from './character';
import { resetItemCatalog, setItemCatalog } from './items';
import { simulateFight, simulateOne } from './sim';
import { FIXTURE_ITEMS, fixtureMonster, makeBuild } from './testing/fixtures';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const L1 = () => createCharacter(makeBuild({ speciesId: 'human' }));

describe('balance simulation', () => {
  it('a level 1 fighter beats a lone goblin minion almost always', () => {
    const r = simulateFight(L1(), [fixtureMonster('goblin_minion')], { fights: 300, seed: 10 });
    console.info('L1 vs goblin_minion', r);
    expect(r.winRate).toBeGreaterThan(0.95);
    expect(r.timeouts).toBe(0);
    expect(r.avgRounds).toBeGreaterThan(0);
    expect(r.avgHpFractionOnWin).toBeGreaterThan(0.5);
  });

  it('fights always terminate, even in hard matchups', () => {
    const r = simulateFight(L1(), [fixtureMonster('ogre'), fixtureMonster('goblin_boss')], { fights: 200, seed: 3 });
    console.info('L1 vs ogre + goblin_boss', r);
    expect(r.timeouts).toBe(0);
    expect(r.winRate).toBeLessThan(0.5);
    expect(r.fights).toBe(200);
  });

  it('a level 3 fighter handles a small pack', () => {
    let pc = L1();
    pc = applyLevelUp(applyLevelUp(pc, {}), {});
    const r = simulateFight(pc, [fixtureMonster('wolf'), fixtureMonster('wolf'), fixtureMonster('goblin_warrior')], { fights: 200, seed: 5 });
    console.info('L3 vs 2 wolves + goblin_warrior', r);
    expect(r.timeouts).toBe(0);
    expect(r.winRate).toBeGreaterThan(0.6);
  });

  it('is fully deterministic: same seed, identical event list', () => {
    const defs = [fixtureMonster('wolf'), fixtureMonster('goblin_minion')];
    const a = simulateOne(L1(), defs, 77);
    const b = simulateOne(L1(), defs, 77);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const c = simulateOne(L1(), defs, 78);
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
    expect(a.events[0]?.type).toBe('combatStart');
    expect(a.events.at(-1)?.type).toBe('combatEnd');
  });

  it('reports consistent aggregates', () => {
    const r = simulateFight(L1(), [fixtureMonster('giant_rat')], { fights: 50 });
    expect(r.wins).toBe(Math.round(r.winRate * 50));
    expect(r.avgHpRemaining).toBeLessThanOrEqual(L1().maxHp);
    expect(r.avgHpFraction).toBeLessThanOrEqual(1);
  });
});

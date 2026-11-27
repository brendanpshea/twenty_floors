import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent, GridPos } from '../core/types';
import { createCharacter, toCreature } from './character';
import { BOSS_MOMENTUM_FROM_DEPTH, createCombat } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';
import { flagPool } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());
const at = (x: number, y: number): GridPos => ({ x, y });
const claw: ActionDef = { id: 'claw', name: 'Claw', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 8 }, damage: [{ dice: '1d6+2', type: 'slashing' }] };
const multi: ActionDef = { id: 'multi', name: 'Multiattack', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, multiattack: ['claw', 'claw'] };

function run(depth: number, boss: boolean): GameEvent[] {
  const h = toCreature(createCharacter(makeBuild()), at(4, 4));
  h.maxHp = h.hp = 500;
  const b: Creature = instantiateMonster(mon({ id: 'boss', hp: 100, ac: 10, actions: [claw, multi] }), 'boss', at(5, 4));
  if (boss) b.resources['_boss'] = flagPool('boss');
  const combat = createCombat([h, b], createOpenRoomNav(10, 8), new ScriptedRng(2), { depth });
  const ev = [...combat.begin()];
  for (let i = 0; i < 6 && combat.activeId !== 'boss'; i++) ev.push(...combat.execute({ type: 'endTurn' }));
  ev.push(...combat.execute({ type: 'action', actionId: 'multi', targetId: 'player' }), ...combat.execute({ type: 'endTurn' }));
  return ev;
}

describe('boss momentum (HOUSE RULE)', () => {
  it('the flagged boss acts once more at the end of its turn from the set depth, with a feature event', () => {
    const ev = run(BOSS_MOMENTUM_FROM_DEPTH, true);
    expect(ev.some((e) => e.type === 'feature' && e.id === 'bossAction' && e.creatureId === 'boss')).toBe(true);
    const i = ev.findIndex((e) => e.type === 'feature' && e.id === 'bossAction');
    expect(ev[i - 1]).toMatchObject({ type: 'actionUsed', creatureId: 'boss', actionId: 'claw' });
  });
  it('not on an unflagged monster, and not above the depth', () => {
    expect(run(BOSS_MOMENTUM_FROM_DEPTH, false).some((e) => e.type === 'feature' && e.id === 'bossAction')).toBe(false);
    expect(run(BOSS_MOMENTUM_FROM_DEPTH - 1, true).some((e) => e.type === 'feature' && e.id === 'bossAction')).toBe(false);
  });
});

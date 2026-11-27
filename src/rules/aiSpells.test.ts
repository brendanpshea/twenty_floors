import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, CombatApi, Creature, GameEvent, GridPos, MonsterDef, NavGrid } from '../core/types';
import { runAiTurn } from './ai';
import { createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const at = (x: number, y: number): GridPos => ({ x, y });
const nav: NavGrid = createOpenRoomNav(16, 9);

const slam: ActionDef = {
  id: 'slam',
  name: 'Slam',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus: 6 },
  damage: [{ dice: '2d6+3', type: 'bludgeoning' }],
};
const multi: ActionDef = { id: 'multi', name: 'Multiattack', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, multiattack: ['slam', 'slam'] };
const fireball: ActionDef = {
  id: 'fireball',
  name: 'Fireball',
  description: '',
  cost: 'action',
  targeting: { kind: 'point', range: 12, area: { shape: 'sphere', size: 3 } },
  uses: { resource: 'Fireball', amount: 2 },
  save: { ability: 'dex', dc: 18, halfOnSave: true },
  damage: [{ dice: '8d6', type: 'fire' }],
};

function hero(x: number, y: number): Creature {
  const h = toCreature(createCharacter(makeBuild()), at(x, y));
  h.maxHp = h.hp = 600;
  delete h.resources['lastStand'];
  return h;
}
function foe(id: string, x: number, y: number, over: Partial<MonsterDef> = {}): Creature {
  return instantiateMonster(mon({ id, name: id, hp: 80, ac: 14, actions: [slam], ...over }), id, at(x, y));
}
function begin(creatures: Creature[], active: string, seed = 4): CombatApi {
  const combat = createCombat(creatures, nav, new ScriptedRng(seed));
  combat.begin();
  for (let i = 0; i < 40 && combat.activeId !== active; i++) combat.execute({ type: 'endTurn' });
  return combat;
}
const used = (ev: GameEvent[]): string[] => ev.filter((e): e is Extract<GameEvent, { type: 'actionUsed' }> => e.type === 'actionUsed').map((e) => e.actionId);

describe('limited-use actions on monsters', () => {
  it('"N/Day" gives N uses per floor, one at a time (HOUSE RULE: the data amount is the count)', () => {
    const mage = foe('mage', 10, 4, { actions: [slam, fireball] });
    expect(mage.resources['Fireball']).toMatchObject({ current: 2, max: 2 });
    expect(mage.actions.find((a) => a.id === 'fireball')?.uses).toEqual({ resource: 'Fireball', amount: 1 });
    const combat = begin([hero(4, 4), mage], 'mage');
    combat.execute({ type: 'action', actionId: 'fireball', point: at(4, 4) });
    expect(mage.resources['Fireball']?.current).toBe(1);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'action', actionId: 'fireball', point: at(4, 4) });
    expect(mage.resources['Fireball']?.current).toBe(0);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(combat.canUse('fireball').ok).toBe(false);
  });
});

describe('AI scoring of areas, control and heals', () => {
  it('a caster opens a one-on-one with its strongest limited-use spell rather than its multiattack', () => {
    const mage = foe('mage', 10, 4, { actions: [slam, multi, fireball] });
    const combat = begin([hero(4, 4), mage], 'mage');
    expect(used(runAiTurn(combat, nav))).toContain('fireball');
  });

  it('an area that catches two enemies beats a single strike', () => {
    const mage = foe('mage', 10, 4, { actions: [slam, multi, { ...fireball, uses: undefined, damage: [{ dice: '3d6', type: 'fire' }] }] });
    const buddy = foe('buddy', 4, 5, {});
    buddy.faction = 'ally';
    const combat = begin([hero(4, 4), buddy, mage], 'mage');
    expect(used(runAiTurn(combat, nav))).toContain('fireball');
  });

  it('never uses a turn-denying action on the same target two turns running (HOUSE RULE)', () => {
    const command: ActionDef = {
      id: 'command',
      name: 'Command',
      description: '',
      cost: 'action',
      targeting: { kind: 'creature', melee: false, range: 12 },
      save: { ability: 'wis', dc: 40, halfOnSave: false },
      applies: { condition: 'prone', rounds: 1 },
    };
    const dragon = foe('dragon', 10, 4, { actions: [command, { ...slam, damage: [{ dice: '1d4', type: 'bludgeoning' }] }] });
    const h = hero(4, 4);
    const combat = begin([h, dragon], 'dragon');
    const first = used(runAiTurn(combat, nav));
    expect(first).toContain('command');
    // Back to the dragon next round: it does not Command the hero again.
    for (let i = 0; i < 6 && combat.activeId !== 'dragon'; i++) combat.execute({ type: 'endTurn' });
    h.conditions.length = 0;
    const second = used(runAiTurn(combat, nav));
    expect(second).not.toContain('command');
  });

  it('uses an action-cost heal on a badly hurt friend', () => {
    const healWord: ActionDef = { id: 'healing_word', name: 'Healing Word', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 12, friendly: true }, heal: '2d4+3' };
    const priest = foe('priest', 8, 4, { actions: [slam, healWord] });
    const pal = foe('pal', 9, 5);
    pal.hp = 10;
    const combat = begin([hero(2, 4), priest, pal], 'priest');
    const ev = runAiTurn(combat, nav);
    expect(used(ev)).toContain('healing_word');
    expect(ev.some((e) => e.type === 'heal' && e.targetId === 'pal')).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent } from '../core/types';
import { applyLevelUp, createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(12, 8);
const ofType = <T extends GameEvent['type']>(ev: GameEvent[], t: T) => ev.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);

function hero(backgroundId: string, level = 1): Creature {
  const bg = backgroundId === 'sage' || backgroundId === 'acolyte';
  let pc = createCharacter(
    makeBuild({
      backgroundId,
      speciesId: 'dwarf',
      abilityIncreases: backgroundId === 'criminal' ? { dex: 2, con: 1 } : bg ? { con: 1, ...(backgroundId === 'sage' ? { int: 2 } : { cha: 2 }) } : { str: 2, con: 1 },
      choices: {
        fightingStyle: 'defense',
        startingKit: 'a',
        ...(backgroundId === 'sage' ? { mi_cantrip1: 'fire_bolt', mi_cantrip2: 'ray_of_frost', mi_spell: 'magic_missile', mi_ability: 'int' } : {}),
        ...(backgroundId === 'acolyte' ? { mi_cantrip1: 'sacred_flame', mi_cantrip2: 'resistance', mi_spell: 'bless', mi_ability: 'cha' } : {}),
      },
    }),
  );
  for (let i = 1; i < level; i++) pc = applyLevelUp(pc, {});
  const c = toCreature(pc, { x: 3, y: 3 });
  delete c.resources['lastStand'];
  return c;
}

const target = (): Creature =>
  instantiateMonster(
    mon({
      id: 'dummy',
      hp: 100,
      ac: 10,
      actions: [{ id: 'slash', name: 'slash', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 0 }, damage: [{ dice: '1', type: 'slashing' }] } as ActionDef],
    }),
    'dummy',
    { x: 4, y: 3 },
  );

describe('Savage Attacker (Soldier)', () => {
  it('rolls the weapon damage dice twice and keeps the higher, once per turn', () => {
    const rng = new ScriptedRng(1);
    const c = hero('soldier', 2);
    const combat = startCombat([c, target()], nav, rng, 'player');
    // STR 17 (+3), longsword with a shield: 1d8+3.
    rng.queue = [15, 2, 7];
    const first = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'dummy' });
    expect(ofType(first, 'damage')[0]?.amount).toBe(7 + 3);
    // Action Surge gives a second attack in the same turn: no second Savage Attacker roll.
    combat.execute({ type: 'action', actionId: 'action_surge' });
    rng.queue = [15, 2, 7];
    const second = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'dummy' });
    expect(ofType(second, 'damage')[0]?.amount).toBe(2 + 3);
  });

  it('applies again on the next turn and not to a miss', () => {
    const rng = new ScriptedRng(1);
    const combat = startCombat([hero('soldier'), target()], nav, rng, 'player');
    rng.queue = [2, 8];
    expect(ofType(combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'dummy' }), 'damage')).toHaveLength(0);
    expect(rng.queue).toEqual([8]);
  });

  it('other backgrounds do not get it', () => {
    const rng = new ScriptedRng(1);
    const combat = startCombat([hero('criminal'), target()], nav, rng, 'player');
    rng.queue = [15, 2, 7];
    // Criminal: DEX-based, longsword is not finesse, so STR 15 (+2): damage 2 + 2 only.
    expect(ofType(combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'dummy' }), 'damage')[0]?.amount).toBe(2 + 2);
  });
});

describe('Alert (Criminal)', () => {
  it('adds the proficiency bonus to the initiative roll', () => {
    const initiative = (bg: string): string => {
      const rng = new ScriptedRng(1);
      rng.queue = [10, 10];
      const combat = createCombat([hero(bg), target()], nav, rng);
      const ev = combat.begin();
      return ofType(ev, 'log').map((l) => l.text).find((t) => t.startsWith('Initiative')) as string;
    };
    // Criminal: DEX 14 (+2) and proficiency +2 on top: 10 + 2 + 2 = 14; a soldier (DEX 12, +1) makes 11.
    expect(initiative('criminal')).toMatch(/Tester 14/);
    expect(initiative('soldier')).toMatch(/Tester 11/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CombatApi, Creature, GameEvent, GridPos, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
import { ITEMS } from '../data/items';
import { advise } from './advise';
import { toCreature } from './character';
import { createCombat, pushPreview } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, mon } from './testing/fixtures';
import { presetHero, withItems } from './testing/heroes';
import { createOpenRoomNav, type OpenRoomOptions } from './testing/openRoomNav';
import { flagPool } from './util';

beforeAll(() => setItemCatalog(ITEMS));
afterAll(() => resetItemCatalog());
void FIXTURE_ITEMS;

const at = (x: number, y: number): GridPos => ({ x, y });

function hammerHero(level: number): PlayerCharacter {
  const pc = withItems(presetHero('defender', level), 'warhammer');
  pc.equipped.mainHand = 'warhammer';
  pc.build.choices['masteries'] = 'warhammer,longsword,shortsword';
  return pc;
}

function arena(o: OpenRoomOptions = {}): NavGrid {
  return createOpenRoomNav(16, 9, o);
}

function foe(id: string, x: number, y: number, over: Partial<MonsterDef> = {}): Creature {
  return instantiateMonster(mon({ id, name: id, hp: 200, ac: 1, abilities: { str: 1, dex: 1, con: 10, int: 10, wis: 10, cha: 10 }, ...over }), id, at(x, y));
}

function start(pc: PlayerCharacter, foes: Creature[], net: NavGrid, depth = 6, auto = false): { combat: CombatApi; hero: Creature; rng: ScriptedRng } {
  const hero = toCreature(pc, at(3, 4));
  hero.maxHp = hero.hp = 500;
  if (auto) hero.resources['_tacticalAuto'] = flagPool('tacticalAuto');
  const rng = new ScriptedRng(5);
  const combat = createCombat([hero, ...foes], net, rng, { depth });
  combat.begin();
  for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
  return { combat, hero, rng };
}

const swing = (combat: CombatApi, targetId = 'f'): GameEvent[] => {
  const id = combat.availableActions().find((a) => a.id.startsWith('atk_'))?.id as string;
  return combat.execute({ type: 'action', actionId: id, targetId });
};
const feats = (ev: GameEvent[]): Extract<GameEvent, { type: 'feature' }>[] => ev.filter((e): e is Extract<GameEvent, { type: 'feature' }> => e.type === 'feature' && e.id === 'tacticalMaster');

describe('Tactical Master (Fighter 9; HOUSE RULE: the replacement is chosen by the engine)', () => {
  it('a Sap weapon pushes instead when that lands the target in a pit, and says so with a feature event', () => {
    const { combat, rng } = start(presetHero('defender', 9), [foe('f', 4, 4)], arena({ chasms: [at(6, 4)] }));
    rng.queue = [15, 4, 4, 4, 4, 4, 4, 4, 4];
    const ev = swing(combat);
    expect(feats(ev)).toEqual([{ type: 'feature', creatureId: 'player', id: 'tacticalMaster', label: 'Tactical Master: Push', targetId: 'f' }]);
    expect(ev.some((e) => e.type === 'hazard' && e.creatureId === 'f' && e.hazard === 'fall')).toBe(true);
    expect(ev.find((e) => e.type === 'move' && e.creatureId === 'f')).toEqual({ type: 'move', creatureId: 'f', path: [at(5, 4), at(6, 4)] });
  });

  it('keeps the weapon\'s own property (Sap) when there is nothing to push the target into', () => {
    const { combat, rng } = start(presetHero('defender', 9), [foe('f', 4, 4)], arena());
    rng.queue = [15, 4];
    const ev = swing(combat);
    expect(feats(ev)).toHaveLength(0);
    expect(ev.some((e) => e.type === 'hazard')).toBe(false);
  });

  it('the naive hero (flag _tacticalAuto) keeps the old automation: no replacement, no push', () => {
    const { combat, rng } = start(presetHero('defender', 9), [foe('f', 4, 4)], arena({ chasms: [at(6, 4)] }), 6, true);
    rng.queue = [15, 4];
    const ev = swing(combat);
    expect(feats(ev)).toHaveLength(0);
    expect(ev.some((e) => e.type === 'hazard')).toBe(false);
  });

  it('below level 9 there is no Tactical Master', () => {
    const { combat, rng } = start(presetHero('defender', 5), [foe('f', 4, 4)], arena({ chasms: [at(6, 4)] }));
    rng.queue = [15, 4];
    expect(feats(swing(combat))).toHaveLength(0);
  });

  it('a Push-mastery warhammer pushes on every hit, with or without Tactical Master, and needs no replacement', () => {
    const { combat, rng } = start(hammerHero(9), [foe('f', 4, 4)], arena({ lava: [at(6, 4)] }));
    rng.queue = [15, 4, 4, 4, 4, 4, 4, 4, 4];
    const ev = swing(combat);
    expect(feats(ev)).toHaveLength(0);
    expect(ev.some((e) => e.type === 'hazard' && e.hazard === 'lava')).toBe(true);
  });

  it('the 10 ft push stops at a creature and slams against fire or spikes in the second cell', () => {
    const { combat, hero } = start(hammerHero(5), [foe('f', 4, 4)], arena({ spikes: [at(6, 4)] }), 8);
    const id = combat.availableActions().find((a) => a.id.startsWith('atk_'))?.id as string;
    expect(pushPreview(combat, id, 'f')).toEqual({ hazard: 'spikes', damage: '4d6' });
    void hero;
    const blocked = start(hammerHero(5), [foe('f', 4, 4), foe('g', 5, 4)], arena({ chasms: [at(6, 4)] }));
    const id2 = blocked.combat.availableActions().find((a) => a.id.startsWith('atk_'))?.id as string;
    expect(pushPreview(blocked.combat, id2, 'f')).toBeNull();
    // A Huge creature is not pushed (Large or smaller).
    const huge = start(hammerHero(5), [foe('f', 4, 4, { size: 'huge' })], arena({ chasms: [at(6, 4)] }));
    expect(pushPreview(huge.combat, huge.combat.availableActions().find((a) => a.id.startsWith('atk_'))?.id as string, 'f')).toBeNull();
  });

  it('the attack action says when the next blow would push into a hazard', () => {
    const { combat } = start(hammerHero(5), [foe('f', 4, 4)], arena({ chasms: [at(6, 4)] }), 3);
    const a = combat.availableActions().find((x) => x.id.startsWith('atk_'));
    expect(a?.description).toContain('Push: the blow would knock f into the pit for 3d6.');
    const plain = start(hammerHero(5), [foe('f', 4, 4)], arena());
    expect(plain.combat.availableActions().find((x) => x.id.startsWith('atk_'))?.description).not.toContain('Push:');
    // Tactical Master carries the hint too.
    const tm = start(presetHero('defender', 9), [foe('f', 4, 4)], arena({ lava: [at(6, 4)] }), 4);
    expect(tm.combat.availableActions().find((x) => x.id.startsWith('atk_'))?.description).toContain('into the lava for 4d6');
  });

  it('advise names the push for a Push-mastery attack', () => {
    const { combat } = start(hammerHero(5), [foe('f', 4, 4, { hp: 500 })], arena({ chasms: [at(6, 4)] }), 3);
    const adv = advise(combat, arena({ chasms: [at(6, 4)] }));
    expect(adv?.text).toMatch(/pit|fall/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Creature, GameEvent, ItemDef, MonsterDef, PassiveEffect, PlayerCharacter, WornSlot } from '../core/types';
import { computeAc, createCharacter, effectiveAbilities, takeShortRest, toCreature } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { planPush } from './terrain';
import { activePassives, itemWorks } from './passives';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const worn = (id: string, slot: Exclude<WornSlot, 'ring'> | 'ring', passives: PassiveEffect[], attunement = false): ItemDef => ({
  id,
  name: id,
  kind: 'wondrous',
  description: id,
  cost: 100,
  slot,
  attunement,
  passives,
});

const EXTRA: ItemDef[] = [
  worn('t_ac', 'ring', [{ type: 'acBonus', amount: 1 }]),
  worn('t_unarmored', 'wrists', [{ type: 'unarmoredAcBonus', amount: 2 }]),
  worn('t_save', 'cloak', [{ type: 'saveBonus', amount: 2 }]),
  worn('t_set', 'hands', [{ type: 'setAbility', ability: 'str', score: 19 }]),
  worn('t_bonus', 'head', [{ type: 'abilityBonus', ability: 'int', amount: 2 }]),
  worn('t_res', 'neck', [{ type: 'resistance', damageType: 'fire' }]),
  worn('t_imm', 'neck', [{ type: 'immunity', damageType: 'poison' }]),
  worn('t_cond', 'neck', [{ type: 'conditionImmunity', condition: 'frightened' }]),
  worn('t_speed', 'feet', [{ type: 'speedBonus', cells: 2 }]),
  worn('t_hp', 'belt', [{ type: 'maxHpBonus', flat: 5, perLevel: 1 }]),
  worn('t_init', 'cloak', [{ type: 'initiativeAdvantage' }]),
  worn('t_crit', 'neck', [{ type: 'critImmunity' }]),
  worn('t_disp', 'cloak', [{ type: 'displacement' }]),
  worn('t_wound', 'neck', [{ type: 'doubleHitDiceHealing' }]),
  worn('t_regen', 'ring', [{ type: 'regeneration', amount: 3 }]),
  worn('t_fall', 'feet', [{ type: 'ignoreHazard', hazard: 'fall' }]),
  worn('t_attune', 'ring', [{ type: 'acBonus', amount: 3 }], true),
  {
    id: 't_bane',
    name: 'Bane Sword',
    kind: 'weapon',
    description: '',
    cost: 100,
    weapon: { category: 'martial', melee: true, damage: { dice: '1d8', type: 'slashing' }, properties: [] },
    passives: [{ type: 'weaponDamage', dice: '1d6', damageType: 'fire', versus: ['undead'] }, { type: 'weaponDamage', dice: '1d4', damageType: 'fire' }],
  },
  {
    id: 't_vicious',
    name: 'Vicious Sword',
    kind: 'weapon',
    description: '',
    cost: 100,
    weapon: { category: 'martial', melee: true, damage: { dice: '1d8', type: 'slashing' }, properties: [] },
    passives: [{ type: 'weaponCritDamage', dice: '2d6' }, { type: 'critRange', from: 19 }],
  },
];

beforeAll(() => setItemCatalog([...FIXTURE_ITEMS, ...EXTRA]));
afterAll(() => resetItemCatalog());

function heroWith(...ids: string[]): PlayerCharacter {
  const pc = createCharacter(makeBuild());
  const w: NonNullable<PlayerCharacter['worn']> = {};
  for (const id of ids) {
    const item = EXTRA.find((i) => i.id === id) as ItemDef;
    if (item.slot) w[item.slot === 'ring' ? (w.ring ? 'ring2' : 'ring') : item.slot] = id;
  }
  return { ...pc, worn: w, attuned: [] };
}

const base = createCharacter(makeBuild());
const cr = (pc: PlayerCharacter): Creature => toCreature(pc, { x: 3, y: 3 });

describe('item passives on the hero', () => {
  it('acBonus adds to Armor Class', () => {
    expect(computeAc(heroWith('t_ac'))).toBe(computeAc(base) + 1);
  });
  it('unarmoredAcBonus applies only with no armor and no shield', () => {
    const naked: PlayerCharacter = { ...heroWith('t_unarmored'), equipped: {} };
    const plain: PlayerCharacter = { ...base, equipped: {} };
    expect(computeAc(naked)).toBe(computeAc(plain) + 2);
    if (base.equipped.armor) expect(computeAc(heroWith('t_unarmored'))).toBe(computeAc(base));
  });
  it('saveBonus raises saving throws through the combat engine', () => {
    const h = cr(heroWith('t_save'));
    expect(h.resources['_saveBonus']?.current).toBe(2);
    expect(cr(base).resources['_saveBonus']).toBeUndefined();
  });
  it('setAbility raises a lower score only', () => {
    expect(effectiveAbilities(heroWith('t_set')).str).toBe(19);
    const strong = { ...heroWith('t_set'), build: { ...base.build, baseAbilities: { ...base.build.baseAbilities, str: 20 } } };
    expect(effectiveAbilities(strong).str).toBeGreaterThanOrEqual(20);
  });
  it('abilityBonus adds up to its cap', () => {
    expect(effectiveAbilities(heroWith('t_bonus')).int).toBe(effectiveAbilities(base).int + 2);
  });
  it('resistance, immunity and conditionImmunity reach the creature', () => {
    expect(cr(heroWith('t_res')).resistances).toContain('fire');
    expect(cr(heroWith('t_imm')).immunities).toContain('poison');
    expect(cr(heroWith('t_cond')).conditionImmunities).toContain('frightened');
  });
  it('speedBonus adds cells of walking speed', () => {
    expect(cr(heroWith('t_speed')).speed).toBe(cr(base).speed + 2);
  });
  it('maxHpBonus raises the maximum and keeps full health full', () => {
    const c = cr(heroWith('t_hp'));
    expect(c.maxHp).toBe(base.maxHp + 5 + base.level);
    expect(c.hp).toBe(c.maxHp);
  });
  it('initiativeAdvantage sets the initiative flag', () => {
    expect(cr(heroWith('t_init')).resources['_initAdv']).toBeDefined();
  });
  it('doubleHitDiceHealing doubles the short rest roll', () => {
    const hurt = (pc: PlayerCharacter): PlayerCharacter => ({ ...pc, hp: 1 });
    const a = takeShortRest(hurt(base), new ScriptedRng(5)).healed;
    const b = takeShortRest(hurt(heroWith('t_wound')), new ScriptedRng(5)).healed;
    expect(b).toBeGreaterThan(a);
  });
  it('an item that needs attunement works only while attuned', () => {
    const pc = heroWith('t_attune');
    const item = EXTRA.find((i) => i.id === 't_attune') as ItemDef;
    expect(itemWorks(pc, item)).toBe(false);
    expect(computeAc(pc)).toBe(computeAc(base));
    const on = { ...pc, attuned: ['t_attune'] };
    expect(computeAc(on)).toBe(computeAc(base) + 3);
    expect(activePassives(on).map((a) => a.itemId)).toContain('t_attune');
  });
});

const arena = createOpenRoomNav(14, 9, { chasms: [{ x: 5, y: 3 }] });
const foeDef = (id: string): MonsterDef => mon({ id, name: id, hp: 400, ac: 10, type: 'undead' });

function fight(pc: PlayerCharacter, foeId: string, queue: number[], active: 'player' | 'f' = 'player'): { ev: GameEvent[]; h: Creature; f: Creature } {
  const h = cr(pc);
  h.maxHp = h.hp = 300;
  const f = instantiateMonster(foeDef(foeId), 'f', { x: 4, y: 3 });
  const rng = new ScriptedRng(1);
  const combat = createCombat([h, f], arena, rng, {});
  combat.begin();
  for (let i = 0; i < 20 && combat.activeId !== active; i++) combat.execute({ type: 'endTurn' });
  rng.queue = queue;
  const actionId = active === 'player' ? (combat.availableActions().find((a) => a.id.startsWith('atk_')) as { id: string }).id : 'slash';
  const ev = combat.execute({ type: 'action', actionId, targetId: active === 'player' ? 'f' : 'player' });
  return { ev, h, f };
}

describe('item passives in combat', () => {
  it('critImmunity turns a critical hit into a normal hit', () => {
    const plain = fight(base, 'skeleton', [20, 6, 6, 6, 6], 'f');
    const immune = fight(heroWith('t_crit'), 'skeleton', [20, 6, 6, 6, 6], 'f');
    const lost = (r: { h: Creature }): number => 300 - r.h.hp;
    expect(lost(immune)).toBeLessThan(lost(plain));
    const roll = immune.ev.find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
    expect(roll.outcome).toBe('hit');
  });
  it('displacement gives disadvantage to attacks against the wearer, and a hit ends it', () => {
    const r = fight(heroWith('t_disp'), 'skeleton', [20, 20, 3], 'f');
    const roll = r.ev.find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
    expect(roll.mode).toBe('disadvantage');
  });
  it('regeneration heals at the start of the wearer turn', () => {
    const h = cr(heroWith('t_regen'));
    h.maxHp = 300;
    h.hp = 100;
    const f = instantiateMonster(foeDef('skeleton'), 'f', { x: 12, y: 7 });
    const combat = createCombat([h, f], arena, new ScriptedRng(2), {});
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
    expect(h.hp).toBeGreaterThanOrEqual(103);
  });
  it('weaponDamage adds dice, and the versus rider only hits the named creature types', () => {
    const pc: PlayerCharacter = { ...base, equipped: { ...base.equipped, mainHand: 't_bane' } };
    const hit = (foeId: string): number => {
      const { f } = fight(pc, foeId, [15, 1, 1, 1, 1, 1, 1]);
      return 400 - f.hp;
    };
    // skeleton is undead, so the extra 1d6 fire is rolled; the rat gets only the flat extra 1d4.
    expect(hit('skeleton') - hit('giant_rat')).toBe(1);
  });
  it('weaponCritDamage and critRange make a Vicious sword hit harder and crit on 19', () => {
    const pc: PlayerCharacter = { ...base, equipped: { ...base.equipped, mainHand: 't_vicious' } };
    const r = fight(pc, 'skeleton', [19, 1, 1, 1, 1, 6, 6, 1, 1]);
    const roll = r.ev.find((e) => e.type === 'attackRoll') as Extract<GameEvent, { type: 'attackRoll' }>;
    expect(roll.outcome).toBe('crit');
  });
  it('ignoreHazard keeps a pushed wearer out of the pit', () => {
    const plain = cr(base);
    const flier = cr(heroWith('t_fall'));
    expect(plain.resources['_ignore_fall']).toBeUndefined();
    expect(flier.resources['_ignore_fall']).toBeDefined();
    const from = { x: 3, y: 3 };
    const occupied = (): boolean => false;
    expect(planPush(arena, occupied, from, 1, 0, 3).path.length).toBeGreaterThan(0);
    const stopped = planPush(arena, occupied, from, 1, 0, 3, { ignore: new Set(['fall']) });
    expect(stopped.path).toEqual([{ x: 4, y: 3 }]);
  });
});

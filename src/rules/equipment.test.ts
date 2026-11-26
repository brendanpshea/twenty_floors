import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CharacterBuild, CombatApi, Creature, GameEvent, PlayerCharacter } from '../core/types';
import { buyItem, canEquip, computeAc, createCharacter, equipItem, masteredKinds, toCreature } from './character';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';
import { instantiateMonster } from './monster';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

function pcWith(equipped: PlayerCharacter['equipped'], extra: string[] = [], build: Partial<CharacterBuild> = {}): PlayerCharacter {
  const pc = createCharacter(makeBuild({ speciesId: 'dwarf', ...build }));
  for (const id of [...Object.values(equipped), ...extra]) if (!pc.inventory.some((s) => s.itemId === id)) pc.inventory.push({ itemId: id as string, quantity: 1 });
  return { ...pc, equipped };
}

const action = (c: Creature, id: string) => c.actions.find((a) => a.id === id)!;
const ofType = <T extends GameEvent['type']>(ev: GameEvent[], t: T) => ev.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);

describe('magic items', () => {
  it('adds the bonus to attack and damage (once) and shows it in the name', () => {
    const plain = toCreature(pcWith({ mainHand: 'longsword', armor: 'chain_mail' }), { x: 0, y: 0 });
    const magic = toCreature(pcWith({ mainHand: 'longsword_plus1', armor: 'chain_mail' }), { x: 0, y: 0 });
    const a = action(plain, 'atk_longsword');
    const b = action(magic, 'atk_longsword_plus1');
    expect(b.name).toBe('Longsword +1');
    expect(b.attack!.bonus).toBe(a.attack!.bonus + 1);
    // STR 17 (+3): 1d10+3 two-handed becomes 1d10+4
    expect(a.damage![0]!.dice).toBe('1d10+3');
    expect(b.damage![0]!.dice).toBe('1d10+4');
  });

  it('adds armor and shield bonuses to AC', () => {
    const base = pcWith({ armor: 'scale_mail', offHand: 'shield' });
    const magic = pcWith({ armor: 'scale_mail_plus1', offHand: 'shield_plus1' });
    expect(computeAc(magic)).toBe(computeAc(base) + 2);
  });
});

describe('weapon properties across the list', () => {
  it('reach weapons have range 2; a thrown melee weapon gets a separate throw action; finesse uses the better ability', () => {
    const pc = pcWith({ mainHand: 'halberd' }, ['dagger', 'javelin']);
    const c = toCreature(pc, { x: 0, y: 0 });
    expect(action(c, 'atk_halberd').targeting).toMatchObject({ melee: true, range: 2 });
    expect(c.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['throw_dagger', 'throw_javelin']));
    // dexterous hero: dagger (finesse) uses DEX
    const dex = toCreature(pcWith({ mainHand: 'dagger' }, [], { baseAbilities: { str: 8, dex: 15, con: 14, int: 8, wis: 10, cha: 13 }, abilityIncreases: { dex: 2, con: 1 } }), { x: 0, y: 0 });
    expect(action(dex, 'atk_dagger').attack!.bonus).toBe(3 + 2);
    expect(action(dex, 'throw_dagger').attack!.bonus).toBe(3 + 2);
    // javelin is not finesse: STR 8 gives -1
    const j = toCreature(pcWith({ mainHand: 'javelin' }, [], { baseAbilities: { str: 8, dex: 15, con: 14, int: 8, wis: 10, cha: 13 }, abilityIncreases: { dex: 2, con: 1 } }), { x: 0, y: 0 });
    expect(action(j, 'throw_javelin').attack!.bonus).toBe(-1 + 2);
  });

  it('versatile uses the two-handed die with an empty off hand; Great Weapon Fighting and Archery apply to the right weapons', () => {
    const gwf = { fightingStyle: 'greatWeaponFighting', startingKit: 'a' };
    const free = toCreature(pcWith({ mainHand: 'warhammer' }, [], { choices: gwf }), { x: 0, y: 0 });
    expect(action(free, 'atk_warhammer').damage![0]!.dice).toBe('1d10+3');
    expect(action(free, 'atk_warhammer').effects).toContain('greatWeaponFighting');
    const shield = toCreature(pcWith({ mainHand: 'warhammer', offHand: 'shield' }, [], { choices: gwf }), { x: 0, y: 0 });
    expect(action(shield, 'atk_warhammer').damage![0]!.dice).toBe('1d8+3');
    expect(action(shield, 'atk_warhammer').effects ?? []).not.toContain('greatWeaponFighting');
    const maul = toCreature(pcWith({ mainHand: 'maul' }, ['javelin'], { choices: gwf }), { x: 0, y: 0 });
    expect(action(maul, 'atk_maul').effects).toContain('greatWeaponFighting');
    expect(action(maul, 'throw_javelin').effects ?? []).not.toContain('greatWeaponFighting');
    const archery = { fightingStyle: 'archery', startingKit: 'a' };
    const bow = toCreature(pcWith({ mainHand: 'longbow' }, ['javelin'], { choices: archery }), { x: 0, y: 0 });
    const noStyle = toCreature(pcWith({ mainHand: 'longbow' }, ['javelin'], { choices: { fightingStyle: 'defense', startingKit: 'a' } }), { x: 0, y: 0 });
    expect(action(bow, 'atk_longbow').attack!.bonus).toBe(action(noStyle, 'atk_longbow').attack!.bonus + 2);
    expect(action(bow, 'throw_javelin').attack!.bonus).toBe(action(noStyle, 'throw_javelin').attack!.bonus);
  });

  it('heavy armor below its Strength requirement costs 10 ft of speed', () => {
    const strong = toCreature(pcWith({ armor: 'chain_mail' }), { x: 0, y: 0 });
    const weak = toCreature(pcWith({ armor: 'chain_mail' }, [], { baseAbilities: { str: 8, dex: 15, con: 14, int: 8, wis: 10, cha: 13 }, abilityIncreases: { dex: 2, con: 1 } }), { x: 0, y: 0 });
    expect(strong.speed).toBe(6);
    expect(weak.speed).toBe(4);
  });

  it('two-handed weapons and shields: canEquip explains what gets put away', () => {
    const pc = pcWith({ mainHand: 'longsword', offHand: 'shield' }, ['greatsword', 'maul']);
    const r = canEquip(pc, 'maul');
    expect(r).toMatchObject({ ok: true, unequips: 'shield' });
    expect(r.reason).toMatch(/both hands/);
    expect(equipItem(pc, 'maul').equipped.offHand).toBeUndefined();
    const two = pcWith({ mainHand: 'maul' }, ['shield']);
    expect(canEquip(two, 'shield')).toMatchObject({ ok: true, unequips: 'maul' });
    expect(canEquip(pc, 'longsword').unequips).toBeUndefined();
    expect(canEquip(pc, 'halberd').ok).toBe(false);
    expect(buyItem({ ...pc, gold: 100 }, 'halberd').inventory.some((s) => s.itemId === 'halberd')).toBe(true);
  });
});

describe('weapon masteries (keyed to weapon data and the hero\'s mastered kinds)', () => {
  const grid = createOpenRoomNav(12, 8, { walls: [{ x: 6, y: 3 }] });
  function duel(hero: Creature, foe: Creature, nav = grid): { combat: CombatApi; rng: ScriptedRng } {
    const rng = new ScriptedRng(5);
    delete hero.resources['lastStand'];
    return { combat: startCombat([hero, foe], nav, rng, 'player'), rng };
  }
  const dummy = (x: number, y: number, over = {}): Creature => instantiateMonster(mon({ id: 'dummy', ac: 5, hp: 500, ...over }), 'dummy', { x, y });
  const withMasteries = (list: string[], equipped: PlayerCharacter['equipped']): PlayerCharacter =>
    pcWith(equipped, [], { choices: { fightingStyle: 'defense', startingKit: 'a', masteries: list.join(',') } });

  it('defaults to the starting kit kinds and can be overridden through build.choices.masteries', () => {
    expect(masteredKinds(createCharacter(makeBuild({ choices: { fightingStyle: 'defense', startingKit: 'a' } })))).toEqual(['longsword', 'javelin', 'shortsword']);
    expect(masteredKinds(withMasteries(['maul'], {}))).toEqual(['maul']);
    // not mastered: no effect
    const nope = toCreature(withMasteries(['javelin'], { mainHand: 'maul' }), { x: 3, y: 3 });
    expect(action(nope, 'atk_maul').effects ?? []).toEqual([]);
    const yes = toCreature(withMasteries(['maul'], { mainHand: 'maul' }), { x: 3, y: 3 });
    expect(action(yes, 'atk_maul').effects).toEqual(['mastery:topple:13']);
  });

  it('Sap: the target has disadvantage on its next attack roll, once', () => {
    const hero = toCreature(withMasteries(['longsword'], { mainHand: 'longsword' }), { x: 3, y: 3 });
    const foe = dummy(4, 3, { actions: [{ id: 'hit', name: 'hit', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 5 }, damage: [{ dice: '1', type: 'slashing' }] }] });
    const { combat, rng } = duel(hero, foe);
    rng.queue = [15, 3];
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'dummy' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [15, 4];
    const ev = combat.execute({ type: 'action', actionId: 'hit', targetId: 'player' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ mode: 'disadvantage', d20: 4 });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
  });

  it('Topple: a failed CON save makes the target prone', () => {
    const hero = toCreature(withMasteries(['maul'], { mainHand: 'maul' }), { x: 3, y: 3 });
    const foe = dummy(4, 3);
    const { combat, rng } = duel(hero, foe);
    rng.queue = [15, 3, 3, 1]; // hit, 2d6, CON save of 1 fails
    const ev = combat.execute({ type: 'action', actionId: 'atk_maul', targetId: 'dummy' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ ability: 'con', dc: 13, success: false });
    expect(ofType(ev, 'conditionAdded')[0]).toMatchObject({ creatureId: 'dummy', condition: 'prone' });
    // a success leaves it standing
    const h2 = toCreature(withMasteries(['maul'], { mainHand: 'maul' }), { x: 3, y: 3 });
    const f2 = dummy(4, 3);
    const d2 = duel(h2, f2);
    d2.rng.queue = [15, 3, 3, 20];
    expect(ofType(d2.combat.execute({ type: 'action', actionId: 'atk_maul', targetId: 'dummy' }), 'conditionAdded')).toHaveLength(0);
  });

  it('Push: moves a Large-or-smaller target up to 10 ft straight away, stopping at walls and creatures; never Huge', () => {
    const hero = toCreature(withMasteries(['warhammer'], { mainHand: 'warhammer' }), { x: 2, y: 4 });
    const foe = dummy(3, 4, { size: 'large' });
    const { combat, rng } = duel(hero, foe);
    rng.queue = [15, 3];
    const ev = combat.execute({ type: 'action', actionId: 'atk_warhammer', targetId: 'dummy' });
    expect(foe.pos).toEqual({ x: 5, y: 4 });
    expect(ofType(ev, 'move')[0]).toMatchObject({ creatureId: 'dummy', path: [{ x: 4, y: 4 }, { x: 5, y: 4 }] });
    // wall at (6,3): pushing along y=3 stops short
    const h2 = toCreature(withMasteries(['warhammer'], { mainHand: 'warhammer' }), { x: 4, y: 3 });
    const f2 = dummy(5, 3);
    const d2 = duel(h2, f2);
    d2.rng.queue = [15, 3];
    d2.combat.execute({ type: 'action', actionId: 'atk_warhammer', targetId: 'dummy' });
    expect(f2.pos).toEqual({ x: 5, y: 3 });
    const h3 = toCreature(withMasteries(['warhammer'], { mainHand: 'warhammer' }), { x: 2, y: 4 });
    const f3 = dummy(3, 4, { size: 'huge' });
    const d3 = duel(h3, f3);
    d3.rng.queue = [15, 3];
    d3.combat.execute({ type: 'action', actionId: 'atk_warhammer', targetId: 'dummy' });
    expect(f3.pos).toEqual({ x: 3, y: 4 });
  });

  it('Graze: a miss still deals the ability modifier; Slow and Vex follow the data', () => {
    const hero = toCreature(withMasteries(['greatsword'], { mainHand: 'greatsword' }), { x: 3, y: 3 });
    const foe = dummy(4, 3, { ac: 30 });
    const { combat, rng } = duel(hero, foe);
    rng.queue = [3];
    const ev = combat.execute({ type: 'action', actionId: 'atk_greatsword', targetId: 'dummy' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 3, damageType: 'slashing' });
    const jav = toCreature(withMasteries(['javelin'], { mainHand: 'longsword' }), { x: 3, y: 3 });
    expect(jav.actions.find((a) => a.id === 'throw_javelin')?.effects).toEqual(['mastery:slow']);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, CharacterBuild, Creature, GameEvent, PlayerCharacter } from '../core/types';
import { buildFromPreset, canEquip, computeAc, createCharacter, equipItem, migrateEquipment, toCreature } from './character';
import { FIGHTER } from './classes';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(14, 8);
const ofType = <T extends GameEvent['type']>(ev: GameEvent[], t: T) => ev.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);
const act = (c: Creature, id: string): ActionDef | undefined => c.actions.find((a) => a.id === id);

const DEX_BUILD: Partial<CharacterBuild> = {
  speciesId: 'dwarf',
  baseAbilities: { dex: 15, con: 14, str: 13, cha: 12, wis: 10, int: 8 },
  abilityIncreases: { dex: 2, con: 1 },
};

/** A kit-c archer, with optional overrides of the equipped set, the style and the masteries. */
function archer(over: { equipped?: PlayerCharacter['equipped']; style?: string; masteries?: string; extra?: string[]; build?: Partial<CharacterBuild> } = {}): PlayerCharacter {
  const pc = createCharacter(makeBuild({ ...DEX_BUILD, ...over.build, choices: { fightingStyle: over.style ?? 'archery', startingKit: 'c', ...(over.masteries ? { masteries: over.masteries } : {}) } }));
  for (const id of over.extra ?? []) {
    const stack = pc.inventory.find((x) => x.itemId === id);
    if (stack) stack.quantity += 1;
    else pc.inventory.push({ itemId: id, quantity: 1 });
  }
  return over.equipped ? { ...pc, equipped: over.equipped } : pc;
}

const heroOf = (pc: PlayerCharacter, x = 3, y = 3): Creature => {
  const c = toCreature(pc, { x, y });
  delete c.resources['lastStand'];
  return c;
};
const dummy = (x: number, y: number, id = 'dummy', hp = 80): Creature => instantiateMonster(mon({ id, name: id, hp, ac: 10 }), id, { x, y });

function duel(hero: Creature, foes: Creature[], activeId = 'player'): { combat: ReturnType<typeof startCombat>; rng: ScriptedRng } {
  const rng = new ScriptedRng(5);
  return { combat: startCombat([hero, ...foes], nav, rng, activeId), rng };
}

describe('the Archer kit and the three weapon slots', () => {
  it('equips scale mail, a longbow in the ranged slot, a shortsword in the main hand and a scimitar in the off hand', () => {
    const pc = archer();
    expect(pc.equipped).toEqual({ armor: 'scale_mail', mainHand: 'shortsword', offHand: 'scimitar', ranged: 'longbow' });
    expect(pc.build.choices['masteries']).toBe('longbow,shortsword,scimitar');
    expect(pc.inventory.map((s) => s.itemId)).toEqual(expect.arrayContaining(['scale_mail', 'longbow', 'shortsword', 'scimitar']));
  });

  it('derives a ranged attack from the ranged slot, melee attacks from the main hand, and the off-hand attack', () => {
    const c = heroOf(archer());
    expect(act(c, 'atk_longbow')?.targeting).toMatchObject({ kind: 'creature', melee: false, range: 30, longRange: 120 });
    expect(act(c, 'atk_shortsword')?.targeting).toMatchObject({ melee: true, range: 1 });
    // DEX 17 (+3): Archery +2 applies to the bow only.
    expect(act(c, 'atk_longbow')?.attack?.bonus).toBe(3 + 2 + 2);
    expect(act(c, 'atk_shortsword')?.attack?.bonus).toBe(3 + 2);
    expect(act(c, 'offhand_scimitar')).toMatchObject({ name: 'Off-hand: Scimitar', icon: 'melee' });
    expect(c.actions.filter((a) => a.id.startsWith('atk_')).map((a) => a.id)).toEqual(['atk_shortsword', 'atk_longbow']);
  });

  it('keeps a shield\'s AC bonus while a two-handed bow is in the ranged slot', () => {
    const withShield = archer({ equipped: { armor: 'scale_mail', mainHand: 'shortsword', offHand: 'shield', ranged: 'longbow' }, extra: ['shield'] });
    const withoutBow = { ...withShield, equipped: { armor: 'scale_mail', mainHand: 'shortsword', offHand: 'shield' } };
    expect(computeAc(withShield)).toBe(computeAc(withoutBow));
    expect(computeAc(withShield)).toBe(14 + 2 + 2);
  });

  it('applies scale mail\'s Dexterity cap of 2 to the Archer preset', () => {
    const archerPreset = FIGHTER.presets.find((p) => p.id === 'archer') as (typeof FIGHTER.presets)[number];
    const pc = createCharacter(buildFromPreset(archerPreset, 'soldier'));
    expect(pc.build.abilityIncreases).toEqual({ dex: 2, con: 1 });
    // DEX 17 would be +3, the cap allows +2: 14 + 2 = 16, no Defense.
    expect(computeAc(pc)).toBe(16);
  });

  it('applies the SRD Heavy rule: a longbow at Dexterity below 13 has disadvantage, a greatsword at Strength below 13 too', () => {
    const weak = heroOf(archer({ build: { baseAbilities: { dex: 12, con: 14, str: 13, cha: 12, wis: 10, int: 8 }, abilityIncreases: { con: 1, str: 2 } } }));
    expect(act(weak, 'atk_longbow')?.effects).toContain('heavyDisadvantage');
    const rng = new ScriptedRng(1);
    const combat = startCombat([weak, dummy(8, 3)], nav, rng, 'player');
    rng.queue = [15, 4];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longbow', targetId: 'dummy' });
    expect(ofType(ev, 'attackRoll')[0]?.mode).toBe('disadvantage');
    expect(act(heroOf(archer()), 'atk_longbow')?.effects ?? []).not.toContain('heavyDisadvantage');
    const gs = heroOf(createCharacter(makeBuild({ speciesId: 'dwarf', baseAbilities: { str: 8, dex: 15, con: 14, int: 12, wis: 10, cha: 13 }, abilityIncreases: { dex: 2, con: 1 }, choices: { fightingStyle: 'defense', startingKit: 'b' } })));
    expect(act(gs, 'atk_greatsword')?.effects).toContain('heavyDisadvantage');
    expect(act(heroOf(createCharacter(makeBuild({ choices: { fightingStyle: 'defense', startingKit: 'b' } }))), 'atk_greatsword')?.effects ?? []).not.toContain('heavyDisadvantage');
  });
});

describe('Light: the extra off-hand attack', () => {
  it('is only possible after a main-hand attack with a Light weapon, and explains why not', () => {
    const c = heroOf(archer({ masteries: 'longbow' }));
    const { combat, rng } = duel(c, [dummy(4, 3)]);
    expect(combat.canUse('offhand_scimitar')).toEqual({ ok: false, reason: 'Attack with your main hand first' });
    // Shooting the bow and casting nothing do not unlock it.
    rng.queue = [15, 4];
    combat.execute({ type: 'action', actionId: 'atk_longbow', targetId: 'dummy' });
    expect(combat.canUse('offhand_scimitar').ok).toBe(false);
  });

  it('is a bonus action after the main-hand attack, once per turn, with no ability modifier on the damage', () => {
    const c = heroOf(archer({ masteries: 'longbow' }));
    expect(act(c, 'offhand_scimitar')).toMatchObject({ cost: 'bonus' });
    // The main hand adds DEX (+3); the off hand does not.
    expect(act(c, 'atk_shortsword')?.damage?.[0]?.dice).toBe('1d6+3');
    expect(act(c, 'offhand_scimitar')?.damage?.[0]?.dice).toBe('1d6');
    const { combat, rng } = duel(c, [dummy(4, 3)]);
    rng.queue = [15, 4];
    combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'dummy' });
    expect(combat.canUse('offhand_scimitar')).toEqual({ ok: true });
    rng.queue = [15, 5];
    const ev = combat.execute({ type: 'action', actionId: 'offhand_scimitar', targetId: 'dummy' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ actionName: 'Off-hand: Scimitar', bonus: 3 + 2 });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 5, damageType: 'slashing' });
    expect(combat.turn).toMatchObject({ actionUsed: true, bonusUsed: true });
    expect(combat.canUse('offhand_scimitar').ok).toBe(false);
  });

  it('keeps a negative modifier on the off-hand damage', () => {
    const clumsy = heroOf(archer({ masteries: 'longbow', build: { baseAbilities: { dex: 8, con: 14, str: 13, cha: 12, wis: 10, int: 15 }, abilityIncreases: { con: 1, str: 2 } } }));
    // DEX 8 (-1), STR 15 (+2): finesse picks STR for the blades, so use a build where both are negative.
    const bad = heroOf(archer({ masteries: 'longbow', build: { baseAbilities: { dex: 8, con: 14, str: 8, cha: 12, wis: 10, int: 15 }, abilityIncreases: { con: 2, str: 1 } } }));
    expect(act(bad, 'offhand_scimitar')?.damage?.[0]?.dice).toBe('1d6-1');
    expect(act(bad, 'atk_shortsword')?.damage?.[0]?.dice).toBe('1d6-1');
    expect(act(clumsy, 'offhand_scimitar')?.damage?.[0]?.dice).toBe('1d6');
  });

  it('Two-Weapon Fighting adds the ability modifier to the off-hand damage', () => {
    const c = heroOf(archer({ style: 'twoWeaponFighting', masteries: 'longbow' }));
    expect(act(c, 'offhand_scimitar')?.damage?.[0]?.dice).toBe('1d6+3');
    // ...and not to anything else: the bow loses Archery.
    expect(act(c, 'atk_longbow')?.attack?.bonus).toBe(3 + 2);
  });

  it('needs a DIFFERENT Light weapon: two of the same kind work only with two copies', () => {
    const one = heroOf(archer({ equipped: { armor: 'scale_mail', mainHand: 'shortsword', offHand: 'shortsword', ranged: 'longbow' } }));
    expect(act(one, 'offhand_shortsword')).toBeUndefined();
    const two = heroOf(archer({ equipped: { armor: 'scale_mail', mainHand: 'shortsword', offHand: 'shortsword', ranged: 'longbow' }, extra: ['shortsword'] }));
    expect(act(two, 'offhand_shortsword')).toMatchObject({ cost: 'bonus' });
  });

  it('is not offered with a shield or without a Light main-hand weapon', () => {
    const shield = heroOf(createCharacter(makeBuild({ choices: { fightingStyle: 'defense', startingKit: 'a' } })));
    expect(shield.actions.some((a) => a.id.startsWith('offhand_'))).toBe(false);
    const heavy = heroOf(archer({ equipped: { armor: 'scale_mail', mainHand: 'longsword', offHand: 'scimitar' }, extra: ['longsword'] }));
    expect(heavy.actions.some((a) => a.id.startsWith('offhand_'))).toBe(false);
  });

  it('Nick: with mastery of the off-hand weapon the extra attack is a free part of the Attack action, once per turn', () => {
    const c = heroOf(archer());
    expect(act(c, 'offhand_scimitar')).toMatchObject({ cost: 'free' });
    const { combat, rng } = duel(c, [dummy(4, 3)]);
    rng.queue = [15, 4];
    combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'dummy' });
    rng.queue = [15, 4];
    combat.execute({ type: 'action', actionId: 'offhand_scimitar', targetId: 'dummy' });
    // The bonus action is still free (Second Wind), and the extra attack cannot be repeated.
    expect(combat.turn).toMatchObject({ actionUsed: true, bonusUsed: false });
    expect(combat.canUse('second_wind').ok).toBe(true);
    expect(combat.canUse('offhand_scimitar').ok).toBe(false);
  });

  it('Nick does nothing without mastery of the off-hand weapon, or when only the main hand has it', () => {
    const unmastered = heroOf(archer({ masteries: 'longbow,shortsword' }));
    expect(act(unmastered, 'offhand_scimitar')).toMatchObject({ cost: 'bonus' });
    // Main-hand dagger has Nick; the off-hand shortsword (Vex) makes the extra attack, so it stays a bonus action.
    const dagger = heroOf(archer({ equipped: { armor: 'scale_mail', mainHand: 'dagger', offHand: 'shortsword', ranged: 'longbow' }, extra: ['dagger'], masteries: 'dagger,shortsword,longbow' }));
    expect(act(dagger, 'offhand_shortsword')).toMatchObject({ cost: 'bonus' });
  });

  it('opportunity attacks use the main-hand weapon only', () => {
    const c = heroOf(archer());
    const { combat, rng } = duel(c, [dummy(4, 3)], 'dummy');
    rng.queue = [15, 4];
    const ev = combat.execute({ type: 'move', path: [{ x: 5, y: 3 }] });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ actionName: 'Opportunity Attack (Shortsword)', reaction: true });
  });
});

describe('equipping with three weapon slots', () => {
  const pcWith = (equipped: PlayerCharacter['equipped'], extra: string[] = []): PlayerCharacter => {
    const pc = createCharacter(makeBuild({ speciesId: 'dwarf' }));
    for (const id of [...Object.values(equipped), ...extra]) if (!pc.inventory.some((s) => s.itemId === id)) pc.inventory.push({ itemId: id as string, quantity: 1 });
    return { ...pc, equipped };
  };

  it('routes a non-thrown ranged weapon to the ranged slot and leaves the melee set alone', () => {
    const pc = pcWith({ armor: 'chain_mail', mainHand: 'longsword', offHand: 'shield' }, ['longbow']);
    expect(canEquip(pc, 'longbow')).toEqual({ ok: true });
    expect(equipItem(pc, 'longbow').equipped).toEqual({ armor: 'chain_mail', mainHand: 'longsword', offHand: 'shield', ranged: 'longbow' });
  });

  it('puts a second Light weapon in the off hand when the main hand is Light and there is no shield, saying so', () => {
    const pc = pcWith({ armor: 'scale_mail', mainHand: 'shortsword' }, ['scimitar']);
    const plan = canEquip(pc, 'scimitar');
    expect(plan.ok).toBe(true);
    expect(plan.reason).toMatch(/off hand for two-weapon fighting/);
    expect(equipItem(pc, 'scimitar').equipped).toEqual({ armor: 'scale_mail', mainHand: 'shortsword', offHand: 'scimitar' });
  });

  it('with a shield, a Light weapon replaces the main hand; a non-Light weapon puts the off-hand weapon away', () => {
    const shielded = pcWith({ mainHand: 'shortsword', offHand: 'shield' }, ['scimitar']);
    expect(equipItem(shielded, 'scimitar').equipped).toEqual({ mainHand: 'scimitar', offHand: 'shield' });
    const dual = pcWith({ mainHand: 'shortsword', offHand: 'scimitar' }, ['longsword', 'greatsword', 'shield']);
    const sword = canEquip(dual, 'longsword');
    expect(sword).toMatchObject({ ok: true, unequips: 'scimitar' });
    expect(sword.reason).toMatch(/not Light/);
    expect(equipItem(dual, 'longsword').equipped).toEqual({ mainHand: 'longsword' });
    expect(equipItem(dual, 'greatsword').equipped).toEqual({ mainHand: 'greatsword' });
    expect(equipItem(dual, 'shield').equipped).toEqual({ mainHand: 'shortsword', offHand: 'shield' });
  });

  it('never routes a melee thrown weapon into the ranged slot', () => {
    const pc = pcWith({ mainHand: 'longsword', offHand: 'shield' }, ['javelin']);
    expect(equipItem(pc, 'javelin').equipped.ranged).toBeUndefined();
  });
});

describe('migrating characters saved before the ranged slot', () => {
  it('moves a bow out of the main hand and promotes a carried melee weapon', () => {
    const old = createCharacter(makeBuild({ ...DEX_BUILD, choices: { fightingStyle: 'archery', startingKit: 'c' } }));
    const legacy: PlayerCharacter = { ...old, equipped: { armor: 'scale_mail', mainHand: 'longbow' }, inventory: [{ itemId: 'scale_mail', quantity: 1 }, { itemId: 'longbow', quantity: 1 }, { itemId: 'shortsword', quantity: 1 }] };
    const m = migrateEquipment(legacy);
    expect(m.equipped).toEqual({ armor: 'scale_mail', ranged: 'longbow', mainHand: 'shortsword' });
    expect(legacy.equipped).toEqual({ armor: 'scale_mail', mainHand: 'longbow' });
    // toCreature migrates on the fly, so a legacy save keeps playing without touching the game layer.
    const c = toCreature(legacy, { x: 1, y: 1 });
    expect(c.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['atk_longbow', 'atk_shortsword']));
    expect(act(c, 'atk_longbow')?.targeting).toMatchObject({ melee: false });
    // Already-migrated characters are returned untouched.
    expect(migrateEquipment(m)).toBe(m);
  });

  it('keeps an off-hand shield, and leaves the main hand empty when no melee weapon is carried', () => {
    const old = createCharacter(makeBuild({ choices: { fightingStyle: 'archery', startingKit: 'b' } }));
    const legacy: PlayerCharacter = { ...old, equipped: { mainHand: 'longbow', offHand: 'shield' }, inventory: [{ itemId: 'longbow', quantity: 1 }, { itemId: 'shield', quantity: 1 }] };
    expect(migrateEquipment(legacy).equipped).toEqual({ ranged: 'longbow', offHand: 'shield' });
    // Equipping through the engine also writes the normalized slots back.
    expect(equipItem(legacy, 'shield').equipped.ranged).toBe('longbow');
  });
});

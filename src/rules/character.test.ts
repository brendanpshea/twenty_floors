import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { CharacterBuild, PlayerCharacter } from '../core/types';
import {
  applyLevelUp,
  buyItem,
  computeAc,
  createCharacter,
  enterFloor,
  equipItem,
  floorReward,
  getCreationOptions,
  longRest,
  previewLevelUp,
  shopStock,
  takeShortRest,
  shortRestGain,
  longRestGain,
  syncFromCreature,
  toCreature,
  validateBuild,
} from './character';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, makeBuild } from './testing/fixtures';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const hero = (over: Partial<CharacterBuild> = {}): PlayerCharacter => createCharacter(makeBuild(over));

describe('creation options and validation', () => {
  it('exposes the milestone content', () => {
    const o = getCreationOptions();
    expect(o.classes.map((c) => c.id)).toEqual(['fighter']);
    expect(o.species.map((s) => s.id)).toEqual(['human', 'dwarf', 'elf']);
    expect(o.backgrounds.map((b) => b.id).sort()).toEqual(['acolyte', 'criminal', 'sage', 'soldier']);
    expect(o.standardArray).toEqual([15, 14, 13, 12, 10, 8]);
    expect(o.pointBuy.budget).toBe(27);
    expect(o.pointBuy.costs[15]).toBe(9);
    const fighter = o.classes[0]!;
    expect(fighter.choices.find((c) => c.key === 'startingKit')?.options).toHaveLength(3);
    expect(Object.values(fighter.recommendedAbilities).sort((a, b) => b - a)).toEqual(o.standardArray);
  });

  it('accepts the recommended build', () => {
    expect(validateBuild(makeBuild())).toEqual([]);
  });

  it('accepts a legal point buy and rejects an illegal one', () => {
    const ok = makeBuild({ baseAbilities: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } });
    expect(validateBuild(ok)).toEqual([]);
    const bad = makeBuild({ baseAbilities: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } });
    expect(validateBuild(bad).length).toBeGreaterThan(0);
    const high = makeBuild({ baseAbilities: { str: 17, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } });
    expect(validateBuild(high).length).toBeGreaterThan(0);
  });

  it('rejects bad increases, skills, choices and names', () => {
    expect(validateBuild(makeBuild({ abilityIncreases: { str: 2, con: 2 } })).length).toBeGreaterThan(0);
    expect(validateBuild(makeBuild({ abilityIncreases: { int: 2, con: 1 } })).length).toBeGreaterThan(0); // soldier can't raise int
    expect(validateBuild(makeBuild({ abilityIncreases: { str: 1, dex: 1, con: 1 } }))).toEqual([]);
    expect(validateBuild(makeBuild({ skills: ['perception'] })).length).toBeGreaterThan(0);
    expect(validateBuild(makeBuild({ skills: ['athletics', 'perception'] })).length).toBeGreaterThan(0); // background skill
    expect(validateBuild(makeBuild({ skills: ['arcana', 'perception'] })).length).toBeGreaterThan(0); // not a fighter skill
    expect(validateBuild(makeBuild({ choices: { startingKit: 'a' } })).length).toBeGreaterThan(0);
    expect(validateBuild(makeBuild({ choices: { fightingStyle: 'dueling', startingKit: 'a' } })).length).toBeGreaterThan(0);
    expect(validateBuild(makeBuild({ name: '  ' })).length).toBeGreaterThan(0);
    expect(validateBuild(makeBuild({ speciesId: 'gnome' })).length).toBeGreaterThan(0);
    expect(() => createCharacter(makeBuild({ name: '' }))).toThrow();
  });
});

describe('character creation', () => {
  it('builds a level 1 fighter with max HP, kit, potions and gold', () => {
    const pc = hero();
    expect(pc.level).toBe(1);
    expect(pc.maxHp).toBe(12); // d10 max + CON 15 (+2)
    expect(pc.hp).toBe(pc.maxHp);
    expect(pc.gold).toBe(10);
    expect(pc.inventory.find((s) => s.itemId === 'potion_healing')?.quantity).toBe(2);
    expect(pc.equipped).toEqual({ armor: 'chain_mail', mainHand: 'longsword', offHand: 'shield' });
    expect(pc.resources['secondWind']).toMatchObject({ current: 2, max: 2 });
  });

  it('gives each kit its gear', () => {
    const b = hero({ choices: { fightingStyle: 'defense', startingKit: 'b' } });
    expect(b.equipped).toEqual({ armor: 'chain_mail', mainHand: 'greatsword' });
    expect(b.inventory.find((s) => s.itemId === 'javelin')?.quantity).toBe(4);
    const c = hero({ choices: { fightingStyle: 'archery', startingKit: 'c' } });
    expect(c.equipped).toEqual({ armor: 'scale_mail', mainHand: 'shortsword', offHand: 'scimitar', ranged: 'longbow' });
    expect(c.inventory.map((s) => s.itemId)).toContain('shortsword');
  });

  it('applies species traits', () => {
    const dwarf = hero({ speciesId: 'dwarf' });
    expect(dwarf.maxHp).toBe(hero().maxHp + 1);
    const dc = toCreature(dwarf, { x: 0, y: 0 });
    expect(dc.resistances).toContain('poison');
    expect(dc.resources['_saveAdv_poisoned']).toBeDefined();
    const elf = toCreature(hero({ speciesId: 'elf' }), { x: 0, y: 0 });
    expect(elf.resources['_saveAdv_charmed']).toBeDefined();
    const human = hero();
    expect(human.resources['inspiration']).toMatchObject({ max: 1, refresh: 'floor' });
    expect(getCreationOptions().species.every((s) => s.visual.model === 'hero_knight' && s.visual.tint === undefined)).toBe(true);
  });
});

describe('armor class', () => {
  it('computes AC for each kit and fighting style', () => {
    // DEX 12 -> +1. Chain mail 16 flat, shield +2, Defense +1 = 19.
    expect(computeAc(hero())).toBe(19);
    expect(computeAc(hero({ choices: { fightingStyle: 'archery', startingKit: 'a' } }))).toBe(18);
    expect(computeAc(hero({ choices: { fightingStyle: 'defense', startingKit: 'c' } }))).toBe(14 + 1 + 1);
  });

  it('handles unarmored and dex caps', () => {
    const pc = hero();
    const naked = { ...pc, equipped: {} };
    expect(computeAc(naked)).toBe(11);
    const shirt = { ...pc, equipped: { armor: 'chain_shirt' } };
    expect(computeAc(shirt)).toBe(13 + 1 + 1);
    const rich = createCharacter(makeBuild({ baseAbilities: { str: 8, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }, abilityIncreases: { dex: 2, con: 1 }, choices: { fightingStyle: 'archery', startingKit: 'c' } }));
    expect(computeAc(rich)).toBe(14 + 2); // scale mail, dex 17 capped at +2
    expect(computeAc({ ...rich, equipped: { armor: 'chain_shirt' } })).toBe(13 + 2);
  });
});

describe('toCreature', () => {
  it('derives attacks, utility actions and potions', () => {
    const c = toCreature(hero(), { x: 3, y: 4 });
    expect(c.id).toBe('player');
    expect(c.faction).toBe('player');
    expect(c.pos).toEqual({ x: 3, y: 4 });
    expect(c.speed).toBe(6);
    const ids = c.actions.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['atk_longsword', 'throw_javelin', 'dash', 'disengage', 'dodge', 'second_wind', 'drink_potion_healing']));
    expect(ids).not.toContain('action_surge');
    // STR 17 (+3), PB +2: attack +5; shield equipped so longsword is one-handed 1d8+3.
    const sword = c.actions.find((a) => a.id === 'atk_longsword')!;
    expect(sword.attack?.bonus).toBe(5);
    expect(sword.damage?.[0]?.dice).toBe('1d8+3');
    const potion = c.actions.find((a) => a.id === 'drink_potion_healing')!;
    expect(potion.cost).toBe('bonus');
    expect(potion.uses).toEqual({ resource: 'item:potion_healing', amount: 1 });
    expect(c.resources['item:potion_healing']?.current).toBe(2);
    expect(c.actions.find((a) => a.id === 'second_wind')?.heal).toBe('1d10+1');
  });

  it('wields versatile weapons in two hands without a shield and applies Great Weapon Fighting', () => {
    let pc = hero({ choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'a' } });
    pc = { ...pc, equipped: { armor: 'chain_mail', mainHand: 'longsword' } };
    const sword = toCreature(pc, { x: 0, y: 0 }).actions.find((a) => a.id === 'atk_longsword')!;
    expect(sword.damage?.[0]?.dice).toBe('1d10+3');
    expect(sword.effects).toContain('greatWeaponFighting');
    const withShield = toCreature(hero({ choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'a' } }), { x: 0, y: 0 });
    expect(withShield.actions.find((a) => a.id === 'atk_longsword')?.effects ?? []).not.toContain('greatWeaponFighting');
  });

  it('uses DEX and Archery for ranged weapons and offers a melee alternative', () => {
    const pc = hero({ choices: { fightingStyle: 'archery', startingKit: 'c' } });
    const c = toCreature(pc, { x: 0, y: 0 });
    const bow = c.actions.find((a) => a.id === 'atk_longbow')!;
    expect(bow.attack?.bonus).toBe(1 + 2 + 2); // DEX +1, PB +2, Archery +2
    expect(bow.targeting).toMatchObject({ kind: 'creature', melee: false });
    const sword = c.actions.find((a) => a.id === 'atk_shortsword')!;
    expect(sword.attack?.bonus).toBe(3 + 2); // finesse: STR +3 beats DEX
  });

  it('provides Action Surge at level 2 and flags at level 3', () => {
    let pc = hero();
    pc = applyLevelUp(pc, {});
    expect(toCreature(pc, { x: 0, y: 0 }).actions.find((a) => a.id === 'action_surge')?.effects).toContain('actionSurge');
    expect(toCreature(pc, { x: 0, y: 0 }).resources['_crit19']).toBeUndefined();
    pc = applyLevelUp(pc, {});
    const c = toCreature(pc, { x: 0, y: 0 });
    expect(c.resources['_crit19']).toBeDefined();
    expect(c.resources['_initAdv']).toBeDefined();
    expect(c.proficiencyBonus).toBe(2);
  });

  it('is plain JSON', () => {
    const c = toCreature(hero(), { x: 1, y: 1 });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    const pc = hero();
    expect(JSON.parse(JSON.stringify(pc))).toEqual(pc);
  });

  it('copies hp, resources and consumed potions back', () => {
    const pc = hero();
    const c = toCreature(pc, { x: 0, y: 0 });
    c.hp = 4;
    (c.resources['secondWind'] as { current: number }).current = 1;
    (c.resources['item:potion_healing'] as { current: number }).current = 0;
    const next = syncFromCreature(pc, c);
    expect(next.hp).toBe(4);
    expect(next.resources['secondWind']?.current).toBe(1);
    expect(next.inventory.find((s) => s.itemId === 'potion_healing')).toBeUndefined();
    expect(pc.hp).toBe(pc.maxHp); // input untouched
  });
});

describe('levelling', () => {
  it('levels 1 to 3 with max HP and new features, then stops', () => {
    let pc = hero();
    const p2 = previewLevelUp(pc)!;
    expect(p2).toMatchObject({ fromLevel: 1, toLevel: 2, hpGain: 12 });
    expect(p2.featureSummaries.join(' ')).toContain('Action Surge');
    pc = applyLevelUp(pc, {});
    expect(pc).toMatchObject({ level: 2, maxHp: 24, hp: 24 });
    expect(pc.resources['actionSurge']).toMatchObject({ current: 1, max: 1, refresh: 'shortRest' });
    const p3 = previewLevelUp(pc)!;
    expect(p3.featureSummaries.join(' ')).toContain('19 or 20');
    pc = applyLevelUp(pc, {});
    expect(pc.level).toBe(3);
    expect(pc.maxHp).toBe(36);
    expect(previewLevelUp(pc)).toBeNull();
    expect(() => applyLevelUp(pc, {})).toThrow();
  });

  it('keeps spent resources spent when the maximum grows', () => {
    let pc = hero();
    pc = { ...pc, resources: { ...pc.resources, secondWind: { ...pc.resources['secondWind']!, current: 0 } } };
    expect(applyLevelUp(pc, {}).resources['secondWind']?.current).toBe(0);
  });
});

describe('rests', () => {
  const level2 = (over: Partial<PlayerCharacter> = {}): PlayerCharacter => ({ ...applyLevelUp(hero(), {}), ...over });

  it('hit dice start at the level and grow with level-ups', () => {
    expect(hero().hitDiceLeft).toBe(1);
    expect(applyLevelUp(hero(), {}).hitDiceLeft).toBe(2);
    expect(applyLevelUp(applyLevelUp(hero(), {}), {}).hitDiceLeft).toBe(3);
  });

  it('short rest spends hit dice for d10 + CON (min 1 each) and never overheals', () => {
    const pc = level2({ hp: 4 }); // maxHp 24, CON +2
    const r = takeShortRest(pc, new Rng(3));
    expect(r.hitDiceSpent).toBe(2);
    expect(r.pc.hitDiceLeft).toBe(0);
    expect(r.healed).toBeGreaterThanOrEqual(6);
    expect(r.healed).toBeLessThanOrEqual(24);
    expect(r.pc.hp).toBe(4 + r.healed);
    expect(r.pc.hp).toBeLessThanOrEqual(24);
    expect(pc.hp).toBe(4);
    expect(pc.hitDiceLeft).toBe(2);
  });

  it('optimal spending: skip a die that would mostly be wasted, spend one below half HP', () => {
    // average die = 5.5 + 2 = 7.5
    const small = takeShortRest(level2({ hp: 24 - 7 }), new Rng(1)); // missing 7 < 7.5 and above half
    expect(small.hitDiceSpent).toBe(0);
    expect(small.healed).toBe(0);
    const enough = takeShortRest(level2({ hp: 24 - 8 }), new Rng(1)); // missing 8 >= 7.5
    expect(enough.hitDiceSpent).toBeGreaterThanOrEqual(1);
    const low = takeShortRest({ ...level2({ hp: 11 }), maxHp: 24 }, new Rng(1)); // below 50%
    expect(low.hitDiceSpent).toBeGreaterThanOrEqual(1);
    // stops once the remaining gap is small
    for (let seed = 1; seed < 30; seed++) {
      const r = takeShortRest(level2({ hp: 10 }), new Rng(seed));
      expect(r.pc.hp >= 24 - 7.5 || r.pc.hitDiceLeft === 0 || r.pc.hp >= 12).toBe(true);
    }
    expect(takeShortRest(level2({ hp: 1, hitDiceLeft: 0 }), new Rng(1)).healed).toBe(0);
  });

  it('short rest: Second Wind regains exactly one use, Action Surge refills, Last Stand untouched', () => {
    const base = level2();
    const pc = {
      ...base,
      resources: {
        ...base.resources,
        secondWind: { ...base.resources['secondWind']!, current: 0 },
        actionSurge: { ...base.resources['actionSurge']!, current: 0 },
        lastStand: { ...base.resources['lastStand']!, current: 0 },
      },
    };
    const r = takeShortRest(pc, new Rng(1)).pc;
    expect(r.resources['secondWind']?.current).toBe(1);
    expect(r.resources['actionSurge']?.current).toBe(1);
    expect(r.resources['lastStand']?.current).toBe(0);
    expect(takeShortRest(r, new Rng(1)).pc.resources['secondWind']?.current).toBe(2);
    expect(takeShortRest(takeShortRest(r, new Rng(1)).pc, new Rng(1)).pc.resources['secondWind']?.current).toBe(2);
  });

  it('shortRestGain and longRestGain report whether resting would do anything', () => {
    const full = level2();
    expect(shortRestGain(full)).toEqual({ hp: false, resources: false });
    expect(longRestGain(full)).toBe(false);
    expect(shortRestGain({ ...full, hp: 5 }).hp).toBe(true);
    const spent = { ...full, resources: { ...full.resources, secondWind: { ...full.resources['secondWind']!, current: 1 } } };
    expect(shortRestGain(spent)).toEqual({ hp: false, resources: true });
    expect(longRestGain(spent)).toBe(true);
    expect(longRestGain({ ...full, hitDiceLeft: 1 })).toBe(true);
    const lsOnly = { ...full, resources: { ...full.resources, lastStand: { ...full.resources['lastStand']!, current: 0 } } };
    expect(longRestGain(lsOnly)).toBe(false);
  });

  it('long rest restores HP, all hit dice and resources but not Last Stand; enterFloor restores it', () => {
    const base = level2();
    const pc = {
      ...base,
      hp: 1,
      hitDiceLeft: 0,
      resources: {
        ...base.resources,
        secondWind: { ...base.resources['secondWind']!, current: 0 },
        lastStand: { ...base.resources['lastStand']!, current: 0 },
      },
    };
    const l = longRest(pc);
    expect(l.hp).toBe(l.maxHp);
    expect(l.hitDiceLeft).toBe(2);
    expect(l.resources['secondWind']?.current).toBe(2);
    expect(l.resources['lastStand']?.current).toBe(0);
    expect(enterFloor(l).resources['lastStand']?.current).toBe(1);
    const human = hero();
    const spentInsp = { ...human, resources: { ...human.resources, inspiration: { ...human.resources['inspiration']!, current: 0 } } };
    expect(longRest(spentInsp).resources['inspiration']?.current).toBe(1);
  });
});

describe('hub helpers', () => {
  it('rewards rise with depth', () => {
    expect(floorReward(2)).toBeGreaterThan(floorReward(1));
  });

  it('offers a curated, deterministic selection: potions, weapons, armor, a shield, nothing magic early', () => {
    const s1 = shopStock(1);
    expect(shopStock(1).map((i) => i.id)).toEqual(s1.map((i) => i.id));
    expect(s1.some((i) => i.id === 'potion_healing')).toBe(true);
    expect(s1.some((i) => i.id === 'potion_greater_healing')).toBe(false);
    expect(shopStock(3).some((i) => i.id === 'potion_greater_healing')).toBe(true);
    expect(s1.some((i) => i.kind === 'armor')).toBe(true);
    expect(s1.some((i) => i.kind === 'shield')).toBe(true);
    expect(s1.filter((i) => i.kind === 'weapon').length).toBeLessThanOrEqual(4);
    for (const d of [1, 2, 3]) expect(shopStock(d).some((i) => i.magicBonus)).toBe(false);
    for (let i = 1; i < s1.length; i++) expect(s1[i]!.cost).toBeGreaterThanOrEqual(s1[i - 1]!.cost);
  });

  it('unlocks magic stock by bonus at the gated depths', () => {
    expect(shopStock(4).some((i) => i.magicBonus === 1)).toBe(true);
    expect(shopStock(8).some((i) => (i.magicBonus ?? 0) >= 2)).toBe(false);
    expect(shopStock(9).some((i) => (i.magicBonus ?? 0) <= 2 && i.magicBonus)).toBe(true);
    for (const d of [4, 5, 6, 7, 8]) expect(shopStock(d).every((i) => (i.magicBonus ?? 0) <= 1)).toBe(true);
  });

  it('buys items without mutating and refuses when poor', () => {
    const pc = { ...hero(), gold: 60 };
    const bought = buyItem(pc, 'potion_healing');
    expect(bought.gold).toBe(10);
    expect(bought.inventory.find((s) => s.itemId === 'potion_healing')?.quantity).toBe(3);
    expect(pc.gold).toBe(60);
    expect(() => buyItem(pc, 'potion_greater_healing')).toThrow(/gold/);
    expect(() => buyItem(pc, 'nonsense')).toThrow();
  });

  it('equips owned items into the right slots', () => {
    let pc = { ...hero({ choices: { fightingStyle: 'defense', startingKit: 'b' } }), gold: 500 };
    pc = buyItem(pc, 'shield');
    pc = equipItem(pc, 'shield'); // greatsword is two-handed: it is put away
    expect(pc.equipped.offHand).toBe('shield');
    expect(pc.equipped.mainHand).toBeUndefined();
    pc = equipItem(pc, 'javelin');
    expect(pc.equipped.mainHand).toBe('javelin');
    pc = equipItem(pc, 'greatsword');
    expect(pc.equipped.offHand).toBeUndefined();
    expect(() => equipItem(pc, 'longbow')).toThrow(/own/);
    expect(equipItem(pc, 'chain_mail').equipped.armor).toBe('chain_mail');
  });
});

describe('useConsumable', () => {
  it('heals outside combat, consumes the item and never overheals', async () => {
    const { useConsumable } = await import('./character');
    const { Rng } = await import('../core/rng');
    const pc = { ...hero(), hp: 1 };
    const r = useConsumable(pc, 'potion_healing', new Rng(4));
    expect(r.healed).toBeGreaterThanOrEqual(4);
    expect(r.pc.hp).toBe(1 + r.healed);
    expect(r.pc.inventory.find((s) => s.itemId === 'potion_healing')?.quantity).toBe(1);
    expect(pc.hp).toBe(1);
    const small = { ...pc, hp: pc.maxHp - 1 };
    expect(useConsumable(small, 'potion_healing', new Rng(4)).healed).toBe(1);
    expect(() => useConsumable(hero(), 'potion_healing', new Rng(1))).toThrow(/full/);
    expect(() => useConsumable(pc, 'longsword', new Rng(1))).toThrow();
    expect(() => useConsumable(pc, 'potion_greater_healing', new Rng(1))).toThrow(/do not have/);
  });
});

describe('chestLoot', () => {
  it('always holds a potion, scales gold with depth and is deterministic', async () => {
    const { chestLoot } = await import('./character');
    const { Rng } = await import('../core/rng');
    let seconds = 0;
    for (let i = 0; i < 300; i++) {
      for (const depth of [1, 2, 3]) {
        const a = chestLoot(depth, new Rng(i));
        expect(a).toEqual(chestLoot(depth, new Rng(i)));
        expect(a.gold).toBeGreaterThanOrEqual(12 + 8 * depth);
        expect(a.gold).toBeLessThanOrEqual(24 + 16 * depth);
        const potions = a.items.find((s) => s.itemId === 'potion_healing')?.quantity ?? 0;
        expect(potions).toBeGreaterThanOrEqual(1);
        if (potions === 2) seconds++;
      }
    }
    expect(seconds).toBeGreaterThan(100);
  });
});

describe('chest magic finds', () => {
  it('never on floors 1-3, rare from depth 4', async () => {
    const { chestLoot } = await import('./character');
    const { Rng } = await import('../core/rng');
    let finds = 0;
    for (let i = 0; i < 600; i++) {
      for (const depth of [1, 2, 3]) expect(chestLoot(depth, new Rng(i)).items.every((s) => s.itemId === 'potion_healing')).toBe(true);
      if (chestLoot(5, new Rng(i)).items.some((s) => s.itemId !== 'potion_healing')) finds++;
    }
    expect(finds).toBeGreaterThan(30);
    expect(finds).toBeLessThan(150);
  });
});

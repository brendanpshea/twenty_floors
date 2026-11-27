import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPELLS } from '../data/spells';
import type { CharacterBuild, SpellDef } from '../core/types';
import { Rng } from '../core/rng';
import { BACKGROUNDS } from './backgrounds';
import {
  assignIncreases,
  buildFromPreset,
  computeAc,
  createCharacter,
  getCreationOptions,
  longRest,
  syncFromCreature,
  takeShortRest,
  toCreature,
  validateBuild,
} from './character';
import { castOutOfCombat, tempHpOf } from './casting';
import { FIGHTER } from './classes';
import { resetItemCatalog, setItemCatalog } from './items';
import { HIDDEN_FROM_CREATION, IMPLEMENTED_SPELL_IDS, casterFor, getSpell, offeredSpells, spellToAction } from './spells';
import { FIXTURE_ITEMS, makeBuild } from './testing/fixtures';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

export function sageBuild(over: Partial<CharacterBuild['choices']> = {}, bg: 'sage' | 'acolyte' = 'sage'): CharacterBuild {
  const sage = bg === 'sage';
  return makeBuild({
    backgroundId: bg,
    speciesId: 'dwarf',
    baseAbilities: sage ? { str: 15, con: 14, int: 13, dex: 12, wis: 10, cha: 8 } : { str: 15, con: 14, cha: 13, dex: 12, wis: 10, int: 8 },
    abilityIncreases: sage ? { int: 2, con: 1 } : { cha: 2, wis: 1 },
    choices: {
      fightingStyle: 'defense',
      startingKit: 'a',
      mi_cantrip1: sage ? 'fire_bolt' : 'sacred_flame',
      mi_cantrip2: sage ? 'ray_of_frost' : 'resistance',
      mi_spell: sage ? 'magic_missile' : 'guiding_bolt',
      mi_ability: sage ? 'int' : 'cha',
      ...over,
    },
  });
}

describe('spell to ActionDef derivation', () => {
  const caster = (level: number) => casterFor('int', { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }, level);
  it('computes the attack bonus, save DC and healing modifier from the caster', () => {
    const c = caster(1);
    expect(c.attack).toBe(2 + 3);
    expect(c.dc).toBe(8 + 2 + 3);
    expect(spellToAction(getSpell('fire_bolt') as SpellDef, c).attack).toEqual({ bonus: 5 });
    expect(spellToAction(getSpell('sacred_flame') as SpellDef, c).save).toEqual({ ability: 'dex', dc: 13, halfOnSave: false });
    expect(spellToAction(getSpell('cure_wounds') as SpellDef, c).heal).toBe('2d8+3');
    expect(spellToAction(getSpell('healing_word') as SpellDef, c)).toMatchObject({ cost: 'bonus', heal: '2d4+3', icon: 'heal' });
  });

  it('scales cantrips by character level at 5, 11 and 17', () => {
    const fb = getSpell('fire_bolt') as SpellDef;
    const dice = (lvl: number): string | undefined => spellToAction(fb, caster(lvl)).damage?.[0]?.dice;
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(dice)).toEqual(['1d10', '1d10', '2d10', '2d10', '3d10', '3d10', '4d10', '4d10']);
    // Proficiency grows with level too.
    expect(caster(5).attack).toBe(3 + 3);
  });

  it('ties level 1 spells to a once-per-long-rest pool named after the spell, and leaves cantrips unlimited', () => {
    const mm = spellToAction(getSpell('magic_missile') as SpellDef, caster(1));
    expect(mm.uses).toEqual({ resource: 'spell:magic_missile', amount: 1 });
    expect(spellToAction(getSpell('fire_bolt') as SpellDef, caster(1)).uses).toBeUndefined();
    expect(mm.name).toBe('Magic Missile');
    expect(mm.id).toBe('spell_magic_missile');
  });

  it('turns concentration spells into concentration effects and Thunderwave into an emanation', () => {
    expect(spellToAction(getSpell('bless') as SpellDef, caster(1)).effects).toContain('concentration:10');
    expect(spellToAction(getSpell('thunderwave') as SpellDef, caster(1)).targeting).toEqual({ kind: 'point', range: 0, area: { shape: 'sphere', size: 3 } });
  });
});

describe('Magic Initiate in creation', () => {
  it('gives each background its origin feat', () => {
    const feats = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b.feat?.name]));
    expect(feats).toEqual({
      soldier: 'Savage Attacker',
      criminal: 'Alert',
      sage: 'Magic Initiate (Wizard)',
      acolyte: 'Magic Initiate (Cleric)',
    });
    for (const b of getCreationOptions().backgrounds) expect(b.feat?.summaries.length).toBeGreaterThan(0);
  });

  it('offers only implemented spells from the right list, and Cleric cantrips are effectively fixed', () => {
    for (const bg of ['sage', 'acolyte'] as const) {
      const feat = BACKGROUNDS.find((b) => b.id === bg)?.feat;
      const list = bg === 'sage' ? 'wizard' : 'cleric';
      for (const slot of feat?.choices ?? []) {
        if (slot.key === 'mi_ability') continue;
        for (const o of slot.options) {
          const s = getSpell(o.id) as SpellDef;
          expect(IMPLEMENTED_SPELL_IDS.has(s.id)).toBe(true);
          expect(s.lists).toContain(list);
          expect(HIDDEN_FROM_CREATION.has(s.id)).toBe(false);
          expect(s.level).toBe(slot.key === 'mi_spell' ? 1 : 0);
        }
      }
    }
    expect(offeredSpells('cleric', 0).map((s) => s.id).sort()).toEqual(['resistance', 'sacred_flame']);
    const cantrips = BACKGROUNDS.find((b) => b.id === 'acolyte')?.feat?.choices.filter((s) => s.group === 'mi_cantrip');
    expect(cantrips).toHaveLength(2);
    expect(offeredSpells('wizard', 1).map((s) => s.id)).not.toContain('mage_armor');
  });

  it('implements every Cleric and Wizard cantrip and level 1 spell in the data and leaves the Druid-only ones out', () => {
    // Spells of level 2 and above are data for companions and later classes; the engine does not cast them yet.
    for (const s of SPELLS.filter((sp) => sp.level <= 1)) {
      const druidOnly = s.lists.length === 1 && s.lists[0] === 'druid';
      expect(IMPLEMENTED_SPELL_IDS.has(s.id), s.id).toBe(!druidOnly);
    }
  });

  it('validates the feat choices', () => {
    expect(validateBuild(sageBuild())).toEqual([]);
    expect(validateBuild(sageBuild({}, 'acolyte'))).toEqual([]);
    const bad = (over: Partial<CharacterBuild['choices']>): string[] => validateBuild(sageBuild(over));
    expect(bad({ mi_cantrip1: 'fire_bolt', mi_cantrip2: 'fire_bolt' }).join()).toMatch(/different/);
    expect(bad({ mi_spell: 'bless' }).join()).toMatch(/Invalid Level 1 spell/);
    expect(bad({ mi_cantrip1: 'sacred_flame' }).join()).toMatch(/Invalid Cantrip 1/);
    expect(bad({ mi_ability: 'str' }).join()).toMatch(/Invalid Spellcasting ability/);
    const missing = sageBuild();
    delete missing.choices['mi_spell'];
    expect(validateBuild(missing).join()).toMatch(/Missing choice: Level 1 spell/);
    // A soldier needs no spell choices and may not carry them.
    expect(validateBuild(makeBuild())).toEqual([]);
    expect(validateBuild(makeBuild({ choices: { fightingStyle: 'defense', startingKit: 'a', mi_spell: 'bless' } })).join()).toMatch(/Unknown choice/);
  });

  it('creates a caster with its spell pool and actions', () => {
    const pc = createCharacter(sageBuild());
    expect(pc.resources['spell:magic_missile']).toEqual({ name: 'Magic Missile', current: 1, max: 1, refresh: 'longRest' });
    const c = toCreature(pc, { x: 0, y: 0 });
    expect(c.actions.map((a) => a.name)).toEqual(expect.arrayContaining(['Fire Bolt', 'Ray of Frost', 'Magic Missile']));
    // INT 15 (+2), proficiency +2.
    expect(c.actions.find((a) => a.id === 'spell_fire_bolt')?.attack?.bonus).toBe(4);
    expect(c.actions.find((a) => a.id === 'spell_magic_missile')?.icon).toBe('spell');
  });
});

describe('presets', () => {
  it('has three coherent Fighter presets, the first matching recommendedAbilities', () => {
    expect(FIGHTER.presets.map((p) => p.name)).toEqual(['Defender', 'Great Weapon', 'Archer']);
    expect(FIGHTER.recommendedAbilities).toEqual(FIGHTER.presets[0]?.abilities);
    expect(FIGHTER.presets.map((p) => p.choices['startingKit'])).toEqual(['a', 'b', 'c']);
    expect(FIGHTER.presets.map((p) => p.choices['fightingStyle'])).toEqual(['defense', 'greatWeaponFighting', 'archery']);
    for (const p of FIGHTER.presets) {
      expect(Object.values(p.abilities).sort((a, b) => b - a)).toEqual([15, 14, 13, 12, 10, 8]);
      for (const slot of FIGHTER.choices) expect(slot.options.map((o) => o.id)).toContain(p.choices[slot.key]);
    }
  });

  it('passes validateBuild with every background, increases assigned by priority', () => {
    for (const p of FIGHTER.presets) {
      for (const bg of BACKGROUNDS) {
        const build = buildFromPreset(p, bg.id);
        expect(validateBuild(build), `${p.id} + ${bg.id}`).toEqual([]);
        expect(() => createCharacter(build)).not.toThrow();
      }
    }
    const soldier = BACKGROUNDS.find((b) => b.id === 'soldier') as (typeof BACKGROUNDS)[number];
    expect(assignIncreases(soldier, ['dex', 'con', 'str'])).toEqual({ dex: 2, con: 1 });
    expect(assignIncreases(soldier, ['str', 'con', 'dex'])).toEqual({ str: 2, con: 1 });
  });
});

describe('long rest refresh', () => {
  it('spends the once-per-long-rest use, refreshes on a long rest and not on a short rest', () => {
    const pc = createCharacter(sageBuild());
    const c = toCreature(pc, { x: 0, y: 0 });
    (c.resources['spell:magic_missile'] as { current: number }).current = 0;
    const spent = syncFromCreature(pc, c);
    expect(spent.resources['spell:magic_missile']?.current).toBe(0);
    const short = takeShortRest({ ...spent, hp: 1 }, new Rng(1)).pc;
    expect(short.resources['spell:magic_missile']?.current).toBe(0);
    expect(longRest(spent).resources['spell:magic_missile']?.current).toBe(1);
  });
});

describe('casting between fights', () => {
  const rng = (): Rng => new Rng(5);
  it('Cure Wounds heals with the casting modifier and spends the use until a long rest', () => {
    const wiz = { ...createCharacter(sageBuild({ mi_spell: 'magic_missile' })), hp: 1 };
    expect(castOutOfCombat(wiz, 'magic_missile', rng())).toHaveProperty('error');
    const cleric = { ...createCharacter(sageBuild({ mi_spell: 'cure_wounds' }, 'acolyte')), hp: 1 };
    const r = castOutOfCombat(cleric, 'cure_wounds', rng());
    if ('error' in r) throw new Error(r.error);
    expect(r.healed).toBeGreaterThanOrEqual(2 + 2 + 1);
    expect(r.pc.hp).toBe(1 + (r.healed as number));
    expect(r.pc.resources['spell:cure_wounds']?.current).toBe(0);
    expect(castOutOfCombat({ ...r.pc, hp: 1 }, 'cure_wounds', rng())).toEqual({ error: 'Already cast — recovers on a long rest' });
    // A long rest refreshes the use; the hero must be hurt again to benefit.
    expect(castOutOfCombat({ ...longRest({ ...r.pc, hp: 1 }), hp: 1 }, 'cure_wounds', rng())).not.toHaveProperty('error');
    expect(castOutOfCombat({ ...cleric, hp: cleric.maxHp }, 'cure_wounds', rng())).toEqual({ error: 'Already at full health' });
  });

  it('False Life temporary hit points carry into the next fight until a long rest', () => {
    const pc = createCharacter(sageBuild({ mi_spell: 'false_life' }));
    const r = castOutOfCombat(pc, 'false_life', rng());
    if ('error' in r) throw new Error(r.error);
    expect(tempHpOf(r.pc)).toBeGreaterThanOrEqual(6);
    const c = toCreature(r.pc, { x: 0, y: 0 });
    expect(c.tempHp).toBe(tempHpOf(r.pc));
    // Damage taken in the fight is carried back; a long rest clears them.
    c.tempHp = 2;
    const after = syncFromCreature(r.pc, c);
    expect(tempHpOf(after)).toBe(2);
    expect(tempHpOf(longRest(after))).toBe(0);
  });

  it('Mage Armor needs no armor, then sets base AC to 13 + Dex until a long rest', () => {
    // Mage Armor is not offered at creation (every kit wears armor), so the choice is written in after the fact.
    expect(validateBuild(sageBuild({ mi_spell: 'mage_armor' })).join()).toMatch(/Invalid Level 1 spell/);
    const base0 = createCharacter(sageBuild());
    const base = { ...base0, build: { ...base0.build, choices: { ...base0.build.choices, mi_spell: 'mage_armor' } }, resources: { ...base0.resources, 'spell:mage_armor': { name: 'Mage Armor', current: 1, max: 1, refresh: 'longRest' as const } } };
    expect(castOutOfCombat(base, 'mage_armor', rng())).toEqual({ error: 'Mage Armor needs you to wear no armor' });
    const naked = { ...base, equipped: { ...base.equipped } };
    delete naked.equipped.armor;
    delete naked.equipped.offHand;
    expect(computeAc(naked)).toBe(11);
    const r = castOutOfCombat(naked, 'mage_armor', rng());
    if ('error' in r) throw new Error(r.error);
    expect(computeAc(r.pc)).toBe(14);
    expect(computeAc(longRest(r.pc))).toBe(11);
    // In combat it is only offered to an unarmored hero.
    expect(toCreature(base, { x: 0, y: 0 }).actions.some((a) => a.id === 'spell_mage_armor')).toBe(false);
    expect(toCreature(naked, { x: 0, y: 0 }).actions.some((a) => a.id === 'spell_mage_armor')).toBe(true);
  });

  it('refuses unknown and combat-only spells', () => {
    const pc = createCharacter(sageBuild());
    expect(castOutOfCombat(pc, 'bless', rng())).toHaveProperty('error');
    expect(castOutOfCombat(pc, 'fire_bolt', rng())).toEqual({ error: 'That spell is for combat' });
  });
});

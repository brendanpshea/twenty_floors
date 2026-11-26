import { describe, it, expect } from 'vitest';
import { MONSTERS } from './monsters';
import { ITEMS } from './items';
import type { MonsterDef, ThemeId, TraitId } from '../core/types';

const TRAIT_IDS: TraitId[] = [
  'packTactics',
  'undeadFortitude',
  'sunlightSensitivity',
  'nimbleEscape',
  'aggressive',
  'spiderClimb',
  'amorphous',
  'keenSenses',
];

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library'];

const MONSTER_IDS = [
  'giant_rat',
  'goblin_minion',
  'goblin_warrior',
  'wolf',
  'goblin_boss',
  'skeleton',
  'zombie',
  'shadow',
  'ghoul',
  'giant_spider',
  'bugbear_warrior',
  'ogre',
  'giant_frog',
  'gray_ooze',
  'giant_toad',
  'ochre_jelly',
  'wererat',
  'giant_constrictor_snake',
  'gelatinous_cube',
  'green_hag',
  'violet_fungus',
  'grick',
  'gibbering_mouther',
  'chuul',
  'ettercap',
  'darkmantle',
  'shambling_mound',
  'scout',
  'bandit_captain',
  'berserker',
  'warrior_veteran',
  'tough_boss',
  'priest',
  'hobgoblin_captain',
  'gladiator',
  'pirate',
  'death_dog',
  'ghast',
  'gargoyle',
  'rug_of_smothering',
  'wight',
  'doppelganger',
  'mage',
  'mummy',
  'ghost',
  'shield_guardian',
];

const ORIGINAL_ITEM_IDS = [
  'longsword',
  'greatsword',
  'shortsword',
  'handaxe',
  'dagger',
  'mace',
  'javelin',
  'longbow',
  'shortbow',
  'light_crossbow',
  'leather',
  'studded_leather',
  'chain_shirt',
  'scale_mail',
  'chain_mail',
  'shield',
  'potion_healing',
  'potion_greater_healing',
];

/** SRD 5.2.1 Weapons table, all 38 entries. */
const MUNDANE_WEAPON_IDS = [
  // Simple melee
  'club',
  'dagger',
  'greatclub',
  'handaxe',
  'javelin',
  'light_hammer',
  'mace',
  'quarterstaff',
  'sickle',
  'spear',
  // Simple ranged
  'dart',
  'light_crossbow',
  'shortbow',
  'sling',
  // Martial melee
  'battleaxe',
  'flail',
  'glaive',
  'greataxe',
  'greatsword',
  'halberd',
  'lance',
  'longsword',
  'maul',
  'morningstar',
  'pike',
  'rapier',
  'scimitar',
  'shortsword',
  'trident',
  'warhammer',
  'war_pick',
  'whip',
  // Martial ranged
  'blowgun',
  'hand_crossbow',
  'heavy_crossbow',
  'longbow',
  'musket',
  'pistol',
];

/** SRD 5.2.1 Armor table, armor entries (the shield is listed separately). */
const MUNDANE_ARMOR_IDS = [
  'padded',
  'leather',
  'studded_leather',
  'hide',
  'chain_shirt',
  'scale_mail',
  'breastplate',
  'half_plate',
  'ring_mail',
  'chain_mail',
  'splint',
  'plate',
];

const MUNDANE_SHIELD_IDS = ['shield'];

const WEAPON_MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'];

const WEAPON_PROPERTIES = [
  'finesse',
  'light',
  'heavy',
  'twoHanded',
  'versatile',
  'reach',
  'thrown',
  'ammunition',
  'loading',
];

/** Expected rarity of a magic variant, from the SRD magic item entries. */
const VARIANT_RARITY = {
  weapon: { 1: 'uncommon', 2: 'rare', 3: 'veryRare' },
  armor: { 1: 'rare', 2: 'veryRare', 3: 'legendary' },
  shield: { 1: 'uncommon', 2: 'rare', 3: 'veryRare' },
} as const;

const XP_BY_CR: Record<number, number> = { 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900 };

const DICE_RE = /^\d+(d\d+)?([+-]\d+)?$/;

/** Average of an "NdM+K" expression. */
function averageOf(dice: string): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  if (!m) {
    return Number(dice);
  }
  const n = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  return (n * (sides + 1)) / 2 + mod;
}

describe('monster data', () => {
  it('has exactly the expected ids, each unique', () => {
    const ids = MONSTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...MONSTER_IDS].sort());
  });

  it('uses only valid Dice strings', () => {
    for (const m of MONSTERS) {
      expect(m.hpDice, `${m.id} hpDice`).toMatch(DICE_RE);
      for (const a of m.actions) {
        for (const d of a.damage ?? []) {
          expect(d.dice, `${m.id}.${a.id} damage`).toMatch(DICE_RE);
        }
      }
    }
  });

  it('has unique action ids within each monster', () => {
    for (const m of MONSTERS) {
      const ids = m.actions.map((a) => a.id);
      expect(new Set(ids).size, `${m.id} action ids`).toBe(ids.length);
    }
  });

  it('multiattack entries refer to existing attack or save actions', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        for (const ref of a.multiattack ?? []) {
          const target = m.actions.find((x) => x.id === ref);
          expect(target, `${m.id}.${a.id} -> ${ref}`).toBeDefined();
          expect(target!.attack !== undefined || target!.save !== undefined, `${m.id}.${ref}`).toBe(true);
        }
      }
    }
  });

  it('every action with attack or save has damage or applies', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.attack || a.save) {
          expect(a.damage !== undefined || a.applies !== undefined, `${m.id}.${a.id}`).toBe(true);
        }
      }
    }
  });

  it('uses only known trait ids', () => {
    for (const m of MONSTERS) {
      for (const t of m.traits) {
        expect(TRAIT_IDS, `${m.id} trait ${t}`).toContain(t);
      }
    }
  });

  it('gives each theme its boss(es) and at least two non-boss monsters', () => {
    for (const theme of THEMES) {
      const inTheme = MONSTERS.filter((m) => m.themes.includes(theme));
      const bosses = inTheme.filter((m) => m.role === 'boss');
      const others = inTheme.filter((m) => m.role !== 'boss');
      // The sewers (floors 4 and 5), the fungal caverns (floors 6 and 7), the bandit hold (floors 8 and 9)
      // and the Sunken Library (floors 10 and 11) span two floors, each with its own boss; every other theme
      // has one.
      expect(bosses.length, `${theme} bosses`).toBe(theme === 'sewers' || theme === 'fungal' || theme === 'hold' || theme === 'library' ? 2 : 1);
      expect(others.length, `${theme} non-bosses`).toBeGreaterThanOrEqual(2);
    }
  });

  it('matches the CR to XP table and the SRD proficiency bonus', () => {
    for (const m of MONSTERS) {
      expect(m.xp, `${m.id} xp`).toBe(XP_BY_CR[m.cr]);
      // SRD proficiency bonus: +2 up to CR 4, +3 for CR 5 to 8.
      expect(m.proficiencyBonus, `${m.id} proficiencyBonus`).toBe(m.cr >= 5 ? 3 : 2);
    }
  });

  it('has hp within 1 of the average of hpDice', () => {
    for (const m of MONSTERS as MonsterDef[]) {
      expect(Math.abs(m.hp - averageOf(m.hpDice)), `${m.id} hp`).toBeLessThanOrEqual(1);
    }
  });

  it('gives ranged and thrown attacks a long range greater than the normal range', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.attack && a.targeting.kind === 'creature' && !a.targeting.melee) {
          expect(a.targeting.longRange, `${m.id}.${a.id} longRange`).toBeDefined();
          expect(a.targeting.longRange!, `${m.id}.${a.id}`).toBeGreaterThan(a.targeting.range);
        }
      }
    }
  });
});

describe('item data', () => {
  const mundaneEquipment = ITEMS.filter((i) => i.magicBonus === undefined && i.kind !== 'consumable');
  const variants = ITEMS.filter((i) => i.magicBonus !== undefined);
  const byId = new Map(ITEMS.map((i) => [i.id, i] as const));

  it('keeps the 18 original ids, each unique across all items', () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ORIGINAL_ITEM_IDS) {
      expect(ids, `${id} present`).toContain(id);
    }
  });

  it('has exactly the expected mundane weapon, armor and shield ids', () => {
    const weaponIds = mundaneEquipment.filter((i) => i.kind === 'weapon').map((i) => i.id);
    const armorIds = mundaneEquipment.filter((i) => i.kind === 'armor').map((i) => i.id);
    const shieldIds = mundaneEquipment.filter((i) => i.kind === 'shield').map((i) => i.id);
    expect([...weaponIds].sort()).toEqual([...MUNDANE_WEAPON_IDS].sort());
    expect([...armorIds].sort()).toEqual([...MUNDANE_ARMOR_IDS].sort());
    expect([...shieldIds].sort()).toEqual([...MUNDANE_SHIELD_IDS].sort());
  });

  it('gives every mundane weapon a mastery and valid properties', () => {
    for (const i of mundaneEquipment.filter((x) => x.kind === 'weapon')) {
      expect(WEAPON_MASTERIES, `${i.id} mastery`).toContain(i.weapon!.mastery);
      for (const p of i.weapon!.properties) {
        expect(WEAPON_PROPERTIES, `${i.id} property ${p}`).toContain(p);
      }
    }
  });

  it('keeps versatile and versatileDice in step', () => {
    for (const i of ITEMS.filter((x) => x.weapon)) {
      const hasVersatile = i.weapon!.properties.includes('versatile');
      expect(hasVersatile, `${i.id} versatile`).toBe(i.weapon!.versatileDice !== undefined);
    }
  });

  it('never combines twoHanded with light', () => {
    for (const i of ITEMS.filter((x) => x.weapon)) {
      const p = i.weapon!.properties;
      expect(p.includes('twoHanded') && p.includes('light'), `${i.id}`).toBe(false);
    }
  });

  it('sets dexCap by armor category: none for light, 2 for medium, 0 for heavy', () => {
    for (const i of ITEMS.filter((x) => x.armor)) {
      const cap = i.armor!.dexCap;
      if (i.armor!.category === 'light') expect(cap, `${i.id}`).toBeUndefined();
      if (i.armor!.category === 'medium') expect(cap, `${i.id}`).toBe(2);
      if (i.armor!.category === 'heavy') expect(cap, `${i.id}`).toBe(0);
    }
  });

  it('gives each magic variant a valid base, bonus, rarity and higher cost', () => {
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      const base = byId.get(v.baseId!);
      expect(base, `${v.id} baseId`).toBeDefined();
      expect(base!.magicBonus, `${v.id} base is mundane`).toBeUndefined();
      expect([1, 2, 3], `${v.id} magicBonus`).toContain(v.magicBonus);
      const family = base!.kind === 'weapon' ? 'weapon' : base!.kind === 'armor' ? 'armor' : 'shield';
      expect(v.rarity, `${v.id} rarity`).toBe(VARIANT_RARITY[family][v.magicBonus as 1 | 2 | 3]);
      expect(v.cost, `${v.id} cost`).toBeGreaterThan(base!.cost);
    }
  });

  it('gives each magic variant the same combat stats as its base', () => {
    for (const v of variants) {
      const base = byId.get(v.baseId!)!;
      expect(v.kind, `${v.id} kind`).toBe(base.kind);
      expect(v.weapon, `${v.id} weapon`).toEqual(base.weapon);
      expect(v.armor, `${v.id} armor`).toEqual(base.armor);
      expect(v.shieldBonus, `${v.id} shieldBonus`).toBe(base.shieldBonus);
    }
  });

  it('shares no nested objects between a variant and its base', () => {
    for (const v of variants) {
      const base = byId.get(v.baseId!)!;
      if (v.weapon) {
        expect(v.weapon, `${v.id} weapon`).not.toBe(base.weapon);
        expect(v.weapon.damage, `${v.id} damage`).not.toBe(base.weapon!.damage);
        expect(v.weapon.properties, `${v.id} properties`).not.toBe(base.weapon!.properties);
        if (v.weapon.range) expect(v.weapon.range, `${v.id} range`).not.toBe(base.weapon!.range);
      }
      if (v.armor) {
        expect(v.armor, `${v.id} armor`).not.toBe(base.armor);
      }
    }
  });

  it('has exactly three variants for each weapon, armor and shield, and none for consumables', () => {
    const baseIds = mundaneEquipment.filter((i) => i.kind !== 'consumable').map((i) => i.id);
    for (const id of baseIds) {
      const made = variants.filter((v) => v.baseId === id).map((v) => v.magicBonus).sort();
      expect(made, `${id} variants`).toEqual([1, 2, 3]);
    }
    for (const v of variants) {
      expect(byId.get(v.baseId!)!.kind, `${v.id}`).not.toBe('consumable');
    }
    expect(variants.length).toBe(baseIds.length * 3);
  });

  it('keeps magic variant ids in the expected form', () => {
    for (const v of variants) {
      expect(v.id, `${v.id}`).toBe(`${v.baseId}_plus${v.magicBonus}`);
      expect(v.name, `${v.id} name`).toBe(`${byId.get(v.baseId!)!.name} +${v.magicBonus}`);
    }
  });

  it('keeps mundane items common and unenchanted', () => {
    for (const i of mundaneEquipment.filter((x) => x.kind !== 'consumable')) {
      expect(i.rarity, `${i.id} rarity`).toBe('common');
    }
  });

  it('uses only valid Dice strings', () => {
    for (const i of ITEMS) {
      if (i.weapon) {
        expect(i.weapon.damage.dice, `${i.id} damage`).toMatch(DICE_RE);
        if (i.weapon.versatileDice) {
          expect(i.weapon.versatileDice, `${i.id} versatile`).toMatch(DICE_RE);
        }
      }
      if (i.consumable) {
        expect(i.consumable.dice, `${i.id} consumable`).toMatch(DICE_RE);
      }
    }
  });

  it('gives each kind its matching data block', () => {
    for (const i of ITEMS) {
      if (i.kind === 'weapon') {
        expect(i.weapon, `${i.id} weapon`).toBeDefined();
      }
      if (i.kind === 'armor') {
        expect(i.armor, `${i.id} armor`).toBeDefined();
      }
      if (i.kind === 'shield') {
        expect(i.shieldBonus, `${i.id} shieldBonus`).toBeDefined();
      }
      if (i.kind === 'consumable') {
        expect(i.consumable, `${i.id} consumable`).toBeDefined();
      }
    }
  });

  it('gives thrown and ranged weapons a range with long greater than normal', () => {
    for (const i of ITEMS) {
      const w = i.weapon;
      if (!w) continue;
      const isThrown = w.properties.includes('thrown');
      if (isThrown || !w.melee) {
        expect(w.range, `${i.id} range`).toBeDefined();
        expect(w.range!.long, `${i.id} range`).toBeGreaterThan(w.range!.normal);
      }
    }
  });
});

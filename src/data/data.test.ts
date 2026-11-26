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

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths'];

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
];

const ITEM_IDS = [
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

const XP_BY_CR: Record<number, number> = { 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450 };

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
  it('has exactly the 12 expected ids, each unique', () => {
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

  it('gives each theme exactly one boss and at least two non-boss monsters', () => {
    for (const theme of THEMES) {
      const inTheme = MONSTERS.filter((m) => m.themes.includes(theme));
      const bosses = inTheme.filter((m) => m.role === 'boss');
      const others = inTheme.filter((m) => m.role !== 'boss');
      expect(bosses.length, `${theme} bosses`).toBe(1);
      expect(others.length, `${theme} non-bosses`).toBeGreaterThanOrEqual(2);
    }
  });

  it('matches the CR to XP table and proficiency bonus 2', () => {
    for (const m of MONSTERS) {
      expect(m.xp, `${m.id} xp`).toBe(XP_BY_CR[m.cr]);
      expect(m.proficiencyBonus, `${m.id} proficiencyBonus`).toBe(2);
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
  it('has exactly the 18 expected ids, each unique', () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ITEM_IDS].sort());
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

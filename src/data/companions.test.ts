import { describe, it, expect } from 'vitest';
import { COMPANIONS } from './companions';
import type { CompanionRole, MonsterDef } from '../core/types';

const COMPANION_IDS = ['sphinx_of_wonder', 'pseudodragon', 'blink_dog'];

const ROLES: Record<string, CompanionRole> = {
  sphinx_of_wonder: 'healer',
  pseudodragon: 'blaster',
  blink_dog: 'skirmisher',
};

const DICE_RE = /^\d+(d\d+)?([+-]\d+)?$/;

/** Same CR to XP table the monster data test uses. */
const XP_BY_CR: Record<number, number> = {
  0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
  8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000,
};

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

describe('companion data', () => {
  it('has exactly the three companions, in order', () => {
    expect(COMPANIONS.map((c) => c.id)).toEqual(COMPANION_IDS);
  });

  it('gives each companion its role', () => {
    for (const c of COMPANIONS) {
      expect(c.role, `${c.id} role`).toBe(ROLES[c.id]);
    }
  });

  it('has a non-empty name and description for each companion', () => {
    for (const c of COMPANIONS) {
      expect(c.name.length, `${c.id} name`).toBeGreaterThan(0);
      expect(c.description.length, `${c.id} description`).toBeGreaterThan(0);
    }
  });

  it('gives each base stat block the companion id, no themes and the standard role', () => {
    for (const c of COMPANIONS) {
      expect(c.base.id, `${c.id} base id`).toBe(c.id);
      expect(c.base.themes, `${c.id} themes`).toEqual([]);
      expect(c.base.role, `${c.id} role`).toBe('standard');
    }
  });

  it('uses only valid Dice strings in the base stat block', () => {
    for (const c of COMPANIONS) {
      expect(c.base.hpDice, `${c.id} hpDice`).toMatch(DICE_RE);
      for (const a of c.base.actions) {
        for (const d of a.damage ?? []) {
          expect(d.dice, `${c.id}.${a.id} damage`).toMatch(DICE_RE);
        }
      }
    }
  });

  it('has unique action ids within each base stat block', () => {
    for (const c of COMPANIONS) {
      const ids = c.base.actions.map((a) => a.id);
      expect(new Set(ids).size, `${c.id} action ids`).toBe(ids.length);
    }
  });

  it('multiattack entries refer to existing attack or save actions', () => {
    for (const c of COMPANIONS) {
      for (const a of c.base.actions) {
        for (const ref of a.multiattack ?? []) {
          const target = c.base.actions.find((x) => x.id === ref);
          expect(target, `${c.id}.${a.id} -> ${ref}`).toBeDefined();
          expect(target!.attack !== undefined || target!.save !== undefined, `${c.id}.${ref}`).toBe(true);
        }
      }
    }
  });

  it('gives every attack or save action damage or applies', () => {
    for (const c of COMPANIONS) {
      for (const a of c.base.actions) {
        if (a.attack || a.save) {
          expect(a.damage !== undefined || a.applies !== undefined, `${c.id}.${a.id}`).toBe(true);
        }
      }
    }
  });

  it('has hp within 1 of the average of hpDice', () => {
    for (const c of COMPANIONS as { base: MonsterDef }[]) {
      expect(Math.abs(c.base.hp - averageOf(c.base.hpDice)), `${c.base.id} hp`).toBeLessThanOrEqual(1);
    }
  });

  it('matches the CR to XP table', () => {
    for (const c of COMPANIONS) {
      expect(c.base.xp, `${c.id} xp`).toBe(XP_BY_CR[c.base.cr]);
    }
  });

  it('has a kit in level order from level 1 to 18, with a summary for each step and no spell twice', () => {
    for (const c of COMPANIONS) {
      expect(c.kit.length, `${c.id} kit`).toBeGreaterThanOrEqual(10);
      const levels = c.kit.map((f) => f.level);
      expect([...levels].sort((a, b) => a - b), `${c.id} order`).toEqual(levels);
      expect(levels[0], `${c.id} first`).toBe(1);
      expect(levels[levels.length - 1], `${c.id} last`).toBe(18);
      for (const f of c.kit) expect(f.summary.length, `${c.id}.${f.name}`).toBeGreaterThan(10);
      const spells = c.kit.map((f) => f.spellId).filter((s): s is string => s !== undefined);
      expect(new Set(spells).size, `${c.id} spells`).toBe(spells.length);
    }
  });

  it('starts visual tiers at level 1, in ascending order, matching the base visual', () => {
    for (const c of COMPANIONS) {
      const levels = c.visualTiers.map((t) => t.fromLevel);
      expect(levels[0], `${c.id} first tier`).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i], `${c.id} tier order`).toBeGreaterThan(levels[i - 1]!);
      }
      expect(c.base.visual, `${c.id} base visual`).toEqual(c.visualTiers[0]!.visual);
    }
  });
});

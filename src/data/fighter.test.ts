import { describe, expect, it } from 'vitest';
import { FIGHTER_LEVELS, fighterFlagsUpTo, fighterImprovementsUpTo, fighterLevel } from './fighter';

describe('Fighter progression data', () => {
  it('has one row per level from 1 to 20, matching the SRD table', () => {
    expect(FIGHTER_LEVELS.map((r) => r.level)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(FIGHTER_LEVELS.map((r) => r.proficiencyBonus)).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]);
    expect(FIGHTER_LEVELS.map((r) => r.secondWindUses)).toEqual([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(FIGHTER_LEVELS.map((r) => r.weaponMasteries)).toEqual([3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6]);
    expect(FIGHTER_LEVELS.map((r) => r.attacks)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4]);
    expect(FIGHTER_LEVELS.filter((r) => r.abilityScoreImprovement).map((r) => r.level)).toEqual([4, 6, 8, 12, 14, 16]);
  });

  it('never loses anything on a level-up, and every level grants a feature', () => {
    for (let l = 2; l <= 20; l++) {
      const a = fighterLevel(l - 1);
      const b = fighterLevel(l);
      for (const k of ['proficiencyBonus', 'attacks', 'secondWindUses', 'weaponMasteries', 'actionSurgeUses', 'indomitableUses'] as const) {
        expect(b[k], `${k} at level ${l}`).toBeGreaterThanOrEqual(a[k]);
      }
      expect(b.critFrom).toBeLessThanOrEqual(a.critFrom);
    }
    for (const r of FIGHTER_LEVELS) expect(r.features.length, `level ${r.level}`).toBeGreaterThan(0);
  });

  it('agrees with the Fighter the rules engine already has for levels 1 to 3', () => {
    expect(fighterLevel(1)).toMatchObject({ attacks: 1, secondWindUses: 2, actionSurgeUses: 0, critFrom: 20 });
    expect(fighterLevel(2).actionSurgeUses).toBe(1);
    expect(fighterFlagsUpTo(3)).toEqual(expect.arrayContaining(['crit19', 'initAdv']));
    expect(fighterImprovementsUpTo(20)).toBe(6);
    expect(fighterLevel(99).level).toBe(20);
  });
});

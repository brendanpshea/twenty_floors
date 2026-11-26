import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { averageDice, critDice, maxDice, minDice, parseDice, rollDice, withModifier } from './dice';

describe('dice', () => {
  it('parses notation', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, mod: 3 });
    expect(parseDice('1d4-1')).toEqual({ count: 1, sides: 4, mod: -1 });
    expect(parseDice('d8')).toEqual({ count: 1, sides: 8, mod: 0 });
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, mod: 5 });
    expect(() => parseDice('banana')).toThrow();
  });

  it('computes average, min and max', () => {
    expect(averageDice('2d6+3')).toBe(10);
    expect(maxDice('2d6+3')).toBe(15);
    expect(minDice('2d6+3')).toBe(5);
    expect(averageDice('5')).toBe(5);
    expect(minDice('1d4-3')).toBe(0);
  });

  it('doubles dice but not the modifier on a crit', () => {
    expect(critDice('2d6+3')).toBe('4d6+3');
    expect(maxDice('1d8+2', { crit: true })).toBe(18);
    expect(averageDice('1d8+2', { crit: true })).toBe(11);
    const r = rollDice(new Rng(3), '1d8+2', { crit: true });
    expect(r.rolls).toHaveLength(2);
  });

  it('rolls within bounds and uniformly enough', () => {
    const rng = new Rng(42);
    const counts = new Array(7).fill(0) as number[];
    for (let i = 0; i < 6000; i++) {
      const r = rollDice(rng, '1d6');
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(6);
      counts[r.total] = (counts[r.total] as number) + 1;
    }
    for (let f = 1; f <= 6; f++) expect(counts[f]).toBeGreaterThan(850);
  });

  it('never rolls below zero and handles flat values', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 100; i++) expect(rollDice(rng, '1d4-3').total).toBeGreaterThanOrEqual(0);
    expect(rollDice(rng, '7').total).toBe(7);
  });

  it('supports a minimum die (Great Weapon Fighting)', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) for (const d of rollDice(rng, '2d6', { minDie: 3 }).rolls) expect(d).toBeGreaterThanOrEqual(3);
    expect(averageDice('2d6', { minDie: 3 })).toBeCloseTo(2 * (3 + 3 + 3 + 4 + 5 + 6) / 6);
  });

  it('adjusts modifiers', () => {
    expect(withModifier('1d8', 3)).toBe('1d8+3');
    expect(withModifier('1d8+3', -3)).toBe('1d8');
    expect(withModifier('1d8', -2)).toBe('1d8-2');
  });

  it('is deterministic for a seed', () => {
    const a = rollDice(new Rng(9), '4d6+1');
    const b = rollDice(new Rng(9), '4d6+1');
    expect(a).toEqual(b);
  });
});

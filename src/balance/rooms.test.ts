import { describe, expect, it } from 'vitest';
import { measureRooms, predictClear } from './rooms';

describe('room-level measurement', () => {
  it('characterises a pairing from a few floors and predicts a clear rate', () => {
    const r = measureRooms('warrens', 1, { floors: 2, seed0: 900 });
    expect(r.combat.n + r.boss.n).toBeGreaterThan(2);
    expect(r.boss.n).toBeGreaterThan(0);
    for (const o of r.outcomes) {
      expect(o.heroLoss).toBeGreaterThanOrEqual(0);
      expect(o.heroLoss).toBeLessThanOrEqual(1);
    }
    const p = predictClear(r, 200);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  }, 60_000);
});

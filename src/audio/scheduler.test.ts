import { describe, expect, it } from 'vitest';
import { mulberry32 } from './helpers';
import { EventScheduler } from './scheduler';

describe('EventScheduler', () => {
  it('fires in-window events with gaps inside bounds, once each', () => {
    const times: number[] = [];
    const s = new EventScheduler([{ minGap: 2, maxGap: 5, firstDelay: [1, 2], fire: (t) => times.push(t) }], mulberry32(3), 10);
    s.advance(20);
    s.advance(20);
    s.advance(60);
    expect(times.length).toBeGreaterThan(5);
    expect(times[0]).toBeGreaterThanOrEqual(11);
    expect(times[0]).toBeLessThan(12);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i]! - times[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThan(5);
    }
    expect(times.every((t) => t < 60)).toBe(true);
  });

  it('does not fire events past the lookahead', () => {
    const times: number[] = [];
    const s = new EventScheduler([{ minGap: 10, maxGap: 10, firstDelay: [5, 5], fire: (t) => times.push(t) }], mulberry32(1), 0);
    s.advance(4.9);
    expect(times).toEqual([]);
    s.advance(5.1);
    expect(times).toEqual([5]);
  });

  it('skips disabled slots without firing and resumes on the grid', () => {
    let on = false;
    const times: number[] = [];
    const s = new EventScheduler([{ minGap: 1, maxGap: 1, firstDelay: [0, 0], enabled: () => on, fire: (t) => times.push(t) }], mulberry32(1), 0);
    s.advance(3.5);
    expect(times).toEqual([]);
    on = true;
    s.advance(6.5);
    expect(times).toEqual([4, 5, 6]);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const t: number[] = [];
      new EventScheduler([{ minGap: 1, maxGap: 4, fire: (x) => t.push(x) }], mulberry32(9)).advance(50);
      return t;
    };
    expect(run()).toEqual(run());
  });
});

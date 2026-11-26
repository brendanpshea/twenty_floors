import { describe, expect, it } from 'vitest';
import {
  between, canRetrigger, clamp, dbToGain, envelopeTimes, gainToDb, hz, loadPrefs, mulberry32, recipeDuration,
  savePref, vary, VoiceTracker, volumeToGain, DEFAULT_VOLUME,
} from './helpers';
import { RECIPES } from './recipes';

describe('variation and maths', () => {
  it('vary stays inside the requested range', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const v = vary(rng, 0.1);
      expect(v).toBeGreaterThanOrEqual(0.9);
      expect(v).toBeLessThanOrEqual(1.1);
    }
  });
  it('between is bounded and deterministic for a seed', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const x = between(a, 2, 3);
      expect(x).toBe(between(b, 2, 3));
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThan(3);
    }
  });
  it('converts pitch and decibels', () => {
    expect(hz(69)).toBeCloseTo(440);
    expect(hz(81)).toBeCloseTo(880);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3);
    expect(gainToDb(dbToGain(-12))).toBeCloseTo(-12);
    expect(clamp(5, 0, 1)).toBe(1);
  });
  it('volume curve is monotonic and bounded', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeLessThan(0.5);
    expect(volumeToGain(NaN)).toBe(0);
    expect(volumeToGain(7)).toBe(1);
  });
  it('envelope times are ordered', () => {
    const e = envelopeTimes(0.01, 0.1, 0.05, 0.2);
    expect(e.attackEnd).toBeLessThanOrEqual(e.decayEnd);
    expect(e.decayEnd).toBeLessThanOrEqual(e.releaseStart);
    expect(e.end).toBeGreaterThan(e.releaseStart);
  });
});

describe('retrigger and voice cap', () => {
  it('gates by minimum interval', () => {
    expect(canRetrigger(undefined, 0, 1)).toBe(true);
    expect(canRetrigger(1, 1.05, 0.1)).toBe(false);
    expect(canRetrigger(1, 1.1, 0.1)).toBe(true);
  });
  it('caps simultaneous voices and sheds low priority first', () => {
    const v = new VoiceTracker(12, 16);
    let ok = 0;
    for (let i = 0; i < 30; i++) if (v.tryAcquire(0, 1, 1)) ok++;
    expect(ok).toBe(12);
    expect(v.tryAcquire(0, 1, 0)).toBe(false);
    expect(v.tryAcquire(0, 1, 2)).toBe(true);
    expect(v.tryAcquire(2, 3, 1)).toBe(true);
  });
  it('drops priority 0 earlier than the cap', () => {
    const v = new VoiceTracker(12, 16);
    for (let i = 0; i < 9; i++) v.tryAcquire(0, 1, 1);
    expect(v.tryAcquire(0, 1, 0)).toBe(false);
    expect(v.tryAcquire(0, 1, 1)).toBe(true);
  });
});

describe('storage persistence', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
  };
  it('defaults when there is no storage', () => {
    expect(loadPrefs(undefined)).toEqual({ muted: false, volume: DEFAULT_VOLUME });
  });
  it('round-trips with the tf-audio- prefix', () => {
    const s = mem();
    savePref(s, 'muted', true);
    savePref(s, 'volume', 0.25);
    expect([...s.m.keys()].sort()).toEqual(['tf-audio-muted', 'tf-audio-volume']);
    expect(loadPrefs(s)).toEqual({ muted: true, volume: 0.25 });
  });
  it('ignores garbage and throwing storage', () => {
    const s = mem();
    s.m.set('tf-audio-volume', 'abc');
    expect(loadPrefs(s).volume).toBe(DEFAULT_VOLUME);
    s.m.set('tf-audio-volume', '9');
    expect(loadPrefs(s).volume).toBe(1);
    const bad = {
      get: (): string | null => {
        throw new Error('no');
      },
      set: (): void => {
        throw new Error('no');
      },
    };
    expect(() => loadPrefs(bad)).not.toThrow();
    expect(() => savePref(bad, 'muted', true)).not.toThrow();
  });
});

describe('recipe durations', () => {
  it('are finite and short', () => {
    for (const r of Object.values(RECIPES)) {
      const d = recipeDuration(r);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeLessThan(3);
    }
  });
});

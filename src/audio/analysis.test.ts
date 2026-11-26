import { describe, expect, it } from 'vitest';
import { analyse, fft, firstLastDiffDb } from './analysis';

const sine = (f: number, sr: number, secs: number, amp = 0.5) => {
  const x = new Float32Array(Math.floor(sr * secs));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
};

describe('analysis', () => {
  it('fft finds a bin', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 32 * i) / n);
    fft(re, im);
    expect(Math.hypot(re[32]!, im[32]!)).toBeGreaterThan(n / 2 - 1);
    expect(Math.hypot(re[100]!, im[100]!)).toBeLessThan(1e-6);
  });
  it('measures a sine: peak, rms, band, no clip', () => {
    const s = analyse([sine(1000, 44100, 0.5)], 44100);
    expect(s.peak).toBeCloseTo(0.5, 2);
    expect(s.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(s.band).toBe('lowmid 0.4-1.2k');
    expect(s.silent).toBe(false);
    expect(s.clips).toBe(false);
    expect(Math.abs(s.dc)).toBeLessThan(0.01);
  });
  it('flags silence, clipping and DC', () => {
    expect(analyse([new Float32Array(4410)], 44100).silent).toBe(true);
    const loud = sine(200, 44100, 0.2, 1.2).map((v) => Math.max(-1, Math.min(1, v)));
    expect(analyse([loud], 44100).clips).toBe(true);
    const dc = sine(200, 44100, 0.2, 0.1).map((v) => v + 0.2);
    expect(analyse([dc], 44100).dc).toBeGreaterThan(0.15);
  });
  it('first/last level difference', () => {
    const a = sine(100, 44100, 4, 0.1);
    const b = sine(100, 44100, 4, 0.2);
    const x = new Float32Array(a.length + b.length);
    x.set(a);
    x.set(b, a.length);
    expect(firstLastDiffDb(x, 44100, 1)).toBeCloseTo(6.02, 1);
  });
});

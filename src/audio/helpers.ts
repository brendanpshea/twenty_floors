/** Pure helpers: no Web Audio, safe in node. */
import type { Layer, Recipe } from './types';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Number or NaN guard: returns `fallback` for non-finite input. */
export function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** MIDI note number to Hz (69 = A4 = 440). */
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Multiplicative variation in [1-amount, 1+amount]. */
export function vary(rng: Rng, amount: number): number {
  return 1 + (rng() * 2 - 1) * amount;
}

/** Uniform in [lo, hi). */
export function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Seconds at which each envelope stage ends, relative to the layer start. */
export function envelopeTimes(a: number, d: number, dur: number, r: number) {
  const attackEnd = Math.max(a, 0.002);
  const decayEnd = attackEnd + Math.max(d, 0);
  const releaseStart = Math.max(dur, decayEnd);
  return { attackEnd, decayEnd, releaseStart, end: releaseStart + Math.max(r, 0.005) };
}

export function layerEnd(l: Layer): number {
  return l.at + envelopeTimes(l.a, l.d, l.dur, l.r).end;
}

/** Total length of a recipe including release tails. */
export function recipeDuration(r: Recipe): number {
  let end = 0;
  for (const l of r.layers) end = Math.max(end, layerEnd(l));
  return end;
}

/** Retrigger gate: true if enough time has passed since the last play. */
export function canRetrigger(last: number | undefined, now: number, minInterval: number): boolean {
  return last === undefined || now - last >= minInterval;
}

/**
 * Tracks live voices so bursts cannot pile up. A voice occupies [start, end).
 * Low priority voices are refused at `cap`; everything is refused at `hardCap`.
 */
export class VoiceTracker {
  private voices: { start: number; end: number }[] = [];
  constructor(
    private readonly cap = 12,
    private readonly hardCap = 16,
  ) {}

  active(at: number): number {
    this.voices = this.voices.filter((v) => v.end > at - 1);
    let n = 0;
    for (const v of this.voices) if (v.start <= at && v.end > at) n++;
    return n;
  }

  tryAcquire(start: number, end: number, prio: 0 | 1 | 2): boolean {
    const n = this.active(start);
    if (n >= this.hardCap) return false;
    if (n >= this.cap && prio < 2) return false;
    if (n >= this.cap - 3 && prio === 0) return false;
    this.voices.push({ start, end });
    return true;
  }
}

/** Equal-power-ish volume curve: slider 0..1 to linear gain. */
export const volumeToGain = (v: number): number => {
  const c = clamp(finiteOr(v, 0), 0, 1);
  return c * c;
};

export interface KeyValueStorage {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

export const STORAGE_PREFIX = 'tf-audio-';
export const DEFAULT_VOLUME = 0.7;

export interface AudioPrefs {
  muted: boolean;
  volume: number;
}

export function loadPrefs(storage: KeyValueStorage | undefined): AudioPrefs {
  const prefs: AudioPrefs = { muted: false, volume: DEFAULT_VOLUME };
  if (!storage) return prefs;
  try {
    const m = storage.get(STORAGE_PREFIX + 'muted');
    if (m === '1') prefs.muted = true;
    const v = storage.get(STORAGE_PREFIX + 'volume');
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n)) prefs.volume = clamp(n, 0, 1);
    }
  } catch {
    /* storage unavailable */
  }
  return prefs;
}

export function savePref(storage: KeyValueStorage | undefined, key: 'muted' | 'volume', value: boolean | number): void {
  if (!storage) return;
  try {
    storage.set(STORAGE_PREFIX + key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  } catch {
    /* ignore */
  }
}

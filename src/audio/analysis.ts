/** Pure signal analysis used by the offline self-test (and unit-tested on synthetic signals). */
import { gainToDb } from './helpers';

export const BANDS: readonly { name: string; lo: number; hi: number }[] = [
  { name: 'sub <120', lo: 0, hi: 120 },
  { name: 'low 120-400', lo: 120, hi: 400 },
  { name: 'lowmid 0.4-1.2k', lo: 400, hi: 1200 },
  { name: 'mid 1.2-3k', lo: 1200, hi: 3000 },
  { name: 'high 3-8k', lo: 3000, hi: 8000 },
  { name: 'air >8k', lo: 8000, hi: Infinity },
];

export interface Stats {
  /** Seconds until the signal last exceeds 1% (-40 dB) of its peak. */
  audible: number;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  silent: boolean;
  clips: boolean;
  dc: number;
  band: string;
  centroid: number;
}

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function rmsOf(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  const n = Math.max(0, to - from);
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return n ? Math.sqrt(s / n) : 0;
}

/** Level difference (dB) between the first and last `seconds` of a mono signal. */
export function firstLastDiffDb(x: Float32Array, sr: number, seconds = 1): number {
  const n = Math.floor(seconds * sr);
  const a = rmsOf(x, 0, n);
  const b = rmsOf(x, x.length - n, x.length);
  return gainToDb(b) - gainToDb(a);
}

export function spectrum(x: Float32Array, sr: number, from: number, to: number, size = 8192): { band: string; centroid: number } {
  const power = new Float64Array(size / 2);
  const frames = 8;
  const span = Math.max(0, to - from - size);
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const start = from + (span > 0 ? Math.floor((span * f) / (frames - 1)) : 0);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size && start + i < x.length; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = x[start + i]! * w;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
    used++;
    if (span <= 0) break;
  }
  const binHz = sr / size;
  const sums = BANDS.map(() => 0);
  let total = 0;
  let weighted = 0;
  for (let k = 1; k < size / 2; k++) {
    const hzK = k * binHz;
    const p = power[k]! / used;
    total += p;
    weighted += p * hzK;
    const bi = BANDS.findIndex((b) => hzK >= b.lo && hzK < b.hi);
    if (bi >= 0) sums[bi]! += p;
  }
  let best = 0;
  sums.forEach((s, i) => {
    if (s > sums[best]!) best = i;
  });
  return { band: BANDS[best]!.name, centroid: total > 0 ? weighted / total : 0 };
}

/** Analyse a (multi-channel) render; channels are mixed to mono for RMS/spectrum, peak is the max over channels. */
export function analyse(channels: Float32Array[], sr: number): Stats {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  let peak = 0;
  for (const c of channels) {
    for (let i = 0; i < n; i++) {
      const v = c[i]!;
      mono[i]! += v / channels.length;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  let last = 0;
  const thr = peak * 0.01;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(mono[i]!) > thr) {
      last = i + 1;
      break;
    }
  }
  const end = Math.max(1, last);
  let dc = 0;
  for (let i = 0; i < end; i++) dc += mono[i]!;
  dc /= end;
  const rms = rmsOf(mono, 0, end);
  const sp = peak > 1e-6 ? spectrum(mono, sr, 0, end) : { band: '-', centroid: 0 };
  return {
    audible: end / sr,
    peak,
    peakDb: gainToDb(peak),
    rms,
    rmsDb: gainToDb(rms),
    silent: peak < 1e-4,
    clips: peak >= 1,
    dc,
    band: sp.band,
    centroid: sp.centroid,
  };
}

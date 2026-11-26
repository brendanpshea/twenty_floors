/**
 * Offline objective check, loaded only by the preview page (?selftest=1).
 * Renders every recipe and ambience through an OfflineAudioContext using the
 * same graph and scheduling code as live playback, then measures the result.
 */
import { analyse, firstLastDiffDb, type Stats } from './analysis';
import { Ambience, THEMES } from './ambience';
import { CAL } from './calibration';
import { scheduleSfx } from './engine';
import { dbToGain, mulberry32, recipeDuration } from './helpers';
import { RECIPES } from './recipes';
import { buildGraph, createNoiseBuffer } from './synth';
import { SFX_IDS, type SfxId } from './types';
import type { ThemeId } from '../core/types';

const SR = 44100;

export interface SfxRow {
  id: SfxId;
  declared: number;
  dry: Stats;
  wet: Stats;
  expect: number;
  target: number;
  cal: number;
  suggestCal: number;
  flags: string[];
}

export interface AmbRow {
  name: string;
  stats: Stats;
  firstLastDb: number;
  flags: string[];
}

async function renderSfx(id: SfxId, reverbSeconds: number, seed: number): Promise<Float32Array[]> {
  const recipe = RECIPES[id];
  const tail = recipe.verb > 0 ? reverbSeconds + 0.2 : 0.2;
  const len = Math.ceil((recipeDuration(recipe) + 0.1 + tail) * SR);
  const ctx = new OfflineAudioContext(2, len, SR);
  const rng = mulberry32(seed);
  const graph = buildGraph(ctx, ctx.destination, reverbSeconds);
  const noise = createNoiseBuffer(ctx, 3, rng);
  scheduleSfx(ctx, graph, noise, id, 0.01, rng);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

export async function renderAmbience(theme: ThemeId, seconds: number, combat: boolean, seed: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const rng = mulberry32(seed);
  const graph = buildGraph(ctx, ctx.destination);
  const noise = createNoiseBuffer(ctx, 3, rng);
  const amb = new Ambience(ctx, graph, noise, theme, rng, 0);
  amb.setCombat(combat);
  amb.pump(seconds);
  const buf = await ctx.startRendering();
  amb.dispose();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}

export async function runSelfTest(): Promise<{ sfx: SfxRow[]; amb: AmbRow[] }> {
  const sfx: SfxRow[] = [];
  for (const id of SFX_IDS) {
    const r = RECIPES[id];
    const wet = analyse(await renderSfx(id, 2.4, 7), SR);
    const dry = analyse(await renderSfx(id, 0.01, 7), SR);
    const cal = CAL[id] ?? 1;
    const flags: string[] = [];
    if (wet.silent) flags.push('SILENT');
    if (wet.clips) flags.push('CLIPS');
    if (wet.peakDb > -6) flags.push('PEAK>-6');
    if (Math.abs(wet.dc) > 0.005) flags.push('DC');
    if (dry.audible > r.expectDur * 1.35) flags.push('LONG');
    if (dry.audible < r.expectDur * 0.5) flags.push('SHORT');
    if (Math.abs(wet.peakDb - r.peakDb) > 1.5) flags.push('LEVEL');
    sfx.push({
      id,
      declared: recipeDuration(r),
      dry,
      wet,
      expect: r.expectDur,
      target: r.peakDb,
      cal,
      suggestCal: wet.peak > 0 ? cal * dbToGain(r.peakDb - wet.peakDb) : cal,
      flags,
    });
  }

  const amb: AmbRow[] = [];
  const cases: [string, ThemeId, boolean][] = [...THEMES.map((t): [string, ThemeId, boolean] => [t, t, false]), ['warrens+combat', 'warrens', true]];
  for (const [name, theme, combat] of cases) {
    const ch = await renderAmbience(theme, 20, combat, 11);
    const stats = analyse(ch, SR);
    const mono = new Float32Array(ch[0]!.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (ch[0]![i]! + ch[1]![i]!) / 2;
    const diff = firstLastDiffDb(mono, SR, 1);
    const flags: string[] = [];
    if (stats.silent) flags.push('SILENT');
    if (stats.clips) flags.push('CLIPS');
    if (Math.abs(stats.dc) > 0.002) flags.push('DC');
    if (Math.abs(diff) > 3) flags.push('LOOP>3dB');
    if (stats.rmsDb > -32 || stats.rmsDb < -44) flags.push('LEVEL');
    if (stats.peakDb > -20) flags.push('PEAK>-20');
    amb.push({ name, stats, firstLastDb: diff, flags });
  }
  return { sfx, amb };
}

const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-inf');

export function formatReport(res: { sfx: SfxRow[]; amb: AmbRow[] }): string {
  const lines: string[] = [];
  lines.push('SFX  id | declared s | dry audible s (expect) | peak dBFS (target) | rms dBFS | dc | band | centroid Hz | cal -> suggested | flags');
  for (const r of res.sfx) {
    lines.push(
      [
        r.id.padEnd(13),
        f(r.declared, 2).padStart(5),
        `${f(r.dry.audible, 2)} (${f(r.expect, 2)})`.padStart(13),
        `${f(r.wet.peakDb)} (${f(r.target, 0)})`.padStart(13),
        f(r.wet.rmsDb).padStart(6),
        f(r.wet.dc, 4).padStart(8),
        r.wet.band.padEnd(16),
        f(r.wet.centroid, 0).padStart(5),
        `${f(r.cal, 3)} -> ${f(r.suggestCal, 3)}`,
        r.flags.join(',') || 'ok',
      ].join(' | '),
    );
  }
  lines.push('');
  lines.push('AMBIENCE (20 s)  name | peak dBFS | rms dBFS | dc | band | centroid | last-first 1s dB | flags');
  for (const a of res.amb) {
    lines.push(
      [a.name.padEnd(15), f(a.stats.peakDb), f(a.stats.rmsDb), f(a.stats.dc, 5), a.stats.band, f(a.stats.centroid, 0), f(a.firstLastDb, 2), a.flags.join(',') || 'ok'].join(' | '),
    );
  }
  const bad = [...res.sfx.filter((r) => r.flags.length).map((r) => `${r.id}:${r.flags.join('/')}`), ...res.amb.filter((r) => r.flags.length).map((r) => `${r.name}:${r.flags.join('/')}`)];
  lines.push('');
  lines.push(`FLAGGED: ${bad.length ? bad.join('  ') : 'none'}`);
  lines.push('CAL JSON: ' + JSON.stringify(Object.fromEntries(res.sfx.map((r) => [r.id, Number(r.suggestCal.toFixed(3))]))));
  return lines.join('\n');
}

/**
 * The sound table. Every SfxId maps to a Recipe: a list of tone and filtered
 * noise layers with envelopes. To add a sound, add an id to SfxId/SFX_IDS and
 * a recipe here, then run the preview self-test (?selftest=1) to calibrate it.
 */
import { hz } from './helpers';
import type { Layer, NoiseLayer, Recipe, SfxId, ToneLayer } from './types';

type ToneOpts = Partial<Omit<ToneLayer, 'kind' | 'wave' | 'freq' | 'at' | 'dur' | 'gain'>>;
type NoiseOpts = Partial<Omit<NoiseLayer, 'kind' | 'filter' | 'freq' | 'at' | 'dur' | 'gain'>>;

/** Sustained tone with ADSR. */
const tone = (wave: ToneLayer['wave'], freq: number, at: number, dur: number, gain: number, o: ToneOpts = {}): ToneLayer => ({
  kind: 'tone', wave, freq, at, dur, gain, a: 0.006, d: 0, s: 1, r: 0.12, ...o,
});
/** Percussive tone: instant attack, exponential decay over `len`. */
const ping = (wave: ToneLayer['wave'], freq: number, at: number, len: number, gain: number, o: ToneOpts = {}): ToneLayer =>
  tone(wave, freq, at, 0.002, gain, { a: 0.002, r: len, ...o });
const noise = (filter: NoiseLayer['filter'], freq: number, at: number, dur: number, gain: number, o: NoiseOpts = {}): NoiseLayer => ({
  kind: 'noise', filter, freq, at, dur, gain, q: 1, a: 0.006, d: 0, s: 1, r: 0.08, ...o,
});
const puff = (filter: NoiseLayer['filter'], freq: number, at: number, len: number, gain: number, o: NoiseOpts = {}): NoiseLayer =>
  noise(filter, freq, at, 0.002, gain, { a: 0.002, r: len, ...o });

/** Soft bell: inharmonic partials with shorter decays up the spectrum. */
const bell = (freq: number, at: number, len: number, gain: number, wave: ToneLayer['wave'] = 'sine'): Layer[] => [
  ping(wave, freq, at, len, gain),
  ping('sine', freq * 2.76, at, len * 0.55, gain * 0.35),
  ping('sine', freq * 5.4, at, len * 0.3, gain * 0.14),
];
/** Rising/falling run of soft notes. */
const run = (notes: number[], step: number, at: number, len: number, gain: number, wave: ToneLayer['wave'] = 'sine'): Layer[] =>
  notes.map((m, i) => ping(wave, hz(m), at + i * step, len, gain));

export const makeRecipe = (layers: Layer[], o: Partial<Recipe> & Pick<Recipe, 'peakDb' | 'expectDur'>): Recipe => ({
  layers, verb: 0, pitchVar: 0.04, timeJitter: 0, minInterval: 0.03, prio: 1, ...o,
});

// MIDI shorthands: C4 = 60.
const C4 = 60, D4 = 62, E4 = 64, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, G5 = 79, A5 = 81, B5 = 83, C6 = 84, E6 = 88, G6 = 91;

export const RECIPES: Record<SfxId, Recipe> = {
  // ---- UI: quiet, soft, tonal --------------------------------------------
  uiClick: makeRecipe([ping('triangle', 880, 0, 0.05, 0.6), puff('highpass', 4500, 0, 0.012, 0.15)],
    { peakDb: -24, expectDur: 0.05, pitchVar: 0.03, minInterval: 0.04, prio: 0 }),
  uiHover: makeRecipe([ping('sine', 1320, 0, 0.04, 0.5)],
    { peakDb: -30, expectDur: 0.04, pitchVar: 0.02, minInterval: 0.06, prio: 0 }),
  uiConfirm: makeRecipe([ping('sine', hz(E5), 0, 0.2, 0.55), ping('sine', hz(B5), 0.07, 0.28, 0.5), ping('triangle', hz(E4), 0, 0.2, 0.2)],
    { peakDb: -21, expectDur: 0.3, verb: 0.15, pitchVar: 0.01 }),
  uiCancel: makeRecipe([ping('sine', hz(B4), 0, 0.14, 0.55), ping('sine', hz(E4), 0.07, 0.22, 0.5)],
    { peakDb: -22, expectDur: 0.25, verb: 0.1, pitchVar: 0.01 }),
  uiError: makeRecipe([
    ping('triangle', 233, 0, 0.14, 0.6, { lp: 1100 }),
    ping('triangle', 196, 0.09, 0.22, 0.6, { lp: 1100 }),
  ], { peakDb: -20, expectDur: 0.25, pitchVar: 0.01 }),

  // ---- Movement ------------------------------------------------------------
  step: makeRecipe([
    puff('lowpass', 750, 0, 0.07, 0.9, { freqEnd: 280 }),
    ping('sine', 95, 0, 0.07, 0.7, { freqEnd: 55 }),
    puff('highpass', 3000, 0, 0.02, 0.08),
  ], { peakDb: -26, expectDur: 0.07, pitchVar: 0.14, timeJitter: 0.004, minInterval: 0.12, prio: 0 }),
  stepWater: makeRecipe([
    puff('bandpass', 900, 0, 0.2, 0.9, { freqEnd: 1800, q: 0.9 }),
    puff('highpass', 3500, 0.02, 0.12, 0.12),
    ping('sine', 650, 0.04, 0.07, 0.25, { freqEnd: 1100 }),
  ], { peakDb: -24, expectDur: 0.2, pitchVar: 0.12, timeJitter: 0.01, minInterval: 0.12, verb: 0.15, prio: 0 }),

  // ---- Attacks -------------------------------------------------------------
  swing: makeRecipe([noise('bandpass', 500, 0, 0.07, 0.8, { a: 0.05, r: 0.09, freqEnd: 2200, q: 1.4 })],
    { peakDb: -22, expectDur: 0.2, pitchVar: 0.1, minInterval: 0.05 }),
  hitBlade: makeRecipe([
    puff('highpass', 2500, 0, 0.1, 0.5),
    ping('triangle', 1800, 0, 0.2, 0.35),
    ping('sine', 2480, 0, 0.14, 0.2),
    ping('sine', 150, 0, 0.09, 0.8, { freqEnd: 70 }),
  ], { peakDb: -15, expectDur: 0.16, pitchVar: 0.08, timeJitter: 0.003, minInterval: 0.05, prio: 2 }),
  hitBlunt: makeRecipe([
    ping('sine', 125, 0, 0.2, 1, { freqEnd: 45 }),
    puff('lowpass', 900, 0, 0.1, 0.6),
    puff('bandpass', 1800, 0, 0.03, 0.25),
  ], { peakDb: -14, expectDur: 0.18, pitchVar: 0.08, minInterval: 0.05, prio: 2 }),
  hitPierce: makeRecipe([
    puff('bandpass', 3000, 0, 0.06, 0.6, { q: 2 }),
    ping('sine', 320, 0, 0.09, 0.6, { freqEnd: 150 }),
    puff('lowpass', 700, 0.01, 0.07, 0.4),
  ], { peakDb: -16, expectDur: 0.1, pitchVar: 0.08, minInterval: 0.05, prio: 2 }),
  miss: makeRecipe([noise('bandpass', 750, 0, 0.05, 0.6, { a: 0.04, r: 0.12, freqEnd: 300, q: 1.2 })],
    { peakDb: -26, expectDur: 0.2, pitchVar: 0.1, minInterval: 0.06 }),
  crit: makeRecipe([
    puff('highpass', 2200, 0, 0.16, 0.5),
    ping('sine', 140, 0, 0.18, 1, { freqEnd: 55 }),
    ping('triangle', 1760, 0, 0.3, 0.3),
    puff('lowpass', 1200, 0, 0.12, 0.5),
    ...run([E5, B5, E6, G6], 0.045, 0.03, 0.6, 0.32),
  ], { peakDb: -9, expectDur: 0.5, verb: 0.3, pitchVar: 0.03, minInterval: 0.08, prio: 2 }),
  bowShot: makeRecipe([
    ping('triangle', 240, 0, 0.28, 0.5, { freqEnd: 170, lp: 1400 }),
    puff('bandpass', 2000, 0, 0.04, 0.4, { q: 1.5 }),
    noise('bandpass', 1200, 0.02, 0.03, 0.3, { a: 0.02, r: 0.1, freqEnd: 3000 }),
  ], { peakDb: -19, expectDur: 0.2, pitchVar: 0.08, minInterval: 0.08 }),
  arrowHit: makeRecipe([
    puff('lowpass', 1500, 0, 0.05, 0.7),
    ping('sine', 210, 0, 0.07, 0.7, { freqEnd: 100 }),
    puff('highpass', 4000, 0, 0.02, 0.15),
  ], { peakDb: -18, expectDur: 0.08, pitchVar: 0.1, minInterval: 0.05 }),
  bite: makeRecipe([
    puff('bandpass', 1800, 0, 0.05, 0.6, { q: 2 }),
    puff('bandpass', 1500, 0.055, 0.06, 0.55, { q: 2 }),
    ping('sine', 140, 0.05, 0.09, 0.7, { freqEnd: 80 }),
  ], { peakDb: -17, expectDur: 0.14, pitchVar: 0.1, timeJitter: 0.006, minInterval: 0.08 }),
  claw: makeRecipe([
    noise('bandpass', 3500, 0, 0.012, 0.5, { freqEnd: 1600, q: 1.2, r: 0.05 }),
    noise('bandpass', 3300, 0.045, 0.012, 0.45, { freqEnd: 1500, q: 1.2, r: 0.05 }),
    noise('bandpass', 3000, 0.09, 0.012, 0.4, { freqEnd: 1400, q: 1.2, r: 0.06 }),
    ping('sine', 180, 0.05, 0.08, 0.35, { freqEnd: 100 }),
  ], { peakDb: -18, expectDur: 0.17, pitchVar: 0.1, timeJitter: 0.006, minInterval: 0.08 }),

  // ---- Creatures -----------------------------------------------------------
  hurtHero: makeRecipe([
    tone('triangle', 230, 0, 0.1, 0.7, { freqEnd: 140, lp: 800, a: 0.012, r: 0.12 }),
    noise('bandpass', 650, 0, 0.08, 0.35, { a: 0.012, r: 0.12, q: 0.8 }),
  ], { peakDb: -15, expectDur: 0.22, pitchVar: 0.1, minInterval: 0.15, prio: 2 }),
  hurtMonster: makeRecipe([
    tone('sawtooth', 150, 0, 0.1, 0.5, { freqEnd: 85, lp: 520, a: 0.01, r: 0.14 }),
    tone('sawtooth', 155, 0, 0.1, 0.4, { freqEnd: 88, lp: 520, a: 0.01, r: 0.14, detune: 14 }),
    noise('bandpass', 420, 0, 0.08, 0.3, { a: 0.01, r: 0.12 }),
  ], { peakDb: -15, expectDur: 0.24, pitchVar: 0.14, minInterval: 0.15, prio: 2 }),
  deathMonster: makeRecipe([
    tone('sawtooth', 200, 0, 0.3, 0.6, { freqEnd: 48, lp: 600, a: 0.02, r: 0.3 }),
    noise('lowpass', 500, 0, 0.3, 0.45, { freqEnd: 150, a: 0.02, r: 0.2 }),
    ping('sine', 72, 0.42, 0.25, 0.9, { freqEnd: 38 }),
    puff('lowpass', 400, 0.42, 0.12, 0.4),
  ], { peakDb: -13, expectDur: 0.62, pitchVar: 0.1, minInterval: 0.2, verb: 0.25, prio: 2 }),
  deathHero: makeRecipe([
    ...run([A4 - 12, 65 - 12, 62 - 12], 0.32, 0, 0.9, 0.5, 'triangle'),
    ...run([A4, 65, 62], 0.32, 0, 0.7, 0.18, 'sine'),
    tone('sine', 55, 0, 0.9, 0.3, { a: 0.3, r: 1.0 }),
  ], { peakDb: -13, expectDur: 1.7, verb: 0.55, pitchVar: 0.01, minInterval: 0.5, prio: 2 }),

  // ---- Magic and items -----------------------------------------------------
  heal: makeRecipe([
    ...run([C5, E5, G5, C6], 0.075, 0, 0.45, 0.4, 'triangle'),
    ...run([C6, E6, G6], 0.075, 0.15, 0.5, 0.12),
  ], { peakDb: -17, expectDur: 0.6, verb: 0.4, pitchVar: 0.02 }),
  potion: makeRecipe([
    ping('sine', 320, 0, 0.07, 0.6, { freqEnd: 520 }),
    ping('sine', 380, 0.09, 0.07, 0.6, { freqEnd: 600 }),
    ping('sine', 340, 0.18, 0.07, 0.6, { freqEnd: 560 }),
    noise('bandpass', 500, 0, 0.25, 0.15, { freqEnd: 800, q: 3, a: 0.02, r: 0.1 }),
    ping('sine', hz(E6), 0.3, 0.3, 0.2),
  ], { peakDb: -19, expectDur: 0.55, verb: 0.25, pitchVar: 0.06, timeJitter: 0.01 }),
  buff: makeRecipe([
    tone('sine', 400, 0, 0.25, 0.3, { freqEnd: 1200, a: 0.1, r: 0.12 }),
    ping('sine', hz(G5), 0.15, 0.4, 0.4),
    ping('sine', hz(D5 + 12), 0.25, 0.5, 0.35),
  ], { peakDb: -18, expectDur: 0.7, verb: 0.35, pitchVar: 0.02 }),
  debuff: makeRecipe([
    tone('sine', 620, 0, 0.25, 0.45, { freqEnd: 200, a: 0.03, r: 0.12 }),
    tone('triangle', 625, 0, 0.25, 0.3, { freqEnd: 198, a: 0.03, r: 0.12, detune: 25, lp: 1500 }),
    ping('sine', hz(E4 - 12), 0.25, 0.3, 0.3),
  ], { peakDb: -19, expectDur: 0.5, verb: 0.25, pitchVar: 0.03 }),
  dash: makeRecipe([
    noise('bandpass', 300, 0, 0.1, 0.8, { a: 0.06, r: 0.1, freqEnd: 3000, q: 1 }),
    tone('sine', 200, 0, 0.1, 0.2, { freqEnd: 600, a: 0.05, r: 0.1 }),
  ], { peakDb: -20, expectDur: 0.25, pitchVar: 0.08, minInterval: 0.1 }),

  // ---- Turn flow -----------------------------------------------------------
  diceRoll: makeRecipe([
    ...[0, 0.05, 0.095, 0.15, 0.19, 0.26, 0.33, 0.43].map((t, i) =>
      puff('bandpass', 2300 + (i % 3) * 400, t, 0.03, 0.9 - i * 0.07, { q: 3 })),
    ...[0, 0.05, 0.095, 0.15, 0.19, 0.26, 0.33, 0.43].map((t, i) =>
      ping('triangle', 700 + ((i * 137) % 5) * 80, t, 0.04, 0.4 - i * 0.03)),
  ], { peakDb: -19, expectDur: 0.5, pitchVar: 0.08, timeJitter: 0.012, minInterval: 0.3, verb: 0.08 }),
  turnStart: makeRecipe([ping('sine', hz(A4), 0, 0.22, 0.5), ping('sine', hz(E5), 0.1, 0.3, 0.45)],
    { peakDb: -22, expectDur: 0.35, verb: 0.2, pitchVar: 0.01, minInterval: 0.2 }),
  combatStart: makeRecipe([
    ping('sine', 90, 0, 0.35, 1, { freqEnd: 48 }),
    puff('lowpass', 300, 0, 0.25, 0.5),
    ping('sine', 85, 0.24, 0.4, 0.9, { freqEnd: 45 }),
    puff('lowpass', 280, 0.24, 0.25, 0.4),
    tone('triangle', hz(52), 0.3, 0.5, 0.2, { a: 0.35, r: 0.5, lp: 700 }),
    tone('triangle', hz(53), 0.3, 0.5, 0.18, { a: 0.35, r: 0.5, lp: 700 }),
  ], { peakDb: -12, expectDur: 1.0, verb: 0.35, pitchVar: 0.02, minInterval: 0.8, prio: 2 }),
  victory: makeRecipe([
    ...run([C5, E5, G5, C6], 0.11, 0, 0.6, 0.4, 'triangle'),
    ...run([C5, E5, G5], 0, 0.5, 1.4, 0.22, 'triangle'),
    ...run([C6, G6], 0, 0.55, 1.2, 0.12, 'sine'),
    ...run([C4], 0, 0.5, 1.4, 0.25, 'sine'),
  ], { peakDb: -9, expectDur: 1.8, verb: 0.5, pitchVar: 0.01, minInterval: 1, prio: 2 }),
  defeat: makeRecipe([
    ...run([A4 - 12, 67 - 12, 64 - 12], 0.42, 0, 1.1, 0.5, 'triangle'),
    ...run([A4, 67, 64], 0.42, 0, 0.8, 0.15, 'sine'),
    tone('sine', 55, 0, 1.2, 0.35, { a: 0.4, r: 1.2 }),
  ], { peakDb: -12, expectDur: 2.2, verb: 0.6, pitchVar: 0.01, minInterval: 1, prio: 2 }),

  // ---- Exploration rewards -------------------------------------------------
  chestOpen: makeRecipe([
    tone('sawtooth', 120, 0, 0.35, 0.35, { freqEnd: 240, lp: 420, a: 0.05, r: 0.08 }),
    noise('bandpass', 700, 0, 0.35, 0.18, { freqEnd: 1300, q: 4, a: 0.06, r: 0.06 }),
    ping('sine', 80, 0.4, 0.15, 0.6, { freqEnd: 50 }),
    puff('lowpass', 500, 0.4, 0.08, 0.35),
    ...run([G6, 98], 0.07, 0.45, 0.5, 0.13),
  ], { peakDb: -16, expectDur: 0.95, verb: 0.3, pitchVar: 0.04, minInterval: 0.5 }),
  coins: makeRecipe(
    [0, 0.06, 0.1, 0.17, 0.22].flatMap((t, i): Layer[] => [
      ping('sine', 2637 + (i % 2) * 500, t, 0.09, 0.35),
      ping('sine', 3520 + (i % 3) * 300, t, 0.06, 0.2),
    ]),
    { peakDb: -19, expectDur: 0.35, pitchVar: 0.08, timeJitter: 0.015, minInterval: 0.2, verb: 0.15 }),
  stairsUnlock: makeRecipe([
    noise('lowpass', 280, 0, 0.5, 0.7, { a: 0.1, r: 0.12, freqEnd: 180 }),
    tone('sine', 68, 0, 0.5, 0.5, { a: 0.1, r: 0.15 }),
    ping('sine', hz(D5), 0.55, 0.5, 0.35),
    ping('sine', hz(A5), 0.65, 0.7, 0.32),
  ], { peakDb: -15, expectDur: 1.2, verb: 0.4, pitchVar: 0.02, minInterval: 0.8 }),
  descend: makeRecipe([
    noise('lowpass', 1200, 0, 0.6, 0.5, { freqEnd: 200, a: 0.1, r: 0.3 }),
    tone('sine', 420, 0, 0.6, 0.3, { freqEnd: 90, a: 0.08, r: 0.3 }),
    ping('sine', 60, 0.9, 0.35, 0.8, { freqEnd: 40 }),
  ], { peakDb: -16, expectDur: 1.2, verb: 0.45, pitchVar: 0.03, minInterval: 1 }),
  levelUp: makeRecipe([
    ...run([C5, E5, G5, C6, E6, G6], 0.075, 0, 0.6, 0.38, 'triangle'),
    ...run([C5, G5, C6], 0, 0.5, 1.1, 0.2, 'triangle'),
    ...run([E6, C6 + 12], 0.05, 0.5, 0.9, 0.1, 'sine'),
  ], { peakDb: -9, expectDur: 1.5, verb: 0.5, pitchVar: 0.01, minInterval: 1, prio: 2 }),
  rest: makeRecipe([
    ...run([G4, B4, D5, G5], 0.28, 0, 0.9, 0.4, 'sine'),
    tone('triangle', hz(G4 - 12), 0, 1.0, 0.12, { a: 0.3, r: 0.9, lp: 600 }),
  ], { peakDb: -19, expectDur: 1.8, verb: 0.55, pitchVar: 0.01, minInterval: 1 }),

  // ---- Spells, companions, class features ---------------------------------
  spellCast: makeRecipe([
    tone('sine', 500, 0, 0.18, 0.4, { freqEnd: 1500, a: 0.12, r: 0.1 }),
    tone('triangle', 750, 0.02, 0.15, 0.2, { freqEnd: 2250, a: 0.1, r: 0.1, lp: 3500 }),
    noise('highpass', 4000, 0.05, 0.12, 0.12, { a: 0.1, r: 0.1 }),
    ping('sine', hz(E6), 0.25, 0.15, 0.2),
  ], { peakDb: -18, expectDur: 0.4, verb: 0.35, pitchVar: 0.05, minInterval: 0.1 }),
  fireHit: makeRecipe([
    noise('bandpass', 700, 0, 0.1, 0.8, { a: 0.03, r: 0.12, freqEnd: 2200, q: 0.9 }),
    ...[0.06, 0.1, 0.15, 0.19].map((t, i) => puff('highpass', 3500 + i * 500, t, 0.025, 0.4)),
    ping('sine', 120, 0, 0.12, 0.5, { freqEnd: 70 }),
  ], { peakDb: -15, expectDur: 0.3, verb: 0.15, pitchVar: 0.08, timeJitter: 0.01, minInterval: 0.05, prio: 2 }),
  coldHit: makeRecipe([
    puff('highpass', 3500, 0, 0.05, 0.6),
    ping('sine', hz(E6 + 5), 0, 0.3, 0.4),
    ping('sine', hz(E6 + 5) * 2.76, 0, 0.14, 0.25),
    ping('triangle', hz(B5), 0.03, 0.25, 0.25),
    ping('sine', 200, 0, 0.06, 0.4, { freqEnd: 110 }),
  ], { peakDb: -15, expectDur: 0.3, verb: 0.3, pitchVar: 0.06, minInterval: 0.05, prio: 2 }),
  lightningHit: makeRecipe([
    puff('highpass', 2500, 0, 0.05, 0.9),
    ping('sawtooth', 1800, 0, 0.12, 0.3, { freqEnd: 120, lp: 3000 }),
    ping('square', 900, 0.03, 0.06, 0.12, { freqEnd: 300, lp: 2500 }),
    puff('bandpass', 4500, 0.06, 0.03, 0.4, { q: 2 }),
    ping('sine', 90, 0, 0.1, 0.4, { freqEnd: 55 }),
  ], { peakDb: -15, expectDur: 0.16, verb: 0.15, pitchVar: 0.08, timeJitter: 0.006, minInterval: 0.05, prio: 2 }),
  forceHit: makeRecipe([
    ping('sine', 110, 0, 0.2, 1, { freqEnd: 55 }),
    puff('lowpass', 600, 0, 0.08, 0.4),
    ping('sine', 880, 0.02, 0.4, 0.3),
    ping('sine', 880 * 2.01, 0.02, 0.25, 0.1),
  ], { peakDb: -15, expectDur: 0.4, verb: 0.3, pitchVar: 0.06, minInterval: 0.05, prio: 2 }),
  acidHit: makeRecipe([
    noise('highpass', 5000, 0, 0.25, 0.5, { a: 0.02, r: 0.12 }),
    noise('bandpass', 3500, 0.03, 0.2, 0.3, { a: 0.05, r: 0.1, freqEnd: 6000, q: 3 }),
    ...[0.08, 0.17, 0.26].map((t) => ping('sine', 500 + t * 1500, t, 0.05, 0.2, { freqEnd: 1100 + t * 1500 })),
    ping('sine', 150, 0, 0.08, 0.4, { freqEnd: 80 }),
  ], { peakDb: -16, expectDur: 0.4, verb: 0.15, pitchVar: 0.08, timeJitter: 0.012, minInterval: 0.05, prio: 2 }),
  radiantHit: makeRecipe([
    ...bell(hz(E6), 0, 0.7, 0.4),
    ...bell(hz(B5), 0.05, 0.5, 0.2, 'triangle'),
    puff('highpass', 3000, 0, 0.04, 0.25),
    ping('sine', 160, 0, 0.1, 0.4, { freqEnd: 90 }),
  ], { peakDb: -15, expectDur: 0.6, verb: 0.4, pitchVar: 0.05, minInterval: 0.05, prio: 2 }),
  necroticHit: makeRecipe([
    tone('sine', 110, 0, 0.25, 0.7, { freqEnd: 70, a: 0.15, r: 0.2 }),
    tone('triangle', 165, 0, 0.25, 0.3, { freqEnd: 100, a: 0.15, r: 0.2, lp: 500 }),
    noise('bandpass', 400, 0, 0.25, 0.3, { a: 0.15, r: 0.2, freqEnd: 200, q: 2 }),
    ping('sine', 60, 0.18, 0.2, 0.5, { freqEnd: 40 }),
  ], { peakDb: -15, expectDur: 0.6, verb: 0.45, pitchVar: 0.06, minInterval: 0.05, prio: 2 }),
  poisonHit: makeRecipe([
    noise('bandpass', 4000, 0, 0.18, 0.6, { a: 0.03, r: 0.14, freqEnd: 2200, q: 1.2 }),
    ping('sine', 400, 0.06, 0.06, 0.3, { freqEnd: 700 }),
    ping('sine', 450, 0.14, 0.06, 0.25, { freqEnd: 800 }),
    puff('lowpass', 800, 0, 0.06, 0.4),
  ], { peakDb: -17, expectDur: 0.35, verb: 0.15, pitchVar: 0.08, timeJitter: 0.01, minInterval: 0.05, prio: 2 }),
  thunderHit: makeRecipe([
    ping('sine', 70, 0, 0.5, 1, { freqEnd: 32 }),
    noise('lowpass', 500, 0, 0.1, 0.8, { a: 0.005, r: 0.35, freqEnd: 120 }),
    puff('bandpass', 2000, 0, 0.04, 0.3),
  ], { peakDb: -12, expectDur: 0.6, verb: 0.35, pitchVar: 0.06, minInterval: 0.05, prio: 2 }),
  healSpell: makeRecipe([
    ...run([G5, C6, E6], 0.1, 0, 0.7, 0.3, 'sine'),
    ping('triangle', hz(C5), 0.05, 0.6, 0.12),
    ...run([G6], 0, 0.25, 0.7, 0.08),
  ], { peakDb: -19, expectDur: 0.8, verb: 0.5, pitchVar: 0.02, minInterval: 0.15 }),
  shield: makeRecipe([
    ...bell(hz(A5 + 7), 0, 0.5, 0.4),
    puff('bandpass', 5000, 0, 0.03, 0.4, { q: 3 }),
    ping('triangle', hz(E5), 0.04, 0.3, 0.25),
    ping('sine', 140, 0, 0.06, 0.3, { freqEnd: 90 }),
  ], { peakDb: -16, expectDur: 0.5, verb: 0.3, pitchVar: 0.04, minInterval: 0.1, prio: 2 }),
  concentrationStart: makeRecipe([
    tone('sine', hz(G5), 0, 0.3, 0.4, { a: 0.1, r: 0.2 }),
    tone('triangle', hz(G5 - 12), 0, 0.3, 0.2, { a: 0.1, r: 0.2, lp: 900 }),
    tone('sine', hz(G5) * 2, 0, 0.3, 0.06, { a: 0.12, r: 0.2 }),
  ], { peakDb: -22, expectDur: 0.5, verb: 0.3, pitchVar: 0.02, minInterval: 0.2 }),
  concentrationBreak: makeRecipe([
    tone('sine', hz(G5), 0, 0.08, 0.4, { freqEnd: hz(G5 - 7), a: 0.01, r: 0.2 }),
    tone('triangle', hz(G5 - 12), 0, 0.08, 0.2, { freqEnd: hz(G5 - 19), a: 0.01, r: 0.2, lp: 900 }),
    puff('bandpass', 3000, 0.02, 0.04, 0.35, { q: 2 }),
    ping('sine', hz(G5 - 5), 0.08, 0.15, 0.15, { freqEnd: hz(G5 - 14) }),
  ], { peakDb: -20, expectDur: 0.35, verb: 0.3, pitchVar: 0.03, minInterval: 0.2 }),
  teleport: makeRecipe([
    noise('bandpass', 3000, 0, 0.07, 0.5, { a: 0.04, r: 0.05, freqEnd: 400, q: 1.2 }),
    tone('sine', 1200, 0, 0.07, 0.3, { freqEnd: 250, a: 0.03, r: 0.05 }),
    noise('bandpass', 400, 0.17, 0.05, 0.5, { a: 0.03, r: 0.1, freqEnd: 3000, q: 1.2 }),
    tone('sine', 250, 0.17, 0.05, 0.3, { freqEnd: 1300, a: 0.03, r: 0.1 }),
    ping('sine', hz(E6), 0.3, 0.12, 0.12),
  ], { peakDb: -19, expectDur: 0.4, verb: 0.3, pitchVar: 0.05, minInterval: 0.2 }),
  companionDown: makeRecipe([
    tone('triangle', hz(A5 - 5), 0, 0.1, 0.4, { freqEnd: hz(A5 - 12), a: 0.03, r: 0.2, lp: 1800 }),
    tone('triangle', hz(A5 - 8), 0.2, 0.1, 0.3, { freqEnd: hz(A5 - 17), a: 0.03, r: 0.25, lp: 1500 }),
  ], { peakDb: -19, expectDur: 0.6, verb: 0.3, pitchVar: 0.04, minInterval: 0.3 }),
  companionUp: makeRecipe([
    tone('triangle', hz(A5 - 17), 0, 0.1, 0.35, { freqEnd: hz(A5 - 8), a: 0.03, r: 0.2, lp: 1800 }),
    tone('triangle', hz(A5 - 12), 0.18, 0.12, 0.4, { freqEnd: hz(A5 - 3), a: 0.03, r: 0.3, lp: 2200 }),
    ping('sine', hz(E6), 0.36, 0.25, 0.1),
  ], { peakDb: -19, expectDur: 0.6, verb: 0.35, pitchVar: 0.04, minInterval: 0.3 }),
  sneakAttack: makeRecipe([
    puff('highpass', 3000, 0, 0.06, 0.5),
    ping('triangle', hz(B5 + 12), 0, 0.2, 0.3),
    ping('sine', hz(B5 + 12) * 1.5, 0.03, 0.2, 0.2),
    ping('sine', 200, 0, 0.06, 0.4, { freqEnd: 110 }),
  ], { peakDb: -16, expectDur: 0.25, verb: 0.2, pitchVar: 0.04, minInterval: 0.1, prio: 2 }),
  stanceChange: makeRecipe([
    ping('sine', 1760, 0, 0.03, 0.4),
    ping('triangle', 2093, 0.035, 0.03, 0.3),
  ], { peakDb: -26, expectDur: 0.08, pitchVar: 0.03, minInterval: 0.08, prio: 0 }),
};

export { bell, run, ping, tone, noise, puff };

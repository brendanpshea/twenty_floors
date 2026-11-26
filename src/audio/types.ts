export type SfxId =
  | 'uiClick' | 'uiHover' | 'uiConfirm' | 'uiCancel' | 'uiError'
  | 'step' | 'stepWater'
  | 'swing' | 'hitBlade' | 'hitBlunt' | 'hitPierce' | 'miss' | 'crit'
  | 'bowShot' | 'arrowHit' | 'bite' | 'claw'
  | 'hurtHero' | 'hurtMonster' | 'deathMonster' | 'deathHero'
  | 'heal' | 'potion' | 'buff' | 'debuff' | 'dash'
  | 'diceRoll' | 'turnStart' | 'combatStart' | 'victory' | 'defeat'
  | 'chestOpen' | 'coins' | 'stairsUnlock' | 'descend' | 'levelUp' | 'rest';

/** Every id, for iteration (previews, tests). Keep in sync with SfxId; the compiler checks completeness via RECIPES. */
export const SFX_IDS: readonly SfxId[] = [
  'uiClick', 'uiHover', 'uiConfirm', 'uiCancel', 'uiError',
  'step', 'stepWater',
  'swing', 'hitBlade', 'hitBlunt', 'hitPierce', 'miss', 'crit',
  'bowShot', 'arrowHit', 'bite', 'claw',
  'hurtHero', 'hurtMonster', 'deathMonster', 'deathHero',
  'heal', 'potion', 'buff', 'debuff', 'dash',
  'diceRoll', 'turnStart', 'combatStart', 'victory', 'defeat',
  'chestOpen', 'coins', 'stairsUnlock', 'descend', 'levelUp', 'rest',
];

export interface PlayOptions {
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback-rate style multiplier, 1 = unchanged. */
  pitch?: number;
  /** Seconds to wait before the sound starts. */
  delay?: number;
}

/** Envelope: linear attack `a`, exponential decay `d` to sustain `s` (0..1), hold until `dur`, exponential release `r`. */
interface LayerBase {
  /** Start offset within the recipe, seconds. */
  at: number;
  /** Note-on length (attack+decay+hold) in seconds. */
  dur: number;
  a: number;
  d: number;
  s: number;
  r: number;
  gain: number;
}

export interface ToneLayer extends LayerBase {
  kind: 'tone';
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  freq: number;
  /** Exponential glide target reached at the end of the layer. */
  freqEnd?: number;
  /** Cents. */
  detune?: number;
  /** Optional lowpass cutoff in Hz. */
  lp?: number;
}

export interface NoiseLayer extends LayerBase {
  kind: 'noise';
  filter: 'lowpass' | 'highpass' | 'bandpass';
  freq: number;
  freqEnd?: number;
  q: number;
}

export type Layer = ToneLayer | NoiseLayer;

export interface Recipe {
  layers: Layer[];
  /** Reverb send, 0..1. */
  verb: number;
  /** Random pitch variation per play, +-fraction (0.05 = +-5%). */
  pitchVar: number;
  /** Max random start delay applied independently to each layer, seconds. */
  timeJitter: number;
  /** Minimum seconds between two plays of this id. */
  minInterval: number;
  /** Voice-cap priority: 0 dropped first, 2 never dropped below the hard cap. */
  prio: 0 | 1 | 2;
  /** Target peak after the master limiter, dBFS (at master volume 1). Used by calibration and the self-test. */
  peakDb: number;
  /** Intended audible length in seconds (checked by the self-test, +-35%). */
  expectDur: number;
}

/**
 * Per-sound linear gain multipliers, generated from the self-test so every
 * recipe's measured peak (after the limiter) lands on its `peakDb` target.
 * A missing entry means 1. Re-run `/dev/audio-preview.html?selftest=1` after
 * editing a recipe and paste the "suggested cal" column.
 */
import type { ThemeId } from '../core/types';
import type { SfxId } from './types';

export const CAL: Partial<Record<SfxId, number>> = {
  uiClick: 0.447,
  uiHover: 0.335,
  uiConfirm: 0.297,
  uiCancel: 0.283,
  uiError: 0.27,
  step: 0.315,
  stepWater: 0.509,
  swing: 0.414,
  hitBlade: 0.652,
  hitBlunt: 0.876,
  hitPierce: 1.195,
  miss: 0.734,
  crit: 0.855,
  bowShot: 1.009,
  arrowHit: 0.618,
  bite: 0.479,
  claw: 0.48,
  hurtHero: 0.385,
  hurtMonster: 0.57,
  deathMonster: 0.396,
  deathHero: 0.389,
  heal: 0.372,
  potion: 0.252,
  buff: 0.255,
  debuff: 0.172,
  dash: 0.315,
  diceRoll: 0.509,
  turnStart: 0.263,
  combatStart: 0.425,
  victory: 0.645,
  defeat: 0.368,
  chestOpen: 0.431,
  coins: 0.315,
  stairsUnlock: 0.358,
  descend: 0.275,
  levelUp: 0.771,
  rest: 0.273,
};

/** Overall bed level per theme (linear), calibrated so the 20 s render sits near -38 dBFS RMS. */
export const AMB_LEVEL: Record<ThemeId, number> = {
  warrens: 0.057,
  crypt: 0.1,
  depths: 0.073,
  sewers: 0.125,
  fungal: 0.065,
  hold: 0.2,
  library: 0.23,
  foundry: 0.115,
  ice: 0.135,
};

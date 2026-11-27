import type { Rng } from '../core/rng';
import type { PuzzleInstance, RawResult } from './types';

/**
 * A synthetic player of a given strength (on the 1..10 difficulty scale) for tests and the dev
 * "simulate 20 chests" button. Fully deterministic given the Rng.
 */
export function simulatePlayer(inst: PuzzleInstance, strength: number, rng: Rng): RawResult {
  const gap = strength - inst.difficulty + rng.range(-0.4, 0.4);
  const par = inst.parSeconds;
  if (gap < -2.5) {
    return {
      outcome: inst.kind === 'tumblers' && rng.chance(0.5) ? 'failed' : 'skipped',
      seconds: par * 3,
      mistakes: 3,
      hintsUsed: 1,
      moves: inst.parMoves ?? 0,
    };
  }
  return {
    outcome: 'solved',
    seconds: Math.round(par * 1.4 * 2 ** (-gap / 1.5) * 10) / 10,
    mistakes: inst.kind === 'wards' || inst.kind === 'runes' ? Math.max(0, Math.round(-gap * 1.2)) : 0,
    hintsUsed: gap < -1 ? 1 : 0,
    moves: inst.parMoves === undefined ? 0 : Math.max(1, Math.round(inst.parMoves * (1.15 - 0.2 * gap))),
  };
}

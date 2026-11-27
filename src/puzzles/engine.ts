import { Rng, hashSeed } from '../core/rng';
import { applyConduits, generateConduits, hintConduits, solveConduits, startConduits } from './conduits';
import { applyRunes, generateRunes, hintRunes, solveRunes, startRunes } from './runes';
import { applyTumblers, generateTumblers, hintTumblers, solveTumblers, startTumblers } from './tumblers';
import { applyWards, generateWards, hintWards, solveWards, startWards } from './wards';
import type { PuzzleInstance, PuzzleMove, PuzzleSpec, PuzzleState } from './types';

/** Deterministic: the same spec always yields the same puzzle. */
export function generatePuzzle(spec: PuzzleSpec): PuzzleInstance {
  const difficulty = Math.max(1, Math.min(10, Math.round(spec.difficulty)));
  const rng = new Rng(hashSeed(spec.seed, `puzzle:${spec.kind}:${difficulty}`));
  switch (spec.kind) {
    case 'runes':
      return generateRunes(spec.seed, difficulty, rng);
    case 'tumblers':
      return generateTumblers(spec.seed, difficulty, rng);
    case 'conduits':
      return generateConduits(spec.seed, difficulty, rng);
    case 'wards':
      return generateWards(spec.seed, difficulty, rng);
  }
}

export function start(inst: PuzzleInstance): PuzzleState {
  switch (inst.kind) {
    case 'runes':
      return startRunes(inst);
    case 'tumblers':
      return startTumblers(inst);
    case 'conduits':
      return startConduits(inst);
    case 'wards':
      return startWards(inst);
  }
}

/** Pure: returns a new state (or the same object when the move is illegal or changes nothing). */
export function apply(state: PuzzleState, move: PuzzleMove): PuzzleState {
  // The cast is safe because a move is only ever built for the state's own kind; mismatches are ignored.
  switch (state.kind) {
    case 'runes':
      return move.type === 'place' || move.type === 'clear' ? applyRunes(state, move) : state;
    case 'tumblers':
      return move.type === 'guess' || move.type === 'reveal' ? applyTumblers(state, move) : state;
    case 'conduits':
      return move.type === 'rotate' || move.type === 'set' ? applyConduits(state, move) : state;
    case 'wards':
      return move.type === 'open' || move.type === 'flag' ? applyWards(state, move) : state;
  }
}

export function isSolved(state: PuzzleState): boolean {
  return state.solved;
}

/** Only kinds with a hard guess limit can fail. */
export function isFailed(state: PuzzleState): boolean {
  return state.kind === 'tumblers' && state.failed;
}

export function mistakes(state: PuzzleState): number {
  return state.mistakes;
}

/** One correct step, or null when there is nothing left to reveal. Applying it is the caller's job (costs a hint). */
export function hint(state: PuzzleState): PuzzleMove | null {
  switch (state.kind) {
    case 'runes':
      return hintRunes(state);
    case 'tumblers':
      return hintTumblers(state);
    case 'conduits':
      return hintConduits(state);
    case 'wards':
      return hintWards(state);
  }
}

/** A full move list that solves the instance (used by tests and the dev simulator). */
export function solve(inst: PuzzleInstance): PuzzleMove[] {
  switch (inst.kind) {
    case 'runes':
      return solveRunes(inst);
    case 'tumblers':
      return solveTumblers(inst);
    case 'conduits':
      return solveConduits(inst);
    case 'wards':
      return solveWards(inst);
  }
}

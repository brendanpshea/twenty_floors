/**
 * Shared types for the puzzle framework. Pure data: no DOM, no three.js.
 * The lead can lift what the game layer needs into core/types.ts.
 */

import type { PuzzleGrade, PuzzleKind } from '../core/types';

// The shared contracts live in core/types.ts; re-exported here for the puzzle modules.
export type { PlayerSkill, PuzzleKind, PuzzleResult, PuzzleSpec } from '../core/types';

export const PUZZLE_KINDS: readonly PuzzleKind[] = ['runes', 'tumblers', 'conduits', 'wards'];

export type Grade = PuzzleGrade;
export type Outcome = 'solved' | 'skipped' | 'failed';

/** What the view/session measured. */
export interface RawResult {
  outcome: Outcome;
  seconds: number;
  mistakes: number;
  hintsUsed: number;
  /** Guesses (tumblers) or taps (conduits); 0 where the kind has no such measure. */
  moves: number;
}


// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

interface InstanceBase {
  seed: number;
  difficulty: number;
  /** Short lock title, e.g. "Rune Lock". */
  title: string;
  /** One-line instruction. */
  instruction: string;
  /** Seconds a good player needs: gold needs at most this. */
  parSeconds: number;
  /** Par guesses/taps for kinds that measure them (gold needs at most this). */
  parMoves?: number;
  /** Mistakes tolerated for gold. */
  mistakeAllowance: number;
}

export interface RunesData {
  n: number;
  boxRows: number;
  boxCols: number;
  /** n*n cells, 0 = empty, 1..n = rune. */
  givens: number[];
}
export interface RunesInstance extends InstanceBase {
  kind: 'runes';
  data: RunesData;
  solution: number[];
}

export interface TumblersData {
  length: number;
  symbols: number;
  repeats: boolean;
  maxGuesses: number;
}
export interface TumblersInstance extends InstanceBase {
  kind: 'tumblers';
  data: TumblersData;
  solution: number[];
}

export interface ConduitsData {
  w: number;
  h: number;
  wrap: boolean;
  /** Source cell index. */
  source: number;
  /** Starting masks (bits N=1 E=2 S=4 W=8), already scrambled. */
  tiles: number[];
  /** Cells that cannot be rotated. */
  locked: boolean[];
}
export interface ConduitsInstance extends InstanceBase {
  kind: 'conduits';
  data: ConduitsData;
  /** One valid masks layout (the only one, by construction). */
  solution: number[];
}

export interface WardsData {
  w: number;
  h: number;
  mineCount: number;
  /** Neighbour trap count for every cell (-1 on traps). Only read for opened cells. */
  clues: number[];
  /** Cells open at the start (already cascaded). */
  start: number[];
}
export interface WardsInstance extends InstanceBase {
  kind: 'wards';
  data: WardsData;
  /** true = trapped. */
  solution: boolean[];
}

export type PuzzleInstance = RunesInstance | TumblersInstance | ConduitsInstance | WardsInstance;

// ---------------------------------------------------------------------------
// Moves and states
// ---------------------------------------------------------------------------

export type RunesMove = { type: 'place'; cell: number; value: number } | { type: 'clear'; cell: number };
export type TumblersMove = { type: 'guess'; code: number[] } | { type: 'reveal'; index: number };
export type ConduitsMove =
  | { type: 'rotate'; cell: number; dir?: 1 | -1 }
  | { type: 'set'; cell: number; mask: number };
export type WardsMove = { type: 'open'; cell: number } | { type: 'flag'; cell: number };
export type PuzzleMove = RunesMove | TumblersMove | ConduitsMove | WardsMove;

export interface RunesState {
  kind: 'runes';
  inst: RunesInstance;
  grid: number[];
  mistakes: number;
  moves: number;
  solved: boolean;
}

export interface TumblerGuess {
  code: number[];
  /** Right symbol, right place. */
  exact: number;
  /** Right symbol, wrong place. */
  misplaced: number;
}
export interface TumblersState {
  kind: 'tumblers';
  inst: TumblersInstance;
  guesses: TumblerGuess[];
  /** Hint-revealed symbols by position. */
  revealed: (number | null)[];
  mistakes: 0;
  moves: number;
  solved: boolean;
  failed: boolean;
}

export interface ConduitsState {
  kind: 'conduits';
  inst: ConduitsInstance;
  tiles: number[];
  mistakes: 0;
  moves: number;
  solved: boolean;
}

/** Ward cell status. */
export const W_HIDDEN = 0;
export const W_OPEN = 1;
export const W_FLAG = 2;
export const W_SPRUNG = 3;
export interface WardsState {
  kind: 'wards';
  inst: WardsInstance;
  cells: number[];
  mistakes: number;
  moves: number;
  solved: boolean;
}

export type PuzzleState = RunesState | TumblersState | ConduitsState | WardsState;

// ---------------------------------------------------------------------------
// Adaptive skill
// ---------------------------------------------------------------------------

/** Plain JSON the game stores. Ratings are on the 1..10 difficulty scale. */

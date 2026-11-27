import type { PuzzleInstance, PuzzleKind, PuzzleMove, PuzzleState } from '../types';

/**
 * A guided practice lock: a small hand-made puzzle and the steps that walk through it. Pure data and predicates (no DOM),
 * so every tutorial can be played through in a test. The view lives in src/ui/puzzles/tutorial.ts.
 *
 * Text may name symbols inline as `{sym:N}` (N as in the board's palette: a rune's value 1..n, a tumbler symbol 0..k-1);
 * the view draws the symbol there.
 */
export interface TutorialStep {
  /** What the coach says. One to three short sentences. */
  text: string;
  /**
   * Board elements to light up, by their `data-spot` address: `cell:<i>`, `slot:<i>` (tumbler), `sym:<v>` (palette key),
   * `act:try` (Try the lock), `act:erase`, `act:open` and `act:mark` (ward mode buttons).
   */
  spot?: string[];
  /** The step is done when this holds. Absent: a reading step, passed with Next. */
  goal?: (state: PuzzleState) => boolean;
  /** Moves allowed on this step; any other move is refused and `nudge` is shown. Absent: any move. */
  allow?: (move: PuzzleMove, state: PuzzleState) => boolean;
  /** Shown when a move is refused. */
  nudge?: string;
  /** Shown once the goal is met, with Next. May explain what the move revealed. */
  done?: string;
  /** Moves that complete the step (the "Show me" button plays them; the tests play them too). */
  show?: PuzzleMove[];
}

export interface Tutorial {
  kind: PuzzleKind;
  /** e.g. "Practice: Tumbler Lock". */
  title: string;
  instance: PuzzleInstance;
  steps: TutorialStep[];
}

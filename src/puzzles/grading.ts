import type { Grade, PuzzleInstance, PuzzleResult, RawResult } from './types';

/**
 * Grade a finished (or abandoned) puzzle. The timer never ends a puzzle; it only moves the grade.
 *
 * gold:   solved within par time, at most the kind's mistake allowance, no hints, within par moves.
 * silver: solved within 2x par time, at most one hint, at most allowance + 2 mistakes, within 1.5x par moves.
 * bronze: solved at all.
 * none:   skipped or failed.
 */
export function gradeResult(inst: PuzzleInstance, raw: RawResult): PuzzleResult {
  return { ...raw, grade: gradeFor(inst, raw) };
}

function gradeFor(inst: PuzzleInstance, raw: RawResult): Grade {
  if (raw.outcome !== 'solved') return 'none';
  const parMoves = inst.parMoves;
  const goldMoves = parMoves === undefined || raw.moves <= parMoves;
  const silverMoves = parMoves === undefined || raw.moves <= Math.ceil(parMoves * 1.5);
  if (raw.seconds <= inst.parSeconds && raw.mistakes <= inst.mistakeAllowance && raw.hintsUsed === 0 && goldMoves) {
    return 'gold';
  }
  if (
    raw.seconds <= inst.parSeconds * 2 &&
    raw.hintsUsed <= 1 &&
    raw.mistakes <= inst.mistakeAllowance + 2 &&
    silverMoves
  ) {
    return 'silver';
  }
  return 'bronze';
}

/** The best grade still reachable, given what has happened so far (for the live "prospective grade" display). */
export function prospectiveGrade(
  inst: PuzzleInstance,
  live: { seconds: number; mistakes: number; hintsUsed: number; moves: number },
): Grade {
  return gradeFor(inst, { outcome: 'solved', ...live });
}

/** Seconds at which the prospective grade drops: gold ends at par, silver at 2x par. */
export function timeThresholds(inst: PuzzleInstance): { gold: number; silver: number } {
  return { gold: inst.parSeconds, silver: inst.parSeconds * 2 };
}

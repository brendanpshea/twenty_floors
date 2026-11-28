import type { Grade, PuzzleInstance, PuzzleResult, RawResult } from './types';

/**
 * Grade a finished (or abandoned) puzzle. The timer never ends a puzzle; it only moves the grade.
 *
 * gold:   solved within GRADE_TIME.gold x par time, at most the kind's mistake allowance, no hints, within par moves.
 * silver: solved within GRADE_TIME.silver x par time, at most one hint, at most allowance + 2 mistakes, within 1.5x par moves.
 * bronze: solved at all.
 * none:   skipped or failed.
 */
/**
 * How many times the par time (`parSeconds`, what a good player needs) each grade allows. Doubled from 1 and 2 on the
 * owner's request (27 November 2026): the locks are a break between fights, not a race. `parSeconds` itself is unchanged,
 * so the puzzle generators and the player-skill model keep their meaning.
 */
export const GRADE_TIME = { gold: 2, silver: 4 };

export function gradeResult(inst: PuzzleInstance, raw: RawResult): PuzzleResult {
  return { ...raw, grade: gradeFor(inst, raw), paceGrade: gradeFor(inst, raw, PACE) };
}

/** The pace the player-skill model measures against: par for gold, twice par for silver (unchanged by GRADE_TIME). */
const PACE = { gold: 1, silver: 2 };

function gradeFor(inst: PuzzleInstance, raw: RawResult, time: { gold: number; silver: number } = GRADE_TIME): Grade {
  if (raw.outcome !== 'solved') return 'none';
  const parMoves = inst.parMoves;
  const goldMoves = parMoves === undefined || raw.moves <= parMoves;
  const silverMoves = parMoves === undefined || raw.moves <= Math.ceil(parMoves * 1.5);
  if (raw.seconds <= inst.parSeconds * time.gold && raw.mistakes <= inst.mistakeAllowance && raw.hintsUsed === 0 && goldMoves) {
    return 'gold';
  }
  if (
    raw.seconds <= inst.parSeconds * time.silver &&
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

/** Seconds at which the prospective grade drops (see GRADE_TIME). */
export function timeThresholds(inst: PuzzleInstance): { gold: number; silver: number } {
  return { gold: inst.parSeconds * GRADE_TIME.gold, silver: inst.parSeconds * GRADE_TIME.silver };
}

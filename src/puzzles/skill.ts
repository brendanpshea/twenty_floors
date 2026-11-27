import type { Rng } from '../core/rng';
import { PUZZLE_KINDS } from './types';
import type { Grade, PlayerSkill, PuzzleKind, PuzzleResult } from './types';

/** New players start gentle. */
export const START_RATING = 2;
const MIN_RATING = 1;
const MAX_RATING = 10;

export function newSkill(): PlayerSkill {
  return { overall: START_RATING, byKind: {}, played: 0, playedByKind: {} };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The rating used for a kind: its own once played, otherwise the overall one. */
export function ratingFor(skill: PlayerSkill, kind: PuzzleKind): number {
  return skill.byKind[kind] ?? skill.overall;
}

/** Kinds the player has met at least once (for first-time explainers). */
export function seenKinds(skill: PlayerSkill): PuzzleKind[] {
  return PUZZLE_KINDS.filter((k) => (skill.playedByKind[k] ?? 0) > 0);
}

/**
 * Difficulty 1..10 from the player's rating for this kind, nudged up by up to
 * ~1.5 levels from depth 1 to depth 20 so deeper chests are a little harder.
 */
export function nextDifficulty(skill: PlayerSkill, kind: PuzzleKind, depth: number): number {
  const d = Math.max(1, Math.min(20, depth));
  const nudge = (1.5 * (d - 1)) / 19;
  return clamp(Math.round(ratingFor(skill, kind) + nudge), 1, 10);
}

const SCORE: Record<Grade, number> = { gold: 1, silver: 0.65, bronze: 0.35, none: 0 };

function expected(rating: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(rating - difficulty) * 0.7));
}

/** Elo-like update: the more the result beats expectation, the more the rating moves. K shrinks as games accumulate. */
export function updateSkill(skill: PlayerSkill, kind: PuzzleKind, difficulty: number, result: PuzzleResult): PlayerSkill {
  const playedKind = skill.playedByKind[kind] ?? 0;
  const score = SCORE[result.grade];
  const kindRating = ratingFor(skill, kind);
  const kKind = Math.max(0.7, 2.8 - 0.6 * playedKind);
  const kAll = Math.max(0.6, 2.6 - 0.25 * skill.played);
  const nextKind = clamp(kindRating + kKind * (score - expected(kindRating, difficulty)), MIN_RATING, MAX_RATING);
  const nextAll = clamp(skill.overall + kAll * (score - expected(skill.overall, difficulty)), MIN_RATING, MAX_RATING);
  return {
    overall: nextAll,
    byKind: { ...skill.byKind, [kind]: nextKind },
    played: skill.played + 1,
    playedByKind: { ...skill.playedByKind, [kind]: playedKind + 1 },
  };
}

/** Variety: never repeat the last kind; favour kinds the player has met least. */
export function pickKind(
  rng: Rng,
  skill: PlayerSkill,
  recentKinds: readonly PuzzleKind[],
  kinds: readonly PuzzleKind[] = PUZZLE_KINDS,
): PuzzleKind {
  const last = recentKinds[recentKinds.length - 1];
  const prev = recentKinds[recentKinds.length - 2];
  let pool = kinds.filter((k) => k !== last);
  if (pool.length === 0) pool = kinds.slice();
  const weights = pool.map((k) => {
    let w = 1 / (1 + (skill.playedByKind[k] ?? 0)) + 0.25;
    if (k === prev) w *= 0.6;
    return w;
  });
  return rng.weighted(pool, weights);
}

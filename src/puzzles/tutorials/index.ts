import type { PuzzleKind } from '../types';
import { CONDUITS_TUTORIAL } from './conduits';
import { RUNES_TUTORIAL } from './runes';
import { TUMBLERS_TUTORIAL } from './tumblers';
import type { Tutorial } from './types';
import { WARDS_TUTORIAL } from './wards';

export type { Tutorial, TutorialStep } from './types';

/** One guided practice lock per kind (replayable from the lock's help card and from How to play). */
export const TUTORIALS: Record<PuzzleKind, Tutorial> = {
  runes: RUNES_TUTORIAL,
  tumblers: TUMBLERS_TUTORIAL,
  conduits: CONDUITS_TUTORIAL,
  wards: WARDS_TUTORIAL,
};

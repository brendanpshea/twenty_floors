import { generatePuzzle, isSolved, solve } from '../engine';
import type { Tutorial } from './types';

// PLACEHOLDER: a generated board and one step, until the guided lesson is written.
const instance = generatePuzzle({ kind: 'runes', seed: 1, difficulty: 1 });

export const RUNES_TUTORIAL: Tutorial = {
  kind: 'runes',
  title: 'Practice: ' + instance.title,
  instance,
  steps: [{ text: instance.instruction, goal: (s) => isSolved(s), show: solve(instance) }],
};

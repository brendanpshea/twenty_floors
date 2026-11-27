import type { TumblersInstance } from '../types';
import type { Tutorial } from './types';

/** Practice tumbler lock: 3 tumblers, 4 symbols, no repeats. The code is {2}{0}{3}. */
const instance: TumblersInstance = {
  kind: 'tumblers',
  seed: 0,
  difficulty: 1,
  title: 'Practice Tumbler Lock',
  instruction: 'Find the hidden sequence. No symbol appears twice.',
  parSeconds: 999,
  parMoves: 8,
  mistakeAllowance: 0,
  data: { length: 3, symbols: 4, repeats: false, maxGuesses: 8 },
  solution: [2, 0, 3],
};

const isGuess = (code: number[]) => (m: { type: string; code?: number[] }): boolean => m.type === 'guess' && JSON.stringify(m.code) === JSON.stringify(code);
const tries = (s: { kind: string; guesses?: unknown[] }): number => (s.kind === 'tumblers' ? (s.guesses?.length ?? 0) : 0);

export const TUMBLERS_TUTORIAL: Tutorial = {
  kind: 'tumblers',
  title: 'Practice: Tumbler Lock',
  instance,
  steps: [
    {
      text: 'This lock hides a row of 3 symbols, chosen from these 4. No symbol is used twice. You find the row by trying the lock and reading what it tells you.',
      spot: ['sym:0', 'sym:1', 'sym:2', 'sym:3'],
    },
    {
      text: 'Set the tumblers to {sym:0} {sym:1} {sym:2}: tap a tumbler, then a symbol. Then press Try the lock.',
      spot: ['slot:0', 'slot:1', 'slot:2', 'act:try'],
      allow: (m) => isGuess([0, 1, 2])(m),
      nudge: 'For this first try, set {sym:0} {sym:1} {sym:2}, in that order.',
      goal: (s) => tries(s) >= 1,
      show: [{ type: 'guess', code: [0, 1, 2] }],
      done: 'Two pale pips and no gold: two of these symbols are in the lock, but neither is in its right tumbler. The pips do not say which two.',
    },
    {
      text: 'Only one of the four symbols was left out of that try: {sym:3}. Two of the three you used are in, so the third symbol of the lock must be {sym:3}.',
    },
    {
      text: 'Now try {sym:2} {sym:3} {sym:0}: it uses {sym:3}, and moves {sym:0} and {sym:2} away from the tumblers where they were wrong.',
      spot: ['slot:0', 'slot:1', 'slot:2', 'act:try'],
      allow: (m) => isGuess([2, 3, 0])(m),
      nudge: 'Set {sym:2} {sym:3} {sym:0} for this try.',
      goal: (s) => tries(s) >= 2,
      show: [{ type: 'guess', code: [2, 3, 0] }],
      done: 'One gold pip and two pale: all three symbols are right now (so {sym:1} is not in the lock), and exactly one of them is in its right tumbler.',
    },
    {
      text: 'Put both tries together and only two rows fit: {sym:2} {sym:0} {sym:3} and {sym:3} {sym:2} {sym:0}. Try one. If the lock stays shut, the other is the answer.',
      spot: ['slot:0', 'slot:1', 'slot:2', 'act:try'],
      allow: (m) => isGuess([2, 0, 3])(m) || isGuess([3, 2, 0])(m),
      nudge: 'Only {sym:2} {sym:0} {sym:3} or {sym:3} {sym:2} {sym:0} fit what the lock told you.',
      goal: (s) => s.kind === 'tumblers' && s.solved,
      show: [{ type: 'guess', code: [2, 0, 3] }],
      done: 'Open! In a chest lock the clock runs and you have only a few tries: the fewer you need, the better the loot.',
    },
  ],
};

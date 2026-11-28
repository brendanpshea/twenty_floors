import type { PuzzleMove, PuzzleState, WardsInstance } from '../types';
import type { Tutorial } from './types';

/**
 * Practice ward lock: 5 x 4, 3 traps (cells 3, 7 and 9; * below). Six tiles start hidden (in brackets).
 *
 *   0  1 (2) (*) (2)
 *   0  1 (*) (3) (*)
 *   0  1  1   2   1
 *   0  0  0   0   0
 *
 * Solved by the two basic rules alone: the 1 at cell 11 touches only cell 7; the 1s at cells 6 and 12 are then
 * satisfied (cells 2 and 8 safe); the new 2 (cell 2) and the 1 at cell 14 then each leave one tile (3 and 9);
 * the 3 (cell 8) is then satisfied (cell 4 safe).
 */
const T = -1;
const instance: WardsInstance = {
  kind: 'wards',
  seed: 0,
  difficulty: 1,
  title: 'Practice Ward Lock',
  instruction: 'Each number counts the traps touching that tile. Open every safe tile and mark every trap.',
  parSeconds: 999,
  mistakeAllowance: 0,
  data: {
    w: 5,
    h: 4,
    mineCount: 3,
    clues: [0, 1, 2, T, 2, 0, 1, T, 3, T, 0, 1, 1, 2, 1, 0, 0, 0, 0, 0],
    start: [0, 1, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  },
  solution: [false, false, false, true, false, false, false, true, false, true, false, false, false, false, false, false, false, false, false, false],
};

const opens = (...cells: number[]) => (m: PuzzleMove): boolean => m.type === 'open' && cells.includes(m.cell);
const marks = (...cells: number[]) => (m: PuzzleMove): boolean => m.type === 'flag' && cells.includes(m.cell);
/** Cell statuses as in src/puzzles/types.ts: 1 open, 2 marked. */
const all = (status: number, ...cells: number[]) => (s: PuzzleState): boolean =>
  s.kind === 'wards' && cells.every((c) => s.cells[c] === status);

export const WARDS_TUTORIAL: Tutorial = {
  kind: 'wards',
  title: 'Practice: Ward Lock',
  instance,
  steps: [
    {
      text: 'Each number counts the traps among the eight tiles around it, corners included. This lit 1 touches two hidden tiles, so one of them is a trap, but it cannot say which. Never guess: look for a number that leaves no choice.',
      spot: ['cell:1', 'cell:2', 'cell:7'],
    },
    {
      text: 'This lit 1 touches only one hidden tile, so that tile must be its trap. Press Mark trap, then tap the hidden tile.',
      spot: ['cell:11', 'cell:7', 'act:mark'],
      allow: marks(7),
      nudge: 'Press Mark trap first, then tap the lit hidden tile. Opening a trap counts as a mistake.',
      goal: all(2, 7),
      show: [{ type: 'flag', cell: 7 }],
      done: 'Marked. Other numbers touch this trap too, and now they can tell you more.',
    },
    {
      text: 'These two 1s each touch the trap you marked, so each already has its one trap. Every other hidden tile around them is safe. Press Open, then open both lit tiles.',
      spot: ['cell:6', 'cell:12', 'cell:2', 'cell:8', 'act:open'],
      allow: opens(2, 8),
      nudge: 'Press Open first, then tap the two lit hidden tiles.',
      goal: all(1, 2, 8),
      show: [
        { type: 'open', cell: 2 },
        { type: 'open', cell: 8 },
      ],
      done: 'Both safe, and they show new numbers: a 2 at the top and a 3 below it.',
    },
    {
      text: 'The new 2 already touches one marked trap and has one hidden tile left, so that tile is its second trap. The 1 at the right end of the third row now touches only one hidden tile. Mark both.',
      spot: ['cell:3', 'cell:9', 'act:mark'],
      allow: marks(3, 9),
      nudge: 'Press Mark trap, then tap the two lit tiles.',
      goal: all(2, 3, 9),
      show: [
        { type: 'flag', cell: 3 },
        { type: 'flag', cell: 9 },
      ],
      done: 'That makes three marked traps, all this lock has.',
    },
    {
      text: 'The 3 now touches three marked traps, so it is satisfied: its last hidden tile is safe. Press Open and open it.',
      spot: ['cell:8', 'cell:4', 'act:open'],
      allow: opens(4),
      nudge: 'Press Open first, then tap the last hidden tile.',
      goal: (s) => s.kind === 'wards' && s.solved,
      show: [{ type: 'open', cell: 4 }],
      done: 'Open! A real Ward Lock is bigger and the clock runs. Opening a trap or marking a safe tile costs you, and every board can be solved without a single guess.',
    },
  ],
};

import type { PuzzleMove, PuzzleState, RunesInstance } from '../types';
import type { Tutorial } from './types';

/**
 * Practice rune lock: 4x4, four 2x2 blocks, 7 carved runes. Solution (rows):
 *   1 2 3 4
 *   3 4 1 2
 *   2 1 4 3
 *   4 3 2 1
 * The lesson fills cell 2 by its row, cell 12 by its column and cell 6 by its block; the other six tiles then each have
 * one rune left.
 */
const instance: RunesInstance = {
  kind: 'runes',
  seed: 0,
  difficulty: 1,
  title: 'Practice Rune Lock',
  instruction: 'Fill the grid so every rune appears once in each row, column and box.',
  parSeconds: 999,
  mistakeAllowance: 1,
  data: {
    n: 4,
    boxRows: 2,
    boxCols: 2,
    givens: [1, 2, 0, 4, 3, 0, 0, 2, 2, 0, 0, 0, 0, 3, 0, 0],
  },
  solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
};

const isPlace = (cell: number, value: number) => (m: PuzzleMove): boolean => m.type === 'place' && m.cell === cell && m.value === value;
const has = (cell: number, value: number) => (s: PuzzleState): boolean => s.kind === 'runes' && s.grid[cell] === value;
const right = (m: PuzzleMove): boolean => m.type === 'place' && m.value === instance.solution[m.cell];

export const RUNES_TUTORIAL: Tutorial = {
  kind: 'runes',
  title: 'Practice: Rune Lock',
  instance,
  steps: [
    {
      text: 'This lock is a grid of 16 tiles in four boxed blocks. Fill it with these 4 runes so that every row, every column and every block holds each rune exactly once. The runes already carved stay put.',
      spot: ['sym:1', 'sym:2', 'sym:3', 'sym:4'],
    },
    {
      text: 'Look at the top row: it already has {sym:1} {sym:2} and {sym:4}. Only {sym:3} is missing. Tap the empty tile in that row, then tap {sym:3}.',
      spot: ['cell:2', 'sym:3'],
      allow: (m) => isPlace(2, 3)(m),
      nudge: 'The top row is missing only {sym:3}: tap its empty tile, then {sym:3}.',
      goal: has(2, 3),
      show: [{ type: 'place', cell: 2, value: 3 }],
      done: 'Right. When you pick a tile, its row, column and block are shaded, so you can see which runes are already taken.',
    },
    {
      text: 'Now the left column: it has {sym:1} {sym:3} and {sym:2}. Which rune is missing? Carve it in the bottom-left tile.',
      spot: ['cell:12'],
      allow: (m) => isPlace(12, 4)(m),
      nudge: 'The left column already has {sym:1} {sym:3} {sym:2}. The bottom-left tile needs the one it lacks: {sym:4}.',
      goal: has(12, 4),
      show: [{ type: 'place', cell: 12, value: 4 }],
      done: 'Yes, {sym:4}. Its row only had {sym:3}, so the row alone could not tell you. The column could.',
    },
    {
      text: 'Blocks count too. The top-right block holds {sym:3} {sym:4} and {sym:2} already. Fill its last empty tile.',
      spot: ['cell:6'],
      allow: (m) => isPlace(6, 1)(m),
      nudge: 'The top-right block is missing only {sym:1}. Carve it in the block\'s empty tile.',
      goal: has(6, 1),
      show: [{ type: 'place', cell: 6, value: 1 }],
      done: 'Good. That tile\'s row and column left two runes open, {sym:1} and {sym:4}, but {sym:4} was already in the block.',
    },
    {
      text: 'Finish the grid the same way: pick an empty tile, check its row, column and block, and carve the one rune left. In a real lock, a rune that does not belong adds one to the Mistakes count, even if you erase it.',
      spot: ['cell:5', 'cell:9', 'cell:10', 'cell:11', 'cell:14', 'cell:15'],
      allow: (m) => right(m),
      nudge: 'That rune does not belong there: in a real lock it would count as a mistake. Check the tile\'s row, column and block again.',
      goal: (s) => s.solved,
      show: [
        { type: 'place', cell: 5, value: 4 },
        { type: 'place', cell: 9, value: 1 },
        { type: 'place', cell: 10, value: 4 },
        { type: 'place', cell: 11, value: 3 },
        { type: 'place', cell: 14, value: 2 },
        { type: 'place', cell: 15, value: 1 },
      ],
      done: 'Open! A real rune lock is timed and often larger: start with the tiles that have one rune left, and every rune you carve makes the next one easier.',
    },
  ],
};

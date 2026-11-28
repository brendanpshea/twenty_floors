import type { ConduitsInstance, ConduitsMove, PuzzleMove, PuzzleState } from '../types';
import type { Tutorial } from './types';

/**
 * Practice conduit lock: 3x3, no wrapping. Cells 0..8 row by row; masks N=1 E=2 S=4 W=8.
 * The answer is one path from the source in the middle: 4 → 3 → 6 → 7 → 8 → 5 → 2 → 1 → 0.
 *
 *   start                    answer
 *   end(N)   straight|  elbow(E,S)    end(E)   straight-  elbow(S,W)
 *   elbow(E,S) SOURCE(W) PINNED|      elbow(E,S) SOURCE(W) PINNED|
 *   elbow(W,N) straight| elbow(S,W)   elbow(N,E) straight-  elbow(N,W)
 *
 * Six tiles start wrong, each one clockwise tap from right: 6 taps in all, and the answer is the only one.
 */
const instance: ConduitsInstance = {
  kind: 'conduits',
  seed: 0,
  difficulty: 1,
  title: 'Practice Conduit Lock',
  instruction: 'Turn the tiles until every pipe joins one network from the source, with no loose ends.',
  parSeconds: 999,
  parMoves: 6,
  mistakeAllowance: 0,
  data: {
    w: 3,
    h: 3,
    wrap: false,
    source: 4,
    tiles: [1, 5, 6, 6, 8, 5, 9, 5, 12],
    locked: [false, false, false, false, false, true, false, false, false],
  },
  solution: [2, 10, 12, 6, 8, 5, 3, 10, 9],
};

const tile = (s: PuzzleState, i: number): number => (s.kind === 'conduits' ? (s.tiles[i] as number) : -1);
const placed = (s: PuzzleState, i: number): boolean => tile(s, i) === instance.solution[i];
/** A turn of one of these cells, while that cell is still wrong (turning a right tile only costs taps). */
const turnsWrong =
  (...cells: number[]) =>
  (m: PuzzleMove, s: PuzzleState): boolean =>
    // A plain tap (a quarter turn clockwise): every fix in this lesson is one tap, so a backwards turn is refused too.
    m.type === 'rotate' && (m.dir ?? 1) === 1 && cells.includes(m.cell) && !placed(s, m.cell);
const tap = (cell: number): ConduitsMove => ({ type: 'rotate', cell, dir: 1 });

export const CONDUITS_TUTORIAL: Tutorial = {
  kind: 'conduits',
  title: 'Practice: Conduit Lock',
  instance,
  steps: [
    {
      text: 'The ringed tile in the middle is the source. Pipes joined to it glow. The tile with studs in its corners is pinned and cannot turn. Red marks show loose ends: pipes that meet a wall or a closed side.',
      spot: ['cell:4', 'cell:5'],
    },
    {
      text: 'Tap the bottom-left corner to turn it a quarter clockwise. Its bend points out of the board. In a corner a bend fits only one way: pointing into the board.',
      spot: ['cell:6'],
      allow: turnsWrong(6),
      nudge: 'Start with the bottom-left corner: a corner bend has only one way to fit.',
      goal: (s) => placed(s, 6),
      show: [tap(6)],
      done: 'One tap: it points up and right, into the board. Its red mark stays until the pipe on its right turns to meet it. Four taps bring a tile back where it began, so look first and tap only as often as you need.',
    },
    {
      text: 'Both right-hand corners are bends too. Give each the one turn that points it into the board.',
      spot: ['cell:2', 'cell:8'],
      allow: turnsWrong(2, 8),
      nudge: 'Turn the top-right and bottom-right corners. The other tiles can wait.',
      goal: (s) => placed(s, 2) && placed(s, 8),
      show: [tap(2), tap(8)],
      done: 'Both fit, and the pinned pipe between them meets them top and bottom. They do not glow yet: nothing joins them to the source.',
    },
    {
      text: 'A straight pipe on an edge must lie along the edge, or one end points off the board. Lay the bottom and top straights flat.',
      spot: ['cell:7', 'cell:1'],
      allow: turnsWrong(7, 1),
      nudge: 'Turn the straight pipes in the middle of the top and bottom rows.',
      goal: (s) => placed(s, 7) && placed(s, 1),
      show: [tap(7), tap(1)],
      done: 'The glow runs along the bottom, up the right side and across the top. Corners and edges first: there, few turns fit.',
    },
    {
      text: 'One tile left: a dead end in the top-left corner. It could point right or down without leaving the board. The pipe beside it points left, at it, and the tile below is closed on top. Which way?',
      spot: ['cell:0'],
      allow: turnsWrong(0),
      nudge: 'Turn the top-left corner tile so it meets the pipe beside it.',
      goal: (s) => s.kind === 'conduits' && s.solved,
      show: [tap(0)],
      done: 'Open! Every tile is joined and no end is loose. In a chest lock the clock runs and every tap counts: the fewer taps, the better the loot.',
    },
  ],
};

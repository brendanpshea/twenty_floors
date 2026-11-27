import type { PuzzleKind } from './types';

export interface Explainer {
  title: string;
  /** Exactly three short lines. */
  lines: [string, string, string];
}

export const EXPLAINERS: Record<PuzzleKind, Explainer> = {
  runes: {
    title: 'How a Rune Lock works',
    lines: [
      'Tap an empty tile, then tap a rune to carve it there.',
      'Each row, column and boxed block must hold every rune exactly once.',
      'Start from tiles that have only one rune left that fits.',
    ],
  },
  tumblers: {
    title: 'How a Tumbler Lock works',
    lines: [
      'Set each tumbler to a symbol, then press Try the lock.',
      'A gold pip means right symbol, right place; a pale pip means right symbol, wrong place.',
      'Use every try to rule out symbols; you only have a few.',
    ],
  },
  conduits: {
    title: 'How a Conduit Lock works',
    lines: [
      'Tap a tile to turn it a quarter. Pinned tiles cannot be turned.',
      'Join every pipe into one network that reaches back to the source.',
      'No pipe may be left open at the end, and edges may wrap if marked.',
    ],
  },
  wards: {
    title: 'How a Ward Lock works',
    lines: [
      'A number counts the traps among the eight tiles around it.',
      'Open the tiles you know are safe; mark the ones you know are trapped.',
      'Every board can be solved by logic alone, so never guess.',
    ],
  },
};

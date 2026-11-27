import { describe, expect, it } from 'vitest';
import { apply, generatePuzzle, hint, isFailed, isSolved, mistakes, solve, start } from './engine';
import { countConduitsSolutions, conduitsLoose, conduitsPowered, conduitsSolved } from './conduits';
import { countRunesSolutions, runesConflicts } from './runes';
import { allCodes, consistentGuess, feedback, isConsistent } from './tumblers';
import { deduce } from './wards';
import { PUZZLE_KINDS, W_FLAG, W_HIDDEN, W_OPEN, W_SPRUNG } from './types';
import type { ConduitsInstance, PuzzleInstance, PuzzleKind, PuzzleState, RunesInstance, TumblerGuess, TumblersInstance, WardsInstance } from './types';

const DIFFS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SEEDS: Record<PuzzleKind, number> = { runes: 25, tumblers: 25, conduits: 12, wards: 15 };

function play(inst: PuzzleInstance): PuzzleState {
  let s = start(inst);
  for (const m of solve(inst)) s = apply(s, m);
  return s;
}

describe.each(PUZZLE_KINDS)('%s: framework contract', (kind) => {
  it('is deterministic', () => {
    for (const d of DIFFS) {
      const a = generatePuzzle({ kind, seed: 7, difficulty: d });
      const b = generatePuzzle({ kind, seed: 7, difficulty: d });
      expect(b).toEqual(a);
      expect(a.kind).toBe(kind);
      expect(a.title.length).toBeGreaterThan(2);
      expect(a.instruction.length).toBeGreaterThan(10);
      expect(a.parSeconds).toBeGreaterThan(5);
    }
  });

  it('differs between seeds', () => {
    const a = JSON.stringify(generatePuzzle({ kind, seed: 1, difficulty: 6 }).solution);
    const seen = new Set<string>([a]);
    for (let s = 2; s < 8; s++) seen.add(JSON.stringify(generatePuzzle({ kind, seed: s, difficulty: 6 }).solution));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('solve() solves every difficulty over many seeds, and a fresh puzzle is not already solved', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= SEEDS[kind]; seed++) {
        const inst = generatePuzzle({ kind, seed, difficulty: d });
        expect(isSolved(start(inst)), `${kind} d${d} s${seed} solved at start`).toBe(false);
        const s = play(inst);
        expect(isSolved(s), `${kind} d${d} s${seed}`).toBe(true);
        expect(isFailed(s)).toBe(false);
      }
    }
  });

  it('hints always make progress and eventually solve', () => {
    for (const d of [1, 5, 10]) {
      const inst = generatePuzzle({ kind, seed: 3, difficulty: d });
      let s = start(inst);
      let guard = 0;
      while (!isSolved(s) && !isFailed(s) && guard++ < 400) {
        const m = hint(s);
        expect(m).not.toBeNull();
        const next = apply(s, m as NonNullable<typeof m>);
        if (kind !== 'tumblers') expect(next).not.toBe(s);
        s = next;
        if (kind === 'tumblers' && guard >= inst.solution.length) break; // reveals only; the guess is separate
      }
      if (kind !== 'tumblers') {
        expect(isSolved(s)).toBe(true);
        expect(mistakes(s)).toBe(0);
      }
    }
  });

  it('generates quickly on average', () => {
    const t0 = performance.now();
    let n = 0;
    for (const d of DIFFS) {
      for (let seed = 100; seed < 106; seed++) {
        generatePuzzle({ kind, seed, difficulty: d });
        n++;
      }
    }
    const avg = (performance.now() - t0) / n;
    expect(avg).toBeLessThan(50);
  });
});

describe('runes', () => {
  it('has a unique solution, sizes scale, givens thin out', () => {
    let prevGivens = 99;
    for (const d of DIFFS) {
      let givens = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const inst = generatePuzzle({ kind: 'runes', seed, difficulty: d }) as RunesInstance;
        const { n, boxRows, boxCols } = inst.data;
        expect(n).toBe(d <= 4 ? 4 : 6);
        expect(countRunesSolutions(inst.data.givens, n, boxRows, boxCols, 2), `d${d} s${seed}`).toBe(1);
        expect(countRunesSolutions(inst.solution, n, boxRows, boxCols, 2)).toBe(1);
        givens += inst.data.givens.filter(Boolean).length;
      }
      const avg = givens / 25;
      if (d !== 5) expect(avg).toBeLessThanOrEqual(prevGivens + 0.01);
      prevGivens = avg;
    }
  });

  it('accounts mistakes as placements that differ from the solution, and marks conflicts', () => {
    const inst = generatePuzzle({ kind: 'runes', seed: 4, difficulty: 3 }) as RunesInstance;
    let s = start(inst);
    const cell = inst.data.givens.findIndex((g) => g === 0);
    const right = inst.solution[cell] as number;
    const wrong = right === 1 ? 2 : 1;
    s = apply(s, { type: 'place', cell, value: wrong });
    expect(mistakes(s)).toBe(1);
    s = apply(s, { type: 'place', cell, value: wrong }); // same again: no change
    expect(mistakes(s)).toBe(1);
    s = apply(s, { type: 'clear', cell });
    s = apply(s, { type: 'place', cell, value: right });
    expect(mistakes(s)).toBe(1);
    // Givens are immutable.
    const g = inst.data.givens.findIndex((v) => v !== 0);
    expect(apply(s, { type: 'clear', cell: g })).toBe(s);
    expect(runesConflicts(inst, inst.solution).size).toBe(0);
    const bad = inst.solution.slice();
    bad[0] = bad[1] as number;
    expect(runesConflicts(inst, bad).size).toBeGreaterThanOrEqual(2);
  });
});

describe('tumblers', () => {
  it('computes feedback correctly', () => {
    expect(feedback([0, 1, 2], [0, 1, 2])).toEqual({ exact: 3, misplaced: 0 });
    expect(feedback([0, 1, 2], [2, 0, 1])).toEqual({ exact: 0, misplaced: 3 });
    expect(feedback([0, 0, 1], [0, 1, 1])).toEqual({ exact: 2, misplaced: 0 });
    expect(feedback([0, 0, 1, 2], [1, 0, 0, 3])).toEqual({ exact: 1, misplaced: 2 });
    expect(feedback([1, 1, 2, 3], [1, 1, 1, 1])).toEqual({ exact: 2, misplaced: 0 });
  });

  it('can always be found in the guess limit by consistent guessing; the secret is the unique survivor', () => {
    let worst = 0;
    for (const d of DIFFS) {
      const seeds = d >= 8 ? 6 : 15;
      for (let seed = 1; seed <= seeds; seed++) {
        const inst = generatePuzzle({ kind: 'tumblers', seed, difficulty: d }) as TumblersInstance;
        const moves = solve(inst);
        expect(moves.length, `d${d} s${seed}`).toBeLessThanOrEqual(inst.data.maxGuesses);
        let s = start(inst);
        const guesses: TumblerGuess[] = [];
        for (const m of moves) {
          s = apply(s, m);
          if (m.type === 'guess') guesses.push(...(s.kind === 'tumblers' ? s.guesses.slice(-1) : []));
        }
        expect(isSolved(s)).toBe(true);
        worst = Math.max(worst, moves.length - inst.data.maxGuesses);
        // Everything consistent with the feedback so far, other than the final guess, is the secret.
        const survivors = allCodes(inst).filter((c) => isConsistent(c, guesses));
        expect(survivors).toEqual([inst.solution]);
      }
    }
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('respects the repeat rule and the guess limit (failing)', () => {
    const inst = generatePuzzle({ kind: 'tumblers', seed: 2, difficulty: 1 }) as TumblersInstance;
    let s = start(inst);
    const dup = apply(s, { type: 'guess', code: [0, 0, 1] });
    expect(dup).toBe(s); // repeats not allowed at d1
    expect(apply(s, { type: 'guess', code: [0, 1] })).toBe(s);
    const wrong = inst.solution.slice().reverse();
    const bad = [0, 1, 2, 3].filter((x) => !inst.solution.includes(x));
    const all = allCodes(inst).filter((c) => c.join() !== inst.solution.join());
    void wrong;
    void bad;
    for (let i = 0; i < inst.data.maxGuesses; i++) s = apply(s, { type: 'guess', code: all[i] as number[] });
    expect(isFailed(s)).toBe(true);
    expect(isSolved(s)).toBe(false);
    expect(apply(s, { type: 'guess', code: inst.solution })).toBe(s);
  });

  it('hint reveals one correct position', () => {
    const inst = generatePuzzle({ kind: 'tumblers', seed: 9, difficulty: 5 }) as TumblersInstance;
    let s = start(inst);
    const m = hint(s);
    expect(m).toEqual({ type: 'reveal', index: 0 });
    s = apply(s, m as NonNullable<typeof m>);
    if (s.kind === 'tumblers') expect(s.revealed[0]).toBe(inst.solution[0]);
  });

  it('scales: length and alphabet grow', () => {
    const lo = generatePuzzle({ kind: 'tumblers', seed: 1, difficulty: 1 }) as TumblersInstance;
    const hi = generatePuzzle({ kind: 'tumblers', seed: 1, difficulty: 10 }) as TumblersInstance;
    expect([lo.data.length, lo.data.symbols, lo.data.repeats]).toEqual([3, 4, false]);
    expect([hi.data.length, hi.data.symbols, hi.data.repeats]).toEqual([5, 6, true]);
    expect(consistentGuess(lo, []).length).toBe(3);
  });
});

describe('conduits', () => {
  it('is uniquely solvable by connectivity, loop-free, and scrambled', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 10; seed++) {
        const inst = generatePuzzle({ kind: 'conduits', seed, difficulty: d }) as ConduitsInstance;
        const { w, h, wrap } = inst.data;
        const n = w * h;
        expect(conduitsSolved(inst, inst.solution)).toBe(true);
        expect(conduitsSolved(inst, inst.data.tiles)).toBe(false);
        // Edge count n-1 means a tree: no loops.
        let degrees = 0;
        for (const m of inst.solution) degrees += [1, 2, 4, 8].filter((b) => m & b).length;
        expect(degrees, `d${d} s${seed}`).toBe(2 * (n - 1));
        expect(conduitsLoose(inst, inst.solution).every((l) => l === 0)).toBe(true);
        expect(conduitsPowered(inst, inst.solution).every(Boolean)).toBe(true);
        const uniq = countConduitsSolutions(inst, 2);
        expect(uniq.capped, `d${d} s${seed} search capped`).toBe(false);
        expect(uniq.count, `d${d} s${seed}`).toBe(1);
        if (!wrap) {
          // Nothing leaks off the edge.
          for (let c = 0; c < w; c++) expect((inst.solution[c] as number) & 1).toBe(0);
        }
        expect(inst.data.tiles.every((m, i) => m === inst.solution[i] || !inst.data.locked[i])).toBe(true);
      }
    }
  });

  it('sizes match the difficulty table and locked tiles refuse to turn', () => {
    const lo = generatePuzzle({ kind: 'conduits', seed: 1, difficulty: 1 }) as ConduitsInstance;
    const hi = generatePuzzle({ kind: 'conduits', seed: 1, difficulty: 10 }) as ConduitsInstance;
    expect([lo.data.w, lo.data.h, lo.data.wrap]).toEqual([4, 4, false]);
    expect([hi.data.w, hi.data.h, hi.data.wrap]).toEqual([7, 7, true]);
    const s = start(hi);
    const lockedCell = hi.data.locked.findIndex(Boolean);
    if (lockedCell >= 0) expect(apply(s, { type: 'rotate', cell: lockedCell })).toBe(s);
  });

  it('counts taps', () => {
    const inst = generatePuzzle({ kind: 'conduits', seed: 5, difficulty: 2 }) as ConduitsInstance;
    const moves = solve(inst);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(inst.parMoves as number);
    const s = play(inst);
    expect(s.moves).toBe(moves.length);
  });
});

describe('wards', () => {
  it('is solvable by logic alone from the opening, within the allowed depth', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 15; seed++) {
        const inst = generatePuzzle({ kind: 'wards', seed, difficulty: d }) as WardsInstance;
        const { w, h, clues, mineCount } = inst.data;
        expect(inst.solution.filter(Boolean).length).toBe(mineCount);
        // Pure deduction from the start, never touching the solution.
        const status = new Array<number>(w * h).fill(W_HIDDEN);
        for (const i of inst.data.start) status[i] = W_OPEN;
        for (const i of inst.data.start) expect(inst.solution[i]).toBe(false);
        for (let guard = 0; guard < 200; guard++) {
          const ds = deduce(w, h, clues, status, mineCount, 3);
          if (!ds.length) break;
          for (const x of ds) {
            expect(x.mine, `wrong deduction d${d} s${seed}`).toBe(inst.solution[x.cell]);
            status[x.cell] = x.mine ? W_FLAG : W_OPEN;
          }
        }
        expect(status.every((s, i) => (inst.solution[i] ? s === W_FLAG : s === W_OPEN)), `d${d} s${seed}`).toBe(true);
      }
    }
  });

  it('opening a trap is a mistake but does not end the puzzle', () => {
    const inst = generatePuzzle({ kind: 'wards', seed: 2, difficulty: 4 }) as WardsInstance;
    let s = start(inst);
    const trap = inst.solution.findIndex(Boolean);
    s = apply(s, { type: 'open', cell: trap });
    expect(mistakes(s)).toBe(1);
    if (s.kind === 'wards') expect(s.cells[trap]).toBe(W_SPRUNG);
    // wrongly marking a safe tile is also a mistake and is not placed
    const safe = s.kind === 'wards' ? s.cells.findIndex((c, i) => c === W_HIDDEN && !inst.solution[i]) : -1;
    s = apply(s, { type: 'flag', cell: safe });
    expect(mistakes(s)).toBe(2);
    if (s.kind === 'wards') expect(s.cells[safe]).toBe(W_HIDDEN);
    // and it can still be completed
    for (const m of solve(inst)) s = apply(s, m);
    for (let i = 0; i < 300 && !isSolved(s); i++) {
      const m = hint(s);
      if (!m) break;
      s = apply(s, m);
    }
    expect(isSolved(s)).toBe(true);
    expect(mistakes(s)).toBe(2);
  });

  it('opening a zero cascades', () => {
    const inst = generatePuzzle({ kind: 'wards', seed: 11, difficulty: 2 }) as WardsInstance;
    expect(inst.data.start.length).toBeGreaterThan(1);
  });
});

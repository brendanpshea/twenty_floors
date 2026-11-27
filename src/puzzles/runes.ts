import { Rng } from '../core/rng';
import type { RunesInstance, RunesMove, RunesState } from './types';

interface Layout {
  n: number;
  boxRows: number;
  boxCols: number;
  target: number;
  level: 1 | 2;
}

const LAYOUTS: Layout[] = [
  { n: 4, boxRows: 2, boxCols: 2, target: 10, level: 1 },
  { n: 4, boxRows: 2, boxCols: 2, target: 9, level: 1 },
  { n: 4, boxRows: 2, boxCols: 2, target: 8, level: 2 },
  { n: 4, boxRows: 2, boxCols: 2, target: 6, level: 2 },
  { n: 6, boxRows: 2, boxCols: 3, target: 22, level: 1 },
  { n: 6, boxRows: 2, boxCols: 3, target: 20, level: 2 },
  { n: 6, boxRows: 2, boxCols: 3, target: 18, level: 2 },
  { n: 6, boxRows: 2, boxCols: 3, target: 16, level: 2 },
  { n: 6, boxRows: 2, boxCols: 3, target: 15, level: 2 },
  { n: 6, boxRows: 2, boxCols: 3, target: 14, level: 2 },
];

export function runesLayout(difficulty: number): Layout {
  return LAYOUTS[Math.max(1, Math.min(10, difficulty)) - 1] as Layout;
}

/** Cell index lists for every row, column and box. */
export function runesUnits(n: number, boxRows: number, boxCols: number): number[][] {
  const units: number[][] = [];
  for (let r = 0; r < n; r++) units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) units.push(Array.from({ length: n }, (_, r) => r * n + c));
  for (let br = 0; br < n; br += boxRows) {
    for (let bc = 0; bc < n; bc += boxCols) {
      const u: number[] = [];
      for (let r = 0; r < boxRows; r++) for (let c = 0; c < boxCols; c++) u.push((br + r) * n + bc + c);
      units.push(u);
    }
  }
  return units;
}

/** Peers (cells sharing a unit) of every cell. */
function peersOf(n: number, boxRows: number, boxCols: number): number[][] {
  const peers: Set<number>[] = Array.from({ length: n * n }, () => new Set<number>());
  for (const u of runesUnits(n, boxRows, boxCols)) {
    for (const a of u) for (const b of u) if (a !== b) peers[a]?.add(b);
  }
  return peers.map((s) => [...s]);
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Cells whose rune clashes with a peer (for the view's subtle conflict marks). */
export function runesConflicts(inst: RunesInstance, grid: readonly number[]): Set<number> {
  const { n, boxRows, boxCols } = inst.data;
  const out = new Set<number>();
  for (const u of runesUnits(n, boxRows, boxCols)) {
    const seen = new Map<number, number>();
    for (const c of u) {
      const v = grid[c] ?? 0;
      if (!v) continue;
      const prev = seen.get(v);
      if (prev !== undefined) {
        out.add(prev);
        out.add(c);
      } else seen.set(v, c);
    }
  }
  return out;
}

/**
 * Solve using only singles. level 1: naked singles; level 2: + hidden singles.
 * Returns the completed grid or null if stuck. Sound, so a result implies uniqueness.
 */
export function solveByTechniques(
  givens: readonly number[],
  n: number,
  boxRows: number,
  boxCols: number,
  level: 1 | 2,
): number[] | null {
  const units = runesUnits(n, boxRows, boxCols);
  const peers = peersOf(n, boxRows, boxCols);
  const full = (1 << n) - 1;
  const grid = givens.slice();
  const cand = new Array<number>(n * n).fill(full);
  const place = (cell: number, v: number): boolean => {
    grid[cell] = v;
    cand[cell] = 1 << (v - 1);
    for (const p of peers[cell] as number[]) {
      if ((cand[p] as number) & (1 << (v - 1))) {
        cand[p] = (cand[p] as number) & ~(1 << (v - 1));
        if (cand[p] === 0) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] as number;
    if (v) {
      grid[i] = 0;
      if (!place(i, v)) return null;
    }
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 0 && popcount(cand[i] as number) === 1) {
        place(i, Math.log2(cand[i] as number) + 1);
        progress = true;
      }
    }
    if (level >= 2) {
      for (const u of units) {
        for (let v = 1; v <= n; v++) {
          const bit = 1 << (v - 1);
          let spot = -1;
          let count = 0;
          let already = false;
          for (const c of u) {
            if (grid[c] === v) already = true;
            else if (grid[c] === 0 && (cand[c] as number) & bit) {
              count++;
              spot = c;
            }
          }
          if (!already && count === 1) {
            place(spot, v);
            progress = true;
          }
        }
      }
    }
  }
  return grid.every((v) => v > 0) ? grid : null;
}

/** Plain backtracking solution counter (tests and verification). */
export function countRunesSolutions(
  givens: readonly number[],
  n: number,
  boxRows: number,
  boxCols: number,
  limit = 2,
): number {
  const peers = peersOf(n, boxRows, boxCols);
  const grid = givens.slice();
  let count = 0;
  const options = (cell: number): number[] => {
    const used = new Set<number>();
    for (const p of peers[cell] as number[]) used.add(grid[p] as number);
    const out: number[] = [];
    for (let v = 1; v <= n; v++) if (!used.has(v)) out.push(v);
    return out;
  };
  const rec = (): void => {
    if (count >= limit) return;
    let best = -1;
    let bestOpts: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== 0) continue;
      const o = options(i);
      if (best < 0 || o.length < bestOpts.length) {
        best = i;
        bestOpts = o;
        if (o.length === 0) return;
      }
    }
    if (best < 0) {
      count++;
      return;
    }
    for (const v of bestOpts) {
      grid[best] = v;
      rec();
      grid[best] = 0;
    }
  };
  // Reject contradictory givens.
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] as number;
    if (v && (peers[i] as number[]).some((p) => grid[p] === v)) return 0;
  }
  rec();
  return count;
}

function fillGrid(rng: Rng, n: number, boxRows: number, boxCols: number): number[] {
  const peers = peersOf(n, boxRows, boxCols);
  const grid = new Array<number>(n * n).fill(0);
  const rec = (i: number): boolean => {
    if (i === grid.length) return true;
    const used = new Set<number>();
    for (const p of peers[i] as number[]) used.add(grid[p] as number);
    const vals: number[] = [];
    for (let v = 1; v <= n; v++) if (!used.has(v)) vals.push(v);
    rng.shuffle(vals);
    for (const v of vals) {
      grid[i] = v;
      if (rec(i + 1)) return true;
    }
    grid[i] = 0;
    return false;
  };
  rec(0);
  return grid;
}

export function generateRunes(seed: number, difficulty: number, rng: Rng): RunesInstance {
  const lay = runesLayout(difficulty);
  const { n, boxRows, boxCols } = lay;
  const solution = fillGrid(rng, n, boxRows, boxCols);
  const givens = solution.slice();
  let count = givens.length;
  const order = rng.shuffle(Array.from({ length: n * n }, (_, i) => i));
  for (const cell of order) {
    if (count <= lay.target) break;
    const keep = givens[cell] as number;
    givens[cell] = 0;
    if (solveByTechniques(givens, n, boxRows, boxCols, lay.level)) count--;
    else givens[cell] = keep;
  }
  const empties = n * n - count;
  return {
    kind: 'runes',
    seed,
    difficulty,
    title: 'Rune Lock',
    instruction: 'Fill the grid so every rune appears once in each row, column and box.',
    parSeconds: Math.round(empties * 3 + 6),
    mistakeAllowance: 1,
    data: { n, boxRows, boxCols, givens },
    solution,
  };
}

export function startRunes(inst: RunesInstance): RunesState {
  return { kind: 'runes', inst, grid: inst.data.givens.slice(), mistakes: 0, moves: 0, solved: false };
}

export function applyRunes(state: RunesState, move: RunesMove): RunesState {
  const { inst } = state;
  if (state.solved) return state;
  const cell = move.cell;
  if (cell < 0 || cell >= state.grid.length || inst.data.givens[cell] !== 0) return state;
  const cur = state.grid[cell] as number;
  let value = 0;
  if (move.type === 'place') {
    value = move.value;
    if (value < 1 || value > inst.data.n) return state;
  }
  if (value === cur) return state;
  const grid = state.grid.slice();
  grid[cell] = value;
  const wrong = value !== 0 && value !== inst.solution[cell];
  const next: RunesState = {
    ...state,
    grid,
    moves: state.moves + 1,
    mistakes: state.mistakes + (wrong ? 1 : 0),
    solved: false,
  };
  next.solved = grid.every((v, i) => v === inst.solution[i]);
  return next;
}

export function hintRunes(state: RunesState): RunesMove | null {
  const { inst, grid } = state;
  const { n, boxRows, boxCols } = inst.data;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 0 && grid[i] !== inst.solution[i]) return { type: 'place', cell: i, value: inst.solution[i] as number };
  }
  const peers = peersOf(n, boxRows, boxCols);
  let best = -1;
  let bestCount = 99;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 0) continue;
    const used = new Set<number>();
    for (const p of peers[i] as number[]) used.add(grid[p] as number);
    const c = n - [...used].filter((v) => v > 0).length;
    if (c < bestCount) {
      best = i;
      bestCount = c;
    }
  }
  if (best < 0) return null;
  return { type: 'place', cell: best, value: inst.solution[best] as number };
}

export function solveRunes(inst: RunesInstance): RunesMove[] {
  const moves: RunesMove[] = [];
  inst.data.givens.forEach((g, cell) => {
    if (g === 0) moves.push({ type: 'place', cell, value: inst.solution[cell] as number });
  });
  return moves;
}

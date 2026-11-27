import { Rng } from '../core/rng';
import { W_FLAG, W_HIDDEN, W_OPEN, W_SPRUNG } from './types';
import type { WardsInstance, WardsMove, WardsState } from './types';

interface Cfg {
  w: number;
  h: number;
  mines: number;
  /** Highest deduction level the generator allows the solver. */
  allowed: 1 | 2 | 3;
  /** Level the board should actually need (best effort). */
  need: 1 | 2 | 3;
}

const CONFIGS: Cfg[] = [
  { w: 5, h: 5, mines: 3, allowed: 1, need: 1 },
  { w: 5, h: 5, mines: 4, allowed: 1, need: 1 },
  { w: 6, h: 5, mines: 5, allowed: 1, need: 1 },
  { w: 6, h: 6, mines: 6, allowed: 2, need: 1 },
  { w: 6, h: 6, mines: 7, allowed: 2, need: 2 },
  { w: 7, h: 6, mines: 8, allowed: 2, need: 2 },
  { w: 7, h: 7, mines: 9, allowed: 3, need: 2 },
  { w: 7, h: 7, mines: 11, allowed: 3, need: 2 },
  { w: 8, h: 8, mines: 12, allowed: 3, need: 3 },
  { w: 8, h: 8, mines: 14, allowed: 3, need: 3 },
];

export function wardsConfig(difficulty: number): Cfg {
  return CONFIGS[Math.max(1, Math.min(10, difficulty)) - 1] as Cfg;
}

const nbrCache = new Map<string, number[][]>();
export function wardNeighbours(w: number, h: number): number[][] {
  const key = `${w}x${h}`;
  let out = nbrCache.get(key);
  if (!out) {
    out = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const list: number[] = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < h && cc >= 0 && cc < w) list.push(rr * w + cc);
          }
        }
        out.push(list);
      }
    }
    nbrCache.set(key, out);
  }
  return out;
}

export interface Deduction {
  cell: number;
  mine: boolean;
  level: 1 | 2 | 3;
}

const isFlag = (s: number): boolean => s === W_FLAG || s === W_SPRUNG;

interface Constraint {
  hidden: number[];
  need: number;
}

function constraintsOf(w: number, h: number, clues: readonly number[], status: readonly number[]): Constraint[] {
  const nb = wardNeighbours(w, h);
  const out: Constraint[] = [];
  for (let i = 0; i < w * h; i++) {
    if (status[i] !== W_OPEN) continue;
    const hidden: number[] = [];
    let flags = 0;
    for (const j of nb[i] as number[]) {
      const s = status[j] as number;
      if (s === W_HIDDEN) hidden.push(j);
      else if (isFlag(s)) flags++;
    }
    if (hidden.length) out.push({ hidden, need: (clues[i] as number) - flags });
  }
  return out;
}

function enumerate(cons: Constraint[], mineCount: number, status: readonly number[]): Deduction[] {
  const frontier = [...new Set(cons.flatMap((c) => c.hidden))].sort((a, b) => a - b);
  const idx = new Map<number, number>();
  frontier.forEach((cell, k) => idx.set(cell, k));
  const byVar: number[][] = frontier.map(() => []);
  cons.forEach((c, ci) => c.hidden.forEach((cell) => (byVar[idx.get(cell) as number] as number[]).push(ci)));
  const mines = new Array<number>(cons.length).fill(0);
  const left = cons.map((c) => c.hidden.length);
  const assign = new Array<number>(frontier.length).fill(0);
  const mineIn = new Array<number>(frontier.length).fill(0);
  let total = 0;
  let nodes = 0;
  let capped = false;
  let flagged = 0;
  let hiddenTotal = 0;
  for (const s of status) {
    if (isFlag(s)) flagged++;
    else if (s === W_HIDDEN) hiddenTotal++;
  }
  const remaining = mineCount - flagged;
  const nonFrontier = hiddenTotal - frontier.length;
  const rec = (k: number, placed: number): void => {
    if (capped) return;
    if (++nodes > 60000) {
      capped = true;
      return;
    }
    if (k === frontier.length) {
      // Mines left must fit among non-frontier hidden cells.
      const rest = remaining - placed;
      if (rest < 0 || rest > nonFrontier) return;
      total++;
      for (let i = 0; i < k; i++) if (assign[i]) mineIn[i] = (mineIn[i] as number) + 1;
      return;
    }
    for (const v of [0, 1]) {
      let ok = true;
      for (const ci of byVar[k] as number[]) {
        mines[ci] = (mines[ci] as number) + v;
        left[ci] = (left[ci] as number) - 1;
      }
      for (const ci of byVar[k] as number[]) {
        const m = mines[ci] as number;
        const need = (cons[ci] as Constraint).need;
        if (m > need || m + (left[ci] as number) < need) ok = false;
      }
      if (ok) {
        assign[k] = v;
        rec(k + 1, placed + v);
      }
      for (const ci of byVar[k] as number[]) {
        mines[ci] = (mines[ci] as number) - v;
        left[ci] = (left[ci] as number) + 1;
      }
    }
  };
  rec(0, 0);
  if (capped || total === 0) return [];
  const out: Deduction[] = [];
  frontier.forEach((cell, k) => {
    if (mineIn[k] === 0) out.push({ cell, mine: false, level: 3 });
    else if (mineIn[k] === total) out.push({ cell, mine: true, level: 3 });
  });
  return out;
}

/**
 * Deductions available now, from the cheapest technique that yields any.
 * Level 1: a clue already satisfied / fully accounted for.
 * Level 2: one clue's unknowns contained in another's (subset rule).
 * Level 3: exhaustive reasoning over the whole frontier, plus the trap total.
 */
export function deduce(
  w: number,
  h: number,
  clues: readonly number[],
  status: readonly number[],
  mineCount: number,
  maxLevel: 1 | 2 | 3 = 3,
): Deduction[] {
  const cons = constraintsOf(w, h, clues, status);
  const found = new Map<number, Deduction>();
  const add = (cell: number, mine: boolean, level: 1 | 2 | 3): void => {
    if (!found.has(cell)) found.set(cell, { cell, mine, level });
  };
  for (const c of cons) {
    if (c.need === 0) c.hidden.forEach((x) => add(x, false, 1));
    else if (c.need === c.hidden.length) c.hidden.forEach((x) => add(x, true, 1));
  }
  if (found.size || maxLevel < 2) return [...found.values()];

  for (let a = 0; a < cons.length; a++) {
    const A = cons[a] as Constraint;
    for (let b = 0; b < cons.length; b++) {
      if (a === b) continue;
      const B = cons[b] as Constraint;
      if (A.hidden.length >= B.hidden.length) continue;
      if (!A.hidden.every((x) => B.hidden.includes(x))) continue;
      const diff = B.hidden.filter((x) => !A.hidden.includes(x));
      const dm = B.need - A.need;
      if (dm === 0) diff.forEach((x) => add(x, false, 2));
      else if (dm === diff.length) diff.forEach((x) => add(x, true, 2));
    }
  }
  if (found.size || maxLevel < 3) return [...found.values()];

  let flagged = 0;
  const hidden: number[] = [];
  status.forEach((s, i) => {
    if (isFlag(s)) flagged++;
    else if (s === W_HIDDEN) hidden.push(i);
  });
  const remaining = mineCount - flagged;
  if (hidden.length && remaining === 0) hidden.forEach((x) => add(x, false, 3));
  else if (hidden.length && remaining === hidden.length) hidden.forEach((x) => add(x, true, 3));
  if (found.size) return [...found.values()];
  return enumerate(cons, mineCount, status);
}

function cascade(w: number, h: number, clues: readonly number[], cells: number[], from: number): void {
  const nb = wardNeighbours(w, h);
  const stack = [from];
  while (stack.length) {
    const c = stack.pop() as number;
    if (cells[c] !== W_HIDDEN) continue;
    cells[c] = W_OPEN;
    if (clues[c] === 0) for (const j of nb[c] as number[]) if (cells[j] === W_HIDDEN) stack.push(j);
  }
}

/** Run the solver to a fixed point. */
function runSolver(
  w: number,
  h: number,
  clues: readonly number[],
  mines: readonly boolean[],
  start: readonly number[],
  mineCount: number,
  maxLevel: 1 | 2 | 3,
): { solved: boolean; used: number } {
  const status = start.slice();
  let used = 0;
  for (;;) {
    const ds = deduce(w, h, clues, status, mineCount, maxLevel);
    if (ds.length === 0) break;
    for (const d of ds) {
      used = Math.max(used, d.level);
      status[d.cell] = d.mine ? W_FLAG : W_OPEN;
    }
  }
  let solved = true;
  for (let i = 0; i < w * h; i++) {
    const s = status[i];
    if (mines[i] ? s !== W_FLAG : s !== W_OPEN) solved = false;
  }
  return { solved, used };
}

export function generateWards(seed: number, difficulty: number, rng: Rng): WardsInstance {
  const cfg = wardsConfig(difficulty);
  const { w, h } = cfg;
  const n = w * h;
  const nb = wardNeighbours(w, h);

  const layout = (): { mines: boolean[]; clues: number[] } => {
    const mines = new Array<boolean>(n).fill(false);
    for (const i of rng.shuffle(Array.from({ length: n }, (_, k) => k)).slice(0, cfg.mines)) mines[i] = true;
    const clues = mines.map((m, i) => (m ? -1 : (nb[i] as number[]).filter((j) => mines[j]).length));
    return { mines, clues };
  };
  const startFor = (mines: boolean[], clues: number[]): number[] => {
    const cells = new Array<number>(n).fill(W_HIDDEN);
    const safe = Array.from({ length: n }, (_, i) => i).filter((i) => !mines[i]);
    const zeros = safe.filter((i) => clues[i] === 0);
    const pool = zeros.length ? zeros : safe;
    cascade(w, h, clues, cells, rng.pick(pool));
    return cells;
  };

  type Candidate = { mines: boolean[]; clues: number[]; start: number[] };
  let fallback: Candidate | null = null;
  let chosen: Candidate | null = null;
  let anySolved: Candidate | null = null;
  for (let attempt = 0; attempt < 40 && !chosen; attempt++) {
    const { mines, clues } = layout();
    const start = startFor(mines, clues);
    fallback = { mines, clues, start };
    const r = runSolver(w, h, clues, mines, start, cfg.mines, cfg.allowed);
    if (!r.solved) continue;
    if (r.used >= cfg.need) chosen = { mines, clues, start };
    else if (!anySolved) anySolved = { mines, clues, start };
  }
  chosen ??= anySolved;
  if (!chosen && fallback) {
    // Reveal extra safe cells until the whole-board reasoning solves it. Terminates: with every safe
    // cell open, the remaining hidden cells are exactly the traps.
    const { mines, clues } = fallback;
    const start = fallback.start.slice();
    const hiddenSafe = rng.shuffle(Array.from({ length: n }, (_, i) => i).filter((i) => !mines[i] && start[i] === W_HIDDEN));
    while (!runSolver(w, h, clues, mines, start, cfg.mines, 3).solved && hiddenSafe.length) {
      cascade(w, h, clues, start, hiddenSafe.pop() as number);
    }
    chosen = { mines, clues, start };
  }
  const { mines, clues, start } = chosen as { mines: boolean[]; clues: number[]; start: number[] };
  const open: number[] = [];
  start.forEach((s, i) => {
    if (s === W_OPEN) open.push(i);
  });
  return {
    kind: 'wards',
    seed,
    difficulty,
    title: 'Ward Lock',
    instruction: 'Each number counts the traps touching that tile. Open every safe tile and mark every trap.',
    parSeconds: Math.round(10 + 1.5 * (n - open.length)),
    mistakeAllowance: 0,
    data: { w, h, mineCount: cfg.mines, clues, start: open },
    solution: mines,
  };
}

function checkSolved(inst: WardsInstance, cells: readonly number[]): boolean {
  return inst.solution.every((m, i) => (m ? isFlag(cells[i] as number) : cells[i] === W_OPEN));
}

export function startWards(inst: WardsInstance): WardsState {
  const cells = new Array<number>(inst.data.w * inst.data.h).fill(W_HIDDEN);
  for (const i of inst.data.start) cells[i] = W_OPEN;
  return { kind: 'wards', inst, cells, mistakes: 0, moves: 0, solved: false };
}

export function applyWards(state: WardsState, move: WardsMove): WardsState {
  const { inst } = state;
  if (state.solved) return state;
  const cell = move.cell;
  if (cell < 0 || cell >= state.cells.length || state.cells[cell] !== W_HIDDEN) return state;
  const cells = state.cells.slice();
  const trap = inst.solution[cell] === true;
  let mistakes = state.mistakes;
  if (move.type === 'open') {
    if (trap) {
      cells[cell] = W_SPRUNG;
      mistakes++;
    } else cascade(inst.data.w, inst.data.h, inst.data.clues, cells, cell);
  } else if (trap) cells[cell] = W_FLAG;
  else mistakes++; // a wrong mark is rejected and costs a mistake
  return { ...state, cells, mistakes, moves: state.moves + 1, solved: checkSolved(inst, cells) };
}

export function hintWards(state: WardsState): WardsMove | null {
  const { inst, cells } = state;
  const d = deduce(inst.data.w, inst.data.h, inst.data.clues, cells, inst.data.mineCount, 3)[0];
  if (d) return { type: d.mine ? 'flag' : 'open', cell: d.cell };
  const cell = cells.findIndex((s) => s === W_HIDDEN);
  if (cell < 0) return null;
  return { type: inst.solution[cell] ? 'flag' : 'open', cell };
}

export function solveWards(inst: WardsInstance): WardsMove[] {
  let state = startWards(inst);
  const moves: WardsMove[] = [];
  for (let guard = 0; guard < 500 && !state.solved; guard++) {
    const ds = deduce(inst.data.w, inst.data.h, inst.data.clues, state.cells, inst.data.mineCount, 3);
    if (ds.length === 0) break;
    for (const d of ds) {
      const m: WardsMove = { type: d.mine ? 'flag' : 'open', cell: d.cell };
      const next = applyWards(state, m);
      if (next !== state) {
        moves.push(m);
        state = next;
      }
    }
  }
  return moves;
}

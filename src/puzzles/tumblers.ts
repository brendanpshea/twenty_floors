import { Rng } from '../core/rng';
import type { TumblerGuess, TumblersInstance, TumblersMove, TumblersState } from './types';

interface Cfg {
  length: number;
  symbols: number;
  repeats: boolean;
  maxGuesses: number;
  parGuesses: number;
}

const CONFIGS: Cfg[] = [
  { length: 3, symbols: 4, repeats: false, maxGuesses: 8, parGuesses: 4 },
  { length: 3, symbols: 5, repeats: false, maxGuesses: 8, parGuesses: 4 },
  { length: 3, symbols: 5, repeats: true, maxGuesses: 9, parGuesses: 5 },
  { length: 4, symbols: 5, repeats: false, maxGuesses: 9, parGuesses: 5 },
  { length: 4, symbols: 5, repeats: true, maxGuesses: 10, parGuesses: 6 },
  { length: 4, symbols: 6, repeats: false, maxGuesses: 10, parGuesses: 6 },
  { length: 4, symbols: 6, repeats: true, maxGuesses: 11, parGuesses: 7 },
  { length: 5, symbols: 6, repeats: false, maxGuesses: 11, parGuesses: 7 },
  { length: 5, symbols: 5, repeats: true, maxGuesses: 12, parGuesses: 8 },
  { length: 5, symbols: 6, repeats: true, maxGuesses: 12, parGuesses: 8 },
];

export function tumblersConfig(difficulty: number): Cfg {
  return CONFIGS[Math.max(1, Math.min(10, difficulty)) - 1] as Cfg;
}

/** Mastermind feedback. */
export function feedback(secret: readonly number[], guess: readonly number[]): { exact: number; misplaced: number } {
  let exact = 0;
  const sCount = new Map<number, number>();
  const gCount = new Map<number, number>();
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i] as number;
    const g = guess[i] as number;
    if (s === g) exact++;
    else {
      sCount.set(s, (sCount.get(s) ?? 0) + 1);
      gCount.set(g, (gCount.get(g) ?? 0) + 1);
    }
  }
  let misplaced = 0;
  for (const [sym, c] of gCount) misplaced += Math.min(c, sCount.get(sym) ?? 0);
  return { exact, misplaced };
}

export function generateTumblers(seed: number, difficulty: number, rng: Rng): TumblersInstance {
  const cfg = tumblersConfig(difficulty);
  let solution: number[];
  if (cfg.repeats) {
    solution = Array.from({ length: cfg.length }, () => rng.int(0, cfg.symbols - 1));
    // Make repeats actually occur sometimes, but never a one-symbol code.
    if (new Set(solution).size === 1) solution[0] = (solution[0] as number + 1) % cfg.symbols;
  } else {
    solution = rng.shuffle(Array.from({ length: cfg.symbols }, (_, i) => i)).slice(0, cfg.length);
  }
  return {
    kind: 'tumblers',
    seed,
    difficulty,
    title: 'Tumbler Lock',
    instruction: cfg.repeats
      ? 'Find the hidden sequence. A symbol may appear more than once.'
      : 'Find the hidden sequence. No symbol appears twice.',
    parSeconds: Math.round(cfg.parGuesses * 10 + 10),
    parMoves: cfg.parGuesses,
    mistakeAllowance: 0,
    data: { length: cfg.length, symbols: cfg.symbols, repeats: cfg.repeats, maxGuesses: cfg.maxGuesses },
    solution,
  };
}

export function startTumblers(inst: TumblersInstance): TumblersState {
  return {
    kind: 'tumblers',
    inst,
    guesses: [],
    revealed: new Array<number | null>(inst.data.length).fill(null),
    mistakes: 0,
    moves: 0,
    solved: false,
    failed: false,
  };
}

export function isValidGuess(inst: TumblersInstance, code: readonly number[]): boolean {
  const d = inst.data;
  if (code.length !== d.length) return false;
  if (code.some((s) => !Number.isInteger(s) || s < 0 || s >= d.symbols)) return false;
  if (!d.repeats && new Set(code).size !== code.length) return false;
  return true;
}

export function applyTumblers(state: TumblersState, move: TumblersMove): TumblersState {
  if (state.solved || state.failed) return state;
  const { inst } = state;
  if (move.type === 'reveal') {
    if (move.index < 0 || move.index >= inst.data.length || state.revealed[move.index] !== null) return state;
    const revealed = state.revealed.slice();
    revealed[move.index] = inst.solution[move.index] as number;
    return { ...state, revealed };
  }
  if (!isValidGuess(inst, move.code)) return state;
  const fb = feedback(inst.solution, move.code);
  const guess: TumblerGuess = { code: move.code.slice(), exact: fb.exact, misplaced: fb.misplaced };
  const guesses = [...state.guesses, guess];
  const solved = fb.exact === inst.data.length;
  return {
    ...state,
    guesses,
    moves: guesses.length,
    solved,
    failed: !solved && guesses.length >= inst.data.maxGuesses,
  };
}

export function hintTumblers(state: TumblersState): TumblersMove | null {
  const index = state.revealed.findIndex((r) => r === null);
  return index < 0 ? null : { type: 'reveal', index };
}

/** All codes allowed by the instance, in lexicographic order. */
export function allCodes(inst: TumblersInstance): number[][] {
  const { length, symbols, repeats } = inst.data;
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (): void => {
    if (cur.length === length) {
      out.push(cur.slice());
      return;
    }
    for (let s = 0; s < symbols; s++) {
      if (!repeats && cur.includes(s)) continue;
      cur.push(s);
      rec();
      cur.pop();
    }
  };
  rec();
  return out;
}

/** True when `code` would have produced exactly the feedback seen so far. */
export function isConsistent(code: readonly number[], guesses: readonly TumblerGuess[]): boolean {
  return guesses.every((g) => {
    const fb = feedback(code, g.code);
    return fb.exact === g.exact && fb.misplaced === g.misplaced;
  });
}

/** The simple strategy: first code (in a fixed order) consistent with all feedback so far. */
export function consistentGuess(inst: TumblersInstance, guesses: readonly TumblerGuess[], codes = allCodes(inst)): number[] {
  return (codes.find((c) => isConsistent(c, guesses)) ?? inst.solution).slice();
}

export function solveTumblers(inst: TumblersInstance): TumblersMove[] {
  const codes = allCodes(inst);
  const guesses: TumblerGuess[] = [];
  const moves: TumblersMove[] = [];
  for (let i = 0; i < inst.data.maxGuesses; i++) {
    const code = consistentGuess(inst, guesses, codes);
    moves.push({ type: 'guess', code });
    const fb = feedback(inst.solution, code);
    guesses.push({ code, ...fb });
    if (fb.exact === inst.data.length) break;
  }
  return moves;
}

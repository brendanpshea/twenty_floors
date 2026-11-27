import { Rng } from '../core/rng';
import type { ConduitsInstance, ConduitsMove, ConduitsState } from './types';

/** Direction bits. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
const DIRS = [N, E, S, W] as const;
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

interface Cfg {
  w: number;
  h: number;
  wrap: boolean;
}
const CONFIGS: Cfg[] = [
  { w: 4, h: 4, wrap: false },
  { w: 5, h: 4, wrap: false },
  { w: 5, h: 5, wrap: false },
  { w: 5, h: 5, wrap: true },
  { w: 6, h: 5, wrap: false },
  { w: 6, h: 6, wrap: false },
  { w: 6, h: 6, wrap: true },
  { w: 7, h: 6, wrap: false },
  { w: 7, h: 7, wrap: false },
  { w: 7, h: 7, wrap: true },
];

export function conduitsConfig(difficulty: number): Cfg {
  return CONFIGS[Math.max(1, Math.min(10, difficulty)) - 1] as Cfg;
}

export function rotCW(m: number): number {
  return ((m << 1) | (m >> 3)) & 15;
}

/** Distinct rotations of a mask. */
export function rotations(m: number): number[] {
  const out: number[] = [];
  let cur = m;
  for (let i = 0; i < 4; i++) {
    if (!out.includes(cur)) out.push(cur);
    cur = rotCW(cur);
  }
  return out;
}

export function popcount4(m: number): number {
  return ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));
}

/** Neighbour of a cell in direction index d (0=N 1=E 2=S 3=W), or -1. */
export function neighbour(w: number, h: number, wrap: boolean, cell: number, d: number): number {
  const r = Math.floor(cell / w);
  const c = cell % w;
  let nr = r + (DR[d] as number);
  let nc = c + (DC[d] as number);
  if (wrap) {
    nr = (nr + h) % h;
    nc = (nc + w) % w;
  } else if (nr < 0 || nr >= h || nc < 0 || nc >= w) return -1;
  return nr * w + nc;
}

/** Cells powered from the source through matched joints. */
export function conduitsPowered(inst: ConduitsInstance, tiles: readonly number[]): boolean[] {
  const { w, h, wrap, source } = inst.data;
  const seen = new Array<boolean>(w * h).fill(false);
  const stack = [source];
  seen[source] = true;
  while (stack.length) {
    const c = stack.pop() as number;
    for (let d = 0; d < 4; d++) {
      if (!((tiles[c] as number) & (DIRS[d] as number))) continue;
      const nb = neighbour(w, h, wrap, c, d);
      if (nb < 0 || seen[nb]) continue;
      if ((tiles[nb] as number) & (DIRS[(d + 2) % 4] as number)) {
        seen[nb] = true;
        stack.push(nb);
      }
    }
  }
  return seen;
}

/** Open ends that do not meet a matching end (loose ends), per cell as a mask. */
export function conduitsLoose(inst: ConduitsInstance, tiles: readonly number[]): number[] {
  const { w, h, wrap } = inst.data;
  return tiles.map((m, c) => {
    let loose = 0;
    for (let d = 0; d < 4; d++) {
      if (!(m & (DIRS[d] as number))) continue;
      const nb = neighbour(w, h, wrap, c, d);
      if (nb < 0 || !((tiles[nb] as number) & (DIRS[(d + 2) % 4] as number))) loose |= DIRS[d] as number;
    }
    return loose;
  });
}

/** Solved = no loose ends and every tile powered from the source (hence a loop-free tree). */
export function conduitsSolved(inst: ConduitsInstance, tiles: readonly number[]): boolean {
  if (conduitsLoose(inst, tiles).some((l) => l !== 0)) return false;
  return conduitsPowered(inst, tiles).every(Boolean);
}

interface SolveResult {
  sols: number[][];
  capped: boolean;
}

/** Count (up to `limit`) layouts with matched joints that connect everything. */
function searchLayouts(
  w: number,
  h: number,
  wrap: boolean,
  source: number,
  opts: readonly number[][],
  limit: number,
  cap: number,
): SolveResult {
  const n = w * h;
  const chosen = new Array<number>(n).fill(0);
  const sols: number[][] = [];
  let nodes = 0;
  let capped = false;
  const probe = { data: { w, h, wrap, source } } as unknown as ConduitsInstance;
  const rec = (i: number): void => {
    if (capped || sols.length >= limit) return;
    if (i === n) {
      if (conduitsPowered(probe, chosen).every(Boolean)) sols.push(chosen.slice());
      return;
    }
    const r = Math.floor(i / w);
    const c = i % w;
    for (const m of opts[i] as number[]) {
      if (++nodes > cap) {
        capped = true;
        return;
      }
      if (c > 0 ? !!(m & W) !== !!((chosen[i - 1] as number) & E) : !wrap && m & W) continue;
      if (r > 0 ? !!(m & N) !== !!((chosen[i - w] as number) & S) : !wrap && m & N) continue;
      if (c === w - 1) {
        if (wrap ? !!(m & E) !== !!((chosen[r * w] as number) & W) : m & E) continue;
      }
      if (r === h - 1) {
        if (wrap ? !!(m & S) !== !!((chosen[c] as number) & N) : m & S) continue;
      }
      chosen[i] = m;
      rec(i + 1);
      if (capped || sols.length >= limit) return;
    }
    chosen[i] = 0;
  };
  rec(0);
  return { sols, capped };
}

function randomTree(rng: Rng, w: number, h: number, wrap: boolean): number[] {
  const n = w * h;
  const masks = new Array<number>(n).fill(0);
  const inTree = new Array<boolean>(n).fill(false);
  const start = rng.int(0, n - 1);
  inTree[start] = true;
  const edges: Array<[number, number]> = [];
  const addEdges = (c: number): void => {
    for (let d = 0; d < 4; d++) {
      const nb = neighbour(w, h, wrap, c, d);
      if (nb >= 0 && !inTree[nb]) edges.push([c, d]);
    }
  };
  addEdges(start);
  while (edges.length) {
    const k = rng.int(0, edges.length - 1);
    const [c, d] = edges[k] as [number, number];
    edges[k] = edges[edges.length - 1] as [number, number];
    edges.pop();
    const nb = neighbour(w, h, wrap, c, d);
    if (nb < 0 || inTree[nb]) continue;
    inTree[nb] = true;
    masks[c] = (masks[c] as number) | (DIRS[d] as number);
    masks[nb] = (masks[nb] as number) | (DIRS[(d + 2) % 4] as number);
    addEdges(nb);
  }
  return masks;
}

/** Clockwise taps needed to turn `from` into `to` (Infinity if impossible). */
export function tapsNeeded(from: number, to: number): number {
  let cur = from;
  for (let k = 0; k < 4; k++) {
    if (cur === to) return k;
    cur = rotCW(cur);
  }
  return Infinity;
}

export function generateConduits(seed: number, difficulty: number, rng: Rng): ConduitsInstance {
  const { w, h, wrap } = conduitsConfig(difficulty);
  const n = w * h;
  const sol = randomTree(rng, w, h, wrap);
  const source = rng.int(0, n - 1);
  const locked = new Array<boolean>(n).fill(false);
  const optsFor = (): number[][] => sol.map((m, i) => (locked[i] ? [m] : rotations(m)));

  for (let iter = 0; iter < 60; iter++) {
    const res = searchLayouts(w, h, wrap, source, optsFor(), 2, 30000);
    if (!res.capped && res.sols.length === 1) break;
    let pool: number[] = [];
    if (res.sols.length >= 2) {
      const alt = res.sols.find((s) => s.some((m, i) => m !== sol[i]));
      if (alt) pool = alt.map((m, i) => (m !== sol[i] && !locked[i] ? i : -1)).filter((i) => i >= 0);
    }
    if (pool.length === 0) pool = sol.map((m, i) => (!locked[i] && rotations(m).length > 1 ? i : -1)).filter((i) => i >= 0);
    if (pool.length === 0) break;
    locked[rng.pick(pool)] = true;
  }

  // Scramble: most rotatable tiles start wrong, at least one does.
  const tiles = sol.slice();
  const rotatable: number[] = [];
  for (let i = 0; i < n; i++) if (!locked[i] && rotations(sol[i] as number).length > 1) rotatable.push(i);
  for (const i of rotatable) {
    if (rng.chance(0.85)) tiles[i] = rng.pick(rotations(sol[i] as number).filter((m) => m !== sol[i]));
  }
  if (rotatable.length > 0 && rotatable.every((i) => tiles[i] === sol[i])) {
    const i = rotatable[0] as number;
    tiles[i] = rng.pick(rotations(sol[i] as number).filter((m) => m !== sol[i]));
  }
  let minTaps = 0;
  for (let i = 0; i < n; i++) minTaps += tapsNeeded(tiles[i] as number, sol[i] as number);

  return {
    kind: 'conduits',
    seed,
    difficulty,
    title: 'Conduit Lock',
    instruction: wrap
      ? 'Turn the tiles until every pipe joins one network from the source. The edges wrap around.'
      : 'Turn the tiles until every pipe joins one network from the source, with no loose ends.',
    parSeconds: Math.round(n * 1.5 + 10),
    parMoves: Math.ceil(minTaps * 1.2) + 2,
    mistakeAllowance: 0,
    data: { w, h, wrap, source, tiles, locked },
    solution: sol,
  };
}

export function startConduits(inst: ConduitsInstance): ConduitsState {
  const tiles = inst.data.tiles.slice();
  return { kind: 'conduits', inst, tiles, mistakes: 0, moves: 0, solved: conduitsSolved(inst, tiles) };
}

export function applyConduits(state: ConduitsState, move: ConduitsMove): ConduitsState {
  const { inst } = state;
  if (state.solved) return state;
  const cell = move.cell;
  if (cell < 0 || cell >= state.tiles.length || inst.data.locked[cell]) return state;
  const tiles = state.tiles.slice();
  let m = tiles[cell] as number;
  if (move.type === 'rotate') {
    const times = move.dir === -1 ? 3 : 1;
    for (let i = 0; i < times; i++) m = rotCW(m);
  } else {
    if (!rotations(m).includes(move.mask)) return state;
    m = move.mask;
  }
  if (m === tiles[cell]) return state;
  tiles[cell] = m;
  return { ...state, tiles, moves: state.moves + 1, solved: conduitsSolved(inst, tiles) };
}

export function hintConduits(state: ConduitsState): ConduitsMove | null {
  const { inst, tiles } = state;
  // Start near the source so the hint extends the network.
  const { w, source } = inst.data;
  const sr = Math.floor(source / w);
  const sc = source % w;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < tiles.length; i++) {
    if (inst.data.locked[i] || tiles[i] === inst.solution[i]) continue;
    const d = Math.abs(Math.floor(i / w) - sr) + Math.abs((i % w) - sc);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : { type: 'set', cell: best, mask: inst.solution[best] as number };
}

export function solveConduits(inst: ConduitsInstance): ConduitsMove[] {
  const moves: ConduitsMove[] = [];
  inst.data.tiles.forEach((m, cell) => {
    const k = tapsNeeded(m, inst.solution[cell] as number);
    for (let i = 0; i < k; i++) moves.push({ type: 'rotate', cell, dir: 1 });
  });
  return moves;
}

/** Counts matched, connected layouts (tests). */
export function countConduitsSolutions(inst: ConduitsInstance, limit = 2, cap = 2_000_000): { count: number; capped: boolean } {
  const { w, h, wrap, source, locked } = inst.data;
  const opts = inst.solution.map((m, i) => (locked[i] ? [m] : rotations(m)));
  const r = searchLayouts(w, h, wrap, source, opts, limit, cap);
  return { count: r.sols.length, capped: r.capped };
}

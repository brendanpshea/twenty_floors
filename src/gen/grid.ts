import { CellKind } from '../core/types';

export const K = CellKind;

/** The 8 neighbours in clockwise order starting north. Used for ring tests. */
export const NEI8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Orthogonal neighbours indexed by prop rotation: 0 = N (-y), 1 = E (+x), 2 = S (+y), 3 = W (-x). */
export const NEI4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const MAX_GRID = 64;

/** Thrown by generators when an attempt cannot be completed; the caller retries with a new seed. */
export class GenFail extends Error {}

export function isWalkKind(k: number): boolean {
  return k === K.Floor || k === K.Water || k === K.Door;
}

/** Mutable working grid shared by all generators. */
export class Grid {
  readonly kinds: Uint8Array;
  readonly elev: Int8Array;
  readonly room: Int16Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    if (w > MAX_GRID || h > MAX_GRID) throw new GenFail('grid too large');
    this.kinds = new Uint8Array(w * h);
    this.elev = new Int8Array(w * h);
    this.room = new Int16Array(w * h).fill(-1);
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  kind(x: number, y: number): number {
    return this.inb(x, y) ? (this.kinds[y * this.w + x] as number) : K.Void;
  }

  walkable(x: number, y: number): boolean {
    return this.inb(x, y) && isWalkKind(this.kinds[y * this.w + x] as number);
  }

  /** Carve a floor cell (never inside the 2-cell border, which is reserved for walls). */
  floor(x: number, y: number, elev: number, room: number): void {
    if (x < 2 || y < 2 || x > this.w - 3 || y > this.h - 3) return;
    const i = y * this.w + x;
    this.kinds[i] = K.Floor;
    this.elev[i] = elev;
    this.room[i] = room;
  }
}

/**
 * Euclidean distance using only IEEE-exact operations (+, *, sqrt). Math.hypot,
 * Math.pow and the trig functions may differ in the last bit between JS
 * engines, which could change a floor between browsers; generation avoids them.
 */
export function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Smooth 2D value noise in [0, 1). Deterministic in (seed, x, y). */
export function noise2(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function lattice(seed: number, xi: number, yi: number): number {
  let h = (Math.imul(xi, 374761393) + Math.imul(yi, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Two-octave noise in [0, 1). */
export function fbm2(seed: number, x: number, y: number): number {
  return noise2(seed, x, y) * 0.65 + noise2(seed + 977, x * 2.1, y * 2.1) * 0.35;
}

/** Breadth-first flood over a predicate with 4- or 8-connectivity. Returns visited cell indices. */
export function floodCells(
  g: Grid,
  start: number,
  pass: (i: number) => boolean,
  eight = false,
): number[] {
  const out: number[] = [];
  if (!pass(start)) return out;
  const seen = new Uint8Array(g.w * g.h);
  seen[start] = 1;
  out.push(start);
  for (let h = 0; h < out.length; h++) {
    const i = out[h] as number;
    const x = i % g.w;
    const y = (i / g.w) | 0;
    for (let d = 0; d < 8; d++) {
      if (!eight && (d & 1) === 1) continue;
      const [dx, dy] = NEI8[d] as readonly [number, number];
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inb(nx, ny)) continue;
      const j = ny * g.w + nx;
      if (seen[j] || !pass(j)) continue;
      seen[j] = 1;
      out.push(j);
    }
  }
  return out;
}

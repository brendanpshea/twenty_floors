/**
 * Seeded, deterministic random number generator (mulberry32).
 *
 * ALL gameplay and generation randomness must flow through an Rng instance.
 * Never call Math.random() in src/rules, src/gen or src/game: floors must be
 * reproducible from (seed, depth) and fights must be replayable in tests.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Roll one die with the given number of sides (1..sides). */
  die(sides: number): number {
    return this.int(1, sides);
  }

  /** Uniformly pick one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Pick one element using parallel weights (weights need not sum to 1). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new Error('Rng.weighted: items/weights mismatch');
    }
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Fisher-Yates shuffle, in place. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Derive an independent child stream. Use one fork per subsystem
   * (`rng.fork('layout')`, `rng.fork('props')`) so adding a random call in one
   * subsystem does not reshuffle the output of the others.
   */
  fork(label: string): Rng {
    return new Rng(hashSeed(this.state, label));
  }
}

/** Mix a numeric seed with a string label into a new 32-bit seed (FNV-1a). */
export function hashSeed(seed: number, label: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** The seed of a specific floor within a run. */
export function floorSeed(runSeed: number, depth: number): number {
  return hashSeed(runSeed, `floor:${depth}`);
}

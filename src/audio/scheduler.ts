import { between, type Rng } from './helpers';

export interface EventGen {
  minGap: number;
  maxGap: number;
  /** [min, max] seconds before the first event; defaults to one gap. */
  firstDelay?: [number, number];
  /** When this returns false the slot passes silently (used for combat-only events). */
  enabled?: () => boolean;
  fire: (time: number) => void;
}

/**
 * Lookahead scheduler for sparse random events. Pure maths over a clock: call
 * `advance(until)` with the audio clock plus a lookahead and every event due
 * before then fires once, with its exact start time.
 */
export class EventScheduler {
  private next: number[];
  constructor(
    private readonly gens: EventGen[],
    private readonly rng: Rng,
    start = 0,
  ) {
    this.next = gens.map((g) => start + (g.firstDelay ? between(rng, g.firstDelay[0], g.firstDelay[1]) : between(rng, g.minGap, g.maxGap)));
  }

  advance(until: number): number {
    let fired = 0;
    this.gens.forEach((g, i) => {
      let t = this.next[i]!;
      while (t < until) {
        if (!g.enabled || g.enabled()) {
          g.fire(t);
          fired++;
        }
        t += between(this.rng, g.minGap, g.maxGap);
      }
      this.next[i] = t;
    });
    return fired;
  }
}

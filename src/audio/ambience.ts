/**
 * Themed ambience beds. Each bed is a handful of continuous nodes (filtered
 * noise loop, oscillators, slow LFOs) plus sparse random events fired by a
 * lookahead scheduler. Nothing is a finite loop, so there is no seam to hear.
 */
import { AMB_LEVEL } from './calibration';
import { between, hz, type Rng } from './helpers';
import { bell, makeRecipe, noise, ping, puff, tone } from './recipes';
import { EventScheduler, type EventGen } from './scheduler';
import { playRecipe, type Graph } from './synth';
import type { ThemeId } from '../core/types';
import type { Layer } from './types';

/** Tracks started sources and created nodes so a bed can be torn down. */
class Rig {
  private srcs: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  constructor(
    readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
    private readonly rng: Rng,
  ) {}

  gain(v: number, to?: AudioNode | AudioParam): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    if (to) g.connect(to as AudioNode);
    return g;
  }
  filter(type: BiquadFilterType, freq: number, q: number, to?: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    this.nodes.push(f);
    if (to) f.connect(to);
    return f;
  }
  osc(type: OscillatorType, freq: number, to: AudioNode | AudioParam, detuneCents = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detuneCents;
    o.connect(to as AudioNode);
    o.start();
    this.srcs.push(o);
    return o;
  }
  noiseLoop(to: AudioNode): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.connect(to);
    s.start(0, this.rng() * (this.noise.duration - 0.5));
    this.srcs.push(s);
    return s;
  }
  /** Slow sine LFO adding +-depth around the param's current value. */
  lfo(rate: number, depth: number, param: AudioParam): void {
    const g = this.gain(depth, param);
    this.osc('sine', rate, g);
  }
  stop(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.srcs = [];
    this.nodes = [];
  }
}

interface BedDef {
  /** Fraction of the bed sent to the reverb. */
  verb: number;
  build(rig: Rig, out: AudioNode): void;
  events(emit: (layers: Layer[], verb: number, time: number, pan?: number) => void, rng: Rng): EventGen[];
}

const PENTA = [0, 2, 4, 7, 9];

const BEDS: Record<ThemeId, BedDef> = {
  warrens: {
    verb: 0.15,
    build(rig, out) {
      // Low cave rumble: very low-passed noise with a slowly wandering cutoff.
      const lp = rig.filter('lowpass', 120, 0.7, rig.gain(6, out));
      rig.noiseLoop(lp);
      rig.lfo(0.05, 35, lp.frequency);
      // Damp cave air.
      const air = rig.gain(0.3, out);
      rig.lfo(0.09, 0.12, air.gain);
      rig.noiseLoop(rig.filter('bandpass', 350, 0.6, air));
      // Sub drone.
      rig.osc('sine', 46, rig.gain(0.22, out));
      rig.osc('sine', 92.4, rig.gain(0.05, out));
    },
    events(emit, rng) {
      return [
        {
          // Irregular water drips.
          minGap: 1.2, maxGap: 4.5, firstDelay: [0.8, 2.5],
          fire: (t) => {
            const f = between(rng, 700, 1400);
            emit([ping('sine', f, 0, 0.1, 0.5, { freqEnd: f * 1.8 }), ping('sine', f * 2, 0, 0.05, 0.12)], 0.5, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Distant skitter: a few tiny claw ticks.
          minGap: 14, maxGap: 35, firstDelay: [6, 14],
          fire: (t) => {
            const n = 4 + Math.floor(rng() * 4);
            const layers: Layer[] = [];
            let at = 0;
            for (let i = 0; i < n; i++) {
              layers.push(puff('bandpass', between(rng, 3500, 5500), at, 0.015, 0.5, { q: 3 }));
              at += between(rng, 0.035, 0.09);
            }
            emit(layers, 0.2, t, rng() < 0.5 ? -0.7 : 0.7);
          },
        },
      ];
    },
  },

  crypt: {
    verb: 0.3,
    build(rig, out) {
      // Cold airy drone: a fifth over a low root, lightly breathing.
      const padLp = rig.filter('lowpass', 600, 0.5, out);
      const pad = rig.gain(0.1, padLp);
      rig.lfo(0.07, 0.035, pad.gain);
      rig.osc('triangle', 110, pad);
      rig.osc('triangle', 164.9, pad, 3);
      rig.osc('sine', 220.4, pad, -4);
      rig.osc('sine', 55, rig.gain(0.14, out));
      // Faint wind through stone: band-passed noise, cutoff and level drifting.
      const wind = rig.gain(0.5, out);
      rig.lfo(0.06, 0.3, wind.gain);
      const bp = rig.filter('bandpass', 500, 1.3, wind);
      rig.lfo(0.043, 220, bp.frequency);
      rig.lfo(0.11, 120, bp.frequency);
      rig.noiseLoop(bp);
    },
    events(emit, rng) {
      return [
        {
          // Rare deep bell.
          minGap: 28, maxGap: 60, firstDelay: [10, 22],
          fire: (t) => {
            const f = hz([43, 46, 50][Math.floor(rng() * 3)]!);
            emit(bell(f, 0, 6, 0.8), 0.8, t, between(rng, -0.4, 0.4));
          },
        },
      ];
    },
  },

  depths: {
    verb: 0.55,
    build(rig, out) {
      // Vast sub hum: two slightly detuned sines beating slowly, with upper harmonics so small speakers can hear it.
      const hum = rig.gain(0.3, out);
      rig.osc('sine', 36, hum);
      rig.osc('sine', 36.35, hum);
      rig.osc('sine', 72.2, rig.gain(0.08, out));
      rig.osc('sine', 108.3, rig.gain(0.035, out));
      // Slow shimmering crystal harmonics: each partial breathes at its own rate.
      const shimmer: [number, number][] = [[1318.5, 0.071], [1760.3, 0.113], [2093, 0.157], [2637, 0.089], [3322, 0.131]];
      for (const [f, rate] of shimmer) {
        const g = rig.gain(0.007, out);
        rig.lfo(rate, 0.0065, g.gain);
        rig.osc('sine', f, g);
      }
      // Distant air.
      const air = rig.gain(0.12, out);
      rig.lfo(0.05, 0.08, air.gain);
      rig.noiseLoop(rig.filter('lowpass', 220, 0.5, air));
    },
    events(emit, rng) {
      return [
        {
          // Soft crystal chime on a pentatonic.
          minGap: 9, maxGap: 22, firstDelay: [4, 9],
          fire: (t) => {
            const f = hz(84 + PENTA[Math.floor(rng() * PENTA.length)]! - (rng() < 0.4 ? 12 : 0));
            emit([ping('sine', f, 0, 3, 0.3), ping('sine', f * 2.01, 0, 1.4, 0.08)], 0.9, t, between(rng, -0.6, 0.6));
          },
        },
      ];
    },
  },
  sewers: {
    verb: 0.4,
    build(rig, out) {
      // Slowly flowing water: band-passed noise, cutoff and level drifting.
      const flow = rig.gain(0.55, out);
      rig.lfo(0.08, 0.2, flow.gain);
      const bp = rig.filter('bandpass', 650, 0.8, flow);
      rig.lfo(0.047, 220, bp.frequency);
      rig.lfo(0.13, 100, bp.frequency);
      rig.noiseLoop(bp);
      // Thin trickle sheen above the flow.
      const trickle = rig.gain(0.07, out);
      rig.lfo(0.11, 0.04, trickle.gain);
      rig.noiseLoop(rig.filter('bandpass', 2400, 1.1, trickle));
      // Hollow tunnel resonance: a narrow low band of noise plus a faint tone.
      const hollow = rig.gain(1.1, out);
      rig.lfo(0.04, 0.35, hollow.gain);
      rig.noiseLoop(rig.filter('bandpass', 90, 6, hollow));
      rig.osc('sine', 55, rig.gain(0.1, out));
    },
    events(emit, rng) {
      return [
        {
          // Frequent wet echoing drips: a plink with a rising tail, then an echo.
          minGap: 0.6, maxGap: 2.8, firstDelay: [0.4, 1.5],
          fire: (t) => {
            const f = between(rng, 500, 1100);
            const pan = between(rng, -0.7, 0.7);
            emit([ping('sine', f, 0, 0.14, 0.5, { freqEnd: f * 2 }), ping('sine', f * 2.4, 0, 0.06, 0.12), puff('bandpass', 2500, 0, 0.03, 0.1, { q: 2 })], 0.8, t, pan);
            const e = between(rng, 0.22, 0.4);
            emit([ping('sine', f * 0.97, 0, 0.18, 0.2, { freqEnd: f * 1.9 })], 0.9, t + e, -pan * 0.5);
          },
        },
        {
          // Occasional deep pipe groan or knock.
          minGap: 14, maxGap: 34, firstDelay: [7, 16],
          fire: (t) => {
            const f = between(rng, 55, 95);
            const pan = between(rng, -0.5, 0.5);
            if (rng() < 0.5) {
              emit([tone('triangle', f, 0, 1.1, 0.5, { freqEnd: f * 0.8, lp: 320, a: 0.25, r: 0.6 }), ping('sine', f * 2, 0.1, 0.6, 0.15, { freqEnd: f * 1.7 })], 0.7, t, pan);
            } else {
              emit([ping('sine', f * 1.5, 0, 0.35, 0.8, { freqEnd: f }), puff('lowpass', 500, 0, 0.05, 0.4), ping('sine', f * 3.1, 0, 0.5, 0.1)], 0.8, t, pan);
            }
          },
        },
        {
          // Rare distant splash or gurgle.
          minGap: 22, maxGap: 55, firstDelay: [10, 24],
          fire: (t) => {
            const pan = rng() < 0.5 ? -0.6 : 0.6;
            if (rng() < 0.5) {
              emit([noise('bandpass', 1200, 0, 0.12, 0.5, { a: 0.02, r: 0.25, freqEnd: 600, q: 0.8 }), puff('lowpass', 500, 0, 0.2, 0.3)], 0.6, t, pan);
            } else {
              const layers: Layer[] = [];
              let at = 0;
              const n = 3 + Math.floor(rng() * 3);
              for (let i = 0; i < n; i++) {
                const f = between(rng, 250, 450);
                layers.push(ping('sine', f, at, 0.08, 0.35, { freqEnd: f * 1.6 }));
                at += between(rng, 0.07, 0.16);
              }
              emit(layers, 0.6, t, pan);
            }
          },
        },
      ];
    },
  },
};

export const THEMES: readonly ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers'];

const LOOKAHEAD = 1.5;
const TICK_MS = 400;

export class Ambience {
  /** Fader node (crossfades). Connected to the graph's ambience bus. */
  readonly out: GainNode;
  private readonly rig: Rig;
  private readonly sched: EventScheduler;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private combat = false;
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly graph: Graph,
    private readonly noise: AudioBuffer,
    readonly theme: ThemeId,
    private readonly rng: Rng,
    fadeIn = 2,
  ) {
    const def = BEDS[theme];
    const level = AMB_LEVEL[theme];
    const now = ctx.currentTime;
    this.out = ctx.createGain();
    if (fadeIn > 0) {
      this.out.gain.setValueAtTime(0, now);
      this.out.gain.linearRampToValueAtTime(1, now + fadeIn);
    } else this.out.gain.value = 1;
    this.out.connect(graph.amb);

    this.rig = new Rig(ctx, noise, rng);
    const bed = this.rig.gain(level, this.out);
    def.build(this.rig, bed);
    const send = this.rig.gain(def.verb, graph.reverbIn);
    bed.connect(send);

    const emit = (layers: Layer[], verb: number, time: number, pan = 0) => this.emit(layers, verb, time, pan, level);
    const gens = def.events(emit, rng);
    gens.push({
      // Combat: a soft low heartbeat instead of music.
      minGap: 1.2, maxGap: 1.2, firstDelay: [0, 0.4],
      enabled: () => this.combat,
      fire: (t) =>
        emit(
          [
            ping('sine', 58, 0, 0.22, 0.8, { freqEnd: 40 }),
            ping('sine', 116, 0, 0.12, 0.25, { freqEnd: 80 }),
            ping('sine', 52, 0.2, 0.2, 0.55, { freqEnd: 38 }),
          ],
          0,
          t,
          0,
        ),
    });
    this.sched = new EventScheduler(gens, rng, now);
  }

  private emit(layers: Layer[], verb: number, time: number, pan: number, level: number): void {
    if (this.disposed) return;
    const recipe = makeRecipe(layers, { peakDb: -40, expectDur: 1, verb });
    playRecipe(this.ctx, recipe, Math.max(time, this.ctx.currentTime), {
      dest: this.out,
      reverbIn: this.graph.reverbIn,
      noise: this.noise,
      gain: level,
      pan,
      pitch: 1,
      rng: this.rng,
    });
  }

  /** Fire every scheduled event due before `until` (audio-clock seconds). */
  pump(until: number): void {
    if (!this.disposed) this.sched.advance(until);
  }

  /** Begin the lookahead timer (live use). */
  start(): void {
    const tick = () => {
      if (this.disposed) return;
      this.pump(this.ctx.currentTime + LOOKAHEAD);
      this.timer = setTimeout(tick, TICK_MS);
    };
    tick();
  }

  setCombat(active: boolean): void {
    this.combat = active;
  }

  /** Fade out over `seconds`, then free every node. */
  fadeOutAndDispose(seconds = 2): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0, now + seconds);
    } catch {
      /* ignore */
    }
    setTimeout(() => this.release(), seconds * 1000 + 150);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.release();
  }

  private release(): void {
    this.rig.stop();
    try {
      this.out.disconnect();
    } catch {
      /* ignore */
    }
  }
}

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
  fungal: {
    verb: 0.6,
    build(rig, out) {
      // Breath through gills: very quiet, high, soft filtered noise, slowly swelling.
      const air = rig.gain(0.5, out);
      rig.lfo(0.05, 0.3, air.gain);
      const bp = rig.filter('bandpass', 3200, 0.6, air);
      rig.lfo(0.037, 700, bp.frequency);
      rig.noiseLoop(rig.filter('lowpass', 5000, 0.5, bp));
      // Slow low drone with a gentle detuned shimmer.
      const drone = rig.gain(0.2, rig.filter('lowpass', 420, 0.5, out));
      rig.lfo(0.06, 0.07, drone.gain);
      rig.osc('sine', 55, drone);
      rig.osc('sine', 55.4, drone);
      rig.osc('triangle', 110.3, rig.gain(0.4, drone), 5);
      rig.osc('triangle', 110.3, rig.gain(0.4, drone), -6);
      const shim = rig.gain(0.012, out);
      rig.lfo(0.09, 0.008, shim.gain);
      rig.osc('sine', 659.3, shim);
      rig.osc('sine', 660.9, shim);
    },
    events(emit, rng) {
      return [
        {
          // Glassy spore chimes on a pentatonic, long tails.
          minGap: 3.5, maxGap: 11, firstDelay: [1.5, 5],
          fire: (t) => {
            const f = hz(79 + PENTA[Math.floor(rng() * PENTA.length)]! + (rng() < 0.35 ? 12 : 0));
            const pan = between(rng, -0.7, 0.7);
            emit([ping('sine', f, 0, 3.5, 0.3), ping('sine', f * 2.76, 0, 1.2, 0.06), ping('sine', f * 1.002, 0, 3, 0.15)], 0.8, t, pan);
            if (rng() < 0.3) emit([ping('sine', f * 1.5, 0, 2.5, 0.18)], 0.7, t + between(rng, 0.25, 0.6), -pan);
          },
        },
        {
          // Occasional wet squelch or pop.
          minGap: 12, maxGap: 32, firstDelay: [6, 14],
          fire: (t) => {
            const f = between(rng, 180, 360);
            const pan = between(rng, -0.6, 0.6);
            if (rng() < 0.5) {
              emit([ping('sine', f, 0, 0.12, 0.6, { freqEnd: f * 2.2 }), puff('bandpass', 900, 0, 0.05, 0.25, { q: 2 })], 0.6, t, pan);
            } else {
              emit([noise('bandpass', 700, 0, 0.18, 0.4, { a: 0.02, r: 0.12, freqEnd: 300, q: 1.2 }), ping('sine', f * 1.5, 0.08, 0.1, 0.35, { freqEnd: f * 0.8 })], 0.6, t, pan);
            }
          },
        },
        {
          // Rare distant skitter: a few fast tiny ticks.
          minGap: 25, maxGap: 60, firstDelay: [10, 22],
          fire: (t) => {
            const n = 3 + Math.floor(rng() * 4);
            const layers: Layer[] = [];
            let at = 0;
            for (let i = 0; i < n; i++) {
              layers.push(puff('bandpass', between(rng, 4000, 6500), at, 0.01, 0.5, { q: 3 }));
              at += between(rng, 0.025, 0.06);
            }
            emit(layers, 0.15, t, rng() < 0.5 ? -0.7 : 0.7);
          },
        },
      ];
    },
  },
  hold: {
    verb: 0.3,
    build(rig, out) {
      // Draught through timber: low-mid noise with slow gusts.
      const wind = rig.gain(0.5, out);
      rig.lfo(0.06, 0.3, wind.gain);
      rig.lfo(0.023, 0.15, wind.gain);
      const bp = rig.filter('bandpass', 420, 0.7, wind);
      rig.lfo(0.04, 150, bp.frequency);
      rig.noiseLoop(rig.filter('lowpass', 900, 0.5, bp));
      // Faint low room tone of the hall.
      rig.osc('sine', 62, rig.gain(0.05, out));
    },
    events(emit, rng) {
      return [
        {
          // Steady quiet fire crackle: frequent tiny ticks, occasionally a small pop.
          minGap: 0.12, maxGap: 0.7, firstDelay: [0.2, 1],
          fire: (t) => {
            const pan = between(rng, -0.5, 0.5);
            const layers: Layer[] = [puff('bandpass', between(rng, 1500, 4500), 0, 0.012, between(rng, 0.2, 0.6), { q: 1.5 })];
            if (rng() < 0.15) layers.push(puff('lowpass', 1200, 0.01, 0.03, 0.3));
            emit(layers, 0.2, t, pan);
          },
        },
        {
          // Timber creak: a short low tone with a slow pitch bend.
          minGap: 9, maxGap: 24, firstDelay: [4, 10],
          fire: (t) => {
            const f = between(rng, 110, 190);
            const up = rng() < 0.5;
            emit([tone('triangle', f, 0, 0.7, 0.3, { freqEnd: f * (up ? 1.12 : 0.88), lp: 600, a: 0.15, r: 0.35 })], 0.4, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Distant metallic clink or two, as from a forge or mail.
          minGap: 14, maxGap: 36, firstDelay: [8, 18],
          fire: (t) => {
            const pan = rng() < 0.5 ? -0.7 : 0.7;
            const n = rng() < 0.4 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const f = between(rng, 1800, 3200);
              emit([ping('sine', f, 0, 0.35, 0.3), ping('sine', f * 2.54, 0, 0.18, 0.15), ping('sine', f * 4.1, 0, 0.08, 0.07)], 0.28, t + i * between(rng, 0.18, 0.4), pan);
            }
          },
        },
        {
          // Rare muffled thump or door knock.
          minGap: 25, maxGap: 60, firstDelay: [12, 25],
          fire: (t) => {
            const f = between(rng, 60, 90);
            const pan = between(rng, -0.5, 0.5);
            const n = rng() < 0.5 ? 1 : 2 + Math.floor(rng() * 2);
            for (let i = 0; i < n; i++) {
              emit([ping('sine', f, 0, 0.2, 0.4, { freqEnd: f * 0.7 }), puff('lowpass', 300, 0, 0.05, 0.25)], 0.4, t + i * between(rng, 0.2, 0.35), pan);
            }
          },
        },
      ];
    },
  },
  library: {
    verb: 0.7,
    build(rig, out) {
      // Wide hushed room tone: soft low-passed noise, almost still.
      const room = rig.gain(0.65, out);
      rig.lfo(0.03, 0.08, room.gain);
      rig.noiseLoop(rig.filter('lowpass', 500, 0.4, room));
      // Faint arcane hum: detuned sines, slowly beating, kept soft with a low-pass.
      const hum = rig.gain(0.02, rig.filter('lowpass', 1800, 0.4, out));
      rig.lfo(0.05, 0.008, hum.gain);
      rig.osc('sine', 880, hum);
      rig.osc('sine', 881.6, hum);
      rig.osc('sine', 1318.5, rig.gain(0.5, hum));
    },
    events(emit, rng) {
      return [
        {
          // Slow distant drip with a long echo.
          minGap: 6, maxGap: 18, firstDelay: [2, 7],
          fire: (t) => {
            const f = between(rng, 600, 1000);
            const pan = between(rng, -0.7, 0.7);
            emit([ping('sine', f, 0, 0.16, 0.32, { freqEnd: f * 1.8 }), ping('sine', f * 2.4, 0, 0.05, 0.07)], 1, t, pan);
            emit([ping('sine', f * 0.97, 0, 0.18, 0.22, { freqEnd: f * 1.7 })], 1, t + between(rng, 0.45, 0.7), -pan * 0.6);
            emit([ping('sine', f * 0.95, 0, 0.18, 0.1, { freqEnd: f * 1.6 })], 1, t + between(rng, 1.1, 1.5), pan * 0.4);
          },
        },
        {
          // Dry paper: a page turning or rustle, a soft band-passed swish.
          minGap: 8, maxGap: 22, firstDelay: [3, 9],
          fire: (t) => {
            const pan = between(rng, -0.6, 0.6);
            if (rng() < 0.5) {
              emit([noise('bandpass', between(rng, 3000, 4500), 0, 0.28, 0.5, { a: 0.08, r: 0.15, freqEnd: 2000, q: 0.9 })], 0.4, t, pan);
            } else {
              const layers: Layer[] = [];
              let at = 0;
              const n = 3 + Math.floor(rng() * 3);
              for (let i = 0; i < n; i++) {
                layers.push(noise('bandpass', between(rng, 2500, 5000), at, 0.09, between(rng, 0.25, 0.5), { a: 0.03, r: 0.05, q: 1 }));
                at += between(rng, 0.07, 0.17);
              }
              emit(layers, 0.4, t, pan);
            }
          },
        },
        {
          // Occasional soft wooden knock or shelf creak.
          minGap: 16, maxGap: 40, firstDelay: [8, 18],
          fire: (t) => {
            const pan = between(rng, -0.6, 0.6);
            const f = between(rng, 120, 220);
            if (rng() < 0.5) {
              emit([ping('sine', f, 0, 0.12, 0.4, { freqEnd: f * 0.75 }), puff('lowpass', 700, 0, 0.04, 0.3), ping('sine', f * 2.3, 0, 0.1, 0.12)], 0.6, t, pan);
            } else {
              emit([tone('triangle', f, 0, 0.6, 0.25, { freqEnd: f * (rng() < 0.5 ? 1.1 : 0.9), lp: 500, a: 0.12, r: 0.3 })], 0.5, t, pan);
            }
          },
        },
        {
          // Rare low whispered breath: a slow filtered noise swell, no pitch.
          minGap: 30, maxGap: 70, firstDelay: [14, 28],
          fire: (t) => {
            emit([noise('bandpass', between(rng, 900, 1500), 0, 2.2, 0.35, { a: 0.9, r: 1.1, q: 0.7 })], 0.8, t, between(rng, -0.6, 0.6));
          },
        },
      ];
    },
  },
  foundry: {
    verb: 0.35,
    build(rig, out) {
      // Furnace roar: low-passed noise with slow surges.
      const roar = rig.gain(0.7, out);
      rig.lfo(0.07, 0.3, roar.gain);
      rig.lfo(0.031, 0.2, roar.gain);
      const lp = rig.filter('lowpass', 260, 0.6, roar);
      rig.lfo(0.053, 90, lp.frequency);
      rig.noiseLoop(lp);
      // Sub drone far below.
      const sub = rig.gain(0.14, out);
      rig.lfo(0.045, 0.05, sub.gain);
      rig.osc('sine', 41, sub);
      rig.osc('sine', 41.6, rig.gain(0.6, sub));
      // Steam hiss that comes and goes.
      const hiss = rig.gain(0.08, out);
      rig.lfo(0.06, 0.07, hiss.gain);
      const hbp = rig.filter('bandpass', 4200, 0.7, hiss);
      rig.lfo(0.04, 900, hbp.frequency);
      rig.noiseLoop(hbp);
    },
    events(emit, rng) {
      return [
        {
          // Heavy distant hammer strike on metal, sometimes two or three in a slow group.
          minGap: 9, maxGap: 24, firstDelay: [4, 10],
          fire: (t) => {
            const pan = between(rng, -0.7, 0.7);
            const r = rng();
            const n = r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
            let at = 0;
            for (let i = 0; i < n; i++) {
              const f = between(rng, 300, 520);
              const k = 1 - i * 0.2;
              emit([
                ping('sine', 70, 0, 0.25, 0.9 * k, { freqEnd: 40 }),
                puff('lowpass', 500, 0, 0.06, 0.5 * k),
                ping('sine', f, 0, 0.9, 0.22 * k),
                ping('sine', f * 2.76, 0, 0.5, 0.12 * k),
                ping('sine', f * 5.15, 0, 0.22, 0.06 * k),
              ], 0.6, t + at, pan);
              at += between(rng, 0.9, 1.6);
            }
          },
        },
        {
          // Burst of steam: noise swell rising then falling.
          minGap: 10, maxGap: 28, firstDelay: [3, 9],
          fire: (t) => {
            const f = between(rng, 2200, 3800);
            emit([noise('bandpass', f, 0, 1.6, 0.5, { a: 0.5, r: 1.0, freqEnd: f * 0.6, q: 0.8 })], 0.5, t, between(rng, -0.7, 0.7));
          },
        },
        {
          // Gloopy lava bubble: low blip with a quick upward bend.
          minGap: 1.5, maxGap: 6, firstDelay: [1, 4],
          fire: (t) => {
            const f = between(rng, 70, 150);
            emit([ping('sine', f, 0, 0.14, 0.7, { freqEnd: f * 1.9 }), puff('lowpass', 400, 0, 0.05, 0.15)], 0.4, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Rare long metallic groan: slow low tone with a pitch bend.
          minGap: 30, maxGap: 70, firstDelay: [14, 28],
          fire: (t) => {
            const f = between(rng, 60, 100);
            const up = rng() < 0.5;
            emit([
              tone('sawtooth', f, 0, 2.2, 0.3, { freqEnd: f * (up ? 1.25 : 0.75), lp: 380, a: 0.8, r: 1.0 }),
              tone('sine', f * 2.4, 0, 2.2, 0.06, { freqEnd: f * 2.4 * (up ? 1.25 : 0.75), a: 0.8, r: 1.0 }),
            ], 0.6, t, between(rng, -0.5, 0.5));
          },
        },
      ];
    },
  },
  ice: {
    verb: 0.6,
    build(rig, out) {
      // Thin cold wind beyond the cave: high band-passed noise, centre wandering, long gusts and lulls.
      const wind = rig.gain(0.45, out);
      rig.lfo(0.05, 0.3, wind.gain);
      rig.lfo(0.025, 0.1, wind.gain);
      rig.lfo(0.1, 0.08, wind.gain);
      const bp = rig.filter('bandpass', 2000, 1.2, wind);
      rig.lfo(0.03, 700, bp.frequency);
      rig.lfo(0.07, 300, bp.frequency);
      rig.noiseLoop(rig.filter('highpass', 800, 0.5, bp));
      // Very faint glassy shimmer: far-apart sines, slowly beating, kept soft.
      const shim = rig.gain(0.008, rig.filter('lowpass', 4500, 0.4, out));
      rig.lfo(0.07, 0.005, shim.gain);
      rig.osc('sine', 1568, shim);
      rig.osc('sine', 1570.2, shim);
      rig.osc('sine', 2637, rig.gain(0.6, shim));
      rig.osc('sine', 3322, rig.gain(0.3, shim), 7);
    },
    events(emit, rng) {
      return [
        {
          // Ice cracking: a sharp click, then a quick descending ping; sometimes a slow run of two or three.
          minGap: 6, maxGap: 18, firstDelay: [2, 6],
          fire: (t) => {
            const pan = between(rng, -0.7, 0.7);
            const n = rng() < 0.3 ? 2 + Math.floor(rng() * 2) : 1;
            let at = 0;
            for (let i = 0; i < n; i++) {
              const f = between(rng, 1400, 3200);
              emit([
                puff('highpass', 3000, 0, 0.012, 0.6),
                ping('sine', f, 0.005, 0.18, 0.4, { freqEnd: f * 0.45 }),
                ping('sine', f * 1.7, 0.005, 0.08, 0.12, { freqEnd: f * 0.9 }),
              ], 0.6, t + at, pan);
              at += between(rng, 0.35, 0.9);
            }
          },
        },
        {
          // Rare deep distant glacier boom: very low thud with a long tail.
          minGap: 35, maxGap: 80, firstDelay: [14, 30],
          fire: (t) => {
            const f = between(rng, 38, 55);
            emit([
              ping('sine', f, 0, 2.6, 0.6, { freqEnd: f * 0.7 }),
              puff('lowpass', 160, 0, 0.12, 0.25),
            ], 0.9, t, between(rng, -0.4, 0.4));
          },
        },
        {
          // Brittle tinkle of falling ice fragments: a quick scatter of tiny high pings.
          minGap: 14, maxGap: 40, firstDelay: [6, 16],
          fire: (t) => {
            const layers: Layer[] = [];
            const n = 4 + Math.floor(rng() * 5);
            let at = 0;
            for (let i = 0; i < n; i++) {
              layers.push(ping('sine', between(rng, 3000, 6500), at, 0.05, between(rng, 0.15, 0.35)));
              at += between(rng, 0.02, 0.09);
            }
            emit(layers, 0.7, t, between(rng, -0.7, 0.7));
          },
        },
      ];
    },
  },
  ruin: {
    verb: 0.55,
    build(rig, out) {
      // Soft broad wind in leaves: band-passed noise, overlapping slow swells.
      const wind = rig.gain(0.5, out);
      rig.lfo(0.05, 0.08, wind.gain);
      rig.lfo(0.1, 0.08, wind.gain);
      rig.lfo(0.2, 0.05, wind.gain);
      const bp = rig.filter('bandpass', 1300, 0.5, wind);
      rig.lfo(0.05, 150, bp.frequency);
      rig.lfo(0.1, 250, bp.frequency);
      rig.noiseLoop(rig.filter('lowpass', 2800, 0.5, bp));
      // Night insects: a very quiet high tone, gated by a fast pulse and slowly fading in and out.
      const ins = rig.gain(0.005, out);
      rig.lfo(0.05, 0.004, ins.gain);
      const pulse = rig.gain(0.5, ins);
      rig.lfo(7, 0.5, pulse.gain);
      rig.osc('sine', 4400, pulse);
      rig.osc('sine', 4650, rig.gain(0.6, pulse));
    },
    events(emit, rng) {
      return [
        {
          // Far-off owl: one soft hoot or a two-note call with a gentle downward bend.
          minGap: 14, maxGap: 38, firstDelay: [5, 14],
          fire: (t) => {
            const f = between(rng, 330, 420);
            const pan = between(rng, -0.7, 0.7);
            emit([tone('sine', f, 0, 0.45, 0.22, { freqEnd: f * 0.9, a: 0.08, r: 0.25 })], 0.9, t, pan);
            if (rng() < 0.6) {
              emit([tone('sine', f * 0.85, 0, 0.7, 0.2, { freqEnd: f * 0.72, a: 0.08, r: 0.4 })], 0.9, t + between(rng, 0.5, 0.7), pan);
            }
          },
        },
        {
          // Branch creak: a slow low tone with a pitch bend.
          minGap: 12, maxGap: 32, firstDelay: [6, 14],
          fire: (t) => {
            const f = between(rng, 120, 210);
            const up = rng() < 0.5;
            emit([tone('triangle', f, 0, 0.9, 0.2, { freqEnd: f * (up ? 1.15 : 0.85), lp: 700, a: 0.25, r: 0.4 })], 0.5, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Rustle in the undergrowth: a quick group of soft noise bursts.
          minGap: 8, maxGap: 24, firstDelay: [3, 9],
          fire: (t) => {
            const layers: Layer[] = [];
            const n = 3 + Math.floor(rng() * 4);
            let at = 0;
            for (let i = 0; i < n; i++) {
              layers.push(noise('bandpass', between(rng, 1800, 3800), at, 0.08, between(rng, 0.25, 0.5), { a: 0.02, r: 0.05, q: 0.9 }));
              at += between(rng, 0.05, 0.14);
            }
            emit(layers, 0.4, t, between(rng, -0.7, 0.7));
          },
        },
        {
          // Rare small stone falling: two or three dry clicks, descending.
          minGap: 30, maxGap: 75, firstDelay: [12, 26],
          fire: (t) => {
            const n = 2 + Math.floor(rng() * 2);
            let f = between(rng, 1800, 2600);
            let at = 0;
            const layers: Layer[] = [];
            for (let i = 0; i < n; i++) {
              layers.push(puff('bandpass', f, at, 0.015, 0.5, { q: 2 }), ping('sine', f * 0.5, at, 0.04, 0.12));
              f *= 0.78;
              at += between(rng, 0.12, 0.3) * (1 + i * 0.4);
            }
            emit(layers, 0.5, t, between(rng, -0.6, 0.6));
          },
        },
      ];
    },
  },
  hell: {
    verb: 0.6,
    build(rig, out) {
      // Dissonant drone: low sines a tritone and a minor second apart, slowly beating.
      const drone = rig.gain(0.1, rig.filter('lowpass', 300, 0.5, out));
      rig.lfo(0.05, 0.04, drone.gain);
      rig.osc('sine', 55, drone);
      rig.osc('sine', 58.3, rig.gain(0.8, drone));
      rig.osc('sine', 77.8, rig.gain(0.5, drone));
      // Dry furnace hiss underneath: low-passed noise with slow surges.
      const fur = rig.gain(0.6, out);
      rig.lfo(0.05, 0.3, fur.gain);
      rig.lfo(0.15, 0.1, fur.gain);
      const lp = rig.filter('lowpass', 700, 0.5, fur);
      rig.lfo(0.05, 250, lp.frequency);
      rig.noiseLoop(lp);
    },
    events(emit, rng) {
      return [
        {
          // Heavy chains dragging or rattling: a quick irregular run of dull inharmonic clanks.
          minGap: 10, maxGap: 28, firstDelay: [4, 10],
          fire: (t) => {
            const layers: Layer[] = [];
            const n = 4 + Math.floor(rng() * 6);
            let at = 0;
            for (let i = 0; i < n; i++) {
              const f = between(rng, 220, 700);
              const k = between(rng, 0.4, 1);
              layers.push(
                ping('sine', f, at, 0.1, 0.35 * k, { freqEnd: f * 0.9 }),
                ping('sine', f * 2.63, at, 0.06, 0.15 * k),
                puff('bandpass', f * 3, at, 0.02, 0.2 * k, { q: 2 }),
              );
              at += between(rng, 0.04, 0.22);
            }
            emit(layers, 0.5, t, between(rng, -0.7, 0.7));
          },
        },
        {
          // Distant iron door booming shut: low thud with a short metallic ring.
          minGap: 30, maxGap: 70, firstDelay: [12, 26],
          fire: (t) => {
            const f = between(rng, 330, 480);
            emit([
              ping('sine', 60, 0, 0.5, 0.9, { freqEnd: 35 }),
              puff('lowpass', 400, 0, 0.08, 0.5),
              ping('sine', f, 0.01, 0.6, 0.12),
              ping('sine', f * 2.4, 0.01, 0.35, 0.07),
            ], 0.8, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Far-off wail that is not a voice: slow sine glide (a detuned twin gives the wobble, the tone layer has no vibrato), quiet and washed in reverb.
          minGap: 35, maxGap: 80, firstDelay: [15, 30],
          fire: (t) => {
            const f = between(rng, 300, 420);
            const up = f * Math.pow(2, between(rng, 2, 4) / 12);
            const pan = between(rng, -0.7, 0.7);
            emit([
              tone('sine', f, 0, 3.4, 0.08, { freqEnd: up, a: 1.4, r: 1.6 }),
              tone('sine', f * 1.012, 0, 3.4, 0.07, { freqEnd: up * 0.992, a: 1.4, r: 1.6 }),
            ], 1, t, pan);
          },
        },
        {
          // Brimstone pop and sizzle: short noise crackle.
          minGap: 5, maxGap: 16, firstDelay: [2, 7],
          fire: (t) => {
            const layers: Layer[] = [puff('bandpass', between(rng, 1200, 3000), 0, 0.02, 0.5, { q: 1.5 })];
            const n = 2 + Math.floor(rng() * 4);
            let at = 0.04;
            for (let i = 0; i < n; i++) {
              layers.push(puff('highpass', between(rng, 2500, 5000), at, 0.012, between(rng, 0.15, 0.35)));
              at += between(rng, 0.02, 0.08);
            }
            emit(layers, 0.3, t, between(rng, -0.6, 0.6));
          },
        },
      ];
    },
  },
  lair: {
    verb: 0.6,
    build(rig, out) {
      // Huge sleeper breathing: low-passed noise, level and cutoff swelling in step (~6.7 s cycle).
      const breath = rig.gain(0.45, out);
      rig.lfo(0.15, 0.4, breath.gain);
      const lp = rig.filter('lowpass', 220, 0.6, breath);
      rig.lfo(0.15, 130, lp.frequency);
      rig.noiseLoop(lp);
      // Warm low drone.
      const drone = rig.gain(0.12, out);
      rig.lfo(0.05, 0.04, drone.gain);
      rig.osc('sine', 48, drone);
      rig.osc('sine', 48.5, rig.gain(0.7, drone));
      rig.osc('triangle', 96.2, rig.gain(0.25, rig.filter('lowpass', 300, 0.4, drone)));
    },
    events(emit, rng) {
      return [
        {
          // Coins sliding on the hoard: a quick scatter of very short bright pings, descending slightly.
          minGap: 8, maxGap: 22, firstDelay: [3, 9],
          fire: (t) => {
            const layers: Layer[] = [];
            const n = 5 + Math.floor(rng() * 6);
            let f = between(rng, 3800, 5200);
            let at = 0;
            for (let i = 0; i < n; i++) {
              const g = f * between(rng, 0.9, 1.1);
              layers.push(ping('sine', g, at, 0.07, between(rng, 0.15, 0.35)), ping('sine', g * 2.7, at, 0.03, 0.06));
              f *= 0.97;
              at += between(rng, 0.02, 0.11);
            }
            emit(layers, 0.5, t, between(rng, -0.7, 0.7));
          },
        },
        {
          // Rare deep growl or snort: low sawtooth and sine through a low-pass, slow pitch dip.
          minGap: 35, maxGap: 80, firstDelay: [14, 30],
          fire: (t) => {
            const f = between(rng, 42, 62);
            emit([
              tone('sawtooth', f * 1.5, 0, 2.2, 0.3, { freqEnd: f, lp: 240, a: 0.7, r: 1.2 }),
              tone('sine', f, 0, 2.2, 0.25, { freqEnd: f * 0.75, a: 0.7, r: 1.2 }),
              noise('lowpass', 300, 0.2, 1.6, 0.2, { a: 0.6, r: 0.8 }),
            ], 0.6, t, between(rng, -0.4, 0.4));
          },
        },
        {
          // Ember crackle: a few short noise ticks.
          minGap: 4, maxGap: 14, firstDelay: [1.5, 6],
          fire: (t) => {
            const layers: Layer[] = [];
            const n = 2 + Math.floor(rng() * 4);
            let at = 0;
            for (let i = 0; i < n; i++) {
              layers.push(puff('bandpass', between(rng, 1500, 4500), at, 0.012, between(rng, 0.2, 0.5), { q: 1.5 }));
              at += between(rng, 0.05, 0.3);
            }
            emit(layers, 0.25, t, between(rng, -0.6, 0.6));
          },
        },
        {
          // Rare single distant stone falling: a dull click and a low knock.
          minGap: 40, maxGap: 90, firstDelay: [18, 34],
          fire: (t) => {
            const f = between(rng, 1200, 2000);
            emit([
              puff('bandpass', f, 0, 0.02, 0.5, { q: 2 }),
              ping('sine', f * 0.3, 0, 0.08, 0.2),
              ping('sine', 80, 0.15, 0.25, 0.4, { freqEnd: 50 }),
              puff('lowpass', 400, 0.15, 0.05, 0.25),
            ], 0.8, t, between(rng, -0.7, 0.7));
          },
        },
      ];
    },
  },
};

export const THEMES: readonly ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library', 'foundry', 'ice', 'ruin', 'hell', 'lair'];

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

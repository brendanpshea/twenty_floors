/** Context-bound synth toolkit. Works on any BaseAudioContext (live or offline). */
import { clamp, envelopeTimes, layerEnd, type Rng } from './helpers';
import type { Layer, Recipe } from './types';

export interface Graph {
  /** Sound effects bus. */
  sfx: GainNode;
  /** Ambience bus. */
  amb: GainNode;
  /** Send into the room reverb. */
  reverbIn: GainNode;
  /** Final stage; its gain is the user volume/mute. */
  master: GainNode;
}

const FLOOR = 0.0001;

/** White noise with a baked equal-power crossfade so the loop point is inaudible. */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 3, rng: Rng = Math.random): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const xf = Math.floor(0.25 * sr);
  const raw = new Float32Array(n + xf);
  for (let i = 0; i < raw.length; i++) raw[i] = rng() * 2 - 1;
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) out[i] = raw[i]!;
  for (let i = 0; i < xf; i++) {
    const p = (i / xf) * (Math.PI / 2);
    out[i] = raw[i]! * Math.sin(p) + raw[n + i]! * Math.cos(p);
  }
  return buf;
}

/** Generated stereo impulse: decaying noise that darkens over time. */
export function createImpulse(ctx: BaseAudioContext, seconds: number, rng: Rng = Math.random): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const k = 0.55 - 0.5 * t; // one-pole coefficient: darker as it decays
      lp += k * ((rng() * 2 - 1) - lp);
      const fadeIn = Math.min(1, i / (0.004 * sr));
      d[i] = lp * Math.pow(1 - t, 2.6) * fadeIn * 1.8;
    }
  }
  return buf;
}

/**
 * sfx/amb buses -> compressor/limiter -> -6 dB trim -> master -> destination,
 * with a parallel reverb return. `reverbSeconds` sets the IR length.
 */
export function buildGraph(ctx: BaseAudioContext, destination: AudioNode, reverbSeconds = 2.4): Graph {
  const sfx = ctx.createGain();
  const amb = ctx.createGain();
  const reverbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = createImpulse(ctx, reverbSeconds);
  const ret = ctx.createGain();
  ret.gain.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 14;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const trim = ctx.createGain();
  trim.gain.value = 0.5;
  const master = ctx.createGain();
  master.gain.value = 1;

  sfx.connect(comp);
  amb.connect(comp);
  reverbIn.connect(conv);
  conv.connect(ret);
  ret.connect(comp);
  comp.connect(trim);
  trim.connect(master);
  master.connect(destination);
  return { sfx, amb, reverbIn, master };
}

function shapeEnvelope(p: AudioParam, t: number, l: Layer, level: number): void {
  const e = envelopeTimes(l.a, l.d, l.dur, l.r);
  const peak = Math.max(level, FLOOR);
  const sus = Math.max(peak * l.s, FLOOR);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + e.attackEnd);
  if (l.s < 1 && e.decayEnd > e.attackEnd) p.exponentialRampToValueAtTime(sus, t + e.decayEnd);
  const holdLevel = l.s < 1 ? sus : peak;
  p.setValueAtTime(holdLevel, t + e.releaseStart);
  p.exponentialRampToValueAtTime(FLOOR, t + e.end);
}

export interface PlayParams {
  /** Where the sound goes (sfx or ambience bus). */
  dest: AudioNode;
  reverbIn: AudioNode;
  noise: AudioBuffer;
  /** Linear gain multiplier for the whole recipe. */
  gain: number;
  pan: number;
  pitch: number;
  rng: Rng;
}

/** Schedules every layer of a recipe starting at `t`. Returns the absolute end time. */
export function playRecipe(ctx: BaseAudioContext, recipe: Recipe, t: number, p: PlayParams): number {
  const voice = ctx.createGain();
  voice.gain.value = p.gain;
  const toDisconnect: AudioNode[] = [voice];
  let tail: AudioNode = voice;
  if (p.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(p.pan, -1, 1);
    voice.connect(pan);
    toDisconnect.push(pan);
    tail = pan;
  }
  tail.connect(p.dest);
  if (recipe.verb > 0) {
    const send = ctx.createGain();
    send.gain.value = recipe.verb;
    tail.connect(send);
    send.connect(p.reverbIn);
    toDisconnect.push(send);
  }

  const maxF = ctx.sampleRate * 0.45;
  const fc = (f: number) => clamp(f * p.pitch, 20, maxF);
  let pending = recipe.layers.length;
  let end = t;
  const done = () => {
    if (--pending <= 0) for (const n of toDisconnect) n.disconnect();
  };

  for (const l of recipe.layers) {
    const lt = t + l.at + (recipe.timeJitter > 0 ? p.rng() * recipe.timeJitter : 0);
    const span = layerEnd(l) - l.at;
    const lEnd = lt + span;
    end = Math.max(end, lEnd);
    const g = ctx.createGain();
    shapeEnvelope(g.gain, lt, l, l.gain);
    let src: AudioScheduledSourceNode;
    const chain: AudioNode[] = [g];
    if (l.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = l.wave;
      osc.frequency.setValueAtTime(fc(l.freq), lt);
      if (l.freqEnd) osc.frequency.exponentialRampToValueAtTime(fc(l.freqEnd), lEnd);
      if (l.detune) osc.detune.value = l.detune;
      src = osc;
      if (l.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = fc(l.lp);
        osc.connect(f);
        f.connect(g);
        chain.push(f);
      } else osc.connect(g);
    } else {
      const bs = ctx.createBufferSource();
      bs.buffer = p.noise;
      bs.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = l.filter;
      f.Q.value = l.q;
      f.frequency.setValueAtTime(fc(l.freq), lt);
      if (l.freqEnd) f.frequency.exponentialRampToValueAtTime(fc(l.freqEnd), lEnd);
      bs.connect(f);
      f.connect(g);
      chain.push(f);
      src = bs;
    }
    g.connect(voice);
    if (l.kind === 'noise') (src as AudioBufferSourceNode).start(lt, p.rng() * Math.max(0.1, p.noise.duration - 1));
    else src.start(lt);
    src.stop(lEnd + 0.02);
    src.onended = () => {
      for (const n of chain) n.disconnect();
      done();
    };
  }
  return end;
}

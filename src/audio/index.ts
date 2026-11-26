import type { ThemeId } from '../core/types';
import { Ambience } from './ambience';
import { scheduleSfx } from './engine';
import {
  canRetrigger,
  loadPrefs,
  recipeDuration,
  savePref,
  VoiceTracker,
  volumeToGain,
  clamp,
  finiteOr,
  type KeyValueStorage,
} from './helpers';
import { RECIPES } from './recipes';
import { buildGraph, createNoiseBuffer, type Graph } from './synth';
import type { PlayOptions, SfxId } from './types';

export type { SfxId } from './types';
export { SFX_IDS } from './types';

export interface GameAudio {
  /** Must be called from a user gesture at least once; safe to call repeatedly. */
  unlock(): void;
  play(id: SfxId, opts?: PlayOptions): void;
  /** Looping ambience bed per theme; null stops it. Crossfades over ~2 s. */
  setAmbience(theme: ThemeId | null): void;
  /** Slightly raises tension in the ambience during fights. */
  setCombat(active: boolean): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** 0..1 master volume. */
  setVolume(volume: number): void;
  dispose(): void;
}

const CROSSFADE = 2;

type CtxCtor = new () => AudioContext;

function contextCtor(): CtxCtor | null {
  const g = globalThis as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export function createAudio(opts: { storage?: KeyValueStorage } = {}): GameAudio {
  const storage = opts.storage;
  const prefs = loadPrefs(storage);
  let muted = prefs.muted;
  let volume = prefs.volume;

  let ctx: AudioContext | null = null;
  let graph: Graph | null = null;
  let noise: AudioBuffer | null = null;
  let ambience: Ambience | null = null;
  let wantTheme: ThemeId | null = null;
  let combat = false;
  let disposed = false;
  let failed = false;
  const voices = new VoiceTracker(12, 16);
  const lastPlayed = new Map<SfxId, number>();
  const rng = Math.random;

  const masterGain = () => (muted ? 0 : volumeToGain(volume));
  const applyMaster = () => {
    if (!ctx || !graph) return;
    try {
      graph.master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.03);
    } catch {
      /* ignore */
    }
  };

  const onVisibility = () => {
    if (!ctx || disposed) return;
    try {
      if (document.hidden) void ctx.suspend().catch(() => undefined);
      else void ctx.resume().catch(() => undefined);
    } catch {
      /* ignore */
    }
  };

  const syncAmbience = () => {
    if (!ctx || !graph || !noise) return;
    try {
      if (ambience && ambience.theme === wantTheme) return;
      if (ambience) {
        ambience.fadeOutAndDispose(CROSSFADE);
        ambience = null;
      }
      if (wantTheme) {
        ambience = new Ambience(ctx, graph, noise, wantTheme, rng, CROSSFADE);
        ambience.setCombat(combat);
        ambience.start();
      }
    } catch {
      /* never throw into the game */
    }
  };

  const api: GameAudio = {
    unlock() {
      if (disposed || failed) return;
      try {
        if (!ctx) {
          const Ctor = contextCtor();
          if (!Ctor) {
            failed = true;
            return;
          }
          ctx = new Ctor();
          graph = buildGraph(ctx, ctx.destination);
          noise = createNoiseBuffer(ctx);
          graph.master.gain.value = masterGain();
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
          syncAmbience();
        }
        if (ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) {
          void ctx.resume().catch(() => undefined);
        }
      } catch {
        failed = true;
        ctx = null;
        graph = null;
      }
    },

    play(id, o = {}) {
      if (!ctx || !graph || !noise || muted || disposed) return;
      try {
        const recipe = RECIPES[id];
        if (!recipe) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        const t0 = ctx.currentTime + 0.005 + Math.max(0, finiteOr(o.delay, 0));
        if (!canRetrigger(lastPlayed.get(id), t0, recipe.minInterval)) return;
        const dur = recipeDuration(recipe) + recipe.timeJitter + 0.05;
        if (!voices.tryAcquire(t0, t0 + dur, recipe.prio)) return;
        lastPlayed.set(id, t0);
        scheduleSfx(ctx, graph, noise, id, t0, rng, {
          volume: o.volume,
          pan: o.pan,
          pitch: o.pitch,
        });
      } catch {
        /* never throw into the game */
      }
    },

    setAmbience(theme) {
      wantTheme = theme;
      syncAmbience();
    },

    setCombat(active) {
      combat = active;
      ambience?.setCombat(active);
    },

    setMuted(m) {
      muted = !!m;
      savePref(storage, 'muted', muted);
      applyMaster();
    },
    isMuted: () => muted,

    setVolume(v) {
      volume = clamp(finiteOr(v, volume), 0, 1);
      savePref(storage, 'volume', volume);
      applyMaster();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        ambience?.dispose();
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
        void ctx?.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      ambience = null;
      ctx = null;
      graph = null;
    },
  };
  return api;
}

import { Game } from './game';
import type { GameOptions, StorageLike } from './game';
import { createAudio } from './audio';
import { createRenderer } from './render';
import { createUi } from './ui';

function parseOptions(search: string): GameOptions {
  const q = new URLSearchParams(search);
  const opts: GameOptions = {};
  const num = (key: string): number | undefined => {
    const v = q.get(key);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const seed = num('seed');
  if (seed !== undefined) opts.seed = seed >>> 0;
  const depth = num('depth');
  if (depth !== undefined) opts.depth = depth;
  const quality = q.get('quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') opts.quality = quality;
  if (q.get('autoplay') === '1') {
    opts.autoplay = true;
    opts.headless = true;
  }
  if (q.get('reveal') === '1') opts.reveal = true;
  return opts;
}

function browserStorage(): StorageLike {
  const memory = new Map<string, string>();
  return {
    get: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return memory.get(k) ?? null;
      }
    },
    set: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        memory.set(k, v);
      }
    },
    remove: (k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {
        memory.delete(k);
      }
    },
  };
}

function newSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1;
}

function start(): void {
  const canvas = document.getElementById('game-canvas');
  const root = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !root) throw new Error('Missing #game-canvas or #ui-root');
  const options = parseOptions(window.location.search);
  const renderer = createRenderer(canvas, options.quality ? { quality: options.quality } : {});
  const ui = createUi(root);
  const storage = browserStorage();
  const audio = createAudio({ storage });
  const unlock = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const game = new Game({
    renderer,
    ui,
    audio,
    storage,
    delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    newSeed,
    options,
  });
  window.addEventListener('keydown', (e) => game.handleKey(e.key));
  if (import.meta.env.DEV) (window as unknown as { __tf: unknown }).__tf = { game, renderer, ui, audio };
  game.boot().catch((err) => {
    console.error('Game crashed', err);
  });
}

start();

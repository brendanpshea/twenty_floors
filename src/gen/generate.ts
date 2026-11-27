import { Rng, hashSeed } from '../core/rng';
import type { FloorPlan, ThemeId } from '../core/types';
import { roomFeatures, type RoomFeatures } from './features';
import { GenFail } from './grid';
import { buildGraph, fallbackGraph } from './graph';
import type { Layout } from './layout';
import { finalize, type FinalizeReport } from './post';
import { genCrypt } from './themes/crypt';
import { genDepths } from './themes/depths';
import { genForest, genMarsh, genPeaks } from './themes/outdoor';
import { genFoundry } from './themes/foundry';
import { genFungal } from './themes/fungal';
import { genHell } from './themes/hell';
import { genHold } from './themes/hold';
import { genIce } from './themes/ice';
import { genLair } from './themes/lair';
import { genLibrary } from './themes/library';
import { genRuin } from './themes/ruin';
import { genSewers } from './themes/sewers';
import { genWarrens } from './themes/warrens';
import { validateFloor } from './validate';

export interface GenerateOptions {
  seed: number;
  depth: number;
  theme: ThemeId;
}

export interface GenerateReport {
  plan: FloorPlan;
  /** Attempts used (1 = first try). */
  attempts: number;
  /** True if the guaranteed fallback layout was used. */
  fallback: boolean;
  /** Why earlier attempts were discarded (for tuning and tests). */
  failures: string[];
  /** Tier of each rest spot (0 = purpose-built nook on the intended passage ... 3 = any quiet cell). */
  restTiers: number[];
  /** Name of the set piece built on this floor, if any. */
  setPiece?: string;
  /** The terrain a room offers (hazard edge, cover, chokepoint, height); computed on demand. */
  features(roomId: number): RoomFeatures;
}

const MAX_ATTEMPTS = 24;

/**
 * Deterministic floor generation. Each attempt derives its own seed; an attempt
 * that fails (GenFail or validation) is discarded. After MAX_ATTEMPTS a simple
 * fixed layout is used so the call always returns a valid floor.
 */
export function generateFloor(opts: GenerateOptions): FloorPlan {
  return generateFloorReport(opts).plan;
}

export function generateFloorReport(opts: GenerateOptions): GenerateReport {
  const depth = Math.max(1, Math.floor(opts.depth));
  const req = { seed: opts.seed, depth, theme: opts.theme };
  const failures: string[] = [];
  const root = hashSeed(opts.seed, `gen:${opts.theme}:${depth}`);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = new Rng(hashSeed(root, `attempt:${attempt}`));
    try {
      const graph = buildGraph(rng.fork('graph'), depth);
      const layoutRng = rng.fork('layout');
      let layout: Layout;
      switch (opts.theme) {
        case 'warrens':
          layout = genWarrens(graph, layoutRng, depth);
          break;
        case 'crypt':
          layout = genCrypt(graph, layoutRng);
          break;
        case 'depths':
          layout = genDepths(graph, layoutRng, depth);
          break;
        case 'foundry':
          layout = genFoundry(graph, layoutRng, depth);
          break;
        case 'fungal':
          layout = genFungal(graph, layoutRng, depth);
          break;
        case 'ice':
          layout = genIce(graph, layoutRng, depth);
          break;
        case 'forest':
          layout = genForest(graph, layoutRng, depth);
          break;
        case 'marsh':
          layout = genMarsh(graph, layoutRng, depth);
          break;
        case 'peaks':
          layout = genPeaks(graph, layoutRng, depth);
          break;
        case 'hell':
          layout = genHell(graph, layoutRng);
          break;
        case 'lair':
          layout = genLair(graph, layoutRng, depth);
          break;
        case 'hold':
          layout = genHold(graph, layoutRng);
          break;
        case 'library':
          layout = genLibrary(graph, layoutRng);
          break;
        case 'ruin':
          layout = genRuin(graph, layoutRng);
          break;
        case 'sewers':
          layout = genSewers(graph, layoutRng);
          break;
      }
      const info: FinalizeReport = { restTiers: [] };
      const plan = finalize(layout, req, rng.fork('post'), info);
      const errs = validateFloor(plan);
      if (errs.length === 0) return { plan, attempts: attempt + 1, fallback: false, failures, restTiers: info.restTiers, setPiece: info.setPiece, features: (id) => roomFeatures(plan, id) };
      failures.push(`invalid: ${errs[0]}`);
    } catch (e) {
      if (!(e instanceof GenFail)) throw e;
      failures.push(e.message);
    }
  }
  const plan = fallbackPlan(req);
  return { plan, attempts: MAX_ATTEMPTS, fallback: true, failures, restTiers: [], features: (id) => roomFeatures(plan, id) };
}

/** A fixed six-room crypt-style layout; used only if every attempt failed. */
export function fallbackPlan(req: { seed: number; depth: number; theme: ThemeId }): FloorPlan {
  for (let k = 0; k < 8; k++) {
    const rng = new Rng(hashSeed(req.seed, `fallback:${k}`));
    try {
      const layout = genCrypt(fallbackGraph(), rng.fork('layout'), {
        forced: [
          [0, 0],
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [3, 0],
        ],
        plain: true,
      });
      return finalize(layout, req, rng.fork('post'));
    } catch (e) {
      if (!(e instanceof GenFail)) throw e;
    }
  }
  throw new Error('fallback layout failed');
}

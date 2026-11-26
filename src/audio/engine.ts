import { CAL } from './calibration';
import { clamp, finiteOr, vary, type Rng } from './helpers';
import { RECIPES } from './recipes';
import { playRecipe, type Graph } from './synth';
import type { SfxId } from './types';

/** Schedules one sound effect at absolute time `t`. Returns its end time. */
export function scheduleSfx(
  ctx: BaseAudioContext,
  graph: Graph,
  noise: AudioBuffer,
  id: SfxId,
  t: number,
  rng: Rng,
  opts: { volume?: number; pan?: number; pitch?: number } = {},
): number {
  const recipe = RECIPES[id];
  const pitch = clamp(finiteOr(opts.pitch, 1), 0.25, 4) * vary(rng, recipe.pitchVar);
  return playRecipe(ctx, recipe, t, {
    dest: graph.sfx,
    reverbIn: graph.reverbIn,
    noise,
    gain: (CAL[id] ?? 1) * clamp(finiteOr(opts.volume, 1), 0, 2),
    pan: clamp(finiteOr(opts.pan, 0), -1, 1),
    pitch,
    rng,
  });
}

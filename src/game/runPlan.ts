import { THEMES, TOTAL_FLOORS, planRunThemes, themeForDepth } from '../core/themes';
import type { ThemeId } from '../core/types';
import type { GameOptions } from './deps';

/** The plans already computed, by run seed. A plan is a pure function of the seed, so this is only a cache. */
const plans = new Map<number, readonly ThemeId[]>();

/** The twenty themes of a run (index 0 is floor 1). Derived from the run seed; never saved. */
export function runThemes(runSeed: number): readonly ThemeId[] {
  let plan = plans.get(runSeed);
  if (!plan) {
    plan = planRunThemes(runSeed);
    if (plans.size > 16) plans.clear();
    plans.set(runSeed, plan);
  }
  return plan;
}

/** Whether the dev shortcuts (?depth=, ?theme=, ?autoplay=) start the run. */
export function isDevStart(options: GameOptions): boolean {
  return options.depth !== undefined || options.theme !== undefined || options.autoplay === true;
}

/** The floor a dev start begins on. */
export function devStartDepth(options: GameOptions): number {
  return Math.max(1, Math.min(TOTAL_FLOORS, Math.floor(options.depth ?? 1) || 1));
}

/**
 * The theme of floor `depth` of the run: the planned one, except that a dev `?theme=` forces it on the
 * floor the dev start began on.
 */
export function floorTheme(runSeed: number, depth: number, options: GameOptions = {}): ThemeId {
  if (options.theme !== undefined && Object.hasOwn(THEMES, options.theme) && depth === devStartDepth(options)) return options.theme;
  const d = Math.max(1, Math.min(TOTAL_FLOORS, Math.floor(depth) || 1));
  return runThemes(runSeed)[d - 1] ?? themeForDepth(d);
}

import type { CompanionState, GridPos } from '../core/types';
import { companionLongRest, companionNeedsRest, createCompanion, getCompanion, isChasmEdge, isChokepoint, nextToHazard } from '../rules';
import { cellDistance } from './fog';
import type { CompanionRuntime, FloorState } from './floorState';
import { samePos } from './floorState';

/** The companion ids, in the order the headless hub cycles through them. */
export const COMPANION_IDS = ['sphinx_of_wonder', 'pseudodragon', 'blink_dog'] as const;

/** Whether the cell holds something the companion must not stand on. */
function taken(state: FloorState, p: GridPos): boolean {
  return (
    samePos(p, state.player.pos) ||
    state.monsters.some((m) => !m.creature.dead && m.creature.hp > 0 && samePos(m.creature.pos, p)) ||
    state.chests.some((c) => samePos(c.pos, p)) ||
    state.restSites.some((r) => samePos(r.pos, p)) ||
    samePos(p, state.plan.exit)
  );
}

/**
 * A cell for the companion near `around`: free, walkable, and (when there is a choice) not a doorway, a narrow
 * corridor or a drop edge, so it never plugs the way. Nearest to `from` (default `around`) wins.
 */
export function companionSpot(state: FloorState, around: GridPos, from: GridPos = around, maxRadius = 3): GridPos | null {
  let best: { p: GridPos; score: number } | null = null;
  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const p = { x: around.x + dx, y: around.y + dy };
      if ((dx === 0 && dy === 0) || !state.nav.inBounds(p) || !state.nav.isWalkable(p) || taken(state, p)) continue;
      if (!state.nav.hasLineOfSight(around, p) && cellDistance(around, p) > 1) continue;
      const awkward = isChokepoint(state.nav, p) || isChasmEdge(state.nav, p) || nextToHazard(state.nav, p) ? 6 : 0;
      const score = awkward + cellDistance(around, p) * 2 + cellDistance(from, p);
      if (!best || score < best.score) best = { p, score };
    }
  }
  return best ? best.p : null;
}

/** The companion runtime for a floor, standing beside `heroPos`. Null when the save has none or it is unknown. */
export function makeCompanionRuntime(state: FloorState, saved: CompanionState | undefined): CompanionRuntime | null {
  if (!saved) return null;
  const def = getCompanion(saved.id);
  if (!def) return null;
  const pos = companionSpot(state, state.player.pos) ?? { ...state.player.pos };
  const copy = JSON.parse(JSON.stringify(saved)) as CompanionState;
  return { def, state: copy, creature: createCompanion(def, state.pc.level, copy, pos), downed: false };
}

/** Rebuild the companion creature from its saved state (after a fight or a rest), keeping its cell. */
export function rebuildCompanion(state: FloorState): void {
  const rt = state.companion;
  if (!rt) return;
  rt.creature = createCompanion(rt.def, state.pc.level, rt.state, rt.creature.pos);
  rt.downed = false;
}

/** A short rest would heal the companion: it is hurt and has Hit Dice left. */
export function companionWantsShortRest(state: FloorState): boolean {
  const rt = state.companion;
  if (!rt) return false;
  return rt.creature.hp < rt.creature.maxHp && (rt.state.resources['_hitDice']?.current ?? 0) > 0;
}

/** A long rest would restore something for the companion. */
export function companionWantsLongRest(state: FloorState): boolean {
  const rt = state.companion;
  if (!rt) return false;
  const synced = { ...rt.state, hp: Math.min(rt.state.hp, rt.creature.hp > 0 ? rt.creature.hp : rt.state.hp) };
  return companionNeedsRest(synced, rt.def, state.pc.level);
}

/** The companion state after a long rest at the hero's current level. */
export function longRested(state: FloorState): CompanionState | null {
  const rt = state.companion;
  return rt ? companionLongRest(rt.state, rt.def, state.pc.level) : null;
}

/** A default companion for a headless run or a dev start: cycle by seed. */
export function defaultCompanionId(seed: number): string {
  return COMPANION_IDS[Math.abs(Math.floor(seed)) % COMPANION_IDS.length] as string;
}



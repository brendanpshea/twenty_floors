/**
 * Blocking props that hurt a creature pushed into them (see NavGrid.obstacleAt). Decided per prop
 * type over the whole vocabulary (PROP_BLOCKING in validate.ts); props not listed are harmless
 * (pillars, crates, barrels, statues, bookshelves, tables, trees, boulders and so on).
 */
export type ObstacleKind = 'fire' | 'spikes';

export const PROP_OBSTACLE: Readonly<Record<string, ObstacleKind>> = {
  // Burning or molten: fire damage.
  campfire: 'fire',
  brazier: 'fire',
  forge: 'fire',
  crucible: 'fire',
  candelabra: 'fire',
  // Pointed or jagged: piercing damage.
  stalagmite: 'spikes',
  ice_spike: 'spikes',
  crystal: 'spikes',
  weapon_rack: 'spikes',
  palisade: 'spikes',
  iron_bars: 'spikes',
  dragon_bones: 'spikes',
};

export function obstacleOfProp(type: string): ObstacleKind | 'none' {
  return PROP_OBSTACLE[type] ?? 'none';
}

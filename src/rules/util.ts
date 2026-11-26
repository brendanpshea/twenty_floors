import type { Ability, Creature, GridPos } from '../core/types';

export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level (SRD 5.2): +2 at 1-4, +3 at 5-8, ... */
export function proficiencyForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/** Grid distance: diagonals cost 1, so Chebyshev distance. */
export function chebyshev(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isAlive(c: Creature): boolean {
  return !c.dead && c.hp > 0;
}

/** Player and allies are one side; everything else the other. */
export function isFriendlySide(c: Creature): boolean {
  return c.faction !== 'enemy';
}

export function areHostile(a: Creature, b: Creature): boolean {
  return isFriendlySide(a) !== isFriendlySide(b);
}

/**
 * Hidden creature flags are resource pools whose key starts with '_' and whose
 * max is 0 (e.g. '_crit19'). The UI should not list them. They exist because
 * Creature has no field for crit range, save advantage or initiative advantage.
 */
export function hasFlag(c: Creature, name: string): boolean {
  return c.resources['_' + name] !== undefined;
}

export function flagPool(name: string): Creature['resources'][string] {
  return { name, current: 0, max: 0, refresh: 'longRest' };
}

export function isHiddenResource(key: string): boolean {
  return key.startsWith('_');
}

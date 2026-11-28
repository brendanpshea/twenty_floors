/** Shared helpers for the renderer: world mapping and cheap deterministic hashing. */

/** World units per grid cell. Cell (x, y) covers X in [2x, 2x+2], Z in [2y, 2y+2]. */
export const CELL = 2;
/** World units of height per elevation step. */
export const STEP = 1;

export const cellCenter = (c: number): number => c * CELL + CELL / 2;

/** Deterministic hash of two ints to [0, 1). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Scale applied to hemisphere/key light so characters are not blown out; baked floor light compensates. */
export const ENTITY_LIGHT = 0.8;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest signed angle difference b - a, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Small clutter that a FloorDetail theme scatters off the tile centre (render only: the prop stays in its cell). */
const SCATTER = new Set(['rubble', 'bones', 'urn', 'skull_pile', 'book_pile']);

/** World-space offset of a prop from its cell centre: none unless the theme has floor detail and the prop is clutter. */
export function propScatter(type: string, x: number, y: number, detail: boolean): [number, number] {
  if (!detail || !SCATTER.has(type)) return [0, 0];
  return [(hash2(x, y, 71) - 0.5) * 0.7, (hash2(x, y, 72) - 0.5) * 0.7];
}

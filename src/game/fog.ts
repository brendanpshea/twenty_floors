import type { GridPos, NavGrid } from '../core/types';
import { CellKind } from '../core/types';

export const SIGHT_RADIUS = 9;

/** Chebyshev distance between two cells (diagonals cost 1, like movement). */
export function cellDistance(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Mark every cell within SIGHT_RADIUS that the viewer has line of sight to,
 * then the wall/void cells that border seen floor. Returns true if the mask changed.
 */
export function revealFrom(
  seen: Uint8Array,
  kinds: Uint8Array,
  nav: NavGrid,
  from: GridPos,
  radius = SIGHT_RADIUS,
): boolean {
  const w = nav.width;
  const h = nav.height;
  let changed = false;
  const visible: number[] = [];
  const x0 = Math.max(0, from.x - radius);
  const x1 = Math.min(w - 1, from.x + radius);
  const y0 = Math.max(0, from.y - radius);
  const y1 = Math.min(h - 1, from.y + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - from.x;
      const dy = y - from.y;
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const i = y * w + x;
      const k = kinds[i];
      if (k === CellKind.Void || k === CellKind.Wall) continue;
      const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      if (near || nav.hasLineOfSight(from, { x, y })) visible.push(i);
    }
  }
  const mark = (i: number): void => {
    if (!seen[i]) {
      seen[i] = 1;
      changed = true;
    }
  };
  for (const i of visible) {
    mark(i);
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const k = kinds[j];
        if (k === CellKind.Wall || k === CellKind.Void) mark(j);
      }
    }
  }
  return changed;
}

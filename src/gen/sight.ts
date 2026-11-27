import { CellKind } from '../core/types';

const isBlock = (k: number): boolean => k === CellKind.Wall || k === CellKind.Void;

/**
 * Line of sight between the centres of two in-bounds cells over a kinds array: only Wall and Void
 * block it. Symmetric (the endpoints are put in a canonical order) and allocation-free. This is
 * the one implementation behind NavGrid.hasLineOfSight and the generator's own sight tests.
 */
export function lineOfSight(kinds: Uint8Array, w: number, ax: number, ay: number, bx: number, by: number): boolean {
  if (ay * w + ax > by * w + bx) {
    const tx = ax;
    ax = bx;
    bx = tx;
    const ty = ay;
    ay = by;
    by = ty;
  }
  if (isBlock(kinds[ay * w + ax] as number) || isBlock(kinds[by * w + bx] as number)) return false;
  const nx = Math.abs(bx - ax);
  const ny = Math.abs(by - ay);
  const sx = bx > ax ? 1 : -1;
  const sy = by > ay ? 1 : -1;
  let x = ax;
  let y = ay;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (d === 0) {
      // Exactly through a corner: blocked only if both side cells block.
      if (isBlock(kinds[y * w + x + sx] as number) && isBlock(kinds[(y + sy) * w + x] as number)) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (d < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if ((x !== bx || y !== by) && isBlock(kinds[y * w + x] as number)) return false;
  }
  return true;
}

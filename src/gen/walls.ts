import { Grid, K, NEI8, isWalkKind } from './grid';

/** Every Void cell touching walkable or Chasm cells becomes a Wall with the highest adjacent walkable elevation. */
export function addWalls(g: Grid): void {
  refreshWalls(g, 0, 0, g.w - 1, g.h - 1);
  for (let i = 0; i < g.w * g.h; i++) if (g.kinds[i] === K.Chasm) g.elev[i] = 0;
}

/** Re-derive walls inside a rectangle (used after the whole-grid pass and after carving nooks). */
export function refreshWalls(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
  const { w, h } = g;
  const ax0 = Math.max(0, x0);
  const ay0 = Math.max(0, y0);
  const ax1 = Math.min(w - 1, x1);
  const ay1 = Math.min(h - 1, y1);
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const i = y * w + x;
      if (g.kinds[i] !== K.Void) continue;
      for (const [dx, dy] of NEI8) {
        const k = g.kind(x + dx, y + dy);
        if (isWalkKind(k) || k === K.Chasm) {
          g.kinds[i] = K.Wall;
          break;
        }
      }
    }
  }
  for (let y = ay0; y <= ay1; y++) {
    for (let x = ax0; x <= ax1; x++) {
      const i = y * w + x;
      if (g.kinds[i] !== K.Wall) continue;
      let best = 0;
      for (const [dx, dy] of NEI8) {
        if (g.walkable(x + dx, y + dy)) best = Math.max(best, g.elev[(y + dy) * w + x + dx] as number);
      }
      g.elev[i] = best;
    }
  }
}

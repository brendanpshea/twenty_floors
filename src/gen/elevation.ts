import { Grid, NEI8, isWalkKind } from './grid';

export type SlopeStyle = 'mid' | 'low' | 'high';

const INF = 30000;
const OFF = 160;

/**
 * Lipschitz elevation solver.
 *
 * Fixed cells (rooms, platforms) keep their elevation. Every other walkable cell
 * gets a value v with |v(a) - v(b)| <= 1 for all 8-neighbours, so any slope is a
 * real staircase. For each cell, U = min over anchors (e + distance) is the
 * highest legal value and L = max over anchors (e - distance) the lowest.
 *   - 'mid'  spreads the slope evenly (round((L+U)/2)),
 *   - 'high' climbs one step per cell from the lower anchor and then plateaus,
 *   - 'low'  stays low and climbs right before the higher anchor.
 * The style is chosen per connected region of free cells so that neighbouring
 * free cells always agree. Returns false if some free cell is unreachable.
 */
export function solveElevation(g: Grid, fixed: Uint8Array, pickStyle: () => SlopeStyle): boolean {
  const n = g.w * g.h;
  const up = relax(g, fixed, 1);
  const down = relax(g, fixed, -1);
  const comp = new Int32Array(n).fill(-1);
  const styles: SlopeStyle[] = [];
  let ok = true;
  for (let s = 0; s < n; s++) {
    if (fixed[s] || comp[s] !== -1 || !isWalkKind(g.kinds[s] as number)) continue;
    const id = styles.length;
    styles.push(pickStyle());
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % g.w;
      const y = (i / g.w) | 0;
      for (const [dx, dy] of NEI8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!g.inb(nx, ny)) continue;
        const j = ny * g.w + nx;
        if (fixed[j] || comp[j] !== -1 || !isWalkKind(g.kinds[j] as number)) continue;
        comp[j] = id;
        stack.push(j);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (fixed[i] || !isWalkKind(g.kinds[i] as number)) continue;
    const u = up[i] as number;
    const dn = down[i] as number;
    if (u >= INF || dn >= INF) {
      ok = false;
      continue;
    }
    const hi = u;
    const lo = -dn;
    const style = styles[comp[i] as number] as SlopeStyle;
    g.elev[i] = style === 'high' ? hi : style === 'low' ? lo : Math.round((hi + lo) / 2);
  }
  return ok;
}

/** min over fixed anchors of (sign*elev + 8-neighbour distance through free walkable cells). */
function relax(g: Grid, fixed: Uint8Array, sign: number): Int16Array {
  const n = g.w * g.h;
  const val = new Int16Array(n).fill(INF);
  const buckets: number[][] = Array.from({ length: OFF * 2 + 400 }, () => []);
  for (let i = 0; i < n; i++) {
    if (fixed[i] && isWalkKind(g.kinds[i] as number)) {
      const v = sign * (g.elev[i] as number);
      val[i] = v;
      (buckets[v + OFF] as number[]).push(i);
    }
  }
  for (let b = 0; b < buckets.length - 1; b++) {
    const list = buckets[b] as number[];
    for (let k = 0; k < list.length; k++) {
      const i = list[k] as number;
      if ((val[i] as number) !== b - OFF) continue;
      const x = i % g.w;
      const y = (i / g.w) | 0;
      for (const [dx, dy] of NEI8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!g.inb(nx, ny)) continue;
        const j = ny * g.w + nx;
        if (fixed[j] || !isWalkKind(g.kinds[j] as number)) continue;
        const nv = b - OFF + 1;
        if (nv < (val[j] as number)) {
          val[j] = nv;
          (buckets[nv + OFF] as number[]).push(j);
        }
      }
    }
  }
  return val;
}

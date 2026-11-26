import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K, NEI8, dist, fbm2 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';

/**
 * The Goblin Warrens: organic caves.
 *
 * 1. Rooms are placed by a random walk over the mission tree: each child lands
 *    at a random bearing 3.5-7 cells beyond its parent's blob, keeping clear
 *    of every other room (best of 30 candidates, preferring open space).
 * 2. Each chamber is a noise-thresholded blob (distance to an ellipse plus
 *    value noise), smoothed with two cellular-automaton passes.
 * 3. Tunnels are biased drunkard walks from blob to blob, 1 or 2 cells wide,
 *    switching width every 5-10 steps and wiggling sideways now and then.
 *    A tunnel that scrapes a third chamber or another tunnel is re-rolled.
 * 4. Each chamber gets a base height (random walk over the tree, +/-1 steps);
 *    mounds add +1 where low-frequency noise is high; tunnels are solved with
 *    the Lipschitz solver so every slope is a staircase.
 * 5. Water pools and the occasional chasm pit are carved last; props compose
 *    goblin camps (campfire, crates, barrels, bones), stalagmite clusters and
 *    wall-hugging mushroom patches.
 *
 * Tunables: size formula, blob radii, noise amplitude 0.55, tunnel wiggle 0.22,
 * pool chance 0.45 per eligible room, pit chance 0.45, camp chance 0.5.
 */

interface Blob {
  id: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  ext: number;
  role: RoomRole;
}

export function genWarrens(graph: MissionGraph, rng: Rng, depth: number): Layout {
  void depth;
  const n = graph.roles.length;
  const W = clampInt(34 + Math.round(n * 2.8) + rng.int(-3, 3), 40, 62);
  const H = clampInt(34 + Math.round(n * 2.8) + rng.int(-3, 3), 40, 62);
  const blobs = placeBlobs(graph, rng, W, H);
  const g = new Grid(W, H);
  const noiseSeed = rng.int(1, 1e9);

  for (const b of blobs) carveBlob(g, b, noiseSeed, rng);
  for (const b of blobs) {
    let count = 0;
    for (let i = 0; i < W * H; i++) if (g.room[i] === b.id) count++;
    const min = b.role === 'treasure' ? 14 : b.role === 'entrance' ? 20 : b.role === 'boss' ? 40 : 26;
    if (count < min) throw new GenFail('chamber too small');
  }

  const edges: Array<[number, number]> = [];
  for (const [a, b] of graph.edges) {
    if (!tryTunnel(g, rng, blobs[a] as Blob, blobs[b] as Blob, 8)) throw new GenFail('tunnel failed');
    edges.push([a, b]);
  }
  for (const [a, b] of graph.optional) {
    const dx = (blobs[a] as Blob).cx - (blobs[b] as Blob).cx;
    const dy = (blobs[a] as Blob).cy - (blobs[b] as Blob).cy;
    if (dx * dx + dy * dy > 20 * 20) continue;
    if (tryTunnel(g, rng, blobs[a] as Blob, blobs[b] as Blob, 4)) edges.push([a, b]);
  }

  // Elevation: random walk of chamber heights, mounds, solved tunnels.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) base.push(1);
    else {
      const d = rng.weighted([-1, 0, 1, 2, -2], [3, 4, 3, 0.8, 0.4]);
      base.push(clampInt((base[p] as number) + d, 0, 5));
    }
  }
  const mound = rng.int(1, 1e9);
  const fixed = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const id = g.room[i] as number;
      if (id < 0 || g.kinds[i] !== K.Floor) continue;
      g.elev[i] = (base[id] as number) + (fbm2(mound, x * 0.16, y * 0.16) > 0.62 ? 1 : 0);
      fixed[i] = 1;
    }
  }
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('warrens elevation unsolved');

  carvePools(g, rng, blobs);
  carvePits(g, rng, blobs);

  return { grid: g, roles: graph.roles, edges, decorate: (ctx) => decorate(ctx) };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// ---------------------------------------------------------------------------

function placeBlobs(graph: MissionGraph, rng: Rng, W: number, H: number): Blob[] {
  const shrink = graph.roles.length > 8 ? 0.88 : 1;
  for (let attempt = 0; attempt < 120; attempt++) {
    const blobs: Blob[] = [];
    let ok = true;
    for (let i = 0; i < graph.roles.length && ok; i++) {
      const role = graph.roles[i] as RoomRole;
      const r =
        role === 'boss' ? rng.range(5.6, 6.6) : role === 'treasure' ? rng.range(2.9, 3.6) : role === 'entrance' ? rng.range(3.2, 4) : rng.range(3.7, 5);
      const rx = r * shrink * rng.range(0.85, 1.12);
      const ry = r * shrink * rng.range(0.85, 1.12);
      const ext = Math.max(rx, ry) * 1.28;
      const m = ext + 3;
      if (i === 0) {
        blobs.push({ id: 0, cx: rng.range(m, W - m), cy: rng.range(m, H - m), rx, ry, ext, role });
        continue;
      }
      const p = blobs[graph.parent[i] as number] as Blob;
      let best: Blob | null = null;
      let bs = -Infinity;
      for (let t = 0; t < 30; t++) {
        // A random bearing; half the time pulled toward the middle of the map so chains do not run off the edge.
        let vx = rng.range(-1, 1);
        let vy = rng.range(-1, 1);
        if (rng.chance(0.5)) {
          const tx = W / 2 - p.cx;
          const ty = H / 2 - p.cy;
          const tl = dist(tx, ty) || 1;
          vx = vx * 0.7 + tx / tl;
          vy = vy * 0.7 + ty / tl;
        }
        const vl = dist(vx, vy) || 1;
        const d = p.ext + ext + rng.range(3.5, 7);
        const cx = p.cx + (vx / vl) * d;
        const cy = p.cy + (vy / vl) * d;
        if (cx < m || cy < m || cx > W - m - 1 || cy > H - m - 1) continue;
        let clear = Infinity;
        let bad = false;
        for (const o of blobs) {
          const gap = dist(o.cx - cx, o.cy - cy) - o.ext - ext;
          if (gap < (o === p ? 3 : 2.5)) bad = true;
          if (o !== p) clear = Math.min(clear, gap);
        }
        if (bad) continue;
        const score = Math.min(clear, 12) + rng.next() * 3;
        if (score > bs) {
          bs = score;
          best = { id: i, cx, cy, rx, ry, ext, role };
        }
      }
      if (!best) ok = false;
      else blobs.push(best);
    }
    if (ok) return blobs;
  }
  throw new GenFail('could not place chambers');
}

function carveBlob(g: Grid, b: Blob, seed: number, rng: Rng): void {
  const x0 = Math.floor(b.cx - b.ext - 1);
  const y0 = Math.floor(b.cy - b.ext - 1);
  const size = Math.ceil(b.ext * 2 + 3);
  const mask = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = x0 + i;
      const y = y0 + j;
      const dx = (x - b.cx) / b.rx;
      const dy = (y - b.cy) / b.ry;
      const val = 1 - Math.sqrt(dx * dx + dy * dy) + (fbm2(seed, x * 0.28, y * 0.28) - 0.5) * 0.55;
      if (val > 0 || (dx * dx + dy * dy < 0.12)) mask[j * size + i] = 1;
    }
  }
  // Cellular-automaton smoothing.
  for (let pass = 0; pass < 2; pass++) {
    const next = mask.slice();
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        let c = 0;
        for (const [dx, dy] of NEI8) c += mask[(j + dy) * size + i + dx] as number;
        const k = j * size + i;
        if (c >= 5) next[k] = 1;
        else if (c <= 3) next[k] = 0;
      }
    }
    mask.set(next);
  }
  // Keep only the component around the centre.
  const ci = Math.round(b.cx) - x0;
  const cj = Math.round(b.cy) - y0;
  const start = cj * size + ci;
  mask[start] = 1;
  const keep = new Uint8Array(size * size);
  const stack = [start];
  keep[start] = 1;
  while (stack.length) {
    const k = stack.pop() as number;
    const i = k % size;
    const j = (k / size) | 0;
    for (let d = 0; d < 8; d += 2) {
      const [dx, dy] = NEI8[d] as readonly [number, number];
      const ni = i + dx;
      const nj = j + dy;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nk = nj * size + ni;
      if (mask[nk] && !keep[nk]) {
        keep[nk] = 1;
        stack.push(nk);
      }
    }
  }
  void rng;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (keep[j * size + i]) g.floor(x0 + i, y0 + j, 0, b.id);
    }
  }
}

function tryTunnel(g: Grid, rng: Rng, a: Blob, b: Blob, tries: number): boolean {
  for (let t = 0; t < tries; t++) {
    const cells = walkTunnel(g, rng, a, b);
    if (cells) {
      for (const [x, y] of cells) if (g.kinds[g.idx(x, y)] === K.Void) g.floor(x, y, 0, -1);
      return true;
    }
  }
  return false;
}

function nearestCell(g: Grid, id: number, tx: number, ty: number): [number, number] {
  let best: [number, number] = [-1, -1];
  let bd = Infinity;
  for (let i = 0; i < g.w * g.h; i++) {
    if (g.room[i] !== id || g.kinds[i] !== K.Floor) continue;
    const x = i % g.w;
    const y = (i / g.w) | 0;
    const d = (x - tx) ** 2 + (y - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = [x, y];
    }
  }
  return best;
}

/** One drunkard-walk attempt; returns cells to carve, or null if it scraped something it should not. */
function walkTunnel(g: Grid, rng: Rng, a: Blob, b: Blob): Array<[number, number]> | null {
  const [sx, sy] = nearestCell(g, a.id, b.cx, b.cy);
  const [gx, gy] = nearestCell(g, b.id, a.cx, a.cy);
  if (sx < 0 || gx < 0) return null;
  let x = sx;
  let y = sy;
  const cells: Array<[number, number]> = [];
  let width = 1;
  let widthLeft = rng.int(5, 10);
  let wiggle = 0;
  let wdx = 0;
  let wdy = 0;
  let reached = false;
  for (let step = 0; step < 300; step++) {
    const rx = gx - x;
    const ry = gy - y;
    let mx = 0;
    let my = 0;
    if (wiggle > 0) {
      mx = wdx;
      my = wdy;
      wiggle--;
    } else {
      let useX = Math.abs(rx) >= Math.abs(ry);
      if (rng.chance(0.25)) useX = !useX;
      if (useX && rx === 0) useX = false;
      else if (!useX && ry === 0) useX = true;
      if (useX) mx = Math.sign(rx);
      else my = Math.sign(ry);
      if (rng.chance(0.22)) {
        wiggle = rng.int(1, 3);
        const s = rng.chance(0.5) ? 1 : -1;
        wdx = my !== 0 ? s : 0;
        wdy = mx !== 0 ? s : 0;
        if (wdx === 0 && wdy === 0) wiggle = 0;
      }
    }
    const nx = x + mx;
    const ny = y + my;
    if (nx < 4 || ny < 4 || nx > g.w - 5 || ny > g.h - 5) {
      wiggle = 0;
      if (mx === 0 && my === 0) return null;
      continue;
    }
    x = nx;
    y = ny;
    cells.push([x, y]);
    if (--widthLeft <= 0) {
      width = width === 1 ? (rng.chance(0.5) ? 2 : 1) : rng.chance(0.65) ? 1 : 2;
      widthLeft = rng.int(5, 10);
    }
    if (width === 2) cells.push(my === 0 ? [x, y + 1] : [x + 1, y]);
    if (g.room[g.idx(x, y)] === b.id && g.kinds[g.idx(x, y)] === K.Floor) {
      reached = true;
      break;
    }
  }
  if (!reached) return null;
  // Reject tunnels that scrape third rooms or run alongside other tunnels.
  let touches = 0;
  for (const [cx, cy] of cells) {
    if (!g.inb(cx, cy)) return null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (!g.inb(px, py)) return null;
        const i = g.idx(px, py);
        if (g.kinds[i] !== K.Floor) continue;
        const id = g.room[i] as number;
        if (id >= 0 && id !== a.id && id !== b.id) return null;
        if (id === -1) touches++;
      }
    }
  }
  const mine = new Set(cells.map(([cx, cy]) => cy * g.w + cx));
  let foreign = 0;
  for (const [cx, cy] of cells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = (cy + dy) * g.w + cx + dx;
        if (g.kinds[i] === K.Floor && g.room[i] === -1 && !mine.has(i)) foreign++;
      }
    }
  }
  void touches;
  if (foreign > 6) return null;
  return cells;
}

// ---------------------------------------------------------------------------

function carvePools(g: Grid, rng: Rng, blobs: Blob[]): void {
  const seed = rng.int(1, 1e9);
  for (const b of blobs) {
    if (b.role === 'entrance' || b.role === 'treasure') continue;
    if (!rng.chance(0.45)) continue;
    const cells: number[] = [];
    for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === b.id && g.kinds[i] === K.Floor) cells.push(i);
    const c = rng.pick(cells);
    const px = c % g.w;
    const py = (c / g.w) | 0;
    const r = rng.range(1.8, 3.2);
    const pool = cells.filter((i) => {
      const x = i % g.w;
      const y = (i / g.w) | 0;
      return dist(x - px, y - py) < r + (fbm2(seed, x * 0.4, y * 0.4) - 0.5) * 1.6;
    });
    if (pool.length > cells.length * 0.35) continue;
    for (const i of pool) g.kinds[i] = K.Water;
  }
}

function carvePits(g: Grid, rng: Rng, blobs: Blob[]): void {
  const seed = rng.int(1, 1e9);
  for (const b of blobs) {
    if (b.role === 'entrance' || b.role === 'treasure') continue;
    if (b.role !== 'boss' && !(b.ext > 6.2)) continue;
    if (!rng.chance(0.5)) continue;
    const cand: number[] = [];
    for (let i = 0; i < g.w * g.h; i++) {
      if (g.room[i] !== b.id || g.kinds[i] !== K.Floor) continue;
      const x = i % g.w;
      const y = (i / g.w) | 0;
      let ok = true;
      for (let dy = -4; dy <= 4 && ok; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const j = (y + dy) * g.w + x + dx;
          if (!g.inb(x + dx, y + dy) || g.kinds[j] !== K.Floor || g.room[j] !== b.id) {
            ok = false;
            break;
          }
        }
      }
      if (ok && dist(x - b.cx, y - b.cy) > 1.5) cand.push(i);
    }
    if (cand.length === 0) continue;
    const c = rng.pick(cand);
    const px = c % g.w;
    const py = (c / g.w) | 0;
    const r = rng.range(1.4, 2.3);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = dist(dx, dy) + (fbm2(seed, (px + dx) * 0.5, (py + dy) * 0.5) - 0.5) * 1.2;
        if (d < r) g.kinds[(py + dy) * g.w + px + dx] = K.Chasm;
      }
    }
  }
}

// ---------------------------------------------------------------------------

function decorate(ctx: DecorCtx): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const free = (i: number): boolean => props.free(i % w, (i / w) | 0);
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const area = cells.length;
    const byEdge = (lo: number, hi: number): number[] => cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && free(i));

    // Goblin camp: campfire, supplies piled toward a wall, bones around.
    const wantCamp = r.role === 'boss' || (r.role === 'combat' && rng.chance(0.5));
    if (wantCamp) {
      const inner = byEdge(3, 99).filter((i) => dist(at(i)[0] - r.center.x, at(i)[1] - r.center.y) <= 5);
      if (inner.length) {
        const f = rng.pick(inner);
        const [fx, fy] = at(f);
        if (props.place('campfire', fx, fy, 0, true)) {
          const supply = byEdge(1, 3).filter((i) => {
            const d = dist(at(i)[0] - fx, at(i)[1] - fy);
            return d >= 3 && d <= 6;
          });
          if (supply.length) {
            const a = rng.pick(supply);
            const [ax, ay] = at(a);
            const count = rng.int(2, r.role === 'boss' ? 5 : 4);
            let placed = 0;
            const nearby = [[0, 0], ...NEI8].map(([dx, dy]) => [ax + (dx as number), ay + (dy as number)] as [number, number]);
            rng.shuffle(nearby);
            for (const [x, y] of nearby) {
              if (placed >= count) break;
              if (props.place(rng.chance(0.55) ? 'crate' : 'barrel', x, y, rng.int(0, 3), true)) placed++;
            }
          }
          for (let k = 0; k < (r.role === 'boss' ? 5 : 3); k++) {
            const near = cells.filter((i) => {
              const [x, y] = at(i);
              return dist(x - fx, y - fy) <= 3.5;
            });
            if (near.length) {
              const [x, y] = at(rng.pick(near));
              props.place('bones', x, y, rng.int(0, 3), false);
            }
          }
        }
      }
    }

    // Stalagmite clusters grow from cells near the walls.
    const clusters = r.role === 'entrance' ? 1 : Math.max(1, Math.round(area / 32) + rng.int(0, 2) - (r.role === 'treasure' ? 1 : 0));
    for (let c = 0; c < clusters; c++) {
      const seeds = byEdge(1, 3);
      if (!seeds.length) break;
      const s = rng.pick(seeds);
      const [sx, sy] = at(s);
      let placed = props.place('stalagmite', sx, sy, rng.int(0, 3), true) ? 1 : 0;
      const extra = rng.int(0, 2);
      const nbrs = rng.shuffle([...NEI8]);
      for (const [dx, dy] of nbrs) {
        if (placed > extra) break;
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) <= 4 && props.place('stalagmite', x, y, rng.int(0, 3), true)) placed++;
      }
    }

    // Glowing mushroom patches hug the walls.
    const patches = r.role === 'treasure' ? rng.int(2, 3) : rng.int(1, 2);
    for (let p = 0; p < patches; p++) {
      const seeds = byEdge(1, 1);
      if (!seeds.length) break;
      const [sx, sy] = at(rng.pick(seeds));
      props.place('mushrooms', sx, sy, rng.int(0, 3), false);
      for (const [dx, dy] of rng.shuffle([...NEI8]).slice(0, rng.int(1, 3))) {
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) === 1) props.place('mushrooms', x, y, rng.int(0, 3), false);
      }
    }

    // Litter.
    const litter = r.role === 'treasure' ? 3 : 2;
    for (let k = 0; k < litter; k++) {
      const spots = byEdge(1, 5);
      if (!spots.length) break;
      const [x, y] = at(rng.pick(spots));
      props.place(rng.chance(0.6) ? 'bones' : 'rubble', x, y, rng.int(0, 3), false);
    }
  }

  // A few mushrooms and rubble piles in the tunnels.
  const tunnel: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor && (edge[i] as number) === 1) tunnel.push(i);
  rng.shuffle(tunnel);
  for (let k = 0; k < Math.min(tunnel.length, 5); k++) {
    const [x, y] = at(tunnel[k] as number);
    props.place(k < 3 ? 'mushrooms' : 'rubble', x, y, rng.int(0, 3), false);
  }
}

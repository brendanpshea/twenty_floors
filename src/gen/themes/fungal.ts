import type { Rng } from '../../core/rng';
import { K, NEI4, NEI8, dist } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { genWarrens } from './warrens';

/**
 * The Fungal Caverns: the warrens' organic caves, overgrown.
 *
 * The cave recipe (noise blobs joined by wandering tunnels) is shared with the
 * Goblin Warrens; what changes is everything that grows in it. There are no
 * camps and no pits. Chambers are damp (pools are common) and stand under
 * giant mushrooms: tall, glowing, and solid enough to fight around. Small
 * mushrooms carpet the edges, webs hang in the tight corners and the bones of
 * whatever the spiders caught lie underneath.
 *
 * Set pieces: the grove (a ring of giant mushrooms round a clearing in a big
 * chamber, the brightest place on the floor), plus the lake, the stream, the
 * hall of rock columns and the chasm crack from the cave recipe.
 *
 * Tunables: pool chance, giant mushroom density (one cluster per ~30 cells),
 * web chance, patch counts.
 */
export function genFungal(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genWarrens(graph, rng, depth, {
    pieces: ['grove', 'lake', 'stream', 'columns', 'crack'],
    poolChance: 0.7,
    pitChance: 0,
    decorate,
  });
}

function decorate(ctx: DecorCtx, piece: { name: string; room: number }): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];
  const giant = (x: number, y: number): boolean => props.place('giant_mushroom', x, y, rng.int(0, 3), true);

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const byEdge = (lo: number, hi: number): number[] => cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && props.free(...at(i)));

    if (piece.name === 'grove' && r.id === piece.room) {
      // A ring of giants round the middle of the chamber, every other cell, and a carpet inside it.
      const ring = cells.filter((i) => {
        const [x, y] = at(i);
        const d = dist(x - r.center.x, y - r.center.y);
        return d >= 3 && d < 4.2 && (x + y) % 2 === 0;
      });
      for (const i of rng.shuffle(ring)) giant(...at(i));
      for (const i of cells) {
        const [x, y] = at(i);
        if (dist(x - r.center.x, y - r.center.y) < 2.6 && rng.chance(0.45)) props.place('mushrooms', x, y, rng.int(0, 3), false);
      }
    } else {
      // Clusters of giants a little in from the walls: one to three stalks each.
      const clusters = r.role === 'entrance' ? 1 : Math.max(1, Math.round(cells.length / 30) + rng.int(0, 1));
      for (let c = 0; c < clusters; c++) {
        const seeds = byEdge(2, 4);
        if (!seeds.length) break;
        const [sx, sy] = at(rng.pick(seeds));
        if (!giant(sx, sy)) continue;
        let extra = rng.int(0, 2);
        for (const [dx, dy] of rng.shuffle([...NEI8])) {
          if (extra <= 0) break;
          const x = sx + dx * 2;
          const y = sy + dy * 2;
          if (g.inb(x, y) && g.room[g.idx(x, y)] === r.id && (edge[g.idx(x, y)] as number) >= 2 && giant(x, y)) extra--;
        }
      }
    }

    // Small mushrooms hug the walls and the water.
    const patches = r.role === 'treasure' ? rng.int(3, 4) : rng.int(2, 4);
    for (let p = 0; p < patches; p++) {
      const seeds = byEdge(1, 1);
      if (!seeds.length) break;
      const [sx, sy] = at(rng.pick(seeds));
      props.place('mushrooms', sx, sy, rng.int(0, 3), false);
      for (const [dx, dy] of rng.shuffle([...NEI8]).slice(0, rng.int(1, 3))) {
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) <= 2) props.place('mushrooms', x, y, rng.int(0, 3), false);
      }
    }

    // Webs where two walls meet, with what is left of the spiders' meals below.
    for (const i of cells) {
      const [x, y] = at(i);
      if (!props.free(x, y)) continue;
      let walls = 0;
      let rot = 0;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = NEI4[d] as readonly [number, number];
        if (g.kind(x + dx, y + dy) === K.Wall) {
          walls++;
          rot = d;
        }
      }
      if (walls >= 2 && rng.chance(0.3)) props.place('cobweb', x, y, rot, false);
    }
    for (let k = 0; k < (r.role === 'boss' ? 5 : 2); k++) {
      const spots = byEdge(1, 3);
      if (!spots.length) break;
      props.place('bones', ...at(rng.pick(spots)), rng.int(0, 3), false);
    }
    // The odd stalagmite keeps it a cave.
    if (rng.chance(0.5)) {
      const spots = byEdge(1, 2);
      if (spots.length) props.place('stalagmite', ...at(rng.pick(spots)), rng.int(0, 3), true);
    }
  }

  // Tunnels: mushrooms along the walls, webs in the pinches.
  const tunnel: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor && (edge[i] as number) === 1) tunnel.push(i);
  rng.shuffle(tunnel);
  for (let k = 0; k < Math.min(tunnel.length, 9); k++) {
    const [x, y] = at(tunnel[k] as number);
    if (k < 6) props.place('mushrooms', x, y, rng.int(0, 3), false);
    else {
      const dir = props.wallDir(x, y, rng);
      if (dir >= 0) props.place('cobweb', x, y, dir, false);
    }
  }
}

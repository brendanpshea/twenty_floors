import type { Rng } from '../../core/rng';
import { K, NEI4, NEI8, dist } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { genWarrens } from './warrens';

/**
 * The Dragon's Lair: the last floor.
 *
 * The cave recipe once more, scorched. There is little standing water and
 * the pits and cracks are common (the renderer draws this theme's chasms as
 * lava). The set pieces are the crack, the tiers and the hall of columns
 * (and, where columns will not fit, the cave recipe's fallbacks).
 *
 * What fills it is what a dragon leaves behind: the bones of large things, in
 * runs of two or three so they read as one carcass, stalagmites, and gold.
 * The hoard thickens toward the end: a pile or two in an ordinary chamber, a
 * good haul in the treasure rooms, and in the boss's chamber a ring of it
 * round the middle, which is also most of the light.
 *
 * Tunables: pit and pool chance, gold per chamber, carcass chance.
 */
export function genLair(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genWarrens(graph, rng, depth, { pieces: ['crack', 'tiers', 'columns'], poolChance: 0.15, pitChance: 0.6, decorate });
}

function decorate(ctx: DecorCtx): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const byEdge = (lo: number, hi: number, blocking: boolean): number[] =>
      cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && props.can(...at(i), blocking));

    // The hoard.
    if (r.role === 'boss') {
      // A broken ring round the middle of the chamber: room to fight inside it and to come at it from outside.
      const ring = cells.filter((i) => {
        const [x, y] = at(i);
        const d = dist(x - r.center.x, y - r.center.y);
        return d >= 3 && d < 4.3 && (x + 2 * y) % 3 !== 0;
      });
      for (const i of rng.shuffle(ring)) props.place('gold_pile', ...at(i), rng.int(0, 3), true);
    }
    const piles = r.role === 'treasure' ? rng.int(3, 4) : r.role === 'combat' ? rng.int(0, 2) : r.role === 'boss' ? 3 : 0;
    for (let k = 0; k < piles; k++) {
      const spots = byEdge(1, 3, true);
      if (!spots.length) break;
      props.place('gold_pile', ...at(rng.pick(spots)), rng.int(0, 3), true);
    }

    // A carcass: two or three rib sections in a line.
    if (r.role === 'boss' || (r.role === 'combat' && rng.chance(0.6))) {
      const starts = byEdge(2, 9, true);
      if (starts.length) {
        const [sx, sy] = at(rng.pick(starts));
        const dir = rng.int(0, 3);
        const [dx, dy] = NEI4[dir] as readonly [number, number];
        for (let k = 0; k < rng.int(2, 3); k++) {
          const x = sx + dx * k;
          const y = sy + dy * k;
          if (!g.inb(x, y) || g.room[g.idx(x, y)] !== r.id) break;
          // dragon_bones: rotation 0 lays the spine along x.
          if (!props.place('dragon_bones', x, y, dx !== 0 ? 0 : 1, true)) break;
        }
      }
    }

    // Stalagmites near the walls, bones and rubble everywhere.
    const clusters = r.role === 'entrance' ? 1 : Math.max(1, Math.round(cells.length / 40));
    for (let c = 0; c < clusters; c++) {
      const seeds = byEdge(1, 3, true);
      if (!seeds.length) break;
      const [sx, sy] = at(rng.pick(seeds));
      props.place('stalagmite', sx, sy, rng.int(0, 3), true);
      for (const [dx, dy] of rng.shuffle([...NEI8]).slice(0, rng.int(0, 2))) {
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) <= 4) props.place('stalagmite', x, y, rng.int(0, 3), true);
      }
    }
    for (let k = 0; k < (r.role === 'boss' ? 7 : 4); k++) {
      const spots = cells.filter((i) => props.free(...at(i)));
      if (!spots.length) break;
      props.place(rng.chance(0.7) ? 'bones' : 'rubble', ...at(rng.pick(spots)), rng.int(0, 3), false);
    }
  }

  // Tunnels: bones and scorched rubble.
  const tunnel: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor && (edge[i] as number) === 1) tunnel.push(i);
  rng.shuffle(tunnel);
  for (let k = 0; k < Math.min(tunnel.length, 8); k++) props.place(k % 2 ? 'bones' : 'rubble', ...at(tunnel[k] as number), rng.int(0, 3), false);
}

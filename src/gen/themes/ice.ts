import type { Rng } from '../../core/rng';
import { K, NEI8 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { genWarrens } from './warrens';

/**
 * The Ice Caves: the cave recipe, frozen.
 *
 * Noise-blob chambers and wandering tunnels as in the Goblin Warrens, with the
 * same set pieces read differently: the lake and the stream are ice over black
 * water (the renderer draws this theme's water as ice; it is still slow going),
 * the crack is a crevasse, the tiers are wind-cut shelves and the columns are
 * pillars of blue ice. Pools are common, pits are rare.
 *
 * Nothing lives here that needs a fire, so there are no camps. Chambers are
 * dressed with clusters of ice spikes near the walls, snow drifted against
 * them, bones under the drifts and the odd seam of glowing crystal, which with
 * the torches is the only light.
 *
 * Tunables: pool chance, spike cluster density, drift and crystal counts.
 */
export function genIce(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genWarrens(graph, rng, depth, { poolChance: 0.6, pitChance: 0.2, decorate });
}

function decorate(ctx: DecorCtx): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const byEdge = (lo: number, hi: number): number[] => cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && props.free(...at(i)));

    // Ice spikes in clusters of one to four, growing out from the walls.
    const clusters = r.role === 'entrance' ? 1 : Math.max(1, Math.round(cells.length / 26) + rng.int(0, 1));
    for (let c = 0; c < clusters; c++) {
      const seeds = byEdge(1, 3);
      if (!seeds.length) break;
      const [sx, sy] = at(rng.pick(seeds));
      let placed = props.place('ice_spike', sx, sy, rng.int(0, 3), true) ? 1 : 0;
      const extra = rng.int(0, 3);
      for (const [dx, dy] of rng.shuffle([...NEI8])) {
        if (placed > extra) break;
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) <= 4 && props.place('ice_spike', x, y, rng.int(0, 3), true)) placed++;
      }
    }

    // A seam of crystal: the caves' own light.
    const seams = r.role === 'boss' ? rng.int(3, 4) : r.role === 'combat' ? rng.int(1, 2) : 1;
    for (let k = 0; k < seams; k++) {
      const spots = byEdge(1, 2);
      if (!spots.length) break;
      const [x, y] = at(rng.pick(spots));
      if (props.place('crystal', x, y, rng.int(0, 3), true)) props.tint.set(g.idx(x, y), rng.chance(0.7) ? 0x8fd8ff : 0xc8f0ff);
    }

    // Snow drifted against the walls, and what the snow has covered.
    const drifts = rng.int(3, 6);
    for (let k = 0; k < drifts; k++) {
      const spots = byEdge(1, 2);
      if (!spots.length) break;
      const [sx, sy] = at(rng.pick(spots));
      props.place('snow_drift', sx, sy, rng.int(0, 3), false);
      for (const [dx, dy] of rng.shuffle([...NEI8]).slice(0, rng.int(0, 2))) {
        const x = sx + dx;
        const y = sy + dy;
        if (g.inb(x, y) && (edge[g.idx(x, y)] as number) <= 2) props.place('snow_drift', x, y, rng.int(0, 3), false);
      }
    }
    for (let k = 0; k < (r.role === 'boss' ? 5 : 2); k++) {
      const spots = byEdge(1, 4);
      if (!spots.length) break;
      props.place('bones', ...at(rng.pick(spots)), rng.int(0, 3), false);
    }
  }

  // Tunnels: drifts in the corners, a spike or two where there is room to pass.
  const tunnel: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor && (edge[i] as number) === 1) tunnel.push(i);
  rng.shuffle(tunnel);
  for (let k = 0; k < Math.min(tunnel.length, 8); k++) props.place('snow_drift', ...at(tunnel[k] as number), rng.int(0, 3), false);
}

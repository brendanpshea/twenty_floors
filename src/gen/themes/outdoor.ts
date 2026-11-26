import type { Rng } from '../../core/rng';
import { K, NEI8, dist } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { genDepths } from './depths';
import { genWarrens } from './warrens';

/**
 * The outdoor themes. None has a recipe of its own: outdoors, a "chamber" is
 * a clearing, an island or a ledge, and what makes it a forest, a fen or a
 * mountainside is what borders it (the renderer draws these themes' walls as
 * a tree line, a reed bed or bare rock) and what stands in it.
 *
 *   forest  The Wildwood. The cave recipe: clearings joined by winding paths,
 *           a pond here and there, no pits. Trees stand in the clearings (cover,
 *           and nothing to see across), with undergrowth, fallen logs and the
 *           odd standing stone. Set pieces: the lake, the stream, the tiers
 *           (a terraced hillside), the columns (rock outcrops) and the grove
 *           (a ring of standing stones round a clearing).
 *   marsh   The Drowned Fen. The cave recipe with nearly every island holding
 *           a pool and about half of every channel under water, so most of the
 *           going is slow. Reeds along every shore, dead trees, logs, glowing
 *           fungus. Set pieces: the lake and the stream.
 *           (In both, the recipe's fallback when a piece will not fit is the
 *           crack: here a ravine or a sinkhole.)
 *   peaks   The Windswept Heights. The platform recipe: ledges at different
 *           heights joined by bridges over open air, with all five of its set
 *           pieces. Boulders and standing stones for cover, drifted snow, a
 *           few wind-bent trees.
 *
 * Tunables: pool and flood shares, tree and boulder density per chamber.
 */

type Piece = { name: string; room: number };

export function genForest(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genWarrens(graph, rng, depth, { pieces: ['lake', 'stream', 'tiers', 'columns', 'grove'], poolChance: 0.35, pitChance: 0, decorate: decorateForest });
}

export function genMarsh(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genWarrens(graph, rng, depth, { pieces: ['lake', 'stream'], poolChance: 0.95, pitChance: 0, floodTunnels: 0.5, decorate: decorateMarsh });
}

export function genPeaks(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genDepths(graph, rng, depth, { decorate: decoratePeaks });
}

/** Shared helpers over a decoration context. */
function tools(ctx: DecorCtx) {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];
  /** Place `count` of a prop on random cells of `cells` whose wall distance is in [lo, hi]. */
  const scatter = (cells: number[], type: string, count: number, lo: number, hi: number, blocking: boolean): void => {
    for (let k = 0; k < count; k++) {
      const spots = cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && props.can(...at(i), blocking));
      if (!spots.length) return;
      props.place(type, ...at(rng.pick(spots)), rng.int(0, 3), blocking);
    }
  };
  const nearKind = (x: number, y: number, kind: number): boolean => NEI8.some(([dx, dy]) => g.kind(x + dx, y + dy) === kind);
  /** Unoccupied passage cells (not in any chamber) that touch a wall, shuffled. */
  const passage = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor && (edge[i] as number) === 1) out.push(i);
    return rng.shuffle(out);
  };
  return { props, g, rng, edge, at, scatter, nearKind, passage };
}

function decorateForest(ctx: DecorCtx, piece: Piece): void {
  const { props, g, rng, at, scatter, passage } = tools(ctx);
  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    if (piece.name === 'grove' && r.id === piece.room) {
      // A ring of standing stones round the middle of the clearing, every other cell.
      const ring = cells.filter((i) => {
        const [x, y] = at(i);
        const d = dist(x - r.center.x, y - r.center.y);
        return d >= 3 && d < 4.2 && (x + y) % 2 === 0;
      });
      for (const i of rng.shuffle(ring)) props.place('standing_stone', ...at(i), rng.int(0, 3), true);
    } else {
      // Trees inside the clearing: about one per fourteen cells, kept off the very edge.
      scatter(cells, 'gnarled_tree', r.role === 'entrance' ? 1 : Math.max(2, Math.round(cells.length / 14)), 2, 99, true);
    }
    scatter(cells, 'log', rng.int(0, 2), 1, 99, true);
    if (rng.chance(0.25)) scatter(cells, 'standing_stone', 1, 2, 99, true);
    scatter(cells, 'bush', rng.int(4, 8), 1, 3, false);
    scatter(cells, 'mushrooms', rng.int(1, 2), 1, 1, false);
    scatter(cells, rng.chance(0.5) ? 'bones' : 'rubble', r.role === 'boss' ? 4 : 1, 1, 99, false);
  }
  const path = passage();
  for (let k = 0; k < Math.min(path.length, 12); k++) props.place(k % 4 === 3 ? 'mushrooms' : 'bush', ...at(path[k] as number), rng.int(0, 3), false);
}

function decorateMarsh(ctx: DecorCtx): void {
  const { props, g, rng, at, scatter, nearKind, passage } = tools(ctx);
  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    // Reeds on every shore: most of the dry cells that touch water.
    for (const i of cells) {
      const [x, y] = at(i);
      if (nearKind(x, y, K.Water) && rng.chance(0.6)) props.place('reeds', x, y, rng.int(0, 3), false);
    }
    scatter(cells, 'gnarled_tree', r.role === 'entrance' ? 1 : rng.int(1, 3), 2, 99, true);
    scatter(cells, 'log', rng.int(0, 2), 1, 99, true);
    scatter(cells, 'bush', rng.int(2, 4), 1, 2, false);
    // Glowing fungus: with the torches, the fen's only light.
    scatter(cells, 'mushrooms', rng.int(2, 3), 1, 2, false);
    scatter(cells, 'bones', r.role === 'boss' ? 4 : 1, 1, 99, false);
  }
  const path = passage();
  for (let k = 0; k < Math.min(path.length, 14); k++) props.place(k % 5 === 4 ? 'mushrooms' : 'reeds', ...at(path[k] as number), rng.int(0, 3), false);
}

function decoratePeaks(ctx: DecorCtx): void {
  const { props, g, rng, at, scatter, nearKind } = tools(ctx);
  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    // Boulders for cover, more of them on the bigger ledges; nothing blocking right at the drop.
    scatter(cells, 'boulder', r.role === 'entrance' ? 1 : Math.max(1, Math.round(cells.length / 22)), 2, 99, true);
    if (r.role === 'boss' || rng.chance(0.4)) scatter(cells, 'standing_stone', r.role === 'boss' ? 3 : 1, 2, 99, true);
    if (rng.chance(0.5)) scatter(cells, 'gnarled_tree', 1, 2, 99, true);
    // Crystal in the rock: the ledges' own light.
    for (let k = 0; k < (r.role === 'boss' ? 3 : rng.int(1, 2)); k++) {
      const spots = cells.filter((i) => props.can(...at(i), true) && !nearKind(...at(i), K.Chasm));
      if (!spots.length) break;
      const [x, y] = at(rng.pick(spots));
      if (props.place('crystal', x, y, rng.int(0, 3), true)) props.tint.set(g.idx(x, y), 0xd8ecff);
    }
    scatter(cells, 'snow_drift', rng.int(2, 5), 1, 99, false);
    scatter(cells, rng.chance(0.5) ? 'bones' : 'rubble', 2, 1, 99, false);
  }
  // Snow and loose rock on the bridges.
  const strip: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor) strip.push(i);
  rng.shuffle(strip);
  for (let k = 0; k < Math.min(strip.length, 5); k++) props.place(k < 3 ? 'snow_drift' : 'rubble', ...at(strip[k] as number), rng.int(0, 3), false);
}

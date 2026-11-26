import type { Rng } from '../../core/rng';
import { K, NEI8, dist } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { genDepths } from './depths';

/**
 * The Foundry: the depths' platforms and bridges, over molten slag.
 *
 * The recipe (platforms at different heights joined by straight bridges, with
 * its five set pieces) is shared with the Sundered Depths. Here the chasm is
 * lava, drawn as such by the renderer, and every platform is a workshop: a
 * forge with its anvils in the middle of the bigger ones, crucibles of
 * molten metal left near the edge, stacked ingots, chains hanging over the
 * drop. The forges and crucibles are the light.
 *
 * Tunables: forge chance, crucible and ingot counts.
 */
export function genFoundry(graph: MissionGraph, rng: Rng, depth: number): Layout {
  return genDepths(graph, rng, depth, { decorate });
}

function decorate(ctx: DecorCtx): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];
  const nearLava = (x: number, y: number): boolean => NEI8.some(([dx, dy]) => g.kind(x + dx, y + dy) === K.Chasm);

  for (const r of ctx.rooms) {
    const cells = r.cells.filter((i) => g.kinds[i] === K.Floor);
    const free = (): number[] => cells.filter((i) => props.free(...at(i)));

    // A smithy on the working platforms: a forge well in from the edge, anvils two steps from it, stock beside it.
    if (r.role === 'boss' || (r.role === 'combat' && rng.chance(0.75))) {
      const inner = cells.filter((i) => (edge[i] as number) >= 3 && props.can(...at(i), true));
      if (inner.length) {
        const [fx, fy] = at(rng.pick(inner));
        if (props.place('forge', fx, fy, rng.int(0, 3), true)) {
          const around = cells.filter((i) => {
            const [x, y] = at(i);
            const d = dist(x - fx, y - fy);
            return d >= 1.9 && d <= 2.9;
          });
          rng.shuffle(around);
          let anvils = r.role === 'boss' ? 3 : rng.int(1, 2);
          for (const i of around) {
            if (anvils <= 0) break;
            if (props.place('anvil', ...at(i), rng.int(0, 3), true)) anvils--;
          }
          for (const i of around) if (props.place('ingots', ...at(i), rng.int(0, 3), true)) break;
        }
      }
    }

    // Crucibles stand where they were poured, by the edge.
    const crucibles = r.role === 'boss' ? rng.int(3, 4) : r.role === 'combat' ? rng.int(1, 3) : rng.int(0, 1);
    const rim = free().filter((i) => nearLava(...at(i)));
    rng.shuffle(rim);
    for (let k = 0, placed = 0; k < rim.length && placed < crucibles; k++) {
      if (props.place('crucible', ...at(rim[k] as number), rng.int(0, 3), true)) placed++;
    }
    if (r.role === 'entrance' || r.role === 'treasure') {
      const spots = cells.filter((i) => (edge[i] as number) >= 2 && props.can(...at(i), true));
      if (spots.length) props.place('brazier', ...at(rng.pick(spots)), 0, true);
    }

    // What is left of the roof supports.
    if (r.role === 'combat' || r.role === 'boss') {
      for (let k = 0; k < rng.int(0, 2); k++) {
        const spots = cells.filter((i) => (edge[i] as number) >= 2 && props.can(...at(i), true));
        if (!spots.length) break;
        props.place('broken_pillar', ...at(rng.pick(spots)), rng.int(0, 3), true);
      }
    }

    // Finished stock, stacked out of the way.
    const stacks = r.role === 'treasure' ? 3 : rng.int(0, 2);
    for (let k = 0; k < stacks; k++) {
      const spots = cells.filter((i) => (edge[i] as number) <= 2 && props.can(...at(i), true));
      if (!spots.length) break;
      props.place('ingots', ...at(rng.pick(spots)), rng.int(0, 3), true);
    }

    // Chains over the drop, slag and clinker underfoot.
    const edgeCells = free().filter((i) => nearLava(...at(i)));
    rng.shuffle(edgeCells);
    for (let k = 0; k < Math.min(edgeCells.length, rng.int(2, 4)); k++) props.place('chain', ...at(edgeCells[k] as number), rng.int(0, 3), false);
    for (let k = 0; k < 3; k++) {
      const spots = free();
      if (!spots.length) break;
      props.place('rubble', ...at(rng.pick(spots)), rng.int(0, 3), false);
    }
  }

  // Chains and rubble on the bridges.
  const strip: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor) strip.push(i);
  rng.shuffle(strip);
  for (let k = 0; k < Math.min(strip.length, 5); k++) props.place(k < 3 ? 'chain' : 'rubble', ...at(strip[k] as number), rng.int(0, 3), false);
}

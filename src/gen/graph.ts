import type { Rng } from '../core/rng';
import type { RoomRole } from '../core/types';

/**
 * The mission graph: pure structure, no geometry.
 *
 *   entrance -> c1 -> ... -> cN -> boss          (main path, N = 3..5 combat rooms)
 *        side branches hang off c1..c(N-1) and end in a treasure room
 *        (sometimes with one extra combat room on the way)
 *        an optional shortcut edge links c(i) and c(i+2); a theme generator
 *        keeps it only if it can route it cleanly.
 *
 * Room ids are assigned so that a room's tree parent always has a lower id.
 */
export interface MissionGraph {
  roles: RoomRole[];
  /** Mandatory edges (a spanning tree). */
  edges: Array<[number, number]>;
  /** Optional shortcut edges. */
  optional: Array<[number, number]>;
  /** Tree parent of each room (-1 for the entrance). */
  parent: number[];
}

export function buildGraph(rng: Rng, depth: number): MissionGraph {
  const base = 3 + Math.min(2, Math.floor((depth - 1) / 3));
  const combat = depth <= 1 ? 3 : Math.min(5, base + (rng.chance(0.35) ? 1 : 0));
  const roles: RoomRole[] = ['entrance'];
  const parent = [-1];
  const edges: Array<[number, number]> = [];
  const add = (role: RoomRole, p: number): number => {
    const id = roles.length;
    roles.push(role);
    parent.push(p);
    edges.push([p, id]);
    return id;
  };
  const main: number[] = [0];
  for (let i = 0; i < combat; i++) main.push(add('combat', main[main.length - 1] as number));
  add('boss', main[main.length - 1] as number);

  // Side branches attach to c1..c(N-1) so the boss stays the farthest room.
  const attach = main.slice(1, combat); // c1 .. c(N-1)
  const treasures = depth <= 1 ? 1 : rng.chance(0.55) ? 2 : 1;
  const spots = rng.shuffle([...attach]);
  for (let t = 0; t < treasures; t++) {
    const p = spots[t % spots.length] as number;
    if (depth >= 3 && rng.chance(0.35)) {
      const mid = add('combat', p);
      add('treasure', mid);
    } else {
      add('treasure', p);
    }
  }

  const optional: Array<[number, number]> = [];
  if (rng.chance(combat >= 4 ? 0.6 : 0.4)) {
    const i = rng.int(1, combat - 2);
    optional.push([main[i] as number, main[i + 2] as number]);
  }
  return { roles, edges, optional, parent };
}

/** A fixed, minimal graph used by the guaranteed-valid fallback layout. */
export function fallbackGraph(): MissionGraph {
  return {
    roles: ['entrance', 'combat', 'combat', 'combat', 'boss', 'treasure'],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [2, 5],
    ],
    optional: [],
    parent: [-1, 0, 1, 2, 3, 2],
  };
}

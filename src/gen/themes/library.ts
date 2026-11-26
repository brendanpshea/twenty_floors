import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K, NEI4 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { embedLattice, spaceAxis } from './crypt';

/**
 * The Sunken Library: aisles, sight lines and standing water.
 *
 * Rooms and corridors on the crypt's lattice again, but the rooms are full of
 * bookshelves, and a bookshelf is a wall you can walk round. Fights here are
 * about who can see whom down which aisle.
 *
 *   foyer    the way in: statues, a few fallen books
 *   stacks   a shelf row the length of the room either side of a centre aisle,
 *            broken by a cross-aisle
 *   reading  desks in ranks, shelves against the walls, a lectern
 *   flooded  a stacks room whose side aisles lie under water
 *   archive  the treasure room: shelves on every wall, one lectern
 *   sanctum  the boss's study: a dais ringed by lecterns under cold lamps
 *
 * One combat room per floor is a set piece: the rotunda (a sunken reading well
 * inside a ring of shelves), the grand stacks (two shelf rows a side: a small
 * maze of aisles) or the drowned wing (water wall to wall but for a cross of
 * raised floor and four islands of shelving).
 *
 * Tunables: room size sets, VARIANT weights, raise chance, litter counts.
 */

type Variant = 'foyer' | 'stacks' | 'reading' | 'flooded' | 'archive' | 'sanctum' | 'rotunda' | 'grandStacks' | 'drownedWing';

interface RoomGeo {
  id: number;
  role: RoomRole;
  col: number;
  row: number;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  variant: Variant;
  base: number;
}

export function genLibrary(graph: MissionGraph, rng: Rng): Layout {
  const n = graph.roles.length;
  const pos = embedLattice(graph, rng);

  // Keep shortcut edges only when the two rooms are lattice-neighbours.
  const edges = graph.edges.slice();
  for (const [a, b] of graph.optional) {
    const pa = pos[a] as [number, number];
    const pb = pos[b] as [number, number];
    if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) === 1 && rng.chance(0.85)) edges.push([a, b]);
  }

  interface Spec {
    w: number;
    h: number;
    variant: Variant;
  }
  const specs: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const role = graph.roles[i] as RoomRole;
    switch (role) {
      case 'entrance':
        specs.push({ w: rng.pick([6, 8]), h: rng.pick([6, 8]), variant: 'foyer' });
        break;
      case 'boss':
        specs.push({ w: 10, h: 10, variant: 'sanctum' });
        break;
      case 'treasure':
        specs.push({ w: 6, h: 6, variant: 'archive' });
        break;
      default: {
        // Long rooms, so the shelf rows have some length to them.
        const variant = rng.weighted<Variant>(['stacks', 'reading', 'flooded'], [0.4, 0.35, 0.25]);
        specs.push(rng.chance(0.5) ? { w: 10, h: 8, variant } : { w: 8, h: 10, variant });
      }
    }
  }

  // Set piece: one memorable room per floor.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieceName = rng.pick<Variant>(['rotunda', 'grandStacks', 'drownedWing']);
  {
    const sp = specs[rng.pick(combatIds)] as Spec;
    sp.w = 10;
    sp.h = 10;
    sp.variant = pieceName;
  }

  // Heights: mostly one level, with the odd room a step up or down from its neighbour.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) base.push(1);
    else base.push(Math.max(0, Math.min(2, (base[p] as number) + rng.weighted([0, 1, -1], [0.6, 0.15, 0.25]))));
  }

  let cmin = 99;
  let cmax = -1;
  let rmin = 99;
  let rmax = -1;
  for (const [c, r] of pos) {
    cmin = Math.min(cmin, c);
    cmax = Math.max(cmax, c);
    rmin = Math.min(rmin, r);
    rmax = Math.max(rmax, r);
  }
  const halves = (count: number, idxOf: (i: number) => number, half: (s: Spec) => number): number[] => {
    const out = new Array<number>(count).fill(3);
    for (let i = 0; i < n; i++) out[idxOf(i)] = Math.max(out[idxOf(i)] as number, half(specs[i] as Spec));
    return out;
  };
  const xs = spaceAxis(halves(cmax - cmin + 1, (i) => (pos[i] as [number, number])[0] - cmin, (s) => s.w / 2), rng);
  const ys = spaceAxis(halves(rmax - rmin + 1, (i) => (pos[i] as [number, number])[1] - rmin, (s) => s.h / 2), rng);
  const W = xs.size;
  const H = ys.size;
  const ox = Math.max(0, Math.floor((W - (xs.at[cmax - cmin] as number) - 8) / 2));
  const oy = Math.max(0, Math.floor((H - (ys.at[rmax - rmin] as number) - 8) / 2));
  const g = new Grid(W, H);

  const geo: RoomGeo[] = [];
  for (let i = 0; i < n; i++) {
    const [col, row] = pos[i] as [number, number];
    const spec = specs[i] as Spec;
    geo.push({
      id: i,
      role: graph.roles[i] as RoomRole,
      col,
      row,
      cx: ox + (xs.at[col - cmin] as number),
      cy: oy + (ys.at[row - rmin] as number),
      hw: spec.w / 2,
      hh: spec.h / 2,
      variant: spec.variant,
      base: base[i] as number,
    });
  }

  for (const r of geo) carveRoom(g, r);
  for (const [a, b] of edges) carveCorridor(g, geo[a] as RoomGeo, geo[b] as RoomGeo);

  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((g.room[i] as number) >= 0 && g.kinds[i] === K.Floor) fixed[i] = 1;
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('library elevation unsolved');

  // Flood last, so the solver saw plain floor everywhere.
  for (const r of geo) floodRoom(g, r);

  return {
    grid: g,
    roles: graph.roles,
    edges,
    decorate: (ctx) => decorate(ctx, geo),
    setPiece: pieceName,
  };
}

// ---------------------------------------------------------------------------
// Geometry. Rooms have even sizes, centred between cells (cx, cx+1) and (cy, cy+1);
// ax / ay are 0 on the two centre columns / rows.

function eachCell(r: RoomGeo, fn: (x: number, y: number, ax: number, ay: number) => void): void {
  for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
    for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
      fn(x, y, Math.max(r.cx - x, x - (r.cx + 1)), Math.max(r.cy - y, y - (r.cy + 1)));
    }
  }
}

function carveRoom(g: Grid, r: RoomGeo): void {
  eachCell(r, (x, y, ax, ay) => {
    const m = Math.max(ax, ay);
    let e = r.base;
    if (r.variant === 'sanctum' && m <= 1) e += 1; // the dais
    if (r.variant === 'rotunda' && m <= 2) e -= 1; // the reading well, one step down
    g.floor(x, y, e, r.id);
  });
}

/** A straight two-cell corridor between lattice-neighbours, with a doorway at each end. */
function carveCorridor(g: Grid, a: RoomGeo, b: RoomGeo): void {
  const horizontal = a.row === b.row;
  const [lo, hi] = (horizontal ? a.col < b.col : a.row < b.row) ? [a, b] : [b, a];
  const start = horizontal ? lo.cx + lo.hw + 1 : lo.cy + lo.hh + 1;
  const end = horizontal ? hi.cx - hi.hw : hi.cy - hi.hh;
  const axis = horizontal ? lo.cy : lo.cx;
  if (end - start < 3) throw new GenFail('corridor too short');
  for (let t = start; t <= end; t++) {
    for (let s = 0; s < 2; s++) {
      const x = horizontal ? t : axis + s;
      const y = horizontal ? axis + s : t;
      g.floor(x, y, 0, -1);
      if (t === start || t === end) g.kinds[g.idx(x, y)] = K.Door;
    }
  }
}

function floodRoom(g: Grid, r: RoomGeo): void {
  if (r.variant !== 'flooded' && r.variant !== 'drownedWing') return;
  const horiz = r.hw >= r.hh;
  const shortHalf = horiz ? r.hh : r.hw;
  eachCell(r, (x, y, ax, ay) => {
    const across = horiz ? ay : ax;
    let wet: boolean;
    if (r.variant === 'flooded') {
      // The two side aisles, against the long walls, lie under water.
      wet = across >= shortHalf - 2;
    } else {
      // Everything but the centre cross and an island in each quarter.
      wet = ax !== 0 && ay !== 0 && !(ax >= 2 && ax <= 3 && ay >= 2 && ay <= 3);
    }
    const i = g.idx(x, y);
    if (wet && g.room[i] === r.id && g.kinds[i] === K.Floor) g.kinds[i] = K.Water;
  });
}

// ---------------------------------------------------------------------------
// Decoration

function decorate(ctx: DecorCtx, geo: RoomGeo[]): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];

  for (const r of geo) {
    const cells = (ctx.rooms[r.id]?.cells ?? []).filter((i) => g.kinds[i] === K.Floor);
    const horiz = r.hw >= r.hh;
    const longHalf = horiz ? r.hw : r.hh;
    const shortHalf = horiz ? r.hh : r.hw;
    /** Shelves and desks: rotation 0 runs along x. `along` follows the room's long side. */
    const along = horiz ? 0 : 1;
    const across = horiz ? 1 : 0;
    /** The four mirrored cells at `la` along the long axis and `lb` across it (0 = the centre lines). */
    const quad = (la: number, lb: number): Array<[number, number]> => {
      const [ia, ib] = horiz ? [la, lb] : [lb, la];
      return [
        [r.cx - ia, r.cy - ib],
        [r.cx + 1 + ia, r.cy - ib],
        [r.cx - ia, r.cy + 1 + ib],
        [r.cx + 1 + ia, r.cy + 1 + ib],
      ];
    };
    /** Place a prop in each of the four mirrored cells that will take it. */
    const put = (type: string, la: number, lb: number, blocking: boolean, rot = 0): void => {
      for (const [x, y] of quad(la, lb)) props.place(type, x, y, rot, blocking);
    };
    /** A shelf row along the long axis at `lb`, from `from` to `to`, leaving the cells in `gaps` open. */
    const shelfRow = (lb: number, from: number, to: number, gaps: number[] = []): void => {
      for (let la = from; la <= to; la++) if (!gaps.includes(la)) put('bookshelf', la, lb, true, along);
    };
    /** Shelves standing against the long walls. */
    const wallShelves = (): void => shelfRow(shortHalf - 1, 1, longHalf - 2);
    /** Lecterns face the middle of the room along its long axis. */
    const lecterns = (la: number, lb: number, only?: number): void => {
      quad(la, lb).forEach(([x, y], k) => {
        if (only !== undefined && k !== only) return;
        const facing = horiz ? (x <= r.cx ? 1 : 3) : y <= r.cy ? 2 : 0;
        props.place('lectern', x, y, facing, true);
      });
    };
    const litter = (count: number): void => {
      for (let k = 0; k < count && cells.length > 0; k++) {
        const [x, y] = at(rng.pick(cells));
        props.place('book_pile', x, y, rng.int(0, 3), false);
      }
    };

    switch (r.variant) {
      case 'foyer':
        put('statue', longHalf - 1, shortHalf - 1, true, 2);
        litter(2);
        break;
      case 'stacks':
        // One row a side of the centre aisle, cut by a cross-aisle.
        put('candelabra', longHalf - 1, 0, true);
        shelfRow(2, 1, longHalf - 1, [3]);
        litter(3);
        break;
      case 'reading':
        // Wall-side pieces first: a blocker may not go in diagonally next to one already standing.
        lecterns(longHalf - 1, 0);
        put('candelabra', longHalf - 1, shortHalf - 1, true);
        wallShelves();
        for (let la = 1; la <= longHalf - 2; la += 2) put('desk', la, 1, true, along);
        litter(2);
        break;
      case 'flooded':
        // The dry spine keeps its shelves; whatever stood in the side aisles is under water now.
        shelfRow(1, 1, longHalf - 1, [3]);
        put('candelabra', 0, 0, true);
        litter(4);
        break;
      case 'archive':
        // Shelves on all four walls, and one lectern a step off the centre.
        shelfRow(shortHalf - 1, 0, longHalf - 2);
        for (let lb = 0; lb <= shortHalf - 2; lb++) put('bookshelf', longHalf - 1, lb, true, across);
        lecterns(0, 0, rng.int(0, 3));
        litter(2);
        break;
      case 'sanctum':
        // Lecterns at the corners of the dais, cold lamps in the corners of the room, shelves on the long walls.
        put('candelabra', longHalf - 1, shortHalf - 1, true);
        shelfRow(shortHalf - 1, 1, longHalf - 2);
        lecterns(2, 2);
        litter(4);
        break;
      case 'rotunda':
        // Shelves ring the reading well: each quarter is an L, open on both axes.
        put('candelabra', longHalf - 1, shortHalf - 1, true);
        for (let k = 1; k <= 3; k++) put('bookshelf', k, 3, true, along);
        for (let k = 2; k >= 1; k--) put('bookshelf', 3, k, true, across);
        put('desk', 1, 1, true, along);
        litter(4);
        break;
      case 'grandStacks':
        // Two rows a side: aisles between them, a cross-aisle through all four.
        put('candelabra', 0, shortHalf - 1, true);
        shelfRow(1, 1, longHalf - 1, [3]);
        shelfRow(3, 1, longHalf - 1, [3]);
        litter(5);
        break;
      case 'drownedWing':
        // A pair of shelves and a lamp on each island; the rest is under water.
        put('bookshelf', 2, 2, true, along);
        put('bookshelf', 3, 2, true, along);
        put('candelabra', 2, 3, true);
        put('statue', longHalf - 1, 0, true, 2);
        litter(3);
        break;
    }

    // Cobwebs in the corners.
    for (const i of cells) {
      const [x, y] = at(i);
      if (!props.free(x, y) || (edge[i] as number) !== 1) continue;
      let walls = 0;
      let rot = 0;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = NEI4[d] as readonly [number, number];
        if (g.kind(x + dx, y + dy) === K.Wall) {
          walls++;
          rot = d;
        }
      }
      if (walls >= 2 && rng.chance(0.35)) props.place('cobweb', x, y, rot, false);
    }
  }
}

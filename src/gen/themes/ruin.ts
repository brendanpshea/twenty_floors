import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { embedLattice, spaceAxis } from './crypt';

/**
 * The Overgrown Ruin: a hall plan the forest is taking apart.
 *
 * Rooms and passages on the crypt's lattice, but nothing here is whole. Every
 * room has lost its corners to a different depth, so no two outlines match;
 * the complex steps up and down a hillside; and what fills the rooms is
 * growing, not built:
 *
 *   gate       the way in: a fallen column, the first vines
 *   court      an open court round one great tree
 *   colonnade  two rows of columns, some standing, some broken, some down
 *   garden     trees wherever they took root: cover, and no clear line across
 *   pool       a basin that has become a pond
 *   vault      the treasure room: statues under ivy
 *   heart      the boss's hall: a mound with four old trees at its corners
 *
 * One combat room per floor is a set piece: the sunken garden (two steps down
 * to a pond), the grove (a ring of trees round a pool) or the broken hall
 * (raised side aisles behind a line of ruined columns).
 *
 * Undergrowth, ivy on the walls and glowing fungus dress every room.
 *
 * Tunables: room size sets, VARIANT weights, crumble depth, plant counts.
 */

type Variant = 'gate' | 'court' | 'colonnade' | 'garden' | 'pool' | 'vault' | 'heart' | 'sunkenGarden' | 'grove' | 'brokenHall';

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
  /** How many cells each corner has lost, indexed NW, NE, SW, SE. */
  crumble: number[];
}

export function genRuin(graph: MissionGraph, rng: Rng): Layout {
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
        specs.push({ w: rng.pick([6, 8]), h: rng.pick([6, 8]), variant: 'gate' });
        break;
      case 'boss':
        specs.push({ w: 10, h: 10, variant: 'heart' });
        break;
      case 'treasure':
        specs.push({ w: 6, h: 6, variant: 'vault' });
        break;
      default: {
        const variant = rng.weighted<Variant>(['court', 'colonnade', 'garden', 'pool'], [0.3, 0.25, 0.25, 0.2]);
        specs.push(rng.chance(0.5) ? { w: 10, h: 8, variant } : { w: 8, h: 10, variant });
      }
    }
  }

  // Set piece: one memorable room per floor.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieceName = rng.pick<Variant>(['sunkenGarden', 'grove', 'brokenHall']);
  {
    const sp = specs[rng.pick(combatIds)] as Spec;
    sp.w = 10;
    sp.h = 10;
    sp.variant = pieceName;
  }

  // Heights: the ruin steps up and down a hillside, a level at a time.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) base.push(1);
    else base.push(Math.max(0, Math.min(3, (base[p] as number) + rng.weighted([0, 1, -1], [0.5, 0.25, 0.25]))));
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
    const role = graph.roles[i] as RoomRole;
    geo.push({
      id: i,
      role,
      col,
      row,
      cx: ox + (xs.at[col - cmin] as number),
      cy: oy + (ys.at[row - rmin] as number),
      hw: spec.w / 2,
      hh: spec.h / 2,
      variant: spec.variant,
      base: base[i] as number,
      // Each corner has crumbled by a different amount (the boss's hall and the gate less so).
      crumble: [0, 1, 2, 3].map(() => rng.int(0, role === 'combat' ? 3 : 1)),
    });
  }

  for (const r of geo) carveRoom(g, r);
  for (const [a, b] of edges) carveCorridor(g, geo[a] as RoomGeo, geo[b] as RoomGeo);

  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((g.room[i] as number) >= 0 && g.kinds[i] === K.Floor) fixed[i] = 1;
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('ruin elevation unsolved');

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
  const horiz = r.hw >= r.hh;
  eachCell(r, (x, y, ax, ay) => {
    // A crumbled corner: the cells within `crumble` steps of it (counted along both walls) are gone.
    const corner = (y > r.cy ? 2 : 0) + (x > r.cx ? 1 : 0);
    if (r.hw - 1 - ax + (r.hh - 1 - ay) < (r.crumble[corner] as number)) return;
    const m = Math.max(ax, ay);
    let e = r.base;
    if (r.variant === 'heart' && m <= 1) e += 1; // the mound
    if (r.variant === 'sunkenGarden') e -= m <= 1 ? 2 : m <= 3 ? 1 : 0; // two steps down to the pond
    if (r.variant === 'brokenHall' && (horiz ? ay : ax) >= 3) e += 1; // raised side aisles
    g.floor(x, y, e, r.id);
  });
}

/** A straight two-cell passage between lattice-neighbours, with a doorway at each end. */
function carveCorridor(g: Grid, a: RoomGeo, b: RoomGeo): void {
  const horizontal = a.row === b.row;
  const [lo, hi] = (horizontal ? a.col < b.col : a.row < b.row) ? [a, b] : [b, a];
  const start = horizontal ? lo.cx + lo.hw + 1 : lo.cy + lo.hh + 1;
  const end = horizontal ? hi.cx - hi.hw : hi.cy - hi.hh;
  const axis = horizontal ? lo.cy : lo.cx;
  if (end - start < 3) throw new GenFail('passage too short');
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
  if (r.variant !== 'pool' && r.variant !== 'sunkenGarden' && r.variant !== 'grove') return;
  eachCell(r, (x, y, ax, ay) => {
    const i = g.idx(x, y);
    if (Math.max(ax, ay) <= 1 && g.room[i] === r.id && g.kinds[i] === K.Floor) g.kinds[i] = K.Water;
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
    /** Fallen columns: rotation 0 lies along x. `along` follows the room's long side. */
    const along = horiz ? 0 : 1;
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
    const put = (type: string, la: number, lb: number, blocking: boolean, rot = 0): void => {
      for (const [x, y] of quad(la, lb)) props.place(type, x, y, rot, blocking);
    };
    /** `count` of a prop on random free cells whose distance from the walls is within [lo, hi]. */
    const scatter = (type: string, count: number, lo: number, hi: number, blocking: boolean): void => {
      for (let k = 0; k < count; k++) {
        const spots = cells.filter((i) => (edge[i] as number) >= lo && (edge[i] as number) <= hi && props.can(...at(i), blocking));
        if (!spots.length) return;
        props.place(type, ...at(rng.pick(spots)), rng.int(0, 3), blocking);
      }
    };
    /** Up to `count` curtains of ivy on free wall-side cells. */
    const vines = (count: number): void => {
      let placed = 0;
      for (const i of rng.shuffle(cells.filter((c) => (edge[c] as number) === 1))) {
        if (placed >= count) break;
        const [x, y] = at(i);
        if (!props.free(x, y)) continue;
        const dir = props.wallDir(x, y, rng);
        if (dir >= 0 && props.place('vines', x, y, dir, false)) placed++;
      }
    };
    /** A column in whatever state the years have left it. */
    const column = (la: number, lb: number): void => {
      for (const [x, y] of quad(la, lb)) {
        const roll = rng.next();
        if (roll < 0.4) props.place('pillar', x, y, 0, true);
        else if (roll < 0.75) props.place('broken_pillar', x, y, rng.int(0, 3), true);
        else props.place('fallen_column', x, y, rng.chance(0.5) ? along : 1 - along, true);
      }
    };

    switch (r.variant) {
      case 'gate':
        scatter('fallen_column', 1, 2, 9, true);
        vines(2);
        break;
      case 'court':
        // One great tree a step off-centre (the centre cell stays clear), undergrowth round the walls.
        props.place('gnarled_tree', ...(rng.pick(quad(1, 1)) as [number, number]), rng.int(0, 3), true);
        scatter('bush', rng.int(4, 6), 1, 2, false);
        vines(3);
        break;
      case 'colonnade':
        for (let la = 1; la <= longHalf - 2; la += 2) column(la, 2);
        vines(3);
        scatter('bush', 3, 1, 2, false);
        break;
      case 'garden':
        scatter('gnarled_tree', rng.int(4, 6), 2, 9, true);
        scatter('bush', rng.int(5, 8), 1, 9, false);
        vines(2);
        break;
      case 'pool':
        put('broken_pillar', 2, 2, true);
        scatter('bush', rng.int(3, 5), 1, 2, false);
        vines(2);
        break;
      case 'vault':
        put('statue', longHalf - 1, shortHalf - 1, true, 2);
        vines(3);
        break;
      case 'heart':
        // Four old trees at the corners of the mound, braziers someone still tends in the corners of the hall.
        put('gnarled_tree', 2, 2, true);
        put('brazier', longHalf - 1, shortHalf - 1, true);
        scatter('bush', 5, 1, 2, false);
        vines(5);
        break;
      case 'sunkenGarden':
        put('gnarled_tree', 4, 4, true);
        put('bush', 2, 3, false);
        put('bush', 3, 2, false);
        scatter('bush', 4, 1, 9, false);
        vines(3);
        break;
      case 'grove':
        // A sparse ring of trees round the pool: three to a quarter, open on both axes.
        for (let k = 1; k <= 3; k += 2) put('gnarled_tree', k, 3, true);
        put('gnarled_tree', 3, 1, true);
        scatter('bush', 6, 1, 9, false);
        vines(2);
        break;
      case 'brokenHall':
        // The line of columns along the lip of each raised aisle.
        for (let la = 0; la <= longHalf - 1; la++) if (la % 2 === 1) column(la, 2);
        put('statue', longHalf - 1, shortHalf - 1, true, 2);
        vines(4);
        break;
    }

    // Glowing fungus at the foot of the walls, rubble everywhere.
    scatter('mushrooms', rng.int(1, 2), 1, 1, false);
    scatter('rubble', rng.int(2, 3), 1, 9, false);
  }
}

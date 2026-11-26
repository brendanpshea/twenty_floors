import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K, NEI4 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { embedLattice, spaceAxis } from './crypt';

/**
 * The Bandit Hold: an occupied fort, room by room.
 *
 * The plan is rooms and corridors on the crypt's lattice (two-cell corridors
 * with a doorway at each end), but nothing here is a monument. Every room is a
 * place somebody works or sleeps, and it is the furniture that shapes a fight:
 *
 *   gate      the way in: a palisade stub either side, a few crates
 *   barracks  bunks head-to-wall down both long sides, a rack of weapons
 *   mess      trestle tables in two rows, barrels in the corners
 *   store     loot stacked wherever it was dropped
 *   armoury   weapon racks along the walls, practice dummies
 *   vault     the treasure room: the best of the loot, under guard
 *   captain   the boss's hall: a dais, braziers, tables for the lieutenants
 *
 * One combat room per floor is a set piece: the training yard (a palisade pen
 * with gaps on the axes and dummies inside), the great hall (long tables the
 * length of the room under a row of banners) or the stockade (a fenced aisle
 * with cells off it).
 *
 * The hold is nearly level: some rooms are a step up, the captain has a dais.
 *
 * Tunables: room size sets, VARIANT weights, raise chance, banner counts.
 */

type Variant = 'gate' | 'barracks' | 'mess' | 'store' | 'armoury' | 'vault' | 'captain' | 'trainingYard' | 'greatHall' | 'stockade';

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

export function genHold(graph: MissionGraph, rng: Rng): Layout {
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
        specs.push({ w: 10, h: 10, variant: 'captain' });
        break;
      case 'treasure':
        specs.push({ w: 6, h: 6, variant: 'vault' });
        break;
      default: {
        // Barracks and mess halls are long rooms; stores and armouries are squarer.
        const variant = rng.weighted<Variant>(['barracks', 'mess', 'store', 'armoury'], [0.3, 0.3, 0.2, 0.2]);
        const long = variant === 'barracks' || variant === 'mess';
        // Never narrower than 8: furniture takes the walls, and a fight needs the middle.
        const a = long ? 10 : 8;
        const b = 8;
        specs.push(rng.chance(0.5) ? { w: a, h: b, variant } : { w: b, h: a, variant });
      }
    }
  }

  // Set piece: one memorable room per floor.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieceName = rng.pick<Variant>(['trainingYard', 'greatHall', 'stockade']);
  {
    const sp = specs[rng.pick(combatIds)] as Spec;
    sp.w = 10;
    sp.h = 10;
    sp.variant = pieceName;
  }

  // Heights: mostly one level, with the odd room a step up from its neighbour.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) base.push(0);
    else base.push(Math.max(0, Math.min(2, (base[p] as number) + rng.weighted([0, 1, -1], [0.6, 0.2, 0.2]))));
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
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('hold elevation unsolved');

  return {
    grid: g,
    roles: graph.roles,
    edges,
    decorate: (ctx) => decorate(ctx, geo),
    setPiece: pieceName,
  };
}

// ---------------------------------------------------------------------------
// Geometry. Rooms have even sizes, centred between cells (cx, cx+1) and (cy, cy+1).

function carveRoom(g: Grid, r: RoomGeo): void {
  for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
    for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
      const ax = Math.max(r.cx - x, x - (r.cx + 1));
      const ay = Math.max(r.cy - y, y - (r.cy + 1));
      // The captain's dais: a 4x4 platform one step up in the middle of the hall.
      g.floor(x, y, r.variant === 'captain' && ax <= 1 && ay <= 1 ? r.base + 1 : r.base, r.id);
    }
  }
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
    /** Rotation whose axis runs along the room's long side (for tables, fences) and across it (for bunks). */
    const rotAlong = horiz ? 1 : 0;
    const rotAcross = horiz ? 0 : 1;
    /** Palisade rows use the other convention: rotation 0 runs along x. */
    const fenceAlong = horiz ? 0 : 1;
    const fenceAcross = horiz ? 1 : 0;
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
    /** As `put`, but turned to face the wall each cell stands against. */
    const putOnWall = (type: string, la: number, lb: number, blocking: boolean): void => {
      for (const [x, y] of quad(la, lb)) {
        if (!props.can(x, y, blocking)) continue;
        const dir = props.wallDir(x, y);
        if (dir >= 0) props.place(type, x, y, dir, blocking);
      }
    };
    /** A loose heap of crates and barrels grown from a wall-side cell. */
    const stack = (count: number): void => {
      const seeds = cells.filter((i) => (edge[i] as number) === 1 && props.can(...at(i), true));
      if (!seeds.length) return;
      const [sx, sy] = at(rng.pick(seeds));
      let placed = 0;
      const spots: Array<[number, number]> = [[sx, sy], ...NEI4.map(([dx, dy]) => [sx + dx, sy + dy] as [number, number])];
      for (const [x, y] of spots) {
        if (placed >= count) break;
        if (g.inb(x, y) && g.room[g.idx(x, y)] === r.id && props.place(rng.chance(0.55) ? 'crate' : 'barrel', x, y, rng.int(0, 3), true)) placed++;
      }
    };
    /** Up to `count` banners on free wall-side cells. */
    const banners = (count: number): void => {
      let placed = 0;
      for (const i of rng.shuffle(cells.filter((c) => (edge[c] as number) === 1))) {
        if (placed >= count) break;
        const [x, y] = at(i);
        if (!props.free(x, y)) continue;
        const dir = props.wallDir(x, y, rng);
        if (dir >= 0 && props.place('banner', x, y, dir, false)) placed++;
      }
    };

    switch (r.variant) {
      case 'gate':
        put('palisade', 1, shortHalf - 1, true, fenceAlong);
        stack(rng.int(1, 2));
        banners(1);
        break;
      case 'barracks':
        // Bunks head-to-wall down both long sides; the aisle between them stays clear.
        for (let la = 1; la <= longHalf - 1; la += 2) put('bunk', la, shortHalf - 1, true, rotAcross);
        putOnWall('weapon_rack', longHalf - 1, 0, true);
        banners(1);
        break;
      case 'mess':
        // Two rows of trestle tables, end to end in pairs with a gap to walk through.
        for (let la = 1; la <= longHalf - 2; la += 3) {
          put('table', la, 1, true, rotAlong);
          put('table', la + 1, 1, true, rotAlong);
        }
        put('barrel', longHalf - 1, shortHalf - 1, true);
        banners(2);
        break;
      case 'store':
        for (let k = 0; k < 4; k++) stack(rng.int(2, 3));
        break;
      case 'armoury':
        for (let la = 1; la <= longHalf - 1; la += 2) putOnWall('weapon_rack', la, shortHalf - 1, true);
        put('dummy', longHalf - 2, 0, true);
        banners(1);
        break;
      case 'vault':
        stack(3);
        stack(2);
        putOnWall('weapon_rack', longHalf - 1, 0, true);
        break;
      case 'captain':
        // Braziers at the corners, the lieutenants' tables either side of the dais, colours on every wall.
        put('brazier', longHalf - 1, shortHalf - 1, true);
        put('table', 3, 1, true, rotAcross);
        putOnWall('weapon_rack', 2, shortHalf - 1, true);
        banners(6);
        break;
      case 'trainingYard': {
        // A square pen of sharpened stakes, open on both axes; each quarter is an L built from its open end.
        // The fire first: a blocker may not go in diagonally next to one already standing.
        const corner = rng.pick(quad(longHalf - 1, shortHalf - 1));
        props.place('campfire', corner[0], corner[1], 0, true);
        for (let k = 1; k <= 3; k++) put('palisade', k, 3, true, fenceAlong);
        for (let k = 2; k >= 1; k--) put('palisade', 3, k, true, fenceAcross);
        put('dummy', 1, 1, true);
        banners(2);
        break;
      }
      case 'greatHall':
        // Long tables the length of the hall, braziers in the corners, a row of banners.
        for (let la = 1; la <= longHalf - 2; la++) put('table', la, 2, true, rotAlong);
        put('brazier', longHalf - 1, shortHalf - 1, true);
        banners(6);
        break;
      case 'stockade':
        // A fence either side of the central aisle with a gap every third cell, and cross-fences making cells.
        for (let la = 0; la <= longHalf - 1; la++) if (la % 3 !== 1) put('palisade', la, 2, true, fenceAlong);
        for (let lb = shortHalf - 1; lb >= 3; lb--) put('palisade', 2, lb, true, fenceAcross);
        for (const [x, y] of quad(longHalf - 1, shortHalf - 1)) props.place('bones', x, y, rng.int(0, 3), false);
        banners(1);
        break;
    }

    // Trodden-in litter.
    for (let k = 0; k < 2 && cells.length > 0; k++) {
      const [x, y] = at(rng.pick(cells));
      props.place(rng.chance(0.7) ? 'rubble' : 'bones', x, y, rng.int(0, 3), false);
    }
  }
}

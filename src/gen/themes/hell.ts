import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { embedLattice, spaceAxis } from './crypt';

/**
 * The Hell-touched Vault: a prison built over fire.
 *
 * Rooms and corridors on the crypt's lattice, descending as they go. The floor
 * is broken open over lava (Chasm cells, drawn as lava in this theme), and the
 * rooms are what a prison for things that should not be free needs:
 *
 *   gate       the way in: braziers and hanging chains
 *   cells      a barred aisle either side of the room, bones behind the bars
 *   shrine     an altar between braziers, a sigil burning on the floor before it
 *   gallery    statues of the gaolers down both sides
 *   pit        a square of floor fallen into the fire, chains over the edge
 *   reliquary  the treasure room: an altar under guard
 *   throne     the boss's hall: a dais inside a moat of lava, four causeways,
 *              braziers on the inner bank
 *
 * One combat room per floor is a set piece: the chain pit (a wide pit of lava
 * crossed by one bridge), the trench (lava nearly the width of the room, one crossing)
 * or the summoning hall (four sigils round the centre inside a ring of braziers).
 *
 * Lava never cuts a room in two: every pit and trench leaves a bridge or a way
 * round, and the generator's validation rejects a floor where it does not.
 *
 * Tunables: room size sets, VARIANT weights, descent chance, chain counts.
 */

type Variant = 'gate' | 'cells' | 'shrine' | 'gallery' | 'pit' | 'reliquary' | 'throne' | 'chainPit' | 'trench' | 'summoning';

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
  /** The trench and the chain pit's bridge run along x (true) or y. */
  alongX: boolean;
}

export function genHell(graph: MissionGraph, rng: Rng): Layout {
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
        specs.push({ w: 10, h: 10, variant: 'throne' });
        break;
      case 'treasure':
        specs.push({ w: 6, h: 6, variant: 'reliquary' });
        break;
      default: {
        const variant = rng.weighted<Variant>(['cells', 'shrine', 'gallery', 'pit'], [0.3, 0.25, 0.25, 0.2]);
        specs.push(rng.chance(0.5) ? { w: 10, h: 8, variant } : { w: 8, h: 10, variant });
      }
    }
  }

  // Set piece: one memorable room per floor.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieceName = rng.pick<Variant>(['chainPit', 'trench', 'summoning']);
  {
    const sp = specs[rng.pick(combatIds)] as Spec;
    sp.w = 10;
    sp.h = 10;
    sp.variant = pieceName;
  }

  // Heights: the vault goes down. Most rooms are a step below the one before.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) base.push(4);
    else base.push(Math.max(0, Math.min(4, (base[p] as number) + rng.weighted([0, -1, 1], [0.45, 0.45, 0.1]))));
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
      alongX: rng.chance(0.5),
    });
  }

  for (const r of geo) carveRoom(g, r);
  for (const [a, b] of edges) carveCorridor(g, geo[a] as RoomGeo, geo[b] as RoomGeo);

  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((g.room[i] as number) >= 0 && g.kinds[i] === K.Floor) fixed[i] = 1;
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('vault elevation unsolved');

  // Flood last, so the solver saw plain floor everywhere.
  for (const r of geo) breach(g, r);

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
    // The throne's dais: a 4x4 platform one step up.
    g.floor(x, y, r.variant === 'throne' && Math.max(ax, ay) <= 1 ? r.base + 1 : r.base, r.id);
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

/** Open the floor over the lava, after the elevation solver has seen it whole. */
function breach(g: Grid, r: RoomGeo): void {
  eachCell(r, (x, y, ax, ay) => {
    const m = Math.max(ax, ay);
    const along = r.alongX ? ax : ay;
    const across = r.alongX ? ay : ax;
    let open = false;
    switch (r.variant) {
      case 'pit':
        // A 4x4 hole a step off the centre lines' crossing: the two centre rows stay as a bridge.
        open = m <= 2 && ax >= 1 && ay >= 1;
        break;
      case 'throne':
        // A moat one cell wide round the dais, bridged on both axes.
        open = m === 3 && ax !== 0 && ay !== 0;
        break;
      case 'chainPit':
        // Everything within three cells of the centre, but for one two-cell bridge.
        open = m <= 2 && across !== 0;
        break;
      case 'trench':
        // Four cells wide and nearly wall to wall: crossed where the centre lines meet it, and
        // passable along the walls at either end, so no doorway opens onto the fire.
        open = across <= 1 && along !== 0 && m <= 3;
        break;
      default:
        break;
    }
    const i = g.idx(x, y);
    if (open && g.room[i] === r.id && g.kinds[i] === K.Floor) g.kinds[i] = K.Chasm;
  });
}

// ---------------------------------------------------------------------------
// Decoration

function decorate(ctx: DecorCtx, geo: RoomGeo[]): void {
  const { props, grid: g, rng, edge } = ctx;
  const w = g.w;
  const at = (i: number): [number, number] => [i % w, (i / w) | 0];
  const nearLava = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.kind(x + dx, y + dy) === K.Chasm) return true;
    return false;
  };

  for (const r of geo) {
    const cells = (ctx.rooms[r.id]?.cells ?? []).filter((i) => g.kinds[i] === K.Floor);
    const horiz = r.hw >= r.hh;
    const longHalf = horiz ? r.hw : r.hh;
    const shortHalf = horiz ? r.hh : r.hw;
    /** Bars and altars: rotation 0 runs along x. `along` follows the room's long side. */
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
    const put = (type: string, la: number, lb: number, blocking: boolean, rot = 0): void => {
      for (const [x, y] of quad(la, lb)) props.place(type, x, y, rot, blocking);
    };
    /** Chains hang over the lava where there is any, otherwise from the walls. */
    const chains = (count: number): void => {
      const rim = cells.filter((i) => props.free(...at(i)) && nearLava(...at(i)));
      const pool = rim.length ? rim : cells.filter((i) => (edge[i] as number) === 1 && props.free(...at(i)));
      rng.shuffle(pool);
      for (let k = 0; k < Math.min(pool.length, count); k++) props.place('chain', ...at(pool[k] as number), rng.int(0, 3), false);
    };
    const bones = (count: number): void => {
      for (let k = 0; k < count && cells.length > 0; k++) props.place(rng.chance(0.7) ? 'bones' : 'rubble', ...at(rng.pick(cells)), rng.int(0, 3), false);
    };

    switch (r.variant) {
      case 'gate':
        put('brazier', longHalf - 1, shortHalf - 1, true);
        chains(2);
        break;
      case 'cells':
        // Bars either side of the aisle with a gap every third cell, bones behind them.
        for (let la = 0; la <= longHalf - 1; la++) if (la % 3 !== 1) put('iron_bars', la, 2, true, along);
        for (const [x, y] of quad(longHalf - 1, shortHalf - 1)) props.place('bones', x, y, rng.int(0, 3), false);
        for (const [x, y] of quad(0, shortHalf - 1)) props.place('bones', x, y, rng.int(0, 3), false);
        chains(2);
        break;
      case 'shrine':
        // Braziers first: a blocker may not go in diagonally next to one already standing.
        put('brazier', longHalf - 1, 1, true);
        put('altar', longHalf - 2, 0, true, across);
        put('sigil', longHalf - 4, 0, false);
        bones(2);
        break;
      case 'gallery':
        for (let la = 1; la <= longHalf - 2; la += 2) put('statue', la, shortHalf - 1, true, 2);
        put('broken_pillar', 2, 1, true);
        chains(3);
        break;
      case 'pit':
        put('brazier', longHalf - 1, shortHalf - 1, true);
        chains(4);
        bones(3);
        break;
      case 'reliquary':
        put('altar', 1, 0, true, across);
        put('statue', longHalf - 1, shortHalf - 1, true, 2);
        chains(2);
        break;
      case 'throne':
        // Braziers on the inner bank at the corners of the moat (the outer walk is one cell wide and
        // must stay clear), sigils at the corners of the dais.
        put('brazier', 2, 2, true);
        put('sigil', 1, 1, false);
        chains(6);
        break;
      case 'chainPit':
        put('brazier', longHalf - 1, shortHalf - 1, true);
        chains(8);
        bones(4);
        break;
      case 'trench':
        put('brazier', longHalf - 1, shortHalf - 1, true);
        put('statue', 0, shortHalf - 1, true, 2);
        chains(5);
        break;
      case 'summoning':
        // Four sigils round the centre, a ring of braziers, an altar at each end of the long axis.
        put('sigil', 1, 1, false);
        put('brazier', 3, 3, true);
        put('altar', longHalf - 1, 0, true, across);
        bones(4);
        break;
    }
    bones(2);
  }
}

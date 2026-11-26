import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { GenFail, Grid, K, NEI4 } from '../grid';
import type { MissionGraph } from '../graph';
import type { DecorCtx, Layout } from '../layout';
import { embedLattice, spaceAxis } from './crypt';

/**
 * The Flooded Sewers: brick chambers joined by channel tunnels.
 *
 * The mission graph is embedded on the same coarse lattice as the crypt, so
 * every edge joins two lattice-neighbours. What makes it a sewer is the water:
 *
 * 1. Tunnels are four cells wide: a two-cell channel down the middle and a
 *    one-cell brick walkway on each side. There are no doors; tunnels open
 *    straight into the chambers.
 * 2. Wet chambers sit at the channel level and carry the water on: a junction
 *    (channel arms from each tunnel mouth meeting in the middle), a pool (a
 *    settling tank the arms run into), and the boss's basin (a raised island
 *    in a two-cell ring of water).
 * 3. Dry chambers (the entrance landing, storerooms, the treasure vault) stand
 *    one step higher. Tunnels always run at the lower of their two ends, so
 *    the channel stays level and a dry chamber is a single step up from its
 *    tunnel mouth.
 * 4. One combat chamber per floor is a set piece: the sluice (a broad channel
 *    cutting the room in two, crossed by a narrow bridge), the flooded hall
 *    (water wall to wall but for a ledge and four dry pads), or the grand
 *    cistern (a deep square tank with a pillared walk around it).
 *
 * Water is walkable but slow, so every chamber keeps a dry way round.
 *
 * Tunables: room size sets, VARIANT weights, pipe and mushroom counts.
 */

type Variant = 'entry' | 'vault' | 'dry' | 'junction' | 'pool' | 'basin' | 'sluice' | 'floodedHall' | 'grandCistern';

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
  /** Sides with a tunnel mouth, indexed like NEI4: 0 = N (-y), 1 = E (+x), 2 = S (+y), 3 = W (-x). */
  open: [boolean, boolean, boolean, boolean];
  /** The sluice's channel runs along x (true) or y. */
  alongX: boolean;
}

interface Tunnel {
  horizontal: boolean;
  axis: number;
  start: number;
  end: number;
}

const DRY: ReadonlySet<Variant> = new Set<Variant>(['entry', 'vault', 'dry']);

export function genSewers(graph: MissionGraph, rng: Rng): Layout {
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
        specs.push({ w: rng.pick([6, 8]), h: rng.pick([6, 8]), variant: 'entry' });
        break;
      case 'boss':
        specs.push({ w: 10, h: 10, variant: 'basin' });
        break;
      case 'treasure':
        specs.push({ w: 6, h: 6, variant: 'vault' });
        break;
      default:
        specs.push({
          w: rng.pick([8, 10]),
          h: rng.pick([8, 10]),
          variant: rng.weighted<Variant>(['junction', 'pool', 'dry'], [0.45, 0.35, 0.2]),
        });
    }
  }

  // Set piece: one memorable chamber per floor.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieceName = rng.pick<Variant>(['sluice', 'floodedHall', 'grandCistern']);
  {
    const wide = combatIds.filter((i) => (specs[i] as Spec).w === 10 && (specs[i] as Spec).h === 10);
    const sp = specs[rng.pick(wide.length ? wide : combatIds)] as Spec;
    sp.w = 10;
    sp.h = 10;
    sp.variant = pieceName;
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
      base: DRY.has(spec.variant) ? 1 : 0,
      open: [false, false, false, false],
      alongX: rng.chance(0.5),
    });
  }

  for (const r of geo) carveRoom(g, r);
  const tunnels: Tunnel[] = [];
  for (const [a, b] of edges) tunnels.push(carveTunnel(g, geo[a] as RoomGeo, geo[b] as RoomGeo));

  for (const t of tunnels) floodTunnel(g, t);
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
// Geometry. Rooms have even sizes; ax / ay are 0 on the two centre columns / rows.

function offsets(r: RoomGeo, x: number, y: number): [number, number] {
  return [Math.max(r.cx - x, x - (r.cx + 1)), Math.max(r.cy - y, y - (r.cy + 1))];
}

function eachCell(r: RoomGeo, fn: (x: number, y: number, ax: number, ay: number) => void): void {
  for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
    for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
      const [ax, ay] = offsets(r, x, y);
      fn(x, y, ax, ay);
    }
  }
}

function carveRoom(g: Grid, r: RoomGeo): void {
  eachCell(r, (x, y, ax, ay) => {
    // The boss stands on an island one step above the water.
    const e = r.variant === 'basin' && ax <= 1 && ay <= 1 ? r.base + 1 : r.base;
    g.floor(x, y, e, r.id);
  });
}

/** A straight tunnel, four cells wide (walkway, two channel cells, walkway), between lattice-neighbours. */
function carveTunnel(g: Grid, a: RoomGeo, b: RoomGeo): Tunnel {
  const horizontal = a.row === b.row;
  const [lo, hi] = (horizontal ? a.col < b.col : a.row < b.row) ? [a, b] : [b, a];
  const start = horizontal ? lo.cx + lo.hw + 1 : lo.cy + lo.hh + 1;
  const end = horizontal ? hi.cx - hi.hw : hi.cy - hi.hh;
  const axis = horizontal ? lo.cy : lo.cx;
  const low = Math.min(a.base, b.base);
  if (end - start < 3) throw new GenFail('tunnel too short');
  for (let t = start; t <= end; t++) {
    for (let s = -1; s <= 2; s++) g.floor(horizontal ? t : axis + s, horizontal ? axis + s : t, low, -1);
  }
  lo.open[horizontal ? 1 : 2] = true;
  hi.open[horizontal ? 3 : 0] = true;
  return { horizontal, axis, start, end };
}

/** The two middle cells of a tunnel are its channel. */
function floodTunnel(g: Grid, t: Tunnel): void {
  for (let u = t.start; u <= t.end; u++) {
    for (let s = 0; s <= 1; s++) {
      const i = t.horizontal ? g.idx(u, t.axis + s) : g.idx(t.axis + s, u);
      if (g.kinds[i] === K.Floor) g.kinds[i] = K.Water;
    }
  }
}

/** Is (x, y) on the channel arm that runs from the room's centre to its tunnel mouth on side d? */
function onArm(r: RoomGeo, x: number, y: number, ax: number, ay: number): boolean {
  if (ax === 0 && ((y <= r.cy && r.open[0]) || (y > r.cy && r.open[2]))) return true;
  if (ay === 0 && ((x > r.cx && r.open[1]) || (x <= r.cx && r.open[3]))) return true;
  return false;
}

function floodRoom(g: Grid, r: RoomGeo): void {
  if (DRY.has(r.variant)) return;
  const half = Math.min(r.hw, r.hh);
  eachCell(r, (x, y, ax, ay) => {
    const m = Math.max(ax, ay);
    let wet = false;
    switch (r.variant) {
      case 'junction':
        wet = (ax === 0 && ay === 0) || onArm(r, x, y, ax, ay);
        break;
      case 'pool':
        // A tank with at least two cells of walkway round it, fed by the arms.
        wet = m <= half - 3 || onArm(r, x, y, ax, ay);
        break;
      case 'basin':
        wet = m === 2 || m === 3 || (m === 4 && onArm(r, x, y, ax, ay));
        break;
      case 'sluice': {
        // A four-cell channel right across the room; the two centre lines stay dry as the bridge.
        const across = r.alongX ? ay : ax;
        const along = r.alongX ? ax : ay;
        wet = across <= 1 && along !== 0;
        break;
      }
      case 'floodedHall':
        // Wall-to-wall water inside a one-cell ledge, with a dry pad in each quarter.
        wet = m <= 3 && !(ax >= 1 && ax <= 2 && ay >= 1 && ay <= 2);
        break;
      case 'grandCistern':
        wet = m <= 2;
        break;
      default:
        break;
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
  const nearWater = (x: number, y: number): boolean => NEI4.some(([dx, dy]) => g.kind(x + dx, y + dy) === K.Water);

  /** Up to `count` outflow pipes on wall-side cells taken from `cells`. */
  const pipes = (cells: number[], count: number): void => {
    let placed = 0;
    for (const i of rng.shuffle(cells.slice())) {
      if (placed >= count) break;
      const [x, y] = at(i);
      if (!props.free(x, y)) continue;
      const dir = props.wallDir(x, y, rng);
      if (dir >= 0 && props.place('pipe', x, y, dir, false)) placed++;
    }
  };

  for (const r of geo) {
    const cells = (ctx.rooms[r.id]?.cells ?? []).filter((i) => g.kinds[i] === K.Floor);
    /** Four mirrored cells at half-grid offsets (ia along x, ib along y). */
    const cells4 = (ia: number, ib: number): Array<[number, number]> => [
      [r.cx - ia, r.cy - ib],
      [r.cx + 1 + ia, r.cy - ib],
      [r.cx - ia, r.cy + 1 + ib],
      [r.cx + 1 + ia, r.cy + 1 + ib],
    ];
    /** Symmetric placement, all or nothing. */
    const sym = (type: string, ia: number, ib: number, blocking: boolean): void => {
      const group = cells4(ia, ib);
      if (!group.every(([x, y]) => props.can(x, y, blocking))) return;
      for (const [x, y] of group) props.place(type, x, y, 0, blocking);
    };
    /** A loose stack of crates and barrels grown from a wall-side cell. */
    const stack = (count: number): void => {
      const seeds = cells.filter((i) => (edge[i] as number) === 1 && props.can(...at(i), true));
      if (!seeds.length) return;
      const [sx, sy] = at(rng.pick(seeds));
      let placed = 0;
      const spots: Array<[number, number]> = [[sx, sy], ...NEI4.map(([dx, dy]) => [sx + dx, sy + dy] as [number, number])];
      for (const [x, y] of spots) {
        if (placed >= count) break;
        if (g.inb(x, y) && g.room[g.idx(x, y)] === r.id && props.place(rng.chance(0.5) ? 'crate' : 'barrel', x, y, rng.int(0, 3), true)) placed++;
      }
    };

    switch (r.variant) {
      case 'entry':
        stack(rng.int(1, 2));
        break;
      case 'vault':
        stack(rng.int(2, 3));
        stack(rng.int(1, 2));
        break;
      case 'dry':
        // A storeroom: goods piled along the walls, a drain in the floor.
        for (let k = 0; k < 3; k++) stack(rng.int(2, 3));
        sym('grate', 1, 1, false);
        break;
      case 'junction':
        sym('grate', r.hw - 2, r.hh - 2, false);
        break;
      case 'pool':
        sym('pillar', r.hw - 1, r.hh - 1, true);
        break;
      case 'basin':
        // Braziers at the corners of the ledge light the island from all sides.
        sym('brazier', r.hw - 1, r.hh - 1, true);
        break;
      case 'sluice':
        sym('brazier', r.alongX ? r.hw - 1 : 3, r.alongX ? 3 : r.hh - 1, true);
        sym('grate', r.alongX ? 2 : r.hw - 1, r.alongX ? r.hh - 1 : 2, false);
        break;
      case 'floodedHall':
        // Flotsam left high and dry on the pads.
        for (const [x, y] of cells4(2, 2)) if (rng.chance(0.75)) props.place(rng.chance(0.5) ? 'crate' : 'barrel', x, y, rng.int(0, 3), true);
        break;
      case 'grandCistern':
        // Corner braziers first, then a pillar at each corner of the walk that a tunnel mouth leaves free.
        sym('brazier', r.hw - 1, r.hh - 1, true);
        for (const [x, y] of cells4(3, 3)) props.place('pillar', x, y, 0, true);
        break;
    }

    pipes(cells.filter((i) => (edge[i] as number) === 1 && (ctx.doorDist[i] as number) >= 2), r.role === 'boss' ? 4 : rng.int(1, 3));

    // Glowing mushrooms where the brick stays wet.
    if (!DRY.has(r.variant)) {
      const damp = cells.filter((i) => nearWater(...at(i)) && props.free(...at(i)));
      rng.shuffle(damp);
      for (let k = 0; k < Math.min(damp.length, rng.int(1, 3)); k++) props.place('mushrooms', ...at(damp[k] as number), rng.int(0, 3), false);
    }
    // Cobwebs in the corners of dry rooms, litter everywhere.
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
      if (walls >= 2 && DRY.has(r.variant) && rng.chance(0.4)) props.place('cobweb', x, y, rot, false);
    }
    for (let k = 0; k < 3 && cells.length > 0; k++) {
      const [x, y] = at(rng.pick(cells));
      props.place(rng.chance(0.5) ? 'bones' : 'rubble', x, y, rng.int(0, 3), false);
    }
  }

  // Tunnel walkways: pipes on the walls, a few mushrooms and drains. Nothing that blocks.
  const walk: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.room[i] === -1 && g.kinds[i] === K.Floor) walk.push(i);
  pipes(walk, 5);
  rng.shuffle(walk);
  let extras = 0;
  for (const i of walk) {
    if (extras >= 6) break;
    const [x, y] = at(i);
    if (props.place(extras < 4 ? 'mushrooms' : 'grate', x, y, rng.int(0, 3), false)) extras++;
  }
}

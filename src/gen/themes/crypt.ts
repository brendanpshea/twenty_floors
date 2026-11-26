import type { Rng } from '../../core/rng';
import type { RoomRole } from '../../core/types';
import { solveElevation } from '../elevation';
import { GenFail, Grid, K, NEI4 } from '../grid';
import { mirror, type DecorCtx, type Layout } from '../layout';
import type { MissionGraph } from '../graph';

/**
 * The Forgotten Crypt: architecture on a lattice.
 *
 * The mission graph is embedded on a coarse lattice (pitch 14) by a randomised
 * self-avoiding walk with backtracking, so every graph edge joins two
 * lattice-neighbours. Each room is a footprint (rectangle, chamfered rectangle
 * or cross) centred on its lattice cell with even dimensions, so all rooms are
 * mirror-symmetric about axis lines between cells (cx, cx+1) and (cy, cy+1).
 * Corridors are straight and 2 cells wide along those axes, with Door cells at
 * both thresholds and the occasional pair of alcoves. Rooms get a base
 * elevation that tends to descend with depth; the boss hall has a stepped dais
 * (+1 ring, +2 core) and some halls have a sunken central aisle (-1).
 *
 * One room per floor is a set piece: the boss hall's pillar ambulatory, a
 * grand nave with raised galleries, a hall whose floor has collapsed into a
 * pit, a moated shrine (a raised island inside a ring of water, reached
 * by four causeways on the door axes), or a pit hall (four square pits with
 * a cross of floor between them and a walkway round the walls).
 *
 * Tunables: PITCH, room size sets, VARIANT weights, alcove chance, descent chance.
 */

const PITCH = 14;

type Variant = 'nave' | 'tombs' | 'quad' | 'gallery' | 'entry' | 'vault' | 'throne' | 'grand' | 'collapsed' | 'moat' | 'pitHall';
type Shape = 'rect' | 'chamfer' | 'cross';

interface RoomGeo {
  id: number;
  role: RoomRole;
  col: number;
  row: number;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  shape: Shape;
  variant: Variant;
  sunken: boolean;
  /** Boss hall with a ring ambulatory of pillars around the dais. */
  ring: boolean;
  base: number;
}

interface Alcove {
  cells: Array<[number, number]>;
  kind: 'urn' | 'brazier' | 'statue';
}

export interface CryptOptions {
  /** Fixed lattice positions (used by the fallback layout). */
  forced?: Array<[number, number]>;
  /** Rectangles only, simple decoration. */
  plain?: boolean;
}

export function genCrypt(graph: MissionGraph, rng: Rng, opts: CryptOptions = {}): Layout {
  const n = graph.roles.length;
  const pos = opts.forced ?? embed(graph, rng);

  // Keep shortcut edges only when the two rooms are lattice-neighbours.
  const edges = graph.edges.slice();
  if (!opts.forced) {
    for (const [a, b] of graph.optional) {
      const pa = pos[a] as [number, number];
      const pb = pos[b] as [number, number];
      if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) === 1 && rng.chance(0.85)) edges.push([a, b]);
    }
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
  const cols = cmax - cmin + 1;
  const rows = rmax - rmin + 1;
  // Base elevations: the crypt descends as you go deeper.
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = graph.parent[i] as number;
    if (p < 0) {
      base.push(0);
      continue;
    }
    const role = graph.roles[i] as RoomRole;
    let d = 0;
    if (role === 'boss') d = -1;
    else if (role === 'treasure') d = rng.chance(0.5) ? 1 : 0;
    else d = rng.chance(0.4) ? -1 : rng.chance(0.12) ? 1 : 0;
    base.push(Math.max(-3, Math.min(2, (base[p] as number) + d)));
  }

  // Room specs first, so lattice spacing can follow the actual room sizes.
  interface Spec {
    w: number;
    h: number;
    shape: Shape;
    variant: Variant;
  }
  const specs: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const role = graph.roles[i] as RoomRole;
    let spec: Spec = { w: 8, h: 8, shape: 'rect', variant: 'quad' };
    switch (role) {
      case 'entrance':
        spec = { w: rng.pick([6, 8]), h: rng.pick([6, 8]), shape: rng.chance(0.3) ? 'chamfer' : 'rect', variant: 'entry' };
        break;
      case 'boss':
        spec = { w: 10, h: 10, shape: rng.chance(0.4) ? 'chamfer' : 'rect', variant: 'throne' };
        break;
      case 'treasure':
        spec = { w: 6, h: 6, shape: 'rect', variant: 'vault' };
        break;
      default:
        spec = {
          w: rng.pick([8, 10]),
          h: rng.pick([8, 10]),
          shape: rng.weighted<Shape>(['rect', 'cross', 'chamfer'], [0.4, 0.35, 0.25]),
          variant: rng.weighted<Variant>(['nave', 'tombs', 'quad', 'gallery'], [0.3, 0.3, 0.2, 0.2]),
        };
    }
    if (opts.plain) spec = { ...spec, shape: 'rect', variant: role === 'combat' ? 'quad' : spec.variant };
    specs.push(spec);
  }

  // Set piece: one memorable room per floor, chosen from what the floor can host.
  const combatIds = graph.roles.map((r, i) => (r === 'combat' ? i : -1)).filter((i) => i >= 0);
  const pieces = opts.plain ? [] : ['ambulatory', 'grandNave', 'collapsed', 'moat', 'pitHall'];
  const pieceName = pieces.length ? rng.pick(pieces) : 'none';
  if (pieceName === 'grandNave' || pieceName === 'collapsed' || pieceName === 'moat' || pieceName === 'pitHall') {
    const wide = combatIds.filter((i) => (specs[i] as Spec).w === 10 && (specs[i] as Spec).h === 10);
    const id = rng.pick(wide.length ? wide : combatIds);
    const sp = specs[id] as Spec;
    if (pieceName === 'grandNave' || pieceName === 'moat' || pieceName === 'pitHall') {
      sp.w = 10;
      sp.h = 10;
      sp.shape = 'rect';
      sp.variant = pieceName === 'moat' ? 'moat' : pieceName === 'pitHall' ? 'pitHall' : 'grand';
    } else {
      sp.w = Math.max(8, sp.w);
      sp.h = Math.max(8, sp.h);
      sp.shape = 'rect';
      sp.variant = 'collapsed';
    }
  }

  // Lattice spacing: each gap between neighbouring columns/rows is at least 4 cells of corridor, plus
  // a random extra while the floor still fits in 62 cells, so corridors differ in length.
  const axisPositions = (count: number, minIdx: number, idxOf: (i: number) => number, half: (s: Spec) => number): { at: number[]; size: number } => {
    const maxHalf = new Array<number>(count).fill(3);
    for (let i = 0; i < n; i++) {
      const k = idxOf(i) - minIdx;
      maxHalf[k] = Math.max(maxHalf[k] as number, half(specs[i] as Spec));
    }
    const gaps: number[] = [];
    for (let k = 0; k + 1 < count; k++) gaps.push(Math.max(PITCH, (maxHalf[k] as number) + (maxHalf[k + 1] as number) + 4));
    const total = (): number => (maxHalf[0] as number) + 3 + gaps.reduce((s, v) => s + v, 0) + (maxHalf[count - 1] as number) + 4;
    if (!opts.forced) {
      for (let k = 0; k < gaps.length; k++) {
        const extra = rng.pick([0, 0, 2, 4, 6]);
        if (total() + extra <= 62) gaps[k] = (gaps[k] as number) + extra;
      }
    }
    const at: number[] = [(maxHalf[0] as number) + 3];
    for (let k = 0; k + 1 < count; k++) at.push((at[k] as number) + (gaps[k] as number));
    return { at, size: Math.max(40, total()) };
  };
  const xs = axisPositions(cols, cmin, (i) => (pos[i] as [number, number])[0], (s) => s.w / 2);
  const ys = axisPositions(rows, rmin, (i) => (pos[i] as [number, number])[1], (s) => s.h / 2);
  const W = xs.size;
  const H = ys.size;
  const ox = Math.floor((W - (xs.at[cols - 1] as number) - 8) / 2);
  const oy = Math.floor((H - (ys.at[rows - 1] as number) - 8) / 2);
  const g = new Grid(W, H);

  const geo: RoomGeo[] = [];
  for (let i = 0; i < n; i++) {
    const role = graph.roles[i] as RoomRole;
    const [col, row] = pos[i] as [number, number];
    const spec = specs[i] as Spec;
    geo.push({
      id: i,
      role,
      col,
      row,
      cx: Math.max(0, ox) + (xs.at[col - cmin] as number),
      cy: Math.max(0, oy) + (ys.at[row - rmin] as number),
      hw: spec.w / 2,
      hh: spec.h / 2,
      shape: spec.shape,
      variant: spec.variant,
      sunken: spec.variant === 'nave' && rng.chance(0.6),
      ring: pieceName === 'ambulatory' && role === 'boss',
      base: base[i] as number,
    });
  }

  // Carve rooms.
  for (const r of geo) carveRoom(g, r);

  // Carve corridors and alcoves.
  const alcoves: Alcove[] = [];
  for (const [a, b] of edges) carveCorridor(g, geo[a] as RoomGeo, geo[b] as RoomGeo, rng, alcoves, !!opts.plain);

  // Corridor elevations: slopes between rooms become staircases.
  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (g.room[i]! >= 0 && g.kinds[i] === K.Floor) fixed[i] = 1;
  if (!solveElevation(g, fixed, () => 'mid')) throw new GenFail('crypt elevation unsolved');

  // The moat floods only now, so the solver treated its cells as fixed room floor.
  for (const r of geo) if (r.variant === 'moat') floodMoat(g, r);

  return {
    grid: g,
    roles: graph.roles,
    edges,
    decorate: (ctx) => decorate(ctx, geo, alcoves, !!opts.plain),
    setPiece: pieceName === 'none' ? 'plain' : pieceName,
  };
}

// ---------------------------------------------------------------------------
// Lattice embedding

function embed(graph: MissionGraph, rng: Rng): Array<[number, number]> {
  const n = graph.roles.length;
  let C = n <= 6 ? 3 : 4;
  let R = n <= 9 ? 3 : 4;
  if (rng.chance(0.5)) [C, R] = [R, C];
  const pos: Array<[number, number]> = [];
  const used = new Set<number>();
  let budget = 4000;
  const place = (i: number): boolean => {
    if (i === n) return true;
    if (budget-- < 0) return false;
    let cand: Array<[number, number]> = [];
    if (i === 0) {
      for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) cand.push([c, r]);
    } else {
      const [pc, pr] = pos[graph.parent[i] as number] as [number, number];
      cand = [
        [pc + 1, pr],
        [pc - 1, pr],
        [pc, pr + 1],
        [pc, pr - 1],
      ];
      cand = cand.filter(([c, r]) => c >= 0 && r >= 0 && c < C && r < R);
    }
    rng.shuffle(cand);
    for (const [c, r] of cand) {
      const key = c * 16 + r;
      if (used.has(key)) continue;
      used.add(key);
      pos[i] = [c, r];
      if (place(i + 1)) return true;
      used.delete(key);
    }
    return false;
  };
  if (!place(0)) throw new GenFail('lattice embedding failed');
  return pos;
}

// ---------------------------------------------------------------------------
// Geometry

function inFootprint(r: RoomGeo, x: number, y: number): boolean {
  const w = r.hw * 2;
  const h = r.hh * 2;
  const u = x - (r.cx - r.hw + 1);
  const v = y - (r.cy - r.hh + 1);
  if (u < 0 || v < 0 || u >= w || v >= h) return false;
  switch (r.shape) {
    case 'rect':
      return true;
    case 'chamfer':
      return Math.min(u, w - 1 - u) + Math.min(v, h - 1 - v) >= 2;
    case 'cross':
      return (v >= 2 && v <= h - 3) || (u >= 2 && u <= w - 3);
  }
}

function carveRoom(g: Grid, r: RoomGeo): void {
  for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
    for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
      if (!inFootprint(r, x, y)) continue;
      let e = r.base;
      const ax = Math.max(r.cx - x, x - (r.cx + 1)); // 0 on the centre columns
      const ay = Math.max(r.cy - y, y - (r.cy + 1));
      if (r.variant === 'throne') {
        if (ax <= 1 && ay <= 1) e += 2;
        else if (ax <= 2 && ay <= 2) e += 1;
      } else if (r.variant === 'grand') {
        // Sunken central aisle, flanking floor, raised side galleries: one step per band.
        const across = r.hw >= r.hh ? ay : ax;
        if (across === 0) e -= 1;
        else if (across >= 3) e += 1;
      } else if (r.variant === 'moat') {
        // The shrine island stands one step above the causeways and the outer walk.
        if (ax <= MOAT_RING - 1 && ay <= MOAT_RING - 1) e += 1;
      } else if (r.variant === 'collapsed') {
        if (ax <= 1 && ay <= 1 && !(ax === 1 && ay === 1)) {
          g.floor(x, y, e, r.id);
          g.kinds[g.idx(x, y)] = K.Chasm;
          continue;
        }
      } else if (r.variant === 'pitHall') {
        // Four 2x2 pits, leaving a cross of floor on the axes and a walkway round the walls.
        if (ax >= 2 && ax <= 3 && ay >= 2 && ay <= 3) {
          g.floor(x, y, e, r.id);
          g.kinds[g.idx(x, y)] = K.Chasm;
          continue;
        }
      } else if (r.sunken) {
        const horizontal = r.hw >= r.hh;
        if ((horizontal ? ay : ax) === 0) e -= 1;
      }
      g.floor(x, y, e, r.id);
    }
  }
}

/** Offset (0 on the centre lines) of the moat's ring of water; the island lies inside it. */
const MOAT_RING = 3;

/** Turn the moat ring to Water, leaving a 2-wide causeway on each axis. */
function floodMoat(g: Grid, r: RoomGeo): void {
  for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
    for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
      const ax = Math.max(r.cx - x, x - (r.cx + 1));
      const ay = Math.max(r.cy - y, y - (r.cy + 1));
      if (Math.max(ax, ay) !== MOAT_RING || Math.min(ax, ay) === 0) continue;
      const i = g.idx(x, y);
      if (g.room[i] === r.id && g.kinds[i] === K.Floor) g.kinds[i] = K.Water;
    }
  }
}

function carveCorridor(g: Grid, a: RoomGeo, b: RoomGeo, rng: Rng, alcoves: Alcove[], plain: boolean): void {
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
  if (!plain && end - start >= 3 && rng.chance(0.6)) {
    const inner = end - start - 1; // cells strictly between the doors
    const t0 = start + 1 + Math.floor((inner - 2) / 2);
    const kind = rng.pick<Alcove['kind']>(['urn', 'brazier', 'statue']);
    // One side only: the other stays free (rest-spot nooks are carved there).
    for (const side of [rng.chance(0.5) ? -1 : 2]) {
      const cells: Array<[number, number]> = [];
      for (let t = t0; t < t0 + 2; t++) {
        const x = horizontal ? t : axis + side;
        const y = horizontal ? axis + side : t;
        g.floor(x, y, 0, -1);
        cells.push([x, y]);
      }
      alcoves.push({ cells, kind });
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration

function decorate(ctx: DecorCtx, geo: RoomGeo[], alcoves: Alcove[], plain: boolean): void {
  const { props, grid: g, rng } = ctx;
  const brazierTint = rng.chance(0.5) ? 0x45e0d0 : 0xffa040;

  const brazier = (x: number, y: number): void => {
    if (props.place('brazier', x, y, 0, true)) props.tint.set(g.idx(x, y), brazierTint);
  };

  if (plain) {
    // Theme-neutral decoration only (the fallback layout serves every theme).
    for (const r of geo) {
      const sx = r.cx - 2;
      const sy = r.cy - 2;
      for (const [x, y] of [
        [sx, sy],
        [mirror(r.cx, sx), sy],
        [sx, mirror(r.cy, sy)],
        [mirror(r.cx, sx), mirror(r.cy, sy)],
      ] as Array<[number, number]>) {
        if (r.role === 'entrance' || r.role === 'treasure') props.place('barrel', x, y, 0, true);
        else props.place('pillar', x, y, 0, true);
      }
    }
    return;
  }
  for (const a of alcoves) {
    for (const [x, y] of a.cells) {
      if (a.kind === 'brazier') brazier(x, y);
      else props.place(a.kind, x, y, 0, true);
    }
  }

  for (const r of geo) {
    const horiz = r.hw >= r.hh;
    /** Four mirrored cells for half-grid offsets (ia along x, ib along y), as in the symmetric room frame. */
    const cells4 = (ia: number, ib: number): Array<[number, number]> => {
      const xl = r.cx - ia;
      const xr = r.cx + 1 + ia;
      const yt = r.cy - ib;
      const yb = r.cy + 1 + ib;
      return [
        [xl, yt],
        [xr, yt],
        [xl, yb],
        [xr, yb],
      ];
    };
    /** Place symmetric props. `la` is offset along the room's long axis, `lb` across it. */
    const sym = (type: string, la: number, lb: number, blocking: boolean, rot = 0): void => {
      const [ia, ib] = horiz ? [la, lb] : [lb, la];
      const group = cells4(ia, ib);
      // All-or-nothing keeps the room symmetric.
      if (!group.every(([x, y]) => props.can(x, y, blocking))) return;
      for (const [x, y] of group) {
        if (type === 'brazier') brazier(x, y);
        else props.place(type, x, y, rot, blocking);
      }
    };
    const longHalf = horiz ? r.hw : r.hh;
    const shortHalf = horiz ? r.hh : r.hw;
    const rotAlong = horiz ? 1 : 0;

    switch (r.variant) {
      case 'nave': {
        // Colonnade rows flanking the central aisle.
        if (shortHalf >= 4) {
          for (let la = 1; la <= longHalf - 2; la += 2) sym('pillar', la, 2, true);
        } else sym('pillar', 2, 2, true);
        if (shortHalf >= 5) for (let la = 2; la <= longHalf - 3; la += 3) sym('statue', la, shortHalf - 1, true, 0);
        break;
      }
      case 'tombs': {
        // Two ranks of sarcophagi, mirrored about the room's axes.
        const lb = shortHalf >= 4 ? 2 : 1;
        for (let la = 1; la <= longHalf - 2; la += 2) sym('sarcophagus', la, lb, true, rotAlong);
        if (shortHalf >= 5) for (let la = 1; la <= longHalf - 3; la += 2) sym('urn', la, shortHalf - 1, true);
        break;
      }
      case 'quad': {
        sym('pillar', 2, 2, true);
        if (longHalf >= 5 && shortHalf >= 5) sym('pillar', longHalf - 2, shortHalf - 2, true);
        sym('brazier', longHalf - 1, shortHalf - 1, true);
        if (longHalf >= 4) sym('statue', 3, shortHalf - 1, true, 2);
        break;
      }
      case 'gallery': {
        for (let la = 1; la <= longHalf - 2; la += 2) sym('statue', la, shortHalf - 1, true, 2);
        sym('urn', longHalf - 1, 1, true);
        break;
      }
      case 'entry': {
        sym('brazier', longHalf - 1, shortHalf - 2, true);
        sym('urn', 1, shortHalf - 1, true);
        break;
      }
      case 'vault': {
        sym('urn', 2, 1, true);
        sym('sarcophagus', 1, 2, true, rotAlong);
        break;
      }
      case 'grand': {
        // Colonnade on the gallery lip, statues against the outer wall, braziers at the ends of the aisle.
        for (let la = 1; la <= longHalf - 2; la += 2) sym('pillar', la, 3, true);
        for (let la = 2; la <= longHalf - 3; la += 3) sym('statue', la, shortHalf - 1, true, 2);
        sym('brazier', longHalf - 1, 1, true);
        break;
      }
      case 'moat': {
        // Braziers at the island's corners, a pair of tombs flanking its centre, statues watching from the outer corners.
        sym('brazier', MOAT_RING - 1, MOAT_RING - 1, true);
        sym('sarcophagus', 1, 0, true, rotAlong);
        sym('statue', longHalf - 1, shortHalf - 1, true, 2);
        break;
      }
      case 'collapsed': {
        // Rubble heaped round the hole, pillars standing at the corners.
        sym('pillar', longHalf - 2, shortHalf - 2, true);
        for (let ia = 0; ia <= 3; ia++) {
          for (let ib = 0; ib <= 3; ib++) {
            if (Math.max(ia, ib) !== 2) continue;
            for (const [x, y] of cells4(ia, ib)) if (rng.chance(0.55)) props.place(rng.chance(0.7) ? 'rubble' : 'bones', x, y, rng.int(0, 3), false);
          }
        }
        break;
      }
      case 'pitHall': {
        // Braziers in the corners, statues beside the centre, debris strewn on floor touching a pit.
        sym('brazier', longHalf - 1, shortHalf - 1, true);
        sym('statue', 1, 1, true, 2);
        for (let ia = 0; ia <= 4; ia++) {
          for (let ib = 0; ib <= 4; ib++) {
            const inPit = ia >= 2 && ia <= 3 && ib >= 2 && ib <= 3;
            if (inPit) continue;
            const touches = [
              [ia + 1, ib],
              [ia - 1, ib],
              [ia, ib + 1],
              [ia, ib - 1],
            ].some(([a, b]) => (a as number) >= 2 && (a as number) <= 3 && (b as number) >= 2 && (b as number) <= 3);
            if (!touches) continue;
            for (const [x, y] of cells4(ia, ib)) if (rng.chance(0.4)) props.place(rng.chance(0.6) ? 'rubble' : 'bones', x, y, rng.int(0, 3), false);
          }
        }
        break;
      }
      case 'throne': {
        if (r.ring) {
          // Ambulatory: a ring of pillars around the dais, leaving the door axes open.
          for (let ia = 1; ia <= 3; ia++) {
            for (let ib = 1; ib <= 3; ib++) if (Math.max(ia, ib) === 3) sym('pillar', ia, ib, true);
          }
          sym('brazier', 4, 4, true);
          break;
        }
        sym('pillar', 3, 3, true);
        sym('brazier', 4, 2, true);
        sym('brazier', 2, 4, true);
        break;
      }
    }
    // Cobwebs in convex corners.
    for (let y = r.cy - r.hh + 1; y <= r.cy + r.hh; y++) {
      for (let x = r.cx - r.hw + 1; x <= r.cx + r.hw; x++) {
        if (g.room[g.idx(x, y)] !== r.id || !props.free(x, y)) continue;
        let walls = 0;
        let rot = 0;
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = NEI4[d] as readonly [number, number];
          if (g.kind(x + dx, y + dy) === K.Wall) {
            walls++;
            rot = d;
          }
        }
        if (walls >= 2 && rng.chance(0.2)) props.place('cobweb', x, y, rot, false);
      }
    }
    // A little litter.
    if (r.variant !== 'throne' && r.variant !== 'entry') {
      const cells = ctx.rooms[r.id]?.cells ?? [];
      for (let k = 0; k < 3; k++) {
        const i = rng.pick(cells);
        if ((ctx.edge[i] as number) <= 2) props.place(rng.chance(0.5) ? 'bones' : 'rubble', i % g.w, (i / g.w) | 0, rng.int(0, 3), false);
      }
    }
  }
}

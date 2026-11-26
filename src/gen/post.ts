import type { Rng } from '../core/rng';
import type { FloorPlan, GridPos, LightPlacement, Room, SpawnSlot, ThemeId } from '../core/types';
import { GenFail, Grid, K, NEI8, isWalkKind } from './grid';
import { LIGHT_TYPES, PropLayer, type DecorCtx, type Layout, type RoomInfo } from './layout';
import { buildCost, floodReach } from './nav';
import { REST_LIGHT, dressNook, placeRestSpots } from './rest';
import { addWalls } from './walls';

export interface FloorRequest {
  seed: number;
  depth: number;
  theme: ThemeId;
}

/**
 * Shared post-processing: normalise elevation, raise walls, derive the Room
 * list, pick entrance and exit, let the theme decorate, place spawn slots,
 * repair prop-induced disconnections, then add torches and lights.
 */
/** Optional out-parameter collecting generation diagnostics. */
export interface FinalizeReport {
  restTiers: number[];
  setPiece?: string;
}

export function finalize(layout: Layout, req: FloorRequest, rng: Rng, report?: FinalizeReport): FloorPlan {
  const g = layout.grid;
  const { w, h } = g;

  normalizeElevation(g);
  addWalls(g);

  const infos = buildRoomInfos(g, layout.roles);
  const rooms = buildRooms(infos, layout.edges);

  const edge = edgeDistance(g);
  const doorDist = doorDistance(g, infos);
  const props = new PropLayer(g);

  const entranceRoom = infos.find((r) => r.role === 'entrance') as RoomInfo;
  const bossRoom = infos.find((r) => r.role === 'boss') as RoomInfo;
  const entrance = farthestFromDoor(g, entranceRoom, doorDist, edge, rng);
  const exit = farthestFromDoor(g, bossRoom, doorDist, edge, rng);

  // Reserve cells where blocking props are banned.
  const reserve = (x: number, y: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (g.inb(x + dx, y + dy)) props.reserved[g.idx(x + dx, y + dy)] = 1;
      }
    }
  };
  for (const r of infos) {
    for (const i of r.cells) {
      if ((doorDist[i] as number) === 0) reserve(i % w, (i / w) | 0, 1);
    }
    reserve(r.center.x, r.center.y, 0);
  }
  reserve(entrance.x, entrance.y, 1);
  reserve(exit.x, exit.y, 1);
  props.keepFree[g.idx(entrance.x, entrance.y)] = 1;
  props.keepFree[g.idx(exit.x, exit.y)] = 1;

  const ctx: DecorCtx = {
    grid: g,
    rng: rng.fork('decor'),
    depth: req.depth,
    rooms: infos,
    props,
    edge,
    doorDist,
    entrance,
    exit,
  };
  layout.decorate(ctx);

  const spawns = placeSpawns(g, infos, props, doorDist, edge, entrance, exit, rng.fork('spawns'), req.depth);

  const plan: FloorPlan = {
    seed: req.seed,
    depth: req.depth,
    theme: req.theme,
    width: w,
    height: h,
    kinds: g.kinds,
    elevation: g.elev,
    roomIds: g.room,
    rooms,
    entrance,
    exit,
    spawns,
    props: props.list,
    lights: [],
    restSpots: [],
  };

  const rest = placeRestSpots(g, plan, props, infos, rng.fork('rest'));
  const dressRng = rng.fork('restdress');
  for (const nook of rest.nooks) dressNook(g, props, nook, req.theme, dressRng);
  for (const s of plan.restSpots) props.keepFree[g.idx(s.x, s.y)] = 1;
  if (report) {
    report.restTiers = rest.tiers;
    report.setPiece = layout.setPiece;
  }

  repairConnectivity(plan, props);
  const spawnCells = new Set(spawns.map((s) => g.idx(s.pos.x, s.pos.y)));
  for (const s of plan.restSpots) spawnCells.add(g.idx(s.x, s.y));
  const route = new Set(rest.path);
  addTorches(g, infos, props, spawnCells, rng.fork('torches'), route, exit);
  plan.lights = buildLights(props, rng.fork('lights'), plan.restSpots, rest.path, exit);
  return plan;
}

// ---------------------------------------------------------------------------

function normalizeElevation(g: Grid): void {
  const n = g.w * g.h;
  let min = 127;
  for (let i = 0; i < n; i++) if (isWalkKind(g.kinds[i] as number)) min = Math.min(min, g.elev[i] as number);
  if (min === 127) throw new GenFail('no walkable cells');
  for (let i = 0; i < n; i++) {
    g.elev[i] = isWalkKind(g.kinds[i] as number) ? (g.elev[i] as number) - min : 0;
  }
}

function buildRoomInfos(g: Grid, roles: Layout['roles']): RoomInfo[] {
  const { w, h } = g;
  const infos: RoomInfo[] = roles.map((role, id) => ({
    id,
    role,
    cells: [],
    bounds: { x0: w, y0: h, x1: -1, y1: -1 },
    center: { x: 0, y: 0 },
  }));
  for (let i = 0; i < w * h; i++) {
    const id = g.room[i] as number;
    if (id < 0 || !isWalkKind(g.kinds[i] as number)) continue;
    const info = infos[id];
    if (!info) throw new GenFail('room id out of range');
    info.cells.push(i);
    const x = i % w;
    const y = (i / w) | 0;
    info.bounds.x0 = Math.min(info.bounds.x0, x);
    info.bounds.y0 = Math.min(info.bounds.y0, y);
    info.bounds.x1 = Math.max(info.bounds.x1, x);
    info.bounds.y1 = Math.max(info.bounds.y1, y);
  }
  for (const r of infos) {
    if (r.cells.length < 4) throw new GenFail(`room ${r.id} too small`);
    let sx = 0;
    let sy = 0;
    for (const i of r.cells) {
      sx += i % w;
      sy += (i / w) | 0;
    }
    const cx = sx / r.cells.length;
    const cy = sy / r.cells.length;
    let best = -1;
    let bd = Infinity;
    for (const i of r.cells) {
      if (g.kinds[i] !== K.Floor) continue;
      const d = ((i % w) - cx) ** 2 + (((i / w) | 0) - cy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) throw new GenFail('room without floor');
    r.center = { x: best % w, y: (best / w) | 0 };
  }
  return infos;
}

function buildRooms(infos: RoomInfo[], edges: Array<[number, number]>): Room[] {
  const nb: number[][] = infos.map(() => []);
  for (const [a, b] of edges) {
    if (!nb[a]?.includes(b)) nb[a]?.push(b);
    if (!nb[b]?.includes(a)) nb[b]?.push(a);
  }
  const dist = new Array<number>(infos.length).fill(-1);
  const start = infos.findIndex((r) => r.role === 'entrance');
  dist[start] = 0;
  const q = [start];
  for (let hd = 0; hd < q.length; hd++) {
    const i = q[hd] as number;
    for (const j of nb[i] as number[]) {
      if (dist[j] === -1) {
        dist[j] = (dist[i] as number) + 1;
        q.push(j);
      }
    }
  }
  return infos.map((r) => ({
    id: r.id,
    role: r.role,
    bounds: r.bounds,
    center: r.center,
    neighbors: (nb[r.id] as number[]).slice().sort((a, b) => a - b),
    distanceFromEntrance: dist[r.id] as number,
  }));
}

/** Distance from each walkable cell to the nearest non-walkable cell (1 = touching one). */
function edgeDistance(g: Grid): Uint8Array {
  const { w, h } = g;
  const out = new Uint8Array(w * h);
  const q: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!g.walkable(x, y)) continue;
      for (const [dx, dy] of NEI8) {
        if (!g.walkable(x + dx, y + dy)) {
          out[y * w + x] = 1;
          q.push(y * w + x);
          break;
        }
      }
    }
  }
  for (let hd = 0; hd < q.length; hd++) {
    const i = q[hd] as number;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of NEI8) {
      if (!g.walkable(x + dx, y + dy)) continue;
      const j = (y + dy) * w + x + dx;
      if (out[j] === 0) {
        out[j] = Math.min(250, (out[i] as number) + 1);
        q.push(j);
      }
    }
  }
  return out;
}

/** For room cells: steps from the nearest doorway cell (0 at a doorway); -1 for non-room cells. */
function doorDistance(g: Grid, infos: RoomInfo[]): Int16Array {
  const { w, h } = g;
  const out = new Int16Array(g.w * g.h).fill(-1);
  for (const r of infos) {
    for (const i of r.cells) out[i] = 99;
    const q: number[] = [];
    for (const i of r.cells) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of NEI8) {
        if (g.walkable(x + dx, y + dy) && g.room[(y + dy) * w + x + dx] !== r.id) {
          out[i] = 0;
          q.push(i);
          break;
        }
      }
    }
    for (let hd = 0; hd < q.length; hd++) {
      const i = q[hd] as number;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of NEI8) {
        const j = (y + dy) * w + x + dx;
        if (g.walkable(x + dx, y + dy) && g.room[j] === r.id && (out[j] as number) > (out[i] as number) + 1) {
          out[j] = (out[i] as number) + 1;
          q.push(j);
        }
      }
    }
  }
  return out;
}

function farthestFromDoor(g: Grid, room: RoomInfo, doorDist: Int16Array, edge: Uint8Array, rng: Rng): GridPos {
  let best: number[] = [];
  let bs = -1;
  for (const i of room.cells) {
    if (g.kinds[i] !== K.Floor) continue;
    const d = doorDist[i] as number;
    if (d >= 99) continue;
    const score = d * 2 + ((edge[i] as number) <= 1 ? 1 : 0);
    if (score > bs) {
      bs = score;
      best = [i];
    } else if (score === bs) best.push(i);
  }
  if (best.length === 0) throw new GenFail('no entrance/exit cell');
  const i = rng.pick(best);
  return { x: i % g.w, y: (i / g.w) | 0 };
}

// ---------------------------------------------------------------------------
// Spawn slots

function spread(rng: Rng, cand: number[], k: number, w: number, avoid: number[]): number[] {
  const chosen: number[] = [];
  const pts = [...avoid];
  const used = new Set<number>();
  const dist2 = (a: number, b: number): number => ((a % w) - (b % w)) ** 2 + (((a / w) | 0) - ((b / w) | 0)) ** 2;
  while (chosen.length < k) {
    let best = -1;
    let bs = -Infinity;
    for (const c of cand) {
      if (used.has(c)) continue;
      let d = 100;
      for (const p of pts) d = Math.min(d, dist2(c, p));
      if (pts.length > 0 && d < 4) continue; // not adjacent to another slot
      const score = Math.min(Math.sqrt(d), 6) + rng.next() * 1.5;
      if (score > bs) {
        bs = score;
        best = c;
      }
    }
    if (best < 0) break;
    chosen.push(best);
    used.add(best);
    pts.push(best);
  }
  return chosen;
}

function placeSpawns(
  g: Grid,
  infos: RoomInfo[],
  props: PropLayer,
  doorDist: Int16Array,
  edge: Uint8Array,
  entrance: GridPos,
  exit: GridPos,
  rng: Rng,
  depth: number,
): SpawnSlot[] {
  const out: SpawnSlot[] = [];
  const ei = g.idx(entrance.x, entrance.y);
  const xi = g.idx(exit.x, exit.y);
  const slot = (i: number, roomId: number, role: SpawnSlot['role']): void => {
    out.push({ pos: { x: i % g.w, y: (i / g.w) | 0 }, roomId, role });
  };
  for (const r of infos) {
    if (r.role === 'entrance' || r.role === 'passage') continue;
    const usable = (i: number): boolean => i !== ei && i !== xi && props.occ[i] !== 2 && !props.keepFree[i];
    const floorCells = r.cells.filter((i) => g.kinds[i] === K.Floor && usable(i));
    const all = floorCells.concat(r.cells.filter((i) => g.kinds[i] === K.Water && usable(i)));
    // Prefer cells far from doorways; relax the margin until enough remain.
    const pool = (need: number): number[] => {
      for (const src of [floorCells, all]) {
        for (let minD = 3; minD >= 0; minD--) {
          const c = src.filter((i) => (doorDist[i] as number) >= minD);
          if (c.length >= need * 2 || (minD === 0 && c.length >= need)) return c;
        }
      }
      return all;
    };
    if (r.role === 'combat') {
      const want = clamp(3 + rng.int(0, 1) + (r.cells.length >= 60 ? 1 : 0) + (depth >= 6 ? 1 : 0), 3, 6);
      let picks: number[] = [];
      // Prefer cells far from doorways; relax the margin if the room cannot host enough slots.
      // Where dry floor that far in is too scarce (flooded rooms), standing in water beats standing at the door.
      search: for (const minD of [3, 2, 1, 0]) {
        for (const src of floorCells.length >= 2 * want ? [floorCells, all] : [all]) {
          const cand = src.filter((i) => (doorDist[i] as number) >= minD);
          const got = spread(rng, cand, want, g.w, []);
          if (got.length > picks.length) picks = got;
          if (picks.length >= Math.min(want, 4)) break search;
        }
      }
      if (picks.length < 3) throw new GenFail(`combat room ${r.id} has too few slots`);
      for (const i of picks) slot(i, r.id, 'monster');
    } else if (r.role === 'boss') {
      const cand = pool(4);
      const cx = r.center.x;
      const cy = r.center.y;
      let bi = -1;
      let bd = Infinity;
      for (const i of cand) {
        const d = ((i % g.w) - cx) ** 2 + (((i / g.w) | 0) - cy) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi < 0) throw new GenFail('no boss slot');
      slot(bi, r.id, 'boss');
      const want = clamp(2 + (depth >= 4 ? 1 : 0) + (rng.chance(0.4) ? 1 : 0), 2, 4);
      const picks = spread(rng, cand, want, g.w, [bi]);
      if (picks.length < 2) throw new GenFail('boss room has too few slots');
      for (const i of picks) slot(i, r.id, 'monster');
    } else if (r.role === 'treasure') {
      const cand = floorCells.length ? floorCells : all;
      let bi = -1;
      let bs = -Infinity;
      for (const i of cand) {
        const score = Math.min(doorDist[i] as number, 8) + ((edge[i] as number) <= 1 ? 2 : 0) + rng.next();
        if (score > bs) {
          bs = score;
          bi = i;
        }
      }
      if (bi < 0) throw new GenFail('no chest slot');
      slot(bi, r.id, 'chest');
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------

/** If blocking props cut anything off, remove the most recently placed ones until everything is reachable again. */
function repairConnectivity(plan: FloorPlan, props: PropLayer): void {
  const w = plan.width;
  const targets: GridPos[] = [plan.exit, ...plan.rooms.map((r) => r.center), ...plan.spawns.map((s) => s.pos)];
  for (let guard = 0; guard < 400; guard++) {
    const cost = buildCost(plan);
    for (const r of plan.restSpots) cost[r.y * w + r.x] = 0;
    const reach = floodReach(plan, plan.entrance, cost);
    if (targets.every((t) => reach[t.y * w + t.x] === 1)) return;
    let removed = false;
    for (let k = props.list.length - 1; k >= 0; k--) {
      const p = props.list[k] as FloorPlan['props'][number];
      if (!p.blocking) continue;
      props.list.splice(k, 1);
      props.occ[p.pos.y * w + p.pos.x] = 0;
      removed = true;
      break;
    }
    if (!removed) throw new GenFail('layout itself is disconnected');
  }
  throw new GenFail('connectivity repair did not converge');
}

// ---------------------------------------------------------------------------
// Torches and lights

function addTorches(g: Grid, infos: RoomInfo[], props: PropLayer, avoid: Set<number>, rng: Rng, route: Set<number>, exit: GridPos): void {
  const placed: number[] = [];
  const spacingOk = (i: number, d: number): boolean => {
    for (const p of placed) {
      if (((p % g.w) - (i % g.w)) ** 2 + (((p / g.w) | 0) - ((i / g.w) | 0)) ** 2 < d * d) return false;
    }
    return true;
  };
  const tryRoom = (cells: number[], count: number, spacing: number): void => {
    const cand = rng.shuffle(cells.filter((i) => g.kinds[i] === K.Floor && !avoid.has(i) && props.free(i % g.w, (i / g.w) | 0)));
    let got = 0;
    for (const i of cand) {
      if (got >= count) break;
      const x = i % g.w;
      const y = (i / g.w) | 0;
      const dir = props.wallDir(x, y, rng);
      if (dir < 0 || !spacingOk(i, spacing)) continue;
      if (props.place('torch', x, y, dir, false)) {
        placed.push(i);
        got++;
      }
    }
  };
  // The exit is lit so it reads from across the boss room.
  const near: number[] = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) near.push((exit.y + dy) * g.w + exit.x + dx);
  tryRoom(near.filter((i) => i >= 0 && i < g.w * g.h), 2, 3);
  // Rooms on the main route are lit well; side rooms get a single torch.
  for (const r of infos) {
    const area = r.cells.length;
    const onRoute = r.cells.some((i) => route.has(i));
    const count = r.role === 'boss' ? 4 : r.role === 'entrance' ? 2 : onRoute ? (area > 70 ? 3 : 2) : 1;
    tryRoom(r.cells, count, 5);
  }
  // Only passages on the main route get torches; branches stay dark.
  const passage: number[] = [];
  for (const i of route) if (g.room[i] === -1 && g.kinds[i] === K.Floor) passage.push(i);
  tryRoom(passage, 5, 7);
  // Make sure there are enough torches to reach the minimum light count even on sparse floors.
  const lit = props.list.filter((p) => LIGHT_TYPES.has(p.type)).length;
  if (lit < 8) {
    const all: number[] = [];
    for (let i = 0; i < g.w * g.h; i++) if (g.kinds[i] === K.Floor) all.push(i);
    tryRoom(all, 8 - lit + 2, 4);
  }
}

const LIGHT_DEFS: Record<string, { color: number; intensity: [number, number]; radius: [number, number] }> = {
  torch: { color: 0xffa040, intensity: [0.9, 1.2], radius: [4.5, 5.5] },
  campfire: { color: 0xff7a2a, intensity: [1.3, 1.6], radius: [6, 7] },
  brazier: { color: 0xffa040, intensity: [1.1, 1.4], radius: [5.5, 6.5] },
  mushrooms: { color: 0x55ff99, intensity: [0.6, 0.8], radius: [4, 4.5] },
  crystal: { color: 0x55d8ff, intensity: [1, 1.4], radius: [5, 6.5] },
};

function buildLights(props: PropLayer, rng: Rng, restSpots: GridPos[], path: number[], exit: GridPos): LightPlacement[] {
  const w = props.g.w;
  const cands = props.list.filter((p) => LIGHT_TYPES.has(p.type));
  const nearExit = (p: GridPos): boolean => Math.max(Math.abs(p.x - exit.x), Math.abs(p.y - exit.y)) <= 3;
  const major = cands.filter((p) => p.type === 'campfire' || p.type === 'brazier' || p.type === 'crystal' || nearExit(p.pos));
  const minor = cands.filter((p) => !major.includes(p));
  const selected: typeof cands = [];
  const cap = 24 - restSpots.length;
  const d2 = (a: GridPos, b: GridPos): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  for (const pool of [major, minor]) {
    const left = pool.slice();
    while (selected.length < cap && left.length > 0) {
      let bi = 0;
      let bs = -1;
      for (let k = 0; k < left.length; k++) {
        const p = left[k] as (typeof cands)[number];
        let d = 1e9;
        for (const s of selected) d = Math.min(d, d2(p.pos, s.pos));
        const score = d + rng.next() * 0.5;
        if (score > bs) {
          bs = score;
          bi = k;
        }
      }
      selected.push(left.splice(bi, 1)[0] as (typeof cands)[number]);
    }
  }
  const restLights: LightPlacement[] = restSpots.map((s) => ({ pos: { x: s.x, y: s.y }, ...REST_LIGHT }));
  return restLights.concat(selected.map((p) => {
    const def = LIGHT_DEFS[p.type] as (typeof LIGHT_DEFS)[string];
    const tint = props.tint.get(p.pos.y * w + p.pos.x);
    // Brighter along the main route, dimmer on branches.
    let onRoute = false;
    for (const c of path) {
      if (Math.abs((c % w) - p.pos.x) <= 4 && Math.abs(((c / w) | 0) - p.pos.y) <= 4) {
        onRoute = true;
        break;
      }
    }
    const gain = onRoute ? 1.15 : 0.8;
    return {
      pos: { x: p.pos.x, y: p.pos.y },
      color: tint ?? def.color,
      intensity: round2(rng.range(def.intensity[0], def.intensity[1]) * gain),
      radius: round2(rng.range(def.radius[0], def.radius[1])),
    };
  }));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}


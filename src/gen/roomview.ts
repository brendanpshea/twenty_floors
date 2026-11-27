import type { GridPos, NavGrid, ThemeId, FloorPlan } from '../core/types';
import { Grid, K, NEI8, dist, isWalkKind } from './grid';
import type { PropLayer, RoomInfo } from './layout';
import { lineOfSight } from './sight';

/** Everything the terrain pass and the formation library need to know about the floor under construction. */
export interface StageEnv {
  g: Grid;
  /** The plan being built: shares `kinds`, `elevation` and `props` with the grid, so edits show through. Sight queries on `nav` see wall edits; props never block sight. */
  plan: FloorPlan;
  props: PropLayer;
  infos: RoomInfo[];
  doorDist: Int16Array;
  edge: Uint8Array;
  nav: NavGrid;
  entrance: GridPos;
  exit: GridPos;
  theme: ThemeId;
  depth: number;
  /** Walking steps (ignoring props) from the nearest entrance-room cell; -1 where unreachable. */
  entranceDist: Int16Array;
  /** Floor cells of the entrance room. */
  entranceCells: number[];
  /** Cache for `isNear`: 0 unknown, 1 no, 2 yes. */
  nearEntrance: Uint8Array;
  /** Push targets by cell (see pushMap), kept up to date by the hazard pass. */
  pushMask?: Uint8Array;
  /** Buffers the room views share (one view is alive at a time). */
  scratch?: { reach: Int16Array; parent: Int32Array; visMain: Uint8Array; visAny: Uint8Array };
}

/** A room seen from its main doorway: the geometry formations are built on. */
export interface RoomView {
  env: StageEnv;
  info: RoomInfo;
  id: number;
  /** Walkable cells of the room (indices). */
  cells: number[];
  /** Outside cells of every doorway of the room (passage cells, or cells of a neighbouring room). */
  thresholds: number[];
  /** The doorways the hero can arrive by: those reachable from the entrance without crossing the room. */
  entry: number[];
  /** The doorway the hero most likely arrives by (nearest the entrance), as the outside cell... */
  mainT: number;
  /** ... and the room cell just inside it. */
  mainD: number;
  /** Unit vector from the main doorway into the room. */
  dx: number;
  dy: number;
  /** Walking steps inside the room from `mainD` (-1 = cannot be reached through the room). */
  reach: Int16Array;
  /** BFS parent toward `mainD` (indices; -1 at the root and for unreached cells). */
  parent: Int32Array;
  /** 1 where the cell is in sight of `mainT`. */
  visMain: Uint8Array;
  /** 1 where the cell is in sight of any doorway the hero can arrive by. */
  visAny: Uint8Array;
  /** Largest depth (distance along the approach) among reachable cells. */
  maxDepth: number;
}

export const cheb = (w: number, a: number, b: number): number =>
  Math.max(Math.abs((a % w) - (b % w)), Math.abs(((a / w) | 0) - ((b / w) | 0)));

/** True if stepping a -> b is legal for a walker (8-way, no corner cutting, step up/down at most 1). */
export function canStep(g: Grid, props: PropLayer, a: number, b: number): boolean {
  const w = g.w;
  if (!isWalkKind(g.kinds[b] as number) || props.occ[b] === 2) return false;
  if (Math.abs((g.elev[a] as number) - (g.elev[b] as number)) > 1) return false;
  const ax = a % w;
  const ay = (a / w) | 0;
  const bx = b % w;
  const by = (b / w) | 0;
  if (ax !== bx && ay !== by) {
    const c1 = ay * w + bx;
    const c2 = by * w + ax;
    if (!isWalkKind(g.kinds[c1] as number) || props.occ[c1] === 2 || !isWalkKind(g.kinds[c2] as number) || props.occ[c2] === 2) return false;
  }
  return true;
}

/** Walking distance (steps) from a set of cells, over walkable cells, ignoring blocking props. -1 = unreached. */
export function walkDistances(g: Grid, sources: number[], limit = 9999): Int16Array {
  const out = new Int16Array(g.w * g.h).fill(-1);
  const q: number[] = [];
  for (const s of sources) {
    out[s] = 0;
    q.push(s);
  }
  const w = g.w;
  for (let hd = 0; hd < q.length; hd++) {
    const i = q[hd] as number;
    const d = out[i] as number;
    if (d >= limit) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [ox, oy] of NEI8) {
      const nx = x + ox;
      const ny = y + oy;
      if (!g.inb(nx, ny)) continue;
      const j = ny * w + nx;
      if (out[j] !== -1 || !isWalkKind(g.kinds[j] as number)) continue;
      if (Math.abs((g.elev[i] as number) - (g.elev[j] as number)) > 1) continue;
      if (ox !== 0 && oy !== 0 && (!g.walkable(nx, y) || !g.walkable(x, ny))) continue;
      out[j] = d + 1;
      q.push(j);
    }
  }
  return out;
}

/** Walking distances from the entrance room, and its floor cells. */
export function entranceFields(g: Grid, infos: RoomInfo[]): { entranceDist: Int16Array; entranceCells: number[]; nearEntrance: Uint8Array } {
  const room = infos.find((r) => r.role === 'entrance') as RoomInfo;
  return {
    entranceDist: walkDistances(g, room.cells),
    entranceCells: room.cells.filter((i) => g.kinds[i] === K.Floor),
    nearEntrance: new Uint8Array(g.w * g.h),
  };
}

/**
 * True if a monster standing at `c` would be inside the 7-cell walking range, and in sight, of a cell
 * of the entrance room: a fight could start before the hero leaves it. (Conservative: straight-line
 * range stands in for walking range per cell pair.)
 */
export function isNear(env: StageEnv, c: number): boolean {
  const cached = env.nearEntrance[c] as number;
  if (cached !== 0) return cached === 2;
  const w = env.g.w;
  const d = env.entranceDist[c] as number;
  let near = false;
  if (d >= 1 && d <= 7 && env.g.room[c] !== env.infos.find((r) => r.role === 'entrance')?.id) {
    const x = c % w;
    const y = (c / w) | 0;
    for (const e of env.entranceCells) {
      if (Math.max(Math.abs((e % w) - x), Math.abs(((e / w) | 0) - y)) > 7) continue;
      if (lineOfSight(env.g.kinds, w, x, y, e % w, (e / w) | 0)) {
        near = true;
        break;
      }
    }
  }
  env.nearEntrance[c] = near ? 2 : 1;
  return near;
}

/** Builds the view of one room from its main doorway. Call again after editing cells or props in the room. */
export function buildView(env: StageEnv, info: RoomInfo): RoomView {
  const { g, props } = env;
  const w = g.w;
  const id = info.id;
  const cells = info.cells.filter((i) => isWalkKind(g.kinds[i] as number));
  const thresholds = roomThresholds(g.kinds, g.room, w, g.h, id, cells);
  const entry = entryByGraph(env, id, thresholds);
  const arrival = entry.length > 0 ? entry : thresholds;
  let mainT = arrival[0] ?? info.center.y * w + info.center.x;
  let best = Infinity;
  for (const t of arrival) {
    const d = env.entranceDist[t] as number;
    const v = d < 0 ? 9999 : d;
    if (v < best) {
      best = v;
      mainT = t;
    }
  }
  const tx = mainT % w;
  const ty = (mainT / w) | 0;
  // The room cell just inside: next to mainT, nearest the room's centre.
  let mainD = -1;
  let bd = Infinity;
  for (const [ox, oy] of NEI8) {
    const nx = tx + ox;
    const ny = ty + oy;
    if (!g.inb(nx, ny)) continue;
    const j = ny * w + nx;
    if (g.room[j] !== id || !isWalkKind(g.kinds[j] as number) || props.occ[j] === 2) continue;
    const d = (nx - info.center.x) ** 2 + (ny - info.center.y) ** 2;
    if (d < bd) {
      bd = d;
      mainD = j;
    }
  }
  if (mainD < 0) mainD = info.center.y * w + info.center.x;

  // Approach direction: from the doorway toward the middle of the room's cells.
  let sx = 0;
  let sy = 0;
  for (const i of cells) {
    sx += i % w;
    sy += (i / w) | 0;
  }
  let vx = sx / Math.max(1, cells.length) - tx;
  let vy = sy / Math.max(1, cells.length) - ty;
  const len = dist(vx, vy);
  if (len < 0.5) {
    vx = 0;
    vy = 1;
  } else {
    vx /= len;
    vy /= len;
  }

  const sc = (env.scratch ??= { reach: new Int16Array(w * g.h), parent: new Int32Array(w * g.h), visMain: new Uint8Array(w * g.h), visAny: new Uint8Array(w * g.h) });
  const reach = sc.reach;
  const parent = sc.parent;
  fillReach(env, id, mainD, reach, parent);
  const maxDepth = deepest(cells, reach, w, tx, ty, vx, vy);
  const view: RoomView = {
    env,
    info,
    id,
    cells,
    thresholds,
    entry: arrival,
    mainT,
    mainD,
    dx: vx,
    dy: vy,
    reach,
    parent,
    visMain: sc.visMain,
    visAny: sc.visAny,
    maxDepth,
  };
  recomputeVis(view);
  return view;
}

/** Sight from the doorways (after walls in the room changed). */
export function recomputeVis(v: RoomView): void {
  const { g } = v.env;
  const w = g.w;
  const k = g.kinds;
  const tx = v.mainT % w;
  const ty = (v.mainT / w) | 0;
  for (const i of v.cells) {
    const x = i % w;
    const y = (i / w) | 0;
    v.visMain[i] = 0;
    v.visAny[i] = 0;
    if (lineOfSight(k, w, tx, ty, x, y)) {
      v.visMain[i] = 1;
      v.visAny[i] = 1;
    } else {
      for (const t of v.entry) {
        if (t !== v.mainT && lineOfSight(k, w, t % w, (t / w) | 0, x, y)) {
          v.visAny[i] = 1;
          break;
        }
      }
    }
  }
}

/** Distance of a cell along the approach, measured from the main doorway. */
export function depthOf(v: RoomView, c: number): number {
  const w = v.env.g.w;
  return ((c % w) - (v.mainT % w)) * v.dx + (((c / w) | 0) - ((v.mainT / w) | 0)) * v.dy;
}

/** Sideways offset of a cell from the line of approach. */
export function sideOf(v: RoomView, c: number): number {
  const w = v.env.g.w;
  return -((c % w) - (v.mainT % w)) * v.dy + (((c / w) | 0) - ((v.mainT / w) | 0)) * v.dx;
}

/** Cells a monster may stand on, before formation-specific rules: floor, free of blocking props, reachable, not special. */
export function slotOk(v: RoomView, c: number, minDoor = 2): boolean {
  const { g, props, entrance, exit } = v.env;
  const w = g.w;
  if (g.kinds[c] !== K.Floor || props.occ[c] === 2 || props.keepFree[c]) return false;
  if ((v.reach[c] as number) < 0 || g.room[c] !== v.id) return false;
  if (c === entrance.y * w + entrance.x || c === exit.y * w + exit.x) return false;
  return (v.env.doorDist[c] as number) >= minDoor;
}

/** Outside cells of a room's doorways: walkable cells of another room (or of a passage) touching one of its cells. */
export function roomThresholds(kinds: Uint8Array, roomIds: Int16Array, w: number, h: number, id: number, cells: number[]): number[] {
  const out: number[] = [];
  ensureBuffers(w * h);
  stamp++;
  for (const i of cells) {
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seenBuf[j] === stamp || roomIds[j] === id || !isWalkKind(kinds[j] as number)) continue;
      seenBuf[j] = stamp;
      out.push(j);
    }
  }
  return out;
}

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
let qBuf = new Int32Array(4096);
let seenBuf = new Int32Array(4096);
let stamp = 0;

function ensureBuffers(n: number): void {
  if (qBuf.length < n) {
    qBuf = new Int32Array(n);
    seenBuf = new Int32Array(n);
    stamp = 0;
  }
}

/** Which of a room's doorways the hero can arrive by: those reachable from `from` on foot without crossing the room. */
export function entryDoorways(kinds: Uint8Array, elev: Int8Array, roomIds: Int16Array, w: number, h: number, from: number, id: number, thresholds: number[]): number[] {
  ensureBuffers(w * h);
  stamp++;
  let qh = 0;
  let qt = 0;
  qBuf[qt++] = from;
  seenBuf[from] = stamp;
  const want = new Set(thresholds);
  let left = want.size;
  while (qh < qt && left > 0) {
    const i = qBuf[qh++] as number;
    const x = i % w;
    const y = (i / w) | 0;
    const ei = elev[i] as number;
    for (let d = 0; d < 8; d++) {
      const ox = DX[d] as number;
      const oy = DY[d] as number;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seenBuf[j] === stamp || roomIds[j] === id || !isWalkKind(kinds[j] as number)) continue;
      const de = ei - (elev[j] as number);
      if (de > 1 || de < -1) continue;
      if (ox !== 0 && oy !== 0 && (!isWalkKind(kinds[y * w + nx] as number) || !isWalkKind(kinds[ny * w + x] as number))) continue;
      seenBuf[j] = stamp;
      qBuf[qt++] = j;
      if (want.has(j)) left--;
    }
  }
  return thresholds.filter((t) => seenBuf[t] === stamp);
}

function deepest(cells: number[], reach: Int16Array, w: number, tx: number, ty: number, vx: number, vy: number): number {
  let m = 0;
  for (const i of cells) if ((reach[i] as number) >= 0) m = Math.max(m, ((i % w) - tx) * vx + (((i / w) | 0) - ty) * vy);
  return m;
}

/** Walking distances (and parents toward the doorway) inside the room, over legal steps and free of blocking props. */
function fillReach(env: StageEnv, id: number, mainD: number, reach: Int16Array, parent: Int32Array): void {
  const { g, props } = env;
  const w = g.w;
  ensureBuffers(w * g.h);
  reach.fill(-1);
  parent.fill(-1);
  let qh = 0;
  let qt = 0;
  qBuf[qt++] = mainD;
  reach[mainD] = 0;
  while (qh < qt) {
    const i = qBuf[qh++] as number;
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= g.h) continue;
      const j = ny * w + nx;
      if (reach[j] !== -1 || g.room[j] !== id || !canStep(g, props, i, j)) continue;
      reach[j] = (reach[i] as number) + 1;
      parent[j] = i;
      qBuf[qt++] = j;
    }
  }
}

/** Recompute walking reach after props or floor cells in the room changed (sight is unaffected by props and pits). */
export function refreshReach(v: RoomView): void {
  fillReach(v.env, v.id, v.mainD, v.reach, v.parent);
  const w = v.env.g.w;
  v.maxDepth = deepest(v.cells, v.reach, w, v.mainT % w, (v.mainT / w) | 0, v.dx, v.dy);
}

/**
 * The doorways the hero can arrive by, found on the room graph instead of by flooding the floor:
 * a doorway is one if the passage behind it (or the room next to it) is connected to the entrance
 * room without going through this room. Agrees with `entryDoorways`, the exact flood validation
 * uses, wherever a passage joins two rooms.
 */
function entryByGraph(env: StageEnv, id: number, thresholds: number[]): number[] {
  const { g, plan } = env;
  const w = g.w;
  const rooms = plan.rooms;
  const start = rooms.find((r) => r.role === 'entrance')?.id ?? 0;
  const ok = new Uint8Array(rooms.length);
  const q = [start];
  ok[start] = 1;
  for (let hd = 0; hd < q.length; hd++) {
    for (const nb of (rooms[q[hd] as number] as FloorPlan['rooms'][number]).neighbors) {
      if (nb === id || ok[nb] === 1) continue;
      ok[nb] = 1;
      q.push(nb);
    }
  }
  const out: number[] = [];
  for (const t of thresholds) {
    const rt = g.room[t] as number;
    if (rt >= 0) {
      if (rt !== id && ok[rt] === 1) out.push(t);
      continue;
    }
    // Walk the passage from the doorway to find the rooms it joins.
    ensureBuffers(w * g.h);
    stamp++;
    let qh = 0;
    let qt = 0;
    qBuf[qt++] = t;
    seenBuf[t] = stamp;
    let found = false;
    while (qh < qt && !found) {
      const i = qBuf[qh++] as number;
      const x = i % w;
      const y = (i / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + (DX[d] as number);
        const ny = y + (DY[d] as number);
        if (!g.inb(nx, ny)) continue;
        const j = ny * w + nx;
        if (seenBuf[j] === stamp || !isWalkKind(g.kinds[j] as number)) continue;
        const rj = g.room[j] as number;
        if (rj === id) continue;
        if (rj >= 0) {
          if (ok[rj] === 1) {
            found = true;
            break;
          }
          continue;
        }
        seenBuf[j] = stamp;
        qBuf[qt++] = j;
      }
    }
    if (found) out.push(t);
  }
  return out;
}

/**
 * After an edit (a pier, a pit, props): is every cell the room could walk to from the doorway when
 * the view was built (apart from the cells in `lost`) still reachable? Cheap flood, no allocation.
 */
export function stillConnected(v: RoomView, lost: number[]): boolean {
  const { g, props } = v.env;
  const w = g.w;
  ensureBuffers(w * g.h);
  stamp++;
  let qh = 0;
  let qt = 0;
  qBuf[qt++] = v.mainD;
  seenBuf[v.mainD] = stamp;
  while (qh < qt) {
    const i = qBuf[qh++] as number;
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= g.h) continue;
      const j = ny * w + nx;
      if (seenBuf[j] === stamp || g.room[j] !== v.id || !canStep(g, props, i, j)) continue;
      seenBuf[j] = stamp;
      qBuf[qt++] = j;
    }
  }
  for (const c of v.cells) {
    if ((v.reach[c] as number) >= 0 && seenBuf[c] !== stamp && !lost.includes(c)) return false;
  }
  return true;
}

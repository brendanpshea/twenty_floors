import type { Rng } from '../core/rng';
import type { SpawnPost, ThemeId } from '../core/types';
import { GenFail, K } from './grid';
import { cheb, depthOf, isNear, recomputeVis, sideOf, slotOk, stillConnected, type RoomView } from './roomview';
import { CENTRE_PROPS, COVER_PROPS, EditLog, HAZARD_MENU, addProp, finishEdit, raiseDais, setCell, stageBlob, undoEdit } from './stage';

/**
 * The formation library: where a room's monsters stand, and what part each plays (see "Making it
 * a thinking game" in docs/DESIGN.md). A formation reads the room as seen from its main doorway
 * (RoomView), returns slot positions tagged with a SpawnPost, and may stage the room with a few
 * props, a dais or wall stubs. A builder that fails undoes its own edits and returns null.
 */
export type FormationName = 'shieldWall' | 'snipers' | 'ambush' | 'camp' | 'gauntlet' | 'pincer' | 'den' | 'chokehold' | 'throne' | 'lair' | 'scattered';

export interface Pick {
  i: number;
  post: SpawnPost;
  boss?: boolean;
}

interface FCtx {
  v: RoomView;
  rng: Rng;
  /** Monster slots wanted (a boss slot comes on top, in boss rooms). */
  want: number;
  log: EditLog;
}

type Builder = (c: FCtx) => Pick[] | null;

// ---------------------------------------------------------------------------
// Small tools

/** Greedy pick of `k` cells by score, no two within `sep` of each other or of `fixed`. */
function pickSpaced(w: number, pool: number[], k: number, fixed: number[], score: (c: number) => number, sep = 2): number[] {
  const out: number[] = [];
  const taken = fixed.slice();
  const ranked = pool.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s || a.c - b.c);
  for (const { c } of ranked) {
    if (out.length >= k) break;
    if (taken.every((t) => cheb(w, t, c) >= sep)) {
      out.push(c);
      taken.push(c);
    }
  }
  return out;
}

/** Farthest-point pick: spreads `k` cells around, the first chosen by score. */
function pickFar(w: number, pool: number[], k: number, fixed: number[], rng: Rng): number[] {
  const out: number[] = [];
  const taken = fixed.slice();
  const left = pool.slice();
  while (out.length < k && left.length > 0) {
    let bi = -1;
    let bs = -Infinity;
    for (let n = 0; n < left.length; n++) {
      const c = left[n] as number;
      let d = 99;
      for (const t of taken) d = Math.min(d, cheb(w, t, c));
      if (taken.length > 0 && d < 2) continue;
      const s = Math.min(d, 6) + rng.next() * 1.2;
      if (s > bs) {
        bs = s;
        bi = n;
      }
    }
    if (bi < 0) break;
    const c = left.splice(bi, 1)[0] as number;
    out.push(c);
    taken.push(c);
  }
  return out;
}

/** `k` cells in a row across the approach, two to three apart, centred on the line of approach. */
function pickRow(v: RoomView, band: number[], k: number): number[] {
  const w = v.env.g.w;
  const sorted = band.slice().sort((a, b) => sideOf(v, a) - sideOf(v, b) || a - b);
  let best: number[] = [];
  let bs = -Infinity;
  for (let s = 0; s < sorted.length; s++) {
    const row = [sorted[s] as number];
    let last = row[0] as number;
    for (let j = s + 1; j < sorted.length && row.length < k; j++) {
      const c = sorted[j] as number;
      if (cheb(w, c, last) < 2) continue;
      if (sideOf(v, c) - sideOf(v, last) > 3.2) break;
      row.push(c);
      last = c;
    }
    if (row.length === k) {
      const mid = (sideOf(v, row[0] as number) + sideOf(v, last)) / 2;
      const score = -Math.abs(mid);
      if (score > bs) {
        bs = score;
        best = row;
      }
    }
  }
  return best;
}

const pool = (v: RoomView, minDoor: number): number[] => v.cells.filter((c) => slotOk(v, c, minDoor));

/** Cells where a pass-through is squeezed between two obstacles (props, walls, drops). */
function chokeCells(v: RoomView): number[] {
  const { g, props } = v.env;
  const w = g.w;
  const solid = (x: number, y: number): boolean => !g.walkable(x, y) || props.occ[y * w + x] === 2;
  const free = (x: number, y: number): boolean => g.walkable(x, y) && props.occ[y * w + x] !== 2;
  const out: number[] = [];
  for (const c of v.cells) {
    if (g.kinds[c] !== K.Floor || props.occ[c] === 2 || (v.reach[c] as number) < 0 || (v.env.doorDist[c] as number) < 2) continue;
    const x = c % w;
    const y = (c / w) | 0;
    const ew = solid(x - 1, y) && solid(x + 1, y) && free(x, y - 1) && free(x, y + 1);
    const ns = solid(x, y - 1) && solid(x, y + 1) && free(x - 1, y) && free(x + 1, y);
    if (ew || ns) out.push(c);
  }
  return out;
}

/** Spread of the room across the approach near its middle: a rough width. */
const widthCache = new WeakMap<RoomView, number>();
function lateralWidth(v: RoomView): number {
  const hit = widthCache.get(v);
  if (hit !== undefined) return hit;
  const T = v.maxDepth;
  let lo = 99;
  let hi = -99;
  for (const c of v.cells) {
    if ((v.reach[c] as number) < 0) continue;
    const d = depthOf(v, c);
    if (d < T * 0.35 || d > T * 0.85) continue;
    const s = sideOf(v, c);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const out = hi < lo ? 0 : hi - lo + 1;
  widthCache.set(v, out);
  return out;
}

function crossesChasm(v: RoomView, a: number, b: number): boolean {
  const { g } = v.env;
  const w = g.w;
  const n = cheb(w, a, b);
  const ax = a % w;
  const ay = (a / w) | 0;
  const bx = b % w;
  const by = (b / w) | 0;
  for (let s = 1; s < n; s++) {
    const x = Math.round(ax + ((bx - ax) * s) / n);
    const y = Math.round(ay + ((by - ay) * s) / n);
    if (g.kinds[y * w + x] === K.Chasm) return true;
  }
  return false;
}

/** Ledge, dais or far-side-of-a-gap cells that the hero at the doorway can see. */
const highCache = new WeakMap<RoomView, number[]>();
function highCells(v: RoomView): number[] {
  const hit = highCache.get(v);
  if (hit) return hit.slice();
  const out = computeHigh(v);
  highCache.set(v, out);
  return out.slice();
}

function computeHigh(v: RoomView): number[] {
  const { g } = v.env;
  const eRef = Math.max(g.elev[v.mainT] as number, g.elev[v.mainD] as number);
  const out: number[] = [];
  for (const c of v.cells) {
    if (!slotOk(v, c, 3) || v.visMain[c] !== 1 || depthOf(v, c) < 3) continue;
    if ((g.elev[c] as number) >= eRef + 1) out.push(c);
    else if ((v.reach[c] as number) > 1.5 * cheb(g.w, v.mainD, c) + 2 && crossesChasm(v, v.mainD, c) && crossesChasm(v, v.mainT, c)) out.push(c);
  }
  return out;
}

/** A blocking centrepiece of the theme already standing in the room, if any. */
function existingCentre(v: RoomView): number | null {
  const { g, props } = v.env;
  const w = g.w;
  const types = CENTRE_PROPS[v.env.theme];
  for (const p of props.list) {
    if (!p.blocking || !types.includes(p.type)) continue;
    const c = p.pos.y * w + p.pos.x;
    if (g.room[c] === v.id && (v.reach[c] as number) >= 0 && (v.env.edge[c] as number) >= 2 && (v.env.doorDist[c] as number) >= 3) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formations

const shieldWall: Builder = ({ v, rng, want, log }) => {
  const { g, props } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  if (T < 5) return null;
  const base = v.cells.filter((c) => slotOk(v, c, 3) && v.visMain[c] === 1);
  if (base.length < 4) return null;
  let best: { row: number[]; t0: number } | null = null;
  let bs = -Infinity;
  for (let t0 = Math.max(3, Math.round(T * 0.3)); t0 <= Math.min(T - 2.5, T * 0.72); t0++) {
    const band = base.filter((c) => Math.abs(depthOf(v, c) - t0) <= 0.5);
    for (const k of want >= 5 ? [3, 2] : [2]) {
      const row = pickRow(v, band, k);
      if (row.length !== k) continue;
      const span = sideOf(v, row[k - 1] as number) - sideOf(v, row[0] as number);
      const score = span + 0.4 * k + rng.next() * 0.9 - 0.15 * Math.abs(t0 - T * 0.45);
      if (score > bs) {
        bs = score;
        best = { row, t0 };
      }
      break;
    }
  }
  if (!best) return null;
  const fronts = best.row;
  const behind = base.filter((c) => {
    const d = depthOf(v, c);
    return d >= best.t0 + 1.5 && d <= best.t0 + 5 && fronts.every((f) => cheb(w, f, c) >= 2);
  });
  const b = want - fronts.length;
  const backs = pickSpaced(w, behind, b, fronts, (c) => {
    let gap = 9;
    for (const f of fronts) gap = Math.min(gap, Math.abs(sideOf(v, c) - sideOf(v, f)));
    return Math.min(gap, 3) + rng.next() - (isNear(v.env, c) ? 3 : 0);
  });
  if (fronts.length + backs.length < 3) return null;
  // Anchor the line: a piece of cover at each end of the row, where there is room for one.
  const slots = [...fronts, ...backs];
  const lead = fronts[0] as number;
  const tail = fronts[fronts.length - 1] as number;
  for (const [end, sign] of [[lead, -1], [tail, 1]] as const) {
    if (!rng.chance(0.75)) continue;
    const spots = v.cells.filter((c) => {
      if (g.kinds[c] !== K.Floor || props.occ[c] !== 0 || (v.reach[c] as number) < 0 || (v.env.doorDist[c] as number) < 3) return false;
      const s = (sideOf(v, c) - sideOf(v, end)) * sign;
      if (s < 1.5 || s > 3.5 || Math.abs(depthOf(v, c) - best.t0) > 0.7) return false;
      return slots.every((o) => cheb(w, o, c) >= 2) && props.can(c % w, (c / w) | 0, true);
    });
    if (spots.length === 0) continue;
    const c = rng.pick(spots);
    addProp(v.env, log, rng.pick(COVER_PROPS[v.env.theme]), c % w, (c / w) | 0, rng.int(0, 3), true);
  }
  if (!log.empty && !stillConnected(v, log.props)) undoEdit(v.env, log);
  return [...fronts.map((i) => ({ i, post: 'front' as const })), ...backs.map((i) => ({ i, post: 'back' as const }))];
};

const snipers: Builder = ({ v, rng, want, log }) => {
  const { g } = v.env;
  const w = g.w;
  let highs = highCells(v);
  if (highs.length === 0) {
    // No ledge here: raise a dais at the far end, where the room's far wall gives the snipers their back.
    if (v.maxDepth < 5 || v.cells.length < 24) return null;
    const eRef = Math.max(g.elev[v.mainT] as number, g.elev[v.mainD] as number);
    const cells = raiseDais(v, rng, log, v.maxDepth * 0.5, 2, eRef) ?? raiseDais(v, rng, log, v.maxDepth * 0.45, 1, eRef);
    if (!cells) return null;
    highs = cells.filter((c) => slotOk(v, c, 3) && v.visMain[c] === 1);
  }
  const nHigh = Math.max(1, Math.min(3, Math.round(want * 0.55)));
  const hs = pickSpaced(w, highs, nHigh, [], (c) => depthOf(v, c) * 0.3 + rng.next() * 2 + (v.env.edge[c] as number) * 0.1 + (g.elev[c] as number) * 1.5);
  if (hs.length === 0) {
    undoEdit(v.env, log);
    return null;
  }
  // Guards stand on the way up: walk back from the nearest ledge cell toward the doorway.
  const lead = hs.reduce((a, c) => ((v.reach[c] as number) < (v.reach[a] as number) ? c : a), hs[0] as number);
  const eHigh = g.elev[lead] as number;
  const route: number[] = [];
  for (let c = v.parent[lead] as number; c >= 0 && route.length < 12; c = v.parent[c] as number) route.push(c);
  let gcands = route.filter((c, k) => k < 7 && slotOk(v, c, 2) && !isNear(v.env, c) && ((g.elev[c] as number) < eHigh || k >= 1));
  if (gcands.length === 0) {
    gcands = v.cells.filter((c) => cheb(w, c, lead) <= 3 && slotOk(v, c, 2) && !isNear(v.env, c));
  }
  const need = Math.max(1, want - hs.length);
  const guards = pickSpaced(w, gcands, need, hs, (c) => -cheb(w, c, lead) + rng.next() + ((v.env.doorDist[c] as number) >= 3 ? 2 : 0));
  if (guards.length === 0 || hs.length + guards.length < 3) {
    // Pad with flankers on the lower ground if the access is too cramped.
    const extra = pickSpaced(w, pool(v, 3).filter((c) => !highs.includes(c)), 3 - hs.length - guards.length, [...hs, ...guards], (c) => (v.visMain[c] ? 2 : 0) + rng.next());
    if (hs.length + guards.length + extra.length < 3) {
      undoEdit(v.env, log);
      return null;
    }
    return [...hs.map((i) => ({ i, post: 'high' as const })), ...guards.map((i) => ({ i, post: 'guard' as const })), ...extra.map((i) => ({ i, post: 'flank' as const }))];
  }
  return [...hs.map((i) => ({ i, post: 'high' as const })), ...guards.map((i) => ({ i, post: 'guard' as const }))];
};

/**
 * A straight run of `len` floor cells reaching out from the side wall (on `sign`'s side of the way in)
 * at about a third to two thirds of the way into the room, or null: the stub of a pier or buttress.
 */
function pierCells(v: RoomView, rng: Rng, sign: number, len: number): number[] | null {
  const { g, props } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  const horiz = Math.abs(v.dx) >= Math.abs(v.dy);
  // Unit vector pointing to the `sign` side, snapped to a grid axis so the pier is a straight wall.
  const lx = horiz ? 0 : v.dy > 0 ? -sign : sign;
  const ly = horiz ? (v.dx > 0 ? sign : -sign) : 0;
  const found: number[][] = [];
  for (const c of v.cells) {
    if ((v.reach[c] as number) < 0) continue;
    const d = depthOf(v, c);
    if (d < T * 0.3 || d > T * 0.72) continue;
    const x = c % w;
    const y = (c / w) | 0;
    if (g.walkable(x + lx, y + ly)) continue; // not against the wall
    const cells: number[] = [];
    let ok = true;
    for (let k = 0; k < len && ok; k++) {
      const cx = x - lx * k;
      const cy = y - ly * k;
      if (!g.inb(cx, cy)) {
        ok = false;
        break;
      }
      const j = cy * w + cx;
      if (g.room[j] !== v.id || g.kinds[j] !== K.Floor || props.occ[j] !== 0 || props.keepFree[j] || (v.env.doorDist[j] as number) < 2 || (v.reach[j] as number) < 0) ok = false;
      cells.push(j);
    }
    if (!ok) continue;
    // Leave room to walk past the tip: the next cell inward must be open floor.
    const tx = x - lx * len;
    const ty = y - ly * len;
    if (!g.walkable(tx, ty) || props.occ[ty * w + tx] === 2) continue;
    found.push(cells);
  }
  return found.length === 0 ? null : rng.pick(found);
}

const ambush: Builder = ({ v, rng, want, log }) => {
  const { g, props } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  if (T < 4) return null;
  const hiddenPool = (): number[] => {
    const deep = v.cells.filter((c) => slotOk(v, c, 3) && v.visAny[c] === 0 && depthOf(v, c) >= 2);
    return deep.length >= 2 ? deep : v.cells.filter((c) => slotOk(v, c, 2) && v.visAny[c] === 0 && depthOf(v, c) >= 2);
  };
  let hid = hiddenPool();
  const sides = (cs: number[]): [number, number] => [cs.filter((c) => sideOf(v, c) < 0).length, cs.filter((c) => sideOf(v, c) >= 0).length];
  if (hid.length < 2 || sides(hid)[0] === 0 || sides(hid)[1] === 0) {
    // Build a pier of masonry (a buttress, a rock fin) out from a side wall, leaving a pocket behind it
    // where nobody at the doorway can see: one on each side of the way in that lacks one.
    const lost: number[] = [];
    const order = rng.chance(0.5) ? [-1, 1] : [1, -1];
    for (const sign of order) {
      const [l, r] = sides(hid);
      if ((sign < 0 ? l : r) > 0) continue;
      for (const len of [3, 2]) {
        const pier = pierCells(v, rng, sign, len);
        if (!pier) {
          continue;
        }
        const sub = new EditLog();
        for (const c of pier) setCell(v.env, sub, c, K.Wall);
        finishEdit(v.env, sub);
        if (!stillConnected(v, [...lost, ...pier])) {
          undoEdit(v.env, sub);
          continue;
        }
        recomputeVis(v);
        const now = hiddenPool();
        if (sides(now)[sign < 0 ? 0 : 1] >= 1) {
          hid = now;
          lost.push(...pier);
          for (const e of sub.cells) log.cells.push(e);
          for (const c of pier) log.touch(w, c);
          break;
        }
        undoEdit(v.env, sub);
        recomputeVis(v);
      }
    }
    hid = hiddenPool();
  }
  const [l, r] = sides(hid);
  if (hid.length < 2) {
    undoEdit(v.env, log);
    return null;
  }
  const h = Math.min(want - 1, hid.length, 5);
  // Both sides of the way in: alternate between them.
  const left = hid.filter((c) => sideOf(v, c) < 0);
  const right = hid.filter((c) => sideOf(v, c) >= 0);
  const near = (c: number): number => -Math.abs(sideOf(v, c)) * 0.3 + rng.next() * 1.5 + (depthOf(v, c) > T * 0.3 ? 1 : 0);
  const chosen: number[] = [];
  const queue = [pickSpaced(w, left, 6, [], near), pickSpaced(w, right, 6, [], near)];
  if (l < r) queue.reverse();
  for (let k = 0; chosen.length < h && k < 12; k++) {
    const q = queue[k % 2] as number[];
    const next = q.find((c) => chosen.every((o) => cheb(w, o, c) >= 2));
    if (next !== undefined) {
      chosen.push(next);
      q.splice(q.indexOf(next), 1);
    }
  }
  if (chosen.length < 2) {
    undoEdit(v.env, log);
    return null;
  }
  const bait = pickSpaced(
    w,
    v.cells.filter((c) => slotOk(v, c, 3) && v.visMain[c] === 1 && depthOf(v, c) >= T * 0.3 && depthOf(v, c) <= T * 0.8 && !isNear(v.env, c)),
    1,
    chosen,
    (c) => -Math.abs(sideOf(v, c)) * 0.5 + rng.next() * 2,
  );
  if (bait.length === 0) {
    undoEdit(v.env, log);
    return null;
  }
  return [...chosen.map((i) => ({ i, post: 'hidden' as const })), { i: bait[0] as number, post: 'back' as const }];
};

/** A loose ring of slots two or three cells round `centre`, and a lookout near the way in. */
function ringAround(v: RoomView, rng: Rng, want: number, log: EditLog, centre: number, minDoor = 3): Pick[] | null {
  const w = v.env.g.w;
  const dc = depthOf(v, centre);
  const lookoutPool = v.cells.filter((c) => slotOk(v, c, 2) && (v.env.doorDist[c] as number) <= 5 && v.visMain[c] === 1 && !isNear(v.env, c) && cheb(w, c, centre) >= 3);
  const lookout = lookoutPool.sort((a, b) => ((v.env.doorDist[b] as number) >= 3 ? 1 : 0) - ((v.env.doorDist[a] as number) >= 3 ? 1 : 0) || depthOf(v, a) - depthOf(v, b) || a - b)[0];
  const ringPool = v.cells.filter((c) => slotOk(v, c, minDoor) && cheb(w, c, centre) >= 2 && cheb(w, c, centre) <= 3 && !isNear(v.env, c));
  const ring = pickFar(w, ringPool, lookout === undefined ? want : want - 1, lookout === undefined ? [] : [lookout], rng);
  const picks: Pick[] = ring.map((i) => ({ i, post: depthOf(v, i) <= dc ? ('front' as const) : ('flank' as const) }));
  if (picks.length > 0 && !picks.some((p) => p.post === 'front')) {
    const nearest = picks.reduce((a, p) => (depthOf(v, p.i) < depthOf(v, a.i) ? p : a), picks[0] as Pick);
    nearest.post = 'front';
  }
  if (lookout !== undefined) picks.push({ i: lookout, post: 'guard' });
  if (picks.length < 3) {
    undoEdit(v.env, log);
    return null;
  }
  return picks;
}


/** A pool or pit already in the room's body, nearest its middle, with open ground round it. */
function existingHazardCentre(v: RoomView): number | null {
  const { g } = v.env;
  const w = g.w;
  const b = v.info.bounds;
  let best: number | null = null;
  let bd = Infinity;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const c = y * w + x;
      const k = g.kinds[c];
      if ((k !== K.Water && k !== K.Chasm) || g.room[c] !== v.id) continue;
      const ring = v.cells.filter((o) => slotOk(v, o, 3) && cheb(w, o, c) >= 2 && cheb(w, o, c) <= 3).length;
      if (ring < 3) continue;
      const d = (x - v.info.center.x) ** 2 + (y - v.info.center.y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
  }
  return best;
}

const den: Builder = ({ v, rng, want, log }) => {
  const w = v.env.g.w;
  if (v.cells.length < 14) return null;
  let centre = existingHazardCentre(v);
  if (centre === null) {
    // Dig a pool or pit in the widest part of the chamber.
    const menu = HAZARD_MENU[v.env.theme];
    if (!menu.includes('pool') && !menu.includes('pit')) return null;
    const kind = menu.includes('pool') && (!menu.includes('pit') || rng.chance(0.5)) ? 'pool' : 'pit';
    const spots = v.cells.filter((c) => slotOk(v, c, 3) && (v.env.edge[c] as number) >= 1).sort((a, b) => (v.env.edge[b] as number) - (v.env.edge[a] as number) || a - b);
    for (const a of spots.slice(0, 6)) {
      const cells = stageBlob(v, rng, log, a, kind, new Set());
      if (cells) {
        centre = cells[0] as number;
        break;
      }
    }
    if (centre === null) return null;
  }
  const picks = ringAround(v, rng, want, log, centre, 3) ?? (CAVES.includes(v.env.theme) ? ringAround(v, rng, want, log, centre, 2) : null);
  if (!picks) undoEdit(v.env, log);
  void w;
  return picks;
};

const chokehold: Builder = ({ v, rng, want }) => {
  const w = v.env.g.w;
  const T = v.maxDepth;
  if (T < 4) return null;
  // The narrowest neck on the way in, with the chamber opening out behind it.
  let neck: number[] | null = null;
  let t0 = 0;
  for (let t = Math.ceil(T * 0.25); t <= Math.floor(T * 0.65); t++) {
    const band = v.cells.filter((c) => (v.reach[c] as number) >= 0 && Math.abs(depthOf(v, c) - t) <= 0.5);
    if (band.length < 2 || band.length > 6) continue;
    const behind = v.cells.filter((c) => slotOk(v, c, 2) && depthOf(v, c) >= t + 1.5 && depthOf(v, c) <= t + 5.5).length;
    if (behind < 3) continue;
    if (neck === null || band.length < neck.length || (band.length === neck.length && rng.chance(0.4))) {
      neck = band;
      t0 = t;
    }
  }
  if (neck === null) return null;
  const deepNeck = neck.filter((c) => slotOk(v, c, 3) && !isNear(v.env, c));
  const guards = pickSpaced(w, deepNeck.length > 0 || v.env.theme !== 'lair' ? deepNeck : neck.filter((c) => slotOk(v, c, 2) && !isNear(v.env, c)), 2, [], () => rng.next());
  if (guards.length === 0) return null;
  const backs = pickSpaced(
    w,
    v.cells.filter((c) => slotOk(v, c, 2) && depthOf(v, c) >= t0 + 1.5 && depthOf(v, c) <= t0 + 5.5 && !isNear(v.env, c)),
    want - guards.length,
    guards,
    (c) => (v.visMain[c] ? 2 : 0) + rng.next() * 2,
  );
  if (guards.length + backs.length < 3) return null;
  return [...guards.map((i) => ({ i, post: 'guard' as const })), ...backs.map((i) => ({ i, post: 'back' as const }))];
};

const camp: Builder = ({ v, rng, want, log }) => {
  const { g, props } = v.env;
  const w = g.w;
  if (v.cells.length < 22) return null;
  let centre = existingCentre(v);
  if (centre === null) {
    const spots = v.cells.filter((c) => slotOk(v, c, 2) && (v.env.edge[c] as number) >= 2 && props.can(c % w, (c / w) | 0, true));
    if (spots.length === 0) return null;
    const mx = v.info.center.x;
    const my = v.info.center.y;
    spots.sort((a, b) => ((a % w) - mx) ** 2 + (((a / w) | 0) - my) ** 2 - (((b % w) - mx) ** 2 + (((b / w) | 0) - my) ** 2) || a - b);
    const c = spots[Math.min(spots.length - 1, rng.int(0, 2))] as number;
    if (!addProp(v.env, log, rng.pick(CENTRE_PROPS[v.env.theme]), c % w, (c / w) | 0, rng.int(0, 3), true)) return null;
    centre = c;
  }
  return ringAround(v, rng, want, log, centre);
};

const gauntlet: Builder = ({ v, rng, want, log }) => {
  const { g, props } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  if (T < 6) return null;
  // Natural chokes first: one per stretch of the way in.
  const chokes = chokeCells(v).sort((a, b) => depthOf(v, a) - depthOf(v, b) || a - b);
  const gates: number[] = [];
  for (const c of chokes) {
    const d = depthOf(v, c);
    if (d < T * 0.2 || d > T * 0.82) continue;
    if (gates.every((o) => Math.abs(depthOf(v, o) - d) >= 3)) gates.push(c);
  }
  if (gates.length < 2) {
    if (T < 8 || lateralWidth(v) > 9) return null;
    // Stage two gates: a screen of cover across the room with a two-cell gap in the middle.
    const palette = COVER_PROPS[v.env.theme];
    const made: number[] = [];
    for (const f of [0.36, 0.66]) {
      const t0 = Math.round(T * f);
      const row = v.cells
        .filter((c) => g.kinds[c] === K.Floor && Math.abs(depthOf(v, c) - t0) <= 0.5 && (v.reach[c] as number) >= 0)
        .sort((a, b) => sideOf(v, a) - sideOf(v, b) || a - b);
      if (row.length < 5 || row.length > 10) continue;
      const mid = Math.floor((row.length - 1) / 2);
      const type = rng.pick(palette);
      let okRow = true;
      for (let k = 0; k < row.length; k++) {
        if (k === mid || k === mid + 1) continue;
        const c = row[k] as number;
        if (props.occ[c] === 2) continue;
        if (!addProp(v.env, log, type, c % w, (c / w) | 0, 1, true)) okRow = false;
      }
      if (!okRow) continue;
      made.push((row[mid] as number) + 0);
    }
    if (made.length < 2 || !stillConnected(v, log.props)) {
      undoEdit(v.env, log);
      return null;
    }
    gates.length = 0;
    gates.push(...made);
  }
  const wanted = Math.max(2, Math.min(3, want - 1));
  const guards: number[] = [];
  for (const gate of gates.slice(0, wanted)) {
    // Just behind the gap, on the far side.
    const cs = v.cells.filter((c) => slotOk(v, c, 2) && cheb(w, c, gate) <= 2 && depthOf(v, c) >= depthOf(v, gate) - 0.1 && !isNear(v.env, c));
    const best = pickSpaced(w, cs, 1, guards, (c) => -cheb(w, c, gate) + rng.next() * 0.5 + (v.visMain[c] ? 0.8 : 0));
    if (best.length) guards.push(best[0] as number);
  }
  const backs = pickSpaced(
    w,
    v.cells.filter((c) => slotOk(v, c, 3) && depthOf(v, c) >= T * 0.72),
    want - guards.length,
    guards,
    (c) => depthOf(v, c) * 0.2 + rng.next() * 2,
  );
  if (guards.length < 2 || guards.length + backs.length < 3) {
    undoEdit(v.env, log);
    return null;
  }
  return [...guards.map((i) => ({ i, post: 'guard' as const })), ...backs.map((i) => ({ i, post: 'back' as const }))];
};

const pincer: Builder = ({ v, rng, want }) => {
  const w = v.env.g.w;
  const T = v.maxDepth;
  if (T < 5 || lateralWidth(v) < 5) return null;
  const band = v.cells.filter((c) => slotOk(v, c, 3) && depthOf(v, c) >= T * 0.35 && depthOf(v, c) <= T * 0.92 && !isNear(v.env, c));
  if (band.length < 4) return null;
  // Sides are measured from the middle of the room across the approach, not from the doorway line.
  let lo = 99;
  let hi = -99;
  for (const c of band) {
    lo = Math.min(lo, sideOf(v, c));
    hi = Math.max(hi, sideOf(v, c));
  }
  const mid = (lo + hi) / 2;
  const left = band.filter((c) => sideOf(v, c) - mid <= -1.5);
  const right = band.filter((c) => sideOf(v, c) - mid >= 1.5);
  if (left.length === 0 || right.length === 0) return null;
  const score = (c: number): number => (v.visMain[c] ? 3 : 0) + Math.abs(sideOf(v, c) - mid) * 0.3 - Math.abs(depthOf(v, c) - T * 0.62) * 0.3 + rng.next() * 1.5;
  const kBig = Math.ceil(want / 2);
  const kSmall = want - kBig;
  const bigLeft = rng.chance(0.5);
  const a = pickSpaced(w, bigLeft ? left : right, kBig, [], score);
  const b = pickSpaced(w, bigLeft ? right : left, kSmall, a, score);
  if (a.length === 0 || b.length === 0 || a.length + b.length < 3) return null;
  return [...a, ...b].map((i) => ({ i, post: 'flank' as const }));
};

const throne: Builder = ({ v, rng, want }) => {
  const { g, exit } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  const ex = exit.y * w + exit.x;
  const bossPool = v.cells.filter((c) => slotOk(v, c, 3) && depthOf(v, c) >= T * 0.5 && cheb(w, c, ex) >= 2 && v.visMain[c] === 1);
  if (bossPool.length === 0) return null;
  const eMax = Math.max(...bossPool.map((c) => g.elev[c] as number));
  const bossAt = pickSpaced(w, bossPool, 1, [], (c) => ((g.elev[c] as number) === eMax ? 4 : 0) + depthOf(v, c) * 0.5 + (v.env.edge[c] as number) * 0.4 + rng.next())[0];
  if (bossAt === undefined) return null;
  const nEsc = Math.max(1, Math.ceil(want / 2));
  const esc = pickSpaced(
    w,
    v.cells.filter((c) => slotOk(v, c, 2) && cheb(w, c, bossAt) >= 2 && cheb(w, c, bossAt) <= 3),
    nEsc,
    [bossAt],
    (c) => (cheb(w, c, bossAt) === 2 ? 2 : 0) + (v.visMain[c] ? 1 : 0) + rng.next(),
  );
  const fronts = pickSpaced(
    w,
    v.cells.filter((c) => slotOk(v, c, 3) && depthOf(v, c) >= T * 0.2 && depthOf(v, c) <= depthOf(v, bossAt) - 2 && Math.abs(sideOf(v, c)) <= 3.5 && v.visMain[c] === 1 && !isNear(v.env, c)),
    want - esc.length,
    [bossAt, ...esc],
    (c) => -Math.abs(sideOf(v, c)) * 0.4 - Math.abs(depthOf(v, c) - T * 0.4) * 0.3 + rng.next(),
  );
  if (esc.length + fronts.length < 2) return null;
  const picks: Pick[] = [{ i: bossAt, post: 'back', boss: true }];
  for (const i of esc) picks.push({ i, post: 'escort' });
  fronts.forEach((i, k) => picks.push({ i, post: k === 1 ? 'guard' : 'front' }));
  return picks;
};

const lair: Builder = ({ v, rng, want }) => {
  const { g, exit } = v.env;
  const w = g.w;
  const T = v.maxDepth;
  const ex = exit.y * w + exit.x;
  const mid = v.cells.filter((c) => slotOk(v, c, 3) && cheb(w, c, ex) >= 2);
  if (mid.length < 6) return null;
  const bossAt = pickSpaced(w, mid, 1, [], (c) => (v.env.edge[c] as number) * 1.2 - Math.abs(depthOf(v, c) - T * 0.5) * 0.4 + rng.next())[0];
  if (bossAt === undefined) return null;
  const rimAt = (door: number): number[] => v.cells.filter((c) => slotOk(v, c, door) && (v.env.edge[c] as number) <= 2 && cheb(w, c, bossAt) >= 3);
  const rim = rimAt(3).length >= want ? rimAt(3) : rimAt(2);
  const picks = pickSpaced(w, rim, want, [bossAt], (c) => (v.visAny[c] === 0 ? 3 : 0) + (isNear(v.env, c) ? -4 : 0) + rng.next() * 2);
  if (picks.length < 2) return null;
  return [{ i: bossAt, post: 'back', boss: true }, ...picks.map((i) => ({ i, post: (v.visAny[i] === 0 ? 'hidden' : 'flank') as SpawnPost }))];
};

// ---------------------------------------------------------------------------
// The fallback: farthest-point placement away from the doorways.

export function spread(rng: Rng, cand: number[], k: number, w: number, avoid: number[]): number[] {
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

const scattered: Builder = ({ v, rng, want }) => {
  const { g, props, doorDist, entrance, exit } = v.env;
  const w = g.w;
  const ei = entrance.y * w + entrance.x;
  const xi = exit.y * w + exit.x;
  const usable = (i: number): boolean => i !== ei && i !== xi && props.occ[i] !== 2 && !props.keepFree[i];
  const room = v.info;
  const floorCells = room.cells.filter((i) => g.kinds[i] === K.Floor && usable(i));
  const all = floorCells.concat(room.cells.filter((i) => g.kinds[i] === K.Water && usable(i)));
  const boss = room.role === 'boss';
  const post = (i: number, med: number): SpawnPost => ((doorDist[i] as number) <= med ? 'front' : 'flank');
  const poolFor = (need: number): number[] => {
    for (const src of [floorCells, all]) {
      for (let minD = 3; minD >= 0; minD--) {
        const c = src.filter((i) => (doorDist[i] as number) >= minD);
        if (c.length >= need * 2 || (minD === 0 && c.length >= need)) return c;
      }
    }
    return all;
  };
  let picks: number[] = [];
  let bossAt = -1;
  if (boss) {
    const cand = poolFor(4);
    let bd = Infinity;
    for (const i of cand) {
      const d = ((i % w) - room.center.x) ** 2 + (((i / w) | 0) - room.center.y) ** 2;
      if (d < bd) {
        bd = d;
        bossAt = i;
      }
    }
    if (bossAt < 0) throw new GenFail('no boss slot');
    picks = spread(rng, cand, want, w, [bossAt]);
    if (picks.length < 2) throw new GenFail('boss room has too few slots');
  } else {
    search: for (const minD of [3, 2, 1, 0]) {
      for (const src of floorCells.length >= 2 * want ? [floorCells, all] : [all]) {
        const cand = src.filter((i) => (doorDist[i] as number) >= minD);
        const got = spread(rng, cand, want, w, []);
        if (got.length > picks.length) picks = got;
        if (picks.length >= Math.min(want, 4)) break search;
      }
    }
    if (picks.length < 3) throw new GenFail(`combat room ${room.id} has too few slots`);
  }
  const ds = picks.map((i) => doorDist[i] as number).sort((a, b) => a - b);
  const med = ds[Math.floor((ds.length - 1) / 2)] as number;
  const out: Pick[] = picks.map((i) => ({ i, post: post(i, med) }));
  if (boss) out.unshift({ i: bossAt, post: 'back', boss: true });
  return out;
};

// ---------------------------------------------------------------------------
// Choosing

const CAVES: ThemeId[] = ['warrens', 'fungal', 'ice', 'lair', 'forest', 'marsh'];

const BASE_WEIGHTS: Record<ThemeId, Partial<Record<FormationName, number>>> = {
  warrens: { shieldWall: 1.2, snipers: 0.8, ambush: 1.4, camp: 1.6, gauntlet: 0.5, pincer: 1.0 },
  crypt: { shieldWall: 1.4, snipers: 0.8, ambush: 1.6, camp: 0.6, gauntlet: 1.2, pincer: 1.0 },
  depths: { shieldWall: 1.2, snipers: 1.8, ambush: 0.5, camp: 0.5, gauntlet: 1.0, pincer: 1.0 },
  sewers: { shieldWall: 1.0, snipers: 0.6, ambush: 1.4, camp: 0.8, gauntlet: 1.4, pincer: 1.2 },
  fungal: { shieldWall: 0.8, snipers: 0.7, ambush: 1.8, camp: 1.0, gauntlet: 0.5, pincer: 1.2 },
  hold: { shieldWall: 1.8, snipers: 1.0, ambush: 0.8, camp: 1.5, gauntlet: 1.0, pincer: 1.0 },
  library: { shieldWall: 1.0, snipers: 1.0, ambush: 1.8, camp: 0.8, gauntlet: 1.4, pincer: 1.0 },
  foundry: { shieldWall: 1.2, snipers: 1.6, ambush: 0.5, camp: 1.0, gauntlet: 1.2, pincer: 0.8 },
  ice: { shieldWall: 0.8, snipers: 1.0, ambush: 1.4, camp: 0.8, gauntlet: 0.6, pincer: 1.2 },
  ruin: { shieldWall: 1.0, snipers: 1.2, ambush: 1.6, camp: 1.0, gauntlet: 0.8, pincer: 1.0 },
  hell: { shieldWall: 1.5, snipers: 1.4, ambush: 0.8, camp: 0.8, gauntlet: 1.0, pincer: 1.0 },
  lair: { shieldWall: 0.5, snipers: 0.8, ambush: 1.0, camp: 1.0, gauntlet: 0.5, pincer: 1.5 },
  forest: { shieldWall: 0.8, snipers: 0.8, ambush: 1.8, camp: 1.3, gauntlet: 0.6, pincer: 1.3 },
  marsh: { shieldWall: 0.6, snipers: 0.6, ambush: 1.8, camp: 1.0, gauntlet: 0.6, pincer: 1.3 },
  peaks: { shieldWall: 1.0, snipers: 1.8, ambush: 0.6, camp: 0.8, gauntlet: 1.0, pincer: 1.0 },
};

/** How much a boss of this theme keeps a retinue (throne) rather than ruling a patch of ground alone (lair). */
const THRONE_SHARE: Record<ThemeId, number> = {
  warrens: 0.7,
  crypt: 0.8,
  depths: 0.5,
  sewers: 0.3,
  fungal: 0.3,
  hold: 0.9,
  library: 0.8,
  foundry: 0.6,
  ice: 0.3,
  ruin: 0.5,
  hell: 0.8,
  lair: 0.1,
  forest: 0.3,
  marsh: 0.3,
  peaks: 0.4,
};

const BUILDERS: Record<Exclude<FormationName, 'throne' | 'lair' | 'scattered'>, Builder> = {
  den,
  chokehold,
  shieldWall,
  snipers,
  ambush,
  camp,
  gauntlet,
  pincer,
};

export interface FormationResult {
  name: FormationName;
  picks: Pick[];
}

/** The picks are legal: reachable, distinct, never adjacent, the right number. */
function legal(v: RoomView, picks: Pick[], min: number, max: number, boss: boolean, lenient: boolean): boolean {
  const w = v.env.g.w;
  const monsters = picks.filter((p) => !p.boss).length;
  if (monsters < min || monsters > max || picks.filter((p) => p.boss).length !== (boss ? 1 : 0)) return false;
  for (let a = 0; a < picks.length; a++) {
    const pa = picks[a] as Pick;
    if (!lenient && !slotOk(v, pa.i, 0)) return false;
    for (let b = a + 1; b < picks.length; b++) if (cheb(w, pa.i, (picks[b] as Pick).i) < 2) return false;
  }
  return true;
}

/**
 * Choose and build a formation for a combat or boss room. `used` counts formations already used
 * on the floor (a repeat is less likely, so a floor does not field one pattern throughout).
 */
export function buildFormation(v: RoomView, rng: Rng, used: Map<string, number>, boss: boolean, want: number): FormationResult {
  const theme = v.env.theme;
  const min = boss ? 2 : 3;
  const max = boss ? 4 : 6;
  const attempt = (name: FormationName, builder: Builder, lenient = false): FormationResult | null => {
    const log = new EditLog();
    const picks = builder({ v, rng, want, log });
    if (!picks) return null;
    if (!legal(v, picks, min, max, boss, lenient)) {
      undoEdit(v.env, log);
      return null;
    }
    return { name, picks };
  };
  const repeat = (n: FormationName): number => Math.pow(0.35, used.get(n) ?? 0);
  let order: Array<[FormationName, Builder, number]> = [];
  if (boss) {
    const t = THRONE_SHARE[theme];
    order = [
      ['throne', throne, (0.15 + t) * repeat('throne')],
      ['lair', lair, (0.15 + (1 - t)) * repeat('lair')],
    ];
  } else {
    const hi = highCells(v).length;
    const hidden = v.cells.filter((c) => slotOk(v, c, 2) && v.visAny[c] === 0 && depthOf(v, c) >= 2).length;
    const T = v.maxDepth;
    const chokes = chokeCells(v).length;
    const bw = BASE_WEIGHTS[theme];
    const mult: Record<keyof typeof BUILDERS, number> = {
      shieldWall: 1,
      snipers: hi >= 2 ? 2.4 : hi === 1 ? 1.2 : 0.3,
      ambush: hidden >= 3 ? 2.2 : hidden >= 2 ? 1.4 : 0.5,
      camp: existingCentre(v) !== null ? 2 : 0.55,
      gauntlet: T >= 9 && (chokes >= 2 || lateralWidth(v) <= 7) ? 1.8 : T >= 7 && chokes >= 2 ? 1.2 : 0.2,
      pincer: lateralWidth(v) >= 7 ? 1 : lateralWidth(v) >= 6 ? 0.6 : 0.3,
      den: v.cells.length >= 30 ? 1.3 : 0.8,
      chokehold: 1.2,
    };
    for (const name of Object.keys(BUILDERS) as Array<keyof typeof BUILDERS>) {
      const cave = name === 'den' || name === 'chokehold' ? (CAVES.includes(theme) ? 3 : name === 'den' ? 0.3 : 0) : 1;
      order.push([name, BUILDERS[name], (bw[name] ?? 1) * mult[name] * repeat(name) * cave]);
    }
  }
  // Weighted order without replacement; a draw that cannot be built falls through to the next.
  const left = order.slice();
  while (left.length > 0) {
    let total = 0;
    for (const o of left) total += o[2];
    let roll = rng.next() * total;
    let k = 0;
    for (; k < left.length - 1; k++) {
      roll -= (left[k] as (typeof left)[number])[2];
      if (roll < 0) break;
    }
    const [name, builder] = left.splice(k, 1)[0] as (typeof left)[number];
    const got = attempt(name, builder);
    if (got) return got;
  }
  const fb = attempt('scattered', scattered, true);
  if (fb) return fb;
  // The fallback must not fail legality except for its own thresholds; if the room is truly tight, take it as it is.
  const log = new EditLog();
  const picks = scattered({ v, rng, want, log });
  if (!picks) throw new GenFail('no formation fits room');
  return { name: 'scattered', picks };
}

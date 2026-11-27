import type { Rng } from '../core/rng';
import type { ThemeId } from '../core/types';
import { hasFeature, pushMap, roomFeatures, type RoomFeatures } from './features';
import { K, NEI8 } from './grid';
import { PROP_OBSTACLE } from './obstacles';
import { refreshWalls } from './walls';
import { lineOfSight } from './sight';
import { cheb, depthOf, refreshReach, sideOf, slotOk, stillConnected, type RoomView, type StageEnv, buildView } from './roomview';

/**
 * Terrain staging: the edits the terrain pass and the formations make to a room (props, pits,
 * daises, wall stubs), with an undo log so a formation that does not work out leaves no trace.
 */
export class EditLog {
  props: number[] = [];
  cells: Array<{ i: number; kind: number; elev: number }> = [];
  private x0 = 9999;
  private y0 = 9999;
  private x1 = -1;
  private y1 = -1;

  touch(w: number, i: number): void {
    const x = i % w;
    const y = (i / w) | 0;
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x);
    this.y1 = Math.max(this.y1, y);
  }

  get empty(): boolean {
    return this.props.length === 0 && this.cells.length === 0;
  }

  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    return this.x1 < 0 ? null : { x0: this.x0 - 1, y0: this.y0 - 1, x1: this.x1 + 1, y1: this.y1 + 1 };
  }
}

/** Blocking props that are fine as cover in each theme (all allowed by validateFloor for the theme). */
export const COVER_PROPS: Record<ThemeId, string[]> = {
  warrens: ['stalagmite', 'crate', 'barrel'],
  crypt: ['pillar', 'statue', 'urn'],
  depths: ['broken_pillar', 'crystal', 'pillar'],
  sewers: ['pillar', 'crate', 'barrel'],
  fungal: ['giant_mushroom', 'stalagmite'],
  hold: ['crate', 'barrel', 'palisade'],
  library: ['bookshelf', 'desk', 'statue'],
  foundry: ['anvil', 'ingots', 'broken_pillar', 'crate'],
  ice: ['ice_spike', 'ice_spike', 'crystal'],
  ruin: ['fallen_column', 'broken_pillar', 'statue'],
  hell: ['statue', 'broken_pillar', 'iron_bars'],
  lair: ['dragon_bones', 'stalagmite'],
  forest: ['gnarled_tree', 'log', 'standing_stone'],
  marsh: ['gnarled_tree', 'log'],
  peaks: ['boulder', 'standing_stone'],
};

/** What a camp or vigil gathers round, per theme (blocking props that also give light or work). */
export const CENTRE_PROPS: Record<ThemeId, string[]> = {
  warrens: ['campfire'],
  crypt: ['brazier'],
  depths: ['crystal'],
  sewers: ['brazier'],
  fungal: ['giant_mushroom'],
  hold: ['campfire', 'brazier'],
  library: ['candelabra', 'desk'],
  foundry: ['forge', 'crucible'],
  ice: ['campfire'],
  ruin: ['campfire', 'brazier'],
  hell: ['brazier'],
  lair: ['gold_pile'],
  forest: ['campfire'],
  marsh: ['campfire'],
  peaks: ['campfire'],
};

export function addProp(env: StageEnv, log: EditLog, type: string, x: number, y: number, rot: number, blocking: boolean): boolean {
  if (!env.props.place(type, x, y, rot, blocking)) return false;
  log.props.push(y * env.g.w + x);
  return true;
}

export function setCell(env: StageEnv, log: EditLog, i: number, kind: number, elev?: number): void {
  log.cells.push({ i, kind: env.g.kinds[i] as number, elev: env.g.elev[i] as number });
  env.g.kinds[i] = kind;
  if (elev !== undefined) env.g.elev[i] = elev;
  log.touch(env.g.w, i);
}

/** Re-derive wall elevations round edited cells. */
export function finishEdit(env: StageEnv, log: EditLog): void {
  const b = log.bounds();
  if (b) refreshWalls(env.g, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1);
}

export function undoEdit(env: StageEnv, log: EditLog): void {
  const { g, props } = env;
  for (let k = log.cells.length - 1; k >= 0; k--) {
    const c = log.cells[k] as EditLog['cells'][number];
    g.kinds[c.i] = c.kind;
    g.elev[c.i] = c.elev;
  }
  for (const i of log.props) {
    const idx = props.list.findIndex((p) => p.pos.y * g.w + p.pos.x === i);
    if (idx >= 0) props.list.splice(idx, 1);
    props.occ[i] = 0;
  }
  finishEdit(env, log);
  log.props = [];
  log.cells = [];
}

// ---------------------------------------------------------------------------
// Terrain pass: make sure the room has something to play with.

/** Cover on the way in: an open blocking prop near the line from the doorway to the room's middle. */
function hasApproachCover(v: RoomView): boolean {
  const { g, props, edge } = v.env;
  const T = v.maxDepth;
  for (const p of props.list) {
    if (!p.blocking) continue;
    const c = p.pos.y * g.w + p.pos.x;
    if (g.room[c] !== v.id || (edge[c] as number) < 2) continue;
    const d = depthOf(v, c);
    if (d >= 2 && d <= T - 1 && Math.abs(sideOf(v, c)) <= 2.6) return true;
  }
  return false;
}

/** Place `count` cover props along the approach, alternating sides, never beside another blocking prop. Returns how many stood. */
export function placeApproachCover(v: RoomView, rng: Rng, log: EditLog, count: number): number {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  const T = v.maxDepth;
  const palette = COVER_PROPS[env.theme];
  let placed = 0;
  const lone = (c: number): boolean => {
    const x = c % w;
    const y = (c / w) | 0;
    for (const [ox, oy] of NEI8) if (props.occ[(y + oy) * w + x + ox] === 2) return false;
    return true;
  };
  const fractions = [0.4, 0.62, 0.28, 0.75];
  let sign = rng.chance(0.5) ? 1 : -1;
  for (let k = 0; k < fractions.length && placed < count; k++) {
    const t0 = T * (fractions[k] as number);
    const pool: number[] = [];
    for (const c of v.cells) {
      if (g.kinds[c] !== K.Floor || (v.reach[c] as number) < 0) continue;
      if ((env.edge[c] as number) < 2 || (env.doorDist[c] as number) < 3) continue;
      const d = depthOf(v, c);
      const s = sideOf(v, c) * sign;
      if (Math.abs(d - t0) > 1.1 || s < 1 || s > 3) continue;
      if (!props.can(c % w, (c / w) | 0, true) || !lone(c) || c === env.exit.y * w + env.exit.x) continue;
      pool.push(c);
    }
    sign = -sign;
    if (pool.length === 0) continue;
    const c = rng.pick(pool);
    if (addProp(env, log, rng.pick(palette), c % w, (c / w) | 0, rng.int(0, 3), true)) placed++;
  }
  return placed;
}

/** Carve a pit (lava or a drop, as the theme draws its chasm) beside the line of approach. */
export function carvePit(v: RoomView, rng: Rng, log: EditLog): boolean {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  const T = v.maxDepth;
  if (v.cells.length < 24 || T < 5) return false;
  const shapes: Array<Array<[number, number]>> = [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [1, 0]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [1, 0], [0, 1]],
    [[0, 0], [0, 1], [0, 2]],
  ];
  const base = v.cells.filter((c) => (v.reach[c] as number) >= 0 && g.kinds[c] === K.Floor && (env.doorDist[c] as number) >= 3 && props.occ[c] !== 2 && !props.keepFree[c]);
  if (base.length === 0) return false;
  // Prefer the flanks of the way in, but any open ground will do if those are taken.
  const keys = new Map<number, number>();
  for (const c of base) keys.set(c, Math.abs(Math.abs(sideOf(v, c)) - 2.5) + rng.next() * 2);
  const anchors = base.slice().sort((a, b) => (keys.get(a) as number) - (keys.get(b) as number) || a - b);
  const exitCell = env.exit.y * w + env.exit.x;
  const entCell = env.entrance.y * w + env.entrance.x;
  const middle = v.info.center.y * w + v.info.center.x;
  for (let attempt = 0; attempt < Math.min(70, anchors.length); attempt++) {
    const a = anchors[attempt] as number;
    for (const shape of rng.shuffle(shapes.slice())) {
      const cells = shape.map(([ox, oy]) => (((a / w) | 0) + oy) * w + (a % w) + ox);
      const ok = cells.every((c) => {
        if (!g.inb(c % w, (c / w) | 0) || g.room[c] !== v.id || g.kinds[c] !== K.Floor || props.occ[c] === 2 || props.keepFree[c]) return false;
        return (env.doorDist[c] as number) >= 3 && c !== entCell && c !== exitCell && c !== middle;
      });
      if (!ok) continue;
      // Not beside another pit (keeps the edge readable).
      const set = new Set(cells);
      let clean = true;
      for (const c of cells) {
        for (const [ox, oy] of NEI8) {
          const j = c + oy * w + ox;
          if (set.has(j)) continue;
          if (g.kinds[j] === K.Chasm) clean = false;
        }
      }
      if (!clean) continue;
      const sub = new EditLog();
      for (const c of cells) setCell(env, sub, c, K.Chasm, 0);
      if (!stillConnected(v, cells)) {
        undoEdit(env, sub);
        continue;
      }
      finishEdit(env, sub);
      // Debris on the floor that fell in goes with it.
      for (const c of cells) {
        if (props.occ[c] !== 1) continue;
        const k = props.list.findIndex((p) => p.pos.y * w + p.pos.x === c);
        if (k >= 0) props.list.splice(k, 1);
        props.occ[c] = 0;
      }
      return true;
    }
  }
  return false;
}

/** Raise a flat 5x5 (stepped, two levels) or 3x3 (one step) patch: a dais the hero has to climb to. Returns the raised cells, or null. */
export function raiseDais(v: RoomView, rng: Rng, log: EditLog, minDepth: number, radius: number, minElev = -99): number[] | null {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  const flatAt = (c: number): number => g.elev[c] as number;
  const cands = v.cells.filter((c) => depthOf(v, c) >= minDepth && (v.reach[c] as number) >= 0);
  const scored: Array<{ c: number; score: number }> = [];
  for (const c of cands) {
    const x = c % w;
    const y = (c / w) | 0;
    const e = flatAt(c);
    if (e < minElev) continue;
    let good = true;
    let free = 0;
    for (let oy = -radius - 1; oy <= radius + 1 && good; oy++) {
      for (let ox = -radius - 1; ox <= radius + 1; ox++) {
        if (!g.inb(x + ox, y + oy)) {
          good = false;
          break;
        }
        const j = (y + oy) * w + x + ox;
        const k = g.kinds[j] as number;
        const inner = Math.abs(ox) <= radius && Math.abs(oy) <= radius;
        if (inner) {
          if (g.room[j] !== v.id || k !== K.Floor || flatAt(j) !== e || (env.doorDist[j] as number) < 3 || props.keepFree[j]) {
            good = false;
            break;
          }
          if (props.occ[j] === 0) free++;
          if (j === env.exit.y * w + env.exit.x || j === env.entrance.y * w + env.entrance.x) {
            good = false;
            break;
          }
        } else if ((k === K.Floor || k === K.Water || k === K.Door) && (flatAt(j) < e || flatAt(j) > e + 2)) {
          good = false;
          break;
        }
      }
    }
    if (good) scored.push({ c, score: free + depthOf(v, c) * 0.5 + rng.next() * 3 });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const c = (scored[0] as { c: number }).c;
  const x = c % w;
  const y = (c / w) | 0;
  const e = flatAt(c);
  const cells: number[] = [];
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) cells.push((y + oy) * w + x + ox);
  }
  // A wide dais is two steps: a rim one step up and a crown two steps up (a ranged attacker two steps above its target shoots at +1).
  for (const j of cells) {
    const ox = Math.abs((j % w) - x);
    const oy = Math.abs(((j / w) | 0) - y);
    setCell(env, log, j, K.Floor, radius >= 2 && Math.max(ox, oy) < radius ? e + 2 : e + 1);
  }
  finishEdit(env, log);
  return cells;
}

export interface TerrainReport {
  mutated: boolean;
}

const LAVA_THEMES: ThemeId[] = ['hell', 'lair'];

/**
 * Give a room something to play with where the theme's own recipe left it bare: cover along the
 * approach, a lava pit in the themes that burn, a dais when nothing else is there. Returns true
 * if anything changed (the view must then be rebuilt).
 */
export function enrichRoom(v: RoomView, rng: Rng, hasOther: RoomFeatures): boolean {
  let mutated = false;
  const env = v.env;
  if (v.maxDepth >= 4 && !hasApproachCover(v) && rng.chance(0.9)) {
    if (placeApproachCover(v, rng, new EditLog(), v.maxDepth >= 8 || v.cells.length >= 40 ? 2 : 1) > 0) {
      mutated = true;
      refreshReach(v);
    }
  }
  if (LAVA_THEMES.includes(env.theme) && !hasOther.drop && rng.chance(0.9)) {
    if (carvePit(v, rng, new EditLog())) {
      mutated = true;
      refreshReach(v);
    }
  }
  if (!mutated && hasFeature(hasOther)) return false;
  // Still nothing to play with? A dais, then (as a last resort) a collapsed patch of floor.
  if (!hasFeature(roomFeatures(env.plan, v.id, v.info.cells))) {
    if (raiseDais(v, rng, new EditLog(), v.maxDepth * 0.4, 2) || raiseDais(v, rng, new EditLog(), v.maxDepth * 0.3, 1) || carvePit(v, rng, new EditLog())) mutated = true;
  }
  return mutated;
}



// ---------------------------------------------------------------------------
// Hazards to push people into

/**
 * What each theme puts where a fight happens: 'prop:<type>' is a hazardous blocking prop (fire or
 * spikes, see obstacles.ts), 'pit' a small drop (lava in the burning themes), 'pool' a few cells
 * of water. Repeats weight the choice. Themes already ringed by drops get props only.
 */
export const HAZARD_MENU: Record<ThemeId, string[]> = {
  warrens: ['prop:stalagmite', 'prop:stalagmite', 'prop:campfire', 'pit', 'pool'],
  crypt: ['pit', 'prop:brazier', 'prop:brazier'],
  depths: ['prop:crystal'],
  sewers: ['pool', 'pool', 'prop:brazier', 'pit'],
  fungal: ['prop:stalagmite', 'pool', 'pool', 'pit'],
  hold: ['prop:brazier', 'prop:campfire', 'prop:weapon_rack', 'prop:palisade', 'pit'],
  library: ['prop:candelabra', 'prop:candelabra', 'pool', 'pit'],
  foundry: ['prop:forge', 'prop:crucible'],
  ice: ['prop:ice_spike', 'prop:ice_spike', 'prop:crystal', 'pit', 'pool'],
  ruin: ['prop:brazier', 'prop:campfire', 'pit', 'pool'],
  hell: ['prop:brazier', 'prop:iron_bars', 'pit'],
  lair: ['prop:dragon_bones', 'prop:stalagmite', 'pit'],
  forest: ['prop:campfire', 'pool', 'pool', 'pit'],
  marsh: ['pool', 'pool', 'prop:campfire', 'pit'],
  peaks: ['prop:campfire'],
};

const BLOBS: Array<Array<[number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
];

/**
 * Turn floor at `anchor` into a small pit or pool, if it can be done without cutting the room, touching
 * a slot (`avoid`) or crowding a doorway. Returns the cells, or null.
 */
export function stageBlob(v: RoomView, rng: Rng, log: EditLog, anchor: number, kind: 'pit' | 'pool', avoid: Set<number>): number[] | null {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  const special = new Set([env.entrance.y * w + env.entrance.x, env.exit.y * w + env.exit.x, v.info.center.y * w + v.info.center.x]);
  for (const shape of rng.shuffle(BLOBS.slice())) {
    const cells = shape.map(([ox, oy]) => (((anchor / w) | 0) + oy) * w + (anchor % w) + ox);
    const ok = cells.every((c) => {
      if (!g.inb(c % w, (c / w) | 0) || g.room[c] !== v.id || g.kinds[c] !== K.Floor || props.occ[c] === 2 || props.keepFree[c]) return false;
      return (env.doorDist[c] as number) >= 3 && !avoid.has(c) && !special.has(c);
    });
    if (!ok) continue;
    const set = new Set(cells);
    let clear = true;
    for (const c of cells) for (const [ox, oy] of NEI8) {
      const j = c + oy * w + ox;
      if (!set.has(j) && (g.kinds[j] === K.Chasm || (kind === 'pit' && g.kinds[j] === K.Water))) clear = false;
    }
    if (!clear) continue;
    const sub = new EditLog();
    for (const c of cells) setCell(env, sub, c, kind === 'pit' ? K.Chasm : K.Water, kind === 'pit' ? 0 : undefined);
    if (kind === 'pit' && !stillConnected(v, cells)) {
      undoEdit(env, sub);
      continue;
    }
    finishEdit(env, sub);
    for (const c of cells) {
      if (props.occ[c] !== 1) continue;
      const k = props.list.findIndex((p) => p.pos.y * w + p.pos.x === c);
      if (k >= 0) props.list.splice(k, 1);
      props.occ[c] = 0;
    }
    for (const e of sub.cells) log.cells.push(e);
    return cells;
  }
  return null;
}

/**
 * Make sure most of a room's monsters stand within two cells of something to be pushed into: for
 * each slot without one, add a hazard from the theme's menu beside it. Never on or beside a doorway,
 * never on a slot, never cutting the room. Returns true if anything was added.
 */
export function seedHazards(v: RoomView, rng: Rng, slots: number[], share = 0.6): boolean {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  refreshReach(v);
  // The floor-wide push map is built once and kept up to date; refresh it over this room (formations stage props and pits).
  const mask = (env.pushMask ??= pushMap(env.plan));
  const b = v.info.bounds;
  for (let y = b.y0 - 1; y <= b.y1 + 1; y++) {
    for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
      if (!g.inb(x, y)) continue;
      const i = y * w + x;
      const k = g.kinds[i];
      let water = 0;
      if (k === K.Water) for (const [ox, oy] of NEI8) if (g.kind(x + ox, y + oy) === K.Water) water++;
      mask[i] = k === K.Chasm || (k === K.Water && water >= 2) ? 1 : 0;
    }
  }
  for (const p of props.list) {
    if (p.blocking && PROP_OBSTACLE[p.type] && p.pos.x >= b.x0 - 1 && p.pos.x <= b.x1 + 1 && p.pos.y >= b.y0 - 1 && p.pos.y <= b.y1 + 1) mask[p.pos.y * w + p.pos.x] = 1;
  }
  const near = (c: number): boolean => {
    const x = c % w;
    const y = (c / w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.inb(x + dx, y + dy) && mask[(y + dy) * w + x + dx] === 1) return true;
    return false;
  };
  const avoid = new Set(slots);
  const menu = HAZARD_MENU[env.theme];
  let added = false;
  const need = (): number => Math.ceil(slots.length * share) - slots.filter(near).length;
  const order = rng.shuffle(slots.filter((c) => !near(c)));
  for (const s of order) {
    if (need() <= 0) break;
    if (near(s)) continue;
    for (let attempt = 0; attempt < 8; attempt++) {
      const opt = rng.pick(menu);
      const x = s % w;
      const y = (s / w) | 0;
      const cand: number[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const c = (y + dy) * w + x + dx;
          if (g.inb(x + dx, y + dy) && g.room[c] === v.id && g.kinds[c] === K.Floor && (v.reach[c] as number) >= 0 && !avoid.has(c) && props.occ[c] !== 2) cand.push(c);
        }
      }
      if (cand.length === 0) break;
      const c = rng.pick(cand);
      const log = new EditLog();
      if (opt.startsWith('prop:')) {
        if (props.occ[c] !== 0 || (env.doorDist[c] as number) < 3 || !props.can(c % w, (c / w) | 0, true)) continue;
        if (!stillConnectedWith(v, c)) continue;
        if (addProp(env, log, opt.slice(5), c % w, (c / w) | 0, rng.int(0, 3), true)) {
          mask[c] = 1;
          added = true;
          refreshReach(v);
          break;
        }
      } else {
        const cells = stageBlob(v, rng, log, c, opt === 'pit' ? 'pit' : 'pool', avoid);
        if (cells) {
          for (const k of cells) mask[k] = 1;
          added = true;
          refreshReach(v);
          break;
        }
      }
    }
  }
  return added;
}

/** Would the room stay connected if cell `c` were blocked? (Props placed by `props.can` already keep their ring open; this checks the whole room.) */
export function stillConnectedWith(v: RoomView, c: number): boolean {
  const { props } = v.env;
  const had = props.occ[c] as number;
  props.occ[c] = 2;
  const ok = stillConnected(v, [c]);
  props.occ[c] = had;
  return ok;
}

/**
 * A cell for a reward chest in a cleared room: against (or one cell off) a wall on the far side from the main doorway,
 * on reachable floor with two or more free neighbours, off the slots, not beside a drop (opening it must
 * not be a trap), not cutting the room, and in sight of an arrival doorway from within 3 cells.
 */
export function chestCell(v: RoomView, rng: Rng, slots: number[], relaxed = false): number | null {
  const { env } = v;
  const { g, props } = env;
  const w = g.w;
  const T = v.maxDepth;
  const cands: Array<{ c: number; score: number }> = [];
  for (const c of v.cells) {
    if (g.kinds[c] !== K.Floor || props.occ[c] !== 0 || props.keepFree[c] || (v.reach[c] as number) < 0) continue;
    if (c === env.exit.y * w + env.exit.x || c === env.entrance.y * w + env.entrance.x) continue;
    if ((env.doorDist[c] as number) < (relaxed ? 2 : 3) || (env.edge[c] as number) > (relaxed ? 4 : 2)) continue;
    if (slots.some((o) => cheb(w, o, c) < 2)) continue;
    const x = c % w;
    const y = (c / w) | 0;
    let free = 0;
    let drop = false;
    for (const [ox, oy] of NEI8) {
      const k = g.kind(x + ox, y + oy);
      if (k === K.Chasm) drop = true;
      if ((k === K.Floor || k === K.Water) && props.occ[(y + oy) * w + x + ox] !== 2) free++;
    }
    if (drop || free < 2) continue;
    const score = (depthOf(v, c) / Math.max(1, T)) * 3 + ((env.edge[c] as number) <= 1 ? 1 : 0) + (v.visMain[c] ? 0.5 : 0) + rng.next();
    cands.push({ c, score });
  }
  cands.sort((p, q) => q.score - p.score || p.c - q.c);
  for (const { c } of cands.slice(0, 12)) {
    const x = c % w;
    const y = (c / w) | 0;
    // Findable: some arrival doorway sees a cell within 3 of it.
    let seen = false;
    for (const t of v.entry) {
      for (let dy = -3; dy <= 3 && !seen; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (g.walkable(x + dx, y + dy) && lineOfSight(g.kinds, w, t % w, (t / w) | 0, x + dx, y + dy)) {
            seen = true;
            break;
          }
        }
      }
      if (seen) break;
    }
    if (!seen || !stillConnectedWith(v, c)) continue;
    return c;
  }
  return null;
}

import type { FloorPlan } from '../core/types';
import { CellKind } from '../core/types';
import { NEI8, isWalkKind } from './grid';
import { PROP_OBSTACLE } from './obstacles';

/**
 * Which kinds of interesting terrain a room offers (see "Making it a thinking game" in
 * docs/DESIGN.md). Computed on a finished plan, so tests and the generator share one definition.
 */
export interface RoomFeatures {
  /** A hazard edge: a Chasm (pit, lava, open drop) cell touching a walkable cell of the room, or a pool of two or more Water cells. */
  hazard: boolean;
  /** The Chasm part of `hazard` alone (a drop or lava edge, as opposed to water). */
  drop: boolean;
  /** Two or more blocking props standing in the open (at least five free neighbours), so a fighter can step behind one. */
  cover: boolean;
  /** An interior chokepoint: a pass-through cell between two obstacles (props, walls, drops), e.g. a bridge or a gap between pillars. */
  choke: boolean;
  /** A dais, ledge or sunken floor: a second elevation level with at least three cells inside the room. */
  height: boolean;
  /** A push target (fall or lava cell, hazardous prop, or a pool of 3+ water cells) beside the room's walkable cells. Only measured when `withPush` is asked for. */
  push: boolean;
  /** Monster and boss slots in the room, and how many have a push target within 2 cells. */
  slots: number;
  slotsNearPush: number;
}

/** 1 on every cell a creature could be pushed into to its hurt: chasm, hazardous blocking prop, or water in a pool of 3+ cells. */
export function pushMap(plan: FloorPlan): Uint8Array {
  const { width: w, height: h, kinds } = plan;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (kinds[i] === CellKind.Chasm) out[i] = 1;
  for (const p of plan.props) if (p.blocking && PROP_OBSTACLE[p.type]) out[p.pos.y * w + p.pos.x] = 1;
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (kinds[s] !== CellKind.Water || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let q = 0; q < comp.length; q++) {
      const c = comp[q] as number;
      for (const [dx, dy] of NEI8) {
        const x = (c % w) + dx;
        const y = ((c / w) | 0) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        if (kinds[j] === CellKind.Water && !seen[j]) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    if (comp.length >= 3) for (const c of comp) out[c] = 1;
  }
  return out;
}

let blockBuf = new Uint8Array(4096);

export function roomFeatures(plan: FloorPlan, roomId: number, cellList?: number[], withPush = cellList === undefined): RoomFeatures {
  const { width: w, height: h, kinds } = plan;
  if (blockBuf.length < w * h) blockBuf = new Uint8Array(w * h);
  const blocking = blockBuf;
  blocking.fill(0, 0, w * h);
  for (const p of plan.props) if (p.blocking) blocking[p.pos.y * w + p.pos.x] = 1;
  const walkFree = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return isWalkKind(kinds[i] as number) && !blocking[i];
  };
  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const i = y * w + x;
    return !isWalkKind(kinds[i] as number) || blocking[i] === 1;
  };
  let drop = false;
  let water = 0;
  let openProps = 0;
  let choke = false;
  const elevCount = new Map<number, number>();
  let cells = 0;
  const idxs = cellList ?? roomCells(plan, roomId);
  for (const i of idxs) {
    {
      const x = i % w;
      const y = (i / w) | 0;
      const k = kinds[i] as number;
      if (k === CellKind.Chasm) {
        drop = true; // chasm cells inside a room (wells, pits)
        continue;
      }
      if (!isWalkKind(k)) continue;
      cells++;
      elevCount.set(plan.elevation[i] as number, (elevCount.get(plan.elevation[i] as number) ?? 0) + 1);
      if (k === CellKind.Water) water++;
      if (!drop) {
        for (const [dx, dy] of NEI8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && kinds[ny * w + nx] === CellKind.Chasm) {
            drop = true;
            break;
          }
        }
      }
      if (blocking[i]) {
        let free = 0;
        for (const [dx, dy] of NEI8) if (walkFree(x + dx, y + dy)) free++;
        if (free >= 5) openProps++;
        continue;
      }
      if (!choke && k !== CellKind.Door) {
        const ew = solid(x - 1, y) && solid(x + 1, y) && walkFree(x, y - 1) && walkFree(x, y + 1);
        const ns = solid(x, y - 1) && solid(x, y + 1) && walkFree(x - 1, y) && walkFree(x + 1, y);
        if (ew || ns) choke = true;
      }
    }
  }
  let height = false;
  if (elevCount.size >= 2) {
    let modal = 0;
    for (const v of elevCount.values()) modal = Math.max(modal, v);
    height = cells - modal >= 3;
  }
  let push = false;
  let slots = 0;
  let near = 0;
  if (withPush) {
    const pm = pushMap(plan);
    for (const i of idxs) {
      if (push) break;
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1 && !push; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && pm[ny * w + nx] === 1 && isWalkKind(kinds[i] as number)) {
            push = true;
            break;
          }
        }
      }
    }
    for (const sp of plan.spawns) {
      if (sp.roomId !== roomId || sp.role === 'chest') continue;
      slots++;
      let hit = false;
      for (let dy = -2; dy <= 2 && !hit; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = sp.pos.x + dx;
          const ny = sp.pos.y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && pm[ny * w + nx] === 1) {
            hit = true;
            break;
          }
        }
      }
      if (hit) near++;
    }
  }
  return { hazard: drop || water >= 2, drop, cover: openProps >= 2, choke, height, push, slots, slotsNearPush: near };
}

/** True if the room has at least one feature. */
export function hasFeature(f: RoomFeatures): boolean {
  return f.hazard || f.cover || f.choke || f.height;
}

function roomCells(plan: FloorPlan, roomId: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < plan.roomIds.length; i++) if (plan.roomIds[i] === roomId) out.push(i);
  return out;
}

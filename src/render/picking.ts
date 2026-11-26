import { Raycaster, Vector2 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { GridPos } from '../core/types';
import type { EntityManager } from './entities';
import { OCC_STRENGTH, occFactor } from './occlusion';
import { CELL } from './util';

export interface PickOut {
  cell: GridPos | null;
  entityId: string | null;
}

/**
 * Picks entities (raycast against generous proxy volumes) then the floor
 * (grid traversal against per-cell surface heights, which gets stairs and
 * cliff edges right without raycasting thousands of triangles).
 */
export class Picker {
  private ray = new Raycaster();
  private ndc = new Vector2();
  private floorW = 0;
  private floorH = 0;
  private topH: Float32Array = new Float32Array(0);
  private wallBase: Float32Array = new Float32Array(0);
  /** Cell index of the last floor hit, or -1. */
  hitIndex = -1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly entities: EntityManager,
  ) {
    this.ray.far = 300;
  }

  setFloor(width: number, height: number, topH: Float32Array, wallBase: Float32Array): void {
    this.wallBase = wallBase;
    this.floorW = width;
    this.floorH = height;
    this.topH = topH;
  }

  pick(clientX: number, clientY: number, out: PickOut): void {
    out.cell = null;
    out.entityId = null;
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);

    this.entities.rebuildPickList();
    if (this.entities.pickList.length > 0) {
      const hits = this.ray.intersectObjects(this.entities.pickList, false);
      const hit = hits[0];
      if (hit) {
        const id = hit.object.userData.entityId as string | undefined;
        if (id) {
          out.entityId = id;
          const e = this.entities.entities.get(id);
          if (e) out.cell = { x: e.cell.x, y: e.cell.y };
          return;
        }
      }
    }
    const idx = this.pickFloor();
    this.hitIndex = idx;
    if (idx >= 0) out.cell = { x: idx % this.floorW, y: (idx / this.floorW) | 0 };
  }

  private pickFloor(): number {
    const W = this.floorW;
    const H = this.floorH;
    if (W === 0) return -1;
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const W2 = W * CELL;
    const H2 = H * CELL;
    let t0 = 0;
    let t1 = 300;
    if (Math.abs(d.x) < 1e-9) {
      if (o.x < 0 || o.x > W2) return -1;
    } else {
      const a = (0 - o.x) / d.x;
      const b = (W2 - o.x) / d.x;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (Math.abs(d.z) < 1e-9) {
      if (o.z < 0 || o.z > H2) return -1;
    } else {
      const a = (0 - o.z) / d.z;
      const b = (H2 - o.z) / d.z;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 >= t1) return -1;
    const px = o.x + d.x * (t0 + 1e-4);
    const pz = o.z + d.z * (t0 + 1e-4);
    let cx = Math.min(W - 1, Math.max(0, Math.floor(px / CELL)));
    let cy = Math.min(H - 1, Math.max(0, Math.floor(pz / CELL)));
    const stepX = d.x > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const adx = Math.abs(d.x);
    const adz = Math.abs(d.z);
    const tDx = adx > 1e-9 ? CELL / adx : Infinity;
    const tDz = adz > 1e-9 ? CELL / adz : Infinity;
    let tMx = adx > 1e-9 ? t0 + ((d.x > 0 ? (cx + 1) * CELL - px : px - cx * CELL) / adx) : Infinity;
    let tMz = adz > 1e-9 ? t0 + ((d.z > 0 ? (cy + 1) * CELL - pz : pz - cy * CELL) / adz) : Infinity;
    let t = t0;
    for (let guard = 0; guard < 512; guard++) {
      const tOut = Math.min(tMx, tMz, t1);
      const idx = cy * W + cx;
      let h = this.topH[idx]!;
      const wb = this.wallBase[idx]!;
      if (h === h && wb === wb) {
        // Walls lowered by the occlusion shader are lowered for picking too.
        const f = occFactor((cx + 0.5) * CELL, (cy + 0.5) * CELL);
        if (f > 0.001) h -= Math.max(0, h - wb - 0.2) * f * OCC_STRENGTH;
      }
      if (h === h) {
        const yIn = o.y + d.y * t;
        const yOut = o.y + d.y * tOut;
        if (yIn <= h || yOut <= h) return idx;
      }
      if (tOut >= t1) break;
      if (tMx < tMz) {
        cx += stepX;
        tMx += tDx;
      } else {
        cy += stepZ;
        tMz += tDz;
      }
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      t = tOut;
    }
    return -1;
  }
}

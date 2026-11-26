import { Color } from 'three';
import type { FloorPlan } from '../core/types';
import { CellKind } from '../core/types';
import type { ThemeLook } from './themeLooks';
import { CELL, ENTITY_LIGHT, STEP } from './util';

const WHITE = new Color(1, 1, 1);

/**
 * Bakes plan lights and a cheap ambient-occlusion term onto the lattice of cell
 * corners. Geometry vertices then sample the lattice bilinearly, so lighting
 * costs nothing at runtime.
 */
export class Bake {
  private readonly lat: Float32Array;
  private readonly lw: number;
  private readonly lh: number;

  constructor(
    readonly plan: FloorPlan,
    look: ThemeLook,
  ) {
    const { width: W, height: H, kinds, elevation } = plan;
    this.lw = W + 1;
    this.lh = H + 1;
    const lw = this.lw;
    const lat = new Float32Array(lw * this.lh * 3);
    this.lat = lat;
    const opaque = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return true;
      const k = kinds[y * W + x];
      return k === CellKind.Wall || k === CellKind.Void;
    };
    // Ambient + AO per corner, and mean standing height for distance falloff.
    const cornerY = new Float32Array(lw * this.lh);
    for (let j = 0; j <= H; j++) {
      for (let i = 0; i <= W; i++) {
        let open = 0;
        let ysum = 0;
        let ycount = 0;
        for (let k = 0; k < 4; k++) {
          const cx = i - 1 + (k & 1);
          const cy = j - 1 + (k >> 1);
          if (!opaque(cx, cy)) {
            open++;
            ysum += elevation[cy * W + cx]! * STEP;
            ycount++;
          }
        }
        const ao = open === 4 ? 1 : open === 0 ? 0.45 : 0.45 + open * 0.14;
        const o = (j * lw + i) * 3;
        const v = (look.baseLight / ENTITY_LIGHT) * ao;
        lat[o] = v;
        lat[o + 1] = v;
        lat[o + 2] = v;
        cornerY[j * lw + i] = ycount ? ysum / ycount : 0;
      }
    }
    // Lights.
    const c = new Color();
    for (const L of plan.lights) {
      c.setHex(L.color).lerp(WHITE, 0.4);
      const lx = L.pos.x;
      const ly = L.pos.y;
      const lyElev = (elevation[ly * W + lx] ?? 0) * STEP + 1.4;
      const r = Math.max(0.5, L.radius);
      const x0 = Math.max(0, Math.floor(lx - r) );
      const x1 = Math.min(W, Math.ceil(lx + r) + 1);
      const y0 = Math.max(0, Math.floor(ly - r));
      const y1 = Math.min(H, Math.ceil(ly + r) + 1);
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          // Corner (i, j) is at cell coords; light centre is at lx+0.5, ly+0.5.
          const dx = i - (lx + 0.5);
          const dz = j - (ly + 0.5);
          const dy = (lyElev - cornerY[j * lw + i]! - 0.3) / CELL;
          const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
          if (d >= r) continue;
          // Visible if any adjacent open cell has a clear line from the light cell.
          let vis = false;
          for (let k = 0; k < 4 && !vis; k++) {
            const cx = i - 1 + (k & 1);
            const cy = j - 1 + (k >> 1);
            if (opaque(cx, cy)) continue;
            if (this.clear(lx, ly, cx, cy, opaque)) vis = true;
          }
          if (!vis) continue;
          const t = 1 - d / r;
          const f0 = t * t * L.intensity * (look.lightGain / ENTITY_LIGHT) * 0.55;
          const f = f0 / (1 + 0.55 * f0);
          const o = (j * lw + i) * 3;
          lat[o] = lat[o]! + c.r * f;
          lat[o + 1] = lat[o + 1]! + c.g * f;
          lat[o + 2] = lat[o + 2]! + c.b * f;
        }
      }
    }
  }

  /** Bresenham over cells; true if no opaque cell lies strictly between the two. */
  private clear(ax: number, ay: number, bx: number, by: number, opaque: (x: number, y: number) => boolean): boolean {
    let x = ax;
    let y = ay;
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 64; guard++) {
      if (x === bx && y === by) return true;
      if ((x !== ax || y !== ay) && opaque(x, y)) return false;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return true;
  }

  /** Bilinear lattice sample at a world XZ position. Writes r,g,b into out. */
  sample(wx: number, wz: number, out: Float32Array): void {
    const u = Math.min(Math.max(wx / CELL, 0), this.lw - 1.0001);
    const v = Math.min(Math.max(wz / CELL, 0), this.lh - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const lat = this.lat;
    const o00 = (j * this.lw + i) * 3;
    const o10 = o00 + 3;
    const o01 = o00 + this.lw * 3;
    const o11 = o01 + 3;
    for (let k = 0; k < 3; k++) {
      const a = lat[o00 + k]! * (1 - fu) + lat[o10 + k]! * fu;
      const b = lat[o01 + k]! * (1 - fu) + lat[o11 + k]! * fu;
      out[k] = a * (1 - fv) + b * fv;
    }
  }
}

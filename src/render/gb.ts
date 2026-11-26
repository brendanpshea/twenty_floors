import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c1 = new Color();
const _c2 = new Color();

export interface PartOpts {
  /** Position of the shape's centre. */
  x?: number;
  y?: number;
  z?: number;
  /** Euler rotation (radians). */
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** If set, colour blends bottom (primary colour) to top (this colour). */
  top?: number;
  /** Scale on the colour (cheap per-part shading). */
  shade?: number;
}

/**
 * Collects primitive shapes into a single merged, flat-shaded, vertex-coloured
 * geometry (attributes: position, normal, color). Used for props and stand-ins.
 */
export class GeoBuilder {
  private parts: BufferGeometry[] = [];

  add(src: BufferGeometry, color: number, o: PartOpts = {}): this {
    const g = src.index ? src.toNonIndexed() : src.clone();
    src.dispose();
    g.deleteAttribute('uv');
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const pos = g.getAttribute('position');
    const n = pos.count;
    const col = new Float32Array(n * 3);
    _c1.setHex(color);
    const shade = o.shade ?? 1;
    if (o.top !== undefined) _c2.setHex(o.top);
    const h = bb.max.y - bb.min.y || 1;
    for (let i = 0; i < n; i++) {
      let r = _c1.r;
      let gg = _c1.g;
      let b = _c1.b;
      if (o.top !== undefined) {
        const t = (pos.getY(i) - bb.min.y) / h;
        r += (_c2.r - r) * t;
        gg += (_c2.g - gg) * t;
        b += (_c2.b - b) * t;
      }
      col[i * 3] = r * shade;
      col[i * 3 + 1] = gg * shade;
      col[i * 3 + 2] = b * shade;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    _q.setFromEuler(_e);
    _p.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, o?: PartOpts): this {
    return this.add(new BoxGeometry(w, h, d), color, o);
  }
  cyl(rTop: number, rBot: number, h: number, seg: number, color: number, o?: PartOpts): this {
    return this.add(new CylinderGeometry(rTop, rBot, h, seg, 1), color, o);
  }
  cone(r: number, h: number, seg: number, color: number, o?: PartOpts): this {
    return this.add(new ConeGeometry(r, h, seg, 1), color, o);
  }
  ico(r: number, detail: number, color: number, o?: PartOpts): this {
    return this.add(new IcosahedronGeometry(r, detail), color, o);
  }
  octa(r: number, color: number, o?: PartOpts): this {
    return this.add(new OctahedronGeometry(r, 0), color, o);
  }
  sphere(r: number, wSeg: number, hSeg: number, color: number, o?: PartOpts): this {
    return this.add(new SphereGeometry(r, wSeg, hSeg), color, o);
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  /** Merge everything added so far. Returns null if nothing was added. */
  build(): BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

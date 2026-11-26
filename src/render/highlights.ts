import { CanvasTexture, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, LinearFilter, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Group } from 'three';
import type { CellHighlight, HighlightStyle } from '../core/types';
import { CELL } from './util';

const STYLES: HighlightStyle[] = ['move', 'path', 'target', 'area', 'danger'];
const T = 64;

interface StyleArt {
  fill: string;
  line: string;
  lineWidth: number;
  hatch?: string;
  dot?: boolean;
}

const ART: Record<HighlightStyle, StyleArt> = {
  move: { fill: 'rgba(110,175,255,0.17)', line: 'rgba(150,200,255,0.95)', lineWidth: 3 },
  path: { fill: 'rgba(0,0,0,0)', line: 'rgba(255,255,255,1)', lineWidth: 3, dot: true },
  target: { fill: 'rgba(255,60,50,0.16)', line: 'rgba(255,70,55,1)', lineWidth: 5 },
  area: { fill: 'rgba(255,150,40,0.16)', line: 'rgba(255,175,70,0.95)', lineWidth: 3, hatch: 'rgba(255,170,60,0.45)' },
  danger: { fill: 'rgba(90,0,12,0.34)', line: 'rgba(170,20,30,0.95)', lineWidth: 3, hatch: 'rgba(120,10,20,0.5)' },
};

/** 4x4 atlas of tiles, indexed by a 4-bit mask of OUTER edges (N=1, E=2, S=4, W=8). */
function makeAtlas(style: HighlightStyle): CanvasTexture {
  const art = ART[style];
  const c = document.createElement('canvas');
  c.width = c.height = T * 4;
  const g = c.getContext('2d')!;
  for (let m = 0; m < 16; m++) {
    const ox = (m % 4) * T;
    const oy = Math.floor(m / 4) * T;
    g.save();
    g.beginPath();
    g.rect(ox, oy, T, T);
    g.clip();
    if (art.dot) {
      if (m === 0) {
        g.fillStyle = 'rgba(40,110,230,1)';
        g.beginPath();
        g.arc(ox + T / 2, oy + T / 2, 13, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = art.line;
        g.beginPath();
        g.arc(ox + T / 2, oy + T / 2, 9, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      continue;
    }
    const inN = m & 1 ? 3 : 0;
    const inE = m & 2 ? 3 : 0;
    const inS = m & 4 ? 3 : 0;
    const inW = m & 8 ? 3 : 0;
    g.fillStyle = art.fill;
    g.fillRect(ox + inW, oy + inN, T - inW - inE, T - inN - inS);
    if (art.hatch) {
      g.strokeStyle = art.hatch;
      g.lineWidth = 2;
      for (let i = -T; i < T; i += 12) {
        g.beginPath();
        g.moveTo(ox + i, oy + T);
        g.lineTo(ox + i + T, oy);
        g.stroke();
      }
    }
    g.strokeStyle = art.line;
    g.lineWidth = art.lineWidth;
    g.lineCap = 'butt';
    const h = art.lineWidth / 2;
    const line = (x0: number, y0: number, x1: number, y1: number): void => {
      g.beginPath();
      g.moveTo(ox + x0, oy + y0);
      g.lineTo(ox + x1, oy + y1);
      g.stroke();
    };
    const e0 = (m & 8 ? 3 : 0) - (m & 8 ? h : 0);
    const e1 = T - (m & 2 ? 3 : 0) + (m & 2 ? h : 0);
    if (m & 1) line(e0, 3 + h, e1, 3 + h);
    if (m & 4) line(e0, T - 3 - h, e1, T - 3 - h);
    if (m & 8) line(3 + h, 0, 3 + h, T);
    if (m & 2) line(T - 3 - h, 0, T - 3 - h, T);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Instanced flat quads above cells (one InstancedMesh per style, atlas tile chosen per instance). */
export class Highlights {
  private meshes = new Map<HighlightStyle, InstancedMesh>();
  private mats = new Map<HighlightStyle, MeshBasicMaterial>();
  private textures: CanvasTexture[] = [];
  private geos: PlaneGeometry[] = [];
  private counts: Record<HighlightStyle, number> = { move: 0, path: 0, target: 0, area: 0, danger: 0 };
  private occ: Record<HighlightStyle, Uint8Array> = {
    move: new Uint8Array(0),
    path: new Uint8Array(0),
    target: new Uint8Array(0),
    area: new Uint8Array(0),
    danger: new Uint8Array(0),
  };
  private w = 0;
  private h = 0;

  constructor(private readonly parent: Group) {
    for (const s of STYLES) {
      const tex = makeAtlas(s);
      this.textures.push(tex);
      const mat = new MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: false,
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aTile;')
          .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = (vMapUv + vec2(mod(aTile, 4.0), 3.0 - floor(aTile / 4.0))) * 0.25;
#endif`,
          );
      };
      mat.customProgramCacheKey = () => 'hl-atlas';
      this.mats.set(s, mat);
      this.makeMesh(s, 128);
    }
  }

  /** Tell the highlighter the grid size (call on floor load). */
  setGrid(w: number, h: number): void {
    this.w = w;
    this.h = h;
    for (const s of STYLES) this.occ[s] = new Uint8Array(w * h);
  }

  private makeMesh(style: HighlightStyle, capacity: number): InstancedMesh {
    const old = this.meshes.get(style);
    if (old) {
      this.parent.remove(old);
      old.dispose();
    }
    const geo = new PlaneGeometry(CELL * 0.98, CELL * 0.98).rotateX(-Math.PI / 2);
    geo.setAttribute('aTile', new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage));
    this.geos.push(geo);
    const m = new InstancedMesh(geo, this.mats.get(style)!, capacity);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.visible = false;
    this.parent.add(m);
    this.meshes.set(style, m);
    return m;
  }

  /** `groundAt` returns the world Y of the walkable surface of a cell. */
  set(cells: CellHighlight[], groundAt: (x: number, y: number) => number): void {
    const { w, h } = this;
    const need: Record<HighlightStyle, number> = { move: 0, path: 0, target: 0, area: 0, danger: 0 };
    for (const c of cells) need[c.style]++;
    for (const s of STYLES) {
      let m = this.meshes.get(s)!;
      if (need[s] > m.instanceMatrix.count) m = this.makeMesh(s, Math.max(need[s], m.instanceMatrix.count * 2));
      this.counts[s] = 0;
      m.count = 0;
      this.occ[s].fill(0);
    }
    for (const c of cells) {
      if (c.pos.x >= 0 && c.pos.y >= 0 && c.pos.x < w && c.pos.y < h) this.occ[c.style][c.pos.y * w + c.pos.x] = 1;
    }
    for (const c of cells) {
      const style = c.style;
      const m = this.meshes.get(style)!;
      const i = this.counts[style]++;
      const a = m.instanceMatrix.array as Float32Array;
      const o = i * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0;
      a[o + 12] = c.pos.x * CELL + CELL / 2;
      a[o + 13] = groundAt(c.pos.x, c.pos.y) + 0.07;
      a[o + 14] = c.pos.y * CELL + CELL / 2;
      a[o + 15] = 1;
      let mask = 0;
      if (style !== 'path') {
        const g = this.occ[style];
        const x = c.pos.x;
        const y = c.pos.y;
        if (y <= 0 || !g[(y - 1) * w + x]) mask |= 1;
        if (x >= w - 1 || !g[y * w + x + 1]) mask |= 2;
        if (y >= h - 1 || !g[(y + 1) * w + x]) mask |= 4;
        if (x <= 0 || !g[y * w + x - 1]) mask |= 8;
      }
      (m.geometry.getAttribute('aTile') as InstancedBufferAttribute).array[i] = mask;
    }
    for (const s of STYLES) {
      const m = this.meshes.get(s)!;
      m.count = this.counts[s];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      (m.geometry.getAttribute('aTile') as InstancedBufferAttribute).needsUpdate = true;
    }
  }

  update(time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.5);
    this.mats.get('target')!.opacity = 0.8 + 0.2 * pulse;
    this.mats.get('area')!.opacity = 0.85 + 0.15 * pulse;
    this.mats.get('danger')!.opacity = 0.8 + 0.2 * Math.sin(time * 3);
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      this.parent.remove(m);
      m.dispose();
    }
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    for (const g of this.geos) g.dispose();
    this.meshes.clear();
  }
}

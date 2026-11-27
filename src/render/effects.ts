import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { EffectAnchor, EffectElement, QualityLevel, VisualEffect } from '../core/types';
import { GeoBuilder } from './gb';
import { CELL } from './util';

/**
 * Pooled one-shot visual effects (projectiles, beams, area flashes, auras, impacts).
 *
 * Everything is preallocated: two additive Points systems (small sparks, big glows), one InstancedMesh of ground flashes,
 * one InstancedMesh of line segments (beams, trails, arcs), a few projectile meshes, shells and rings. Nothing is
 * allocated per frame and nothing draws while idle (each pool hides itself when empty). A hard cap on live effects and
 * particles applies per quality level.
 */

export interface EffectsHost {
  /** World point on an anchor: an entity (frac of its height) or a cell centre (frac of 1.8). False if the anchor is missing. */
  point(a: EffectAnchor, frac: number, out: Vector3): boolean;
  /** True when the anchor is an entity that is hidden, or a cell not yet revealed by the fog of war. */
  hidden(a: EffectAnchor): boolean;
  cellRevealed(x: number, y: number): boolean;
  groundAt(x: number, y: number): number;
  /** Knock an entity back and freeze animation; resolves at the knock-back peak. */
  impact(id: string, fromX: number, fromZ: number, strength: number): Promise<void>;
  shake(amount: number): void;
}

const ELEMENTS: EffectElement[] = ['physical', 'fire', 'cold', 'lightning', 'force', 'acid', 'radiant', 'necrotic', 'poison', 'thunder', 'psychic', 'heal', 'holy', 'arcane'];
// r, g, b per element (additive, so bright and saturated).
const PAL = new Float32Array([
  1.0, 0.92, 0.75, // physical
  1.0, 0.45, 0.08, // fire
  0.6, 0.85, 1.0, // cold
  0.85, 0.8, 1.0, // lightning
  0.7, 0.45, 1.0, // force
  0.5, 1.0, 0.2, // acid
  1.0, 0.9, 0.4, // radiant
  0.6, 0.22, 0.75, // necrotic
  0.4, 0.9, 0.3, // poison
  0.8, 0.85, 1.0, // thunder
  1.0, 0.45, 0.8, // psychic
  0.5, 1.0, 0.6, // heal
  1.0, 0.95, 0.6, // holy
  0.6, 0.4, 1.0, // arcane
]);
// Saturated, darker body colours for the normal-blended pass (additive light cannot show colour on a pale floor).
const SOLID = new Float32Array([
  0.55, 0.5, 0.4, // physical
  0.85, 0.22, 0.02, // fire
  0.12, 0.38, 0.85, // cold
  0.35, 0.25, 0.75, // lightning
  0.45, 0.2, 0.8, // force
  0.2, 0.62, 0.08, // acid
  0.9, 0.6, 0.05, // radiant
  0.32, 0.08, 0.45, // necrotic
  0.2, 0.55, 0.15, // poison
  0.4, 0.45, 0.68, // thunder
  0.8, 0.2, 0.55, // psychic
  0.2, 0.7, 0.35, // heal
  0.9, 0.68, 0.18, // holy
  0.4, 0.25, 0.8, // arcane
]);
const EL_INDEX: Record<string, number> = {};
ELEMENTS.forEach((e, i) => (EL_INDEX[e] = i));
const elOf = (e: EffectElement | undefined, dflt = 0): number => (e ? EL_INDEX[e] ?? dflt : dflt);

const K_PROJ = 1;
const K_BEAM = 2;
const K_AREA = 3;
const K_AURA = 4;
const K_IMPACT = 5;

const SHAPES = ['arrow', 'bolt', 'javelin', 'rock', 'dart', 'orb'];
const AURAS = ['heal', 'shield', 'bless', 'buff', 'debuff', 'teleport'];

const MAX_CELLS = 96;
const MAX_VOLLEY = 5;
const POOL_PROJ = 8;
const POOL_SHELL = 3;
const POOL_RING = 3;

interface Caps {
  slots: number;
  cells: number;
  sparks: number;
  glows: number;
  flashes: number;
  segs: number;
  /** Scale on per-cell and burst particle counts. */
  density: number;
  secondary: boolean;
}
const CAPS: Record<QualityLevel, Caps> = {
  high: { slots: 16, cells: 64, sparks: 192, glows: 24, flashes: 128, segs: 420, density: 1, secondary: true },
  medium: { slots: 12, cells: 48, sparks: 128, glows: 16, flashes: 96, segs: 260, density: 0.7, secondary: true },
  low: { slots: 6, cells: 24, sparks: 48, glows: 8, flashes: 36, segs: 100, density: 0.35, secondary: false },
};

interface Slot {
  active: boolean;
  kind: number;
  t: number;
  dur: number;
  resolve: (() => void) | null;
  el: number;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  // projectile
  shape: number;
  hit: boolean;
  count: number;
  flight: number;
  arc: number;
  pm: Int8Array;
  arrived: Uint8Array;
  // beam / aura
  style: number;
  jx: Float32Array;
  jy: Float32Array;
  jz: Float32Array;
  jstep: number;
  // area
  cn: number;
  cx: Float32Array;
  cz: Float32Array;
  cd: Float32Array;
  cdone: Uint8Array;
  maxd: number;
  waveDur: number;
  shell: number;
  ring: number;
  cxm: number;
  czm: number;
  hx: number;
  hz: number;
  emitT: number;
}

function makeSlot(): Slot {
  return {
    active: false, kind: 0, t: 0, dur: 1, resolve: null, el: 0, sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0,
    shape: 0, hit: true, count: 1, flight: 0.2, arc: 0, pm: new Int8Array(MAX_VOLLEY).fill(-1), arrived: new Uint8Array(MAX_VOLLEY),
    style: 0, jx: new Float32Array(8), jy: new Float32Array(8), jz: new Float32Array(8), jstep: -1,
    cn: 0, cx: new Float32Array(MAX_CELLS), cz: new Float32Array(MAX_CELLS), cd: new Float32Array(MAX_CELLS), cdone: new Uint8Array(MAX_CELLS),
    maxd: 1, waveDur: 0.25, shell: -1, ring: -1, cxm: 0, czm: 0, hx: 1, hz: 1, emitT: 0,
  };
}

function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.generateMipmaps = false;
  return t;
}

/** A pooled additive point cloud with per-particle velocity, gravity, drag and fade. */
class Particles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly base: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private live = 0;
  limit: number;
  private readonly geo: BufferGeometry;
  private readonly mat: PointsMaterial;

  constructor(readonly n: number, size: number, tex: CanvasTexture) {
    this.limit = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(0);
    this.age = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.mat = new PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true, fog: false });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 30;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, grav = 0, drag = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.base[o] = r;
    this.base[o + 1] = g;
    this.base[o + 2] = b;
    this.life[i] = life;
    this.age[i] = 0;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.points.visible = true;
  }

  update(dt: number, gain: number): void {
    if (!this.points.visible) return;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]!;
      const o = i * 3;
      if (this.age[i]! >= life) {
        if (life > 0) {
          this.col[o] = this.col[o + 1] = this.col[o + 2] = 0;
          this.life[i] = 0;
        }
        continue;
      }
      live++;
      const a = (this.age[i]! += dt);
      const u = a / life;
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[o] = this.vel[o]! * d;
      this.vel[o + 1] = this.vel[o + 1]! * d - this.grav[i]! * dt;
      this.vel[o + 2] = this.vel[o + 2]! * d;
      this.pos[o] = this.pos[o]! + this.vel[o]! * dt;
      this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * dt;
      this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * dt;
      const f = (u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88) * gain;
      this.col[o] = this.base[o]! * f;
      this.col[o + 1] = this.base[o + 1]! * f;
      this.col[o + 2] = this.base[o + 2]! * f;
    }
    this.live = live;
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
    if (live === 0) this.points.visible = false;
  }

  get alive(): number {
    return this.live;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// Scratch objects (module level: no per-frame allocation).
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _z = new Vector3(0, 0, 1);
const _d = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/** Cheap deterministic noise in [0,1), no allocation. */
function hash(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class Effects {
  readonly group = new Group();
  private readonly tex = dotTexture();
  private readonly sparks: Particles;
  private readonly glows: Particles;
  private readonly flashes: InstancedMesh;
  private readonly segs: InstancedMesh;
  private flashN = 0;
  private segN = 0;
  private readonly solid: InstancedMesh;
  private solidN = 0;
  private readonly projGeo: BufferGeometry[] = [];
  private readonly projMats: MeshBasicMaterial[] = [];
  private readonly proj: Mesh[] = [];
  private readonly shells: Mesh[] = [];
  private readonly rings: Mesh[] = [];
  private readonly shellUsed = new Uint8Array(POOL_SHELL);
  private readonly ringUsed = new Uint8Array(POOL_RING);
  private readonly slots: Slot[] = [];
  private caps: Caps = CAPS.medium;
  private speed = 1;
  private reduced = false;
  private time = 0;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly host: EffectsHost) {
    try {
      this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.reduced = false;
    }
    this.sparks = new Particles(192, 0.28, this.tex);
    this.glows = new Particles(24, 1.5, this.tex);
    this.group.add(this.sparks.points, this.glows.points);

    const flashGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const flashMat = new MeshBasicMaterial({ map: this.tex, transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false, side: DoubleSide });
    this.flashes = new InstancedMesh(flashGeo, flashMat, 128);
    this.flashes.instanceColor = new InstancedBufferAttribute(new Float32Array(128 * 3), 3);
    this.flashes.frustumCulled = false;
    this.flashes.visible = false;
    this.flashes.renderOrder = 28;
    this.flashes.count = 0;
    const segGeo = new CylinderGeometry(1, 1, 1, 5, 1, true).rotateX(Math.PI / 2);
    const segMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    this.segs = new InstancedMesh(segGeo, segMat, 420);
    this.segs.instanceColor = new InstancedBufferAttribute(new Float32Array(420 * 3), 3);
    this.segs.frustumCulled = false;
    this.segs.visible = false;
    this.segs.renderOrder = 29;
    this.segs.count = 0;
    // Normal-blended saturated bodies under the additive pass, so colour survives on pale floors (one extra draw while used).
    const solidMat = new MeshBasicMaterial({ transparent: false, depthWrite: false, fog: false });
    this.solid = new InstancedMesh(segGeo, solidMat, 420);
    this.solid.instanceColor = new InstancedBufferAttribute(new Float32Array(420 * 3), 3);
    this.solid.frustumCulled = false;
    this.solid.visible = false;
    this.solid.renderOrder = 27;
    this.solid.count = 0;
    this.group.add(this.flashes, this.solid, this.segs);
    this.disposables.push(solidMat, this.solid);
    this.disposables.push(flashGeo, flashMat, segGeo, segMat, this.flashes, this.segs, this.tex, this.sparks, this.glows);

    // Projectile bodies, built along +Z.
    const wood = 0x8a6a3a;
    const steel = 0xd8dce4;
    const arrow = new GeoBuilder().cyl(0.025, 0.025, 0.9, 5, wood, { rx: Math.PI / 2 }).cone(0.06, 0.18, 5, steel, { rx: Math.PI / 2, z: 0.52 }).box(0.16, 0.01, 0.2, 0xe8e0d0, { z: -0.4 }).box(0.01, 0.16, 0.2, 0xe8e0d0, { z: -0.4 }).build()!;
    const bolt = new GeoBuilder().cyl(0.03, 0.03, 0.5, 5, 0x5a4a3a, { rx: Math.PI / 2 }).cone(0.07, 0.16, 4, steel, { rx: Math.PI / 2, z: 0.32 }).build()!;
    const javelin = new GeoBuilder().cyl(0.035, 0.035, 1.5, 5, wood, { rx: Math.PI / 2 }).cone(0.08, 0.3, 5, steel, { rx: Math.PI / 2, z: 0.88 }).build()!;
    const rock = new GeoBuilder().ico(0.14, 0, 0x9a948a).build()!;
    const dart = new GeoBuilder().cone(0.07, 0.4, 4, 0xffffff, { rx: Math.PI / 2, z: 0.1 }).cone(0.05, 0.14, 4, 0xe0e0f0, { rx: -Math.PI / 2, z: -0.17 }).build()!;
    const orb = new GeoBuilder().ico(0.01, 0, 0xffffff).build()!;
    this.projGeo.push(arrow, bolt, javelin, rock, dart, orb);
    this.disposables.push(...this.projGeo);
    for (let i = 0; i < POOL_PROJ; i++) {
      const pmat = new MeshBasicMaterial({ vertexColors: true, fog: false });
      this.projMats.push(pmat);
      this.disposables.push(pmat);
      const m = new Mesh(arrow, pmat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 27;
      this.proj.push(m);
      this.group.add(m);
    }
    // Shells (hemisphere / dome) and rings.
    const shellGeo = new SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const ringGeo = new RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2);
    this.disposables.push(shellGeo, ringGeo);
    for (let i = 0; i < POOL_SHELL; i++) {
      const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
      const m = new Mesh(shellGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 26;
      this.shells.push(m);
      this.group.add(m);
      this.disposables.push(mat);
    }
    for (let i = 0; i < POOL_RING; i++) {
      const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
      const m = new Mesh(ringGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 26;
      this.rings.push(m);
      this.group.add(m);
      this.disposables.push(mat);
    }
    for (let i = 0; i < 16; i++) this.slots.push(makeSlot());
    this.setQuality('medium');
  }

  setQuality(q: QualityLevel): void {
    this.caps = CAPS[q];
    this.sparks.limit = this.caps.sparks;
    this.glows.limit = this.caps.glows;
  }

  /** Global time scale (1 normal, 2 fast, 5 skip). */
  setSpeed(s: number): void {
    this.speed = s;
  }

  get reducedMotion(): boolean {
    return this.reduced;
  }

  /** True while any effect is live (for tests and idle checks). */
  get busy(): boolean {
    for (const s of this.slots) if (s.active) return true;
    return false;
  }

  // ---- public ------------------------------------------------------------

  play(fx: VisualEffect): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        if (!this.start(fx, resolve)) resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Preview only: stop the normal clock; effects then only move through `debugAdvance`. */
  debugPaused = false;

  /** Preview only: advance the effect clock by `seconds` in 1/30 s steps. */
  debugAdvance(seconds: number): void {
    const was = this.debugPaused;
    this.debugPaused = false;
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < n; i++) this.update(seconds / n / (this.speed || 1));
    this.debugPaused = was;
  }

  update(dt: number): void {
    if (this.debugPaused) return;
    this.time += dt;
    const sdt = dt * this.speed;
    this.flashN = 0;
    this.segN = 0;
    this.solidN = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += sdt;
      switch (s.kind) {
        case K_PROJ:
          this.updateProj(s, sdt);
          break;
        case K_BEAM:
          this.updateBeam(s, sdt);
          break;
        case K_AREA:
          this.updateArea(s, sdt);
          break;
        case K_AURA:
          this.updateAura(s, sdt);
          break;
        default:
          break;
      }
      if (s.t >= s.dur) this.finish(s);
    }
    this.flashes.count = this.flashN;
    this.flashes.visible = this.flashN > 0;
    if (this.flashN > 0) {
      this.flashes.instanceMatrix.needsUpdate = true;
      this.flashes.instanceColor!.needsUpdate = true;
    }
    this.segs.count = this.segN;
    this.segs.visible = this.segN > 0;
    if (this.segN > 0) {
      this.segs.instanceMatrix.needsUpdate = true;
      this.segs.instanceColor!.needsUpdate = true;
    }
    this.solid.count = this.solidN;
    this.solid.visible = this.solidN > 0;
    if (this.solidN > 0) {
      this.solid.instanceMatrix.needsUpdate = true;
      this.solid.instanceColor!.needsUpdate = true;
    }
    const gain = this.reduced ? 0.6 : 1;
    this.sparks.update(sdt, gain);
    this.glows.update(sdt, gain);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const s of this.slots) {
      if (s.resolve) s.resolve();
      s.resolve = null;
      s.active = false;
    }
    for (const d of this.disposables) d.dispose();
  }

  // ---- start -------------------------------------------------------------

  private alloc(kind: number, dur: number, resolve: () => void): Slot | null {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.active) n++;
    if (n >= this.caps.slots) return null;
    for (const s of this.slots) {
      if (s.active) continue;
      s.active = true;
      s.kind = kind;
      s.t = 0;
      s.dur = dur;
      s.resolve = resolve;
      s.shell = -1;
      s.ring = -1;
      s.jstep = -1;
      s.emitT = 0;
      s.pm.fill(-1);
      s.arrived.fill(0);
      return s;
    }
    return null;
  }

  private start(fx: VisualEffect, resolve: () => void): boolean {
    switch (fx.kind) {
      case 'projectile': {
        if (this.host.hidden(fx.from) || this.host.hidden(fx.to)) return false;
        if (!this.host.point(fx.from, 0.58, _a) || !this.host.point(fx.to, 0.62, _b)) return false;
        const s = this.alloc(K_PROJ, 1, resolve);
        if (!s) return false;
        s.sx = _a.x; s.sy = _a.y; s.sz = _a.z;
        s.ex = _b.x; s.ey = _b.y; s.ez = _b.z;
        s.el = elOf(fx.element);
        s.shape = Math.max(0, SHAPES.indexOf(fx.shape));
        s.hit = fx.hit;
        s.count = Math.min(MAX_VOLLEY, Math.max(1, fx.count ?? 1));
        const dist = Math.hypot(s.ex - s.sx, s.ez - s.sz);
        s.flight = Math.min(0.5, Math.max(0.12, dist / (CELL * 11))); // ~22 cells/s: world units are 2 per cell
        s.arc = s.shape === 5 || s.shape === 4 ? Math.min(0.5, dist * 0.04) : Math.min(1.4, 0.15 + dist * 0.1);
        // A miss overshoots: the path runs on past the target for another 35% of the flight.
        s.dur = ((s.count - 1) * 0.07 + s.flight * (fx.hit ? 1 : 1.35)) + (fx.hit ? 0.05 : 0.45);
        for (let i = 0; i < s.count; i++) {
          if (s.shape === 5) continue; // orbs are drawn with glow particles only
          for (let k = 0; k < POOL_PROJ; k++) {
            if (!this.proj[k]!.visible && !this.projTaken(k)) {
              s.pm[i] = k;
              this.proj[k]!.geometry = this.projGeo[s.shape]!;
              this.proj[k]!.visible = true;
              // Arrows, bolts, javelins and rocks keep their own colours; darts take the element's.
              const tint = this.projMats[k]!.color;
              if (s.shape === 4 && s.el !== 0) tint.setRGB(0.35 + PAL[s.el * 3]! * 0.65, 0.35 + PAL[s.el * 3 + 1]! * 0.65, 0.35 + PAL[s.el * 3 + 2]! * 0.65);
              else tint.setRGB(1, 1, 1);
              break;
            }
          }
        }
        return true;
      }
      case 'beam': {
        if (this.host.hidden(fx.from) || this.host.hidden(fx.to)) return false;
        if (!this.host.point(fx.from, 0.58, _a) || !this.host.point(fx.to, 0.62, _b)) return false;
        const s = this.alloc(K_BEAM, 0.3, resolve);
        if (!s) return false;
        s.sx = _a.x; s.sy = _a.y; s.sz = _a.z;
        s.ex = _b.x; s.ey = _b.y; s.ez = _b.z;
        s.el = elOf(fx.element);
        s.hit = true;
        const c = PAL.subarray(s.el * 3, s.el * 3 + 3);
        this.glows.emit(s.sx, s.sy, s.sz, 0, 0, 0, 0.3, c[0]!, c[1]!, c[2]!);
        this.glows.emit(s.ex, s.ey, s.ez, 0, 0, 0, 0.3, c[0]!, c[1]!, c[2]!);
        return true;
      }
      case 'area': {
        if (this.host.hidden(fx.origin)) return false;
        if (!this.host.point(fx.origin, 0, _a)) return false;
        const s = this.alloc(K_AREA, 0.8, resolve);
        if (!s) return false;
        s.el = elOf(fx.element);
        s.ex = _a.x; s.ez = _a.z; s.ey = _a.y;
        // Keep revealed cells only, thinned to the quality cap.
        const cells = fx.cells.filter((c) => this.host.cellRevealed(c.x, c.y));
        const cap = Math.min(MAX_CELLS, this.caps.cells);
        const step = Math.max(1, Math.ceil(cells.length / cap));
        let n = 0;
        let maxd = 0.0001;
        let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
        for (let i = 0; i < cells.length && n < cap; i += step) {
          const c = cells[i]!;
          const x = c.x * CELL + CELL / 2;
          const z = c.y * CELL + CELL / 2;
          s.cx[n] = x;
          s.cz[n] = z;
          s.cd[n] = Math.hypot(x - s.ex, z - s.ez);
          s.cdone[n] = 0;
          maxd = Math.max(maxd, s.cd[n]!);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          n++;
        }
        if (n === 0) {
          s.active = false;
          return false;
        }
        s.cn = n;
        s.maxd = maxd;
        s.waveDur = 0.25;
        s.dur = 0.25 + 0.5;
        // Angular extent of the cells as seen from the origin, for the sweeping rim (a full circle if the origin is inside).
        let sx = 0;
        let sz = 0;
        for (let i = 0; i < n; i++) {
          sx += s.cx[i]! - s.ex;
          sz += s.cz[i]! - s.ez;
        }
        const mid = Math.atan2(sz, sx);
        let half = 0;
        for (let i = 0; i < n; i++) {
          let d = Math.atan2(s.cz[i]! - s.ez, s.cx[i]! - s.ex) - mid;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          half = Math.max(half, Math.abs(d));
        }
        const nearOrigin = Math.hypot(sx, sz) / n < CELL * 1.2;
        s.cxm = mid;
        s.czm = nearOrigin || half > 2.2 ? Math.PI : Math.min(Math.PI, half + 0.25);
        s.hx = minX;
        s.hz = minZ;
        if (this.caps.secondary && s.el === EL_INDEX.thunder) for (let i = 0; i < POOL_RING; i++) if (!this.ringUsed[i]) { s.ring = i; this.ringUsed[i] = 1; break; }
        return true;
      }
      case 'aura': {
        if (this.host.hidden(fx.on)) return false;
        if (!this.host.point(fx.on, 0, _a)) return false;
        const style = Math.max(0, AURAS.indexOf(fx.style));
        const s = this.alloc(K_AURA, style === 5 ? 0.55 : 0.75, resolve);
        if (!s) return false;
        this.host.point(fx.on, 1, _b);
        s.sx = _a.x; s.sy = _a.y; s.sz = _a.z;
        s.ey = _b.y - _a.y; // height of the entity
        s.style = style;
        s.hit = false;
        s.el = fx.element ? elOf(fx.element) : style === 0 ? EL_INDEX.heal! : style === 1 ? EL_INDEX.force! : style === 2 ? EL_INDEX.holy! : style === 3 ? EL_INDEX.holy! : style === 4 ? EL_INDEX.necrotic! : EL_INDEX.arcane!;
        if (style === 1) for (let i = 0; i < POOL_SHELL; i++) if (!this.shellUsed[i]) { s.shell = i; this.shellUsed[i] = 1; break; }
        if (style === 2) for (let i = 0; i < POOL_RING; i++) if (!this.ringUsed[i]) { s.ring = i; this.ringUsed[i] = 1; break; }
        return true;
      }
      case 'impact': {
        const e = this.host.point(fx.on, 0.6, _a);
        if (!e) return false;
        const strength = Math.min(1, Math.max(0, fx.strength));
        let fromX = _a.x - 0, fromZ = _a.z - 1;
        if (fx.from !== undefined && this.host.point(fx.from, 0.6, _b)) {
          fromX = _b.x;
          fromZ = _b.z;
        }
        const el = elOf(fx.element, 0);
        // Contact burst, a little toward the attacker.
        _d.set(fromX - _a.x, 0, fromZ - _a.z);
        const dl = _d.length() || 1;
        const cx = _a.x + (_d.x / dl) * 0.35;
        const cz = _a.z + (_d.z / dl) * 0.35;
        const c = PAL.subarray(el * 3, el * 3 + 3);
        const n = Math.round((4 + 10 * strength) * this.caps.density) + 1;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1.2 + Math.random() * (1.8 + 2 * strength);
          this.sparks.emit(cx, _a.y, cz, Math.cos(a) * sp - (_d.x / dl) * 1.5 * strength, 1 + Math.random() * 1.5, Math.sin(a) * sp - (_d.z / dl) * 1.5 * strength, 0.25 + Math.random() * 0.2, c[0]!, c[1]!, c[2]!, 6, 2);
        }
        this.glows.emit(cx, _a.y, cz, 0, 0, 0, 0.14, c[0]! * 0.45, c[1]! * 0.45, c[2]! * 0.45);
        if (strength >= 0.4 && !this.reduced && this.caps.secondary) this.host.shake(0.05 + 0.3 * strength * strength);
        void this.host.impact(fx.on, fromX, fromZ, strength).then(resolve);
        return true;
      }
      default:
        return false;
    }
  }

  private projTaken(k: number): boolean {
    for (const s of this.slots) {
      if (!s.active || s.kind !== K_PROJ) continue;
      for (let i = 0; i < MAX_VOLLEY; i++) if (s.pm[i] === k) return true;
    }
    return false;
  }

  private finish(s: Slot): void {
    s.active = false;
    for (let i = 0; i < MAX_VOLLEY; i++) {
      if (s.pm[i]! >= 0) this.proj[s.pm[i]!]!.visible = false;
      s.pm[i] = -1;
    }
    if (s.shell >= 0) {
      this.shells[s.shell]!.visible = false;
      this.shellUsed[s.shell] = 0;
      s.shell = -1;
    }
    if (s.ring >= 0) {
      this.rings[s.ring]!.visible = false;
      this.ringUsed[s.ring] = 0;
      s.ring = -1;
    }
    this.fire(s);
  }

  private fire(s: Slot): void {
    const r = s.resolve;
    s.resolve = null;
    if (r) r();
  }

  // ---- instance writers --------------------------------------------------

  private addFlash(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void {
    const i = this.flashN;
    if (i >= this.caps.flashes) return;
    this.flashN++;
    _p.set(x, y, z);
    _s.set(size, 1, size);
    _m.compose(_p, _q.identity(), _s);
    this.flashes.setMatrixAt(i, _m);
    const a = this.flashes.instanceColor!.array as Float32Array;
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }

  private addSeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, r: number, g: number, b: number): void {
    const i = this.segN;
    if (i >= this.caps.segs) return;
    _d.set(bx - ax, by - ay, bz - az);
    const len = _d.length();
    if (len < 1e-4) return;
    this.segN++;
    _d.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_z, _d);
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(radius, radius, len);
    _m.compose(_p, _q, _s);
    this.segs.setMatrixAt(i, _m);
    const a = this.segs.instanceColor!.array as Float32Array;
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }

  /** A normal-blended, saturated segment (colour in [0,1], no fade: callers shrink it instead). */
  private addSolid(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, r: number, g: number, b: number): void {
    const i = this.solidN;
    if (i >= this.caps.segs) return;
    _d.set(bx - ax, by - ay, bz - az);
    const len = _d.length();
    if (len < 1e-4 || radius < 1e-3) return;
    this.solidN++;
    _d.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_z, _d);
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(radius, radius, len);
    _m.compose(_p, _q, _s);
    this.solid.setMatrixAt(i, _m);
    const a = this.solid.instanceColor!.array as Float32Array;
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }

  // ---- projectile --------------------------------------------------------

  private projPos(s: Slot, i: number, u: number, out: Vector3): void {
    const over = s.hit ? 1 : 1.35;
    const uu = Math.min(over, Math.max(0, u));
    const dx = s.ex - s.sx;
    const dy = s.ey - s.sy;
    const dz = s.ez - s.sz;
    const ex = dx * uu;
    let ey = dy * uu;
    const ez = dz * uu;
    if (!s.hit && uu > 1) ey -= (uu - 1) * 2.2; // a miss dips toward the floor
    const arcK = Math.sin(Math.PI * Math.min(1, uu / (s.hit ? 1 : 1.35))) * s.arc;
    const len = Math.hypot(dx, dz) || 1;
    const lat = (i - (s.count - 1) / 2) * 0.45 * Math.sin(Math.PI * Math.min(1, uu));
    out.set(s.sx + ex + (-dz / len) * lat, s.sy + ey + arcK, s.sz + ez + (dx / len) * lat);
  }

  private updateProj(s: Slot, dt: number): void {
    const c = PAL.subarray(s.el * 3, s.el * 3 + 3);
    const glowy = s.el !== 0 || s.shape === 5 || s.shape === 4;
    let allArrived = true;
    for (let i = 0; i < s.count; i++) {
      const u = (s.t - i * 0.07) / s.flight;
      const end = s.hit ? 1 : 1.35;
      if (u < 0) {
        allArrived = false;
        continue;
      }
      if (u < 1) allArrived = false;
      const pmI = s.pm[i]!;
      if (u <= end) {
        this.projPos(s, i, u, _a);
        this.projPos(s, i, u + 0.03, _b);
        // trail
        this.projPos(s, i, Math.max(0, u - 0.18), _p);
        if (glowy) {
          this.addSeg(_p.x, _p.y, _p.z, _a.x, _a.y, _a.z, s.shape === 5 ? 0.1 : 0.05, c[0]! * 0.9, c[1]! * 0.9, c[2]! * 0.9);
          if (s.shape === 5 || s.shape === 4) this.glows.emit(_a.x, _a.y, _a.z, 0, 0, 0, 0.12, c[0]!, c[1]!, c[2]!);
        } else {
          this.addSeg(_p.x, _p.y, _p.z, _a.x, _a.y, _a.z, 0.02, 0.5, 0.5, 0.45);
        }
        if (pmI >= 0) {
          const m = this.proj[pmI]!;
          m.position.copy(_a);
          _d.copy(_b).sub(_a);
          if (_d.lengthSq() > 1e-8) {
            _d.normalize();
            m.quaternion.setFromUnitVectors(_z, _d);
          }
          m.visible = true;
        }
      } else if (pmI >= 0) {
        // Past the end of the path.
        if (s.hit || s.shape > 2) this.proj[pmI]!.visible = false;
        else if (u > end + 0.9) this.proj[pmI]!.visible = false;
      }
      if (u >= 1 && !s.arrived[i]) {
        s.arrived[i] = 1;
        this.projPos(s, i, Math.min(1, u), _a);
        if (s.hit) {
          if (pmI >= 0 && s.shape <= 2) this.proj[pmI]!.visible = false;
          const n = Math.round((glowy ? 6 : 3) * this.caps.density) + 1;
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            this.sparks.emit(_a.x, _a.y, _a.z, Math.cos(a) * 1.6, 0.6 + Math.random() * 1.4, Math.sin(a) * 1.6, 0.25 + Math.random() * 0.15, c[0]!, c[1]!, c[2]!, 5, 1);
          }
          if (glowy) this.glows.emit(_a.x, _a.y, _a.z, 0, 0, 0, 0.2, c[0]!, c[1]!, c[2]!);
        }
      }
    }
    // Resolve on arrival of the last missile.
    if (allArrived && s.resolve) this.fire(s);
    // A hit effect ends as soon as the last missile lands plus a beat.
    if (allArrived && s.hit && s.t > s.dur - 0.05) s.t = s.dur;
    void dt;
  }

  // ---- beam --------------------------------------------------------------

  private updateBeam(s: Slot, dt: number): void {
    void dt;
    const t = s.t;
    const k = t < 0.04 ? t / 0.04 : Math.max(0, 1 - (t - 0.04) / 0.26);
    const gain = this.reduced ? 0.6 : 1;
    const c = PAL.subarray(s.el * 3, s.el * 3 + 3);
    const lightning = s.el === EL_INDEX.lightning;
    const f = k * gain;
    if (lightning) {
      // Jagged polyline, re-rolled about 30 times a second.
      const step = Math.floor(t * 30);
      const N = 7;
      if (step !== s.jstep) {
        s.jstep = step;
        const dx = s.ex - s.sx;
        const dy = s.ey - s.sy;
        const dz = s.ez - s.sz;
        const len = Math.hypot(dx, dz) || 1;
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const j = i === 0 || i === N ? 0 : (Math.random() - 0.5) * 0.7;
          const j2 = i === 0 || i === N ? 0 : (Math.random() - 0.5) * 0.5;
          s.jx[i] = s.sx + dx * u + (-dz / len) * j;
          s.jy[i] = s.sy + dy * u + j2;
          s.jz[i] = s.sz + dz * u + (dx / len) * j;
        }
      }
      for (let i = 0; i < N; i++) {
        this.addSeg(s.jx[i]!, s.jy[i]!, s.jz[i]!, s.jx[i + 1]!, s.jy[i + 1]!, s.jz[i + 1]!, 0.05, f, f * 0.95, f);
        this.addSeg(s.jx[i]!, s.jy[i]!, s.jz[i]!, s.jx[i + 1]!, s.jy[i + 1]!, s.jz[i + 1]!, 0.17, c[0]! * f * 0.4, c[1]! * f * 0.3, c[2]! * f * 0.6);
      }
    } else {
      this.addSeg(s.sx, s.sy, s.sz, s.ex, s.ey, s.ez, 0.06 * (0.6 + k), 1 * f, 1 * f, 1 * f);
      this.addSeg(s.sx, s.sy, s.sz, s.ex, s.ey, s.ez, 0.2 * (0.5 + k), c[0]! * f * 0.55, c[1]! * f * 0.55, c[2]! * f * 0.55);
    }
    if (s.el === EL_INDEX.cold && s.emitT < 0.2 && this.caps.secondary) {
      s.emitT += 0.04;
      const n = Math.round(4 * this.caps.density) + 1;
      for (let i = 0; i < n; i++) {
        this.sparks.emit(s.ex + (Math.random() - 0.5) * 0.6, s.ey + (Math.random() - 0.3) * 0.5, s.ez + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2, 0.3 + Math.random(), (Math.random() - 0.5) * 1.2, 0.45, 0.8, 0.95, 1, 1.5, 1);
      }
    }
    if (t >= 0.05 && s.resolve) this.fire(s);
  }

  // ---- area --------------------------------------------------------------

  private emitCell(el: number, x: number, y: number, z: number): void {
    const c = PAL.subarray(el * 3, el * 3 + 3);
    const rnd = Math.random;
    const dens = this.caps.density;
    const n = dens > 0.9 ? 3 : dens > 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const ox = (rnd() - 0.5) * CELL * 0.7;
      const oz = (rnd() - 0.5) * CELL * 0.7;
      switch (el) {
        case 1: // fire: tongues that rise
          this.sparks.emit(x + ox, y + 0.1, z + oz, 0, 1.4 + rnd() * 1.4, 0, 0.45 + rnd() * 0.2, c[0]!, 0.35 + rnd() * 0.4, 0.05, 0, 0.5);
          break;
        case 2: // cold: mist and shards
          this.sparks.emit(x + ox, y + 0.5 + rnd() * 0.4, z + oz, (rnd() - 0.5) * 0.5, 0.2, (rnd() - 0.5) * 0.5, 0.6, 0.75, 0.92, 1, 1.2, 0.5);
          break;
        case 3: // lightning: quick white-violet sparks
          this.sparks.emit(x + ox, y + 0.2 + rnd() * 0.8, z + oz, (rnd() - 0.5) * 4, (rnd() - 0.5) * 3, (rnd() - 0.5) * 4, 0.18, 0.9, 0.85, 1, 0, 2);
          break;
        case 5:
        case 8: // acid, poison: green splash and cloud
          this.sparks.emit(x + ox, y + 0.2, z + oz, (rnd() - 0.5) * 1.5, 1.2 + rnd(), (rnd() - 0.5) * 1.5, 0.6, c[0]!, c[1]!, c[2]!, 4, 0.4);
          break;
        case 6:
        case 12: // radiant, holy: gold motes
          this.sparks.emit(x + ox, y + 0.2, z + oz, 0, 0.7 + rnd() * 0.6, 0, 0.8, c[0]!, c[1]!, c[2]!, 0, 0.3);
          break;
        case 7: // necrotic: dark wisps
          this.sparks.emit(x + ox, y + 0.2, z + oz, (rnd() - 0.5) * 0.8, 0.5 + rnd() * 0.5, (rnd() - 0.5) * 0.8, 0.8, c[0]!, c[1]!, c[2]!, 0, 0.5);
          break;
        case 9: // thunder: dust
          this.sparks.emit(x + ox, y + 0.15, z + oz, ox * 2, 0.4, oz * 2, 0.4, 0.8, 0.8, 0.9, 1, 1);
          break;
        default: // force, arcane, psychic, physical: violet shimmer
          this.sparks.emit(x + ox, y + 0.2 + rnd() * 0.6, z + oz, (rnd() - 0.5) * 0.6, 0.4 + rnd() * 0.5, (rnd() - 0.5) * 0.6, 0.6, c[0]!, c[1]!, c[2]!, 0, 0.5);
          break;
      }
    }
  }

  private updateArea(s: Slot, dt: number): void {
    void dt;
    const el = s.el;
    const c = PAL.subarray(el * 3, el * 3 + 3);
    const gain = this.reduced ? 0.6 : 1;
    const t = s.t;
    const tongues = this.caps.density > 0.9 ? 3 : this.caps.density > 0.5 ? 2 : 1;
    const step = Math.floor(t * 24);
    for (let i = 0; i < s.cn; i++) {
      const delay = (s.cd[i]! / s.maxd) * s.waveDur;
      const u = (t - delay) / 0.42;
      if (u < 0 || u > 1) continue;
      if (!s.cdone[i]) {
        s.cdone[i] = 1;
        this.emitCell(el, s.cx[i]!, s.ey, s.cz[i]!);
      }
      // Quick rise, slow fade; never lets the additive total get near white.
      const env = (u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75) * gain;
      const cx = s.cx[i]!;
      const cz = s.cz[i]!;
      const y0 = s.ey + 0.06;
      // A faint footprint so the tiles that are hit read as the shape.
      for (let k = 0; k < tongues; k++) {
        const h1 = hash(i * 7 + k, 1 + step * 0.37);
        const h2 = hash(i * 13 + k * 3, 5 + step * 0.21);
        const h3 = hash(i + k * 31, 9);
        const ox = (h3 - 0.5) * CELL * 0.62;
        const oz = (hash(i * 3 + k, 11) - 0.5) * CELL * 0.62;
        const bx = cx + ox;
        const bz = cz + oz;
        switch (el) {
          case 1: { // fire: flickering tongues, deep orange with a hot core
            const L = (0.45 + 0.7 * h1) * env;
            const sway = (h2 - 0.5) * 0.35;
            this.addSolid(bx, y0, bz, bx + sway, y0 + L, bz + sway * 0.6, 0.1 * Math.min(1, env * 1.4), SOLID[3 * 1]!, SOLID[3 * 1 + 1]!, SOLID[3 * 1 + 2]!);
            this.addSolid(bx, y0, bz, bx + sway * 0.7, y0 + L * 0.7, bz + sway * 0.4, 0.06 * Math.min(1, env * 1.4), 0.98, 0.5, 0.05);
            this.addSeg(bx, y0, bz, bx + sway * 0.6, y0 + L * 0.5, bz + sway * 0.4, 0.035, 0.8 * env, 0.55 * env, 0.2 * env);
            break;
          }
          case 2: { // cold: shards leaning outward
            const L = (0.35 + 0.5 * h1) * Math.min(1, u * 5) * (1 - u * 0.5) * gain;
            const lean = (h2 - 0.5) * 0.7;
            this.addSolid(bx, y0, bz, bx + lean, y0 + L, bz - lean * 0.5, 0.075 * Math.min(1, env * 1.4), SOLID[6]!, SOLID[7]!, SOLID[8]!);
            this.addSolid(bx, y0, bz, bx + lean * 0.9, y0 + L * 0.85, bz - lean * 0.45, 0.04 * Math.min(1, env * 1.4), 0.55, 0.8, 1.0);
            this.addSeg(bx, y0, bz, bx + lean * 0.9, y0 + L * 0.9, bz - lean * 0.45, 0.018, 0.8 * env, 0.95 * env, 1.0 * env);
            break;
          }
          case 3: { // lightning: thin bright arcs chaining from cell to cell (the first from the origin)
            if (k > 0) break;
            const px = i === 0 ? s.ex : s.cx[i - 1]!;
            const pz = i === 0 ? s.ez : s.cz[i - 1]!;
            const mx = (cx + px) / 2 + (h2 - 0.5) * 1.1;
            const mz = (cz + pz) / 2 + (h3 - 0.5) * 1.1;
            const f = Math.min(1, 1.3 * env);
            this.addSeg(px, y0 + 0.9, pz, mx, y0 + 1.15, mz, 0.05, f * 0.85, f * 0.8, f);
            this.addSeg(mx, y0 + 1.15, mz, cx, y0 + 0.5, cz, 0.05, f * 0.85, f * 0.8, f);
            this.addSolid(px, y0 + 0.9, pz, mx, y0 + 1.15, mz, 0.075 * Math.min(1, f), SOLID[9]!, SOLID[10]!, SOLID[11]!);
            this.addSolid(mx, y0 + 1.15, mz, cx, y0 + 0.5, cz, 0.075 * Math.min(1, f), SOLID[9]!, SOLID[10]!, SOLID[11]!);
            break;
          }
          case 5:
          case 8: { // acid / poison: short fat green spurts
            const L = (0.25 + 0.35 * h1) * env;
            this.addSolid(bx, y0, bz, bx + (h2 - 0.5) * 0.3, y0 + L, bz, 0.1 * Math.min(1, env * 1.4), SOLID[3 * el]!, SOLID[3 * el + 1]!, SOLID[3 * el + 2]!);
            this.addSeg(bx, y0 + L * 0.2, bz, bx, y0 + L * 0.8, bz, 0.03, c[0]! * 0.5 * env, c[1]! * 0.8 * env, c[2]! * 0.3 * env);
            break;
          }
          case 6:
          case 12: { // radiant / holy: tall thin gold rays
            const L = (0.8 + 0.9 * h1) * env;
            this.addSolid(bx, y0, bz, bx, y0 + L, bz, 0.05 * Math.min(1, env * 1.4), SOLID[3 * el]!, SOLID[3 * el + 1]!, SOLID[3 * el + 2]!);
            this.addSeg(bx, y0, bz, bx, y0 + L, bz, 0.025, c[0]! * 0.9 * env, c[1]! * 0.85 * env, c[2]! * 0.5 * env);
            break;
          }
          case 7: { // necrotic: dark-violet wisps with a pale edge
            const L = (0.4 + 0.6 * h1) * env;
            const sway = (h2 - 0.5) * 0.6;
            this.addSolid(bx, y0, bz, bx + sway, y0 + L, bz + sway, 0.09 * Math.min(1, env * 1.4), SOLID[21]!, SOLID[22]!, SOLID[23]!);
            this.addSeg(bx, y0, bz, bx + sway * 0.8, y0 + L * 0.8, bz + sway * 0.8, 0.02, 0.7 * env, 0.6 * env, 0.8 * env);
            break;
          }
          case 9: // thunder: low grey-blue dust stubs (the ring is the leading edge and a ground ring)
            this.addSolid(bx, y0, bz, bx + ox * 0.5, y0 + 0.5 * env, bz + oz * 0.5, 0.17 * Math.min(1, env * 1.4), 0.3, 0.36, 0.58);
            break;
          default: { // force, arcane, psychic, physical: expanding ripple on the tile
            if (k > 0) break;
            const r = CELL * (0.35 + 0.6 * u);
            this.addFlash(cx, y0 + 0.04, cz, r, c[0]! * 0.22 * env, c[1]! * 0.22 * env, c[2]! * 0.3 * env);
            break;
          }
        }
      }
    }
    // The leading edge: a thin bright arc sweeping outward across the affected region (a full ring for a burst).
    const wave = Math.min(1, t / s.waveDur);
    if (wave > 0 && t < s.waveDur + 0.12 && el !== EL_INDEX.lightning) {
      const rad = (0.15 + 0.85 * wave) * (s.maxd + CELL * 0.5);
      const fade = t < s.waveDur ? 1 : Math.max(0, 1 - (t - s.waveDur) / 0.12);
      const full = s.czm >= Math.PI - 1e-3;
      const span = full ? Math.PI : s.czm;
      const N = full ? 16 : 10;
      const y = s.ey + 0.25;
      let px = s.ex + Math.cos(s.cxm - span) * rad;
      let pz = s.ez + Math.sin(s.cxm - span) * rad;
      const f = 0.55 * fade * gain;
      for (let i = 1; i <= N; i++) {
        const a = s.cxm - span + (2 * span * i) / N;
        const nx = s.ex + Math.cos(a) * rad;
        const nz = s.ez + Math.sin(a) * rad;
        this.addSolid(px, y, pz, nx, y, nz, 0.06 * fade, SOLID[3 * el]!, SOLID[3 * el + 1]!, SOLID[3 * el + 2]!);
        this.addSeg(px, y, pz, nx, y, nz, 0.03, c[0]! * f, c[1]! * f, c[2]! * f);
        px = nx;
        pz = nz;
      }
    }
    if (s.ring >= 0) {
      const rg = this.rings[s.ring]!;
      const u = Math.min(1, t / 0.4);
      rg.visible = u < 1;
      rg.position.set(s.ex, s.ey + 0.2, s.ez);
      rg.scale.setScalar(Math.max(0.01, (0.3 + u) * s.maxd + CELL * 0.5));
      const mat = rg.material as MeshBasicMaterial;
      mat.color.setRGB(c[0]!, c[1]!, c[2]!);
      mat.opacity = 0.35 * (1 - u) * gain;
    }
    if (t >= s.waveDur && s.resolve) this.fire(s);
  }

  // ---- aura --------------------------------------------------------------

  private updateAura(s: Slot, dt: number): void {
    const t = s.t;
    const c = PAL.subarray(s.el * 3, s.el * 3 + 3);
    const gain = this.reduced ? 0.6 : 1;
    const h = Math.max(1, s.ey);
    const rnd = Math.random;
    const dens = this.caps.density;
    const u = t / s.dur;
    switch (s.style) {
      case 0: {
        // heal: green-gold motes rising and a soft glow at the chest.
        if (s.emitT <= 0.4 && this.caps.secondary) {
          s.emitT += dt;
          const n = Math.round(2 * dens) + 1;
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2;
            const r = 0.3 + rnd() * 0.35;
            this.sparks.emit(s.sx + Math.cos(a) * r, s.sy + 0.1 + rnd() * 0.3, s.sz + Math.sin(a) * r, 0, 0.9 + rnd() * 0.8, 0, 0.7, rnd() < 0.5 ? c[0]! : 1, c[1]!, rnd() < 0.5 ? c[2]! : 0.4);
          }
        }
        if (t < 0.5) this.addFlash(s.sx, s.sy + 0.08, s.sz, CELL * 0.9, c[0]! * 0.16 * Math.sin(Math.PI * Math.min(1, u / 0.67)) * gain, c[1]! * 0.2 * Math.sin(Math.PI * Math.min(1, u / 0.67)) * gain, c[2]! * 0.12 * gain * Math.sin(Math.PI * Math.min(1, u / 0.67)));
        if (!s.hit) {
          s.hit = true;
          this.glows.emit(s.sx, s.sy + h * 0.55, s.sz, 0, 0.3, 0, 0.6, c[0]! * 0.6, c[1]! * 0.7, c[2]! * 0.5);
        }
        break;
      }
      case 1: {
        // shield: a quick translucent dome.
        if (s.shell >= 0) {
          const sh = this.shells[s.shell]!;
          const e = Math.min(1, t / 0.12);
          const fade = t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.55);
          sh.visible = fade > 0;
          sh.position.set(s.sx, s.sy + 0.05, s.sz);
          sh.scale.set(h * 0.62 * (0.6 + 0.4 * e), h * 0.95 * (0.6 + 0.4 * e), h * 0.62 * (0.6 + 0.4 * e));
          const mat = sh.material as MeshBasicMaterial;
          mat.color.setRGB(0.3, 0.5, 1);
          mat.opacity = 0.2 * fade * gain;
        } else if (!s.hit) {
          s.hit = true;
          this.glows.emit(s.sx, s.sy + h * 0.55, s.sz, 0, 0, 0, 0.5, 0.5, 0.7, 1);
        }
        break;
      }
      case 2: {
        // bless: a gold ring rising from the feet.
        if (s.ring >= 0) {
          const rg = this.rings[s.ring]!;
          rg.visible = u < 1;
          rg.position.set(s.sx, s.sy + 0.1 + u * h, s.sz);
          rg.scale.setScalar(0.85);
          const mat = rg.material as MeshBasicMaterial;
          mat.color.setRGB(c[0]!, c[1]!, c[2]!);
          mat.opacity = 0.65 * Math.sin(Math.PI * Math.min(1, u)) * gain;
        }
        if (s.emitT < 0.4 && this.caps.secondary) {
          s.emitT += dt;
          const a = rnd() * Math.PI * 2;
          this.sparks.emit(s.sx + Math.cos(a) * 0.8, s.sy + u * h, s.sz + Math.sin(a) * 0.8, 0, 0.6, 0, 0.5, c[0]!, c[1]!, c[2]!);
        }
        break;
      }
      case 3:
      case 4: {
        // buff / debuff: shimmer that rises or falls around the body.
        if (s.emitT <= 0.45 && this.caps.secondary) {
          s.emitT += dt;
          const up = s.style === 3;
          const n = Math.round(2 * dens) + 1;
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2;
            this.sparks.emit(s.sx + Math.cos(a) * 0.55, s.sy + (up ? 0.1 : h), s.sz + Math.sin(a) * 0.55, 0, up ? 1.8 : -1.6, 0, 0.55, c[0]!, c[1]!, c[2]!);
          }
        }
        if (!s.hit) {
          s.hit = true;
          this.glows.emit(s.sx, s.sy + h * 0.5, s.sz, 0, 0, 0, 0.4, c[0]! * 0.5, c[1]! * 0.5, c[2]! * 0.5);
        }
        break;
      }
      default: {
        // teleport: a bright vertical streak and sparkle.
        const f = Math.sin(Math.PI * Math.min(1, u)) * gain;
        this.addSeg(s.sx, s.sy, s.sz, s.sx, s.sy + h * 1.5, s.sz, 0.18 * (1 - u * 0.5), c[0]! * f * 0.6, c[1]! * f * 0.6, c[2]! * f * 0.8);
        this.addSeg(s.sx, s.sy, s.sz, s.sx, s.sy + h * 1.5, s.sz, 0.06, f, f, f);
        if (s.emitT < 0.3 && this.caps.secondary) {
          s.emitT += dt;
          for (let i = 0; i < 2; i++) this.sparks.emit(s.sx + (rnd() - 0.5) * 0.7, s.sy + rnd() * h, s.sz + (rnd() - 0.5) * 0.7, 0, 0.6, 0, 0.45, c[0]!, c[1]!, c[2]!);
        }
        break;
      }
    }
    if (t >= 0.25 && s.resolve) this.fire(s);
  }
}

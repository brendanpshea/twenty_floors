import { CanvasTexture, Color, DirectionalLight, FogExp2, HemisphereLight, LinearFilter, PointLight, Scene, SRGBColorSpace, Vector3 } from 'three';
import type { LightPlacement, QualityLevel } from '../core/types';
import type { ThemeLook } from './themeLooks';
import { heroUniforms } from './occlusion';
import { CELL, ENTITY_LIGHT } from './util';

const WHITEC = new Color(1, 1, 1);
const HERO_RADIUS = heroUniforms.uHeroR.value;
/** Far beyond any floor, so the falloff is flat across it. */
const OVERVIEW_HERO_RADIUS = 1e5;
const POOL_BY_QUALITY: Record<QualityLevel, number> = { low: 2, medium: 3, high: 4 };

interface Slot {
  light: PointLight;
  /** Index into `placements` currently assigned, or -1. */
  assigned: number;
  cur: number;
  base: number;
  phase: number;
}

/** A 2x64 vertical gradient, `top` at the top of the screen fading to `horizon` at the bottom (drawn once per floor). */
function makeSkyTexture(horizon: number, top: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 64;
  const g = c.getContext('2d')!;
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, hex(top));
  grad.addColorStop(0.7, hex(horizon));
  grad.addColorStop(1, hex(horizon));
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Hemisphere + one key light + a small pool of real point lights assigned to the nearest placements. */
export class Lighting {
  readonly hemi = new HemisphereLight(0xffffff, 0x333333, 1);
  readonly key = new DirectionalLight(0xffffff, 1);
  private slots: Slot[] = [];
  private placements: LightPlacement[] = [];
  private placementY: Float32Array = new Float32Array(0);
  private look: ThemeLook | null = null;
  private lastTarget = new Vector3(1e9, 0, 0);
  private poolSize = 4;
  private shadows = false;
  private dirty = true;
  private fog = new FogExp2(0, 0.02);
  private tmpColor = new Color();
  private order: number[] = [];
  private dist: Float32Array = new Float32Array(0);
  private keyOffset = new Vector3(-14, 26, 9);
  private overview = false;
  private skyTex: CanvasTexture | null = null;

  constructor(private readonly scene: Scene) {
    scene.add(this.hemi);
    scene.add(this.key);
    scene.add(this.key.target);
    this.key.shadow.mapSize.set(1024, 1024);
    const cam = this.key.shadow.camera;
    cam.left = -16;
    cam.right = 16;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 1;
    cam.far = 70;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.05;
    for (let i = 0; i < 4; i++) {
      const light = new PointLight(0xffffff, 0, 16, 2);
      light.visible = false;
      scene.add(light);
      this.slots.push({ light, assigned: -1, cur: 0, base: 0, phase: i * 1.7 });
    }
    scene.fog = this.fog;
  }

  setLook(look: ThemeLook): void {
    this.look = look;
    this.hemi.color.setHex(look.hemiSky);
    this.hemi.groundColor.setHex(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity * ENTITY_LIGHT;
    this.key.color.setHex(look.keyColor);
    this.key.intensity = look.keyIntensity * ENTITY_LIGHT;
    this.tmpColor.setHex(look.heroColor);
    heroUniforms.uHeroC.value.set(this.tmpColor.r, this.tmpColor.g, this.tmpColor.b).multiplyScalar(look.heroGain);
    this.fog.color.setHex(look.fog);
    this.fog.density = this.overview ? 0 : look.fogDensity;
    this.skyTex?.dispose();
    this.skyTex = null;
    if (look.skyTop !== undefined) this.skyTex = makeSkyTexture(look.fog, look.skyTop);
    this.scene.background = this.skyTex ?? this.tmpColor.setHex(look.fog).clone();
    this.dirty = true;
  }

  setLights(placements: LightPlacement[], groundAt: (x: number, y: number) => number): void {
    this.placements = placements;
    this.placementY = new Float32Array(placements.length);
    placements.forEach((p, i) => (this.placementY[i] = groundAt(p.pos.x, p.pos.y) + 1.5));
    this.dist = new Float32Array(placements.length);
    this.order = placements.map((_, i) => i);
    for (const s of this.slots) {
      s.assigned = -1;
      s.cur = 0;
    }
    this.lastTarget.set(1e9, 0, 0);
    this.dirty = true;
  }

  /**
   * Overview mode shows the whole floor at once: no distance fog, and the soft light that
   * normally surrounds the camera target reaches every cell.
   */
  setOverview(on: boolean): void {
    this.overview = on;
    if (this.look) this.fog.density = on ? 0 : this.look.fogDensity;
    heroUniforms.uHeroR.value = on ? OVERVIEW_HERO_RADIUS : HERO_RADIUS;
  }

  setQuality(q: QualityLevel): void {
    this.poolSize = POOL_BY_QUALITY[q];
    this.shadows = q === 'high';
    this.key.castShadow = this.shadows;
    this.dirty = true;
  }

  get shadowsEnabled(): boolean {
    return this.shadows;
  }

  /** Per-frame: follow the target with the key light, reassign point lights, flicker. */
  update(dt: number, time: number, target: Vector3): void {
    this.key.position.copy(target).add(this.keyOffset);
    this.key.target.position.copy(target);
    this.key.target.updateMatrixWorld();
    heroUniforms.uHeroP.value.set(target.x, target.y, target.z);

    const dx = target.x - this.lastTarget.x;
    const dz = target.z - this.lastTarget.z;
    if (this.dirty || dx * dx + dz * dz > 1.5) {
      this.reassign(target);
      this.dirty = false;
      this.lastTarget.copy(target);
    }
    const k = 1 - Math.exp(-dt * 8);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const active = i < this.poolSize && s.assigned >= 0;
      const want = active ? s.base : 0;
      s.cur += (want - s.cur) * k;
      if (s.cur < 0.01 && !active) {
        s.light.visible = false;
        continue;
      }
      s.light.visible = true;
      const f = 1 + 0.09 * Math.sin(time * 9 + s.phase) + 0.06 * Math.sin(time * 15.7 + s.phase * 2.3);
      s.light.intensity = s.cur * f;
    }
  }

  private reassign(target: Vector3): void {
    const n = this.placements.length;
    const look = this.look;
    if (!look) return;
    for (let i = 0; i < n; i++) {
      const p = this.placements[i]!;
      const dx = p.pos.x * CELL + CELL / 2 - target.x;
      const dz = p.pos.y * CELL + CELL / 2 - target.z;
      // Prefer larger/brighter lights slightly.
      this.dist[i] = (dx * dx + dz * dz) / (0.5 + p.intensity * 0.5);
    }
    const d = this.dist;
    this.order.sort((a, b) => d[a]! - d[b]!);
    const used = new Set<number>();
    // Keep lights already assigned if still within the chosen set, to avoid popping.
    const chosen = this.order.slice(0, Math.min(this.poolSize, n));
    for (const s of this.slots) {
      if (s.assigned >= 0 && chosen.includes(s.assigned)) used.add(s.assigned);
      else s.assigned = -1;
    }
    for (const idx of chosen) {
      if (used.has(idx)) continue;
      const slot = this.slots.find((s) => s.assigned < 0);
      if (!slot) break;
      slot.assigned = idx;
      slot.cur = 0;
      used.add(idx);
    }
    for (const s of this.slots) {
      if (s.assigned < 0) continue;
      const p = this.placements[s.assigned]!;
      s.light.position.set(p.pos.x * CELL + CELL / 2, this.placementY[s.assigned]!, p.pos.y * CELL + CELL / 2);
      s.light.color.setHex(p.color).lerp(WHITEC, 0.35);
      s.light.distance = Math.max(6, p.radius * CELL * 1.3);
      s.base = 3.2 * p.intensity * look.pointGain * (p.radius / 5 + 0.4) * 4;
    }
  }

  dispose(): void {
    this.scene.remove(this.hemi, this.key, this.key.target);
    for (const s of this.slots) {
      this.scene.remove(s.light);
      s.light.dispose();
    }
    this.key.shadow.map?.dispose();
    this.skyTex?.dispose();
    this.hemi.dispose();
    this.key.dispose();
  }
}

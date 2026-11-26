import { Group, NeutralToneMapping, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import type {
  AnimName,
  CellHighlight,
  Faction,
  FloatTextStyle,
  FloorPlan,
  GridPos,
  PickResult,
  QualityLevel,
  Renderer3D,
  Size,
  VisualSpec,
} from '../core/types';
import { CameraRig } from './camera';
import { EntityManager } from './entities';
import { FloatText } from './floatText';
import { buildFloor } from './floorBuilder';
import type { FloorBuild } from './floorBuilder';
import { Fow, timeUniform } from './fow';
import { Highlights } from './highlights';
import { Lighting } from './lighting';
import { Markers } from './markers';
import { ModelCache } from './modelCache';
import { updateOcclusion } from './occlusion';
import { Picker } from './picking';
import type { PickOut } from './picking';
import { buildProps } from './props';
import type { PropField } from './props';
import { LOOKS } from './themeLooks';
import { CELL, STEP } from './util';

const PIXEL_RATIO: Record<QualityLevel, number> = { low: 1, medium: 1.5, high: 2 };

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/** The Renderer3D contract plus a few debug/preview helpers. */
export interface RendererWithDebug extends Renderer3D {
  stats(): RenderStats;
  /** Set the camera orbit directly (radians / world units). */
  setView(v: { yaw?: number; pitch?: number; dist?: number }): void;
  readonly quality: QualityLevel;
  /** CSS pixel (client) coordinates of a cell or entity, or null if it is behind the camera. Not part of Renderer3D. */
  project(at: GridPos | string): { x: number; y: number } | null;
  /** Debug: current yaw (radians), moving flag and cell of an entity. */
  entityInfo(id: string): { yaw: number; targetYaw: number; moving: boolean; cell: GridPos; dead: boolean; baseAnim: string | null } | null;
}

export interface RendererOptions {
  manifestUrl?: string;
  quality?: QualityLevel;
}

class RendererImpl implements RendererWithDebug {
  private readonly gl: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly models: ModelCache;
  private readonly entities: EntityManager;
  private readonly picker: Picker;
  private readonly floats: FloatText;
  private readonly highlights: Highlights;
  private readonly markers = new Markers();
  private readonly entityGroup = new Group();
  private readonly fxGroup = new Group();
  private readonly propsGroup = new Group();
  private floor: FloorBuild | null = null;
  private props: PropField | null = null;
  private fow: Fow | null = null;
  private fowActive = false;
  private plan: FloorPlan | null = null;
  private pickCb: ((p: PickResult) => void) | null = null;
  private hoverCb: ((p: PickResult) => void) | null = null;
  private running = false;
  private raf = 0;
  private lastT = 0;
  private time = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;
  private contextLost = false;
  private hoverPending = false;
  private hoverX = 0;
  private hoverY = 0;
  private hoverInside = false;
  private hoverCell: GridPos | null = null;
  private hoverEntity: string | null = null;
  private pickOut: PickOut = { cell: null, entityId: null };
  private tmpV = new Vector3();
  private cssW = 0;
  private cssH = 0;
  quality: QualityLevel;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: RendererOptions,
  ) {
    this.quality = opts.quality ?? 'medium';
    this.gl = new WebGLRenderer({
      canvas,
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.gl.toneMapping = NeutralToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.shadowMap.autoUpdate = true;

    this.lighting = new Lighting(this.scene);
    this.models = new ModelCache(opts.manifestUrl ?? 'assets/manifest.json');
    this.scene.add(this.propsGroup, this.entityGroup, this.fxGroup, this.markers.group);
    this.entities = new EntityManager({
      group: this.entityGroup,
      groundAt: (x, y) => this.groundAt(x, y),
      models: this.models,
      shadowsOn: () => this.lighting.shadowsEnabled,
    });
    this.rig = new CameraRig(canvas);
    this.picker = new Picker(this.rig.camera, canvas, this.entities);
    this.floats = new FloatText(this.fxGroup);
    this.highlights = new Highlights(this.fxGroup);

    this.rig.heightAt = (x, z) => this.heightAtWorld(x, z);
    this.rig.onTap = (cx, cy) => this.handleTap(cx, cy);
    this.rig.onHover = (cx, cy, inside) => {
      this.hoverX = cx;
      this.hoverY = cy;
      this.hoverInside = inside;
      this.hoverPending = true;
    };
    this.rig.attach();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.applyQuality();
    this.resize();
    this.start();
  }

  // ---- helpers -----------------------------------------------------------

  private groundAt(x: number, y: number): number {
    const f = this.floor;
    const p = this.plan;
    if (!f || !p || x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
    const g = f.groundY[y * p.width + x]!;
    if (g === g) return g;
    return (p.elevation[y * p.width + x] ?? 0) * STEP;
  }

  private heightAtWorld(wx: number, wz: number): number {
    const p = this.plan;
    if (!p) return 0;
    const x = Math.floor(wx / CELL);
    const y = Math.floor(wz / CELL);
    return this.groundAt(Math.min(p.width - 1, Math.max(0, x)), Math.min(p.height - 1, Math.max(0, y)));
  }

  private resize(): void {
    const w = this.canvas.clientWidth || this.canvas.width || 1;
    const h = this.canvas.clientHeight || this.canvas.height || 1;
    this.cssW = w;
    this.cssH = h;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.gl.setPixelRatio(Math.min(dpr, PIXEL_RATIO[this.quality]));
    this.gl.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  private applyQuality(): void {
    const high = this.quality === 'high';
    this.lighting.setQuality(this.quality);
    this.gl.shadowMap.enabled = high;
    if (this.floor) {
      for (const m of this.floor.solids) m.castShadow = false;
      this.floor.floorMaterial.needsUpdate = true;
    }
    this.entities.refreshShadows();
    this.resize();
  }

  // ---- Renderer3D --------------------------------------------------------

  async loadFloor(plan: FloorPlan): Promise<void> {
    this.disposeFloor();
    const look = LOOKS[plan.theme] ?? LOOKS.crypt;
    this.plan = plan;
    const fow = new Fow(plan.width, plan.height);
    this.fow = fow;
    this.fowActive = false;
    const floor = buildFloor(plan, look, fow);
    this.floor = floor;
    this.scene.add(floor.group);
    this.props = buildProps(plan, look, fow, floor.bake, floor.groundY, this.propsGroup);
    this.markers.build(plan, (x, y) => this.groundAt(x, y));
    this.markers.refresh(fow, false);
    this.lighting.setLook(look);
    this.lighting.setLights(plan.lights, (x, y) => this.groundAt(x, y));
    this.rig.setBounds(plan.width, plan.height, CELL);
    this.picker.setFloor(plan.width, plan.height, floor.topH, floor.wallBase);
    this.gl.toneMappingExposure = 1.0;
    this.applyQuality();
    this.entities.refreshGround();
    this.highlights.setGrid(plan.width, plan.height);
    this.highlights.set([], (x, y) => this.groundAt(x, y));
    this.rig.focusOn(plan.entrance.x * CELL + CELL / 2, plan.entrance.y * CELL + CELL / 2, true);
    this.rig.focus.set(plan.entrance.x * CELL + CELL / 2, this.groundAt(plan.entrance.x, plan.entrance.y), plan.entrance.y * CELL + CELL / 2);
  }

  private disposeFloor(): void {
    if (this.props) {
      this.props.dispose();
      this.props = null;
    }
    if (this.floor) {
      this.scene.remove(this.floor.group);
      this.floor.dispose();
      this.floor = null;
    }
    if (this.fow) {
      this.fow.dispose();
      this.fow = null;
    }
  }

  spawnEntity(id: string, visual: VisualSpec, pos: GridPos, opts: { faction: Faction; size: Size }): void {
    this.entities.spawn(id, visual, pos, opts);
  }

  removeEntity(id: string): void {
    this.entities.remove(id);
    if (this.followId === id) this.followEntity(null);
  }

  moveEntity(id: string, path: GridPos[]): Promise<void> {
    return this.entities.move(id, path);
  }

  placeEntity(id: string, pos: GridPos): void {
    this.entities.place(id, pos);
  }

  playAnim(id: string, anim: AnimName, opts?: { facing?: GridPos }): Promise<void> {
    return this.entities.playAnim(id, anim, opts?.facing);
  }

  setEntityState(
    id: string,
    state: { selected?: boolean; targetable?: boolean; hpFraction?: number; dead?: boolean; visible?: boolean },
  ): void {
    this.entities.setState(id, state);
  }

  floatText(at: string | GridPos, text: string, style: FloatTextStyle): void {
    const v = this.tmpV;
    if (typeof at === 'string') {
      if (!this.entities.headPosition(at, v)) return;
    } else {
      v.set(at.x * CELL + CELL / 2, this.groundAt(at.x, at.y) + 1.6, at.y * CELL + CELL / 2);
    }
    this.floats.spawn(v.x, v.y, v.z, text, style);
  }

  setHighlights(cells: CellHighlight[]): void {
    this.highlights.set(cells, (x, y) => this.groundAt(x, y));
  }

  setRevealed(mask: Uint8Array): void {
    if (!this.fow || !this.plan) return;
    this.fow.setMask(mask, this.plan.kinds);
    this.fowActive = true;
    this.markers.refresh(this.fow, true);
  }

  focusCamera(pos: GridPos, opts?: { instant?: boolean }): void {
    this.followId = null;
    this.rig.focusOn(pos.x * CELL + CELL / 2, pos.y * CELL + CELL / 2, !!opts?.instant);
  }

  private followId: string | null = null;
  followEntity(id: string | null): void {
    this.followId = id;
    if (id === null) {
      this.rig.follow = null;
      return;
    }
    this.rig.follow = (out) => this.entities.position(id, out);
  }

  onPick(cb: (pick: PickResult) => void): void {
    this.pickCb = cb;
  }

  onHover(cb: (pick: PickResult) => void): void {
    this.hoverCb = cb;
  }

  setQuality(level: QualityLevel): void {
    if (level === this.quality) return;
    this.quality = level;
    this.applyQuality();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.rig.detach();
    this.resizeObs.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disposeFloor();
    this.entities.dispose();
    this.floats.dispose();
    this.highlights.dispose();
    this.markers.dispose();
    this.lighting.dispose();
    this.models.dispose();
    this.gl.dispose();
  }

  // ---- debug -------------------------------------------------------------

  stats(): RenderStats {
    const i = this.gl.info;
    return {
      fps: this.fps,
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  setView(v: { yaw?: number; pitch?: number; dist?: number }): void {
    this.rig.setView(v, true);
  }

  project(at: GridPos | string): { x: number; y: number } | null {
    const v = this.tmpV;
    if (typeof at === 'string') {
      if (!this.entities.position(at, v)) return null;
      v.y += 0.9;
    } else {
      v.set(at.x * CELL + CELL / 2, this.groundAt(at.x, at.y), at.y * CELL + CELL / 2);
    }
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    v.project(cam);
    if (v.z > 1 || v.z < -1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  entityInfo(id: string): { yaw: number; targetYaw: number; moving: boolean; cell: GridPos; dead: boolean; baseAnim: string | null } | null {
    const e = this.entities.entities.get(id);
    if (!e) return null;
    const a = e.figure.actions;
    const base = e.baseAction && a ? (Object.keys(a).find((k) => a[k as keyof typeof a] === e.baseAction) ?? null) : null;
    return { yaw: e.yaw, targetYaw: e.targetYaw, moving: e.moving, cell: { x: e.cell.x, y: e.cell.y }, dead: e.dead, baseAnim: base };
  }

  // ---- input -------------------------------------------------------------

  private handleTap(cx: number, cy: number): void {
    if (!this.pickCb) return;
    this.picker.pick(cx, cy, this.pickOut);
    this.pickCb({ cell: this.pickOut.cell, entityId: this.pickOut.entityId });
  }

  private processHover(): void {
    this.hoverPending = false;
    let cell: GridPos | null = null;
    let ent: string | null = null;
    if (this.hoverInside) {
      this.picker.pick(this.hoverX, this.hoverY, this.pickOut);
      cell = this.pickOut.cell;
      ent = this.pickOut.entityId;
    }
    const same =
      ent === this.hoverEntity &&
      ((cell === null && this.hoverCell === null) ||
        (cell !== null && this.hoverCell !== null && cell.x === this.hoverCell.x && cell.y === this.hoverCell.y));
    if (same) return;
    this.hoverCell = cell ? { x: cell.x, y: cell.y } : null;
    this.hoverEntity = ent;
    this.hoverCb?.({ cell: this.hoverCell ? { ...this.hoverCell } : null, entityId: ent });
  }

  // ---- loop --------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.contextLost) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.time += dt;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    timeUniform.value = this.time;
    this.rig.update(dt);
    updateOcclusion(this.rig.focus.x, this.rig.focus.z, this.rig.viewYaw, this.rig.viewDist, this.rig.viewPitch);
    this.lighting.update(dt, this.time, this.rig.focus);
    this.fow?.update(dt);
    this.entities.update(dt, this.time, this.rig.camera.quaternion);
    this.floats.update(dt);
    this.highlights.update(this.time);
    this.markers.update(this.time);
    if (this.hoverPending) this.processHover();
    this.gl.render(this.scene, this.rig.camera);
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.lastT = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.resize();
  };
}

export function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions = {}): RendererWithDebug {
  return new RendererImpl(canvas, opts);
}

export type { QualityLevel };

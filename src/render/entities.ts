import {
  CircleGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { AnimationAction, Material, MeshLambertMaterial, Object3D, Quaternion } from 'three';
import type { AnimName, Faction, GridPos, Size, ThemeId, VisualSpec } from '../core/types';
import type { ModelCache } from './modelCache';
import { createStandIn } from './standins';
import type { Figure } from './standins';
import { CELL, angleDiff, clamp } from './util';

/** Walking speed in cells per second. */
const MOVE_CELLS_PER_SEC = 6;

/** Draw scale of procedural stand-ins by Size. Real models carry their size in the manifest scale. */
const SIZE_SCALE: Record<Size, number> = { tiny: 0.5, small: 0.8, medium: 1, large: 1.7, huge: 2.3 };
const RING_SCALE: Record<Size, number> = { tiny: 0.65, small: 0.82, medium: 1, large: 1.2, huge: 1.45 };
const ANIM_DUR: Record<AnimName, number> = { idle: 0, walk: 0, attack: 0.55, hit: 0.42, death: 0.9, cast: 0.85 };

interface MoveJob {
  path: GridPos[];
  resolve: () => void;
}

interface OneShot {
  anim: AnimName;
  t: number;
  dur: number;
  resolve: () => void;
  /** True when a model clip drives this animation. */
  clip: boolean;
  /** False while the entity is still turning toward the target; the animation starts once aligned. */
  started: boolean;
  waitT: number;
}

export class Entity {
  readonly root = new Group();
  readonly body = new Group();
  readonly proxy: Mesh;
  figure: Figure;
  cell: GridPos;
  readonly fp = 1;
  scale = 1;
  yaw = 0;
  targetYaw = 0;
  moveQueue: MoveJob[] = [];
  cur: MoveJob | null = null;
  curIndex = 0;
  segFromX = 0;
  segFromY = 0;
  segFromZ = 0;
  segLen = 0;
  segStarted = false;
  moving = false;
  walkPhase = 0;
  oneShot: OneShot | null = null;
  deathU = 0;
  /** True once a model's death clip has been played to its end (or jumped to it). */
  deathClipDone = false;
  lastShade = 1;
  dead = false;
  chestOpen = 0;
  chestWantOpen = false;
  flash = 0;
  glow = 0;
  lastFlash = -1;
  lastGlow = -1;
  opacity = 1;
  lastOpacity = 1;
  seed: number;
  visible = true;
  selected = false;
  targetable = false;
  hp = 1;
  ring: Mesh | null = null;
  targetRing: Mesh | null = null;
  bar: Group | null = null;
  barFill: Sprite | null = null;
  baseAction: AnimationAction | null = null;
  activeShot: AnimationAction | null = null;
  swapToken = 0;
  height = 1.8;

  constructor(
    readonly id: string,
    readonly faction: Faction,
    readonly size: Size,
    readonly spec: VisualSpec,
    pos: GridPos,
    figure: Figure,
    proxyGeo: CylinderGeometry,
    proxyMat: Material,
  ) {
    this.figure = figure;
    this.cell = { x: pos.x, y: pos.y };
    this.seed = (id.length * 7.31 + id.charCodeAt(0) * 0.37) % 6.28;
    this.body.add(figure.root);
    this.root.add(this.body);
    this.proxy = new Mesh(proxyGeo, proxyMat);
    this.proxy.userData.entityId = id;
    this.root.add(this.proxy);
    this.applyFigureScale();
  }

  /** Scale policy: stand-ins by Size, models by manifest scale (already in the figure) times VisualSpec.scale. */
  applyFigureScale(): void {
    const vs = this.spec.scale ?? 1;
    this.scale = (this.figure.kind === 'model' || this.figure.kind === 'rest' ? 1 : SIZE_SCALE[this.size]) * vs;
    this.height = this.figure.height * this.scale;
    const r = Math.max(0.8, 0.28 * this.height + 0.35);
    const h = Math.max(1.5, this.height + 0.3);
    this.proxy.scale.set(r, h, r);
    this.proxy.position.y = h / 2;
    this.body.scale.setScalar(this.scale);
    if (this.bar) this.bar.position.y = this.height + 0.5;
  }
}

export interface EntityHost {
  group: Group;
  groundAt(x: number, y: number): number;
  models: ModelCache;
  shadowsOn(): boolean;
  theme(): ThemeId;
}

/** Owns all entities: spawning, movement, procedural and clip animation, overlays. */
export class EntityManager {
  readonly entities = new Map<string, Entity>();
  /** Proxy meshes eligible for picking. Rebuilt when entity state changes. */
  readonly pickList: Mesh[] = [];
  private pickDirty = true;
  private proxyGeo = new CylinderGeometry(1, 1, 1, 8);
  private proxyMat = new MeshBasicMaterial({ visible: false });
  private ringGeo = new RingGeometry(0.78, 0.96, 40);
  private blobMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false });
  private blobGeo = new CircleGeometry(0.7, 14).rotateX(-Math.PI / 2);
  /** All contact shadows in one instanced draw (used when real shadows are off). */
  private blobs = new InstancedMesh(this.blobGeo, this.blobMat, 128);
  private selMat = new MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.95, depthWrite: false });
  private tgtMat = new MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.9, depthWrite: false });
  private barBgMat = new SpriteMaterial({ color: 0x120c0c, transparent: true, opacity: 0.85, depthTest: false, fog: false });
  private barMats = [0xe24a3a, 0xe2b83a, 0x5ad05a].map(
    (c) => new SpriteMaterial({ color: c, transparent: true, depthTest: false, fog: false }),
  );
  private time = 0;

  constructor(private readonly host: EntityHost) {
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    this.blobs.instanceMatrix.setUsage(DynamicDrawUsage);
    host.group.add(this.blobs);
  }

  private updateBlobs(): void {
    const arr = this.blobs.instanceMatrix.array as Float32Array;
    let n = 0;
    if (!this.host.shadowsOn()) {
      for (const e of this.entities.values()) {
        if (!e.visible || n >= 128 || e.figure.kind === 'rest') continue;
        const sc = Math.max(0.6, e.height * 0.33) * (0.5 + 0.5 * e.lastOpacity);
        const o = n * 16;
        arr[o] = sc; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sc; arr[o + 11] = 0;
        arr[o + 12] = e.root.position.x;
        arr[o + 13] = e.root.position.y + 0.06;
        arr[o + 14] = e.root.position.z;
        arr[o + 15] = 1;
        n++;
      }
    }
    this.blobs.count = n;
    this.blobs.visible = n > 0;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  // ---- lifecycle ---------------------------------------------------------

  spawn(id: string, visual: VisualSpec, pos: GridPos, opts: { faction: Faction; size: Size }): void {
    if (this.entities.has(id)) this.remove(id);
    const fig = createStandIn(visual.model, visual.tint, opts.faction, this.host.theme());
    const e = new Entity(id, opts.faction, opts.size, visual, pos, fig, this.proxyGeo, this.proxyMat);
    this.setCastShadow(e);
    this.entities.set(id, e);
    this.host.group.add(e.root);
    this.snapToCell(e);
    this.pickDirty = true;

    const token = ++e.swapToken;
    void this.host.models.create(visual.model, visual.tint).then((model) => {
      if (!model) return;
      const cur = this.entities.get(id);
      if (cur !== e || e.swapToken !== token) {
        model.dispose();
        return;
      }
      this.swapFigure(e, model);
    });
  }

  private swapFigure(e: Entity, model: Figure): void {
    e.body.remove(e.figure.root);
    e.figure.dispose();
    e.figure = model;
    e.body.add(model.root);
    e.baseAction = null;
    e.activeShot = null;
    e.applyFigureScale();
    if (model.mixer) {
      model.mixer.addEventListener('finished', (ev) => {
        const act = (ev as unknown as { action: AnimationAction }).action;
        if (act === e.activeShot && e.oneShot) {
          // death clamps; others return to base
          if (e.oneShot.anim !== 'death') this.returnToBase(e);
          this.finishOneShot(e);
        }
      });
    }
    if (e.dead) {
      e.deathU = 1;
      e.deathClipDone = false;
      this.holdDeathPose(e);
    } else this.refreshBaseAction(e);
    this.setCastShadow(e);
    this.setFlashOpacity(e, true);
  }

  private setCastShadow(e: Entity): void {
    const on = this.host.shadowsOn();
    e.figure.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh) m.castShadow = on;
    });
  }

  refreshShadows(): void {
    for (const e of this.entities.values()) this.setCastShadow(e);
  }

  remove(id: string): void {
    const e = this.entities.get(id);
    if (!e) return;
    this.resolveAll(e);
    this.host.group.remove(e.root);
    e.figure.dispose();
    this.entities.delete(id);
    this.pickDirty = true;
  }

  private resolveAll(e: Entity): void {
    if (e.cur) e.cur.resolve();
    e.cur = null;
    for (const j of e.moveQueue) j.resolve();
    e.moveQueue.length = 0;
    this.finishOneShot(e);
    e.moving = false;
  }

  clear(): void {
    for (const id of [...this.entities.keys()]) this.remove(id);
  }

  dispose(): void {
    this.clear();
    this.proxyGeo.dispose();
    this.proxyMat.dispose();
    this.ringGeo.dispose();
    this.host.group.remove(this.blobs);
    this.blobs.dispose();
    this.blobGeo.dispose();
    this.selMat.dispose();
    this.tgtMat.dispose();
    this.blobMat.dispose();
    this.barBgMat.dispose();
    for (const m of this.barMats) m.dispose();
  }

  // ---- placement and movement -------------------------------------------

  private worldX(e: Entity, cx: number): number {
    return cx * CELL + CELL / 2;
  }
  private worldZ(e: Entity, cy: number): number {
    return cy * CELL + CELL / 2;
  }

  private snapToCell(e: Entity): void {
    e.root.position.set(this.worldX(e, e.cell.x), this.host.groundAt(e.cell.x, e.cell.y), this.worldZ(e, e.cell.y));
  }

  /** Re-snap everything to the (possibly new) floor heights. */
  refreshGround(): void {
    for (const e of this.entities.values()) if (!e.cur) this.snapToCell(e);
  }

  place(id: string, pos: GridPos): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.cur) e.cur.resolve();
    e.cur = null;
    for (const j of e.moveQueue) j.resolve();
    e.moveQueue.length = 0;
    e.moving = false;
    e.cell = { x: pos.x, y: pos.y };
    this.snapToCell(e);
  }

  move(id: string, path: GridPos[]): Promise<void> {
    const e = this.entities.get(id);
    if (!e || path.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      e.moveQueue.push({ path: path.map((p) => ({ x: p.x, y: p.y })), resolve });
    });
  }

  face(id: string, cell: GridPos): void {
    const e = this.entities.get(id);
    if (!e) return;
    this.faceCell(e, cell);
  }

  private faceCell(e: Entity, cell: GridPos): void {
    const dx = this.worldX(e, cell.x) - e.root.position.x;
    const dz = this.worldZ(e, cell.y) - e.root.position.z;
    if (dx * dx + dz * dz > 1e-4) e.targetYaw = Math.atan2(dx, dz);
  }

  // ---- animation ---------------------------------------------------------

  playAnim(id: string, anim: AnimName, facing?: GridPos): Promise<void> {
    const e = this.entities.get(id);
    if (!e) return Promise.resolve();
    if (facing) this.faceCell(e, facing);
    if (anim === 'idle' || anim === 'walk') {
      this.finishOneShot(e);
      return Promise.resolve();
    }
    if (e.dead && anim !== 'death') return Promise.resolve();
    this.finishOneShot(e);
    if (anim === 'death') {
      e.dead = true;
      this.pickDirty = true;
    }
    const isChest = e.figure.kind === 'chest';
    if (isChest && (anim === 'attack' || anim === 'cast')) e.chestWantOpen = true;
    const clipAct = e.figure.actions?.[anim];
    const dur = clipAct ? Math.min(3, clipAct.getClip().duration) : e.figure.kind === 'rest' ? 1.2 : ANIM_DUR[anim];
    const needTurn = !!facing && anim !== 'death' && Math.abs(angleDiff(e.yaw, e.targetYaw)) > 0.3;
    return new Promise<void>((resolve) => {
      e.oneShot = { anim, t: 0, dur, resolve, clip: !!clipAct, started: !needTurn, waitT: 0 };
      if (!needTurn && clipAct) this.playClip(e, anim);
      if (anim === 'hit') e.flash = 1;
    });
  }

  private playClip(e: Entity, anim: AnimName): void {
    const act = e.figure.actions?.[anim];
    if (!act) return;
    if (e.baseAction && e.baseAction !== act) e.baseAction.fadeOut(0.1);
    act.reset().fadeIn(0.08).play();
    e.activeShot = act;
  }

  private returnToBase(e: Entity): void {
    if (e.activeShot) e.activeShot.fadeOut(0.12);
    e.activeShot = null;
    this.refreshBaseAction(e, true);
  }

  private refreshBaseAction(e: Entity, fade = false): void {
    const want = e.figure.actions?.[e.moving && e.figure.actions.walk ? 'walk' : 'idle'] ?? null;
    if (want === e.baseAction && want && want.isRunning()) return;
    if (e.baseAction && e.baseAction !== want) e.baseAction.fadeOut(0.15);
    e.baseAction = want;
    if (want) {
      want.reset();
      if (fade) want.fadeIn(0.15);
      want.play();
    }
  }

  private finishOneShot(e: Entity): void {
    const s = e.oneShot;
    if (!s) return;
    e.oneShot = null;
    if (s.anim === 'death') {
      e.deathU = 1;
      e.deathClipDone = true;
      if (!e.figure.actions?.death && e.figure.mixer) e.figure.mixer.timeScale = 0;
    }
    s.resolve();
  }

  setState(
    id: string,
    st: { selected?: boolean; targetable?: boolean; hpFraction?: number; dead?: boolean; visible?: boolean },
  ): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (st.visible !== undefined) {
      e.visible = st.visible;
      e.root.visible = st.visible;
      this.pickDirty = true;
    }
    if (st.selected !== undefined && st.selected !== e.selected) {
      e.selected = st.selected;
      if (st.selected && !e.ring) {
        e.ring = new Mesh(this.ringGeo, this.selMat);
        e.ring.rotation.x = -Math.PI / 2;
        e.ring.position.y = 0.1;
        e.ring.renderOrder = 3;
        e.ring.scale.setScalar(this.ringScale(e));
        e.root.add(e.ring);
      }
      if (e.ring) e.ring.visible = st.selected;
    }
    if (st.targetable !== undefined && st.targetable !== e.targetable) {
      e.targetable = st.targetable;
      if (st.targetable && !e.targetRing) {
        e.targetRing = new Mesh(this.ringGeo, this.tgtMat);
        e.targetRing.rotation.x = -Math.PI / 2;
        e.targetRing.position.y = 0.11;
        e.targetRing.renderOrder = 3;
        e.targetRing.scale.setScalar(this.ringScale(e) * 1.12);
        e.root.add(e.targetRing);
      }
      if (e.targetRing) e.targetRing.visible = st.targetable;
    }
    if (st.hpFraction !== undefined) this.setHp(e, st.hpFraction);
    if (st.dead !== undefined && st.dead !== e.dead) {
      e.dead = st.dead;
      if (st.dead) {
        if (!e.oneShot || e.oneShot.anim !== 'death') {
          this.finishOneShot(e);
          e.deathU = 1;
          this.holdDeathPose(e);
        }
      } else {
        e.deathU = 0;
        e.deathClipDone = false;
        if (e.figure.mixer) e.figure.mixer.timeScale = 1;
        if (e.activeShot) e.activeShot.stop();
        e.activeShot = null;
        this.refreshBaseAction(e);
      }
      this.pickDirty = true;
    }
  }

  /** Put a model into the last frame of its death clip (without replaying it), or freeze it for the procedural topple. */
  private holdDeathPose(e: Entity): void {
    const act = e.figure.actions?.death;
    if (act) {
      if (!e.deathClipDone || !act.isRunning()) {
        if (e.baseAction) e.baseAction.stop();
        e.baseAction = null;
        act.reset();
        act.setEffectiveWeight(1);
        act.play();
        act.time = act.getClip().duration;
        e.activeShot = act;
      }
      e.deathClipDone = true;
    } else if (e.figure.mixer) {
      e.figure.mixer.timeScale = 0;
    }
  }

  private ringScale(e: Entity): number {
    return RING_SCALE[e.size];
  }

  private setHp(e: Entity, frac: number): void {
    e.hp = clamp(frac, 0, 1);
    const show = e.hp < 1 && e.hp > 0 && !e.dead;
    if (!e.bar && show) {
      const bar = new Group();
      const bg = new Sprite(this.barBgMat);
      bg.scale.set(1.08, 0.17, 1);
      bg.renderOrder = 10;
      const fill = new Sprite(this.barMats[2]!);
      fill.center.set(0, 0.5);
      fill.position.set(-0.5, 0, 0);
      fill.renderOrder = 11;
      bar.add(bg, fill);
      bar.position.y = e.height + 0.5;
      e.bar = bar;
      e.barFill = fill;
      e.root.add(bar);
    }
    if (e.bar && e.barFill) {
      e.bar.visible = show;
      e.barFill.scale.set(Math.max(0.001, e.hp), 0.11, 1);
      e.barFill.material = this.barMats[e.hp > 0.5 ? 2 : e.hp > 0.25 ? 1 : 0]!;
    }
  }

  // ---- queries -----------------------------------------------------------

  /** World position a bit above an entity's head, for floating text. */
  headPosition(id: string, out: { x: number; y: number; z: number }): boolean {
    const e = this.entities.get(id);
    if (!e) return false;
    out.x = e.root.position.x;
    out.y = e.root.position.y + e.height + 0.9;
    out.z = e.root.position.z;
    return true;
  }

  position(id: string, out: { x: number; y: number; z: number }): boolean {
    const e = this.entities.get(id);
    if (!e) return false;
    out.x = e.root.position.x;
    out.y = e.root.position.y;
    out.z = e.root.position.z;
    return true;
  }

  rebuildPickList(): void {
    if (!this.pickDirty) return;
    this.pickDirty = false;
    this.pickList.length = 0;
    for (const e of this.entities.values()) if (e.visible && !e.dead) this.pickList.push(e.proxy);
  }

  // ---- per frame ---------------------------------------------------------

  update(dt: number, time: number, camQuat: Quaternion): void {
    this.time = time;
    // shared overlay pulses
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    this.tgtMat.color.setRGB(1, 0.3 + 0.35 * pulse, 0.18 + 0.1 * pulse);
    this.tgtMat.opacity = 0.65 + 0.35 * pulse;
    this.selMat.opacity = 0.8 + 0.15 * Math.sin(time * 3);
    for (const e of this.entities.values()) {
      this.updateMovement(e, dt);
      if (e.figure.mixer) e.figure.mixer.update(dt);
      this.updatePose(e, dt, time);
      if (e.bar) e.bar.quaternion.copy(camQuat);
    }
    this.updateBlobs();
  }

  private updateMovement(e: Entity, dt: number): void {
    if (!e.cur && e.moveQueue.length > 0) {
      e.cur = e.moveQueue.shift()!;
      e.curIndex = 0;
      e.segStarted = false;
    }
    e.moving = false;
    if (e.cur) {
      let remain = MOVE_CELLS_PER_SEC * CELL * dt;
      const pos = e.root.position;
      let guard = 0;
      while (remain > 0 && e.cur && guard++ < 16) {
        const job = e.cur;
        const cell = job.path[e.curIndex];
        if (!cell) {
          this.finishMove(e);
          break;
        }
        const tx = this.worldX(e, cell.x);
        const tz = this.worldZ(e, cell.y);
        const ty = this.host.groundAt(cell.x, cell.y);
        if (!e.segStarted) {
          e.segFromX = pos.x;
          e.segFromY = pos.y;
          e.segFromZ = pos.z;
          e.segLen = Math.hypot(tx - pos.x, tz - pos.z);
          e.segStarted = true;
          if (e.segLen > 0.01) e.targetYaw = Math.atan2(tx - pos.x, tz - pos.z);
        }
        const dx = tx - pos.x;
        const dz = tz - pos.z;
        const dist = Math.hypot(dx, dz);
        e.moving = true;
        if (dist <= remain) {
          pos.set(tx, ty, tz);
          remain -= dist;
          e.cell.x = cell.x;
          e.cell.y = cell.y;
          e.curIndex++;
          e.segStarted = false;
          if (e.curIndex >= job.path.length) {
            this.finishMove(e);
            // start the next queued job within the same frame budget
            if (e.moveQueue.length > 0) {
              e.cur = e.moveQueue.shift()!;
              e.curIndex = 0;
            }
          }
        } else {
          const k = remain / dist;
          pos.x += dx * k;
          pos.z += dz * k;
          const prog = e.segLen > 0 ? 1 - (dist - remain) / e.segLen : 1;
          pos.y = e.segFromY + (ty - e.segFromY) * clamp(prog, 0, 1);
          remain = 0;
        }
      }
    }
    if (e.moving) e.walkPhase += dt * MOVE_CELLS_PER_SEC * 1.9;
    // smooth yaw
    const dy = angleDiff(e.yaw, e.targetYaw);
    e.yaw += dy * (1 - Math.exp(-dt * 18));
    e.body.rotation.y = e.yaw;
    if (e.figure.actions && e.figure.mixer) {
      const wantWalk = e.moving && !!e.figure.actions.walk;
      const isWalk = e.baseAction === e.figure.actions.walk && !!e.baseAction;
      if (!e.oneShot && !e.dead && wantWalk !== isWalk) this.refreshBaseAction(e, true);
    }
  }

  private finishMove(e: Entity): void {
    const job = e.cur;
    e.cur = null;
    e.segStarted = false;
    if (job) {
      // Snap to the final cell so the entity never rests mid-air.
      const last = job.path[job.path.length - 1];
      if (last) {
        e.cell.x = last.x;
        e.cell.y = last.y;
        e.root.position.set(this.worldX(e, last.x), this.host.groundAt(last.x, last.y), this.worldZ(e, last.y));
      }
      job.resolve();
    }
  }

  private updatePose(e: Entity, dt: number, time: number): void {
    const f = e.figure;
    if (f.kind === 'rest') {
      // Rest sites animate themselves; no corpse darkening, fade or topple when spent.
      const s = e.oneShot;
      let castU = -1;
      if (s) {
        s.started = true;
        s.t += dt;
        if (s.anim === 'cast' || s.anim === 'attack') castU = Math.min(1, s.t / s.dur);
        if (s.t >= s.dur) this.finishOneShot(e);
      }
      f.tick?.(time, castU, e.dead);
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 3);
      return;
    }
    const P = f.parts;
    const pending = e.oneShot;
    if (pending && !pending.started) {
      pending.waitT += dt;
      if (Math.abs(angleDiff(e.yaw, e.targetYaw)) < 0.25 || pending.waitT > 0.45) {
        pending.started = true;
        if (pending.clip) this.playClip(e, pending.anim);
      }
    }
    const shot = pending && pending.started ? pending : null;
    let u = 0;
    if (shot) {
      shot.t += dt;
      u = shot.dur > 0 ? clamp(shot.t / shot.dur, 0, 1) : 1;
    }
    const proc = !shot || !shot.clip; // procedural body motion for this frame
    const t = time + e.seed;
    let bobY = 0;
    let offZ = 0;
    let rotX = 0;
    let rotZ = 0;
    let sy = 1;
    let sxz = 1;
    let armL = -0.12;
    let armR = -0.22;
    let legL = 0;
    let legR = 0;
    let headX = 0;
    let flash = e.flash;
    let glow = 0;
    let opacity = 1;
    let shade = 1;

    const clipBase = !!e.baseAction;
    const kind = f.kind;
    if (!e.dead && !(shot && shot.anim === 'death')) {
      if (e.moving) {
        if (!clipBase || !e.figure.actions?.walk) {
          const s = Math.sin(e.walkPhase);
          bobY = Math.abs(s) * (kind === 'blob' ? 0.14 : 0.11);
          rotX = 0.07;
          legL = s * 0.85;
          legR = -s * 0.85;
          armL = -0.12 - s * 0.6;
          armR = -0.22 + s * 0.6;
          if (kind === 'blob') {
            sy = 1 + s * 0.1;
            sxz = 1 - s * 0.05;
          }
          if (kind === 'beast') headX = Math.sin(e.walkPhase * 2) * 0.1;
        }
      } else if (!clipBase) {
        const s = Math.sin(t * 2.2);
        bobY = s * 0.018;
        sy = 1 + s * 0.012;
        armR = -0.22 + Math.sin(t * 2.2 + 1) * 0.04;
        armL = -0.12 - Math.sin(t * 2.2) * 0.03;
        if (kind === 'blob') {
          sy = 1 + s * 0.05;
          sxz = 1 - s * 0.025;
        }
      }
    }

    if (shot && proc) {
      switch (shot.anim) {
        case 'attack': {
          const w = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
          const lunge = Math.sin(Math.PI * clamp(u * 1.15, 0, 1));
          offZ = lunge * 0.55;
          armR = -0.22 - 2.5 * (u < 0.35 ? w : w * w) + (u > 0.35 ? 0.9 * Math.sin(((u - 0.35) / 0.65) * Math.PI) : 0);
          armL = -0.5 * w;
          rotX = 0.18 * lunge;
          legL = 0.4 * lunge;
          legR = -0.3 * lunge;
          if (kind === 'beast') {
            headX = 0.7 * lunge;
            bobY = 0.1 * lunge;
          }
          if (kind === 'blob') {
            sy = 1 - 0.25 * lunge;
            sxz = 1 + 0.15 * lunge;
          }
          break;
        }
        case 'hit': {
          const k = Math.sin(Math.PI * u);
          offZ = -0.32 * k;
          rotX = -0.3 * k;
          rotZ = Math.sin(u * 28) * 0.07 * (1 - u);
          armL = armR = -0.9 * k;
          flash = Math.max(flash, 1 - u);
          if (kind === 'blob') {
            sy = 1 - 0.3 * k;
            sxz = 1 + 0.2 * k;
          }
          break;
        }
        case 'cast': {
          const env = u < 0.3 ? u / 0.3 : u > 0.78 ? (1 - u) / 0.22 : 1;
          const eased = env * env * (3 - 2 * env);
          armL = armR = -0.2 - 2.4 * eased;
          bobY = 0.12 * eased;
          glow = 0.8 * Math.sin(Math.PI * u);
          if (kind === 'blob') sy = 1 + 0.25 * eased;
          break;
        }
        case 'death': {
          break;
        }
        default:
          break;
      }
    }

    // Death pose (animated or held).
    const dying = shot && shot.anim === 'death';
    if (dying || e.dead) {
      let k = 1;
      if (dying && shot) k = u;
      else k = e.deathU;
      const ease = 1 - (1 - k) * (1 - k);
      if (proc && !(f.actions?.death)) {
        if (kind === 'blob') {
          sy = 1 - 0.8 * ease;
          sxz = 1 + 0.35 * ease;
        } else if (kind === 'beast') {
          rotZ = Math.PI * 0.5 * ease;
          bobY = 0.3 * ease;
          legL = 0.6 * ease;
          legR = -0.5 * ease;
        } else if (kind === 'chest') {
          // chests do not die
        } else {
          rotX = -Math.PI * 0.5 * ease;
          bobY = 0.16 * ease;
          armL = -0.2 + 1.2 * ease;
          armR = -0.22 - 0.8 * ease;
          offZ = -0.1 * ease;
        }
      }
      shade = 1 - 0.5 * ease;
      if ((f.baseOpacity ?? 1) < 1) opacity = 1 - 0.35 * ease;
      flash = Math.max(flash, (1 - k) * 0.6);
      if (dying && shot && shot.t >= shot.dur) {
        e.deathU = 1;
        this.finishOneShot(e);
      }
    } else if (shot && shot.t >= shot.dur && !shot.clip) {
      this.finishOneShot(e);
    } else if (shot && shot.clip && shot.t >= shot.dur + 0.5) {
      // safety net if a 'finished' event never arrives
      if (shot.anim !== 'death') this.returnToBase(e);
      this.finishOneShot(e);
    }

    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 3);
    if (e.chestWantOpen) e.chestOpen = Math.min(1, e.chestOpen + dt * 2.2);

    // apply
    const b = e.body;
    const base = e.scale;
    b.position.set(0, bobY, 0);
    b.rotation.x = rotX;
    b.rotation.z = rotZ;
    b.scale.set(base * sxz, base * sy, base * sxz);
    if (offZ !== 0) {
      // lunge along the facing direction (body yaw already rotates local z)
      b.position.x = Math.sin(e.yaw) * offZ;
      b.position.z = Math.cos(e.yaw) * offZ;
    }
    if (P.armL) P.armL.rotation.x = armL;
    if (P.armR) P.armR.rotation.x = armR;
    if (P.legL) P.legL.rotation.x = legL;
    if (P.legR) P.legR.rotation.x = legR;
    if (P.head && kind === 'beast') P.head.rotation.x = headX;
    if (P.lid) P.lid.rotation.x = -1.75 * e.chestOpen;

    // Selection / state overlays follow the ground, not the animation.
    if (e.bar) {
      // Billboard sprites need no orientation; keep the bar above the head.
      e.bar.position.y = e.height + 0.5;
    }

    this.setFlashOpacity(e, false, flash, glow, opacity, shade);
  }

  private setFlashOpacity(e: Entity, force: boolean, flash = e.lastFlash < 0 ? 0 : e.lastFlash, glow = e.lastGlow < 0 ? 0 : e.lastGlow, opacity = e.lastOpacity, shade = e.lastShade): void {
    const changedFx = force || Math.abs(flash - e.lastFlash) > 0.01 || Math.abs(glow - e.lastGlow) > 0.01;
    if (changedFx) {
      e.lastFlash = flash;
      e.lastGlow = glow;
      for (const m of e.figure.materials) {
        const em = (m as MeshLambertMaterial).emissive;
        if (em) em.setRGB(flash + glow * 0.3, flash * 0.18 + glow * 0.55, flash * 0.12 + glow * 0.9);
      }
    }
    if (force || Math.abs(shade - e.lastShade) > 0.005) {
      e.lastShade = shade;
      for (const m of e.figure.materials) {
        const c = (m as MeshLambertMaterial).color;
        if (!c) continue;
        const ud = m.userData as { baseColor?: { r: number; g: number; b: number } };
        if (!ud.baseColor) ud.baseColor = { r: c.r, g: c.g, b: c.b };
        c.setRGB(ud.baseColor.r * shade, ud.baseColor.g * shade, ud.baseColor.b * shade);
      }
    }
    if (force || Math.abs(opacity - e.lastOpacity) > 0.005) {
      e.lastOpacity = opacity;
      const base = e.figure.baseOpacity ?? 1;
      for (const m of e.figure.materials) {
        const wantT = opacity * base < 0.999;
        if (m.transparent !== wantT) {
          m.transparent = wantT;
          m.needsUpdate = true;
        }
        m.opacity = opacity * base;
        m.depthWrite = base >= 1 && (!wantT || opacity > 0.6);
      }
    }
  }

  get currentTime(): number {
    return this.time;
  }
}

import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { angleDiff, clamp } from './util';

const PITCH_MIN = MathUtils.degToRad(35);
const PITCH_MAX = MathUtils.degToRad(80);
const DIST_MIN = 8;
const DIST_MAX = 40;
const TAP_SLOP = 8;
/** Overview looks almost straight down; a hair off vertical keeps lookAt's up vector stable. */
const OVERVIEW_PITCH = MathUtils.degToRad(88);
const FAR = 160;

interface Ptr {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  type: string;
  button: number;
  moved: boolean;
}

type Gesture = 'none' | 'pan' | 'rotate' | 'multi';

/**
 * Orbit camera around a ground target: pitch/distance clamped, smooth damping,
 * mouse and touch gestures, keyboard. Reports taps and hover as client coordinates.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(40, 1, 0.5, FAR);
  /** Desired target (ground point). */
  readonly target = new Vector3();
  /** Smoothed target actually looked at. */
  readonly focus = new Vector3();
  yaw = 0.55;
  pitch = MathUtils.degToRad(55);
  dist = 22;
  get viewYaw(): number {
    return this.cYaw;
  }
  get viewDist(): number {
    return this.cDist;
  }
  get viewPitch(): number {
    return this.cPitch;
  }
  private cYaw = this.yaw;
  private cPitch = this.pitch;
  private cDist = this.dist;
  private distMax = DIST_MAX;
  private pitchMax = PITCH_MAX;
  /** The view to return to when the overview is switched off; null while it is off. */
  private beforeOverview: { yaw: number; pitch: number; dist: number; x: number; z: number; follow: CameraRig['follow'] } | null = null;
  private boundsX = 48;
  private boundsZ = 48;
  heightAt: (x: number, z: number) => number = () => 0;
  /** Writes the followed position into `out`; returns false if nothing to follow. */
  follow: ((out: Vector3) => boolean) | null = null;
  onTap: ((clientX: number, clientY: number) => void) | null = null;
  onHover: ((clientX: number, clientY: number, inside: boolean) => void) | null = null;

  private ptrs = new Map<number, Ptr>();
  private gesture: Gesture = 'none';
  private tapCandidate = false;
  private pinchDist = 0;
  private pinchAng = 0;
  private pinchX = 0;
  private pinchY = 0;
  private keys = new Set<string>();
  private tmp = new Vector3();
  private shakeAmp = 0;
  private attached = false;
  private snapNext = true;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  setBounds(widthCells: number, heightCells: number, cell: number): void {
    this.boundsX = widthCells * cell;
    this.boundsZ = heightCells * cell;
    if (this.beforeOverview) this.fitOverview();
  }

  get overview(): boolean {
    return this.beforeOverview !== null;
  }

  /**
   * Whole-floor view for reviewing layouts: looks straight down from far enough to frame the
   * floor, north up. Pan, zoom and rotate still work (zoom stops at the framing distance).
   * Switching it off restores the view and follow target it replaced.
   */
  setOverview(on: boolean): void {
    if (on === this.overview) return;
    if (on) {
      this.beforeOverview = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, x: this.target.x, z: this.target.z, follow: this.follow };
      this.follow = null;
      this.pitchMax = OVERVIEW_PITCH;
      this.fitOverview();
    } else {
      const b = this.beforeOverview;
      this.beforeOverview = null;
      this.distMax = DIST_MAX;
      this.pitchMax = PITCH_MAX;
      this.camera.far = FAR;
      this.camera.updateProjectionMatrix();
      if (b) {
        this.yaw = b.yaw;
        this.pitch = b.pitch;
        this.dist = b.dist;
        this.target.set(b.x, 0, b.z);
        // A follow target chosen while in overview wins over the one saved on the way in.
        this.follow = this.follow ?? b.follow;
      }
    }
    this.snapNext = true;
  }

  /** Centre on the floor and back off until both its width and its depth fit the viewport. */
  private fitOverview(): void {
    const t = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const fit = Math.max(this.boundsZ / 2 / t, this.boundsX / 2 / (t * this.camera.aspect)) * 1.05;
    this.distMax = Math.max(DIST_MAX, fit);
    this.dist = this.distMax;
    this.yaw = 0;
    this.pitch = OVERVIEW_PITCH;
    this.target.set(this.boundsX / 2, 0, this.boundsZ / 2);
    this.camera.far = Math.max(FAR, this.distMax * 1.5);
    this.camera.updateProjectionMatrix();
    this.snapNext = true;
  }

  /** Jump or ease to a world position. */
  focusOn(x: number, z: number, instant: boolean): void {
    this.target.set(x, 0, z);
    this.clampTarget();
    this.follow = null;
    if (instant) this.snapNext = true;
  }

  setView(v: { yaw?: number; pitch?: number; dist?: number }, instant = true): void {
    if (v.yaw !== undefined) this.yaw = v.yaw;
    if (v.pitch !== undefined) this.pitch = clamp(v.pitch, PITCH_MIN, this.pitchMax);
    if (v.dist !== undefined) this.dist = clamp(v.dist, DIST_MIN, this.distMax);
    if (instant) this.snapNext = true;
  }

  private clampTarget(): void {
    this.target.x = clamp(this.target.x, 0, this.boundsX);
    this.target.z = clamp(this.target.z, 0, this.boundsZ);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.beforeOverview) this.fitOverview();
  }

  // ---- input -------------------------------------------------------------

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.ptrs.clear();
    this.keys.clear();
  }

  private onContext = (e: Event): void => e.preventDefault();

  private onDown = (e: PointerEvent): void => {
    if (e.target !== this.canvas) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p: Ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, button: e.button, moved: false };
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) {
      this.tapCandidate = e.button === 0;
      this.gesture = e.button === 0 ? 'pan' : 'rotate';
    } else {
      this.tapCandidate = false;
      this.beginMulti();
    }
    e.preventDefault();
  };

  private beginMulti(): void {
    this.gesture = 'multi';
    const [a, b] = this.firstTwo();
    if (!a || !b) return;
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.pinchAng = Math.atan2(b.y - a.y, b.x - a.x);
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
    a.moved = b.moved = true;
  }

  private firstTwo(): [Ptr | undefined, Ptr | undefined] {
    let a: Ptr | undefined;
    let b: Ptr | undefined;
    for (const p of this.ptrs.values()) {
      if (!a) a = p;
      else if (!b) {
        b = p;
        break;
      }
    }
    return [a, b];
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && this.onHover) this.onHover(e.clientX, e.clientY, true);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.gesture === 'multi' && this.ptrs.size >= 2) {
      const [a, b] = this.firstTwo();
      if (!a || !b) return;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.dist = clamp(this.dist * (this.pinchDist / d), DIST_MIN, this.distMax);
      this.yaw += angleDiff(this.pinchAng, ang);
      this.panPixels(mx - this.pinchX, my - this.pinchY);
      this.pinchDist = d;
      this.pinchAng = ang;
      this.pinchX = mx;
      this.pinchY = my;
      return;
    }
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > TAP_SLOP) {
        p.moved = true;
        this.tapCandidate = false;
      }
      return;
    }
    if (this.gesture === 'pan') this.panPixels(dx, dy);
    else if (this.gesture === 'rotate') {
      this.yaw -= dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.004, PITCH_MIN, this.pitchMax);
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.ptrs.size === 0) {
      if (this.tapCandidate && !p.moved && p.button === 0 && this.onTap) this.onTap(e.clientX, e.clientY);
      this.tapCandidate = false;
      this.gesture = 'none';
    } else if (this.ptrs.size === 1) {
      // Back to one finger after a pinch: keep panning, never tap.
      for (const q of this.ptrs.values()) {
        q.moved = true;
        q.sx = q.x;
        q.sy = q.y;
      }
      this.gesture = 'pan';
      this.tapCandidate = false;
    } else {
      this.beginMulti();
    }
  };

  private onCancel = (e: PointerEvent): void => {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size === 0) {
      this.gesture = 'none';
      this.tapCandidate = false;
    } else if (this.ptrs.size === 1) {
      this.gesture = 'pan';
      this.tapCandidate = false;
      for (const q of this.ptrs.values()) q.moved = true;
    }
  };

  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && this.onHover && !this.ptrs.has(e.pointerId)) this.onHover(e.clientX, e.clientY, false);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
    this.dist = clamp(this.dist * Math.exp(e.deltaY * unit * 0.0012), DIST_MIN, this.distMax);
  };

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || this.typing(e)) return;
    this.keys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };
  private onBlur = (): void => {
    this.keys.clear();
    this.ptrs.clear();
    this.gesture = 'none';
  };

  /** Pan by a screen-space drag, "grabbing" the ground. Suspends following. */
  private panPixels(dx: number, dy: number): void {
    const h = this.canvas.clientHeight || 1;
    const wpp = (2 * this.cDist * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)) / h;
    const sinP = Math.max(0.3, Math.sin(this.cPitch));
    const rx = Math.cos(this.cYaw);
    const rz = -Math.sin(this.cYaw);
    const fx = -Math.sin(this.cYaw);
    const fz = -Math.cos(this.cYaw);
    this.target.x += -rx * dx * wpp + fx * dy * (wpp / sinP);
    this.target.z += -rz * dx * wpp + fz * dy * (wpp / sinP);
    this.clampTarget();
    this.follow = null;
  }

  // ---- per frame ---------------------------------------------------------

  update(dt: number): void {
    const keys = this.keys;
    if (keys.size > 0) {
      let kx = 0;
      let kz = 0;
      if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
      if (keys.has('d') || keys.has('arrowright')) kx += 1;
      if (keys.has('w') || keys.has('arrowup')) kz += 1;
      if (keys.has('s') || keys.has('arrowdown')) kz -= 1;
      if (kx !== 0 || kz !== 0) {
        const sp = this.cDist * 0.9 * dt;
        const rx = Math.cos(this.cYaw);
        const rz = -Math.sin(this.cYaw);
        const fx = -Math.sin(this.cYaw);
        const fz = -Math.cos(this.cYaw);
        this.target.x += (rx * kx + fx * kz) * sp;
        this.target.z += (rz * kx + fz * kz) * sp;
        this.clampTarget();
        this.follow = null;
      }
      if (keys.has('q')) this.yaw += 1.7 * dt;
      if (keys.has('e')) this.yaw -= 1.7 * dt;
      if (keys.has('+') || keys.has('=')) this.dist = clamp(this.dist * Math.exp(-1.3 * dt), DIST_MIN, this.distMax);
      if (keys.has('-') || keys.has('_')) this.dist = clamp(this.dist * Math.exp(1.3 * dt), DIST_MIN, this.distMax);
    }
    if (this.follow && this.follow(this.tmp)) {
      this.target.x = this.tmp.x;
      this.target.z = this.tmp.z;
      this.clampTarget();
    }

    const snap = this.snapNext;
    this.snapNext = false;
    const k = snap ? 1 : 1 - Math.exp(-dt * 9);
    const ka = snap ? 1 : 1 - Math.exp(-dt * 12);
    this.focus.x += (this.target.x - this.focus.x) * k;
    this.focus.z += (this.target.z - this.focus.z) * k;
    const gy = this.heightAt(this.focus.x, this.focus.z);
    this.focus.y += (gy - this.focus.y) * (snap ? 1 : 1 - Math.exp(-dt * 5));
    this.cYaw += angleDiff(this.cYaw, this.yaw) * ka;
    this.cPitch += (this.pitch - this.cPitch) * ka;
    this.cDist += (this.dist - this.cDist) * ka;

    const cp = Math.cos(this.cPitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.cYaw) * cp * this.cDist,
      this.focus.y + Math.sin(this.cPitch) * this.cDist,
      this.focus.z + Math.cos(this.cYaw) * cp * this.cDist,
    );
    if (this.shakeAmp > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 14);
    } else this.shakeAmp = 0;
    this.camera.lookAt(this.focus);
  }

  /** A brief positional shake (world units, decays in ~0.2 s). */
  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }
}

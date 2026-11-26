import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  TorusGeometry,
} from 'three';
import type { FloorPlan } from '../core/types';
import type { Fow } from './fow';
import { GeoBuilder } from './gb';
import { CELL } from './util';

/** Gradient beam: bright at the base, fading to nothing at the top (additive). */
function beam(rBottom: number, rTop: number, h: number, color: number): { geo: BufferGeometry; mat: MeshBasicMaterial } {
  const geo = new CylinderGeometry(rTop, rBottom, h, 10, 1, true);
  geo.translate(0, h / 2, 0);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - pos.getY(i) / h;
    const k = t * t * t * t * 0.045;
    col[i * 3] = r * k;
    col[i * 3 + 1] = g * k;
    col[i * 3 + 2] = b * k;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  return { geo, mat };
}

/** The way in (a light shaft from above) and the way down (a glowing portal ring). */
export class Markers {
  readonly group = new Group();
  private entrance: Group | null = null;
  private exit: Group | null = null;
  private spinner: Mesh | null = null;
  private spinner2: Mesh | null = null;
  private pulse: MeshBasicMaterial | null = null;
  private disposables: { dispose(): void }[] = [];
  private entranceCell = { x: 0, y: 0 };
  private exitCell = { x: 0, y: 0 };

  build(plan: FloorPlan, groundAt: (x: number, y: number) => number): void {
    this.clear();
    const mk = (cell: { x: number; y: number }): Group => {
      const g = new Group();
      g.position.set(cell.x * CELL + CELL / 2, groundAt(cell.x, cell.y), cell.y * CELL + CELL / 2);
      this.group.add(g);
      return g;
    };

    // Entrance: stone pad, a pale shaft and a soft ring.
    {
      const g = mk(plan.entrance);
      this.entranceCell = { ...plan.entrance };
      const pad = new GeoBuilder();
      pad.cyl(0.98, 1.0, 0.1, 4, 0xb8c4d0, { y: 0.07, ry: Math.PI / 4, top: 0xd8e4f0 });
      pad.cyl(0.7, 0.72, 0.05, 4, 0x8fa0b4, { y: 0.13, ry: Math.PI / 4 });
      const padGeo = pad.build()!;
      const padMat = new MeshLambertMaterial({ vertexColors: true });
      g.add(new Mesh(padGeo, padMat));
      const b = beam(0.6, 0.4, 8, 0xbfe0ff);
      g.add(new Mesh(b.geo, b.mat));
      const ringGeo = new RingGeometry(0.62, 0.8, 28).rotateX(-Math.PI / 2);
      const ringMat = new MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.8, depthWrite: false });
      const ring = new Mesh(ringGeo, ringMat);
      ring.position.y = 0.2;
      g.add(ring);
      this.disposables.push(padGeo, padMat, b.geo, b.mat, ringGeo, ringMat);
      this.entrance = g;
    }

    // Exit: dark stairwell mouth, spinning gold rings and a rising shaft.
    {
      const g = mk(plan.exit);
      this.exitCell = { ...plan.exit };
      const holeGeo = new CircleGeometry(0.95, 20).rotateX(-Math.PI / 2);
      const hc = new Float32Array(holeGeo.getAttribute('position').count * 3);
      const hp = holeGeo.getAttribute('position');
      for (let i = 0; i < hp.count; i++) {
        const d = Math.hypot(hp.getX(i), hp.getZ(i)) / 0.95;
        hc[i * 3] = 0.02 + 0.5 * d * d;
        hc[i * 3 + 1] = 0.02 + 0.38 * d * d;
        hc[i * 3 + 2] = 0.01 + 0.08 * d * d;
      }
      holeGeo.setAttribute('color', new BufferAttribute(hc, 3));
      const holeMat = new MeshBasicMaterial({ vertexColors: true });
      const hole = new Mesh(holeGeo, holeMat);
      hole.position.y = 0.1;
      g.add(hole);
      const tGeo = new TorusGeometry(0.98, 0.09, 6, 24).rotateX(Math.PI / 2);
      const tMat = new MeshBasicMaterial({ color: 0xffc850 });
      const torus = new Mesh(tGeo, tMat);
      torus.position.y = 0.22;
      g.add(torus);
      this.spinner = torus;
      const t2Geo = new TorusGeometry(0.62, 0.05, 5, 20).rotateX(Math.PI / 2);
      const t2Mat = new MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
      const torus2 = new Mesh(t2Geo, t2Mat);
      torus2.position.y = 0.3;
      g.add(torus2);
      this.spinner2 = torus2;
      this.pulse = t2Mat;
      const b = beam(0.7, 0.3, 8, 0xffc850);
      g.add(new Mesh(b.geo, b.mat));
      this.disposables.push(holeGeo, holeMat, tGeo, tMat, t2Geo, t2Mat, b.geo, b.mat);
      this.exit = g;
    }
  }

  update(time: number): void {
    if (this.spinner) this.spinner.rotation.y = time * 0.9;
    if (this.spinner2) {
      this.spinner2.rotation.y = -time * 1.4;
      this.spinner2.position.y = 0.3 + Math.sin(time * 2.2) * 0.12;
    }
    if (this.pulse) this.pulse.opacity = 0.6 + 0.4 * Math.sin(time * 3);
  }

  /** Show markers only on seen cells. */
  refresh(fow: Fow, active: boolean): void {
    if (this.entrance) this.entrance.visible = !active || fow.isVisible(this.entranceCell.x, this.entranceCell.y);
    if (this.exit) this.exit.visible = !active || fow.isVisible(this.exitCell.x, this.exitCell.y);
  }

  private clear(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
    this.entrance = this.exit = this.spinner = this.spinner2 = null;
    this.pulse = null;
  }

  dispose(): void {
    this.clear();
  }
}

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
} from 'three';
import type { ThemeId } from '../core/types';
import { GeoBuilder } from './gb';
import type { Figure } from './standins';

/**
 * A safe place to rest, themed by floor: campfire ring with bedroll and pack (warrens, hold),
 * candle shrine (crypt, sewers), lantern on a cairn (depths). Idle = gentle flicker and a slow
 * pulsing pool of warm light with rising motes; cast = flare and an expanding ring of
 * light; spent (dead) = fire out, embers only, glow off, still fully visible.
 */
export function buildRestSite(theme: ThemeId): Figure {
  const lit = new GeoBuilder();
  const flame = new GeoBuilder();
  const ember = new GeoBuilder();
  const stoneC = theme === 'depths' ? 0x6f7482 : theme === 'crypt' ? 0x9aa2b2 : theme === 'sewers' ? 0x8a8468 : theme === 'fungal' ? 0x7a7494 : 0x8a8070;
  const stoneD = theme === 'depths' ? 0x4a4e5c : theme === 'crypt' ? 0x6a7282 : theme === 'sewers' ? 0x5a5640 : theme === 'fungal' ? 0x4c4868 : 0x5c5246;
  const flameColor = theme === 'fungal' ? 0x70f0c8 : theme === 'warrens' || theme === 'hold' ? 0xffa040 : theme === 'crypt' || theme === 'sewers' ? 0xffc468 : 0xffd890;
  const flameAt = (x: number, y: number, z: number, s: number): void => {
    flame.cone(0.13 * s, 0.4 * s, 6, 0xffffff, { x, y: y + 0.2 * s, z });
    flame.cone(0.08 * s, 0.28 * s, 5, 0xffffff, { x: x + 0.02, y: y + 0.16 * s, z, shade: 1.8 });
  };
  const emberAt = (x: number, y: number, z: number, r: number): void => {
    ember.ico(r, 0, 0xff5a20, { x, y, z, sy: 0.6, ry: x * 7 });
  };
  let flameTop = 0.2;

  if (theme === 'warrens' || theme === 'fungal' || theme === 'hold') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      lit.ico(0.16, 0, i % 2 ? stoneC : stoneD, { x: Math.cos(a) * 0.5, z: Math.sin(a) * 0.5, y: 0.09, sy: 0.7, ry: i });
    }
    lit.cyl(0.4, 0.44, 0.03, 8, 0x1a1410, { y: 0.02 });
    lit.box(0.7, 0.1, 0.1, 0x5a3a20, { y: 0.1, ry: 0.5, rz: 0.12 });
    lit.box(0.7, 0.1, 0.1, 0x7a5030, { y: 0.1, ry: -0.8, rz: -0.12 });
    lit.box(0.55, 0.12, 1.1, 0x4f6a8a, { x: -1.0, z: 0.25, y: 0.07, ry: 0.35 });
    lit.cyl(0.14, 0.14, 0.58, 8, 0xb89a6a, { x: -1.05, z: -0.38, y: 0.18, rz: Math.PI / 2, ry: 0.35 });
    lit.box(0.4, 0.42, 0.3, 0x6a4a2a, { x: 0.8, z: 0.6, y: 0.22, ry: -0.5 });
    lit.box(0.3, 0.14, 0.2, 0x8a6a3a, { x: 0.82, z: 0.6, y: 0.48, ry: -0.5 });
    flameAt(0, 0.12, 0, 1.5);
    flameAt(0.08, 0.12, 0.06, 1.0);
    emberAt(0.15, 0.1, 0.1, 0.07);
    emberAt(-0.12, 0.09, -0.08, 0.06);
    emberAt(0.0, 0.1, 0.18, 0.05);
    flameTop = 0.5;
  } else if (theme === 'crypt' || theme === 'sewers') {
    lit.box(1.3, 0.2, 0.8, stoneD, { y: 0.1 });
    lit.box(1.15, 0.5, 0.65, stoneC, { y: 0.45 });
    lit.box(1.3, 0.1, 0.8, stoneC, { y: 0.74, shade: 1.1 });
    lit.box(0.2, 0.9, 0.2, stoneD, { x: -0.5, z: -0.3, y: 0.9 });
    lit.box(0.2, 0.9, 0.2, stoneD, { x: 0.5, z: -0.3, y: 0.9 });
    lit.box(1.2, 0.14, 0.26, stoneC, { z: -0.3, y: 1.4 });
    lit.box(0.36, 0.07, 0.26, 0x6a2a2a, { x: 0.0, z: 0.12, y: 0.82, ry: 0.2 });
    const candles: [number, number, number][] = [
      [-0.42, 0.1, 0.3],
      [0.0, -0.12, 0.42],
      [0.4, 0.14, 0.26],
    ];
    for (const [x, z, h] of candles) {
      lit.cyl(0.05, 0.055, h, 7, 0xeee6cc, { x, z, y: 0.79 + h / 2 });
      flameAt(x, 0.79 + h, z, 0.55);
      emberAt(x, 0.79 + h + 0.01, z, 0.025);
    }
    flameTop = 1.2;
  } else {
    lit.ico(0.5, 0, stoneD, { y: 0.22, sy: 0.55, x: 0.05 });
    lit.ico(0.36, 0, stoneC, { x: -0.1, y: 0.55, z: 0.05, sy: 0.7 });
    lit.ico(0.26, 0, stoneD, { x: 0.12, y: 0.8, z: -0.03, sy: 0.7 });
    lit.ico(0.2, 0, stoneC, { x: -0.7, y: 0.1, z: 0.3, sy: 0.6 });
    lit.box(0.3, 0.05, 0.3, 0x2c2f3a, { x: 0.12, y: 0.98, z: -0.03 });
    lit.box(0.3, 0.05, 0.3, 0x2c2f3a, { x: 0.12, y: 1.46, z: -0.03 });
    const posts: [number, number][] = [
      [-0.13, -0.13],
      [0.13, -0.13],
      [-0.13, 0.13],
      [0.13, 0.13],
    ];
    for (const [dx, dz] of posts) lit.box(0.035, 0.5, 0.035, 0x2c2f3a, { x: 0.12 + dx, y: 1.22, z: -0.03 + dz });
    lit.cone(0.22, 0.14, 4, 0x2c2f3a, { x: 0.12, y: 1.56, z: -0.03, ry: Math.PI / 4 });
    flameAt(0.12, 1.02, -0.03, 1.05);
    emberAt(0.12, 1.03, -0.03, 0.06);
    flameTop = 1.5;
  }

  const bodyGeo = lit.build()!;
  const flameGeo = flame.build()!;
  const emberGeo = ember.build()!;
  const fc = new Color(flameColor);
  const bodyMat = new MeshLambertMaterial({ vertexColors: true });
  const flameMat = new MeshBasicMaterial({ vertexColors: true, color: fc });
  const emberMat = new MeshBasicMaterial({ vertexColors: true });
  const body = new Mesh(bodyGeo, bodyMat);
  const flameMesh = new Mesh(flameGeo, flameMat);
  const emberMesh = new Mesh(emberGeo, emberMat);

  // Soft pool of warm light on the ground.
  const poolGeo = new CircleGeometry(1.7, 24).rotateX(-Math.PI / 2);
  const pp = poolGeo.getAttribute('position');
  const pc = new Float32Array(pp.count * 3);
  for (let i = 0; i < pp.count; i++) {
    const d = Math.min(1, Math.hypot(pp.getX(i), pp.getZ(i)) / 1.7);
    const k = (1 - d) * (1 - d) * 0.42;
    pc[i * 3] = fc.r * k;
    pc[i * 3 + 1] = fc.g * k;
    pc[i * 3 + 2] = fc.b * k;
  }
  poolGeo.setAttribute('color', new BufferAttribute(pc, 3));
  const poolMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
  const pool = new Mesh(poolGeo, poolMat);
  pool.position.y = 0.07;
  pool.renderOrder = 1;

  // Expanding ring for the rest cast.
  const ringGeo = new RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2);
  const ringMat = new MeshBasicMaterial({ color: fc, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
  const ring = new Mesh(ringGeo, ringMat);
  ring.position.y = 0.1;
  ring.visible = false;
  ring.renderOrder = 2;

  // Rising motes.
  const N = 8;
  const mp = new Float32Array(N * 3);
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute('position', new BufferAttribute(mp, 3));
  const moteMat = new PointsMaterial({ color: fc, size: 0.1, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;

  const root = new Group();
  root.add(body, emberMesh, flameMesh, pool, ring, motes);

  const tick = (time: number, castU: number, spent: boolean): void => {
    const slow = 0.5 + 0.5 * Math.sin(time * 1.3);
    const fl = 1 + 0.1 * Math.sin(time * 9) + 0.06 * Math.sin(time * 15.3);
    const flare = castU >= 0 ? Math.sin(Math.PI * Math.min(1, castU)) : 0;
    flameMesh.visible = !spent;
    pool.visible = !spent;
    motes.visible = !spent;
    if (!spent) {
      flameMesh.scale.set(1 + 0.4 * flare, fl * (1 + 1.1 * flare), 1 + 0.4 * flare);
      poolMat.opacity = 0.75 + 0.25 * slow + 0.6 * flare;
      pool.scale.setScalar(1 + 0.12 * slow + 0.35 * flare);
      for (let i = 0; i < N; i++) {
        const ph = (time * 0.35 + i / N) % 1;
        const a = i * 2.4;
        mp[i * 3] = Math.cos(a) * (0.12 + 0.25 * ph);
        mp[i * 3 + 1] = flameTop + 0.1 + ph * 1.6;
        mp[i * 3 + 2] = Math.sin(a) * (0.12 + 0.25 * ph);
      }
      moteGeo.getAttribute('position').needsUpdate = true;
      moteMat.opacity = 0.75 * (1 - 0.3 * flare);
    }
    emberMat.color.setScalar(spent ? 0.45 + 0.2 * Math.sin(time * 1.1) : 0.9);
    if (castU >= 0 && castU < 1) {
      ring.visible = true;
      ring.scale.setScalar(0.4 + castU * 3.2);
      ringMat.opacity = 0.85 * (1 - castU);
    } else ring.visible = false;
  };

  const disposables: { dispose(): void }[] = [bodyGeo, flameGeo, emberGeo, poolGeo, ringGeo, moteGeo, bodyMat, flameMat, emberMat, poolMat, ringMat, moteMat];
  return {
    root,
    parts: {},
    materials: [bodyMat],
    height: theme === 'warrens' || theme === 'fungal' || theme === 'hold' ? 0.9 : 1.6,
    kind: 'rest',
    tick,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

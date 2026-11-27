import { AdditiveBlending, BufferAttribute, BufferGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Points, PointsMaterial } from 'three';
import type { AnimationAction, AnimationMixer, Material } from 'three';
import type { AnimName, Faction, ThemeId } from '../core/types';
import { buildRestSite } from './restSite';
import { GeoBuilder } from './gb';

/** A visual for one entity: either a procedural stand-in or a loaded model. */
export interface Figure {
  root: Group;
  parts: {
    armL?: Mesh;
    armR?: Mesh;
    legL?: Mesh;
    legR?: Mesh;
    head?: Mesh;
    body?: Mesh;
    lid?: Mesh;
  };
  /** Materials that take flash (emissive) and fade (opacity). */
  materials: Material[];
  /** Nominal height at scale 1, in world units. */
  height: number;
  /** Opacity of the undamaged figure (ghosts are translucent). */
  baseOpacity?: number;
  kind: 'humanoid' | 'beast' | 'blob' | 'chest' | 'model' | 'rest';
  /** Self-animating figures (rest sites): called every frame. castU is the cast progress 0..1, or -1. */
  tick?(time: number, castU: number, spent: boolean): void;
  mixer?: AnimationMixer;
  actions?: Partial<Record<AnimName, AnimationAction>>;
  dispose(): void;
}

export const FACTION_TINT: Record<Faction, number> = {
  player: 0x4a86d8,
  ally: 0x4fbf78,
  enemy: 0xc4503c,
};

const mulHex = (hex: number, f: number): number => {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
};

interface HumanoidStyle {
  skin: number;
  hair: number;
  metal: number;
  w: number; // body width scale
  h: number; // body height scale
  head: number; // head scale
  limb: number; // limb thickness scale
  ears: boolean;
  tusks: boolean;
  skeleton: boolean;
  robe: boolean;
  helmet: boolean;
  cape: boolean;
  weapon: 'sword' | 'club' | 'staff' | 'dagger' | 'none';
  shield: boolean;
}

function styleFor(key: string, faction: Faction): HumanoidStyle {
  const k = key.toLowerCase();
  const base: HumanoidStyle = {
    skin: 0xe2b88e,
    hair: 0x4a3220,
    metal: 0xaab0ba,
    w: 1,
    h: 1,
    head: 1,
    limb: 1,
    ears: false,
    tusks: false,
    skeleton: false,
    robe: false,
    helmet: faction !== 'enemy',
    cape: faction === 'player',
    weapon: 'sword',
    shield: faction !== 'enemy',
  };
  if (k.includes('skeleton') || k.includes('bone')) {
    return { ...base, skin: 0xe6dfc6, skeleton: true, helmet: false, cape: false, limb: 0.7, shield: false, weapon: 'sword', metal: 0x8a8576 };
  }
  if (k.includes('goblin') || k.includes('kobold')) {
    return { ...base, skin: 0x74ad4a, head: 1.35, ears: true, helmet: false, cape: false, shield: false, weapon: 'dagger', h: 0.95 };
  }
  if (k.includes('orc') || k.includes('ogre') || k.includes('brute') || k.includes('bugbear') || k.includes('troll')) {
    return { ...base, skin: 0x7c9a5a, w: 1.3, limb: 1.3, tusks: true, helmet: false, cape: false, shield: false, weapon: 'club', head: 0.95 };
  }
  if (k.includes('zombie') || k.includes('ghoul') || k.includes('ghast')) {
    return { ...base, skin: 0x8fa880, helmet: false, cape: false, shield: false, weapon: 'none', hair: 0x2a2a20 };
  }
  if (k.includes('mage') || k.includes('cultist') || k.includes('priest') || k.includes('wizard') || k.includes('acolyte') || k.includes('witch')) {
    return { ...base, robe: true, helmet: false, cape: false, shield: false, weapon: 'staff' };
  }
  if (k.includes('dwarf')) return { ...base, w: 1.2, h: 0.88, hair: 0x8a4a22 };
  if (k.includes('elf')) return { ...base, h: 1.05, limb: 0.9, ears: true, helmet: false };
  return base;
}

/** The hero and humanoid monsters. Origin at the feet, +Z is forward, about 1.8 tall. */
function buildHumanoid(key: string, tint: number, faction: Faction): Figure {
  const st = styleFor(key, faction);
  const cloth = tint;
  const clothDark = mulHex(tint, 0.6);
  const clothLight = mulHex(tint, 1.25);
  const leather = 0x4a3220;
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const geos: BufferGeometry[] = [];
  const root = new Group();
  const parts: Figure['parts'] = {};
  const mk = (g: GeoBuilder, px = 0, py = 0, pz = 0): Mesh => {
    const geo = g.build()!;
    geos.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    root.add(m);
    return m;
  };
  const { w, h, limb } = st;
  const skinCol = st.skin;

  // Body: torso, pelvis, shoulders, cape.
  const b = new GeoBuilder();
  const torsoCol = st.skeleton ? skinCol : st.robe ? cloth : cloth;
  if (st.skeleton) {
    b.box(0.2 * w, 0.62 * h, 0.12, skinCol, { y: 1.12 * h, shade: 0.8 });
    for (let i = 0; i < 4; i++) b.box(0.46 * w, 0.05, 0.26, skinCol, { y: (1.28 - i * 0.12) * h });
    b.box(0.34, 0.2, 0.2, skinCol, { y: 0.84 * h, shade: 0.9 });
  } else {
    b.box(0.5 * w, 0.62 * h, 0.3, torsoCol, { y: 1.12 * h, top: clothLight });
    b.box(0.46 * w, 0.1, 0.34, leather, { y: 0.84 * h });
    b.box(0.08, 0.1, 0.04, 0xd9b84a, { y: 0.84 * h, z: 0.18 });
    if (st.robe) {
      b.cyl(0.26 * w, 0.4 * w, 0.62, 8, clothDark, { y: 0.55, top: cloth });
    } else {
      b.box(0.42 * w, 0.3, 0.3, clothDark, { y: 0.7 * h });
    }
    const pa = st.helmet || faction === 'player' ? st.metal : clothLight;
    b.ico(0.15 * w, 0, pa, { x: -0.33 * w, y: 1.42 * h, sy: 0.8 });
    b.ico(0.15 * w, 0, pa, { x: 0.33 * w, y: 1.42 * h, sy: 0.8 });
    if (st.cape) b.box(0.44 * w, 0.8, 0.05, clothDark, { y: 1.02, z: -0.2, rx: 0.08, top: cloth });
  }
  parts.body = mk(b);

  // Legs.
  for (const side of [-1, 1] as const) {
    const l = new GeoBuilder();
    const legCol = st.skeleton ? skinCol : st.robe ? clothDark : mulHex(cloth, 0.55);
    l.box(0.16 * limb, 0.74 * h, 0.17 * limb, legCol, { y: -0.37 * h });
    l.box(0.18 * limb, 0.13, 0.3, st.skeleton ? skinCol : leather, { y: -0.72 * h, z: 0.05, shade: 0.9 });
    const m = mk(l, side * 0.14 * w, 0.78 * h, 0);
    if (side < 0) parts.legL = m;
    else parts.legR = m;
  }

  // Head.
  const hd = new GeoBuilder();
  const hs = st.head;
  hd.ico(0.2 * hs, 1, skinCol, { y: 0.2 * hs, sy: 1.05 });
  hd.box(0.05 * hs, 0.05 * hs, 0.03, st.skeleton ? 0x1a1a1a : 0x20160f, { x: -0.075 * hs, y: 0.22 * hs, z: 0.18 * hs });
  hd.box(0.05 * hs, 0.05 * hs, 0.03, st.skeleton ? 0x1a1a1a : 0x20160f, { x: 0.075 * hs, y: 0.22 * hs, z: 0.18 * hs });
  if (st.helmet) {
    hd.sphere(0.215 * hs, 8, 5, st.metal, { y: 0.26 * hs, sy: 0.75, shade: 1.0 });
    hd.box(0.06, 0.2 * hs, 0.05, st.metal, { y: 0.2 * hs, z: 0.2 * hs });
    hd.box(0.04, 0.12, 0.3, clothLight, { y: 0.46 * hs, z: -0.02, shade: 1.0 });
  } else if (!st.skeleton) {
    hd.sphere(0.21 * hs, 8, 4, st.hair, { y: 0.27 * hs, z: -0.02, sy: 0.7 });
  }
  if (st.robe) hd.cone(0.24, 0.34, 6, clothDark, { y: 0.38, z: -0.02, rx: -0.15 });
  if (st.ears) {
    hd.cone(0.06, 0.3, 4, skinCol, { x: -0.3 * hs, y: 0.25 * hs, rz: 1.25 });
    hd.cone(0.06, 0.3, 4, skinCol, { x: 0.3 * hs, y: 0.25 * hs, rz: -1.25 });
  }
  if (st.tusks) {
    hd.cone(0.03, 0.12, 4, 0xf0e8d0, { x: -0.07, y: 0.1, z: 0.19, rx: 0.3 });
    hd.cone(0.03, 0.12, 4, 0xf0e8d0, { x: 0.07, y: 0.1, z: 0.19, rx: 0.3 });
  }
  parts.head = mk(hd, 0, 1.43 * h, 0);

  // Arms. Left carries a shield if any; right the weapon.
  for (const side of [-1, 1] as const) {
    const a = new GeoBuilder();
    const sleeve = st.skeleton ? skinCol : st.robe ? cloth : cloth;
    a.box(0.13 * limb, 0.56, 0.13 * limb, sleeve, { y: -0.29, top: st.skeleton ? skinCol : clothLight });
    a.ico(0.075 * limb, 0, skinCol, { y: -0.62 });
    if (side === 1) {
      switch (st.weapon) {
        case 'sword':
          a.box(0.05, 0.78, 0.02, 0xdfe6ee, { y: -0.62, z: 0.34, rx: 1.15, shade: 1.15 });
          a.box(0.17, 0.04, 0.05, 0xc9a23a, { y: -0.64, z: 0.07, rx: 0.2 });
          break;
        case 'club':
          a.cyl(0.13, 0.05, 0.8, 6, 0x6a4a2a, { y: -0.62, z: 0.3, rx: 1.15 });
          break;
        case 'staff':
          a.cyl(0.03, 0.03, 1.7, 5, 0x6a4a2a, { y: -0.45, z: 0.1, rx: 0.1 });
          a.ico(0.1, 0, 0x7ad8ff, { y: 0.4, z: 0.1, shade: 1.6 });
          break;
        case 'dagger':
          a.box(0.04, 0.4, 0.02, 0xdfe6ee, { y: -0.62, z: 0.2, rx: 1.15 });
          break;
        default:
          break;
      }
    } else if (st.shield) {
      a.cyl(0.3, 0.3, 0.06, 8, cloth, { x: -0.1, y: -0.42, z: 0.06, rz: Math.PI / 2, shade: 0.95 });
      a.cyl(0.14, 0.14, 0.09, 8, st.metal, { x: -0.12, y: -0.42, z: 0.06, rz: Math.PI / 2 });
    }
    const m = mk(a, side * 0.37 * w, 1.42 * h, 0);
    if (side < 0) parts.armL = m;
    else parts.armR = m;
  }

  return {
    root,
    parts,
    materials: [mat],
    height: 1.8,
    kind: 'humanoid',
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
}

function buildBeast(key: string, tint: number): Figure {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const geos: BufferGeometry[] = [];
  const root = new Group();
  const parts: Figure['parts'] = {};
  const mk = (g: GeoBuilder, px = 0, py = 0, pz = 0): Mesh => {
    const geo = g.build()!;
    geos.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    root.add(m);
    return m;
  };
  const fur = tint;
  const dark = mulHex(tint, 0.6);
  const light = mulHex(tint, 1.3);
  const b = new GeoBuilder();
  b.box(0.55, 0.5, 1.05, fur, { y: 0.7, top: light });
  b.ico(0.3, 0, fur, { y: 0.78, z: 0.35, sy: 0.9 });
  b.box(0.12, 0.12, 0.5, dark, { y: 0.8, z: -0.7, rx: -0.5 });
  b.box(0.1, 0.1, 0.35, light, { y: 0.98, z: -0.92, rx: -0.9, shade: 1.1 });
  b.box(0.2, 0.08, 0.7, dark, { y: 0.97, z: 0.05, shade: 0.9 });
  parts.body = mk(b);
  const hd = new GeoBuilder();
  hd.box(0.36, 0.34, 0.4, fur, { y: 0, z: 0.1 });
  hd.box(0.22, 0.18, 0.3, light, { y: -0.06, z: 0.4 });
  hd.box(0.07, 0.07, 0.05, 0x1a1a1a, { x: 0.13, y: 0.04, z: 0.27 });
  hd.box(0.07, 0.07, 0.05, 0x1a1a1a, { x: -0.13, y: 0.04, z: 0.27 });
  hd.cone(0.07, 0.2, 4, dark, { x: 0.12, y: 0.28, z: 0.0 });
  hd.cone(0.07, 0.2, 4, dark, { x: -0.12, y: 0.28, z: 0.0 });
  hd.box(0.2, 0.04, 0.05, 0xf4f0e0, { y: -0.17, z: 0.5 });
  parts.head = mk(hd, 0, 0.9, 0.55);
  const lA = new GeoBuilder();
  lA.box(0.14, 0.46, 0.14, dark, { x: -0.19, y: -0.23, z: 0.38 });
  lA.box(0.14, 0.46, 0.14, dark, { x: 0.19, y: -0.23, z: -0.38 });
  parts.legL = mk(lA, 0, 0.48, 0);
  const lB = new GeoBuilder();
  lB.box(0.14, 0.46, 0.14, dark, { x: 0.19, y: -0.23, z: 0.38 });
  lB.box(0.14, 0.46, 0.14, dark, { x: -0.19, y: -0.23, z: -0.38 });
  parts.legR = mk(lB, 0, 0.48, 0);
  void key;
  return {
    root,
    parts,
    materials: [mat],
    height: 1.1,
    kind: 'beast',
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
}

function buildBlob(tint: number): Figure {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const root = new Group();
  const g = new GeoBuilder();
  g.ico(0.62, 1, tint, { y: 0.5, sy: 0.85, shade: 1.0, top: mulHex(tint, 1.4) });
  g.ico(0.2, 0, 0xffffff, { x: -0.2, y: 0.72, z: 0.46 });
  g.ico(0.2, 0, 0xffffff, { x: 0.2, y: 0.72, z: 0.46 });
  g.ico(0.09, 0, 0x101010, { x: -0.2, y: 0.72, z: 0.63 });
  g.ico(0.09, 0, 0x101010, { x: 0.2, y: 0.72, z: 0.63 });
  g.ico(0.18, 0, mulHex(tint, 0.7), { x: 0.3, y: 0.18, z: -0.4 });
  g.ico(0.12, 0, mulHex(tint, 1.5), { x: -0.3, y: 0.95, z: -0.1, shade: 1.1 });
  const geo = g.build()!;
  const body = new Mesh(geo, mat);
  root.add(body);
  return {
    root,
    parts: { body },
    materials: [mat],
    height: 1.2,
    kind: 'blob',
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Chest glow detail: false on 'low' quality (floor glow only; no shaft or motes). Set by the renderer. */
let chestRich = true;
export function setChestDetail(rich: boolean): void {
  chestRich = rich;
}

/**
 * The treasure chest. An unopened chest glows: a pale gold-white pool on the floor, a slow sparkle of rising motes and
 * a faint vertical shaft of light that carries across a room. Opened (dead) it keeps its lid up and goes dark. The boss
 * chest is larger and ornate (banded, with a crest), shines harder, and 'cast' plays its arrival: it drops in with a
 * burst of gold motes (~0.8 s).
 */
function buildChest(boss: boolean): Figure {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const root = new Group();
  const S = boss ? 1.4 : 1;
  const wood = boss ? 0x6a2a1c : 0x8a5a30;
  const dark = boss ? 0x3e1810 : 0x5a3a20;
  const band = boss ? 0xe8c040 : 0x4a4a52;
  const gold = 0xf0c840;
  const b = new GeoBuilder();
  b.box(1.1, 0.5, 0.74, wood, { y: 0.25 });
  b.box(1.14, 0.08, 0.78, dark, { y: 0.04 });
  b.box(0.12, 0.52, 0.78, band, { x: -0.38, y: 0.25, shade: boss ? 1.25 : 1 });
  b.box(0.12, 0.52, 0.78, band, { x: 0.38, y: 0.25, shade: boss ? 1.25 : 1 });
  b.box(1.0, 0.08, 0.64, 0x1a1008, { y: 0.51, shade: 0.8 });
  if (boss) {
    b.box(1.18, 0.07, 0.82, band, { y: 0.1, shade: 1.2 });
    for (const [x, z] of [[-0.55, -0.38], [0.55, -0.38], [-0.55, 0.38], [0.55, 0.38]] as const) b.box(0.12, 0.54, 0.12, band, { x, z, y: 0.27, shade: 1.3 });
    b.box(0.26, 0.3, 0.05, gold, { y: 0.3, z: 0.4, shade: 1.35 }); // crest plate
    b.octa(0.1, 0xd02a3a, { y: 0.3, z: 0.44, shade: 1.3 }); // gem
  }
  const base = new Mesh(b.build()!, mat);
  root.add(base);
  const l = new GeoBuilder();
  l.box(1.1, 0.14, 0.74, wood, { y: 0.07, z: 0.37 });
  l.cyl(0.37, 0.37, 1.1, 8, wood, { y: 0.14, z: 0.37, rz: Math.PI / 2, sy: 0.55, sz: 1, shade: 1.05 });
  l.box(0.12, 0.3, 0.8, band, { x: -0.38, y: 0.15, z: 0.37, shade: boss ? 1.25 : 1 });
  l.box(0.12, 0.3, 0.8, band, { x: 0.38, y: 0.15, z: 0.37, shade: boss ? 1.25 : 1 });
  l.box(0.14, 0.16, 0.06, gold, { y: 0.1, z: 0.76, shade: 1.3 });
  if (boss) {
    l.box(0.9, 0.05, 0.1, band, { y: 0.3, z: 0.37, shade: 1.2 });
    l.octa(0.09, 0xd02a3a, { y: 0.3, z: 0.76, shade: 1.3 });
  }
  const lid = new Mesh(l.build()!, mat);
  lid.position.set(0, 0.5, -0.37);
  root.add(lid);
  const inner = new Group();
  inner.scale.setScalar(S);
  inner.add(base, lid);
  root.add(inner);

  // ---- glow: floor pool, shaft, motes (all additive, unlit, never shadowed) ----
  const poolGeo = new CircleGeometry(1.9 * S, 28).rotateX(-Math.PI / 2);
  {
    const pp = poolGeo.getAttribute('position');
    const pc = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const d = Math.min(1, Math.hypot(pp.getX(i), pp.getZ(i)) / (1.9 * S));
      const k = (1 - d) * (1 - d) * 0.75;
      pc[i * 3] = 1.0 * k;
      pc[i * 3 + 1] = 0.93 * k;
      pc[i * 3 + 2] = 0.62 * k; // pale gold-white, so it survives on orange and on white floors
    }
    poolGeo.setAttribute('color', new BufferAttribute(pc, 3));
  }
  const glowMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const pool = new Mesh(poolGeo, glowMat);
  pool.position.y = 0.07;
  pool.renderOrder = 1;
  pool.userData.noShadow = true;

  const shaftH = boss ? 9 : 6;
  const shaftGeo = new CylinderGeometry(0.28 * S, 0.7 * S, shaftH, 10, 1, true);
  {
    const sp = shaftGeo.getAttribute('position');
    const sc = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const t = (sp.getY(i) + shaftH / 2) / shaftH; // 0 bottom .. 1 top
      const k = Math.pow(1 - t, 1.5) * (boss ? 0.55 : 0.3);
      sc[i * 3] = 1.0 * k;
      sc[i * 3 + 1] = 0.92 * k;
      sc[i * 3 + 2] = 0.6 * k;
    }
    shaftGeo.setAttribute('color', new BufferAttribute(sc, 3));
  }
  const shaftMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  const shaft = new Mesh(shaftGeo, shaftMat);
  shaft.position.y = shaftH / 2;
  shaft.renderOrder = 2;
  shaft.userData.noShadow = true;

  const N = boss ? 28 : 5; // sparkle motes first; the boss chest uses the rest for its arrival burst
  const nSparkle = boss ? 4 : 3;
  const mp = new Float32Array(N * 3);
  const mc = new Float32Array(N * 3);
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute('position', new BufferAttribute(mp, 3));
  moteGeo.setAttribute('color', new BufferAttribute(mc, 3));
  const moteMat = new PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.userData.noShadow = true;
  root.add(pool, shaft, motes);

  const tick = (time: number, castU: number, spent: boolean): void => {
    const rich = chestRich;
    // Arrival (cast): drop in from above, bounce once; gold burst on landing.
    let drop = 0;
    let burst = -1;
    if (castU >= 0) {
      const u = Math.min(1, castU);
      if (u < 0.55) {
        const k = u / 0.55;
        drop = (1 - k * k) * 4.5;
      } else {
        const k = (u - 0.55) / 0.45;
        drop = Math.sin(Math.PI * Math.min(1, k * 1.6)) * 0.25 * (1 - k);
        burst = k;
      }
    }
    inner.position.y = drop;
    const slow = 0.5 + 0.5 * Math.sin(time * 1.6);
    const on = !spent;
    pool.visible = on;
    shaft.visible = on && rich;
    motes.visible = (on && rich) || burst >= 0;
    if (on) {
      const arrive = castU >= 0 ? Math.min(1, castU * 1.6) : 1;
      glowMat.opacity = (0.75 + 0.25 * slow) * arrive;
      pool.scale.setScalar(1 + 0.08 * slow);
      shaftMat.opacity = (0.7 + 0.3 * slow) * arrive + (burst >= 0 ? 0.6 * (1 - burst) : 0);
    }
    if (motes.visible) {
      for (let i = 0; i < N; i++) {
        let x = 0;
        let y = -9;
        let z = 0;
        let k = 0;
        if (i < nSparkle) {
          if (on && rich) {
            const ph = (time * 0.32 + i / nSparkle) % 1;
            const a = i * 2.1 + time * 0.3;
            x = Math.cos(a) * (0.25 + 0.2 * ph) * S;
            z = Math.sin(a) * (0.25 + 0.2 * ph) * S;
            y = (0.5 + ph * 1.8) * S;
            k = Math.sin(Math.PI * ph);
          }
        } else if (burst >= 0) {
          const j = i - nSparkle;
          const a = j * 2.4;
          const r = (0.3 + (j % 5) * 0.18) * burst * 3.2;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
          y = 0.4 + burst * (1.2 + (j % 4) * 0.5) - burst * burst * 1.2;
          k = 1 - burst;
        }
        mp[i * 3] = x;
        mp[i * 3 + 1] = y;
        mp[i * 3 + 2] = z;
        mc[i * 3] = 1.0 * k;
        mc[i * 3 + 1] = 0.88 * k;
        mc[i * 3 + 2] = 0.45 * k;
      }
      moteGeo.getAttribute('position').needsUpdate = true;
      moteGeo.getAttribute('color').needsUpdate = true;
    }
  };

  const geos = [base.geometry, lid.geometry, poolGeo, shaftGeo, moteGeo];
  return {
    root,
    parts: { lid, body: base },
    materials: [mat],
    height: 0.9 * S,
    kind: 'chest',
    tick,
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
      glowMat.dispose();
      shaftMat.dispose();
      moteMat.dispose();
    },
  };
}

/** Build a procedural stand-in for a model key. */
export function createStandIn(model: string, tint: number | undefined, faction: Faction, theme: ThemeId = 'crypt'): Figure {
  const k = model.toLowerCase();
  if (k === 'rest_site') return buildRestSite(theme);
  const col = tint ?? FACTION_TINT[faction];
  if (k === 'chest_boss' || k === 'boss_chest') return buildChest(true);
  if (k === 'chest' || k.includes('chest')) return buildChest(false);
  if (/(slime|ooze|blob|cube|jelly|pudding)/.test(k)) return buildBlob(tint ?? 0x6fbf5a);
  if (/(wolf|rat|dog|boar|bat|spider|beast|bear|cat|lizard|snake|worm)/.test(k)) return buildBeast(k, tint ?? 0x8a6a4a);
  return buildHumanoid(k, col, faction);
}

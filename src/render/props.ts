import { Color, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D } from 'three';
import type { BufferGeometry, Group } from 'three';
import { CellKind } from '../core/types';
import type { FloorPlan, PropPlacement } from '../core/types';
import type { Bake } from './bake';
import type { Fow } from './fow';
import { GeoBuilder } from './gb';
import type { ThemeLook } from './themeLooks';
import { CELL, hash2 } from './util';

interface PropGeo {
  lit: BufferGeometry | null;
  glow: BufferGeometry | null;
  /** How the glow part is tinted and animated. */
  glowKind?: 'flame' | 'steady';
}

type Builder = (look: ThemeLook) => PropGeo;

const flameParts = (g: GeoBuilder, x: number, y: number, z: number, s = 1): void => {
  g.cone(0.13 * s, 0.42 * s, 6, 0xffffff, { x, y: y + 0.2 * s, z, shade: 1.0 });
  g.cone(0.08 * s, 0.3 * s, 5, 0xffffff, { x: x + 0.02 * s, y: y + 0.17 * s, z, rz: 0.2, shade: 1.9 });
  g.cone(0.07 * s, 0.26 * s, 5, 0xffffff, { x: x - 0.05 * s, y: y + 0.13 * s, z: z + 0.03, rz: -0.35, shade: 1.3 });
};

const BUILDERS: Record<string, Builder> = {
  torch: (look) => {
    const p = look.prop;
    const lit = new GeoBuilder();
    lit.box(0.26, 0.46, 0.08, p.iron, { y: 1.0, z: -0.93 });
    lit.box(0.07, 0.07, 0.34, p.iron, { y: 1.12, z: -0.76 });
    lit.cyl(0.14, 0.08, 0.2, 6, p.iron, { y: 1.2, z: -0.6 });
    lit.cyl(0.16, 0.16, 0.04, 6, 0x6a5a4a, { y: 1.31, z: -0.6 });
    lit.box(0.06, 0.4, 0.06, p.woodDark, { y: 1.05, z: -0.6, rx: 0.0 });
    const glow = new GeoBuilder();
    flameParts(glow, 0, 1.3, -0.6, 1.15);
    return { lit: lit.build(), glow: glow.build(), glowKind: 'flame' };
  },
  rubble: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const rocks: [number, number, number, number, number][] = [
      [-0.3, 0.12, -0.2, 0.3, p.stone],
      [0.35, 0.1, 0.1, 0.24, p.stoneDark],
      [-0.1, 0.1, 0.4, 0.22, p.stone],
      [0.1, 0.08, -0.45, 0.18, p.stoneDark],
      [0.5, 0.06, -0.4, 0.14, p.stone],
      [-0.55, 0.07, 0.25, 0.15, p.stoneDark],
    ];
    rocks.forEach(([x, y, z, r, c], i) =>
      g.ico(r, 0, c, { x, y, z, sy: 0.7, ry: i * 1.3, rx: i * 0.4, shade: 0.9 + 0.1 * (i % 3) }),
    );
    return { lit: g.build(), glow: null };
  },
  pillar: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.0, 0.22, 1.0, p.stoneDark, { y: 0.11 });
    g.cyl(0.38, 0.42, 1.9, 8, p.stone, { y: 1.17, shade: 1.0 });
    g.cyl(0.46, 0.4, 0.14, 8, p.stoneDark, { y: 2.18 });
    g.box(1.0, 0.2, 1.0, p.stoneDark, { y: 2.35 });
    for (const a of [0, 1, 2, 3]) {
      g.box(0.05, 1.7, 0.05, p.stoneDark, { x: Math.cos(a * 1.57) * 0.4, z: Math.sin(a * 1.57) * 0.4, y: 1.15, shade: 0.8 });
    }
    return { lit: g.build(), glow: null };
  },
  crate: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(0.95, 0.9, 0.95, p.wood, { y: 0.45 });
    g.box(1.0, 0.1, 1.0, p.woodDark, { y: 0.06 });
    g.box(1.0, 0.1, 1.0, p.woodDark, { y: 0.84 });
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const)
      g.box(0.1, 0.92, 0.1, p.woodDark, { x, z, y: 0.46 });
    g.box(0.55, 0.5, 0.55, p.wood, { x: 0.35, z: 0.5, y: 1.15, ry: 0.4, shade: 1.1 });
    return { lit: g.build(), glow: null };
  },
  barrel: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.cyl(0.4, 0.4, 0.95, 10, p.wood, { y: 0.48 });
    g.cyl(0.46, 0.46, 0.5, 10, p.wood, { y: 0.48, shade: 1.05 });
    g.cyl(0.47, 0.47, 0.07, 10, p.iron, { y: 0.22 });
    g.cyl(0.47, 0.47, 0.07, 10, p.iron, { y: 0.74 });
    g.cyl(0.38, 0.38, 0.04, 10, p.woodDark, { y: 0.97 });
    return { lit: g.build(), glow: null };
  },
  bones: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.ico(0.16, 0, p.bone, { x: -0.25, y: 0.14, z: 0.1, sy: 0.9 });
    g.box(0.1, 0.07, 0.08, p.bone, { x: -0.25, y: 0.06, z: 0.24 });
    g.box(0.65, 0.07, 0.07, p.bone, { x: 0.25, y: 0.04, z: -0.15, ry: 0.5 });
    g.box(0.5, 0.07, 0.07, p.bone, { x: 0.15, y: 0.04, z: 0.35, ry: -0.3 });
    g.box(0.4, 0.06, 0.06, p.bone, { x: -0.2, y: 0.04, z: -0.4, ry: 1.2 });
    for (let i = 0; i < 4; i++) g.box(0.4, 0.05, 0.05, p.bone, { x: 0.45, y: 0.09 + i * 0.01, z: 0.2 + i * 0.1, ry: 0.1 * i, rz: 0.3, shade: 0.95 });
    return { lit: g.build(), glow: null };
  },
  stalagmite: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.cone(0.42, 1.9, 6, p.stone, { y: 0.95, shade: 0.9, top: p.stoneDark });
    g.cone(0.3, 1.1, 5, p.stoneDark, { x: 0.5, z: 0.25, y: 0.55, rz: -0.12, ry: 0.7 });
    g.cone(0.22, 0.7, 5, p.stone, { x: -0.45, z: -0.2, y: 0.35, rz: 0.15 });
    return { lit: g.build(), glow: null };
  },
  mushrooms: (look) => {
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    const stems: [number, number, number, number][] = [
      [0, 0, 0.55, 0.22],
      [0.4, 0.3, 0.35, 0.16],
      [-0.4, 0.2, 0.28, 0.13],
      [0.1, -0.45, 0.4, 0.15],
      [-0.25, -0.35, 0.22, 0.11],
    ];
    for (const [x, z, h, r] of stems) {
      g.cyl(0.05, 0.07, h, 5, 0xd8d0b8, { x, z, y: h / 2 });
      glow.sphere(r, 7, 4, 0xffffff, { x, z, y: h + 0.02, sy: 0.55, shade: 1.0, top: 0xffffff });
      glow.sphere(r * 0.4, 5, 3, 0xffffff, { x, z, y: h + r * 0.45, sy: 0.6, shade: 1.7 });
    }
    return { lit: g.build(), glow: glow.build(), glowKind: 'steady' };
  },
  // Tall glowing mushroom: thick pale stalk, broad domed cap (glow), pale gills underneath.
  giant_mushroom: () => {
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    g.cyl(0.2, 0.3, 0.5, 7, 0xe8e0d0, { y: 0.25, shade: 1.3 }); // swollen foot
    g.cyl(0.17, 0.22, 1.2, 7, 0xf2ece0, { y: 1.0, shade: 1.4 }); // stalk
    g.cyl(0.24, 0.17, 0.3, 7, 0xf2ece0, { y: 1.75, shade: 1.4 }); // flare under the cap
    g.cyl(0.62, 0.3, 0.1, 10, 0xb8b0b8, { y: 1.9, shade: 0.7 }); // gills
    glow.sphere(0.88, 10, 5, 0xffffff, { y: 1.9, sy: 0.55, shade: 1.0, top: 0xffffff }); // cap
    glow.sphere(0.35, 6, 3, 0xffffff, { y: 2.3, sy: 0.5, shade: 1.6 }); // bright crown
    for (const [x, z, h, r] of [[0.55, 0.3, 0.3, 0.13], [-0.4, 0.45, 0.22, 0.1], [-0.35, -0.5, 0.26, 0.12]] as const) {
      g.cyl(0.03, 0.05, h, 5, 0xd8d0b8, { x, z, y: h / 2 });
      glow.sphere(r, 6, 3, 0xffffff, { x, z, y: h + 0.02, sy: 0.55 });
    }
    return { lit: g.build(), glow: glow.build(), glowKind: 'steady' };
  },
  campfire: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.ico(0.17, 0, i % 2 ? p.stone : p.stoneDark, { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, y: 0.1, sy: 0.7, ry: i });
    }
    g.box(0.9, 0.12, 0.12, p.woodDark, { y: 0.14, ry: 0.5, rz: 0.15 });
    g.box(0.9, 0.12, 0.12, p.wood, { y: 0.14, ry: -0.7, rz: -0.15 });
    g.box(0.8, 0.1, 0.1, p.woodDark, { y: 0.2, ry: 2.0 });
    g.cyl(0.4, 0.45, 0.04, 8, 0x1a1410, { y: 0.03 });
    const glow = new GeoBuilder();
    flameParts(glow, 0, 0.15, 0, 2.4);
    glow.cyl(0.3, 0.34, 0.05, 8, 0xffffff, { y: 0.07, shade: 0.8 });
    return { lit: g.build(), glow: glow.build(), glowKind: 'flame' };
  },
  sarcophagus: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.15, 0.75, 1.95, p.stoneDark, { y: 0.38 });
    g.box(1.05, 0.14, 1.85, p.stone, { y: 0.8 });
    g.box(0.8, 0.1, 1.55, p.stone, { y: 0.92, shade: 1.1 });
    g.box(0.5, 0.1, 0.5, p.stone, { y: 1.0, z: -0.55, shade: 1.15 });
    g.box(0.12, 0.08, 0.9, p.stoneDark, { y: 1.0, z: 0.35 });
    g.box(0.5, 0.08, 0.12, p.stoneDark, { y: 1.0, z: 0.1 });
    return { lit: g.build(), glow: null };
  },
  brazier: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      g.box(0.09, 0.85, 0.09, p.iron, { x: Math.cos(a) * 0.22, z: Math.sin(a) * 0.22, y: 0.42, rx: Math.sin(a) * 0.22, rz: -Math.cos(a) * 0.22 });
    }
    g.cyl(0.46, 0.2, 0.3, 8, p.iron, { y: 0.95 });
    g.cyl(0.48, 0.48, 0.06, 8, p.stoneDark, { y: 1.12, shade: 0.7 });
    const glow = new GeoBuilder();
    flameParts(glow, 0, 1.1, 0, 2.0);
    return { lit: g.build(), glow: glow.build(), glowKind: 'flame' };
  },
  statue: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.0, 0.4, 1.0, p.stoneDark, { y: 0.2 });
    g.box(0.8, 0.12, 0.8, p.stone, { y: 0.46 });
    g.cyl(0.14, 0.17, 0.8, 6, p.stone, { x: -0.12, y: 0.98 });
    g.cyl(0.14, 0.17, 0.8, 6, p.stone, { x: 0.12, y: 0.98 });
    g.box(0.5, 0.7, 0.3, p.stone, { y: 1.65, shade: 1.05 });
    g.ico(0.2, 1, p.stone, { y: 2.2, shade: 1.1 });
    g.box(0.14, 0.55, 0.14, p.stone, { x: -0.36, y: 1.7, rz: 0.15 });
    g.box(0.14, 0.7, 0.14, p.stone, { x: 0.38, y: 1.9, z: 0.1, rz: -0.25 });
    g.box(0.07, 1.2, 0.05, p.stoneDark, { x: 0.5, y: 2.4, z: 0.1, rz: -0.25, shade: 1.15 });
    g.box(0.3, 0.07, 0.07, p.stoneDark, { x: 0.46, y: 1.95, z: 0.1, rz: -0.25 });
    return { lit: g.build(), glow: null };
  },
  urn: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.cyl(0.2, 0.28, 0.15, 8, p.clay, { y: 0.08, shade: 0.85 });
    g.sphere(0.36, 8, 6, p.clay, { y: 0.52, sy: 1.05 });
    g.cyl(0.17, 0.26, 0.28, 8, p.clay, { y: 0.9 });
    g.cyl(0.24, 0.17, 0.08, 8, p.clay, { y: 1.08, shade: 1.15 });
    g.box(0.5, 0.05, 0.05, p.woodDark, { y: 0.55, shade: 0.8, ry: 0 });
    g.cyl(0.37, 0.37, 0.06, 8, 0xffffff, { y: 0.5, shade: 0.55, top: 0xffffff });
    return { lit: g.build(), glow: null };
  },
  // Flat drain grate: frame plus bars, nearly flush with the floor.
  grate: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const s = 1.4;
    const t = 0.1;
    g.box(0.9, 0.012, 0.9, 0x0a0c06, { y: 0.004, shade: 0.6 }); // dark drain beneath
    g.box(s, 0.045, t, p.iron, { z: -(s - t) / 2, y: 0.026 });
    g.box(s, 0.045, t, p.iron, { z: (s - t) / 2, y: 0.026 });
    g.box(t, 0.045, s - 2 * t, p.iron, { x: -(s - t) / 2, y: 0.026 });
    g.box(t, 0.045, s - 2 * t, p.iron, { x: (s - t) / 2, y: 0.026 });
    for (let i = 0; i < 5; i++) g.box(0.07, 0.05, s - 2 * t, p.iron, { x: -0.5 + i * 0.25, y: 0.026, shade: 1.15 });
    return { lit: g.build(), glow: null };
  },
  // Wall-mounted outflow pipe (authored for a wall on the -Z side, like torch).
  pipe: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(0.5, 0.5, 0.08, p.iron, { y: 0.9, z: -0.96, shade: 0.9 }); // wall flange
    g.cyl(0.19, 0.19, 0.5, 8, p.iron, { y: 0.9, z: -0.7, rx: Math.PI / 2 });
    g.cyl(0.23, 0.23, 0.07, 8, p.stoneDark, { y: 0.9, z: -0.45, rx: Math.PI / 2, shade: 1.1 }); // lip
    g.cyl(0.14, 0.14, 0.02, 8, 0x0a0c06, { y: 0.9, z: -0.41, rx: Math.PI / 2 }); // dark mouth
    // green stain and dribble
    g.box(0.2, 0.55, 0.02, 0x5c7a2c, { y: 0.55, z: -0.99, shade: 0.8 });
    g.box(0.08, 0.35, 0.02, 0x7a9a3a, { x: 0.1, y: 0.3, z: -0.99, shade: 0.9 });
    g.box(0.3, 0.012, 0.3, 0x5c7a2c, { y: 0.02, z: -0.5, shade: 0.8 }); // puddle
    return { lit: g.build(), glow: null };
  },
  cobweb: () => {
    const g = new GeoBuilder();
    const c = 0xe8e8ec;
    const cx = -0.9;
    const cz = -0.9;
    // fan of spokes in the corner (north-west), then arcs
    const spokes = [0, 0.4, 0.8, 1.17, 1.57];
    for (const a of spokes) {
      const len = 1.5;
      g.box(0.025, 0.025, len, c, { x: cx + Math.cos(a) * len * 0.5 * 0.9, z: cz + Math.sin(a) * len * 0.5 * 0.9, y: 1.5 - len * 0.12, ry: -a + Math.PI / 2 - Math.PI / 2, rx: 0.0 });
    }
    for (let ring = 1; ring <= 3; ring++) {
      const r = ring * 0.4;
      for (let i = 0; i < spokes.length - 1; i++) {
        const a0 = spokes[i]!;
        const a1 = spokes[i + 1]!;
        const x0 = cx + Math.cos(a0) * r;
        const z0 = cz + Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const z1 = cz + Math.sin(a1) * r;
        const len = Math.hypot(x1 - x0, z1 - z0);
        g.box(0.02, 0.02, len, c, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: 1.5 - r * 0.1, ry: Math.atan2(x1 - x0, z1 - z0) });
      }
    }
    g.ico(0.05, 0, 0x222222, { x: cx + 0.7, z: cz + 0.7, y: 1.3 });
    return { lit: g.build(), glow: null };
  },
  crystal: (look) => {
    const glow = new GeoBuilder();
    const defs: [number, number, number, number, number, number][] = [
      [0, 0, 1.3, 0.28, 0, 0],
      [0.4, 0.25, 0.85, 0.2, 0.25, -0.15],
      [-0.35, 0.3, 0.7, 0.18, -0.2, 0.2],
      [0.05, -0.45, 0.6, 0.16, 0.3, 0.1],
    ];
    for (const [x, z, h, r, rz, rx] of defs) {
      glow.octa(r, 0xffffff, { x, z, y: h * 0.5, sy: h / r / 1.4, rz, rx, shade: 1.0, top: 0xffffff });
      glow.octa(r * 0.5, 0xffffff, { x, z, y: h * 0.5, sy: h / r / 1.9, rz, rx, shade: 1.6 });
    }
    const lit = new GeoBuilder();
    lit.cone(0.55, 0.18, 6, look.prop.stoneDark, { y: 0.09 });
    return { lit: lit.build(), glow: glow.build(), glowKind: 'steady' };
  },
  broken_pillar: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.0, 0.22, 1.0, p.stoneDark, { y: 0.11 });
    g.cyl(0.38, 0.42, 0.8, 8, p.stone, { y: 0.62 });
    g.cone(0.38, 0.3, 5, p.stone, { y: 1.15, ry: 0.3, sy: 0.8, rz: 0.1 });
    g.cyl(0.36, 0.36, 0.5, 8, p.stone, { x: 0.65, z: 0.35, y: 0.18, rz: Math.PI / 2, ry: 0.5, shade: 0.9 });
    g.ico(0.14, 0, p.stoneDark, { x: -0.5, z: 0.5, y: 0.1 });
    g.ico(0.1, 0, p.stone, { x: -0.25, z: 0.65, y: 0.07 });
    return { lit: g.build(), glow: null };
  },
  // Authored for a chasm edge on the north (-Z) side: an iron stake and a chain hanging over the lip.
  chain: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.cyl(0.07, 0.09, 0.5, 6, p.iron, { x: -0.35, y: 0.25, z: -0.75 });
    g.cyl(0.16, 0.16, 0.05, 6, p.iron, { x: -0.35, y: 0.5, z: -0.75, rx: Math.PI / 2 });
    g.box(0.3, 0.05, 0.3, p.iron, { x: -0.35, y: 0.03, z: -0.75, shade: 0.8 });
    for (let i = 0; i < 16; i++) {
      const y = 0.45 - i * 0.22;
      g.box(0.07, 0.2, 0.05, p.iron, { x: -0.35, y, z: -1.08 - Math.min(i, 4) * 0.01, ry: (i % 2) * 1.57, shade: 0.85 + 0.1 * (i % 2) });
    }
    g.box(0.3, 0.05, 0.05, p.iron, { x: -0.35, y: 0.55, z: -0.92, rx: 0.4 });
    for (let i = 0; i < 6; i++) g.box(0.07, 0.05, 0.12, p.iron, { x: -0.2 + i * 0.12, y: 0.04, z: -0.6 + Math.sin(i) * 0.12, ry: i, shade: 0.9 });
    return { lit: g.build(), glow: null };
  },
};

const ROCK: Builder = (look) => {
  const g = new GeoBuilder();
  g.ico(0.35, 0, look.prop.stone, { y: 0.2, sy: 0.7 });
  g.ico(0.2, 0, look.prop.stoneDark, { x: 0.4, y: 0.1, z: 0.2, sy: 0.7 });
  return { lit: g.build(), glow: null };
};

const JITTER_YAW = new Set(['rubble', 'bones', 'stalagmite', 'mushrooms', 'giant_mushroom', 'urn', 'crystal', 'barrel', 'crate', 'campfire', 'brazier']);
const SCALE_JITTER = new Set(['rubble', 'stalagmite', 'mushrooms', 'giant_mushroom', 'crystal', 'urn']);

export interface PropField {
  group: Group | null;
  meshes: InstancedMesh[];
  dispose(): void;
}

const _o = new Object3D();
const _col = new Color();
const _S = new Float32Array(3);

/** Build instanced meshes for all props of a floor. One lit + one glow mesh per prop type. */
export function buildProps(
  plan: FloorPlan,
  look: ThemeLook,
  fow: Fow,
  bake: Bake,
  groundY: Float32Array,
  parent: Group,
): PropField {
  const byType = new Map<string, PropPlacement[]>();
  for (const p of plan.props) {
    if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x >= plan.width || p.pos.y >= plan.height) continue;
    const key = BUILDERS[p.type] ? p.type : '_rock';
    let arr = byType.get(key);
    if (!arr) byType.set(key, (arr = []));
    arr.push(p);
  }

  const litMat = new MeshLambertMaterial({ vertexColors: true });
  fow.patch(litMat, { instanced: true });
  const flameMat = new MeshBasicMaterial({ vertexColors: true });
  fow.patch(flameMat, { instanced: true, flicker: 0.16 });
  const steadyMat = new MeshBasicMaterial({ vertexColors: true });
  fow.patch(steadyMat, { instanced: true, flicker: 0.07 });

  const kindAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= plan.width || y >= plan.height ? CellKind.Void : plan.kinds[y * plan.width + x]!;
  const isWall = (x: number, y: number): boolean => kindAt(x, y) === CellKind.Wall;
  /** Corner (0 NW, 1 NE, 2 SE, 3 SW) of a cell where two walls meet; hash fallback. */
  const cornerOf = (x: number, y: number, h: number): number => {
    const cands: number[] = [];
    if (isWall(x, y - 1) && isWall(x - 1, y)) cands.push(0);
    if (isWall(x, y - 1) && isWall(x + 1, y)) cands.push(1);
    if (isWall(x, y + 1) && isWall(x + 1, y)) cands.push(2);
    if (isWall(x, y + 1) && isWall(x - 1, y)) cands.push(3);
    if (cands.length === 0) {
      // single wall side: pick a corner on that side
      if (isWall(x, y - 1)) cands.push(0, 1);
      else if (isWall(x + 1, y)) cands.push(1, 2);
      else if (isWall(x, y + 1)) cands.push(2, 3);
      else if (isWall(x - 1, y)) cands.push(3, 0);
      else cands.push(0, 1, 2, 3);
    }
    return cands[Math.floor(h * cands.length) % cands.length]!;
  };
  /** Side (0 N, 1 E, 2 S, 3 W) of the first neighbour of the given kind, else the fallback. */
  const edgeOf = (x: number, y: number, kind: number, fallback: number): number => {
    const d: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i++) if (kindAt(x + d[i]![0], y + d[i]![1]) === kind) return i;
    return fallback;
  };
  const geos: BufferGeometry[] = [];
  const meshes: InstancedMesh[] = [];

  for (const [type, list] of byType) {
    const built = (BUILDERS[type] ?? ROCK)(look);
    const n = list.length;
    const lit = built.lit ? new InstancedMesh(built.lit, litMat, n) : null;
    const glow = built.glow ? new InstancedMesh(built.glow, built.glowKind === 'flame' ? flameMat : steadyMat, n) : null;
    if (built.lit) geos.push(built.lit);
    if (built.glow) geos.push(built.glow);
    const wallMounted = type === 'torch' || type === 'pipe';
    list.forEach((p, i) => {
      const gi = p.pos.y * plan.width + p.pos.x;
      let gy = groundY[gi]!;
      if (gy !== gy) gy = (plan.elevation[gi] ?? 0) * 1;
      const h1 = hash2(p.pos.x, p.pos.y, 41);
      const h2 = hash2(p.pos.x, p.pos.y, 42);
      _o.position.set(p.pos.x * CELL + CELL / 2, gy, p.pos.y * CELL + CELL / 2);
      const q = ((p.rotation % 4) + 4) % 4;
      let yaw = wallMounted ? -q * (Math.PI / 2) : q * (Math.PI / 2);
      if (type === 'cobweb') yaw = -cornerOf(p.pos.x, p.pos.y, h1) * (Math.PI / 2);
      else if (type === 'chain') yaw = -edgeOf(p.pos.x, p.pos.y, CellKind.Chasm, q) * (Math.PI / 2);
      if (JITTER_YAW.has(type)) yaw += (h1 - 0.5) * 0.6;
      _o.rotation.set(0, yaw, 0);
      const s = SCALE_JITTER.has(type) ? 0.88 + h2 * 0.28 : 1;
      _o.scale.set(s, s * (SCALE_JITTER.has(type) ? 0.9 + h1 * 0.25 : 1), s);
      _o.updateMatrix();
      lit?.setMatrixAt(i, _o.matrix);
      glow?.setMatrixAt(i, _o.matrix);
      if (lit) {
        bake.sample(_o.position.x, _o.position.z, _S);
        _col.setRGB(_S[0]!, _S[1]!, _S[2]!, 'srgb-linear');
        lit.setColorAt(i, _col);
      }
      if (glow) {
        const idx = Math.floor(h1 * 1000);
        if (built.glowKind === 'flame') {
          _col.setHex(look.altShare > 0 && hash2(p.pos.x, p.pos.y, 43) < look.altShare ? look.flameAlt : look.flame);
        } else if (type === 'mushrooms' || type === 'giant_mushroom') _col.setHex(look.mushroom);
        else _col.setHex(look.crystal[idx % look.crystal.length]!);
        glow.setColorAt(i, _col);
      }
    });
    for (const m of [lit, glow]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) (m.instanceColor as InstancedBufferAttribute).needsUpdate = true;
      m.frustumCulled = false;
      m.castShadow = m === lit && type !== 'cobweb';
      m.receiveShadow = m === lit;
      parent.add(m);
      meshes.push(m);
    }
  }

  return {
    group: null,
    meshes,
    dispose() {
      for (const m of meshes) {
        parent.remove(m);
        m.dispose();
      }
      for (const g of geos) g.dispose();
      litMat.dispose();
      flameMat.dispose();
      steadyMat.dispose();
    },
  };
}

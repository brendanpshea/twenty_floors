import { Color, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D } from 'three';
import type { BufferGeometry, Group } from 'three';
import { CellKind } from '../core/types';
import type { FloorPlan, PropPlacement } from '../core/types';
import type { Bake } from './bake';
import type { Fow } from './fow';
import { GeoBuilder } from './gb';
import type { ThemeLook } from './themeLooks';
import { CELL, hash2, propScatter } from './util';

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
    if (look.detail) {
      // Floor-detail themes: rubble is scenery, not a pickup or an obstacle. Low, flat chips close to the floor's own
      // colour, so it reads as part of the floor rather than as something to click.
      const a = tintToward(p.stone, look.floorB, 0.55);
      const b = tintToward(p.stoneDark, look.floorA, 0.45);
      const chips: [number, number, number, number][] = [
        [-0.3, -0.2, 0.17, a], [0.3, 0.1, 0.14, b], [-0.05, 0.38, 0.12, a], [0.12, -0.42, 0.1, b],
        [0.48, -0.35, 0.08, a], [-0.52, 0.22, 0.09, b], [0.05, 0.05, 0.07, a], [-0.35, 0.5, 0.06, b],
      ];
      chips.forEach(([x, z, r, c], i) => g.ico(r, 0, c, { x, y: r * 0.25, z, sy: 0.4, ry: i * 1.3, rx: i * 0.3, shade: 0.95 + 0.05 * (i % 2) }));
      return { lit: g.build(), glow: null };
    }
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
    const p = { ...look.prop };
    // Floor-detail themes: old bones, dulled toward the floor, so they read as scenery.
    if (look.detail) p.bone = tintToward(p.bone, look.floorA, 0.4);
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
  // Cluster of faceted ice shards (tallest ~2 units). Pale lit facets with a faint self-lit tip each.
  ice_spike: () => {
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    const shards: [number, number, number, number, number, number, number][] = [
      // x, z, height, radius, tilt z, tilt x, yaw
      [0, 0, 2.0, 0.36, 0.04, -0.03, 0.2],
      [0.5, 0.28, 1.3, 0.27, -0.16, -0.1, 0.9],
      [-0.46, 0.2, 1.0, 0.23, 0.2, 0.08, 0.5],
      [0.05, -0.5, 0.65, 0.2, 0.1, 0.3, 1.3],
    ];
    shards.forEach(([x, z, h, r, rz, rx, ry], i) => {
      g.cone(r, h, 4 + (i % 2), 0x6fa4d6, { x, z, y: h / 2, rz, rx, ry, shade: 1.15, top: 0xe4f6ff });
      // faint inner glow: a slim shard poking out of the tip region
      glow.cone(r * 0.32, h * 0.42, 4, 0xffffff, { x: x - rz * h * 0.28, z: z + rx * h * 0.28, y: h * 0.62, rz, rx, ry, shade: 0.5 });
    });
    return { lit: g.build(), glow: glow.build(), glowKind: 'steady' };
  },
  // Low rounded mound of snow, about 1.6 across and 0.3 high.
  snow_drift: () => {
    const g = new GeoBuilder();
    g.sphere(0.8, 12, 5, 0xeaf2fa, { y: 0, sy: 0.38, top: 0xfafdff, shade: 1.0 });
    g.sphere(0.5, 10, 4, 0xf0f6fc, { x: 0.45, z: 0.3, y: 0, sy: 0.4, top: 0xffffff, shade: 1.0 });
    g.sphere(0.36, 8, 3, 0xe4eef8, { x: -0.5, z: -0.25, y: 0, sy: 0.4, top: 0xf8fcff, shade: 1.0 });
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
    glow.cyl(0.9, 0.86, 0.1, 10, 0xffffff, { y: 1.88, shade: 0.55 }); // darker rim, so the cap reads as a dome
    glow.sphere(0.35, 6, 3, 0xffffff, { y: 2.3, sy: 0.5, shade: 1.6 }); // bright crown
    for (const [x, z] of [[0.45, 0.2], [-0.35, 0.4], [-0.1, -0.5], [0.3, -0.35]] as const) glow.sphere(0.1, 5, 3, 0xffffff, { x, z, y: 2.12, sy: 0.4, shade: 1.9 }); // spots
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
  // Low wooden bed (long axis along Z): frame, legs, straw mattress, rolled blanket and a pillow.
  bunk: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    for (const [x, z] of [[-0.42, -0.82], [0.42, -0.82], [-0.42, 0.82], [0.42, 0.82]] as const)
      g.box(0.12, 0.3, 0.12, p.woodDark, { x, z, y: 0.15 });
    g.box(1.0, 0.1, 1.8, p.wood, { y: 0.3 }); // frame
    g.box(1.0, 0.3, 0.1, p.woodDark, { z: -0.85, y: 0.45 }); // headboard
    g.box(1.0, 0.2, 0.1, p.woodDark, { z: 0.85, y: 0.4 }); // footboard
    g.box(0.84, 0.14, 1.6, 0xc8a85a, { y: 0.42, shade: 1.0, top: 0xe0c070 }); // straw mattress
    g.box(0.5, 0.1, 0.34, 0xe8dcc0, { z: -0.58, y: 0.53, shade: 1.0 }); // pillow
    g.cyl(0.13, 0.13, 0.84, 8, 0x7a2a22, { z: 0.5, y: 0.56, rz: Math.PI / 2 }); // rolled red blanket
    return { lit: g.build(), glow: null };
  },
  // Sturdy trestle table (long axis along Z) with a couple of mugs and a bowl.
  table: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.2, 0.1, 1.8, p.wood, { y: 0.85 }); // top
    g.box(1.2, 0.04, 0.5, p.woodDark, { y: 0.9, z: -0.45, shade: 0.7 }); // worn stain
    for (const z of [-0.65, 0.65]) {
      g.box(0.1, 0.8, 0.1, p.woodDark, { x: -0.5, z, y: 0.4 });
      g.box(0.1, 0.8, 0.1, p.woodDark, { x: 0.5, z, y: 0.4 });
      g.box(1.1, 0.08, 0.08, p.woodDark, { z, y: 0.2 }); // stretcher
    }
    g.box(0.08, 0.08, 1.4, p.woodDark, { y: 0.2 }); // long stretcher
    g.cyl(0.09, 0.08, 0.15, 7, p.clay, { x: -0.3, z: -0.5, y: 1.0 });
    g.cyl(0.09, 0.08, 0.15, 7, p.iron, { x: 0.25, z: 0.2, y: 1.0, shade: 1.2 });
    g.cyl(0.2, 0.1, 0.12, 8, p.clay, { x: 0.1, z: -0.2, y: 0.97, shade: 1.1 }); // bowl
    g.box(0.18, 0.04, 0.3, p.bone, { x: -0.2, z: 0.55, y: 0.92, ry: 0.3 }); // scrap of bread board
    return { lit: g.build(), glow: null };
  },
  // Weapon rack against the wall on the -Z side (authored like torch): frame, rail and spears/swords.
  weapon_rack: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const z = -0.7;
    for (const x of [-0.75, 0.75]) {
      g.box(0.1, 1.6, 0.1, p.woodDark, { x, z, y: 0.8 }); // uprights
      g.box(0.1, 0.08, 0.5, p.woodDark, { x, z: z + 0.1, y: 0.04 }); // feet
    }
    g.box(1.6, 0.1, 0.1, p.wood, { z, y: 1.5 }); // top bar
    g.box(1.5, 0.1, 0.1, p.wood, { z, y: 0.55 }); // lower bar
    g.box(1.4, 0.07, 0.1, p.wood, { z: z + 0.1, y: 0.95, shade: 1.1 }); // rest rail
    // spears (long, leaning slightly), swords (short, hilt up)
    const spears: [number, number][] = [[-0.5, 0.04], [-0.25, -0.03]];
    for (const [x, rz] of spears) {
      g.box(0.05, 1.7, 0.05, p.wood, { x, z: z + 0.1, y: 0.9, rz, shade: 1.1 });
      g.cone(0.07, 0.24, 4, p.iron, { x: x - rz * 0.85, z: z + 0.1, y: 1.85, rz, shade: 1.3 });
    }
    for (const [x, rz] of [[0.2, -0.05], [0.5, 0.03]] as const) {
      g.box(0.09, 0.8, 0.03, p.iron, { x, z: z + 0.1, y: 0.95, rz, shade: 1.25 }); // blade
      g.box(0.3, 0.05, 0.06, p.woodDark, { x, z: z + 0.1, y: 1.4 }); // guard
      g.box(0.05, 0.2, 0.05, p.wood, { x, z: z + 0.1, y: 1.53 }); // grip
    }
    return { lit: g.build(), glow: null };
  },
  // Wall banner (authored for a wall on the -Z side like torch): pole, red cloth, dark emblem, tattered hem.
  banner: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const z = -0.93;
    g.box(1.1, 0.07, 0.07, p.woodDark, { z, y: 2.0 }); // pole
    g.box(0.1, 0.1, 0.1, p.iron, { x: -0.58, z, y: 2.0 });
    g.box(0.1, 0.1, 0.1, p.iron, { x: 0.58, z, y: 2.0 });
    g.box(0.06, 0.12, 0.1, p.iron, { x: -0.3, z: z + 0.05, y: 1.96 });
    g.box(0.06, 0.12, 0.1, p.iron, { x: 0.3, z: z + 0.05, y: 1.96 });
    g.box(0.9, 1.15, 0.04, 0x5a1212, { z: z + 0.06, y: 1.38, top: 0x741818 }); // cloth
    for (const [x, w, h] of [[-0.3, 0.3, 0.3], [0.0, 0.3, 0.42], [0.3, 0.3, 0.26]] as const)
      g.box(w, h, 0.04, 0x5a1212, { x, z: z + 0.06, y: 0.8 - h / 2 + 0.1, shade: 1.0 }); // tattered strips
    g.box(0.2, 0.2, 0.05, 0x2a1210, { z: z + 0.07, y: 1.6, ry: 0, rz: Math.PI / 4 }); // emblem diamond
    g.box(0.5, 0.1, 0.05, 0x2a1210, { z: z + 0.07, y: 1.15 }); // stripe
    g.box(0.1, 0.34, 0.05, 0x2a1210, { z: z + 0.07, y: 1.3 }); // stripe
    return { lit: g.build(), glow: null };
  },
  // Palisade segment (row along X): a row of sharpened logs with a binding rail.
  palisade: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const xs = [-0.78, -0.39, 0, 0.39, 0.78];
    xs.forEach((x, i) => {
      const h = 1.8 + ((i * 37) % 5) * 0.04;
      const rz = ((i % 3) - 1) * 0.02;
      g.cyl(0.2, 0.22, h, 6, i % 2 ? p.wood : p.woodDark, { x, y: h / 2, rz, shade: 0.95 + 0.05 * (i % 3) });
      g.cone(0.2, 0.34, 6, p.wood, { x, y: h + 0.15, rz, shade: 1.15 }); // sharpened tip
    });
    g.box(1.9, 0.1, 0.08, p.woodDark, { z: 0.2, y: 0.55, shade: 0.8 });
    g.box(1.9, 0.1, 0.08, p.woodDark, { z: 0.2, y: 1.25, shade: 0.8 });
    return { lit: g.build(), glow: null };
  },
  // Straw training dummy on a post: base, post, crossbar arms, sack torso and head, painted target.
  dummy: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const straw = 0xc8a860;
    g.box(0.7, 0.1, 0.7, p.woodDark, { y: 0.05 }); // base plate
    g.cyl(0.08, 0.1, 1.9, 6, p.wood, { y: 0.95 }); // post
    g.box(1.3, 0.1, 0.1, p.wood, { y: 1.4 }); // crossbar arms
    g.cyl(0.12, 0.12, 0.1, 6, straw, { x: -0.68, y: 1.4, rz: Math.PI / 2, shade: 1.1 }); // bound hands
    g.cyl(0.12, 0.12, 0.1, 6, straw, { x: 0.68, y: 1.4, rz: Math.PI / 2, shade: 1.1 });
    g.cyl(0.32, 0.28, 0.75, 8, 0xb89860, { y: 1.3, shade: 1.0 }); // sack torso
    g.cyl(0.33, 0.33, 0.06, 8, p.woodDark, { y: 1.1, shade: 0.8 }); // belt rope
    g.sphere(0.24, 8, 6, 0xd0b878, { y: 1.9, shade: 1.05 }); // head
    g.box(0.3, 0.04, 0.3, 0xe0d0a0, { y: 1.72, shade: 0.9 }); // neck tie
    g.cyl(0.22, 0.22, 0.03, 10, 0xa82a22, { y: 1.35, z: 0.3, rx: Math.PI / 2 }); // target (outer)
    g.cyl(0.14, 0.14, 0.035, 10, 0xe8dcc0, { y: 1.35, z: 0.3, rx: Math.PI / 2 });
    g.cyl(0.06, 0.06, 0.04, 8, 0xa82a22, { y: 1.35, z: 0.3, rx: Math.PI / 2 });
    return { lit: g.build(), glow: null };
  },
  // Tall double-sided bookcase (long axis along X, ~1.9 x 0.7 x 2.4): panelled frame, 4 shelves of book spines.
  bookshelf: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const L = 1.9;
    const D = 0.7;
    g.box(L, 0.14, D, p.woodDark, { y: 0.07 }); // plinth
    g.box(L, 0.1, D, p.woodDark, { y: 2.35 }); // cornice
    g.box(L + 0.06, 0.05, D + 0.06, p.wood, { y: 2.42, shade: 1.1 }); // cap
    for (const x of [-L / 2 + 0.05, L / 2 - 0.05]) g.box(0.1, 2.3, D, p.wood, { x, y: 1.25 }); // end panels
    g.box(L - 0.2, 2.2, 0.05, p.woodDark, { y: 1.25 }); // central back panel
    const spine = [0x7a3a3a, 0x3a5272, 0x3e6050, 0x86703c, 0x5e4268, 0x8c7c5c, 0x4a4a58];
    const bottoms = [0.14, 0.67, 1.2, 1.73];
    const x0 = -L / 2 + 0.1;
    const x1 = L / 2 - 0.1;
    for (let sh = 0; sh < 4; sh++) {
      const yb = bottoms[sh]!;
      g.box(L - 0.2, 0.05, D - 0.04, p.wood, { y: yb + 0.025, shade: 1.1 }); // board
      for (const side of [-1, 1]) {
        let x = x0 + 0.04;
        let i = sh * 7 + (side > 0 ? 3 : 0);
        while (x < x1 - 0.12) {
          const hv = (i * 37 + 11) % 17;
          const w = 0.14 + (hv % 4) * 0.055;
          if (x + w > x1 - 0.03) break;
          i++;
          if (hv === 5 || hv === 11) {
            x += 0.2; // gap
            continue;
          }
          const h = 0.34 + (hv % 5) * 0.026;
          const lean = hv === 7 ? 0.22 : 0;
          g.box(w, h, 0.27, spine[(hv + sh * 2 + (side > 0 ? 1 : 0)) % spine.length]!, {
            x: x + w / 2,
            z: side * 0.17,
            y: yb + 0.05 + h / 2,
            rz: lean,
            shade: 0.85 + (hv % 3) * 0.12,
          });
          x += w + 0.005;
        }
      }
    }
    return { lit: g.build(), glow: null };
  },
  // Reading desk (long axis along X, ~1.6 x 1.0 x 0.85): slanted top, open book, inkwell and quill, side panels.
  desk: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    for (const x of [-0.7, 0.7]) {
      g.box(0.09, 0.78, 0.86, p.woodDark, { x, y: 0.39 }); // trestle ends
      g.box(0.14, 0.06, 0.96, p.woodDark, { x, y: 0.03 });
    }
    g.box(1.3, 0.08, 0.08, p.woodDark, { y: 0.25 }); // stretcher
    g.box(1.5, 0.3, 0.05, p.wood, { y: 0.5, z: 0.4, shade: 0.9 }); // modesty panel
    g.box(1.6, 0.07, 1.0, p.wood, { y: 0.84, rx: -0.08, shade: 1.05 }); // top, slightly sloped
    g.box(1.6, 0.05, 0.06, p.woodDark, { y: 0.88, z: 0.48 }); // lip
    g.box(0.52, 0.03, 0.4, 0xe4dcc0, { x: -0.18, y: 0.9, z: -0.02, ry: 0.15, shade: 1.0 }); // open book pages
    g.box(0.57, 0.02, 0.44, 0x5e2e2e, { x: -0.18, y: 0.89, z: -0.02, ry: 0.15 }); // cover
    g.box(0.03, 0.04, 0.4, 0x2a1c14, { x: -0.18, y: 0.915, z: -0.02, ry: 0.15 }); // spine fold
    g.cyl(0.06, 0.07, 0.1, 6, p.iron, { x: 0.45, y: 0.94, z: -0.2, shade: 1.3 }); // inkwell
    g.box(0.03, 0.03, 0.34, 0xe8e4d8, { x: 0.52, y: 1.0, z: -0.12, rx: 0.4, ry: 0.3 }); // quill
    g.box(0.3, 0.05, 0.22, 0x3a5272, { x: 0.5, y: 0.93, z: 0.22, ry: -0.3 }); // closed book
    return { lit: g.build(), glow: null };
  },
  // Standing lectern (authored facing -Z): base, single column, slanted top with an open book.
  lectern: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(0.7, 0.1, 0.6, p.woodDark, { y: 0.05 });
    g.cyl(0.18, 0.26, 0.2, 6, p.wood, { y: 0.2 });
    g.cyl(0.13, 0.16, 0.8, 6, p.wood, { y: 0.7, shade: 1.1 }); // column
    g.cyl(0.2, 0.14, 0.14, 6, p.woodDark, { y: 1.15 });
    g.box(0.85, 0.07, 0.62, p.wood, { y: 1.26, z: 0.0, rx: -0.5, shade: 1.1 }); // slanted desk
    g.box(0.85, 0.07, 0.08, p.woodDark, { y: 1.13, z: -0.26 }); // lip
    g.box(0.58, 0.03, 0.4, 0xe4dcc0, { y: 1.325, z: 0.02, rx: -0.5 }); // pages
    g.box(0.64, 0.025, 0.45, 0x2e4a64, { y: 1.31, z: 0.02, rx: -0.5 }); // cover
    g.box(0.03, 0.04, 0.4, 0x1c1c26, { y: 1.345, z: 0.02, rx: -0.5 }); // spine fold
    return { lit: g.build(), glow: null };
  },
  // Small heap of books on the floor: a few flat, a stack, a couple open, one leaning.
  book_pile: () => {
    const g = new GeoBuilder();
    const cols = [0x7a3a3a, 0x3a5272, 0x3e6050, 0x86703c, 0x5e4268, 0x8c7c5c];
    const book = (x: number, y: number, z: number, w: number, d: number, ry: number, c: number, o: { rz?: number } = {}): void => {
      g.box(w, 0.09, d, c, { x, y: y + 0.045, z, ry, rz: o.rz });
      g.box(w - 0.02, 0.06, d - 0.02, 0xe4dcc0, { x: x + Math.sin(ry) * 0.01, y: y + 0.045, z: z + Math.cos(ry) * 0.01, ry, rz: o.rz, shade: 0.9 });
    };
    book(0.0, 0.0, 0.0, 0.5, 0.36, 0.2, cols[0]!);
    book(0.02, 0.09, 0.0, 0.44, 0.32, -0.15, cols[1]!);
    book(0.0, 0.18, 0.01, 0.36, 0.28, 0.5, cols[3]!);
    book(0.55, 0.0, -0.25, 0.42, 0.3, 1.1, cols[2]!);
    book(-0.5, 0.0, 0.3, 0.4, 0.3, -0.7, cols[4]!);
    // open book: cover plus two page fans in a shallow V
    g.box(0.5, 0.03, 0.34, 0x5e2e2e, { x: 0.3, y: 0.015, z: 0.45, ry: 0.4 });
    g.box(0.24, 0.03, 0.3, 0xe4dcc0, { x: 0.3 - 0.12 * Math.cos(0.4), y: 0.045, z: 0.45 + 0.12 * Math.sin(0.4), ry: 0.4, rz: 0.12 });
    g.box(0.24, 0.03, 0.3, 0xe4dcc0, { x: 0.3 + 0.12 * Math.cos(0.4), y: 0.045, z: 0.45 - 0.12 * Math.sin(0.4), ry: 0.4, rz: -0.12 });
    g.box(0.34, 0.07, 0.24, cols[5]!, { x: -0.35, y: 0.035, z: -0.4, ry: 0.9 });
    g.box(0.3, 0.07, 0.04, cols[0]!, { x: -0.1, y: 0.16, z: -0.55, ry: 0.2, rz: 0.9 }); // leaning
    return { lit: g.build(), glow: null };
  },
  // Tall iron floor candelabra (~1.9 high): tripod foot, shaft, three arms with candles and cold arcane flames.
  candelabra: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    g.cyl(0.3, 0.38, 0.1, 6, p.iron, { y: 0.05 });
    g.cyl(0.12, 0.2, 0.25, 6, p.iron, { y: 0.22, shade: 1.15 });
    g.cyl(0.05, 0.07, 1.15, 6, p.iron, { y: 0.95, shade: 1.1 }); // shaft
    g.sphere(0.1, 6, 4, p.iron, { y: 0.8, shade: 1.2 }); // knop
    g.sphere(0.09, 6, 4, p.iron, { y: 1.45, shade: 1.2 });
    g.box(0.8, 0.05, 0.05, p.iron, { y: 1.5 }); // cross arm
    g.box(0.05, 0.05, 0.05, p.iron, { y: 1.58 });
    for (const x of [-0.4, 0, 0.4]) {
      const yb = x === 0 ? 1.62 : 1.55;
      g.cyl(0.09, 0.05, 0.07, 6, p.iron, { x, y: yb, shade: 1.2 }); // cup
      g.cyl(0.045, 0.05, 0.26, 6, 0xd8d4c4, { x, y: yb + 0.16 }); // candle
      flameParts(glow, x, yb + 0.28, 0, 1.0);
    }
    g.box(0.05, 0.12, 0.05, p.iron, { x: -0.4, y: 1.5 });
    g.box(0.05, 0.12, 0.05, p.iron, { x: 0.4, y: 1.5 });
    return { lit: g.build(), glow: glow.build(), glowKind: 'flame' };
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
  // Squat hearth (authored with its opening on -Z): brick cheeks, stone cap, hooded chimney stub, glowing coals inside.
  forge: (look) => {
    const p = look.prop;
    const brick = 0x7a4a3c;
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    g.box(1.76, 0.12, 1.76, p.stoneDark, { y: 0.06 }); // plinth
    // back wall and cheeks in alternating brick courses
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + 0.22 * i + 0.11;
      const sh = i % 2 ? 1.08 : 0.9;
      const c = i % 2 ? brick : p.stone;
      g.box(1.7, 0.21, 0.5, c, { y, z: 0.6, shade: sh });
      g.box(0.46, 0.21, 1.22, c, { x: -0.62, y, z: -0.25, shade: sh * 0.95 });
      g.box(0.46, 0.21, 1.22, c, { x: 0.62, y, z: -0.25, shade: sh * 0.95 });
    }
    g.box(0.82, 0.28, 1.2, p.stoneDark, { y: 0.26, z: -0.25, shade: 0.8 }); // hearth floor
    g.box(0.84, 0.16, 1.22, p.stone, { y: 0.98, z: -0.25 }); // lintel over the opening
    g.box(0.9, 0.06, 0.1, p.iron, { y: 0.88, z: -0.82, shade: 1.3 }); // iron lintel bar
    g.box(1.78, 0.18, 1.78, p.stone, { y: 1.13, shade: 1.1 }); // cap slab
    // hood and chimney stub
    g.cyl(0.3, 0.62, 0.32, 4, p.stoneDark, { y: 1.38, z: 0.25, ry: Math.PI / 4 });
    g.cyl(0.2, 0.22, 0.5, 6, p.stone, { y: 1.78, z: 0.25, shade: 1.0 });
    g.box(0.5, 0.07, 0.5, p.stoneDark, { y: 2.05, z: 0.25 });
    // poker leaning on the cheek
    g.box(0.04, 0.9, 0.04, p.iron, { x: 0.98, y: 0.5, z: -0.7, rz: -0.15, shade: 1.2 });
    // interior is dark; the glow is coals, a back wall of heat and a little flame
    g.box(0.8, 0.4, 0.04, 0x1a1010, { y: 0.68, z: 0.35 });
    glow.box(0.8, 0.07, 1.15, 0xffffff, { y: 0.43, z: -0.22, shade: 0.9 }); // coal bed
    glow.box(0.7, 0.3, 0.04, 0xffffff, { y: 0.62, z: 0.32, shade: 0.8 });
    const coals: [number, number, number][] = [[-0.25, -0.5, 0.11], [0.2, -0.3, 0.13], [-0.1, 0.0, 0.12], [0.25, 0.15, 0.1], [-0.28, 0.2, 0.09], [0.0, -0.65, 0.09]];
    for (const [x, z, r] of coals) glow.ico(r, 0, 0xffffff, { x, y: 0.5, z, sy: 0.6, shade: 1.5 });
    flameParts(glow, 0.0, 0.46, -0.15, 0.85);
    return { lit: g.build(), glow: glow.build(), glowKind: 'flame' };
  },
  // Iron anvil on a wooden block, ~0.9 high (authored with the horn toward -Z), hammer resting on the face.
  anvil: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.cyl(0.3, 0.34, 0.42, 8, p.wood, { y: 0.21 }); // block
    g.cyl(0.33, 0.33, 0.04, 8, p.woodDark, { y: 0.4, shade: 0.9 });
    g.box(0.3, 0.07, 0.52, p.iron, { y: 0.45, shade: 1.5 }); // foot
    g.box(0.2, 0.2, 0.3, p.iron, { y: 0.58, shade: 1.7 }); // waist
    g.box(0.3, 0.12, 0.62, p.iron, { y: 0.72, z: 0.02, shade: 2.1 }); // face
    g.box(0.3, 0.1, 0.12, p.iron, { y: 0.7, z: 0.4, shade: 1.7 }); // heel
    g.cone(0.15, 0.4, 4, p.iron, { y: 0.72, z: -0.5, rx: -Math.PI / 2, ry: Math.PI / 4, shade: 1.9 }); // horn
    g.box(0.05, 0.02, 0.05, 0x14141a, { y: 0.785, z: 0.18 }); // hardy hole
    g.box(0.42, 0.04, 0.04, p.wood, { x: 0.02, y: 0.8, z: 0.08, ry: 0.25 }); // hammer shaft
    g.box(0.1, 0.1, 0.18, p.iron, { x: 0.22, y: 0.82, z: 0.03, ry: 0.25, shade: 1.5 }); // hammer head
    return { lit: g.build(), glow: null };
  },
  // Fat iron pot (~1.1 across, 1.0 high) on three stubby legs, filled to the brim with molten metal.
  crucible: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      g.cyl(0.08, 0.1, 0.36, 5, p.iron, { x: Math.cos(a) * 0.36, z: Math.sin(a) * 0.36, y: 0.16, shade: 0.9 });
      g.box(0.2, 0.05, 0.2, p.iron, { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4, y: 0.03, shade: 0.8 });
    }
    g.cyl(0.5, 0.36, 0.2, 10, p.iron, { y: 0.35, shade: 1.4 });
    g.cyl(0.58, 0.5, 0.45, 10, p.iron, { y: 0.67, shade: 1.7 }); // belly
    g.cyl(0.54, 0.58, 0.18, 10, p.iron, { y: 0.9, shade: 1.5 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.box(0.22, 0.09, 0.12, p.iron, { x: Math.cos(a) * 0.52, z: Math.sin(a) * 0.52, y: 0.99, ry: -a + Math.PI / 2, shade: 1.35 }); // rim
    }
    g.box(0.26, 0.08, 0.1, p.iron, { x: 0.68, y: 0.8, shade: 1.2 }); // lugs
    g.box(0.26, 0.08, 0.1, p.iron, { x: -0.68, y: 0.8, shade: 1.2 });
    glow.cyl(0.48, 0.48, 0.04, 10, 0xffffff, { y: 0.96, shade: 0.7 }); // molten surface
    glow.cyl(0.26, 0.26, 0.04, 8, 0xffffff, { x: 0.05, y: 0.975, z: -0.05, shade: 1.0, top: 0xffffff });
    glow.ico(0.1, 0, 0xffffff, { x: -0.2, y: 0.97, z: 0.18, sy: 0.4, shade: 1.2 });
    glow.ico(0.08, 0, 0xffffff, { x: 0.25, y: 0.97, z: 0.2, sy: 0.4, shade: 1.2 });
    return { lit: g.build(), glow: glow.build(), glowKind: 'flame' };
  },
  // Neat stack of nine iron bars on a low pallet (~1.3 x 0.9 x 0.6), a couple of them bright.
  ingots: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.3, 0.07, 0.1, p.woodDark, { y: 0.035, z: -0.32 });
    g.box(1.3, 0.07, 0.1, p.woodDark, { y: 0.035, z: 0.32 });
    g.box(1.3, 0.07, 0.1, p.woodDark, { y: 0.035 });
    for (let i = 0; i < 7; i++) g.box(0.12, 0.04, 0.88, p.wood, { x: -0.6 + i * 0.2, y: 0.09, shade: 0.9 + 0.1 * (i % 2) });
    const dull = [0x56565f, 0x4c4c55, 0x5e5e68];
    const put = (x: number, y: number, z: number, along: 'x' | 'z', c: number): void => {
      const [w, d] = along === 'x' ? [0.6, 0.2] : [0.2, 0.6];
      g.box(w, 0.12, d, c, { x, y: y + 0.06, z });
      g.box(along === 'x' ? 0.54 : 0.14, 0.04, along === 'x' ? 0.14 : 0.54, c, { x, y: y + 0.14, z, shade: 1.2 });
    };
    let n = 0;
    for (const x of [-0.31, 0.31]) for (const z of [-0.23, 0.23]) put(x, 0.11, z, 'x', dull[n++ % 3]!);
    [-0.4, 0, 0.4].forEach((x, i) => put(x, 0.27, 0, 'z', i === 1 ? 0xb4b4be : dull[i % 3]!));
    put(0, 0.43, -0.12, 'x', dull[0]!);
    put(0.0, 0.43, 0.12, 'x', 0xc4c4ce);
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
  // Old twisted tree (~3 high, one cell): flared roots, knotted leaning trunk, bare boughs, a few small leaf clusters high up.
  gnarled_tree: (look) => {
    const p = look.prop;
    const bark = 0x7a6448;
    const bark2 = 0x56442f;
    const leaf = p.leaf ?? 0x3f6e32;
    const leafL = p.leafLight ?? 0x7ab04a;
    const g = new GeoBuilder();
    /** A tapered limb from (x,y,z) heading at yaw ry and tilt (from vertical) tz. */
    const limb = (x: number, y: number, z: number, ry: number, tz: number, len: number, r0: number, r1: number, c: number, sh = 1): [number, number, number] => {
      const dx = Math.sin(tz) * Math.cos(ry);
      const dy = Math.cos(tz);
      const dz = -Math.sin(tz) * Math.sin(ry);
      g.cyl(r1, r0, len, 6, c, { x: x + (dx * len) / 2, y: y + (dy * len) / 2, z: z + (dz * len) / 2, rz: -tz, ry, shade: sh });
      return [x + dx * len, y + dy * len, z + dz * len];
    };
    for (let i = 0; i < 6; i++) limb(Math.cos(i * 1.05) * 0.18, 0.12, Math.sin(i * 1.05) * 0.18, i * 1.05, 1.28 - (i % 2) * 0.12, 0.95 - (i % 3) * 0.1, 0.24, 0.05, i % 2 ? bark : bark2, 0.9); // roots
    g.cyl(0.36, 0.5, 0.45, 7, bark2, { y: 0.22, shade: 0.9 }); // flared base
    g.cyl(0.3, 0.38, 0.9, 7, bark, { x: 0.02, y: 0.85, rz: 0.06 });
    g.cyl(0.25, 0.3, 0.9, 7, bark2, { x: 0.1, y: 1.65, rz: -0.1, shade: 1.05 });
    g.cyl(0.18, 0.25, 0.85, 7, bark, { x: 0.04, y: 2.45, rz: 0.12 });
    g.ico(0.2, 0, bark2, { x: 0.25, y: 1.25, z: 0.18, sy: 0.9, shade: 0.85 }); // knots
    g.ico(0.17, 0, bark2, { x: -0.22, y: 2.0, z: -0.15, shade: 0.8 });
    g.ico(0.14, 0, bark, { x: 0.12, y: 0.7, z: -0.3, shade: 1.1 });
    const tips: [number, number, number][] = [];
    tips.push(limb(0.1, 2.5, 0, 0.3, 0.95, 0.95, 0.12, 0.05, bark));
    tips.push(limb(0.05, 2.65, 0, 2.5, 0.8, 0.9, 0.11, 0.045, bark2));
    tips.push(limb(0.05, 2.35, 0, 4.4, 1.05, 0.8, 0.1, 0.04, bark));
    tips.push(limb(0.05, 2.75, 0, 5.5, 0.55, 0.75, 0.09, 0.04, bark2));
    limb(tips[0]![0], tips[0]![1], tips[0]![2], 0.9, 0.9, 0.45, 0.05, 0.025, bark2); // twigs
    limb(tips[1]![0], tips[1]![1], tips[1]![2], 3.0, 0.7, 0.4, 0.045, 0.02, bark);
    g.ico(0.4, 0, leaf, { x: tips[0]![0], y: tips[0]![1] + 0.15, z: tips[0]![2], sy: 0.65, top: leafL });
    g.ico(0.32, 0, leaf, { x: tips[1]![0], y: tips[1]![1] + 0.12, z: tips[1]![2], sy: 0.65, top: leafL, shade: 0.95 });
    g.ico(0.3, 0, leaf, { x: tips[3]![0], y: tips[3]![1] + 0.15, z: tips[3]![2], sy: 0.65, top: leafL });
    g.ico(0.25, 0, leafL, { x: tips[2]![0], y: tips[2]![1] + 0.1, z: tips[2]![2], sy: 0.6, shade: 0.9 });
    return { lit: g.build(), glow: null };
  },
  // Fallen tree trunk (~1.9 long, 0.55 thick) lying along X: bark with a paler cut end, a splintered break, a branch stub, moss.
  log: () => {
    const g = new GeoBuilder();
    const bark = 0x6e4e30;
    const bark2 = 0x543a24;
    const R = 0.275;
    g.cyl(R, R * 1.08, 1.7, 8, bark, { x: 0.05, y: R, rz: Math.PI / 2, shade: 0.95 });
    g.cyl(R * 1.02, R * 1.02, 0.12, 8, bark2, { x: 0.2, y: R, rz: Math.PI / 2, shade: 0.85 }); // bark ridge
    g.cyl(R * 0.96, R * 0.96, 0.05, 8, 0xd2b27c, { x: 0.915, y: R, rz: Math.PI / 2 }); // pale cut end
    g.cyl(R * 0.55, R * 0.55, 0.06, 8, 0xb8935c, { x: 0.94, y: R, rz: Math.PI / 2 }); // growth rings
    g.cone(R * 0.95, 0.4, 7, bark2, { x: -1.0, y: R, rz: Math.PI / 2, shade: 0.9 }); // splintered break
    g.cyl(0.05, 0.1, 0.42, 5, bark2, { x: -0.3, y: R + 0.3, z: 0.18, rx: 0.65, shade: 1.0 }); // branch stub
    g.cyl(0.04, 0.07, 0.3, 5, bark, { x: 0.35, y: R + 0.22, z: -0.2, rx: -0.8, shade: 0.9 });
    g.ico(0.2, 0, 0x5c8a38, { x: 0.15, y: R * 1.85, z: 0.04, sy: 0.32, sx: 1.3, top: 0x86b04a }); // moss
    g.ico(0.14, 0, 0x4e7a30, { x: -0.5, y: R * 1.7, z: -0.1, sy: 0.35, sx: 1.2 });
    return { lit: g.build(), glow: null };
  },
  // Weathered menhir (~0.8 x 0.5 base, ~2.3 tall), leaning slightly, flaking lichen patches.
  standing_stone: () => {
    const g = new GeoBuilder();
    const base = 0x85878a;
    g.cyl(0.3, 0.52, 2.3, 4, base, { y: 1.15, ry: Math.PI / 4 + 0.15, sx: 1.0, sz: 0.62, rz: -0.05, top: 0xa6a8a4 });
    g.cone(0.3, 0.36, 4, 0xaaaca8, { x: -0.1, y: 2.4, ry: Math.PI / 4 + 0.15, sx: 1.0, sz: 0.62, rz: -0.05, shade: 1.05 }); // worn crown
    g.box(0.9, 0.18, 0.62, 0x6c6e70, { y: 0.09, ry: 0.15, shade: 0.9 }); // footing
    g.ico(0.13, 0, 0xb8c070, { x: 0.2, y: 0.9, z: 0.2, sy: 0.4, sx: 1.2, sz: 0.5, ry: 0.15 });
    g.ico(0.1, 0, 0xa0b058, { x: -0.18, y: 1.5, z: 0.18, sy: 0.4, sx: 1.2, sz: 0.5, ry: 0.15 });
    g.ico(0.15, 0, 0xc8c890, { x: 0.05, y: 0.45, z: -0.2, sy: 0.4, sz: 0.5, sx: 1.3 });
    g.ico(0.09, 0, 0xb8c070, { x: -0.12, y: 1.9, z: -0.17, sy: 0.4, sz: 0.5, sx: 1.2 });
    return { lit: g.build(), glow: null };
  },
  // Clump of tall thin reeds (~1.2 across, ~1.5 high), yellow-green, a few brown seed heads; sparse enough to see through.
  reeds: () => {
    const g = new GeoBuilder();
    const cols = [0xa6b03e, 0x8a9a30, 0xc0c058, 0x98a838];
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = i * 2.399 + hash2(i, 1, 90);
      const r = 0.1 + 0.5 * Math.sqrt((i + 0.5) / N);
      const h = 1.1 + 0.55 * hash2(i, 2, 91) + (r < 0.3 ? 0.1 : 0);
      const tz = 0.06 + 0.2 * (r / 0.6) + 0.08 * hash2(i, 3, 92);
      const dx = Math.sin(tz) * Math.cos(a);
      const dz = -Math.sin(tz) * Math.sin(a);
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      g.cone(0.05, h, 3, cols[i % 4]!, { x: bx + (dx * h) / 2, y: (Math.cos(tz) * h) / 2, z: bz + (dz * h) / 2, rz: -tz, ry: a, shade: 0.85 + 0.2 * hash2(i, 4, 93), top: 0xd0d070 });
      if (i % 5 === 1) g.cyl(0.04, 0.04, 0.17, 4, 0x6a4424, { x: bx + dx * h, y: Math.cos(tz) * h, z: bz + dz * h, rz: -tz, ry: a, shade: 0.9 }); // seed head
    }
    return { lit: g.build(), glow: null };
  },
  // Big rough rock filling most of a cell (~1.5 across, ~1.2 high), faceted, grey with a lighter top.
  boulder: () => {
    const g = new GeoBuilder();
    g.ico(0.8, 0, 0x76787a, { y: 0.48, sx: 1.0, sy: 0.8, sz: 0.88, ry: 0.4, top: 0xb4b6b4 });
    g.ico(0.5, 0, 0x808284, { x: 0.45, y: 0.3, z: 0.3, sy: 0.75, ry: 1.1, top: 0xa4a6a4, shade: 0.95 });
    g.ico(0.42, 0, 0x6c6e70, { x: -0.5, y: 0.26, z: -0.25, sy: 0.7, ry: 2.0, top: 0x9c9e9c });
    g.ico(0.34, 0, 0xc2c4c2, { x: -0.1, y: 0.95, z: 0.05, sy: 0.55, ry: 0.7, top: 0xe2e4e2 });
    g.ico(0.2, 0, 0x7a7c7e, { x: 0.3, y: 0.12, z: -0.6, sy: 0.7, ry: 0.3 });
    g.ico(0.14, 0, 0x7e8082, { x: -0.2, y: 0.1, z: 0.7, sy: 0.7, ry: 1.3 });
    return { lit: g.build(), glow: null };
  },
  // Low clump of ferns and undergrowth (~1.2 across, 0.5 high).
  bush: (look) => {
    const leaf = look.prop.leaf ?? 0x3f6e32;
    const leafL = look.prop.leafLight ?? 0x7ab04a;
    const g = new GeoBuilder();
    g.ico(0.38, 0, leaf, { y: 0.14, sy: 0.55, shade: 0.8, top: leafL });
    g.ico(0.26, 0, leafL, { x: 0.38, y: 0.1, z: 0.22, sy: 0.55, shade: 0.9 });
    g.ico(0.24, 0, leaf, { x: -0.36, y: 0.1, z: -0.12, sy: 0.55, shade: 1.0, top: leafL });
    g.ico(0.2, 0, leaf, { x: 0.05, y: 0.1, z: -0.42, sy: 0.55, shade: 0.85 });
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4;
      const r = 0.12 + (i % 3) * 0.06;
      const tilt = 1.05 + (i % 4) * 0.12;
      const len = 0.5 + (i % 3) * 0.08;
      const dx = Math.sin(tilt) * Math.cos(a);
      const dz = -Math.sin(tilt) * Math.sin(a);
      g.cone(0.11, len, 4, i % 2 ? leafL : leaf, { x: Math.cos(a) * r + (dx * len) / 2, y: 0.1 + (Math.cos(tilt) * len) / 2, z: -Math.sin(a) * r + (dz * len) / 2, rz: -tilt, ry: a, shade: 0.85 + 0.1 * (i % 3) });
    }
    return { lit: g.build(), glow: null };
  },
  // Curtain of ivy on the wall at -Z (authored like torch): ~1.6 wide, hanging ~2 from 2.2, ragged hem, lighter leaves.
  vines: (look) => {
    const leaf = look.prop.leaf ?? 0x3f6e32;
    const leafL = look.prop.leafLight ?? 0x7ab04a;
    const g = new GeoBuilder();
    const z = -0.955;
    g.box(1.7, 0.1, 0.05, 0x2c4a22, { y: 2.18, z, shade: 0.9 }); // dense top band
    const drops = [1.9, 1.45, 2.0, 1.7, 1.2, 1.95, 1.55, 1.85, 1.35];
    drops.forEach((len, i) => {
      const x = -0.8 + i * 0.2;
      g.box(0.21, len, 0.045, i % 2 ? leaf : 0x34602a, { x, y: 2.2 - len / 2, z: z - (i % 2) * 0.008, shade: 0.8 + 0.08 * (i % 3), top: leafL });
    });
    g.box(0.04, 0.5, 0.03, leaf, { x: -0.6, y: 0.22, z: z + 0.02 }); // loose tendrils
    g.box(0.04, 0.35, 0.03, leaf, { x: 0.45, y: 0.4, z: z + 0.02 });
    const lv: [number, number, number][] = [[-0.7, 1.9, 0.3], [-0.3, 1.5, -0.4], [0.1, 1.2, 0.5], [0.5, 1.75, -0.2], [0.75, 1.4, 0.4], [-0.5, 0.9, 0.2], [0.25, 0.75, -0.5], [-0.1, 1.85, 0.1]];
    for (const [x, y, rz] of lv) g.box(0.2, 0.15, 0.03, leafL, { x, y, z: z + 0.03, rz, rx: 0.35, shade: 1.0, top: 0xc0e070 });
    return { lit: g.build(), glow: null };
  },
  // Toppled column (~1.9 long, 0.6 thick) lying along X: a base drum, a middle drum, a splintered stump, shards.
  fallen_column: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    const R = 0.3;
    g.cyl(R + 0.08, R + 0.08, 0.12, 8, p.stoneDark, { x: -0.92, y: R + 0.08, rz: Math.PI / 2 }); // base ring
    g.cyl(R, R, 0.7, 8, p.stone, { x: -0.55, y: R, rz: Math.PI / 2, top: 0x7a9068 });
    g.cyl(R, R, 0.62, 8, p.stone, { x: 0.15, y: R, z: 0.07, rz: Math.PI / 2, ry: 0.1, shade: 0.95, top: 0x7a9068 }); // slipped drum
    g.cyl(R, R * 0.9, 0.35, 8, p.stoneDark, { x: 0.7, y: R, z: 0.1, rz: Math.PI / 2, ry: 0.14, shade: 0.9 });
    g.cone(R * 0.9, 0.3, 5, p.stone, { x: 0.98, y: R, z: 0.1, rz: -Math.PI / 2, ry: 0.14, shade: 0.9 }); // jagged break
    for (const x of [-0.55, 0.15]) g.box(0.5, 0.05, 0.05, p.stoneDark, { x, y: R * 2 - 0.02, shade: 0.7 }); // fluting
    g.box(0.5, 0.03, 0.2, 0x4e7a3a, { x: -0.45, y: R * 2 + 0.01, shade: 0.95 }); // moss
    g.ico(0.14, 0, p.stoneDark, { x: 1.1, y: 0.1, z: -0.3 });
    g.ico(0.1, 0, p.stone, { x: 0.85, y: 0.07, z: 0.45 });
    return { lit: g.build(), glow: null };
  },
  // Heavy sacrificial altar (long axis along X): stepped base, slab, blood-red runner and stain, a horn at each corner.
  altar: (look) => {
    const p = look.prop;
    const g = new GeoBuilder();
    g.box(1.95, 0.14, 1.2, p.stoneDark, { y: 0.07, shade: 0.8 }); // lower step
    g.box(1.75, 0.14, 1.0, p.stone, { y: 0.21, shade: 0.85 }); // upper step
    g.box(1.45, 0.44, 0.78, p.stoneDark, { y: 0.5, shade: 0.9 }); // body
    g.box(1.1, 0.3, 0.06, p.stone, { y: 0.5, z: 0.4, shade: 0.7 }); // carved panel
    g.box(1.1, 0.3, 0.06, p.stone, { y: 0.5, z: -0.4, shade: 0.7 });
    g.box(1.7, 0.16, 1.0, p.stoneDark, { y: 0.81, shade: 0.7 }); // slab
    g.box(1.76, 0.05, 1.06, p.stone, { y: 0.71, shade: 0.6 }); // slab underlip
    g.box(0.46, 0.025, 1.06, 0x8a1010, { x: 0.1, y: 0.897, shade: 1.0 }); // blood-red runner across the top
    g.box(0.46, 0.2, 0.04, 0x8a1010, { x: 0.1, y: 0.78, z: 0.53, shade: 0.9 }); // hanging ends
    g.box(0.46, 0.2, 0.04, 0x8a1010, { x: 0.1, y: 0.78, z: -0.53, shade: 0.9 });
    g.box(0.5, 0.012, 0.3, 0x4a0606, { x: -0.5, y: 0.9, z: 0.1, ry: 0.4 }); // dark stain
    g.box(0.3, 0.012, 0.2, 0x4a0606, { x: 0.6, y: 0.9, z: -0.2, ry: -0.5 });
    for (const [x, z, tz] of [[-0.74, -0.4, 0.3], [0.74, -0.4, -0.3], [-0.74, 0.4, 0.3], [0.74, 0.4, -0.3]] as const) {
      g.cone(0.07, 0.3, 5, 0xd8cbb0, { x, y: 1.1, z, rz: tz, shade: 1.0 }); // horn / candle stub
      g.cyl(0.08, 0.1, 0.05, 6, p.iron, { x, y: 0.92, z });
    }
    g.ico(0.14, 0, 0xcfc0a8, { x: -0.1, y: 1.03, z: -0.1, sy: 0.9, shade: 1.0 }); // skull on the slab
    g.box(0.12, 0.07, 0.1, 0xcfc0a8, { x: -0.1, y: 0.95, z: 0.0, shade: 0.9 });
    return { lit: g.build(), glow: null };
  },
  // One cell of prison bars (row along X): top and bottom rail, seven black bars, a mid band; rails reach the cell edge so runs join up.
  iron_bars: (look) => {
    const iron = 0x16141a;
    const g = new GeoBuilder();
    g.box(2.0, 0.12, 0.16, look.prop.iron, { y: 0.06, shade: 0.8 }); // bottom rail
    g.box(2.0, 0.14, 0.16, look.prop.iron, { y: 2.23, shade: 0.8 }); // top rail
    g.box(2.0, 0.07, 0.1, iron, { y: 1.2, shade: 1.1 }); // cross band
    for (let i = 0; i < 7; i++) {
      const x = -0.9 + i * 0.3;
      g.cyl(0.04, 0.04, 2.2, 6, iron, { x, y: 1.15, shade: 1.0 });
      g.cone(0.05, 0.14, 4, iron, { x, y: 2.34, shade: 1.3 });
    }
    return { lit: g.build(), glow: null };
  },
  // Flat rune circle (~1.7 across): outer ring, inner ring and a six-pointed star, all self-lit, just above the floor.
  sigil: () => {
    const glow = new GeoBuilder();
    const ring = (r: number, w: number, n: number, y: number, sh: number): void => {
      const len = (2 * Math.PI * r) / n + 0.02;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        glow.box(len, 0.012, w, 0xffffff, { x: Math.cos(a) * r, z: -Math.sin(a) * r, y, ry: a + Math.PI / 2, shade: sh });
      }
    };
    ring(0.84, 0.07, 28, 0.03, 1.0);
    ring(0.6, 0.045, 20, 0.03, 0.9);
    // six-pointed star: two triangles inscribed in the inner ring
    const R = 0.6;
    for (let t = 0; t < 2; t++) {
      for (let e = 0; e < 3; e++) {
        const a0 = (t * 60 + e * 120) * (Math.PI / 180);
        const a1 = a0 + (120 * Math.PI) / 180;
        const x0 = Math.cos(a0) * R;
        const z0 = Math.sin(a0) * R;
        const x1 = Math.cos(a1) * R;
        const z1 = Math.sin(a1) * R;
        const len = Math.hypot(x1 - x0, z1 - z0);
        glow.box(len + 0.04, 0.012, 0.045, 0xffffff, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: 0.034 + t * 0.003, ry: -Math.atan2(z1 - z0, x1 - x0), shade: 1.2 });
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      glow.box(0.12, 0.012, 0.12, 0xffffff, { x: Math.cos(a) * 0.72, z: Math.sin(a) * 0.72, y: 0.036, ry: -a + Math.PI / 4, shade: 1.0 }); // rune ticks between the rings
    }
    glow.box(0.16, 0.012, 0.16, 0xffffff, { y: 0.038, ry: Math.PI / 4, shade: 1.5 });
    return { lit: null, glow: glow.build(), glowKind: 'steady' };
  },
  // Heap of treasure (~1.6 across, 0.7 high): a lumpy gold dome with bright facets, coins, goblet, crown, gem and a sword hilt.
  gold_pile: () => {
    const g = new GeoBuilder();
    const glow = new GeoBuilder();
    const gold = 0xc08410;
    const bright = 0xf2b820;
    g.ico(0.82, 1, gold, { y: 0, sy: 0.86, top: bright, shade: 1.0 });
    g.ico(0.5, 1, gold, { x: 0.5, z: 0.3, y: 0, sy: 0.8, top: bright, shade: 1.05, ry: 0.5 });
    g.ico(0.42, 1, gold, { x: -0.5, z: -0.2, y: 0, sy: 0.85, top: bright, shade: 0.95, ry: 1.2 });
    g.ico(0.34, 0, 0xf5c030, { x: 0.15, y: 0.5, z: -0.1, sy: 0.7, shade: 1.05, ry: 0.3 });
    g.ico(0.26, 0, 0xf5c840, { x: -0.3, y: 0.44, z: 0.25, sy: 0.7, shade: 1.0, ry: 1.0 });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.2;
      const r = 0.45 + (i % 3) * 0.17;
      g.cyl(0.12, 0.12, 0.03, 8, i % 2 ? 0xffe27a : 0xf0b828, { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.28 - r * 0.2, rx: 0.35 * Math.sin(i), rz: 0.3 * Math.cos(i * 2), shade: 1.1 }); // coins on the slopes
    }
    for (let i = 0; i < 5; i++) {
      const a = 0.6 + i * 1.3;
      g.cyl(0.11, 0.11, 0.03, 8, 0xf5c030, { x: Math.cos(a) * 0.95, z: Math.sin(a) * 0.95, y: 0.02, rz: 0.1 * i, shade: 1.05 }); // strays on the floor
    }
    // goblet, sticking out of the heap on the left
    g.cyl(0.03, 0.05, 0.22, 6, 0xc0c4cc, { x: -0.2, y: 0.8, z: 0.45, rz: 0.2, shade: 1.1 });
    g.cyl(0.14, 0.05, 0.16, 8, 0xe8d060, { x: -0.24, y: 0.98, z: 0.45, rz: 0.2, shade: 1.15 });
    // crown, tilted on the right
    g.cyl(0.17, 0.17, 0.12, 8, 0xffd84a, { x: 0.45, y: 0.58, z: -0.25, rx: 0.4, rz: -0.2, shade: 1.2 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.cone(0.045, 0.14, 4, 0xffe070, { x: 0.45 + Math.cos(a) * 0.15 + 0.03, y: 0.7 + Math.sin(a) * 0.04, z: -0.25 + Math.sin(a) * 0.15 - 0.05, rx: 0.4, rz: -0.2, shade: 1.3 });
    }
    g.ico(0.05, 0, 0xd02030, { x: 0.45, y: 0.64, z: -0.1, shade: 1.1 });
    // gem
    g.octa(0.11, 0x2a9a6a, { x: 0.05, y: 0.7, z: 0.4, sy: 1.4, rz: 0.3, shade: 1.0 });
    g.octa(0.08, 0xc0284a, { x: -0.55, y: 0.34, z: -0.45, sy: 1.3, rz: -0.4, shade: 1.0 });
    // sword hilt: grip, crossguard, pommel, short blade stub buried in the heap
    g.box(0.05, 0.3, 0.05, 0x5a3a22, { x: 0.78, y: 0.72, z: 0.45, rz: -0.5, rx: 0.1 });
    g.box(0.3, 0.05, 0.06, 0xc8ccd4, { x: 0.68, y: 0.55, z: 0.45, rz: -0.5, shade: 1.2 });
    g.ico(0.05, 0, 0xffd23a, { x: 0.9, y: 0.88, z: 0.46, shade: 1.1 });
    // glints
    for (const [x, y, z, r] of [[0.15, 0.7, -0.1, 0.07], [-0.3, 0.6, 0.25, 0.055], [0.55, 0.45, 0.2, 0.05], [-0.55, 0.45, -0.2, 0.05], [0.0, 0.52, 0.4, 0.045]] as const)
      glow.octa(r, 0xffffff, { x, y, z, sy: 1.2, shade: 1.0 });
    return { lit: g.build(), glow: glow.build(), glowKind: 'steady' };
  },
  // Part of a huge skeleton (spine along X): a row of vertebrae on the floor with four tall curved ribs arching over it.
  dragon_bones: (look) => {
    const bone = look.prop.bone;
    const g = new GeoBuilder();
    for (let i = 0; i < 8; i++) {
      const x = -0.875 + i * 0.25;
      g.ico(0.15, 0, bone, { x, y: 0.17, sy: 0.85, sz: 1.1, shade: 0.95 + 0.05 * (i % 2), ry: i });
      g.cone(0.05, 0.28, 4, bone, { x, y: 0.4, shade: 1.05 }); // spinous process
      g.cyl(0.07, 0.07, 0.12, 6, bone, { x: x + 0.125, y: 0.15, rz: Math.PI / 2, shade: 0.85 }); // disc between vertebrae
    }
    const ribs: [number, number][] = [[-0.62, 1.0], [-0.2, 1.0], [0.22, 0.92], [0.64, 0.7]]; // x, scale
    ribs.forEach(([x, sc], ri) => {
      for (const side of [-1, 1]) {
        if (ri === 3 && side === 1) continue; // one rib broken off
        const steps = 9;
        let pz = 0;
        let py = 0.18;
        const a1 = ((ri === 3 ? 10 : 46) * Math.PI) / 180;
        for (let k = 1; k <= steps; k++) {
          const phi = -Math.PI / 2 + ((k / steps) * (a1 + Math.PI / 2));
          const nz = side * 0.8 * Math.cos(phi) * (0.9 + 0.1 * sc);
          const ny = 0.18 + 0.95 * (1 + Math.sin(phi)) * sc;
          const dz = nz - pz;
          const dy = ny - py;
          const len = Math.hypot(dz, dy);
          const t = 1 - (k / steps) * 0.65;
          g.box(0.15 * t + 0.03, len + 0.02, 0.15 * t + 0.03, bone, { x: x + (k % 2) * 0.005, y: (py + ny) / 2, z: (pz + nz) / 2, rx: Math.atan2(dz, dy), shade: 0.95 + 0.1 * (k % 2) });
          pz = nz;
          py = ny;
        }
      }
    });
    g.box(0.4, 0.05, 0.05, bone, { x: 0.55, y: 0.04, z: 0.7, ry: 0.5, shade: 0.9 }); // fallen bones
    g.box(0.3, 0.05, 0.05, bone, { x: -0.3, y: 0.04, z: -0.75, ry: -0.7, shade: 0.9 });
    g.ico(0.1, 0, bone, { x: 0.85, y: 0.08, z: -0.5, sy: 0.7 });
    return { lit: g.build(), glow: null };
  },
};

/** Every prop type with its own builder (anything else draws as a rock). */
export const PROP_TYPES: string[] = Object.keys(BUILDERS);

const ROCK: Builder = (look) => {
  const g = new GeoBuilder();
  g.ico(0.35, 0, look.prop.stone, { y: 0.2, sy: 0.7 });
  g.ico(0.2, 0, look.prop.stoneDark, { x: 0.4, y: 0.1, z: 0.2, sy: 0.7 });
  return { lit: g.build(), glow: null };
};

const JITTER_YAW = new Set(['rubble', 'bones', 'book_pile', 'stalagmite', 'ice_spike', 'snow_drift', 'mushrooms', 'giant_mushroom', 'urn', 'crystal', 'barrel', 'crate', 'campfire', 'brazier', 'gnarled_tree', 'bush', 'gold_pile', 'standing_stone', 'reeds', 'boulder']);
const SCALE_JITTER = new Set(['standing_stone', 'reeds', 'boulder', 'gnarled_tree', 'bush', 'rubble', 'stalagmite', 'ice_spike', 'snow_drift', 'mushrooms', 'giant_mushroom', 'crystal', 'urn', 'gold_pile']);

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
  fow.patch(litMat, { instanced: true, occludeProps: true });
  const flameMat = new MeshBasicMaterial({ vertexColors: true });
  fow.patch(flameMat, { instanced: true, flicker: 0.16, occludeProps: true });
  const steadyMat = new MeshBasicMaterial({ vertexColors: true });
  fow.patch(steadyMat, { instanced: true, flicker: 0.07, occludeProps: true });

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
    const wallMounted = type === 'torch' || type === 'pipe' || type === 'banner' || type === 'vines' || type === 'weapon_rack' || type === 'lectern';
    list.forEach((p, i) => {
      const gi = p.pos.y * plan.width + p.pos.x;
      let gy = groundY[gi]!;
      if (gy !== gy) gy = (plan.elevation[gi] ?? 0) * 1;
      const h1 = hash2(p.pos.x, p.pos.y, 41);
      const h2 = hash2(p.pos.x, p.pos.y, 42);
      const [sx, sz] = propScatter(type, p.pos.x, p.pos.y, !!look.detail);
      _o.position.set(p.pos.x * CELL + CELL / 2 + sx, gy, p.pos.y * CELL + CELL / 2 + sz);
      const q = ((p.rotation % 4) + 4) % 4;
      let yaw = wallMounted ? -q * (Math.PI / 2) : q * (Math.PI / 2);
      if (type === 'cobweb') yaw = -cornerOf(p.pos.x, p.pos.y, h1) * (Math.PI / 2);
      else if (type === 'forge' || type === 'anvil' || type === 'ingots') yaw = -q * (Math.PI / 2);
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
        else if (type === 'sigil') _col.setHex(0xff3a12);
        else if (type === 'gold_pile') _col.setHex(0xffd870);
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

/** A hex colour moved toward another by t (0..1). */
function tintToward(a: number, b: number, t: number): number {
  const ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

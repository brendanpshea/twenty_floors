import type { ThemeId } from '../core/types';

/** Everything that makes a theme look like itself. Colours are 0xRRGGBB. */
export interface ThemeLook {
  id: ThemeId;
  wallStyle: 'rough' | 'dressed' | 'jagged';
  floorA: number;
  floorB: number;
  /** Colour of the bevel groove between tiles, as a multiplier. */
  groove: number;
  wall: number;
  wall2: number;
  cap: number;
  water: number;
  waterBed: number;
  waterOpacity: number;
  /** Fog and clear colour. */
  fog: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  /** Ambient term baked into vertex colours (before lights). */
  baseLight: number;
  /** Multiplier on baked point light contribution. */
  lightGain: number;
  /** Real point light intensity multiplier. */
  pointGain: number;
  /** Strength of the always-on light around the camera target. */
  heroGain: number;
  /** Colour of that light (warm in warrens, neutral-cool elsewhere). */
  heroColor: number;
  /** Chasm glow far below. */
  chasmGlow: number;
  moteColor: number;
  moteCount: number;
  /** Flame colour pairs for torch/brazier/campfire (outer, core). */
  flame: number;
  flameCore: number;
  /** Alternate warm torch (used on a share of torches in the crypt). */
  flameAlt: number;
  altShare: number;
  crystal: number[];
  mushroom: number;
  prop: {
    stone: number;
    stoneDark: number;
    wood: number;
    woodDark: number;
    iron: number;
    bone: number;
    clay: number;
  };
}

export const LOOKS: Record<ThemeId, ThemeLook> = {
  warrens: {
    id: 'warrens',
    wallStyle: 'rough',
    floorA: 0x8e6c4c,
    floorB: 0xb28a62,
    groove: 0.62,
    wall: 0x6a4630,
    wall2: 0x7e5a3a,
    cap: 0x4a3626,
    water: 0x4f8a78,
    waterBed: 0x2c3a2f,
    waterOpacity: 0.66,
    fog: 0x24170e,
    fogDensity: 0.02,
    hemiSky: 0xffdcb8,
    hemiGround: 0x6e4c34,
    hemiIntensity: 1.25,
    keyColor: 0xffcf9a,
    keyIntensity: 1.5,
    baseLight: 0.68,
    lightGain: 1.0,
    pointGain: 1.0,
    heroGain: 0.45,
    heroColor: 0xffd9b0,
    chasmGlow: 0x5a2a10,
    moteColor: 0xffa040,
    moteCount: 70,
    flame: 0xff7a1a,
    flameCore: 0xffd070,
    flameAlt: 0xff7a1a,
    altShare: 0,
    crystal: [0x66e0a0, 0xffb040],
    mushroom: 0x6dff9a,
    prop: { stone: 0x8a7a68, stoneDark: 0x5c5046, wood: 0x8a5a30, woodDark: 0x5a3a20, iron: 0x4a4a52, bone: 0xe0d6bc, clay: 0xa8643c },
  },
  crypt: {
    id: 'crypt',
    wallStyle: 'dressed',
    floorA: 0x8a94a2,
    floorB: 0x9ca6b4,
    groove: 0.55,
    wall: 0x6f7e96,
    wall2: 0x8190a8,
    cap: 0x484e5c,
    water: 0x4f86aa,
    waterBed: 0x1d2e3c,
    waterOpacity: 0.62,
    fog: 0x0d1420,
    fogDensity: 0.017,
    hemiSky: 0xc8d6f0,
    hemiGround: 0x46526c,
    hemiIntensity: 1.45,
    keyColor: 0xc4d8ff,
    keyIntensity: 1.3,
    baseLight: 0.8,
    lightGain: 1.15,
    pointGain: 1.0,
    heroGain: 0.4,
    heroColor: 0xcfdcff,
    chasmGlow: 0x142a44,
    moteColor: 0x9fe0ff,
    moteCount: 50,
    flame: 0x3fd8e0,
    flameCore: 0xd8fbff,
    flameAlt: 0xff8a2a,
    altShare: 0.25,
    crystal: [0x6fd8ff, 0x9fa8ff],
    mushroom: 0x7affd0,
    prop: { stone: 0xa0a8b6, stoneDark: 0x6a7282, wood: 0x6a4e3a, woodDark: 0x453325, iron: 0x3c424e, bone: 0xd8d8cc, clay: 0x7a6a62 },
  },
  sewers: {
    id: 'sewers',
    wallStyle: 'dressed',
    floorA: 0x7c7a62,
    floorB: 0x8c8a70,
    groove: 0.5,
    wall: 0x6a6040,
    wall2: 0x7a704c,
    cap: 0x433e2a,
    water: 0x5f7a3a,
    waterBed: 0x3e4a22,
    waterOpacity: 0.8,
    fog: 0x10170c,
    fogDensity: 0.02,
    hemiSky: 0xd8e0b0,
    hemiGround: 0x4c4c2c,
    hemiIntensity: 1.4,
    keyColor: 0xe6dca8,
    keyIntensity: 1.25,
    baseLight: 0.78,
    lightGain: 1.1,
    pointGain: 1.0,
    heroGain: 0.42,
    heroColor: 0xf0e2b4,
    chasmGlow: 0x1c2a10,
    moteColor: 0xb8d080,
    moteCount: 24,
    flame: 0xff9a38,
    flameCore: 0xffe0a0,
    flameAlt: 0xff9a38,
    altShare: 0,
    crystal: [0x8ae060, 0xd0e070],
    mushroom: 0x9aff70,
    prop: { stone: 0x8a8468, stoneDark: 0x5a5640, wood: 0x6a5230, woodDark: 0x40301c, iron: 0x3e403a, bone: 0xd4ceb0, clay: 0x8a5a3a },
  },
  fungal: {
    id: 'fungal',
    wallStyle: 'rough',
    floorA: 0x5e5a78,
    floorB: 0x756f92,
    groove: 0.6,
    wall: 0x5c5684,
    wall2: 0x6c66a0,
    cap: 0x3a3658,
    water: 0x3a7a8e,
    waterBed: 0x1a2a3a,
    waterOpacity: 0.7,
    fog: 0x120e22,
    fogDensity: 0.021,
    hemiSky: 0xb8c0f0,
    hemiGround: 0x3c3a64,
    hemiIntensity: 1.35,
    keyColor: 0xb0b8f0,
    keyIntensity: 1.2,
    baseLight: 0.74,
    lightGain: 1.1,
    pointGain: 1.0,
    heroGain: 0.42,
    heroColor: 0xc0e8e0,
    chasmGlow: 0x1a1a40,
    moteColor: 0x8ae8c8,
    moteCount: 90,
    flame: 0x58e0b0,
    flameCore: 0xd8fff0,
    flameAlt: 0x58e0b0,
    altShare: 0,
    crystal: [0x58d8c8, 0x9a88f0],
    mushroom: 0x44d8b0,
    prop: { stone: 0x7a7494, stoneDark: 0x4c4868, wood: 0x5a4a5a, woodDark: 0x3a2e3c, iron: 0x40445a, bone: 0xd0d0c8, clay: 0x6a5a78 },
  },
  hold: {
    id: 'hold',
    wallStyle: 'dressed',
    floorA: 0x847058,
    floorB: 0x9c8668,
    groove: 0.58,
    wall: 0x5e4a38,
    wall2: 0x705840,
    cap: 0x3e2e20,
    water: 0x5a7a6a,
    waterBed: 0x2c3a30,
    waterOpacity: 0.66,
    fog: 0x2a1e12,
    fogDensity: 0.018,
    hemiSky: 0xffe0b8,
    hemiGround: 0x6a4c34,
    hemiIntensity: 1.4,
    keyColor: 0xffd8a0,
    keyIntensity: 1.4,
    baseLight: 0.78,
    lightGain: 1.1,
    pointGain: 1.0,
    heroGain: 0.42,
    heroColor: 0xffdcb0,
    chasmGlow: 0x4a2a14,
    moteColor: 0xe0b878,
    moteCount: 18,
    flame: 0xff8a2a,
    flameCore: 0xffe0a0,
    flameAlt: 0xff8a2a,
    altShare: 0,
    crystal: [0xffb040, 0xff7a30],
    mushroom: 0xa8e070,
    prop: { stone: 0x8a8070, stoneDark: 0x5a5046, wood: 0x8a5e34, woodDark: 0x573a22, iron: 0x4a4a52, bone: 0xdcd2b8, clay: 0xa8643c },
  },
  library: {
    id: 'library',
    wallStyle: 'dressed',
    floorA: 0x8590a0,
    floorB: 0x98a2b2,
    groove: 0.55,
    wall: 0x4a5870,
    wall2: 0x5a6882,
    cap: 0x2e3648,
    water: 0x2a6a88,
    waterBed: 0x12283a,
    waterOpacity: 0.7,
    fog: 0x0c1220,
    fogDensity: 0.019,
    hemiSky: 0xc4d4ee,
    hemiGround: 0x3e4a64,
    hemiIntensity: 1.4,
    keyColor: 0xbcd0f4,
    keyIntensity: 1.25,
    baseLight: 0.78,
    lightGain: 1.12,
    pointGain: 1.0,
    heroGain: 0.42,
    heroColor: 0xd0e0ff,
    chasmGlow: 0x142a44,
    moteColor: 0xc8d8f0,
    moteCount: 36,
    flame: 0x8ac8ff,
    flameCore: 0xeaf6ff,
    flameAlt: 0x8ac8ff,
    altShare: 0,
    crystal: [0x80c8ff, 0xa8b8ff],
    mushroom: 0x7affd0,
    prop: { stone: 0x9aa4b4, stoneDark: 0x64708a, wood: 0x5a4636, woodDark: 0x382a20, iron: 0x3a404c, bone: 0xd8d8cc, clay: 0x6a6a7a },
  },
  depths: {
    id: 'depths',
    wallStyle: 'jagged',
    floorA: 0x6d727d,
    floorB: 0x7b808c,
    groove: 0.55,
    wall: 0x575d6e,
    wall2: 0x646b7c,
    cap: 0x464b5a,
    water: 0x486a98,
    waterBed: 0x1b2230,
    waterOpacity: 0.64,
    fog: 0x070818,
    fogDensity: 0.015,
    hemiSky: 0xbcc4dc,
    hemiGround: 0x34384c,
    hemiIntensity: 1.6,
    keyColor: 0xd2dafa,
    keyIntensity: 1.4,
    baseLight: 1.0,
    lightGain: 0.9,
    pointGain: 0.9,
    heroGain: 0.5,
    heroColor: 0xd4dcf4,
    chasmGlow: 0x1f1648,
    moteColor: 0xb890ff,
    moteCount: 140,
    flame: 0x9a5cff,
    flameCore: 0xe8d8ff,
    flameAlt: 0x40e8ff,
    altShare: 0.35,
    crystal: [0xb070ff, 0x40e0ff],
    mushroom: 0x66ffe0,
    prop: { stone: 0x5e5a78, stoneDark: 0x3a3750, wood: 0x4a3a52, woodDark: 0x2e2438, iron: 0x34364a, bone: 0xc8c4d8, clay: 0x584468 },
  },
};

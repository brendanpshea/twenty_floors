import { CellKind } from '../core/types';
import type { FloorPlan, GridPos, LightPlacement, PropPlacement, Room, ThemeId } from '../core/types';

/** Hand-built floors for the renderer preview. They only exercise the renderer; they are not valid generator output. */
class Draft {
  readonly kinds: Uint8Array;
  readonly elev: Int8Array;
  readonly props: PropPlacement[] = [];
  readonly lights: LightPlacement[] = [];

  constructor(
    readonly w: number,
    readonly h: number,
    fill: number = CellKind.Void,
  ) {
    this.kinds = new Uint8Array(w * h).fill(fill);
    this.elev = new Int8Array(w * h);
  }

  set(x: number, y: number, kind: number, e = 0): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.kinds[y * this.w + x] = kind;
    this.elev[y * this.w + x] = e;
  }

  rect(x0: number, y0: number, x1: number, y1: number, kind: number = CellKind.Floor, e = 0): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, kind, e);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, kind: number = CellKind.Floor, e = 0): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        // Slightly irregular edge for caves.
        const wob = 1 + 0.18 * Math.sin(x * 1.7 + y * 2.3) * Math.cos(y * 1.3 - x * 0.9);
        if (dx * dx + dy * dy <= wob) this.set(x, y, kind, e);
      }
    }
  }

  /** Wall every Void cell touching a walkable/chasm cell. */
  wallsAround(includeChasm = false): void {
    const { w, h, kinds } = this;
    const solid = (k: number): boolean => k !== CellKind.Void && k !== CellKind.Wall && (includeChasm || k !== CellKind.Chasm);
    const out: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (kinds[y * w + x] !== CellKind.Void) continue;
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (solid(kinds[ny * w + nx]!)) {
              touch = true;
              break;
            }
          }
        }
        if (touch) out.push(y * w + x);
      }
    }
    for (const i of out) kinds[i] = CellKind.Wall;
  }

  /** Give wall cells the elevation of the tallest neighbour (informational). */
  prop(type: string, x: number, y: number, rotation = 0, blocking = true): void {
    this.props.push({ type, pos: { x, y }, rotation, blocking });
  }

  light(x: number, y: number, color: number, intensity = 1, radius = 6): void {
    this.lights.push({ pos: { x, y }, color, intensity, radius });
  }

  toPlan(theme: ThemeId, entrance: GridPos, exit: GridPos, seed: number, restSpots: GridPos[] = []): FloorPlan {
    const rooms: Room[] = [
      {
        id: 0,
        role: 'entrance',
        bounds: { x0: entrance.x - 2, y0: entrance.y - 2, x1: entrance.x + 2, y1: entrance.y + 2 },
        center: entrance,
        neighbors: [1],
        distanceFromEntrance: 0,
      },
      {
        id: 1,
        role: 'boss',
        bounds: { x0: exit.x - 2, y0: exit.y - 2, x1: exit.x + 2, y1: exit.y + 2 },
        center: exit,
        neighbors: [0],
        distanceFromEntrance: 1,
      },
    ];
    return {
      seed,
      depth: theme === 'warrens' ? 1 : theme === 'crypt' ? 2 : theme === 'sewers' ? 4 : theme === 'fungal' ? 6 : theme === 'hold' ? 8 : theme === 'library' ? 10 : theme === 'foundry' ? 12 : theme === 'ice' ? 14 : theme === 'ruin' ? 16 : 3,
      theme,
      width: this.w,
      height: this.h,
      kinds: this.kinds,
      elevation: this.elev,
      roomIds: new Int16Array(this.w * this.h).fill(-1),
      rooms,
      entrance,
      exit,
      spawns: [],
      props: this.props,
      lights: this.lights,
      restSpots,
    };
  }
}

const FLOOR = CellKind.Floor;
const WATER = CellKind.Water;
const CHASM = CellKind.Chasm;
const DOOR = CellKind.Door;
const WALL = CellKind.Wall;

/** Lights placed with their props, coloured per theme. */
function autoLights(d: Draft, theme: ThemeId): void {
  for (const p of d.props) {
    const { x, y } = p.pos;
    switch (p.type) {
      case 'torch': {
        const warm = theme === 'warrens' || theme === 'ice' || theme === 'hold' || theme === 'foundry' || theme === 'ruin' || (theme === 'crypt' && (x + y) % 4 === 0);
        d.light(x, y, theme === 'library' ? 0x90c8ff : warm || theme === 'sewers' ? 0xffa050 : theme === 'fungal' ? 0x60f0c0 : theme === 'crypt' ? 0x60d8f0 : 0xa070ff, 1.1, theme === 'depths' ? 5 : 6.5);
        break;
      }
      case 'brazier':
        d.light(x, y, theme === 'library' ? 0x90c8ff : theme === 'warrens' || theme === 'sewers' || theme === 'hold' || theme === 'foundry' || theme === 'ruin' ? 0xff8a30 : theme === 'fungal' ? 0x58e8b8 : theme === 'crypt' ? 0x58d0e8 : 0x9060ff, 1.3, 6);
        break;
      case 'candelabra':
        d.light(x, y, 0x90c8ff, 1.2, 6);
        break;
      case 'forge':
        d.light(x, y, 0xff7a28, 1.8, 7.5);
        break;
      case 'crucible':
        d.light(x, y, 0xffa030, 1.4, 6);
        break;
      case 'campfire':
        d.light(x, y, 0xff8030, 1.7, 8);
        break;
      case 'crystal':
        d.light(x, y, theme === 'ice' ? ((x + y) % 2 ? 0x90d8ff : 0xc0ecff) : (x + y) % 2 ? 0xa070ff : 0x40e0ff, 1.1, 5);
        break;
      case 'giant_mushroom':
        d.light(x, y, 0x50f0c0, 1.2, 6.5);
        break;
      case 'mushrooms':
        d.light(x, y, 0x60ff98, 0.8, 4.5);
        break;
      default:
        break;
    }
  }
}

function crypt(): FloorPlan {
  const d = new Draft(24, 24);
  d.rect(1, 1, 8, 6); // A: entrance hall
  d.rect(10, 3, 14, 3); // corridor
  d.set(9, 3, DOOR);
  d.set(15, 3, DOOR);
  d.rect(16, 1, 22, 6); // B: tomb
  d.set(4, 7, DOOR);
  d.rect(1, 8, 14, 14); // C: great hall
  d.set(19, 7, DOOR);
  d.rect(16, 8, 22, 14); // D: stairs up
  d.set(15, 11, DOOR);
  for (let y = 8; y <= 14; y++) {
    d.rect(18, y, 19, y, FLOOR, 1);
    d.rect(20, y, 21, y, FLOOR, 2);
    d.set(22, y, FLOOR, 3);
  }
  d.rect(5, 10, 7, 12, WATER, 0); // pool
  d.set(7, 15, DOOR);
  d.rect(1, 16, 22, 22); // E: chasm hall
  d.rect(4, 17, 19, 21, CHASM);
  d.rect(4, 19, 19, 19, FLOOR); // bridge
  d.wallsAround();
  // props
  const P = d.prop.bind(d);
  P('torch', 2, 1, 0); P('torch', 7, 1, 0); P('torch', 1, 4, 3); P('torch', 8, 4, 1);
  P('torch', 1, 9, 3); P('torch', 14, 9, 1); P('torch', 3, 8, 0); P('torch', 11, 8, 0);
  P('torch', 17, 1, 0); P('torch', 21, 1, 0); P('torch', 22, 4, 1); P('torch', 16, 5, 3);
  P('torch', 2, 22, 2); P('torch', 21, 22, 2); P('torch', 17, 8, 0);
  P('pillar', 3, 5); P('pillar', 6, 5); P('pillar', 9, 10); P('pillar', 9, 12); P('pillar', 12, 10); P('pillar', 12, 12);
  P('sarcophagus', 17, 3, 0); P('sarcophagus', 19, 3, 0); P('sarcophagus', 21, 3, 0);
  P('brazier', 18, 6); P('brazier', 20, 6);
  P('crate', 22, 6, 1); P('barrel', 22, 5, 0); P('barrel', 21, 6, 1);
  P('bones', 6, 13); P('bones', 12, 14, 1); P('rubble', 10, 9); P('rubble', 13, 13, 1);
  P('urn', 2, 13); P('urn', 2, 14); P('cobweb', 1, 8); P('cobweb', 14, 14, 2);
  P('statue', 13, 9, 3); P('broken_pillar', 3, 11); P('chain', 2, 11);
  P('crystal', 21, 17); P('brazier', 2, 17); P('brazier', 3, 21); P('statue', 21, 20, 3);
  P('cobweb', 1, 1, 0); P('bones', 8, 3); P('stalagmite', 20, 21);
  autoLights(d, 'crypt');
  return d.toPlan('crypt', { x: 3, y: 3 }, { x: 22, y: 11 }, 1002, [{ x: 7, y: 4 }, { x: 11, y: 13 }]);
}

function sewers(): FloorPlan {
  const d = new Draft(24, 24);
  d.rect(1, 1, 9, 7); // A: entrance chamber
  d.rect(3, 4, 7, 5, WATER);
  d.rect(10, 4, 14, 4); // corridor
  d.set(10, 4, DOOR);
  d.rect(15, 1, 22, 8); // B: junction hall with a water channel
  d.rect(15, 4, 22, 5, WATER);
  d.rect(4, 8, 4, 12); // corridor south
  d.rect(1, 13, 14, 22); // C: big flooded hall
  d.rect(2, 15, 13, 17, WATER); // main channel
  d.rect(7, 18, 8, 22, WATER); // side channel
  d.rect(17, 9, 17, 17); // corridor
  d.rect(16, 18, 22, 22); // D: small room
  d.rect(15, 20, 15, 20); // link
  d.set(15, 20, DOOR);
  d.rect(18, 19, 20, 21, WATER);
  d.wallsAround();
  const P = d.prop.bind(d);
  P('torch', 2, 1, 0); P('torch', 8, 1, 0); P('torch', 1, 6, 3); P('torch', 9, 6, 1);
  P('torch', 16, 1, 0); P('torch', 21, 1, 0); P('torch', 2, 13, 0); P('torch', 13, 13, 0); P('torch', 17, 18, 0);
  P('pipe', 5, 1, 0, false); P('pipe', 3, 7, 2, false); P('pipe', 18, 1, 0, false); P('pipe', 22, 7, 1, false);
  P('pipe', 6, 13, 0, false); P('pipe', 1, 19, 3, false); P('pipe', 22, 20, 1, false);
  P('grate', 6, 3, 0, false); P('grate', 3, 6, 0, false); P('grate', 17, 7, 0, false); P('grate', 20, 2, 0, false);
  P('grate', 5, 20, 0, false); P('grate', 12, 20, 0, false); P('grate', 17, 12, 0, false);
  P('barrel', 8, 7, 0); P('barrel', 9, 7, 1); P('crate', 22, 8, 1); P('crate', 2, 21, 0); P('barrel', 1, 21, 0);
  P('mushrooms', 1, 2); P('mushrooms', 21, 7); P('mushrooms', 13, 21); P('mushrooms', 22, 22);
  P('rubble', 14, 18); P('rubble', 11, 8, 0); P('bones', 10, 19); P('bones', 19, 7);
  P('pillar', 4, 14); P('pillar', 10, 14); P('pillar', 4, 18); P('pillar', 11, 18);
  P('brazier', 20, 18); P('cobweb', 1, 1, 0); P('cobweb', 22, 1, 1); P('cobweb', 1, 22, 3);
  autoLights(d, 'sewers');
  return d.toPlan('sewers', { x: 3, y: 2 }, { x: 21, y: 6 }, 1004, [{ x: 8, y: 3 }, { x: 12, y: 20 }]);
}

function warrens(): FloorPlan {
  const d = new Draft(24, 24);
  d.ellipse(6, 6, 4.8, 4.2); // cave 1
  d.rect(10, 6, 13, 7);
  d.ellipse(17, 7, 4.2, 4.2); // cave 2
  d.ellipse(17, 9, 1.8, 1.4, WATER);
  d.rect(6, 10, 6, 14); // tunnel south
  d.set(6, 12, DOOR);
  d.ellipse(7, 18, 5.4, 4.2); // cave 3
  d.ellipse(7, 18, 3.4, 2.6, FLOOR, 1);
  d.ellipse(7, 18, 1.8, 1.4, FLOOR, 2);
  d.rect(12, 18, 14, 18);
  d.ellipse(18, 17, 4.6, 4.2); // cave 4
  d.ellipse(18, 17, 2.4, 1.8, CHASM);
  d.rect(14, 17, 22, 17, FLOOR); // bridge
  d.rect(17, 11, 17, 12); // link cave2->cave4
  d.wallsAround();
  const P = d.prop.bind(d);
  P('campfire', 5, 5); P('crate', 3, 7); P('barrel', 4, 8); P('barrel', 3, 8, 1); P('bones', 8, 4); P('bones', 4, 3, 1);
  P('torch', 6, 2, 0); P('torch', 2, 6, 3); P('torch', 11, 6, 0);
  P('stalagmite', 9, 8); P('stalagmite', 2, 5); P('stalagmite', 19, 4); P('stalagmite', 14, 9);
  P('mushrooms', 8, 9); P('mushrooms', 15, 5); P('mushrooms', 20, 8); P('mushrooms', 4, 20); P('mushrooms', 12, 21);
  P('rubble', 7, 7); P('rubble', 18, 5); P('rubble', 10, 18); P('rubble', 21, 20);
  P('crystal', 21, 5); P('crystal', 3, 18);
  P('brazier', 16, 4); P('campfire', 9, 20); P('crate', 20, 14); P('urn', 19, 20); P('cobweb', 2, 4); P('cobweb', 22, 6, 1);
  P('statue', 7, 18, 2); P('chain', 14, 20); P('broken_pillar', 17, 21); P('pillar', 12, 14);
  P('torch', 13, 18, 0);
  autoLights(d, 'warrens');
  return d.toPlan('warrens', { x: 4, y: 6 }, { x: 21, y: 18 }, 1001, [{ x: 5, y: 8 }, { x: 17, y: 6 }]);
}

function fungal(): FloorPlan {
  const d = new Draft(24, 24);
  d.ellipse(7, 7, 5.2, 4.6); // cavern 1
  d.ellipse(7, 7, 1.8, 1.4, WATER);
  d.rect(11, 8, 14, 9); // passage
  d.ellipse(17, 10, 4.6, 4.6); // cavern 2
  d.rect(7, 12, 8, 15); // passage south
  d.ellipse(8, 18, 5.6, 4.2); // cavern 3
  d.ellipse(7, 18, 2.2, 1.6, FLOOR, 1);
  d.rect(13, 18, 15, 18);
  d.ellipse(18, 18, 4.2, 3.8); // cavern 4
  d.ellipse(19, 18, 1.8, 1.4, WATER);
  d.rect(17, 14, 17, 15);
  d.wallsAround();
  const P = d.prop.bind(d);
  P('giant_mushroom', 4, 5); P('giant_mushroom', 9, 9); P('giant_mushroom', 16, 7); P('giant_mushroom', 19, 12);
  P('giant_mushroom', 5, 20); P('giant_mushroom', 11, 17); P('giant_mushroom', 21, 17);
  P('mushrooms', 5, 9); P('mushrooms', 8, 5); P('mushrooms', 14, 12); P('mushrooms', 20, 8); P('mushrooms', 6, 16);
  P('mushrooms', 13, 20); P('mushrooms', 16, 20); P('mushrooms', 22, 15);
  P('cobweb', 3, 7, 0); P('cobweb', 14, 6, 1); P('cobweb', 21, 11, 1); P('cobweb', 4, 20, 3); P('cobweb', 22, 20, 2);
  P('stalagmite', 9, 4); P('stalagmite', 3, 8); P('stalagmite', 18, 7); P('stalagmite', 12, 20); P('stalagmite', 8, 22);
  P('stalagmite', 20, 20);
  P('rubble', 10, 7); P('rubble', 15, 12); P('rubble', 6, 21); P('bones', 7, 10); P('bones', 17, 20);
  P('torch', 7, 3, 0); P('torch', 17, 6, 0); P('torch', 8, 22, 2); P('torch', 18, 22, 2);
  autoLights(d, 'fungal');
  return d.toPlan('fungal', { x: 5, y: 7 }, { x: 19, y: 18 }, 1005, [{ x: 7, y: 5 }, { x: 17, y: 12 }]);
}

function hold(): FloorPlan {
  const d = new Draft(24, 24);
  d.rect(1, 1, 10, 8); // A: barracks
  d.rect(11, 4, 13, 5); // corridor
  d.set(11, 4, DOOR); d.set(11, 5, DOOR); d.set(13, 4, DOOR); d.set(13, 5, DOOR);
  d.rect(14, 1, 22, 8); // B: mess hall
  d.set(5, 9, DOOR); d.set(6, 9, DOOR); // barracks -> yard
  d.set(18, 9, DOOR); d.set(19, 9, DOOR); // mess -> yard
  d.rect(1, 10, 22, 22); // C: training yard
  d.wallsAround();
  const P = d.prop.bind(d);
  // barracks: two rows of bunks, racks and banners on the north wall
  for (const x of [2, 4, 6, 8]) P('bunk', x, 3, 0);
  P('bunk', 2, 6, 1); P('bunk', 4, 6, 1); P('bunk', 8, 6, 0); P('bunk', 9, 3, 1);
  P('weapon_rack', 3, 1, 0); P('weapon_rack', 6, 1, 0); P('weapon_rack', 1, 5, 3);
  P('banner', 4, 1, 0, false); P('banner', 8, 1, 0, false); P('banner', 10, 5, 1, false);
  P('torch', 2, 1, 0); P('torch', 9, 1, 0); P('torch', 10, 7, 1);
  P('crate', 10, 8, 0); P('barrel', 9, 8, 1);
  // mess hall: trestle tables, stores
  P('table', 16, 3, 1); P('table', 20, 3, 1); P('table', 16, 6, 0); P('table', 20, 6, 0);
  P('banner', 17, 1, 0, false); P('banner', 21, 1, 0, false); P('banner', 14, 7, 3, false);
  P('torch', 15, 1, 0); P('torch', 19, 1, 0); P('torch', 22, 4, 1);
  P('barrel', 22, 8, 0); P('barrel', 21, 8, 1); P('crate', 22, 7, 1); P('brazier', 14, 3);
  P('bones', 18, 5); P('weapon_rack', 14, 5, 3);
  // yard: palisade along the south and east, dummies, fire
  for (let x = 2; x <= 21; x++) if (x < 10 || x > 13) P('palisade', x, 21, 0);
  for (let y = 12; y <= 20; y++) P('palisade', 21, y, 1);
  for (const [x, y] of [[4, 13], [7, 13], [10, 13], [4, 17], [8, 17]] as const) P('dummy', x, y, (x + y) % 4);
  P('weapon_rack', 2, 10, 0); P('weapon_rack', 13, 10, 0); P('torch', 4, 10, 0); P('torch', 17, 10, 0);
  P('banner', 9, 10, 0, false); P('banner', 15, 10, 0, false);
  P('campfire', 16, 15); P('crate', 19, 12, 0); P('barrel', 20, 12, 1); P('crate', 2, 20, 0);
  P('rubble', 12, 19); P('bones', 14, 18); P('pillar', 12, 11);
  autoLights(d, 'hold');
  return d.toPlan('hold', { x: 3, y: 4 }, { x: 18, y: 19 }, 1006, [{ x: 17, y: 16 }, { x: 5, y: 7 }]);
}

function library(): FloorPlan {
  const d = new Draft(24, 24);
  d.rect(1, 1, 14, 10); // A: stacks
  d.rect(15, 5, 16, 6); // corridor
  d.set(15, 5, DOOR); d.set(15, 6, DOOR);
  d.rect(17, 1, 22, 10); // B: reading room
  d.rect(1, 12, 22, 22); // C: flooded wing
  d.set(7, 11, DOOR); d.set(8, 11, DOOR); d.set(19, 11, DOOR); d.set(20, 11, DOOR);
  d.rect(14, 16, 22, 22, WATER);
  d.wallsAround();
  const P = d.prop.bind(d);
  // stacks: three parallel rows (rotation 0 = long axis along x) forming aisles
  for (const y of [3, 6, 9]) for (let x = 2; x <= 13; x++) if (!(y === 6 && (x === 7 || x === 8))) P('bookshelf', x, y, 0);
  P('torch', 3, 1, 0); P('torch', 12, 1, 0); P('torch', 1, 6, 3);
  P('candelabra', 1, 4); P('candelabra', 14, 8); P('candelabra', 7, 1);
  P('book_pile', 7, 6); P('book_pile', 4, 4); P('book_pile', 11, 7); P('book_pile', 9, 2);
  P('bones', 13, 4); P('cobweb', 1, 1, 0); P('cobweb', 14, 1, 1);
  // reading room
  P('desk', 18, 3, 0); P('desk', 21, 3, 0); P('desk', 18, 6, 0); P('desk', 21, 6, 0);
  P('lectern', 20, 8, 0); P('bookshelf', 18, 1, 0); P('bookshelf', 19, 1, 0); P('bookshelf', 20, 1, 0);
  for (const y of [3, 4, 5]) P('bookshelf', 22, y, 1);
  P('candelabra', 17, 9); P('candelabra', 22, 9); P('book_pile', 19, 5); P('book_pile', 21, 9);
  P('torch', 22, 7, 1); P('torch', 17, 2, 3);
  // flooded wing
  for (let x = 2; x <= 12; x++) if (x !== 7 && x !== 8) P('bookshelf', x, 14, 0);
  for (let x = 3; x <= 11; x++) if (x !== 7 && x !== 8) P('bookshelf', x, 17, 0);
  P('pillar', 4, 20); P('pillar', 9, 20); P('pillar', 13, 13); P('statue', 1, 20, 1); P('statue', 12, 21, 0);
  P('rubble', 6, 19); P('rubble', 16, 14); P('bones', 10, 15); P('book_pile', 8, 19); P('book_pile', 3, 16);
  P('desk', 5, 21, 0); P('candelabra', 13, 18); P('candelabra', 1, 13); P('cobweb', 22, 12, 1);
  P('torch', 5, 12, 0); P('torch', 18, 12, 0); P('torch', 2, 22, 2); P('torch', 21, 22, 2);
  autoLights(d, 'library');
  return d.toPlan('library', { x: 4, y: 4 }, { x: 20, y: 14 }, 1007, [{ x: 7, y: 7 }, { x: 19, y: 7 }]);
}

function depths(): FloorPlan {
  const d = new Draft(24, 24, CHASM);
  // platforms
  d.rect(2, 2, 7, 7, FLOOR, 0); // start
  d.rect(10, 4, 15, 9, FLOOR, 1); // raised
  d.rect(17, 2, 21, 6, FLOOR, 2);
  d.rect(2, 11, 8, 17, FLOOR, 0); // lower left
  d.rect(2, 14, 4, 16, WATER, 0);
  d.rect(11, 13, 16, 18, FLOOR, 1);
  d.rect(18, 10, 22, 14, FLOOR, 2);
  d.rect(14, 20, 21, 22, FLOOR, 0);
  // steps
  d.rect(8, 4, 9, 9, FLOOR, 1); // ramp pieces
  // bridges
  d.rect(8, 5, 9, 5, FLOOR, 0);
  d.rect(16, 5, 16, 5, FLOOR, 2); // 1-wide link
  d.rect(5, 8, 5, 10, FLOOR, 0); // down
  d.rect(9, 14, 10, 14, FLOOR, 0);
  d.rect(17, 15, 17, 15, FLOOR, 1);
  d.rect(19, 7, 19, 9, FLOOR, 2);
  d.rect(20, 15, 20, 19, FLOOR, 1);
  d.rect(15, 19, 15, 19, FLOOR, 0);
  // clean the ramp piece: make 8..9,4..9 only a staircase 0->1
  for (let y = 6; y <= 9; y++) {
    d.set(8, y, CHASM);
    d.set(9, y, CHASM);
  }
  d.set(8, 4, CHASM);
  d.set(9, 4, CHASM);
  // walled alcove on the top-right platform with a door
  d.rect(17, 7, 21, 8, WALL);
  d.set(19, 7, DOOR, 2);
  d.rect(18, 8, 20, 8, FLOOR, 2);
  d.rect(17, 10, 17, 10, WALL);
  const P = d.prop.bind(d);
  P('crystal', 3, 3); P('crystal', 6, 6); P('crystal', 12, 5); P('crystal', 21, 3); P('crystal', 3, 12); P('crystal', 15, 21);
  P('brazier', 7, 3); P('brazier', 14, 8); P('brazier', 19, 12);
  P('broken_pillar', 4, 5); P('broken_pillar', 13, 16); P('pillar', 12, 14); P('pillar', 16, 14);
  P('statue', 20, 4, 2); P('rubble', 6, 12); P('rubble', 16, 17); P('rubble', 19, 21);
  P('stalagmite', 8, 16); P('bones', 12, 8); P('bones', 21, 13); P('urn', 11, 17); P('cobweb', 18, 2);
  P('chain', 5, 15); P('torch', 2, 14, 3); P('mushrooms', 7, 15); P('crate', 22, 11); P('barrel', 22, 12);
  autoLights(d, 'depths');
  return d.toPlan('depths', { x: 4, y: 4 }, { x: 19, y: 21 }, 1003, [{ x: 5, y: 5 }, { x: 13, y: 7 }]);
}

function foundry(): FloorPlan {
  const d = new Draft(24, 24, CHASM);
  d.rect(0, 0, 23, 0, WALL); d.rect(0, 23, 23, 23, WALL); d.rect(0, 0, 0, 23, WALL); d.rect(23, 0, 23, 23, WALL);
  // forge platforms
  d.rect(2, 2, 8, 8, FLOOR, 0); // start
  d.rect(11, 3, 16, 9, FLOOR, 1); // forge floor
  d.rect(18, 2, 21, 6, FLOOR, 2);
  d.rect(2, 12, 7, 17, FLOOR, 0); // lower left
  d.rect(10, 13, 15, 18, FLOOR, 1);
  d.rect(17, 11, 21, 15, FLOOR, 2);
  d.rect(14, 20, 21, 22, FLOOR, 0);
  // bridges
  d.rect(9, 5, 10, 5, FLOOR, 0);
  d.rect(17, 4, 17, 4, FLOOR, 1);
  d.rect(4, 9, 4, 11, FLOOR, 0);
  d.rect(8, 15, 9, 15, FLOOR, 0);
  d.rect(16, 14, 16, 14, FLOOR, 1);
  d.rect(19, 7, 19, 10, FLOOR, 2);
  d.rect(12, 10, 12, 12, FLOOR, 1);
  d.rect(15, 19, 15, 19, FLOOR, 0);
  d.rect(20, 16, 20, 19, FLOOR, 1);
  const P = d.prop.bind(d);
  // the forge hall: hearth on the north edge, anvils before it, crucibles by the lip
  P('forge', 13, 3, 2); P('forge', 15, 3, 2);
  P('anvil', 12, 5, 0); P('anvil', 15, 6, 1);
  P('crucible', 12, 8); P('crucible', 16, 8);
  P('ingots', 14, 8, 0); P('ingots', 11, 4, 1);
  P('brazier', 11, 9); P('torch', 14, 2, 0, false);
  // start platform
  P('brazier', 7, 3); P('rubble', 3, 7); P('bones', 6, 7); P('torch', 3, 1, 0, false);
  P('ingots', 3, 3, 1); P('anvil', 6, 4, 3); P('chain', 8, 8); P('chain', 2, 4);
  // others
  P('crucible', 19, 3); P('forge', 20, 5, 3); P('ingots', 18, 2, 2); P('broken_pillar', 21, 3);
  P('crucible', 3, 14); P('anvil', 5, 14, 2); P('ingots', 3, 16, 0); P('rubble', 6, 16); P('brazier', 6, 12);
  P('ingots', 13, 15, 1); P('crucible', 11, 17); P('chain', 14, 17); P('bones', 14, 14); P('broken_pillar', 11, 14);
  P('brazier', 18, 12); P('anvil', 19, 13, 0); P('crucible', 21, 12); P('chain', 17, 14);
  P('ingots', 16, 21, 0); P('crucible', 20, 21); P('rubble', 18, 21); P('brazier', 14, 22);
  autoLights(d, 'foundry');
  return d.toPlan('foundry', { x: 4, y: 4 }, { x: 19, y: 21 }, 1008, [{ x: 5, y: 6 }, { x: 14, y: 6 }]);
}

function ice(): FloorPlan {
  const d = new Draft(24, 24);
  d.ellipse(7, 7, 5.4, 4.6); // cave 1
  d.ellipse(8, 8, 2.8, 2.0, WATER); // frozen pool
  d.rect(11, 6, 14, 7);
  d.ellipse(17, 7, 4.4, 4.2); // cave 2
  d.ellipse(18, 8, 1.6, 1.2, WATER);
  d.rect(6, 11, 7, 15); // tunnel south
  d.ellipse(7, 18, 5.2, 4.2); // cave 3
  d.ellipse(7, 18, 3.2, 2.4, FLOOR, 1);
  d.rect(12, 18, 14, 18);
  d.ellipse(18, 17, 4.6, 4.2); // cave 4
  d.rect(16, 17, 20, 18, CHASM); // crevasse
  d.rect(17, 11, 17, 12);
  d.wallsAround();
  const P = d.prop.bind(d);
  // spikes grow out of the walls
  P('ice_spike', 3, 5, 0); P('ice_spike', 4, 4, 1); P('ice_spike', 11, 8, 2); P('ice_spike', 2, 8, 3); P('ice_spike', 3, 7, 1);
  P('ice_spike', 20, 4, 0); P('ice_spike', 21, 6, 2); P('ice_spike', 14, 9, 1); P('ice_spike', 15, 4, 3);
  P('ice_spike', 3, 20, 1); P('ice_spike', 10, 21, 0); P('ice_spike', 4, 15, 2);
  P('ice_spike', 20, 14, 3); P('ice_spike', 15, 20, 1); P('ice_spike', 21, 20, 0); P('ice_spike', 16, 15, 2);
  // drifts along the walls and the pool edge
  const drift = (x: number, y: number): void => P('snow_drift', x, y, (x + y) % 4, false);
  drift(4, 3); drift(8, 3); drift(11, 6); drift(3, 9); drift(10, 10); drift(5, 11);
  drift(16, 3); drift(20, 8); drift(14, 10); drift(19, 11);
  drift(5, 15); drift(4, 18); drift(8, 22); drift(10, 17); drift(12, 18);
  drift(15, 14); drift(21, 17); drift(18, 21); drift(14, 21);
  P('crystal', 21, 9); P('crystal', 3, 13); P('crystal', 5, 21); P('crystal', 12, 4);
  P('bones', 5, 10); P('bones', 17, 12, 1); P('bones', 14, 15); P('rubble', 9, 14); P('rubble', 20, 20);
  P('torch', 7, 3, 0); P('torch', 2, 18, 3); P('torch', 18, 3, 0);
  autoLights(d, 'ice');
  return d.toPlan('ice', { x: 4, y: 6 }, { x: 21, y: 18 }, 1009, [{ x: 5, y: 9 }, { x: 17, y: 5 }]);
}

function ruin(): FloorPlan {
  const d = new Draft(24, 24);
  d.rect(1, 1, 10, 8); // A: overgrown courtyard
  d.rect(8, 6, 9, 7, WATER); // pool
  d.rect(11, 4, 14, 5); // passage
  d.set(11, 4, DOOR); d.set(11, 5, DOOR);
  d.rect(15, 1, 22, 8); // B: broken hall
  d.rect(4, 9, 5, 12); // passage south
  d.set(4, 9, DOOR); d.set(5, 9, DOOR);
  d.rect(1, 13, 12, 22); // C: collapsed nave
  d.rect(14, 13, 22, 22, FLOOR, 1); // D: raised terrace
  d.set(13, 17, DOOR, 0); d.set(13, 18, DOOR, 0);
  d.rect(16, 18, 18, 20, WATER, 1);
  d.rect(18, 9, 19, 12); // passage to the terrace
  d.wallsAround();
  const P = d.prop.bind(d);
  // courtyard: a great tree, a second one in the corner, ferns, ivy on the walls
  P('gnarled_tree', 6, 4); P('gnarled_tree', 2, 7); P('bush', 5, 6, 0, false); P('bush', 7, 3, 0, false); P('bush', 1, 5, 0, false); P('bush', 9, 5, 0, false); P('bush', 10, 8, 0, false);
  P('bush', 4, 2, 0, false); P('bush', 8, 8, 0, false); P('bush', 6, 8, 0, false);
  P('vines', 3, 1, 0, false); P('vines', 7, 1, 0, false); P('vines', 10, 3, 1, false); P('vines', 1, 3, 3, false); P('vines', 5, 8, 2, false);
  P('torch', 5, 1, 0); P('torch', 9, 1, 0); P('torch', 10, 6, 1, true);
  P('rubble', 3, 5); P('broken_pillar', 9, 2); P('bones', 2, 2);
  // hall: broken colonnade, a fallen column, a statue
  P('pillar', 17, 3); P('broken_pillar', 17, 6); P('pillar', 20, 3); P('broken_pillar', 20, 6);
  P('fallen_column', 19, 4, 0); P('fallen_column', 21, 7, 1); P('statue', 16, 1, 0);
  P('vines', 18, 1, 0, false); P('vines', 21, 1, 0, false); P('vines', 22, 5, 1, false); P('vines', 15, 4, 3, false); P('vines', 19, 8, 2, false);
  P('bush', 16, 8, 0, false); P('bush', 22, 2, 0, false); P('bush', 21, 8, 0, false); P('bush', 15, 6, 0, false);
  P('torch', 16, 8, 2, true); P('torch', 22, 7, 1); P('brazier', 18, 2); P('rubble', 20, 8); P('bones', 17, 7);
  // nave
  P('gnarled_tree', 10, 15); P('gnarled_tree', 3, 20); P('fallen_column', 6, 15, 0); P('fallen_column', 8, 19, 1);
  for (const x of [3, 6, 9]) P('broken_pillar', x, 17);
  P('vines', 2, 13, 0, false); P('vines', 6, 13, 0, false); P('vines', 10, 13, 0, false); P('vines', 12, 16, 1, false); P('vines', 1, 18, 3, false); P('vines', 5, 22, 2, false);
  for (const [x, y] of [[2, 14], [4, 21], [11, 21], [1, 21], [8, 14], [12, 13], [7, 22]] as const) P('bush', x, y, 0, false);
  P('campfire', 7, 21); P('bones', 4, 16); P('rubble', 11, 18); P('torch', 3, 13, 0); P('torch', 11, 22, 2);
  // terrace
  P('gnarled_tree', 21, 21); P('bush', 15, 14, 0, false); P('bush', 21, 14, 0, false); P('bush', 15, 21, 0, false); P('bush', 20, 18, 0, false);
  P('statue', 20, 15, 3); P('broken_pillar', 15, 16); P('fallen_column', 16, 22, 0); P('mushrooms', 19, 20); P('mushrooms', 14, 20);
  P('vines', 16, 13, 0, false); P('vines', 19, 13, 0, false); P('vines', 22, 16, 1, false); P('vines', 14, 15, 3, false); P('vines', 18, 22, 2, false);
  P('torch', 22, 18, 1); P('brazier', 15, 19);
  autoLights(d, 'ruin');
  return d.toPlan('ruin', { x: 3, y: 3 }, { x: 21, y: 15 }, 1010, [{ x: 4, y: 4 }, { x: 14, y: 6 }]);
}

export const FIXTURES: Record<ThemeId, () => FloorPlan> = { warrens, crypt, sewers, fungal, hold, library, depths, foundry, ice, ruin };

export function makeFixture(theme: ThemeId): FloorPlan {
  return FIXTURES[theme]();
}

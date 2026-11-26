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
      depth: theme === 'warrens' ? 1 : theme === 'crypt' ? 2 : 3,
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
        const warm = theme === 'warrens' || (theme === 'crypt' && (x + y) % 4 === 0);
        d.light(x, y, warm ? 0xffa050 : theme === 'crypt' ? 0x60d8f0 : 0xa070ff, 1.1, theme === 'depths' ? 5 : 6.5);
        break;
      }
      case 'brazier':
        d.light(x, y, theme === 'warrens' ? 0xff8a30 : theme === 'crypt' ? 0x58d0e8 : 0x9060ff, 1.3, 6);
        break;
      case 'campfire':
        d.light(x, y, 0xff8030, 1.7, 8);
        break;
      case 'crystal':
        d.light(x, y, (x + y) % 2 ? 0xa070ff : 0x40e0ff, 1.1, 5);
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

export const FIXTURES: Record<ThemeId, () => FloorPlan> = { warrens, crypt, depths };

export function makeFixture(theme: ThemeId): FloorPlan {
  return FIXTURES[theme]();
}

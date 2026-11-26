import type { Rng } from '../core/rng';
import type { GridPos, PropPlacement, RoomRole } from '../core/types';
import { Grid, K, NEI4, NEI8, isWalkKind } from './grid';

/** What a theme generator hands to the shared post-processing. */
export interface Layout {
  grid: Grid;
  /** Role per room id (room id = index). */
  roles: RoomRole[];
  /** Edges that were actually carved. */
  edges: Array<[number, number]>;
  /** Place themed props once entrance/exit are known. */
  decorate(ctx: DecorCtx): void;
  /** Name of the memorable feature this floor was built around. */
  setPiece?: string;
}

export interface RoomInfo {
  id: number;
  role: RoomRole;
  /** Walkable cell indices belonging to the room. */
  cells: number[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  center: GridPos;
}

export interface DecorCtx {
  grid: Grid;
  rng: Rng;
  depth: number;
  rooms: RoomInfo[];
  props: PropLayer;
  /** Distance (in cells) from each walkable cell to the nearest non-walkable cell. */
  edge: Uint8Array;
  /** For room cells: steps from the nearest doorway of the room (-1 elsewhere). */
  doorDist: Int16Array;
  entrance: GridPos;
  exit: GridPos;
}

export const LIGHT_TYPES = new Set(['torch', 'campfire', 'brazier', 'mushrooms', 'crystal', 'giant_mushroom', 'candelabra']);

/**
 * Prop bookkeeping with safety rules: blocking props never land on reserved cells
 * and are rejected when they would locally cut the walkable ring around them,
 * which keeps decoration from disconnecting a floor.
 */
export class PropLayer {
  readonly list: PropPlacement[] = [];
  /** 0 none, 1 non-blocking, 2 blocking. */
  readonly occ: Uint8Array;
  /** Cells where blocking props are banned (doorways, centers, entrance, exit). */
  readonly reserved: Uint8Array;
  /** Cells where no prop may go (entrance and exit). */
  readonly keepFree: Uint8Array;
  /** Optional light colour per cell index (braziers, crystals). */
  readonly tint = new Map<number, number>();

  constructor(readonly g: Grid) {
    this.occ = new Uint8Array(g.w * g.h);
    this.reserved = new Uint8Array(g.w * g.h);
    this.keepFree = new Uint8Array(g.w * g.h);
  }

  free(x: number, y: number): boolean {
    if (!this.g.inb(x, y)) return false;
    const i = this.g.idx(x, y);
    return this.g.kinds[i] === K.Floor && this.occ[i] === 0 && !this.keepFree[i];
  }

  /** Whether `place` would succeed right now. */
  can(x: number, y: number, blocking: boolean): boolean {
    if (!this.free(x, y)) return false;
    if (!blocking) return true;
    const i = this.g.idx(x, y);
    return !this.reserved[i] && this.ringRuns(x, y) <= 1;
  }

  place(type: string, x: number, y: number, rotation: number, blocking: boolean): boolean {
    if (!this.can(x, y, blocking)) return false;
    const i = this.g.idx(x, y);
    this.occ[i] = blocking ? 2 : 1;
    this.list.push({ type, pos: { x, y }, rotation: ((rotation % 4) + 4) % 4, blocking });
    return true;
  }

  /** Number of separate open runs in the 8-neighbour ring (>1 means blocking this cell splits them). */
  private ringRuns(x: number, y: number): number {
    const open: boolean[] = [];
    for (const [dx, dy] of NEI8) {
      const nx = x + dx;
      const ny = y + dy;
      open.push(
        this.g.inb(nx, ny) && isWalkKind(this.g.kinds[ny * this.g.w + nx] as number) && this.occ[ny * this.g.w + nx] !== 2,
      );
    }
    let runs = 0;
    for (let k = 0; k < 8; k++) if (open[k] && !open[(k + 7) % 8]) runs++;
    return runs;
  }

  /** Rotation pointing from (x,y) at an adjacent Wall, or -1. Prefers the given order. */
  wallDir(x: number, y: number, rng?: Rng): number {
    const dirs = [0, 1, 2, 3];
    if (rng) rng.shuffle(dirs);
    for (const r of dirs) {
      const [dx, dy] = NEI4[r] as readonly [number, number];
      if (this.g.kind(x + dx, y + dy) === K.Wall) return r;
    }
    return -1;
  }
}

/** Mirror helpers for symmetric rooms: reflect across the axis between c and c+1. */
export function mirror(c: number, v: number): number {
  return 2 * c + 1 - v;
}

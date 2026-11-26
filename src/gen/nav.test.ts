import { describe, expect, it } from 'vitest';
import type { FloorPlan, PropPlacement } from '../core/types';
import { CellKind } from '../core/types';
import { createNavGrid } from './nav';

/**
 * Build a tiny plan from ASCII rows: '#' wall, '.' floor, '~' water, ':' chasm,
 * '+' door, ' ' void. `elev` rows (digits) override per-cell elevation.
 */
function mini(rows: string[], elev?: string[], props: PropPlacement[] = []): FloorPlan {
  const h = rows.length;
  const w = rows[0]!.length;
  const kinds = new Uint8Array(w * h);
  const elevation = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y]![x]!;
      kinds[y * w + x] =
        c === '#' ? CellKind.Wall : c === '.' ? CellKind.Floor : c === '~' ? CellKind.Water : c === ':' ? CellKind.Chasm : c === '+' ? CellKind.Door : CellKind.Void;
      if (elev) elevation[y * w + x] = Number(elev[y]![x] ?? 0) || 0;
    }
  }
  return {
    seed: 0,
    depth: 1,
    theme: 'crypt',
    width: w,
    height: h,
    kinds,
    elevation,
    roomIds: new Int16Array(w * h).fill(-1),
    rooms: [],
    entrance: { x: 1, y: 1 },
    exit: { x: 1, y: 1 },
    spawns: [],
    props,
    lights: [],
    restSpots: [],
  };
}

const p = (x: number, y: number) => ({ x, y });

describe('NavGrid.stepCost', () => {
  it('allows orthogonal and open diagonal steps at cost 1', () => {
    const nav = createNavGrid(mini(['####', '#..#', '#..#', '####']));
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(1);
    expect(nav.stepCost(p(1, 1), p(2, 2))).toBe(1);
  });

  it('forbids cutting corners when either orthogonal neighbour is not walkable', () => {
    const wall = createNavGrid(mini(['####', '#.##', '##.#', '####']));
    expect(wall.stepCost(p(1, 1), p(2, 2))).toBe(Infinity);
    const oneSide = createNavGrid(mini(['####', '#..#', '##.#', '####']));
    expect(oneSide.stepCost(p(1, 1), p(2, 2))).toBe(Infinity);
    expect(oneSide.stepCost(p(2, 1), p(2, 2))).toBe(1);
    const chasm = createNavGrid(mini(['#####', '#.:.#', '#:..#', '#####']));
    expect(chasm.stepCost(p(1, 1), p(2, 2))).toBe(Infinity);
  });

  it('treats blocking props like walls, including for corner cutting', () => {
    const plan = mini(['####', '#..#', '#..#', '####'], undefined, [{ type: 'pillar', pos: p(2, 1), rotation: 0, blocking: true }]);
    const nav = createNavGrid(plan);
    expect(nav.isWalkable(p(2, 1))).toBe(false);
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(Infinity);
    expect(nav.stepCost(p(1, 1), p(2, 2))).toBe(Infinity);
    const free = createNavGrid(mini(['####', '#..#', '#..#', '####'], undefined, [{ type: 'rubble', pos: p(2, 1), rotation: 0, blocking: false }]));
    expect(free.stepCost(p(1, 1), p(2, 1))).toBe(1);
  });

  it('limits elevation differences to MAX_STEP_UP in both directions', () => {
    const nav = createNavGrid(mini(['#####', '#...#', '#####'], ['00000', '01230', '00000']));
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(1); // 1 -> 2
    expect(nav.stepCost(p(2, 1), p(3, 1))).toBe(1); // 2 -> 3
    const steep = createNavGrid(mini(['#####', '#...#', '#####'], ['00000', '00200', '00000']));
    expect(steep.stepCost(p(1, 1), p(2, 1))).toBe(Infinity);
    expect(steep.stepCost(p(2, 1), p(1, 1))).toBe(Infinity);
    expect(steep.elevationAt(p(2, 1))).toBe(2);
  });

  it('charges 2 for entering water, 1 for leaving it', () => {
    const nav = createNavGrid(mini(['#####', '#.~.#', '#####']));
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(2);
    expect(nav.stepCost(p(2, 1), p(3, 1))).toBe(1);
  });

  it('rejects non-adjacent, out-of-bounds, chasm, wall and void targets', () => {
    const nav = createNavGrid(mini(['######', '#.:.##', '######']));
    expect(nav.stepCost(p(1, 1), p(3, 1))).toBe(Infinity);
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(Infinity);
    expect(nav.stepCost(p(1, 1), p(1, 0))).toBe(Infinity);
    expect(nav.stepCost(p(0, 0), p(-1, 0))).toBe(Infinity);
    expect(nav.inBounds(p(5, 2))).toBe(true);
    expect(nav.inBounds(p(6, 2))).toBe(false);
  });

  it('door cells are walkable at cost 1', () => {
    const nav = createNavGrid(mini(['#####', '#.+.#', '#####']));
    expect(nav.isWalkable(p(2, 1))).toBe(true);
    expect(nav.stepCost(p(1, 1), p(2, 1))).toBe(1);
  });
});

describe('NavGrid.hasLineOfSight', () => {
  const room = [
    '#########',
    '#.......#',
    '#.......#',
    '#.......#',
    '#########',
  ];

  it('sees across open floor and itself', () => {
    const nav = createNavGrid(mini(room));
    expect(nav.hasLineOfSight(p(1, 1), p(7, 3))).toBe(true);
    expect(nav.hasLineOfSight(p(2, 2), p(2, 2))).toBe(true);
  });

  it('is blocked by walls but not by chasm', () => {
    const wall = createNavGrid(mini(['#########', '#...#...#', '#########']));
    expect(wall.hasLineOfSight(p(1, 1), p(7, 1))).toBe(false);
    const chasm = createNavGrid(mini(['#########', '#...:...#', '#########']));
    expect(chasm.hasLineOfSight(p(1, 1), p(7, 1))).toBe(true);
    expect(chasm.isWalkable(p(4, 1))).toBe(false);
  });

  it('is symmetric', () => {
    const plan = mini([
      '##########',
      '#........#',
      '#...##...#',
      '#........#',
      '#.#......#',
      '##########',
    ]);
    const nav = createNavGrid(plan);
    for (let ay = 1; ay <= 4; ay++) {
      for (let ax = 1; ax <= 8; ax++) {
        for (let by = 1; by <= 4; by++) {
          for (let bx = 1; bx <= 8; bx++) {
            expect(nav.hasLineOfSight(p(ax, ay), p(bx, by))).toBe(nav.hasLineOfSight(p(bx, by), p(ax, ay)));
          }
        }
      }
    }
  });

  it('does not slip through a diagonal gap between two wall corners', () => {
    const nav = createNavGrid(mini(['#####', '#.#.#', '##.##', '#.#.#', '#####']));
    // (1,1) to (3,3) passes exactly through (2,2) with walls at (2,1) and (1,2),(3,2),(2,3)
    expect(nav.hasLineOfSight(p(1, 1), p(3, 3))).toBe(false);
  });

  it('sees along a diagonal past a single wall corner', () => {
    const nav = createNavGrid(mini(['#####', '#...#', '#.#.#', '#...#', '#####']));
    expect(nav.hasLineOfSight(p(1, 1), p(3, 3))).toBe(false); // through the centre wall
    expect(nav.hasLineOfSight(p(1, 1), p(1, 3))).toBe(true);
  });

  it('does not see out of bounds', () => {
    const nav = createNavGrid(mini(room));
    expect(nav.hasLineOfSight(p(1, 1), p(20, 1))).toBe(false);
  });
});

describe('NavGrid.findPath', () => {
  const open = mini([
    '#########',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#########',
  ]);

  it('returns a path excluding the start and including the target', () => {
    const nav = createNavGrid(open);
    const path = nav.findPath(p(1, 1), p(5, 1))!;
    expect(path).toHaveLength(4);
    expect(path[path.length - 1]).toEqual(p(5, 1));
    expect(nav.findPath(p(1, 1), p(1, 1))).toEqual([]);
  });

  it('uses diagonals (Chebyshev distance)', () => {
    const nav = createNavGrid(open);
    expect(nav.findPath(p(1, 1), p(4, 4))).toHaveLength(3);
    expect(nav.findPath(p(1, 1), p(7, 4))).toHaveLength(6);
  });

  it('every step of a path is a legal step', () => {
    const nav = createNavGrid(
      mini(['##########', '#........#', '#.######.#', '#.#....#.#', '#.#.##.#.#', '#...##...#', '##########']),
    );
    const path = nav.findPath(p(1, 1), p(5, 3))!;
    expect(path).not.toBeNull();
    let prev = p(1, 1);
    for (const c of path) {
      expect(nav.stepCost(prev, c)).toBeLessThan(Infinity);
      prev = c;
    }
  });

  it('returns null for unreachable or unwalkable targets', () => {
    const nav = createNavGrid(mini(['#######', '#..#..#', '#######']));
    expect(nav.findPath(p(1, 1), p(5, 1))).toBeNull();
    expect(nav.findPath(p(1, 1), p(3, 1))).toBeNull();
  });

  it('routes around blocked cells and returns null when fully blocked', () => {
    const nav = createNavGrid(mini(['#####', '#...#', '#...#', '#...#', '#####']));
    const direct = nav.findPath(p(1, 2), p(3, 2))!;
    expect(direct).toHaveLength(2);
    const around = nav.findPath(p(1, 2), p(3, 2), { blocked: (c) => c.x === 2 && c.y === 2 })!;
    expect(around.some((c) => c.x === 2 && c.y === 2)).toBe(false);
    expect(around.length).toBeGreaterThanOrEqual(2);
    const wallOff = nav.findPath(p(1, 2), p(3, 2), { blocked: (c) => c.x === 2 });
    expect(wallOff).toBeNull();
    expect(nav.findPath(p(1, 2), p(3, 2), { blocked: (c) => c.x === 3 && c.y === 2 })).toBeNull();
  });

  it('prefers a longer dry route over water when it is cheaper', () => {
    const nav = createNavGrid(mini(['#######', '#.~~~.#', '#.....#', '#######']));
    const path = nav.findPath(p(1, 1), p(5, 1))!;
    expect(path.some((c) => c.y === 1 && c.x >= 2 && c.x <= 4)).toBe(false);
  });

  it('honours maxCost, counting water at 2', () => {
    const nav = createNavGrid(mini(['#######', '#.~~..#', '#######']));
    // 1,1 -> 2,1 (2) -> 3,1 (2) -> 4,1 (1) = 5
    expect(nav.findPath(p(1, 1), p(4, 1), { maxCost: 5 })).toHaveLength(3);
    expect(nav.findPath(p(1, 1), p(4, 1), { maxCost: 4 })).toBeNull();
    expect(nav.findPath(p(1, 1), p(2, 1), { maxCost: 2 })).toHaveLength(1);
    expect(nav.findPath(p(1, 1), p(2, 1), { maxCost: 1 })).toBeNull();
  });

  it('climbs staircases but not cliffs', () => {
    const stairs = createNavGrid(mini(['#######', '#.....#', '#######'], ['0000000', '0012100', '0000000']));
    expect(stairs.findPath(p(1, 1), p(5, 1))).toHaveLength(4);
    const cliff = createNavGrid(mini(['#######', '#.....#', '#######'], ['0000000', '0002000', '0000000']));
    expect(cliff.findPath(p(1, 1), p(5, 1))).toBeNull();
  });

  it('can be called repeatedly (scratch buffers are reused safely)', () => {
    const nav = createNavGrid(open);
    for (let i = 0; i < 50; i++) {
      expect(nav.findPath(p(1, 1), p(7, 4))).toHaveLength(6);
      expect(nav.findPath(p(7, 4), p(1, 1))).toHaveLength(6);
    }
  });
});

describe('NavGrid.reachable', () => {
  const open = mini(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']);

  it('includes the origin at cost 0 and respects the budget (Chebyshev rings)', () => {
    const nav = createNavGrid(open);
    const cells = nav.reachable(p(3, 3), 1);
    expect(cells).toHaveLength(9);
    expect(cells.find((c) => c.pos.x === 3 && c.pos.y === 3)?.cost).toBe(0);
    expect(nav.reachable(p(3, 3), 0)).toHaveLength(1);
    expect(nav.reachable(p(3, 3), 2)).toHaveLength(25);
  });

  it('charges water double', () => {
    const nav = createNavGrid(mini(['#######', '#.~~..#', '#######']));
    const cells = nav.reachable(p(1, 1), 3);
    const byX = new Map(cells.map((c) => [c.pos.x, c.cost]));
    expect(byX.get(2)).toBe(2);
    expect(byX.has(3)).toBe(false);
    const more = new Map(nav.reachable(p(1, 1), 5).map((c) => [c.pos.x, c.cost]));
    expect(more.get(3)).toBe(4);
    expect(more.get(4)).toBe(5);
  });

  it('honours blocked cells and does not cross walls, chasms or cliffs', () => {
    const nav = createNavGrid(mini(['#######', '#..:..#', '#######']));
    expect(nav.reachable(p(1, 1), 10).map((c) => c.pos.x).sort()).toEqual([1, 2]);
    const blocked = createNavGrid(open).reachable(p(1, 1), 3, { blocked: (c) => c.x === 2 });
    expect(blocked.some((c) => c.pos.x > 1)).toBe(false);
  });

  it('is consistent with findPath costs', () => {
    const nav = createNavGrid(
      mini(['##########', '#........#', '#.~~~##..#', '#.....#..#', '##########']),
    );
    for (const c of nav.reachable(p(1, 1), 12)) {
      const path = nav.findPath(p(1, 1), c.pos);
      expect(path).not.toBeNull();
      let cost = 0;
      let prev = p(1, 1);
      for (const s of path!) {
        cost += nav.stepCost(prev, s);
        prev = s;
      }
      expect(cost).toBe(c.cost);
    }
  });
});

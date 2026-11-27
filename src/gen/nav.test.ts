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

describe('NavGrid.hazardAt', () => {
  it('reads chasm and water from the plan, as lava / ice when the plan says so', () => {
    const rows = ['#####', '#.:~#', '#####'];
    const plain = createNavGrid(mini(rows));
    expect(plain.hazardAt(p(1, 1))).toBe('none');
    expect(plain.hazardAt(p(2, 1))).toBe('fall');
    expect(plain.hazardAt(p(3, 1))).toBe('water');
    expect(plain.hazardAt(p(0, 0))).toBe('none');
    expect(plain.hazardAt(p(-1, 5))).toBe('none');
    const themed = createNavGrid({ ...mini(rows), chasmHazard: 'lava', waterHazard: 'ice' });
    expect(themed.hazardAt(p(2, 1))).toBe('lava');
    expect(themed.hazardAt(p(3, 1))).toBe('ice');
  });
});

describe('NavGrid.coverBetween', () => {
  const pillar = (x: number, y: number): PropPlacement => ({ type: 'pillar', pos: p(x, y), rotation: 0, blocking: true });
  const room = ['###########', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '###########'];

  it('is 0 across open floor, for every pair of cells', () => {
    const nav = createNavGrid(mini(room));
    for (let ay = 1; ay <= 5; ay++) {
      for (let ax = 1; ax <= 9; ax++) {
        for (let ty = 1; ty <= 5; ty++) {
          for (let tx = 1; tx <= 9; tx++) {
            expect(nav.coverBetween(p(ax, ay), p(tx, ty))).toBe(0);
          }
        }
      }
    }
  });

  it('is 5 for a target directly behind a pillar, 2 beside it, and 0 in front of it', () => {
    const nav = createNavGrid(mini(room, undefined, [pillar(4, 3)]));
    expect(nav.coverBetween(p(1, 3), p(5, 3))).toBe(5);
    expect(nav.coverBetween(p(1, 3), p(4, 2))).toBe(2);
    expect(nav.coverBetween(p(1, 3), p(4, 4))).toBe(2);
    expect(nav.coverBetween(p(1, 3), p(3, 3))).toBe(0);
    expect(nav.coverBetween(p(1, 1), p(9, 1))).toBe(0);
    // The attacker beside the pillar is covered too, and a pillar that is not in the way gives nothing.
    expect(nav.coverBetween(p(1, 5), p(9, 5))).toBe(0);
  });

  it('props never block sight, only give cover; non-blocking props give nothing', () => {
    const plan = mini(room, undefined, [pillar(4, 3)]);
    const nav = createNavGrid(plan);
    expect(nav.hasLineOfSight(p(1, 3), p(5, 3))).toBe(true);
    const rubble = createNavGrid(mini(room, undefined, [{ type: 'rubble', pos: p(4, 3), rotation: 0, blocking: false }]));
    expect(rubble.coverBetween(p(1, 3), p(5, 3))).toBe(0);
  });

  it('gives half cover where a wall corner clips the line (exactly one corner cell solid)', () => {
    const nav = createNavGrid(mini(['#####', '#.#.#', '#...#', '#####']));
    expect(nav.hasLineOfSight(p(1, 1), p(3, 1))).toBe(false);
    // Diagonal past one wall cell: sight passes, half cover.
    expect(nav.hasLineOfSight(p(1, 1), p(2, 2))).toBe(true);
    expect(nav.coverBetween(p(1, 1), p(2, 2))).toBe(2);
    // Both corner cells solid: no sight, so no cover value.
    const shut = createNavGrid(mini(['####', '#.##', '##.#', '####']));
    expect(shut.coverBetween(p(1, 1), p(2, 2))).toBe(0);
  });

  it('gives half cover for a target round a doorway edge and none straight through it', () => {
    const wall = ['###########', '#.........#', '#.........#', '#####.#####', '#.........#', '#.........#', '###########'];
    const nav = createNavGrid(mini(wall));
    expect(nav.coverBetween(p(5, 4), p(5, 2))).toBe(0);
    expect(nav.hasLineOfSight(p(5, 4), p(4, 1))).toBe(true);
    expect(nav.coverBetween(p(5, 4), p(4, 1))).toBeGreaterThanOrEqual(2);
    expect(nav.coverBetween(p(5, 4), p(6, 1))).toBeGreaterThanOrEqual(2);
  });

  it('is symmetric for mirror-symmetric geometry', () => {
    const nav = createNavGrid(mini(room, undefined, [pillar(5, 3)]));
    for (const [ax, ay, tx, ty] of [
      [1, 3, 9, 3],
      [2, 1, 8, 5],
      [2, 5, 8, 1],
    ] as const) {
      expect(nav.coverBetween(p(ax, ay), p(tx, ty))).toBe(nav.coverBetween(p(tx, ty), p(ax, ay)));
    }
  });

  it('is defined for any cells, including out of bounds and the same cell', () => {
    const nav = createNavGrid(mini(room));
    expect(nav.coverBetween(p(2, 2), p(2, 2))).toBe(0);
    expect(nav.coverBetween(p(-3, 2), p(2, 2))).toBe(0);
    expect(nav.coverBetween(p(0, 0), p(2, 2))).toBe(0);
  });
});

describe('NavGrid.obstacleAt', () => {
  const prop = (type: string, x: number, y: number, blocking = true): PropPlacement => ({ type, pos: p(x, y), rotation: 0, blocking });
  it('names fire and spike props and nothing else', () => {
    const nav = createNavGrid(
      mini(['#######', '#.....#', '#######'], undefined, [prop('brazier', 1, 1), prop('stalagmite', 2, 1), prop('pillar', 3, 1), prop('torch', 4, 1, false), prop('ice_spike', 5, 1)]),
    );
    expect(nav.obstacleAt!(p(1, 1))).toBe('fire');
    expect(nav.obstacleAt!(p(2, 1))).toBe('spikes');
    expect(nav.obstacleAt!(p(3, 1))).toBe('none');
    expect(nav.obstacleAt!(p(4, 1))).toBe('none');
    expect(nav.obstacleAt!(p(5, 1))).toBe('spikes');
    expect(nav.obstacleAt!(p(0, 0))).toBe('none');
    expect(nav.obstacleAt!(p(-4, 9))).toBe('none');
    expect(nav.isWalkable(p(1, 1))).toBe(false);
  });
});

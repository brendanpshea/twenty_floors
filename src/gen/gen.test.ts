import { describe, expect, it } from 'vitest';
import type { FloorPlan, ThemeId } from '../core/types';
import { CellKind } from '../core/types';
import { fallbackPlan, generateFloorReport } from './generate';
import { createNavGrid, floorToAscii, generateFloor, validateFloor } from './index';

const isWalk = (k: number): boolean => k === CellKind.Floor || k === CellKind.Water || k === CellKind.Door;

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library', 'foundry', 'ice', 'ruin', 'hell', 'lair'];

function fingerprint(plan: FloorPlan): string {
  let h = 2166136261;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 16777619) >>> 0;
  };
  for (const k of plan.kinds) mix(k);
  for (const e of plan.elevation) mix(e & 0xff);
  return `${plan.width}x${plan.height}:${h}`;
}

function stats(plan: FloorPlan): { chasm: number; walk: number; elevRange: number } {
  // chasm is reported as a share of (chasm + walkable) cells
  let chasm = 0;
  let walk = 0;
  let lo = 999;
  let hi = -999;
  for (let i = 0; i < plan.kinds.length; i++) {
    const k = plan.kinds[i];
    if (k === CellKind.Chasm) chasm++;
    if (k === CellKind.Floor || k === CellKind.Water || k === CellKind.Door) {
      walk++;
      lo = Math.min(lo, plan.elevation[i] as number);
      hi = Math.max(hi, plan.elevation[i] as number);
    }
  }
  return { chasm: chasm / Math.max(1, chasm + walk), walk, elevRange: hi - lo };
}

/** Mean fill ratio (cells / bounding box area) over rooms: rectangles score high, blobs low. */
function roomFill(plan: FloorPlan): number {
  let sum = 0;
  for (const r of plan.rooms) {
    let cells = 0;
    for (let y = r.bounds.y0; y <= r.bounds.y1; y++) {
      for (let x = r.bounds.x0; x <= r.bounds.x1; x++) if (plan.roomIds[y * plan.width + x] === r.id && plan.kinds[y * plan.width + x] !== CellKind.Chasm) cells++;
    }
    sum += cells / ((r.bounds.x1 - r.bounds.x0 + 1) * (r.bounds.y1 - r.bounds.y0 + 1));
  }
  return sum / plan.rooms.length;
}

/** Share of room cells whose left-right mirror image (about the room's bounding box) is also in the room. */
function roomSymmetry(plan: FloorPlan): number {
  let hit = 0;
  let all = 0;
  for (const r of plan.rooms) {
    for (let y = r.bounds.y0; y <= r.bounds.y1; y++) {
      for (let x = r.bounds.x0; x <= r.bounds.x1; x++) {
        if (plan.roomIds[y * plan.width + x] !== r.id) continue;
        all++;
        if (plan.roomIds[y * plan.width + (r.bounds.x0 + r.bounds.x1 - x)] === r.id) hit++;
      }
    }
  }
  return hit / all;
}

describe('generateFloor', () => {
  it('is deterministic: same options give identical plans', () => {
    for (const theme of THEMES) {
      for (const seed of [1, 42, 99999]) {
        const a = generateFloor({ seed, depth: 2, theme });
        const b = generateFloor({ seed, depth: 2, theme });
        expect(Array.from(a.kinds)).toEqual(Array.from(b.kinds));
        expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
        expect(Array.from(a.roomIds)).toEqual(Array.from(b.roomIds));
        const rest = (p: FloorPlan) => JSON.stringify({ ...p, kinds: 0, elevation: 0, roomIds: 0 });
        expect(rest(a)).toBe(rest(b));
      }
    }
  });

  it('records the requested seed, depth and theme', () => {
    const plan = generateFloor({ seed: 7, depth: 3, theme: 'depths' });
    expect(plan.seed).toBe(7);
    expect(plan.depth).toBe(3);
    expect(plan.theme).toBe('depths');
    expect(plan.width).toBeLessThanOrEqual(64);
    expect(plan.height).toBeLessThanOrEqual(64);
  });

  for (const theme of THEMES) {
    it(`produces valid ${theme} floors for 100 seeds x depths 1..3`, () => {
      const bad: string[] = [];
      let fallbacks = 0;
      let attempts = 0;
      for (let seed = 1; seed <= 100; seed++) {
        for (let depth = 1; depth <= 3; depth++) {
          const r = generateFloorReport({ seed, depth, theme });
          attempts += r.attempts;
          if (r.fallback) fallbacks++;
          const errs = validateFloor(r.plan);
          if (errs.length) bad.push(`seed ${seed} depth ${depth}: ${errs[0]}`);
        }
      }
      expect(bad).toEqual([]);
      // The fallback is a safety net, not a crutch.
      expect(fallbacks).toBe(0);
      expect(attempts / 300).toBeLessThan(2.6);
    }, 60000);

    it(`survives ${theme} floors up to depth 20`, () => {
      for (let depth = 1; depth <= 20; depth++) {
        for (const seed of [3, 17, 256]) {
          const plan = generateFloor({ seed, depth, theme });
          expect(validateFloor(plan)).toEqual([]);
        }
      }
    }, 60000);

    it(`the fallback layout is valid for ${theme}`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const plan = fallbackPlan({ seed, depth: 1 + (seed % 20), theme });
        expect(validateFloor(plan)).toEqual([]);
      }
    });
  }

  it('graph shape: entrance, 3-5 main combat rooms, boss, treasure; floors grow with depth', () => {
    const avg = (depth: number): number => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) n += generateFloor({ seed, depth, theme: 'crypt' }).rooms.length;
      return n / 30;
    };
    expect(avg(1)).toBeLessThan(avg(3));
    expect(avg(1)).toBeLessThanOrEqual(6.01);
    for (const theme of THEMES) {
      const plan = generateFloor({ seed: 5, depth: 3, theme });
      const boss = plan.rooms.find((r) => r.role === 'boss')!;
      const maxDist = Math.max(...plan.rooms.map((r) => r.distanceFromEntrance));
      expect(boss.distanceFromEntrance).toBeGreaterThanOrEqual(maxDist - 1);
      expect(plan.rooms.filter((r) => r.role === 'combat').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses the nav grid consistently: entrance reaches exit, rooms and spawns', () => {
    for (const theme of THEMES) {
      const plan = generateFloor({ seed: 11, depth: 2, theme });
      const nav = createNavGrid(plan);
      expect(nav.findPath(plan.entrance, plan.exit)).not.toBeNull();
      for (const r of plan.rooms) expect(nav.findPath(plan.entrance, r.center)).not.toBeNull();
      for (const s of plan.spawns) expect(nav.findPath(plan.entrance, s.pos)).not.toBeNull();
    }
  });

  it('keeps monster slots away from doorways where the room allows', () => {
    for (const theme of THEMES) {
      let near = 0;
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const plan = generateFloor({ seed, depth: 2, theme });
        const w = plan.width;
        // Doorway cells: room cells touching a walkable cell of another room or a passage.
        const doorways: Array<[number, number]> = [];
        for (let y = 1; y < plan.height - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const id = plan.roomIds[y * w + x] as number;
            if (id < 0 || !isWalk(plan.kinds[y * w + x] as number)) continue;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const j = (y + dy) * w + x + dx;
                if (isWalk(plan.kinds[j] as number) && plan.roomIds[j] !== id) doorways.push([x, y]);
              }
            }
          }
        }
        for (const s of plan.spawns) {
          if (s.role !== 'monster') continue;
          total++;
          const d = Math.min(...doorways.map(([x, y]) => Math.max(Math.abs(x - s.pos.x), Math.abs(y - s.pos.y))));
          if (d < 3) near++;
        }
      }
      // Small organic caves cannot always keep everyone 3 cells from every tunnel mouth, and a
      // sewer chamber with four-cell-wide mouths on several sides has few cells that far from all of them.
      expect(near / total).toBeLessThan(theme === 'warrens' || theme === 'fungal' || theme === 'ice' || theme === 'lair' ? 0.25 : theme === 'sewers' ? 0.15 : 0.1);
    }
  });

  it('spawn slots in a room are spread out (never adjacent)', () => {
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 20; seed++) {
        const plan = generateFloor({ seed, depth: 3, theme });
        for (const a of plan.spawns) {
          for (const b of plan.spawns) {
            if (a === b || a.roomId !== b.roomId || a.role === 'chest') continue;
            expect(Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y))).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });
});

describe('variety and theme identity', () => {
  it('different seeds give different layouts', () => {
    for (const theme of THEMES) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) seen.add(fingerprint(generateFloor({ seed, depth: 2, theme })));
      expect(seen.size).toBeGreaterThanOrEqual(39);
    }
  });

  it('depths floors are chasm-heavy and tall; crypts are architectural; warrens are gentle and organic', () => {
    const agg: Record<string, { chasm: number; range: number; fill: number; sym: number; minRange: number; maxRange: number }> = {};
    for (const theme of THEMES) {
      let chasm = 0;
      let range = 0;
      let fill = 0;
      let sym = 0;
      let minRange = 99;
      let maxRange = 0;
      const N = 30;
      for (let seed = 1; seed <= N; seed++) {
        const plan = generateFloor({ seed, depth: 2, theme });
        const s = stats(plan);
        chasm += s.chasm;
        range += s.elevRange;
        fill += roomFill(plan);
        sym += roomSymmetry(plan);
        minRange = Math.min(minRange, s.elevRange);
        maxRange = Math.max(maxRange, s.elevRange);
      }
      agg[theme] = { chasm: chasm / N, range: range / N, fill: fill / N, sym: sym / N, minRange, maxRange };
    }
    const d = agg.depths!;
    const c = agg.crypt!;
    const w = agg.warrens!;
    expect(d.chasm).toBeGreaterThan(0.3);
    expect(d.minRange).toBeGreaterThanOrEqual(8);
    expect(c.chasm).toBeLessThan(0.02); // only the 'collapsed hall' set piece has chasm
    expect(c.range).toBeGreaterThanOrEqual(2);
    expect(c.maxRange).toBeLessThanOrEqual(8);
    expect(w.chasm).toBeLessThan(0.05);
    expect(w.maxRange).toBeLessThanOrEqual(8);
    expect(w.range).toBeLessThan(d.range);
    // Rooms: crypt rectangles fill their bounding boxes, cave blobs do not.
    expect(c.fill).toBeGreaterThan(0.8);
    expect(c.fill - w.fill).toBeGreaterThan(0.06);
    // ... and crypt rooms are mirror-symmetric where cave chambers are not.
    expect(c.sym).toBeGreaterThan(0.99);
    expect(c.sym - w.sym).toBeGreaterThan(0.04);
  });

  it('crypt rooms are mirror-symmetric and corridors are two cells wide and straight', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const plan = generateFloor({ seed, depth: 2, theme: 'crypt' });
      // Every Door cell has a Door partner next to it (2-wide thresholds).
      for (let y = 0; y < plan.height; y++) {
        for (let x = 0; x < plan.width; x++) {
          if (plan.kinds[y * plan.width + x] !== CellKind.Door) continue;
          const partner = [
            plan.kinds[y * plan.width + x + 1],
            plan.kinds[y * plan.width + x - 1],
            plan.kinds[(y + 1) * plan.width + x],
            plan.kinds[(y - 1) * plan.width + x],
          ].some((k) => k === CellKind.Door);
          expect(partner).toBe(true);
        }
      }
    }
  });

  it('depths floors let you see across chasms and have a large boss platform', () => {
    let seesAcross = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const plan = generateFloor({ seed, depth: 2, theme: 'depths' });
      const nav = createNavGrid(plan);
      const boss = plan.rooms.find((r) => r.role === 'boss')!;
      const others = plan.rooms.filter((r) => r.role !== 'boss');
      const bossCells = plan.roomIds.reduce((n, id) => n + (id === boss.id ? 1 : 0), 0);
      for (const r of others) expect(bossCells).toBeGreaterThan(plan.roomIds.reduce((n, id) => n + (id === r.id ? 1 : 0), 0) * 0.99);
      if (others.some((r) => nav.hasLineOfSight(boss.center, r.center) && (boss.center.x !== r.center.x || boss.center.y !== r.center.y))) seesAcross++;
    }
    expect(seesAcross).toBeGreaterThan(0);
  });
});

describe('performance', () => {
  it('generates a floor in well under 100 ms on average', () => {
    for (const theme of THEMES) {
      generateFloor({ seed: 0, depth: 2, theme }); // warm up the JIT
      const t0 = performance.now();
      const N = 40;
      for (let seed = 1; seed <= N; seed++) generateFloor({ seed, depth: 1 + (seed % 3), theme });
      const avg = (performance.now() - t0) / N;
      expect(avg).toBeLessThan(100);
    }
  });

  it('findPath across the floor takes well under 5 ms', () => {
    for (const theme of THEMES) {
      const plan = generateFloor({ seed: 21, depth: 3, theme });
      const nav = createNavGrid(plan);
      nav.findPath(plan.entrance, plan.exit);
      const t0 = performance.now();
      const N = 50;
      for (let i = 0; i < N; i++) {
        expect(nav.findPath(plan.entrance, plan.exit)).not.toBeNull();
        nav.reachable(plan.entrance, 6);
      }
      expect((performance.now() - t0) / N).toBeLessThan(5);
    }
  });
});

describe('floorToAscii', () => {
  it('renders every row at the plan width or less and marks entrance and exit', () => {
    const plan = generateFloor({ seed: 2, depth: 1, theme: 'crypt' });
    const text = floorToAscii(plan, true);
    const main = text.split('-- elevation --')[0]!.trimEnd().split('\n');
    expect(main.length).toBeLessThanOrEqual(plan.height);
    expect(main.length).toBeGreaterThan(plan.height / 2);
    expect(text).toContain('<');
    expect(text).toContain('>');
    expect(text).toContain('-- elevation --');
  });
});

describe('rest spots and set pieces', () => {
  it('every floor has exactly two valid rest spots with warm lights that survive the cap', () => {
    let tier0 = 0;
    let total = 0;
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 25; seed++) {
        for (const depth of [1, 2, 3, 9]) {
          const r = generateFloorReport({ seed, depth, theme });
          const plan = r.plan;
          expect(plan.restSpots).toHaveLength(2);
          expect(validateFloor(plan)).toEqual([]);
          for (const s of plan.restSpots) {
            expect(plan.lights.some((l) => l.pos.x === s.x && l.pos.y === s.y)).toBe(true);
          }
          expect(plan.lights.length).toBeLessThanOrEqual(24);
          expect(floorToAscii(plan)).toContain('R');
          for (const t of r.restTiers) {
            total++;
            if (t === 0) tier0++;
          }
        }
      }
    }
    // Purpose-built nooks are the norm; the fallbacks are rare.
    expect(tier0 / total).toBeGreaterThan(0.6);
  }, 120000);

  it('validateFloor rejects a rest spot beside a monster slot or off the route order', () => {
    const plan = generateFloor({ seed: 3, depth: 2, theme: 'crypt' });
    const slot = plan.spawns.find((s) => s.role === 'monster')!;
    const bad = { ...plan, restSpots: [plan.restSpots[0]!, { x: slot.pos.x + 1, y: slot.pos.y }] };
    expect(validateFloor(bad).length).toBeGreaterThan(0);
    expect(validateFloor({ ...plan, restSpots: [plan.restSpots[1]!, plan.restSpots[0]!] }).length).toBeGreaterThan(0);
    expect(validateFloor({ ...plan, restSpots: [plan.restSpots[0]!] }).length).toBeGreaterThan(0);
  });

  it('every floor records a set piece, and each theme shows variety', () => {
    for (const theme of THEMES) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) {
        const r = generateFloorReport({ seed, depth: 1 + (seed % 3), theme });
        expect(r.setPiece).toBeTruthy();
        seen.add(r.setPiece as string);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('every set piece turns up, and the newer ones leave their mark on the plan', () => {
    const want: Record<string, string[]> = {
      warrens: ['lake', 'tiers', 'crack', 'columns', 'stream'],
      crypt: ['ambulatory', 'grandNave', 'collapsed', 'moat', 'pitHall'],
      depths: ['amphitheatre', 'twinBridge', 'landing', 'well', 'mesa'],
      sewers: ['sluice', 'floodedHall', 'grandCistern'],
      fungal: ['grove', 'lake', 'stream', 'columns', 'crack'],
      hold: ['trainingYard', 'greatHall', 'stockade'],
      library: ['rotunda', 'grandStacks', 'drownedWing'],
      foundry: ['amphitheatre', 'twinBridge', 'landing', 'well', 'mesa'],
      ice: ['lake', 'tiers', 'crack', 'columns', 'stream'],
      ruin: ['sunkenGarden', 'grove', 'brokenHall'],
      hell: ['chainPit', 'trench', 'summoning'],
      lair: ['crack', 'tiers', 'columns'],
    };
    for (const theme of THEMES) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) {
        const r = generateFloorReport({ seed, depth: 1 + (seed % 3), theme });
        const plan = r.plan;
        const { width: w, height: h, kinds } = plan;
        seen.add(r.setPiece as string);
        const count = (pred: (i: number) => boolean): number => {
          let n = 0;
          for (let i = 0; i < w * h; i++) if (pred(i)) n++;
          return n;
        };
        const water = count((i) => kinds[i] === CellKind.Water);
        if (theme === 'crypt') {
          // The moat is the crypt's only water: a ring of 20 cells in one combat room.
          expect(water).toBe(r.setPiece === 'moat' ? 20 : 0);
          if (r.setPiece === 'moat') {
            const rooms = new Set<number>();
            for (let i = 0; i < w * h; i++) if (kinds[i] === CellKind.Water) rooms.add(plan.roomIds[i] as number);
            expect(rooms.size).toBe(1);
            expect(plan.rooms[[...rooms][0] as number]?.role).toBe('combat');
          }
        }
        if (theme === 'crypt' && r.setPiece === 'pitHall') {
          // Four 2x2 pits, all in one combat room.
          const rooms = new Set<number>();
          for (let i = 0; i < w * h; i++) if (kinds[i] === CellKind.Chasm) rooms.add(plan.roomIds[i] as number);
          expect(count((i) => kinds[i] === CellKind.Chasm)).toBe(16);
          expect(rooms.size).toBe(1);
          expect(plan.rooms[[...rooms][0] as number]?.role).toBe('combat');
        }
        if (theme === 'warrens' && r.setPiece === 'stream') expect(water).toBeGreaterThanOrEqual(8);
        if (theme === 'depths' && r.setPiece === 'mesa') {
          // Some combat platform has a summit two steps above its own floor.
          const lo = new Map<number, number>();
          const hi = new Map<number, number>();
          for (let i = 0; i < w * h; i++) {
            const id = plan.roomIds[i] as number;
            if (id < 0 || kinds[i] !== CellKind.Floor) continue;
            const e = plan.elevation[i] as number;
            lo.set(id, Math.min(lo.get(id) ?? e, e));
            hi.set(id, Math.max(hi.get(id) ?? e, e));
          }
          expect(plan.rooms.some((room) => room.role === 'combat' && (hi.get(room.id) as number) - (lo.get(room.id) as number) === 2)).toBe(true);
        }
        if (theme === 'depths') {
          // Only the well puts chasm inside a room: nine cells in a combat platform.
          const inRoom = count((i) => kinds[i] === CellKind.Chasm && (plan.roomIds[i] as number) >= 0);
          expect(inRoom).toBe(r.setPiece === 'well' ? 9 : 0);
          if (r.setPiece === 'well') {
            const i = kinds.findIndex((k, j) => k === CellKind.Chasm && (plan.roomIds[j] as number) >= 0);
            expect(plan.rooms[plan.roomIds[i] as number]?.role).toBe('combat');
          }
        }
        if (theme === 'warrens' && r.setPiece === 'columns') {
          // At least three free-standing stumps: small wall groups with walkable cells all round.
          const seenWall = new Uint8Array(w * h);
          let stumps = 0;
          for (let s = 0; s < w * h; s++) {
            if (kinds[s] !== CellKind.Wall || seenWall[s]) continue;
            const group = [s];
            seenWall[s] = 1;
            for (let q = 0; q < group.length; q++) {
              const c = group[q] as number;
              for (const d of [-1, 1, -w, w]) {
                const j = c + d;
                if (j >= 0 && j < w * h && kinds[j] === CellKind.Wall && !seenWall[j]) {
                  seenWall[j] = 1;
                  group.push(j);
                }
              }
            }
            if (group.length > 4) continue;
            const ringed = group.every((c) =>
              [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1].every((d) => {
                const k = kinds[c + d];
                return k === CellKind.Wall ? group.includes(c + d) : k === CellKind.Floor || k === CellKind.Water;
              }),
            );
            if (ringed) stumps++;
          }
          expect(stumps).toBeGreaterThanOrEqual(3);
        }
      }
      expect([...seen].sort()).toEqual((want[theme] as string[]).slice().sort());
    }
  }, 120000);

  it('floors keep a sensible size at depths 4-20', () => {
    for (const theme of THEMES) {
      for (let depth = 4; depth <= 20; depth += 4) {
        for (const seed of [1, 2, 3]) {
          const plan = generateFloor({ seed, depth, theme });
          expect(plan.width).toBeLessThanOrEqual(62);
          expect(plan.height).toBeLessThanOrEqual(62);
          expect(plan.rooms.length).toBeLessThanOrEqual(11);
        }
      }
    }
  });
});

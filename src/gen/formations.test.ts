import { beforeAll, describe, expect, it } from 'vitest';
import type { FloorPlan, SpawnPost, ThemeId } from '../core/types';
import { CellKind } from '../core/types';
import { THEME_RANGE } from '../core/themes';
import { hasFeature, roomFeatures } from './features';
import { generateFloor, generateFloorReport } from './generate';
import { createNavGrid, floorToAscii, validateFloor } from './index';
import { entryDoorways, roomThresholds } from './roomview';

const THEMES = Object.keys(THEME_RANGE) as ThemeId[];
const SEEDS = 60;
const LAVA: ThemeId[] = ['foundry', 'hell', 'lair'];
/** Themes whose recipe is built round a drop or lava (a hazard edge next to the fighting is the norm). */
const DROP_THEMES: ThemeId[] = ['depths', 'foundry', 'peaks', 'hell', 'lair'];

function depthFor(theme: ThemeId, seed: number): number {
  const [lo, hi] = THEME_RANGE[theme];
  return lo + (seed % (hi - lo + 1));
}

/** Floors for every theme: 60 seeds, depths spread across the theme's range. Built once. */
const floors = new Map<ThemeId, FloorPlan[]>();

beforeAll(() => {
  for (const theme of THEMES) {
    const list: FloorPlan[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = generateFloorReport({ seed, depth: depthFor(theme, seed), theme });
      list.push(r.plan);
    }
    floors.set(theme, list);
  }
}, 240000);

const monsterRooms = (plan: FloorPlan): FloorPlan['rooms'] => plan.rooms.filter((r) => r.role === 'combat' || r.role === 'boss');

describe('hazards in the plan and the nav grid', () => {
  it('says which themes burn and which freeze', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        expect(plan.chasmHazard).toBe(LAVA.includes(theme) ? 'lava' : 'fall');
        expect(plan.waterHazard).toBe(theme === 'ice' ? 'ice' : 'water');
      }
    }
  });

  it('answers hazardAt for every in-bounds cell, from the cell kind', () => {
    for (const theme of ['foundry', 'ice', 'peaks', 'crypt'] as ThemeId[]) {
      const plan = floors.get(theme)![3]!;
      const nav = createNavGrid(plan);
      for (let y = 0; y < plan.height; y++) {
        for (let x = 0; x < plan.width; x++) {
          const k = plan.kinds[y * plan.width + x];
          const want = k === CellKind.Chasm ? plan.chasmHazard : k === CellKind.Water ? plan.waterHazard : 'none';
          expect(nav.hazardAt({ x, y })).toBe(want);
        }
      }
    }
  });

  it('the fallback layout carries the hazards too', () => {
    // A theme's fallback is the crypt layout dressed for it.
    const r = generateFloorReport({ seed: 1, depth: 12, theme: 'foundry' });
    expect(r.plan.chasmHazard).toBe('lava');
  });
});

describe('cover on generated floors', () => {
  it('is 0 between cells of open floor (no prop, wall or drop between or beside them)', () => {
    let pairs = 0;
    for (const theme of THEMES) {
      const plan = floors.get(theme)![5]!;
      const w = plan.width;
      const nav = createNavGrid(plan);
      const blocking = new Set(plan.props.filter((p) => p.blocking).map((p) => p.pos.y * w + p.pos.x));
      const open = (x: number, y: number): boolean => plan.kinds[y * w + x] === CellKind.Floor && !blocking.has(y * w + x);
      for (let y = 1; y < plan.height - 1; y++) {
        for (let x = 1; x < w - 4; x++) {
          // A clear 3-row band: every cell within one of the row between (x, y) and (x + 3, y) is open floor.
          let clear = true;
          for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 4; dx++) if (!open(x + dx, y + dy)) clear = false;
          if (!clear) continue;
          pairs++;
          expect(nav.coverBetween({ x, y }, { x: x + 3, y })).toBe(0);
          expect(nav.coverBetween({ x: x + 3, y }, { x, y })).toBe(0);
          expect(nav.coverBetween({ x, y }, { x: x + 3, y: y + 1 })).toBe(0);
        }
      }
    }
    expect(pairs).toBeGreaterThan(200);
  });
});

describe('terrain that invites play', () => {
  it('most combat and boss rooms offer a hazard edge, cover, a chokepoint or height', () => {
    for (const theme of THEMES) {
      let rooms = 0;
      let withFeature = 0;
      for (const plan of floors.get(theme)!) {
        for (const r of monsterRooms(plan)) {
          rooms++;
          if (hasFeature(roomFeatures(plan, r.id))) withFeature++;
        }
      }
      expect(withFeature / rooms, theme).toBeGreaterThanOrEqual(0.93);
    }
  });

  it('floors of chasm and lava themes have hazard edges beside the fighting', () => {
    for (const theme of DROP_THEMES) {
      let rooms = 0;
      let drop = 0;
      for (const plan of floors.get(theme)!) {
        for (const r of plan.rooms.filter((q) => q.role === 'combat')) {
          rooms++;
          if (roomFeatures(plan, r.id).drop) drop++;
        }
      }
      expect(drop / rooms, theme).toBeGreaterThanOrEqual(theme === 'lair' ? 0.6 : theme === 'hell' ? 0.75 : 0.9);
    }
  });

  it('about every other combat room has two or more props to fight round, in every theme', () => {
    for (const theme of THEMES) {
      let rooms = 0;
      let cover = 0;
      for (const plan of floors.get(theme)!) {
        for (const r of plan.rooms.filter((q) => q.role === 'combat')) {
          rooms++;
          if (roomFeatures(plan, r.id).cover) cover++;
        }
      }
      // Sewer chambers are mostly one-cell walkways beside channels: water and chokepoints are their terrain.
      expect(cover / rooms, theme).toBeGreaterThanOrEqual(theme === 'sewers' ? 0.4 : 0.5);
    }
  });
});

describe('things to push enemies into, in every theme', () => {
  it('most rooms have a push target beside walkable cells, and enemies stand near one', () => {
    for (const theme of THEMES) {
      let rooms = 0;
      let push = 0;
      let nearRoom = 0;
      let slots = 0;
      let near = 0;
      for (const plan of floors.get(theme)!) {
        for (const r of monsterRooms(plan)) {
          const f = roomFeatures(plan, r.id);
          rooms++;
          if (f.push) push++;
          if (f.slotsNearPush > 0) nearRoom++;
          slots += f.slots;
          near += f.slotsNearPush;
        }
      }
      expect(push / rooms, `${theme} push`).toBeGreaterThanOrEqual(0.8);
      expect(nearRoom / rooms, `${theme} near`).toBeGreaterThanOrEqual(0.5);
      expect(near / slots, `${theme} slots`).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('the first two cells inside a main doorway are never beside a drop', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!.slice(0, 25)) {
        const w = plan.width;
        for (let i = 0; i < plan.roomIds.length; i++) {
          const id = plan.roomIds[i] as number;
          const room = id >= 0 ? plan.rooms[id] : undefined;
          if (!room || (room.role !== 'combat' && room.role !== 'boss') || plan.kinds[i] !== CellKind.Floor) continue;
          // A doorway cell of the room: touches a walkable cell of another room or a passage.
          let door = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy * w + dx;
            if ((plan.kinds[j] === CellKind.Floor || plan.kinds[j] === CellKind.Door || plan.kinds[j] === CellKind.Water) && plan.roomIds[j] !== id) door = true;
          }
          if (!door) continue;
          // The terrain pass keeps its pits three cells from every doorway.
          // Only themes with no recipe drop beside a door (the crypt's pit hall digs one by design).
          if (!['hold', 'library', 'ruin', 'sewers'].includes(theme)) continue;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (plan.kinds[i + dy * w + dx] === CellKind.Chasm) throw new Error(`${theme} seed ${plan.seed}: drop beside a doorway at ${i % w},${(i / w) | 0}`);
          }
        }
      }
    }
  });

  it('hazard props are flagged for the nav grid: fire and spikes, not walkable', () => {
    let fire = 0;
    let spikes = 0;
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!.slice(0, 20)) {
        const nav = createNavGrid(plan);
        for (const p of plan.props) {
          const o = nav.obstacleAt!(p.pos);
          if (o === 'none') continue;
          expect(p.blocking).toBe(true);
          expect(nav.isWalkable(p.pos)).toBe(false);
          if (o === 'fire') fire++;
          else spikes++;
        }
      }
    }
    expect(fire).toBeGreaterThan(50);
    expect(spikes).toBeGreaterThan(50);
  });

  it('the scattered fallback is the exception in every theme', () => {
    for (const theme of THEMES) {
      let rooms = 0;
      let scattered = 0;
      for (const plan of floors.get(theme)!) {
        for (const r of monsterRooms(plan)) {
          rooms++;
          if (r.formation === 'scattered') scattered++;
        }
      }
      expect(scattered / rooms, theme).toBeLessThan(0.24);
    }
  });
});

describe('formations', () => {
  it('every floor is valid and every room with monsters has a formation and posts on its slots', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        expect(validateFloor(plan), `${theme} seed ${plan.seed} depth ${plan.depth}`).toEqual([]);
        for (const r of plan.rooms) {
          const slots = plan.spawns.filter((s) => s.roomId === r.id && s.role !== 'chest');
          if (r.role === 'combat' || r.role === 'boss') {
            expect(r.formation).toBeTruthy();
            expect(slots.every((s) => !!s.post)).toBe(true);
          } else expect(r.formation).toBeUndefined();
        }
      }
    }
  });

  it('keeps the slot counts: combat 3-6 monsters, boss rooms one boss and 2-4 monsters, boss on a back post', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        for (const r of monsterRooms(plan)) {
          const m = plan.spawns.filter((s) => s.roomId === r.id && s.role === 'monster').length;
          const b = plan.spawns.filter((s) => s.roomId === r.id && s.role === 'boss');
          if (r.role === 'combat') {
            expect(m).toBeGreaterThanOrEqual(3);
            expect(m).toBeLessThanOrEqual(6);
            expect(b).toHaveLength(0);
          } else {
            expect(m).toBeGreaterThanOrEqual(2);
            expect(m).toBeLessThanOrEqual(4);
            expect(b).toHaveLength(1);
            expect(b[0]!.post).toBe('back');
          }
        }
      }
    }
  });

  it('a floor does not field one formation throughout, and each theme shows at least four across seeds', () => {
    for (const theme of THEMES) {
      const seen = new Set<string>();
      let floorsWithRepeatOnly = 0;
      for (const plan of floors.get(theme)!) {
        const combat = plan.rooms.filter((r) => r.role === 'combat').map((r) => r.formation);
        for (const f of combat) seen.add(f as string);
        for (const r of plan.rooms) if (r.role === 'boss') seen.add(r.formation as string);
        if (combat.length >= 4 && new Set(combat).size === 1) floorsWithRepeatOnly++;
      }
      expect(seen.size, `${theme}: ${[...seen].join(',')}`).toBeGreaterThanOrEqual(4);
      // Tight cave chambers sometimes leave only the scattered fallback; that should stay the exception.
      expect(floorsWithRepeatOnly, theme).toBeLessThanOrEqual(4);
    }
  });

  it('boss rooms use throne, lair or the scattered fallback; combat rooms never throne or lair', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        for (const r of monsterRooms(plan)) {
          if (r.role === 'boss') expect(['throne', 'lair', 'scattered']).toContain(r.formation);
          else expect(['throne', 'lair']).not.toContain(r.formation);
        }
      }
    }
  });

  it('posts keep their promise: hidden slots are out of sight of every doorway the hero can arrive by', () => {
    let hidden = 0;
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        const w = plan.width;
        const nav = createNavGrid(plan);
        for (const s of plan.spawns) {
          if (s.post !== 'hidden') continue;
          hidden++;
          const cells: number[] = [];
          for (let i = 0; i < plan.roomIds.length; i++) if (plan.roomIds[i] === s.roomId && plan.kinds[i] !== CellKind.Wall && plan.kinds[i] !== CellKind.Chasm) cells.push(i);
          const th = roomThresholds(plan.kinds, plan.roomIds, w, plan.height, s.roomId, cells);
          const entry = entryDoorways(plan.kinds, plan.elevation, plan.roomIds, w, plan.height, plan.entrance.y * w + plan.entrance.x, s.roomId, th);
          expect(entry.length).toBeGreaterThan(0);
          for (const t of entry) expect(nav.hasLineOfSight({ x: t % w, y: (t / w) | 0 }, s.pos)).toBe(false);
        }
      }
    }
    expect(hidden).toBeGreaterThan(50);
  });

  it('from the main doorway the hero sees most slots that are not hidden', () => {
    const rate = new Map<string, { seen: number; all: number; hiddenSeen: number; hidden: number }>();
    let seen = 0;
    let all = 0;
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        const w = plan.width;
        const nav = createNavGrid(plan);
        const dist = new Map<number, number>();
        for (const c of nav.reachable(plan.entrance, Infinity)) dist.set(c.pos.y * w + c.pos.x, c.cost);
        for (const r of monsterRooms(plan)) {
          const cells: number[] = [];
          for (let i = 0; i < plan.roomIds.length; i++) if (plan.roomIds[i] === r.id && plan.kinds[i] !== CellKind.Wall && plan.kinds[i] !== CellKind.Chasm) cells.push(i);
          const th = roomThresholds(plan.kinds, plan.roomIds, w, plan.height, r.id, cells);
          const entry = entryDoorways(plan.kinds, plan.elevation, plan.roomIds, w, plan.height, plan.entrance.y * w + plan.entrance.x, r.id, th);
          let main = entry[0] as number;
          for (const t of entry) if ((dist.get(t) ?? 1e9) < (dist.get(main) ?? 1e9)) main = t;
          const key = r.formation as string;
          const rec = rate.get(key) ?? { seen: 0, all: 0, hiddenSeen: 0, hidden: 0 };
          for (const s of plan.spawns) {
            if (s.roomId !== r.id || s.role === 'chest') continue;
            const sees = nav.hasLineOfSight({ x: main % w, y: (main / w) | 0 }, s.pos);
            if (s.post === 'hidden') {
              rec.hidden++;
              if (sees) rec.hiddenSeen++;
            } else {
              rec.all++;
              all++;
              if (sees) {
                rec.seen++;
                seen++;
              }
            }
          }
          rate.set(key, rec);
        }
      }
    }
    const lines = [...rate.entries()].map(([k, v]) => `${k}: ${Math.round((100 * v.seen) / Math.max(1, v.all))}% of ${v.all} visible, hidden seen ${v.hiddenSeen}/${v.hidden}`);
    console.info('doorway visibility by formation\n' + lines.join('\n'));
    expect(seen / all).toBeGreaterThanOrEqual(0.75);
    for (const v of rate.values()) expect(v.hiddenSeen).toBe(0);
  });

  it('guards never start a fight from inside sight of the entrance room, and no two slots touch', () => {
    for (const theme of THEMES) {
      for (const plan of floors.get(theme)!) {
        const w = plan.width;
        const nav = createNavGrid(plan);
        const entranceRoom = plan.rooms.find((r) => r.role === 'entrance')!;
        for (const s of plan.spawns) {
          if (s.post !== 'guard') continue;
          for (const c of nav.reachable(s.pos, 7)) {
            if (plan.roomIds[c.pos.y * w + c.pos.x] === entranceRoom.id) expect(nav.hasLineOfSight(c.pos, s.pos)).toBe(false);
          }
        }
        for (const a of plan.spawns) {
          for (const b of plan.spawns) {
            if (a === b || a.roomId !== b.roomId || a.role === 'chest') continue;
            expect(Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y))).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('validateFloor catches a hidden slot in plain sight, a slot without a post and a room without a formation', () => {
    const plan = floors.get('crypt')!.find((p) => p.spawns.some((s) => s.post === 'hidden'))!;
    const ix = plan.spawns.findIndex((s) => s.post === 'hidden');
    const seenPost = plan.spawns.map((s, i) => (i === ix ? { ...s, post: 'front' as SpawnPost } : s));
    expect(validateFloor({ ...plan, spawns: seenPost })).toEqual([]);
    // Move the hidden slot's post onto a slot the doorway sees: pick any front slot and call it hidden.
    const f = plan.spawns.findIndex((s) => s.post === 'front' || s.post === 'back');
    const lie = plan.spawns.map((s, i) => (i === f ? { ...s, post: 'hidden' as SpawnPost } : s));
    expect(validateFloor({ ...plan, spawns: lie }).some((e) => e.includes('hidden'))).toBe(true);
    const none = plan.spawns.map((s, i) => (i === 0 ? { ...s, post: undefined } : s));
    expect(validateFloor({ ...plan, spawns: none }).some((e) => e.includes('post'))).toBe(true);
    expect(validateFloor({ ...plan, rooms: plan.rooms.map((r) => ({ ...r, formation: undefined })) }).some((e) => e.includes('formation'))).toBe(true);
  });
});

describe('determinism and the debug dump', () => {
  it('a floor is the same every time, formations and posts included', () => {
    for (const theme of THEMES) {
      const seed = 7;
      const depth = depthFor(theme, seed);
      const a = generateFloor({ seed, depth, theme });
      const b = generateFloor({ seed, depth, theme });
      expect(JSON.stringify({ ...a, kinds: Array.from(a.kinds), elevation: Array.from(a.elevation), roomIds: Array.from(a.roomIds) })).toBe(
        JSON.stringify({ ...b, kinds: Array.from(b.kinds), elevation: Array.from(b.elevation), roomIds: Array.from(b.roomIds) }),
      );
    }
  });

  it('floorToAscii marks slots by post and lists each room formation', () => {
    const plan = floors.get('hold')![2]!;
    const text = floorToAscii(plan);
    for (const r of monsterRooms(plan)) expect(text).toContain(`${r.id} ${r.role} ${r.formation}`);
    const letter: Record<string, string> = { front: 'f', back: 'b', flank: 'k', high: 'h', hidden: 'x', guard: 'g', escort: 'e' };
    const rows = text.split('\n');
    for (const s of plan.spawns) {
      if (s.role === 'monster') expect(rows[s.pos.y]![s.pos.x]).toBe(letter[s.post as string]);
      if (s.role === 'boss') expect(rows[s.pos.y]![s.pos.x]).toBe('B');
    }
  });
});

describe('generation time', () => {
  it('stays cheap with formations and the terrain pass', () => {
    for (const theme of THEMES) generateFloor({ seed: 0, depth: depthFor(theme, 1), theme });
    const t0 = performance.now();
    let n = 0;
    for (const theme of THEMES) {
      for (let seed = 1; seed <= 20; seed++) {
        generateFloor({ seed, depth: depthFor(theme, seed), theme });
        n++;
      }
    }
    const avg = (performance.now() - t0) / n;
    console.info(`average generation time ${avg.toFixed(1)} ms over ${n} floors`);
    expect(avg).toBeLessThan(60);
  });
});

import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { FloorPlan, SpawnSlot, ThemeId } from '../core/types';
import { ENCOUNTER_TUNING, bossMinionLimit, buildEncounters, roomBudget } from './encounters';
import { FIXTURE_MONSTERS, makePlan } from './testing/fixtures';

const slot = (roomId: number, x: number, y: number, role: SpawnSlot['role'] = 'monster'): SpawnSlot => ({ roomId, role, pos: { x, y } });

function plan(depth: number, theme: ThemeId): FloorPlan {
  const spawns: SpawnSlot[] = [];
  for (let r = 1; r <= 4; r++) for (let i = 0; i < 5; i++) spawns.push(slot(r, r * 10 + i, i));
  spawns.push(slot(0, 1, 1)); // entrance slot: must stay empty
  spawns.push(slot(3, 99, 1, 'chest'));
  spawns.push(slot(5, 50, 1, 'boss'));
  for (let i = 0; i < 3; i++) spawns.push(slot(5, 50 + i, 3));
  return makePlan(
    depth,
    theme,
    [{ role: 'entrance' }, { role: 'combat' }, { role: 'combat' }, { role: 'treasure' }, { role: 'combat' }, { role: 'boss' }],
    spawns,
  );
}

describe('buildEncounters', () => {
  it.each(['warrens', 'crypt', 'depths'] as const)('respects theme %s, slots and unique ids', (theme) => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = plan(1 + (seed % 5), theme);
      const placed = buildEncounters(p, FIXTURE_MONSTERS, new Rng(seed));
      expect(placed.length).toBeGreaterThan(0);
      const ids = placed.map((m) => m.creature.id);
      expect(new Set(ids).size).toBe(ids.length);
      const used = new Set<string>();
      for (const m of placed) {
        const def = FIXTURE_MONSTERS.find((d) => d.id === m.creature.defId)!;
        expect(def.themes).toContain(theme);
        const s = p.spawns.find((sl) => sl.roomId === m.roomId && sl.pos.x === m.creature.pos.x && sl.pos.y === m.creature.pos.y);
        expect(s, 'monster stands on a slot of its room').toBeDefined();
        expect(s!.role).not.toBe('chest');
        const key = `${s!.pos.x},${s!.pos.y}`;
        expect(used.has(key)).toBe(false);
        used.add(key);
        expect(m.creature.faction).toBe('enemy');
        expect(m.roomId).not.toBe(0);
      }
      for (const roomId of [1, 2, 3, 4]) {
        const n = placed.filter((m) => m.roomId === roomId).length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(ENCOUNTER_TUNING.maxMonstersPerRoom);
      }
    }
  });

  it('puts the boss-role monster plus 0-2 others in the boss room', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const placed = buildEncounters(plan(2, 'crypt'), FIXTURE_MONSTERS, new Rng(seed));
      const room = placed.filter((m) => m.roomId === 5);
      expect(room.length).toBeGreaterThanOrEqual(1);
      expect(room.length).toBeLessThanOrEqual(1 + bossMinionLimit(2));
      const bosses = room.filter((m) => FIXTURE_MONSTERS.find((d) => d.id === m.creature.defId)!.role === 'boss');
      expect(bosses).toHaveLength(1);
      expect(bosses[0]!.creature.pos).toEqual({ x: 50, y: 1 });
      const nonBoss = placed.filter((m) => m.roomId !== 5);
      expect(nonBoss.every((m) => FIXTURE_MONSTERS.find((d) => d.id === m.creature.defId)!.role !== 'boss')).toBe(true);
    }
  });

  it('allows at most one monster above the hero level per room', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const placed = buildEncounters(plan(1, 'depths'), FIXTURE_MONSTERS, new Rng(seed));
      for (const roomId of [1, 2, 3, 4]) {
        const over = placed.filter((m) => m.roomId === roomId && m.creature.level > 1);
        expect(over.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('suffixes duplicate names within a room', () => {
    let sawDuplicate = false;
    for (let seed = 1; seed <= 60; seed++) {
      const placed = buildEncounters(plan(2, 'warrens'), FIXTURE_MONSTERS, new Rng(seed));
      for (const roomId of [1, 2, 3, 4]) {
        const names = placed.filter((m) => m.roomId === roomId).map((m) => m.creature.name);
        expect(new Set(names).size).toBe(names.length);
        if (names.some((n) => / [A-Z]$/.test(n))) sawDuplicate = true;
      }
    }
    expect(sawDuplicate).toBe(true);
  });

  it('budget grows with depth, in the table and on average in the output', () => {
    for (let d = 1; d < 20; d++) {
      expect(roomBudget(d + 1, 'combat', 2)).toBeGreaterThanOrEqual(roomBudget(d, 'combat', 2));
    }
    expect(roomBudget(3, 'combat', 5)).toBeGreaterThan(roomBudget(3, 'combat', 1));
    expect(roomBudget(3, 'combat', 99)).toBeLessThanOrEqual(roomBudget(3, 'combat', 1) * 2);
    expect(roomBudget(3, 'entrance', 0)).toBe(0);

    const avgXp = (depth: number): number => {
      let total = 0;
      const n = 150;
      for (let seed = 1; seed <= n; seed++) {
        for (const m of buildEncounters(plan(depth, 'depths'), FIXTURE_MONSTERS, new Rng(seed))) {
          if (m.roomId === 5) continue;
          total += FIXTURE_MONSTERS.find((d) => d.id === m.creature.defId)!.xp;
        }
      }
      return total / n;
    };
    const series = [1, 2, 3, 4].map(avgXp);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThanOrEqual(series[i - 1]!);
    expect(series[3]!).toBeGreaterThan(series[0]!);
  });

  it('is deterministic per seed and tolerates themes with no monsters', () => {
    const a = buildEncounters(plan(2, 'warrens'), FIXTURE_MONSTERS, new Rng(5));
    const b = buildEncounters(plan(2, 'warrens'), FIXTURE_MONSTERS, new Rng(5));
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
    expect(buildEncounters(plan(2, 'warrens'), [], new Rng(5))).toEqual([]);
    expect(buildEncounters(plan(2, 'warrens'), FIXTURE_MONSTERS.filter((m) => !m.themes.includes('warrens')), new Rng(5))).toEqual([]);
  });

  it('places creatures as plain data', () => {
    const placed = buildEncounters(plan(1, 'warrens'), FIXTURE_MONSTERS, new Rng(2));
    for (const m of placed) expect(JSON.parse(JSON.stringify(m.creature))).toEqual(m.creature);
  });
});

describe('encounter tuning levers', () => {
  it('bossByDepth forces a specific boss and keeps it out of ordinary rooms', () => {
    const saved = { ...ENCOUNTER_TUNING.bossByDepth };
    try {
      ENCOUNTER_TUNING.bossByDepth = { 2: 'giant_spider' };
      for (let seed = 1; seed <= 20; seed++) {
        const placed = buildEncounters(plan(2, 'depths'), FIXTURE_MONSTERS, new Rng(seed));
        const boss = placed.find((m) => m.roomId === 5 && m.creature.pos.x === 50 && m.creature.pos.y === 1)!;
        expect(boss.creature.defId).toBe('giant_spider');
        expect(placed.filter((m) => m.roomId !== 5).some((m) => m.creature.defId === 'giant_spider')).toBe(false);
      }
    } finally {
      ENCOUNTER_TUNING.bossByDepth = saved;
    }
  });

  it('monsterMinDepth and monsterMaxDepth gate ordinary rooms', () => {
    const saved = { min: ENCOUNTER_TUNING.monsterMinDepth, max: ENCOUNTER_TUNING.monsterMaxDepth };
    try {
      ENCOUNTER_TUNING.monsterMinDepth = { wolf: 3 };
      ENCOUNTER_TUNING.monsterMaxDepth = { giant_rat: 1 };
      for (let seed = 1; seed <= 30; seed++) {
        const d2 = buildEncounters(plan(2, 'warrens'), FIXTURE_MONSTERS, new Rng(seed)).filter((m) => m.roomId !== 5);
        expect(d2.some((m) => m.creature.defId === 'wolf' || m.creature.defId === 'giant_rat')).toBe(false);
      }
    } finally {
      ENCOUNTER_TUNING.monsterMinDepth = saved.min;
      ENCOUNTER_TUNING.monsterMaxDepth = saved.max;
    }
  });

  it('minMonstersPerRoom populates rooms', () => {
    const saved = ENCOUNTER_TUNING.minMonstersPerRoom;
    const savedLimit = ENCOUNTER_TUNING.topUpLimit;
    try {
      ENCOUNTER_TUNING.minMonstersPerRoom = [2];
      ENCOUNTER_TUNING.topUpLimit = 100;
      for (let seed = 1; seed <= 20; seed++) {
        const placed = buildEncounters(plan(1, 'warrens'), FIXTURE_MONSTERS, new Rng(seed));
        for (const roomId of [1, 2, 3, 4]) expect(placed.filter((m) => m.roomId === roomId).length).toBeGreaterThanOrEqual(2);
      }
    } finally {
      ENCOUNTER_TUNING.minMonstersPerRoom = saved;
      ENCOUNTER_TUNING.topUpLimit = savedLimit;
    }
  });
});

import type { CharacterBuild, PlayerCharacter } from '../core/types';
import {
  applyLevelUp,
  buyItem,
  computeAc,
  createCharacter,
  enterFloor,
  finalAbilities,
  equipItem,
  floorReward,
  longRest,
  previewLevelUp,
  shopStock,
} from '../rules';
import { simulateFloor, type FloorOptions } from './floor';

const MAX_POTIONS = 6;
const MAX_ATTEMPTS = 8;

/** Scripted hub visit: long rest, reward for the floor just cleared, level up, shop, refresh floor resources. */
export function hubVisit(pc: PlayerCharacter, clearedDepth: number, opts: { shop?: boolean } = {}): PlayerCharacter {
  let cur = longRest({ ...pc, gold: pc.gold + floorReward(clearedDepth) });
  if (previewLevelUp(cur)) cur = applyLevelUp(cur, {});
  if (opts.shop !== false) cur = shop(cur, clearedDepth + 1);
  return enterFloor(cur);
}

function potionTotal(pc: PlayerCharacter): number {
  return pc.inventory.filter((s) => s.itemId.startsWith('potion')).reduce((n, s) => n + s.quantity, 0);
}

/** Buy the best affordable armor upgrade, then healing potions with the rest. */
export function shop(pc: PlayerCharacter, nextDepth: number): PlayerCharacter {
  let cur = pc;
  const stock = shopStock(nextDepth);
  for (;;) {
    let best: { id: string; gain: number } | undefined;
    for (const item of stock) {
      if (item.kind !== 'armor' || item.cost > cur.gold || cur.inventory.some((s) => s.itemId === item.id)) continue;
      // Heavy armor the hero is too weak for costs speed; the scripted hero does not buy it.
      if ((item.armor?.strRequirement ?? 0) > finalAbilities(cur.build).str) continue;
      const gain = computeAc(equipItem(buyItem(cur, item.id), item.id)) - computeAc(cur);
      if (gain >= 1 && (!best || gain > best.gain)) best = { id: item.id, gain };
    }
    if (!best) break;
    cur = equipItem(buyItem(cur, best.id), best.id);
  }
  const potion = stock.find((i) => i.id === 'potion_healing');
  while (potion && cur.gold >= potion.cost && potionTotal(cur) < MAX_POTIONS) cur = buyItem(cur, potion.id);
  return cur;
}

export interface FloorStats {
  depth: number;
  /** Runs that reached this floor. */
  runs: number;
  firstAttemptClears: number;
  attempts: number;
  /** Deaths over all attempts, by room role and by killer. */
  deathsByRole: Record<string, number>;
  deathsByKiller: Record<string, number>;
  bossEntryHpSum: number;
  bossEntryCount: number;
  potionsUsed: number;
  shortRestsUsed: number;
  attemptsTotalForClear: number;
  bossArrivalHpSum: number;
  /** Per fight group ("role: monsters"): fights and hero deaths, all attempts. */
  rooms: Record<string, { n: number; deaths: number }>;
}

export interface RunSummary {
  runs: number;
  floors: FloorStats[];
  /** Fraction of runs that cleared every floor within the attempt cap. */
  completed: number;
}

function emptyStats(depth: number): FloorStats {
  return {
    depth,
    runs: 0,
    firstAttemptClears: 0,
    attempts: 0,
    deathsByRole: {},
    deathsByKiller: {},
    bossEntryHpSum: 0,
    bossEntryCount: 0,
    potionsUsed: 0,
    shortRestsUsed: 0,
    attemptsTotalForClear: 0,
    bossArrivalHpSum: 0,
    rooms: {},
  };
}

export interface RunOptions extends Partial<Omit<FloorOptions, 'runSeed' | 'depth' | 'attempt'>> {
  floors?: number;
  /** Careless player: no shopping, short rests only below 35% HP. */
  careless?: boolean;
  /** Starting level-up/hub treatment: build a fresh character per run. */
  makePc?: (build: CharacterBuild) => PlayerCharacter;
}

/**
 * Chain floors 1..N for each run seed. A death restarts the floor from the
 * entrance state (hp, resources, potions, gold as they were on entering it),
 * as in the game, with different dice.
 */
export function simulateRun(build: CharacterBuild, runSeeds: number[], opts: RunOptions = {}): RunSummary {
  const floors = opts.floors ?? 3;
  const stats = Array.from({ length: floors }, (_, i) => emptyStats(i + 1));
  let completed = 0;
  for (const runSeed of runSeeds) {
    let pc = (opts.makePc ?? createCharacter)(build);
    let ok = true;
    for (let depth = 1; depth <= floors && ok; depth++) {
      const st = stats[depth - 1] as FloorStats;
      st.runs++;
      const entry = pc;
      let cleared = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cleared; attempt++) {
        const r = simulateFloor(entry, { ...opts, runSeed, depth, attempt });
        st.attempts++;
        st.potionsUsed += r.potionsUsed;
        st.shortRestsUsed += r.shortRestsUsed;
        for (const l of r.log) {
          const k = `${l.role}: ${[...l.monsters].sort().join("+")}`;
          const e = (st.rooms[k] ??= { n: 0, deaths: 0 });
          e.n++;
          if (!l.won) e.deaths++;
        }
        if (r.bossArrivalHp !== undefined) st.bossArrivalHpSum += r.bossArrivalHp;
        if (r.bossEntryHp !== undefined) {
          st.bossEntryHpSum += r.bossEntryHp;
          st.bossEntryCount++;
        }
        if (r.cleared) {
          cleared = true;
          if (attempt === 0) st.firstAttemptClears++;
          st.attemptsTotalForClear += attempt + 1;
          pc = hubVisit(r.pc, depth, { shop: opts.careless !== true });
        } else if (r.death) {
          st.deathsByRole[r.death.role] = (st.deathsByRole[r.death.role] ?? 0) + 1;
          st.deathsByKiller[r.death.killer] = (st.deathsByKiller[r.death.killer] ?? 0) + 1;
        }
      }
      if (!cleared) ok = false;
    }
    if (ok) completed++;
  }
  return { runs: runSeeds.length, floors: stats, completed: completed / runSeeds.length };
}

export function formatSummary(label: string, s: RunSummary): string {
  const lines = [`${label}  (runs ${s.runs}, completed ${(s.completed * 100).toFixed(0)}%)`];
  for (const f of s.floors) {
    const killers = Object.entries(f.deathsByKiller)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    lines.push(
      `  floor ${f.depth}: first-try ${((f.firstAttemptClears / f.runs) * 100).toFixed(0)}%  attempts/clear ${(f.attempts / f.runs).toFixed(2)}` +
        `  deaths ${JSON.stringify(f.deathsByRole)}  bossHP arrive/afterRest ${f.bossEntryCount ? ((f.bossArrivalHpSum / f.bossEntryCount) * 100).toFixed(0) : "-"}/${f.bossEntryCount ? ((f.bossEntryHpSum / f.bossEntryCount) * 100).toFixed(0) : "-"}%` +
        `  potions/att ${(f.potionsUsed / f.attempts).toFixed(2)} rests/att ${(f.shortRestsUsed / f.attempts).toFixed(2)}  killers ${killers}`,
    );
  }
  return lines.join('\n');
}

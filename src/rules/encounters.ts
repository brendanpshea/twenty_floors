import type { Rng } from '../core/rng';
import type { Creature, FloorPlan, MonsterDef, SpawnSlot } from '../core/types';
import { instantiateMonster } from './monster';

export interface PlacedMonster {
  creature: Creature;
  roomId: number;
}

export interface EncounterTuning {
  budgetByLevel: number[];
  soloFactor: number;
  roomRoleFactor: { entrance: number; combat: number; treasure: number; passage: number; boss: number };
  perDistance: number;
  distanceBase: number;
  distanceCap: number;
  overshoot: number;
  /** The first monster of a room may cost up to this multiple of the budget. */
  firstOvershoot: number;
  maxMonstersPerRoom: number;
  maxOverLevel: number;
  /** Boss room: at most this many extra monsters, by depth (index depth-1, last value repeats). */
  maxBossMinions: number[];
  /** Ordinary combat rooms get at least this many monsters when there are enough slots (by depth, last value repeats); a fraction is the chance of one more, e.g. 1.6 = 60% of rooms get two. */
  minMonstersPerRoom: number[];
  /** A group is not topped up to the minimum size once its XP already exceeds the budget by this factor (keeps one big monster alone). */
  topUpLimit: number;
  /** Chance that each possible boss escort actually appears, by depth (same indexing). */
  bossMinionChance: number[];
  roleWeight: { minion: number; standard: number; elite: number; boss: number };
  /** Extra selection weight multiplier per monster id (default 1). */
  monsterWeight: Record<string, number>;
  /**
   * The hero gains a level per floor, so a monster far below the floor's level is not a threat
   * worth a turn: ordinary monsters need a CR of at least floor(depth x this). 0.25 lets a
   * CR 1 monster appear up to floor 7 and a CR 2 monster up to floor 11. If no monster of the
   * theme is that strong, the rule is waived for the floor rather than leaving rooms empty.
   */
  minCrPerDepth: number;
  /** Monsters that only appear in ordinary rooms from this depth on (default: always). */
  monsterMinDepth: Record<string, number>;
  /** Monsters that stop appearing in ordinary rooms after this depth (default: never). */
  monsterMaxDepth: Record<string, number>;
  /** Explicit boss monster id for a depth (any monster of the theme); otherwise the theme's boss-role monster. */
  bossByDepth: Partial<Record<number, string>>;
}

/**
 * All encounter tuning lives here (mutable so the balance harness can try
 * variants). Tune with src/balance, not by feel.
 */
export const ENCOUNTER_TUNING: EncounterTuning = {
  /**
   * XP budget for one room at hero level N (index N-1). Floors 1-3 were tuned
   * with the whole-floor simulation in src/balance for a solo hero; from level
   * 4 the SRD 5.2 "Low" per-character budgets (250, 500, 600 ...) are scaled
   * by 0.65 until those floors are tuned the same way.
   */
  budgetByLevel: [36, 130, 140, 160, 325, 390, 490, 650, 845, 1040, 1235, 1430, 1690, 1885, 2145, 2470, 2925, 3250, 3575, 4160],
  /** Global multiplier on every budget. */
  soloFactor: 1,
  /** Budget multiplier by room role. 0 = never spawn. */
  roomRoleFactor: { entrance: 0, combat: 1, treasure: 0.75, passage: 0.5, boss: 0.6 },
  /** Budget grows by this much per room-graph step from the entrance... */
  perDistance: 0.08,
  /** ...starting from this base multiplier, capped at distanceCap. */
  distanceBase: 0.85,
  distanceCap: 1.3,
  /** A group may overshoot its budget by this fraction (the first monster may always be at most 1.5x). */
  overshoot: 1.1,
  firstOvershoot: 2.2,
  maxMonstersPerRoom: 4,
  /** At most this many monsters with CR above the hero's level per room. */
  maxOverLevel: 1,
  maxBossMinions: [1, 2, 2, 2],
  minMonstersPerRoom: [1.8, 2.1, 2.3],
  topUpLimit: 1.8,
  bossMinionChance: [0.25, 0.5, 0.2, 0.5],
  /** Selection weight by role. */
  roleWeight: { minion: 1, standard: 1, elite: 0.5, boss: 0 },
  minCrPerDepth: 0.25,
  // Each two-floor theme has a boss per floor and shifts its cast a little between the two
  // (docs/research/roster-options.md, minus the monsters minCrPerDepth rules out).
  monsterMinDepth: { giant_constrictor_snake: 5, priest: 9, hobgoblin_captain: 9 },
  monsterMaxDepth: { gibbering_mouther: 6, bandit_captain: 8 },
  bossByDepth: { 4: 'ochre_jelly', 5: 'green_hag', 6: 'chuul', 7: 'shambling_mound', 8: 'tough_boss', 9: 'gladiator' },
  monsterWeight: { giant_spider: 0.1, bugbear_warrior: 0.5, wolf: 0.4, goblin_warrior: 0.4, giant_rat: 0.5 },
};

export function minMonstersAt(depth: number): number {
  const t = ENCOUNTER_TUNING.minMonstersPerRoom;
  return t[Math.min(Math.max(depth, 1), t.length) - 1] as number;
}

export function bossMinionChanceAt(depth: number): number {
  const t = ENCOUNTER_TUNING.bossMinionChance;
  return t[Math.min(Math.max(depth, 1), t.length) - 1] as number;
}

export function bossMinionLimit(depth: number): number {
  const t = ENCOUNTER_TUNING.maxBossMinions;
  return t[Math.min(Math.max(depth, 1), t.length) - 1] as number;
}

export function roomBudget(depth: number, roomRole: keyof typeof ENCOUNTER_TUNING.roomRoleFactor, distanceFromEntrance: number): number {
  const t = ENCOUNTER_TUNING;
  const table = t.budgetByLevel;
  const base = table[Math.min(Math.max(depth, 1), table.length) - 1] as number;
  const dist = Math.min(t.distanceCap, t.distanceBase + t.perDistance * distanceFromEntrance);
  return base * t.soloFactor * t.roomRoleFactor[roomRole] * dist;
}

function pickGroup(pool: MonsterDef[], maxCount: number, budget: number, depth: number, rng: Rng): MonsterDef[] {
  const minRaw = minMonstersAt(depth);
  const wantMin = Math.min(Math.floor(minRaw) + (rng.chance(minRaw - Math.floor(minRaw)) ? 1 : 0), maxCount);
  const t = ENCOUNTER_TUNING;
  const chosen: MonsterDef[] = [];
  let remaining = budget;
  let overUsed = 0;
  const minXp = Math.min(...pool.map((m) => m.xp));
  while (chosen.length < maxCount) {
    const cap = chosen.length === 0 ? budget * t.firstOvershoot : remaining * t.overshoot;
    const cands = pool.filter((m) => m.xp <= cap && (m.cr <= depth || overUsed < t.maxOverLevel));
    if (cands.length === 0) break;
    const m = rng.weighted(
      cands,
      cands.map((x) => t.roleWeight[x.role] * (t.monsterWeight[x.id] ?? 1)),
    );
    chosen.push(m);
    remaining -= m.xp;
    if (m.cr > depth) overUsed++;
    if (remaining < minXp * 0.9) break;
  }
  if (chosen.length === 0) {
    const legal = pool.filter((m) => m.cr <= depth);
    const from = legal.length > 0 ? legal : pool;
    chosen.push(from.reduce((a, b) => (b.xp < a.xp ? b : a)));
  }
  // Populate: top up to the minimum group size with the cheapest legal monsters.
  while (chosen.length < wantMin && chosen.reduce((n, m) => n + m.xp, 0) < budget * t.topUpLimit) {
    const overUsedNow = chosen.filter((m) => m.cr > depth).length;
    const cheap = pool.filter((m) => m.cr <= depth || overUsedNow < t.maxOverLevel).sort((x, y) => x.xp - y.xp);
    const lowest = cheap[0]?.xp ?? 0;
    chosen.push(rng.pick(cheap.filter((m) => m.xp === lowest)));
  }
  return chosen;
}

/**
 * Populate a floor. Hero level is assumed to equal plan.depth. Only monsters
 * whose themes include plan.theme are used.
 */
export function buildEncounters(plan: FloorPlan, monsters: MonsterDef[], rng: Rng): PlacedMonster[] {
  const themed = monsters.filter((m) => m.themes.includes(plan.theme));
  if (themed.length === 0) return [];
  const forcedBossId = ENCOUNTER_TUNING.bossByDepth[plan.depth];
  const forcedBoss = forcedBossId ? themed.find((m) => m.id === forcedBossId) : undefined;
  const isBoss = (m: MonsterDef): boolean => (forcedBoss ? m.id === forcedBoss.id : m.role === 'boss');
  const eligible = themed.filter(
    (m) =>
      !isBoss(m) &&
      m.role !== 'boss' &&
      plan.depth >= (ENCOUNTER_TUNING.monsterMinDepth[m.id] ?? 1) &&
      plan.depth <= (ENCOUNTER_TUNING.monsterMaxDepth[m.id] ?? Infinity),
  );
  // Drop the monsters this floor has outgrown, unless the theme has nothing stronger to offer.
  const minCr = Math.floor(plan.depth * ENCOUNTER_TUNING.minCrPerDepth);
  const strong = eligible.filter((m) => m.cr >= minCr);
  const regular = strong.length > 0 ? strong : eligible;
  const bosses = themed.filter(isBoss);
  const out: PlacedMonster[] = [];
  const t = ENCOUNTER_TUNING;

  const roomIds = [...new Set(plan.spawns.map((s) => s.roomId))].sort((a, b) => a - b);
  for (const roomId of roomIds) {
    const room = plan.rooms.find((r) => r.id === roomId);
    if (!room || room.role === 'entrance') continue;
    const monsterSlots = rng.shuffle(plan.spawns.filter((s) => s.roomId === roomId && s.role === 'monster'));
    const bossSlots = plan.spawns.filter((s) => s.roomId === roomId && s.role === 'boss');
    const placements: { def: MonsterDef; slot: SpawnSlot }[] = [];

    let bossDef: MonsterDef | undefined;
    if (room.role === 'boss' || bossSlots.length > 0) {
      const fallback = [...themed].sort((a, b) => b.cr - a.cr)[0];
      bossDef = bosses.length > 0 ? rng.pick(bosses) : fallback;
    }
    if (bossDef) {
      const bossSlot = bossSlots[0] ?? monsterSlots.shift();
      if (bossSlot) placements.push({ def: bossDef, slot: bossSlot });
      // Boss escorts must fit the boss-room budget, so a 200 XP "standard" monster is never an escort at low depth.
      const escortCap = Math.max(roomBudget(plan.depth, 'boss', room.distanceFromEntrance) * 1.2, Math.min(...regular.map((m) => m.xp)));
      const legal = regular.filter((m) => m.cr <= plan.depth && m.xp <= escortCap);
      const minionPool = legal.filter((m) => m.role === 'minion');
      const pool = minionPool.length > 0 ? minionPool : legal.filter((m) => m.role === 'standard');
      const cap = pool.length > 0 ? Math.min(bossMinionLimit(plan.depth), monsterSlots.length) : 0;
      let n = 0;
      for (let i = 0; i < cap; i++) if (rng.chance(bossMinionChanceAt(plan.depth))) n++;
      for (let i = 0; i < n; i++) placements.push({ def: rng.pick(pool), slot: monsterSlots[i] as SpawnSlot });
    } else if (monsterSlots.length > 0 && regular.length > 0) {
      const budget = roomBudget(plan.depth, room.role, room.distanceFromEntrance);
      if (budget > 0) {
        const group = pickGroup(regular, Math.min(t.maxMonstersPerRoom, monsterSlots.length), budget, plan.depth, rng);
        group.forEach((def, i) => placements.push({ def, slot: monsterSlots[i] as SpawnSlot }));
      }
    }

    // Names: duplicates within a room get a letter suffix.
    const totals = new Map<string, number>();
    for (const p of placements) totals.set(p.def.id, (totals.get(p.def.id) ?? 0) + 1);
    const seen = new Map<string, number>();
    placements.forEach((p, n) => {
      const creature = instantiateMonster(p.def, `m_${roomId}_${n}`, p.slot.pos);
      if ((totals.get(p.def.id) ?? 0) > 1) {
        const k = seen.get(p.def.id) ?? 0;
        seen.set(p.def.id, k + 1);
        creature.name = `${p.def.name} ${String.fromCharCode(65 + k)}`;
      }
      out.push({ creature, roomId });
    });
  }
  return out;
}

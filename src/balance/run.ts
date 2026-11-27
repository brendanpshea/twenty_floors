import { COMPANION_JOIN_LEVEL, type CharacterBuild, type CompanionStance, type CompanionState, type PlayerCharacter } from '../core/types';
import {
  applyLevelUp,
  bestPotion,
  buyItem,
  canEquip,
  compareItem,
  companionLongRest,
  computeAc,
  createCharacter,
  enterFloor,
  finalAbilities,
  equipItem,
  floorReward,
  getItem,
  longRest,
  newCompanionState,
  previewLevelUp,
  requireCompanion,
  shopStock,
  suggestedLevelChoices,
  scheduledGear,
  scheduledWorn,
  attuneItem,
  canAttune,
} from '../rules';
import { simulateFloor, type FloorOptions } from './floor';

const MAX_POTIONS = 6;
const MAX_ATTEMPTS = 8;

/**
 * Gear by hero level, adapted from the quick model (`fighterAt` in model.ts), for the real engine: chain mail, then splint
 * at level 3 and plate at 5 (heavy armor wearers only); +1 armor from 5, +2 from 10, +3 from 16; +1 weapons from 4,
 * +2 from 9, +3 from 15; a +1 shield from 8 and +2 from 13. It is a DESIGN assumption (what shops and chests would
 * have supplied by then), not the real economy: `gear: 'shop'` plays the economy as it is.
 */
export function scheduleGear(pc: PlayerCharacter): PlayerCharacter {
  const next: PlayerCharacter = { ...pc, equipped: { ...pc.equipped }, inventory: pc.inventory.map((s) => ({ ...s })) };
  const want = scheduledGear(pc.level, pc.equipped);
  for (const [slot, id] of Object.entries(want) as [keyof typeof want, string][]) {
    if (!getItem(id)) continue;
    if (!next.inventory.some((s) => s.itemId === id)) next.inventory.push({ itemId: id, quantity: 1 });
    next.equipped[slot] = id;
  }
  // Fully equipped for its level: the worn magic items of the schedule, worn and attuned, in place of whatever was worn.
  const worn = scheduledWorn(pc.level).filter((id) => getItem(id));
  if (worn.length === 0) return next;
  let dressed: PlayerCharacter = { ...next, worn: {}, attuned: [] };
  for (const id of worn) {
    if (!dressed.inventory.some((s) => s.itemId === id)) dressed = { ...dressed, inventory: [...dressed.inventory, { itemId: id, quantity: 1 }] };
    if (getItem(id)?.slot) dressed = equipItem(dressed, id);
    if (getItem(id)?.attunement && canAttune(dressed, id).ok) dressed = attuneItem(dressed, id);
  }
  return dressed;
}

/** Scripted hub visit: long rest, reward for the floor just cleared, level up, shop, refresh floor resources. */
export function hubVisit(pc: PlayerCharacter, clearedDepth: number, opts: { shop?: boolean; gear?: 'shop' | 'schedule' } = {}): PlayerCharacter {
  let cur = longRest({ ...pc, gold: pc.gold + floorReward(clearedDepth) });
  if (previewLevelUp(cur)) cur = applyLevelUp(cur, suggestedLevelChoices(cur));
  if (opts.gear === 'schedule') cur = scheduleGear(cur);
  if (opts.shop !== false) cur = shop(cur, clearedDepth + 1, opts.gear === 'schedule');
  return enterFloor(cur);
}

function potionTotal(pc: PlayerCharacter): number {
  return pc.inventory.filter((s) => s.itemId.startsWith('potion')).reduce((n, s) => n + s.quantity, 0);
}

/**
 * The real hub's autoShop, played by the scripted hero: two potions first, then the best affordable upgrade (armor before
 * weapons before shields, the dearest first, as HubFlow.autoShop does), then potions with what is left.
 */
export function shop(pc: PlayerCharacter, nextDepth: number, potionsOnly = false): PlayerCharacter {
  let cur = pc;
  const stock = shopStock(nextDepth, pc);
  const potion = bestPotion(stock);
  const potions = (): number => cur.inventory.filter((x) => getItem(x.itemId)?.consumable).reduce((n, x) => n + x.quantity, 0);
  const rank: Record<string, number> = { armor: 0, weapon: 1, shield: 2 };
  for (let guard = 0; guard < 40 && !potionsOnly; guard++) {
    if (potion && potions() < 2 && cur.gold >= potion.cost) {
      cur = buyItem(cur, potion.id);
      continue;
    }
    const reserve = potion ? Math.max(0, 2 - potions()) * potion.cost : 0;
    const options = shopStock(nextDepth, cur)
      .filter((i) => i.kind !== 'consumable' && i.cost <= cur.gold - reserve && compareItem(cur, i.id)?.verdict === 'upgrade')
      .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || b.cost - a.cost);
    const pick = options[0];
    if (!pick || !canEquip(buyItem(cur, pick.id), pick.id).ok) break;
    cur = equipItem(buyItem(cur, pick.id), pick.id);
  }
  while (potion && cur.gold >= potion.cost && potions() < (potionsOnly ? MAX_POTIONS : 4)) cur = buyItem(cur, potion.id);
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
  longRestsUsed: number;
  attemptsTotalForClear: number;
  bossArrivalHpSum: number;
  /** Per fight group ("role: monsters"): fights and hero deaths, all attempts. */
  rooms: Record<string, { n: number; deaths: number }>;
  /** Times the companion was downed, over all attempts. */
  companionDowns: number;
  /** Runs that reached this floor only because an earlier floor was skipped after too many failed attempts (`keepGoing`). */
  forced: number;
  /** Whether each run seed cleared this floor on its first attempt (for paired comparisons between policies). */
  firstTryBySeed: Record<number, boolean>;
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
    longRestsUsed: 0,
    attemptsTotalForClear: 0,
    bossArrivalHpSum: 0,
    rooms: {},
    companionDowns: 0,
    forced: 0,
    firstTryBySeed: {},
  };
}

export interface RunOptions extends Partial<Omit<FloorOptions, 'runSeed' | 'depth' | 'attempt' | 'companion'>> {
  /** The travelling companion: who and how it behaves. It joins when the hero reaches COMPANION_JOIN_LEVEL (floor 4). */
  companion?: { id: string; stance?: CompanionStance };
  /** 'schedule': the design gear schedule (scheduleGear); 'shop' (default): only what the economy buys. */
  gear?: 'shop' | 'schedule';
  /** After MAX_ATTEMPTS failed attempts, carry on to the next floor anyway (to sample deep floors in every run). */
  keepGoing?: boolean;
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
  const { companion: companionOpt, gear, keepGoing, ...floorOpts } = opts;
  for (const runSeed of runSeeds) {
    let pc = (opts.makePc ?? createCharacter)(build);
    let comp: CompanionState | undefined;
    let ok = true;
    let forcedRun = false;
    for (let depth = 1; depth <= floors && ok; depth++) {
      const st = stats[depth - 1] as FloorStats;
      st.runs++;
      if (forcedRun) st.forced++;
      // The companion joins on the floor where the hero is COMPANION_JOIN_LEVEL.
      if (companionOpt && !comp && pc.level >= COMPANION_JOIN_LEVEL) comp = newCompanionState(companionOpt.id, pc.level);
      const entry = pc;
      const entryComp = comp;
      let cleared = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cleared; attempt++) {
        const r = simulateFloor(entry, {
          ...floorOpts,
          runSeed,
          depth,
          attempt,
          ...(companionOpt && entryComp ? { companion: { id: companionOpt.id, ...(companionOpt.stance ? { stance: companionOpt.stance } : {}), state: entryComp } } : {}),
        });
        st.attempts++;
        if (attempt === 0) st.firstTryBySeed[runSeed] = r.cleared;
        st.companionDowns += r.companionDowns ?? 0;
        st.potionsUsed += r.potionsUsed;
        st.shortRestsUsed += r.shortRestsUsed;
        st.longRestsUsed += r.longRestsUsed;
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
          pc = hubVisit(r.pc, depth, { shop: opts.careless !== true, ...(gear ? { gear } : {}) });
          if (comp && r.companion) comp = r.companion;
        } else if (r.death) {
          st.deathsByRole[r.death.role] = (st.deathsByRole[r.death.role] ?? 0) + 1;
          st.deathsByKiller[r.death.killer] = (st.deathsByKiller[r.death.killer] ?? 0) + 1;
        }
      }
      if (!cleared) {
        if (keepGoing) {
          // Skip ahead as if the floor had been cleared (a levelled, rested hero at the next hub) so deeper floors are sampled too.
          pc = hubVisit(entry, depth, { shop: opts.careless !== true, ...(gear ? { gear } : {}) });
          forcedRun = true;
        } else ok = false;
      }
      // The hub rests the companion fully, sized for the new level; a companion that has not joined yet joins at the first hub it can.
      if (comp && companionOpt) comp = companionLongRest(comp, requireCompanion(companionOpt.id), pc.level);
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
        `  potions/att ${(f.potionsUsed / f.attempts).toFixed(2)} short/long rests per att ${(f.shortRestsUsed / f.attempts).toFixed(2)}/${(f.longRestsUsed / f.attempts).toFixed(2)}  killers ${killers}`,
    );
  }
  return lines.join('\n');
}

import { Rng, floorSeed, hashSeed } from '../core/rng';
import type { CompanionState, Creature, FloorPlan, GameEvent, GridPos, NavGrid, PlayerCharacter, Room, ThemeId } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { createNavGrid, generateFloor } from '../gen';
import {
  buildEncounters,
  createCombat,
  createCompanion,
  createPartyDriver,
  expertPolicy,
  expertStance,
  playerPolicy,
  requireCompanion,
  syncFromCreature,
  toCreature,
  type PolicyFn,
} from '../rules';
import { arriveAt } from './floorFit.shared';
import { routeToBoss } from './floor';

/**
 * Fight-level measurement. A pairing (theme, depth) is characterised by fighting each combat room and the boss room of
 * N generated floors ONCE, from a fresh, fully rested party (hero at the floor's level in the gear schedule, a Blink Dog
 * from floor 4) entering by the room's main doorway. Outcomes are continuous (HP lost, rounds, resources), so a few
 * hundred fights say more than dozens of whole-floor runs. `predictClear` turns the room distributions into a first-attempt
 * floor clear rate with a small attrition model (see `ATTRITION`).
 */

export interface RoomOutcome {
  role: 'combat' | 'boss';
  onRoute: boolean;
  monsters: number;
  /** Fraction of the hero's maximum HP lost (1 when it died). */
  heroLoss: number;
  /** Fraction of the companion's maximum HP lost (0 without a companion). */
  companionLoss: number;
  heroDied: boolean;
  companionDowned: boolean;
  rounds: number;
  secondWind: number;
  actionSurge: number;
  potions: number;
  companionSpells: number;
  topDealer: string;
  timedOut: boolean;
  /** Hazard events (falls, lava) the hero suffered, the damage they did, and whether the hero died of one. */
  heroHazards: number;
  heroHazardDamage: number;
  heroHazardDeath: boolean;
  /** Hazard events on enemies, and slams (fire and spikes) on either side. */
  enemyHazards: number;
  slams: number;
  /** Which hazards enemies were pushed into: 'fall' and 'lava', and 'slam' for fire and spikes. */
  enemyKinds: Record<string, number>;
  /** Short descriptions of the falls and slams in the fight (for reading what clever play looks like). */
  notes: string[];
}

export interface RoomStats {
  n: number;
  meanLoss: number;
  p90Loss: number;
  deathRate: number;
  companionDownRate: number;
  meanRounds: number;
}

export interface PairingReport {
  theme: ThemeId;
  depth: number;
  floors: number;
  combat: RoomStats;
  boss: RoomStats;
  /** Mean number of combat rooms on the route to the boss, and off it. */
  routeRooms: number;
  sideRooms: number;
  topDealers: Record<string, number>;
  outcomes: RoomOutcome[];
}

const MAX_ROUNDS = 40;

function stats(list: RoomOutcome[]): RoomStats {
  const n = list.length;
  if (n === 0) return { n: 0, meanLoss: 0, p90Loss: 0, deathRate: 0, companionDownRate: 0, meanRounds: 0 };
  const losses = list.map((o) => o.heroLoss).sort((a, b) => a - b);
  return {
    n,
    meanLoss: losses.reduce((a, b) => a + b, 0) / n,
    p90Loss: losses[Math.min(n - 1, Math.floor(0.9 * n))] as number,
    deathRate: list.filter((o) => o.heroDied).length / n,
    companionDownRate: list.filter((o) => o.companionDowned).length / n,
    meanRounds: list.reduce((a, o) => a + o.rounds, 0) / n,
  };
}

/** The cell where the party arrives in a room: the first cell of the walk from the entrance that lies inside the room. */
function doorwayCell(plan: FloorPlan, nav: NavGrid, room: Room, taken: GridPos[]): GridPos {
  const path = nav.findPath(plan.entrance, room.center) ?? [];
  let cell: GridPos = room.center;
  for (const p of path) {
    if ((plan.roomIds[p.y * plan.width + p.x] as number) === room.id) {
      cell = p;
      break;
    }
  }
  const free = (p: GridPos): boolean => nav.isWalkable(p) && !taken.some((t) => t.x === p.x && t.y === p.y);
  if (free(cell)) return cell;
  for (let r = 1; r < 6; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = { x: cell.x + dx, y: cell.y + dy };
      if (free(q)) return q;
    }
  return cell;
}

function fightRoom(
  pc: PlayerCharacter,
  companionState: CompanionState | undefined,
  companionId: string,
  monsters: Creature[],
  plan: FloorPlan,
  nav: NavGrid,
  room: Room,
  policy: PolicyFn,
  stance: 'close' | 'back' | 'focus',
  rng: Rng,
): Omit<RoomOutcome, 'role' | 'onRoute'> {
  const at = doorwayCell(plan, nav, room, monsters.map((m) => m.pos));
  const hero = toCreature(pc, at);
  const taken = [at, ...monsters.map((m) => m.pos)];
  let cpos: GridPos = at;
  outer: for (let r = 1; r < 5; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = { x: at.x + dx, y: at.y + dy };
      if ((dx || dy) && nav.isWalkable(q) && !taken.some((t) => t.x === q.x && t.y === q.y)) {
        cpos = q;
        break outer;
      }
    }
  const companion = companionState ? createCompanion(requireCompanion(companionId), pc.level, companionState, cpos) : undefined;
  const combat = createCombat(companion ? [hero, companion, ...monsters] : [hero, ...monsters], nav, rng, { depth: plan.depth });
  const driver = createPartyDriver(stance, policy);
  const events: GameEvent[] = [...combat.begin()];
  let guard = 0;
  let timedOut = false;
  while (!combat.isOver) {
    if (combat.round > MAX_ROUNDS || guard++ > 4000) {
      timedOut = true;
      break;
    }
    events.push(...driver.playTurn(combat, nav));
  }
  const won = combat.winner === 'player' && !timedOut;
  const dealt: Record<string, number> = {};
  let sw = 0;
  let surge = 0;
  let potions = 0;
  let cspells = 0;
  for (const e of events) {
    if (e.type === 'damage' && e.sourceId && (e.targetId === 'player' || e.targetId === 'companion')) {
      const d = monsters.find((m) => m.id === e.sourceId)?.defId;
      if (d) dealt[d] = (dealt[d] ?? 0) + e.amount;
    }
    if (e.type === 'actionUsed') {
      if (e.creatureId === 'player') {
        if (e.actionId === 'second_wind') sw++;
        else if (e.actionId === 'action_surge') surge++;
        else if (e.actionId.startsWith('drink_')) potions++;
      } else if (e.creatureId === 'companion' && e.actionId.startsWith('spell_')) cspells++;
    }
  }
  const top = Object.entries(dealt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const heroEnd = won ? hero.hp : 0;
  return {
    monsters: monsters.length,
    heroLoss: won ? 1 - heroEnd / hero.maxHp : 1,
    companionLoss: companion ? 1 - Math.max(0, companion.hp) / companion.maxHp : 0,
    heroDied: !won,
    companionDowned: companion ? companion.dead || companion.hp <= 0 : false,
    rounds: combat.round,
    secondWind: sw,
    actionSurge: surge,
    potions,
    companionSpells: cspells,
    topDealer: top,
    timedOut,
    ...hazardStats(events),
    notes: hazardNotes(events, (id) => combat.creature(id)?.name ?? id),
  };
}

/** Hazard figures from a fight's events (see RoomOutcome). */
function hazardStats(events: GameEvent[]): { heroHazards: number; heroHazardDamage: number; heroHazardDeath: boolean; enemyHazards: number; slams: number; enemyKinds: Record<string, number> } {
  const enemyKinds: Record<string, number> = {};
  let heroHazards = 0;
  let heroHazardDamage = 0;
  let heroHazardDeath = false;
  let enemyHazards = 0;
  let slams = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as GameEvent;
    if (e.type === 'feature' && e.id === 'slam') {
      slams++;
      if (e.creatureId !== 'player' && e.creatureId !== 'companion') enemyKinds['slam'] = (enemyKinds['slam'] ?? 0) + 1;
    }
    if (e.type !== 'hazard') continue;
    if (e.creatureId === 'player') {
      heroHazards++;
      for (let j = i + 1; j < Math.min(events.length, i + 4); j++) {
        const d = events[j] as GameEvent;
        if (d.type === 'damage' && d.targetId === 'player') {
          heroHazardDamage += d.amount;
          if (d.hpAfter <= 0) heroHazardDeath = true;
          break;
        }
      }
    } else if (e.creatureId !== 'companion') {
      enemyHazards++;
      enemyKinds[e.hazard] = (enemyKinds[e.hazard] ?? 0) + 1;
    }
  }
  return { heroHazards, heroHazardDamage, heroHazardDeath, enemyHazards, slams, enemyKinds };
}

function hazardNotes(events: GameEvent[], name: (id: string) => string): string[] {
  const out: string[] = [];
  let round = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as GameEvent;
    if (e.type === 'roundStart') round = e.round;
    const grab = (from: number): string => {
      for (let j = from; j < Math.min(events.length, from + 4); j++) {
        const d = events[j] as GameEvent;
        if (d.type === 'damage') return d.amount + ' damage' + (d.hpAfter <= 0 ? ', killed' : ', ' + d.hpAfter + ' HP left');
      }
      return '';
    };
    if (e.type === 'hazard') out.push('round ' + round + ': ' + name(e.creatureId) + ' ' + (e.sourceId ? 'pushed by ' + name(e.sourceId) + ' ' : '') + 'into ' + e.hazard + ' (' + grab(i + 1) + ')');
    if (e.type === 'feature' && e.id === 'slam') out.push('round ' + round + ': ' + name(e.creatureId) + ' slammed (' + (e.amount ?? 0) + ' damage)');
  }
  return out.slice(0, 8);
}

export interface MeasureOptions {
  /** A custom hero policy (for instrumented measurements); overrides `policy`. */
  policyFn?: PolicyFn;
  /** Number of floors to generate (each yields several fights). Default 10. */
  floors?: number;
  seed0?: number;
  policy?: 'expert' | 'naive';
  kit?: string;
  companion?: string;
  /** Fight only the rooms of this role (the others are skipped): the tuner searches ordinary rooms and boss rooms separately. */
  only?: 'combat' | 'boss';
}

/** Fight every combat room and the boss room of `floors` generated floors of a pairing, once each, from a rested party. */
export function measureRooms(theme: ThemeId, depth: number, opts: MeasureOptions = {}): PairingReport {
  const floors = opts.floors ?? 10;
  const seed0 = opts.seed0 ?? 500;
  const companionId = opts.companion ?? 'blink_dog';
  const policyName = opts.policy ?? 'expert';
  const policy = opts.policyFn ?? (policyName === 'naive' ? playerPolicy : expertPolicy);
  const stance = policyName === 'naive' ? 'close' : expertStance(companionId);
  const { pc: base, companion } = arriveAt(depth, opts.kit ?? 'a', companionId);
  const outcomes: RoomOutcome[] = [];
  let route = 0;
  let side = 0;
  for (let i = 0; i < floors; i++) {
    const runSeed = seed0 + i;
    const plan = generateFloor({ seed: floorSeed(runSeed, depth), depth, theme });
    const nav = createNavGrid(plan);
    const placed = buildEncounters(plan, MONSTERS, new Rng(hashSeed(floorSeed(runSeed, depth), 'encounters')));
    const onRoute = new Set(routeToBoss(plan));
    const rng = new Rng(hashSeed(floorSeed(runSeed, depth), 'rooms'));
    const roomIds = [...new Set(placed.map((m) => m.roomId))];
    for (const id of roomIds) {
      const room = plan.rooms.find((r) => r.id === id) as Room;
      if (room.role === 'entrance') continue;
      const group = placed.filter((m) => m.roomId === id).map((m) => m.creature);
      if (group.length === 0) continue;
      const role = room.role === 'boss' ? 'boss' : 'combat';
      if (opts.only && role !== opts.only) continue;
      if (role === 'combat') {
        if (onRoute.has(id)) route++;
        else side++;
      }
      const hero: PlayerCharacter = { ...base };
      const r = fightRoom(hero, companion, companionId, group, plan, nav, room, policy, stance, rng);
      outcomes.push({ role, onRoute: onRoute.has(id), ...r });
    }
  }
  void syncFromCreature;
  const combat = outcomes.filter((o) => o.role === 'combat');
  const boss = outcomes.filter((o) => o.role === 'boss');
  const dealers: Record<string, number> = {};
  for (const o of outcomes) if (o.topDealer) dealers[o.topDealer] = (dealers[o.topDealer] ?? 0) + 1;
  return { theme, depth, floors, combat: stats(combat), boss: stats(boss), routeRooms: route / floors, sideRooms: side / floors, topDealers: dealers, outcomes };
}

// --------------------------------------------------------------------------- attrition model

/**
 * The attrition model: a floor is the route's combat rooms, half the side rooms, then the boss. Each room takes a loss drawn
 * from the pairing's measured distribution for its role, scaled by `lossScale` (what a fresh-party fight understates: fights
 * back to back, positioning the policy loses when hurt). The hero dies when a room's loss exceeds what it has left (Last
 * Stand once). Between rooms: up to two short rests, potions below 40%, and the two long rests (midway and before the boss).
 * `lossScale` and `restFactor` are calibrated once against the real-engine floor measurements (see calibrate in the
 * report test) and stored in `ATTRITION`.
 */
export const ATTRITION = { lossScale: 1.5, shortRestHeal: 0.35, potionHeal: 0.25, potions: 3, longRestBelow: 0.75 };

export function predictClear(report: PairingReport, trials = 2000, params = ATTRITION): number {
  const combat = report.outcomes.filter((o) => o.role === 'combat').map((o) => o.heroLoss);
  const boss = report.outcomes.filter((o) => o.role === 'boss').map((o) => o.heroLoss);
  if (boss.length === 0 || combat.length === 0) return NaN;
  const rng = new Rng(12345);
  let clears = 0;
  for (let t = 0; t < trials; t++) {
    const nRoute = Math.max(0, Math.round(report.routeRooms + (rng.chance(report.routeRooms % 1) ? 0 : 0)));
    const nSide = Math.round(report.sideRooms * 0.5);
    const rooms = nRoute + nSide;
    let h = 1;
    let ls = true;
    let shorts = 2;
    let pots = params.potions;
    let alive = true;
    const takeHit = (loss: number): void => {
      const l = Math.min(1.5, loss * params.lossScale);
      h -= l;
      if (h <= 0) {
        if (ls && l < 1.2) {
          ls = false;
          h = 0.02;
        } else alive = false;
      }
    };
    const recover = (): void => {
      if (h < 0.55 && shorts > 0) {
        h = Math.min(1, h + params.shortRestHeal);
        shorts--;
      }
      if (h < 0.4 && pots > 0) {
        h = Math.min(1, h + params.potionHeal);
        pots--;
      }
    };
    for (let i = 0; i < rooms && alive; i++) {
      takeHit(rng.pick(combat));
      if (!alive) break;
      recover();
      if (i === Math.floor(rooms / 2) && h < params.longRestBelow) {
        h = 1;
        shorts = 2;
      }
    }
    if (alive) {
      if (h < params.longRestBelow) {
        h = 1;
        shorts = 2;
      }
      takeHit(rng.pick(boss));
    }
    if (alive) clears++;
  }
  return clears / trials;
}

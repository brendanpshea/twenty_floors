import { Rng, floorSeed, hashSeed } from '../core/rng';
import { themeForDepth } from '../core/themes';
import type { Creature, FloorPlan, GameEvent, GridPos, NavGrid, PlayerCharacter, Room } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { createNavGrid, generateFloor } from '../gen';
import {
  buildEncounters,
  castOutOfCombat,
  chestLoot,
  companionLevel,
  companionLongRest,
  companionMaxHp,
  companionPrayer,
  companionShortRest,
  createCombat,
  createCompanion,
  createPartyDriver,
  playerPolicy,
  longRest,
  longRestGain,
  requireCompanion,
  shortRestGain,
  takeShortRest,
  syncCompanion,
  syncFromCreature,
  useConsumable,
  toCreature,
  type PlacedMonster,
  type PolicyFn,
} from '../rules';
import { SHORT_RESTS_PER_LONG_REST, type CompanionStance, type CompanionState } from '../core/types';
import { getItem } from '../rules/items';

export interface FloorOptions {
  runSeed: number;
  depth: number;
  /** Retry counter: changes the dice, not the floor. Default 0. */
  attempt?: number;
  policy?: PolicyFn;
  /** Chance of visiting each optional side room (treasure branches, branch combat). Default 0.5. */
  sideRoomChance?: number;
  /** Careless player: short rests only below 35% HP (no pre-boss rest). */
  careless?: boolean;
  /** Short rests available on this floor. Default 2. */
  shortRests?: number;
  /** The travelling companion (from floor 4 on): who, how it behaves, and its state entering the floor (default: new, at full health). */
  companion?: { id: string; stance?: CompanionStance; state?: CompanionState };
}

export interface FloorResult {
  cleared: boolean;
  /** Character after the floor (hp/resources/potions carried); unchanged-from-entry semantics are the caller's job on a failure. */
  pc: PlayerCharacter;
  death?: { roomId: number; role: Room['role']; killer: string };
  fightsWon: number;
  /** One entry per fight: room, monsters, HP fraction before, and whether the hero survived. */
  log: { roomId: number; role: Room["role"]; monsters: string[]; hpBefore: number; won: boolean }[];
  /** HP fraction on entering the boss room, after any rest. Undefined if never reached. */
  bossEntryHp?: number;
  /** HP fraction on reaching the boss room, before any rest. */
  bossArrivalHp?: number;
  potionsUsed: number;
  shortRestsUsed: number;
  longRestsUsed: number;
  chestGold: number;
  /** The companion's state after the floor (when one travelled). */
  companion?: CompanionState;
  /** Times the companion was downed in a fight. */
  companionDowns?: number;
  /** Fights lost, with how the hero fell: 'timeout' counts the turn cap. */
  fightsLost?: number;
}


const MAX_ROUNDS = 40;
/** The hero notices and steps over to a rest site within this many cells of its path (sites are alcoves 1-3 cells off the route). */
const SITE_NOTICE = 4;
/** The game wakes monsters within this many walking cells with line of sight. */
const TRIGGER_CELLS = 7;

function potionCount(pc: PlayerCharacter): number {
  return pc.inventory.filter((s) => getItem(s.itemId)?.consumable).reduce((n, s) => n + s.quantity, 0);
}

function addPotion(pc: PlayerCharacter): PlayerCharacter {
  const inv = pc.inventory.map((s) => ({ ...s }));
  const s = inv.find((x) => x.itemId === 'potion_healing');
  if (s) s.quantity++;
  else inv.push({ itemId: 'potion_healing', quantity: 1 });
  return { ...pc, inventory: inv };
}

/** Route of room ids from the entrance room to the boss room (shortest in the room graph). */
export function routeToBoss(plan: FloorPlan): number[] {
  const start = plan.rooms.find((r) => r.role === 'entrance') as Room;
  const prev = new Map<number, number>();
  const queue = [start.id];
  const seen = new Set([start.id]);
  while (queue.length > 0) {
    const id = queue.shift() as number;
    const room = plan.rooms.find((r) => r.id === id) as Room;
    if (room.role === 'boss') {
      const path = [id];
      let cur = id;
      while (prev.has(cur)) {
        cur = prev.get(cur) as number;
        path.unshift(cur);
      }
      return path;
    }
    for (const n of room.neighbors) {
      if (!seen.has(n)) {
        seen.add(n);
        prev.set(n, id);
        queue.push(n);
      }
    }
  }
  return [start.id];
}

interface FightOutcome {
  pc: PlayerCharacter;
  won: boolean;
  killer?: string;
  heroPos: GridPos;
  companion?: CompanionState;
  companionDown?: boolean;
}

interface Party {
  id: string;
  stance: CompanionStance;
  state: CompanionState;
}

/** A free walkable cell next to `at` (then further out) for the companion to start on. */
function cellBeside(at: GridPos, nav: NavGrid, taken: GridPos[]): GridPos {
  for (let r = 1; r < 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const p = { x: at.x + dx, y: at.y + dy };
        if ((dx !== 0 || dy !== 0) && nav.inBounds(p) && nav.isWalkable(p) && !taken.some((t) => t.x === p.x && t.y === p.y)) return p;
      }
    }
  }
  return at;
}

function fight(
  pc: PlayerCharacter,
  monsters: Creature[],
  nav: NavGrid,
  at: GridPos,
  policy: PolicyFn,
  rng: Rng,
  party?: Party,
  depth = 1,
): FightOutcome {
  const hero = toCreature(pc, at);
  const companion = party
    ? createCompanion(requireCompanion(party.id), pc.level, party.state, cellBeside(at, nav, [at, ...monsters.map((m) => m.pos)]))
    : undefined;
  const combat = createCombat(companion ? [hero, companion, ...monsters] : [hero, ...monsters], nav, rng, { depth });
  const driver = createPartyDriver(party?.stance ?? 'close', policy);
  const events: GameEvent[] = [...combat.begin()];
  let rounds = 0;
  const finish = (won: boolean, killer?: string): FightOutcome => {
    const out: FightOutcome = { pc: syncFromCreature(pc, hero), won, heroPos: hero.pos };
    if (killer !== undefined) out.killer = killer;
    if (party && companion) {
      out.companion = syncCompanion(party.state, companion);
      out.companionDown = companion.dead || companion.hp <= 0;
    }
    return out;
  };
  while (!combat.isOver) {
    if (combat.round > MAX_ROUNDS || rounds++ > 4000) return finish(false, 'timeout');
    events.push(...driver.playTurn(combat, nav));
  }
  if (combat.winner === 'player') return finish(true);
  let killer = 'unknown';
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as GameEvent;
    if (e.type === 'damage' && e.targetId === 'player' && e.sourceId) {
      killer = monsters.find((m) => m.id === e.sourceId)?.defId ?? killer;
      break;
    }
  }
  return finish(false, killer);
}

/** Play one whole floor with the scripted hero. */
export function simulateFloor(pc: PlayerCharacter, opts: FloorOptions): FloorResult {
  const { runSeed, depth } = opts;
  const policy = opts.policy ?? playerPolicy;
  const sideChance = opts.sideRoomChance ?? 0.5;
  const cached = floorFor(runSeed, depth);
  const plan = cached.plan;
  const nav = cached.nav;
  const placed = buildEncounters(plan, MONSTERS, new Rng(hashSeed(floorSeed(runSeed, depth), 'encounters')));
  const rng = new Rng(hashSeed(floorSeed(runSeed, depth), `dice:${opts.attempt ?? 0}`));
  const byRoom = (id: number): PlacedMonster[] => placed.filter((m) => m.roomId === id);

  const route = routeToBoss(plan);
  const visit: number[] = [];
  for (const id of route) {
    visit.push(id);
    const room = plan.rooms.find((r) => r.id === id) as Room;
    for (const n of room.neighbors) {
      if (route.includes(n)) continue;
      if (rng.chance(sideChance)) visit.push(n);
    }
  }
  // Side rooms that were already queued once must not repeat.
  const order = visit.filter((id, i) => visit.indexOf(id) === i);

  const startPotions = potionCount(pc);
  const result: FloorResult = { cleared: false, pc, fightsWon: 0, log: [], potionsUsed: 0, shortRestsUsed: 0, longRestsUsed: 0, chestGold: 0 };
  let cur = pc;
  let pos: GridPos = plan.entrance;
  let potionsFound = 0;
  const compDef = opts.companion ? requireCompanion(opts.companion.id) : undefined;
  let party: Party | undefined = opts.companion
    ? { id: opts.companion.id, stance: opts.companion.stance ?? 'close', state: opts.companion.state ?? (companionLongRest({ id: opts.companion.id, hp: 1, resources: {}, stance: 'close' }, requireCompanion(opts.companion.id), pc.level)) }
    : undefined;
  if (party) result.companionDowns = 0;
  const careless = opts.careless === true;
  const alive = (m: PlacedMonster): boolean => !m.creature.dead && m.creature.hp > 0;
  const cheb = (p: GridPos, q: GridPos): number => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

  /** The game's fight trigger: standing in a room with living monsters, or within 7 walking cells of one with line of sight. */
  const triggered = (p: GridPos): PlacedMonster[] => {
    const rooms = new Set<number>();
    const here = plan.roomIds[p.y * plan.width + p.x] as number;
    if (here >= 0 && byRoom(here).some(alive)) rooms.add(here);
    for (const m of placed) {
      if (!alive(m) || rooms.has(m.roomId) || cheb(p, m.creature.pos) > TRIGGER_CELLS) continue;
      if (!nav.hasLineOfSight(p, m.creature.pos)) continue;
      const path = nav.findPath(p, m.creature.pos, { maxCost: TRIGGER_CELLS });
      if (path && path.length <= TRIGGER_CELLS) rooms.add(m.roomId);
    }
    return placed.filter((m) => rooms.has(m.roomId) && alive(m));
  };

  const freeCell = (p: GridPos, group: PlacedMonster[]): GridPos => {
    const taken = new Set(group.map((m) => `${m.creature.pos.x},${m.creature.pos.y}`));
    if (!taken.has(`${p.x},${p.y}`)) return p;
    for (let r = 1; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (nav.isWalkable(q) && !taken.has(`${q.x},${q.y}`)) return q;
        }
      }
    }
    return p;
  };

  /** Drink potions between fights when hurt (the game allows potion use outside combat). */
  /** Between fights the hero casts False Life (temporary HP last until the next long rest) and heals with a spell when hurt. */
  const castBuffs = (): void => {
    const r = castOutOfCombat(cur, 'false_life', rng);
    if (!('error' in r)) cur = r.pc;
  };
  const healSpell = (): void => {
    // A Sphinx of Wonder's Prayer of Healing between fights (companion level 8 and up).
    if (party && compDef && (cur.hp / cur.maxHp < 0.6 || party.state.hp < 0.5 * companionHpMax(compDef, cur.level))) {
      const r = companionPrayer(cur, party.state, compDef, cur.level, rng);
      if (!('error' in r)) {
        cur = r.pc;
        party.state = r.state;
      }
    }
    if (cur.hp / cur.maxHp >= 0.6) return;
    for (const id of ['cure_wounds', 'healing_word']) {
      const r = castOutOfCombat(cur, id, rng);
      if (!('error' in r)) {
        cur = r.pc;
        return;
      }
    }
  };
  const maybePotion = (): void => {
    healSpell();
    const limit = careless ? 0.5 : 0.4;
    for (let i = 0; i < 2 && cur.hp / cur.maxHp < limit; i++) {
      const id = cur.inventory.find((st) => st.quantity > 0 && getItem(st.itemId)?.consumable)?.itemId;
      if (!id) return;
      cur = useConsumable(cur, id, rng).pc;
    }
  };

  // Rest sites: real FloorPlan.restSpots when the generator provides them; otherwise a stand-in
  // (site 1 after the fight in the middle main-path combat room, site 2 after the last one).
  interface Site {
    pos?: GridPos;
    roomId?: number;
    used: boolean;
    passed: boolean;
  }
  const mainCombat = route.filter((id) => byRoom(id).length > 0 && plan.rooms.find((r) => r.id === id)?.role !== 'boss');
  const sites: Site[] =
    (plan.restSpots ?? []).length >= 2
      ? (plan.restSpots as GridPos[]).map((p) => ({ pos: p, used: false, passed: false }))
      : [
          { roomId: mainCombat[Math.floor((mainCombat.length - 1) / 2)], used: false, passed: false },
          { roomId: mainCombat[mainCombat.length - 1], used: false, passed: false },
        ];
  let shortRestsLeft = SHORT_RESTS_PER_LONG_REST;
  castBuffs();
  /** Short rest anywhere between fights (the route is out of enemy view): worthwhile when hurt or resources are spent. */
  const maybeShortRest = (): void => {
    if (shortRestsLeft <= 0) return;
    const frac = cur.hp / cur.maxHp;
    const gain = shortRestGain(cur);
    // The companion rests with the hero: hurt, or knocked out in the last fight (it came back at 1 HP).
    const compHurt = party !== undefined && compDef !== undefined && (party.state.hp < 0.6 * companionHpMax(compDef, cur.level));
    const want = careless ? frac < 0.4 && (gain.hp || gain.resources) : frac < 0.6 || gain.resources || compHurt;
    if (!want || !(gain.hp || gain.resources || compHurt)) return;
    cur = takeShortRest(cur, rng).pc;
    if (party && compDef) party.state = companionShortRest(party.state, compDef, cur.level, rng).state;
    shortRestsLeft--;
    result.shortRestsUsed++;
  };
  const longRestHere = (site: Site): void => {
    cur = longRest(cur);
    if (party && compDef) party.state = companionLongRest(party.state, compDef, cur.level);
    castBuffs();
    site.used = true;
    shortRestsLeft = SHORT_RESTS_PER_LONG_REST;
    result.longRestsUsed++;
  };
  /** The hero reaches a site: long rest if it is worth it. A skipped site is lost unless the route passes it again. */
  const reachSite = (i: number): void => {
    const site = sites[i] as Site;
    if (site.used) return;
    site.passed = true;
    const frac = cur.hp / cur.maxHp;
    const isLast = i === sites.length - 1;
    const want = careless
      ? frac < 0.5
      : frac < 0.75 || shortRestsLeft < SHORT_RESTS_PER_LONG_REST || cur.hitDiceLeft < cur.level || (isLast && longRestGain(cur));
    if (want) {
      longRestHere(site);
      maybePotion();
    }
  };
  const touchSites = (p: GridPos): void => {
    sites.forEach((site, i) => {
      if (site.pos && !site.passed && cheb(p, site.pos) <= SITE_NOTICE) reachSite(i);
    });
  };

  /** Walk toward `target`, fighting whatever the trigger wakes on the way. Returns false if the hero died. */
  const walkTo = (target: GridPos, roleOfTarget: Room['role']): boolean => {
    for (let guard = 0; guard < 40; guard++) {
      const here = triggered(pos);
      const path = here.length > 0 ? [] : (nav.findPath(pos, target) ?? []);
      let group = here;
      let at = pos;
      if (group.length === 0) {
        for (const p of path) {
          touchSites(p);
          const t = triggered(p);
          if (t.length > 0) {
            group = t;
            at = p;
            break;
          }
        }
      }
      if (group.length === 0) {
        pos = target;
        return true;
      }
      at = freeCell(at, group);
      const role = group.some((m) => plan.rooms.find((r) => r.id === m.roomId)?.role === 'boss') ? 'boss' : roleOfTarget === 'boss' ? 'combat' : (plan.rooms.find((r) => r.id === group[0]?.roomId)?.role ?? 'combat');
      const hpBefore = cur.hp / cur.maxHp;
      const out = fight(cur, group.map((m) => m.creature), nav, at, policy, rng, party, depth);
      result.log.push({ roomId: group[0]?.roomId ?? -1, role, monsters: group.map((m) => m.creature.defId), hpBefore, won: out.won });
      cur = out.pc;
      if (party && out.companion) party.state = out.companion;
      if (out.companionDown) result.companionDowns = (result.companionDowns ?? 0) + 1;
      pos = out.heroPos;
      if (!out.won) {
        result.death = { roomId: group[0]?.roomId ?? -1, role, killer: out.killer ?? 'unknown' };
        return false;
      }
      result.fightsWon++;
      maybeShortRest();
      sites.forEach((site, i) => {
        if (site.roomId !== undefined && site.roomId === group[0]?.roomId && !site.passed) reachSite(i);
        if (site.pos && !site.passed && cheb(pos, site.pos) <= SITE_NOTICE + 2) reachSite(i);
      });
      maybePotion();
    }
    return true;
  };

  for (const id of order) {
    const room = plan.rooms.find((r) => r.id === id) as Room;
    if (room.role === 'entrance') continue;
    if (room.role === 'boss') {
      result.bossArrivalHp = cur.hp / cur.maxHp;
      maybeShortRest();
      // One optional backtrack: a hurt normal player returns to an unused first site when the second is spent.
      if (!careless && cur.hp / cur.maxHp < 0.5 && sites.length >= 2 && (sites[1] as Site).used && !(sites[0] as Site).used) {
        longRestHere(sites[0] as Site);
        maybePotion();
      }
      result.bossEntryHp = cur.hp / cur.maxHp;
    }
    if (!walkTo(room.center, room.role)) return finishWith(result, cur, startPotions, potionsFound, party);
    if (room.role === 'treasure') {
      const loot = chestLoot(depth, rng);
      result.chestGold += loot.gold;
      cur = { ...cur, gold: cur.gold + loot.gold };
      for (const stack of loot.items) {
        for (let k = 0; k < stack.quantity; k++) cur = addPotion(cur);
        potionsFound += stack.quantity;
      }
    }
  }
  result.cleared = true;
  return finishWith(result, cur, startPotions, potionsFound, party);
}

function companionHpMax(def: ReturnType<typeof requireCompanion>, heroLevel: number): number {
  return companionMaxHp(def, companionLevel(heroLevel));
}

function finishWith(result: FloorResult, cur: PlayerCharacter, startPotions: number, found: number, party?: Party): FloorResult {
  result.pc = cur;
  if (party) result.companion = party.state;
  result.potionsUsed = Math.max(0, startPotions + found - potionCount(cur));
  return result;
}

const floorCache = new Map<string, { plan: FloorPlan; nav: NavGrid }>();
function floorFor(runSeed: number, depth: number): { plan: FloorPlan; nav: NavGrid } {
  const key = `${runSeed}:${depth}`;
  let hit = floorCache.get(key);
  if (!hit) {
    if (floorCache.size > 400) floorCache.clear();
    const plan = generateFloor({ seed: floorSeed(runSeed, depth), depth, theme: themeForDepth(depth) });
    hit = { plan, nav: createNavGrid(plan) };
    floorCache.set(key, hit);
  }
  return hit;
}

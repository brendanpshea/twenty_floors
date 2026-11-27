import type { GridPos } from '../core/types';
import { canShortRest } from './hudModel';
import { cellDistance } from './fog';
import type { FloorSession } from './floorSession';
import { longRestGain, outOfCombatSpells, shortRestGain, syncFromCreature } from '../rules';
import { blockedAt, isSeen, livingMonsters, samePos } from './floorState';

export type BotResult = 'finished' | 'stuck' | 'cap';

/**
 * A bot that plays one floor through the same entry points a human uses:
 * explores toward chests, then monster rooms, then the stairs, and fights with
 * the scripted hero policy. For soak tests and screenshots (?autoplay=1).
 */
export async function runBot(
  session: FloorSession,
  opts: { maxSteps?: number; pause?: (ms: number) => Promise<void> } = {},
): Promise<BotResult> {
  const maxSteps = opts.maxSteps ?? 4000;
  const pause = opts.pause ?? (() => Promise.resolve());
  const ignoredChests = new Set<string>();
  const ignoredSites = new Set<string>();
  const ignoredRooms = new Set<number>();
  let resets = 0;
  let stairsRetries = 0;
  const casts = new Map<string, number>();
  for (let step = 0; step < maxSteps; step++) {
    if (session.finished) return 'finished';
    const state = session.state;
    if (state.mode === 'combat') {
      if (session.combat.playerTurn) await session.combat.autoAct();
      else await pause(30);
      continue;
    }
    if (session.explore.walking) {
      await pause(30);
      continue;
    }
    const frac = state.player.hp / state.player.maxHp;
    const synced = syncFromCreature(state.pc, state.player);
    // Spells first: wards before the first fight, cures when hurt (they cost nothing but a long-rest use).
    if (canCastNow(state)) {
      const want = outOfCombatSpells(synced).find(
        (sp) => sp.available && (casts.get(sp.id) ?? 0) < 3 && (sp.id === 'cure_wounds' || sp.id === 'healing_word' ? frac < 0.7 : state.mode === 'explore'),
      );
      if (want) {
        casts.set(want.id, (casts.get(want.id) ?? 0) + 1);
        await session.explore.castSpell(want.id);
        continue;
      }
    }
    // Short rest between fights when hurt or missing short-rest abilities.
    if (canShortRest(state, false) && (frac < 0.6 || shortRestGain(synced).resources)) {
      await session.explore.shortRest();
      continue;
    }
    // Long rest at a safe, seen, unused site: when hurt, out of short rests, or always before the boss.
    const bossNext = livingMonsters(state).some((m) => m.boss) && !state.chests.some((c) => !c.opened && !ignoredChests.has(c.id));
    const missing = longRestGain(synced);
    if (missing && (frac < 0.75 || state.shortRestsLeft === 0 || bossNext)) {
      const site = state.restSites.find((r) => !r.used && isSeen(state, r.pos) && !ignoredSites.has(r.id) && session.explore.restPathSafe(r.id));
      if (site) {
        await session.explore.approachRest(site.id);
        if (!site.used && state.mode === 'explore') ignoredSites.add(site.id);
        continue;
      }
    }
    const before = { ...state.player.pos };
    if (state.stairsOpen) {
      await session.explore.walkToCell(state.plan.exit);
      if (!session.finished && samePos(before, state.player.pos) && state.mode === 'explore') {
        // A chest left closed in a corridor can wall off the stairs: open the nearest unopened one and try again.
        const closed = state.chests
          .filter((c) => !c.opened)
          .sort((x, y) => cellDistance(before, x.pos) - cellDistance(before, y.pos))[0];
        if (closed && stairsRetries < 6) {
          stairsRetries++;
          await session.explore.approachChest(closed.id);
          continue;
        }
        return 'stuck';
      }
      continue;
    }
    // Chests first (nearest), then the nearest room with living monsters.
    const chests = state.chests
      .filter((c) => !c.opened && !ignoredChests.has(c.id))
      .sort((a, b) => cellDistance(before, a.pos) - cellDistance(before, b.pos));
    const chest = chests[0];
    if (chest) {
      await session.explore.approachChest(chest.id);
      if (!chest.opened && samePos(before, state.player.pos) && state.mode === 'explore') ignoredChests.add(chest.id);
      continue;
    }
    const rooms = new Map<number, GridPos>();
    for (const m of livingMonsters(state)) {
      if (ignoredRooms.has(m.roomId) || rooms.has(m.roomId)) continue;
      const target = roomTarget(session, before, m.roomId);
      if (target) rooms.set(m.roomId, target);
      else ignoredRooms.add(m.roomId);
    }
    const nearest = [...rooms.entries()].sort(
      (a, b) => pathLen(session, before, a[1]) - pathLen(session, before, b[1]),
    )[0];
    if (!nearest) {
      // A monster standing in a corridor can make every room look unreachable for a moment: forget what was ruled
      // out and look again a few times before giving up.
      if (resets < 4 && (ignoredRooms.size > 0 || ignoredChests.size > 0)) {
        resets++;
        ignoredRooms.clear();
        ignoredChests.clear();
        await pause(30);
        continue;
      }
      return 'stuck';
    }
    const [roomId, target] = nearest;
    await session.explore.walkToCell(target);
    if (samePos(before, state.player.pos) && state.mode === 'explore' && !session.finished) ignoredRooms.add(roomId);
  }
  return 'cap';
}

/** A reachable cell in or beside a monster room: its centre, else a cell next to one of its monsters. */
function roomTarget(session: FloorSession, from: GridPos, roomId: number): GridPos | null {
  const s = session.state;
  const room = s.plan.rooms.find((r) => r.id === roomId);
  const cands: GridPos[] = room ? [room.center] : [];
  for (const m of livingMonsters(s)) {
    if (m.roomId !== roomId) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cands.push({ x: m.creature.pos.x + dx, y: m.creature.pos.y + dy });
  }
  const blocked = blockedAt(s);
  for (const c of cands) {
    if (!s.nav.inBounds(c) || !s.nav.isWalkable(c) || blocked(c)) continue;
    if (samePos(c, from) || s.nav.findPath(from, c, { blocked })) return c;
  }
  return null;
}

function pathLen(session: FloorSession, from: GridPos, to: GridPos): number {
  const s = session.state;
  const path = s.nav.findPath(from, to, { blocked: blockedAt(s) });
  return path ? path.length : Number.POSITIVE_INFINITY;
}

function canCastNow(state: FloorSession['state']): boolean {
  return state.mode === 'explore' && !state.finished;
}

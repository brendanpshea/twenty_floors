import type { GridPos } from '../core/types';
import { cellDistance } from './fog';
import type { FloorSession } from './floorSession';
import { blockedAt, livingMonsters, samePos } from './floorState';
import { canShortRest } from './hudModel';

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
  const ignoredRooms = new Set<number>();
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
    if (state.shortRestsLeft > 0 && state.player.hp < state.player.maxHp * 0.8 && canShortRest(state, false)) {
      session.explore.shortRest();
      continue;
    }
    const before = { ...state.player.pos };
    if (state.stairsOpen) {
      await session.explore.walkToCell(state.plan.exit);
      if (!session.finished && samePos(before, state.player.pos) && state.mode === 'explore') return 'stuck';
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
    if (!nearest) return 'stuck';
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

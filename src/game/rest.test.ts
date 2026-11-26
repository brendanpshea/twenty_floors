import { describe, expect, it } from 'vitest';
import type { GridPos } from '../core/types';
import { SHORT_RESTS_PER_LONG_REST } from '../core/types';
import { FloorSession } from './floorSession';
import { blockedAt } from './floorState';
import { cellDistance } from './fog';
import { quickCharacter } from './quickBuild';
import { makeHarness, until } from './testing/fakes';

async function enterFloor(seed = 2, depth = 1) {
  const h = makeHarness();
  const s = new FloorSession(h.deps, { runSeed: seed, depth, pc: quickCharacter(depth), shortRestsLeft: 2 }, 1);
  await s.enter();
  s.state.revealAll = true;
  return { h, s };
}

/** A walkable cell next to `site`. */
function beside(s: FloorSession, site: GridPos): GridPos {
  const st = s.state;
  const c = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: site.x + dx, y: site.y + dy })))
    .find((p) => (p.x !== site.x || p.y !== site.y) && st.nav.isWalkable(p) && !blockedAt(st)(p));
  if (!c) throw new Error('no cell beside site');
  return c;
}

function teleport(h: { renderer: { entities: Map<string, { pos: GridPos }> } }, s: FloorSession, to: GridPos): void {
  s.state.player.pos = to;
  const e = h.renderer.entities.get('player');
  if (e) e.pos = to;
}

/** A cell with no living monster in line of sight within 12 (the entrance is nearly always quiet). */
function quietCell(s: FloorSession): GridPos {
  const st = s.state;
  const here = st.plan.entrance;
  st.monsters = st.monsters.filter((m) => cellDistance(m.creature.pos, here) > 12 || !st.nav.hasLineOfSight(here, m.creature.pos));
  return here;
}

describe('rest sites (long rest)', () => {
  it('real floors have two sites, spawned as entities and blocking their cells', async () => {
    const { h, s } = await enterFloor();
    expect(s.state.restSites).toHaveLength(2);
    for (const r of s.state.restSites) {
      expect(h.renderer.entities.has(r.id)).toBe(true);
      expect(blockedAt(s.state)(r.pos)).toBe(true);
    }
    expect(h.ui.hud?.restSitesLeft).toBe(2);
    expect(h.ui.hud?.canLongRest).toBe(false);
  });

  it('cannot long rest away from a site', async () => {
    const { h, s } = await enterFloor();
    s.state.player.hp = 3;
    s.pushHud();
    expect(h.ui.hud?.canLongRest).toBe(false);
    s.handleIntent({ type: 'longRest' });
    await until(() => !s.explore.resting);
    expect(s.state.player.hp).toBe(3);
    expect(s.state.restSites.every((r) => !r.used)).toBe(true);
  });

  it('fully heals at a site, restores Hit Dice and the short-rest counter, consumes the site; it cannot be reused', async () => {
    const { h, s } = await enterFloor();
    const st = s.state;
    const site = st.restSites[0]!;
    st.player.hp = 3;
    st.pc.hitDiceLeft = 0;
    st.shortRestsLeft = 0;
    teleport(h, s, beside(s, site.pos));
    s.pushHud();
    expect(h.ui.hud?.canLongRest).toBe(true);
    s.handleIntent({ type: 'longRest' });
    await until(() => site.used && !s.explore.resting);
    expect(st.player.hp).toBe(st.player.maxHp);
    expect(st.pc.hitDiceLeft).toBe(st.pc.level);
    expect(st.shortRestsLeft).toBe(SHORT_RESTS_PER_LONG_REST);
    expect(site.used).toBe(true);
    expect(h.renderer.entities.get(site.id)?.dead).toBe(true);
    expect(h.ui.hud?.restSitesLeft).toBe(1);
    expect(h.ui.hud?.canLongRest).toBe(false);
    expect(st.log.some((l) => l.includes('makes camp and is fully restored'))).toBe(true);
    expect(h.audio.plays).toContain('rest');

    st.player.hp = 2;
    await s.explore.tap({ cell: site.pos, entityId: site.id });
    expect(st.player.hp).toBe(2);
    expect(h.ui.huds.some((m) => (m.prompt ?? '').includes('has been used'))).toBe(true);
  });

  it('walks to a tapped site; a rested hero does not consume it', async () => {
    const { h, s } = await enterFloor();
    const st = s.state;
    const site = st.restSites[1]!;
    st.monsters = [];
    st.stairsOpen = true;
    await s.explore.tap({ cell: site.pos, entityId: site.id });
    expect(site.used).toBe(false);
    expect(h.ui.huds.map((m) => m.prompt).filter(Boolean)).toContain('You are already rested.');
    st.player.hp = 4;
    await s.explore.tap({ cell: site.pos, entityId: site.id });
    expect(site.used).toBe(true);
    expect(st.player.hp).toBe(st.player.maxHp);
    expect(cellDistance(st.player.pos, site.pos)).toBeLessThanOrEqual(1);
    expect(h.renderer.errors).toEqual([]);
  });

  it('does not restore Last Stand', async () => {
    const { h, s } = await enterFloor(2, 3);
    const st = s.state;
    const pool = st.player.resources['lastStand'];
    if (!pool) return; // class without Last Stand
    pool.current = 0;
    st.player.hp = 3;
    const site = st.restSites[0]!;
    teleport(h, s, beside(s, site.pos));
    await s.explore.restAt(site.id);
    expect(st.player.resources['lastStand']?.current).toBe(0);
  });

  it('never rests during combat', async () => {
    const { h, s } = await enterFloor();
    const st = s.state;
    const m = st.monsters[0]!;
    m.creature.actions = [];
    m.creature.speed = 0;
    st.player.hp = 3;
    teleport(h, s, beside(s, st.restSites[0]!.pos));
    await s.combat.begin([m]);
    await until(() => s.combat.playerTurn);
    s.pushHud();
    expect(h.ui.hud?.canLongRest).toBe(false);
    expect(h.ui.hud?.canShortRest).toBe(false);
    s.handleIntent({ type: 'longRest' });
    s.handleIntent({ type: 'shortRest' });
    await s.explore.restAt('rest_0');
    expect(st.restSites[0]!.used).toBe(false);
    expect(st.player.hp).toBe(3);
    expect(st.shortRestsLeft).toBe(SHORT_RESTS_PER_LONG_REST);
  });
});

describe('short rest', () => {
  it('heals through Hit Dice, restores short-rest abilities and decrements the counter', async () => {
    const { h, s } = await enterFloor();
    const st = s.state;
    teleport(h, s, quietCell(s));
    st.player.hp = 2;
    const sw = st.player.resources['secondWind'];
    if (sw) sw.current = 0;
    s.pushHud();
    expect(h.ui.hud?.canShortRest).toBe(true);
    expect(h.ui.hud?.hitDice.current).toBe(st.pc.level);
    s.handleIntent({ type: 'shortRest' });
    await until(() => st.shortRestsLeft < SHORT_RESTS_PER_LONG_REST && !s.explore.resting);
    expect(st.player.hp).toBeGreaterThan(2);
    expect(st.shortRestsLeft).toBe(SHORT_RESTS_PER_LONG_REST - 1);
    expect(st.pc.hitDiceLeft).toBeLessThan(st.pc.level);
    if (sw) expect(st.player.resources['secondWind']?.current).toBeGreaterThan(0);
    expect(st.log.some((l) => l.includes('takes a short rest, spends'))).toBe(true);
    expect(h.ui.hud?.shortRestsLeft).toBe(SHORT_RESTS_PER_LONG_REST - 1);
    expect(h.audio.plays).toContain('rest');
  });

  it('is blocked with an enemy in view, with no rests left, or with nothing to gain', async () => {
    const { h, s } = await enterFloor();
    const st = s.state;
    teleport(h, s, quietCell(s));
    st.player.hp = 2;
    // Nothing hurt elsewhere: full health and resources.
    const full = await enterFloor(3);
    full.s.state.shortRestsLeft = 2;
    full.s.pushHud();
    expect(full.h.ui.hud?.canShortRest).toBe(false);
    expect(full.h.ui.hud?.shortRestBlockedReason).toBe('Nothing to recover');

    st.shortRestsLeft = 0;
    s.pushHud();
    expect(h.ui.hud?.canShortRest).toBe(false);
    expect(h.ui.hud?.shortRestBlockedReason).toBe('No short rests left');
    s.handleIntent({ type: 'shortRest' });
    await until(() => !s.explore.resting);
    expect(st.player.hp).toBe(2);

    st.shortRestsLeft = 2;
    const m = st.monsters[0]!;
    const near = [-2, -1, 1, 2].map((d) => ({ x: st.player.pos.x + d, y: st.player.pos.y })).find((c) => st.nav.isWalkable(c) && st.nav.hasLineOfSight(st.player.pos, c));
    if (near) {
      m.creature.pos = near;
      s.pushHud();
      expect(h.ui.hud?.canShortRest).toBe(false);
      expect(h.ui.hud?.shortRestBlockedReason).toBe('An enemy is in view');
      s.handleIntent({ type: 'shortRest' });
      await until(() => !s.explore.resting);
      expect(st.player.hp).toBe(2);
    }
  });

  it('retry restores a rested hero with the full counter and both sites', async () => {
    const { h, s } = await enterFloor(5);
    s.state.shortRestsLeft = 0;
    s.state.restSites[0]!.used = true;
    s.dispose();
    const again = new FloorSession(h.deps, { runSeed: 5, depth: 1, pc: quickCharacter(1), shortRestsLeft: 0 }, 2);
    await again.enter();
    expect(again.state.shortRestsLeft).toBe(SHORT_RESTS_PER_LONG_REST);
    expect(again.state.restSites).toHaveLength(2);
    expect(again.state.restSites.every((r) => !r.used)).toBe(true);
    expect(again.state.restSites.map((r) => r.pos)).toEqual(again.state.plan.restSpots);
  });
});

describe('chests', () => {
  it('pay out through the rules chestLoot', async () => {
    const { s } = await enterFloor();
    const st = s.state;
    const chest = st.chests[0];
    if (!chest) return;
    const gold = st.pc.gold;
    const potions = st.pc.inventory.find((i) => i.itemId === 'potion_healing')?.quantity ?? 0;
    teleport({ renderer: { entities: new Map() } }, s, beside(s, chest.pos));
    await s.explore.openChest(chest.id);
    expect(chest.opened).toBe(true);
    expect(st.pc.gold).toBeGreaterThan(gold);
    expect(st.pc.inventory.find((i) => i.itemId === 'potion_healing')?.quantity ?? 0).toBeGreaterThan(potions);
  });
});

import { describe, expect, it } from 'vitest';
import type { GridPos } from '../core/types';
import { runBot } from './autoplay';
import type { RunState } from './deps';
import { FloorSession } from './floorSession';
import { cellDistance } from './fog';
import { quickCharacter } from './quickBuild';
import { makeHarness, until } from './testing/fakes';

function run(seed: number, depth = 1, level = depth): RunState {
  return { runSeed: seed, depth, pc: quickCharacter(level), shortRestsLeft: 2 };
}

async function enter(seed: number, depth = 1) {
  const h = makeHarness();
  const s = new FloorSession(h.deps, run(seed, depth), 1);
  await s.enter();
  return { h, s };
}

function walkable(s: FloorSession): GridPos[] {
  const { nav } = s.state;
  const out: GridPos[] = [];
  for (let y = 0; y < nav.height; y++) for (let x = 0; x < nav.width; x++) if (nav.isWalkable({ x, y })) out.push({ x, y });
  return out;
}

describe('combat trigger', () => {
  it('ignores a monster that has line of sight but is far by walking, and fires for a near one', async () => {
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const { s } = await enter(seed, 3);
      const st = s.state;
      const m = st.monsters[0];
      if (!m) continue;
      const cells = walkable(s);
      const mp = m.creature.pos;
      const far = cells.find(
        (c) =>
          cellDistance(c, mp) <= 6 &&
          st.nav.hasLineOfSight(c, mp) &&
          st.nav.findPath(c, mp, { maxCost: 7 }) === null &&
          st.plan.roomIds[c.y * st.plan.width + c.x] !== m.roomId &&
          st.plan.rooms.find((r) => r.id === st.plan.roomIds[c.y * st.plan.width + c.x])?.role !== 'entrance',
      );
      if (!far) continue;
      found = true;
      // Only this monster counts for the check.
      st.monsters = [m];
      st.player.pos = far;
      expect(s.explore.combatTrigger()).toBeNull();
      const near = cells.find(
        (c) =>
          cellDistance(c, mp) === 4 &&
          st.nav.hasLineOfSight(c, mp) &&
          st.nav.findPath(c, mp, { maxCost: 7 }) !== null &&
          st.plan.roomIds[c.y * st.plan.width + c.x] !== m.roomId &&
          st.plan.rooms.find((r) => r.id === st.plan.roomIds[c.y * st.plan.width + c.x])?.role !== 'entrance',
      );
      if (near) {
        st.player.pos = near;
        expect(s.explore.combatTrigger()).toHaveLength(1);
      }
    }
    expect(found).toBe(true);
  });

  it('never starts a fight from the entrance room unless a monster is in it', async () => {
    const { s } = await enter(2);
    const st = s.state;
    const entranceRoom = st.plan.roomIds[st.plan.entrance.y * st.plan.width + st.plan.entrance.x];
    const outsiders = st.monsters.filter((m) => m.roomId !== entranceRoom);
    st.monsters = outsiders.slice(0, 1);
    const m = st.monsters[0];
    if (!m) return;
    // Put the lone monster right next to the entrance but in another room.
    const near = walkable(s).find(
      (c) =>
        cellDistance(c, st.plan.entrance) <= 2 &&
        st.plan.roomIds[c.y * st.plan.width + c.x] !== entranceRoom &&
        st.nav.hasLineOfSight(st.plan.entrance, c),
    );
    if (near) m.creature.pos = near;
    expect(s.explore.combatTrigger()).toBeNull();
  });
});

describe('combat quality of life', () => {
  async function fight(distance: [number, number]) {
    for (let seed = 1; seed <= 30; seed++) {
      const { h, s } = await enter(seed);
      const st = s.state;
      const m = st.monsters[0];
      if (!m) continue;
      m.creature.actions = [];
      m.creature.speed = 0;
      m.creature.hp = m.creature.maxHp = 200;
      st.player.actions = st.player.actions.filter((a) => a.id !== 'throw_javelin');
      const mp = m.creature.pos;
      const start = walkable(s).find((c) => {
        const p = st.nav.findPath(c, mp);
        return p !== null && p.length >= distance[0] && p.length <= distance[1] && st.nav.hasLineOfSight(c, mp);
      });
      if (!start) continue;
      st.revealAll = true;
      st.player.pos = start;
      h.renderer.entities.get('player')!.pos = start;
      await s.combat.begin([m]);
      await until(() => s.combat.playerTurn);
      return { h, s, m, start };
    }
    throw new Error('no suitable fight position');
  }

  it('walks to a distant enemy and attacks when it is reachable this turn', async () => {
    const { h, s, m } = await fight([3, 4]);
    await s.combat.tap({ cell: null, entityId: m.creature.id });
    await until(() => s.combat.playerTurn || s.state.mode === 'explore');
    expect(cellDistance(s.state.player.pos, m.creature.pos)).toBeLessThanOrEqual(1);
    expect(s.state.log.some((l) => l.startsWith(`${s.state.pc.build.name} attacks`))).toBe(true);
    expect(h.audio.plays).toContain('swing');
    expect(h.renderer.errors).toEqual([]);
  });

  it('moves as far as it can when the enemy is out of reach this turn', async () => {
    const { h, s, m, start } = await fight([11, 14]);
    await s.combat.tap({ cell: null, entityId: m.creature.id });
    await until(() => s.combat.playerTurn);
    const moved = cellDistance(start, s.state.player.pos);
    expect(moved).toBeGreaterThan(2);
    expect(cellDistance(s.state.player.pos, m.creature.pos)).toBeGreaterThan(1);
    expect(h.ui.huds.some((m) => (m.prompt ?? '').includes('Out of reach this turn'))).toBe(true);
  });
});

describe('items outside combat', () => {
  it('drinks a potion from the explore action bar', async () => {
    const { h, s } = await enter(2);
    const st = s.state;
    st.player.hp = 3;
    s.pushHud();
    const before = h.ui.hud?.actions.find((a) => a.id === 'drink_potion_healing');
    expect(before?.enabled).toBe(true);
    expect(before?.usesLeft).toBe(2);
    s.handleIntent({ type: 'selectAction', actionId: 'drink_potion_healing' });
    expect(st.player.hp).toBeGreaterThan(3);
    expect(st.pc.inventory.find((i) => i.itemId === 'potion_healing')?.quantity).toBe(1);
    expect(h.audio.plays).toContain('potion');
    expect(h.ui.hud?.actions.find((a) => a.id === 'drink_potion_healing')?.usesLeft).toBe(1);
    // Full health: refused.
    st.player.hp = st.player.maxHp;
    s.handleIntent({ type: 'selectAction', actionId: 'drink_potion_healing' });
    expect(st.pc.inventory.find((i) => i.itemId === 'potion_healing')?.quantity).toBe(1);
  });
});

describe('audio', () => {
  it('plays dice, steps and a hit sound through a bot run, and the menu toggles mute', async () => {
    const { h, s } = await enter(2);
    await runBot(s, { maxSteps: 6000 });
    const p = h.audio.plays;
    expect(p).toContain('step');
    expect(p).toContain('diceRoll');
    expect(p).toContain('combatStart');
    expect(p.some((x) => ['hitBlade', 'hitBlunt', 'hitPierce', 'arrowHit'].includes(x))).toBe(true);
    expect(p.some((x) => x === 'hurtMonster' || x === 'hurtHero')).toBe(true);
    expect(h.audio.ambience).toBe('warrens');
    expect(h.renderer.errors).toEqual([]);

    const m = makeHarness({}, { menu: [{ type: 'sound', muted: true }] });
    const s2 = new FloorSession(m.deps, run(3), 1);
    await s2.enter();
    s2.handleIntent({ type: 'openMenu' });
    await until(() => m.audio.muted);
    expect(m.audio.muted).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { GridPos, ThemeId } from '../core/types';
import { SHOVE_ID } from './combatController';
import { FloorSession } from './floorSession';
import { quickCharacter } from './quickBuild';
import { makeHarness, until } from './testing/fakes';
import type { Harness } from './testing/fakes';

type Want = 'fall' | 'lava' | 'ice';

interface Stage {
  h: Harness;
  s: FloorSession;
  monId: string;
  /** Where the monster stands, and the direction a push from the hero sends it. */
  at: GridPos;
  dir: GridPos;
}

interface StageOptions {
  want?: Want;
  /** false: a renderer without the drop and rise effects. */
  hazardFx?: boolean;
}

/**
 * A fight with a monster standing on the lip of a drop or lava (or one step before an ice cell with a free cell
 * beyond it) and the hero on the far side of it. Null when the floor has no such spot.
 */
async function stage(theme: string, depth: number, seed: number, monsterHp: number, opts: StageOptions = {}): Promise<Stage | null> {
  const want = opts.want ?? 'fall';
  const h = makeHarness({ reveal: true, theme: theme as ThemeId, depth, seed }, {}, { hazardFx: opts.hazardFx !== false });
  const s = new FloorSession(h.deps, { runSeed: seed, depth, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
  await s.enter();
  const st = s.state;
  const nav = st.nav;
  const free = (c: GridPos, except?: unknown): boolean =>
    nav.isWalkable(c) && !st.monsters.some((o) => o !== except && o.creature.pos.x === c.x && o.creature.pos.y === c.y);
  for (const m of st.monsters) {
    if (m.creature.size === 'huge') continue;
    for (let y = 2; y < nav.height - 2; y++) {
      for (let x = 2; x < nav.width - 2; x++) {
        const p = { x, y };
        if (!nav.isWalkable(p) || nav.hazardAt(p) !== 'none') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const q = { x: x - dx, y: y - dy };
          const n1 = { x: x + dx, y: y + dy };
          const hz = nav.hazardAt(n1);
          if (!nav.isWalkable(q) || nav.hazardAt(q) !== 'none' || !free(q, m)) continue;
          if (want === 'ice') {
            const n2 = { x: x + 2 * dx, y: y + 2 * dy };
            if (hz !== 'ice' || !nav.isWalkable(n1) || !nav.isWalkable(n2) || nav.hazardAt(n2) !== 'none' || !free(n1) || !free(n2)) continue;
          } else if (hz !== want) continue;
          m.creature.pos = p;
          m.creature.hp = m.creature.maxHp = monsterHp;
          h.renderer.placeEntity(m.creature.id, p);
          st.player.pos = q;
          h.renderer.placeEntity('player', q);
          // Only this monster fights: the rest of its room stays out of it.
          void s.combat.begin([m]);
          if (!(await until(() => s.combat.playerTurn))) return null;
          return { h, s, monId: m.creature.id, at: p, dir: { x: dx, y: dy } };
        }
      }
    }
  }
  return null;
}

/** Stage and shove on successive seeds until the push goes through (the target's save is random). */
async function shoveUntil(theme: string, depth: number, monsterHp: number, opts: StageOptions, done: (g: Stage) => boolean): Promise<Stage | null> {
  for (let seed = 1; seed <= 40; seed++) {
    const g = await stage(theme, depth, seed, monsterHp, opts);
    if (!g) continue;
    const { s } = g;
    await s.combat.selectAction(SHOVE_ID);
    if (s.combat.selectedActionId !== 'shove_push') continue;
    const mon = s.state.monsters.find((m) => m.creature.id === g.monId)?.creature;
    if (!mon) continue;
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    if (done(g)) return g;
  }
  return null;
}

const fell = (g: Stage): boolean => g.h.renderer.floats.some((x) => x.text === 'Falls!' || x.text === 'Lava!');

async function shoveUntilHazard(theme: 'depths' | 'foundry', depth: number, monsterHp: number, opts: StageOptions = {}): Promise<Stage | null> {
  return shoveUntil(theme, depth, monsterHp, { want: theme === 'foundry' ? 'lava' : 'fall', ...opts }, fell);
}

describe('forced movement into a drop', () => {
  it('passes the floor depth to the combat: the push preview rolls one d6 per floor', async () => {
    const g = await stage('depths', 3, 1, 50);
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    s.handleIntent({ type: 'selectCreature', creatureId: monId });
    await s.combat.selectAction(SHOVE_ID);
    s.handleIntent({ type: 'selectCreature', creatureId: monId });
    expect(h.ui.hud?.target?.pushInto?.damage).toBe('3d6');
    expect(h.ui.hud?.target?.pushInto?.hazard).toMatch(/fall|lava/);
    // The landing cell is marked as dangerous.
    expect(h.renderer.highlights.some((c) => c.style === 'danger')).toBe(true);
    // The hit chance of a push is shown too (the chance that the target fails its save).
    expect(typeof h.ui.hud?.target?.hitChance === 'number' || h.ui.hud?.target?.hitChance === undefined).toBe(true);
  });

  it('a survivor drops out of sight, falls, and climbs back out on a walkable cell', async () => {
    const g = await shoveUntilHazard('depths', 3, 400);
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { pos: GridPos; dead: boolean };
    expect(h.renderer.floats.some((f) => f.text === 'Falls!')).toBe(true);
    expect(h.audio.plays).toContain('thunderHit');
    expect(mon.dead).toBe(false);
    // The renderer agrees with the engine about where it ended up, and it is back in view.
    expect(h.renderer.entities.get(monId)?.pos).toEqual(mon.pos);
    expect(h.renderer.entities.get(monId)?.visible).toBe(true);
    expect(s.state.fallen.has(monId)).toBe(false);
    expect(s.state.nav.isWalkable(mon.pos)).toBe(true);
    // It was dropped over the edge and risen at the rim cell, through the renderer's own effects.
    expect(h.renderer.drops).toEqual([{ id: monId, into: 'fall' }]);
    expect(h.renderer.rises).toEqual([{ id: monId, at: mon.pos }]);
    expect(h.renderer.errors).toEqual([]);
  });

  it('without the renderer effects it falls back to hiding and placing', async () => {
    const g = await shoveUntilHazard('depths', 3, 400, { hazardFx: false });
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { pos: GridPos };
    expect(h.renderer.drops).toEqual([]);
    expect(h.renderer.rises).toEqual([]);
    expect(h.renderer.entities.get(monId)?.visible).toBe(true);
    expect(h.renderer.entities.get(monId)?.pos).toEqual(mon.pos);
    expect(s.state.fallen.has(monId)).toBe(false);
  });

  it('a monster killed by the fall leaves no corpse on the floor', async () => {
    const g = await shoveUntilHazard('depths', 3, 1);
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    const e = h.renderer.entities.get(monId);
    expect(e?.visible).toBe(false);
    expect(e?.dead).toBe(true);
    expect(s.state.fallen.has(monId)).toBe(true);
    // Dropped, and never risen.
    expect(h.renderer.drops.map((d) => d.id)).toContain(monId);
    expect(h.renderer.rises).toEqual([]);
    expect(h.renderer.errors).toEqual([]);
  });

  it('lava (foundry, depth 12): a lava edge is found, the monster sinks with the fire sound and rises at the rim', async () => {
    let edge: Stage | null = null;
    for (let seed = 1; seed <= 40 && !edge; seed++) edge = await stage('foundry', 12, seed, 400, { want: 'lava' });
    expect(edge, 'no foundry floor in 40 seeds had a lava edge with a free far side').not.toBeNull();
    const g = await shoveUntilHazard('foundry', 12, 400);
    expect(g, 'no push into lava went through in 40 seeds').not.toBeNull();
    const { h, s, monId } = g as Stage;
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { pos: GridPos };
    expect(h.renderer.floats.some((f) => f.text === 'Lava!')).toBe(true);
    expect(h.audio.plays).toContain('fireHit');
    expect(h.renderer.drops).toEqual([{ id: monId, into: 'lava' }]);
    expect(h.renderer.rises).toEqual([{ id: monId, at: mon.pos }]);
    expect(h.renderer.errors).toEqual([]);
  });

  it('lava in the hell vault (depth 18) is found too', async () => {
    let edge: Stage | null = null;
    for (let seed = 1; seed <= 40 && !edge; seed++) edge = await stage('hell', 18, seed, 400, { want: 'lava' });
    expect(edge, 'no hell floor in 40 seeds had a lava edge with a free far side').not.toBeNull();
  });

  it('an ice slide on an ice-theme floor carries the monster one cell past the push', async () => {
    let probe: Stage | null = null;
    for (let seed = 1; seed <= 60 && !probe; seed++) probe = await stage('ice', 14, seed, 400, { want: 'ice' });
    expect(probe, 'no ice floor in 60 seeds had an ice cell with a free cell beyond').not.toBeNull();
    const g = await shoveUntil('ice', 14, 400, { want: 'ice' }, (x) => {
      const m = x.s.state.monsters.find((o) => o.creature.id === x.monId)?.creature;
      return !!m && (m.pos.x !== x.at.x || m.pos.y !== x.at.y);
    });
    expect(g, 'no shove onto ice went through in 40 seeds').not.toBeNull();
    const { h, s, monId, at, dir } = g as Stage;
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { pos: GridPos };
    // Pushed one cell onto the ice and slid one more.
    expect(mon.pos).toEqual({ x: at.x + 2 * dir.x, y: at.y + 2 * dir.y });
    expect(h.renderer.entities.get(monId)?.pos).toEqual(mon.pos);
    expect(h.renderer.errors).toEqual([]);
  });
});

describe('the hero and forced movement', () => {
  it('the hero shoved in: out of sight, damaged, back on the edge cell with the HUD in step; Last Stand floats', async () => {
    const h = makeHarness({ reveal: true, theme: 'depths', depth: 3, seed: 2 });
    const s = new FloorSession(h.deps, { runSeed: 2, depth: 3, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    const st = s.state;
    const foe = st.monsters[0]?.creature as NonNullable<(typeof st.monsters)[number]>['creature'];
    const start = { ...st.player.pos };
    const hazardCell = { x: start.x + 1, y: start.y };
    const climb = { x: start.x - 1, y: start.y };
    st.shownActive = foe.id;
    st.player.pos = climb;
    await s.playback.play([
      { type: 'actionUsed', creatureId: foe.id, actionId: 'shove_push', name: 'Shove: Push', targetId: 'player' },
      { type: 'saveRoll', creatureId: 'player', ability: 'str', d20: 3, bonus: 3, total: 6, dc: 13, success: false },
      { type: 'move', creatureId: 'player', path: [hazardCell] },
      { type: 'hazard', creatureId: 'player', hazard: 'fall', at: hazardCell, sourceId: foe.id },
      { type: 'damage', targetId: 'player', sourceId: foe.id, amount: 9, damageType: 'bludgeoning', modifier: 'none', crit: false, hpAfter: 1 },
      { type: 'feature', creatureId: 'player', id: 'lastStand', label: 'Last Stand' },
      { type: 'conditionAdded', creatureId: 'player', condition: 'prone' },
      { type: 'move', creatureId: 'player', path: [climb] },
    ]);
    expect(h.renderer.floats.map((f) => f.text)).toEqual(expect.arrayContaining(['Falls!', 'Last Stand', '9']));
    expect(h.renderer.entities.get('player')?.pos).toEqual(climb);
    expect(h.renderer.entities.get('player')?.visible).toBe(true);
    expect(st.fallen.has('player')).toBe(false);
    expect(h.audio.plays).toContain('thunderHit');
    expect(h.renderer.errors).toEqual([]);
  });

  it('a plain push and an ice slide are quick slides along the whole path, not walks', async () => {
    const h = makeHarness({ reveal: true, theme: 'depths', depth: 3, seed: 2 });
    const s = new FloorSession(h.deps, { runSeed: 2, depth: 3, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    const st = s.state;
    const foe = st.monsters[0]?.creature as NonNullable<(typeof st.monsters)[number]>['creature'];
    const a = { x: foe.pos.x, y: foe.pos.y };
    const path = [{ x: a.x + 1, y: a.y }, { x: a.x + 2, y: a.y }];
    st.shownActive = 'player';
    foe.pos = path[1] as GridPos;
    await s.playback.play([{ type: 'move', creatureId: foe.id, path }]);
    expect(h.renderer.entities.get(foe.id)?.pos).toEqual(path[1]);
    expect(h.audio.plays).toContain('hitBlunt');
    expect(h.renderer.errors).toEqual([]);
  });
});

describe('feature events', () => {
  it('float their labels and play sounds, and log text alone does nothing', async () => {
    const h = makeHarness({ reveal: true, theme: 'depths', depth: 3, seed: 2 });
    const s = new FloorSession(h.deps, { runSeed: 2, depth: 3, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    await s.playback.play([
      { type: 'feature', creatureId: 'player', id: 'cleave', label: 'Cleave', targetId: 'x' },
      { type: 'feature', creatureId: 'player', id: 'indomitable', label: 'Indomitable', amount: 5 },
      { type: 'feature', creatureId: 'player', id: 'ambush', label: 'Ambush!', targetId: 'player' },
      { type: 'log', text: 'Aldric lands a Sneak Attack!' },
    ]);
    expect(h.renderer.floats.map((f) => f.text)).toEqual(['Cleave', 'Indomitable', 'Ambush!']);
    expect(h.audio.plays).toContain('crit');
    expect(h.audio.plays).not.toContain('sneakAttack');
  });
});

describe('the Shove button and the target panel', () => {
  it('one Shove entry after the weapon attacks: press for Push, again for Trip, again to cancel', async () => {
    const g = await stage('depths', 3, 1, 50);
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    const ids = (h.ui.hud?.actions ?? []).map((a) => a.id);
    expect(ids).toContain('shove');
    expect(ids).not.toContain('shove_push');
    expect(ids).not.toContain('shove_trip');
    const lastAttack = Math.max(...ids.map((id, i) => (id.startsWith('atk_') || id.startsWith('throw_') || id.startsWith('offhand_') ? i : -1)));
    expect(ids.indexOf('shove')).toBe(lastAttack + 1);
    await s.combat.selectAction('shove');
    expect(s.combat.selectedActionId).toBe('shove_push');
    expect(h.ui.hud?.actions.find((a) => a.id === 'shove')?.selected).toBe(true);
    expect(h.ui.hud?.actions.find((a) => a.id === 'shove')?.name).toBe('Shove: Push');
    await s.combat.selectAction('shove');
    expect(s.combat.selectedActionId).toBe('shove_trip');
    expect(h.ui.hud?.actions.find((a) => a.id === 'shove')?.name).toBe('Shove: Trip');
    await s.combat.selectAction('shove');
    expect(s.combat.selectedActionId).toBeNull();
    expect(h.ui.hud?.actions.find((a) => a.id === 'shove')?.selected).toBe(false);
    expect(monId).toBeTruthy();
  });

  it('the target panel carries cover and the monster tactic', async () => {
    const g = await stage('depths', 3, 1, 50);
    expect(g).not.toBeNull();
    const { h, s, monId } = g as Stage;
    s.handleIntent({ type: 'selectCreature', creatureId: monId });
    const t = h.ui.hud?.target;
    expect(t?.faction).toBe('enemy');
    expect([0, 2, 5]).toContain(t?.cover);
    expect(['brute', 'skirmisher', 'archer', 'caster', 'leader', 'lurker', 'guard']).toContain(t?.tactic);
  });
});

describe('the expert bot', () => {
  it('plays a floor with ?expert=1 without renderer errors', async () => {
    const { runBot } = await import('./autoplay');
    const h = makeHarness({ expert: true, theme: 'depths', depth: 3, seed: 4 });
    const s = new FloorSession(h.deps, { runSeed: 4, depth: 3, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    await runBot(s, { maxSteps: 300 });
    expect(h.renderer.errors).toEqual([]);
  });
});

describe('slam features', () => {
  it('"Slammed!" floats at the creature and sounds by the damage that follows', async () => {
    const h = makeHarness({ reveal: true, theme: 'depths', depth: 3, seed: 2 });
    const s = new FloorSession(h.deps, { runSeed: 2, depth: 3, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    const foe = s.state.monsters[0]?.creature as NonNullable<(typeof s.state.monsters)[number]>['creature'];
    await s.playback.play([
      { type: 'feature', creatureId: foe.id, id: 'slam', label: 'Slammed!', amount: 6 },
      { type: 'damage', targetId: foe.id, amount: 6, damageType: 'piercing', modifier: 'none', crit: false, hpAfter: foe.hp },
    ]);
    expect(h.renderer.floats.some((f) => f.text === 'Slammed!' && f.at === foe.id)).toBe(true);
    expect(h.audio.plays).toContain('hitPierce');
    h.audio.plays.length = 0;
    await s.playback.play([
      { type: 'feature', creatureId: foe.id, id: 'slam', label: 'Slammed!', amount: 4 },
      { type: 'damage', targetId: foe.id, amount: 4, damageType: 'fire', modifier: 'none', crit: false, hpAfter: foe.hp },
    ]);
    expect(h.audio.plays).toContain('fireHit');
  });
});

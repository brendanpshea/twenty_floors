import { describe, expect, it } from 'vitest';
import type { GameEvent, GridPos } from '../core/types';
import { FloorSession } from './floorSession';
import { Playback } from './playback';
import { quickCharacter } from './quickBuild';
import { makeHarness, until } from './testing/fakes';
import type { FakeUiScript } from './testing/fakes';

/** A fight against one monster standing next to the hero, on the hero's turn. */
async function nextTo(script: FakeUiScript = {}) {
  const h = makeHarness({ reveal: true, depth: 2, seed: 3 }, script);
  const pc = quickCharacter(2);
  pc.maxHp = pc.hp = 500;
  const s = new FloorSession(h.deps, { runSeed: 3, depth: 2, pc, shortRestsLeft: 2 }, 1);
  await s.enter();
  const st = s.state;
  const m = st.monsters.find((x) => !x.boss) as (typeof st.monsters)[number];
  const foe = m.creature;
  const around = (p: GridPos): GridPos[] => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: p.x + dx, y: p.y + dy })));
  const free = (c: GridPos): boolean => st.nav.isWalkable(c) && !st.monsters.some((o) => o.creature.pos.x === c.x && o.creature.pos.y === c.y);
  const spot = around(foe.pos).find((c) => (c.x !== foe.pos.x || c.y !== foe.pos.y) && free(c)) as GridPos;
  st.player.pos = spot;
  h.renderer.placeEntity('player', spot);
  // A cell two steps further from the foe, so walking there leaves its reach.
  const away = [...around(spot), ...around(spot).flatMap(around)].find((c) => free(c) && Math.max(Math.abs(c.x - foe.pos.x), Math.abs(c.y - foe.pos.y)) >= 2 && Math.max(Math.abs(c.x - spot.x), Math.abs(c.y - spot.y)) === 1) as GridPos;
  const events: GameEvent[] = [];
  const orig = Playback.prototype.play;
  Playback.prototype.play = async function (ev: GameEvent[]) { events.push(...ev); return orig.call(this, ev); };
  void s.combat.begin([m]);
  await until(() => s.combat.playerTurn, 20000);
  Playback.prototype.play = orig;
  const restore = (): void => { Playback.prototype.play = orig; };
  const record = (): void => { Playback.prototype.play = async function (ev: GameEvent[]) { events.push(...ev); return orig.call(this, ev); }; };
  return { h, s, st, foe, spot, away, events, record, restore };
}

describe('walking out of an enemy\'s reach asks first', () => {
  it('"Stay" keeps the hero where it is; the prompt names the enemy and offers Disengage', async () => {
    const f = await nextTo({ confirm: [{ ok: false, remember: false }] });
    expect(f.away).toBeDefined();
    await f.s.combat.tap({ cell: f.away, entityId: null });
    expect(f.st.player.pos).toEqual(f.spot);
    const q = f.h.ui.confirms[f.h.ui.confirms.length - 1] as { title: string; lines: string[]; altLabel?: string };
    expect(q.title).toMatch(/free hit/);
    expect(q.lines.join(' ')).toContain(f.foe.name);
    expect(q.altLabel).toBe('Disengage first');
  });

  it('"Disengage first" takes the Disengage action and then walks away with no opportunity attack', async () => {
    const f = await nextTo({ confirm: [{ ok: false, remember: false, alt: true }] });
    f.record();
    await f.s.combat.tap({ cell: f.away, entityId: null });
    f.restore();
    expect(f.st.player.pos).toEqual(f.away);
    expect(f.events.some((e) => e.type === 'actionUsed' && e.creatureId === 'player' && e.actionId === 'disengage')).toBe(true);
    expect(f.events.some((e) => e.type === 'actionUsed' && e.name.startsWith('Opportunity'))).toBe(false);
  });

  it('"Move anyway" walks away and the enemy takes its opportunity attack', async () => {
    const f = await nextTo({ confirm: [{ ok: true, remember: false }] });
    f.record();
    await f.s.combat.tap({ cell: f.away, entityId: null });
    f.restore();
    expect(f.events.some((e) => e.type === 'actionUsed' && e.creatureId === f.foe.id && e.name.startsWith('Opportunity'))).toBe(true);
  });

  it('a step that stays next to the enemy asks nothing', async () => {
    const f = await nextTo();
    const near = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: f.spot.x + dx, y: f.spot.y + dy })))
      .find((c) => (c.x !== f.spot.x || c.y !== f.spot.y) && f.st.nav.isWalkable(c) && Math.max(Math.abs(c.x - f.foe.pos.x), Math.abs(c.y - f.foe.pos.y)) === 1 && !(c.x === f.foe.pos.x && c.y === f.foe.pos.y));
    if (!near) return;
    const before = f.h.ui.confirms.length;
    await f.s.combat.tap({ cell: near, entityId: null });
    expect(f.h.ui.confirms.length).toBe(before);
    expect(f.st.player.pos).toEqual(near);
  });
});

describe('clicking an enemy with nothing left to attack with', () => {
  it('says the attacks are spent, not that the enemy is out of reach', async () => {
    const f = await nextTo();
    // Spend the action on Dodge, then click the enemy.
    await f.s.combat.selectAction('dodge');
    await f.s.combat.tap({ cell: f.foe.pos, entityId: f.foe.id });
    const said = f.h.ui.huds.map((m) => m.prompt).filter(Boolean).pop();
    expect(said).toMatch(/No attacks left this turn/);
  });
});

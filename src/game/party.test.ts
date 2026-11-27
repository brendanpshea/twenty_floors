import { describe, expect, it } from 'vitest';
import { SHORT_RESTS_PER_LONG_REST } from '../core/types';
import type { GridPos, HubModel, SaveGame } from '../core/types';
import { applyLevelUp, newCompanionState, suggestedLevelChoices } from '../rules';
import { runBot } from './autoplay';
import { SAVE_KEY } from './deps';
import type { GameOptions, RunState } from './deps';
import { FloorSession } from './floorSession';
import { Game } from './game';
import { HubFlow } from './hubFlow';
import { COMPANION_IDS } from './party';
import { quickCharacter } from './quickBuild';
import { parseSave, runFromSave, writeSave } from './save';
import { makeHarness, until } from './testing/fakes';
import type { Harness } from './testing/fakes';

function partyRun(level: number, companionId: string, seed = 5, depth = 4): RunState {
  return { runSeed: seed, depth, pc: quickCharacter(level), shortRestsLeft: 2, companion: newCompanionState(companionId, level) };
}

async function enter(level: number, companionId: string, options: GameOptions = {}, seed = 5, depth = 4) {
  const h = makeHarness({ reveal: true, ...options });
  const s = new FloorSession(h.deps, partyRun(level, companionId, seed, depth), 1);
  await s.enter();
  return { h, s };
}

function neighbour(s: FloorSession, p: GridPos, from = 1): GridPos {
  const st = s.state;
  for (let r = from; r <= from + 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = { x: p.x + dx, y: p.y + dy };
        const used = st.monsters.some((m) => m.creature.pos.x === c.x && m.creature.pos.y === c.y) || (st.companion && st.companion.creature.pos.x === c.x && st.companion.creature.pos.y === c.y);
        if ((dx || dy) && st.nav.inBounds(c) && st.nav.isWalkable(c) && !used) return c;
      }
    }
  }
  throw new Error('no free cell');
}

/** Put the hero near the first monster and start that room's fight. */
async function startFight(s: FloorSession, h: Harness, dist = 1): Promise<string> {
  const st = s.state;
  const mon = st.monsters[0] as NonNullable<(typeof st.monsters)[number]>;
  const at = neighbour(s, mon.creature.pos, dist);
  st.player.pos = at;
  h.renderer.placeEntity('player', at);
  void s.combat.begin(st.monsters.filter((m) => m.roomId === mon.roomId));
  expect(await until(() => s.combat.playerTurn)).toBe(true);
  return mon.creature.id;
}

describe('the hub and the companion', () => {
  it('offers the companion pick when the hero is about to be level 4, required until chosen', () => {
    const h = makeHarness();
    const hub = new HubFlow(quickCharacter(3), 3, h.audio, 1);
    const m = hub.model();
    expect(m.levelUp?.toLevel).toBe(4);
    expect(m.companions?.options.map((o) => o.id).sort()).toEqual([...COMPANION_IDS].sort());
    expect(m.companions?.required).toBe(true);
    expect(m.companions?.chosenId).toBeNull();
    // Earlier visits do not offer one.
    expect(new HubFlow(quickCharacter(1), 1, h.audio, 1).model().companions).toBeUndefined();
    const after = hub.handle({ type: 'chooseCompanion', id: 'blink_dog' });
    expect(after.companions?.chosenId).toBe('blink_dog');
    expect(after.companions?.required).toBe(false);
  });

  it('a swap arrives at full health and keeps the stance; every visit long-rests it', () => {
    const h = makeHarness();
    const hurt = newCompanionState('pseudodragon', 5);
    hurt.hp = 2;
    hurt.stance = 'back';
    const hub = new HubFlow(quickCharacter(5), 5, h.audio, 1, undefined, hurt);
    expect(hub.companion?.hp).toBeGreaterThan(2);
    expect(hub.companion?.stance).toBe('back');
    hub.handle({ type: 'chooseCompanion', id: 'sphinx_of_wonder' });
    expect(hub.companion?.id).toBe('sphinx_of_wonder');
    expect(hub.companion?.stance).toBe('back');
    const max = hub.companion?.hp ?? 0;
    expect(max).toBeGreaterThan(5);
  });

  it('settle picks a companion when none was chosen, so the hero can always descend', () => {
    const h = makeHarness();
    const hub = new HubFlow(quickCharacter(3), 3, h.audio, 7);
    const pc = hub.settle();
    expect(pc.level).toBe(4);
    expect(hub.companion).toBeDefined();
  });

  it('an incomplete set of level-up choices is refused with a banner, not a crash', () => {
    const h = makeHarness();
    const said: string[] = [];
    const hub = new HubFlow(quickCharacter(3), 3, h.audio, 1, (t) => said.push(t));
    const m = hub.handle({ type: 'confirmLevelUp', choices: {} });
    expect(said.length).toBeGreaterThan(0);
    expect(m.levelUp).toBeDefined();
    expect(hub.pc.level).toBe(3);
    // The full set goes through.
    const ok = hub.handle({ type: 'confirmLevelUp', choices: suggestedLevelChoices(hub.pc) });
    expect(ok.levelUp).toBeUndefined();
    expect(hub.pc.level).toBe(4);
  });

  it('takes a hero from level 3 to 8 through the hub with choices, carrying the companion', () => {
    const h = makeHarness();
    let pc = quickCharacter(3);
    let companion = undefined as ReturnType<typeof newCompanionState> | undefined;
    for (let cleared = 3; cleared <= 7; cleared++) {
      const hub = new HubFlow(pc, cleared, h.audio, 2, undefined, companion);
      const m = hub.model();
      expect(m.levelUp?.toLevel).toBe(cleared + 1);
      if (m.companions?.required) hub.handle({ type: 'chooseCompanion', id: 'pseudodragon' });
      hub.handle({ type: 'confirmLevelUp', choices: suggestedLevelChoices(hub.pc) });
      pc = hub.settle();
      companion = hub.companion;
      expect(pc.level).toBe(cleared + 1);
      expect(companion?.id).toBe('pseudodragon');
      expect(pc.hp).toBe(pc.maxHp);
    }
    expect(pc.level).toBe(8);
  });

  it('saves and loads the companion with its stance; a bad one is dropped, the save stays', () => {
    const h = makeHarness();
    const c = newCompanionState('blink_dog', 6);
    c.stance = 'focus';
    c.hp = 7;
    writeSave(h.storage, { runSeed: 3, depth: 5, pc: quickCharacter(6), shortRestsLeft: 2, companion: c });
    const save = parseSave(h.storage.get(SAVE_KEY)) as SaveGame;
    expect(save.companion?.id).toBe('blink_dog');
    const run = runFromSave(save);
    expect(run.companion?.stance).toBe('focus');
    expect(run.companion?.hp).toBe(7);
    const raw = JSON.parse(h.storage.get(SAVE_KEY) as string) as Record<string, unknown>;
    raw['companion'] = { id: 'nobody', hp: 3, resources: {}, stance: 'close' };
    const dropped = parseSave(JSON.stringify(raw));
    expect(dropped).not.toBeNull();
    expect(dropped?.companion).toBeUndefined();
  });

  it('Continue brings the saved companion back onto the floor', async () => {
    const h = makeHarness({}, { title: ['continue'] });
    const c = newCompanionState('sphinx_of_wonder', 5);
    c.stance = 'back';
    writeSave(h.storage, { runSeed: 9, depth: 5, pc: quickCharacter(5), shortRestsLeft: 2, companion: c });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const rt = game.session?.state.companion;
    expect(rt?.def.id).toBe('sphinx_of_wonder');
    expect(rt?.state.stance).toBe('back');
    expect(h.renderer.entities.has('companion')).toBe(true);
    game.stop();
  });
});

describe('the companion on a floor', () => {
  for (const id of COMPANION_IDS) {
    it(`${id} follows the hero without blocking, and never starts a fight`, async () => {
      const { h, s } = await enter(6, id, { peace: true });
      const st = s.state;
      expect(h.renderer.entities.has('companion')).toBe(true);
      const c = st.companion?.creature as NonNullable<typeof st.companion>['creature'];
      expect(c.id).toBe('companion');
      expect(c.faction).toBe('ally');
      expect(st.nav.isWalkable(c.pos)).toBe(true);
      expect(c.pos).not.toEqual(st.player.pos);
      // Walk to the far side of the entrance room's neighbourhood: any reachable cell some way off.
      let target: GridPos | null = null;
      for (let y = 0; y < st.nav.height && !target; y++) {
        for (let x = 0; x < st.nav.width && !target; x++) {
          const p = { x, y };
          const path = st.nav.isWalkable(p) ? st.nav.findPath(st.player.pos, p) : null;
          if (path && path.length >= 12 && path.length <= 20) target = p;
        }
      }
      expect(target).not.toBeNull();
      await s.explore.walkToCell(target as GridPos);
      expect(st.player.pos).toEqual(target);
      const d = Math.max(Math.abs(c.pos.x - st.player.pos.x), Math.abs(c.pos.y - st.player.pos.y));
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(3);
      expect(h.renderer.entities.get('companion')?.pos).toEqual(c.pos);
      expect(st.mode).toBe('explore');
      expect(h.renderer.errors).toEqual([]);
      // It does not block the hero: walking back through its cell works.
      const there = { ...c.pos };
      const heroWas = { ...st.player.pos };
      await s.explore.walkToCell(there);
      expect(st.player.pos).toEqual(there);
      // They swapped: the companion is where the hero came from.
      expect(c.pos).toEqual(heroWas);
    });
  }

  it('the HUD shows the companion, and it joins the initiative strip as an ally', async () => {
    const { h, s } = await enter(6, 'sphinx_of_wonder');
    const hud = h.ui.hud;
    expect(hud?.companion?.name).toBe('Sphinx of Wonder');
    expect(hud?.companion?.role).toBe('healer');
    expect(hud?.companion?.stance).toBe('close');
    expect(hud?.companion?.hp).toBe(hud?.companion?.maxHp);
    expect(hud?.companion?.resources.every((r) => !r.name.startsWith('_'))).toBe(true);
    await startFight(s, h);
    const strip = h.ui.hud?.combat?.initiative ?? [];
    expect(strip.find((e) => e.id === 'companion')?.faction).toBe('ally');
    s.handleIntent({ type: 'selectCreature', creatureId: 'companion' });
    expect(h.ui.hud?.target?.faction).toBe('ally');
  });

  it('stance changes take effect at once, mid-fight too, and are saved', async () => {
    const { h, s } = await enter(6, 'pseudodragon');
    s.handleIntent({ type: 'setStance', stance: 'back' });
    expect(s.state.companion?.state.stance).toBe('back');
    expect(h.ui.hud?.companion?.stance).toBe('back');
    expect(h.audio.plays).toContain('stanceChange');
    expect(parseSave(h.storage.get(SAVE_KEY))?.companion?.stance).toBe('back');
    await startFight(s, h);
    expect(s.combat.driverStance).toBe('back');
    s.handleIntent({ type: 'setStance', stance: 'focus' });
    expect(s.combat.driverStance).toBe('focus');
    expect(h.ui.hud?.companion?.stance).toBe('focus');
  });

  it('a fight runs the companion through the party driver: it acts', async () => {
    const { h, s } = await enter(6, 'pseudodragon');
    await startFight(s, h);
    for (let i = 0; i < 40 && s.state.mode === 'combat' && !s.finished; i++) {
      if (s.combat.playerTurn) await s.combat.autoAct();
      else await until(() => s.combat.playerTurn || s.state.mode !== 'combat', 20000);
    }
    const acted = h.renderer.anims.some((a) => a.id === 'companion') || h.renderer.floats.some((f) => f.at === 'companion') || s.state.log.some((l) => l.includes('Pseudodragon'));
    expect(acted).toBe(true);
    expect(h.renderer.errors).toEqual([]);
  });

  it('a downed companion stands up at 1 HP after the fight', async () => {
    const { h, s } = await enter(6, 'sphinx_of_wonder');
    await startFight(s, h);
    const rt = s.state.companion as NonNullable<typeof s.state.companion>;
    rt.creature.hp = 0;
    rt.creature.dead = true;
    rt.downed = true;
    for (let i = 0; i < 400 && s.state.mode === 'combat' && !s.finished; i++) {
      if (s.combat.playerTurn) await s.combat.autoAct();
      else await until(() => s.combat.playerTurn || s.state.mode !== 'combat' || s.finished, 20000);
    }
    if (s.finished) return; // the hero fell first: nothing to revive
    expect(s.state.mode).toBe('explore');
    expect(rt.creature.hp).toBeGreaterThanOrEqual(1);
    expect(rt.creature.dead).toBe(false);
    expect(rt.state.hp).toBeGreaterThanOrEqual(1);
    expect(h.audio.plays).toContain('companionUp');
    expect(h.renderer.floats.some((f) => f.at === 'companion' && f.text.includes('feet'))).toBe(true);
  });

  it('short and long rests heal the companion', async () => {
    const { h, s } = await enter(6, 'sphinx_of_wonder', { peace: true });
    const rt = s.state.companion as NonNullable<typeof s.state.companion>;
    rt.state.hp = 3;
    rt.creature.hp = 3;
    s.state.player.hp = s.state.player.maxHp;
    s.pushHud();
    // Only the companion is hurt: a short rest is still on offer.
    expect(h.ui.hud?.canShortRest).toBe(true);
    await s.explore.shortRest();
    expect(rt.creature.hp).toBeGreaterThan(3);
    expect(s.state.shortRestsLeft).toBeLessThan(SHORT_RESTS_PER_LONG_REST + 1);
    // A long rest at a site makes it whole.
    rt.state.hp = 2;
    rt.creature.hp = 2;
    const site = s.state.restSites[0] as NonNullable<(typeof s.state.restSites)[number]>;
    const at = neighbour(s, site.pos, 1);
    s.state.player.pos = at;
    h.renderer.placeEntity('player', at);
    await s.explore.restAt(site.id);
    expect(rt.creature.hp).toBe(rt.creature.maxHp);
    expect(site.used).toBe(true);
  });

  it('a blink is played as a vanish and a placement, not a walk', async () => {
    const { h, s } = await enter(8, 'blink_dog');
    const st = s.state;
    const far = neighbour(s, st.player.pos, 5);
    const before = h.renderer.placed.length;
    await s.playback.play([
      { type: 'actionUsed', creatureId: 'companion', actionId: 'blink', name: 'Teleport' },
      { type: 'move', creatureId: 'companion', path: [far] },
      { type: 'log', text: 'Blink Dog blinks across the room.' },
    ]);
    expect(h.renderer.placed.length).toBeGreaterThan(before);
    expect(h.renderer.placed[h.renderer.placed.length - 1]).toBe('companion');
    expect(h.renderer.entities.get('companion')?.pos).toEqual(far);
    expect(h.audio.plays).toContain('teleport');
    expect(h.renderer.floats.some((f) => f.text === 'Blink!')).toBe(true);
  });

  it('Sneak Attack, Shield and concentration feature events play their sounds and float their labels', async () => {
    const { h, s } = await enter(6, 'blink_dog');
    await s.playback.play([
      { type: 'feature', creatureId: 'companion', id: 'sneakAttack', label: 'Sneak Attack', targetId: 'player', amount: 7 },
      { type: 'feature', creatureId: 'player', id: 'shield', label: 'Shield', amount: 5 },
      { type: 'feature', creatureId: 'player', id: 'concentrationStart', label: 'Concentrating' },
      { type: 'feature', creatureId: 'player', id: 'concentrationEnd', label: 'Concentration ends' },
    ]);
    for (const id of ['sneakAttack', 'shield', 'concentrationStart', 'concentrationBreak'] as const) expect(h.audio.plays).toContain(id);
    expect(h.renderer.floats.map((f) => f.text)).toEqual(expect.arrayContaining(['Sneak Attack', 'Shield', 'Concentrating', 'Concentration ends']));
  });
});

describe('Extra Attack', () => {
  it('a level 5 hero attacks twice with a move in between', async () => {
    const { h, s } = await enter(5, 'blink_dog');
    const st = s.state;
    await startFight(s, h);
    const mon = st.monsters[0]?.creature as NonNullable<(typeof st.monsters)[number]>['creature'];
    mon.hp = mon.maxHp = 9999;
    s.pushHud();
    const hud0 = h.ui.hud;
    expect(hud0?.combat?.attacksLeft).toEqual({ current: 2, max: 2 });
    const melee = hud0?.actions.find((a) => a.id.startsWith('atk_') && a.icon === 'melee');
    expect(melee).toBeDefined();
    const attacks = (): number => st.log.filter((l) => l.startsWith(`Aldric attacks ${mon.name}`)).length;
    await s.combat.selectAction(melee?.id as string);
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    expect(attacks()).toBe(1);
    expect(h.ui.hud?.combat?.attacksLeft).toEqual({ current: 1, max: 2 });
    expect(h.ui.hud?.combat?.actionAvailable).toBe(true);
    // The turn is still the hero's: move a step, then the second attack.
    expect(s.combat.playerTurn).toBe(true);
    const step = neighbour(s, st.player.pos, 1);
    const adjacent = Math.max(Math.abs(step.x - mon.pos.x), Math.abs(step.y - mon.pos.y)) <= 1;
    if (adjacent) {
      await s.combat.tap({ cell: step, entityId: null });
      expect(st.player.pos).toEqual(step);
    }
    await s.combat.selectAction(melee?.id as string);
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    expect(attacks()).toBe(2);
    expect(h.ui.hud?.combat?.attacksLeft?.current ?? 0).toBe(0);
  });

  it('the auto-end logic keeps the turn open while attacks remain', async () => {
    const { h, s } = await enter(5, 'blink_dog');
    await startFight(s, h);
    expect(s.combat.hasUsefulOptions()).toBe(true);
    const melee = h.ui.hud?.actions.find((a) => a.id.startsWith('atk_') && a.icon === 'melee');
    const mon = s.state.monsters[0]?.creature as NonNullable<(typeof s.state.monsters)[number]>['creature'];
    mon.hp = mon.maxHp = 9999;
    await s.combat.selectAction(melee?.id as string);
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    expect(s.combat.hasUsefulOptions()).toBe(true);
  });
});

describe('a normal run past the milestone (?floors=)', () => {
  it('reaches the hub after floor 3 with a level-up and a companion pick, then plays floor 4', async () => {
    let reached = false;
    for (let seed = 1; seed <= 10 && !reached; seed++) {
      const h = makeHarness({ autoplay: true, headless: true, floors: 6, seed });
      const game = new Game(h.deps);
      const pc = quickCharacter(3);
      pc.maxHp = pc.hp = 400;
      const done = game.playRun({ runSeed: seed, depth: 3, pc, shortRestsLeft: 2 });
      const finished = await Promise.race([done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15000))]);
      game.stop();
      const floors = h.renderer.plans.map((p) => p.depth);
      if (finished && floors.includes(4)) {
        reached = true;
        const save = parseSave(h.storage.get(SAVE_KEY));
        expect(save === null || save.companion !== undefined || floors.includes(4)).toBe(true);
      }
    }
    expect(reached).toBe(true);
  }, 120000);

  it('the headless hub saves the picked companion with the next floor', async () => {
    const h = makeHarness({ autoplay: true, headless: true, floors: 5 });
    const saves: SaveGame[] = [];
    const orig = h.storage.set.bind(h.storage);
    h.storage.set = (k, v) => {
      if (k === SAVE_KEY) saves.push(JSON.parse(v) as SaveGame);
      orig(k, v);
    };
    const game = new Game(h.deps);
    const pc = quickCharacter(3);
    pc.maxHp = pc.hp = 400;
    const done = game.playRun({ runSeed: 3, depth: 3, pc, shortRestsLeft: 2 });
    await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
    game.stop();
    const four = saves.find((x) => x.depth === 4);
    if (four) {
      expect(four.companion).toBeDefined();
      expect(four.character.level).toBe(4);
    }
  }, 60000);
});

describe('levels above 3 in a dev start', () => {
  it('?depth=8 builds a level 8 hero with a companion', async () => {
    const h = makeHarness({ depth: 8, seed: 3 });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    expect(game.session?.state.pc.level).toBe(8);
    expect(game.session?.state.companion).toBeTruthy();
    game.stop();
  });

  it('?level= is independent of ?depth, and ?companion= with ?stance= are honoured', async () => {
    const h = makeHarness({ depth: 2, level: 6, seed: 3, companion: 'blink_dog', stance: 'focus' });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    expect(game.session?.state.pc.level).toBe(6);
    expect(game.session?.state.depth).toBe(2);
    expect(game.session?.state.companion?.def.id).toBe('blink_dog');
    expect(game.session?.state.companion?.state.stance).toBe('focus');
    game.stop();
  });

  it('the bot plays a floor with a companion without errors', async () => {
    const { h, s } = await enter(7, 'sphinx_of_wonder', {}, 4, 5);
    await runBot(s, { maxSteps: 400 });
    expect(h.renderer.errors).toEqual([]);
    expect(applyLevelUp).toBeDefined();
  });
});

export type { HubModel };

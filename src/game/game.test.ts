import { describe, expect, it } from 'vitest';
import { floorSeed } from '../core/rng';
import { MILESTONE_FLOORS, themeForDepth } from '../core/themes';
import type { HubIntent, HubModel, HudModel, SaveGame } from '../core/types';
import { runBot } from './autoplay';
import { SAVE_KEY } from './deps';
import type { RunState } from './deps';
import { FloorSession } from './floorSession';
import { Game } from './game';
import { parseSave } from './save';
import { makeHarness, until } from './testing/fakes';
import { quickCharacter } from './quickBuild';

function run(seed: number, depth = 1, level = depth): RunState {
  return { runSeed: seed, depth, pc: quickCharacter(level), shortRestsLeft: 2 };
}

function readSave(raw: string | null): SaveGame {
  const s = parseSave(raw);
  if (!s) throw new Error('no valid save');
  return s;
}

describe('new game', () => {
  it('enters floor 1 with the player at the entrance and writes a save', async () => {
    const h = makeHarness({ seed: 42 }, { title: ['new'] });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const s = game.session as FloorSession;
    const plan = h.renderer.plans[0];
    expect(plan?.seed).toBe(floorSeed(42, 1));
    expect(plan?.theme).toBe(themeForDepth(1));
    expect(s.state.player.pos).toEqual(plan?.entrance);
    expect(h.renderer.entities.get('player')?.pos).toEqual(plan?.entrance);
    const save = readSave(h.storage.get(SAVE_KEY));
    expect(save.depth).toBe(1);
    expect(save.runSeed).toBe(42);
    expect(save.shortRestsLeft).toBe(2);
    expect(h.ui.hud?.mode).toBe('explore');
    expect(h.ui.banners).toContain('Floor 1');
    // Monsters start hidden in the fog.
    for (const m of s.state.monsters) expect(h.renderer.entities.get(m.creature.id)?.visible).toBe(false);
    expect(h.renderer.errors).toEqual([]);
    game.stop();
  });

  it('treats corrupt or old saves as no save', () => {
    expect(parseSave('{not json')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 0 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, depth: 3 }))).toBeNull();
    expect(parseSave(null)).toBeNull();
  });
});

describe('autoplay bot', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`plays floor 1 of seed ${seed} to a conclusion`, async () => {
      const h = makeHarness({ reveal: seed % 2 === 0 });
      const session = new FloorSession(h.deps, run(seed), 1);
      await session.enter();
      const result = await runBot(session, { maxSteps: 6000 });
      expect(result).toBe('finished');
      const outcome = await session.outcome;
      expect(['cleared', 'dead']).toContain(outcome.type);
      expect(h.renderer.errors).toEqual([]);
      session.dispose();
      expect(h.renderer.entities.size).toBe(0);
      expect(h.renderer.errors).toEqual([]);
    });
  }

  it('keeps the HUD consistent through every fight', async () => {
    const h = makeHarness();
    let checked = 0;
    const bad: string[] = [];
    h.ui.onHud = (m: HudModel) => {
      if (m.mode !== 'combat' || !m.combat) return;
      checked++;
      if (m.combat.playerTurn && m.actions.length === 0) bad.push('no actions on the player turn');
      if (m.combat.playerTurn && !m.combat.initiative.some((e) => e.active && e.id === 'player')) bad.push('no active initiative entry');
      if (m.combat.initiative.length < 2) bad.push('initiative too short');
      if (m.player.resources.some((r) => r.name.startsWith('_'))) bad.push('hidden resource shown');
      if (m.player.hp < 0 || m.player.hp > m.player.maxHp) bad.push(`hp out of range: ${m.player.hp}`);
    };
    const session = new FloorSession(h.deps, run(3, 2, 2), 1);
    await session.enter();
    await runBot(session, { maxSteps: 6000 });
    expect(checked).toBeGreaterThan(5);
    expect(bad).toEqual([]);
    const hidden = Object.keys(session.state.player.resources).filter((k) => k.startsWith('_'));
    for (const hud of h.ui.huds) {
      for (const r of hud.player.resources) {
        for (const k of hidden) expect(r.name).not.toBe(session.state.player.resources[k]?.name);
      }
    }
  });
});

describe('death and retry', () => {
  it('restores the saved character and regenerates the identical floor', async () => {
    // A 1 HP level 1 hero on floor 3 does not survive its first fight.
    const h = makeHarness({ autoplay: true, headless: true }, { death: ['retry', 'quit'] });
    const game = new Game(h.deps);
    const pc = quickCharacter(1);
    pc.hp = 1;
    const end = await game.playRun({ runSeed: 7, depth: 3, pc, shortRestsLeft: 2 });
    expect(end).toBe('quit');
    expect(h.ui.deaths.length).toBe(2);
    expect(h.ui.deaths[0]?.depth).toBe(3);
    expect(h.renderer.plans.length).toBe(2);
    const [a, b] = h.renderer.plans;
    expect(a && b && Array.from(a.kinds)).toEqual(Array.from(b?.kinds ?? []));
    expect(a?.entrance).toEqual(b?.entrance);
    expect(a?.seed).toBe(b?.seed);
    // Quitting deletes the save.
    expect(h.storage.get(SAVE_KEY)).toBeNull();
    expect(h.renderer.errors).toEqual([]);
  });

  it('retry reloads the character exactly as saved', async () => {
    const h = makeHarness({ autoplay: true, headless: true }, { death: ['retry', 'quit'] });
    const game = new Game(h.deps);
    const pc = quickCharacter(1);
    pc.hp = 1;
    const saves: string[] = [];
    const origSet = h.storage.set.bind(h.storage);
    h.storage.set = (k, v) => {
      if (k === SAVE_KEY) saves.push(v);
      origSet(k, v);
    };
    await game.playRun({ runSeed: 7, depth: 3, pc, shortRestsLeft: 2 });
    expect(saves.length).toBe(2);
    expect(saves[0]).toBe(saves[1]);
    expect(readSave(saves[1] ?? null).character.hp).toBe(1);
  });
});

describe('floor cleared', () => {
  it('goes through the hub, applies the level-up and saves the next depth', async () => {
    const hubModels: HubModel[] = [];
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const h = makeHarness({ autoplay: true }, {
        death: ['quit'],
        hub: (m) => {
          const intents: HubIntent[] = [];
          if (m.levelUp) {
            const choices: Record<string, string> = {};
            for (const slot of m.levelUp.choices) {
              const o = slot.options[0];
              if (o) choices[slot.key] = o.id;
            }
            intents.push({ type: 'confirmLevelUp', choices });
          }
          return intents;
        },
      });
      const saves: SaveGame[] = [];
      const origSet = h.storage.set.bind(h.storage);
      h.storage.set = (k, v) => {
        if (k === SAVE_KEY) saves.push(readSave(v));
        origSet(k, v);
      };
      const game = new Game(h.deps);
      await game.playRun(run(seed));
      expect(h.renderer.errors).toEqual([]);
      if (h.ui.hubModels.length === 0) continue; // the hero died on floor 1; try another seed
      found = true;
      hubModels.push(...h.ui.hubModels);
      const first = hubModels[0] as HubModel;
      expect(first.nextDepth).toBe(2);
      expect(first.levelUp?.toLevel).toBe(2);
      expect(first.character.hp).toBe(first.character.maxHp);
      for (const s of first.character.inventory) expect(first.items[s.itemId]).toBeDefined();
      for (const id of Object.values(first.character.equipped)) if (id) expect(first.items[id]).toBeDefined();
      expect(first.shop.length).toBeGreaterThan(0);
      for (const e of first.shop) expect(e.affordable).toBe(first.character.gold >= e.price);
      const after = hubModels[1] as HubModel;
      expect(after.levelUp).toBeUndefined();
      expect(after.character.level).toBe(2);
      expect(saves[0]?.depth).toBe(1);
      expect(saves[1]?.depth).toBe(2);
      expect(saves[1]?.character.level).toBe(2);
      expect(saves.some((s) => s.depth === MILESTONE_FLOORS) || h.ui.deaths.length > 0).toBe(true);
    }
    expect(found).toBe(true);
  });
});

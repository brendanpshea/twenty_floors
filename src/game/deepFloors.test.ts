import { describe, expect, it } from 'vitest';
import { floorSeed } from '../core/rng';
import { MILESTONE_FLOORS, THEME_RANGE, TOTAL_FLOORS, planRunThemes } from '../core/themes';
import type { BuildPreset, GridPos } from '../core/types';
import { generateFloor } from '../gen';
import { getCreationOptions } from '../rules';
import type { RunState } from './deps';
import { SAVE_KEY } from './deps';
import { FloorSession } from './floorSession';
import { blockedAt } from './floorState';
import { Game } from './game';
import { quickBuild, quickCharacter } from './quickBuild';
import { floorTheme, runThemes } from './runPlan';
import { writeSave } from './save';
import { makeHarness, until } from './testing/fakes';

function run(seed: number, depth: number): RunState {
  return { runSeed: seed, depth, pc: quickCharacter(Math.min(depth, 3)), shortRestsLeft: 2 };
}

describe('randomized runs', () => {
  it('the theme sequence of a seed is stable and is the planner output', () => {
    for (const seed of [1, 2, 99, 123456]) {
      expect([...runThemes(seed)]).toEqual(planRunThemes(seed));
      expect([...runThemes(seed)]).toEqual([...runThemes(seed)]);
      expect(runThemes(seed)).toHaveLength(TOTAL_FLOORS);
      for (let d = 1; d <= TOTAL_FLOORS; d++) expect(floorTheme(seed, d)).toBe(planRunThemes(seed)[d - 1]);
    }
  });

  it('floors 1 to 3 keep their fixed themes, floor 20 is the lair, every theme fits its depth', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const plan = runThemes(seed);
      expect(plan.slice(0, 3)).toEqual(['warrens', 'crypt', 'depths']);
      expect(plan[19]).toBe('lair');
      plan.forEach((t, k) => {
        const [lo, hi] = THEME_RANGE[t];
        expect(k + 1).toBeGreaterThanOrEqual(lo);
        expect(k + 1).toBeLessThanOrEqual(hi);
      });
    }
  });

  it('two different seeds differ somewhere in floors 4 to 19', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = runThemes(seed).slice(3, 19);
      const b = runThemes(seed + 1000).slice(3, 19);
      expect(a).not.toEqual(b);
    }
  });

  it('floor N of a run is generated on the planned theme', async () => {
    for (const seed of [4, 5]) {
      const plan = runThemes(seed);
      for (const depth of [1, 3, 4, 6, 9, 13, 17, 20]) {
        const h = makeHarness();
        const s = new FloorSession(h.deps, run(seed, depth), 1);
        await s.enter();
        expect(h.renderer.plans[0]?.theme).toBe(plan[depth - 1]);
        expect(h.ui.banners).toContain(`Floor ${depth}`);
        expect(h.audio.ambience).toBe(plan[depth - 1]);
        s.dispose();
      }
    }
  });

  it('retry regenerates the identical floor on the same theme', async () => {
    const h = makeHarness({ autoplay: true, headless: true }, { death: ['retry', 'quit'] });
    const game = new Game(h.deps);
    const pc = quickCharacter(1);
    pc.hp = 1;
    await game.playRun({ runSeed: 31, depth: 8, pc, shortRestsLeft: 2 });
    const [a, b] = h.renderer.plans;
    expect(a && b).toBeTruthy();
    expect(a?.theme).toBe(runThemes(31)[7]);
    expect(b?.theme).toBe(a?.theme);
    expect(Array.from(b?.kinds ?? [])).toEqual(Array.from(a?.kinds ?? []));
    expect(b?.entrance).toEqual(a?.entrance);
    expect(b?.props).toEqual(a?.props);
  });

  it('Continue regenerates the saved floor on the planned theme and layout', async () => {
    const seed = 77;
    const depth = 11;
    const h = makeHarness({}, { title: ['continue'] });
    writeSave(h.storage, run(seed, depth));
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const plan = h.renderer.plans[0];
    const expected = generateFloor({ seed: floorSeed(seed, depth), depth, theme: runThemes(seed)[depth - 1] ?? 'lair' });
    expect(plan?.theme).toBe(runThemes(seed)[depth - 1]);
    expect(Array.from(plan?.kinds ?? [])).toEqual(Array.from(expected.kinds));
    expect(plan?.entrance).toEqual(expected.entrance);
    // The save does not carry the plan.
    expect(h.storage.get(SAVE_KEY)).not.toContain('"themes"');
    game.stop();
  });

  it('the hub names the next floor from the plan', async () => {
    const { HubFlow } = await import('./hubFlow');
    const { THEMES } = await import('../core/themes');
    const h = makeHarness();
    const seed = 6;
    for (const cleared of [3, 4, 8]) {
      const hub = new HubFlow(quickCharacter(2), cleared, h.audio, seed);
      expect(hub.model().nextThemeName).toBe(THEMES[runThemes(seed)[cleared] ?? 'lair'].name);
    }
  });
});

describe('dev access to deep floors', () => {
  it('?depth=20 starts on floor 20 even though the milestone is lower', async () => {
    expect(MILESTONE_FLOORS).toBeLessThan(20);
    const h = makeHarness({ depth: 20, seed: 5 });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    expect(game.session?.state.depth).toBe(20);
    expect(h.renderer.plans[0]?.theme).toBe('lair');
    game.stop();
  });

  it('?depth is clamped to 1..20', async () => {
    for (const [asked, got] of [[99, 20], [0, 1], [-4, 1]] as const) {
      const h = makeHarness({ depth: asked, seed: 5 });
      const game = new Game(h.deps);
      void game.boot();
      expect(await until(() => game.session?.entered === true)).toBe(true);
      expect(game.session?.state.depth).toBe(got);
      game.stop();
    }
  });

  it('?theme forces the theme on the dev floor only', async () => {
    const h = makeHarness({ depth: 12, theme: 'hell', seed: 5 });
    const s = new FloorSession(h.deps, run(5, 12), 1);
    await s.enter();
    expect(h.renderer.plans[0]?.theme).toBe('hell');
    // The next floor of the run is back on the plan.
    const h2 = makeHarness({ depth: 12, theme: 'hell', seed: 5 });
    const s2 = new FloorSession(h2.deps, run(5, 13), 1);
    await s2.enter();
    expect(h2.renderer.plans[0]?.theme).toBe(runThemes(5)[12]);
  });

  it('?peace=1 with ?reveal=1: everything is visible and no fight ever starts', async () => {
    const h = makeHarness({ depth: 9, seed: 3, reveal: true, peace: true });
    const s = new FloorSession(h.deps, run(3, 9), 1);
    await s.enter();
    const st = s.state;
    expect(st.monsters.length).toBeGreaterThan(0);
    for (const m of st.monsters) expect(h.renderer.entities.get(m.creature.id)?.visible).toBe(true);
    // Walk next to a monster (one we can actually reach: guards may stand in the way): peace keeps the fight away.
    const blocked = blockedAt(st);
    let near: GridPos | undefined;
    for (const m of st.monsters) {
      const t = m.creature.pos;
      near = [-1, 0, 1]
        .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: t.x + dx, y: t.y + dy })))
        .find((p) => (p.x !== t.x || p.y !== t.y) && st.nav.isWalkable(p) && !blocked(p) && st.nav.findPath(st.player.pos, p, { blocked }));
      if (near) break;
    }
    expect(near).toBeDefined();
    await s.explore.walkToCell(near as GridPos);
    // The way may cross the sealed stairs, where a walk stops; carry on from there.
    if (st.player.pos.x !== (near as GridPos).x || st.player.pos.y !== (near as GridPos).y) await s.explore.walkToCell(near as GridPos);
    expect(st.player.pos).toEqual(near);
    expect(st.mode).toBe('explore');
    expect(s.explore.combatTrigger()).toBeNull();
  });
});

describe('standing on the stairs', () => {
  it('descends when the hero is already on the open stairs', async () => {
    const h = makeHarness();
    const s = new FloorSession(h.deps, run(9, 1), 1);
    await s.enter();
    s.state.stairsOpen = true;
    s.state.player.pos = { ...s.state.plan.exit };
    await s.explore.walkToCell(s.state.plan.exit);
    expect((await s.outcome).type).toBe('cleared');
  });
});

describe('target cycling', () => {
  it('Tab walks the visible monsters nearest first and Shift+Tab goes back', async () => {
    const h = makeHarness({ reveal: true, peace: true });
    const s = new FloorSession(h.deps, run(2, 6), 1);
    await s.enter();
    const st = s.state;
    const alive = st.monsters.length;
    expect(alive).toBeGreaterThan(2);
    s.handleKey('Tab');
    const first = st.targetId;
    expect(first).not.toBeNull();
    s.handleKey('Tab');
    const second = st.targetId;
    expect(second).not.toBe(first);
    s.handleKey('Tab', true);
    expect(st.targetId).toBe(first);
    const seen = new Set<string | null>();
    for (let i = 0; i < alive; i++) {
      s.handleKey('Tab');
      seen.add(st.targetId);
    }
    expect(seen.size).toBe(alive);
    expect(h.ui.hud?.target).toBeDefined();
  });
});

describe('quickBuild', () => {
  it("follows the class's first preset", () => {
    const cls = getCreationOptions().classes.find((c) => c.id === 'fighter');
    const preset: BuildPreset | undefined = cls?.presets?.[0];
    const build = quickBuild();
    if (!preset) return;
    expect(build.baseAbilities).toEqual(preset.abilities);
    for (const [k, v] of Object.entries(preset.choices)) expect(build.choices[k]).toBe(v);
    // The background's +2 goes to the favoured option.
    const bg = getCreationOptions().backgrounds[0];
    const top = [...(bg?.abilityOptions ?? [])].sort((a, b) => rank(preset, a) - rank(preset, b))[0];
    expect(build.abilityIncreases[top as keyof typeof build.abilityIncreases]).toBe(2);
  });
});

function rank(p: BuildPreset, a: string): number {
  const i = (p.abilityPriority as string[]).indexOf(a);
  return i < 0 ? 99 : i;
}

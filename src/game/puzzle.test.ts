import { describe, expect, it } from 'vitest';
import type { GridPos, HelpMode, PuzzleResult } from '../core/types';
import { newSkill } from '../puzzles';
import { SAVE_KEY } from './deps';
import type { GameOptions, RunState } from './deps';
import { FloorSession } from './floorSession';
import { quickCharacter } from './quickBuild';
import { describeLoot, lootFor } from './puzzle';
import { parseSave, runFromSave, writeSave } from './save';
import { makeHarness, until } from './testing/fakes';
import type { FakeUiScript } from './testing/fakes';

const result = (grade: PuzzleResult['grade'], outcome: PuzzleResult['outcome'] = 'solved'): PuzzleResult => ({ outcome, grade, seconds: 30, mistakes: 0, hintsUsed: 0, moves: 0 });

function neighbour(s: FloorSession, p: GridPos): GridPos {
  const st = s.state;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = { x: p.x + dx, y: p.y + dy };
        if ((dx || dy) && st.nav.inBounds(c) && st.nav.isWalkable(c) && !st.monsters.some((m) => m.creature.pos.x === c.x && m.creature.pos.y === c.y)) return c;
      }
    }
  }
  throw new Error('no free cell');
}

async function floor(options: GameOptions = {}, script: FakeUiScript = {}, help: HelpMode = 'standard', seed = 5, depth = 3) {
  const h = makeHarness({ reveal: true, peace: true, ...options }, script);
  const run: RunState = { runSeed: seed, depth, pc: quickCharacter(3), shortRestsLeft: 2, help };
  const s = new FloorSession(h.deps, run, 1);
  await s.enter();
  return { h, s, run };
}

async function open(s: FloorSession, h: { renderer: { placeEntity(id: string, p: GridPos): void } }, index = 0): Promise<string> {
  const chest = s.state.chests[index] as NonNullable<(typeof s.state.chests)[number]>;
  s.state.player.pos = neighbour(s, chest.pos);
  h.renderer.placeEntity('player', s.state.player.pos);
  await s.explore.openChest(chest.id);
  return chest.id;
}

describe('chest lock puzzles', () => {
  it('the same chest gives the same puzzle on a retried floor', async () => {
    const a = await floor();
    await open(a.s, a.h);
    const b = await floor();
    await open(b.s, b.h);
    expect(a.h.ui.puzzles).toHaveLength(1);
    expect(b.h.ui.puzzles[0]?.spec).toEqual(a.h.ui.puzzles[0]?.spec);
    expect(b.h.ui.puzzles[0]?.rewards).toEqual(a.h.ui.puzzles[0]?.rewards);
    // A different chest on the floor gets a different spec.
    if (a.s.state.chests.length > 1) {
      await open(a.s, a.h, 1);
      expect(a.h.ui.puzzles[1]?.spec.seed).not.toBe(a.h.ui.puzzles[0]?.spec.seed);
    }
  });

  it('the grade goes to chestLoot, and the rewards preview is exactly what each grade pays', async () => {
    for (const grade of ['gold', 'silver', 'bronze'] as const) {
      const { h, s } = await floor({}, { puzzle: [result(grade)] });
      const chest = s.state.chests[0] as NonNullable<(typeof s.state.chests)[number]>;
      const before = s.state.pc.gold;
      const ordinary = Math.max(1, s.state.chests.filter((c) => !c.boss).length);
      const expected = lootFor(s.state.depth, () => s.state.floorRng.fork(`chest:${chest.id}`), grade, false, ordinary);
      await open(s, h);
      const req = h.ui.puzzles[0];
      expect(req?.rewards[grade]).toBe(describeLoot(expected));
      expect(Math.round((s.state.pc.gold - before) * 100) / 100).toBe(expected.gold);
      expect(h.ui.banners.some((b) => b.includes(`${expected.gold} gp`))).toBe(true);
    }
  });

  it('forcing the lock (skipped) pays the "none" grade', async () => {
    const { h, s } = await floor({}, { puzzle: [result('none', 'skipped')] });
    const chest = s.state.chests[0] as NonNullable<(typeof s.state.chests)[number]>;
    const ordinary = Math.max(1, s.state.chests.filter((c) => !c.boss).length);
    const expected = lootFor(s.state.depth, () => s.state.floorRng.fork(`chest:${chest.id}`), 'none', false, ordinary);
    const before = s.state.pc.gold;
    await open(s, h);
    expect(Math.round((s.state.pc.gold - before) * 100) / 100).toBe(expected.gold);
    expect(h.ui.banners.some((b) => b.startsWith('Forced open'))).toBe(true);
  });

  it('the rating is updated, kept through a floor retry, and saved with the run', async () => {
    const { h, s, run } = await floor({}, { puzzle: [result('gold')] });
    expect(run.puzzleSkill).toBeUndefined();
    await open(s, h);
    expect(run.puzzleSkill?.played).toBe(1);
    expect(run.puzzleSkill?.overall).toBeGreaterThan(newSkill().overall);
    writeSave(h.storage, { ...run, pc: s.entryCharacter });
    const loaded = runFromSave(parseSave(h.storage.get(SAVE_KEY)) as NonNullable<ReturnType<typeof parseSave>>);
    expect(loaded.puzzleSkill).toEqual(run.puzzleSkill);
  });

  it('an old save without a rating loads, and a damaged one is dropped', () => {
    const h = makeHarness();
    const base = { version: 1, runSeed: 1, depth: 2, character: quickCharacter(2), shortRestsLeft: 2 };
    expect(parseSave(JSON.stringify(base))?.depth).toBe(2);
    expect(runFromSave(parseSave(JSON.stringify(base)) as NonNullable<ReturnType<typeof parseSave>>).puzzleSkill).toBeUndefined();
    const broken = parseSave(JSON.stringify({ ...base, puzzleSkill: { overall: 'x' } }));
    expect(broken).not.toBeNull();
    expect(runFromSave(broken as NonNullable<typeof broken>).puzzleSkill).toBeUndefined();
    expect(h.storage.get(SAVE_KEY)).toBeNull();
  });

  it('the bot never sees a puzzle and is paid silver, the old instant-open chest', async () => {
    const { h, s } = await floor({ autoplay: true, headless: true });
    const chest = s.state.chests[0] as NonNullable<(typeof s.state.chests)[number]>;
    const ordinary = Math.max(1, s.state.chests.filter((c) => !c.boss).length);
    const expected = lootFor(s.state.depth, () => s.state.floorRng.fork(`chest:${chest.id}`), 'silver', false, ordinary);
    const before = s.state.pc.gold;
    await open(s, h);
    expect(h.ui.puzzles).toHaveLength(0);
    expect(Math.round((s.state.pc.gold - before) * 100) / 100).toBe(expected.gold);
  });

  it('the floor holds still while the puzzle is open: no input reaches it', async () => {
    let release: (r: PuzzleResult) => void = () => undefined;
    const { h, s } = await floor();
    h.ui.playPuzzle = () => new Promise<PuzzleResult>((r) => {
      release = r;
    });
    const chest = s.state.chests[0] as NonNullable<(typeof s.state.chests)[number]>;
    s.state.player.pos = neighbour(s, chest.pos);
    h.renderer.placeEntity('player', s.state.player.pos);
    const opening = s.explore.openChest(chest.id);
    expect(await until(() => s.explore.puzzleOpen)).toBe(true);
    const at = { ...s.state.player.pos };
    s.handlePick({ cell: neighbour(s, at), entityId: null });
    s.handleIntent({ type: 'shortRest' });
    expect(s.acceptsKeys).toBe(false);
    expect(s.state.player.pos).toEqual(at);
    release(result('bronze'));
    await opening;
    expect(s.explore.puzzleOpen).toBe(false);
    expect(chest.opened).toBe(true);
  });

  it('the boss chest request is a boss chest, named for the boss', async () => {
    const depth = 8;
    const h = makeHarness({ reveal: true, depth, seed: 3 });
    const pc = quickCharacter(depth);
    pc.maxHp = pc.hp = 3000;
    const s = new FloorSession(h.deps, { runSeed: 3, depth, pc, shortRestsLeft: 2 }, 1);
    await s.enter();
    const st = s.state;
    const boss = st.monsters.find((m) => m.boss) as NonNullable<(typeof st.monsters)[number]>;
    boss.creature.dead = true;
    boss.creature.hp = 0;
    st.chests.push({ id: 'chest_boss', pos: neighbour(s, boss.creature.pos), opened: false, boss: true });
    h.renderer.spawnEntity('chest_boss', { model: 'chest_boss' }, st.chests[st.chests.length - 1]?.pos as GridPos);
    st.player.pos = neighbour(s, st.chests[st.chests.length - 1]?.pos as GridPos);
    h.renderer.placeEntity('player', st.player.pos);
    await s.explore.openChest('chest_boss');
    const req = h.ui.puzzles[0];
    expect(req?.boss).toBe(true);
    expect(req?.title).toContain(boss.creature.name);
  });

  it('?puzzle= and ?puzzlelevel= force the kind and the difficulty', async () => {
    const { h, s } = await floor({ puzzle: 'wards', puzzleLevel: 7 });
    await open(s, h);
    expect(h.ui.puzzles[0]?.spec.kind).toBe('wards');
    expect(h.ui.puzzles[0]?.spec.difficulty).toBe(7);
  });

  it('guided help gives one word about locks before the first chest opens; standard stays quiet', async () => {
    const g = await floor({}, {}, 'guided');
    await open(g.s, g.h);
    expect(g.h.ui.hints.map((x) => x.id)).toContain('chestLock');
    const t = g.h.ui.hints.find((x) => x.id === 'chestLock');
    expect(t?.text).toContain('Solve the lock');
    const st = await floor({}, {}, 'standard');
    await open(st.s, st.h);
    expect(st.h.ui.hints.map((x) => x.id)).not.toContain('chestLock');
  });
});

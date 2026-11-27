import { describe, expect, it } from 'vitest';
import { newCompanionState } from '../rules';
import { FloorSession } from './floorSession';
import { quickCharacter } from './quickBuild';
import { makeHarness, until } from './testing/fakes';

async function bossFight(depth = 8, seed = 3) {
  const h = makeHarness({ reveal: true, depth, seed });
  const pc = quickCharacter(depth);
  pc.maxHp = pc.hp = 2000;
  const s = new FloorSession(h.deps, { runSeed: seed, depth, pc, shortRestsLeft: 2, companion: newCompanionState('sphinx_of_wonder', pc.level) }, 1);
  await s.enter();
  const st = s.state;
  const boss = st.monsters.find((m) => m.boss);
  if (!boss) throw new Error('no boss on the floor');
  const mons = st.monsters.filter((m) => m.roomId === boss.roomId);
  const at = { x: boss.creature.pos.x, y: boss.creature.pos.y + 3 };
  const spot = [at, { x: at.x + 1, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x, y: at.y - 1 }].find((c) => st.nav.isWalkable(c)) ?? st.plan.entrance;
  st.player.pos = spot;
  h.renderer.placeEntity('player', spot);
  void s.combat.begin(mons);
  expect(await until(() => s.combat.playerTurn)).toBe(true);
  return { h, s, boss };
}

describe('legendary actions on screen and the boss marker', () => {
  it('a legendary action is a distinct beat: its name as a warning float, an accent sound', async () => {
    const h = makeHarness({ reveal: true, depth: 8, seed: 3 });
    const s = new FloorSession(h.deps, { runSeed: 3, depth: 8, pc: quickCharacter(3), shortRestsLeft: 2 }, 1);
    await s.enter();
    const boss = s.state.monsters.find((m) => m.boss)?.creature as NonNullable<unknown> as { id: string; name: string };
    await s.playback.play([
      { type: 'actionUsed', creatureId: boss.id, actionId: 'x', name: 'Legendary action: Slam', targetId: 'player' },
      { type: 'feature', creatureId: boss.id, id: 'legendaryAction', label: 'Slam', targetId: 'player' },
      { type: 'feature', creatureId: boss.id, id: 'legendaryResistance', label: 'Legendary Resistance (2 left)', amount: 2 },
    ]);
    expect(h.renderer.floats).toContainEqual({ text: 'Slam', style: 'crit', at: boss.id });
    expect(h.renderer.floats).toContainEqual({ text: 'Legendary Resistance (2 left)', style: 'crit', at: boss.id });
    expect(h.audio.plays).toContain('crit');
  });

  it('the first round says who the boss is and the target panel calls it the floor boss', async () => {
    const { h, s, boss } = await bossFight();
    expect(h.ui.huds.some((m) => m.prompt === `Boss: ${boss.creature.name}`)).toBe(true);
    s.handleIntent({ type: 'selectCreature', creatureId: boss.creature.id });
    expect(h.ui.hud?.target?.description?.startsWith('Floor boss.')).toBe(true);
    // An ordinary monster is not marked.
    const other = s.state.monsters.find((m) => !m.boss);
    if (other) {
      s.handleIntent({ type: 'selectCreature', creatureId: other.creature.id });
      expect(h.ui.hud?.target?.description?.startsWith('Floor boss.') ?? false).toBe(false);
    }
  });

});

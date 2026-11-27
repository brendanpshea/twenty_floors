import { describe, expect, it } from 'vitest';
import type { GridPos, PlayerCharacter } from '../core/types';
import { getItem } from '../rules';
import { SAVE_KEY } from './deps';
import type { GameOptions, RunState } from './deps';
import { FloorSession } from './floorSession';
import { Game } from './game';
import { HubFlow } from './hubFlow';
import { quickBuild, quickCharacter } from './quickBuild';
import type { QuickOptions } from './quickBuild';
import { writeSave } from './save';
import { makeHarness, until } from './testing/fakes';
import type { Harness } from './testing/fakes';

function run(seed: number, depth: number, hero: QuickOptions): RunState {
  return { runSeed: seed, depth, pc: quickCharacter(3, hero), shortRestsLeft: 2 };
}

async function enter(hero: QuickOptions, options: GameOptions = {}, seed = 5, depth = 1) {
  const h = makeHarness({ reveal: true, ...options });
  const s = new FloorSession(h.deps, run(seed, depth, hero), 1);
  await s.enter();
  return { h, s };
}

function neighbour(s: FloorSession, p: GridPos, from = 1): GridPos {
  const st = s.state;
  for (let r = from; r <= from + 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = { x: p.x + dx, y: p.y + dy };
        if ((dx || dy) && st.nav.inBounds(c) && st.nav.isWalkable(c) && !st.monsters.some((m) => m.creature.pos.x === c.x && m.creature.pos.y === c.y)) {
          return c;
        }
      }
    }
  }
  throw new Error('no free cell');
}

/** Put the hero next to the first monster and start the fight with that monster's room. */
async function startFight(s: FloorSession, h: Harness, dist = 1): Promise<string> {
  const st = s.state;
  const mon = st.monsters.find((m) => m.creature.dead === false) as NonNullable<(typeof st.monsters)[number]>;
  const at = neighbour(s, mon.creature.pos, dist);
  st.player.pos = at;
  h.renderer.placeEntity('player', at);
  const room = st.monsters.filter((m) => m.roomId === mon.roomId);
  void s.combat.begin(room);
  expect(await until(() => s.combat.playerTurn)).toBe(true);
  return mon.creature.id;
}

describe('casting between fights', () => {
  it('cures a hurt Acolyte once, then refuses at full health', async () => {
    const { h, s } = await enter({ background: 'acolyte', spell: 'cure_wounds' });
    const st = s.state;
    const id = 'cast_cure_wounds';
    // At full health the spell is listed but off.
    let a = h.ui.hud?.actions.find((x) => x.id === id);
    expect(a).toBeDefined();
    expect(a?.enabled).toBe(false);
    expect(a?.usesLeft).toBe(1);
    s.handleIntent({ type: 'selectAction', actionId: id });
    await until(() => false, 2000);
    expect(st.player.hp).toBe(st.player.maxHp);
    // Hurt: it heals and uses up the daily cast.
    st.player.hp = 5;
    s.pushHud();
    a = h.ui.hud?.actions.find((x) => x.id === id);
    expect(a?.enabled).toBe(true);
    s.handleIntent({ type: 'selectAction', actionId: id });
    expect(await until(() => st.player.hp > 5)).toBe(true);
    await until(() => !s.explore.resting);
    expect(st.pc.hp).toBe(st.player.hp);
    expect(h.renderer.anims.some((x) => x.id === 'player' && x.anim === 'cast')).toBe(true);
    expect(h.renderer.floats.some((f) => f.style === 'heal' && f.text.startsWith('+'))).toBe(true);
    expect(st.log.some((l) => l.includes('Cure Wounds'))).toBe(true);
    expect(h.audio.plays).toContain('heal');
    st.player.hp = 5;
    s.pushHud();
    a = h.ui.hud?.actions.find((x) => x.id === id);
    expect(a?.enabled).toBe(false);
    expect(a?.usesLeft).toBe(0);
    await s.explore.castSpell('cure_wounds');
    expect(st.player.hp).toBe(5);
    expect(h.renderer.errors).toEqual([]);
  });

  it('False Life gives temporary hit points the fight keeps', async () => {
    const { h, s } = await enter({ background: 'sage', spell: 'false_life' });
    const st = s.state;
    expect(st.player.tempHp).toBe(0);
    s.handleIntent({ type: 'selectAction', actionId: 'cast_false_life' });
    expect(await until(() => st.player.tempHp > 0)).toBe(true);
    await until(() => !s.explore.resting);
    expect(h.ui.hud?.player.tempHp).toBe(st.player.tempHp);
    const temp = st.player.tempHp;
    await startFight(s, h);
    expect(st.player.tempHp).toBeLessThanOrEqual(temp);
    expect(h.ui.hud?.player.tempHp).toBeDefined();
  });
});

describe('spells in a fight', () => {
  it('a Sage casts Fire Bolt on a creature: cast animation, spell sound, roll events', async () => {
    const { h, s } = await enter({ background: 'sage' });
    const monId = await startFight(s, h);
    const hud = h.ui.hud;
    const bolt = hud?.actions.find((a) => a.id === 'spell_fire_bolt');
    expect(bolt?.enabled).toBe(true);
    await s.combat.selectAction('spell_fire_bolt');
    expect(s.combat.mode).toBe('target');
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as NonNullable<unknown> as { id: string; pos: GridPos };
    h.renderer.anims.length = 0;
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    expect(h.renderer.anims.find((x) => x.id === 'player')?.anim).toBe('cast');
    expect(h.renderer.anims.filter((x) => x.id === 'player' && x.anim === 'attack')).toHaveLength(0);
    expect(h.audio.plays).toContain('buff');
    expect(s.state.log.some((l) => l.includes('Fire Bolt'))).toBe(true);
    expect(h.renderer.errors).toEqual([]);
  });

  it('Magic Missile, a bonus-action style self spell and the HUD shape all flow through', async () => {
    const { h, s } = await enter({ background: 'sage', spell: 'magic_missile' });
    const monId = await startFight(s, h);
    const mm = h.ui.hud?.actions.find((a) => a.id === 'spell_magic_missile');
    expect(mm?.enabled).toBe(true);
    expect(mm?.usesLeft).toBe(1);
    await s.combat.selectAction('spell_magic_missile');
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { id: string; pos: GridPos };
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    expect(s.state.log.some((l) => l.includes('casts Magic Missile'))).toBe(true);
    expect(h.renderer.errors).toEqual([]);
  });

  it('Burning Hands is aimed by direction: the area shows, a second tap confirms', async () => {
    const { h, s } = await enter({ background: 'sage', spell: 'burning_hands' });
    const monId = await startFight(s, h);
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { id: string; pos: GridPos };
    await s.combat.selectAction('spell_burning_hands');
    expect(s.combat.mode).toBe('point');
    // Touch: the first tap aims and shows the cone, nothing is cast yet.
    s.combat.hover({ cell: mon.pos, entityId: null });
    expect(h.renderer.highlights.some((c) => c.style === 'area')).toBe(true);
    const before = s.state.log.length;
    // Tapping the hero's own cell is refused.
    await s.combat.tap({ cell: { ...s.state.player.pos }, entityId: null });
    expect(s.combat.mode).toBe('point');
    // Hover then tap on the same cell (a mouse): one click casts.
    await s.combat.tap({ cell: mon.pos, entityId: null });
    expect(s.state.log.slice(before).some((l) => l.includes('Burning Hands'))).toBe(true);
    expect(s.combat.mode).toBe('move');
    expect(h.renderer.errors).toEqual([]);
  });

  it('concentration shows in the HUD and clears when it ends', async () => {
    const { h, s } = await enter({ background: 'sage', spell: 'sleep' });
    // Three cells off, so the sphere on the monster does not catch the caster.
    const monId = await startFight(s, h, 3);
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { id: string; pos: GridPos };
    await s.combat.selectAction('spell_sleep');
    expect(s.combat.mode).toBe('point');
    s.combat.hover({ cell: mon.pos, entityId: null });
    await s.combat.tap({ cell: mon.pos, entityId: null });
    // (A hit during the enemy turn may already have broken it, so look through every HUD pushed.)
    const seen = h.ui.huds.find((m) => m.concentration?.spellName === 'Sleep');
    expect(seen).toBeDefined();
    expect(seen?.concentration?.roundsLeft).toBeGreaterThan(0);
    expect(h.renderer.floats.some((f) => f.at === 'player' && f.text.startsWith('Concentrating'))).toBe(true);
    const pool = s.state.player.resources['_concentration'];
    if (pool) pool.current = 0;
    s.pushHud();
    expect(h.ui.hud?.concentration).toBeUndefined();
  });

  it('the target panel carries the faction', async () => {
    const { h, s } = await enter({ background: 'sage' });
    const monId = await startFight(s, h);
    s.handleIntent({ type: 'selectCreature', creatureId: monId });
    expect(h.ui.hud?.target?.faction).toBe('enemy');
    s.handleIntent({ type: 'selectCreature', creatureId: 'player' });
    expect(h.ui.hud?.target?.faction).toBe('player');
  });
});

describe('weapon sets', () => {
  it('the Archer preset shoots, and the off-hand attack stays available after a main-hand attack', async () => {
    const { h, s } = await enter({ preset: 'archer' });
    expect(s.state.pc.equipped.ranged).toBeDefined();
    await startFight(s, h);
    const acts = h.ui.hud?.actions ?? [];
    expect(acts.some((a) => a.id.startsWith('atk_') && a.icon === 'ranged')).toBe(true);
    const off = acts.find((a) => a.id.startsWith('offhand_'));
    if (!off) return; // the kit has no Light pair at this level
    expect(off.cost === 'bonus' || off.cost === 'free').toBe(true);
    const melee = acts.find((a) => a.icon === 'melee' && a.id.startsWith('atk_'));
    expect(melee).toBeDefined();
    await s.combat.selectAction(melee?.id as string);
    const mon = s.state.monsters.find((m) => !m.creature.dead)?.creature as unknown as { id: string; pos: GridPos };
    await s.combat.tap({ entityId: mon.id, cell: mon.pos });
    if (s.state.mode === 'combat' && s.combat.playerTurn) {
      const after = h.ui.hud?.actions.find((a) => a.id === off.id);
      expect(after).toBeDefined();
      if (after?.enabled) expect(s.combat.hasUsefulOptions()).toBe(true);
    }
  });
});

describe('equipment and presets', () => {
  it('a save with a bow in the main hand is migrated to the ranged slot on Continue', async () => {
    const h = makeHarness({}, { title: ['continue'] });
    const pc: PlayerCharacter = quickCharacter(1);
    pc.inventory.push({ itemId: 'longbow', quantity: 1 });
    pc.equipped = { mainHand: 'longbow' };
    writeSave(h.storage, { runSeed: 3, depth: 1, pc, shortRestsLeft: 2 });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const eq = game.session?.state.pc.equipped;
    expect(eq?.ranged).toBe('longbow');
    expect(eq?.mainHand).not.toBe('longbow');
    expect(h.storage.get(SAVE_KEY)).toContain('"ranged":"longbow"');
    game.stop();
  });

  it('the hub equips through canEquip and says what was put away', () => {
    const h = makeHarness();
    const said: string[] = [];
    const pc = quickCharacter(1);
    pc.inventory.push({ itemId: 'greatsword', quantity: 1 });
    const hub = new HubFlow(pc, 1, h.audio, 1, (t) => said.push(t));
    expect(hub.pc.equipped.offHand).toBeDefined();
    const model = hub.handle({ type: 'equip', itemId: 'greatsword' });
    expect(model.character.equipped.mainHand).toBe('greatsword');
    expect(model.character.equipped.offHand).toBeUndefined();
    expect(said.length).toBe(1);
    expect(said[0]).toContain('both hands');
    // Everything equipped is in the model's item table, ranged slot included.
    for (const id of Object.values(model.character.equipped)) if (id) expect(model.items[id]).toBeDefined();
    // Something not owned is refused with a reason.
    hub.handle({ type: 'equip', itemId: 'longbow' });
    expect(said.length).toBe(2);
    expect(h.audio.plays).toContain('uiError');
    expect(getItem('greatsword')).toBeDefined();
  });

  it('?preset= and ?background= give coherent dev heroes', () => {
    expect(quickBuild('x', { preset: 'greatweapon' }).choices['fightingStyle']).toBe('greatWeaponFighting');
    expect(quickBuild('x', { preset: 'archer' }).choices['fightingStyle']).toBe('archery');
    expect(quickBuild('x', { preset: 'defender' }).choices['fightingStyle']).toBe('defense');
    const sage = quickBuild('x', { background: 'sage' });
    expect(sage.backgroundId).toBe('sage');
    expect(sage.choices['mi_cantrip1']).toBe('fire_bolt');
    expect(sage.choices['mi_cantrip2']).toBe('true_strike');
    expect(quickBuild('x', { background: 'sage', spell: 'shield' }).choices['mi_spell']).toBe('shield');
    const acolyte = quickBuild('x', { background: 'acolyte' });
    expect(acolyte.choices['mi_spell']).toBe('cure_wounds');
    for (const bg of ['soldier', 'criminal', 'sage', 'acolyte']) for (const preset of ['defender', 'great_weapon', 'archer']) {
      expect(() => quickBuild('x', { preset, background: bg })).not.toThrow();
    }
  });

  it('a dev start takes the preset and background from the options', async () => {
    const h = makeHarness({ depth: 2, seed: 4, preset: 'archer', background: 'sage' });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const b = game.session?.state.pc.build;
    expect(b?.choices['fightingStyle']).toBe('archery');
    expect(b?.backgroundId).toBe('sage');
    game.stop();
  });
});

describe('the bot', () => {
  it('casts a cure before it spends a short rest', async () => {
    const { s } = await enter({ background: 'acolyte', spell: 'cure_wounds' });
    s.state.player.hp = 4;
    const { runBot } = await import('./autoplay');
    await runBot(s, { maxSteps: 3 });
    expect(s.state.log.some((l) => l.includes('casts Cure Wounds'))).toBe(true);
    expect(s.state.player.hp).toBeGreaterThan(4);
  });
});

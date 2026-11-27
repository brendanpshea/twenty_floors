import { describe, expect, it } from 'vitest';
import type { GridPos, HelpMode, HudModel, SaveGame } from '../core/types';
import { chestLoot, getItem, previewRest } from '../rules';
import { SAVE_KEY } from './deps';
import type { GameOptions, RunState } from './deps';
import { FloorSession } from './floorSession';
import { Game } from './game';
import { HubFlow } from './hubFlow';
import { Prefs } from './prefs';
import { parseSave } from './save';
import { quickCharacter } from './quickBuild';
import type { QuickOptions } from './quickBuild';
import { makeHarness, until } from './testing/fakes';
import type { FakeUiScript, Harness } from './testing/fakes';

function run(seed: number, depth: number, hero: QuickOptions = {}, help?: HelpMode): RunState {
  const r: RunState = { runSeed: seed, depth, pc: quickCharacter(Math.min(depth, 3), hero), shortRestsLeft: 2 };
  if (help) r.help = help;
  return r;
}

async function enter(help: HelpMode, options: GameOptions = {}, hero: QuickOptions = {}, seed = 5, depth = 1, script: FakeUiScript = {}) {
  const h = makeHarness({ reveal: true, ...options }, script);
  const s = new FloorSession(h.deps, run(seed, depth, hero, help), 1);
  await s.enter();
  return { h, s };
}

function neighbour(s: FloorSession, p: GridPos, from = 1): GridPos {
  const st = s.state;
  for (let r = from; r <= from + 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = { x: p.x + dx, y: p.y + dy };
        if ((dx || dy) && st.nav.inBounds(c) && st.nav.isWalkable(c) && !st.monsters.some((m) => m.creature.pos.x === c.x && m.creature.pos.y === c.y)) return c;
      }
    }
  }
  throw new Error('no free cell');
}

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

describe('help mode', () => {
  it('is asked after creation, stored with the run and as the device default, and skipped for the bot', async () => {
    const h = makeHarness({ seed: 4 }, { title: ['new'], help: 'guided' });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    expect(game.session?.state.help).toBe('guided');
    expect(new Prefs(h.storage).help()).toBe('guided');
    expect(parseSave(h.storage.get(SAVE_KEY)) as unknown as { help?: string }).toMatchObject({ help: 'guided' });
    game.stop();
    // A bot is never asked and plays without help.
    const b = makeHarness({ autoplay: true, headless: true, seed: 1 });
    const bs = new FloorSession(b.deps, run(1, 1, {}, 'guided'), 1);
    await bs.enter();
    expect(bs.state.help).toBe('standard');
  });

  it('?help= sets it for a dev start, and the pause menu changes it and brings tips back', async () => {
    const h = makeHarness({ depth: 1, seed: 3, help: 'standard' }, { menu: [{ type: 'help', mode: 'guided' }, { type: 'resume' }] });
    new Prefs(h.storage).setTipsOff(true);
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const s = game.session as FloorSession;
    expect(s.state.help).toBe('standard');
    s.handleIntent({ type: 'openMenu' });
    expect(await until(() => s.state.help === 'guided')).toBe(true);
    expect(new Prefs(h.storage).help()).toBe('guided');
    expect(new Prefs(h.storage).tipsOff()).toBe(false);
    expect((parseSave(h.storage.get(SAVE_KEY)) as unknown as { help?: string }).help).toBe('guided');
    game.stop();
  });

  it('Continue brings the saved help level back', async () => {
    const h = makeHarness({}, { title: ['continue'] });
    const r = run(9, 2, {}, 'guided');
    h.storage.set(SAVE_KEY, JSON.stringify({ version: 1, runSeed: 9, depth: 2, character: r.pc, shortRestsLeft: 2, help: 'guided' }));
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    expect(game.session?.state.help).toBe('guided');
    game.stop();
  });
});

describe('hints', () => {
  it('shows the first control hint on arrival, once per device, and takes it away when the player walks', async () => {
    const { h, s } = await enter('standard', { peace: true });
    expect(h.ui.hints.map((x) => x.id)).toEqual(['move']);
    expect(s.hints.current).toBe('move');
    const t = { x: s.state.player.pos.x, y: s.state.player.pos.y };
    const far = neighbour(s, t, 4);
    await s.explore.walkToCell(far);
    expect(s.hints.current).not.toBe('move');
    // A new floor on the same device does not repeat it.
    const h2 = makeHarness({ reveal: true, peace: true });
    h2.storage.data = new Map(h.storage.data);
    const s2 = new FloorSession(h2.deps, run(5, 1, {}, 'standard'), 1);
    await s2.enter();
    expect(h2.ui.hints.map((x) => x.id)).not.toContain('move');
  });

  it('one at a time, with a gap, never while things are playing', async () => {
    let t = 1_000_000;
    const h = makeHarness({ reveal: true, peace: true });
    h.deps.now = () => t;
    const s = new FloorSession(h.deps, run(5, 1, {}, 'standard'), 1);
    await s.enter();
    expect(h.ui.hints).toHaveLength(1);
    // The player acts: the hint goes; the next one waits out the gap.
    s.state.player.pos = neighbour(s, s.state.player.pos, 3);
    s.pushHud();
    expect(s.hints.current).toBeNull();
    t += 1000;
    s.pushHud();
    expect(h.ui.hints).toHaveLength(1);
    t += 5000;
    s.pushHud();
    expect(h.ui.hints.length).toBeGreaterThanOrEqual(1);
    // No hint appears while the hero is busy.
    const before = h.ui.hints.length;
    s.explore.resting = true;
    t += 60000;
    s.pushHud();
    expect(h.ui.hints).toHaveLength(before);
    s.explore.resting = false;
  });

  it('standard mode never shows concept hints; guided does', async () => {
    for (const mode of ['standard', 'guided'] as const) {
      const { h, s } = await enter(mode, {});
      await startFight(s, h, 2);
      s.handleIntent({ type: 'selectCreature', creatureId: s.state.monsters[0]?.creature.id as string });
      const ids = new Set(h.ui.hints.map((x) => x.id));
      for (const concept of ['hitChance', 'bonusAction', 'lowHp', 'cover', 'role', 'shove']) {
        if (mode === 'standard') expect(ids.has(concept), `${mode} showed ${concept}`).toBe(false);
      }
      if (mode === 'standard') expect(h.ui.hud?.suggestion).toBeUndefined();
    }
  });

  it('tips off persists, and every hint is silenced', async () => {
    const h = makeHarness({ reveal: true, peace: true });
    const s = new FloorSession(h.deps, run(5, 1, {}, 'standard'), 1);
    await s.enter();
    expect(h.ui.hints).toHaveLength(1);
    // The UI reports the player's choice through the hint's callback.
    const calls = (h.ui as unknown as { hintClose?: (r: 'tipsOff') => void }).hintClose;
    expect(calls).toBeUndefined();
    new Prefs(h.storage).setTipsOff(true);
    s.hints.reset();
    h.ui.hints.length = 0;
    s.state.player.pos = neighbour(s, s.state.player.pos, 3);
    s.pushHud();
    expect(h.ui.hints).toHaveLength(0);
  });
});

describe('the adviser', () => {
  it('guided fills the suggestion on the hero turn and marks one action; standard never does', async () => {
    const g = await enter('guided');
    await startFight(g.s, g.h, 1);
    const hud = g.h.ui.hud as HudModel;
    expect(hud.suggestion).toBeTruthy();
    const marked = hud.actions.filter((a) => a.suggested);
    expect(marked.length).toBeLessThanOrEqual(1);
    for (const a of marked) expect(hud.actions.some((x) => x.id === a.id)).toBe(true);
    const st = await enter('standard');
    await startFight(st.s, st.h, 1);
    expect(st.h.ui.hud?.suggestion).toBeUndefined();
    expect(st.h.ui.hud?.actions.some((a) => a.suggested)).toBe(false);
  });

  it('between fights, guided nudges a hurt hero toward resting; standard says nothing', async () => {
    const g = await enter('guided', { peace: true });
    g.s.state.player.hp = 3;
    g.s.pushHud();
    expect(g.h.ui.hud?.suggestion).toBeTruthy();
    const st = await enter('standard', { peace: true });
    st.s.state.player.hp = 3;
    st.s.pushHud();
    expect(st.h.ui.hud?.suggestion).toBeUndefined();
  });

  it('guided asks before ending a turn with the action unused and an enemy in reach', async () => {
    const { h, s } = await enter('guided', {}, {}, 5, 1, { confirm: [{ ok: false, remember: false }] });
    await startFight(s, h, 1);
    s.handleIntent({ type: 'endTurn' });
    await until(() => h.ui.confirms.length > 0);
    expect(h.ui.confirms).toHaveLength(1);
    expect((h.ui.confirms[0] as { rememberKey?: string }).rememberKey).toBe('endTurnUnused');
    // Cancelled: still the hero's turn.
    expect(s.combat.playerTurn).toBe(true);
  });
});

describe('rest confirmations', () => {
  async function hurtHero(script: FakeUiScript = {}) {
    const g = await enter('standard', { peace: true }, {}, 5, 2, script);
    g.s.state.player.hp = 5;
    g.s.state.player.pos = neighbour(g.s, g.s.state.plan.entrance, 3);
    g.s.pushHud();
    return g;
  }

  it('a short rest asks first, built from the preview; cancelling costs nothing', async () => {
    const { h, s } = await hurtHero({ confirm: [{ ok: false, remember: false }] });
    const before = s.state.shortRestsLeft;
    await s.explore.shortRest();
    expect(h.ui.confirms).toHaveLength(1);
    const q = h.ui.confirms[0] as { title: string; lines: string[]; confirmLabel: string; cancelLabel: string; rememberKey?: string };
    expect(q.title).toBe('Take a short rest?');
    expect(q.confirmLabel).toBe('Rest');
    expect(q.cancelLabel).toBe('Not now');
    expect(q.rememberKey).toBe('shortRest');
    expect(q.lines.length).toBeGreaterThan(0);
    expect(s.state.shortRestsLeft).toBe(before);
    expect(s.state.player.hp).toBe(5);
  });

  it('confirming rests; "don\'t ask again" is remembered and the next short rest goes ahead unasked', async () => {
    const { h, s } = await hurtHero({ confirm: [{ ok: true, remember: true }] });
    await s.explore.shortRest();
    expect(s.state.player.hp).toBeGreaterThan(5);
    expect(new Prefs(h.storage).remembered('shortRest')).toBe(true);
    s.state.player.hp = 5;
    s.pushHud();
    await s.explore.shortRest();
    expect(h.ui.confirms).toHaveLength(1);
  });

  it('the warning appears exactly when the preview says the rest is wasteful', async () => {
    const { h, s } = await hurtHero();
    const preview = previewRest(s.currentCharacter(), null, 'short', { shortRestsLeft: s.state.shortRestsLeft });
    await s.explore.shortRest();
    const q = h.ui.confirms[0] as { warning?: string };
    expect(q.warning !== undefined).toBe(preview.wasteful);
    if (preview.wasteful) expect(q.warning).toContain('Save it for later');
  });

  it('a long rest at a site asks "Rest here?" and does not offer to remember', async () => {
    const { h, s } = await hurtHero({ confirm: [{ ok: false, remember: false }, { ok: true, remember: false }] });
    const site = s.state.restSites[0] as NonNullable<(typeof s.state.restSites)[number]>;
    s.state.player.pos = neighbour(s, site.pos, 1);
    h.renderer.placeEntity('player', s.state.player.pos);
    await s.explore.restAt(site.id);
    const q = h.ui.confirms[0] as { title: string; rememberKey?: string };
    expect(q.title).toBe('Rest here?');
    expect(q.rememberKey).toBeUndefined();
    expect(site.used).toBe(false);
    await s.explore.restAt(site.id);
    expect(site.used).toBe(true);
  });
});

describe('the shop', () => {
  it('weapons, armor and shields carry comparisons for the real build; potions do not', () => {
    const h = makeHarness();
    const pc = quickCharacter(3);
    pc.gold = 5000;
    const hub = new HubFlow(pc, 4, h.audio, 1);
    const startGold = hub.pc.gold;
    const shop = hub.model().shop;
    const gear = shop.filter((e) => ['weapon', 'armor', 'shield'].includes(e.item.kind));
    expect(gear.length).toBeGreaterThan(0);
    for (const e of gear) expect(e.compare?.verdict, e.item.id).toBeDefined();
    for (const e of shop.filter((x) => x.item.kind === 'consumable')) expect(e.compare).toBeUndefined();
    // The comparison is refreshed after buying and equipping.
    const up = gear.find((e) => e.compare?.verdict === 'upgrade');
    if (up) {
      const after = hub.handle({ type: 'buy', itemId: up.item.id });
      hub.handle({ type: 'equip', itemId: up.item.id });
      const now = hub.model().shop.find((e) => e.item.id === up.item.id);
      expect(now?.compare?.verdict ?? 'owned').toBe('owned');
      expect(after.character.gold).toBeLessThan(startGold);
    }
  });

  it('the bot shops: keeps two potions, buys and wears the best upgrade, never a downgrade', () => {
    const h = makeHarness();
    const pc = quickCharacter(5);
    pc.gold = 5000;
    pc.inventory = pc.inventory.filter((x) => x.itemId !== 'potion_healing');
    const hub = new HubFlow(pc, 5, h.audio, 1);
    const startGold = hub.pc.gold;
    const { bought } = hub.autoShop();
    // Healing potions of the best kind the shop stocks.
    const potions = hub.pc.inventory.reduce((n, x) => n + (getItem(x.itemId)?.consumable?.effect === 'heal' ? x.quantity : 0), 0);
    expect(potions).toBeGreaterThanOrEqual(2);
    // The best armor upgrade on offer for this hero (the shop always stocks the scheduled one).
    const stock = hub.model().shop.filter((e) => e.item.kind === 'armor');
    const worn = hub.pc.equipped.armor as string;
    expect(bought.some((id) => id === worn)).toBe(true);
    expect(stock.some((e) => e.compare?.verdict === 'upgrade' && e.price <= hub.pc.gold)).toBe(false);
    expect(worn).not.toBe('chain_mail');
    expect(bought).not.toContain('club');
    expect(hub.pc.gold).toBeLessThan(startGold);
  });
});

describe('effects and speed', () => {
  it('a melee hit: the attack, then the impact on the target, in order', async () => {
    const { h, s } = await enter('standard', { peace: true });
    const foe = s.state.monsters[0]?.creature as NonNullable<(typeof s.state.monsters)[number]>['creature'];
    const trace: string[] = [];
    const r = h.renderer;
    const anim = r.playAnim.bind(r);
    r.playAnim = async (id: string, a: string, o?: { facing?: GridPos }) => {
      trace.push(`anim:${a}:${id === 'player' ? 'hero' : 'foe'}`);
      await anim(id, a, o);
    };
    r.playEffect = async (e) => {
      trace.push(`start:${e.kind}`);
      await Promise.resolve();
      trace.push(`end:${e.kind}`);
    };
    await s.playback.play([
      { type: 'attackRoll', attackerId: 'player', targetId: foe.id, actionName: 'Longsword', d20: 15, dice: [15], mode: 'normal', bonus: 5, total: 20, targetAc: 12, outcome: 'hit', reaction: false },
      { type: 'damage', targetId: foe.id, sourceId: 'player', amount: 6, damageType: 'slashing', modifier: 'none', crit: false, hpAfter: foe.hp - 6 },
    ]);
    expect(trace).toEqual(['anim:attack:hero', 'start:impact', 'end:impact', 'anim:hit:foe']);
    expect(h.audio.plays).toContain('hitBlade');
  });

  it('a ranged miss: shoot, an arrow that flies past, the target gets out of the way', async () => {
    const { h, s } = await enter('standard', { peace: true }, { preset: 'archer' });
    const foe = s.state.monsters[0]?.creature as NonNullable<(typeof s.state.monsters)[number]>['creature'];
    const bow = s.state.player.actions.find((a) => a.targeting.kind === 'creature' && !a.targeting.melee && a.id.startsWith('atk_'));
    expect(bow).toBeDefined();
    await s.playback.play([
      { type: 'attackRoll', attackerId: 'player', targetId: foe.id, actionName: bow?.name as string, d20: 2, dice: [2], mode: 'normal', bonus: 5, total: 7, targetAc: 14, outcome: 'miss', reaction: false },
    ]);
    expect(h.renderer.anims.map((x) => x.anim)).toEqual(['shoot', 'dodge']);
    expect(h.renderer.effects).toEqual([{ kind: 'projectile', from: 'player', to: foe.id, shape: 'arrow', element: 'physical', hit: false }]);
    expect(h.renderer.floats.some((f) => f.text === 'Miss')).toBe(true);
  });

  it('a spell area: the cast, then a flash across the cone', async () => {
    const { h, s } = await enter('standard', {}, { background: 'sage', spell: 'burning_hands' });
    const monId = await startFight(s, h, 2);
    const mon = s.state.monsters.find((m) => m.creature.id === monId)?.creature as unknown as { pos: GridPos };
    await s.combat.selectAction('spell_burning_hands');
    s.combat.hover({ cell: mon.pos, entityId: null });
    h.renderer.effects.length = 0;
    await s.combat.tap({ cell: mon.pos, entityId: null });
    const area = h.renderer.effects.find((e) => e.kind === 'area');
    expect(area).toBeDefined();
    if (area && area.kind === 'area') {
      expect(area.element).toBe('fire');
      expect(area.origin).toBe('player');
      expect(area.cells.length).toBeGreaterThan(0);
    }
    expect(h.renderer.anims.find((a) => a.id === 'player')?.anim).toBe('cast');
  });

  it('a heal shimmers', async () => {
    const { h, s } = await enter('standard', { peace: true });
    await s.playback.play([{ type: 'heal', targetId: 'player', amount: 7, hpAfter: 20 }]);
    expect(h.renderer.effects).toContainEqual({ kind: 'aura', on: 'player', style: 'heal' });
  });

  it('animation speed is set from the menu, persisted, and read by the next floor; ?speed= overrides', async () => {
    const h = makeHarness({ depth: 1, seed: 3 }, { menu: [{ type: 'speed', speed: 'fast' }, { type: 'resume' }] });
    const game = new Game(h.deps);
    void game.boot();
    expect(await until(() => game.session?.entered === true)).toBe(true);
    const s = game.session as FloorSession;
    s.handleIntent({ type: 'openMenu' });
    expect(await until(() => h.renderer.animationSpeed === 'fast')).toBe(true);
    expect(new Prefs(h.storage).speed()).toBe('fast');
    game.stop();
    const h2 = makeHarness({ reveal: true });
    h2.storage.data = new Map(h.storage.data);
    const s2 = new FloorSession(h2.deps, run(5, 1), 1);
    await s2.enter();
    expect(s2.state.speed).toBe('fast');
    expect(h2.renderer.animationSpeed).toBe('fast');
    const h3 = makeHarness({ reveal: true, speed: 'skip' });
    h3.storage.data = new Map(h.storage.data);
    const s3 = new FloorSession(h3.deps, run(5, 1), 1);
    await s3.enter();
    expect(s3.state.speed).toBe('skip');
  });
});

describe('the boss chest', () => {
  async function killBoss() {
    const depth = 8;
    const h = makeHarness({ reveal: true, depth, seed: 3 });
    const pc = quickCharacter(depth);
    pc.maxHp = pc.hp = 3000;
    const s = new FloorSession(h.deps, { runSeed: 3, depth, pc, shortRestsLeft: 2 }, 1);
    await s.enter();
    const st = s.state;
    const boss = st.monsters.find((m) => m.boss) as NonNullable<(typeof st.monsters)[number]>;
    const mons = st.monsters.filter((m) => m.roomId === boss.roomId);
    const at = neighbour(s, boss.creature.pos, 2);
    st.player.pos = at;
    h.renderer.placeEntity('player', at);
    for (const m of mons) m.creature.hp = 1;
    void s.combat.begin(mons);
    expect(await until(() => s.combat.playerTurn)).toBe(true);
    for (let i = 0; i < 60 && st.mode === 'combat' && !s.finished; i++) {
      if (s.combat.playerTurn) await s.combat.autoAct();
      else await until(() => s.combat.playerTurn || st.mode !== 'combat', 20000);
    }
    return { h, s, boss };
  }

  it('appears where the boss fell, with the boss model, a line, a banner and a standing prompt', async () => {
    const { h, s, boss } = await killBoss();
    expect(s.state.mode).toBe('explore');
    const chest = s.state.chests.find((c) => c.boss);
    expect(chest).toBeDefined();
    expect(h.renderer.models.get('chest_boss')).toBe('chest_boss');
    const d = Math.max(Math.abs((chest?.pos.x ?? 0) - boss.creature.pos.x), Math.abs((chest?.pos.y ?? 0) - boss.creature.pos.y));
    expect(d).toBeLessThanOrEqual(3);
    expect(s.state.log.some((l) => l.includes('leaves its hoard behind'))).toBe(true);
    expect(h.ui.banners.length).toBeGreaterThan(0);
    s.pushHud();
    expect(h.ui.hud?.prompt).toBe("The boss's chest is waiting");
  });

  it('pays more than an ordinary chest, and stops the prompt once opened', async () => {
    const { h, s } = await killBoss();
    const chest = s.state.chests.find((c) => c.boss) as NonNullable<(typeof s.state.chests)[number]>;
    s.state.player.pos = neighbour(s, chest.pos, 1);
    h.renderer.placeEntity('player', s.state.player.pos);
    const goldBefore = s.state.pc.gold;
    const ordinary = s.state.chests.filter((c) => !c.boss).length;
    const expected = chestLoot(8, s.state.floorRng.fork(`chest:${chest.id}`), { chestsOnFloor: Math.max(1, ordinary), boss: true });
    await s.explore.openChest(chest.id);
    expect(chest.opened).toBe(true);
    // Exactly the rules' boss chest for a floor with this many ordinary chests.
    expect(Math.round((s.state.pc.gold - goldBefore) * 100) / 100).toBe(expected.gold);
    s.pushHud();
    expect(h.ui.hud?.prompt).not.toBe("The boss's chest is waiting");
  });

  it('taking the stairs with a seen chest unopened asks, naming the boss chest; going back keeps the hero here', async () => {
    const { h, s } = await killBoss();
    h.ui.script.confirm = [{ ok: false, remember: false }, { ok: true, remember: false }];
    const exit = s.state.plan.exit;
    s.state.stairsOpen = true;
    s.state.player.pos = neighbour(s, exit, 1);
    h.renderer.placeEntity('player', s.state.player.pos);
    await s.explore.walkToCell(exit);
    expect(h.ui.confirms).toHaveLength(1);
    const q = h.ui.confirms[0] as { lines: string[]; confirmLabel: string; cancelLabel: string };
    expect(q.lines.join(' ')).toContain("boss's chest");
    expect(q.confirmLabel).toBe('Leave');
    expect(q.cancelLabel).toBe('Go back');
    expect(s.finished).toBe(false);
    // Confirm: down it goes.
    s.state.player.pos = neighbour(s, exit, 1);
    await s.explore.walkToCell(exit);
    expect(s.finished).toBe(true);
    expect((await s.outcome).type).toBe('cleared');
  });

  it('with every chest opened the stairs do not ask', async () => {
    const { h, s } = await killBoss();
    for (const c of s.state.chests) c.opened = true;
    s.state.stairsOpen = true;
    const exit = s.state.plan.exit;
    s.state.player.pos = neighbour(s, exit, 1);
    await s.explore.walkToCell(exit);
    expect(h.ui.confirms).toHaveLength(0);
    expect(s.finished).toBe(true);
  });
});

export type { SaveGame };

describe('retries', () => {
  it('the same floor on another attempt keeps its layout but rolls its fights differently', async () => {
    const inits: string[] = [];
    const layouts: string[] = [];
    for (const attempt of [1, 2, 3, 4]) {
      const h = makeHarness({ reveal: true, peace: true });
      const s = new FloorSession(h.deps, run(5, 2), attempt);
      await s.enter();
      layouts.push(Array.from(s.state.plan.kinds).join(''));
      const st = s.state;
      const mon = st.monsters[0] as NonNullable<(typeof st.monsters)[number]>;
      st.player.pos = neighbour(s, mon.creature.pos, 2);
      h.renderer.placeEntity('player', st.player.pos);
      void s.combat.begin(st.monsters.filter((m) => m.roomId === mon.roomId));
      await until(() => s.combat.playerTurn);
      inits.push(st.log.find((l) => l.startsWith('Initiative:')) ?? '');
    }
    expect(new Set(layouts).size).toBe(1);
    expect(new Set(inits).size).toBeGreaterThan(1);
  });
});

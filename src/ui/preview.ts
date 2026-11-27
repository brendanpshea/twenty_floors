/** Dev harness for the UI. Open dev/ui-preview.html; see the `?screen=` values in SCREENS. */
import type { HubIntent, HubModel, HudModel, UiIntent } from '../core/types';
import { createUi } from './index';
import { combatHud, creationOptions, crowdedInitiative, levelUpFor, exploreHud, makeCompanionHubModel, makeHubModel, withCompanion } from './mocks';

const rootEl = document.getElementById('ui-root');
if (!rootEl) throw new Error('#ui-root missing');
const ui = createUi(rootEl);
const params = new URLSearchParams(location.search);
const bgFirst = params.get('bgfirst');
if (bgFirst) creationOptions.backgrounds.sort((a, b) => Number(b.id === bgFirst) - Number(a.id === bgFirst));

// ---------------------------------------------------------------------------
// Status line and toolbar
// ---------------------------------------------------------------------------

const status = document.createElement('div');
status.className = 'pv-status';
const w = window as unknown as { __log: string[] };
w.__log = [];
function say(msg: string): void {
  status.textContent = msg;
  w.__log.push(msg);
}

document.getElementById('fake-canvas')?.addEventListener('pointerdown', () => say('click reached the canvas'));

// ---------------------------------------------------------------------------
// HUD state
// ---------------------------------------------------------------------------

let hud: HudModel = combatHud();
let enemyTimer = 0;

function pushHud(): void {
  ui.setHud(structuredClone(hud));
}

function log(line: string): void {
  hud.log = [...hud.log, line];
}

ui.onIntent((i: UiIntent) => {
  say(`intent: ${JSON.stringify(i)}`);
  switch (i.type) {
    case 'selectAction':
      hud.actions = hud.actions.map((a) => ({ ...a, selected: a.id === i.actionId }));
      hud.prompt = 'Choose a target';
      break;
    case 'cancel':
      if (hud.concentration) delete hud.concentration; // preview: Escape ends concentration so the exit animation can be seen
      hud.actions = hud.actions.map((a) => ({ ...a, selected: false }));
      hud.prompt = undefined;
      break;
    case 'endTurn': {
      const c = hud.combat;
      if (!c || !c.playerTurn) return;
      c.playerTurn = false;
      hud.prompt = undefined;
      hud.actions = hud.actions.map((a) => ({ ...a, selected: false, enabled: false, disabledReason: 'Not your turn.' }));
      c.initiative = c.initiative.map((e) => ({ ...e, active: e.id === 'boss' }));
      log('Goblin Boss attacks Hero with Scimitar: 15 vs AC 18, miss.');
      window.clearTimeout(enemyTimer);
      enemyTimer = window.setTimeout(() => {
        const cc = hud.combat;
        if (!cc) return;
        cc.playerTurn = true;
        cc.round += 1;
        cc.movementLeft = cc.speed;
        cc.actionAvailable = true;
        cc.bonusAvailable = true;
        cc.initiative = cc.initiative.map((e) => ({ ...e, active: e.id === 'player' }));
        hud.player.hp = Math.max(1, hud.player.hp - 3);
        hud.actions = combatHud().actions;
        log(`Round ${cc.round}.`);
        pushHud();
      }, 1600);
      break;
    }
    case 'shortRest':
      hud.player.hp = hud.player.maxHp;
      hud.shortRestsLeft = Math.max(0, hud.shortRestsLeft - 1);
      hud.canShortRest = false;
      hud.shortRestBlockedReason = 'Nothing to recover.';
      hud.hitDice = { ...hud.hitDice, current: Math.max(0, hud.hitDice.current - 1) };
      log('You rest and bind your wounds.');
      break;
    case 'selectCreature':
      if (hud.target) hud.target = { ...hud.target, name: i.creatureId };
      break;
    case 'longRest':
      hud.player.hp = hud.player.maxHp;
      hud.canLongRest = false;
      hud.restSitesLeft = Math.max(0, hud.restSitesLeft - 1);
      hud.hitDice = { ...hud.hitDice, current: hud.hitDice.max };
      log('You rest by the fire and wake fully restored.');
      break;
    case 'setStance':
      if (hud.companion) hud.companion = { ...hud.companion, stance: i.stance };
      break;
    case 'openMenu':
      run('menu');
      return;
  }
  pushHud();
});

// ---------------------------------------------------------------------------
// Hub state
// ---------------------------------------------------------------------------

function hubHandler(model: { current: HubModel }): (i: HubIntent) => HubModel {
  return (i) => {
    say(`hub intent: ${JSON.stringify(i)}`);
    const m = model.current;
    const ch = m.character;
    switch (i.type) {
      case 'buy': {
        const entry = m.shop.find((s) => s.item.id === i.itemId);
        if (entry && ch.gold >= entry.price) {
          ch.gold -= entry.price;
          m.items[i.itemId] = entry.item;
          const stack = ch.inventory.find((s) => s.itemId === i.itemId);
          if (stack) stack.quantity += 1;
          else ch.inventory.push({ itemId: i.itemId, quantity: 1 });
        }
        break;
      }
      case 'equip': {
        const kind = m.items[i.itemId]?.kind;
        if (kind === 'armor') ch.equipped.armor = i.itemId;
        else if (kind === 'shield') ch.equipped.offHand = i.itemId;
        else if (m.items[i.itemId]?.weapon?.melee === false) ch.equipped.ranged = i.itemId;
        else ch.equipped.mainHand = i.itemId;
        break;
      }
      case 'confirmLevelUp':
        if (m.levelUp) {
          ch.level = m.levelUp.toLevel;
          ch.maxHp += m.levelUp.hpGain;
          ch.hp = ch.maxHp;
          m.levelUp = undefined;
        }
        break;
      case 'chooseCompanion':
        if (m.companions) m.companions = { ...m.companions, chosenId: i.id };
        break;
      case 'descend':
        break;
    }
    m.shop = m.shop.map((s) => ({ ...s, affordable: s.price <= ch.gold }));
    return m;
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

type Runner = () => void;

const SCREENS: Record<string, Runner> = {
  title: () => {
    ui.hideHud();
    void ui.showTitle({ hasSave: true }).then((r) => say(`title -> ${r}`));
  },
  'title-nosave': () => {
    ui.hideHud();
    void ui.showTitle({ hasSave: false }).then((r) => say(`title -> ${r}`));
  },
  creation: () => {
    ui.hideHud();
    void ui.showCreation(creationOptions).then((b) => say(`creation -> ${JSON.stringify(b)}`));
  },
  'hud-explore': () => {
    hud = exploreHud();
    pushHud();
  },
  'hud-rest': () => {
    hud = exploreHud();
    hud.canShortRest = true;
    hud.canLongRest = true;
    pushHud();
  },
  'hud-companion': () => {
    hud = withCompanion(exploreHud(), params.get('c') ?? 'sphinx_of_wonder');
    pushHud();
  },
  'hud-companion-combat': () => {
    hud = withCompanion(combatHud(), params.get('c') ?? 'sphinx_of_wonder');
    const c = hud.companion;
    if (c && params.get('target') === 'companion') {
      hud.target = { name: c.name, hp: c.hp, maxHp: c.maxHp, ac: 13, conditions: [], description: 'Your companion.' };
    }
    pushHud();
  },
  'hud-companion-downed': () => {
    hud = withCompanion(combatHud(), params.get('c') ?? 'pseudodragon', { downed: true, stance: 'back' });
    pushHud();
  },
  'hud-concentration': () => {
    hud = combatHud();
    hud.concentration = { spellName: 'Bless', roundsLeft: 8 };
    pushHud();
  },
  'hud-target-cover': () => {
    hud = combatHud();
    if (hud.target) hud.target = { ...hud.target, name: 'Goblin Archer', faction: 'enemy', cover: 2, tactic: 'archer', description: 'Keeps behind the pillar and picks its shots.' };
    pushHud();
  },
  'hud-target-shove': () => {
    hud = combatHud();
    const shove = { id: 'shove', name: 'Shove', description: 'Push a creature up to 5 feet away. A creature shoved off an edge falls.', icon: 'shove', cost: 'action' as const, enabled: true, selected: true };
    hud.actions = [...hud.actions.slice(0, 3), shove, ...hud.actions.slice(3)];
    hud.prompt = 'Choose a creature to shove';
    if (hud.target) {
      hud.target = { ...hud.target, faction: 'enemy', cover: 5, tactic: 'brute', pushInto: { hazard: 'fall', damage: '3d6' } };
      delete hud.target.hitChance;
    }
    pushHud();
  },
  'hud-blocked': () => {
    hud = exploreHud();
    hud.canShortRest = false;
    hud.shortRestBlockedReason = 'An enemy is in view.';
    pushHud();
  },
  'hud-combat': () => {
    hud = combatHud();
    if (params.get('attacks') && hud.combat) hud.combat.attacksLeft = { current: Number(params.get('attacks')), max: 2 };
    const n = Number(params.get('n') ?? 0);
    if (n > 0 && hud.combat) {
      const act = Number(params.get('active') ?? 0);
      hud.combat.initiative = crowdedInitiative(n, act);
      if (act !== 0) hud.combat.playerTurn = false;
      if (params.get('companion') === '1') hud = withCompanion(hud, 'pseudodragon');
    }
    pushHud();
  },
  'hud-targeting': () => {
    hud = combatHud();
    hud.actions = hud.actions.map((a) => ({ ...a, selected: a.id === 'longsword' }));
    hud.prompt = 'Choose a target for Longsword';
    pushHud();
  },
  'hud-enemy': () => {
    hud = combatHud();
    const c = hud.combat;
    if (c) {
      c.playerTurn = false;
      c.initiative = c.initiative.map((e) => ({ ...e, active: e.id === 'boss' }));
    }
    hud.actions = hud.actions.map((a) => ({ ...a, enabled: false, disabledReason: 'Not your turn.' }));
    pushHud();
  },
  'hud-many': () => {
    hud = combatHud();
    const n = Number(params.get('n') ?? 9);
    const pool = [
      { name: 'Disengage', icon: 'disengage', cost: 'action' as const },
      { name: 'Healing Potion', icon: 'potion', cost: 'bonus' as const, usesLeft: 2 },
      { name: 'Shield Bash', icon: 'slam', cost: 'action' as const },
      { name: 'Fire Bolt', icon: 'spell', cost: 'action' as const },
      { name: 'Bite', icon: 'bite', cost: 'action' as const },
      { name: 'Claw', icon: 'claw', cost: 'action' as const },
    ];
    const base = hud.actions.slice(0, n);
    for (let i = base.length; i < n; i++) {
      const p = pool[(i - 6) % pool.length];
      if (!p) break;
      base.push({ id: `extra${i}`, description: 'An extra preview action.', enabled: true, selected: false, ...p });
    }
    hud.actions = base;
    pushHud();
  },
  hub: () => {
    ui.hideHud();
    const state = { current: makeHubModel() };
    void ui.showHub(structuredClone(state.current), hubHandler(state)).then(() => say('hub -> descended'));
  },
  'hub-levelup': () => {
    ui.hideHud();
    const m = makeHubModel();
    m.levelUp = levelUpFor(Number(params.get('level') ?? 4));
    const state = { current: m };
    void ui.showHub(structuredClone(m), hubHandler(state)).then(() => say('hub -> descended'));
  },
  'hud-explore-actions': () => {
    hud = exploreHud();
    const prayer = { id: 'prayer', name: 'Prayer of Healing', description: 'Heal up to six allies in range for 2d8 each.', icon: 'heal', cost: 'action' as const, enabled: true, selected: false, usesLeft: 1 };
    hud.actions = [...hud.actions.slice(0, 3), prayer].slice(0, Number(params.get('n') ?? 4));
    pushHud();
  },
  'hub-companion': () => {
    ui.hideHud();
    const state = { current: makeCompanionHubModel(true) };
    void ui.showHub(structuredClone(state.current), hubHandler(state)).then(() => say('hub -> descended'));
  },
  'hub-nolevel': () => {
    ui.hideHud();
    const m = makeHubModel();
    m.levelUp = undefined;
    const state = { current: m };
    void ui.showHub(structuredClone(m), hubHandler(state)).then(() => say('hub -> descended'));
  },
  menu: () => {
    void ui.showMenu({ quality: 'medium', depth: 3, muted: false }).then((r) => say(`menu -> ${JSON.stringify(r)}`));
  },
  death: () => {
    ui.hideHud();
    void ui.showDeath({ depth: 7, killedBy: 'Goblin Boss' }).then((r) => say(`death -> ${r}`));
  },
  victory: () => {
    ui.hideHud();
    void ui.showVictory({ floorsCleared: 20 }).then(() => say('victory -> continue'));
  },
  banner: () => ui.banner('Floor 3: The Sundered Depths', 'Beware the bridges'),
  loading: () => {
    ui.setLoading('Descending…');
    window.setTimeout(() => ui.setLoading(null), 2500);
  },
  'loading-hold': () => ui.setLoading('Carving the dungeon…'),
};

function run(name: string): void {
  ui.setLoading(null);
  const fn = SCREENS[name];
  if (fn) {
    say(`screen: ${name}`);
    fn();
  }
}

// Toolbar
if (params.get('toolbar') !== '0') {
  const bar = document.createElement('div');
  bar.className = 'pv-bar';
  const toggle = document.createElement('button');
  toggle.textContent = 'dev';
  toggle.className = 'pv-toggle';
  const list = document.createElement('div');
  list.className = 'pv-list';
  list.hidden = true;
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
  });
  for (const name of Object.keys(SCREENS)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => run(name));
    list.append(b);
  }
  const hide = document.createElement('button');
  hide.textContent = 'hideHud';
  hide.addEventListener('click', () => ui.hideHud());
  list.append(hide, status);
  bar.append(toggle, list);
  document.body.append(bar);
}

// ---------------------------------------------------------------------------
// URL-driven state, for screenshots: ?screen=...&click=sel|sel&hover=sel&bg=checker
// ---------------------------------------------------------------------------

if (params.get('bg') === 'checker') document.getElementById('fake-canvas')?.classList.add('checker');

const startScreen = params.get('screen');
if (startScreen) run(startScreen);

const clicks = (params.get('click') ?? '').split('|').filter(Boolean);
const hover = params.get('hover');
const dispatchAll = async (): Promise<void> => {
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  await wait(400);
  for (const sel of clicks) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) {
      say(`click target not found: ${sel}`);
      continue;
    }
    el.click();
    await wait(120);
  }
  const scrollTo = params.get('scrollto');
  if (scrollTo) document.querySelector(scrollTo)?.scrollIntoView({ block: 'start' });
  if (hover) {
    const el = document.querySelector<HTMLElement>(hover);
    el?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  }
};
if (clicks.length || hover || params.get("scrollto")) void dispatchAll();

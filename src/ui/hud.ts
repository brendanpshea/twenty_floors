import type { Condition, HudAction, HudInitiativeEntry, HudModel, UiIntent } from '../core/types';
import { CELL_FEET } from '../core/types';
import {
  COST_LABEL,
  KeyedList,
  clamp,
  costMarker,
  h,
  prettifyId,
  setAttr,
  setText,
} from './dom';
import { createIcon, swapIcon } from './icons';
import type { Tooltip, TipContent } from './tooltip';

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

interface Bar {
  el: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
}

function makeBar(cls: string): Bar {
  const el = h('div', `tf-bar ${cls}`);
  const ghost = h('div', 'tf-bar-ghost');
  const fill = h('div', 'tf-bar-fill');
  el.append(ghost, fill);
  return { el, fill, ghost };
}

function setBar(bar: Bar, fraction: number): void {
  const f = `${(clamp(fraction, 0, 1) * 100).toFixed(1)}%`;
  if (bar.fill.style.width !== f) {
    bar.fill.style.width = f;
    bar.ghost.style.width = f;
  }
  bar.el.classList.toggle('is-low', fraction <= 0.3);
}

interface ChipItem {
  el: HTMLElement;
}

function chipList(parent: HTMLElement): KeyedList<Condition, ChipItem> {
  return new KeyedList<Condition, ChipItem>(
    parent,
    (c) => c,
    (c) => {
      const el = h('span', `tf-chip tf-chip--${c}`, prettifyId(c));
      return { el };
    },
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

interface ActionItem extends ChipItem {
  el: HTMLButtonElement;
  hotkey: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  cost: HTMLElement;
  uses: HTMLElement;
  costKind: string;
  action: HudAction;
}

interface TileItem extends ChipItem {
  el: HTMLButtonElement;
  letter: HTMLElement;
  bar: Bar;
  entry: HudInitiativeEntry;
}

interface PipItem extends ChipItem {
  label: HTMLElement;
  pips: HTMLElement;
  count: number;
}

export class Hud {
  readonly el: HTMLElement;

  private model: HudModel | null = null;
  private visible = false;

  // top
  private readonly floorLabel = h('span', 'tf-floor');
  private readonly floorNum = h('span', 'tf-floor-n');
  private readonly floorTheme = h('span', 'tf-floor-theme');
  private readonly initWrap = h('div', 'tf-init');
  private readonly initRound = h('div', 'tf-init-round');
  private readonly initList = h('div', 'tf-init-list');
  private readonly tiles: KeyedList<HudInitiativeEntry, TileItem>;

  // target
  private readonly targetEl = h('aside', 'tf-target');
  private readonly targetName = h('div', 'tf-target-name');
  private readonly targetAc = h('div', 'tf-ac tf-ac--small');
  private readonly targetAcNum = h('span', 'tf-ac-num');
  private readonly targetBar = makeBar('tf-bar--hp');
  private readonly targetHpText = h('div', 'tf-target-hp');
  private readonly targetConds = h('div', 'tf-chips');
  private readonly targetCondList: KeyedList<Condition, ChipItem>;
  private readonly targetDesc = h('div', 'tf-target-desc');
  private readonly targetHit = h('div', 'tf-target-hit');

  // player
  private readonly playerName = h('div', 'tf-player-name');
  private readonly playerSub = h('div', 'tf-player-sub');
  private readonly playerBar = makeBar('tf-bar--hp');
  private readonly playerHpText = h('div', 'tf-bar-text');
  private readonly playerTemp = h('div', 'tf-temp');
  private readonly playerTempFill = h('div', 'tf-temp-fill');
  private readonly playerAcNum = h('span', 'tf-ac-num');
  private readonly playerConds = h('div', 'tf-chips');
  private readonly playerCondList: KeyedList<Condition, ChipItem>;
  private readonly resEl = h('div', 'tf-resources');
  private readonly resList: KeyedList<{ name: string; current: number; max: number }, PipItem>;

  // log
  private readonly logEl = h('section', 'tf-log');
  private readonly logToggle = h('button', 'tf-log-toggle');
  private readonly logList = h('div', 'tf-log-list');
  private logRendered: string[] = [];
  private logStick = true;
  private logUserToggled = false;

  // bottom centre
  private readonly promptEl = h('div', 'tf-prompt');
  private readonly turnRes = h('div', 'tf-turnres');
  private readonly pipAction = h('div', 'tf-tpip tf-tpip--action');
  private readonly pipBonus = h('div', 'tf-tpip tf-tpip--bonus');
  private readonly moveText = h('span', 'tf-move-text');
  private readonly moveBar = makeBar('tf-bar--move');
  private readonly actionsEl = h('div', 'tf-actions');
  private readonly actions: KeyedList<HudAction, ActionItem>;
  private fitKey = '';

  /**
   * Shrink the buttons (down to a compact size) so all actions fit one row;
   * if they cannot, keep them mid-size and let the bar wrap to more rows.
   */
  private fitActions(n: number): void {
    const a = this.actionsEl;
    const avail = (a.parentElement?.clientWidth ?? 0) - 22;
    const key = `${n}|${avail}`;
    if (n === 0 || key === this.fitKey) return;
    this.fitKey = key;
    a.style.setProperty('--tf-s', '1');
    const first = a.firstElementChild as HTMLElement | null;
    if (!first) return;
    const w1 = first.offsetWidth;
    const gap = 5;
    let pick = 1;
    for (const s of [1, 0.88, 0.76]) {
      if (n * (Math.max(44, w1 * s) + gap) <= avail) {
        pick = s;
        break;
      }
    }
    a.style.setProperty('--tf-s', String(pick));
  }

  private updateOverflowHint: () => void = () => undefined;

  // bottom right
  private readonly endTurn = h('button', 'tf-endturn');
  private readonly endLabel = h('span', 'tf-endturn-label');
  private readonly endHint = h('span', 'tf-endturn-hint');
  private readonly restBtn = h('button', 'tf-rest');
  private readonly restBadge = h('span', 'tf-rest-badge');

  constructor(
    private readonly tip: Tooltip,
    private readonly emit: (i: UiIntent) => void,
    private readonly isActive: () => boolean,
  ) {
    this.el = h('div', 'tf-hud');
    this.el.hidden = true;

    // ----- top row
    const top = h('div', 'tf-hud-top');
    const tl = h('div', 'tf-tl');
    this.floorLabel.append(this.floorNum, this.floorTheme);
    tl.append(this.floorLabel);
    const menu = h('button', 'tf-iconbtn tf-menu');
    menu.type = 'button';
    menu.setAttribute('aria-label', 'Menu');
    menu.append(createIcon('menu'));
    menu.addEventListener('click', () => this.emit({ type: 'openMenu' }));
    tl.prepend(menu);

    this.initWrap.append(this.initRound, this.initList);
    this.tiles = new KeyedList<HudInitiativeEntry, TileItem>(
      this.initList,
      (e) => e.id,
      (e) => this.createTile(e),
      (item, e) => this.updateTile(item, e),
    );

    // target
    const tHead = h('div', 'tf-target-head');
    this.targetAc.append(h('span', 'tf-ac-label', 'AC'), this.targetAcNum);
    tHead.append(this.targetName, this.targetAc);
    this.targetBar.el.append(this.targetHpText);
    this.targetEl.append(tHead, this.targetBar.el, this.targetConds, this.targetDesc, this.targetHit);
    this.targetCondList = chipList(this.targetConds);

    top.append(tl, this.initWrap, this.targetEl);

    // ----- bottom row
    const bottom = h('div', 'tf-hud-bottom');

    const bl = h('div', 'tf-bl');
    this.logToggle.type = 'button';
    this.logToggle.setAttribute('aria-label', 'Toggle combat log');
    const logHead = h('div', 'tf-log-head');
    logHead.append(h('span', 'tf-log-title', 'Log'), createIcon('chevron', 'tf-icon tf-log-chev'));
    this.logToggle.append(logHead);
    this.logToggle.addEventListener('click', () => {
      this.logUserToggled = true;
      this.setLogCollapsed(!this.logEl.classList.contains('is-collapsed'));
    });
    this.logList.setAttribute('role', 'log');
    this.logList.setAttribute('aria-live', 'off');
    this.logList.addEventListener('scroll', () => {
      const l = this.logList;
      this.logStick = l.scrollHeight - l.scrollTop - l.clientHeight < 10;
    });
    this.logEl.append(this.logToggle, this.logList);
    const smallScreen = window.matchMedia('(max-width: 820px), (max-height: 520px)').matches;
    this.logEl.classList.toggle('is-collapsed', smallScreen);
    this.logToggle.setAttribute('aria-expanded', String(!smallScreen));

    const player = h('section', 'tf-player');
    const acBadge = h('div', 'tf-ac');
    acBadge.append(h('span', 'tf-ac-label', 'AC'), this.playerAcNum);
    const pMain = h('div', 'tf-player-main');
    const pHead = h('div', 'tf-player-head');
    pHead.append(this.playerName, this.playerSub);
    this.playerBar.el.append(this.playerHpText);
    this.playerTemp.append(this.playerTempFill);
    pMain.append(pHead, this.playerBar.el, this.playerTemp, this.playerConds, this.resEl);
    player.append(acBadge, pMain);
    this.playerCondList = chipList(this.playerConds);
    this.resList = new KeyedList(
      this.resEl,
      (r) => r.name,
      (r) => this.createPips(r.name),
      (item, r) => this.updatePips(item, r.current, r.max),
    );
    bl.append(this.logEl, player);

    const bc = h('div', 'tf-bc');
    this.promptEl.setAttribute('role', 'status');
    const actionPip = h('div', 'tf-tres');
    actionPip.append(this.pipAction, h('span', 'tf-tres-label', 'Action'));
    const bonusPip = h('div', 'tf-tres');
    bonusPip.append(this.pipBonus, h('span', 'tf-tres-label', 'Bonus'));
    const move = h('div', 'tf-tres tf-tres--move');
    const moveHead = h('div', 'tf-move-head');
    moveHead.append(h('span', 'tf-tres-label', 'Move'), this.moveText);
    move.append(moveHead, this.moveBar.el);
    this.turnRes.append(actionPip, bonusPip, move);
    this.actionsEl.setAttribute('role', 'toolbar');
    this.actionsEl.setAttribute('aria-label', 'Actions');
    this.actions = new KeyedList<HudAction, ActionItem>(
      this.actionsEl,
      (a) => a.id,
      (a) => this.createAction(a),
      (item, a, i) => this.updateAction(item, a, i),
    );
    bc.append(this.promptEl, this.turnRes, this.actionsEl);
    const updateHint = (): void => {
      const a = this.actionsEl;
      a.classList.toggle('can-left', a.scrollLeft > 4);
      a.classList.toggle('can-right', a.scrollLeft + a.clientWidth < a.scrollWidth - 4);
    };
    this.actionsEl.addEventListener('scroll', updateHint, { passive: true });
    window.addEventListener('resize', () => {
      this.fitKey = '';
      if (this.model) this.fitActions(this.model.actions.length);
      updateHint();
    });
    this.updateOverflowHint = updateHint;

    const br = h('div', 'tf-br');
    this.endTurn.type = 'button';
    this.endLabel.textContent = 'End Turn';
    this.endHint.textContent = 'Space';
    this.endTurn.append(this.endLabel, this.endHint);
    this.endTurn.addEventListener('click', () => this.emit({ type: 'endTurn' }));
    this.restBtn.type = 'button';
    this.restBtn.append(createIcon('rest'), h('span', 'tf-rest-label', 'Short Rest'), this.restBadge);
    this.restBtn.addEventListener('click', () => {
      if (!this.model) return;
      if (this.restBtn.getAttribute('aria-disabled') === 'true') {
        this.tip.flash(this.restBtn);
        return;
      }
      this.emit({ type: 'shortRest' });
    });
    this.tip.attach(this.restBtn, () => {
      const m = this.model;
      if (!m) return null;
      return {
        title: 'Short Rest',
        sub: `${m.shortRestsLeft} left on this floor`,
        body: 'Catch your breath: recover half your hit points and short-rest abilities.',
        warn: this.restBtn.getAttribute('aria-disabled') === 'true' ? this.restReason(m) : undefined,
      };
    });
    br.append(this.endTurn, this.restBtn);

    bottom.append(bl, bc, br);
    this.el.append(top, bottom);

    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  show(): void {
    this.visible = true;
    this.el.hidden = false;
  }

  hide(): void {
    this.visible = false;
    this.el.hidden = true;
    this.tip.hide();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  // -------------------------------------------------------------------------
  // Model sync
  // -------------------------------------------------------------------------

  setHud(m: HudModel): void {
    this.model = m;
    if (!this.visible) this.show();
    const combat = m.mode === 'combat' && !!m.combat;
    this.el.classList.toggle('is-combat', combat);
    this.el.classList.toggle('is-explore', !combat);

    setText(this.floorNum, `Floor ${m.floor.depth}`);
    setText(this.floorTheme, ` · ${m.floor.themeName}`);

    this.syncPlayer(m);
    this.syncCombat(m);
    this.syncTarget(m);
    this.actions.sync(m.actions);
    this.actionsEl.classList.toggle('is-many', m.actions.length > 5);
    this.updateOverflowHint();
    this.fitActions(m.actions.length);
    this.syncLog(m.log);

    const prompt = m.prompt ?? '';
    setText(this.promptEl, prompt);
    this.promptEl.classList.toggle('is-open', prompt !== '');

    // Short rest (exploring only)
    const restOk = m.canShortRest && m.shortRestsLeft > 0;
    setText(this.restBadge, String(m.shortRestsLeft));
    setAttr(this.restBtn, 'aria-disabled', restOk ? null : 'true');
    this.restBtn.classList.toggle('is-disabled', !restOk);

    this.tip.refresh();
  }

  private restReason(m: HudModel): string {
    if (m.shortRestsLeft <= 0) return 'No short rests left on this floor.';
    return 'You are already fresh: nothing to recover.';
  }

  private syncPlayer(m: HudModel): void {
    const p = m.player;
    setText(this.playerName, p.name);
    setText(this.playerSub, `Level ${p.level} ${p.className}`);
    setText(this.playerAcNum, String(p.ac));
    setBar(this.playerBar, p.maxHp > 0 ? p.hp / p.maxHp : 0);
    setText(this.playerHpText, `${p.hp} / ${p.maxHp}`);
    const hasTemp = p.tempHp > 0;
    this.playerTemp.classList.toggle('is-on', hasTemp);
    this.playerTemp.dataset['label'] = hasTemp ? `+${p.tempHp} temp` : '';
    this.playerTempFill.style.width = `${(clamp(p.maxHp > 0 ? p.tempHp / p.maxHp : 0, 0, 1) * 100).toFixed(1)}%`;
    this.playerCondList.sync(p.conditions);
    this.playerConds.hidden = p.conditions.length === 0;
    this.resList.sync(p.resources);
    this.resEl.hidden = p.resources.length === 0;
  }

  private syncCombat(m: HudModel): void {
    const c = m.combat;
    if (m.mode !== 'combat' || !c) {
      this.tiles.sync([]);
      return;
    }
    setText(this.initRound, `Round ${c.round}`);
    this.tiles.sync(c.initiative);
    this.pipAction.classList.toggle('is-spent', !c.actionAvailable);
    this.pipBonus.classList.toggle('is-spent', !c.bonusAvailable);
    this.pipAction.setAttribute('aria-label', c.actionAvailable ? 'Action available' : 'Action used');
    this.pipBonus.setAttribute('aria-label', c.bonusAvailable ? 'Bonus action available' : 'Bonus action used');
    setText(this.moveText, `${Math.max(0, Math.round(c.movementLeft * CELL_FEET))} ft`);
    setBar(this.moveBar, c.speed > 0 ? c.movementLeft / c.speed : 0);

    const turn = c.playerTurn;
    setText(this.endLabel, turn ? 'End Turn' : 'Enemy turn…');
    this.endHint.hidden = !turn;
    this.endTurn.disabled = !turn;
    this.endTurn.classList.toggle('is-waiting', !turn);
    this.el.classList.toggle('is-enemy-turn', !turn);
  }

  private syncTarget(m: HudModel): void {
    const t = m.target;
    this.targetEl.classList.toggle('is-open', !!t);
    if (!t) return;
    setText(this.targetName, t.name);
    setText(this.targetAcNum, String(t.ac));
    setBar(this.targetBar, t.maxHp > 0 ? t.hp / t.maxHp : 0);
    setText(this.targetHpText, `${t.hp} / ${t.maxHp}`);
    this.targetCondList.sync(t.conditions);
    this.targetConds.hidden = t.conditions.length === 0;
    setText(this.targetDesc, t.description ?? '');
    this.targetDesc.hidden = !t.description;
    const hit = t.hitChance;
    this.targetHit.hidden = hit === undefined;
    if (hit !== undefined) {
      setText(this.targetHit, `Hit chance ${Math.round(hit * 100)}%`);
      this.targetHit.dataset['tier'] = hit >= 0.65 ? 'high' : hit >= 0.35 ? 'mid' : 'low';
    }
  }

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------

  private setLogCollapsed(collapsed: boolean): void {
    this.logEl.classList.toggle('is-collapsed', collapsed);
    this.logToggle.setAttribute('aria-expanded', String(!collapsed));
    this.scrollLogToEnd(true);
  }

  private scrollLogToEnd(force = false): void {
    if (force || this.logStick) {
      this.logList.scrollTop = this.logList.scrollHeight;
      if (force) this.logStick = true;
    }
  }

  private syncLog(log: string[]): void {
    const MAX = 80;
    const next = log.length > MAX ? log.slice(log.length - MAX) : log;
    const prev = this.logRendered;
    // Find how many lines were appended: the kept part of `next` must equal a suffix of `prev`.
    let appended = -1;
    for (let a = 0; a <= next.length; a++) {
      const keep = next.length - a;
      if (keep > prev.length) continue;
      let same = true;
      for (let i = 0; i < keep; i++) {
        if (next[i] !== prev[prev.length - keep + i]) {
          same = false;
          break;
        }
      }
      if (same) {
        appended = a;
        break;
      }
    }
    if (appended === 0 && next.length === prev.length) return;
    if (appended < 0) {
      this.logList.replaceChildren();
      for (const line of next) this.logList.append(h('div', 'tf-log-line', line));
    } else {
      const keep = next.length - appended;
      const drop = prev.length - keep;
      for (let i = 0; i < drop; i++) this.logList.firstElementChild?.remove();
      for (let i = next.length - appended; i < next.length; i++) {
        this.logList.append(h('div', 'tf-log-line', next[i] ?? ''));
      }
    }
    this.logRendered = next.slice();
    const force = this.logEl.classList.contains('is-collapsed');
    this.scrollLogToEnd(force);
    // Layout may still settle (fonts, panel width): re-pin on the next frame.
    requestAnimationFrame(() => this.scrollLogToEnd(force));
  }

  // -------------------------------------------------------------------------
  // Initiative
  // -------------------------------------------------------------------------

  private createTile(e: HudInitiativeEntry): TileItem {
    const el = h('button', 'tf-tile');
    el.type = 'button';
    const letter = h('span', 'tf-tile-letter');
    const bar = makeBar('tf-bar--mini');
    el.append(letter, bar.el);
    const item: TileItem = { el, letter, bar, entry: e };
    el.addEventListener('click', () => this.emit({ type: 'selectCreature', creatureId: item.entry.id }));
    this.tip.attach(el, () => ({
      title: item.entry.name,
      sub: item.entry.dead ? 'Fallen' : `${Math.round(item.entry.hpFraction * 100)}% health`,
    }));
    return item;
  }

  private updateTile(item: TileItem, e: HudInitiativeEntry): void {
    item.entry = e;
    const cls = `tf-tile tf-tile--${e.faction}${e.active ? ' is-active' : ''}${e.dead ? ' is-dead' : ''}`;
    if (item.el.className !== cls) item.el.className = cls;
    setText(item.letter, (e.name.trim().charAt(0) || '?').toUpperCase());
    setBar(item.bar, e.dead ? 0 : e.hpFraction);
    setAttr(item.el, 'aria-label', `${e.name}${e.active ? ', active' : ''}${e.dead ? ', fallen' : ''}`);
    setAttr(item.el, 'aria-current', e.active ? 'true' : null);
  }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  private createPips(name: string): PipItem {
    const el = h('div', 'tf-res');
    const label = h('span', 'tf-res-label', name);
    const pips = h('span', 'tf-res-pips');
    el.append(label, pips);
    return { el, label, pips, count: -1 };
  }

  private updatePips(item: PipItem, current: number, max: number): void {
    const asNumbers = max > 8;
    if (asNumbers) {
      item.pips.className = 'tf-res-pips is-numeric';
      setText(item.pips, `${current}/${max}`);
      item.count = -1;
      return;
    }
    if (item.count !== max) {
      item.pips.className = 'tf-res-pips';
      item.pips.replaceChildren();
      for (let i = 0; i < max; i++) item.pips.append(h('span', 'tf-pip'));
      item.count = max;
    }
    const kids = item.pips.children;
    for (let i = 0; i < kids.length; i++) kids[i]?.classList.toggle('is-full', i < current);
    setAttr(item.el, 'aria-label', `${item.label.textContent ?? ''}: ${current} of ${max}`);
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private createAction(a: HudAction): ActionItem {
    const el = h('button', 'tf-act');
    el.type = 'button';
    const hotkey = h('span', 'tf-act-key');
    const icon = h('span', 'tf-act-icon');
    const name = h('span', 'tf-act-name');
    const cost = h('span', 'tf-act-cost');
    const uses = h('span', 'tf-act-uses');
    el.append(hotkey, icon, name, cost, uses);
    const item: ActionItem = { el, hotkey, icon, name, cost, uses, costKind: '', action: a };
    el.addEventListener('click', () => this.activate(item));
    this.tip.attach(el, () => this.actionTip(item.action), () => this.promptEl.parentElement);
    return item;
  }

  private updateAction(item: ActionItem, a: HudAction, index: number): void {
    item.action = a;
    setText(item.hotkey, index < 9 ? String(index + 1) : '');
    swapIcon(item.icon, a.icon);
    setText(item.name, a.name);
    if (item.costKind !== a.cost) {
      item.costKind = a.cost;
      item.cost.replaceChildren(costMarker(a.cost));
    }
    const hasUses = a.usesLeft !== undefined;
    item.uses.hidden = !hasUses;
    if (hasUses) setText(item.uses, String(a.usesLeft));
    item.el.classList.toggle('is-disabled', !a.enabled);
    item.el.classList.toggle('is-selected', a.selected);
    item.el.classList.toggle('is-empty', hasUses && a.usesLeft === 0);
    setAttr(item.el, 'aria-disabled', a.enabled ? null : 'true');
    setAttr(item.el, 'aria-pressed', String(a.selected));
    const usesText = hasUses ? `, ${a.usesLeft} left` : '';
    const reason = !a.enabled && a.disabledReason ? `, unavailable: ${a.disabledReason}` : '';
    setAttr(item.el, 'aria-label', `${a.name}, ${COST_LABEL[a.cost]}${usesText}${reason}`);
  }

  private actionTip(a: HudAction): TipContent {
    return {
      title: a.name,
      cost: a.cost,
      sub: a.usesLeft !== undefined ? `${a.usesLeft} use${a.usesLeft === 1 ? '' : 's'} left` : undefined,
      body: a.description,
      warn: !a.enabled ? (a.disabledReason ?? 'Not available right now.') : undefined,
    };
  }

  private activate(item: ActionItem): void {
    const a = item.action;
    if (a.selected) this.emit({ type: 'cancel' });
    else if (a.enabled) this.emit({ type: 'selectAction', actionId: a.id });
    else this.tip.flash(item.el);
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || !this.isActive() || !this.model) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    if (typing) return;

    if (e.key === 'Escape') {
      this.tip.hide();
      this.emit({ type: 'cancel' });
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (e.key >= '1' && e.key <= '9') {
      const item = [...this.actionsEl.children][Number(e.key) - 1];
      const found = this.findActionByEl(item);
      if (found) {
        this.activate(found);
        e.preventDefault();
      }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      // A focused button handles Space/Enter itself.
      if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
      const c = this.model.combat;
      if (this.model.mode === 'combat' && c?.playerTurn) {
        this.emit({ type: 'endTurn' });
        e.preventDefault();
      }
    }
  }

  private findActionByEl(el: Element | undefined): ActionItem | undefined {
    if (!el || !this.model) return undefined;
    for (const a of this.model.actions) {
      const it = this.actions.get(a.id);
      if (it && it.el === el) return it;
    }
    return undefined;
  }
}

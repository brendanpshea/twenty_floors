import type { CompanionStance, Condition, MonsterTactic, HudAction, HudInitiativeEntry, HudModel, UiIntent } from '../core/types';
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
  glyph: HTMLElement;
  bar: Bar;
  entry: HudInitiativeEntry;
}

interface PipItem extends ChipItem {
  label: HTMLElement;
  pips: HTMLElement;
  count: number;
}

const STANCES: { id: CompanionStance; label: string; tip: string }[] = [
  { id: 'close', label: 'Close', tip: 'Stay close: fights beside you and guards you' },
  { id: 'back', label: 'Back', tip: 'Hang back: keeps its distance and avoids melee' },
  { id: 'focus', label: 'Focus', tip: 'Focus: attacks whatever you attacked last' },
];

/** "Young White Dragon A" -> "YW\u00b7A", "Goblin Boss" -> "GB", "Wyvern A" -> "W\u00b7A". */
export function tileLabel(name: string, faction: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (faction === 'player') return (words[0]?.charAt(0) ?? '?').toUpperCase();
  let suffix = '';
  if (words.length > 1 && /^[A-Za-z]$/.test(words[words.length - 1] ?? '')) suffix = (words.pop() ?? '').toUpperCase();
  const base = words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return suffix ? `${base}\u00b7${suffix}` : base;
}

const TACTICS: Record<MonsterTactic, { label: string; icon: string; tip: string }> = {
  brute: { label: 'Brute', icon: 'slam', tip: 'Closes in and hits hard; will shove you toward edges' },
  skirmisher: { label: 'Skirmisher', icon: 'dash', tip: 'Strikes and withdraws; looks for the unguarded' },
  archer: { label: 'Archer', icon: 'ranged', tip: 'Keeps its distance and uses cover' },
  caster: { label: 'Caster', icon: 'spell', tip: 'Spells and area attacks from the back' },
  leader: { label: 'Leader', icon: 'star', tip: 'Stays behind its guards' },
  lurker: { label: 'Lurker', icon: 'eye', tip: 'Waits unseen and ambushes' },
  guard: { label: 'Guard', icon: 'shield', tip: 'Holds its post' },
};

const ROLE_LABEL = { healer: 'Healer', blaster: 'Blaster', skirmisher: 'Skirmisher' } as const;

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
  private readonly targetTags = h('div', 'tf-target-tags');
  private readonly coverChip = h('span', 'tf-tag-chip tf-tag-chip--cover');
  private readonly coverText = h('span', 'tf-cover-full');
  private readonly coverShort = h('span', 'tf-cover-short');
  private readonly tacticChip = h('span', 'tf-tag-chip tf-tag-chip--tactic');
  private readonly tacticIcon = h('span', 'tf-tag-icon');
  private readonly tacticText = h('span');
  private tacticKey: MonsterTactic | '' = '';
  private readonly pushLine = h('div', 'tf-target-push');
  private readonly pushText = h('span');

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

  // companion
  private readonly compEl = h('section', 'tf-comp');
  private readonly compRow = h('button', 'tf-comp-row');
  private readonly compPortrait = h('span', 'tf-comp-portrait');
  private readonly compName = h('span', 'tf-comp-name');
  private readonly compLv = h('span', 'tf-comp-lv');
  private readonly compBar = makeBar('tf-bar--hp tf-bar--slim');
  private readonly compHpText = h('div', 'tf-bar-text');
  private readonly compStanceGlyph = h('span', 'tf-comp-stanceglyph');
  private readonly compConds = h('div', 'tf-chips');
  private readonly compCondList: KeyedList<Condition, ChipItem>;
  private readonly compResEl = h('div', 'tf-resources');
  private readonly compResList: KeyedList<{ name: string; current: number; max: number }, PipItem>;
  private readonly compDowned = h('div', 'tf-comp-downed', 'Downed. Back on its feet after the fight.');
  private readonly stanceEl = h('div', 'tf-stance');
  private readonly stanceBtns = new Map<CompanionStance, HTMLButtonElement>();
  private compOpen = false;
  private lastActiveTile = '';
  private readonly atkEl = h('span', 'tf-atk');
  private atkMax = -1;
  private readonly concEl = h('div', 'tf-conc');
  private readonly concName = h('span', 'tf-conc-name');
  private readonly concRounds = h('span', 'tf-conc-rounds');

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
  private readonly restBtn = h('button', 'tf-rest'); // long rest, Rest here
  private readonly shortBtn = h('button', 'tf-shortrest');
  private readonly shortBadge = h('span', 'tf-rest-badge');
  private readonly hdEl = h('div', 'tf-hd');
  private readonly hdText = h('span', 'tf-hd-text');
  private readonly hdDie = h('span', 'tf-hd-die');
  private readonly sites = h('div', 'tf-sites');
  private readonly sitesNum = h('span', 'tf-sites-num');

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
    this.coverChip.append(createIcon('cover'), this.coverText, this.coverShort);
    this.tip.attach(this.coverChip, () => ({
      title: this.coverText.textContent ?? 'Cover',
      body: 'Cover adds to Armor Class and Dexterity saves against you from here',
    }));
    this.tacticChip.append(this.tacticIcon, this.tacticText);
    this.tip.attach(this.tacticChip, () => {
      const t = this.tacticKey ? TACTICS[this.tacticKey] : undefined;
      return t ? { title: t.label, body: t.tip } : null;
    });
    this.targetTags.append(this.coverChip, this.tacticChip);
    this.pushLine.append(createIcon('warn'), this.pushText);
    this.targetEl.append(tHead, this.targetBar.el, this.targetConds, this.targetTags, this.pushLine, this.targetDesc, this.targetHit);
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
    this.hdEl.setAttribute('role', 'img');
    this.hdEl.append(createIcon('dice'), this.hdDie, this.hdText);
    this.tip.attach(this.hdEl, () => ({
      title: `Hit Dice (${this.hdDie.textContent ?? 'd?'})`,
      sub: this.hdText.textContent ?? undefined,
      body: 'Spent on short rests, restored by a long rest.',
    }));
    const statRow = h('div', 'tf-statrow');
    statRow.append(this.hdEl, this.resEl);
    this.concEl.append(createIcon('stance-focus', 'tf-icon tf-conc-icon'), this.concName, this.concRounds);
    this.tip.attach(this.concEl, () => ({
      title: `Concentrating: ${this.concName.textContent ?? ''}`,
      body: 'Concentrating: ends if you cast another concentration spell, fail a Constitution save after taking damage, or are incapacitated.',
    }));
    pMain.append(pHead, this.playerBar.el, this.playerTemp, this.concEl, this.playerConds, statRow);
    player.append(acBadge, pMain);
    this.playerCondList = chipList(this.playerConds);
    this.resList = new KeyedList(
      this.resEl,
      (r) => r.name,
      (r) => this.createPips(r.name),
      (item, r) => this.updatePips(item, r.current, r.max),
    );
    this.buildCompanion();
    this.compCondList = chipList(this.compConds);
    this.compResList = new KeyedList(
      this.compResEl,
      (r) => r.name,
      (r) => this.createPips(r.name),
      (item, r) => this.updatePips(item, r.current, r.max),
    );
    bl.append(this.logEl, this.compEl, player);

    const bc = h('div', 'tf-bc');
    this.promptEl.setAttribute('role', 'status');
    const actionPip = h('div', 'tf-tres');
    actionPip.append(this.pipAction, h('span', 'tf-tres-label', 'Action'), this.atkEl);
    this.atkEl.hidden = true;
    this.tip.attach(this.atkEl, () => ({
      title: 'Attacks left this turn',
      sub: this.model?.combat?.attacksLeft ? `${this.model.combat.attacksLeft.current} of ${this.model.combat.attacksLeft.max}` : undefined,
      body: 'Each attack you make with the Attack action uses one.',
    }));
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
    // Long rest: appears only next to a usable rest site, above the (always present) short rest button.
    this.restBtn.type = 'button';
    this.restBtn.hidden = true;
    this.restBtn.append(createIcon('fire'), h('span', 'tf-rest-label', 'Rest here'));
    this.restBtn.addEventListener('click', () => this.emit({ type: 'longRest' }));
    this.tip.attach(this.restBtn, () => ({
      title: 'Rest here',
      body: 'A rest site fully restores you: health, Hit Dice and all abilities. It can be used once.',
    }));

    this.shortBtn.type = 'button';
    this.shortBtn.append(createIcon('rest'), h('span', 'tf-rest-label', 'Short Rest'), this.shortBadge);
    this.shortBtn.addEventListener('click', () => {
      if (this.shortBtn.getAttribute('aria-disabled') === 'true') {
        this.tip.flash(this.shortBtn);
        return;
      }
      this.emit({ type: 'shortRest' });
    });
    this.tip.attach(this.shortBtn, () => {
      const m = this.model;
      if (!m) return null;
      const blocked = this.shortBtn.getAttribute('aria-disabled') === 'true';
      return {
        title: 'Short Rest',
        sub: `${m.shortRestsLeft} left before your next long rest`,
        body: 'Spend Hit Dice to recover health and regain short-rest abilities. Not possible with an enemy in view.',
        warn: blocked ? (m.shortRestBlockedReason ?? 'Not available right now.') : undefined,
      };
    });

    this.sites.setAttribute('role', 'img');
    this.sites.append(createIcon('fire'), this.sitesNum);
    this.tip.attach(this.sites, () => ({
      title: 'Rest sites',
      sub: `${this.model?.restSitesLeft ?? 0} left on this floor`,
      body: 'Rest sites left on this floor. A rest site fully restores you, once.',
    }));
    tl.append(this.sites);
    br.append(this.endTurn, this.restBtn, this.shortBtn);

    bottom.append(bl, bc, br);
    this.el.append(top, bottom);

    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // -------------------------------------------------------------------------
  // Companion
  // -------------------------------------------------------------------------

  private buildCompanion(): void {
    this.compEl.hidden = true;
    const row = this.compRow;
    row.type = 'button';
    this.compPortrait.append(createIcon('role-healer'));
    const main = h('span', 'tf-comp-main');
    const head = h('span', 'tf-comp-head');
    head.append(this.compName, this.compLv);
    this.compBar.el.append(this.compHpText);
    main.append(head, this.compBar.el);
    const chev = createIcon('chevron', 'tf-icon tf-comp-chev');
    row.append(this.compPortrait, main, this.compStanceGlyph, chev);
    row.addEventListener('click', () => {
      if (!this.compEl.classList.contains('is-compact')) return;
      this.compOpen = !this.compOpen;
      this.compEl.classList.toggle('is-open', this.compOpen);
      row.setAttribute('aria-expanded', String(this.compOpen));
    });
    const more = h('div', 'tf-comp-more');
    more.append(this.compConds, this.compResEl, this.compDowned);
    this.stanceEl.setAttribute('role', 'radiogroup');
    this.stanceEl.setAttribute('aria-label', 'Companion stance');
    for (const s of STANCES) {
      const b = h('button', 'tf-stance-btn');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset['key'] = `stance-${s.id}`;
      b.append(createIcon(`stance-${s.id}`), h('span', undefined, s.label));
      b.setAttribute('aria-label', `${s.label}: ${s.tip}`);
      b.addEventListener('click', () => this.emit({ type: 'setStance', stance: s.id }));
      this.tip.attach(b, () => ({ title: s.label, body: s.tip }));
      this.stanceBtns.set(s.id, b);
      this.stanceEl.append(b);
    }
    this.compEl.append(row, more, this.stanceEl);
  }

  private syncCompanion(m: HudModel): void {
    const c = m.companion;
    this.compEl.hidden = !c;
    this.el.classList.toggle('has-companion', !!c);
    if (!c) return;
    const compact = window.matchMedia('(max-width: 820px), (max-height: 520px)').matches;
    this.compEl.classList.toggle('is-compact', compact);
    this.compEl.classList.toggle('is-open', compact && this.compOpen);
    this.compEl.classList.toggle('is-downed', c.downed);
    swapIcon(this.compPortrait, `role-${c.role}`);
    setText(this.compName, c.name);
    setText(this.compLv, `Lv ${c.level}`);
    setBar(this.compBar, c.downed || c.maxHp <= 0 ? 0 : c.hp / c.maxHp);
    setText(this.compHpText, c.downed ? 'Downed' : `${c.hp} / ${c.maxHp}`);
    swapIcon(this.compStanceGlyph, `stance-${c.stance}`);
    this.compCondList.sync(c.conditions);
    this.compConds.hidden = c.conditions.length === 0;
    this.compResList.sync(c.resources);
    this.compResEl.hidden = c.resources.length === 0;
    this.compDowned.hidden = !c.downed;
    setAttr(this.compRow, 'aria-label', `${c.name}, ${ROLE_LABEL[c.role]}, level ${c.level}`);
    for (const [id, b] of this.stanceBtns) {
      const on = id === c.stance;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    }
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
    this.syncCompanion(m);
    const conc = m.concentration;
    if (conc) {
      setText(this.concName, conc.spellName);
      setText(this.concRounds, `${conc.roundsLeft} round${conc.roundsLeft === 1 ? '' : 's'}`);
      setAttr(this.concEl, 'aria-label', `Concentrating on ${conc.spellName}, ${conc.roundsLeft} rounds left`);
    }
    this.concEl.classList.toggle('is-on', !!conc);
    this.syncTarget(m);
    this.actions.sync(m.actions);
    this.actionsEl.classList.toggle('is-many', m.actions.length > 5);
    this.updateOverflowHint();
    this.fitActions(m.actions.length);
    this.syncLog(m.log);

    const prompt = m.prompt ?? '';
    setText(this.promptEl, prompt);
    this.promptEl.classList.toggle('is-open', prompt !== '');

    // Rest controls (exploring only): short rest always present; long rest only beside a usable site.
    setText(this.sitesNum, String(m.restSitesLeft));
    setAttr(this.sites, 'aria-label', `${m.restSitesLeft} rest sites left on this floor`);
    this.sites.classList.toggle('is-none', m.restSitesLeft <= 0);
    this.restBtn.hidden = !(m.canLongRest && !combat);
    setText(this.shortBadge, String(m.shortRestsLeft));
    setAttr(this.shortBtn, 'aria-disabled', m.canShortRest ? null : 'true');
    this.shortBtn.classList.toggle('is-disabled', !m.canShortRest);
    setText(this.hdText, `${m.hitDice.current}/${m.hitDice.max}`);
    setAttr(this.hdEl, 'aria-label', `Hit Dice d${m.hitDice.die}: ${m.hitDice.current} of ${m.hitDice.max}`);
    setText(this.hdDie, `d${m.hitDice.die}`);

    this.tip.refresh();
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
    this.initList.classList.toggle('is-dense', c.initiative.length > 8);
    const active = c.initiative.find((e) => e.active)?.id ?? '';
    if (active !== this.lastActiveTile) {
      this.lastActiveTile = active;
      const el = this.tiles.get(active)?.el;
      if (el) {
        const list = this.initList;
        list.scrollLeft = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      }
    }
    const atk = c.attacksLeft;
    this.atkEl.hidden = !atk;
    if (atk) {
      if (this.atkMax !== atk.max) {
        this.atkMax = atk.max;
        this.atkEl.replaceChildren();
        for (let i = 0; i < atk.max; i++) this.atkEl.append(createIcon('melee', 'tf-icon tf-atk-pip'));
      }
      const kids = this.atkEl.children;
      for (let i = 0; i < kids.length; i++) kids[i]?.classList.toggle('is-spent', i >= atk.current);
      setAttr(this.atkEl, 'aria-label', `Attacks left this turn: ${atk.current} of ${atk.max}`);
    }
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
    const friendly = t.faction !== undefined ? t.faction === 'ally' || t.faction === 'player' : !!m.companion && m.companion.name === t.name;
    this.targetEl.classList.toggle('is-friendly', friendly);
    setText(this.targetName, t.name);
    setText(this.targetAcNum, String(t.ac));
    setBar(this.targetBar, t.maxHp > 0 ? t.hp / t.maxHp : 0);
    setText(this.targetHpText, `${t.hp} / ${t.maxHp}`);
    this.targetCondList.sync(t.conditions);
    this.targetConds.hidden = t.conditions.length === 0;
    setText(this.targetDesc, t.description ?? '');
    this.targetDesc.hidden = !t.description;
    // Tactical info (enemies only)
    const cover = !friendly && (t.cover === 2 || t.cover === 5) ? t.cover : 0;
    this.coverChip.hidden = cover === 0;
    if (cover) {
      setText(this.coverText, cover === 2 ? 'Half cover +2' : 'Three-quarters cover +5');
      setText(this.coverShort, cover === 2 ? '½ cover +2' : '¾ cover +5');
    }
    const tac = !friendly && t.tactic ? t.tactic : undefined;
    this.tacticChip.hidden = !tac;
    if (tac) {
      this.tacticKey = tac;
      setText(this.tacticText, TACTICS[tac].label);
      swapIcon(this.tacticIcon, TACTICS[tac].icon);
    }
    this.targetTags.hidden = cover === 0 && !tac;
    const push = !friendly ? t.pushInto : undefined;
    this.pushLine.hidden = !push || push.hazard === 'none';
    if (push && push.hazard !== 'none') {
      const text =
        push.hazard === 'fall'
          ? `Shove \u2192 falls: ${push.damage}`
          : push.hazard === 'lava'
            ? `Shove \u2192 lava: ${push.damage}`
            : `Shove \u2192 ${push.hazard}`;
      setText(this.pushText, text);
    }
    const hit = friendly ? undefined : t.hitChance;
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
    const glyph = h('span', 'tf-tile-glyph');
    glyph.hidden = true;
    const bar = makeBar('tf-bar--mini');
    el.append(letter, glyph, bar.el);
    const item: TileItem = { el, letter, glyph, bar, entry: e };
    el.addEventListener('click', () => this.emit({ type: 'selectCreature', creatureId: item.entry.id }));
    this.tip.attach(el, () => ({
      title: item.entry.name,
      sub: item.entry.dead ? 'Fallen' : `${Math.round(item.entry.hpFraction * 100)}% health`,
    }));
    return item;
  }

  private updateTile(item: TileItem, e: HudInitiativeEntry): void {
    item.entry = e;
    const comp = e.faction === 'ally' && this.model?.companion?.name === e.name ? this.model.companion : undefined;
    const cls = `tf-tile tf-tile--${e.faction}${comp ? ' is-companion' : ''}${e.active ? ' is-active' : ''}${e.dead ? ' is-dead' : ''}`;
    if (item.el.className !== cls) item.el.className = cls;
    const label = tileLabel(e.name, e.faction);
    setText(item.letter, label);
    item.letter.dataset['len'] = String(label.length);
    item.letter.hidden = !!comp;
    item.glyph.hidden = !comp;
    if (comp) swapIcon(item.glyph, `role-${comp.role}`);
    setBar(item.bar, e.dead ? 0 : e.hpFraction);
    setAttr(item.el, 'aria-label', `${e.name}${e.active ? ', active' : ''}${e.dead ? ', fallen' : ''}`);
    setAttr(item.el, 'data-name', e.name);
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
    if ((e.key === 'c' || e.key === 'C') && this.model.companion) {
      const order = STANCES.map((s) => s.id);
      const next = order[(order.indexOf(this.model.companion.stance) + 1) % order.length];
      if (next) this.emit({ type: 'setStance', stance: next });
      e.preventDefault();
      return;
    }
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

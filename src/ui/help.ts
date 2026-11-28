import { PUZZLE_KINDS, type PuzzleKind } from '../puzzles';
import { openTutorial } from './puzzles/tutorial';
import type { HelpMode, HintRequest } from '../core/types';
import { button, clamp, h } from './dom';
import { termify } from './glossary';
import { createIcon } from './icons';

// ---------------------------------------------------------------------------
// Help choice
// ---------------------------------------------------------------------------

export function buildHelpChoice(done: (mode: HelpMode) => void): HTMLElement {
  const root = h('div', 'tf-screen tf-screen--creation tf-screen--helpchoice');
  const box = h('main', 'tf-helpchoice');
  const bulb = h('div', 'tf-title-crest');
  bulb.append(createIcon('bulb', 'tf-icon'));
  box.append(bulb, h('h1', 'tf-helpchoice-title', 'New to this kind of game?'), h('div', 'tf-rule'));
  const row = h('div', 'tf-helpchoice-row');
  const mk = (mode: HelpMode, title: string, text: string, primary: boolean): HTMLButtonElement => {
    const b = h('button', `tf-helpcard${primary ? ' is-primary' : ''}`);
    b.type = 'button';
    b.dataset['key'] = `help-${mode}`;
    b.append(h('span', 'tf-helpcard-title', title), h('span', 'tf-helpcard-text', text));
    b.addEventListener('click', () => done(mode));
    return b;
  };
  const guided = mk('guided', 'Guide me', 'Explains things as they come up and suggests moves.', true);
  const standard = mk('standard', 'I know what I’m doing', 'Only first-time hints about the controls.', false);
  row.append(guided, standard);
  box.append(row, h('p', 'tf-helpchoice-note', 'You can change this any time in the menu.'));
  root.append(box);
  queueMicrotask(() => guided.focus({ preventScroll: true }));
  return root;
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

export interface ConfirmQ {
  title: string;
  lines: string[];
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  rememberKey?: string;
  /** A third choice (between cancel and confirm); it resolves with `alt: true`. */
  altLabel?: string;
}

export function buildConfirm(q: ConfirmQ, done: (r: { ok: boolean; remember: boolean; alt?: boolean }) => void): HTMLElement {
  const root = h('div', 'tf-confirm');
  const box = h('div', 'tf-modal tf-confirm-box');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', q.title);
  box.append(h('h2', 'tf-modal-title tf-confirm-title', q.title));
  const gains = h('ul', 'tf-confirm-list');
  for (const l of q.lines) gains.append(h('li', undefined, l));
  if (q.lines.length) box.append(gains);
  if (q.warning) {
    const w = h('div', 'tf-confirm-warning');
    w.append(createIcon('warn'), h('span', undefined, q.warning));
    box.append(w);
  }
  let remember: HTMLInputElement | null = null;
  if (q.rememberKey) {
    const label = h('label', 'tf-check');
    remember = h('input');
    remember.type = 'checkbox';
    remember.dataset['key'] = 'remember';
    label.append(remember, h('span', undefined, 'Don’t ask again'));
    box.append(label);
  }
  const finish = (ok: boolean): void => done({ ok, remember: ok && !!remember?.checked });
  const row = h('div', 'tf-confirm-row');
  const cancel = button('tf-btn', q.cancelLabel ?? 'Cancel', () => finish(false));
  cancel.dataset['key'] = 'cancel';
  const ok = button('tf-btn tf-btn--primary', q.confirmLabel, () => finish(true));
  ok.dataset['key'] = 'confirm';
  if (q.altLabel) {
    const alt = button('tf-btn', q.altLabel, () => done({ ok: false, remember: false, alt: true }));
    alt.dataset['key'] = 'alt';
    row.append(cancel, alt, ok);
  } else row.append(cancel, ok);
  box.append(row);
  root.append(box);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      finish(true);
    }
  });
  queueMicrotask(() => ok.focus({ preventScroll: true }));
  return root;
}

// ---------------------------------------------------------------------------
// How to play
// ---------------------------------------------------------------------------

interface Section {
  icons: string[];
  title: string;
  text: string;
}

const SECTIONS: Section[] = [
  {
    icons: ['dash'],
    title: 'Moving and the camera',
    text: 'Click or tap the floor to walk there. Drag to turn the view; scroll or pinch to zoom.',
  },
  {
    icons: ['cost-action', 'cost-bonus'],
    title: 'Your turn',
    text: 'Each turn you get one action, one bonus action and some movement. The markers above the action bar show what is left. End Turn (Space) passes the turn.',
  },
  {
    icons: ['melee', 'ranged'],
    title: 'Attacking and hit chance',
    text: 'Pick an attack, then pick an enemy. The target panel shows your hit chance: higher is better. Armor Class is how hard something is to hit.',
  },
  {
    icons: ['heal', 'potion'],
    title: 'Staying alive',
    text: 'Second Wind and potions heal you. At 0 HP you get a Last Stand, a final moment to fight on.',
  },
  {
    icons: ['rest', 'fire'],
    title: 'Resting',
    text: 'A short rest spends Hit Dice to heal, but not with an enemy in view. A long rest at a campfire restores everything, once per campfire.',
  },
  {
    icons: ['shove', 'cover'],
    title: 'Terrain',
    text: 'Shove pushes an enemy; shove one off an edge and it falls. Standing behind cover makes you harder to hit.',
  },
  {
    icons: ['role-healer', 'stance-focus'],
    title: 'Your companion',
    text: 'From level 4 an ally fights beside you. Choose its stance: Close, Back or Focus.',
  },
  {
    icons: ['up', 'coin'],
    title: 'Levelling and the shop',
    text: 'Clear a floor to level up. Between floors, spend gold: the shop tells you whether an item is an upgrade for your build.',
  },
];

function diagramIcon(key: string): HTMLElement {
  if (key === 'cost-action' || key === 'cost-bonus') {
    const s = h('span', `tf-tpip ${key === 'cost-action' ? 'tf-tpip--action' : 'tf-tpip--bonus'}`);
    return s;
  }
  const w = h('span', 'tf-howto-glyph');
  w.append(createIcon(key));
  return w;
}

const PRACTICE_NAME: Record<PuzzleKind, string> = {
  runes: 'Rune Lock',
  tumblers: 'Tumbler Lock',
  conduits: 'Conduit Lock',
  wards: 'Ward Lock',
};

export function buildHowTo(onBack: () => void, backLabel = 'Back'): HTMLElement {
  const root = h('div', 'tf-howto');
  const head = h('header', 'tf-create-head');
  head.append(h('h1', 'tf-create-title', 'How to play'));
  const body = h('main', 'tf-howto-body');
  for (const s of SECTIONS) {
    const sec = h('section', 'tf-panel tf-howto-sec');
    const icons = h('div', 'tf-howto-icons');
    for (const k of s.icons) icons.append(diagramIcon(k));
    const txt = h('div', 'tf-howto-text');
    const p = h('p');
    p.append(termify(s.text));
    txt.append(h('h2', 'tf-panel-title', s.title), p);
    sec.append(icons, txt);
    body.append(sec);
  }
  // Chest locks: each kind can be practised, untimed, any time.
  const locks = h('section', 'tf-panel tf-howto-sec tf-howto-locks');
  const ltxt = h('div', 'tf-howto-text');
  const lp = h('p');
  lp.append(termify('Chests are locked by small puzzles. Solve one quickly for better loot, or force it open for a little. Practise any lock here, with no timer:'));
  const lrow = h('div', 'tf-howto-lockbtns');
  for (const kind of PUZZLE_KINDS) {
    const b = button('tf-btn', `${PRACTICE_NAME[kind]}`, () => void openTutorial(kind));
    b.dataset['key'] = `practise-${kind}`;
    lrow.append(b);
  }
  ltxt.append(h('h2', 'tf-panel-title', 'Chest locks'), lp, lrow);
  const licons = h('div', 'tf-howto-icons');
  licons.append(diagramIcon('coin'));
  locks.append(licons, ltxt);
  body.append(locks);
  const foot = h('footer', 'tf-create-foot');
  const back = button('tf-btn tf-btn--primary', backLabel, onBack);
  back.dataset['key'] = 'howto-back';
  foot.append(h('div', 'tf-spacer'), back);
  root.append(head, body, foot);
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    }
  });
  queueMicrotask(() => back.focus({ preventScroll: true }));
  return root;
}

export function howToWordCount(): number {
  return SECTIONS.reduce((n, s) => n + (s.title + ' ' + s.text).split(/\s+/).length, 0);
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

type Anchor = NonNullable<HintRequest['anchor']>;
type CloseResult = 'dismissed' | 'tipsOff';

interface Current {
  hint: HintRequest;
  el: HTMLElement;
  arrow: HTMLElement;
  onClose?: (r: CloseResult) => void;
  anchorEl: HTMLElement | null;
  timer: number;
  rectKey: string;
}

const TOP_ANCHORS = new Set(['target', 'initiative']);

/**
 * One non-modal callout at a time. It points at an element of the HUD, follows
 * it if the bar re-lays out, and never takes keyboard focus.
 */
export class HintManager {
  private cur: Current | null = null;
  private raf = 0;

  constructor(
    private readonly layer: HTMLElement,
    private readonly getAnchor: (a: Anchor) => HTMLElement | null,
    private readonly topBottom: () => number,
  ) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.cur) this.close('dismissed');
    });
    window.addEventListener('resize', () => this.place());
  }

  get currentId(): string | null {
    return this.cur?.hint.id ?? null;
  }

  show(hint: HintRequest, onClose?: (r: CloseResult) => void): void {
    this.remove(true);
    const el = h('div', 'tf-hintbox');
    el.setAttribute('role', 'status');
    const arrow = h('span', 'tf-hintbox-arrow');
    if (hint.title) el.append(h('div', 'tf-hintbox-title', hint.title));
    const text = h('div', 'tf-hintbox-text');
    text.append(termify(hint.text));
    el.append(text);
    const row = h('div', 'tf-hintbox-row');
    const got = button('tf-hintbox-got', 'Got it', () => this.close('dismissed'));
    const off = button('tf-hintbox-off', 'Turn tips off', () => this.close('tipsOff'));
    row.append(got, off);
    el.append(row, arrow);
    this.layer.append(el);
    const anchorEl = hint.anchor && hint.anchor !== 'center' ? this.getAnchor(hint.anchor) : null;
    anchorEl?.classList.add('tf-hint-target');
    this.cur = { hint, el, arrow, onClose, anchorEl, timer: 0, rectKey: '' };
    if (hint.seconds) this.cur.timer = window.setTimeout(() => this.close('dismissed'), hint.seconds * 1000);
    this.place();
    requestAnimationFrame(() => el.classList.add('is-in'));
    this.poll();
  }

  clear(id: string): void {
    if (this.cur && this.cur.hint.id === id) this.remove(false);
  }

  private close(result: CloseResult): void {
    const c = this.cur;
    if (!c) return;
    this.remove(false);
    c.onClose?.(result);
  }

  /** Remove the current hint; `quick` is the cross-fade used when another hint replaces it. */
  private remove(quick: boolean): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    window.clearTimeout(c.timer);
    cancelAnimationFrame(this.raf);
    c.anchorEl?.classList.remove('tf-hint-target');
    c.el.classList.remove('is-in');
    c.el.classList.add('is-out');
    c.el.setAttribute('inert', '');
    window.setTimeout(() => c.el.remove(), quick ? 130 : 200);
  }

  /** Follow the anchor if its position changes (the action bar re-laying out). */
  private poll(): void {
    const c = this.cur;
    if (!c) return;
    const a = this.currentAnchor(c);
    const r = a?.getBoundingClientRect();
    const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : 'none';
    if (key !== c.rectKey) this.place();
    this.raf = requestAnimationFrame(() => this.poll());
  }

  private currentAnchor(c: Current): HTMLElement | null {
    const a = c.hint.anchor;
    if (!a || a === 'center') return null;
    const el = this.getAnchor(a);
    if (el !== c.anchorEl) {
      c.anchorEl?.classList.remove('tf-hint-target');
      el?.classList.add('tf-hint-target');
      c.anchorEl = el;
    }
    return el;
  }

  private place(): void {
    const c = this.cur;
    if (!c) return;
    const { el, arrow } = c;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const phone = window.matchMedia('(max-width: 640px)').matches;
    const compact = phone || window.matchMedia('(max-height: 520px)').matches;
    const pad = 8;
    const anchor = this.currentAnchor(c);
    const r = anchor && !anchor.hidden && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
    c.rectKey = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : 'none';
    el.style.width = phone ? `${vw - 2 * pad}px` : `${Math.min(compact ? 380 : 320, vw - 2 * pad)}px`;
    el.classList.toggle('is-dock', compact);
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let left = (vw - w) / 2;
    let top = 0;
    let dir: 'down' | 'up' | 'none' = 'none';
    if (!r) {
      top = Math.max(pad, this.topBottom() + 6);
    } else if (TOP_ANCHORS.has(typeof c.hint.anchor === 'string' ? c.hint.anchor : '')) {
      top = r.bottom + 12;
      dir = 'up';
      left = phone ? pad : clamp(r.left + r.width / 2 - w / 2, pad, vw - w - pad);
    } else {
      // Above the anchor; for the action bar, above the prompt/resources stack too.
      // On phones, dock above the whole bottom HUD so no panel is covered.
      const stack = compact ? anchor?.closest('.tf-hud-bottom') : anchor?.closest('.tf-bc');
      const edge = stack ? Math.min(r.top, stack.getBoundingClientRect().top) : r.top;
      top = edge - hgt - 12;
      dir = 'down';
      left = phone ? pad : clamp(r.left + r.width / 2 - w / 2, pad, vw - w - pad);
      if (top < pad) {
        top = r.bottom + 12;
        dir = 'up';
      }
    }
    top = clamp(top, pad, Math.max(pad, vh - hgt - pad));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    arrow.hidden = dir === 'none' || !r;
    if (r && dir !== 'none') {
      el.dataset['dir'] = dir;
      arrow.style.left = `${Math.round(clamp(r.left + r.width / 2 - left, 18, w - 18))}px`;
    }
  }
}

/**
 * The puzzle modal. `createPuzzleView(root).play(spec | instance, opts)` resolves with a PuzzleResult.
 * Pure view: all rules live in src/puzzles; this file owns time, layout and input.
 */
import './puzzles.css';
import {
  apply,
  generatePuzzle,
  gradeResult,
  hint,
  isFailed,
  isSolved,
  mistakes as stateMistakes,
  prospectiveGrade,
  solve as solveFor,
  start,
  timeThresholds,
} from '../../puzzles';
import type { Grade, PuzzleInstance, PuzzleKind, PuzzleMove, PuzzleResult, PuzzleSpec, PuzzleState } from '../../puzzles';
import { createBoard } from './boards';
import { RunClock } from './clock';
import type { Board } from './boards';
import { buildExplainerCard } from './explainer';
import { buildTutorial } from './tutorial';
import { hourglass, padlock } from './glyphs';
import { btn, fmtTime, h, reducedMotion } from './util';

export interface PuzzleRewards {
  gold: string;
  silver: string;
  bronze: string;
  skip: string;
}

export interface PlayOptions {
  /** The chest's name, e.g. "Ironbound Chest". */
  title?: string;
  /** One line of flavour under the title. */
  flavor?: string;
  /** Offer "Force the lock" (default true). */
  allowSkip?: boolean;
  /** What each grade pays, shown beside the timer. */
  rewards?: PuzzleRewards;
  /** Kinds the player has already met; others get the first-time explainer. */
  seenKinds?: readonly PuzzleKind[];
  /** A boss chest: gilded frame and a "boss's hoard" line. */
  boss?: boolean;
  /** Show the explainer even if the kind was seen (dev). */
  forceExplainer?: boolean;
  /** Called when the view showed a first-time explainer for this kind. */
  onExplainerShown?: (kind: PuzzleKind) => void;
}

export interface PuzzleView {
  play(spec: PuzzleSpec | PuzzleInstance, opts?: PlayOptions): Promise<PuzzleResult>;
  /** Abandon the current puzzle; its promise resolves as skipped with no reward grade. */
  close(): void;
  /** Dev/test hooks used by the preview page. */
  debug: {
    /** Play this fraction (0..1) of the solver's moves through the normal input path. */
    autoplay(fraction: number): void;
    openSkipConfirm(): void;
  };
}

const GRADE_LABEL: Record<Grade, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', none: 'Nothing' };

function isInstance(x: PuzzleSpec | PuzzleInstance): x is PuzzleInstance {
  return 'data' in x && 'solution' in x;
}

interface Active {
  finish(outcome: 'skipped'): void;
  autoplay(fraction: number): void;
  openSkip(): void;
  dispose(): void;
}

export function createPuzzleView(root: HTMLElement): PuzzleView {
  let active: Active | null = null;

  function play(spec: PuzzleSpec | PuzzleInstance, opts: PlayOptions = {}): Promise<PuzzleResult> {
    active?.finish('skipped');
    active?.dispose();
    active = null;
    const inst = isInstance(spec) ? spec : generatePuzzle(spec);
    return new Promise<PuzzleResult>((resolve) => {
      active = mount(root, inst, opts, (r) => {
        active?.dispose();
        active = null;
        resolve(r);
      });
    });
  }

  return {
    play,
    close() {
      active?.finish('skipped');
    },
    debug: {
      autoplay: (f) => active?.autoplay(f),
      openSkipConfirm: () => active?.openSkip(),
    },
  };
}

function mount(root: HTMLElement, inst: PuzzleInstance, opts: PlayOptions, resolve: (r: PuzzleResult) => void): Active {
  const allowSkip = opts.allowSkip !== false;
  const rewards = opts.rewards;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // ----- session state -----
  let state: PuzzleState = start(inst);
  let carryMistakes = 0;
  let carryMoves = 0;
  let hintsUsed = 0;
  let finished = false;
  let blockers = 0; // open dialogs (input is ignored while any is open)
  const clock = new RunClock(() => performance.now(), document.hidden);
  let resetArmed = false;
  let resetTimer = 0;

  const seconds = (): number => clock.seconds();
  const liveMistakes = (): number => carryMistakes + stateMistakes(state);
  const liveMoves = (): number => carryMoves + state.moves;

  // ----- DOM -----
  const wrap = h('div', 'tf-pz');
  wrap.setAttribute('role', 'presentation');
  const panel = h('div', 'tf-pz-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const titleText = opts.title ?? inst.title;
  const titleId = `tf-pz-title-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('aria-labelledby', titleId);

  const head = h('header', 'tf-pz-head');
  const headText = h('div', 'tf-pz-headtext');
  if (opts.boss) {
    panel.classList.add('is-boss');
    headText.appendChild(h('div', 'tf-pz-boss', "The boss's hoard"));
  }
  if (opts.title) headText.appendChild(h('div', 'tf-pz-kicker', inst.title));
  const titleEl = h('h2', 'tf-pz-title', titleText);
  titleEl.id = titleId;
  headText.appendChild(titleEl);
  if (opts.flavor) headText.appendChild(h('p', 'tf-pz-flavor', opts.flavor));
  headText.appendChild(h('p', 'tf-pz-instruction', inst.instruction));
  const helpBtn = btn('tf-pz-icon', '?', () => openExplainer(false), 'How this lock works');
  head.append(headText, helpBtn);

  const main = h('div', 'tf-pz-main');
  const stage = h('div', 'tf-pz-stage');
  const side = h('aside', 'tf-pz-side');
  main.append(stage, side);

  const live = h('div', 'tf-pz-live');
  live.setAttribute('aria-live', 'polite');

  const board: Board = createBoard(inst, {
    dispatch: (m) => dispatch(m),
    state: () => state,
    say: (msg) => announce(msg),
  });
  stage.appendChild(board.el);
  if (board.tools) stage.appendChild(board.tools);

  // Timer block
  const th = timeThresholds(inst);
  const barMax = th.silver * 1.25;
  const timer = h('div', 'tf-pz-timer');
  const trow = h('div', 'tf-pz-trow');
  const timeText = h('span', 'tf-pz-time', '0:00');
  const hint0 = h('span', 'tf-pz-timehint', 'Timer starts on your first move');
  trow.append(hourglass(), timeText, hint0);
  const bar = h('div', 'tf-pz-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Gold under ${fmtTime(th.gold)}, silver under ${fmtTime(th.silver)}. The timer never ends the lock.`);
  const fill = h('div', 'tf-pz-fill');
  const markG = h('div', 'tf-pz-mark tf-pz-mark--gold');
  markG.style.left = `${(th.gold / barMax) * 100}%`;
  const markS = h('div', 'tf-pz-mark tf-pz-mark--silver');
  markS.style.left = `${(th.silver / barMax) * 100}%`;
  bar.append(fill, markG, markS);
  const labels = h('div', 'tf-pz-barlabels');
  const lg = h('span', 'tf-pz-barlabel', `Gold ${fmtTime(th.gold)}`);
  lg.style.left = `${(th.gold / barMax) * 100}%`;
  const ls = h('span', 'tf-pz-barlabel', `Silver ${fmtTime(th.silver)}`);
  ls.style.left = `${(th.silver / barMax) * 100}%`;
  labels.append(lg, ls);
  timer.append(trow, bar, labels);

  // Grades
  const gradesBox = h('div', 'tf-pz-grades');
  gradesBox.setAttribute('aria-label', 'What each grade pays');
  const rows: Record<string, HTMLElement> = {};
  const gradeRow = (key: 'gold' | 'silver' | 'bronze' | 'skip', name: string, when: string, pay: string | undefined): void => {
    const row = h('div', `tf-pz-grade tf-pz-grade--${key}`);
    row.appendChild(h('span', 'tf-pz-medal'));
    const txt = h('span', 'tf-pz-gtext');
    txt.appendChild(h('span', 'tf-pz-gname', name));
    txt.appendChild(h('span', 'tf-pz-gwhen', when));
    row.appendChild(txt);
    if (pay) row.appendChild(h('span', 'tf-pz-gpay', pay));
    rows[key] = row;
    gradesBox.appendChild(row);
  };
  gradeRow('gold', 'Gold', `under ${fmtTime(th.gold)}`, rewards?.gold);
  gradeRow('silver', 'Silver', `under ${fmtTime(th.silver)}`, rewards?.silver);
  gradeRow('bronze', 'Bronze', 'any time', rewards?.bronze);
  if (allowSkip) gradeRow('skip', 'Forced', 'skip the puzzle', rewards?.skip);

  const meters = h('div', 'tf-pz-meters');

  const actions = h('div', 'tf-pz-actions');
  const hintBtn = h('button', 'tf-pz-btn tf-pz-btn--hint');
  hintBtn.type = 'button';
  hintBtn.addEventListener('click', () => useHint());
  const resetBtn = h('button', 'tf-pz-btn');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => reset());
  actions.append(hintBtn, resetBtn);
  const forceBtn = btn('tf-pz-btn tf-pz-btn--danger', 'Force the lock', () => openSkip());
  if (allowSkip) actions.appendChild(forceBtn);
  side.append(timer, gradesBox, meters, actions);

  panel.append(head, main);
  wrap.append(panel, live);
  root.appendChild(wrap);

  // ----- HUD -----
  const meterEls = new Map<string, HTMLElement>();
  function meter(key: string, label: string, value: string, bump = false): void {
    let el = meterEls.get(key);
    if (!el) {
      el = h('div', 'tf-pz-meter');
      el.appendChild(h('span', 'tf-pz-mlabel'));
      el.appendChild(h('span', 'tf-pz-mvalue'));
      meters.appendChild(el);
      meterEls.set(key, el);
    }
    const [l, v] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement];
    if (l.textContent !== label) l.textContent = label;
    if (v.textContent !== value) {
      v.textContent = value;
      if (bump && !reducedMotion()) {
        el.classList.remove('is-bump');
        void el.offsetWidth;
        el.classList.add('is-bump');
      }
    }
  }

  function hintCostText(): string {
    return hintsUsed === 0 ? 'best grade: silver' : 'best grade: bronze';
  }

  let lastMistakeCount = 0;
  function refresh(): void {
    const t = seconds();
    timeText.textContent = fmtTime(t);
    fill.style.width = `${Math.min(1, t / barMax) * 100}%`;
    const zone = t <= th.gold ? 'gold' : t <= th.silver ? 'silver' : 'bronze';
    if (fill.dataset.zone !== zone) fill.dataset.zone = zone;
    hint0.hidden = clock.started;
    const moves = liveMoves();
    const g = prospectiveGrade(inst, { seconds: t, mistakes: liveMistakes(), hintsUsed, moves });
    for (const k of ['gold', 'silver', 'bronze'] as const) {
      rows[k]?.classList.toggle('is-now', k === g && !finished);
      rows[k]?.classList.toggle('is-lost', rank(k) > rank(g));
    }
    const mis = liveMistakes();
    switch (state.kind) {
      case 'tumblers':
        meter('left', 'Tries left', `${Math.max(0, state.inst.data.maxGuesses - state.guesses.length)} of ${state.inst.data.maxGuesses}`, false);
        meter('par', 'Gold', `within ${inst.parMoves ?? 0} tries`);
        break;
      case 'conduits':
        meter('turns', 'Turns', String(moves), false);
        meter('par', 'Gold', `within ${inst.parMoves ?? 0} turns`);
        break;
      case 'wards': {
        const marked = state.cells.filter((c) => c === 2 || c === 3).length;
        meter('traps', 'Traps left', String(Math.max(0, state.inst.data.mineCount - marked)));
        meter('mistakes', 'Mistakes', String(mis), mis > lastMistakeCount);
        break;
      }
      default:
        meter('mistakes', 'Mistakes', String(mis), mis > lastMistakeCount);
    }
    lastMistakeCount = mis;
    hintBtn.textContent = '';
    hintBtn.append(h('span', 'tf-pz-bt', 'Hint'), h('span', 'tf-pz-bs', hintCostText()));
    hintBtn.setAttribute('aria-label', `Hint, costs a grade: ${hintCostText()}`);
    resetBtn.textContent = state.kind === 'tumblers' ? 'Clear row' : resetArmed ? 'Sure? Tap again' : 'Reset';
    resetBtn.classList.toggle('is-armed', resetArmed);
  }
  const rank = (g: Grade): number => ({ gold: 0, silver: 1, bronze: 2, none: 3 })[g];

  function announce(msg: string): void {
    live.textContent = '';
    window.setTimeout(() => {
      live.textContent = msg;
    }, 30);
  }

  // ----- play -----
  function dispatch(move: PuzzleMove): void {
    if (finished || blockers > 0) return;
    clock.start();
    const before = state;
    state = apply(state, move);
    if (state === before) return;
    board.update(state);
    if (stateMistakes(state) > stateMistakes(before)) announce(`Mistake. ${liveMistakes()} so far.`);
    refresh();
    if (isSolved(state)) finish('solved');
    else if (isFailed(state)) finish('failed');
  }

  function useHint(): void {
    if (finished || blockers > 0) return;
    const m = hint(state);
    if (!m) {
      announce('Nothing left to reveal.');
      return;
    }
    hintsUsed++;
    board.hinted?.(m);
    dispatch(m);
    announce(`Hint used. ${hintCostText()}.`);
    refresh();
  }

  function reset(): void {
    if (finished || blockers > 0) return;
    if (state.kind === 'tumblers') {
      board.clearInput?.();
      return;
    }
    if (!resetArmed) {
      resetArmed = true;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        resetArmed = false;
        refresh();
      }, 2500);
      refresh();
      return;
    }
    resetArmed = false;
    window.clearTimeout(resetTimer);
    carryMistakes += stateMistakes(state);
    carryMoves += state.moves;
    state = start(inst);
    board.update(state);
    announce('Board reset. Mistakes and time are kept.');
    refresh();
  }

  // ----- overlays -----
  let overlay: HTMLElement | null = null;
  function showOverlay(el: HTMLElement): void {
    blockers++;
    clock.block();
    const veil = h('div', 'tf-pz-veil');
    veil.appendChild(el);
    overlay = veil;
    main.inert = true;
    head.inert = true;
    wrap.appendChild(veil);
    const f = el.querySelector<HTMLElement>('[data-autofocus]') ?? (el.matches('[data-autofocus]') ? el : null);
    (f ?? el).focus?.();
  }
  function hideOverlay(): void {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    clock.unblock();
    blockers = Math.max(0, blockers - 1);
    main.inert = false;
    head.inert = false;
    board.focus();
    refresh();
  }

  function openExplainer(first: boolean): void {
    if (finished || overlay) return;
    const card = buildExplainerCard(
      inst.kind,
      () => {
        hideOverlay();
        if (first) clock.start();
        refresh();
      },
      first,
      () => openPractice(first),
    );
    showOverlay(card);
  }

  /** The guided practice lock, over this one: the clock is held while it is open, then the explainer comes back. */
  function openPractice(first: boolean): void {
    hideOverlay();
    const tut = buildTutorial(inst.kind, () => {
      tut.dispose();
      hideOverlay();
      openExplainer(first);
    });
    showOverlay(tut.el);
  }

  function openSkip(): void {
    if (finished || overlay || !allowSkip) return;
    const card = h('div', 'tf-pz-card tf-pz-card--confirm');
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-label', 'Force the lock?');
    card.appendChild(h('h3', 'tf-pz-card-title', 'Force the lock?'));
    card.appendChild(
      h('p', 'tf-pz-card-text', rewards?.skip ? `You will only get: ${rewards.skip}.` : 'You will only get a reduced reward.'),
    );
    const row = h('div', 'tf-pz-card-actions');
    const keep = btn('tf-pz-btn tf-pz-btn--primary', 'Keep trying', () => hideOverlay());
    keep.dataset.autofocus = '1';
    const force = btn('tf-pz-btn tf-pz-btn--danger', 'Force it', () => {
      hideOverlay();
      finish('skipped');
    });
    row.append(force, keep);
    card.appendChild(row);
    showOverlay(card);
  }

  // ----- finishing -----
  function raw(outcome: 'solved' | 'skipped' | 'failed'): PuzzleResult {
    return gradeResult(inst, {
      outcome,
      seconds: Math.round(seconds() * 10) / 10,
      mistakes: liveMistakes(),
      hintsUsed,
      moves: state.kind === 'tumblers' || state.kind === 'conduits' ? liveMoves() : 0,
    });
  }

  function finish(outcome: 'solved' | 'skipped' | 'failed'): void {
    if (finished) return;
    if (overlay) hideOverlayQuiet();
    const result = raw(outcome);
    clock.stop();
    finished = true;
    window.clearInterval(tick);
    if (outcome === 'skipped') {
      resolve(result);
      return;
    }
    refresh();
    const calm = reducedMotion();
    const fl = h('div', `tf-pz-flourish is-${outcome}${calm ? ' is-calm' : ''}`);
    fl.setAttribute('role', 'status');
    const lock = padlock();
    fl.appendChild(lock);
    const text =
      outcome === 'failed'
        ? 'The tumblers jam'
        : result.grade === 'none'
          ? 'Opened'
          : `${GRADE_LABEL[result.grade]}!`;
    fl.appendChild(h('div', `tf-pz-fgrade tf-pz-fgrade--${result.grade}`, text));
    const sub =
      outcome === 'failed'
        ? 'Out of tries.'
        : `${fmtTime(result.seconds)}${result.mistakes ? `, ${result.mistakes} mistake${result.mistakes > 1 ? 's' : ''}` : ''}${result.hintsUsed ? `, ${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''}` : ''}`;
    fl.appendChild(h('div', 'tf-pz-fsub', sub));
    const pay = rewards && outcome === 'solved' && result.grade !== 'none' ? rewards[result.grade] : '';
    if (pay) fl.appendChild(h('div', 'tf-pz-fpay', pay));
    wrap.appendChild(fl);
    main.inert = true;
    head.inert = true;
    announce(`${text} ${sub}`);
    requestAnimationFrame(() => fl.classList.add('is-in'));
    window.setTimeout(() => lock.classList.add('is-open'), calm ? 0 : 120);
    window.setTimeout(() => resolve(result), calm ? 600 : 1100);
  }

  function hideOverlayQuiet(): void {
    overlay?.remove();
    overlay = null;
    clock.unblock();
    blockers = Math.max(0, blockers - 1);
  }

  // ----- timers, visibility, layout, keys -----
  const tick = window.setInterval(refresh, 250);
  const onVisibility = (): void => {
    clock.setHidden(document.hidden);
    refresh();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const MIN_CELL = 40;
  function fit(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wide = vw / vh >= 1.2;
    // Landscape phones: the header moves into the side column and the controls sit beside the board,
    // so the board can use the full height.
    const compact = wide && vh <= 520;
    panel.dataset.layout = wide ? 'wide' : 'tall';
    panel.dataset.compact = compact ? '1' : '0';
    if (compact && head.parentElement !== side) side.insertBefore(head, side.firstChild);
    else if (!compact && head.parentElement !== panel) panel.insertBefore(head, main);
    const maxH = vh - 16;
    panel.style.maxHeight = `${maxH}px`;
    const cs = getComputedStyle(main);
    const pad = parseFloat(cs.paddingLeft) || 12;
    const gap = parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 12;
    const pw = panel.clientWidth;
    let sw: number;
    let sh: number;
    let rows = board.rows + board.toolRows;
    if (compact) {
      sw = pw - side.offsetWidth - gap - pad * 2 - (board.tools ? 112 : 0);
      sh = maxH - pad * 2 - 2;
      rows = board.rows;
    } else if (wide) {
      sw = pw - side.offsetWidth - gap - pad * 2;
      sh = maxH - head.offsetHeight - pad * 2;
    } else {
      sw = pw - pad * 2;
      sh = maxH - head.offsetHeight - side.offsetHeight - gap - pad * 2;
    }
    const byWidth = Math.floor((sw - board.cols * 2 - 8) / board.cols);
    const fitted = Math.min(byWidth, (sh - rows * 2 - 8) / rows, 88);
    // Never below 40 px when the width allows it: the panel scrolls instead of shrinking the targets.
    const cell = Math.max(Math.floor(fitted), Math.min(MIN_CELL, byWidth), 28);
    board.setCell(cell);
  }
  const onResize = (): void => fit();
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  const onKey = (e: KeyboardEvent): void => {
    if (finished) {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (overlay) hideOverlay();
      else openSkip();
      return;
    }
    if (e.key === 'Tab') {
      const scope: HTMLElement = overlay ?? panel;
      const items = Array.from(scope.querySelectorAll<HTMLElement>('button, [tabindex]')).filter(
        (n) => !(n as HTMLButtonElement).disabled && n.tabIndex >= 0 && n.offsetParent !== null && !n.closest('[inert]'),
      );
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const act = document.activeElement;
      if (e.shiftKey && (act === first || !scope.contains(act))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (act === last || !scope.contains(act))) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (overlay) return;
    const t = e.target as HTMLElement | null;
    // Keys belong to the board when focus is on its cells or its palette.
    if (t && (stage.contains(t) || t === document.body)) {
      if (e.key === 'Enter' && t.closest('.tf-pz-key')) return;
      if (board.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  wrap.addEventListener('keydown', onKey);
  // Keep game hotkeys from seeing our keys.
  wrap.addEventListener('keyup', (e) => e.stopPropagation());
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ----- go -----
  const wantsExplainer = opts.forceExplainer === true || !(opts.seenKinds ?? []).includes(inst.kind);
  refresh();
  fit();
  requestAnimationFrame(() => {
    fit();
    wrap.classList.add('is-in');
    if (wantsExplainer) {
      opts.onExplainerShown?.(inst.kind);
      openExplainer(true);
    } else board.focus();
  });
  window.setTimeout(fit, 120);
  board.update(state);

  return {
    finish(outcome) {
      finish(outcome);
    },
    autoplay(fraction) {
      if (overlay) hideOverlay();
      const moves = solveMoves();
      const n = Math.round(moves.length * Math.max(0, Math.min(1, fraction)));
      for (let i = 0; i < n; i++) dispatch(moves[i] as PuzzleMove);
    },
    openSkip,
    dispose() {
      window.clearInterval(tick);
      window.clearTimeout(resetTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      wrap.remove();
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus?.();
    },
  };

  function solveMoves(): PuzzleMove[] {
    return solveFor(inst);
  }
}

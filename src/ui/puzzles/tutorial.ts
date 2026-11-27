/**
 * Guided practice locks (src/puzzles/tutorials): a small untimed board with a coach that walks through it step by step.
 * Used three ways: from the first-time explainer card ("Practise first"), from the lock's "?" card, and standalone from
 * How to play (`openTutorial`). Nothing here is timed or graded.
 */
import './puzzles.css';
import { TUTORIALS, apply, start } from '../../puzzles';
import type { PuzzleKind, PuzzleMove, PuzzleState, TutorialStep } from '../../puzzles';
import { createBoard } from './boards';
import { glyph } from './glyphs';
import { btn, h } from './util';

export interface TutorialHandle {
  el: HTMLElement;
  /** Remove listeners and timers (the element is removed by whoever placed it). */
  dispose(): void;
}

/** Coach text with `{sym:N}` drawn as the symbol itself. */
function coachText(kind: PuzzleKind, text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(/\{sym:(\d+)\}/g)) {
    out.append(text.slice(last, m.index));
    const v = Number(m[1]);
    const span = h('span', 'tf-pz-tut-sym');
    span.appendChild(glyph(kind === 'runes' ? v - 1 : v));
    out.append(span);
    last = (m.index ?? 0) + m[0].length;
  }
  out.append(text.slice(last));
  return out;
}

/** Build the practice card for a kind. `onExit` runs when the player closes it or finishes. */
export function buildTutorial(kind: PuzzleKind, onExit: () => void): TutorialHandle {
  const t = TUTORIALS[kind];
  let state: PuzzleState = start(t.instance);
  let index = 0;
  let met = false;
  let nudgeTimer = 0;

  const card = h('div', 'tf-pz-card tf-pz-tut');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', t.title);

  const head = h('div', 'tf-pz-tut-head');
  const title = h('h3', 'tf-pz-card-title', t.title);
  const count = h('span', 'tf-pz-tut-count');
  const close = btn('tf-pz-icon tf-pz-tut-close', '×', () => onExit(), 'Close the practice lock');
  head.append(title, count, close);

  const dots = h('div', 'tf-pz-tut-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < t.steps.length; i++) dots.appendChild(h('span', 'tf-pz-tut-dot'));

  const coach = h('div', 'tf-pz-tut-coach');
  coach.setAttribute('aria-live', 'polite');
  const say = h('p', 'tf-pz-tut-say');
  const after = h('p', 'tf-pz-tut-after');
  const nudge = h('p', 'tf-pz-tut-nudge');
  coach.append(say, after, nudge);

  const stage = h('div', 'tf-pz-tut-stage');
  const board = createBoard(t.instance, {
    dispatch: (m) => dispatch(m),
    state: () => state,
    say: (msg) => showNudge(msg),
  });
  stage.appendChild(board.el);
  if (board.tools) stage.appendChild(board.tools);

  const foot = h('div', 'tf-pz-card-actions tf-pz-tut-foot');
  const restart = btn('tf-pz-btn', 'Start over', () => reset());
  const showMe = btn('tf-pz-btn', 'Show me', () => playShow());
  const next = btn('tf-pz-btn tf-pz-btn--primary', 'Next', () => advance());
  next.dataset.autofocus = '1';
  foot.append(restart, showMe, next);

  card.append(head, dots, coach, stage, foot);

  const step = (): TutorialStep => t.steps[index] as TutorialStep;
  const last = (): boolean => index === t.steps.length - 1;

  function fitBoard(): void {
    // The card is at most 520 px wide; cells between 34 and 52 px.
    const width = Math.min(card.clientWidth || 480, 520) - 36;
    board.setCell(Math.max(34, Math.min(52, Math.floor((width - board.cols * 2) / board.cols))));
  }

  function spotlight(): void {
    for (const el of card.querySelectorAll<HTMLElement>('[data-spot].is-spot')) el.classList.remove('is-spot');
    if (met) return;
    for (const addr of step().spot ?? []) {
      for (const el of card.querySelectorAll<HTMLElement>(`[data-spot="${addr}"]`)) el.classList.add('is-spot');
    }
  }

  function render(): void {
    const s = step();
    count.textContent = `Step ${index + 1} of ${t.steps.length}`;
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('is-done', i < index || (i === index && met));
      d.classList.toggle('is-now', i === index);
    });
    say.replaceChildren(coachText(kind, s.text));
    after.replaceChildren(met && s.done ? coachText(kind, s.done) : '');
    after.hidden = !(met && s.done);
    const reading = !s.goal;
    next.disabled = !reading && !met;
    next.textContent = last() && (reading || met) ? 'Finish' : 'Next';
    showMe.hidden = reading || met || !s.show?.length;
    stage.classList.toggle('is-resting', reading || met);
    spotlight();
  }

  function showNudge(text: string): void {
    nudge.replaceChildren(coachText(kind, text));
    nudge.classList.remove('is-shake');
    void nudge.offsetWidth;
    nudge.classList.add('is-shake');
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => nudge.replaceChildren(), 4000);
  }

  function dispatch(m: PuzzleMove): void {
    const s = step();
    // Reading steps and finished steps keep the board still, so the player reads before moving on.
    if (!s.goal || met) {
      showNudge(s.goal ? 'Press Next to go on.' : 'Read this, then press Next.');
      return;
    }
    if (s.allow && !s.allow(m, state)) {
      showNudge(s.nudge ?? 'Not that one: follow the lit-up tiles.');
      return;
    }
    const before = state;
    state = apply(state, m);
    if (state === before) return;
    board.update(state);
    nudge.replaceChildren();
    if (s.goal(state)) {
      met = true;
      render();
      next.focus();
    }
  }

  function playShow(): void {
    const s = step();
    for (const m of s.show ?? []) dispatch(m);
  }

  function advance(): void {
    const s = step();
    if (s.goal && !met) return;
    if (last()) {
      onExit();
      return;
    }
    index++;
    met = false;
    nudge.replaceChildren();
    render();
    board.focus();
  }

  function reset(): void {
    state = start(t.instance);
    index = 0;
    met = false;
    nudge.replaceChildren();
    board.update(state);
    board.clearInput?.();
    render();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onExit();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && stage.contains(target) && board.onKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  card.addEventListener('keydown', onKey);
  const onResize = (): void => fitBoard();
  window.addEventListener('resize', onResize);

  board.update(state);
  render();
  requestAnimationFrame(() => {
    fitBoard();
    next.focus();
  });
  fitBoard();

  return {
    el: card,
    dispose() {
      window.clearTimeout(nudgeTimer);
      window.removeEventListener('resize', onResize);
      card.removeEventListener('keydown', onKey);
    },
  };
}

/** Run a practice lock on its own, over whatever is on screen (How to play). Resolves when the player closes it. */
export function openTutorial(kind: PuzzleKind, root: HTMLElement = document.body): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const wrap = h('div', 'tf-pz tf-pz--tutorial');
    const veil = h('div', 'tf-pz-veil');
    const tut = buildTutorial(kind, () => {
      tut.dispose();
      wrap.remove();
      previous?.focus?.();
      resolve();
    });
    veil.appendChild(tut.el);
    wrap.appendChild(veil);
    // Keep the game's hotkeys and clicks from reaching through.
    wrap.addEventListener('keyup', (e) => e.stopPropagation());
    wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('is-in'));
  });
}

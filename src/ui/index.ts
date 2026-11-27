import type {
  CharacterBuild,
  CreationOptions,
  GameUi,
  HubIntent,
  HelpMode,
  PuzzleKind,
  HubModel,
  HudModel,
  MenuResult,
  UiIntent,
} from '../core/types';
import './ui.css';
import './screens.css';
import './hud.css';
import { buildCreation } from './creation';
import { createPuzzleView } from './puzzles/view';
import { setGlossaryTooltip } from './glossary';
import { HintManager, buildConfirm, buildHelpChoice, buildHowTo } from './help';
import { h } from './dom';
import { Hud } from './hud';
import { buildHub } from './hub';
import { LoadingVeil, buildDeath, buildMenu, buildTitle, buildVictory, showBanner } from './screens';
import { Tooltip } from './tooltip';

/**
 * Build the DOM overlay inside `root` (the fixed, pointer-events:none #ui-root).
 * Layers, bottom to top: HUD, full-screen screens, banner, tooltip, loading veil.
 *
 * Screen promises: only one full-screen screen exists at a time. Showing a new
 * one while an earlier screen's promise is still pending removes the old DOM
 * immediately and disarms its callbacks; that earlier promise never settles.
 */
export function createUi(root: HTMLElement): GameUi {
  const ui = h('div', 'tf-ui');
  const hudLayer = h('div', 'tf-layer tf-layer--hud');
  const screenLayer = h('div', 'tf-layer tf-layer--screen');
  const bannerLayer = h('div', 'tf-layer tf-layer--banner');
  const hintLayer = h('div', 'tf-layer tf-layer--hint');
  const confirmLayer = h('div', 'tf-layer tf-layer--confirm');
  const puzzleLayer = h('div', 'tf-layer tf-layer--puzzle');
  const tipLayer = h('div', 'tf-layer tf-layer--tip');
  const loading = new LoadingVeil();
  ui.append(hudLayer, hintLayer, screenLayer, bannerLayer, confirmLayer, puzzleLayer, tipLayer, loading.el);
  root.append(ui);

  // Block the browser's own gestures on our UI (pinch/double-tap zoom, text selection).
  ui.addEventListener('dblclick', (e) => e.preventDefault());

  const tooltip = new Tooltip(tipLayer);
  setGlossaryTooltip(tooltip);
  let intentCb: (i: UiIntent) => void = () => undefined;
  let screenOpen = false;

  const hud = new Hud(
    tooltip,
    (i) => intentCb(i),
    () => !screenOpen && !confirmOpen && !puzzleOpen && !loading.el.classList.contains('is-open'),
  );
  hudLayer.append(hud.el);
  const hints = new HintManager(
    hintLayer,
    (a) => hud.anchorEl(a),
    () => hud.topBottom(),
  );
  let confirmOpen = false;
  let puzzleOpen = false;
  const puzzleView = createPuzzleView(puzzleLayer);
  // Kinds of lock the player has met (the first time shows the explainer); kept across sessions when storage works.
  const seenKinds = new Set<PuzzleKind>();
  try {
    for (const k of JSON.parse(localStorage.getItem('tf-pz-seen') ?? '[]') as PuzzleKind[]) seenKinds.add(k);
  } catch {
    /* storage unavailable: session only */
  }
  // While a puzzle is open Escape always reaches it, even if focus slipped outside the dialog.
  document.addEventListener(
    'keydown',
    (e) => {
      if (puzzleOpen && e.key === 'Escape' && !puzzleLayer.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        puzzleView.debug.openSkipConfirm();
      }
    },
    true,
  );
  let cancelConfirm: (() => void) | null = null;

  /** Disarms the screen currently mounted (so late callbacks cannot fire). */
  let disarm: (() => void) | null = null;

  /** HUD buttons are inert (unfocusable, unclickable) while a screen or the loading veil is up. */
  function syncInert(): void {
    const blocked = screenOpen || confirmOpen || puzzleOpen || loading.el.classList.contains('is-open');
    hudLayer.inert = blocked;
    hintLayer.inert = screenOpen || puzzleOpen || loading.el.classList.contains('is-open');
  }

  function mount(el: HTMLElement, onReplaced: () => void): void {
    tooltip.hide();
    disarm?.();
    disarm = onReplaced;
    screenLayer.replaceChildren(el); // drops the old screen's DOM and its listeners
    screenOpen = true;
    ui.classList.add('has-screen');
    syncInert();
    el.classList.add('is-entering');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-entering')));
  }

  function unmount(el: HTMLElement): void {
    if (el.parentElement !== screenLayer) return;
    el.classList.add('is-leaving');
    screenOpen = false;
    disarm = null;
    ui.classList.remove('has-screen');
    syncInert();
    const remove = (): void => el.remove();
    el.addEventListener('transitionend', remove, { once: true });
    window.setTimeout(remove, 400);
  }

  function modal<T>(build: (resolve: (v: T) => void) => HTMLElement): Promise<T> {
    return new Promise<T>((resolve) => {
      let live = true;
      const el = build((v) => {
        if (!live) return; // replaced by a newer screen, or already resolved
        live = false;
        unmount(el);
        resolve(v);
      });
      mount(el, () => {
        live = false;
      });
    });
  }

  return {
    showTitle: (opts) => modal<'new' | 'continue'>((done) => buildTitle(opts.hasSave, done)),

    showCreation: (options: CreationOptions) =>
      modal<CharacterBuild>((done) => buildCreation(options, done, tooltip)),

    setHud: (model: HudModel) => hud.setHud(model),
    hideHud: () => hud.hide(),
    onIntent: (cb) => {
      intentCb = cb;
    },

    showHub: (model: HubModel, onIntent: (intent: HubIntent) => HubModel) =>
      modal<void>((done) => buildHub(model, onIntent, () => done())),

    showMenu: (state) => modal<MenuResult>((done) => buildMenu(state, done)),

    showHelpChoice: () => modal<HelpMode>((done) => buildHelpChoice(done)),

    showHowToPlay: () =>
      modal<void>((done) => {
        const r = h('div', 'tf-screen tf-screen--creation');
        r.append(buildHowTo(() => done(), 'Done'));
        return r;
      }),

    showHint: (hint, onClose) => hints.show(hint, onClose),

    clearHint: (id) => hints.clear(id),

    /** A small modal over the running game; it does not replace the current screen. */
    confirm: (q) =>
      new Promise((resolve) => {
        cancelConfirm?.();
        const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let live = true;
        const finish = (r: { ok: boolean; remember: boolean }): void => {
          if (!live) return;
          live = false;
          el.classList.remove('is-in');
          window.setTimeout(() => el.remove(), 180);
          confirmOpen = false;
          cancelConfirm = null;
          syncInert();
          prev?.focus({ preventScroll: true });
          resolve(r);
        };
        const el = buildConfirm(q, finish);
        cancelConfirm = () => finish({ ok: false, remember: false });
        tooltip.hide();
        confirmLayer.replaceChildren(el);
        confirmOpen = true;
        syncInert();
        requestAnimationFrame(() => el.classList.add('is-in'));
      }),

    /** A chest's lock puzzle over the paused game. Always resolves (forcing the lock gives 'skipped'). */
    playPuzzle: async (req) => {
      tooltip.hide();
      puzzleOpen = true;
      syncInert();
      try {
        return await puzzleView.play(req.spec, {
          title: req.title,
          flavor: req.flavor,
          rewards: req.rewards,
          boss: req.boss,
          seenKinds: [...seenKinds],
          onExplainerShown: (k) => {
            seenKinds.add(k);
            try {
              localStorage.setItem('tf-pz-seen', JSON.stringify([...seenKinds]));
            } catch {
              /* ignore */
            }
          },
        });
      } finally {
        puzzleOpen = false;
        syncInert();
      }
    },

    showDeath: (info) => modal<'retry' | 'quit'>((done) => buildDeath(info, done)),

    showVictory: (info) => modal<void>((done) => buildVictory(info, () => done())),

    banner: (text, subtext) => showBanner(bannerLayer, text, subtext),

    setLoading: (message) => {
      loading.set(message);
      syncInert();
    },
  };
}

import type {
  CharacterBuild,
  CreationOptions,
  GameUi,
  HubIntent,
  HubModel,
  HudModel,
  MenuResult,
  UiIntent,
} from '../core/types';
import './ui.css';
import './screens.css';
import './hud.css';
import { buildCreation } from './creation';
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
  const tipLayer = h('div', 'tf-layer tf-layer--tip');
  const loading = new LoadingVeil();
  ui.append(hudLayer, screenLayer, bannerLayer, tipLayer, loading.el);
  root.append(ui);

  // Block the browser's own gestures on our UI (pinch/double-tap zoom, text selection).
  ui.addEventListener('dblclick', (e) => e.preventDefault());

  const tooltip = new Tooltip(tipLayer);
  let intentCb: (i: UiIntent) => void = () => undefined;
  let screenOpen = false;

  const hud = new Hud(
    tooltip,
    (i) => intentCb(i),
    () => !screenOpen && !loading.el.classList.contains('is-open'),
  );
  hudLayer.append(hud.el);

  /** Disarms the screen currently mounted (so late callbacks cannot fire). */
  let disarm: (() => void) | null = null;

  /** HUD buttons are inert (unfocusable, unclickable) while a screen or the loading veil is up. */
  function syncInert(): void {
    hudLayer.inert = screenOpen || loading.el.classList.contains('is-open');
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

    showDeath: (info) => modal<'retry' | 'quit'>((done) => buildDeath(info, done)),

    showVictory: (info) => modal<void>((done) => buildVictory(info, () => done())),

    banner: (text, subtext) => showBanner(bannerLayer, text, subtext),

    setLoading: (message) => {
      loading.set(message);
      syncInert();
    },
  };
}

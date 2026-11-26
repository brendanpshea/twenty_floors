import type { ActionCost } from '../core/types';
import { COST_LABEL, clear, costMarker, h } from './dom';

export interface TipContent {
  title: string;
  /** Small line under the title, e.g. the action cost. */
  cost?: ActionCost;
  sub?: string;
  body?: string;
  /** Shown in red, e.g. why something is disabled. */
  warn?: string;
}

const LONG_PRESS_MS = 420;
const TOUCH_AUTOHIDE_MS = 4500;

/**
 * One shared tooltip. Mouse: hover. Keyboard: focus-visible. Touch: long-press
 * (and a brief flash on tapping a disabled control).
 */
export class Tooltip {
  readonly el: HTMLElement;
  private anchor: HTMLElement | null = null;
  private getter: (() => TipContent | null) | null = null;
  private readonly getters = new WeakMap<HTMLElement, () => TipContent | null>();
  private readonly avoids = new WeakMap<HTMLElement, () => HTMLElement | null>();
  private hideTimer = 0;
  private openedByTouch = false;

  constructor(layer: HTMLElement) {
    this.el = h('div', 'tf-tip');
    this.el.setAttribute('role', 'tooltip');
    layer.append(this.el);
    document.addEventListener(
      'pointerdown',
      (e) => {
        // Capturing on document: sees taps on the game canvas too, without blocking them.
        if (!this.openedByTouch) return;
        const t = e.target;
        if (this.anchor && t instanceof Node && this.anchor.contains(t)) return;
        this.hide();
      },
      true,
    );
    window.addEventListener('resize', () => this.refresh());
  }

  /** `avoid` names an element the tooltip must not cover (it is placed above it, or below the anchor). */
  attach(target: HTMLElement, get: () => TipContent | null, avoid?: () => HTMLElement | null): void {
    this.getters.set(target, get);
    if (avoid) this.avoids.set(target, avoid);
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;

    target.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.show(target);
    });
    target.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.anchor === target) this.hide();
    });
    target.addEventListener('focus', () => {
      if (target.matches(':focus-visible')) this.show(target);
    });
    target.addEventListener('blur', () => {
      if (this.anchor === target) this.hide();
    });

    target.addEventListener('pointerdown', (e) => {
      suppressClick = false;
      if (e.pointerType === 'mouse') return;
      startX = e.clientX;
      startY = e.clientY;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        suppressClick = true;
        this.show(target, true);
      }, LONG_PRESS_MS);
    });
    const cancel = (): void => window.clearTimeout(timer);
    target.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) cancel();
    });
    target.addEventListener('pointerup', cancel);
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    // Registered before the owner's click handler: a long press must not also activate the control.
    target.addEventListener('click', (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
  }

  show(target: HTMLElement, byTouch = false): void {
    const get = this.getters.get(target);
    if (!get) return;
    this.anchor = target;
    this.getter = get;
    this.openedByTouch = byTouch;
    window.clearTimeout(this.hideTimer);
    if (byTouch) this.hideTimer = window.setTimeout(() => this.hide(), TOUCH_AUTOHIDE_MS);
    this.render();
  }

  /** Show briefly, e.g. after tapping a disabled button so touch users can read why. */
  flash(target: HTMLElement, ms = 2600): void {
    this.show(target, true);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.anchor = null;
    this.getter = null;
    this.openedByTouch = false;
    this.el.classList.remove('is-open');
  }

  /** Re-read the content of the open tooltip (HUD data changed underneath it). */
  refresh(): void {
    if (this.anchor && this.getter) {
      if (!this.anchor.isConnected) this.hide();
      else this.render();
    }
  }

  private render(): void {
    if (!this.anchor || !this.getter) return;
    const c = this.getter();
    if (!c) {
      this.hide();
      return;
    }
    clear(this.el);
    const head = h('div', 'tf-tip-head');
    head.append(h('span', 'tf-tip-title', c.title));
    if (c.cost) {
      const tag = h('span', 'tf-tip-cost');
      tag.append(costMarker(c.cost), h('span', undefined, COST_LABEL[c.cost]));
      head.append(tag);
    }
    this.el.append(head);
    if (c.sub) this.el.append(h('div', 'tf-tip-sub', c.sub));
    if (c.body) this.el.append(h('div', 'tf-tip-body', c.body));
    if (c.warn) this.el.append(h('div', 'tf-tip-warn', c.warn));
    this.place();
    this.el.classList.add('is-open');
  }

  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const gap = 10;
    const avoid = this.avoids.get(a)?.() ?? null;
    const topEdge = avoid ? Math.min(r.top, avoid.getBoundingClientRect().top) : r.top;
    let top = topEdge - hgt - gap;
    if (top < 8) top = r.bottom + gap;
    if (top + hgt > vh - 8) top = Math.max(8, vh - hgt - 8);
    let left = r.left + r.width / 2 - w / 2;
    left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8));
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }
}

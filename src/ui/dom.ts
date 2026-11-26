import type { Ability, ActionCost } from '../core/types';

/** Create an element with an optional class and text content (textContent only: safe for untrusted strings). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(
  cls: string,
  label: string,
  onClick: (e: MouseEvent) => void,
  ariaLabel?: string,
): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

/** Only touches the DOM when the text actually changed. */
export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'in']);

/** "chain_mail" -> "Chain Mail", "sleightOfHand" -> "Sleight of Hand". */
export function prettifyId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export const COST_LABEL: Record<ActionCost, string> = {
  action: 'Action',
  bonus: 'Bonus Action',
  reaction: 'Reaction',
  free: 'Free',
};

/** Cost marker drawn by CSS: circle = action, triangle = bonus, diamond = reaction, square = free. */
export function costMarker(cost: ActionCost): HTMLSpanElement {
  const s = h('span', `tf-cost tf-cost--${cost}`);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export interface Keyed {
  el: HTMLElement;
}

/**
 * Keeps a parent's children in sync with an ordered data list, reusing
 * elements by key. The parent must be managed exclusively by this list.
 */
export class KeyedList<D, I extends Keyed> {
  private readonly map = new Map<string, I>();

  constructor(
    readonly parent: HTMLElement,
    private readonly keyOf: (d: D) => string,
    private readonly create: (d: D) => I,
    private readonly update: (item: I, d: D, index: number) => void,
  ) {}

  sync(data: readonly D[]): void {
    const seen = new Set<string>();
    let cursor: ChildNode | null = this.parent.firstChild;
    data.forEach((d, i) => {
      const key = this.keyOf(d);
      seen.add(key);
      let item = this.map.get(key);
      if (!item) {
        item = this.create(d);
        this.map.set(key, item);
      }
      this.update(item, d, i);
      if (item.el === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.parent.insertBefore(item.el, cursor);
      }
    });
    for (const [key, item] of this.map) {
      if (!seen.has(key)) {
        item.el.remove();
        this.map.delete(key);
      }
    }
  }

  get(key: string): I | undefined {
    return this.map.get(key);
  }
}

/**
 * Rebuild a container's contents while keeping scroll position and keyboard
 * focus (focus is restored to the element with the same data-key).
 */
export function rebuildPreserving(scrollEl: HTMLElement, root: HTMLElement, build: () => void): void {
  const top = scrollEl.scrollTop;
  const active = document.activeElement;
  const key =
    active instanceof HTMLElement && root.contains(active) ? active.dataset['key'] : undefined;
  build();
  scrollEl.scrollTop = top;
  if (key) {
    const again = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

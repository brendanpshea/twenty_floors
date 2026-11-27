/** Tiny DOM helpers (kept local so the puzzle UI stands alone). textContent only: never innerHTML. */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function btn(cls: string, label: string, onClick: (e: MouseEvent) => void, aria?: string): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

export function clearNode(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

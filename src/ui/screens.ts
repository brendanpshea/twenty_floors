import type { MenuResult, QualityLevel } from '../core/types';
import { button, h } from './dom';
import { createIcon } from './icons';

/** Full-screen scaffold with the shared atmospheric backdrop. */
function screen(kind: string): HTMLElement {
  const root = h('div', `tf-screen tf-screen--${kind}`);
  const bg = h('div', 'tf-backdrop');
  bg.setAttribute('aria-hidden', 'true');
  bg.append(h('div', 'tf-backdrop-arch'), h('div', 'tf-backdrop-steps'), h('div', 'tf-backdrop-vignette'));
  const embers = h('div', 'tf-embers');
  for (let i = 0; i < 14; i++) {
    const e = h('span', 'tf-ember');
    e.style.setProperty('--x', `${(i * 37 + 11) % 100}%`);
    e.style.setProperty('--d', `${7 + ((i * 5) % 9)}s`);
    e.style.setProperty('--delay', `${-((i * 3) % 11)}s`);
    e.style.setProperty('--s', `${2 + (i % 3)}px`);
    embers.append(e);
  }
  bg.append(embers);
  root.append(bg);
  return root;
}

export function buildTitle(hasSave: boolean, done: (choice: 'new' | 'continue') => void): HTMLElement {
  const root = screen('title');
  const box = h('main', 'tf-title');
  const crest = h('div', 'tf-title-crest');
  crest.append(createIcon('stairs', 'tf-icon'));
  const name = h('h1', 'tf-title-name');
  name.append(h('span', 'tf-title-pre', 'Twenty'), h('span', 'tf-title-main', 'Floors'));
  const pitch = h(
    'p',
    'tf-title-pitch',
    'One hero. Twenty floors of darkness. Descend, fight, and grow strong enough to survive the bottom.',
  );
  const menu = h('div', 'tf-title-menu');
  const newBtn = button('tf-btn tf-btn--primary tf-btn--xl', 'New Game', () => done('new'));
  menu.append(newBtn);
  if (hasSave) {
    const cont = button('tf-btn tf-btn--xl', 'Continue', () => done('continue'));
    menu.prepend(cont);
    cont.classList.add('tf-btn--primary');
    newBtn.classList.remove('tf-btn--primary');
    queueMicrotask(() => cont.focus({ preventScroll: true }));
  } else {
    queueMicrotask(() => newBtn.focus({ preventScroll: true }));
  }
  box.append(crest, name, h('div', 'tf-rule'), pitch, menu);
  const foot = h('footer', 'tf-foot');
  foot.append(
    h('span', undefined, 'Uses material from the SRD 5.2, CC-BY-4.0.'),
    h('span', undefined, 'Free and open source (MIT).'),
  );
  root.append(box, foot);
  return root;
}

export function buildDeath(
  info: { depth: number; killedBy: string },
  done: (choice: 'retry' | 'quit') => void,
): HTMLElement {
  const root = screen('death');
  const box = h('main', 'tf-end');
  const skull = h('div', 'tf-end-icon');
  skull.append(createIcon('skull', 'tf-icon'));
  const title = h('h1', 'tf-end-title', 'You have fallen');
  const line = h('p', 'tf-end-line');
  line.append(
    document.createTextNode(`On floor ${info.depth}, slain by `),
    h('strong', undefined, info.killedBy),
    document.createTextNode('.'),
  );
  const note = h('p', 'tf-end-note', 'The stairs remember you. The floor begins anew from its entrance.');
  const menu = h('div', 'tf-title-menu');
  const retry = button('tf-btn tf-btn--primary tf-btn--xl', 'Try the floor again', () => done('retry'));
  const quit = button('tf-btn tf-btn--xl', 'Abandon run', () => done('quit'));
  menu.append(retry, quit);
  box.append(skull, title, h('div', 'tf-rule'), line, note, menu);
  root.append(box);
  queueMicrotask(() => retry.focus({ preventScroll: true }));
  return root;
}

export function buildVictory(info: { floorsCleared: number }, done: () => void): HTMLElement {
  const root = screen('victory');
  const box = h('main', 'tf-end');
  const icon = h('div', 'tf-end-icon');
  icon.append(createIcon('star', 'tf-icon'));
  const title = h('h1', 'tf-end-title', 'Victory');
  const line = h(
    'p',
    'tf-end-line',
    `You cleared ${info.floorsCleared} floor${info.floorsCleared === 1 ? '' : 's'} and walked back into the light.`,
  );
  const note = h('p', 'tf-end-note', 'The dungeon is quiet at last. Songs will be sung of this descent.');
  const cont = button('tf-btn tf-btn--primary tf-btn--xl', 'Continue', done);
  const menu = h('div', 'tf-title-menu');
  menu.append(cont);
  box.append(icon, title, h('div', 'tf-rule'), line, note, menu);
  root.append(box);
  queueMicrotask(() => cont.focus({ preventScroll: true }));
  return root;
}

export function buildMenu(
  state: { quality: QualityLevel; depth: number; muted?: boolean },
  done: (r: MenuResult) => void,
): HTMLElement {
  const root = h('div', 'tf-screen tf-screen--menu');
  root.tabIndex = -1;
  const box = h('div', 'tf-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Paused');
  root.append(box);
  let confirming = false;

  const main = (): void => {
    confirming = false;
    box.replaceChildren();
    box.append(h('h1', 'tf-modal-title', 'Paused'), h('p', 'tf-modal-sub', `Floor ${state.depth}`), h('div', 'tf-rule'));
    const resume = button('tf-btn tf-btn--primary tf-btn--xl', 'Resume', () => done({ type: 'resume' }));
    resume.dataset['key'] = 'resume';
    const gfx = h('div', 'tf-modal-group');
    gfx.append(h('div', 'tf-modal-label', 'Graphics quality'));
    const seg = h('div', 'tf-seg tf-seg--wide');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Graphics quality');
    for (const level of ['low', 'medium', 'high'] as const) {
      const on = level === state.quality;
      const b = h('button', `tf-seg-btn${on ? ' is-active' : ''}`, level.charAt(0).toUpperCase() + level.slice(1));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.dataset['key'] = `quality-${level}`;
      b.addEventListener('click', () => {
        if (!on) done({ type: 'quality', level });
      });
      seg.append(b);
    }
    gfx.append(seg);
    let sound: HTMLElement | null = null;
    if (state.muted !== undefined) {
      const muted = state.muted;
      sound = h('div', 'tf-modal-group');
      sound.append(h('div', 'tf-modal-label', 'Sound'));
      const sseg = h('div', 'tf-seg tf-seg--wide');
      sseg.setAttribute('role', 'radiogroup');
      sseg.setAttribute('aria-label', 'Sound');
      for (const on of [true, false]) {
        const active = on === !muted;
        const b = h('button', `tf-seg-btn${active ? ' is-active' : ''}`, on ? 'On' : 'Off');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(active));
        b.dataset['key'] = `sound-${on ? 'on' : 'off'}`;
        b.addEventListener('click', () => {
          if (!active) done({ type: 'sound', muted: !on });
        });
        sseg.append(b);
      }
      sound.append(sseg);
    }
    const abandon = button('tf-btn tf-btn--danger', 'Abandon run', confirm);
    abandon.dataset['key'] = 'abandon';
    box.append(resume, gfx);
    if (sound) box.append(sound);
    box.append(abandon);
    resume.focus({ preventScroll: true });
  };

  function confirm(): void {
    confirming = true;
    box.replaceChildren();
    box.append(
      h('h1', 'tf-modal-title', 'Abandon run?'),
      h('div', 'tf-rule'),
      h('p', 'tf-modal-text', 'Your run ends here and this hero is lost. This cannot be undone.'),
    );
    const keep = button('tf-btn tf-btn--primary tf-btn--xl', 'Keep playing', main);
    keep.dataset['key'] = 'keep';
    const yes = button('tf-btn tf-btn--danger', 'Yes, abandon', () => done({ type: 'abandon' }));
    yes.dataset['key'] = 'confirm-abandon';
    box.append(keep, yes);
    keep.focus({ preventScroll: true });
  }

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (confirming) main();
    else done({ type: 'resume' });
  });
  // Keep focus inside so Escape keeps working after a click on the dim area.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) queueMicrotask(() => box.querySelector<HTMLElement>('button')?.focus());
  });
  main();
  return root;
}

export function showBanner(layer: HTMLElement, text: string, subtext?: string): void {
  layer.replaceChildren();
  const el = h('div', 'tf-banner');
  el.setAttribute('role', 'status');
  el.append(h('div', 'tf-banner-text', text));
  if (subtext) el.append(h('div', 'tf-banner-sub', subtext));
  const remove = (): void => el.remove();
  el.addEventListener('animationend', remove);
  window.setTimeout(remove, 3200);
  layer.append(el);
}

export class LoadingVeil {
  readonly el: HTMLElement;
  private readonly msg = h('div', 'tf-loading-msg');

  constructor() {
    this.el = h('div', 'tf-loading');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    const spin = h('div', 'tf-spinner');
    spin.append(h('span'), h('span'), h('span'));
    this.el.append(spin, this.msg);
  }

  set(message: string | null): void {
    if (message === null) {
      this.el.classList.remove('is-open');
      return;
    }
    if (this.msg.textContent !== message) this.msg.textContent = message;
    this.el.classList.add('is-open');
  }
}

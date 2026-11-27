/** The first-time "how this lock works" card: three lines and a tiny worked example. */
import { EXPLAINERS } from '../../puzzles/explain';
import type { PuzzleKind } from '../../puzzles/types';
import { glyph, pipeTile, wardFlag } from './glyphs';
import { h } from './util';

function xcell(content?: SVGElement | string, cls = ''): HTMLElement {
  const c = h('span', `tf-pz-xcell ${cls}`.trim());
  if (typeof content === 'string') c.textContent = content;
  else if (content) c.appendChild(content);
  return c;
}

function arrow(): HTMLElement {
  return h('span', 'tf-pz-xarrow', '→');
}

function example(kind: PuzzleKind): HTMLElement {
  const box = h('div', 'tf-pz-example');
  const row = h('div', 'tf-pz-xrow');
  let caption = '';
  switch (kind) {
    case 'runes':
      row.append(xcell(glyph(0)), xcell(glyph(1)), xcell(glyph(2)), xcell('?', 'is-empty'), arrow(), xcell(glyph(3), 'is-answer'));
      caption = 'This row holds three runes already, so the empty tile can only be the fourth.';
      break;
    case 'tumblers': {
      row.append(xcell(glyph(0)), xcell(glyph(3)), xcell(glyph(1)));
      const pips = h('span', 'tf-pz-pips');
      pips.append(h('span', 'tf-pz-pip is-exact'), h('span', 'tf-pz-pip is-near'));
      row.append(arrow(), pips);
      caption = 'Gold pip: right symbol, right place. Pale pip: right symbol, wrong place.';
      break;
    }
    case 'conduits':
      row.append(
        xcell(pipeTile(3, { powered: false, loose: 3, source: false, locked: false }), 'is-pipe'),
        arrow(),
        xcell(pipeTile(6, { powered: true, loose: 0, source: false, locked: false }), 'is-pipe'),
      );
      caption = 'One tap turns a tile a quarter turn clockwise.';
      break;
    case 'wards':
      row.append(xcell('1', 'is-open'), xcell('?', 'is-hidden'), arrow(), xcell('1', 'is-open'), xcell(wardFlag(), 'is-flag'));
      caption = 'A 1 with only one unopened neighbour: that neighbour is the trap.';
      break;
  }
  box.append(row, h('p', 'tf-pz-xcap', caption));
  return box;
}

/**
 * `onPractise`, when given, adds a button that opens the guided practice lock for this kind (untimed; the real lock's
 * clock does not run meanwhile).
 */
export function buildExplainerCard(kind: PuzzleKind, onDone: () => void, firstTime: boolean, onPractise?: () => void): HTMLElement {
  const info = EXPLAINERS[kind];
  const card = h('div', 'tf-pz-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', info.title);
  card.appendChild(h('h3', 'tf-pz-card-title', info.title));
  card.appendChild(example(kind));
  const list = h('ol', 'tf-pz-card-list');
  for (const line of info.lines) list.appendChild(h('li', undefined, line));
  card.appendChild(list);
  const go = h('button', 'tf-pz-btn tf-pz-btn--primary', firstTime ? 'Begin' : 'Got it');
  go.type = 'button';
  go.dataset.autofocus = '1';
  go.addEventListener('click', onDone);
  if (onPractise) {
    const row = h('div', 'tf-pz-card-actions');
    const practise = h('button', 'tf-pz-btn', firstTime ? 'Practise first (no timer)' : 'Practise (no timer)');
    practise.type = 'button';
    practise.addEventListener('click', onPractise);
    row.append(practise, go);
    card.appendChild(row);
  } else card.appendChild(go);
  if (firstTime) card.appendChild(h('p', 'tf-pz-card-note', 'The timer starts when you press Begin.'));
  return card;
}

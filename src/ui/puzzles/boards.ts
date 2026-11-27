/** The four puzzle boards. Each renders from a PuzzleState and sends moves through the host. */
import { conduitsLoose, conduitsPowered, rotCW, runesConflicts, isValidGuess } from '../../puzzles';
import { W_FLAG, W_HIDDEN, W_OPEN, W_SPRUNG } from '../../puzzles/types';
import type {
  ConduitsInstance,
  PuzzleInstance,
  PuzzleMove,
  PuzzleState,
  RunesInstance,
  TumblersInstance,
  WardsInstance,
} from '../../puzzles/types';
import { glyph, pipeTile, runeName, wardFlag, wardSprung } from './glyphs';
import { btn, clearNode, h, reducedMotion } from './util';

export interface BoardHost {
  dispatch(move: PuzzleMove): void;
  state(): PuzzleState;
  say(msg: string): void;
}

export interface Board {
  el: HTMLElement;
  /** Controls that live beside/below the board (palette, mode toggle, submit). */
  tools: HTMLElement | null;
  /** Natural size in cell units, for fitting the board into the stage. */
  cols: number;
  rows: number;
  /** Extra rows taken by `tools` when they sit under the board. */
  toolRows: number;
  setCell(px: number): void;
  update(state: PuzzleState): void;
  focus(): void;
  /** Return true when the key was used. */
  onKey(e: KeyboardEvent): boolean;
  /** Reset button for boards where "reset" means "clear the current input". */
  clearInput?: () => void;
  /** Draw the eye to the step a hint is about to apply. */
  hinted?: (move: PuzzleMove) => void;
}

function moveIndex(idx: number, key: string, cols: number, rows: number): number {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  switch (key) {
    case 'ArrowLeft':
      return r * cols + Math.max(0, c - 1);
    case 'ArrowRight':
      return r * cols + Math.min(cols - 1, c + 1);
    case 'ArrowUp':
      return Math.max(0, r - 1) * cols + c;
    case 'ArrowDown':
      return Math.min(rows - 1, r + 1) * cols + c;
    default:
      return idx;
  }
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/** 1-based symbol index from a key: digits 1-9 and letters a-f. */
function symbolFromKey(key: string): number | null {
  if (/^[1-9]$/.test(key)) return Number(key);
  const k = key.toLowerCase();
  if (/^[a-f]$/.test(k) && key.length === 1) return k.charCodeAt(0) - 96;
  return null;
}

function makeGrid(cols: number, rows: number, cls: string): HTMLElement {
  const g = h('div', `tf-pz-grid ${cls}`);
  g.setAttribute('role', 'group');
  g.style.gridTemplateColumns = `repeat(${cols}, var(--pz-cell))`;
  g.style.gridTemplateRows = `repeat(${rows}, var(--pz-cell))`;
  return g;
}

// ---------------------------------------------------------------------------
// Runes
// ---------------------------------------------------------------------------

function createRunesBoard(inst: RunesInstance, host: BoardHost): Board {
  const { n, boxRows, boxCols } = inst.data;
  const el = h('div', 'tf-pz-board');
  const grid = makeGrid(n, n, 'tf-pz-grid--runes');
  grid.setAttribute('aria-label', 'Rune grid');
  el.appendChild(grid);
  const cells: HTMLButtonElement[] = [];
  const shown: number[] = new Array<number>(n * n).fill(-1);
  let sel = Math.max(0, inst.data.givens.findIndex((g) => g === 0));

  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const b = h('button', 'tf-pz-cell');
    b.type = 'button';
    if ((c + 1) % boxCols === 0 && c < n - 1) b.classList.add('tf-pz-bx-r');
    if ((r + 1) % boxRows === 0 && r < n - 1) b.classList.add('tf-pz-bx-b');
    if (inst.data.givens[i]) b.classList.add('is-given');
    b.addEventListener('click', () => select(i));
    b.addEventListener('focus', () => {
      if (sel !== i) select(i, false);
    });
    cells.push(b);
    grid.appendChild(b);
  }

  const palette = h('div', 'tf-pz-palette');
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', 'Runes');
  const palBtns: HTMLButtonElement[] = [];
  const badges: HTMLSpanElement[] = [];
  for (let v = 1; v <= n; v++) {
    const b = btn('tf-pz-key', '', () => place(v));
    b.appendChild(glyph(v - 1));
    const badge = h('span', 'tf-pz-badge');
    b.appendChild(badge);
    badges.push(badge);
    palBtns.push(b);
    palette.appendChild(b);
  }
  const erase = btn('tf-pz-key tf-pz-key--erase', 'Erase', () => place(0), 'Erase rune');
  palette.appendChild(erase);
  palette.style.setProperty('--pz-keys', String(n + 1));
  palette.style.setProperty('--pz-cols', String(n));

  function select(i: number, focus = true): void {
    sel = i;
    for (let k = 0; k < cells.length; k++) {
      (cells[k] as HTMLButtonElement).tabIndex = k === sel ? 0 : -1;
    }
    paintSelection();
    if (focus) (cells[i] as HTMLButtonElement).focus();
  }

  function place(v: number): void {
    if (inst.data.givens[sel]) {
      host.say('That rune is carved in stone.');
      return;
    }
    const s = host.state();
    if (s.kind !== 'runes') return;
    const cur = s.grid[sel] as number;
    if (v === 0 || v === cur) host.dispatch({ type: 'clear', cell: sel });
    else host.dispatch({ type: 'place', cell: sel, value: v });
  }

  function paintSelection(): void {
    const s = host.state();
    const selVal = s.kind === 'runes' ? (s.grid[sel] as number) : 0;
    const sr = Math.floor(sel / n);
    const sc = sel % n;
    cells.forEach((b, i) => {
      b.classList.toggle('is-sel', i === sel);
      const r = Math.floor(i / n);
      const c = i % n;
      const peer =
        i !== sel &&
        (r === sr || c === sc || (Math.floor(r / boxRows) === Math.floor(sr / boxRows) && Math.floor(c / boxCols) === Math.floor(sc / boxCols)));
      b.classList.toggle('is-peer', peer);
      b.classList.toggle('is-same', selVal > 0 && i !== sel && s.kind === 'runes' && s.grid[i] === selVal);
    });
  }

  return {
    el,
    tools: palette,
    cols: n,
    rows: n,
    toolRows: 1.4,
    setCell(px) {
      el.style.setProperty('--pz-cell', `${px}px`);
      palette.style.setProperty('--pz-cell', `${px}px`);
    },
    update(state) {
      if (state.kind !== 'runes') return;
      const conflicts = runesConflicts(inst, state.grid);
      const counts = new Array<number>(n + 1).fill(0);
      state.grid.forEach((v, i) => {
        counts[v] = (counts[v] ?? 0) + 1;
        const b = cells[i] as HTMLButtonElement;
        if (shown[i] !== v) {
          shown[i] = v;
          clearNode(b);
          if (v > 0) b.appendChild(glyph(v - 1));
        }
        b.classList.toggle('is-conflict', conflicts.has(i));
        const rr = Math.floor(i / n) + 1;
        const cc = (i % n) + 1;
        b.setAttribute(
          'aria-label',
          `Row ${rr}, column ${cc}: ${v > 0 ? runeName(v - 1) : 'empty'}${inst.data.givens[i] ? ', fixed' : ''}${conflicts.has(i) ? ', clashes' : ''}`,
        );
      });
      for (let v = 1; v <= n; v++) {
        const left = n - (counts[v] ?? 0);
        (badges[v - 1] as HTMLElement).textContent = left > 0 ? String(left) : '';
        (palBtns[v - 1] as HTMLButtonElement).classList.toggle('is-done', left <= 0);
        (palBtns[v - 1] as HTMLButtonElement).setAttribute('aria-label', `Carve ${runeName(v - 1)}, ${Math.max(0, left)} still needed`);
      }
      select(sel, false);
    },
    focus() {
      select(sel, true);
    },
    onKey(e) {
      if (ARROWS.includes(e.key)) {
        select(moveIndex(sel, e.key, n, n));
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        place(0);
        return true;
      }
      const v = /^[1-9]$/.test(e.key) ? Number(e.key) : null;
      if (v !== null && v <= n && !e.ctrlKey && !e.metaKey && !e.altKey) {
        place(v);
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Tumblers
// ---------------------------------------------------------------------------

function createTumblersBoard(inst: TumblersInstance, host: BoardHost): Board {
  const { length, symbols } = inst.data;
  const el = h('div', 'tf-pz-board tf-pz-board--tumblers');
  const history = h('ol', 'tf-pz-history');
  history.setAttribute('aria-label', 'Previous tries');
  const empty = h('li', 'tf-pz-hempty', 'No tries yet. Pick a symbol for every tumbler.');
  history.appendChild(empty);
  const current = h('div', 'tf-pz-current');
  current.setAttribute('role', 'group');
  current.setAttribute('aria-label', 'Your try');
  el.append(history, current);

  const cur: (number | null)[] = new Array<number | null>(length).fill(null);
  let revealed: (number | null)[] = new Array<number | null>(length).fill(null);
  let sel = 0;
  let rendered = 0;
  const slots: HTMLButtonElement[] = [];
  for (let i = 0; i < length; i++) {
    const b = h('button', 'tf-pz-slot');
    b.type = 'button';
    b.addEventListener('click', () => selectSlot(i));
    b.addEventListener('focus', () => {
      if (sel !== i) selectSlot(i, false);
    });
    slots.push(b);
    current.appendChild(b);
  }

  const tools = h('div', 'tf-pz-tools-tumblers');
  const palette = h('div', 'tf-pz-palette');
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', 'Symbols');
  for (let s = 0; s < symbols; s++) {
    const b = btn('tf-pz-key', '', () => setSlot(s));
    b.appendChild(glyph(s));
    b.setAttribute('aria-label', `Set tumbler to ${runeName(s)}`);
    palette.appendChild(b);
  }
  palette.style.setProperty('--pz-keys', String(symbols));
  palette.style.setProperty('--pz-cols', String(Math.max(length * 1.1 + 0.4, 6)));
  el.style.setProperty('--pz-cols', String(Math.max(length * 1.1 + 0.4, 6)));
  const submit = btn('tf-pz-btn tf-pz-btn--primary tf-pz-submit', 'Try the lock', () => trySubmit());
  tools.append(palette, submit);

  function valid(): boolean {
    return cur.every((v) => v !== null) && isValidGuess(inst, cur as number[]);
  }

  function selectSlot(i: number, focus = true): void {
    sel = i;
    slots.forEach((b, k) => {
      b.tabIndex = k === sel ? 0 : -1;
      b.classList.toggle('is-sel', k === sel);
    });
    if (focus) (slots[i] as HTMLButtonElement).focus();
  }

  function paintCurrent(): void {
    slots.forEach((b, i) => {
      const v = cur[i] ?? null;
      clearNode(b);
      if (v !== null) b.appendChild(glyph(v));
      b.classList.toggle('is-filled', v !== null);
      const fixed = revealed[i] !== null;
      b.classList.toggle('is-revealed', fixed);
      b.setAttribute('aria-label', `Tumbler ${i + 1}: ${v === null ? 'empty' : runeName(v)}${fixed ? ', revealed by a hint' : ''}`);
    });
    submit.disabled = !valid();
  }

  function setSlot(sym: number | null): void {
    if (revealed[sel] !== null) {
      host.say('That tumbler is already revealed.');
      return;
    }
    if (sym !== null && !inst.data.repeats) {
      for (let k = 0; k < length; k++) if (k !== sel && cur[k] === sym) {
        if (revealed[k] !== null) {
          host.say('That symbol is already fixed in another tumbler.');
          return;
        }
        cur[k] = null;
      }
    }
    cur[sel] = sym;
    paintCurrent();
    if (sym !== null) {
      for (let k = 1; k <= length; k++) {
        const nx = (sel + k) % length;
        if (revealed[nx] === null && (cur[nx] === null || k === length)) {
          selectSlot(nx, true);
          break;
        }
      }
    }
  }

  function trySubmit(): void {
    if (!valid()) {
      host.say(inst.data.repeats ? 'Fill every tumbler first.' : 'Fill every tumbler, using each symbol once.');
      return;
    }
    host.dispatch({ type: 'guess', code: cur.slice() as number[] });
  }

  function renderHistory(s: Extract<PuzzleState, { kind: 'tumblers' }>): void {
    if (s.guesses.length === rendered) return;
    if (rendered === 0) history.removeChild(empty);
    for (let g = rendered; g < s.guesses.length; g++) {
      const guess = s.guesses[g] as (typeof s.guesses)[number];
      const li = h('li', 'tf-pz-hrow');
      li.appendChild(h('span', 'tf-pz-hnum', String(g + 1)));
      const syms = h('span', 'tf-pz-hsyms');
      for (const v of guess.code) {
        const cell = h('span', 'tf-pz-hsym');
        cell.appendChild(glyph(v));
        syms.appendChild(cell);
      }
      const pips = h('span', 'tf-pz-pips');
      for (let k = 0; k < guess.exact; k++) pips.appendChild(h('span', 'tf-pz-pip is-exact'));
      for (let k = 0; k < guess.misplaced; k++) pips.appendChild(h('span', 'tf-pz-pip is-near'));
      if (guess.exact + guess.misplaced === 0) pips.appendChild(h('span', 'tf-pz-nomatch', 'none'));
      li.append(syms, pips);
      li.setAttribute(
        'aria-label',
        `Try ${g + 1}: ${guess.code.map(runeName).join(', ')}. ${guess.exact} right place, ${guess.misplaced} wrong place.`,
      );
      history.appendChild(li);
    }
    rendered = s.guesses.length;
    history.scrollTop = history.scrollHeight;
  }

  selectSlot(0, false);
  paintCurrent();

  return {
    el,
    tools,
    cols: Math.max(length * 1.1 + 0.4, 6),
    rows: 1.4 + 0.8 * Math.min(inst.data.maxGuesses, 6) + 0.3,
    toolRows: 2.3,
    setCell(px) {
      el.style.setProperty('--pz-cell', `${px}px`);
      tools.style.setProperty('--pz-cell', `${px}px`);
    },
    update(state) {
      if (state.kind !== 'tumblers') return;
      revealed = state.revealed.slice();
      revealed.forEach((v, i) => {
        if (v !== null) cur[i] = v;
      });
      renderHistory(state);
      paintCurrent();
      const over = state.solved || state.failed;
      submit.disabled = over || !valid();
    },
    focus() {
      selectSlot(sel, true);
    },
    onKey(e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        selectSlot((sel + (e.key === 'ArrowRight' ? 1 : length - 1)) % length);
        return true;
      }
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement | null)?.closest('.tf-pz-key')) return false;
        trySubmit();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setSlot(null);
        return true;
      }
      const v = symbolFromKey(e.key);
      if (v !== null && v <= symbols && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setSlot(v - 1);
        return true;
      }
      return false;
    },
    clearInput() {
      for (let i = 0; i < length; i++) if (revealed[i] === null) cur[i] = null;
      paintCurrent();
      selectSlot(Math.max(0, revealed.findIndex((r) => r === null)), true);
    },
  };
}

// ---------------------------------------------------------------------------
// Conduits
// ---------------------------------------------------------------------------

function createConduitsBoard(inst: ConduitsInstance, host: BoardHost): Board {
  const { w, h: rowsN, wrap, source, locked } = inst.data;
  const el = h('div', 'tf-pz-board');
  const grid = makeGrid(w, rowsN, 'tf-pz-grid--conduits');
  grid.setAttribute('aria-label', wrap ? 'Pipe grid, edges wrap around' : 'Pipe grid');
  if (wrap) grid.classList.add('is-wrap');
  el.appendChild(grid);
  const cells: HTMLButtonElement[] = [];
  const shown: string[] = new Array<string>(w * rowsN).fill('');
  const lastMask: number[] = inst.data.tiles.slice();
  let sel = 0;

  for (let i = 0; i < w * rowsN; i++) {
    const b = h('button', 'tf-pz-cell tf-pz-cell--pipe');
    b.type = 'button';
    if (locked[i]) b.classList.add('is-locked');
    b.addEventListener('click', (ev) => {
      selectCell(i, false);
      rotate(i, ev.shiftKey ? -1 : 1);
    });
    b.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      rotate(i, -1);
    });
    b.addEventListener('focus', () => {
      if (sel !== i) selectCell(i, false);
    });
    cells.push(b);
    grid.appendChild(b);
  }

  function rotate(i: number, dir: 1 | -1): void {
    if (locked[i]) {
      host.say('That tile is pinned in place.');
      return;
    }
    host.dispatch({ type: 'rotate', cell: i, dir });
  }

  function selectCell(i: number, focus = true): void {
    sel = i;
    cells.forEach((b, k) => {
      b.tabIndex = k === sel ? 0 : -1;
    });
    if (focus) (cells[i] as HTMLButtonElement).focus();
  }

  return {
    el,
    tools: null,
    cols: w,
    rows: rowsN,
    toolRows: 0,
    setCell(px) {
      el.style.setProperty('--pz-cell', `${px}px`);
    },
    update(state) {
      if (state.kind !== 'conduits') return;
      const powered = conduitsPowered(inst, state.tiles);
      const loose = conduitsLoose(inst, state.tiles);
      state.tiles.forEach((m, i) => {
        const key = `${m}|${powered[i] ? 1 : 0}|${loose[i]}`;
        const b = cells[i] as HTMLButtonElement;
        if (shown[i] === key) return;
        const firstPaint = shown[i] === '';
        shown[i] = key;
        clearNode(b);
        const svg = pipeTile(m, { powered: powered[i] === true, loose: loose[i] as number, source: i === source, locked: locked[i] === true });
        b.appendChild(svg);
        b.classList.toggle('is-powered', powered[i] === true);
        const prev = lastMask[i] as number;
        if (!firstPaint && prev !== m && !reducedMotion() && typeof svg.animate === 'function') {
          const from = rotCW(prev) === m ? -90 : rotCW(m) === prev ? 90 : 0;
          if (from !== 0) svg.animate([{ transform: `rotate(${from}deg)` }, { transform: 'rotate(0deg)' }], { duration: 150, easing: 'ease-out' });
        }
        lastMask[i] = m;
        const r = Math.floor(i / w) + 1;
        const c = (i % w) + 1;
        b.setAttribute(
          'aria-label',
          `Row ${r}, column ${c}: pipe${i === source ? ', source' : ''}${locked[i] ? ', pinned' : ''}${powered[i] ? ', connected' : ''}${loose[i] ? ', loose end' : ''}`,
        );
      });
    },
    focus() {
      selectCell(sel, true);
    },
    onKey(e) {
      if (ARROWS.includes(e.key)) {
        selectCell(moveIndex(sel, e.key, w, rowsN));
        return true;
      }
      if (e.key.toLowerCase() === 'r') {
        rotate(sel, e.shiftKey ? -1 : 1);
        return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Wards
// ---------------------------------------------------------------------------

function createWardsBoard(inst: WardsInstance, host: BoardHost): Board {
  const { w, h: rowsN } = inst.data;
  const el = h('div', 'tf-pz-board');
  const grid = makeGrid(w, rowsN, 'tf-pz-grid--wards');
  grid.setAttribute('aria-label', 'Ward grid');
  el.appendChild(grid);
  const cells: HTMLButtonElement[] = [];
  const shown: number[] = new Array<number>(w * rowsN).fill(-9);
  let sel = Math.max(0, inst.data.start[0] ?? 0);
  let mode: 'open' | 'mark' = 'open';
  let lastMistakes = 0;
  let lastTapped = -1;

  for (let i = 0; i < w * rowsN; i++) {
    const b = h('button', 'tf-pz-cell tf-pz-cell--ward');
    b.type = 'button';
    b.addEventListener('click', () => {
      selectCell(i, false);
      act(i, mode);
    });
    b.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      act(i, 'mark');
    });
    b.addEventListener('focus', () => {
      if (sel !== i) selectCell(i, false);
    });
    cells.push(b);
    grid.appendChild(b);
  }

  const tools = h('div', 'tf-pz-tools-wards');
  const seg = h('div', 'tf-pz-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Tap action');
  const openBtn = btn('tf-pz-segbtn', 'Open', () => setMode('open'), 'Tap opens a tile');
  const markBtn = btn('tf-pz-segbtn', 'Mark trap', () => setMode('mark'), 'Tap marks a trap');
  seg.append(openBtn, markBtn);
  tools.appendChild(seg);

  function setMode(m: 'open' | 'mark'): void {
    mode = m;
    openBtn.setAttribute('aria-pressed', String(m === 'open'));
    markBtn.setAttribute('aria-pressed', String(m === 'mark'));
    openBtn.classList.toggle('is-on', m === 'open');
    markBtn.classList.toggle('is-on', m === 'mark');
  }
  setMode('open');

  function act(i: number, what: 'open' | 'mark'): void {
    const s = host.state();
    if (s.kind !== 'wards' || s.cells[i] !== W_HIDDEN) return;
    lastTapped = i;
    host.dispatch({ type: what === 'open' ? 'open' : 'flag', cell: i });
  }

  function selectCell(i: number, focus = true): void {
    sel = i;
    cells.forEach((b, k) => {
      b.tabIndex = k === sel ? 0 : -1;
    });
    if (focus) (cells[i] as HTMLButtonElement).focus();
  }

  return {
    el,
    tools,
    cols: w,
    rows: rowsN,
    toolRows: 1.3,
    setCell(px) {
      el.style.setProperty('--pz-cell', `${px}px`);
      tools.style.setProperty('--pz-cell', `${px}px`);
    },
    update(state) {
      if (state.kind !== 'wards') return;
      state.cells.forEach((s, i) => {
        const b = cells[i] as HTMLButtonElement;
        const clue = inst.data.clues[i] as number;
        const key = s === W_OPEN ? clue : 100 + s;
        if (shown[i] !== key) {
          shown[i] = key;
          clearNode(b);
          b.className = 'tf-pz-cell tf-pz-cell--ward';
          if (s === W_OPEN) {
            b.classList.add('is-open');
            if (clue > 0) {
              const num = h('span', `tf-pz-num tf-pz-num--${Math.min(clue, 5)}`, String(clue));
              b.appendChild(num);
            }
          } else if (s === W_FLAG) {
            b.classList.add('is-flag');
            b.appendChild(wardFlag());
          } else if (s === W_SPRUNG) {
            b.classList.add('is-sprung');
            b.appendChild(wardSprung());
          }
          const r = Math.floor(i / w) + 1;
          const c = (i % w) + 1;
          const what =
            s === W_OPEN ? (clue > 0 ? `${clue} nearby` : 'safe, no traps nearby') : s === W_FLAG ? 'marked trap' : s === W_SPRUNG ? 'sprung trap' : 'unopened';
          b.setAttribute('aria-label', `Row ${r}, column ${c}: ${what}`);
          b.setAttribute('aria-disabled', s === W_HIDDEN ? 'false' : 'true');
        }
      });
      if (state.mistakes > lastMistakes && lastTapped >= 0 && !reducedMotion()) {
        const b = cells[lastTapped] as HTMLButtonElement;
        b.classList.remove('is-nope');
        void b.offsetWidth;
        b.classList.add('is-nope');
      }
      lastMistakes = state.mistakes;
    },
    focus() {
      selectCell(sel, true);
    },
    onKey(e) {
      if (ARROWS.includes(e.key)) {
        selectCell(moveIndex(sel, e.key, w, rowsN));
        return true;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') {
        act(sel, 'mark');
        return true;
      }
      if (k === 'o') {
        act(sel, 'open');
        return true;
      }
      if (k === 'm') {
        setMode(mode === 'open' ? 'mark' : 'open');
        return true;
      }
      return false;
    },
  };
}

function build(inst: PuzzleInstance, host: BoardHost): Board {
  switch (inst.kind) {
    case 'runes':
      return createRunesBoard(inst, host);
    case 'tumblers':
      return createTumblersBoard(inst, host);
    case 'conduits':
      return createConduitsBoard(inst, host);
    case 'wards':
      return createWardsBoard(inst, host);
  }
}

export function createBoard(inst: PuzzleInstance, host: BoardHost): Board {
  const board = build(inst, host);
  board.hinted = (move) => {
    const items = board.el.querySelectorAll<HTMLElement>(move.type === 'reveal' ? '.tf-pz-slot' : '.tf-pz-cell');
    const idx = 'cell' in move ? move.cell : move.type === 'reveal' ? move.index : -1;
    const target = items[idx];
    if (!target) return;
    target.focus({ preventScroll: true });
    if (reducedMotion()) return;
    target.classList.remove('is-hint');
    void target.offsetWidth;
    target.classList.add('is-hint');
    window.setTimeout(() => target.classList.remove('is-hint'), 1200);
  };
  return board;
}

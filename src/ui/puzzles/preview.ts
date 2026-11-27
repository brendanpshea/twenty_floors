/**
 * Dev harness for the puzzle view. Open dev/puzzle-preview.html.
 * URL params: kind, difficulty, seed, solved=1, mid=1, explain=1, skip=1, fresh=1, bar=0, norewards=1.
 */
import { Rng } from '../../core/rng';
import {
  PUZZLE_KINDS,
  generatePuzzle,
  gradeResult,
  newSkill,
  nextDifficulty,
  pickKind,
  seenKinds,
  simulatePlayer,
  updateSkill,
} from '../../puzzles';
import type { PlayerSkill, PuzzleKind, PuzzleResult } from '../../puzzles';
import { createPuzzleView } from './view';
import type { PlayOptions } from './view';

const rootEl = document.getElementById('ui-root');
if (!rootEl) throw new Error('#ui-root missing');
const view = createPuzzleView(rootEl);
const params = new URLSearchParams(location.search);

const REWARDS = { gold: '120 gp and a potion of healing', silver: '70 gp', bronze: '35 gp', skip: '10 gp' };

// ---------- toolbar ----------
const bar = document.createElement('div');
bar.className = 'pv-bar';
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.textContent = 'Puzzle dev';
const body = document.createElement('div');
body.className = 'pv-body';

function field<T extends HTMLElement>(label: string, el: T): T {
  const l = document.createElement('label');
  l.textContent = `${label} `;
  l.appendChild(el);
  body.appendChild(l);
  return el;
}
const kindSel = field('kind', document.createElement('select'));
for (const k of PUZZLE_KINDS) kindSel.appendChild(new Option(k, k));
const diffIn = field('difficulty', document.createElement('input'));
diffIn.type = 'number';
diffIn.min = '1';
diffIn.max = '10';
diffIn.value = params.get('difficulty') ?? '5';
const seedIn = field('seed', document.createElement('input'));
seedIn.type = 'number';
seedIn.value = params.get('seed') ?? '1';
const strengthIn = field('strength', document.createElement('input'));
strengthIn.type = 'number';
strengthIn.min = '1';
strengthIn.max = '10';
strengthIn.value = '5';
const out = document.createElement('pre');
out.className = 'pv-out';

const kindParam = params.get('kind');
if (kindParam && (PUZZLE_KINDS as readonly string[]).includes(kindParam)) kindSel.value = kindParam;

// ---------- state ----------
const seen = new Set<PuzzleKind>(params.get('fresh') === '1' ? [] : PUZZLE_KINDS);
let skill: PlayerSkill = newSkill();
const recent: PuzzleKind[] = [];
let chest = 0;
const w = window as unknown as { __results: PuzzleResult[]; __view: typeof view };
w.__results = [];
w.__view = view;

function say(msg: string): void {
  out.textContent = `${msg}\n${out.textContent ?? ''}`.slice(0, 4000);
}

function opts(): PlayOptions {
  return {
    title: 'Ironbound Chest',
    flavor: 'A cold lock, scratched by earlier thieves.',
    rewards: params.get('norewards') === '1' ? undefined : REWARDS,
    seenKinds: [...seen],
    forceExplainer: params.get('explain') === '1',
    onExplainerShown: (k) => {
      seen.add(k);
      say(`explainer shown for ${k}`);
    },
  };
}

function describe(r: PuzzleResult): string {
  return `${r.outcome} grade=${r.grade} ${r.seconds}s mistakes=${r.mistakes} hints=${r.hintsUsed} moves=${r.moves}`;
}

async function playManual(): Promise<void> {
  const spec = { kind: kindSel.value as PuzzleKind, seed: Number(seedIn.value), difficulty: Number(diffIn.value) };
  const p = view.play(spec, opts());
  const r = await p;
  w.__results.push(r);
  say(`${spec.kind} d${spec.difficulty} seed ${spec.seed}: ${describe(r)}`);
}

async function playAdaptive(): Promise<void> {
  chest++;
  const rng = new Rng(Date.now() & 0xffffff);
  const kind = pickKind(rng, skill, recent);
  recent.push(kind);
  const depth = Math.min(20, chest);
  const difficulty = nextDifficulty(skill, kind, depth);
  const seed = rng.int(1, 999999);
  const r = await view.play({ kind, seed, difficulty }, opts());
  skill = updateSkill(skill, kind, difficulty, r);
  say(`chest ${chest} ${kind} d${difficulty}: ${describe(r)}; rating ${skill.overall.toFixed(2)} (${kind} ${(skill.byKind[kind] ?? 0).toFixed(2)}); seen ${seenKinds(skill).join(',')}`);
}

function simulate20(): void {
  const strength = Number(strengthIn.value);
  const rng = new Rng(42);
  let s = newSkill();
  const rec: PuzzleKind[] = [];
  const lines: string[] = [`simulated player, strength ${strength}`];
  for (let i = 1; i <= 20; i++) {
    const kind = pickKind(rng, s, rec);
    rec.push(kind);
    const depth = Math.min(20, i);
    const difficulty = nextDifficulty(s, kind, depth);
    const inst = generatePuzzle({ kind, seed: rng.int(1, 999999), difficulty });
    const result = gradeResult(inst, simulatePlayer(inst, strength, rng));
    s = updateSkill(s, kind, difficulty, result);
    lines.push(`#${i} ${kind.padEnd(8)} d${difficulty} ${result.grade.padEnd(6)} ${String(result.seconds).padStart(6)}s  rating ${s.overall.toFixed(2)}`);
  }
  say(lines.join('\n'));
}

function addButton(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  body.appendChild(b);
}
addButton('Play', () => void playManual());
addButton('Adaptive chest', () => void playAdaptive());
addButton('Simulate 20 chests', simulate20);
body.appendChild(out);

bar.append(toggle, body);
document.body.appendChild(bar);
const hasParams = params.has('kind') || params.get('bar') === '0';
body.hidden = hasParams;
toggle.addEventListener('click', () => {
  body.hidden = !body.hidden;
});
if (params.get('bar') === '0') bar.hidden = true;

// ---------- URL-driven scenarios ----------
if (kindParam) {
  void playManual();
  window.setTimeout(() => {
    if (params.get('solved') === '1') view.debug.autoplay(1);
    else if (params.get('mid') === '1') view.debug.autoplay(0.5);
    if (params.get('skip') === '1') window.setTimeout(() => view.debug.openSkipConfirm(), 50);
  }, 400);
}

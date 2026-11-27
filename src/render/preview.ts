import type { CellHighlight, EffectElement, FloorPlan, GridPos, QualityLevel, ThemeId } from '../core/types';
import { CellKind } from '../core/types';
import { planRunThemes, themeForDepth } from '../core/themes';
import { MONSTERS } from '../data/monsters';
import { generateFloorReport } from '../gen/generate';
import { Draft, autoLights, makeFixture } from './fixtures';
import { PROP_TYPES } from './props';
import { createRenderer } from './index';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLPreElement;
const barEl = document.getElementById('bar') as HTMLDivElement;
if (params.get('shot') === '1') document.body.classList.add('shot');

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library', 'foundry', 'ice', 'ruin', 'hell', 'lair', 'forest', 'marsh', 'peaks'];
const THEME_DEPTH: Record<ThemeId, number> = { warrens: 1, crypt: 2, depths: 3, sewers: 4, fungal: 6, hold: 8, library: 10, foundry: 12, ice: 14, ruin: 16, hell: 18, lair: 20, forest: 3, marsh: 6, peaks: 9 };
const QUALITIES: QualityLevel[] = ['low', 'medium', 'high'];
let theme: ThemeId = (THEMES.includes(params.get('theme') as ThemeId) ? params.get('theme') : 'crypt') as ThemeId;
let quality: QualityLevel = (QUALITIES.includes(params.get('quality') as QualityLevel) ? params.get('quality') : 'medium') as QualityLevel;

const renderer = createRenderer(canvas, { quality });
(window as unknown as { __renderer: unknown; __dbg: () => unknown }).__renderer = renderer;
(window as unknown as { __dbg: () => unknown }).__dbg = () => ({ hero: heroCell, monsters: [...monsters].map(([k, v]) => [k, v.cell]), plan: { w: plan.width, h: plan.height, lights: plan.lights.length, props: plan.props.length, lightSample: plan.lights.slice(0, 12).map((l) => [l.color.toString(16), l.intensity, l.radius]), propTypes: plan.props.reduce((a: Record<string, number>, p) => { a[p.type] = (a[p.type] ?? 0) + 1; return a; }, {}), elevRange: [Math.min(...plan.elevation), Math.max(...plan.elevation)] } });

let useGen = params.get('gen') === '1';
let seed = Number(params.get('seed') ?? 1);
let depth = Number(params.get('depth') ?? 1);
// run=<seed> walks a randomized run: each depth shows the theme that run puts there.
const runThemes = params.has('run') ? planRunThemes(Number(params.get('run')), { fixedFloors: 0 }) : undefined;
const themeAt = (d: number): typeof theme => runThemes?.[Math.max(1, Math.min(20, d)) - 1] ?? themeForDepth(d);
if (runThemes) useGen = true;
if (useGen && (runThemes || params.has('depth')) && !params.has('theme')) theme = themeAt(depth);
let plan: FloorPlan = makeFixture(theme);
let buildMs = 0;
let genMs = 0;
let setPiece = '';
/** `?piece=moat` steps the seed forward (at most 200 times) to the next floor built around that set piece. */
let wantPiece = params.get('piece');
let overview = params.get('overview') === '1';
let heroCell: GridPos = { x: 0, y: 0 };
let chestCellG: GridPos = { x: 0, y: 0 };
let fogOn = params.get('fog') === '1';
let revealed = new Uint8Array(0);
let busy = false;
let follow = params.get('follow') !== '0';
const monsters = new Map<string, { hp: number; max: number; cell: GridPos }>();

// ---- navigation helpers (preview only; the game uses src/gen's NavGrid) ----
const walkable = (x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= plan.width || y >= plan.height) return false;
  const k = plan.kinds[y * plan.width + x];
  return k === CellKind.Floor || k === CellKind.Door || k === CellKind.Water;
};
const elev = (x: number, y: number): number => plan.elevation[y * plan.width + x] ?? 0;
const occupied = (x: number, y: number): boolean => {
  for (const p of plan.props) if (p.blocking && p.pos.x === x && p.pos.y === y) return true;
  for (const m of monsters.values()) if (m.cell.x === x && m.cell.y === y) return true;
  return false;
};

function bfs(from: GridPos, maxCost = 999): Map<number, number> {
  const dist = new Map<number, number>();
  const start = from.y * plan.width + from.x;
  dist.set(start, 0);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const cx = cur % plan.width;
    const cy = (cur / plan.width) | 0;
    const cd = dist.get(cur)!;
    if (cd >= maxCost) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(nx, ny) || occupied(nx, ny)) continue;
        if (Math.abs(elev(nx, ny) - elev(cx, cy)) > 1) continue;
        if (dx && dy && (!walkable(cx + dx, cy) || !walkable(cx, cy + dy))) continue;
        const ni = ny * plan.width + nx;
        if (dist.has(ni)) continue;
        dist.set(ni, cd + 1);
        queue.push(ni);
      }
    }
  }
  return dist;
}

function pathTo(from: GridPos, to: GridPos): GridPos[] | null {
  const dist = bfs(from);
  const goal = to.y * plan.width + to.x;
  if (!dist.has(goal)) return null;
  const path: GridPos[] = [];
  let cx = to.x;
  let cy = to.y;
  while (cx !== from.x || cy !== from.y) {
    path.push({ x: cx, y: cy });
    const d = dist.get(cy * plan.width + cx)!;
    let found = false;
    for (let dy = -1; dy <= 1 && !found; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (dist.get(ny * plan.width + nx) === d - 1) {
          cx = nx;
          cy = ny;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }
  return path.reverse();
}

// ---- fog of war demo --------------------------------------------------------
function reveal(center: GridPos, radius = 7): void {
  if (!fogOn) return;
  for (let y = Math.max(0, center.y - radius); y <= Math.min(plan.height - 1, center.y + radius); y++) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(plan.width - 1, center.x + radius); x++) {
      if ((x - center.x) ** 2 + (y - center.y) ** 2 <= radius * radius) revealed[y * plan.width + x] = 1;
    }
  }
  const t0 = performance.now();
  renderer.setRevealed(revealed);
  lastRevealMs = performance.now() - t0;
  for (const [id, m] of monsters) renderer.setEntityState(id, { visible: revealed[m.cell.y * plan.width + m.cell.x] === 1 });
}
let lastRevealMs = 0;

function setFog(on: boolean): void {
  fogOn = on;
  revealed = new Uint8Array(plan.width * plan.height);
  if (on) reveal(heroCell);
  else {
    renderer.setRevealed(new Uint8Array(plan.width * plan.height).fill(1));
    for (const id of monsters.keys()) renderer.setEntityState(id, { visible: true });
  }
  refreshButtons();
}

/** `gallery=1`: a flat lit room with every prop type in a grid (8 per row, 2 cells apart, in PROP_TYPES order, starting at cell 3,3). */
function galleryPlan(t: ThemeId): FloorPlan {
  const cols = 8;
  const w = cols * 2 + 4;
  const h = Math.ceil(PROP_TYPES.length / cols) * 2 + 4;
  const d = new Draft(w, h);
  d.rect(1, 1, w - 2, h - 2);
  d.wallsAround();
  PROP_TYPES.forEach((type, i) => d.prop(type, 3 + (i % cols) * 2, 3 + Math.floor(i / cols) * 2, Number(params.get('rot') ?? 0), false));
  autoLights(d, t);
  return d.toPlan(t, { x: 2, y: 2 }, { x: w - 3, y: h - 3 }, 1);
}

// ---- scene setup -------------------------------------------------------------
async function setup(): Promise<void> {
  if (useGen) {
    const t0 = performance.now();
    let report = generateFloorReport({ seed, depth, theme });
    for (let k = 0; wantPiece && report.setPiece !== wantPiece && k < 200; k++) report = generateFloorReport({ seed: ++seed, depth, theme });
    wantPiece = null;
    plan = report.plan;
    setPiece = report.fallback ? 'fallback layout' : (report.setPiece ?? '');
    genMs = performance.now() - t0;
  } else plan = params.get('gallery') === '1' ? galleryPlan(theme) : makeFixture(theme);
  monsters.clear();
  (window as unknown as { __plan: FloorPlan }).__plan = plan;
  const t1 = performance.now();
  await renderer.loadFloor(plan);
  buildMs = performance.now() - t1;
  const reach = bfs(plan.entrance);
  const cells = [...reach.entries()].sort((a, b) => a[1] - b[1]);
  const pick = (minD: number, skip = 0): GridPos => {
    let n = 0;
    for (const [i, d] of cells) {
      if (d >= minD && !occupied(i % plan.width, (i / plan.width) | 0)) {
        if (n++ < skip) continue;
        return { x: i % plan.width, y: (i / plan.width) | 0 };
      }
    }
    return plan.entrance;
  };
  heroCell = { ...plan.entrance };
  renderer.spawnEntity('hero', { model: params.get('hero') ?? 'hero_knight' }, heroCell, { faction: 'player', size: 'medium' });
  // The floor's own cast (every monster only for the scripted demo, which names some directly).
  const cast = params.get('gallery') === '1' ? [] : params.get('demo') === '1' ? MONSTERS : MONSTERS.filter((m) => m.themes.includes(plan.theme));
  cast.forEach((m, i) => {
    const cell = pick(3 + i, 0);
    monsters.set(m.id, { hp: 20, max: 20, cell: { ...cell } });
    renderer.spawnEntity(m.id, m.visual, cell, { faction: 'enemy', size: m.size });
  });
  if (params.has('mid')) {
    const want = Number(params.get('mid'));
    const c = pick(want, 0);
    heroCell = { ...c };
    renderer.placeEntity('hero', c);
  }
  plan.restSpots.forEach((c, i) => renderer.spawnEntity(`rest${i}`, { model: 'rest_site' }, c, { faction: 'ally', size: 'small' }));
  if (params.get('spent') === '1') plan.restSpots.forEach((_, i) => renderer.setEntityState(`rest${i}`, { dead: true }));
  const chestCell = params.get('gallery') === '1' ? { x: 1, y: 1 } : pick(2, 3);
  chestCellG = { ...chestCell };
  renderer.spawnEntity('chest', { model: params.get('chest') === 'boss' ? 'chest_boss' : 'chest' }, chestCell, { faction: 'ally', size: 'small' });
  if (params.get('chestopen') === '1') renderer.setEntityState('chest', { dead: true });
  if (params.get('chestappear') === '1') {
    renderer.setEntityState('chest', { visible: false });
    window.setTimeout(() => {
      renderer.setEntityState('chest', { visible: true });
      void renderer.playAnim('chest', 'cast');
      const fr = Number(params.get('freeze') ?? -1);
      if (fr >= 0) window.setTimeout(() => renderer.stop(), fr * 1000);
    }, 2500);
  }
  monsters.set('chest', { hp: 1, max: 1, cell: chestCell });
  revealed = new Uint8Array(plan.width * plan.height);
  setFog(fogOn);
  if (params.get('sel') === '1') renderer.setEntityState('hero', { selected: true });
  if (params.get('demo') === '1') {
    renderer.setEntityState('goblin_warrior', { hpFraction: 0.45, targetable: true });
    renderer.setEntityState('ogre', { hpFraction: 0.8 });
    renderer.setEntityState('skeleton', { hpFraction: 0.2, targetable: true });
    renderer.setEntityState('shadow', { dead: true });
    renderer.setEntityState('wolf', { hpFraction: 0.5 });
    renderer.setEntityState('hero', { selected: true });
    void renderer.playAnim('wolf', 'attack');
    void renderer.playAnim('goblin_warrior', 'cast');
    const g = monsters.get('goblin_warrior')!.cell;
    renderer.floatText('goblin_warrior', '12', 'damage');
    renderer.floatText('skeleton', '24', 'crit');
    renderer.floatText('hero', '+7', 'heal');
    renderer.floatText('ogre', 'Miss', 'miss');
    renderer.floatText(g, 'Goblin spotted', 'info');
    const cells: CellHighlight[] = [];
    for (const [i, d] of bfs(heroCell, 4)) {
      if (d > 0) cells.push({ pos: { x: i % plan.width, y: (i / plan.width) | 0 }, style: d <= 4 ? 'move' : 'area' });
    }
    const m = monsters.get('skeleton')!.cell;
    cells.push({ pos: m, style: 'target' });
    for (const o of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) cells.push({ pos: { x: m.x + o[0], y: m.y + o[1] }, style: 'area' });
    for (const o of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) cells.push({ pos: { x: m.x + o[0], y: m.y + o[1] }, style: 'danger' });
    const walk = pathTo(heroCell, m);
    if (walk) for (let i = 0; i < Math.min(4, walk.length - 1); i++) cells.push({ pos: walk[i]!, style: 'path' });
    renderer.setHighlights(cells);
  }
  if (params.get('hazard') === '1') {
    // Danger markers on every chasm / lava cell near the hero, plus a few water cells.
    const cells: CellHighlight[] = [];
    for (let y = heroCell.y - 6; y <= heroCell.y + 6; y++) {
      for (let x = heroCell.x - 6; x <= heroCell.x + 6; x++) {
        if (x < 0 || y < 0 || x >= plan.width || y >= plan.height) continue;
        const k = plan.kinds[y * plan.width + x];
        if (k === CellKind.Chasm && (x + y) % 2 === 0) cells.push({ pos: { x, y }, style: 'danger' });
        if (k === CellKind.Water) cells.push({ pos: { x, y }, style: 'move' });
      }
    }
    renderer.setHighlights(cells);
  }
  applyCamera();
  if (params.has('fx')) setupFx();
  refreshButtons();
}

// ---- effects gallery (?fx=1, or ?fx=<name>[&freeze=<seconds>] to auto-play one effect and stop the loop at that moment) ----
let fxTarget = '';
function fxCells(kind: 'cone' | 'burst' | 'line'): GridPos[] {
  const t = monsters.get(fxTarget)!.cell;
  const out: GridPos[] = [];
  const dx = Math.sign(t.x - heroCell.x) || 1;
  const dy = Math.sign(t.y - heroCell.y);
  if (kind === 'burst') {
    for (let y = t.y - 3; y <= t.y + 3; y++) for (let x = t.x - 3; x <= t.x + 3; x++) if ((x - t.x) ** 2 + (y - t.y) ** 2 <= 10 && walkable(x, y)) out.push({ x, y });
  } else if (kind === 'cone') {
    for (let y = heroCell.y - 6; y <= heroCell.y + 6; y++) {
      for (let x = heroCell.x - 6; x <= heroCell.x + 6; x++) {
        if (!walkable(x, y)) continue;
        if (dy === 0) {
          const rx = (x - heroCell.x) * dx;
          if (rx >= 1 && rx <= 6 && Math.abs(y - heroCell.y) <= rx / 2 + 0.5) out.push({ x, y });
        } else {
          const ry = (y - heroCell.y) * dy;
          if (ry >= 1 && ry <= 6 && Math.abs(x - heroCell.x) <= ry / 2 + 0.5) out.push({ x, y });
        }
      }
    }
  } else {
    const n = Math.max(Math.abs(t.x - heroCell.x), Math.abs(t.y - heroCell.y));
    for (let i = 1; i <= n; i++) out.push({ x: Math.round(heroCell.x + ((t.x - heroCell.x) * i) / n), y: Math.round(heroCell.y + ((t.y - heroCell.y) * i) / n) });
  }
  return out;
}
type Elem = EffectElement;
const fxTable = (): Record<string, () => Promise<unknown>> => {
  const T = fxTarget;
  const pr = (shape: 'arrow' | 'bolt' | 'javelin' | 'rock' | 'dart' | 'orb', element: Elem, hit = true, count = 1) => () => renderer.playEffect({ kind: 'projectile', from: 'hero', to: T, shape, element, hit, count });
  const area = (el: Elem, kind: 'cone' | 'burst' | 'line', origin: 'hero' | 'target') => () => renderer.playEffect({ kind: 'area', origin: origin === 'hero' ? heroCell : monsters.get(T)!.cell, cells: fxCells(kind), element: el });
  const aura = (style: 'heal' | 'shield' | 'bless' | 'buff' | 'debuff' | 'teleport') => () => renderer.playEffect({ kind: 'aura', on: 'hero', style });
  const imp = (strength: number) => () => renderer.playEffect({ kind: 'impact', on: T, from: 'hero', strength, element: 'physical' });
  const anim = (id: string, a: 'shoot' | 'block' | 'dodge' | 'attack' | 'cast') => () => renderer.playAnim(id, a, { facing: id === 'hero' ? monsters.get(T)!.cell : heroCell });
  return {
    'projectile-arrow': pr('arrow', 'physical'),
    'miss-arrow': pr('arrow', 'physical', false),
    'projectile-bolt': pr('bolt', 'physical'),
    'projectile-javelin': pr('javelin', 'physical'),
    'projectile-rock': pr('rock', 'physical'),
    'orb-fire': pr('orb', 'fire'),
    'orb-cold': pr('orb', 'cold'),
    'orb-necrotic': pr('orb', 'necrotic'),
    'volley-force': pr('dart', 'force', true, 3),
    'beam-cold': () => renderer.playEffect({ kind: 'beam', from: 'hero', to: T, element: 'cold' }),
    'beam-lightning': () => renderer.playEffect({ kind: 'beam', from: 'hero', to: T, element: 'lightning' }),
    'beam-radiant': () => renderer.playEffect({ kind: 'beam', from: 'hero', to: T, element: 'radiant' }),
    'cone-fire': area('fire', 'cone', 'hero'),
    'cone-cold': area('cold', 'cone', 'hero'),
    'line-lightning': area('lightning', 'line', 'hero'),
    'burst-fire': area('fire', 'burst', 'target'),
    'burst-cold': area('cold', 'burst', 'target'),
    'burst-acid': area('acid', 'burst', 'target'),
    'burst-radiant': area('radiant', 'burst', 'target'),
    'burst-necrotic': area('necrotic', 'burst', 'target'),
    'burst-thunder': area('thunder', 'burst', 'target'),
    'burst-force': area('force', 'burst', 'target'),
    'aura-heal': aura('heal'),
    'aura-shield': aura('shield'),
    'aura-bless': aura('bless'),
    'aura-buff': aura('buff'),
    'aura-debuff': aura('debuff'),
    'aura-teleport': aura('teleport'),
    'impact-0.3': imp(0.3),
    'impact-0.7': imp(0.7),
    'impact-1': imp(1),
    'anim-shoot': anim('hero', 'shoot'),
    'anim-block': anim('hero', 'block'),
    'anim-dodge': anim('hero', 'dodge'),
    'anim-attack': anim('hero', 'attack'),
    'anim-cast': anim('hero', 'cast'),
    'mon-shoot': anim(T, 'shoot'),
    'mon-block': anim(T, 'block'),
    'mon-dodge': anim(T, 'dodge'),
    'mon-attack': anim(T, 'attack'),
  };
};
function setupFx(): void {
  const ids = [...monsters.keys()].filter((k) => k !== 'chest');
  // The target stands 5 cells from the hero in a straight line if possible.
  const gap = Number(params.get('gap') ?? 5);
  const cands: GridPos[] = [{ x: gap, y: 0 }, { x: -gap, y: 0 }, { x: 0, y: gap }, { x: 0, y: -gap }, { x: gap - 1, y: 3 }, { x: gap - 1, y: -3 }, { x: 3, y: gap - 1 }].map((o) => ({ x: heroCell.x + o.x, y: heroCell.y + o.y }));
  const spot = cands.find((c) => walkable(c.x, c.y) && !occupied(c.x, c.y)) ?? { x: heroCell.x + 1, y: heroCell.y };
  fxTarget = params.get('target') && monsters.has(params.get('target')!) ? params.get('target')! : ids[0] ?? 'chest';
  for (const id of ids) if (id !== fxTarget) renderer.setEntityState(id, { visible: false });
  monsters.get(fxTarget)!.cell = { ...spot };
  renderer.placeEntity(fxTarget, spot);
  const tbl = fxTable();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:6px;bottom:6px;right:6px;display:flex;flex-wrap:wrap;gap:3px';
  for (const name of Object.keys(tbl)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText = 'font:11px system-ui;padding:2px 5px';
    b.addEventListener('click', () => void tbl[name]!());
    wrap.appendChild(b);
  }
  for (const sp of ['normal', 'fast', 'skip'] as const) {
    const b = document.createElement('button');
    b.textContent = `speed ${sp}`;
    b.style.cssText = 'font:11px system-ui;padding:2px 5px;background:#335';
    b.addEventListener('click', () => renderer.setAnimationSpeed(sp));
    wrap.appendChild(b);
  }
  if (params.get('shot') !== '1') document.body.appendChild(wrap);
  const auto = params.get('fx')!;
  if (auto !== '1' && tbl[auto]) {
    const freeze = params.has('freeze') ? Number(params.get('freeze')) : -1;
    if (params.has('speed')) renderer.setAnimationSpeed(params.get('speed') as 'normal' | 'fast' | 'skip');
    const atSec = params.has('at') && !Number.isNaN(Number(params.get('at'))) ? Number(params.get('at')) : -1;
    window.setTimeout(() => {
      if (atSec >= 0) {
        // Deterministic frame: start the effect, hold the effect clock, then step it to `at` seconds.
        (renderer as unknown as { debugEffects(p: boolean, a?: number): void }).debugEffects(true);
        void tbl[auto]!();
        (renderer as unknown as { debugEffects(p: boolean, a?: number): void }).debugEffects(true, atSec);
        return;
      }
      void tbl[auto]!();
      if (freeze >= 0) window.setTimeout(() => { renderer.stop(); (window as unknown as { __frozen: boolean }).__frozen = true; }, freeze * 1000);
    }, 2500);
  }
  // Frame the hero and the target together.
  renderer.focusCamera({ x: Math.round((heroCell.x + spot.x) / 2), y: Math.round((heroCell.y + spot.y) / 2) }, { instant: true });
  renderer.followEntity(null);
}

function applyCamera(): void {
  renderer.setOverview(false);
  applyOrbit();
  renderer.setOverview(overview);
}

function setOverview(on: boolean): void {
  overview = on;
  renderer.setOverview(on);
  refreshButtons();
}

function applyOrbit(): void {
  const cam = params.get('cam') ?? 'a';
  const at = params.get('at');
  const bossRoom = plan.rooms.find((r) => r.role === 'boss');
  const atCell: GridPos | undefined = at === 'rest0' ? plan.restSpots[0] : at === 'rest1' ? plan.restSpots[1] : at === 'exit' ? plan.exit : at === 'entrance' ? plan.entrance : at === 'chest' ? chestCellG : at === 'boss' ? bossRoom?.center : undefined;
  const fx = params.get('focus') ?? (atCell ? `${atCell.x},${atCell.y}` : null);
  const hero = plan.entrance;
  const presets: Record<string, { yaw: number; pitch: number; dist: number }> = {
    a: { yaw: 0.55, pitch: 0.96, dist: 22 },
    b: { yaw: 0, pitch: 1.35, dist: 38 },
    c: { yaw: -0.5, pitch: 0.7, dist: 12 },
    d: { yaw: 2.4, pitch: 0.8, dist: 26 },
    e: { yaw: 0.2, pitch: 1.0, dist: 32 },
  };
  const p = presets[cam] ?? presets.a!;
  renderer.setView({
    yaw: params.has('yaw') ? Number(params.get('yaw')) : p.yaw,
    pitch: params.has('pitch') ? Number(params.get('pitch')) : p.pitch,
    dist: params.has('dist') ? Number(params.get('dist')) : p.dist,
  });
  if (fx) {
    const [x, y] = fx.split(',').map(Number);
    renderer.focusCamera({ x: x ?? hero.x, y: y ?? hero.y }, { instant: true });
  } else if (params.get('wide') === '1') {
    renderer.focusCamera({ x: plan.width >> 1, y: plan.height >> 1 }, { instant: true });
  } else if (follow) renderer.followEntity('hero');
  else renderer.focusCamera(hero, { instant: true });
}

// ---- interaction ---------------------------------------------------------------
async function walkTo(cell: GridPos): Promise<void> {
  if (busy) return;
  const path = pathTo(heroCell, cell);
  if (!path || path.length === 0) return;
  busy = true;
  renderer.setHighlights([]);
  // Reveal progressively while walking.
  const steps = path.length;
  const promise = renderer.moveEntity('hero', path);
  let i = 0;
  const timer = window.setInterval(() => {
    const c = path[Math.min(i++, steps - 1)]!;
    reveal(c);
  }, 160);
  await promise;
  window.clearInterval(timer);
  heroCell = { ...cell };
  reveal(heroCell);
  busy = false;
}

async function attack(id: string): Promise<void> {
  const m = monsters.get(id);
  if (!m || busy) return;
  busy = true;
  renderer.setHighlights([]);
  if (id === 'chest') {
    await renderer.playAnim('chest', 'attack');
    renderer.floatText('chest', '+25 gp', 'info');
    busy = false;
    return;
  }
  // approach if far
  const dx = Math.abs(m.cell.x - heroCell.x);
  const dy = Math.abs(m.cell.y - heroCell.y);
  if (Math.max(dx, dy) > 1 + (id === 'ogre' || id === 'bugbear_warrior' ? 1 : 0)) {
    const path = pathTo(heroCell, m.cell);
    if (path && path.length > 1) {
      const approach = path.slice(0, path.length - 1);
      await renderer.moveEntity('hero', approach);
      heroCell = { ...approach[approach.length - 1]! };
      reveal(heroCell);
    }
  }
  await renderer.playAnim('hero', 'attack', { facing: m.cell });
  const roll = Math.random();
  if (roll < 0.2) renderer.floatText(id, 'Miss', 'miss');
  else {
    const crit = roll > 0.9;
    const dmg = crit ? 18 : 4 + Math.floor(Math.random() * 6);
    m.hp = Math.max(0, m.hp - dmg);
    renderer.floatText(id, String(dmg), crit ? 'crit' : 'damage');
    renderer.setEntityState(id, { hpFraction: m.hp / m.max });
    if (m.hp <= 0) {
      await renderer.playAnim(id, 'death');
      renderer.setEntityState(id, { dead: true });
    } else {
      await renderer.playAnim(id, 'hit');
      if (m.hp < m.max) {
        // monster hits back
        await renderer.playAnim(id, 'attack', { facing: heroCell });
        renderer.floatText('hero', '3', 'damage');
        await renderer.playAnim('hero', 'hit');
      }
    }
  }
  busy = false;
}

renderer.onPick((p) => {
  if (p.entityId?.startsWith('rest')) {
    const id = p.entityId;
    void renderer.playAnim(id, 'cast').then(() => renderer.setEntityState(id, { dead: true }));
    return;
  }
  (window as unknown as { __lastPick: unknown }).__lastPick = p;
  (window as unknown as { __picks: number }).__picks = ((window as unknown as { __picks?: number }).__picks ?? 0) + 1;
  if (p.entityId && p.entityId !== 'hero') void attack(p.entityId);
  else if (p.cell) void walkTo(p.cell);
});

renderer.onHover((p) => {
  (window as unknown as { __lastHover: unknown }).__lastHover = p;
  if (busy) return;
  const cells: CellHighlight[] = [];
  if (p.entityId && p.entityId !== 'hero' && monsters.has(p.entityId)) {
    const m = monsters.get(p.entityId)!;
    cells.push({ pos: m.cell, style: 'target' });
    for (const o of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) cells.push({ pos: { x: m.cell.x + o[0], y: m.cell.y + o[1] }, style: 'danger' });
  } else {
    const reach = bfs(heroCell, 8);
    for (const [i, d] of reach) if (d > 0) cells.push({ pos: { x: i % plan.width, y: (i / plan.width) | 0 }, style: 'move' });
    if (p.cell) {
      const path = pathTo(heroCell, p.cell);
      if (path) for (let i = 0; i < path.length - 1; i++) cells.push({ pos: path[i]!, style: 'path' });
      if (path && path.length) cells.push({ pos: path[path.length - 1]!, style: 'area' });
    }
  }
  renderer.setHighlights(cells);
});

// ---- UI --------------------------------------------------------------------------
const buttons: { el: HTMLButtonElement; isOn: () => boolean }[] = [];
function addButton(label: string, onClick: () => void, isOn: () => boolean = () => false): void {
  const el = document.createElement('button');
  el.textContent = label;
  el.addEventListener('click', onClick);
  barEl.appendChild(el);
  buttons.push({ el, isOn });
}
function refreshButtons(): void {
  for (const b of buttons) b.el.classList.toggle('on', b.isOn());
}
const changeTheme = (t: ThemeId): void => {
  theme = t;
  depth = THEME_DEPTH[t];
  void setup();
};
const changeQuality = (q: QualityLevel): void => {
  quality = q;
  renderer.setQuality(q);
  refreshButtons();
};
THEMES.forEach((t, i) => addButton(`${i < 10 ? `${(i + 1) % 10} ` : ''}${t}`, () => changeTheme(t), () => theme === t));
QUALITIES.forEach((q, i) => addButton(`${'ZXC'[i]} ${q}`, () => changeQuality(q), () => quality === q));
addButton('F fog', () => setFog(!fogOn), () => fogOn);
addButton('P follow', () => {
  follow = !follow;
  renderer.followEntity(follow ? 'hero' : null);
  refreshButtons();
}, () => follow);
addButton('O overview', () => setOverview(!overview), () => overview);
addButton('R reset', () => applyCamera());

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const ti = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].indexOf(k);
  if (ti >= 0) changeTheme(THEMES[ti]!);
  const qi = ['z', 'x', 'c'].indexOf(k);
  if (qi >= 0) changeQuality(QUALITIES[qi]!);
  if (k === 'f') setFog(!fogOn);
  if (k === 'p') {
    follow = !follow;
    renderer.followEntity(follow ? 'hero' : null);
    refreshButtons();
  }
  if (k === 'o') setOverview(!overview);
  if (k === 'r') applyCamera();
  if (k === 'g') { useGen = !useGen; void setup(); }
  if (k === ']') { seed++; void setup(); }
  if (k === '[') { seed = Math.max(0, seed - 1); void setup(); }
  if (k === '.') { depth++; theme = themeAt(depth); void setup(); }
  if (k === ',') { depth = Math.max(1, depth - 1); theme = themeAt(depth); void setup(); }
});

setInterval(() => {
  const s = renderer.stats();
  statsEl.textContent =
    `${theme} / ${renderer.quality}\n` +
    `fps ${s.fps.toFixed(0)}  calls ${s.drawCalls}  tris ${s.triangles}\n` +
    `${useGen ? `gen seed ${seed} depth ${depth} (${plan.width}x${plan.height}) gen ${genMs.toFixed(0)}ms` : 'fixture'} build ${buildMs.toFixed(0)}ms
` +
    (useGen && setPiece ? `set piece: ${setPiece}\n` : '') +
    `geo ${s.geometries}  tex ${s.textures}  fog-update ${lastRevealMs.toFixed(1)}ms\n` +
    `click: walk / attack. drag: pan, right-drag: rotate,\nwheel: zoom. WASD pan, Q/E rotate, +/- zoom.\n` +
    `1-9, 0 theme (hell, lair, forest, marsh, peaks: buttons only), Z/X/C quality, F fog, P follow, O overview, R reset
G gen/fixture, [ ] seed, , . depth`;
}, 500);

void setup();

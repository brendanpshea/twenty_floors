import type { CellHighlight, FloorPlan, GridPos, QualityLevel, ThemeId } from '../core/types';
import { CellKind } from '../core/types';
import { themeForDepth } from '../core/themes';
import { MONSTERS } from '../data/monsters';
import { generateFloorReport } from '../gen/generate';
import { makeFixture } from './fixtures';
import { createRenderer } from './index';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLPreElement;
const barEl = document.getElementById('bar') as HTMLDivElement;
if (params.get('shot') === '1') document.body.classList.add('shot');

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths'];
const QUALITIES: QualityLevel[] = ['low', 'medium', 'high'];
let theme: ThemeId = (THEMES.includes(params.get('theme') as ThemeId) ? params.get('theme') : 'crypt') as ThemeId;
let quality: QualityLevel = (QUALITIES.includes(params.get('quality') as QualityLevel) ? params.get('quality') : 'medium') as QualityLevel;

const renderer = createRenderer(canvas, { quality });
(window as unknown as { __renderer: unknown; __dbg: () => unknown }).__renderer = renderer;
(window as unknown as { __dbg: () => unknown }).__dbg = () => ({ hero: heroCell, monsters: [...monsters].map(([k, v]) => [k, v.cell]), plan: { w: plan.width, h: plan.height, lights: plan.lights.length, props: plan.props.length, lightSample: plan.lights.slice(0, 12).map((l) => [l.color.toString(16), l.intensity, l.radius]), propTypes: plan.props.reduce((a: Record<string, number>, p) => { a[p.type] = (a[p.type] ?? 0) + 1; return a; }, {}), elevRange: [Math.min(...plan.elevation), Math.max(...plan.elevation)] } });

let useGen = params.get('gen') === '1';
let seed = Number(params.get('seed') ?? 1);
let depth = Number(params.get('depth') ?? 1);
if (useGen && params.has('depth') && !params.has('theme')) theme = themeForDepth(depth);
let plan: FloorPlan = makeFixture(theme);
let buildMs = 0;
let genMs = 0;
let setPiece = '';
/** `?piece=moat` steps the seed forward (at most 200 times) to the next floor built around that set piece. */
let wantPiece = params.get('piece');
let overview = params.get('overview') === '1';
let heroCell: GridPos = { x: 0, y: 0 };
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
  } else plan = makeFixture(theme);
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
  renderer.spawnEntity('hero', { model: 'hero_knight' }, heroCell, { faction: 'player', size: 'medium' });
  MONSTERS.forEach((m, i) => {
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
  const chestCell = pick(2, 3);
  renderer.spawnEntity('chest', { model: 'chest' }, chestCell, { faction: 'ally', size: 'small' });
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
    renderer.setHighlights(cells);
  }
  applyCamera();
  refreshButtons();
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
  const fx = params.get('focus');
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
  depth = THEMES.indexOf(t) + 1;
  void setup();
};
const changeQuality = (q: QualityLevel): void => {
  quality = q;
  renderer.setQuality(q);
  refreshButtons();
};
THEMES.forEach((t, i) => addButton(`${i + 1} ${t}`, () => changeTheme(t), () => theme === t));
QUALITIES.forEach((q, i) => addButton(`${i + 4} ${q}`, () => changeQuality(q), () => quality === q));
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
  const ti = ['1', '2', '3'].indexOf(k);
  if (ti >= 0) changeTheme(THEMES[ti]!);
  const qi = ['4', '5', '6'].indexOf(k);
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
  if (k === '.') { depth++; theme = themeForDepth(depth); void setup(); }
  if (k === ',') { depth = Math.max(1, depth - 1); theme = themeForDepth(depth); void setup(); }
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
    `1-3 theme, 4-6 quality, F fog, P follow, O overview, R reset
G gen/fixture, [ ] seed, , . depth`;
}, 500);

void setup();

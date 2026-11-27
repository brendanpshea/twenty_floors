import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { THEMES, THEME_RANGE } from '../core/themes';
import type { Creature, GridPos, HudModel, ThemeId } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { createCombat, instantiateMonster, playerPolicy, runAiTurn, toCreature } from '../rules';
import { runBot } from './autoplay';
import { FloorSession } from './floorSession';
import { quickCharacter } from './quickBuild';
import { makeHarness } from './testing/fakes';

/**
 * Every theme through the real game stack (generate, nav, encounters, spawn, a bot walking and fighting),
 * at the two ends of the theme's depth range and three seeds each. Failures are collected per floor and
 * reported together, so one bad theme does not hide the others.
 */

// SMOKE_WIDE=1 sweeps every depth in each range and eight seeds (slow; for hunting bugs, not for CI).
const WIDE = process.env['SMOKE_WIDE'] === '1';
const SEEDS = WIDE ? [1, 2, 3, 4, 5, 6, 7, 8] : [11, 22, 33];
const BOT_STEPS = 300;
const ALL_THEMES = Object.keys(THEMES) as ThemeId[];

function depthsFor(theme: ThemeId): number[] {
  const [lo, hi] = THEME_RANGE[theme];
  if (WIDE) return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  return lo === hi ? [lo] : [lo, hi];
}

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/manifest.json', import.meta.url), 'utf8')) as {
  models: Record<string, unknown>;
};
/** Prop types the renderer can draw: the keys of BUILDERS in src/render/props.ts. */
const propSource = readFileSync(new URL('../render/props.ts', import.meta.url), 'utf8');
const BUILDERS_AT = propSource.indexOf('const BUILDERS');
const KNOWN_PROPS = new Set(
  [...propSource.slice(BUILDERS_AT).matchAll(/^ {2}(\w+): \(/gm)].map((m) => m[1] as string),
);

interface Failure {
  theme: ThemeId;
  depth: number;
  seed: number;
  where: string;
  message: string;
}

const failures: Failure[] = [];
const standIns = new Map<string, Set<string>>();

function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.message}${e.stack ? ` @ ${e.stack.split('\n')[1]?.trim() ?? ''}` : ''}` : String(e);
}

function neighbours(p: GridPos): GridPos[] {
  const out: GridPos[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

async function smokeFloor(theme: ThemeId, depth: number, seed: number): Promise<void> {
  const fail = (where: string, message: string): void => {
    failures.push({ theme, depth, seed, where, message });
  };
  const h = makeHarness({ theme, depth, seed });
  const session = new FloorSession(h.deps, { runSeed: seed, depth, pc: quickCharacter(depth), shortRestsLeft: 2 }, 1);
  try {
    await session.enter();
  } catch (e) {
    fail('enter', errMsg(e));
    return;
  }
  const s = session.state;
  const nav = s.nav;
  const plan = s.plan;
  if (plan.theme !== theme) fail('theme', `plan theme is ${plan.theme}`);
  if (!nav.isWalkable(s.player.pos) || s.player.pos.x !== plan.entrance.x || s.player.pos.y !== plan.entrance.y) {
    fail('entrance', `hero at ${s.player.pos.x},${s.player.pos.y} is not on the walkable entrance ${plan.entrance.x},${plan.entrance.y}`);
  }
  if (!nav.findPath(plan.entrance, plan.exit)) fail('exit', 'the exit is not reachable from the entrance');
  if (s.restSites.length === 0) fail('rest', 'no rest sites spawned');
  if (s.chests.length === 0) fail('chests', 'no chests spawned');
  if (!s.monsters.some((m) => m.boss)) fail('boss', 'no boss monster on the floor');
  if (s.monsters.length === 0) fail('monsters', 'no monsters at all');
  for (const p of plan.props) if (!KNOWN_PROPS.has(p.type)) fail('prop', `prop type "${p.type}" has no builder in src/render/props.ts`);
  const occupied = new Set<string>();
  for (const m of s.monsters) {
    const c = m.creature;
    const tag = `${c.name} (${c.defId})`;
    if (!m.def) fail('monster', `${tag}: no MonsterDef for the creature`);
    if (!(c.maxHp > 0) || !(c.hp > 0) || !Number.isFinite(c.ac) || c.ac < 1) fail('monster', `${tag}: bad stats hp ${c.hp}/${c.maxHp} ac ${c.ac}`);
    if (!Number.isFinite(c.speed) || c.speed < 0) fail('monster', `${tag}: bad speed ${c.speed}`);
    for (const [k, v] of Object.entries(c.abilities)) if (!Number.isFinite(v) || v < 1) fail('monster', `${tag}: bad ${k} ${v}`);
    if (c.actions.length === 0) fail('monster', `${tag}: no actions`);
    for (const a of c.actions) if (!a.id || !a.name) fail('monster', `${tag}: action without id or name`);
    if (typeof c.visual.model !== 'string' || c.visual.model === '') fail('monster', `${tag}: no visual.model`);
    else if (!(c.visual.model in manifest.models)) {
      const set = standIns.get(c.visual.model) ?? new Set<string>();
      set.add(c.defId);
      standIns.set(c.visual.model, set);
    }
    if (!nav.inBounds(c.pos) || !nav.isWalkable(c.pos)) fail('monster', `${tag}: spawned on a non-walkable cell ${c.pos.x},${c.pos.y}`);
    const key = `${c.pos.x},${c.pos.y}`;
    if (occupied.has(key)) fail('monster', `${tag}: shares cell ${key} with another monster`);
    occupied.add(key);
  }
  for (const ch of s.chests) if (!nav.isWalkable(ch.pos)) fail('chests', `chest on a non-walkable cell ${ch.pos.x},${ch.pos.y}`);
  for (const r of s.restSites) if (!nav.isWalkable(r.pos)) fail('rest', `rest site on a non-walkable cell ${r.pos.x},${r.pos.y}`);

  // The engine must accept every kind of monster on the floor: a duel in its own spot, a few rounds.
  const seen = new Set<string>();
  for (const m of s.monsters) {
    if (seen.has(m.creature.defId)) continue;
    seen.add(m.creature.defId);
    const def = MONSTERS.find((d) => d.id === m.creature.defId);
    if (!def) continue;
    const near = neighbours(m.creature.pos).find((p) => nav.inBounds(p) && nav.isWalkable(p) && nav.stepCost(m.creature.pos, p) < Infinity);
    if (!near) continue;
    try {
      const hero: Creature = toCreature(quickCharacter(depth), near);
      const mon = instantiateMonster(def, 'duel', m.creature.pos);
      const combat = createCombat([hero, mon], nav, new Rng(seed));
      combat.begin();
      for (let i = 0; i < 80 && !combat.isOver; i++) {
        if (combat.activeId === 'player') combat.execute(playerPolicy(combat, nav));
        else runAiTurn(combat, nav);
      }
    } catch (e) {
      fail('engine', `${def.name} (${def.id}): ${errMsg(e)}`);
    }
  }

  // The bot walks and fights through the real session for a while.
  const badHud: string[] = [];
  h.ui.onHud = (hud: HudModel) => {
    if (hud.mode !== 'combat' || !hud.combat) return;
    if (hud.combat.playerTurn && hud.actions.length === 0) badHud.push('no actions on the hero turn');
    if (hud.combat.playerTurn && !hud.combat.initiative.some((e) => e.active && e.id === 'player')) badHud.push('no active initiative entry on the hero turn');
    if (hud.combat.initiative.length < 2) badHud.push('initiative shorter than two');
    if (hud.player.hp < 0 || hud.player.hp > hud.player.maxHp) badHud.push(`hero hp out of range ${hud.player.hp}`);
    const names = new Set(hud.combat.initiative.map((e) => e.name));
    if (names.size !== hud.combat.initiative.length) badHud.push('two initiative entries with the same name');
  };
  try {
    await runBot(session, { maxSteps: BOT_STEPS });
  } catch (e) {
    fail('bot', errMsg(e));
  }
  for (const b of new Set(badHud)) fail('hud', b);
  for (const e of new Set(h.renderer.errors)) fail('renderer', e);
  session.dispose();
  if (h.renderer.entities.size !== 0) fail('dispose', `${h.renderer.entities.size} entities left after dispose`);
}

describe('every theme through the real game stack', () => {
  for (const theme of ALL_THEMES) {
    it(
      theme,
      async () => {
        const before = failures.length;
        for (const depth of depthsFor(theme)) for (const seed of SEEDS) await smokeFloor(theme, depth, seed);
        const mine = failures.slice(before);
        // Group repeats so the message is readable.
        const grouped = new Map<string, number>();
        for (const f of mine) {
          const k = `${f.where}: ${f.message}  [e.g. theme=${f.theme} depth=${f.depth} seed=${f.seed}]`;
          grouped.set(k, (grouped.get(k) ?? 0) + 1);
        }
        expect([...grouped].map(([k, n]) => `${n}x ${k}`)).toEqual([]);
      },
      120_000,
    );
  }

  it('reports model stand-ins (informational)', () => {
    const out = [...standIns].map(([model, ids]) => `${model}: ${[...ids].sort().join(', ')}`);
    const file = process.env['SMOKE_REPORT'];
    if (file) writeFileSync(file, JSON.stringify({ failures, standIns: out }, null, 1));
    expect(Array.isArray(out)).toBe(true);
  });
});

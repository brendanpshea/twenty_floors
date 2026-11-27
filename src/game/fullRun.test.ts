import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SaveGame } from '../core/types';
import { SAVE_KEY } from './deps';
import { Game } from './game';
import { getItem } from '../rules';
import { quickCharacter } from './quickBuild';
import { makeHarness } from './testing/fakes';

/**
 * A whole run played by the bot with the expert policy: floors 1 to N, a hub after every floor (level-up and
 * companion pick), up to 3 retries of a floor, then it gives up. Deaths are fine; exceptions, stuck bots and
 * unfinished hub visits are not. Floors 1 to 8 by default; FULL_RUN=1 plays all 20 (slow) and writes a summary
 * to FULL_RUN_REPORT when that is set.
 */
const FULL = process.env['FULL_RUN'] === '1';
const FLOORS = FULL ? 20 : 8;
const SEEDS = [1, 2, 3];
const MAX_RETRIES = 3;
const WALL_MS = FULL ? 900_000 : 90_000;

interface Outcome {
  seed: number;
  result: 'victory' | 'quit' | 'stuck' | 'timeout';
  reached: number;
  deaths: number;
  levels: number;
  saves: SaveGame[];
  banners: string[];
  /** Why a stuck run stuck: where the hero was and what was around. */
  diag: string;
  /** One line per death: where, by what, how the fight began. */
  deathLog: string[];
}

async function playRun(seed: number, tough = false): Promise<Outcome> {
  const h = makeHarness({ autoplay: true, headless: true, expert: true, floors: FLOORS, seed });
  const deaths = new Map<number, number>();
  let totalDeaths = 0;
  h.ui.showDeath = async (info: { depth: number; killedBy: string }) => {
    h.ui.deaths.push(info);
    totalDeaths++;
    {
      const st = game.session?.state;
      const alive = st ? st.monsters.filter((x) => !x.creature.dead && x.creature.hp > 0) : [];
      const pots = st ? st.pc.inventory.reduce((n, x) => n + (getItem(x.itemId)?.consumable?.effect === 'heal' ? x.quantity : 0), 0) : 0;
      const bossUp = alive.some((x) => x.boss);
      deathLog.push(`floor ${info.depth}: killed by ${info.killedBy}; ${bossUp ? 'boss fight' : 'ordinary room'}; HP at fight start ${fightStart}; ${alive.length} monsters left; potions in pack ${pots}`);
    }
    const n = (deaths.get(info.depth) ?? 0) + 1;
    deaths.set(info.depth, n);
    return n <= MAX_RETRIES ? 'retry' : 'quit';
  };
  // How each fight began (hero HP when it started), to say what killed the run.
  let inFight = false;
  let fightStart = '';
  h.ui.onHud = (m) => {
    if (m.mode === 'combat' && !inFight) {
      inFight = true;
      fightStart = `${m.player.hp}/${m.player.maxHp}`;
    } else if (m.mode !== 'combat') inFight = false;
  };
  const deathLog: string[] = [];
  const saves: SaveGame[] = [];
  const orig = h.storage.set.bind(h.storage);
  h.storage.set = (k, v) => {
    if (k === SAVE_KEY) saves.push(JSON.parse(v) as SaveGame);
    orig(k, v);
  };
  const game: Game = new Game(h.deps);
  const pc = quickCharacter(1);
  // A tough hero (a stand-in for a well-built one) gets the bot past the floors where the starter hero dies, so the
  // deep hubs, the last floor and the victory flow are exercised too.
  if (tough) pc.maxHp = pc.hp = 400;
  const run = game.playRun({ runSeed: seed, depth: 1, pc, shortRestsLeft: 2 });
  let verdict: Outcome['result'] | null = null;
  let diag = '';
  // Watch the bot: any floor where it gives up (stuck, or hit its step cap) is a stuck run.
  const watch = (async () => {
    let seen: Promise<unknown> | null = null;
    while (verdict === null) {
      if (game.botDone && game.botDone !== seen) {
        seen = game.botDone;
        const r = await game.botDone;
        if (r !== 'finished' && verdict === null) {
          verdict = 'stuck';
          const st = game.session?.state;
          if (st) {
            const p = st.player.pos;
            diag = `bot ${r} on floor ${st.depth} (${st.plan.theme}) at ${p.x},${p.y} mode ${st.mode} hp ${st.player.hp}/${st.player.maxHp} stairs ${st.stairsOpen}; alive ${st.monsters.filter((m) => !m.creature.dead && m.creature.hp > 0).map((m) => `${m.creature.name}@${m.creature.pos.x},${m.creature.pos.y}r${m.roomId}`).join(' ')}; chests ${st.chests.map((c) => `${c.pos.x},${c.pos.y}:${c.opened}`).join(' ')}; last log: ${st.log.slice(-3).join(' / ')}`;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  })();
  const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), WALL_MS));
  const end = await Promise.race([run, timer, watch.then(() => 'stuck' as const)]);
  const result: Outcome['result'] = end === 'timeout' ? 'timeout' : verdict === 'stuck' ? 'stuck' : (end as 'victory' | 'quit');
  verdict = result;
  game.stop();
  const reached = Math.max(0, ...h.renderer.plans.map((p) => p.depth));
  expect(h.renderer.errors, `seed ${seed}: renderer misuse`).toEqual([]);
  return { seed, result, reached, deaths: totalDeaths, levels: saves.length > 0 ? Math.max(...saves.map((x) => x.character.level)) : 1, saves, banners: h.ui.banners, diag, deathLog };
}

for (const tough of [false, true]) {
  describe(`the bot plays a whole run (floors 1 to ${FLOORS}${tough ? ', tough hero' : ''})`, () => {
  it(
    'with the expert policy: no exception, no stuck state, every hub visit completes',
    async () => {
      const outcomes: Outcome[] = [];
      for (const seed of SEEDS) outcomes.push(await playRun(seed, tough));
      const summary = outcomes.map((o) => `seed ${o.seed}: ${o.result}, reached floor ${o.reached}, ${o.deaths} deaths, hero level ${o.levels}`);
      // Gear and gold on entering each floor (the first save of each floor), for the economy report.
      const gear = outcomes.flatMap((o) => {
        const seen = new Set<number>();
        const lines = [`seed ${o.seed}:`];
        for (const sv of o.saves) {
          if (seen.has(sv.depth)) continue;
          seen.add(sv.depth);
          const c = sv.character;
          const potions = c.inventory.filter((x) => getItem(x.itemId)?.consumable?.effect === 'heal').map((x) => `${x.quantity} ${x.itemId}`).join(' + ') || 0;
          lines.push(`  floor ${sv.depth}: level ${c.level}, gold ${Math.round(c.gold)}, armor ${c.equipped.armor ?? '-'}, main ${c.equipped.mainHand ?? '-'}, off ${c.equipped.offHand ?? '-'}, ranged ${c.equipped.ranged ?? '-'}, potions ${potions}`);
        }
        lines.push(...o.deathLog.map((d) => `  death: ${d}`));
        return lines;
      });
      if (process.env['FULL_RUN_REPORT']) writeFileSync(`${process.env['FULL_RUN_REPORT']}${tough ? '.tough' : ''}.gear`, gear.join('\n'));
      if (process.env['FULL_RUN_REPORT']) writeFileSync(`${process.env['FULL_RUN_REPORT']}${tough ? '.tough' : ''}`, summary.join('\n'));
      for (const o of outcomes) {
        expect(o.banners.filter((b) => b.includes('failed to load')), `seed ${o.seed}: a floor failed to load`).toEqual([]);
        expect(o.result, `seed ${o.seed}: ${o.diag}`).not.toBe('stuck');
        expect(o.result, `seed ${o.seed}: ${summary.join(' | ')}`).not.toBe('timeout');
        // Every floor the hero entered after the first came through a hub: the saves step up one floor at a time, the
        // hero is a level higher, and from level 4 a companion travels with it.
        const byDepth = new Map<number, SaveGame>();
        for (const sv of o.saves) if (!byDepth.has(sv.depth)) byDepth.set(sv.depth, sv);
        for (const [depth, sv] of byDepth) {
          if (depth === 1) continue;
          const before = byDepth.get(depth - 1);
          expect(before, `seed ${o.seed}: reached floor ${depth} without a save of floor ${depth - 1}`).toBeDefined();
          expect(sv.character.level, `seed ${o.seed}: hero level on floor ${depth}`).toBeGreaterThanOrEqual((before?.character.level ?? 0) + 1);
          if (sv.character.level >= 4) expect(sv.companion, `seed ${o.seed}: no companion on floor ${depth}`).toBeDefined();
          expect(sv.character.hp, `seed ${o.seed}: hero not rested on floor ${depth}`).toBe(sv.character.maxHp);
        }
        if (o.result === 'victory') expect(o.reached).toBe(FLOORS);
      }
    },
    FULL ? 3_600_000 : 300_000,
  );
});
}

describe('how a run ends', () => {
  it('the last floor is 20 unless ?floors= shortens it', async () => {
    const { lastFloor } = await import('./game');
    expect(lastFloor({})).toBe(20);
    expect(lastFloor({ floors: 6 })).toBe(6);
    expect(lastFloor({ floors: 1 })).toBe(1);
    expect(lastFloor({ floors: 99 })).toBe(20);
  });

  it('?floors=2: the hub after floor 1 with its level-up, then victory after floor 2 and not before', async () => {
    let won = false;
    for (let seed = 1; seed <= 6 && !won; seed++) {
      const h = makeHarness({ autoplay: true, headless: true, floors: 2, seed });
      const saves: SaveGame[] = [];
      const orig = h.storage.set.bind(h.storage);
      h.storage.set = (k, v) => {
        if (k === SAVE_KEY) saves.push(JSON.parse(v) as SaveGame);
        orig(k, v);
      };
      const pc = quickCharacter(1);
      pc.maxHp = pc.hp = 400;
      const game = new Game(h.deps);
      const end = await Promise.race([game.playRun({ runSeed: seed, depth: 1, pc, shortRestsLeft: 2 }), new Promise<string>((r) => setTimeout(() => r('timeout'), 30000))]);
      game.stop();
      if (end !== 'victory') continue;
      won = true;
      expect(h.ui.victories).toBe(1);
      const floor2 = saves.find((s) => s.depth === 2);
      expect(floor2?.character.level).toBe(2);
      expect(h.renderer.plans.map((p) => p.depth).sort()).toEqual([1, 2]);
    }
    expect(won).toBe(true);
  }, 120_000);
});

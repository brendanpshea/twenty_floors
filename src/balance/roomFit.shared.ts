import * as nodeFs from 'node:fs';
import { themeForDepth } from '../core/themes';
import type { ThemeId } from '../core/types';
import { AI_TUNING } from '../rules/ai';
import { COMPANION_TUNING } from '../rules/companion';
import { THEME_TUNING } from '../rules/encounterTable';
import { measureRooms, predictClear, type MeasureOptions, type PairingReport } from './rooms';

/** The 20 pairings of the fixed run. */
export function fixedPairings(): { theme: ThemeId; depth: number }[] {
  return Array.from({ length: 20 }, (_, i) => ({ theme: themeForDepth(i + 1), depth: i + 1 }));
}

/** Every theme-and-depth pairing of the tuning table plus the fixed-run ones (the 109 a randomized run can produce). */
export function allPairings(): { theme: ThemeId; depth: number }[] {
  const out = new Map<string, { theme: ThemeId; depth: number }>();
  for (const p of fixedPairings()) out.set(`${p.theme}:${p.depth}`, p);
  for (const [theme, byDepth] of Object.entries(THEME_TUNING)) for (const d of Object.keys(byDepth ?? {})) out.set(`${theme}:${d}`, { theme: theme as ThemeId, depth: Number(d) });
  return [...out.values()].sort((a, b) => a.depth - b.depth || a.theme.localeCompare(b.theme));
}

/** A compact row for the results file (loss lists instead of full outcomes). */
export function row(r: PairingReport, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    theme: r.theme,
    depth: r.depth,
    floors: r.floors,
    combat: r.combat,
    boss: r.boss,
    routeRooms: r.routeRooms,
    sideRooms: r.sideRooms,
    topDealers: r.topDealers,
    predicted: predictClear(r),
    combatLoss: r.outcomes.filter((o) => o.role === 'combat').map((o) => Math.round(o.heroLoss * 100) / 100),
    bossLoss: r.outcomes.filter((o) => o.role === 'boss').map((o) => Math.round(o.heroLoss * 100) / 100),
    heroDeaths: r.outcomes.filter((o) => o.heroDied).length,
    companionDowns: r.outcomes.filter((o) => o.companionDowned).length,
    fights: r.outcomes.length,
    ...extra,
  });
}

export function runShard(shard: number, shards: number, env: Record<string, string | undefined>): void {
  const all = env['ROOMS_ALL'] ? allPairings() : fixedPairings();
  const only = (env['ROOMS_DEPTHS'] ?? '').split(',').filter(Boolean).map(Number);
  const mine = all.filter((_, i) => i % shards === shard).filter((p) => only.length === 0 || only.includes(p.depth));
  const opts: MeasureOptions = {
    floors: Number(env['ROOMS_FLOORS'] ?? 10),
    seed0: Number(env['ROOMS_SEED0'] ?? 500),
    policy: (env['ROOMS_POLICY'] as 'expert' | 'naive') ?? 'expert',
    kit: env['ROOMS_KIT'] ?? 'a',
    companion: env['ROOMS_COMPANION'] ?? 'blink_dog',
  };
  if (env['ROOMS_COMP_HP']) COMPANION_TUNING.hpPerLevelBonus = Number(env['ROOMS_COMP_HP']);
  if (env['ROOMS_COMP_AC']) COMPANION_TUNING.acBonus = Number(env['ROOMS_COMP_AC']);
  if (env['ROOMS_HERO_ATT']) AI_TUNING.heroAttention = Number(env['ROOMS_HERO_ATT']);
  const file = (env['TEMP'] ?? '.') + '/' + (env['ROOMS_OUT'] ?? 'rooms.jsonl');
  for (const p of mine) {
    const r = measureRooms(p.theme, p.depth, opts);
    (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync(file, row(r) + '\n');
  }
}

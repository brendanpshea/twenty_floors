import * as nodeFs from 'node:fs';
import { themeForDepth } from '../core/themes';
import type { Creature } from '../core/types';
import { TERRAIN_TUNING, combatDepth, expertPolicy, makeExpertPolicy, planPush, pushValue, type ExpertOptions, type PolicyFn } from '../rules';
import { typeFactor, valueOf } from '../rules/ai';
import { measureRooms } from './rooms';

/**
 * EXPERIMENT: does thinking pay? Rule variants live behind TERRAIN_TUNING (defaults = today's rules). `applyVariant('a+b')`
 * sets one or more; `runVariantShard` measures the naive and the expert hero over the SAME rooms (paired) at room level
 * and writes per-room outcomes; `analyse` (in the report scripts) turns them into paired differences.
 */

export const VARIANTS: Record<string, Partial<typeof TERRAIN_TUNING>> = {
  base: {},
  fallTurn: { fallsTakeTurn: true },
  heavy: { fallDicePerDepth: 2, slamDicePerDepth: 1 },
  help: { shoveHelpAdvantage: true },
  bonus: { shoveBonusAction: true },
  minions: { minionsDieInFall: true },
  cover: { coverHalf: 3, coverThreeQuarters: 6, heightBonus: 2 },
  flank: { flanking: true },
};

const DEFAULTS = { ...TERRAIN_TUNING };

/** Expert switches a variant name may add (the part before the first '+' or any token): 'noShoveAction' turns off the Shove action itself. */
export const EXPERT_VARIANTS: Record<string, ExpertOptions> = { noShoveAction: { shoveAction: false } };

export function expertFor(name: string): PolicyFn | undefined {
  const opts: ExpertOptions = {};
  for (const part of name.split('+')) Object.assign(opts, EXPERT_VARIANTS[part] ?? {});
  return Object.keys(opts).length > 0 ? makeExpertPolicy(opts) : undefined;
}

export function applyVariant(name: string): void {
  Object.assign(TERRAIN_TUNING, DEFAULTS);
  for (const part of name.split('+')) {
    const v = VARIANTS[part];
    if (!v && !EXPERT_VARIANTS[part]) throw new Error('unknown variant ' + part);
    Object.assign(TERRAIN_TUNING, v ?? {});
  }
}

/** Rooms per pairing so each floor group has 300+ rooms: floors 1-3, 4-7, 8-12, 13-20. */
export function floorsFor(depth: number): number {
  return depth <= 3 ? 25 : depth <= 7 ? 16 : depth <= 12 ? 12 : 8;
}

export function runVariantShard(shard: number, shards: number, env: Record<string, string | undefined>): void {
  const variants = (env['TERRAIN_VARIANTS'] ?? 'base').split(',').filter(Boolean);
  const depths = Array.from({ length: 20 }, (_, i) => i + 1).filter((d) => d % shards === shard);
  const kit = env['TERRAIN_KIT'] ?? 'a';
  const file = (env['TEMP'] ?? '.') + '/' + (env['TERRAIN_OUT'] ?? 'terrain.jsonl');
  for (const variant of variants) {
    applyVariant(variant);
    for (const depth of depths) {
      const theme = themeForDepth(depth);
      const seed0 = 4000 + depth * 100;
      for (const policy of ['naive', 'expert'] as const) {
        const fn = policy === 'expert' ? expertFor(variant) : undefined;
        const r = measureRooms(theme, depth, { floors: Number(env['TERRAIN_FLOORS'] ?? floorsFor(depth)), seed0, policy, kit, ...(fn ? { policyFn: fn } : {}) });
        const row = {
          variant,
          depth,
          theme,
          policy,
          kit,
          rooms: r.outcomes.map((o) => [o.role === 'boss' ? 1 : 0, Math.round(o.heroLoss * 1000) / 1000, o.heroDied ? 1 : 0, o.companionDowned ? 1 : 0, o.heroHazards, Math.round(o.heroHazardDamage), o.heroHazardDeath ? 1 : 0, o.enemyHazards, o.slams, o.rounds, o.notes, o.enemyKinds]),
        };
        (nodeFs as unknown as { appendFileSync(f: string, d: string): void }).appendFileSync(file, JSON.stringify(row) + '\n');
      }
    }
  }
  applyVariant('base');
}

// ------------------------------------------------------------------------------ opportunity (part A)

export interface OppStats {
  decisions: number;
  withAdjacent: number;
  offered: Record<string, number>;
  offeredDecisions: number;
  successSum: number;
  offers: number;
  evPush: number;
  evAttack: number;
  pushBetter: number;
}

/** The expert hero wrapped to count, at every decision with an adjacent enemy, the pushes into hazards that were available. */
export function instrumentedExpert(stats: OppStats): PolicyFn {
  return (combat, nav) => {
    const c = combat.creature('player') as Creature;
    stats.decisions++;
    const enemies = combat.creatures().filter((o) => o.faction === 'enemy' && !o.dead && o.hp > 0);
    const adj = enemies.filter((e) => Math.max(Math.abs(e.pos.x - c.pos.x), Math.abs(e.pos.y - c.pos.y)) <= 1);
    if (adj.length > 0) {
      stats.withAdjacent++;
      let any = false;
      for (const e of adj) {
        if (!combat.canUse('shove_push').ok && combat.turn.actionUsed) continue;
        const plan = planPush(nav, (p) => combat.creatures().some((o) => o !== e && !o.dead && o.hp > 0 && o.pos.x === p.x && o.pos.y === p.y), e.pos, Math.sign(e.pos.x - c.pos.x), Math.sign(e.pos.y - c.pos.y), 1);
        const kind = plan.hazard ? plan.hazard.kind : plan.obstacle ? plan.obstacle.kind : plan.water ? 'water' : null;
        if (!kind) continue;
        any = true;
        stats.offered[kind] = (stats.offered[kind] ?? 0) + 1;
        const fail = combat.hitChance('shove_push', e.id) ?? 0;
        const near = enemies.filter((o) => o !== e && Math.max(Math.abs(o.pos.x - e.pos.x), Math.abs(o.pos.y - e.pos.y)) <= 1).length + 1;
        const ev = fail * pushValue(plan, combatDepth(combat), e.hp, near, (ty) => typeFactor(e, ty));
        let atk = 0;
        for (const a of c.actions) if (a.id.startsWith('atk_') && combat.canUse(a.id).ok && combat.validTargets(a.id).includes(e.id)) atk = Math.max(atk, valueOf(combat, c, a, e));
        stats.offers++;
        stats.successSum += fail;
        stats.evPush += ev;
        stats.evAttack += atk;
        if (ev > atk) stats.pushBetter++;
      }
      if (any) stats.offeredDecisions++;
    }
    return expertPolicy(combat, nav);
  };
}

export function emptyOpp(): OppStats {
  return { decisions: 0, withAdjacent: 0, offered: {}, offeredDecisions: 0, successSum: 0, offers: 0, evPush: 0, evAttack: 0, pushBetter: 0 };
}

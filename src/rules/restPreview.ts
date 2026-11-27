import type { CompanionState, PlayerCharacter, RestPreview } from '../core/types';
import { SHORT_RESTS_PER_LONG_REST } from '../core/types';
import { finalAbilities } from './character';
import { getClass } from './classes';
import { companionAbilities, companionLevel, companionMaxHp, companionResources, companionRole, getCompanion } from './companion';
import { abilityMod, isHiddenResource } from './util';

/**
 * What a rest would do, before the player commits to it. Pure: no dice are rolled (hit dice count at their average,
 * floored at 1 as takeShortRest does) and nothing is modified.
 *
 * The short-rest spending rule is the one takeShortRest uses: spend a Hit Die while one is left and either at least an
 * average die of HP is missing or the hero is below half HP with anything missing.
 *
 * `wasteful` is true when the rest would give back little:
 *  - short rest: it would heal under 15% of maximum HP (the hero's and the companion's), and bring back no resource;
 *  - long rest: under 15% of HP missing (hero and companion), under a quarter of the Hit Dice missing and no resource pool a quarter or more spent, and nothing else (a companion's abilities) to restore.
 */

const LOW_HP = 0.15;
const LOW_OTHER = 0.25;

/** Expected value of one Hit Die roll plus the Constitution modifier, floored at 1 (as takeShortRest rolls it). */
function expectedDie(sides: number, con: number): number {
  let sum = 0;
  for (let f = 1; f <= sides; f++) sum += Math.max(1, f + con);
  return sum / sides;
}

/** Average healing of an optimal short rest, and the dice it uses. */
function shortHeal(hp: number, maxHp: number, dice: number, sides: number, con: number): { healed: number; spent: number } {
  const average = (sides + 1) / 2 + con;
  const each = expectedDie(sides, con);
  let cur = hp;
  let left = dice;
  let spent = 0;
  while (left > 0 && cur < maxHp && (maxHp - cur >= average || cur < maxHp * 0.5)) {
    cur = Math.min(maxHp, cur + each);
    left -= 1;
    spent += 1;
  }
  return { healed: cur - hp, spent };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function previewRest(
  pc: PlayerCharacter,
  companion: { state: CompanionState } | null,
  kind: 'short' | 'long',
  ctx: { shortRestsLeft: number; restSitesLeft?: number },
): RestPreview {
  const cls = getClass(pc.build.classId);
  const sides = cls?.hitDie ?? 10;
  const con = abilityMod(finalAbilities(pc.build).con);
  const gains: string[] = [];
  const costs: string[] = [];
  const missing = pc.maxHp - pc.hp;
  const hpFrac = pc.maxHp > 0 ? missing / pc.maxHp : 0;

  // Companion.
  const def = companion ? getCompanion(companion.state.id) : undefined;
  let companionHeal = 0;
  let companionFrac = 0;
  let companionExtras = false;
  if (companion && def) {
    const level = companionLevel(pc.level);
    const max = companionMaxHp(def, level);
    const cMissing = Math.max(0, max - companion.state.hp);
    companionFrac = max > 0 ? cMissing / max : 0;
    if (kind === 'long') {
      companionHeal = cMissing;
      const full = companionResources(def, level);
      companionExtras = Object.entries(full).some(([k, p]) => !isHiddenResource(k) && (companion.state.resources[k]?.current ?? 0) < p.max);
    } else {
      const dice = companion.state.resources['_hitDice']?.current ?? level;
      const rule = shortHeal(companion.state.hp, max, dice, companionRole(def).hitDie, abilityMod(companionAbilities(def, level).con));
      companionHeal = rule.healed;
    }
  }

  // Resources that would come back (display names; hidden ones never appear).
  const restored: string[] = [];
  let usesFrac = 0;
  for (const [key, pool] of Object.entries(pc.resources)) {
    if (isHiddenResource(key) || pool.max <= 0) continue;
    if (key !== 'lastStand') usesFrac = Math.max(usesFrac, Math.max(0, pool.max - pool.current) / pool.max);
    if (pool.current >= pool.max) continue;
    if (kind === 'long') {
      if (key !== 'lastStand') restored.push(`${pool.name} restored`);
    } else if (pool.refresh === 'shortRest') {
      restored.push(`${pool.name} restored`);
    } else {
      const n = cls?.shortRestRecovery[key] ?? 0;
      if (n > 0) restored.push(pool.current + n >= pool.max ? `${pool.name} restored` : `${pool.name}: ${plural(n, 'use', 'uses')} back`);
    }
  }

  if (kind === 'short') {
    const { healed, spent } = shortHeal(pc.hp, pc.maxHp, pc.hitDiceLeft, sides, con);
    const rounded = Math.round(healed);
    if (rounded > 0) gains.push(`Recover about ${rounded} HP (${plural(spent, 'Hit Die', 'Hit Dice')})`);
    gains.push(...restored);
    if (def && companion && Math.round(companionHeal) > 0) gains.push(`Your ${def.name} recovers about ${Math.round(companionHeal)} HP`);
    if (ctx.shortRestsLeft <= 0) costs.push('No short rests left before your next long rest');
    else {
      const after = ctx.shortRestsLeft - 1;
      costs.push(after === 0 ? 'No more short rests before your next long rest' : `${plural(after, 'short rest', 'short rests')} left before your next long rest`);
    }
    const heals = healed / Math.max(1, pc.maxHp) >= LOW_HP || (def && companionHeal / Math.max(1, companionHp(def, pc.level)) >= LOW_HP);
    return { kind, gains, costs, wasteful: !heals && restored.length === 0 };
  }

  // Long rest.
  if (missing > 0) gains.push(`Restore all ${missing} missing HP`);
  const diceBack = pc.level - pc.hitDiceLeft;
  if (diceBack > 0) gains.push(`Regain ${plural(diceBack, 'Hit Die', 'Hit Dice')}`);
  gains.push(...restored);
  if (def && companion) {
    if (Math.round(companionHeal) > 0) gains.push(`Your ${def.name} recovers ${Math.round(companionHeal)} HP`);
    if (companionExtras) gains.push(`Your ${def.name}'s abilities are restored`);
  }
  if (ctx.shortRestsLeft < SHORT_RESTS_PER_LONG_REST) gains.push(`Short rests back to ${SHORT_RESTS_PER_LONG_REST}`);
  costs.push('This site cannot be used again');
  if (ctx.restSitesLeft !== undefined) {
    const after = Math.max(0, ctx.restSitesLeft - 1);
    costs.push(after === 0 ? 'No rest sites left on this floor afterwards' : `${plural(after, 'rest site', 'rest sites')} left on this floor afterwards`);
  }
  const dieFrac = pc.level > 0 ? diceBack / pc.level : 0;
  const wasteful = hpFrac < LOW_HP && companionFrac < LOW_HP && dieFrac < LOW_OTHER && usesFrac < LOW_OTHER && !companionExtras;
  return { kind, gains, costs, wasteful };
}

function companionHp(def: NonNullable<ReturnType<typeof getCompanion>>, heroLevel: number): number {
  return companionMaxHp(def, companionLevel(heroLevel));
}

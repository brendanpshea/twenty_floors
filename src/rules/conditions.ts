import type { Ability, ActiveCondition, Condition, Creature, OngoingDamage } from '../core/types';
import { hasFlag } from './util';

export const INCAPACITATING: readonly Condition[] = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export function hasCondition(c: Creature, cond: Condition): boolean {
  return c.conditions.some((x) => x.condition === cond);
}

export function isIncapacitated(c: Creature): boolean {
  return c.conditions.some((x) => INCAPACITATING.includes(x.condition));
}

/**
 * HOUSE RULE: 'slowed' is one game condition standing for the SRD's slowing effects (the Slow spell, the Stone Golem's Slow,
 * the copper dragons' Slowing Breath). What it keeps, all common to those texts: Speed halved (round down, at least 1 cell),
 * no Reactions, an action OR a bonus action per turn (not both), and at most one attack with the Attack action (a Multiattack
 * performs only its first attack; the combat engine applies these three). What it drops: the Slow spell's -2 to AC and
 * Dexterity saves (the dragons' breath and the golem's stat block do not state it, so the condition does not carry it), the
 * 25 percent spell failure, and the spell's repeated save (the breath simply lasts until the end of the target's next turn).
 */
export function slowedSpeed(speed: number): number {
  return speed > 0 ? Math.max(1, Math.floor(speed / 2)) : 0;
}

/** Speed is 0 while restrained, grappled or incapacitated (petrified included); halved while slowed. */
export function effectiveSpeed(c: Creature): number {
  if (isIncapacitated(c) || hasCondition(c, 'restrained') || hasCondition(c, 'grappled')) return 0;
  return hasCondition(c, 'slowed') ? slowedSpeed(c.speed) : c.speed;
}

/** Paralyzed, petrified, stunned and unconscious creatures automatically fail Strength and Dexterity saves. */
export function autoFailsSave(c: Creature, ability: Ability): boolean {
  if (ability !== 'str' && ability !== 'dex') return false;
  return hasCondition(c, 'paralyzed') || hasCondition(c, 'petrified') || hasCondition(c, 'stunned') || hasCondition(c, 'unconscious');
}

export function mergeMode(adv: boolean, dis: boolean): RollMode {
  if (adv && !dis) return 'advantage';
  if (dis && !adv) return 'disadvantage';
  return 'normal';
}

/** Advantage/disadvantage on an attack roll that come from conditions alone (SRD 5.2). */
export function attackModeFromConditions(
  attacker: Creature,
  target: Creature,
  adjacent: boolean,
): { adv: boolean; dis: boolean } {
  let adv = false;
  let dis = false;
  if (hasCondition(attacker, 'invisible')) adv = true;
  for (const c of ['poisoned', 'frightened', 'blinded', 'prone', 'restrained'] as const) {
    if (hasCondition(attacker, c)) dis = true;
  }
  if (hasCondition(target, 'blinded')) adv = true;
  if (hasCondition(target, 'invisible')) dis = true;
  for (const c of ['paralyzed', 'petrified', 'stunned', 'unconscious', 'restrained'] as const) {
    if (hasCondition(target, c)) adv = true;
  }
  if (hasCondition(target, 'prone')) {
    if (adjacent) adv = true;
    else dis = true;
  }
  if (hasCondition(target, 'dodging') && !isIncapacitated(target)) dis = true;
  return { adv, dis };
}

/** Mode for a saving throw. `applies` is the condition the effect would inflict, if any. */
export function saveMode(c: Creature, ability: Ability, applies?: Condition): RollMode {
  let adv = false;
  let dis = false;
  if (ability === 'dex') {
    if (hasCondition(c, 'dodging') && !isIncapacitated(c)) adv = true;
    if (hasCondition(c, 'restrained')) dis = true;
  }
  if (applies && hasFlag(c, `saveAdv_${applies}`)) adv = true;
  return mergeMode(adv, dis);
}

export function d20Probability(modeOrNormal: RollMode, p: number): number {
  if (modeOrNormal === 'advantage') return 1 - (1 - p) * (1 - p);
  if (modeOrNormal === 'disadvantage') return p * p;
  return p;
}

/** Probability that a single d20 attack roll hits (nat 1 misses; nat >= critMin always hits). */
export function singleHitProbability(bonus: number, ac: number, critMin: number): number {
  let hits = 0;
  for (let v = 2; v <= 20; v++) if (v >= critMin || v + bonus >= ac) hits++;
  return hits / 20;
}

/** Probability that a creature succeeds on a single d20 save (no natural 1/20 rule for saves). */
export function singleSaveProbability(bonus: number, dc: number): number {
  let ok = 0;
  for (let v = 1; v <= 20; v++) if (v + bonus >= dc) ok++;
  return ok / 20;
}

export function makeCondition(
  condition: Condition,
  rounds: number | null,
  sourceId?: string,
  saveEnds?: { ability: Ability; dc: number },
  thenOnFail?: { condition: Condition },
  ongoing?: OngoingDamage,
): ActiveCondition {
  const ac: ActiveCondition = { condition, rounds };
  if (sourceId !== undefined) ac.sourceId = sourceId;
  if (saveEnds) ac.saveEnds = { ...saveEnds };
  if (thenOnFail) ac.thenOnFail = { ...thenOnFail };
  if (ongoing) ac.ongoing = { damage: ongoing.damage.map((d) => ({ ...d })), ...(ongoing.when ? { when: ongoing.when } : {}) };
  return ac;
}

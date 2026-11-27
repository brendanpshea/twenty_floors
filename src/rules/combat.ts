import type { Rng } from '../core/rng';
import type {
  ActionDef,
  ActiveCondition,
  Ability,
  AttackOutcome,
  Command,
  CombatApi,
  Condition,
  Creature,
  DamageType,
  Faction,
  GameEvent,
  GridPos,
  NavGrid,
  ReachableCell,
  TurnState,
} from '../core/types';
import { MONSTERS } from '../data/monsters';
import { getItem } from './items';
import {
  INCAPACITATING,
  attackModeFromConditions,
  autoFailsSave,
  d20Probability,
  effectiveSpeed,
  hasCondition,
  isIncapacitated,
  makeCondition,
  mergeMode,
  saveMode,
  singleHitProbability,
  singleSaveProbability,
  type RollMode,
} from './conditions';
import { averageDice, formatDice, parseDice, rollDice } from './dice';
import { abilityMod, areHostile, chebyshev, hasFlag, isAlive, isFriendlySide } from './util';
import { chromaticOrbType, fxVal, isSpellAction } from './spells';
import { SHOVE_PUSH_ID, SHOVE_TRIP_ID, isShove, shovePushAction, shoveTripAction } from './actions';
import { typeFactor } from './ai';
import { TERRAIN_TUNING, isDeadly, pushValue, canShoveSize, climbOutCell, coverBonusFor, fallDice, planPush, slamDice } from './terrain';
import { creatureTactic } from './tactics';

/** Per-combat readers that the CombatApi surface has no room for (see `attacksLeft`). */
const attackReaders = new WeakMap<CombatApi, () => number>();
const depthReaders = new WeakMap<CombatApi, number>();
const navReaders = new WeakMap<CombatApi, NavGrid>();

/** HOUSE RULE "boss momentum": from this floor depth the floor's boss acts once more at the end of each of its turns. */
export const BOSS_MOMENTUM_FROM_DEPTH = 6;

/** The floor depth this combat was created for (hazard damage is 1d6 per depth); 1 when none was given. */
export function combatDepth(combat: CombatApi): number {
  return depthReaders.get(combat) ?? 1;
}

/**
 * What a shove or push would do to a target: the hazard it would be forced into and the damage dice (1d6 per floor
 * depth), or null when the action does not push or nothing lies behind the target. For the HUD's target panel.
 * Considers Shove: Push (5 ft), the Push mastery and Thunderwave (10 ft), from the ACTIVE creature's position.
 */
export function pushPreview(combat: CombatApi, actionId: string, targetId: string): PushPreview | null {
  const nav = navReaders.get(combat);
  const c = combat.creature(combat.activeId);
  const t = combat.creature(targetId);
  const a = c ? findAction(c, actionId) : undefined;
  if (!nav || !c || !t || !a) return null;
  const fx = a.effects ?? [];
  const tm = fx.some((e) => e.startsWith('tmOwn:')) && hasFlag(c, 'tacticalMaster') && !hasFlag(c, 'tacticalAuto');
  const cells = fx.includes('shove:push') ? 1 : fx.includes('mastery:push') || fx.includes('thunderwavePush') || tm ? 2 : 0;
  if (cells === 0 || (t.size === 'huge' && !fx.includes('shove:push'))) return null;
  const plan = planPush(nav, (p) => combat.creatures().some((o) => isAlive(o) && o.id !== t.id && o.pos.x === p.x && o.pos.y === p.y), t.pos, Math.sign(t.pos.x - c.pos.x), Math.sign(t.pos.y - c.pos.y), cells);
  const d = combatDepth(combat);
  if (plan.hazard) return { hazard: plan.hazard.kind, damage: `${fallDice(d)}d6` };
  if (plan.obstacle) return { hazard: plan.obstacle.kind, damage: `${slamDice(d)}d6` };
  if (plan.water) return { hazard: 'water', prone: true };
  if (plan.slid) return { hazard: 'ice' };
  return null;
}

/** What a push would do to its target; see `pushPreview`. */
export interface PushPreview {
  /** 'fall' and 'lava': into the drop or the fire; 'fire' and 'spikes': slammed against it; 'water': knocked Prone; 'ice': slides one more cell. */
  hazard: 'fall' | 'lava' | 'water' | 'ice' | 'fire' | 'spikes';
  /** Damage dice, when it hurts ("3d6": 1d6 per depth for fall and lava, 1d6 per two depths for fire and spikes). */
  damage?: string;
  /** True when the target ends Prone (water). */
  prone?: boolean;
}

/** Options for `createCombat`. */
export interface CombatOptions {
  /**
   * The floor depth. HOUSE RULE: a creature forced into a pit or lava takes 1d6 damage per floor depth
   * (bludgeoning from a fall, fire from lava). Default 1.
   */
  depth?: number;
}

/**
 * Attacks the active creature can still make with its current Attack action(s). A hero with Extra Attack has
 * 1 + extra attacks per Attack action: the first weapon attack uses the action, the others are free while
 * `attacksLeft` is above 0 (movement may come between them). After Action Surge a full new set is available once
 * these are spent. Creatures without Extra Attack: 1 until the action is used, then 0.
 */
export function attacksLeft(combat: CombatApi): number {
  return attackReaders.get(combat)?.() ?? 0;
}

/** Remove a flat modifier from a dice string ("1d8+4" minus 3 is "1d8+1"). Used by Cleave. */
function withoutModifier(dice: string, amount: number): string {
  const p = parseDice(dice);
  return formatDice({ ...p, mod: p.mod - amount });
}

/** Condition ids that take a creature's turn away: the "heavy effect" that Indomitable answers. */
const TURN_LOSING: readonly Condition[] = ['incapacitated', 'paralyzed', 'stunned', 'unconscious'];

/**
 * HOUSE RULE: a ranged attacker standing at least `minSteps` elevation steps
 * above its target gets `bonus` to hit. This is the one place the rule lives.
 */
export const ELEVATION_ATTACK_BONUS = { minSteps: 2, bonus: 1 } as const;

export function elevationAttackBonus(nav: NavGrid, attacker: GridPos, target: GridPos): number {
  const diff = nav.elevationAt(attacker) - nav.elevationAt(target);
  return diff >= ELEVATION_ATTACK_BONUS.minSteps ? TERRAIN_TUNING.heightBonus : 0;
}

/** HOUSE RULE: escaping an indefinite restraint is an action: STR check against this DC. */
export const BREAK_FREE_DC = 12;
export const BREAK_FREE_ID = 'break_free';

const MAX_SKIPPED_TURNS = 100;
/** Weapon Mastery: Slow takes 10 ft (2 cells) off the target's speed. */
const SLOW_CELLS = 2;

function breakFreeAction(): ActionDef {
  return {
    id: BREAK_FREE_ID,
    name: 'Break Free',
    description: `Use your action to struggle free: Strength check against DC ${BREAK_FREE_DC}.`,
    icon: 'special',
    cost: 'action',
    targeting: { kind: 'self' },
    effects: ['breakFree'],
  };
}

function canBreakFree(c: Creature): boolean {
  return c.conditions.some((x) => x.condition === 'restrained' && x.rounds === null);
}

/** The creature's action with this id, including the generated Break Free while it is restrained. */
/** Experiment: the hero's Shove as a bonus action (TERRAIN_TUNING.shoveBonusAction). */
function shoveFor(c: Creature, a: ActionDef): ActionDef {
  return TERRAIN_TUNING.shoveBonusAction && c.faction === 'player' ? { ...a, cost: 'bonus' } : a;
}

export function findAction(c: Creature, id: string): ActionDef | undefined {
  const own = c.actions.find((a) => a.id === id);
  if (own) return own;
  if (id === BREAK_FREE_ID && canBreakFree(c)) return breakFreeAction();
  if (id === SHOVE_PUSH_ID) return shoveFor(c, shovePushAction());
  if (id === SHOVE_TRIP_ID) return shoveFor(c, shoveTripAction());
  return undefined;
}

export function actionCost(c: Creature, a: ActionDef): ActionDef['cost'] {
  if (a.id === 'disengage' && c.traits.includes('nimbleEscape')) return 'bonus';
  return a.cost;
}

/**
 * Cells covered by an area. Sphere: all cells within the radius (Euclidean)
 * with sight to the origin. Cone and line are approximations along the vector
 * from the caster toward the point. Walkable cells only.
 */
export function computeAreaCells(
  nav: NavGrid,
  caster: GridPos,
  point: GridPos,
  range: number,
  area: { shape: 'sphere' | 'cone' | 'line'; size: number },
): GridPos[] {
  const out: GridPos[] = [];
  const size = area.size;
  if (area.shape === 'sphere') {
    const origin = range === 0 ? caster : point;
    for (let y = origin.y - size; y <= origin.y + size; y++) {
      for (let x = origin.x - size; x <= origin.x + size; x++) {
        const p = { x, y };
        if (!nav.inBounds(p) || !nav.isWalkable(p)) continue;
        const dx = x - origin.x;
        const dy = y - origin.y;
        if (dx * dx + dy * dy > (size + 0.5) * (size + 0.5)) continue;
        if (!(x === origin.x && y === origin.y) && !nav.hasLineOfSight(origin, p)) continue;
        out.push(p);
      }
    }
    return out;
  }
  let dx = point.x - caster.x;
  let dy = point.y - caster.y;
  if (dx === 0 && dy === 0) return out;
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  for (let y = caster.y - size; y <= caster.y + size; y++) {
    for (let x = caster.x - size; x <= caster.x + size; x++) {
      const p = { x, y };
      if (x === caster.x && y === caster.y) continue;
      if (!nav.inBounds(p) || !nav.isWalkable(p)) continue;
      const rx = x - caster.x;
      const ry = y - caster.y;
      const along = rx * dx + ry * dy;
      const lateral = Math.abs(rx * -dy + ry * dx);
      if (along <= 0.3 || along > size + 0.5) continue;
      const inside = area.shape === 'cone' ? lateral <= along / 2 + 0.35 : lateral < 0.75;
      if (!inside) continue;
      if (!nav.hasLineOfSight(caster, p)) continue;
      out.push(p);
    }
  }
  return out;
}

interface AttackSetup {
  bonus: number;
  mode: RollMode;
  critMin: number;
  /** Cover the target has against this attack (0, 2 or 5), added to its AC. */
  cover: number;
}

export function createCombat(creatures: Creature[], nav: NavGrid, rng: Rng, options: CombatOptions = {}): CombatApi {
  const all = creatures;
  const depth = Math.max(1, Math.floor(options.depth ?? 1));
  /** HOUSE RULE (lurkers): an ambusher that began the fight out of the hero's sight has advantage on its first attack. */
  const ambush = new Set<string>();
  /** Cloak of Displacement: wearers whose displacement is up (it ends when they are hit and returns at the start of their turn). */
  const displaced = new Set<string>(all.filter((c) => hasFlag(c, 'displacement')).map((c) => c.id));
  /** Experiment (fallsTakeTurn): creatures in a pit until the end of their next turn, with where they fell in. */
  const pitted = new Map<string, { at: GridPos; origin: GridPos }>();
  const byId = new Map<string, Creature>();
  for (const c of all) byId.set(c.id, c);

  const order: string[] = [];
  let round = 0;
  let idx = 0;
  let began = false;
  let over = false;
  let winner: Faction | null = null;
  const turn: TurnState = { creatureId: '', movementLeft: 0, actionUsed: false, bonusUsed: false };
  const reactionUsed = new Set<string>();
  const spentRecharge = new Map<string, Set<string>>();
  const slowed = new Map<string, { by: string; cells: number }>();
  /** Weapon Mastery Vex: attacker id -> target it has advantage against, and attacker turn-ends left. */
  /** Weapon Mastery Sap: sapped creature id -> attacker; its next attack roll has disadvantage until that attacker's next turn. */
  const sapped = new Map<string, { by: string }>();
  const vexed = new Map<string, { targetId: string; turnEnds: number }>();
  /** Spell state (all per fight; nothing here outlives the combat). */
  /** Shocking Grasp: creature that cannot make opportunity attacks until the start of its next turn. */
  const noOpportunity = new Set<string>();
  /** Chill Touch: creature that cannot regain hit points -> the caster whose next turn start frees it. */
  const noHealing = new Map<string, string>();
  /** Guiding Bolt: the next attack roll against this creature has advantage. */
  const guided = new Map<string, { by: string; turnEnds: number }>();
  /** Bless (+1d4) and Bane (-1d4) on attack rolls and saving throws. */
  const rollMods = new Map<string, { bless: boolean; bane: boolean }>();
  // A potion of Bless or Heroism drunk before the fight.
  for (const c of all) if (hasFlag(c, 'blessed')) rollMods.set(c.id, { bless: true, bane: false });
  /** Concentration: caster id -> what to undo when it ends. The visible state is the hidden `_concentration` pool. */
  const conc = new Map<string, { name: string; onEnd: () => void }>();
  const lastDamageType = new Map<string, DamageType>();
  /** Resistance cantrip on a creature: the type it reduces and the turn it last did so. */
  const resistSpell = new Map<string, { type: DamageType; lastKey: string }>();
  const shielded = new Set<string>();
  const commanded = new Set<string>();
  /** Sleep: creature id -> caster, DC and stage (1 incapacitated, 2 unconscious). */
  const sleepers = new Map<string, { by: string; dc: number; stage: 1 | 2 }>();
  const savageUsed = new Map<string, string>();
  /** Two-weapon fighting: creatures that made a main-hand Light attack this turn / their off-hand attack. */
  const lightMain = new Set<string>();
  const offhandDone = new Set<string>();
  const turnKey = (): string => `${round}:${turn.creatureId}`;
  /** Extra Attack: the active creature's Attack action. `left` attacks remain after the action was used. */
  const atk = { open: false, left: 0, loadingUsed: false };
  /** Thrown weapons used this turn, per item id (a weapon thrown once needs another to throw again). */
  const thrownThisTurn = new Map<string, number>();
  const surgeUsed = new Set<string>();
  /** Studied Attacks (Fighter 13): attacker id -> creature it missed and has advantage against, in its own turn ends. */
  const studied = new Map<string, { targetId: string; turnEnds: number }>();
  /** Tactical Shift / Remarkable Athlete: cells of free (non-provoking) movement left this turn, per creature. */
  const shift = new Map<string, number>();
  /** Peerless Aim (Boon of Combat Prowess), Sneak Attack and Cleave: turn key of the last use, per creature. */
  const peerlessUsed = new Map<string, string>();
  const sneakUsed = new Map<string, string>();
  const cleaveUsed = new Map<string, string>();
  /** HOUSE RULE: the attack made straight after a Blink Dog teleport counts as made from hiding (advantage). */
  const blinkAdv = new Set<string>();
  /** Death Ward: the first time the creature would drop to 0 HP it drops to 1 instead. */
  const deathWard = new Set<string>();
  /** Spirit Guardians: caster id -> the emanation (radius in cells, save DC, damage) that follows them. */
  const auras = new Map<string, { radius: number; dc: number; dice: string; type: DamageType }>();
  let lastAttackMode: RollMode = 'normal';
  const speedOf = (c: Creature): number => Math.max(0, effectiveSpeed(c) - (slowed.get(c.id)?.cells ?? 0));
  let events: GameEvent[] = [];

  const emit = (e: GameEvent): void => {
    events.push(e);
  };
  const log = (text: string): void => emit({ type: 'log', text });
  /** A named feature or reaction took effect (structured companion of a log line; see GameEvent 'feature'). */
  const feature = (c: Creature, id: string, label: string, extra: { targetId?: string; amount?: number } = {}): void => {
    const e: GameEvent = { type: 'feature', creatureId: c.id, id, label };
    if (extra.targetId !== undefined) e.targetId = extra.targetId;
    if (extra.amount !== undefined) e.amount = extra.amount;
    emit(e);
  };

  const active = (): Creature => byId.get(turn.creatureId) as Creature;
  const occupiedBy = (p: GridPos, exceptId?: string): Creature | undefined =>
    all.find((c) => isAlive(c) && c.id !== exceptId && c.pos.x === p.x && c.pos.y === p.y);

  // ------------------------------------------------------------------ rolls

  function rollD20(mode: RollMode): { d20: number; dice: number[] } {
    const a = rng.die(20);
    if (mode === 'normal') return { d20: a, dice: [a] };
    const b = rng.die(20);
    return { d20: mode === 'advantage' ? Math.max(a, b) : Math.min(a, b), dice: [a, b] };
  }

  function hostileAdjacent(c: Creature): boolean {
    return all.some((o) => isAlive(o) && areHostile(c, o) && !isIncapacitated(o) && chebyshev(c.pos, o.pos) <= 1);
  }

  function packTacticsActive(att: Creature, tgt: Creature): boolean {
    if (!att.traits.includes('packTactics')) return false;
    return all.some(
      (o) =>
        o !== att &&
        isAlive(o) &&
        isFriendlySide(o) === isFriendlySide(att) &&
        !isIncapacitated(o) &&
        chebyshev(o.pos, tgt.pos) <= 1,
    );
  }

  function attackSetup(att: Creature, tgt: Creature, a: ActionDef): AttackSetup {
    const t = a.targeting;
    const melee = t.kind === 'creature' && t.melee;
    const d = chebyshev(att.pos, tgt.pos);
    const cm = attackModeFromConditions(att, tgt, d <= 1);
    let adv = cm.adv;
    let dis = cm.dis;
    let bonus = a.attack?.bonus ?? 0;
    if (t.kind === 'creature' && !melee) {
      if (hostileAdjacent(att)) dis = true;
      if (t.longRange !== undefined && d > t.range) dis = true;
      bonus += elevationAttackBonus(nav, att.pos, tgt.pos);
    }
    if (packTacticsActive(att, tgt)) adv = true;
    // Experiment (2014 optional rule, not in SRD 5.2.1): flanking gives a melee attacker advantage.
    if (TERRAIN_TUNING.flanking && melee && d <= 1) {
      const ox = 2 * tgt.pos.x - att.pos.x;
      const oy = 2 * tgt.pos.y - att.pos.y;
      if (all.some((o) => o !== att && isAlive(o) && !isIncapacitated(o) && isFriendlySide(o) === isFriendlySide(att) && o.pos.x === ox && o.pos.y === oy)) adv = true;
    }
    if (vexed.get(att.id)?.targetId === tgt.id) adv = true;
    if (studied.get(att.id)?.targetId === tgt.id) adv = true;
    if (blinkAdv.has(att.id)) adv = true;
    if (ambush.has(att.id)) adv = true;
    if (sapped.has(att.id)) dis = true;
    if (guided.has(tgt.id)) adv = true;
    // Elusive (Blink Dog 18): no attack roll has advantage against it while it can act.
    if (hasFlag(tgt, 'elusive') && !isIncapacitated(tgt)) adv = false;
    // SRD Heavy property: disadvantage when the hero lacks the Strength (melee) or Dexterity (ranged) for the weapon.
    if (a.effects?.includes('heavyDisadvantage')) dis = true;
    // Improved and Superior Critical cover weapon attacks, not spell attacks.
    const spellOnly = isSpellAction(a) && !a.effects?.includes('weaponAttack');
    let critMin = spellOnly ? 20 : hasFlag(att, 'crit18') ? 18 : hasFlag(att, 'crit19') ? 19 : 20;
    // Item passive critRange on the weapon (a Vicious or Keen weapon): crits on `from` or higher.
    const cr = a.effects?.find((e) => e.startsWith('crit:'));
    if (cr) critMin = Math.min(critMin, parseInt(cr.slice(5), 10));
    // Cloak of Displacement: attack rolls against the wearer have disadvantage until it is hit.
    if (displaced.has(tgt.id) && !isIncapacitated(tgt)) dis = true;
    // Potions of Blur and of Protection: attack rolls against the drinker have disadvantage (for Protection, by the warded creature types).
    if (hasFlag(tgt, 'blur') && !isIncapacitated(tgt)) dis = true;
    const attType = MONSTERS.find((m) => m.id === att.defId)?.type;
    if (attType && hasFlag(tgt, `ward_${attType}`)) dis = true;
    // Spellguard Shield: spell attack rolls against the bearer have disadvantage.
    if (hasFlag(tgt, 'spellWard') && isMagical(a) && !a.effects?.includes('weaponAttack')) dis = true;
    // SRD cover: +2 (half) or +5 (three-quarters) to the target's AC against ranged and reach attacks; another creature
    // standing between the two gives half cover. Adjacent targets have none.
    const cover = t.kind === 'creature' ? coverBonusFor(nav, all, att.pos, tgt.pos) : 0;
    return { bonus, mode: mergeMode(adv, dis), critMin, cover };
  }

  /** Equiprobable outcomes of the Bless/Bane dice on a creature's d20 tests ([0] without either). */
  function modOutcomes(c: Creature): number[] {
    const m = rollMods.get(c.id);
    let outs = [0];
    if (m?.bless) outs = outs.flatMap((o) => [1, 2, 3, 4].map((k) => o + k));
    if (m?.bane) outs = outs.flatMap((o) => [1, 2, 3, 4].map((k) => o - k));
    return outs;
  }

  function rollMod(c: Creature): number {
    const m = rollMods.get(c.id);
    let t = 0;
    if (m?.bless) t += rng.die(4);
    if (m?.bane) t -= rng.die(4);
    return t;
  }

  const canInspire = (c: Creature): boolean => (c.resources['inspiration']?.current ?? 0) > 0;

  function classify(d20: number, bonus: number, ac: number, critMin: number): AttackOutcome {
    if (d20 === 1) return 'fumble';
    if (d20 >= critMin) return 'crit';
    return d20 + bonus >= ac ? 'hit' : 'miss';
  }

  const isRangedAttack = (a: ActionDef): boolean => !!a.attack && a.targeting.kind === 'creature' && !a.targeting.melee;

  /**
   * Shields that draw ranged attacks: an ally of the target standing close enough, with such a shield, becomes the target.
   * The Arrow-Catching Shield does it as a reaction (HOUSE RULE: taken automatically, unless its bearer is below a third of
   * its hit points); the Shield of Missile Attraction's curse always does, for ranged weapon attacks only.
   */
  function interceptor(att: Creature, tgt: Creature, a: ActionDef): Creature | undefined {
    if (!isRangedAttack(a)) return undefined;
    return all.find((o) => {
      const reach = o.resources['_intercept']?.current;
      if (reach === undefined || o === tgt || o === att || !isAlive(o) || isIncapacitated(o)) return false;
      if (isFriendlySide(o) !== isFriendlySide(tgt) || chebyshev(o.pos, tgt.pos) > reach) return false;
      if (hasFlag(o, 'interceptWeaponOnly') && isMagical(a)) return false;
      if (hasFlag(o, 'interceptFree')) return true;
      return !reactionUsed.has(o.id) && o.hp * 3 >= o.maxHp;
    });
  }

  function rollAttack(att: Creature, tgt: Creature, a: ActionDef, reaction: boolean, name: string): AttackOutcome {
    const s = attackSetup(att, tgt, a);
    lastAttackMode = s.mode;
    const bonus = s.bonus + rollMod(att);
    // Arrow-Catching Shield: extra Armor Class against ranged attack rolls.
    const ac = tgt.ac + s.cover + (isRangedAttack(a) ? (tgt.resources['_rangedAc']?.current ?? 0) : 0);
    let r = rollD20(s.mode);
    let outcome = classify(r.d20, bonus, ac, s.critMin);
    if (vexed.get(att.id)?.targetId === tgt.id) vexed.delete(att.id);
    if (studied.get(att.id)?.targetId === tgt.id) studied.delete(att.id);
    blinkAdv.delete(att.id);
    if (ambush.delete(att.id)) {
      feature(att, 'ambush', 'Ambush!', { targetId: tgt.id });
      log(`${att.name} springs from hiding!`);
    }
    guided.delete(tgt.id);
    sapped.delete(att.id);
    if ((outcome === 'miss' || outcome === 'fumble') && canInspire(att)) {
      (att.resources['inspiration'] as { current: number }).current -= 1;
      log(`${att.name} spends Heroic Inspiration to reroll (was ${r.d20}).`);
      r = rollD20(s.mode);
      outcome = classify(r.d20, bonus, ac, s.critMin);
    }
    // Boon of Combat Prowess, Peerless Aim: once per turn, a miss becomes a hit.
    if ((outcome === 'miss' || outcome === 'fumble') && hasFlag(att, 'combatProwess') && peerlessUsed.get(att.id) !== turnKey()) {
      peerlessUsed.set(att.id, turnKey());
      outcome = 'hit';
      feature(att, 'peerlessAim', 'Peerless Aim', { targetId: tgt.id });
      log(`${att.name}'s Peerless Aim turns the miss into a hit.`);
    }
    if (
      outcome === 'hit' &&
      chebyshev(att.pos, tgt.pos) <= 1 &&
      (hasCondition(tgt, 'paralyzed') || hasCondition(tgt, 'unconscious'))
    ) {
      outcome = 'crit';
    }
    // Critical-hit immunity (Adamantine Armor): a critical hit against the wearer is an ordinary hit.
    if (outcome === 'crit' && hasFlag(tgt, 'critImmunity')) outcome = 'hit';
    if ((outcome === 'hit' || outcome === 'crit') && displaced.has(tgt.id)) displaced.delete(tgt.id);
    // HOUSE RULE: Shield is cast automatically as a reaction when its +5 AC would turn a hit into a miss.
    if (outcome === 'hit' && shieldReady(tgt) && r.d20 + bonus < ac + 5) {
      castShield(tgt);
      outcome = classify(r.d20, bonus, tgt.ac + s.cover, s.critMin);
    }
    emit({
      type: 'attackRoll',
      attackerId: att.id,
      targetId: tgt.id,
      actionName: name,
      d20: r.d20,
      dice: r.dice,
      mode: s.mode,
      bonus,
      total: r.d20 + bonus,
      targetAc: tgt.ac + s.cover,
      outcome,
      reaction,
    });
    return outcome;
  }

  function saveBonus(c: Creature, ability: Ability): number {
    // Item passives (Ring of Protection, Cloak of Protection...) add to every saving throw.
    return abilityMod(c.abilities[ability]) + (c.saveProficiencies.includes(ability) ? c.proficiencyBonus : 0) + (c.resources['_saveBonus']?.current ?? 0);
  }

  /** A friendly Sphinx of Wonder with a Burst of Ingenuity left, close enough (30 ft) to help `c`. */
  function burstHelper(c: Creature): { helper: Creature; bonus: number } | undefined {
    if (!isFriendlySide(c)) return undefined;
    for (const o of all) {
      const pool = o.resources['burstOfIngenuity'];
      if (!pool || pool.current <= 0 || !isAlive(o) || isIncapacitated(o) || reactionUsed.has(o.id) || !isFriendlySide(o)) continue;
      if (chebyshev(o.pos, c.pos) > 6) continue;
      return { helper: o, bonus: hasFlag(o, 'burstGreater') ? 4 : 2 };
    }
    return undefined;
  }

  /**
   * One saving throw. `opts.magical`: the effect is a spell or magical, so Magic Resistance gives advantage.
   * `opts.heavy`: the extra damage a failure costs, for Indomitable's HOUSE RULE automation.
   * Reactions that rescue a failed save, in order: a Sphinx's Burst of Ingenuity (+2, only if that makes it succeed),
   * then the Fighter's Indomitable (reroll with a bonus equal to the level, only against an effect that would take
   * the turn away or deal heavy damage).
   */
  function rollSave(c: Creature, ability: Ability, dc: number, applies?: Condition, opts: { magical?: boolean; heavy?: number; origin?: GridPos; forceDis?: boolean } = {}): boolean {
    // SRD cover: +2 / +5 to Dexterity saves against an effect with a point of origin on the other side of the cover.
    const cover = ability === 'dex' && opts.origin ? coverBonusFor(nav, all, opts.origin, c.pos) : 0;
    const bonus = saveBonus(c, ability) + cover + (autoFailsSave(c, ability) ? 0 : rollMod(c));
    if (autoFailsSave(c, ability)) {
      emit({ type: 'saveRoll', creatureId: c.id, ability, d20: 0, bonus, total: 0, dc, success: false });
      return false;
    }
    let mode = saveMode(c, ability, applies);
    if (opts.magical && hasFlag(c, 'magicResistance')) mode = mode === 'disadvantage' ? 'normal' : 'advantage';
    if (opts.forceDis) mode = mode === 'advantage' ? 'normal' : 'disadvantage';
    const r = rollD20(mode);
    let total = r.d20 + bonus;
    if (total < dc) {
      const burst = burstHelper(c);
      if (burst && total + burst.bonus >= dc) {
        (burst.helper.resources['burstOfIngenuity'] as { current: number }).current -= 1;
        reactionUsed.add(burst.helper.id);
        total += burst.bonus;
        feature(burst.helper, 'burstOfIngenuity', 'Burst of Ingenuity', { targetId: c.id, amount: burst.bonus });
        log(`${burst.helper.name}'s Burst of Ingenuity adds ${burst.bonus} to ${c.name}'s save.`);
      }
    }
    const first = total >= dc;
    emit({ type: 'saveRoll', creatureId: c.id, ability, d20: r.d20, bonus: total - r.d20, total, dc, success: first });
    if (first) return true;
    const ind = c.resources['indomitable'];
    const dangerous = (applies !== undefined && TURN_LOSING.includes(applies)) || (opts.heavy ?? 0) >= Math.max(12, c.maxHp * 0.2);
    if (ind && ind.current > 0 && dangerous) {
      ind.current -= 1;
      const again = rollD20(mode);
      const bonus2 = bonus + c.level;
      const total2 = again.d20 + bonus2;
      const ok = total2 >= dc;
      feature(c, 'indomitable', 'Indomitable', { amount: c.level });
      log(`${c.name} is Indomitable: rerolls the save with +${c.level}.`);
      emit({ type: 'saveRoll', creatureId: c.id, ability, d20: again.d20, bonus: bonus2, total: total2, dc, success: ok });
      return ok;
    }
    return false;
  }

  const isMagical = (a: ActionDef): boolean => a.effects?.includes('spell') === true || a.effects?.includes('magic') === true;
  /** The save options for an action: magic for Magic Resistance, expected failure cost for Indomitable. */
  function saveOpts(a: ActionDef, origin?: GridPos): { magical: boolean; heavy: number; origin?: GridPos } {
    const avg = (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
    return { magical: isMagical(a), heavy: a.save?.halfOnSave ? avg / 2 : avg, ...(origin ? { origin } : {}) };
  }

  // ------------------------------------------------------- damage and healing

  function dealDamage(target: Creature, raw: number, type: DamageType, sourceId: string | undefined, crit: boolean): void {
    if (!isAlive(target)) return;
    let amount = raw;
    // Resistance cantrip: once per turn, reduce damage of the chosen type by 1d4.
    const rs = resistSpell.get(target.id);
    if (rs && rs.type === type && amount > 0 && rs.lastKey !== turnKey()) {
      const cut = rollDice(rng, '1d4').total;
      rs.lastKey = turnKey();
      amount = Math.max(0, amount - cut);
      log(`${target.name}'s Resistance absorbs ${Math.min(cut, raw)} ${type} damage.`);
    }
    let modifier: 'none' | 'resisted' | 'vulnerable' | 'immune' = 'none';
    if (target.immunities.includes(type)) {
      amount = 0;
      modifier = 'immune';
    } else {
      if (target.resistances.includes(type)) {
        amount = Math.floor(amount / 2);
        modifier = 'resisted';
      }
      if (target.vulnerabilities.includes(type)) {
        amount *= 2;
        modifier = modifier === 'resisted' ? 'none' : 'vulnerable';
      }
    }
    let rest = amount;
    if (target.tempHp > 0) {
      const absorbed = Math.min(target.tempHp, rest);
      target.tempHp -= absorbed;
      rest -= absorbed;
    }
    target.hp = Math.max(0, target.hp - rest);
    let survived = false;
    if (target.hp === 0 && amount > 0 && target.traits.includes('undeadFortitude') && !crit && type !== 'radiant') {
      log(`${target.name}'s Undead Fortitude triggers.`);
      if (rollSave(target, 'con', 5 + amount)) {
        target.hp = 1;
        survived = true;
        log(`${target.name} refuses to fall!`);
      }
    }
    if (target.hp === 0 && !survived && deathWard.has(target.id)) {
      deathWard.delete(target.id);
      delete target.resources['_deathWard'];
      target.hp = 1;
      survived = true;
      log(`Death Ward! ${target.name} drops to 1 HP instead and the ward ends.`);
    }
    // HOUSE RULE "Last Stand": once per floor the hero drops to 1 HP instead of 0 (replaces death saves).
    let lastStand = false;
    const ls = target.resources['lastStand'];
    if (target.hp === 0 && !survived && target.faction === 'player' && ls && ls.current > 0) {
      ls.current -= 1;
      target.hp = 1;
      lastStand = true;
    }
    const e: GameEvent = { type: 'damage', targetId: target.id, amount, damageType: type, modifier, crit, hpAfter: target.hp };
    if (sourceId !== undefined) e.sourceId = sourceId;
    emit(e);
    if (lastStand) {
      feature(target, 'lastStand', 'Last Stand');
      log(`Last Stand! ${target.name} clings on at 1 HP.`);
    }
    if (amount > 0) lastDamageType.set(target.id, type);
    if (target.hp === 0 && !survived) {
      target.dead = true;
      emit({ type: 'death', creatureId: target.id });
      if (target.faction === 'ally') log(`${target.name} is down — it will be back after the fight.`);
      endConcentration(target, 'dead');
      return;
    }
    if (amount > 0) {
      wakeSleeper(target);
      // Concentration: a Constitution save, DC 10 or half the damage taken, whichever is higher.
      if (conc.has(target.id) && !rollSave(target, 'con', Math.max(10, Math.floor(amount / 2)))) {
        endConcentration(target, 'failed the save');
      }
    }
  }

  function heal(target: Creature, dice: string): void {
    if (!isAlive(target)) return;
    if (noHealing.has(target.id)) {
      log(`${target.name} cannot regain hit points (Chill Touch).`);
      return;
    }
    const amount = Math.min(rollDice(rng, dice).total, target.maxHp - target.hp);
    target.hp += amount;
    emit({ type: 'heal', targetId: target.id, amount, hpAfter: target.hp });
  }

  function addCondition(target: Creature, a: NonNullable<ActionDef['applies']>, source: Creature): void {
    if (!isAlive(target) || target.conditionImmunities.includes(a.condition)) return;
    let rounds: number | null = a.rounds ?? null;
    // `rounds` counts the source's own following turns: applied during its own turn, the current one does not count.
    if (rounds !== null && source.id === turn.creatureId && source.id !== target.id) rounds += 1;
    target.conditions = target.conditions.filter((x) => x.condition !== a.condition);
    target.conditions.push(makeCondition(a.condition, rounds, source.id, a.saveEnds));
    emit({ type: 'conditionAdded', creatureId: target.id, condition: a.condition });
    if (INCAPACITATING.includes(a.condition)) endConcentration(target, 'incapacitated');
  }

  function removeCondition(target: Creature, cond: ActiveCondition): void {
    const i = target.conditions.indexOf(cond);
    if (i < 0) return;
    target.conditions.splice(i, 1);
    emit({ type: 'conditionRemoved', creatureId: target.id, condition: cond.condition });
    const sl = sleepers.get(target.id);
    if (sl && cond.sourceId === sl.by && (cond.condition === 'incapacitated' || cond.condition === 'unconscious')) sleepers.delete(target.id);
  }

  const isWeaponAttack = (a: ActionDef): boolean =>
    a.id.startsWith('atk_') || a.id.startsWith('throw_') || a.id.startsWith('offhand_') || a.id === 'unarmed' || a.effects?.includes('weaponAttack') === true;

  function rollParts(a: ActionDef, crit: boolean, att?: Creature, typeOverride?: DamageType): { type: DamageType; amount: number }[] {
    const minDie = a.effects?.includes('greatWeaponFighting') ? 3 : undefined;
    const roll = (dice: string): number => rollDice(rng, dice, { crit, ...(minDie !== undefined ? { minDie } : {}) }).total;
    // Savage Attacker: once per turn, roll a weapon's damage dice twice and keep the higher roll.
    const savage = att !== undefined && hasFlag(att, 'savageAttacker') && isWeaponAttack(a) && savageUsed.get(att.id) !== turnKey();
    return (a.damage ?? []).map((p, i) => {
      let amount = roll(p.dice);
      if (savage && i === 0 && att) {
        const second = roll(p.dice);
        if (second > amount) feature(att, 'savageAttacker', 'Savage Attacker', { amount: second });
        amount = Math.max(amount, second);
        savageUsed.set(att.id, turnKey());
      }
      return { type: i === 0 && typeOverride ? typeOverride : p.type, amount };
    });
  }

  // ------------------------------------------------------------- concentration

  function beginConcentration(c: Creature, a: ActionDef, name: string, onEnd: () => void): void {
    endConcentration(c, 'replaced');
    const rounds = parseInt(fxVal(a, 'concentration') ?? '10', 10);
    conc.set(c.id, { name, onEnd });
    c.resources['_concentration'] = { name, current: rounds, max: 0, refresh: 'longRest' };
    feature(c, 'concentrationStart', 'Concentrating', {});
    log(`${c.name} begins concentrating on ${name}.`);
  }

  function endConcentration(c: Creature, why?: string): void {
    const l = conc.get(c.id);
    if (!l) return;
    conc.delete(c.id);
    delete c.resources['_concentration'];
    l.onEnd();
    feature(c, 'concentrationEnd', 'Concentration ends', {});
    log(`${c.name}'s concentration on ${l.name} ends${why ? ` (${why})` : ''}.`);
  }

  // -------------------------------------------------------------------- spells

  function shieldReady(t: Creature): boolean {
    const a = t.actions.find((x) => x.effects?.includes('shield'));
    if (!a?.uses || !isAlive(t) || isIncapacitated(t) || reactionUsed.has(t.id) || shielded.has(t.id)) return false;
    return (t.resources[a.uses.resource]?.current ?? 0) >= a.uses.amount;
  }

  function castShield(t: Creature): void {
    const a = t.actions.find((x) => x.effects?.includes('shield')) as ActionDef;
    const uses = a.uses as NonNullable<ActionDef['uses']>;
    (t.resources[uses.resource] as { current: number }).current -= uses.amount;
    reactionUsed.add(t.id);
    shielded.add(t.id);
    t.ac += 5;
    feature(t, 'shield', 'Shield', { amount: 5 });
    log(`${t.name} casts Shield! (+5 AC until the start of their next turn)`);
  }

  function wakeSleeper(t: Creature): void {
    const sl = sleepers.get(t.id);
    if (!sl) return;
    for (const cond of t.conditions.filter((x) => x.sourceId === sl.by && (x.condition === 'incapacitated' || x.condition === 'unconscious'))) removeCondition(t, cond);
    sleepers.delete(t.id);
    log(`${t.name} wakes up.`);
  }

  function nearestHostiles(att: Creature, a: ActionDef, except: Creature[], max: number): Creature[] {
    return targetsFor(att, a)
      .map((id) => byId.get(id) as Creature)
      .filter((o) => !except.includes(o))
      .sort((x, y) => chebyshev(att.pos, x.pos) - chebyshev(att.pos, y.pos))
      .slice(0, max);
  }

  function castMagicMissile(att: Creature, a: ActionDef, tgt: Creature): void {
    const dice = a.damage?.[0] ?? { dice: '1d4+1', type: 'force' as DamageType };
    let target = tgt;
    for (let dart = 0; dart < 3; dart++) {
      if (!isAlive(target)) {
        // All remaining darts go to the nearest other enemy in range.
        const next = nearestHostiles(att, a, [], 1)[0];
        if (!next) return;
        target = next;
      }
      dealDamage(target, rollDice(rng, dice.dice).total, dice.type, att.id, false);
    }
  }

  function castBane(att: Creature, a: ActionDef, tgt: Creature): void {
    const save = a.save as NonNullable<ActionDef['save']>;
    const targets = [tgt, ...nearestHostiles(att, a, [tgt], 2)];
    const hit: Creature[] = [];
    beginConcentration(att, a, a.name, () => {
      for (const t of hit) {
        const m = rollMods.get(t.id);
        if (m) m.bane = false;
      }
    });
    for (const t of targets) {
      if (rollSave(t, save.ability, save.dc)) continue;
      const m = rollMods.get(t.id) ?? { bless: false, bane: false };
      m.bane = true;
      rollMods.set(t.id, m);
      hit.push(t);
      log(`${t.name} is baned: -1d4 on attack rolls and saving throws.`);
    }
  }

  function castCommand(att: Creature, a: ActionDef, tgt: Creature): void {
    const save = a.save as NonNullable<ActionDef['save']>;
    if (rollSave(tgt, save.ability, save.dc)) return;
    commanded.add(tgt.id);
    log(`${tgt.name} is commanded: Grovel!`);
  }

  function castSleep(att: Creature, a: ActionDef, targets: Creature[]): void {
    const save = a.save as NonNullable<ActionDef['save']>;
    const slept: Creature[] = [];
    beginConcentration(att, a, a.name, () => {
      for (const t of slept) if (sleepers.get(t.id)?.by === att.id) wakeSleeper(t);
    });
    for (const t of targets) {
      const type = MONSTERS.find((m) => m.id === t.defId)?.type;
      // Creatures that cannot be put to sleep (undead and constructs are immune to Exhaustion) pass automatically.
      if (type === 'undead' || type === 'construct' || t.conditionImmunities.includes('unconscious')) continue;
      if (rollSave(t, save.ability, save.dc)) continue;
      addCondition(t, { condition: 'incapacitated' }, att);
      sleepers.set(t.id, { by: att.id, dc: save.dc, stage: 1 });
      slept.push(t);
    }
  }

  /** Buff and utility spells on one creature (the caster or a friend). Returns true if the action was one. */
  /**
   * A timed consumable (a potion of heroism, of flying...) used in the fight: its passives apply from now on, to the hero's own numbers
   * and flags. (Ability-score passives take effect when the effect is carried into the next fight by `syncFromCreature`.)
   */
  function applyTimedUse(c: Creature, itemId: string): void {
    const def = getItem(itemId);
    if (!def?.consumable || def.consumable.effect !== 'timed') return;
    log(`${c.name} uses ${def.name}.`);
    c.resources[`_used_${itemId}`] = { name: 'used', current: 1, max: 0, refresh: 'longRest' };
    const flag = (name: string): void => {
      c.resources[`_${name}`] = { name, current: 1, max: 0, refresh: 'longRest' };
    };
    for (const p of def.consumable.passives) {
      if (p.type === 'acBonus') c.ac += p.amount;
      else if (p.type === 'saveBonus') c.resources['_saveBonus'] = { name: 'Save bonus', current: (c.resources['_saveBonus']?.current ?? 0) + p.amount, max: 0, refresh: 'longRest' };
      else if (p.type === 'resistance' && !c.resistances.includes(p.damageType)) c.resistances.push(p.damageType);
      else if (p.type === 'immunity' && !c.immunities.includes(p.damageType)) c.immunities.push(p.damageType);
      else if (p.type === 'conditionImmunity' && !c.conditionImmunities.includes(p.condition)) c.conditionImmunities.push(p.condition);
      else if (p.type === 'speedBonus') {
        c.speed += p.cells;
        if (turn.creatureId === c.id) turn.movementLeft += p.cells;
      } else if (p.type === 'critImmunity') flag('critImmunity');
      else if (p.type === 'displacement') {
        flag('displacement');
        displaced.add(c.id);
      } else if (p.type === 'ignoreHazard') flag(`ignore_${p.hazard}`);
      else if (p.type === 'bless') {
        flag('blessed');
        rollMods.set(c.id, { ...(rollMods.get(c.id) ?? { bless: false, bane: false }), bless: true });
      } else if (p.type === 'tempHp') c.tempHp = Math.max(c.tempHp, p.amount);
      else if (p.type === 'attackersDisadvantage') flag('blur');
      else if (p.type === 'wardVersus') for (const t of p.versus) flag(`ward_${t}`);
      else if (p.type === 'maxHpBonus') {
        const n = (p.flat ?? 0) + (p.perLevel ?? 0) * (c.level ?? 0);
        c.maxHp += n;
        c.hp += n;
      } else if (p.type === 'regeneration') c.resources['_regen'] = { name: 'Regeneration', current: p.amount, max: 0, refresh: 'longRest' };
      else if (p.type === 'flight') {
        flag('hover');
        flag('ignore_fall');
        flag('ignore_lava');
      }
    }
    if (def.consumable.hover) {
      flag('hover');
      flag('ignore_fall');
      flag('ignore_lava');
    }
  }

  function applyBuffSpell(att: Creature, a: ActionDef, tgt: Creature): boolean {
    const fx = a.effects ?? [];
    if (fx.includes('bless')) {
      beginConcentration(att, a, a.name, () => {
        const m = rollMods.get(tgt.id);
        if (m) m.bless = false;
      });
      const m = rollMods.get(tgt.id) ?? { bless: false, bane: false };
      m.bless = true;
      rollMods.set(tgt.id, m);
      return true;
    }
    if (fx.includes('shieldOfFaith')) {
      beginConcentration(att, a, a.name, () => {
        tgt.ac -= 2;
      });
      tgt.ac += 2;
      return true;
    }
    if (fx.includes('aid')) {
      // HOUSE RULE: Aid lasts the fight (it is 8 hours in the SRD, but no state outlives a combat here). Up to three allies in 30 ft.
      const group = all
        .filter((o) => isAlive(o) && isFriendlySide(o) === isFriendlySide(att) && chebyshev(o.pos, att.pos) <= 6)
        .sort((x, y) => (x.id === tgt.id ? -1 : 0) - (y.id === tgt.id ? -1 : 0) || x.hp / x.maxHp - y.hp / y.maxHp)
        .slice(0, 3);
      for (const o of group) {
        o.maxHp += 5;
        o.hp += 5;
        o.resources['_aid'] = { name: 'Aid', current: (o.resources['_aid']?.current ?? 0) + 5, max: 0, refresh: 'longRest' };
      }
      log(`${att.name} casts Aid: ${group.map((o) => o.name).join(', ')} gain 5 maximum hit points.`);
      return true;
    }
    if (fx.includes('deathWard')) {
      deathWard.add(tgt.id);
      tgt.resources['_deathWard'] = { name: 'Death Ward', current: 1, max: 0, refresh: 'longRest' };
      log(`${tgt.name} is warded against death.`);
      return true;
    }
    if (fx.includes('resistanceCantrip')) {
      const type = pickResistanceType(tgt);
      beginConcentration(att, a, a.name, () => {
        resistSpell.delete(tgt.id);
      });
      resistSpell.set(tgt.id, { type, lastKey: '' });
      log(`${tgt.name} is warded against ${type} damage.`);
      return true;
    }
    if (fx.includes('falseLife')) {
      const t = rollDice(rng, fxVal(a, 'tempHp') ?? '2d4+4').total;
      tgt.tempHp = Math.max(tgt.tempHp, t);
      log(`${tgt.name} gains ${tgt.tempHp} temporary hit points.`);
      return true;
    }
    if (fx.includes('mageArmor')) {
      tgt.ac = Math.max(tgt.ac, parseInt(fxVal(a, 'armorAc') ?? '0', 10));
      tgt.resources['_mageArmor'] = { name: 'Mage Armor', current: 1, max: 0, refresh: 'longRest' };
      log(`${tgt.name} is shrouded in Mage Armor.`);
      return true;
    }
    return false;
  }

  /**
   * Resistance picks its damage type automatically: the type of the last damage
   * the target took this fight, else the type its enemies deal the most of,
   * else slashing.
   */
  function pickResistanceType(tgt: Creature): DamageType {
    const last = lastDamageType.get(tgt.id);
    if (last) return last;
    const totals = new Map<DamageType, number>();
    for (const o of all) {
      if (!isAlive(o) || !areHostile(tgt, o)) continue;
      for (const act of o.actions) for (const p of act.damage ?? []) totals.set(p.type, (totals.get(p.type) ?? 0) + averageDice(p.dice));
    }
    let best: DamageType = 'slashing';
    let bestV = 0;
    for (const [t, v] of totals) {
      if (v > bestV) {
        best = t;
        bestV = v;
      }
    }
    return best;
  }

  function iceKnifeBurst(att: Creature, a: ActionDef, tgt: Creature): void {
    const dc = parseInt(fxVal(a, 'burstDc') ?? '10', 10);
    const dice = fxVal(a, 'burstDice') ?? '2d6';
    const cells = computeAreaCells(nav, att.pos, tgt.pos, 1, { shape: 'sphere', size: 1 });
    const hit = all.filter((o) => isAlive(o) && cells.some((p) => p.x === o.pos.x && p.y === o.pos.y));
    const dmg = rollDice(rng, dice).total;
    for (const t of hit) {
      if (!rollSave(t, 'dex', dc)) dealDamage(t, dmg, 'cold', att.id, false);
    }
  }

  // ------------------------------------------------------- action resolution

  /** Resolve one action against one target (not area, not multiattack). */
  /**
   * Forced movement (Shove, Push mastery, Thunderwave): up to `cells` cells in direction (dx, dy). It never provokes
   * opportunity attacks (it does not go through `doMove`). It stops at walls and creatures but NOT at a drop or lava:
   * a creature forced into one takes 1d6 per floor depth and climbs out prone (see `enterHazard`). Ice carries a
   * pushed creature one cell further. Returns true when the creature moved at all.
   */
  function forcedMove(tgt: Creature, source: Creature | undefined, dx: number, dy: number, cells: number): boolean {
    if (!isAlive(tgt)) return false;
    const origin = { x: tgt.pos.x, y: tgt.pos.y };
    const ignore = new Set(Object.keys(tgt.resources).filter((k) => k.startsWith('_ignore_')).map((k) => k.slice('_ignore_'.length)));
    const plan = planPush(nav, (p) => occupiedBy(p, tgt.id) !== undefined, origin, dx, dy, cells, { ignore });
    if (plan.path.length === 0 && !plan.obstacle) return false;
    if (plan.path.length > 0) {
      const last = plan.path[plan.path.length - 1] as GridPos;
      tgt.pos = { x: last.x, y: last.y };
      emit({ type: 'move', creatureId: tgt.id, path: plan.path.map((p) => ({ x: p.x, y: p.y })) });
    }
    if (plan.hazard) {
      enterHazard(tgt, source, plan.hazard.kind, plan.hazard.at, origin);
      return true;
    }
    // HOUSE RULE: a creature forced into shallow water is knocked Prone.
    if (plan.water && isAlive(tgt) && !hasCondition(tgt, 'prone')) {
      tgt.conditions.push(makeCondition('prone', null, source?.id));
      emit({ type: 'conditionAdded', creatureId: tgt.id, condition: 'prone' });
    }
    if (plan.obstacle) {
      slam(tgt, source, plan.obstacle.kind);
      return true;
    }
    log(plan.slid ? `${tgt.name} slides across the ice.` : plan.water ? `${tgt.name} is pushed into the water and falls.` : `${tgt.name} is pushed back.`);
    return true;
  }

  /**
   * HOUSE RULE: a creature pushed against fire or spikes stops short and is slammed: 1d6 per TWO floor depths (minimum
   * 1d6), fire or piercing. Events: a `feature` 'slam' (amount = the damage) and then the `damage` event. No rider.
   */
  function slam(tgt: Creature, source: Creature | undefined, kind: 'fire' | 'spikes'): void {
    const dice = slamDice(depth);
    const amount = rollDice(rng, `${dice}d6`).total;
    feature(tgt, 'slam', 'Slammed!', { amount, ...(source ? { targetId: source.id } : {}) });
    log(kind === 'fire' ? `${tgt.name} is slammed into the flames!` : `${tgt.name} is slammed onto the spikes!`);
    dealDamage(tgt, amount, kind === 'fire' ? 'fire' : 'piercing', source?.id, false);
  }

  /**
   * HOUSE RULE (owner's decision): a creature forced into a pit ('fall', bludgeoning) or lava (fire) takes 1d6 per
   * floor depth, then climbs out onto the nearest free walkable cell to where it went in (ties: the cell it was
   * pushed from) and is Prone. If the damage kills it, it is gone. Events: `hazard`, `damage`, `conditionAdded`
   * prone, then a `move` whose path is the single cell it climbs out onto. Flying creatures are not exempt
   * (the data has no fly flag yet).
   */
  function enterHazard(tgt: Creature, source: Creature | undefined, kind: 'fall' | 'lava', at: GridPos, origin: GridPos): void {
    const h: GameEvent = { type: 'hazard', creatureId: tgt.id, hazard: kind, at: { x: at.x, y: at.y } };
    if (source) h.sourceId = source.id;
    emit(h);
    log(kind === 'fall' ? `${tgt.name} plunges into the chasm!` : `${tgt.name} is thrown into the lava!`);
    const def = MONSTERS.find((m) => m.id === tgt.defId);
    const minion = tgt.faction === 'enemy' && (def?.role === 'minion' || tgt.level < depth / 4);
    const amount = TERRAIN_TUNING.minionsDieInFall && minion ? tgt.hp + tgt.tempHp + 999 : rollDice(rng, `${fallDice(depth)}d6`).total;
    dealDamage(tgt, amount, kind === 'fall' ? 'bludgeoning' : 'fire', source?.id, false);
    if (!isAlive(tgt)) return;
    if (TERRAIN_TUNING.fallsTakeTurn) {
      // Experiment: out of the fight until the end of its next turn (prone on arrival), then it climbs out.
      tgt.conditions = tgt.conditions.filter((x) => x.condition !== 'prone');
      tgt.conditions.push(makeCondition('prone', null, source?.id));
      emit({ type: 'conditionAdded', creatureId: tgt.id, condition: 'prone' });
      pitted.set(tgt.id, { at: { x: at.x, y: at.y }, origin: { x: origin.x, y: origin.y } });
      tgt.pos = { x: -50, y: -50 };
      log(`${tgt.name} is stuck in the pit.`);
      return;
    }
    const out = climbOutCell(nav, (p) => occupiedBy(p, tgt.id) !== undefined, at, origin);
    if (!out) {
      // Nowhere to climb: it is lost.
      tgt.hp = 0;
      tgt.dead = true;
      emit({ type: 'death', creatureId: tgt.id });
      return;
    }
    tgt.conditions = tgt.conditions.filter((x) => x.condition !== 'prone');
    tgt.conditions.push(makeCondition('prone', null, source?.id));
    emit({ type: 'conditionAdded', creatureId: tgt.id, condition: 'prone' });
    tgt.pos = { x: out.x, y: out.y };
    emit({ type: 'move', creatureId: tgt.id, path: [{ x: out.x, y: out.y }] });
  }

  /** Push a Large-or-smaller target up to 10 ft straight away (Push mastery, Thunderwave). */
  function pushTarget(att: Creature, tgt: Creature): void {
    if (tgt.size === 'huge') return;
    forcedMove(tgt, att, Math.sign(tgt.pos.x - att.pos.x), Math.sign(tgt.pos.y - att.pos.y), 2);
  }

  /** The save a shoved creature makes: its better of Strength and Dexterity, against 8 + the shover's Strength modifier + proficiency. */
  function shoveSave(att: Creature, tgt: Creature): { ability: Ability; dc: number; failChance: number; help: boolean } {
    const dc = 8 + abilityMod(att.abilities.str) + att.proficiencyBonus;
    const outs = modOutcomes(tgt);
    // Experiment (TERRAIN_TUNING.shoveHelpAdvantage): with an ally of the shover next to the target, or the target Prone, the save has disadvantage.
    const help = TERRAIN_TUNING.shoveHelpAdvantage && (hasCondition(tgt, 'prone') || all.some((o) => o !== att && o !== tgt && isAlive(o) && !isIncapacitated(o) && !areHostile(att, o) && chebyshev(o.pos, tgt.pos) <= 1));
    const modeOf = (ab: Ability): RollMode => {
      const m = saveMode(tgt, ab);
      return help ? (m === 'advantage' ? 'normal' : 'disadvantage') : m;
    };
    const succeed = (ab: Ability): number =>
      autoFailsSave(tgt, ab) ? 0 : outs.reduce((t, k) => t + d20Probability(modeOf(ab), singleSaveProbability(saveBonus(tgt, ab) + k, dc)), 0) / outs.length;
    const str = succeed('str');
    const dex = succeed('dex');
    return dex > str ? { ability: 'dex', dc, failChance: 1 - dex, help } : { ability: 'str', dc, failChance: 1 - str, help };
  }

  /** Shove (SRD Unarmed Strike): the target saves (its better of STR/DEX) or is pushed 5 ft or knocked Prone. */
  function resolveShove(att: Creature, a: ActionDef, tgt: Creature): void {
    const { ability, dc, help } = shoveSave(att, tgt);
    const ok = rollSave(tgt, ability, dc, undefined, help ? { forceDis: true } : {});
    if (ok) {
      log(`${tgt.name} stands firm against the shove.`);
      return;
    }
    if (a.effects?.includes('shove:trip')) {
      addCondition(tgt, { condition: 'prone' }, att);
      log(`${att.name} knocks ${tgt.name} prone.`);
      return;
    }
    if (!forcedMove(tgt, att, Math.sign(tgt.pos.x - att.pos.x), Math.sign(tgt.pos.y - att.pos.y), 1)) log(`${tgt.name} is braced and does not budge.`);
  }

  /** Scorching Ray: three spell attacks, each 2d6 fire, on one target or split among others when it falls. */
  function castScorchingRays(att: Creature, a: ActionDef, tgt: Creature): void {
    const single: ActionDef = { ...a, effects: (a.effects ?? []).filter((e) => e !== 'scorchingRays') };
    let target = tgt;
    for (let ray = 0; ray < 3; ray++) {
      if (!isAlive(target)) {
        const next = nearestHostiles(att, a, [], 1)[0];
        if (!next) return;
        target = next;
      }
      resolveOn(att, single, target, false, `${a.name} (ray ${ray + 1})`);
    }
  }

  /** Spirit Guardians: a concentration emanation around the caster that burns enemies at the start of their turns. */
  function castSpiritGuardians(att: Creature, a: ActionDef): void {
    const save = a.save as NonNullable<ActionDef['save']>;
    const part = (a.damage as NonNullable<ActionDef['damage']>)[0] as NonNullable<ActionDef['damage']>[number];
    const size = a.targeting.kind === 'point' ? a.targeting.area.size : 3;
    beginConcentration(att, a, a.name, () => {
      auras.delete(att.id);
    });
    auras.set(att.id, { radius: size, dc: save.dc, dice: part.dice, type: part.type });
  }

  /** The damage a target takes from a save-based effect: Evasion (DEX saves) turns half into none and none into half. */
  function saveDamage(t: Creature, a: ActionDef, ok: boolean, amount: number): number {
    const half = a.save?.halfOnSave === true;
    if (half && a.save?.ability === 'dex' && hasFlag(t, 'evasion') && !isIncapacitated(t)) {
      feature(t, 'evasion', 'Evasion', { amount: ok ? amount : amount - Math.floor(amount / 2) });
      return ok ? 0 : Math.floor(amount / 2);
    }
    return ok ? (half ? Math.floor(amount / 2) : 0) : amount;
  }

  /** Whether `att` can make the Cleave attack now: a second creature next to the first and within reach. */
  function cleaveTarget(att: Creature, a: ActionDef, first: Creature): Creature | undefined {
    if (cleaveUsed.get(att.id) === turnKey()) return undefined;
    return all
      .filter((o) => isAlive(o) && o !== first && areHostile(att, o) && chebyshev(o.pos, first.pos) <= 1 && inReach(att, a, o))
      .sort((x, y) => x.hp - y.hp)[0];
  }

  /**
   * HOUSE RULE (automation of Tactical Master, Fighter 9; the SRD lets the player choose): the mastery effects an attack uses. By
   * default the SMART choice: the weapon's own property unless Push would put the target in a hazard (a drop, lava, fire or spikes, or
   * water with allies at hand) and is worth more than the own property; a Graze weapon uses Sap. A hero flagged `_tacticalAuto` (the
   * naive scripted hero) keeps the old automation (the action's own effects: Graze becomes Sap). `note` is set when the replacement
   * differs from the weapon's own property (the 'tacticalMaster' feature event).
   */
  function tacticalMaster(att: Creature, a: ActionDef, tgt: Creature): { fx: string[]; note?: string } {
    const fx = a.effects ?? [];
    const own = fx.find((e) => e.startsWith('tmOwn:'));
    if (!own || !hasFlag(att, 'tacticalMaster') || hasFlag(att, 'tacticalAuto') || att.faction !== 'player' || chebyshev(att.pos, tgt.pos) > 1) return { fx };
    const [, kind, modText] = own.split(':');
    const mod = parseInt(modText ?? '0', 10);
    const stripped = fx.filter((e) => !e.startsWith('mastery:') && !e.startsWith('tmOwn:'));
    const ownTokens = kind === 'graze' ? [`mastery:graze:${mod}`] : fx.filter((e) => e.startsWith('mastery:'));
    let pushV = 0;
    if (tgt.size !== 'huge' && isAlive(tgt)) {
      const plan = planPush(nav, (p) => occupiedBy(p, tgt.id) !== undefined, tgt.pos, Math.sign(tgt.pos.x - att.pos.x), Math.sign(tgt.pos.y - att.pos.y), 2);
      const near = all.filter((o) => o !== tgt && isAlive(o) && isFriendlySide(o) === isFriendlySide(att) && chebyshev(o.pos, tgt.pos) <= 1).length;
      pushV = pushValue(plan, depth, tgt.hp, near, (ty) => typeFactor(tgt, ty), {});
    }
    const ownValue: Record<string, number> = { push: pushV, sap: 3, slow: 2, vex: 3, topple: 4, cleave: 3, graze: 2, nick: 0 };
    if (kind !== 'push' && pushV > (ownValue[kind as string] ?? 2)) return { fx: [...stripped, 'mastery:push'], note: 'Tactical Master: Push' };
    if (kind === 'graze') return { fx: [...stripped, 'mastery:sap'], note: 'Tactical Master: Sap' };
    return { fx: [...stripped, ...ownTokens] };
  }

  function resolveOn(att: Creature, a: ActionDef, tgt: Creature, reaction = false, name: string = a.name): void {
    const fx = a.effects ?? [];
    if (fx.includes('shove')) return resolveShove(att, a, tgt);
    if (fx.includes('scorchingRays')) return castScorchingRays(att, a, tgt);
    if (fx.includes('spiritGuardians')) return castSpiritGuardians(att, a);
    if (fx.includes('magicMissile')) return castMagicMissile(att, a, tgt);
    if (fx.includes('bane')) return castBane(att, a, tgt);
    if (fx.includes('command')) return castCommand(att, a, tgt);
    const timedUse = fx.find((e) => e.startsWith('timedUse:'));
    if (timedUse) return applyTimedUse(att, timedUse.slice('timedUse:'.length));
    if (applyBuffSpell(att, a, tgt)) return;
    if (a.attack) {
      const catcher = interceptor(att, tgt, a);
      if (catcher) {
        if (!hasFlag(catcher, 'interceptFree')) reactionUsed.add(catcher.id);
        feature(catcher, 'interceptRanged', hasFlag(catcher, 'interceptFree') ? 'Missile Attraction' : 'Arrow-Catching Shield', { targetId: tgt.id });
        log(`${catcher.name}'s shield draws the shot meant for ${tgt.name}.`);
        tgt = catcher;
      }
      const outcome = rollAttack(att, tgt, a, reaction, name);
      const tm = tacticalMaster(att, a, tgt);
      const mfx = tm.fx;
      if (outcome === 'miss' || outcome === 'fumble') {
        // Studied Attacks (Fighter 13): after a miss, advantage on the next attack against that creature before the end of the next turn.
        if (hasFlag(att, 'studiedAttacks')) studied.set(att.id, { targetId: tgt.id, turnEnds: att.id === turn.creatureId ? 2 : 1 });
        // Weapon Mastery: Graze deals the ability modifier on a miss.
        const graze = mfx.find((e) => e.startsWith('mastery:graze:'));
        const first = a.damage?.[0];
        if (graze && first) {
          const mod = parseInt(graze.slice('mastery:graze:'.length), 10);
          if (mod > 0) dealDamage(tgt, mod, first.type, att.id, false);
        }
        if (fx.includes('iceKnifeBurst')) iceKnifeBurst(att, a, tgt);
        return;
      }
      const crit = outcome === 'crit';
      let dealt = 0;
      const orb = fx.includes('chromaticOrbChoice') ? chromaticOrbType(tgt) : undefined;
      if (orb) log(`${att.name} shapes a ${orb} orb.`);
      // Uncanny Dodge (reaction): the target halves the damage of one attack it can see.
      const dodge = hasFlag(tgt, 'uncannyDodge') && isAlive(tgt) && !isIncapacitated(tgt) && !reactionUsed.has(tgt.id);
      if (dodge) {
        reactionUsed.add(tgt.id);
        feature(tgt, 'uncannyDodge', 'Uncanny Dodge', { targetId: att.id });
        log(`${tgt.name} uses Uncanny Dodge and halves the damage.`);
      }
      const parts = rollParts(a, crit, att, orb);
      // Item passives: dice against some creature types (slaying weapons) and extra dice on a critical hit.
      const targetType = MONSTERS.find((m) => m.id === tgt.defId)?.type;
      for (const e of fx) {
        if (e.startsWith('bane:')) {
          const [, dice, type, types] = e.split(':');
          if (targetType && (types as string).split('/').includes(targetType)) parts.push({ type: type as DamageType, amount: rollDice(rng, dice as string, { crit }).total });
        } else if (e.startsWith('critdmg:') && crit) {
          const [, dice, type] = e.split(':');
          parts.push({ type: type as DamageType, amount: rollDice(rng, dice as string).total });
        }
      }
      // Shield of Missile Attraction: half damage from ranged weapon attacks.
      const deflect = hasFlag(tgt, 'rangedResist') && isRangedAttack(a) && !isMagical(a);
      for (const part of parts) {
        if (deflect) part.amount = Math.floor(part.amount / 2);
        dealDamage(tgt, dodge ? Math.floor(part.amount / 2) : part.amount, part.type, att.id, crit);
        dealt += part.amount;
      }
      // Sneak Attack (Blink Dog, rogue rule): once per turn, extra d6s when the attack has advantage, or when an ally of the
      // attacker is within 5 ft of the target and the roll does not have disadvantage.
      const sneak = att.resources['_sneakAttack'];
      if (sneak && sneak.current > 0 && isAlive(tgt) && a.attack && !a.effects?.includes('spell') && sneakUsed.get(att.id) !== turnKey()) {
        const allyNear = all.some((o) => o !== att && isAlive(o) && isFriendlySide(o) === isFriendlySide(att) && !isIncapacitated(o) && chebyshev(o.pos, tgt.pos) <= 1);
        if (lastAttackMode === 'advantage' || (allyNear && lastAttackMode !== 'disadvantage')) {
          sneakUsed.set(att.id, turnKey());
          const extra = rollDice(rng, `${sneak.current}d6`, { crit }).total;
          feature(att, 'sneakAttack', 'Sneak Attack', { targetId: tgt.id, amount: extra });
          log(`${att.name} lands a Sneak Attack!`);
          dealDamage(tgt, dodge ? Math.floor(extra / 2) : extra, parts[0]?.type ?? 'piercing', att.id, crit);
          dealt += extra;
        }
      }
      // Remarkable Athlete: after a critical hit, move up to half speed without provoking opportunity attacks.
      if (crit && hasFlag(att, 'remarkableAthlete') && att.id === turn.creatureId && isWeaponAttack(a)) {
        shift.set(att.id, Math.max(shift.get(att.id) ?? 0, Math.floor(speedOf(att) / 2)));
      }
      // Weapon Mastery: Cleave, once per turn on a melee hit: a second attack against another creature next to the first,
      // within reach, with the weapon's damage but no ability modifier.
      if (tm.note) feature(att, 'tacticalMaster', tm.note, { targetId: tgt.id });
      const cleave = mfx.find((e) => e.startsWith('mastery:cleave:'));
      if (cleave && a.targeting.kind === 'creature' && a.targeting.melee) {
        const second = cleaveTarget(att, a, tgt);
        if (second) {
          cleaveUsed.set(att.id, turnKey());
          const mod = parseInt(cleave.slice('mastery:cleave:'.length), 10);
          const sub: ActionDef = {
            ...a,
            damage: (a.damage ?? []).map((p, i) => (i === 0 ? { ...p, dice: withoutModifier(p.dice, mod) } : p)),
            effects: (a.effects ?? []).filter((e) => !e.startsWith('mastery:')),
          };
          feature(att, 'cleave', 'Cleave', { targetId: second.id });
          log(`${att.name} cleaves into ${second.name}.`);
          resolveOn(att, sub, second, false, `${name} (Cleave)`);
        }
      }
      // Weapon Mastery: Vex gives advantage on the next attack against this target until the end of the attacker's next turn.
      if (dealt > 0 && isAlive(tgt) && mfx.includes('mastery:vex')) {
        vexed.set(att.id, { targetId: tgt.id, turnEnds: att.id === turn.creatureId ? 2 : 1 });
      }
      // Weapon Mastery: Sap (disadvantage on its next attack), Topple (CON save or prone), Push (up to 10 ft away).
      if (isAlive(tgt) && mfx.includes('mastery:sap')) sapped.set(tgt.id, { by: att.id });
      const topple = a.effects?.find((e) => e.startsWith('mastery:topple:'));
      if (topple && isAlive(tgt)) {
        const dc = parseInt(topple.slice('mastery:topple:'.length), 10);
        if (!rollSave(tgt, 'con', dc, 'prone')) addCondition(tgt, { condition: 'prone' }, att);
      }
      if (isAlive(tgt) && mfx.includes('mastery:push')) pushTarget(att, tgt);
      // Weapon Mastery: Slow (and Ray of Frost) reduce the target's speed by 10 ft until the start of the attacker's next turn.
      if (dealt > 0 && isAlive(tgt) && (mfx.includes('mastery:slow') || fx.includes('rayOfFrostSlow'))) {
        slowed.set(tgt.id, { by: att.id, cells: Math.max(slowed.get(tgt.id)?.cells ?? 0, SLOW_CELLS) });
        log(`${tgt.name} is slowed.`);
      }
      if (isAlive(tgt) && fx.includes('shockingGraspNoReaction')) noOpportunity.add(tgt.id);
      if (isAlive(tgt) && fx.includes('chillTouchNoHealing')) noHealing.set(tgt.id, att.id);
      if (isAlive(tgt) && fx.includes('guidingBoltAdvantage')) guided.set(tgt.id, { by: att.id, turnEnds: att.id === turn.creatureId ? 2 : 1 });
      if (a.heal) heal(tgt, a.heal);
      if (fx.includes('iceKnifeBurst')) iceKnifeBurst(att, a, tgt);
      if (!isAlive(tgt)) return;
      if (a.save) {
        if (!rollSave(tgt, a.save.ability, a.save.dc, a.applies?.condition, saveOpts(a, att.pos)) && a.applies) addCondition(tgt, a.applies, att);
      } else if (a.applies) {
        addCondition(tgt, a.applies, att);
      }
      return;
    }
    if (a.save) {
      const ok = rollSave(tgt, a.save.ability, a.save.dc, a.applies?.condition, saveOpts(a, att.pos));
      for (const part of rollParts(a, false)) {
        const amount = saveDamage(tgt, a, ok, part.amount);
        if (amount > 0 || !ok) dealDamage(tgt, amount, part.type, att.id, false);
      }
      if (!ok && isAlive(tgt) && a.applies) addCondition(tgt, a.applies, att);
      return;
    }
    for (const part of rollParts(a, false)) dealDamage(tgt, part.amount, part.type, att.id, false);
    if (a.heal) heal(tgt, a.heal);
    if (a.applies) addCondition(tgt, a.applies, att);
  }

  function resolveArea(att: Creature, a: ActionDef, cells: GridPos[], origin: GridPos = att.pos): void {
    const centeredOnSelf = a.targeting.kind === 'point' && a.targeting.range === 0;
    const fx = a.effects ?? [];
    const push = fx.includes('thunderwavePush');
    let targets = all.filter(
      (o) => isAlive(o) && !(centeredOnSelf && o === att) && cells.some((p) => p.x === o.pos.x && p.y === o.pos.y),
    );
    if (fx.includes('sleep')) return castSleep(att, a, targets);
    if (fx.includes('spiritGuardians')) return castSpiritGuardians(att, a);
    // Area healing (Mass Healing Word, Mass Cure Wounds): up to six friendly creatures in the area, most hurt first.
    if (a.heal && !a.damage) {
      const friends = all
        .filter((o) => isAlive(o) && isFriendlySide(o) === isFriendlySide(att) && cells.some((p) => p.x === o.pos.x && p.y === o.pos.y))
        .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)
        .slice(0, 6);
      for (const t of friends) heal(t, a.heal);
      return;
    }
    // Farthest first, so a push is not blocked by the creature behind it.
    if (push) targets = targets.sort((x, y) => chebyshev(att.pos, y.pos) - chebyshev(att.pos, x.pos));
    const parts = rollParts(a, false);
    const opts = saveOpts(a, origin);
    for (const t of targets) {
      const ok = a.save ? rollSave(t, a.save.ability, a.save.dc, a.applies?.condition, opts) : false;
      for (const part of parts) {
        const amount = saveDamage(t, a, ok, part.amount);
        if (amount > 0 || !ok) dealDamage(t, amount, part.type, att.id, false);
      }
      if (!ok && isAlive(t) && a.applies) addCondition(t, a.applies, att);
      if (!ok && push && isAlive(t)) pushTarget(att, t);
    }
  }

  function inReach(att: Creature, a: ActionDef, tgt: Creature): boolean {
    const t = a.targeting;
    if (t.kind !== 'creature') return false;
    const d = chebyshev(att.pos, tgt.pos);
    const max = t.melee ? t.range : (t.longRange ?? t.range);
    if (d > max) return false;
    return d <= 1 || nav.hasLineOfSight(att.pos, tgt.pos);
  }

  function targetsFor(att: Creature, a: ActionDef): string[] {
    let def = a;
    if (a.multiattack) {
      const first = a.multiattack.map((id) => findAction(att, id)).find((x) => x !== undefined);
      if (!first) return [];
      def = first;
    }
    const t = def.targeting;
    if (t.kind !== 'creature') return [];
    return all
      .filter((o) => {
        if (!isAlive(o)) return false;
        const sideOk = t.friendly ? isFriendlySide(o) === isFriendlySide(att) : areHostile(att, o);
        if (isShove(def) && !canShoveSize(att.size, o.size)) return false;
        return sideOk && inReach(att, def, o);
      })
      .map((o) => o.id);
  }

  function pointLegal(att: Creature, a: ActionDef, point: GridPos | undefined): boolean {
    if (a.targeting.kind !== 'point') return false;
    if (a.targeting.range === 0) {
      // A cone or line from the caster needs a direction: any other cell.
      if (a.targeting.area.shape === 'sphere') return true;
      return !!point && nav.inBounds(point) && !(point.x === att.pos.x && point.y === att.pos.y);
    }
    if (!point || !nav.inBounds(point)) return false;
    const d = chebyshev(att.pos, point);
    return d <= a.targeting.range && (d <= 1 || nav.hasLineOfSight(att.pos, point));
  }

  /** A weapon attack that belongs to the Attack action and so draws on Extra Attack (not spells, not off-hand extras). */
  function isPoolAttack(c: Creature, a: ActionDef): boolean {
    return c.resources['_attacks'] !== undefined && a.cost === 'action' && !isSpellAction(a) && (a.id.startsWith('atk_') || a.id.startsWith('throw_') || a.id === 'unarmed' || isShove(a));
  }

  function useCheck(c: Creature, id: string): { ok: boolean; reason?: string } {
    if (!began) return { ok: false, reason: 'Combat has not begun' };
    if (over) return { ok: false, reason: 'Combat is over' };
    if (c.id !== turn.creatureId) return { ok: false, reason: 'Not your turn' };
    const a = findAction(c, id);
    if (!a) return { ok: false, reason: 'Unknown action' };
    if (isIncapacitated(c)) return { ok: false, reason: 'Incapacitated' };
    const cost = actionCost(c, a);
    if (cost === 'reaction') return { ok: false, reason: 'Reactions trigger automatically' };
    if (a.uses) {
      const pool = c.resources[a.uses.resource];
      if (!pool) return { ok: false, reason: 'No uses available' };
      if (pool.current < a.uses.amount) {
        return { ok: false, reason: a.uses.resource.startsWith('spell:') ? 'Already cast — recovers on a long rest' : `No ${pool.name} left` };
      }
    }
    if (a.recharge !== undefined && spentRecharge.get(c.id)?.has(a.id)) return { ok: false, reason: 'Recharging' };
    // Dash and Disengage mean nothing for a creature that cannot move (grappled, restrained, speed 0).
    if ((a.effects?.includes('dash') || a.effects?.includes('disengage') || a.effects?.includes('aggressive')) && speedOf(c) <= 0) return { ok: false, reason: 'You cannot move' };
    // Extra Attack: weapon attacks after the first use the same Attack action while attacks are left.
    const pool = isPoolAttack(c, a);
    const continuing = pool && atk.open && atk.left > 0;
    if (cost === 'action' && turn.actionUsed && !continuing) return { ok: false, reason: pool && atk.open ? 'No attacks left' : 'No action left' };
    if (continuing && a.effects?.includes('loading') && atk.loadingUsed) return { ok: false, reason: 'Loading: one shot per action' };
    if (a.id.startsWith('throw_')) {
      const itemId = a.id.slice('throw_'.length);
      const carried = c.resources[`_carry_${itemId}`];
      if (carried && (thrownThisTurn.get(itemId) ?? 0) >= carried.current) return { ok: false, reason: `No more ${carried.name} to throw` };
    }
    if (cost === 'bonus' && turn.bonusUsed) return { ok: false, reason: 'No bonus action left' };
    if (a.effects?.includes('actionSurge')) {
      if (!turn.actionUsed) return { ok: false, reason: 'Use your action first' };
      if (surgeUsed.has(turnKey())) return { ok: false, reason: 'Action Surge already used this turn' };
    }
    if (a.multiattack && a.multiattack.every((sid) => !findAction(c, sid))) return { ok: false, reason: 'Nothing to attack with' };
    if (a.effects?.includes('offhand')) {
      if (!lightMain.has(c.id)) return { ok: false, reason: 'Attack with your main hand first' };
      if (offhandDone.has(c.id)) return { ok: false, reason: 'Off-hand attack already made this turn' };
    }
    if (isSpellAction(a) && a.targeting.kind === 'creature' && targetsFor(c, a).length === 0) {
      const t = a.targeting;
      const sideOk = (o: Creature): boolean => (t.friendly ? isFriendlySide(o) === isFriendlySide(c) : areHostile(c, o));
      const max = t.melee ? t.range : (t.longRange ?? t.range);
      const blocked = all.some((o) => isAlive(o) && sideOk(o) && chebyshev(c.pos, o.pos) <= max);
      return { ok: false, reason: blocked ? 'No line of sight' : 'No target in range' };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------- turn handling

  function checkOver(): boolean {
    if (over) return true;
    // The fight is lost when the HERO falls (after Last Stand), even if an ally still stands.
    const friendly = all.some((c) => isAlive(c) && c.faction === 'player');
    const enemy = all.some((c) => isAlive(c) && !isFriendlySide(c));
    if (enemy && friendly) return false;
    over = true;
    winner = enemy ? 'enemy' : 'player';
    emit({ type: 'combatEnd', winner });
    return true;
  }

  /** Returns false if the creature cannot act this turn. */
  function startTurn(c: Creature): boolean {
    turn.creatureId = c.id;
    turn.actionUsed = false;
    turn.bonusUsed = false;
    reactionUsed.delete(c.id);
    // Cloak of Displacement returns at the start of the wearer's turn.
    if (hasFlag(c, 'displacement') && !isIncapacitated(c)) displaced.add(c.id);
    // Regeneration (Ring of Regeneration, Armor of Troll's...): heal at the start of the turn while alive and hurt.
    const regen = c.resources['_regen']?.current ?? 0;
    if (regen > 0 && isAlive(c) && c.hp < c.maxHp) {
      const before = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + regen);
      log(`${c.name} regenerates ${c.hp - before} hit points.`);
    }
    if (pitted.has(c.id)) {
      emit({ type: 'turnStart', creatureId: c.id });
      log(`${c.name} is out of the fight in the pit.`);
      turn.movementLeft = 0;
      return false;
    }
    for (const cond of c.conditions.filter((x) => x.condition === 'dodging')) removeCondition(c, cond);
    emit({ type: 'turnStart', creatureId: c.id });
    noOpportunity.delete(c.id);
    lightMain.delete(c.id);
    offhandDone.delete(c.id);
    atk.open = false;
    atk.left = 0;
    atk.loadingUsed = false;
    thrownThisTurn.clear();
    shift.delete(c.id);
    // Spirit Guardians: enemies of the caster take radiant damage at the start of their turn inside the emanation.
    for (const [ownerId, aura] of [...auras]) {
      const owner = byId.get(ownerId);
      if (!owner || !isAlive(owner) || !isAlive(c) || !areHostile(owner, c) || chebyshev(owner.pos, c.pos) > aura.radius) continue;
      log(`${c.name} starts its turn in ${owner.name}'s Spirit Guardians.`);
      const ok = rollSave(c, 'wis', aura.dc, undefined, { magical: true });
      const amount = rollDice(rng, aura.dice).total;
      dealDamage(c, ok ? Math.floor(amount / 2) : amount, aura.type, owner.id, false);
    }
    // Champion: Heroic Warrior gives Heroic Inspiration at the start of any turn begun without it.
    if (hasFlag(c, 'heroicWarrior') && isAlive(c)) {
      const insp = c.resources['inspiration'];
      if (!insp) c.resources['inspiration'] = { name: 'Heroic Inspiration', current: 1, max: 1, refresh: 'longRest' };
      else if (insp.current < 1) {
        insp.current = 1;
        if (insp.max < 1) insp.max = 1;
      }
    }
    // Champion: Survivor's Heroic Rally. Bloodied (half hit points or fewer) and still standing: regain 5 + CON.
    if (hasFlag(c, 'heroicRally') && isAlive(c) && c.hp <= c.maxHp / 2) {
      const before = c.hp;
      heal(c, String(Math.max(1, 5 + abilityMod(c.abilities.con))));
      if (c.hp > before) {
        feature(c, 'heroicRally', 'Heroic Rally', { amount: c.hp - before });
        log(`${c.name}'s Heroic Rally restores ${c.hp - before} hit points.`);
      }
    }
    for (const [id, by] of [...noHealing]) if (by === c.id) noHealing.delete(id);
    if (shielded.has(c.id)) {
      c.ac -= 5;
      shielded.delete(c.id);
    }
    const spent = spentRecharge.get(c.id);
    if (spent) {
      for (const aid of [...spent]) {
        const a = c.actions.find((x) => x.id === aid);
        if (!a || a.recharge === undefined) continue;
        const roll = rng.die(6);
        if (roll >= a.recharge) {
          spent.delete(aid);
          log(`${c.name}'s ${a.name} recharges (rolled ${roll}).`);
        }
      }
    }
    for (const [id, sl] of [...slowed]) if (sl.by === c.id) slowed.delete(id);
    for (const [id, sl] of [...sapped]) if (sl.by === c.id) sapped.delete(id);
    turn.movementLeft = speedOf(c);
    if (commanded.delete(c.id)) {
      // Command (Grovel): the creature falls prone and its turn ends.
      if (!hasCondition(c, 'prone')) {
        c.conditions.push(makeCondition('prone', null));
        emit({ type: 'conditionAdded', creatureId: c.id, condition: 'prone' });
      }
      log(`${c.name} grovels and loses the turn.`);
      turn.movementLeft = 0;
      return false;
    }
    // HOUSE RULE: a prone creature stands automatically at the cost of half its speed.
    const prone = c.conditions.find((x) => x.condition === 'prone');
    if (prone && !isIncapacitated(c)) {
      removeCondition(c, prone);
      // HOUSE RULE: standing up from Prone on ice costs all the remaining movement.
      turn.movementLeft = nav.hazardAt(c.pos) === 'ice' ? 0 : Math.max(0, turn.movementLeft - Math.floor(c.speed / 2));
    }
    if (isIncapacitated(c)) {
      log(`${c.name} is incapacitated and loses the turn.`);
      return false;
    }
    return true;
  }

  function endOfTurn(c: Creature): void {
    blinkAdv.delete(c.id);
    shift.delete(c.id);
    const st = studied.get(c.id);
    if (st && --st.turnEnds <= 0) studied.delete(c.id);
    const cp = c.resources['_concentration'];
    if (cp && conc.has(c.id)) {
      cp.current -= 1;
      if (cp.current <= 0) endConcentration(c, 'duration over');
    }
    for (const [id, g] of [...guided]) if (g.by === c.id && --g.turnEnds <= 0) guided.delete(id);
    const vx = vexed.get(c.id);
    if (vx && --vx.turnEnds <= 0) vexed.delete(c.id);
    for (const cond of c.conditions.filter((x) => x.condition === 'disengaged')) removeCondition(c, cond);
    for (const cond of [...c.conditions]) {
      if (!cond.saveEnds || !isAlive(c)) continue;
      if (rollSave(c, cond.saveEnds.ability, cond.saveEnds.dc, cond.condition)) removeCondition(c, cond);
    }
    // Sleep stage 1 ends with the target's next turn; a second failed save puts it to sleep (the HOUSE RULE repeat save then applies each turn).
    const sl = sleepers.get(c.id);
    if (sl && sl.stage === 1 && isAlive(c)) {
      const inc = c.conditions.find((x) => x.condition === 'incapacitated' && x.sourceId === sl.by);
      if (inc) removeCondition(c, inc);
      if (!rollSave(c, 'wis', sl.dc)) {
        // HOUSE RULE (solo balance): turn-denying effects allow repeated saves, so the sleeper saves again at the end of each of its turns.
        c.conditions.push(makeCondition('unconscious', null, sl.by, { ability: 'wis', dc: sl.dc }));
        emit({ type: 'conditionAdded', creatureId: c.id, condition: 'unconscious' });
        sleepers.set(c.id, { by: sl.by, dc: sl.dc, stage: 2 });
      }
    }
    // Durations tick at the end of the SOURCE's turn (or the holder's own turn if the source is gone).
    for (const holder of all) {
      for (const cond of [...holder.conditions]) {
        if (cond.rounds === null) continue;
        const src = cond.sourceId !== undefined ? byId.get(cond.sourceId) : undefined;
        const ticks = src !== undefined && isAlive(src) ? src.id === c.id : holder.id === c.id;
        if (!ticks) continue;
        cond.rounds -= 1;
        if (cond.rounds <= 0) removeCondition(holder, cond);
      }
    }
    const pit = pitted.get(c.id);
    if (pit && isAlive(c)) {
      pitted.delete(c.id);
      const out = climbOutCell(nav, (p) => occupiedBy(p, c.id) !== undefined, pit.at, pit.origin);
      if (out) {
        c.pos = { x: out.x, y: out.y };
        emit({ type: 'move', creatureId: c.id, path: [{ x: out.x, y: out.y }] });
      } else {
        c.hp = 0;
        c.dead = true;
        emit({ type: 'death', creatureId: c.id });
      }
    }
    if (isAlive(c) && hasFlag(c, 'boss') && depth >= BOSS_MOMENTUM_FROM_DEPTH) bossMomentum(c);
    emit({ type: 'turnEnd', creatureId: c.id });
  }

  /**
   * HOUSE RULE "boss momentum" (not in the SRD; legendary actions are not in the engine): the floor's boss (hidden `_boss` flag, set by
   * the encounter builder) gets one extra action at the end of its own turn from `BOSS_MOMENTUM_FROM_DEPTH` on: its single best
   * attack (not its whole Multiattack) against the weakest enemy in reach, and a second chance to recharge each spent ability.
   * Emits `actionUsed`, then a `feature` 'bossAction', then the attack's own events.
   */
  function bossMomentum(c: Creature): void {
    if (isIncapacitated(c)) return;
    const spent = spentRecharge.get(c.id);
    if (spent) {
      for (const aid of [...spent]) {
        const a = c.actions.find((x) => x.id === aid);
        if (a && a.recharge !== undefined && rng.die(6) >= a.recharge) {
          spent.delete(aid);
          log(`${c.name}'s ${a.name} recharges (boss momentum).`);
        }
      }
    }
    let best: ActionDef | undefined;
    let bestAvg = -1;
    for (const a of c.actions) {
      if (!a.attack || a.multiattack || a.cost !== 'action' || a.targeting.kind !== 'creature' || isSpellAction(a)) continue;
      if (a.recharge !== undefined && spentRecharge.get(c.id)?.has(a.id)) continue;
      if (targetsFor(c, a).length === 0) continue;
      const avg = (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
      if (avg > bestAvg) {
        best = a;
        bestAvg = avg;
      }
    }
    if (!best) return;
    const tgt = targetsFor(c, best).map((id) => byId.get(id) as Creature).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
    if (!tgt) return;
    emit({ type: 'actionUsed', creatureId: c.id, actionId: best.id, name: `Boss momentum: ${best.name}`, targetId: tgt.id });
    feature(c, 'bossAction', 'Boss momentum', { targetId: tgt.id });
    resolveOn(c, best, tgt);
  }

  /** Move the index to the next living creature, emitting roundStart on wrap. */
  function nextLiving(): Creature | undefined {
    for (let step = 0; step < order.length + 1; step++) {
      idx += 1;
      if (idx >= order.length) {
        idx = 0;
        round += 1;
        emit({ type: 'roundStart', round });
      }
      const cand = byId.get(order[idx] as string) as Creature;
      if (isAlive(cand)) return cand;
    }
    return undefined;
  }

  /** End the active creature's turn and start the next creature that can act. */
  function advance(): void {
    let skipped = 0;
    for (;;) {
      const cur = active();
      if (isAlive(cur)) endOfTurn(cur);
      else emit({ type: 'turnEnd', creatureId: cur.id });
      if (checkOver()) return;
      const next = nextLiving();
      if (!next) return;
      if (startTurn(next) || skipped >= MAX_SKIPPED_TURNS) return;
      skipped += 1;
    }
  }

  // --------------------------------------------------------------- commands

  /**
   * Cost of one step for a creature. HOUSE RULE: a flier (the Sphinx and the Pseudodragon, hidden flag `_flying`)
   * ignores difficult terrain (shallow water costs 1). It still cannot cross a chasm or a wall: the grid says so.
   */
  function stepFor(c: Creature, from: GridPos, to: GridPos): number {
    const sc = nav.stepCost(from, to);
    // Narrow flight (a timed effect): a step over a chasm or lava costs one cell; the move may not end there (see validateMove).
    if (!Number.isFinite(sc) && hasFlag(c, 'hover') && chebyshev(from, to) === 1 && nav.inBounds(to) && (isDeadly(nav.hazardAt(to)) || (isDeadly(nav.hazardAt(from)) && nav.isWalkable(to)))) return 1;
    return sc === 2 && (hasFlag(c, 'flying') || hasFlag(c, 'hover')) ? 1 : sc;
  }

  function validateMove(c: Creature, path: GridPos[]): void {
    if (path.length === 0) throw new Error('Move path is empty');
    if (isIncapacitated(c)) throw new Error(`${c.name} cannot move while incapacitated`);
    let cur = c.pos;
    let cost = 0;
    for (const p of path) {
      if (chebyshev(cur, p) !== 1) throw new Error('Move path is not contiguous');
      const sc = stepFor(c, cur, p);
      if (!Number.isFinite(sc)) throw new Error(`Cannot step from (${cur.x},${cur.y}) to (${p.x},${p.y})`);
      if (occupiedBy(p, c.id)) throw new Error(`Cell (${p.x},${p.y}) is occupied`);
      cost += sc;
      cur = p;
    }
    if (hasFlag(c, 'hover') && isDeadly(nav.hazardAt(cur))) throw new Error('A flier cannot end its move over a pit or lava');
    if (cost > turn.movementLeft + 1e-9) throw new Error(`Not enough movement: need ${cost}, have ${turn.movementLeft}`);
  }

  /** The melee attack used for opportunity attacks: the single melee attack with the best average damage. */
  function opportunityAction(h: Creature): ActionDef | undefined {
    let best: ActionDef | undefined;
    let bestAvg = -1;
    for (const a of h.actions) {
      if (!a.attack || a.targeting.kind !== 'creature' || !a.targeting.melee || a.cost === 'reaction' || isSpellAction(a) || a.effects?.includes('offhand')) continue;
      const avg = (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
      if (avg > bestAvg) {
        best = a;
        bestAvg = avg;
      }
    }
    return best;
  }

  function doMove(c: Creature, path: GridPos[]): void {
    let segment: GridPos[] = [];
    const flush = (): void => {
      if (segment.length) emit({ type: 'move', creatureId: c.id, path: segment });
      segment = [];
    };
    for (const next of path) {
      // Tactical Shift / Remarkable Athlete: up to half speed of this turn's movement provokes nothing.
      const free = shift.get(c.id) ?? 0;
      const stepCost = stepFor(c, c.pos, next);
      const noProvoke = free >= stepCost;
      if (noProvoke) shift.set(c.id, free - stepCost);
      if (!hasCondition(c, 'disengaged') && !noProvoke) {
        for (const h of all) {
          if (!isAlive(c)) break;
          if (!isAlive(h) || !areHostile(c, h) || reactionUsed.has(h.id) || isIncapacitated(h) || noOpportunity.has(h.id)) continue;
          const oa = opportunityAction(h);
          if (!oa || oa.targeting.kind !== 'creature') continue;
          const reach = oa.targeting.range;
          if (chebyshev(c.pos, h.pos) > reach || chebyshev(next, h.pos) <= reach) continue;
          flush();
          reactionUsed.add(h.id);
          const label = `Opportunity Attack (${oa.name})`;
          emit({ type: 'actionUsed', creatureId: h.id, actionId: oa.id, name: label, targetId: c.id });
          resolveOn(h, oa, c, true, label);
        }
      }
      if (!isAlive(c)) break;
      const sc = stepFor(c, c.pos, next);
      c.pos = { x: next.x, y: next.y };
      turn.movementLeft -= sc;
      segment.push({ x: next.x, y: next.y });
    }
    flush();
  }

  function addSelfCondition(c: Creature, cond: Condition): void {
    c.conditions.push(makeCondition(cond, null, c.id));
    emit({ type: 'conditionAdded', creatureId: c.id, condition: cond });
  }

  function doAction(c: Creature, a: ActionDef, targetId: string | undefined, point: GridPos | undefined): void {
    const ev: GameEvent = { type: 'actionUsed', creatureId: c.id, actionId: a.id, name: a.name };
    if (targetId !== undefined) ev.targetId = targetId;
    if (point !== undefined) ev.point = point;
    emit(ev);
    const cost = actionCost(c, a);
    if (cost === 'action') {
      if (isPoolAttack(c, a)) {
        if (atk.open && atk.left > 0) atk.left -= 1;
        else {
          // A new Attack action: this attack plus the extra ones.
          turn.actionUsed = true;
          atk.open = true;
          atk.left = (c.resources['_attacks']?.current ?? 1) - 1;
          atk.loadingUsed = false;
        }
        if (a.effects?.includes('loading')) atk.loadingUsed = true;
        if (a.id.startsWith('throw_')) {
          const itemId = a.id.slice('throw_'.length);
          thrownThisTurn.set(itemId, (thrownThisTurn.get(itemId) ?? 0) + 1);
        }
      } else {
        turn.actionUsed = true;
        atk.open = false;
        atk.left = 0;
      }
    }
    if (cost === 'bonus') turn.bonusUsed = true;
    if (a.uses) (c.resources[a.uses.resource] as { current: number }).current -= a.uses.amount;
    if (a.recharge !== undefined) {
      let set = spentRecharge.get(c.id);
      if (!set) spentRecharge.set(c.id, (set = new Set()));
      set.add(a.id);
    }
    const fx = a.effects ?? [];
    if (fx.includes('lightAttack')) lightMain.add(c.id);
    if (fx.includes('offhand')) offhandDone.add(c.id);
    if (fx.includes('dash')) turn.movementLeft += speedOf(c);
    if (fx.includes('aggressive')) {
      turn.movementLeft += speedOf(c);
      log(`${c.name} charges!`);
    }
    if (fx.includes('actionSurge')) {
      turn.actionUsed = false;
      surgeUsed.add(turnKey());
      log(`${c.name} surges into action!`);
    }
    // Tactical Shift: Second Wind also lets the hero move up to half speed without provoking opportunity attacks.
    if (fx.includes('secondWind') && hasFlag(c, 'tacticalShift')) {
      shift.set(c.id, Math.floor(speedOf(c) / 2));
      feature(c, 'tacticalShift', 'Tactical Shift', { amount: Math.floor(speedOf(c) / 2) });
    }
    // Blink Dog Teleport. HOUSE RULE: the attack straight after it counts as made from hiding (advantage, so Sneak Attack applies).
    if (fx.includes('blink') && point) {
      c.pos = { x: point.x, y: point.y };
      emit({ type: 'move', creatureId: c.id, path: [{ x: point.x, y: point.y }] });
      blinkAdv.add(c.id);
      log(`${c.name} blinks across the room.`);
      return;
    }
    if (fx.includes('disengage')) addSelfCondition(c, 'disengaged');
    if (fx.includes('dodge')) addSelfCondition(c, 'dodging');
    if (fx.includes('breakFree')) {
      const d20 = rng.die(20);
      const bonus = abilityMod(c.abilities.str);
      const success = d20 + bonus >= BREAK_FREE_DC;
      emit({ type: 'saveRoll', creatureId: c.id, ability: 'str', d20, bonus, total: d20 + bonus, dc: BREAK_FREE_DC, success });
      if (success) {
        for (const cond of c.conditions.filter((x) => x.condition === 'restrained' && x.rounds === null)) removeCondition(c, cond);
      }
    }
    const t = a.multiattack ? ({ kind: 'creature', melee: true, range: 1 } as const) : a.targeting;
    if (t.kind === 'self') {
      const timedUse = a.effects?.find((e) => e.startsWith('timedUse:'));
      if (timedUse) return applyTimedUse(c, timedUse.slice('timedUse:'.length));
      if (applyBuffSpell(c, a, c)) return;
      if (a.heal) heal(c, a.heal);
      if (a.applies) addCondition(c, a.applies, c);
      return;
    }
    if (t.kind === 'point') {
      const origin = t.range === 0 && t.area.shape === 'sphere' ? c.pos : (point ?? c.pos);
      resolveArea(c, a, computeAreaCells(nav, c.pos, origin, t.range, t.area), t.range === 0 ? c.pos : origin);
      return;
    }
    const primary = byId.get(targetId as string) as Creature;
    const runSub = (ids: string[]): void => {
      for (const sid of ids) {
        const sub = findAction(c, sid);
        if (!sub || !isAlive(c)) continue;
        let tgt: Creature | undefined = primary;
        if (!isAlive(primary) || !inReach(c, sub, primary)) {
          tgt = targetsFor(c, sub)
            .map((id) => byId.get(id) as Creature)
            .sort((x, y) => chebyshev(c.pos, x.pos) - chebyshev(c.pos, y.pos))[0];
        }
        if (tgt) resolveOn(c, sub, tgt);
      }
    };
    if (a.multiattack) {
      runSub(a.multiattack);
      return;
    }
    // HOUSE RULE: the SRD lets a shove replace one attack of the Attack action; for a monster with Multiattack it replaces
    // the FIRST attack of the sequence, and the rest of the sequence follows (so a brute can shove and still strike).
    if (isShove(a) && c.resources['_attacks'] === undefined) {
      resolveOn(c, a, primary);
      const seq = c.actions.find((x) => x.multiattack !== undefined && x.multiattack.length > 1);
      if (seq && seq.multiattack) runSub(seq.multiattack.slice(1));
      return;
    }
    resolveOn(c, a, primary);
  }

  /** Hit probability (attacks) or failed-save probability (saves) of an action; null if neither. */
  function chanceOf(a: ActionDef, c: Creature, tgt: Creature): number | null {
    if (a.multiattack) {
      const first = a.multiattack.map((id) => findAction(c, id)).find((x) => x !== undefined);
      return first ? chanceOf(first, c, tgt) : null;
    }
    if (isShove(a)) return shoveSave(c, tgt).failChance;
    if (a.attack) {
      const s = attackSetup(c, tgt, a);
      const outs = modOutcomes(c);
      const p = outs.reduce((t, k) => t + d20Probability(s.mode, singleHitProbability(s.bonus + k, tgt.ac + s.cover, s.critMin)), 0) / outs.length;
      return canInspire(c) ? p + (1 - p) * p : p;
    }
    if (a.save) {
      if (autoFailsSave(tgt, a.save.ability)) return 1;
      const mode = saveMode(tgt, a.save.ability, a.applies?.condition);
      const outs = modOutcomes(tgt);
      const cover = a.save.ability === 'dex' ? coverBonusFor(nav, all, c.pos, tgt.pos) : 0;
      return 1 - outs.reduce((t, k) => t + d20Probability(mode, singleSaveProbability(saveBonus(tgt, a.save!.ability) + cover + k, a.save!.dc)), 0) / outs.length;
    }
    return null;
  }

  // -------------------------------------------------------------------- api

  const api: CombatApi = {
    get round() {
      return round;
    },
    get order() {
      return order;
    },
    get activeId() {
      return turn.creatureId;
    },
    get turn() {
      return turn;
    },
    get isOver() {
      return over;
    },
    get winner() {
      return winner;
    },

    begin(): GameEvent[] {
      if (began) throw new Error('Combat has already begun');
      began = true;
      events = [];
      const rolled = all.map((c, i) => {
        const r = rollD20(hasFlag(c, 'initAdv') ? 'advantage' : 'normal');
        // Alert: add the proficiency bonus to initiative.
        return { c, i, total: r.d20 + abilityMod(c.abilities.dex) + (hasFlag(c, 'alert') ? c.proficiencyBonus : 0) };
      });
      rolled.sort(
        (a, b) =>
          b.total - a.total ||
          Number(b.c.id === 'player') - Number(a.c.id === 'player') ||
          b.c.abilities.dex - a.c.abilities.dex ||
          a.i - b.i,
      );
      for (const r of rolled) order.push(r.c.id);
      // HOUSE RULE: lurkers that start out of every hero's sight get advantage on their first attack.
      const heroes = all.filter((x) => isAlive(x) && x.faction === 'player');
      for (const x of all) {
        if (isAlive(x) && x.faction === 'enemy' && creatureTactic(x) === 'lurker' && heroes.length > 0 && heroes.every((h) => !nav.hasLineOfSight(h.pos, x.pos))) ambush.add(x.id);
      }
      emit({ type: 'combatStart', order: [...order] });
      log(`Initiative: ${rolled.map((r) => `${r.c.name} ${r.total}`).join(', ')}.`);
      if (checkOver()) return events;
      round = 1;
      emit({ type: 'roundStart', round });
      idx = -1;
      let skipped = 0;
      for (;;) {
        idx += 1;
        if (idx >= order.length) {
          idx = 0;
          round += 1;
          emit({ type: 'roundStart', round });
        }
        const cand = byId.get(order[idx] as string) as Creature;
        if (!isAlive(cand)) continue;
        if (startTurn(cand) || skipped >= MAX_SKIPPED_TURNS) break;
        endOfTurn(cand);
        skipped += 1;
        if (checkOver()) break;
      }
      return events;
    },

    creature: (id) => byId.get(id),
    creatures: () => all,

    reachable(): ReachableCell[] {
      if (!began || over) return [];
      const c = active();
      if (isIncapacitated(c)) return [];
      return nav
        .reachable(c.pos, turn.movementLeft, { blocked: (p) => occupiedBy(p, c.id) !== undefined })
        .filter((r) => !(r.pos.x === c.pos.x && r.pos.y === c.pos.y) && !occupiedBy(r.pos, c.id));
    },

    availableActions(): ActionDef[] {
      if (!began || over) return [];
      const c = active();
      const out = [...c.actions];
      if (canBreakFree(c) && !out.some((a) => a.id === BREAK_FREE_ID)) out.push(breakFreeAction());
      // Shove (SRD Unarmed Strike): generated for everyone; each takes the place of one attack.
      for (const s of [shoveFor(c, shovePushAction()), shoveFor(c, shoveTripAction())]) if (!out.some((a) => a.id === s.id)) out.push(s);
      // A Push-mastery weapon (or Tactical Master) says so when its next blow would knock a creature into a hazard.
      return out.map((a) => {
        if (!a.attack || !a.effects?.some((e) => e === 'mastery:push' || e.startsWith('tmOwn:'))) return a;
        for (const id of targetsFor(c, a)) {
          const pv = pushPreview(api, a.id, id);
          if (pv && pv.hazard !== 'ice' && pv.hazard !== 'water') {
            const t = byId.get(id) as Creature;
            return { ...a, description: `${a.description} Push: the blow would knock ${t.name} into the ${pv.hazard === 'fall' ? 'pit' : pv.hazard}${pv.damage ? ` for ${pv.damage}` : ''}.` };
          }
        }
        return a;
      });
    },

    canUse(actionId) {
      if (!began) return { ok: false, reason: 'Combat has not begun' };
      return useCheck(active(), actionId);
    },

    validTargets(actionId) {
      if (!began) return [];
      const c = active();
      const a = findAction(c, actionId);
      return a ? targetsFor(c, a) : [];
    },

    hitChance(actionId, targetId) {
      if (!began) return null;
      const c = active();
      const a = findAction(c, actionId);
      const t = byId.get(targetId);
      if (!a || !t) return null;
      return chanceOf(a, c, t);
    },

    areaCells(actionId, point) {
      if (!began) return [];
      const c = active();
      const a = findAction(c, actionId);
      if (!a || a.targeting.kind !== 'point') return [];
      return computeAreaCells(nav, c.pos, point, a.targeting.range, a.targeting.area);
    },

    execute(command: Command): GameEvent[] {
      if (!began) throw new Error('Combat has not begun');
      if (over) throw new Error('Combat is over');
      const c = active();
      // Validate completely before touching any state.
      if (command.type === 'move') {
        validateMove(c, command.path);
      } else if (command.type === 'action') {
        const a = findAction(c, command.actionId);
        const check = useCheck(c, command.actionId);
        if (!a || !check.ok) throw new Error(`Cannot use ${command.actionId}: ${check.reason ?? 'unknown'}`);
        const t = a.multiattack ? ({ kind: 'creature' } as const) : a.targeting;
        if (t.kind === 'creature') {
          if (command.targetId === undefined || !targetsFor(c, a).includes(command.targetId)) {
            throw new Error(`Invalid target for ${a.name}`);
          }
        } else if (t.kind === 'point') {
          if (!pointLegal(c, a, command.point)) throw new Error(`Invalid target point for ${a.name}`);
          const dest = command.point as GridPos;
          if (a.effects?.includes('blink') && (!nav.isWalkable(dest) || occupiedBy(dest, c.id))) throw new Error(`Invalid target point for ${a.name}`);
        }
      } else if (command.type !== 'endTurn') {
        throw new Error('Unknown command');
      }
      events = [];
      if (command.type === 'endTurn') {
        advance();
        return events;
      }
      if (command.type === 'move') doMove(c, command.path);
      else doAction(c, findAction(c, command.actionId) as ActionDef, command.targetId, command.point);
      if (!checkOver() && !isAlive(c)) advance();
      return events;
    },
  };
  depthReaders.set(api, depth);
  navReaders.set(api, nav);
  attackReaders.set(api, () => {
    if (!began || over) return 0;
    const c = active();
    const pool = c.resources['_attacks'];
    if (!pool) return turn.actionUsed ? 0 : 1;
    if (atk.open && atk.left > 0) return atk.left;
    return turn.actionUsed ? 0 : pool.current;
  });
  return api;
}

import type { ActionDef, CombatApi, Command, CompanionStance, Creature, GridPos, NavGrid, PlayerCharacter } from '../core/types';
import { SHOVE_PUSH_ID, SHOVE_TRIP_ID } from './actions';
import { attacksLeft, pushPreview } from './combat';
import { averageDice } from './dice';
import { expertPolicy } from './expertPolicy';
import { longRestGain, shortRestGain } from './character';
import { previewRest } from './restPreview';
import { planPush } from './terrain';
import { areHostile, chebyshev, isAlive } from './util';

/**
 * The Guided-mode adviser: "what should I do?"
 *
 * In combat it asks the EXPERT scripted hero (`expertPolicy`, unmodified) for its next command and describes it in one
 * plain sentence with the number that justifies it. Nothing is executed and no dice are rolled: the policy only reads
 * the combat (positions, hit chances, hazards) and never draws from its rng.
 *
 * Purity. expertPolicy is pure with respect to proposing a move: the Archer's repositioning is derived from the combat state
 * (movement left, whether the action is used), not counted when a move is proposed, so asking cannot change what the
 * hero does. The only memory it keeps (the hold-a-chokepoint memory, off by default) is written once per round to the same
 * values whoever asks first. The per-state cache below is kept as an optimisation, not for correctness: the policy runs
 * path searches, and a HUD that asks on every redraw would repeat them; the answer is cached per combat for as long as the
 * state (round, turn, every creature's position, hit points and conditions, attacks left) is unchanged.
 */

export interface Advice {
  command: Command;
  /** The action to highlight on the action bar, when the suggestion is an action. For a shove it is the engine's shove action id. */
  actionId?: string;
  text: string;
}

export interface AdviseOptions {
  /**
   * The companion's current stance. Accepted so the game can pass it through; the hero's choice does not depend on it
   * (the expert hero's moves are the same whatever the companion does), so it is not used yet.
   */
  companionStance?: CompanionStance;
}

const HERO_ID = 'player';

const cache = new WeakMap<CombatApi, { sig: string; advice: Advice | null }>();

function signature(combat: CombatApi): string {
  const t = combat.turn;
  return JSON.stringify([
    combat.round,
    combat.activeId,
    t.actionUsed,
    t.bonusUsed,
    t.movementLeft,
    attacksLeft(combat),
    combat.creatures().map((c) => [c.id, c.pos.x, c.pos.y, c.hp, c.dead, c.conditions.length, Object.values(c.resources).reduce((s, r) => s + r.current, 0)]),
  ]);
}

/** What the expert hero would do now, described for a beginner. Null when it is not the hero's turn or the fight is over. */
export function advise(combat: CombatApi, nav: NavGrid, opts: AdviseOptions = {}): Advice | null {
  void opts;
  if (combat.isOver || combat.activeId !== HERO_ID) return null;
  const hero = combat.creature(HERO_ID);
  if (!hero || !isAlive(hero)) return null;
  const sig = signature(combat);
  const hit = cache.get(combat);
  if (hit && hit.sig === sig) return hit.advice;
  const command = expertPolicy(combat, nav);
  const advice = describe(combat, nav, hero, command);
  cache.set(combat, { sig, advice });
  return advice;
}

// ------------------------------------------------------------------------------------------ wording

const pct = (n: number | null | undefined): string => (n === null || n === undefined ? '' : `${Math.round(n * 100)}%`);

function hazardWords(h: string): { into: string; result: (dmg?: string) => string } {
  switch (h) {
    case 'fall':
      return { into: 'the pit', result: (d) => `it would fall${d ? ` for ${d}` : ''}` };
    case 'lava':
      return { into: 'the lava', result: (d) => `it would burn${d ? ` for ${d}` : ''}` };
    case 'fire':
      return { into: 'the fire', result: (d) => `it would be burned${d ? ` for ${d}` : ''}` };
    case 'spikes':
      return { into: 'the spikes', result: (d) => `it would be impaled${d ? ` for ${d}` : ''}` };
    case 'water':
      return { into: 'the water', result: () => 'it would be knocked prone' };
    default:
      return { into: 'the ice', result: () => 'it would slide further' };
  }
}

/** Compass direction from one cell to another (grid x grows east, y grows south). */
function compass(from: GridPos, to: GridPos): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const v = Math.abs(dy) * 2 > Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : '';
  const h = Math.abs(dx) * 2 > Math.abs(dy) ? (dx < 0 ? 'west' : 'east') : '';
  return [v, h].filter(Boolean).join('-') || 'east';
}

/** A name that tells same-named enemies apart without coordinates: "Goblin Warrior", "nearest Goblin Warrior", ... */
function nameOf(combat: CombatApi, hero: Creature, target: Creature): string {
  const same = combat.creatures().filter((c) => isAlive(c) && c.name === target.name && areHostile(hero, c));
  if (same.length <= 1 || !same.includes(target)) return target.name;
  const dist = (c: Creature): number => chebyshev(hero.pos, c.pos);
  const nearest = Math.min(...same.map(dist));
  if (dist(target) === nearest && same.filter((c) => dist(c) === nearest).length === 1) return `nearest ${target.name}`;
  const weakest = Math.min(...same.map((c) => c.hp / c.maxHp));
  if (target.hp / target.maxHp === weakest && same.filter((c) => c.hp / c.maxHp === weakest).length === 1) return `most wounded ${target.name}`;
  return `${target.name} to the ${compass(hero.pos, target.pos)}`;
}

const the = (s: string): string => `the ${s}`;

function actionText(combat: CombatApi, nav: NavGrid, hero: Creature, a: ActionDef, cmd: Extract<Command, { type: 'action' }>): string {
  const target = cmd.targetId ? combat.creature(cmd.targetId) : undefined;
  const who = target ? the(nameOf(combat, hero, target)) : '';
  const chance = target ? combat.hitChance(a.id, target.id) : null;
  const hpLine = `you are at ${hero.hp} of ${hero.maxHp} HP`;
  const heal = a.heal ? Math.round(averageDice(a.heal)) : 0;
  const bonus = a.cost === 'bonus' ? ' (bonus action)' : '';

  if (a.id === 'second_wind') return `Use Second Wind${bonus} to recover about ${heal} HP.`;
  if (a.id === 'action_surge') return 'Use Action Surge to take another full set of attacks this turn.';
  if (a.id.startsWith('drink_')) return `Drink a ${a.name} — ${hpLine}.`;
  if (a.id === 'break_free') return 'Try to break free — you cannot move while you are held.';
  if (a.id === 'dodge') return 'Take the Dodge action: attacks against you have disadvantage until your next turn.';
  if (a.id === 'dash') return 'Dash to cover more ground this turn.';
  if (a.id === 'disengage') return 'Disengage so you can walk away without being struck as you leave.';
  if (a.id === SHOVE_TRIP_ID && target) return `Trip ${who}${chance !== null ? ` (${pct(chance)})` : ''} to knock it prone.`;
  if (a.id === SHOVE_PUSH_ID && target) {
    const pv = pushPreview(combat, a.id, target.id);
    const odds = chance !== null ? ` (${pct(chance)})` : '';
    if (!pv) return `Shove ${who}${odds} to push it back.`;
    const w = hazardWords(pv.hazard);
    return `Shove ${who} toward ${w.into}${odds} — ${w.result(pv.damage)}.`;
  }
  const isSpell = a.effects?.includes('spell') === true;
  if (isSpell) {
    if (a.heal) {
      const self = !target || target.id === hero.id;
      return `Cast ${a.name} ${self ? 'on yourself' : `on ${who}`} — ${hpLine}${heal ? ` (heals about ${heal})` : ''}.`;
    }
    if (a.targeting.kind === 'point' && cmd.point) {
      const cells = combat.areaCells(a.id, cmd.point);
      const hit = combat.creatures().filter((c) => isAlive(c) && c !== hero && areHostile(hero, c) && cells.some((p) => p.x === c.pos.x && p.y === c.pos.y));
      const n = hit.length;
      return `Cast ${a.name} so it catches ${n === 1 ? 'the' : n}${n === 1 && hit[0] ? ` ${hit[0].name}` : ` enem${n === 1 ? 'y' : 'ies'}`}.`;
    }
    if (target && a.attack) return `Cast ${a.name} at ${who} (${pct(chance)} to hit).`;
    if (target && a.save) return `Cast ${a.name} at ${who} (${pct(chance)} chance it fails its save).`;
    if (target) return `Cast ${a.name} on ${who}.`;
    return `Cast ${a.name}.`;
  }
  if (a.id.startsWith('throw_') && target) return `Throw a ${a.name.replace(/^Throw /, '')} at ${who} (${pct(chance)} to hit).`;
  if (a.id.startsWith('offhand_') && target) return `Strike ${who} with your off-hand ${a.name.replace(/^Off-hand: /, '')} (${pct(chance)} to hit)${bonus}.`;
  if (a.attack && target) {
    const ranged = a.targeting.kind === 'creature' && !a.targeting.melee;
    const verb = ranged ? `Shoot ${who} with your ${a.name}` : `Attack ${who} with your ${a.name}`;
    let tail = '';
    if (a.effects?.some((e) => e === 'mastery:push' || e.startsWith('tmOwn:'))) {
      const pv = pushPreview(combat, a.id, target.id);
      if (pv) {
        const w = hazardWords(pv.hazard);
        tail = ` — a hit pushes it into ${w.into}: ${w.result(pv.damage)}`;
      }
    }
    return `${verb} (${pct(chance)} to hit)${tail}.`;
  }
  if (target) return `Use ${a.name} on ${who}.`;
  void nav;
  return `Use ${a.name}.`;
}

function moveText(combat: CombatApi, nav: NavGrid, hero: Creature, path: GridPos[]): string {
  const dest = path[path.length - 1];
  const enemies = combat.creatures().filter((c) => isAlive(c) && areHostile(hero, c));
  if (!dest || enemies.length === 0) return 'Move to a better position.';
  const dist = (p: GridPos, e: Creature): number => chebyshev(p, e.pos);
  const nearestTo = (p: GridPos): Creature => enemies.reduce((b, e) => (dist(p, e) < dist(p, b) || (dist(p, e) === dist(p, b) && e.hp < b.hp) ? e : b), enemies[0] as Creature);
  const near = nearestTo(dest);
  const now = Math.min(...enemies.map((e) => dist(hero.pos, e)));
  const there = dist(dest, near);
  const hasMelee = hero.actions.some((a) => a.id.startsWith('atk_') && a.targeting.kind === 'creature' && a.targeting.melee);
  const ranged = hero.actions.find((a) => a.id.startsWith('atk_') && a.targeting.kind === 'creature' && !a.targeting.melee);

  if (there <= 1 && hasMelee && now > 1) {
    // Does the new spot make a shove into a hazard possible?
    const occ = (p: GridPos): boolean => combat.creatures().some((o) => isAlive(o) && o !== hero && o.pos.x === p.x && o.pos.y === p.y);
    const plan = planPush(nav, (p) => occ(p) && !(p.x === near.pos.x && p.y === near.pos.y), near.pos, Math.sign(near.pos.x - dest.x), Math.sign(near.pos.y - dest.y), 1);
    const nm = the(nameOf(combat, hero, near));
    if (plan.hazard) return `Move next to ${nm} — from there you can shove it into ${hazardWords(plan.hazard.kind === 'lava' ? 'lava' : 'fall').into}.`;
    return `Move next to ${nm} to attack it.`;
  }
  if (ranged && ranged.targeting.kind === 'creature') {
    const r = ranged.targeting.range;
    const shootable = enemies.find((e) => dist(dest, e) <= r && dist(dest, e) > 1 && nav.hasLineOfSight(dest, e.pos));
    const couldBefore = enemies.some((e) => dist(hero.pos, e) <= r && nav.hasLineOfSight(hero.pos, e.pos));
    if (shootable && !couldBefore) return `Move to a spot where you can shoot ${the(nameOf(combat, hero, shootable))}.`;
  }
  const away = Math.min(...enemies.map((e) => dist(dest, e)));
  if (away > now) return `Back away from ${the(nameOf(combat, hero, nearestTo(hero.pos)))} to keep your distance.`;
  if (nav.coverBetween(near.pos, dest) > 0 && dist(dest, near) >= 2) return `Move behind cover from ${the(nameOf(combat, hero, near))}.`;
  if (away < now) return `Move closer to ${the(nameOf(combat, hero, near))}.`;
  return 'Move to a safer spot.';
}

function describe(combat: CombatApi, nav: NavGrid, hero: Creature, cmd: Command): Advice | null {
  if (cmd.type === 'endTurn') return { command: cmd, text: 'End your turn — nothing useful is left.' };
  if (cmd.type === 'move') return { command: cmd, text: moveText(combat, nav, hero, cmd.path) };
  const a = combat.availableActions().find((x) => x.id === cmd.actionId) ?? hero.actions.find((x) => x.id === cmd.actionId);
  if (!a) return { command: cmd, actionId: cmd.actionId, text: `Use ${cmd.actionId}.` };
  return { command: cmd, actionId: a.id, text: actionText(combat, nav, hero, a, cmd) };
}

// ------------------------------------------------------------------------------------------ exploring

export interface ExploreContext {
  hpFraction: number;
  shortRestsLeft: number;
  atRestSite: boolean;
  canCastHeal: boolean;
  potions: number;
  enemyInView: boolean;
  companionHurt: boolean;
}

/** A hero below this fraction of their HP is "badly hurt". */
const BADLY_HURT = 0.4;
/** Below this, a short rest is worth suggesting. */
const WORTH_REST = 0.7;

/**
 * The between-fights nudge: a heal when badly hurt, a rest site when one is next to the hero, a short rest when it
 * would help and one is left. Nothing while an enemy is in view, nothing when nothing is needed.
 */
export function adviseExplore(pc: PlayerCharacter, ctx: ExploreContext): { id: string; text: string } | null {
  if (ctx.enemyInView) return null;
  const hp = `you are at ${pc.hp} of ${pc.maxHp} HP`;
  const hurt = ctx.hpFraction < WORTH_REST;
  // The rest site beside the hero restores everything: use it when there is anything to restore.
  if (ctx.atRestSite && (longRestGain(pc) || ctx.companionHurt)) {
    return { id: 'rest_site', text: `A rest site is right here — rest now to restore all your HP and abilities before you move on (${hp}).` };
  }
  const shortRest = ctx.shortRestsLeft > 0 ? previewRest(pc, null, 'short', { shortRestsLeft: ctx.shortRestsLeft }) : null;
  const shortHelps = !!shortRest && !shortRest.wasteful && shortRestGain(pc).hp;
  if (ctx.hpFraction < BADLY_HURT) {
    if (ctx.canCastHeal) return { id: 'cast_heal', text: `Cast a healing spell on yourself — ${hp}.` };
    if (shortHelps && shortRest) return { id: 'short_rest', text: `Take a short rest — ${hp}. ${shortRest.gains[0] ?? 'Recover some HP'}.` };
    if (ctx.potions > 0) return { id: 'drink_potion', text: `Drink a Potion of Healing — ${hp}.` };
    return null;
  }
  if (ctx.shortRestsLeft > 0 && (hurt || ctx.companionHurt) && (shortHelps || ctx.companionHurt)) {
    const what = shortRest?.gains[0] ?? 'Recover some HP';
    return { id: 'short_rest', text: `Take a short rest${hurt ? ` — ${hp}` : ''}. ${what}${ctx.companionHurt ? ' and your companion heals too' : ''}.` };
  }
  return null;
}

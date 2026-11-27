import type { ActionDef, Creature, MonsterDef, MonsterTactic } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { averageDice } from './dice';
import { hasFlag } from './util';

/**
 * Monster roles. `MonsterDef.tactic` wins when present; otherwise the role is inferred from the stat block:
 *
 *  - caster: its best output is a save-based area or a spell-like effect (not a recharging breath), or it is a
 *    named spellcaster (Mage, Priest, Cultist, Shaman...) whose best output is not a plain melee attack;
 *  - archer: it has ranged attacks and no melee worth the name, or its ranged attack is clearly the better;
 *  - leader: a boss-role humanoid or fiend whose name marks command (Boss, Captain, Chief, Priest, Mage...) or
 *    which is a caster-boss; other bosses (giants, dragons, constructs) are brutes;
 *  - skirmisher: fast (speed 40 ft+), Nimble Escape or teleporting;
 *  - lurker: traits or names that hide it (spider climb, amorphous, invisible, mimic-likes);
 *  - guard: a humanoid soldier (Guard, Warrior, Soldier, Knight, Legionary...) of modest size;
 *  - brute: everything else (the default for big melee creatures).
 */

const avg = (a: ActionDef): number => (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);

function subActions(def: MonsterDef, a: ActionDef): ActionDef[] {
  if (!a.multiattack) return [a];
  return a.multiattack.map((id) => def.actions.find((x) => x.id === id)).filter((x): x is ActionDef => !!x);
}

const isMeleeAct = (a: ActionDef): boolean => a.targeting.kind === 'creature' && a.targeting.melee && !a.targeting.friendly;
const isRangedAct = (a: ActionDef): boolean => a.targeting.kind === 'creature' && !a.targeting.melee && !a.targeting.friendly;
const isAreaAct = (a: ActionDef): boolean => a.targeting.kind === 'point' && a.damage !== undefined;

export interface StatSummary {
  melee: number;
  ranged: number;
  /** Best save-based area or save-based ranged spell-like output without recharge. */
  spell: number;
  /** Best recharging area (a breath weapon). */
  breath: number;
  /** Longest range, in cells, of an attack-roll ranged action. */
  rangeCells: number;
  /** True when it owns a non-recharging area, save or condition action that is not a melee attack (a spell-like control or area). */
  control: boolean;
}

/** Best per-turn damage of each kind of output of a stat block. */
export function summarize(def: MonsterDef): StatSummary {
  const s: StatSummary = { melee: 0, ranged: 0, spell: 0, breath: 0, rangeCells: 0, control: false };
  for (const a of def.actions) {
    if (a.recharge === undefined && !a.effects?.some((e) => ['dash', 'disengage', 'dodge', 'aggressive'].includes(e)) && (a.targeting.kind === 'point' || (a.targeting.kind === 'creature' && !a.targeting.melee && !a.targeting.friendly)) && (a.save || a.applies || a.targeting.kind === 'point') && !a.attack) s.control = true;
    if (a.targeting.kind === 'creature' && !a.targeting.melee && a.attack) s.rangeCells = Math.max(s.rangeCells, a.targeting.range);
    if (a.cost !== 'action' || a.targeting.kind === 'self') continue;
    if (a.effects?.some((e) => ['dash', 'disengage', 'dodge', 'aggressive'].includes(e))) continue;
    const parts = subActions(def, a);
    const total = parts.reduce((t, p) => t + avg(p), 0);
    if (a.targeting.kind === 'point' && isAreaAct(a)) {
      if (a.recharge !== undefined) s.breath = Math.max(s.breath, total);
      else s.spell = Math.max(s.spell, total);
    } else if (parts.length > 0 && parts.every(isMeleeAct)) s.melee = Math.max(s.melee, total);
    else if (parts.length > 0 && parts.every(isRangedAct)) {
      // A save-based ranged effect (a ray, a gaze) is spell-like; an attack roll is a shot.
      if (parts.every((p) => p.save && !p.attack)) s.spell = Math.max(s.spell, total);
      else s.ranged = Math.max(s.ranged, total);
    } else if (parts.some(isMeleeAct)) s.melee = Math.max(s.melee, total);
  }
  return s;
}

const CASTER_NAME = /(mage|wizard|priest|cultist|shaman|acolyte|warlock|sorcerer|druid|lich|witch|hag|necromancer|archmage|illusionist|cleric|seer|beholder|mind flayer)/i;
const LEADER_NAME = /(boss|captain|chief|priest|mage|warlord|commander|king|queen|lord|master|elder|general|marshal|pirate|archmage|lich|hag|rakshasa)/i;
const OFFICER_NAME = /(captain|chief|priest|boss)/i;
const GUARD_NAME = /(guard|warrior|soldier|legionary|sentinel|knight|thug|veteran|bandit|footman|man-at-arms|warden|defender|scout|skeleton)/i;

/** True when the stat block itself says it hides: spider climb, amorphous, invisibility or a false appearance. */
function hides(def: MonsterDef): boolean {
  if (def.traits.includes('amorphous') || def.traits.includes('spiderClimb')) return true;
  return /invisible|false appearance|camouflag|ambush/i.test(def.description);
}

/** A boss-role monster that gives orders rather than leaps in: humanoid, fiend, celestial or fey with a command name, or a caster. */
function isCommandBoss(def: MonsterDef, s: StatSummary): boolean {
  if (def.role !== 'boss') return false;
  if (['giant', 'dragon', 'construct', 'ooze', 'plant', 'beast', 'elemental', 'monstrosity', 'aberration', 'undead'].includes(def.type) && !CASTER_NAME.test(def.name)) return false;
  return LEADER_NAME.test(def.name) || s.spell > Math.max(s.melee, s.ranged) || CASTER_NAME.test(def.name);
}

/** Stat blocks that may be shown as an archer or as a guard: a real bow AND a real sword. */
export function isFlexible(def: MonsterDef): boolean {
  if (def.tactic) return false;
  const s = summarize(def);
  return qualifiesAsArcher(def, s) && s.melee >= s.ranged * 0.8 && def.role !== 'boss' && (def.type === 'humanoid' || def.type === 'fey' || def.type === 'undead') && (def.size === 'small' || def.size === 'medium');
}

/** What a flexible monster does when it lands on a front, guard or flank post instead of a back or high one. */
export function flexibleAlternative(def: MonsterDef): MonsterTactic {
  return GUARD_NAME.test(def.name) ? 'guard' : 'brute';
}

/** A real ranged routine: within 20% of the melee output (or better) and a range of 12 cells or more, on a creature that is not a giant, dragon or beast. */
function qualifiesAsArcher(def: MonsterDef, s: StatSummary): boolean {
  if (s.ranged <= 0 || s.rangeCells < 12) return false;
  if (['dragon', 'giant', 'beast', 'construct', 'ooze', 'plant', 'elemental'].includes(def.type)) return false;
  if (def.size === 'huge' || (def.size === 'large' && !/centaur/i.test(def.name))) return false;
  return s.ranged >= s.melee * 0.8;
}

export function inferTactic(def: MonsterDef): MonsterTactic {
  const s = summarize(def);
  const best = Math.max(s.melee, s.ranged, s.spell);
  const bigMelee = ['dragon', 'giant', 'construct', 'beast', 'ooze', 'plant'].includes(def.type);
  // Spell-like output: an area or save effect as the main output, or a named caster or a creature with area/control actions of its own.
  const caster = s.spell > 0 && s.spell >= best * 0.9 && s.spell > s.melee;
  const namedCaster = CASTER_NAME.test(def.name) && def.type !== 'beast' && (s.spell > 0 || s.ranged > 0 || s.control) && s.melee < Math.max(s.spell, s.ranged, 1) * 1.3;
  const spellUser = s.control && !bigMelee && def.role !== 'boss' && !qualifiesAsArcher(def, s) && (['fey', 'fiend', 'celestial', 'aberration', 'humanoid', 'elemental'].includes(def.type)) && (s.spell > 0 || /naga|oni|dryad|hag|satyr|priest|mage|cultist|sphinx|couatl|efreeti|djinni|genie/i.test(def.name));
  if (isCommandBoss(def, s) || (def.role !== 'boss' && OFFICER_NAME.test(def.name) && def.type !== 'beast')) return 'leader';
  if (caster || namedCaster || spellUser) return 'caster';
  if (qualifiesAsArcher(def, s)) return 'archer';
  const fast = def.speedFt >= 40 || def.traits.includes('nimbleEscape');
  if (def.role !== 'boss' && hides(def)) return 'lurker';
  if (fast && def.cr <= 6 && def.role !== 'boss' && def.size !== 'huge') return 'skirmisher';
  if (def.role !== 'boss' && def.size !== 'large' && def.size !== 'huge' && (['humanoid', 'undead', 'construct', 'fey'].includes(def.type) || GUARD_NAME.test(def.name)) && s.control === false && def.cr <= 6) return 'guard';
  if (def.role !== 'boss' && def.size === 'small' && def.traits.includes('packTactics')) return 'skirmisher';
  return 'brute';
}

/** The monster's tactic: the data's override when set, else inferred from the stat block. */
export function tacticOf(def: MonsterDef): MonsterTactic {
  return def.tactic ?? inferTactic(def);
}

const cache = new Map<string, MonsterTactic>();
const TACTICS: MonsterTactic[] = ['brute', 'skirmisher', 'archer', 'caster', 'leader', 'lurker', 'guard'];

/**
 * The tactic of a creature in play: a hidden `_tactic_<name>` flag (tests and special encounters) wins, then its
 * MonsterDef by `defId`. Heroes, companions and unknown defs have none (undefined: the generic AI).
 */
export function creatureTactic(c: Creature): MonsterTactic | undefined {
  if (c.faction !== 'enemy') return undefined;
  for (const t of TACTICS) if (hasFlag(c, `tactic_${t}`)) return t;
  const hit = cache.get(c.defId);
  if (hit) return hit;
  const def = MONSTERS.find((m) => m.id === c.defId);
  if (!def) return undefined;
  const t = tacticOf(def);
  cache.set(c.defId, t);
  return t;
}

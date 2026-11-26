/**
 * The Fighter (Champion) from level 1 to 20, as data: SRD 5.2.1 "Fighter Features" table and the
 * Champion subclass. One row per level with everything a rules engine needs to build the class
 * (proficiency bonus, attacks per Attack action, uses of each limited feature, critical range,
 * which levels grant an Ability Score Improvement) and the features gained at that level, with
 * summaries in this game's own words.
 *
 * This is the single source for the progression. The balance model (src/balance/model.ts) reads
 * it today; the rules engine's Fighter (src/rules/classes.ts, levels 1 to 3 so far) is meant to
 * be extended from it: `features` maps onto ClassDef.features, the *Uses columns onto
 * resourcesAt(level), and `flags` onto flagsAt(level).
 */

export interface FighterFeature {
  name: string;
  summary: string;
  /** Set for features that come from the Champion subclass rather than the base class. */
  subclass?: 'champion';
}

export interface FighterLevel {
  level: number;
  proficiencyBonus: number;
  /** Attacks made with one Attack action (Extra Attack at 5, two at 11, three at 20). */
  attacks: number;
  /** Second Wind uses (one returns on a short rest, all on a long rest). */
  secondWindUses: number;
  /** Kinds of weapon whose mastery property the Fighter can use. */
  weaponMasteries: number;
  /** Action Surge uses per short or long rest. */
  actionSurgeUses: number;
  /** Indomitable uses per long rest. */
  indomitableUses: number;
  /** Lowest d20 roll that scores a critical hit (Champion). */
  critFrom: number;
  /** True at the levels that grant an Ability Score Improvement (or another feat). */
  abilityScoreImprovement: boolean;
  /** Features gained at exactly this level. */
  features: FighterFeature[];
  /** Engine flags gained at exactly this level (cumulative flags are flagsUpTo(level)). */
  flags: string[];
}

const ASI: FighterFeature = {
  name: 'Ability Score Improvement',
  summary: 'Raise one ability score by 2 or two scores by 1 (to a maximum of 20), or take a feat instead.',
};

const FEATURES: Record<number, FighterFeature[]> = {
  1: [
    { name: 'Fighting Style', summary: 'You chose a fighting style that sharpens your combat.' },
    { name: 'Second Wind', summary: 'Bonus action: regain 1d10 + your fighter level hit points. A short rest restores one use, a long rest all.' },
    { name: 'Weapon Mastery', summary: 'You can use the mastery property of the weapon kinds you have trained with.' },
  ],
  2: [
    { name: 'Action Surge', summary: 'Once per rest, take one additional action on your turn.' },
    { name: 'Tactical Mind', summary: 'When you fail an ability check, spend a use of Second Wind to add 1d10 to it; the use is kept if you still fail.' },
  ],
  3: [
    { name: 'Champion: Improved Critical', summary: 'Your attacks score a critical hit on a roll of 19 or 20.', subclass: 'champion' },
    { name: 'Champion: Remarkable Athlete', summary: 'You have advantage on initiative rolls, and after a critical hit you can move half your speed without provoking attacks.', subclass: 'champion' },
  ],
  4: [ASI],
  5: [
    { name: 'Extra Attack', summary: 'You attack twice whenever you take the Attack action.' },
    { name: 'Tactical Shift', summary: 'When you use Second Wind, you can move up to half your speed without provoking opportunity attacks.' },
  ],
  6: [ASI],
  7: [{ name: 'Champion: Additional Fighting Style', summary: 'You learn a second fighting style.', subclass: 'champion' }],
  8: [ASI],
  9: [
    { name: 'Indomitable', summary: 'When you fail a saving throw, reroll it with a bonus equal to your fighter level. Uses return on a long rest.' },
    { name: 'Tactical Master', summary: 'When you attack with a weapon you have mastered, you can use Push, Sap or Slow in place of its own mastery property.' },
  ],
  10: [{ name: 'Champion: Heroic Warrior', summary: 'In combat, you gain Heroic Inspiration at the start of any turn you begin without it.', subclass: 'champion' }],
  11: [{ name: 'Two Extra Attacks', summary: 'You attack three times whenever you take the Attack action.' }],
  12: [ASI],
  13: [{ name: 'Studied Attacks', summary: 'When you miss a creature, you have advantage on your next attack against it before the end of your next turn.' }],
  14: [ASI],
  15: [{ name: 'Champion: Superior Critical', summary: 'Your attacks score a critical hit on a roll of 18 to 20.', subclass: 'champion' }],
  16: [ASI],
  17: [{ name: 'Action Surge (two uses)', summary: 'You can use Action Surge twice between rests, but only once on a turn.' }],
  18: [{ name: 'Champion: Survivor', summary: 'While bloodied but still standing, you regain 5 + your Constitution modifier hit points at the start of each of your turns.', subclass: 'champion' }],
  19: [{ name: 'Epic Boon', summary: 'You gain an Epic Boon feat, or another feat of your choice.' }],
  20: [{ name: 'Three Extra Attacks', summary: 'You attack four times whenever you take the Attack action.' }],
};

const FLAGS: Record<number, string[]> = {
  2: ['tacticalMind'],
  3: ['crit19', 'initAdv'],
  5: ['tacticalShift'],
  9: ['tacticalMaster'],
  10: ['heroicWarrior'],
  13: ['studiedAttacks'],
  15: ['crit18'],
  18: ['heroicRally'],
};

/** The highest value whose starting level has been reached. */
const step = (level: number, steps: Array<[from: number, value: number]>): number => {
  let v = (steps[0] as [number, number])[1];
  for (const [from, value] of steps) if (level >= from) v = value;
  return v;
};

export const FIGHTER_MAX_LEVEL = 20;

export const FIGHTER_LEVELS: readonly FighterLevel[] = Array.from({ length: FIGHTER_MAX_LEVEL }, (_, i) => {
  const level = i + 1;
  return {
    level,
    proficiencyBonus: 2 + Math.floor((level - 1) / 4),
    attacks: step(level, [[1, 1], [5, 2], [11, 3], [20, 4]]),
    secondWindUses: step(level, [[1, 2], [4, 3], [10, 4]]),
    weaponMasteries: step(level, [[1, 3], [4, 4], [10, 5], [16, 6]]),
    actionSurgeUses: step(level, [[1, 0], [2, 1], [17, 2]]),
    indomitableUses: step(level, [[1, 0], [9, 1], [13, 2], [17, 3]]),
    critFrom: step(level, [[1, 20], [3, 19], [15, 18]]),
    abilityScoreImprovement: [4, 6, 8, 12, 14, 16].includes(level),
    features: FEATURES[level] ?? [],
    flags: FLAGS[level] ?? [],
  };
});

/** The row for a level, clamped to 1..20. */
export function fighterLevel(level: number): FighterLevel {
  const l = Math.max(1, Math.min(FIGHTER_MAX_LEVEL, Math.floor(level)));
  return FIGHTER_LEVELS[l - 1] as FighterLevel;
}

/** Every engine flag the Fighter has at a level. A later flag can supersede an earlier one (crit18 over crit19). */
export function fighterFlagsUpTo(level: number): string[] {
  return FIGHTER_LEVELS.filter((r) => r.level <= level).flatMap((r) => r.flags);
}

/** How many Ability Score Improvements the Fighter has had by a level. */
export function fighterImprovementsUpTo(level: number): number {
  return FIGHTER_LEVELS.filter((r) => r.level <= level && r.abilityScoreImprovement).length;
}

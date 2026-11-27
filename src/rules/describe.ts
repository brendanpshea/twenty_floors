import type { PassiveEffect } from '../core/types';

const signedN = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** One plain line for a passive (the item's own effects the numbers above do not show). Null for passives shown elsewhere. */
export function describePassive(p: PassiveEffect): string | null {
  switch (p.type) {
    case 'acBonus':
    case 'unarmoredAcBonus':
    case 'speedBonus':
    case 'castSpell':
      return null;
    case 'flight': return 'Hovers over pits, lava and water; cannot be pushed into a pit';
    case 'saveBonus': return `${signedN(p.amount)} to all saving throws`;
    case 'setAbility': return `${p.ability.toUpperCase()} becomes ${p.score} if lower`;
    case 'abilityBonus': return `${signedN(p.amount)} ${p.ability.toUpperCase()} (up to ${p.max ?? 20})`;
    case 'resistance': return `Resistance to ${p.damageType} damage`;
    case 'immunity': return `Immunity to ${p.damageType} damage`;
    case 'conditionImmunity': return `Cannot be ${p.condition}`;
    case 'maxHpBonus': return `${signedN((p.flat ?? 0))}${p.perLevel ? ` and ${signedN(p.perLevel)} per level` : ''} maximum hit points`;
    case 'initiativeAdvantage': return 'Advantage on initiative';
    case 'critImmunity': return 'Critical hits against you are normal hits';
    case 'ignoreHazard': return `Ignores ${p.hazard === 'fall' ? 'pits' : p.hazard}`;
    case 'displacement': return 'Attacks against you have disadvantage until you are hit';
    case 'deathWard': return 'The first time you would drop to 0 hit points, you drop to 1 instead';
    case 'mirrorImage': return `${p.images} illusory duplicates that can take hits meant for you`;
    case 'attackAdvantage': return 'Your attacks have advantage';
    case 'unseen': return null;
    case 'polymorph': return `You take the form of a ${p.monsterId.replace(/_/g, ' ')}, with its hit points on top of yours`;
    case 'speedMultiplier': return p.factor === 2 ? 'Speed doubled' : `Speed x${p.factor}`;
    case 'saveAdvantage': return `Advantage on ${p.ability.toUpperCase()} saving throws`;
    case 'extraAttack': return 'One extra weapon attack each turn';
    case 'bonusWeaponDice': return `+${p.dice} damage with weapons`;
    case 'sizeUp': return 'You grow larger';
    case 'minimumAc': return `Armor Class at least ${p.ac}`;
    case 'retaliate': return `A creature that hits you in melee takes ${p.dice} ${p.damageType} damage`;
    case 'bless': return '+1d4 to attack rolls and saving throws';
    case 'tempHp': return `${p.amount} temporary hit points`;
    case 'attackersDisadvantage': return 'Attacks against you have disadvantage';
    case 'wardVersus': return `Attacks by ${p.versus.join(', ')} creatures have disadvantage against you`;
    case 'rangedAcBonus': return `${signedN(p.amount)} Armor Class against ranged attacks`;
    case 'interceptRanged':
      return p.reaction
        ? `Takes a ranged attack aimed at an ally within ${p.cells * 5} ft (your reaction)`
        : `Cursed: ranged weapon attacks aimed at allies within ${p.cells * 5} ft hit you instead`;
    case 'rangedWeaponResistance': return 'Half damage from ranged weapon attacks';
    case 'spellWard': return 'Advantage on saves against magic; spell attacks against you have disadvantage';
    case 'handsFree': return 'Floats beside you: works with a two-handed weapon';
    case 'doubleHitDiceHealing': return 'Hit Dice heal twice as much on a short rest';
    case 'regeneration': return `Regain ${p.amount} hit points each turn`;
    case 'weaponDamage': return `+${p.dice}${p.damageType ? ` ${p.damageType}` : ''} damage${p.versus ? ` against ${p.versus.join(', ')}` : ''}`;
    case 'weaponCritDamage': return `+${p.dice} damage on a critical hit`;
    case 'critRange': return `Critical hit on ${p.from}-20`;
  }
}


/** Every effect of a passive as a plain line for the pack screen: unlike `describePassive` this includes Armor Class, speed and granted spells. */
export function describeEffectLine(p: PassiveEffect, spellName?: (id: string) => string): string {
  switch (p.type) {
    case 'acBonus': return `${signedN(p.amount)} to AC`;
    case 'unarmoredAcBonus': return `${signedN(p.amount)} to AC while wearing no armor or shield`;
    case 'speedBonus': return `${signedN(p.cells * 5)} ft speed`;
    case 'castSpell': {
      const name = spellName ? spellName(p.spellId) : p.spellId;
      return `Cast ${name}, ${p.charges} charge${p.charges === 1 ? '' : 's'} per long rest`;
    }
    default: return describePassive(p) ?? '';
  }
}

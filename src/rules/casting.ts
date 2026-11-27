import type { Rng } from '../core/rng';
import type { Ability, PlayerCharacter } from '../core/types';
import { computeAc, finalAbilities } from './character';
import { rollDice, withModifier } from './dice';
import { MI_ABILITIES, casterFor, getSpell, knownSpellIds, spellPoolKey } from './spells';
import { clone } from './util';

/** Spells that make sense between fights. */
export const OUT_OF_COMBAT_SPELLS: readonly string[] = ['cure_wounds', 'healing_word', 'false_life', 'mage_armor'];

/** Temporary hit points the hero carries between fights (from False Life). */
export function tempHpOf(pc: PlayerCharacter): number {
  return pc.resources['_tempHp']?.current ?? 0;
}

/** True while Mage Armor is on the hero (until the next long rest). */
export function hasMageArmor(pc: PlayerCharacter): boolean {
  return (pc.resources['_mageArmor']?.current ?? 0) > 0;
}

/** Spells the hero knows that can be cast out of combat, with whether the once-per-long-rest use is still there. */
export function outOfCombatSpells(pc: PlayerCharacter): { id: string; name: string; available: boolean; reason?: string }[] {
  return knownSpellIds(pc.build)
    .filter((id) => OUT_OF_COMBAT_SPELLS.includes(id))
    .map((id) => {
      const check = castCheck(pc, id);
      const out: { id: string; name: string; available: boolean; reason?: string } = {
        id,
        name: getSpell(id)?.name ?? id,
        available: check === null,
      };
      if (check) out.reason = check;
      return out;
    });
}

function castCheck(pc: PlayerCharacter, spellId: string): string | null {
  if (!knownSpellIds(pc.build).includes(spellId)) return 'You do not know that spell';
  if (!OUT_OF_COMBAT_SPELLS.includes(spellId)) return 'That spell is for combat';
  const pool = pc.resources[spellPoolKey(spellId)];
  if (pool && pool.current < 1) return 'Already cast — recovers on a long rest';
  if (spellId === 'mage_armor' && pc.equipped.armor) return 'Mage Armor needs you to wear no armor';
  if ((spellId === 'cure_wounds' || spellId === 'healing_word') && pc.hp >= pc.maxHp) return 'Already at full health';
  return null;
}

/**
 * Cast a known spell between fights: Cure Wounds and Healing Word heal, False Life grants temporary hit
 * points, Mage Armor sets the unarmored AC. Consumes the once-per-long-rest use.
 *
 * What persists: healing is permanent hit points; False Life's temporary hit points and Mage Armor last
 * until the next long rest (the game must show `tempHpOf(pc)` out of combat); nothing else carries over.
 */
export function castOutOfCombat(
  pc: PlayerCharacter,
  spellId: string,
  rng: Rng,
): { pc: PlayerCharacter; healed?: number; log: string } | { error: string } {
  const problem = castCheck(pc, spellId);
  if (problem) return { error: problem };
  const spell = getSpell(spellId);
  if (!spell) return { error: 'Unknown spell' };
  const next = clone(pc);
  const choice = next.build.choices['mi_ability'] as Ability;
  const ability: Ability = MI_ABILITIES.includes(choice) ? choice : 'int';
  const caster = casterFor(ability, finalAbilities(next.build), next.level);
  const key = spellPoolKey(spellId);
  const pool = next.resources[key] ?? { name: spell.name, current: 1, max: 1, refresh: 'longRest' as const };
  pool.current -= 1;
  next.resources[key] = pool;
  const who = next.build.name;
  if (spellId === 'cure_wounds' || spellId === 'healing_word') {
    const dice = spell.heal ? (spell.addsModifier ? withModifier(spell.heal, caster.mod) : spell.heal) : '0';
    const healed = Math.min(rollDice(rng, dice).total, next.maxHp - next.hp);
    next.hp += healed;
    return { pc: next, healed, log: `${who} casts ${spell.name} and regains ${healed} hit points.` };
  }
  if (spellId === 'false_life') {
    const t = rollDice(rng, '2d4+4').total;
    const current = Math.max(tempHpOf(next), t);
    next.resources['_tempHp'] = { name: 'Temporary HP', current, max: 0, refresh: 'longRest' };
    return { pc: next, log: `${who} casts False Life and gains ${current} temporary hit points.` };
  }
  next.resources['_mageArmor'] = { name: 'Mage Armor', current: 1, max: 0, refresh: 'longRest' };
  return { pc: next, log: `${who} casts Mage Armor: AC is now ${computeAc(next)} while unarmored.` };
}

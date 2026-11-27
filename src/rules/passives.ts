import type { Ability, AbilityScores, ItemDef, PassiveEffect, PlayerCharacter, TimedEffect, WornSlot } from '../core/types';
import { ATTUNEMENT_LIMIT } from '../core/types';
import { getItem } from './items';

/**
 * Item passives: what the worn and equipped items of a hero do while they work. An item that needs attunement does nothing
 * unless the hero is attuned to it (at most ATTUNEMENT_LIMIT attuned items count). Worn items give every passive;
 * an equipped weapon, armor or shield gives its passives too, and weapon-only passives (weaponDamage, weaponCritDamage,
 * critRange) apply to attacks made with that weapon alone.
 */

export interface ActivePassive {
  itemId: string;
  source: 'worn' | 'weapon' | 'armor' | 'shield' | 'timed';
  passive: PassiveEffect;
}

/** Timed effects (a potion, a scroll) last a number of fights (DESIGN.md: one minute is the current fight, one hour the next three). */
export const timedEffects = (pc: PlayerCharacter): TimedEffect[] => pc.timed ?? [];

/** Whether the hero hovers (narrow flight): a timed effect with `hover`, or a worn item with the flight passive. */
export const hovers = (pc: PlayerCharacter): boolean => timedEffects(pc).some((t) => t.hover === true) || activePassives(pc).some((a) => a.passive.type === 'flight');

/** Start an effect (one with the same id is replaced, so the duration is renewed, not stacked). */
export function addTimedEffect(pc: PlayerCharacter, effect: TimedEffect): PlayerCharacter {
  const next = JSON.parse(JSON.stringify(pc)) as PlayerCharacter;
  next.timed = [...timedEffects(pc).filter((t) => t.id !== effect.id), { ...effect }];
  return next;
}

/** One fight has been fought: every effect has one fight fewer left, and the ended ones go. */
export function tickTimedEffects(pc: PlayerCharacter): PlayerCharacter {
  const left = timedEffects(pc);
  if (left.length === 0) return pc;
  const next = JSON.parse(JSON.stringify(pc)) as PlayerCharacter;
  next.timed = left.map((t) => ({ ...t, fightsLeft: t.fightsLeft - 1 })).filter((t) => t.fightsLeft > 0);
  return next;
}

/** The ids the hero is attuned to that count (the first ATTUNEMENT_LIMIT). */
export function attunedIds(pc: PlayerCharacter): string[] {
  return (pc.attuned ?? []).slice(0, ATTUNEMENT_LIMIT);
}

/** Whether an item works for this hero: no attunement needed, or attuned. */
export function itemWorks(pc: PlayerCharacter, item: ItemDef): boolean {
  return !item.attunement || attunedIds(pc).includes(item.id);
}

/** The worn items (ids) of a hero, both ring slots included. */
export function wornIds(pc: PlayerCharacter): string[] {
  return Object.values(pc.worn ?? {}).filter((id): id is string => typeof id === 'string');
}

const WEAPON_ONLY: PassiveEffect['type'][] = ['weaponDamage', 'weaponCritDamage', 'critRange'];

/** Every passive of the worn and equipped items that is working now. */
export function activePassives(pc: PlayerCharacter): ActivePassive[] {
  const out: ActivePassive[] = [];
  const add = (id: string | undefined, source: ActivePassive['source']): void => {
    if (!id) return;
    const item = getItem(id);
    if (!item?.passives || !itemWorks(pc, item)) return;
    for (const passive of item.passives) out.push({ itemId: id, source, passive });
  };
  for (const t of timedEffects(pc)) for (const passive of t.passives) out.push({ itemId: t.id, source: 'timed', passive });
  for (const id of wornIds(pc)) add(id, 'worn');
  // Wands, staffs and charms without a slot work from the pack (Stone of Good Luck needs attunement; wands do not).
  for (const st of pc.inventory) {
    const it = st.quantity > 0 ? getItem(st.itemId) : undefined;
    if (it?.kind === 'wondrous' && !it.slot) add(st.itemId, 'worn');
  }
  add(pc.equipped.armor, 'armor');
  add(pc.equipped.mainHand, 'weapon');
  add(pc.equipped.ranged, 'weapon');
  const off = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  add(pc.equipped.offHand, off?.kind === 'shield' ? 'shield' : 'weapon');
  return out;
}

/** Passives that act on the hero itself (everything except the weapon-only ones). */
export function creaturePassives(pc: PlayerCharacter): PassiveEffect[] {
  return activePassives(pc)
    .filter((a) => !WEAPON_ONLY.includes(a.passive.type) && a.passive.type !== 'castSpell')
    .map((a) => a.passive);
}

/** The weapon-only passives of one weapon item, if it works for this hero. */
export function weaponPassives(pc: PlayerCharacter, item: ItemDef): PassiveEffect[] {
  if (!item.passives || !itemWorks(pc, item)) return [];
  return item.passives.filter((p) => WEAPON_ONLY.includes(p.type));
}

/** Ability scores with the passives applied: `setAbility` only raises, `abilityBonus` adds up to its cap (default 20). */
export function applyAbilityPassives(base: AbilityScores, passives: PassiveEffect[]): AbilityScores {
  const out = { ...base };
  for (const p of passives) if (p.type === 'setAbility') out[p.ability] = Math.max(out[p.ability], p.score);
  for (const p of passives) {
    if (p.type !== 'abilityBonus') continue;
    const cap = p.max ?? 20;
    out[p.ability] = out[p.ability] >= cap ? out[p.ability] : Math.min(cap, out[p.ability] + p.amount);
  }
  return out;
}

/** Armor Class from passives: acBonus always, unarmoredAcBonus only with no armor and no shield. */
export function passiveAcBonus(pc: PlayerCharacter): number {
  const armored = pc.equipped.armor !== undefined;
  const off = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  const shielded = off?.kind === 'shield';
  let bonus = 0;
  for (const p of creaturePassives(pc)) {
    if (p.type === 'acBonus') bonus += p.amount;
    if (p.type === 'unarmoredAcBonus' && !armored && !shielded) bonus += p.amount;
  }
  return bonus;
}

/** Extra maximum hit points. */
export function passiveMaxHp(pc: PlayerCharacter): number {
  let n = 0;
  for (const p of creaturePassives(pc)) if (p.type === 'maxHpBonus') n += (p.flat ?? 0) + (p.perLevel ?? 0) * pc.level;
  return n;
}

export function hasPassive(pc: PlayerCharacter, type: PassiveEffect['type']): boolean {
  return creaturePassives(pc).some((p) => p.type === type);
}

export const WORN_SLOTS: readonly (Exclude<WornSlot, 'ring'> | 'ring' | 'ring2')[] = ['head', 'neck', 'cloak', 'hands', 'wrists', 'belt', 'feet', 'ring', 'ring2'];

/** Flag-resource keys the combat engine reads for passives that live in combat (see toCreature). */
export const PASSIVE_FLAGS = {
  saveBonus: '_saveBonus',
  initAdv: '_initAdv',
  critImmunity: '_critImmunity',
  displacement: '_displacement',
  regeneration: '_regen',
  ignorePrefix: '_ignore_',
} as const;

export type { Ability };

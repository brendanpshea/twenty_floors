import { ATTUNEMENT_LIMIT, type Ability, type ItemDef, type PassiveEffect, type PlayerCharacter } from '../core/types';
import { masteredKinds, toCreature } from './character';
import { compareItem } from './compare';
import { getItem } from './items';
import { attunedIds } from './passives';
import { abilityMod } from './util';

/**
 * How well a magic find suits the hero who opens the chest. chestLoot draws its find with these weights, so a
 * chest leans toward gear the build can use without ever promising it: a weight is a share of the draw, not a filter.
 *
 * The judgement starts from the shop's own comparison (compareItem: the hero is built with and without the item), then
 * adds what the comparison does not see: whether a weapon is of a kind the hero fights with or has mastered, and
 * whether a worn item's effect does anything for this hero (a belt that sets Strength to 19 is nothing to a hero at 20).
 */
export const LOOT_FIT = {
  verdict: { upgrade: 10, tradeoff: 3, sidegrade: 1.5, downgrade: 0.3, unsuitable: 0.1, owned: 0.05 } as Record<string, number>,
  /** A wand or other item that works from the pack and is not owned yet. */
  packItem: 3,
  /** A weapon of a kind in the hero's hands; of a kind whose mastery the hero has; of neither. */
  weaponInHand: 3,
  weaponMastered: 2,
  weaponOther: 0.4,
  /** A weapon whose own effect always applies (Flame Tongue, Vicious) counts at least as this verdict when its kind fits. */
  enchantedFloor: 6,
  /** A worn item whose effects do nothing for this hero; one that needs attunement when no slot is free. */
  uselessEffect: 0.05,
  noAttunementSlot: 0.3,
};

const baseKind = (i: ItemDef): string => i.baseId ?? i.id;

/** The ability the hero attacks with: Dexterity when the main weapon is ranged or finesse and Dexterity is the higher score. */
function attackAbility(pc: PlayerCharacter): Ability {
  const { str, dex } = toCreature(pc, { x: 0, y: 0 }).abilities;
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const ranged = pc.equipped.ranged ? getItem(pc.equipped.ranged) : undefined;
  const finesse = main?.weapon?.properties.includes('finesse') === true;
  if (!main && ranged) return 'dex';
  return finesse && dex > str ? 'dex' : main ? 'str' : dex > str ? 'dex' : 'str';
}

/** 0 (does nothing for this hero) to about 1.5 (exactly what the build wants) for one effect of a worn item. */
function effectWorth(pc: PlayerCharacter, p: PassiveEffect): number {
  const scores = toCreature(pc, { x: 0, y: 0 }).abilities;
  const wanted = (a: Ability): boolean => a === attackAbility(pc) || a === 'con';
  switch (p.type) {
    case 'setAbility': {
      const gain = abilityMod(Math.max(scores[p.ability], p.score)) - abilityMod(scores[p.ability]);
      return gain <= 0 ? 0 : wanted(p.ability) ? Math.min(1.5, 0.75 * gain) : 0.15;
    }
    case 'abilityBonus': {
      const after = Math.min(p.max ?? 20, scores[p.ability] + p.amount);
      const gain = abilityMod(Math.max(after, scores[p.ability])) - abilityMod(scores[p.ability]);
      return gain <= 0 ? 0 : wanted(p.ability) ? Math.min(1.5, 0.75 * gain) : 0.15;
    }
    case 'unarmoredAcBonus':
      return !pc.equipped.armor && getItem(pc.equipped.offHand ?? '')?.kind !== 'shield' ? 1.2 : 0;
    case 'acBonus':
    case 'saveBonus':
    case 'displacement':
    case 'maxHpBonus':
    case 'regeneration':
      return 1;
    default:
      return 0.6;
  }
}

/** The weight of one item for this hero (see LOOT_FIT). Always above zero, so every find stays possible. */
export function lootFit(pc: PlayerCharacter, item: ItemDef): number {
  const f = LOOT_FIT;
  const owned = pc.inventory.some((s) => s.itemId === item.id && s.quantity > 0);
  const cmp = compareItem(pc, item.id);
  let w = cmp ? (f.verdict[cmp.verdict] ?? 1) : owned ? f.verdict['owned']! : f.packItem;

  if (item.kind === 'weapon' && cmp?.verdict !== 'owned') {
    const kind = baseKind(item);
    const hands = [pc.equipped.mainHand, pc.equipped.offHand, pc.equipped.ranged].map((id) => (id ? getItem(id) : undefined)).filter((i): i is ItemDef => !!i?.weapon).map(baseKind);
    const fits = hands.includes(kind) ? f.weaponInHand : masteredKinds(pc).includes(kind) ? f.weaponMastered : f.weaponOther;
    // An always-on enchantment is an upgrade the comparison's plain numbers may not show.
    const enchanted = (item.passives ?? []).some((p) => (p.type === 'weaponDamage' && !p.versus) || p.type === 'weaponCritDamage');
    if (enchanted && fits >= f.weaponMastered && cmp?.verdict !== 'unsuitable' && cmp?.verdict !== 'downgrade') w = Math.max(w, f.enchantedFloor);
    w *= fits;
  }

  // A shield with an effect of its own reads as a sidegrade next to a plain shield (same Armor Class). A ward against
  // arrows or spells is still worth having; a curse is not pushed.
  if (item.kind === 'shield' && cmp?.verdict === 'sidegrade' && (item.passives ?? []).some((p) => p.type === 'spellWard' || p.type === 'rangedAcBonus')) {
    w = Math.max(w, LOOT_FIT.enchantedFloor);
  }

  if (item.kind === 'wondrous' && !owned) {
    const effects = item.passives ?? [];
    if (effects.length > 0) {
      const best = Math.max(...effects.map((p) => effectWorth(pc, p)));
      w *= best <= 0 ? f.uselessEffect : best;
    }
    if (item.attunement && !attunedIds(pc).includes(item.id) && attunedIds(pc).length >= ATTUNEMENT_LIMIT) w *= f.noAttunementSlot;
  }
  return Math.max(w, 0.001);
}

/** lootFit for one hero as the function chestLoot takes; each item is judged once. */
export function lootFitFor(pc: PlayerCharacter): (item: ItemDef) => number {
  const seen = new Map<string, number>();
  return (item) => {
    let w = seen.get(item.id);
    if (w === undefined) {
      w = lootFit(pc, item);
      seen.set(item.id, w);
    }
    return w;
  };
}

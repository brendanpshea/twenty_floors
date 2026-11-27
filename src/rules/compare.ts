import type { ActionDef, ItemComparison, ItemDef, PassiveEffect, PlayerCharacter, StatChange } from '../core/types';
import { computeAc, equipItem, masteredKinds, toCreature } from './character';
import { averageDice, parseDice } from './dice';
import { getItem } from './items';
import { describePassive } from './describe';
import { activePassives } from './passives';

export { describePassive };
import { abilityMod, clone } from './util';

/**
 * "The shop compares": how a weapon, armor piece or shield would change the hero, using the hero's REAL build.
 *
 * The hero is built twice through the real pipeline (equipItem on a copy that owns the item, then toCreature and
 * computeAc), and every line that differs between the two is reported. Nothing is rolled and the input is never touched.
 *
 * Expected damage per round is worked out against a typical enemy Armor Class for the hero's level:
 *
 *     typicalAc(level) = 13 + floor(level / 5)        (13 at level 1, 14 at 5, 15 at 10, 16 at 15, 17 at 20)
 *
 * which follows the monster table (goblins and skeletons 13 to 15, trolls and wraiths 15, dragons and bosses 17 and up).
 * The d20 is modelled as the game does: a natural 20 always hits, a natural 1 always misses, disadvantage (a Heavy
 * weapon with too little Strength or Dexterity) squares the miss chance, Improved and Superior Critical widen the crit
 * range, Great Weapon Fighting counts 1s and 2s as 3s, Extra Attack multiplies the main attack, a Loading weapon makes
 * one shot per round, and a Light off-hand weapon adds one attack per round.
 */

/** The Armor Class of a typical enemy for a hero of this level (see the module comment). */
export const typicalAc = (level: number): number => 13 + Math.floor(level / 5);

/** An attack as the hero would make it. */
interface AttackProfile {
  name: string;
  bonus: number;
  dice: string;
  avg: number;
  type: string;
  /** Expected damage of one attack against the typical AC (hit chance and crits included). */
  expected: number;
  /** Melee reach or ranged normal range, in cells. */
  cells: number;
  mastery: string;
  heavyDisadvantage: boolean;
  loading: boolean;
}

interface HeroProfile {
  ac: number;
  speed: number;
  attacks: number;
  melee: AttackProfile;
  ranged?: AttackProfile;
  offhand?: AttackProfile;
  /** Expected damage per round of the melee set, and of the ranged weapon. */
  meleeRound: number;
  rangedRound: number;
  /** Best expected damage of one shot or throw the hero can make at range right now, with its name. */
  bestRangedShot?: { name: string; expected: number };
  /** Strength and Dexterity. */
  str: number;
  dex: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const fmt1 = (n: number): string => n.toFixed(1);
const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));
/** A signed number for prose, with a true minus sign. */
const sign1 = (n: number): string => (n >= 0 ? '+' : '−') + fmt1(Math.abs(Math.round(n * 10) / 10));
const signInt = (n: number): string => (n >= 0 ? '+' : '−') + String(Math.abs(n));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function attackProfile(a: ActionDef, level: number, ac: number, critMin: number, kinds: string[]): AttackProfile {
  const itemId = a.id.replace(/^(atk_|offhand_|throw_)/, '');
  const item = getItem(itemId);
  const dice = a.damage?.[0]?.dice ?? '0';
  const gwf = a.effects?.includes('greatWeaponFighting') === true;
  const opts = gwf ? { minDie: 3 } : {};
  const avg = averageDice(dice, opts);
  const diceOnly = avg - parseDice(dice).mod;
  const heavy = a.effects?.includes('heavyDisadvantage') === true;
  const bonus = a.attack?.bonus ?? 0;
  const critChance = (21 - critMin) / 20;
  let hit = clamp((21 - (ac - bonus)) / 20, 0.05, 0.95);
  let crit = critChance;
  if (heavy) {
    hit = 1 - (1 - hit) * (1 - hit);
    crit = 1 - (1 - crit) * (1 - crit);
  }
  hit = Math.max(hit, crit);
  const t = a.targeting;
  const cells = t.kind === 'creature' ? t.range : 0;
  const mastered = item?.weapon?.mastery && kinds.includes(item.baseId ?? item.id);
  const mastery = item?.weapon?.mastery ? cap(item.weapon.mastery) + (mastered ? '' : ' (not mastered)') : 'None';
  return {
    name: a.name,
    bonus,
    dice,
    avg,
    type: a.damage?.[0]?.type ?? 'bludgeoning',
    expected: hit * avg + crit * diceOnly,
    cells,
    mastery,
    heavyDisadvantage: heavy,
    loading: a.effects?.includes('loading') === true,
  };
}

function profile(pc: PlayerCharacter): HeroProfile {
  const c = toCreature(pc, { x: 0, y: 0 });
  const ac = typicalAc(pc.level);
  const critMin = c.resources['_crit18'] ? 18 : c.resources['_crit19'] ? 19 : 20;
  const kinds = masteredKinds(pc);
  const make = (a: ActionDef): AttackProfile => attackProfile(a, pc.level, ac, critMin, kinds);
  const isMelee = (a: ActionDef): boolean => a.targeting.kind === 'creature' && a.targeting.melee;
  const strMod = abilityMod(c.abilities.str);
  const unarmed: ActionDef = {
    id: 'unarmed',
    name: 'Unarmed Strike',
    description: '',
    cost: 'action',
    targeting: { kind: 'creature', melee: true, range: 1 },
    attack: { bonus: strMod + c.proficiencyBonus },
    damage: [{ dice: String(Math.max(1, 1 + strMod)), type: 'bludgeoning' }],
  };
  const main = c.actions.find((a) => a.id.startsWith('atk_') && isMelee(a)) ?? c.actions.find((a) => a.id === 'unarmed') ?? unarmed;
  const rangedAction = c.actions.find((a) => a.id.startsWith('atk_') && !isMelee(a));
  const offAction = c.actions.find((a) => a.id.startsWith('offhand_'));
  const attacks = c.resources['_attacks']?.current ?? 1;
  const melee = make(main);
  const ranged = rangedAction ? make(rangedAction) : undefined;
  const offhand = offAction ? make(offAction) : undefined;
  let bestShot: { name: string; expected: number } | undefined;
  for (const a of c.actions) {
    if (!a.attack || !(a.id.startsWith('throw_') || (a.id.startsWith('atk_') && !isMelee(a)))) continue;
    const p = make(a);
    if (!bestShot || p.expected > bestShot.expected) bestShot = { name: a.name, expected: p.expected };
  }
  const profileOut: HeroProfile = {
    ac: computeAc(pc),
    speed: c.speed,
    attacks,
    melee,
    meleeRound: attacks * melee.expected + (offhand ? offhand.expected : 0),
    rangedRound: ranged ? (ranged.loading ? 1 : attacks) * ranged.expected : 0,
    str: c.abilities.str,
    dex: c.abilities.dex,
  };
  if (ranged) profileOut.ranged = ranged;
  if (offhand) profileOut.offhand = offhand;
  if (bestShot) profileOut.bestRangedShot = bestShot;
  return profileOut;
}

const line = (label: string, from: string, to: string, better: boolean | null): StatChange => ({ label, from, to, better });

function attackLines(prefix: string, kind: 'melee' | 'ranged', b: AttackProfile | undefined, a: AttackProfile | undefined, out: StatChange[]): void {
  if (!a && !b) return;
  const dash = '—';
  const hit = (p: AttackProfile | undefined): string => (p ? signed(p.bonus) : dash);
  const dmg = (p: AttackProfile | undefined): string => (p ? `${p.dice} (${fmt1(p.avg)})` : dash);
  const reach = (p: AttackProfile | undefined): string => (p ? `${p.cells * 5} ft` : dash);
  const cmp = (x: number | undefined, y: number | undefined): boolean | null => {
    if (x === undefined) return y === undefined ? null : true;
    if (y === undefined) return false;
    return y === x ? null : y > x;
  };
  if (hit(b) !== hit(a)) out.push(line(`${prefix}Hit bonus`, hit(b), hit(a), cmp(b?.bonus, a?.bonus)));
  if (dmg(b) !== dmg(a)) out.push(line(`${prefix}Damage`, dmg(b), dmg(a), cmp(b?.avg, a?.avg)));
  if (b && a && b.type !== a.type) out.push(line(`${prefix}Damage type`, b.type, a.type, null));
  if (reach(b) !== reach(a)) out.push(line(kind === 'melee' ? 'Reach' : `${prefix}Range`, reach(b), reach(a), cmp(b?.cells, a?.cells)));
  if (b?.mastery !== a?.mastery) {
    const mastered = (p: AttackProfile | undefined): boolean => !!p && p.mastery !== 'None' && !p.mastery.endsWith('(not mastered)');
    const better = mastered(a) === mastered(b) ? null : mastered(a);
    out.push(line(`${prefix}Mastery`, b?.mastery ?? dash, a?.mastery ?? dash, better));
  }
}

/** Items the hero has put on, by slot. */
const slots = (pc: PlayerCharacter): [string, string | undefined][] => [
  ['mainHand', pc.equipped.mainHand],
  ['offHand', pc.equipped.offHand],
  ['ranged', pc.equipped.ranged],
  ['armor', pc.equipped.armor],
  ...(Object.entries(pc.worn ?? {}) as [string, string | undefined][]).map(([k, id]): [string, string | undefined] => [`worn:${k}`, id]),
];

function passiveLines(pc: PlayerCharacter): string[] {
  const out = new Set<string>();
  for (const a of activePassives(pc)) {
    const t = describePassive(a.passive);
    if (t) out.add(t);
  }
  return [...out];
}

interface Delta {
  /** Plain-prose parts for the summary, most important first. */
  gains: { weight: number; text: string }[];
  losses: { weight: number; text: string }[];
}

/**
 * Compare an item with what the hero has equipped, using the hero's real build. Null for consumables and unknown items.
 * Pure and deterministic: nothing is rolled and `pc` is not modified.
 */
export function compareItem(pc: PlayerCharacter, itemId: string): ItemComparison | null {
  const item: ItemDef | undefined = getItem(itemId);
  if (!item || item.kind === 'consumable') return null;
  if (item.kind === 'weapon' && !item.weapon) return null;
  // Wands and charms that work from the pack have no slot to compare.
  if (item.kind === 'wondrous' && !item.slot) return null;

  // Owned: equipped, or a spare in the pack. (A second Light weapon is the exception: it is an off-hand addition.)
  const count = pc.inventory.find((s) => s.itemId === itemId)?.quantity ?? 0;
  const equippedCount = slots(pc).filter(([, id]) => id === itemId).length;
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  const secondLight =
    item.kind === 'weapon' &&
    item.weapon?.melee === true &&
    item.weapon.properties.includes('light') &&
    pc.equipped.mainHand === itemId &&
    !pc.equipped.offHand &&
    count < 2 &&
    main?.weapon?.properties.includes('light') === true;
  if ((equippedCount > 0 || count > 0) && !secondLight) {
    return {
      verdict: 'owned',
      summary: equippedCount > 0 ? 'You already have this equipped.' : 'You already own one.',
      changes: [],
      replaces: [],
    };
  }

  const owner = clone(pc);
  const stack = owner.inventory.find((s) => s.itemId === itemId);
  if (stack) stack.quantity += 1;
  else owner.inventory.push({ itemId, quantity: 1 });
  const after = equipItem(owner, itemId);

  // Items put away: whatever left a slot, except the slot the new item itself goes into.
  const newSlot = slots(after).find(([, id]) => id === itemId)?.[0];
  // (A weapon that takes the place of the main-hand weapon, armor of armor, a bow of a bow is a swap, not a put-away.)
  const replaces: string[] = [];
  const replacedShield = { value: false };
  const afterSlots = new Map(slots(after));
  for (const [slot, id] of slots(owner)) {
    if (!id || afterSlots.get(slot) === id) continue;
    if (slot === newSlot && slot !== 'offHand') continue;
    const def = getItem(id);
    if (def?.kind === 'shield') replacedShield.value = true;
    if (def && !replaces.includes(def.name)) replaces.push(def.name);
  }

  const before = profile(owner);
  const now = profile(after);
  const changes: StatChange[] = [];
  const unsuitable = (summary: string): ItemComparison => ({ verdict: 'unsuitable', summary, changes, replaces });

  if (before.ac !== now.ac) changes.push(line('Armor Class', String(before.ac), String(now.ac), now.ac > before.ac));

  const meleeChanged = before.melee.name !== now.melee.name || before.meleeRound !== now.meleeRound || before.melee.dice !== now.melee.dice || before.offhand?.name !== now.offhand?.name;
  const rangedChanged = before.ranged?.name !== now.ranged?.name;
  if (meleeChanged || item.kind === 'shield') attackLines('', 'melee', before.melee, now.melee, changes);
  if (before.offhand?.name !== now.offhand?.name || before.offhand?.dice !== now.offhand?.dice) {
    const show = (p: AttackProfile | undefined): string => (p ? `${p.dice} (${fmt1(p.avg)})` : '—');
    changes.push(line('Off-hand attack', show(before.offhand), show(now.offhand), before.offhand ? (now.offhand ? null : false) : true));
  }
  if (rangedChanged) attackLines('Ranged ', 'ranged', before.ranged, now.ranged, changes);
  const showRound = before.attacks > 1 || before.offhand !== undefined || now.offhand !== undefined;
  if (showRound && meleeChanged && before.meleeRound !== now.meleeRound) {
    changes.push(line('Damage per round', fmt1(Math.round(before.meleeRound * 10) / 10), fmt1(Math.round(now.meleeRound * 10) / 10), now.meleeRound > before.meleeRound));
  }
  const rangedRoundShown = rangedChanged && Math.max(before.attacks, now.attacks) > 1;
  if (rangedRoundShown && before.rangedRound !== now.rangedRound) {
    changes.push(line('Ranged damage per round', fmt1(Math.round(before.rangedRound * 10) / 10), fmt1(Math.round(now.rangedRound * 10) / 10), now.rangedRound > before.rangedRound));
  }
  const passivesBefore = passiveLines(owner);
  const passivesNow = passiveLines(after);
  const passiveGains = passivesNow.filter((t) => !passivesBefore.includes(t));
  const passiveLosses = passivesBefore.filter((t) => !passivesNow.includes(t));
  for (const t of passiveGains) changes.push(line('Effect', '—', t, true));
  for (const t of passiveLosses) changes.push(line('Effect', t, '—', false));
  if (before.speed !== now.speed) changes.push(line('Speed', `${before.speed * 5} ft`, `${now.speed * 5} ft`, now.speed > before.speed));

  // --- Does it plainly not fit the build?
  const armor = item.armor;
  const strHave = now.str;
  if (armor?.strRequirement !== undefined && strHave < armor.strRequirement) {
    return unsuitable(`Needs Strength ${armor.strRequirement} (you have ${strHave}); you would lose 10 ft of speed.`);
  }
  if (item.kind === 'weapon') {
    const a = item.weapon?.melee === false ? now.ranged : now.melee;
    const was = item.weapon?.melee === false ? before.ranged : before.melee;
    if (a?.heavyDisadvantage && !was?.heavyDisadvantage) {
      const ranged = item.weapon?.melee === false;
      return unsuitable(`Heavy weapon: you attack with disadvantage below ${ranged ? 'Dexterity' : 'Strength'} 13 (yours is ${ranged ? now.dex : strHave}).`);
    }
  }
  const rangedAdded = item.kind === 'weapon' && item.weapon?.melee === false;
  if (rangedAdded && !before.ranged && before.bestRangedShot && now.ranged) {
    // Adding a bow or crossbow to a hero with no ranged weapon: a weaker shot than the javelins already carried is not for this build.
    if (now.ranged.expected < before.bestRangedShot.expected * 0.8) {
      const dexMod = abilityMod(now.dex);
      return unsuitable(`Your Dexterity (${signed(dexMod)}) makes it a weaker shot than your ${before.bestRangedShot.name.replace(/^Throw /, 'thrown ')} (${fmt1(Math.round(now.ranged.expected * 10) / 10)} against ${fmt1(Math.round(before.bestRangedShot.expected * 10) / 10)} expected damage).`);
    }
  }
  if (item.kind === 'armor' && now.ac < before.ac) {
    return unsuitable(`Lowers your Armor Class from ${before.ac} to ${now.ac}.`);
  }

  // --- Verdict
  const d: Delta = { gains: [], losses: [] };
  const relevant = rangedAdded ? { before: before.rangedRound, after: now.rangedRound } : { before: before.meleeRound, after: now.meleeRound };
  const dExpected = relevant.after - relevant.before;
  const threshold = Math.max(0.4, 0.04 * Math.max(relevant.before, 1));
  const a2 = rangedAdded ? now.ranged : now.melee;
  const b2 = rangedAdded ? before.ranged : before.melee;
  const perRound = rangedAdded ? now.attacks > 1 : showRound;
  const addedOffhand = !before.offhand && !!now.offhand;
  const lostOffhand = !!before.offhand && !now.offhand;
  const addedRanged = rangedAdded && !before.ranged && !!now.ranged;
  const hitDelta = b2 && a2 ? a2.bonus - b2.bonus : 0;
  let avgDelta = 0;
  if (addedOffhand && now.offhand) avgDelta = now.attacks > 0 ? now.offhand.avg + (a2 && b2 ? (a2.avg - b2.avg) * now.attacks : 0) : 0;
  else if (a2 && b2) avgDelta = (a2.avg - b2.avg) * (perRound ? (rangedAdded ? (a2.loading ? 1 : now.attacks) : now.attacks) : 1);
  const per = perRound ? 'per round' : 'per hit';
  let damageText: string;
  if (addedRanged && now.ranged) damageText = `adds a ranged attack: ${now.ranged.dice} (${fmt1(now.ranged.avg)}) at ${now.ranged.cells * 5} ft`;
  else if (addedOffhand && now.offhand) damageText = `adds an off-hand attack: ${sign1(avgDelta)} damage per round`;
  else if (lostOffhand && before.offhand) damageText = `loses the off-hand attack: ${sign1(-before.offhand.avg)} damage per round`;
  else {
    const parts: string[] = [];
    if (hitDelta !== 0) parts.push(`${signInt(hitDelta)} to hit`);
    if (Math.abs(avgDelta) > 1e-9) parts.push(`${sign1(avgDelta)} damage ${per}`);
    damageText = parts.join(', ') || `${sign1(dExpected)} expected damage ${per}`;
  }
  const pct = (dExpected / Math.max(relevant.before, 1)) * 100;
  if (dExpected >= threshold) d.gains.push({ weight: Math.abs(pct), text: damageText });
  else if (dExpected <= -threshold) d.losses.push({ weight: Math.abs(pct), text: damageText });
  const dAc = now.ac - before.ac;
  if (dAc !== 0) {
    const text = `${signInt(dAc)} AC${dAc < 0 && replacedShield.value ? ' (no shield)' : ''}`;
    (dAc > 0 ? d.gains : d.losses).push({ weight: Math.abs(dAc) * 8, text });
  }
  // Worn items are judged by their effects; weapons, armor and shields by their numbers (a special effect is listed, and named in a sidegrade's summary).
  if (item.kind === 'wondrous') for (const t of passiveGains) d.gains.push({ weight: 12, text: t.charAt(0).toLowerCase() + t.slice(1) });
  if (item.kind === 'wondrous') for (const t of passiveLosses) d.losses.push({ weight: 12, text: `loses ${t.charAt(0).toLowerCase()}${t.slice(1)}` });
  const dSpeed = now.speed - before.speed;
  if (dSpeed !== 0) (dSpeed > 0 ? d.gains : d.losses).push({ weight: Math.abs(dSpeed) * 5, text: `${signInt(dSpeed * 5)} ft speed` });
  d.gains.sort((x, y) => y.weight - x.weight);
  d.losses.sort((x, y) => y.weight - x.weight);

  let verdict: ItemComparison['verdict'];
  let summary: string;
  if (d.gains.length > 0 && d.losses.length > 0) {
    verdict = 'tradeoff';
    summary = `${(d.gains[0] as { text: string }).text}, ${(d.losses[0] as { text: string }).text}`;
  } else if (d.gains.length > 0) {
    verdict = 'upgrade';
    summary = d.gains.slice(0, 2).map((g) => g.text).join(', ');
  } else if (d.losses.length > 0) {
    verdict = 'downgrade';
    summary = d.losses.slice(0, 2).map((g) => g.text).join(', ');
  } else {
    verdict = 'sidegrade';
    const mastery = changes.find((c) => c.label.endsWith('Mastery'));
    const type = changes.find((c) => c.label.endsWith('Damage type'));
    if (mastery) summary = `Much the same damage and defence; the mastery changes from ${mastery.from} to ${mastery.to}.`;
    else if (type) summary = `Much the same damage and defence; ${type.to} damage instead of ${type.from}.`;
    else if (passiveGains.length > 0) summary = `The same numbers as what you have, with ${passiveGains[0]?.charAt(0).toLowerCase()}${passiveGains[0]?.slice(1)}.`;
    else if (item.kind === 'armor') summary = 'The same Armor Class as what you wear.';
    else summary = 'Little difference from what you have now.';
  }
  return { verdict, summary: cap(summary), changes, replaces };
}

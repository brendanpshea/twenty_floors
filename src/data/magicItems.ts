import type { CreatureType, DamageType, ItemDef, ItemRarity, PassiveEffect, WornSlot } from '../core/types';
import { ARMOR, SHIELDS, WEAPONS } from './items';

/*
 * Magic items built by formula from the fixed PassiveEffect vocabulary.
 *
 * Names, rarities, attunement and numbers are transcribed from the SRD 5.2.1
 * "Magic Items A-Z" chapter. Only the parts of an item the engine can express
 * are kept; anything else is dropped (and listed in each description's source
 * family below as an approximation). Descriptions are original text.
 * Class restrictions on attunement (e.g. "by a Spellcaster") are not
 * representable and are ignored; `attunement` is just true or false.
 *
 * Every family is one generator call. MAGIC_FAMILIES keeps the grouping so
 * tests can pin the count of each; MAGIC_ITEMS is the flat catalog.
 */

export interface MagicFamily {
  /** Stable key for the family. */
  key: string;
  /** The SRD item name this family transcribes, or null for ORIGINAL content. */
  srdName: string | null;
  items: ItemDef[];
}

/**
 * HOUSE RULE: the SRD gives no prices for magic items, so every item costs the
 * price of its rarity times a per-family factor (see FAMILY_FACTOR). Magic
 * weapons and armor add the base item's cost on top.
 */
export const RARITY_PRICE: Readonly<Record<Exclude<ItemRarity, 'common'>, number>> = {
  uncommon: 400,
  rare: 1500,
  veryRare: 5000,
  legendary: 15000,
};

/**
 * HOUSE RULE: per-family price factor (allowed range 0.5 to 2). Below 1 for
 * items clearly weaker than their rarity (charged or situational items), 1
 * otherwise. Nothing is above 1.
 */
export const FAMILY_FACTOR: Readonly<Record<string, number>> = {
  ring_of_water_walking: 0.5, // situational
  ring_of_feather_falling: 0.5, // situational
  circlet_of_blasting: 0.5, // one casting a rest
  scarab_of_protection: 0.5, // only the +1 AC of three properties is kept
  boots_of_the_winterlands: 0.75,
  stone_of_good_luck: 0.75, // only the saving-throw half is kept
  periapt_of_wound_closure: 0.75, // only the Hit Die half is kept
  weapon_of_warning: 0.75, // utility, no damage
  wand_of_magic_missiles: 0.75, // charged
  wand_of_fireballs: 0.75,
  wand_of_lightning_bolts: 0.75,
  wand_of_web: 0.75,
  wand_of_binding: 0.75,
  staff_of_healing: 0.75,
  staff_of_fire: 0.75,
  staff_of_frost: 0.75,
  mace_of_disruption: 0.75, // destroy-on-low-HP rider dropped
  sword_of_wounding: 0.75, // no-healing rider dropped
  giant_slayer: 0.75, // Prone rider dropped
  mithral_armor: 1,
  // Consumables: the SRD suggests half price for one-use items.
  potion_of_resistance: 0.5,
  potion_of_giant_strength: 0.5,
  potion_of_invulnerability: 0.5,
  potion_of_speed: 0.5,
  potion_of_flying: 0.5,
  oil_of_slipperiness: 0.5,
  potion_of_heroism: 0.5,
  // A bottled spell of level 1 to 4: priced like a low Spell Scroll, well under a true potion of its rarity.
  spell_potion: 0.25,
};

const factorOf = (key: string): number => FAMILY_FACTOR[key] ?? 1;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Price of a rarity tier for a family. */
function priceOf(key: string, rarity: ItemRarity): number {
  if (rarity === 'common') {
    throw new Error('magic items are never common');
  }
  return round2(RARITY_PRICE[rarity] * factorOf(key));
}

const DAMAGE_TYPES_RESISTABLE: DamageType[] = [
  'acid',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'poison',
  'psychic',
  'radiant',
  'thunder',
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Average of NdS + B, rounded half up: the fixed charges per long rest standing in for a dawn roll. */
function avgRoll(n: number, sides: number, bonus: number): number {
  return Math.round((n * (sides + 1)) / 2 + bonus);
}

function findBase(list: ItemDef[], id: string): ItemDef {
  const base = list.find((i) => i.id === id);
  if (!base) {
    throw new Error(`unknown base item ${id}`);
  }
  return base;
}

interface WornSpec {
  id: string;
  name: string;
  family: string;
  slot?: WornSlot;
  rarity: ItemRarity;
  attunement: boolean;
  passives: PassiveEffect[];
  description: string;
}

function wondrous(s: WornSpec): ItemDef {
  const item: ItemDef = {
    id: s.id,
    name: s.name,
    kind: 'wondrous',
    description: s.description,
    cost: priceOf(s.family, s.rarity),
    rarity: s.rarity,
    attunement: s.attunement,
    passives: s.passives,
  };
  if (s.slot) {
    item.slot = s.slot;
  }
  return item;
}

/** A magic weapon: deep copy of the base weapon plus effects. */
function weaponOf(
  base: ItemDef,
  o: {
    id: string;
    name: string;
    family: string;
    rarity: ItemRarity;
    attunement: boolean;
    magicBonus?: number;
    passives: PassiveEffect[];
    description: string;
  },
): ItemDef {
  const copy: ItemDef = structuredClone(base);
  const item: ItemDef = {
    ...copy,
    id: o.id,
    name: o.name,
    description: o.description,
    cost: round2(base.cost + priceOf(o.family, o.rarity)),
    rarity: o.rarity,
    attunement: o.attunement,
    passives: o.passives,
    baseId: base.id,
  };
  if (o.magicBonus !== undefined) {
    item.magicBonus = o.magicBonus;
  }
  return item;
}

/** A magic armor or shield: deep copy of the base plus effects. */
function armorOf(
  base: ItemDef,
  o: {
    id: string;
    name: string;
    family: string;
    rarity: ItemRarity;
    attunement: boolean;
    magicBonus?: number;
    passives?: PassiveEffect[];
    description: string;
  },
): ItemDef {
  const copy: ItemDef = structuredClone(base);
  const item: ItemDef = {
    ...copy,
    id: o.id,
    name: o.name,
    description: o.description,
    cost: round2(base.cost + priceOf(o.family, o.rarity)),
    rarity: o.rarity,
    attunement: o.attunement,
    baseId: base.id,
  };
  if (o.passives) {
    item.passives = o.passives;
  }
  if (o.magicBonus !== undefined) {
    item.magicBonus = o.magicBonus;
  }
  return item;
}

const fam = (key: string, srdName: string | null, items: ItemDef[]): MagicFamily => ({ key, srdName, items });

// ---------------------------------------------------------------------------
// 1. Resistance
// ---------------------------------------------------------------------------

/** Ring of Resistance (Rare, no attunement), one per damage type in the SRD table. */
function ringsOfResistance(): ItemDef[] {
  return DAMAGE_TYPES_RESISTABLE.map((t) =>
    wondrous({
      id: `ring_of_resistance_${t}`,
      name: `Ring of Resistance (${cap(t)})`,
      family: 'ring_of_resistance',
      slot: 'ring',
      rarity: 'rare',
      attunement: false,
      passives: [{ type: 'resistance', damageType: t }],
      description: `A ring whose gem hums against ${t} harm: the wearer takes half damage from ${t}.`,
    }),
  );
}

const RESISTANCE_ARMORS = ['studded_leather', 'scale_mail', 'breastplate', 'half_plate', 'chain_mail', 'splint', 'plate'];

/** Armor of Resistance (Rare, attunement) for a subset of armors x the ten SRD damage types. */
function armorsOfResistance(): ItemDef[] {
  const out: ItemDef[] = [];
  for (const armorId of RESISTANCE_ARMORS) {
    const base = findBase(ARMOR, armorId);
    for (const t of DAMAGE_TYPES_RESISTABLE) {
      out.push(
        armorOf(base, {
          id: `${base.id}_of_resistance_${t}`,
          name: `${base.name} of Resistance (${cap(t)})`,
          family: 'armor_of_resistance',
          rarity: 'rare',
          attunement: true,
          passives: [{ type: 'resistance', damageType: t }],
          description: `A suit that turns aside ${t} harm: the wearer takes half damage from ${t} while attuned.`,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Ability scores
// ---------------------------------------------------------------------------

const BELTS: Array<{ id: string; label: string; score: number; rarity: ItemRarity }> = [
  { id: 'hill', label: 'hill', score: 21, rarity: 'rare' },
  { id: 'frost', label: 'frost', score: 23, rarity: 'veryRare' },
  { id: 'stone', label: 'stone', score: 23, rarity: 'veryRare' },
  { id: 'fire', label: 'fire', score: 25, rarity: 'veryRare' },
  { id: 'cloud', label: 'cloud', score: 27, rarity: 'legendary' },
  { id: 'storm', label: 'storm', score: 29, rarity: 'legendary' },
];

function beltsOfGiantStrength(): ItemDef[] {
  return BELTS.map((b) =>
    wondrous({
      id: `belt_of_giant_strength_${b.id}`,
      name: `Belt of Giant Strength (${b.label})`,
      family: 'belt_of_giant_strength',
      slot: 'belt',
      rarity: b.rarity,
      attunement: true,
      passives: [{ type: 'setAbility', ability: 'str', score: b.score }],
      description: `A ${b.label} giant's girdle that lifts the wearer's Strength to ${b.score} if it is lower.`,
    }),
  );
}

const IOUN_STONES: Array<{ id: string; ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; label: string }> = [
  { id: 'agility', ability: 'dex', label: 'Dexterity' },
  { id: 'fortitude', ability: 'con', label: 'Constitution' },
  { id: 'insight', ability: 'wis', label: 'Wisdom' },
  { id: 'intellect', ability: 'int', label: 'Intelligence' },
  { id: 'leadership', ability: 'cha', label: 'Charisma' },
  { id: 'strength', ability: 'str', label: 'Strength' },
];

/** Ioun Stones that raise a score by 2 (Very Rare), plus Awareness and Protection (Rare). */
function iounStones(): ItemDef[] {
  const out: ItemDef[] = IOUN_STONES.map((s) =>
    wondrous({
      id: `ioun_stone_${s.id}`,
      name: `Ioun Stone (${cap(s.id)})`,
      family: 'ioun_stone',
      slot: 'head',
      rarity: 'veryRare',
      attunement: true,
      passives: [{ type: 'abilityBonus', ability: s.ability, amount: 2, max: 20 }],
      description: `A gem that circles the head and adds 2 to the wearer's ${s.label}, up to 20.`,
    }),
  );
  out.push(
    wondrous({
      id: 'ioun_stone_awareness',
      name: 'Ioun Stone (Awareness)',
      family: 'ioun_stone',
      slot: 'head',
      rarity: 'rare',
      attunement: true,
      passives: [{ type: 'initiativeAdvantage' }],
      description: 'A dark gem that circles the head and gives the wearer advantage on initiative rolls.',
    }),
    wondrous({
      id: 'ioun_stone_protection',
      name: 'Ioun Stone (Protection)',
      family: 'ioun_stone',
      slot: 'head',
      rarity: 'rare',
      attunement: true,
      passives: [{ type: 'acBonus', amount: 1 }],
      description: 'A rose-colored gem that circles the head and grants a +1 bonus to Armor Class.',
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// 3. Protection and armor
// ---------------------------------------------------------------------------

/** Adamantine Armor: any medium or heavy armor except hide (Uncommon, no attunement). */
function adamantineArmors(): ItemDef[] {
  return ARMOR.filter((a) => a.armor && a.armor.category !== 'light' && a.id !== 'hide').map((base) =>
    armorOf(base, {
      id: `adamantine_${base.id}`,
      name: `Adamantine ${base.name}`,
      family: 'adamantine_armor',
      rarity: 'uncommon',
      attunement: false,
      passives: [{ type: 'critImmunity' }],
      description: 'Armor reinforced with adamantine: critical hits against the wearer count as normal hits.',
    }),
  );
}

/**
 * Mithral Armor: any medium or heavy armor except hide (Uncommon). It loses the
 * Strength requirement and Stealth disadvantage; it has no passives and no
 * bonus, only that changed armor block, so we generate it only for armors the
 * change affects.
 */
function mithralArmors(): ItemDef[] {
  return ARMOR.filter(
    (a) =>
      a.armor &&
      a.armor.category !== 'light' &&
      a.id !== 'hide' &&
      (a.armor.stealthDisadvantage || a.armor.strRequirement !== undefined),
  ).map((base) => {
    const item = armorOf(base, {
      id: `mithral_${base.id}`,
      name: `Mithral ${base.name}`,
      family: 'mithral_armor',
      rarity: 'uncommon',
      attunement: false,
      description: 'Light, flexible mithral mail: it has no Strength requirement and does not hinder stealth.',
    });
    if (item.armor) {
      delete item.armor.strRequirement;
      delete item.armor.stealthDisadvantage;
    }
    return item;
  });
}

const DRAGON_SCALE: Array<{ color: string; type: DamageType }> = [
  { color: 'black', type: 'acid' },
  { color: 'blue', type: 'lightning' },
  { color: 'brass', type: 'fire' },
  { color: 'bronze', type: 'lightning' },
  { color: 'copper', type: 'acid' },
  { color: 'gold', type: 'fire' },
  { color: 'green', type: 'poison' },
  { color: 'red', type: 'fire' },
  { color: 'silver', type: 'cold' },
  { color: 'white', type: 'cold' },
];

/** Dragon Scale Mail (Very Rare, attunement): +1 AC and one resistance by dragon color. */
function dragonScaleMails(): ItemDef[] {
  const base = findBase(ARMOR, 'scale_mail');
  return DRAGON_SCALE.map((d) =>
    armorOf(base, {
      id: `dragon_scale_mail_${d.color}`,
      name: `Dragon Scale Mail (${cap(d.color)})`,
      family: 'dragon_scale_mail',
      rarity: 'veryRare',
      attunement: true,
      magicBonus: 1,
      passives: [{ type: 'resistance', damageType: d.type }],
      description: `Scale mail cut from ${d.color} dragon scales: +1 to Armor Class and resistance to ${d.type} damage.`,
    }),
  );
}

function elvenChains(): ItemDef[] {
  return ['chain_mail', 'chain_shirt'].map((id) => {
    const base = findBase(ARMOR, id);
    return armorOf(base, {
      id: `elven_${base.id}`,
      name: `Elven ${base.name}`,
      family: 'elven_chain',
      rarity: 'rare',
      attunement: false,
      magicBonus: 1,
      description: 'Fine elven-made mail, light as cloth: a +1 bonus to Armor Class.',
    });
  });
}

function dwarvenPlates(): ItemDef[] {
  return ['half_plate', 'plate'].map((id) => {
    const base = findBase(ARMOR, id);
    return armorOf(base, {
      id: `dwarven_${base.id}`,
      name: `Dwarven ${base.name}`,
      family: 'dwarven_plate',
      rarity: 'veryRare',
      attunement: false,
      magicBonus: 2,
      description: 'Dwarf-forged plates that fit the body perfectly: a +2 bonus to Armor Class.',
    });
  });
}


// ---------------------------------------------------------------------------
// Timed consumables. Durations are in fights: an SRD "1 minute" or "10 minutes"
// is 1 fight, "1 hour" or longer is 3 fights.
// ---------------------------------------------------------------------------

function timedConsumable(o: {
  id: string;
  name: string;
  family: string;
  rarity: ItemRarity;
  passives: PassiveEffect[];
  fights: number;
  hover?: boolean;
  description: string;
}): ItemDef {
  const timed: { effect: 'timed'; passives: PassiveEffect[]; fights: number; hover?: boolean } = {
    effect: 'timed',
    passives: o.passives,
    fights: o.fights,
  };
  if (o.hover) {
    timed.hover = true;
  }
  return {
    id: o.id,
    name: o.name,
    kind: 'consumable',
    description: o.description,
    cost: priceOf(o.family, o.rarity),
    icon: 'potion',
    rarity: o.rarity,
    consumable: timed,
  };
}

/** Potion of Resistance (Uncommon, 1 hour = 3 fights), one per SRD damage type. */
function potionsOfResistance(): ItemDef[] {
  return DAMAGE_TYPES_RESISTABLE.map((t) =>
    timedConsumable({
      id: `potion_of_resistance_${t}`,
      name: `Potion of Resistance (${cap(t)})`,
      family: 'potion_of_resistance',
      rarity: 'uncommon',
      fights: 3,
      passives: [{ type: 'resistance', damageType: t }],
      description: `A draught that halves ${t} damage you take for the next 3 fights.`,
    }),
  );
}

/** Bottled spells (original items; the spells are the SRD's). */
function spellPotions(): ItemDef[] {
  const list: Array<{ spell: string; name: string; rarity: ItemRarity; fights: number; passives: PassiveEffect[]; description: string }> = [
    // Bless (level 1, 1 minute).
    { spell: 'bless', name: 'Bless', rarity: 'uncommon', fights: 1, passives: [{ type: 'bless' }], description: 'Adds 1d4 to your attack rolls and saving throws for the next fight.' },
    // Shield of Faith (level 1, 10 minutes): +2 AC.
    { spell: 'shield_of_faith', name: 'Shield of Faith', rarity: 'uncommon', fights: 1, passives: [{ type: 'acBonus', amount: 2 }], description: 'A shimmering field gives +2 Armor Class for the next fight.' },
    // False Life (level 1): 2d4 + 4 Temporary Hit Points; the average is given.
    { spell: 'false_life', name: 'False Life', rarity: 'uncommon', fights: 1, passives: [{ type: 'tempHp', amount: 9 }], description: 'Gives 9 temporary hit points when drunk.' },
    // Longstrider (level 1, 1 hour): +10 ft speed.
    { spell: 'longstrider', name: 'Longstrider', rarity: 'uncommon', fights: 3, passives: [{ type: 'speedBonus', cells: 2 }], description: 'Adds 10 ft to your speed for the next 3 fights.' },
    // Protection from Evil and Good (level 1, 10 minutes): the listed creature types attack with disadvantage. (Its guard against charm, fear and possession is not kept.)
    { spell: 'protection', name: 'Protection from Evil and Good', rarity: 'uncommon', fights: 1, passives: [{ type: 'wardVersus', versus: ['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead'] }], description: 'For the next fight, aberrations, celestials, elementals, fey, fiends and undead attack you with disadvantage.' },
    // Aid (level 2, 8 hours): +5 hit points, maximum and current.
    { spell: 'aid', name: 'Aid', rarity: 'uncommon', fights: 3, passives: [{ type: 'maxHpBonus', flat: 5 }], description: 'Raises your hit points and their maximum by 5 for the next 3 fights.' },
    // Blur (level 2, 1 minute): attackers have disadvantage.
    { spell: 'blur', name: 'Blur', rarity: 'uncommon', fights: 1, passives: [{ type: 'attackersDisadvantage' }], description: 'Your outline wavers: attacks against you have disadvantage for the next fight.' },
    // Stoneskin (level 4, 1 hour): resistance to bludgeoning, piercing and slashing damage.
    { spell: 'stoneskin', name: 'Stoneskin', rarity: 'rare', fights: 3, passives: [{ type: 'resistance', damageType: 'bludgeoning' }, { type: 'resistance', damageType: 'piercing' }, { type: 'resistance', damageType: 'slashing' }], description: 'Your skin turns hard as stone: half damage from bludgeoning, piercing and slashing for the next 3 fights.' },
  ];
  return list.map((s) => timedConsumable({ id: `potion_of_${s.spell}`, name: `Potion of ${s.name}`, family: 'spell_potion', rarity: s.rarity, fights: s.fights, passives: s.passives, description: s.description }));
}

/** Potion of Giant Strength (SRD table), 1 hour = 3 fights. */
function potionsOfGiantStrength(): ItemDef[] {
  const tiers: Array<{ id: string; score: number; rarity: ItemRarity }> = [
    { id: 'hill', score: 21, rarity: 'uncommon' },
    { id: 'frost', score: 23, rarity: 'rare' },
    { id: 'stone', score: 23, rarity: 'rare' },
    { id: 'fire', score: 25, rarity: 'rare' },
    { id: 'cloud', score: 27, rarity: 'veryRare' },
    { id: 'storm', score: 29, rarity: 'legendary' },
  ];
  return tiers.map((t) =>
    timedConsumable({
      id: `potion_of_giant_strength_${t.id}`,
      name: `Potion of Giant Strength (${t.id})`,
      family: 'potion_of_giant_strength',
      rarity: t.rarity,
      fights: 3,
      passives: [{ type: 'setAbility', ability: 'str', score: t.score }],
      description: `A potion that raises your Strength to ${t.score} (if lower) for the next 3 fights.`,
    }),
  );
}

const ALL_DAMAGE_TYPES: DamageType[] = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];

// ---------------------------------------------------------------------------
// 4. Weapons
// ---------------------------------------------------------------------------

/** The base weapons we generate "any simple or martial" items for. */
const ANY_WEAPON_BASES = ['longsword', 'greatsword', 'shortsword', 'battleaxe', 'greataxe', 'longbow'];
/** Melee subset for "any melee weapon" items. */
const ANY_MELEE_BASES = ['longsword', 'greatsword', 'shortsword', 'battleaxe', 'greataxe'];

/**
 * Dragon Slayer: +1, extra 3d6 of the weapon's type against Dragons (Rare, no attunement).
 * The SRD formula is shared with the ORIGINAL "bane" weapons below.
 */
const SLAYER_BONUS = 1;
const SLAYER_DICE = '3d6';
const SLAYER_RARITY: ItemRarity = 'rare';

function slayerWeapons(creature: CreatureType, nameOf: (base: ItemDef) => string, idOf: (base: ItemDef) => string, family: string): ItemDef[] {
  return ANY_WEAPON_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: idOf(base),
      name: nameOf(base),
      family,
      rarity: SLAYER_RARITY,
      attunement: false,
      magicBonus: SLAYER_BONUS,
      passives: [{ type: 'weaponDamage', dice: SLAYER_DICE, versus: [creature] }],
      description: `A +${SLAYER_BONUS} ${base.name.toLowerCase()} that deals an extra ${SLAYER_DICE} damage of its type to ${creature} creatures.`,
    });
  });
}

function dragonSlayers(): ItemDef[] {
  return slayerWeapons(
    'dragon',
    (b) => `Dragon Slayer (${b.name})`,
    (b) => `dragon_slayer_${b.id}`,
    'dragon_slayer',
  );
}

/** Giant Slayer: +1, extra 2d6 of the weapon's type against Giants. The Prone-on-failed-save rider is not kept. */
function giantSlayers(): ItemDef[] {
  return ANY_WEAPON_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `giant_slayer_${base.id}`,
      name: `Giant Slayer (${base.name})`,
      family: 'giant_slayer',
      rarity: 'rare',
      attunement: false,
      magicBonus: 1,
      passives: [{ type: 'weaponDamage', dice: '2d6', versus: ['giant'] }],
      description: `A +1 ${base.name.toLowerCase()} that deals an extra 2d6 damage of its type to giants.`,
    });
  });
}

/** Vicious Weapon: extra 2d6 damage of the weapon's type on every hit (Rare, no attunement), no plain bonus. */
function viciousWeapons(): ItemDef[] {
  return ANY_WEAPON_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `vicious_${base.id}`,
      name: `Vicious Weapon (${base.name})`,
      family: 'vicious_weapon',
      rarity: 'rare',
      attunement: false,
      passives: [{ type: 'weaponDamage', dice: '2d6' }],
      description: `A cruel ${base.name.toLowerCase()} that adds 2d6 damage of its type to every hit.`,
    });
  });
}

/** Weapon of Warning (Uncommon, attunement): advantage on initiative. Only the initiative part is kept. */
function weaponsOfWarning(): ItemDef[] {
  return ANY_WEAPON_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `weapon_of_warning_${base.id}`,
      name: `Weapon of Warning (${base.name})`,
      family: 'weapon_of_warning',
      rarity: 'uncommon',
      attunement: true,
      passives: [{ type: 'initiativeAdvantage' }],
      description: `A watchful ${base.name.toLowerCase()} that gives its attuned bearer advantage on initiative rolls.`,
    });
  });
}

/** Flame Tongue (Rare, attunement): extra 2d6 fire on a hit. The command-word ignition is modeled as always lit. */
function flameTongues(): ItemDef[] {
  return ANY_MELEE_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `flame_tongue_${base.id}`,
      name: `Flame Tongue (${base.name})`,
      family: 'flame_tongue',
      rarity: 'rare',
      attunement: true,
      passives: [{ type: 'weaponDamage', dice: '2d6', damageType: 'fire' }],
      description: `A ${base.name.toLowerCase()} wreathed in flame that deals an extra 2d6 fire damage on a hit.`,
    });
  });
}

const SWORD_BASES = ['glaive', 'greatsword', 'longsword', 'rapier', 'scimitar', 'shortsword'];

/** Frost Brand (Very Rare, attunement): extra 1d6 cold on a hit, and fire resistance while held. */
function frostBrands(): ItemDef[] {
  return SWORD_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `frost_brand_${base.id}`,
      name: `Frost Brand (${base.name})`,
      family: 'frost_brand',
      rarity: 'veryRare',
      attunement: true,
      passives: [
        { type: 'weaponDamage', dice: '1d6', damageType: 'cold' },
        { type: 'resistance', damageType: 'fire' },
      ],
      description: `A rime-covered ${base.name.toLowerCase()} that adds 1d6 cold damage to a hit and gives its bearer fire resistance.`,
    });
  });
}

/** Sword of Wounding (Rare, attunement): extra 2d6 necrotic on a hit. The no-healing save rider is not kept. */
function swordsOfWounding(): ItemDef[] {
  return SWORD_BASES.map((id) => {
    const base = findBase(WEAPONS, id);
    return weaponOf(base, {
      id: `sword_of_wounding_${base.id}`,
      name: `Sword of Wounding (${base.name})`,
      family: 'sword_of_wounding',
      rarity: 'rare',
      attunement: true,
      passives: [{ type: 'weaponDamage', dice: '2d6', damageType: 'necrotic' }],
      description: `A ${base.name.toLowerCase()} whose cuts fester: each hit deals an extra 2d6 necrotic damage.`,
    });
  });
}

/** Mace of Disruption (Rare, attunement): extra 2d6 radiant against fiends and undead. The destroy-at-25-HP rider is not kept. */
function maceOfDisruption(): ItemDef[] {
  const base = findBase(WEAPONS, 'mace');
  return [
    weaponOf(base, {
      id: 'mace_of_disruption',
      name: 'Mace of Disruption',
      family: 'mace_of_disruption',
      rarity: 'rare',
      attunement: true,
      passives: [{ type: 'weaponDamage', dice: '2d6', damageType: 'radiant', versus: ['fiend', 'undead'] }],
      description: 'A glowing mace that deals an extra 2d6 radiant damage to fiends and undead.',
    }),
  ];
}

// ORIGINAL (not in the SRD): weapons of slaying for other creature types, modelled
// exactly on the SRD's Dragon Slayer (same +1 bonus, same extra 3d6, same rarity).
export const BANE_TYPES: CreatureType[] = [
  'undead',
  'fiend',
  'aberration',
  'beast',
  'construct',
  'elemental',
  'fey',
  'monstrosity',
  'ooze',
  'plant',
  'celestial',
  'humanoid',
];

/** ORIGINAL (not in the SRD): "<Type>bane <Weapon>" for each BANE_TYPES entry and slayer base weapon. */
function baneWeapons(): ItemDef[] {
  return BANE_TYPES.flatMap((t) =>
    slayerWeapons(
      t,
      (b) => `${cap(t)}bane ${b.name}`,
      (b) => `${t}bane_${b.id}`,
      'bane_weapon',
    ),
  );
}

/*
 * Charges (wands, staffs). The SRD regains a dice roll of charges at dawn; here
 * `charges` is the average of that roll, rounded half up, as the uses per long
 * rest (1d6+1 -> 5, 1d6+4 -> 8). Where one item offers several spells, the
 * pool is split between them: each spell gets the whole casts it can afford at
 * its SRD charge cost, and at least one cast so it is reachable.
 */

function build(): MagicFamily[] {
  const families: MagicFamily[] = [];

  families.push(fam('ring_of_resistance', 'Ring of Resistance', ringsOfResistance()));
  families.push(fam('armor_of_resistance', 'Armor of Resistance', armorsOfResistance()));

  families.push(
    fam('gauntlets_of_ogre_power', 'Gauntlets of Ogre Power', [
      wondrous({
        id: 'gauntlets_of_ogre_power',
        name: 'Gauntlets of Ogre Power',
        family: 'gauntlets_of_ogre_power',
        slot: 'hands',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'setAbility', ability: 'str', score: 19 }],
        description: 'Heavy gauntlets that lift the wearer\'s Strength to 19 if it is lower.',
      }),
    ]),
  );
  families.push(fam('belt_of_giant_strength', 'Belt of Giant Strength', beltsOfGiantStrength()));
  families.push(
    fam('headband_of_intellect', 'Headband of Intellect', [
      wondrous({
        id: 'headband_of_intellect',
        name: 'Headband of Intellect',
        family: 'headband_of_intellect',
        slot: 'head',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'setAbility', ability: 'int', score: 19 }],
        description: 'A plain band that lifts the wearer\'s Intelligence to 19 if it is lower.',
      }),
    ]),
  );
  families.push(
    fam('amulet_of_health', 'Amulet of Health', [
      wondrous({
        id: 'amulet_of_health',
        name: 'Amulet of Health',
        family: 'amulet_of_health',
        slot: 'neck',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'setAbility', ability: 'con', score: 19 }],
        description: 'A warm amulet that lifts the wearer\'s Constitution to 19 if it is lower.',
      }),
    ]),
  );
  // Poison resistance is granted by the SRD only to non-dwarves; the hero is assumed not to be a dwarf.
  families.push(
    fam('belt_of_dwarvenkind', 'Belt of Dwarvenkind', [
      wondrous({
        id: 'belt_of_dwarvenkind',
        name: 'Belt of Dwarvenkind',
        family: 'belt_of_dwarvenkind',
        slot: 'belt',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'abilityBonus', ability: 'con', amount: 2, max: 20 },
          { type: 'resistance', damageType: 'poison' },
        ],
        description: 'A stout belt that adds 2 to Constitution (up to 20) and gives resistance to poison damage.',
      }),
    ]),
  );
  families.push(fam('ioun_stone', 'Ioun Stone', iounStones()));
  families.push(
    fam('periapt_of_proof_against_poison', 'Periapt of Proof against Poison', [
      wondrous({
        id: 'periapt_of_proof_against_poison',
        name: 'Periapt of Proof against Poison',
        family: 'periapt_of_proof_against_poison',
        slot: 'neck',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'immunity', damageType: 'poison' },
          { type: 'conditionImmunity', condition: 'poisoned' },
        ],
        description: 'A black-gemmed pendant that makes the wearer immune to poison damage and the poisoned condition.',
      }),
    ]),
  );

  families.push(
    fam('ring_of_protection', 'Ring of Protection', [
      wondrous({
        id: 'ring_of_protection',
        name: 'Ring of Protection',
        family: 'ring_of_protection',
        slot: 'ring',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'acBonus', amount: 1 },
          { type: 'saveBonus', amount: 1 },
        ],
        description: 'A ring that grants a +1 bonus to Armor Class and to all saving throws.',
      }),
    ]),
  );
  families.push(
    fam('cloak_of_protection', 'Cloak of Protection', [
      wondrous({
        id: 'cloak_of_protection',
        name: 'Cloak of Protection',
        family: 'cloak_of_protection',
        slot: 'cloak',
        rarity: 'uncommon',
        attunement: true,
        passives: [
          { type: 'acBonus', amount: 1 },
          { type: 'saveBonus', amount: 1 },
        ],
        description: 'A traveling cloak that grants a +1 bonus to Armor Class and to all saving throws.',
      }),
    ]),
  );
  families.push(
    fam('bracers_of_defense', 'Bracers of Defense', [
      wondrous({
        id: 'bracers_of_defense',
        name: 'Bracers of Defense',
        family: 'bracers_of_defense',
        slot: 'wrists',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'unarmoredAcBonus', amount: 2 }],
        description: 'Bracers that give a +2 bonus to Armor Class while the wearer has no armor and no shield.',
      }),
    ]),
  );
  families.push(
    fam('cloak_of_displacement', 'Cloak of Displacement', [
      wondrous({
        id: 'cloak_of_displacement',
        name: 'Cloak of Displacement',
        family: 'cloak_of_displacement',
        slot: 'cloak',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'displacement' }],
        description: 'A shimmering cloak that makes attacks against the wearer take disadvantage until the wearer is hit.',
      }),
    ]),
  );
  families.push(fam('adamantine_armor', 'Adamantine Armor', adamantineArmors()));
  families.push(fam('mithral_armor', 'Mithral Armor', mithralArmors()));
  families.push(fam('elven_chain', 'Elven Chain', elvenChains()));
  families.push(fam('dwarven_plate', 'Dwarven Plate', dwarvenPlates()));
  families.push(
    fam('glamoured_studded_leather', 'Glamoured Studded Leather', [
      armorOf(findBase(ARMOR, 'studded_leather'), {
        id: 'glamoured_studded_leather',
        name: 'Glamoured Studded Leather',
        family: 'glamoured_studded_leather',
        rarity: 'rare',
        attunement: false,
        magicBonus: 1,
        description: 'Studded leather that can pass for ordinary clothes: a +1 bonus to Armor Class.',
      }),
    ]),
  );
  families.push(fam('dragon_scale_mail', 'Dragon Scale Mail', dragonScaleMails()));
  families.push(
    fam('armor_of_invulnerability', 'Armor of Invulnerability', [
      armorOf(findBase(ARMOR, 'plate'), {
        id: 'armor_of_invulnerability',
        name: 'Armor of Invulnerability',
        family: 'armor_of_invulnerability',
        rarity: 'legendary',
        attunement: true,
        passives: [
          { type: 'resistance', damageType: 'bludgeoning' },
          { type: 'resistance', damageType: 'piercing' },
          { type: 'resistance', damageType: 'slashing' },
        ],
        description: 'Plate armor that gives resistance to bludgeoning, piercing and slashing damage.',
      }),
    ]),
  );
  families.push(
    fam('sentinel_shield', 'Sentinel Shield', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'sentinel_shield',
        name: 'Sentinel Shield',
        family: 'sentinel_shield',
        rarity: 'uncommon',
        attunement: false,
        passives: [{ type: 'initiativeAdvantage' }],
        description: 'A shield marked with a watchful eye that gives its bearer advantage on initiative rolls.',
      }),
    ]),
  );
  families.push(
    fam('shield_of_the_cavalier', 'Shield of the Cavalier', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'shield_of_the_cavalier',
        name: 'Shield of the Cavalier',
        family: 'shield_of_the_cavalier',
        rarity: 'veryRare',
        attunement: true,
        magicBonus: 2,
        description: 'A knightly shield that adds a further +2 to Armor Class on top of the shield bonus.',
      }),
    ]),
  );
  // Arrow-Catching Shield (Rare, attunement): +2 AC against ranged attack rolls; as a reaction, take a ranged attack aimed
  // at a creature within 5 ft (taken automatically for an ally; see `interceptor` in combat.ts).
  families.push(
    fam('arrow_catching_shield', 'Arrow-Catching Shield', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'arrow_catching_shield',
        name: 'Arrow-Catching Shield',
        family: 'arrow_catching_shield',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'rangedAcBonus', amount: 2 },
          { type: 'interceptRanged', cells: 1, reaction: true, weaponOnly: false },
        ],
        description: 'A shield that turns aside arrows and bolts, and can pull a shot meant for a companion beside you onto itself.',
      }),
    ]),
  );
  // Spellguard Shield (Very Rare, attunement): advantage on saves against spells and magical effects; spell attacks have disadvantage.
  families.push(
    fam('spellguard_shield', 'Spellguard Shield', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'spellguard_shield',
        name: 'Spellguard Shield',
        family: 'spellguard_shield',
        rarity: 'veryRare',
        attunement: true,
        passives: [{ type: 'spellWard' }],
        description: 'A warded shield that blunts magic: spells are easier to resist and harder to land on its bearer.',
      }),
    ]),
  );
  // Animated Shield (Very Rare, attunement): it hovers and protects as if wielded, leaving the hands free. The bonus action
  // to animate it and its one-minute limit are not kept: it is modeled as always animate.
  families.push(
    fam('animated_shield', 'Animated Shield', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'animated_shield',
        name: 'Animated Shield',
        family: 'animated_shield',
        rarity: 'veryRare',
        attunement: true,
        passives: [{ type: 'handsFree' }],
        description: 'A shield that floats at your side and guards you by itself, so both hands stay free for a great weapon.',
      }),
    ]),
  );
  // Shield of Missile Attraction (Rare, attunement, cursed): resistance to damage from ranged weapon attacks; ranged weapon
  // attacks aimed at a creature within 10 ft are aimed at the bearer instead. The curse's hold (it cannot simply be taken
  // off) is not kept: unequipping it ends both effects.
  families.push(
    fam('shield_of_missile_attraction', 'Shield of Missile Attraction', [
      armorOf(findBase(SHIELDS, 'shield'), {
        id: 'shield_of_missile_attraction',
        name: 'Shield of Missile Attraction',
        family: 'shield_of_missile_attraction',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'rangedWeaponResistance' }, { type: 'interceptRanged', cells: 2, reaction: false, weaponOnly: true }],
        description: 'A cursed shield: arrows hurt its bearer less, but every archer nearby finds their aim dragged toward it.',
      }),
    ]),
  );
  families.push(
    fam('brooch_of_shielding', 'Brooch of Shielding', [
      wondrous({
        id: 'brooch_of_shielding',
        name: 'Brooch of Shielding',
        family: 'brooch_of_shielding',
        slot: 'neck',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'resistance', damageType: 'force' }],
        description: 'A brooch that gives the wearer resistance to force damage.',
      }),
    ]),
  );
  families.push(
    fam('periapt_of_wound_closure', 'Periapt of Wound Closure', [
      wondrous({
        id: 'periapt_of_wound_closure',
        name: 'Periapt of Wound Closure',
        family: 'periapt_of_wound_closure',
        slot: 'neck',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'doubleHitDiceHealing' }],
        description: 'A pendant that doubles the hit points restored by each Hit Die spent on a short rest.',
      }),
    ]),
  );
  families.push(
    fam('scarab_of_protection', 'Scarab of Protection', [
      wondrous({
        id: 'scarab_of_protection',
        name: 'Scarab of Protection',
        family: 'scarab_of_protection',
        slot: 'neck',
        rarity: 'legendary',
        attunement: true,
        passives: [{ type: 'acBonus', amount: 1 }],
        description: 'A beetle medallion that grants a +1 bonus to Armor Class.',
      }),
    ]),
  );
  families.push(
    fam('stone_of_good_luck', 'Stone of Good Luck (Luckstone)', [
      wondrous({
        id: 'stone_of_good_luck',
        name: 'Stone of Good Luck (Luckstone)',
        family: 'stone_of_good_luck',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'saveBonus', amount: 1 }],
        description: 'A polished agate carried in a pocket that grants a +1 bonus to all saving throws.',
      }),
    ]),
  );

  families.push(fam('dragon_slayer', 'Dragon Slayer', dragonSlayers()));
  families.push(fam('giant_slayer', 'Giant Slayer', giantSlayers()));
  families.push(fam('vicious_weapon', 'Vicious Weapon', viciousWeapons()));
  families.push(fam('weapon_of_warning', 'Weapon of Warning', weaponsOfWarning()));
  families.push(fam('flame_tongue', 'Flame Tongue', flameTongues()));
  families.push(fam('frost_brand', 'Frost Brand', frostBrands()));
  families.push(fam('sword_of_wounding', 'Sword of Wounding', swordsOfWounding()));
  families.push(fam('mace_of_disruption', 'Mace of Disruption', maceOfDisruption()));

  // Movement and terrain
  families.push(
    fam('ring_of_feather_falling', 'Ring of Feather Falling', [
      wondrous({
        id: 'ring_of_feather_falling',
        name: 'Ring of Feather Falling',
        family: 'ring_of_feather_falling',
        slot: 'ring',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'ignoreHazard', hazard: 'fall' }],
        description: 'A ring that lets the wearer drift down harmlessly: falls cause no damage.',
      }),
    ]),
  );
  families.push(
    fam('ring_of_water_walking', 'Ring of Water Walking', [
      wondrous({
        id: 'ring_of_water_walking',
        name: 'Ring of Water Walking',
        family: 'ring_of_water_walking',
        slot: 'ring',
        rarity: 'uncommon',
        attunement: false,
        passives: [{ type: 'ignoreHazard', hazard: 'water' }],
        description: 'A ring that lets the wearer cross water as if it were solid ground.',
      }),
    ]),
  );
  families.push(
    fam('boots_of_the_winterlands', 'Boots of the Winterlands', [
      wondrous({
        id: 'boots_of_the_winterlands',
        name: 'Boots of the Winterlands',
        family: 'boots_of_the_winterlands',
        slot: 'feet',
        rarity: 'uncommon',
        attunement: true,
        passives: [
          { type: 'resistance', damageType: 'cold' },
          { type: 'ignoreHazard', hazard: 'ice' },
        ],
        description: 'Furred boots that give resistance to cold damage and sure footing on ice.',
      }),
    ]),
  );
  // The SRD ring stops Paralyzed/Restrained only from magic; here it blocks both conditions from every source.
  families.push(
    fam('ring_of_free_action', 'Ring of Free Action', [
      wondrous({
        id: 'ring_of_free_action',
        name: 'Ring of Free Action',
        family: 'ring_of_free_action',
        slot: 'ring',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'conditionImmunity', condition: 'paralyzed' },
          { type: 'conditionImmunity', condition: 'restrained' },
        ],
        description: 'A ring that makes the wearer immune to being paralyzed or restrained.',
      }),
    ]),
  );
  families.push(
    fam('cloak_of_arachnida', 'Cloak of Arachnida', [
      wondrous({
        id: 'cloak_of_arachnida',
        name: 'Cloak of Arachnida',
        family: 'cloak_of_arachnida',
        slot: 'cloak',
        rarity: 'veryRare',
        attunement: true,
        passives: [
          { type: 'resistance', damageType: 'poison' },
          { type: 'castSpell', spellId: 'web', charges: 1, saveDc: 13 },
        ],
        description: 'A silk cloak that gives poison resistance and can spin a web (DC 13) once per long rest.',
      }),
    ]),
  );

  // Wands and staffs (no slot: they work from the pack)
  const regain1d6p1 = avgRoll(1, 6, 1); // 5
  families.push(
    fam('wand_of_magic_missiles', 'Wand of Magic Missiles', [
      wondrous({
        id: 'wand_of_magic_missiles',
        name: 'Wand of Magic Missiles',
        family: 'wand_of_magic_missiles',
        rarity: 'uncommon',
        attunement: false,
        passives: [{ type: 'castSpell', spellId: 'magic_missile', charges: regain1d6p1 }],
        description: `A wand that casts Magic Missile, ${regain1d6p1} times per long rest.`,
      }),
    ]),
  );
  families.push(
    fam('wand_of_fireballs', 'Wand of Fireballs', [
      wondrous({
        id: 'wand_of_fireballs',
        name: 'Wand of Fireballs',
        family: 'wand_of_fireballs',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'castSpell', spellId: 'fireball', charges: regain1d6p1, saveDc: 15 }],
        description: `A wand that casts Fireball (DC 15), ${regain1d6p1} times per long rest.`,
      }),
    ]),
  );
  families.push(
    fam('wand_of_lightning_bolts', 'Wand of Lightning Bolts', [
      wondrous({
        id: 'wand_of_lightning_bolts',
        name: 'Wand of Lightning Bolts',
        family: 'wand_of_lightning_bolts',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'castSpell', spellId: 'lightning_bolt', charges: regain1d6p1, saveDc: 15 }],
        description: `A wand that casts Lightning Bolt (DC 15), ${regain1d6p1} times per long rest.`,
      }),
    ]),
  );
  families.push(
    fam('wand_of_web', 'Wand of Web', [
      wondrous({
        id: 'wand_of_web',
        name: 'Wand of Web',
        family: 'wand_of_web',
        rarity: 'uncommon',
        attunement: true,
        passives: [{ type: 'castSpell', spellId: 'web', charges: regain1d6p1, saveDc: 13 }],
        description: `A wand that casts Web (DC 13), ${regain1d6p1} times per long rest.`,
      }),
    ]),
  );
  // Hold Person costs 2 charges: floor(5 / 2) = 2 casts. Hold Monster (5 charges) is not offered.
  families.push(
    fam('wand_of_binding', 'Wand of Binding', [
      wondrous({
        id: 'wand_of_binding',
        name: 'Wand of Binding',
        family: 'wand_of_binding',
        rarity: 'rare',
        attunement: true,
        passives: [{ type: 'castSpell', spellId: 'hold_person', charges: Math.floor(regain1d6p1 / 2), saveDc: 17 }],
        description: 'A wand that casts Hold Person (DC 17) twice per long rest.',
      }),
    ]),
  );
  // 8 charges: Cure Wounds at 1 charge each (3 casts) leaves 5 for one Mass Cure Wounds.
  families.push(
    fam('staff_of_healing', 'Staff of Healing', [
      wondrous({
        id: 'staff_of_healing',
        name: 'Staff of Healing',
        family: 'staff_of_healing',
        rarity: 'rare',
        attunement: true,
        passives: [
          { type: 'castSpell', spellId: 'cure_wounds', charges: 3 },
          { type: 'castSpell', spellId: 'mass_cure_wounds', charges: 1 },
        ],
        description: 'A staff that casts Cure Wounds three times and Mass Cure Wounds once per long rest.',
      }),
    ]),
  );
  // 8 charges: Burning Hands 1 + Fireball 3 + Wall of Fire 4 = 8 exactly, one cast each.
  families.push(
    fam('staff_of_fire', 'Staff of Fire', [
      wondrous({
        id: 'staff_of_fire',
        name: 'Staff of Fire',
        family: 'staff_of_fire',
        rarity: 'veryRare',
        attunement: true,
        passives: [
          { type: 'resistance', damageType: 'fire' },
          { type: 'castSpell', spellId: 'burning_hands', charges: 1 },
          { type: 'castSpell', spellId: 'fireball', charges: 1 },
          { type: 'castSpell', spellId: 'wall_of_fire', charges: 1 },
        ],
        description: 'A staff that gives fire resistance and casts Burning Hands, Fireball and Wall of Fire once each per long rest.',
      }),
    ]),
  );
  // 8 charges: Cone of Cold 5 + Ice Storm 4 = 9, one cast each (Fog Cloud and Wall of Ice are not offered).
  families.push(
    fam('staff_of_frost', 'Staff of Frost', [
      wondrous({
        id: 'staff_of_frost',
        name: 'Staff of Frost',
        family: 'staff_of_frost',
        rarity: 'veryRare',
        attunement: true,
        passives: [
          { type: 'resistance', damageType: 'cold' },
          { type: 'castSpell', spellId: 'cone_of_cold', charges: 1 },
          { type: 'castSpell', spellId: 'ice_storm', charges: 1 },
        ],
        description: 'A staff that gives cold resistance and casts Cone of Cold and Ice Storm once each per long rest.',
      }),
    ]),
  );
  families.push(
    fam('circlet_of_blasting', 'Circlet of Blasting', [
      wondrous({
        id: 'circlet_of_blasting',
        name: 'Circlet of Blasting',
        family: 'circlet_of_blasting',
        slot: 'head',
        rarity: 'uncommon',
        attunement: false,
        passives: [{ type: 'castSpell', spellId: 'scorching_ray', charges: 1, attackBonus: 5 }],
        description: 'A circlet that casts Scorching Ray (+5 to hit) once per long rest.',
      }),
    ]),
  );

  // Timed consumables (see timedConsumable).
  families.push(fam('potion_of_resistance', 'Potion of Resistance', potionsOfResistance()));
  families.push(fam('potion_of_giant_strength', 'Potion of Giant Strength', potionsOfGiantStrength()));
  families.push(
    fam('potion_of_invulnerability', 'Potion of Invulnerability', [
      timedConsumable({
        id: 'potion_of_invulnerability',
        name: 'Potion of Invulnerability',
        family: 'potion_of_invulnerability',
        rarity: 'rare',
        fights: 1,
        passives: ALL_DAMAGE_TYPES.map((t): PassiveEffect => ({ type: 'resistance', damageType: t })),
        description: 'A syrupy draught that gives resistance to all damage for the next fight.',
      }),
    ]),
  );
  // The SRD potion is Haste: here a +6 cell speed bonus (doubling a 6-cell speed); the extra action and AC bonus are not modelled.
  families.push(
    fam('potion_of_speed', 'Potion of Speed', [
      timedConsumable({
        id: 'potion_of_speed',
        name: 'Potion of Speed',
        family: 'potion_of_speed',
        rarity: 'veryRare',
        fights: 1,
        passives: [{ type: 'speedBonus', cells: 6 }],
        description: 'A swirling yellow draught that doubles your movement for the next fight.',
      }),
    ]),
  );
  families.push(
    fam('potion_of_flying', 'Potion of Flying', [
      timedConsumable({
        id: 'potion_of_flying',
        name: 'Potion of Flying',
        family: 'potion_of_flying',
        rarity: 'veryRare',
        fights: 3,
        hover: true,
        passives: [{ type: 'flight' }],
        description: 'A draught that lets you fly and hover for the next 3 fights.',
      }),
    ]),
  );
  // Potion of Heroism (Rare): 10 Temporary Hit Points and the Bless spell for 1 hour (3 fights; the hit points come once).
  families.push(
    fam('potion_of_heroism', 'Potion of Heroism', [
      timedConsumable({
        id: 'potion_of_heroism',
        name: 'Potion of Heroism',
        family: 'potion_of_heroism',
        rarity: 'rare',
        fights: 3,
        passives: [{ type: 'tempHp', amount: 10 }, { type: 'bless' }],
        description: 'A steaming blue potion: 10 temporary hit points now, and 1d4 added to your attack rolls and saves for the next 3 fights.',
      }),
    ]),
  );
  // ORIGINAL items (not in the SRD): SRD buff and defense spells in a bottle, for a party with no full caster. Each does
  // what the spell does, without concentration; "10 minutes" is 1 fight and "1 hour" or more is 3, as for the potions above.
  families.push(fam('spell_potion', null, spellPotions()));
  // Oil of Slipperiness: Freedom of Movement for 8 hours (3 fights); the grease-on-the-ground use is not modelled.
  families.push(
    fam('oil_of_slipperiness', 'Oil of Slipperiness', [
      timedConsumable({
        id: 'oil_of_slipperiness',
        name: 'Oil of Slipperiness',
        family: 'oil_of_slipperiness',
        rarity: 'uncommon',
        fights: 3,
        passives: [
          { type: 'conditionImmunity', condition: 'paralyzed' },
          { type: 'conditionImmunity', condition: 'restrained' },
        ],
        description: 'A slick black unguent that stops you being paralyzed or restrained for the next 3 fights.',
      }),
    ]),
  );

  // ORIGINAL (not in the SRD): weapons of slaying for other creature types.
  families.push(fam('bane_weapon', null, baneWeapons()));

  return families;
}

export const MAGIC_FAMILIES: MagicFamily[] = build();

/** Every magic item defined here. The ORIGINAL ones are listed in ORIGINAL_ITEM_IDS. */
export const MAGIC_ITEMS: ItemDef[] = MAGIC_FAMILIES.flatMap((f) => f.items);

/** Ids of items that are not in the SRD (the "bane" weapons). */
export const ORIGINAL_ITEM_IDS: Set<string> = new Set(
  MAGIC_FAMILIES.filter((f) => f.srdName === null).flatMap((f) => f.items.map((i) => i.id)),
);

import { describe, it, expect } from 'vitest';
import { ITEMS } from './items';
import { SPELLS } from './spells';
import { MAGIC_FAMILIES, MAGIC_ITEMS, ORIGINAL_ITEM_IDS, BANE_TYPES, RARITY_PRICE, FAMILY_FACTOR } from './magicItems';
import type { Ability, Condition, CreatureType, DamageType, ItemRarity, PassiveEffect, WornSlot } from '../core/types';

const DICE_RE = /^\d+(d\d+)?([+-]\d+)?$/;

const DAMAGE_TYPES: DamageType[] = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];
const CONDITIONS: Condition[] = [
  'blinded', 'charmed', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'dodging', 'disengaged',
];
const CREATURE_TYPES: CreatureType[] = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
];
const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLOTS: WornSlot[] = ['head', 'neck', 'cloak', 'hands', 'wrists', 'belt', 'feet', 'ring'];
const RARITIES: ItemRarity[] = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
const HAZARDS = ['fall', 'lava', 'water', 'ice', 'fire', 'spikes'];

/** Expected items per family: a generator change cannot silently drop items. */
const EXPECTED_COUNTS: Record<string, number> = {
  ring_of_resistance: 10,
  armor_of_resistance: 70,
  gauntlets_of_ogre_power: 1,
  belt_of_giant_strength: 6,
  headband_of_intellect: 1,
  amulet_of_health: 1,
  belt_of_dwarvenkind: 1,
  ioun_stone: 8,
  periapt_of_proof_against_poison: 1,
  ring_of_protection: 1,
  cloak_of_protection: 1,
  bracers_of_defense: 1,
  cloak_of_displacement: 1,
  adamantine_armor: 8,
  mithral_armor: 6,
  elven_chain: 2,
  dwarven_plate: 2,
  glamoured_studded_leather: 1,
  dragon_scale_mail: 10,
  armor_of_invulnerability: 1,
  sentinel_shield: 1,
  shield_of_the_cavalier: 1,
  brooch_of_shielding: 1,
  periapt_of_wound_closure: 1,
  scarab_of_protection: 1,
  stone_of_good_luck: 1,
  dragon_slayer: 6,
  giant_slayer: 6,
  vicious_weapon: 6,
  weapon_of_warning: 6,
  flame_tongue: 5,
  frost_brand: 6,
  sword_of_wounding: 6,
  mace_of_disruption: 1,
  ring_of_feather_falling: 1,
  ring_of_water_walking: 1,
  boots_of_the_winterlands: 1,
  ring_of_free_action: 1,
  cloak_of_arachnida: 1,
  wand_of_magic_missiles: 1,
  wand_of_fireballs: 1,
  wand_of_lightning_bolts: 1,
  wand_of_web: 1,
  wand_of_binding: 1,
  staff_of_healing: 1,
  staff_of_fire: 1,
  staff_of_frost: 1,
  circlet_of_blasting: 1,
  potion_of_resistance: 10,
  potion_of_giant_strength: 6,
  potion_of_invulnerability: 1,
  potion_of_speed: 1,
  potion_of_flying: 1,
  oil_of_slipperiness: 1,
  bane_weapon: 72,
};

/** The SRD item names transcribed (one per SRD family). A typo here or in the data fails. */
const SRD_NAMES = [
  'Ring of Resistance', 'Armor of Resistance', 'Gauntlets of Ogre Power', 'Belt of Giant Strength', 'Headband of Intellect',
  'Amulet of Health', 'Belt of Dwarvenkind', 'Ioun Stone', 'Periapt of Proof against Poison', 'Ring of Protection',
  'Cloak of Protection', 'Bracers of Defense', 'Cloak of Displacement', 'Adamantine Armor', 'Mithral Armor', 'Elven Chain',
  'Dwarven Plate', 'Glamoured Studded Leather', 'Dragon Scale Mail', 'Armor of Invulnerability', 'Sentinel Shield',
  'Shield of the Cavalier', 'Brooch of Shielding', 'Periapt of Wound Closure', 'Scarab of Protection',
  'Stone of Good Luck (Luckstone)', 'Dragon Slayer', 'Giant Slayer', 'Vicious Weapon', 'Weapon of Warning', 'Flame Tongue',
  'Frost Brand', 'Sword of Wounding', 'Mace of Disruption', 'Ring of Feather Falling', 'Ring of Water Walking',
  'Boots of the Winterlands', 'Ring of Free Action', 'Cloak of Arachnida', 'Wand of Magic Missiles', 'Wand of Fireballs',
  'Wand of Lightning Bolts', 'Wand of Web', 'Wand of Binding', 'Staff of Healing', 'Staff of Fire', 'Staff of Frost',
  'Circlet of Blasting', 'Potion of Resistance', 'Potion of Giant Strength', 'Potion of Invulnerability', 'Potion of Speed',
  'Potion of Flying', 'Oil of Slipperiness',
];

const byId = new Map(MAGIC_ITEMS.map((i) => [i.id, i] as const));
const spellIds = new Set(SPELLS.map((s) => s.id));
const mundane = new Map(ITEMS.map((i) => [i.id, i] as const));

function checkPassive(id: string, p: PassiveEffect): void {
  switch (p.type) {
    case 'acBonus':
      expect(p.amount, `${id} acBonus`).toBeGreaterThanOrEqual(1);
      expect(p.amount, `${id} acBonus`).toBeLessThanOrEqual(3);
      break;
    case 'unarmoredAcBonus':
      expect(p.amount, `${id} unarmoredAcBonus`).toBeGreaterThanOrEqual(1);
      expect(p.amount, `${id} unarmoredAcBonus`).toBeLessThanOrEqual(3);
      break;
    case 'saveBonus':
      expect(p.amount, `${id} saveBonus`).toBeGreaterThanOrEqual(1);
      expect(p.amount, `${id} saveBonus`).toBeLessThanOrEqual(3);
      break;
    case 'setAbility':
      expect(ABILITIES, id).toContain(p.ability);
      expect(p.score, `${id} setAbility`).toBeGreaterThanOrEqual(3);
      expect(p.score, `${id} setAbility`).toBeLessThanOrEqual(30);
      break;
    case 'abilityBonus':
      expect(ABILITIES, id).toContain(p.ability);
      expect(p.amount, `${id} abilityBonus`).toBeGreaterThanOrEqual(1);
      if (p.max !== undefined) {
        expect(p.max, `${id} abilityBonus max`).toBeLessThanOrEqual(30);
      }
      break;
    case 'resistance':
    case 'immunity':
      expect(DAMAGE_TYPES, id).toContain(p.damageType);
      break;
    case 'conditionImmunity':
      expect(CONDITIONS, id).toContain(p.condition);
      break;
    case 'speedBonus':
      expect(p.cells).toBeGreaterThan(0);
      break;
    case 'maxHpBonus':
      expect((p.flat ?? 0) + (p.perLevel ?? 0), id).toBeGreaterThan(0);
      break;
    case 'flight':
    case 'initiativeAdvantage':
    case 'critImmunity':
    case 'displacement':
    case 'doubleHitDiceHealing':
      break;
    case 'regeneration':
      expect(p.amount).toBeGreaterThan(0);
      break;
    case 'ignoreHazard':
      expect(HAZARDS, id).toContain(p.hazard);
      break;
    case 'weaponDamage':
      expect(p.dice, `${id} weaponDamage`).toMatch(DICE_RE);
      if (p.damageType) expect(DAMAGE_TYPES, id).toContain(p.damageType);
      for (const v of p.versus ?? []) expect(CREATURE_TYPES, id).toContain(v);
      break;
    case 'weaponCritDamage':
      expect(p.dice).toMatch(DICE_RE);
      if (p.damageType) expect(DAMAGE_TYPES, id).toContain(p.damageType);
      break;
    case 'critRange':
      expect(p.from).toBeGreaterThanOrEqual(2);
      expect(p.from).toBeLessThanOrEqual(20);
      break;
    case 'castSpell':
      expect(spellIds.has(p.spellId), `${id}: spell ${p.spellId} exists`).toBe(true);
      expect(Number.isInteger(p.charges) && p.charges >= 1, `${id} charges`).toBe(true);
      break;
    default: {
      const never: never = p;
      throw new Error(`unknown passive ${JSON.stringify(never)} on ${id}`);
    }
  }
}

describe('magic item catalog', () => {
  it('has unique ids, among themselves and against ITEMS', () => {
    const ids = MAGIC_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(mundane.has(id), `${id} clashes with items.ts`).toBe(false);
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('has the expected number of items in each family', () => {
    const actual: Record<string, number> = {};
    for (const f of MAGIC_FAMILIES) actual[f.key] = f.items.length;
    expect(actual).toEqual(EXPECTED_COUNTS);
    const total = Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0);
    expect(MAGIC_ITEMS.length).toBe(total);
  });

  it('transcribes exactly the listed SRD item names', () => {
    const names = MAGIC_FAMILIES.filter((f) => f.srdName !== null).map((f) => f.srdName);
    expect([...names].sort()).toEqual([...SRD_NAMES].sort());
    for (const f of MAGIC_FAMILIES) {
      if (f.srdName !== null && f.items.length === 1) {
        expect(f.items[0]?.name).toBe(f.srdName);
      }
    }
  });

  it('gives every item a rarity, description, and effect', () => {
    for (const i of MAGIC_ITEMS) {
      expect(i.rarity, i.id).toBeDefined();
      expect(RARITIES).toContain(i.rarity);
      expect(i.rarity).not.toBe('common');
      expect(i.description.length, `${i.id} description`).toBeGreaterThan(10);
      expect(i.name.length).toBeGreaterThan(0);
      if (i.kind === 'wondrous') expect(i.icon).toBeUndefined();
      if (i.kind === 'consumable') expect(i.icon).toBe('potion');
      const isMithral = i.id.startsWith('mithral_');
      const timedPassives = i.consumable?.effect === 'timed' ? i.consumable.passives : [];
      const hasEffect = (i.passives?.length ?? 0) > 0 || timedPassives.length > 0 || i.magicBonus !== undefined;
      expect(hasEffect || isMithral, `${i.id} has passives or magicBonus`).toBe(true);
      if (i.magicBonus !== undefined) {
        expect([1, 2, 3]).toContain(i.magicBonus);
      }
      if (i.kind === 'consumable') expect(i.attunement, i.id).toBeUndefined();
      else expect(typeof i.attunement, `${i.id} attunement`).toBe('boolean');
    }
  });

  it('has structurally valid passives', () => {
    for (const i of MAGIC_ITEMS) {
      for (const p of i.passives ?? []) checkPassive(i.id, p);
      if (i.consumable?.effect === 'timed') {
        expect(i.consumable.fights === 1 || i.consumable.fights === 3, `${i.id} fights`).toBe(true);
        for (const p of i.consumable.passives) checkPassive(i.id, p);
      }
    }
  });

  it('puts worn items in a slot and keeps arms on their base', () => {
    for (const i of MAGIC_ITEMS) {
      if (i.kind === 'consumable') {
        expect(i.consumable?.effect, i.id).toBe('timed');
        expect(i.weapon, i.id).toBeUndefined();
        expect(i.armor, i.id).toBeUndefined();
        expect(i.slot, i.id).toBeUndefined();
        continue;
      }
      if (i.kind === 'wondrous') {
        expect(i.weapon, i.id).toBeUndefined();
        expect(i.armor, i.id).toBeUndefined();
        const hasSpell = (i.passives ?? []).some((p) => p.type === 'castSpell');
        const packItem = hasSpell || i.id === 'stone_of_good_luck';
        if (i.slot === undefined) {
          expect(packItem, `${i.id} needs a slot`).toBe(true);
        } else {
          expect(SLOTS).toContain(i.slot);
        }
      } else {
        expect(i.slot, i.id).toBeUndefined();
        expect(i.baseId, i.id).toBeDefined();
        const base = mundane.get(i.baseId as string);
        expect(base, `${i.id} base`).toBeDefined();
        expect(base?.kind).toBe(i.kind);
      }
      if (i.kind === 'weapon') {
        const base = mundane.get(i.baseId as string);
        expect(i.weapon).toEqual(base?.weapon);
        expect(i.weapon).not.toBe(base?.weapon);
        expect(i.weapon?.damage).not.toBe(base?.weapon?.damage);
      }
      if (i.kind === 'armor') {
        const base = mundane.get(i.baseId as string);
        expect(i.armor).not.toBe(base?.armor);
        if (i.id.startsWith('mithral_')) {
          const expected = { ...base?.armor };
          delete expected.strRequirement;
          delete expected.stealthDisadvantage;
          expect(i.armor).toEqual(expected);
        } else {
          expect(i.armor).toEqual(base?.armor);
        }
      }
      if (i.kind === 'shield') {
        const base = mundane.get(i.baseId as string);
        expect(i.shieldBonus).toBe(base?.shieldBonus);
      }
    }
  });

  it('prices every item, rising with rarity within a family', () => {
    for (const i of MAGIC_ITEMS) {
      expect(i.cost, i.id).toBeGreaterThan(0);
    }
    for (const f of MAGIC_FAMILIES) {
      const factor = FAMILY_FACTOR[f.key] ?? 1;
      expect(factor, f.key).toBeGreaterThanOrEqual(0.5);
      expect(factor, f.key).toBeLessThanOrEqual(2);
      for (const a of f.items) {
        for (const b of f.items) {
          if (RARITIES.indexOf(a.rarity as ItemRarity) < RARITIES.indexOf(b.rarity as ItemRarity)) {
            expect(a.cost, `${a.id} < ${b.id}`).toBeLessThan(b.cost);
          }
        }
      }
    }
    // Spot-check the house table on unarmed, unbased items.
    expect(RARITY_PRICE).toEqual({ uncommon: 400, rare: 1500, veryRare: 5000, legendary: 15000 });
    expect(byId.get('gauntlets_of_ogre_power')?.cost).toBe(400);
    expect(byId.get('ring_of_protection')?.cost).toBe(1500);
    expect(byId.get('belt_of_giant_strength_storm')?.cost).toBe(15000);
  });
});

describe('SRD values', () => {
  const p = (id: string): PassiveEffect[] => byId.get(id)?.passives ?? [];

  it('matches the belt table', () => {
    const expected: Record<string, [number, ItemRarity]> = {
      hill: [21, 'rare'],
      frost: [23, 'veryRare'],
      stone: [23, 'veryRare'],
      fire: [25, 'veryRare'],
      cloud: [27, 'legendary'],
      storm: [29, 'legendary'],
    };
    for (const [k, [score, rarity]] of Object.entries(expected)) {
      const item = byId.get(`belt_of_giant_strength_${k}`);
      expect(item?.rarity).toBe(rarity);
      expect(item?.attunement).toBe(true);
      expect(item?.slot).toBe('belt');
      expect(p(item?.id ?? '')).toEqual([{ type: 'setAbility', ability: 'str', score }]);
    }
  });

  it('matches score and protection items', () => {
    expect(p('gauntlets_of_ogre_power')).toEqual([{ type: 'setAbility', ability: 'str', score: 19 }]);
    expect(p('headband_of_intellect')).toEqual([{ type: 'setAbility', ability: 'int', score: 19 }]);
    expect(p('amulet_of_health')).toEqual([{ type: 'setAbility', ability: 'con', score: 19 }]);
    expect(byId.get('amulet_of_health')?.rarity).toBe('rare');
    expect(byId.get('gauntlets_of_ogre_power')?.rarity).toBe('uncommon');
    expect(byId.get('cloak_of_protection')?.rarity).toBe('uncommon');
    expect(byId.get('ring_of_protection')?.rarity).toBe('rare');
    expect(p('bracers_of_defense')).toEqual([{ type: 'unarmoredAcBonus', amount: 2 }]);
    expect(byId.get('ring_of_resistance_fire')?.attunement).toBe(false);
    expect(byId.get('plate_of_resistance_fire')?.attunement).toBe(true);
    expect(byId.get('adamantine_plate')?.attunement).toBe(false);
    expect(byId.get('adamantine_hide')).toBeUndefined();
    expect(byId.get('ring_of_feather_falling')?.rarity).toBe('rare');
    expect(byId.get('ring_of_water_walking')?.attunement).toBe(false);
  });

  it('matches Dragon Slayer and Giant Slayer', () => {
    for (const i of MAGIC_ITEMS.filter((x) => x.id.startsWith('dragon_slayer_'))) {
      expect(i.magicBonus).toBe(1);
      expect(i.rarity).toBe('rare');
      expect(i.attunement).toBe(false);
      expect(i.passives).toEqual([{ type: 'weaponDamage', dice: '3d6', versus: ['dragon'] }]);
    }
    for (const i of MAGIC_ITEMS.filter((x) => x.id.startsWith('giant_slayer_'))) {
      expect(i.magicBonus).toBe(1);
      expect(i.passives).toEqual([{ type: 'weaponDamage', dice: '2d6', versus: ['giant'] }]);
    }
  });

  it('uses valid spells and printed save DCs on wands', () => {
    expect(p('wand_of_fireballs')).toEqual([{ type: 'castSpell', spellId: 'fireball', charges: 5, saveDc: 15 }]);
    expect(p('wand_of_web')).toEqual([{ type: 'castSpell', spellId: 'web', charges: 5, saveDc: 13 }]);
    expect(p('wand_of_binding')).toEqual([{ type: 'castSpell', spellId: 'hold_person', charges: 2, saveDc: 17 }]);
    expect(p('circlet_of_blasting')).toEqual([{ type: 'castSpell', spellId: 'scorching_ray', charges: 1, attackBonus: 5 }]);
  });
});

describe('timed consumables', () => {
  const c = (id: string) => byId.get(id)?.consumable;
  it('matches the SRD potions', () => {
    expect(c('potion_of_giant_strength_storm')).toEqual({ effect: 'timed', fights: 3, passives: [{ type: 'setAbility', ability: 'str', score: 29 }] });
    expect(byId.get('potion_of_giant_strength_fire')?.rarity).toBe('rare');
    expect(byId.get('potion_of_giant_strength_hill')?.rarity).toBe('uncommon');
    expect(byId.get('potion_of_resistance_fire')?.cost).toBe(200);
    expect(c('potion_of_invulnerability')).toMatchObject({ fights: 1 });
    const inv = c('potion_of_invulnerability');
    expect(inv?.effect === 'timed' ? inv.passives.length : 0).toBe(13);
    expect(c('potion_of_flying')).toEqual({ effect: 'timed', fights: 3, hover: true, passives: [{ type: 'flight' }] });
  });
});

describe('ORIGINAL items', () => {
  it('are flagged, separate from the SRD, and follow the Dragon Slayer formula', () => {
    expect(ORIGINAL_ITEM_IDS.size).toBe(BANE_TYPES.length * 6);
    expect(BANE_TYPES).not.toContain('dragon');
    expect(BANE_TYPES).not.toContain('giant');
    const srdNames = new Set(SRD_NAMES);
    const dragon = byId.get('dragon_slayer_longsword');
    for (const id of ORIGINAL_ITEM_IDS) {
      const i = byId.get(id);
      expect(i, id).toBeDefined();
      expect(srdNames.has(i?.name ?? ''), `${id} must not take an SRD name`).toBe(false);
      expect(i?.magicBonus).toBe(1);
      expect(i?.rarity).toBe(dragon?.rarity);
      expect(i?.attunement).toBe(false);
      const eff = i?.passives?.[0];
      expect(eff?.type).toBe('weaponDamage');
      if (eff?.type === 'weaponDamage') {
        expect(eff.dice).toBe('3d6');
        expect(eff.versus?.length).toBe(1);
      }
    }
    expect(byId.get('undeadbane_longsword')?.name).toBe('Undeadbane Longsword');
    expect(ORIGINAL_ITEM_IDS.has('dragon_slayer_longsword')).toBe(false);
  });

  it('keeps SRD items out of the original set', () => {
    for (const f of MAGIC_FAMILIES) {
      for (const i of f.items) {
        expect(ORIGINAL_ITEM_IDS.has(i.id), i.id).toBe(f.srdName === null);
      }
    }
  });
});

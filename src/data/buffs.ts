import type { ItemRarity, PassiveEffect } from '../core/types';

/**
 * Buff and defense spells as data: what the spell does to the creature it is on, written once.
 *
 * Two things use an entry:
 *  - a potion (src/data/magicItems.ts builds "Potion of <name>" from it: the effects last `fights` fights, no concentration);
 *  - a spell cast in combat: an action with the effect token `buff:<id>` puts the same effects on its target, and ends
 *    them when the caster's concentration ends if `concentration` is true (see applyBuff in src/rules/combat.ts).
 * So a caster needs only a spell action carrying `buff:<id>`; nothing here is specific to potions.
 *
 * Effects follow the SRD 5.2.1 spell. `fights` turns the spell's duration into fights: up to 10 minutes is 1, an hour or
 * more is 3. What a spell does that the engine cannot express is noted on the entry.
 */
export interface BuffDef {
  id: string;
  /** The spell's name. */
  name: string;
  /** Spell level in the SRD. */
  level: number;
  /** True if the SRD spell needs concentration (a cast spell then ends with the caster's concentration). */
  concentration: boolean;
  /** How long a potion of it lasts, in fights. */
  fights: number;
  passives: PassiveEffect[];
  /** One sentence for the player; the potion adds how long it lasts. */
  summary: string;
  /** Rarity and whether a potion of it exists. Omitted: the spell is for casters only. */
  potion?: { rarity: ItemRarity; srdName?: string };
}

const b = (d: BuffDef): BuffDef => d;

export const BUFFS: Record<string, BuffDef> = Object.fromEntries(
  [
    b({ id: 'bless', name: 'Bless', level: 1, concentration: true, fights: 1, passives: [{ type: 'bless' }], summary: 'Adds 1d4 to your attack rolls and saving throws.', potion: { rarity: 'uncommon' } }),
    b({ id: 'shield_of_faith', name: 'Shield of Faith', level: 1, concentration: true, fights: 1, passives: [{ type: 'acBonus', amount: 2 }], summary: 'A shimmering field gives +2 Armor Class.', potion: { rarity: 'uncommon' } }),
    // 2d4 + 4 Temporary Hit Points; the average is given.
    b({ id: 'false_life', name: 'False Life', level: 1, concentration: false, fights: 1, passives: [{ type: 'tempHp', amount: 9 }], summary: 'Gives 9 temporary hit points.', potion: { rarity: 'uncommon' } }),
    b({ id: 'longstrider', name: 'Longstrider', level: 1, concentration: false, fights: 3, passives: [{ type: 'speedBonus', cells: 2 }], summary: 'Adds 10 ft to your speed.', potion: { rarity: 'uncommon' } }),
    // Not kept: the guard against being charmed, frightened or possessed by those creatures.
    b({ id: 'protection', name: 'Protection from Evil and Good', level: 1, concentration: true, fights: 1, passives: [{ type: 'wardVersus', versus: ['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead'] }], summary: 'Aberrations, celestials, elementals, fey, fiends and undead attack you with disadvantage.', potion: { rarity: 'uncommon' } }),
    b({ id: 'aid', name: 'Aid', level: 2, concentration: false, fights: 3, passives: [{ type: 'maxHpBonus', flat: 5 }], summary: 'Raises your hit points and their maximum by 5.', potion: { rarity: 'uncommon' } }),
    b({ id: 'blur', name: 'Blur', level: 2, concentration: true, fights: 1, passives: [{ type: 'attackersDisadvantage' }], summary: 'Your outline wavers: attacks against you have disadvantage.', potion: { rarity: 'uncommon' } }),
    // Armor Class cannot be less than 17.
    b({ id: 'barkskin', name: 'Barkskin', level: 2, concentration: false, fights: 3, passives: [{ type: 'minimumAc', ac: 17 }], summary: 'Your skin is bark: your Armor Class is at least 17.', potion: { rarity: 'uncommon' } }),
    // Size grows one category, advantage on Strength saves (and checks, which the engine does not roll), +1d4 weapon
    // damage. Not kept: the larger space and reach; the creature is drawn half again as big. This is the SRD Potion of Growth.
    b({ id: 'enlarge', name: 'Enlarge', level: 2, concentration: true, fights: 1, passives: [{ type: 'sizeUp' }, { type: 'bonusWeaponDice', dice: '1d4' }, { type: 'saveAdvantage', ability: 'str' }], summary: 'You grow huge: +1d4 damage with weapons and advantage on Strength saves.', potion: { rarity: 'uncommon', srdName: 'Potion of Growth' } }),
    // Speed doubled, +2 AC, advantage on Dexterity saves, one extra weapon attack each turn (the SRD's extra action,
    // which may also be Dash, Disengage, Hide or Utilize). Not kept: the lethargy when it ends. This is the SRD Potion of Speed.
    b({ id: 'haste', name: 'Haste', level: 3, concentration: true, fights: 1, passives: [{ type: 'speedMultiplier', factor: 2 }, { type: 'acBonus', amount: 2 }, { type: 'saveAdvantage', ability: 'dex' }, { type: 'extraAttack' }], summary: 'Doubled speed, +2 Armor Class, advantage on Dexterity saves and one extra weapon attack each turn.', potion: { rarity: 'veryRare', srdName: 'Potion of Speed' } }),
    // Warm shield: resistance to cold; a creature that hits you with a melee attack takes 2d8 fire. (The chill shield is the mirror image and is not offered.)
    b({ id: 'fire_shield', name: 'Fire Shield', level: 4, concentration: false, fights: 1, passives: [{ type: 'resistance', damageType: 'cold' }, { type: 'retaliate', dice: '2d8', damageType: 'fire' }], summary: 'Flames wreathe you: resistance to cold, and a creature that hits you in melee takes 2d8 fire damage.', potion: { rarity: 'rare' } }),
    b({ id: 'stoneskin', name: 'Stoneskin', level: 4, concentration: true, fights: 3, passives: [{ type: 'resistance', damageType: 'bludgeoning' }, { type: 'resistance', damageType: 'piercing' }, { type: 'resistance', damageType: 'slashing' }], summary: 'Skin hard as stone: half damage from bludgeoning, piercing and slashing.', potion: { rarity: 'rare' } }),
  ].map((d) => [d.id, d]),
);

export const getBuff = (id: string): BuffDef | undefined => BUFFS[id];

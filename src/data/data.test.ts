import { describe, it, expect } from 'vitest';
import { MAGIC_ACTION_NAMES, MONSTERS } from './monsters';
import { ITEMS } from './items';
import type { ActionDef, MonsterDef, ThemeId, TraitId } from '../core/types';

const TRAIT_IDS: TraitId[] = [
  'packTactics',
  'undeadFortitude',
  'sunlightSensitivity',
  'nimbleEscape',
  'aggressive',
  'spiderClimb',
  'amorphous',
  'keenSenses',
];

const THEMES: ThemeId[] = ['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library', 'foundry', 'ice', 'ruin', 'hell', 'lair', 'forest', 'marsh', 'peaks'];

const MONSTER_IDS = [
  'young_brass_dragon',
  'young_copper_dragon',
  'young_bronze_dragon',
  'young_silver_dragon',
  'young_gold_dragon',
  'adult_silver_dragon',
  'ancient_white_dragon',
  'incubus',
  'lamia',
  'spirit_naga',
  'efreeti',
  'djinni',
  'sphinx_of_lore',
  'rakshasa',
  'ice_devil',
  'mummy_lord',
  'purple_worm',
  'iron_golem',
  'pit_fiend',
  'lich',

  'giant_rat',
  'goblin_minion',
  'goblin_warrior',
  'wolf',
  'goblin_boss',
  'skeleton',
  'zombie',
  'shadow',
  'ghoul',
  'giant_spider',
  'bugbear_warrior',
  'ogre',
  'giant_frog',
  'gray_ooze',
  'giant_toad',
  'ochre_jelly',
  'wererat',
  'giant_constrictor_snake',
  'gelatinous_cube',
  'green_hag',
  'violet_fungus',
  'grick',
  'gibbering_mouther',
  'chuul',
  'ettercap',
  'darkmantle',
  'shambling_mound',
  'scout',
  'bandit_captain',
  'berserker',
  'warrior_veteran',
  'tough_boss',
  'priest',
  'hobgoblin_captain',
  'gladiator',
  'pirate',
  'death_dog',
  'ghast',
  'gargoyle',
  'rug_of_smothering',
  'wight',
  'doppelganger',
  'mage',
  'mummy',
  'ghost',
  'shield_guardian',
  'magma_mephit',
  'animated_armor',
  'azer_sentinel',
  'hell_hound',
  'red_dragon_wyrmling',
  'gorgon',
  'salamander',
  'fire_elemental',
  'earth_elemental',
  'flesh_golem',
  'stone_giant',
  'fire_giant',
  'clay_golem',
  'hobgoblin_warrior',
  'worg',
  'dire_wolf',
  'bugbear_stalker',
  'ettin',
  'troll',
  'hill_giant',
  'oni',
  'phase_spider',
  'basilisk',
  'manticore',
  'roper',
  'xorn',
  'bulette',
  'drider',
  'chimera',
  'cloaker',
  'behir',
  'specter',
  'minotaur_skeleton',
  'ogre_zombie',
  'swarm_of_crawling_claws',
  'vampire_familiar',
  'wraith',
  'vampire_spawn',
  'vampire',
  'invisible_stalker',
  'stone_golem',
  'archmage',
  'sea_hag',
  'merrow',
  'black_pudding',
  'giant_crocodile',
  'water_elemental',
  'otyugh',
  'aboleth',
  'treant',
  'cultist_fanatic',
  'knight',
  'guard_captain',
  'pirate_captain',
  'assassin',
  'ice_mephit',
  'white_dragon_wyrmling',
  'polar_bear',
  'saber_toothed_tiger',
  'winter_wolf',
  'mammoth',
  'young_white_dragon',
  'frost_giant',
  'remorhaz',
  'adult_white_dragon',
  'dryad',
  'awakened_tree',
  'griffon',
  'owlbear',
  'wyvern',
  'medusa',
  'giant_ape',
  'hydra',
  'young_green_dragon',
  'guardian_naga',
  'roc',
  'cloud_giant',
  'storm_giant',
  'adult_green_dragon',
  'imp',
  'bearded_devil',
  'barbed_devil',
  'vrock',
  'chain_devil',
  'hezrou',
  'bone_devil',
  'glabrezu',
  'horned_devil',
  'nalfeshnee',
  'erinyes',
  'marilith',
  'balor',
  'kobold_warrior',
  'half_dragon',
  'young_black_dragon',
  'young_blue_dragon',
  'young_red_dragon',
  'adult_black_dragon',
  'adult_blue_dragon',
  'adult_red_dragon',
  'ancient_red_dragon',
  'satyr',
  'brown_bear',
  'tiger',
  'giant_boar',
  'centaur_trooper',
  'werewolf',
  'weretiger',
  'wereboar',
  'werebear',
  'stirge',
  'crocodile',
  'swarm_of_venomous_snakes',
  'will_o_wisp',
  'black_dragon_wyrmling',
  'night_hag',
  'giant_goat',
  'giant_eagle',
  'harpy',
  'hippogriff',
  'giant_vulture',
  'air_elemental',
];

const ORIGINAL_ITEM_IDS = [
  'longsword',
  'greatsword',
  'shortsword',
  'handaxe',
  'dagger',
  'mace',
  'javelin',
  'longbow',
  'shortbow',
  'light_crossbow',
  'leather',
  'studded_leather',
  'chain_shirt',
  'scale_mail',
  'chain_mail',
  'shield',
  'potion_healing',
  'potion_greater_healing',
];

/** SRD 5.2.1 Weapons table, all 38 entries. */
const MUNDANE_WEAPON_IDS = [
  // Simple melee
  'club',
  'dagger',
  'greatclub',
  'handaxe',
  'javelin',
  'light_hammer',
  'mace',
  'quarterstaff',
  'sickle',
  'spear',
  // Simple ranged
  'dart',
  'light_crossbow',
  'shortbow',
  'sling',
  // Martial melee
  'battleaxe',
  'flail',
  'glaive',
  'greataxe',
  'greatsword',
  'halberd',
  'lance',
  'longsword',
  'maul',
  'morningstar',
  'pike',
  'rapier',
  'scimitar',
  'shortsword',
  'trident',
  'warhammer',
  'war_pick',
  'whip',
  // Martial ranged
  'blowgun',
  'hand_crossbow',
  'heavy_crossbow',
  'longbow',
  'musket',
  'pistol',
];

/** SRD 5.2.1 Armor table, armor entries (the shield is listed separately). */
const MUNDANE_ARMOR_IDS = [
  'padded',
  'leather',
  'studded_leather',
  'hide',
  'chain_shirt',
  'scale_mail',
  'breastplate',
  'half_plate',
  'ring_mail',
  'chain_mail',
  'splint',
  'plate',
];

const MUNDANE_SHIELD_IDS = ['shield'];

const WEAPON_MASTERIES = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'];

const WEAPON_PROPERTIES = [
  'finesse',
  'light',
  'heavy',
  'twoHanded',
  'versatile',
  'reach',
  'thrown',
  'ammunition',
  'loading',
];

/** Expected rarity of a magic variant, from the SRD magic item entries. */
const VARIANT_RARITY = {
  weapon: { 1: 'uncommon', 2: 'rare', 3: 'veryRare' },
  armor: { 1: 'rare', 2: 'veryRare', 3: 'legendary' },
  shield: { 1: 'uncommon', 2: 'rare', 3: 'veryRare' },
} as const;

const XP_BY_CR: Record<number, number> = {
  0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
  8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000,
};
/** Where the SRD 5.2.1 stat block prints a different figure from the table, the stat block wins. */
const XP_AS_PRINTED: Record<string, number> = { archmage: 8000 };

/** Monsters with a ranged attack, a save-based ranged effect or an area action; a floor so later edits cannot silently drop them. */
const MIN_RANGED_OR_AREA = 113;
const MIN_WITH_RANGED_ATTACK = 62;
const MIN_WITH_AREA = 59;

const DICE_RE = /^\d+(d\d+)?([+-]\d+)?$/;

/** Average of an "NdM+K" expression. */
function averageOf(dice: string): number {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  if (!m) {
    return Number(dice);
  }
  const n = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  return (n * (sides + 1)) / 2 + mod;
}

describe('monster data', () => {
  it('has exactly the expected ids, each unique', () => {
    const ids = MONSTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...MONSTER_IDS].sort());
  });

  it('uses only valid Dice strings', () => {
    for (const m of MONSTERS) {
      expect(m.hpDice, `${m.id} hpDice`).toMatch(DICE_RE);
      for (const a of m.actions) {
        for (const d of a.damage ?? []) {
          expect(d.dice, `${m.id}.${a.id} damage`).toMatch(DICE_RE);
        }
      }
    }
  });

  it('validates monster auras', () => {
    const CONDITIONS = ['blinded', 'charmed', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];
    let seen = 0;
    for (const m of MONSTERS) {
      const ids = (m.auras ?? []).map((a) => a.id);
      expect(new Set(ids).size, `${m.id} aura ids`).toBe(ids.length);
      for (const a of m.auras ?? []) {
        seen++;
        const at = `${m.id}.${a.id}`;
        expect(a.name, `${at} name`).toBeTruthy();
        expect(a.description, `${at} description`).toBeTruthy();
        expect(a.radius, `${at} radius`).toBeGreaterThan(0);
        expect(Number.isInteger(a.radius), `${at} radius is whole cells`).toBe(true);
        expect(a.save.dc, `${at} dc`).toBeGreaterThan(0);
        expect(a.applies !== undefined || (a.damage?.length ?? 0) > 0, `${at} has an effect`).toBe(true);
        if (a.applies) expect(CONDITIONS, `${at} condition`).toContain(a.applies.condition);
        for (const d of a.damage ?? []) expect(d.dice, `${at} damage`).toMatch(DICE_RE);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
  });

  it('has unique action ids within each monster', () => {
    for (const m of MONSTERS) {
      const ids = m.actions.map((a) => a.id);
      expect(new Set(ids).size, `${m.id} action ids`).toBe(ids.length);
    }
  });

  it('multiattack entries refer to existing attack or save actions', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        for (const ref of a.multiattack ?? []) {
          const target = m.actions.find((x) => x.id === ref);
          expect(target, `${m.id}.${a.id} -> ${ref}`).toBeDefined();
          expect(target!.attack !== undefined || target!.save !== undefined, `${m.id}.${ref}`).toBe(true);
        }
      }
    }
  });

  it('every action with attack or save has damage or applies', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.attack || a.save) {
          expect(a.damage !== undefined || a.applies !== undefined, `${m.id}.${a.id}`).toBe(true);
        }
      }
    }
  });

  it('uses only known trait ids', () => {
    for (const m of MONSTERS) {
      for (const t of m.traits) {
        expect(TRAIT_IDS, `${m.id} trait ${t}`).toContain(t);
      }
    }
  });

  it('gives each theme at least one boss and at least two non-boss monsters', () => {
    for (const theme of THEMES) {
      const inTheme = MONSTERS.filter((m) => m.themes.includes(theme));
      const bosses = inTheme.filter((m) => m.role === 'boss');
      const others = inTheme.filter((m) => m.role !== 'boss');
      // A theme has a boss for every depth it may appear at; which one a floor gets is chosen by CR.
      expect(bosses.length, `${theme} bosses`).toBeGreaterThanOrEqual(1);
      expect(others.length, `${theme} non-bosses`).toBeGreaterThanOrEqual(2);
    }
  });

  it('matches the CR to XP table and the SRD proficiency bonus', () => {
    for (const m of MONSTERS) {
      expect(m.xp, `${m.id} xp`).toBe(XP_AS_PRINTED[m.id] ?? XP_BY_CR[m.cr]);
      // SRD proficiency bonus: +2 up to CR 4, then one more for every four CR (+3 at 5, +4 at 9 ... +7 at 21).
      expect(m.proficiencyBonus, `${m.id} proficiencyBonus`).toBe(m.cr < 5 ? 2 : 2 + Math.floor((m.cr - 1) / 4));
    }
  });

  it('has hp within 1 of the average of hpDice', () => {
    for (const m of MONSTERS as MonsterDef[]) {
      expect(Math.abs(m.hp - averageOf(m.hpDice)), `${m.id} hp`).toBeLessThanOrEqual(1);
    }
  });

  it('gives ranged and thrown attacks a long range greater than the normal range', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.attack && a.targeting.kind === 'creature' && !a.targeting.melee) {
          expect(a.targeting.longRange, `${m.id}.${a.id} longRange`).toBeDefined();
          expect(a.targeting.longRange!, `${m.id}.${a.id}`).toBeGreaterThan(a.targeting.range);
        }
      }
    }
  });
});

describe('monster ranged, spell and area actions', () => {
  const byId = (id: string): MonsterDef => {
    const m = MONSTERS.find((x) => x.id === id);
    expect(m, id).toBeDefined();
    return m as MonsterDef;
  };
  const isRangedAttack = (a: ActionDef): boolean => a.attack !== undefined && a.targeting.kind === 'creature' && !a.targeting.melee && !a.targeting.friendly;
  const isArea = (a: ActionDef): boolean => a.targeting.kind === 'point';
  const hasRangedOrArea = (m: MonsterDef): boolean => m.actions.some((a) => isRangedAttack(a) || isArea(a) || (a.save !== undefined && a.targeting.kind === 'creature' && !a.targeting.melee));
  /** Effect ids the rules engine implements for monsters (data may use no others). */
  const KNOWN_EFFECTS = ['spiritGuardians', 'sleep', 'mastery:push', 'magic'];
  const KNOWN_EFFECT_PATTERNS = [/^concentration:\d+$/];

  it('gives area actions a point target with a positive area and a save, damage or heal', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.targeting.kind !== 'point') continue;
        const t = a.targeting;
        expect(['sphere', 'cone', 'line']).toContain(t.area.shape);
        // A sphere may be a single cell (a leap onto one space); a cone or line, and anything centred on self, has size.
        if (t.area.shape !== 'sphere' || t.range === 0) expect(t.area.size, `${m.id}.${a.id} area size`).toBeGreaterThan(0);
        expect(a.save !== undefined || a.heal !== undefined, `${m.id}.${a.id} needs a save or heal`).toBe(true);
        expect(a.damage !== undefined || a.applies !== undefined || a.heal !== undefined, `${m.id}.${a.id} needs an effect`).toBe(true);
        expect(a.attack, `${m.id}.${a.id} area actions have no attack roll`).toBeUndefined();
      }
    }
  });

  it('gives save actions a positive DC and a known ability, and saveEnds a DC too', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.save) {
          expect(['str', 'dex', 'con', 'int', 'wis', 'cha'], `${m.id}.${a.id}`).toContain(a.save.ability);
          expect(a.save.dc, `${m.id}.${a.id} dc`).toBeGreaterThanOrEqual(8);
        }
        if (a.applies?.saveEnds) expect(a.applies.saveEnds.dc, `${m.id}.${a.id} saveEnds dc`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('gives recharge and uses values the engine understands', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.recharge !== undefined) {
          expect(a.recharge, `${m.id}.${a.id} recharge`).toBeGreaterThanOrEqual(2);
          expect(a.recharge, `${m.id}.${a.id} recharge`).toBeLessThanOrEqual(6);
        }
        if (a.uses) {
          expect(Number.isInteger(a.uses.amount) && a.uses.amount >= 1, `${m.id}.${a.id} uses amount`).toBe(true);
          expect(a.uses.resource.length, `${m.id}.${a.id} resource`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives friendly (heal) actions a heal and no attack', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        if (a.targeting.kind === 'creature' && a.targeting.friendly) {
          expect(a.heal, `${m.id}.${a.id} heal`).toBeDefined();
          expect(a.attack, `${m.id}.${a.id}`).toBeUndefined();
        }
      }
    }
  });

  it('uses only effect ids the rules engine implements', () => {
    for (const m of MONSTERS) {
      for (const a of m.actions) {
        for (const e of a.effects ?? []) {
          const ok = KNOWN_EFFECTS.includes(e) || KNOWN_EFFECT_PATTERNS.some((p) => p.test(e));
          expect(ok, `${m.id}.${a.id} effect ${e}`).toBe(true);
        }
      }
    }
  });

  it('keeps a ranged attack on the well-known archers and thrower types', () => {
    const RANGED = [
      'scout', 'goblin_warrior', 'goblin_boss', 'goblin_minion', 'kobold_warrior', 'skeleton', 'bandit_captain', 'warrior_veteran', 'tough_boss',
      'priest', 'hobgoblin_warrior', 'hobgoblin_captain', 'gladiator', 'pirate', 'knight', 'guard_captain', 'pirate_captain', 'assassin',
      'mage', 'archmage', 'lich', 'wererat', 'werewolf', 'weretiger', 'wereboar', 'werebear', 'centaur_trooper', 'bugbear_stalker', 'bugbear_warrior', 'ogre',
      'stone_giant', 'fire_giant', 'hill_giant', 'frost_giant', 'cloud_giant', 'storm_giant', 'manticore', 'drider', 'medusa', 'earth_elemental',
      'treant', 'oni', 'barbed_devil', 'horned_devil', 'ice_devil', 'efreeti', 'djinni', 'spirit_naga', 'wight', 'vampire_familiar', 'stone_golem', 'iron_golem',
      'mummy_lord', 'adult_red_dragon', 'ancient_red_dragon', 'adult_black_dragon', 'adult_silver_dragon', 'dryad', 'merrow', 'salamander', 'cultist_fanatic',
    ];
    for (const id of RANGED) {
      const m = byId(id);
      expect(m.actions.some((a) => isRangedAttack(a) || (a.save !== undefined && a.targeting.kind === 'creature' && !a.targeting.melee)), `${id} has a ranged attack`).toBe(true);
    }
  });

  it('gives the archers a ranged multiattack as well as a melee one', () => {
    for (const id of ['scout', 'bandit_captain', 'warrior_veteran', 'tough_boss', 'hobgoblin_captain', 'knight', 'assassin', 'centaur_trooper', 'frost_giant', 'priest']) {
      const m = byId(id);
      const ranged = m.actions.filter((a) => a.multiattack && a.multiattack.every((sid) => {
        const sub = m.actions.find((x) => x.id === sid);
        return sub !== undefined && isRangedAttack(sub);
      }));
      expect(ranged.length, `${id} ranged multiattack`).toBeGreaterThan(0);
    }
  });

  it('gives every dragon and wyrmling a recharging area attack (its breath)', () => {
    const dragons = MONSTERS.filter((m) => /Dragon|Wyrmling/.test(m.name));
    expect(dragons.length).toBeGreaterThanOrEqual(20);
    for (const m of dragons) {
      const breath = m.actions.filter((a) => a.targeting.kind === 'point' && a.recharge !== undefined && a.save !== undefined && a.damage !== undefined);
      expect(breath.length, `${m.id} breath`).toBeGreaterThan(0);
      expect(breath[0]?.save?.halfOnSave, `${m.id} breath halves on a save`).toBe(true);
    }
  });

  it('keeps the spell-like actions restored from the stat blocks', () => {
    const has = (id: string, actionId: string): ActionDef => {
      const a = byId(id).actions.find((x) => x.id === actionId);
      expect(a, `${id}.${actionId}`).toBeDefined();
      return a as ActionDef;
    };
    const guardians = has('priest', 'spirit_guardians');
    expect(guardians.save).toEqual({ ability: 'wis', dc: 13, halfOnSave: true });
    expect(guardians.damage).toEqual([{ dice: '3d8', type: 'radiant' }]);
    expect(has('priest', 'healing_word').targeting).toMatchObject({ friendly: true, melee: false });
    expect(has('oni', 'sleep').effects).toContain('sleep');
    expect(has('dryad', 'entangle').applies?.condition).toBe('restrained');
    expect(has('guardian_naga', 'cure_wounds').heal).toBe('12d8+4');
    expect(has('adult_red_dragon', 'fireball').save?.dc).toBe(20);
    expect(has('ancient_red_dragon', 'fireball').damage).toEqual([{ dice: '11d6', type: 'fire' }]);
    expect(has('adult_black_dragon', 'vitriolic_sphere').damage).toEqual([{ dice: '10d4', type: 'acid' }]);
    expect(has('adult_blue_dragon', 'shatter').save).toEqual({ ability: 'con', dc: 18, halfOnSave: true });
    expect(has('adult_silver_dragon', 'hold_monster').applies).toMatchObject({ condition: 'paralyzed', saveEnds: { ability: 'wis', dc: 19 } });
    expect(has('mage', 'fireball').damage).toEqual([{ dice: '9d6', type: 'fire' }]);
    expect(has('archmage', 'lightning_bolt').damage).toEqual([{ dice: '12d6', type: 'lightning' }]);
    expect(has('lich', 'finger_of_death').save?.dc).toBe(20);
  });

  it('does not lose ranged, spell or area actions: at least this many monsters have one', () => {
    const count = MONSTERS.filter(hasRangedOrArea).length;
    expect(count).toBeGreaterThanOrEqual(MIN_RANGED_OR_AREA);
    expect(MONSTERS.filter((m) => m.actions.some(isRangedAttack)).length).toBeGreaterThanOrEqual(MIN_WITH_RANGED_ATTACK);
    expect(MONSTERS.filter((m) => m.actions.some(isArea)).length).toBeGreaterThanOrEqual(MIN_WITH_AREA);
  });
});

describe('item data', () => {
  const mundaneEquipment = ITEMS.filter((i) => i.magicBonus === undefined && i.kind !== 'consumable');
  const variants = ITEMS.filter((i) => i.magicBonus !== undefined);
  const byId = new Map(ITEMS.map((i) => [i.id, i] as const));

  it('keeps the 18 original ids, each unique across all items', () => {
    const ids = ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ORIGINAL_ITEM_IDS) {
      expect(ids, `${id} present`).toContain(id);
    }
  });

  it('has exactly the expected mundane weapon, armor and shield ids', () => {
    const weaponIds = mundaneEquipment.filter((i) => i.kind === 'weapon').map((i) => i.id);
    const armorIds = mundaneEquipment.filter((i) => i.kind === 'armor').map((i) => i.id);
    const shieldIds = mundaneEquipment.filter((i) => i.kind === 'shield').map((i) => i.id);
    expect([...weaponIds].sort()).toEqual([...MUNDANE_WEAPON_IDS].sort());
    expect([...armorIds].sort()).toEqual([...MUNDANE_ARMOR_IDS].sort());
    expect([...shieldIds].sort()).toEqual([...MUNDANE_SHIELD_IDS].sort());
  });

  it('gives every mundane weapon a mastery and valid properties', () => {
    for (const i of mundaneEquipment.filter((x) => x.kind === 'weapon')) {
      expect(WEAPON_MASTERIES, `${i.id} mastery`).toContain(i.weapon!.mastery);
      for (const p of i.weapon!.properties) {
        expect(WEAPON_PROPERTIES, `${i.id} property ${p}`).toContain(p);
      }
    }
  });

  it('keeps versatile and versatileDice in step', () => {
    for (const i of ITEMS.filter((x) => x.weapon)) {
      const hasVersatile = i.weapon!.properties.includes('versatile');
      expect(hasVersatile, `${i.id} versatile`).toBe(i.weapon!.versatileDice !== undefined);
    }
  });

  it('never combines twoHanded with light', () => {
    for (const i of ITEMS.filter((x) => x.weapon)) {
      const p = i.weapon!.properties;
      expect(p.includes('twoHanded') && p.includes('light'), `${i.id}`).toBe(false);
    }
  });

  it('sets dexCap by armor category: none for light, 2 for medium, 0 for heavy', () => {
    for (const i of ITEMS.filter((x) => x.armor)) {
      const cap = i.armor!.dexCap;
      if (i.armor!.category === 'light') expect(cap, `${i.id}`).toBeUndefined();
      if (i.armor!.category === 'medium') expect(cap, `${i.id}`).toBe(2);
      if (i.armor!.category === 'heavy') expect(cap, `${i.id}`).toBe(0);
    }
  });

  it('gives each magic variant a valid base, bonus, rarity and higher cost', () => {
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      const base = byId.get(v.baseId!);
      expect(base, `${v.id} baseId`).toBeDefined();
      expect(base!.magicBonus, `${v.id} base is mundane`).toBeUndefined();
      expect([1, 2, 3], `${v.id} magicBonus`).toContain(v.magicBonus);
      const family = base!.kind === 'weapon' ? 'weapon' : base!.kind === 'armor' ? 'armor' : 'shield';
      expect(v.rarity, `${v.id} rarity`).toBe(VARIANT_RARITY[family][v.magicBonus as 1 | 2 | 3]);
      expect(v.cost, `${v.id} cost`).toBeGreaterThan(base!.cost);
    }
  });

  it('gives each magic variant the same combat stats as its base', () => {
    for (const v of variants) {
      const base = byId.get(v.baseId!)!;
      expect(v.kind, `${v.id} kind`).toBe(base.kind);
      expect(v.weapon, `${v.id} weapon`).toEqual(base.weapon);
      expect(v.armor, `${v.id} armor`).toEqual(base.armor);
      expect(v.shieldBonus, `${v.id} shieldBonus`).toBe(base.shieldBonus);
    }
  });

  it('shares no nested objects between a variant and its base', () => {
    for (const v of variants) {
      const base = byId.get(v.baseId!)!;
      if (v.weapon) {
        expect(v.weapon, `${v.id} weapon`).not.toBe(base.weapon);
        expect(v.weapon.damage, `${v.id} damage`).not.toBe(base.weapon!.damage);
        expect(v.weapon.properties, `${v.id} properties`).not.toBe(base.weapon!.properties);
        if (v.weapon.range) expect(v.weapon.range, `${v.id} range`).not.toBe(base.weapon!.range);
      }
      if (v.armor) {
        expect(v.armor, `${v.id} armor`).not.toBe(base.armor);
      }
    }
  });

  it('has exactly three variants for each weapon, armor and shield, and none for consumables', () => {
    const baseIds = mundaneEquipment.filter((i) => i.kind !== 'consumable').map((i) => i.id);
    for (const id of baseIds) {
      const made = variants.filter((v) => v.baseId === id).map((v) => v.magicBonus).sort();
      expect(made, `${id} variants`).toEqual([1, 2, 3]);
    }
    for (const v of variants) {
      expect(byId.get(v.baseId!)!.kind, `${v.id}`).not.toBe('consumable');
    }
    expect(variants.length).toBe(baseIds.length * 3);
  });

  it('keeps magic variant ids in the expected form', () => {
    for (const v of variants) {
      expect(v.id, `${v.id}`).toBe(`${v.baseId}_plus${v.magicBonus}`);
      expect(v.name, `${v.id} name`).toBe(`${byId.get(v.baseId!)!.name} +${v.magicBonus}`);
    }
  });

  it('keeps mundane items common and unenchanted', () => {
    for (const i of mundaneEquipment.filter((x) => x.kind !== 'consumable')) {
      expect(i.rarity, `${i.id} rarity`).toBe('common');
    }
  });

  it('uses only valid Dice strings', () => {
    for (const i of ITEMS) {
      if (i.weapon) {
        expect(i.weapon.damage.dice, `${i.id} damage`).toMatch(DICE_RE);
        if (i.weapon.versatileDice) {
          expect(i.weapon.versatileDice, `${i.id} versatile`).toMatch(DICE_RE);
        }
      }
      if (i.consumable?.effect === 'heal') {
        expect(i.consumable.dice, `${i.id} consumable`).toMatch(DICE_RE);
      }
    }
  });

  it('gives each kind its matching data block', () => {
    for (const i of ITEMS) {
      if (i.kind === 'weapon') {
        expect(i.weapon, `${i.id} weapon`).toBeDefined();
      }
      if (i.kind === 'armor') {
        expect(i.armor, `${i.id} armor`).toBeDefined();
      }
      if (i.kind === 'shield') {
        expect(i.shieldBonus, `${i.id} shieldBonus`).toBeDefined();
      }
      if (i.kind === 'consumable') {
        expect(i.consumable, `${i.id} consumable`).toBeDefined();
      }
    }
  });

  it('gives thrown and ranged weapons a range with long greater than normal', () => {
    for (const i of ITEMS) {
      const w = i.weapon;
      if (!w) continue;
      const isThrown = w.properties.includes('thrown');
      if (isThrown || !w.melee) {
        expect(w.range, `${i.id} range`).toBeDefined();
        expect(w.range!.long, `${i.id} range`).toBeGreaterThan(w.range!.normal);
      }
    }
  });

  it('monster spells carry the magic tag, and every name in the list is used', () => {
    const tagged = MONSTERS.flatMap((m) => m.actions).filter((a) => a.effects?.includes('magic'));
    expect(tagged.length).toBeGreaterThan(60);
    const used = new Set(tagged.map((a) => a.name));
    for (const name of MAGIC_ACTION_NAMES) expect(used.has(name), name).toBe(true);
    // Not magic: a breath weapon, a bow, a thrown rock.
    for (const name of ['Fire Breath', 'Longbow', 'Boulder']) {
      expect(MONSTERS.flatMap((m) => m.actions).some((a) => a.name === name && a.effects?.includes('magic')), name).toBe(false);
    }
  });
});

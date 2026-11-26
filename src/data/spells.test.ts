import { describe, it, expect } from 'vitest';
import { SPELLS } from './spells';
import type { SpellList, SpellSchool } from '../core/types';

const LISTS: SpellList[] = ['cleric', 'druid', 'wizard'];

const SCHOOLS: SpellSchool[] = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
];

const EXPECTED_IDS = [
  // Cantrips
  'acid_splash',
  'chill_touch',
  'fire_bolt',
  'poison_spray',
  'ray_of_frost',
  'shocking_grasp',
  'true_strike',
  'sacred_flame',
  'resistance',
  'produce_flame',
  'shillelagh',
  'starry_wisp',
  // Level 1
  'magic_missile',
  'burning_hands',
  'shield',
  'thunderwave',
  'sleep',
  'false_life',
  'chromatic_orb',
  'ice_knife',
  'ray_of_sickness',
  'mage_armor',
  'cure_wounds',
  'healing_word',
  'bless',
  'guiding_bolt',
  'shield_of_faith',
  'inflict_wounds',
  'bane',
  'command',
  'entangle',
  'faerie_fire',
];

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DICE_RE = /^\d+(d\d+)?([+-]\d+)?$/;

function listed(list: SpellList): typeof SPELLS {
  return SPELLS.filter((s) => s.lists.includes(list));
}

describe('spell data', () => {
  it('has exactly the expected ids, each unique', () => {
    const ids = SPELLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('uses snake_case ids and a name for every spell', () => {
    for (const s of SPELLS) {
      expect(s.id, `${s.name} id`).toMatch(SNAKE_CASE);
      expect(s.name.length, `${s.id} name`).toBeGreaterThan(0);
      expect(s.description.length, `${s.id} description`).toBeGreaterThan(0);
    }
  });

  it('has level 0 or 1 only, and a known school', () => {
    for (const s of SPELLS) {
      expect([0, 1], `${s.id} level`).toContain(s.level);
      expect(SCHOOLS, `${s.id} school`).toContain(s.school);
    }
  });

  it('has non-empty lists drawn only from cleric, druid and wizard', () => {
    for (const s of SPELLS) {
      expect(s.lists.length, `${s.id} lists`).toBeGreaterThan(0);
      for (const l of s.lists) {
        expect(LISTS, `${s.id} list ${l}`).toContain(l);
      }
    }
  });

  it('gives cantrips with damage exactly three scaling dice, and level-1 spells none', () => {
    for (const s of SPELLS) {
      if (s.level === 0 && s.damage) {
        expect(s.cantripScaling, `${s.id} cantripScaling`).toHaveLength(3);
      }
      if (s.level === 1) {
        expect(s.cantripScaling, `${s.id} cantripScaling`).toBeUndefined();
      }
    }
  });

  it('pairs save resolution with a save, and only then', () => {
    for (const s of SPELLS) {
      if (s.resolution === 'save') {
        expect(s.save, `${s.id} save`).toBeDefined();
      } else {
        expect(s.save, `${s.id} save`).toBeUndefined();
      }
    }
  });

  it('gives heal resolution a heal die, and a heal die only on heal spells', () => {
    for (const s of SPELLS) {
      if (s.resolution === 'heal') {
        expect(s.heal, `${s.id} heal`).toBeDefined();
      } else {
        expect(s.heal, `${s.id} heal`).toBeUndefined();
      }
    }
  });

  it('requires creature targeting for attack resolution', () => {
    for (const s of SPELLS) {
      if (s.resolution === 'attack') {
        expect(s.targeting.kind, `${s.id} targeting`).toBe('creature');
      }
    }
  });

  it('uses only valid Dice strings', () => {
    for (const s of SPELLS) {
      for (const d of s.damage ?? []) {
        expect(d.dice, `${s.id} damage`).toMatch(DICE_RE);
      }
      for (const d of s.cantripScaling ?? []) {
        expect(d, `${s.id} cantripScaling`).toMatch(DICE_RE);
      }
      if (s.heal) {
        expect(s.heal, `${s.id} heal`).toMatch(DICE_RE);
      }
    }
  });

  it('gives every concentration spell a duration', () => {
    for (const s of SPELLS) {
      if (s.concentration) {
        expect(s.durationRounds, `${s.id} durationRounds`).toBeDefined();
      }
    }
  });

  it('gives every reaction spell an effects entry', () => {
    for (const s of SPELLS) {
      if (s.castingTime === 'reaction') {
        expect(s.effects?.length ?? 0, `${s.id} effects`).toBeGreaterThan(0);
      }
    }
  });

  it('gives icon heal to healing spells and spell to the rest', () => {
    for (const s of SPELLS) {
      expect(s.icon, `${s.id} icon`).toBe(s.resolution === 'heal' ? 'heal' : 'spell');
    }
  });

  it('has enough spells on each list for the Magic Initiate choice', () => {
    // SRD 5.2.1 Cleric cantrips in combat use are only Sacred Flame and Resistance.
    expect(listed('cleric').filter((s) => s.level === 0).length).toBeGreaterThanOrEqual(2);
    expect(listed('cleric').filter((s) => s.level === 1).length).toBeGreaterThanOrEqual(6);
    expect(listed('wizard').filter((s) => s.level === 0).length).toBeGreaterThanOrEqual(6);
    expect(listed('wizard').filter((s) => s.level === 1).length).toBeGreaterThanOrEqual(6);
  });
});

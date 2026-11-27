import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, CompanionStance, Creature, GameEvent, GridPos, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
import { COMPANIONS } from '../data/companions';
import { applyLevelUp, createCharacter, suggestedLevelChoices, syncFromCreature, toCreature } from './character';
import { createCombat } from './combat';
import {
  companionAbilities,
  companionInfo,
  companionLevel,
  companionLongRest,
  companionMaxHp,
  companionNeedsRest,
  companionOptions,
  companionPrayer,
  companionProgression,
  companionShortRest,
  createCompanion,
  kitAt,
  newCompanionState,
  requireCompanion,
  syncCompanion,
  usesAt,
} from './companion';
import { chooseCompanionCommand, isChasmEdge, isChokepoint, runCompanionTurn } from './companionAi';
import { runAiTurn } from './ai';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { createPartyDriver } from './party';
import { IMPLEMENTED_SPELL_IDS, getSpell } from './spells';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';
import { abilityMod, chebyshev, isAlive } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(16, 10);
const IDS = ['sphinx_of_wonder', 'pseudodragon', 'blink_dog'] as const;
const STANCES: CompanionStance[] = ['close', 'back', 'focus'];

function pcAt(level: number): PlayerCharacter {
  let pc = createCharacter(makeBuild({ speciesId: 'dwarf', backgroundId: 'soldier', choices: { fightingStyle: 'defense', startingKit: 'a' } }));
  while (pc.level < level) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  return pc;
}

function heroC(level: number, x: number, y: number): Creature {
  const c = toCreature(pcAt(level), { x, y });
  delete c.resources['_savageAttacker'];
  delete c.resources['lastStand'];
  return c;
}

const comp = (id: string, heroLevel: number, x: number, y: number): Creature => createCompanion(requireCompanion(id), heroLevel, undefined, { x, y });

function field(creatures: Creature[], active: string, seed = 3, grid: NavGrid = nav): { combat: CombatApi; rng: ScriptedRng } {
  const rng = new ScriptedRng(seed);
  return { combat: startCombat(creatures, grid, rng, active), rng };
}

const dummy = (id: string, x: number, y: number, over: Partial<MonsterDef> = {}): Creature => {
  const c = instantiateMonster(mon({ id, name: id, hp: 400, ac: 5, actions: [], ...over }), id, { x, y });
  c.hp = c.maxHp = over.hp ?? 400;
  return c;
};

function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
const logs = (events: GameEvent[]): string[] => ofType(events, 'log').map((e) => e.text);

describe('companion progression', () => {
  it('is monotone and sane from level 1 to 18', () => {
    let prev = companionProgression(1);
    expect(prev).toMatchObject({ proficiencyBonus: 2, acBonus: 0, flatDamage: 0, extraDice: 0 });
    for (let l = 2; l <= 18; l++) {
      const row = companionProgression(l);
      expect(row.proficiencyBonus).toBeGreaterThanOrEqual(prev.proficiencyBonus);
      expect(row.acBonus).toBeGreaterThanOrEqual(prev.acBonus);
      expect(row.flatDamage).toBeGreaterThanOrEqual(prev.flatDamage);
      expect(row.extraDice).toBeGreaterThanOrEqual(prev.extraDice);
      expect(row.proficiencyBonus).toBeLessThanOrEqual(6);
      expect(row.acBonus).toBeLessThanOrEqual(4);
      prev = row;
    }
    expect(companionProgression(5).proficiencyBonus).toBe(3);
    expect(companionProgression(17).proficiencyBonus).toBe(6);
  });

  it('companion level is the hero level minus two, at least 1', () => {
    expect([1, 2, 3, 4, 5, 20].map(companionLevel)).toEqual([1, 1, 1, 2, 3, 18]);
  });

  for (const def of COMPANIONS) {
    it(`${def.name}: hit points rise every level from the stat block, abilities stay at or under 20, level 1 is the SRD block`, () => {
      expect(companionMaxHp(def, 1)).toBe(def.base.hp);
      for (let l = 2; l <= 18; l++) {
        expect(companionMaxHp(def, l), `${def.id} ${l}`).toBeGreaterThan(companionMaxHp(def, l - 1));
        for (const v of Object.values(companionAbilities(def, l))) expect(v).toBeLessThanOrEqual(20);
      }
      const c = createCompanion(def, 3);
      expect(c.level).toBe(1);
      expect(c.ac).toBe(def.base.ac);
      expect(c.maxHp).toBe(def.base.hp);
      for (const a of def.base.actions) {
        const mine = c.actions.find((x) => x.id === a.id)!;
        expect(mine.attack?.bonus).toBe(a.attack?.bonus);
        expect(mine.damage?.map((d) => d.dice)).toEqual(a.damage?.map((d) => d.dice));
      }
      // Grows: attack bonus, damage and Armor Class at companion level 18.
      const big = createCompanion(def, 20);
      expect(big.level).toBe(18);
      expect(big.ac).toBeGreaterThan(c.ac);
      expect(big.proficiencyBonus).toBe(6);
      expect(big.saveProficiencies).toHaveLength(3);
      const nat = def.base.actions.find((a) => a.attack)!;
      expect(big.actions.find((a) => a.id === nat.id)!.attack!.bonus).toBeGreaterThan(nat.attack!.bonus);
    });

    it(`${def.name}: the kit runs to level 18, unlocks every one to three levels, and uses implemented spells`, () => {
      const levels = def.kit.map((f) => f.level);
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
      expect(levels[0]).toBe(1);
      expect(levels[levels.length - 1]).toBe(18);
      const distinct = [...new Set(levels)];
      for (let i = 1; i < distinct.length; i++) expect(distinct[i]! - distinct[i - 1]!).toBeLessThanOrEqual(3);
      for (const f of def.kit) {
        expect(f.summary.length, f.name).toBeGreaterThan(10);
        expect(f.spellId !== undefined || f.effect !== undefined, f.name).toBe(true);
        if (f.spellId) {
          expect(getSpell(f.spellId), f.spellId).toBeDefined();
          expect(IMPLEMENTED_SPELL_IDS.has(f.spellId), `${f.spellId} implemented`).toBe(true);
        }
      }
    });

    it(`${def.name}: every hero level 4 to 20 builds a creature, with its kit actions and uses`, () => {
      for (let h = 4; h <= 20; h++) {
        const c = createCompanion(def, h);
        const L = companionLevel(h);
        expect(c.id).toBe('companion');
        expect(c.faction).toBe('ally');
        expect(c.level).toBe(L);
        for (const f of kitAt(def, L)) {
          if (f.spellId && f.spellId !== 'prayer_of_healing') {
            expect(c.actions.some((a) => a.id === `spell_${f.spellId}`), `${f.spellId} at ${L}`).toBe(true);
            if ((getSpell(f.spellId)?.level ?? 0) >= 1) expect(c.resources[`spell:${f.spellId}`]).toMatchObject({ max: usesAt(f, L), current: usesAt(f, L) });
          }
        }
        // Nothing from a later level.
        for (const f of def.kit.filter((x) => x.level > L)) if (f.spellId) expect(c.actions.some((a) => a.id === `spell_${f.spellId}`)).toBe(false);
        const info = companionInfo(def, h);
        expect(info.level).toBe(L);
        expect(info.summaries.length).toBeGreaterThan(0);
        expect(info.nextUnlock === undefined).toBe(L >= 18);
        expect(JSON.parse(JSON.stringify(c))).toEqual(c);
      }
    });
  }

  it('companionOptions lists all three for the hub', () => {
    const o = companionOptions(4);
    expect(o.map((x) => x.id)).toEqual(['sphinx_of_wonder', 'pseudodragon', 'blink_dog']);
    expect(o.every((x) => x.level === 2 && x.maxHp > 0 && x.ac > 0)).toBe(true);
  });

  it('the fliers move at fly speed, the dog is fast, and the dog gets faster with Fleet', () => {
    expect(comp('sphinx_of_wonder', 4, 0, 0).speed).toBe(8);
    expect(comp('pseudodragon', 4, 0, 0).speed).toBe(12);
    expect(comp('blink_dog', 4, 0, 0).speed).toBe(8);
    expect(comp('blink_dog', 12, 0, 0).speed).toBe(10);
    expect(comp('sphinx_of_wonder', 4, 0, 0).resources['_flying']).toBeDefined();
    expect(comp('blink_dog', 4, 0, 0).resources['_flying']).toBeUndefined();
  });
});

describe('Sneak Attack and the Blink Dog', () => {
  const dogBite = (a: Creature): ActionDef => a.actions.find((x) => x.id === 'bite')!;

  it('has 1d6 at companion level 1 and one more d6 every two levels', () => {
    expect([3, 5, 7, 9, 11, 20].map((h) => comp('blink_dog', h, 0, 0).resources['_sneakAttack']?.current)).toEqual([1, 2, 3, 4, 5, 9]);
  });

  it('applies when the hero is within 5 ft of the target', () => {
    const hero = heroC(4, 6, 5);
    const dog = comp('blink_dog', 4, 4, 4);
    const foe = dummy('foe', 5, 4);
    const { combat, rng } = field([dog, hero, foe], 'companion');
    rng.queue = [15, 2, 3, 3]; // hit, bite damage, sneak dice
    const ev = combat.execute({ type: 'action', actionId: dogBite(dog).id, targetId: 'foe' });
    expect(logs(ev).some((t) => /Sneak Attack/.test(t))).toBe(true);
    expect(ofType(ev, 'damage')).toHaveLength(2);
  });

  it('does not apply with nobody next to the target and no advantage', () => {
    const hero = heroC(4, 12, 8);
    const dog = comp('blink_dog', 4, 4, 4);
    const foe = dummy('foe', 5, 4);
    const { combat, rng } = field([dog, hero, foe], 'companion');
    rng.queue = [15, 2, 3, 3];
    const ev = combat.execute({ type: 'action', actionId: 'bite', targetId: 'foe' });
    expect(logs(ev).some((t) => /Sneak Attack/.test(t))).toBe(false);
    expect(ofType(ev, 'damage')).toHaveLength(1);
  });

  it('does not apply with disadvantage even with an ally adjacent', () => {
    const hero = heroC(4, 6, 5);
    const dog = comp('blink_dog', 4, 4, 4);
    const foe = dummy('foe', 5, 4);
    foe.conditions.push({ condition: 'dodging', rounds: null });
    const { combat, rng } = field([dog, hero, foe], 'companion');
    rng.queue = [15, 15, 2, 3, 3];
    const ev = combat.execute({ type: 'action', actionId: 'bite', targetId: 'foe' });
    expect(ofType(ev, 'attackRoll')[0]!.mode).toBe('disadvantage');
    expect(logs(ev).some((t) => /Sneak Attack/.test(t))).toBe(false);
  });

  it('applies with advantage alone, once per turn even with two bites', () => {
    const hero = heroC(12, 14, 8);
    const dog = comp('blink_dog', 12, 4, 4);
    expect(dog.actions.some((a) => a.id === 'double_bite')).toBe(true);
    const foe = dummy('foe', 5, 4);
    foe.conditions.push({ condition: 'prone', rounds: null }); // melee attackers have advantage against a prone creature
    const { combat, rng } = field([dog, hero, foe], 'companion');
    rng.queue = [15, 15, 2, 3, 3, 3, 3, 3, 3, 15, 15, 2, 3, 3, 3, 3, 3];
    const ev = combat.execute({ type: 'action', actionId: 'double_bite', targetId: 'foe' });
    expect(ofType(ev, 'attackRoll')).toHaveLength(2);
    expect(ofType(ev, 'attackRoll')[0]!.mode).toBe('advantage');
    expect(logs(ev).filter((t) => /Sneak Attack/.test(t))).toHaveLength(1);
  });

  it('Teleport: the attack straight after counts as made from hiding (advantage, so Sneak Attack applies)', () => {
    const hero = heroC(4, 14, 8);
    const dog = comp('blink_dog', 4, 1, 1);
    const foe = dummy('foe', 8, 4);
    const { combat, rng } = field([dog, hero, foe], 'companion');
    expect(combat.canUse('blink').ok).toBe(true);
    expect(() => combat.execute({ type: 'action', actionId: 'blink', point: { x: 8, y: 4 } })).toThrow(); // occupied
    expect(() => combat.execute({ type: 'action', actionId: 'blink', point: { x: 15, y: 9 } })).toThrow(); // out of range
    const ev0 = combat.execute({ type: 'action', actionId: 'blink', point: { x: 7, y: 4 } });
    expect(dog.pos).toEqual({ x: 7, y: 4 });
    expect(ofType(ev0, 'move')[0]!.creatureId).toBe('companion');
    expect(combat.turn.bonusUsed).toBe(true);
    expect(combat.turn.actionUsed).toBe(false);
    rng.queue = [15, 15, 2, 3, 3];
    const ev = combat.execute({ type: 'action', actionId: 'bite', targetId: 'foe' });
    expect(ofType(ev, 'attackRoll')[0]!.mode).toBe('advantage');
    expect(logs(ev).some((t) => /Sneak Attack/.test(t))).toBe(true);
    // Recharging: not available again right away.
    expect(combat.canUse('blink')).toMatchObject({ ok: false, reason: 'Recharging' });
  });

  it('Cunning Action dashes and disengages as bonus actions', () => {
    const hero = heroC(6, 14, 8);
    const dog = comp('blink_dog', 6, 1, 1);
    const foe = dummy('foe', 2, 1);
    const { combat } = field([dog, hero, foe], 'companion');
    combat.execute({ type: 'action', actionId: 'cunning_disengage' });
    const ev = combat.execute({ type: 'move', path: [{ x: 1, y: 2 }, { x: 1, y: 3 }] });
    expect(ofType(ev, 'attackRoll')).toHaveLength(0);
    expect(combat.canUse('cunning_dash')).toMatchObject({ ok: false });
    expect(combat.canUse('dash').ok).toBe(true);
  });

  it('Uncanny Dodge halves the damage of one hit per round', () => {
    const attacker = (): Creature =>
      instantiateMonster(mon({ id: 'o', actions: [{ id: 'hit', name: 'Hit', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 50 }, damage: [{ dice: '20', type: 'slashing' }] }] }), 'o', { x: 5, y: 4 });
    const dog = comp('blink_dog', 6, 4, 4); // companion level 4: Uncanny Dodge
    expect(dog.resources['_uncannyDodge']).toBeDefined();
    const hero = heroC(6, 14, 8);
    const o = attacker();
    const { combat } = field([o, dog, hero], 'o');
    const before = dog.hp;
    combat.execute({ type: 'action', actionId: 'hit', targetId: 'companion' });
    expect(before - dog.hp).toBe(10);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    const mid = dog.hp;
    combat.execute({ type: 'action', actionId: 'hit', targetId: 'companion' });
    expect(mid - dog.hp).toBe(10); // the reaction is back each round
    combat.execute({ type: 'endTurn' });
    expect(combat.canUse('hit').ok).toBe(false);
  });

  it('Evasion: no damage on a successful Dexterity save, half on a failure', () => {
    const burst: ActionDef = { id: 'burst', name: 'Burst', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, save: { ability: 'dex', dc: 12, halfOnSave: true }, damage: [{ dice: '20', type: 'fire' }] };
    for (const [roll, expected] of [[20, 0], [1, 10]] as const) {
      const o = instantiateMonster(mon({ id: 'o', actions: [burst] }), 'o', { x: 5, y: 4 });
      const dog = comp('blink_dog', 8, 4, 4); // level 6: Evasion
      expect(dog.resources['_evasion']).toBeDefined();
      const { combat, rng } = field([o, dog, heroC(8, 14, 8)], 'o');
      rng.queue = [roll];
      const before = dog.hp;
      combat.execute({ type: 'action', actionId: 'burst', targetId: 'companion' });
      expect(before - dog.hp).toBe(expected);
    }
    const early = comp('blink_dog', 7, 4, 4);
    expect(early.resources['_evasion']).toBeUndefined();
  });
});

describe('Sphinx of Wonder', () => {
  it('Burst of Ingenuity: +2 on a failed save of the hero when that makes it succeed, a limited number of times', () => {
    const zap: ActionDef = { id: 'zap', name: 'Zap', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 8 }, save: { ability: 'wis', dc: 14, halfOnSave: false }, damage: [{ dice: '10', type: 'psychic' }] };
    const hero = heroC(6, 5, 5);
    const sphinx = comp('sphinx_of_wonder', 6, 4, 5);
    const wisBonus = abilityMod(hero.abilities.wis);
    const o = instantiateMonster(mon({ id: 'o', actions: [zap] }), 'o', { x: 9, y: 5 });
    const { combat, rng } = field([o, hero, sphinx], 'o');
    const need = 14 - wisBonus;
    rng.queue = [need - 2]; // fails by exactly 2
    const hp = hero.hp;
    const ev = combat.execute({ type: 'action', actionId: 'zap', targetId: 'player' });
    expect(ofType(ev, 'saveRoll')[0]!.success).toBe(true);
    expect(hero.hp).toBe(hp);
    expect(logs(ev).some((t) => /Burst of Ingenuity/.test(t))).toBe(true);
    expect(sphinx.resources['burstOfIngenuity']!.current).toBe(1);
    // Fails by more than 2: no use.
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [need - 5];
    const ev2 = combat.execute({ type: 'action', actionId: 'zap', targetId: 'player' });
    expect(ofType(ev2, 'saveRoll')[0]!.success).toBe(false);
    expect(sphinx.resources['burstOfIngenuity']!.current).toBe(1);
    // Out of range (more than 30 ft): no help.
    sphinx.pos = { x: 15, y: 9 };
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [need - 1];
    const ev3 = combat.execute({ type: 'action', actionId: 'zap', targetId: 'player' });
    expect(ofType(ev3, 'saveRoll')[0]!.success).toBe(false);
  });

  it('Magic Resistance: advantage on saves against spells, not against other effects', () => {
    const spellZap: ActionDef = { id: 'zap', name: 'Zap', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 8 }, save: { ability: 'wis', dc: 30, halfOnSave: false }, effects: ['spell'] };
    const plain: ActionDef = { ...spellZap, id: 'plain', effects: [] };
    const sphinx = comp('sphinx_of_wonder', 6, 4, 5);
    const o = instantiateMonster(mon({ id: 'o', actions: [spellZap, plain] }), 'o', { x: 9, y: 5 });
    const { combat } = field([o, sphinx, heroC(6, 14, 8)], 'o');
    const a = combat.execute({ type: 'action', actionId: 'zap', targetId: 'companion' });
    expect(ofType(a, 'saveRoll').length).toBe(1);
    // Advantage is rolled as two d20s: the scripted queue shows it by consuming two values.
    const rng = new ScriptedRng(9);
    const o2 = instantiateMonster(mon({ id: 'o', actions: [spellZap, plain] }), 'o', { x: 9, y: 5 });
    const s2 = comp('sphinx_of_wonder', 6, 4, 5);
    const c2 = startCombat([o2, s2, heroC(6, 14, 8)], nav, rng, 'o');
    rng.queue = [3, 18];
    const ev = c2.execute({ type: 'action', actionId: 'zap', targetId: 'companion' });
    const save = ofType(ev, 'saveRoll')[0]!;
    expect(save.d20).toBe(18); // the higher of the two
    rng.queue = [];
    c2.execute({ type: 'endTurn' });
    c2.execute({ type: 'endTurn' });
    c2.execute({ type: 'endTurn' });
    rng.queue = [3, 18];
    const ev2 = c2.execute({ type: 'action', actionId: 'plain', targetId: 'companion' });
    expect(ofType(ev2, 'saveRoll')[0]!.d20).toBe(3); // one die, the next value stays queued
  });

  it('heals the hero with Healing Word when below 60%, and itself only when critical', () => {
    const hero = heroC(6, 5, 5);
    hero.hp = Math.floor(hero.maxHp * 0.4);
    const sphinx = comp('sphinx_of_wonder', 6, 4, 5);
    const foe = dummy('foe', 10, 5);
    const { combat } = field([sphinx, hero, foe], 'companion');
    const hp = hero.hp;
    const ev = runCompanionTurn(combat, nav, 'close');
    expect(ofType(ev, 'heal').some((h) => h.targetId === 'player')).toBe(true);
    expect(hero.hp).toBeGreaterThan(hp);
    // A healthy hero is not healed; the sphinx at 20% heals itself.
    const hero2 = heroC(6, 5, 5);
    const sphinx2 = comp('sphinx_of_wonder', 6, 4, 5);
    sphinx2.hp = Math.floor(sphinx2.maxHp * 0.2);
    const { combat: c2 } = field([sphinx2, hero2, dummy('foe', 10, 5)], 'companion');
    const ev2 = runCompanionTurn(c2, nav, 'close');
    expect(ofType(ev2, 'heal').every((h) => h.targetId === 'companion')).toBe(true);
    expect(ofType(ev2, 'heal').length).toBeGreaterThan(0);
  });

  it('buffs at the start of a hard fight', () => {
    const hero = heroC(6, 5, 5);
    const sphinx = comp('sphinx_of_wonder', 6, 4, 5);
    const foes = [dummy('a', 11, 4), dummy('b', 11, 5), dummy('c', 11, 6)];
    const { combat } = field([sphinx, hero, ...foes], 'companion');
    const ev = runCompanionTurn(combat, nav, 'close');
    expect(ofType(ev, 'actionUsed').some((e) => /Bless|Aid|Shield of Faith/.test(e.name))).toBe(true);
  });
});

describe('level 2 to 5 spells in the engine', () => {
  const caster = (id: string, heroLevel: number): Creature => comp(id, heroLevel, 4, 5);

  it('Aid: +5 maximum and current hit points to allies within 30 ft', () => {
    const sphinx = caster('sphinx_of_wonder', 10);
    const hero = heroC(10, 5, 5);
    const { combat } = field([sphinx, hero, dummy('foe', 12, 5)], 'companion');
    const max = hero.maxHp;
    const ev = combat.execute({ type: 'action', actionId: 'spell_aid', targetId: 'player' });
    expect(hero.maxHp).toBe(max + 5);
    expect(sphinx.maxHp).toBe(createCompanion(requireCompanion('sphinx_of_wonder'), 10).maxHp + 5);
    expect(logs(ev).some((t) => /Aid/.test(t))).toBe(true);
    // Sync after the fight drops the bonus.
    const state = newCompanionState('sphinx_of_wonder', 10);
    expect(syncCompanion(state, sphinx).hp).toBe(state.hp);
  });

  it('Mass Healing Word heals both friends in range with one bonus action', () => {
    const sphinx = caster('sphinx_of_wonder', 14);
    const hero = heroC(14, 8, 5);
    hero.hp = 20;
    sphinx.hp = 10;
    const { combat } = field([sphinx, hero, dummy('foe', 14, 5)], 'companion');
    const ev = combat.execute({ type: 'action', actionId: 'spell_mass_healing_word' });
    expect(ofType(ev, 'heal').map((h) => h.targetId).sort()).toEqual(['companion', 'player']);
    expect(combat.turn.bonusUsed).toBe(true);
  });

  it('Mass Cure Wounds heals the hero and the sphinx in a 30-foot sphere', () => {
    const sphinx = caster('sphinx_of_wonder', 18);
    const hero = heroC(18, 8, 5);
    hero.hp = 20;
    sphinx.hp = 10;
    const { combat } = field([sphinx, hero, dummy('foe', 14, 5)], 'companion');
    const ev = combat.execute({ type: 'action', actionId: 'spell_mass_cure_wounds', point: { x: 6, y: 5 } });
    expect(ofType(ev, 'heal').map((h) => h.targetId).sort()).toEqual(['companion', 'player']);
    expect(ofType(ev, 'heal').every((h) => h.amount >= 5)).toBe(true);
  });

  it('Death Ward: the first time the hero would drop to 0 it stays at 1, and the ward ends', () => {
    const sphinx = caster('sphinx_of_wonder', 14);
    const hero = heroC(14, 5, 5);
    const killer: ActionDef = { id: 'k', name: 'Kill', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 50 }, damage: [{ dice: '999', type: 'slashing' }] };
    const o = instantiateMonster(mon({ id: 'o', actions: [killer] }), 'o', { x: 6, y: 5 });
    const { combat } = field([sphinx, hero, o], 'companion');
    combat.execute({ type: 'action', actionId: 'spell_death_ward', targetId: 'player' });
    expect(hero.resources['_deathWard']).toBeDefined();
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    while (combat.activeId !== 'o') combat.execute({ type: 'endTurn' });
    const ev = combat.execute({ type: 'action', actionId: 'k', targetId: 'player' });
    expect(hero.hp).toBe(1);
    expect(hero.resources['_deathWard']).toBeUndefined();
    expect(logs(ev).some((t) => /Death Ward/.test(t))).toBe(true);
    expect(combat.isOver).toBe(false);
  });

  it('Spirit Guardians burns enemies that start their turn near the sphinx, and ends if concentration breaks', () => {
    const sphinx = caster('sphinx_of_wonder', 16);
    const hero = heroC(16, 6, 5);
    const foe = dummy('foe', 7, 5, { actions: [] });
    const { combat } = field([sphinx, hero, foe], 'companion');
    const ev = combat.execute({ type: 'action', actionId: 'spell_spirit_guardians', point: sphinx.pos });
    expect(logs(ev).some((t) => /begins concentrating on Spirit Guardians/.test(t))).toBe(true);
    const hp = foe.hp;
    let burned = false;
    for (let i = 0; i < 6 && !burned; i++) {
      const e = combat.execute({ type: 'endTurn' });
      burned = ofType(e, 'damage').some((d) => d.targetId === 'foe' && d.damageType === 'radiant');
    }
    expect(burned).toBe(true);
    expect(foe.hp).toBeLessThan(hp);
  });

  it('Scorching Ray makes three attack rolls', () => {
    const dragon = caster('pseudodragon', 10);
    const hero = heroC(10, 14, 8);
    const foe = dummy('foe', 8, 5, { ac: 5 });
    const { combat } = field([dragon, hero, foe], 'companion');
    const ev = combat.execute({ type: 'action', actionId: 'spell_scorching_ray', targetId: 'foe' });
    expect(ofType(ev, 'attackRoll')).toHaveLength(3);
  });

  it('Fireball, Shatter, Lightning Bolt, Ice Storm and Cone of Cold hit the enemies in their area', () => {
    const cases: [string, number, GridPos | undefined][] = [
      ['spell_fireball', 12, { x: 10, y: 5 }],
      ['spell_shatter', 12, { x: 10, y: 5 }],
      ['spell_lightning_bolt', 14, { x: 10, y: 5 }],
      ['spell_ice_storm', 16, { x: 10, y: 5 }],
      ['spell_cone_of_cold', 18, { x: 10, y: 5 }],
    ];
    for (const [action, heroLevel, point] of cases) {
      const dragon = createCompanion(requireCompanion('pseudodragon'), heroLevel, undefined, { x: 4, y: 5 });
      const hero = heroC(heroLevel, 3, 8);
      const a = dummy('a', 9, 5);
      const b = dummy('b', 10, 5);
      const { combat } = field([dragon, hero, a, b], 'companion');
      expect(combat.canUse(action).ok, action).toBe(true);
      const ev = combat.execute({ type: 'action', actionId: action, point });
      const hit = new Set(ofType(ev, 'damage').map((d) => d.targetId));
      expect(hit.has('a') || hit.has('b'), action).toBe(true);
      expect(hit.has('player') || hit.has('companion'), `${action} spares friends`).toBe(false);
    }
  });

  it('Prayer of Healing is for between fights: heals the hero and the sphinx, once', () => {
    const def = requireCompanion('sphinx_of_wonder');
    const pc = { ...pcAt(10), hp: 20 };
    const state = { ...newCompanionState(def.id, 10), hp: 5 };
    const r = companionPrayer(pc, state, def, 10, new Rng(1));
    if ('error' in r) throw new Error(r.error);
    expect(r.pc.hp).toBeGreaterThan(20);
    expect(r.state.hp).toBeGreaterThan(5);
    const again = companionPrayer(r.pc, r.state, def, 10, new Rng(1));
    expect('error' in again).toBe(true);
    const early = companionPrayer(pc, newCompanionState(def.id, 5), def, 5, new Rng(1));
    expect('error' in early).toBe(true);
    // Not a combat action.
    expect(createCompanion(def, 10).actions.some((a) => a.id === 'spell_prayer_of_healing')).toBe(false);
  });

  it('concentration rules apply to companions: casting a second concentration spell ends the first', () => {
    const sphinx = caster('sphinx_of_wonder', 8);
    const hero = heroC(8, 5, 5);
    const { combat } = field([sphinx, hero, dummy('foe', 12, 5)], 'companion');
    combat.execute({ type: 'action', actionId: 'spell_bless', targetId: 'player' });
    expect(sphinx.resources['_concentration']?.name).toBe('Bless');
    const ev = combat.execute({ type: 'action', actionId: 'spell_shield_of_faith', targetId: 'player' });
    expect(logs(ev).some((t) => /concentration on Bless ends/.test(t))).toBe(true);
    expect(sphinx.resources['_concentration']?.name).toBe('Shield of Faith');
  });
});

describe('companion AI', () => {
  it('the blaster never aims an area at the hero or itself (random arenas)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = new Rng(seed);
      const heroLevel = [4, 8, 12, 16, 20][seed % 5]!;
      const cells = new Set<string>();
      const place = (): GridPos => {
        for (;;) {
          const p = { x: r.int(1, 14), y: r.int(1, 8) };
          if (!cells.has(`${p.x},${p.y}`)) {
            cells.add(`${p.x},${p.y}`);
            return p;
          }
        }
      };
      const hp = place();
      const hero = heroC(heroLevel, hp.x, hp.y);
      const dp = place();
      const dragon = createCompanion(requireCompanion('pseudodragon'), heroLevel, undefined, dp);
      const foes = Array.from({ length: r.int(2, 5) }, (_, i) => {
        const p = place();
        return dummy(`f${i}`, p.x, p.y, { hp: 2000 });
      });
      const rng = new ScriptedRng(seed);
      const combat = startCombat([dragon, hero, ...foes], nav, rng, 'companion');
      const stance = STANCES[seed % 3]!;
      for (let turn = 0; turn < 4 && !combat.isOver; turn++) {
        const events = runCompanionTurn(combat, nav, stance, 'f0');
        for (const d of ofType(events, 'damage')) {
          expect(d.targetId === 'player' || d.targetId === 'companion', `seed ${seed} turn ${turn}: ${d.damageType} on ${d.targetId}`).toBe(false);
        }
        // Heal-free: pass the turn to the next creature that is not the companion.
        while (!combat.isOver && combat.activeId !== 'companion') combat.execute({ type: 'endTurn' });
      }
    }
  });

  it('a downed companion is out of the fight with a log line, and returns at 1 HP after it', () => {
    const killer: ActionDef = { id: 'k', name: 'Kill', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 50 }, damage: [{ dice: '999', type: 'slashing' }] };
    const o = instantiateMonster(mon({ id: 'o', actions: [killer] }), 'o', { x: 5, y: 4 });
    const dog = comp('blink_dog', 6, 4, 4);
    const hero = heroC(6, 14, 8);
    const { combat } = field([o, dog, hero], 'o');
    const ev = combat.execute({ type: 'action', actionId: 'k', targetId: 'companion' });
    expect(ofType(ev, 'death').map((d) => d.creatureId)).toEqual(['companion']);
    expect(logs(ev)).toContain('Blink Dog is down — it will be back after the fight.');
    expect(combat.isOver).toBe(false);
    // It never acts again this fight.
    for (let i = 0; i < 6; i++) expect(combat.activeId).not.toBe('companion');
    const state = newCompanionState('blink_dog', 6);
    const after = syncCompanion(state, dog);
    expect(after.hp).toBe(1);
    expect(createCompanion(requireCompanion('blink_dog'), 6, after).hp).toBe(1);
    expect(createCompanion(requireCompanion('blink_dog'), 6, after).dead).toBe(false);
  });

  it('the fight is lost when the hero falls even though the companion stands', () => {
    const killer: ActionDef = { id: 'k', name: 'Kill', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 50 }, damage: [{ dice: '999', type: 'slashing' }] };
    const o = instantiateMonster(mon({ id: 'o', actions: [killer] }), 'o', { x: 5, y: 4 });
    const dog = comp('blink_dog', 6, 14, 8);
    const hero = heroC(6, 4, 4);
    const { combat } = field([o, dog, hero], 'o');
    const ev = combat.execute({ type: 'action', actionId: 'k', targetId: 'player' });
    expect(combat.isOver).toBe(true);
    expect(combat.winner).toBe('enemy');
    expect(isAlive(dog)).toBe(true);
    expect(ofType(ev, 'combatEnd')[0]!.winner).toBe('enemy');
  });

  it('victory comes when every enemy is down', () => {
    const dog = comp('blink_dog', 6, 4, 4);
    const hero = heroC(6, 4, 5);
    const foe = dummy('foe', 5, 4, { hp: 1 });
    const { combat, rng } = field([dog, hero, foe], 'companion');
    rng.queue = [15, 4, 4, 4];
    combat.execute({ type: 'action', actionId: 'bite', targetId: 'foe' });
    expect(combat.isOver).toBe(true);
    expect(combat.winner).toBe('player');
  });

  it('monsters split their attention between the hero and the companion, favouring the hero', () => {
    let heroHits = 0;
    let compHits = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const brutes = [0, 1].map((i) =>
        instantiateMonster(mon({ id: `b${i}`, name: `b${i}`, hp: 5000, ac: 5, actions: [{ id: 'club', name: 'Club', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 8 }, damage: [{ dice: '1d4', type: 'bludgeoning' }] }] }), `b${i}`, { x: 7, y: 4 + i }),
      );
      const hero = heroC(10, 5, 5);
      const dog = comp('blink_dog', 10, 5, 4);
      hero.hp = hero.maxHp = 9999;
      dog.hp = dog.maxHp = 9999;
      const rng = new Rng(seed);
      const combat = createCombat([hero, dog, ...brutes], nav, rng);
      const events: GameEvent[] = [...combat.begin()];
      // Both friends stand next to both brutes; the brutes act for four rounds.
      hero.pos = { x: 6, y: 4 };
      dog.pos = { x: 6, y: 5 };
      let guard = 0;
      while (!combat.isOver && combat.round <= 5 && guard++ < 100) {
        if (combat.activeId === 'player' || combat.activeId === 'companion') events.push(...combat.execute({ type: 'endTurn' }));
        else events.push(...runAiTurn(combat, nav));
      }
      // Attention is who they swing at, not who gets hurt (the hero's better armor turns more swings into misses).
      for (const r of ofType(events, 'attackRoll')) {
        if (r.targetId === 'player') heroHits++;
        if (r.targetId === 'companion') compHits++;
      }
    }
    expect(compHits).toBeGreaterThan(0);
    expect(heroHits).toBeGreaterThan(0);
    expect(heroHits).toBeGreaterThan(compHits);
    // Re-tune: the hero draws more attention (AI_TUNING.heroAttention 2.6) so the companion is downed less; it must still be picked now and then.
    expect(compHits / (heroHits + compHits)).toBeGreaterThan(0.05);
  });

  it('close stance: walks up to within 2 cells of the hero when nothing is near', () => {
    for (const id of IDS) {
      const hero = heroC(8, 8, 5);
      const c = comp(id, 8, 1, 5);
      const { combat } = field([c, hero, dummy('far', 15, 9)], 'companion');
      runCompanionTurn(combat, nav, 'close');
      expect(chebyshev(c.pos, hero.pos), id).toBeLessThanOrEqual(3);
      expect(chebyshev(c.pos, hero.pos), id).toBeLessThan(7);
    }
  });

  it('back stance: keeps away from enemies and does not walk into melee', () => {
    for (const id of ['pseudodragon', 'sphinx_of_wonder'] as const) {
      const hero = heroC(8, 3, 5);
      const c = comp(id, 8, 4, 5);
      const foe = dummy('foe', 9, 5);
      const { combat } = field([c, hero, foe], 'companion');
      const events = runCompanionTurn(combat, nav, 'back');
      expect(chebyshev(c.pos, foe.pos), id).toBeGreaterThanOrEqual(4);
      expect(ofType(events, 'attackRoll').every((r) => r.targetId !== 'foe' || chebyshev(c.pos, foe.pos) > 1), id).toBe(true);
    }
    // The dog retreats (Disengaging) instead of staying in melee.
    const hero = heroC(8, 1, 5);
    const dog = comp('blink_dog', 8, 8, 5);
    const foe = dummy('foe', 9, 5);
    const { combat } = field([dog, hero, foe], 'companion');
    const events = runCompanionTurn(combat, nav, 'back');
    expect(ofType(events, 'attackRoll').filter((r) => r.reaction)).toHaveLength(0);
    expect(chebyshev(dog.pos, foe.pos)).toBeGreaterThan(1);
  });

  it('focus stance: goes for the hero\'s last target', () => {
    const hero = heroC(8, 3, 5);
    const dog = comp('blink_dog', 8, 4, 5);
    const near = dummy('near', 6, 5);
    const far = dummy('far', 6, 8);
    const { combat } = field([dog, hero, near, far], 'companion');
    const ev = runCompanionTurn(combat, nav, 'focus', 'far');
    expect(ofType(ev, 'attackRoll').length).toBeGreaterThan(0);
    expect(ofType(ev, 'attackRoll').every((r) => r.targetId === 'far')).toBe(true);
    const pd = comp('pseudodragon', 8, 4, 5);
    const { combat: c2 } = field([pd, heroC(8, 3, 5), dummy('near', 6, 5), dummy('far', 6, 8)], 'companion');
    const ev2 = runCompanionTurn(c2, nav, 'focus', 'far');
    const hit = ofType(ev2, 'damage').filter((d) => d.sourceId === 'companion');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((d) => d.targetId === 'far')).toBe(true);
  });

  it('the skirmisher attacks the hero\'s adjacent target (Sneak Attack) rather than a lone enemy', () => {
    const hero = heroC(8, 5, 5);
    const dog = comp('blink_dog', 8, 3, 5);
    const flanked = dummy('flanked', 6, 5);
    const lone = dummy('lone', 3, 8);
    const { combat } = field([dog, hero, flanked, lone], 'companion');
    const ev = runCompanionTurn(combat, nav, 'close');
    const rolls = ofType(ev, 'attackRoll');
    expect(rolls.length).toBeGreaterThan(0);
    expect(rolls.every((r) => r.targetId === 'flanked')).toBe(true);
    expect(logs(ev).some((t) => /Sneak Attack/.test(t))).toBe(true);
  });

  it('the skirmisher teleports then strikes with advantage when the target is out of reach', () => {
    const hero = heroC(8, 4, 8);
    const dog = comp('blink_dog', 4, 1, 1);
    const foe = dummy('foe', 13, 3);
    const { combat } = field([dog, hero, foe], 'companion');
    const ev = runCompanionTurn(combat, nav, 'focus', 'foe');
    expect(ofType(ev, 'actionUsed').some((e) => e.actionId === 'blink')).toBe(true);
    const rolls = ofType(ev, 'attackRoll');
    expect(rolls.length).toBeGreaterThan(0);
    expect(rolls[0]!.mode).toBe('advantage');
  });

  it('keeps out of doorways while another cell will do, and off chasm edges', () => {
    const walls: GridPos[] = [];
    for (let y = 0; y < 10; y++) if (y !== 5) walls.push({ x: 8, y });
    const grid = createOpenRoomNav(16, 10, { walls });
    expect(isChokepoint(grid, { x: 8, y: 5 })).toBe(true);
    expect(isChokepoint(grid, { x: 3, y: 3 })).toBe(false);
    const chasms: GridPos[] = [];
    for (let x = 0; x < 16; x++) chasms.push({ x, y: 8 });
    const g2 = createOpenRoomNav(16, 10, { chasms });
    expect(isChasmEdge(g2, { x: 4, y: 7 })).toBe(true);
    expect(isChasmEdge(g2, { x: 4, y: 4 })).toBe(false);
    for (const id of IDS) {
      const hero = heroC(8, 7, 5);
      const c = comp(id, 8, 2, 5);
      const { combat } = field([c, hero, dummy('far', 14, 2)], 'companion', 3, grid);
      runCompanionTurn(combat, grid, 'close');
      expect(`${c.pos.x},${c.pos.y}`, id).not.toBe('8,5');
    }
  });

  it('chooseCompanionCommand ends the turn when there is nothing to do and is always executable', () => {
    const hero = heroC(8, 3, 5);
    const dog = comp('blink_dog', 8, 4, 5);
    const foe = dummy('foe', 9, 5, { hp: 1 });
    const { combat } = field([dog, hero, foe], 'companion');
    for (let i = 0; i < 20 && combat.activeId === 'companion' && !combat.isOver; i++) {
      const c = chooseCompanionCommand(combat, nav, 'close');
      combat.execute(c);
    }
    expect(combat.activeId === 'companion' && !combat.isOver).toBe(false);
  });

  for (const id of IDS) {
    for (const stance of STANCES) {
      it(`${id} in ${stance} stance finishes fights, replays identically, and always ends its turn`, () => {
        const run = (seed: number): { log: string; won: boolean } => {
          const heroLevel = 10;
          const hero = heroC(heroLevel, 3, 5);
          const c = comp(id, heroLevel, 3, 4);
          const foes = [
            instantiateMonster(mon({ id: 'g1', name: 'g1', hp: 60, ac: 12, actions: [{ id: 'hit', name: 'Hit', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 5 }, damage: [{ dice: '1d8+2', type: 'slashing' }] }] }), 'g1', { x: 12, y: 4 }),
            instantiateMonster(mon({ id: 'g2', name: 'g2', hp: 60, ac: 12, actions: [{ id: 'hit', name: 'Hit', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 5 }, damage: [{ dice: '1d8+2', type: 'slashing' }] }] }), 'g2', { x: 12, y: 6 }),
            instantiateMonster(mon({ id: 'g3', name: 'g3', hp: 40, ac: 12, actions: [{ id: 'bow', name: 'Bow', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 12 }, attack: { bonus: 4 }, damage: [{ dice: '1d6+2', type: 'piercing' }] }] }), 'g3', { x: 13, y: 5 }),
          ];
          const combat = createCombat([hero, c, ...foes], nav, new Rng(seed));
          const events: GameEvent[] = [...combat.begin()];
          const driver = createPartyDriver(stance);
          let guard = 0;
          while (!combat.isOver && combat.round < 40 && guard++ < 600) events.push(...driver.playTurn(combat, nav));
          expect(combat.round, `${id}/${stance} timed out`).toBeLessThan(40);
          return { log: JSON.stringify(events), won: combat.winner === 'player' };
        };
        const a = run(41);
        const b = run(41);
        expect(a.log).toBe(b.log);
        expect(a.won).toBe(true);
      });
    }
  }
});

describe('companion rests and state', () => {
  it('syncCompanion keeps spent uses and sends a downed companion back at 1 HP; long rest restores everything', () => {
    const def = requireCompanion('sphinx_of_wonder');
    const state = newCompanionState(def.id, 8);
    const c = createCompanion(def, 8, state);
    c.hp = 7;
    (c.resources['spell:cure_wounds'] as { current: number }).current = 1;
    const after = syncCompanion(state, c);
    expect(after.hp).toBe(7);
    expect(after.resources['spell:cure_wounds']!.current).toBe(1);
    expect(createCompanion(def, 8, after).resources['spell:cure_wounds']!.current).toBe(1);
    expect(companionNeedsRest(after, def, 8)).toBe(true);
    const rested = companionLongRest(after, def, 8);
    expect(rested.hp).toBe(companionMaxHp(def, companionLevel(8)));
    expect(rested.resources['spell:cure_wounds']!.current).toBe(rested.resources['spell:cure_wounds']!.max);
    expect(companionNeedsRest(rested, def, 8)).toBe(false);
    const bigger = companionLongRest(after, def, 12); // levelled between floors: pools grow
    expect(bigger.hp).toBe(companionMaxHp(def, 10));
    expect(bigger.resources['spell:mass_healing_word']).toBeDefined();
  });

  it('a short rest heals with its own Hit Dice, never beyond full, and runs out of dice', () => {
    const def = requireCompanion('blink_dog');
    const state = { ...newCompanionState(def.id, 8), hp: 5 };
    const r = companionShortRest(state, def, 8, new Rng(3));
    expect(r.healed).toBeGreaterThan(0);
    expect(r.state.hp).toBeLessThanOrEqual(companionMaxHp(def, 6));
    expect(r.state.resources['_hitDice']!.current).toBeLessThan(6);
    const none = { ...state, resources: { ...state.resources, _hitDice: { name: 'Hit Dice', current: 0, max: 6, refresh: 'longRest' as const } } };
    expect(companionShortRest(none, def, 8, new Rng(3)).healed).toBe(0);
    const full = newCompanionState(def.id, 8);
    expect(companionShortRest(full, def, 8, new Rng(3)).healed).toBe(0);
  });

  it('swapping to another companion starts it at full health; the hero sync never carries companion state', () => {
    const fresh = newCompanionState('pseudodragon', 10);
    expect(fresh.hp).toBe(companionMaxHp(requireCompanion('pseudodragon'), 8));
    expect(fresh.stance).toBe('close');
    const pc = pcAt(8);
    const h = toCreature(pc, { x: 1, y: 1 });
    expect(syncFromCreature(pc, h).resources['_hitDice']).toBeUndefined();
  });
});

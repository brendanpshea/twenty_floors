import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, Creature, GameEvent, ItemDef, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
import { FIGHTER_LEVELS } from '../data/fighter';
import { abilityMod } from './util';
import { applyLevelUp, createCharacter, finalAbilities, previewLevelUp, suggestedLevelChoices, syncFromCreature, toCreature } from './character';
import { attacksLeft, createCombat } from './combat';
import { chooseCommand, runAiTurn, runTurnWith } from './ai';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { playerPolicy } from './sim';
import { FIXTURE_ITEMS, ScriptedRng, fixtureMonster, makeBuild, mon, spawn, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const crossbow: ItemDef = {
  id: 'light_crossbow',
  name: 'Light Crossbow',
  kind: 'weapon',
  description: '',
  cost: 25,
  weapon: { category: 'simple', melee: false, damage: { dice: '1d8', type: 'piercing' }, mastery: 'slow', properties: ['ammunition', 'loading', 'twoHanded'], range: { normal: 16, long: 64 } },
};
const rapier: ItemDef = {
  id: 'handaxe',
  name: 'Handaxe',
  kind: 'weapon',
  description: '',
  cost: 5,
  weapon: { category: 'simple', melee: true, damage: { dice: '1d6', type: 'slashing' }, mastery: 'vex', properties: ['light', 'thrown'], range: { normal: 4, long: 12 } },
};

beforeAll(() => setItemCatalog([...FIXTURE_ITEMS, crossbow, rapier]));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(14, 9);

function pcAt(level: number, over: Parameters<typeof makeBuild>[0] = {}, mutate?: (pc: PlayerCharacter) => PlayerCharacter): PlayerCharacter {
  const caster = over.backgroundId === 'sage';
  let pc = createCharacter(
    makeBuild({
      speciesId: 'dwarf',
      backgroundId: 'soldier',
      ...over,
      choices: { fightingStyle: 'defense', startingKit: 'a', ...(caster ? { mi_cantrip1: 'fire_bolt', mi_cantrip2: 'ray_of_frost', mi_spell: 'magic_missile', mi_ability: 'int' } : {}), ...(over.choices ?? {}) },
    }),
  );
  while (pc.level < level) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  return mutate ? mutate(pc) : pc;
}

function heroCreature(level: number, x: number, y: number, over: Parameters<typeof makeBuild>[0] = {}, mutate?: (pc: PlayerCharacter) => PlayerCharacter): Creature {
  const c = toCreature(pcAt(level, over, mutate), { x, y });
  delete c.resources['lastStand'];
  delete c.resources['_savageAttacker']; // keep scripted damage rolls one die per dice term
  return c;
}

function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function arena(creatures: Creature[], grid: NavGrid = nav): { combat: CombatApi; rng: ScriptedRng } {
  const rng = new ScriptedRng(11);
  const combat = startCombat(creatures, grid, rng, 'player');
  return { combat, rng };
}

const target = (id: string, x: number, y: number, over: Partial<MonsterDef> = {}): Creature => instantiateMonster(mon({ id, name: id, hp: 200, ac: 5, ...over }), id, { x, y });
const punchbag = (id: string, x: number, y: number, hp = 200): Creature => {
  const c = target(id, x, y, { actions: [] });
  c.hp = c.maxHp = hp;
  return c;
};

describe('Fighter levels 1 to 20', () => {
  const presets: [string, Parameters<typeof makeBuild>[0]][] = [
    ['defender', { choices: { fightingStyle: 'defense', startingKit: 'a' } }],
    ['great weapon', { choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'b' } }],
    ['archer', { baseAbilities: { str: 13, dex: 15, con: 14, int: 8, wis: 10, cha: 12 }, abilityIncreases: { dex: 2, con: 1 }, choices: { fightingStyle: 'archery', startingKit: 'c' } }],
  ];

  for (const [label, build] of presets) {
    it(`${label}: every level has the data table's proficiency, uses, hit points and choices`, () => {
      let pc = pcAt(1, build);
      const hpPer = (p: PlayerCharacter): number => Math.max(1, 10 + abilityMod(finalAbilities(p.build).con) + 1);
      for (let level = 2; level <= 20; level++) {
        const preview = previewLevelUp(pc);
        expect(preview, `level ${level}`).not.toBeNull();
        expect(preview?.toLevel).toBe(level);
        expect(preview?.featureSummaries.length).toBeGreaterThan(0);
        const row = FIGHTER_LEVELS[level - 1]!;
        // Choices: an ASI at the ASI levels, the second style at 7, the Epic Boon at 19, a mastery when the count grows.
        const keys = preview!.choices.map((s) => s.key);
        expect(keys.includes(`asi${level}`)).toBe(row.abilityScoreImprovement);
        expect(keys.includes('fightingStyle2')).toBe(level === 7);
        expect(keys.includes('epicBoon')).toBe(level === 19);
        expect(keys.includes(`mastery${level}`)).toBe([4, 10, 16].includes(level));
        const picks = suggestedLevelChoices(pc);
        expect(Object.keys(picks).sort()).toEqual(keys.sort());
        const before = pc;
        pc = applyLevelUp(pc, picks);
        expect(pc.level).toBe(level);
        // Hit points: maximum die + CON each level, counting every level at the current CON (retroactive ASI).
        expect(pc.maxHp).toBe(level * hpPer(pc));
        expect(pc.hp).toBe(before.hp + (pc.maxHp - before.maxHp));
        expect(pc.hitDiceLeft).toBe(level);
        expect(toCreature(pc, { x: 0, y: 0 }).proficiencyBonus).toBe(row.proficiencyBonus);
        expect(pc.resources['secondWind']?.max).toBe(row.secondWindUses);
        expect(pc.resources['actionSurge']?.max ?? 0).toBe(row.actionSurgeUses);
        expect(pc.resources['indomitable']?.max ?? 0).toBe(row.indomitableUses);
        const c = toCreature(pc, { x: 0, y: 0 });
        expect(c.resources['_attacks']?.current ?? 1).toBe(row.attacks);
        for (const f of row.flags) expect(c.resources[`_${f}`], `${f} at ${level}`).toBeDefined();
        const ab = finalAbilities(pc.build);
        for (const v of Object.values(ab)) expect(v).toBeLessThanOrEqual(30);
      }
      expect(previewLevelUp(pc)).toBeNull();
      const ab = finalAbilities(pc.build);
      expect(Math.max(ab.str, ab.dex)).toBeGreaterThanOrEqual(20);
      expect(pc.build.choices['fightingStyle2']).toBeDefined();
      expect(pc.build.choices['fightingStyle2']).not.toBe(pc.build.choices['fightingStyle']);
    });
  }

  it('Ability Score Improvement raises by 2 or by 1 and 1, capped at 20, and a Constitution gain is retroactive', () => {
    const pc3 = pcAt(3, { baseAbilities: { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 13 }, abilityIncreases: { str: 2, con: 1 } });
    expect(finalAbilities(pc3.build).con).toBe(14);
    const p = previewLevelUp(pc3)!;
    const asi = p.choices.find((s) => s.key === 'asi4')!;
    expect(asi.options).toHaveLength(21);
    expect(() => applyLevelUp(pc3, { asi4: 'bogus' })).toThrow();
    const split = applyLevelUp(pc3, { asi4: 'str+1,con+1', mastery4: (p.choices.find((s) => s.key === 'mastery4')!.options[0]!).id });
    expect(finalAbilities(split.build).str).toBe(18);
    expect(finalAbilities(split.build).con).toBe(15);
    // CON 14 -> 15 keeps the modifier at +2: no retroactive hit points. +2 CON (16) gives +3.
    const evenCon = applyLevelUp(pc3, { asi4: 'con+2', mastery4: (p.choices.find((s) => s.key === 'mastery4')!.options[0]!).id });
    expect(finalAbilities(evenCon.build).con).toBe(16);
    expect(evenCon.maxHp).toBe(pc3.maxHp + (10 + 3 + 1) + 1 * 3);
    // Capped: a score of 20 is no longer offered.
    const high = pcAt(3, { baseAbilities: { str: 15, dex: 12, con: 13, int: 8, wis: 10, cha: 13 }, abilityIncreases: { str: 2, con: 1 } }, (pc) => ({
      ...pc,
      build: { ...pc.build, choices: { ...pc.build.choices, asi4: 'str+2', asi6: 'str+2' } },
    }));
    expect(finalAbilities(high.build).str).toBe(20);
    const opts = previewLevelUp(high)!.choices.find((s) => s.key === 'asi4')!.options.map((o) => o.id);
    expect(opts.some((id) => id.includes('str'))).toBe(false);
  });

  it('offers a second fighting style at 7 that differs from the first and applies both', () => {
    const pc6 = pcAt(6);
    const slot = previewLevelUp(pc6)!.choices.find((s) => s.key === 'fightingStyle2')!;
    expect(slot.options.map((o) => o.id)).not.toContain('defense');
    const pc7 = applyLevelUp(pc6, { ...suggestedLevelChoices(pc6), fightingStyle2: 'archery' });
    const c = toCreature({ ...pc7, equipped: { ...pc7.equipped, ranged: 'longbow' }, inventory: [...pc7.inventory, { itemId: 'longbow', quantity: 1 }] }, { x: 0, y: 0 });
    const bow = c.actions.find((a) => a.id === 'atk_longbow')!;
    const dexMod = abilityMod(finalAbilities(pc7.build).dex);
    expect(bow.attack?.bonus).toBe(dexMod + 3 + 2); // proficiency +3 at level 7, Archery from the second style
    expect(c.ac).toBe(toCreature(pc6, { x: 0, y: 0 }).ac + 0); // Defense still applies
  });

  it('weapon masteries grow at 4, 10 and 16 and the new kind is usable', () => {
    let pc = pcAt(3);
    expect(pc.build.choices['masteries']!.split(',')).toHaveLength(3);
    pc = applyLevelUp(pc, { ...suggestedLevelChoices(pc), mastery4: 'halberd' });
    expect(pc.build.choices['masteries']!.split(',')).toHaveLength(4);
    expect(pc.build.choices['masteries']).toContain('halberd');
  });
});

describe('Extra Attack and the turn economy', () => {
  it('a level 5 hero makes two attacks with one action, moving between them', () => {
    const h = heroCreature(5, 2, 4);
    expect(h.resources['_attacks']?.current).toBe(2);
    const a = punchbag('a', 3, 4, 1);
    const b = punchbag('b', 7, 4, 50);
    const { combat, rng } = arena([h, a, b]);
    expect(attacksLeft(combat)).toBe(2);
    rng.queue = [15, 8, 8];
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'a' });
    expect(a.dead).toBe(true);
    expect(combat.turn.actionUsed).toBe(true);
    expect(attacksLeft(combat)).toBe(1);
    expect(combat.canUse('atk_longsword').ok).toBe(true);
    expect(combat.canUse('dash')).toMatchObject({ ok: false, reason: 'No action left' });
    // Walk next to b and make the second attack of the same action.
    combat.execute({ type: 'move', path: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }] });
    rng.queue = [15, 8, 8];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'b' });
    expect(ofType(ev, 'attackRoll')).toHaveLength(1);
    expect(attacksLeft(combat)).toBe(0);
    expect(combat.canUse('atk_longsword')).toMatchObject({ ok: false, reason: 'No attacks left' });
    expect(() => combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'b' })).toThrow(/No attacks left/);
  });

  it('three attacks at 11 and four at 20, and the count resets every turn', () => {
    for (const [level, n] of [[11, 3], [20, 4]] as const) {
      const h = heroCreature(level, 2, 4);
      const { combat } = arena([h, punchbag('a', 3, 4, 900)]);
      for (let i = 0; i < n; i++) {
        expect(attacksLeft(combat)).toBe(n - i);
        expect(combat.canUse('atk_longsword').ok).toBe(true);
        combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'a' });
      }
      expect(attacksLeft(combat)).toBe(0);
      expect(combat.canUse('atk_longsword').ok).toBe(false);
    }
  });

  it('Action Surge grants a second full Attack action, once per turn', () => {
    const h = heroCreature(17, 2, 4);
    expect(h.resources['actionSurge']?.max).toBe(2);
    const { combat } = arena([h, punchbag('a', 3, 4, 900)]);
    expect(combat.canUse('action_surge')).toMatchObject({ ok: false, reason: 'Use your action first' });
    for (let i = 0; i < 3; i++) combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(0);
    combat.execute({ type: 'action', actionId: 'action_surge' });
    expect(attacksLeft(combat)).toBe(3);
    for (let i = 0; i < 3; i++) combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(0);
    expect(combat.canUse('action_surge')).toMatchObject({ ok: false, reason: 'Action Surge already used this turn' });
    expect(h.resources['actionSurge']?.current).toBe(1);
  });

  it('a hero without Extra Attack is unchanged: one attack, then no action left', () => {
    const h = heroCreature(4, 2, 4);
    const { combat } = arena([h, punchbag('a', 3, 4, 900)]);
    expect(attacksLeft(combat)).toBe(1);
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(0);
    expect(combat.canUse('atk_longsword')).toMatchObject({ ok: false, reason: 'No action left' });
  });

  it('a spell takes the whole action, True Strike included (no Extra Attack)', () => {
    const h = heroCreature(5, 2, 4, { backgroundId: 'sage', baseAbilities: { str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8 }, abilityIncreases: { int: 2, con: 1 }, choices: { fightingStyle: 'defense', startingKit: 'a', mi_cantrip1: 'true_strike', mi_cantrip2: 'ray_of_frost' } });
    const { combat } = arena([h, punchbag('a', 3, 4, 900)]);
    combat.execute({ type: 'action', actionId: 'spell_true_strike', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(0);
    expect(combat.canUse('atk_longsword').ok).toBe(false);
  });

  it('Loading: a crossbow fires once per action however many attacks there are, the rest use another weapon', () => {
    const h = heroCreature(5, 2, 4, { choices: { fightingStyle: 'archery', startingKit: 'a' } }, (pc) => ({
      ...pc,
      equipped: { ...pc.equipped, ranged: 'light_crossbow' },
      inventory: [...pc.inventory, { itemId: 'light_crossbow', quantity: 1 }],
    }));
    const { combat } = arena([h, punchbag('a', 7, 4, 900)]);
    expect(combat.canUse('atk_light_crossbow').ok).toBe(true);
    combat.execute({ type: 'action', actionId: 'atk_light_crossbow', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(1);
    expect(combat.canUse('atk_light_crossbow')).toMatchObject({ ok: false, reason: 'Loading: one shot per action' });
    expect(combat.canUse('throw_javelin').ok).toBe(true);
  });

  it('thrown weapons: one throw per weapon carried, and they are not consumed', () => {
    const h = heroCreature(5, 2, 4, {}, (pc) => ({ ...pc, inventory: pc.inventory.map((s) => (s.itemId === 'javelin' ? { ...s, quantity: 1 } : s)) }));
    expect(h.resources['_carry_javelin']?.current).toBe(1);
    const { combat } = arena([h, punchbag('a', 6, 4, 900)]);
    combat.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'a' });
    expect(combat.canUse('throw_javelin')).toMatchObject({ ok: false, reason: expect.stringMatching(/No more/) });
    expect(h.resources['_carry_javelin']?.current).toBe(1); // still carried: not consumed
    const rich = heroCreature(5, 2, 4);
    const { combat: c2 } = arena([rich, punchbag('a', 6, 4, 900)]);
    c2.execute({ type: 'action', actionId: 'throw_javelin', targetId: 'a' });
    expect(c2.canUse('throw_javelin').ok).toBe(true); // four carried
  });

  it('Nick: the Light off-hand attack is part of the Attack action, once per turn, and Extra Attack still applies', () => {
    const h = heroCreature(5, 2, 4, { choices: { fightingStyle: 'defense', startingKit: 'c', masteries: 'shortsword,scimitar,longbow' } }, (pc) => ({
      ...pc,
      equipped: { armor: pc.equipped.armor, mainHand: 'shortsword', offHand: 'scimitar' },
    }));
    const off = h.actions.find((a) => a.effects?.includes('offhand'))!;
    expect(off.cost).toBe('free');
    const { combat } = arena([h, punchbag('a', 3, 4, 900)]);
    expect(combat.canUse(off.id)).toMatchObject({ ok: false });
    combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'a' });
    expect(combat.canUse(off.id).ok).toBe(true);
    combat.execute({ type: 'action', actionId: off.id, targetId: 'a' });
    expect(combat.turn.bonusUsed).toBe(false);
    expect(combat.canUse(off.id).ok).toBe(false);
    expect(attacksLeft(combat)).toBe(1); // the Nick attack did not use an Extra Attack
    combat.execute({ type: 'action', actionId: 'atk_shortsword', targetId: 'a' });
    expect(attacksLeft(combat)).toBe(0);
  });

  it('Cleave: on a melee hit a second attack against another creature next to the first, without the ability modifier, once per turn', () => {
    const h = heroCreature(5, 2, 4, { choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'b', masteries: 'halberd,greatsword,javelin' } }, (pc) => ({
      ...pc,
      inventory: [...pc.inventory, { itemId: 'halberd', quantity: 1 }],
      equipped: { armor: pc.equipped.armor, mainHand: 'halberd' },
    }));
    const atk = h.actions.find((a) => a.id === 'atk_halberd')!;
    expect(atk.effects?.some((e) => e.startsWith('mastery:cleave:'))).toBe(true);
    const first = punchbag('first', 3, 4, 900);
    const second = punchbag('second', 4, 4, 900); // within the halberd's reach (2) and next to the first
    const far = punchbag('far', 5, 8, 900);
    const { combat, rng } = arena([h, first, second, far]);
    rng.queue = [15, 5, 15, 5]; // hit, damage, cleave hit, damage
    const ev = combat.execute({ type: 'action', actionId: 'atk_halberd', targetId: 'first' });
    expect(ofType(ev, 'attackRoll').map((r) => r.targetId)).toEqual(['first', 'second']);
    const dmg = ofType(ev, 'damage');
    const strMod = abilityMod(finalAbilities(heroPc5Build()).str);
    expect(dmg[0]!.amount).toBe(5 + strMod); // 1d10 rolled 5 + modifier (GWF treats low dice as 3 or more; 5 stands)
    expect(dmg[1]!.amount).toBe(5); // cleave: no ability modifier
    // Once per turn.
    rng.queue = [15, 5, 15, 5];
    const ev2 = combat.execute({ type: 'action', actionId: 'atk_halberd', targetId: 'first' });
    expect(ofType(ev2, 'attackRoll').map((r) => r.targetId)).toEqual(['first']);
  });
});

function heroPc5Build(): PlayerCharacter['build'] {
  return pcAt(5, { choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'b', masteries: 'halberd,greatsword,javelin' } }).build;
}

describe('Fighter features', () => {
  it('Improved and Superior Critical: crits on 19 and on 18', () => {
    const at3 = heroCreature(3, 2, 4);
    const at15 = heroCreature(15, 2, 4);
    const rat = (id: string): Creature => punchbag(id, 3, 4, 900);
    for (const [h, roll, crit] of [[at3, 19, true], [at3, 18, false], [at15, 18, true], [at15, 17, false]] as const) {
      const { combat, rng } = arena([h, rat('r')]);
      rng.queue = [roll, 4, 4, 4, 4];
      const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'r' });
      expect(ofType(ev, 'attackRoll')[0]!.outcome === 'crit', `${h.level}:${roll}`).toBe(crit);
    }
  });

  it('Indomitable rerolls a failed save against a turn-losing effect, and not against a trivial one', () => {
    const paralyzer: ActionDef = { id: 'zap', name: 'Zap', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, save: { ability: 'wis', dc: 15, halfOnSave: false }, applies: { condition: 'paralyzed', rounds: 3 } };
    const minor: ActionDef = { id: 'poke', name: 'Poke', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, save: { ability: 'wis', dc: 15, halfOnSave: false }, applies: { condition: 'prone', rounds: 1 } };
    const h = heroCreature(9, 2, 4);
    expect(h.resources['indomitable']).toMatchObject({ current: 1, max: 1, refresh: 'longRest' });
    const caster = instantiateMonster(mon({ id: 'c', actions: [paralyzer, minor] }), 'c', { x: 3, y: 4 });
    const rng = new ScriptedRng(3);
    const combat = createCombat([caster, h], nav, rng);
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'c'; i++) combat.execute({ type: 'endTurn' });
    rng.queue = [1, 20]; // fail with a 1, then reroll a 20
    const ev = combat.execute({ type: 'action', actionId: 'poke', targetId: 'player' });
    expect(ofType(ev, 'saveRoll')).toHaveLength(1); // prone is not a turn-losing effect
    expect(h.resources['indomitable']?.current).toBe(1);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [1, 20];
    const ev2 = combat.execute({ type: 'action', actionId: 'zap', targetId: 'player' });
    const saves = ofType(ev2, 'saveRoll');
    expect(saves).toHaveLength(2);
    expect(saves[0]!.success).toBe(false);
    expect(saves[1]!.bonus).toBe(saves[0]!.bonus + 9); // Fighter level 9 added
    expect(saves[1]!.success).toBe(true);
    expect(h.resources['indomitable']?.current).toBe(0);
    expect(h.conditions.some((c) => c.condition === 'paralyzed')).toBe(false);
  });

  it('Indomitable also answers a heavy damage effect', () => {
    const breath: ActionDef = { id: 'breath', name: 'Breath', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, save: { ability: 'dex', dc: 25, halfOnSave: true }, damage: [{ dice: '20d10', type: 'fire' }] };
    const h = heroCreature(13, 2, 4);
    expect(h.resources['indomitable']?.max).toBe(2);
    const caster = instantiateMonster(mon({ id: 'd', actions: [breath] }), 'd', { x: 3, y: 4 });
    const rng = new ScriptedRng(3);
    const combat = createCombat([caster, h], nav, rng);
    combat.begin();
    for (let i = 0; i < 20 && combat.activeId !== 'd'; i++) combat.execute({ type: 'endTurn' });
    rng.queue = [1, 20, 5, 5];
    const ev = combat.execute({ type: 'action', actionId: 'breath', targetId: 'player' });
    expect(ofType(ev, 'saveRoll')).toHaveLength(2);
    expect(h.resources['indomitable']?.current).toBe(1);
  });

  it('Studied Attacks: after a miss, the next attack on that creature has advantage until the end of the next turn', () => {
    const h = heroCreature(13, 2, 4);
    const rat = punchbag('rat', 3, 4, 900);
    rat.ac = 30;
    const { combat, rng } = arena([h, rat]);
    rng.queue = [2, 2, 2];
    const ev1 = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev1, 'attackRoll')[0]!.mode).toBe('normal');
    rng.queue = [2, 2, 2];
    const ev2 = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev2, 'attackRoll')[0]!.mode).toBe('advantage');
    // Used up by that attack, and (the miss renewing it) it follows the new miss.
    rng.queue = [2, 2];
    const ev3 = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev3, 'attackRoll')[0]!.mode).toBe('advantage');
  });

  it('Heroic Warrior refills Heroic Inspiration at the start of each turn from level 10', () => {
    const h = heroCreature(10, 2, 4);
    h.resources['inspiration'] = { name: 'Heroic Inspiration', current: 0, max: 1, refresh: 'floor' };
    const { combat } = arena([h, punchbag('rat', 3, 4, 900)]);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(h.resources['inspiration']?.current).toBe(1);
    const low = heroCreature(9, 2, 4);
    low.resources['inspiration'] = { name: 'Heroic Inspiration', current: 0, max: 1, refresh: 'floor' };
    const { combat: c2 } = arena([low, punchbag('rat', 3, 4, 900)]);
    c2.execute({ type: 'endTurn' });
    c2.execute({ type: 'endTurn' });
    expect(low.resources['inspiration']?.current).toBe(0);
  });

  it('Survivor (18): Heroic Rally heals 5 + CON when bloodied, not when above half or at 0', () => {
    const h = heroCreature(18, 2, 4);
    const conMod = abilityMod(h.abilities.con);
    h.hp = Math.floor(h.maxHp / 2) - 40;
    const { combat } = arena([h, punchbag('rat', 3, 4, 900)]);
    const start = h.hp; // the first turn already started (and rallied once)
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(h.hp).toBe(start + 5 + conMod);
    const healthy = heroCreature(18, 2, 4);
    healthy.hp = healthy.maxHp - 3;
    const { combat: c2 } = arena([healthy, punchbag('rat', 3, 4, 900)]);
    c2.execute({ type: 'endTurn' });
    c2.execute({ type: 'endTurn' });
    expect(healthy.hp).toBe(healthy.maxHp - 3);
    const early = heroCreature(17, 2, 4);
    early.hp = 10;
    const { combat: c3 } = arena([early, punchbag('rat', 3, 4, 900)]);
    c3.execute({ type: 'endTurn' });
    c3.execute({ type: 'endTurn' });
    expect(early.hp).toBe(10);
  });

  it('Tactical Shift: Second Wind lets the hero step away from an enemy without an opportunity attack', () => {
    const rat = spawn('giant_rat', 'rat', 3, 4);
    const h = heroCreature(5, 2, 4);
    h.hp = 20;
    const { combat } = arena([h, rat]);
    combat.execute({ type: 'action', actionId: 'second_wind' });
    const ev = combat.execute({ type: 'move', path: [{ x: 1, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 5 }] });
    expect(ofType(ev, 'attackRoll')).toHaveLength(0);
    // Only half of the speed (3 of 6 cells): a fourth step provokes.
    const h2 = heroCreature(5, 6, 4);
    h2.hp = 20;
    const rat2 = spawn('giant_rat', 'rat', 7, 4);
    const { combat: c2 } = arena([h2, rat2]);
    c2.execute({ type: 'action', actionId: 'second_wind' });
    const ev2 = c2.execute({ type: 'move', path: [{ x: 5, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }] });
    expect(ofType(ev2, 'attackRoll')).toHaveLength(0); // the rat is left behind within the first cell, so no later step provokes
    // Below level 5 the same step provokes.
    const h3 = heroCreature(4, 2, 4);
    h3.hp = 20;
    const rat3 = spawn('giant_rat', 'rat', 3, 4);
    const { combat: c3 } = arena([h3, rat3]);
    c3.execute({ type: 'action', actionId: 'second_wind' });
    const ev3 = c3.execute({ type: 'move', path: [{ x: 1, y: 4 }] });
    expect(ofType(ev3, 'attackRoll')).toHaveLength(1);
  });

  it('Remarkable Athlete: after a critical hit the hero may move half speed without provoking', () => {
    const rat = spawn('giant_rat', 'rat', 3, 4);
    rat.hp = rat.maxHp = 500;
    const h = heroCreature(3, 2, 4);
    const { combat, rng } = arena([h, rat]);
    rng.queue = [20, 3, 3, 3];
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    const ev = combat.execute({ type: 'move', path: [{ x: 1, y: 4 }] });
    expect(ofType(ev, 'attackRoll')).toHaveLength(0);
  });

  it('Boon of Combat Prowess: Peerless Aim turns the first miss each turn into a hit', () => {
    const h = heroCreature(19, 2, 4);
    expect(h.resources['_combatProwess']).toBeDefined();
    const rat = punchbag('rat', 3, 4, 900);
    rat.ac = 40;
    const { combat, rng } = arena([h, rat]);
    rng.queue = [2, 4, 4, 2, 4, 4];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev, 'attackRoll')[0]!.outcome).toBe('hit');
    const ev2 = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'rat' });
    expect(ofType(ev2, 'attackRoll')[0]!.outcome).toBe('miss'); // once per turn
    const no = heroCreature(18, 2, 4);
    expect(no.resources['_combatProwess']).toBeUndefined();
  });

  it('Tactical Master: a Graze weapon uses Sap from level 9', () => {
    const grazer = (level: number): Creature =>
      heroCreature(level, 2, 4, { choices: { fightingStyle: 'greatWeaponFighting', startingKit: 'b', masteries: 'greatsword,javelin,longsword' } });
    expect(grazer(8).actions.find((a) => a.id === 'atk_greatsword')!.effects).toContain('mastery:graze:' + Math.max(0, abilityMod(grazer(8).abilities.str)));
    expect(grazer(9).actions.find((a) => a.id === 'atk_greatsword')!.effects).toContain('mastery:sap');
    expect(grazer(9).actions.find((a) => a.id === 'atk_greatsword')!.effects?.some((e) => e.startsWith('mastery:graze'))).toBe(false);
  });
});

describe('determinism and termination of the scripted hero', () => {
  const duel = (level: number, seed: number): { won: boolean; rounds: number; log: string } => {
    const pc = pcAt(level, { choices: { fightingStyle: 'defense', startingKit: 'a' } });
    const hero = toCreature(pc, { x: 2, y: 4 });
    const foes = [spawn('goblin_warrior', 'g1', 8, 4), spawn('ogre', 'o1', 9, 3), spawn('giant_spider', 's1', 9, 5)];
    for (const f of foes) {
      f.hp = f.maxHp = f.maxHp * (level >= 11 ? 3 : 2);
    }
    const combat = createCombat([hero, ...foes], nav, new Rng(seed));
    const events: GameEvent[] = [...combat.begin()];
    let guard = 0;
    while (!combat.isOver && combat.round < 60 && guard++ < 400) {
      if (combat.activeId === 'player') events.push(...runTurnWith(combat, (c) => playerPolicy(c, nav)));
      else events.push(...runAiTurn(combat, nav));
    }
    return { won: combat.winner === 'player', rounds: combat.round, log: JSON.stringify(events) };
  };

  for (const level of [5, 11, 17, 20]) {
    it(`level ${level}: the policy finishes fights and replays identically from a seed`, () => {
      const a = duel(level, 77);
      const b = duel(level, 77);
      expect(a.log).toBe(b.log);
      expect(a.rounds).toBeLessThan(60);
      expect(a.won).toBe(true);
    });
  }

  it('the policy switches to another damage type when the target is immune to the main weapon', () => {
    const h = heroCreature(5, 2, 4);
    const jelly = instantiateMonster(mon({ id: 'jelly', hp: 30, ac: 8, immunities: ['slashing'], actions: [] }), 'jelly', { x: 3, y: 4 });
    const combat = createCombat([h, jelly], nav, new Rng(5));
    combat.begin();
    for (let i = 0; i < 40 && !combat.isOver && combat.round < 30; i++) {
      if (combat.activeId === 'player') runTurnWith(combat, (c) => playerPolicy(c, nav));
      else runAiTurn(combat, nav);
    }
    expect(jelly.hp).toBeLessThan(30);
  });

  it('a monster bonus action is used: a priest-like healer heals itself when hurt', () => {
    const heal: ActionDef = { id: 'mend', name: 'Mend', description: '', cost: 'bonus', targeting: { kind: 'self' }, heal: '2d4+3', uses: { resource: 'Divine Aid', amount: 1 } };
    const strike: ActionDef = { id: 'hit', name: 'Hit', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 0 }, damage: [{ dice: '1', type: 'slashing' }] };
    const priest = instantiateMonster(mon({ id: 'priest', hp: 40, actions: [strike, heal] }), 'priest', { x: 3, y: 4 });
    priest.hp = 10;
    const h = heroCreature(5, 2, 4);
    const rng = new Rng(9);
    const combat = createCombat([priest, h], nav, rng);
    combat.begin();
    for (let i = 0; i < 6 && combat.activeId !== 'priest'; i++) combat.execute({ type: 'endTurn' });
    const events = runAiTurn(combat, nav);
    expect(events.some((e) => e.type === 'actionUsed' && e.actionId === 'mend')).toBe(true);
    expect(priest.hp).toBeGreaterThan(10);
    expect(chooseCommand).toBeDefined();
  });

  it('the hero and sync keep Extra Attack state out of the saved character', () => {
    const pc = pcAt(11);
    const c = toCreature(pc, { x: 0, y: 0 });
    const back = syncFromCreature(pc, c);
    expect(Object.keys(back.resources).some((k) => k.startsWith('_attacks') || k.startsWith('_carry'))).toBe(false);
    expect(previewLevelUp(back)?.toLevel).toBe(12);
    void fixtureMonster;
  });
});

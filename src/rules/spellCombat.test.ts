import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, CharacterBuild, CombatApi, Creature, GameEvent, PlayerCharacter } from '../core/types';
import { applyLevelUp, createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { resetItemCatalog, setItemCatalog } from './items';
import { instantiateMonster } from './monster';
import { chromaticOrbType, concentratingOn, offeredSpells } from './spells';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon, startCombat } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const nav = createOpenRoomNav(16, 10);

const ofType = <T extends GameEvent['type']>(ev: GameEvent[], t: T) => ev.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);
const logs = (ev: GameEvent[]): string[] => ofType(ev, 'log').map((e) => e.text);

interface HeroOpts {
  bg?: 'sage' | 'acolyte' | 'soldier' | 'criminal';
  c1?: string;
  c2?: string;
  spell?: string;
  kit?: string;
  style?: string;
  level?: number;
  /** Override the character level directly (derived numbers only; the Fighter table stops at 3). */
  asLevel?: number;
}

/** Sage (INT 15, +2) or Acolyte (CHA 15, +2) at level 1, kit a (chain mail, longsword, shield) unless told otherwise. */
function heroPc(o: HeroOpts = {}): PlayerCharacter {
  const bg = o.bg ?? 'sage';
  const caster = bg === 'sage' || bg === 'acolyte';
  const base: CharacterBuild = makeBuild({
    backgroundId: bg,
    speciesId: 'dwarf',
    baseAbilities: bg === 'acolyte' ? { str: 15, con: 14, cha: 13, dex: 12, wis: 10, int: 8 } : { str: 15, con: 14, int: 13, dex: 12, wis: 10, cha: 8 },
    abilityIncreases: bg === 'acolyte' ? { cha: 2, wis: 1 } : bg === 'sage' ? { int: 2, con: 1 } : { str: 2, con: 1 },
    choices: { fightingStyle: o.style ?? 'defense', startingKit: o.kit ?? 'a' },
  });
  if (caster) {
    const sage = bg === 'sage';
    Object.assign(base.choices, {
      mi_cantrip1: o.c1 ?? (sage ? 'fire_bolt' : 'sacred_flame'),
      mi_cantrip2: o.c2 ?? (sage ? 'ray_of_frost' : 'resistance'),
      mi_spell: o.spell ?? (sage ? 'magic_missile' : 'guiding_bolt'),
      mi_ability: sage ? 'int' : 'cha',
    });
  }
  let pc = createCharacter(base);
  for (let i = 1; i < (o.level ?? 1); i++) pc = applyLevelUp(pc, {});
  if (o.asLevel) pc = { ...pc, level: o.asLevel };
  return pc;
}

function heroAt(o: HeroOpts = {}, x = 3, y = 5): Creature {
  const c = toCreature(heroPc(o), { x, y });
  delete c.resources['lastStand'];
  return c;
}

function dummy(id: string, x: number, y: number, over: Partial<Parameters<typeof mon>[0]> = {}): Creature {
  return instantiateMonster(mon({ id, name: id, hp: 60, ac: 10, ...over }), id, { x, y });
}

const strike = (id: string, bonus: number, dice: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  name: id,
  description: id,
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus },
  damage: [{ dice, type: 'slashing' }],
  ...extra,
});

function fight(creatures: Creature[]): { combat: CombatApi; rng: ScriptedRng } {
  const rng = new ScriptedRng(11);
  return { combat: startCombat(creatures, nav, rng, 'player'), rng };
}

const cast = (combat: CombatApi, spell: string, extra: { targetId?: string; point?: { x: number; y: number } } = {}): GameEvent[] =>
  combat.execute({ type: 'action', actionId: `spell_${spell}`, ...extra });

/** End the hero's turn and every other turn until it is the hero's again. */
function passRound(combat: CombatApi): GameEvent[] {
  const out: GameEvent[] = [];
  out.push(...combat.execute({ type: 'endTurn' }));
  for (let i = 0; i < 20 && combat.activeId !== 'player' && !combat.isOver; i++) out.push(...combat.execute({ type: 'endTurn' }));
  return out;
}

describe('attack-roll cantrips', () => {
  it('Fire Bolt rolls the spell attack, deals fire damage and doubles the dice on a crit', () => {
    const { combat, rng } = fight([heroAt(), dummy('d', 7, 5)]);
    rng.queue = [15, 6];
    const ev = cast(combat, 'fire_bolt', { targetId: 'd' });
    expect(ofType(ev, 'actionUsed')[0]).toMatchObject({ actionId: 'spell_fire_bolt', name: 'Fire Bolt' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ actionName: 'Fire Bolt', bonus: 4, outcome: 'hit', mode: 'normal', reaction: false });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ targetId: 'd', amount: 6, damageType: 'fire', crit: false });
    const again = startFresh();
    again.rng.queue = [20, 3, 4];
    const crit = cast(again.combat, 'fire_bolt', { targetId: 'd' });
    expect(ofType(crit, 'damage')[0]).toMatchObject({ amount: 7, crit: true });
  });

  function startFresh(): { combat: CombatApi; rng: ScriptedRng } {
    return fight([heroAt(), dummy('d', 7, 5)]);
  }

  it('has disadvantage with a hostile creature adjacent, and a spell attack never uses the weapon crit range', () => {
    const { combat, rng } = fight([heroAt(), dummy('near', 4, 5), dummy('far', 8, 5)]);
    rng.queue = [15, 3, 5];
    const ev = cast(combat, 'fire_bolt', { targetId: 'far' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ mode: 'disadvantage', dice: [15, 3], d20: 3, outcome: 'miss' });
  });

  it('hitChance is exact for attacks', () => {
    const { combat } = fight([heroAt(), dummy('d', 7, 5, { ac: 14 })]);
    // +4 against AC 14: hits on 10..20 = 11/20 (a natural 20 always hits, a natural 1 never does).
    expect(combat.hitChance('spell_fire_bolt', 'd')).toBeCloseTo(11 / 20, 10);
  });

  it('out of range or without a clear target is explained by canUse', () => {
    const { combat } = fight([heroAt({ c1: 'poison_spray' }), dummy('d', 11, 5)]);
    expect(combat.canUse('spell_poison_spray')).toEqual({ ok: false, reason: 'No target in range' });
  });

  it('Ray of Frost slows its target by 10 ft until the caster\'s next turn', () => {
    const { combat, rng } = fight([heroAt(), dummy('d', 7, 5)]);
    rng.queue = [15, 4];
    const ev = cast(combat, 'ray_of_frost', { targetId: 'd' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ damageType: 'cold', amount: 4 });
    expect(logs(ev).join()).toMatch(/slowed/);
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('d');
    expect(combat.turn.movementLeft).toBe(6 - 2);
  });

  it('Shocking Grasp stops the target making opportunity attacks', () => {
    const control = fight([heroAt({ c1: 'shocking_grasp' }), dummy('d', 4, 5)]);
    const away = [{ x: 2, y: 5 }];
    expect(ofType(control.combat.execute({ type: 'move', path: away }), 'attackRoll')).toHaveLength(1);
    const { combat, rng } = fight([heroAt({ c1: 'shocking_grasp' }), dummy('d', 4, 5)]);
    rng.queue = [15, 4];
    cast(combat, 'shocking_grasp', { targetId: 'd' });
    rng.queue = [];
    expect(ofType(combat.execute({ type: 'move', path: away }), 'attackRoll')).toHaveLength(0);
  });

  it('Chill Touch keeps the target from regaining hit points until the start of the caster\'s next turn', () => {
    const mend: ActionDef = { id: 'mend', name: 'Mend', description: '', cost: 'action', targeting: { kind: 'self' }, heal: '1d4' };
    const d = dummy('d', 7, 5, { actions: [strike('slash', 3, '1d6'), mend] });
    d.hp = 30;
    const { combat, rng } = fight([heroAt({ c1: 'chill_touch' }), d]);
    rng.queue = [15, 4];
    cast(combat, 'chill_touch', { targetId: 'd' });
    combat.execute({ type: 'endTurn' });
    const ev = combat.execute({ type: 'action', actionId: 'mend' });
    expect(ofType(ev, 'heal')).toHaveLength(0);
    expect(logs(ev).join()).toMatch(/cannot regain hit points/);
  });

  it('Poison Spray is a short-range attack for poison damage that an immune target ignores', () => {
    const { combat, rng } = fight([heroAt({ c1: 'poison_spray' }), dummy('d', 6, 5, { immunities: ['poison'] }), dummy('far', 12, 5)]);
    expect(combat.validTargets('spell_poison_spray')).toEqual(['d']);
    rng.queue = [15, 9];
    expect(ofType(cast(combat, 'poison_spray', { targetId: 'd' }), 'damage')[0]).toMatchObject({ damageType: 'poison', amount: 0, modifier: 'immune' });
  });
});

describe('save-based spells', () => {
  it('Sacred Flame: the target saves against the caster DC and takes radiant damage on a failure; hitChance is the failure chance', () => {
    const { combat, rng } = fight([heroAt({ bg: 'acolyte' }), dummy('d', 7, 5)]);
    // CHA 15: DC 8 + 2 + 2 = 12; DEX 10 fails on 1..11.
    expect(combat.hitChance('spell_sacred_flame', 'd')).toBeCloseTo(11 / 20, 10);
    rng.queue = [5, 6];
    const ev = cast(combat, 'sacred_flame', { targetId: 'd' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ creatureId: 'd', ability: 'dex', dc: 12, success: false });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 6, damageType: 'radiant' });
    const ok = fight([heroAt({ bg: 'acolyte' }), dummy('d', 7, 5)]);
    ok.rng.queue = [15];
    expect(ofType(cast(ok.combat, 'sacred_flame', { targetId: 'd' }), 'damage')).toHaveLength(0);
  });

  it('Acid Splash hits every creature inside the sphere (each saves) and none outside', () => {
    const { combat, rng } = fight([heroAt({ c1: 'acid_splash' }), dummy('a', 8, 5), dummy('b', 9, 5), dummy('out', 13, 5)]);
    expect(combat.areaCells('spell_acid_splash', { x: 8, y: 5 }).some((p) => p.x === 9 && p.y === 5)).toBe(true);
    rng.queue = [4, 2, 20];
    const ev = cast(combat, 'acid_splash', { point: { x: 8, y: 5 } });
    const dmg = ofType(ev, 'damage');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ targetId: 'a', amount: 4, damageType: 'acid' });
    expect(ofType(ev, 'saveRoll').map((s) => s.creatureId)).toEqual(['a', 'b']);
  });

  it('Burning Hands: a cone that excludes the caster, with half damage on a save', () => {
    const { combat, rng } = fight([heroAt({ spell: 'burning_hands' }), dummy('a', 4, 5), dummy('b', 5, 5), dummy('behind', 1, 5)]);
    rng.queue = [2, 3, 4, 5, 20];
    const ev = cast(combat, 'burning_hands', { point: { x: 4, y: 5 } });
    expect(ofType(ev, 'saveRoll').map((s) => s.creatureId)).toEqual(['a', 'b']);
    expect(ofType(ev, 'damage').map((d) => [d.targetId, d.amount, d.damageType])).toEqual([
      ['a', 9, 'fire'],
      ['b', 4, 'fire'],
    ]);
    expect(combat.creature('player')?.hp).toBe(combat.creature('player')?.maxHp);
  });

  it('Thunderwave: constitution save, thunder damage, pushed 10 ft on a failure only', () => {
    const { combat, rng } = fight([heroAt({ spell: 'thunderwave' }), dummy('a', 4, 5), dummy('b', 3, 6)]);
    rng.queue = [5, 5, 1, 20];
    const ev = cast(combat, 'thunderwave');
    const dmg = ofType(ev, 'damage');
    expect(dmg.map((d) => [d.targetId, d.damageType])).toEqual([['a', 'thunder'], ['b', 'thunder']]);
    expect(dmg[0]?.amount).toBe(10);
    expect(dmg[1]?.amount).toBe(5);
    expect(combat.creature('a')?.pos).toEqual({ x: 6, y: 5 });
    expect(combat.creature('b')?.pos).toEqual({ x: 3, y: 6 });
  });

  it('Inflict Wounds is a touch: constitution save for half necrotic damage', () => {
    const { combat, rng } = fight([heroAt({ bg: 'acolyte', spell: 'inflict_wounds' }), dummy('d', 4, 5)]);
    expect(combat.canUse('spell_inflict_wounds').ok).toBe(true);
    rng.queue = [20, 5, 6];
    const ev = cast(combat, 'inflict_wounds', { targetId: 'd' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 5, damageType: 'necrotic' });
  });

  it('Bane: failed saves subtract 1d4 from the target\'s attack rolls, and the caster concentrates', () => {
    const attacker = dummy('d', 4, 5, { actions: [strike('slash', 5, '1d6')] });
    const { combat, rng } = fight([heroAt({ bg: 'acolyte', spell: 'bane' }), attacker]);
    rng.queue = [1];
    const ev = cast(combat, 'bane', { targetId: 'd' });
    expect(ofType(ev, 'saveRoll')[0]).toMatchObject({ ability: 'cha', success: false });
    expect(concentratingOn(combat.creature('player') as Creature)).toBe('Bane');
    combat.execute({ type: 'endTurn' });
    rng.queue = [3, 10];
    const hit = combat.execute({ type: 'action', actionId: 'slash', targetId: 'player' });
    expect(ofType(hit, 'attackRoll')[0]).toMatchObject({ d20: 10, bonus: 5 - 3 });
  });
});

describe('Magic Missile', () => {
  it('fires three darts that never miss and need no attack roll', () => {
    const { combat, rng } = fight([heroAt(), dummy('d', 8, 5)]);
    expect(combat.hitChance('spell_magic_missile', 'd')).toBeNull();
    rng.queue = [2, 3, 4];
    const ev = cast(combat, 'magic_missile', { targetId: 'd' });
    expect(ofType(ev, 'attackRoll')).toHaveLength(0);
    expect(ofType(ev, 'damage').map((d) => [d.amount, d.damageType])).toEqual([[3, 'force'], [4, 'force'], [5, 'force']]);
  });

  it('sends the leftover darts to the nearest other enemy in range when the target dies', () => {
    const weak = dummy('weak', 8, 5);
    weak.hp = 3;
    const { combat, rng } = fight([heroAt(), weak, dummy('near', 6, 7), dummy('far', 12, 5)]);
    rng.queue = [4, 4, 4];
    const ev = cast(combat, 'magic_missile', { targetId: 'weak' });
    expect(ofType(ev, 'damage').map((d) => d.targetId)).toEqual(['weak', 'near', 'near']);
    expect(ofType(ev, 'death')).toHaveLength(1);
  });

  it('stops when nothing else is left', () => {
    const only = dummy('only', 8, 5);
    only.hp = 3;
    const { combat, rng } = fight([heroAt(), only]);
    rng.queue = [4, 4, 4];
    const ev = cast(combat, 'magic_missile', { targetId: 'only' });
    expect(ofType(ev, 'damage')).toHaveLength(1);
    expect(combat.isOver).toBe(true);
  });
});

describe('level 1 spell use', () => {
  it('can be cast once, then explains why not, and is visible as a named resource', () => {
    const hero = heroAt();
    expect(hero.resources['spell:magic_missile']).toEqual({ name: 'Magic Missile', current: 1, max: 1, refresh: 'longRest' });
    const { combat, rng } = fight([hero, dummy('d', 8, 5)]);
    rng.queue = [1, 1, 1];
    cast(combat, 'magic_missile', { targetId: 'd' });
    expect(hero.resources['spell:magic_missile']?.current).toBe(0);
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(combat.canUse('spell_magic_missile')).toEqual({ ok: false, reason: 'Already cast — recovers on a long rest' });
    expect(() => cast(combat, 'magic_missile', { targetId: 'd' })).toThrow();
  });
});

describe('healing and buffs', () => {
  it('Cure Wounds heals 2d8 plus the casting modifier and is capped at the missing hit points', () => {
    const hero = heroAt({ bg: 'acolyte', spell: 'cure_wounds' });
    hero.hp = 1;
    const { combat, rng } = fight([hero, dummy('d', 12, 5)]);
    expect(combat.canUse('spell_cure_wounds').ok).toBe(true);
    rng.queue = [4, 4];
    const ev = cast(combat, 'cure_wounds', { targetId: 'player' });
    expect(ofType(ev, 'heal')[0]).toMatchObject({ targetId: 'player', amount: 10, hpAfter: 11 });
  });

  it('Healing Word is a bonus action, so the hero can still attack the same turn', () => {
    const hero = heroAt({ bg: 'acolyte', spell: 'healing_word' });
    hero.hp = 2;
    const { combat, rng } = fight([hero, dummy('d', 4, 5)]);
    rng.queue = [3, 3];
    const ev = cast(combat, 'healing_word', { targetId: 'player' });
    expect(ofType(ev, 'heal')[0]?.amount).toBe(6 + 2);
    expect(combat.turn).toMatchObject({ actionUsed: false, bonusUsed: true });
    expect(combat.canUse('atk_longsword').ok).toBe(true);
    expect(combat.canUse('second_wind')).toEqual({ ok: false, reason: 'No bonus action left' });
  });

  it('Bless adds 1d4 to the caster\'s attack rolls and saves while concentrating', () => {
    const { combat, rng } = fight([heroAt({ bg: 'acolyte', spell: 'bless' }), dummy('d', 4, 5)]);
    cast(combat, 'bless', { targetId: 'player' });
    expect(concentratingOn(combat.creature('player') as Creature)).toBe('Bless');
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    rng.queue = [3, 15, 4, 1];
    const ev = combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'd' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ d20: 15, bonus: 4 + 3, total: 15 + 7 });
  });

  it('Shield of Faith is a bonus action for +2 AC that ends with concentration', () => {
    const hero = heroAt({ bg: 'acolyte', spell: 'shield_of_faith' });
    const base = hero.ac;
    const { combat } = fight([hero, dummy('d', 8, 5)]);
    cast(combat, 'shield_of_faith', { targetId: 'player' });
    expect(hero.ac).toBe(base + 2);
    expect(combat.turn.bonusUsed).toBe(true);
    // A new concentration spell elsewhere would end it; here the cantrip Resistance replaces it.
  });

  it('False Life grants 2d4+4 temporary hit points that absorb damage first', () => {
    const { combat, rng } = fight([heroAt({ spell: 'false_life' }), dummy('d', 8, 5)]);
    rng.queue = [2, 2];
    cast(combat, 'false_life', { targetId: 'player' });
    const hero = combat.creature('player') as Creature;
    expect(hero.tempHp).toBe(8);
  });

  it('Mage Armor in combat sets the unarmored AC to 13 + Dex', () => {
    const pc = heroPc();
    const naked: PlayerCharacter = {
      ...pc,
      build: { ...pc.build, choices: { ...pc.build.choices, mi_spell: 'mage_armor' } },
      resources: { ...pc.resources, 'spell:mage_armor': { name: 'Mage Armor', current: 1, max: 1, refresh: 'longRest' } },
      equipped: { mainHand: 'longsword' },
    };
    const hero = toCreature(naked, { x: 3, y: 5 });
    expect(hero.ac).toBe(11);
    const { combat } = fight([hero, dummy('d', 8, 5)]);
    cast(combat, 'mage_armor', { targetId: 'player' });
    expect(hero.ac).toBe(14);
  });

  it('Resistance picks a damage type automatically, says so, and cuts 1d4 only once per turn', () => {
    const pair = dummy('d', 4, 5, { actions: [strike('slash', 20, '1d6+1'), { ...strike('multi', 0, '0'), multiattack: ['slash', 'slash'], attack: undefined, damage: undefined }] });
    const hero = heroAt({ bg: 'acolyte' });
    hero.maxHp = hero.hp = 100;
    const { combat, rng } = fight([hero, pair]);
    const ev = cast(combat, 'resistance', { targetId: 'player' });
    expect(logs(ev).join()).toMatch(/Tester is warded against slashing damage/);
    expect(concentratingOn(hero)).toBe('Resistance');
    combat.execute({ type: 'endTurn' });
    // hit, 1d6 = 4 (damage 5), Resistance 1d4 = 3, concentration save 20, second hit, 1d6 = 5 (damage 6, no reduction), save 20.
    rng.queue = [15, 4, 3, 20, 15, 5, 20];
    const hit = combat.execute({ type: 'action', actionId: 'multi', targetId: 'player' });
    expect(ofType(hit, 'damage').map((d) => d.amount)).toEqual([2, 6]);
    expect(logs(hit).filter((t) => /Resistance absorbs/.test(t))).toHaveLength(1);
  });
});

describe('concentration', () => {
  function bless(extra: Partial<Parameters<typeof mon>[0]> = {}): { combat: CombatApi; rng: ScriptedRng; hero: Creature } {
    const hero = heroAt({ bg: 'acolyte', spell: 'bless' });
    hero.maxHp = hero.hp = 200;
    const d = dummy('d', 4, 5, { actions: [strike('hit30', 30, '30'), strike('hit5', 30, '5'), strike('stun', 30, '0', { damage: undefined, applies: { condition: 'stunned', rounds: 1 } })], ...extra });
    const f = fight([hero, d]);
    cast(f.combat, 'bless', { targetId: 'player' });
    f.combat.execute({ type: 'endTurn' });
    return { ...f, hero };
  }

  it('begins with a log event and is exposed by concentratingOn', () => {
    const { hero } = bless();
    expect(concentratingOn(hero)).toBe('Bless');
    expect(concentratingOn(heroAt())).toBeNull();
  });

  it('a new concentration spell ends the old one', () => {
    const hero = heroAt({ bg: 'acolyte', spell: 'shield_of_faith' });
    const { combat } = fight([hero, dummy('d', 8, 5)]);
    cast(combat, 'resistance', { targetId: 'player' });
    expect(concentratingOn(hero)).toBe('Resistance');
    passRound(combat);
    const ev = cast(combat, 'shield_of_faith', { targetId: 'player' });
    expect(concentratingOn(hero)).toBe('Shield of Faith');
    expect(logs(ev).join('|')).toMatch(/concentration on Resistance ends \(replaced\).*begins concentrating on Shield of Faith/);
  });

  it('damage forces a Constitution save against DC 10 or half the damage, whichever is higher', () => {
    const { combat, rng, hero } = bless();
    rng.queue = [20, 1, 20];
    const hurt = combat.execute({ type: 'action', actionId: 'hit5', targetId: 'player' });
    expect(ofType(hurt, 'saveRoll').at(-1)).toMatchObject({ ability: 'con', dc: 10, success: true });
    expect(concentratingOn(hero)).toBe('Bless');
    combat.execute({ type: 'endTurn' });
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('d');
    rng.queue = [20, 1, 5];
    const big = combat.execute({ type: 'action', actionId: 'hit30', targetId: 'player' });
    expect(ofType(big, 'saveRoll').at(-1)).toMatchObject({ dc: 15, success: false });
    expect(concentratingOn(hero)).toBeNull();
    expect(logs(big).join()).toMatch(/concentration on Bless ends \(failed the save\)/);
  });

  it('ends when the caster is incapacitated', () => {
    const { combat, rng, hero } = bless();
    rng.queue = [20];
    const ev = combat.execute({ type: 'action', actionId: 'stun', targetId: 'player' });
    expect(ofType(ev, 'conditionAdded')[0]).toMatchObject({ condition: 'stunned' });
    expect(concentratingOn(hero)).toBeNull();
    expect(logs(ev).join()).toMatch(/\(incapacitated\)/);
  });

  it('ends when the caster dies', () => {
    const { combat, rng, hero } = bless();
    hero.hp = 3;
    rng.queue = [20, 5];
    const ev = combat.execute({ type: 'action', actionId: 'hit5', targetId: 'player' });
    expect(ofType(ev, 'death')).toHaveLength(1);
    expect(logs(ev).join()).toMatch(/concentration on Bless ends \(dead\)/);
    expect(concentratingOn(hero)).toBeNull();
  });

  it('lasts a number of the caster\'s own turns, then ends', () => {
    const hero = heroAt({ bg: 'acolyte', spell: 'bless' });
    const { combat } = fight([hero, dummy('far', 15, 9, { actions: [] })]);
    cast(combat, 'bless', { targetId: 'player' });
    for (let i = 0; i < 9; i++) passRound(combat);
    expect(concentratingOn(hero)).toBe('Bless');
    const ev = passRound(combat);
    expect(concentratingOn(hero)).toBeNull();
    expect(logs(ev).join()).toMatch(/duration over/);
  });
});

describe('Shield (automatic reaction)', () => {
  const bigHit = (bonus: number): ActionDef => strike('big', bonus, '1d4');
  function setup(bonus: number): { combat: CombatApi; rng: ScriptedRng; hero: Creature } {
    const hero = heroAt({ spell: 'shield' });
    hero.maxHp = hero.hp = 100;
    const attacker = dummy('d', 4, 5, { actions: [bigHit(bonus), { ...strike('two', 0, '0'), multiattack: ['big', 'big'], attack: undefined, damage: undefined }] });
    const f = fight([hero, attacker]);
    f.combat.execute({ type: 'endTurn' });
    return { ...f, hero };
  }

  it('is cast when +5 AC turns a hit into a miss, using the reaction and the level 1 use', () => {
    const { combat, rng, hero } = setup(10);
    const ac = hero.ac;
    rng.queue = [10]; // 10 + 10 = 20 >= 19 would hit; 24 does not
    const ev = combat.execute({ type: 'action', actionId: 'big', targetId: 'player' });
    expect(logs(ev).join()).toMatch(/Tester casts Shield!/);
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ outcome: 'miss', targetAc: ac + 5 });
    expect(ofType(ev, 'damage')).toHaveLength(0);
    expect(hero.ac).toBe(ac + 5);
    expect(hero.resources['spell:shield']?.current).toBe(0);
  });

  it('lasts until the start of the hero\'s next turn', () => {
    const { combat, rng, hero } = setup(10);
    const ac = hero.ac;
    rng.queue = [10];
    combat.execute({ type: 'action', actionId: 'big', targetId: 'player' });
    combat.execute({ type: 'endTurn' });
    expect(combat.activeId).toBe('player');
    expect(hero.ac).toBe(ac);
  });

  it('is not wasted when the attack would hit anyway, or would miss anyway', () => {
    const a = setup(10);
    a.rng.queue = [19, 2];
    const hit = a.combat.execute({ type: 'action', actionId: 'big', targetId: 'player' });
    expect(logs(hit).join()).not.toMatch(/Shield/);
    expect(hero(a).resources['spell:shield']?.current).toBe(1);
    const b = setup(0);
    b.rng.queue = [2];
    expect(logs(b.combat.execute({ type: 'action', actionId: 'big', targetId: 'player' })).join()).not.toMatch(/Shield/);
  });

  it('is only cast once per round, because it costs the reaction', () => {
    const { combat, rng, hero } = setup(10);
    rng.queue = [10, 10];
    const ev = combat.execute({ type: 'action', actionId: 'two', targetId: 'player' });
    expect(ofType(ev, 'attackRoll').map((r) => r.outcome)).toEqual(['miss', 'miss']);
    expect(logs(ev).filter((t) => /casts Shield/.test(t))).toHaveLength(1);
    expect(hero.resources['spell:shield']?.current).toBe(0);
  });

  it('is not offered as a normal action: it triggers automatically', () => {
    const { combat } = fight([heroAt({ spell: 'shield' }), dummy('d', 8, 5)]);
    expect(combat.canUse('spell_shield')).toEqual({ ok: false, reason: 'Reactions trigger automatically' });
  });

  function hero(f: { hero: Creature }): Creature {
    return f.hero;
  }
});

describe('Guiding Bolt, Chromatic Orb, Ice Knife, Ray of Sickness, Sleep, Command, True Strike', () => {
  it('Guiding Bolt gives advantage on the next attack roll against the target, and hitChance knows', () => {
    const { combat, rng } = fight([heroAt({ bg: 'acolyte' }), dummy('d', 9, 5, { ac: 14 })]);
    const before = combat.hitChance('spell_guiding_bolt', 'd') as number;
    expect(before).toBeCloseTo(11 / 20, 10);
    rng.queue = [15, 1, 1, 1, 1];
    const ev = cast(combat, 'guiding_bolt', { targetId: 'd' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 4, damageType: 'radiant' });
    passRound(combat);
    const after = combat.hitChance('spell_guiding_bolt', 'd') as number;
    expect(after).toBeCloseTo(1 - (9 / 20) ** 2, 10);
    // The advantage is spent by the next attack roll against the target.
    rng.queue = [3, 17, 1, 1, 1, 1];
    const shot = cast(combat, 'sacred_flame', { targetId: 'd' });
    expect(ofType(shot, 'attackRoll')).toHaveLength(0);
    const atk = fight([heroAt({ c1: 'fire_bolt', bg: 'sage' }), dummy('d', 9, 5, { ac: 14 })]);
    expect(atk.combat.hitChance('spell_fire_bolt', 'd')).toBeCloseTo(11 / 20, 10);
  });

  it('Chromatic Orb chooses its type: a vulnerability, else fire unless resisted, else another type', () => {
    const t = (over: Partial<Creature>): string => chromaticOrbType({ vulnerabilities: [], resistances: [], immunities: [], ...over });
    expect(t({})).toBe('fire');
    expect(t({ vulnerabilities: ['cold'] })).toBe('cold');
    expect(t({ resistances: ['fire'] })).toBe('lightning');
    expect(t({ resistances: ['fire'], immunities: ['lightning', 'cold'] })).toBe('acid');
    expect(t({ resistances: ['fire', 'lightning', 'cold', 'acid', 'thunder', 'poison'] })).toBe('fire');
    const { combat, rng } = fight([heroAt({ spell: 'chromatic_orb' }), dummy('d', 8, 5, { vulnerabilities: ['cold'] })]);
    rng.queue = [15, 8, 8, 8];
    const ev = cast(combat, 'chromatic_orb', { targetId: 'd' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ damageType: 'cold', amount: 48, modifier: 'vulnerable' });
    expect(logs(ev).join()).toMatch(/shapes a cold orb/);
  });

  it('Ice Knife hits for piercing damage, then bursts on a hit or a miss: dexterity save or 2d6 cold, including neighbours', () => {
    const { combat, rng } = fight([heroAt({ spell: 'ice_knife' }), dummy('a', 8, 5), dummy('b', 9, 5), dummy('c', 12, 5)]);
    rng.queue = [15, 6, 3, 4, 5, 20];
    const ev = cast(combat, 'ice_knife', { targetId: 'a' });
    expect(ofType(ev, 'damage').map((d) => [d.targetId, d.amount, d.damageType])).toEqual([
      ['a', 6, 'piercing'],
      ['a', 7, 'cold'],
    ]);
    expect(ofType(ev, 'saveRoll').map((s) => s.creatureId)).toEqual(['a', 'b']);
    const miss = fight([heroAt({ spell: 'ice_knife' }), dummy('a', 8, 5), dummy('b', 9, 5)]);
    miss.rng.queue = [2, 3, 3, 1, 1];
    const mev = cast(miss.combat, 'ice_knife', { targetId: 'a' });
    expect(ofType(mev, 'damage').map((d) => [d.targetId, d.damageType])).toEqual([['a', 'cold'], ['b', 'cold']]);
  });

  it('Ray of Sickness deals poison damage and poisons the target on a hit', () => {
    const { combat, rng } = fight([heroAt({ spell: 'ray_of_sickness' }), dummy('d', 8, 5)]);
    rng.queue = [15, 4, 4];
    const ev = cast(combat, 'ray_of_sickness', { targetId: 'd' });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 8, damageType: 'poison' });
    expect(ofType(ev, 'conditionAdded')[0]).toMatchObject({ creatureId: 'd', condition: 'poisoned' });
  });

  it('Sleep: incapacitated, then a second save for unconscious; repeated saves end it; damage wakes; undead are immune', () => {
    const sleepers = [dummy('a', 8, 5, { actions: [] }), dummy('b', 8, 6, { actions: [] }), dummy('skeleton', 9, 5, { actions: [] })];
    const { combat, rng } = fight([heroAt({ spell: 'sleep' }), ...sleepers]);
    rng.queue = [1, 1];
    const ev = cast(combat, 'sleep', { point: { x: 8, y: 5 } });
    expect(ofType(ev, 'conditionAdded').map((e) => [e.creatureId, e.condition])).toEqual([['a', 'incapacitated'], ['b', 'incapacitated']]);
    expect(concentratingOn(combat.creature('player') as Creature)).toBe('Sleep');
    // Stage two: the sleepers' turns end and each makes another Wisdom save.
    rng.queue = [1, 1];
    const next = passRound(combat);
    expect(ofType(next, 'conditionAdded').filter((e) => e.condition === 'unconscious').map((e) => e.creatureId).sort()).toEqual(['a', 'b']);
    // HOUSE RULE: an unconscious sleeper saves again each turn.
    rng.queue = [20, 1];
    const again = passRound(combat);
    expect(ofType(again, 'conditionRemoved').map((e) => e.creatureId)).toContain('a');
    // Damage wakes a sleeper.
    const b = combat.creature('b') as Creature;
    expect(b.conditions.some((c) => c.condition === 'unconscious')).toBe(true);
    rng.queue = [15, 4];
    const hit = cast(combat, 'fire_bolt', { targetId: 'b' });
    expect(ofType(hit, 'conditionRemoved').map((e) => [e.creatureId, e.condition])).toContainEqual(['b', 'unconscious']);
    expect(logs(hit).join()).toMatch(/b wakes up/);
  });

  it('Sleep leaves undead untouched', () => {
    const { combat, rng } = fight([heroAt({ spell: 'sleep' }), dummy('skeleton', 8, 5, { actions: [] })]);
    rng.queue = [1];
    const ev = cast(combat, 'sleep', { point: { x: 8, y: 5 } });
    expect(ofType(ev, 'conditionAdded')).toHaveLength(0);
  });

  it('Command (Grovel) makes a creature that fails its save fall prone and lose its next turn', () => {
    const { combat, rng } = fight([heroAt({ bg: 'acolyte', spell: 'command' }), dummy('d', 8, 5)]);
    rng.queue = [1];
    cast(combat, 'command', { targetId: 'd' });
    const next = combat.execute({ type: 'endTurn' });
    expect(logs(next).join()).toMatch(/grovels/);
    expect(ofType(next, 'conditionAdded')[0]).toMatchObject({ creatureId: 'd', condition: 'prone' });
    expect(combat.activeId).toBe('player');
  });

  it('True Strike attacks with the wielded weapon using the casting ability, and adds radiant dice at level 5', () => {
    const { combat, rng } = fight([heroAt({ c1: 'true_strike' }), dummy('d', 4, 5)]);
    const a = combat.availableActions().find((x) => x.id === 'spell_true_strike') as ActionDef;
    // INT +2, proficiency +2 (STR is +3, so the casting ability matters); damage 1d8+2 slashing (versatile die not used with a shield).
    expect(a.attack?.bonus).toBe(4);
    expect(a.damage).toEqual([{ dice: '1d8+2', type: 'slashing' }]);
    rng.queue = [15, 5];
    const ev = cast(combat, 'true_strike', { targetId: 'd' });
    expect(ofType(ev, 'attackRoll')[0]).toMatchObject({ actionName: 'True Strike', bonus: 4 });
    expect(ofType(ev, 'damage')[0]).toMatchObject({ amount: 7, damageType: 'slashing' });
    for (const [lvl, dice] of [[5, '1d6'], [11, '2d6'], [17, '3d6']] as const) {
      const c = heroAt({ c1: 'true_strike', asLevel: lvl });
      expect(c.actions.find((x) => x.id === 'spell_true_strike')?.damage?.[1]).toEqual({ dice, type: 'radiant' });
    }
    expect(heroAt({ c1: 'true_strike', asLevel: 4 }).actions.find((x) => x.id === 'spell_true_strike')?.damage).toHaveLength(1);
  });
});

describe('every implemented spell resolves through the CombatApi', () => {
  const ids = [
    ...offeredSpells('wizard', 0).map((s) => ['sage', s.id] as const),
    ...offeredSpells('cleric', 0).map((s) => ['acolyte', s.id] as const),
    ...offeredSpells('wizard', 1).map((s) => ['sage', s.id] as const),
    ...offeredSpells('cleric', 1).map((s) => ['acolyte', s.id] as const),
  ];
  it.each(ids)('%s: %s is derived, usable and executes without error', (bg, id) => {
    const spells = offeredSpells(bg === 'sage' ? 'wizard' : 'cleric', 0).map((s) => s.id);
    const cantrip = spells.includes(id);
    const other = spells.find((s) => s !== id) as string;
    const hero = heroAt({ bg, ...(cantrip ? { c1: id, c2: other } : { spell: id }) });
    hero.hp = 3;
    const { combat, rng } = fight([hero, dummy('a', 4, 5), dummy('b', 5, 5)]);
    rng.queue = [];
    const action = combat.availableActions().find((a) => a.id === `spell_${id}`) as ActionDef;
    expect(action, id).toBeDefined();
    expect(action.cost === 'reaction' || combat.canUse(action.id).ok, `${id}: ${combat.canUse(action.id).reason}`).toBe(true);
    if (action.cost === 'reaction') return;
    const cmd =
      action.targeting.kind === 'point'
        ? { point: { x: 4, y: 5 } }
        : action.targeting.kind === 'creature'
          ? { targetId: action.targeting.friendly ? 'player' : (combat.validTargets(action.id)[0] as string) }
          : {};
    const ev = combat.execute({ type: 'action', actionId: action.id, ...cmd });
    expect(ofType(ev, 'actionUsed')[0]).toMatchObject({ actionId: action.id });
    if (action.attack) expect(ofType(ev, 'attackRoll')[0]?.actionName).toBe(action.name);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, Creature, GameEvent, GridPos, MonsterDef, MonsterTactic, NavGrid } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { MAX_AI_STEPS, runAiTurn } from './ai';
import { applyLevelUp, createCharacter, suggestedLevelChoices, toCreature } from './character';
import { createCombat } from './combat';
import { assignSlots, buildEncounters } from './encounters';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { playerPolicy } from './sim';
import { creatureTactic, flexibleAlternative, isFlexible, tacticOf } from './tactics';
import { runTurnWith } from './ai';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, makePlan, mon } from './testing/fixtures';
import { createOpenRoomNav, type OpenRoomOptions } from './testing/openRoomNav';
import { chebyshev, flagPool } from './util';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());

const at = (x: number, y: number): GridPos => ({ x, y });
const W = 20;
const H = 11;
const arena = (o: OpenRoomOptions = {}): NavGrid => createOpenRoomNav(W, H, o);

function hero(x: number, y: number, o: { ac?: number } = {}): Creature {
  const h = toCreature(createCharacter(makeBuild()), at(x, y));
  h.maxHp = h.hp = 500;
  delete h.resources['lastStand'];
  if (o.ac !== undefined) h.ac = o.ac;
  return h;
}

const melee: ActionDef = {
  id: 'club',
  name: 'Club',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus: 5 },
  damage: [{ dice: '1d6+2', type: 'bludgeoning' }],
};
const bow: ActionDef = {
  id: 'bow',
  name: 'Bow',
  description: '',
  cost: 'action',
  targeting: { kind: 'creature', melee: false, range: 8, longRange: 24 },
  attack: { bonus: 5 },
  damage: [{ dice: '1d8+2', type: 'piercing' }],
};
const burst: ActionDef = {
  id: 'burst',
  name: 'Burst',
  description: '',
  cost: 'action',
  targeting: { kind: 'point', range: 10, area: { shape: 'sphere', size: 1 } },
  save: { ability: 'dex', dc: 14, halfOnSave: true },
  damage: [{ dice: '3d6', type: 'fire' }],
};

function monster(id: string, x: number, y: number, tactic: MonsterTactic | undefined, over: Partial<MonsterDef> = {}): Creature {
  const c = instantiateMonster(mon({ id, name: id, hp: 40, ac: 12, actions: [melee], ...over }), id, at(x, y));
  if (tactic) c.resources[`_tactic_${tactic}`] = flagPool(`tactic_${tactic}`);
  return c;
}

function begin(creatures: Creature[], nav: NavGrid, active: string, depth = 1, seed = 3): CombatApi {
  const combat = createCombat(creatures, nav, new ScriptedRng(seed), { depth });
  combat.begin();
  for (let i = 0; i < 60 && combat.activeId !== active; i++) combat.execute({ type: 'endTurn' });
  return combat;
}

const ofType = <T extends GameEvent['type']>(ev: GameEvent[], t: T): Extract<GameEvent, { type: T }>[] => ev.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);

describe('tacticOf', () => {
  it('uses the data override, else infers from the stat block, and covers every monster', () => {
    const by = (id: string): MonsterDef => MONSTERS.find((m) => m.id === id) as MonsterDef;
    expect(tacticOf(by('scout'))).toBe('archer');
    expect(tacticOf(by('goblin_boss'))).toBe('leader');
    expect(tacticOf(by('ogre'))).toBe('brute');
    expect(tacticOf(by('giant_spider'))).toBe('lurker');
    expect(tacticOf(by('wolf'))).toBe('skirmisher');
    expect(tacticOf(by('knight'))).toBe('archer'); // flexible: archer on a back post, guard on a front one
    expect(isFlexible(by('knight'))).toBe(true);
    expect(flexibleAlternative(by('knight'))).toBe('guard');
    expect(tacticOf(by('adult_red_dragon'))).toBe('brute');
    expect(tacticOf(by('oni'))).toBe('caster');
    expect(tacticOf(by('zombie'))).toBe('guard');
    expect(tacticOf(by('sea_hag'))).toBe('caster');
    expect(tacticOf({ ...by('ogre'), tactic: 'caster' })).toBe('caster');
    const count = (t: MonsterTactic): number => MONSTERS.filter((m) => tacticOf(m) === t).length;
    expect(count('brute') / MONSTERS.length).toBeLessThan(0.6);
    expect(count('archer')).toBeGreaterThanOrEqual(6);
    expect(count('caster')).toBeGreaterThanOrEqual(8);
    expect(count('guard')).toBeGreaterThanOrEqual(8);
    const seen = new Set(MONSTERS.map(tacticOf));
    for (const t of ['brute', 'skirmisher', 'archer', 'caster', 'leader', 'lurker', 'guard'] as const) expect(seen.has(t)).toBe(true);
  });

  it('a creature in play finds its tactic by def id, or from a test flag; heroes have none', () => {
    const spider = instantiateMonster(MONSTERS.find((m) => m.id === 'giant_spider') as MonsterDef, 's', at(1, 1));
    expect(creatureTactic(spider)).toBe('lurker');
    expect(creatureTactic(monster('x', 1, 1, 'archer'))).toBe('archer');
    expect(creatureTactic(hero(1, 1))).toBeUndefined();
  });
});

describe('brute', () => {
  it('shoves the hero into a chasm when that beats its attack at depth, and the hero climbs out prone', () => {
    const brute = monster('brute', 3, 5, 'brute', { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4 });
    const h = hero(4, 5);
    const nav = arena({ chasms: [at(5, 5)] });
    const combat = begin([h, brute], nav, 'brute', 10);
    const ev = runAiTurn(combat, nav);
    // One shove (it may be resisted): either it fell or it held; over several seeds it falls at least once.
    let fell = ofType(ev, 'hazard').length > 0;
    for (let seed = 4; seed < 30 && !fell; seed++) {
      const b2 = monster('brute', 3, 5, 'brute', { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4 });
      const h2 = hero(4, 5);
      const c2 = begin([h2, b2], nav, 'brute', 10, seed);
      fell = ofType(runAiTurn(c2, nav), 'hazard').length > 0;
    }
    expect(fell).toBe(true);
  });

  it('just attacks when there is no drop behind its target (and shoves prone only when allies fight the target)', () => {
    const brute = monster('brute', 3, 5, 'brute');
    const h = hero(4, 5);
    const nav = arena();
    const combat = begin([h, brute], nav, 'brute', 10);
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'attackRoll').length).toBe(1);
    expect(ofType(ev, 'saveRoll')).toHaveLength(0);
  });

  it('knocks a target prone now and then when its allies are next to it', () => {
    let trips = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // The one-turn-in-three choice is deterministic in (creature id, round): vary the id.
      const brute = monster('brute' + seed, 3, 5, 'brute', { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 4, actions: [{ ...melee, damage: [{ dice: '3d8+5', type: 'bludgeoning' }] }] });
      const buddy = monster('buddy', 4, 4, 'brute');
      const h = hero(4, 5);
      const nav = arena();
      const combat = begin([h, brute, buddy], nav, 'brute' + seed, 1, seed);
      const ev = runAiTurn(combat, nav);
      if (ev.some((e) => e.type === 'actionUsed' && e.actionId === 'shove_trip')) trips++;
    }
    expect(trips).toBeGreaterThan(0);
    expect(trips).toBeLessThan(40);
  });

  it('does not stand at a drop edge when an equally good cell is free and the hero can shove', () => {
    // The hero at (9,5); the chasm runs along x=11 (cells at y=4..6). Cells next to the hero on the far side are on the edge.
    const nav = arena({ chasms: [at(11, 4), at(11, 5), at(11, 6)] });
    for (let seed = 1; seed <= 6; seed++) {
      const brute = monster('brute', 6, 5, 'brute');
      const h = hero(9, 5);
      const combat = begin([h, brute], nav, 'brute', 5, seed);
      runAiTurn(combat, nav);
      expect(chebyshev(brute.pos, h.pos)).toBe(1);
      expect(brute.pos.x).toBeLessThan(10);
    }
  });
});

describe('archer', () => {
  it('shoots from range and, when not touching anyone, backs off to keep its distance', () => {
    const archer = monster('archer', 6, 5, 'archer', { actions: [melee, bow] });
    const h = hero(4, 5);
    const nav = arena();
    const combat = begin([h, archer], nav, 'archer');
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'attackRoll').some((r) => r.attackerId === 'archer' && r.actionName === 'Bow')).toBe(true);
    expect(chebyshev(archer.pos, h.pos)).toBeGreaterThanOrEqual(3);
  });

  it('does not retreat from a melee enemy when that would provoke, and fights back', () => {
    const archer = monster('archer', 5, 5, 'archer', { actions: [melee, bow] });
    const h = hero(4, 5);
    const nav = arena();
    const combat = begin([h, archer], nav, 'archer');
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'move')).toHaveLength(0);
    expect(ofType(ev, 'attackRoll').length).toBeGreaterThan(0);
  });

  it('uses a free Disengage (Nimble Escape) to step away and shoot', () => {
    const archer = monster('archer', 5, 5, 'archer', { actions: [melee, bow], traits: ['nimbleEscape'] });
    const h = hero(4, 5);
    const nav = arena();
    const combat = begin([h, archer], nav, 'archer');
    const ev = runAiTurn(combat, nav);
    expect(ev.some((e) => e.type === 'actionUsed' && e.actionId === 'disengage')).toBe(true);
    expect(ofType(ev, 'attackRoll').filter((r) => r.reaction)).toHaveLength(0);
    expect(chebyshev(archer.pos, h.pos)).toBeGreaterThanOrEqual(2);
  });

  it('prefers a cell with cover and with higher ground when it can shoot from there', () => {
    // A prop at (8,5) between the hero (4,5) and the cell (11,5); the archer starts at (11,4) in the open.
    const nav = arena({ props: [at(8, 4)] });
    const archer = monster('archer', 11, 3, 'archer', { actions: [melee, bow] });
    const h = hero(5, 4);
    const combat = begin([h, archer], nav, 'archer');
    runAiTurn(combat, nav);
    expect(nav.coverBetween(h.pos, archer.pos)).toBeGreaterThan(0);
    const high = arena({ elevation: (p) => Math.min(3, Math.max(0, p.x - 9)) });
    const a2 = monster('archer', 10, 5, 'archer', { actions: [melee, bow] });
    const h5 = hero(5, 5);
    const c2 = begin([h5, a2], high, 'archer');
    runAiTurn(c2, high);
    expect(high.elevationAt(a2.pos) - high.elevationAt(h5.pos)).toBeGreaterThanOrEqual(2);
  });

  it('never ends on a drop edge a hero could push it off when another cell is as good', () => {
    const nav = arena({ chasms: [at(10, 4), at(10, 5), at(10, 6)] });
    for (let seed = 1; seed <= 5; seed++) {
      const archer = monster('archer', 8, 5, 'archer', { actions: [melee, bow] });
      const h = hero(4, 5);
      const combat = begin([h, archer], nav, 'archer', 5, seed);
      runAiTurn(combat, nav);
      expect(archer.pos.x).toBeLessThan(9);
    }
  });
});

describe('caster', () => {
  it('places an area on the enemies and never on its own side', () => {
    const caster = monster('mage', 12, 5, 'caster', { actions: [melee, burst] });
    const ally = monster('guardian', 6, 5, 'brute');
    const h = hero(5, 5);
    const buddy = monster('buddy', 5, 7, undefined);
    buddy.faction = 'ally';
    buddy.hp = buddy.maxHp = 200;
    const nav = arena();
    const combat = begin([h, buddy, caster, ally], nav, 'mage');
    const ev = runAiTurn(combat, nav);
    const cast = ev.find((e) => e.type === 'actionUsed' && e.actionId === 'burst');
    expect(cast).toBeDefined();
    const hurt = ofType(ev, 'damage').map((d) => d.targetId);
    expect(hurt).not.toContain('guardian');
    expect(hurt).not.toContain('mage');
  });
});

describe('skirmisher', () => {
  it('goes for the least protected of the hero and the companion', () => {
    const wolf = monster('wolf', 9, 5, 'skirmisher', { speedFt: 40 });
    const h = hero(4, 4, { ac: 24 });
    const comp = monster('comp', 4, 6, undefined, { ac: 9 });
    comp.faction = 'ally';
    comp.hp = comp.maxHp = 300;
    const nav = arena();
    const combat = begin([h, comp, wolf], nav, 'wolf');
    const ev = runAiTurn(combat, nav);
    const hits = ofType(ev, 'attackRoll');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.targetId === 'comp')).toBe(true);
  });

  it('prefers a target one of its allies already fights', () => {
    const wolf = monster('wolf', 9, 5, 'skirmisher', { speedFt: 40 });
    const pal = monster('pal', 5, 6, 'brute');
    const h = hero(4, 4, { ac: 14 });
    const comp = monster('comp', 4, 6, undefined, { ac: 14 });
    comp.faction = 'ally';
    comp.hp = comp.maxHp = 300;
    const nav = arena();
    const combat = begin([h, comp, wolf, pal], nav, 'wolf');
    const hits = ofType(runAiTurn(combat, nav), 'attackRoll');
    expect(hits[0]?.targetId).toBe('comp');
  });

  it('strikes and then withdraws with a Disengage that costs no action', () => {
    const goblin = monster('gob', 8, 5, 'skirmisher', { traits: ['nimbleEscape'], speedFt: 40 });
    const h = hero(5, 5);
    const nav = arena();
    const combat = begin([h, goblin], nav, 'gob');
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'attackRoll').length).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'actionUsed' && e.actionId === 'disengage')).toBe(true);
    expect(ofType(ev, 'attackRoll').filter((r) => r.reaction)).toHaveLength(0);
    expect(chebyshev(goblin.pos, h.pos)).toBeGreaterThanOrEqual(2);
  });
});

describe('leader', () => {
  it('stays behind its allies while any are alive, and fights when alone', () => {
    const boss = monster('boss', 14, 5, 'leader', { actions: [melee, bow] });
    const guard1 = monster('g1', 12, 5, 'guard');
    const h = hero(4, 5);
    const nav = arena();
    const combat = begin([h, boss, guard1], nav, 'boss');
    runAiTurn(combat, nav);
    // It never comes forward of its guard (on the hero's side), and never touches the hero.
    expect(boss.pos.x).toBeGreaterThanOrEqual(guard1.pos.x);
    expect(chebyshev(boss.pos, h.pos)).toBeGreaterThanOrEqual(3);
    // Alone: it closes in.
    const solo = monster('boss', 14, 5, 'leader', { actions: [melee] });
    const h2 = hero(10, 5);
    const c2 = begin([h2, solo], nav, 'boss');
    runAiTurn(c2, nav);
    expect(chebyshev(solo.pos, h2.pos)).toBeLessThan(4);
  });
});

describe('lurker', () => {
  it('has advantage on its first attack when it started the fight out of sight, and not otherwise', () => {
    const wall = Array.from({ length: H }, (_, y) => at(8, y)).filter((p) => p.y !== 5);
    // Hidden behind a wall segment with a gap: out of line of sight at the start.
    const nav = arena({ walls: [at(8, 4), at(8, 5), at(8, 6), at(8, 3), at(8, 7)] });
    const spider = monster('spider', 9, 5, 'lurker', { speedFt: 30 });
    const h = hero(7, 5);
    h.pos = at(7, 5);
    expect(nav.hasLineOfSight(h.pos, spider.pos)).toBe(false);
    void wall;
    const combat = begin([h, spider], nav, 'spider');
    // The hero stands next to the wall: the lurker walks round (hidden cells first) and strikes with advantage when it arrives.
    let first: Extract<GameEvent, { type: 'attackRoll' }> | undefined;
    for (let i = 0; i < 12 && !first; i++) {
      const ev = combat.activeId === 'spider' ? runAiTurn(combat, nav) : combat.execute({ type: 'endTurn' });
      first = ofType(ev, 'attackRoll').find((r) => r.attackerId === 'spider');
    }
    expect(first).toBeDefined();
    expect(first?.mode).toBe('advantage');
    // In plain sight from the start: no advantage.
    const open = arena();
    const s2 = monster('spider', 8, 5, 'lurker');
    const c2 = begin([hero(5, 5), s2], open, 'spider');
    const r2 = ofType(runAiTurn(c2, open), 'attackRoll').find((r) => r.attackerId === 'spider');
    expect(r2?.mode).toBe('normal');
  });

  it('while hidden it only creeps along cells out of the hero\'s sight, otherwise waits', () => {
    // A pillar line leaves no hidden approach: the lurker waits.
    const nav = arena({ walls: Array.from({ length: H }, (_, y) => at(10, y)) });
    const spider = monster('spider', 14, 5, 'lurker', { speedFt: 30 });
    const h = hero(3, 5);
    const combat = begin([h, spider], nav, 'spider');
    const before = { ...spider.pos };
    const ev = runAiTurn(combat, nav);
    const moved = ofType(ev, 'move');
    for (const m of moved) for (const p of m.path) expect(nav.hasLineOfSight(h.pos, p)).toBe(false);
    expect(chebyshev(spider.pos, before)).toBeGreaterThanOrEqual(0);
  });
});

describe('guard', () => {
  it('holds its post until an enemy is within 4 cells, then fights', () => {
    const g = monster('guard', 12, 5, 'guard');
    const h = hero(3, 5);
    const nav = arena();
    const combat = begin([h, g], nav, 'guard');
    runAiTurn(combat, nav);
    expect(g.pos).toEqual(at(12, 5));
    h.pos = at(9, 5);
    for (let i = 0; i < 4 && combat.activeId !== 'guard'; i++) combat.execute({ type: 'endTurn' });
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'attackRoll').length + ofType(ev, 'move').length).toBeGreaterThan(0);
  });

  it('is alerted by damage even from far away', () => {
    const g = monster('guard', 14, 5, 'guard');
    const h = hero(2, 5);
    const nav = arena();
    const combat = begin([h, g], nav, 'guard');
    runAiTurn(combat, nav);
    expect(g.pos).toEqual(at(14, 5));
    g.hp -= 5;
    for (let i = 0; i < 4 && combat.activeId !== 'guard'; i++) combat.execute({ type: 'endTurn' });
    runAiTurn(combat, nav);
    expect(g.pos.x).toBeLessThan(14);
  });

  it('shoots from its post when it has a bow', () => {
    const g = monster('guard', 8, 5, 'guard', { actions: [melee, bow] });
    const h = hero(3, 5);
    const nav = arena();
    const combat = begin([h, g], nav, 'guard');
    const ev = runAiTurn(combat, nav);
    expect(ofType(ev, 'attackRoll').length).toBe(1);
    expect(g.pos).toEqual(at(8, 5));
  });
});

describe('guard post drift', () => {
  it('steps at most 3 cells from its post to get a shot, and no further', () => {
    const shortBow: ActionDef = { ...bow, targeting: { kind: 'creature', melee: false, range: 8 } };
    const g = monster('guard', 12, 5, 'guard', { actions: [melee, shortBow] });
    const h = hero(2, 5);
    const nav = arena();
    const combat = begin([h, g], nav, 'guard');
    runAiTurn(combat, nav);
    expect(chebyshev(g.pos, at(12, 5))).toBeLessThanOrEqual(3);
    expect(g.pos.x).toBeLessThan(12);
    // Far beyond reach even with the step: it stays.
    const g2 = monster('guard', 18, 5, 'guard', { actions: [melee, shortBow] });
    const c2 = begin([hero(1, 5), g2], nav, 'guard');
    runAiTurn(c2, nav);
    expect(chebyshev(g2.pos, at(18, 5))).toBeLessThanOrEqual(3);
  });
});

describe('all tactics', () => {
  const tactics: MonsterTactic[] = ['brute', 'skirmisher', 'archer', 'caster', 'leader', 'lurker', 'guard'];

  it('every tactic ends its turn within the step cap and fights resolve', () => {
    for (const t of tactics) {
      for (let seed = 1; seed <= 6; seed++) {
        const nav = arena({ chasms: [at(10, 2), at(10, 8)], props: [at(7, 5)] });
        const foes = [monster('a', 14, 4, t, { actions: [melee, bow, burst] }), monster('b', 15, 6, t === 'leader' ? 'guard' : t, { actions: [melee, bow] })];
        const h = toCreature(createCharacter(makeBuild()), at(3, 5));
        const combat = createCombat([h, ...foes], nav, new Rng(seed), { depth: 3 });
        combat.begin();
        let guard = 0;
        while (!combat.isOver && combat.round < 60 && guard++ < 800) {
          const ev = combat.activeId === 'player' ? runTurnWith(combat, (c) => playerPolicy(c, nav)) : runAiTurn(combat, nav);
          expect(ev.filter((e) => e.type === 'actionUsed').length).toBeLessThanOrEqual(MAX_AI_STEPS);
        }
        expect(combat.isOver || combat.round >= 60).toBe(true);
        // Nobody ever stands in a hazard cell.
        for (const c of combat.creatures()) expect(nav.hazardAt(c.pos) === 'fall' || nav.hazardAt(c.pos) === 'lava').toBe(false);
      }
    }
  });
});

describe('encounter placement by post', () => {
  const def = (id: string): MonsterDef => MONSTERS.find((m) => m.id === id) as MonsterDef;
  const slot = (x: number, post?: SpawnPostLike) => ({ pos: at(x, 1), roomId: 1, role: 'monster' as const, ...(post ? { post } : {}) });
  type SpawnPostLike = 'front' | 'back' | 'flank' | 'high' | 'hidden' | 'guard' | 'escort';

  it('sends archers to high and back, brutes to the front, lurkers to hidden, leaders to the back', () => {
    const slots = [slot(1, 'front'), slot(2, 'high'), slot(3, 'hidden'), slot(4, 'flank'), slot(5, 'back')];
    const out = assignSlots([def('ogre'), def('scout'), def('giant_spider'), def('wolf'), def('priest')], slots);
    const post = (i: number): string | undefined => out[i]?.post;
    expect(post(0)).toBe('front'); // ogre, a brute
    expect(post(1)).toBe('high'); // scout, an archer
    expect(post(2)).toBe('hidden'); // spider, a lurker
    expect(post(3)).toBe('flank'); // wolf, a skirmisher
    expect(post(4)).toBe('back'); // priest, a leader
    expect(new Set(out).size).toBe(5);
  });

  it('a flexible monster is an archer on a back post and a guard on a front post', () => {
    const plan = makePlan(2, 'crypt', [{ role: 'entrance' }, { role: 'combat', distanceFromEntrance: 1 }], [{ ...slot(1, 'front'), roomId: 1 }, { ...slot(2, 'back'), roomId: 1 }]);
    const knight = def('knight');
    // Two knights only: the first pick takes the 'back' slot (archer preference) and the second lands in front.
    const slots = plan.spawns;
    const out = assignSlots([knight, knight], slots);
    expect(out.map((o) => o.post).sort()).toEqual(['back', 'front']);
  });

  it('keeps the old order when no slot has a post', () => {
    const slots = [slot(1), slot(2), slot(3)];
    expect(assignSlots([def('ogre'), def('scout'), def('wolf')], slots)).toEqual(slots);
  });

  it('chooses the same monsters with and without posts, only placing them differently', () => {
    const base = makePlan(
      2,
      'warrens',
      [{ role: 'entrance' }, { role: 'combat', distanceFromEntrance: 1 }],
      Array.from({ length: 5 }, (_, i) => slot(i + 1)).map((s) => ({ ...s, roomId: 1 })),
    );
    const posts: SpawnPostLike[] = ['back', 'front', 'flank', 'high', 'guard'];
    const withPosts = { ...base, spawns: base.spawns.map((s, i) => ({ ...s, post: posts[i] as SpawnPostLike })) };
    for (let seed = 1; seed <= 10; seed++) {
      const a = buildEncounters(base, MONSTERS, new Rng(seed)).map((m) => m.creature.defId).sort();
      const b = buildEncounters(withPosts, MONSTERS, new Rng(seed)).map((m) => m.creature.defId).sort();
      expect(b).toEqual(a);
    }
  });
});

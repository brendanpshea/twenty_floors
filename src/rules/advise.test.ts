import { describe, expect, it } from 'vitest';
import type { CombatApi, Creature, GameEvent, GridPos, NavGrid, PlayerCharacter } from '../core/types';
import { Rng } from '../core/rng';
import { MONSTERS } from '../data/monsters';
import { advise, adviseExplore } from './advise';
import { runAiTurn, runTurnWith } from './ai';
import { toCreature } from './character';
import { createCombat } from './combat';
import { expertPolicy } from './expertPolicy';
import { instantiateMonster } from './monster';
import { presetHero, withItems } from './testing/heroes';
import { createOpenRoomNav } from './testing/openRoomNav';

const at = (x: number, y: number): GridPos => ({ x, y });
const monster = (id: string) => {
  const def = MONSTERS.find((m) => m.id === id);
  if (!def) throw new Error(id);
  return def;
};

function setup(pc: PlayerCharacter, foes: [string, number, number][], opts: { nav?: NavGrid; depth?: number; seed?: number; hero?: GridPos } = {}): { combat: CombatApi; nav: NavGrid; hero: Creature } {
  const nav = opts.nav ?? createOpenRoomNav(16, 12);
  const hero = toCreature(pc, opts.hero ?? at(2, 6));
  const creatures = [hero, ...foes.map(([id, x, y], i) => instantiateMonster(monster(id), `m_${i}`, at(x, y)))];
  const combat = createCombat(creatures, nav, new Rng(opts.seed ?? 3), { depth: opts.depth ?? 1 });
  combat.begin();
  for (let i = 0; i < 40 && combat.activeId !== 'player'; i++) runAiTurn(combat, nav);
  return { combat, nav, hero };
}

/** A whole fight; the hero is driven by expertPolicy, with `advise` called before every decision when asked. */
function fight(pc: PlayerCharacter, foes: string[], seed: number, withAdvice: boolean, said: string[] = []): GameEvent[] {
  const nav = createOpenRoomNav(16, 12);
  const hero = toCreature(pc, at(2, 6));
  const creatures = [hero, ...foes.map((id, i) => instantiateMonster(monster(id), `m_${i}`, at(8, 4 + i * 2)))];
  const combat = createCombat(creatures, nav, new Rng(seed), { depth: 1 });
  const events: GameEvent[] = [...combat.begin()];
  for (let guard = 0; !combat.isOver && guard < 400; guard++) {
    if (combat.activeId === 'player') {
      events.push(
        ...runTurnWith(combat, (c) => {
          if (withAdvice) {
            const a = advise(c, nav);
            if (a) said.push(a.text);
          }
          return expertPolicy(c, nav);
        }),
      );
    } else events.push(...runAiTurn(combat, nav));
  }
  return events;
}

describe('advise', () => {
  it('describes a plain attack with the hit chance', () => {
    const { combat, nav } = setup(presetHero('defender'), [['goblin_warrior', 3, 6]]);
    const a = advise(combat, nav)!;
    expect(a.command).toMatchObject({ type: 'action', actionId: 'atk_longsword' });
    expect(a.actionId).toBe('atk_longsword');
    expect(a.text).toMatch(/^Attack the Goblin Warrior with your Longsword \(\d+% to hit\)\.$/);
  });

  it('tells a beginner to walk up to an enemy, without coordinates', () => {
    const { combat, nav } = setup(presetHero('defender'), [['wolf', 12, 6]]);
    const a = advise(combat, nav)!;
    expect(a.command.type).toBe('move');
    expect(a.actionId).toBeUndefined();
    expect(a.text).toMatch(/^Move (next to|closer to|toward) the Wolf/);
    expect(a.text).not.toMatch(/\d,\s*\d/);
  });

  it('suggests Second Wind when hurt, with the amount, and a potion once it is spent', () => {
    const pc = withItems(presetHero('defender', 3), 'potion_healing');
    const hurt: PlayerCharacter = { ...pc, hp: 9 };
    const { combat, nav } = setup(hurt, [['goblin_warrior', 3, 6]]);
    const a = advise(combat, nav)!;
    expect(a.actionId).toBe('second_wind');
    expect(a.text).toMatch(/^Use Second Wind \(bonus action\) to recover about \d+ HP\.$/);
    const spent: PlayerCharacter = { ...hurt, resources: { ...hurt.resources, secondWind: { ...(hurt.resources['secondWind'] as object), current: 0 } as never } };
    const b = setup(spent, [['goblin_warrior', 3, 6]]);
    const p = advise(b.combat, b.nav)!;
    expect(p.actionId).toBe('drink_potion_healing');
    expect(p.text).toBe(`Drink a Potion of Healing — you are at 9 of ${hurt.maxHp} HP.`);
  });

  it('describes a shove into a pit with the odds and the fall damage, and names the engine shove action', () => {
    const nav = createOpenRoomNav(20, 11, { chasms: [at(8, 5)] });
    const { combat } = setup(presetHero('defender'), [['skeleton', 7, 5]], { nav, depth: 10, hero: at(6, 5) });
    const a = advise(combat, nav)!;
    expect(a.actionId).toBe('shove_push');
    expect(a.command).toMatchObject({ type: 'action', actionId: 'shove_push' });
    expect(a.text).toMatch(/^Shove the Skeleton toward the pit \(\d+%\) — it would fall for \d+d6\.$/);
  });

  it('says to end the turn when nothing is left', () => {
    const { combat, nav } = setup(presetHero('defender'), [['ogre', 3, 6]]);
    combat.execute({ type: 'action', actionId: 'atk_longsword', targetId: 'm_0' });
    const a = advise(combat, nav)!;
    expect(a.command).toEqual({ type: 'endTurn' });
    expect(a.text).toBe('End your turn — nothing useful is left.');
  });

  it('is null off the hero turn and after the fight', () => {
    const { combat, nav } = setup(presetHero('defender'), [['giant_rat', 3, 6]]);
    expect(advise(combat, nav)).not.toBeNull();
    combat.execute({ type: 'endTurn' });
    if (combat.activeId !== 'player') expect(advise(combat, nav)).toBeNull();
    const over = fight(presetHero('defender', 3), ['giant_rat'], 1, false);
    expect(over.length).toBeGreaterThan(0);
  });

  it('has no side effects: asking twice changes nothing, and the answer is the same', () => {
    const { combat, nav } = setup(presetHero('defender'), [['goblin_warrior', 6, 6]]);
    const before = JSON.stringify([combat.creatures(), combat.turn, combat.round, combat.activeId]);
    const a = advise(combat, nav);
    const b = advise(combat, nav);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify([combat.creatures(), combat.turn, combat.round, combat.activeId])).toBe(before);
  });

  it('does not draw from the combat rng: the same fight with and without advice has an identical event log', () => {
    for (const [pc, foes] of [
      [presetHero('defender', 1), ['goblin_warrior', 'goblin_minion']],
      [presetHero('great_weapon', 5), ['wolf', 'wolf', 'skeleton']],
      [presetHero('defender', 8), ['ogre', 'zombie']],
    ] as [PlayerCharacter, string[]][]) {
      for (const seed of [1, 2, 3]) {
        const said: string[] = [];
        const plain = fight(pc, foes, seed, false);
        const advised = fight(pc, foes, seed, true, said);
        expect(JSON.stringify(advised)).toBe(JSON.stringify(plain));
        expect(said.length).toBeGreaterThan(0);
      }
    }
  });

  it('an Archer that is both advised and driven fights exactly as one that is only driven (the policy is pure when it proposes a move)', () => {
    let moved = 0;
    for (const [pc, foes] of [
      [presetHero('archer', 3), ['goblin_warrior', 'wolf']],
      [presetHero('archer', 6), ['ogre', 'zombie', 'skeleton']],
      [presetHero('archer', 1), ['giant_rat', 'goblin_minion', 'goblin_warrior']],
    ] as [PlayerCharacter, string[]][]) {
      for (const seed of [1, 2, 3, 4]) {
        const said: string[] = [];
        const plain = fight(pc, foes, seed, false);
        // Ask twice before every decision: nothing the question does may reach the policy.
        const advised = fight(pc, foes, seed, true, said);
        expect(JSON.stringify(advised)).toBe(JSON.stringify(plain));
        moved += plain.filter((e) => e.type === 'attackRoll' && e.attackerId === 'player' && e.actionName.toLowerCase().includes('bow')).length;
      }
    }
    // The fights really did run the Archer branch (it shoots its bow).
    expect(moved).toBeGreaterThan(0);
  });

  it('proposing does not change what the policy proposes next: the same state gives the same command every time', () => {
    const { combat, nav } = setup(presetHero('archer', 4), [['wolf', 6, 6], ['goblin_warrior', 9, 7]]);
    const first = JSON.stringify(expertPolicy(combat, nav));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(expertPolicy(combat, nav))).toBe(first);
  });

  it('speaks plainly in real fights: every sentence ends with a full stop and names no coordinates', () => {
    const said: string[] = [];
    fight(presetHero('great_weapon', 5), ['wolf', 'wolf', 'skeleton'], 2, true, said);
    fight(presetHero('archer', 3), ['goblin_warrior', 'zombie'], 4, true, said);
    expect(said.length).toBeGreaterThan(5);
    for (const s of said) {
      expect(s).toMatch(/.$/);
      expect(s).not.toMatch(/(d+, ?d+)/);
    }
  });
});

describe('adviseExplore', () => {
  const pc = presetHero('defender', 3);
  const base = { hpFraction: 1, shortRestsLeft: 2, atRestSite: false, canCastHeal: false, potions: 0, enemyInView: false, companionHurt: false };
  const hurt = (f: number): PlayerCharacter => ({ ...pc, hp: Math.round(pc.maxHp * f) });

  it('says nothing when healthy, or with an enemy in view', () => {
    expect(adviseExplore(pc, base)).toBeNull();
    expect(adviseExplore(hurt(0.2), { ...base, hpFraction: 0.2, enemyInView: true, potions: 2 })).toBeNull();
  });

  it('badly hurt: a heal spell first, then a short rest, then a potion', () => {
    const p = hurt(0.2);
    const ctx = { ...base, hpFraction: 0.2 };
    expect(adviseExplore(p, { ...ctx, canCastHeal: true })!.id).toBe('cast_heal');
    expect(adviseExplore(p, ctx)!.id).toBe('short_rest');
    expect(adviseExplore(p, { ...ctx, shortRestsLeft: 0, potions: 1 })!.id).toBe('drink_potion');
    expect(adviseExplore(p, { ...ctx, shortRestsLeft: 0 })).toBeNull();
  });

  it('moderately hurt with a short rest left: take it, with the numbers', () => {
    const r = adviseExplore(hurt(0.5), { ...base, hpFraction: 0.5 })!;
    expect(r.id).toBe('short_rest');
    expect(r.text).toMatch(new RegExp(`you are at ${hurt(0.5).hp} of ${pc.maxHp} HP`));
    expect(r.text).toMatch(/Recover about \d+ HP/);
  });

  it('no short rest left and not badly hurt: nothing', () => {
    expect(adviseExplore(hurt(0.5), { ...base, hpFraction: 0.5, shortRestsLeft: 0, potions: 2 })).toBeNull();
  });

  it('at a rest site with something to restore: use it', () => {
    expect(adviseExplore(hurt(0.8), { ...base, hpFraction: 0.8, atRestSite: true })!.id).toBe('rest_site');
    expect(adviseExplore(hurt(0.1), { ...base, hpFraction: 0.1, atRestSite: true, canCastHeal: true })!.id).toBe('rest_site');
    // Nothing to restore: not worth a rest site.
    expect(adviseExplore(pc, { ...base, atRestSite: true })).toBeNull();
    expect(adviseExplore(pc, { ...base, atRestSite: true, companionHurt: true })!.id).toBe('rest_site');
  });

  it('a hurt companion alone justifies a short rest', () => {
    expect(adviseExplore(pc, { ...base, companionHurt: true })!.id).toBe('short_rest');
    expect(adviseExplore(pc, { ...base, companionHurt: true, shortRestsLeft: 0 })).toBeNull();
  });
});


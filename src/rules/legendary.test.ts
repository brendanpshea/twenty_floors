import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionDef, Creature, GameEvent, GridPos, MonsterLegendary } from '../core/types';
import { createCharacter, toCreature } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { resetItemCatalog, setItemCatalog } from './items';
import { FIXTURE_ITEMS, ScriptedRng, makeBuild, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

beforeAll(() => setItemCatalog(FIXTURE_ITEMS));
afterAll(() => resetItemCatalog());
const at = (x: number, y: number): GridPos => ({ x, y });
const claw: ActionDef = { id: 'claw', name: 'Claw', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, attack: { bonus: 8 }, damage: [{ dice: '1d6+2', type: 'slashing' }] };
const multi: ActionDef = { id: 'multi', name: 'Multiattack', description: '', cost: 'action', targeting: { kind: 'creature', melee: true, range: 1 }, multiattack: ['claw', 'claw'] };
const presence: ActionDef = { id: 'presence', name: 'Frightful Presence', description: '', cost: 'action', targeting: { kind: 'point', range: 0, area: { shape: 'sphere', size: 6 } }, save: { ability: 'wis', dc: 30, halfOnSave: false }, applies: { condition: 'frightened', rounds: 1 } };
const web: ActionDef = { id: 'web', name: 'Web', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 8 }, save: { ability: 'dex', dc: 12, halfOnSave: false }, applies: { condition: 'restrained', rounds: 2 } };

function setup(legendary: MonsterLegendary | undefined, bossAt = at(5, 4)): { hero: Creature; boss: Creature; combat: ReturnType<typeof createCombat>; rng: ScriptedRng } {
  const hero = toCreature(createCharacter(makeBuild()), at(4, 4));
  hero.maxHp = hero.hp = 500;
  delete hero.resources['indomitable'];
  const boss = instantiateMonster(mon({ id: 'boss', hp: 300, ac: 10, actions: [claw, multi], ...(legendary ? { legendary } : {}) }), 'boss', bossAt);
  const rng = new ScriptedRng(2);
  const combat = createCombat([hero, boss], createOpenRoomNav(14, 8), rng, { depth: 10 });
  combat.begin();
  return { hero, boss, combat, rng };
}
const feats = (ev: GameEvent[], id: string): Extract<GameEvent, { type: 'feature' }>[] => ev.filter((e): e is Extract<GameEvent, { type: 'feature' }> => e.type === 'feature' && e.id === id);

/** Pass turns until `id` is active, collecting events. */
function until(combat: ReturnType<typeof createCombat>, id: string): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < 8 && combat.activeId !== id; i++) ev.push(...combat.execute({ type: 'endTurn' }));
  return ev;
}

describe('legendary actions (one a round)', () => {
  const legend: MonsterLegendary = { options: [{ name: 'Rend', description: '', use: 'claw' }, { name: 'Frightful Presence', description: '', use: 'presence' }], actions: [presence] };

  it('after the hero\'s turn the creature takes one legendary action, and no second one in the same round', () => {
    const { combat } = setup(legend);
    until(combat, 'player');
    const first = combat.execute({ type: 'endTurn' });
    expect(feats(first, 'legendaryAction')).toHaveLength(1);
    expect(first.find((e) => e.type === 'actionUsed' && e.creatureId === 'boss')).toMatchObject({ name: expect.stringContaining('Legendary action: ') });
    // The boss's own turn follows and gives the action back; one more comes after the hero's next turn, never two in a round.
    const round = [...until(combat, 'player'), ...combat.execute({ type: 'endTurn' })];
    expect(feats(round, 'legendaryAction')).toHaveLength(1);
  });

  it('takes the option worth most: a fear effect on an unfrightened hero over a single claw, then the claw', () => {
    const { combat, hero } = setup(legend);
    until(combat, 'player');
    const first = combat.execute({ type: 'endTurn' });
    expect(feats(first, 'legendaryAction')[0]?.label).toBe('Frightful Presence');
    expect(hero.conditions.some((c) => c.condition === 'frightened')).toBe(true);
  });

  it('an option with nothing in reach is passed over, and a creature with no usable option keeps its action', () => {
    const far = setup({ options: [{ name: 'Rend', description: '', use: 'claw' }] }, at(11, 4));
    until(far.combat, 'player');
    expect(feats(far.combat.execute({ type: 'endTurn' }), 'legendaryAction')).toHaveLength(0);
    const none = setup(undefined);
    until(none.combat, 'player');
    expect(feats(none.combat.execute({ type: 'endTurn' }), 'legendaryAction')).toHaveLength(0);
  });

  it('an incapacitated legendary creature takes none', () => {
    const { combat, boss } = setup(legend);
    until(combat, 'player');
    boss.conditions.push({ condition: 'stunned', rounds: 3, sourceId: 'player' } as Creature['conditions'][number]);
    expect(feats(combat.execute({ type: 'endTurn' }), 'legendaryAction')).toHaveLength(0);
  });
});

describe('Legendary Resistance', () => {
  it('turns a failed save against a condition into a success while uses last, and says how many are left', () => {
    const hero = toCreature(createCharacter(makeBuild()), at(4, 4));
    hero.maxHp = hero.hp = 500;
    const caster = instantiateMonster(mon({ id: 'caster', hp: 50, ac: 10, actions: [web] }), 'caster', at(3, 4));
    caster.faction = 'ally';
    const boss = instantiateMonster(mon({ id: 'boss', hp: 300, ac: 10, actions: [claw], legendary: { options: [], resistance: 2 } }), 'boss', at(8, 4));
    const rng = new ScriptedRng(2);
    const combat = createCombat([hero, caster, boss], createOpenRoomNav(14, 8), rng, {});
    combat.begin();
    const cast = (): GameEvent[] => {
      for (let i = 0; i < 8 && combat.activeId !== 'caster'; i++) combat.execute({ type: 'endTurn' });
      rng.queue = [1];
      const ev = combat.execute({ type: 'action', actionId: 'web', targetId: 'boss' });
      combat.execute({ type: 'endTurn' });
      return ev;
    };
    const a = cast();
    expect(feats(a, 'legendaryResistance')[0]?.label).toBe('Legendary Resistance (1 left)');
    expect(boss.conditions.some((c) => c.condition === 'restrained')).toBe(false);
    cast();
    expect(boss.resources['legendaryResistance']?.current).toBe(0);
    const c = cast();
    expect(feats(c, 'legendaryResistance')).toHaveLength(0);
    expect(boss.conditions.some((x) => x.condition === 'restrained')).toBe(true);
  });
});

describe('bonus-action Disengage is named for what allows it', () => {
  it('a Nimble Escape creature shows "Nimble Escape (Disengage)" and can still shoot; a plain one cannot', () => {
    const bow: ActionDef = { id: 'bow', name: 'Shortbow', description: '', cost: 'action', targeting: { kind: 'creature', melee: false, range: 16, longRange: 64 }, attack: { bonus: 4 }, damage: [{ dice: '1d6+2', type: 'piercing' }] };
    for (const nimble of [true, false]) {
      const hero = toCreature(createCharacter(makeBuild()), at(4, 4));
      const g = instantiateMonster(mon({ id: 'gob', hp: 30, ac: 10, actions: [bow], traits: nimble ? ['nimbleEscape'] : [] }), 'gob', at(5, 4));
      const combat = createCombat([hero, g], createOpenRoomNav(14, 8), new ScriptedRng(2), {});
      combat.begin();
      until(combat, 'gob');
      const ev = combat.execute({ type: 'action', actionId: 'disengage' });
      expect(ev.find((e) => e.type === 'actionUsed')).toMatchObject({ name: nimble ? 'Nimble Escape (Disengage)' : 'Disengage' });
      expect(combat.canUse('bow').ok).toBe(nimble);
    }
  });
});

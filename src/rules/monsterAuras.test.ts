import { describe, expect, it } from 'vitest';
import type { Creature, GameEvent, MonsterAura, MonsterDef } from '../core/types';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { ScriptedRng, mon } from './testing/fixtures';
import { createOpenRoomNav } from './testing/openRoomNav';

const arena = createOpenRoomNav(16, 9);
const stench: MonsterAura = {
  id: 'stench',
  name: 'Stench',
  description: 'A reek.',
  radius: 2,
  save: { ability: 'con', dc: 15 },
  applies: { condition: 'poisoned', rounds: 1 },
  immuneOnSuccess: true,
};
const hard: MonsterAura = { ...stench, save: { ability: 'con', dc: 30 } };
const burn: MonsterAura = { id: 'burn', name: 'Heat', description: 'Heat.', radius: 1, save: { ability: 'con', dc: 30 }, damage: [{ dice: '2d6', type: 'fire' }], halfOnSave: true };

/** A player-side dummy 'v' and a monster 'm' with the auras, `gap` cells apart. */
function setup(auras: MonsterAura[], gap: number, victim: Partial<MonsterDef> = {}, prep: (v: Creature, m: Creature) => void = () => undefined) {
  const v = instantiateMonster(mon({ id: 'victim', hp: 100, actions: [], ...victim }), 'v', { x: 2, y: 4 });
  v.faction = 'player';
  const m: Creature = instantiateMonster(mon({ id: 'emitter', hp: 100, actions: [], auras }), 'm', { x: 2 + gap, y: 4 });
  prep(v, m);
  const rng = new ScriptedRng(1);
  const combat = createCombat([v, m], arena, rng, {});
  const ev: GameEvent[] = combat.begin();
  /** Ends turns until `id` is up (its start-of-turn effects have then run). */
  const until = (id: string): void => {
    for (let i = 0; i < 6 && combat.activeId !== id; i++) ev.push(...combat.execute({ type: 'endTurn' }));
  };
  /** Ends the current turn, then any more needed to reach `id`: the next turn of `id` has started. */
  const passTo = (id: string): void => {
    ev.push(...combat.execute({ type: 'endTurn' }));
    until(id);
  };
  return { v, m, rng, ev, until, passTo };
}
const saves = (ev: GameEvent[]): GameEvent[] => ev.filter((e) => e.type === 'saveRoll');

describe('monster auras', () => {
  it('a failed save poisons and emits a feature event named after the aura', () => {
    const t = setup([hard], 1);
    t.until('v');
    t.passTo('v');
    expect(t.v.conditions.some((c) => c.condition === 'poisoned')).toBe(true);
    expect(t.ev.some((e) => e.type === 'feature' && e.id === 'aura_stench' && e.label === 'Stench')).toBe(true);
  });

  it('a success grants immunity for the rest of the fight when immuneOnSuccess, and not otherwise', () => {
    const t = setup([{ ...stench, save: { ability: 'con', dc: 1 } }], 2);
    t.until('v');
    expect(saves(t.ev).length).toBe(1);
    t.passTo('v');
    t.passTo('v');
    expect(saves(t.ev).length).toBe(1);
    const again = setup([{ ...stench, save: { ability: 'con', dc: 1 }, immuneOnSuccess: false }], 2);
    again.until('v');
    again.passTo('v');
    again.passTo('v');
    expect(saves(again.ev).length).toBeGreaterThan(1);
  });

  it('does nothing beyond its radius, from an incapacitated owner, or to a creature immune to the condition', () => {
    const far = setup([hard], 3);
    far.until('v');
    expect(saves(far.ev).length).toBe(0);
    const down = setup([hard], 1, {}, (_v, m) => m.conditions.push({ condition: 'incapacitated', rounds: null }));
    down.until('v');
    expect(saves(down.ev).length).toBe(0);
    const immune = setup([hard], 1, { conditionImmunities: ['poisoned'] });
    immune.until('v');
    expect(saves(immune.ev).length).toBe(0);
  });

  it('does not affect its own side', () => {
    // A fellow monster beside the emitter is never asked to save; a far-off hero keeps the fight going.
    const mate = instantiateMonster(mon({ id: 'mate', hp: 100, actions: [] }), 'mate', { x: 3, y: 4 });
    const m = instantiateMonster(mon({ id: 'emitter', hp: 100, actions: [], auras: [hard] }), 'm', { x: 2, y: 4 });
    const hero = instantiateMonster(mon({ id: 'hero', hp: 100, actions: [] }), 'hero', { x: 14, y: 8 });
    hero.faction = 'player';
    const combat = createCombat([hero, mate, m], arena, new ScriptedRng(1), {});
    const ev = combat.begin();
    for (let i = 0; i < 6; i++) ev.push(...combat.execute({ type: 'endTurn' }));
    expect(saves(ev).length).toBe(0);
    expect(mate.conditions.length).toBe(0);
  });

  it('damage auras deal full damage on a failure, half on a success when halfOnSave, and respect resistance', () => {
    const fail = setup([burn], 1);
    fail.until('m');
    const before = fail.v.hp;
    fail.rng.queue = [1, 6, 6];
    fail.passTo('v');
    expect(before - fail.v.hp).toBe(12);
    const pass = setup([{ ...burn, save: { ability: 'con', dc: 1 } }], 1);
    pass.until('m');
    const kept = pass.v.hp;
    pass.rng.queue = [20, 6, 6];
    pass.passTo('v');
    expect(kept - pass.v.hp).toBe(6);
    const resist = setup([burn], 1, { resistances: ['fire'] });
    resist.until('m');
    const held = resist.v.hp;
    resist.rng.queue = [1, 6, 6];
    resist.passTo('v');
    expect(held - resist.v.hp).toBe(6);
  });
});

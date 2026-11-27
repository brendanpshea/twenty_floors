import { describe, expect, it } from 'vitest';
import type { ActionDef, DamageType, GameEvent, MonsterDef } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { toCreature } from './character';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { ScriptedRng, mon } from './testing/fixtures';
import { presetHero } from './testing/heroes';
import { createOpenRoomNav } from './testing/openRoomNav';

const arena = createOpenRoomNav(16, 9);
const zap = (type: DamageType): ActionDef => ({
  id: 'zap', name: 'Zap', description: '', cost: 'action', effects: ['magic'],
  targeting: { kind: 'creature', melee: false, range: 30, longRange: 120 }, attack: { bonus: 30 }, damage: [{ dice: '1d4', type }],
});
const regenerator = (stoppedBy?: DamageType[]): MonsterDef =>
  mon({ id: 'test_regen', name: 'Regenerator', hp: 100, ac: 10, actions: [], regeneration: { amount: 15, ...(stoppedBy ? { stoppedBy } : {}) } });

/** The hero zaps the monster once (damage `type`, or nothing), then the turn comes round to the monster. */
function round(def: MonsterDef, type: DamageType | null, startHp = 50): { hp: number; ev: GameEvent[] } {
  const h = toCreature(presetHero('defender'), { x: 3, y: 4 });
  h.actions.push(zap(type ?? 'fire'));
  const f = instantiateMonster(def, 'f', { x: 10, y: 4 });
  f.hp = startHp;
  const combat = createCombat([h, f], arena, new ScriptedRng(2), {});
  combat.begin();
  for (let i = 0; i < 20 && combat.activeId !== 'player'; i++) combat.execute({ type: 'endTurn' });
  if (type) combat.execute({ type: 'action', actionId: 'zap', targetId: 'f' });
  const ev: GameEvent[] = [];
  // A monster dropped to 0 ends the fight (the hero is alone against it): nothing more to run.
  for (let i = 0; i < 20 && !f.dead && combat.activeId !== 'f'; i++) ev.push(...combat.execute({ type: 'endTurn' }));
  return { hp: f.hp, ev };
}
const def = (id: string): MonsterDef | undefined => MONSTERS.find((m) => m.id === id);
const logs = (ev: GameEvent[]): string[] => ev.filter((e): e is Extract<GameEvent, { type: 'log' }> => e.type === 'log').map((e) => e.text);

describe('monster regeneration', () => {
  it('heals at the start of its turn, up to its maximum, and emits a feature event', () => {
    const r = round(regenerator(), null, 50);
    expect(r.hp).toBe(65);
    expect(r.ev.some((e) => e.type === 'feature' && e.id === 'regeneration')).toBe(true);
    expect(round(regenerator(), null, 95).hp).toBe(100);
  });
  it('is stopped for a turn by damage of a stopping type, with a different log line', () => {
    const r = round(regenerator(['acid', 'fire']), 'fire');
    expect(r.hp).toBeLessThan(50);
    expect(logs(r.ev).some((t) => t.includes('cannot regenerate'))).toBe(true);
    expect(r.ev.some((e) => e.type === 'feature' && e.id === 'regeneration')).toBe(false);
  });
  it('is not stopped by other damage types, or when no type stops it', () => {
    expect(round(regenerator(['acid', 'fire']), 'cold').hp).toBeGreaterThan(50);
    expect(round(regenerator(), 'fire').hp).toBeGreaterThan(50);
  });
  it('does not bring a monster back from 0 hit points', () => {
    expect(round(regenerator(), 'fire', 1).hp).toBe(0);
  });
  it('is carried from the data: troll stops on acid and fire, oni and shield guardian do not', () => {
    expect(def('troll')?.regeneration).toEqual({ amount: 15, stoppedBy: ['acid', 'fire'] });
    expect(def('oni')?.regeneration).toEqual({ amount: 10 });
    expect(def('shield_guardian')?.regeneration).toEqual({ amount: 10 });
  });
});

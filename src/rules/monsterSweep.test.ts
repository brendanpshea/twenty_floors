import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { MonsterDef } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { applyLevelUp, buildFromPreset, createCharacter, suggestedLevelChoices, toCreature } from './character';
import { FIGHTER } from './classes';
import { createCombat } from './combat';
import { instantiateMonster } from './monster';
import { runAiTurn, runTurnWith } from './ai';
import { playerPolicy } from './sim';
import { createOpenRoomNav } from './testing/openRoomNav';

/**
 * Every monster duels a level-appropriate hero (the default Defender with the starting kit) for up to 60 rounds.
 * It looks for engine problems: fights that never end, exceptions, and monsters the hero cannot damage at all.
 *
 * The default run checks a fixed subset (every sixth monster). SWEEP=1 runs all of them and prints a report:
 *   SWEEP=1 npx vitest run src/rules/monsterSweep.test.ts --disableConsoleIntercept
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const full = !!env['SWEEP'];
const MAX_ROUNDS = 60;
const nav = createOpenRoomNav(20, 12);

export interface DuelResult {
  id: string;
  cr: number;
  heroLevel: number;
  outcome: 'won' | 'lost' | 'timeout';
  rounds: number;
  /** Fraction of the monster's hit points the hero removed. */
  damageDealt: number;
}

function heroAtLevel(level: number, preset = 0): ReturnType<typeof createCharacter> {
  let pc = createCharacter(buildFromPreset(FIGHTER.presets[preset]!, 'soldier', { name: 'Sweep' }));
  while (pc.level < level) pc = applyLevelUp(pc, suggestedLevelChoices(pc));
  return pc;
}

export function duel(def: MonsterDef, seed = 1, preset = 0): DuelResult {
  const heroLevel = Math.max(1, Math.min(20, Math.ceil(def.cr) + 1));
  const hero = toCreature(heroAtLevel(heroLevel, preset), { x: 3, y: 6 });
  const foe = instantiateMonster(def, 'm', { x: 10, y: 6 });
  const combat = createCombat([hero, foe], nav, new Rng(seed));
  combat.begin();
  let guard = 0;
  while (!combat.isOver && combat.round <= MAX_ROUNDS && guard++ < 2000) {
    if (combat.activeId === 'player') runTurnWith(combat, (c) => playerPolicy(c, nav));
    else runAiTurn(combat, nav);
  }
  const outcome = combat.isOver ? (combat.winner === 'player' ? 'won' : 'lost') : 'timeout';
  return { id: def.id, cr: def.cr, heroLevel, outcome, rounds: combat.round, damageDealt: 1 - Math.max(0, foe.hp) / foe.maxHp };
}

describe('monster sweep', () => {
  const subset = MONSTERS.filter((_, i) => i % 6 === 0);

  it('has the monsters it expects', () => {
    expect(MONSTERS.length).toBeGreaterThan(150);
  });

  it('a fixed subset of monsters each finish a duel within 60 rounds, or are plainly unharmable', () => {
    for (const def of subset) {
      const r = duel(def);
      const unharmable = r.damageDealt === 0 && r.outcome === 'timeout';
      expect(r.outcome === 'timeout' && !unharmable, `${def.id} (hero level ${r.heroLevel}) never finished although the hero can hurt it`).toBe(false);
    }
  }, 120_000);

  it.skipIf(!full)('full sweep: report', () => {
    const results = MONSTERS.map((m) => duel(m));
    const timeouts = results.filter((r) => r.outcome === 'timeout');
    const unharmable = results.filter((r) => r.damageDealt === 0);
    const lost = results.filter((r) => r.outcome === 'lost');
    console.log(`SWEEP ${results.length} monsters: won ${results.filter((r) => r.outcome === 'won').length}, lost ${lost.length}, timeout ${timeouts.length}`);
    console.log('SWEEP timeouts: ' + timeouts.map((r) => `${r.id}(cr ${r.cr}, dmg ${(r.damageDealt * 100).toFixed(0)}%)`).join(', '));
    console.log('SWEEP unharmable: ' + unharmable.map((r) => `${r.id}(cr ${r.cr})`).join(', '));
    console.log('SWEEP lost: ' + lost.map((r) => `${r.id}(cr ${r.cr}, hero ${r.heroLevel}, r${r.rounds})`).join(', '));
    for (const [i, name] of ['Defender', 'Great Weapon', 'Archer'].entries()) {
      const rs = MONSTERS.map((m) => duel(m, 1, i));
      console.log(
        `SWEEP ${name}: won ${rs.filter((r) => r.outcome === 'won').length}, timeouts ${rs.filter((r) => r.outcome === 'timeout').map((r) => r.id).join(',') || 'none'}, ` +
          `unharmable ${rs.filter((r) => r.damageDealt === 0).map((r) => r.id).join(',') || 'none'}`,
      );
    }
    expect(results.length).toBe(MONSTERS.length);
  }, 1_200_000);
});

import { describe, it } from 'vitest';
import { expertPolicy, expertStance, playerPolicy } from '../rules';
import { arriveAt } from './floorFit.shared';
import { simulateFloor } from './index';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * The game's real floors (opt-in: REAL=1): runSeed 1..3 at the given depths, the hero of the fit (scheduled gear, 4 potions,
 * a level-appropriate Blink Dog), many combat seeds on the same floor. Compare with the fit's sampled floors (floorFit*.test.ts).
 */
describe('fit on the real floors', () => {
  it.skipIf(!env['REAL'])('REPORT', () => {
    const depths = (env['REAL_DEPTHS'] ?? '5,6').split(',').map(Number);
    const n = Number(env['REAL_RUNS'] ?? 40);
    for (const depth of depths) {
      for (const [name, policy] of [['expert', expertPolicy], ['naive', playerPolicy]] as const) {
        for (const runSeed of [1, 2, 3]) {
          const { pc, companion } = arriveAt(depth);
          let clears = 0;
          let boss = 0;
          const killers: Record<string, number> = {};
          let bossMonsters = '';
          for (let a = 0; a < n; a++) {
            const r = simulateFloor(pc, { runSeed, depth, attempt: a, policy, ...(companion ? { companion: { id: 'blink_dog', stance: name === 'naive' ? 'close' : expertStance('blink_dog'), state: companion } } : {}) });
            if (r.cleared) clears++;
            else if (r.death?.role === 'boss') boss++;
            if (!r.cleared && r.death) killers[r.death.killer] = (killers[r.death.killer] ?? 0) + 1;
            if (!bossMonsters) bossMonsters = r.log.filter((l) => l.role === 'boss').map((l) => l.monsters.join('+')).join(' | ');
          }
          console.log(`REAL depth ${depth} ${name} seed ${runSeed}: ${clears}/${n} clears, boss deaths ${boss}, killers ${JSON.stringify(killers)}, boss room: ${bossMonsters} hero HP ${pc.maxHp} AC? level ${pc.level}`);
        }
      }
    }
  }, 3_000_000);
});

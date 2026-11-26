import { it } from 'vitest';
import { CHEST_RULE, ECONOMY, ENCOUNTER_TUNING, createCharacter } from '../rules';
import { heroBuild } from './builds';
import { encounterStats, formatSummary, simulateRun } from './index';

// Developer harness, skipped unless BALANCE_TUNE=1:
//   BALANCE_TUNE=1 BALANCE_N=300 BALANCE_KITS=a,b,c BALANCE_SPECIES=human
//   BALANCE_OVERRIDES='{"budgetByLevel":[30,80,120]}'   (shallow-merged into ENCOUNTER_TUNING)
//   npx vitest run src/balance/tune.test.ts --disableConsoleIntercept
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const enabled = env['BALANCE_TUNE'] === '1';
const n = Number(env['BALANCE_N'] ?? 300);

it.skipIf(!enabled)(
  'tuning table',
  () => {
    if (env['BALANCE_OVERRIDES']) Object.assign(ENCOUNTER_TUNING, JSON.parse(env['BALANCE_OVERRIDES']));
    if (env['BALANCE_CHEST']) Object.assign(CHEST_RULE, JSON.parse(env['BALANCE_CHEST']));
    if (env['BALANCE_ECONOMY']) Object.assign(ECONOMY, JSON.parse(env['BALANCE_ECONOMY']));
    if (env['BALANCE_NOKITE']) (globalThis as { __NOKITE?: boolean }).__NOKITE = true;
    const seeds = Array.from({ length: n }, (_, i) => 1000 + i);
    const lines: string[] = [];
    for (const kit of (env['BALANCE_KITS'] ?? 'a,b,c').split(',')) {
      const species = env['BALANCE_SPECIES'] ?? 'human';
      const sum = simulateRun(heroBuild(kit, species, env['BALANCE_STYLE']), seeds, {
          careless: env['BALANCE_CARELESS'] === '1',
          shortRests: env['BALANCE_RESTS'] === undefined || env['BALANCE_RESTS'] === '' ? undefined : Number(env['BALANCE_RESTS']),
          makePc: (b) => {
            const pc = createCharacter(b);
            const extra = Number(env['BALANCE_EXTRA_POTIONS'] ?? 0);
            const s = pc.inventory.find((i) => i.itemId === 'potion_healing');
            if (s) s.quantity += extra;
            const armor = env['BALANCE_ARMOR'];
            if (armor) {
              pc.inventory.push({ itemId: armor, quantity: 1 });
              pc.equipped.armor = armor;
            }
            return pc;
          },
      });
      lines.push(formatSummary(`kit ${kit} ${species}`, sum));
      if (env["BALANCE_ROOMS"] === "1") {
        for (const f of sum.floors) {
          for (const [k, e] of Object.entries(f.rooms).sort((x, y) => y[1].deaths / y[1].n - x[1].deaths / x[1].n)) {
            if (e.n >= 15) lines.push(`    f${f.depth} ${k}: n${e.n} death ${((e.deaths / e.n) * 100).toFixed(0)}%`);
          }
        }
      }
    }
    for (const d of [1, 2, 3]) lines.push('  encounters ' + JSON.stringify(encounterStats(d, seeds.slice(0, 100))));
    console.log(lines.join('\n'));
  },
  900_000,
);

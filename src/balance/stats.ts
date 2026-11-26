import { Rng, floorSeed, hashSeed } from '../core/rng';
import { themeForDepth } from '../core/themes';
import { MONSTERS } from '../data/monsters';
import { generateFloor } from '../gen';
import { buildEncounters } from '../rules';

export interface EncounterStats {
  depth: number;
  /** Mean monsters per ordinary combat room that has any. */
  perCombatRoom: number;
  /** Share of combat rooms with at least two monsters. */
  multiShare: number;
  /** Mean monsters in the boss room, boss included. */
  perBossRoom: number;
}

/** How populated generated floors are under the current ENCOUNTER_TUNING. */
export function encounterStats(depth: number, seeds: number[]): EncounterStats {
  let rooms = 0;
  let monsters = 0;
  let multi = 0;
  let bossRooms = 0;
  let bossMonsters = 0;
  for (const runSeed of seeds) {
    const plan = generateFloor({ seed: floorSeed(runSeed, depth), depth, theme: themeForDepth(depth) });
    const placed = buildEncounters(plan, MONSTERS, new Rng(hashSeed(floorSeed(runSeed, depth), 'encounters')));
    for (const room of plan.rooms) {
      const n = placed.filter((m) => m.roomId === room.id).length;
      if (n === 0) continue;
      if (room.role === 'boss') {
        bossRooms++;
        bossMonsters += n;
      } else {
        rooms++;
        monsters += n;
        if (n >= 2) multi++;
      }
    }
  }
  return { depth, perCombatRoom: monsters / Math.max(1, rooms), multiShare: multi / Math.max(1, rooms), perBossRoom: bossMonsters / Math.max(1, bossRooms) };
}

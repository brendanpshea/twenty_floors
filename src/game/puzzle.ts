import type { PuzzleGrade, PuzzleRequest } from '../core/types';
import type { Rng } from '../core/rng';
import { chestLoot, getItem } from '../rules';

type Loot = ReturnType<typeof chestLoot>;

/** "120 gp, 2 potions of healing, Blowgun +1". */
export function describeLoot(loot: Loot): string {
  const parts = [`${loot.gold} gp`];
  for (const it of loot.items) {
    const name = getItem(it.itemId)?.name ?? it.itemId;
    parts.push(it.quantity > 1 ? `${it.quantity} x ${name}` : name);
  }
  return parts.join(', ');
}

/** The loot a chest would pay at a grade, from a fresh fork of the chest's own stream: exactly what opening it then gives. */
export function lootFor(depth: number, rng: () => Rng, grade: PuzzleGrade, boss: boolean, chestsOnFloor: number): Loot {
  return chestLoot(depth, rng(), { grade, chestsOnFloor, ...(boss ? { boss: true } : {}) });
}

/** The words of the lock puzzle's rewards: each grade's real payout, worked out the same way the payout is. */
export function rewardWords(depth: number, rng: () => Rng, boss: boolean, chestsOnFloor: number): PuzzleRequest['rewards'] {
  const say = (g: PuzzleGrade): string => describeLoot(lootFor(depth, rng, g, boss, chestsOnFloor));
  return { gold: say('gold'), silver: say('silver'), bronze: say('bronze'), skip: say('none') };
}

/** What the banner says after the lock is dealt with. */
export function gradeWords(grade: PuzzleGrade): string {
  return grade === 'gold' ? 'Gold!' : grade === 'silver' ? 'Silver!' : grade === 'bronze' ? 'Bronze.' : 'Forced open.';
}

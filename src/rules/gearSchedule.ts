import type { PlayerCharacter } from '../core/types';
import { getItem } from './items';

/**
 * The design gear schedule: what a hero of each level is assumed to carry (the balance floor fit gives it for free) and what
 * the shop must therefore always have on offer. Heavy armor climbs chain mail, splint at 3, plate at 5, and medium armor
 * scale mail, breastplate at 3, half plate at 5; +1 armor from 5, +2 from 10, +3 from 16; +1 weapons from 4, +2 from 9,
 * +3 from 15; a +1 shield from 8 and +2 from 13. The balance harness plays it as `scheduleGear`, the shop stocks it
 * (`shopStock`), and the economy test checks that the gold of the floors covers it.
 */
export const GEAR_SCHEDULE = {
  heavy: { base: ['chain_mail', 'splint', 'plate'], from: [1, 3, 5] },
  medium: { base: ['scale_mail', 'breastplate', 'half_plate'], from: [1, 3, 5] },
  armorBonus: [[5, 1], [10, 2], [16, 3]] as [number, number][],
  weaponBonus: [[4, 1], [9, 2], [15, 3]] as [number, number][],
  shieldBonus: [[8, 1], [13, 2]] as [number, number][],
};

const at = (level: number, steps: [number, number][]): number => steps.reduce((v, [from, n]) => (level >= from ? n : v), 0);
const baseOf = (id: string): string => getItem(id)?.baseId ?? id;
const withBonus = (base: string, n: number): string => (n > 0 && getItem(`${base}_plus${n}`) ? `${base}_plus${n}` : base);

export interface ScheduledGear {
  armor?: string;
  mainHand?: string;
  ranged?: string;
  offHand?: string;
}

/** The armor tier (mundane base id) the schedule has for this armor family at a level. */
export function scheduledArmorBase(level: number, current: string): string {
  const b = baseOf(current);
  for (const fam of [GEAR_SCHEDULE.heavy, GEAR_SCHEDULE.medium]) {
    if (!fam.base.includes(b)) continue;
    let out = fam.base[0] as string;
    fam.base.forEach((id, i) => {
      if (level >= (fam.from[i] as number)) out = id;
    });
    return out;
  }
  return b;
}

/** The item ids the schedule has `equipped` become at `level` (what is not in the schedule is left as it is). */
export function scheduledGear(level: number, equipped: Pick<PlayerCharacter['equipped'], 'armor' | 'mainHand' | 'ranged' | 'offHand'>): ScheduledGear {
  const out: ScheduledGear = {};
  if (equipped.armor) out.armor = withBonus(scheduledArmorBase(level, equipped.armor), at(level, GEAR_SCHEDULE.armorBonus));
  const wb = at(level, GEAR_SCHEDULE.weaponBonus);
  if (equipped.mainHand) out.mainHand = withBonus(baseOf(equipped.mainHand), wb);
  if (equipped.ranged) out.ranged = withBonus(baseOf(equipped.ranged), wb);
  const off = equipped.offHand ? getItem(equipped.offHand) : undefined;
  if (off?.kind === 'shield') out.offHand = withBonus(baseOf(off.id), at(level, GEAR_SCHEDULE.shieldBonus));
  else if (off?.weapon && equipped.offHand) out.offHand = withBonus(baseOf(equipped.offHand), wb);
  return out;
}

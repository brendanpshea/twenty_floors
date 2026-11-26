import type { Rng } from '../core/rng';
import type { Dice } from '../core/types';

export interface ParsedDice {
  count: number;
  sides: number;
  mod: number;
}

const DICE_RE = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;
const FLAT_RE = /^\s*([+-]?\d+)\s*$/;

/** Parse "2d6+3", "1d4-1", "d8" or a flat "5". Throws on anything else. */
export function parseDice(dice: Dice): ParsedDice {
  const flat = FLAT_RE.exec(dice);
  if (flat) return { count: 0, sides: 0, mod: parseInt(flat[1] as string, 10) };
  const m = DICE_RE.exec(dice);
  if (!m) throw new Error(`Invalid dice notation: "${dice}"`);
  const count = m[1] === '' ? 1 : parseInt(m[1] as string, 10);
  const sides = parseInt(m[2] as string, 10);
  if (sides < 1) throw new Error(`Invalid dice notation: "${dice}"`);
  const mod = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4] as string, 10) : 0;
  return { count, sides, mod };
}

export function formatDice(p: ParsedDice): Dice {
  if (p.count === 0) return String(p.mod);
  const mod = p.mod === 0 ? '' : p.mod > 0 ? `+${p.mod}` : String(p.mod);
  return `${p.count}d${p.sides}${mod}`;
}

/** Critical hits double the dice, never the modifier. */
export function critDice(dice: Dice): Dice {
  const p = parseDice(dice);
  return formatDice({ ...p, count: p.count * 2 });
}

export function withModifier(dice: Dice, extra: number): Dice {
  const p = parseDice(dice);
  return formatDice({ ...p, mod: p.mod + extra });
}

export interface RollOptions {
  crit?: boolean;
  /** Dice that roll below this count as this value (Great Weapon Fighting). */
  minDie?: number;
}

export interface RollResult {
  total: number;
  rolls: number[];
  mod: number;
}

export function rollDice(rng: Rng, dice: Dice, opts: RollOptions = {}): RollResult {
  const p = parseDice(dice);
  const count = opts.crit ? p.count * 2 : p.count;
  const rolls: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    let r = rng.die(p.sides);
    if (opts.minDie !== undefined && r < opts.minDie) r = Math.min(opts.minDie, p.sides);
    rolls.push(r);
    sum += r;
  }
  return { total: Math.max(0, sum + p.mod), rolls, mod: p.mod };
}

export function averageDice(dice: Dice, opts: RollOptions = {}): number {
  const p = parseDice(dice);
  const count = opts.crit ? p.count * 2 : p.count;
  let perDie = (p.sides + 1) / 2;
  if (opts.minDie !== undefined && p.sides > 0) {
    let s = 0;
    for (let f = 1; f <= p.sides; f++) s += Math.max(f, Math.min(opts.minDie, p.sides));
    perDie = s / p.sides;
  }
  return count * perDie + p.mod;
}

export function maxDice(dice: Dice, opts: RollOptions = {}): number {
  const p = parseDice(dice);
  const count = opts.crit ? p.count * 2 : p.count;
  return count * p.sides + p.mod;
}

export function minDice(dice: Dice, opts: RollOptions = {}): number {
  const p = parseDice(dice);
  const count = opts.crit ? p.count * 2 : p.count;
  return Math.max(0, count + p.mod);
}

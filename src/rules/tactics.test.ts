import { describe, expect, it } from 'vitest';
import { MONSTERS } from '../data/monsters';
import { summarize, tacticOf, inferTactic } from './tactics';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('tacticOf', () => {
  it('REPORT the tactic of every monster', () => {
    const rows = MONSTERS.map((m) => {
      const s = summarize(m);
      return `${tacticOf(m).padEnd(10)} ${m.id.padEnd(26)} ${m.role.padEnd(8)} ${m.type.padEnd(11)} cr${String(m.cr).padEnd(5)} ${m.speedFt}ft m${s.melee.toFixed(0)} r${s.ranged.toFixed(0)} s${s.spell.toFixed(0)} b${s.breath.toFixed(0)} rc${s.rangeCells} ${s.control ? "ctl" : ""} ${m.traits.join(',')}${m.tactic ? ' [override]' : ''}`;
    });
    if (env['TACTIC_REPORT']) console.log(rows.sort().join('\n'));
    expect(rows.length).toBe(MONSTERS.length);
    expect(MONSTERS.every((m) => inferTactic(m) !== undefined)).toBe(true);
  });
});

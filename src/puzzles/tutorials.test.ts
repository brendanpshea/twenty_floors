import { describe, expect, it } from 'vitest';
import { apply, isSolved, start } from './engine';
import { TUTORIALS } from './tutorials';
import { PUZZLE_KINDS } from './types';
import type { PuzzleInstance, PuzzleState } from './types';

/** How many board elements of each address kind the instance has. */
function spotRange(inst: PuzzleInstance): Record<string, [number, number]> {
  switch (inst.kind) {
    case 'runes':
      return { cell: [0, inst.data.n * inst.data.n - 1], sym: [1, inst.data.n] };
    case 'tumblers':
      return { slot: [0, inst.data.length - 1], sym: [0, inst.data.symbols - 1] };
    case 'conduits':
      return { cell: [0, inst.data.w * inst.data.h - 1] };
    case 'wards':
      return { cell: [0, inst.data.w * inst.data.h - 1] };
  }
}
const ACTS: Record<string, string[]> = { runes: ['erase'], tumblers: ['try'], conduits: [], wards: ['open', 'mark'] };

describe('lock tutorials', () => {
  for (const kind of PUZZLE_KINDS) {
    it(`${kind}: every step can be completed with its "Show me" moves, and the lock ends open`, () => {
      const t = TUTORIALS[kind];
      expect(t.kind).toBe(kind);
      expect(t.instance.kind).toBe(kind);
      expect(t.steps.length).toBeGreaterThan(0);
      let s: PuzzleState = start(t.instance);
      t.steps.forEach((step, i) => {
        const where = `${kind} step ${i + 1}`;
        expect(step.text.length, where).toBeGreaterThan(0);
        if (!step.goal) {
          expect(step.show, `${where}: a reading step plays no moves`).toBeUndefined();
          return;
        }
        expect(step.goal(s), `${where}: already done before it starts`).toBe(false);
        expect(step.show?.length, `${where}: needs Show me moves`).toBeGreaterThan(0);
        for (const m of step.show ?? []) {
          if (step.allow) expect(step.allow(m, s), `${where}: its own Show me move is refused`).toBe(true);
          const next = apply(s, m);
          expect(next, `${where}: a Show me move changes nothing`).not.toBe(s);
          s = next;
        }
        expect(step.goal(s), `${where}: Show me does not reach the goal`).toBe(true);
      });
      expect(isSolved(s), `${kind}: the tutorial ends with the lock open`).toBe(true);
    });

    it(`${kind}: every spotlight names an element the board has, and inline symbols are in range`, () => {
      const t = TUTORIALS[kind];
      const range = spotRange(t.instance);
      for (const step of t.steps) {
        for (const spot of step.spot ?? []) {
          const [what, arg] = spot.split(':') as [string, string];
          if (what === 'act') expect(ACTS[kind], spot).toContain(arg);
          else {
            const r = range[what];
            expect(r, `${kind}: ${spot}`).toBeDefined();
            const n = Number(arg);
            expect(n >= (r as [number, number])[0] && n <= (r as [number, number])[1], `${kind}: ${spot}`).toBe(true);
          }
        }
        for (const m of step.text.matchAll(/\{sym:(\d+)\}/g)) {
          const r = range['sym'];
          expect(r, `${kind}: {sym:} used but the board has no symbol palette`).toBeDefined();
          const n = Number(m[1]);
          expect(n >= (r as [number, number])[0] && n <= (r as [number, number])[1], `${kind}: {sym:${n}}`).toBe(true);
        }
      }
    });
  }

  it('a refused move on the tumbler lesson is one the lock would accept (the nudge is the only thing stopping it)', () => {
    const t = TUTORIALS.tumblers;
    const step = t.steps[1] as (typeof t.steps)[number];
    expect(step.allow?.({ type: 'guess', code: [3, 2, 1] }, start(t.instance))).toBe(false);
    expect(step.nudge).toBeTruthy();
  });
});

describe('rune lesson board', () => {
  it('has exactly one solution, reachable by one-rune-left steps alone', async () => {
    const { countRunesSolutions, solveByTechniques } = await import('./runes');
    const inst = TUTORIALS.runes.instance;
    if (inst.kind !== 'runes') throw new Error('not a rune lock');
    const { n, boxRows, boxCols, givens } = inst.data;
    expect(countRunesSolutions(givens, n, boxRows, boxCols)).toBe(1);
    expect(solveByTechniques(givens, n, boxRows, boxCols, 1)).toEqual(inst.solution);
  });
});

import { expect, it } from 'vitest';
import { generatePuzzle } from './engine';
import { conduitsSolved, neighbour, rotations } from './conduits';
import type { ConduitsInstance, WardsInstance } from './types';
import { W_FLAG, W_HIDDEN, W_OPEN } from './types';
import { deduce } from './wards';

/** Max deduction level a board needs. */
function levelNeeded(inst: WardsInstance): number {
  const { w, h, clues, mineCount } = inst.data;
  const status = new Array<number>(w * h).fill(W_HIDDEN);
  for (const i of inst.data.start) status[i] = W_OPEN;
  let used = 0;
  for (;;) {
    const ds = deduce(w, h, clues, status, mineCount, 3);
    if (!ds.length) break;
    for (const d of ds) {
      used = Math.max(used, d.level);
      status[d.cell] = d.mine ? W_FLAG : W_OPEN;
    }
  }
  return used;
}

it('wards: deeper difficulties need deeper deductions', () => {
  const lines: string[] = [];
  const avg: number[] = [];
  for (let d = 1; d <= 10; d++) {
    const counts = [0, 0, 0, 0];
    for (let s = 1; s <= 30; s++) counts[levelNeeded(generatePuzzle({ kind: 'wards', seed: s, difficulty: d }) as WardsInstance)]!++;
    lines.push(`wards d${d}: needs L1 ${counts[1]}, L2 ${counts[2]}, L3 ${counts[3]} (of 30)`);
    avg.push((counts[1]! + counts[2]! * 2 + counts[3]! * 3) / 30);
  }
  console.log(lines.join('\n'));
  expect(avg[9]).toBeGreaterThan(avg[0] as number);
});

/** Independent uniqueness check: column-major search, joints verified pairwise, leaf verified by conduitsSolved. */
function countIndependent(inst: ConduitsInstance): number {
  const { w, h, wrap, locked } = inst.data;
  const n = w * h;
  const order: number[] = [];
  for (let c = 0; c < w; c++) for (let r = 0; r < h; r++) order.push(r * w + c);
  const cur = new Array<number>(n).fill(-1);
  let count = 0;
  const bits = [1, 2, 4, 8];
  const consistent = (cell: number): boolean => {
    const m = cur[cell] as number;
    for (let d = 0; d < 4; d++) {
      const nb = neighbour(w, h, wrap, cell, d);
      const open = (m & (bits[d] as number)) !== 0;
      if (nb < 0) {
        if (open) return false;
        continue;
      }
      const o = cur[nb] as number;
      if (o < 0) continue;
      if (open !== ((o & (bits[(d + 2) % 4] as number)) !== 0)) return false;
    }
    return true;
  };
  const rec = (k: number): void => {
    if (count >= 2) return;
    if (k === n) {
      if (conduitsSolved(inst, cur)) count++;
      return;
    }
    const cell = order[k] as number;
    for (const m of locked[cell] ? [inst.solution[cell] as number] : rotations(inst.solution[cell] as number)) {
      cur[cell] = m;
      if (consistent(cell)) rec(k + 1);
    }
    cur[cell] = -1;
  };
  rec(0);
  return count;
}

it('conduits: an independent column-major search agrees the solution is unique', () => {
  for (const d of [1, 2, 3, 4]) {
    for (let s = 1; s <= 5; s++) {
      const inst = generatePuzzle({ kind: 'conduits', seed: s, difficulty: d }) as ConduitsInstance;
      expect(countIndependent(inst), `d${d} s${s}`).toBe(1);
    }
  }
});

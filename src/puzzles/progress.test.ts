import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generatePuzzle } from './engine';
import { gradeResult, prospectiveGrade, timeThresholds } from './grading';
import { simulatePlayer } from './sim';
import { newSkill, nextDifficulty, pickKind, ratingFor, seenKinds, updateSkill } from './skill';
import { PUZZLE_KINDS } from './types';
import type { PlayerSkill, PuzzleKind, RawResult } from './types';

const base: RawResult = { outcome: 'solved', seconds: 10, mistakes: 0, hintsUsed: 0, moves: 0 };

describe('grading', () => {
  const runes = generatePuzzle({ kind: 'runes', seed: 1, difficulty: 3 });
  const tumblers = generatePuzzle({ kind: 'tumblers', seed: 1, difficulty: 3 });
  const par = runes.parSeconds;

  it('gold up to 2x par, boundary inclusive (GRADE_TIME)', () => {
    expect(gradeResult(runes, { ...base, seconds: par * 2 }).grade).toBe('gold');
    expect(gradeResult(runes, { ...base, seconds: par * 2 + 0.1 }).grade).toBe('silver');
  });

  it('silver up to 4x par, bronze beyond', () => {
    expect(gradeResult(runes, { ...base, seconds: par * 4 }).grade).toBe('silver');
    expect(gradeResult(runes, { ...base, seconds: par * 4 + 0.1 }).grade).toBe('bronze');
  });

  it('the pace grade the skill model learns from keeps the original par and 2x par', () => {
    expect(gradeResult(runes, { ...base, seconds: par }).paceGrade).toBe('gold');
    expect(gradeResult(runes, { ...base, seconds: par + 0.1 }).paceGrade).toBe('silver');
    expect(gradeResult(runes, { ...base, seconds: par * 2 + 0.1 }).paceGrade).toBe('bronze');
    expect(gradeResult(runes, { ...base, seconds: par * 1.5 }).grade).toBe('gold');
  });

  it('mistakes: allowance for gold, a few for silver', () => {
    const a = runes.mistakeAllowance;
    expect(gradeResult(runes, { ...base, mistakes: a }).grade).toBe('gold');
    expect(gradeResult(runes, { ...base, mistakes: a + 1 }).grade).toBe('silver');
    expect(gradeResult(runes, { ...base, mistakes: a + 2 }).grade).toBe('silver');
    expect(gradeResult(runes, { ...base, mistakes: a + 3 }).grade).toBe('bronze');
  });

  it('hints: one caps at silver, two at bronze', () => {
    expect(gradeResult(runes, { ...base, hintsUsed: 1 }).grade).toBe('silver');
    expect(gradeResult(runes, { ...base, hintsUsed: 2 }).grade).toBe('bronze');
  });

  it('guess par for tumblers', () => {
    const pm = tumblers.parMoves as number;
    expect(gradeResult(tumblers, { ...base, moves: pm }).grade).toBe('gold');
    expect(gradeResult(tumblers, { ...base, moves: pm + 1 }).grade).toBe('silver');
    expect(gradeResult(tumblers, { ...base, moves: Math.ceil(pm * 1.5) + 1 }).grade).toBe('bronze');
  });

  it('skipped and failed pay nothing; solved but very slow is still bronze', () => {
    expect(gradeResult(runes, { ...base, outcome: 'skipped' }).grade).toBe('none');
    expect(gradeResult(tumblers, { ...base, outcome: 'failed' }).grade).toBe('none');
    expect(gradeResult(runes, { ...base, seconds: 99999, mistakes: 40, hintsUsed: 9 }).grade).toBe('bronze');
  });

  it('prospective grade and thresholds', () => {
    expect(prospectiveGrade(runes, { seconds: 0, mistakes: 0, hintsUsed: 0, moves: 0 })).toBe('gold');
    expect(prospectiveGrade(runes, { seconds: par * 2 + 1, mistakes: 0, hintsUsed: 0, moves: 0 })).toBe('silver');
    expect(timeThresholds(runes)).toEqual({ gold: par * 2, silver: par * 4 });
  });
});

/** Fixed player: result depends only on strength vs difficulty. */
function playRounds(strength: number, rounds: number, seed: number, noisy = true): { skill: PlayerSkill; ratings: number[]; diffs: number[] } {
  const rng = new Rng(seed);
  let skill = newSkill();
  const ratings: number[] = [];
  const diffs: number[] = [];
  const recent: PuzzleKind[] = [];
  for (let i = 0; i < rounds; i++) {
    const kind = pickKind(rng, skill, recent);
    recent.push(kind);
    const d = nextDifficulty(skill, kind, 1);
    const inst = generatePuzzle({ kind, seed: rng.int(1, 1e6), difficulty: d });
    const raw = simulatePlayer(inst, strength, noisy ? rng : new Rng(1));
    skill = updateSkill(skill, kind, d, gradeResult(inst, raw));
    ratings.push(skill.overall);
    diffs.push(d);
  }
  return { skill, ratings, diffs };
}

describe('adaptive difficulty', () => {
  it('new players start easy', () => {
    const s = newSkill();
    expect(nextDifficulty(s, 'runes', 1)).toBeLessThanOrEqual(2);
    expect(nextDifficulty(s, 'wards', 1)).toBeLessThanOrEqual(2);
  });

  it('depth nudges difficulty up, a little', () => {
    const s = { ...newSkill(), overall: 5 };
    const shallow = nextDifficulty(s, 'runes', 1);
    const deep = nextDifficulty(s, 'runes', 20);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep - shallow).toBeLessThanOrEqual(2);
    expect(nextDifficulty({ ...newSkill(), overall: 10 }, 'runes', 20)).toBe(10);
    expect(nextDifficulty({ ...newSkill(), overall: 1 }, 'runes', 1)).toBe(1);
  });

  it('gold moves up fastest, bronze slightly down, skip/fail down, clamped', () => {
    const inst = generatePuzzle({ kind: 'runes', seed: 1, difficulty: 3 });
    const mk = (r: RawResult) => gradeResult(inst, r);
    const s0 = { ...newSkill(), overall: 4, byKind: { runes: 4 } };
    const gold = updateSkill(s0, 'runes', 4, mk(base));
    const silver = updateSkill(s0, 'runes', 4, mk({ ...base, hintsUsed: 1 }));
    const bronze = updateSkill(s0, 'runes', 4, mk({ ...base, hintsUsed: 3 }));
    const skip = updateSkill(s0, 'runes', 4, mk({ ...base, outcome: 'skipped' }));
    expect(ratingFor(gold, 'runes')).toBeGreaterThan(ratingFor(silver, 'runes'));
    expect(ratingFor(silver, 'runes')).toBeGreaterThan(4);
    expect(ratingFor(bronze, 'runes')).toBeLessThan(4);
    expect(ratingFor(bronze, 'runes')).toBeGreaterThan(ratingFor(skip, 'runes'));
    let low = newSkill();
    for (let i = 0; i < 40; i++) low = updateSkill(low, 'runes', 1, mk({ ...base, outcome: 'skipped' }));
    expect(ratingFor(low, 'runes')).toBeGreaterThanOrEqual(1);
    let high = newSkill();
    for (let i = 0; i < 60; i++) high = updateSkill(high, 'runes', 10, mk(base));
    expect(ratingFor(high, 'runes')).toBeLessThanOrEqual(10);
    expect(high.played).toBe(60);
    expect(seenKinds(high)).toEqual(['runes']);
    // plain JSON
    expect(JSON.parse(JSON.stringify(high))).toEqual(high);
  });

  it('converges for players of different strength', () => {
    const report: string[] = [];
    for (const strength of [2, 4, 6, 8, 10]) {
      const errs5: number[] = [];
      const errs12: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const { ratings } = playRounds(strength, 14, seed * 31);
        errs5.push(Math.abs((ratings[4] as number) - strength));
        errs12.push(Math.abs((ratings[13] as number) - strength));
      }
      const m5 = errs5.reduce((a, b) => a + b, 0) / errs5.length;
      const m14 = errs12.reduce((a, b) => a + b, 0) / errs12.length;
      report.push(`strength ${strength}: mean |error| after 5 = ${m5.toFixed(2)}, after 14 = ${m14.toFixed(2)}`);
      expect(m14, report.join('\n')).toBeLessThan(1.5);
      // "Within about five puzzles": most of the way there.
      const startGap = Math.abs(strength - 2);
      expect(m5, report.join('\n')).toBeLessThan(Math.max(1.8, startGap * 0.6));
    }
    console.log(report.join('\n'));
  });

  it('keeps puzzles in a fair band: a strong player is not stuck on easy ones', () => {
    const { diffs } = playRounds(8, 14, 5);
    const lastFew = diffs.slice(-4);
    expect(Math.max(...lastFew)).toBeGreaterThanOrEqual(6);
    const weak = playRounds(2, 14, 5).diffs.slice(-4);
    expect(Math.max(...weak)).toBeLessThanOrEqual(4);
  });
});

describe('pickKind', () => {
  it('never repeats the last kind', () => {
    const rng = new Rng(3);
    const skill = newSkill();
    for (let i = 0; i < 300; i++) {
      const last = PUZZLE_KINDS[i % PUZZLE_KINDS.length] as PuzzleKind;
      expect(pickKind(rng, skill, [last])).not.toBe(last);
    }
  });

  it('weights toward kinds seen least and covers all kinds', () => {
    const rng = new Rng(8);
    const skill: PlayerSkill = {
      ...newSkill(),
      playedByKind: { runes: 20, tumblers: 20, conduits: 0, wards: 20 },
    };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const k = pickKind(rng, skill, ['runes']);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts['runes'] ?? 0).toBe(0);
    expect(counts['conduits'] as number).toBeGreaterThan((counts['tumblers'] as number) * 2);
    expect(counts['tumblers']).toBeGreaterThan(30);
  });

  it('a simulated session shows variety', () => {
    const rng = new Rng(21);
    let skill = newSkill();
    const recent: PuzzleKind[] = [];
    for (let i = 0; i < 24; i++) {
      const k = pickKind(rng, skill, recent);
      recent.push(k);
      skill = { ...skill, playedByKind: { ...skill.playedByKind, [k]: (skill.playedByKind[k] ?? 0) + 1 } };
    }
    for (const k of PUZZLE_KINDS) expect(skill.playedByKind[k] ?? 0).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < recent.length; i++) expect(recent[i]).not.toBe(recent[i - 1]);
  });
});

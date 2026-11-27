import { describe, expect, it } from 'vitest';
import type { CompanionState, PlayerCharacter } from '../core/types';
import { newCompanionState } from './companion';
import { previewRest } from './restPreview';
import { presetHero } from './testing/heroes';

const hurt = (pc: PlayerCharacter, hp: number): PlayerCharacter => ({ ...pc, hp });
const level5 = (): PlayerCharacter => presetHero('defender', 5);
const dog = (hp?: number): { state: CompanionState } => {
  const state = newCompanionState('blink_dog', 5);
  if (hp !== undefined) state.hp = hp;
  return { state };
};

describe('previewRest: short rest', () => {
  it('says how much HP it recovers and with how many Hit Dice, and counts the rests that remain', () => {
    const pc = level5();
    const r = previewRest(hurt(pc, Math.floor(pc.maxHp / 2)), null, 'short', { shortRestsLeft: 2 });
    expect(r.kind).toBe('short');
    expect(r.gains[0]).toMatch(/^Recover about \d+ HP \(\d Hit Dice?\)$/);
    expect(r.costs).toEqual(['1 short rest left before your next long rest']);
    expect(r.wasteful).toBe(false);
  });

  it('uses the same spending rule as takeShortRest and no dice', () => {
    const pc = level5();
    // Missing 10 of ~44 HP above half: spends dice only while at least an average die (~9) is missing.
    const r = previewRest(hurt(pc, pc.maxHp - 10), null, 'short', { shortRestsLeft: 2 });
    expect(r.gains[0]).toMatch(/\(1 Hit Die\)$/);
    expect(previewRest(hurt(pc, pc.maxHp - 3), null, 'short', { shortRestsLeft: 2 }).gains.join()).not.toMatch(/Recover/);
  });

  it('lists the resources that come back by display name, never hidden ones', () => {
    const pc = level5();
    const spent: PlayerCharacter = { ...pc, hp: pc.maxHp, resources: { ...pc.resources, secondWind: { ...(pc.resources['secondWind'] as object), current: (pc.resources['secondWind']?.max ?? 1) - 1 } as never, _flag: { name: 'Secret', current: 0, max: 1, refresh: 'shortRest' } } };
    const r = previewRest(spent, null, 'short', { shortRestsLeft: 1 });
    expect(r.gains).toContain('Second Wind restored');
    expect(r.gains.join()).not.toMatch(/Secret/);
    expect(r.costs).toEqual(['No more short rests before your next long rest']);
    expect(r.wasteful).toBe(false);
  });

  it('is wasteful when almost nothing would come back', () => {
    const pc = level5();
    const r = previewRest(hurt(pc, pc.maxHp - 2), null, 'short', { shortRestsLeft: 2 });
    expect(r.gains).toEqual([]);
    expect(r.wasteful).toBe(true);
  });

  it('includes the companion', () => {
    const pc = level5();
    const r = previewRest(hurt(pc, Math.floor(pc.maxHp / 2)), dog(5), 'short', { shortRestsLeft: 2 });
    expect(r.gains.some((g) => /^Your Blink Dog recovers about \d+ HP$/.test(g))).toBe(true);
    // A hurt companion alone makes it worthwhile.
    const alone = previewRest(pc, dog(5), 'short', { shortRestsLeft: 2 });
    expect(alone.wasteful).toBe(false);
  });

  it('warns when no short rest is left', () => {
    const pc = level5();
    expect(previewRest(hurt(pc, 5), null, 'short', { shortRestsLeft: 0 }).costs).toEqual(['No short rests left before your next long rest']);
  });
});

describe('previewRest: long rest', () => {
  it('restores all missing HP and Hit Dice, and says what it costs', () => {
    const pc = level5();
    const spent: PlayerCharacter = { ...pc, hp: pc.maxHp - 14, hitDiceLeft: pc.level - 2 };
    const r = previewRest(spent, null, 'long', { shortRestsLeft: 0, restSitesLeft: 3 });
    expect(r.gains).toContain('Restore all 14 missing HP');
    expect(r.gains).toContain('Regain 2 Hit Dice');
    expect(r.gains).toContain('Short rests back to 2');
    expect(r.costs).toEqual(['This site cannot be used again', '2 rest sites left on this floor afterwards']);
    expect(r.wasteful).toBe(false);
  });

  it('handles the last rest site and an unknown count', () => {
    const pc = hurt(level5(), 1);
    expect(previewRest(pc, null, 'long', { shortRestsLeft: 2, restSitesLeft: 1 }).costs).toContain('No rest sites left on this floor afterwards');
    expect(previewRest(pc, null, 'long', { shortRestsLeft: 2 }).costs).toEqual(['This site cannot be used again']);
  });

  it('names the resources that would be restored', () => {
    const pc = level5();
    const spent: PlayerCharacter = { ...pc, resources: { ...pc.resources, actionSurge: { ...(pc.resources['actionSurge'] as object), current: 0 } as never } };
    const r = previewRest(spent, null, 'long', { shortRestsLeft: 2, restSitesLeft: 2 });
    expect(r.gains).toContain('Action Surge restored');
    expect(r.wasteful).toBe(false);
  });

  it('is wasteful when everything is nearly full', () => {
    const pc = level5();
    expect(previewRest(pc, null, 'long', { shortRestsLeft: 2, restSitesLeft: 2 }).wasteful).toBe(true);
    expect(previewRest(hurt(pc, pc.maxHp - 3), null, 'long', { shortRestsLeft: 2, restSitesLeft: 2 }).wasteful).toBe(true);
  });

  it('includes the companion, whose recovery makes the rest worthwhile', () => {
    const pc = level5();
    const r = previewRest(pc, dog(3), 'long', { shortRestsLeft: 2, restSitesLeft: 2 });
    expect(r.gains.some((g) => /^Your Blink Dog recovers \d+ HP$/.test(g))).toBe(true);
    expect(r.wasteful).toBe(false);
    expect(previewRest(pc, dog(), 'long', { shortRestsLeft: 2, restSitesLeft: 2 }).gains.join()).not.toMatch(/Blink Dog/);
  });

  it('does not modify its inputs', () => {
    const pc = hurt(level5(), 7);
    const c = dog(4);
    const a = JSON.stringify([pc, c]);
    previewRest(pc, c, 'long', { shortRestsLeft: 1, restSitesLeft: 2 });
    previewRest(pc, c, 'short', { shortRestsLeft: 1 });
    expect(JSON.stringify([pc, c])).toBe(a);
  });
});

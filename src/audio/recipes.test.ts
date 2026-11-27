import { describe, expect, it } from 'vitest';
import { CAL } from './calibration';
import { recipeDuration } from './helpers';
import { RECIPES } from './recipes';
import { SFX_IDS, type SfxId } from './types';

const UI: SfxId[] = ['uiClick', 'uiHover', 'uiConfirm', 'uiCancel', 'uiError'];

describe('recipe table', () => {
  it('has exactly one recipe per SfxId', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...SFX_IDS].sort());
    expect(new Set(SFX_IDS).size).toBe(SFX_IDS.length);
  });

  it('every layer has finite, sane parameters', () => {
    for (const id of SFX_IDS) {
      const r = RECIPES[id];
      expect(r.layers.length, id).toBeGreaterThan(0);
      expect(r.layers.length, id).toBeLessThanOrEqual(24);
      expect(r.verb, id).toBeGreaterThanOrEqual(0);
      expect(r.verb, id).toBeLessThanOrEqual(1);
      expect(r.pitchVar, id).toBeGreaterThanOrEqual(0);
      expect(r.pitchVar, id).toBeLessThanOrEqual(0.2);
      expect(r.peakDb, id).toBeLessThanOrEqual(-6);
      expect(r.minInterval, id).toBeGreaterThanOrEqual(0);
      for (const l of r.layers) {
        for (const v of [l.at, l.dur, l.a, l.d, l.s, l.r, l.gain, l.freq]) expect(Number.isFinite(v), id).toBe(true);
        expect(l.at, id).toBeGreaterThanOrEqual(0);
        expect(l.gain, id).toBeGreaterThan(0);
        expect(l.s, id).toBeGreaterThanOrEqual(0);
        expect(l.s, id).toBeLessThanOrEqual(1);
        expect(l.freq, id).toBeGreaterThan(20);
        expect(l.freq, id).toBeLessThan(12000);
        if (l.freqEnd !== undefined) expect(l.freqEnd, id).toBeGreaterThan(20);
      }
    }
  });

  it('lengths are close to the declared expectation; UI cues stay short', () => {
    for (const id of SFX_IDS) {
      const d = recipeDuration(RECIPES[id]);
      expect(d, id).toBeGreaterThanOrEqual(RECIPES[id].expectDur * 0.6);
      expect(d, id).toBeLessThanOrEqual(RECIPES[id].expectDur * 2.2);
    }
    for (const id of UI) expect(recipeDuration(RECIPES[id])).toBeLessThan(0.5);
  });

  it('loudness targets respect the hierarchy', () => {
    const t = (id: SfxId) => RECIPES[id].peakDb;
    const loudest = Math.max(t('crit'), t('victory'), t('levelUp'));
    for (const id of UI) expect(t(id)).toBeLessThanOrEqual(-20);
    for (const id of SFX_IDS) expect(t(id)).toBeLessThanOrEqual(loudest);
  });

  it('calibration only names real ids and stays in a sane range', () => {
    for (const [id, g] of Object.entries(CAL)) {
      expect(SFX_IDS).toContain(id);
      expect(g).toBeGreaterThan(0.05);
      expect(g).toBeLessThan(4);
    }
  });
});

describe('spell and companion cues', () => {
  const NEW: SfxId[] = [
    'spellCast', 'fireHit', 'coldHit', 'lightningHit', 'forceHit', 'acidHit', 'radiantHit', 'necroticHit', 'poisonHit', 'thunderHit',
    'healSpell', 'shield', 'concentrationStart', 'concentrationBreak', 'teleport', 'companionDown', 'companionUp', 'sneakAttack', 'stanceChange',
  ];
  it('exist, stay below -9 dBFS and are short', () => {
    for (const id of NEW) {
      expect(SFX_IDS, id).toContain(id);
      expect(RECIPES[id].peakDb, id).toBeLessThanOrEqual(-9);
      expect(recipeDuration(RECIPES[id]), id).toBeLessThan(1.2);
    }
  });
  it('damage-type hits are distinct recipes', () => {
    const hits = NEW.filter((i) => i.endsWith('Hit')).map((i) => JSON.stringify(RECIPES[i].layers));
    expect(new Set(hits).size).toBe(hits.length);
  });
  it('stanceChange is quieter than uiClick-level cues', () => {
    expect(RECIPES.stanceChange.peakDb).toBeLessThanOrEqual(RECIPES.uiClick.peakDb);
  });
});

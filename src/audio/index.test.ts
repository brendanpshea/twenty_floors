import { describe, expect, it } from 'vitest';
import { THEMES } from './ambience';
import { createAudio, SFX_IDS } from './index';

const mem = () => {
  const m = new Map<string, string>();
  return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
};

describe('themes', () => {
  it('lists every theme including the original themes', () => {
    expect([...THEMES]).toEqual(['warrens', 'crypt', 'depths', 'sewers', 'fungal', 'hold', 'library', 'foundry', 'ice']);
  });
});

describe('createAudio without AudioContext', () => {
  it('is a silent no-op and never throws', () => {
    const a = createAudio();
    expect(() => {
      a.play('uiClick');
      a.unlock();
      a.unlock();
      for (const id of SFX_IDS) a.play(id, { volume: 0.5, pan: -2, pitch: NaN, delay: 1 });
      for (const t of THEMES) a.setAmbience(t);
      a.setAmbience(null);
      a.setCombat(true);
      a.setVolume(NaN);
      a.dispose();
      a.dispose();
      a.play('crit');
    }).not.toThrow();
  });

  it('persists mute and volume through storage', () => {
    const s = mem();
    const a = createAudio({ storage: s });
    expect(a.isMuted()).toBe(false);
    a.setMuted(true);
    a.setVolume(0.3);
    expect(s.m.get('tf-audio-muted')).toBe('1');
    expect(s.m.get('tf-audio-volume')).toBe('0.3');
    expect(createAudio({ storage: s }).isMuted()).toBe(true);
  });

  it('survives storage that throws', () => {
    const bad = {
      get: (): string | null => {
        throw new Error('x');
      },
      set: (): void => {
        throw new Error('x');
      },
    };
    const a = createAudio({ storage: bad });
    expect(() => {
      a.setMuted(true);
      a.setVolume(0.2);
    }).not.toThrow();
    expect(a.isMuted()).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { CharacterBuild, GameEvent, MonsterDef } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { buildFromPreset, createCharacter } from './character';
import { FIGHTER } from './classes';
import { simulateOne } from './sim';

/** Real items and real monsters: whole fights through the scripted hero policy. */

const mon = (id: string): MonsterDef => MONSTERS.find((m) => m.id === id) as MonsterDef;
const pack = (): MonsterDef[] => [mon('goblin_warrior'), mon('goblin_warrior'), mon('goblin_boss')];
const bg = (id: string, preset = 'defender', featChoices: Record<string, string> = {}): CharacterBuild =>
  buildFromPreset(FIGHTER.presets.find((p) => p.id === preset) as (typeof FIGHTER.presets)[number], id, { featChoices });

const names = (events: GameEvent[], type: 'attackRoll' | 'actionUsed'): string[] =>
  events.flatMap((e) => (e.type === 'attackRoll' && type === 'attackRoll' && e.attackerId === 'player' ? [e.actionName] : e.type === 'actionUsed' && type === 'actionUsed' && e.creatureId === 'player' ? [e.name] : []));

describe('full fights with a spellcaster', () => {
  it('are deterministic: the same seed gives the identical event list, another seed does not', () => {
    for (const background of ['sage', 'acolyte']) {
      const pc = createCharacter(bg(background));
      const a = simulateOne(pc, pack(), 31);
      const b = simulateOne(pc, pack(), 31);
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
      expect(JSON.stringify(simulateOne(pc, pack(), 32).events)).not.toBe(JSON.stringify(a.events));
    }
  });

  it('use their spells: cantrips at range, and the once-per-long-rest spell at most once', () => {
    const sage = createCharacter(bg('sage'));
    const used = new Set<string>();
    let castsOfMissile = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateOne(sage, pack(), seed, { startDistance: 10 });
      const actions = names(r.events, 'actionUsed');
      for (const n of actions) used.add(n);
      castsOfMissile += actions.filter((n) => n === 'Magic Missile').length;
      expect(actions.filter((n) => n === 'Magic Missile').length).toBeLessThanOrEqual(1);
    }
    expect(['Chill Touch', 'Acid Splash', 'Fire Bolt', 'Ray of Frost', 'Poison Spray', 'Shocking Grasp', 'True Strike'].some((n) => used.has(n))).toBe(true);
    expect(castsOfMissile).toBeGreaterThan(0);
    const acolyte = createCharacter(bg('acolyte'));
    const cleric = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) for (const n of names(simulateOne(acolyte, pack(), seed, { startDistance: 10 }).events, 'actionUsed')) cleric.add(n);
    expect(cleric.has('Sacred Flame') || cleric.has('Guiding Bolt')).toBe(true);
  }, 60_000);

  it('always terminate for every preset and background', () => {
    for (const preset of FIGHTER.presets) {
      for (const background of ['soldier', 'criminal', 'sage', 'acolyte']) {
        const pc = createCharacter(bg(background, preset.id));
        for (let seed = 1; seed <= 3; seed++) {
          const r = simulateOne(pc, pack(), seed);
          expect(r.timedOut, `${preset.id} ${background} seed ${seed}`).toBe(false);
          expect(r.events.at(-1)?.type).toBe('combatEnd');
        }
      }
    }
  }, 60_000);
});

describe('spell policy', () => {
  it('opens a multi-monster fight with Bless while the enemies are still far away', () => {
    const pc = createCharacter(bg('acolyte', 'defender', { mi_spell: 'bless' }));
    const first = names(simulateOne(pc, pack(), 4, { startDistance: 10 }).events, 'actionUsed')[0];
    expect(first).toBe('Bless');
  });

  it('casts an area spell when two or more enemies are caught in it', () => {
    const pc = createCharacter(bg('sage', 'defender', { mi_spell: 'burning_hands' }));
    const used = names(simulateOne(pc, pack(), 4, { startDistance: 3 }).events, 'actionUsed');
    expect(used).toContain('Burning Hands');
  });

  it('heals when hurt: a spell or Second Wind before the hero would otherwise fall', () => {
    const pc = { ...createCharacter(bg('acolyte', 'defender', { mi_spell: 'healing_word' })), hp: 4 };
    const used = names(simulateOne(pc, pack(), 4, { startDistance: 3 }).events, 'actionUsed');
    expect(used.some((n) => n === 'Healing Word' || n === 'Second Wind')).toBe(true);
  });
});

describe('the Archer policy', () => {
  it('shoots while enemies approach, then fights with the blades, main hand before off hand', () => {
    const pc = createCharacter(bg('soldier', 'archer'));
    const attacks = new Set<string>();
    let sequenceOk = true;
    let openedWithBow = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulateOne(pc, [mon('wolf'), mon('wolf'), mon('zombie')], seed, { startDistance: 9 });
      const seq = names(r.events, 'attackRoll');
      for (const n of seq) attacks.add(n);
      // Fast wolves sometimes arrive before the hero acts; otherwise the hero opens with the bow.
      if (seq[0] === 'Longbow') openedWithBow++;
      // An off-hand attack always follows a main-hand attack, never opens a turn sequence.
      seq.forEach((n, i) => {
        if (n === 'Off-hand: Scimitar' && !seq.slice(0, i).includes('Shortsword')) sequenceOk = false;
      });
    }
    expect(sequenceOk).toBe(true);
    expect(openedWithBow).toBeGreaterThan(5);
    expect(attacks.has('Longbow')).toBe(true);
    expect(attacks.has('Shortsword')).toBe(true);
    expect(attacks.has('Off-hand: Scimitar')).toBe(true);
  });

  it('uses Second Wind with the bonus action Nick leaves free', () => {
    const pc = createCharacter(bg('soldier', 'archer'));
    let both = false;
    for (let seed = 1; seed <= 60 && !both; seed++) {
      const r = simulateOne(pc, [mon('wolf'), mon('wolf'), mon('zombie'), mon('giant_rat')], seed, { startDistance: 9 });
      both = names(r.events, 'actionUsed').includes('Second Wind') && names(r.events, 'attackRoll').includes('Off-hand: Scimitar');
    }
    expect(both).toBe(true);
  });
});

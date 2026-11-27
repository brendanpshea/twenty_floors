import { describe, expect, it } from 'vitest';
import { computeAc } from './character';
import { compareItem, typicalAc } from './compare';
import { presetHero, withItems } from './testing/heroes';

const line = (r: ReturnType<typeof compareItem>, label: string) => r?.changes.find((c) => c.label === label);

describe('compareItem', () => {
  it('returns null for consumables and unknown items', () => {
    const pc = presetHero('defender');
    expect(compareItem(pc, 'potion_healing')).toBeNull();
    expect(compareItem(pc, 'no_such_item')).toBeNull();
  });

  it('Defender and a greataxe: a trade-off that puts the shield away', () => {
    const r = compareItem(presetHero('defender'), 'greataxe')!;
    expect(r.verdict).toBe('tradeoff');
    expect(r.replaces).toEqual(['Shield']);
    expect(r.summary).toBe('+2.0 damage per hit, −2 AC (no shield)');
    expect(line(r, 'Armor Class')).toEqual({ label: 'Armor Class', from: '19', to: '17', better: false });
    expect(line(r, 'Damage')).toEqual({ label: 'Damage', from: '1d8+3 (7.5)', to: '1d12+3 (9.5)', better: true });
    // The weapon mastery is only credited when the hero has trained with it.
    expect(line(r, 'Mastery')).toEqual({ label: 'Mastery', from: 'Sap', to: 'Cleave (not mastered)', better: false });
  });

  it('Defender and plate armor: an upgrade', () => {
    const r = compareItem(presetHero('defender'), 'plate')!;
    expect(r.verdict).toBe('upgrade');
    expect(r.summary).toBe('+2 AC');
    expect(r.replaces).toEqual([]);
    expect(line(r, 'Armor Class')).toMatchObject({ from: '19', to: '21', better: true });
  });

  it('Defender and a +1 longsword: an upgrade in hit bonus and damage', () => {
    const r = compareItem(presetHero('defender'), 'longsword_plus1')!;
    expect(r.verdict).toBe('upgrade');
    expect(line(r, 'Hit bonus')).toMatchObject({ from: '+5', to: '+6', better: true });
    expect(line(r, 'Damage')).toMatchObject({ from: '1d8+3 (7.5)', to: '1d8+4 (8.5)', better: true });
    expect(r.summary).toBe('+1 to hit, +1.0 damage per hit');
  });

  it('Defender and a longbow: unsuitable, because a Strength build shoots worse than it throws javelins', () => {
    const r = compareItem(presetHero('defender'), 'longbow')!;
    expect(r.verdict).toBe('unsuitable');
    expect(r.summary).toMatch(/Dexterity/);
    expect(r.summary).toMatch(/thrown javelin/i);
    // It would be an addition to the ranged slot; the lines say so.
    expect(line(r, 'Ranged Damage')?.from).toBe('—');
  });

  it('an item that is already equipped, or sits spare in the pack, is owned', () => {
    const pc = presetHero('defender');
    expect(compareItem(pc, 'longsword')).toMatchObject({ verdict: 'owned', changes: [], replaces: [] });
    expect(compareItem(withItems(pc, 'greataxe'), 'greataxe')!.verdict).toBe('owned');
  });

  it('armor with an unmet Strength requirement is unsuitable and shows the speed it would cost', () => {
    const r = compareItem(presetHero('archer'), 'plate')!;
    expect(r.verdict).toBe('unsuitable');
    expect(r.summary).toMatch(/^Needs Strength 15/);
    expect(line(r, 'Speed')).toMatchObject({ from: '30 ft', to: '20 ft', better: false });
  });

  it('armor that lowers Armor Class is unsuitable; equal Armor Class is a sidegrade', () => {
    const archer = presetHero('archer');
    expect(compareItem(archer, 'leather')).toMatchObject({ verdict: 'unsuitable' });
    expect(compareItem(archer, 'chain_mail')).toMatchObject({ verdict: 'sidegrade' });
  });

  it('Archer and half plate: +1 AC upgrade; heavy crossbow: more damage, shorter range', () => {
    const archer = presetHero('archer');
    const plate = compareItem(archer, 'half_plate')!;
    expect(plate.verdict).toBe('upgrade');
    expect(plate.summary).toBe('+1 AC');
    const xbow = compareItem(archer, 'heavy_crossbow')!;
    expect(xbow.verdict).toBe('upgrade');
    expect(line(xbow, 'Ranged Damage')).toMatchObject({ from: '1d8+3 (7.5)', to: '1d10+3 (8.5)', better: true });
    expect(line(xbow, 'Ranged Range')).toMatchObject({ from: '150 ft', to: '100 ft', better: false });
    expect(xbow.summary).toBe('+1.0 damage per hit');
  });

  it('Loading counts: with Extra Attack a crossbow loses a shot a round to the longbow', () => {
    const r = compareItem(presetHero('archer', 5), 'heavy_crossbow')!;
    expect(r.verdict).toBe('downgrade');
    const round = line(r, 'Ranged damage per round')!;
    expect(parseFloat(round.to)).toBeLessThan(parseFloat(round.from));
  });

  it('a second Light weapon is an off-hand addition with per-round numbers', () => {
    const base = presetHero('archer');
    // Archer already wields shortsword + scimitar; take away the off hand to test the addition.
    const pc = { ...base, equipped: { ...base.equipped } };
    delete pc.equipped.offHand;
    const r = compareItem(pc, 'scimitar')!;
    // The scimitar is still in the pack, so it is owned; with a dagger it is an addition.
    expect(r.verdict).toBe('owned');
    const d = compareItem(pc, 'dagger')!;
    expect(d.verdict).toBe('upgrade');
    expect(d.summary).toMatch(/^Adds an off-hand attack: \+2\.5 damage per round/);
    expect(line(d, 'Off-hand attack')).toMatchObject({ from: '—', better: true });
    expect(line(d, 'Damage per round')?.better).toBe(true);
  });

  it('Great Weapon Fighting and Extra Attack show in damage per round', () => {
    const gw = presetHero('great_weapon', 5);
    const r = compareItem(gw, 'longsword')!;
    expect(r.verdict).toBe('downgrade');
    expect(line(r, 'Damage')).toMatchObject({ from: '2d6+4 (12.0)', to: '1d10+4 (9.8)' });
    expect(line(r, 'Damage per round')).toBeDefined();
  });

  it('a shield that replaces a two-handed weapon names it', () => {
    const r = compareItem(presetHero('great_weapon'), 'shield')!;
    expect(r.replaces).toEqual(['Greatsword']);
    expect(r.verdict).toBe('tradeoff');
  });

  it('the typical enemy AC rises with level', () => {
    expect([1, 5, 10, 15, 20].map(typicalAc)).toEqual([13, 14, 15, 16, 17]);
  });

  it('is deterministic and does not touch the hero', () => {
    const pc = presetHero('defender', 3);
    const snapshot = JSON.stringify(pc);
    const a = compareItem(pc, 'greataxe');
    const b = compareItem(pc, 'greataxe');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(pc)).toBe(snapshot);
    expect(computeAc(pc)).toBe(19);
  });
});

import type { ActionDef, CombatApi, Command, Creature, GridPos } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { damageAgainst } from './ai';
import { averageDice } from './dice';
import { concentratingOn, isSpellAction } from './spells';
import { areHostile, chebyshev, isAlive } from './util';

/**
 * The scripted hero's use of spells (Magic Initiate): ranged cantrips while closing or when they beat the
 * weapon, True Strike when it beats the normal attack, and the once-per-long-rest level 1 spell where it
 * matters (a boss or a group, a wounded enemy, a hurt hero). Returns null to let the weapon logic act.
 * Used by `playerPolicy` (sim.ts); the generic AI never casts.
 */

const BUFF_ROUND_LIMIT = 2;

function avg(a: ActionDef): number {
  return (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
}

/** Expected damage of an action on a target: attacks by hit chance, saves by fail chance (plus half on a success). */
function expected(combat: CombatApi, a: ActionDef, t: Creature): number {
  const id = a.id;
  if (a.effects?.includes('magicMissile')) return 3 * damageAgainst(a, t);
  const chance = combat.hitChance(id, t.id);
  let v = damageAgainst(a, t);
  if (a.effects?.includes('chromaticOrbChoice')) v = 13.5;
  if (a.attack) v *= chance ?? 0.5;
  else if (a.save) v *= (chance ?? 0.5) + (a.save.halfOnSave ? (1 - (chance ?? 0.5)) * 0.5 : 0);
  if (a.effects?.includes('iceKnifeBurst')) v += 7 * 0.5;
  if (a.effects?.includes('guidingBoltAdvantage')) v += 3;
  if (a.applies) v += 2 * (chance ?? 1);
  return v;
}

function cmd(a: ActionDef, extra: { targetId?: string; point?: GridPos } = {}): Command {
  const c: Command = { type: 'action', actionId: a.id };
  if (extra.targetId !== undefined) c.targetId = extra.targetId;
  if (extra.point !== undefined) c.point = extra.point;
  return c;
}

const isWeapon = (a: ActionDef): boolean => !!a.attack && !isSpellAction(a) && a.cost === 'action' && !a.effects?.includes('offhand');

/** True when a friendly creature other than the caster (the companion) stands in the area. */
function friendInside(combat: CombatApi, caster: Creature, cells: GridPos[]): boolean {
  return combat.creatures().some((o) => o !== caster && isAlive(o) && !areHostile(caster, o) && cells.some((q) => q.x === o.pos.x && q.y === o.pos.y));
}

/**
 * Spells granted by items (wands, staffs): charges are spent more freely than once-per-rest spells. Area spells when two or more
 * enemies are caught and no ally is; single-target attack spells when they beat the weapon (a one-charge item is kept for a boss, a
 * group or a hurt hero); a healing staff like a potion when hurt; control (web, hold) on the boss. Null lets the weapon logic act.
 */
function itemSpellCommand(combat: CombatApi, c: Creature): Command | null {
  const spells = c.actions.filter((a) => a.id.startsWith('itemspell_') && a.cost === 'action' && combat.canUse(a.id).ok);
  if (spells.length === 0 || combat.turn.actionUsed) return null;
  const hostiles = combat.creatures().filter((o) => isAlive(o) && areHostile(c, o));
  if (hostiles.length === 0) return null;
  const bosses = hostiles.filter((h) => h.level >= 1 || MONSTERS.find((m) => m.id === h.defId)?.role === 'boss');
  const important = hostiles.length >= 2 || bosses.length > 0;
  const hurt = c.hp <= c.maxHp * 0.5;
  // Weapon baseline: the best attack available this turn.
  let baseline = 0;
  for (const w of c.actions.filter(isWeapon)) {
    if (!combat.canUse(w.id).ok) continue;
    for (const id of combat.validTargets(w.id)) baseline = Math.max(baseline, expected(combat, w, combat.creature(id) as Creature));
  }
  type Pick = { a: ActionDef; t?: Creature; point?: GridPos; score: number };
  let best: Pick | undefined;
  const consider = (p: Pick): void => {
    if (!best || p.score > best.score) best = p;
  };
  for (const a of spells) {
    const left = c.resources[a.uses?.resource ?? '']?.current ?? 0;
    const plenty = left >= 2;
    const fx = a.effects ?? [];
    if (a.heal) {
      const missing = c.maxHp - c.hp;
      if (hurt && missing >= averageDice(a.heal) * 0.7 && (a.targeting.kind === 'self' || a.targeting.kind === 'point' || a.targeting.kind === 'creature')) {
        consider({ a, ...(a.targeting.kind === 'creature' ? { t: c } : {}), score: 1000 + missing });
      }
      continue;
    }
    const control = a.applies !== undefined || fx.includes('web') || a.id.endsWith('_web') || a.id.endsWith('_hold_person') || a.id.endsWith('_wall_of_fire');
    if (a.targeting.kind === 'point') {
      const range0 = a.targeting.range === 0;
      const centers: GridPos[] = range0 && a.targeting.area.shape === 'sphere' ? [c.pos] : hostiles.map((h) => h.pos);
      for (const p of centers) {
        if (!range0 && chebyshev(c.pos, p) > a.targeting.range) continue;
        const cells = combat.areaCells(a.id, p);
        if (friendInside(combat, c, cells) || cells.some((q) => q.x === c.pos.x && q.y === c.pos.y)) continue;
        const inside = hostiles.filter((h) => cells.some((q) => q.x === h.pos.x && q.y === h.pos.y));
        if (control && !a.damage) {
          const hasBoss = inside.some((h) => bosses.includes(h));
          if (hasBoss && combat.round <= 3) consider({ a, point: p, score: 50 + inside.length });
          continue;
        }
        if (inside.length < 2 && !(bosses.length > 0 && inside.length === 1 && (plenty || hurt))) continue;
        const score = inside.reduce((s, h) => s + expected(combat, a, h), 0);
        if (score > baseline * 1.1) consider({ a, point: p, score });
      }
    } else if (a.targeting.kind === 'creature' && !a.targeting.friendly) {
      for (const id of combat.validTargets(a.id)) {
        const t = combat.creature(id) as Creature;
        if (control && !a.damage) {
          if (bosses.includes(t) && combat.round <= 3 && (combat.hitChance(a.id, id) ?? 0) >= 0.4) consider({ a, t, score: 50 });
          continue;
        }
        if (!a.attack && !a.save && !fx.includes('magicMissile')) continue;
        const score = expected(combat, a, t) + (bosses.includes(t) ? 3 : 0);
        if (!plenty && !(important || hurt)) continue;
        if (score > baseline * 1.1) consider({ a, t, score });
      }
    }
  }
  if (!best) return null;
  const pick = best as Pick;
  if (pick.t) return cmd(pick.a, { targetId: pick.t.id });
  if (pick.point) return cmd(pick.a, { point: pick.point });
  return cmd(pick.a);
}

export function spellCommand(combat: CombatApi, c: Creature): Command | null {
  const viaItem = itemSpellCommand(combat, c);
  if (viaItem) return viaItem;
  const spells = c.actions.filter((a) => isSpellAction(a) && !a.id.startsWith('itemspell_'));
  if (spells.length === 0) return null;
  const turn = combat.turn;
  const hostiles = combat.creatures().filter((o) => isAlive(o) && areHostile(c, o));
  if (hostiles.length === 0) return null;
  const adjacent = hostiles.some((h) => chebyshev(c.pos, h.pos) <= 1);
  const nearest = Math.min(...hostiles.map((h) => chebyshev(c.pos, h.pos)));
  const important = hostiles.length >= 2 || hostiles.some((h) => h.level >= 1);
  const concentrating = concentratingOn(c) !== null;
  const usable = (a: ActionDef): boolean => combat.canUse(a.id).ok;
  const find = (id: string): ActionDef | undefined => {
    const a = spells.find((x) => x.id === `spell_${id}`);
    return a && usable(a) ? a : undefined;
  };
  const hurt = c.hp <= c.maxHp * 0.5;

  // Bonus-action spells ride along with the action.
  if (!turn.bonusUsed && !concentrating && important && combat.round <= BUFF_ROUND_LIMIT) {
    const sof = find('shield_of_faith');
    if (sof) return cmd(sof, { targetId: c.id });
  }
  if (turn.actionUsed) return null;

  // Weapon baseline: the best weapon attack this turn (including the off-hand attack that follows a Light main-hand attack).
  const weapons = c.actions.filter(isWeapon);
  const offhand = c.actions.find((a) => a.effects?.includes('offhand'));
  let baseline = 0;
  let weaponNow = false;
  for (const w of weapons) {
    if (!usable(w)) continue;
    for (const id of combat.validTargets(w.id)) {
      const t = combat.creature(id);
      if (!t) continue;
      weaponNow = true;
      let v = expected(combat, w, t);
      if (offhand && w.effects?.includes('lightAttack')) v += expected(combat, offhand, t);
      baseline = Math.max(baseline, v);
    }
  }
  const melee = weapons.find((w) => w.targeting.kind === 'creature' && w.targeting.melee);
  const meleeAvg = melee ? avg(melee) + (offhand ? avg(offhand) : 0) : 0;
  const canClose = !!melee && nearest - 1 <= turn.movementLeft;
  if (!weaponNow) baseline = canClose ? meleeAvg * 0.6 : 0;

  // Free-action opening: a turn spent walking anyway.
  const freeTurn = !weaponNow && !canClose;

  type Pick = { a: ActionDef; t?: Creature; point?: GridPos; score: number };
  let best: Pick | undefined;
  const consider = (p: Pick): void => {
    if (!best || p.score > best.score) best = p;
  };

  for (const a of spells) {
    if (!usable(a) || a.cost !== 'action') continue;
    const id = a.id.slice('spell_'.length);
    const lvl1 = a.uses !== undefined;
    const fx = a.effects ?? [];
    if (a.targeting.kind === 'creature' && !a.targeting.friendly && (a.attack || a.save || fx.includes('magicMissile'))) {
      const targets = combat.validTargets(a.id).map((x) => combat.creature(x) as Creature);
      for (const t of targets) {
        if (fx.includes('bane') || fx.includes('command')) continue;
        let score = expected(combat, a, t);
        if (!lvl1) {
          // At-will cantrip or True Strike: use it when it beats the weapon, or while closing.
          if (freeTurn || score > baseline * 1.1) consider({ a, t, score: score + (score >= t.hp ? 5 : 0) });
          continue;
        }
        // Once per long rest: keep it for a boss, a group, or a hurt hero.
        if (!(important || hurt)) continue;
        if (fx.includes('magicMissile')) {
          const finishing = t.hp <= 10.5;
          const armored = t.ac >= 17;
          if (!(finishing || armored || freeTurn)) continue;
          score += finishing ? 6 : 2;
        } else {
          if (combat.round > 3 && !hurt) continue;
          score += t.level >= 1 ? 4 : 0;
        }
        if (score > baseline * 1.15) consider({ a, t, score });
      }
    } else if (a.targeting.kind === 'point' && a.damage && lvl1) {
      if (!important) continue;
      const area = a.targeting.area;
      const range0 = a.targeting.range === 0;
      const centers: GridPos[] = range0 && area.shape === 'sphere' ? [c.pos] : hostiles.map((h) => h.pos);
      for (const p of centers) {
        if (!range0 && chebyshev(c.pos, p) > a.targeting.range) continue;
        const cells = combat.areaCells(a.id, p);
        if (friendInside(combat, c, cells)) continue;
        const inside = hostiles.filter((h) => cells.some((q) => q.x === h.pos.x && q.y === h.pos.y));
        if (inside.length < 2) continue;
        const score = inside.reduce((s, h) => s + expected(combat, a, h), 0);
        if (score > baseline * 1.1) consider({ a, point: p, score });
      }
    } else if (id === 'sleep') {
      if (!important || concentrating) continue;
      const area = a.targeting.kind === 'point' ? a.targeting : undefined;
      if (!area) continue;
      for (const h of hostiles) {
        if (chebyshev(c.pos, h.pos) > area.range) continue;
        const cells = combat.areaCells(a.id, h.pos);
        if (cells.some((q) => q.x === c.pos.x && q.y === c.pos.y) || friendInside(combat, c, cells)) continue;
        const inside = hostiles.filter((o) => cells.some((q) => q.x === o.pos.x && q.y === o.pos.y));
        if (inside.length < 2) continue;
        const score = inside.reduce((s, o) => s + (combat.hitChance(a.id, o.id) ?? 0.5) * 8, 0);
        if (score > baseline) consider({ a, point: h.pos, score });
      }
    } else if (id === 'bless') {
      if (important && !concentrating && combat.round <= BUFF_ROUND_LIMIT && (freeTurn || !adjacent)) consider({ a, t: c, score: Infinity });
    } else if (id === 'bane') {
      const strongest = [...hostiles].sort((x, y) => y.level - x.level || y.hp - x.hp)[0];
      if (!important || concentrating || !strongest || combat.round > BUFF_ROUND_LIMIT) continue;
      if (combat.validTargets(a.id).includes(strongest.id) && (combat.hitChance(a.id, strongest.id) ?? 0) >= 0.4 && (freeTurn || !adjacent)) {
        consider({ a, t: strongest, score: Infinity });
      }
    } else if (id === 'command') {
      const boss = [...hostiles].filter((h) => h.level >= 1 && chebyshev(c.pos, h.pos) <= 1).sort((x, y) => y.level - x.level)[0];
      if (boss && combat.validTargets(a.id).includes(boss.id) && (combat.hitChance(a.id, boss.id) ?? 0) >= 0.5) consider({ a, t: boss, score: Infinity });
    } else if (id === 'false_life') {
      if (important && freeTurn && combat.round <= BUFF_ROUND_LIMIT) consider({ a, t: c, score: Infinity });
    }
  }
  if (!best) return null;
  const pick = best as Pick;
  if (pick.t) return cmd(pick.a, { targetId: pick.t.id });
  if (pick.point) return cmd(pick.a, { point: pick.point });
  return cmd(pick.a);
}

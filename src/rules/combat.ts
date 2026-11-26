import type { Rng } from '../core/rng';
import type {
  ActionDef,
  ActiveCondition,
  Ability,
  AttackOutcome,
  Command,
  CombatApi,
  Condition,
  Creature,
  DamageType,
  Faction,
  GameEvent,
  GridPos,
  NavGrid,
  ReachableCell,
  TurnState,
} from '../core/types';
import {
  attackModeFromConditions,
  autoFailsSave,
  d20Probability,
  effectiveSpeed,
  hasCondition,
  isIncapacitated,
  makeCondition,
  mergeMode,
  saveMode,
  singleHitProbability,
  singleSaveProbability,
  type RollMode,
} from './conditions';
import { averageDice, rollDice } from './dice';
import { abilityMod, areHostile, chebyshev, hasFlag, isAlive, isFriendlySide } from './util';

/**
 * HOUSE RULE: a ranged attacker standing at least `minSteps` elevation steps
 * above its target gets `bonus` to hit. This is the one place the rule lives.
 */
export const ELEVATION_ATTACK_BONUS = { minSteps: 2, bonus: 1 } as const;

export function elevationAttackBonus(nav: NavGrid, attacker: GridPos, target: GridPos): number {
  const diff = nav.elevationAt(attacker) - nav.elevationAt(target);
  return diff >= ELEVATION_ATTACK_BONUS.minSteps ? ELEVATION_ATTACK_BONUS.bonus : 0;
}

/** HOUSE RULE: escaping an indefinite restraint is an action: STR check against this DC. */
export const BREAK_FREE_DC = 12;
export const BREAK_FREE_ID = 'break_free';

const MAX_SKIPPED_TURNS = 100;
/** Weapon Mastery: Slow takes 10 ft (2 cells) off the target's speed. */
const SLOW_CELLS = 2;

function breakFreeAction(): ActionDef {
  return {
    id: BREAK_FREE_ID,
    name: 'Break Free',
    description: `Use your action to struggle free: Strength check against DC ${BREAK_FREE_DC}.`,
    icon: 'special',
    cost: 'action',
    targeting: { kind: 'self' },
    effects: ['breakFree'],
  };
}

function canBreakFree(c: Creature): boolean {
  return c.conditions.some((x) => x.condition === 'restrained' && x.rounds === null);
}

/** The creature's action with this id, including the generated Break Free while it is restrained. */
export function findAction(c: Creature, id: string): ActionDef | undefined {
  const own = c.actions.find((a) => a.id === id);
  if (own) return own;
  if (id === BREAK_FREE_ID && canBreakFree(c)) return breakFreeAction();
  return undefined;
}

export function actionCost(c: Creature, a: ActionDef): ActionDef['cost'] {
  if (a.id === 'disengage' && c.traits.includes('nimbleEscape')) return 'bonus';
  return a.cost;
}

/**
 * Cells covered by an area. Sphere: all cells within the radius (Euclidean)
 * with sight to the origin. Cone and line are approximations along the vector
 * from the caster toward the point. Walkable cells only.
 */
export function computeAreaCells(
  nav: NavGrid,
  caster: GridPos,
  point: GridPos,
  range: number,
  area: { shape: 'sphere' | 'cone' | 'line'; size: number },
): GridPos[] {
  const out: GridPos[] = [];
  const size = area.size;
  if (area.shape === 'sphere') {
    const origin = range === 0 ? caster : point;
    for (let y = origin.y - size; y <= origin.y + size; y++) {
      for (let x = origin.x - size; x <= origin.x + size; x++) {
        const p = { x, y };
        if (!nav.inBounds(p) || !nav.isWalkable(p)) continue;
        const dx = x - origin.x;
        const dy = y - origin.y;
        if (dx * dx + dy * dy > (size + 0.5) * (size + 0.5)) continue;
        if (!(x === origin.x && y === origin.y) && !nav.hasLineOfSight(origin, p)) continue;
        out.push(p);
      }
    }
    return out;
  }
  let dx = point.x - caster.x;
  let dy = point.y - caster.y;
  if (dx === 0 && dy === 0) return out;
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  for (let y = caster.y - size; y <= caster.y + size; y++) {
    for (let x = caster.x - size; x <= caster.x + size; x++) {
      const p = { x, y };
      if (x === caster.x && y === caster.y) continue;
      if (!nav.inBounds(p) || !nav.isWalkable(p)) continue;
      const rx = x - caster.x;
      const ry = y - caster.y;
      const along = rx * dx + ry * dy;
      const lateral = Math.abs(rx * -dy + ry * dx);
      if (along <= 0.3 || along > size + 0.5) continue;
      const inside = area.shape === 'cone' ? lateral <= along / 2 + 0.35 : lateral < 0.75;
      if (!inside) continue;
      if (!nav.hasLineOfSight(caster, p)) continue;
      out.push(p);
    }
  }
  return out;
}

interface AttackSetup {
  bonus: number;
  mode: RollMode;
  critMin: number;
}

export function createCombat(creatures: Creature[], nav: NavGrid, rng: Rng): CombatApi {
  const all = creatures;
  const byId = new Map<string, Creature>();
  for (const c of all) byId.set(c.id, c);

  const order: string[] = [];
  let round = 0;
  let idx = 0;
  let began = false;
  let over = false;
  let winner: Faction | null = null;
  const turn: TurnState = { creatureId: '', movementLeft: 0, actionUsed: false, bonusUsed: false };
  const reactionUsed = new Set<string>();
  const spentRecharge = new Map<string, Set<string>>();
  const slowed = new Map<string, { by: string; cells: number }>();
  /** Weapon Mastery Vex: attacker id -> target it has advantage against, and attacker turn-ends left. */
  const vexed = new Map<string, { targetId: string; turnEnds: number }>();
  const speedOf = (c: Creature): number => Math.max(0, effectiveSpeed(c) - (slowed.get(c.id)?.cells ?? 0));
  let events: GameEvent[] = [];

  const emit = (e: GameEvent): void => {
    events.push(e);
  };
  const log = (text: string): void => emit({ type: 'log', text });

  const active = (): Creature => byId.get(turn.creatureId) as Creature;
  const occupiedBy = (p: GridPos, exceptId?: string): Creature | undefined =>
    all.find((c) => isAlive(c) && c.id !== exceptId && c.pos.x === p.x && c.pos.y === p.y);

  // ------------------------------------------------------------------ rolls

  function rollD20(mode: RollMode): { d20: number; dice: number[] } {
    const a = rng.die(20);
    if (mode === 'normal') return { d20: a, dice: [a] };
    const b = rng.die(20);
    return { d20: mode === 'advantage' ? Math.max(a, b) : Math.min(a, b), dice: [a, b] };
  }

  function hostileAdjacent(c: Creature): boolean {
    return all.some((o) => isAlive(o) && areHostile(c, o) && !isIncapacitated(o) && chebyshev(c.pos, o.pos) <= 1);
  }

  function packTacticsActive(att: Creature, tgt: Creature): boolean {
    if (!att.traits.includes('packTactics')) return false;
    return all.some(
      (o) =>
        o !== att &&
        isAlive(o) &&
        isFriendlySide(o) === isFriendlySide(att) &&
        !isIncapacitated(o) &&
        chebyshev(o.pos, tgt.pos) <= 1,
    );
  }

  function attackSetup(att: Creature, tgt: Creature, a: ActionDef): AttackSetup {
    const t = a.targeting;
    const melee = t.kind === 'creature' && t.melee;
    const d = chebyshev(att.pos, tgt.pos);
    const cm = attackModeFromConditions(att, tgt, d <= 1);
    let adv = cm.adv;
    let dis = cm.dis;
    let bonus = a.attack?.bonus ?? 0;
    if (t.kind === 'creature' && !melee) {
      if (hostileAdjacent(att)) dis = true;
      if (t.longRange !== undefined && d > t.range) dis = true;
      bonus += elevationAttackBonus(nav, att.pos, tgt.pos);
    }
    if (packTacticsActive(att, tgt)) adv = true;
    if (vexed.get(att.id)?.targetId === tgt.id) adv = true;
    return { bonus, mode: mergeMode(adv, dis), critMin: hasFlag(att, 'crit19') ? 19 : 20 };
  }

  const canInspire = (c: Creature): boolean => (c.resources['inspiration']?.current ?? 0) > 0;

  function classify(d20: number, bonus: number, ac: number, critMin: number): AttackOutcome {
    if (d20 === 1) return 'fumble';
    if (d20 >= critMin) return 'crit';
    return d20 + bonus >= ac ? 'hit' : 'miss';
  }

  function rollAttack(att: Creature, tgt: Creature, a: ActionDef, reaction: boolean, name: string): AttackOutcome {
    const s = attackSetup(att, tgt, a);
    let r = rollD20(s.mode);
    let outcome = classify(r.d20, s.bonus, tgt.ac, s.critMin);
    if (vexed.get(att.id)?.targetId === tgt.id) vexed.delete(att.id);
    if ((outcome === 'miss' || outcome === 'fumble') && canInspire(att)) {
      (att.resources['inspiration'] as { current: number }).current -= 1;
      log(`${att.name} spends Heroic Inspiration to reroll (was ${r.d20}).`);
      r = rollD20(s.mode);
      outcome = classify(r.d20, s.bonus, tgt.ac, s.critMin);
    }
    if (
      outcome === 'hit' &&
      chebyshev(att.pos, tgt.pos) <= 1 &&
      (hasCondition(tgt, 'paralyzed') || hasCondition(tgt, 'unconscious'))
    ) {
      outcome = 'crit';
    }
    emit({
      type: 'attackRoll',
      attackerId: att.id,
      targetId: tgt.id,
      actionName: name,
      d20: r.d20,
      dice: r.dice,
      mode: s.mode,
      bonus: s.bonus,
      total: r.d20 + s.bonus,
      targetAc: tgt.ac,
      outcome,
      reaction,
    });
    return outcome;
  }

  function saveBonus(c: Creature, ability: Ability): number {
    return abilityMod(c.abilities[ability]) + (c.saveProficiencies.includes(ability) ? c.proficiencyBonus : 0);
  }

  function rollSave(c: Creature, ability: Ability, dc: number, applies?: Condition): boolean {
    const bonus = saveBonus(c, ability);
    if (autoFailsSave(c, ability)) {
      emit({ type: 'saveRoll', creatureId: c.id, ability, d20: 0, bonus, total: 0, dc, success: false });
      return false;
    }
    const r = rollD20(saveMode(c, ability, applies));
    const total = r.d20 + bonus;
    const success = total >= dc;
    emit({ type: 'saveRoll', creatureId: c.id, ability, d20: r.d20, bonus, total, dc, success });
    return success;
  }

  // ------------------------------------------------------- damage and healing

  function dealDamage(target: Creature, raw: number, type: DamageType, sourceId: string | undefined, crit: boolean): void {
    if (!isAlive(target)) return;
    let amount = raw;
    let modifier: 'none' | 'resisted' | 'vulnerable' | 'immune' = 'none';
    if (target.immunities.includes(type)) {
      amount = 0;
      modifier = 'immune';
    } else {
      if (target.resistances.includes(type)) {
        amount = Math.floor(amount / 2);
        modifier = 'resisted';
      }
      if (target.vulnerabilities.includes(type)) {
        amount *= 2;
        modifier = modifier === 'resisted' ? 'none' : 'vulnerable';
      }
    }
    let rest = amount;
    if (target.tempHp > 0) {
      const absorbed = Math.min(target.tempHp, rest);
      target.tempHp -= absorbed;
      rest -= absorbed;
    }
    target.hp = Math.max(0, target.hp - rest);
    let survived = false;
    if (target.hp === 0 && amount > 0 && target.traits.includes('undeadFortitude') && !crit && type !== 'radiant') {
      log(`${target.name}'s Undead Fortitude triggers.`);
      if (rollSave(target, 'con', 5 + amount)) {
        target.hp = 1;
        survived = true;
        log(`${target.name} refuses to fall!`);
      }
    }
    // HOUSE RULE "Last Stand": once per floor the hero drops to 1 HP instead of 0 (replaces death saves).
    let lastStand = false;
    const ls = target.resources['lastStand'];
    if (target.hp === 0 && !survived && target.faction === 'player' && ls && ls.current > 0) {
      ls.current -= 1;
      target.hp = 1;
      lastStand = true;
    }
    const e: GameEvent = { type: 'damage', targetId: target.id, amount, damageType: type, modifier, crit, hpAfter: target.hp };
    if (sourceId !== undefined) e.sourceId = sourceId;
    emit(e);
    if (lastStand) log(`Last Stand! ${target.name} clings on at 1 HP.`);
    if (target.hp === 0 && !survived) {
      target.dead = true;
      emit({ type: 'death', creatureId: target.id });
    }
  }

  function heal(target: Creature, dice: string): void {
    if (!isAlive(target)) return;
    const amount = Math.min(rollDice(rng, dice).total, target.maxHp - target.hp);
    target.hp += amount;
    emit({ type: 'heal', targetId: target.id, amount, hpAfter: target.hp });
  }

  function addCondition(target: Creature, a: NonNullable<ActionDef['applies']>, source: Creature): void {
    if (!isAlive(target) || target.conditionImmunities.includes(a.condition)) return;
    let rounds: number | null = a.rounds ?? null;
    // `rounds` counts the source's own following turns: applied during its own turn, the current one does not count.
    if (rounds !== null && source.id === turn.creatureId && source.id !== target.id) rounds += 1;
    target.conditions = target.conditions.filter((x) => x.condition !== a.condition);
    target.conditions.push(makeCondition(a.condition, rounds, source.id, a.saveEnds));
    emit({ type: 'conditionAdded', creatureId: target.id, condition: a.condition });
  }

  function removeCondition(target: Creature, cond: ActiveCondition): void {
    const i = target.conditions.indexOf(cond);
    if (i < 0) return;
    target.conditions.splice(i, 1);
    emit({ type: 'conditionRemoved', creatureId: target.id, condition: cond.condition });
  }

  function rollParts(a: ActionDef, crit: boolean): { type: DamageType; amount: number }[] {
    const minDie = a.effects?.includes('greatWeaponFighting') ? 3 : undefined;
    return (a.damage ?? []).map((p) => ({
      type: p.type,
      amount: rollDice(rng, p.dice, { crit, ...(minDie !== undefined ? { minDie } : {}) }).total,
    }));
  }

  // ------------------------------------------------------- action resolution

  /** Resolve one action against one target (not area, not multiattack). */
  function resolveOn(att: Creature, a: ActionDef, tgt: Creature, reaction = false, name: string = a.name): void {
    if (a.attack) {
      const outcome = rollAttack(att, tgt, a, reaction, name);
      if (outcome === 'miss' || outcome === 'fumble') {
        // Weapon Mastery: Graze deals the ability modifier on a miss.
        const graze = a.effects?.find((e) => e.startsWith('mastery:graze:'));
        const first = a.damage?.[0];
        if (graze && first) {
          const mod = parseInt(graze.slice('mastery:graze:'.length), 10);
          if (mod > 0) dealDamage(tgt, mod, first.type, att.id, false);
        }
        return;
      }
      const crit = outcome === 'crit';
      let dealt = 0;
      for (const part of rollParts(a, crit)) {
        dealDamage(tgt, part.amount, part.type, att.id, crit);
        dealt += part.amount;
      }
      // Weapon Mastery: Vex gives advantage on the next attack against this target until the end of the attacker's next turn.
      if (dealt > 0 && isAlive(tgt) && a.effects?.includes('mastery:vex')) {
        vexed.set(att.id, { targetId: tgt.id, turnEnds: att.id === turn.creatureId ? 2 : 1 });
      }
      // Weapon Mastery: Slow reduces the target's speed by 10 ft until the start of the attacker's next turn.
      if (dealt > 0 && isAlive(tgt) && a.effects?.includes('mastery:slow')) {
        slowed.set(tgt.id, { by: att.id, cells: Math.max(slowed.get(tgt.id)?.cells ?? 0, SLOW_CELLS) });
        log(`${tgt.name} is slowed.`);
      }
      if (a.heal) heal(tgt, a.heal);
      if (!isAlive(tgt)) return;
      if (a.save) {
        if (!rollSave(tgt, a.save.ability, a.save.dc, a.applies?.condition) && a.applies) addCondition(tgt, a.applies, att);
      } else if (a.applies) {
        addCondition(tgt, a.applies, att);
      }
      return;
    }
    if (a.save) {
      const ok = rollSave(tgt, a.save.ability, a.save.dc, a.applies?.condition);
      for (const part of rollParts(a, false)) {
        if (!ok) dealDamage(tgt, part.amount, part.type, att.id, false);
        else if (a.save.halfOnSave) dealDamage(tgt, Math.floor(part.amount / 2), part.type, att.id, false);
      }
      if (!ok && isAlive(tgt) && a.applies) addCondition(tgt, a.applies, att);
      return;
    }
    for (const part of rollParts(a, false)) dealDamage(tgt, part.amount, part.type, att.id, false);
    if (a.heal) heal(tgt, a.heal);
    if (a.applies) addCondition(tgt, a.applies, att);
  }

  function resolveArea(att: Creature, a: ActionDef, cells: GridPos[]): void {
    const centeredOnSelf = a.targeting.kind === 'point' && a.targeting.range === 0;
    const targets = all.filter(
      (o) => isAlive(o) && !(centeredOnSelf && o === att) && cells.some((p) => p.x === o.pos.x && p.y === o.pos.y),
    );
    const parts = rollParts(a, false);
    for (const t of targets) {
      const ok = a.save ? rollSave(t, a.save.ability, a.save.dc, a.applies?.condition) : false;
      for (const part of parts) {
        if (!ok) dealDamage(t, part.amount, part.type, att.id, false);
        else if (a.save?.halfOnSave) dealDamage(t, Math.floor(part.amount / 2), part.type, att.id, false);
      }
      if (!ok && isAlive(t) && a.applies) addCondition(t, a.applies, att);
    }
  }

  function inReach(att: Creature, a: ActionDef, tgt: Creature): boolean {
    const t = a.targeting;
    if (t.kind !== 'creature') return false;
    const d = chebyshev(att.pos, tgt.pos);
    const max = t.melee ? t.range : (t.longRange ?? t.range);
    if (d > max) return false;
    return d <= 1 || nav.hasLineOfSight(att.pos, tgt.pos);
  }

  function targetsFor(att: Creature, a: ActionDef): string[] {
    let def = a;
    if (a.multiattack) {
      const first = a.multiattack.map((id) => findAction(att, id)).find((x) => x !== undefined);
      if (!first) return [];
      def = first;
    }
    const t = def.targeting;
    if (t.kind !== 'creature') return [];
    return all
      .filter((o) => {
        if (!isAlive(o)) return false;
        const sideOk = t.friendly ? isFriendlySide(o) === isFriendlySide(att) : areHostile(att, o);
        return sideOk && inReach(att, def, o);
      })
      .map((o) => o.id);
  }

  function pointLegal(att: Creature, a: ActionDef, point: GridPos | undefined): boolean {
    if (a.targeting.kind !== 'point') return false;
    if (a.targeting.range === 0) return true;
    if (!point || !nav.inBounds(point)) return false;
    const d = chebyshev(att.pos, point);
    return d <= a.targeting.range && (d <= 1 || nav.hasLineOfSight(att.pos, point));
  }

  function useCheck(c: Creature, id: string): { ok: boolean; reason?: string } {
    if (!began) return { ok: false, reason: 'Combat has not begun' };
    if (over) return { ok: false, reason: 'Combat is over' };
    if (c.id !== turn.creatureId) return { ok: false, reason: 'Not your turn' };
    const a = findAction(c, id);
    if (!a) return { ok: false, reason: 'Unknown action' };
    if (isIncapacitated(c)) return { ok: false, reason: 'Incapacitated' };
    const cost = actionCost(c, a);
    if (cost === 'reaction') return { ok: false, reason: 'Reactions trigger automatically' };
    if (a.uses) {
      const pool = c.resources[a.uses.resource];
      if (!pool) return { ok: false, reason: 'No uses available' };
      if (pool.current < a.uses.amount) return { ok: false, reason: `No ${pool.name} left` };
    }
    if (a.recharge !== undefined && spentRecharge.get(c.id)?.has(a.id)) return { ok: false, reason: 'Recharging' };
    if (cost === 'action' && turn.actionUsed) return { ok: false, reason: 'No action left' };
    if (cost === 'bonus' && turn.bonusUsed) return { ok: false, reason: 'No bonus action left' };
    if (a.effects?.includes('actionSurge') && !turn.actionUsed) return { ok: false, reason: 'Use your action first' };
    if (a.multiattack && a.multiattack.every((sid) => !findAction(c, sid))) return { ok: false, reason: 'Nothing to attack with' };
    return { ok: true };
  }

  // ---------------------------------------------------------- turn handling

  function checkOver(): boolean {
    if (over) return true;
    const friendly = all.some((c) => isAlive(c) && isFriendlySide(c));
    const enemy = all.some((c) => isAlive(c) && !isFriendlySide(c));
    if (enemy && friendly) return false;
    over = true;
    winner = enemy ? 'enemy' : 'player';
    emit({ type: 'combatEnd', winner });
    return true;
  }

  /** Returns false if the creature cannot act this turn. */
  function startTurn(c: Creature): boolean {
    turn.creatureId = c.id;
    turn.actionUsed = false;
    turn.bonusUsed = false;
    reactionUsed.delete(c.id);
    for (const cond of c.conditions.filter((x) => x.condition === 'dodging')) removeCondition(c, cond);
    emit({ type: 'turnStart', creatureId: c.id });
    const spent = spentRecharge.get(c.id);
    if (spent) {
      for (const aid of [...spent]) {
        const a = c.actions.find((x) => x.id === aid);
        if (!a || a.recharge === undefined) continue;
        const roll = rng.die(6);
        if (roll >= a.recharge) {
          spent.delete(aid);
          log(`${c.name}'s ${a.name} recharges (rolled ${roll}).`);
        }
      }
    }
    for (const [id, sl] of [...slowed]) if (sl.by === c.id) slowed.delete(id);
    turn.movementLeft = speedOf(c);
    // HOUSE RULE: a prone creature stands automatically at the cost of half its speed.
    const prone = c.conditions.find((x) => x.condition === 'prone');
    if (prone && !isIncapacitated(c)) {
      removeCondition(c, prone);
      turn.movementLeft = Math.max(0, turn.movementLeft - Math.floor(c.speed / 2));
    }
    if (isIncapacitated(c)) {
      log(`${c.name} is incapacitated and loses the turn.`);
      return false;
    }
    return true;
  }

  function endOfTurn(c: Creature): void {
    const vx = vexed.get(c.id);
    if (vx && --vx.turnEnds <= 0) vexed.delete(c.id);
    for (const cond of c.conditions.filter((x) => x.condition === 'disengaged')) removeCondition(c, cond);
    for (const cond of [...c.conditions]) {
      if (!cond.saveEnds || !isAlive(c)) continue;
      if (rollSave(c, cond.saveEnds.ability, cond.saveEnds.dc, cond.condition)) removeCondition(c, cond);
    }
    // Durations tick at the end of the SOURCE's turn (or the holder's own turn if the source is gone).
    for (const holder of all) {
      for (const cond of [...holder.conditions]) {
        if (cond.rounds === null) continue;
        const src = cond.sourceId !== undefined ? byId.get(cond.sourceId) : undefined;
        const ticks = src !== undefined && isAlive(src) ? src.id === c.id : holder.id === c.id;
        if (!ticks) continue;
        cond.rounds -= 1;
        if (cond.rounds <= 0) removeCondition(holder, cond);
      }
    }
    emit({ type: 'turnEnd', creatureId: c.id });
  }

  /** Move the index to the next living creature, emitting roundStart on wrap. */
  function nextLiving(): Creature | undefined {
    for (let step = 0; step < order.length + 1; step++) {
      idx += 1;
      if (idx >= order.length) {
        idx = 0;
        round += 1;
        emit({ type: 'roundStart', round });
      }
      const cand = byId.get(order[idx] as string) as Creature;
      if (isAlive(cand)) return cand;
    }
    return undefined;
  }

  /** End the active creature's turn and start the next creature that can act. */
  function advance(): void {
    let skipped = 0;
    for (;;) {
      const cur = active();
      if (isAlive(cur)) endOfTurn(cur);
      else emit({ type: 'turnEnd', creatureId: cur.id });
      if (checkOver()) return;
      const next = nextLiving();
      if (!next) return;
      if (startTurn(next) || skipped >= MAX_SKIPPED_TURNS) return;
      skipped += 1;
    }
  }

  // --------------------------------------------------------------- commands

  function validateMove(c: Creature, path: GridPos[]): void {
    if (path.length === 0) throw new Error('Move path is empty');
    if (isIncapacitated(c)) throw new Error(`${c.name} cannot move while incapacitated`);
    let cur = c.pos;
    let cost = 0;
    for (const p of path) {
      if (chebyshev(cur, p) !== 1) throw new Error('Move path is not contiguous');
      const sc = nav.stepCost(cur, p);
      if (!Number.isFinite(sc)) throw new Error(`Cannot step from (${cur.x},${cur.y}) to (${p.x},${p.y})`);
      if (occupiedBy(p, c.id)) throw new Error(`Cell (${p.x},${p.y}) is occupied`);
      cost += sc;
      cur = p;
    }
    if (cost > turn.movementLeft + 1e-9) throw new Error(`Not enough movement: need ${cost}, have ${turn.movementLeft}`);
  }

  /** The melee attack used for opportunity attacks: the single melee attack with the best average damage. */
  function opportunityAction(h: Creature): ActionDef | undefined {
    let best: ActionDef | undefined;
    let bestAvg = -1;
    for (const a of h.actions) {
      if (!a.attack || a.targeting.kind !== 'creature' || !a.targeting.melee || a.cost === 'reaction') continue;
      const avg = (a.damage ?? []).reduce((s, p) => s + averageDice(p.dice), 0);
      if (avg > bestAvg) {
        best = a;
        bestAvg = avg;
      }
    }
    return best;
  }

  function doMove(c: Creature, path: GridPos[]): void {
    let segment: GridPos[] = [];
    const flush = (): void => {
      if (segment.length) emit({ type: 'move', creatureId: c.id, path: segment });
      segment = [];
    };
    for (const next of path) {
      if (!hasCondition(c, 'disengaged')) {
        for (const h of all) {
          if (!isAlive(c)) break;
          if (!isAlive(h) || !areHostile(c, h) || reactionUsed.has(h.id) || isIncapacitated(h)) continue;
          const oa = opportunityAction(h);
          if (!oa || oa.targeting.kind !== 'creature') continue;
          const reach = oa.targeting.range;
          if (chebyshev(c.pos, h.pos) > reach || chebyshev(next, h.pos) <= reach) continue;
          flush();
          reactionUsed.add(h.id);
          const label = `Opportunity Attack (${oa.name})`;
          emit({ type: 'actionUsed', creatureId: h.id, actionId: oa.id, name: label, targetId: c.id });
          resolveOn(h, oa, c, true, label);
        }
      }
      if (!isAlive(c)) break;
      const sc = nav.stepCost(c.pos, next);
      c.pos = { x: next.x, y: next.y };
      turn.movementLeft -= sc;
      segment.push({ x: next.x, y: next.y });
    }
    flush();
  }

  function addSelfCondition(c: Creature, cond: Condition): void {
    c.conditions.push(makeCondition(cond, null, c.id));
    emit({ type: 'conditionAdded', creatureId: c.id, condition: cond });
  }

  function doAction(c: Creature, a: ActionDef, targetId: string | undefined, point: GridPos | undefined): void {
    const ev: GameEvent = { type: 'actionUsed', creatureId: c.id, actionId: a.id, name: a.name };
    if (targetId !== undefined) ev.targetId = targetId;
    if (point !== undefined) ev.point = point;
    emit(ev);
    const cost = actionCost(c, a);
    if (cost === 'action') turn.actionUsed = true;
    if (cost === 'bonus') turn.bonusUsed = true;
    if (a.uses) (c.resources[a.uses.resource] as { current: number }).current -= a.uses.amount;
    if (a.recharge !== undefined) {
      let set = spentRecharge.get(c.id);
      if (!set) spentRecharge.set(c.id, (set = new Set()));
      set.add(a.id);
    }
    const fx = a.effects ?? [];
    if (fx.includes('dash')) turn.movementLeft += speedOf(c);
    if (fx.includes('aggressive')) {
      turn.movementLeft += speedOf(c);
      log(`${c.name} charges!`);
    }
    if (fx.includes('actionSurge')) {
      turn.actionUsed = false;
      log(`${c.name} surges into action!`);
    }
    if (fx.includes('disengage')) addSelfCondition(c, 'disengaged');
    if (fx.includes('dodge')) addSelfCondition(c, 'dodging');
    if (fx.includes('breakFree')) {
      const d20 = rng.die(20);
      const bonus = abilityMod(c.abilities.str);
      const success = d20 + bonus >= BREAK_FREE_DC;
      emit({ type: 'saveRoll', creatureId: c.id, ability: 'str', d20, bonus, total: d20 + bonus, dc: BREAK_FREE_DC, success });
      if (success) {
        for (const cond of c.conditions.filter((x) => x.condition === 'restrained' && x.rounds === null)) removeCondition(c, cond);
      }
    }
    const t = a.multiattack ? ({ kind: 'creature', melee: true, range: 1 } as const) : a.targeting;
    if (t.kind === 'self') {
      if (a.heal) heal(c, a.heal);
      if (a.applies) addCondition(c, a.applies, c);
      return;
    }
    if (t.kind === 'point') {
      const origin = t.range === 0 ? c.pos : (point as GridPos);
      resolveArea(c, a, computeAreaCells(nav, c.pos, origin, t.range, t.area));
      return;
    }
    const primary = byId.get(targetId as string) as Creature;
    if (a.multiattack) {
      for (const sid of a.multiattack) {
        const sub = findAction(c, sid);
        if (!sub || !isAlive(c)) continue;
        let tgt: Creature | undefined = primary;
        if (!isAlive(primary) || !inReach(c, sub, primary)) {
          tgt = targetsFor(c, sub)
            .map((id) => byId.get(id) as Creature)
            .sort((x, y) => chebyshev(c.pos, x.pos) - chebyshev(c.pos, y.pos))[0];
        }
        if (tgt) resolveOn(c, sub, tgt);
      }
      return;
    }
    resolveOn(c, a, primary);
  }

  /** Hit probability (attacks) or failed-save probability (saves) of an action; null if neither. */
  function chanceOf(a: ActionDef, c: Creature, tgt: Creature): number | null {
    if (a.multiattack) {
      const first = a.multiattack.map((id) => findAction(c, id)).find((x) => x !== undefined);
      return first ? chanceOf(first, c, tgt) : null;
    }
    if (a.attack) {
      const s = attackSetup(c, tgt, a);
      const p = d20Probability(s.mode, singleHitProbability(s.bonus, tgt.ac, s.critMin));
      return canInspire(c) ? p + (1 - p) * p : p;
    }
    if (a.save) {
      if (autoFailsSave(tgt, a.save.ability)) return 1;
      const mode = saveMode(tgt, a.save.ability, a.applies?.condition);
      return 1 - d20Probability(mode, singleSaveProbability(saveBonus(tgt, a.save.ability), a.save.dc));
    }
    return null;
  }

  // -------------------------------------------------------------------- api

  const api: CombatApi = {
    get round() {
      return round;
    },
    get order() {
      return order;
    },
    get activeId() {
      return turn.creatureId;
    },
    get turn() {
      return turn;
    },
    get isOver() {
      return over;
    },
    get winner() {
      return winner;
    },

    begin(): GameEvent[] {
      if (began) throw new Error('Combat has already begun');
      began = true;
      events = [];
      const rolled = all.map((c, i) => {
        const r = rollD20(hasFlag(c, 'initAdv') ? 'advantage' : 'normal');
        return { c, i, total: r.d20 + abilityMod(c.abilities.dex) };
      });
      rolled.sort(
        (a, b) =>
          b.total - a.total ||
          Number(b.c.id === 'player') - Number(a.c.id === 'player') ||
          b.c.abilities.dex - a.c.abilities.dex ||
          a.i - b.i,
      );
      for (const r of rolled) order.push(r.c.id);
      emit({ type: 'combatStart', order: [...order] });
      log(`Initiative: ${rolled.map((r) => `${r.c.name} ${r.total}`).join(', ')}.`);
      if (checkOver()) return events;
      round = 1;
      emit({ type: 'roundStart', round });
      idx = -1;
      let skipped = 0;
      for (;;) {
        idx += 1;
        if (idx >= order.length) {
          idx = 0;
          round += 1;
          emit({ type: 'roundStart', round });
        }
        const cand = byId.get(order[idx] as string) as Creature;
        if (!isAlive(cand)) continue;
        if (startTurn(cand) || skipped >= MAX_SKIPPED_TURNS) break;
        endOfTurn(cand);
        skipped += 1;
        if (checkOver()) break;
      }
      return events;
    },

    creature: (id) => byId.get(id),
    creatures: () => all,

    reachable(): ReachableCell[] {
      if (!began || over) return [];
      const c = active();
      if (isIncapacitated(c)) return [];
      return nav
        .reachable(c.pos, turn.movementLeft, { blocked: (p) => occupiedBy(p, c.id) !== undefined })
        .filter((r) => !(r.pos.x === c.pos.x && r.pos.y === c.pos.y) && !occupiedBy(r.pos, c.id));
    },

    availableActions(): ActionDef[] {
      if (!began || over) return [];
      const c = active();
      const out = [...c.actions];
      if (canBreakFree(c) && !out.some((a) => a.id === BREAK_FREE_ID)) out.push(breakFreeAction());
      return out;
    },

    canUse(actionId) {
      if (!began) return { ok: false, reason: 'Combat has not begun' };
      return useCheck(active(), actionId);
    },

    validTargets(actionId) {
      if (!began) return [];
      const c = active();
      const a = findAction(c, actionId);
      return a ? targetsFor(c, a) : [];
    },

    hitChance(actionId, targetId) {
      if (!began) return null;
      const c = active();
      const a = findAction(c, actionId);
      const t = byId.get(targetId);
      if (!a || !t) return null;
      return chanceOf(a, c, t);
    },

    areaCells(actionId, point) {
      if (!began) return [];
      const c = active();
      const a = findAction(c, actionId);
      if (!a || a.targeting.kind !== 'point') return [];
      return computeAreaCells(nav, c.pos, point, a.targeting.range, a.targeting.area);
    },

    execute(command: Command): GameEvent[] {
      if (!began) throw new Error('Combat has not begun');
      if (over) throw new Error('Combat is over');
      const c = active();
      // Validate completely before touching any state.
      if (command.type === 'move') {
        validateMove(c, command.path);
      } else if (command.type === 'action') {
        const a = findAction(c, command.actionId);
        const check = useCheck(c, command.actionId);
        if (!a || !check.ok) throw new Error(`Cannot use ${command.actionId}: ${check.reason ?? 'unknown'}`);
        const t = a.multiattack ? ({ kind: 'creature' } as const) : a.targeting;
        if (t.kind === 'creature') {
          if (command.targetId === undefined || !targetsFor(c, a).includes(command.targetId)) {
            throw new Error(`Invalid target for ${a.name}`);
          }
        } else if (t.kind === 'point') {
          if (!pointLegal(c, a, command.point)) throw new Error(`Invalid target point for ${a.name}`);
        }
      } else if (command.type !== 'endTurn') {
        throw new Error('Unknown command');
      }
      events = [];
      if (command.type === 'endTurn') {
        advance();
        return events;
      }
      if (command.type === 'move') doMove(c, command.path);
      else doAction(c, findAction(c, command.actionId) as ActionDef, command.targetId, command.point);
      if (!checkOver() && !isAlive(c)) advance();
      return events;
    },
  };
  return api;
}

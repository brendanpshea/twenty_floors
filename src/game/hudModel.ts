import { Rng } from '../core/rng';
import type { ActionDef, CombatApi, Condition, Creature, Hazard, HelpMode, HudAction, HudModel } from '../core/types';
import { advise, adviseExplore, SHOVE_PUSH_ID, SHOVE_TRIP_ID, attacksLeft, companionPrayer, concentratingOn, coverFor, creatureTactic, pushPreview, getCreationOptions, getSpell, isHiddenResource, longRestGain, outOfCombatSpells, shortRestGain, spellPoolKey, syncFromCreature } from '../rules';
import type { FloorState, RestSiteState } from './floorState';
import { companionWantsLongRest, companionWantsShortRest } from './party';
import { SHOVE_ID } from './combatController';
import { creatureById, isEntityVisible, livingMonsters, monsterDef } from './floorState';

let classNames: Map<string, string> | null = null;
let classDice: Map<string, number> | null = null;
function hitDieOf(id: string): number {
  if (!classDice) classDice = new Map(getCreationOptions().classes.map((c) => [c.id, c.hitDie]));
  return classDice.get(id) ?? 8;
}
function classNameOf(id: string): string {
  if (!classNames) classNames = new Map(getCreationOptions().classes.map((c) => [c.id, c.name]));
  return classNames.get(id) ?? id;
}

/** The explore action for the companion's Prayer of Healing. */
export const PRAYER_ID = 'companion_prayer';

/** Whether Prayer of Healing is on offer (the companion knows it) and would do something right now. */
export function prayerAvailability(state: FloorState): { ok: boolean; uses: number; reason?: string } | null {
  const rt = state.companion;
  if (!rt || rt.downed) return null;
  const probe = companionPrayer(syncFromCreature(state.pc, state.player), rt.state, rt.def, state.pc.level, new Rng(1));
  if ('error' in probe) {
    if (probe.error.includes('does not know')) return null;
    return { ok: false, uses: rt.state.resources['spell:prayer_of_healing']?.current ?? 0, reason: probe.error };
  }
  return { ok: true, uses: rt.state.resources['spell:prayer_of_healing']?.current ?? 0 };
}

/** Action-id prefix of a spell cast between fights (the explore HUD). */
export const CAST_PREFIX = 'cast_';

/** Past this many creatures in a fight the initiative strip drops the defeated. */
export const MAX_STRIP_WITH_DEAD = 8;

export interface HudInputs {
  state: FloorState;
  combat: CombatApi | null;
  selectedActionId: string | null;
  /** The action a plain tap on the hovered creature would use (for the hit chance readout). */
  previewActionId?: string | null;
  /** Input is locked (playback, enemy turn). */
  busy: boolean;
  /** Guided mode shows the adviser's suggestion; standard never does. */
  help?: HelpMode;
}

function conditionsOf(c: Creature): Condition[] {
  return [...new Set(c.conditions.map((x) => x.condition))];
}

function usesLeft(c: Creature, a: ActionDef): number | undefined {
  if (!a.uses) return undefined;
  const pool = c.resources[a.uses.resource];
  return pool ? Math.floor(pool.current / Math.max(1, a.uses.amount)) : 0;
}

function hudAction(
  c: Creature,
  a: ActionDef,
  enabled: boolean,
  reason: string | undefined,
  selected: boolean,
): HudAction {
  const out: HudAction = {
    id: a.id,
    name: a.name,
    description: a.description,
    cost: a.cost,
    enabled,
    selected,
  };
  if (a.icon !== undefined) out.icon = a.icon;
  if (reason !== undefined && !enabled) out.disabledReason = reason;
  const left = usesLeft(c, a);
  if (left !== undefined) out.usesLeft = left;
  return out;
}

/**
 * Shove: Push and Shove: Trip come from the engine as two actions; the bar shows one "Shove" after the weapon
 * attacks. Pressing it aims a push, pressing it again switches to Trip (see CombatController.selectAction).
 */
export function mergeShove(actions: HudAction[], selectedActionId: string | null): HudAction[] {
  const push = actions.find((a) => a.id === SHOVE_PUSH_ID);
  const trip = actions.find((a) => a.id === SHOVE_TRIP_ID);
  if (!push && !trip) return actions;
  const rest = actions.filter((a) => a.id !== SHOVE_PUSH_ID && a.id !== SHOVE_TRIP_ID);
  const base = (push ?? trip) as HudAction;
  const pushing = selectedActionId === SHOVE_PUSH_ID;
  const tripping = selectedActionId === SHOVE_TRIP_ID;
  const merged: HudAction = {
    id: SHOVE_ID,
    name: pushing ? 'Shove: Push' : tripping ? 'Shove: Trip' : 'Shove',
    description:
      'Replace one attack: the target (no more than one size larger) makes a Strength or Dexterity save or is pushed one cell away (a drop or lava behind it hurts). Press again to knock it Prone instead.',
    cost: 'action',
    enabled: (push?.enabled ?? false) || (trip?.enabled ?? false),
    selected: pushing || tripping,
  };
  if (base.icon !== undefined) merged.icon = base.icon;
  if (!merged.enabled) {
    const why = base.disabledReason;
    if (why !== undefined) merged.disabledReason = why;
  }
  let at = -1;
  rest.forEach((a, i) => {
    if (a.id.startsWith('atk_') || a.id.startsWith('throw_') || a.id.startsWith('offhand_')) at = i;
  });
  if (at < 0) at = actions.indexOf(base) - 1;
  rest.splice(at + 1, 0, merged);
  return rest;
}

export function buildHudModel(inp: HudInputs): HudModel {
  const { state, combat, selectedActionId, busy } = inp;
  const player = state.player;
  const inCombat = state.mode === 'combat' && combat !== null;
  const shownHp = (c: Creature): number => state.shownHp.get(c.id) ?? c.hp;

  const model: HudModel = {
    mode: inCombat ? 'combat' : 'explore',
    floor: { depth: state.depth, themeName: state.themeName },
    player: {
      name: state.pc.build.name,
      level: state.pc.level,
      className: classNameOf(state.pc.build.classId),
      hp: inCombat ? shownHp(player) : player.hp,
      maxHp: player.maxHp,
      tempHp: player.tempHp,
      ac: player.ac,
      conditions: conditionsOf(player),
      resources: Object.entries(player.resources)
        .filter(([key]) => !isHiddenResource(key))
        .map(([, p]) => ({ name: p.name, current: p.current, max: p.max })),
    },
    actions: [],
    log: [...state.log],
    shortRestsLeft: state.shortRestsLeft,
    canShortRest: canShortRest(state, busy),
    hitDice: { current: state.pc.hitDiceLeft, max: state.pc.level, die: hitDieOf(state.pc.build.classId) },
    restSitesLeft: state.restSites.filter((r) => !r.used).length,
    canLongRest: canLongRest(state, busy),
  };
  const comp = state.companion;
  if (comp) {
    const c = comp.creature;
    const down = comp.downed || state.shownDead.has('companion');
    model.companion = {
      id: comp.def.id,
      name: comp.def.name,
      role: comp.def.role,
      level: c.level,
      hp: inCombat ? Math.max(0, state.shownHp.get('companion') ?? c.hp) : c.hp,
      maxHp: c.maxHp,
      conditions: down ? [] : conditionsOf(c),
      downed: inCombat ? down : false,
      stance: comp.state.stance,
      resources: Object.entries(c.resources)
        .filter(([key]) => !isHiddenResource(key))
        .map(([, p]) => ({ name: p.name, current: p.current, max: p.max })),
    };
  }
  const blocked = shortRestBlock(state);
  if (blocked !== undefined && state.mode === 'explore') model.shortRestBlockedReason = blocked;
  if (state.prompt !== undefined) model.prompt = state.prompt;

  if (inCombat && combat) {
    const activeId = state.shownActive ?? combat.activeId;
    // A hero who has just been struck down is not taking a turn (the defeat is still being played).
    const playerTurn = activeId === 'player' && !busy && !combat.isOver && !state.shownDead.has('player');
    model.combat = {
      round: combat.round,
      playerTurn,
      movementLeft: playerTurn ? combat.turn.movementLeft : 0,
      speed: player.speed,
      actionAvailable: playerTurn && (!combat.turn.actionUsed || attacksLeft(combat) > 0),
      bonusAvailable: playerTurn && !combat.turn.bonusUsed,
      // Before the fight has begun the engine has rolled no order yet: show everyone who is in it.
      initiative: (combat.order.length > 0 ? combat.order : combat.creatures().map((x) => x.id)).flatMap((id) => {
        const c = combat.creature(id);
        if (!c) return [];
        const dead = state.shownDead.has(id);
        // In a crowd the strip only has room for the living.
        if (dead && combat.creatures().length > MAX_STRIP_WITH_DEAD) return [];
        return [
          {
            id,
            name: c.name,
            faction: c.faction,
            hpFraction: c.maxHp > 0 ? Math.max(0, Math.min(1, shownHp(c) / c.maxHp)) : 0,
            active: id === activeId && !dead,
            dead,
          },
        ];
      }),
    };
    const perAction = player.resources['_attacks']?.current ?? 1;
    if (playerTurn && perAction > 1) model.combat.attacksLeft = { current: attacksLeft(combat), max: perAction };
    if (playerTurn) {
      model.actions = mergeShove(
        combat.availableActions().map((a) => {
          const check = combat.canUse(a.id);
          return hudAction(player, a, check.ok, check.reason, a.id === selectedActionId);
        }),
        selectedActionId,
      );
    } else {
      model.actions = player.actions.map((a) => hudAction(player, a, false, busy ? 'Wait for your turn' : 'Not your turn', false));
    }
  }

  if (inCombat && combat) {
    const spell = concentratingOn(player);
    if (spell) model.concentration = { spellName: spell, roundsLeft: player.resources['_concentration']?.current ?? 0 };
  }

  if (!inCombat) {
    const hurt = player.hp < player.maxHp;
    model.actions = player.actions
      .filter((x) => x.id.startsWith('drink_') && (usesLeft(player, x) ?? 1) > 0)
      .map((x) => hudAction(player, x, hurt && !busy, busy ? 'Wait' : 'You are at full health', false));
    // The Sphinx's Prayer of Healing, once its level allows and somebody is hurt.
    const prayer = prayerAvailability(state);
    if (prayer) {
      model.actions.push({
        id: PRAYER_ID,
        name: 'Prayer of Healing',
        description: 'Your companion prays: restores 2d8 plus its casting modifier to you and to itself. Once per long rest.',
        icon: 'spell',
        cost: 'action',
        enabled: prayer.ok && !busy && !state.finished,
        selected: false,
        usesLeft: prayer.uses,
        ...(prayer.ok || busy ? {} : { disabledReason: prayer.reason }),
      });
    }
    // Spells that work between fights (cures, False Life, Mage Armor), next to the potions.
    const synced = syncFromCreature(state.pc, player);
    for (const sp of outOfCombatSpells(synced)) {
      const def = getSpell(sp.id);
      const pool = synced.resources[spellPoolKey(sp.id)];
      const a: HudAction = {
        id: CAST_PREFIX + sp.id,
        name: sp.name,
        description: def?.description ?? sp.name,
        icon: 'spell',
        cost: 'action',
        enabled: sp.available && !busy && !state.finished,
        selected: false,
      };
      if (!a.enabled) a.disabledReason = busy ? 'Wait' : (sp.reason ?? 'Not now');
      if (pool) a.usesLeft = pool.current;
      model.actions.push(a);
    }
  }

  // Guided mode: the adviser's suggestion (in combat on the hero's turn, between fights otherwise).
  if (inp.help === 'guided') {
    if (inCombat && combat && model.combat?.playerTurn) {
      const adv = advise(combat, state.nav);
      if (adv) {
        model.suggestion = adv.text;
        const id = adv.actionId === SHOVE_PUSH_ID || adv.actionId === SHOVE_TRIP_ID ? SHOVE_ID : adv.actionId;
        const match = id ? model.actions.find((a) => a.id === id) : undefined;
        if (match) match.suggested = true;
      }
    } else if (!inCombat && !busy && !state.finished) {
      const synced = syncFromCreature(state.pc, player);
      const spells = outOfCombatSpells(synced);
      const nudge = adviseExplore(synced, {
        hpFraction: player.maxHp > 0 ? player.hp / player.maxHp : 1,
        shortRestsLeft: state.shortRestsLeft,
        atRestSite: adjacentRestSite(state) !== undefined,
        canCastHeal: spells.some((x) => (x.id === 'cure_wounds' || x.id === 'healing_word') && x.available),
        potions: synced.inventory.find((x) => x.itemId === 'potion_healing')?.quantity ?? 0,
        enemyInView: enemyInView(state),
        companionHurt: !!state.companion && state.companion.creature.hp < state.companion.creature.maxHp,
      });
      if (nudge) model.suggestion = nudge.text;
    }
  }

  const target = state.targetId ? creatureById(state, state.targetId) : undefined;
  if (target && isEntityVisible(state, target.id)) {
    const t: NonNullable<HudModel['target']> = {
      name: target.name,
      hp: Math.max(0, shownHp(target)),
      maxHp: target.maxHp,
      ac: target.ac,
      conditions: conditionsOf(target),
      faction: target.faction,
    };
    const desc = target.id === 'player' ? undefined : monsterDef(target.defId)?.description;
    const isBoss = target.resources['_boss'] !== undefined;
    if (desc || isBoss) t.description = `${isBoss ? 'Floor boss. ' : ''}${desc ?? ''}`.trim();
    const enemy = target.faction === 'enemy';
    if (inCombat && combat && enemy) {
      // Cover against the hero from where the hero stands, and how the monster fights.
      const cv = coverFor(state.nav, combat.creatures(), player.pos, target.pos, [player.id, target.id]);
      t.cover = cv >= 5 ? 5 : cv >= 2 ? 2 : 0;
      const tactic = creatureTactic(target);
      if (tactic) t.tactic = tactic;
      if (selectedActionId) {
        // pushPreview may name hazards beyond fall and lava (water, ice, fire, spikes), with or without damage.
        const push = pushPreview(combat, selectedActionId, target.id) as { hazard: Hazard; damage?: string } | null;
        if (push) {
          const into = { hazard: push.hazard } as NonNullable<NonNullable<HudModel['target']>['pushInto']>;
          if (push.damage) into.damage = push.damage;
          t.pushInto = into;
        }
      }
    }
    const chanceAction = selectedActionId ?? inp.previewActionId ?? null;
    // Only attack rolls have a hit chance (a save spell or an area has none to show).
    const chanceDef = chanceAction ? player.actions.find((x) => x.id === chanceAction) : undefined;
    const isShoveAction = chanceAction === SHOVE_PUSH_ID || chanceAction === SHOVE_TRIP_ID;
    if (inCombat && combat && chanceAction && (chanceDef?.attack !== undefined || isShoveAction) && target.id !== 'player' && !busy) {
      const chance = combat.hitChance(chanceAction, target.id);
      if (chance !== null) t.hitChance = chance;
    }
    model.target = t;
  }
  return model;
}

/** The unused rest site next to the hero, if any. */
export function adjacentRestSite(state: FloorState): RestSiteState | undefined {
  const p = state.player.pos;
  return state.restSites.find((r) => !r.used && Math.max(Math.abs(r.pos.x - p.x), Math.abs(r.pos.y - p.y)) <= 1);
}

/** Any living monster within 12 cells that has actual line of sight to the hero. */
export function enemyInView(state: FloorState): boolean {
  const p = state.player.pos;
  return livingMonsters(state).some(
    (m) => Math.max(Math.abs(m.creature.pos.x - p.x), Math.abs(m.creature.pos.y - p.y)) <= 12 && state.nav.hasLineOfSight(p, m.creature.pos),
  );
}

/** Why a short rest is unavailable right now, or undefined if it is allowed. */
export function shortRestBlock(state: FloorState): string | undefined {
  if (state.mode !== 'explore' || state.finished) return 'Not during combat';
  if (state.shortRestsLeft <= 0) return 'No short rests left';
  if (enemyInView(state)) return 'An enemy is in view';
  const gain = shortRestGain(syncFromCreature(state.pc, state.player));
  if (!gain.hp && !gain.resources && !companionWantsShortRest(state)) return 'Nothing to recover';
  return undefined;
}

export function canShortRest(state: FloorState, busy: boolean): boolean {
  return !busy && shortRestBlock(state) === undefined;
}

/** Exploring, adjacent to an unused site, and a long rest would restore something. */
export function canLongRest(state: FloorState, busy: boolean): boolean {
  if (state.mode !== 'explore' || busy || state.finished || !adjacentRestSite(state)) return false;
  return longRestGain(syncFromCreature(state.pc, state.player)) || companionWantsLongRest(state);
}

import type { ActionDef, CombatApi, Condition, Creature, HudAction, HudModel } from '../core/types';
import { concentratingOn, getCreationOptions, getSpell, isHiddenResource, longRestGain, outOfCombatSpells, shortRestGain, spellPoolKey, syncFromCreature } from '../rules';
import type { FloorState, RestSiteState } from './floorState';
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
  const blocked = shortRestBlock(state);
  if (blocked !== undefined && state.mode === 'explore') model.shortRestBlockedReason = blocked;
  if (state.prompt !== undefined) model.prompt = state.prompt;

  if (inCombat && combat) {
    const activeId = state.shownActive ?? combat.activeId;
    const playerTurn = activeId === 'player' && !busy && !combat.isOver;
    model.combat = {
      round: combat.round,
      playerTurn,
      movementLeft: playerTurn ? combat.turn.movementLeft : 0,
      speed: player.speed,
      actionAvailable: playerTurn && !combat.turn.actionUsed,
      bonusAvailable: playerTurn && !combat.turn.bonusUsed,
      initiative: combat.order.flatMap((id) => {
        const c = combat.creature(id);
        if (!c) return [];
        const dead = state.shownDead.has(id);
        // In a crowd the strip only has room for the living.
        if (dead && combat.order.length > MAX_STRIP_WITH_DEAD) return [];
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
    if (playerTurn) {
      model.actions = combat.availableActions().map((a) => {
        const check = combat.canUse(a.id);
        return hudAction(player, a, check.ok, check.reason, a.id === selectedActionId);
      });
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
    if (desc) t.description = desc;
    const chanceAction = selectedActionId ?? inp.previewActionId ?? null;
    // Only attack rolls have a hit chance (a save spell or an area has none to show).
    const chanceDef = chanceAction ? player.actions.find((x) => x.id === chanceAction) : undefined;
    if (inCombat && combat && chanceAction && chanceDef?.attack !== undefined && target.id !== 'player' && !busy) {
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
  if (!gain.hp && !gain.resources) return 'Nothing to recover';
  return undefined;
}

export function canShortRest(state: FloorState, busy: boolean): boolean {
  return !busy && shortRestBlock(state) === undefined;
}

/** Exploring, adjacent to an unused site, and a long rest would restore something. */
export function canLongRest(state: FloorState, busy: boolean): boolean {
  if (state.mode !== 'explore' || busy || state.finished || !adjacentRestSite(state)) return false;
  return longRestGain(syncFromCreature(state.pc, state.player));
}

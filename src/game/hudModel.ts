import type { ActionDef, CombatApi, Condition, Creature, HudAction, HudModel } from '../core/types';
import { getCreationOptions, isHiddenResource } from '../rules';
import type { FloorState } from './floorState';
import { creatureById, isEntityVisible, monsterDef } from './floorState';

let classNames: Map<string, string> | null = null;
function classNameOf(id: string): string {
  if (!classNames) classNames = new Map(getCreationOptions().classes.map((c) => [c.id, c.name]));
  return classNames.get(id) ?? id;
}

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
  };
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

  if (!inCombat) {
    const hurt = player.hp < player.maxHp;
    model.actions = player.actions
      .filter((x) => x.id.startsWith('drink_') && (usesLeft(player, x) ?? 1) > 0)
      .map((x) => hudAction(player, x, hurt && !busy, busy ? 'Wait' : 'You are at full health', false));
  }

  const target = state.targetId ? creatureById(state, state.targetId) : undefined;
  if (target && isEntityVisible(state, target.id)) {
    const t: NonNullable<HudModel['target']> = {
      name: target.name,
      hp: Math.max(0, shownHp(target)),
      maxHp: target.maxHp,
      ac: target.ac,
      conditions: conditionsOf(target),
    };
    const desc = target.id === 'player' ? undefined : monsterDef(target.defId)?.description;
    if (desc) t.description = desc;
    const chanceAction = selectedActionId ?? inp.previewActionId ?? null;
    if (inCombat && combat && chanceAction && target.id !== 'player' && !busy) {
      const chance = combat.hitChance(chanceAction, target.id);
      if (chance !== null) t.hitChance = chance;
    }
    model.target = t;
  }
  return model;
}

/** Exploring, rests left, and something to recover. */
export function canShortRest(state: FloorState, busy: boolean): boolean {
  if (state.mode !== 'explore' || busy || state.shortRestsLeft <= 0 || state.finished) return false;
  const p = state.player;
  if (p.hp < p.maxHp) return true;
  return Object.entries(p.resources).some(
    ([key, pool]) => !isHiddenResource(key) && !key.startsWith('item:') && pool.refresh !== 'floor' && pool.current < pool.max,
  );
}

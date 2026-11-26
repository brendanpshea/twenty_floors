import type { CellHighlight, GridPos, PickResult } from '../core/types';
import { CellKind } from '../core/types';
import { getItem, rollDice, shortRest, syncFromCreature } from '../rules';
import { canShortRest } from './hudModel';
import { cellDistance } from './fog';
import type { MonsterState, SessionCtx } from './floorState';
import {
  blockedAt,
  isEntityVisible,
  isSeen,
  livingMonsters,
  samePos,
} from './floorState';

/** Combat starts when a living monster is this close by walking, with line of sight. */
export const AGGRO_RANGE = 7;

interface Goal {
  cell: GridPos;
  /** Open this chest on arrival. */
  chestId?: string;
}

export interface ExploreHooks {
  /** Start a fight with these monsters. Resolves when exploration resumes (or the floor ends). */
  beginCombat(monsters: MonsterState[]): Promise<void>;
}

/** Exploration: walking, fog-driven combat triggers, chests, rests, the stairs. */
export class Explore {
  private goal: Goal | null = null;
  walking = false;
  private hoverKey = '';
  private itemUses = 0;

  constructor(
    private readonly ctx: SessionCtx,
    private readonly hooks: ExploreHooks,
  ) {}

  /** Monsters that join a fight if one starts at the player's current cell, else null. */
  combatTrigger(): MonsterState[] | null {
    const { state } = this.ctx;
    const p = state.player.pos;
    const here = state.plan.roomIds[p.y * state.plan.width + p.x] ?? -1;
    const inEntrance = here >= 0 && state.plan.rooms.find((r) => r.id === here)?.role === 'entrance';
    const alive = livingMonsters(state);
    const rooms = new Set<number>();
    for (const m of alive) {
      const mp = m.creature.pos;
      if (here >= 0 && m.roomId === here) rooms.add(m.roomId);
      else if (
        !inEntrance &&
        cellDistance(p, mp) <= AGGRO_RANGE &&
        state.nav.hasLineOfSight(p, mp) &&
        state.nav.findPath(p, mp, { maxCost: AGGRO_RANGE }) !== null
      ) {
        rooms.add(m.roomId);
      }
    }
    if (rooms.size === 0) return null;
    return alive.filter((m) => rooms.has(m.roomId));
  }

  // ---------------------------------------------------------------- input

  hover(pick: PickResult): void {
    const { state, deps } = this.ctx;
    if (this.walking) return;
    let targetId: string | null = null;
    if (pick.entityId && state.monsters.some((m) => m.creature.id === pick.entityId) && isEntityVisible(state, pick.entityId)) {
      targetId = pick.entityId;
    }
    const key = pick.cell ? `${pick.cell.x},${pick.cell.y}` : '';
    if (targetId !== state.targetId) {
      state.targetId = targetId;
      this.ctx.hud();
    }
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    deps.renderer.setHighlights(this.pathHighlights(pick.cell));
  }

  private pathHighlights(cell: GridPos | null): CellHighlight[] {
    const { state } = this.ctx;
    if (!cell || !state.nav.isWalkable(cell) || blockedAt(state)(cell) || samePos(cell, state.player.pos)) return [];
    const path = state.nav.findPath(state.player.pos, cell, { blocked: blockedAt(state) });
    return path ? path.map((pos) => ({ pos, style: 'path' as const })) : [];
  }

  async tap(pick: PickResult): Promise<void> {
    const { state } = this.ctx;
    const chest =
      state.chests.find((c) => c.id === pick.entityId) ??
      (pick.cell ? state.chests.find((c) => samePos(c.pos, pick.cell as GridPos)) : undefined);
    if (chest) {
      if (isSeen(state, chest.pos)) await this.approachChest(chest.id);
      return;
    }
    const mon =
      state.monsters.find((m) => m.creature.id === pick.entityId) ??
      (pick.cell
        ? livingMonsters(state).find((m) => samePos(m.creature.pos, pick.cell as GridPos))
        : undefined);
    if (mon && isEntityVisible(state, mon.creature.id)) {
      state.targetId = mon.creature.id;
      this.ctx.hud();
      return;
    }
    if (pick.entityId === 'player' || !pick.cell) return;
    await this.walkToCell(pick.cell);
  }

  async walkToCell(cell: GridPos): Promise<void> {
    const { state } = this.ctx;
    if (samePos(cell, state.player.pos)) return;
    if (!state.nav.isWalkable(cell) || !state.nav.findPath(state.player.pos, cell, { blocked: blockedAt(state) })) {
      this.ctx.prompt("You can't get there.", 1800);
      return;
    }
    this.ctx.prompt(undefined);
    await this.walk({ cell });
  }

  /** Walk next to a chest and open it. */
  async approachChest(chestId: string): Promise<void> {
    const { state } = this.ctx;
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened) return;
    if (cellDistance(state.player.pos, chest.pos) <= 1) {
      await this.openChest(chestId);
      return;
    }
    let best: { cell: GridPos; len: number } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: chest.pos.x + dx, y: chest.pos.y + dy };
        if ((dx === 0 && dy === 0) || !state.nav.isWalkable(n) || blockedAt(state)(n)) continue;
        const path = state.nav.findPath(state.player.pos, n, { blocked: blockedAt(state) });
        if (path && (!best || path.length < best.len)) best = { cell: n, len: path.length };
      }
    }
    if (!best) {
      this.ctx.prompt("You can't reach the chest.", 1800);
      return;
    }
    await this.walk({ cell: best.cell, chestId });
  }

  // -------------------------------------------------------------- walking

  /** Walk toward the goal one cell at a time. A new goal while walking re-targets in place. */
  private async walk(goal: Goal): Promise<void> {
    const { state, deps } = this.ctx;
    this.goal = goal;
    if (this.walking) return;
    this.walking = true;
    deps.renderer.setHighlights([]);
    this.hoverKey = '';
    state.targetId = null;
    let arrived: Goal | null = null;
    try {
      while (this.goal && !state.finished) {
        const g: Goal = this.goal;
        const pos = state.player.pos;
        if (samePos(pos, g.cell)) {
          arrived = g;
          this.goal = null;
          break;
        }
        const path = state.nav.findPath(pos, g.cell, { blocked: blockedAt(state) });
        const step = path?.[0];
        if (!step) {
          this.ctx.prompt("You can't get there.", 1800);
          this.goal = null;
          break;
        }
        deps.audio.play(state.plan.kinds[step.y * state.plan.width + step.x] === CellKind.Water ? 'stepWater' : 'step');
        await this.ctx.guard(deps.renderer.moveEntity('player', [step]), 1200);
        state.player.pos = { x: step.x, y: step.y };
        this.ctx.reveal();

        const trigger = this.combatTrigger();
        if (trigger) {
          this.goal = null;
          this.walking = false;
          await this.hooks.beginCombat(trigger);
          return;
        }
        if (samePos(step, state.plan.exit)) {
          this.goal = null;
          if (!state.stairsOpen) this.ctx.prompt('The stairs are sealed. Defeat the floor boss first.', 3500);
          else {
            deps.audio.play('descend');
            this.ctx.finish({ type: 'cleared', pc: state.pc });
            return;
          }
          break;
        }
      }
    } finally {
      this.walking = false;
    }
    if (arrived?.chestId) await this.openChest(arrived.chestId);
    this.ctx.hud();
  }

  // --------------------------------------------------------------- chests

  async openChest(chestId: string): Promise<void> {
    const { state, deps } = this.ctx;
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || state.finished) return;
    chest.opened = true;
    const rng = state.floorRng.fork(`chest:${chestId}`);
    const gold = rng.int(8 + state.depth * 6, 20 + state.depth * 14);
    const potion = rng.chance(0.3);
    deps.audio.play('chestOpen');
    deps.audio.play('coins', { delay: 0.45 });
    await this.ctx.guard(deps.renderer.playAnim(chest.id, 'attack', { facing: chest.pos }), 1500);

    const next = syncFromCreature(state.pc, state.player);
    next.gold += gold;
    let found = `${gold} gold`;
    if (potion) {
      const stack = next.inventory.find((s) => s.itemId === 'potion_healing');
      if (stack) stack.quantity += 1;
      else next.inventory.push({ itemId: 'potion_healing', quantity: 1 });
      found += ' and a Potion of Healing';
    }
    state.pc = next;
    this.ctx.rebuildPlayer();
    deps.renderer.floatText(chest.id, `+${gold} gold`, 'info');
    if (potion) deps.renderer.floatText(state.player.pos, 'Potion of Healing', 'heal');
    this.ctx.say(`${state.pc.build.name} opens the chest and finds ${found}.`);
    this.ctx.hud();
  }

  // ---------------------------------------------------------------- rests

  shortRest(): void {
    const { state, deps } = this.ctx;
    if (!canShortRest(state, this.walking)) return;
    const before = state.player.hp;
    state.pc = shortRest(syncFromCreature(state.pc, state.player));
    state.shortRestsLeft -= 1;
    deps.audio.play('rest');
    this.ctx.rebuildPlayer();
    const gained = state.player.hp - before;
    deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
    if (gained > 0) deps.renderer.floatText('player', `+${gained}`, 'heal');
    this.ctx.say(
      `${state.pc.build.name} takes a short rest and recovers ${gained} hit points. ${state.shortRestsLeft} short rest${state.shortRestsLeft === 1 ? '' : 's'} left on this floor.`,
    );
    this.ctx.hud();
  }

  /** Drink a healing consumable outside combat (rules exports no helper for this; see report). */
  useItem(actionId: string): void {
    const { state, deps } = this.ctx;
    if (this.walking || state.mode !== 'explore' || !actionId.startsWith('drink_')) return;
    const itemId = actionId.slice('drink_'.length);
    const item = getItem(itemId);
    const next = syncFromCreature(state.pc, state.player);
    const owned = next.inventory.find((s) => s.itemId === itemId && s.quantity > 0);
    if (!item?.consumable || !owned) return;
    if (next.hp >= next.maxHp) {
      deps.audio.play('uiError');
      this.ctx.prompt('You are already at full health.', 1800);
      return;
    }
    const rng = state.floorRng.fork(`item:${itemId}:${this.itemUses++}`);
    const healed = rollDice(rng, item.consumable.dice).total;
    const before = next.hp;
    next.hp = Math.min(next.maxHp, next.hp + healed);
    owned.quantity -= 1;
    next.inventory = next.inventory.filter((s) => s.quantity > 0);
    state.pc = next;
    this.ctx.rebuildPlayer();
    const gained = next.hp - before;
    deps.audio.play('potion');
    deps.audio.play('heal', { delay: 0.25 });
    deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
    deps.renderer.floatText('player', `+${gained}`, 'heal');
    this.ctx.say(`${next.build.name} drinks ${item.name} and regains ${gained} hit points.`);
    this.ctx.hud();
  }

  /** Stop walking (the floor is ending or combat is taking over). */
  stop(): void {
    this.goal = null;
  }
}

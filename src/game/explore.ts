import type { CellHighlight, GridPos, PickResult } from '../core/types';
import { CellKind, SHORT_RESTS_PER_LONG_REST } from '../core/types';
import { chestLoot, getItem, isHiddenResource, longRest, longRestGain, rollDice, syncFromCreature, takeShortRest } from '../rules';
import { adjacentRestSite, shortRestBlock } from './hudModel';
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
  /** Rest at this site on arrival. */
  restId?: string;
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
  resting = false;
  private shortRests = 0;

  constructor(
    private readonly ctx: SessionCtx,
    private readonly hooks: ExploreHooks,
  ) {}

  /** Monsters that join a fight if one starts at the player's current cell, else null. */
  combatTrigger(at?: GridPos): MonsterState[] | null {
    const { state } = this.ctx;
    const p = at ?? state.player.pos;
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
    const site =
      state.restSites.find((r) => r.id === pick.entityId) ??
      (pick.cell ? state.restSites.find((r) => samePos(r.pos, pick.cell as GridPos)) : undefined);
    if (site) {
      if (isSeen(state, site.pos)) await this.approachRest(site.id);
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
    const best = this.approachCell(chest.pos);
    if (!best) {
      this.ctx.prompt("You can't reach the chest.", 1800);
      return;
    }
    await this.walk({ cell: best.cell, chestId });
  }

  /** The nearest free cell next to `pos` that the hero can walk to, with its path length. */
  approachCell(pos: GridPos): { cell: GridPos; path: GridPos[] } | null {
    const { state } = this.ctx;
    let best: { cell: GridPos; path: GridPos[] } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: pos.x + dx, y: pos.y + dy };
        if ((dx === 0 && dy === 0) || !state.nav.isWalkable(n) || blockedAt(state)(n)) continue;
        const path = samePos(n, state.player.pos) ? [] : state.nav.findPath(state.player.pos, n, { blocked: blockedAt(state) });
        if (path && (!best || path.length < best.path.length)) best = { cell: n, path };
      }
    }
    return best;
  }

  /** Walk next to a rest site and rest there. */
  async approachRest(siteId: string): Promise<void> {
    const { state } = this.ctx;
    const site = state.restSites.find((r) => r.id === siteId);
    if (!site || state.mode !== 'explore') return;
    if (site.used) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt('This site has been used.', 2500);
      return;
    }
    if (!longRestGain(syncFromCreature(state.pc, state.player))) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt('You are already rested.', 2500);
      return;
    }
    if (cellDistance(state.player.pos, site.pos) <= 1) {
      await this.restAt(siteId);
      return;
    }
    const best = this.approachCell(site.pos);
    if (!best) {
      this.ctx.prompt("You can't reach the rest site.", 1800);
      return;
    }
    await this.walk({ cell: best.cell, restId: siteId });
  }

  /** True if walking to the site would not start a fight on the way. */
  restPathSafe(siteId: string): boolean {
    const site = this.ctx.state.restSites.find((r) => r.id === siteId);
    if (!site) return false;
    const best = this.approachCell(site.pos);
    if (!best) return false;
    return [this.ctx.state.player.pos, ...best.path].every((c) => this.combatTrigger(c) === null);
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
    if (arrived?.restId) await this.restAt(arrived.restId);
    this.ctx.hud();
  }

  // --------------------------------------------------------------- chests

  async openChest(chestId: string): Promise<void> {
    const { state, deps } = this.ctx;
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || state.finished) return;
    chest.opened = true;
    const loot = chestLoot(state.depth, state.floorRng.fork(`chest:${chestId}`));
    deps.audio.play('chestOpen');
    deps.audio.play('coins', { delay: 0.45 });
    await this.ctx.guard(deps.renderer.playAnim(chest.id, 'attack', { facing: chest.pos }), 1500);

    const next = syncFromCreature(state.pc, state.player);
    next.gold += loot.gold;
    const names: string[] = [`${loot.gold} gold`];
    for (const it of loot.items) {
      const stack = next.inventory.find((x) => x.itemId === it.itemId);
      if (stack) stack.quantity += it.quantity;
      else next.inventory.push({ ...it });
      names.push(`${it.quantity > 1 ? it.quantity + ' x ' : ''}${getItem(it.itemId)?.name ?? it.itemId}`);
    }
    state.pc = next;
    this.ctx.rebuildPlayer();
    deps.renderer.floatText(chest.id, `+${loot.gold} gold`, 'info');
    if (loot.items.length > 0) deps.renderer.floatText(state.player.pos, 'Potion found', 'heal');
    this.ctx.say(`${state.pc.build.name} opens the chest and finds ${names.join(' and ')}.`);
    this.ctx.hud();
  }

  // ---------------------------------------------------------------- rests

  /** The shortRest intent: a real short rest, anywhere with no enemy in view. */
  async shortRest(): Promise<void> {
    const { state, deps } = this.ctx;
    if (this.resting || this.walking) return;
    if (shortRestBlock(state) !== undefined) return;
    this.resting = true;
    try {
      const before = syncFromCreature(state.pc, state.player);
      const rng = state.floorRng.fork(`short:${this.shortRests++}`);
      const r = takeShortRest(before, rng);
      state.pc = r.pc;
      state.shortRestsLeft -= 1;
      deps.audio.play('rest');
      deps.ui.banner('Short rest');
      await deps.delay(500);
      this.ctx.rebuildPlayer();
      deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
      if (r.healed > 0) deps.renderer.floatText('player', `+${r.healed}`, 'heal');
      const restored = Object.entries(r.pc.resources)
        .filter(([k, p]) => !isHiddenResource(k) && p.current > (before.resources[k]?.current ?? 0))
        .map(([, p]) => p.name);
      const dice = r.hitDiceSpent === 1 ? '1 Hit Die' : `${r.hitDiceSpent} Hit Dice`;
      this.ctx.say(
        `${r.pc.build.name} takes a short rest, spends ${dice} and recovers ${r.healed} HP.${restored.map((n) => ` ${n} restored.`).join('')}`,
      );
    } finally {
      this.resting = false;
    }
    this.ctx.hud();
  }

  /** The longRest intent: long rest at the adjacent site. */
  async longRestHere(): Promise<void> {
    const site = adjacentRestSite(this.ctx.state);
    if (site) await this.restAt(site.id);
  }

  /** Long rest at a site next to the hero (never in combat). Does not consume the site if nothing would be gained. */
  async restAt(siteId: string): Promise<void> {
    const { state, deps } = this.ctx;
    const site = state.restSites.find((r) => r.id === siteId);
    if (!site || state.mode !== 'explore' || state.finished || this.resting) return;
    if (cellDistance(state.player.pos, site.pos) > 1) return;
    if (site.used) {
      deps.audio.play('uiError');
      this.ctx.prompt('This site has been used.', 2500);
      return;
    }
    if (!longRestGain(syncFromCreature(state.pc, state.player))) {
      deps.audio.play('uiError');
      this.ctx.prompt('You are already rested.', 2500);
      return;
    }
    this.resting = true;
    try {
      site.used = true;
      deps.audio.play('rest');
      await this.ctx.guard(deps.renderer.playAnim(site.id, 'cast'), 1500);
      const before = state.player.hp;
      state.pc = longRest(syncFromCreature(state.pc, state.player));
      state.shortRestsLeft = SHORT_RESTS_PER_LONG_REST;
      this.ctx.rebuildPlayer();
      const gained = state.player.hp - before;
      deps.renderer.setEntityState(site.id, { dead: true });
      deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
      if (gained > 0) deps.renderer.floatText('player', `+${gained}`, 'heal');
      this.ctx.say(`${state.pc.build.name} makes camp and is fully restored.`);
    } finally {
      this.resting = false;
    }
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

import type { Rng } from '../core/rng';
import type { Creature, FloorPlan, GridPos, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
import { MONSTERS } from '../data/monsters';
import type { GameDeps } from './deps';
import type { FloorOutcome } from './deps';

export interface MonsterState {
  creature: Creature;
  roomId: number;
  def: MonsterDef | undefined;
  boss: boolean;
}

export interface ChestState {
  id: string;
  pos: GridPos;
  opened: boolean;
}

export interface RestSiteState {
  id: string;
  pos: GridPos;
  used: boolean;
}

export type FloorMode = 'explore' | 'combat';

/** Everything about the floor in play. Plain data, shared by the controllers. */
export interface FloorState {
  runSeed: number;
  depth: number;
  themeName: string;
  plan: FloorPlan;
  nav: NavGrid;
  floorRng: Rng;
  pc: PlayerCharacter;
  player: Creature;
  monsters: MonsterState[];
  chests: ChestState[];
  restSites: RestSiteState[];
  /** The "you spot a safe place to rest" hint has been shown. */
  restSpotted: boolean;
  /** The first-floor explanation of the two rests has been shown. */
  restHintShown: boolean;
  seen: Uint8Array;
  revealAll: boolean;
  shortRestsLeft: number;
  mode: FloorMode;
  stairsOpen: boolean;
  log: string[];
  prompt?: string;
  /** What the HUD target panel shows (hovered or selected creature). */
  targetId: string | null;
  /** HP and liveness as the player has seen them so far (events lag the engine). */
  shownHp: Map<string, number>;
  shownDead: Set<string>;
  shownActive: string | null;
  lastHitBy: string;
  /** The visibility last pushed to the renderer for each entity. */
  entityVisible: Map<string, boolean>;
  finished: boolean;
}

/** What the controllers need from the session. */
export interface SessionCtx {
  deps: GameDeps;
  state: FloorState;
  /** Push a fresh HudModel. */
  hud(): void;
  /** Append a line to the log. */
  say(text: string): void;
  /** Show a prompt in the HUD; it clears itself after `ttlMs` if given. */
  prompt(text: string | undefined, ttlMs?: number): void;
  /** Recompute fog from the player's cell and push it to the renderer. */
  reveal(): void;
  /** Await a renderer promise, but never longer than `ms` (hidden tabs pause animation). */
  guard(p: Promise<unknown>, ms?: number): Promise<void>;
  /** Resolve the floor's outcome. */
  finish(outcome: FloorOutcome): void;
  /** Rebuild the player Creature from the PlayerCharacter (after rests, loot). */
  rebuildPlayer(): void;
}

export function monsterDef(defId: string): MonsterDef | undefined {
  return MONSTERS.find((m) => m.id === defId);
}

export function creatureById(state: FloorState, id: string): Creature | undefined {
  if (id === 'player') return state.player;
  return state.monsters.find((m) => m.creature.id === id)?.creature;
}

export function isSeen(state: FloorState, p: GridPos): boolean {
  return state.revealAll || state.seen[p.y * state.plan.width + p.x] === 1;
}

/** Whether the player can currently see an entity (the player always can). */
export function isEntityVisible(state: FloorState, id: string): boolean {
  if (id === 'player') return true;
  const c = creatureById(state, id);
  if (c) return isSeen(state, c.pos);
  const chest = state.chests.find((ch) => ch.id === id);
  if (chest) return isSeen(state, chest.pos);
  const site = state.restSites.find((r) => r.id === id);
  return site ? isSeen(state, site.pos) : false;
}

export function livingMonsters(state: FloorState): MonsterState[] {
  return state.monsters.filter((m) => !m.creature.dead && m.creature.hp > 0);
}

/** Cells that block walking: living monsters and chests. */
export function blockedAt(state: FloorState): (p: GridPos) => boolean {
  return (p) =>
    state.monsters.some((m) => !m.creature.dead && m.creature.hp > 0 && m.creature.pos.x === p.x && m.creature.pos.y === p.y) ||
    state.chests.some((c) => c.pos.x === p.x && c.pos.y === p.y) ||
    state.restSites.some((r) => r.pos.x === p.x && r.pos.y === p.y);
}

/** Push an entity's visibility to the renderer only when it changed. */
export function setEntityVisible(ctx: SessionCtx, id: string, visible: boolean): void {
  if (ctx.state.entityVisible.get(id) === visible) return;
  ctx.state.entityVisible.set(id, visible);
  ctx.deps.renderer.setEntityState(id, { visible });
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function pushLog(state: FloorState, text: string): void {
  state.log.push(text);
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

import type { Rng } from '../core/rng';
import type { PlayerSkill, PuzzleKind, AnimationSpeed, HelpMode, CompanionDef, CompanionState, Creature, FloorPlan, GridPos, MonsterDef, NavGrid, PlayerCharacter } from '../core/types';
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
  /** The floor boss's hoard (better loot, named in the stairs confirmation). */
  boss?: boolean;
}

export interface RestSiteState {
  id: string;
  pos: GridPos;
  used: boolean;
}

/** The companion on this floor. Its creature is id 'companion', faction 'ally'. */
export interface CompanionRuntime {
  def: CompanionDef;
  /** Persistent state (hit points, uses, stance), synced after every fight and rest. */
  state: CompanionState;
  creature: Creature;
  /** Out of the current fight at 0 HP; revived at 1 HP after it. */
  downed: boolean;
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
  /** The travelling companion, once the hero is level 4 or more and has picked one. */
  companion: CompanionRuntime | null;
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
  /** How fast animations play (the menu's setting): pauses scale with it. */
  speed: AnimationSpeed;
  /** The kinds of lock puzzle met on this floor, newest last (so the next differs). */
  puzzleKinds: PuzzleKind[];
  /** Help level for this floor: 'guided' also shows concept hints and the adviser. */
  help: HelpMode;
  /** Feature ids that took effect this floor (for hints: 'lastStand'). */
  noticed: Set<string>;
  /** Creatures that are down in a pit or lava right now: out of sight until they climb out (or for good). */
  fallen: Set<string>;
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
  /** The player's puzzle rating, and a way to store the updated one. */
  puzzleSkill(): PlayerSkill;
  setPuzzleSkill(skill: PlayerSkill): void;
  /** Offer a one-off hint (it is shown at once if the director allows). */
  hint(def: { id: string; kind: 'control' | 'concept'; text: string; anchor?: import('../core/types').HintRequest['anchor'] }): void;
  /** The cells an area action would cover if aimed at `point` (for the flash of a cone or burst). */
  areaCells?(actionId: string, point: GridPos): GridPos[];
  /** Await a renderer promise, but never longer than `ms` (hidden tabs pause animation). */
  guard(p: Promise<unknown>, ms?: number): Promise<void>;
  /** Resolve the floor's outcome. */
  finish(outcome: FloorOutcome): void;
  /** Rebuild the player Creature from the PlayerCharacter (after rests, loot). */
  rebuildPlayer(): void;
}

/** How much bigger an enlarged creature is drawn (the Enlarge spell: one size category up). */
export const ENLARGE_SCALE = 1.5;
/** How solid an invisible creature of the player's side is drawn (it must stay findable on screen). */
export const UNSEEN_VEIL = 0.35;

/** The model a creature is shown with: its own, or the form it is polymorphed into (the rules keep the true look on a hero between fights). */
export function shownVisual(c: Creature): { visual: Creature['visual']; size: Creature['size'] } {
  const form = c.resources['_polymorph'] ? MONSTERS.find((m) => m.id === c.resources['_polymorph']?.name) : undefined;
  return form ? { visual: { ...form.visual }, size: form.size } : { visual: c.visual, size: c.size };
}

/** Spell effects that show on a creature: Enlarge's size, Greater Invisibility's see-through body, Mirror Image's duplicates. */
export function lookOf(c: Creature): { scale: number; veil: number; images: number } {
  return {
    scale: c.resources['_enlarged'] ? ENLARGE_SCALE : 1,
    veil: c.resources['_unseen'] ? UNSEEN_VEIL : 1,
    images: Math.max(0, c.resources['_mirror']?.current ?? 0),
  };
}

export function monsterDef(defId: string): MonsterDef | undefined {
  return MONSTERS.find((m) => m.id === defId);
}

export function creatureById(state: FloorState, id: string): Creature | undefined {
  if (id === 'player') return state.player;
  if (id === 'companion') return state.companion?.creature;
  return state.monsters.find((m) => m.creature.id === id)?.creature;
}

export function isSeen(state: FloorState, p: GridPos): boolean {
  return state.revealAll || state.seen[p.y * state.plan.width + p.x] === 1;
}

/** Whether the player can currently see an entity (the player always can). */
export function isEntityVisible(state: FloorState, id: string): boolean {
  if (id === 'player' || id === 'companion') return true;
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
  // Walking never stops at the companion (the hero swaps places with it); in a fight it is a body like any other.
  const comp = state.mode === 'combat' && state.companion && !state.companion.downed ? state.companion.creature : null;
  return (p) =>
    (comp !== null && comp.pos.x === p.x && comp.pos.y === p.y) ||
    state.monsters.some((m) => !m.creature.dead && m.creature.hp > 0 && m.creature.pos.x === p.x && m.creature.pos.y === p.y) ||
    state.chests.some((c) => !c.opened && c.pos.x === p.x && c.pos.y === p.y) ||
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

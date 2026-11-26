/**
 * Shared contracts for Twenty Floors.
 *
 * This file is the seam between modules (rules, gen, render, ui, game). It
 * contains types and a few constants only: no logic. Modules import from here
 * and never from each other's internals (see docs/DESIGN.md, "Module map").
 *
 * Do not change this file from inside a module task. If a contract is wrong or
 * missing something, report it; the contract owner updates it for everyone.
 */

// ---------------------------------------------------------------------------
// Grid and world
// ---------------------------------------------------------------------------

/** A cell on the floor grid. `y` is the grid row and maps to world Z. */
export interface GridPos {
  x: number;
  y: number;
}

/** One grid cell is a 5-foot square. All ranges and speeds are in cells. */
export const CELL_FEET = 5;

/** Elevation is stored in integer steps; one step is half a cell (2.5 ft). */
export const ELEVATION_STEP_CELLS = 0.5;

/** Two adjacent cells are connected on foot if their elevations differ by at most this. */
export const MAX_STEP_UP = 1;

export const CellKind = {
  /** Solid rock or out of bounds. Not rendered, blocks movement and sight. */
  Void: 0,
  /** Walkable ground. */
  Floor: 1,
  /** A wall face bordering walkable space. Blocks movement and sight. */
  Wall: 2,
  /** Open pit. Blocks movement, does not block sight. */
  Chasm: 3,
  /** Shallow water. Walkable difficult terrain (costs 2). */
  Water: 4,
  /** Doorway threshold between a room and a passage. Walkable, open. */
  Door: 5,
} as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

export type ThemeId = 'warrens' | 'crypt' | 'depths';

export type RoomRole = 'entrance' | 'combat' | 'treasure' | 'boss' | 'passage';

export interface Room {
  id: number;
  role: RoomRole;
  /** Inclusive bounding box of the room's cells. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** A walkable cell near the middle of the room. */
  center: GridPos;
  /** Ids of rooms directly connected to this one. */
  neighbors: number[];
  /** Steps along the room graph from the entrance room (entrance = 0). */
  distanceFromEntrance: number;
}

export type SpawnRole = 'monster' | 'boss' | 'chest';

/** A candidate position for something to be placed by the encounter builder. */
export interface SpawnSlot {
  pos: GridPos;
  roomId: number;
  role: SpawnRole;
}

export interface PropPlacement {
  /** Prop type key, resolved by the renderer (e.g. 'pillar', 'rubble', 'torch', 'sarcophagus'). */
  type: string;
  pos: GridPos;
  /** Rotation around the vertical axis, in quarter turns (0..3). */
  rotation: number;
  /** True if the prop occupies its cell (the cell is then not walkable). */
  blocking: boolean;
}

export interface LightPlacement {
  pos: GridPos;
  /** 0xRRGGBB */
  color: number;
  /** Relative brightness, about 0.5 to 2. */
  intensity: number;
  /** Radius in cells. */
  radius: number;
}

/**
 * A generated dungeon floor. Fully determined by (seed, depth, theme), so save
 * games store only those and regenerate the plan.
 *
 * Per-cell arrays are row-major: index = y * width + x.
 */
export interface FloorPlan {
  seed: number;
  /** 1-based floor number (1..20). */
  depth: number;
  theme: ThemeId;
  width: number;
  height: number;
  /** CellKind per cell. */
  kinds: Uint8Array;
  /** Elevation step per cell (meaningful for non-Void cells). */
  elevation: Int8Array;
  /** Room id per cell, or -1 for cells that belong to no room. */
  roomIds: Int16Array;
  rooms: Room[];
  /** Where the player arrives. Always walkable, in the 'entrance' room. */
  entrance: GridPos;
  /** The stairs down. Always walkable, in or beyond the 'boss' room. */
  exit: GridPos;
  spawns: SpawnSlot[];
  props: PropPlacement[];
  lights: LightPlacement[];
}

/** Movement and sight queries over a floor. Implemented in src/gen/nav.ts. */
export interface NavGrid {
  readonly width: number;
  readonly height: number;
  inBounds(p: GridPos): boolean;
  /** True if a creature can stand here (ignores other creatures). */
  isWalkable(p: GridPos): boolean;
  /**
   * Cost in movement cells to step between two adjacent cells (8-way), or
   * Infinity if the step is not allowed (blocked, too steep, or a diagonal
   * that would cut a wall corner). Entering Water costs 2, otherwise 1.
   */
  stepCost(from: GridPos, to: GridPos): number;
  /** True if sight is unobstructed between the centers of two cells. Props never block sight. */
  hasLineOfSight(a: GridPos, b: GridPos): boolean;
  /** Elevation step at a cell. */
  elevationAt(p: GridPos): number;
  /**
   * Cheapest path from `from` to `to`, excluding `from` and including `to`,
   * or null if unreachable. `blocked` marks cells that cannot be entered
   * (typically other creatures).
   */
  findPath(
    from: GridPos,
    to: GridPos,
    opts?: { blocked?: (p: GridPos) => boolean; maxCost?: number },
  ): GridPos[] | null;
  /** All cells reachable from `from` within `budget` movement, with their cost. */
  reachable(
    from: GridPos,
    budget: number,
    opts?: { blocked?: (p: GridPos) => boolean },
  ): ReachableCell[];
}

export interface ReachableCell {
  pos: GridPos;
  cost: number;
}

// ---------------------------------------------------------------------------
// Rules: creatures, actions, conditions
// ---------------------------------------------------------------------------

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type AbilityScores = Record<Ability, number>;

export type DamageType =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder';

export type Condition =
  | 'blinded'
  | 'charmed'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'
  /** Took the Dodge action: attacks against it have disadvantage until its next turn. */
  | 'dodging'
  /** Took the Disengage action: its movement provokes no opportunity attacks this turn. */
  | 'disengaged';

export type Size = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export type Faction = 'player' | 'ally' | 'enemy';
export type ActionCost = 'action' | 'bonus' | 'reaction' | 'free';

export type Skill =
  | 'acrobatics'
  | 'animalHandling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleightOfHand'
  | 'stealth'
  | 'survival';

/** Dice notation: "1d8", "2d6+3", "1d4-1", or a flat number as a string ("5"). */
export type Dice = string;

export interface DamagePart {
  dice: Dice;
  type: DamageType;
}

export type Targeting =
  | { kind: 'self' }
  | {
      kind: 'creature';
      /** True for melee (uses reach); false for ranged. */
      melee: boolean;
      /** Reach or normal range, in cells. */
      range: number;
      /** Long range in cells (attacks beyond `range` have disadvantage). */
      longRange?: number;
      /** True if the action targets allies/self rather than enemies. */
      friendly?: boolean;
    }
  | {
      kind: 'point';
      /** How far away the origin point can be, in cells (0 = centered on self). */
      range: number;
      area: { shape: 'sphere' | 'cone' | 'line'; size: number };
    };

/**
 * A data-driven action: everything a creature can do on its turn. All bonuses
 * and DCs are final numbers. For monsters they come straight from the stat
 * block; for the player the rules engine derives them from the character sheet.
 */
export interface ActionDef {
  id: string;
  name: string;
  /** One or two sentences shown in the tooltip. */
  description: string;
  /** Icon key for the action bar (the UI falls back to a generic glyph). */
  icon?: string;
  cost: ActionCost;
  targeting: Targeting;
  /** Attack roll against AC with this total bonus. */
  attack?: { bonus: number };
  /** Targets make a saving throw instead of (or after) the attack roll. */
  save?: { ability: Ability; dc: number; halfOnSave: boolean };
  damage?: DamagePart[];
  heal?: Dice;
  /** Condition applied on a hit or failed save. */
  applies?: {
    condition: Condition;
    /** Rounds it lasts; omitted means until removed. */
    rounds?: number;
    /** If set, the target repeats this save at the end of each of its turns to end it. */
    saveEnds?: { ability: Ability; dc: number };
  };
  /** Consumes this much of a named resource pool on the creature. */
  uses?: { resource: string; amount: number };
  /** Monster recharge: usable again when a d6 rolled at turn start is >= this. */
  recharge?: number;
  /** Execute these other action ids in order (monster Multiattack). */
  multiattack?: string[];
  /**
   * Ids of special effects implemented in code by the rules engine, for
   * anything the fields above cannot express (e.g. 'dash', 'disengage',
   * 'dodge', 'secondWind', 'actionSurge').
   */
  effects?: string[];
}

export interface ActiveCondition {
  condition: Condition;
  /** Remaining rounds, or null for indefinite. */
  rounds: number | null;
  sourceId?: string;
  saveEnds?: { ability: Ability; dc: number };
}

export interface ResourcePool {
  /**
   * Display name, e.g. "Second Wind". Pools whose KEY starts with '_' are
   * internal engine flags and must never be shown to the player.
   */
  name: string;
  current: number;
  max: number;
  /** When it refills. 'floor' means only on entering a new floor. */
  refresh: 'shortRest' | 'longRest' | 'floor';
}

/** How a creature looks. Resolved by the renderer through the asset manifest. */
export interface VisualSpec {
  /** Model key in the asset manifest (e.g. 'skeleton_warrior'). Unknown keys get a procedural stand-in. */
  model: string;
  /** Uniform scale multiplier on top of the model's own scale. */
  scale?: number;
  /** 0xRRGGBB tint multiplied into the model's colors. */
  tint?: number;
}

/**
 * Trait ids the rules engine knows how to apply. Data may only use ids from
 * this list; add to the list (and the engine) together.
 */
export type TraitId =
  | 'packTactics'
  | 'undeadFortitude'
  | 'sunlightSensitivity'
  | 'nimbleEscape'
  | 'aggressive'
  | 'spiderClimb'
  | 'amorphous'
  | 'keenSenses';

/** A creature in play: the player, an ally or a monster. Plain JSON-serializable data. */
export interface Creature {
  /** Unique within a floor. The player's id is always 'player'. */
  id: string;
  /** MonsterDef id, or the class id for the player. */
  defId: string;
  name: string;
  faction: Faction;
  pos: GridPos;
  size: Size;
  /** Character level for the player; challenge rating for monsters. */
  level: number;
  abilities: AbilityScores;
  proficiencyBonus: number;
  saveProficiencies: Ability[];
  ac: number;
  maxHp: number;
  hp: number;
  tempHp: number;
  /** Walking speed in cells per turn. */
  speed: number;
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  conditionImmunities: Condition[];
  conditions: ActiveCondition[];
  traits: TraitId[];
  actions: ActionDef[];
  resources: Record<string, ResourcePool>;
  visual: VisualSpec;
  dead: boolean;
}

// ---------------------------------------------------------------------------
// Rules: static data definitions
// ---------------------------------------------------------------------------

export type CreatureType =
  | 'aberration'
  | 'beast'
  | 'celestial'
  | 'construct'
  | 'dragon'
  | 'elemental'
  | 'fey'
  | 'fiend'
  | 'giant'
  | 'humanoid'
  | 'monstrosity'
  | 'ooze'
  | 'plant'
  | 'undead';

/** How the encounter builder uses a monster. */
export type MonsterRole = 'minion' | 'standard' | 'elite' | 'boss';

/** A monster stat block, transcribed from SRD 5.2 into game units. */
export interface MonsterDef {
  id: string;
  name: string;
  size: Size;
  type: CreatureType;
  /** Challenge rating as a number (1/8 = 0.125, 1/4 = 0.25, 1/2 = 0.5). */
  cr: number;
  xp: number;
  ac: number;
  /** Average hit points from the stat block. */
  hp: number;
  /** Hit dice expression from the stat block, e.g. "2d8+4". */
  hpDice: Dice;
  /** Walking speed in feet, as printed. */
  speedFt: number;
  abilities: AbilityScores;
  proficiencyBonus: number;
  saveProficiencies: Ability[];
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  conditionImmunities: Condition[];
  traits: TraitId[];
  /** Ranges in cells (5 ft = 1). Attack bonuses and DCs as printed. */
  actions: ActionDef[];
  visual: VisualSpec;
  /** Themes whose encounter tables include this monster. */
  themes: ThemeId[];
  role: MonsterRole;
  /** One sentence of flavor for the inspect panel. */
  description: string;
}

export type WeaponProperty =
  | 'finesse'
  | 'light'
  | 'heavy'
  | 'twoHanded'
  | 'versatile'
  | 'reach'
  | 'thrown'
  | 'ammunition'
  | 'loading';

export interface ItemDef {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'shield' | 'consumable';
  description: string;
  /** Price in gold pieces. */
  cost: number;
  icon?: string;
  weapon?: {
    category: 'simple' | 'martial';
    melee: boolean;
    damage: DamagePart;
    /** Two-handed damage dice for versatile weapons. */
    versatileDice?: Dice;
    properties: WeaponProperty[];
    /** Normal and long range in cells, for ranged and thrown weapons. */
    range?: { normal: number; long: number };
  };
  armor?: {
    category: 'light' | 'medium' | 'heavy';
    baseAc: number;
    /** Maximum Dexterity modifier added to AC; omitted = unlimited; 0 = none. */
    dexCap?: number;
    strRequirement?: number;
  };
  /** AC bonus for shields. */
  shieldBonus?: number;
  consumable?: {
    /** Effect id handled by the rules engine. */
    effect: 'heal';
    dice: Dice;
  };
}

// ---------------------------------------------------------------------------
// Rules: character creation and the persistent character sheet
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  id: string;
  name: string;
  description: string;
}

/** A named choice the player makes at creation or on level up (e.g. Fighting Style). */
export interface ChoiceSlot {
  /** Key stored in CharacterBuild.choices. */
  key: string;
  name: string;
  options: ChoiceOption[];
}

export interface SpeciesInfo {
  id: string;
  name: string;
  description: string;
  /** Short bullet lines describing traits, for the creation screen. */
  traitSummaries: string[];
  visual: VisualSpec;
}

export interface ClassInfo {
  id: string;
  name: string;
  description: string;
  hitDie: number;
  primaryAbilities: Ability[];
  /** Short bullet lines describing level-1 features. */
  featureSummaries: string[];
  /** How many skills to pick, and from which list. */
  skillChoices: { count: number; from: Skill[] };
  /** Choices made at level 1. */
  choices: ChoiceSlot[];
  /** Suggested standard-array assignment, used by the "Quick build" button. */
  recommendedAbilities: AbilityScores;
}

export interface BackgroundInfo {
  id: string;
  name: string;
  description: string;
  /** The three abilities this background can raise (+2/+1 or +1/+1/+1). */
  abilityOptions: Ability[];
  skills: Skill[];
}

/** Everything the creation screen needs. Produced by the rules engine. */
export interface CreationOptions {
  species: SpeciesInfo[];
  classes: ClassInfo[];
  backgrounds: BackgroundInfo[];
  standardArray: number[];
  pointBuy: { budget: number; min: number; max: number; costs: Record<number, number> };
}

/** The player's creation decisions. Validated by the rules engine. */
export interface CharacterBuild {
  name: string;
  speciesId: string;
  classId: string;
  backgroundId: string;
  /** Base scores before background increases. */
  baseAbilities: AbilityScores;
  /** Increases from the background; values sum to 3, each 0..2. */
  abilityIncreases: Partial<Record<Ability, number>>;
  skills: Skill[];
  /** ChoiceSlot.key -> ChoiceOption.id, accumulated across levels. */
  choices: Record<string, string>;
}

export interface ItemStack {
  itemId: string;
  quantity: number;
}

/** The persistent player character. Plain JSON; stored in the save game. */
export interface PlayerCharacter {
  build: CharacterBuild;
  level: number;
  maxHp: number;
  hp: number;
  resources: Record<string, ResourcePool>;
  inventory: ItemStack[];
  equipped: { mainHand?: string; offHand?: string; armor?: string };
  gold: number;
}

/** What the level-up screen shows and asks for. Produced by the rules engine. */
export interface LevelUpPreview {
  fromLevel: number;
  toLevel: number;
  hpGain: number;
  /** Short lines describing new features. */
  featureSummaries: string[];
  /** New choices to make at this level (may be empty). */
  choices: ChoiceSlot[];
}

export interface SaveGame {
  version: 1;
  runSeed: number;
  /** The floor the player is on (the save is taken at its entrance). */
  depth: number;
  character: PlayerCharacter;
  /** Short rests left on the current floor. */
  shortRestsLeft: number;
}

// ---------------------------------------------------------------------------
// Rules: combat
// ---------------------------------------------------------------------------

export interface TurnState {
  creatureId: string;
  /** Movement left this turn, in cells. */
  movementLeft: number;
  actionUsed: boolean;
  bonusUsed: boolean;
}

export type Command =
  /** Walk along a path of adjacent cells (as returned by NavGrid.findPath). */
  | { type: 'move'; path: GridPos[] }
  | { type: 'action'; actionId: string; targetId?: string; point?: GridPos }
  | { type: 'endTurn' };

export type AttackOutcome = 'crit' | 'hit' | 'miss' | 'fumble';

/**
 * Everything that happens in combat is reported as an ordered list of events.
 * The game layer plays them back as animations, floating text and log lines.
 */
export type GameEvent =
  | { type: 'combatStart'; order: string[] }
  | { type: 'roundStart'; round: number }
  | { type: 'turnStart'; creatureId: string }
  | { type: 'turnEnd'; creatureId: string }
  | { type: 'move'; creatureId: string; path: GridPos[] }
  | { type: 'actionUsed'; creatureId: string; actionId: string; name: string; targetId?: string; point?: GridPos }
  | {
      type: 'attackRoll';
      attackerId: string;
      targetId: string;
      actionName: string;
      /** The d20 result that counted. */
      d20: number;
      /** Both dice when rolled with advantage or disadvantage. */
      dice: number[];
      mode: 'normal' | 'advantage' | 'disadvantage';
      bonus: number;
      total: number;
      targetAc: number;
      outcome: AttackOutcome;
      /** True for opportunity attacks and other reactions. */
      reaction: boolean;
    }
  | {
      type: 'saveRoll';
      creatureId: string;
      ability: Ability;
      d20: number;
      bonus: number;
      total: number;
      dc: number;
      success: boolean;
    }
  | {
      type: 'damage';
      targetId: string;
      sourceId?: string;
      amount: number;
      damageType: DamageType;
      modifier: 'none' | 'resisted' | 'vulnerable' | 'immune';
      crit: boolean;
      hpAfter: number;
    }
  | { type: 'heal'; targetId: string; amount: number; hpAfter: number }
  | { type: 'conditionAdded'; creatureId: string; condition: Condition }
  | { type: 'conditionRemoved'; creatureId: string; condition: Condition }
  | { type: 'death'; creatureId: string }
  | { type: 'combatEnd'; winner: Faction }
  /** Anything else worth telling the player (trait triggers, recharge, etc.). */
  | { type: 'log'; text: string };

/**
 * A running fight. Created by the rules engine from the creatures involved and
 * a NavGrid. Mutates the Creature objects it was given.
 */
export interface CombatApi {
  readonly round: number;
  /** Creature ids in initiative order (dead creatures stay in the list). */
  readonly order: readonly string[];
  /** Whose turn it is. */
  readonly activeId: string;
  readonly turn: Readonly<TurnState>;
  readonly isOver: boolean;
  readonly winner: Faction | null;
  /** Events from rolling initiative and starting the first turn. Call once. */
  begin(): GameEvent[];
  creature(id: string): Creature | undefined;
  creatures(): Creature[];
  /** Cells the active creature can still walk to this turn (includes its own cell at cost 0). */
  reachable(): ReachableCell[];
  /**
   * Every action the active creature has right now: its `actions` plus any
   * generated on the fly (e.g. Break Free while restrained). Includes actions
   * that currently fail `canUse`; the HUD shows those disabled.
   */
  availableActions(): ActionDef[];
  /** Whether the active creature can use this action right now, and why not. */
  canUse(actionId: string): { ok: boolean; reason?: string };
  /** Ids of creatures the active creature could legally target with this action from where it stands. */
  validTargets(actionId: string): string[];
  /** Chance (0..1) that this attack hits, or that the target fails the save; null if not applicable. */
  hitChance(actionId: string, targetId: string): number | null;
  /** Cells covered by an area action if aimed at `point`. */
  areaCells(actionId: string, point: GridPos): GridPos[];
  /**
   * Apply a command for the active creature. Returns the resulting events,
   * including the start of the next turn after 'endTurn'. Throws on an
   * illegal command.
   */
  execute(command: Command): GameEvent[];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type AnimName = 'idle' | 'walk' | 'attack' | 'hit' | 'death' | 'cast';

export interface ModelEntry {
  /** URL relative to the site root, e.g. 'assets/models/skeleton_warrior.glb'. */
  url: string;
  /** Scale that makes a Medium creature about 1.8 world units tall. */
  scale?: number;
  /** Extra rotation in radians so the model faces +Z. */
  rotationY?: number;
  /** Our animation names mapped to clip names inside the file. */
  animations?: Partial<Record<AnimName, string>>;
}

/** public/assets/manifest.json */
export interface AssetManifest {
  models: Record<string, ModelEntry>;
}

export type HighlightStyle = 'move' | 'path' | 'target' | 'area' | 'danger';

export interface CellHighlight {
  pos: GridPos;
  style: HighlightStyle;
}

export type FloatTextStyle = 'damage' | 'crit' | 'heal' | 'miss' | 'info';

export interface PickResult {
  /** The grid cell under the pointer, or null if it missed the floor. */
  cell: GridPos | null;
  /** The entity under the pointer, if any. */
  entityId: string | null;
}

export type QualityLevel = 'low' | 'medium' | 'high';

/** The 3D view. Implemented in src/render. Knows nothing about rules. */
export interface Renderer3D {
  /** Build the scene for a floor, replacing any previous floor. */
  loadFloor(plan: FloorPlan): Promise<void>;
  /**
   * Every creature occupies exactly one cell in this milestone, whatever its
   * Size: the entity is centred on `pos` and Size only affects how big it is drawn.
   */
  spawnEntity(id: string, visual: VisualSpec, pos: GridPos, opts: { faction: Faction; size: Size }): void;
  removeEntity(id: string): void;
  /** Animate an entity along a path; resolves when it arrives. */
  moveEntity(id: string, path: GridPos[]): Promise<void>;
  /** Teleport without animation. */
  placeEntity(id: string, pos: GridPos): void;
  /** Play a one-shot animation, optionally turning to face a cell first; resolves when done. */
  playAnim(id: string, anim: AnimName, opts?: { facing?: GridPos }): Promise<void>;
  setEntityState(
    id: string,
    state: { selected?: boolean; targetable?: boolean; hpFraction?: number; dead?: boolean; visible?: boolean },
  ): void;
  /** Rising text above an entity or cell. */
  floatText(at: string | GridPos, text: string, style: FloatTextStyle): void;
  /** Replace all cell highlights. Pass [] to clear. */
  setHighlights(cells: CellHighlight[]): void;
  /** Fog of war: one byte per cell, 0 = unseen, 1 = seen. Same indexing as FloorPlan.kinds. */
  setRevealed(mask: Uint8Array): void;
  /** Move the camera target to a cell. */
  focusCamera(pos: GridPos, opts?: { instant?: boolean }): void;
  /** If set, the camera keeps following this entity. Null to stop. */
  followEntity(id: string | null): void;
  /** Tap or click on the 3D view (not fired for drags or UI clicks). */
  onPick(cb: (pick: PickResult) => void): void;
  /** Pointer hover (mouse only); fires when the hovered cell or entity changes. */
  onHover(cb: (pick: PickResult) => void): void;
  setQuality(level: QualityLevel): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export interface HudAction {
  id: string;
  name: string;
  description: string;
  icon?: string;
  cost: ActionCost;
  enabled: boolean;
  /** Why it is disabled, for the tooltip. */
  disabledReason?: string;
  /** True while the player is choosing a target for it. */
  selected: boolean;
  /** Remaining uses, when the action draws on a resource. */
  usesLeft?: number;
}

export interface HudInitiativeEntry {
  id: string;
  name: string;
  faction: Faction;
  hpFraction: number;
  active: boolean;
  dead: boolean;
}

/** A complete snapshot of what the HUD shows. The game layer rebuilds and pushes it on every change. */
export interface HudModel {
  mode: 'explore' | 'combat';
  floor: { depth: number; themeName: string };
  player: {
    name: string;
    level: number;
    className: string;
    hp: number;
    maxHp: number;
    tempHp: number;
    ac: number;
    conditions: Condition[];
    resources: { name: string; current: number; max: number }[];
  };
  /** Present in combat only. */
  combat?: {
    round: number;
    playerTurn: boolean;
    movementLeft: number;
    speed: number;
    actionAvailable: boolean;
    bonusAvailable: boolean;
    initiative: HudInitiativeEntry[];
  };
  actions: HudAction[];
  /** Info on the hovered or selected creature. */
  target?: {
    name: string;
    hp: number;
    maxHp: number;
    ac: number;
    conditions: Condition[];
    description?: string;
    /** 0..1 hit chance with the selected action, if one is selected. */
    hitChance?: number;
  };
  /** Newest last. The HUD shows the tail. */
  log: string[];
  /** One-line contextual hint, e.g. "Choose a target" or "The stairs are sealed". */
  prompt?: string;
  shortRestsLeft: number;
  /** True when the short rest button should be usable (exploring, not at full health/resources). */
  canShortRest: boolean;
}

export type UiIntent =
  | { type: 'selectAction'; actionId: string }
  | { type: 'cancel' }
  | { type: 'endTurn' }
  | { type: 'shortRest' }
  | { type: 'openMenu' }
  | { type: 'selectCreature'; creatureId: string };

export interface HubShopEntry {
  item: ItemDef;
  price: number;
  affordable: boolean;
}

/** What the between-floors hub shows. */
export interface HubModel {
  /** The floor about to be entered. */
  nextDepth: number;
  nextThemeName: string;
  /**
   * `character.inventory` lists everything owned, including equipped items
   * (which are also named in `character.equipped`).
   */
  character: PlayerCharacter;
  /** Definitions for every item id in the character's inventory and equipment. */
  items: Record<string, ItemDef>;
  characterSummary: { name: string; className: string; speciesName: string; ac: number };
  /** Present when the character has a level to take. */
  levelUp?: LevelUpPreview;
  shop: HubShopEntry[];
}

export type HubIntent =
  | { type: 'confirmLevelUp'; choices: Record<string, string> }
  | { type: 'buy'; itemId: string }
  | { type: 'equip'; itemId: string }
  | { type: 'descend' };

/**
 * The DOM overlay. Implemented in src/ui. Pure presentation: it renders the
 * models it is given and reports intents. It never imports rules or render.
 */
export interface GameUi {
  showTitle(opts: { hasSave: boolean }): Promise<'new' | 'continue'>;
  showCreation(options: CreationOptions): Promise<CharacterBuild>;
  /** Show the HUD (idempotent) and update it. */
  setHud(model: HudModel): void;
  hideHud(): void;
  onIntent(cb: (intent: UiIntent) => void): void;
  /** Show the hub; `onIntent` is called for each action and returns the updated model. Resolves on 'descend'. */
  showHub(model: HubModel, onIntent: (intent: HubIntent) => HubModel): Promise<void>;
  showDeath(info: { depth: number; killedBy: string }): Promise<'retry' | 'quit'>;
  showVictory(info: { floorsCleared: number }): Promise<void>;
  /** Brief centered banner, e.g. "Floor 2: The Forgotten Crypt" or "Combat!". */
  banner(text: string, subtext?: string): void;
  /** Full-screen loading veil with a message; call with null to hide. */
  setLoading(message: string | null): void;
  /**
   * The pause menu (opened by the game on the 'openMenu' intent). Resolves
   * when the player picks something: resume, a new quality level, or abandon
   * the run (after an in-menu confirmation).
   */
  showMenu(state: { quality: QualityLevel; depth: number; muted?: boolean }): Promise<MenuResult>;
}

export type MenuResult =
  | { type: 'resume' }
  | { type: 'quality'; level: QualityLevel }
  /** The player toggled sound; `muted` is the new state. */
  | { type: 'sound'; muted: boolean }
  | { type: 'abandon' };

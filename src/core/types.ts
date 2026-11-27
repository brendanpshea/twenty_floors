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

export type ThemeId = 'warrens' | 'crypt' | 'depths' | 'sewers' | 'fungal' | 'hold' | 'library' | 'foundry' | 'ice' | 'ruin' | 'hell' | 'lair' | 'forest' | 'marsh' | 'peaks';

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
  /**
   * For rooms with monsters: the name of the formation its spawn slots are
   * laid out in (e.g. 'shieldWall', 'ambush', 'snipers', 'camp', 'throne').
   */
  formation?: string;
}

export type SpawnRole = 'monster' | 'boss' | 'chest';

/** A candidate position for something to be placed by the encounter builder. */
export interface SpawnSlot {
  pos: GridPos;
  roomId: number;
  role: SpawnRole;
  /** For monster and boss slots: the part this position plays in the room's formation. */
  post?: SpawnPost;
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
  /** What this floor's Chasm cells are: an open drop (default) or lava. */
  chasmHazard?: 'fall' | 'lava';
  /** What this floor's Water cells are: shallow water (default) or ice. */
  waterHazard?: 'water' | 'ice';
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
  /**
   * Safe rest sites: the only places the hero can take a LONG rest (full
   * heal), each usable once. Exactly two per floor, in order along the route: the first
   * about midway along the main path, the second on the approach to the boss
   * room. Each is a walkable, non-Door cell with no prop and no spawn slot, in
   * a spot no monster starts near (a passage alcove or a monster-free nook),
   * reachable from the entrance without passing through the boss room. The
   * game places a 'rest_site' entity on the cell (so the cell itself becomes
   * occupied); the hero rests from an adjacent cell.
   */
  restSpots: GridPos[];
}

/**
 * What a cell does to a creature. 'fall': a pit or open drop; a creature
 * forced into it takes falling damage and climbs back out at the edge.
 * 'lava': the same, as fire damage. 'water': shallow water, difficult
 * terrain. 'ice': slippery; a creature pushed across it slides one cell
 * further.
 */
export type Hazard = 'none' | 'fall' | 'lava' | 'water' | 'ice';

/** Where a formation wants a monster to stand, used to match monsters to spawn slots by tactic. */
export type SpawnPost =
  /** Holding the line between the entrance and the rest. */
  | 'front'
  /** Behind the line, with a view of the approach. */
  | 'back'
  /** Off to a side, to come at intruders from an angle. */
  | 'flank'
  /** On a ledge, dais or far side of a gap. */
  | 'high'
  /** Out of sight from the doorways until intruders are close. */
  | 'hidden'
  /** Beside a doorway, bridge end or other chokepoint. */
  | 'guard'
  /** Next to the boss or the room's centrepiece. */
  | 'escort';

/** How a monster fights; decides its post in a formation and its behaviour. */
export type MonsterTactic =
  /** Walks up and hits hard; shoves enemies into hazards when it can. */
  | 'brute'
  /** Fast and evasive: flanks, strikes and withdraws. */
  | 'skirmisher'
  /** Keeps its distance, uses cover and high ground. */
  | 'archer'
  /** Spells and area effects from the back. */
  | 'caster'
  /** Stays behind its guards and directs; dangerous when cornered. */
  | 'leader'
  /** Waits unseen and ambushes. */
  | 'lurker'
  /** Holds a chokepoint and does not chase far. */
  | 'guard';

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
  /** The hazard a cell is, for any in-bounds cell (walkable or not). */
  hazardAt(p: GridPos): Hazard;
  /**
   * Cover a creature at `target` has against an attack from `attacker`, as
   * the SRD's bonus to Armor Class and Dexterity saves: 0 (none), 2 (half
   * cover: a blocking prop or a wall corner partly in the way) or 5
   * (three-quarters cover). Only meaningful when there is line of sight.
   */
  coverBetween(attacker: GridPos, target: GridPos): 0 | 2 | 5;
  /**
   * Whether the cell holds something that hurts a creature thrown against it:
   * 'fire' (a campfire, brazier, forge) or 'spikes' (stalagmites, ice spikes,
   * crystals, a weapon rack, a palisade). Such cells are not walkable; a
   * creature pushed into one stops short and takes damage.
   */
  obstacleAt?(p: GridPos): 'none' | 'fire' | 'spikes';
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
  /** How it fights. When omitted the rules engine infers it from the stat block. */
  tactic?: MonsterTactic;
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

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'veryRare' | 'legendary';

/** Where a worn magic item goes. A character has one of each, and two rings ('ring' items fill either). */
export type WornSlot = 'head' | 'neck' | 'cloak' | 'hands' | 'wrists' | 'belt' | 'feet' | 'ring';

/** How many attuned items a character can benefit from at once (SRD). */
export const ATTUNEMENT_LIMIT = 3;

/**
 * A lasting effect of an equipped (and, where required, attuned) item. Items
 * are built from these so that most need no code of their own.
 */
export type PassiveEffect =
  /** Bonus to Armor Class (Ring of Protection, Cloak of Protection). */
  | { type: 'acBonus'; amount: number }
  /** Bonus to AC only while wearing no armor and no shield (Bracers of Defense). */
  | { type: 'unarmoredAcBonus'; amount: number }
  /** Bonus to all saving throws. */
  | { type: 'saveBonus'; amount: number }
  /** The ability score becomes this value if it is lower (Gauntlets of Ogre Power: Strength 19). */
  | { type: 'setAbility'; ability: Ability; score: number }
  /** The ability score rises by this amount, up to `max` (default 20). */
  | { type: 'abilityBonus'; ability: Ability; amount: number; max?: number }
  | { type: 'resistance'; damageType: DamageType }
  | { type: 'immunity'; damageType: DamageType }
  | { type: 'conditionImmunity'; condition: Condition }
  /** Extra walking speed, in cells. */
  | { type: 'speedBonus'; cells: number }
  | { type: 'maxHpBonus'; flat?: number; perLevel?: number }
  | { type: 'initiativeAdvantage' }
  /** Critical hits against the wearer count as normal hits (Adamantine Armor). */
  | { type: 'critImmunity' }
  /** The wearer ignores this hazard: no damage from falls, no prone in water, no sliding on ice, and so on. */
  | { type: 'ignoreHazard'; hazard: 'fall' | 'lava' | 'water' | 'ice' | 'fire' | 'spikes' }
  /** Attack rolls against the wearer have disadvantage until the wearer is hit; it returns at the start of the wearer's turn (Cloak of Displacement). */
  | { type: 'displacement' }
  /** Hit Dice spent on a short rest heal twice as much (Periapt of Wound Closure). */
  | { type: 'doubleHitDiceHealing' }
  /** Regain this many hit points at the start of each of the wearer's turns while above 0 (keep it small). */
  | { type: 'regeneration'; amount: number }
  /** On a weapon: extra damage on every hit, optionally only against some creature types (Flame Tongue; Dragon Slayer). */
  | { type: 'weaponDamage'; dice: Dice; damageType?: DamageType; versus?: CreatureType[] }
  /** On a weapon: extra dice on a critical hit (Vicious Weapon). */
  | { type: 'weaponCritDamage'; dice: Dice; damageType?: DamageType }
  /** On a weapon: a different critical range (crits on `from` or higher). */
  | { type: 'critRange'; from: number }
  /** Walking speed multiplied (Haste: 2). */
  | { type: 'speedMultiplier'; factor: number }
  /** Advantage on saving throws of one ability (Haste: Dexterity; Enlarge: Strength). */
  | { type: 'saveAdvantage'; ability: Ability }
  /** One more weapon attack each turn (Haste). */
  | { type: 'extraAttack' }
  /** Extra dice on every weapon hit, of the weapon's damage type (Enlarge: 1d4). */
  | { type: 'bonusWeaponDice'; dice: Dice }
  /** The creature is drawn larger (Enlarge). Space and reach do not change. */
  | { type: 'sizeUp' }
  /** Armor Class cannot be lower than this (Barkskin: 17). */
  | { type: 'minimumAc'; ac: number }
  /** A creature that hits the bearer with a melee attack takes this damage (Fire Shield). */
  | { type: 'retaliate'; dice: Dice; damageType: DamageType }
  /** The Bless spell: 1d4 added to every attack roll and saving throw. */
  | { type: 'bless' }
  /** Temporary hit points gained once, when the effect starts (a potion of False Life or Heroism). */
  | { type: 'tempHp'; amount: number }
  /** The Blur spell: attack rolls against the bearer have disadvantage. */
  | { type: 'attackersDisadvantage' }
  /** Protection from Evil and Good: attack rolls by creatures of these types against the bearer have disadvantage. */
  | { type: 'wardVersus'; versus: CreatureType[] }
  /** Extra Armor Class against ranged attack rolls only (Arrow-Catching Shield). */
  | { type: 'rangedAcBonus'; amount: number }
  /**
   * A ranged attack aimed at an ally within `cells` of the bearer is aimed at the bearer instead. `reaction`: it costs the
   * bearer's reaction (Arrow-Catching Shield); otherwise it always happens (the curse of the Shield of Missile Attraction).
   * `weaponOnly`: ranged weapon attacks only, not spell attacks.
   */
  | { type: 'interceptRanged'; cells: number; reaction: boolean; weaponOnly: boolean }
  /** Half damage from ranged weapon attacks (Shield of Missile Attraction). */
  | { type: 'rangedWeaponResistance' }
  /** Advantage on saving throws against spells and magical effects; spell attack rolls against the bearer have disadvantage (Spellguard Shield). */
  | { type: 'spellWard' }
  /** On a shield: it floats beside the bearer, so a two-handed weapon can be used with it (Animated Shield). */
  | { type: 'handsFree' }
  /** The item lets its bearer cast a spell from src/data/spells.ts with charges that return on a long rest (wands, staffs). */
  | { type: 'castSpell'; spellId: string; charges: number; saveDc?: number; attackBonus?: number }
  /** Narrow flight: crosses pits, lava and water freely, cannot end a move over a pit or lava, cannot be pushed into one. */
  | { type: 'flight' };

/**
 * A passing effect on the hero (a potion, a scroll). Durations are counted in
 * fights: "one minute" or "ten minutes" is 1 fight, "one hour" is 3.
 */
export interface TimedEffect {
  id: string;
  name: string;
  passives: PassiveEffect[];
  fightsLeft: number;
  /** Narrow flight while it lasts. */
  hover?: boolean;
}

/** Stacks the hero can use straight from the action bar. */
export const QUICK_SLOTS = 4;

export type WeaponMastery = 'cleave' | 'graze' | 'nick' | 'push' | 'sap' | 'slow' | 'topple' | 'vex';

export interface ItemDef {
  id: string;
  name: string;
  /** 'wondrous' covers worn magic items (rings, cloaks, belts...) and wands. */
  kind: 'weapon' | 'armor' | 'shield' | 'consumable' | 'wondrous';
  description: string;
  /** Price in gold pieces. */
  cost: number;
  icon?: string;
  /**
   * Magic enhancement, 1 to 3. On a weapon it adds to attack and damage rolls;
   * on armor or a shield it adds to Armor Class. Absent on mundane items.
   */
  magicBonus?: number;
  rarity?: ItemRarity;
  /** For a magic variant, the id of the mundane item it is based on. */
  baseId?: string;
  /** For 'wondrous' items: where it is worn. Wands and the like have no slot and work from the pack. */
  slot?: WornSlot;
  /** True if the item only works while attuned (at most ATTUNEMENT_LIMIT attuned items). */
  attunement?: boolean;
  /** Lasting effects while equipped (and attuned, if required). May also appear on magic weapons, armor and shields. */
  passives?: PassiveEffect[];
  weapon?: {
    category: 'simple' | 'martial';
    melee: boolean;
    damage: DamagePart;
    /** The weapon's SRD 5.2 mastery property. */
    mastery?: WeaponMastery;
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
    /** True if the armor imposes Disadvantage on Stealth checks (recorded; no effect yet). */
    stealthDisadvantage?: boolean;
  };
  /** AC bonus for shields. */
  shieldBonus?: number;
  consumable?:
    | {
        /** Effect id handled by the rules engine. */
        effect: 'heal';
        dice: Dice;
      }
    | { effect: 'timed'; passives: PassiveEffect[]; fights: number; hover?: boolean };
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
  /**
   * Slots sharing a group draw from the same pool: an option picked in one
   * slot cannot be picked in another slot of the same group (e.g. the two
   * cantrips of Magic Initiate).
   */
  group?: string;
}

/** A feat granted at character creation (an SRD 5.2 origin feat). */
export interface FeatInfo {
  id: string;
  name: string;
  description: string;
  /** Short bullet lines describing what it does in this game. */
  summaries: string[];
  /** Choices the feat asks for (e.g. Magic Initiate: two cantrips, one spell, a casting ability). */
  choices: ChoiceSlot[];
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
  /** Suggested standard-array assignment for the class's default play style. */
  recommendedAbilities: AbilityScores;
  /**
   * Ready-made play styles (e.g. Defender, Great Weapon, Archer). Choosing one
   * pre-fills coherent abilities and class choices; everything stays editable.
   * The first preset is the default used by Quick start.
   */
  presets?: BuildPreset[];
}

/** A coherent starting build for a class: abilities and class choices that fit together. */
export interface BuildPreset {
  id: string;
  name: string;
  /** One sentence on how it plays. */
  description: string;
  /** Standard-array assignment suited to this style (e.g. Dexterity first for an archer). */
  abilities: AbilityScores;
  /** ChoiceSlot.key -> ChoiceOption.id for the class's level-1 choices (fighting style, starting kit…). */
  choices: Record<string, string>;
  /** Abilities to favour, in order, when assigning a background's increases. */
  abilityPriority: Ability[];
}

export interface BackgroundInfo {
  id: string;
  name: string;
  description: string;
  /** The three abilities this background can raise (+2/+1 or +1/+1/+1). */
  abilityOptions: Ability[];
  skills: Skill[];
  /** The origin feat this background grants. Its choices are stored in CharacterBuild.choices. */
  feat?: FeatInfo;
}

// ---------------------------------------------------------------------------
// Rules: spells
// ---------------------------------------------------------------------------

export type SpellList = 'cleric' | 'druid' | 'wizard';

export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

/**
 * A spell, transcribed from SRD 5.2 into game units. Caster-dependent numbers
 * (attack bonus, save DC, the modifier added to healing) are not stored here:
 * the rules engine derives them when it turns a known spell into an ActionDef.
 */
export interface SpellDef {
  id: string;
  name: string;
  /** 0 for a cantrip. */
  level: number;
  school: SpellSchool;
  lists: SpellList[];
  castingTime: ActionCost;
  concentration: boolean;
  /** Duration in rounds (1 minute = 10); omitted for instantaneous spells. */
  durationRounds?: number;
  /** One or two original sentences for the tooltip. */
  description: string;
  icon?: string;
  /** Ranges and areas in cells (5 ft = 1). */
  targeting: Targeting;
  /**
   * How the spell resolves: a spell attack roll, a saving throw by each
   * target, automatically (no roll), as healing, or as a lasting buff.
   */
  resolution: 'attack' | 'save' | 'auto' | 'heal' | 'buff';
  /** For 'save' spells: which save, and whether a success halves the damage. */
  save?: { ability: Ability; halfOnSave: boolean };
  /** Damage at character level 1 (cantrips) or when cast at spell level 1. */
  damage?: DamagePart[];
  /** Cantrips only: the damage dice at character levels 5, 11 and 17. */
  cantripScaling?: [Dice, Dice, Dice];
  /** Healing dice; the engine adds the spellcasting modifier when `addsModifier` is true. */
  heal?: Dice;
  addsModifier?: boolean;
  /** Condition applied on a hit or failed save. `saveEnds` names the save repeated each turn. */
  applies?: { condition: Condition; rounds?: number; saveEnds?: Ability };
  /**
   * Ids of effects the rules engine implements in code, for everything the
   * fields above cannot express (e.g. 'magicMissile', 'shield', 'bless').
   */
  effects?: string[];
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
  /** Unspent Hit Dice (maximum = level). Spent on short rests, restored by a long rest. */
  hitDiceLeft: number;
  resources: Record<string, ResourcePool>;
  inventory: ItemStack[];
  /**
   * `mainHand` and `offHand` are the melee set: a weapon, plus a shield or a
   * second Light weapon (two-weapon fighting). `ranged` is a separate ranged
   * weapon (bow, crossbow) the hero switches to freely when shooting.
   */
  equipped: {
    mainHand?: string;
    offHand?: string;
    ranged?: string;
    armor?: string;
  };
  /** Worn magic items by slot; both ring slots take ring items. */
  worn?: Partial<Record<Exclude<WornSlot, 'ring'> | 'ring' | 'ring2', string>>;
  /** Ids of the items the hero is attuned to (at most ATTUNEMENT_LIMIT). */
  attuned?: string[];
  /** Passing effects, counted down once per fight. */
  timed?: TimedEffect[];
  /** Quick-slot item ids, at most QUICK_SLOTS; missing means the first consumable stacks. */
  quick?: string[];
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
  /** Short rests left before the next long rest (the save is taken fully rested, so normally the maximum). */
  shortRestsLeft: number;
  /** The companion travelling with the hero, once one has joined. */
  companion?: CompanionState;
  /** Guided or standard help, chosen at the start of the run. */
  help?: HelpMode;
  /** The player's chest-puzzle rating. */
  puzzleSkill?: PlayerSkill;
}

// ---------------------------------------------------------------------------
// Companions
// ---------------------------------------------------------------------------

export type CompanionRole = 'healer' | 'blaster' | 'skirmisher';

/**
 * How the companion behaves in a fight. 'close': stays next to the hero and
 * engages what threatens them. 'back': keeps its distance and avoids melee.
 * 'focus': attacks whatever the hero last attacked.
 */
export type CompanionStance = 'close' | 'back' | 'focus';

/** One step of a companion's growth. */
export interface CompanionFeature {
  /** Companion level at which it unlocks. */
  level: number;
  name: string;
  /** One line for the hub and HUD. */
  summary: string;
  /** A spell from src/data/spells.ts this step grants, if any. */
  spellId?: string;
  /** Uses per long rest of that spell (omitted for cantrips and passive features). */
  uses?: number;
  /** Id of an effect the rules engine implements in code (e.g. 'packFlank', 'blink'). */
  effect?: string;
}

/** A companion the hero can travel with. Static data in src/data/companions.ts. */
export interface CompanionDef {
  id: string;
  name: string;
  role: CompanionRole;
  /** Two or three sentences for the hub's picker. */
  description: string;
  /** The creature's SRD stat block: what it is at companion level 1. */
  base: MonsterDef;
  /** Growth, in level order. Companion level = hero level − 2 (minimum 1). */
  kit: CompanionFeature[];
  /** How it looks as it grows; the last entry whose `fromLevel` is reached applies. */
  visualTiers: { fromLevel: number; visual: VisualSpec }[];
}

/** A companion as shown in the hub picker. Produced by the rules engine. */
export interface CompanionInfo {
  id: string;
  name: string;
  role: CompanionRole;
  description: string;
  /** The level it would have alongside the hero on the next floor. */
  level: number;
  maxHp: number;
  ac: number;
  /** Lines describing what it can do at that level. */
  summaries: string[];
  /** The next thing it will learn, if any. */
  nextUnlock?: { level: number; summary: string };
  visual: VisualSpec;
}

/** The travelling companion's persistent state. Plain JSON; stored in the save game. */
export interface CompanionState {
  id: string;
  hp: number;
  resources: Record<string, ResourcePool>;
  stance: CompanionStance;
}

/** Hero level at which a companion first joins (chosen in the hub before that floor). */
export const COMPANION_JOIN_LEVEL = 4;

/** Short rests allowed between long rests. */
export const SHORT_RESTS_PER_LONG_REST = 2;

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
  /**
   * A named feature or reaction took effect: Sneak Attack, Cleave,
   * Indomitable, Shield, Burst of Ingenuity, concentration starting or
   * ending, an ambush, and so on. Emitted next to the ordinary events so the
   * game can show a float and play a sound without parsing log text. `id` is
   * a stable camelCase key ('sneakAttack', 'cleave', 'indomitable', 'shield',
   * 'concentrationStart', 'concentrationEnd', 'peerlessAim', 'heroicRally',
   * 'burstOfIngenuity', 'uncannyDodge', 'evasion', 'ambush', 'tacticalShift',
   * 'lastStand', 'savageAttacker'); `label` is the short text to display.
   */
  | { type: 'feature'; creatureId: string; id: string; label: string; targetId?: string; amount?: number }
  /**
   * A creature was forced into a hazard. Followed by its damage event and,
   * if it survives, a `move` event whose path is the single cell it climbs
   * back out onto.
   */
  | { type: 'hazard'; creatureId: string; hazard: Hazard; at: GridPos; sourceId?: string }
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

/**
 * 'shoot', 'block' and 'dodge' are optional extras: a model without the clip
 * falls back to 'attack' (for shoot) or a procedural motion.
 */
export type AnimName = 'idle' | 'walk' | 'attack' | 'hit' | 'death' | 'cast' | 'shoot' | 'block' | 'dodge';

/** The look of a spell or missile effect, usually its damage type. */
export type EffectElement =
  | 'physical'
  | 'fire'
  | 'cold'
  | 'lightning'
  | 'force'
  | 'acid'
  | 'radiant'
  | 'necrotic'
  | 'poison'
  | 'thunder'
  | 'psychic'
  | 'heal'
  | 'holy'
  | 'arcane';

/** Where an effect starts or ends: an entity (by id) or a cell. */
export type EffectAnchor = string | GridPos;

/**
 * A short one-shot visual. The renderer resolves each when its main beat
 * lands (a projectile arriving, a burst at full size), so the game can time
 * damage numbers and sounds to it. All are brief (about 0.2 to 0.6 s).
 */
export type VisualEffect =
  /** Something that flies: an arrow, bolt, javelin, rock, dart, or a spell bolt. `count` > 1 fires a volley (Magic Missile). A miss flies past. */
  | {
      kind: 'projectile';
      from: EffectAnchor;
      to: EffectAnchor;
      shape: 'arrow' | 'bolt' | 'javelin' | 'rock' | 'dart' | 'orb';
      element: EffectElement;
      hit: boolean;
      count?: number;
    }
  /** An instant line between two points (Ray of Frost, Lightning Bolt along its cells). */
  | { kind: 'beam'; from: EffectAnchor; to: EffectAnchor; element: EffectElement }
  /** A flash across a set of cells from an origin: cones, lines, and bursts (Burning Hands, Fireball, Thunderwave, breath weapons). */
  | { kind: 'area'; origin: EffectAnchor; cells: GridPos[]; element: EffectElement }
  /** Something on or around one entity: healing motes, a shield dome, a blessing ring, a buff or debuff shimmer. */
  | { kind: 'aura'; on: EffectAnchor; style: 'heal' | 'shield' | 'bless' | 'buff' | 'debuff' | 'teleport'; element?: EffectElement }
  /** The moment a blow lands: knock-back away from `from`, a brief freeze, and camera shake scaled by `strength` (0..1; crits and boss hits near 1). */
  | { kind: 'impact'; on: string; from?: EffectAnchor; strength: number; element?: EffectElement };

/** How fast combat animations play. 'skip' shows the hero's own animations fast and enemies' almost instantly. */
export type AnimationSpeed = 'normal' | 'fast' | 'skip';

/** 'guided' explains things as they come up and suggests moves; 'standard' only shows first-time hints about the controls. */
export type HelpMode = 'guided' | 'standard';

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
    /** `scale`: how big the entity is drawn, as a multiple of its normal size (1 = normal; Enlarge 1.5). It swells or shrinks to it over a moment. */
    state: { selected?: boolean; targetable?: boolean; hpFraction?: number; dead?: boolean; visible?: boolean; scale?: number },
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
  /** Play a one-shot effect; resolves when its main beat lands. Never rejects; unknown anchors resolve at once. */
  playEffect(effect: VisualEffect): Promise<void>;
  /** Scale the duration of entity animations, movement and effects ('fast' about 0.5x, 'skip' about 0.2x). */
  setAnimationSpeed(speed: AnimationSpeed): void;
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
  /** Guided mode only: this is the adviser's suggested move right now; the HUD gives it a soft glow. */
  suggested?: boolean;
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
    /** Passing effects from potions and the like: "Flying, 1 fight left". */
    timed?: { name: string; fightsLeft: number; detail?: string }[];
  };
  /** The hero's companion, when one is travelling with them. */
  companion?: {
    id: string;
    name: string;
    role: CompanionRole;
    level: number;
    hp: number;
    maxHp: number;
    conditions: Condition[];
    /** True while it is out of the fight at 0 HP (it returns at 1 HP afterwards). */
    downed: boolean;
    stance: CompanionStance;
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
    /**
     * Weapon attacks the hero can still make this turn, once the hero has more
     * than one per Attack action (Extra Attack). Omitted for a single-attack hero.
     */
    attacksLeft?: { current: number; max: number };
    initiative: HudInitiativeEntry[];
  };
  actions: HudAction[];
  /** The spell the hero is concentrating on, if any, and the turns it has left. */
  concentration?: { spellName: string; roundsLeft: number };
  /** Info on the hovered or selected creature. */
  target?: {
    name: string;
    hp: number;
    maxHp: number;
    ac: number;
    conditions: Condition[];
    description?: string;
    /** Whose side it is on; the panel reads as friendly for 'ally' and 'player'. */
    faction?: Faction;
    /** Cover it has against the hero from where the hero stands: the bonus to its AC and Dexterity saves. */
    cover?: 0 | 2 | 5;
    /**
     * With a push selected: what the target would be shoved into. `damage` is
     * given for a fall, lava, fire or spikes; `prone` for water.
     */
    pushInto?: { hazard: Hazard | 'fire' | 'spikes'; damage?: Dice; prone?: boolean };
    /** How it fights, once the hero has seen it act or stands close enough to judge. */
    tactic?: MonsterTactic;
    /** 0..1 hit chance with the selected action, if one is selected. */
    hitChance?: number;
  };
  /** Newest last. The HUD shows the tail. */
  log: string[];
  /** One-line contextual hint, e.g. "Choose a target" or "The stairs are sealed". */
  prompt?: string;
  /** Guided mode only: the adviser's suggestion in words, e.g. "Suggested: Shove the Skeleton (60%) — it falls for 3d6". */
  suggestion?: string;
  /** Short rests left before the next long rest. */
  shortRestsLeft: number;
  /**
   * True while exploring with no enemy in view, a short rest left, and
   * something to gain from one. The HUD enables its Short Rest button then.
   */
  canShortRest: boolean;
  /** Why a short rest is unavailable ("An enemy is in view", "No short rests left", "Nothing to recover"). */
  shortRestBlockedReason?: string;
  /** The hero's Hit Dice, spent automatically on short rests. */
  hitDice: { current: number; max: number; die: number };
  /** Unused rest sites remaining on this floor. */
  restSitesLeft: number;
  /**
   * True only while exploring, standing next to an unused rest site, and
   * missing anything a long rest restores. The HUD shows "Rest here" only then.
   */
  canLongRest: boolean;
}

export type UiIntent =
  | { type: 'selectAction'; actionId: string }
  | { type: 'cancel' }
  | { type: 'endTurn' }
  | { type: 'shortRest' }
  /** Long rest at the adjacent rest site. */
  | { type: 'longRest' }
  /** Change how the companion behaves. Allowed at any time, including mid-fight. */
  | { type: 'setStance'; stance: CompanionStance }
  | { type: 'openMenu' }
  | { type: 'selectCreature'; creatureId: string };

/** One line of a before-and-after comparison, e.g. "Damage  1d8+3 (7.5) → 1d12+3 (9.5)". */
export interface StatChange {
  label: string;
  from: string;
  to: string;
  /** True if the change helps the hero, false if it hurts, null if it is neither. */
  better: boolean | null;
}

/** How an item compares with what the hero has equipped. Computed by the rules engine with the hero's real build. */
export interface ItemComparison {
  verdict: 'upgrade' | 'tradeoff' | 'sidegrade' | 'downgrade' | 'unsuitable' | 'owned';
  /** One short sentence, e.g. "+2 damage, −2 AC (no shield)" or "Needs Strength 15". */
  summary: string;
  changes: StatChange[];
  /** Names of items that would be put away to use it. */
  replaces: string[];
}

export interface HubShopEntry {
  item: ItemDef;
  price: number;
  affordable: boolean;
  /** Present for weapons, armor and shields. */
  compare?: ItemComparison;
}

/** What a rest would do, shown before the player commits to it. */
export interface RestPreview {
  kind: 'short' | 'long';
  /** Lines such as "Recover about 15 HP (2 Hit Dice)", "Second Wind restored", "Your Blink Dog recovers 9 HP". */
  gains: string[];
  /** Lines such as "This site cannot be used again", "1 short rest left afterwards". */
  costs: string[];
  /** True when little would be gained, so the dialog can advise saving it. */
  wasteful: boolean;
}

/** A first-time hint or a guided explanation. */
export interface HintRequest {
  /** Stable id; a hint is shown at most once per player unless `repeat` is set. */
  id: string;
  title?: string;
  text: string;
  /** What it points at. An action id points at that button on the action bar. */
  anchor?: 'actionBar' | 'endTurn' | 'player' | 'companion' | 'target' | 'rest' | 'log' | 'initiative' | 'center' | { actionId: string };
  /** Dismiss automatically after this many seconds (default: stays until dismissed or replaced). */
  seconds?: number;
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
  /**
   * Present once the hero is about to reach COMPANION_JOIN_LEVEL or beyond.
   * The player picks one companion, and may swap at every hub visit.
   * `required` is true when none has been chosen yet: Descend waits for a pick.
   */
  companions?: { options: CompanionInfo[]; chosenId: string | null; required: boolean };
  /**
   * Per owned item id: what the pack screen needs beyond the ItemDef. Filled by
   * the game from the rules; the UI shows it and never works it out itself.
   */
  itemNotes?: Record<string, HubItemNote>;
  /** Attunement in use, e.g. { used: 2, limit: 3 }. */
  attunement?: { used: number; limit: number };
  /** The four quick slots in order; null is an empty slot. `count` is the stack size. */
  quickSlots?: ({ itemId: string; count: number } | null)[];
}

export interface HubItemNote {
  /** Plain lines for the item's effects ("+1 to AC", "Resistance to fire", "Cast Fireball, 3 charges"). */
  effects: string[];
  /** Where it is worn, if it is. */
  wornIn?: WornSlot | 'ring2';
  /** Can be put on or wielded now; `reason` says why not. */
  canEquip: boolean;
  reason?: string;
  needsAttunement: boolean;
  attuned: boolean;
  /** False when attunement is full or the item needs none. */
  canAttune: boolean;
  /** True when the item does nothing right now (needs attunement and is not attuned). */
  inert: boolean;
  /** A consumable that may sit in a quick slot. */
  quickable: boolean;
  compare?: ItemComparison;
}

export type HubIntent =
  | { type: 'confirmLevelUp'; choices: Record<string, string> }
  | { type: 'buy'; itemId: string }
  | { type: 'equip'; itemId: string }
  /** Take off a worn item (also ends its attunement). */
  | { type: 'unequip'; itemId: string }
  | { type: 'attune'; itemId: string }
  | { type: 'unattune'; itemId: string }
  /** Put a consumable in quick slot 0..3, or clear the slot with null. */
  | { type: 'setQuickSlot'; slot: number; itemId: string | null }
  | { type: 'chooseCompanion'; id: string }
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
  showMenu(state: {
    quality: QualityLevel;
    depth: number;
    muted?: boolean;
    help?: HelpMode;
    speed?: AnimationSpeed;
  }): Promise<MenuResult>;
  /** Asked once when a new game starts: "New to this kind of game?" */
  showHelpChoice(): Promise<HelpMode>;
  /**
   * A small modal question over the game (rest confirmations and the like).
   * Resolves true on confirm. When `rememberKey` is given the dialog offers
   * "Don't ask again"; `remember` is then true if the player ticked it.
   */
  confirm(q: {
    title: string;
    lines: string[];
    warning?: string;
    confirmLabel: string;
    cancelLabel?: string;
    rememberKey?: string;
  }): Promise<{ ok: boolean; remember: boolean }>;
  /** Show a hint (replacing any hint on screen); the callback fires when the player dismisses it or turns tips off. */
  showHint(hint: HintRequest, onClose?: (result: 'dismissed' | 'tipsOff') => void): void;
  /** Remove the hint with this id if it is showing (the player did the thing). */
  clearHint(id: string): void;
  /** Open the "How to play" page (also reachable from the pause menu). */
  showHowToPlay(): Promise<void>;
  /**
   * Play a chest's lock puzzle as a modal over the (paused) game. Always
   * resolves: forcing the lock or closing the puzzle gives outcome 'skipped'
   * and grade 'none'.
   */
  playPuzzle(req: PuzzleRequest): Promise<PuzzleResult>;
}

// ---------------------------------------------------------------------------
// Chest lock puzzles (logic in src/puzzles, view in src/ui/puzzles)
// ---------------------------------------------------------------------------

export type PuzzleKind = 'runes' | 'tumblers' | 'conduits' | 'wards';

/** Same spec, same puzzle, always. */
export interface PuzzleSpec {
  kind: PuzzleKind;
  seed: number;
  /** Integer 1 (gentle) to 10 (fiendish). */
  difficulty: number;
}

/** Also the chest loot grade: gold pays most, 'none' is a forced lock. */
export type PuzzleGrade = 'gold' | 'silver' | 'bronze' | 'none';

export interface PuzzleResult {
  outcome: 'solved' | 'skipped' | 'failed';
  grade: PuzzleGrade;
  seconds: number;
  mistakes: number;
  hintsUsed: number;
  /** Guesses or taps where the kind counts them, else 0. */
  moves: number;
}

/** The player's puzzle rating, kept in the save. Ratings are on the 1..10 difficulty scale. */
export interface PlayerSkill {
  overall: number;
  byKind: Partial<Record<PuzzleKind, number>>;
  played: number;
  playedByKind: Partial<Record<PuzzleKind, number>>;
}

export interface PuzzleRequest {
  spec: PuzzleSpec;
  /** The chest's name, e.g. "Ironbound Chest" or "The Warden's Hoard". */
  title: string;
  flavor?: string;
  /** What each grade would pay, already worded ("120 gp and a potion of healing"). */
  rewards: { gold: string; silver: string; bronze: string; skip: string };
  /** A boss chest: the view may dress it up. */
  boss?: boolean;
}

export type MenuResult =
  | { type: 'resume' }
  | { type: 'quality'; level: QualityLevel }
  /** The player toggled sound; `muted` is the new state. */
  | { type: 'sound'; muted: boolean }
  | { type: 'help'; mode: HelpMode }
  | { type: 'speed'; speed: AnimationSpeed }
  | { type: 'howToPlay' }
  | { type: 'abandon' };

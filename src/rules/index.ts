export * from './dice';
export {
  getCreationOptions,
  validateBuild,
  createCharacter,
  finalAbilities,
  computeAc,
  toCreature,
  syncFromCreature,
  previewLevelUp,
  applyLevelUp,
  suggestedLevelChoices,
  takeShortRest,
  shortRestGain,
  longRestGain,
  longRest,
  enterFloor,
  shopStock,
  buyItem,
  equipItem,
  canEquip,
  attuneItem,
  unattuneItem,
  canAttune,
  attunementStatus,
  removeWorn,
  effectiveAbilities,
  isWonder,
  quickSlotIds,
  setQuickSlot,
  itemChargeKey,
  itemSpellActionId,
  bestPotion,
  wondersAt,
  masteredKinds,
  floorReward,
  useConsumable,
  chestLoot,
  CHEST_GRADES,
  BOSS_CHEST_FACTOR,
  type ChestGrade,
  type ChestLootOptions,
  ITEM_GATING,
  CHEST_RULE,
  ECONOMY,
  STARTING_GOLD,
  migrateEquipment,
  assignIncreases,
  buildFromPreset,
} from './character';
export { castOutOfCombat, tempHpOf, hasMageArmor, outOfCombatSpells, OUT_OF_COMBAT_SPELLS } from './casting';
export {
  concentratingOn,
  casterFor,
  spellToAction,
  knownSpells,
  knownSpellIds,
  getSpell,
  offeredSpells,
  chromaticOrbType,
  IMPLEMENTED_SPELL_IDS,
  HIDDEN_FROM_CREATION,
  spellPoolKey,
  spellActionId,
  isSpellAction,
  type Caster,
} from './spells';
export { createCombat, attacksLeft, combatDepth, pushPreview, ELEVATION_ATTACK_BONUS, BREAK_FREE_ID, BREAK_FREE_DC, type CombatOptions, type PushPreview } from './combat';
export { SHOVE_PUSH_ID, SHOVE_TRIP_ID } from './actions';
export { tacticOf, inferTactic, creatureTactic, isFlexible, flexibleAlternative } from './tactics';
export { TERRAIN_TUNING, flightPath, fallDice, planPush, pushValue, slamDice, obstacleOf, climbOutCell, coverFor, canShoveSize, exposedToPush, nextToHazard, type PushPlan } from './terrain';
export { instantiateMonster } from './monster';
export {
  COMPANION_LEVEL_PACE,
  companionLevel,
  companionProgression,
  companionAbilities,
  companionMaxHp,
  companionCaster,
  companionRole,
  companionNeedsRest,
  companionPrayer,
  companionInfo,
  companionOptions,
  companionResources,
  companionShortRest,
  companionLongRest,
  createCompanion,
  getCompanion,
  kitAt,
  newCompanionState,
  requireCompanion,
  syncCompanion,
  usesAt,
  type CompanionRow,
} from './companion';
export { createPartyDriver, type PartyDriver } from './party';
export { chooseCompanionCommand, runCompanionTurn, heroLastTarget, isChokepoint, isChasmEdge } from './companionAi';
export { chooseCommand, runAiTurn, runTurnWith, MAX_AI_STEPS } from './ai';
export { assignSlots, buildEncounters, ENCOUNTER_TUNING, bossMinionLimit, bossMinionChanceAt, minMonstersAt, maxMonstersAt, levelBudgetAt, roomBudget, type EncounterTuning, type PlacedMonster } from './encounters';
export { expertPolicy, makeExpertPolicy, expertStance, type ExpertOptions } from './expertPolicy';
export { simulateFight, simulateOne, playerPolicy, type PolicyFn, type SimOptions, type SimResult, type SingleFight } from './sim';
export { createOpenRoomNav } from './testing/openRoomNav';
export { setItemCatalog, resetItemCatalog, getItem } from './items';
export { abilityMod, proficiencyForLevel, isHiddenResource } from './util';
export { compareItem, typicalAc, describePassive } from './compare';
export { hubItemNotes, hubAttunement, hubQuickSlots, timedView, itemEffectLines } from './hubNotes';
export { activePassives, itemWorks, addTimedEffect, tickTimedEffects, timedEffects, hovers } from './passives';
export { GEAR_SCHEDULE, scheduledGear, scheduledArmorBase, scheduledWorn } from './gearSchedule';
export { previewRest } from './restPreview';
export { advise, adviseExplore, type Advice, type AdviseOptions, type ExploreContext } from './advise';
export { LOOT_FIT, lootFit, lootFitFor } from './lootFit';

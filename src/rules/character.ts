import { Rng, hashSeed } from '../core/rng';
import type {
  Ability,
  AbilityScores,
  ActionDef,
  CharacterBuild,
  CreationOptions,
  Creature,
  ItemDef,
  WeaponMastery,
  ItemStack,
  LevelUpPreview,
  PlayerCharacter,
  ResourcePool,
} from '../core/types';
import { standardActions } from './actions';
import { BACKGROUNDS } from './backgrounds';
import { CLASSES, classInfo, getClass, type ClassDef } from './classes';
import { rollDice } from './dice';
import { getItem, itemCatalog, requireItem } from './items';
import { SPECIES, getSpecies, speciesFlagPools, type SpeciesDef } from './species';
import { ABILITIES, abilityMod, clone, flagPool, proficiencyForLevel } from './util';


export const STARTING_GOLD = 10;
export const STARTING_POTIONS = 2;
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY = {
  budget: 27,
  min: 8,
  max: 15,
  costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } as Record<number, number>,
};

export function getCreationOptions(): CreationOptions {
  return {
    species: SPECIES.map((s) => s.info),
    classes: CLASSES.map(classInfo),
    backgrounds: BACKGROUNDS,
    standardArray: [...STANDARD_ARRAY],
    pointBuy: { ...POINT_BUY, costs: { ...POINT_BUY.costs } },
  };
}

/** Ability scores after the background's increases. */
export function finalAbilities(build: CharacterBuild): AbilityScores {
  const out = { ...build.baseAbilities };
  for (const a of ABILITIES) out[a] += build.abilityIncreases[a] ?? 0;
  return out;
}

function classOf(build: CharacterBuild): ClassDef {
  const c = getClass(build.classId);
  if (!c) throw new Error(`Unknown class: ${build.classId}`);
  return c;
}

function speciesOf(build: CharacterBuild): SpeciesDef {
  const s = getSpecies(build.speciesId);
  if (!s) throw new Error(`Unknown species: ${build.speciesId}`);
  return s;
}

export function validateBuild(build: CharacterBuild): string[] {
  const errors: string[] = [];
  const name = build.name?.trim() ?? '';
  if (name.length < 1 || name.length > 24) errors.push('Name must be 1 to 24 characters.');
  const species = getSpecies(build.speciesId);
  if (!species) errors.push(`Unknown species: ${build.speciesId}`);
  const cls = getClass(build.classId);
  if (!cls) errors.push(`Unknown class: ${build.classId}`);
  const bg = BACKGROUNDS.find((b) => b.id === build.backgroundId);
  if (!bg) errors.push(`Unknown background: ${build.backgroundId}`);

  const scores = ABILITIES.map((a) => build.baseAbilities?.[a]);
  if (scores.some((s) => typeof s !== 'number' || !Number.isInteger(s))) {
    errors.push('Ability scores must be whole numbers.');
  } else {
    const nums = scores as number[];
    const isStandard = [...nums].sort((a, b) => b - a).join(',') === STANDARD_ARRAY.join(',');
    const inRange = nums.every((n) => n >= POINT_BUY.min && n <= POINT_BUY.max);
    const cost = inRange ? nums.reduce((s, n) => s + (POINT_BUY.costs[n] as number), 0) : Infinity;
    if (!isStandard && !(inRange && cost <= POINT_BUY.budget)) {
      errors.push(`Ability scores must be the standard array or a point buy of at most ${POINT_BUY.budget} points (scores ${POINT_BUY.min}-${POINT_BUY.max}).`);
    }
  }

  const inc = build.abilityIncreases ?? {};
  const positive: number[] = [];
  for (const [key, value] of Object.entries(inc)) {
    if (!ABILITIES.includes(key as Ability)) errors.push(`Unknown ability in increases: ${key}`);
    else if (bg && !bg.abilityOptions.includes(key as Ability)) errors.push(`${bg.name} cannot raise ${key}.`);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2) errors.push(`Invalid increase for ${key}.`);
    else if (value > 0) positive.push(value);
  }
  const pattern = positive.sort((a, b) => b - a).join(',');
  if (pattern !== '2,1' && pattern !== '1,1,1') errors.push('Ability increases must be +2/+1 or +1/+1/+1.');
  else if (ABILITIES.some((a) => (build.baseAbilities?.[a] ?? 0) + (inc[a] ?? 0) > 20)) errors.push('Ability scores cannot exceed 20.');

  if (cls) {
    const skills = build.skills ?? [];
    if (skills.length !== cls.skillChoices.count) errors.push(`Choose exactly ${cls.skillChoices.count} skills.`);
    if (new Set(skills).size !== skills.length) errors.push('Skills must be distinct.');
    for (const s of skills) {
      if (!cls.skillChoices.from.includes(s)) errors.push(`${s} is not a ${cls.name} skill.`);
      if (bg?.skills.includes(s)) errors.push(`${s} is already granted by the background.`);
    }
    const choices = build.choices ?? {};
    for (const slot of cls.choices) {
      const picked = choices[slot.key];
      if (picked === undefined) errors.push(`Missing choice: ${slot.name}.`);
      else if (!slot.options.some((o) => o.id === picked)) errors.push(`Invalid ${slot.name}: ${picked}.`);
    }
    for (const key of Object.keys(choices)) {
      if (key !== 'masteries' && !cls.choices.some((s) => s.key === key)) errors.push(`Unknown choice: ${key}.`);
    }
  }
  return errors;
}

/** HP gained at one level: hit die maximum (solo-balance rule) + CON modifier + species bonus, at least 1. */
function hpPerLevel(build: CharacterBuild): number {
  const cls = classOf(build);
  const sp = speciesOf(build);
  return Math.max(1, cls.hitDie + abilityMod(finalAbilities(build).con) + sp.hpPerLevel);
}

function characterResources(build: CharacterBuild, level: number): Record<string, ResourcePool> {
  return {
    ...clone(classOf(build).resourcesAt(level)),
    ...clone(speciesOf(build).resources),
    // HOUSE RULE "Last Stand": replaces death saves; refreshes on entering a floor, not on a short rest.
    lastStand: { name: 'Last Stand', current: 1, max: 1, refresh: 'floor' as const },
  };
}

export function createCharacter(build: CharacterBuild): PlayerCharacter {
  const errors = validateBuild(build);
  if (errors.length > 0) throw new Error(`Invalid character: ${errors.join(' ')}`);
  const cls = classOf(build);
  const kit = cls.kits.find((k) => k.id === build.choices['startingKit']);
  if (!kit) throw new Error('Invalid starting kit');
  const inventory: ItemStack[] = clone(kit.items);
  addToStack(inventory, 'potion_healing', STARTING_POTIONS);
  const maxHp = hpPerLevel(build);
  return {
    build: clone({ ...build, name: build.name.trim(), choices: { ...build.choices, masteries: build.choices['masteries'] ?? kit.masteredKinds.join(',') } }),
    level: 1,
    maxHp,
    hp: maxHp,
    hitDiceLeft: 1,
    resources: characterResources(build, 1),
    inventory,
    equipped: { ...kit.equipped },
    gold: STARTING_GOLD,
  };
}

function addToStack(inv: ItemStack[], itemId: string, qty: number): void {
  const s = inv.find((x) => x.itemId === itemId);
  if (s) s.quantity += qty;
  else inv.push({ itemId, quantity: qty });
}

// ------------------------------------------------------------------ equipment

function fightingStyle(pc: PlayerCharacter): string | undefined {
  return pc.build.choices['fightingStyle'];
}

export function computeAc(pc: PlayerCharacter): number {
  const dex = abilityMod(finalAbilities(pc.build).dex);
  const armor = pc.equipped.armor ? getItem(pc.equipped.armor)?.armor : undefined;
  let ac = 10 + dex;
  if (armor) {
    const cap = armor.dexCap;
    ac = armor.baseAc + (cap === undefined ? dex : Math.min(dex, cap));
    if (fightingStyle(pc) === 'defense') ac += 1;
    ac += (pc.equipped.armor ? getItem(pc.equipped.armor)?.magicBonus : 0) ?? 0;
  }
  const shield = pc.equipped.offHand ? getItem(pc.equipped.offHand) : undefined;
  if (shield?.kind === 'shield') ac += (shield.shieldBonus ?? 2) + (shield.magicBonus ?? 0);
  return ac;
}

/** Engine effect ids for a weapon mastery property. Cleave and Nick need a second attack and are not implemented. */
function masteryEffects(mastery: WeaponMastery | undefined, mod: number, pb: number): string[] {
  switch (mastery) {
    case 'slow':
      return ['mastery:slow'];
    case 'vex':
      return ['mastery:vex'];
    case 'sap':
      return ['mastery:sap'];
    case 'push':
      return ['mastery:push'];
    case 'graze':
      return [`mastery:graze:${Math.max(0, mod)}`];
    case 'topple':
      return [`mastery:topple:${8 + mod + pb}`];
    default:
      return [];
  }
}

/** Weapon kinds (base item ids) whose mastery the hero can use: build.choices.masteries, else the starting kit's. */
export function masteredKinds(pc: PlayerCharacter): string[] {
  const raw = pc.build.choices['masteries'];
  if (raw !== undefined) return raw.split(',').filter((x) => x.length > 0);
  return classOf(pc.build).kits.find((k) => k.id === pc.build.choices['startingKit'])?.masteredKinds ?? [];
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function weaponAction(
  item: ItemDef,
  mode: 'attack' | 'throw',
  opts: { abilities: AbilityScores; pb: number; style: string | undefined; twoHands: boolean; mastered?: boolean },
): ActionDef {
  const w = item.weapon as NonNullable<ItemDef['weapon']>;
  const str = abilityMod(opts.abilities.str);
  const dex = abilityMod(opts.abilities.dex);
  const finesse = w.properties.includes('finesse');
  const ranged = !w.melee && mode === 'attack';
  const mod = ranged ? dex : finesse ? Math.max(str, dex) : str;
  const archery = ranged && opts.style === 'archery' ? 2 : 0;
  const mb = item.magicBonus ?? 0;
  const bonus = mod + opts.pb + archery + mb;
  const dice = opts.twoHands && w.versatileDice ? w.versatileDice : w.damage.dice;
  const dmgDice = `${dice}${mod + mb === 0 ? '' : fmtMod(mod + mb)}`;
  const masteryFx = opts.mastered ? masteryEffects(w.mastery, mod, opts.pb) : [];
  const base = { cost: 'action' as const, attack: { bonus }, damage: [{ dice: dmgDice, type: w.damage.type }] };
  if (mode === 'throw') {
    const r = w.range ?? { normal: 4, long: 12 };
    return {
      ...base,
      id: `throw_${item.id}`,
      name: `Throw ${item.name}`,
      description: `${fmtMod(bonus)} to hit, ${dmgDice} ${w.damage.type}. Range ${r.normal * 5} ft.`,
      icon: 'thrown',
      ...(masteryFx.length > 0 ? { effects: masteryFx } : {}),
      targeting: { kind: 'creature', melee: false, range: r.normal, longRange: r.long },
    };
  }
  const gwf = !ranged && opts.twoHands && opts.style === 'greatWeaponFighting';
  const common = {
    ...base,
    id: `atk_${item.id}`,
    name: item.name,
    description: `${fmtMod(bonus)} to hit, ${dmgDice} ${w.damage.type}.`,
    ...(gwf || masteryFx.length > 0 ? { effects: [...(gwf ? ['greatWeaponFighting'] : []), ...masteryFx] } : {}),
  };
  if (ranged) {
    const r = w.range ?? { normal: 8, long: 24 };
    return { ...common, icon: 'ranged', targeting: { kind: 'creature', melee: false, range: r.normal, longRange: r.long } };
  }
  return { ...common, icon: 'melee', targeting: { kind: 'creature', melee: true, range: w.properties.includes('reach') ? 2 : 1 } };
}

/** Weapon attack actions derived from the equipped main hand, carried alternatives and thrown weapons. */
function weaponActions(pc: PlayerCharacter, abilities: AbilityScores, pb: number): ActionDef[] {
  const style = fightingStyle(pc);
  const kinds = masteredKinds(pc);
  const mastered = (i: ItemDef): boolean => kinds.includes(i.baseId ?? i.id);
  const mainId = pc.equipped.mainHand;
  const main = mainId ? getItem(mainId) : undefined;
  const out: ActionDef[] = [];
  const shieldOn = pc.equipped.offHand !== undefined;
  const hasWeapon = (i: ItemDef | undefined): i is ItemDef => !!i?.weapon;
  if (hasWeapon(main)) {
    const w = main.weapon as NonNullable<ItemDef['weapon']>;
    const twoHands = w.properties.includes('twoHanded') || (w.properties.includes('versatile') && !shieldOn);
    out.push(weaponAction(main, 'attack', { abilities, pb, style, twoHands, mastered: mastered(main) }));
  }
  const carried = pc.inventory
    .map((s) => getItem(s.itemId))
    .filter(hasWeapon)
    .filter((i, idx, arr) => arr.findIndex((x) => x.id === i.id) === idx);
  const mainMelee = hasWeapon(main) ? main.weapon?.melee : undefined;
  let alt = false;
  for (const item of carried) {
    const w = item.weapon as NonNullable<ItemDef['weapon']>;
    if (item.id !== main?.id && !alt && mainMelee !== undefined && w.melee !== mainMelee && !w.properties.includes('thrown')) {
      if (!(w.properties.includes('twoHanded') && shieldOn)) {
        const twoHands = w.properties.includes('twoHanded') || (w.properties.includes('versatile') && !shieldOn);
        out.push(weaponAction(item, 'attack', { abilities, pb, style, twoHands, mastered: mastered(item) }));
        alt = true;
      }
    }
    if (w.properties.includes('thrown')) {
      out.push(weaponAction(item, 'throw', { abilities, pb, style, twoHands: false, mastered: mastered(item) }));
    }
  }
  if (!hasWeapon(main) && out.length === 0) {
    const mod = abilityMod(abilities.str);
    out.push({
      id: 'unarmed',
      name: 'Unarmed Strike',
      description: `${fmtMod(mod + pb)} to hit, ${Math.max(1, 1 + mod)} bludgeoning.`,
      icon: 'melee',
      cost: 'action',
      targeting: { kind: 'creature', melee: true, range: 1 },
      attack: { bonus: mod + pb },
      damage: [{ dice: String(Math.max(1, 1 + mod)), type: 'bludgeoning' }],
    });
  }
  return out;
}

export function toCreature(pc: PlayerCharacter, pos: { x: number; y: number }): Creature {
  const cls = classOf(pc.build);
  const sp = speciesOf(pc.build);
  const abilities = finalAbilities(pc.build);
  const pb = proficiencyForLevel(pc.level);
  const actions: ActionDef[] = [...weaponActions(pc, abilities, pb)];

  const resources: Record<string, ResourcePool> = clone(pc.resources);
  for (const f of [...sp.flags, ...cls.flagsAt(pc.level)]) resources['_' + f] = flagPool(f);

  if (resources['secondWind']) {
    actions.push({
      id: 'second_wind',
      name: 'Second Wind',
      description: `Bonus action: regain 1d10 + ${pc.level} hit points.`,
      icon: 'heal',
      cost: 'bonus',
      targeting: { kind: 'self' },
      heal: `1d10+${pc.level}`,
      uses: { resource: 'secondWind', amount: 1 },
      effects: ['secondWind'],
    });
  }
  if (resources['actionSurge']) {
    actions.push({
      id: 'action_surge',
      name: 'Action Surge',
      description: 'Take one additional action this turn. Usable after you have used your action.',
      icon: 'surge',
      cost: 'free',
      targeting: { kind: 'self' },
      uses: { resource: 'actionSurge', amount: 1 },
      effects: ['actionSurge'],
    });
  }
  actions.push(...standardActions());
  for (const stack of pc.inventory) {
    const item = getItem(stack.itemId);
    if (!item?.consumable || stack.quantity <= 0) continue;
    const key = `item:${item.id}`;
    resources[key] = { name: item.name, current: stack.quantity, max: stack.quantity, refresh: 'longRest' };
    actions.push({
      id: `drink_${item.id}`,
      name: item.name,
      description: `Bonus action: drink to regain ${item.consumable.dice} hit points.`,
      icon: 'potion',
      cost: 'bonus',
      targeting: { kind: 'self' },
      heal: item.consumable.dice,
      uses: { resource: key, amount: 1 },
    });
  }

  const armor = pc.equipped.armor ? getItem(pc.equipped.armor)?.armor : undefined;
  const tooWeak = armor?.strRequirement !== undefined && abilities.str < armor.strRequirement;
  return {
    id: 'player',
    defId: cls.id,
    name: pc.build.name,
    faction: 'player',
    pos: { x: pos.x, y: pos.y },
    size: 'medium',
    level: pc.level,
    abilities,
    proficiencyBonus: pb,
    saveProficiencies: [...cls.saves],
    ac: computeAc(pc),
    maxHp: pc.maxHp,
    hp: pc.hp,
    tempHp: 0,
    // Armor without enough Strength costs 10 ft of speed (SRD 5.2).
    speed: Math.max(0, sp.speed - (tooWeak ? 2 : 0)),
    resistances: [...sp.resistances],
    vulnerabilities: [],
    immunities: [],
    conditionImmunities: [],
    conditions: [],
    traits: [],
    actions,
    resources,
    visual: { ...sp.info.visual },
    dead: false,
  };
}

/** A new PlayerCharacter with hit points, resources and consumed items copied back from the creature. */
export function syncFromCreature(pc: PlayerCharacter, creature: Creature): PlayerCharacter {
  const next = clone(pc);
  next.hp = Math.max(0, Math.min(next.maxHp, creature.hp));
  for (const [key, pool] of Object.entries(next.resources)) {
    const c = creature.resources[key];
    if (c) pool.current = Math.max(0, Math.min(pool.max, c.current));
  }
  for (const [key, pool] of Object.entries(creature.resources)) {
    if (!key.startsWith('item:')) continue;
    const id = key.slice('item:'.length);
    const stack = next.inventory.find((s) => s.itemId === id);
    if (stack) stack.quantity = Math.max(0, pool.current);
  }
  next.inventory = next.inventory.filter((s) => s.quantity > 0);
  return next;
}

// -------------------------------------------------------------------- levelling

export function previewLevelUp(pc: PlayerCharacter): LevelUpPreview | null {
  const cls = classOf(pc.build);
  if (pc.level >= cls.maxLevel) return null;
  const to = pc.level + 1;
  return {
    fromLevel: pc.level,
    toLevel: to,
    hpGain: hpPerLevel(pc.build),
    featureSummaries: cls.features.filter((f) => f.level === to).map((f) => `${f.name}: ${f.summary}`),
    choices: cls.levelChoices[to] ?? [],
  };
}

export function applyLevelUp(pc: PlayerCharacter, choices: Record<string, string>): PlayerCharacter {
  const preview = previewLevelUp(pc);
  if (!preview) throw new Error('Already at maximum level');
  const cls = classOf(pc.build);
  const next = clone(pc);
  for (const slot of preview.choices) {
    const picked = choices[slot.key];
    if (!picked || !slot.options.some((o) => o.id === picked)) throw new Error(`Invalid or missing choice: ${slot.name}`);
    next.build.choices[slot.key] = picked;
  }
  next.level = preview.toLevel;
  next.maxHp += preview.hpGain;
  next.hp += preview.hpGain;
  next.hitDiceLeft += 1;
  for (const [key, pool] of Object.entries(cls.resourcesAt(next.level))) {
    const old = next.resources[key];
    next.resources[key] = old
      ? { ...pool, current: Math.max(0, Math.min(pool.max, old.current + (pool.max - old.max))) }
      : { ...pool };
  }
  return next;
}

// ------------------------------------------------------------------------ rests

function hitDieAverage(pc: PlayerCharacter): number {
  return (classOf(pc.build).hitDie + 1) / 2 + abilityMod(finalAbilities(pc.build).con);
}

/** True if the next Hit Die would be spent by an optimal short rest. */
function wouldSpendDie(pc: PlayerCharacter): boolean {
  const missing = pc.maxHp - pc.hp;
  if (pc.hitDiceLeft <= 0 || missing <= 0) return false;
  return missing >= hitDieAverage(pc) || pc.hp < pc.maxHp * 0.5;
}

/** Would a short rest do anything? For the HUD. */
export function shortRestGain(pc: PlayerCharacter): { hp: boolean; resources: boolean } {
  const cls = classOf(pc.build);
  const resources = Object.entries(pc.resources).some(
    ([key, pool]) => pool.current < pool.max && (pool.refresh === 'shortRest' || (cls.shortRestRecovery[key] ?? 0) > 0),
  );
  return { hp: wouldSpendDie(pc), resources };
}

/**
 * SRD 5.2 short rest. Spends Hit Dice one at a time (class hit die + CON,
 * at least 1 each) while a die is left and at least an average die of HP is
 * missing, or the hero is below half HP with anything missing. Second Wind
 * regains one use, Action Surge its use. Last Stand is untouched. The
 * 2-per-long-rest limit is the caller's job.
 */
export function takeShortRest(pc: PlayerCharacter, rng: Rng): { pc: PlayerCharacter; healed: number; hitDiceSpent: number } {
  const cls = classOf(pc.build);
  const con = abilityMod(finalAbilities(pc.build).con);
  const next = clone(pc);
  let healed = 0;
  let spent = 0;
  while (wouldSpendDie(next)) {
    const roll = Math.max(1, rng.die(cls.hitDie) + con);
    const gain = Math.min(roll, next.maxHp - next.hp);
    next.hp += gain;
    healed += gain;
    next.hitDiceLeft -= 1;
    spent += 1;
  }
  for (const [key, pool] of Object.entries(next.resources)) {
    if (pool.refresh === 'shortRest') pool.current = pool.max;
    else {
      const n = cls.shortRestRecovery[key];
      if (n) pool.current = Math.min(pool.max, pool.current + n);
    }
  }
  return { pc: next, healed, hitDiceSpent: spent };
}

/** Would a long rest do anything? */
export function longRestGain(pc: PlayerCharacter): boolean {
  return (
    pc.hp < pc.maxHp ||
    pc.hitDiceLeft < pc.level ||
    Object.entries(pc.resources).some(([key, pool]) => key !== 'lastStand' && pool.current < pool.max)
  );
}

/** Long rest: full HP, all Hit Dice, every resource except Last Stand (that returns on entering a floor). */
export function longRest(pc: PlayerCharacter): PlayerCharacter {
  const next = clone(pc);
  next.hp = next.maxHp;
  next.hitDiceLeft = next.level;
  for (const [key, pool] of Object.entries(next.resources)) if (key !== 'lastStand') pool.current = pool.max;
  return next;
}

/** Entering a floor restores Last Stand (once per floor, however many long rests). */
export function enterFloor(pc: PlayerCharacter): PlayerCharacter {
  const next = clone(pc);
  const ls = next.resources['lastStand'];
  if (ls) ls.current = ls.max;
  for (const pool of Object.values(next.resources)) if (pool.refresh === 'floor') pool.current = pool.max;
  return next;
}

// -------------------------------------------------------------------- hub helpers

/** Gold for clearing a floor. */
/** Economy tuning (mutable for the balance harness). */
export const ECONOMY = { rewardBase: 60, rewardPerDepth: 30 };

export function floorReward(depth: number): number {
  return ECONOMY.rewardBase + ECONOMY.rewardPerDepth * depth;
}

/**
 * Gating for shops and loot, in one place. Magic bonuses unlock at these depths.
 * Nothing magic is sold or found on floors 1-3.
 */
export const ITEM_GATING = {
  /** First depth at which a +N item may be in the shop. */
  shopMagicMinDepth: { 1: 4, 2: 9, 3: 15 } as Record<number, number>,
  /** Magic items offered per shop once unlocked (rare stock). */
  shopMagicSlots: 1,
  /** First depth at which a chest may hold a +1 weapon or shield, and the chance per chest. */
  chestMagicMinDepth: 4,
  chestMagicChance: 0.12,
  /** Mundane gear on sale: price cap = base + perDepth * depth, and slots. */
  shopCostCapBase: 40,
  shopCostCapPerDepth: 40,
  weaponSlots: 4,
  armorSlots: 3,
  /** First depth that sells Greater Healing. */
  greaterPotionMinDepth: 3,
};

const isMundane = (i: ItemDef): boolean => !i.magicBonus && i.baseId === undefined;

function pickSome<T>(items: T[], n: number, rng: Rng): T[] {
  return rng.shuffle([...items]).slice(0, n);
}

/**
 * Items on sale when about to enter `depth`: a curated, deterministic-per-depth
 * selection (potions, a few weapons, a few armor upgrades and a shield), plus
 * rare magic stock from the depths listed in ITEM_GATING.
 */
export function shopStock(depth: number): ItemDef[] {
  const g = ITEM_GATING;
  const rng = new Rng(hashSeed(depth, 'shop'));
  const cap = g.shopCostCapBase + g.shopCostCapPerDepth * depth;
  const all = [...itemCatalog()].sort((x, y) => x.id.localeCompare(y.id));
  const mundane = all.filter((i) => i.cost > 0 && isMundane(i) && i.cost <= cap);
  const out: ItemDef[] = [];
  out.push(...mundane.filter((i) => i.id === 'potion_healing'));
  if (depth >= g.greaterPotionMinDepth) out.push(...all.filter((i) => i.id === 'potion_greater_healing'));
  out.push(...pickSome(mundane.filter((i) => i.kind === 'weapon'), g.weaponSlots, rng));
  const armors = mundane.filter((i) => i.kind === 'armor').sort((x, y) => (y.armor?.baseAc ?? 0) - (x.armor?.baseAc ?? 0));
  // The best affordable armors are always offered, so upgrades exist at every tier.
  out.push(...armors.slice(0, g.armorSlots));
  out.push(...mundane.filter((i) => i.kind === 'shield').slice(0, 1));
  const magicOk = (i: ItemDef): boolean => {
    const bonus = i.magicBonus ?? 0;
    const min = g.shopMagicMinDepth[bonus];
    return bonus > 0 && min !== undefined && depth >= min && i.cost > 0 && i.kind !== 'consumable';
  };
  out.push(...pickSome(all.filter(magicOk), g.shopMagicSlots, rng));
  return [...new Map(out.map((i) => [i.id, i])).values()].sort((x, y) => x.cost - y.cost || x.name.localeCompare(y.name));
}

export function buyItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const item = requireItem(itemId);
  if (item.cost <= 0) throw new Error(`${item.name} is not for sale`);
  if (pc.gold < item.cost) throw new Error(`Not enough gold for ${item.name}`);
  const next = clone(pc);
  next.gold = Math.round((next.gold - item.cost) * 100) / 100;
  addToStack(next.inventory, itemId, 1);
  return next;
}

/**
 * Whether an item can be equipped, with a reason when equipping it will put
 * something away (a Two-Handed weapon and a shield cannot be used together).
 */
export function canEquip(pc: PlayerCharacter, itemId: string): { ok: boolean; reason?: string; unequips?: string } {
  const item = getItem(itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (!pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) return { ok: false, reason: `You do not own ${item.name}` };
  if (item.kind === 'consumable') return { ok: false, reason: `${item.name} cannot be equipped` };
  const main = pc.equipped.mainHand ? getItem(pc.equipped.mainHand) : undefined;
  if (item.kind === 'weapon' && item.weapon?.properties.includes('twoHanded') && pc.equipped.offHand) {
    return { ok: true, unequips: pc.equipped.offHand, reason: `${item.name} needs both hands: the shield is put away.` };
  }
  if (item.kind === 'shield' && main?.weapon?.properties.includes('twoHanded')) {
    return { ok: true, unequips: main.id, reason: `${main.name} needs both hands: it is put away to carry the shield.` };
  }
  return { ok: true };
}

export function equipItem(pc: PlayerCharacter, itemId: string): PlayerCharacter {
  const item = requireItem(itemId);
  if (!pc.inventory.some((s) => s.itemId === itemId && s.quantity > 0)) throw new Error(`You do not own ${item.name}`);
  const next = clone(pc);
  if (item.kind === 'armor') next.equipped.armor = itemId;
  else if (item.kind === 'shield') {
    const main = next.equipped.mainHand ? getItem(next.equipped.mainHand) : undefined;
    if (main?.weapon?.properties.includes('twoHanded')) delete next.equipped.mainHand;
    next.equipped.offHand = itemId;
  } else if (item.kind === 'weapon') {
    next.equipped.mainHand = itemId;
    if (item.weapon?.properties.includes('twoHanded')) delete next.equipped.offHand;
  } else throw new Error(`${item.name} cannot be equipped`);
  return next;
}

/**
 * Use a consumable outside combat (currently healing potions). Returns a new
 * character and the hit points actually restored. Throws if the character
 * does not own the item, it is not a consumable, or there is nothing to heal.
 */
export function useConsumable(pc: PlayerCharacter, itemId: string, rng: Rng): { pc: PlayerCharacter; healed: number } {
  const item = requireItem(itemId);
  if (!item.consumable) throw new Error(`${item.name} cannot be used`);
  const stack = pc.inventory.find((s) => s.itemId === itemId && s.quantity > 0);
  if (!stack) throw new Error(`You do not have ${item.name}`);
  if (pc.hp >= pc.maxHp) throw new Error('Already at full health');
  const next = clone(pc);
  const healed = Math.min(rollDice(rng, item.consumable.dice).total, next.maxHp - next.hp);
  next.hp += healed;
  const s = next.inventory.find((x) => x.itemId === itemId) as ItemStack;
  s.quantity -= 1;
  next.inventory = next.inventory.filter((x) => x.quantity > 0);
  return { pc: next, healed };
}

/** Tunable chest loot (mutable for the balance harness). */
export const CHEST_RULE = { goldMin: 12, goldMax: 24, goldPerDepthMin: 8, goldPerDepthMax: 16, extraPotionChance: 0.25 };

/**
 * What a treasure-room chest holds on `depth`: gold, one guaranteed Potion of
 * Healing, and sometimes a second. The game and the balance simulation both
 * roll chests through this function.
 */
export function chestLoot(depth: number, rng: Rng): { gold: number; items: ItemStack[] } {
  const c = CHEST_RULE;
  const gold = rng.int(c.goldMin + c.goldPerDepthMin * depth, c.goldMax + c.goldPerDepthMax * depth);
  const potions = 1 + (rng.chance(c.extraPotionChance) ? 1 : 0);
  const items: ItemStack[] = [{ itemId: 'potion_healing', quantity: potions }];
  // Rare magic find from the gated depth on (never on floors 1-3).
  if (depth >= ITEM_GATING.chestMagicMinDepth && rng.chance(ITEM_GATING.chestMagicChance)) {
    const finds = [...itemCatalog()].filter((i) => i.magicBonus === 1 && (i.kind === 'weapon' || i.kind === 'shield')).sort((x, y) => x.id.localeCompare(y.id));
    if (finds.length > 0) items.push({ itemId: rng.pick(finds).id, quantity: 1 });
  }
  return { gold, items };
}

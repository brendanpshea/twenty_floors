import { Rng } from '../../core/rng';
import type {
  ActionDef,
  CharacterBuild,
  CombatApi,
  Creature,
  FloorPlan,
  ItemDef,
  MonsterDef,
  NavGrid,
  Room,
  SpawnSlot,
} from '../../core/types';
import { createCombat } from '../combat';
import { instantiateMonster } from '../monster';

/** An Rng whose d-rolls can be scripted: queued values are consumed first by `die`. */
export class ScriptedRng extends Rng {
  queue: number[] = [];
  override die(sides: number): number {
    const v = this.queue.shift();
    return v !== undefined ? Math.min(v, sides) : super.die(sides);
  }
}

const weapon = (
  id: string,
  name: string,
  cost: number,
  w: NonNullable<ItemDef['weapon']>,
): ItemDef => ({ id, name, kind: 'weapon', description: name, cost, weapon: w });

export const FIXTURE_ITEMS: ItemDef[] = [
  weapon('longsword', 'Longsword', 15, {
    category: 'martial',
    melee: true,
    damage: { dice: '1d8', type: 'slashing' },
    versatileDice: '1d10',
    mastery: 'sap',
    properties: ['versatile'],
  }),
  weapon('greatsword', 'Greatsword', 50, {
    category: 'martial',
    melee: true,
    damage: { dice: '2d6', type: 'slashing' },
    mastery: 'graze',
    properties: ['heavy', 'twoHanded'],
  }),
  weapon('shortsword', 'Shortsword', 10, {
    category: 'martial',
    melee: true,
    damage: { dice: '1d6', type: 'piercing' },
    mastery: 'vex',
    properties: ['finesse', 'light'],
  }),
  weapon('dagger', 'Dagger', 2, {
    category: 'simple',
    melee: true,
    damage: { dice: '1d4', type: 'piercing' },
    mastery: 'nick',
    properties: ['finesse', 'light', 'thrown'],
    range: { normal: 4, long: 12 },
  }),
  weapon('javelin', 'Javelin', 5, {
    category: 'simple',
    melee: true,
    damage: { dice: '1d6', type: 'piercing' },
    mastery: 'slow',
    properties: ['thrown'],
    range: { normal: 6, long: 24 },
  }),
  weapon('longbow', 'Longbow', 50, {
    category: 'martial',
    melee: false,
    damage: { dice: '1d8', type: 'piercing' },
    mastery: 'slow',
    properties: ['ammunition', 'heavy', 'twoHanded'],
    range: { normal: 30, long: 120 },
  }),
  weapon('halberd', 'Halberd', 20, {
    category: 'martial',
    melee: true,
    damage: { dice: '1d10', type: 'slashing' },
    mastery: 'cleave',
    properties: ['heavy', 'reach', 'twoHanded'],
  }),
  weapon('warhammer', 'Warhammer', 15, {
    category: 'martial',
    melee: true,
    damage: { dice: '1d8', type: 'bludgeoning' },
    versatileDice: '1d10',
    mastery: 'push',
    properties: ['versatile'],
  }),
  weapon('maul', 'Maul', 10, {
    category: 'martial',
    melee: true,
    damage: { dice: '2d6', type: 'bludgeoning' },
    mastery: 'topple',
    properties: ['heavy', 'twoHanded'],
  }),
  {
    ...weapon('longsword_plus1', 'Longsword +1', 315, {
      category: 'martial',
      melee: true,
      damage: { dice: '1d8', type: 'slashing' },
      versatileDice: '1d10',
      mastery: 'sap',
      properties: ['versatile'],
    }),
    magicBonus: 1,
    baseId: 'longsword',
    rarity: 'uncommon',
  },
  { id: 'scale_mail_plus1', name: 'Scale Mail +1', kind: 'armor', description: '', cost: 350, magicBonus: 1, baseId: 'scale_mail', rarity: 'uncommon', armor: { category: 'medium', baseAc: 14, dexCap: 2 } },
  { id: 'shield_plus1', name: 'Shield +1', kind: 'shield', description: '', cost: 310, magicBonus: 1, baseId: 'shield', rarity: 'uncommon', shieldBonus: 2 },
  { id: 'leather', name: 'Leather', kind: 'armor', description: '', cost: 10, armor: { category: 'light', baseAc: 11 } },
  { id: 'studded_leather', name: 'Studded Leather', kind: 'armor', description: '', cost: 45, armor: { category: 'light', baseAc: 12 } },
  { id: 'scale_mail', name: 'Scale Mail', kind: 'armor', description: '', cost: 50, armor: { category: 'medium', baseAc: 14, dexCap: 2 } },
  { id: 'chain_shirt', name: 'Chain Shirt', kind: 'armor', description: '', cost: 50, armor: { category: 'medium', baseAc: 13, dexCap: 2 } },
  { id: 'chain_mail', name: 'Chain Mail', kind: 'armor', description: '', cost: 75, armor: { category: 'heavy', baseAc: 16, dexCap: 0, strRequirement: 13 } },
  { id: 'shield', name: 'Shield', kind: 'shield', description: '', cost: 10, shieldBonus: 2 },
  { id: 'potion_healing', name: 'Potion of Healing', kind: 'consumable', description: '', cost: 50, consumable: { effect: 'heal', dice: '2d4+2' } },
  {
    id: 'potion_greater_healing',
    name: 'Potion of Greater Healing',
    kind: 'consumable',
    description: '',
    cost: 150,
    consumable: { effect: 'heal', dice: '4d4+4' },
  },
];


export function makeBuild(over: Partial<CharacterBuild> = {}): CharacterBuild {
  return {
    name: 'Tester',
    speciesId: 'human',
    classId: 'fighter',
    backgroundId: 'soldier',
    baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 13 },
    abilityIncreases: { str: 2, con: 1 },
    skills: ['perception', 'survival'],
    choices: { fightingStyle: 'defense', startingKit: 'a' },
    ...over,
  };
}

const melee = (id: string, bonus: number, dice: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  name: id,
  description: id,
  cost: 'action',
  targeting: { kind: 'creature', melee: true, range: 1 },
  attack: { bonus },
  damage: [{ dice, type: 'slashing' }],
  ...extra,
});

export function mon(over: Partial<MonsterDef> & Pick<MonsterDef, 'id'>): MonsterDef {
  return {
    name: over.id,
    size: 'medium',
    type: 'humanoid',
    cr: 0.25,
    xp: 50,
    ac: 12,
    hp: 10,
    hpDice: '3d6',
    speedFt: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    saveProficiencies: [],
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    conditionImmunities: [],
    traits: [],
    actions: [melee('slash', 3, '1d6+1')],
    visual: { model: 'x' },
    themes: ['warrens'],
    role: 'standard',
    description: '',
    ...over,
  };
}

export const FIXTURE_MONSTERS: MonsterDef[] = [
  mon({ id: 'giant_rat', name: 'Giant Rat', cr: 0.125, xp: 25, hp: 7, role: 'minion' }),
  mon({
    id: 'goblin_minion',
    name: 'Goblin Minion',
    cr: 0.125,
    xp: 25,
    hp: 7,
    ac: 12,
    role: 'minion',
    traits: ['nimbleEscape'],
    actions: [
      melee('scimitar', 4, '1d6+2'),
      {
        id: 'shortbow',
        name: 'Shortbow',
        description: '',
        cost: 'action',
        targeting: { kind: 'creature', melee: false, range: 16, longRange: 64 },
        attack: { bonus: 4 },
        damage: [{ dice: '1d6+2', type: 'piercing' }],
      },
    ],
  }),
  mon({ id: 'goblin_warrior', name: 'Goblin Warrior', cr: 0.25, xp: 50, hp: 10, ac: 15, role: 'standard', actions: [melee('scimitar', 4, '2d4+2')] }),
  mon({
    id: 'goblin_boss',
    name: 'Goblin Boss',
    cr: 1,
    xp: 200,
    hp: 21,
    ac: 17,
    role: 'boss',
    actions: [
      melee('scimitar', 4, '1d6+2'),
      {
        id: 'multiattack',
        name: 'Multiattack',
        description: '',
        cost: 'action',
        targeting: { kind: 'creature', melee: true, range: 1 },
        multiattack: ['scimitar', 'scimitar'],
      },
    ],
  }),
  mon({
    id: 'wolf',
    name: 'Wolf',
    cr: 0.25,
    xp: 50,
    hp: 11,
    ac: 12,
    type: 'beast',
    speedFt: 40,
    role: 'standard',
    traits: ['packTactics'],
    actions: [
      melee('bite', 4, '1d6+2', {
        save: { ability: 'str', dc: 11, halfOnSave: false },
        applies: { condition: 'prone', rounds: 1 },
      }),
    ],
  }),
  mon({
    id: 'skeleton',
    name: 'Skeleton',
    cr: 0.25,
    xp: 50,
    hp: 13,
    themes: ['crypt', 'depths'],
    role: 'standard',
    immunities: ['poison'],
    vulnerabilities: ['bludgeoning'],
  }),
  mon({
    id: 'zombie',
    name: 'Zombie',
    cr: 0.25,
    xp: 50,
    hp: 22,
    themes: ['crypt'],
    traits: ['undeadFortitude'],
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    role: 'standard',
  }),
  mon({
    id: 'ghoul',
    name: 'Ghoul',
    cr: 1,
    xp: 200,
    hp: 22,
    themes: ['crypt'],
    role: 'boss',
    actions: [
      melee('claw', 4, '1d4+2', {
        save: { ability: 'con', dc: 10, halfOnSave: false },
        applies: { condition: 'paralyzed', rounds: 1 },
      }),
    ],
  }),
  mon({
    id: 'giant_spider',
    name: 'Giant Spider',
    cr: 1,
    xp: 200,
    hp: 26,
    themes: ['depths'],
    role: 'elite',
    actions: [
      melee('bite', 5, '1d8+3'),
      {
        id: 'web',
        name: 'Web',
        description: '',
        cost: 'action',
        targeting: { kind: 'creature', melee: false, range: 12 },
        recharge: 5,
        save: { ability: 'dex', dc: 13, halfOnSave: false },
        applies: { condition: 'restrained' },
      },
    ],
  }),
  mon({
    id: 'ogre',
    name: 'Ogre',
    cr: 2,
    xp: 450,
    hp: 59,
    ac: 11,
    size: 'large',
    themes: ['depths'],
    role: 'elite',
    actions: [melee('club', 6, '2d8+4')],
  }),
  mon({
    id: 'fire_drake',
    name: 'Fire Drake',
    cr: 2,
    xp: 450,
    hp: 40,
    themes: ['depths'],
    role: 'elite',
    actions: [
      melee('bite', 5, '1d10+3'),
      {
        id: 'fire_burst',
        name: 'Fire Burst',
        description: '',
        cost: 'action',
        targeting: { kind: 'point', range: 0, area: { shape: 'sphere', size: 2 } },
        recharge: 6,
        save: { ability: 'dex', dc: 12, halfOnSave: true },
        damage: [{ dice: '4d6', type: 'fire' }],
      },
    ],
  }),
];

export function fixtureMonster(id: string): MonsterDef {
  const m = FIXTURE_MONSTERS.find((x) => x.id === id);
  if (!m) throw new Error(`no fixture monster ${id}`);
  return m;
}

export function spawn(id: string, cid: string, x: number, y: number): Creature {
  return instantiateMonster(fixtureMonster(id), cid, { x, y });
}

/** Begin a combat and pass turns until `id` is active. */
export function startCombat(creatures: Creature[], nav: NavGrid, rng: Rng, activeId?: string): CombatApi {
  const combat = createCombat(creatures, nav, rng);
  combat.begin();
  if (activeId) {
    for (let i = 0; i < 50 && combat.activeId !== activeId; i++) combat.execute({ type: 'endTurn' });
  }
  return combat;
}

/** A hand-made floor plan with the given rooms and spawn slots. */
export function makePlan(depth: number, theme: FloorPlan['theme'], rooms: Partial<Room>[], spawns: SpawnSlot[]): FloorPlan {
  const full: Room[] = rooms.map((r, i) => ({
    id: i,
    role: 'combat',
    bounds: { x0: 0, y0: 0, x1: 5, y1: 5 },
    center: { x: 2, y: 2 },
    neighbors: [],
    distanceFromEntrance: i,
    ...r,
  }));
  return {
    seed: 1,
    depth,
    theme,
    width: 10,
    height: 10,
    kinds: new Uint8Array(100),
    elevation: new Int8Array(100),
    roomIds: new Int16Array(100),
    rooms: full,
    entrance: { x: 1, y: 1 },
    exit: { x: 8, y: 8 },
    spawns,
    props: [],
    lights: [],
    restSpots: [],
  };
}

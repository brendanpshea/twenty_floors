/** Mock data for the UI preview page (dev/ui-preview.html). Not used by the game. */
import type {
  CreationOptions,
  HubModel,
  HudModel,
  ItemDef,
} from '../core/types';

export const creationOptions: CreationOptions = {
  species: [
    {
      id: 'human',
      name: 'Human',
      description:
        'Found in every corner of the multiverse, humans are as varied as they are ambitious, and always eager to prove themselves.',
      traitSummaries: [
        'Resourceful: gain Heroic Inspiration at the start of each floor.',
        'Skillful: proficiency in one extra skill.',
        'Versatile: one extra Origin feat.',
      ],
      visual: { model: 'human' },
    },
    {
      id: 'dwarf',
      name: 'Dwarf',
      description:
        'Stout and stubborn, dwarves are born of stone and tradition. Their patience is that of the mountain.',
      traitSummaries: [
        'Darkvision to 120 feet.',
        'Dwarven Resilience: resistance to poison damage, advantage on saves against poison.',
        'Dwarven Toughness: +1 hit point per level.',
        'Stonecunning: sense the stone around you.',
      ],
      visual: { model: 'dwarf' },
    },
    {
      id: 'elf',
      name: 'Elf',
      description:
        'Long-lived and graceful, elves carry centuries of memory and a quiet, watchful patience wherever they walk.',
      traitSummaries: [
        'Darkvision to 60 feet.',
        'Fey Ancestry: advantage on saves to avoid being charmed.',
        'Keen Senses: proficiency in Insight, Perception or Survival.',
        'Trance: four hours of meditation counts as a long rest.',
      ],
      visual: { model: 'elf' },
    },
  ],
  classes: [
    {
      id: 'fighter',
      name: 'Fighter',
      description:
        'A master of weapons and armor, the fighter fights with discipline and endurance, turning the battle toward victory.',
      hitDie: 10,
      primaryAbilities: ['str', 'dex'],
      featureSummaries: [
        'Second Wind: a bonus action that heals 1d10 + level hit points.',
        'Fighting Style: a lasting combat specialty of your choice.',
        'Weapon Mastery: use the special properties of your weapons.',
        'Action Surge (level 2): take one additional action.',
      ],
      skillChoices: {
        count: 2,
        from: [
          'acrobatics',
          'animalHandling',
          'athletics',
          'history',
          'insight',
          'intimidation',
          'perception',
          'survival',
        ],
      },
      choices: [
        {
          key: 'fightingStyle',
          name: 'Fighting Style',
          options: [
            { id: 'archery', name: 'Archery', description: 'You gain a +2 bonus to attack rolls you make with ranged weapons.' },
            { id: 'defense', name: 'Defense', description: 'While you are wearing armor, you gain a +1 bonus to Armor Class.' },
            { id: 'dueling', name: 'Dueling', description: 'When wielding a melee weapon in one hand and no other weapons, you gain +2 to damage rolls with it.' },
            { id: 'great_weapon', name: 'Great Weapon Fighting', description: 'Treat any 1 or 2 on a damage die as a 3 when attacking with a two-handed melee weapon.' },
          ],
        },
      ],
      recommendedAbilities: { str: 15, dex: 14, con: 13, int: 8, wis: 10, cha: 12 },
    },
  ],
  backgrounds: [
    {
      id: 'soldier',
      name: 'Soldier',
      description: 'You began training for war as soon as you were old enough to hold a blade, and the discipline never left you.',
      abilityOptions: ['str', 'dex', 'con'],
      skills: ['athletics', 'intimidation'],
    },
    {
      id: 'criminal',
      name: 'Criminal',
      description: 'You earned your living in the shadows, relying on quick hands, quicker wits and a talent for staying unseen.',
      abilityOptions: ['dex', 'con', 'int'],
      skills: ['sleightOfHand', 'stealth'],
    },
    {
      id: 'sage',
      name: 'Sage',
      description: 'You spent your years among libraries and scholars, chasing answers to questions few others thought to ask.',
      abilityOptions: ['con', 'int', 'wis'],
      skills: ['arcana', 'history'],
    },
    {
      id: 'acolyte',
      name: 'Acolyte',
      description: 'You devoted yourself to service in a temple, tending its rites and learning what the faithful believe.',
      abilityOptions: ['int', 'wis', 'cha'],
      skills: ['insight', 'religion'],
    },
  ],
  standardArray: [15, 14, 13, 12, 10, 8],
  pointBuy: {
    budget: 27,
    min: 8,
    max: 15,
    costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 },
  },
};

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const baseLog = [
  'You descend into the Forgotten Crypt.',
  'Dust drifts down from the vaulted ceiling.',
  'You hear scratching behind the sealed door.',
  'The door grinds open. Goblins!',
  'Initiative: Hero 18, Goblin Boss 15, Goblin Archer 12, Goblin 9.',
  'Round 1.',
  'Hero moves 4 cells.',
  'Hero attacks Goblin with Longsword: 17 vs AC 15, hit! 9 slashing damage.',
  'Goblin dies.',
  'Goblin Boss attacks Hero with Scimitar: 11 vs AC 18, miss.',
  'Goblin Archer shoots Hero with Shortbow: 20 vs AC 18, hit! 5 piercing damage.',
  'Round 2.',
  'Hero uses Second Wind and recovers 8 hit points.',
  'Hero attacks Goblin Boss with Longsword: 22 vs AC 17, critical hit! 17 slashing damage.',
  'Goblin Boss is bloodied.',
  'Goblin Boss attacks Hero with Scimitar: 18 vs AC 18, hit! 6 slashing damage.',
  'Goblin Archer shoots Hero with Shortbow: 9 vs AC 18, miss.',
  'Round 3.',
  'Hero throws a Javelin at Goblin Archer: 14 vs AC 15, miss.',
  'Goblin Boss attacks Hero with Scimitar: 7 vs AC 18, miss.',
  'Goblin Archer shoots Hero with Shortbow: 19 vs AC 18, hit! 4 piercing damage.',
  'Round 4.',
  'Hero attacks Goblin Boss with Longsword: 12 vs AC 17, miss.',
  'Hero takes the Dodge action.',
  'Goblin Boss attacks Hero with Scimitar at disadvantage: 10 vs AC 18, miss.',
  'Goblin Archer shoots Hero with Shortbow at disadvantage: 8 vs AC 18, miss.',
  'Round 5.',
  'Hero dashes toward the archer.',
  'A torch gutters out somewhere in the dark.',
];

export function exploreHud(): HudModel {
  return {
    mode: 'explore',
    floor: { depth: 2, themeName: 'The Forgotten Crypt' },
    player: {
      name: 'Aldric',
      level: 2,
      className: 'Fighter',
      hp: 14,
      maxHp: 22,
      tempHp: 0,
      ac: 18,
      conditions: [],
      resources: [{ name: 'Second Wind', current: 1, max: 1 }],
    },
    actions: [
      { id: 'longsword', name: 'Longsword', description: 'Melee attack: +5 to hit, 1d8+3 slashing damage.', icon: 'melee', cost: 'action', enabled: true, selected: false },
      { id: 'javelin', name: 'Javelin', description: 'Thrown attack, range 6 cells: +5 to hit, 1d6+3 piercing damage.', icon: 'thrown', cost: 'action', enabled: true, selected: false, usesLeft: 3 },
      { id: 'dash', name: 'Dash', description: 'Gain extra movement equal to your speed this turn.', icon: 'dash', cost: 'action', enabled: true, selected: false },
      { id: 'dodge', name: 'Dodge', description: 'Attacks against you have disadvantage until your next turn.', icon: 'dodge', cost: 'action', enabled: true, selected: false },
      { id: 'second_wind', name: 'Second Wind', description: 'Regain 1d10 + your level in hit points.', icon: 'heal', cost: 'bonus', enabled: true, selected: false, usesLeft: 1 },
      { id: 'action_surge', name: 'Action Surge', description: 'Take one additional action this turn.', icon: 'surge', cost: 'free', enabled: false, disabledReason: 'Only usable in combat.', selected: false, usesLeft: 1 },
    ],
    log: baseLog.slice(0, 4),
    prompt: undefined,
    shortRestsLeft: 2,
    canShortRest: true,
  };
}

export function combatHud(): HudModel {
  const m = exploreHud();
  return {
    ...m,
    mode: 'combat',
    player: {
      ...m.player,
      hp: 17,
      tempHp: 4,
      conditions: ['dodging'],
    },
    combat: {
      round: 3,
      playerTurn: true,
      movementLeft: 4,
      speed: 6,
      actionAvailable: true,
      bonusAvailable: true,
      initiative: [
        { id: 'player', name: 'Aldric', faction: 'player', hpFraction: 0.77, active: true, dead: false },
        { id: 'boss', name: 'Goblin Boss', faction: 'enemy', hpFraction: 0.42, active: false, dead: false },
        { id: 'archer', name: 'Goblin Archer', faction: 'enemy', hpFraction: 1, active: false, dead: false },
        { id: 'goblin', name: 'Goblin', faction: 'enemy', hpFraction: 0, active: false, dead: true },
        { id: 'wolf', name: 'Wolf', faction: 'ally', hpFraction: 0.8, active: false, dead: false },
      ],
    },
    actions: m.actions.map((a) =>
      a.id === 'action_surge'
        ? { ...a, disabledReason: 'Already used since your last rest.', usesLeft: 0 }
        : a.id === 'second_wind'
          ? { ...a }
          : a,
    ),
    target: {
      name: 'Goblin Boss',
      hp: 13,
      maxHp: 31,
      ac: 17,
      conditions: ['frightened'],
      description: 'Bigger, meaner and louder than the rest, and never far from the loot.',
      hitChance: 0.65,
    },
    log: baseLog,
    prompt: undefined,
    shortRestsLeft: 2,
    canShortRest: false,
  };
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

const item = (d: Omit<ItemDef, 'description'> & { description: string }): ItemDef => d;

export const shopItems: ItemDef[] = [
  item({
    id: 'dagger',
    name: 'Dagger',
    kind: 'weapon',
    description: 'Light, finesse, and easily thrown. Every adventurer owns one.',
    cost: 2,
    weapon: { category: 'simple', melee: true, damage: { dice: '1d4', type: 'piercing' }, properties: ['finesse', 'light', 'thrown'], range: { normal: 4, long: 12 } },
  }),
  item({
    id: 'handaxe',
    name: 'Handaxe',
    kind: 'weapon',
    description: 'A balanced hatchet that works as well in the hand as in the air.',
    cost: 5,
    weapon: { category: 'simple', melee: true, damage: { dice: '1d6', type: 'slashing' }, properties: ['light', 'thrown'], range: { normal: 4, long: 12 } },
  }),
  item({
    id: 'rapier',
    name: 'Rapier',
    kind: 'weapon',
    description: 'A slender blade made for precise, darting thrusts.',
    cost: 25,
    weapon: { category: 'martial', melee: true, damage: { dice: '1d8', type: 'piercing' }, properties: ['finesse'] },
  }),
  item({
    id: 'greatsword',
    name: 'Greatsword',
    kind: 'weapon',
    description: 'Two hands, a heavy swing, and very little subtlety.',
    cost: 50,
    weapon: { category: 'martial', melee: true, damage: { dice: '2d6', type: 'slashing' }, properties: ['heavy', 'twoHanded'] },
  }),
  item({
    id: 'scale_mail',
    name: 'Scale Mail',
    kind: 'armor',
    description: 'Overlapping metal scales sewn onto a leather coat. Noisy, but sturdy.',
    cost: 50,
    armor: { category: 'medium', baseAc: 14, dexCap: 2 },
  }),
  item({
    id: 'plate_armor',
    name: 'Plate Armor',
    kind: 'armor',
    description: 'Shaped plates covering the whole body. The best protection coin can buy.',
    cost: 150,
    armor: { category: 'heavy', baseAc: 18, dexCap: 0, strRequirement: 15 },
  }),
  item({
    id: 'shield',
    name: 'Shield',
    kind: 'shield',
    description: 'Wood and iron, strapped to your arm. Raise it and the blows slide off.',
    cost: 10,
    shieldBonus: 2,
  }),
  item({
    id: 'potion_healing',
    name: 'Potion of Healing',
    kind: 'consumable',
    description: 'A crimson liquid that glimmers when agitated. Drink it to mend your wounds.',
    cost: 50,
    consumable: { effect: 'heal', dice: '2d4+2' },
  }),
];

const ownedItems: ItemDef[] = [
  item({
    id: 'longsword',
    name: 'Longsword',
    kind: 'weapon',
    description: 'A versatile blade, the mark of a trained fighter.',
    cost: 15,
    weapon: { category: 'martial', melee: true, damage: { dice: '1d8', type: 'slashing' }, versatileDice: '1d10', properties: ['versatile'] },
  }),
  item({
    id: 'javelin',
    name: 'Javelin',
    kind: 'weapon',
    description: 'A light spear made for throwing.',
    cost: 1,
    weapon: { category: 'simple', melee: true, damage: { dice: '1d6', type: 'piercing' }, properties: ['thrown'], range: { normal: 6, long: 24 } },
  }),
  item({
    id: 'chain_mail',
    name: 'Chain Mail',
    kind: 'armor',
    description: 'Interlocking metal rings, heavy but reliable.',
    cost: 75,
    armor: { category: 'heavy', baseAc: 16, dexCap: 0, strRequirement: 13 },
  }),
];

export function makeHubModel(): HubModel {
  return {
    nextDepth: 3,
    nextThemeName: 'The Sundered Depths',
    character: {
      build: {
        name: 'Aldric',
        speciesId: 'human',
        classId: 'fighter',
        backgroundId: 'soldier',
        baseAbilities: { str: 15, dex: 14, con: 13, int: 8, wis: 10, cha: 12 },
        abilityIncreases: { str: 2, con: 1 },
        skills: ['perception', 'survival'],
        choices: { fightingStyle: 'defense' },
      },
      level: 2,
      maxHp: 22,
      hp: 22,
      resources: {},
      inventory: [
        { itemId: 'longsword', quantity: 1 },
        { itemId: 'shield', quantity: 1 },
        { itemId: 'chain_mail', quantity: 1 },
        { itemId: 'javelin', quantity: 4 },
        { itemId: 'potion_healing', quantity: 2 },
      ],
      equipped: { mainHand: 'longsword', offHand: 'shield', armor: 'chain_mail' },
      gold: 120,
    },
    items: Object.fromEntries([...ownedItems, ...shopItems.filter((i) => i.id === 'shield' || i.id === 'potion_healing')].map((i) => [i.id, i])),
    characterSummary: { name: 'Aldric', className: 'Fighter', speciesName: 'Human', ac: 18 },
    levelUp: {
      fromLevel: 2,
      toLevel: 3,
      hpGain: 10,
      featureSummaries: [
        'Martial Archetype: choose how you specialise.',
        'Improved Critical: weapon attacks score a critical hit on a roll of 19 or 20.',
      ],
      choices: [
        {
          key: 'archetype',
          name: 'Martial Archetype',
          options: [
            { id: 'champion', name: 'Champion', description: 'Pure physical excellence: your weapon attacks crit more often.' },
            { id: 'battle_master', name: 'Battle Master', description: 'Learn maneuvers and spend superiority dice to control the fight.' },
          ],
        },
      ],
    },
    shop: shopItems.map((it) => ({ item: it, price: it.cost, affordable: it.cost <= 120 })),
  };
}

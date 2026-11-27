import type { CompanionDef } from '../core/types';

/**
 * The companions a hero can travel with from level 4. Each `base` is its SRD
 * 5.2.1 stat block, transcribed into game units as the monsters are. Kits are
 * design work still to come (docs/DESIGN.md, "Companions").
 */
export const COMPANIONS: CompanionDef[] = [
  // Sphinx of Wonder (SRD 5.2.1, Sphinxes). CR 1, XP 200, PB +2.
  // Not expressed by the schema:
  // - Magic Resistance: Advantage on saving throws against spells and other magical effects.
  // - Burst of Ingenuity (2/Day, reaction): when the sphinx or a creature within 30 ft makes an
  //   ability check or saving throw, the sphinx adds 2 to the roll.
  // - Fly 40 ft: the `speedFt` of 20 is the walking speed only.
  // - Skills Arcana +4, Religion +4, Stealth +5; Senses Darkvision 60 ft, Passive Perception 11;
  //   Languages Celestial, Common.
  {
    id: 'sphinx_of_wonder',
    name: 'Sphinx of Wonder',
    role: 'healer',
    description:
      'Gentle, bright and rather pleased with itself, this little winged sphinx has read nearly everything and remembers most of it. It mends wounds with a soft song and a sharp eye for who needs help next. Keep it close and it will keep you on your feet.',
    base: {
      id: 'sphinx_of_wonder',
      name: 'Sphinx of Wonder',
      size: 'tiny',
      type: 'celestial',
      cr: 1,
      xp: 200,
      ac: 13,
      hp: 24,
      hpDice: '7d4+7',
      speedFt: 20,
      abilities: { str: 6, dex: 17, con: 13, int: 15, wis: 12, cha: 11 },
      proficiencyBonus: 2,
      saveProficiencies: [],
      resistances: ['necrotic', 'psychic', 'radiant'],
      vulnerabilities: [],
      immunities: [],
      conditionImmunities: [],
      traits: [],
      actions: [
        {
          id: 'rend',
          name: 'Rend',
          description: 'Raking claws that tear with steel and sunlight.',
          icon: 'melee',
          cost: 'action',
          targeting: { kind: 'creature', melee: true, range: 1 },
          attack: { bonus: 5 },
          damage: [
            { dice: '1d4+3', type: 'slashing' },
            { dice: '2d6', type: 'radiant' },
          ],
        },
      ],
      visual: { model: 'companion_sphinx', scale: 0.9 },
      themes: [],
      role: 'standard',
      description: 'A tiny winged cat with a human face that answers questions for those who can solve its riddles.',
    },
    // Healer: companion level 1 is the SRD stat block. `uses` are per long rest at the level unlocked (+1 every six levels
    // after); spells of level 2 to 5 come from src/data/spells.ts. Our own design, not the tabletop sidekick rules.
    kit: [
      { level: 1, name: 'Healing Word', summary: 'Bonus action: restores 2d4 plus its casting modifier to the hero or itself within 60 ft.', spellId: 'healing_word', uses: 3 },
      { level: 1, name: 'Magic Resistance', summary: 'Advantage on saving throws against spells and other magical effects.', effect: 'magicResistance' },
      { level: 2, name: 'Bless', summary: 'Concentration: the hero adds 1d4 to attack rolls and saving throws.', spellId: 'bless', uses: 2 },
      { level: 3, name: 'Burst of Ingenuity', summary: 'Reaction, twice per long rest: adds 2 to a failed save of the hero (or itself) within 30 ft when that makes it succeed.', effect: 'burstOfIngenuity', uses: 2 },
      { level: 4, name: 'Cure Wounds', summary: 'Touch: restores 2d8 plus its casting modifier.', spellId: 'cure_wounds', uses: 3 },
      { level: 5, name: 'Shield of Faith', summary: 'Bonus action, concentration: +2 Armor Class for the hero.', spellId: 'shield_of_faith', uses: 2 },
      { level: 6, name: 'Aid', summary: 'Allies within 30 ft gain 5 maximum and current hit points (HOUSE RULE: for the fight).', spellId: 'aid', uses: 1 },
      { level: 8, name: 'Prayer of Healing', summary: 'Between fights: restores 2d8 plus its casting modifier to the hero and itself. Not used in combat.', spellId: 'prayer_of_healing', uses: 1 },
      { level: 10, name: 'Mass Healing Word', summary: 'Bonus action: restores 2d4 plus its casting modifier to up to six allies within 60 ft.', spellId: 'mass_healing_word', uses: 2 },
      { level: 12, name: 'Death Ward', summary: 'Touch: the first time the hero would drop to 0 hit points, it drops to 1 instead (HOUSE RULE: for the fight).', spellId: 'death_ward', uses: 1 },
      { level: 14, name: 'Spirit Guardians', summary: 'Concentration: enemies near the sphinx take 3d8 radiant damage at the start of their turns (a Wisdom save halves).', spellId: 'spirit_guardians', uses: 1 },
      { level: 16, name: 'Mass Cure Wounds', summary: 'Restores 5d8 plus its casting modifier to up to six allies in a 30-foot sphere.', spellId: 'mass_cure_wounds', uses: 1 },
      { level: 18, name: 'Brilliant Burst', summary: 'Burst of Ingenuity adds 4 instead of 2.', effect: 'burstGreater' },
    ],
    visualTiers: [
      { fromLevel: 1, visual: { model: 'companion_sphinx', scale: 0.9 } },
      { fromLevel: 7, visual: { model: 'companion_sphinx', scale: 1.1 } },
      { fromLevel: 13, visual: { model: 'companion_sphinx', scale: 1.3 } },
    ],
  },

  // Pseudodragon (SRD 5.2.1, Pseudodragon). CR 1/4, XP 50, PB +2.
  // Not expressed by the schema:
  // - Magic Resistance: Advantage on saving throws against spells and other magical effects.
  // - Sting: when the target fails its save by 5 or more, it is also Unconscious while Poisoned.
  //   The Unconscious rider ends early if the target takes damage or a creature within 5 ft
  //   takes an action to wake it. Only the Poisoned part (1 hour) is encoded below.
  // - Fly 60 ft: the `speedFt` of 15 is the walking speed only.
  // - Skills Perception +5, Stealth +4; Senses Blindsight 10 ft, Darkvision 60 ft, Passive
  //   Perception 15; Languages: understands Common and Draconic but cannot speak.
  {
    id: 'pseudodragon',
    name: 'Pseudodragon',
    role: 'blaster',
    description:
      'A cat-sized dragon with a bold heart and an unfortunate habit of picking fights far too big for it. It flits about on bright wings, blazing away with fire and force from a safe distance. Let it fly and it will cheer you on with every hit.',
    base: {
      id: 'pseudodragon',
      name: 'Pseudodragon',
      size: 'tiny',
      type: 'dragon',
      cr: 0.25,
      xp: 50,
      ac: 14,
      hp: 10,
      hpDice: '3d4+3',
      speedFt: 15,
      abilities: { str: 6, dex: 15, con: 13, int: 10, wis: 12, cha: 10 },
      proficiencyBonus: 2,
      saveProficiencies: [],
      resistances: [],
      vulnerabilities: [],
      immunities: [],
      conditionImmunities: [],
      traits: [],
      actions: [
        {
          id: 'multiattack',
          name: 'Multiattack',
          description: 'The pseudodragon makes two bite attacks.',
          icon: 'special',
          cost: 'action',
          targeting: { kind: 'creature', melee: true, range: 1 },
          multiattack: ['bite', 'bite'],
        },
        {
          id: 'bite',
          name: 'Bite',
          description: 'A quick snap of small, sharp teeth.',
          icon: 'bite',
          cost: 'action',
          targeting: { kind: 'creature', melee: true, range: 1 },
          attack: { bonus: 4 },
          damage: [{ dice: '1d4+2', type: 'piercing' }],
        },
        {
          id: 'sting',
          name: 'Sting',
          description: 'A barbed tail jab that leaves a creature poisoned for an hour.',
          icon: 'melee',
          cost: 'action',
          targeting: { kind: 'creature', melee: true, range: 1 },
          save: { ability: 'con', dc: 12, halfOnSave: false },
          damage: [{ dice: '2d4', type: 'poison' }],
          applies: { condition: 'poisoned', rounds: 600 },
        },
      ],
      visual: { model: 'companion_pseudodragon', scale: 0.8 },
      themes: [],
      role: 'standard',
      description: 'A small, cheerful dragon that lives in the high branches and hunts with a sting.',
    },
    // Blaster: spells of level 2 to 5 come from src/data/spells.ts. Its Sting (with the Poisoned rider) is in the stat block.
    kit: [
      { level: 1, name: 'Fire Bolt', summary: 'A spit of fire at range: a ranged spell attack for 1d10 fire damage, growing at levels 5, 11 and 17.', spellId: 'fire_bolt' },
      { level: 1, name: 'Magic Resistance', summary: 'Advantage on saving throws against spells and other magical effects.', effect: 'magicResistance' },
      { level: 2, name: 'Magic Missile', summary: 'Three darts of force, 1d4+1 each, that never miss.', spellId: 'magic_missile', uses: 3 },
      { level: 3, name: 'Burning Hands', summary: 'A 15-foot cone of fire, 3d6 (Dexterity save halves). Never aimed at the hero.', spellId: 'burning_hands', uses: 3 },
      { level: 4, name: 'Sleep', summary: 'Concentration: foes in a small sphere fall incapacitated, then asleep if they fail a second Wisdom save.', spellId: 'sleep', uses: 2 },
      { level: 6, name: 'Scorching Ray', summary: 'Three ranged spell attacks of 2d6 fire damage each.', spellId: 'scorching_ray', uses: 3 },
      { level: 8, name: 'Shatter', summary: 'A thunderous burst, 3d8 in a 10-foot radius (Constitution save halves).', spellId: 'shatter', uses: 2 },
      { level: 10, name: 'Fireball', summary: 'An explosion of 8d6 fire in a 20-foot radius (Dexterity save halves).', spellId: 'fireball', uses: 2 },
      { level: 12, name: 'Lightning Bolt', summary: 'A long line of lightning, 8d6 (Dexterity save halves).', spellId: 'lightning_bolt', uses: 2 },
      { level: 14, name: 'Ice Storm', summary: 'Hail in a 20-foot radius: 2d10 bludgeoning and 4d6 cold (Dexterity save halves).', spellId: 'ice_storm', uses: 1 },
      { level: 16, name: 'Cone of Cold', summary: 'A 60-foot cone of 8d8 cold damage (Constitution save halves).', spellId: 'cone_of_cold', uses: 1 },
      { level: 18, name: 'Draconic Resilience', summary: 'Resistance to fire damage.', effect: 'fireResistance' },
    ],
    visualTiers: [
      { fromLevel: 1, visual: { model: 'companion_pseudodragon', scale: 0.8 } },
      { fromLevel: 7, visual: { model: 'companion_pseudodragon', scale: 1.2 } },
      { fromLevel: 13, visual: { model: 'companion_pseudodragon', scale: 1.7 } },
    ],
  },

  // Blink Dog (SRD 5.2.1, Blink Dog). CR 1/4, XP 50, PB +2.
  // Not expressed by the schema:
  // - Teleport (bonus action, Recharge 4-6): the dog teleports up to 40 ft to an unoccupied
  //   space it can see. Not modelled as an action yet; the skirmisher kit will need it.
  // - Skills Perception +5, Stealth +5; Senses Darkvision 60 ft, Passive Perception 15;
  //   Languages: Blink Dog, understands Elvish and Sylvan but cannot speak them.
  {
    id: 'blink_dog',
    name: 'Blink Dog',
    role: 'skirmisher',
    description:
      'A quick, silver-grey hound that vanishes with a pop and reappears wherever it is needed most. It is loyal, clever and very fond of a well-timed flanking move. Give it a nod and it will blink straight into the fight beside you.',
    base: {
      id: 'blink_dog',
      name: 'Blink Dog',
      size: 'medium',
      type: 'fey',
      cr: 0.25,
      xp: 50,
      ac: 13,
      hp: 22,
      hpDice: '4d8+4',
      speedFt: 40,
      abilities: { str: 12, dex: 17, con: 12, int: 10, wis: 13, cha: 11 },
      proficiencyBonus: 2,
      saveProficiencies: [],
      resistances: [],
      vulnerabilities: [],
      immunities: [],
      conditionImmunities: [],
      traits: [],
      actions: [
        {
          id: 'bite',
          name: 'Bite',
          description: 'A snapping bite from a dog that is always moving.',
          icon: 'bite',
          cost: 'action',
          targeting: { kind: 'creature', melee: true, range: 1 },
          attack: { bonus: 5 },
          damage: [{ dice: '1d4+3', type: 'piercing' }],
        },
      ],
      visual: { model: 'companion_blinkdog', scale: 1.0 },
      themes: [],
      role: 'standard',
      description: 'A fey hound that can step between places in the blink of an eye.',
    },
    // Skirmisher with rogue abilities (the rogue rules as the SRD gives them for Sneak Attack and Cunning Action).
    kit: [
      { level: 1, name: 'Sneak Attack', summary: 'Once per turn, 1d6 extra damage (+1d6 every two levels) when it has advantage, or when the hero or another ally is within 5 ft of the target and it has no disadvantage.', effect: 'sneakAttack' },
      { level: 1, name: 'Teleport', summary: 'Bonus action, recharge 4-6: blinks up to 40 ft to an open space it can see. HOUSE RULE: the attack made straight after counts as made from hiding (advantage, so Sneak Attack applies).', effect: 'blink' },
      { level: 2, name: 'Cunning Action', summary: 'Bonus action: Dash or Disengage.', effect: 'cunningAction' },
      { level: 4, name: 'Uncanny Dodge', summary: 'Reaction: halves the damage of one attack that hits it.', effect: 'uncannyDodge' },
      { level: 6, name: 'Evasion', summary: 'Dexterity saves for half damage: none on a success, half on a failure.', effect: 'evasion' },
      { level: 8, name: 'Fleet', summary: 'Speed rises by 10 ft.', effect: 'fleet' },
      { level: 10, name: 'Double Bite', summary: 'Attacks twice with its Attack action (Sneak Attack still once per turn).', effect: 'doubleBite' },
      { level: 12, name: 'Steady Blink', summary: 'Teleport recharges on a 3-6.', effect: 'blinkSteady' },
      { level: 14, name: 'Far Blink', summary: 'Teleport reaches 60 ft.', effect: 'farBlink' },
      { level: 16, name: 'Elusive', summary: 'No attack roll has advantage against it while it can act.', effect: 'elusive' },
      { level: 18, name: 'Ever-Blinking', summary: 'Teleport recharges on a 2-6.', effect: 'blinkEver' },
    ],
    visualTiers: [
      { fromLevel: 1, visual: { model: 'companion_blinkdog', scale: 1.0 } },
      { fromLevel: 7, visual: { model: 'companion_blinkdog', scale: 1.15 } },
      { fromLevel: 13, visual: { model: 'companion_blinkdog', scale: 1.3 } },
    ],
  },
];

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
    kit: [], // Filled in by the rules work: see docs/DESIGN.md "Companions".
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
    kit: [], // Filled in by the rules work: see docs/DESIGN.md "Companions".
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
    kit: [], // Filled in by the rules work: see docs/DESIGN.md "Companions".
    visualTiers: [
      { fromLevel: 1, visual: { model: 'companion_blinkdog', scale: 1.0 } },
      { fromLevel: 7, visual: { model: 'companion_blinkdog', scale: 1.15 } },
      { fromLevel: 13, visual: { model: 'companion_blinkdog', scale: 1.3 } },
    ],
  },
];

# Contributing to Twenty Floors

This guide covers how to run the project, where things live, and how to make
the three most common changes: a monster, an item, and a 3D model. For the
architecture and the reasons behind it, read [docs/DESIGN.md](docs/DESIGN.md).

## 1. Getting set up

You need Node 20 or newer. The deploy workflow builds with Node 22. From the
repository root:

```sh
npm install
npm run dev         # Vite dev server
npm test            # Vitest: runs every src/**/*.test.ts
npm run typecheck   # tsc --noEmit
npm run build       # typecheck, then a production build into dist/
npm run preview     # serve dist/ locally after a build
```

With the dev server running, two preview pages let you work on one module
without playing through a whole run (Vite usually prints
`http://localhost:5173`):

- `/dev/render-preview.html`: the 3D renderer on fixture floors.
- `/dev/ui-preview.html`: every UI screen with mock data.

On Windows, run `npm test` from PowerShell. Vitest currently fails when it is
run from Git Bash.

## 2. How the code is organized

Source lives in `src/`, one folder per module:

| Folder | What it holds |
|---|---|
| `src/core` | Shared contracts in `types.ts`, the seeded RNG (`rng.ts`), the theme list. |
| `src/data` | Static content: `monsters.ts` and `items.ts`. Data only. |
| `src/rules` | The headless rules engine: dice, characters, combat, monster AI, encounters. |
| `src/gen` | Headless floor generation and navigation. |
| `src/render` | The three.js view. |
| `src/ui` | The DOM overlay: screens and HUD. |
| `src/game` | The conductor that wires the modules together. |
| `src/balance` | A dev-only harness that simulates fights to tune encounters. |

[docs/DESIGN.md](docs/DESIGN.md) has the full module map and the flow of a
turn. Three rules matter most when you change code:

- `rules`, `gen`, `render` and `ui` never import each other. They meet only
  through the types in `src/core/types.ts`.
- `rules` and `gen` are headless: no DOM, no three.js.
- All randomness goes through `Rng` (`src/core/rng.ts`). Do not call `Math.random()`.

`src/core/types.ts` is a contract. A change there affects every module, so
open an issue describing the change before you send a pull request that edits
it.

## 3. Adding a monster

Monsters are data. Each one is a `MonsterDef` object in the `MONSTERS` array in
`src/data/monsters.ts`. The type is defined in `src/core/types.ts`.

### Content rule

Only creatures from the SRD 5.2 or SRD 5.2.1 (CC-BY-4.0) may be added. Copy
the numbers from the printed stat block in the SRD itself, not from a summary
or a third-party site. Write the flavour text (`description`) yourself. Do not
copy sentences from the SRD or from other books. Do not add monsters or names
that are not in the SRD. If you are not sure whether a creature is in the SRD,
do not add it.

### Steps

1. Read the content rule above and confirm the creature is in the SRD.
2. Add a `MonsterDef` object to `MONSTERS` in `src/data/monsters.ts`.
3. Add its `id` to the `MONSTER_IDS` list in `src/data/data.test.ts`. The test
   compares the sorted list of ids with the sorted `MONSTERS` ids exactly, so
   it fails until the two lists match.
4. Run `npm run typecheck` and `npm test`.
5. Check the monster in `/dev/render-preview.html`.

### A complete example

This is the `wolf` entry, copied from `src/data/monsters.ts`:

```ts
  {
    id: 'wolf',
    name: 'Wolf',
    size: 'medium',
    type: 'beast',
    cr: 0.25,
    xp: 50,
    ac: 12,
    hp: 11,
    hpDice: '2d8+2',
    speedFt: 40,
    abilities: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    proficiencyBonus: 2,
    saveProficiencies: [],
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    conditionImmunities: [],
    traits: ['packTactics'],
    actions: [
      {
        id: 'bite',
        name: 'Bite',
        description: 'A snapping bite that can knock a target off its feet.',
        icon: 'bite',
        cost: 'action',
        targeting: { kind: 'creature', melee: true, range: 1 },
        attack: { bonus: 4 },
        damage: [{ dice: '1d6+2', type: 'piercing' }],
        applies: { condition: 'prone', rounds: 1 },
      },
    ],
    visual: { model: 'wolf', tint: 0x8c8c94 },
    themes: ['warrens'],
    role: 'standard',
    description: 'A lean grey hunter that circles its prey and waits for the pack to close in.',
  },
```

### Field rules

- **Units.** `speedFt` is the walking speed in feet, as printed. Every range is
  in grid cells, and one cell is 5 ft. A melee attack has `range: 1`. Ranged
  and thrown attacks have `range` (normal) and `longRange` (long), and the test
  requires `longRange` to be greater than `range`.
- **Challenge.** `cr` is a number: `0.125`, `0.25`, `0.5`, `1` or `2`. `xp`
  must match the CR table in `data.test.ts` (25, 50, 100, 200, 450). If you
  need another CR, add it to that table as well. `proficiencyBonus` must be 2.
- **Hit points.** `hp` must be within 1 of the average of `hpDice`. Dice strings
  look like `"2d8+2"`. A flat number is written as a string, such as `"5"`.
- **Attacks.** `attack: { bonus }` is the printed to-hit bonus. `damage` is a
  list of `{ dice, type }` entries, one per damage type printed in the block.
- **Saves.** An action can make the target roll a save:
  `save: { ability, dc, halfOnSave }`. An action with `attack` or `save` must
  also have `damage` or `applies`.
- **Conditions.** `applies: { condition, rounds?, saveEnds? }` applies a
  condition from the `Condition` union on a hit or a failed save. Leave
  `rounds` out to keep the condition until it is removed. `saveEnds` makes the
  target repeat a save at the end of each of its turns.
- **Recharge.** `recharge: N` means the action can be used again when a d6
  rolled at the start of the monster's turn is `N` or more. The giant spider's
  web is the example:

  ```ts
  {
    id: 'web',
    name: 'Web',
    description: 'Spits a sticky strand that binds a target until it is torn free.',
    icon: 'special',
    cost: 'action',
    targeting: { kind: 'creature', melee: false, range: 12 },
    recharge: 5,
    save: { ability: 'dex', dc: 13, halfOnSave: false },
    applies: { condition: 'restrained' },
  },
  ```

- **Multiattack.** `multiattack` is a list of action ids that the monster
  performs in order. Every id must name an action with `attack` or `save`, and
  the test checks this. The goblin boss uses `multiattack: ['scimitar', 'scimitar']`
  with the scimitar defined as its own action.
- **Traits.** `traits` may only use ids from the `TraitId` union in
  `src/core/types.ts`: `packTactics`, `undeadFortitude`, `sunlightSensitivity`,
  `nimbleEscape`, `aggressive`, `spiderClimb`, `amorphous`, `keenSenses`. The
  test copies that list into `data.test.ts` as `TRAIT_IDS`, so the two lists
  must stay in step. Do not invent a trait id in data.
- **Themes and role.** `themes` lists the floor themes (`'warrens'`, `'crypt'`,
  `'depths'`) whose encounter tables include this monster. The encounter
  builder in `src/rules/encounters.ts` reads `themes`, `role` and `cr`.
  `role` is one of `minion`, `standard`, `elite` or `boss`. Each theme must end
  up with exactly one `boss` monster and at least two non-boss monsters; the
  test checks this.
- **Visual.** `visual.model` is a key in `public/assets/manifest.json`. See
  section 5. A key that is not in the manifest gets a procedural stand-in, so a
  new monster works before its model exists. `tint` is an optional 0xRRGGBB
  color multiplied into the model.
- **Description.** One sentence, shown in the inspect panel.

## 4. Adding an item

Items are `ItemDef` objects in the `ITEMS` array in `src/data/items.ts`.
Follow the same process as for monsters: add the entry, add its id to
`ITEM_IDS` in `src/data/data.test.ts` (the test requires the exact list), then
run `npm run typecheck` and `npm test`. Check how the hub shop chooses its stock
(`shopStock`, used by `src/game`) before you assume a new item will be sold.

An item has these fields:

- `id`, `name`, `description`, `kind`, `cost` (price in gold pieces; fractions
  such as `0.5` are allowed).
- `kind` is one of `weapon`, `armor`, `shield` or `consumable`. Each kind needs
  the matching block:
  - `weapon`: a `weapon` block with `category` (`simple` or `martial`), `melee`,
    `damage: { dice, type }`, optional `versatileDice`, `properties` (from the
    `WeaponProperty` union) and, for thrown or ranged weapons, `range: { normal, long }`.
  - `armor`: an `armor` block with `category` (`light`, `medium` or `heavy`),
    `baseAc`, and optional `dexCap` and `strRequirement`.
  - `shield`: `shieldBonus`.
  - `consumable`: `consumable: { effect: 'heal', dice }`.
- `icon` is optional.

The `dagger` entry is a complete weapon example:

```ts
  {
    id: 'dagger',
    name: 'Dagger',
    kind: 'weapon',
    description: 'A short, sharp blade that serves equally well in close work or as a throwing knife.',
    cost: 2,
    icon: 'melee',
    weapon: {
      category: 'simple',
      melee: true,
      damage: { dice: '1d4', type: 'piercing' },
      properties: ['finesse', 'light', 'thrown'],
      range: { normal: 4, long: 12 },
    },
  },
```

Item names and descriptions must be taken from SRD 5.2.1 or written by you. The
content rule for monsters applies to items too.

## 5. Adding a 3D model

Models are glTF binary files (`.glb`) in `public/assets/models/`, referenced
from `public/assets/manifest.json`.

### License

Only **CC0 1.0** and **CC-BY** models are accepted. Check the license on the
author's page for that model (or on the file's own license text), not on a
search result or a mirror. CC-BY-SA, CC-BY-NC and CC-BY-ND are not CC-BY and
are not accepted. Record the author, the license and the source URL; you will
need them for `CREDITS.md`.

### Size

Models are small. The current files range from about 45 KB (`goblin.glb`) to
about 313 KB (`skeleton_warrior.glb`). Export only the animation clips the
game uses, drop unused meshes and materials, and compress the file (meshopt
compression and vertex quantization, as the existing models use). A new model
should be in the same range. Anything much larger needs a reason, because the
initial download target is under 10 MB for the whole site, and models are loaded per theme.

### Manifest entry

Each key in `models` in `public/assets/manifest.json` has a `ModelEntry`
(defined in `src/core/types.ts`):

- `url` (required): the path relative to the site root, with no leading slash,
  such as `assets/models/rat.glb`.
- `scale` (optional): a multiplier that makes a Medium creature about 1.8 world
  units tall. Adjust it by eye in `/dev/render-preview.html`.
- `rotationY` (optional): extra rotation in radians so the model faces +Z.
- `animations` (optional): a map from our animation names (`idle`, `walk`,
  `attack`, `hit`, `death`, `cast`) to the clip names inside the file.

The `giant_rat` entry is a complete example:

```json
    "giant_rat": {
      "url": "assets/models/rat.glb",
      "scale": 0.2555,
      "animations": {
        "idle": "Rat_Idle",
        "walk": "Rat_Walk",
        "attack": "Rat_Attack",
        "death": "Rat_Death"
      }
    },
```

A monster's `visual.model` must equal a key in this map. Several keys may point
to the same file, as `goblin_minion`, `goblin_warrior` and `goblin_boss` do.

### Credits

Add a row to the table in [CREDITS.md](CREDITS.md) for every model you add. The
row gives the asset name, author, license, source URL, the file name and
manifest keys, and any changes you made to the file. Follow the existing rows.

## 6. Code style and pull requests

- TypeScript in strict mode. Indexed access is checked
  (`noUncheckedIndexedAccess`).
- Use `import type` for type-only imports. The project enables
  `verbatimModuleSyntax`, so a type-only import without `type` fails `npm run typecheck`.
- Tests live beside the code as `*.test.ts`. `npm test` runs them all.
- Before you open a pull request, run `npm run typecheck` and `npm test`. Both
  must pass.
- Keep a pull request focused on one change. A new monster and a fix to the
  combat code are two pull requests.
- Do not add a runtime dependency without discussion. The only runtime
  dependency is three.js. Open an issue first if you think you need another one.
- Describe in the pull request what changed and, for content, which SRD page or
  section the numbers came from.

## 7. Licensing of contributions

- The code is MIT licensed; see [LICENSE](LICENSE). Unless you say otherwise,
  your contributions are accepted under the same license.
- SRD rules content is used under CC-BY-4.0, which requires attribution. The
  "Rules content" section of `CREDITS.md` covers it.
- Assets must carry their own license (CC0 or CC-BY, as above) and must be
  credited in `CREDITS.md`. Do not submit an asset whose license you cannot
  verify at its source.

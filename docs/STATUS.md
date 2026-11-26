# Status and handoff

Last updated 26 November 2026. A snapshot for whoever picks the work up next,
in a new session or on another machine. `docs/DESIGN.md` has the design and
its decisions; this file only says where things stand.

## What is on `main`

Playable three-floor slice, deployed by GitHub Actions to
https://brendanpshea.github.io/twenty_floors/ on every push to `main`
(the workflow runs type-check, tests and build first, on Node 24).

- Fighter, levels 1 to 3; Human, Dwarf, Elf; four backgrounds.
- Three generated floors with rest sites and one set piece each (five kinds per
  theme).
- Turn-based combat, long rests at rest sites, Hit Dice short rests, Last Stand.
- All SRD 5.2.1 weapons and armor with +1 to +3 variants; six weapon masteries.
- Twelve monsters with open models; kitbashed goblin variants.
- Synthesized sound, pause menu, saves, autoplay bot (`?autoplay=1`).

The creation screen and hub already contain UI for three features whose rules
are not on `main` yet, so these parts are inert there: background feat choices
(Magic Initiate), play-style presets, and the ranged weapon slot.

## Floors 4 and 5: the Flooded Sewers (content only, not reachable yet)

The theme exists end to end except for play: generator (`src/gen/themes/sewers.ts`,
three set pieces), look and two new props (grate, pipe), ambience, and eight
SRD monsters with their floor-4 and floor-5 casts and bosses (Ochre Jelly,
Green Hag) in `ENCOUNTER_TUNING`. See it at
`/dev/render-preview.html?gen=1&theme=sewers&depth=4`.

What is missing before `MILESTONE_FLOORS` can go past 3:

- **Fighter levels 4 and 5** (in `src/rules`, after the spell-engine branch).
- **Models.** The eight monsters use tinted stand-ins from rigs we already
  ship (each has a `TODO model:` comment in `src/data/monsters.ts` naming the
  intended free model). Fetching needs `tools/assets/fetch.mjs` on a machine
  that can reach poly.pizza.
- **Balance.** Encounter budgets for levels 4 and 5 are the untuned SRD
  figures; floor 5 rooms currently come out well over budget. Tune with
  `src/balance` once the hero can reach level 5.
- Monster features the engine cannot express yet were dropped or simplified
  (grapple and swallow, Split, Engulf, shape-shifting, most of the hag's
  spells); each is noted in a comment above the monster.

## Unfinished work: branch `wip/spell-engine`

A snapshot of `src/rules` taken mid-task. **It has two failing tests** and is
not ready to merge. The task, in order:

1. Spell engine and origin feats: Magic Initiate (Cleric, Wizard) from the
   Acolyte and Sage backgrounds, Savage Attacker (Soldier), Alert (Criminal).
   Spell data is in `src/data/spells.ts` (32 spells). Concentration, automatic
   Shield reaction, cantrip scaling, `castOutOfCombat`.
2. Fighter build presets (`ClassInfo.presets`): Defender, Great Weapon, Archer,
   so an archer gets Dexterity-first stats. Re-measure whether Archery really
   loses to Defense for the archer in the simulation.
3. Two-weapon fighting and weapon sets: every character has main hand, off
   hand and a ranged slot at once (`PlayerCharacter.equipped.ranged`). Light
   weapons give an off-hand attack; Nick makes it free. Archer kit becomes
   longbow, shortsword and scimitar.

After that lands, the game layer (`src/game`) still needs to: call
`castOutOfCombat` for spells used while exploring, show concentration, play a
cast animation and sound for spell actions, and use the first preset in
`quickBuild` (it currently takes the first option of every choice, which pairs
the Archery style with the sword-and-shield kit).

## Known problems

- **Archer kit is far behind**: about 31% first-attempt clears on floor 3
  against about 69% for the melee kits. Items 2 and 3 above are the intended fix.
- **Players who rarely rest do badly** on floors 2 and 3 in the simulation.
- **Never checked on real hardware**: frame rate, touch on a real tablet, and
  how the sound actually sounds. All visual checks used a headless browser
  with software rendering.
- Magic item prices and the floors at which they appear are placeholders.
- The bugbear model is a recoloured orc and reads as a hairy brute.

## Next steps after the branch

1. Floors 4 to 20 following `docs/research/roster-options.md` (free assets,
   CC0 and CC-BY; floor 20 boss is the Young Red Dragon).
2. More generator set pieces. The whole-floor overview camera exists in the
   renderer preview (`/dev/render-preview.html?gen=1`, key `O` or `&overview=1`;
   `&piece=moat` steps the seed to the next floor with that set piece) but not
   in the game itself, where it would need a fog-of-war-aware map view.
3. A second class.

## How the work has been organised

One lead session owns `docs/DESIGN.md` and `src/core/types.ts` (the contracts
between modules) and delegates each module to a sub-agent with a written
brief; modules never import each other (see the module map in the design
doc). Commit and push to `main` only when `npm run typecheck`, `npm test` and
`npm run build` all pass. On Windows, run them from PowerShell: Vitest fails
under Git Bash.

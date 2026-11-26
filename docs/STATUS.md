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

## Floors 4 to 20: nine more themes (content only, not reachable yet)

Every floor now has a theme. Nine themes beyond the first three exist end to end except for play:

- **Flooded Sewers, floors 4 and 5.** Generator `src/gen/themes/sewers.ts`
  (channel tunnels, wet and dry chambers; set pieces sluice, flooded hall,
  grand cistern), look, grate and pipe props, ambience, eight SRD monsters.
  Bosses: Ochre Jelly, Green Hag.
- **Fungal Caverns, floors 6 and 7.** Generator `src/gen/themes/fungal.ts`
  (the warrens cave recipe with its own dressing and a grove set piece),
  look, giant mushroom prop, ambience, seven SRD monsters. Bosses: Chuul,
  Shambling Mound.
- **Bandit Hold, floors 8 and 9.** Generator `src/gen/themes/hold.ts` (a fort
  of furnished rooms: barracks, mess, stores, armoury; set pieces training
  yard, great hall, stockade), look, six props (bunk, table, weapon rack,
  banner, palisade, dummy), ambience, seven SRD humanoids on tinted hero
  rigs. Bosses: Tough Boss, Gladiator.
- **Sunken Library, floors 10 and 11.** Generator `src/gen/themes/library.ts`
  (bookshelf rows that make aisles and block sight, flooded rooms; set
  pieces rotunda, grand stacks, drowned wing), look, five props (bookshelf,
  desk, lectern, book pile, candelabra), ambience, eight SRD monsters.
  Bosses: Mage, Shield Guardian.
- **Foundry, floors 12 and 13.** Generator `src/gen/themes/foundry.ts` (the
  depths' platforms and bridges with workshop dressing), look with a lava
  surface in place of the chasm, four props (forge, anvil, crucible,
  ingots), ambience, thirteen SRD monsters from CR 1/2 to CR 9. Bosses:
  Fire Giant, Clay Golem.
- **Ice Caves, floors 14 and 15.** Generator `src/gen/themes/ice.ts` (the
  cave recipe, frozen: water is drawn as ice), look, ice spike and snow
  drift props, ambience, ten SRD monsters from CR 1/2 to CR 13 in
  `src/data/monsters/ice.ts`. Bosses: Remorhaz, Adult White Dragon.
- **Overgrown Ruin, floors 16 and 17.** Generator `src/gen/themes/ruin.ts`
  (crumbled rooms stepping up a hillside; set pieces sunken garden, grove,
  broken hall), an outdoor moonlit look, four props (gnarled tree, bush,
  vines, fallen column), ambience, fourteen SRD monsters from CR 1 to CR 15
  in `src/data/monsters/ruin.ts`. Bosses: Storm Giant, Adult Green Dragon.
- **Hell-touched Vault, floors 18 and 19.** Generator
  `src/gen/themes/hell.ts` (a descending prison over lava: barred cells,
  shrines, pits; set pieces chain pit, trench, summoning hall), look with
  lava, three props (altar, iron bars, sigil), ambience, thirteen SRD
  fiends from CR 1 to CR 19 in `src/data/monsters/hell.ts`. Bosses:
  Marilith, Balor.
- **Dragon's Lair, floor 20.** Generator `src/gen/themes/lair.ts` (the cave
  recipe, scorched, with a hoard that thickens toward the boss), look with
  lava cracks, gold pile and dragon bones props, ambience, nine SRD
  monsters from CR 1/8 to CR 24 in `src/data/monsters/lair.ts`. Boss: the
  Adult Red Dragon (CR 17). `docs/DESIGN.md` still says Young Red Dragon
  (CR 10), which is in the data as a tough regular; the Ancient Red Dragon
  (CR 24) is there too. Which one ends the game is the owner's call.

Per-floor casts and bosses are in `ENCOUNTER_TUNING`. See the floors at
`/dev/render-preview.html?gen=1&theme=sewers&depth=4`, `...theme=fungal&depth=6`
`...theme=hold&depth=8`, `...theme=library&depth=10`,
`...theme=foundry&depth=12`, `...theme=ice&depth=14`,
`...theme=ruin&depth=16`, `...theme=hell&depth=18` and `...theme=lair&depth=20`.

What is missing before `MILESTONE_FLOORS` can go past 3:

- **Fighter levels 4 to 20** (in `src/rules`, after the spell-engine branch).
- **Models.** The sewer, cavern and library monsters use tinted stand-ins from rigs we
  already ship (each has a `TODO model:` comment in `src/data/monsters.ts`
  naming the intended free model). Fetching needs `tools/assets/fetch.mjs`
  on a machine that can reach poly.pizza. The hold's humanoids are tinted
  hero rigs as planned; three still want a weapon or shield prop.
- **Balance.** Encounter budgets from level 4 are the untuned SRD figures and
  rooms on floors 5 to 13 come out over them. Tune with `src/balance` once the
  hero can reach those levels.
- **Casts follow the hero's level.** Nothing is listed per floor. A floor
  fields up to four kinds (`maxCastSize`, sampled per floor) of its theme's
  ordinary monsters that it can afford (XP at most `castBudgetFactor` times
  the level's room budget) and has not outgrown (CR at least
  floor(depth / 4), `minCrPerDepth`). Its boss is a boss-role monster of
  the theme whose CR fits the depth (`bossCrBand`); `bossByDepth` scripts
  the fixed run's order. All in `ENCOUNTER_TUNING`.
- **Every theme has monsters for other depths.** 42 tougher SRD monsters
  for the first seven themes live in `src/data/monsters/tough*.ts`, and
  each newer theme is given a wide CR range from the start. On the fixed
  run most of them are never placed; they are there for randomized runs.
- Monster features the engine cannot express yet were dropped or simplified
  (grapple and swallow, Split, Engulf, shape-shifting, auras, flying, Parry
  and other reactions, most spell lists); each is noted in a comment above the monster.

The monster AI never takes bonus actions, so the Priest's healing word is in
the data but will not be used until it does.

Stat blocks were transcribed from the SRD 5.2.1 text; a clean plain-text copy
is in the owner's `dnd_combat` repository (`SRD_CC_v5.2.1.txt`).

## How floors 4 to 20 are going: the quick party model

`src/balance/model.ts` estimates every floor before the real hero can reach
it. The floors and monsters are the real ones; the party is a model (a basic
sword-and-shield Champion Fighter at the floor's level, optionally with a
Fighter ally some levels lower) and combat has no grid. Run the table with:

    BALANCE_MODEL=1 BALANCE_ALLY=2 npx vitest run src/balance/model.test.ts --disableConsoleIntercept

The Fighter's progression from level 1 to 20 (proficiency bonus, attacks,
feature uses, critical range, feature names and summaries, engine flags) is
data in `src/data/fighter.ts`, checked against the SRD class table. The model
reads it, and it is written to be what `src/rules/classes.ts` extends its
Fighter from when levels 4 to 20 are built: `features` maps to
`ClassDef.features`, the uses columns to `resourcesAt`, `flags` to `flagsAt`.
The model's own assumptions (ability scores, gear by level) are in
`fighterAt` in `src/balance/model.ts`, not in the data.

Calibration against the real engine's solo hero on floors 1 to 3 (90 / 75 /
70% first-attempt clears): the model gives about 65 / 84 / 93%, so read it
for trends, not exact rates.

The owner has said the game will eventually give the hero an ally. Nothing in
the rules engine has one yet, and floors 1 to 3 are tuned for a solo hero;
treat "hero plus an ally about two levels lower" as the target when choosing
casts and tuning floors 4 and deeper.

What it shows today (26 November 2026): from floor 4 on, the floors are far
too easy. A solo hero clears floors 4 to 20 93 to 100% of the time and a
hero with an ally two levels lower essentially always, arriving at the boss
at full health. Raising room budgets alone runs out at about three times
the current figures, because the themes have no stronger monsters to spend
it on at those depths: floors from 4 down need tougher casts and bosses
(CR much nearer the hero's level), not just more of the same.

## Planned: randomized runs

The owner wants runs to vary eventually: not the same themes on the same
floors every time. Nothing implements this yet, and today three things pin a
theme to its depth. Keep them in mind when adding content so the change stays
small:

- `themeForDepth(depth)` is a fixed table. It would become a function of the
  run seed too, choosing among the themes allowed at that depth.
- `bossByDepth` scripts which boss each floor of the fixed run gets. Casts
  and bosses are otherwise already chosen by CR for the floor, and every
  theme has monsters across a wide CR range, so a theme placed at another
  depth populates itself. What is missing is knowing whether a floor is the
  first or second of its theme, so two floors do not get the same boss.
- Generators do not depend on depth except through room count, so they
  already work at any depth.

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

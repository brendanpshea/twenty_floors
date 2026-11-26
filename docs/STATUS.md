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

Three **outdoor themes** are not on the fixed run. Each can stand in for a
floor in a depth range (`ALTERNATE_THEMES` and `themesForDepth` in
`src/core/themes.ts`) once runs are randomized, and each has monsters and
bosses across that range. Generators are in `src/gen/themes/outdoor.ts`;
the renderer draws their walls as vegetation (`wallStyle: 'foliage'`) or
their chasm as open sky (`look.sky`).

- **The Wildwood** (`forest`, floors 1 to 10): clearings joined by paths,
  with trees, logs and standing stones. `...theme=forest&depth=3`.
- **The Drowned Fen** (`marsh`, floors 3 to 14): islands in standing water,
  half of every channel flooded, reeds on every shore. `...theme=marsh&depth=6`.
- **The Windswept Heights** (`peaks`, floors 5 to 18): the platform recipe
  as mountain ledges over open air. `...theme=peaks&depth=9`.

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

Floors 4 to 20 were re-tuned on 26 November 2026 for a hero with an ally two
levels lower (they had been 93 to 100% clears even solo). In
`ENCOUNTER_TUNING` (`src/rules/encounters.ts`), from floor 4 on:

- rooms hold up to 5 monsters (6 from floor 10) and at least 3;
- a theme's lesser bosses join the regular cast as elites
  (`eliteBossFromDepth`, `eliteBossCr`);
- monsters worth under 12% of the floor's budget drop out of the cast
  (`castFloorFactor`);
- bosses bring escorts (always, and up to 3, from floor 6; 4 from floor 10);
- the room budget and the boss come from a generated table, per theme and
  per floor (next section).

Twenty more SRD monsters (CR 4 to 21: metallic dragons, genies, golems,
devils, Lich, Mummy Lord, Rakshasa and others, in
`src/data/monsters/deepDragons.ts` and `deepRegulars.ts`) and wider theme
tags on existing ones give the thin themes (hold, library, foundry, ice,
fungal) regular monsters near the hero's level.

Floors 1 to 3 are untouched: same casts, same real-engine clear rates.

Model table for the fixed run, hero plus ally, 300 runs per floor
(first-attempt clears): 4: 75%, 5: 64%, 6: 73%, 7: 73%, 8: 70%, 9: 72%,
10: 76%, 11: 61%, 12: 65%, 13: 74%, 14: 64%, 15: 83%, 16: 68%, 17: 62%,
18: 88%, 19: 65%, 20: 77%.

Read these with care:

- The model is rough (see the calibration above), and the rates move in
  steps, not smoothly: a small budget change can drop a whole CR tier from
  the cast and swing a floor by 30 to 50 points. Re-tune against the real
  engine once the Fighter can reach these floors.
- Deaths come mostly from the rooms, not the boss: two fighters arriving
  rested kill a single boss in about three rounds, escorts or not. Making
  bosses the main danger needs boss mechanics (legendary actions, lair
  effects), which the engine does not have.
- These floors assume the ally; they were not measured for a solo hero.

## Randomized runs: built, not yet used by the game

The owner wants runs to vary: not the same themes on the same floors every
time. The pieces exist; the game itself still plays the fixed run.

- **Which theme goes where.** `planRunThemes(runSeed, { fixedFloors })` in
  `src/core/themes.ts` returns the 20 themes of a run. A theme stays one or
  two floors, is never used twice, only lands on floors inside its
  `THEME_RANGE`, and floor 20 is always the lair. `fixedFloors` (default 3)
  keeps the first floors on the fixed themes, because floors 1 to 3 are
  tuned against the real engine on those themes.
- **How a theme populates at any depth.** `THEME_TUNING` in
  `src/rules/encounterTable.ts` holds a room budget and a boss for all 109
  theme-and-floor pairings a run can produce. `buildEncounters` uses the
  entry for the plan's theme and depth, and falls back to `budgetByLevel`
  and `bossByDepth` only where there is none (floors 1 to 3 on their fixed
  themes). From floor 4 on those two fallbacks are no longer used.
- **Where the table comes from.** `src/balance/tune.ts` picks each boss by
  rule (`bossFor`: the theme's strongest boss with CR at most the floor,
  taking turns with the runner-up on even floors so two floors of a theme
  differ) and searches budgets with the party model for about 68% clears
  (75% solo on floors 1 to 3). Regenerate after changing monsters or
  encounter rules; it prints the table to paste into `encounterTable.ts`:

      BALANCE_TUNE=1 npx vitest run src/balance/tune.test.ts --disableConsoleIntercept

  (`BALANCE_TUNE=hold,ice` re-tunes only those themes. The whole table takes
  about 20 minutes on four cores when split into four runs by theme.)
  95 of the 109 entries land between 55% and 82% in the model; each entry
  records its figure as `modelClear`. The outliers are where rates jump in
  steps.
- **Seeing one.** The preview takes `?run=<seed>`: `,` and `.` then walk
  that run's floors.
- **To switch the game over** (in `src/game`, the laptop's territory):
  replace `themeForDepth(depth)` in `floorSession.ts` and `hubFlow.ts` with
  `planRunThemes(run.runSeed)[depth - 1]`. Nothing else needs to change;
  saves keep working because the plan is a pure function of the run seed.
- Alternates on floors 1 to 3 (forest on 1 to 3, sewers or marsh on 3, and
  the fixed themes swapped around, all only with `fixedFloors: 0`) are tuned
  with the model's solo hero, which is the model at its least reliable.
  Check them on the real engine before letting runs randomize those floors.

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

- **Crypt rooms are barer than their code intends** (found by the bug sweep of
  26 November, not fixed because floor 2 is tuned around it): treasure vaults
  never get their urns and sarcophagi, the grand nave never gets its statues
  or end braziers, and about 58% of crypt combat rooms have no blocking prop
  at all. Cause: symmetric groups are placed all-or-nothing, and one cell of
  the group is almost always in a doorway's reserved zone or diagonal to
  another blocker (`PropLayer.can` refuses a blocker that splits its ring of
  open neighbours). The depths' combat colonnade is lopsided for a related
  reason. Fixing these changes floors 2 and 3, so re-run the balance tests.
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

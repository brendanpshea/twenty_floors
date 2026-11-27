# Status and handoff

Last updated 27 November 2026. A snapshot for whoever picks the work up next,
in a new session or on another machine. `docs/DESIGN.md` has the design and
its decisions; this file only says where things stand.

## What is on `main`

The full game, floors 1 to 20, deployed by GitHub Actions to
https://brendanpshea.github.io/twenty_floors/ on every push to `main`
(the workflow runs type-check, tests and build first, on Node 24).

- A Champion Fighter, levels 1 to 20, built from one of three play-style
  presets; Human, Dwarf, Elf; four backgrounds with origin feats, including
  Magic Initiate (26 cantrips and level 1 spells).
- Twenty generated floors across fifteen themes. Floors 1 to 3 keep fixed
  themes; from floor 4 the themes vary with the run seed.
- A companion from level 4 (Sphinx of Wonder, Pseudodragon or Blink Dog) with
  its own level table, kit and player-chosen stance.
- Terrain as a weapon: Shove, falls and lava (1d6 per floor depth), slams into
  fire and spikes, prone in water, ice slides, cover. Every theme places push
  targets near its fights.
- Monsters fight by tactic (brute, skirmisher, archer, caster, leader, lurker,
  guard) and stand in formations.
- Long rests at rest sites, Hit Dice short rests, Last Stand; all SRD weapons
  and armor with +1 to +3 variants; all eight weapon masteries; weapon sets.
- About 190 SRD monsters; 107 of the deeper ones have their own model or an
  honest variant, 47 still use a stand-in.
- Synthesized sound, pause menu, saves, an autoplay bot (`?autoplay=1`,
  `?expert=1` for the terrain-aware policy).

Dev URL parameters: `?depth=N`, `?level=N`, `?theme=<id>`, `?seed=N`,
`?preset=`, `?background=`, `?spell=`, `?companion=`, `?stance=`,
`?reveal=1`, `?peace=1`, `?floors=N`.

## Chest finds lean toward the hero's build

A chest's magic find (+N gear or a magic item of its own) is drawn with
weights from `lootFit` in `src/rules/lootFit.ts`, not evenly. The weight
starts from the shop's comparison (`compareItem`: upgrade, trade-off,
sidegrade, downgrade, unsuitable, owned) and adds what that does not see:
weapons of a kind the hero holds or has mastered count more, and a worn
item counts only for what its effect does for this hero (Gauntlets of Ogre
Power are nothing at Strength 19). It is a bias, not a filter: every item
keeps a small chance. Whether a chest holds a find, its gold and its potions
are unchanged, and the lock puzzle's promised rewards use the same weights
as the payout. In a sample of gold-grade boss chests on floor 6, finds that
are plain upgrades rose from 32-39% to 82-86% for all three presets.
Weights are in `LOOT_FIT`. The balance harness still draws evenly
(`chestLoot` without `fit`); it only counts gold and potions from chests.

## The shop sells plain gear and consumables; magic is chest treasure

`shopStock` (`src/rules/character.ts`) stocks, for the hero at the counter:
the two strongest healing potions unlocked, up to four other potions or
oils of different kinds from floor 2 (bottled spells, see the potions
section below, and Resistance, Giant Strength, Invulnerability, Speed,
Flying, Oil of Slipperiness; by rarity unlocked, never legendary), a shield, up to two plain armors no weaker than the one
worn, and up to three plain weapons. At most 12 items
(`ITEM_GATING.shopMaxItems`). The shop sells no permanent magic at all.
There are no spell scrolls in the game yet.

Permanent magic comes from chests:

- **Boss chests** are the source of the powerful items: 75% hold a magic
  find at silver, every one at gold, about 37% at bronze
  (`bossChestMagicChance`). The find is +N gear of the depth's tier
  (weapons, shields and armor, named ones included) or a magic item of the
  top rarity unlocked.
- **Ordinary chests** keep their small chance of a lesser find: a +1 weapon
  or shield, or a magic item below the top unlocked rarity.
- Both lean toward the hero's build (previous section).

Open issue: the floor budgets were fitted with a hero who has the gear
schedule's +N weapons, armor and shield on time (`gearSchedule.ts`), and
who could buy it in the shop. Players now depend on boss chests for it and
will often be a floor or more behind the schedule, so floors from 4 on may
play harder than measured; and gold has less to be spent on.
`ITEM_GATING.shopScheduledMagic = true` restores the scheduled +N gear in
the shop (its tests still run with it on). The balance harness has not been
re-fitted for this.

## Buff and defense spells: one definition, for potions and for casters

There is no full caster in the party, so common buff and defense spells
come in bottles. Each spell is defined once in `src/data/buffs.ts` (`BUFFS`:
name, level, whether it needs concentration, its effects as passives, how
many fights a potion of it lasts). Two things use an entry:

- **A potion.** `src/data/magicItems.ts` builds the potions from the
  registry. They are timed consumables: no concentration, "10 minutes" is
  one fight, "1 hour" or more is three.
- **A spell cast in combat.** An action with the effect token `buff:<id>`
  puts the same effects on its target (`applyBuff` in
  `src/rules/combat.ts`); a concentration spell's effects come off when the
  caster's concentration ends. So giving a companion or a future caster
  Haste is one spell action carrying `buff:haste`; nothing else is needed.
  No hero or companion spell list has these yet.

| Buff | Effect | Potion |
|---|---|---|
| Bless | +1d4 to attacks and saves | Potion of Bless, 1 fight |
| Shield of Faith | +2 AC | 1 fight |
| False Life | 9 temporary hit points, once | until lost |
| Longstrider | +10 ft speed | 3 fights |
| Protection from Evil and Good | six creature types attack with disadvantage | 1 fight |
| Aid | +5 hit points and maximum | 3 fights |
| Blur | attackers have disadvantage | 1 fight |
| Barkskin | AC at least 17 | 3 fights |
| Enlarge | drawn 1.5 times as big, +1d4 weapon damage, advantage on Strength saves | SRD **Potion of Growth**, 1 fight |
| Haste | speed doubled, +2 AC, advantage on Dexterity saves, one extra weapon attack a turn | SRD **Potion of Speed**, 1 fight |
| Fire Shield | cold resistance; a melee attacker that hits takes 2d8 fire | 1 fight |
| Stoneskin | resistance to bludgeoning, piercing, slashing | 3 fights |
| Mirror Image | three duplicates; a hit lands on one when any rolls 3+ on a d6 | 1 fight |
| Death Ward | the first drop to 0 hit points becomes 1; then it ends | 3 fights, one use |
| Greater Invisibility | your attacks have advantage, attacks on you disadvantage | 1 fight |
| Polymorph | you become a Giant Ape (its AC 12, speed, fists and boulders) with its 168 hit points on top of yours; ends when they are gone | 3 fights |

Also the SRD **Potion of Heroism** (10 temporary hit points once, Bless for
three fights). Potions of Speed, Growth and Heroism are SRD items; the other
fourteen are ORIGINAL items holding SRD spells (family `spell_potion`:
100 gp for spell levels 1 and 2; 375 gp for Fire Shield, Stoneskin, Death
Ward and Greater Invisibility; 1,250 gp for Polymorph).

Not kept: Enlarge's larger space and reach; Haste's lethargy when it ends,
and its extra action is always a weapon attack; Protection's guard against
charm and fear; False Life is a flat 9.

How each one-use or lasting effect is carried between fights: Mirror
Image keeps the duplicates it has left (`_mirror`); Death Ward and Polymorph
end when used up in a fight (the combat engine leaves a `_spent_<type>` flag
and `syncFromCreature` drops the timed effect); Polymorph's remaining
borrowed hit points are the hero's temporary hit points.

Polymorph swaps the creature's Armor Class, speed, ability scores, actions,
traits, resistances, size and model for the form's (`takeForm` in
`src/rules/combat.ts`) and gives them back when the temporary hit points run
out or the spell ends. The hero cannot use weapons, Second Wind or Action
Surge as an ape. Not kept: Greater Invisibility's protection from effects
that need sight; Polymorph's saving throw (it is only cast on the willing).

On screen (`Renderer3D.setEntityState`): `veil` draws an invisible hero
see-through, `images` draws Mirror Image's duplicates as pale figures
circling the creature (plain shapes, not copies of the model), and a
polymorphed creature is respawned with the form's model. `lookOf` and
`shownVisual` in `src/game/floorState.ts` say what a creature should look
like; the playback applies them on the `unseen`, `mirrorImage`, `polymorph`
and `enlarge` combat events.

Enlarge's size is real on screen: `Renderer3D.setEntityState(id, { scale })`
eases a creature to a multiple of its size. The game sets it from the
`enlarge` and `enlargeEnd` combat events and, for the hero, from the
`_enlarged` flag whenever the hero is rebuilt.

The shop sells up to four different potions of this kind per visit: the
100 gp ones from floor 2, the others when their rarity unlocks (Speed from
floor 15). The scripted hero of the balance harness does not buy or drink
them, so the tuning does not count them.

## Magic shields

Besides Shield +1 to +3, the Sentinel Shield and the Shield of the Cavalier,
four SRD shields with effects of their own (all need attunement; found in
chests from the floor their rarity unlocks, never sold):

- **Arrow-Catching Shield** (rare): +2 Armor Class against ranged attack
  rolls; a ranged attack aimed at an ally within 5 ft is aimed at the bearer
  instead, using its reaction. House rule: the reaction is taken
  automatically unless the bearer is below a third of its hit points.
- **Shield of Missile Attraction** (rare, cursed): half damage from ranged
  weapon attacks; ranged weapon attacks aimed at an ally within 10 ft always
  go to the bearer. Not kept: the curse's hold (it can simply be taken off).
- **Spellguard Shield** (very rare): advantage on saves against magic; spell
  attack rolls against the bearer have disadvantage.
- **Animated Shield** (very rare): floats, so it goes with a two-handed
  weapon and lets a versatile weapon use both hands. Not kept: the bonus
  action to animate it and its one-minute limit (it is always animate). It
  still takes the off-hand slot, so it does not combine with a second weapon.

The effects are the passives `rangedAcBonus`, `interceptRanged`,
`rangedWeaponResistance`, `spellWard` and `handsFree`; combat reads them in
`attackSetup`, `rollAttack`, `interceptor` and the hit-damage loop of
`src/rules/combat.ts`. "Magic" means an action tagged `spell` or `magic`.
Monster spells and spell attacks get the `magic` tag by action name from
`MAGIC_ACTION_NAMES` in `src/data/monsters.ts` (63 actions; breath weapons,
venom, webs and thrown rocks are not magic). Add a name there when a new
monster brings a new spell. The tag also switches on Magic Resistance for a
companion that has it.

## How it is tuned (27 November 2026, approximate)

Each fixed-run floor's room budget was fitted on the real engine to a target
first-attempt clear rate for the expert scripted hero with a Blink Dog: 85%
on floors 1 to 3, 75% on 4 to 10, 67% on 11 to 19, 58% on floor 20. The fit
measured each floor on its own at 24 to 40 runs, so a floor's rate is known
only to within about ten points. On fresh seeds every floor landed within 12
points of its band (expert 57% to 88%; naive 46% to 92%).

- Themes off the fixed run use the multiplier of the nearest tuned floor and
  are extrapolated, not measured. Two spot checks were far off after a
  correction: marsh at floor 12 (17%) and peaks at floor 15 (46%).
- Gold was scaled up about four times so a sensible shopper can afford the
  gear the tuning assumes. Late-game gold may pile up.
- Re-run the fit with
  `FIT=1 FIT_MULTS=... FIT_RUNS=... npx vitest run src/balance/floorFit`
  and merge the results written to the temp directory.

Not achieved by the re-tune:

- Bosses are not the most dangerous fight from about floor 8 on; ordinary
  rooms cause nearly all deaths. Deep bosses need a mechanic the engine lacks
  (for example an extra boss action each round while an escort lives).
- The companion goes down two to four times per floor attempt, not once.
- The Archer preset is far behind (about 54%, 50% and 42% on floors 3, 6 and
  10 against roughly 90%, 71% and 88% for the Defender).
- Thinking pays on the deep floors (the expert leads the naive hero by 8 to 23
  points from about floor 8) but not measurably on floors 1 to 7.

Next tuning pass (agreed with the owner): measure health lost per fight
rather than whole-floor clear rates, which needs far fewer runs.

## Floors 4 to 20: the themes

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

## Randomized runs: in use

The owner wants runs to vary: not the same themes on the same floors every
time. The game now takes each floor's theme from `planRunThemes(runSeed)`
(`src/game/runPlan.ts`); floors 1 to 3 keep their fixed themes. Dev URL
parameters reach any floor: `?depth=1..20`, `?theme=<id>`, `?peace=1`
(monsters never start a fight) and `?reveal=1`.

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

## Work in order from here

Agreed with the owner, to make the game reward thinking (see
`docs/DESIGN.md`, "Making it a thinking game"). Terrain, tactics and
formations are done. Remaining, in order:

1. Tuning by health lost per fight; bosses as the peak; companion durability;
   the Archer preset.
2. Shop items beyond potions (SRD gear with tactical uses, scrolls, other
   potions), limited stock and carrying.
3. Chests locked by generated puzzles (timer sets loot quality; skippable for
   less), built as a general minigame system.
4. NPC and monster encounters that offer a game instead of a fight.
5. Interactive props (toppling bookshelves, kicking over braziers).

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
- **Players who rarely rest do badly** on floors 2 and 3 in the simulation.
- **Never checked on real hardware**: frame rate, touch on a real tablet, and
  how the sound actually sounds. All visual checks used a headless browser
  with software rendering.
- Magic item prices and the floors at which they appear are placeholders.
- The bugbear model is a recoloured orc and reads as a hairy brute.

## Next steps after the branch

1. Floors 4 to 20 following `docs/research/roster-options.md` (free assets,
   CC0 and CC-BY; floor 20 boss is the Adult Red Dragon).
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

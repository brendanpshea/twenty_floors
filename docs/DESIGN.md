# Twenty Floors: design

An open-source, turn-based dungeon crawler for the browser. One hero descends
twenty procedurally generated floors, fighting monsters from the D&D SRD 5.2.
Clearing a floor grants a level, so clearing floor 20 means reaching level 20.

## Pillars

1. **Feels like a modern RPG.** Baldur's Gate 3 is the reference: orbit camera,
   click or tap to move, an action bar, visible dice and hit chances, no rules
   knowledge required to start.
2. **Every floor is a place.** Floors are generated, themed and use height and
   space. A crypt, a cave and a chasm should feel like different levels, not
   reskins of one layout.
3. **Runs on a cheap laptop or tablet.** Small download, low draw-call count,
   touch as a first-class input. Phones work but are not the design target.
4. **Open all the way down.** MIT code, CC0/CC-BY assets, SRD-only rules content.

## Decisions

| Topic | Decision |
|---|---|
| Combat | Turn-based on a square grid. 1 cell = 5 ft. Diagonals cost 1. |
| Exploration | Free tap-to-move on the same grid. Entering a room with monsters starts initiative. |
| Camera | Orbit/zoom/pan, top-down three-quarter view. Never first-person. |
| Rules | SRD 5.2, bent where solo play needs it (see "Solo balance"). |
| Death | Restart the current floor from its entrance. The game auto-saves only on floor entry. |
| Progression | Clear the floor (defeat its boss) to unlock the stairs. The hub between floors gives the level-up, a shop and a full rest. |
| Characters | A real creation engine (species, class, background, abilities), with a small content set to start. |
| Art | Stylized low-poly. Procedural geometry for architecture, free open glTF models for creatures. |
| Asset licences | CC0 and CC-BY (any version) are both acceptable. Free assets only: no purchased or commissioned packs for now. Creature variety comes from recolouring and kit parts on the rigs we have (see `docs/research/kitbash-findings.md`). |
| Later floors | Floors 4 to 20 follow `docs/research/roster-options.md`. The final boss on floor 20 is a red dragon (planned as the Young Red Dragon, which fits the difficulty curve). |
| Rests | Resting in the middle of a floor is allowed. |
| Hosting | Static site on GitHub Pages. Saves in localStorage. No backend. |

## Solo balance

5e assumes a party of four. We adjust rather than pretend:

- The hero takes maximum hit points per level.
- **Last Stand.** Once per floor, when damage would reduce the hero to 0 HP,
  the hero drops to 1 HP instead. This replaces death saves. It is a visible
  resource that refreshes on entering a floor, not on a short rest. Monsters
  do not have it.
- Each floor allows two short rests (recover half of maximum HP and short-rest resources).
- The hub is a long rest.
- A prone creature stands automatically at the start of its turn for half its
  speed, and a creature held by an indefinite restraint (a spider's web) can
  spend its action on a Strength check to break free.
- A ranged attacker at least two elevation steps above its target gets +1 to hit.
- Encounters are budgeted for one hero: one to four monsters per combat room
  (about 1.5 to 1.7 on average on floors 1 to 3), with at most one monster
  above the hero's level in CR.
- A fight starts when the hero steps into a room with living monsters, or
  comes within 7 cells of walking distance of one with line of sight. All
  living monsters of that room join.
- Bosses for the first three floors: Goblin Boss, Ghoul, Bugbear Warrior. The
  Ogre proved too deadly for a level 3 hero alone and is held for later floors.

Numbers are tuned by simulating whole floors headlessly (`src/balance`), not
by feel. Targets for a first attempt by a player who rests and shops
sensibly: about 80% on floor 1, 75% on floor 2, 70% on floor 3. The archer
starting kit currently runs about 14 points behind on floor 3 and is the
harder choice.

Weapon Mastery is implemented only for Slow (longbow, javelin) and Vex
(shortsword).

## Milestone 1 (vertical slice)

- Fighter, levels 1 to 3. Species: Human, Dwarf, Elf. Backgrounds: Soldier, Criminal, Sage, Acolyte.
- Three floors: Goblin Warrens (organic caves), Forgotten Crypt (rooms and
  corridors), Sundered Depths (platforms and bridges over a chasm).
- About twelve SRD monsters across the three themes, each floor ending in a boss.
- Title, character creation, HUD, hub, death and victory screens.
- Playable with mouse and with touch on a tablet.

## Module map

```
src/core     Shared contracts (types.ts), seeded RNG, theme list. No logic beyond that.
src/data     Static content: monsters, items. Data only.
src/rules    Headless rules engine: dice, characters, combat, monster AI, encounters.
src/gen      Headless floor generation and navigation (pathfinding, line of sight).
src/render   three.js view: floor meshes, entities, camera, picking, effects.
src/ui       DOM overlay: screens and HUD.
src/game     The conductor: run state, exploration, event playback, saves. Wires everything together.
src/balance  Dev-only harness: a scripted hero plays generated floors headlessly to tune encounters.
```

Dependency rules:

- Every module may import `src/core`. `src/rules` may also import `src/data`.
- `rules`, `gen`, `render` and `ui` never import each other. They meet only
  through the interfaces in `src/core/types.ts`.
- Only `src/game` imports the other modules (`src/balance` may import `rules`,
  `gen` and `data`; dev preview pages may import what they need to demo).
- `rules` and `gen` are headless: no DOM, no three.js, and all randomness
  through `Rng` (`src/core/rng.ts`). They are covered by Vitest tests.

## How a turn flows

1. The UI reports a `UiIntent` (or the renderer a `PickResult`).
2. `game` turns it into a `Command` and calls `CombatApi.execute`.
3. `rules` returns a list of `GameEvent`s.
4. `game` plays the events back in order: renderer animations and floating
   text, log lines, then a fresh `HudModel` to the UI.

Monster turns are the same loop with the command chosen by the AI in `rules`.

## Floor generation

Generation is graph-first: decide the floor's structure (entrance, a chain of
combat rooms with side branches, treasure, boss, exit), then embed it in space
with a theme-specific generator. Every generator outputs the same `FloorPlan`,
and every plan must pass the same validation: entrance reaches exit on foot,
every room is reachable, spawn slots are walkable.

A floor is fully determined by `(runSeed, depth)`.

## Performance budget

Target: 30+ fps on an entry-level laptop or tablet with integrated graphics.

- WebGL2 via `WebGLRenderer`. Device pixel ratio capped (1.5, or 1 on low quality).
- Under 100 draw calls per frame: floor geometry merged or instanced per theme material.
- Vertex colors and one small shared palette texture instead of per-model textures.
- At most a handful of real lights; torches are emissive meshes plus baked vertex light.
- One shadow-casting light at most, off on low quality.
- Fog hides the far edge and lets us cull.
- Initial download under 10 MB; models are loaded per theme.

## Conventions

- TypeScript strict, ES modules, `import type` for type-only imports
  (`verbatimModuleSyntax` is on). Indexed access is checked
  (`noUncheckedIndexedAccess`).
- No runtime dependencies beyond three.js without discussion.
- Tests live beside the code as `*.test.ts`. `npm test` runs them, `npm run typecheck` type-checks.
- Rules content uses only material in SRD 5.2 (CC-BY-4.0). No non-SRD monsters, spells or names.
- Every third-party asset is listed in `CREDITS.md` with its license and source.

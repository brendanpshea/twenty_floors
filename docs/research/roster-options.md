# Roster options for floors 4 to 20

Research date: 26 November 2026. Planning document; nothing here is implemented.
Companion document: `open-model-survey.md` (the models, licences and evidence behind every model name used below).

## Bottom line

- A full roster for floors 4 to 20 can be built **today with free CC0 models and zero purchases**: 64 distinct SRD monsters over 17 floors (84 monster slots), using 17 new free model files plus the rigs we already ship. Quality is uneven: **3 monsters have a good model, 18 a usable one, 43 are tinted/scaled variants of an existing or newly listed rig**. 16 more candidates had no model at all and were dropped (list at the end).
- **The roster is cheap in rules**: 22 of the 64 need nothing the engine lacks today, 41 need one small addition (a trait id or an `effects` id), and only 1 (Remorhaz) needs a new subsystem, because I simplified or dropped features such as flying, swallowing, legendary actions and multi-cell bodies. The cost of being faithful to the full stat blocks is listed per monster.
- **Biggest art risks:** giants/trolls/golems all share one ogre rig (it is CC-BY 3.0, and eight roster monsters depend on it; a ninth, the Mummy, uses the CC-BY Animated Zombie); every flying creature and dragon uses cartoon models with only a flying clip set; elementals and the floor-20 dragon are weak matches. Spending about $76 on five KayKit packs would replace many tints with real models (see top 10).
- **Biggest rules decisions:** (1) flying (13 monsters), (2) auras and "damage to melee attackers" traits (11), (3) a handful of grapple-style effects (6). Breath cones/spheres already work: `src/rules/ai.ts` scores `point` targeting with `areaCells` for monsters (verified by reading the code, not by playing it).
- The SRD names and CR values below were extracted by script from the official SRD 5.2.1 PDF (329 stat blocks found; see "Sources").

## How to read the tables

- **Class**: *good* = a model that fits the creature and our style; *usable* = a separate model that is rigged and animated but cartoonier or only approximate; *variant* = recolour/rescale of a rig already in the game or already listed (for KayKit humanoids also re-armed with props from the same pack). "Variant" quality varies: tint only multiplies colours, so pale creatures from dark models are not possible. *None* = nothing found (these are the dropped ones).
- **Cost** (rules): 0 = fits today's `ActionDef`/traits; 1 = one small addition (new `TraitId` or `effects` id, no new subsystem); 2 = a new subsystem. The cost is for the *simplified* version named in the flags column.
- **Flags** = engine features the full stat block would need that `src/core/types.ts` cannot express today: FLY (flying; there is no movement mode, flying over chasms is not possible), GRAP (grapple/constrict as a held state; only `restrained`/`grappled` conditions exist), SWAL (swallow), ENGULF, AREA (breath/area: *supported*, listed for visibility), SPELL (a spell list with slots; spell-like actions with `uses`/`recharge` are cheap), SUMMON, LEGEND (legendary actions/resistance), BIG (body larger than one cell; the renderer already scales Large/Huge but they occupy one cell), REGEN, NMRES (resistance/immunity "to nonmagical" weapons; the data only has plain damage types), TELE (teleport), AURA (a standing area effect, or damage to melee attackers), SPLIT, DRAIN (maximum-HP drain), STAT (cannot move), PHASE (move through walls), REACT (reaction attacks such as Parry), SHAPE (shapechanger), DEATH (death burst). `petrified`, `deafened` and exhaustion are not conditions.
- Existing floors: 1 Goblin Warrens, 2 Forgotten Crypt, 3 Sundered Depths.
- The CR heuristic: regular monsters floor N / 4 to N / 2, boss N / 2 to N x 0.75. Where a regular monster is below the band it is deliberate filler for a group of 1 to 4.

## Proposed themes and what each needs from the generator

| Floors | Theme | Look | Generator note |
|---|---|---|---|
| 4 to 5 | Flooded Sewers | brick tunnels, knee-deep water, slime, pipes | `CellKind.Water` exists; rooms-and-corridors like the crypt |
| 6 to 7 | Fungal Caverns | glowing mushrooms, webs, spores, dark | organic cave like the warrens |
| 8 to 9 | Bandit Hold | palisades, barracks, stolen goods, banners | rooms and corridors, wooden props |
| 10 to 11 | Sunken Library | shelves, reading desks, flooded corners, arcane light | rooms; water cells for the flooded wings |
| 12 to 13 | Foundry | forges, anvils, rails, lava channels | platforms and bridges like the depths; lava = a re-skinned `Chasm` |
| 14 to 15 | Ice Caves | blue ice, snow, slick caves | organic cave with elevation; palette swap |
| 16 to 17 | Overgrown Ruin | broken walls, roots, ivy, open sky | rooms with missing walls; elevation |
| 18 to 19 | Hell-touched Vault | red stone, braziers, chains, brimstone | rooms and corridors; lava chasms |
| 20 | Dragon's Lair | one huge cavern, hoard, bones | boss arena with ledges; a chasm ring |

## Floor-by-floor roster

Every monster's model, class and rules gaps are in the next table (by first appearance).

| Floor | Theme | Regular monsters (CR) | Boss (CR) | Fit to the CR heuristic |
|---|---|---|---|---|
| 4 | Flooded Sewers | Giant Frog (1/4); Giant Toad (1); Gray Ooze (1/2); Giant Rat (1/8) | Ochre Jelly (2) | reg 1 to 2, 3 below; boss 2 to 3: in |
| 5 | Flooded Sewers | Giant Toad (1); Wererat (2); Giant Constrictor Snake (2); Gelatinous Cube (2) | Green Hag (3) | reg 1.25 to 2.5, 1 below; boss 2.5 to 3.75: in |
| 6 | Fungal Caverns | Giant Spider (1); Grick (2); Violet Fungus (1/4); Gibbering Mouther (2) | Chuul (4) | reg 1.5 to 3, 2 below; boss 3 to 4.5: in |
| 7 | Fungal Caverns | Ettercap (2); Grick (2); Darkmantle (1/2); Giant Spider (1) | Shambling Mound (5) | reg 1.75 to 3.5, 2 below; boss 3.5 to 5.25: in |
| 8 | Bandit Hold | Scout (1/2); Bandit Captain (2); Berserker (2); Warrior Veteran (3) | Tough Boss (4) | reg 2 to 4, 1 below; boss 4 to 6: in |
| 9 | Bandit Hold | Priest (2); Berserker (2); Hobgoblin Captain (3); Warrior Veteran (3) | Gladiator (5) | reg 2.25 to 4.5, 2 below; boss 4.5 to 6.75: in |
| 10 | Sunken Library | Animated Armor (1); Gargoyle (2); Wight (3); Doppelganger (3) | Mage (6) | reg 2.5 to 5, 2 below; boss 5 to 7.5: in |
| 11 | Sunken Library | Gargoyle (2); Mummy (3); Wight (3); Ghost (4) | Shield Guardian (7) | reg 2.75 to 5.5, 1 below; boss 5.5 to 8.25: in |
| 12 | Foundry | Azer Sentinel (2); Hell Hound (3); Flesh Golem (5) | Fire Giant (9) | reg 3 to 6, 1 below; boss 6 to 9: in |
| 13 | Foundry | Hell Hound (3); Fire Elemental (5); Earth Elemental (5); Salamander (5) | Clay Golem (9) | reg 3.25 to 6.5, 1 below; boss 6.5 to 9.75: in |
| 14 | Ice Caves | Winter Wolf (3); Ice Mephit (1/2); Ettin (4); Troll (5) | Frost Giant (8) | reg 3.5 to 7, 2 below; boss 7 to 10.5: in |
| 15 | Ice Caves | Winter Wolf (3); Ettin (4); Troll (5); Wraith (5) | Remorhaz (11) | reg 3.75 to 7.5, 1 below; boss 7.5 to 11.2: in |
| 16 | Overgrown Ruin | Shambling Mound (5); Wyvern (6); Chimera (6); Giant Ape (7) | Treant (9) | reg 4 to 8; boss 8 to 12: in |
| 17 | Overgrown Ruin | Drider (6); Giant Ape (7); Wyvern (6); Chimera (6) | Cloud Giant (9) | reg 4.25 to 8.5; boss 8.5 to 12.8: in |
| 18 | Hell-touched Vault | Hell Hound (3); Barbed Devil (5); Vrock (6); Bone Devil (9) | Erinyes (12) | reg 4.5 to 9, 1 below; boss 9 to 13.5: in |
| 19 | Hell-touched Vault | Barbed Devil (5); Vrock (6); Hezrou (8); Bone Devil (9) | Horned Devil (11) | reg 4.75 to 9.5; boss 9.5 to 14.2: in |
| 20 | Dragon's Lair | Kobold Warrior (1/8); Half-Dragon (5); Wyvern (6); Young Black Dragon (7) | Young Red Dragon (10) | reg 5 to 10, 1 below; boss 10 to 15: in |

Floor 20 boss: Young Red Dragon (CR 10) sits at the very bottom of the heuristic. The upgrade is Adult Red Dragon (CR 17, above the band) which adds LEGEND, FLY and a bigger breath, and would want a better dragon model than any we found.

## Monster to model, with rules gaps

| Monster | CR | First floor | Model that represents it | Class | Rules gaps (flags) | Cost |
|---|---|---|---|---|---|---|
| Giant Rat | 1/8 | 4 | existing `giant_rat` (Quaternius Rat, CC0) | good | none | 0 |
| Giant Frog | 1/4 | 4 | Quaternius Frog 37wofOCOzG (CC0) | usable | GRAP (grapple as a plain bite) | 1 |
| Gray Ooze | 1/2 | 4 | Quaternius Slime LyjSUKHKnh (CC0) | usable | none (`amorphous` exists; skip Corrode Metal) | 0 |
| Giant Toad | 1 | 4 | Frog model x1.4, tint | variant | GRAP, SWAL (drop Swallow) | 1 |
| Ochre Jelly | 2 | 4 | Slime x1.8, ochre tint | variant | SPLIT (drop Split (full: tier 2)) | 0 |
| Wererat | 2 | 5 | KayKit Rogue_Hooded (human form only) | variant | SHAPE (no hybrid form, no curse) | 0 |
| Giant Constrictor Snake | 2 | 5 | Quaternius Snake x9x0viZs8V (CC0; no hit/death clips) | usable | GRAP (constrict as restrain-on-hit) | 1 |
| Gelatinous Cube | 2 | 5 | Slime x2.2, cyan tint (no translucency) | variant | ENGULF, BIG (one-cell ooze with acid touch (full: tier 2)) | 1 |
| Green Hag | 3 | 5 | KayKit Mage, hag tint (or Witch, Mystery Monthly 5, paid, unseen) | variant | SPELL (claws plus a few spell-like actions) | 1 |
| Violet Fungus | 1/4 | 6 | Quaternius Mushnub LWKmS30Xxl (CC0) | usable | STAT, GRAP (cannot move; tendrils restrain) | 1 |
| Giant Spider | 1 | 6 | existing `giant_spider` | good | none (web already works) | 0 |
| Grick | 2 | 6 | Snake model x1.2, grey tint | variant | NMRES (resists nonmagical damage) | 1 |
| Gibbering Mouther | 2 | 6 | Quaternius Green Spiky Blob IoWG5F9WUc (CC0) | usable | AURA, AREA (Blinding Spittle as a ranged blind; skip the gibbering aura) | 1 |
| Chuul | 4 | 6 | Quaternius Crab Enemy Gs3yfsV5lB (CC0; not seen rendered) | usable | GRAP (pincer grapple; tentacle paralysis already expressible) | 1 |
| Darkmantle | 1/2 | 7 | Quaternius Bat hNO9XvjlKa (CC0) | usable | FLY, AURA (ground-bound bat) | 1 |
| Ettercap | 2 | 7 | existing spider model x1.1, tint | variant | none (`spiderClimb` and web exist) | 0 |
| Shambling Mound | 5 | 7 | Quaternius Mushroom King grnFTziU8u (CC0) | usable | ENGULF (skip Engulf) | 1 |
| Scout | 1/2 | 8 | KayKit Rogue_Hooded + bow prop | variant | none | 0 |
| Bandit Captain | 2 | 8 | `hero_rogue`, tint | variant | REACT (skip Parry) | 0 |
| Berserker | 2 | 8 | `hero_barbarian`, tint | variant | none | 0 |
| Warrior Veteran | 3 | 8 | `hero_knight`, tint | variant | none | 0 |
| Tough Boss | 4 | 8 | `hero_barbarian` x1.15 + two-handed axe prop | variant | none | 0 |
| Priest | 2 | 9 | `hero_mage` (or Cleric, Mystery Monthly 6, paid) | variant | SPELL (`heal` field exists; skip Spirit Guardians) | 1 |
| Hobgoblin Captain | 3 | 9 | existing `orc` model, red tint | variant | AURA (skip Leadership) | 1 |
| Gladiator | 5 | 9 | `hero_knight` + round shield prop | variant | REACT (skip Parry or add a reaction) | 1 |
| Animated Armor | 1 | 10 | `hero_knight`, dark tint | variant | none | 0 |
| Gargoyle | 2 | 10 | Quaternius Blue Demon S7jYW6Amye (CC0), stone tint | usable | FLY, NMRES (walks; resistance) | 1 |
| Wight | 3 | 10 | `skeleton_warrior`, green tint | variant | DRAIN (plain necrotic damage (full: max-HP drain, tier 1)) | 0 |
| Doppelganger | 3 | 10 | KayKit Rogue_Hooded, grey tint | variant | SHAPE (attack only) | 0 |
| Mage | 6 | 10 | `hero_mage` | variant | SPELL (3 to 4 spell actions (Fireball as a sphere), `uses` for limits) | 1 |
| Mummy | 3 | 11 | existing `ghoul` model (Animated Zombie, CC-BY), bandage tint | variant | AURA (Dreadful Glare as a save-or-frightened action) | 1 |
| Ghost | 4 | 11 | existing `shadow` model (Quaternius Ghost, CC0) | good | PHASE, FLY (Withering Touch + Horrifying Visage; no wall-walking (full: tier 2)) | 1 |
| Shield Guardian | 7 | 11 | KayKit Skeleton Golem (Skeletons Extra, $7.95, CC0, unseen), else ogre rig | usable | SPELL (skip spell storing) | 1 |
| Azer Sentinel | 2 | 12 | `hero_barbarian`, red-orange tint | variant | AURA (fire damage to melee attackers) | 1 |
| Hell Hound | 3 | 12 | existing `wolf` model, red tint | variant | AREA (fire breath cone with `recharge` (AI use of areas unverified)) | 0 |
| Flesh Golem | 5 | 12 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre), stitched tint | variant | NMRES (immune to nonmagical damage; skip Berserk) | 1 |
| Fire Giant | 9 | 12 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.5, red tint | variant | BIG (thrown boulder = ranged attack) | 0 |
| Fire Elemental | 5 | 13 | existing ghost model, orange tint (weak match) | variant | AURA (fire touch) | 1 |
| Earth Elemental | 5 | 13 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre), grey tint | variant | PHASE (skip Earth Glide) | 0 |
| Salamander | 5 | 13 | Quaternius Dino wuerCFCWNR (CC0), orange tint | usable | GRAP, AURA (tail constrict = restrain) | 1 |
| Clay Golem | 9 | 13 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.4, clay tint | variant | NMRES, AURA (immunity; skip Berserk/Haste) | 1 |
| Ice Mephit | 1/2 | 14 | Quaternius Hywirl zjr7CmWGER (CC0), blue tint | usable | FLY, DEATH (grounded; skip death burst) | 1 |
| Winter Wolf | 3 | 14 | existing `wolf` model, white tint | variant | AREA (`packTactics` exists; frost breath cone) | 0 |
| Ettin | 4 | 14 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.15 | variant | none (two weapon attacks via `multiattack`) | 0 |
| Troll | 5 | 14 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.1, green tint | variant | REGEN (regeneration with fire/acid exception) | 1 |
| Frost Giant | 8 | 14 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.4, ice tint | variant | BIG | 0 |
| Wraith | 5 | 15 | existing ghost model, darker tint | variant | DRAIN, PHASE (Life Drain as necrotic) | 1 |
| Remorhaz | 11 | 15 | Snake model x4, ice tint (weak) | usable | SWAL, AURA, BIG (swallow is the whole point) | 2 |
| Wyvern | 6 | 16 | Quaternius Dragon 3rUm1cN3yp (CC0) | usable | FLY (poison stinger; can stay grounded) | 1 |
| Chimera | 6 | 16 | Quaternius Dragon, orange tint x1.1 | variant | FLY, AREA (fire breath cone) | 1 |
| Giant Ape | 7 | 16 | Quaternius Yeti S1E7idPFhe (CC0), brown tint | usable | none (two fists via `multiattack`; boulder throw) | 0 |
| Treant | 9 | 16 | Quaternius Mushroom King x2, green-brown tint | variant | SUMMON, BIG (skip Animate Trees) | 1 |
| Drider | 6 | 17 | existing spider model x1.3, dark tint | variant | SPELL (skip innate spells) | 1 |
| Cloud Giant | 9 | 17 | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) x1.5, pale blue tint | variant | BIG, TELE (skip Misty Step) | 1 |
| Barbed Devil | 5 | 18 | Quaternius Demon LnfIziKv4o (CC0, imp with trident) | usable | AURA (barbed hide: damage to melee attackers) | 1 |
| Vrock | 6 | 18 | Quaternius Birb gZ2ExU9OAB (CC0), dark red (weak) | usable | FLY, AREA (Stunning Screech as a sphere + stunned) | 1 |
| Bone Devil | 9 | 18 | `skeleton_warrior` x1.5, dark red tint | variant | FLY (poison stinger) | 1 |
| Erinyes | 12 | 18 | `hero_knight` x1.15, dark red tint (no wings) | variant | FLY, REACT (rope = restrain; skip Parry) | 1 |
| Hezrou | 8 | 19 | Frog model x2, red-brown tint | variant | AURA (stench as a poison aura; skip) | 1 |
| Horned Devil | 11 | 19 | Quaternius Demon x1.5, dark tint | variant | FLY (Hurl Flame ranged) | 1 |
| Kobold Warrior | 1/8 | 20 | existing goblin model x0.8, red tint | variant | none (`packTactics` exists) | 0 |
| Half-Dragon | 5 | 20 | `hero_barbarian`, scale-green tint | variant | FLY, AREA (breath cone) | 1 |
| Young Black Dragon | 7 | 20 | Quaternius Dragon Evolved LlwD0QNUPj (CC0), black tint | variant | FLY, AREA (acid line breath; grounded) | 1 |
| Young Red Dragon | 10 | 20 | Quaternius Dragon Evolved x1.8, red tint | usable | FLY, AREA (fire cone breath; grounded; no legendary actions) | 1 |

## Coverage summary

| Class | Distinct monsters | Monster slots (84 total) |
|---|---|---|
| good | 3 | 4 |
| usable | 18 | 25 |
| variant | 43 | 55 |
| none (dropped) | 16 | 0 |

- **Rules cost** across the 64 distinct monsters: cost 0 = 22, cost 1 = 41, cost 2 = 1. By slot: 31, 52, 1.
- **Models that must be added to the game** for this roster (all free, CC0 unless noted): Quaternius Frog, Slime, Snake, Mushnub, Green Spiky Blob, Crab Enemy, Bat, Mushroom King, Blue Demon, Dino, Hywirl, Yeti, Demon (imp with trident), Birb, Dragon, Dragon Evolved, plus KayKit Rogue_Hooded (already in the GitHub pack we use). Big arm, Orc, Ghost, Rat, Spider, Wolf, Goblin, KayKit heroes and skeletons are already shipped.
- Honest weak spots: Fire Elemental (orange ghost), Remorhaz (huge snake), Vrock (a bird), Gelatinous Cube (opaque slime), Gibbering Mouther, Earth/Flesh/Clay Golem (all the same ogre), final dragon (cartoon).
- Dropped for lack of a model: Owlbear (3), Polar Bear (2), Brown Bear (1), Lion (1), Tiger (1), Mimic (2), Giant Scorpion (3), Minotaur of Baphomet (3), Medusa (6; also needs a `petrified` condition), Crocodile (1/2), Giant Crocodile (5), Griffon (2), Hydra (8), Animated Flying Sword (1/4; a prop, no rig), Werewolf (3) and Vampire (13). The last two come back if KayKit Mystery Monthly 4 and 5 are bought (the pages list a Werewolf and a Vampire; unseen).

## The 10 most valuable models to acquire or commission

Ordered by how many roster monsters each would improve. "Buy" = existing CC0 pack; "commission" = nothing open exists.

| # | Model | How | Roster monsters it improves | Why |
|---|---|---|---|---|
| 1 | A chunky KayKit-style giant/ogre/troll (with Rig_Large animations) | commission | Ettin, Troll, Frost Giant, Fire Giant, Cloud Giant, Flesh Golem, Clay Golem, Earth Elemental (8, plus the existing Ogre) | One shape serves a whole family and removes the only CC-BY dependency in the roster |
| 2 | Devil/demon family in our style: imp, bearded/barbed/bone/horned devil, vrock | commission | Barbed Devil, Vrock, Bone Devil, Hezrou, Horned Devil, Erinyes (6) | Floors 18 and 19 are otherwise scaled imps |
| 3 | KayKit Adventurers "Extra" ($7.95) | buy | all 15 KayKit-humanoid variants (Scout, Bandit Captain, Berserker, Veteran, Tough Boss, Priest, Gladiator, Animated Armor, Mage, Erinyes, Doppelganger, Wererat, Azer Sentinel, Half-Dragon, Green Hag) | adds Druid and 3 alternate colour textures per character: distinct-looking factions without tint hacks |
| 4 | Mystery Monthly series 5 ($19.99) | buy | Green Hag (Witch), Erinyes/devils (Tiefling), Frost/Clay/Flesh Golem (Frost Golem), plus Vampire (floor 20 alternative) | the single most useful paid pack (Vampire, Witch, Frost Golem, Black Knight, Tiefling) |
| 5 | KayKit Skeletons "Extra" ($7.95) | buy | Shield Guardian, golems, a Necromancer boss | a boss-sized Skeleton Golem in exactly our style |
| 6 | A chunky dragon with ground animations (idle, walk, attack, hit, death, breath) | commission | Wyvern, Chimera, Young Black Dragon, Young Red Dragon (4) | the floor-20 boss deserves it; the cartoon dragons only have flying clips |
| 7 | Mystery Monthly series 6 ($19.99) | buy | Priest (Cleric), Hobgoblin Captain (Orc Brute), Shambling Mound/Treant (Plant Warrior), Vrock (Avian Swordsman) | |
| 8 | Elemental set: fire, earth, ice mephit, salamander | commission | Fire Elemental, Earth Elemental, Ice Mephit, Salamander, Azer Sentinel (5) | nothing exists |
| 9 | Bear and big-cat quadrupeds with Attack/HitReact/Death | commission | none placed yet; unlocks Owlbear, Polar/Brown Bear, Lion, Tiger | animals are the fastest way to fill early floors |
| 10 | Mystery Monthly series 4 ($19.99) | buy | Hobgoblin/Orc variants (Orc Raider), Werewolf, Gladiator/Warrior (Paladin) | |

Also worth doing (free): KayKit Character Animations, to give the roster hit/death/cast clips beyond what each model ships with. Ranking caveat: items 3, 4, 5, 7 and 10 total about $76 ($7.95 + $19.99 + $7.95 + $19.99 + $19.99) and are unseen; the style claim ("technically identical to the Adventurers characters" on the series 6 page) is from the seller.

## Rules features that unlock the most monsters

Counts are monsters in the 64 for which the feature is part of the full stat block.

| Feature | Monsters | Cost to the engine | Notes |
|---|---|---|---|
| Flying movement | 13 (all grounded in this roster) | new movement mode, pathing over chasm/water, renderer lift | purely a fidelity gain; the roster works without it |
| Aura / "hurts melee attackers" / persistent area | 11 | one or two trait ids (`fireAura`, `barbedHide`), an end-of-turn area hook | cheap and visible to the player |
| Breath/area actions | 8 | none (supported); needs a balance pass | already expressible with `targeting.point`, `recharge`, `save.halfOnSave` |
| Grapple / restrain-on-hit | 6 | an `applies` plus escape check; `Break Free` for `restrained` already exists | small |
| Big bodies (2x2) | 6 | pathing, occupancy, renderer | skip until after floor 10 |
| Spellcasting | 5 | none for spell-like actions with `uses`; slots are not needed | Mage, Priest, Hag, Drider, Guardian |
| Resistance to nonmagical damage | 4 | split `resistances` into magical/nonmagical | the data only has plain types |
| Regeneration | 1 (Troll) | one trait | but unlocks more beyond this roster |
| Swallow/engulf | 4 | new subsystem | avoid |
| Legendary actions | 0 in the roster | new subsystem | needed only for the floor-20 upgrade |

Order of work if the owner wants to be economical: AURA first, then GRAP, then flying, then BIG. Reactions (Parry, 3 monsters) and `petrified` are small but each unlocks a classic monster.

## Alternative roster A: strictly CC0 assets only

Nine monsters depend on the CC-BY Big arm or the CC-BY Animated Zombie model: Mummy, Flesh Golem, Earth Elemental, Fire Giant, Clay Golem, Ettin, Troll, Frost Giant, Cloud Giant. Swap in:

- All eight giant-family monsters: the CC0 Quaternius **Orc** (already shipped; bigger/greener/redder variants at x1.3 to x1.6). It is a less hulking shape, so these become *usable* instead of *variant* quality; they would look like bigger orcs.
- Mummy: a bandage-tinted `skeleton_rogue` or KayKit Rogue_Hooded (both CC0).
- Everything else in the roster above is already CC0, including all KayKit packs (free and paid) and every Quaternius model I listed from poly.pizza.
- **Floors 1 to 3 already carry three CC-BY models** (Zombie chubby, Animated Zombie, Big arm). To be strictly CC0 the Ogre, Zombie and Ghoul need replacements: Ogre becomes an Orc variant; Zombie and Ghoul can use pale-tinted KayKit Rogue_Hooded or Skeleton variants. The CC0 Quaternius zombies I found are blocky (wrong style).
- Cost of the choice: tiny. Consequence: CREDITS.md needs no attribution lines (credit is optional under CC0), and the repo has a single licence family.
- If "strictly free" is also required, drop the paid packs; nothing in the main roster needs them.

## Alternative roster B: humanoid-heavy (KayKit heroes and skeletons with kit variations)

Leans on four rigs (Knight, Barbarian, Rogue/Rogue_Hooded, Mage) and four skeletons plus weapon props, with tints (or the $7.95 Extra textures). Rules cost stays low: mostly attacks, spell-like actions and the existing heal/condition fields.

| Floors | Theme | Regular monsters (CR) | Boss by floor (CR) |
|---|---|---|---|
| 4 to 5 | Smugglers' Cellar (bandits) | Bandit (1/8), Scout (1/2), Cultist (1/8), Priest Acolyte (1/4), Bandit Captain (2) | F4 Bandit Captain (2); F5 Knight (3, a renegade) |
| 6 to 7 | Cultist Catacombs | Cultist (1/8), Cultist Fanatic (2), Skeleton (1/4), Zombie (1/4), Ghoul (1), Ghast (2) | F6 Wight (3); F7 Vampire Spawn (5) |
| 8 to 9 | Fallen Keep (knights) | Warrior Veteran (3), Knight (3), Animated Armor (1), Warhorse Skeleton (1/2), Minotaur Skeleton (2) | F8 Guard Captain (4); F9 Gladiator (5) |
| 10 to 12 | Wizard's Sanctum | Cultist Fanatic (2), Priest (2), Gargoyle (2), Specter (1), Homunculus (0), Animated Armor (1) | F10 Mage (6); F11 Assassin (8); F12 Invisible Stalker (6) |
| 13 to 19 | Necropolis and Dark Tower | Skeleton (1/4), Wight (3), Mummy (3), Wraith (5), Vampire Spawn (5), Ogre Zombie (2), Minotaur Skeleton (2), Knight (3), Assassin (8), Mage (6) | F13 Vampire Spawn (5)*; F14 Assassin (8); F15 Mage (6)*; F16 Archmage (12); F17 Assassin (8)*; F18 Vampire (13); F19 Archmage (12) |
| 20 | The Crypt Throne | Wight (3), Wraith (5), Vampire Spawn (5), Mummy (3) | Mummy Lord (15), or Vampire (13) |

\* below the heuristic band for that floor.

Notes: the SRD has a gap of undead bosses between Wraith/Vampire Spawn (5) and Vampire (13), so mid-range bosses of this roster have to be humanoids (Mage 6, Assassin 8, Archmage 12), reused at several depths. Costs: Mage/Archmage/Priest need SPELL-lite actions; Vampire (shapechange, charm, legendary) and Mummy Lord (legendary, rotting) need LEGEND; Wraith/Vampire Spawn need DRAIN. Models: Vampire and Mummy Lord are best served by Mystery Monthly 5 (Vampire, unseen) or a pale KayKit Mage; undead footsoldiers are covered by the shipped skeleton pack. Honest weakness: visual repetition across 17 floors, which is the reason to buy the Adventurers Extra and Mystery Monthly textures.

## Sources and method

- **SRD names and CRs**: the official SRD 5.2.1 PDF (`https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf`, 6 MB, downloaded 26 Nov 2026), converted with `pdftotext`, then a script (`assets-src/_tools_survey/srdlist2.py`) found each stat-block header (size/type line) and its `CR n (XP ...)` line. 329 blocks; 6 have no single CR (Animated Object, Draconic Spirit, Otherworldly Steed, Giant Insect, Avatar of Death) or failed to parse (Gold, Silver and White Dragon Wyrmling, Young White Dragon: none are used). I spot-checked about 25 CRs against what I know of the 2024 stat blocks (e.g. Giant Toad 1, Gray Ooze 1/2, Gargoyle 2, Hobgoblin Captain 3, Tough Boss 4, Mage 6, Horned Devil 11, Young Red Dragon 10); the rest are as extracted. Names are the SRD 5.2.1 spellings (Goblin Warrior, Bandit Captain, Minotaur of Baphomet...). Yeti, Beholder, Mind Flayer and Lizardfolk do not appear in the extracted list, so none is proposed; **the Quaternius Yeti model is used only as the stand-in body for Giant Ape**.
- **Rules gaps**: read from `src/core/types.ts` (`ActionDef`, `TraitId`, `Condition`, `Targeting`) and `src/rules/ai.ts`. I did not read the engine in depth or run it; "supported" means the type system and the AI have a path for it.
- **Models**: see `open-model-survey.md`. Variant claims assume `VisualSpec.tint` and `scale` and, for props, the same build-time attachment approach already used for the skeletons' weapons; the viewer/renderer was not changed.
- **Not verified**: every in-game appearance (nothing was integrated); the look of tinted variants (I only viewed untinted models); contents and style of the paid KayKit packs; the stat details of the transcribed monsters (this document picks names and models, it does not transcribe stat blocks).

## Decisions for the project owner

1. Accept the cartoon-eyed Quaternius monsters for the cave and hell floors, or budget to commission a consistent set (items 1, 2, 6 above)?
2. Buy the roughly $76 of KayKit packs now, or start with free assets only?
3. Which rules features to build first (aura, grapple, flying, big bodies)?
4. Whether to depend on the CC-BY ogre for the giant family, or go CC0-only.
5. Whether the floor-20 boss should be the heuristic-compliant Young Red Dragon or the climactic Adult Red Dragon (needs legendary actions, flying and a better model).

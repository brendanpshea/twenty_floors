# Open creature model survey

Research date: 26 November 2026. Feasibility study only; nothing here is integrated.
Companion document: `roster-options.md` (which monsters to put on floors 4 to 20).

## Bottom line

- **Humanoids and skeletons are solved.** KayKit (CC0) gives us a style-perfect hero rig with 75+ animation clips and a weapon kit. Anything human-shaped (bandits, cultists, knights, mages, priests, vampires, werewolves) can be a tinted, re-armed KayKit rig. This is the safest 40 to 50 percent of the roster.
- **Animals and "classic" monsters are covered, but in a cuter style.** Quaternius' Ultimate Monsters (50 creatures, CC0) is the only large free source of non-humanoid rigged monsters. Many are smooth and chunky, but several have big cartoon eyes ("chibi"). I rate those *usable*, not *good*. They have all three of idle/walk/attack in most cases, hit and death in nearly all.
- **Clear gaps (nothing found, verified by search and download): bears, scorpions, minotaurs/bull-men, mimics, fire/water/earth elementals, trolls and giants in a non-ogre shape, a "serious" dragon, any big tentacled creature.** Giants, trolls and golems can all reuse the one ogre rig (Quaternius "Big arm", CC-BY 3.0) with scale and tint.
- **Flyers (dragons, imps, gargoyles, mephits, vrocks) only ship with a flying clip set** (Flying_Idle, Fast_Flying, Headbutt, Punch, HitReact, Death). Fine for a hovering monster; they have no "walk".
- **Paid but CC0 and almost certainly in our style:** KayKit "Mystery Monthly" series 4, 5 and 6 ($19.99 each) and the Skeletons "Extra" tier ($7.95: Skeleton Golem and Necromancer). Together they would cover orcs, a werewolf, a vampire, a witch, a frost golem, a tiefling, a paladin, a cleric, a plant warrior and a skeleton golem. I could not download them, so contents come from the itch.io pages and the look is *unverified*.
- **Licensing traps:** (1) Quaternius released a new "Quaternius Asset License" (QAL v1.0, dated 28 Aug 2026) that is **not CC0** and forbids redistributing the assets "in original or modified form" as a standalone asset or pack. The new Bestiary and Fantasy Races kits use it. A public repo that commits their GLB files is a grey area; avoid them unless the owner accepts that risk. Older Quaternius packs and everything on poly.pizza that I checked are labelled CC0 or CC-BY 3.0. (2) **Mixamo files must not be committed to an open repo** (see below). (3) Sketchfab needs an account to download, and almost everything there is CC-BY, often with NC/ND variants.

## Creature type to best available open model

Ratings: **good** = matches our KayKit/smooth-Quaternius style and has the clips we need; **usable** = rigged and animated but cartoonier, simpler or missing a clip; **wrong style** = voxel/blocky or unskinned; **nothing** = nothing found. `$` = paid pack (still CC0). `*` = contents taken from the seller's page, model not seen by me.
Poly.pizza IDs are given so each can be re-checked at `https://poly.pizza/m/<ID>`.

| Creature type | Best model(s) | Rating | Notes |
|---|---|---|---|
| Humanoid warriors, rogues, mages, clerics | KayKit Adventurers: Knight, Barbarian, Mage, Rogue, Rogue_Hooded (GitHub, CC0, in use except Rogue_Hooded). Extra tier $: Druid, Engineer, big Barbarian, 3 alt colour textures each. Mystery Monthly $\*: Paladin, Ninja, Cleric, Black Knight, Lorekeeper, Marksman | **good** | 5 to 7k tris, one 1024 atlas, 75+ clips, 25+ weapon/shield props |
| Skeletons | KayKit Skeletons: Warrior, Mage, Rogue, Minion (in use). Extra tier $\*: Skeleton Golem (boss-size), Necromancer | **good** | Quaternius skeletons also exist (1810 tris, 14k tris) but are chibi or heavy: usable |
| Zombies, ghouls | Quaternius Zombie (VlXjG0N8Eg CC0), Zombie chubby (22K0aSZkHV CC-BY), Animated Zombie (jkrEvQZb8J CC-BY): all in use | **good** | Other Quaternius/third-party zombies exist (CC0 3.5k tris "EnemyArmature" set is blocky: wrong style) |
| Ghosts, wraiths, shadows | Quaternius Ghost (Iip30bDHmu CC0, in use), Ghost Skull (TX8r9WBXpe) | **good** | Recolour for wraith, specter, invisible stalker |
| Goblinoids (goblin, hobgoblin, bugbear, kobold) | Quaternius Zombie-as-goblin (in use), Orc (5vO2YJsPEf CC0, in use as bugbear) | **good** | Hobgoblin = Orc tinted; kobold = goblin tinted and shrunk. Quaternius "Goblin" (OdCOFSmEhl) is blocky: wrong style |
| Orcs, brutes | Quaternius Orc (CC0, 7.3k tris, 14 clips); KayKit Mystery Monthly $\*: Orc Raider (series 4), Orc Brute (series 6) | **good** | |
| Giants, ogres, trolls | Quaternius Big arm (KaVJET0WHx, CC-BY 3.0, in use as ogre) | **usable** (reuse) | One ogre shape for every giant/troll/ettin/golem via scale and tint. Quaternius Giant (BldaiPtyJa) is blocky: wrong style. No troll model |
| Wolves, big cats, boars, bears | Quaternius Wolf (P1gU3Qkr9r, in use), Husky, Fox, Bull (a8PIIYwF7r), Pig (u35l6uP5vj), Cat (2f54vbV0In), all CC0 | wolves **good**; bull/pig/cat **usable** | Animals have a full 24-clip set incl. Attack, HitReact, Death. **Bears and lions/tigers: nothing** (the only bear/lion/wolf models found are Google Data Arts, CC-BY, 984 tris, no skeleton, one run clip) |
| Rats, bats, spiders, snakes, insects | Rat, Spider (in use); Bat (hNO9XvjlKa), Snake (x9x0viZs8V), Wasp (3aQgc75sUR), Bee Enemy (6HsU6GQt3a), Armabee (42djT5zJnx), Crab Enemy (Gs3yfsV5lB), all CC0 | rat, spider **good**; rest **usable** | Snake lacks Death/Hit clips. **Scorpion: nothing** usable (Google CC-BY, unskinned) |
| Slimes, oozes, jellies | Quaternius Slime (LyjSUKHKnh), Slime Enemy (eSLKTsbl7F), Green Blob (y4kJh8EeYS), Pink Slime (AyP8sQmDLh), Green Spiky Blob (IoWG5F9WUc); CC0. CC-BY slimes by Charlie and J-Toastie | **usable** | Slime has Idle/Walk/Attack/Death, no Hit. Blobs are chibi. No translucency possible with our tint-only scheme |
| Demons, devils, imps | Quaternius Blue Demon (S7jYW6Amye), Demon (LnfIziKv4o, red imp with trident), Demon (IkB63XOPvr, voxel), Hywirl (zjr7CmWGER); all CC0. KayKit Mystery Monthly 5 $\*: Tiefling | LnfIziKv4o, S7jYW6Amye **usable**; IkB63XOPvr **wrong style**; Tiefling **good** if bought | Nothing large or menacing: devils above CR 5 are scaled imps |
| Dragons, wyverns, drakes | Quaternius Dragon (3rUm1cN3yp 3.8k tris; VBvzjFIYws 1.3k tris), Dragon Evolved (LlwD0QNUPj 6.7k), Dino (wuerCFCWNR); CC0 | **usable** | Cartoon dragons with big eyes. Flying clip set only. No chunky "serious" dragon exists in the open sources I found |
| Elementals, golems, constructs | KayKit Skeletons Extra $\*: Skeleton Golem; Mystery Monthly 5 $\*: Frost Golem; Quaternius Goleling (71gomWolax, iHEuXiH6Aj) | golems **good** if bought, else **usable**; elementals **nothing** | No fire, water, air or earth elemental; tint the Ghost or Goleling |
| Plant creatures, mushroom folk | Quaternius Mushnub (LWKmS30Xxl), Mushroom King (grnFTziU8u), CC0; Mystery Monthly 6 $\*: Plant Warrior | **usable** | |
| Fish, aquatic | Quaternius fish set, all CC0: Shark (YYsK3gRCBZ), Anglerfish (MRjSlwCjHM), Puffer, Lionfish, Clownfish, Swordfish, Blobfish (7Jh8vsARfN) | **usable** | Swim clips only; Attack present on some. Crocodiles, sahuagin, merfolk, eels: nothing |
| Mimics, chests | none | **nothing** | |
| Beholder-like, tentacled | Quaternius Tentacle (BR1vpIvvvv, a single tentacle with Idle/Attack/Poke, CC0), Squidle (54QyRcsogk) | **usable** (props only) | Beholders and mind flayers are not in the SRD anyway |
| Birds, harpies, gryphons | Quaternius Birb (gZ2ExU9OAB, CC0); Mystery Monthly 6 $\*: Avian Swordsman; Hawk (Sherkiz, CC-BY, 9.9k tris, rigged status unchecked) | harpy **usable** at best; gryphon **nothing** | |
| Lizardfolk, kobolds | Frog, Dino, Goblin variants | **usable** | Lizardfolk is not in the SRD 5.2.1 monster list; kobold is (as "Kobold Warrior") |
| Minotaurs | none (a poly.pizza search for "minotaur" returned no animated model; Bull is a quadruped) | **nothing** | |
| Undead humanoids (vampire, werewolf, mummy) | Mystery Monthly 5 $\*: Vampire; series 4 $\*: Werewolf; otherwise tinted KayKit rigs or zombie rigs | **good** if bought, else variant | |

## What I downloaded and inspected

Everything is under `assets-src/survey/<name>/` (git-ignored); contact sheets (renders using the project's own viewer tool) are in `assets-src/survey/_sheets/`. Files were only parsed as data (GLB JSON chunk read by `assets-src/_tools_survey/glbinfo.mjs`) and rendered; nothing was executed. License and author are the fields on each poly.pizza model page ("Licence", "Creator" in the page data, read by `pps.mjs`). Sizes are raw, unoptimised.

| File | Source ID | License | Tris | Raw KB | Clips (trimmed) |
|---|---|---|---|---|---|
| dragonEvolved | LlwD0QNUPj | CC0 | 7.4k | 425 | Flying_Idle, Fast_Flying, Headbutt, Punch, HitReact, Death, Yes, No |
| dragonA | 3rUm1cN3yp | CC0 | 4.6k | 245 | same set |
| dragonB | VBvzjFIYws | CC0 | 1.3k | 262 | Dragon_Attack, Attack2, Death, Flying, Hit |
| hywirl, glubevo, goleling_evo, squidle, tribal, armabee | Hywirl etc. | CC0 | 2 to 6k | 140 to 300 | same Flying set as the dragons |
| frog | 37wofOCOzG | CC0 | 5.0k | 370 | Idle, Walk, Run, Punch, HitReact, Death, Jump... |
| demon3 (imp with trident) | LnfIziKv4o | CC0 | 6.7k | 474 | Idle, Walk, Run, Punch, HitReact, Death, Weapon... |
| demon1 | IkB63XOPvr | CC0 | 3.3k | 215 | Idle, Walk, Run, Attack, HitRecieve, Death (voxel look: wrong style) |
| slime | LyjSUKHKnh | CC0 | 1.4k | 170 | Idle, Walk, Attack, Death (no hit) |
| greenblob, mushnub, cat, birb, crabenemy | various | CC0 | 1.2 to 3.6k | 70 to 220 | Idle, Walk, Bite_Front, HitRecieve, Death, Jump |
| snake | x9x0viZs8V | CC0 | 1.6k | 211 | Idle, Walk, Attack, Jump (no death, no hit) |
| bat | hNO9XvjlKa | CC0 | 1.0k | 226 | Bat_Flying, Attack, Attack2, Hit, Death (no idle) |
| wasp | 3aQgc75sUR | CC0 | 3.7k | 430 | Flying, Attack, Death (no hit) |
| bull | a8PIIYwF7r | CC0 | 2.4k | 1014 | 12 clips incl. Attack_Headbutt, Gallop, HitReact, Death |
| shark, angler, blobfish | YYsK3gRCBZ, MRjSlwCjHM, 7Jh8vsARfN | CC0 | 1.3 to 6.6k | 140 to 515 | Swim variants (+ Attack/Death on angler, blobfish) |
| pig | u35l6uP5vj | CC0 | 2.8k | 293 | Idle, Walk, Run, Headbutt, Death |
| tentacle | BR1vpIvvvv | CC0 | 3.9k | 297 | Tentacle_Idle, Attack, Attack2, Poke (one tentacle, not a creature) |
| skelA | wODZYCgX5Z | CC0 | 1.8k | 174 | Idle, Running, Attack, Death, Spawn (chibi) |
| skelB (voxel), skelC, skelD | DM4QScSmbS, 1XZD9GK6Kj, yq5ATpujSt | CC0 | 6.9k, 11.7k, 14.3k | 470 to 770 | skelC/D: heavy, textured, cartoon armour |
| wizardCCBY | kttbFvCl2C | CC-BY 3.0 | 5.4k | 1138 | 15 clips incl. Spell1, Spell2, Staff_Attack, Death |
| googlewolf, googlelion | MyLvUaAaXO, MKOuVluVBe | CC-BY 3.0 (Google Data Arts) | 984 | 113 to 121 | **no skeleton**, a single run clip: not usable |

Also re-inspected (already in `assets-src/pp_*` from earlier work): alien1/2, bluedemon, demonA/B/C, dino, enemylarge/small, fox, husky, wolfA/B, yetiA/B, zombieB to F, mushking, orcenemy, goleling, giant, goblin. Findings: Quaternius ships three visually distinct families. (1) the smooth "Ultimate Monsters/Animals" set (CharacterArmature/AnimalArmature clips, big-eyed chibi monsters, plain smooth animals); (2) a **voxel set with "EnemyArmature" clips (Goblin, Giant, Yeti B, Zombie A, Demon A, Skeleton B, Wolf B): wrong style, avoid**; (3) a few heavier textured models.

## Sources, one by one

### KayKit (Kay Lousberg)
- **GitHub account `KayKit-Game-Assets`** has 10 repositories (listed with the public API; the `/orgs/` endpoint returns 404 because it is a user account, `/users/KayKit-Game-Assets/repos` works): Character-Pack-Adventures-1.0, Character-Pack-Skeletons-1.0, City-Builder-Bits, Dungeon-Remastered (200+ dungeon props), Furniture-Bits, Halloween-Bits, Medieval-Hexagon-Pack, Prototype-Bits, Restaurant-Bits, Space-Base-Bits. **Only the first two contain creatures.** GitHub reports the licence as "NOASSERTION" because each repo uses a custom `LICENSE.txt`; the two character repos I have locally say "Creative Commons Zero, CC0... free to use in personal, educational and commercial projects" (verified by reading the files).
- **Adventurers 1.0** (verified locally): Barbarian, Knight, Mage, Rogue, Rogue_Hooded (5 characters, GLB, 75 clips, one 1024 texture each), and 25 props (swords, axes, shields, crossbows, bow-less quiver/arrows, staff, wand, spellbooks, dagger, mug, smoke bomb). Knight is 6,952 tris.
- **Skeletons 1.0** (verified locally): Warrior, Mage, Rogue, Minion, plus 13 props (blade, axe, crossbow, staff, shields, arrows).
- **itch.io** (`kaylousberg.itch.io`, 33 listings, read via the page): same packs "name your own price" (free tier = the GitHub contents). **Extra tiers** ($7.95): Adventurers adds Engineer, Druid, large Barbarian and 3 alternate colour textures per character; Skeletons adds **Skeleton Golem ("for boss enemies") and Necromancer** and an alternate texture. **Mystery Monthly series 4, 5, 6** ($19.99 each, CC0, 14 to 15 characters each, rigged with basic clips, same style as Adventurers): series 4 = Orc Raider, Werewolf, Paladin, Ninja, Monster Costume, Animatronic, Survivalist, Clown, Robots, Space Ranger, Driver+Car, Action Figure; series 5 = Combat Mech, Superhero, Black Knight, Vampire, Witch, Helpers, Frost Golem, Caveman, Clanker, Protagonists, Hiker, Tiefling; series 6 = Lorekeeper, Orc Brute, Cleric, Monstrosity, Plant Warrior, Toy Soldier, 4-GTN, Hoarder, Avian Swordsman, Marksman, Magical Girls, Farmers. Series 1 to 3 are not listed (possibly only in "The Complete KayKit", $150; unverified). **KayKit Character Animations** (free, CC0): ~100 clips for "Rig_Medium" and ~25 for "Rig_Large". Our hero/skeleton rigs are Rig_Medium (inferred from the clip names matching; not checked against Rig_Large).
- Cost note: the CC0 text asks buyers not to resell unmodified copies; committing modified, trimmed GLBs to a game repo is within CC0, but the owner may prefer to buy to honour the spirit.

### Quaternius (quaternius.com, itch.io/quaternius, poly.pizza)
- The site lists 84 packs. Relevant: **Ultimate Monsters** (50 monsters, CC0, FBX/OBJ/Blend/glTF, free download from a Google Drive link; official page does not name the monsters), Animated Monster Pack (4), Easy Enemy Pack (5, voxel), Cute Animated Monsters (21, CC0), **Ultimate Animated Animals** (12, CC0, 12+ clips each), Animated Dinosaurs (6), Animated Fish, Animated Zombie, **Ultimate Animated Character Pack** (52 characters, CC0, Nov 2019; names not shown on the page), RPG Character Pack (6, CC0), Animated Knight (1), Universal Animation Library 1 and 2 (CC0, 120 and 130+ clips, humanoid retargeting; library 2 dated Jan 2026), Modular Dungeon packs, Fantasy Props MegaKit.
- **Newer kits are under QAL v1.0**, not CC0: *Bestiary: Dungeon Monsters Kit* (Aug 2026, 7 humanoid-rig monsters with weapons, 3 colours each, a part is free, the rest paid), *Characters: Fantasy Races* (12 models: elves, orcs, apes, dragons; no animations of its own), and likely other 2026 releases (unverified). QAL text (read in full at `quaternius.com/license.html`): free use incl. commercial, no credit required, but section 3(a) forbids redistributing "the Assets themselves... in original or modified form as a standalone asset, asset pack, stock file, template, or similar product, whether for free or for payment". Shipping a built game is explicitly fine. Whether an open-source repository containing the GLB files counts as redistribution is a legal judgement I cannot make; I would treat it as unsafe for a public repo.
- **poly.pizza** hosts individual Quaternius models (and others), each with a "Licence" field (CC0 1.0 or CC-BY 3.0 for all Quaternius models I checked) and a direct GLB. It rate-limits (HTTP 429) if crawled quickly. I could not find a bundle listing, so pack membership for Ultimate Monsters is verified only for the ~30 models found by search.
- Quaternius' own site download buttons point to Google Drive folders (could not automate); I used poly.pizza instead.

### Kenney (kenney.nl)
- All CC0. 3D packs relevant: **Mini Characters** (40 files, animated), **Mini Dungeon** (30 files, "character rig", animation and variations), Modular Dungeon Kit, Graveyard Kit, Cube Pets, Blocky Characters (20 files, v2.0, "blocky, voxel-like": **wrong style**, as already decided). I could not download Kenney zips (no direct links in page HTML), so creature lists, clips and look of Mini Characters / Mini Dungeon are **unverified**; Kenney's Mini series is stylised toy-like, which is probably smaller and simpler than KayKit.

### OpenGameArt
- Pages returned HTTP 403 to my fetches; findings come from search snippets only (**unverified**): Quaternius' "LowPoly Animated Monsters" (CC0), Cethiel's rigged dragon (CC0, textures, format unclear), "mutant grunt" (CC0 Quake-style, WIP animations), "mushroom creature" and "low-poly crab" (CC0, Blender only, idle/walk). Quality varies; none looked better than what Quaternius already gives us.

### itch.io creators
- **DreamKit Character Pack: Monsters** (DreamerH): 28 textured low-poly monsters in 5 biomes, **CC0**, FBX/Blend only (no GLB), "2+ rigs", clips not stated; free sample = 5 models, full pack $6+. Worth a look for gaps; **style and clips unverified**.
- **Low Poly Rigged Cute Monsters** (molotov-kittens): GLB/FBX/Blend, pay-what-you-want, but **requires credit** (custom licence, not CC-BY by name): usable only with attribution; clips not stated.
- "Tiny Treats" and "Mana Seed" (named in the brief) make 2D pixel/sprite assets: not applicable to a 3D game.

### Sketchfab
- Downloads require a Sketchfab account (login for every download). Free-download models are all Creative Commons attribution variants; CC BY-NC and CC BY-ND exist and are **not** acceptable for us. glTF comes as a ZIP. I did not survey it model by model; one search found a "low poly dragon cub" (rigged, license unconfirmed). Access cost: an account plus per-model licence checks and credit lines.

### Google Data Arts "Poly" animals (via poly.pizza)
- Wolf, bears, lion, eagle, scorpion, crab: CC-BY 3.0, 626 to 984 tris (from the poly.pizza metadata). I downloaded only the wolf and the lion: **no skeleton (0 skins), single run clip**. I assume the rest are built the same way (unchecked). Not usable for idle/attack/death.

### Mixamo (Adobe)
- Free with an Adobe account. The only statement I could retrieve is an Adobe-community FAQ (2022): "really the only thing you can't do is distribute the raw character and animation files", and "you may not distribute the files to customers or non-team members". Adobe's help page returned 403. **So: Mixamo characters and animations may be used in a shipped game but the raw files must not be redistributed; an open-source repository that contains Mixamo FBX/GLB files (even trimmed or retargeted) is very likely not allowed.** A repo could contain a script that downloads them, but then every contributor needs an Adobe login. Note `docs/MESHY_PROMPTS.md` already suggests Mixamo for rigging; treat that with this restriction in mind. Confirm in Adobe's current Terms before relying on any of it.

## Style notes

- Our baseline (KayKit heroes, Quaternius Wolf/Rat/Spider/Orc/Ghost) is chunky and smooth-shaded with muted colours. Quaternius "Ultimate Monsters" are smooth but many have large white cartoon eyes, which will look cuter than KayKit next to a hero. Tinting dark and shrinking them helps; a horror tone (ghouls, devils) will suffer.
- Tint is multiplicative on the texture/vertex colours (`VisualSpec.tint`), so it can darken or shift hue but cannot brighten a dark model or make translucent jelly.
- All of the survey files above are unoptimised: 100 KB to 1 MB raw each; our existing pipeline (trim animations, meshopt) brought similar models to 100 to 300 KB.

## Not verified

- Contents and look of KayKit Mystery Monthly 4/5/6, Skeletons Extra, Adventurers Extra (page text only).
- The 50 creature names of Ultimate Monsters and the 12 of Ultimate Animated Animals (whether a bear exists), the 52 of the Ultimate Animated Character Pack.
- Kenney Mini Characters / Mini Dungeon, OpenGameArt items, DreamKit and Molotov Kittens contents and clips.
- Whether Quaternius poly.pizza models that are labelled CC0 will keep that status (the new QAL applies to "future Asset releases").
- That KayKit's free GitHub files match the paid tiers' rig exactly.
- Sketchfab: no model-level survey.
- Mixamo's current official terms (only a community-posted FAQ was readable).

# Kitbashing feasibility study

Question: using only the open assets we already have (KayKit Adventurers and Skeletons, plus the Quaternius models in use), how far can scripted editing take us toward distinct creature variants without a human modeller?

Nothing here is integrated. `public/assets/**`, the manifest and `CREDITS.md` were not touched. Prototypes are in `assets-src/kitbash/out/`, renders in `assets-src/kitbash/renders/`, scripts in `assets-src/_tools/` (`kb.mjs` is the helper library).

## Conclusions first

- **It works, and it works better than expected.** Parts from one model can be attached to the bones of another with a small script, and they follow every animation. Three goblin types, a brown bugbear, a gold knight, an elite skeleton and a dark "wight" were produced this way. No Blender and no hand modelling were needed (Blender is not installed on this machine; I did not install anything).
- **Best value, in order:**
  1. Attaching kit parts (helmets, shields, weapons, capes) to bones. Cheap, reads clearly at game distance, and is the main source of "this is a different creature".
  2. Palette variants by recolouring (material colours on the Quaternius models, texture pixels on the KayKit models). Very cheap, looks like a deliberate new model rather than a tint, and is better than a runtime tint because it can recolour only some parts (armour but not skin, cape but not sword).
  3. Copying animation clips between KayKit characters (they all share one rig). Free extra animations.
- **Not worth building into the pipeline:** retargeting animations across different rigs (e.g. KayKit onto Quaternius). I did not attempt it, because bone names and rest poses differ and it would be a multi-day project for little visible gain.
- **Limits:** attachments are rigid (a cape does not flutter, it moves with the chest). Placement is "good enough after one or two tries", not perfect, and clipping is possible (hats can cover faces). You cannot change a creature's body shape this way; a toad-like orc stays toad-like however it is dressed.
- **All outputs would remain CC0**, since every part comes from CC0 sources (KayKit, and the Quaternius goblin and orc which are CC0). Anything built on the CC-BY Quaternius models would carry that attribution forward.

## Summary table

| # | Prototype | File | Size / triangles (base) | Animations | Effort | Verdict |
|---|---|---|---|---|---|---|
| 1 | Goblin boss (horned helmet, cape, big axe, round shield) | `goblin_boss.glb` | 236 KB / 9.5k (base 120 KB / 7.8k) | All five play; parts follow | About an hour to build the tooling; the variant itself took a few tries on weapon angle | Usable with touch-up (axe angle, helmet could be a little larger); the best result |
| 2a | Goblin warrior (blade, small shield, darker skin) | `goblin_warrior.glb` | 167 KB / 8.8k | Play | Minutes once tooling exists | Ship as is, or with a small touch-up of weapon angle |
| 2b | Goblin minion (dagger, paler skin) | `goblin_minion_dagger.glb` | 157 KB / 8.0k | Play | Minutes | Usable with touch-up: the dagger is small and reads mostly through the skin colour |
| 3 | Bugbear (orc recoloured to brown fur and dark mane, bear-hide hat, extra axe) | `bugbear_a/b/c.glb` | 127 / 170 / 174 KB / 7.3k to 8.4k (base 121 KB) | Play | Recolour: minutes; parts: one try | Recolour alone: usable (a clearly different creature, but still a toad-shaped orc). With hat and axe: usable with touch-up, mixed result |
| 4a | Knight, gold armour and blue cape | `hero_knight_gold.glb` | 315 KB / 5.3k (base 265 KB) | Play | Minutes | Ship as is |
| 4b | Elite skeleton (black steel with gold trim, purple cloak) | `skeleton_elite.glb` | 373 KB / 6.9k (base 305 KB) | Play | Minutes | Ship as is |
| 5 | "Wight" (skeleton on the KayKit rig with knight helmet and cape, a greatsword and two-handed clips copied in) | `wight.glb` | 411 KB / 6.1k | Play, including the copied two-handed attack and idle | One try for parts, one for clip copying | Usable with touch-up: reads as a dark knight, not as undead (add glowing eyes or leave the jaw visible) |

Sizes include the extra textures created for recolouring and the meshopt compression we already use.

## Look at these first

All in `assets-src/kitbash/renders/`, taken from the game camera angle (50 degrees):

1. `1_goblin_boss_compare.png` and `1_goblin_boss_attack.png` (knight | base goblin | boss; then five frames of the attack).
2. `2_goblin_types_lineup.png` and `2_goblin_types_far.png` (the three goblin types at close and game distance).
3. `4_palette_compare.png` (knight vs gold knight; skeleton vs elite).
4. `5_wight_compare.png` and `5_wight_attack.png`.
5. `3_bugbear_compare.png` and `3_bugbear_attack.png`.

## What I did, per prototype

### 1. Goblin boss
The base is `goblin_smooth.glb` (a Quaternius model with a 100x-scaled armature). I take a part from a KayKit file (the horned helmet from the skeleton warrior, the cape from the knight, the two-handed axe and round shield from the barbarian), compute where it should sit in the goblin's rest pose, scale it, and make it a child of the right bone: head, torso, forearm. The script converts the placement into the bone's own local space, so the scale-100 armature does not matter.
- **Animations:** checked five attack frames and five walk frames (`1_goblin_boss_attack.png`, `1_goblin_boss_walk.png`). The axe lifts and swings with the arm, the shield and helmet follow.
- **Problems:** the weapon's orientation relative to the forearm had to be guessed; one pitch rotation (about 55 degrees) made the axe rise overhead during the attack. The cape is a flat rigid piece and is mostly hidden. The helmet is slightly small. In the walk cycle the axe can clip the body.
- **Fiddly part:** none of the maths; it is only guessing offsets and checking renders. The first working version took about an hour including the helper library.

### 2. Goblin warrior vs minion
Same base. Warrior: the skeleton blade and small shield, plus a darker skin made by recolouring the green in the goblin's texture. Minion: a rogue's knife and a paler skin. In `2_goblin_types_far.png` the three goblins and the boss can be told apart at game distance mainly by skin colour, helmet and shield; the dagger alone is hard to see. So skin recolouring does as much work as the weapons. The recolour is region-limited (green hues only), so eyes and clothes are unchanged.

### 3. Bugbear
The orc uses plain material colours, not a texture, so the recolour is trivial: change five material colours (green to fur brown, blue mane to near-black). Result `bugbear_a`: clearly a different creature in one minute. I then added a KayKit barbarian bear-hide hat as a mane/hood and a small axe in the free hand (`bugbear_b`; `bugbear_c` adds a cape that is invisible from the front).
Honest verdict: it now reads as a brown, hairy, striped brute. It does not read as a bugbear in the D&D sense (a lanky goblinoid): the toad-like body, big eyes and open mouth are baked into the mesh and cannot be edited by attaching things. The hat on `b` looks like a bear skull and is a bit comical; the extra axe is tiny.

### 4. Palette variants by texture
- **How the atlas works:** all KayKit characters share a 1024x1024 palette image made of smooth colour ramps. Grey metal is a ramp of low-saturation greys, leather is brown, skin is peach, the knight's cape is saturated red, and bone is cream. I checked which colours each mesh uses by looking up each mesh's UV coordinates in the image (`assets-src/_tools/atlas.mjs` prints this).
- **Region-targeted recolouring is practical** with one trick: parts share texels (the sword and the armour use the same greys), so I give each recoloured mesh its own copy of the material and texture. That lets me recolour the armour but leave the sword steel. Rules are colour-based: "low saturation means metal", "saturated red means cape".
- **Results:** gold knight (armour to gold, cape to blue, `hero_knight_gold.glb`); elite skeleton (dark metal with the lighter ramp values turned gold, cloak purple, `skeleton_elite.glb`). Both look like deliberate new designs and keep all clips.
- **Cost:** about 45 to 60 KB per extra full-size texture copy (PNG at 1024x1024). The atlas is mostly flat colour blocks, so downscaling the copies to 256 px should be fine and make this nearly free, but I did not test that.
- **Limits:** a rule affects every pixel of that colour on that mesh. You cannot recolour only the helmet's trim if the trim shares a colour ramp with the helmet.

### 5. Stretch: the wight, and cross-model animation
I built a new enemy on the skeleton warrior: removed its helmet, blade and shield, then attached the knight's helmet, cape and two-handed sword, recoloured to blackened steel and a dark green cape. All KayKit characters use the same rig with the same bone names and rest pose, so knight parts attach with scale 1 and no guessing. Then I copied two animation clips (two-handed idle and two-handed slash) from the original skeleton file into the model by matching bone names. Both play: the greatsword swings in a wide arc and the helmet follows the head. Result: `wight.glb`, five attack frames in `5_wight_attack.png`.
- **Verdict:** a believable "dark knight with a skeleton's limbs". It reads as armoured, not undead; the visor hides the skull. A visible jaw or glowing eyes would fix that.
- **Clip copying between KayKit models** is the big hidden win: every KayKit character in the originals has 76 to 95 clips (spawn, taunt, block, two-handed, spell variants) and any of them can be copied onto any KayKit model with the same function.
- **Not attempted:** KayKit clips onto the Quaternius rigs. Different bone names, bone roll and proportions would need a mapping table and rest-pose correction per rig; I judge it low value for the effort.

## Things that surprised me

- Parts attached on the first try with correct scale and position, because I computed placement in rest-pose world space and converted it to bone space. The 100x armature scale on the Quaternius models was a non-issue.
- A gltf-transform quirk: disposing nodes of a merged source file left its meshes in the output (a 26k-triangle goblin boss). I fixed it by explicitly disposing everything except the attached part.
- Per-mesh texture clones make region recolouring easy; I expected texture-atlas editing to be much harder.
- Clip copying between same-rig models was trivial and gives a lot of new motion.
- `goblin_minion.glb` in the `out` folder is a stale leftover from my first attempt (before a bug fix); ignore it.

## Recommendation: what to build into the regular pipeline

1. **Parts attachment tool** (build it): a small script taking base model, part file and name, target bone, scale and rotation, defined in a config file; this is `kb.mjs` plus the per-variant scripts. Use for goblin boss and warrior, skeleton variants (the wight), and elite heroes.
2. **Palette variants** (build it): a config of named recolour rules (by colour range) per model and mesh, producing the new files at build time. Use material-colour edits for the Quaternius models (instant) and texture copies for KayKit (downscale the copies). This replaces runtime tints for anything that should look intentional (elite, boss, second colourway).
3. **Clip transfer** between KayKit models (build it; ten lines): useful for giving every KayKit enemy a two-handed or spellcasting set.
4. **Skip:** cross-rig animation retargeting, and trying to change body shape (the bugbear cannot become a bugbear by dressing it).
5. For quality, add a **render check** to the pipeline (the headless viewer used here: five attack and five walk frames per variant) because weapon angles need a human look.

## Reproducing

Scripts in `assets-src/_tools/`: `kb.mjs` (library), `goblin_kb.mjs boss|warrior|minion`, `bugbear_kb.mjs a|b|c`, `palette_kb.mjs knight_gold|skeleton_elite`, `wight_kb.mjs`, `atlas.mjs` (atlas colour usage per mesh), `kbman.mjs` (prototype manifest), `shot.mjs` with `viewer/index.html` (renders; needs `node viewer/server.mjs` running).

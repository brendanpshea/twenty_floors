# Asset pipeline (offline tools)

These scripts build the 3D models in `public/assets/models/` and `public/assets/manifest.json` from free, open-licensed source packs. They are **not** part of the game build and run on your machine only. The downloaded packs live in `assets-src/`, which is git-ignored; only the resulting `.glb` files are committed.

Everything the game ships is CC0 or CC-BY; the sources and licenses are listed in `CREDITS.md`. Do not add anything from a source whose license you cannot confirm on the source page.

## Setup

Needs Node 20+ and git. The tools have their own dependencies (they are deliberately not in the game's `package.json`):

```
cd tools/assets
npm install        # @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp, gl-matrix, gltf-validator, puppeteer-core
```

Rendering checks need Microsoft Edge or Chrome. Set `EDGE_PATH` to the executable if it is not at the default Windows location.

## Source packs to download into `assets-src/`

Download each into its own new folder; treat the files as untrusted data (the scripts only read them as glTF, nothing in them is executed).

| Folder | What | How |
|---|---|---|
| `assets-src/kaykit_adv/repo` | KayKit Character Pack: Adventurers 1.0 (CC0) | `git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 assets-src/kaykit_adv/repo` |
| `assets-src/kaykit_skel/repo` | KayKit Character Pack: Skeletons 1.0 (CC0) | `git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 assets-src/kaykit_skel/repo` |
| `assets-src/pp_<name>/<name>.glb` | Quaternius models via poly.pizza (CC0 or CC-BY 3.0) | `node fetch.mjs zombieB:VlXjG0N8Eg zombieD:22K0aSZkHV zombieC:jkrEvQZb8J bigarm:KaVJET0WHx wolfA:P1gU3Qkr9r ghost:Iip30bDHmu orc:5vO2YJsPEf rat:iltq5bVNaV spider:yRYJiAJyiM` |

`fetch.mjs` prints each model's creator and license as listed on its poly.pizza page (`https://poly.pizza/m/<id>`); check it matches `CREDITS.md`. `pp.mjs <search terms>` searches poly.pizza and lists animated models with their license when you are looking for new candidates.

## Rebuilding the shipped models

```
cd tools/assets
node build-models.mjs        # base models and ready-to-ship single models -> public/assets/models/ (bases -> assets-src/base/)
node build-variants.mjs      # variants (goblin minion/warrior/boss, bugbear, ...) -> public/assets/models/
node manifest.mjs            # writes public/assets/manifest.json
node validate.mjs            # parses every model, checks clip names, sizes, triangle counts, runs gltf-validator
```

`build-variants.mjs` is the one entry point for variants. Run it with variant names to rebuild only those (`node build-variants.mjs goblin_boss`).

## What each script does

| File | Purpose |
|---|---|
| `paths.mjs` | Repository paths used by all scripts (relative to this folder, so the repo can live anywhere). |
| `kb.mjs` | Helper library (gltf-transform): load/save with meshopt compression, `mount()` (attach a part from another model to a bone of this one), texture recolouring and shrinking, material colour edits, clip copying between models that share a rig. |
| `build-models.mjs` | Turns downloaded models into trimmed game models: keeps only the clips we use and renames them, removes unused weapons, attaches KayKit weapons to hand slots, quantizes and meshopt-compresses. The list of models and clip mappings is at the top of the file. Models marked `base:true` are intermediate bases for variants. |
| `variants.mjs` | **The declarative variant list.** One entry per variant: base model, colour edits, attached parts (with bone, position, scale, direction). Documented at the top of the file. |
| `build-variants.mjs` | Reads `variants.mjs` and builds each variant. |
| `meta.json` | Per-model scale (calibrated so a Medium creature is about 1.8 units tall) and the animation-name mapping; read by `manifest.mjs`. |
| `manifest.mjs` | Maps game model keys (monster ids etc.) to files and writes `public/assets/manifest.json`. Add a key here when you add a model. |
| `calib.mjs` | Re-measures each model in the viewer (needs the viewer server) and updates the `scale` entries in `meta.json`. |
| `validate.mjs` | Checks every model referenced by the manifest (clips exist, sizes, triangles, textures, glTF validity) and prints the total size. Uses the viewer to measure true heights. |
| `viewer/`, `shot.mjs`, `stage-manifest.mjs` | A small three.js viewer and headless screenshot tool for checking models. |
| `gameshot.mjs` | Screenshots from the real game (see below). |
| `atlas.mjs` | Prints which atlas colours each mesh of a KayKit model uses (helps writing recolour rules). |

## Adding a variant

1. Add an entry to `variants.mjs` (copy an existing one). Place parts with `at` (a bone name or coordinates in the base's rest pose), `s` (scale) and `aim` (the direction the part points in the rest pose).
2. Build into a scratch folder and look at it:
   ```
   VARIANT_OUT=assets-src/kitbash/out node build-variants.mjs my_variant
   node viewer/server.mjs &                 # serves the viewer on http://localhost:8123
   node stage-manifest.mjs
   node shot.mjs ../../assets-src/shots/my.png "man=/src/kitbash/manifest.json&cam=iso&pitch=50&d=8&ly=0.6&anim=attack&keys=my_variant@0.1,my_variant@0.3,my_variant@0.5,my_variant@0.7"
   ```
   `keys=name@time@anim` renders a model at a fraction of a clip. Use `cam=iso` (the game's angle) and `cam=side` with `axis=z`. Check at least six frames of attack and walk from both cameras.
3. Weapon direction: a blade must point away from the elbow. `chk=PartName:HandBone:ElbowBone` in the viewer prints, per clip, how far the part's centre and tip lie beyond the fist along the forearm; both must be positive. `aim:{fromForearm:{hand,elbow,k}}` in `variants.mjs` computes a good direction automatically.
4. Build for real (`node build-variants.mjs my_variant`), add the key to `manifest.mjs`, run `node manifest.mjs` and `node validate.mjs`, and add a row to `CREDITS.md` naming every source asset combined and stating that it was modified.

## Checking in the real game

```
npx vite --port 5186            # from the repository root
node tools/assets/gameshot.mjs out.png "depth=1&seed=2&reveal=1" goblin_boss     # focus the camera on a monster id
WHEEL=6 node tools/assets/gameshot.mjs ...                                      # zoom in
```

Recolours are baked into the files, but the game also multiplies each model by a colour 35% toward the monster's `tint`, so judge colours in the game, not only in the viewer.

## Notes and gotchas

- gltf-transform: disposing an animation does not dispose its channels and samplers (do that first), and merged source models leave their meshes behind unless their nodes are disposed; `kb.mjs` handles both.
- Variant textures are downscaled to 256 px with nearest-neighbour sampling; the KayKit atlas is flat blocks and ramps, so this shows no banding.
- Models use `EXT_meshopt_compression` (the game sets `MeshoptDecoder`); Draco is not used.
- `getBounds()` from gltf-transform is wrong for skinned models; real heights are measured in the viewer.

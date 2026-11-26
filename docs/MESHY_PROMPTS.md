# Meshy prompts for creature models

A trial plan and a set of ready-to-paste prompts for generating the creature
models we cannot find as open assets. Nothing here has been tried yet: the
point of the first batch is to find out whether Meshy output is usable in this
game at all.

> **Status (26 November 2026): blocked on the free plan.** A first attempt
> showed that a free account can generate and preview models but cannot
> download them, contrary to the download figures in the table below. The
> prompts are kept for use with a paid plan or another generator.

## What the free plan allows

Checked in November 2026 from third-party summaries of Meshy's terms. Confirm
on [meshy.ai/pricing](https://www.meshy.ai/pricing) before relying on any of it.

| Limit | Value | What it means for us |
|---|---|---|
| Credits | 100 per month, no rollover | Enough for a handful of generations. Each prompt below is worth one or two attempts, not ten. |
| Downloads | 10 per month | Previews are free to look at, so only download a model you would actually ship. |
| What can be downloaded | Untextured models from the "Meshy 6 Lite" model only | We get shape, not colour. We have to colour the models ourselves (see "After the download"). |
| License | CC BY 4.0, credit to Meshy required | Compatible with this project. Every model used goes in `CREDITS.md`. |
| Rigging and animation | Unknown on the free plan | Mixamo (free with an Adobe account, bipeds only) can rig a model, but a later licence check found that Adobe's terms very likely forbid redistributing Mixamo's raw character and animation files, which an open repository would be doing. Treat Mixamo as unusable for this project unless that is confirmed otherwise. |

Two consequences shape everything below:

1. **Shape is all that survives the download**, so the prompts spend their
   words on silhouette, proportions and pose. Colour words are still included
   because they make the preview easier to judge.
2. **Two-legged creatures first.** Auto-rigging tools handle bipeds. A wolf or
   spider would arrive as a statue with no way to animate it, and the open
   models we already have for those are acceptable.

## Settings to use

- Mode: Text to 3D. Model: Meshy 6 Lite (the only one the free plan can download).
- Model type: Low Poly, if offered. Otherwise the lowest polygon target available (aim for 3,000 to 8,000 triangles).
- Pose: use the **A-Pose** setting in the generation options. Meshy's own help says the setting is more reliable than writing the pose into the prompt.
- Symmetry: on.
- Topology: triangles are fine.
- Export: GLB.

## What a usable result looks like

Judge the preview from above and in front, at about the height of a table
lamp looking down at a figurine. That is the game camera.

- Reads as the creature at thumbnail size. The head, hands and one defining feature (ears, tusks, belly) are exaggerated.
- Chunky toy-like proportions that match the heroes: big head, short legs, thick limbs.
- Arms clearly separated from the body and legs separated from each other. Fused limbs cannot be rigged.
- Empty hands. We attach weapons from the kit the heroes use, so they match.
- No base, no ground plane, no floating bits, no cape or long hair fused into the back.
- Smooth, simple surfaces. Noise, wrinkles and fine armour detail turn to mush at game size.

Reject anything that fails the limb or silhouette checks. Do not spend a download on it.

## The shared style line

Every prompt ends with this line. Keep it identical so the set stays consistent.

```
Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

## First batch: three models, end to end

Do these three first and stop. They replace our weakest current models, and
getting one of them walking around in the game tells us whether the rest of
this document is worth doing.

### 1. Goblin (replaces the hunched stand-in used for all three goblin types)

```
A small goblin warrior. Short and wiry with a big round head, very long pointed ears sticking out sideways, a long hooked nose, wide mouth with small fangs, large hands and feet. Wears a ragged leather tunic and a simple belt. Stands fully upright, not crouched. Green skin, brown leather. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

### 2. Bugbear (replaces the orc, our weakest match)

```
A bugbear, a tall hairy goblinoid brute. Hunched heavy shoulders, long thick arms reaching to the knees, a broad bear-like head with a flat snout, small eyes, pointed ears and a shaggy mane around the neck. Barrel chest, short bowed legs. Wears a patchwork hide vest and a wide belt. Rust-brown fur, dark hide. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

### 3. Goblin boss (so the first boss is not just a bigger goblin)

```
A goblin chieftain, stockier and prouder than a common goblin. Big round head with very long pointed ears, a jutting jaw with two tusks, a dented metal helmet with a single spike, one large round shoulder plate, a thick fur collar and a studded belt over a fat belly. Stands upright with chest out. Dark green skin, rusty iron, red cloth. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

## Second batch: only if the first one works

These would replace the three CC BY 3.0 models and the ghost, in order of how
much each would improve the game.

### 4. Ogre

```
An ogre, a huge dim-witted giant. Enormous round belly, massive sloping shoulders, thick arms with oversized fists, a small bald head set low between the shoulders, heavy brow, underbite with two blunt teeth. Short stumpy legs and big flat feet. Wears a crude hide loincloth and a rope belt. Ochre-yellow skin, brown hide. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

### 5. Zombie

```
A zombie, a shambling rotting corpse. Slack jaw, sunken eyes, head tilted to one side, one shoulder lower than the other, bloated torso, torn peasant shirt and ragged trousers with bare feet. Thick clumsy limbs. Sickly grey-green skin, faded brown cloth. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

### 6. Ghoul

```
A ghoul, a gaunt corpse-eating undead. Emaciated body with visible ribs, long thin arms ending in large clawed hands, hairless skull-like head with a wide mouth full of pointed teeth, pointed ears, hollow eyes. Wears only a tattered loincloth. Lean but with exaggerated hands and head. Pale blue-grey skin. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, short thick limbs, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

### 7. Shadow

```
A shadow, a living silhouette of a person. A smooth featureless humanoid figure with a hooded head, no face except two eye hollows, long arms ending in elongated tapering fingers, and legs that merge into a ragged wispy hem just above the feet. Simple flowing shape with no clothing detail. Solid black-violet. Stylized low-poly game character, chunky toy-like proportions, oversized head and hands, smooth simple surfaces, flat colors, no fine detail, clean silhouette, full body, single character, standing upright in A-pose, arms away from body, legs apart, empty hands, no weapon, no base, no background.
```

That is seven downloads, leaving three of the month's ten for a second attempt
at whichever ones came out worst.

## Later floors

Monsters we are likely to want after the first three floors. All are in SRD
5.2, all are two-legged, and none has a good open model that we have found.
These are shorter descriptions to combine with the shared style line when the
time comes.

| Monster | Description to put before the style line |
|---|---|
| Hobgoblin warrior | A disciplined goblinoid soldier. Upright military posture, broad flat face, pointed ears, a simple round helmet, banded armour on the chest and shoulders, greaves. Orange-red skin, dark steel. |
| Gnoll warrior | A hyena-headed humanoid. Hunched back with a spiky mane running down the spine, long snout with jagged teeth, tall pointed ears, lanky arms, digitigrade-looking but two straight legs. Scrappy hide armour. Tan fur with dark spots. |
| Kobold warrior | A tiny lizard-like humanoid. Big snouted head with small horns swept back, large eyes, thin tail, scrawny body in a scrap-leather tunic. Rust-red scales. |
| Wight | An armoured undead warrior. Withered face under an open-faced helm, long ragged cloak ending at the knees, corroded breastplate, gaunt hands. Bone-white skin, black iron, pale blue eyes. |
| Mummy | A corpse wrapped in linen bandages from head to foot, with loose strips hanging from the forearms, hollow eye sockets, stiff square shoulders. Dusty off-white wrappings. |
| Minotaur of Baphomet | A bull-headed giant. Huge horned bull head, massive furred shoulders and chest tapering to a narrow waist, hooves, a leather harness and loincloth. Dark brown fur, bone horns. |
| Troll | A tall, lanky green giant. Long rubbery limbs, drooping nose, stringy moss-like hair, hunched back, huge clawed hands hanging low. Mottled green skin. |
| Gargoyle | A stone statue come alive. Crouching-capable but standing upright, horned head with a beak-like snout, clawed hands and feet, two small folded bat wings on the back. Grey granite. |
| Animated armor | An empty suit of plate armour standing on its own. Closed helm with a dark visor slit, round pauldrons, barrel breastplate, no body visible in the joints. Dull steel with brass trim. |
| Ettin | A two-headed giant. Two ugly bald heads side by side on wide shoulders, pot belly, thick arms, ragged furs. Grey-brown skin. |

Four-legged and many-legged creatures (owlbear, basilisk, dire wolf, giant
scorpion, dragons) are left out on purpose until we know how we would animate
them.

## After the download

Put each file in its own folder, `assets-src/meshy/<creature>/`, and note the
prompt used. From there the work is ours, and each step is a risk the first
batch is meant to test:

1. **Rig and animate.** Use Meshy's own rigging if the plan offers it. Mixamo
   is probably not an option (see the licence note in the table above), so
   without Meshy rigging this step has no known free route.
2. **Colour.** The mesh arrives without a texture. The plan is to assign flat
   colours by body region with a script, which suits our look but has not been
   attempted. If it looks bad, the fallback is a single tint per creature.
3. **Optimise.** Reduce to a few thousand triangles, trim to the five clips,
   compress, and normalise the height (goblin 1.2 units, human-sized 1.8,
   ogre 3.2), using the same pipeline as the existing models.
4. **Attach a weapon** from the hero kit to the hand bone where the creature should carry one.
5. **Register it** in `public/assets/manifest.json` under the creature's key,
   and add a row to `CREDITS.md`: model generated with Meshy, CC BY 4.0, with
   the prompt's author and the date.

## What to record for each attempt

Enough to decide whether to continue, and to improve the prompts:

- Which prompt, and whether it was edited.
- Credits spent.
- Passed or failed the checks in "What a usable result looks like", and which one failed.
- Triangle count of the download.
- Whether rigging worked, and where.

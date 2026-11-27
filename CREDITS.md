# Credits

Twenty Floors is built on open rules content, open-licensed 3D models and open-source code. Thank you to everyone listed here.

## Rules content

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## 3D models

Most models in `public/assets/models/` are released under CC0 1.0 (public domain dedication), so attribution is not legally required (it is given anyway). Four Quaternius models (Zombie chubby, Animated Zombie, Big arm, Witch) are licensed CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/): credit to Quaternius, linked above; they were modified only for web delivery as listed in the last column (no changes to their look; no endorsement by the author is implied). The mapping from game keys to files is in `public/assets/manifest.json`.

| Asset | Author | License | Source | Files / manifest keys | Modifications |
|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg (KayKit) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (see its `LICENSE.txt`; https://kaylousberg.com) | `hero_knight.glb` (Knight), `hero_barbarian.glb` (Barbarian), `hero_rogue.glb` (Rogue), `hero_mage.glb` (Mage) | Unused weapons/props removed, animations trimmed to 6 clips, unused meshes pruned, meshopt compression and vertex quantization |
| KayKit Character Pack: Skeletons 1.0 | Kay Lousberg (KayKit) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 (see its `LICENSE.txt`; https://kaylousberg.com) | `skeleton_warrior.glb` (key `skeleton_warrior`), `skeleton_mage.glb`, `skeleton_rogue.glb`, `skeleton_minion.glb` (keys `skeleton`, `skeleton_minion`) | Weapon/shield models from the same pack attached to the hand slots, animations trimmed to 6 clips, meshopt compression and vertex quantization |
| Ghost | Quaternius | CC0 1.0 | https://poly.pizza/m/Iip30bDHmu | `ghost.glb` (key `shadow`) | Animations trimmed, meshopt compression and quantization |
| Wolf | Quaternius | CC0 1.0 | https://poly.pizza/m/P1gU3Qkr9r | `wolf_smooth.glb` (key `wolf`) | Animations trimmed, meshopt compression and quantization |
| Zombie (chubby) | Quaternius | CC-BY 3.0 | https://poly.pizza/m/22K0aSZkHV | `zombie_smooth.glb` (key `zombie`) | Animations trimmed, meshopt compression and quantization |
| Animated Zombie | Quaternius | CC-BY 3.0 | https://poly.pizza/m/jkrEvQZb8J | `ghoul_smooth.glb` (key `ghoul`) | Animations trimmed, meshopt compression and quantization; clips sped up (bite x4, walk and idle x2) |
| Big arm | Quaternius | CC-BY 3.0 | https://poly.pizza/m/KaVJET0WHx | `ogre_smooth.glb` (key `ogre`) | Animations trimmed, meshopt compression and quantization |
| Goblin variants (combined from several assets) | Quaternius (base model "Zombie", CC0, https://poly.pizza/m/VlXjG0N8Eg) and Kay Lousberg / KayKit (parts: CC0, from the two KayKit packs above) | CC0 1.0 (all parts) | https://poly.pizza/m/VlXjG0N8Eg ; KayKit repositories above | `goblin_minion.glb` (key `goblin_minion`: Rogue knife), `goblin_warrior.glb` (key `goblin_warrior`: Knight sword and round shield), `goblin_boss.glb` (key `goblin_boss`: Skeleton Warrior helmet, Knight cape, KayKit Skeletons curved blade (Skeleton Blade) and Barbarian round shield) | Modified: kit parts attached to the goblin's skeleton bones and rescaled, goblin skin texture recoloured per variant, textures downscaled, animations trimmed, meshopt compression and quantization |
| Bugbear (combined from two assets) | Quaternius (base model "Orc", https://poly.pizza/m/5vO2YJsPEf) and Kay Lousberg / KayKit (Barbarian one-handed axe, from the Adventurers pack above) | CC0 1.0 (both) | https://poly.pizza/m/5vO2YJsPEf ; KayKit Adventurers repository above | `bugbear.glb` (key `bugbear_warrior`) | Modified: material colours changed to brown fur and a dark mane, axe attached to the right forearm bone and rescaled, animations trimmed, meshopt compression and quantization |
| Rat | Quaternius | CC0 1.0 | https://poly.pizza/m/iltq5bVNaV | `rat.glb` (key `giant_rat`) | Animations trimmed, meshopt compression and quantization |
| Spider | Quaternius | CC0 1.0 | https://poly.pizza/m/yRYJiAJyiM | `spider.glb` (key `giant_spider`) | Animations trimmed, meshopt compression and quantization |
| Frog | Quaternius | CC0 1.0 | https://poly.pizza/m/37wofOCOzG | `frog.glb` (key `frog`); `frog_green.glb` (key `frog_green`) | Animations trimmed to the clips used, meshopt compression and quantization; frog_green: material colours changed |
| Slime | Quaternius | CC0 1.0 | https://poly.pizza/m/LyjSUKHKnh | `slime_gray`, `slime_ochre`, `slime_cyan`, `slime_black` (same keys) | Animations trimmed to the clips used, meshopt compression and quantization; body colour changed per variant |
| Snake | Quaternius | CC0 1.0 | https://poly.pizza/m/x9x0viZs8V | `snake.glb` (key `snake`) | Animations trimmed to the clips used, meshopt compression and quantization (the source has no hit/death clips) |
| Mushnub | Quaternius | CC0 1.0 | https://poly.pizza/m/LWKmS30Xxl | `mushnub_violet.glb` (key `mushnub_violet`) | Animations trimmed to the clips used, meshopt compression and quantization; cap and stalk recoloured |
| Green Spiky Blob | Quaternius | CC0 1.0 | https://poly.pizza/m/IoWG5F9WUc | `blob.glb` (key `blob`) | Animations trimmed to the clips used, meshopt compression and quantization |
| Crab Enemy | Quaternius | CC0 1.0 | https://poly.pizza/m/Gs3yfsV5lB | `crab_teal.glb` (key `crab_teal`) | Animations trimmed to the clips used, meshopt compression and quantization; recoloured |
| Bat | Quaternius | CC0 1.0 | https://poly.pizza/m/hNO9XvjlKa | `bat.glb` (key `bat`) | Animations trimmed to the clips used, meshopt compression and quantization (flying clip used for idle and walk) |
| Mushroom King | Quaternius | CC0 1.0 | https://poly.pizza/m/grnFTziU8u | `mushking_moss.glb` (key `mushking_moss`) | Animations trimmed to the clips used, meshopt compression and quantization; cap and body recoloured |
| Blue Demon | Quaternius | CC0 1.0 | https://poly.pizza/m/S7jYW6Amye | `bluedemon.glb` (key `bluedemon`); `gargoyle_stone.glb` (key `gargoyle_stone`) | Animations trimmed to the clips used, meshopt compression and quantization; gargoyle_stone: recoloured grey |
| Demon (imp with trident) | Quaternius | CC0 1.0 | https://poly.pizza/m/LnfIziKv4o | `imp.glb` (key `imp`) | Animations trimmed to the clips used, meshopt compression and quantization |
| Birb | Quaternius | CC0 1.0 | https://poly.pizza/m/gZ2ExU9OAB | `birb_gold`, `birb_grey`, `birb_crimson` (same keys) | Animations trimmed to the clips used, meshopt compression and quantization; recoloured per variant |
| Hywirl | Quaternius | CC0 1.0 | https://poly.pizza/m/zjr7CmWGER | `mephit_ice`, `mephit_fire` (same keys) | Animations trimmed to the clips used, meshopt compression and quantization; recoloured; flying clips (Flying_Idle as idle, Fast_Flying as walk) |
| Dino | Quaternius | CC0 1.0 | https://poly.pizza/m/wuerCFCWNR | `dino.glb` (key `dino`) | Animations trimmed to the clips used, meshopt compression and quantization |
| Yeti | Quaternius | CC0 1.0 | https://poly.pizza/m/S1E7idPFhe | `yeti.glb` (key `yeti`) | Animations trimmed to the clips used, meshopt compression and quantization |
| Cat | Quaternius | CC0 1.0 | https://poly.pizza/m/2f54vbV0In | `cat.glb` (key `cat`); `companion_sphinx.glb` (key `companion_sphinx`) | Animations trimmed to the clips used, meshopt compression and quantization; companion_sphinx: recoloured gold and cream, scaled |
| Bull | Quaternius | CC0 1.0 | https://poly.pizza/m/a8PIIYwF7r | `bull.glb` (key `bull`) | Animations trimmed to the clips used, meshopt compression and quantization (duplicate un-prefixed clips dropped) |
| Dragon | Quaternius | CC0 1.0 | https://poly.pizza/m/3rUm1cN3yp | `dragon.glb` (key `dragon`); `wyvern.glb` (key `wyvern`); `companion_pseudodragon.glb` (key `companion_pseudodragon`) | Animations trimmed to the clips used, meshopt compression and quantization; flying clips (Flying_Idle as idle, Fast_Flying as walk); wyvern and pseudodragon: recoloured, pseudodragon scaled down |
| Dragon Evolved | Quaternius | CC0 1.0 | https://poly.pizza/m/LlwD0QNUPj | `dragon_red`, `dragon_black`, `dragon_blue`, `dragon_green`, `dragon_white`, `dragon_gold` (same keys) | Animations trimmed to the clips used, meshopt compression and quantization; one recolour per dragon colour; flying clips (Flying_Idle as idle, Fast_Flying as walk) |
| Witch | Quaternius | CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) | https://poly.pizza/m/QBEOV9ZUT8 | `hag_green.glb` (key `hag_green`) | Animations trimmed to the clips used, meshopt compression and quantization; skin and robe recoloured green; credit: Witch by Quaternius |
| KayKit Adventurers recolours (Rogue_Hooded, Rogue, Mage, Barbarian, Knight) | Kay Lousberg (KayKit) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | `hooded_brown`, `hooded_black`, `rogue_brown`, `rogue_navy`, `mage_cultist`, `mage_priest`, `mage_green`, `barb_red`, `knight_dark`, `knight_gold`, `knight_green` (same keys) | Texture colours changed (hue shifts, steel to dark or gold), Mage hat removed for mage_priest, textures downscaled to 256 px, meshopt compression |
| Wolf | Quaternius | CC0 1.0 | https://poly.pizza/m/P1gU3Qkr9r | `companion_blinkdog.glb` (key `companion_blinkdog`) | Animations trimmed to the clips used, meshopt compression and quantization; coat recoloured golden tan with a lighter muzzle |

Quaternius' work is also available at https://quaternius.com (CC0 unless noted). Poly Pizza (https://poly.pizza) is used only as a download mirror; each page above states the model's author and its license (CC0 1.0 or CC-BY 3.0, as listed).

## Code

- [three.js](https://threejs.org) (MIT License), including its GLTFLoader and meshopt decoder.
- The game's own code is MIT licensed; see [LICENSE](LICENSE).

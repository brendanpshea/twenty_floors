# Credits

Twenty Floors is built on open rules content, open-licensed 3D models and open-source code. Thank you to everyone listed here.

## Rules content

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## 3D models

Most models in `public/assets/models/` are released under CC0 1.0 (public domain dedication), so attribution is not legally required (it is given anyway). Three Quaternius models (Zombie chubby, Animated Zombie, Big arm) are licensed CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/): credit to Quaternius, linked above; they were modified only for web delivery as listed in the last column (no changes to their look; no endorsement by the author is implied). The mapping from game keys to files is in `public/assets/manifest.json`.

| Asset | Author | License | Source | Files / manifest keys | Modifications |
|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg (KayKit) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (see its `LICENSE.txt`; https://kaylousberg.com) | `hero_knight.glb` (Knight), `hero_barbarian.glb` (Barbarian), `hero_rogue.glb` (Rogue), `hero_mage.glb` (Mage) | Unused weapons/props removed, animations trimmed to 6 clips, unused meshes pruned, meshopt compression and vertex quantization |
| KayKit Character Pack: Skeletons 1.0 | Kay Lousberg (KayKit) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 (see its `LICENSE.txt`; https://kaylousberg.com) | `skeleton_warrior.glb` (key `skeleton_warrior`), `skeleton_mage.glb`, `skeleton_rogue.glb`, `skeleton_minion.glb` (keys `skeleton`, `skeleton_minion`) | Weapon/shield models from the same pack attached to the hand slots, animations trimmed to 6 clips, meshopt compression and vertex quantization |
| Ghost | Quaternius | CC0 1.0 | https://poly.pizza/m/Iip30bDHmu | `ghost.glb` (key `shadow`) | Animations trimmed, meshopt compression and quantization |
| Zombie (goblin-like green model) | Quaternius | CC0 1.0 | https://poly.pizza/m/VlXjG0N8Eg | `goblin_smooth.glb` (keys `goblin_minion`, `goblin_warrior`, `goblin_boss`) | Animations trimmed, meshopt compression and quantization |
| Wolf | Quaternius | CC0 1.0 | https://poly.pizza/m/P1gU3Qkr9r | `wolf_smooth.glb` (key `wolf`) | Animations trimmed, meshopt compression and quantization |
| Zombie (chubby) | Quaternius | CC-BY 3.0 | https://poly.pizza/m/22K0aSZkHV | `zombie_smooth.glb` (key `zombie`) | Animations trimmed, meshopt compression and quantization |
| Animated Zombie | Quaternius | CC-BY 3.0 | https://poly.pizza/m/jkrEvQZb8J | `ghoul_smooth.glb` (key `ghoul`) | Animations trimmed, meshopt compression and quantization; clips sped up (bite x4, walk and idle x2) |
| Big arm | Quaternius | CC-BY 3.0 | https://poly.pizza/m/KaVJET0WHx | `ogre_smooth.glb` (key `ogre`) | Animations trimmed, meshopt compression and quantization |
| Orc | Quaternius | CC0 1.0 | https://poly.pizza/m/5vO2YJsPEf | `orc.glb` (key `bugbear_warrior`) | Animations trimmed, meshopt compression and quantization |
| Rat | Quaternius | CC0 1.0 | https://poly.pizza/m/iltq5bVNaV | `rat.glb` (key `giant_rat`) | Animations trimmed, meshopt compression and quantization |
| Spider | Quaternius | CC0 1.0 | https://poly.pizza/m/yRYJiAJyiM | `spider.glb` (key `giant_spider`) | Animations trimmed, meshopt compression and quantization |

Quaternius' work is also available at https://quaternius.com (CC0 unless noted). Poly Pizza (https://poly.pizza) is used only as a download mirror; each page above states the model's author and its license (CC0 1.0 or CC-BY 3.0, as listed).

## Code

- [three.js](https://threejs.org) (MIT License), including its GLTFLoader and meshopt decoder.
- The game's own code is MIT licensed; see [LICENSE](LICENSE).

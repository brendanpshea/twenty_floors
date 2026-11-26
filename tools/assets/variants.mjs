// Declarative list of model VARIANTS built from a base model plus kit parts and recolours.
// To add a variant: add an entry below, run `node build-variants.mjs <name>`, check it in the viewer, then
// add its manifest key in manifest.mjs. See README.md.
//
// Entry fields
//   name        output file public/assets/models/<name>.glb
//   base        base model in assets-src/base/<base>.glb (made by build-models.mjs); its animations and scale come from meta.json
//   scaleMul    multiply the base's manifest scale (e.g. a bigger boss)
//   materials   {materialName: [r,g,b]} linear base-colour edits (models that use plain material colours)
//   recolor     [{nodes:[meshNodeNames], rule:'ruleName'}] texture recolouring (rules below); each mesh gets its own texture copy
//   attach      parts taken from another model and parented to a bone so they follow the animation:
//                 src   key in `sources`; part = node name inside that file; anchor = the node of that file the part is held/worn at
//                 bone  bone of the base to parent to
//                 at    where the anchor lands, in base rest-pose world units: [x,y,z] or {bone:'Name',offset:[x,y,z]}
//                 s     uniform scale about the anchor; aim = direction the part's forward (+Z in KayKit files) should point in the
//                 base's rest pose; or {fromForearm:{hand,elbow,k}}: blade direction = forearm direction*k + forward, which keeps a blade pointing away from the elbow (blades: roughly 45 degrees away from the forearm, see README); twist = roll about aim, degrees
//   textureMax  downscale all textures to this many px (smooth palette atlases survive 256)
import {KA,KS,MODELS,rgb2hsv,hsv2rgb} from './kb.mjs';

export const sources={
  knight:KA+'Knight.glb', barbarian:KA+'Barbarian.glb', rogue:KA+'Rogue.glb', mage:KA+'Mage.glb',
  skelWarrior:KS+'Skeleton_Warrior.glb',
  skelWarriorBuilt:MODELS+'skeleton_warrior.glb',   // output of build-models.mjs: has the pack's curved Skeleton_Blade already on a hand slot skelMinion:KS+'Skeleton_Minion.glb',
};

// colour rules for texture recolouring: (r,g,b 0..255) => [r,g,b] or null to leave the pixel
const greenSkin=(r,g,b)=>{const [h,s,v]=rgb2hsv(r,g,b);return (h>70&&h<140&&s>0.25)?[h,s,v]:null;};
export const rules={
  skinPale:(r,g,b)=>{const x=greenSkin(r,g,b);return x?hsv2rgb(x[0]-20,x[1]*0.7,Math.min(1,x[2]*1.2)):null;},
  skinDark:(r,g,b)=>{const x=greenSkin(r,g,b);return x?hsv2rgb(x[0]+6,x[1]*0.9,Math.min(1,x[2]*1.0)):null;},
  skinBoss:(r,g,b)=>{const x=greenSkin(r,g,b);return x?hsv2rgb(x[0]+12,x[1]*0.75,Math.min(1,x[2]*0.95)):null;},
};

const FOREARM_BLADE=[-0.26,-0.10,0.92];   // about 45 degrees from the right forearm of goblin_smooth: tip extends beyond the fist (checked with the viewer chk= option)
const FOREARM_BLADE_L=[0.26,-0.10,0.92];

export const variants=[
  {name:'goblin_minion',base:'goblin_smooth',textureMax:256,
   recolor:[{nodes:['Zombie'],rule:'skinPale'}],
   attach:[{src:'rogue',part:'Knife',anchor:'handslot.r',bone:'LowerArm.R',at:{bone:'Middle1.R'},s:0.8,aim:FOREARM_BLADE}]},
  {name:'goblin_warrior',base:'goblin_smooth',textureMax:256,
   recolor:[{nodes:['Zombie'],rule:'skinDark'}],
   attach:[
     {src:'knight',part:'1H_Sword',anchor:'handslot.r',bone:'LowerArm.R',at:{bone:'Middle1.R'},s:0.62,aim:FOREARM_BLADE},
     {src:'knight',part:'Round_Shield',anchor:'handslot.l',bone:'LowerArm.L',at:{bone:'Middle1.L',offset:[0.12,0,0.05]},s:0.5}]},
  {name:'goblin_boss',base:'goblin_smooth',scaleMul:1.08,textureMax:256,
   recolor:[{nodes:['Zombie'],rule:'skinBoss'}],
   attach:[
     {src:'skelWarrior',part:'Skeleton_Warrior_Helmet',anchor:'head',bone:'Head',at:[0,0.94,0.17],s:0.46,name:'B_Helmet'},
     {src:'knight',part:'Knight_Cape',anchor:'chest',bone:'Torso',at:[0,0.74,-0.2],s:0.6},
     {src:'skelWarriorBuilt',part:'Skeleton_Blade',anchor:'handslot.r',bone:'LowerArm.R',at:{bone:'Middle1.R'},s:0.85,aim:FOREARM_BLADE},
     {src:'barbarian',part:'Barbarian_Round_Shield',anchor:'handslot.l',bone:'LowerArm.L',at:{bone:'Middle1.L',offset:[0.12,0,0.05]},s:0.55}]},
  {name:'bugbear',base:'orc',
   materials:{Orc_Main:[0.30,0.14,0.05],Orc_Secondary:[0.14,0.065,0.03],Orc_Hair:[0.05,0.03,0.02],Belt:[0.03,0.02,0.01]},
   attach:[{src:'barbarian',part:'1H_Axe',anchor:'handslot.r',bone:'LowerArm.R',at:{bone:'Middle1.R'},s:1.25,aim:{fromForearm:{hand:'Middle1.R',elbow:'LowerArm.R',k:0.7}}}]},
];

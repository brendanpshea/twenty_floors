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

// ---- floors 4-20 variants -------------------------------------------------------------------------------------
// sRGB hex -> linear RGB for base-colour factors
const lin=hex=>[hex>>16&255,hex>>8&255,hex&255].map(c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
const mats=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,lin(v)]));
// hue-window recolour for KayKit atlases: pixels with hue in [h0,h1] (degrees; h1 may exceed 360 to wrap) and saturation >= sMin
// are moved to hue `h` (or kept when h is null) with saturation/value multipliers; everything else (skin, leather, steel) is left.
const hueRule=(h0,h1,sMin,{h=null,sMul=1,vMul=1,vAdd=0})=>(r,g,b)=>{
  let [hh,s,v]=rgb2hsv(r,g,b);const hw=(h1>360&&hh<h1-360)?hh+360:hh;
  if(s<sMin||hw<h0||hw>h1)return null;
  return hsv2rgb(h===null?hh:h,Math.min(1,s*sMul),Math.min(1,v*vMul+vAdd));};
// grey steel (s < 0.12): recolour by value
const steelRule=fn=>(r,g,b)=>{const [h,s,v]=rgb2hsv(r,g,b);if(s>=0.12||v<=0.15)return null;return fn(v);};
Object.assign(rules,{
  rogueBrown:hueRule(130,190,0.3,{h:28,sMul:0.55,vMul:0.85}),
  rogueBlack:hueRule(130,190,0.3,{h:225,sMul:0.12,vMul:0.4}),
  rogueGrey:hueRule(130,190,0.3,{h:225,sMul:0.1,vMul:0.9,vAdd:0.08}),
  rogueNavy:hueRule(130,190,0.3,{h:212,sMul:1,vMul:0.85}),
  rogueCrimson:hueRule(130,190,0.3,{h:355,sMul:1,vMul:0.85}),
  mageCult:(r,g,b)=>hueRule(225,285,0.15,{h:352,sMul:1.3,vMul:0.9})(r,g,b)||hueRule(300,350,0.4,{h:260,sMul:0.2,vMul:0.25})(r,g,b),
  magePriest:(r,g,b)=>hueRule(225,285,0.15,{h:45,sMul:0.18,vMul:2.6,vAdd:0.12})(r,g,b)||hueRule(300,350,0.4,{h:44,sMul:1.1,vMul:1.2})(r,g,b),
  mageGreen:hueRule(225,285,0.15,{h:140,sMul:1,vMul:1.1}),
  barbRed:hueRule(190,230,0.3,{h:4,sMul:1.15,vMul:0.95}),
  knightDark:(r,g,b)=>steelRule(v=>hsv2rgb(240,0.3,v*0.38))(r,g,b)||hueRule(340,380,0.5,{h:285,sMul:0.8,vMul:0.45})(r,g,b),
  knightGreenCape:hueRule(340,380,0.5,{h:150,sMul:0.8,vMul:0.6}),
});
const ALL=[{nodes:'*'}];
const rc=rule=>[{nodes:'*',rule}];
variants.push(
  {name:'hooded_brown',base:'rogue_hooded',textureMax:256,recolor:rc('rogueBrown')},
  {name:'hooded_black',base:'rogue_hooded',textureMax:256,recolor:rc('rogueBlack')},
  {name:'rogue_brown',base:'hero_rogue',textureMax:256,recolor:rc('rogueBrown')},
  {name:'rogue_navy',base:'hero_rogue',textureMax:256,recolor:rc('rogueNavy')},
  {name:'mage_cultist',base:'hero_mage',textureMax:256,recolor:rc('mageCult')},
  {name:'mage_priest',base:'hero_mage',textureMax:256,remove:['Mage_Hat'],recolor:rc('magePriest')},
  {name:'mage_green',base:'hero_mage',textureMax:256,recolor:rc('mageGreen')},
  {name:'barb_red',base:'hero_barbarian',textureMax:256,recolor:rc('barbRed')},
  {name:'knight_dark',base:'hero_knight',textureMax:256,recolor:rc('knightDark')},
  {name:'knight_gold',base:'hero_knight',textureMax:256,recolor:rc('gold')},
  {name:'knight_green',base:'hero_knight',textureMax:256,recolor:rc('knightGreenCape')},
  // creatures: plain material colour edits (sRGB hex)
  {name:'dragon_red',base:'dragonevo',materials:mats({Dragon_Main:0xb81c14,Dragon_Secondary:0x4a0c0a})},
  {name:'dragon_black',base:'dragonevo',materials:mats({Dragon_Main:0x2c2c34,Dragon_Secondary:0x121216})},
  {name:'dragon_blue',base:'dragonevo',materials:mats({Dragon_Main:0x2a62c8,Dragon_Secondary:0x0e1f4c})},
  {name:'dragon_green',base:'dragonevo',materials:mats({Dragon_Main:0x2f8a3a,Dragon_Secondary:0x113c1a})},
  {name:'dragon_white',base:'dragonevo',materials:mats({Dragon_Main:0xe4eef6,Dragon_Secondary:0x8aa4bc})},
  {name:'dragon_gold',base:'dragonevo',materials:mats({Dragon_Main:0xd9a21c,Dragon_Secondary:0x7a4a12})},
  {name:'wyvern',base:'dragon',materials:mats({Dragon_Main:0x5f7d2c,Dragon_Secondary:0x2a3a16})},
  {name:'frog_green',base:'frog',materials:mats({Frog_Main:0x3f8a2e,Frog_Secondary:0x16321a})},
  {name:'slime_gray',base:'slime',materials:mats({Body:0x8c9098})},
  {name:'slime_ochre',base:'slime',materials:mats({Body:0xcf9a28})},
  {name:'slime_cyan',base:'slime',materials:mats({Body:0x36c4d8})},
  {name:'slime_black',base:'slime',materials:mats({Body:0x241a30})},
  {name:'crab_teal',base:'crab',materials:mats({Main:0x2f8a78,Main_Dark:0x164a40})},
  {name:'mushnub_violet',base:'mushnub',materials:mats({MushroomKing_Secondary:0x7e2ea6,MushroomKing_Main:0x8a6a8a})},
  {name:'mushking_moss',base:'mushking',materials:mats({MushroomKing_Secondary:0x3b6e2a,MushroomKing_Main:0x5a4020})},
  {name:'hag_green',base:'witch',materials:mats({Skin:0x7fb060,Purple:0x3f7f3a})},
);

// companions (allies travelling with the hero): scaleMul normalises LEVEL-1 natural size (VisualSpec.scale grows them per tier)
variants.push(
  {name:'companion_sphinx',base:'cat',scaleMul:0.78,materials:mats({Cat_Main:0xd9a54a,Cat_Secondary:0xf4e2b8,Ears:0xe8b070})},
  {name:'companion_pseudodragon',base:'dragon',scaleMul:0.333,materials:mats({Dragon_Main:0x9a4a2a,Dragon_Secondary:0x4a2418})},
  {name:'companion_blinkdog',base:'wolf_smooth',materials:mats({Main:0xc9965a,Main_Light:0xf0dcb0})},
);

variants.push(
  {name:'mephit_ice',base:'hywirl',materials:mats({Hywirl_Main:0x7cc8f0})},
  {name:'mephit_fire',base:'hywirl',materials:mats({Hywirl_Main:0xe8581c})},
  {name:'gargoyle_stone',base:'bluedemon',materials:mats({BlueDemon_Main:0x8a8f98,BlueDemon_Secondary:0x5a5e66})},
  {name:'birb_gold',base:'birb',materials:mats({Birb_Main:0xc9902c,Birb_Secondary:0xf2e2b0,Birb_Beak:0xe0b030})},
  {name:'birb_grey',base:'birb',materials:mats({Birb_Main:0x6a6670,Birb_Secondary:0xb0a8b0,Birb_Beak:0x8a7a60})},
  {name:'birb_crimson',base:'birb',materials:mats({Birb_Main:0x8a2420,Birb_Secondary:0x3a1a1a,Birb_Beak:0xd8c070})},
);

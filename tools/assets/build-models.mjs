import fs from 'node:fs';
import path from 'node:path';
import {NodeIO,getBounds} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMeshQuantization,ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {mergeDocuments,prune,dedup,resample,quantize,reorder,weld,textureCompress} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import {shrinkTextures} from './kb.mjs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
import {SRC,BASE,MODELS,TOOLS} from './paths.mjs';
const A=SRC+'kaykit_adv/repo/addons/kaykit_character_pack_adventures/';
const S=SRC+'kaykit_skel/repo/addons/kaykit_character_pack_skeletons/';
const OUT=MODELS;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const SWORD={t:[0,0.03,0],r:[0,-1,0,0]};
const kk=(adv)=>({idle:'Idle',walk:'Walking_A',attack:'1H_Melee_Attack_Chop',hit:'Hit_A',death:'Death_A',cast:'Spellcast_Shoot',shoot:'Throw',block:'Block',dodge:'Dodge_Backward'});
// name -> config
const M={
 hero_knight:{src:A+'Characters/gltf/Knight.glb',height:1.8,remove:['2H_Sword','1H_Sword_Offhand','Rectangle_Shield','Spike_Shield','Round_Shield'],anim:kk()},
 hero_barbarian:{src:A+'Characters/gltf/Barbarian.glb',height:1.8,remove:['1H_Axe_Offhand','2H_Axe','Mug'],anim:kk()},
 hero_rogue:{src:A+'Characters/gltf/Rogue.glb',height:1.8,remove:['1H_Crossbow','2H_Crossbow','Throwable'],anim:{...kk(),attack:'Dualwield_Melee_Attack_Slice'}},
 rogue_hooded:{base:true,src:A+'Characters/gltf/Rogue_Hooded.glb',height:1.8,remove:['1H_Crossbow','2H_Crossbow','Throwable'],anim:{...kk(),attack:'Dualwield_Melee_Attack_Slice'}},
 hero_mage:{src:A+'Characters/gltf/Mage.glb',height:1.8,remove:['Spellbook','Spellbook_open','2H_Staff'],anim:{...kk(),attack:'1H_Melee_Attack_Chop',cast:'Spellcast_Long',shoot:'Spellcast_Shoot'}},
 skeleton_warrior:{src:S+'Characters/gltf/Skeleton_Warrior.glb',height:1.8,attach:[['handslot.r',S+'Assets/gltf/Skeleton_Blade.gltf','Skeleton_Blade',SWORD],['handslot.l',S+'Assets/gltf/Skeleton_Shield_Small_A.gltf','Skeleton_Shield_Small_A',{t:[0,0.02,0.16],r:[0,0,0,1]}]],anim:kk()},
 skeleton_mage:{src:S+'Characters/gltf/Skeleton_Mage.glb',height:1.8,attach:[['handslot.r',S+'Assets/gltf/Skeleton_Staff.gltf','Skeleton_Staff',SWORD]],anim:{...kk(),attack:'Spellcast_Shoot',cast:'Spellcast_Raise',shoot:'Spellcast_Shoot'}},
 skeleton_rogue:{src:S+'Characters/gltf/Skeleton_Rogue.glb',height:1.8,attach:[['handslot.r',S+'Assets/gltf/Skeleton_Blade.gltf','Skeleton_Blade',SWORD]],anim:kk()},
 skeleton_minion:{src:S+'Characters/gltf/Skeleton_Minion.glb',height:1.8,attach:[['handslot.r',S+'Assets/gltf/Skeleton_Axe.gltf','Skeleton_Axe',SWORD]],anim:kk()},
};
const Q=(n)=>SRC+`pp_${n}/${n}.glb`;
const EN=(c)=>({idle:'Idle',walk:'Walk',attack:'Attack',hit:'HitRecieve',death:'Death'});
Object.assign(M,{
 orc:{base:true,src:Q('orc'),height:2.2,anim:{idle:'Idle',walk:'Walk',attack:'Weapon',hit:'HitReact',death:'Death'},pref:'CharacterArmature|'},
 ghost:{src:Q('ghost'),height:1.8,anim:{idle:'Flying_Idle',walk:'Fast_Flying',attack:'Punch',hit:'HitReact',death:'Death'},pref:'CharacterArmature|'},
 rat:{src:Q('rat'),height:0.6,anim:{idle:'Rat_Idle',walk:'Rat_Walk',attack:'Rat_Attack',death:'Rat_Death'},pref:'RatArmature|'},
 spider:{src:Q('spider'),height:0.9,anim:{idle:'Spider_Idle',walk:'Spider_Walk',attack:'Spider_Attack',death:'Spider_Death'},pref:'SpiderArmature|'},
});
Object.assign(M,{
 goblin_smooth:{base:true,src:Q('zombieB'),height:1.2,anim:{idle:'Idle',walk:'Walk',attack:'Punch',hit:'HitReact',death:'Death'},pref:'CharacterArmature|'},
 zombie_smooth:{src:Q('zombieD'),height:1.8,anim:{idle:'Idle',walk:'Walk',attack:'Punch',hit:'HitReact',death:'Death'},pref:'CharacterArmature|'},
 ghoul_smooth:{src:Q('zombieC'),height:1.7,anim:{idle:'ZombieIdle',walk:'ZombieWalk',attack:'ZombieBite'},timescale:{ZombieBite:0.25,ZombieWalk:0.5,ZombieIdle:0.5},pref:'Zombie|'},
 ogre_smooth:{src:Q('bigarm'),height:3.2,anim:{idle:'Idle',walk:'Walk',attack:'Punch',hit:'HitReact',death:'Death'},pref:'CharacterArmature|'},
 wolf_smooth:{src:Q('wolfA'),height:1.0,anim:{idle:'Idle',walk:'Walk',attack:'Attack',hit:'Idle_HitReact_Left',death:'Death'},pref:'AnimalArmature|'},
});
// --- floors 4-20 creature models (all Quaternius, CC0 per poly.pizza; see CREDITS.md). height = natural size at visual.scale 1.
const CA='CharacterArmature|';
const std=(a={})=>({idle:'Idle',walk:'Walk',attack:'Punch',hit:'HitReact',death:'Death',dodge:'Duck',...a});
const bite=(a={})=>({idle:'Idle',walk:'Walk',attack:'Bite_Front',hit:'HitRecieve',death:'Death',...a});
const fly=(a={})=>({idle:'Flying_Idle',walk:'Fast_Flying',attack:'Headbutt',hit:'HitReact',death:'Death',...a});
Object.assign(M,{
 frog:{src:Q('frog'),height:0.8,anim:std(),pref:CA},
 slime:{base:true,src:Q('slime'),height:0.8,anim:{idle:'Slime_Idle',walk:'Slime_Walk',attack:'Slime_Attack',death:'Slime_Death'},pref:'Armature|'},
 snake:{src:Q('snake'),height:0.5,anim:{idle:'Snake_Idle',walk:'Snake_Walk',attack:'Snake_Attack'},pref:'SnakeArmature|'},
 mushnub:{base:true,src:Q('mushnub'),height:0.8,anim:bite(),pref:CA},
 blob:{src:Q('blob'),height:0.9,anim:bite(),pref:CA},
 crab:{base:true,src:Q('crab'),height:0.9,anim:bite(),pref:'MonsterArmature|'},
 bat:{src:Q('bat'),height:0.5,anim:{idle:'Bat_Flying',walk:'Bat_Flying',attack:'Bat_Attack',hit:'Bat_Hit',death:'Bat_Death'},pref:'BatArmature|'},
 mushking:{base:true,src:Q('mushking2'),height:2.0,anim:std(),pref:CA},
 imp:{src:Q('imp'),height:1.3,anim:std({attack:'Weapon'}),pref:CA},
 bluedemon:{src:Q('bluedemon2'),height:1.7,anim:std(),pref:CA},
 birb:{base:true,src:Q('birb'),height:1.5,anim:bite(),pref:CA},
 hywirl:{base:true,src:Q('hywirl'),height:1.0,anim:fly(),pref:CA},
 dino:{src:Q('dino2'),height:1.5,anim:std(),pref:CA},
 yeti:{src:Q('yeti'),height:2.2,anim:bite(),pref:CA},
 cat:{src:Q('cat'),height:0.9,anim:bite(),pref:CA},
 bull:{src:Q('bull'),height:1.6,anim:{idle:'Idle',walk:'Walk',attack:'Attack_Headbutt',hit:'Idle_HitReact_Left',death:'Death'},pref:'AnimalArmature|'},
 witch:{base:true,src:Q('witch'),height:1.8,anim:{idle:'Idle',walk:'Walk',attack:'Punch_Right',hit:'HitRecieve',death:'Death'},pref:CA,textureMax:512},
 dragon:{src:Q('dragon'),height:1.8,anim:fly(),pref:CA},
 dragonevo:{base:true,src:Q('dragonevo'),height:2.2,anim:fly(),pref:CA},
});
const only=process.argv.slice(2);
const meta={};
for(const [name,c] of Object.entries(M)){
  if(only.length&&!only.includes(name))continue;
  const doc=await io.read(c.src); const root=doc.getRoot(); const scene=root.listScenes()[0];
  const byName=n=>root.listNodes().find(x=>x.getName()===n);
  for(const n of c.remove||[]){const nd=byName(n); if(!nd)throw new Error('no node '+n); nd.dispose();}
  for(const [slot,file,wname,tr] of c.attach||[]){
    const wd=await io.read(file); mergeDocuments(doc,wd);
    const wn=root.listNodes().find(x=>x.getName()===wname); const hs=byName(slot);
    if(!wn||!hs)throw new Error('attach fail '+wname);
    for(const s of root.listScenes()) s.removeChild(wn);
    wn.setTranslation(tr.t).setRotation(tr.r); hs.addChild(wn);
    for(const s of root.listScenes().slice(1)) s.dispose();
  }
  // consolidate buffers
  const bufs=root.listBuffers(); for(const a of root.listAccessors()) a.setBuffer(bufs[0]); bufs.slice(1).forEach(b=>b.dispose());
  // animations: keep mapped, rename to short names
  const want=new Map(); for(const [k,v] of Object.entries(c.anim)) want.set((c.pref||'')+v,v);
  const used={};
  for(const an of root.listAnimations()){
    const nm=an.getName();
    if(want.has(nm)&&!used[nm]){const sc=(c.timescale||{})[want.get(nm)];if(sc){for(const a of new Set(an.listSamplers().map(sm=>sm.getInput()))){a.setArray(a.getArray().map(x=>x*sc));}}an.setName(want.get(nm)); used[nm]=1;} else {an.listChannels().forEach(x=>x.dispose());an.listSamplers().forEach(x=>x.dispose());an.dispose();}
  }
  for(const [k,v] of Object.entries(c.anim)) if(!used[(c.pref||'')+v]) throw new Error(name+': missing clip '+v);
  // drop animation channels on nodes that are neither skin joints nor their ancestors (Blender IK/control helpers): they cost bytes and move nothing
  {const keep=new Set();for(const sk of root.listSkins())for(const j of sk.listJoints()){let n=j;while(n){keep.add(n);n=n.getParentNode();}}
   if(keep.size)for(const an of root.listAnimations())for(const ch of an.listChannels())if(!keep.has(ch.getTargetNode()))ch.dispose();}
  const b=getBounds(scene); const h=b.max[1]-b.min[1];
  const prev=fs.existsSync(TOOLS+'meta.json')?JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8'))[name]:null;
  const scale=prev&&prev.rawHeight?prev.scale:+(c.height/h).toFixed(4);
  if(c.textureMax)await shrinkTextures(doc,c.textureMax);
  for(const sk of root.listSkins()) sk.setSkeleton(null);
  await doc.transform(prune(),dedup(),resample(),weld());
  // drop animation channels that never move their node (constant at the rest transform): scale tracks and most translation tracks; saves a lot of accessor/JSON overhead
  for(const an of root.listAnimations())for(const ch of an.listChannels()){const nd=ch.getTargetNode(),p=ch.getTargetPath();if(!nd)continue;
    const rest=p==='translation'?nd.getTranslation():p==='scale'?nd.getScale():nd.getRotation();const out=ch.getSampler().getOutput(),w=out.getElementSize(),oa=out.getArray();
    let moves=false;for(let i=0;i<oa.length&&!moves;i++)if(Math.abs(oa[i]-rest[i%w])>2e-4)moves=true;
    if(!moves){const sm=ch.getSampler();ch.dispose();if(!sm.listParents().some(x=>x.propertyType==='AnimationChannel'))sm.dispose();}}
  // textures
  for(const t of root.listTextures()){/* keep */}
  await doc.transform(reorder({encoder:MeshoptEncoder}),quantize({quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12}),prune(),dedup());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.FILTER});
  fs.mkdirSync(BASE,{recursive:true});const out=(c.base?BASE:OUT)+name+'.glb'; await io.write(out,doc);
  meta[name]={...(prev||{}),height:prev?.height||c.height,scale,anim:c.anim,bytes:fs.statSync(out).size};
  console.log(name,meta[name].bytes,'rawH',h.toFixed(2),'scale',scale);
}
fs.writeFileSync(TOOLS+'meta.json',JSON.stringify({...(fs.existsSync(TOOLS+'meta.json')?JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8')):{}),...meta},null,1));

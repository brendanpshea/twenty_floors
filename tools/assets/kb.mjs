// kitbash helpers (gltf-transform scripting)
import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,EXTMeshoptCompression} from '@gltf-transform/extensions';
import {mergeDocuments,prune,dedup} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';
import {mat4,vec3,quat} from 'gl-matrix';
import sharp from 'sharp';
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
export const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
import {ROOT,SRC,BASE,MODELS,MANIFEST} from './paths.mjs';
export {ROOT,SRC,BASE,MODELS,MANIFEST};
export const PUB=MODELS;
export const KA=SRC+'kaykit_adv/repo/addons/kaykit_character_pack_adventures/Characters/gltf/';
export const KS=SRC+'kaykit_skel/repo/addons/kaykit_character_pack_skeletons/Characters/gltf/';

export const load=p=>io.read(p);
export const find=(doc,name)=>{const n=doc.getRoot().listNodes().find(x=>x.getName()===name);if(!n)throw new Error('no node '+name);return n;};
const M=n=>mat4.clone(n.getWorldMatrix());
export function decompose(m){const t=vec3.create(),r=quat.create(),s=vec3.create();mat4.getTranslation(t,m);mat4.getScaling(s,m);mat4.getRotation(r,m);return {t,r,s};}
/**
 * Take node `partName` from srcDoc (with its KayKit-rest-pose world transform), re-anchor it so that the
 * point srcAnchor (a node in srcDoc) lands at world point P of the target model, scaled by s about that point
 * and rotated by euler (deg, applied about the anchor), then parent it to `boneName` of the target so it follows the animation.
 */
export function mount(doc,srcDoc,partName,srcAnchorName,boneName,{P,s=1,rot=[0,0,0],aim=null,twist=0,name,keepAnims=false}){
  if(P&&!Array.isArray(P)){const b=worldPos(doc,P.bone);P=[b[0]+(P.offset?.[0]||0),b[1]+(P.offset?.[1]||0),b[2]+(P.offset?.[2]||0)];}
  const part=find(srcDoc,partName),W=M(part);
  const A=vec3.create();mat4.getTranslation(A,M(find(srcDoc,srcAnchorName)));
  const mp=mergeDocuments(doc,srcDoc);
  const np=mp.get(part);
  // remove merged scenes / animations (only keep the part)
  for(const [o,nw] of mp){ if(o.propertyType==='Animation'){nw.listChannels().forEach(c=>c.dispose());nw.listSamplers().forEach(c=>c.dispose());nw.dispose();}}
  for(const sc of doc.getRoot().listScenes().slice(1)) sc.dispose();
  const keep=new Set();(function k(n){keep.add(n);n.listChildren().forEach(k);})(np);
  for(const [o,nw] of mp){if(o.propertyType==='Node'&&!keep.has(nw))nw.dispose();}
  const q=quat.create();
  if(aim){const a=vec3.normalize(vec3.create(),aim);quat.rotationTo(q,[0,0,1],a);if(twist){const t=quat.setAxisAngle(quat.create(),a,twist*Math.PI/180);quat.multiply(q,t,q);}}else quat.fromEuler(q,...rot);
  const T=mat4.fromTranslation(mat4.create(),P);
  const R=mat4.fromQuat(mat4.create(),q);
  const S=mat4.fromScaling(mat4.create(),[s,s,s]);
  const mA=mat4.fromTranslation(mat4.create(),vec3.negate(vec3.create(),A));
  let pw=mat4.create();mat4.multiply(pw,T,R);mat4.multiply(pw,pw,S);mat4.multiply(pw,pw,mA);mat4.multiply(pw,pw,W);
  const bone=find(doc,boneName);const inv=mat4.invert(mat4.create(),M(bone));
  const loc=mat4.multiply(mat4.create(),inv,pw);const d=decompose(loc);
  const par=np.getParentNode();if(par)par.removeChild(np);for(const sc of doc.getRoot().listScenes())sc.removeChild(np);
  np.setTranslation([...d.t]).setRotation([...d.r]).setScale([...d.s]);
  if(name)np.setName(name);
  bone.addChild(np);return np;
}
export const worldPos=(doc,name)=>{const v=vec3.create();mat4.getTranslation(v,M(find(doc,name)));return [...v];};
export function removeNodes(doc,names){for(const n of names)find(doc,n).dispose();}
export function triCount(doc){let t=0;for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives()){const i=p.getIndices();t+=(i?i.getCount():p.getAttribute('POSITION').getCount())/3;}return Math.round(t);}
export async function save(doc,name,dir=MODELS){
  await doc.transform(prune(),dedup());
  const root=doc.getRoot();const bufs=root.listBuffers();for(const a of root.listAccessors())a.setBuffer(bufs[0]);bufs.slice(1).forEach(b=>b.dispose());
  if(!root.listExtensionsUsed().some(e=>e.extensionName==='EXT_meshopt_compression'))doc.createExtension(EXTMeshoptCompression).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  fs.mkdirSync(dir,{recursive:true});const out=dir+name+'.glb';await io.write(out,doc);const sz=fs.statSync(out).size;
  const clips=root.listAnimations().map(a=>a.getName());
  console.log(name,(sz/1024).toFixed(0)+'KB','tris',triCount(doc),'clips',clips.join(','));return sz;}
// image recolour: fn(r,g,b)->[r,g,b] applied to every pixel; returns new Texture cloned from tex
export async function recolorTexture(doc,tex,fn,name){
  const {data,info}=await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){const o=fn(data[i],data[i+1],data[i+2],i/4%info.width|0,(i/4/info.width)|0);if(o){data[i]=o[0];data[i+1]=o[1];data[i+2]=o[2];}}
  const png=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png({compressionLevel:9}).toBuffer();
  const t=doc.createTexture(name).setImage(new Uint8Array(png)).setMimeType('image/png');return t;}
export const rgb2hsv=(r,g,b)=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}return [h,mx?d/mx:0,mx];};
export const hsv2rgb=(h,s,v)=>{const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];};

export const rules={
  gold(r,g,b){const [h,s,v]=rgb2hsv(r,g,b);if(s<0.12&&v>0.15)return hsv2rgb(44,Math.min(0.9,0.55+0.4*v),Math.min(1,v*1.15+0.08));return null;},
  blueCape(r,g,b){const [h,s,v]=rgb2hsv(r,g,b);if(s>0.5&&(h<20||h>340))return hsv2rgb(215,s,v*0.9);return null;},
  eliteSteel(r,g,b){const [h,s,v]=rgb2hsv(r,g,b);if(s<0.12&&v>0.15){return v>0.58?hsv2rgb(44,0.8,Math.min(1,v*1.1)):hsv2rgb(225,0.35,v*0.5);}return null;},
  purpleCloak(r,g,b){const [h,s,v]=rgb2hsv(r,g,b);if(s>0.45&&(h<30||h>320))return hsv2rgb(275,s*0.9,v*0.85);return null;},
};
export async function apply(doc,nodeNames,ruleName,suffix){
  const root=doc.getRoot();const cache=new Map();
  for(const n of root.listNodes()){if(!nodeNames.includes(n.getName()))continue;
    for(const p of n.getMesh().listPrimitives()){const mat=p.getMaterial();const tex=mat.getBaseColorTexture();if(!tex)continue;
      const key=mat.getName()+ruleName;if(!cache.has(key)){const nt=await recolorTexture(doc,tex,rules[ruleName],tex.getName()+'_'+suffix);const nm=mat.clone().setName(mat.getName()+'_'+suffix).setBaseColorTexture(nt);cache.set(key,nm);}
      p.setMaterial(cache.get(key));}}}

// copy animation clips by name from srcDoc onto same-named nodes of doc (same rig / same bone names)
export function copyClips(doc,srcDoc,names){
  const mp=mergeDocuments(doc,srcDoc);const byName=new Map(doc.getRoot().listNodes().filter(n=>![...mp.values()].includes(n)).map(n=>[n.getName(),n]));
  for(const [o,nw] of mp){
    if(o.propertyType==='Animation'){ if(names.includes(o.getName())){ for(const ch of nw.listChannels()){const t=byName.get(ch.getTargetNode().getName());if(t)ch.setTargetNode(t);else ch.dispose();} } else {nw.listChannels().forEach(c=>c.dispose());nw.listSamplers().forEach(c=>c.dispose());nw.dispose();} }
  }
  for(const [o,nw] of mp){if(o.propertyType==='Node')nw.dispose();}
  for(const sc of doc.getRoot().listScenes().slice(1))sc.dispose();
}
rules.wightArmor=(r,g,b)=>{const [h,s,v]=rgb2hsv(r,g,b);if(s<0.12&&v>0.15)return hsv2rgb(200,0.28,v*0.5);return null;};
rules.greenCape=(r,g,b)=>{const [h,s,v]=rgb2hsv(r,g,b);if(s>0.5&&(h<20||h>340))return hsv2rgb(150,s*0.8,v*0.55);return null;};

// downscale every texture larger than max px (square palette atlases survive this: they are smooth ramps / flat blocks)
export async function shrinkTextures(doc,max){
  for(const t of doc.getRoot().listTextures()){const [w,h]=t.getSize();if(Math.max(w,h)<=max)continue;
    const png=await sharp(Buffer.from(t.getImage())).resize(max,max,{kernel:'nearest'}).png({compressionLevel:9}).toBuffer();t.setImage(new Uint8Array(png));}
}
// set base colour factors (linear RGB 0..1) of named materials
export function setMaterialColors(doc,map){const seen=new Set();for(const m of doc.getRoot().listMaterials()){const c=map[m.getName()];if(c){m.setBaseColorFactor([...c,1]);seen.add(m.getName());}}
  for(const k of Object.keys(map))if(!seen.has(k))throw new Error('no material '+k);}

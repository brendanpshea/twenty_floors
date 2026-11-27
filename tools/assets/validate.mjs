import fs from 'node:fs';import path from 'node:path';
import {NodeIO,getBounds} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import validator from 'gltf-validator';
import {ROOT,SRC,TOOLS} from './paths.mjs';
await MeshoptDecoder.ready;
const root=process.argv[2]||ROOT+'public'; // site root (manifest urls are relative to it)
const man=JSON.parse(fs.readFileSync(process.argv[3]||path.join(root,'assets/manifest.json'),'utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const ANIMS=['idle','walk','attack','hit','death','cast','shoot','block','dodge'];
const files=new Map();let fail=0;
for(const [k,e] of Object.entries(man.models)){ if(!files.has(e.url))files.set(e.url,[]);files.get(e.url).push(k);
  for(const a of Object.keys(e.animations||{})) if(!ANIMS.includes(a)){console.log('BAD anim key',k,a);fail++;} }
import {execFileSync} from 'node:child_process';
const rawOut=execFileSync('node',[TOOLS+'shot.mjs',SRC+'shots/val.png',(process.argv[3]?'man=/src/'+path.basename(process.argv[3])+'&':'')+'raw=1&anim=idle&t=0&d=40&keys='+[...files.values()].map(k=>k[0]).join(','),'1600','300'],{encoding:'utf8'});
const RAW={};for(const l of rawOut.split(/\r?\n/)){const m=l.match(/^(\S+) h ([\d.]+)/);if(m)RAW[m[1]]=+m[2];}
let total=0;
for(const [url,keys] of files){
  const p=path.join(root,url);const buf=fs.readFileSync(p);total+=buf.length;
  const d=await io.readBinary(new Uint8Array(buf));const r=d.getRoot();
  const rep=await validator.validateBytes(new Uint8Array(buf),{maxIssues:20});
  let tris=0;for(const m of r.listMeshes())for(const pr of m.listPrimitives()){const i=pr.getIndices();tris+=(i?i.getCount():pr.getAttribute('POSITION').getCount())/3;}
  const clips=Object.fromEntries(r.listAnimations().map(a=>[a.getName(),a.listSamplers().reduce((m,s)=>Math.max(m,s.getInput().getMax([])[0]),0)]));
    const sc=man.models[keys[0]].scale;
  console.log(`\n${url}  ${(buf.length/1024).toFixed(0)} KB  tris=${Math.round(tris)}  keys=[${keys.join(',')}]`);
  console.log(`  textures: ${r.listTextures().map(t=>t.getMimeType().split('/')[1]+' '+t.getSize().join('x')+' '+(t.getImage().byteLength/1024).toFixed(0)+'KB').join('; ')||'none'}`);
  console.log(`  bbox height (three.js Box3, idle t=0, unscaled) ${RAW[keys[0]]} x scale ${sc} = ${(RAW[keys[0]]*sc).toFixed(2)} world units`);
  console.log(`  clips: ${Object.entries(clips).map(([n,t])=>n+' '+t.toFixed(2)+'s').join(', ')}`);
  console.log(`  gltf-validator: errors=${rep.issues.numErrors} warnings=${rep.issues.numWarnings} infos=${rep.issues.numInfos}`);
  if(rep.issues.numErrors){fail++;console.log(JSON.stringify(rep.issues.messages.filter(m=>m.severity===0).slice(0,5)));}
  for(const k of keys)for(const [a,c] of Object.entries(man.models[k].animations||{})) if(!(c in clips)){console.log('  MISSING clip',k,a,c);fail++;}
}
console.log(`\nTOTAL models: ${(total/1024).toFixed(0)} KB (${(total/1048576).toFixed(2)} MB), files=${files.size}, manifest keys=${Object.keys(man.models).length}, failures=${fail}`);

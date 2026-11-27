// Build all model variants declared in variants.mjs into public/assets/models/.
//   node build-variants.mjs [name ...]      (VARIANT_OUT=<dir> writes elsewhere for experiments)
import fs from 'node:fs';
import {worldPos,load,mount,save,apply,setMaterialColors,shrinkTextures,find,rules as kbRules,triCount,BASE,MODELS,io} from './kb.mjs';
import {TOOLS} from './paths.mjs';
import {variants,sources,rules} from './variants.mjs';
Object.assign(kbRules,rules);
const only=process.argv.slice(2);
import path from 'node:path';
const outDir=process.env.VARIANT_OUT?path.resolve(process.env.VARIANT_OUT).split(path.sep).join('/')+'/':MODELS;
const metaFile=TOOLS+'meta.json';
const meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
const srcCache={};
const getSrc=async k=>{if(!sources[k])throw new Error('unknown source '+k);return srcCache[k]||(srcCache[k]=await load(sources[k]));};
for(const v of variants){
  if(only.length&&!only.includes(v.name))continue;
  const baseMeta=meta[v.base];if(!baseMeta)throw new Error('no meta for base '+v.base+' (run build-models.mjs)');
  const baseFile=fs.existsSync(BASE+v.base+'.glb')?BASE+v.base+'.glb':MODELS+v.base+'.glb';
  const doc=await load(baseFile);
  for(const n of v.remove||[])find(doc,n).dispose();
  if(v.materials)setMaterialColors(doc,v.materials);
  for(const r of v.recolor||[]){const nodes=r.nodes==='*'?doc.getRoot().listNodes().filter(n=>n.getMesh()).map(n=>n.getName()):r.nodes;await apply(doc,nodes,r.rule,v.name);}
  for(const a of v.attach||[]){
    // each mount merges a fresh copy of the source so repeated parts do not interfere
    const srcDoc=await load(sources[a.src]);
    let aim=a.aim;
    if(aim&&aim.fromForearm){const f=aim.fromForearm,h=worldPos(doc,f.hand),e=worldPos(doc,f.elbow);const d=[h[0]-e[0],h[1]-e[1],h[2]-e[2]];const n=Math.hypot(...d);aim=[d[0]/n*f.k,d[1]/n*f.k+0.15,d[2]/n*f.k+1];}
    mount(doc,srcDoc,a.part,a.anchor,a.bone,{P:a.at,s:a.s??1,rot:a.rot,aim,twist:a.twist,name:a.name||undefined});
  }
  if(v.textureMax)await shrinkTextures(doc,v.textureMax);
  const bytes=await save(doc,v.name,outDir);
  meta[v.name]={...(meta[v.name]||{}),anim:baseMeta.anim,scale:+(baseMeta.scale*(v.scaleMul||1)).toFixed(4),height:baseMeta.height,variantOf:v.base,bytes};
}
if(!process.env.VARIANT_OUT)fs.writeFileSync(metaFile,JSON.stringify(meta,null,1));

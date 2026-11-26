// Writes assets-src/kitbash/manifest.json for the viewer: the variants built into VARIANT_OUT (default assets-src/kitbash/out)
// next to their bases, so they can be rendered with `viewer/index.html?man=/src/kitbash/manifest.json&keys=...`
import fs from 'node:fs';
import {SRC,TOOLS,MANIFEST} from './paths.mjs';
import {variants} from './variants.mjs';
const meta=JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8'));
const game=JSON.parse(fs.readFileSync(MANIFEST,'utf8')).models;
const models={hero_knight:game.hero_knight};
for(const [n,b] of [['goblin_smooth','goblin_smooth'],['orc','orc']]){models['base_'+n]={url:'src/base/'+b+'.glb',scale:meta[b].scale,animations:meta[b].anim};}
for(const v of variants)models[v.name]={url:'src/kitbash/out/'+v.name+'.glb',scale:meta[v.name]?.scale??meta[v.base].scale*(v.scaleMul||1),animations:meta[v.base].anim};
fs.mkdirSync(SRC+'kitbash',{recursive:true});fs.writeFileSync(SRC+'kitbash/manifest.json',JSON.stringify({models},null,1));
console.log(Object.keys(models).join(' '));

import {execFileSync} from 'node:child_process';import fs from 'node:fs';
import {MANIFEST,TOOLS,SRC} from './paths.mjs';
const man=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
const meta=JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8'));
const out=execFileSync('node',[TOOLS+'shot.mjs',SRC+'shots/cal.png','raw=1&anim=idle&t=0&keys='+Object.keys(man.models).join(',')+'&d=40','1600','400'],{encoding:'utf8'});
const H={};for(const l of out.split('\n')){const m=l.match(/^(\S+) h ([\d.]+)/);if(m)H[m[1]]=+m[2];}
const T={hero_knight:1.8,hero_barbarian:1.8,hero_rogue:1.8,hero_mage:1.8,skeleton_warrior:1.8,skeleton_mage:1.8,skeleton_rogue:1.8,skeleton_minion:1.8,goblin:1.2,giant:3.2,zombie:1.8,ghoul:1.7,orc:2.2,ghost:1.8,rat:0.45,spider:0.8,wolfA:1.0,wolfB:1.0};
const done=new Set();
for(const [k,e] of Object.entries(man.models)){const f=e.url.match(/models\/(.*)\.glb/)[1];if(done.has(f))continue;done.add(f);
 const ns=+(meta[f].height/H[k]).toFixed(4);console.log(f,'raw',H[k],'->scale',ns,'(prev',meta[f].scale+')');meta[f].scale=ns;meta[f].rawHeight=H[k];meta[f].height=meta[f].height;}
fs.writeFileSync(TOOLS+'meta.json',JSON.stringify(meta,null,1));

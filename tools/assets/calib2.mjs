// usage: node calib2.mjs key[,key...]   Re-measures the given manifest keys with a per-vertex (skinned) bounding box at idle t=0.3
// and sets meta[file].scale = meta[file].height / measured. (calib.mjs uses the cheaper Box3 which is wrong for skinned models
// whose armature carries a scale; use this for new Quaternius-style models.) Needs the viewer server (node viewer/server.mjs).
import {execFileSync} from 'node:child_process';import fs from 'node:fs';
import {MANIFEST,TOOLS,SRC} from './paths.mjs';
const man=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
const meta=JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8'));
const keys=process.argv[2].split(',');
const out=execFileSync('node',[TOOLS+'shot.mjs',SRC+'shots/cal2.png','raw=1&anim=idle&t=0.3&d=40&keys='+keys.join(','),'1600','400'],{encoding:'utf8'});
const H={},Y={};for(const l of out.split(/\r?\n/)){const m=l.match(/^(\S+) H2 ([\d.]+) minY (-?[\d.]+)/);if(m){H[m[1]]=+m[2];Y[m[1]]=+m[3];}}
for(const k of keys){const f=man.models[k].url.match(/models\/(.*)\.glb/)[1];const ns=+(meta[f].height/H[k]).toFixed(4);
 console.log(f,'measured',H[k],'minY',Y[k],'-> scale',ns,'(prev',meta[f].scale+')');meta[f].scale=ns;meta[f].rawHeight=H[k];}
fs.writeFileSync(TOOLS+'meta.json',JSON.stringify(meta,null,1));

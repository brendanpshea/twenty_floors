// usage: node fetch.mjs name:PublicID ... -> downloads to assets-src/pp_<name>/<name>.glb
// Prints "name id creator licence title bytes" as listed on the poly.pizza page (the licence evidence for CREDITS.md)
// and appends the line to assets-src/fetch_log.txt. Throttled and retried because poly.pizza answers 429 when hurried.
import fs from 'node:fs';
import {SRC} from './paths.mjs';
const H={'User-Agent':'Mozilla/5.0'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,bin){for(let k=0;k<6;k++){const r=await fetch(u,{headers:H});if(r.status===200)return bin?Buffer.from(await r.arrayBuffer()):r.text();await sleep(3000*(k+1));}return null;}
for(const a of process.argv.slice(2)){const [n,id]=a.split(':');
 const h=await get('https://poly.pizza/m/'+id);if(!h){console.log(n,id,'FAIL page');continue;}
 const m=h.match(/"ResourceID":"([^"]*)","PublicID":"[^"]*"/);const lic=h.match(/"Licence":"([^"]*)"/)[1];const cr=h.match(/"Creator":\{"Username":"([^"]*)"/)[1];
 const title=(h.match(/"Title":"([^"]*)"/)||[])[1];
 const dir=SRC+'pp_'+n;fs.mkdirSync(dir,{recursive:true});
 const b=await get('https://static.poly.pizza/'+m[1]+'.glb',true);if(!b){console.log(n,id,'FAIL glb');continue;}
 fs.writeFileSync(dir+'/'+n+'.glb',b);
 const line=[n,id,cr,lic,title,b.length,'https://poly.pizza/m/'+id,new Date().toISOString().slice(0,10)].join(' | ');
 console.log(line);fs.appendFileSync(SRC+'fetch_log.txt',line+'\n');await sleep(1500);}

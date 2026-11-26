// usage: node fetch.mjs name:PublicID ... -> downloads to assets-src/pp_<name>/<name>.glb
import fs from 'node:fs';
import {SRC} from './paths.mjs';
const H={'User-Agent':'Mozilla/5.0'};
for(const a of process.argv.slice(2)){const [n,id]=a.split(':');
 const h=await (await fetch('https://poly.pizza/m/'+id,{headers:H})).text();
 const m=h.match(/"ResourceID":"([^"]*)","PublicID":"[^"]*"/);const lic=h.match(/"Licence":"([^"]*)"/)[1];const cr=h.match(/"Creator":\{"Username":"([^"]*)"/)[1];
 const dir=SRC+'pp_'+n;fs.mkdirSync(dir,{recursive:true});
 const b=Buffer.from(await (await fetch('https://static.poly.pizza/'+m[1]+'.glb')).arrayBuffer());fs.writeFileSync(dir+'/'+n+'.glb',b);
 console.log(n,id,cr,lic,b.length);}

import {load,PUB}from './kb.mjs';import sharp from 'sharp';
const file=process.argv[2];const d=await load(file);const root=d.getRoot();
const tex=root.listTextures()[0];const {data,info}=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});
const hex=(r,g,b)=>'#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
for(const n of root.listNodes()){const m=n.getMesh();if(!m)continue;const cnt={};
 for(const p of m.listPrimitives()){const uv=p.getAttribute('TEXCOORD_0');if(!uv)continue;const e=[0,0];
  for(let i=0;i<uv.getCount();i++){uv.getElement(i,e);const x=Math.min(info.width-1,Math.max(0,Math.floor(e[0]*info.width))),y=Math.min(info.height-1,Math.max(0,Math.floor(e[1]*info.height)));const o=(y*info.width+x)*3;const c=hex(data[o],data[o+1],data[o+2]);cnt[c]=(cnt[c]||0)+1;}}
 const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([c,k])=>c+'x'+k).join(' ');console.log(n.getName().padEnd(26),top);}
console.log('texture',info.width,info.height);

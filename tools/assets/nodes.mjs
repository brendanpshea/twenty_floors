// usage: node nodes.mjs file.glb -> lists nodes (mesh nodes marked), materials and clips; helper for writing build-models/variants entries
import {load} from './kb.mjs';
const d=await load(process.argv[2]);const r=d.getRoot();
console.log('nodes:',r.listNodes().map(n=>n.getName()+(n.getMesh()?'*':'')).join(' '));
console.log('materials:',r.listMaterials().map(m=>m.getName()).join(' '));
console.log('clips:',r.listAnimations().map(a=>a.getName()).join(' '));

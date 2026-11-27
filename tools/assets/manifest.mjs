import fs from 'node:fs';
import {TOOLS,MANIFEST,MODELS} from './paths.mjs';
const meta=JSON.parse(fs.readFileSync(TOOLS+'meta.json','utf8'));
const WOLF='wolf_smooth';
const rot=JSON.parse(fs.readFileSync(TOOLS+'rot.json','utf8'));
const keys={hero_knight:'hero_knight',hero_barbarian:'hero_barbarian',hero_rogue:'hero_rogue',hero_mage:'hero_mage',
 skeleton:'skeleton_minion',skeleton_warrior:'skeleton_warrior',skeleton_mage:'skeleton_mage',skeleton_rogue:'skeleton_rogue',skeleton_minion:'skeleton_minion',
 zombie:'zombie_smooth',ghoul:'ghoul_smooth',shadow:'ghost',goblin_minion:'goblin_minion',goblin_warrior:'goblin_warrior',goblin_boss:'goblin_boss',
 wolf:WOLF,giant_rat:'rat',giant_spider:'spider',bugbear_warrior:'bugbear',ogre:'ogre_smooth'};
for(const n of ['frog','slime','snake','mushnub','blob','crab','bat','mushking','imp','bluedemon','birb','hywirl','dino','yeti','cat','bull','witch','dragon','dragonevo'])keys[n]=n;
import {variants} from './variants.mjs';
for(const v of variants)if(!Object.values(keys).includes(v.name))keys[v.name]=v.name;
const models={};
for(const [k,f] of Object.entries(keys)){const m=meta[f];if(!m||!fs.existsSync(MODELS+f+'.glb'))continue;   // base-only files (assets-src/base) are not shipped
 models[k]={url:`assets/models/${f}.glb`,scale:m.scale,...(rot[f]?{rotationY:rot[f]}:{}),animations:m.anim};}
fs.writeFileSync(MANIFEST,JSON.stringify({models},null,2)+'\n');
console.log(Object.keys(models).length,'keys');

// Loads several floors of the real game and screenshots (zoomed on) each wanted monster id once.
// usage: PORT=5192 node gamesweep.mjs outDir "depth:seed,depth:seed,..." id1,id2,...   (id = substring of monster id)
import puppeteer from 'puppeteer-core';import fs from 'node:fs';
const [outDir,runs,wanted]=process.argv.slice(2);fs.mkdirSync(outDir,{recursive:true});
const want=new Set(wanted.split(','));const got=new Set();
const b=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1366,768']});
for(const r of runs.split(',')){const [d,s]=r.split(':');
 const p=await b.newPage();await p.setViewport({width:1366,height:768});p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto(`http://localhost:${process.env.PORT||5186}/?depth=${d}&seed=${s}&reveal=1`);await new Promise(r=>setTimeout(r,9000));
 const ids=await p.evaluate(()=>[...new Set(window.__tf.game.session.state.monsters.map(m=>m.def.id))]);console.log(r,ids.join(' '));
 for(const id of ids){if(!want.has(id)||got.has(id))continue;
  await p.evaluate(f=>{const s=window.__tf.game.session.state;const m=s.monsters.find(m=>m.def.id===f);window.__tf.renderer.focusCamera(m.creature.pos,{instant:true});},id);
  await p.mouse.move(683,384);for(let i=0;i<4;i++){await p.mouse.wheel({deltaY:-120});await new Promise(r=>setTimeout(r,60));}
  await new Promise(r=>setTimeout(r,2500));await p.screenshot({path:`${outDir}/${id}.png`});got.add(id);console.log('shot',id);
  for(let i=0;i<4;i++){await p.mouse.wheel({deltaY:120});await new Promise(r=>setTimeout(r,60));}}
 await p.close();}
await b.close();console.log('missing',[...want].filter(x=>!got.has(x)).join(','));

// Real-game screenshots. Needs `npx vite --port 5186` running in the repo root.
// usage: node gameshot.mjs <out.png> "<query>" [monsterId-substring-to-focus] [zoomJS]
import puppeteer from 'puppeteer-core';
const [out,query,focus,js]=process.argv.slice(2);
const b=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1366,768']});
const p=await b.newPage();await p.setViewport({width:1366,height:768});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:'+(process.env.PORT||5186)+'/?'+query);
await new Promise(r=>setTimeout(r,9000));
const info=await p.evaluate(()=>{const g=window.__tf.game;const s=g.session?.state||g.state;return {keys:Object.keys(g),sk:s?Object.keys(s):null};});
console.log(JSON.stringify(info));
if(focus){const r=await p.evaluate((f)=>{const s=window.__tf.game.session.state;const ms=s.monsters.filter(m=>m.def.id.includes(f));
  if(!ms.length)return 'none';const m=ms[0];window.__tf.renderer.focusCamera(m.creature.pos,{instant:true});return {n:ms.length,ids:ms.map(x=>x.def.id),pos:m.creature.pos};},focus);console.log(JSON.stringify(r));await new Promise(r=>setTimeout(r,2500));}
if(js){console.log(JSON.stringify(await p.evaluate(js)));await new Promise(r=>setTimeout(r,2000));}
if(process.env.WHEEL){await p.mouse.move(683,384);for(let i=0;i<+process.env.WHEEL;i++){await p.mouse.wheel({deltaY:-120});await new Promise(r=>setTimeout(r,60));}await new Promise(r=>setTimeout(r,2500));}
await p.screenshot({path:out});await b.close();

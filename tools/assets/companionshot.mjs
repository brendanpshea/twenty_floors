// Spawns visual-only copies of the given model keys next to the hero in the real game and screenshots them.
// usage: PORT=5192 node companionshot.mjs out.png key:scale,key:scale,...   e.g. companion_sphinx:0.9,companion_pseudodragon:0.8,companion_blinkdog:1
import puppeteer from 'puppeteer-core';
const [out,list]=process.argv.slice(2);
const b=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1366,768']});
const p=await b.newPage();await p.setViewport({width:1366,height:768});p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto(`http://localhost:${process.env.PORT||5186}/?depth=4&seed=2&reveal=1`);await new Promise(r=>setTimeout(r,9000));
const r=await p.evaluate((list)=>{const t=window.__tf,s=t.game.session.state;const pp=s.player.creature?.pos||s.player.pos||s.pc?.pos;
 const items=list.split(',');let i=0;for(const it of items){const [k,sc]=it.split(':');i++;
  try{t.renderer.spawnEntity('vis_'+k,{model:k,scale:+sc},{x:pp.x+i,y:pp.y},{faction:'player',size:'medium'});}catch(e){return 'ERR '+e.message;}}
 t.renderer.focusCamera({x:pp.x+2,y:pp.y},{instant:true});return JSON.stringify(pp);},list);
console.log(r);
await p.mouse.move(683,384);for(let i=0;i<4;i++){await p.mouse.wheel({deltaY:-120});await new Promise(r=>setTimeout(r,60));}
await new Promise(r=>setTimeout(r,3000));await p.screenshot({path:out});await b.close();

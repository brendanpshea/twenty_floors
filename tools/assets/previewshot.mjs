// Screenshot of the renderer preview (spawns each theme's monsters). Needs `npx vite --port 5192`.
// usage: PORT=5192 node previewshot.mjs out.png "gen=1&theme=sewers&depth=4" [waitMs]
import puppeteer from 'puppeteer-core';
const [out,query,wait=12000]=process.argv.slice(2);
const b=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1366,768']});
const p=await b.newPage();await p.setViewport({width:1366,height:768});
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{const t=m.text();if(/model|fail|warn/i.test(t))console.log(t.slice(0,200));});
await p.goto('http://localhost:'+(process.env.PORT||5186)+'/dev/render-preview.html?'+query);
await new Promise(r=>setTimeout(r,+wait));
await p.screenshot({path:out});await b.close();

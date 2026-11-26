import puppeteer from 'puppeteer-core';
const [out,query,w=1600,h=500]=process.argv.slice(2);
const b=await puppeteer.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage();await p.setViewport({width:+w,height:+h});
p.on('console',m=>{const t=m.text();if(!/GPU stall/.test(t))console.log(t)});p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:8123/viewer/'+(process.env.PAGE||'index.html')+'?'+query);
await p.waitForFunction(()=>document.title==='done',{timeout:90000});
await p.screenshot({path:out});await b.close();

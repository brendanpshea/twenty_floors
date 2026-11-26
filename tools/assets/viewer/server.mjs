import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {ROOT} from '../paths.mjs';const R=ROOT;const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.glb':'model/gltf-binary'};
http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=u.startsWith('/three/')?R+'node_modules/three/'+u.slice(7):u.startsWith('/src/')?R+'assets-src'+u.slice(4):u.startsWith('/viewer/')?R+'tools/assets'+u:R+'public'+u;
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end();}s.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);}).listen(8123);

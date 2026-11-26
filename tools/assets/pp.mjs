// usage: node pp.mjs term1 term2 ...  -> lists poly.pizza models (metadata only)
const H={'User-Agent':'Mozilla/5.0'};
const seen=new Set();
for(const term of process.argv.slice(2)){
  const html=await (await fetch('https://poly.pizza/search/'+encodeURIComponent(term),{headers:H})).text();
  const ids=[...new Set([...html.matchAll(/href="\/m\/([A-Za-z0-9_-]+)"/g)].map(m=>m[1]))];
  for(const id of ids){ if(seen.has(id))continue; seen.add(id);
    const h=await (await fetch('https://poly.pizza/m/'+id,{headers:H})).text();
    const t=h.match(/"Title":"([^"]*)".*?"ResourceID":"([^"]*)","PublicID":"([^"]*)".*?"Tris":(\d+).*?"Creator":\{"Username":"([^"]*)".*?"Licence":"([^"]*)","Animated":(\w+)/s);
    if(t) console.log([term,t[1],t[5],t[6],'anim='+t[7],'tris='+t[4],t[3],t[2]].join(' | '));
  }
}

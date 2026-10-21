/* Офлайн-кэш: при наличии сети берём свежие файлы, без сети — из кэша. */
const V='vr-lesson-v14';
const FILES=['./','index.html','teacher.html','css/style.css','js/data.js','js/questions.js','js/errors.js','js/schema.js','js/flags.js','js/store.js','js/engine.js','js/rooms.js','js/rooms2.js','js/app.js','help.html','help-teacher.html','css/help.css','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET'||new URL(r.url).origin!==location.origin||new URL(r.url).pathname.indexOf('/api/')>=0)return;
  e.respondWith((async()=>{
    const c=await caches.open(V);
    try{
      const res=await Promise.race([fetch(r),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),4000))]);
      if(res&&res.ok)c.put(r,res.clone());
      return res;
    }catch(err){
      return (await c.match(r,{ignoreSearch:true}))||(r.mode==='navigate'?await c.match('index.html'):null)||Response.error();
    }
  })());
});

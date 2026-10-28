/* Офлайн-кэш по версии V. Файл есть в кэше этой версии — отдаём сразу (страницы и справка открываются без ожидания сети);
   нет — берём из сети и кладём в кэш. Любая правка сайта поднимает V: браузер ставит новый sw.js, он заново скачивает все FILES
   (в обход HTTP-кэша) и со следующего открытия страницы отдаёт новую версию целиком — старый и новый файлы не смешиваются. */
const V='vr-lesson-v92';
const FILES=['./','index.html','teacher.html','css/style.css','js/data.js','js/questions.js','js/errors.js','js/roomspec.js','js/schema.js','js/flags.js','js/store.js','js/assets.js','js/engine.js','js/controllers.js','js/learn.js','js/rooms.js','js/rooms2.js','js/chem.js','js/chemtree.js','js/builder.js','js/regions.js','js/admin.js','admin.html','js/inf.js','js/chess.js','js/play.js','js/einstein.js','js/netproto.js','js/net.js','js/netplay.js','js/netsafe.js','js/netlead.js','js/games.js','js/einroom.js','js/arena.js','js/custom.js','js/app.js','assets/models/tree.glb','assets/models/house.glb','assets/models/rocket.glb','assets/models/atom.glb','assets/models/book.glb','assets/models/flask.glb','assets/sounds/bell.wav','assets/sounds/click.wav','assets/sounds/wind.wav','assets/sounds/water.wav','assets/sounds/birds.wav','help.html','help-teacher.html','help-rooms.html','css/help.css','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET'||new URL(r.url).origin!==location.origin||new URL(r.url).pathname.indexOf('/api/')>=0)return;
  e.respondWith((async()=>{
    const c=await caches.open(V);
    const hit=await c.match(r,{ignoreSearch:true});
    if(hit)return hit;
    try{
      const res=await Promise.race([fetch(r),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))]);
      if(res&&res.ok)c.put(r,res.clone());
      return res;
    }catch(err){
      return (r.mode==='navigate'?await c.match('index.html'):null)||Response.error();
    }
  })());
});

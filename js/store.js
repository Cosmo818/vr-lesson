/* store.js — ученики, результаты, открытия, тесты учителя, настройки.
   Данные лежат в localStorage этого браузера и (если указан сервер) синхронизируются с сервером на Raspberry Pi.
   Слияние: ученики, тесты и настройки — побеждает более свежая правка (updated); результаты и открытия — объединение;
   удалённые записи помнятся в deleted, чтобы не вернулись с другого устройства. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const KEY='vrlesson.v1',SKEY='vrlesson.server';
const SUBJ=['math','phys','chem','space','bio','soc','logic','hist','gen'];
const blank=()=>({v:2,classes:[],students:[],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{minutes:8,resetAt:0,updated:0}});
let db=null;
const now=()=>Date.now();
const clampGrade=g=>{g=parseInt(g,10);return g>=1&&g<=11?g:5;};
const uid=()=>now().toString(36)+Math.random().toString(36).slice(2,8);

function norm(x){
  const b=blank();
  if(!x||typeof x!=='object')return b;
  const o={v:2};
  o.students=Array.isArray(x.students)?x.students.filter(s=>s&&s.id&&s.name).map(s=>({id:String(s.id),name:String(s.name).slice(0,40),grade:clampGrade(s.grade),classId:s.classId||null,pinHash:s.pinHash||null,created:s.created||0,updated:s.updated||s.created||0})):[];
  o.classes=Array.isArray(x.classes)?x.classes.filter(c=>c&&c.id).map(c=>({id:String(c.id),grade:clampGrade(c.grade),letter:String(c.letter||'').slice(0,4),created:c.created||0,updated:c.updated||0})):[];
  o.results=Array.isArray(x.results)?x.results.filter(r=>r&&r.id&&r.sid&&r.subj):[];
  o.disc=x.disc&&typeof x.disc==='object'?x.disc:{};
  o.feedback=Array.isArray(x.feedback)?x.feedback.filter(f=>f&&f.id&&(f.text||f.kind)):[];
  o.tests=Array.isArray(x.tests)?x.tests.filter(t=>t&&t.id&&Array.isArray(t.qs)):[];
  o.deleted=x.deleted&&typeof x.deleted==='object'?x.deleted:{};
  o.settings=Object.assign(b.settings,x.settings||{});
  return o;
}
function merge(A,B){
  A=norm(A);B=norm(B);
  const del=Object.assign({},A.deleted);for(const k in B.deleted)del[k]=Math.max(del[k]||0,B.deleted[k]);
  const settings=(B.settings.updated||0)>(A.settings.updated||0)?B.settings:A.settings;
  const reset=settings.resetAt||0;
  const lww=(a,b)=>{const m=new Map();for(const x of a.concat(b)){if(del[x.id])continue;const o=m.get(x.id);if(!o||(x.updated||0)>(o.updated||0))m.set(x.id,x);}return[...m.values()];};
  const students=lww(A.students,B.students),tests=lww(A.tests,B.tests),classes=lww(A.classes,B.classes);
  const rm=new Map();for(const r of A.results.concat(B.results))if(!rm.has(r.id)&&!del[r.sid]&&!del[r.id]&&(r.ts||0)>=reset)rm.set(r.id,r);
  const disc={};
  for(const src of[A.disc,B.disc])for(const sid in src){if(del[sid])continue;const m=disc[sid]=disc[sid]||{};for(const k in src[sid]){const t=src[sid][k];if(t>=reset&&(!m[k]||t<m[k]))m[k]=t;}}
  const fm=new Map();for(const f of A.feedback.concat(B.feedback))if(!fm.has(f.id)&&!del[f.id])fm.set(f.id,f);
  return{v:2,classes,students,results:[...rm.values()],disc,tests,feedback:[...fm.values()],deleted:del,settings};
}
function load(){
  if(db)return db;
  let x=null;try{const s=localStorage.getItem(KEY);x=s?JSON.parse(s):null;}catch(e){x=null;}
  db=norm(x);return db;
}
const listeners=[];
function save(){try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){return false;}for(const f of listeners)try{f();}catch(e){}return true;}

const Store=VR.Store={
  SUBJ,merge,norm,
  band:g=>{g=clampGrade(g);return g<=4?'a':g<=6?'b':g<=8?'c':'d';},
  reload(){db=null;return load();},
  onChange(f){listeners.push(f);},
  canSave(){try{localStorage.setItem(KEY+'.t','1');localStorage.removeItem(KEY+'.t');return true;}catch(e){return false;}},

  /* ученики */
  students(){return load().students.slice().sort((a,b)=>a.grade-b.grade||a.name.localeCompare(b.name,'ru'));},
  student(id){return load().students.find(s=>s.id===id)||null;},
  addStudent(name,grade,classId){
    name=String(name||'').trim().slice(0,40);if(!name)return null;
    const k=classId?Store.klass(classId):null;
    const t=now(),s={id:uid(),name,grade:k?k.grade:clampGrade(grade),classId:k?k.id:null,pinHash:null,created:t,updated:t};
    load().students.push(s);save();Store.syncSoon();return s;
  },
  updateStudent(id,patch){
    const s=Store.student(id);if(!s)return null;
    if(patch.name!=null){const n=String(patch.name).trim().slice(0,40);if(n)s.name=n;}
    if(patch.grade!=null)s.grade=clampGrade(patch.grade);
    if(patch.classId!==undefined){const k=patch.classId?Store.klass(patch.classId):null;s.classId=k?k.id:null;if(k)s.grade=k.grade;}
    if(patch.pinHash!==undefined)s.pinHash=patch.pinHash;
    s.updated=now();save();Store.syncSoon();return s;
  },
  removeStudent(id){
    const d=load();d.deleted[id]=now();
    d.students=d.students.filter(s=>s.id!==id);d.results=d.results.filter(r=>r.sid!==id);delete d.disc[id];
    save();Store.syncSoon();
  },

  /* классы: {id, grade 1–11, letter «А»} */
  classes(){return load().classes.slice().sort((a,b)=>a.grade-b.grade||a.letter.localeCompare(b.letter,'ru'));},
  klass(id){return load().classes.find(c=>c.id===id)||null;},
  className(c){return c?c.grade+(c.letter||''):'';},
  addClass(grade,letter){
    letter=String(letter||'').trim().toUpperCase().slice(0,4);grade=clampGrade(grade);
    if(load().classes.some(c=>c.grade===grade&&c.letter===letter))return null;
    const t=now(),c={id:uid(),grade,letter,created:t,updated:t};load().classes.push(c);save();Store.syncSoon();return c;
  },
  removeClass(id){
    const d=load();d.deleted[id]=now();d.classes=d.classes.filter(c=>c.id!==id);
    for(const s of d.students)if(s.classId===id){s.classId=null;s.updated=now();}
    save();Store.syncSoon();
  },
  studentsOf(classId){return Store.students().filter(s=>(s.classId||null)===(classId||null));},

  /* коды входа учеников: 4 цифры, хранится только хэш */
  genPin(){const a=new Uint32Array(1);(globalThis.crypto||window.crypto).getRandomValues(a);return String(1000+a[0]%9000);},
  async pinHash(id,pin){
    const enc=new TextEncoder(),c=(globalThis.crypto||window.crypto).subtle;
    const k=await c.importKey('raw',enc.encode(String(pin)),'PBKDF2',false,['deriveBits']);
    const b=await c.deriveBits({name:'PBKDF2',salt:enc.encode('st:'+id),iterations:20000,hash:'SHA-256'},k,256);
    return btoa(String.fromCharCode(...new Uint8Array(b)));
  },
  async setStudentPin(id,pin){pin=pin||Store.genPin();Store.updateStudent(id,{pinHash:await Store.pinHash(id,pin)});return pin;},
  async checkStudentPin(s,pin){if(!s.pinHash)return true;return(await Store.pinHash(s.id,String(pin||'').trim()))===s.pinHash;},

  /* рейтинг классов. Балл ученика — его баллы (тесты + открытия).
     Средний балл класса считается только по активным ученикам и «подтягивается» к общему среднему
     с весом K учеников (байесовское среднее): маленький класс не обгонит всех за счёт 1–2 сильных учеников,
     а большой класс не проигрывает из-за размера. Отдельно — доля активных и точность ответов. */
  classStats(K){
    K=K||5;const cls=Store.classes(),all=[],rows=[];
    for(const c of cls.concat([{id:null,grade:0,letter:''}])){
      const st=Store.studentsOf(c.id);if(!c.id&&!st.length)continue;
      let act=[],ok=0,tot=0;
      for(const s of st){const p=Store.points(s.id);const rs=Store.results(s.id);if(p.total>0||rs.length){act.push(p.total);all.push(p.total);}for(const r of rs){ok+=r.score;tot+=r.total;}}
      rows.push({c,n:st.length,active:act.length,mean:act.length?act.reduce((a,b)=>a+b,0)/act.length:0,acc:tot?ok/tot:null,_sum:act.reduce((a,b)=>a+b,0)});
    }
    const g=all.length?all.reduce((a,b)=>a+b,0)/all.length:0;
    for(const r of rows)r.rating=r.active?(r._sum+K*g)/(r.active+K):null;
    return{rows:rows.sort((a,b)=>(b.rating??-1)-(a.rating??-1)),globalMean:g,K};
  },

  /* результаты и открытия */
  addResult(r){const x=Object.assign({id:uid(),ts:now()},r);load().results.push(x);save();Store.syncSoon();return x;},
  results(sid){const r=load().results;return sid?r.filter(x=>x.sid===sid):r.slice();},
  addDiscovery(sid,subj,key){
    if(!sid)return false;
    const d=load(),m=d.disc[sid]=d.disc[sid]||{},k=subj+':'+key;
    if(m[k])return false;m[k]=now();save();Store.syncSoon();return true;
  },
  discoveries(sid){return Object.keys(load().disc[sid]||{});},
  best(sid){
    const o={};for(const s of SUBJ)o[s]={best:null,total:5,ratio:null,attempts:0,last:null};
    for(const r of Store.results(sid)){
      const b=o[r.subj];if(!b||!r.total)continue;
      b.attempts++;const q=r.score/r.total;
      if(b.ratio===null||q>b.ratio){b.ratio=q;b.best=r.score;b.total=r.total;}
      if(!b.last||r.ts>b.last.ts)b.last=r;
    }
    return o;
  },
  /* баллы: лучший результат каждого предмета в долях × 50 (5 из 5 = 50) + 2 за открытие */
  points(sid){
    const b=Store.best(sid);let t=0,passed=0;
    for(const s of SUBJ)if(b[s].ratio!==null){t+=Math.round(b[s].ratio*50);if(b[s].ratio>=.6)passed++;}
    const d=Store.discoveries(sid).length;
    return{tests:t,disc:d*2,discCount:d,passed,total:t+d*2};
  },
  lastActive(sid){
    let t=0;for(const r of Store.results(sid))t=Math.max(t,r.ts);
    const m=load().disc[sid]||{};for(const k in m)t=Math.max(t,m[k]);
    return t||null;
  },

  /* тесты учителя: {id,title,subj,gmin,gmax,active,qs:[{id,q,a:[верный,...],e}],created,updated} */
  tests(){return load().tests.slice().sort((a,b)=>(a.title||'').localeCompare(b.title||'','ru'));},
  test(id){return load().tests.find(t=>t.id===id)||null;},
  testsFor(subj,grade){grade=clampGrade(grade);return Store.tests().filter(t=>t.active!==false&&t.subj===subj&&grade>=(t.gmin||1)&&grade<=(t.gmax||11)&&t.qs.length);},
  saveTest(t){
    const d=load(),x=Object.assign({},t);
    x.id=x.id||uid();x.updated=now();x.created=x.created||x.updated;
    x.gmin=clampGrade(x.gmin||1);x.gmax=Math.max(x.gmin,clampGrade(x.gmax||11));
    x.qs=(x.qs||[]).map(q=>({id:q.id||uid(),q:String(q.q||'').trim(),a:(q.a||[]).map(s=>String(s).trim()).filter(Boolean),e:String(q.e||'').trim()})).filter(q=>q.q&&q.a.length>=2);
    d.tests=d.tests.filter(o=>o.id!==x.id);d.tests.push(x);save();Store.syncSoon();return x;
  },
  removeTest(id){const d=load();d.deleted[id]=now();d.tests=d.tests.filter(t=>t.id!==id);save();Store.syncSoon();},
  question(id){
    if(VR.DATA&&VR.DATA.qById&&VR.DATA.qById[id])return VR.DATA.qById[id];
    const m=/^t:([^:]+):(.+)$/.exec(id||'');if(!m)return null;
    const t=Store.test(m[1]);if(!t)return null;const q=t.qs.find(x=>x.id===m[2]);
    return q?{id,subj:t.subj,band:null,test:t.title,q:q.q,a:q.a,e:q.e}:null;
  },

  /* предложения и отзывы: {id,ts,kind:'idea'|'bug'|'like'|'dislike',room,text,rating,grade,sid(если не анонимно)} */
  addFeedback(f){
    const x={id:uid(),ts:now(),kind:f.kind||'idea',room:f.room||null,text:String(f.text||'').trim().slice(0,1000),rating:f.rating?Math.max(1,Math.min(5,f.rating|0)):null,grade:f.grade||null,sid:f.sid||null};
    load().feedback.push(x);save();Store.syncSoon();return x;
  },
  feedback(){return load().feedback.slice().sort((a,b)=>b.ts-a.ts);},
  removeFeedback(id){const d=load();d.deleted[id]=now();d.feedback=d.feedback.filter(f=>f.id!==id);save();Store.syncSoon();},

  /* настройки */
  settings(){return Object.assign({},load().settings);},
  setSettings(p){Object.assign(load().settings,p,{updated:now()});save();Store.syncSoon();},
  clearResults(){const d=load();d.settings.resetAt=now();d.settings.updated=now();d.results=[];d.disc={};save();Store.syncSoon();},

  exportJSON(){return JSON.stringify(load());},
  importJSON(text){
    let x;try{x=JSON.parse(text);}catch(e){throw new Error('Это не файл данных VR-урока (ошибка JSON).');}
    if(!x||!Array.isArray(x.students)||!Array.isArray(x.results))throw new Error('В файле нет списка учеников и результатов.');
    const before=load(),ns=before.students.length,nr=before.results.length;
    db=merge(before,x);save();Store.syncSoon();
    return{students:db.students.length-ns,results:db.results.length-nr};
  },

  /* ---------- сервер ---------- */
  server(){try{const s=JSON.parse(localStorage.getItem(SKEY)||'null');return s&&s.url?s:null;}catch(e){return null;}},
  setServer(url,key){
    try{if(!url){localStorage.removeItem(SKEY);return;}
      url=String(url).trim().replace(/\/+$/,'');if(!/^https?:\/\//.test(url))url='https://'+url;
      key=String(key||'').replace(/[\u200B-\u200D\uFEFF\u00A0]/g,'').trim();
      const m=/"(?:teacher|device)"\s*:\s*"([^"]+)"/.exec(key);if(m)key=m[1];
      key=key.replace(/^[\s"'`,{}:]+|[\s"'`,{}]+$/g,'');
      localStorage.setItem(SKEY,JSON.stringify({url,key}));}catch(e){}
  },
  status:{state:'off',at:0,role:null,msg:''},
  async sync(){
    const sv=Store.server();
    if(!sv){Store.status={state:'off',at:0,role:null,msg:''};return Store.status;}
    if(Store._busy)return Store._busy;
    const run=(async()=>{
      try{
        const ctl=typeof AbortController!=='undefined'?new AbortController():null;
        const tm=setTimeout(()=>ctl&&ctl.abort(),12000);
        const res=await fetch(sv.url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':sv.key},body:JSON.stringify(load()),signal:ctl?ctl.signal:undefined});
        clearTimeout(tm);
        if(res.status===401||res.status===403)throw new Error('Сервер не принял ключ. Скопируй только символы между кавычками, без самих кавычек');
        if(!res.ok)throw new Error('Сервер ответил '+res.status);
        const data=await res.json();
        db=merge(load(),data.state);save();
        Store.status={state:'ok',at:now(),role:data.role,msg:''};
      }catch(e){
        Store.status={state:'err',at:now(),role:null,msg:e&&e.name==='AbortError'?'сервер не ответил за 12 секунд':(e instanceof TypeError||/fetch/i.test(e&&e.message||''))?'нет связи с сервером: сеть, VPN или сервер выключен':(e&&e.message)||'нет связи'};
      }
      for(const f of Store._statusL)try{f(Store.status);}catch(e){}
      return Store.status;
    })();
    Store._busy=run;try{return await run;}finally{Store._busy=null;}
  },
  _statusL:[],onStatus(f){Store._statusL.push(f);},
  syncSoon(){if(!Store.server())return;clearTimeout(Store._t);Store._t=setTimeout(()=>Store.sync(),1500);}
};
})();

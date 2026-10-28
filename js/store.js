/* store.js — ученики, результаты, открытия, тесты учителя, настройки.
   Данные лежат в localStorage этого браузера и (если указан сервер) синхронизируются с сервером на Raspberry Pi.
   Слияние: ученики, тесты и настройки — побеждает более свежая правка (updated); результаты и открытия — объединение;
   удалённые записи помнятся в deleted, чтобы не вернулись с другого устройства.
   Ученик и класс не удаляются, а уходят в архив (старое надгробие от старого клиента тоже превращается в архив); окончательно стёртое — в purged (приходит только с сервера, обратно не уходит). */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const KEY='vrlesson.v1',SKEY='vrlesson.server';
const SUBJ=['math','phys','chem','space','bio','soc','logic','hist','inf','gen'];
const blank=()=>VR.schema.blank();
let db=null;
const now=()=>Date.now();
const clampGrade=g=>VR.schema.clampGrade(g);
const uid=()=>now().toString(36)+Math.random().toString(36).slice(2,8);

function norm(x){return VR.schema.db(x);}
/* классы, где учитель — предметник (Б41): только просмотр и уроки; список приходит с сервера при каждой синхронизации */
let SUB=null;
function setSub(a){SUB=new Set(Array.isArray(a)?a.filter(x=>typeof x==='string').slice(0,500):[]);try{localStorage.setItem('vrl.sub',JSON.stringify([...SUB]));}catch(e){}}
function subSet(){if(!SUB){let a=[];try{a=JSON.parse(localStorage.getItem('vrl.sub')||'[]');}catch(e){}SUB=new Set(Array.isArray(a)?a:[]);}return SUB;}
function adoptServerTeachers(d,st){VR.schema.adoptTeacher(d.classes,st&&st.classes);}
function merge(A,B){
  const SC=VR.schema;A=SC.db(A,{fill:false});B=SC.db(B,{fill:false});
  const del=Object.assign({},A.deleted);for(const k in B.deleted)del[k]=Math.max(del[k]||0,B.deleted[k]);
  const hard=Object.assign({},A.purged);for(const k in B.purged)hard[k]=Math.max(hard[k]||0,B.purged[k]); // жёсткие надгробия: запись стёрта окончательно
  const settings=(B.settings.updated||0)>(A.settings.updated||0)?B.settings:A.settings;
  const reset=settings.resetAt||0;
  /* kind: поля школа/год/статус (у классов ещё teacherId), которых нет у победителя (старый клиент их не знает), берутся у проигравшей версии; то же правило в server/app.py (fill_v3, fill_v4).
     Ученики и классы (kind): сначала lww, потом мягкое надгробие новее победителя превращает запись в архив (updated = время надгробия); у остальных видов надгробие скрывает запись. Правило то же в merge_in (А11) */
  const lww=(a,b,kind)=>{const m=new Map();for(const x of a.concat(b)){if(hard[x.id]||(!kind&&del[x.id]))continue;const o=m.get(x.id);if(!o)m.set(x.id,x);else if((x.updated||0)>(o.updated||0))m.set(x.id,kind?SC.carry(x,o,kind):x);else if(kind)m.set(o.id,SC.carry(o,x,kind));}
    return[...m.values()].map(x=>kind&&del[x.id]>(x.updated||0)&&x.status!=='archived'?Object.assign({},x,{status:'archived',updated:del[x.id]}):x);};
  /* автор теста (Б74.8): правда на сервере; берём author из записи стороны B (пришла с сервера), иначе из A (как fill_test в server/app.py, А11) */
  const carryAuthor=(win,a,b)=>{const au=new Map();for(const x of b.concat(a))if(typeof x.author==='string'&&x.author&&!au.has(x.id))au.set(x.id,x.author);return win.map(x=>au.has(x.id)&&x.author!==au.get(x.id)?Object.assign({},x,{author:au.get(x.id)}):x);};
  const students=lww(A.students,B.students,'students').map(i=>SC.fill('students',i)),tests=carryAuthor(lww(A.tests,B.tests),A.tests,B.tests),classes=lww(A.classes,B.classes,'classes').map(i=>SC.fill('classes',i));
  const rm=new Map();for(const r of A.results.concat(B.results))if(!rm.has(r.id)&&!hard[r.sid]&&!del[r.id]&&!hard[r.id]&&(r.ts||0)>=reset)rm.set(r.id,r);
  const disc={};
  for(const src of[A.disc,B.disc])for(const sid in src){if(hard[sid])continue;const m=disc[sid]=disc[sid]||{};for(const k in src[sid]){const t=src[sid][k];if(t>=reset&&(!m[k]||t<m[k]))m[k]=t;}}
  const fm=new Map();for(const f of A.feedback.concat(B.feedback))if(!fm.has(f.id)&&!del[f.id]&&!hard[f.id])fm.set(f.id,f);
  return{v:SC.VERSION,classes,students,results:[...rm.values()],disc,tests,feedback:[...fm.values()],deleted:del,purged:hard,settings};
}
function load(){
  if(db)return db;
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist();}catch(e){} // просим браузер не очищать данные сайта сам
  let x=null;try{const s=localStorage.getItem(KEY);x=s?JSON.parse(s):null;}catch(e){x=null;}
  db=norm(x);return db;
}
const listeners=[];
/* индекс результатов по ученику: кабинет учителя считал results(sid) перебором всех результатов для каждого ученика по нескольку раз (сек. на сотне учеников в шлеме). Сбрасывается при каждом save() и при замене db/массива. */
let saveSeq=0,rc=null;
function resIndex(){const d=load();if(rc&&rc.d===d&&rc.r===d.results&&rc.n===d.results.length&&rc.seq===saveSeq)return rc;const m=new Map(),all=[];for(const x of d.results){if(x.closed)continue;all.push(x);let a=m.get(x.sid);if(!a)m.set(x.sid,a=[]);a.push(x);}rc={d,r:d.results,n:d.results.length,seq:saveSeq,m,all};return rc;}
function save(){saveSeq++;try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){return false;}for(const f of listeners)try{f();}catch(e){}return true;}

const Store=VR.Store={
  SUBJ,merge,norm,
  isSub:cid=>!!cid&&subSet().has(cid), /* класс, где этот учитель — предметник (просмотр и уроки, без правки учёток) */
  band:g=>{g=clampGrade(g);return g<=4?'a':g<=6?'b':g<=8?'c':'d';},
  reload(){db=null;return load();},
  onChange(f){listeners.push(f);},
  canSave(){try{localStorage.setItem(KEY+'.t','1');localStorage.removeItem(KEY+'.t');return true;}catch(e){return false;}},

  /* ученики */
  /* по умолчанию архивные скрыты, как и ученики архивного класса; opt.all — все (история сохраняется) */
  students(opt){
    const all=!!(opt&&opt.all),ar=new Set(all?[]:load().classes.filter(c=>c.status==='archived').map(c=>c.id));
    return load().students.filter(s=>all||(s.status!=='archived'&&!(s.classId&&ar.has(s.classId)))).sort((a,b)=>a.grade-b.grade||a.name.localeCompare(b.name,'ru'));
  },
  student(id){return load().students.find(s=>s.id===id)||null;},
  /* номер ученика в классе = его «логин» при входе. Есть поле num — берём его; у старых записей номер выдаётся по порядку добавления после максимального (одинаково на всех устройствах) */
  numMap(classId){
    const L=load().students.filter(s=>(s.classId||null)===(classId||null)),m={};let mx=0;
    for(const s of L)if(Number.isInteger(s.num)&&s.num>0){m[s.id]=s.num;mx=Math.max(mx,s.num);}
    for(const s of L.filter(s=>!m[s.id]).sort((a,b)=>(a.created||0)-(b.created||0)||String(a.id).localeCompare(String(b.id))))m[s.id]=++mx;
    return m;
  },
  numOf(s){return s?Store.numMap(s.classId)[s.id]||0:0;},
  studentByNum(classId,n){const m=Store.numMap(classId);n=parseInt(n,10);return load().students.find(s=>s.status!=='archived'&&(s.classId||null)===(classId||null)&&m[s.id]===n)||null;},
  /* закрепить номера у тех, у кого их нет (вызывает кабинет учителя) */
  ensureNums(){let ch=false;const cl=new Set(load().students.map(s=>s.classId||null));for(const c of cl){const m=Store.numMap(c);for(const s of load().students)if((s.classId||null)===c&&s.num!==m[s.id]){s.num=m[s.id];s.updated=now();ch=true;}}if(ch){save();Store.syncSoon();}return ch;},
  addStudent(name,grade,classId){
    name=String(name||'').trim().slice(0,40);if(!name)return null;
    let k=classId?Store.klass(classId):null;if(k&&k.status==='archived')k=null; // в архивный класс новых учеников не кладём (то же на сервере для шлема)
    const t=now(),s={id:uid(),name,grade:k?k.grade:clampGrade(grade),classId:k?k.id:null,pinHash:null,created:t,updated:t,school:VR.schema.DEFAULT_SCHOOL,year:VR.schema.acadYear(t),status:'active'};
    if(s.classId){const m=Store.numMap(s.classId);s.num=Math.max(0,...Object.values(m))+1;}
    load().students.push(s);save();Store.syncSoon();return s;
  },
  updateStudent(id,patch){
    const s=Store.student(id);if(!s)return null;
    if(patch.name!=null){const n=String(patch.name).trim().slice(0,40);if(n)s.name=n;}
    if(patch.grade!=null)s.grade=clampGrade(patch.grade);
    if(patch.classId!==undefined&&(patch.classId||null)!==(s.classId||null)){const m=Store.numMap(patch.classId||null);s.num=Math.max(0,...Object.values(m))+1;}
    if(patch.gender!==undefined){if(patch.gender==='m'||patch.gender==='f')s.gender=patch.gender;else delete s.gender;}
    if(patch.classId!==undefined){const k=patch.classId?Store.klass(patch.classId):null;s.classId=k?k.id:null;if(k)s.grade=k.grade;}
    if(patch.pinHash!==undefined)s.pinHash=patch.pinHash;
    if(patch.pinView!==undefined){if(VR.schema.okPin(patch.pinView))s.pinView=patch.pinView;else delete s.pinView;}
    s.updated=now();save();Store.syncSoon();return s;
  },
  removeStudent(id){return Store.archiveStudent(id);}, // удаления нет: ученик уходит в архив, результаты сохраняются (Б74)

  /* классы: {id, grade 1–11, letter «А»} */
  classes(opt){return load().classes.filter(c=>(opt&&opt.all)||c.status!=='archived').sort((a,b)=>a.grade-b.grade||a.letter.localeCompare(b.letter,'ru'));},
  klass(id){return load().classes.find(c=>c.id===id)||null;},
  className(c){return c?c.grade+(c.letter||''):'';},
  addClass(grade,letter){
    letter=String(letter||'').trim().toUpperCase().slice(0,4);grade=clampGrade(grade);
    if(load().classes.some(c=>c.status!=='archived'&&c.grade===grade&&c.letter===letter))return null;
    const t=now(),c={id:uid(),grade,letter,created:t,updated:t,school:VR.schema.DEFAULT_SCHOOL,year:VR.schema.acadYear(t),status:'active'};load().classes.push(c);save();Store.syncSoon();return c;
  },
  removeClass(id){return Store.archiveClass(id);},
  /* мягкое архивирование: запись остаётся, результаты сохраняются; updated всегда растёт, чтобы правка победила при слиянии */
  _setStatus(list,id,status){
    const r=load()[list].find(x=>x.id===id);if(!r)return null;
    r.status=status;r.updated=Math.max(now(),(r.updated||0)+1);save();Store.syncSoon();return r;
  },
  archiveStudent(id){return Store._setStatus('students',id,'archived');},
  restoreStudent(id){return Store._setStatus('students',id,'active');},
  archiveClass(id){return Store._setStatus('classes',id,'archived');},
  /* возврат класса: та же проверка дубля, что в addClass (параллель + буква среди активных); при дубле запись не меняется, результат false */
  restoreClass(id){
    const c=Store.klass(id);if(!c)return null;
    if(c.status!=='archived')return c;
    if(load().classes.some(o=>o.id!==id&&o.status!=='archived'&&o.grade===c.grade&&o.letter===c.letter))return false;
    return Store._setStatus('classes',id,'active');
  },
  studentsOf(classId,opt){return Store.students(opt).filter(s=>(s.classId||null)===(classId||null));},

  /* коды входа учеников: 4 цифры, хранится только хэш */
  genPin(){const a=new Uint32Array(1);(globalThis.crypto||window.crypto).getRandomValues(a);return String(1000+a[0]%9000);},
  async pinHash(id,pin){
    const enc=new TextEncoder(),c=(globalThis.crypto||window.crypto).subtle;
    const k=await c.importKey('raw',enc.encode(String(pin)),'PBKDF2',false,['deriveBits']);
    const b=await c.deriveBits({name:'PBKDF2',salt:enc.encode('st:'+id),iterations:20000,hash:'SHA-256'},k,256);
    return btoa(String.fromCharCode(...new Uint8Array(b)));
  },
  async setStudentPin(id,pin){pin=pin||Store.genPin();Store.updateStudent(id,{pinHash:await Store.pinHash(id,pin),pinView:pin});return pin;},
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
  /* закрытые результаты (Б56) не попадают ни в рейтинг, ни в баллы, ни в отчёты кабинета: их видит только специалист через сервер */
  results(sid){const i=resIndex();return sid?(i.m.get(sid)||[]).slice():i.all.slice();},
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
    x.id=x.id||uid();x.updated=now();x.created=x.created||x.updated;if(x.closed)x.closed=true;else delete x.closed;
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
  /* наполнение комнат по классам (Б44): settings.content = {rooms:{id:'abcd'}, packs:{id:'ab'}}; нет записи — стандарт (комнаты: все классы, блоки: D.packs[].bands) */
  bandsOf(kind,id){
    const c=(load().settings.content||{})[kind==='room'?'rooms':'packs'];
    if(c&&typeof c[id]==='string')return c[id];
    if(kind==='room'&&/^c-/.test(id))return '';/* комната конструктора, пока учитель не отметил классы, — черновик */
    if(kind==='pack'){const p=((VR.DATA&&VR.DATA.packs)||[]).find(x=>x.id===id);return p?p.bands:'';}
    return 'abcd';
  },
  roomOn(id,grade){return Store.bandsOf('room',id).indexOf(Store.band(grade))>=0;},
  packOn(id,grade){
    const p=((VR.DATA&&VR.DATA.packs)||[]).find(x=>x.id===id);
    return !!p&&Store.roomOn(p.room,grade)&&Store.bandsOf('pack',id).indexOf(Store.band(grade))>=0;
  },
  setBands(kind,id,bands){
    const d=load(),c=Object.assign({},d.settings.content||{}),k=kind==='room'?'rooms':'packs';
    c[k]=Object.assign({},c[k]);
    const v=['a','b','c','d'].filter(x=>String(bands).indexOf(x)>=0).join('');
    c[k][id]=v;d.settings.content=c;d.settings.updated=now();save();Store.syncSoon();
  },
  /* комнаты конструктора (settings.rooms, формат room/1 — js/roomspec.js) */
  customRooms(){
    const r=load().settings.rooms,RS=VR.roomspec,Q=VR.DATA&&VR.DATA.Q;
    if(!r||!RS)return[];
    return Object.keys(r).map(id=>RS.clean(r[id],v=>!!(Q&&Q[v])).spec).filter(s=>s&&s.id).sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  },
  /* настройки устройства (чувствительность мыши и т.п.): только в этом браузере, на сервер не уходят */
  pref(k,d){try{const o=JSON.parse(localStorage.getItem('vrlesson.prefs')||'{}');return Object.prototype.hasOwnProperty.call(o,k)?o[k]:d;}catch(e){return d;}},
  setPref(k,v){try{const o=JSON.parse(localStorage.getItem('vrlesson.prefs')||'{}');o[k]=v;localStorage.setItem('vrlesson.prefs',JSON.stringify(o));}catch(e){}},
  temp:{},/* открытые комнаты, загруженные с сервера на время сеанса: в память, не в хранилище */
  customRoom(id){return Store.temp[id]||Store.customRooms().find(s=>s.id===id)||null;},
  saveRoom(spec){
    if(spec&&typeof spec==='object'&&!spec.author){const w=Store.account.who();if(w)spec=Object.assign({},spec,{author:w});}
    const RS=VR.roomspec,Q=VR.DATA&&VR.DATA.Q,d=load();
    const c=RS.clean(spec,v=>!!(Q&&Q[v]));
    if(!c.spec)return{spec:null,errors:c.errors};
    const rooms=Object.assign({},d.settings.rooms||{}),isNew=!rooms[c.spec.id];
    if(isNew&&Object.keys(rooms).length>=RS.LIM.rooms)return{spec:null,errors:['Комнат уже '+RS.LIM.rooms+': удалите ненужные.']};
    c.spec.created=isNew?now():(rooms[c.spec.id].created||now());c.spec.updated=now();
    rooms[c.spec.id]=c.spec;d.settings.rooms=rooms;
    if(isNew){const ct=Object.assign({},d.settings.content||{});ct.rooms=Object.assign({},ct.rooms,{[c.spec.id]:''});d.settings.content=ct;}
    d.settings.updated=now();save();Store.syncSoon();
    return c;
  },
  removeRoom(id){
    const d=load(),rooms=Object.assign({},d.settings.rooms||{});
    if(!rooms[id])return false;
    delete rooms[id];d.settings.rooms=rooms;
    if(d.settings.content&&d.settings.content.rooms&&id in d.settings.content.rooms){const ct=Object.assign({},d.settings.content);ct.rooms=Object.assign({},ct.rooms);delete ct.rooms[id];d.settings.content=ct;}
    d.settings.updated=now();save();Store.syncSoon();return true;
  },
  resetContent(){const d=load();delete d.settings.content;d.settings.updated=now();save();Store.syncSoon();},
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
  /* вход по учётной записи (шаг 9): токен только в sessionStorage — закрыл вкладку, и сессии на устройстве нет */
  account:{
    token(){try{return sessionStorage.getItem('vrl.token')||'';}catch(e){return '';}},
    who(){try{return sessionStorage.getItem('vrl.user')||'';}catch(e){return '';}},
    clear(){setSub([]);try{sessionStorage.removeItem('vrl.token');sessionStorage.removeItem('vrl.user');sessionStorage.removeItem('vrl.roles');}catch(e){}},
    roles(){try{return JSON.parse(sessionStorage.getItem('vrl.roles')||'[]');}catch(e){return[];}},
    /* включены ли учётки на сервере: выключено — 404, включено — 401 без токена; нет связи — null (кабинет остаётся с прежним входом) */
    async probe(url){
      if(!url)return null;
      try{const ctl=typeof AbortController!=='undefined'?new AbortController():null;const tm=setTimeout(()=>ctl&&ctl.abort(),6000);
        const r=await fetch(String(url).replace(/\/+$/,'')+'/api/auth/me',{signal:ctl?ctl.signal:undefined});clearTimeout(tm);
        return r.status===401?true:r.status===404?false:null;}catch(e){return null;}
    },
    async login(url,login,password){
      url=String(url||'').trim().replace(/\/+$/,'');
      let r;
      try{r=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:String(login||'').trim(),password:String(password||'')})});}
      catch(e){return {ok:false,msg:'нет связи с сервером: сеть, VPN или сервер выключен'};}
      let d={};try{d=await r.json();}catch(e){}
      if(r.status===429)return {ok:false,msg:'Слишком много попыток. Подожди '+Math.max(1,Math.ceil((d.retry||30)))+' с.'};
      if(!r.ok||!d.token)return {ok:false,msg:'Неверный логин или пароль.'};
      try{sessionStorage.setItem('vrl.token',d.token);sessionStorage.setItem('vrl.user',String(login).trim().toLowerCase());sessionStorage.setItem('vrl.roles',JSON.stringify(d.roles||[]));}catch(e){}
      if(!Store.server())Store.setServer(url,'');
      return {ok:true};
    },
    async logout(){
      const t=Store.account.token(),sv=Store.server();Store.account.clear();
      if(t&&sv)try{await fetch(sv.url+'/api/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+t}});}catch(e){}
    }
  },
  /* ---------- вызовы серверного API учёток (шаги 8–12): весь сетевой код — здесь (закон А2) ---------- */
  base(){const sv=Store.server();if(sv)return sv.url;return /(^|\.)github\.io$/.test(location.hostname)?'':location.origin;},
  me(){return Store.call('GET','/api/auth/me');},
  /* открытые комнаты (Б54): список и описание без входа; публикация и одобрение — через учётную запись */
  openList(){return Store.call('GET','/api/open/rooms',undefined,true);},
  async openRoom(id){
    const r=await Store.call('GET','/api/open/room/'+encodeURIComponent(id),undefined,true);
    if(r.status!==200)return null;
    const RS=VR.roomspec,c=RS.clean(r.data.spec,v=>!!(VR.DATA.Q&&VR.DATA.Q[v]));
    if(!c.spec)return null;
    c.spec.id='c-open'+String(id).replace(/[^a-f0-9]/g,'').slice(0,12);Store.temp[c.spec.id]=c.spec;return c.spec;
  },
  publishRoom(school,src,spec){return Store.admin('room.publish',{school,src,spec});},
  roomList(school){return Store.admin('room.list',{school:school||''});},
  roomAct(act,id){return Store.admin(act,{id});},
  closedList(school){return Store.admin('closed.list',{school:school||''});},
  authHeaders(){const t=Store.account.token(),sv=Store.server();return t?{Authorization:'Bearer '+t}:sv&&sv.key?{'X-Key':sv.key}:{};},
  /* файлы учителей (Б51, этап 2): kind = model | sound | texture; тип и размер проверяет сервер */
  async upload(kind,name,file,school){
    const base=Store.base();if(!base)return{status:0,data:{error:'Сервер не указан.'}};
    try{
      const r=await fetch(base+'/api/upload?'+Store.qs({kind,name,school}),{method:'POST',headers:Store.authHeaders(),body:file});
      let d={};try{d=await r.json();}catch(e){}
      if(r.status===401)Store.account.clear();
      return{status:r.status,data:d};
    }catch(e){return{status:0,data:{error:'нет связи с сервером'}};}
  },
  files:[],/* список файлов, доступных пользователю: {id:'up:…', kind, name, status, mine} */
  filesArch:[],/* архивные файлы (Б74): видят автор, директор, суперадмин */
  async refreshArchivedFiles(){
    if(!Store.account.token())return Store.filesArch;
    const r=await Store.admin('upload.list',{archived:1});
    if(r.status===200)Store.filesArch=r.data.items.map(i=>({raw:i.id,kind:i.kind,name:i.name,status:i.status,mine:i.mine,owner:i.owner}));
    return Store.filesArch;
  },
  async refreshFiles(){
    if(!Store.account.token())return Store.files;
    const r=await Store.admin('upload.list',{});
    if(r.status===200)Store.files=r.data.items.map(i=>({id:'up:'+i.id,raw:i.id,kind:i.kind,name:i.name,status:i.status,mine:i.mine,owner:i.owner,size:i.size,school:i.school}));
    return Store.files;
  },
  fileName(id){const f=Store.files.find(x=>x.id===id);return f?f.name:'Мой файл';},
  async call(method,path,body,noAuth){
    const base=Store.base();if(!base)return{status:0,data:{error:'Сервер не указан. Откройте страницу с вашего сервера.'}};
    const tok=noAuth?'':Store.account.token(),h={};if(body!==undefined)h['Content-Type']='application/json';if(tok)h.Authorization='Bearer '+tok;
    try{
      const ctl=typeof AbortController!=='undefined'?new AbortController():null;const tm=setTimeout(()=>ctl&&ctl.abort(),15000);
      const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:ctl?ctl.signal:undefined});clearTimeout(tm);
      let d={};try{d=await r.json();}catch(e){}
      if(tok&&r.status===401){Store.account.clear();d.expired=true;}
      return{status:r.status,data:d};
    }catch(e){return{status:0,data:{error:'нет связи с сервером'}};}
  },
  admin(act,body){return Store.call('POST','/api/admin/'+encodeURIComponent(act),body||{});},
  /* живые уроки (сеть, PLAN-network.md §5.4): все запросы к серверу — только здесь (закон А2); js/net.js держит само соединение и fetch не делает.
     auth: 'dev' — ключ шлема (X-Key), 'user' — токен учётной записи, 'none' — без входа (удалённый ученик по коду урока) */
  async netCall(method,path,body,auth){
    const base=Store.base();if(!base)return{status:0,data:{error:'Сервер не указан. Откройте страницу с вашего сервера.'}};
    const sv=Store.server(),h={};if(body!==undefined)h['Content-Type']='application/json';
    if(auth==='dev'&&sv&&sv.key)h['X-Key']=sv.key;
    else if(auth==='user'){const t=Store.account.token();if(t)h.Authorization='Bearer '+t;}
    try{
      const ctl=typeof AbortController!=='undefined'?new AbortController():null;const tm=setTimeout(()=>ctl&&ctl.abort(),15000);
      const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:ctl?ctl.signal:undefined});clearTimeout(tm);
      let d={};try{d=await r.json();}catch(e){}
      if(auth==='user'&&r.status===401){Store.account.clear();d.expired=true;}
      return{status:r.status,data:d};
    }catch(e){return{status:0,data:{error:'нет связи с сервером'}};}
  },
  sessionLive(){return Store.netCall('GET','/api/session/live',undefined,'dev');},                                   /* → data.sessions:[{id,class_id,kind,room,created}] */
  async sessionTicket(sid,studentId,pin){                                                                          /* ученик: ключ шлема + код; учитель: токен учётки (studentId пуст) */
    if(!studentId)return Store.netCall('POST','/api/room/ticket',{session_id:sid},'user');
    const ph=await Store.pinHash(studentId,String(pin||'').trim());
    return Store.netCall('POST','/api/room/ticket',{session_id:sid,student_id:studentId,pin_hash:ph},'dev');
  },
  async remoteTicket(code,studentId,pin){                                                                          /* удалённый ученик: код урока */
    const ph=await Store.pinHash(studentId,String(pin||'').trim());
    return Store.netCall('POST','/api/room/ticket',{code:String(code||'').trim(),student_id:studentId,pin_hash:ph},'none');
  },
  async playJoin(classId,studentId,pin){
    const ph=await Store.pinHash(studentId,String(pin||'').trim());
    return Store.netCall('POST','/api/play/join',{class_id:classId,student_id:studentId,pin_hash:ph},'dev');
  },
  sessionAdmin(act,body){return Store.admin('session.'+act,body);},                                                  /* open, close, settings, kick, unkick, list, chat */
  qs(o){return Object.keys(o||{}).filter(k=>o[k]!==undefined&&o[k]!==''&&o[k]!==null).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(o[k])).join('&');},
  options(q){return Store.call('GET','/api/options?'+Store.qs(q));},
  accounts(q){return Store.call('GET','/api/accounts?'+Store.qs(q));},
  history(q){return Store.call('GET','/api/history?'+Store.qs(q));},/* журнал школы (Б74): school, kind, from, page, size */
  async activate(b){
    const r=await Store.call('POST','/api/auth/activate',b,true);
    if(r.status===200&&r.data.token)try{sessionStorage.setItem('vrl.token',r.data.token);sessionStorage.setItem('vrl.user',(r.data.user&&r.data.user.login)||'');sessionStorage.setItem('vrl.roles',JSON.stringify(r.data.roles||[]));}catch(e){}
    return r;
  },
  /* привязка шлема по короткому коду: ключ шлема сохраняется как раньше, вводить длинный ключ не нужно */
  async pair(url,code,name){
    url=String(url||Store.base()||'').trim().replace(/\/+$/,'');if(!url)return{ok:false,msg:'Укажите адрес сервера.'};
    let r;try{r=await fetch(url+'/api/device/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:String(code||''),name:name||''})});}catch(e){return{ok:false,msg:'нет связи с сервером'};}
    let d={};try{d=await r.json();}catch(e){}
    if(r.status===429)return{ok:false,msg:'Слишком много попыток. Подождите минуту.'};
    if(!r.ok||!d.key)return{ok:false,msg:d.error||'Код не подходит.'};
    Store.setServer(url,d.key);return{ok:true,school:d.school};
  },
  /* файл ресурса (модель, звук): только из папки assets/ этого же сайта, с ограничением размера (Б51) */
  async getAsset(url,max){
    const up=/^up:([0-9a-f]{12})$/.exec(String(url));
    if(!up&&(!/^assets\/[A-Za-z0-9_\/.-]{1,120}$/.test(String(url))||String(url).indexOf('..')>=0))throw new Error('Недопустимый адрес ресурса.');
    const r=await fetch(up?Store.base()+'/api/asset/'+up[1]:url,up?{headers:Store.authHeaders()}:undefined);if(!r.ok)throw new Error('Ресурс не найден: '+url);
    const n=+r.headers.get('content-length');if(max&&n>max)throw new Error('Ресурс слишком большой.');
    const b=await r.arrayBuffer();if(max&&b.byteLength>max)throw new Error('Ресурс слишком большой.');return b;
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
        const tok=Store.account.token();
        const res=await fetch(sv.url+'/api/sync',{method:'POST',headers:tok?{'Content-Type':'application/json','Authorization':'Bearer '+tok}:{'Content-Type':'application/json','X-Key':sv.key},body:JSON.stringify(load()),signal:ctl?ctl.signal:undefined});
        clearTimeout(tm);
        if(tok&&res.status===401){Store.account.clear();const er=new Error('Сессия закончилась. Войди снова.');er.expired=true;throw er;}
        if(res.status===401||res.status===403)throw new Error('Сервер не принял ключ. Скопируй только символы между кавычками, без самих кавычек');
        if(!res.ok)throw new Error('Сервер ответил '+res.status);
        const data=await res.json();
        db=merge(load(),data.state);adoptServerTeachers(db,data.state);save();
        setSub(data.state&&data.state.sub);
        Store.status={state:'ok',at:now(),role:data.role,msg:''};
      }catch(e){
        Store.status={state:'err',at:now(),role:null,expired:!!(e&&e.expired),msg:e&&e.name==='AbortError'?'сервер не ответил за 12 секунд':(e instanceof TypeError||/fetch/i.test(e&&e.message||''))?'нет связи с сервером: сеть, VPN или сервер выключен':(e&&e.message)||'нет связи'};
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

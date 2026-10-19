/* store.js — ученики, результаты тестов, открытия. Хранится в localStorage этого браузера. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const KEY='vrlesson.v1';
const SUBJ=['math','phys','chem','space'];
const blank=()=>({v:1,students:[],results:[],disc:{},settings:{pin:'1234',minutes:8}});
let db=null;
const clampGrade=g=>{g=parseInt(g,10);return g>=1&&g<=11?g:5;};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

function load(){
  if(db)return db;
  try{const s=localStorage.getItem(KEY);db=s?JSON.parse(s):null;}catch(e){db=null;}
  if(!db||typeof db!=='object')db=blank();
  const b=blank();
  if(!Array.isArray(db.students))db.students=[];
  if(!Array.isArray(db.results))db.results=[];
  if(!db.disc||typeof db.disc!=='object')db.disc={};
  db.settings=Object.assign(b.settings,db.settings||{});
  return db;
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(db));return true;}catch(e){return false;}}

const Store=VR.Store={
  SUBJ,
  band:g=>{g=clampGrade(g);return g<=4?'p':g<=7?'m':'s';},
  reload(){db=null;return load();},
  canSave(){try{localStorage.setItem(KEY+'.t','1');localStorage.removeItem(KEY+'.t');return true;}catch(e){return false;}},

  students(){return load().students.slice().sort((a,b)=>a.grade-b.grade||a.name.localeCompare(b.name,'ru'));},
  student(id){return load().students.find(s=>s.id===id)||null;},
  addStudent(name,grade){
    name=String(name||'').trim().slice(0,40);if(!name)return null;
    const s={id:uid(),name,grade:clampGrade(grade),created:Date.now()};
    load().students.push(s);save();return s;
  },
  updateStudent(id,patch){
    const s=Store.student(id);if(!s)return null;
    if(patch.name!=null){const n=String(patch.name).trim().slice(0,40);if(n)s.name=n;}
    if(patch.grade!=null)s.grade=clampGrade(patch.grade);
    save();return s;
  },
  removeStudent(id){
    const d=load();
    d.students=d.students.filter(s=>s.id!==id);
    d.results=d.results.filter(r=>r.sid!==id);
    delete d.disc[id];save();
  },

  addResult(r){const x=Object.assign({id:uid(),ts:Date.now()},r);load().results.push(x);save();return x;},
  results(sid){const r=load().results;return sid?r.filter(x=>x.sid===sid):r.slice();},

  addDiscovery(sid,subj,key){
    if(!sid)return false;
    const d=load(),m=d.disc[sid]=d.disc[sid]||{},k=subj+':'+key;
    if(m[k])return false;m[k]=Date.now();save();return true;
  },
  discoveries(sid){return Object.keys(load().disc[sid]||{});},

  best(sid){
    const o={};for(const s of SUBJ)o[s]={best:null,total:5,attempts:0,last:null};
    for(const r of Store.results(sid)){
      const b=o[r.subj];if(!b)continue;
      b.attempts++;
      if(b.best===null||r.score>b.best){b.best=r.score;b.total=r.total;}
      if(!b.last||r.ts>b.last.ts)b.last=r;
    }
    return o;
  },
  points(sid){
    const b=Store.best(sid);let t=0,passed=0;
    for(const s of SUBJ)if(b[s].best!==null){t+=b[s].best*10;if(b[s].best>=3)passed++;}
    const d=Store.discoveries(sid).length;
    return{tests:t,disc:d*2,discCount:d,passed,total:t+d*2};
  },
  lastActive(sid){
    let t=0;for(const r of Store.results(sid))t=Math.max(t,r.ts);
    const m=load().disc[sid]||{};for(const k in m)t=Math.max(t,m[k]);
    return t||null;
  },

  settings(){return Object.assign({},load().settings);},
  setSettings(p){Object.assign(load().settings,p);save();},

  exportJSON(){return JSON.stringify(load());},
  importJSON(text){
    let x;try{x=JSON.parse(text);}catch(e){throw new Error('Это не файл данных VR-урока (ошибка JSON).');}
    if(!x||!Array.isArray(x.students)||!Array.isArray(x.results))throw new Error('В файле нет списка учеников и результатов.');
    const d=load();let ns=0,nr=0;
    const sid=new Set(d.students.map(s=>s.id)),rid=new Set(d.results.map(r=>r.id));
    for(const s of x.students){if(s&&s.id&&s.name&&!sid.has(s.id)){d.students.push({id:String(s.id),name:String(s.name).slice(0,40),grade:clampGrade(s.grade),created:s.created||Date.now()});sid.add(s.id);ns++;}}
    for(const r of x.results){if(r&&r.id&&r.sid&&r.subj&&!rid.has(r.id)){d.results.push(r);rid.add(r.id);nr++;}}
    if(x.disc&&typeof x.disc==='object')for(const s in x.disc){const m=d.disc[s]=d.disc[s]||{};for(const k in x.disc[s])if(!m[k])m[k]=x.disc[s][k];}
    save();return{students:ns,results:nr};
  },
  clearResults(){const d=load();d.results=[];d.disc={};save();}
};
})();

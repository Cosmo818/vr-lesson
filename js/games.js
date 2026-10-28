/* games.js — журнал игр, статистика, лучшие и турниры «на выбывание». Без WebGL и DOM.
   Хранится только на этом устройстве (отдельный ключ браузера, не база школы и не сервер): сетевой обмен результатами — отдельный шаг (закон А2).
   Данные проверяются на входе (А5): неизвестное отбрасывается, длины ограничены. merge — по id, победитель в турнире не пересчитывается.
   Игры: 'einstein' (время; помощь или ошибка — без зачёта), 'chess' (победа/ничья/поражение; против компьютера или «вдвоём» в турнире). */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const KEY='vrlesson.games.v1',CAP=3000,TCAP=40,PMAX=16;
const GAMES=['einstein','chess'],RES=['win','lose','draw','dnf'];
const now=()=>Date.now();
const uid=()=>now().toString(36)+Math.random().toString(36).slice(2,7);
const str=(x,n)=>typeof x==='string'?x.slice(0,n):'';
const num=(x,a,b,d)=>{x=Number(x);return isFinite(x)?Math.max(a,Math.min(b,x)):d;};
let mem=null,db=null;

/* ---------- проверка данных ---------- */
function cleanGame(g){
  if(!g||typeof g!=='object'||GAMES.indexOf(g.game)<0||RES.indexOf(g.res)<0)return null;
  const id=str(g.id,40);if(!id)return null;
  return{id,ts:num(g.ts,0,4e12,0),sid:str(g.sid,60),name:str(g.name,40)||'Ученик',grade:num(g.grade,1,11,5)|0,game:g.game,res:g.res,
    t:g.t==null?null:num(g.t,0,86400,null),moves:num(g.moves,0,9999,0)|0,helped:!!g.helped,lvl:num(g.lvl,0,3,0)|0,vs:g.vs==='duel'?'duel':'comp',
    opp:str(g.opp,40),tid:g.tid?str(g.tid,40):null,mid:g.mid?str(g.mid,12):null,seed:g.seed==null?null:num(g.seed,0,4294967295,0)};
}
function cleanRes(r){return r&&typeof r==='object'?{t:r.t==null?null:num(r.t,0,86400,null),moves:num(r.moves,0,9999,0)|0}:null;}
function cleanTour(t){
  if(!t||typeof t!=='object'||GAMES.indexOf(t.game)<0)return null;const id=str(t.id,40);if(!id)return null;
  const names={};if(t.names&&typeof t.names==='object')for(const k of Object.keys(t.names).slice(0,PMAX))names[str(k,60)]=str(t.names[k],40);
  const players=(Array.isArray(t.players)?t.players:[]).map(x=>str(x,60)).filter(Boolean).slice(0,PMAX);
  const rounds=(Array.isArray(t.rounds)?t.rounds:[]).slice(0,5).map(rd=>(Array.isArray(rd)?rd:[]).slice(0,16).map(m=>({
    a:m&&m.a?str(m.a,60):null,b:m&&m.b?str(m.b,60):null,ra:cleanRes(m&&m.ra),rb:cleanRes(m&&m.rb),w:m&&m.w?str(m.w,60):null,bye:!!(m&&m.bye),rep:num(m&&m.rep,0,99,0)|0,sw:!!(m&&m.sw)})));
  return{id,ts:num(t.ts,0,4e12,0),u:num(t.u,0,4e12,0),game:t.game,name:str(t.name,40)||'Турнир',seed:num(t.seed,0,4294967295,1)>>>0,
    state:['signup','run','done'].indexOf(t.state)>=0?t.state:'signup',players,names,rounds,champ:t.champ?str(t.champ,60):null,by:str(t.by,60)};
}
function clean(x){
  const o={v:1,games:[],tours:[]};if(!x||typeof x!=='object')return o;
  const seen=new Set();
  for(const g of Array.isArray(x.games)?x.games:[]){const c=cleanGame(g);if(c&&!seen.has(c.id)){seen.add(c.id);o.games.push(c);}}
  o.games.sort((a,b)=>a.ts-b.ts);if(o.games.length>CAP)o.games=o.games.slice(-CAP);
  const ts=new Set();
  for(const t of Array.isArray(x.tours)?x.tours:[]){const c=cleanTour(t);if(c&&!ts.has(c.id)){ts.add(c.id);o.tours.push(c);}}
  o.tours.sort((a,b)=>a.ts-b.ts);if(o.tours.length>TCAP)o.tours=o.tours.slice(-TCAP);
  return o;
}
function merge(A,B){
  A=clean(A);B=clean(B);const gm=new Map();for(const g of A.games.concat(B.games))if(!gm.has(g.id))gm.set(g.id,g);
  const tm=new Map();for(const t of A.tours.concat(B.tours)){const o=tm.get(t.id);if(!o||t.u>o.u)tm.set(t.id,t);}
  return clean({games:[...gm.values()],tours:[...tm.values()]});
}
function load(){
  if(db)return db;let x=null;
  try{const s=localStorage.getItem(KEY);x=s?JSON.parse(s):null;}catch(e){x=mem;}
  db=clean(x);return db;
}
function save(){mem=db;try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){}for(const f of listeners)try{f();}catch(e){}}
const listeners=[];
/* сохранённые (любимые) сиды головоломок: отдельный ключ, только на этом устройстве */
const FKEY='vrl.favseeds';let fav=null;
function favLoad(){if(fav)return fav;let x=null;try{x=JSON.parse(localStorage.getItem(FKEY)||'null');}catch(e){}
  fav={};if(x&&typeof x==='object')for(const k of Object.keys(x)){if(!/^[a-z]{2,12}$/.test(k)||!Array.isArray(x[k]))continue;fav[k]=x[k].filter(n=>Number.isInteger(n)&&n>=0&&n<=4294967295).slice(0,60);}
  return fav;}
function favs(game){return(favLoad()[game]||[]).slice();}
function favToggle(game,seed){if(!/^[a-z]{2,12}$/.test(game)||!Number.isInteger(seed)||seed<0||seed>4294967295)return false;
  const f=favLoad(),a=f[game]||(f[game]=[]),i=a.indexOf(seed);if(i>=0)a.splice(i,1);else{a.unshift(seed);if(a.length>60)a.pop();}
  try{localStorage.setItem(FKEY,JSON.stringify(f));}catch(e){}return i<0;}

/* ---------- настройки ученика в «Эйнштейне»: один ключ на устройстве, по id ученика (формат — PLAN-einstein.md 1.4) ---------- */
const PKEY='vrl.einprefs',PDEF={hk:1,mode:'pick',view:'wall',tab:'school',order:'avg'},PREFMAX=200;
function prefField(k,v){
  if(k==='hk')return Number.isInteger(v)&&v>=0&&v<=2?v:undefined;
  if(k==='mode')return v==='pick'||v==='excl'?v:undefined;
  if(k==='view')return v==='wall'||v==='term'?v:undefined;
  if(k==='tab')return v==='school'||v==='district'||v==='region'?v:undefined;
  if(k==='order')return v==='avg'||v==='count'?v:undefined;
}
function prefClean(o){const r={};for(const k of Object.keys(PDEF)){const v=o&&typeof o==='object'?prefField(k,o[k]):undefined;r[k]=v===undefined?PDEF[k]:v;}
  r.ts=o&&typeof o==='object'&&Number.isFinite(o.ts)&&o.ts>=0&&o.ts<=4e12?o.ts:0;return r;}
const prefKey=sid=>{const k=sid?String(sid):'guest';return /^[\w-]{1,60}$/.test(k)&&k!=='__proto__'?k:null;};
function prefLoad(){let x=null;try{x=JSON.parse(localStorage.getItem(PKEY)||'null');}catch(e){}
  const u={};if(x&&typeof x==='object'&&!Array.isArray(x)&&x.u&&typeof x.u==='object'&&!Array.isArray(x.u))
    for(const k of Object.keys(x.u).slice(0,PREFMAX*2)){if(prefKey(k)!==k)continue;u[k]=prefClean(x.u[k]);}
  return u;}
function prefs(sid){const k=prefKey(sid),r=prefClean(k?prefLoad()[k]:null);delete r.ts;return r;}
function setPrefs(sid,patch){const k=prefKey(sid);if(!k)return prefs(null);
  const u=prefLoad(),cur=u[k]||prefClean(null);
  if(patch&&typeof patch==='object')for(const f of Object.keys(PDEF)){const v=prefField(f,patch[f]);if(v!==undefined)cur[f]=v;}
  cur.ts=Date.now();u[k]=cur;
  let ks=Object.keys(u);while(ks.length>PREFMAX){let o=ks[0];for(const q of ks)if(u[q].ts<u[o].ts)o=q;delete u[o];ks=Object.keys(u);}
  try{localStorage.setItem(PKEY,JSON.stringify({v:1,u}));}catch(e){}
  const r=Object.assign({},cur);delete r.ts;return r;}

/* ---------- запись игр и статистика ---------- */
function record(r){
  const c=cleanGame(Object.assign({id:uid(),ts:now()},r));if(!c)return null;
  const d=load();d.games.push(c);if(d.games.length>CAP)d.games.shift();save();return c;
}
function who(E){const s=E&&E.student;return s&&s.id?{sid:String(s.id),name:s.name,grade:s.grade}:null;}
/* итог игры: E.student → запись; в гостевом режиме запись не пишется (нельзя приписать результат) */
function finish(E,game,info){
  const w=who(E);if(!w)return null;info=info||{};
  const res=info.res||(info.time!=null?'win':'lose');
  const rec=record({sid:w.sid,name:w.name,grade:w.grade,game,res,t:info.time==null?null:info.time,moves:info.moves||0,helped:!!info.helped,lvl:info.lvl||0,vs:info.vs||'comp',opp:info.opp||'',tid:info.tid||null,mid:info.mid||null,seed:info.seed==null?null:info.seed});
  if(info.tid&&game==='einstein'&&info.mid){
    const[r,i]=info.mid.split('.').map(Number);
    T.reportEinstein(info.tid,r,i,w.sid,{t:res==='win'&&!info.helped?info.time:null,moves:info.moves||0});
  }
  return rec;
}
function stats(sid){
  const gs=load().games.filter(g=>g.sid===sid);
  const ein=gs.filter(g=>g.game==='einstein'),ch=gs.filter(g=>g.game==='chess');
  const times=ein.filter(g=>g.res==='win'&&!g.helped&&g.t!=null).map(g=>g.t);
  const byLvl=[0,0,0,0];for(const g of ch)if(g.res==='win'&&g.vs==='comp')byLvl[g.lvl]++;
  const tours=load().tours.filter(t=>t.players.indexOf(sid)>=0);
  return{einstein:{played:ein.length,wins:ein.filter(g=>g.res==='win').length,best:times.length?Math.min(...times):null,avg:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null},
    chess:{played:ch.length,w:ch.filter(g=>g.res==='win').length,d:ch.filter(g=>g.res==='draw').length,l:ch.filter(g=>g.res==='lose').length,byLvl},
    tours:{played:tours.length,won:tours.filter(t=>t.champ===sid).length}};
}
/* лучшие: einstein — по лучшему времени, chess — по победам (при равенстве — по высшему уровню), tours — по числу побед в турнирах */
function top(kind,n){
  const d=load(),by=new Map(),nm={};
  for(const g of d.games){nm[g.sid]=g.name;if(!by.has(g.sid))by.set(g.sid,[]);by.get(g.sid).push(g);}
  for(const t of d.tours)for(const k in t.names)nm[k]=nm[k]||t.names[k];
  const rows=[];
  if(kind==='tours'){const w=new Map();for(const t of d.tours)if(t.champ)w.set(t.champ,(w.get(t.champ)||0)+1);for(const[sid,c]of w)rows.push({sid,name:nm[sid]||'Ученик',won:c});rows.sort((a,b)=>b.won-a.won||a.name.localeCompare(b.name));return rows.slice(0,n||5);}
  for(const[sid,gs]of by){
    if(kind==='einstein'){const ts=gs.filter(g=>g.game==='einstein'&&g.res==='win'&&!g.helped&&g.t!=null).map(g=>g.t);if(ts.length)rows.push({sid,name:nm[sid],best:Math.min(...ts),wins:ts.length,played:gs.filter(g=>g.game==='einstein').length});}
    else{const c=gs.filter(g=>g.game==='chess'),w=c.filter(g=>g.res==='win');if(w.length)rows.push({sid,name:nm[sid],wins:w.length,played:c.length,lvl:Math.max(...w.map(g=>g.vs==='comp'?g.lvl:0))});}
  }
  rows.sort(kind==='einstein'?(a,b)=>a.best-b.best||b.wins-a.wins:(a,b)=>b.wins-a.wins||b.lvl-a.lvl||a.played-b.played);
  return rows.slice(0,n||5);
}
function history(n,sid){const g=load().games;return(sid?g.filter(x=>x.sid===sid):g).slice(-(n||10)).reverse();}

/* ---------- турниры ---------- */
const T={
  list(){return load().tours.slice().reverse();},
  get(id){return load().tours.find(t=>t.id===id)||null;},
  create(game,name,by){
    if(GAMES.indexOf(game)<0)return null;
    const t=cleanTour({id:uid(),ts:now(),u:now(),game,name:name||(game==='einstein'?'Турнир по «Эйнштейну»':'Шахматный турнир'),seed:(Math.random()*4294967296)>>>0,state:'signup',by:by||''});
    const d=load();d.tours.push(t);if(d.tours.length>TCAP)d.tours.shift();save();return t;
  },
  touch(t){t.u=now();save();},
  signup(id,sid,name){
    const t=T.get(id);if(!t||t.state!=='signup'||!sid||t.players.indexOf(sid)>=0||t.players.length>=PMAX)return false;
    t.players.push(sid);t.names[sid]=str(name,40)||'Ученик';T.touch(t);return true;
  },
  leave(id,sid){const t=T.get(id);if(!t||t.state!=='signup')return false;const i=t.players.indexOf(sid);if(i<0)return false;t.players.splice(i,1);delete t.names[sid];T.touch(t);return true;},
  /* сетка на выбывание: размер — степень двойки ≥ числа игроков; «сеяные» по жребию с сидом турнира, пустые места — пропуск хода */
  start(id){
    const t=T.get(id);if(!t||t.state!=='signup'||t.players.length<2)return false;
    const rn=VR.einstein?VR.einstein.rng(t.seed):(n=>Math.floor(Math.random()*n));
    const p=t.players.slice();for(let i=p.length-1;i>0;i--){const j=rn(i+1),x=p[i];p[i]=p[j];p[j]=x;}
    let size=2;while(size<p.length)size*=2;
    let s=[0];while(s.length<size){const L=s.length*2;s=s.flatMap(x=>[x,L-1-x]);}
    const seat=k=>s[k]<p.length?p[s[k]]:null;
    const rounds=[];let cnt=size/2;
    while(cnt>=1){rounds.push(Array.from({length:cnt},()=>({a:null,b:null,ra:null,rb:null,w:null,bye:false,rep:0,sw:false})));cnt/=2;}
    rounds[0].forEach((m,i)=>{m.a=seat(2*i);m.b=seat(2*i+1);});
    t.rounds=rounds;t.state='run';
    rounds[0].forEach((m,i)=>{if(!m.a||!m.b){m.bye=true;advance(t,0,i,m.a||m.b);}});
    T.touch(t);return true;
  },
  /* кто играет дальше: первый неоконченный матч ученика, где он ещё не сыграл (для «Эйнштейна») */
  next(id,sid){
    const t=T.get(id);if(!t||t.state!=='run')return null;
    for(let r=0;r<t.rounds.length;r++)for(let i=0;i<t.rounds[r].length;i++){
      const m=t.rounds[r][i];
      if(m.w||!m.a||!m.b||(m.a!==sid&&m.b!==sid))continue;
      if(t.game==='einstein'&&(m.a===sid?m.ra:m.rb))continue;
      return{r,i,m,seed:matchSeed(t,r,i)};
    }
    return null;
  },
  reportEinstein(id,r,i,sid,res){
    const t=T.get(id),m=t&&t.rounds[r]&&t.rounds[r][i];if(!m||t.state!=='run'||m.w)return false;
    const side=m.a===sid?'ra':m.b===sid?'rb':null;if(!side||m[side])return false;
    m[side]=cleanRes(res);
    if(m.ra&&m.rb){
      const ta=m.ra.t,tb=m.rb.t;
      if(ta!=null&&(tb==null||ta<tb))advance(t,r,i,m.a);
      else if(tb!=null&&(ta==null||tb<ta))advance(t,r,i,m.b);
      else if(ta!=null&&tb!=null&&ta===tb&&m.ra.moves!==m.rb.moves)advance(t,r,i,m.ra.moves<m.rb.moves?m.a:m.b);
      else{m.ra=m.rb=null;m.rep++;}   /* оба без зачёта или ровно поровну — переигровка */
    }
    T.touch(t);return true;
  },
  /* шахматы вдвоём: winner 'a' | 'b' | 'draw'; ничья — переигровка с обменом цветов */
  reportDuel(id,r,i,winner){
    const t=T.get(id),m=t&&t.rounds[r]&&t.rounds[r][i];if(!m||t.state!=='run'||m.w||!m.a||!m.b)return false;
    if(winner==='a')advance(t,r,i,m.a);else if(winner==='b')advance(t,r,i,m.b);
    else if(winner==='draw'){m.sw=!m.sw;m.rep++;}else return false;
    T.touch(t);return true;
  },
  cancel(id){const d=load(),i=d.tours.findIndex(t=>t.id===id);if(i<0)return false;d.tours.splice(i,1);save();return true;},
  /* сколько матчей сыграно / всего реальных */
  progress(t){let done=0,all=0;for(const rd of t.rounds)for(const m of rd)if(!m.bye){all++;if(m.w)done++;}return{done,all};}
};
const matchSeed=(t,r,i)=>((t.seed+r*131+i*17+((t.rounds[r][i].rep|0)*1009))>>>0);
function advance(t,r,i,sid){
  const m=t.rounds[r][i];m.w=sid;
  if(r===t.rounds.length-1){t.state='done';t.champ=sid;return;}
  const n=t.rounds[r+1][i>>1];if(i%2===0)n.a=sid;else n.b=sid;
}

VR.games={favs,favToggle,prefs,setPrefs,KEY,load,save,clean,merge,record,finish,stats,top,history,tour:T,matchSeed,onChange:f=>{listeners.push(f);return f;},offChange:f=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);},pending:null,_reset(){db=null;mem=null;try{localStorage.removeItem(KEY);}catch(e){}try{localStorage.removeItem(PKEY);}catch(e){}}};
})();

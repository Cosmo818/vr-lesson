/* netlead.js — события ведущего в шлеме (шаг Н10, PLAN-network.md §8.1–8.2, протокол — docs/NET_PROTOCOL.md). Слой «модули».
   Принимает от VR.net: point (указки соседей), react (эмодзи над головой), gather (все ко мне / к доске), hall и room (табличка «Учитель зовёт…»,
   переход через 3 с), freeze (E.frozen: предмет выпадает, работают голова и меню, табличка «Учитель просит внимания»), follow (за ведущим по комнатам),
   closed 4012 (учитель убрал с урока). Отправляет свою указку (10 Гц, пока включена) и реакции (не чаще раза в 2 с).
   Права проверяет hub: здесь ведущий — тот, чей slot в roster с ролью 't'; от остальных события ведущего не исполняются.
   Сбор: виртуальный телепорт, физически никто не двигается. Места — кольца вокруг ведущего (1,5 м; если он в VR) или полукруг у места появления
   комнаты лицом к доске (из кабинета, поз нет); каждое место проверяет E.tpOk, как шаг назад; номер места — по номеру slot среди учеников.
   Чистые функции (без DOM и сети) — VR.netlead._pure, их проверяет tests/netlead.js. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const POINT_MS=100,POINT_STALE=600,GO_MS=3000,REACT_MS=2000,FREEZE_TOAST=3000,R0=1.5,RING=.8,GAP=.75,MARGIN=.3;
const EMOJI=['👍','👎','👏','😀','😮','🤔','❤️','✋','❓','✅','❌','🎉'];

/* ---------- чистые функции ---------- */
const wrapPi=a=>{a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;};
/* направление взгляда из кватерниона [x,y,z,w]: поворот вектора (0,0,-1), угол как в движке (вперёд = (-sin yaw, -cos yaw)) */
function yawOfQuat(q){
  const[x,y,z,w]=q,fx=-2*(x*z+w*y),fz=-(1-2*(x*x+y*y));
  return Math.hypot(fx,fz)<1e-6?0:Math.atan2(-fx,-fz);
}
/* угол, при котором смотришь из (x,z) на (tx,tz) */
const yawTo=(x,z,tx,tz)=>Math.atan2(-(tx-x),-(tz-z));
/* смещения по углу от «прямо»: 0, +d, -d, +2d, -2d … — сначала заполняются места спереди */
function fanOrder(n,d){const o=[0];for(let k=1;o.length<n;k++){o.push(k*d);if(o.length<n)o.push(-k*d);}return o;}
/* места сбора: full — кольцо вокруг (cx,cz), иначе полукруг; yaw — куда смотрит центр; три кольца (r, r+0,8, r+1,6).
   Место на угле a: (cx - r·sin(yaw+a), cz - r·cos(yaw+a)) — «перед» центром при a=0 */
function gatherSpots(cx,cz,yaw,full){
  const out=[];
  for(let ring=0;ring<3;ring++){
    const r=R0+ring*RING,d=GAP/r,lim=full?Math.PI:Math.PI/2+1e-9;
    const n=full?Math.max(1,Math.floor(2*Math.PI/d)):Math.floor(Math.PI/d)+1;
    for(const a of fanOrder(n,d)){if(Math.abs(a)>lim)continue;const t=yaw+a;out.push({x:cx-r*Math.sin(t),z:cz-r*Math.cos(t),ring});}
  }
  return out;
}
/* моё место: i-е из подходящих (ok(x,z) — нет стен и мебели); мест не хватило — по кругу. Нет ни одного — null */
function pickSpot(spots,i,ok){
  const good=spots.filter(s=>{try{return!!ok(s.x,s.z);}catch(e){return false;}});
  if(!good.length||i<0)return null;
  return good[i%good.length];
}
/* номер ученика среди учеников (по slot): себя в roster hub не присылает — me добавляется, если я ученик; иначе -1 */
function studentIndex(roster,me,mine){
  if(!mine||typeof me!=='number'||me<0)return -1;
  const ids=Object.keys(roster||{}).map(Number).filter(s=>s!==me&&roster[s]&&roster[s].role==='s');ids.push(me);ids.sort((a,b)=>a-b);
  return ids.indexOf(me);
}
/* сбор из кабинета: центр — 2 м перед местом появления (к доске), места — полукругом на стороне учеников, все смотрят на доску */
function boardCenter(spawn){const sx=spawn&&isFinite(spawn.x)?spawn.x:0,sz=spawn&&isFinite(spawn.z)?spawn.z:-.5;return{x:sx,z:sz-2,yaw:Math.PI};}
/* поворот всей системы (P.yaw в шлеме), чтобы голова смотрела на угол want: голова сейчас headYaw при повороте системы rigYaw */
const rigYawFor=(want,headYaw,rigYaw)=>wrapPi(rigYaw+wrapPi(want-headYaw));
/* луч указки соседа до первой стены или пола (как своя указка в движке): длина t */
function beamLen(o,d,bound){
  let t=14;const B=bound||5.9;
  for(const ax of[0,2])for(const sg of[-1,1]){const v=d[ax];if(v*sg>1e-4){const k=(sg*B-o[ax])/v;if(k>0&&k<t)t=k;}}
  if(d[1]<-1e-4){const k=-o[1]/d[1];if(k>0&&k<t)t=k;}
  return t;
}
const normDir=d=>{const n=Math.hypot(d[0],d[1],d[2]);return n<1e-9?null:[d[0]/n,d[1]/n,d[2]/n];};

/* ---------- состояние ---------- */
const env={now:()=>(typeof performance!=='undefined'?performance.now():Date.now()),wall:()=>Date.now()};
const S={on:false,E:null,net:null,hs:[],frozen:false,pointers:true,follow:null,go:null,points:{},ptT:0,ptOn:false,reactT:-1e9,ftT:0,drawOn:false,lastRoom:{}};

const lead=slot=>{try{const r=VR.netplay&&VR.netplay.rosterOf(slot);return!!r&&r.role==='t';}catch(e){return false;}};
const roomTitle=id=>{
  try{const D=VR.DATA||{},sb=D.subjects&&D.subjects[id];if(sb&&sb.title)return sb.title;}catch(e){}
  try{const R=S.E&&S.E.rooms&&S.E.rooms[id];if(R&&R.title)return R.title;}catch(e){}
  return id==='hall'?'Холл':id;
};
/* комната для перехода: предмет → его вход (VR.entryOf), только если такая комната есть в шлеме */
function roomFor(id){
  const E=S.E;if(!E||!E.rooms||typeof id!=='string')return null;
  let r=id;try{if(VR.entryOf)r=VR.entryOf(id)||id;}catch(e){}
  return E.rooms[r]?r:E.rooms[id]?id:null;
}
function goNow(id){
  const E=S.E,r=roomFor(id);if(!E||!r)return false;
  if(E.roomId!==r)try{E.goRoom(r);}catch(e){return false;}
  return true;
}

/* ---------- события ---------- */
function setFreeze(on){
  const E=S.E;S.frozen=!!on;if(!E)return;
  E.frozen=S.frozen;
  if(S.frozen){
    try{if(E.laser&&E.laser.on&&!E.isTeacher())E.toggleLaser(false);}catch(e){}
    S.ftT=0;toastFreeze();
  }else try{E.toast('Можно продолжать','#86efac');}catch(e){}
}
function toastFreeze(){try{S.E.toast('Учитель просит внимания','#facc15');S.ftT=env.now();}catch(e){}}
function onSess(se){
  if(!se||typeof se!=='object')return;
  S.pointers=se.pointers!==false;
  if(typeof se.freeze==='boolean'&&se.freeze!==S.frozen)setFreeze(se.freeze);
}
function gather(m){
  const E=S.E,NP=VR.netplay;if(!E||!NP)return;
  let mine=true;try{mine=!E.isTeacher();}catch(e){}
  const me=NP.mySlot(),i=studentIndex(NP._state.roster,me,mine);if(i<0)return;       /* учитель в шлеме не переносится */
  const h=NP.headOf(m.slot);
  let c,full;
  if(h&&h.room){if(!goNow(h.room))return;c={x:h.p[0],z:h.p[2],yaw:yawOfQuat(h.q)};full=true;}
  else{if(m.id&&!goNow(m.id))return;c=boardCenter(E.spawn);full=false;}
  const sp=pickSpot(gatherSpots(c.x,c.z,c.yaw,full),i,(x,z)=>E.tpOk(x,z,MARGIN));
  if(!sp){E.toast('Учитель собирает всех — здесь тесно, оставайся на месте','#facc15');return;}
  const want=full?yawTo(sp.x,sp.z,c.x,c.z):0;
  let yaw=want;
  try{const ri=E.rigInfo();if(ri.xr){const hw=E.headWorld();yaw=rigYawFor(want,yawOfQuat(hw.q),ri.yaw);}}catch(e){}
  E.setPose(sp.x,sp.z,yaw);
  E.toast(full?'Учитель собрал всех рядом с собой':'Учитель собрал всех у доски','#86efac');
}
function callTo(id,why){
  const r=roomFor(id),E=S.E;if(!E)return;
  if(!r){E.toast('Учитель зовёт в «'+roomTitle(id)+'», но здесь такой комнаты нет','#fca5a5');return;}
  if(E.roomId===r)return;
  S.go={id:r,at:env.now()+GO_MS};
  E.toast((why||'Учитель зовёт')+' в «'+roomTitle(id)+'» — переход через 3 с','#facc15');
}
function onEv(m){
  if(!m||typeof m.k!=='string'||!S.E)return;
  const E=S.E,k=m.k;
  if(k==='point'){
    if(typeof m.slot!=='number')return;
    if(!m.on){delete S.points[m.slot];return;}
    const d=Array.isArray(m.d)&&normDir(m.d);
    if(!Array.isArray(m.o)||!d||!m.o.every(isFinite))return;
    S.points[m.slot]={o:m.o.slice(0,3),d,ci:m.ci|0,t:env.now()};return;
  }
  if(k==='react'){
    const e=EMOJI[m.e];if(e&&VR.netplay)VR.netplay.react(m.slot,e);return;
  }
  if(!lead(m.slot))return;                                                          /* события ведущего — только от учителя этого урока */
  const NP=VR.netplay;
  if(k==='freeze'){setFreeze(m.on===true);return;}
  if(k==='gather'){S.go=null;gather(m);return;}
  if(k==='hall'){callTo('hall','Учитель зовёт всех');return;}
  if(k==='room'){callTo(m.id,'Учитель зовёт всех');return;}
  if(k==='follow'){
    S.follow=m.on===true?m.slot:null;
    E.toast(S.follow!==null?'Следуй за учителем: перейдёшь туда, где он':'Можно не следовать за учителем',S.follow!==null?'#facc15':'#86efac');
    if(S.follow!==null){const h=NP.rosterOf(m.slot);if(h&&h.room)callTo(h.room,'Учитель');}
    return;
  }
}
function onRoster(m){
  if(!m||typeof m.slot!=='number')return;
  if(m.op==='-'){delete S.points[m.slot];if(S.follow===m.slot)S.follow=null;return;}
  if(S.follow===m.slot&&typeof m.room==='string'&&m.room!==S.lastRoom[m.slot]){S.lastRoom[m.slot]=m.room;callTo(m.room,'Учитель перешёл');}
  else if(typeof m.room==='string')S.lastRoom[m.slot]=m.room;
}
function onClosed(c){
  S.points={};S.follow=null;S.go=null;
  if(S.frozen){S.frozen=false;if(S.E)S.E.frozen=false;}
  if(c&&c.code===4012&&S.E)try{S.E.toast('Учитель убрал тебя с урока','#fca5a5');}catch(e){}
}

/* ---------- кадр ---------- */
function tick(){
  if(!S.on||!S.E)return;
  const E=S.E,net=S.net,t=env.now();
  if(S.frozen&&t-S.ftT>=FREEZE_TOAST)toastFreeze();
  if(S.go&&t>=S.go.at&&!S.frozen){const id=S.go.id;S.go=null;goNow(id);}        /* при «внимании» переход ждёт отмены */
  for(const k of Object.keys(S.points))if(t-S.points[k].t>POINT_STALE)delete S.points[k];
  /* своя указка: 10 Гц, пока включена; выключили — один раз on:false */
  let st={on:false};try{st=E.laserState();}catch(e){}
  const live=net&&net.status&&net.status().state==='on';
  if(live&&st.on){
    if(t-S.ptT>=POINT_MS){try{if(net.send({t:'ev',k:'point',on:true,o:st.o,d:st.d,ci:st.ci|0})!==false){S.ptT=t;S.ptOn=true;}}catch(e){}}
  }else if(S.ptOn){S.ptOn=false;if(live)try{net.send({t:'ev',k:'point',on:false});}catch(e){}}
}
/* указки соседей: точки вдоль луча (без поворота куба) и шар на конце; цвет — как у своей указки */
function draw(add,E){
  if(!S.on)return;
  const mesh=E.mesh,TRS=E.TRS,cols=E.LASER_COLORS||[];
  for(const k of Object.keys(S.points)){
    const p=S.points[k],o=p.o,d=p.d,len=beamLen(o,d),lc=cols[p.ci]||cols[0]||{c:[1,.1,.1]};
    const col=lc.rainbow?E.hsv(((E.t*.45)%1+1)%1,.9,1):lc.c,n=Math.min(40,Math.max(4,Math.ceil(len/.15)));
    for(let i=1;i<n;i++){const u=len*i/n;add(mesh.cube,TRS(o[0]+d[0]*u,o[1]+d[1]*u,o[2]+d[2]*u,.012,.012,.012),col,1);}
    add(mesh.sphere,TRS(o[0]+d[0]*len,o[1]+d[1]*len,o[2]+d[2]*len,.07,.07,.07),col,1);
  }
}

/* ---------- публичное ---------- */
function attach(E,net){
  detach();
  S.E=E;S.net=net;S.on=true;
  S.hs=[['welcome',w=>{S.points={};S.follow=null;onSess(w&&w.sess);}],['sess',m=>onSess(m&&m.sess)],['ev',onEv],['roster',onRoster],['closed',onClosed]];
  for(const[t,f]of S.hs)net.on(t,f);
  try{const w=net.welcome&&net.welcome();if(w)onSess(w.sess);}catch(e){}
  if(typeof E.onFrameSub==='function')E.onFrameSub(tick);
  if(!S.drawOn&&typeof E.extraDraw==='function'){S.drawOn=true;E.extraDraw(draw);}
}
function detach(){
  if(S.net)for(const[t,f]of S.hs)try{S.net.off(t,f);}catch(e){}
  if(S.E)S.E.frozen=false;
  S.hs=[];S.on=false;S.net=null;S.frozen=false;S.follow=null;S.go=null;S.points={};S.ptOn=false;
}
/* реакция: код 0..11; не чаще раза в 2 с и не во время «внимания» → true, если ушла */
function react(e){
  const t=env.now(),net=S.net;
  if(!S.on||!net||S.frozen||!(e>=0&&e<EMOJI.length)||t-S.reactT<REACT_MS)return false;
  try{if(net.status().state!=='on'||net.send({t:'ev',k:'react',e:e|0})===false)return false;}catch(x){return false;}
  S.reactT=t;try{S.E.toast('Ты: '+EMOJI[e]);}catch(x){}
  return true;
}
/* указка ученика разрешена: урок идёт, учитель не выключил указки, нет «внимания» */
function pointersOk(){try{return S.on&&!!S.net&&S.net.status().state!=='off'&&S.pointers&&!S.frozen;}catch(e){return false;}}

VR.netlead={attach,detach,tick,react,pointersOk,EMOJI,
  frozen:()=>S.frozen,following:()=>S.follow!==null,pending:()=>S.go?Object.assign({},S.go):null,points:()=>Object.assign({},S.points),
  _env:env,_state:S,_on:{ev:onEv,sess:onSess,roster:onRoster,closed:onClosed},
  _pure:{wrapPi,yawOfQuat,yawTo,fanOrder,gatherSpots,pickSpot,studentIndex,boardCenter,rigYawFor,beamLen,K:{R0,RING,GAP,GO_MS,REACT_MS}}};
})();

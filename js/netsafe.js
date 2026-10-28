/* netsafe.js — безопасность тела в сетевом уроке (шаг Н9, PLAN-network.md §7.2–7.5). Слой «модули».
   Калибровка двумя контроллерами на метках станции (A и B в 1 м), перевод физического положения local-floor ↔ рамка класса,
   потеря калибровки (событие reset, новый вход в VR, скачок головы > 0,3 м за кадр), кольца соседей (< 1,5 м — красное, < 0,8 м — мигает,
   вибрация и тихий сигнал), жёлтое кольцо «вернись на место» в режимах seat/stand, статус для кабинета учителя (ev st).
   Рамка класса: станция — точка A (x,z) и угол yaw (градусы) направления A→B; угол 0 — вдоль оси x, поворот rot() как в формулах ниже.
   Чистые функции (без DOM, сети и движка) — VR.netsafe._pure, их проверяет tests/netsafe.js. Модуль без движка тоже грузится (кабинет). */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const AB=1,AB_TOL=.05,SPREAD=.01,HOLD_MS=1000,JUMP=.3,NEAR=1.5,CLOSE=.8,STILL_R=.2,STILL_MS=3000,ST_MS=5000,ST_MIN_MS=500,CAL_MAX_MS=120000,HINT_MS=8000;
const RADIUS={seat:.5,stand:.6};
const MAX_ST=4,LIM_XZ=50;
const num=(v,d)=>{v=Number(v);return isFinite(v)?v:d;};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------- чистые функции ---------- */
/* поворот на угол a в плоскости x-z: (1,0) при a=π/2 → (0,1) */
const rot=(a,x,z)=>{const c=Math.cos(a),s=Math.sin(a);return[x*c-z*s,x*s+z*c];};
/* станции из настроек урока: старый формат Н8 (строки-имена) → в начале координат; не больше 4; пусто → одна станция «Станция 1» */
function normStations(list){
  const out=[];
  for(const it of Array.isArray(list)?list:[]){
    if(out.length>=MAX_ST)break;
    if(typeof it==='string'){const id=it.trim().slice(0,24);if(id)out.push({id,x:0,z:0,yaw:0});continue;}
    if(!it||typeof it!=='object')continue;
    const id=String(it.id||'').trim().slice(0,24)||('Станция '+(out.length+1));
    out.push({id,x:clamp(num(it.x,0),-LIM_XZ,LIM_XZ),z:clamp(num(it.z,0),-LIM_XZ,LIM_XZ),yaw:clamp(num(it.yaw,0),-360,360)});
  }
  return out.length?out:[{id:'Станция 1',x:0,z:0,yaw:0}];
}
/* разброс точек [[x,z]…]: наибольшее расстояние до среднего */
function spread(pts){
  if(!pts||!pts.length)return Infinity;
  let mx=0,mz=0;for(const p of pts){mx+=p[0];mz+=p[1];}mx/=pts.length;mz/=pts.length;
  let m=0;for(const p of pts)m=Math.max(m,Math.hypot(p[0]-mx,p[1]-mz));
  return m;
}
const mean=pts=>{let x=0,z=0;for(const p of pts){x+=p[0];z+=p[1];}return[x/pts.length,z/pts.length];};
/* a — левый контроллер на метке A, b — правый на B (local-floor, [x,z]); st — станция. → {ok,cal,d} или {ok:false,why:'dist',d}
   cal: класс = rot(r, p − a) + o; обратный перевод — fromClass */
function calibSolve(a,b,st){
  const d=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(!isFinite(d)||Math.abs(d-AB)>AB_TOL)return{ok:false,why:'dist',d};
  st=st||{id:'',x:0,z:0,yaw:0};
  const th=Math.atan2(b[1]-a[1],b[0]-a[0]),r=num(st.yaw,0)*Math.PI/180-th;
  return{ok:true,d,cal:{r,ax:a[0],az:a[1],ox:num(st.x,0),oz:num(st.z,0),st:st.id||''}};
}
/* удержание 1 с: оба разброса < 1 см, затем расстояние A–B */
function holdCheck(L,R,st){
  if(!L||!R||!L.length||!R.length)return{ok:false,why:'empty'};
  if(spread(L)>=SPREAD||spread(R)>=SPREAD)return{ok:false,why:'still'};
  return calibSolve(mean(L),mean(R),st);
}
function toClass(cal,x,z){const p=rot(cal.r,x-cal.ax,z-cal.az);return[p[0]+cal.ox,p[1]+cal.oz];}
function fromClass(cal,x,z){const p=rot(-cal.r,x-cal.ox,z-cal.oz);return[p[0]+cal.ax,p[1]+cal.az];}
/* направление взгляда (угол atan2(z,x) вектора «вперёд» = −Z головы) из кватерниона */
function headingOf(q){const fx=-2*(q[0]*q[2]+q[1]*q[3]),fz=-(1-2*(q[0]*q[0]+q[1]*q[1]));return Math.atan2(fz,fx);}
function wrapPi(a){a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;}
/* уровень кольца по физическому расстоянию: 2 — ближе 0,8 м, 1 — ближе 1,5 м, 0 — нет */
const ringLevel=d=>d<CLOSE?2:d<NEAR?1:0;
/* радиус «вернись на место»: seat 0,5, stand 0,6, walk — нет (null); неизвестный режим — как seat */
const seatRadius=mode=>mode==='walk'?null:(RADIUS[mode]||RADIUS.seat);
const isJump=(prev,cur)=>!!(prev&&cur&&Math.hypot(cur[0]-prev[0],cur[1]-prev[1])>JUMP);
/* точка «своего места»: ждём, пока голова 3 с не отходит дальше 0,2 м, — тогда это место (только если места ещё нет) */
function anchorStep(A,p,now){
  A=A||{anchor:null,win:null};
  if(!A.win||Math.hypot(p[0]-A.win.p[0],p[1]-A.win.p[1])>STILL_R)A.win={p:[p[0],p[1]],t:now};
  else if(!A.anchor&&now-A.win.t>=STILL_MS)A.anchor=[A.win.p[0],A.win.p[1]];
  return A;
}
const offSeat=(anchor,p,mode)=>{const r=seatRadius(mode);return!!(anchor&&r&&p&&Math.hypot(p[0]-anchor[0],p[1]-anchor[1])>r);};
/* сколько участников допускает площадь: seat — до 15 шлемов, stand — 2,5 м² на человека, walk — 4 м² */
const modeLimits=area=>({seat:15,stand:area>0?Math.floor(area/2.5):0,walk:area>0?Math.floor(area/4):0});
/* можно ли включить walk: площадь ≥ 4 м² на ученика и все откалиброваны */
function walkCheck(n,area,allCal){
  if(!(area>0))return{ok:false,why:'Не задана площадь'};
  if(n>0&&area/n<4)return{ok:false,why:'Тесно: '+(area/n).toFixed(1)+' м² на человека, нужно не меньше 4'};
  if(!allCal)return{ok:false,why:'Не все ученики откалиброваны'};
  return{ok:true,why:''};
}
/* ближайший откалиброванный сосед: me [x,z] в рамке класса, list [{slot,x,z,cal}] → {slot,d,level} или null */
function nearest(me,list){
  let best=null;
  for(const o of list||[]){if(!o||!o.cal)continue;const d=Math.hypot(o.x-me[0],o.z-me[1]);if(!best||d<best.d)best={slot:o.slot,d,level:ringLevel(d)};}
  return best;
}
/* статус для кабинета: изменился ли (без fps) */
const stKey=s=>[s.cal,s.off,s.near,s.vr].join(',');

/* ---------- состояние ---------- */
const env={now:()=>(typeof performance!=='undefined'?performance.now():Date.now())};
const S={on:false,E:null,net:null,cal:null,stations:normStations([]),mode:'seat',calOn:false,station:0,cap:null,needRelease:false,calT0:0,hintT:0,
  A:{anchor:null,win:null},last:null,sessRef:undefined,fps:0,near:null,rings:[],buzzT:0,beepT:0,stT:0,stKey:'',lostWhy:'',hs:[],drawOn:false,resetHooked:false};

function onSess(sess){
  if(!sess||typeof sess!=='object')return;
  if(typeof sess.mode==='string')S.mode=sess.mode;
  if(Array.isArray(sess.stations))S.stations=normStations(sess.stations);
  if(S.station>=S.stations.length)S.station=0;
}
function toast(t,c){try{if(S.E&&S.E.toast)S.E.toast(t,c);}catch(e){}}
function lose(why){
  const had=!!S.cal;
  S.cal=null;S.A={anchor:null,win:null};S.lostWhy=why;
  if(had&&netOn())toast('Калибровка сбилась. Подойди к метке и откалибруйся: меню → «Калибровка».','#fde68a');
}
function netOn(){try{const s=S.net&&S.net.status();return!!(s&&s.state!=='off');}catch(e){return false;}}
function startCal(i){
  S.station=clamp(i|0,0,S.stations.length-1);S.calOn=true;S.cap=null;S.needRelease=true;S.calT0=env.now();S.hintT=0;
}
function cancelCal(){S.calOn=false;S.cap=null;}
function trig(i){
  try{const h=S.E.H[i],gp=h&&h.src&&h.src.gamepad;return!!(gp&&gp.buttons&&gp.buttons[0]&&gp.buttons[0].pressed);}catch(e){return false;}
}
function capture(now){
  const E=S.E;
  if(now-S.calT0>CAL_MAX_MS){cancelCal();toast('Калибровка отменена: время вышло. Начни снова из меню.');return;}
  if(now-S.hintT>HINT_MS){S.hintT=now;const st=S.stations[S.station];
    toast('Калибровка «'+st.id+'»: присядь, левый контроллер на метку A, правый на B, нажми оба курка и держи 1 секунду.','#bae6fd');}
  const both=trig(0)&&trig(1);
  if(!both){S.needRelease=false;S.cap=null;return;}
  if(S.needRelease)return;
  const a=E.gripBase&&E.gripBase(0),b=E.gripBase&&E.gripBase(1);
  if(!a||!b){S.cap=null;return;}
  if(!S.cap)S.cap={t0:now,L:[],R:[]};
  S.cap.L.push([a.p[0],a.p[2]]);S.cap.R.push([b.p[0],b.p[2]]);
  if(now-S.cap.t0<HOLD_MS)return;
  const r=holdCheck(S.cap.L,S.cap.R,S.stations[S.station]);
  S.cap=null;S.needRelease=true;
  if(r.ok){
    S.cal=r.cal;S.calOn=false;S.A={anchor:null,win:null};S.lostWhy='';
    toast('Готово, ты откалиброван. Вернись на своё место.','#86efac');
    try{E.chime&&E.chime();E.buzz(E.H[0],.5,80);E.buzz(E.H[1],.5,80);}catch(e){}
  }else{
    toast(r.why==='still'?'Контроллеры двигались. Держи неподвижно и попробуй ещё раз.':'Между контроллерами '+(isFinite(r.d)?Math.round(r.d*100)+' см':'—')+', а нужно 100. Поставь точно на метки A и B.','#fca5a5');
    try{E.beep(300,.15,'sine',.05);}catch(e){}
  }
}
/* физическое положение головы сейчас: {base:[x,z], cls:[x,z]|null, yaw} или null вне VR */
function physSelf(){
  const E=S.E;if(!E||!E.session||!E.headBase)return null;
  const h=E.headBase();if(!h)return null;
  const base=[h.p[0],h.p[2]],hy=headingOf(h.q);
  return S.cal?{base,cls:toClass(S.cal,base[0],base[1]),yaw:wrapPi(hy+S.cal.r),hy}:{base,cls:null,yaw:hy,hy};
}
function tick(dt){
  if(!S.on||!S.E)return;
  const E=S.E,now=env.now();
  if(dt>0)S.fps=S.fps?S.fps*.95+(1/dt)*.05:1/dt;
  if(E.session!==S.sessRef){if(S.sessRef!==undefined)lose('xr');S.sessRef=E.session;S.last=null;if(!E.session)cancelCal();}
  const me=physSelf();
  if(!me){S.near=null;S.rings=[];sendSt(now);return;}
  if(isJump(S.last,me.base))lose('jump');
  S.last=me.base;
  S.A=anchorStep(S.A,me.base,now);
  if(S.calOn)capture(now);
  /* соседи */
  S.rings=[];S.near=null;
  if(S.cal&&VR.netplay&&VR.netplay.physAll){
    const list=VR.netplay.physAll(),mc=me.cls;
    for(const o of list){
      if(!o.cal)continue;
      const d=Math.hypot(o.x-mc[0],o.z-mc[1]),lv=ringLevel(d);
      if(!lv)continue;
      const b=fromClass(S.cal,o.x,o.z);S.rings.push({slot:o.slot,base:b,level:lv,d});
      if(!S.near||d<S.near.d)S.near={slot:o.slot,d,level:lv};
    }
  }
  if(S.near&&S.near.level===2){
    if(now-S.buzzT>400){S.buzzT=now;try{E.buzz(E.H[0],.6,60);E.buzz(E.H[1],.6,60);}catch(e){}}
    if(now-S.beepT>1000){S.beepT=now;try{E.beep(1100,.05,'sine',.025);}catch(e){}}
  }
  sendSt(now);
}
function statusNow(){
  const E=S.E,me=physSelf();
  return{cal:S.cal?1:0,off:me&&offSeat(S.A.anchor,me.base,S.mode)?1:0,near:S.near?S.near.level:0,vr:E&&E.session?1:0,fps:Math.round(S.fps||0)};
}
function sendSt(now){
  const net=S.net;if(!net)return;
  let st;try{st=net.status();}catch(e){return;}
  if(!st||st.state!=='on')return;
  const s=statusNow(),k=stKey(s);
  if((k!==S.stKey&&now-S.stT>=ST_MIN_MS)||now-S.stT>=ST_MS){
    try{if(net.send(Object.assign({t:'ev',k:'st'},s))!==false){S.stT=now;S.stKey=k;}}catch(e){}
  }
}
/* ---------- рисование (E.extraDraw, после аватаров) ---------- */
function ringDots(add,E,x,z,r,col,em,n,sz){
  const mesh=E.mesh,TRS=E.TRS;
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2;add(mesh.cube,TRS(x+Math.cos(a)*r,.02,z+Math.sin(a)*r,sz,.02,sz,-a),col,em);}
}
function draw(add,E){
  if(!S.on||!E.session)return;
  const mesh=E.mesh,TRS=E.TRS,me=physSelf();if(!me)return;
  /* своё место */
  if(S.A.anchor&&netOn()&&offSeat(S.A.anchor,me.base,S.mode)){
    const w=E.fromBase(S.A.anchor[0],S.A.anchor[1]),r=seatRadius(S.mode);
    add(mesh.circle,TRS(w[0],.015,w[1],r,1,r),[1,.85,.2],1);
    ringDots(add,E,w[0],w[1],r,[1,.85,.2],.9,16,.07);
  }
  /* соседи: на месте тела, а не аватара */
  const blink=(Math.floor((E.t||0)*4)%2)===0;
  for(const g of S.rings){
    const w=E.fromBase(g.base[0],g.base[1]),hot=g.level===2,col=hot?(blink?[1,.15,.15]:[1,.55,.55]):[.85,.15,.15],em=hot?1:.6;
    add(mesh.circle,TRS(w[0],.02,w[1],.4,1,.4),col,em);
    ringDots(add,E,w[0],w[1],.4,col,em,hot?20:14,hot?.09:.06);
    add(mesh.cyl,TRS(w[0],.9,w[1],.035,1.8,.035),col,em*.8);
  }
}

/* ---------- публичное ---------- */
function attach(E,net){
  detach();
  S.E=E;S.net=net;S.on=true;S.sessRef=E&&E.session;S.last=null;S.stT=0;S.stKey='';
  if(net){
    S.hs=[['welcome',w=>onSess(w&&w.sess)],['sess',m=>onSess(m&&m.sess)],['closed',()=>{cancelCal();}]];
    for(const[t,f]of S.hs)net.on(t,f);
    try{const w=net.welcome&&net.welcome();if(w)onSess(w.sess);}catch(e){}
  }
  if(E){
    if(typeof E.onFrameSub==='function')E.onFrameSub(tick);
    if(!S.drawOn&&typeof E.extraDraw==='function'){S.drawOn=true;E.extraDraw(draw);}
    if(!S.resetHooked&&E.hooks){S.resetHooked=true;const prev=E.hooks.onRefReset;E.hooks.onRefReset=()=>{if(prev)try{prev();}catch(e){}if(S.on)lose('reset');};}
  }
}
function detach(){
  if(S.net)for(const[t,f]of S.hs)try{S.net.off(t,f);}catch(e){}
  S.hs=[];S.on=false;S.net=null;S.cal=null;S.calOn=false;S.cap=null;S.rings=[];S.near=null;S.A={anchor:null,win:null};
}
/* для отправки позы (netplay): физическое положение в рамке класса и флаг «откалиброван»; без калибровки — local-floor */
function physOut(){
  const me=physSelf();if(!me)return null;
  return me.cls?{x:me.cls[0],z:me.cls[1],yaw:me.yaw,cal:true}:{x:me.base[0],z:me.base[1],yaw:me.yaw,cal:false};
}
function placeHere(){const me=physSelf();if(!me)return false;S.A={anchor:me.base.slice(),win:{p:me.base.slice(),t:env.now()}};return true;}

VR.netsafe={attach,detach,tick,physOut,startCal,cancelCal,placeHere,
  calibrated:()=>!!S.cal,calibrating:()=>S.calOn,stations:()=>S.stations.slice(),station:()=>S.station,mode:()=>S.mode,status:statusNow,
  _env:env,_state:S,
  _pure:{rot,normStations,spread,calibSolve,holdCheck,toClass,fromClass,headingOf,wrapPi,ringLevel,seatRadius,isJump,anchorStep,offSeat,modeLimits,walkCheck,nearest,
    K:{AB,AB_TOL,SPREAD,HOLD_MS,JUMP,NEAR,CLOSE,STILL_MS}}};
})();

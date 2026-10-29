/* einweb.js — «Эйнштейн» в обычном браузере (einstein.html): мышь, вход, гость, привязка устройства. Без движка и комнат.
   Логика головоломки — VR.einstein, журнал и настройки — VR.games, вход и привязка — VR.Store. К сети этот файл не обращается (закон А2):
   всё через Store.*. Код ученика живёт только в памяти страницы. Запуск при загрузке — в конце файла (TDZ). */
(function(){
'use strict';
const VR=window.VR,S=VR.Store,PL=VR.einplay;
const $=id=>document.getElementById(id);
const fmtT=s=>{s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
let E={student:null,pk:null,tag:'guest'};   /* E.student → VR.games.finish; нет ученика — запись в журнал не пишется */
let G=null,P=null,tickT=0,drawQ=0,press=null,loggedStu=false,fails=0,lockUntil=0,pinMem='';

function show(id){for(const k of ['eSchool','eBound','eFree','eTeacher'])$(k).hidden=k!==id;}
function prefsOf(){return VR.games.prefs(E.pk);}
function savePref(p){try{VR.games.setPrefs(E.pk,p);}catch(e){}}

/* ---------- вход ---------- */
function showEnter(msg){
  stopTick();G=null;$('game').hidden=true;$('enter').hidden=false;
  $('enterMsg').textContent=msg||'';
  for(const k of ['sErr','bErr','pErr'])$(k).textContent='';
  $('bGuest').hidden=true;$('pairForm').hidden=true;
  const sv=S.server(),self=S.studentSelf();
  if(S.account.token()){show('eTeacher');return;}
  if(sv&&sv.key){renderSchool();show('eSchool');return;}
  if(self){$('boundWho').textContent='Вы — '+self.name+(self.cls?', '+self.cls:(self.grade?', '+self.grade+' класс':''));$('bPin').value='';show('eBound');return;}
  $('pName').value=(window.matchMedia&&matchMedia('(pointer:coarse)').matches)?'Телефон':'Компьютер';
  show('eFree');
}
function renderSchool(){
  const cl=S.classes(),loose=S.studentsOf(null);
  const opts=cl.map(c=>[c.id,S.className(c)+' класс']);if(loose.length)opts.push(['-','Без класса']);
  const sel=$('selClass');sel.textContent='';
  const o0=document.createElement('option');o0.value='';o0.textContent='— выбери класс —';sel.appendChild(o0);
  for(const[v,t]of opts){const o=document.createElement('option');o.value=v;o.textContent=t;sel.appendChild(o);}
  $('sErr').textContent=opts.length?'':'Учитель ещё не добавил учеников. Можно играть гостем.';
  $('selNum').disabled=$('selPin').disabled=$('enterBtn').disabled=!opts.length;
}
async function schoolEnter(e){
  e.preventDefault();
  const v=$('selClass').value,n=$('selNum').value.trim();if(!v){$('sErr').textContent='Выбери класс.';return;}
  if(Date.now()<lockUntil){$('sErr').textContent='Слишком много попыток. Подожди '+Math.ceil((lockUntil-Date.now())/1000)+' с.';return;}
  $('sErr').textContent='';$('enterBtn').disabled=true;
  const s=/^\d{1,3}$/.test(n)?S.studentByNum(v==='-'?null:v,n):null;
  const pin=String($('selPin').value||'').trim();
  const ok=s?await S.checkStudentPin(s,pin):(await S.pinHash('none',pin),false);
  $('enterBtn').disabled=false;
  if(!ok){fails++;$('selPin').value='';if(fails>=5){lockUntil=Date.now()+30000;fails=0;}
    $('sErr').textContent=s&&s.hasPin&&!s.pinHash?'На этом устройстве вход в этот класс закрыт — войди через урок учителя.':'Неверный номер или код. Если забыл — подойди к учителю.';return;}
  fails=0;$('selPin').value='';$('selNum').value='';pinMem=pin;
  let ph='';try{ph=await S.pinHash(s.id,pin);}catch(err){}   /* хэш кода — для зачётной игры, только в памяти */
  begin({id:s.id,name:s.name,grade:s.grade,ph},s.id,s.name);
}
async function boundLogin(){
  const self=S.studentSelf();if(!self){showEnter();return;}
  const pin=$('bPin').value.trim();if(!pin){$('bErr').textContent='Введи код.';return;}
  $('bErr').textContent='';$('bGo').disabled=true;$('bGuest').hidden=true;
  let r;try{r=await S.studentLogin(pin);}catch(e){r={status:0,data:{}};}
  $('bGo').disabled=false;
  if(r.status===200){pinMem=pin;$('bPin').value='';loggedStu=true;begin({id:self.sid,name:self.name,grade:self.grade,bound:true},self.sid,self.name);return;}
  if(r.status===0){$('bErr').textContent='Нет связи с сервером.';$('bGuest').hidden=false;return;}
  if(r.status===401){showEnter('Привязка этого устройства снята. Привяжи его заново или играй гостем.');return;}
  $('bPin').value='';$('bErr').textContent=(r.data&&r.data.error)||'Не удалось войти.';
}
async function boundUnpair(){
  const pin=$('bPin').value.trim();if(!pin){$('bErr').textContent='Чтобы отвязать устройство, введи код ученика.';return;}
  if(!window.confirm('Отвязать это устройство от ученика?'))return;
  $('bErr').textContent='';
  let r;try{r=await S.studentUnpair(pin);}catch(e){r={status:0,data:{}};}
  if(r.status===403||r.status===429){$('bErr').textContent=r.status===403?'Неверный код.':'Слишком много попыток. Подожди.';return;}
  showEnter(r.data&&r.data.offline?r.data.hint:'Устройство отвязано.');
}
async function pairGo(e){
  e.preventDefault();
  const code=$('pCode').value.trim();if(!code){$('pErr').textContent='Введи код привязки.';return;}
  $('pErr').textContent='';$('pGo').disabled=true;
  let r;try{r=await S.studentPair(code,$('pName').value.trim()||'Компьютер');}catch(err){r={status:0,data:{error:'Нет связи с сервером.'}};}
  $('pGo').disabled=false;
  if(r.status===200){$('pCode').value='';showEnter('Устройство привязано. Введи код ученика, чтобы играть.');return;}
  $('pErr').textContent=(r.data&&r.data.error)||(r.status===0?'Нет связи с сервером.':'Не удалось привязать.');
}
function teacherName(){return String(S.account.who()||'').replace(/[^\w-]/g,'').slice(0,40)||'x';}

/* ---------- игра ---------- */
/* E — тот же набор, что у движка, для общего ядра (js/einplay.js): звуков и комнат в вебе нет */
const mkE=(student,pk,tag)=>({student,pk,tag,menuOpen:false,H:[],beep(){},buzz(){},fanfare(){},goRoom(){}});
/* настройки по ширине холста: широкий экран — три колонки подсказок справа, телефон — одна */
function cfgFor(w,probe){
  const wide=w>=700&&!(probe&&probe(w)<56);
  return wide?{web:true,fs:20,bh:54,T:44,fx:30,fy:28,gap:10,minCell:90,maxCell:112,cols:3,minH:560}
    :{web:true,fs:15,bh:44,T:44,fx:14,mr:4,fy:20,gap:6,minCell:56,maxCell:60,cols:1,hUnder:true,minH:520};
}
function begin(student,pkId,label){
  E=mkE(student,pkId||null,label||'Гость');
  $('enter').hidden=true;$('game').hidden=false;
  $('gWho').textContent=student?E.tag:(E.tag==='Учитель'?'Учитель (без зачёта)':'Гость (вне рейтинга)');
  G=PL.create(E,{onDirty:onDirty});G.view='web';
  P=PL.canvasPanel($('cf'));
  PL.start(E,G,undefined,false,false);
  startTick();
  try{VR.einrate.flush(E);}catch(e){}
}
function onDirty(w){
  ui();
  if(w==='ctl')return;
  if(!drawQ){drawQ=1;const f=()=>{drawQ=0;redraw();};if(window.requestAnimationFrame)requestAnimationFrame(f);else setTimeout(f,16);}
}
function logical(ev){
  const r0=$('cf').getBoundingClientRect(),k=P.W/r0.width;
  return{x:(ev.clientX-r0.left)*k,y:(ev.clientY-r0.top)*k};
}
function hit(ev){
  if(!G||!P)return -1;const q=logical(ev);
  for(let i=P.btns.length-1;i>=0;i--){const b=P.btns[i];if(q.x>=b.x&&q.x<=b.x+b.w&&q.y>=b.y&&q.y<=b.y+b.h)return i;}
  return -1;
}
function fire(i,btn){const b=P&&P.btns[i];if(!b||b.disabled)return;try{b.fn({wbtn:btn});}catch(e){}}
function onDown(ev){
  ev.preventDefault();const i=hit(ev);if(i<0)return;
  if(ev.pointerType==='mouse'){const b=ev.button===2?3:ev.button===0?1:0;if(b)fire(i,b);return;}
  clearTimeout(press&&press.t);
  const pr={i,done:false};pr.t=setTimeout(()=>{if(press===pr&&!pr.done){pr.done=true;fire(i,3);}},450);press=pr;
}
function onUp(ev){
  const pr=press;if(!pr)return;press=null;clearTimeout(pr.t);
  if(!pr.done&&hit(ev)===pr.i)fire(pr.i,1);
}
function onMove(ev){
  if(!G||ev.pointerType!=='mouse')return;const i=hit(ev);
  if(i!==P.hover){P.hover=i;redraw();}
}

/* ---------- время ---------- */
function startTick(){stopTick();G.last=performance.now();tickT=setInterval(tick,200);}
function stopTick(){if(tickT){clearInterval(tickT);tickT=0;}}
function tick(){
  if(!G)return;const now=performance.now(),dt=(now-G.last)/1000;G.last=now;
  PL.tick(E,G,Math.min(dt,1));
}

/* ---------- рисование ---------- */
function redraw(){
  if(!G||!P)return;
  const cv=$('cf'),box=cv.parentElement,cw=Math.max(300,Math.floor(box.clientWidth)||360),cfg=cfgFor(cw,x=>PL.geom(G,x,0,cfgFor(x)).cell),dpr=Math.min(2,window.devicePixelRatio||1);
  let H=Math.max(PL.geom(G,cw,0,cfg).H,cfg.minH);
  if(G.win)H=Math.max(H,cw>=700?720:880);
  const bw=Math.round(cw*dpr),bh=Math.round(H*dpr);
  if(cv.width!==bw)cv.width=bw;if(cv.height!==bh)cv.height=bh;
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
  P.W=cw;P.H=H;P.ctx=c;P.begin();
  c.clearRect(0,0,cw,H);c.fillStyle='#0f1730';c.fillRect(0,0,cw,H);
  cv.dataset.paused=G.paused&&G.phase==='play'?'1':'';
  PL.drawBoard(E,G,c,P,{x:0,y:0,w:cw,h:H},cfg);
}
function ui(){
  if(!G||!G.g)return;const live=G.phase==='play'&&G.g.status==='play';
  $('gStart').hidden=G.phase!=='idle';$('gStart').disabled=!!G.fetching;
  $('gPause').hidden=!live||!!G.tid;$('gPause').textContent=G.paused?'Продолжить':'Пауза';
  $('gOpen').hidden=!live||!!G.tid;$('gOpen').disabled=G.paused;
  $('gNew').hidden=!(G.g.status==='win'&&!G.tid);$('gNew').disabled=!!G.fetching;
  $('gMenu').hidden=G.phase==='idle'||(live&&!G.tid);$('gMenu').textContent=G.menu?'Закрыть меню':'Меню';
  $('gMsg').textContent=G.msg||(G.phase==='idle'?'Партия № '+G.g.pz.seed+'. Нажми «Начать».':'Открой все фишки: исключай лишние по подсказкам.')+(G.g.status==='play'?PL.note(E,G):'');
  $('gTime').textContent=PL.fmtT(G.t);
}

/* ---------- кнопки ---------- */
function bind(){
  $('fSchool').onsubmit=schoolEnter;
  $('sGuest').onclick=$('guestBtn').onclick=$('bGuest').onclick=()=>begin(null,null,'Гость');
  $('tGo').onclick=()=>begin(null,'t-'+teacherName(),'Учитель');
  $('bGo').onclick=boundLogin;$('bUnpair').onclick=boundUnpair;
  $('bPin').onkeydown=e=>{if(e.key==='Enter')boundLogin();};
  $('pairBtn').onclick=()=>{$('pairForm').hidden=false;$('pCode').focus();};
  $('pCancel').onclick=()=>{$('pairForm').hidden=true;$('pErr').textContent='';};
  $('pairForm').onsubmit=pairGo;
  $('gExit').onclick=()=>{if(loggedStu){loggedStu=false;try{S.studentLogout().catch(()=>{});}catch(e){}}pinMem='';showEnter();};
  $('gStart').onclick=()=>PL.begin(E,G);
  $('gPause').onclick=()=>{if(G.paused)PL.resume(G);else PL.setPause(G,true);};
  $('gMenu').onclick=()=>{if(G.menu)PL.resume(G);else PL.openMenu(G);};
  $('gNew').onclick=()=>PL.fresh(E,G);
  $('gOpen').onclick=()=>PL.openOne(E,G);
  const cf=$('cf');
  cf.addEventListener('pointerdown',onDown);
  cf.addEventListener('pointerup',onUp);
  cf.addEventListener('pointercancel',()=>{if(press){clearTimeout(press.t);press=null;}});
  cf.addEventListener('pointermove',onMove);
  cf.addEventListener('pointerleave',()=>{if(press){clearTimeout(press.t);press=null;}if(P&&P.hover!==-1){P.hover=-1;redraw();}});
  cf.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('resize',()=>{if(G)redraw();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&G&&G.phase==='play'&&G.g.status==='play'&&!G.tid&&!G.paused)PL.setPause(G,true);});
}
/* для проверок: позиции в координатах окна */
function toWin(x,y,w,h){const r0=$('cf').getBoundingClientRect(),k=r0.width/P.W;return{x:r0.left+(x+w/2)*k,y:r0.top+(y+h/2)*k};}
function cellPos(c,r,e){const s=PL.subPos(G.geo,c,r,e);return toWin(s.x,s.y,s.w,s.h);}
function btnPos(label){const b=P.btns.find(q=>(q.label||'').replace(/^[^A-Za-zА-Яа-я]+/,'')===label);return b?toWin(b.x,b.y,b.w,b.h):null;}
function pressBtn(label){const b=P.btns.find(q=>(q.label||'').replace(/^[^A-Za-zА-Яа-я]+/,'').indexOf(label)===0);if(!b||b.disabled)return false;b.fn({wbtn:1});return true;}
VR.einweb={state:()=>G,cellPos,btnPos,press:pressBtn,over:()=>P.over.slice(),E:()=>E,labels:()=>P.btns.map(b=>b.label||'').filter(Boolean),hintPos:()=>{const it=G.geo.items[0],q=toWin(it.x,it.y,it.w,it.h);return{x:q.x,y:q.y,i:it.i};}};

/* ---------- запуск (в конце файла) ---------- */
bind();showEnter();
try{if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(()=>{});}catch(e){}
})();

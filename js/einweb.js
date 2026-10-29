/* einweb.js — «Эйнштейн» в обычном браузере (einstein.html): мышь, вход, гость, привязка устройства. Без движка и комнат.
   Логика головоломки — VR.einstein, журнал и настройки — VR.games, вход и привязка — VR.Store. К сети этот файл не обращается (закон А2):
   всё через Store.*. Код ученика живёт только в памяти страницы. Запуск при загрузке — в конце файла (TDZ). */
(function(){
'use strict';
const VR=window.VR,S=VR.Store,E1=VR.einstein,N=E1.N;
const $=id=>document.getElementById(id);
const fmtT=s=>{s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const HK=[.9,1.2,1.5];
/* геометрия поля и подсказок (пиксели полотен; на экране полотна масштабируются по ширине) */
const FX=36,FY=26,CW=148,CH=108,FW=952,FH=700,HW=640;
const SUBW=(CW-8)/3,SUBH=(CH-12)/2;
const RULES=[
  'Надо открыть все фишки в квадрате 6×6. В каждой строке фишки одного типа: цифры, латинские буквы, римские цифры, кости, фигуры, математические знаки.',
  'Открывать фишки надо методом исключения. Пока фишка не открыта, на её месте показаны все возможные варианты. Левая кнопка мыши открывает фишку, правая исключает её. На сенсорном экране — как выбрано кнопкой «Касание».',
  'Вертикальная подсказка: две фишки в одной колонке. Красная двойная стрелка: фишки в соседних колонках. Три красные точки: левая фишка левее правой. Синяя стрелка над тремя фишками: средняя стоит между двумя другими, все три рядом.',
  'Использованную подсказку нажми — она потускнеет. Ошибка (убрана верная фишка или выбрана неверная) — проигрыш.'];

let E={student:null,pk:null,tag:'guest'};   /* E.student → VR.games.finish; нет ученика — запись в журнал не пишется */
let G=null,tickT=0,loggedStu=false,fails=0,lockUntil=0,pinMem='';

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
  begin({id:s.id,name:s.name,grade:s.grade},s.id,s.name);
}
async function boundLogin(){
  const self=S.studentSelf();if(!self){showEnter();return;}
  const pin=$('bPin').value.trim();if(!pin){$('bErr').textContent='Введи код.';return;}
  $('bErr').textContent='';$('bGo').disabled=true;$('bGuest').hidden=true;
  let r;try{r=await S.studentLogin(pin);}catch(e){r={status:0,data:{}};}
  $('bGo').disabled=false;
  if(r.status===200){pinMem=pin;$('bPin').value='';loggedStu=true;begin({id:self.sid,name:self.name,grade:self.grade},self.sid,self.name);return;}
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
function begin(student,pkId,label){
  E={student:student,pk:pkId||null,tag:label||'Гость'};
  $('enter').hidden=true;$('game').hidden=false;
  $('gWho').textContent=student?E.tag:(E.tag==='Учитель'?'Учитель (без зачёта)':'Гость (вне рейтинга)');
  const pf=prefsOf();
  G={g:null,t:0,sec:0,helped:false,sent:false,used:new Set(),phase:'idle',paused:false,mode:pf.mode,hk:pf.hk,msg:'',hov:null,rules:false,last:0};
  newPuzzle(undefined,false);
  startTick();
}
function newPuzzle(seed,play){
  const pz=E1.generate(seed);
  G.g=E1.newGame(pz);resetRun(play);
}
function resetRun(play){
  G.t=0;G.sec=0;G.helped=false;G.sent=false;G.used=new Set();G.paused=false;G.msg='';G.rules=false;
  G.phase=play?'play':'idle';
  redraw();
}
function finish(info){
  if(G.sent)return;G.sent=true;
  try{VR.games.finish(E,'einstein',Object.assign({seed:G.g.pz.seed,helped:G.helped,moves:G.g.moves},info));}catch(e){}
}
function pick(ev){
  if(!G||G.phase!=='play'||G.paused||G.g.status!=='play')return;
  const r0=$('cf').getBoundingClientRect(),k=FW/r0.width;
  const x=(ev.clientX-r0.left)*k,y=(ev.clientY-r0.top)*k;
  const c=Math.floor((x-FX)/CW),r=Math.floor((y-FY)/CH);
  if(c<0||c>=N||r<0||r>=N)return;
  const sx=Math.floor((x-FX-c*CW-4)/SUBW),sy=Math.floor((y-FY-r*CH-6)/SUBH);
  if(sx<0||sx>2||sy<0||sy>1)return;
  const e=sy*3+sx+1,g=G.g;
  if(g.P.defined(c,r)||!g.P.can(c,r,e))return;
  const btn=ev.pointerType==='mouse'?(ev.button===2?3:ev.button===0?1:0):(G.mode==='pick'?1:3);
  if(!btn)return;
  const res=E1.click(g,c,r,e,btn);
  if(res==='noop')return;
  if(res==='fail'){G.msg='Ошибка: так не может быть. Начни сначала или возьми новую.';finish({res:'lose'});}
  else if(res==='win'){G.msg='Готово! Все фишки открыты за '+fmtT(G.t)+(G.helped?' (с помощью — в зачёт не идёт)':'');finish({time:Math.round(G.t)});}
  redraw();
}
function hover(ev){
  if(!G||ev.pointerType!=='mouse')return;
  const r0=$('cf').getBoundingClientRect(),k=FW/r0.width,x=(ev.clientX-r0.left)*k,y=(ev.clientY-r0.top)*k;
  const c=Math.floor((x-FX)/CW),r=Math.floor((y-FY)/CH),sx=Math.floor((x-FX-c*CW-4)/SUBW),sy=Math.floor((y-FY-r*CH-6)/SUBH);
  const h=c>=0&&c<N&&r>=0&&r<N&&sx>=0&&sx<=2&&sy>=0&&sy<=1?c+','+r+','+(sy*3+sx+1):null;
  if(h!==G.hov){G.hov=h;drawField();}
}
function setPause(v){if(!G||G.phase!=='play'||G.g.status!=='play')return;G.paused=v;redraw();}

/* ---------- время ---------- */
function startTick(){stopTick();G.last=performance.now();tickT=setInterval(tick,200);}
function stopTick(){if(tickT){clearInterval(tickT);tickT=0;}}
function tick(){
  if(!G)return;const now=performance.now(),dt=(now-G.last)/1000;G.last=now;
  if(G.paused||G.phase!=='play'||G.g.status!=='play')return;
  G.t+=Math.min(dt,1);const s=Math.floor(G.t);
  if(s!==G.sec){G.sec=s;$('gTime').textContent=fmtT(G.t);}
}

/* ---------- рисование ---------- */
function redraw(){drawField();drawHints();ui();}
function pauseFill(c,w,h,sz){c.fillStyle='#0b1020';c.fillRect(0,0,w,h);c.fillStyle='#fde68a';c.font='bold '+sz+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('Пауза',w/2,h/2);}
function drawField(){
  if(!G)return;const cv=$('cf'),c=cv.getContext('2d'),g=G.g,P=g.P,over=g.status==='lose';
  const pz=G.paused&&G.phase==='play';cv.dataset.paused=pz?'1':'';
  c.clearRect(0,0,FW,FH);
  if(pz){pauseFill(c,FW,FH,90);return;}
  c.font='bold 18px sans-serif';c.fillStyle='#94a3b8';c.textAlign='center';c.textBaseline='middle';
  for(let i=0;i<N;i++)c.fillText(String(i+1),FX+i*CW+CW/2,12);
  for(let r=0;r<N;r++){
    c.fillStyle='#64748b';c.font='bold 22px sans-serif';c.textAlign='center';c.fillText('ABCDEF'[r],FX/2,FY+r*CH+CH/2);
    for(let col=0;col<N;col++){
      const x=FX+col*CW,y=FY+r*CH;
      c.fillStyle=over?'#2b1b1b':(r+col)%2?'#16213e':'#1b2a4e';c.fillRect(x+2,y+2,CW-4,CH-4);
      if(G.phase==='idle')continue;
      if(P.defined(col,r)){c.fillStyle='#14532d';c.fillRect(x+2,y+2,CW-4,CH-4);E1.drawTile(c,r,P.value(col,r),x+(CW-80)/2,y+(CH-80)/2,80,'#f0fdf4');continue;}
      c.strokeStyle='#475569';c.lineWidth=1;c.beginPath();
      for(let i=0;i<=3;i++){c.moveTo(x+4+i*SUBW,y+6);c.lineTo(x+4+i*SUBW,y+6+2*SUBH);}
      for(let j=0;j<=2;j++){c.moveTo(x+4,y+6+j*SUBH);c.lineTo(x+4+3*SUBW,y+6+j*SUBH);}
      c.stroke();
      for(let e=1;e<=N;e++){
        if(!P.can(col,r,e))continue;
        const k=e-1,tx=x+4+(k%3)*SUBW,ty=y+6+((k/3)|0)*SUBH,hov=G.hov===col+','+r+','+e&&G.phase==='play'&&g.status==='play';
        if(hov){c.fillStyle=G.mode==='pick'?'#166534':'#991b1b';c.fillRect(tx+1,ty+1,SUBW-2,SUBH-2);}
        E1.drawTile(c,r,e,tx+3,ty+3,Math.min(SUBW,SUBH)-6,hov?'#fde68a':'#cbd5e1');
      }
    }
  }
  c.strokeStyle='#e2e8f0';c.lineWidth=2.5;c.beginPath();
  for(let i=0;i<=N;i++){c.moveTo(FX+i*CW,FY);c.lineTo(FX+i*CW,FY+N*CH);c.moveTo(FX,FY+i*CH);c.lineTo(FX+N*CW,FY+i*CH);}
  c.stroke();c.lineWidth=4;c.strokeRect(FX,FY,N*CW,N*CH);
  if(G.phase==='idle'){
    c.fillStyle='rgba(8,12,28,.78)';c.fillRect(FX,FY,N*CW,N*CH);
    c.fillStyle='#fde68a';c.font='bold 44px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('Нажми «Начать»',FX+N*CW/2,FY+N*CH/2-20);
    c.fillStyle='#cbd5e1';c.font='22px sans-serif';c.fillText('Партия № '+g.pz.seed,FX+N*CW/2,FY+N*CH/2+30);
  }
}
/* раскладка подсказок: общая для рисования и нажатия */
function hintLayout(){
  const rules=G.g.pz.rules,T=Math.round(52*HK[G.hk]),horiz=[],vert=[],items=[];
  rules.forEach((s,i)=>{const k=E1.showOf(s);if(k==='horiz')horiz.push(i);else if(k==='vert')vert.push(i);});
  const BW=3*T,cw=BW+24,rh=T+14,perH=Math.max(1,Math.floor((HW-20)/cw)),vs=T+24,perV=Math.max(1,Math.floor((HW-20)/vs));
  let y=30;const heads=[];
  heads.push({t:'По горизонтали:',y:y});y+=26;
  horiz.forEach((i,k)=>items.push({i,x:10+(k%perH)*cw,y:y+((k/perH)|0)*rh,w:BW,h:T,T}));
  y+=Math.ceil(horiz.length/perH)*rh+12;
  heads.push({t:'По вертикали (в одной колонке):',y:y});y+=26;
  vert.forEach((i,k)=>items.push({i,x:10+(k%perV)*vs,y:y+((k/perV)|0)*(2*T+14),w:T,h:2*T,T}));
  y+=Math.ceil(vert.length/perV)*(2*T+14)+8;
  return{items,heads,H:Math.max(120,y)};
}
function drawHints(){
  if(!G)return;const cv=$('ch'),c=cv.getContext('2d');
  cv.hidden=G.rules;$('rules').hidden=!G.rules;if(G.rules)return;
  if(G.phase==='idle'){if(cv.height!==160)cv.height=160;c.clearRect(0,0,HW,160);c.fillStyle='#94a3b8';c.font='24px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('Подсказки появятся после «Начать»',HW/2,80);return;}
  if(G.paused){if(cv.height!==260)cv.height=260;c.clearRect(0,0,HW,260);pauseFill(c,HW,260,70);return;}
  const L=hintLayout();if(cv.height!==L.H)cv.height=L.H;
  c.clearRect(0,0,HW,L.H);
  c.fillStyle='#e8efff';c.font='bold 24px sans-serif';c.textAlign='left';c.textBaseline='middle';c.fillText('Подсказки',10,14);
  c.fillStyle='#94a3b8';c.font='18px sans-serif';for(const h of L.heads)c.fillText(h.t,10,h.y+8);
  for(const it of L.items)E1.drawHint(c,G.g.pz.rules[it.i],it.x,it.y,it.T,G.used.has(it.i));
}
function hintClick(ev){
  if(!G||G.phase!=='play'||G.paused||G.rules)return;
  const r0=$('ch').getBoundingClientRect(),k=HW/r0.width,x=(ev.clientX-r0.left)*k,y=(ev.clientY-r0.top)*k;
  for(const it of hintLayout().items)if(x>=it.x-4&&x<=it.x+it.w+4&&y>=it.y-4&&y<=it.y+it.h+4){
    if(G.used.has(it.i))G.used.delete(it.i);else G.used.add(it.i);drawHints();return;}
}
function ui(){
  if(!G)return;const play=G.phase==='play',live=play&&G.g.status==='play';
  $('gStart').hidden=G.phase!=='idle';
  $('gPause').disabled=!live;$('gPause').textContent=G.paused?'Продолжить':'Пауза';
  $('gAgain').disabled=G.phase==='idle';$('gOpen').disabled=!live||G.paused;
  $('gMode').textContent='Касание: '+(G.mode==='pick'?'выбрать фишку':'убрать фишку');
  $('gAm').disabled=G.hk<=0;$('gAp').disabled=G.hk>=HK.length-1;
  $('gRules').textContent=G.rules?'Подсказки':'Правила';
  $('gMsg').textContent=G.msg||(G.phase==='idle'?'Партия № '+G.g.pz.seed+'. Нажми «Начать».':'Открой все фишки: исключай лишние по подсказкам.');
  $('gTime').textContent=fmtT(G.t);
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
  $('gStart').onclick=()=>{if(G&&G.phase==='idle'){G.phase='play';G.t=0;G.sec=0;G.last=performance.now();redraw();}};
  $('gPause').onclick=()=>setPause(!G.paused);
  $('gAgain').onclick=()=>{G.g=E1.newGame(G.g.pz);resetRun(true);};
  $('gNew').onclick=()=>newPuzzle(undefined,true);
  $('gMode').onclick=()=>{G.mode=G.mode==='pick'?'excl':'pick';savePref({mode:G.mode});ui();};
  $('gOpen').onclick=()=>{
    if(G.g.status!=='play'||G.phase!=='play'||G.paused)return;
    G.helped=true;E1.hint(G.g);
    if(G.g.status==='win'){G.msg='Готово! Все фишки открыты за '+fmtT(G.t)+' (с помощью — в зачёт не идёт)';finish({time:Math.round(G.t)});}
    redraw();};
  $('gRules').onclick=()=>{G.rules=!G.rules;drawHints();ui();};
  $('gAm').onclick=()=>{G.hk=Math.max(0,G.hk-1);savePref({hk:G.hk});drawHints();ui();};
  $('gAp').onclick=()=>{G.hk=Math.min(HK.length-1,G.hk+1);savePref({hk:G.hk});drawHints();ui();};
  const cf=$('cf');
  cf.addEventListener('pointerdown',e=>{e.preventDefault();pick(e);});
  cf.addEventListener('pointermove',hover);
  cf.addEventListener('pointerleave',()=>{if(G&&G.hov){G.hov=null;drawField();}});
  cf.addEventListener('contextmenu',e=>e.preventDefault());
  $('ch').addEventListener('pointerdown',e=>{e.preventDefault();hintClick(e);});
  $('ch').addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&G&&!G.paused)setPause(true);});
  const ru=$('rules');ru.textContent='';for(const t of RULES){const p=document.createElement('p');p.textContent=t;ru.appendChild(p);}
}
/* для проверок: позиция фишки (c,r,e) в координатах окна */
function cellPos(c,r,e){
  const r0=$('cf').getBoundingClientRect(),k=r0.width/FW,i=e-1;
  return{x:r0.left+(FX+c*CW+4+((i%3)+.5)*SUBW)*k,y:r0.top+(FY+r*CH+6+(((i/3)|0)+.5)*SUBH)*k};
}
VR.einweb={state:()=>G,cellPos,E:()=>E,hintPos:()=>{const L=hintLayout(),it=L.items[0],r0=$('ch').getBoundingClientRect(),k=r0.width/HW;return{x:r0.left+(it.x+it.w/2)*k,y:r0.top+(it.y+it.h/2)*k,i:it.i};}};

/* ---------- запуск (в конце файла) ---------- */
bind();showEnter();
try{if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(()=>{});}catch(e){}
})();

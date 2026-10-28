/* app.js — стартовое меню: выбор ученика, запуск VR, таймер, меню в VR, итоги сеанса. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,S=VR.Store;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let E=null,xrOk=false,chosen=null,sess=null,lastStudent=null;
let netLive=null,netPin='',netCtx=null,netBound=false;  /* сеть: идущий урок класса, код ученика (только в памяти), параметры повторного билета */

function showSection(id){for(const s of['pick','ready','fb'])$(s).hidden=s!==id;$('fbOpen').hidden=id==='fb';}
/* вход: класс → ученик → код */
const LKEY='vrlesson.lastClass';
let fails=0,lockUntil=0;
function renderList(){
  const cls=S.classes(),loose=S.studentsOf(null);
  const opts=cls.map(c=>[c.id,S.className(c)+' класс']);if(loose.length)opts.push(['-','Без класса']);
  let last='';try{last=localStorage.getItem(LKEY)||'';}catch(e){}
  let want='';try{want=new URLSearchParams(location.search).get('class')||'';}catch(e){}
  const cur=want&&opts.some(o=>o[0]===want)?want:($('selClass').value||last);
  $('selClass').innerHTML='<option value="">— выбери класс —</option>'+opts.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('');
  if(opts.some(o=>o[0]===cur))$('selClass').value=cur;
  $('login').hidden=!opts.length;
  $('pickErr').textContent=opts.length?'':'Учитель ещё не добавил учеников. Можно войти гостем.';
  renderStudents();
}
/* список имён ученикам не показываем (чтобы нельзя было «снять» состав классов): класс, номер в нём и пароль */
function renderStudents(){
  const v=$('selClass').value;
  $('selNum').disabled=!v;$('selPin').disabled=!v;$('enterBtn').disabled=!v;
}
async function tryEnter(e){
  e.preventDefault();
  const v=$('selClass').value,n=$('selNum').value.trim();if(!v)return;
  if(Date.now()<lockUntil){$('pickErr').textContent='Слишком много попыток. Подожди '+Math.ceil((lockUntil-Date.now())/1000)+' с.';return;}
  $('pickErr').textContent='';$('enterBtn').disabled=true;
  const s=/^\d{1,3}$/.test(n)?S.studentByNum(v==='-'?null:v,n):null;
  const pinTyped=String($('selPin').value||'').trim();
  const ok=s?await S.checkStudentPin(s,$('selPin').value):(await S.pinHash('none',String($('selPin').value)),false);
  $('enterBtn').disabled=false;
  if(!ok){fails++;$('selPin').value='';if(fails>=5){lockUntil=Date.now()+30000;fails=0;}$('pickErr').textContent=s&&s.hasPin&&!s.pinHash?'На этом устройстве вход в этот класс закрыт — войди через урок учителя.':'Неверный номер или пароль. Если забыл — подойди к учителю.';return;}
  fails=0;$('selPin').value='';$('selNum').value='';try{localStorage.setItem(LKEY,$('selClass').value);}catch(err){}
  netPin=pinTyped;choose(s);
}
let openPick=null;
function choose(st){
  chosen=st;
  $('who').textContent=st.id?st.name:(st.role==='teacher'?'Учитель':'Гость');
  $('guestGrade').hidden=!!st.id;
  /* учитель выбирает класс для урока: свои классы и классы, где он предметник (они есть на этом устройстве после входа в кабинет) */
  const tc=st.role==='teacher'?S.classes():[];
  $('tClassP').hidden=!tc.length;
  if(tc.length){
    let last='';try{last=sessionStorage.getItem('vrl.tclass')||'';}catch(e){}
    const sel=$('tClass');sel.textContent='';
    for(const k of tc){const o=document.createElement('option');o.value=k.id;o.textContent=S.className(k)+' класс'+(S.isSub&&S.isSub(k.id)?' · предметник':'');sel.appendChild(o);}
    const o0=document.createElement('option');o0.value='';o0.textContent='Без класса (выбрать параллель)';sel.appendChild(o0);
    if(tc.some(k=>k.id===last))sel.value=last;
    const upd=()=>{$('guestGrade').hidden=!!sel.value;};sel.onchange=upd;upd();
  }
  if(st.id){const p=S.points(st.id),k=S.klass(st.classId);$('whoInfo').textContent=(k?S.className(k):st.grade)+' класс · '+D.bands[S.band(st.grade)]+' задания · '+p.total+' баллов';}
  else if(st.role==='teacher')$('whoInfo').textContent='Вы входите как учитель: указка включена, результаты не записываются. Выберите класс:';
  else $('whoInfo').textContent='Результаты гостя не сохраняются. Выбери класс для заданий:';
  $('go').textContent=xrOk?'Войти в VR':'Начать на экране';
  showSection('ready');
  netProbe(st);
}
/* урок идёт — войти: кнопка только когда сервер ответил, что у класса ученика открыт урок; иначе всё как раньше (без сети) */
function netProbe(st){
  const b=$('netGo');if(!b)return;b.hidden=true;netLive=null;
  if(!st||!st.id||!st.classId||!S.server()||!VR.net||!VR.netplay)return;
  S.sessionLive().then(r=>{
    if(chosen!==st||r.status!==200||!r.data||!Array.isArray(r.data.sessions))return;
    const l=r.data.sessions.find(x=>x&&x.class_id===st.classId&&x.kind==='lesson');
    if(l){netLive=l;b.hidden=false;}
  }).catch(()=>{});
}
function netStart(d){
  const N=VR.net,P=VR.netplay;if(!N||!P||!E||!d||!d.ticket)return false;
  try{
    if(!netBound){netBound=true;P.attach(E,N);if(VR.netsafe)VR.netsafe.attach(E,N);if(VR.netlead)VR.netlead.attach(E,N);
      N.on('status',()=>{if(E.hud)E.hud.dirty=true;});
      N.on('needTicket',async()=>{if(!netCtx)return;const r=await S.sessionTicket(netCtx.sid,netCtx.id,netCtx.pin);if(r.status===200&&r.data&&r.data.ticket)N.useTicket(r.data.ticket,r.data.hubs);});}
    N.connect({hubs:d.hubs,ticket:d.ticket,caps:{quest1:P.detectQuest1(E)}}).catch(()=>{});
    return true;
  }catch(e){return false;}
}
function netStop(){
  if(netCtx){netCtx=null;try{VR.net.close('end');}catch(e){}}
  netPin='';
}
/* цепочка: ученик выбран → код (введён при входе) → билет → подключение → обычный вход */
async function joinLive(){
  if(!netLive||!chosen||!chosen.id)return;
  const b=$('netGo');$('err').textContent='';b.disabled=true;
  const sid=netLive.id,r=await S.sessionTicket(sid,chosen.id,netPin);
  b.disabled=false;
  if(r.status!==200||!r.data||!r.data.ticket){$('err').textContent=r.status===403?'Урок не пустил: проверь код или подойди к учителю. Можно начать без урока.':'Урок сейчас недоступен. Можно начать без него.';return;}
  netCtx={sid,id:chosen.id,pin:netPin};
  netStart(r.data);
  await go();
}
function startSession(){
  if(!chosen)return;
  if(!chosen.id)chosen.grade=parseInt($('gg').value,10)||5;
  if(chosen.role==='teacher'){
    const cid=$('tClassP').hidden?'':$('tClass').value,k=cid?S.klass(cid):null;
    chosen.classId=k?k.id:null;chosen.className=k?S.className(k):'';if(k)chosen.grade=k.grade;
    try{sessionStorage.setItem('vrl.tclass',cid||'');}catch(e){}
  }
  const st=chosen.id?S.student(chosen.id):chosen;
  E.student={id:st.id||null,name:st.name,grade:st.grade};if(st.role==='teacher'){E.student.role='teacher';E.student.classId=st.classId||null;E.student.className=st.className||'';}
  E.resetGuest();
  const set=S.settings();
  sess={t0:performance.now(),limit:st.role==='teacher'?Infinity:Math.max(1,set.minutes)*60,   /* у учителя таймера нет */
    up:false,startPts:st.id?S.points(st.id).total:0,startPassed:st.id?S.points(st.id).passed:0,tests:0};
  E.loadRoom('hall');
}
async function go(){
  $('err').textContent='';
  E.audio();startSession();
  /* ссылка предпросмотра из конструктора: index.html?room=c-… сразу ведёт в комнату */
  let pv=null;try{VR.custom.refresh();pv=openPick||new URLSearchParams(location.search).get('room');if(pv&&E.rooms[pv]){E.goRoom(pv);if(new URLSearchParams(location.search).get('edit')==='1')VR.custom.startEdit(E,pv);}else pv=null;}catch(e){pv=null;}
  if(xrOk){
    try{await E.enterXR();$('ov').hidden=true;}
    catch(e){$('err').textContent=e.message;}
  }else{
    $('ov').hidden=true;$('desk').hidden=false;E.deskInput=true;
    showLockHint(!E.mouseLocked());
    if(!pv)E.toast(E.rooms.hall.hint);
  }
}
/* подсказка «щёлкни, чтобы захватить мышь»: только когда есть мышь и захват не удался или снят (Esc) */
function showLockHint(on){const h=$('lockHint');if(!h)return;h.hidden=!(on&&E.deskInput&&(typeof matchMedia!=='function'||matchMedia('(pointer:fine)').matches));}
function endSession(){
  if(!sess)return;
  netStop();
  const st=E.student;let msg='';
  if(st&&st.id){const p=S.points(st.id);msg=`${st.name}: +${p.total-sess.startPts} баллов, тестов сдано ${p.passed} из 4 (было ${sess.startPassed}).`;}
  else msg='Сеанс гостя завершён.';
  try{sessionStorage.removeItem('vrl.editor');sessionStorage.removeItem('vrl.laser');}catch(e){}
  lastStudent=E.student;sess=null;E.student=null;E.deskInput=false;if(E.unlockMouse)E.unlockMouse();showLockHint(false);$('deskPanel').hidden=true;if(E.releaseInput)E.releaseInput();E.toggleMenu(false);S.sync();
  E.loadRoom('hall');
  $('desk').hidden=true;$('ov').hidden=false;
  $('summary').textContent=msg;$('summary').hidden=false;
  chosen=null;openPick=null;renderList();showSection('pick');
}
function showSync(st){
  const el=$('sync');if(!el)return;
  const t=st.at?new Date(st.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  el.textContent=st.state==='ok'?'Сервер: синхронизировано в '+t:st.state==='err'?'Сервер недоступен ('+st.msg+'). Данные сохранены в шлеме и отправятся позже.':st.state==='wait'?'Связь с сервером…':'';
  el.className='small '+(st.state==='err'?'warn':'muted');
}
const mmss=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const left=()=>sess?sess.limit-(performance.now()-sess.t0)/1000:0;

function hooks(){
  /* значок связи: нет связи — ничего; подключение — серый; на связи — зелёный, задержка >150 мс — жёлтый */
  const netDot=()=>{try{const s=VR.net&&VR.net.status();if(!s||s.state==='off')return '';if(s.state==='on')return s.rtt>150?'#facc15':'#4ade80';return '#94a3b8';}catch(e){return '';}};
  E.hooks.hud=()=>{
    const dot=netDot();
    if(!sess||!E.student)return{a:'',b:'',dot};
    const l=left(),pts=E.student.id?S.points(E.student.id).total:0;
    if(!isFinite(l)){const d=new Date();return{a:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'),b:d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}),dot};}   /* учитель: вместо таймера часы и дата */
    return{a:(l>0?mmss(l):'Время!'),b:E.student.name.split(' ')[0]+' · '+pts+' б.',alert:l<=0,dot};
  };
  E.hooks.onFrame=()=>{
    if(!sess)return;
    const l=left();
    if(!sess.up&&l<=0){sess.up=true;E.toast('Время вышло! Закончи тест и передай шлем следующему.','#fca5a5');E.beep(520,.25);setTimeout(()=>E.beep(392,.35),260);}
    if(!E.session){$('deskHud').textContent=E.hooks.hud().a+'  ·  '+E.hooks.hud().b+'  ·  '+(E.room?E.room.title:'');}
  };
  E.hooks.onXREnd=()=>endSession();
  E.hooks.onLock=l=>showLockHint(!l&&$('deskPanel').hidden);
  /* настройки мыши и справка: окно доступно всегда (кнопка «? Управление» или клавиша H); пока оно открыто, мышь освобождена */
  const mc=Object.assign({},S.pref('mouse',{}));if(mc.smooth===.35)delete mc.smooth;/* .35 — прежнее значение по умолчанию, переходим на новое */E.setMouseCfg(mc);E.setPerf(S.pref('perf',{}));
  const syncPanel=()=>{const c=E.mouseCfg;$('mSens').value=Math.round(c.sens*100);$('mSmooth').value=Math.round(c.smooth*100);$('mInv').checked=c.invY;$('mSensV').textContent=Math.round(c.sens*100)+'%';$('mSmoothV').textContent=Math.round(c.smooth*100)+'%';};
  const syncGfx=()=>{const g=E.perf;$('gFps').checked=g.fps;$('gScale').value=Math.round(g.scale*100);$('gFov').value=g.fov;$('gWalk').value=Math.round(g.walk*100);$('gWalkV').textContent=Math.round(g.walk*100)+'%';$('gEase').checked=g.ease;$('gScaleV').textContent=Math.round(g.scale*100)+'%';$('gFovV').textContent=g.fov+'°';};
  const saveGfx=()=>S.setPref('perf',{scale:E.perf.scale,fov:E.perf.fov,fps:E.perf.fps,walk:E.perf.walk,ease:E.perf.ease});
  $('gWalk').oninput=()=>{E.setPerf({walk:$('gWalk').value/100});syncGfx();saveGfx();};$('gEase').onchange=()=>{E.setPerf({ease:$('gEase').checked});saveGfx();};
  $('gFps').onchange=()=>{E.setPerf({fps:$('gFps').checked});saveGfx();};
  $('gScale').oninput=()=>{E.setPerf({scale:$('gScale').value/100});syncGfx();saveGfx();};
  $('gFov').oninput=()=>{E.setPerf({fov:+$('gFov').value});syncGfx();saveGfx();};
  const tabBtns=()=>typeof document.querySelectorAll==='function'?Array.from(document.querySelectorAll('#deskPanel .tab')):[];
  const tab=n=>{for(const b of tabBtns())b.classList.toggle('on',b.dataset.p===n);$('pKeys').hidden=n!=='keys';$('pMouse').hidden=n!=='mouse';$('pGfx').hidden=n!=='gfx';};
  for(const b of tabBtns())b.onclick=()=>tab(b.dataset.p);
  $('resetStand').onclick=()=>{E.resetStand();helpToggle(false);};
  const saveCfg=()=>S.setPref('mouse',{sens:E.mouseCfg.sens,smooth:E.mouseCfg.smooth,invY:E.mouseCfg.invY});
  const helpToggle=on=>{const p=$('deskPanel');const open=on===undefined?p.hidden:on;p.hidden=!open;if(open){syncPanel();syncGfx();if(E.unlockMouse)E.unlockMouse();showLockHint(false);}else if(E.deskInput){if(E.lockMouse)E.lockMouse();}};
  $('helpBtn').onclick=()=>helpToggle();$('helpClose').onclick=()=>helpToggle(false);
  $('mSens').oninput=()=>{E.setMouseCfg({sens:$('mSens').value/100});syncPanel();saveCfg();};
  $('mSmooth').oninput=()=>{E.setMouseCfg({smooth:$('mSmooth').value/100});syncPanel();saveCfg();};
  $('mInv').onchange=()=>{E.setMouseCfg({invY:$('mInv').checked});saveCfg();};
  E.hooks.onMouseCfg=()=>{syncPanel();saveCfg();};
  window.addEventListener('keydown',e=>{if(e.code==='KeyH'&&E.deskInput&&!(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))&&!e.repeat){helpToggle();e.preventDefault();}});
  const rated={};  /* оценка комнаты в этом сеансе: звёзды остаются закрашенными */
  /* учитель: сессия, открытая из кабинета (ключ vrl.laser или vrl.editor с неистёкшим сроком), либо учётная запись роли «учитель» */
  /* ученик с учёткой (есть id) учителем не бывает, даже если в этой вкладке остался флаг учителя (вошёл ученик после «Назад») */
  E.hooks.isTeacher=()=>{try{if(E.student&&E.student.id)return false;return +sessionStorage.getItem('vrl.laser')>Date.now()||VR.custom.teacherOk()||(E.student&&E.student.role==='teacher');}catch(e){return false;}};
  let menuTab='main';
  /* указка ученика в сетевом уроке (Н10): учитель не выключил указки, нет «внимания» */
  E.hooks.laserOk=()=>!!(VR.netlead&&VR.netlead.pointersOk());
  const netLive=()=>{try{return !!(VR.netlead&&VR.net&&VR.net.status().state!=='off');}catch(e){return false;}};
  /* вкладка «Реакции» (Н10): 12 эмодзи над головой (раз в 2 с) и указка, если учитель разрешил */
  const reactTab=(p,W)=>{
    const NL=VR.netlead,L=NL.EMOJI,bw=(W-72-54)/4;
    p.text(NL.frozen()?'Учитель просит внимания — реакции подождут.':'Реакция появится над твоей головой на 3 секунды.',36,256,{size:28,color:'#b8c7ea',maxW:W-72});
    L.forEach((e,i)=>p.button(36+(i%4)*(bw+18),300+((i/4)|0)*120,bw,104,e,()=>{if(NL.react(i))E.toggleMenu(false);},{bg:'#1e293b',size:56}));
    const ok=E.isTeacher()||E.laserOk();
    if(ok)p.button(36,680,W-72,86,E.laser.on?'Указка: выключить':'Указка: включить (или нажми стик)',()=>{E.toggleLaser();E.menu.dirty=true;},{bg:E.laser.on?'#b91c1c':'#7f1d1d',size:30});
    else p.text('Указки сейчас выключены учителем.',36,700,{size:28,color:'#94a3b8'});
  };
  /* вкладка «Класс» планшета учителя: ученики по баллам (два столбца), сколько предметов сдано, когда занимались */
  const classTab=(p,W,kc)=>{
    if(!kc){p.text('Класс не выбран. Выберите его при входе в VR («Я учитель» → «Класс, с которым урок»).',36,270,{size:34,color:'#b8c7ea',maxW:W-72});return;}
    const L=S.studentsOf(kc.id).map(s=>({s,p:S.points(s.id),a:S.lastActive(s.id)})).sort((a,b)=>b.p.total-a.p.total);
    const act=L.filter(x=>x.a&&Date.now()-x.a<7*864e5).length,avg=L.length?Math.round(L.reduce((t,x)=>t+x.p.total,0)/L.length):0;
    p.text(S.className(kc)+' класс'+(S.isSub&&S.isSub(kc.id)?' · вы предметник':'')+' · учеников: '+L.length,36,258,{size:32,bold:true,maxW:W-72});
    p.text('Средний балл '+avg+' · занимались за неделю: '+act,36,302,{size:28,color:'#b8c7ea',maxW:W-72});
    const cw=(W-90)/2;
    L.slice(0,30).forEach((x,i)=>{const col=(i/15)|0,r=i%15,X=36+col*(cw+18),Y=350+r*34;
      p.text((i+1)+'. '+x.s.name,X,Y,{size:24,maxW:cw-130,color:'#e8efff'});
      p.text(x.p.total+' · '+x.p.passed+'✓',X+cw,Y,{size:24,align:'right',color:'#fde68a',maxW:140});});
    if(L.length>30)p.text('и ещё '+(L.length-30)+' — полный список в кабинете',36,862,{size:24,color:'#94a3b8'});
    if(!L.length)p.text('В этом классе пока нет учеников на этом устройстве.',36,360,{size:28,color:'#94a3b8',maxW:W-72});
    p.text('баллы · сдано предметов',W-36,972-40,{size:22,align:'right',color:'#64748b',maxW:500});
  };
  /* планшет ученика: свои баллы по предметам и место в классе; одноклассники — без имён (средний балл, лучший, сколько занимались) */
  const meTab=(p,W,st)=>{
    const me=S.student(st.id),pts=S.points(st.id),b=S.best(st.id),k=me&&me.classId?S.klass(me.classId):null;
    const mates=k?S.studentsOf(k.id).map(s=>({id:s.id,t:S.points(s.id).total})).sort((a,b)=>b.t-a.t):[];
    const place=mates.findIndex(x=>x.id===st.id)+1,avg=mates.length?Math.round(mates.reduce((t,x)=>t+x.t,0)/mates.length):0;
    p.text('Баллы: '+pts.total+' · сдано предметов: '+pts.passed+' · открытий: '+pts.discCount,36,256,{size:30,bold:true,maxW:W-72});
    if(k&&mates.length>1)p.text('Класс '+S.className(k)+': место '+place+' из '+mates.length+' · средний балл класса '+avg+' · лучший '+mates[0].t+(pts.total>avg?' — ты выше среднего!':''),36,300,{size:26,color:'#b8c7ea',maxW:W-72});
    else p.text('Сравнение с классом появится, когда в классе будут результаты.',36,300,{size:26,color:'#94a3b8',maxW:W-72});
    const subs=Object.keys(D.subjects).filter(x=>b[x]),cw=(W-90)/2;
    subs.slice(0,16).forEach((x,i)=>{const col=i%2,r=(i/2)|0,X=36+col*(cw+18),Y=392+r*58,o=b[x],sub=D.subjects[x];
      const ratio=o.ratio;p.ctx.fillStyle='#1e293b';p.ctx.fillRect(X,Y,cw,46);
      if(ratio!==null){p.ctx.fillStyle=ratio>=.6?'#15803d':'#a16207';p.ctx.fillRect(X,Y,Math.round(cw*ratio),46);}
      p.text(sub.title,X+12,Y+8,{size:26,maxW:cw-140,color:'#f8fafc'});
      p.text(ratio===null?'—':Math.round(ratio*100)+'%',X+cw-12,Y+8,{size:26,align:'right',maxW:120,color:'#fde68a'});});
    p.text('Зелёный — сдано (60% и выше). Баллы: лучший тест × 50 + 2 за открытие.',36,872,{size:24,color:'#94a3b8',maxW:W-72});
  };
  /* вкладка «Калибровка» (Н9, PLAN-network.md §7.2): выбор станции → калибровка двумя контроллерами; «Я на месте» — своё место для режимов seat/stand */
  const calTab=(p,W,NS)=>{
    const sts=NS.stations(),bw=(W-90)/2;
    p.text(NS.calibrated()?'Ты откалиброван. Если сдвинул центр в шлеме — откалибруйся снова.':'Нужна калибровка: так соседи видят, где ты стоишь на самом деле.',36,160,{size:30,maxW:W-72,color:NS.calibrated()?'#86efac':'#fde68a'});
    p.text('Присядь у станции, левый контроллер — на метку A, правый — на B (между ними 1 м), нажми оба курка и держи 1 секунду.',36,214,{size:28,maxW:W-72,color:'#b8c7ea'});
    sts.forEach((st,i)=>p.button(36+(i%2)*(bw+18),300+((i/2)|0)*100,bw,86,'Станция: '+st.id,()=>{NS.startCal(i);E.toggleMenu(false);},{bg:'#0f766e',size:30}));
    const y=300+Math.ceil(sts.length/2)*100+20;
    p.button(36,y,bw,86,'Я на месте',()=>{if(NS.placeHere())E.toast('Запомнил твоё место.','#86efac');E.toggleMenu(false);},{bg:'#334155',size:32});
    if(NS.calibrating())p.button(54+bw,y,bw,86,'Отменить калибровку',()=>{NS.cancelCal();E.menu.dirty=true;},{bg:'#7f1d1d',size:28});
    p.text('Режим урока: '+({seat:'сижу',stand:'стою на месте',walk:'хожу'}[NS.mode()]||NS.mode()),36,y+110,{size:28,color:'#94a3b8'});
  };
  E.hooks.menuDraw=(c,p)=>{
    const st=E.student||{name:'Гость'},W=p.W,best=st.id?S.best(st.id):null,pts=st.id?S.points(st.id):null,l=left();
    p.text(st.name,36,24,{size:52,bold:true,maxW:W-72});
    p.text((st.className?st.className+' класс · ':st.grade?st.grade+' класс · ':'')+(pts?pts.total+' баллов · ':'')+(!isFinite(l)?'без ограничения времени':l>0?'осталось '+mmss(l):'время вышло'),36,92,{size:32,color:l>0?'#b8c7ea':'#fca5a5'});
    const tch=E.isTeacher(),kc=tch&&st.classId?S.klass(st.classId):null;
    const me=!tch&&st.id;
    p.button(36,150,tch?170:me?(netLive()?(W-108)/3:(W-90)/2):W-72,86,'Холл',()=>{menuTab='main';E.toggleMenu(false);E.goRoom('hall');},{bg:'#334155',size:36,active:E.roomId==='hall',activeBg:'#1d4ed8'});
    /* безопасность (Н9): калибровка по меткам и «Я на месте» — только в шлеме и в сетевом уроке */
    const NS=VR.netsafe,calOk=!!(NS&&E.session&&VR.net&&VR.net.status().state!=='off');
    if(calOk){
      p.button(W-36-300,88,300,54,menuTab==='cal'?'← Меню':(NS.calibrated()?'Калибровка ✓':'Калибровка'),()=>{menuTab=menuTab==='cal'?'main':'cal';E.menu.dirty=true;},{bg:menuTab==='cal'?'#1d4ed8':NS.calibrated()?'#166534':'#a16207',size:28});
      if(menuTab==='cal'){calTab(p,W,NS);return;}
    }else if(menuTab==='cal')menuTab='main';
    const rx=me&&netLive();
    if(rx){
      p.button(36+2*((W-108)/3+18),150,(W-108)/3,86,menuTab==='react'?'← Меню':'Реакции 👍',()=>{menuTab=menuTab==='react'?'main':'react';E.menu.dirty=true;},{bg:menuTab==='react'?'#1d4ed8':'#7c3aed',size:32});
      if(menuTab==='react'){reactTab(p,W);return;}
    }else if(menuTab==='react')menuTab='main';
    if(me){
      p.button(rx?36+(W-108)/3+18:54+(W-90)/2,150,rx?(W-108)/3:(W-90)/2,86,menuTab==='me'?'← Меню':'Мои успехи',()=>{menuTab=menuTab==='me'?'main':'me';E.menu.dirty=true;},{bg:menuTab==='me'?'#1d4ed8':'#0f766e',size:34});
      if(menuTab==='me'){meTab(p,W,st);return;}
    }
    if(tch){
      /* планшет учителя: вкладка «Класс» — ученики выбранного при входе класса и их статистика */
      p.button(218,150,190,86,menuTab==='class'?'← Меню':(kc?'Класс '+S.className(kc):'Класс'),()=>{menuTab=menuTab==='class'?'main':'class';E.menu.dirty=true;},{bg:menuTab==='class'?'#1d4ed8':'#0f766e',size:30});
      p.button(W-36-444,150,220,86,E.laser.on?'Указка: выкл':'Указка: вкл',()=>E.toggleLaser(),{bg:E.laser.on?'#b91c1c':'#7f1d1d',size:28});
      /* цвет указки: плитка нужного цвета; «радуга» — с переливом */
      const lc=E.LASER_COLORS[E.laser.ci],cx=W-36-212,hov=p.area(cx,150,212,86,()=>E.nextLaserColor());
      const g=p.ctx,rgb=c=>'rgb('+c.map(v=>Math.round(v*255)).join(',')+')';
      let fill;if(lc.rainbow){fill=g.createLinearGradient(cx,0,cx+256,0);for(let k=0;k<=6;k++)fill.addColorStop(k/6,rgb(E.hsv(((k/6*.9+E.t*.3)%1),.9,1)));}else fill=rgb(lc.c);
      g.fillStyle=fill;g.beginPath();g.roundRect?g.roundRect(cx,150,212,86,14):g.rect(cx,150,212,86);g.fill();
      if(hov){g.strokeStyle='#fff';g.lineWidth=5;g.stroke();}
      g.font='bold 26px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle=lc.rainbow||lc.c[0]+lc.c[1]+lc.c[2]<1.6?'#0b1020':'#0b1020';g.fillText('Цвет: '+lc.n,cx+106,193);g.textAlign='left';g.textBaseline='top';
    }
    if(tch&&menuTab==='class'){classTab(p,W,kc);return;}
    const bw=(W-90)/2;
    VR.openRooms(st.grade||5).forEach((k,i)=>{
      const sub=D.subjects[k],b=best&&best[k].best!==null?' ✓':'';
      p.button(36+(i%2)*(bw+18),252+((i/2)|0)*100,bw,86,sub.title+b,()=>{E.toggleMenu(false);E.goRoom(VR.entryOf(k));},{bg:E.roomId===k||(E.roomId||'').indexOf(k+'-')===0?'#f8fafc':sub.color,fg:'#0b1020',size:36});
    });
    /* аватары по сети: личное пространство — убрать всех; кнопка есть, только когда есть связь или чужие аватары */
    try{const ns=VR.net&&VR.net.status(),NP=VR.netplay;
      if(NP&&((ns&&ns.state!=='off')||(E.peers&&E.peers.length)||NP.hidden()))p.button(W-36-300,22,300,60,NP.hidden()?'Показать всех':'Скрыть всех',()=>{NP.hideAll(!NP.hidden());E.menu.dirty=true;},{bg:NP.hidden()?'#0f766e':'#475569',size:30});
    }catch(e){}
    p.button(36,780,bw,90,'Закрыть',()=>E.toggleMenu(false),{bg:'#334155',size:38});
    p.button(54+bw,780,bw,90,'Завершить',()=>{if(E.session)E.exitXR();else endSession();},{bg:'#b91c1c',size:38});
    if(E.roomId&&E.roomId!=='hall'){
      const cr=VR.ROOMS[E.roomId];
      if(cr&&cr.custom&&VR.custom.canEdit(E,E.roomId))p.button(36,880,340,70,VR.custom.editing()===E.roomId?'Редактор открыт':'✎ Редактор комнаты',()=>{E.toggleMenu(false);VR.custom.startEdit(E,E.roomId);},{bg:'#a16207',size:32});
      else p.text('Как тебе эта комната?',36,892,{size:32,color:'#b8c7ea'});
      /* оценка комнаты: пять звёзд, при наведении закрашиваются до наведённой, по щелчку сохраняется оценка */
      const rate=n=>{const st=E.student||{};S.addFeedback({kind:'rate',room:E.roomId,rating:n,grade:st.grade||null,sid:st.id||null});rated[E.roomId]=n;E.toast('Спасибо за оценку: '+n+' из 5!');E.chime();E.menu.dirty=true;};
      const sx=400,sw=(W-sx-36)/5;let hovI=-1;
      for(let k=0;k<5;k++)if(p.area(sx+k*sw,880,sw,70,()=>rate(k+1)))hovI=k;
      const full=hovI>=0?hovI+1:(rated[E.roomId]||0);
      for(let k=0;k<5;k++){const cx=sx+k*sw+sw/2;p.ctx.font='bold 64px sans-serif';p.ctx.textAlign='center';p.ctx.textBaseline='middle';p.ctx.fillStyle=k<full?'#facc15':'#475569';p.ctx.fillText(k<full?'★':'☆',cx,915);}
      p.ctx.textAlign='left';p.ctx.textBaseline='top';
    }
    p.text('Меню: кнопка A или X',W/2,968,{size:28,align:'center',color:'#94a3b8'});
  };
  E.hooks.onRoom=()=>{E.hud.dirty=true;};
}

function bind(){
  $('selClass').onchange=()=>{renderStudents();$('pickErr').textContent='';if($('selClass').value)$('selNum').focus();};
  $('login').onsubmit=tryEnter;
  $('guestBtn').onclick=()=>choose({id:null,name:'Гость',grade:5});
  /* открытые комнаты (Б54): кнопка видна, только если сервер включил их; вход — гостем, результаты не пишутся */
  S.openList().then(r=>{if(r.status===200&&r.data.items&&r.data.items.length){$('openBtn').hidden=false;$('openBtn').onclick=()=>{
    const box=$('openBox');box.hidden=!box.hidden;const L=$('openList');L.textContent='';
    for(const it of r.data.items){const b=document.createElement('button');b.type='button';b.className='btn ghost';b.textContent=it.title;b.title=it.hint||'';b.onclick=async()=>{
      $('openErr').textContent='';const sp=await S.openRoom(it.id);if(!sp){$('openErr').textContent='Комната недоступна.';return;}
      openPick=sp.id;choose({id:null,name:'Гость',grade:5});};L.appendChild(b);}
  };}}).catch(()=>{});
  /* вход учителя: если в этой вкладке уже открыт кабинет (флаг указки) — сразу к кнопке «Войти в VR», иначе в кабинет на вход */
  const teacherIn=()=>{let ok=false;try{ok=+sessionStorage.getItem('vrl.laser')>Date.now();}catch(e){}
    if(!ok){location.href='teacher.html?vr=1';return;}choose({id:null,name:'Учитель',grade:5,role:'teacher'});};
  $('teachBtn').onclick=teacherIn;
  VR.teacherIn=teacherIn;
  $('back').onclick=()=>{chosen=null;netPin='';netLive=null;$('netGo').hidden=true;showSection('pick');};
  $('netGo').onclick=joinLive;
  $('go').onclick=go;
  $('deskExit').onclick=endSession;
  /* форма отзывов */
  let fbKind='idea',fbRating=0,fbAfter='pick';
  $('fbRoom').innerHTML='<option value="">Про всё приложение</option>'+['hall'].concat(VR.ORDER).map(k=>`<option value="${k}">${k==='hall'?'Холл':D.subjects[k].title}</option>`).join('');
  const rateHtml=()=>{$('fbRate').innerHTML='<span class="muted" style="align-self:center">Оценка:</span>'+[1,2,3,4,5].map(n=>`<button class="chip${n<=fbRating?' on':''}" data-r="${n}">${'★'.repeat(n)}</button>`).join('');};
  $('fbOpen').onclick=()=>{fbAfter=$('ready').hidden?'pick':'ready';fbKind='idea';fbRating=0;rateHtml();$('fbText').value='';$('fbMsg').textContent='';
    for(const b of $('fbKind').children)b.classList.toggle('on',b.dataset.k==='idea');
    $('fbSignL').hidden=!(lastStudent&&lastStudent.id);$('fbSign').checked=false;showSection('fb');};
  $('fbKind').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;fbKind=b.dataset.k;for(const x of $('fbKind').children)x.classList.toggle('on',x===b);};
  $('fbRate').onclick=e=>{const b=e.target.closest('[data-r]');if(!b)return;fbRating=+b.dataset.r;rateHtml();};
  $('fbCancel').onclick=()=>showSection(fbAfter);
  $('fbSend').onclick=()=>{
    const text=$('fbText').value.trim();
    if(!text&&!fbRating){$('fbMsg').textContent='Напиши пару слов или поставь оценку.';return;}
    const st=lastStudent;
    S.addFeedback({kind:fbKind,room:$('fbRoom').value||null,text,rating:fbRating||null,grade:st?st.grade:null,sid:st&&st.id&&$('fbSign').checked?st.id:null});
    $('fbMsg').textContent='Спасибо! Отзыв сохранён.';setTimeout(()=>showSection(fbAfter),1200);
  };
  window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!$('desk').hidden)endSession();});
}

async function init(){
  for(let g=1;g<=11;g++){$('gg').insertAdjacentHTML('beforeend',`<option value="${g}"${g===5?' selected':''}>${g} класс</option>`);}
  if(!S.canSave())$('status').textContent='Внимание: браузер не даёт сохранять данные (приватный режим?). Прогресс не запишется.';
  try{E=VR.createEngine($('c'));}catch(e){$('status').textContent=e.message;return;}
  E.rooms=VR.ROOMS;hooks();bind();
  E.loadRoom('hall');E.startDesk();
  renderList();showSection('pick');
  try{if(new URLSearchParams(location.search).get('as')==='teacher')VR.teacherIn();}catch(e){}
  xrOk=await E.xrSupported();
  $('mode').textContent=xrOk?'':'Шлем не найден — откроется режим экрана.';
  try{if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(()=>{});}catch(e){}
  S.onStatus(st=>{showSync(st);if(st.state==='ok'){if(!sess)renderList();for(const p of E.panels)p.dirty=true;}});
  if(S.server()){showSync({state:'wait'});S.sync();}
  setInterval(()=>{if(S.server()&&!document.hidden)S.sync();},60000);
  VR.app={E,choose,startSession,endSession,go,renderList};
}
/* возврат кнопкой «Назад» из кэша браузера: WebGL и состояние могут быть уже неживыми — перезагружаем страницу */
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
/* на экране учеников сессия учителя всегда закрыта */
/* внутри окна редактора (iframe) вкладка общая с кабинетом учителя: его сессию не трогаем */
try{if(window.self===window.top)sessionStorage.removeItem('vrl.teacher');}catch(e){}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

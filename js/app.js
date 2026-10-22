/* app.js — стартовое меню: выбор ученика, запуск VR, таймер, меню в VR, итоги сеанса. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,S=VR.Store;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let E=null,xrOk=false,chosen=null,sess=null,lastStudent=null;

function showSection(id){for(const s of['pick','ready','fb'])$(s).hidden=s!==id;$('fbOpen').hidden=id==='fb';}
/* вход: класс → ученик → код */
const LKEY='vrlesson.lastClass';
let fails=0,lockUntil=0;
function renderList(){
  const cls=S.classes(),loose=S.studentsOf(null);
  const opts=cls.map(c=>[c.id,S.className(c)+' класс']);if(loose.length)opts.push(['-','Без класса']);
  let last='';try{last=localStorage.getItem(LKEY)||'';}catch(e){}
  const cur=$('selClass').value||last;
  $('selClass').innerHTML='<option value="">— выбери класс —</option>'+opts.map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('');
  if(opts.some(o=>o[0]===cur))$('selClass').value=cur;
  $('login').hidden=!opts.length;
  $('pickErr').textContent=opts.length?'':'Учитель ещё не добавил учеников. Можно войти гостем.';
  renderStudents();
}
function renderStudents(){
  const v=$('selClass').value,st=v?S.studentsOf(v==='-'?null:v):[];
  const cur=$('selStu').value;
  $('selStu').innerHTML='<option value="">— выбери себя —</option>'+st.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if(st.some(s=>s.id===cur))$('selStu').value=cur;
  $('selStu').disabled=!v;renderPin();
}
function renderPin(){
  const s=S.student($('selStu').value);
  $('pinL').hidden=!!(s&&!s.pinHash);
  $('selPin').disabled=!s;$('enterBtn').disabled=!s;
}
async function tryEnter(e){
  e.preventDefault();
  const s=S.student($('selStu').value);if(!s)return;
  if(Date.now()<lockUntil){$('pickErr').textContent='Слишком много попыток. Подожди '+Math.ceil((lockUntil-Date.now())/1000)+' с.';return;}
  $('pickErr').textContent='';$('enterBtn').disabled=true;
  const ok=await S.checkStudentPin(s,$('selPin').value);
  $('enterBtn').disabled=false;
  if(!ok){fails++;$('selPin').value='';if(fails>=5){lockUntil=Date.now()+30000;fails=0;}$('pickErr').textContent='Неверный код. Если забыл — подойди к учителю.';return;}
  fails=0;$('selPin').value='';try{localStorage.setItem(LKEY,$('selClass').value);}catch(err){}
  choose(s);
}
function choose(st){
  chosen=st;
  $('who').textContent=st.id?st.name:'Гость';
  $('guestGrade').hidden=!!st.id;
  if(st.id){const p=S.points(st.id),k=S.klass(st.classId);$('whoInfo').textContent=(k?S.className(k):st.grade)+' класс · '+D.bands[S.band(st.grade)]+' задания · '+p.total+' баллов';}
  else $('whoInfo').textContent='Результаты гостя не сохраняются. Выбери класс для заданий:';
  $('go').textContent=xrOk?'Войти в VR':'Начать на экране';
  showSection('ready');
}
function startSession(){
  if(!chosen)return;
  if(!chosen.id)chosen.grade=parseInt($('gg').value,10)||5;
  const st=chosen.id?S.student(chosen.id):chosen;
  E.student={id:st.id||null,name:st.name,grade:st.grade};
  E.resetGuest();
  const set=S.settings();
  sess={t0:performance.now(),limit:Math.max(1,set.minutes)*60,up:false,startPts:st.id?S.points(st.id).total:0,startPassed:st.id?S.points(st.id).passed:0,tests:0};
  E.loadRoom('hall');
}
async function go(){
  $('err').textContent='';
  E.audio();startSession();
  /* ссылка предпросмотра из конструктора: index.html?room=c-… сразу ведёт в комнату */
  let pv=null;try{VR.custom.refresh();pv=new URLSearchParams(location.search).get('room');if(pv&&E.rooms[pv]){E.goRoom(pv);if(new URLSearchParams(location.search).get('edit')==='1')VR.custom.startEdit(E,pv);}else pv=null;}catch(e){pv=null;}
  if(xrOk){
    try{await E.enterXR();$('ov').hidden=true;}
    catch(e){$('err').textContent=e.message;}
  }else{
    $('ov').hidden=true;$('desk').hidden=false;E.deskInput=true;
    if(!pv)E.toast(E.rooms.hall.hint);
  }
}
function endSession(){
  if(!sess)return;
  const st=E.student;let msg='';
  if(st&&st.id){const p=S.points(st.id);msg=`${st.name}: +${p.total-sess.startPts} баллов, тестов сдано ${p.passed} из 4 (было ${sess.startPassed}).`;}
  else msg='Сеанс гостя завершён.';
  try{sessionStorage.removeItem('vrl.editor');}catch(e){}
  lastStudent=E.student;sess=null;E.student=null;E.deskInput=false;if(E.releaseInput)E.releaseInput();E.toggleMenu(false);S.sync();
  E.loadRoom('hall');
  $('desk').hidden=true;$('ov').hidden=false;
  $('summary').textContent=msg;$('summary').hidden=false;
  chosen=null;renderList();showSection('pick');
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
  E.hooks.hud=()=>{
    if(!sess||!E.student)return{a:'',b:''};
    const l=left(),pts=E.student.id?S.points(E.student.id).total:0;
    return{a:(l>0?mmss(l):'Время!'),b:E.student.name.split(' ')[0]+' · '+pts+' б.',alert:l<=0};
  };
  E.hooks.onFrame=()=>{
    if(!sess)return;
    const l=left();
    if(!sess.up&&l<=0){sess.up=true;E.toast('Время вышло! Закончи тест и передай шлем следующему.','#fca5a5');E.beep(520,.25);setTimeout(()=>E.beep(392,.35),260);}
    if(!E.session){$('deskHud').textContent=E.hooks.hud().a+'  ·  '+E.hooks.hud().b+'  ·  '+(E.room?E.room.title:'');}
  };
  E.hooks.onXREnd=()=>endSession();
  E.hooks.menuDraw=(c,p)=>{
    const st=E.student||{name:'Гость'},W=p.W,best=st.id?S.best(st.id):null,pts=st.id?S.points(st.id):null,l=left();
    p.text(st.name,36,24,{size:52,bold:true,maxW:W-72});
    p.text((st.grade?st.grade+' класс · ':'')+(pts?pts.total+' баллов · ':'')+(l>0?'осталось '+mmss(l):'время вышло'),36,92,{size:32,color:l>0?'#b8c7ea':'#fca5a5'});
    p.button(36,150,W-72,86,'Холл',()=>{E.toggleMenu(false);E.goRoom('hall');},{bg:'#334155',size:40,active:E.roomId==='hall',activeBg:'#1d4ed8'});
    const bw=(W-90)/2;
    VR.openRooms(st.grade||5).forEach((k,i)=>{
      const sub=D.subjects[k],b=best&&best[k].best!==null?' ✓':'';
      p.button(36+(i%2)*(bw+18),252+((i/2)|0)*100,bw,86,sub.title+b,()=>{E.toggleMenu(false);E.goRoom(k);},{bg:E.roomId===k?'#f8fafc':sub.color,fg:'#0b1020',size:36});
    });
    p.button(36,780,bw,90,'Закрыть',()=>E.toggleMenu(false),{bg:'#334155',size:38});
    p.button(54+bw,780,bw,90,'Завершить',()=>{if(E.session)E.exitXR();else endSession();},{bg:'#b91c1c',size:38});
    if(E.roomId&&E.roomId!=='hall'){
      const cr=VR.ROOMS[E.roomId];
      if(cr&&cr.custom&&VR.custom.teacherOk())p.button(36,880,340,70,VR.custom.editing()===E.roomId?'Редактор открыт':'Править комнату',()=>{E.toggleMenu(false);VR.custom.startEdit(E,E.roomId);},{bg:'#a16207',size:32});
      else p.text('Как тебе эта комната?',36,892,{size:32,color:'#b8c7ea'});
      const vote=k=>{const st=E.student||{};S.addFeedback({kind:k,room:E.roomId,grade:st.grade||null});E.toast('Спасибо за отзыв!');E.chime();};
      p.button(400,880,(W-436-18)/2,70,'Нравится',()=>vote('like'),{bg:'#15803d',size:32});
      p.button(418+(W-436-18)/2,880,(W-436-18)/2,70,'Не нравится',()=>vote('dislike'),{bg:'#9a3412',size:32});
    }
    p.text('Меню: кнопка A или X',W/2,968,{size:28,align:'center',color:'#94a3b8'});
  };
  E.hooks.onRoom=()=>{E.hud.dirty=true;};
}

function bind(){
  $('selClass').onchange=()=>{$('selStu').value='';renderStudents();$('pickErr').textContent='';};
  $('selStu').onchange=()=>{renderPin();$('pickErr').textContent='';if(!$('selPin').disabled&&!$('pinL').hidden)$('selPin').focus();};
  $('login').onsubmit=tryEnter;
  $('guestBtn').onclick=()=>choose({id:null,name:'Гость',grade:5});
  $('back').onclick=()=>{chosen=null;showSection('pick');};
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

/* admin.js — страница администрирования для директора и суперадмина (шаги 10–12 PLAN.md).
   Данные с сервера выводятся только через textContent. Каждый раздел в своём try/catch: сбой одного не роняет остальные (А3).
   Права проверяет сервер; кнопки лишь скрыты по роли для удобства. Запуск страницы — в конце файла. */
(function(){
'use strict';
const VR=window.VR,S=VR.Store;
const $=id=>document.getElementById(id);
function el(tag,text,attrs){const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);for(const k in attrs||{})e.setAttribute(k,attrs[k]);return e;}
const isSuper=()=>S.account.roles().some(r=>r.role==='superadmin');
const isDir=()=>S.account.roles().some(r=>r.role==='director');
const isExp=()=>S.account.roles().some(r=>r.role==='expert');
let tab='students',page=1,total=0;const SIZE=50;let casc=null,schoolsCache=[];
const fmt=ts=>ts?new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

/* ---------- общие помощники ---------- */
function say(text,bad){const m=$('msg');m.textContent=text;m.hidden=!text;m.className='note'+(bad?' err':'');}
function secErr(id,text){const e=$(id);e.textContent=text||'';e.hidden=!text;}
/* вход у нас один — в кабинете (teacher.html); здесь только перенаправляем */
function lock(text,stay){S.account.clear();$('app').hidden=true;$('lock').hidden=false;$('lockErr').textContent=text||'';if(!stay)location.replace('teacher.html?next=admin');}
/* ответ API: сессия закончилась → вход; иначе текст ошибки */
function bad(r,errId){
  if(r.data&&r.data.expired){lock('Сессия закончилась. Войдите снова.');return true;}
  if(r.status===200)return false;
  const t=r.status===0?(r.data.error||'нет связи'):r.status===404?'Эта возможность на сервере ещё не включена.':(r.data&&r.data.error)||('Ошибка '+r.status);
  if(errId)secErr(errId,t);else say(t,true);return true;
}
async function safe(name,errId,fn){try{await fn();}catch(e){secErr(errId,'Раздел «'+name+'» временно недоступен.');try{console.log(name,e);}catch(_){}}}
function dialog(title,body,okText){
  return new Promise(res=>{
    for(const old of document.querySelectorAll('.shade'))old.remove();/* одно окно за раз: старый код не остаётся под новым */
    const sh=el('div',null,{class:'shade'}),d=el('div',null,{class:'dlg'});
    d.appendChild(el('h2',title));d.appendChild(body);
    const row=el('div',null,{class:'row'}),ok=el('button',okText||'Готово',{class:'btn'}),no=el('button',okText===null?'Закрыть':'Отмена',{class:'btn ghost'});
    if(okText!==null)row.appendChild(ok);row.appendChild(no);d.appendChild(row);sh.appendChild(d);document.body.appendChild(sh);
    const done=v=>{sh.remove();res(v);};ok.onclick=()=>done(true);no.onclick=()=>done(false);
  });
}
const ask=(text)=>window.confirm(text);
function showCode(title,code,note){const b=el('div');b.appendChild(el('div',code,{class:'code'}));b.appendChild(el('p',note||'Код показывается один раз. Передайте его человеку лично.',{class:'muted small'}));return dialog(title,b,null);}
function select(items,ph){const s=el('select');VR.regions.fill(s,items,ph);return s;}
const labelled=(text,node)=>{const l=el('label',text,{class:'bdl'});l.appendChild(node);return l;};

/* ---------- люди и классы ---------- */
const COLS={students:['Имя','Класс','Школа','Код входа',''],teachers:['Имя','Логин','Роли',''],classes:['Класс','Школа','Учеников','']};
function head(cols){const t=$('tbl');t.textContent='';const tr=el('tr');for(const c of cols)tr.appendChild(el('th',c));t.appendChild(tr);return t;}
const schoolName=id=>(schoolsCache.find(s=>s.id===id)||{}).name||id;
function actions(td,list){for(const [t,fn,cls] of list){const b=el('button',t,{class:'btn '+(cls||'ghost')});b.onclick=fn;td.appendChild(b);td.appendChild(document.createTextNode(' '));}}
async function loadPeople(){
  await safe('Люди','peopleErr',async()=>{
    secErr('peopleErr','');
    const f=casc.get(),r=await S.accounts({kind:tab,region:f.region,school:f.school,class:f.class,teacher:f.teacher,q:$('fQ').value.trim(),page,size:SIZE});
    if(bad(r,'peopleErr')){head(COLS[tab]);total=0;pager();return;}
    const t=head(COLS[tab]);total=r.data.total;
    for(const it of r.data.items){
      const tr=el('tr');
      if(tab==='students'){
        tr.appendChild(el('td',it.name));tr.appendChild(el('td',it.className||'—'));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',it.hasPin?'есть':'нет'));
        const td=el('td');actions(td,[['Перенести',()=>moveStudent(it)],['Сбросить код',()=>resetPin(it)]]);tr.appendChild(td);
      }else if(tab==='teachers'){
        tr.appendChild(el('td',it.name||it.login));tr.appendChild(el('td',it.login));tr.appendChild(el('td',it.roles.map(x=>x.role+(x.school?' · '+schoolName(x.school):'')).join(', ')));
        const td=el('td');actions(td,[['Сбросить пароль',()=>resetPw(it)],['В архив',()=>archive(it),'red']]);tr.appendChild(td);
      }else{
        tr.appendChild(el('td',it.name));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',it.students));
        const td=el('td');actions(td,[['Передать учителю',()=>assignClass(it)]]);tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    if(!r.data.items.length){const tr=el('tr'),td=el('td','Ничего не найдено.',{colspan:String(COLS[tab].length),class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    pager();
  });
}
function pager(){const pages=Math.max(1,Math.ceil(total/SIZE));$('pager').textContent='Страница '+page+' из '+pages+' · всего '+total;$('prev').disabled=page<=1;$('next').disabled=page>=pages;}
async function act(name,body,okText,errId){const r=await S.admin(name,body);if(bad(r,errId))return null;if(okText)say(okText);return r.data;}
async function resetPin(it){if(!ask('Сбросить код входа ученика «'+it.name+'»? Ученик задаст новый при следующем входе.'))return;if(await act('student.pin',{student_id:it.id},'Код ученика сброшен.'))loadPeople();}
async function archive(it){if(!ask('Убрать в архив учётную запись «'+(it.name||it.login)+'»? Вход будет закрыт, данные сохранятся.'))return;if(await act('user.archive',{user_id:it.id},'Учётная запись в архиве.'))loadPeople();}
async function resetPw(it){
  if(!ask('Сбросить пароль «'+(it.name||it.login)+'»? Все его сессии закроются.'))return;
  const d=await act('password.reset',{user_id:it.id});if(d)await showCode('Код сброса пароля',d.code,'Действует 24 часа, один раз. Человек вводит его на странице входа («У меня код приглашения») и задаёт новый пароль.');
}
async function moveStudent(it){
  const o=await S.options({level:'class',parent:it.school});if(bad(o))return;
  const sel=select(o.data.items,'— выберите класс —');
  if(!await dialog('Перенести «'+it.name+'»',labelled('В класс',sel),'Перенести')||!sel.value)return;
  if(await act('student.move',{student_id:it.id,class_id:sel.value},'Ученик перенесён.'))loadPeople();
}
async function assignClass(it){
  const o=await S.options({level:'teacher',parent:it.school});if(bad(o))return;
  const sel=select(o.data.items,'— без учителя —');
  if(!await dialog('Передать класс '+it.name,labelled('Учитель',sel),'Передать'))return;
  if(await act('class.assign',{class_id:it.id,teacher_id:sel.value},'Класс передан.'))loadPeople();
}

/* ---------- приглашения ---------- */
async function loadInvites(){
  await safe('Приглашения','invErr',async()=>{
    secErr('invErr','');
    const r=await S.admin('invite.list',{});if(bad(r,'invErr'))return;
    const t=$('invTbl');t.textContent='';const h=el('tr');for(const c of['Кого','Школа','Действует до',''])h.appendChild(el('th',c));t.appendChild(h);
    for(const it of r.data.items){
      const tr=el('tr');tr.appendChild(el('td',it.role==='director'?'Директор':it.role==='expert'?'Специалист':'Учитель'));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',fmt(it.expires)));
      const td=el('td'),b=el('button','Отозвать',{class:'btn red'});b.onclick=async()=>{if(!ask('Отозвать приглашение? Код перестанет работать.'))return;const x=await S.admin('invite.revoke',{id:it.id});if(!bad(x,'invErr'))loadInvites();};td.appendChild(b);tr.appendChild(td);t.appendChild(tr);
    }
    if(!r.data.items.length){const tr=el('tr'),td=el('td','Действующих приглашений нет.',{colspan:'4',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
  });
}
async function makeInvite(){
  await safe('Приглашения','invErr',async()=>{
    secErr('invErr','');
    const role=$('invRole').value,school=$('invSchool').value;if(!school){secErr('invErr','Выберите школу.');return;}
    const body={role,school};
    if(role==='director'){const pw=el('input',null,{type:'password',autocomplete:'current-password'});if(!await dialog('Подтвердите своим паролем',labelled('Ваш пароль',pw),'Подтвердить'))return;body.password=pw.value;}
    const r=await S.admin('invite.create',body);if(bad(r,'invErr'))return;
    await showCode('Код приглашения: '+(role==='director'?'директор':role==='expert'?'специалист':'учитель')+' · '+schoolName(school),r.data.code,'Действует 7 дней, один раз. Человек вводит его на странице входа («У меня код приглашения»), задаёт логин и пароль.');loadInvites();
  });
}

/* ---------- шлемы ---------- */
async function loadDevices(){
  await safe('Шлемы','devErr',async()=>{
    secErr('devErr','');const school=$('devSchool').value;const t=$('devTbl');t.textContent='';
    if(!school){$('devInfo').textContent='Выберите школу.';$('limRow').hidden=true;return;}
    const r=await S.admin('device.list',{school});if(bad(r,'devErr'))return;
    $('devInfo').textContent='Действующих шлемов: '+r.data.active+' из '+r.data.limit+'.';
    $('limRow').hidden=!isSuper();$('devLim').value=r.data.limit;
    const h=el('tr');for(const c of['Шлем','Состояние','Последняя связь',''])h.appendChild(el('th',c));t.appendChild(h);
    for(const it of r.data.items){
      const tr=el('tr');tr.appendChild(el('td',it.name||it.id));tr.appendChild(el('td',it.status==='active'?'работает':'отозван'));tr.appendChild(el('td',fmt(it.lastSeen)));
      const td=el('td');if(it.status==='active'){const b=el('button','Отозвать',{class:'btn red'});b.onclick=async()=>{if(!ask('Отозвать шлем «'+(it.name||it.id)+'»? Его придётся привязать заново новым кодом.'))return;const x=await S.admin('device.revoke',{id:it.id});if(!bad(x,'devErr'))loadDevices();};td.appendChild(b);}tr.appendChild(td);t.appendChild(tr);
    }
    if(!r.data.items.length){const tr=el('tr'),td=el('td','Шлемов пока нет.',{colspan:'4',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
  });
}
async function deviceCode(){
  await safe('Шлемы','devErr',async()=>{
    secErr('devErr','');const school=$('devSchool').value;if(!school){secErr('devErr','Выберите школу.');return;}
    const r=await S.admin('device.code',{school,name:$('devName').value.trim()});if(bad(r,'devErr'))return;
    $('devName').value='';await showCode('Код привязки шлема',r.data.code,'Действует 10 минут, один раз. На шлеме: кабинет учителя → «Данные» → «Код привязки».');loadDevices();
  });
}

/* ---------- школы (суперадмин) ---------- */
async function loadSchools(){
  await safe('Школы','shErr',async()=>{
    secErr('shErr','');const o=await S.options({level:'school'});if(bad(o,'shErr'))return;schoolsCache=o.data.items;
    const t=$('shTbl');t.textContent='';const h=el('tr');for(const c of['Школа','Регион','Район','Код',''])h.appendChild(el('th',c));t.appendChild(h);
    for(const it of o.data.items){const tr=el('tr');tr.appendChild(el('td',it.name));tr.appendChild(el('td',it.region||'—'));tr.appendChild(el('td',it.district||'—'));tr.appendChild(el('td',it.id));
      const td=el('td');if(isSuper()){const b=el('button','Изменить',{class:'btn ghost'});b.onclick=()=>editSchool(it);td.appendChild(b);}tr.appendChild(td);t.appendChild(tr);}
    for(const id of['invSchool','devSchool'])VR.regions.fill($(id),o.data.items,'— выберите школу —',true);
    if(o.data.items.length===1){for(const id of['invSchool','devSchool'])$(id).value=o.data.items[0].id;}
    if(!$('app').hidden)fillClosedSchools();
  });
}
async function editSchool(it){
  const n=el('input',null,{maxlength:'80',value:it.name}),rg=el('input',null,{maxlength:'60',value:it.region||''}),ds=el('input',null,{maxlength:'60',value:it.district||''});
  const b=el('div');b.appendChild(labelled('Название',n));b.appendChild(labelled('Регион',rg));b.appendChild(labelled('Район',ds));
  if(!await dialog('Школа',b,'Сохранить'))return;
  const r=await S.admin('school.update',{id:it.id,name:n.value,region:rg.value.trim(),district:ds.value.trim()});if(bad(r,'shErr'))return;
  say('Сохранено.');await refreshAll();
}
/* все списки школ и фильтров — на лету, без перезагрузки страницы */
async function refreshAll(){
  await loadSchools();
  await safe('Фильтр','peopleErr',async()=>{await casc.refresh();});
  loadInvites();loadDevices();
}
async function addSchool(){
  await safe('Школы','shErr',async()=>{
    secErr('shErr','');const name=$('shName').value.trim();if(!name){secErr('shErr','Введите название школы.');return;}
    const r=await S.admin('school.create',{name,region:$('shReg').value.trim(),district:$('shDist').value.trim()});if(bad(r,'shErr'))return;
    $('shName').value='';$('shReg').value='';$('shDist').value='';say('Школа добавлена.');await refreshAll();
  });
}

/* ---------- закрытые результаты (Б56): только специалист школы и администратор ---------- */
async function loadClosed(){
  await safe('Закрытые результаты','clErr',async()=>{
    secErr('clErr','');
    const t=$('clTbl');t.textContent='';
    const r=await S.closedList($('clSchool').value);if(bad(r,'clErr'))return;
    const h=el('tr');for(const c of['Ученик','Класс','Тест','Результат','Когда'])h.appendChild(el('th',c));t.appendChild(h);
    for(const it of r.data.items){const tr=el('tr');tr.appendChild(el('td',it.student));tr.appendChild(el('td',it.grade));tr.appendChild(el('td',it.test));tr.appendChild(el('td',it.score+' из '+it.total));tr.appendChild(el('td',fmt(it.ts)));t.appendChild(tr);}
    if(!r.data.items.length){const tr=el('tr'),td=el('td','Закрытых результатов пока нет.',{colspan:'5',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
  });
}
function fillClosedSchools(){
  const s=$('clSchool'),old=$('clSchool').value;s.textContent='';
  const ids=isSuper()?schoolsCache.map(x=>[x.id,x.name]):S.account.roles().filter(r=>r.role==='expert').map(r=>[r.school,schoolName(r.school)]);
  for(const [v,n] of ids)s.appendChild(el('option',n,{value:v}));
  if(old&&ids.some(x=>x[0]===old))s.value=old;
}

/* ---------- вход и запуск ---------- */
function show(){
  $('lock').hidden=true;$('app').hidden=false;
  const roles=S.account.roles();
  if(!isSuper()&&!isDir()&&!isExp()){lock('Эта страница для директора, специалиста и администратора. Откройте кабинет учителя.',true);return;}
  const onlyExp=!isSuper()&&!isDir();
  $('who').textContent=(S.account.who()||'')+' · '+(isSuper()?'администратор':isDir()?'директор':'специалист');
  for(const id of['s-people','s-invites','s-devices'])$(id).hidden=onlyExp;
  $('s-closed').hidden=!(isSuper()||isExp());
  $('s-schools').hidden=!isSuper();
  const roleSel=$('invRole');roleSel.textContent='';for(const [v,t] of isSuper()?[['teacher','Учитель'],['director','Директор'],['expert','Специалист']]:[['teacher','Учитель'],['expert','Специалист']])roleSel.appendChild(el('option',t,{value:v}));
  say('');
  if(onlyExp){fillClosedSchools();return;}
  loadSchools().then(()=>safe('Фильтр','peopleErr',async()=>{await casc.init();})).then(()=>{loadInvites();loadDevices();fillClosedSchools();});
}
function bind(){
  $('out').onclick=async e=>{e.preventDefault();await S.account.logout();location.replace('teacher.html');};
  $('kinds').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;tab=b.dataset.k;page=1;for(const x of $('kinds').children)x.classList.toggle('on',x===b);loadPeople();};
  $('prev').onclick=()=>{if(page>1){page--;loadPeople();}};$('next').onclick=()=>{page++;loadPeople();};
  let tm=null;$('fQ').oninput=()=>{clearTimeout(tm);tm=setTimeout(()=>{page=1;loadPeople();},300);};
  $('clGo').onclick=loadClosed;$('invGo').onclick=makeInvite;$('devCode').onclick=deviceCode;$('shGo').onclick=addSchool;$('devSchool').onchange=loadDevices;
  $('devLimGo').onclick=async()=>{const r=await S.admin('school.update',{id:$('devSchool').value,device_limit:$('devLim').value});if(!bad(r,'devErr')){say('Лимит сохранён.');loadDevices();}};
  casc=VR.regions.cascade({region:$('fRegion'),district:$('fDistrict'),school:$('fSchool'),cls:$('fClass'),teacher:$('fTeacher')},()=>{page=1;loadPeople();});
}
/* вернулись на вкладку — обновляем списки (директор мог добавить школу или приглашение с другого устройства) */
let lastFocus=0;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||$('app').hidden||Date.now()-lastFocus<15000)return;lastFocus=Date.now();if(isSuper()||isDir())refreshAll().catch(()=>{});else if(isExp())fillClosedSchools();});
async function start(){
  bind();
  if(!S.base()){$('lockMsg').textContent='Откройте эту страницу с адреса вашего сервера (например, https://vrklass.ru/admin.html).';return;}
  const on=await S.account.probe(S.base());
  if(on===false){$('lockMsg').textContent='Учётные записи на сервере ещё не включены.';return;}
  if(on===null)$('lockErr').textContent='Нет связи с сервером. Проверьте сеть и обновите страницу.';
  if(S.account.token()){const r=await S.me();if(r.status===200){show();return;}S.account.clear();}
  if(on!==null)location.replace('teacher.html?next=admin');
}
/* запуск — в конце файла */
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

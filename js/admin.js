/* admin.js — страница администрирования для директора и суперадмина (шаги 10–12 PLAN.md).
   Данные с сервера выводятся только через textContent. Каждый раздел в своём try/catch: сбой одного не роняет остальные (А3).
   Права проверяет сервер; кнопки лишь скрыты по роли для удобства. Запуск страницы — в конце файла. */
(function(){
'use strict';
const VR=window.VR,S=VR.Store;
const $=id=>document.getElementById(id);
function el(tag,text,attrs){const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);for(const k in attrs||{})e.setAttribute(k,attrs[k]);return e;}
const isSuper=()=>S.account.roles().some(r=>r.role==='superadmin');
const isReg=()=>S.account.roles().some(r=>r.role==='region_admin'||r.role==='district_admin');
const isDir=()=>S.account.roles().some(r=>r.role==='director'||r.role==='region_admin'||r.role==='district_admin');  /* администратор региона или района в своих школах — как директор, плюс выше */
const ROLE_RU={superadmin:'суперадмин',region_admin:'региональный администратор',district_admin:'администратор района',director:'директор',teacher:'учитель',expert:'специалист'};
const roleText=x=>(ROLE_RU[x.role]||x.role)+(x.school?' · '+schoolName(x.school):'');
const isExp=()=>S.account.roles().some(r=>r.role==='expert');
let tab='students',view='active',shView='active',page=1,total=0;const SIZE=50;let casc=null,schoolsCache=[];
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
const COLS={students:['Имя','Класс','Школа','Код входа',''],teachers:['ФИО','Логин','Роли',''],admins:['ФИО','Логин','Роли',''],classes:['Класс','Школа','Учитель','Учеников','']};
function head(cols){const t=$('tbl');t.textContent='';const tr=el('tr');for(const c of cols)tr.appendChild(el('th',c));t.appendChild(tr);return t;}
const schoolName=id=>String(id||'').startsWith('r:')?'регион «'+id.slice(2)+'»':String(id||'').startsWith('d:')?'район «'+id.slice(2).replace('|',' / ')+'»':(schoolsCache.find(s=>s.id===id)||{}).name||id;
function actions(td,list){for(const [t,fn,cls] of list){const b=el('button',t,{class:'btn '+(cls||'ghost')});b.onclick=fn;td.appendChild(b);td.appendChild(document.createTextNode(' '));}}
async function loadPeople(){
  await safe('Люди','peopleErr',async()=>{
    secErr('peopleErr','');$('clsNew').hidden=tab!=='classes'||view!=='active';$('fRoleL').hidden=tab!=='admins';
    const f=casc.get(),r=await S.accounts({kind:tab,role:tab==='admins'?$('fRole').value:'',region:f.region,school:f.school,class:f.class,teacher:f.teacher,q:$('fQ').value.trim(),status:view,page,size:SIZE});
    if(bad(r,'peopleErr')){head(COLS[tab]);total=0;pager();return;}
    const t=head(COLS[tab]);total=r.data.total;
    for(const it of r.data.items){
      const tr=el('tr');
      if(tab==='students'){
        tr.appendChild(el('td',it.name));tr.appendChild(el('td',it.className||'—'));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',it.hasPin?'есть':'нет'));
        const td=el('td');actions(td,view==='archived'?[['Вернуть',()=>restoreStudent(it)]]:[['Перенести',()=>moveStudent(it)],['Сбросить код',()=>resetPin(it)],['В архив',()=>archiveStudent(it),'red']]);actions(td,[['Пометить на стирание',()=>markDialog('student',it.id,'ученик «'+it.name+'»')]]);if(view==='archived'&&isSuper())actions(td,[['Стереть навсегда',()=>purgeDialog('student',it.id,'ученик «'+it.name+'»'),'red']]);tr.appendChild(td);
      }else if(tab==='teachers'||tab==='admins'){
        tr.appendChild(el('td',it.name||it.login));tr.appendChild(el('td',it.login));tr.appendChild(el('td',it.roles.map(roleText).join(', ')));
        const td=el('td');actions(td,view==='archived'?[['Вернуть',()=>restoreUser(it)]]:[['Сбросить пароль',()=>resetPw(it)],['В архив',()=>archive(it),'red']]);tr.appendChild(td);
      }else{
        tr.appendChild(el('td',it.name));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',it.teacherName||'— не назначен —'));tr.appendChild(el('td',it.students));
        const td=el('td');actions(td,view==='archived'?[['Вернуть',()=>restoreClass(it)]]:[['Передать / перенести',()=>assignClass(it)],['В архив',()=>archiveClass(it),'red']]);actions(td,[['Пометить на стирание',()=>markDialog('class',it.id,'класс '+it.name)]]);if(view==='archived'&&isSuper())actions(td,[['Стереть навсегда',()=>purgeDialog('class',it.id,'класс '+it.name),'red']]);tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    if(!r.data.items.length){const tr=el('tr'),td=el('td',view==='archived'?'В архиве пусто.':'Ничего не найдено.',{colspan:String(COLS[tab].length),class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    pager();
  });
}
function pager(){const pages=Math.max(1,Math.ceil(total/SIZE));$('pager').textContent='Страница '+page+' из '+pages+' · всего '+total;$('prev').disabled=page<=1;$('next').disabled=page>=pages;}
async function act(name,body,okText,errId){const r=await S.admin(name,body);if(bad(r,errId))return null;if(okText)say(okText);return r.data;}
async function resetPin(it){if(!ask('Сбросить код входа ученика «'+it.name+'»? Ученик задаст новый при следующем входе.'))return;if(await act('student.pin',{student_id:it.id},'Код ученика сброшен.'))loadPeople();}
async function archiveStudent(it){if(!ask('Убрать ученика «'+it.name+'» в архив? Результаты сохранятся, из списков класса он пропадёт. Вернуть можно в разделе «Архив».'))return;if(await act('student.archive',{student_id:it.id},'Ученик в архиве.'))loadPeople();}
async function restoreStudent(it){if(!ask('Вернуть ученика «'+it.name+'» из архива?'))return;const d=await act('student.restore',{student_id:it.id},'Ученик возвращён.');if(d){if(d.warning==='class_archived')say('Ученик возвращён, но его класс в архиве: верните и класс.');loadPeople();}}
async function archiveClass(it){if(!ask('Убрать класс «'+it.name+'» в архив? Ученики и результаты сохранятся.'))return;if(await act('class.archive',{class_id:it.id},'Класс в архиве.'))loadPeople();}
async function restoreClass(it){if(!ask('Вернуть класс «'+it.name+'» из архива?'))return;if(await act('class.restore',{class_id:it.id},'Класс возвращён.'))loadPeople();}
async function restoreUser(it){if(!ask('Вернуть учётную запись «'+(it.name||it.login)+'» из архива?'))return;if(await act('user.restore',{user_id:it.id},'Учётная запись возвращена.'))loadPeople();}
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
/* выбор места назначения: регион → район → школа → учитель; списки приходят из Store.options и зависят друг от друга */
async function pickTarget(title,school0,teacher0,okText,top){
  const reg=select([],'— регион —'),dis=select([],'— все районы —'),sch=select([],'— выберите школу —'),tch=select([],'— без учителя —'),box=el('div');
  if(top)box.appendChild(top);
  for(const [t,n] of [['Регион',reg],['Район',dis],['Школа',sch],['Учитель',tch]])box.appendChild(labelled(t,n));
  const items=r=>r.status===200?r.data.items:[];
  const loadDis=async()=>VR.regions.fill(dis,items(await S.options({level:'district',parent:reg.value})).filter(x=>x.id),'— все районы —');
  const loadSch=async()=>VR.regions.fill(sch,items(await S.options({level:'school',parent:reg.value,district:dis.value})),'— выберите школу —');
  const loadT=async()=>VR.regions.fill(tch,sch.value?items(await S.options({level:'teacher',parent:sch.value})):[],'— без учителя —');
  reg.onchange=async()=>{await loadDis();await loadSch();await loadT();};dis.onchange=async()=>{await loadSch();await loadT();};sch.onchange=loadT;
  const s0=schoolsCache.find(x=>x.id===school0)||{};
  VR.regions.fill(reg,items(await S.options({level:'region'})),'— регион —');
  if(s0.id!==undefined&&Array.from(reg.options).some(o=>o.value===(s0.region||'')))reg.value=s0.region||'';
  await loadDis();dis.value=s0.district||'';await loadSch();if(school0)sch.value=school0;await loadT();if(teacher0)tch.value=teacher0;
  if(!await dialog(title,box,okText))return null;
  if(!sch.value){say('Выберите школу.');return null;}
  return {school:sch.value,teacher:tch.value};
}
async function assignClass(it){
  const r=await pickTarget('Передать класс '+it.name,it.school,it.teacherId,'Передать');if(!r)return;
  const moved=r.school!==it.school;
  if(moved&&!ask('Класс '+it.name+' переедет в школу «'+schoolName(r.school)+'» вместе со всеми учениками. Продолжить?'))return;
  const d=moved?await act('class.move',{class_id:it.id,school_id:r.school,teacher_id:r.teacher},'Класс перенесён.'):await act('class.assign',{class_id:it.id,teacher_id:r.teacher},'Класс передан.');
  if(d)loadPeople();
}
async function createClass(){
  const top=el('div'),g=el('select'),l=el('input',null,{maxlength:'4',placeholder:'А',style:'width:5em'});
  for(let i=1;i<=11;i++)g.appendChild(el('option',String(i),{value:String(i)}));
  top.appendChild(labelled('Параллель',g));top.appendChild(labelled('Буква',l));
  const f=casc.get(),r=await pickTarget('Новый класс',f.school||(schoolsCache[0]||{}).id,'', 'Создать',top);if(!r)return;
  if(!l.value.trim()){say('Укажите букву класса.');return;}
  if(await act('class.create',{grade:g.value,letter:l.value,school_id:r.school,teacher_id:r.teacher},'Класс создан.'))loadPeople();
}

/* ---------- приглашения ---------- */
async function loadInvites(){
  await safe('Приглашения','invErr',async()=>{
    secErr('invErr','');
    const r=await S.admin('invite.list',{});if(bad(r,'invErr'))return;
    const t=$('invTbl');t.textContent='';const h=el('tr');for(const c of['Кого','Школа','Действует до',''])h.appendChild(el('th',c));t.appendChild(h);
    for(const it of r.data.items){
      const tr=el('tr');tr.appendChild(el('td',(ROLE_RU[it.role]||it.role)));tr.appendChild(el('td',schoolName(it.school)));tr.appendChild(el('td',fmt(it.expires)));
      const td=el('td'),b=el('button','Отозвать',{class:'btn red'});b.onclick=async()=>{if(!ask('Отозвать приглашение? Код перестанет работать.'))return;const x=await S.admin('invite.revoke',{id:it.id});if(!bad(x,'invErr'))loadInvites();};td.appendChild(b);tr.appendChild(td);t.appendChild(tr);
    }
    if(!r.data.items.length){const tr=el('tr'),td=el('td','Действующих приглашений нет.',{colspan:'4',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
  });
}
async function makeInvite(){
  await safe('Приглашения','invErr',async()=>{
    secErr('invErr','');
    const role=$('invRole').value;let school=$('invSchool').value;const body={role};
    if(role==='region_admin'||role==='district_admin'){
      const rs=el('select'),ds=el('select'),box=el('div'),uniq=a=>[...new Set(a.filter(Boolean))].map(r=>({id:r,name:r}));
      VR.regions.fill(rs,uniq(schoolsCache.map(s=>s.region)),'— регион —');VR.regions.fill(ds,[],'— район —');
      rs.onchange=()=>VR.regions.fill(ds,uniq(schoolsCache.filter(s=>s.region===rs.value).map(s=>s.district)),'— район —');
      box.appendChild(labelled('Регион',rs));if(role==='district_admin')box.appendChild(labelled('Район',ds));
      if(!await dialog(role==='region_admin'?'Для какого региона':'Для какого района',box,'Дальше')||!rs.value||(role==='district_admin'&&!ds.value)){secErr('invErr','Выберите область.');return;}
      body.region=rs.value;school=role==='region_admin'?'r:'+rs.value:'d:'+rs.value+'|'+ds.value;if(role==='district_admin')body.district=ds.value;}
    else{if(!school){secErr('invErr','Выберите школу.');return;}body.school=school;}
    if(role==='director'||role==='region_admin'||role==='district_admin'){const pw=el('input',null,{type:'password',autocomplete:'current-password'});if(!await dialog('Подтвердите своим паролем',labelled('Ваш пароль',pw),'Подтвердить'))return;body.password=pw.value;}
    const r=await S.admin('invite.create',body);if(bad(r,'invErr'))return;
    await showCode('Код приглашения: '+(ROLE_RU[role]||role)+' · '+schoolName(school),r.data.code,'Действует 7 дней, один раз. Человек вводит его на странице входа («У меня код приглашения»), задаёт логин и пароль.');loadInvites();
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
    const shown=o.data.items.filter(x=>shView==='archived'?x.status==='archived':x.status!=='archived');
    for(const it of shown){const tr=el('tr');tr.appendChild(el('td',it.name));tr.appendChild(el('td',it.region||'—'));tr.appendChild(el('td',it.district||'—'));tr.appendChild(el('td',it.id));
      const td=el('td');if(isSuper()){
        if(shView==='archived')actions(td,[['Вернуть',()=>setSchoolStatus(it,'active')],['Стереть навсегда',()=>purgeDialog('school',it.id,'школа «'+it.name+'»'),'red']]);
        else{actions(td,[['Изменить',()=>editSchool(it)]]);if(it.id!=='school-default')actions(td,[['В архив',()=>setSchoolStatus(it,'archived'),'red']]);}
      }tr.appendChild(td);t.appendChild(tr);}
    if(!shown.length){const tr=el('tr'),td=el('td',shView==='archived'?'В архиве пусто.':'Школ нет.',{colspan:'5',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    for(const id of['invSchool','devSchool'])VR.regions.fill($(id),o.data.items,'— выберите школу —',true);
    if(o.data.items.length===1){for(const id of['invSchool','devSchool'])$(id).value=o.data.items[0].id;}
    if(!$('app').hidden){fillClosedSchools();fillHistSchools();}
  });
}
async function setSchoolStatus(it,status){
  if(!ask(status==='archived'?'Убрать школу «'+it.name+'» в архив? Вход шлемов и учителей школы закроется, данные сохранятся.':'Вернуть школу «'+it.name+'» из архива?'))return;
  const r=await S.admin('school.update',{id:it.id,status});if(bad(r,'shErr'))return;
  say(status==='archived'?'Школа в архиве.':'Школа возвращена.');await refreshAll();
}
async function editSchool(it){
  const n=el('input',null,{maxlength:'80',value:it.name}),rg=el('input',null,{maxlength:'60',value:it.region||''}),ds=el('input',null,{maxlength:'60',value:it.district||''});
  const b=el('div');b.appendChild(labelled('Название',n));b.appendChild(labelled('Регион',rg));
  const dl=el('datalist',null,{id:'dsList'});for(const d of [...new Set((schoolsCache||[]).map(s=>s.district).filter(Boolean))])dl.appendChild(el('option',null,{value:d}));ds.setAttribute('list','dsList');
  b.appendChild(labelled('Район',ds));b.appendChild(dl);
  const clr=el('button','Убрать район',{class:'btn ghost',id:'dsClear',type:'button'});clr.onclick=()=>{ds.value='';};b.appendChild(clr);
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

/* ---------- корзина (директор и выше) ---------- */
const TRASH_RU={test:'Тест',feedback:'Отзыв',result:'Результат',room:'Комната',open_room:'Открытая комната'},TRASH_BACK=['test','feedback','room'];
let trPage=1;
async function loadTrash(more){
  await safe('Корзина','trErr',async()=>{
    secErr('trErr','');if(!more)trPage=1;else trPage++;
    const t=$('trTbl');
    const r=await S.admin('trash.list',{kind:$('trKind').value,school:$('trSchool').value,page:trPage,size:50});
    if(r.data&&r.data.expired){lock('Сессия закончилась. Войдите снова.');return;}
    if(r.status!==200){if(!more){t.textContent='';}$('trMore').hidden=true;secErr('trErr','Раздел «Корзина» временно недоступен.');return;}
    if(!more){t.textContent='';const h=el('tr');for(const c of['Вид','Название','Школа','Удалено','Кем',''])h.appendChild(el('th',c));t.appendChild(h);}
    for(const it of r.data.items){
      const tr=el('tr');tr.appendChild(el('td',TRASH_RU[it.kind]||it.kind));tr.appendChild(el('td',it.title||'—'));tr.appendChild(el('td',it.school?schoolName(it.school):'—'));tr.appendChild(el('td',fmt(it.ts)));tr.appendChild(el('td',it.by==='user'?'пользователь':it.by==='device'?'шлем':it.by||'—'));
      const td=el('td');
      if(it.restored_at)td.appendChild(el('span','возвращено '+fmt(it.restored_at),{class:'muted small'}));
      else if(TRASH_BACK.includes(it.kind))actions(td,[['Вернуть копию',()=>restoreTrash(it)]]);
      actions(td,[['Пометить на стирание',()=>markDialog('trash',it.kind+':'+it.id,(TRASH_RU[it.kind]||it.kind)+' «'+(it.title||'—')+'»')]]);
      if(isSuper())actions(td,[['Стереть навсегда',()=>purgeDialog('trash',it.kind+':'+it.id,(TRASH_RU[it.kind]||it.kind)+' «'+(it.title||'—')+'»'),'red']]);
      tr.appendChild(td);t.appendChild(tr);
    }
    if(!more&&!r.data.items.length){const tr=el('tr'),td=el('td','Корзина пуста.',{colspan:'6',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    $('trMore').hidden=!r.data.more;
  });
}
async function restoreTrash(it){
  if(!ask('Вернуть копию «'+(it.title||TRASH_RU[it.kind]||it.kind)+'»? Появится новая запись, в корзине она останется отмеченной как возвращённая.'))return;
  const r=await S.admin('trash.restore',{kind:it.kind,id:it.id});if(bad(r,'trErr'))return;
  say('Копия возвращена.');loadTrash();
}

/* ---------- окончательное стирание и пометки (Б74.2, Б74.8): стирает только суперадмин, пароль вводится заново; остальные помечают ---------- */
const PURGE_UNITS=[['students','учеников'],['results','результатов'],['disc','открытий'],['feedback_anonymized','отзывов станут анонимными'],['bytes','байт файла']];
const MARK_RU={student:'Ученик',class:'Класс',school:'Школа',upload:'Файл',trash:'Корзина'};
const fmtDay=ts=>ts?new Date(ts).toLocaleDateString('ru-RU'):'—';
function refreshLists(){for(const f of[loadPeople,loadSchools,()=>loadTrash(),()=>loadMarks()])try{Promise.resolve(f()).catch(()=>{});}catch(_){}}
async function purgeDialog(kind,id,label){
  const pv=await S.admin('purge.preview',{kind,ids:[id]});
  if(bad(pv,null))return;
  const d=pv.data,it=d.items[0]||{},b=el('div');
  b.appendChild(el('p','Будет стёрто навсегда: '+label+'.'));
  const parts=PURGE_UNITS.filter(u=>(d.total||{})[u[0]]>0).map(u=>d.total[u[0]]+' '+u[1]);
  if(parts.length)b.appendChild(el('p','Вместе с ним: '+parts.join(', ')+'.'));
  if(d.can)b.appendChild(el('p','Выдержка в архиве прошла (с '+fmtDay(it.from)+').',{class:'muted small'}));
  else b.appendChild(el('p',(it.error||'Сейчас стереть нельзя.')+(it.from?' Стирать можно с '+fmtDay(it.from)+'.':''),{class:'note err'}));
  b.appendChild(el('p','Это нельзя отменить. Перед стиранием сервер сделает копию базы. Файлы есть только в ночной копии (14 дней). Стёртые данные остаются в копиях базы, пока их не удалит владелец.',{class:'muted small'}));
  const pw=el('input',null,{type:'password',inputmode:'text',autocomplete:'current-password',maxlength:'200',id:'prgPw'});
  b.appendChild(labelled('Ваш пароль для подтверждения',pw));
  const pr=dialog('Стереть навсегда',b,'Стереть навсегда');
  const okb=document.querySelector('.shade .row .btn:not(.ghost)');okb.disabled=true;
  pw.oninput=()=>{okb.disabled=!(pw.value&&d.can);};
  const yes=await pr;const pass=pw.value;pw.value='';
  if(!yes)return;
  const r=await S.admin('purge',{kind,ids:[id],password:pass});
  if(r.status===429){say('Слишком часто, подождите минуту.',true);return;}
  if(r.status===403){say('Пароль не подошёл или нет прав.',true);return;}
  if(bad(r,null))return;
  say('Стёрто навсегда. Копия базы перед стиранием: '+r.data.backup+(r.data.lost&&r.data.lost.length?'. Файл удалить не удалось: '+r.data.lost.join(', '):'')+'.');
  refreshLists();
}
async function markDialog(kind,id,label){
  const b=el('div'),why=el('input',null,{maxlength:'200',placeholder:'например, ушёл из школы',id:'mkWhy'});
  b.appendChild(el('p',label+' будет помечен на стирание. Сам объект не меняется; решение примет суперадмин.'));
  b.appendChild(labelled('Почему',why));
  b.appendChild(el('p','Не пишите ФИО и другие личные данные: причина видна в списке пометок и в журнале.',{class:'muted small'}));
  if(!await dialog('Пометить на стирание',b,'Пометить'))return;
  const r=await S.admin('purge.mark',{kind,id,why:why.value});
  if(bad(r,null))return;
  say(r.data.already?'Уже помечено.':'Помечено на стирание.');loadMarks().catch(()=>{});
}
let mkPage=1;
async function archiveMark(it){
  if(!ask('Убрать в архив: '+(it.name||it.id)+'?'))return;
  const m={student:['student.archive',{student_id:it.id}],class:['class.archive',{class_id:it.id}],school:['school.update',{id:it.id,status:'archived'}],upload:['upload.delete',{id:it.id}]}[it.kind];
  if(m&&await act(m[0],m[1],'Убрано в архив.',null))refreshLists();
}
async function loadMarks(more){
  await safe('Пометки','mkErr',async()=>{
    secErr('mkErr','');if(!more)mkPage=1;else mkPage++;
    const t=$('mkTbl');
    if(isSuper()&&!more){const bk=await S.admin('backup.list',{}),n=$('bkNote');n.textContent='';n.hidden=true;
      if(bk.status===200&&bk.data.expired>0){n.hidden=false;n.appendChild(el('div','Копии стирания старше 5 лет: '+bk.data.expired+'. Решает владелец, сервер их сам не удаляет.'));
        for(const f of bk.data.items.filter(x=>x.expired))n.appendChild(el('div',f.name+' · '+fmtDay(f.ts),{class:'small muted'}));}}
    const r=await S.admin('purge.marks',{page:mkPage,size:50});
    if(r.data&&r.data.expired){lock('Сессия закончилась. Войдите снова.');return;}
    if(r.status!==200){if(!more)t.textContent='';$('mkMore').hidden=true;secErr('mkErr','Раздел «Помечено на стирание» временно недоступен.');return;}
    if(!more){t.textContent='';const h=el('tr');for(const c of['Вид','Объект','Школа','Кто пометил','Когда','Почему','Состояние',''])h.appendChild(el('th',c));t.appendChild(h);}
    for(const it of r.data.items){
      const tr=el('tr'),st=it.state==='archived'?'в архиве'+(it.from?', стирать можно с '+fmtDay(it.from):''):it.state==='active'?'действует':it.state==='moved'?'перенесён в другую школу':'уже стёрт';
      tr.appendChild(el('td',MARK_RU[it.kind]||it.kind));tr.appendChild(el('td',it.name||'—'));tr.appendChild(el('td',it.school?schoolName(it.school):'—'));tr.appendChild(el('td',it.by||'—'));tr.appendChild(el('td',fmt(it.ts)));tr.appendChild(el('td',it.why||'—'));tr.appendChild(el('td',st));
      const td=el('td'),lab=(MARK_RU[it.kind]||'')+' «'+(it.name||it.id)+'»',list=[];
      if(isSuper()){
        if(it.state==='active'&&it.kind!=='trash')list.push(['В архив',()=>archiveMark(it)]);
        if(it.state==='archived')list.push(['Стереть навсегда',()=>purgeDialog(it.kind,it.id,lab),'red']);
        list.push(['Снять пометку',()=>unmark(it)]);
      }else list.push(['Снять',()=>unmark(it)]);
      actions(td,list);tr.appendChild(td);t.appendChild(tr);
    }
    if(!more&&!r.data.items.length){const tr=el('tr'),td=el('td','Пометок нет.',{colspan:'8',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    $('mkMore').hidden=!r.data.more;
  });
}
async function unmark(it){const r=await S.admin('purge.unmark',{kind:it.kind,id:it.id});if(bad(r,null))return;say('Пометка снята.');loadMarks().catch(()=>{});}

/* ---------- история школы (Б74.2, Б74.8): сервер сам режет выдачу по роли; ip приходит только суперадмину ---------- */
const ACT_RU={'auth.login':'вход в систему','student.create':'добавлен ученик','student.archive':'ученик отправлен в архив','student.restore':'ученик возвращён из архива','student.move':'ученик перенесён','student.pin_reset':'сброшен код входа ученика','student.pin_change':'ученик сменил код входа',
  'class.create':'создан класс','class.archive':'класс отправлен в архив','class.restore':'класс возвращён из архива','class.assign':'класс передан учителю','class.move':'класс перенесён в другую школу',
  'user.create':'создана учётная запись','user.archive':'учётная запись в архиве','user.restore':'учётная запись возвращена','role.add':'добавлена роль','role.assign':'назначена роль','role.remove':'роль снята','password.reset_issue':'выдан код сброса пароля',
  'invite.create':'создано приглашение','invite.revoke':'приглашение отозвано','device.code':'выпущен код привязки шлема','device.revoke':'шлем отозван',
  'school.create':'создана школа','school.update':'школа изменена','trash.restore':'возвращена копия из корзины','upload.create':'загружен файл','upload.archive':'файл в архиве','upload.restore':'файл возвращён','upload.approve':'файл одобрен','upload.reject':'файл отклонён','upload.delete':'файл удалён','room.publish':'комната опубликована','closed.view':'просмотр закрытых результатов','admin.denied':'отказ в доступе'};
const actRu=a=>ACT_RU[a]||a;
let hiPage=1;
function fillHistSchools(){
  const s=$('hiSchool'),old=s.value;s.textContent='';
  const items=schoolsCache.filter(x=>isSuper()||x.status!=='archived');
  for(const x of items)s.appendChild(el('option',x.name+(x.status==='archived'?' (архив)':''),{value:x.id}));
  if(isSuper())s.appendChild(el('option','Без школы',{value:'-'}));
  if(old&&Array.from(s.options).some(o=>o.value===old))s.value=old;
  const tr=$('trSchool'),o2=tr.value;tr.textContent='';tr.appendChild(el('option','Все',{value:''}));for(const x of schoolsCache)tr.appendChild(el('option',x.name,{value:x.id}));if(o2&&Array.from(tr.options).some(o=>o.value===o2))tr.value=o2;
}
function histTarget(it){
  const k={user:'пользователь',student:'ученик',class:'класс',school:'школа',device:'шлем',upload:'файл',room:'комната'}[it.kind]||it.kind||'';
  if(!it.kind)return '—';
  const d=it.detail||{};
  if(['user','student','class','school'].includes(it.kind))return k+' '+(it.name||(it.kind==='class'&&d.name)||'стёрто');
  return k+(d.title||d.name?' «'+(d.title||d.name)+'»':'');
}
function histRows(items,more){
  const t=$('hiTbl'),withIp=items.some(i=>i.ip!==undefined)||t.dataset.ip==='1';
  if(!more){t.textContent='';t.dataset.ip=withIp?'1':'';const h=el('tr');for(const c of['Когда','Кто','Что','Над кем'].concat(withIp?['IP']:[]))h.appendChild(el('th',c));t.appendChild(h);}
  for(const it of items){
    const tr=el('tr');tr.appendChild(el('td',fmt(it.ts)));tr.appendChild(el('td',it.actor||'—'));
    const d=it.detail||{},extra=[];if(d.name&&it.kind!=='class')extra.push(d.name);if(d.role)extra.push(ROLE_RU[d.role]||d.role);if(d.status)extra.push(d.status==='archived'?'архив':d.status==='active'?'действует':d.status);
    tr.appendChild(el('td',actRu(it.action)+(extra.length&&['role.add','role.assign','role.remove','school.update','invite.create'].includes(it.action)?' ('+extra.join(', ')+')':'')));
    tr.appendChild(el('td',histTarget(it)));
    if(t.dataset.ip==='1')tr.appendChild(el('td',it.ip||'—'));
    t.appendChild(tr);
  }
}
async function loadHistory(more){
  await safe('История','hiErr',async()=>{
    secErr('hiErr','');if(!more)hiPage=1;else hiPage++;
    const school=$('hiSchool').value,t=$('hiTbl');
    if(!school){t.textContent='';$('hiMore').hidden=true;secErr('hiErr','Выберите школу.');return;}
    const days=parseInt($('hiPeriod').value,10),q={school,kind:$('hiKind').value,page:hiPage,size:50};
    if(days)q.from=Date.now()-days*86400000;
    const r=await S.history(q);
    if(r.data&&r.data.expired){lock('Сессия закончилась. Войдите снова.');return;}
    if(r.status!==200||!r.data||!Array.isArray(r.data.items)){if(!more)t.textContent='';$('hiMore').hidden=true;if(more)hiPage--;secErr('hiErr','Раздел «История» временно недоступен.');return;}
    histRows(r.data.items,more);
    if(!more&&!r.data.items.length){const tr=el('tr'),td=el('td','Событий нет.',{colspan:'5',class:'muted'});tr.appendChild(td);t.appendChild(tr);}
    $('hiMore').hidden=!r.data.more;
  });
}

/* ---------- разделы ---------- */
const SECS=['people','invites','devices','closed','schools','trash','marks','history'];
function openTab(name){
  for(const b of $('tabs').children)b.classList.toggle('on',b.dataset.t===name);
  for(const x of SECS)$('s-'+x).hidden=x!==name;
  if(name==='trash')loadTrash();else if(name==='marks')loadMarks();else if(name==='history')loadHistory();
}
function switchBar(id,get,set){
  $(id).onclick=e=>{const b=e.target.closest('[data-s]');if(!b||b.dataset.s===get())return;set(b.dataset.s);for(const x of $(id).children)x.classList.toggle('on',x===b);};
}

/* ---------- вход и запуск ---------- */
function show(){
  $('lock').hidden=true;$('app').hidden=false;
  const roles=S.account.roles();
  if(!isSuper()&&!isDir()&&!isExp()){lock('Эта страница для директора, специалиста и администратора. Откройте кабинет учителя.',true);return;}
  const onlyExp=!isSuper()&&!isDir();
  $('who').textContent=(S.account.who()||'')+' · '+(isSuper()?'администратор':S.account.roles().some(r=>r.role==='region_admin')?'региональный администратор':isReg()?'администратор района':isDir()?'директор':'специалист');
  $('tabAdm').hidden=!(isSuper()||isReg());
  const tabOk={people:!onlyExp,invites:!onlyExp,devices:!onlyExp,closed:isSuper()||isExp(),schools:isSuper(),trash:!onlyExp&&(isSuper()||isDir()),marks:!onlyExp&&(isSuper()||isDir()),history:!onlyExp&&(isSuper()||isDir())};
  for(const b of $('tabs').children)b.hidden=!tabOk[b.dataset.t];
  openTab(onlyExp?'closed':'people');
  const roleSel=$('invRole');roleSel.textContent='';for(const [v,t] of isSuper()?[['teacher','Учитель'],['director','Директор'],['expert','Специалист'],['region_admin','Региональный администратор'],['district_admin','Администратор района']]:[['teacher','Учитель'],['expert','Специалист']])roleSel.appendChild(el('option',t,{value:v}));
  say('');
  if(onlyExp){fillClosedSchools();return;}
  loadSchools().then(()=>safe('Фильтр','peopleErr',async()=>{await casc.init();})).then(()=>{loadInvites();loadDevices();fillClosedSchools();});
}
function bind(){
  $('out').onclick=async e=>{e.preventDefault();await S.account.logout();location.replace('teacher.html');};
  $('kinds').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;tab=b.dataset.k;page=1;for(const x of $('kinds').children)x.classList.toggle('on',x===b);loadPeople();};
  $('clsNew').onclick=createClass;$('fRole').onchange=()=>{page=1;loadPeople();};
  $('prev').onclick=()=>{if(page>1){page--;loadPeople();}};$('next').onclick=()=>{page++;loadPeople();};
  let tm=null;$('fQ').oninput=()=>{clearTimeout(tm);tm=setTimeout(()=>{page=1;loadPeople();},300);};
  $('tabs').onclick=e=>{const b=e.target.closest('[data-t]');if(b)openTab(b.dataset.t);};
  switchBar('stSw',()=>view,v=>{view=v;page=1;loadPeople();});switchBar('shSw',()=>shView,v=>{shView=v;loadSchools();});
  $('mkMore').onclick=()=>loadMarks(true);$('trKind').onchange=$('trSchool').onchange=()=>loadTrash();$('trMore').onclick=()=>loadTrash(true);
  $('hiSchool').onchange=$('hiKind').onchange=$('hiPeriod').onchange=()=>loadHistory();$('hiMore').onclick=()=>loadHistory(true);
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

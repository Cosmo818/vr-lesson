/* builder.js — конструктор комнат в кабинете учителя: список комнат, шаблоны, план 2D с перетаскиванием, форма блока, предпросмотр.
   Работает только с данными room/1 (js/roomspec.js) и Store.saveRoom/removeRoom; в VR ничего не запускает. Подключается в teacher.html. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,S=VR.Store,RS=VR.roomspec;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BANDS=['a','b','c','d'],BS={a:'1–4',b:'5–6',c:'7–8',d:'9–11'};
const ICON={text:'Т',item:'●',table:'▭',question:'?',quiz:'✓',portal:'⇨',model:'▲',sound:'♪'};
const SC=40,CS=480; /* пикселей на метр, размер плана: комната 12×12 м */
let cur=null,sel=null,dirty=false,msg='',io=false,inRoom=false;
/* отмена и возврат: снимки комнаты до каждой правки (шаг назад / шаг вперёд, Ctrl+Z / Ctrl+Y) */
let hist=[],fut=[],lastKey='',lastAt=0;
const HMAX=100;
function mark(key){
  if(!cur)return;
  const now=Date.now();
  if(key&&key===lastKey&&now-lastAt<1500){lastAt=now;return;}/* набор текста в одном поле — одна правка */
  lastKey=key||'';lastAt=now;
  const j=JSON.stringify(cur);if(hist.length&&hist[hist.length-1].j===j)return;
  hist.push({j,sel});if(hist.length>HMAX)hist.shift();fut=[];histBtns();
}
function histBtns(){const u=$('bdUndo'),r=$('bdRedo');if(u)u.disabled=!hist.length;if(r)r.disabled=!fut.length;}
function undo(){if(!cur||!hist.length)return;fut.push({j:JSON.stringify(cur),sel});const h=hist.pop();cur=JSON.parse(h.j);sel=blk(h.sel)?h.sel:null;lastKey='';setDirty(true);show();}
function redo(){if(!cur||!fut.length)return;hist.push({j:JSON.stringify(cur),sel});const h=fut.pop();cur=JSON.parse(h.j);sel=blk(h.sel)?h.sel:null;lastKey='';setDirty(true);show();}
function resetHist(){hist=[];fut=[];lastKey='';}

const root=()=>$('bdRoot');
const px=v=>CS/2+v*SC;
const mt=p=>Math.round(((p-CS/2)/SC)*10)/10;
const clampM=v=>Math.max(-RS.LIM.coord,Math.min(RS.LIM.coord,v));
const blk=id=>cur&&cur.blocks.find(b=>b.id===id);
const subjTitle=k=>D.subjects[k]?D.subjects[k].title:k;
const roomOpts=cur0=>{
  const o=[['hall','Холл']];
  for(const k of Object.keys(D.subjects))if(k!=='gen')o.push([k,subjTitle(k)]);
  for(const r of S.customRooms())if(!cur0||r.id!==cur0.id)o.push([r.id,r.title+' (учителя)']);
  return o;
};

/* ---------- список ---------- */
function listHtml(){
  const L=S.customRooms();
  return`<p class="muted">Здесь вы собираете свои комнаты для VR из готовых блоков: текст, предметы, столы, вопросы, тест по предмету и двери. Новая комната скрыта от учеников, пока вы не отметите классы. <a href="help-rooms.html">Инструкция</a></p>
  <h2>Создать комнату</h2><div class="row" style="align-items:stretch">${Object.keys(RS.TEMPLATES).map(k=>`<div class="card" style="flex:1;min-width:200px;margin:0"><b>${esc(RS.TEMPLATES[k].title)}</b><div class="muted small" style="margin:6px 0 10px">${esc(RS.TEMPLATES[k].text)}</div><button class="btn" data-bd="new" data-t="${k}">Создать</button></div>`).join('')}</div>
  <div class="row"><button class="btn ghost" data-bd="import">Загрузить комнату из файла (текст JSON)</button></div>
  <div id="bdIO">${io?ioHtml(''):''}</div>
  <h2>Мои комнаты</h2>`+(L.length?'<div class="scroll card" style="padding:0"><table style="min-width:520px"><tr><th>Комната</th><th>Классы</th><th>Блоков</th><th></th></tr>'+L.map(r=>{
    const b=S.bandsOf('room',r.id);
    return`<tr data-id="${esc(r.id)}"><td><b>${esc(r.title)}</b></td><td>${b?BANDS.filter(x=>b.indexOf(x)>=0).map(x=>BS[x]).join(', '):'<span class="muted">черновик (скрыта)</span>'}</td><td>${r.blocks.length}</td><td style="white-space:nowrap"><button class="btn" data-bd="open">Изменить</button> <button class="btn ghost" data-bd="copy">Копия</button> <button class="btn red" data-bd="del">Удалить</button></td></tr>`;
  }).join('')+'</table></div>':'<p class="muted">Своих комнат пока нет. Выберите шаблон выше.</p>');
}
const ioHtml=txt=>`<div class="card"><p class="muted small">Вставьте текст комнаты (JSON) и нажмите «Загрузить». Чужой код не выполняется: всё, что не из списка блоков, отбрасывается.</p><textarea id="bdIOText">${esc(txt)}</textarea><div class="row"><button class="btn" data-bd="doimport">Загрузить</button><button class="btn ghost" data-bd="closeio">Закрыть</button></div></div>`;

/* ---------- редактор ---------- */
function fieldHtml(f,b){
  const v=b[f.k],id='bdf-'+f.k;
  if(f.kind==='text')return`<label class="bdl">${esc(f.label)}<input data-k="${f.k}" value="${esc(v)}" maxlength="${f.max}"></label>`;
  if(f.kind==='area')return`<label class="bdl">${esc(f.label)}<textarea data-k="${f.k}" maxlength="${f.max}" style="font-family:inherit;font-size:15px;min-height:70px">${esc(v)}</textarea></label>`;
  if(f.kind==='num')return`<label class="bdl">${esc(f.label)}<input type="number" data-k="${f.k}" value="${v}" min="${f.min}" max="${f.max}" step="${f.step}"></label>`;
  if(f.kind==='check')return`<label class="bdl" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="${f.k}"${v?' checked':''}> ${esc(f.label)}</label>`;
  if(f.kind==='select')return`<label class="bdl">${esc(f.label)}<select data-k="${f.k}">${Object.keys(f.opts).map(k=>`<option value="${k}"${k===v?' selected':''}>${esc(f.opts[k])}</option>`).join('')}</select></label>`;
  if(f.kind==='color')return`<label class="bdl">${esc(f.label)}<select data-k="${f.k}">${Object.keys(RS.COLORS).map(k=>`<option value="${k}"${k===v?' selected':''}>${esc(RS.COLORS[k][0])}</option>`).join('')}</select></label>`;
  if(f.kind==='subject')return`<label class="bdl">${esc(f.label)}<select data-k="${f.k}">${Object.keys(D.Q).map(k=>`<option value="${k}"${k===v?' selected':''}>${esc(subjTitle(k))}</option>`).join('')}</select></label><p class="muted small">Ученик пройдёт встроенный тест по своему классу; ваши тесты из вкладки «Конструктор тестов» для этого предмета тоже будут в списке.</p>`;
  if(f.kind==='room')return`<label class="bdl">${esc(f.label)}<select data-k="${f.k}">${roomOpts(cur).map(([k,t])=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
  return'';
}
function formHtml(){
  const b=blk(sel);
  if(!b)return'<p class="muted">Нажмите на блок в плане или в списке, чтобы изменить его. Блок можно перетащить мышью по плану.</p>';
  return`<div class="row"><b>${esc(RS.TYPES[b.type])}</b><span class="muted small">Положение на плане: можно перетащить или ввести</span></div>
  <div class="row"><label class="bdl" style="width:110px">x, м<input type="number" data-k="x" value="${b.x}" min="-5.4" max="5.4" step="0.1"></label><label class="bdl" style="width:110px">z, м<input type="number" data-k="z" value="${b.z}" min="-5.4" max="5.4" step="0.1"></label></div>
  ${RS.FIELDS[b.type].map(f=>fieldHtml(f,b)).join('')}
  <div class="row"><button class="btn ghost" data-bd="bdup">Дублировать</button><button class="btn red" data-bd="bddel">Удалить блок</button></div>`;
}
function costHtml(){
  const c=RS.cost(cur),col=c.level==='over'?'#ef4444':c.level==='lite'?'#22c55e':'#eab308';
  return`<span style="color:${col};font-weight:700">●</span> Панелей ${c.panels} из ${RS.LIM.panels}, предметов ${c.items} из ${RS.LIM.items}. ${esc(c.text)}`;
}
const frameHtml=()=>`<div class="card"><div class="small muted" style="margin-bottom:6px">Вы внутри комнаты. Дверь «← Холл» ведёт в холл; вернуться к правке — кнопка «← Вернуться в редактор». В шлеме комната открывается по кнопке VR внутри окна.</div><iframe title="Комната" src="index.html?room=${encodeURIComponent(cur.id)}&t=${Date.now()}" allow="xr-spatial-tracking; fullscreen" style="width:100%;height:480px;border:1px solid var(--line);border-radius:10px;background:#000"></iframe></div>`;
function editHtml(){
  const b=S.bandsOf('room',cur.id);
  return`<div class="row"><button class="btn ghost" data-bd="back">← К списку</button><button class="btn" data-bd="save" id="bdSave">Сохранить</button><button class="btn ghost" data-bd="undo" id="bdUndo" title="Шаг назад (Ctrl+Z)" ${hist.length?'':'disabled'}>↶ Назад</button><button class="btn ghost" data-bd="redo" id="bdRedo" title="Шаг вперёд (Ctrl+Y)" ${fut.length?'':'disabled'}>↷ Вперёд</button><span id="bdDirty" class="small" style="display:inline-block;min-width:200px"></span><button class="btn ghost" data-bd="preview">${inRoom?'← Вернуться в редактор':'Войти в комнату'}</button><button class="btn ghost" data-bd="newtab">В новой вкладке</button><button class="btn ghost" data-bd="vredit" title="Откроет комнату с планшетом-редактором на левой руке">Править в VR</button><button class="btn ghost" data-bd="export">Текст комнаты</button><a href="help-rooms.html" class="small">Инструкция</a></div>
  <div id="bdFrame" ${inRoom?'':'hidden'}>${inRoom?frameHtml():''}</div>
  <div id="bdMsg" class="note small" ${msg?'':'hidden'}>${esc(msg)}</div><div id="bdIO">${io?ioHtml(JSON.stringify(cur,null,1)):''}</div>
  <div class="card"><div class="row"><label class="bdl" style="flex:1;min-width:220px">Название комнаты<input data-r="title" value="${esc(cur.title)}" maxlength="${RS.LIM.title}"></label>
    <label class="bdl">Оформление<select data-r="env">${Object.keys(RS.PRESETS).map(k=>`<option value="${k}"${k===cur.env?' selected':''}>${esc(RS.PRESETS[k].title)}</option>`).join('')}</select></label></div>
    <label class="bdl">Подсказка при входе (по желанию)<input data-r="hint" value="${esc(cur.hint)}" maxlength="${RS.LIM.hint}"></label>
    <div class="row"><b>Для классов:</b>${BANDS.map(x=>`<label class="small"><input type="checkbox" data-band="${x}"${b.indexOf(x)>=0?' checked':''}> ${BS[x]}</label>`).join('')}<span class="muted small">Ничего не отмечено — комната скрыта (черновик). Отметки действуют сразу.</span></div></div>
  <div class="row"><b>Добавить:</b>${Object.keys(RS.TYPES).map(t=>`<button class="btn ghost" data-bd="add" data-t="${t}">${ICON[t]} ${esc(RS.TYPES[t])}</button>`).join('')}</div>
  <div class="bdgrid"><div><canvas id="bdPlan" width="${CS}" height="${CS}" style="max-width:100%;border:1px solid var(--line);border-radius:10px;touch-action:none"></canvas><div class="small muted" id="bdCost" style="margin-top:6px">${costHtml()}</div>
    <div class="small muted">План сверху: вверху задняя стена, внизу вход и дверь в холл. Зелёный треугольник — где ученик появляется (его тоже можно двигать).</div></div>
  <div><div class="card" style="margin-top:0;max-height:180px;overflow:auto;padding:8px" id="bdList">${listBlocks()}</div><div class="card" id="bdForm">${formHtml()}</div></div></div>`;
}
const blockTitle=b=>RS.TYPES[b.type]+': '+(b.title||b.label||b.q||(b.asset&&(RS.MODELS[b.asset]||RS.SFX[b.asset]||{}).title)||(b.type==='quiz'?subjTitle(b.subj):b.type==='portal'?(b.to==='hall'?'Холл':subjTitle(b.to)):'')||'');
function listBlocks(){return cur.blocks.length?cur.blocks.map(b=>`<div class="bdb${b.id===sel?' on':''}" data-pick="${b.id}">${ICON[b.type]} ${esc(blockTitle(b).slice(0,48))}</div>`).join(''):'<span class="muted small">Блоков пока нет: добавьте их кнопками выше.</span>';}

/* ---------- план ---------- */
function drawPlan(){
  const cv=$('bdPlan');if(!cv)return;
  const c=cv.getContext('2d');
  c.fillStyle='#0e1730';c.fillRect(0,0,CS,CS);
  c.strokeStyle='#1f2d52';c.lineWidth=1;
  for(let i=1;i<12;i++){c.beginPath();c.moveTo(i*SC,0);c.lineTo(i*SC,CS);c.moveTo(0,i*SC);c.lineTo(CS,i*SC);c.stroke();}
  c.strokeStyle='#3b82f6';c.lineWidth=4;c.strokeRect(2,2,CS-4,CS-4);
  c.fillStyle='#94a3b8';c.fillRect(CS/2-28,CS-6,56,6);c.font='11px sans-serif';c.textAlign='center';c.fillText('дверь в холл',CS/2,CS-10);
  for(const b of cur.blocks)drawBlock(c,b,b.id===sel);
  const sx=px(cur.spawn.x),sz=px(cur.spawn.z);
  c.fillStyle='#22c55e';c.beginPath();c.moveTo(sx,sz-14);c.lineTo(sx-10,sz+9);c.lineTo(sx+10,sz+9);c.closePath();c.fill();
  c.fillStyle='#bbf7d0';c.font='11px sans-serif';c.textAlign='center';c.fillText('вход',sx,sz+22);
  c.textAlign='left';
}
function drawBlock(c,b,on){
  const x=px(b.x),z=px(b.z);
  if(b.type==='table'){c.fillStyle='#64748b';c.fillRect(x-b.w*SC/2,z-b.d*SC/2,b.w*SC,b.d*SC);if(on){c.strokeStyle='#fde047';c.lineWidth=3;c.strokeRect(x-b.w*SC/2,z-b.d*SC/2,b.w*SC,b.d*SC);}return;}
  if(b.type==='item'){const r=Math.max(7,b.size*SC/2);c.fillStyle=RS.colorHex(b.color);c.beginPath();c.arc(x,z,r,0,7);c.fill();if(b.lift>0.05){c.strokeStyle='#e2e8f0';c.lineWidth=1;c.setLineDash([3,3]);c.beginPath();c.arc(x,z,r+3,0,7);c.stroke();c.setLineDash([]);}
    if(on){c.strokeStyle='#fde047';c.lineWidth=3;c.beginPath();c.arc(x,z,r+4,0,7);c.stroke();}return;}
  const w=b.type==='portal'?30:Math.max(24,(b.w||1.6)*SC*.5);
  c.fillStyle=b.type==='portal'?RS.colorHex(b.accent):b.type==='question'?'#34d399':b.type==='quiz'?'#a78bfa':RS.colorHex(b.accent);
  c.fillRect(x-w/2,z-9,w,18);if(on){c.strokeStyle='#fde047';c.lineWidth=3;c.strokeRect(x-w/2-2,z-11,w+4,22);}
  c.fillStyle='#0b1020';c.font='bold 13px sans-serif';c.textAlign='center';c.fillText(ICON[b.type],x,z+5);
}
function hit(mx,mz){
  const sx=px(cur.spawn.x),sz=px(cur.spawn.z);
  for(let i=cur.blocks.length-1;i>=0;i--){
    const b=cur.blocks[i],x=px(b.x),z=px(b.z);
    let hw=15,hh=12;
    if(b.type==='table'){hw=b.w*SC/2;hh=b.d*SC/2;}else if(b.type==='item'){hw=hh=Math.max(10,b.size*SC/2+4);}else if(b.type!=='portal'){hw=Math.max(14,(b.w||1.6)*SC*.25);}
    if(Math.abs(mx-x)<=hw&&Math.abs(mz-z)<=hh)return{id:b.id};
  }
  if(Math.abs(mx-sx)<=14&&Math.abs(mz-sz)<=16)return{spawn:true};
  return null;
}
function bindPlan(){
  const cv=$('bdPlan');if(!cv)return;
  let drag=null;
  const pt=e=>{const r=cv.getBoundingClientRect();return[(e.clientX-r.left)*CS/r.width,(e.clientY-r.top)*CS/r.height];};
  cv.onpointerdown=e=>{
    const [mx,mz]=pt(e),h=hit(mx,mz);
    if(!h){sel=null;refreshPanels();return;}
    mark();if(h.id){sel=h.id;drag={id:h.id};refreshPanels();}else drag={spawn:true};
    cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove=e=>{
    if(!drag)return;
    const [mx,mz]=pt(e),x=clampM(mt(mx)),z=clampM(mt(mz));
    if(drag.spawn){cur.spawn.x=x;cur.spawn.z=z;}
    else{const b=blk(drag.id);if(!b)return;b.x=x;b.z=z;const fx=document.querySelector('#bdForm [data-k=x]'),fz=document.querySelector('#bdForm [data-k=z]');if(fx)fx.value=x;if(fz)fz.value=z;}
    setDirty(true);drawPlan();
  };
  cv.onpointerup=cv.onpointercancel=()=>{drag=null;};
}
function refreshPanels(){
  const l=$('bdList'),f=$('bdForm');if(l)l.innerHTML=listBlocks();if(f)f.innerHTML=formHtml();
  const c=$('bdCost');if(c)c.innerHTML=costHtml();drawPlan();
}
function setDirty(v){dirty=v;const d=$('bdDirty');if(d){d.textContent=v?'Есть несохранённые правки':'Сохранено';d.style.color=v?'#fbbf24':'#86efac';}const c=$('bdCost');if(c)c.innerHTML=costHtml();}

/* ---------- действия ---------- */
function show(){
  const r=root();if(!r)return;
  if(!cur){r.innerHTML=listHtml();return;}
  r.innerHTML=editHtml();bindPlan();drawPlan();setDirty(dirty);
}
function save(){
  const res=S.saveRoom(cur);
  if(!res.spec){msg=res.errors.join(' ');show();return false;}
  cur=res.spec;dirty=false;
  msg=res.errors.length?'Сохранено, но: '+res.errors.join(' '):'';
  if(sel&&!blk(sel))sel=null;
  show();return true;
}
function open(id){resetHist();inRoom=false;cur=JSON.parse(JSON.stringify(S.customRoom(id)));sel=null;dirty=false;msg='';io=false;show();}
function leave(){if(dirty&&!confirm('Есть несохранённые правки. Уйти без сохранения?'))return;resetHist();inRoom=false;cur=null;sel=null;dirty=false;msg='';io=false;show();}
function create(spec){const res=S.saveRoom(spec);if(!res.spec){alert(res.errors.join(' '));return;}open(res.spec.id);}

function onClick(e){
  const pick=e.target.closest('[data-pick]');
  if(pick){sel=pick.dataset.pick;refreshPanels();return;}
  const t=e.target.closest('[data-bd]');if(!t)return;
  const a=t.dataset.bd;
  if(a==='new'){const tpl=RS.TEMPLATES[t.dataset.t].make();create(tpl);}
  else if(a==='import'){io=!io;show();}
  else if(a==='closeio'){io=false;show();}
  else if(a==='doimport'){
    let o;try{o=JSON.parse($('bdIOText').value);}catch(x){alert('Это не текст комнаты (ошибка JSON).');return;}
    o.id=RS.newRoomId();const c=RS.clean(o,v=>!!D.Q[v]);
    if(!c.spec){alert(c.errors.join(' '));return;}
    io=false;create(c.spec);
  }
  else if(a==='export'){io=!io;show();}
  else if(a==='back')leave();
  else if(a==='save')save();
  else if(a==='vredit'){if(dirty&&!save())return;try{sessionStorage.setItem('vrl.editor',String(Date.now()+60*60*1000));}catch(e){}window.open('index.html?room='+encodeURIComponent(cur.id)+'&edit=1','_blank');}
  else if(a==='undo')undo();
  else if(a==='redo')redo();
  else if(a==='newtab'){if(dirty&&!save())return;window.open('index.html?room='+encodeURIComponent(cur.id),'_blank');}
  else if(a==='preview'){if(inRoom){inRoom=false;show();return;}if(dirty&&!save())return;inRoom=true;show();}
  else if(a==='add'){mark();const b=RS.blockDefault(t.dataset.t);b.x=0;b.z=-3+(cur.blocks.length%5)*.6;cur.blocks.push(b);sel=b.id;setDirty(true);refreshPanels();}
  else if(a==='bddel'){mark();cur.blocks=cur.blocks.filter(b=>b.id!==sel);sel=null;setDirty(true);refreshPanels();}
  else if(a==='bdup'){const b=blk(sel);if(b){mark();const c=JSON.parse(JSON.stringify(b));c.id=RS.newBlockId();c.x=Math.min(5.4,Math.round((c.x+.5)*10)/10);cur.blocks.push(c);sel=c.id;setDirty(true);refreshPanels();}}
  else{
    const tr=t.closest('tr[data-id]');if(!tr)return;const id=tr.dataset.id;
    if(a==='open')open(id);
    else if(a==='copy'){const s=JSON.parse(JSON.stringify(S.customRoom(id)));s.id=RS.newRoomId();s.title=(s.title+' (копия)').slice(0,RS.LIM.title);create(s);}
    else if(a==='del'){const r=S.customRoom(id);if(r&&confirm('Удалить комнату «'+r.title+'»? Ученики её больше не увидят.')){S.removeRoom(id);show();}}
  }
}
function onInput(e){
  const t=e.target;
  if(!cur)return;
  if(t.dataset.r){mark('r'+t.dataset.r);cur[t.dataset.r]=t.value;setDirty(true);return;}
  if(t.dataset.band){
    const now=BANDS.filter(x=>S.bandsOf('room',cur.id).indexOf(x)>=0&&x!==t.dataset.band);if(t.checked)now.push(t.dataset.band);
    S.setBands('room',cur.id,now.join(''));return;
  }
  if(t.dataset.k){
    const b=blk(sel);if(!b)return;
    const k=t.dataset.k;mark(sel+k);
    if(t.type==='checkbox')b[k]=t.checked;
    else if(t.type==='number'){const v=parseFloat(t.value);if(isFinite(v))b[k]=v;}
    else b[k]=t.value;
    setDirty(true);drawPlan();
    if(k==='title'||k==='label'||k==='q'||k==='subj'||k==='to'||k==='asset'){const l=$('bdList');if(l)l.innerHTML=listBlocks();}
  }
}
document.addEventListener('keydown',e=>{
  if(!cur||!(e.ctrlKey||e.metaKey)||!$('bdPlan'))return;
  const tg=e.target&&e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT')return;
  const k=(e.key||'').toLowerCase();
  if(k==='z'&&!e.shiftKey){e.preventDefault();undo();}else if(k==='y'||(k==='z'&&e.shiftKey)){e.preventDefault();redo();}
});
function mount(){
  const r=root();if(!r||r.dataset.bound)return;
  r.dataset.bound='1';r.addEventListener('click',onClick);r.addEventListener('input',onInput);r.addEventListener('change',onInput);
}
/* вызывается при каждой перерисовке вкладок: правку в процессе не трогаем */
function render(){mount();if(!cur)show();}

VR.builder={render,open,show};
})();

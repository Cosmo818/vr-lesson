/* einplay.js — ядро игры «Эйнштейн» отдельно от стены: состояние партии G и рисование доски (поле 6×6, вертикальные подсказки под ним, горизонтальные справа),
   меню, правил и обучения в прямоугольнике rect (пиксели текстуры). Стена (js/einroom.js), терминал (js/einterm.js) и веб (js/einweb.js) рисуют одно и то же через VR.einplay.
   Логика головоломки — js/einstein.js, обучение — js/eintut.js.
   G: g,t,helped,sec,sent,used,phase('idle'|'play'),paused,menu (меню открыто без паузы),win (null|'rules'|'tut'),tut ({i}),hk,tutDone,grip,hk,tid,mid,msg,rated (номер выдан сервером, решение пойдёт в зачёт),burn (помощь по выданному номеру: отправить helped:1),seedSrc ('rand'|'set'),fetching,rid,geo.
   Режима курка нет: курок/ЛКМ/касание — выбрать фишку, grip той же руки (ПКМ, долгое нажатие) — убрать; сохранённое vrl.einprefs.mode не читается.
   opt={prefKey, onDirty(что), state}. onDirty('field'|'hints'|'ctl'|'favs') — перерисовать часть; без аргумента — всё. Результат отдаётся в VR.games.finish, если он есть. */
(function(){
'use strict';
const VR=window.VR,E1=VR.einstein,N=E1.N;
const fmtT=s=>{s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const HK=[.9,1.2,1.5];/* ступени размера подсказок */
const drawHint=E1.drawHint;
const RT=()=>VR.einrate||null;   /* зачётная игра (js/einrate.js); нет модуля или флаг выключен — игра локальная */
/* размеры по устройствам: fs — основной шрифт, bh — высота кнопок, T — плитка подсказки при ступени 1, fx/fy — поля под подписи, minCell — наименьшая клетка поля */
const CFG={
  wall:{fs:40,bh:120,T:96,fx:70,fy:56,gap:18,minCell:150},
  term:{fs:34,bh:120,T:56,fx:60,fy:40,gap:14,minCell:187}};
/* правила — по тексту оригинала Einstein 2.0 (res/rules_ru.txt); ex — пример подсказки */
const RULES=web=>[
  {t:'Надо открыть все фишки в квадрате 6×6. В каждой строке фишки одного типа: в первой — арабские цифры, во второй — латинские буквы, в третьей — римские цифры, в четвёртой — игральные кости, в пятой — геометрические фигуры, в шестой — математические символы.'},
  {t:'Открывать фишки надо методом исключения. Пока фишка не открыта, на её месте показаны все возможные варианты. '+(web?'Левая кнопка мыши (касание) выбирает фишку, правая кнопка или долгое нажатие убирает её.':'Курок открывает фишку, курок при нажатой боковой кнопке (grip) той же руки исключает её.')},
  {t:'Вертикальная подсказка: эти две фишки находятся в одной колонке.',ex:{t:'under',a:[1,2],b:[5,1]}},
  {t:'Красная двойная стрелка: фишки в соседних колонках, какая левее, а какая правее — неизвестно.',ex:{t:'near',a:[3,6],b:[5,5]}},
  {t:'Три красные точки: левая фишка находится в колонке левее правой, на любом расстоянии.',ex:{t:'dir',a:[3,3],b:[2,2]}},
  {t:'Синяя стрелка над тремя фишками: средняя стоит между двумя другими, все три в соседних колонках; какая из крайних левее — неизвестно.',ex:{t:'btw',a:[5,5],c:[4,4],b:[0,5]}},
  {t:'Использованную подсказку нажми — она потускнеет. Ошибка (убрана верная фишка или выбрана неверная) — проигрыш.'}];

const dirty=(G,w)=>{try{if(G.opt&&G.opt.onDirty)G.opt.onDirty(w);}catch(e){}};
const hkOf=G=>G.hk===undefined?1:G.hk;
const pidOf=E=>E&&E.pk!==undefined?E.pk:(E&&E.student&&E.student.id);
function savePref(E,patch){try{if(VR.games&&VR.games.setPrefs)VR.games.setPrefs(pidOf(E),patch);}catch(e){}}
const menuOn=G=>!G.win&&(G.phase==='idle'||!!G.paused||!!G.menu);
/* рисование в прямоугольнике rect: начало координат сдвигается в rect, области нажатия пересчитываются в пиксели панели (масштаб 1) */
function within(p,c,rect,fn){
  const ox=rect.x,oy=rect.y,q=Object.create(p);q.W=rect.w;q.H=rect.h;
  const old=p.area;
  p.area=(x,y,w,h,f,dis)=>old(ox+x,oy+y,w,h,f,dis);
  c.save();c.translate(ox,oy);
  try{fn(q);}finally{c.restore();p.area=old;}
}
/* кнопка с запоминанием подписи (проверки находят кнопки по ней) */
function btn(p,x,y,w,h,label,fn,t){p.button(x,y,w,h,label,fn,t);const b=p.btns[p.btns.length-1];if(b)b.label=label;}

function create(E,opt){
  opt=opt||{};
  const G=opt.state||{};
  G.opt=opt;G.g=null;G.t=0;G.helped=false;G.sec=0;G.sent=false;G.used=new Set();G.phase='idle';G.paused=false;G.menu=false;G.win=null;G.tut=null;G.grip=false;G.geo=null;
  G.tid=null;G.mid=null;G.msg='';G.rated=false;G.seedSrc=null;G.hk=1;
  const pf=VR.games&&VR.games.prefs?VR.games.prefs(pidOf(E)):{hk:1,view:'wall'};
  G.hk=pf.hk;G.view=pf.view;G.tutDone=!!pf.tutorialDone;
  return G;
}
/* begin===false — партия приготовлена, но не идёт: игра не включается, пока не нажато «Начать» */
function start(E,G,seed,again,begin){
  G.rid=(G.rid||0)+1;G.fetching=false;   /* устаревший ответ сервера на прежний запрос номера игнорируется */
  if(!again){G.rated=false;G.burn=false;G.seedSrc=seed===undefined?'rand':'set';}   /* «Сначала» — тот же номер, зачётность сохраняется */
  const pz=again&&G.g?G.g.pz:E1.generate(seed);
  G.g=E1.newGame(pz);G.t=0;G.helped=false;G.sec=0;G.sent=false;G.used=new Set();
  G.phase=begin===false?'idle':'play';G.paused=false;G.menu=false;G.win=null;
  G.msg='';dirty(G);dirty(G,'favs');
}
const srcOf=G=>G.view==='web'?'web':G.view==='term'?'term':'wall';
/* «Новая»: у вошедшего ученика вне турнира номер выдаёт сервер (G.rated=true); нет связи / 404 / гость — локальный номер, вне рейтинга */
function fresh(E,G,begin){
  const R=RT();
  if(G.tid||!R||!R.enabled(E)){start(E,G,undefined,false,begin);return;}
  if(G.fetching)return;
  start(E,G,undefined,false,begin);   /* пока ждём ответ, показана локальная головоломка; ответ её заменит */
  G.fetching=true;G.msg='Запрашиваю головоломку…';dirty(G,'ctl');
  const tok=G.rid;
  /* ревью Opus Э8: сначала очередь решений, потом новый номер — иначе сервер сделает прежний номер void и решение из очереди пропадёт */
  Promise.resolve().then(()=>R.flush(E)).catch(()=>{}).then(()=>R.fetchSeed(E,srcOf(G))).then(seed=>{
    if(tok!==G.rid)return;
    if(seed!=null){start(E,G,seed,false,begin);G.rated=true;G.seedSrc='rand';}
    else{G.fetching=false;G.msg='';dirty(G,'ctl');}
  }).catch(()=>{if(tok===G.rid){G.fetching=false;G.msg='';dirty(G,'ctl');}});
}
function setPause(G,v){G.paused=v;if(!v)G.menu=false;dirty(G);}
function openMenu(G){G.menu=true;dirty(G);}
/* «Продолжить»: закрыть меню и снять паузу */
function resume(G){G.menu=false;G.win=null;G.paused=false;dirty(G);}
function lost(E,G){
  G.menu=true;dirty(G);   /* после проигрыша меню действий появляется сразу (Айрат 29.10) */
  if(G.sent)return;G.sent=true;
  try{if(VR.games&&VR.games.finish)VR.games.finish(E,'einstein',{res:'lose',seed:G.g.pz.seed,helped:G.helped,moves:G.g.moves,tid:G.tid||null,mid:G.mid||null});}catch(e){}
}
/* победа при выданном номере (или после помощи по нему — тогда helped:1 сжигает номер) → один solve; без связи — в очередь vrl.einq */
function sendSolve(E,G){
  const R=RT();if(!R||G.tid||!(G.rated||G.burn))return;
  const gr=G.g,rec={seed:gr.pz.seed,time:Math.round(G.t),moves:Math.max(1,gr.moves|0),helped:G.helped||G.burn?1:0,src:srcOf(G)};
  G.rated=false;G.burn=false;
  R.submit(E,rec).then(res=>{
    const add=R.say(res);if(add&&G.g===gr){G.msg+=add;dirty(G,'ctl');}
  }).catch(()=>{});
}
function won(E,G){
  E.fanfare();G.msg='Готово! Все фишки открыты за '+fmtT(G.t)+(G.helped?' (с помощью — в зачёт не идёт)':'');
  if(!G.sent){G.sent=true;try{if(VR.games&&VR.games.finish)VR.games.finish(E,'einstein',{time:Math.round(G.t),seed:G.g.pz.seed,helped:G.helped,moves:G.g.moves,tid:G.tid||null,mid:G.mid||null});}catch(e){}
    sendSolve(E,G);}
  dirty(G,'ctl');dirty(G,'hints');
}
/* h: рука (шлем) или {wbtn:1|3} (веб). Курок всегда выбирает фишку; grip той же руки (в вебе — ПКМ / долгое нажатие) убирает её */
function gripOf(h){const b=h&&h.src&&h.src.gamepad&&h.src.gamepad.buttons&&h.src.gamepad.buttons[1];return !!(b&&b.pressed);}
function click(E,G,h,c,r,e){
  const g=G.g;if(g.status!=='play'||G.phase!=='play'||G.paused||menuOn(G))return;
  const btn=h&&h.wbtn?h.wbtn:(gripOf(h)?3:1);
  const res=E1.click(g,c,r,e,btn);
  if(res==='noop')return;
  dirty(G,'field');dirty(G,'ctl');
  if(res==='fail'){E.beep(180,.3,'sawtooth',.06);E.buzz(h,.8,150);G.msg=G.tid?'Ошибка — в турнире это поражение в матче.':'Ошибка: так не может быть. Начни сначала или возьми новую.';lost(E,G);}
  else if(res==='win')won(E,G);
  else E.beep(btn===1?700:520,.04,'sine',.04);
}
/* шаг времени; меню шлема включает паузу (кроме турнира); grip любой руки красит подсветку фишки в «убрать» */
function tick(E,G,dt){
  if(G.g&&E.menuOpen&&!G.tid&&!G.paused&&G.phase==='play'&&G.g.status==='play')setPause(G,true);
  const gr=!!(E.H&&E.H.some(h=>h&&h.has&&gripOf(h)));
  if(gr!==G.grip){G.grip=gr;if(G.phase==='play'&&!menuOn(G))dirty(G,'field');}
  if(G.paused)return;
  if(!G.g||G.g.status!=='play'||G.phase!=='play')return;
  G.t+=dt;const s=Math.floor(G.t);
  if(s!==G.sec){G.sec=s;dirty(G,'ctl');}
}

/* общие действия кнопок: терминал вызывает их так же, как панель управления на стене */
function go(E,G){G.phase='play';G.t=0;G.sec=0;G.menu=false;G.win=null;G.paused=false;dirty(G);E.beep(660,.08,'sine',.05);}
/* «Начать»: если номер ещё локальный, а ученик вошёл и рейтинг включён — сначала берём номер у сервера (нет связи — играем локальным) */
function begin(E,G){
  if(G.fetching)return;
  const R=RT();
  if(!G.tid&&G.seedSrc==='rand'&&!G.rated&&R&&R.enabled(E)){
    G.fetching=true;const tok=G.rid=(G.rid||0)+1;
    Promise.resolve().then(()=>R.flush(E)).catch(()=>{}).then(()=>R.fetchSeed(E,srcOf(G))).then(seed=>{
      if(tok!==G.rid)return;
      if(seed!=null){start(E,G,seed,false,false);G.rated=true;G.seedSrc='rand';}
      G.fetching=false;go(E,G);
    }).catch(()=>{if(tok===G.rid){G.fetching=false;go(E,G);}});
    return;
  }
  go(E,G);
}
function openOne(E,G){const g=G.g;if(g.status!=='play'||G.tid)return;if(G.rated){G.burn=true;G.rated=false;}G.helped=true;E1.hint(g);dirty(G,'field');if(g.status==='win')won(E,G);dirty(G,'ctl');}
function toggleRules(G){G.win=G.win==='rules'?null:'rules';dirty(G);}
function tutDone(E,G){G.win=null;G.tut=null;if(!G.tutDone){G.tutDone=true;savePref(E,{tutorialDone:true});}dirty(G);}
const tutCb=(E,G)=>({
  back:()=>{if(G.tut.i>0){G.tut.i--;dirty(G);}},
  next:()=>{const n=VR.eintut?VR.eintut.count():1;if(G.tut.i>=n-1)tutDone(E,G);else{G.tut.i++;dirty(G);}},
  skip:()=>tutDone(E,G)});

/* ---------- раскладка доски ---------- */
/* H=0 — высота подбирается (веб). Сначала крупные подсказки при клетке не меньше minCell, иначе подсказки уменьшаются */
function geom(G,W,H,cf){
  const rules=G.g.pz.rules,hi=[],vi=[];
  rules.forEach((s,i)=>{const k=E1.showOf(s);if(k==='horiz')hi.push(i);else if(k==='vert')vi.push(i);});
  const hk=HK[hkOf(G)],fx=cf.fx,fy=cf.fy,gap=cf.gap,nH=hi.length,nV=vi.length;
  let best=null;
  for(const sc of [1,.92,.85,.78,.7,.62,.55,.48,.4]){
    const T=Math.max(14,Math.round(cf.T*hk*sc)),gx=Math.round(T*.3),gy=Math.round(T*.26);
    const hcw=3*T+gx,hch=T+gy,vcw=T+Math.round(T*.35),vch=2*T+gy;
    const under=cell=>{if(!nV)return{perV:1,UH:0};const perV=Math.max(1,Math.floor(6*cell/vcw)),rows=Math.ceil(nV/perV);return{perV,UH:gap+rows*vch};};
    let cand=null;
    if(H){
      const cmax=Math.min(cf.maxCell||999,Math.floor((H-fy)/6),Math.floor((W-fx-gap-hcw)/6));
      for(let cell=cmax;cell>=30;cell-=2){
        const u=under(cell);if(fy+6*cell+u.UH>H)continue;
        const cols=Math.floor((W-fx-6*cell-gap)/hcw),rowsH=Math.floor((H-fy)/hch);if(cols<1||cols*rowsH<nH)continue;
        cand={cell,T,gx,gy,hcw,hch,vcw,vch,perV:u.perV,UH:u.UH,cols,rowsH,H};break;
      }
    }else if(cf.hUnder){
      /* телефон: поле на всю ширину, под ним вертикальные, ещё ниже горизонтальные */
      const cell=Math.min(cf.maxCell||999,Math.floor((W-fx-(cf.mr||0))/6));if(cell<30)continue;
      const u=under(cell),cols=Math.max(1,Math.floor((W-fx-(cf.mr||0)+gx)/hcw)),rowsH=Math.max(1,Math.ceil(nH/cols)),hy=fy+6*cell+u.UH+gap;
      cand={cell,T,gx,gy,hcw,hch,vcw,vch,perV:u.perV,UH:u.UH,cols,rowsH,hUnder:true,hy,H:hy+(nH?rowsH*hch:0)+gap};
      if(cell<cf.minCell)cand._small=true;
    }else{
      for(let cols=cf.cols||1;cols>=1&&!cand;cols--){
        const cell=Math.min(cf.maxCell||999,Math.floor((W-fx-gap-cols*hcw)/6));if(cell<30)continue;
        const u=under(cell),rowsH=Math.max(1,Math.ceil(nH/cols));
        const Hn=Math.max(fy+6*cell+u.UH,fy+rowsH*hch)+gap;
        cand={cell,T,gx,gy,hcw,hch,vcw,vch,perV:u.perV,UH:u.UH,cols,rowsH,H:Hn};
        if(cell<cf.minCell)cand._small=true;
      }
    }
    if(!cand)continue;
    if(!best||cand.cell>best.cell)best=cand;
    if(cand.cell>=cf.minCell)break;
  }
  if(!best){const T=14,hch=T+4;best={cell:30,T,gx:4,gy:4,hcw:3*T+4,hch,vcw:T+5,vch:2*T+4,perV:8,UH:gap+2*T+4,cols:1,rowsH:Math.max(1,nH),H:H||fy+180+60};}
  const geo=Object.assign({fx,fy,gap,W,items:[]},best);
  const fw=6*geo.cell,hx=fx+fw+gap;
  if(geo.hUnder)hi.forEach((i,k)=>{geo.items.push({i,x:fx+(k%geo.cols)*geo.hcw,y:geo.hy+Math.floor(k/geo.cols)*geo.hch,w:3*geo.T,h:geo.T,k:'h'});});
  else hi.forEach((i,k)=>{const col=Math.floor(k/geo.rowsH),row=k%geo.rowsH;geo.items.push({i,x:hx+col*geo.hcw,y:fy+row*geo.hch,w:3*geo.T,h:geo.T,k:'h'});});
  const vy=fy+fw+gap;
  vi.forEach((i,k)=>{const col=k%geo.perV,row=Math.floor(k/geo.perV);geo.items.push({i,x:fx+col*geo.vcw,y:vy+row*geo.vch,w:geo.T,h:2*geo.T,k:'v'});});
  return geo;
}
/* прямоугольник фишки e (1…6) в клетке (c,r), локальные координаты доски */
function subPos(geo,c,r,e){
  const cs=geo.cell,sub=(cs-8)/3,k=e-1;
  return{x:geo.fx+c*cs+4+(k%3)*sub,y:geo.fy+r*cs+(cs-2*sub)/2+((k/3)|0)*sub,w:sub,h:sub};
}

/* ---------- рисование ---------- */
function rulesDraw(E,G,c,p,R,cfg){
  const fs=cfg.fs,g=cfg.gap*2,tx=Math.round(fs*.85),T=Math.round(fs*1.8);
  c.fillStyle='#0b1020';c.fillRect(0,0,R.w,R.h);
  const by=R.h-g-cfg.bh;
  btn(p,g,by,R.w-2*g,cfg.bh,'Назад',()=>{G.win=null;dirty(G);},{size:fs,bg:'#475569'});
  p.text('Правила игры «Эйнштейн»',g,g/2,{size:Math.round(fs*1.2),bold:true,color:'#fde68a',maxW:R.w-2*g});
  let y=g/2+Math.round(fs*1.2*1.4);
  for(const r of RULES(!!cfg.web)){
    if(r.ex){const w=r.ex.t==='under'?T:3*T,h=r.ex.t==='under'?2*T:T;drawHint(c,r.ex,g,y,T,false);
      y=Math.max(p.text(r.t,g+w+g,y,{size:tx,color:'#f1f5f9',maxW:R.w-3*g-w,lh:Math.round(tx*1.28),maxY:by-6}),y+h)+Math.round(fs*.3);}
    else y=p.text(r.t,g,y,{size:tx,color:'#f1f5f9',maxW:R.w-2*g,lh:Math.round(tx*1.28),maxY:by-6})+Math.round(fs*.3);
  }
}
/* пометка о зачёте: только когда рейтинг включён (флаг школы или привязанное устройство) */
function note(E,G){const R=RT();if(G.tid||!R||!R.visible(E))return '';return G.rated?' · в рейтинг':(G.burn?' · помощь, в зачёт не идёт':' · вне рейтинга');}
function menuDraw(E,G,c,p,R,cfg){
  const fs=cfg.fs,bh=cfg.bh,gp=cfg.gap,idle=G.phase==='idle',g=G.g,arena=!!(VR.ROOMS&&VR.ROOMS.arena);
  c.fillStyle='#0b1020';c.fillRect(0,0,R.w,R.h);
  const ww=Math.min(R.w-2*gp,fs*34),pad=Math.round(fs*.6),x0=Math.round((R.w-ww)/2),bw=ww-2*pad,half=Math.floor((bw-gp)/2);
  const titleH=Math.round(fs*1.5),stH=Math.round(fs*1.3)*((!G.tutDone?3:2)+(g.status==='lose'?2:0)),rows=cfg.toggle?5:4;
  const hh=pad*2+titleH+stH+rows*(bh+gp)-gp;
  const y0=Math.max(gp,Math.round((R.h-hh)/2));
  c.fillStyle='#111a33';c.beginPath();c.roundRect?c.roundRect(x0,y0,ww,hh,28):c.rect(x0,y0,ww,hh);c.fill();
  c.lineWidth=6;c.strokeStyle='#818cf8';c.beginPath();c.roundRect?c.roundRect(x0+3,y0+3,ww-6,hh-6,26):c.rect(x0+3,y0+3,ww-6,hh-6);c.stroke();
  let y=y0+pad;const x=x0+pad;
  p.text(idle?'Эйнштейн':g.status==='lose'?'Проигрыш':'Пауза',x,y,{size:Math.round(fs*1.2),bold:true,color:g.status==='lose'?'#fca5a5':'#fde68a',maxW:bw});y+=titleH;
  const stTxt=(g.status==='lose'&&G.msg?G.msg+'\n':'')+'Головоломка № '+g.pz.seed+note(E,G)+(G.fetching?' · запрашиваю номер…':'')+(!G.tutDone?'\nВпервые? Начни с обучения — оно короткое.':'');
  p.text(stTxt,x,y,{size:Math.round(fs*.85),color:'#cbd5e1',maxW:bw,lh:Math.round(fs*1.1),maxY:y+stH});y+=stH;
  if(idle)btn(p,x,y,bw,bh,'▶ Начать',()=>begin(E,G),{size:fs,bg:'#15803d',disabled:!!G.fetching});
  else if(g.status==='lose')btn(p,x,y,bw,bh,'Посмотреть поле',()=>{G.menu=false;dirty(G);},{size:fs,bg:'#475569'});
  else btn(p,x,y,bw,bh,'▶ Продолжить',()=>resume(G),{size:fs,bg:'#15803d'});
  y+=bh+gp;
  if(!G.tid){
    if(idle)btn(p,x,y,bw,bh,'Новая партия',()=>fresh(E,G,false),{size:fs,bg:'#b45309',disabled:!!G.fetching});
    else{
      btn(p,x,y,half,bh,'Новая партия',()=>fresh(E,G),{size:fs,bg:'#b45309',disabled:!!G.fetching});
      btn(p,x+half+gp,y,half,bh,'Сначала',()=>start(E,G,0,true),{size:fs,bg:'#475569'});
    }
    y+=bh+gp;
  }
  btn(p,x,y,half,bh,'Обучение',()=>{G.win='tut';G.tut={i:0};dirty(G);},{size:fs,bg:G.tutDone?'#334155':'#b45309'});
  btn(p,x+half+gp,y,half,bh,'Правила',()=>{G.win='rules';dirty(G);},{size:fs,bg:'#334155'});y+=bh+gp;
  const sw=Math.round(bh*1.3);
  p.text('Размер подсказок',x,y+Math.round((bh-fs)/2),{size:Math.round(fs*.9),color:'#cbd5e1',maxW:bw-2*sw-2*gp});
  btn(p,x+bw-2*sw-gp,y,sw,bh,'A−',()=>{G.hk=Math.max(0,hkOf(G)-1);savePref(E,{hk:G.hk});dirty(G);},{size:fs,bg:'#334155',disabled:hkOf(G)<=0});
  btn(p,x+bw-sw,y,sw,bh,'A+',()=>{G.hk=Math.min(HK.length-1,hkOf(G)+1);savePref(E,{hk:G.hk});dirty(G);},{size:fs,bg:'#334155',disabled:hkOf(G)>=HK.length-1});
  y+=bh+gp;
  if(cfg.toggle)btn(p,x,y,bw,bh,cfg.toggle.label,()=>cfg.toggle.fn(),{size:fs,bg:'#475569'});
  void arena;
}
function boardDraw(E,G,c,p,R,cfg){
  const g=G.g,P=g.P,over=g.status==='lose';
  const geo=cfg.web&&!cfg.fixedH?geom(G,R.w,0,cfg):geom(G,R.w,R.h,cfg);G.geo=geo;
  const cs=geo.cell,fx=geo.fx,fy=geo.fy,fw=6*cs;
  c.font='bold '+Math.max(14,Math.round(cs*.17))+'px sans-serif';c.fillStyle='#94a3b8';c.textAlign='center';c.textBaseline='middle';
  for(let i=0;i<N;i++)c.fillText(String(i+1),fx+i*cs+cs/2,fy/2);
  const sub=(cs-8)/3,red=!!G.grip;
  for(let r=0;r<N;r++){
    c.fillStyle='#64748b';c.font='bold '+Math.max(14,Math.round(cs*.2))+'px sans-serif';c.textAlign='center';c.fillText('ABCDEF'[r],fx/2,fy+r*cs+cs/2);
    for(let col=0;col<N;col++){
      const x=fx+col*cs,y=fy+r*cs;
      c.fillStyle=over?'#2b1b1b':(r+col)%2?'#16213e':'#1b2a4e';c.fillRect(x+2,y+2,cs-4,cs-4);
      if(P.defined(col,r)){
        c.fillStyle='#14532d';c.fillRect(x+2,y+2,cs-4,cs-4);
        const pd=Math.round(cs*.14);E1.drawTile(c,r,P.value(col,r),x+pd,y+pd,cs-2*pd,'#f0fdf4');
      }else{
        c.strokeStyle='#64748b';c.lineWidth=1.5;c.beginPath();
        const gy=y+(cs-2*sub)/2;
        for(let i=0;i<=3;i++){c.moveTo(x+4+i*sub,gy);c.lineTo(x+4+i*sub,gy+2*sub);}
        for(let j=0;j<=2;j++){c.moveTo(x+4,gy+j*sub);c.lineTo(x+4+3*sub,gy+j*sub);}
        c.stroke();
        for(let e=1;e<=N;e++){
          if(!P.can(col,r,e))continue;
          const s=subPos(geo,col,r,e);
          const hov=p.area(s.x,s.y,s.w,s.h,h=>click(E,G,h,col,r,e),over||g.status!=='play'||G.phase!=='play');
          if(hov){/* цвет подсветки = что сделает курок: зелёный — выбрать, красный (grip зажат) — убрать */c.fillStyle=red?'#991b1b':'#166534';c.fillRect(s.x+1,s.y+1,s.w-2,s.h-2);}
          E1.drawTile(c,r,e,s.x+2,s.y+2,s.w-4,hov?'#fde68a':'#cbd5e1');
        }
      }
    }
  }
  /* яркие линии поля 6×6 */
  c.strokeStyle='#e2e8f0';c.lineWidth=Math.max(2,Math.round(cs*.02));c.beginPath();
  for(let i=0;i<=N;i++){c.moveTo(fx+i*cs,fy);c.lineTo(fx+i*cs,fy+fw);c.moveTo(fx,fy+i*cs);c.lineTo(fx+fw,fy+i*cs);}
  c.stroke();c.lineWidth=Math.max(3,Math.round(cs*.035));c.strokeRect(fx,fy,fw,fw);
  /* подсказки: горизонтальные справа от поля, вертикальные под ним */
  for(const it of geo.items){
    const dim=G.used.has(it.i);
    p.area(it.x-4,it.y-4,it.w+8,it.h+8,()=>{if(G.used.has(it.i))G.used.delete(it.i);else G.used.add(it.i);dirty(G,'hints');},G.phase!=='play'||g.status!=='play');
    drawHint(c,g.pz.rules[it.i],it.x,it.y,geo.T,dim);
  }
}
/* доска: поле + подсказки, а до старта, при паузе и по кнопке «Меню» — окно меню; cfg — CFG.wall / CFG.term / настройки веба (+ toggle:{label,fn}) */
function drawBoard(E,G,c,p0,rect,cfg){
  within(p0,c,rect,p=>{
    const R={w:rect.w,h:rect.h};
    if(!G.g)return;
    if(G.win==='tut'&&VR.eintut){G.tut=G.tut||{i:0};return VR.eintut.draw(c,p,{x:0,y:0,w:R.w,h:R.h},cfg,G,tutCb(E,G));}
    if(G.win==='rules')return rulesDraw(E,G,c,p,R,cfg);
    if(menuOn(G)){G.geo=null;return menuDraw(E,G,c,p,R,cfg);}
    boardDraw(E,G,c,p,R,cfg);
  });
}
/* шапка терминала и вебу не нужна (там DOM); стена — своя вертикальная панель управления */
function drawCtl(E,G,c,p0,rect){
  within(p0,c,rect,p=>{
  const g=G.g,X=24,W=p.W-48;
  p.text('Эйнштейн',X,14,{size:46,bold:true,maxW:W-200});
  p.text(fmtT(G.t),p.W-X-170,18,{size:46,bold:true,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#fde68a',maxW:170});
  const live=G.phase==='play'&&g.status==='play';
  const st=g.status==='lose'?G.msg:g.status==='win'?G.msg:(G.msg||(G.phase==='idle'?'Меню — на большом экране. Головоломка № '+g.pz.seed+note(E,G):'Открой все фишки: исключай лишние по подсказкам.'));
  p.text(st,X,80,{size:28,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#cbd5e1',maxW:W,maxY:200});
  const arena=!!(VR.ROOMS&&VR.ROOMS.arena);
  if(G.phase==='idle')btn(p,X,206,W,64,'▶ Начать',()=>begin(E,G),{size:34,bg:'#15803d',disabled:!!G.fetching});
  else if(live&&!G.tid)btn(p,X,206,W,64,G.paused?'▶ Продолжить':'⏸ Пауза',()=>G.paused?resume(G):setPause(G,true),{size:30,bg:G.paused?'#15803d':'#334155'});
  else if(g.status==='win'&&!G.tid){const hw=Math.floor((W-14)/2);
    btn(p,X,206,hw,96,'Новая партия',()=>fresh(E,G),{size:32,bg:'#b45309',disabled:!!G.fetching});
    btn(p,X+hw+14,206,hw,96,'Меню',()=>{if(G.menu)resume(G);else openMenu(G);},{size:32,bg:'#334155'});}
  else btn(p,X,206,W,64,'Меню',()=>{if(G.menu)resume(G);else openMenu(G);},{size:30,bg:'#334155'});
  if(G.phase!=='idle'&&!G.tid&&!(g.status==='win'))btn(p,X,284,W,64,'Открыть клетку (без зачёта)',()=>openOne(E,G),{size:26,bg:'#1e293b',disabled:g.status!=='play'||G.paused});
  if(arena)btn(p,X,440,W,64,'В зал',()=>E.goRoom('arena'),{size:26,bg:'#475569'});
  p.text((G.tid?'Турнирная партия. ':'')+'Курок — выбрать фишку, боковая кнопка (grip) + курок — убрать.',X,520,{size:22,color:'#64748b',maxW:W,maxY:p.H-8});
  });
}
/* шапка терминала: заголовок, время, «Начать» / «Пауза» + «Открыть клетку» / «Меню» */
function drawBar(E,G,c,p0,rect,cfg){
  within(p0,c,rect,p=>{
  const g=G.g,bh=cfg.bh,y=Math.round((rect.h-bh)/2),live=G.phase==='play'&&g.status==='play';
  p.text('Эйнштейн',24,Math.round((rect.h-60)/2),{size:58,bold:true,maxW:380});
  p.text(fmtT(G.t),410,Math.round((rect.h-60)/2),{size:58,bold:true,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#fde68a',maxW:230});
  let x=rect.w-24;
  const put=(w,label,fn,t)=>{x-=w;btn(p,x,y,w,bh,label,fn,t);x-=cfg.gap;};
  if(G.phase==='idle')put(560,'▶ Начать',()=>begin(E,G),{size:cfg.fs,bg:'#15803d',disabled:!!G.fetching});
  else{
    if(live&&!G.tid)put(420,'Открыть клетку',()=>openOne(E,G),{size:cfg.fs,bg:'#1e293b',disabled:G.paused});
    if(live&&!G.tid)put(360,G.paused?'▶ Дальше':'⏸ Пауза',()=>G.paused?resume(G):setPause(G,true),{size:cfg.fs,bg:G.paused?'#15803d':'#334155'});
    else{
      put(300,'Меню',()=>{if(G.menu)resume(G);else openMenu(G);},{size:cfg.fs,bg:'#334155'});
      if(g.status==='win'&&!G.tid)put(460,'Новая партия',()=>fresh(E,G),{size:cfg.fs,bg:'#b45309',disabled:!!G.fetching});
    }
  }
  });
}

/* ---------- холст веба: тот же интерфейс панели (text/area/button), что и у панелей движка ---------- */
function wrapLines(c,s,maxW){
  const words=String(s).split(/\s+/),out=[];let cur='';
  for(const w of words){const t=cur?cur+' '+w:w;if(cur&&c.measureText(t).width>maxW){out.push(cur);cur=w;}else cur=t;}
  if(cur)out.push(cur);return out;
}
function canvasPanel(cv){
  const p={W:cv.width,H:cv.height,cv,ctx:cv.getContext('2d'),btns:[],over:[],hover:-1};
  p.text=(str,x,y,t)=>{
    t=t||{};const c=p.ctx,size=t.size||20;c.font=(t.bold?'bold ':'')+size+'px sans-serif';c.fillStyle=t.color||'#e8efff';
    c.textAlign='left';c.textBaseline='top';const lh=t.lh||Math.round(size*1.25),maxW=t.maxW||(p.W-x-10);let yy=y;
    for(const para of String(str).split('\n'))for(const ln of wrapLines(c,para,maxW)){if(t.maxY&&yy+lh>t.maxY){p.over.push('обрезан: '+ln.slice(0,30));break;}c.fillText(ln,x,yy);yy+=lh;}
    return yy;
  };
  p.area=(x,y,w,h,fn,dis)=>{const i=p.btns.length;p.btns.push({x,y,w,h,fn,disabled:!!dis});return p.hover===i&&!dis;};
  p.button=(x,y,w,h,label,fn,t)=>{
    t=t||{};const c=p.ctx,hov=p.area(x,y,w,h,fn,t.disabled);
    if(x<0||y<0||x+w>p.W+1||y+h>p.H+1)p.over.push('кнопка за краем: '+label);
    c.fillStyle=t.disabled?'#283250':(t.bg||'#2563eb');c.beginPath();c.roundRect(x,y,w,h,Math.min(14,h/4));c.fill();
    if(hov){c.fillStyle='rgba(255,255,255,.22)';c.fill();}
    let size=t.size||20,lines;
    for(;;){c.font='bold '+size+'px sans-serif';lines=wrapLines(c,label,w-14);const wide=lines.some(l=>c.measureText(l).width>w-10);if((lines.length*size*1.15<=h-6&&!wide)||size<=11)break;size-=1;}
    c.fillStyle=t.disabled?'#7d88a8':(t.fg||'#fff');c.textAlign='center';c.textBaseline='middle';
    const lh=size*1.15;let yy=y+h/2-(lines.length-1)*lh/2;for(const l of lines){c.fillText(l,x+w/2,yy);yy+=lh;}
    c.textAlign='left';c.textBaseline='top';
  };
  p.begin=()=>{p.btns=[];p.over=[];p.ctx.textBaseline='top';};
  return p;
}
VR.einplay={create,start,fresh,note,click,tick,drawBoard,drawField:drawBoard,drawCtl,drawBar,setPause,resume,openMenu,begin,openOne,toggleRules,savePref,fmtT,HK,CFG,geom,subPos,menuOn,canvasPanel,btn};
})();

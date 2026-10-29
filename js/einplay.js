/* einplay.js — ядро игры «Эйнштейн» отдельно от стены: состояние партии G и рисование поля, подсказок и управления в прямоугольнике rect
   (пиксели текстуры). Стена (js/einroom.js) и терминал рисуют одно и то же через VR.einplay. Логика головоломки — js/einstein.js.
   G: g,t,helped,sec,sent,used,phase,paused,mode,hk,tid,mid,msg,showRules,rated (номер выдан сервером, решение пойдёт в зачёт),burn (помощь по выданному номеру: отправить helped:1),seedSrc ('rand'|'set'),fetching,rid. opt={prefKey, onDirty(что), state}.
   onDirty('field'|'hints'|'ctl'|'favs') — перерисовать часть; без аргумента — всё. Результат отдаётся в VR.games.finish, если он есть. */
(function(){
'use strict';
const VR=window.VR,E1=VR.einstein,N=E1.N;
const fmtT=s=>{s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
/* геометрия поля (в пикселях полотна 2048 x 1445) */
const FX=100,FY=24,CW=316,CH=232,DW=2048,DH=1445;
const HK=[.9,1.2,1.5];/* ступени размера подсказок */
const drawHint=E1.drawHint;
const RT=()=>VR.einrate||null;   /* зачётная игра (js/einrate.js); нет модуля или флаг выключен — игра локальная */
/* правила — по тексту оригинала Einstein 2.0 (res/rules_ru.txt), мышь заменена курком; ex — пример подсказки */
const RULES=[
  {t:'Надо открыть все фишки в квадрате 6×6. В каждой строке фишки одного типа: в первой — арабские цифры, во второй — латинские буквы, в третьей — римские цифры, в четвёртой — игральные кости, в пятой — геометрические фигуры, в шестой — математические символы.'},
  {t:'Открывать фишки надо методом исключения. Пока фишка не открыта, на её месте показаны все возможные варианты. Курок в режиме «выбрать» открывает фишку, в режиме «убрать» исключает её (хват во время курка — наоборот).'},
  {t:'Вертикальная подсказка: эти две фишки находятся в одной колонке.',ex:{t:'under',a:[1,2],b:[5,1]}},
  {t:'Красная двойная стрелка: фишки в соседних колонках, какая левее, а какая правее — неизвестно.',ex:{t:'near',a:[3,6],b:[5,5]}},
  {t:'Три красные точки: левая фишка находится в колонке левее правой, на любом расстоянии.',ex:{t:'dir',a:[3,3],b:[2,2]}},
  {t:'Синяя стрелка над тремя фишками: средняя стоит между двумя другими, все три в соседних колонках; какая из крайних левее — неизвестно.',ex:{t:'btw',a:[5,5],c:[4,4],b:[0,5]}},
  {t:'Использованную подсказку нажми — она потускнеет. Ошибка (убрана верная фишка или выбрана неверная) — проигрыш.'}];

const dirty=(G,w)=>{try{if(G.opt&&G.opt.onDirty)G.opt.onDirty(w);}catch(e){}};
const hkOf=G=>G.hk===undefined?1:G.hk;
function savePref(E,patch){try{if(VR.games&&VR.games.setPrefs)VR.games.setPrefs(E.student&&E.student.id,patch);}catch(e){}}
/* рисование в прямоугольнике rect: начало координат сдвигается в rect, области нажатия пересчитываются в пиксели панели.
   dw,dh — расчётный размер (поле вписывается с сохранением пропорций); без них — размер rect как есть */
function within(p,c,rect,dw,dh,fn){
  const s=dw?Math.min(rect.w/dw,rect.h/dh):1,W=dw||rect.w,H=dh||rect.h;
  const ox=rect.x+(rect.w-W*s)/2,oy=rect.y+(rect.h-H*s)/2;
  const q=Object.create(p);q.W=W;q.H=H;
  const old=p.area;
  p.area=(x,y,w,h,f,dis)=>old(ox+x*s,oy+y*s,w*s,h*s,f,dis);
  c.save();c.translate(ox,oy);c.scale(s,s);
  try{fn(q);}finally{c.restore();p.area=old;}
}

function create(E,opt){
  opt=opt||{};
  const G=opt.state||{};
  G.opt=opt;G.g=null;G.t=0;G.helped=false;G.sec=0;G.sent=false;G.used=new Set();G.phase='idle';G.paused=false;
  G.tid=null;G.mid=null;G.msg='';G.showRules=false;G.rated=false;G.seedSrc=null;G.mode='pick';G.hk=1;
  const pf=VR.games&&VR.games.prefs?VR.games.prefs(E&&E.student&&E.student.id):{hk:1,mode:'pick',view:'wall'};
  G.hk=pf.hk;G.mode=pf.mode;G.view=pf.view;
  return G;
}
/* begin===false — партия приготовлена, но не идёт: игра не включается, пока не нажато «Начать» */
function start(E,G,seed,again,begin){
  G.rid=(G.rid||0)+1;G.fetching=false;   /* устаревший ответ сервера на прежний запрос номера игнорируется */
  if(!again){G.rated=false;G.burn=false;G.seedSrc=seed===undefined?'rand':'set';}   /* «Сначала» — тот же номер, зачётность сохраняется */
  const pz=again&&G.g?G.g.pz:E1.generate(seed);
  G.g=E1.newGame(pz);G.t=0;G.helped=false;G.sec=0;G.sent=false;G.used=new Set();
  G.phase=begin===false?'idle':'play';G.paused=false;G.showRules=false;
  G.msg='';dirty(G);dirty(G,'favs');
}
const srcOf=G=>G.view==='term'?'term':'wall';
/* «Новая»: у вошедшего ученика вне турнира номер выдаёт сервер (G.rated=true); нет связи / 404 / гость — локальный номер, вне рейтинга */
function fresh(E,G,begin){
  const R=RT();
  if(G.tid||!R||!R.enabled(E)){start(E,G,undefined,false,begin);return;}
  if(G.fetching)return;
  start(E,G,undefined,false,begin);   /* пока ждём ответ, показана локальная головоломка; ответ её заменит */
  G.fetching=true;G.msg='Запрашиваю головоломку…';dirty(G,'ctl');
  const tok=G.rid;
  try{R.flush(E).catch(()=>{});}catch(e){}
  R.fetchSeed(E,srcOf(G)).then(seed=>{
    if(tok!==G.rid)return;
    if(seed!=null){start(E,G,seed,false,begin);G.rated=true;G.seedSrc='rand';}
    else{G.fetching=false;G.msg='';dirty(G,'ctl');}
  }).catch(()=>{if(tok===G.rid){G.fetching=false;G.msg='';dirty(G,'ctl');}});
}
function setPause(G,v){G.paused=v;dirty(G);}
function lost(E,G){
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
function click(E,G,h,c,r,e){
  const g=G.g;if(g.status!=='play'||G.phase!=='play'||G.paused)return;
  const alt=!!(h&&h.src&&h.src.gamepad&&h.src.gamepad.buttons&&h.src.gamepad.buttons[1]&&h.src.gamepad.buttons[1].pressed);
  const btn=(G.mode==='pick')!==alt?1:3;
  const res=E1.click(g,c,r,e,btn);
  if(res==='noop')return;
  dirty(G,'field');dirty(G,'ctl');
  if(res==='fail'){E.beep(180,.3,'sawtooth',.06);E.buzz(h,.8,150);G.msg=G.tid?'Ошибка — в турнире это поражение в матче.':'Ошибка: так не может быть. Начни сначала или возьми новую.';lost(E,G);}
  else if(res==='win')won(E,G);
  else E.beep(btn===1?700:520,.04,'sine',.04);
}
/* шаг времени; меню шлема включает паузу (кроме турнира) */
function tick(E,G,dt){
  if(G.g&&E.menuOpen&&!G.tid&&!G.paused&&G.phase==='play'&&G.g.status==='play')setPause(G,true);
  if(G.paused)return;
  if(!G.g||G.g.status!=='play'||G.phase!=='play')return;
  G.t+=dt;const s=Math.floor(G.t);
  if(s!==G.sec){G.sec=s;dirty(G,'ctl');}
}

/* общие действия кнопок: терминал вызывает их так же, как панель управления на стене */
function go(E,G){G.phase='play';G.t=0;G.sec=0;dirty(G);E.beep(660,.08,'sine',.05);}
/* «Начать»: если номер ещё локальный, а ученик вошёл и рейтинг включён — сначала берём номер у сервера (нет связи — играем локальным) */
function begin(E,G){
  if(G.fetching)return;
  const R=RT();
  if(!G.tid&&G.seedSrc==='rand'&&!G.rated&&R&&R.enabled(E)){
    G.fetching=true;const tok=G.rid=(G.rid||0)+1;
    try{R.flush(E).catch(()=>{});}catch(e){}
    R.fetchSeed(E,srcOf(G)).then(seed=>{
      if(tok!==G.rid)return;
      if(seed!=null){start(E,G,seed,false,false);G.rated=true;G.seedSrc='rand';}
      G.fetching=false;go(E,G);
    }).catch(()=>{if(tok===G.rid){G.fetching=false;go(E,G);}});
    return;
  }
  go(E,G);
}
function openOne(E,G){const g=G.g;if(g.status!=='play'||G.tid)return;if(G.rated){G.burn=true;G.rated=false;}G.helped=true;E1.hint(g);dirty(G,'field');if(g.status==='win')won(E,G);dirty(G,'ctl');}
function toggleMode(E,G){G.mode=G.mode==='pick'?'excl':'pick';savePref(E,{mode:G.mode});dirty(G,'ctl');}
function toggleRules(G){G.showRules=!G.showRules;dirty(G,'hints');dirty(G,'ctl');}

function pauseDraw(c,p,sz){c.fillStyle='#0b1020';c.fillRect(0,0,p.W,p.H);c.fillStyle='#fde68a';c.font='bold '+sz+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('Пауза',p.W/2,p.H/2);}
function rulesDraw(c,p,k){
  k=k||1;const f=v=>Math.round(v*k);
  p.text('Правила игры «Эйнштейн»',30,14,{size:f(56),bold:true,maxW:p.W-60});
  let y=f(100);const T=f(76);
  for(const r of RULES){
    if(r.ex){const w=r.ex.t==='under'?T:3*T,h=r.ex.t==='under'?2*T:T;drawHint(c,r.ex,30,y,T,false);
      y=Math.max(p.text(r.t,30+w+24,y,{size:f(38),color:'#f1f5f9',maxW:p.W-84-w,lh:f(46)}),y+h)+f(18);}
    else y=p.text(r.t,30,y,{size:f(38),color:'#f1f5f9',maxW:p.W-60,lh:f(46)})+f(18);
  }
}
/* пометка о зачёте: только когда рейтинг включён (флаг школы или привязанное устройство) */
function note(E,G){const R=RT();if(G.tid||!R||!R.visible(E))return '';return G.rated?' · в рейтинг':(G.burn?' · помощь, в зачёт не идёт':' · вне рейтинга');}
function drawField(E,G,c,p0,rect){
  within(p0,c,rect,DW,DH,p=>{
  if(G.paused&&G.phase==='play')return pauseDraw(c,p,150);
  const g=G.g,P=g.P,over=g.status==='lose';
  c.font='bold 30px sans-serif';c.fillStyle='#94a3b8';c.textAlign='center';c.textBaseline='middle';
  for(let i=0;i<N;i++)c.fillText(String(i+1),FX+i*CW+CW/2,12);
  for(let r=0;r<N;r++){
    c.fillStyle='#64748b';c.font='bold 38px sans-serif';c.textAlign='center';c.fillText('ABCDEF'[r],FX/2,FY+r*CH+CH/2);
    for(let col=0;col<N;col++){
      const x=FX+col*CW,y=FY+r*CH;
      c.fillStyle=over?'#2b1b1b':(r+col)%2?'#16213e':'#1b2a4e';c.fillRect(x+3,y+3,CW-6,CH-6);
      if(G.phase==='idle')continue;
      if(P.defined(col,r)){
        c.fillStyle='#14532d';c.fillRect(x+3,y+3,CW-6,CH-6);
        E1.drawTile(c,r,P.value(col,r),x+(CW-170)/2,y+(CH-170)/2,170,'#f0fdf4');
      }else{
        /* тонкая сетка 3×2 внутри клетки: у каждой фишки своё место, они не скучиваются */
        c.strokeStyle='#64748b';c.lineWidth=2;c.beginPath();
        for(let i=0;i<=3;i++){c.moveTo(x+8+i*100,y+16);c.lineTo(x+8+i*100,y+224);}
        for(let j=0;j<=2;j++){c.moveTo(x+8,y+16+j*104);c.lineTo(x+308,y+16+j*104);}
        c.stroke();
        for(let e=1;e<=N;e++){
          const k=e-1,tx=x+8+(k%3)*100,ty=y+16+((k/3)|0)*104;
          if(!P.can(col,r,e))continue;
          const hov=p.area(tx,ty,100,100,h=>click(E,G,h,col,r,e),over||g.status!=='play'||G.phase!=='play');
          if(hov){/* цвет подсветки = что сделает курок: красный — убрать фишку, зелёный — выбрать её */c.fillStyle=G.mode==='pick'?'#166534':'#991b1b';c.fillRect(tx+2,ty+2,96,96);}
          E1.drawTile(c,r,e,tx+2,ty+2,96,hov?'#fde68a':'#cbd5e1');
        }
      }
    }
  }
  /* яркие линии поля 6×6 (контрастнее тонкой сетки внутри клеток) */
  c.strokeStyle='#e2e8f0';c.lineWidth=5;c.beginPath();
  for(let i=0;i<=N;i++){c.moveTo(FX+i*CW,FY);c.lineTo(FX+i*CW,FY+N*CH);c.moveTo(FX,FY+i*CH);c.lineTo(FX+N*CW,FY+i*CH);}
  c.stroke();c.lineWidth=9;c.strokeRect(FX,FY,N*CW,N*CH);
  if(G.phase==='idle'){
    c.fillStyle='rgba(8,12,28,.72)';c.fillRect(FX,FY,N*CW,N*CH);
    c.fillStyle='#fde68a';c.font='bold 76px sans-serif';c.textAlign='center';c.textBaseline='middle';
    c.fillText('Нажми «Начать»',FX+N*CW/2,FY+N*CH/2-30);
    c.fillStyle='#cbd5e1';c.font='36px sans-serif';c.fillText('Правила — на панели справа. Партия № '+g.pz.seed,FX+N*CW/2,FY+N*CH/2+50);
  }
  });
}
/* K — множитель размера подсказок поверх ступени G.hk (по умолчанию 1) */
function drawHints(E,G,c,p0,rect,K0,RK){
  within(p0,c,rect,0,0,p=>{
  if(G.paused&&G.phase==='play')return pauseDraw(c,p,110);
  if(G.phase==='idle'||G.showRules)return rulesDraw(c,p,RK);
  const g=G.g,rules=g.pz.rules,K=HK[hkOf(G)]*(K0||1),T=Math.round(84*K),sc=v=>Math.round(v*K);
  p.text('Подсказки',30,14,{size:48,bold:true,maxW:700});
  /* размер подсказок: три ступени, кнопки A− / A+ */
  p.button(p.W-30-230,10,104,60,'A−',()=>{G.hk=Math.max(0,hkOf(G)-1);savePref(E,{hk:G.hk});dirty(G,'hints');},{size:34,bg:'#334155',disabled:hkOf(G)<=0});
  p.button(p.W-30-110,10,104,60,'A+',()=>{G.hk=Math.min(HK.length-1,hkOf(G)+1);savePref(E,{hk:G.hk});dirty(G,'hints');},{size:34,bg:'#334155',disabled:hkOf(G)>=HK.length-1});
  p.text('Нажми подсказку, чтобы отметить её как использованную',30,72,{size:26,color:'#94a3b8',maxW:p.W-60});
  const horiz=[],vert=[];
  rules.forEach((s,i)=>{const k=E1.showOf(s);if(k==='horiz')horiz.push(i);else if(k==='vert')vert.push(i);});
  const dim=i=>G.used.has(i);
  const toggle=i=>()=>{if(G.used.has(i))G.used.delete(i);else G.used.add(i);dirty(G,'hints');};
  const BW=3*T,cw=BW+sc(40),ch=T+sc(26),perH=Math.max(1,Math.floor((p.W-30)/cw)),vstep=T+sc(36),perV=Math.max(1,Math.floor((p.W-30)/vstep));
  let y=130;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('По горизонтали:',30,y+8);y+=48;
  horiz.forEach((i,k)=>{const x=30+(k%perH)*cw,yy=y+((k/perH)|0)*ch;p.area(x-6,yy-6,BW+12,T+12,toggle(i));drawHint(c,rules[i],x,yy,T,dim(i));});
  y+=Math.ceil(horiz.length/perH)*ch+20;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('По вертикали (в одной колонке):',30,y+8);y+=48;
  vert.forEach((i,k)=>{const x=30+(k%perV)*vstep,yy=y+((k/perV)|0)*(2*T+sc(26));p.area(x-4,yy-4,T+8,2*T+8,toggle(i));drawHint(c,rules[i],x,yy,T,dim(i));});
  const open=rules.filter(s=>s.t==='open');
  if(open.length&&p.H>0)p.text('Сразу открыто фишек: '+open.length,30,p.H-60,{size:28,color:'#94a3b8',maxW:700});
  });
}
/* layout зарезервирован под другую раскладку (терминал); сейчас одна — как на стене */
function drawCtl(E,G,c,p0,rect,layout){
  void layout;
  within(p0,c,rect,0,0,p=>{
  const g=G.g,X=24,W=p.W-48;
  p.text('Эйнштейн',X,14,{size:46,bold:true,maxW:W-200});
  p.text(fmtT(G.t),p.W-X-170,18,{size:46,bold:true,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#fde68a',maxW:170});
  const canPause=G.phase==='play'&&g.status==='play'&&!G.tid;
  const st=g.status==='lose'?G.msg:g.status==='win'?G.msg:(G.msg||'Открой все фишки: исключай лишние по подсказкам.');
  p.text(st,X,80,{size:28,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#cbd5e1',maxW:W,maxY:canPause?154:200});
  const bw=(W-14)/2,arena=!!(VR.ROOMS&&VR.ROOMS.arena);
  if(G.phase==='idle'){
    p.button(X,206,W,64,'▶ Начать',()=>begin(E,G),{size:34,bg:'#15803d',disabled:!!G.fetching});
    if(!G.tid)p.button(X,284,W,64,'Другая головоломка',()=>fresh(E,G,false),{size:28,bg:'#b45309',disabled:!!G.fetching});
    p.button(X,440,bw,64,'Правила',()=>{},{size:26,bg:'#334155',disabled:true});
    if(arena)p.button(X+bw+14,440,bw,64,'В зал',()=>E.goRoom('arena'),{size:26,bg:'#475569'});
    p.text('Головоломка № '+g.pz.seed+note(E,G),X,520,{size:22,color:'#64748b',maxW:W});return;
  }
  if(canPause)p.button(X,156,W,46,G.paused?'▶ Продолжить':'⏸ Пауза',()=>setPause(G,!G.paused),{size:26,bg:G.paused?'#15803d':'#334155'});
  p.button(X,206,W,64,'Курок: '+(G.mode==='pick'?'ВЫБРАТЬ фишку':'УБРАТЬ фишку'),()=>{G.mode=G.mode==='pick'?'excl':'pick';savePref(E,{mode:G.mode});dirty(G,'ctl');},{size:30,bg:G.mode==='pick'?'#166534':'#991b1b'});
  p.button(X,284,bw,64,'Сначала',()=>start(E,G,0,true),{size:30,bg:'#475569',disabled:!!G.tid});
  p.button(X+bw+14,284,bw,64,'Новая',()=>fresh(E,G),{size:30,bg:'#b45309',disabled:!!G.tid||!!G.fetching});
  p.button(X,362,W,64,'Открыть одну клетку (без зачёта)',()=>openOne(E,G),{size:26,bg:'#1e293b',disabled:g.status!=='play'||!!G.tid||G.paused});
  p.button(X,440,arena?bw:W,64,G.showRules?'Подсказки':'Правила',()=>{G.showRules=!G.showRules;dirty(G,'hints');dirty(G,'ctl');},{size:26,bg:'#334155'});
  if(arena)p.button(X+bw+14,440,bw,64,'В зал',()=>E.goRoom('arena'),{size:26,bg:'#475569'});
  p.text((G.tid?'Турнирная партия. ':'')+'Хват во время курка — наоборот. Головоломка № '+g.pz.seed+note(E,G),X,520,{size:22,color:'#64748b',maxW:W});
  });
}
VR.einplay={create,start,fresh,note,click,tick,drawField,drawHints,drawCtl,setPause,begin,openOne,toggleMode,toggleRules,savePref,fmtT,HK};
})();

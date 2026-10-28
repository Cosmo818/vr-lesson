/* einroom.js — комната «Эйнштейн»: головоломка 6x6 на трёх панелях (поле, подсказки, управление). Логика — js/einstein.js.
   Курок на фишку: действие по режиму («Исключать» или «Выбирать»); хват (правая кнопка мыши) во время курка — наоборот.
   Ошибка — проигрыш (можно начать сначала ту же головоломку или новую). Время идёт, пока партия не закончена.
   Результат победы отдаётся в VR.games.finish (js/games.js), если он есть. */
(function(){
'use strict';
const VR=window.VR,E1=VR.einstein,ROOMS=VR.ROOMS,N=E1.N;
const ROWN=['Цифры','Буквы','Римские','Кости','Фигуры','Знаки'];
const fmtT=s=>{s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
/* геометрия поля (в пикселях текстуры 2048 x 1445) */
const FX=100,FY=24,CW=316,CH=232,TS=96;
/* begin===false — партия приготовлена, но не идёт: при входе в комнату игра не включается, пока не нажато «Начать» */
function start(E,S,seed,again,begin){
  const pz=again&&S.g?S.g.pz:E1.generate(seed);
  S.g=E1.newGame(pz);S.t=0;S.helped=false;S.sec=0;S.sent=false;S.used=new Set();
  S.phase=begin===false?'idle':'play';S.showRules=false;
  S.msg='';S.field.dirty=S.hints.dirty=S.ctl.dirty=true;if(S.favs)S.favs.dirty=true;
}
const HK=[.9,1.2,1.5];/* ступени размера подсказок */
/* правила — по тексту оригинала Einstein 2.0 (res/rules_ru.txt), мышь заменена курком; ex — пример подсказки */
const RULES=[
  {t:'Надо открыть все фишки в квадрате 6×6. В каждой строке фишки одного типа: в первой — арабские цифры, во второй — латинские буквы, в третьей — римские цифры, в четвёртой — игральные кости, в пятой — геометрические фигуры, в шестой — математические символы.'},
  {t:'Открывать фишки надо методом исключения. Пока фишка не открыта, на её месте показаны все возможные варианты. Курок в режиме «выбрать» открывает фишку, в режиме «убрать» исключает её (хват во время курка — наоборот).'},
  {t:'Вертикальная подсказка: эти две фишки находятся в одной колонке.',ex:{t:'under',a:[1,2],b:[5,1]}},
  {t:'Красная двойная стрелка: фишки в соседних колонках, какая левее, а какая правее — неизвестно.',ex:{t:'near',a:[3,6],b:[5,5]}},
  {t:'Три красные точки: левая фишка находится в колонке левее правой, на любом расстоянии.',ex:{t:'dir',a:[3,3],b:[2,2]}},
  {t:'Синяя стрелка над тремя фишками: средняя стоит между двумя другими, все три в соседних колонках; какая из крайних левее — неизвестно.',ex:{t:'btw',a:[5,5],c:[4,4],b:[0,5]}},
  {t:'Использованную подсказку нажми — она потускнеет. Ошибка (убрана верная фишка или выбрана неверная) — проигрыш.'}];
function rulesDraw(E,S,c,p){
  p.text('Правила игры «Эйнштейн»',30,14,{size:56,bold:true,maxW:p.W-60});
  let y=100;const T=76;
  for(const r of RULES){
    if(r.ex){const w=r.ex.t==='under'?T:3*T,h=r.ex.t==='under'?2*T:T;drawHint(c,r.ex,30,y,T,false);
      y=Math.max(p.text(r.t,30+w+24,y,{size:38,color:'#f1f5f9',maxW:p.W-84-w,lh:46}),y+h)+18;}
    else y=p.text(r.t,30,y,{size:38,color:'#f1f5f9',maxW:p.W-60,lh:46})+18;
  }
}
function applyClick(E,S,h,c,r,e){
  const g=S.g;if(g.status!=='play'||S.phase!=='play')return;
  const alt=!!(h&&h.src&&h.src.gamepad&&h.src.gamepad.buttons&&h.src.gamepad.buttons[1]&&h.src.gamepad.buttons[1].pressed);
  const btn=(S.mode==='pick')!==alt?1:3;
  const res=E1.click(g,c,r,e,btn);
  if(res==='noop')return;
  S.field.dirty=S.ctl.dirty=true;
  if(res==='fail'){E.beep(180,.3,'sawtooth',.06);E.buzz(h,.8,150);S.msg=S.tid?'Ошибка — в турнире это поражение в матче.':'Ошибка: так не может быть. Начни сначала или возьми новую.';lost(E,S);}
  else if(res==='win')won(E,S);
  else E.beep(btn===1?700:520,.04,'sine',.04);
}
function lost(E,S){
  if(S.sent)return;S.sent=true;
  try{if(VR.games&&VR.games.finish)VR.games.finish(E,'einstein',{res:'lose',seed:S.g.pz.seed,helped:S.helped,moves:S.g.moves,tid:S.tid||null,mid:S.mid||null});}catch(e){}
}
function won(E,S){
  E.fanfare();S.msg='Готово! Все фишки открыты за '+fmtT(S.t)+(S.helped?' (с помощью — в зачёт не идёт)':'');
  if(!S.sent){S.sent=true;try{if(VR.games&&VR.games.finish)VR.games.finish(E,'einstein',{time:Math.round(S.t),seed:S.g.pz.seed,helped:S.helped,moves:S.g.moves,tid:S.tid||null,mid:S.mid||null});}catch(e){}}
  S.ctl.dirty=S.hints.dirty=true;
}
function fieldDraw(E,S,c,p){
  const g=S.g,P=g.P,over=g.status==='lose';
  c.font='bold 30px sans-serif';c.fillStyle='#94a3b8';c.textAlign='center';c.textBaseline='middle';
  for(let i=0;i<N;i++)c.fillText(String(i+1),FX+i*CW+CW/2,12);
  for(let r=0;r<N;r++){
    c.fillStyle='#64748b';c.font='bold 38px sans-serif';c.textAlign='center';c.fillText('ABCDEF'[r],FX/2,FY+r*CH+CH/2);
    for(let col=0;col<N;col++){
      const x=FX+col*CW,y=FY+r*CH;
      c.fillStyle=over?'#2b1b1b':(r+col)%2?'#16213e':'#1b2a4e';c.fillRect(x+3,y+3,CW-6,CH-6);
      if(S.phase==='idle')continue;
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
          const hov=p.area(tx,ty,100,100,h=>applyClick(E,S,h,col,r,e),over||g.status!=='play'||S.phase!=='play');
          if(hov){/* цвет подсветки = что сделает курок: красный — убрать фишку, зелёный — выбрать её */c.fillStyle=S.mode==='pick'?'#166534':'#991b1b';c.fillRect(tx+2,ty+2,96,96);}
          E1.drawTile(c,r,e,tx+2,ty+2,96,hov?'#fde68a':'#cbd5e1');
        }
      }
    }
  }
  /* яркие линии поля 6×6 (контрастнее тонкой сетки внутри клеток) */
  c.strokeStyle='#e2e8f0';c.lineWidth=5;c.beginPath();
  for(let i=0;i<=N;i++){c.moveTo(FX+i*CW,FY);c.lineTo(FX+i*CW,FY+N*CH);c.moveTo(FX,FY+i*CH);c.lineTo(FX+N*CW,FY+i*CH);}
  c.stroke();c.lineWidth=9;c.strokeRect(FX,FY,N*CW,N*CH);
  if(S.phase==='idle'){
    c.fillStyle='rgba(8,12,28,.72)';c.fillRect(FX,FY,N*CW,N*CH);
    c.fillStyle='#fde68a';c.font='bold 76px sans-serif';c.textAlign='center';c.textBaseline='middle';
    c.fillText('Нажми «Начать»',FX+N*CW/2,FY+N*CH/2-30);
    c.fillStyle='#cbd5e1';c.font='36px sans-serif';c.fillText('Правила — на панели справа. Партия № '+g.pz.seed,FX+N*CW/2,FY+N*CH/2+50);
  }
}
/* рисунок подсказки как в оригинале Einstein 2.0: светлые фишки с чёрными знаками;
   «рядом» — красная двойная стрелка на синем квадрате, «левее» — три красные точки на синем квадрате,
   «между» — три фишки и синяя двойная стрелка над средней; вертикальная — две фишки одна над другой */
/* градиент с запасным сплошным цветом (на случай урезанного canvas) */
function grad(c,x,y,T,a,b){const g=c.createLinearGradient&&c.createLinearGradient(x,y,x+T,y+T);if(!g||!g.addColorStop)return b;g.addColorStop(0,a);g.addColorStop(1,b);return g;}
function hintTile(c,row,n,x,y,T,dim){
  const g=grad(c,x,y,T,dim?'#6b7280':'#cfc8c4',dim?'#9ca3af':'#f3eeea');
  c.fillStyle=g;c.fillRect(x,y,T,T);c.strokeStyle='#111';c.lineWidth=Math.max(2,T*.03);c.strokeRect(x+1,y+1,T-2,T-2);
  E1.drawTile(c,row,n,x,y,T,dim?'#374151':'#111');
}
function dArrow(c,x1,x2,y,h,col){/* двойная стрелка ↔ толщиной h */
  const a=h*1.6;c.fillStyle=col;c.beginPath();
  c.moveTo(x1,y);c.lineTo(x1+a,y-a*.75);c.lineTo(x1+a,y-h/2);c.lineTo(x2-a,y-h/2);c.lineTo(x2-a,y-a*.75);c.lineTo(x2,y);
  c.lineTo(x2-a,y+a*.75);c.lineTo(x2-a,y+h/2);c.lineTo(x1+a,y+h/2);c.lineTo(x1+a,y+a*.75);c.closePath();c.fill();
}
function blueSq(c,x,y,T,dim){c.fillStyle=grad(c,x,y,T,dim?'#6b7280':'#8f8ff0',dim?'#d1d5db':'#ffffff');c.fillRect(x,y,T,T);}
function drawHint(c,s,x,y,T,dim){
  const red=dim?'#4b5563':'#ef1111',blue=dim?'#4b5563':'#1630f0';
  if(s.t==='under'){hintTile(c,s.a[0],s.a[1],x,y,T,dim);hintTile(c,s.b[0],s.b[1],x,y+T,T,dim);return;}
  hintTile(c,s.a[0],s.a[1],x,y,T,dim);hintTile(c,s.b[0],s.b[1],x+2*T,y,T,dim);
  if(s.t==='near'){blueSq(c,x+T,y,T,dim);dArrow(c,x+T+T*.08,x+2*T-T*.08,y+T/2,T*.13,red);}
  else if(s.t==='dir'){blueSq(c,x+T,y,T,dim);c.fillStyle=red;for(let k=-1;k<=1;k++){c.beginPath();c.arc(x+1.5*T+k*T*.3,y+T/2,T*.1,0,6.283);c.fill();}}
  else if(s.t==='btw'){hintTile(c,s.c[0],s.c[1],x+T,y,T,dim);dArrow(c,x+T*.75,x+2.25*T,y+T*.14,T*.1,blue);}
}
function hintDraw(E,S,c,p){
  if(S.phase==='idle'||S.showRules)return rulesDraw(E,S,c,p);
  const g=S.g,rules=g.pz.rules,K=HK[S.hk===undefined?1:S.hk],T=Math.round(84*K),sc=v=>Math.round(v*K);
  p.text('Подсказки',30,14,{size:48,bold:true,maxW:700});
  /* размер подсказок: три ступени, кнопки A− / A+ */
  p.button(p.W-30-230,10,104,60,'A−',()=>{S.hk=Math.max(0,(S.hk===undefined?1:S.hk)-1);S.hints.dirty=true;},{size:34,bg:'#334155',disabled:(S.hk===undefined?1:S.hk)<=0});
  p.button(p.W-30-110,10,104,60,'A+',()=>{S.hk=Math.min(HK.length-1,(S.hk===undefined?1:S.hk)+1);S.hints.dirty=true;},{size:34,bg:'#334155',disabled:(S.hk===undefined?1:S.hk)>=HK.length-1});
  p.text('Нажми подсказку, чтобы отметить её как использованную',30,72,{size:26,color:'#94a3b8',maxW:p.W-60});
  const horiz=[],vert=[];
  rules.forEach((s,i)=>{const k=E1.showOf(s);if(k==='horiz')horiz.push(i);else if(k==='vert')vert.push(i);});
  const dim=i=>S.used.has(i);
  const toggle=i=>()=>{if(S.used.has(i))S.used.delete(i);else S.used.add(i);S.hints.dirty=true;};
  const BW=3*T,cw=BW+sc(40),ch=T+sc(26),perH=Math.max(1,Math.floor((p.W-30)/cw)),vstep=T+sc(36),perV=Math.max(1,Math.floor((p.W-30)/vstep));
  let y=130;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('По горизонтали:',30,y+8);y+=48;
  horiz.forEach((i,k)=>{const x=30+(k%perH)*cw,yy=y+((k/perH)|0)*ch;p.area(x-6,yy-6,BW+12,T+12,toggle(i));drawHint(c,rules[i],x,yy,T,dim(i));});
  y+=Math.ceil(horiz.length/perH)*ch+20;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('По вертикали (в одной колонке):',30,y+8);y+=48;
  vert.forEach((i,k)=>{const x=30+(k%perV)*vstep,yy=y+((k/perV)|0)*(2*T+sc(26));p.area(x-4,yy-4,T+8,2*T+8,toggle(i));drawHint(c,rules[i],x,yy,T,dim(i));});
  const open=rules.filter(s=>s.t==='open');
  if(open.length&&p.H>0)p.text('Сразу открыто фишек: '+open.length,30,p.H-60,{size:28,color:'#94a3b8',maxW:700});
}
function ctlDraw(E,S,c,p){
  const g=S.g,X=24,W=p.W-48;
  p.text('Эйнштейн',X,14,{size:46,bold:true,maxW:W-200});
  p.text(fmtT(S.t),p.W-X-170,18,{size:46,bold:true,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#fde68a',maxW:170});
  const st=g.status==='lose'?S.msg:g.status==='win'?S.msg:(S.msg||'Открой все фишки: исключай лишние по подсказкам.');
  p.text(st,X,80,{size:28,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#cbd5e1',maxW:W,maxY:200});
  const bw=(W-14)/2;
  if(S.phase==='idle'){
    p.button(X,206,W,64,'▶ Начать',()=>{S.phase='play';S.t=0;S.sec=0;S.field.dirty=S.hints.dirty=S.ctl.dirty=true;E.beep(660,.08,'sine',.05);},{size:34,bg:'#15803d'});
    if(!S.tid)p.button(X,284,W,64,'Другая головоломка',()=>start(E,S,undefined,false,false),{size:28,bg:'#b45309'});
    p.button(X,440,bw,64,'Правила',()=>{},{size:26,bg:'#334155',disabled:true});
    if(VR.ROOMS.arena)p.button(X+bw+14,440,bw,64,'В зал',()=>E.goRoom('arena'),{size:26,bg:'#475569'});
    p.text('Головоломка № '+g.pz.seed,X,520,{size:22,color:'#64748b',maxW:W});return;
  }
  p.button(X,206,W,64,'Курок: '+(S.mode==='pick'?'ВЫБРАТЬ фишку':'УБРАТЬ фишку'),()=>{S.mode=S.mode==='pick'?'excl':'pick';S.ctl.dirty=true;},{size:30,bg:S.mode==='pick'?'#166534':'#991b1b'});
  p.button(X,284,bw,64,'Сначала',()=>start(E,S,0,true),{size:30,bg:'#475569',disabled:!!S.tid});
  p.button(X+bw+14,284,bw,64,'Новая',()=>start(E,S),{size:30,bg:'#b45309',disabled:!!S.tid});
  p.button(X,362,W,64,'Открыть одну клетку (без зачёта)',()=>{if(g.status!=='play'||S.tid)return;S.helped=true;E1.hint(g);S.field.dirty=true;if(g.status==='win')won(E,S);S.ctl.dirty=true;},{size:26,bg:'#1e293b',disabled:g.status!=='play'||!!S.tid});
  p.button(X,440,VR.ROOMS.arena?bw:W,64,S.showRules?'Подсказки':'Правила',()=>{S.showRules=!S.showRules;S.hints.dirty=S.ctl.dirty=true;},{size:26,bg:'#334155'});
  if(VR.ROOMS.arena)p.button(X+bw+14,440,bw,64,'В зал',()=>E.goRoom('arena'),{size:26,bg:'#475569'});
  p.text((S.tid?'Турнирная партия. ':'')+'Хват во время курка — наоборот. Головоломка № '+g.pz.seed,X,520,{size:22,color:'#64748b',maxW:W});
}
function favDraw(E,S,c,p){
  const g=S.g,W=p.W,X=24,F=VR.games&&VR.games.favs?VR.games.favs('einstein'):[];
  p.text('Сохранённые',X,14,{size:44,bold:true,maxW:W-48});
  const mine=F.includes(g.pz.seed);
  p.button(X,84,W-48,70,mine?'★ Убрать из сохранённых':'☆ Сохранить эту № '+g.pz.seed,()=>{if(VR.games&&VR.games.favToggle)VR.games.favToggle('einstein',g.pz.seed);S.favs.dirty=true;},{size:26,bg:mine?'#92400e':'#334155',disabled:!VR.games||!VR.games.favToggle});
  if(!F.length){p.text('Пока пусто. Сохрани понравившуюся головоломку — она останется на этом устройстве.',X,180,{size:26,color:'#94a3b8',maxW:W-48});return;}
  F.slice(0,9).forEach((sd,i)=>{const y=176+i*92;
    p.button(X,y,W-48-84,80,'№ '+sd,()=>{if(S.tid)return;start(E,S,sd);},{size:30,bg:sd===g.pz.seed?'#15803d':'#1e293b',disabled:!!S.tid});
    p.button(W-X-72,y,72,80,'✕',()=>{VR.games.favToggle('einstein',sd);S.favs.dirty=true;},{size:30,bg:'#7f1d1d'});});
  if(F.length>9)p.text('и ещё '+(F.length-9),X,176+9*92,{size:24,color:'#94a3b8'});
}
VR.einroomDrawHint=drawHint;
ROOMS.ein={
  title:'Эйнштейн',env:{floor:[.06,.07,.14],wall:[.12,.14,.3],trim:[.55,.5,1],grid:[.35,.3,.8]},spawn:{x:0,z:-.4},
  hint:'Эйнштейн: открой все фишки 6×6 по подсказкам. Курок на фишку — выбрать её (режим «убрать» переключается кнопкой).',
  build(E,S){
    VR.RU.backDoor(E);
    S.mode='pick';S.tid=null;S.mid=null;
    const pd=VR.games&&VR.games.pending;if(pd&&pd.game==='einstein'){S.tid=pd.tid;S.mid=pd.r+'.'+pd.i;S.nextSeed=pd.seed;VR.games.pending=null;}
    S.field=E.addPanel({w:3.4,h:2.4,res:2048,pos:[-1.2,1.55,-4.2],yaw:0,accent:'#818cf8',draw:(c,p)=>fieldDraw(E,S,c,p)});
    S.hints=E.addPanel({w:2.2,h:2.4,res:1536,pos:[2.0,1.55,-4.2],yaw:0,accent:'#a78bfa',draw:(c,p)=>hintDraw(E,S,c,p)});
    S.ctl=E.addPanel({w:1.4,h:1.1,res:768,pos:[-4.15,1.35,-4.2],yaw:0,accent:'#f59e0b',draw:(c,p)=>ctlDraw(E,S,c,p)});
    S.favs=E.addPanel({w:1.4,h:2.4,res:768,pos:[3.95,1.55,-4.2],yaw:0,accent:'#fbbf24',draw:(c,p)=>favDraw(E,S,c,p)});
    start(E,S,S.nextSeed,false,false);S.nextSeed=undefined;
  },
  targets(){return[];},
  update(E,S,dt){
    if(!S.g||S.g.status!=='play'||S.phase!=='play')return;
    S.t+=dt;const s=Math.floor(S.t);
    if(s!==S.sec){S.sec=s;S.ctl.dirty=true;}
  },
  draw(){}
};
})();

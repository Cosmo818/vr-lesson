/* eintut.js — обучение «Эйнштейну» (PLAN-einstein.md Э12): пошаговый разбор на маленьком поле 3×3 с фиксированным примером.
   Не партия: G.g не трогает, в рейтинг и в журнал игр ничего не отдаёт. Тексты — по правилам оригинала Einstein 2.0 (res/rules_ru.txt), фишки — кодом (VR.einstein.drawTile/drawHint).
   VR.eintut={STEPS,count,state(i),draw(c,p,rect,cfg,G,cb)}; cb={back,next,skip}; G.tut={i}. Рисует в p (панель стены/терминала или холст веба, js/einplay.js). */
(function(){
'use strict';
const VR=window.VR,E1=VR.einstein;
const NC=3;
/* решение примера (строка → колонки): цифры 2 3 1 · буквы 3 1 2 · римские 1 2 3 */
const ctrl=web=>web?'Левая кнопка мыши (на экране — короткое касание) выбирает фишку, правая кнопка или долгое нажатие убирает её.':'Курок на фишке выбирает её, курок при зажатой боковой кнопке (grip) той же руки убирает фишку.';
const STEPS=[
  {t:'Поле и фишки',x:()=>'Для обучения — маленькое поле 3×3, в игре оно 6×6. В каждой строке фишки одного вида: в первой цифры, во второй латинские буквы, в третьей римские цифры. В строке все фишки разные, а в каждой колонке стоит по одной фишке каждого вида. Пока фишка не открыта, на её месте показаны все варианты.',cells:[[0,0],[1,0],[2,0]]},
  {t:'Открыть и убрать фишку',x:w=>'Нужно открыть все фишки. Выбрал фишку — клетка открыта, а такой же вариант пропадает у соседей по строке. Убрал фишку — исключил её вариант из клетки. '+ctrl(w)+' Ошибаться нельзя: неверный выбор — проигрыш.',hl:[[0,0,1]]},
  {t:'Подсказка «рядом»',x:()=>'Красная двойная стрелка между двумя фишками: они стоят в соседних колонках, но какая левее — неизвестно. Здесь цифра 2 и римская 2 — соседи.',hint:{t:'near',a:[0,2],b:[2,2]},hl:[[0,0,2],[1,0,2],[2,0,2],[0,2,2],[1,2,2],[2,2,2]]},
  {t:'Подсказка «левее — правее»',x:()=>'Три красные точки: левая фишка стоит левее правой, на любом расстоянии. Здесь буква левее цифры 1.',hint:{t:'dir',a:[1,3],b:[0,1]},hl:[[0,1,3],[1,1,3],[2,1,3],[0,0,1],[1,0,1],[2,0,1]]},
  {t:'Подсказка «между»',x:()=>'Синяя стрелка над тремя фишками: средняя стоит между двумя другими, все три в соседних колонках; какая из крайних левее — неизвестно. В поле 3×3 средняя фишка может быть только в средней колонке.',hint:{t:'btw',a:[1,3],c:[0,3],b:[0,1]},hl:[[0,0,3],[1,0,3],[2,0,3]]},
  {t:'Вертикальная подсказка',x:()=>'Две фишки одна над другой: они находятся в одной колонке. Здесь цифра 3 и буква-единица всегда в одной колонке.',hint:{t:'under',a:[0,3],b:[1,1]},hl:[[0,0,3],[1,0,3],[2,0,3],[0,1,1],[1,1,1],[2,1,1]]},
  {t:'Открытая фишка',x:()=>'Часть фишек открыта с самого начала — с них и начинай. Здесь открыта римская 1 в первой колонке: такого варианта больше нет у других клеток этой строки.',ops:[[0,2,1]],cells:[[0,2]]},
  {t:'Сочетаем: «между»',x:()=>'Цифра 3 стоит между двумя другими. Поле шириной в три колонки, значит, она в средней — открываем её. Остальные цифры теперь не тройки.',hint:{t:'btw',a:[1,3],c:[0,3],b:[0,1]},ops:[[1,0,3]],cells:[[1,0]]},
  {t:'Сочетаем: «в одной колонке»',x:()=>'Цифра 3 в средней колонке, а вертикальная подсказка ставит под неё букву 1. Открываем букву в средней колонке.',hint:{t:'under',a:[0,3],b:[1,1]},ops:[[1,1,1]],cells:[[1,1]]},
  {t:'Сочетаем: «левее»',x:()=>'Буква 3 левее цифры 1. Для букв остались крайние колонки: справа тройке не быть, иначе цифре некуда встать правее — значит, она слева. Цифра 1 правее — в третьей колонке, оставшаяся 2 — слева.',hint:{t:'dir',a:[1,3],b:[0,1]},ops:[[0,1,3],[2,1,2],[2,0,1],[0,0,2]],cells:[[0,1],[2,1],[0,0],[2,0]]},
  {t:'Сочетаем: «рядом»',x:()=>'Цифра 2 стоит в первой колонке, римская 2 — её сосед. В первой колонке уже римская 1, поэтому римская 2 — во второй, а 3 — в третьей.',hint:{t:'near',a:[0,2],b:[2,2]},ops:[[1,2,2],[2,2,3]],cells:[[1,2],[2,2]]},
  {t:'Решение единственное',x:()=>'Все фишки открыты, и каждый шаг следовал из подсказок. Так и в игре: у головоломки ровно одно решение, угадывать не нужно — подсказки вместе всегда выводят каждую фишку. Не получается — убирай варианты, которые противоречат подсказке.',cells:[[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]]},
  {t:'Когда ошибка',x:()=>'Ошибка — убрана верная фишка или выбрана неверная: партия проиграна, нужно начать сначала или взять новую. Время идёт от начала партии и в зачёте учитывается. «Открыть клетку» помогает, но такая партия в рейтинг не идёт. В турнире ошибка — поражение в матче. Использованную подсказку нажми — она потускнеет.'}
];
const count=()=>STEPS.length;
const B=(p,x,y,w,h,l,fn,t)=>{p.button(x,y,w,h,l,fn,t);const b=p.btns[p.btns.length-1];if(b)b.label=l;};
function state(i){
  const cand=[];for(let c=0;c<NC;c++){cand.push([]);for(let r=0;r<NC;r++)cand[c].push(new Set([1,2,3]));}
  const set=(c,r,v)=>{cand[c][r]=new Set([v]);for(let k=0;k<NC;k++)if(k!==c)cand[k][r].delete(v);};
  for(let k=0;k<=i&&k<STEPS.length;k++)for(const o of STEPS[k].ops||[])set(o[0],o[1],o[2]);
  return cand;
}
/* мини-поле: cs — размер клетки, ярлыки слева и сверху */
function mini(c,cand,x,y,cs,st){
  const lab=Math.round(cs*.3),lf=Math.round(cs*.2);
  c.font='bold '+lf+'px sans-serif';c.fillStyle='#94a3b8';c.textAlign='center';c.textBaseline='middle';
  for(let k=0;k<NC;k++){c.fillText(String(k+1),x+lab+k*cs+cs/2,y+lab/2);c.fillText('ABC'[k],x+lab/2,y+lab+k*cs+cs/2);}
  const hl=st.hl||[],has=(col,row,n)=>hl.some(h=>h[0]===col&&h[1]===row&&h[2]===n);
  for(let r=0;r<NC;r++)for(let col=0;col<NC;col++){
    const x0=x+lab+col*cs,y0=y+lab+r*cs,s=cand[col][r];
    c.fillStyle=s.size===1?'#14532d':(r+col)%2?'#16213e':'#1b2a4e';c.fillRect(x0+2,y0+2,cs-4,cs-4);
    if(s.size===1){const v=[...s][0],pd=Math.round(cs*.14);E1.drawTile(c,r,v,x0+pd,y0+pd,cs-2*pd,'#f0fdf4');continue;}
    const sub=Math.floor((cs-8)/3),ty=y0+Math.round((cs-sub)/2);
    for(let e=1;e<=NC;e++){
      if(!s.has(e))continue;const tx=x0+4+(e-1)*sub;
      if(has(col,r,e)){c.fillStyle='rgba(251,191,36,.38)';c.fillRect(tx,ty,sub,sub);}
      E1.drawTile(c,r,e,tx+2,ty+2,sub-4,has(col,r,e)?'#fde68a':'#cbd5e1');
      if(has(col,r,e)){c.strokeStyle='#fbbf24';c.lineWidth=Math.max(2,Math.round(cs*.025));c.strokeRect(tx+1,ty+1,sub-2,sub-2);}
    }
  }
  c.strokeStyle='#e2e8f0';c.lineWidth=Math.max(2,Math.round(cs*.025));c.beginPath();
  for(let k=0;k<=NC;k++){c.moveTo(x+lab+k*cs,y+lab);c.lineTo(x+lab+k*cs,y+lab+NC*cs);c.moveTo(x+lab,y+lab+k*cs);c.lineTo(x+lab+NC*cs,y+lab+k*cs);}
  c.stroke();
  for(const q of st.cells||[]){c.strokeStyle='#fbbf24';c.lineWidth=Math.max(3,Math.round(cs*.04));c.strokeRect(x+lab+q[0]*cs+3,y+lab+q[1]*cs+3,cs-6,cs-6);}
  return lab+NC*cs;
}
function draw(c,p,rect,cfg,G,cb){
  const i=Math.max(0,Math.min(STEPS.length-1,G.tut.i)),st=STEPS[i],cand=state(i);
  const fs=cfg.fs,g=cfg.gap*2,bh=cfg.bh,X=rect.x,Y=rect.y,W=rect.w,H=rect.h;
  c.fillStyle='#0b1020';c.fillRect(X,Y,W,H);
  /* низ: Назад / Дальше / Пропустить */
  const by=Y+H-g-bh,bw=Math.floor((W-2*g-2*cfg.gap)/3);
  B(p,X+g,by,bw,bh,'Назад',()=>cb.back(),{size:fs,bg:'#475569',disabled:i===0});
  B(p,X+g+bw+cfg.gap,by,bw,bh,i===STEPS.length-1?'Готово':'Дальше',()=>cb.next(),{size:fs,bg:'#15803d'});
  B(p,X+g+2*(bw+cfg.gap),by,bw,bh,'Пропустить',()=>cb.skip(),{size:fs,bg:'#334155'});
  p.text('Обучение · шаг '+(i+1)+' из '+STEPS.length,X+g,Y+g/2,{size:Math.round(fs*.85),color:'#94a3b8',maxW:W-2*g});
  const top=Y+g/2+Math.round(fs*1.25)+g/2,bot=by-g,bh2=bot-top;
  const side=W>=H*1.1;
  let tx,ty,tw,csz;
  if(side){
    const fw=Math.min(Math.floor((W-3*g)*.42),bh2);csz=Math.floor(fw/(NC+.3));
    mini(c,cand,X+g,top,csz,st);tx=X+g+Math.round(csz*(NC+.3))+g;ty=top;tw=X+W-g-tx;
  }else{
    csz=Math.floor(Math.min((W-2*g)/(NC+.3),bh2*.4/(NC+.3)));
    const used=mini(c,cand,X+Math.round((W-Math.round(csz*(NC+.3)))/2),top,csz,st);tx=X+g;ty=top+used+g;tw=W-2*g;
  }
  let y=p.text(st.t,tx,ty,{size:Math.round(fs*1.15),bold:true,color:'#fde68a',maxW:tw,maxY:bot})+Math.round(fs*.2);
  y=p.text(st.x(!!cfg.web),tx,y,{size:fs,color:'#f1f5f9',maxW:tw,lh:Math.round(fs*1.3),maxY:bot})+g/2;
  if(st.hint){
    const T=Math.max(30,Math.round(fs*2.4)),hh=st.hint.t==='under'?2*T:T;
    if(y+hh<=bot)E1.drawHint(c,st.hint,tx,y,T,false);
  }
}
VR.eintut={STEPS,count,state,draw};
})();

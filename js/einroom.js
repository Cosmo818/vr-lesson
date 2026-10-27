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
function start(E,S,seed,again){
  const pz=again&&S.g?S.g.pz:E1.generate(seed);
  S.g=E1.newGame(pz);S.t=0;S.helped=false;S.sec=0;S.sent=false;S.used=new Set();
  S.msg='';S.field.dirty=S.hints.dirty=S.ctl.dirty=true;
}
function applyClick(E,S,h,c,r,e){
  const g=S.g;if(g.status!=='play')return;
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
      if(P.defined(col,r)){
        c.fillStyle='#14532d';c.fillRect(x+3,y+3,CW-6,CH-6);
        E1.drawTile(c,r,P.value(col,r),x+(CW-170)/2,y+(CH-170)/2,170,'#f0fdf4');
      }else{
        for(let e=1;e<=N;e++){
          const k=e-1,tx=x+8+(k%3)*100,ty=y+16+((k/3)|0)*104;
          if(!P.can(col,r,e))continue;
          const hov=p.area(tx,ty,100,100,h=>applyClick(E,S,h,col,r,e),over||g.status!=='play');
          if(hov){c.fillStyle='#334e8a';c.fillRect(tx+2,ty+2,96,96);}
          E1.drawTile(c,r,e,tx+2,ty+2,96,hov?'#fde68a':'#cbd5e1');
        }
      }
    }
  }
}
function hintDraw(E,S,c,p){
  const g=S.g,rules=g.pz.rules,T=84;
  p.text('Подсказки',30,14,{size:48,bold:true,maxW:700});
  p.text('Нажми подсказку, чтобы отметить её как использованную',30,72,{size:26,color:'#94a3b8',maxW:p.W-60});
  const tile=(r,t,x,y,col)=>{c.fillStyle='#1e293b';c.fillRect(x,y,T,T);E1.drawTile(c,r,t,x,y,T,col);};
  const horiz=[],vert=[];
  rules.forEach((s,i)=>{const k=E1.showOf(s);if(k==='horiz')horiz.push(i);else if(k==='vert')vert.push(i);});
  const dim=i=>S.used.has(i),col=i=>dim(i)?'#475569':'#e5e7eb';
  const toggle=i=>()=>{if(S.used.has(i))S.used.delete(i);else S.used.add(i);S.hints.dirty=true;};
  let y=130,cw=360,ch=T+30;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('Рядом, левее, между (по горизонтали):',30,y+8);y+=48;
  horiz.forEach((i,k)=>{
    const s=rules[i],x=30+(k%4)*cw,yy=y+((k/4)|0)*ch,cc=col(i);
    p.area(x-6,yy-4,cw-24,T+8,toggle(i));
    if(s.t==='near'){tile(s.a[0],s.a[1],x,yy,cc);c.fillStyle=cc;c.font='bold 44px sans-serif';c.textAlign='center';c.fillText('↔',x+T+30,yy+T/2);tile(s.b[0],s.b[1],x+T+60,yy,cc);}
    else if(s.t==='dir'){tile(s.a[0],s.a[1],x,yy,cc);c.fillStyle=cc;c.font='bold 44px sans-serif';c.textAlign='center';c.fillText('→',x+T+30,yy+T/2);tile(s.b[0],s.b[1],x+T+60,yy,cc);}
    else{tile(s.a[0],s.a[1],x,yy,cc);tile(s.c[0],s.c[1],x+T+4,yy,dim(i)?'#475569':'#fde68a');tile(s.b[0],s.b[1],x+2*T+8,yy,cc);}
  });
  y+=Math.ceil(horiz.length/4)*ch+20;
  c.fillStyle='#94a3b8';c.font='28px sans-serif';c.textAlign='left';c.fillText('В одной колонке (по вертикали):',30,y+8);y+=48;
  vert.forEach((i,k)=>{
    const s=rules[i],x=30+(k%8)*180,yy=y+((k/8)|0)*(2*T+30),cc=col(i);
    p.area(x-4,yy-4,T+8,2*T+8,toggle(i));
    tile(s.a[0],s.a[1],x,yy,cc);tile(s.b[0],s.b[1],x,yy+T,cc);
  });
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
  p.button(X,206,W,64,'Курок: '+(S.mode==='pick'?'выбирать фишку':'исключать фишку'),()=>{S.mode=S.mode==='pick'?'excl':'pick';S.ctl.dirty=true;},{size:30,bg:'#334155'});
  p.button(X,284,bw,64,'Сначала',()=>start(E,S,0,true),{size:30,bg:'#475569',disabled:!!S.tid});
  p.button(X+bw+14,284,bw,64,'Новая',()=>start(E,S),{size:30,bg:'#b45309',disabled:!!S.tid});
  p.button(X,362,W,64,'Открыть одну клетку (без зачёта)',()=>{if(g.status!=='play'||S.tid)return;S.helped=true;E1.hint(g);S.field.dirty=true;if(g.status==='win')won(E,S);S.ctl.dirty=true;},{size:26,bg:'#1e293b',disabled:g.status!=='play'||!!S.tid});
  if(VR.ROOMS.arena)p.button(X,440,W,64,'В зал турниров',()=>E.goRoom('arena'),{size:28,bg:'#475569'});
  p.text((S.tid?'Турнирная партия. ':'')+'Хват во время курка — наоборот. Головоломка № '+g.pz.seed,X,520,{size:22,color:'#64748b',maxW:W});
}
ROOMS.ein={
  title:'Эйнштейн',env:{floor:[.06,.07,.14],wall:[.12,.14,.3],trim:[.55,.5,1],grid:[.35,.3,.8]},spawn:{x:0,z:-.4},
  hint:'Эйнштейн: открой все фишки 6×6 по подсказкам. Курок на фишку — исключить (режим переключается).',
  build(E,S){
    VR.RU.backDoor(E);
    S.mode='excl';S.tid=null;S.mid=null;
    const pd=VR.games&&VR.games.pending;if(pd&&pd.game==='einstein'){S.tid=pd.tid;S.mid=pd.r+'.'+pd.i;S.nextSeed=pd.seed;VR.games.pending=null;}
    S.field=E.addPanel({w:3.4,h:2.4,res:2048,pos:[-1.2,1.55,-4.2],yaw:0,accent:'#818cf8',draw:(c,p)=>fieldDraw(E,S,c,p)});
    S.hints=E.addPanel({w:2.2,h:2.4,res:1536,pos:[2.0,1.55,-4.2],yaw:0,accent:'#a78bfa',draw:(c,p)=>hintDraw(E,S,c,p)});
    S.ctl=E.addPanel({w:1.4,h:1.1,res:768,pos:[-4.15,1.35,-4.2],yaw:0,accent:'#f59e0b',draw:(c,p)=>ctlDraw(E,S,c,p)});
    start(E,S,S.nextSeed);S.nextSeed=undefined;
  },
  targets(){return[];},
  update(E,S,dt){
    if(!S.g||S.g.status!=='play')return;
    S.t+=dt;const s=Math.floor(S.t);
    if(s!==S.sec){S.sec=s;S.ctl.dirty=true;}
  },
  draw(){}
};
})();

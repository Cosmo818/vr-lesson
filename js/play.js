/* play.js — комната «Игровая»: шахматы против компьютера (правила и ИИ — js/chess.js).
   Только на этом устройстве, без сети и без записи данных ученика. Ход: курок на свою фигуру, потом курок на клетку. */
(function(){
'use strict';
const VR=window.VR,M=VR.M,TRS=VR.TRS,C=VR.chess,ROOMS=VR.ROOMS;
const CX=0,CZ=-2.4,CS=.09,TOP=.8,Y0=.812;
const WH=[.93,.9,.82],BL=[.17,.15,.16];
const NAMES={5:'Ферзь',4:'Ладья',3:'Слон',2:'Конь'};
/* клетка → центр на столе; при игре за чёрных доска разворачивается */
const cellXZ=(S,sq)=>{const f=sq&7,r=sq>>3,s=S.flip?-1:1;return[CX+(f-3.5)*CS*s,CZ-(r-3.5)*CS*s];};
/* части фигур: [mesh, высота центра, ширина, высота, глубина] (метры, над Y0) */
function parts(E,t){
  const m=E.mesh,b=[m.cyl,.005,.06,.01,.06];
  switch(t){
    case 1:return[b,[m.cone,.03,.045,.04,.045],[m.sphere,.062,.034,.034,.034]];
    case 4:return[b,[m.cyl,.032,.046,.05,.046],[m.cube,.062,.058,.014,.058]];
    case 2:return[b,[m.cyl,.025,.042,.035,.042],[m.cube,.06,.034,.042,.05],[m.cone,.088,.022,.024,.022]];
    case 3:return[b,[m.cone,.04,.046,.06,.046],[m.sphere,.082,.028,.028,.028],[m.sphere,.1,.012,.012,.012]];
    case 5:return[b,[m.cone,.045,.054,.07,.054],[m.cyl,.086,.05,.012,.05],[m.sphere,.1,.022,.022,.022]];
    default:return[b,[m.cone,.045,.054,.07,.054],[m.cube,.106,.012,.04,.012],[m.cube,.11,.03,.01,.012]];
  }
}
const OVER={mate:'Мат',stalemate:'Пат — ничья',draw50:'Ничья (50 ходов)',material:'Ничья: не хватает фигур',rep:'Ничья: тройное повторение'};
function pushPos(S,p){const k=C.key(p);S.keys[k]=(S.keys[k]||0)+1;return S.keys[k];}
function result(S){
  const st=C.status(S.pos,S.moves);
  if(st==='play'||st==='check'){if(S.keys[C.key(S.pos)]>=3)return 'rep';return st;}
  return st;
}
function fresh(E,S){
  S.reported=false;
  S.pos=C.start();S.moves=C.legal(S.pos);S.hist=[];S.keys={};pushPos(S,S.pos);
  S.sel=-1;S.dests=[];S.promo=null;S.last=null;S.wait=0;S.thinking=false;S.over=null;
  S.flip=S.me===-1;
}
const duelNames=S=>{const t=VR.games&&S.duel&&VR.games.tour.get(S.duel.tid);if(!t)return null;const m=t.rounds[S.duel.r][S.duel.i],w=m.sw?m.b:m.a,b=m.sw?m.a:m.b;return{t,m,w,b,wn:t.names[w]||'?',bn:t.names[b]||'?'};};
function report(E,S){
  if(S.reported||!S.over)return;S.reported=true;const G=VR.games;if(!G)return;
  const mate=S.over==='mate',winner=mate?-S.pos.t:0;
  try{
    if(S.duel){
      const d=duelNames(S);if(!d)return;
      const side=winner===0?'draw':(winner===1?(d.m.sw?'b':'a'):(d.m.sw?'a':'b'));
      for(const[sid,col]of[[d.w,1],[d.b,-1]])G.record({sid,name:d.t.names[sid]||'Ученик',game:'chess',res:winner===0?'draw':winner===col?'win':'lose',moves:S.hist.length,vs:'duel',opp:col===1?d.bn:d.wn,tid:d.t.id,mid:S.duel.r+'.'+S.duel.i});
      G.tour.reportDuel(S.duel.tid,S.duel.r,S.duel.i,side);
    }else G.finish(E,'chess',{res:winner===0?'draw':winner===S.me?'win':'lose',lvl:S.level,moves:S.hist.length,vs:'comp'});
  }catch(e){}
}
function after(E,S,m,mine){
  const san=C.san(S.pos,m,S.moves),prev=S.pos;
  S.hist.push({pos:prev,san,m});
  S.pos=C.apply(prev,m);S.moves=C.legal(S.pos);pushPos(S,S.pos);
  S.last=m;S.sel=-1;S.dests=[];S.promo=null;S.wait=0;
  const r=result(S);S.over=(r==='play'||r==='check')?null:r;
  S.check=r==='check'||r==='mate';
  if(S.over){
    const mine2=r==='mate'&&S.pos.t!==S.me;
    if(mine2){E.fanfare();E.discover('hall','chess_win','Победа над компьютером');}else E.chime();
  }else E.beep(mine?520:420,.07,'triangle',.05);
  report(E,S);
  S.panel.dirty=true;
}
function userMove(E,S,from,to,promo){
  const m=C.find(S.pos,from,to,promo);if(!m)return;after(E,S,m,true);
}
function cellSel(E,S,h,sq){
  if(S.over||S.thinking||(!S.duel&&S.pos.t!==S.me)||S.promo)return;
  const v=S.pos.b[sq];
  if(v&&Math.sign(v)===(S.duel?S.pos.t:S.me)){
    S.sel=sq;S.dests=S.moves.filter(m=>m.f===sq).map(m=>m.t);E.beep(700,.05,'sine',.04);E.buzz(h,.3,20);return;
  }
  if(S.sel>=0&&S.dests.indexOf(sq)>=0){
    const mv=S.moves.filter(m=>m.f===S.sel&&m.t===sq);
    if(mv.length>1||(mv[0]&&mv[0].pr)){S.promo={f:S.sel,t:sq};S.panel.dirty=true;E.beep(800,.06);return;}
    userMove(E,S,S.sel,sq,0);
  }else{S.sel=-1;S.dests=[];}
}
function compMove(E,S){
  const r=C.think(S.pos,S.level);
  S.thinking=false;
  if(r&&r.m)after(E,S,r.m,false);else S.panel.dirty=true;
}
function undo(E,S){
  if(S.thinking||!S.hist.length||S.duel||S.over)return;
  do{const h=S.hist.pop();S.pos=h.pos;}while(S.hist.length&&S.pos.t!==S.me);
  S.moves=C.legal(S.pos);S.keys={};S.hist.forEach(h=>pushPos(S,h.pos));pushPos(S,S.pos);
  S.last=S.hist.length?S.hist[S.hist.length-1].m:null;S.sel=-1;S.dests=[];S.promo=null;S.over=null;S.check=C.inCheck(S.pos);S.wait=0;
  S.panel.dirty=true;E.beep(330,.08);
}
function statusText(S){
  if(S.over){
    if(S.duel&&S.over==='mate'){const d=duelNames(S);return 'Мат! Выиграл '+(d?(S.pos.t===1?d.bn:d.wn):'соперник')+'. Результат записан в турнир.';}
    if(S.duel)return OVER[S.over]+' — переигровка с обменом цветов.';
    if(S.over==='mate')return S.pos.t===S.me?'Мат. Компьютер выиграл. Попробуй уровень ниже!':'Мат! Ты выиграл!';
    return OVER[S.over];
  }
  if(S.duel){const d=duelNames(S);return (S.pos.t===1?'Ход белых':'Ход чёрных')+(d?' — '+(S.pos.t===1?d.wn:d.bn):'')+(S.check?' — шах!':'');}
  if(S.thinking)return 'Компьютер думает…';
  const mine=S.pos.t===S.me;
  return (mine?'Твой ход':'Ход компьютера')+(S.check?' — шах!':'');
}
function panelDraw(E,S,c,p){
  const X=36,W=p.W-72;
  p.text('Шахматы',X,18,{size:56,bold:true,maxW:420});
  p.text(statusText(S),X+330,28,{size:40,bold:true,color:S.over?'#fde68a':S.check?'#fca5a5':'#bbf7d0',maxW:W-330});
  if(S.promo){
    p.text('Во что превратить пешку?',X,110,{size:40,maxW:W});
    [5,4,3,2].forEach((t,i)=>p.button(X+i*(W/4),170,W/4-14,100,NAMES[t],()=>{const pr=S.promo;S.promo=null;userMove(E,S,pr.f,pr.t,t);},{size:40,bg:'#7c3aed'}));
    return;
  }
  if(VR.ROOMS.arena)p.button(X+330,110,p.W-X*2-330-(S.duel?0:320),72,'В зал турниров',()=>E.goRoom('arena'),{size:28,bg:'#475569'});
  if(!S.duel)p.button(p.W-X-300,110,300,72,S.cfg?'Скрыть ⚙':'Настройки ⚙',()=>{S.cfg=!S.cfg;S.cpanel.show=S.cfg;S.cpanel.dirty=true;S.panel.dirty=true;E.beep(S.cfg?660:440,.06);},{size:32,bg:'#b45309'});
  /* записи ходов: последние 8 */
  const h=S.hist,from=Math.max(0,h.length-8-(h.length%2?1:0)),lines=[];
  for(let i=from;i<h.length;i+=2)lines.push(((i>>1)+1)+'. '+h[i].san+(h[i+1]?'   '+h[i+1].san:''));
  p.text(lines.length?lines.join('    '):'Ходы появятся здесь. Курок на свою фигуру, потом на клетку.',X,210,{size:34,color:'#cbd5e1',maxW:W,maxY:p.H-20});
}
function cfgDraw(E,S,c,p){
  const X=30,W=p.W-60,bw=(W-14)/2;
  p.text('Настройки',X,18,{size:48,bold:true,maxW:W});
  p.text('Уровень компьютера',X,92,{size:28,color:'#94a3b8',maxW:W});
  C.LEVELS.forEach((L,i)=>p.button(X+(i%2)*(bw+14),126+((i/2)|0)*84,bw,72,L.name,()=>{S.level=i;S.cpanel.dirty=true;},{size:32,active:S.level===i,activeBg:'#0f766e',bg:'#1e293b'}));
  p.text('Играю за',X,302,{size:28,color:'#94a3b8',maxW:W});
  p.button(X,336,bw,72,'Белых',()=>{if(S.me!==1){S.me=1;fresh(E,S);S.panel.dirty=true;S.cpanel.dirty=true;}},{size:34,active:S.me===1,activeBg:'#0f766e',bg:'#1e293b'});
  p.button(X+bw+14,336,bw,72,'Чёрных',()=>{if(S.me!==-1){S.me=-1;fresh(E,S);S.panel.dirty=true;S.cpanel.dirty=true;}},{size:34,active:S.me===-1,activeBg:'#0f766e',bg:'#1e293b'});
  p.button(X,430,bw,72,'Новая игра',()=>{fresh(E,S);S.panel.dirty=true;E.beep(500,.08);},{size:30,bg:'#b45309'});
  p.button(X+bw+14,430,bw,72,'Отменить ход',()=>undo(E,S),{size:28,bg:'#334155'});
  p.button(X,526,W,72,'Закрыть',()=>{S.cfg=false;S.cpanel.show=false;S.panel.dirty=true;},{size:34,bg:'#475569'});
}
ROOMS.play={
  title:'Игровая',env:{floor:[.1,.07,.05],wall:[.22,.14,.1],trim:[.98,.75,.3],grid:[.6,.4,.2]},spawn:{x:0,z:-.5},
  hint:'Игровая: шахматы против компьютера. Курок на свою фигуру, потом на клетку.',
  build(E,S){
    VR.RU.backDoor(E);
    S.level=S.level===undefined?1:S.level;S.me=1;S.duel=null;
    const pd=VR.games&&VR.games.pending;if(pd&&pd.game==='chess'){S.duel={tid:pd.tid,r:pd.r,i:pd.i};VR.games.pending=null;}
    E.addTable(CX,CZ,.6,.6,TOP,[.42,.27,.16]);
    E.addBox({x:CX,z:CZ,hx:.6,hz:.6,top:TOP});
    for(let r=0;r<8;r++)for(let f=0;f<8;f++){
      const light=(r+f)%2===1;
      E.addStatic(E.mesh.cube,TRS(CX+(f-3.5)*CS,TOP+.006,CZ-(r-3.5)*CS,CS,.012,CS),light?[.86,.78,.6]:[.4,.27,.18],0);
    }
    S.panel=E.addPanel({w:1.8,h:1.0,pos:[0,1.55,-3.55],yaw:0,accent:'#f59e0b',draw:(c,p)=>panelDraw(E,S,c,p)});
    S.cfg=false;
    S.cpanel=E.addPanel({w:1.1,h:.9,res:768,pos:[1.7,1.45,-3.3],yaw:0,accent:'#f59e0b',show:false,draw:(c,p)=>cfgDraw(E,S,c,p)});
    fresh(E,S);
  },
  targets(E,S){
    const t=[];
    for(let sq=0;sq<64;sq++){const[x,z]=cellXZ(S,sq);t.push({c:[x,Y0+.03,z],r:CS*.5,id:'c'+sq,sel:h=>cellSel(E,S,h,sq)});}
    return t;
  },
  update(E,S,dt){
    if(S.duel||S.over||S.promo||!S.pos||S.pos.t===S.me)return;
    S.wait+=dt;
    if(S.thinking){compMove(E,S);return;}
    if(S.wait>.7){S.thinking=true;S.panel.dirty=true;}
  },
  draw(E,S,add){
    if(!S.pos)return;
    const m=E.mesh,hi=(sq,col,em)=>{const[x,z]=cellXZ(S,sq);add(m.cube,TRS(x,Y0+.0015,z,CS*.94,.004,CS*.94),col,em);};
    if(S.last){hi(S.last.f,[.35,.6,.9],.5);hi(S.last.t,[.35,.6,.9],.5);}
    if(S.check){const k=S.pos.b.findIndex(v=>v===C.K*S.pos.t);if(k>=0)hi(k,[.95,.2,.2],.7);}
    if(S.sel>=0)hi(S.sel,[.95,.85,.2],.7);
    for(const d of S.dests){const[x,z]=cellXZ(S,d);add(m.sphere,TRS(x,Y0+.012,z,.03,.012,.03),[.2,.9,.4],.9);}
    for(let sq=0;sq<64;sq++){
      const v=S.pos.b[sq];if(!v)continue;
      const[x,z]=cellXZ(S,sq),col=v>0?WH:BL,lift=sq===S.sel?.02:0,yaw=v>0?0:Math.PI;
      for(const[mesh,y,w,h,d]of parts(E,Math.abs(v))){
        const fwd=Math.abs(v)===2&&mesh===m.cube?(v>0?-.008:.008):0;
        add(mesh,TRS(x,Y0+y+lift,z+fwd,w,h,d,yaw),col,.08);
      }
    }
  }
};
})();

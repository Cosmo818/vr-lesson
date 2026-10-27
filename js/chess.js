/* chess.js — шахматы: правила и компьютерный соперник (чистые функции, без DOM и WebGL).
   Позиция: {b:Int8Array(64), t:1|-1 (чей ход: 1 — белые), c:права рокировки (1 K, 2 Q, 4 k, 8 q), ep:клетка взятия на проходе или −1, h:полуходы без взятия и хода пешки, n:номер хода}.
   Клетка = ряд*8+вертикаль (a1 = 0, h8 = 63). Фигуры: 1 пешка, 2 конь, 3 слон, 4 ладья, 5 ферзь, 6 король; белые >0, чёрные <0.
   Ход: {f,t,pr:фигура превращения или 0,ep:true при взятии на проходе,cs:1 короткая / 2 длинная рокировка}.
   Правила проверяются perft-тестами (tests/run.js): старт 20/400/8902/197281, Kiwipete 48/2039/97862 и др. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const P=1,N=2,B=3,R=4,Q=5,K=6;
const KN=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const DG=[[1,1],[1,-1],[-1,1],[-1,-1]],OR=[[1,0],[-1,0],[0,1],[0,-1]],KG=DG.concat(OR);
const START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LET={p:P,n:N,b:B,r:R,q:Q,k:K};
const FEN_CH=' PNBRQK';

function fromFEN(fen){
  const f=fen.trim().split(/\s+/),b=new Int8Array(64),rows=f[0].split('/');
  if(rows.length!==8)throw new Error('FEN: нужно 8 рядов');
  for(let i=0;i<8;i++){
    let file=0;const r=7-i;
    for(const ch of rows[i]){
      if(ch>='1'&&ch<='8'){file+=+ch;continue;}
      const t=LET[ch.toLowerCase()];if(!t||file>7)throw new Error('FEN: плохая фигура '+ch);
      b[r*8+file]=ch===ch.toLowerCase()?-t:t;file++;
    }
    if(file!==8)throw new Error('FEN: в ряду не 8 клеток');
  }
  const cs=f[2]||'-';
  const c=(cs.indexOf('K')>=0?1:0)|(cs.indexOf('Q')>=0?2:0)|(cs.indexOf('k')>=0?4:0)|(cs.indexOf('q')>=0?8:0);
  const ep=f[3]&&f[3]!=='-'?(f[3].charCodeAt(0)-97)+(+f[3][1]-1)*8:-1;
  return{b,t:f[1]==='b'?-1:1,c,ep,h:+(f[4]||0),n:+(f[5]||1)};
}
function toFEN(p){
  let s='';
  for(let r=7;r>=0;r--){
    let e=0;
    for(let x=0;x<8;x++){
      const v=p.b[r*8+x];
      if(!v){e++;continue;}
      if(e){s+=e;e=0;}
      const ch=FEN_CH[Math.abs(v)];s+=v>0?ch:ch.toLowerCase();
    }
    if(e)s+=e;
    if(r)s+='/';
  }
  const cs=(p.c&1?'K':'')+(p.c&2?'Q':'')+(p.c&4?'k':'')+(p.c&8?'q':'');
  return s+' '+(p.t>0?'w':'b')+' '+(cs||'-')+' '+(p.ep>=0?sqName(p.ep):'-')+' '+p.h+' '+p.n;
}
/* ключ позиции для подсчёта повторений: расстановка, очередь хода, права, взятие на проходе */
function key(p){return toFEN(p).split(' ').slice(0,4).join(' ');}
function sqName(s){return String.fromCharCode(97+(s&7))+((s>>3)+1);}
function sqOf(name){return (name.charCodeAt(0)-97)+(+name[1]-1)*8;}
function start(){return fromFEN(START);}
function clone(p){return{b:p.b.slice(),t:p.t,c:p.c,ep:p.ep,h:p.h,n:p.n};}

/* клетка s под боем стороны by (1 — белые, −1 — чёрные) */
function attacked(b,s,by){
  const f=s&7,r=s>>3;
  const pr=r-by;/* пешка стороны by бьёт «вперёд» по своему ходу, значит стоит на ряд ближе к своей базе */
  if(pr>=0&&pr<8){
    if(f>0&&b[pr*8+f-1]===by*P)return true;
    if(f<7&&b[pr*8+f+1]===by*P)return true;
  }
  for(const d of KN){const x=f+d[0],y=r+d[1];if(x>=0&&x<8&&y>=0&&y<8&&b[y*8+x]===by*N)return true;}
  for(const d of KG){const x=f+d[0],y=r+d[1];if(x>=0&&x<8&&y>=0&&y<8&&b[y*8+x]===by*K)return true;}
  for(const d of DG){let x=f+d[0],y=r+d[1];while(x>=0&&x<8&&y>=0&&y<8){const v=b[y*8+x];if(v){if(v===by*B||v===by*Q)return true;break;}x+=d[0];y+=d[1];}}
  for(const d of OR){let x=f+d[0],y=r+d[1];while(x>=0&&x<8&&y>=0&&y<8){const v=b[y*8+x];if(v){if(v===by*R||v===by*Q)return true;break;}x+=d[0];y+=d[1];}}
  return false;
}
function kingSq(b,side){for(let i=0;i<64;i++)if(b[i]===side*K)return i;return -1;}
function inCheck(p,side){const k=kingSq(p.b,side===undefined?p.t:side);return k>=0&&attacked(p.b,k,-(side===undefined?p.t:side));}

/* ходы без проверки собственного шаха */
function pseudo(p){
  const b=p.b,t=p.t,out=[],add=(f,to,pr,ep,cs)=>out.push({f,t:to,pr:pr||0,ep:!!ep,cs:cs||0});
  for(let s=0;s<64;s++){
    const v=b[s];if(!v||(v>0?1:-1)!==t)continue;
    const a=Math.abs(v),f=s&7,r=s>>3;
    if(a===P){
      const r1=r+t,last=t>0?7:0;
      if(r1<0||r1>7)continue;
      const push=(to,cap)=>{if(r1===last){for(const pr of[Q,R,B,N])add(s,to,pr);}else add(s,to);};
      if(!b[r1*8+f]){
        push(r1*8+f);
        if(r===(t>0?1:6)&&!b[(r+2*t)*8+f])add(s,(r+2*t)*8+f);
      }
      for(const df of[-1,1]){
        const x=f+df;if(x<0||x>7)continue;
        const to=r1*8+x,tv=b[to];
        if(tv&&(tv>0?1:-1)!==t)push(to);
        else if(!tv&&to===p.ep)add(s,to,0,true);
      }
    }else if(a===N||a===K){
      const ds=a===N?KN:KG;
      for(const d of ds){
        const x=f+d[0],y=r+d[1];if(x<0||x>7||y<0||y>7)continue;
        const tv=b[y*8+x];if(!tv||(tv>0?1:-1)!==t)add(s,y*8+x);
      }
      if(a===K){
        const home=t>0?0:56,kb=t>0?1:4,qb=t>0?2:8;
        if(s===home+4&&!attacked(b,s,-t)){
          if((p.c&kb)&&!b[home+5]&&!b[home+6]&&b[home+7]===t*R&&!attacked(b,home+5,-t)&&!attacked(b,home+6,-t))add(s,home+6,0,false,1);
          if((p.c&qb)&&!b[home+3]&&!b[home+2]&&!b[home+1]&&b[home]===t*R&&!attacked(b,home+3,-t)&&!attacked(b,home+2,-t))add(s,home+2,0,false,2);
        }
      }
    }else{
      const ds=a===B?DG:a===R?OR:KG;
      for(const d of ds){
        let x=f+d[0],y=r+d[1];
        while(x>=0&&x<8&&y>=0&&y<8){
          const tv=b[y*8+x];
          if(!tv)add(s,y*8+x);
          else{if((tv>0?1:-1)!==t)add(s,y*8+x);break;}
          x+=d[0];y+=d[1];
        }
      }
    }
  }
  return out;
}
/* сделать ход, вернуть НОВУЮ позицию */
function apply(p,m){
  const q=clone(p),b=q.b,v=b[m.f],a=Math.abs(v),t=p.t;
  const cap=b[m.t];
  b[m.t]=m.pr?t*m.pr:v;b[m.f]=0;
  if(m.ep)b[m.t-8*t]=0;
  if(m.cs){const home=t>0?0:56;if(m.cs===1){b[home+7]=0;b[home+5]=t*R;}else{b[home]=0;b[home+3]=t*R;}}
  q.ep=(a===P&&Math.abs(m.t-m.f)===16)?(m.f+m.t)/2:-1;
  if(a===K)q.c&=t>0?~3:~12;
  /* ладья ушла с угла или её съели в углу */
  if(m.f===0||m.t===0)q.c&=~2;
  if(m.f===7||m.t===7)q.c&=~1;
  if(m.f===56||m.t===56)q.c&=~8;
  if(m.f===63||m.t===63)q.c&=~4;
  q.h=(a===P||cap||m.ep)?0:p.h+1;
  q.t=-t;if(t<0)q.n=p.n+1;
  return q;
}
function legal(p){
  const out=[];
  for(const m of pseudo(p)){const q=apply(p,m),k=kingSq(q.b,p.t);if(k>=0&&!attacked(q.b,k,-p.t))out.push(m);}
  return out;
}
function insufficient(b){
  const mn=[];
  for(let i=0;i<64;i++){const a=Math.abs(b[i]);if(!a||a===K)continue;if(a===P||a===R||a===Q)return false;mn.push([a,(i&7)+(i>>3)&1,b[i]>0]);}
  if(mn.length<=1)return true;
  if(mn.every(x=>x[0]===B)&&mn.every(x=>x[1]===mn[0][1]))return true;/* только слоны одного цвета клеток */
  return false;
}
/* 'play' | 'check' | 'mate' | 'stalemate' | 'draw50' | 'material'; повторения считает вызывающий по key() */
function status(p,moves){
  const ms=moves||legal(p),chk=inCheck(p);
  if(!ms.length)return chk?'mate':'stalemate';
  if(insufficient(p.b))return 'material';
  if(p.h>=100)return 'draw50';
  return chk?'check':'play';
}
function perft(p,d){
  if(d===0)return 1;
  const ms=legal(p);if(d===1)return ms.length;
  let n=0;for(const m of ms)n+=perft(apply(p,m),d-1);return n;
}
/* ход по клеткам (для интерфейса): from, to — индексы; promo — фигура 2..5 или 0; возвращает ход из legal или null */
function find(p,from,to,promo){
  return legal(p).find(m=>m.f===from&&m.t===to&&(m.pr||0)===(promo||0))||null;
}
/* запись хода по-русски: Кр, Ф, Л, С, К; рокировка 0-0 / 0-0-0; + шах, # мат */
const RU=['','','К','С','Л','Ф','Кр'];
function san(p,m,ms){
  ms=ms||legal(p);
  const v=Math.abs(p.b[m.f]);
  let s;
  if(m.cs)s=m.cs===1?'0-0':'0-0-0';
  else{
    const cap=p.b[m.t]||m.ep;
    if(v===P)s=(cap?String.fromCharCode(97+(m.f&7))+'x':'')+sqName(m.t)+(m.pr?'='+RU[m.pr]:'');
    else{
      s=RU[v];
      const same=ms.filter(o=>o!==m&&o.t===m.t&&Math.abs(p.b[o.f])===v);
      if(same.length){
        if(!same.some(o=>(o.f&7)===(m.f&7)))s+=String.fromCharCode(97+(m.f&7));
        else if(!same.some(o=>(o.f>>3)===(m.f>>3)))s+=(m.f>>3)+1;
        else s+=sqName(m.f);
      }
      s+=(cap?'x':'')+sqName(m.t);
    }
  }
  const q=apply(p,m),st=status(q);
  return s+(st==='mate'?'#':st==='check'?'+':'');
}

/* ---------------- компьютерный соперник ---------------- */
const VAL=[0,100,320,330,500,900,0];
/* простые таблицы клеток (с точки зрения белых, ряд 1 внизу): тянут фигуры к центру, пешки вперёд, короля в угол */
const PST={
  [P]:[0,0,0,0,0,0,0,0, 5,10,10,-20,-20,10,10,5, 5,-5,-10,0,0,-10,-5,5, 0,0,0,20,20,0,0,0, 5,5,10,25,25,10,5,5, 10,10,20,30,30,20,10,10, 50,50,50,50,50,50,50,50, 0,0,0,0,0,0,0,0],
  [N]:[-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,5,5,0,-20,-40, -30,5,10,15,15,10,5,-30, -30,0,15,20,20,15,0,-30, -30,5,15,20,20,15,5,-30, -30,0,10,15,15,10,0,-30, -40,-20,0,0,0,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  [B]:[-20,-10,-10,-10,-10,-10,-10,-20, -10,5,0,0,0,0,5,-10, -10,10,10,10,10,10,10,-10, -10,0,10,10,10,10,0,-10, -10,5,5,10,10,5,5,-10, -10,0,5,10,10,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  [R]:[0,0,0,5,5,0,0,0, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 5,10,10,10,10,10,10,5, 0,0,0,0,0,0,0,0],
  [Q]:[-20,-10,-10,-5,-5,-10,-10,-20, -10,0,5,0,0,0,0,-10, -10,5,5,5,5,5,0,-10, 0,0,5,5,5,5,0,-5, -5,0,5,5,5,5,0,-5, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  [K]:[20,30,10,0,0,10,30,20, 20,20,0,0,0,0,20,20, -10,-20,-20,-20,-20,-20,-20,-10, -20,-30,-30,-40,-40,-30,-30,-20, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30]
};
/* оценка в сотых пешки с точки зрения стороны, которая ходит */
function evaluate(p){
  let s=0;
  for(let i=0;i<64;i++){
    const v=p.b[i];if(!v)continue;
    const a=Math.abs(v);
    if(v>0)s+=VAL[a]+PST[a][i];else s-=VAL[a]+PST[a][(7-(i>>3))*8+(i&7)];
  }
  return p.t>0?s:-s;
}
const LEVELS=[
  {name:'Новичок',depth:1,noise:140,rnd:.3,ms:30,nodes:3000},
  {name:'Любитель',depth:2,noise:35,rnd:0,ms:80,nodes:20000},
  {name:'Разрядник',depth:3,noise:8,rnd:0,ms:250,nodes:60000},
  {name:'Сильный',depth:4,noise:0,rnd:0,ms:600,nodes:150000}
];
const now=()=>(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
const MATE=100000;
function order(p,ms){
  return ms.map(m=>{
    const tv=p.b[m.t],v=Math.abs(p.b[m.f]);
    let sc=0;
    if(tv||m.ep)sc=10*VAL[Math.abs(tv)||1]-VAL[v]+1000;
    if(m.pr)sc+=VAL[m.pr];
    if(m.cs)sc+=30;
    return{m,sc};
  }).sort((a,b)=>b.sc-a.sc).map(x=>x.m);
}
/* ходы-взятия для тихого поиска */
function captures(p){return legal(p).filter(m=>p.b[m.t]||m.ep||m.pr);}
function search(p,depth,alpha,beta,ply,ctx){
  if((++ctx.nodes&127)===0&&(ctx.nodes>ctx.maxNodes||now()>ctx.deadline))ctx.abort=true;
  if(ctx.abort)return 0;
  if(p.h>=100)return 0;
  const ms=legal(p);
  if(!ms.length)return inCheck(p)?-MATE+ply:0;
  if(depth<=0){
    /* тихий поиск: пока есть выгодные взятия, не оцениваем «посреди размена» (до 4 слоёв) */
    let st=evaluate(p);
    if(!ctx.qs||ply>=ctx.maxPly)return st;
    if(st>=beta)return st;
    if(st>alpha)alpha=st;
    for(const m of order(p,ms.filter(x=>p.b[x.t]||x.ep||x.pr))){
      const sc=-search(apply(p,m),0,-beta,-alpha,ply+1,ctx);
      if(ctx.abort)return 0;
      if(sc>=beta)return sc;
      if(sc>alpha)alpha=sc;
    }
    return alpha;
  }
  let best=-Infinity;
  for(const m of order(p,ms)){
    const sc=-search(apply(p,m),depth-1,-beta,-alpha,ply+1,ctx);
    if(ctx.abort)return 0;
    if(sc>best)best=sc;
    if(sc>alpha)alpha=sc;
    if(alpha>=beta)break;
  }
  return best;
}
/* выбор хода компьютера: level 0–3 (LEVELS), rnd — функция случайных чисел (для тестов можно подменить). Возвращает {m,score,depth,nodes} или null, если ходов нет. */
function think(p,level,rnd){
  const L=LEVELS[Math.max(0,Math.min(LEVELS.length-1,level|0))],rn=rnd||Math.random;
  const ms=legal(p);if(!ms.length)return null;
  if(L.rnd&&rn()<L.rnd)return{m:ms[(rn()*ms.length)|0],score:0,depth:0,nodes:0};
  const ctx={nodes:0,maxNodes:L.nodes,deadline:now()+L.ms,abort:false,qs:L.depth>=3,maxPly:L.depth+6};
  let best=null,done=0;
  const ord=order(p,ms);
  for(let d=1;d<=L.depth;d++){
    let cur=null,alpha=-Infinity;const scored=[];
    for(const m of ord){
      /* без шума достаточно границ (отсечение по лучшему ходу); с шумом нужны точные оценки всех ходов */
      const sc=-search(apply(p,m),d-1,-Infinity,L.noise?Infinity:-alpha,1,ctx);
      if(ctx.abort)break;
      if(sc>alpha)alpha=sc;
      scored.push({m,sc:sc+(L.noise?(rn()*2-1)*L.noise:0)});
    }
    if(ctx.abort&&d>1)break;
    if(scored.length){
      scored.sort((a,b)=>b.sc-a.sc);cur=scored[0];
      best={m:cur.m,score:cur.sc,depth:d,nodes:ctx.nodes};done=d;
      ord.sort((a,b)=>((scored.find(x=>x.m===b)||{sc:-1e9}).sc)-((scored.find(x=>x.m===a)||{sc:-1e9}).sc));
    }
    if(ctx.abort)break;
  }
  if(!best)best={m:ord[0],score:0,depth:0,nodes:ctx.nodes};
  return best;
}

VR.chess={START,fromFEN,toFEN,key,start,clone,attacked,inCheck,legal,apply,status,perft,find,san,sqName,sqOf,evaluate,think,LEVELS,P,N,B,R,Q,K,VAL};
})();

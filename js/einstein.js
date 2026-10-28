/* einstein.js — головоломка «Эйнштейн» (порт идеи Einstein 2.0 / Sherlock): чистая логика и рисование фишек, без WebGL.
   Поле 6x6: в каждой из 6 строк (A–F) стоят 6 разных фишек своего типа (цифры, буквы, римские цифры, кости, фигуры, знаки)
   по колонкам 1–6. Ходы: в клетке оставлены возможные фишки; левый клик — выбрать фишку, правый — исключить.
   Ошибка (убрана верная или выбрана неверная фишка) — проигрыш. Подсказки: near (в соседних колонках), dir (левее),
   open (фишка в колонке), under (в одной колонке), btw (посередине между двумя, вплотную).
   Генератор: случайное решение → случайные подсказки, пока решается одними подсказками → лишние убираются. Сид делает партию повторяемой
   (для соревнований у всех участников одна и та же головоломка). Алгоритм — по описанию правил оригинала, код и картинки свои. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const N=6;
const idx=(c,r,e)=>(c*N+r)*N+e-1;

/* ---------- генератор случайных чисел с сидом ---------- */
function rng(seed){
  let a=(seed>>>0)||1;
  const f=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  return n=>Math.floor(f()*n);
}

/* ---------- возможные фишки ---------- */
class Poss{
  constructor(){this.p=new Uint8Array(N*N*N);this.reset();}
  reset(){for(let c=0;c<N;c++)for(let r=0;r<N;r++)for(let e=1;e<=N;e++)this.p[idx(c,r,e)]=e;}
  clone(){const q=new Poss();q.p.set(this.p);return q;}
  can(c,r,e){return this.p[idx(c,r,e)]===e;}
  count(c,r){let n=0;for(let e=1;e<=N;e++)if(this.can(c,r,e))n++;return n;}
  defined(c,r){return this.count(c,r)===1;}
  value(c,r){for(let e=1;e<=N;e++)if(this.can(c,r,e))return e;return 0;}
  solved(){for(let c=0;c<N;c++)for(let r=0;r<N;r++)if(!this.defined(c,r))return false;return true;}
  valid(sol){for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(!this.can(c,r,sol[r][c]))return false;return true;}
  /* в строке: клетка с одной фишкой, а фишка ещё где-то есть → убрать оттуда; фишка только в одной клетке → клетка её */
  singles(r){
    for(;;){
      const cells=new Array(N).fill(0),els=new Array(N).fill(0),elOf=new Array(N).fill(0),cellOf=new Array(N).fill(0);
      for(let c=0;c<N;c++)for(let i=0;i<N;i++)if(this.p[idx(c,r,i+1)]){els[i]++;cellOf[i]=c;cells[c]++;elOf[c]=i+1;}
      let ch=false;
      for(let c=0;c<N;c++)if(cells[c]===1&&els[elOf[c]-1]!==1){const e=elOf[c]-1;for(let i=0;i<N;i++)if(i!==c)this.p[idx(i,r,e+1)]=0;ch=true;}
      for(let e=0;e<N;e++)if(els[e]===1&&cells[cellOf[e]]!==1){const c=cellOf[e];for(let i=0;i<N;i++)if(i!==e)this.p[idx(c,r,i+1)]=0;ch=true;}
      if(!ch)return;
    }
  }
  exclude(c,r,e){if(!this.can(c,r,e))return;this.p[idx(c,r,e)]=0;this.singles(r);}
  set(c,r,e){
    for(let i=1;i<=N;i++)this.p[idx(c,r,i)]=i===e?e:0;
    for(let j=0;j<N;j++)if(j!==c)this.p[idx(j,r,e)]=0;
    this.singles(r);
  }
}

/* ---------- подсказки ---------- */
const R={
  near:{
    gen(sol,rn){
      const c1=rn(N),a=[rn(N),0];a[1]=sol[a[0]][c1];
      const c2=c1===0?1:c1===N-1?N-2:(rn(2)?c1+1:c1-1),b=[rn(N),0];b[1]=sol[b[0]][c2];
      return{t:'near',a,b};
    },
    apply(s,P){
      let ch=false;
      const one=(c,n,t)=>{
        const l=c>0&&P.can(c-1,n[0],n[1]),r=c<N-1&&P.can(c+1,n[0],n[1]);
        if(!l&&!r&&P.can(c,t[0],t[1])){P.exclude(c,t[0],t[1]);return true;}
        return false;
      };
      for(let again=true;again;){again=false;
        for(let c=0;c<N;c++){if(one(c,s.a,s.b))again=ch=true;if(one(c,s.b,s.a))again=ch=true;}}
      return ch;
    }
  },
  dir:{
    gen(sol,rn){
      const r1=rn(N),r2=rn(N),c1=rn(N-1),c2=rn(N-c1-1)+c1+1;
      return{t:'dir',a:[r1,sol[r1][c1]],b:[r2,sol[r2][c2]]};
    },
    apply(s,P){
      let ch=false;const[r1,t1]=s.a,[r2,t2]=s.b;
      for(let i=0;i<N;i++){if(P.can(i,r2,t2)){P.exclude(i,r2,t2);ch=true;}if(P.can(i,r1,t1))break;}
      for(let i=N-1;i>=0;i--){if(P.can(i,r1,t1)){P.exclude(i,r1,t1);ch=true;}if(P.can(i,r2,t2))break;}
      return ch;
    }
  },
  open:{
    gen(sol,rn){const c=rn(N),r=rn(N);return{t:'open',col:c,row:r,thing:sol[r][c]};},
    apply(s,P){if(!P.defined(s.col,s.row)){P.set(s.col,s.row,s.thing);return true;}return false;},
    onStart:true
  },
  under:{
    gen(sol,rn){
      const c=rn(N);let r1=rn(N),r2;do{r2=rn(N);}while(r2===r1);
      /* верхняя фишка подсказки — из верхней строки поля (как в оригинале: картинка совпадает с полем) */
      if(r1>r2){const t=r1;r1=r2;r2=t;}
      return{t:'under',a:[r1,sol[r1][c]],b:[r2,sol[r2][c]]};
    },
    apply(s,P){
      let ch=false;const[r1,t1]=s.a,[r2,t2]=s.b;
      for(let i=0;i<N;i++){
        if(!P.can(i,r1,t1)&&P.can(i,r2,t2)){P.exclude(i,r2,t2);ch=true;}
        if(!P.can(i,r2,t2)&&P.can(i,r1,t1)){P.exclude(i,r1,t1);ch=true;}
      }
      return ch;
    }
  },
  btw:{
    gen(sol,rn){
      const cr=rn(N),r1=rn(N),r2=rn(N),cc=rn(N-2)+1,ct=sol[cr][cc];
      const l=sol[r1][cc-1],r=sol[r2][cc+1],l2=sol[r1][cc+1],r2t=sol[r2][cc-1];
      return rn(2)?{t:'btw',a:[r1,l],b:[r2,r],c:[cr,ct]}:{t:'btw',a:[r1,l2],b:[r2,r2t],c:[cr,ct]};
    },
    apply(s,P){
      let ch=false;const[r1,t1]=s.a,[r2,t2]=s.b,[cr,ct]=s.c;
      if(P.can(0,cr,ct)){P.exclude(0,cr,ct);ch=true;}
      if(P.can(N-1,cr,ct)){P.exclude(N-1,cr,ct);ch=true;}
      for(let good=true;good;){good=false;
        for(let i=1;i<N-1;i++)if(P.can(i,cr,ct)&&!((P.can(i-1,r1,t1)&&P.can(i+1,r2,t2))||(P.can(i-1,r2,t2)&&P.can(i+1,r1,t1)))){P.exclude(i,cr,ct);good=true;}
        for(let i=0;i<N;i++){
          for(const[ra,ta,rb,tb]of[[r2,t2,r1,t1],[r1,t1,r2,t2]]){
            if(!P.can(i,ra,ta))continue;
            const lp=i>=2&&P.can(i-1,cr,ct)&&P.can(i-2,rb,tb),rp=i<N-2&&P.can(i+1,cr,ct)&&P.can(i+2,rb,tb);
            if(!lp&&!rp){P.exclude(i,ra,ta);good=true;}
          }
        }
        if(good)ch=true;
      }
      return ch;
    }
  }
};
const applyRule=(s,P)=>R[s.t].apply(s,P);
/* вид подсказки: vert — внизу (одна колонка), horiz — справа, none — открыта сразу */
const showOf=s=>s.t==='under'?'vert':s.t==='open'?'none':'horiz';
const keyOf=s=>JSON.stringify(s);
const pickRule=(sol,rn)=>{
  /* веса как в оригинале: near 4, open 1, under 2, dir 4, btw 3 (из 14) */
  const a=rn(14);
  return R[a<4?'near':a<5?'open':a<7?'under':a<11?'dir':'btw'].gen(sol,rn);
};
function canSolve(sol,rules){
  const P=new Poss();
  for(const s of rules)if(R[s.t].onStart)applyRule(s,P);
  for(let ch=true;ch;){ch=false;for(const s of rules)if(applyRule(s,P)){ch=true;if(!P.valid(sol))throw new Error('подсказка противоречит решению: '+keyOf(s));}}
  return P.solved();
}
function generate(seed){
  if(seed===undefined||seed===null)seed=(Math.random()*4294967296)>>>0;
  seed=seed>>>0;
  const rn=rng(seed);
  const sol=[];
  for(let r=0;r<N;r++){const a=[1,2,3,4,5,6];for(let i=N-1;i>0;i--){const j=rn(i+1),t=a[i];a[i]=a[j];a[j]=t;}sol.push(a);}
  let rules=[];const seen=new Set();
  for(let done=false;!done;){
    const s=pickRule(sol,rn),k=keyOf(s);
    if(seen.has(k))continue;seen.add(k);rules.push(s);done=canSolve(sol,rules);
  }
  for(let i=0;i<rules.length;){
    const rest=rules.slice(0,i).concat(rules.slice(i+1));
    if(canSolve(sol,rest))rules=rest;else i++;
  }
  return{sol,rules,seed};
}

/* ---------- партия ---------- */
function newGame(pz){
  const P=new Poss();
  for(const s of pz.rules)if(R[s.t].onStart)applyRule(s,P);
  return{pz,P,hidden:new Set(),status:'play',moves:0,t:0};
}
/* button: 1 выбрать фишку e в клетке (c,r), 3 исключить; результат 'noop'|'ok'|'fail'|'win' */
function click(g,c,r,e,button){
  if(g.status!=='play'||!g.P.can(c,r,e))return 'noop';
  if(button===1)g.P.set(c,r,e);else if(button===3)g.P.exclude(c,r,e);else return 'noop';
  g.moves++;
  if(!g.P.valid(g.pz.sol)){g.status='lose';return 'fail';}
  if(g.P.solved()){g.status='win';return 'win';}
  return 'ok';
}
function restart(g){const n=newGame(g.pz);return n;}
const hint=(g)=>{ /* подсказка-помощь: открыть одну неоткрытую клетку (ученику штрафуется — результат помечает вызывающий) */
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(!g.P.defined(c,r)){g.P.set(c,r,g.pz.sol[r][c]);if(g.P.solved())g.status='win';return [c,r];}
  return null;
};

/* ---------- рисование фишек (ctx, ряд 0..5, номер 1..6, квадрат x,y,s) ---------- */
const ROMAN=['I','II','III','IV','V','VI'],MATH=['+','−','÷','×','=','√'];
function drawTile(c,row,n,x,y,s,col){
  c.save();c.fillStyle=c.strokeStyle=col||'#e5e7eb';c.textAlign='center';c.textBaseline='middle';c.lineWidth=Math.max(2,s*.06);c.lineJoin='round';
  const cx=x+s/2,cy=y+s/2;
  if(row<3||row===5){
    const t=row===0?String(n):row===1?'ABCDEF'[n-1]:row===2?ROMAN[n-1]:MATH[n-1];
    c.font='bold '+Math.round(s*(row===2&&n===3?.5:row===2&&n>3?.46:.7))+'px sans-serif';c.fillText(t,cx,cy+s*.04);
  }else if(row===3){
    const D={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]}[n],g=s*.22;
    for(const d of D){c.beginPath();c.arc(cx+((d%3)-1)*g,cy+(((d/3)|0)-1)*g,s*.055,0,6.283);c.fill();}
  }else{
    const k=n<=2?3:n<=4?4:n,R0=s*.34;let rot=n===1?-Math.PI/2:n===2?Math.PI/2:n===3?-Math.PI/4:n===4?0:-Math.PI/2;
    c.beginPath();
    if(n===4){c.moveTo(cx,cy-R0*1.1);c.lineTo(cx+R0*1.1,cy);c.lineTo(cx,cy+R0*1.1);c.lineTo(cx-R0*1.1,cy);}
    else for(let i=0;i<k;i++){const a=rot+i/k*6.283,px=cx+Math.cos(a)*R0*(k===4?1.0:1.05),py=cy+Math.sin(a)*R0*(k===4?1.0:1.05);i?c.lineTo(px,py):c.moveTo(px,py);}
    c.closePath();c.stroke();
  }
  c.restore();
}

/* рисунок подсказки как в оригинале Einstein 2.0: светлые фишки с чёрными знаками;
   «рядом» — красная двойная стрелка на синем квадрате, «левее» — три красные точки на синем квадрате,
   «между» — три фишки и синяя двойная стрелка над средней; вертикальная — две фишки одна над другой */
/* градиент с запасным сплошным цветом (на случай урезанного canvas) */
function grad(c,x,y,T,a,b){const g=c.createLinearGradient&&c.createLinearGradient(x,y,x+T,y+T);if(!g||!g.addColorStop)return b;g.addColorStop(0,a);g.addColorStop(1,b);return g;}
function hintTile(c,row,n,x,y,T,dim){
  const g=grad(c,x,y,T,dim?'#6b7280':'#cfc8c4',dim?'#9ca3af':'#f3eeea');
  c.fillStyle=g;c.fillRect(x,y,T,T);c.strokeStyle='#111';c.lineWidth=Math.max(2,T*.03);c.strokeRect(x+1,y+1,T-2,T-2);
  drawTile(c,row,n,x,y,T,dim?'#374151':'#111');
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

VR.einstein={N,Poss,rng,generate,canSolve,newGame,click,restart,hint,drawTile,drawHint,showOf,keyOf,applyRule,RULES:R};
})();

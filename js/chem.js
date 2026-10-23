/* chem.js — комната «Химия» (Б65). Часть 1: VR.nuc — ядерная модель (чистые функции, без E и DOM).
   Энергия реакции Q = сумма энергий связи продуктов − сумма энергий связи исходных ядер (свободный нейтрон — 0).
   Точные значения — таблица EX (AME2020, A ≤ 40, проверить: factcheck Б65.8), иначе формула Вайцзеккера (коэффициенты Rohlf).
   Верхний уровень — только определения (А16). */
(function(){
'use strict';
const VR=window.VR=window.VR||{};

/* полная энергия связи ядра, МэВ; ключ 'Z-A' (AME2020; проверить) */
const EX={'1-1':0,'1-2':2.2246,'1-3':8.4818,'2-3':7.7180,'2-4':28.2957,'3-6':31.9940,'3-7':39.2446,'4-8':56.4995,'4-9':58.1650,
  '5-10':64.7507,'5-11':76.2052,'6-12':92.1617,'6-13':97.1081,'6-14':105.2845,'7-14':104.6587,'7-15':115.4919,
  '8-16':127.6193,'8-17':131.7627,'8-18':139.8074,'9-19':147.8013,'10-20':160.6448,'11-23':186.5641,'12-24':198.2569,
  '13-27':224.9519,'14-28':236.5368,'15-31':262.9166,'16-32':271.7808,'17-35':298.2097,'18-40':343.8104,
  '19-39':333.7241,'20-40':342.0521,
  /* добавлено (AME2020, проверить): лёгкие ядра, которые появляются в дереве; для A ≤ 40 только такие точные значения */
  '4-7':37.6004,'4-10':64.9763,'5-12':79.5748,'6-11':73.4400,'7-13':94.1052,'8-15':111.9556,'9-17':128.2196,'9-18':137.3690,
  '10-21':167.4059,'10-22':177.7700,'11-22':174.1450,'12-25':205.5879,'12-26':216.6811,'13-26':211.8946,'13-28':232.6779,
  '14-29':245.0105,'14-30':255.6200};
/* справочные значения для проверок (в be() не используются, A > 40; проверить) */
const REF={'26-56':492.2581,'28-62':545.2622,'92-235':1783.871,'92-238':1801.695};
const MAXZ=118,KJ_PER_MEV_MOL=9.6485e7,COAL=29.3;/* кДж на МэВ·моль/г; МДж/кг условного топлива */

function ptable(){return VR.DATA.ptable;}
function tableA(z){const r=ptable()[z-1];return r?r[3]:0;}

function el(z){
  z=+z;if(!(z>=1&&z<=MAXZ)||z!==Math.floor(z))return null;
  const r=ptable()[z-1],c=cell(z),D=VR.DATA;
  const row=c.row;
  return{z,sym:r[0],name:r[1],mass:r[2],a:r[3],cat:r[4],rad:z===43||z===61||z>=84,
    fact:z<=20&&D.elements[z-1]?D.elements[z-1][7]:'',row:c.row,col:c.col,
    period:row<=7?row:(row===9?6:7),group:row<=7?String(c.col):(row===9?'лантаноиды':'актиноиды')};
}
function cell(z){
  if(z===1)return{row:1,col:1};
  if(z===2)return{row:1,col:18};
  if(z<=4)return{row:2,col:z-2};
  if(z<=10)return{row:2,col:z+8};
  if(z<=12)return{row:3,col:z-10};
  if(z<=18)return{row:3,col:z};
  if(z<=36)return{row:4,col:z-18};
  if(z<=54)return{row:5,col:z-36};
  if(z<=56)return{row:6,col:z-54};
  if(z<=71)return{row:9,col:z-54};
  if(z<=86)return{row:6,col:z-68};
  if(z<=88)return{row:7,col:z-86};
  if(z<=103)return{row:10,col:z-86};
  return{row:7,col:z-100};
}
function semf(z,a){
  const aV=15.75,aS=17.8,aC=.711,aA=23.7,aP=11.18,n=a-z;
  let d=0;if(z%2===0&&n%2===0)d=aP/Math.sqrt(a);else if(z%2===1&&n%2===1)d=-aP/Math.sqrt(a);
  return aV*a-aS*Math.pow(a,2/3)-aC*z*(z-1)/Math.cbrt(a)-aA*(a-2*z)*(a-2*z)/a+d;
}
/* энергия связи: {mev,exact} или null (ядро не держится) */
function be(z,a){
  const k=z+'-'+a;
  if(Object.prototype.hasOwnProperty.call(EX,k))return{mev:EX[k],exact:true};
  if(a<=40||z<1||a<z)return null;/* оценка по формуле — только для A ≥ 41 */
  const v=semf(z,a);
  return v>0?{mev:v,exact:false}:null;
}
function fuse(x,y){
  const from=[x,y],zs=x.z+y.z,as=x.a+y.a;
  if(zs>MAXZ)return{ok:false,why:'z>118',from};
  if(x.z===1&&x.a===1&&y.z===1&&y.a===1)return{ok:false,why:'pp',from};
  const bx=be(x.z,x.a),by=be(y.z,y.a),bp=be(zs,as);
  if(!bx||!by||!bp)return{ok:false,why:'unbound',from};
  return{ok:true,kind:'fusion',from,to:[{z:zs,a:as}],n:0,q:bp.mev-bx.mev-by.mev,exact:bx.exact&&by.exact&&bp.exact};
}
/* принудительное деление пополам (Б65.2.5); null — нельзя */
function fissionQ(z,a){
  const z1=Math.floor(z/2),z2=z-z1;
  if(z1<1)return null;
  let a1,a2,n=0;
  if(a<=40){a1=tableA(z1);a2=tableA(z2);n=a-a1-a2;if(n<0){a2=a-a1;n=0;}}
  else{a1=Math.round(a*z1/z);a2=a-a1;}
  if(a2<z2||a1<z1)return null;
  const b0=be(z,a),b1=be(z1,a1),b2=be(z2,a2);
  if(!b0||!b1||!b2)return null;
  return{to:[{z:z1,a:a1},{z:z2,a:a2}],n,q:b1.mev+b2.mev-b0.mev,exact:b0.exact&&b1.exact&&b2.exact};
}
/* ---- распад: ОДНА модель для кнопки «Распад», доски и дерева (Б65). decayOf(z,a) → {ok,kind,from,to,n,q,exact,lep}.
   Сохранение: Σ Z(to) + Z лептона = Z, Σ A(to) + n = A. kind: alpha | beta | fission. q === null — энергия не считается. */
/* бета-распады известных лёгких нестабильных ядер: ключ 'Z-A' → знак (−1: β−, +1: β+ / захват электрона) */
const BETA={'1-3':-1,'4-7':1,'4-10':-1,'5-12':-1,'6-11':1,'6-14':-1,'7-13':1,'8-15':1,'9-17':1,'9-18':1,'11-22':1,'13-26':1,'13-28':-1,'43-98':-1,'61-145':1};
const FISS={'92-233':[[56,141],[36,90]],'92-235':[[56,141],[36,92]],'94-239':[[56,141],[38,96]],'94-241':[[56,141],[38,98]]};
function decayOf(z,a){
  const from=[{z,a}],k=z+'-'+a;
  if(z<1||z>MAXZ||a<z)return{ok:false,why:'nodata',from};
  if(z===1&&a===1)return{ok:false,why:'h',from};
  if(k==='4-8'){const b0=be(4,8),b1=be(2,4);return{ok:true,kind:'alpha',from,to:[{z:2,a:4},{z:2,a:4}],n:0,q:2*b1.mev-b0.mev,exact:true};}
  if(Object.prototype.hasOwnProperty.call(FISS,k)){
    const to=FISS[k].map(p=>({z:p[0],a:p[1]})),n=a-to[0].a-to[1].a,b0=be(z,a),b1=be(to[0].z,to[0].a),b2=be(to[1].z,to[1].a);
    return{ok:true,kind:'fission',from,to,n,q:b1&&b2&&b0?b1.mev+b2.mev-b0.mev:null,exact:false};
  }
  if(Object.prototype.hasOwnProperty.call(BETA,k)){
    const sg=BETA[k];
    return{ok:true,kind:'beta',from,to:[{z:z-sg,a}],n:0,q:null,exact:false,lep:sg<0?'e⁻':'e⁺',lz:sg<0?-1:1};
  }
  if(z>=84){
    const b0=be(z,a),b1=be(z-2,a-4),b2=be(2,4);
    if(!b0||!b1)return{ok:false,why:'nodata',from};
    return{ok:true,kind:'alpha',from,to:[{z:z-2,a:a-4},{z:2,a:4}],n:0,q:b1.mev+b2.mev-b0.mev,exact:b0.exact&&b1.exact};
  }
  /* стабильные: самый распространённый изотоп (Z ≤ 82, кроме Tc и Pm), Bi-209, изотопы из таблицы точных энергий, не входящие в списки выше */
  if(z!==43&&z!==61&&z<=83&&a===tableA(z))return{ok:false,why:'stable',from};
  if(Object.prototype.hasOwnProperty.call(EX,k))return{ok:false,why:'stable',from};
  return{ok:false,why:'nodata',from};
}
function split(x){return decayOf(x.z,x.a);}
/* категория условная: граница спорная (Se, Po, At) или свойства только предсказаны (109–118) */
function cond(z){return z===34||z===84||z===85||z>=109;}
function perGram(q,aSum){return KJ_PER_MEV_MOL*Math.abs(q)/aSum;}
function coalT(kjg){return kjg/COAL/1e6;}
function comma(v,d){return v.toFixed(d).replace('.',',');}
function num(x){
  const u=x>=1e9?[1e9,' млрд']:x>=1e6?[1e6,' млн']:x>=1e3?[1e3,' тыс.']:[1,''];
  const v=x/u[0];
  return v<10?comma(v,v<1?2:1)+u[1]:String(Math.round(v))+u[1];
}
function fmtQ(r){
  const q=r.q,s=q<0?'−':'',m=Math.abs(q);
  if(r.exact)return s+comma(m,2)+' МэВ';
  return '≈ '+s+(m<10?comma(m,1):String(Math.round(m)))+' МэВ';
}
function note(r){
  if(!r)return '';
  if(!r.ok){
    if(r.why==='z>118')return 'Элемента №'+(r.from[0].z+r.from[1].z)+' пока не получили: известны элементы 1–118.';
    if(r.why==='pp')return 'Гелия-2 не существует: два протона вместе не держатся. В Солнце протон + протон → дейтерий + позитрон + нейтрино, выделяется около 0,42 МэВ (без аннигиляции позитрона; вместе с ней — около 1,44 МэВ).';
    if(r.why==='stable')return 'Стабильное ядро: само не распадается.';
    if(r.why==='nodata')return 'Для этого изотопа в модели нет данных о распаде.';
    if(r.why==='h')return 'У водорода один протон — делить нечего.';
    if(r.why==='tiny')return 'Ядро слишком маленькое, чтобы разделиться на два устойчивых ядра.';
    return 'Такое ядро не держится вместе или для него нет надёжных данных: реакцию не считаем.';
  }
  const t=r.to[0];
  if(r.kind==='fusion'){
    if(t.z===4&&t.a===8)return 'Бериллий-8 живёт ничтожную долю секунды (около 10 в минус 16-й степени секунды) и распадается на два ядра гелия-4. Поэтому углерод в звёздах рождается сразу из трёх гелиев.';
    if(r.q>0&&t.z<=28)return 'Слияние лёгких ядер выделяет энергию: так светят звёзды. Пока получается элемент не тяжелее железа и никеля, слияние выгодно.';
    if(r.q>0)return 'Слияние выделяет энергию, но тяжелее железа и никеля это встречается всё реже.';
    return 'Слияние ядер тяжелее железа и никеля энергию поглощает: вершина устойчивости — около железа и никеля. Тяжёлые элементы рождаются при взрывах звёзд.';
  }
  if(r.kind==='beta')return 'Бета-распад: в ядре один нейтрон превращается в протон (или наоборот), вылетает электрон или позитрон. Масса ядра та же, элемент соседний. Энергию бета-распада эта модель не считает.';
  if(r.kind==='alpha'&&r.from[0].z<10)return 'Бериллий-8 живёт ничтожную долю секунды и распадается на два ядра гелия-4.';
  if(r.kind==='alpha')return 'Альфа-распад: тяжёлое ядро выбрасывает ядро гелия-4. Так устроена радиоактивность тяжёлых элементов.';
  return 'Деление: тяжёлое ядро делится на два осколка и выбрасывает нейтроны'+(r.q>0?', выделяется много энергии — на этом работают атомные электростанции.':'.');
}
/* энергия связи на нуклон: [A, МэВ/нуклон] */
function curve(){
  const best={};
  for(const k in EX){const p=k.split('-'),a=+p[1],v=EX[k]/a;if(best[a]===undefined||v>best[a])best[a]=v;}
  const out=[];
  for(const a in best)out.push([+a,best[a]]);
  for(let a=41;a<=250;a+=3){const z=Math.round(a/(1.98+.0155*Math.pow(a,2/3)));out.push([a,semf(z,a)/a]);}
  return out.sort((u,v)=>u[0]-v[0]);
}

VR.nuc={cond,el,cell,semf,be,fuse,fissionQ,split,decayOf,perGram,coalT,num,fmtQ,note,curve,EX,REF,MAXZ};

/* ======================= Часть 2: стенд VR.chemLab (Б65.3) =======================
   Все панели стоят по осям стола (yaw 0) и не поворачиваются к игроку, доска — по оси x (yaw −π/2). */
const N=VR.nuc;
const MAXN=30;                       /* тел-элементов в комнате */
const TP=[0,1.85,-2.97],TW=3.2,TH=1.8,TRES=2048;/* таблица: центр, размеры, ширина текстуры */
const STAND={x:0,z:-2.4,hx:1.6,hz:.45,top:.85};
const FV=[-.95,-2.4],DV=[.95,-2.4],OUTF=[-1.32,-2.4],OUTD=[[1.3,-2.68],[1.3,-2.44]];
const SLOTX=[-.5,-.25,0,.25,.5],SLOTZ=[-2.7,-2.53,-2.36,-2.19],SLOTR=.065;/* сетка 5×4, шаг ≥ 2r + 0,03; между кольцами сосудов (x ±.65) и табличками (z −2,05) */
const BOARD={pos:[2.6,1.65,-1.7],yaw:-Math.PI/2,w:1.8,h:1.3,res:1280};
const TABS=[{x:-.95,w:.42,t:'Слияние'},{x:0,w:.5,t:'Склад'},{x:.95,w:.42,t:'Распад'}];
const TAB={h:.14,tilt:Math.PI/4,y:.91,z:-2};/* пюпитр: нижний край у края стола (z −1,95, y .86), верх отклонён назад */
const TREE={pos:[-2.6,1.65,-1.7],yaw:Math.PI/2,w:1.8,h:1.3,res:1280};/* слева от стола, лицом к центру */
const TIP={pos:[-2.55,1.65,-.51],yaw:Math.PI/2,w:.48,h:.36,res:768};
const CAP={fus:6,dec:1},RING=.095,RORD=[0,3,1,4,2,5];
const CARD={w:.36,h:.27,res:768};
const SHAPE={alk:'cube',ear:'cube',tm:'cube',pmt:'cube',lan:'cube',act:'cube',met:'octa',non:'ball',hal:'ball',nob:'cyl',unk:'dodeca'};
const D=()=>VR.DATA;
function catCol(cat){return VR.hex(D().elCats[cat][1]);}
function pxToWorld(px,py){return[TP[0]+(px/TRES-.5)*TW,TP[1]+(.5-py/(TRES*TH/TW))*TH];}
/* прямоугольник ячейки в пикселях текстуры таблицы */
function cellPx(z){
  const c=N.cell(z);
  return{x:24+(c.col-1)*111,y:c.row<=7?70+(c.row-1)*111:70+7*111+56+(c.row-9)*111,w:108,h:108};
}
function glyph(c,kind,cx,cy,r,col){
  c.fillStyle=col;c.beginPath();
  if(kind==='cube')c.rect(cx-r*.85,cy-r*.85,r*1.7,r*1.7);
  else if(kind==='octa'){c.moveTo(cx,cy-r);c.lineTo(cx+r,cy);c.lineTo(cx,cy+r);c.lineTo(cx-r,cy);c.closePath();}
  else if(kind==='ball')c.arc(cx,cy,r,0,6.283);
  else if(kind==='cyl')c.rect(cx-r*.55,cy-r,r*1.1,r*2);
  else{for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,k=i%2?r*.45:r*1.05;c.lineTo(cx+Math.cos(a)*k,cy+Math.sin(a)*k);}c.closePath();}
  c.fill();
}
function isoName(z,a){const e=N.el(z);return(e?e.name:'?')+'-'+a;}
function isoSym(z,a){const e=N.el(z);return(e?e.sym:'?')+'-'+a;}
function eqText(r){
  if(r.kind==='molecule')return r.from.map(x=>N.el(x.z).sym).join(' + ')+' → '+r.mol.formula;
  const l=r.from.map(x=>isoSym(x.z,x.a)).join(' + ');
  if(!r.ok)return l;
  return l+' → '+r.to.map(x=>isoSym(x.z,x.a)).join(' + ')+(r.lep?' + '+r.lep:'')+(r.n?' + '+(r.n>1?r.n+' ':'')+'n':'');
}
function nameText(r){
  if(r.kind==='molecule')return r.from.map(x=>N.el(x.z).name.toLowerCase()).join(' + ')+' → '+r.mol.name.toLowerCase();
  const l=r.from.map(x=>isoName(x.z,x.a)).join(' + ');
  if(!r.ok)return l;
  return l+' → '+r.to.map(x=>isoName(x.z,x.a)).join(' + ')+(r.lep?' + '+(r.lz<0?'электрон':'позитрон'):'')+(r.n?' + '+(r.n>1?r.n+' ':'')+(r.n>1?'нейтрона':'нейтрон'):'');
}
function elBodies(E){return E.bodies.filter(b=>b.data&&b.data.zn);}
function yawTo(px,pz,hx,hz){return Math.atan2(hx-px,hz-pz);}

function makeBody(E,z,a,p){
  const e=N.el(z),sh=SHAPE[e.cat];
  const o={shape:sh==='cube'?'cube':'ball',p:p.slice(),s:.075,col:catCol(e.cat),em:.25,data:{zn:z,a}};
  if(sh==='octa')o.mesh=E.mesh.octa;else if(sh==='cyl')o.mesh=E.mesh.cyl;else if(sh==='dodeca')o.mesh=E.mesh.dodeca;
  return E.addBody(o);
}
function heldEl(E){for(const h of E.H){const b=h.held;if(b&&b.data&&b.data.zn)return b;}return null;}
function toast(E,S,msg){if(!S.toastT||E.t-S.toastT>1.5){S.toastT=E.t;E.toast(msg,'#fde68a');}}
function slotPos(S,i){return[SLOTX[i%5],SLOTZ[(i/5)|0]];}

function setCur(S,z,a){if(!S.cur||S.cur.z!==z||S.cur.a!==a){S.cur={z,a};if(S.tree)S.tree.dirty=true;}}
function toggleMode(E,S){
  S.nuclear=!S.nuclear;S.modeTab.dirty=true;S.tree.dirty=true;S.board.dirty=true;
  for(const v of S.vs)v.key=null;
  E.toast(S.nuclear?'Режим «Ядра»: ядерные реакции, не химия':'Режим «Химия»: только известные вещества','#fde68a');
}
function toggleCard(E,S){
  S.cardOff=!S.cardOff;
  if(!S.cardOff&&!S.cardZ&&S.cur){S.cardZ=S.cur.z;S.cardA=S.cur.a;S.cardHide=false;}
  S.card.dirty=true;E.toast('Карточка элемента: '+(S.cardOff?'выключена':'включена'),'#fde68a');
}
/* ---- реакции: что получится из содержимого сосуда ---- */
function nuclearFuse(xs){
  if(xs.length===2)return N.fuse(xs[0],xs[1]);
  const zs=xs.reduce((u,x)=>u+x.z,0),as=xs.reduce((u,x)=>u+x.a,0),bp=zs<=N.MAXZ?N.be(zs,as):null,bs=xs.map(x=>N.be(x.z,x.a));
  if(!bp||bs.some(b=>!b))return{ok:false,why:'unbound',from:xs};
  return{ok:true,kind:'fusion',from:xs,to:[{z:zs,a:as}],n:0,q:bp.mev-bs.reduce((u,b)=>u+b.mev,0),exact:bp.exact&&bs.every(b=>b.exact)};
}
function molOf(xs){
  const comp={};for(const x of xs){const sy=N.el(x.z).sym;comp[sy]=(comp[sy]||0)+1;}
  const ks=Object.keys(comp);
  return D().molecules.find(m=>{const mk=Object.keys(m.f);return mk.length===ks.length&&mk.every(k=>comp[k]===m.f[k]);})||null;
}
/* null — реакция невозможна; иначе результат (химическое соединение или ядерная реакция) */
function planOf(kind,xs,nuc){
  if(kind==='fus'){
    if(xs.length<2)return null;
    if(!nuc){const m=molOf(xs);return m?{ok:true,kind:'molecule',from:xs,to:[],mol:m,n:0,q:0}:null;}/* «Химия»: только известные молекулы */
    const r=nuclearFuse(xs);return r.ok?r:null;
  }
  if(xs.length!==1)return null;
  const r=N.decayOf(xs[0].z,xs[0].a);return r.ok?r:null;
}
function liveText(v,nuc){
  const xs=v.items.map(b=>({z:b.data.zn,a:b.data.a}));
  if(!xs.length)return '';
  const l=(v.kind==='fus'?'В сосуде слияния: ':'В сосуде распада: ')+xs.map(x=>isoSym(x.z,x.a)).join(', ')+'. ';
  if(v.plan){
    if(v.plan.kind==='molecule')return l+'Нажми «Слияние»: получится '+v.plan.mol.name.toLowerCase()+' '+v.plan.mol.formula+' (химическая реакция).';
    return l+(v.kind==='fus'?'Нажми «Слияние»: ядра сольются (ядерная реакция).':'Нажми «Распад».');
  }
  if(v.kind==='dec'){
    if(xs.length>1)return l+'Для распада нужен один элемент.';
    const w=N.decayOf(xs[0].z,xs[0].a).why;
    return l+(w==='nodata'?'Для этого изотопа нет данных о распаде.':'Стабильный элемент: не распадается.');
  }
  if(!nuc)return l+'Нет такого вещества — добавь атомы (или включи режим «Ядра»).';
  return l+(xs.length<2?'Добавь ещё атом: для слияния нужно минимум два.':'Эти ядра не сливаются.');
}

function build(E,S){
  const mesh=E.mesh;
  E.addTable(STAND.x,STAND.z,STAND.hx,STAND.hz,STAND.top,[.28,.3,.34]);
  S.el=-1;S.cardZ=0;S.cardA=0;S.cardHide=false;S.cardShown=-1;S.last=null;S.hist=[];S.toastT=0;
  S.vs=[{kind:'fus',c:FV,items:[],t:0},{kind:'dec',c:DV,items:[],t:0}];
  S.slots=Array(20).fill(null);S.stockN=-1;
  /* таблица: одна текстура, ячейки — области, подсветка — геометрией в draw */
  S.pt=E.addPanel({w:TW,h:TH,res:TRES,pos:TP,yaw:0,accent:'#4ade80',keepTex:true,draw:(c,p)=>tableDraw(E,S,c,p)});
  /* сосуды и гнёзда склада */
  for(const v of S.vs){
    const col=v.kind==='fus'?[1,.6,.2]:[.4,.7,1];
    E.addStatic(mesh.cyl,VR.TRS(v.c[0],STAND.top+.02,v.c[1],.28,.04,.28),[.2,.22,.26]);
    E.addStatic(mesh.circle,VR.TRS(v.c[0],.9,v.c[1],.3,1,.3),col,1,3);
    E.addStatic(mesh.circle,VR.TRS(v.c[0],.99,v.c[1],.3,1,.3),col,1,3);
  }
  for(let i=0;i<20;i++){const q=slotPos(S,i);E.addStatic(mesh.circle,VR.TRS(q[0],STAND.top+.006,q[1],SLOTR,1,SLOTR),[.6,.8,.7],1,3);}
  /* таблички на передней кромке стола: наклон 45° к игроку (пюпитр); «Слияние» и «Распад» — кнопки реакции */
  S.tabs=TABS.map((t,i)=>E.addPanel({w:t.w,h:TAB.h,res:512,pos:[t.x,TAB.y,TAB.z],yaw:0,tilt:TAB.tilt,accent:'#64748b',noHit:i===1,keepTex:true,draw:(c,p)=>{
    if(i===1){p.text('Склад '+S.slots.filter(Boolean).length+'/20',p.W/2,p.H/2-24,{size:48,bold:true,align:'center',maxW:p.W-30});return;}
    const v=S.vs[i===0?0:1],ready=!!v.ready,k=.5+.5*Math.sin(E.t*6);
    p.button(8,8,p.W-16,p.H-16,t.t,()=>react(E,S,v),{size:60,disabled:!ready,
      bg:ready?'rgb('+Math.round(245+10*k)+','+Math.round(158+66*k)+','+Math.round(11+60*k)+')':undefined,fg:ready?'#1f1300':undefined});
  }}));
  S.nuclear=false;
  S.modeTab=E.addPanel({w:.4,h:TAB.h,res:512,pos:[-.49,TAB.y,TAB.z],yaw:0,tilt:TAB.tilt,accent:'#64748b',keepTex:true,draw:(c,p)=>{
    p.button(8,8,p.W-16,p.H-16,'Режим: '+(S.nuclear?'Ядра':'Химия'),()=>toggleMode(E,S),{size:46,bg:S.nuclear?'#b45309':'#0f766e'});}});
  S.cur=null;S.cardOff=false;S.mol=null;S.tipKey='';S.live='';
  S.tree=E.addPanel({w:TREE.w,h:TREE.h,res:TREE.res,pos:TREE.pos,yaw:TREE.yaw,accent:'#60a5fa',bg:'#0f2438',keepTex:true,draw:(c,p)=>treeDraw(E,S,c,p)});
  S.tip=E.addPanel({w:TIP.w,h:TIP.h,res:TIP.res,pos:TIP.pos,yaw:TIP.yaw,accent:'#38bdf8',show:false,noHit:true,draw:(c,p)=>cardDrawZ(c,p,p.data.z,p.data.a)});
  S.board=E.addPanel({w:BOARD.w,h:BOARD.h,res:BOARD.res,pos:BOARD.pos,yaw:BOARD.yaw,accent:'#e2e8f0',bg:'#14301f',draw:(c,p)=>boardDraw(E,S,c,p)});
  S.card=E.addPanel({w:CARD.w,h:CARD.h,res:CARD.res,pos:[0,1.5,-1],yaw:0,accent:'#facc15',show:false,noHit:true,draw:(c,p)=>cardDraw(E,S,c,p)});
}

function tableDraw(E,S,c,p){
  const R=VR.ui.rrect,cats=D().elCats;
  p.text('Таблица Менделеева — 118 элементов',24,12,{size:44,bold:true,maxW:1500});
  for(let z=1;z<=118;z++){
    const e=N.el(z),q=cellPx(z),col=cats[e.cat][1];
    p.area(q.x,q.y,q.w,q.h,()=>cellClick(E,S,z));
    p.btns[p.btns.length-1].z=z;
    c.fillStyle='#1b2540';R(c,q.x,q.y,q.w,q.h,12);c.fill();
    c.lineWidth=4;c.strokeStyle=col;R(c,q.x+2,q.y+2,q.w-4,q.h-4,10);c.stroke();
    c.textBaseline='top';c.fillStyle='#b8c7ea';c.font='22px sans-serif';c.textAlign='left';c.fillText(String(z),q.x+8,q.y+6);
    glyph(c,SHAPE[e.cat],q.x+q.w-18,q.y+18,9,col);
    c.fillStyle='#fff';c.font='bold 46px sans-serif';c.textAlign='center';c.fillText(e.sym,q.x+q.w/2,q.y+30);
    let fs=16;for(;fs>11;fs--){c.font=fs+'px sans-serif';if(c.measureText(e.name).width<=100)break;}
    c.fillStyle='#cbd5e1';c.font=fs+'px sans-serif';c.fillText(e.name,q.x+q.w/2,q.y+84);
    c.textAlign='left';
  }
  /* заглушки f-рядов */
  for(const [row,label] of[[6,'57–71'],[7,'89–103']]){
    const x=24+2*111,y=70+(row-1)*111;
    c.setLineDash([6,5]);c.lineWidth=2;c.strokeStyle='#64748b';R(c,x+2,y+2,104,104,10);c.stroke();c.setLineDash([]);
    c.fillStyle='#94a3b8';c.font='bold 26px sans-serif';c.textAlign='center';c.fillText(label,x+54,y+40);c.textAlign='left';
  }
  /* легенда: 11 категорий в 2 колонки */
  let i=0;
  for(const k in cats){
    const col=i<6?0:1,r=i<6?i:i-6,x=270+col*520,y=100+r*36;
    glyph(c,SHAPE[k],x+12,y+14,11,cats[k][1]);
    c.fillStyle='#e8efff';c.font='24px sans-serif';c.textAlign='left';c.textBaseline='top';c.fillText(cats[k][0]+(k==='unk'?' (условно)':''),x+36,y);i++;
  }
  p.text('«Условно»: Se, Po, At (граница спорная); 109–118 (свойства предсказаны)',270,368,{size:24,color:'#94a3b8',maxW:1050});
  p.text('Курок / ЛКМ — карточка элемента; хват / ПКМ / E — элемент в руку',270,330,{size:26,color:'#94a3b8',maxW:1050});
}
function cellClick(E,S,z){
  if(S.el===z-1&&S.card.show){S.cardHide=true;S.el=-1;S.cardZ=0;S.card.show=false;return;}
  const e=N.el(z);
  S.el=z-1;S.cardZ=z;S.cardA=e.a;S.cardHide=false;S.cardOff=false;S.card.dirty=true;setCur(S,z,e.a);
  E.discover('chem','el_'+e.sym,e.name+' '+e.sym);E.beep(700,.06);
}

function cardDraw(E,S,c,p){cardDrawZ(c,p,S.cardShown,S.cardA);}
function cardDrawZ(c,p,z,a0){
  const e=N.el(z);if(!e)return;
  const a=a0||e.a,col=D().elCats[e.cat][1];
  p.text(e.sym,30,20,{size:150,bold:true,color:col,maxW:190});
  p.text(e.name,230,34,{size:52,bold:true,maxW:p.W-260});
  p.text('№ '+z+' · масса '+e.mass,230,104,{size:32,color:'#b8c7ea',maxW:p.W-260});
  p.text('Изотоп: '+e.name.toLowerCase()+'-'+a+' ('+z+' p, '+(a-z)+' n)',30,190,{size:30,maxW:p.W-60});
  glyph(c,SHAPE[e.cat],44,252,14,col);
  p.text(D().elCats[e.cat][0]+(N.cond(z)?' (условно)':''),72,236,{size:30,bold:true,color:col,maxW:p.W-100});
  p.text('Период '+e.period+', '+(/^\d/.test(e.group)?'группа '+e.group:e.group),30,280,{size:30,color:'#cbd5e1',maxW:p.W-60});
  const b=N.be(z,a);
  p.text(b?'Энергия связи '+(b.exact?'':'≈ ')+(b.mev/a).toFixed(1).replace('.',',')+' МэВ на нуклон':'Такое ядро не держится',30,324,{size:30,color:'#cbd5e1',maxW:p.W-60});
  let y=368;
  if(e.rad){p.text('Радиоактивен',30,y,{size:30,bold:true,color:'#f87171'});y+=44;}
  if(e.fact)p.text(e.fact,30,y+6,{size:28,color:'#e8efff',maxW:p.W-60,maxY:p.H-20});
}

function boardDraw(E,S,c,p){
  const r=S.last;
  p.text('Доска реакций',40,30,{size:52,bold:true,maxW:700});
  if(!r){
    let y=130;
    y=p.text('Клади атомы в левый сосуд (до 6) и нажми табличку «Слияние»: в режиме «Химия» получится молекула (например, вода), в режиме «Ядра» — новое ядро.',40,y,{size:34,maxW:700})+14;
    y=p.text('Один элемент в правом сосуде и табличка «Распад» — он распадётся. Табличка светится, когда реакция возможна.',40,y,{size:34,maxW:700})+14;
    p.text('Здесь появится уравнение, выделенная энергия и пояснение.',40,y,{size:32,color:'#94a3b8',maxW:700});
  }else{
    let y=110;
    y=p.text(r.ok?eqText(r):'Не получилось: '+eqText(r),40,y,{size:r.ok?48:42,bold:true,maxW:700,color:r.ok?'#e2e8f0':'#fca5a5'})+4;
    if(r.kind==='molecule'){y=p.text(nameText(r),40,y,{size:30,color:'#94a3b8',maxW:700})+12;y=p.text('Это химическая реакция: атомы соединились в молекулу «'+r.mol.name+'». Ядра не менялись — все элементы остались прежними, энергия ядер не выделялась.',40,y,{size:34,bold:true,color:'#86efac',maxW:700})+12;p.text(r.mol.text,40,y,{size:32,color:'#bbf7d0',maxW:700,maxY:p.H-190});}else{
    y=p.text(nameText(r),40,y,{size:30,color:'#94a3b8',maxW:700})+12;
    if(r.ok)y=p.text(r.kind==='fusion'?'Ядерная реакция (так светят звёзды), не химия.':'Ядерная реакция, не химия.',40,y,{size:32,bold:true,color:'#fca5a5',maxW:700})+10;
    if(r.ok&&r.q===null)y=p.text('Энергия бета-распада в этой модели не считается.',40,y,{size:32,color:'#93c5fd',maxW:700})+10;
    else if(r.ok){
      const gain=r.q>0;
      y=p.text(N.fmtQ(r)+(gain?' — выделилось':' — поглотилось: энергию нужно затратить'),40,y,{size:40,bold:true,color:gain?'#fde68a':'#93c5fd',maxW:700})+12;
      const aSum=r.from.reduce((u,x)=>u+x.a,0),kj=N.perGram(r.q,aSum);
      y=p.text(gain?'На 1 г: '+N.num(kj)+' кДж — как сжечь '+N.num(N.coalT(kj))+' т угля':'На 1 г нужно затратить '+N.num(kj)+' кДж',40,y,{size:34,maxW:700})+12;
    }
    p.text(N.note(r),40,y,{size:34,color:'#bbf7d0',maxW:700,maxY:p.H-190});
    graphDraw(c,p,r);}
  }
  if(S.live)p.text(S.live,40,p.H-185,{size:28,color:'#fde68a',maxW:700,maxY:p.H-112});
  const hy=r?620:120;
  if(S.hist.length>1){
    p.text('Раньше:',770,hy,{size:28,bold:true,color:'#cbd5e1'});
    let y=hy+34;for(const h of S.hist.slice(1)){y=p.text(eqText(h)+(h.ok&&h.kind!=='molecule'&&h.q!==null?'  '+N.fmtQ(h):''),770,y,{size:28,color:'#cbd5e1',maxW:470,maxY:p.H-120})+4;}
  }
  p.text('Модель: энергия — разность энергий связи ядер; ≈ — оценка по формуле Вайцзеккера; энергия бета-распада и барьер не считаются',40,p.H-110,{size:26,color:'#94a3b8',maxW:p.W-80});
}
function graphDraw(c,p,r){
  const x0=800,x1=1230,y0=150,y1=530,AX=250,YM=9;
  const px=a=>x0+(a/AX)*(x1-x0),py=v=>y1-(v/YM)*(y1-y0);
  c.strokeStyle='#64748b';c.lineWidth=2;c.beginPath();c.moveTo(x0,y0);c.lineTo(x0,y1);c.lineTo(x1,y1);c.stroke();
  c.fillStyle='#64748b';c.font='20px sans-serif';c.textAlign='right';c.textBaseline='middle';
  for(const v of[0,4,8]){c.fillText(String(v),x0-8,py(v));c.strokeStyle='#33415588';c.beginPath();c.moveTo(x0,py(v));c.lineTo(x1,py(v));c.stroke();}
  c.textAlign='center';c.textBaseline='top';for(const a of[0,50,100,150,200,250])c.fillText(String(a),px(a),y1+6);
  c.strokeStyle='#86efac';c.lineWidth=3;c.beginPath();
  N.curve().forEach((q,i)=>{if(i)c.lineTo(px(q[0]),py(q[1]));else c.moveTo(px(q[0]),py(q[1]));});c.stroke();
  const dot=(x,col)=>{const b=N.be(x.z,x.a);const v=b?b.mev/x.a:0;c.fillStyle=col;c.beginPath();c.arc(px(x.a),py(v),9,0,6.283);c.fill();};
  for(const x of r.from)dot(x,'#fb923c');
  if(r.ok)for(const x of r.to)dot(x,'#60a5fa');
  p.text('энергия связи на нуклон, МэВ',x0,y0-40,{size:24,color:'#cbd5e1',maxW:440});
  p.text('железо и никель — вершина',px(40),py(6.6),{size:22,color:'#fde68a',maxW:300});
  p.text('число нуклонов A',x0+60,y1+36,{size:22,color:'#94a3b8',maxW:300});
  c.textAlign='left';
}

/* ---------- дерево элемента (левая доска) ---------- */
const PARTN=[[1,1],[2,4],[6,12]];
function treeOf(z,a,nuc){
  const x={z,a},up=[],mols=[];
  if(nuc)for(const q of PARTN){const r=N.fuse(x,{z:q[0],a:q[1]});if(r.ok)up.push({p:{z:q[0],a:q[1]},to:r.to[0],q:r.q,r});}
  else{const sy=N.el(z).sym;for(const m of D().molecules)if(m.f[sy])mols.push(m);}
  const sp=N.decayOf(z,a);
  return{x,up,mols,nuc:!!nuc,down:sp.ok?sp:null,why:sp.ok?'':sp.why};
}
function treeDraw(E,S,c,p){
  const R=VR.ui.rrect,cats=D().elCats;
  p.text('Дерево элемента',40,24,{size:46,bold:true,maxW:600});
  if(!S.cur){p.text('Возьми элемент в руку или положи в сосуд — здесь появятся пути: с чем он сливается и на что распадается.',40,130,{size:40,maxW:p.W-120});return;}
  const t=treeOf(S.cur.z,S.cur.a,S.nuclear);
  const node=(cx,cy,w,h,z,a,head,sub,col,big)=>{
    const e=N.el(z),cc=cats[e.cat][1],hov=p.area(cx-w/2,cy-h/2,w,h,()=>{setCur(S,z,a);S.tree.dirty=true;});
    p.btns[p.btns.length-1].z=z;p.btns[p.btns.length-1].a=a;
    c.fillStyle=hov?'#25456b':'#16314d';R(c,cx-w/2,cy-h/2,w,h,18);c.fill();
    c.lineWidth=hov?7:4;c.strokeStyle=hov?'#fff':cc;R(c,cx-w/2+2,cy-h/2+2,w-4,h-4,16);c.stroke();
    glyph(c,SHAPE[e.cat],cx-w/2+30,cy-h/2+30,11,cc);
    if(head)p.text(head,cx-w/2+54,cy-h/2+10,{size:26,color:'#93c5fd',maxW:w-70});
    p.text(isoSym(z,a),cx,cy-h/2+(head?38:16),{size:big?84:50,bold:true,align:'center',maxW:w-20});
    p.text(e.name+' · № '+z,cx,cy+(big?20:10),{size:big?30:26,color:'#cbd5e1',align:'center',maxW:w-20});
    if(sub)p.text(sub,cx,cy+(big?58:42),{size:26,bold:true,align:'center',color:col||'#fde68a',maxW:w-20});
  };
  const cx=640,cy=455,line=(x1,y1,x2,y2,col)=>{c.strokeStyle=col;c.lineWidth=4;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
  p.text(t.nuc?'Режим «Ядра» — слияние: с чем соединить, чтобы получить следующий элемент':'Режим «Химия» — какие вещества можно собрать с этим атомом',40,92,{size:28,color:'#93c5fd',maxW:p.W-80});
  const nUp=t.nuc?t.up.length:Math.min(4,t.mols.length),uxs=[];
  for(let i=0;i<nUp;i++)uxs.push((i+.5)*p.W/nUp);
  const uw=nUp>=4?290:380;
  for(let i=0;i<nUp;i++)line(cx,cy-80,uxs[i],290,t.nuc?'#fb923c':'#4ade80');
  if(t.down){const dx=t.down.to.length>1?[340,940]:[640];t.down.to.forEach((x,i)=>line(cx,cy+80,dx[i],640,'#60a5fa'));}
  if(t.nuc)t.up.forEach((u,i)=>node(uxs[i],210,uw,160,u.to.z,u.to.a,'+ '+isoSym(u.p.z,u.p.a),N.fmtQ(u.r)+(u.r.q>0?' выделится':' нужно'),u.r.q>0?'#fde68a':'#93c5fd'));
  else t.mols.slice(0,4).forEach((m,i)=>{
    const x=uxs[i],y=210;c.fillStyle='#16314d';R(c,x-uw/2,y-80,uw,160,18);c.fill();c.lineWidth=4;c.strokeStyle='#4ade80';R(c,x-uw/2+2,y-78,uw-4,156,16);c.stroke();
    p.text(m.formula,x,y-68,{size:56,bold:true,align:'center',maxW:uw-20});
    p.text(m.name,x,y+4,{size:28,color:'#cbd5e1',align:'center',maxW:uw-20});
    p.text('нужно: '+Object.keys(m.f).map(k=>k+(m.f[k]>1?'×'+m.f[k]:'')).join(' + '),x,y+40,{size:26,bold:true,color:'#86efac',align:'center',maxW:uw-20});
  });
  if(t.nuc&&!t.up.length)p.text('С водородом, гелием и углеродом это ядро не соединяется (или нет точных данных).',40,200,{size:34,color:'#fca5a5',maxW:p.W-120});
  if(!t.nuc&&!t.mols.length)p.text('С этим атомом в таблице веществ нет молекул. Режим «Ядра» покажет ядерные слияния.',40,200,{size:34,color:'#fca5a5',maxW:p.W-120});
  /* центр: сужение дерева */
  node(cx,cy,420,150,t.x.z,t.x.a,'',N.cond(t.x.z)?'категория условная':'',null,true);
  if(t.down){
    const d=t.down,dx=d.to.length>1?[340,940]:[640];
    const kind=d.kind==='alpha'?'альфа-распад':d.kind==='beta'?'бета-распад ('+d.lep+' улетает)':'деление (после захвата нейтрона)';
    c.fillStyle='#0f2438';c.fillRect(30,548,p.W-60,48);
    p.text('Распад: '+kind+(d.q===null?'':', '+N.fmtQ(d)+(d.q>0?' выделится':' нужно затратить'))+(d.n?' (+ '+d.n+' н)':''),40,556,{size:30,bold:true,color:'#fde68a',maxW:p.W-80});
    d.to.forEach((x,i)=>node(dx[i],725,420,160,x.z,x.a,'',''));
  }else{
    p.text(t.why==='nodata'?'Для этого изотопа нет данных о распаде.':'Стабилен: само не распадается.',40,590,{size:34,color:'#fca5a5',maxW:p.W-120});
  }
  p.text('Наведи луч — справка об элементе. Курок — сделать его центром дерева. Энергия — разность энергий связи (≈ — оценка).',40,p.H-86,{size:24,color:'#94a3b8',maxW:p.W-80});
}

/* ---------- ввод ---------- */
function pick(E,S,h,hit){
  if(!hit||hit.p!==S.pt)return null;
  const btn=hit.p.btns[hit.bi];if(!btn||!btn.z)return null;
  if(elBodies(E).length>=MAXN){E.toast('Слишком много элементов: отпусти лишние на пол','#fde68a');return null;}
  const e=N.el(btn.z);if(!e)return null;
  let ro=h&&h.ro,rd=h&&h.rd;
  if(!ro||!rd){const hp=E.headPose();ro=hp.pos;rd=[0,0,-1];}
  const t=Math.max(.1,hit.t-.05);
  const b=makeBody(E,btn.z,e.a,[ro[0]+rd[0]*t,ro[1]+rd[1]*t,ro[2]+rd[2]*t]);
  S.cardZ=btn.z;S.cardA=e.a;S.cardHide=false;
  return b;
}
function onGrab(E,S,b){
  const d=b.data;if(!d||!d.zn)return;
  delete d.fresh;delete d.sp;setCur(S,d.zn,d.a);
  if(d.die!==undefined){delete d.die;if(d.s0)b.s=d.s0;}
  S.cardHide=false;
}

/* ---------- кадр ---------- */
function update(E,S,dt){
  const bodies=elBodies(E);
  /* 1. пол растворяет */
  for(const b of bodies){
    const d=b.data;
    if(b.held!==null){if(d.die!==undefined){delete d.die;if(d.s0)b.s=d.s0;}continue;}
    if(d.die===undefined&&b.p[1]<b.s/2+.02){d.die=E.t;d.s0=b.s;}
    if(d.die!==undefined){
      const k=(E.t-d.die)/.5;
      if(k>=1){E.burst(b.p.slice(),4,null,.4);E.beep(220,.08,'sine',.03);E.removeBody(b);}
      else b.s=Math.max(.001,d.s0*(1-k));
    }
  }
  /* 2. освободить гнёзда */
  const alive=b=>b.data&&b.data.sp&&E.bodies.includes(b)&&b.held===null&&b.data.die===undefined&&Math.hypot(b.p[0]-b.data.sp[0],b.p[2]-b.data.sp[1])<.25;
  for(const b of bodies)if(b.data.sp&&!alive(b))delete b.data.sp;
  for(const v of S.vs)v.items=v.items.filter(b=>b.data.sp&&E.bodies.includes(b));
  for(let i=0;i<20;i++)if(S.slots[i]&&!(S.slots[i].data.sp&&E.bodies.includes(S.slots[i])))S.slots[i]=null;
  /* 3. и 4. захват телами сосудов и склада */
  for(const b of elBodies(E)){
    const d=b.data;
    if(b.held!==null||d.fresh||d.die!==undefined||d.sp)continue;
    if(Math.hypot(b.v[0],b.v[1],b.v[2])>=.6||b.p[1]<STAND.top||b.p[1]>1.3)continue;
    let done=false;
    for(const v of S.vs){
      if(Math.hypot(b.p[0]-v.c[0],b.p[2]-v.c[1])>=.2)continue;
      if(v.items.length>=CAP[v.kind]){
        b.v=[0,1.2,1.4];d.fresh=true;
        toast(E,S,v.kind==='fus'?'В сосуд слияния — до '+CAP.fus+' атомов':'В сосуд распада — один элемент');
      }else{
        let vi=0;if(v.kind==='fus'){const used=v.items.map(x=>x.data.vi);vi=RORD.find(i=>!used.includes(i));}
        const sp=v.kind==='fus'?[v.c[0]+Math.cos(vi*Math.PI/3)*RING,v.c[1]+Math.sin(vi*Math.PI/3)*RING]:v.c.slice();
        d.sp=sp;d.vi=vi;v.items.push(b);b.p=[sp[0],STAND.top+b.s/2+.005,sp[1]];b.v=[0,0,0];setCur(S,d.zn,d.a);
      }
      done=true;break;
    }
    if(done)continue;
    if(b.p[0]>-.62&&b.p[0]<.62&&b.p[2]>-2.79&&b.p[2]<-2.08){
      let best=-1,bd=1e9;
      for(let i=0;i<20;i++)if(!S.slots[i]){const q=slotPos(S,i),dd=Math.hypot(b.p[0]-q[0],b.p[2]-q[1]);if(dd<bd){bd=dd;best=i;}}
      if(best<0){b.v=[0,1.6,2.8];d.fresh=true;toast(E,S,'Склад полон: 20 элементов');}
      else{const q=slotPos(S,best);d.sp=q;S.slots[best]=b;b.p=[q[0],STAND.top+b.s/2+.005,q[1]];b.v=[0,0,0];}
    }
  }
  const n=S.slots.filter(Boolean).length;
  if(n!==S.stockN){S.stockN=n;S.tabs[1].dirty=true;}
  /* 5. реакция — только по кнопке; здесь считаем, возможна ли она, и подсвечиваем табличку */
  let liveChanged=false;
  for(const v of S.vs){
    const key=(S.nuclear?'N':'C')+v.items.map(b=>b.data.zn+'-'+b.data.a).join(',');
    if(key!==v.key){v.key=key;v.plan=planOf(v.kind,v.items.map(b=>({z:b.data.zn,a:b.data.a})),S.nuclear);const lt=liveText(v,S.nuclear);v.live=lt;liveChanged=true;}
    const rd=!!v.plan,tab=S.tabs[v.kind==='fus'?0:2];
    if(rd!==!!v.ready){v.ready=rd;tab.dirty=true;}
    else if(rd&&(!v.pt||E.t-v.pt>.09)){v.pt=E.t;tab.dirty=true;}/* пульсация */
  }
  if(liveChanged){S.live=S.vs.map(v=>v.live).filter(Boolean).join(' ');S.board.dirty=true;}
  /* дерево: справка при наведении */
  const hv=S.tree.hover,hb2=hv>=0?S.tree.btns[hv]:null,tk=hb2&&hb2.z?hb2.z+'-'+hb2.a:'';
  if(tk!==S.tipKey){
    S.tipKey=tk;S.tree.dirty=true;
    if(tk){S.tip.data.z=hb2.z;S.tip.data.a=hb2.a;S.tip.show=true;S.tip.dirty=true;}else S.tip.show=false;
  }
  /* 6. карточка */
  const hb=heldEl(E),z=hb?hb.data.zn:(S.cardHide?0:S.cardZ),a=hb?hb.data.a:S.cardA;
  if(z!==S.cardShown||a!==S.cardA2){S.cardShown=z;S.cardA2=a;S.card.dirty=true;}
  if(hb)S.cardA=a;
  S.card.show=!!z&&!S.cardOff;
  const hp=E.headPose(),L=E.H[0];let q;
  if(E.session&&L&&L.has)q=[L.g[12],L.g[13]+.22,L.g[14]];
  else{const rr=[-hp.f[1],hp.f[0]];q=[hp.pos[0]+hp.f[0]*.9-rr[0]*.42,hp.pos[1]+.2,hp.pos[2]+hp.f[1]*.9-rr[1]*.42];}
  S.card.setPose(q,yawTo(q[0],q[2],hp.pos[0],hp.pos[2]));
}
function react(E,S,v){
  const r=v.plan;
  if(!r||!v.items.length)return;
  const items=v.items.slice();v.items=[];v.key=null;v.plan=null;
  const put=(x,pos)=>{const b=makeBody(E,x.z,x.a,[pos[0],.97,pos[1]]);b.data.fresh=true;return b;};
  for(const b of items)E.removeBody(b);
  const cx=v.c[0],cz=v.c[1];
  S.mol=null;
  if(r.kind==='molecule'){
    S.mol={m:r.mol,t:E.t};
    E.burst([cx,1.05,cz],30,[[.4,.8,1],[.5,1,.7]],.9);E.fanfare();
    E.discover('chem','mol_'+r.mol.key,r.mol.name+' '+r.mol.formula);
    if(S.found)S.found.add(r.mol.key);
  }else{
    if(v.kind==='fus')put(r.to[0],OUTF);else r.to.forEach((x,i)=>put(x,OUTD[i]));
    setCur(S,r.to[0].z,r.to[0].a);
    const gain=r.q>0;
    E.burst([cx,1.05,cz],gain?Math.min(60,10+Math.round(Math.abs(r.q)/3)):12,gain?[[1,.8,.2],[1,.5,.2],[1,.3,.2]]:[[.4,.7,1],[.6,.85,1]],gain?1.3:.7);
    if(gain)E.fanfare();else E.beep(300,.15);
    E.discover('chem',r.kind==='fusion'?'fusion':r.kind==='alpha'?'alpha':r.kind==='beta'?'beta':'fission',r.kind==='fusion'?'Слияние ядер':r.kind==='alpha'?'Альфа-распад':r.kind==='beta'?'Бета-распад':'Деление ядра');
  }
  S.last=r;S.hist.unshift(r);if(S.hist.length>3)S.hist.length=3;S.board.dirty=true;
  S.tabs[v.kind==='fus'?0:2].dirty=true;
}

/* ---------- рисование сцены ---------- */
function draw(E,S,add){
  const mesh=E.mesh,TRS=VR.TRS,hp=E.headPose().pos;
  /* подсветка ячеек */
  const frame=(z,col)=>{
    if(!(z>=1&&z<=118))return;
    const q=cellPx(z),a=pxToWorld(q.x,q.y),b=pxToWorld(q.x+q.w,q.y+q.h),t=.006;
    const w=b[0]-a[0],h=a[1]-b[1],cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,zz=TP[2]+t;
    add(mesh.cube,TRS(cx,a[1],zz,w+t,t,.004),col,1);add(mesh.cube,TRS(cx,b[1],zz,w+t,t,.004),col,1);
    add(mesh.cube,TRS(a[0],cy,zz,t,h,.004),col,1);add(mesh.cube,TRS(b[0],cy,zz,t,h,.004),col,1);
  };
  if(S.pt.hover>=0&&S.pt.btns[S.pt.hover])frame(S.pt.hover+1,[1,1,1]);
  if(S.el>=0)frame(S.el+1,[1,.85,.1]);
  /* плашки символов над телами */
  for(const b of elBodies(E)){
    const z=b.data.zn,e=N.el(z);if(!e)continue;
    const tex=E.labelTex('sym:'+z,(c,n)=>{
      c.fillStyle='#0f172a';VR.ui.rrect(c,4,24,n-8,n-48,18);c.fill();
      c.lineWidth=6;c.strokeStyle=D().elCats[e.cat][1];VR.ui.rrect(c,6,26,n-12,n-52,16);c.stroke();
      c.fillStyle='#fff';c.font='bold 64px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(e.sym,n/2,n/2+2);
    });
    if(!tex)continue;
    const y=b.p[1]+b.s/2+.05;
    add(mesh.quad,TRS(b.p[0],y,b.p[2],.08,.08,1,yawTo(b.p[0],b.p[2],hp[0],hp[2])),[1,1,1],0,1,tex);
  }
  /* свечение сосуда во время отсчёта */
  for(const v of S.vs)if(v.ready){const k=.05+.012*Math.sin(E.t*6);add(mesh.sphere,TRS(v.c[0],1.02,v.c[1],k,k,k),v.kind==='fus'?[1,.6,.2]:[.4,.7,1],1);}
  if(S.mol){
    const m=S.mol.m,base=VR.M.mul(VR.M.trans(OUTF[0]+.0,1.2,OUTF[1]),VR.M.rotY(E.t*.8));
    for(const [el,x,y,z] of m.atoms){const k=el==='H'?.05:.07;add(mesh.sphere,VR.M.mul(base,TRS(x*1.3,y*1.3,z*1.3,k,k,k)),D().atoms[el].col,.3);}
  }
}

VR.chemLab={build,pick,toggleCard,toggleMode,setCur,treeOf,planOf,react,TREE,TIP,TAB,CAP,onGrab,update,draw,cellPx,pxToWorld,makeBody,MAXN,TP,TW,TH,FV,DV,OUTF,OUTD,STAND,BOARD,TABS,CARD,SLOTX,SLOTZ,SLOTR};
})();

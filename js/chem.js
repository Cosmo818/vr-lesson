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
  '19-39':333.7241,'20-40':342.0521};
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
  if(a<=4||z<1||a<z)return null;
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
function split(x){
  const from=[x];
  if(x.z<=1)return{ok:false,why:'h',from};
  if(x.z>=84){
    const b0=be(x.z,x.a),b1=be(x.z-2,x.a-4),b2=be(2,4);
    if(!b0||!b1||!b2)return{ok:false,why:'tiny',from};
    return{ok:true,kind:'alpha',from,to:[{z:x.z-2,a:x.a-4},{z:2,a:4}],n:0,q:b1.mev+b2.mev-b0.mev,exact:b0.exact&&b1.exact&&b2.exact};
  }
  const f=fissionQ(x.z,x.a);
  if(!f)return{ok:false,why:'tiny',from};
  return{ok:true,kind:'fission',from,to:f.to,n:f.n,q:f.q,exact:f.exact};
}
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
    if(r.why==='pp')return 'Гелия-2 не существует: два протона вместе не держатся. В Солнце протон + протон → дейтерий + позитрон + нейтрино, выделяется около 0,42 МэВ.';
    if(r.why==='h')return 'У водорода один протон — делить нечего.';
    if(r.why==='tiny')return 'Ядро слишком маленькое, чтобы разделиться на два устойчивых ядра.';
    return 'Такое ядро не держится вместе: оно сразу развалится.';
  }
  const t=r.to[0];
  if(r.kind==='fusion'){
    if(t.z===4&&t.a===8)return 'Бериллий-8 живёт ничтожную долю секунды (около 10 в минус 16-й степени секунды) и распадается на два ядра гелия-4. Поэтому углерод в звёздах рождается сразу из трёх гелиев.';
    if(r.q>0&&t.z<=28)return 'Слияние лёгких ядер выделяет энергию: так светят звёзды. Пока получается элемент не тяжелее железа и никеля, слияние выгодно.';
    if(r.q>0)return 'Слияние выделяет энергию, но тяжелее железа и никеля это встречается всё реже.';
    return 'Слияние ядер тяжелее железа и никеля энергию поглощает: вершина устойчивости — около железа и никеля. Тяжёлые элементы рождаются при взрывах звёзд.';
  }
  if(r.kind==='alpha')return 'Альфа-распад: тяжёлое ядро выбрасывает ядро гелия-4. Так устроена радиоактивность тяжёлых элементов.';
  const z=r.from[0].z;
  let s=r.q>0?'Деление тяжёлых ядер выделяет много энергии — на этом работают атомные электростанции.':'Лёгкие и средние ядра при делении энергию поглощают: на это нужно затратить энергию.';
  s+=' В природе элемент №'+z+' сам не делится — здесь деление принудительное.';
  if(z===43||z===61)s+=' Он радиоактивен: в природе идёт бета-распад, в модели — деление.';
  return s;
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

VR.nuc={el,cell,semf,be,fuse,fissionQ,split,perGram,coalT,num,fmtQ,note,curve,EX,REF,MAXZ};
})();

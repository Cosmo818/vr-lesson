/* Проверки безопасности тела js/netsafe.js (шаг Н9): математика калибровки, кольца, режимы seat/stand, статус для кабинета.
   Поддельные движок и сеть; VR.netplay — заглушка с physAll. Запуск: node tests/netsafe.js (входит в tests/run.js). */
'use strict';
const path=require('path'),ROOT=path.resolve(__dirname,'..');
global.window=global;
require(path.join(ROOT,'js/netsafe.js'));
const VR=global.VR,NS=VR.netsafe,PU=NS._pure;
let fails=0;
const ok=(c,m)=>{console.log((c?'ok  : ':'FAIL: ')+m);if(!c)fails++;};
const near=(a,b,e)=>Math.abs(a-b)<=(e||1e-6);
const d2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};

/* ---- станции ---- */
{
  const s=PU.normStations(['Лаб 1',' ',{id:'Б',x:3,z:-2,yaw:90},{x:'плохо',z:1e9,yaw:-999},{id:'Г'},{id:'лишняя'}]);
  ok(s.length===4&&s[0].id==='Лаб 1'&&s[0].x===0&&s[1].x===3&&s[1].yaw===90,'станции: строка Н8 → в начале координат, объект с координатами сохраняется');
  ok(s[2].id==='Станция 3'&&s[2].x===0&&s[2].z===50&&s[2].yaw===-360,'станции: без имени — «Станция N», числа обрезаются (±50 м, ±360°), мусор → 0');
  ok(PU.normStations(null).length===1&&PU.normStations([]).length===1,'станции: пусто → одна станция по умолчанию; больше 4 — отбрасываются');
}

/* ---- калибровка: точки A и B, поворот, обратный перевод ---- */
{
  let worst=0,worstInv=0,okA=true,okB=true;
  for(let i=0;i<200;i++){
    const a=[rnd()*6-3,rnd()*6-3],th=rnd()*Math.PI*2-Math.PI,b=[a[0]+Math.cos(th),a[1]+Math.sin(th)];
    const st={id:'S',x:rnd()*10-5,z:rnd()*10-5,yaw:rnd()*720-360},r=PU.calibSolve(a,b,st);
    if(!r.ok){okA=false;break;}
    const A=PU.toClass(r.cal,a[0],a[1]),B=PU.toClass(r.cal,b[0],b[1]),yr=st.yaw*Math.PI/180;
    if(d2(A,[st.x,st.z])>1e-9)okA=false;
    if(d2(B,[st.x+Math.cos(yr),st.z+Math.sin(yr)])>1e-9)okB=false;
    const p=[rnd()*20-10,rnd()*20-10],q=PU.fromClass(r.cal,...PU.toClass(r.cal,p[0],p[1]));
    worstInv=Math.max(worstInv,d2(p,q));
    /* метка B поставлена с ошибкой 1 см поперёк — точка в 5 м от A уходит не дальше 5 см */
    const e=.01,bn=[b[0]-Math.sin(th)*e,b[1]+Math.cos(th)*e],rn=PU.calibSolve(a,bn,st);
    const far=[a[0]+Math.cos(th+1)*5,a[1]+Math.sin(th+1)*5];
    worst=Math.max(worst,d2(PU.toClass(r.cal,...far),PU.toClass(rn.cal,...far)));
  }
  ok(okA,'калибровка: метка A переходит в точку станции (200 случайных поворотов)');
  ok(okB,'калибровка: метка B — в 1 м от станции по её углу yaw');
  ok(worstInv<1e-9,'калибровка: обратный перевод рамка класса → local-floor возвращает точку');
  ok(worst<=.05,'калибровка: ошибка метки 1 см даёт ≤ 5 см на 5 м (наихудшая '+(worst*100).toFixed(2)+' см)');
  ok(PU.calibSolve([0,0],[.9,0]).ok===false&&PU.calibSolve([0,0],[1.06,0]).why==='dist'&&PU.calibSolve([0,0],[1.04,0]).ok,'калибровка: расстояние A–B вне 1,00 ± 0,05 м отвергается');
  const L=[],R=[],Lj=[],Rj=[];for(let i=0;i<30;i++){const j=(i%2?1:-1)*.002;L.push([j,0]);R.push([1+j,0]);Lj.push([i%2?.015:-.015,0]);Rj.push([1,0]);}
  ok(PU.holdCheck(L,R).ok,'удержание: дрожь 2 мм — калибровка принята');
  ok(PU.holdCheck(Lj,Rj).why==='still','удержание: разброс 1,5 см — «ещё раз»');
  ok(near(PU.headingOf([0,0,0,1]),-Math.PI/2)&&near(Math.abs(PU.headingOf([0,Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)])),Math.PI,1e-9),'направление взгляда: без поворота — вдоль −Z, поворот на 90° влево — вдоль −X');
}

/* ---- кольца, место, режимы ---- */
{
  ok(PU.ringLevel(.79)===2&&PU.ringLevel(.8)===1&&PU.ringLevel(1.49)===1&&PU.ringLevel(1.5)===0,'кольца: < 0,8 м — тревога, < 1,5 м — красное, дальше нет');
  ok(PU.seatRadius('seat')===.5&&PU.seatRadius('stand')===.6&&PU.seatRadius('walk')===null&&PU.seatRadius('???')===.5,'радиус места: seat 0,5, stand 0,6, walk нет');
  let A=null;A=PU.anchorStep(A,[0,0],0);A=PU.anchorStep(A,[.1,0],2000);
  ok(!A.anchor,'место: 2 с неподвижно — места ещё нет');
  A=PU.anchorStep(A,[.1,.05],3100);ok(A.anchor&&near(A.anchor[0],0),'место: 3 с в пределах 0,2 м — место запомнено');
  A=PU.anchorStep(A,[2,0],9000);A=PU.anchorStep(A,[2,0],13000);ok(near(A.anchor[0],0),'место: уже запомненное не переезжает само');
  ok(PU.offSeat([0,0],[.55,0],'seat')&&!PU.offSeat([0,0],[.55,0],'stand')&&!PU.offSeat([0,0],[5,0],'walk')&&!PU.offSeat(null,[5,0],'seat'),'«вернись на место»: seat > 0,5, stand > 0,6, в walk и без места — нет');
  ok(PU.isJump([0,0],[.31,0])&&!PU.isJump([0,0],[.29,0])&&!PU.isJump(null,[5,5]),'скачок головы > 0,3 м за кадр');
  const lim=PU.modeLimits(40);ok(lim.seat===15&&lim.stand===16&&lim.walk===10,'пределы площади: 40 м² → стоя 16, ходьба 10');
  ok(!PU.walkCheck(10,30,true).ok&&!PU.walkCheck(5,30,false).ok&&PU.walkCheck(5,30,true).ok&&!PU.walkCheck(5,0,true).ok,'walk: только ≥ 4 м² на ученика и все откалиброваны');
  ok(PU.nearest([0,0],[{slot:1,x:1,z:0,cal:true},{slot:2,x:.3,z:0,cal:false},{slot:3,x:.7,z:0,cal:true}]).slot===3,'ближайший сосед: без калибровки не считается');
}

/* ---- живой кадр: поддельные движок и сеть ---- */
{
  let T=10000;NS._env.now=()=>T;
  const toasts=[],buzz=[],beeps=[],sent=[],H={},subs=[],draws=[];
  const gp=[{buttons:[{pressed:false}]},{buttons:[{pressed:false}]}];
  const rig={yaw:0,tx:5,tz:-1};
  const st={head:[0,1.6,0],L:[1,0,2],R:[2,0,2]};
  const sess={};
  const E={session:sess,hooks:{},t:0,mesh:{circle:'circle',cube:'cube',cyl:'cyl'},TRS:(...a)=>a,H:[{src:{gamepad:gp[0]}},{src:{gamepad:gp[1]}}],
    headBase:()=>E.session?{p:st.head.slice(),q:[0,0,0,1]}:null,gripBase:i=>({p:(i?st.R:st.L).slice(),q:[0,0,0,1]}),
    fromBase:(x,z)=>[x+rig.tx,z+rig.tz],toast:(t)=>toasts.push(t),buzz:(h,a)=>buzz.push(a),beep:f=>beeps.push(f),chime:()=>beeps.push('chime'),
    onFrameSub:f=>subs.push(f),extraDraw:f=>draws.push(f)};
  const net={status:()=>({state:'on'}),send:o=>{sent.push(o);return true;},on:(t,f)=>{H[t]=f;},off:()=>{},
    welcome:()=>({sess:{mode:'seat',stations:[{id:'Окно',x:2,z:3,yaw:90}]}})};
  let peers=[];VR.netplay={physAll:()=>peers};
  NS.attach(E,net);
  const frame=(ms)=>{T+=ms||16;E.t=T/1000;subs[0](.016);};
  const drawList=()=>{const L=[];draws[0]((m,...a)=>L.push({m,a}),E);return L;};
  ok(subs.length===1&&draws.length===1&&typeof E.hooks.onRefReset==='function','attach: кадровый вызов, рисование колец и обработчик reset подключены');
  ok(NS.mode()==='seat'&&NS.stations()[0].id==='Окно','attach: режим и станции из welcome');
  frame();ok(sent.length===1&&sent[0].k==='st'&&sent[0].cal===0&&sent[0].vr===1,'статус: сразу уходит ev st (cal 0, в VR)');
  NS.startCal(0);
  gp[0].buttons[0].pressed=gp[1].buttons[0].pressed=true;for(let i=0;i<80;i++)frame();
  ok(!NS.calibrated(),'калибровка: курки, зажатые до начала, не считаются — нужно отпустить');
  gp[0].buttons[0].pressed=gp[1].buttons[0].pressed=false;frame();
  gp[0].buttons[0].pressed=gp[1].buttons[0].pressed=true;for(let i=0;i<40;i++)frame();
  ok(!NS.calibrated(),'калибровка: меньше 1 с удержания — ещё нет');
  for(let i=0;i<40;i++)frame();
  ok(NS.calibrated()&&!NS.calibrating()&&beeps.includes('chime'),'калибровка: 1 с неподвижно на метках — откалиброван, сигнал');
  gp[0].buttons[0].pressed=gp[1].buttons[0].pressed=false;
  /* метка A (1,2) → станция (2,3); голова (0,0) в local-floor: от A на (−1,−2), поворот на 90° (A→B вдоль +x → вдоль +z) */
  const po=NS.physOut();
  ok(po.cal&&near(po.x,2+2,1e-9)&&near(po.z,3-1,1e-9),'physOut: положение головы в рамке класса (%s)'.replace('%s',po.x.toFixed(2)+','+po.z.toFixed(2)));
  /* сосед 0,6 м от меня в рамке класса */
  peers=[{slot:4,x:po.x+.6,z:po.z,cal:true},{slot:5,x:po.x+.3,z:po.z,cal:false}];
  sent.length=0;frame(600);
  const L=drawList(),cyl=L.filter(x=>x.m==='cyl'),circ=L.filter(x=>x.m==='circle');
  const exp=PU.fromClass(NS._state.cal,po.x+.6,po.z),ew=[exp[0]+rig.tx,exp[1]+rig.tz];
  ok(cyl.length===1&&circ.length===1&&near(cyl[0].a[0][0],ew[0],1e-9)&&near(cyl[0].a[0][2],ew[1],1e-9),'кольцо: одно (сосед без калибровки — нет), на месте тела соседа в моём мире');
  ok(near(circ[0].a[0][3],.4)&&near(cyl[0].a[0][4],1.8),'кольцо: радиус 0,4 м, столб 1,8 м');
  ok(buzz.length>0&&beeps.includes(1100),'ближе 0,8 м: вибрация и тихий сигнал');
  ok(sent.some(o=>o.k==='st'&&o.cal===1&&o.near===2),'статус: учителю уходит cal 1, near 2');
  peers=[{slot:4,x:po.x+1.2,z:po.z,cal:true}];buzz.length=0;frame(600);
  ok(drawList().filter(x=>x.m==='cyl').length===1&&buzz.length===0,'1,2 м: кольцо есть, вибрации нет');
  peers=[{slot:4,x:po.x+2,z:po.z,cal:true}];frame();ok(drawList().filter(x=>x.m==='cyl').length===0,'2 м: кольца нет');
  /* своё место: 3 с неподвижно, потом шаг на 0,7 м */
  for(let i=0;i<4;i++)frame(1000);
  ok(NS._state.A.anchor!==null,'место запомнено после 3 с');
  sent.length=0;for(const x of[.2,.4,.6,.7]){st.head=[x,1.6,0];frame();}
  const y=drawList().filter(x=>x.m==='circle');
  ok(y.length===1&&near(y[0].a[0][3],.5)&&y[0].a[1][0]===1,'seat: отошёл на 0,7 м — жёлтое кольцо радиусом 0,5 на месте');
  frame(600);ok(sent.some(o=>o.off===1),'статус: «ушёл с места» уходит учителю');
  H.sess({sess:{mode:'walk',stations:[]}});ok(drawList().filter(x=>x.m==='circle').length===0&&NS.stations().length===1,'walk: жёлтого кольца нет; пустые станции → одна по умолчанию');
  H.sess({sess:{mode:'seat'}});
  /* потеря калибровки */
  st.head=[1.3,1.6,0];frame();
  ok(!NS.calibrated()&&toasts.some(t=>t.indexOf('Калибровка сбилась')===0),'скачок головы 0,5 м за кадр — калибровка сброшена, подсказка ученику');
  ok(NS.physOut().cal===false,'без калибровки: physOut в local-floor, флаг не ставится');
  NS._state.cal={r:0,ax:0,az:0,ox:0,oz:0};E.hooks.onRefReset();ok(!NS.calibrated(),'событие reset у пространства — калибровка сброшена');
  NS._state.cal={r:0,ax:0,az:0,ox:0,oz:0};E.session={};frame();ok(!NS.calibrated(),'новый вход в VR — калибровка сброшена');
  E.session=null;frame();ok(NS.physOut()===null&&drawList().length===0,'вне VR: физического положения и колец нет');
  NS.detach();
}

console.log(fails?('\nПРОВАЛЕНО: '+fails):'\nВсе проверки пройдены');
process.exit(fails?1:0);

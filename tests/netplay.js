/* Проверки аватаров по сети js/netplay.js (шаг Н7а): чистые функции и сборка E.peers с поддельными движком и сетью.
   Запуск: node tests/netplay.js. Строки «ok  : …» / «FAIL: …» входят в общий счёт tests/run.js. */
'use strict';
const path=require('path'),ROOT=path.resolve(__dirname,'..');
global.window=global;
require(path.join(ROOT,'js/netproto.js'));
require(path.join(ROOT,'js/netplay.js'));
const VR=global.VR,NP=VR.netproto,NPL=VR.netplay,PU=NPL._pure;
let fails=0;
const ok=(c,m)=>{console.log((c?'ok  : ':'FAIL: ')+m);if(!c)fails++;};
const near=(a,b,e)=>Math.abs(a-b)<=(e||1e-6);
const qy=a=>[0,Math.sin(a/2),0,Math.cos(a/2)];
const pose=(x,y,z,a)=>({p:[x,y,z],q:qy(a||0)});

/* ---- интерполяция и slerp ---- */
{
  const buf=[{t:1000,head:pose(0,1.6,0,0),hl:pose(-.2,1,.1,0),hr:null},{t:1100,head:pose(1,1.7,-2,Math.PI/2),hl:pose(-.2,1.2,.1,0),hr:null}];
  const m=PU.sampleAt(buf,1050);
  ok(near(m.head.p[0],.5)&&near(m.head.p[1],1.65)&&near(m.head.p[2],-1),'интерполяция: на середине между снимками позиция ровно посередине');
  const half=qy(Math.PI/4);
  ok(near(Math.hypot(...m.head.q),1,1e-9)&&m.head.q.every((v,i)=>near(v,half[i],1e-6)),'slerp: на середине поворот 45°, кватернион нормирован');
  ok(near(m.hl.p[1],1.1)&&m.hr===null,'руки: левая интерполируется, отсутствующая правая остаётся null');
  const neg=PU.slerp([0,0,0,1],[0,0,0,-1],.5);
  ok(near(Math.hypot(...neg),1,1e-9)&&near(Math.abs(neg[3]),1,1e-9),'slerp: противоположные знаки кватерниона идут коротким путём');
  const moving=[{t:1000,head:pose(0,1.6,0),hl:null,hr:null},{t:1100,head:pose(.1,1.6,0),hl:null,hr:null}];
  ok(near(PU.sampleAt(moving,1150).head.p[0],.15),'экстраполяция: 50 мс за последним снимком по скорости 1 м/с');
  ok(near(PU.sampleAt(moving,1700).head.p[0],.2),'экстраполяция обрезается на 100 мс, дальше аватар стоит');
  ok(near(PU.sampleAt(moving,900).head.p[0],0),'до первого снимка — стоим на первом');
  const fast=[{t:1000,head:pose(0,1.6,0),hl:null,hr:null},{t:1010,head:pose(5,1.6,0),hl:null,hr:null}];
  ok(PU.sampleAt(fast,1110).head.p[0]<5+1.05,'экстраполяция: скорость ограничена 10 м/с');
}

/* ---- задержка D ---- */
{
  ok(PU.delayTarget(50,0)===75&&PU.delayTarget(66.7,10)>110&&PU.delayTarget(66.7,10)<115,'D: 1,5·такт + джиттер (20 Гц → 75 мс, 15 Гц и джиттер 10 → ≈110 мс)');
  ok(PU.delayTarget(10,0)===60&&PU.delayTarget(500,300)===250,'D: нижняя граница 60 мс, верхняя 250 мс');
  ok(PU.delayTarget(NaN,NaN)>=60&&PU.delayTarget(NaN,NaN)<=250,'D: мусор на входе даёт значение в [60,250]');
  const j=[];for(let i=0;i<40;i++)j.push(i<36?2:30);
  ok(PU.percentile95(j)===30&&PU.percentile95([])===0&&PU.percentile95([5])===5,'джиттер95: берётся хвост распределения');
  let d=75;for(let i=0;i<6;i++)d=PU.smoothD(d,250,1/60);
  ok(d>75&&d<80&&PU.smoothD(null,120,.016)===120,'D меняется плавно (≈30 мс за секунду), первое значение — сразу');
}

/* ---- сколько полных ---- */
{
  const items=[];for(let s=0;s<16;s++)items.push({slot:s,d:(s*7%16)+1});
  const q1=PU.pickFull(items,PU.fullLimit(true,false)),hv=PU.pickFull(items,PU.fullLimit(true,true)),all=PU.pickFull(items,PU.fullLimit(false,true));
  const nearest=n=>items.slice().sort((a,b)=>a.d-b.d).slice(0,n).map(i=>i.slot).sort((a,b)=>a-b).join(',');
  ok(q1.size===12&&[...q1].sort((a,b)=>a-b).join(',')===nearest(12),'Quest 1, 16 участников: 12 полных, и это ближайшие');
  ok(hv.size===6&&[...hv].sort((a,b)=>a-b).join(',')===nearest(6),'Quest 1 в комнате heavy: 6 полных, ближайшие');
  ok(all.size===16,'Quest 2/3 и ПК: все 16 полные даже в heavy-комнате');
  ok(PU.detectQuest1From(['oculus-touch-v2','oculus-touch'],'Mozilla/5.0 (X11; Linux x86_64; Quest) OculusBrowser/9.0')===true,'Quest 1: UA «Quest» и старый профиль контроллера');
  ok(PU.detectQuest1From(['oculus-touch-v3','oculus-touch'],'Mozilla/5.0 (Linux; Android 12; Quest 2) OculusBrowser')===false&&
     PU.detectQuest1From(['meta-quest-touch-plus','oculus-touch'],'Mozilla/5.0 (Linux; Android 14; Quest 3) OculusBrowser')===false&&
     PU.detectQuest1From([],'Mozilla/5.0 (Windows NT 10.0) Chrome/120')===false,'Quest 2/3 и ПК не считаются Quest 1');
}

/* ---- имя, цвет, бледнение ---- */
{
  ok(PU.shortName('Иван Петров')==='Иван П.'&&PU.shortName('Иван П.')==='Иван П.'&&PU.shortName('  анна   сидорова ')==='анна С.'&&PU.shortName('Мария')==='Мария'&&PU.shortName('')==='','имя: «Иван Петров» → «Иван П.», готовая форма не дублируется');
  ok(PU.labelText('Иван Петров',true)==='Иван П. · за экраном'&&PU.labelText('Иван Петров',false)==='Иван П.','подпись участника за компьютером: «… · за экраном»');
  ok(PU.PALETTE.length===12&&PU.colorOf(null,3).join()===PU.PALETTE[3].join()&&PU.colorOf(null,15).join()===PU.PALETTE[3].join()&&PU.colorOf([255,0,0],1).join()==='1,0,0'&&PU.colorOf('#00ff00',1).join()==='0,1,0','цвет места: палитра 12 по месту, свой цвет из roster учитывается');
  ok(PU.fadeTarget(.3)<.5&&PU.fadeTarget(.3)>=.15&&PU.fadeTarget(.1)===.15&&PU.fadeTarget(.5)===1&&PU.fadeTarget(2)===1,'бледнение: на 0,3 м — полупрозрачный, на 0,5 м и дальше — полностью виден');
  let a=1;for(let i=0;i<30;i++)a=PU.fadeStep(a,PU.fadeTarget(.3),1/60);
  ok(a<1&&a>PU.fadeTarget(.3),'бледнение идёт плавно, а не скачком');
}

/* ---- сборка E.peers: реальные кадры encodeBatch → decodeBatch ---- */
(function(){
  let nowT=5000,localT=0;const sent=[],H={};
  const net={on:(t,f)=>(H[t]||(H[t]=[])).push(f),off:(t,f)=>{H[t]=(H[t]||[]).filter(x=>x!==f);},
    now:()=>nowT,status:()=>({state:'on',rtt:20,hz:20,hub:'local'}),sendPose:b=>{sent.push(b);return true;},welcome:()=>null};
  const emit=(t,a)=>(H[t]||[]).slice().forEach(f=>f(a));
  let frameFn=null,heavy=false;
  const E={peers:[],H:[{},{}],session:{},menuOpen:false,onFrameSub:f=>{frameFn=f;},
    headWorld:()=>({p:[0,1.6,0],q:[0,0,0,1]}),rigInfo:()=>({xr:true,yaw:.3,tx:1,tz:2}),toBase:(x,z)=>[x-1,z-2]};
  NPL._env.now=()=>localT;
  NPL.attach(E,net,{quest1:true,heavy:()=>heavy});
  ok(typeof frameFn==='function','attach: кадровая подписка E.onFrameSub зарегистрирована');
  const roster=[];for(let s=2;s<=17;s++)roster.push({slot:s,name:s===2?'Иван Петров':'Ученик'+s+' Тестов',role:'s',col:null,room:'hall',away:false});
  emit('welcome',{slot:1,hz:20,roster});
  const batch=(srv,k)=>{
    const items=[];
    for(let s=2;s<=17;s++)items.push({slot:s,age:8,flags:4|2|1,head:pose(s===2?.3:s*.5,1.6,0,.2),left:pose(s*.5-.2,1.2,.1),right:pose(s*.5+.2,1.2,.1),phys:{x:k*.1,z:1,yaw:.1}});
    items.push({slot:18,age:0,flags:4,head:pose(9,1.6,9),left:pose(0,0,0),right:pose(0,0,0),phys:{x:0,z:0,yaw:0}});
    const dec=NP.decodeBatch(NP.encodeBatch({tick:k,srv,items}));
    return{tick:dec.tick,srv:dec.srv,items:dec.items,at:srv+300};
  };
  emit('poses',batch(1000,0));emit('poses',batch(1050,1));emit('poses',batch(1100,2));
  nowT=1200;frameFn(.016);
  ok(E.peers.length===16,'E.peers: 16 участников из roster, место не из roster (18) не рисуется');
  const p2=E.peers.find(p=>p.slot===2),p17=E.peers.find(p=>p.slot===17);
  ok(p2&&p2.name==='Иван П.'&&p2.col.length===3&&p2.head.p[1]>1.59&&p2.hl&&p2.hr&&p2.desk===false,'аватар: имя «Иван П.», цвет, голова и обе кисти');
  ok(near(p2.head.p[0],.3,.02)&&near(p17.head.p[0],8.5,.02),'позиции берутся из реальных кадров (точность до мм протокола)');
  ok(E.peers.filter(p=>p.full).length===12&&E.peers.filter(p=>p.full).every(p=>p.slot<=13),'Quest 1: 12 полных, это ближайшие по расстоянию до моей головы');
  ok(p2.alpha<.5&&p2.alpha>=.15&&p17.alpha===1,'сосед на 0,3 м бледный, дальний — нет');
  heavy=true;frameFn(.016);
  ok(E.peers.filter(p=>p.full).length===6,'комната heavy: 6 полных');
  heavy=false;
  emit('roster',{op:'away',slot:3,on:true});emit('roster',{op:'-',slot:4,why:'gone'});frameFn(.016);
  ok(!E.peers.some(p=>p.slot===3||p.slot===4)&&E.peers.length===14,'ушедший (away) и удалённый из roster убраны');
  emit('roster',{op:'away',slot:3,on:false});frameFn(.016);
  ok(E.peers.some(p=>p.slot===3),'вернувшийся из away снова виден');
  /* участник за компьютером */
  const dk=batch(1150,3);dk.items.find(i=>i.slot===5).flags=0;emit('poses',dk);nowT=1260;frameFn(.016);
  const p5=E.peers.find(p=>p.slot===5);
  ok(p5&&p5.desk===true&&p5.hl===null&&p5.hr===null&&/за экраном$/.test(p5.name),'участник за компьютером: без кистей, подпись «… · за экраном»');
  NPL.hideAll(true);frameFn(.016);
  ok(NPL.hidden()===true&&E.peers.length===0,'«Скрыть всех»: аватары не рисуются');
  NPL.hideAll(false);frameFn(.016);
  ok(NPL.hidden()===false&&E.peers.length>0,'«Скрыть всех» выключается');
  /* физическое положение без задержки */
  const ph=NPL.physNow(6);
  ok(ph&&near(ph.x,.3+.002*128,.01)&&near(ph.z,1,1e-3),'physNow: последний снимок + скорость × (возраст + RTT/2), не дальше 0,3 с');
  ok(NPL.physNow(99)===null,'physNow: неизвестное место — null');
  const pp=PU.physPredict({t:1000,phys:{x:0,z:0,yaw:0}},{t:1050,phys:{x:.1,z:0,yaw:0}},5000,20);
  ok(near(pp.x,.1+2*.3,1e-6)&&pp.dt===300,'physPredict: ограничение прогноза 0,3 с');
  /* своя поза уходит с частотой hz */
  localT=1000;sent.length=0;frameFn(.016);
  const o=sent.length&&NP.decodePose(sent[0]);
  ok(sent.length===1&&o&&(o.flags&4)===4&&near(o.head.p[1],1.6,.002)&&near(o.phys.x,-1,.002)&&near(o.phys.z,-2,.002)&&near(o.phys.yaw,.3,1e-3),'своя поза: кадр 52 байта, VR-флаг, физическое положение в local-floor');
  frameFn(.016);ok(sent.length===1,'не чаще hz: второй кадр сразу не уходит');
  localT=1060;frameFn(.016);ok(sent.length===2&&NP.decodePose(sent[1]).seq===1,'через такт уходит следующий кадр, seq растёт');
  /* обрыв: всё очищается */
  emit('closed',{code:1000,fatal:true});
  ok(E.peers.length===0&&NPL.peerIds().length===0,'closed: аватары и roster очищены');
  NPL.detach();
})();

/* ---- кадр туда-обратно (реальный формат) ---- */
{
  const o={seq:70000,t:123456,flags:7,head:pose(1.234,1.6,-2.5,1.1),left:pose(.9,1.1,-2.3,.4),right:pose(1.5,1.2,-2.4,-.4),phys:{x:.75,z:-1.25,yaw:.5}};
  const d=NP.decodePose(NP.encodePose(o));
  const dq=(a,b)=>Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]);
  ok(d&&d.seq===(70000&0xFFFF)&&d.t===123456&&d.flags===7&&near(d.head.p[0],1.234,.001)&&near(d.right.p[2],-2.4,.001)&&dq(d.head.q,o.head.q)>.9999&&near(d.phys.x,.75,.001)&&near(d.phys.yaw,.5,1e-4),'поза: encodePose → decodePose сохраняет голову, руки и физическое положение');
  const b=NP.decodeBatch(NP.encodeBatch({tick:9,srv:99000,items:[Object.assign({slot:5,age:40},o)]}));
  ok(b&&b.tick===9&&b.srv===99000&&b.items[0].slot===5&&b.items[0].age===40&&near(b.items[0].head.p[2],-2.5,.001)&&dq(b.items[0].left.q,o.left.q)>.9999,'пачка: encodeBatch → decodeBatch сохраняет место, возраст ageQ и позу');
  const m=new Float32Array([0,0,-1,0, 0,1,0,0, 1,0,0,0, 0,0,0,1]);          /* поворот на +90° вокруг Y */
  ok(dq(PU.matQuat(m),qy(Math.PI/2))>.99999,'matQuat: кватернион из матрицы руки');
}

console.log(fails?('\nПРОВАЛЕНО: '+fails):'\nВсе проверки пройдены');
process.exit(fails?1:0);

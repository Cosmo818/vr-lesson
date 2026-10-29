/* Проверки событий ведущего js/netlead.js (шаг Н10): места сбора, «внимание», переход по табличке, указки и реакции соседей, удаление.
   Поддельные движок и сеть; VR.netplay — заглушка (roster, своя позиция, голова ведущего). Запуск: node tests/netlead.js (входит в tests/run.js). */
'use strict';
const path=require('path'),ROOT=path.resolve(__dirname,'..');
global.window=global;
global.VR={DATA:{subjects:{chem:{title:'Химия',entry:'chem-hub'},phys:{title:'Физика'}}},entryOf:k=>k==='chem'?'chem-hub':k};
require(path.join(ROOT,'js/netlead.js'));
const VR=global.VR,NL=VR.netlead,PU=NL._pure;
let fails=0;
const ok=(c,m)=>{console.log((c?'ok  : ':'FAIL: ')+m);if(!c)fails++;};
const near=(a,b,e)=>Math.abs(a-b)<=(e||1e-6);

/* ---- чистые функции ---- */
{
  ok(near(PU.yawOfQuat([0,0,0,1]),0),'взгляд: без поворота — вперёд (yaw 0)');
  const q=[0,Math.sin(Math.PI/4),0,Math.cos(Math.PI/4)];
  ok(near(PU.yawOfQuat(q),Math.PI/2),'взгляд: поворот на 90° влево → yaw π/2 (как D.yaw в движке)');
  ok(near(PU.yawTo(0,1.5,0,0),0)&&near(PU.yawTo(1,0,0,0),Math.PI/2),'yawTo: смотреть на центр с юга — 0, с востока — π/2');
  ok(JSON.stringify(PU.fanOrder(5,1))==='[0,1,-1,2,-2]','места заполняются от «прямо» в обе стороны');
  const full=PU.gatherSpots(0,0,0,true),r0=full.filter(s=>s.ring===0);
  ok(near(full[0].x,0)&&near(full[0].z,-1.5),'кольцо: первое место — прямо перед ведущим, 1,5 м');
  ok(r0.every(s=>near(Math.hypot(s.x,s.z),1.5,1e-9))&&r0.length>=10,'кольцо: все места первого ряда на 1,5 м, их не меньше 10 ('+r0.length+')');
  let minD=9;for(let i=0;i<r0.length;i++)for(let j=i+1;j<r0.length;j++)minD=Math.min(minD,Math.hypot(r0[i].x-r0[j].x,r0[i].z-r0[j].z));
  ok(minD>=.7,'кольцо: соседние места не ближе 0,7 м ('+minD.toFixed(2)+')');
  const bc=PU.boardCenter({x:1,z:-.5}),half=PU.gatherSpots(bc.x,bc.z,bc.yaw,false);
  ok(near(bc.x,1)&&near(bc.z,-2.5),'доска: центр — 2 м перед местом появления');
  ok(near(half[0].x,1)&&near(half[0].z,-1),'полукруг: первое место — между учениками и доской, 1,5 м от центра');
  ok(half.every(s=>s.z>=bc.z-1e-9),'полукруг: все места на стороне учеников, не за доской');
  const pick=PU.pickSpot(full,0,(x)=>x>.1);
  ok(pick&&pick.x>.1,'стены и мебель: место, не прошедшее проверку, пропускается');
  ok(PU.pickSpot(full,3,()=>false)===null,'ни одного свободного места → null (остаться на месте)');
  const two=[{x:0,z:0},{x:1,z:0}];
  ok(PU.pickSpot(two,3,()=>true)===two[1],'мест меньше, чем учеников, — по кругу');
  ok(PU.studentIndex({1:{role:'t'},2:{role:'s'},9:{role:'a'}},4,true)===1&&PU.studentIndex({1:{role:'t'},2:{role:'s'}},1,false)===-1,'номер места — по slot среди учеников (себя в roster нет); учитель не переносится');
  ok(near(PU.rigYawFor(0,.5,.2),-.3),'шлем: поворот системы так, чтобы голова смотрела куда нужно');
  ok(near(PU.beamLen([0,1,0],[0,-1,0]),1)&&near(PU.beamLen([0,1,0],[1,0,0]),5.9),'луч соседа: до пола и до стены');
}

/* ---- подделки ---- */
let T=1000;NL._env.now=()=>T;
const roster={1:{slot:1,role:'t',name:'Учитель',room:'hall'},3:{slot:3,role:'s',name:'Боря',room:'hall'},5:{slot:5,role:'a',name:'Завуч'}};   /* себя (slot 2) hub не присылает */
let me=2,head=null;const reacts=[];
VR.netplay={rosterOf:s=>roster[s]?Object.assign({},roster[s]):null,mySlot:()=>me,headOf:s=>s===1?head:null,react:(s,e)=>reacts.push([s,e]),_state:{roster}};
const toasts=[],poses=[],gone=[],adds=[];
const E={rooms:{hall:{},'chem-hub':{},phys:{}},roomId:'hall',spawn:{x:0,z:-.5},frozen:false,laser:{on:false},LASER_COLORS:[{c:[1,0,0]},{c:[0,1,0]}],t:0,
  mesh:{cube:'c',sphere:'s'},TRS:(...a)=>a,hsv:()=>[1,1,1],tpOk:()=>true,
  goRoom(id){gone.push(id);this.roomId=id;},setPose(x,z,yaw){poses.push({x,z,yaw});},rigInfo:()=>({xr:false,yaw:0}),headWorld:()=>({p:[0,1.6,0],q:[0,0,0,1]}),
  toast(t){toasts.push(t);},laserState(){return this.laser.on?{on:true,o:[0,1,0],d:[0,0,-1],ci:1}:{on:false};},isTeacher:()=>false,
  toggleLaser(v){this.laser.on=v===undefined?!this.laser.on:!!v;},onFrameSub(f){this.tick=f;},extraDraw(f){this.draw=f;}};
const H={},sent=[];let state='on';
const net={on:(t,f)=>{(H[t]||(H[t]=[])).push(f);},off:(t,f)=>{H[t]=(H[t]||[]).filter(x=>x!==f);},send:o=>{sent.push(o);return true;},status:()=>({state}),
  welcome:()=>({slot:2,sess:{freeze:false,pointers:true}})};
const fire=(t,m)=>{for(const f of H[t]||[])f(m);};
NL.attach(E,net);
ok(typeof E.tick==='function'&&typeof E.draw==='function','подключение: кадр и рисование зарегистрированы');

/* ---- «внимание» ---- */
E.laser.on=true;
fire('ev',{t:'ev',k:'freeze',slot:3,on:true});
ok(!E.frozen,'«внимание» от ученика не исполняется (ведущий — только роль t)');
fire('ev',{t:'ev',k:'freeze',slot:1,on:true});
ok(E.frozen&&NL.frozen()&&!E.laser.on&&toasts.at(-1)==='Учитель просит внимания','«внимание»: ввод заморожен, указка ученика выключена, табличка');
T+=3100;E.tick();
ok(toasts.filter(t=>t==='Учитель просит внимания').length===2,'«внимание»: табличка держится (повтор каждые 3 с)');
ok(!NL.pointersOk(),'при «внимании» указка ученика не разрешена');
ok(NL.react(0)===false,'при «внимании» реакции не уходят');
fire('ev',{t:'ev',k:'room',slot:1,id:'phys'});
T+=3500;E.tick();
ok(gone.length===0&&NL.pending(),'при «внимании» переход по табличке ждёт');
fire('ev',{t:'ev',k:'freeze',slot:1,on:false});
ok(!E.frozen,'«внимание» снято');
E.tick();
ok(gone.at(-1)==='phys','после снятия «внимания» отложенный переход выполняется');

E.isTeacher=()=>true;fire('ev',{t:'ev',k:'freeze',slot:1,on:true});
ok(!E.frozen,'учителя в шлеме «внимание» не останавливает');
fire('ev',{t:'ev',k:'freeze',slot:1,on:false});E.isTeacher=()=>false;
/* ---- переход по табличке ---- */
E.roomId='hall';gone.length=0;
fire('ev',{t:'ev',k:'room',slot:1,id:'chem'});
ok(/Химия/.test(toasts.at(-1))&&/3 с/.test(toasts.at(-1)),'табличка: «Учитель зовёт … в «Химия» — переход через 3 с»');
T+=2000;E.tick();ok(gone.length===0,'до 3 с переход не происходит');
T+=1100;E.tick();ok(gone.at(-1)==='chem-hub','через 3 с — переход во вход предмета (дерево химии)');
fire('ev',{t:'ev',k:'room',slot:1,id:'nosuch'});
ok(!NL.pending()&&/нет/.test(toasts.at(-1)),'неизвестная комната: табличка, перехода нет');
fire('ev',{t:'ev',k:'hall',slot:1});T+=3100;E.tick();
ok(gone.at(-1)==='hall','«все в холл» — через табличку');

/* ---- сбор ---- */
poses.length=0;
fire('ev',{t:'ev',k:'gather',slot:1,id:'phys'});
const p2=poses.at(-1);
ok(gone.at(-1)==='phys'&&p2&&near(p2.x,0)&&near(p2.z,-1)&&near(p2.yaw,0),'из кабинета: в комнату урока, место 1 полукруга, лицом к доске');
me=3;delete roster[3];roster[2]={slot:2,role:'s',name:'Аня',room:'hall'};fire('ev',{t:'ev',k:'gather',slot:1});const p3=poses.at(-1);delete roster[2];roster[3]={slot:3,role:'s',name:'Боря',room:'hall'};
ok(Math.hypot(p3.x-p2.x,p3.z-p2.z)>.7,'второй ученик — на другом месте');
head={p:[2,1.6,1],q:[0,0,0,1],desk:false,room:'phys'};me=2;
fire('ev',{t:'ev',k:'gather',slot:1});const pg=poses.at(-1);
ok(near(Math.hypot(pg.x-2,pg.z-1),1.5,1e-9)&&near(pg.yaw,PU.yawTo(pg.x,pg.z,2,1)),'учитель в VR: на 1,5 м от него, взгляд на него');
E.tpOk=()=>false;const n0=poses.length;
fire('ev',{t:'ev',k:'gather',slot:1});
ok(poses.length===n0&&/тесно/.test(toasts.at(-1)),'тесная комната: никуда не переносит, табличка');
E.tpOk=()=>true;E.isTeacher=()=>true;const n1=poses.length;
fire('ev',{t:'ev',k:'gather',slot:1});ok(poses.length===n1,'учитель в шлеме не переносится');E.isTeacher=()=>false;head=null;

/* ---- за ведущим ---- */
E.roomId='phys';gone.length=0;
fire('ev',{t:'ev',k:'follow',slot:1,on:true});ok(NL.following(),'«за мной» включено');
fire('roster',{t:'room',op:'room',slot:1,id:'chem'});T+=3100;E.tick();   /* как net.js из {t:'room',slot,id} hub */
ok(gone.at(-1)==='chem-hub','ведущий перешёл — ученик за ним (через табличку)');
fire('ev',{t:'ev',k:'follow',slot:1,on:false});fire('roster',{t:'room',op:'room',slot:1,id:'hall'});T+=3100;E.tick();
ok(gone.at(-1)==='chem-hub'&&!NL.following(),'«за мной» выключено — дальше не ведёт');

/* ---- указки соседей и своя указка ---- */
fire('ev',{t:'ev',k:'point',slot:3,on:true,o:[0,1,0],d:[0,0,-2],ci:1});
adds.length=0;E.draw((...a)=>adds.push(a),E);
ok(Object.keys(NL.points()).length===1&&adds.length>4&&adds.at(-1)[0]==='s','указка соседа: точки луча и шар на конце');
fire('ev',{t:'ev',k:'point',slot:3,on:true,o:[0,NaN,0],d:[0,0,1],ci:0});
ok(NL.points()[3].d[2]===-1,'указка с NaN отброшена, направление нормировано');
T+=700;E.tick();ok(!Object.keys(NL.points()).length,'указка без обновлений > 0,6 с гаснет');
fire('ev',{t:'ev',k:'point',slot:3,on:true,o:[0,1,0],d:[1,0,0],ci:0});fire('ev',{t:'ev',k:'point',slot:3,on:false});
ok(!NL.points()[3],'указка выключена соседом');
sent.length=0;E.laser.on=true;
for(let i=0;i<10;i++){T+=50;E.tick();}
const pts=sent.filter(m=>m.k==='point'&&m.on);
ok(pts.length>=4&&pts.length<=6&&pts[0].ci===1,'своя указка: 10 Гц, с цветом ('+pts.length+' за 0,5 с)');
E.laser.on=false;T+=50;E.tick();T+=50;E.tick();
ok(sent.filter(m=>m.k==='point'&&!m.on).length===1,'своя указка выключена — один on:false');
fire('sess',{t:'sess',sess:{pointers:false,freeze:false}});
ok(!NL.pointersOk(),'учитель выключил указки учеников — указка ученику недоступна');
fire('sess',{t:'sess',sess:{pointers:true,freeze:false}});ok(NL.pointersOk(),'указки снова разрешены');

/* ---- реакции ---- */
sent.length=0;
ok(NL.react(7)===true&&sent.at(-1).k==='react'&&sent.at(-1).e===7,'реакция ушла');
ok(NL.react(1)===false,'реакция не чаще раза в 2 с');
T+=2100;ok(NL.react(1)===true,'через 2 с — снова можно');
ok(NL.react(12)===false&&NL.react(-1)===false,'код реакции вне 0..11 не уходит');
fire('ev',{t:'ev',k:'react',slot:3,e:2});ok(reacts.at(-1)[0]===3&&reacts.at(-1)[1]==='👏','реакция соседа — над его головой');
fire('ev',{t:'ev',k:'react',slot:3,e:44});ok(reacts.length===1,'неизвестный код реакции не рисуется');

/* ---- Т7: кнопки ведущего ---- */
{
  ok(NL.buttons('a').length===0&&NL.buttons('s').length===0&&NL.buttons('').length===0,'Т7: у роли a (и ученика) кнопок ведущего нет');
  ok(NL.buttons('t').map(b=>b.id).join()==='gather,follow,freeze,hall,room,kick','Т7: у роли t шесть кнопок: сбор, за мной, внимание, холл, моя комната, убрать');
  const one=(f,want,m)=>{sent.length=0;const r=f();ok(r===true&&sent.length===1&&JSON.stringify(sent[0])===JSON.stringify(want),'Т7: '+m+' — ровно одно сообщение '+JSON.stringify(want)+' (получено '+JSON.stringify(sent)+')');};
  one(()=>NL.command('gather'),{t:'ev',k:'gather'},'«Все ко мне» (без id)');
  one(()=>NL.command('hall'),{t:'ev',k:'hall'},'«Все в холл»');
  one(()=>NL.command('room','phys'),{t:'ev',k:'room',id:'phys'},'«Позвать в мою комнату»');
  one(()=>NL.command('follow'),{t:'ev',k:'follow',on:true},'«За мной»');
  one(()=>NL.command('follow'),{t:'ev',k:'follow',on:false},'«Не следовать»');
  one(()=>NL.command('freeze'),{t:'ev',k:'freeze',on:true},'«Внимание!»');
  ok(NL.cmdState().freeze===true,'Т7: подпись «Снять» после включения «внимания»');
  one(()=>NL.command('freeze'),{t:'ev',k:'freeze',on:false},'«Снять»');
  one(()=>NL.command('kick',3),{t:'ev',k:'kick',slot:3},'«Убрать» (slot ученика)');
  sent.length=0;
  ok(NL.command('kick')===false&&NL.command('kick',-1)===false&&NL.command('room')===false&&NL.command('nosuch')===false&&sent.length===0,'Т7: команда без slot/id или неизвестная — ничего не уходит');
  state='connecting';ok(NL.command('gather')===false&&NL.command('freeze')===false&&sent.length===0&&NL.cmdState().freeze===false,'Т7: нет связи — ничего не уходит, состояние переключателя не меняется');state='on';
  fire('sess',{t:'sess',sess:{pointers:true,freeze:true}});ok(NL.cmdState().freeze===true,'Т7: «внимание» из настроек урока видно в подписи кнопки');
  fire('sess',{t:'sess',sess:{pointers:true,freeze:false}});
}

/* ---- удаление ---- */
fire('ev',{t:'ev',k:'freeze',slot:1,on:true});
fire('closed',{code:4012,fatal:true});
ok(!E.frozen&&/убрал/.test(toasts.at(-1)),'учитель убрал с урока: табличка, заморозка снята');
state='off';ok(!NL.pointersOk(),'нет связи — указка ученика недоступна');
NL.detach();ok(!E.frozen&&(H.ev||[]).length===0,'отключение: обработчики сняты');

console.log(fails?'\nПРОВАЛЕНО: '+fails:'\nВсе проверки пройдены');
process.exit(fails?1:0);

/* Проверки клиента сети js/net.js (шаг Н6): поддельные WebSocket и таймеры в Node — без сети и без реального времени.
   Запуск: node tests/net_client.js. Строки «ok  : …» / «FAIL: …» входят в общий счёт tests/run.js. */
'use strict';
const path=require('path'),fs=require('fs'),ROOT=path.resolve(__dirname,'..');
global.window=global;
require(path.join(ROOT,'js/netproto.js'));
require(path.join(ROOT,'js/net.js'));
const VR=global.VR,N=VR.net,NP=VR.netproto;
let fails=0;
const ok=(c,m)=>{console.log((c?'ok  : ':'FAIL: ')+m);if(!c)fails++;};

/* ---- поддельное время и таймеры ---- */
let T=1000,seq=0;const timers=new Map();
N._env.now=()=>T;N._env.rnd=()=>.5;
N._env.st=(f,ms)=>{const id=++seq;timers.set(id,{at:T+ms,f});return id;};
N._env.ct=id=>timers.delete(id);
async function adv(ms){                       /* двигаем время по шагам, давая выполниться промисам */
  const end=T+ms;
  for(;;){
    await flushP();
    let best=null;for(const [id,t] of timers)if(t.at<=end&&(!best||t.at<best.t.at))best={id,t};
    if(!best)break;
    timers.delete(best.id);T=Math.max(T,best.t.at);best.t.f();
  }
  T=end;await flushP();
}
const flushP=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

/* ---- поддельный WebSocket ---- */
const socks=[];
let script=url=>({open:true});                 /* поведение по адресу: open:false — не открывается; welcome:false — молчит; close:{code} — закрыть после hello */
class FakeWS{
  constructor(url){this.url=url;this.readyState=0;this.sent=[];this.bufferedAmount=0;this.closed=null;socks.push(this);this.beh=script(url,this);
    if(this.beh.throw)throw new Error('bad');
    Promise.resolve().then(()=>{if(this.beh.open===false||this.readyState===3)return;this.readyState=1;this.onopen&&this.onopen();});}
  send(d){if(this.readyState!==1)throw new Error('closed');this.sent.push(d);
    if(typeof d==='string'){const m=JSON.parse(d);if(m.t==='hello'){
      if(this.beh.close)setTimeout0(()=>this.drop(this.beh.close.code));
      else if(this.beh.welcome!==false)setTimeout0(()=>this.recv(Object.assign({t:'welcome',slot:7,resume:'RES'+socks.length,srv:5000,tick:1,hz:20,hold:120,limits:{},sess:{id:'rs-x'},roster:[]},this.beh.w||{})));}
      else if(m.t==='p'&&this.beh.pong!==false)setTimeout0(()=>this.recv({t:'P',c:m.c,s:m.c+this.beh.off+(this.beh.half||0)}));}}
  recv(o){this.onmessage&&this.onmessage({data:typeof o==='string'||o instanceof ArrayBuffer?o:JSON.stringify(o)});}
  drop(code){if(this.readyState===3)return;this.readyState=3;this.onclose&&this.onclose({code});}
  close(code){if(this.readyState===3)return;this.readyState=3;this.closed=code||1005;}
}
const setTimeout0=f=>Promise.resolve().then(f);
N._env.WS=FakeWS;
const sentOf=ws=>ws.sent.filter(x=>typeof x==='string').map(JSON.parse);
const reset=()=>{N.close('test',true);socks.length=0;timers.clear();script=()=>({open:true,off:300});T+=1000;};
const ev=[];const log=(t)=>N.on(t,x=>ev.push([t,x]));
['welcome','roster','poses','ev','err','closed','needTicket','resumed','sess'].forEach(log);
const evs=t=>ev.filter(e=>e[0]===t).map(e=>e[1]);

(async()=>{
  /* ---------- вход, hello, адреса ---------- */
  script=()=>({open:true,off:300});
  let w=await N.connect({hubs:[{url:'wss://c.example/ws',kind:'center'}],ticket:'TICKET1',caps:{quest1:true}}).catch(e=>e);
  ok(w&&w.slot===7&&N.status().state==='on'&&N.status().hub==='center','connect: welcome получен, состояние on');
  const h0=sentOf(socks[0])[0];
  ok(h0.t==='hello'&&h0.pv===1&&h0.ticket==='TICKET1'&&h0.caps.quest1===true&&!('resume' in h0),'hello: pv, билет и caps ушли');
  ok(N.resumeToken()==='RES1'&&N.welcome().slot===7,'токен возобновления — в памяти net.js');
  ok(N.status().hz===15,'через интернет частота поз 15 Гц');
  N.close('test');
  ok(N.status().state==='off'&&socks[0].closed===1000&&sentOf(socks[0]).some(m=>m.t==='bye'),'close: bye и код 1000');

  reset();
  script=u=>u.includes('local')?{open:false}:{open:true,off:300};
  const t0=T;
  const pr=N.connect({hubs:[{url:'ws://local.lan/ws',kind:'local'},{url:'wss://c.example/ws',kind:'center'}],ticket:'T2'});
  await adv(1400);ok(socks.length===1&&N.status().state==='connecting','локальный hub: ждём до 1,5 с');
  await adv(200);
  w=await pr;
  ok(socks.length===2&&socks[1].url.includes('c.example')&&w.slot===7&&N.status().hub==='center','локальный молчит 1,5 с → центр');
  ok(sentOf(socks[1])[0].ticket==='T2','билет ушёл только на сработавший адрес');
  N.close('t');

  reset();
  script=u=>({open:true,off:300});
  const pl=await N.connect({hubs:[{url:'ws://local.lan/ws',kind:'local'},{url:'wss://c.example/ws',kind:'center'}],ticket:'T3'});
  ok(socks.length===1&&N.status().hub==='local'&&N.status().hz===20,'локальный отвечает — центр не трогаем; поза 20 Гц');
  N.close('t');

  reset();
  script=()=>({open:true,welcome:false});
  const hp=N.connect({hubs:[{url:'ws://a/ws',kind:'local'},{url:'wss://b/ws',kind:'center'}],ticket:'T4'}).catch(e=>e);
  await adv(5100);const he=await hp;
  ok(he&&he.phase==='hello'&&socks.length===1&&N.status().state==='off','hub открылся, но не прислал welcome: ошибка, второй адрес с тем же билетом не пробуем');

  reset();
  script=()=>({open:true,close:{code:4001}});
  const rj=await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'BAD'}).catch(e=>e);
  ok(rj.code===4001&&N.status().state==='off','билет отклонён (4001) → connect отклонён с кодом');
  ok(await N.connect({hubs:[],ticket:'x'}).catch(e=>e.code)===0&&await N.connect({hubs:[{url:'http://x'}],ticket:'x'}).catch(e=>e.code)===0&&await N.connect({hubs:[{url:'wss://x/ws'}]}).catch(e=>e.code)===4001,'нет адресов, не ws-адрес, нет билета — отказ сразу');
  script=()=>{throw new Error('x');};
  ok(await N.connect({hubs:[{url:'wss://x/ws'}],ticket:'x'}).catch(e=>e.msg)==='адрес','исключение конструктора WebSocket не ломает connect');

  /* ---------- входящие ---------- */
  reset();
  script=()=>({open:true,off:300});
  ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'T5'});
  const s=socks[0];
  s.recv({t:'roster+',slot:9,name:'Аня П.',role:'s'});s.recv({t:'roster-',slot:9,why:'gone'});s.recv({t:'away',slot:3,on:true});s.recv({t:'room',slot:3,id:'chem'});s.recv({t:'roster~',slot:3,name:'Б.',role:'s'});
  ok(evs('roster').map(r=>r.op).join()==='+,-,away,room,~'&&evs('roster')[0].name==='Аня П.','roster: +, -, away, room, ~ с полями');
  s.recv({t:'ev',k:'gather',slot:1});s.recv({t:'sess',sess:{chat:'off'}});s.recv({t:'err',code:'role',msg:'gather'});
  ok(evs('ev')[0].k==='gather'&&evs('sess').length===1&&evs('err')[0].code==='role','ev, sess, err доходят подписчикам');
  const pose={seq:1,t:5,flags:4,head:{p:[1,1.6,2],q:[0,0,0,1]}};
  const buf=NP.encodeBatch({tick:3,srv:7000,items:[Object.assign({slot:4,age:8},pose)]});
  s.recv(buf);
  const pb=evs('poses')[0];
  ok(pb&&pb.tick===3&&pb.srv===7000&&pb.items.length===1&&pb.items[0].slot===4&&Math.abs(pb.items[0].head.p[2]-2)<1e-3,'пачка поз разобрана кодеком и отдана');
  s.recv('{{не json');s.recv({t:5});s.recv(new ArrayBuffer(3));
  ok(true,'мусорные кадры не роняют клиента');
  const origErr=console.error;console.error=()=>{};
  VR.net.on('poses',()=>{throw new Error('handler');});
  s.recv(buf);
  console.error=origErr;
  ok(evs('poses').length===2,'исключение в обработчике не мешает остальным');

  /* ---------- часы ---------- */
  s.beh.off=300;
  await adv(1);                         /* пинги идут раз в секунду */
  await adv(3000);
  const pings=sentOf(s).filter(m=>m.t==='p');
  ok(pings.length>=4&&pings.length<=6,'пинг раз в секунду на старте ('+pings.length+')');
  ok(Math.abs(N.now()-(T+300))<1,'часы: смещение к времени hub найдено (±1 мс)');
  ok(N.status().rtt===0,'rtt из пары (в тесте мгновенно)');
  /* лучшая пара — с минимальным RTT; шум не двигает оценку */
  N._clock.pairs.length=0;N._clock.off=null;
  /* настоящие вызовы pong через сообщения P */
  const sendP=(c,rtt,hubOff)=>{N._env.now=()=>c+rtt;s.recv({t:'P',c,s:(c+(c+rtt))/2+hubOff});N._env.now=()=>T;};
  sendP(1000,200,10);sendP(1300,20,50);sendP(1600,100,90);
  ok(N._clock.target===50&&Math.round(N._clock.rtt)===20,'выбрана пара с минимальным RTT (смещение 50, rtt 20)');
  N._clock.target=150;N._clock.last=T;
  const a=N.now();T+=1000;const b=N.now();
  ok(Math.abs((b-a)-(1000+5))<1e-6,'смещение сглаживается: не больше 5 мс за секунду');
  sendP(2000,-5,0);sendP(2000,9000,0);s.recv({t:'P',c:'x',s:1});
  ok(N._clock.pairs.length===3,'пары с отрицательным и огромным RTT и мусор отброшены');

  /* ---------- отправка ---------- */
  reset();script=()=>({open:true,off:0});
  await N.connect({hubs:[{url:'ws://l/ws',kind:'local'}],ticket:'T6'});
  const sk=socks[0];sk.sent.length=0;
  const pbuf=NP.encodePose({seq:1,t:1,flags:0,head:{p:[0,1.6,0],q:[0,0,0,1]}});
  ok(N.sendPose(pbuf)===true&&sk.sent.length===1&&sk.sent[0]===pbuf,'поза уходит двоичным кадром');
  ok(N.sendPose(pbuf)===false,'поза чаще частоты (20 Гц) отбрасывается');
  T+=60;ok(N.sendPose(pbuf)===true,'через 60 мс — снова можно');
  T+=60;sk.bufferedAmount=20000;ok(N.sendPose(pbuf)===false,'очередь сокета > 16 КБ — поза отбрасывается (свежая важнее)');
  sk.bufferedAmount=0;
  ok(N.send({t:'room',id:'chem'})===true&&sentOf(sk).some(m=>m.t==='room'),'управляющее сообщение уходит JSON');
  ok(N.send({t:'x',pad:'я'.repeat(2100)})===false&&evs('err').some(e=>e.code==='big'),'сообщение > 2 КБ не отправляется, ошибка big');
  ok(N.send(null)===false&&N.send({k:1})===false&&N.send('строка')===false,'не объект или без t — отказ');

  /* ---------- обрыв, resume, очередь ---------- */
  ev.length=0;
  const first=socks.length;
  sk.drop(1006);
  ok(N.status().state==='resuming','обрыв → resuming');
  ok(N.send({t:'room',id:'math'})===false&&N.send({t:'ev',k:'point',on:true})===false&&N.send({t:'p',c:1})===false,'в обрыве: управление встаёт в очередь, указка и пинг не копятся');
  for(let i=0;i<60;i++)N.send({t:'room',id:'r'+i});
  await adv(499);ok(socks.length===first,'первая попытка не раньше 0,5 с');
  await adv(2);
  ok(socks.length===first+1,'через 0,5 с — повторное подключение');
  const rc=socks[first],hr=sentOf(rc)[0];
  ok(hr.resume==='RES'+first&&!('ticket' in hr),'сначала resume, билета нет');
  await adv(10);
  ok(N.status().state==='on'&&evs('resumed').length===1&&evs('resumed')[0].resume===true,'место возвращено: on, событие resumed');
  const rooms=sentOf(rc).filter(m=>m.t==='room');
  ok(rooms.length===50&&rooms[0].id==='r10'&&rooms[49].id==='r59','очередь ≤ 50: старое выброшено, порядок сохранён, отправлена после возврата');
  ok(N.resumeToken()===('RES'+(first+1)),'токен обновлён');
  /* расписание попыток: 0,5 / 1 / 2 / 4 / 8 / 8 с (локальный адрес ждёт открытия 1,5 с перед следующей попыткой) */
  rc.drop(1006);
  const stamps=[];const tDrop=T;
  script=()=>{stamps.push(T);return{open:false};};
  await adv(120000);
  const gaps=stamps.map((t,i)=>i===0?t-tDrop:t-stamps[i-1]-1500);
  ok(gaps.slice(0,6).join()==='500,1000,2000,4000,8000,8000','расписание попыток 0,5 / 1 / 2 / 4 / 8 / 8 с ('+gaps.slice(0,6)+')');
  N.close('t',true);

  /* случайный разброс ±30% */
  reset();script=()=>({open:true,off:0});
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TJ'});
  const spread=[];
  for(const r of [0,1]){N._env.rnd=()=>r;socks[socks.length-1].drop(1006);const b=socks.length;let w2=0;
    while(socks.length===b&&w2<5000){await adv(10);w2+=10;}spread.push(w2);
    await adv(50);}
  N._env.rnd=()=>.5;
  ok(spread[0]>=345&&spread[0]<=360&&spread[1]>=640&&spread[1]<=660,'разброс: при rnd=0 → 350 мс, при rnd=1 → 650 мс ('+spread+')');
  N.close('t',true);

  /* ---------- resume отклонён → needTicket → новый билет ---------- */
  reset();script=()=>({open:true,off:0});
  ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TA'});
  script=()=>({open:true,close:{code:4001}});
  socks[0].drop(1006);await adv(600);await adv(20);
  ok(evs('needTicket').length===1&&N.status().state==='resuming'&&N.resumeToken()===null,'resume отклонён (4001) → просим новый билет, токен забыт');
  await adv(30000);
  ok(evs('needTicket').length===1&&socks.length===2,'пока билета нет, на hub не стучимся и просим один раз');
  script=()=>({open:true,off:0});
  const nb=socks.length;
  ok(N.useTicket('TB',[{url:'wss://c2/ws',kind:'center'}])===true,'useTicket принят');
  await adv(10);
  ok(socks.length===nb+1&&socks[nb].url==='wss://c2/ws'&&sentOf(socks[nb])[0].ticket==='TB'&&N.status().state==='on','новый билет → вход на (возможно новый) адрес');
  N.close('t',true);

  /* долгий обрыв: resume просрочен (> 120 с) → сразу просим билет, resume не шлём */
  reset();script=()=>({open:true,off:0});
  ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TC'});
  script=()=>({open:false});
  socks[0].drop(1006);
  await adv(130000);
  ok(evs('needTicket').length===1,'обрыв дольше 120 с → needTicket (resume больше не пробуем)');
  N.close('t',true);

  /* ---------- фатальные коды ---------- */
  for(const code of [4011,4012,4013,4014,4003,4015]){
    reset();script=()=>({open:true,off:0});ev.length=0;
    await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TF'+code});
    const before=socks.length;
    socks[0].drop(code);
    await adv(60000);
    const cl=evs('closed');
    ok(cl.length===1&&cl[0].code===code&&cl[0].fatal===true&&N.status().state==='off'&&socks.length===before&&N.resumeToken()===null,'код '+code+': закрыто насовсем, переподключения нет');
  }
  reset();script=()=>({open:true,off:0});ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'T8'});
  socks[0].drop(4008);await adv(700);
  ok(N.status().state==='on'&&socks.length===2,'4008 (медленный клиент) → возвращаемся по resume');
  /* билет отклонён после запроса нового → конец */
  reset();script=()=>({open:true,off:0});ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'T9'});
  script=()=>({open:true,close:{code:4001}});socks[0].drop(1006);await adv(700);
  script=()=>({open:true,close:{code:4001}});
  N.useTicket('EXPIRED');await adv(20);
  ok(evs('closed').length===1&&evs('closed')[0].code===4001&&N.status().state==='off','новый билет тоже отклонён → конец, без бесконечных попыток');

  /* ---------- закрытие пользователем ---------- */
  reset();script=()=>({open:true,off:0});ev.length=0;
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TZ'});
  socks[0].drop(1006);
  N.close('user');
  const cnt=socks.length;await adv(60000);
  ok(socks.length===cnt&&N.status().state==='off'&&timers.size===0,'close во время обрыва: попыток нет, таймеров не осталось');
  reset();script=()=>({open:true,off:0});
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TQ'});
  const old=socks[0];
  await N.connect({hubs:[{url:'wss://c/ws',kind:'center'}],ticket:'TQ2'});
  ok(old.readyState===3&&socks.length===2&&N.status().state==='on','повторный connect закрывает прежнее соединение');
  old.drop(1006);await adv(60000);
  ok(socks.length===2,'события старого соединения новое не трогают');

  /* ---------- закон А2 ---------- */
  const src=fs.readFileSync(path.join(ROOT,'js/net.js'),'utf8');
  ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/.test(src),'net.js: ни HTTP, ни хранилищ браузера');
  console.log(fails?('\nПРОВАЛЕНО: '+fails):'\nВсе проверки пройдены');
  process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL: исключение в тесте',e&&e.stack||e);process.exit(2);});

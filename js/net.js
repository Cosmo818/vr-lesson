/* net.js — живое соединение с hub урока (шаг Н6, PLAN-network.md §6.1–6.2, протокол — docs/NET_PROTOCOL.md).
   Закон А2 (docs/LAWS.md): единственный модуль живых соединений. Здесь нет HTTP-запросов, нет записи в хранилища браузера, нет обращений к хранилищу данных, приложению, комнатам и движку:
   билет приносит вызывающий, токен возобновления живёт только в памяти (net.resumeToken() — вызывающий сам решает, куда его положить), новый билет после обрыва
   запрашивается событием 'needTicket' и отдаётся в net.useTicket().
   Контракт: connect({hubs:[{url,kind:'local'|'center'}], ticket|resume, caps}) → Promise<welcome>; close(why); sendPose(ArrayBuffer); send(obj); on/off(type, fn);
   now() — время hub, мс; status() → {state:'off'|'connecting'|'on'|'resuming', rtt, hz, hub}. События: welcome, roster {op:'+'|'-'|'~'|'away'|'room'}, poses {tick,srv,items,at}, ev, sess,
   chat, g, bc, state, err {code,msg}, closed {code,fatal,why}, needTicket, resumed, status. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const NP=VR.netproto;
const PV=1,HELLO_MS=5000,OPEN_LOCAL=1500,OPEN_CENTER=8000,QMAX=50,TEXT_MAX=2000;
const DELAYS=[500,1000,2000,4000,8000];
const FATAL={4003:1,4011:1,4012:1,4013:1,4014:1,4015:1};      /* возвращаться бессмысленно */
const env={
  WS:null,now:()=>(typeof performance!=='undefined'?performance.now():Date.now()),
  st:(f,ms)=>setTimeout(f,ms),ct:t=>clearTimeout(t),rnd:Math.random
};
const Sx={
  state:'off',hub:null,ws:null,opts:null,resume:null,welcome:null,gen:0,userClosed:false,attempt:0,dropT:0,hold:120,
  timer:null,pingT:null,pingN:0,queue:[],lastPose:0,needSent:false,waitTicket:false
};
const clock={pairs:[],off:null,target:null,last:0,rtt:0};
const H={};
function emit(type,a){const l=H[type];if(!l)return;for(const f of l.slice()){try{f(a);}catch(e){try{console.error('net handler',type,e);}catch(_){}}}}
function setState(s){if(Sx.state!==s){Sx.state=s;emit('status',status());}}
function hubKind(){return Sx.hub&&Sx.hub.kind==='local'?'local':'center';}
function poseHz(){return hubKind()==='local'?20:15;}

/* ---- часы §6.2: пара с минимальным RTT из 8 последних, сглаживание ≤ 5 мс/с ---- */
function pong(c,s){
  const tr=env.now(),rtt=tr-c;
  if(typeof c!=='number'||typeof s!=='number'||!isFinite(rtt)||rtt<0||rtt>5000)return;
  clock.pairs.push({rtt,off:s-(c+tr)/2});if(clock.pairs.length>8)clock.pairs.shift();
  let b=clock.pairs[0];for(const p of clock.pairs)if(p.rtt<b.rtt)b=p;
  clock.target=b.off;clock.rtt=b.rtt;
  if(clock.off===null){clock.off=b.off;clock.last=tr;}
}
function now(){
  const t=env.now();
  if(clock.off===null)return t;
  const dt=Math.max(0,t-clock.last);clock.last=t;
  const d=clock.target-clock.off,step=.005*dt;
  clock.off+=Math.abs(d)<=step?d:Math.sign(d)*step;
  return t+clock.off;
}
function startPings(){
  stopPings();Sx.pingN=0;
  const tick=()=>{
    if(Sx.state!=='on'||!Sx.ws)return;
    rawSend({t:'p',c:env.now()});Sx.pingN++;
    Sx.pingT=env.st(tick,Sx.pingN<10?1000:5000);
  };
  tick();
}
function stopPings(){if(Sx.pingT){env.ct(Sx.pingT);Sx.pingT=null;}}

/* ---- отправка ---- */
function rawSend(o){
  const ws=Sx.ws;
  if(!ws||ws.readyState!==1)return false;
  try{ws.send(JSON.stringify(o));return true;}catch(e){return false;}
}
function send(o){
  if(!o||typeof o!=='object'||typeof o.t!=='string')return false;
  let raw;try{raw=JSON.stringify(o);}catch(e){return false;}
  if(raw.length>TEXT_MAX){emit('err',{code:'big',msg:'сообщение больше 2 КБ'});return false;}
  if(Sx.state==='on'&&Sx.ws&&Sx.ws.readyState===1&&(Sx.ws.bufferedAmount||0)<65536){try{Sx.ws.send(raw);return true;}catch(e){}}
  if(o.t==='p'||(o.t==='ev'&&(o.k==='point'||o.k==='react')))return false;      /* устаревшее не копим */
  Sx.queue.push(raw);while(Sx.queue.length>QMAX)Sx.queue.shift();
  return false;
}
function flush(){
  while(Sx.queue.length&&Sx.ws&&Sx.ws.readyState===1&&(Sx.ws.bufferedAmount||0)<65536){
    const r=Sx.queue.shift();try{Sx.ws.send(r);}catch(e){break;}
  }
}
function sendPose(buf){
  const ws=Sx.ws;
  if(Sx.state!=='on'||!ws||ws.readyState!==1||!buf)return false;
  const t=env.now();
  if(t-Sx.lastPose<1000/poseHz()-1)return false;
  if((ws.bufferedAmount||0)>16384)return false;
  try{ws.send(buf);Sx.lastPose=t;return true;}catch(e){return false;}
}

/* ---- входящие ---- */
function onMessage(ev){
  const d=ev.data;
  if(typeof d!=='string'){
    const b=NP.decodeBatch(d);
    if(b)emit('poses',{tick:b.tick,srv:b.srv,items:b.items,at:env.now()});
    return;
  }
  let m;try{m=JSON.parse(d);}catch(e){return;}
  if(!m||typeof m.t!=='string')return;
  switch(m.t){
    case 'P':pong(m.c,m.s);break;
    case 'welcome':break;
    case 'roster+':emit('roster',Object.assign({op:'+'},m));break;
    case 'roster-':emit('roster',Object.assign({op:'-'},m));break;
    case 'roster~':emit('roster',Object.assign({op:'~'},m));break;
    case 'away':emit('roster',Object.assign({op:'away'},m));break;
    case 'room':emit('roster',Object.assign({op:'room'},m));break;
    case 'err':emit('err',m);break;
    default:emit(m.t,m);
  }
}

/* ---- соединение ---- */
function normHubs(h){
  const out=[];
  for(const x of Array.isArray(h)?h:[]){
    const u=typeof x==='string'?x:x&&x.url;
    if(typeof u==='string'&&/^wss?:\/\//.test(u))out.push({url:u,kind:x&&x.kind==='local'?'local':'center'});
  }
  return out;
}
/* одна попытка к одному адресу: resolve({ws,welcome}), reject({phase:'open'|'hello', code, msg}) */
function tryHub(h,auth){
  return new Promise((res,rej)=>{
    let ws,done=false,t1=null,t2=null,opened=false;
    const stop=()=>{if(t1)env.ct(t1);if(t2)env.ct(t2);t1=t2=null;};
    const fail=(phase,code,msg)=>{
      if(done)return;done=true;stop();
      try{ws.onopen=ws.onmessage=ws.onclose=ws.onerror=null;ws.close();}catch(e){}
      rej({phase,code:code||0,msg:msg||''});
    };
    try{ws=new env.WS(h.url);}catch(e){return rej({phase:'open',code:0,msg:'адрес'});}
    ws.binaryType='arraybuffer';
    t1=env.st(()=>fail('open',0,'таймаут'),h.kind==='local'?OPEN_LOCAL:OPEN_CENTER);
    ws.onerror=()=>{};
    ws.onopen=()=>{
      opened=true;if(t1){env.ct(t1);t1=null;}
      t2=env.st(()=>fail('hello',0,'нет welcome'),HELLO_MS);
      const o=Sx.opts||{};
      const hello=Object.assign({t:'hello',pv:PV,app:o.app||'vr-lesson',caps:o.caps||{}},auth);
      try{ws.send(JSON.stringify(hello));}catch(e){fail('hello',0,'отправка');}
    };
    ws.onmessage=ev=>{
      if(done||typeof ev.data!=='string')return;
      let m;try{m=JSON.parse(ev.data);}catch(e){return;}
      if(m&&m.t==='welcome'){done=true;stop();res({ws,welcome:m});}
      else if(m&&m.t==='err')emit('err',m);
    };
    ws.onclose=ev=>fail(opened?'hello':'open',ev&&ev.code,'закрыто');
  });
}
async function openAny(auth,gen){
  let last={phase:'open',code:0,msg:'нет адресов'};
  for(const h of Sx.opts.hubs){
    if(gen!==Sx.gen)throw{phase:'cancel',code:0};
    try{const r=await tryHub(h,auth);r.hub=h;return r;}
    catch(e){last=e;if(e.phase==='hello')throw e;}                     /* дошли до hub, но вход отклонён: билет мог уйти — следующий адрес не пробуем */
  }
  throw last;
}
function attach(r){
  Sx.ws=r.ws;Sx.hub=r.hub;Sx.welcome=r.welcome;
  Sx.resume=typeof r.welcome.resume==='string'?r.welcome.resume:Sx.resume;
  Sx.hold=+r.welcome.hold>0?+r.welcome.hold:120;Sx.attempt=0;Sx.needSent=false;Sx.waitTicket=false;Sx.lastPose=0;
  const gen=Sx.gen;
  r.ws.onmessage=onMessage;
  r.ws.onclose=ev=>{if(gen===Sx.gen)onDrop(ev&&ev.code);};
  r.ws.onerror=()=>{};
  setState('on');startPings();flush();
}
function onDrop(code){
  const ws=Sx.ws;Sx.ws=null;stopPings();
  try{if(ws){ws.onmessage=ws.onclose=null;ws.close();}}catch(e){}
  if(Sx.userClosed){setState('off');return;}
  if(FATAL[code]){fatal(code,'hub');return;}
  Sx.dropT=env.now();setState('resuming');schedule();
}
function fatal(code,why){
  Sx.gen++;if(Sx.timer){env.ct(Sx.timer);Sx.timer=null;}
  Sx.resume=null;Sx.queue=[];setState('off');emit('closed',{code,fatal:true,why});
}
function schedule(){
  if(Sx.timer)env.ct(Sx.timer);
  const d=DELAYS[Math.min(Sx.attempt,DELAYS.length-1)]*(.7+.6*env.rnd());Sx.attempt++;
  const gen=Sx.gen;
  Sx.timer=env.st(()=>{Sx.timer=null;if(gen===Sx.gen)reconnect();},d);
}
function wantTicket(){
  Sx.resume=null;Sx.waitTicket=true;
  if(!Sx.needSent){Sx.needSent=true;emit('needTicket',{});}
}
async function reconnect(){
  if(Sx.userClosed||!Sx.opts)return;
  const gen=Sx.gen;
  const fresh=Sx.resume&&(env.now()-Sx.dropT)<Sx.hold*1000;
  if(!fresh&&Sx.resume)Sx.resume=null;
  if(!Sx.resume&&!Sx.opts.ticket){wantTicket();return;}                   /* билет одноразовый и живёт 60 с — нужен новый */
  const auth=Sx.resume?{resume:Sx.resume}:{ticket:Sx.opts.ticket};
  const usedTicket=!Sx.resume;if(usedTicket)Sx.opts.ticket=null;
  try{
    const r=await openAny(auth,gen);
    if(gen!==Sx.gen){try{r.ws.close();}catch(e){}return;}
    attach(r);emit('welcome',r.welcome);emit('resumed',{resume:!usedTicket});
  }catch(e){
    if(gen!==Sx.gen)return;
    if(e.phase==='hello'&&FATAL[e.code])return fatal(e.code,'hello');
    if(e.phase==='hello'&&e.code===4001){
      if(usedTicket)return fatal(4001,'ticket');
      wantTicket();return;                                               /* resume не принят (место ушло) — новый билет */
    }
    schedule();
  }
}
function connect(o){
  close('reconnect',true);
  o=o||{};
  const hubs=normHubs(o.hubs);
  Sx.gen++;Sx.userClosed=false;Sx.opts={hubs,ticket:o.ticket||null,caps:o.caps||{},app:o.app};
  Sx.resume=typeof o.resume==='string'?o.resume:null;Sx.attempt=0;Sx.needSent=false;Sx.waitTicket=false;Sx.queue=[];
  clock.pairs=[];clock.off=clock.target=null;
  const gen=Sx.gen;
  if(!hubs.length)return Promise.reject({code:0,msg:'нет адресов hub'});
  if(!Sx.resume&&!Sx.opts.ticket)return Promise.reject({code:4001,msg:'нет билета'});
  setState('connecting');
  const auth=Sx.resume?{resume:Sx.resume}:{ticket:Sx.opts.ticket};
  if(!Sx.resume)Sx.opts.ticket=null;
  return openAny(auth,gen).then(r=>{
    if(gen!==Sx.gen){try{r.ws.close();}catch(e){}throw{code:0,msg:'отменено'};}
    attach(r);emit('welcome',r.welcome);return r.welcome;
  },e=>{
    if(gen===Sx.gen){Sx.gen++;setState('off');}
    throw{code:e&&e.code||0,msg:e&&e.msg||'нет связи с hub',phase:e&&e.phase};
  });
}
/* новый билет после 'needTicket' (или повторный вход) */
function useTicket(ticket,hubs){
  if(!Sx.opts||Sx.userClosed||typeof ticket!=='string')return false;
  Sx.opts.ticket=ticket;
  if(hubs){const h=normHubs(hubs);if(h.length)Sx.opts.hubs=h;}
  if(Sx.waitTicket&&Sx.state!=='on'){Sx.waitTicket=false;Sx.needSent=false;Sx.attempt=0;if(Sx.timer){env.ct(Sx.timer);Sx.timer=null;}reconnect();}
  return true;
}
function close(why,quiet){
  const was=Sx.state!=='off';
  Sx.userClosed=true;Sx.gen++;
  if(Sx.timer){env.ct(Sx.timer);Sx.timer=null;}
  stopPings();
  const ws=Sx.ws;Sx.ws=null;
  if(ws){try{ws.onmessage=ws.onclose=null;if(ws.readyState===1)ws.send(JSON.stringify({t:'bye'}));ws.close(1000);}catch(e){}}
  Sx.queue=[];Sx.waitTicket=false;Sx.needSent=false;
  if(Sx.state!=='off'){Sx.state='off';if(!quiet)emit('status',status());}
  if(was&&!quiet)emit('closed',{code:1000,fatal:true,why:why||'close'});
}
function status(){return{state:Sx.state,rtt:Math.round(clock.rtt||0),hz:poseHz(),hub:Sx.hub?hubKind():null};}
function on(t,f){(H[t]||(H[t]=[])).push(f);}
function off(t,f){const l=H[t];if(!l)return;const i=l.indexOf(f);if(i>=0)l.splice(i,1);}

VR.net={connect,close,sendPose,send,on,off,now,status,useTicket,
  resumeToken:()=>Sx.resume,welcome:()=>Sx.welcome,
  _env:env,_clock:clock,_state:Sx};
if(typeof WebSocket!=='undefined')env.WS=WebSocket;
})();

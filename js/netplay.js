/* netplay.js — аватары других участников по сети (шаг Н7а, PLAN-network.md §6.3–6.4). Слой «модули».
   Принимает пачки поз из VR.net, ведёт буфер из 8 снимков на место, рисует аватары через E.peers (engine.js),
   отправляет свою позу с частотой net.status().hz. Кадровый вызов — E.onFrameSub (движок зовёт после hooks.onFrame, и в шлеме, и за столом).
   Позы head/hl/hr — в мировых координатах; phys {x,z,yaw} — физическое положение в local-floor отправителя.
   Чистые функции (без DOM и сети) — VR.netplay._pure, их проверяет tests/netplay.js. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const BUF=8,EXTRA_MS=100,PHYS_MS=300,LABELS=8,POOL=12,STALE_MS=3000;
const PALETTE=[[.95,.35,.35],[.95,.62,.25],[.95,.85,.3],[.55,.85,.35],[.25,.8,.55],[.25,.8,.85],
  [.35,.6,.95],[.55,.45,.95],[.8,.45,.95],[.95,.45,.75],[.7,.7,.7],[.6,.45,.3]];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------- чистые функции ---------- */
function lerp3(a,b,u){return[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u];}
function qnorm(q){const n=Math.hypot(q[0],q[1],q[2],q[3]);return n<1e-9?[0,0,0,1]:[q[0]/n,q[1]/n,q[2]/n,q[3]/n];}
function slerp(a,b,u){
  let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  b=d<0?[-b[0],-b[1],-b[2],-b[3]]:b;d=Math.abs(d);
  if(d>.9995)return qnorm([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u,a[3]+(b[3]-a[3])*u]);
  const th=Math.acos(clamp(d,-1,1)),s=Math.sin(th),k0=Math.sin((1-u)*th)/s,k1=Math.sin(u*th)/s;
  return qnorm([a[0]*k0+b[0]*k1,a[1]*k0+b[1]*k1,a[2]*k0+b[2]*k1,a[3]*k0+b[3]*k1]);
}
const mixPose=(a,b,u)=>({p:lerp3(a.p,b.p,u),q:slerp(a.q,b.q,u)});
const copyPose=a=>a?{p:a.p.slice(),q:a.q.slice()}:null;
function mixHand(a,b,u){
  if(a&&b)return mixPose(a,b,u);
  return copyPose(u<.5?(a||b):(b||a));
}
/* экстраполяция позиции: скорость по двум последним снимкам, не быстрее maxV м/с */
function extraPose(a,b,dtMs,exMs,maxV){
  if(!a||!b||dtMs<=0)return copyPose(b||a);
  const k=exMs/dtMs,v=[(b.p[0]-a.p[0]),(b.p[1]-a.p[1]),(b.p[2]-a.p[2])],len=Math.hypot(v[0],v[1],v[2]);
  let f=k;if(len/dtMs*1000>maxV)f=k*maxV/(len/dtMs*1000);
  return{p:[b.p[0]+v[0]*f,b.p[1]+v[1]*f,b.p[2]+v[2]*f],q:b.q.slice()};
}
/* поза в момент T (мс hub) из буфера снимков {t,head,hl,hr}, отсортированного по t. Нет данных дальше T — до exMs по скорости, потом стоим */
function sampleAt(buf,T,exMs){
  const n=buf.length;if(!n)return null;
  if(exMs===undefined)exMs=EXTRA_MS;
  const f=buf[0],l=buf[n-1];
  if(T<=f.t)return{head:copyPose(f.head),hl:copyPose(f.hl),hr:copyPose(f.hr)};
  if(T>=l.t){
    if(n<2||T===l.t)return{head:copyPose(l.head),hl:copyPose(l.hl),hr:copyPose(l.hr)};
    const p=buf[n-2],dt=l.t-p.t,ex=Math.min(T-l.t,exMs);
    return{head:extraPose(p.head,l.head,dt,ex,10),hl:extraPose(p.hl,l.hl,dt,ex,12),hr:extraPose(p.hr,l.hr,dt,ex,12)};
  }
  let i=0;while(i<n-2&&buf[i+1].t<=T)i++;
  const a=buf[i],b=buf[i+1],u=b.t>a.t?(T-a.t)/(b.t-a.t):1;
  return{head:mixPose(a.head,b.head,u),hl:mixHand(a.hl,b.hl,u),hr:mixHand(a.hr,b.hr,u)};
}
function percentile95(arr){
  if(!arr.length)return 0;
  const s=arr.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(.95*s.length)-1)];
}
/* задержка отрисовки D, мс: 1,5·такт + джиттер95, в [60,250] */
const delayTarget=(tickMs,jit95)=>clamp(1.5*(tickMs||50)+(jit95||0),60,250);
/* D меняется плавно: не быстрее 30 мс за секунду */
function smoothD(cur,target,dtSec){
  if(cur===null||cur===undefined||!isFinite(cur))return target;
  const st=30*Math.max(0,dtSec);return Math.abs(target-cur)<=st?target:cur+Math.sign(target-cur)*st;
}
const fullLimit=(quest1,heavy)=>quest1?(heavy?6:12):Infinity;
/* items [{slot,d}] → Set мест, которые рисуются полными: ближайшие limit */
function pickFull(items,limit){
  const s=items.slice().sort((a,b)=>a.d-b.d||a.slot-b.slot),out=new Set();
  for(let i=0;i<s.length&&i<limit;i++)out.add(s[i].slot);
  return out;
}
/* «Иван Петров» → «Иван П.»; «Иван П.» остаётся как есть */
function shortName(n){
  n=String(n||'').replace(/\s+/g,' ').trim();if(!n)return'';
  const p=n.split(' '),first=p[0].slice(0,16);
  if(p.length<2)return first;
  const c=Array.from(p[1])[0]||'';
  return c?first+' '+c.toUpperCase()+'.':first;
}
const labelText=(name,desk)=>{const s=shortName(name)||'?';return desk?s+' · за экраном':s;};
/* бледнение: ближе 0,5 м к моей голове — alpha вниз до 0,15 (при ≤ 0,25 м) */
const fadeTarget=d=>d>=.5?1:.15+.85*clamp((d-.25)/.25,0,1);
const fadeStep=(cur,target,dt)=>cur+(target-cur)*Math.min(1,Math.max(0,dt)*8);
function colorOf(c,slot){
  if(Array.isArray(c)&&c.length>=3&&c.every(v=>typeof v==='number')){const k=c.some(v=>v>1)?1/255:1;return[clamp(c[0]*k,0,1),clamp(c[1]*k,0,1),clamp(c[2]*k,0,1)];}
  if(typeof c==='string'&&/^#?[0-9a-f]{6}$/i.test(c)){const h=c.replace('#','');return[parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];}
  if(typeof c==='number'&&isFinite(c))return PALETTE[((c|0)%12+12)%12].slice();
  return PALETTE[(((slot|0)%12)+12)%12].slice();
}
/* физическое положение соседа без задержки: последний снимок + скорость × (возраст + RTT/2), не дальше 0,3 с */
function physPredict(prev,last,nowT,rtt){
  if(!last||!last.phys)return null;
  const ph=last.phys;let vx=0,vz=0;
  if(prev&&prev.phys&&last.t>prev.t){const dt=last.t-prev.t;vx=(ph.x-prev.phys.x)/dt;vz=(ph.z-prev.phys.z)/dt;
    const v=Math.hypot(vx,vz)*1000;if(v>5){vx*=5/v;vz*=5/v;}}
  const age=Math.max(0,nowT-last.t),dt=Math.min(PHYS_MS,age+(rtt||0)/2);
  return{x:ph.x+vx*dt,z:ph.z+vz*dt,yaw:ph.yaw,dt};
}
/* Quest 1: UA «Quest» без номера и контроллеры старого профиля (oculus-touch / -v2, не v3 / touch-plus / touch-pro) */
function detectQuest1From(profiles,ua){
  const pr=(profiles||[]).map(String);ua=String(ua||'');
  const uaQ1=/\bQuest\b(?!\s*(?:\d|Pro))/i.test(ua);
  const newer=pr.some(p=>/touch-plus|touch-pro|oculus-touch-v3|meta-quest/.test(p));
  const old=!pr.length||pr.some(p=>p==='oculus-touch'||p==='oculus-touch-v2');
  return uaQ1&&!newer&&old;
}
function matQuat(m){
  const m00=m[0],m10=m[1],m20=m[2],m01=m[4],m11=m[5],m21=m[6],m02=m[8],m12=m[9],m22=m[10],tr=m00+m11+m22;
  let x,y,z,w,s;
  if(tr>0){s=Math.sqrt(tr+1)*2;w=s/4;x=(m21-m12)/s;y=(m02-m20)/s;z=(m10-m01)/s;}
  else if(m00>m11&&m00>m22){s=Math.sqrt(1+m00-m11-m22)*2;w=(m21-m12)/s;x=s/4;y=(m01+m10)/s;z=(m02+m20)/s;}
  else if(m11>m22){s=Math.sqrt(1+m11-m00-m22)*2;w=(m02-m20)/s;x=(m01+m10)/s;y=s/4;z=(m12+m21)/s;}
  else{s=Math.sqrt(1+m22-m00-m11)*2;w=(m10-m01)/s;x=(m02+m20)/s;y=(m12+m21)/s;z=s/4;}
  return qnorm([x,y,z,w]);
}

/* ---------- состояние ---------- */
const env={now:()=>(typeof performance!=='undefined'?performance.now():Date.now())};
const S={on:false,E:null,net:null,opts:{},me:-1,roster:{},bufs:{},alpha:{},hide:false,seq:0,lastSend:0,
  D:null,tickMs:50,lastSrv:0,lastAt:0,dev:[],quest1:false,frame:0,pool:[],hs:[]};

function onWelcome(w){
  S.me=w&&typeof w.slot==='number'?w.slot:-1;S.roster={};S.bufs={};S.alpha={};
  for(const r of(w&&w.roster)||[])if(r&&typeof r.slot==='number')S.roster[r.slot]=Object.assign({},r);
  if(w&&w.hz)S.tickMs=1000/w.hz;
}
function onRoster(m){
  if(!m||typeof m.slot!=='number')return;
  const s=m.slot;
  if(m.op==='-'){delete S.roster[s];delete S.bufs[s];delete S.alpha[s];return;}
  if(m.op==='away'){const r=S.roster[s];if(r)r.away=m.on===undefined?true:!!m.on;return;}
  const o=Object.assign({},S.roster[s]||{},m);delete o.op;delete o.t;
  if(m.op==='+'||m.op==='~')o.away=false;
  S.roster[s]=o;
}
function onPoses(ev){
  if(!ev||!ev.items)return;
  if(S.lastSrv&&ev.srv>S.lastSrv&&ev.srv-S.lastSrv<500){
    const dtS=ev.srv-S.lastSrv;S.tickMs=S.tickMs*.8+dtS*.2;
    if(typeof ev.at==='number'&&S.lastAt)S.dev.push(Math.abs((ev.at-S.lastAt)-dtS));
    while(S.dev.length>60)S.dev.shift();
  }
  S.lastSrv=ev.srv;if(typeof ev.at==='number')S.lastAt=ev.at;
  for(const it of ev.items){
    if(it.slot===S.me||!S.roster[it.slot])continue;
    const b=S.bufs[it.slot]||(S.bufs[it.slot]=[]),t=ev.srv-(it.age||0);
    if(b.length&&t<=b[b.length-1].t)continue;
    b.push({t,head:it.head,hl:it.flags&1?it.left:null,hr:it.flags&2?it.right:null,flags:it.flags,phys:it.phys});
    while(b.length>BUF)b.shift();
  }
}
function onClosed(){S.roster={};S.bufs={};S.alpha={};S.me=-1;if(S.E)S.E.peers=[];}

/* ---------- свои позы ---------- */
function sendOwn(){
  const E=S.E,net=S.net;
  if(!E||!net||!VR.netproto)return;
  const st=net.status();if(!st||st.state!=='on')return;
  const t=env.now();if(t-S.lastSend<1000/(st.hz||20)-1)return;
  let hd;try{hd=E.headWorld();}catch(e){return;}
  if(!hd)return;
  const H=E.H||[],hs=[0,1].map(i=>{const h=H[i];return h&&h.has&&h.g?{p:[h.g[12],h.g[13],h.g[14]],q:matQuat(h.g)}:null;});
  let phys={x:0,z:0,yaw:0};
  try{const ri=E.rigInfo();if(ri.xr){const b=E.toBase(hd.p[0],hd.p[2]);phys={x:b[0],z:b[1],yaw:ri.yaw};}}catch(e){}
  const flags=(hs[0]?1:0)|(hs[1]?2:0)|(E.session?4:0)|(E.menuOpen?32:0)|((H[0]&&H[0].held)||(H[1]&&H[1].held)?64:0);
  const buf=VR.netproto.encodePose({seq:S.seq++,t:Math.floor(net.now()),flags,head:hd,left:hs[0],right:hs[1],phys});
  if(net.sendPose(buf))S.lastSend=t;
}

/* ---------- подписи: свой пул 12 текстур ---------- */
function paintLabel(slot,text){
  const E=S.E;
  try{
    const gl=E.gl,cv=document.createElement('canvas');cv.width=256;cv.height=64;
    const c=cv.getContext('2d');
    c.fillStyle='#12192b';c.fillRect(0,0,256,64);c.strokeStyle='#5d7bd6';c.lineWidth=3;c.strokeRect(1.5,1.5,253,61);
    c.fillStyle='#fff';c.font='bold 30px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,128,34,240);
    if(!slot.tex)slot.tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,slot.tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv);gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    slot.text=text;return true;
  }catch(e){slot.text=null;return false;}
}
function labelTex(text){
  for(const s of S.pool)if(s.text===text){s.stamp=S.frame;return s.tex||null;}
  let free=null;
  if(S.pool.length<POOL){free={text:null,tex:null,stamp:0};S.pool.push(free);}
  else for(const s of S.pool)if(s.stamp<S.frame&&(!free||s.stamp<free.stamp))free=s;
  if(!free)return null;
  free.stamp=S.frame;
  return paintLabel(free,text)?free.tex:null;
}

/* ---------- кадр: сборка E.peers ---------- */
function update(dt){
  const E=S.E,net=S.net;
  S.frame++;
  const ids=Object.keys(S.roster).map(Number).filter(s=>s!==S.me&&!S.roster[s].away&&S.bufs[s]&&S.bufs[s].length);
  if(S.hide||!ids.length){E.peers=[];return;}
  const st=net.status(),now=net.now();
  S.D=smoothD(S.D,delayTarget(S.tickMs||(1000/(st.hz||20)),percentile95(S.dev)),dt);
  const T=now-S.D;
  let me;try{me=E.headWorld().p;}catch(e){me=[0,1.6,0];}
  const list=[];
  for(const s of ids){
    const b=S.bufs[s];
    if(now-b[b.length-1].t>STALE_MS)continue;
    const sm=sampleAt(b,T);if(!sm||!sm.head)continue;
    const hp=sm.head.p,d=Math.hypot(hp[0]-me[0],hp[1]-me[1],hp[2]-me[2]);
    const al=S.alpha[s]===undefined?fadeTarget(d):S.alpha[s];
    S.alpha[s]=fadeStep(al,fadeTarget(d),dt);
    const r=S.roster[s],desk=!(b[b.length-1].flags&4);
    list.push({slot:s,head:sm.head,hl:desk?null:sm.hl,hr:desk?null:sm.hr,col:colorOf(r.col,s),name:labelText(r.name,desk),alpha:S.alpha[s],full:false,desk,d,tex:null});
  }
  const full=pickFull(list.map(p=>({slot:p.slot,d:p.d})),fullLimit(S.quest1,heavyNow()));
  for(const p of list)p.full=full.has(p.slot);
  let nl=0;
  for(const p of list.slice().sort((a,b)=>a.d-b.d))if(p.full&&nl<LABELS&&p.alpha>=.3){p.tex=labelTex(p.name);nl++;}
  E.peers=list;
}
function heavyNow(){
  try{if(typeof S.opts.heavy==='function')return!!S.opts.heavy();}catch(e){}
  return!!(S.E&&S.E.room&&S.E.room.heavy);
}
function tick(dt){
  if(!S.on)return;
  try{sendOwn();}catch(e){}
  try{update(typeof dt==='number'&&dt>0?Math.min(dt,.25):.016);}catch(e){}
}

/* ---------- публичное ---------- */
function detectQuest1(E){
  try{
    const pr=[];for(const h of(E&&E.H)||[])if(h&&h.src&&h.src.profiles)for(const p of h.src.profiles)pr.push(p);
    return detectQuest1From(pr,typeof navigator!=='undefined'?navigator.userAgent:'');
  }catch(e){return false;}
}
function attach(E,net,opts){
  detach();
  S.E=E;S.net=net;S.opts=opts||{};S.on=true;S.frame=0;S.D=null;S.dev=[];S.lastSrv=0;S.lastAt=0;
  S.quest1=S.opts.quest1!==undefined?!!S.opts.quest1:detectQuest1(E);
  S.hs=[['welcome',onWelcome],['roster',onRoster],['poses',onPoses],['closed',onClosed]];
  for(const[t,f]of S.hs)net.on(t,f);
  if(typeof E.onFrameSub==='function')E.onFrameSub(tick);
  /* welcome мог прийти раньше attach */
  try{const w=net.welcome&&net.welcome();if(w&&S.me<0)onWelcome(w);}catch(e){}
}
function detach(){
  if(S.net)for(const[t,f]of S.hs)try{S.net.off(t,f);}catch(e){}
  if(S.E)S.E.peers=[];
  S.on=false;S.hs=[];S.E=null;S.net=null;S.roster={};S.bufs={};S.alpha={};S.me=-1;
}
/* физическое положение соседа сейчас (для колец): {x,z,yaw} в local-floor отправителя или null */
function physNow(slot){
  const b=S.bufs[slot];if(!b||!b.length||!S.net)return null;
  const st=S.net.status();
  return physPredict(b[b.length-2],b[b.length-1],S.net.now(),st&&st.rtt);
}
const hideAll=v=>{S.hide=!!v;if(S.hide&&S.E)S.E.peers=[];};
const hidden=()=>S.hide;

VR.netplay={attach,detach,tick,physNow,hideAll,hidden,detectQuest1,peerIds:()=>Object.keys(S.roster).map(Number),
  _env:env,_state:S,
  _pure:{slerp,lerp3,sampleAt,percentile95,delayTarget,smoothD,fullLimit,pickFull,shortName,labelText,fadeTarget,fadeStep,colorOf,physPredict,detectQuest1From,matQuat,PALETTE}};
})();

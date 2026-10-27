/* netproto.js — двоичные кадры поз (протокол сети, docs/NET_PROTOCOL.md): кодирование и разбор. Чистые функции: без сети, DOM и хранилища.
   Зеркало на сервере — server/netproto.py; одинаковые кадры проверяет tests/fixtures/net_frames.json. Порядок байтов — little-endian.
   Поза: {seq,t,flags,head:{p:[x,y,z] м,q:[x,y,z,w]},left:{p,q},right:{p,q},phys:{x,z,yaw}}.
   Кватернион — «три меньших»: самый большой по модулю компонент не передаётся (его индекс — в байте idx), остальные три — int16 = c·32767·√2. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const PV=1,T_POSE=1,T_BATCH=0x81,POSE_LEN=52,BODY_LEN=44,BATCH_HEAD=9,REC_LEN=2+BODY_LEN;
const S2=Math.SQRT2;
const clamp16=v=>v>32767?32767:v<-32768?-32768:v;
const q16=(v,k)=>{v=Number(v);if(!isFinite(v))v=0;return clamp16(Math.floor(v*k+.5));};
const mm=v=>q16(v,1000);
function quat(q){
  let x=+q[0],y=+q[1],z=+q[2],w=+q[3];
  const n=Math.hypot(x,y,z,w);
  if(!isFinite(n)||n<1e-9)return[0,0,0,1];
  return[x/n,y/n,z/n,w/n];
}
/* → {idx, c:[три int16]} */
function packQuat(q){
  q=quat(q);let m=0;
  for(let i=1;i<4;i++)if(Math.abs(q[i])>Math.abs(q[m]))m=i;
  const sg=q[m]<0?-1:1,c=[];
  for(let i=0;i<4;i++)if(i!==m)c.push(clamp16(Math.floor(sg*q[i]*32767*S2+.5)));
  return{idx:m,c};
}
function unpackQuat(idx,c){
  const k=1/(32767*S2),q=[0,0,0,0];let j=0,s=0;
  for(let i=0;i<4;i++)if(i!==idx){q[i]=c[j++]*k;s+=q[i]*q[i];}
  q[idx]=Math.sqrt(Math.max(0,1-s));
  return q;
}
const hand=h=>({p:h&&h.p?h.p:[0,0,0],q:h&&h.q?h.q:[0,0,0,1]});
/* тело позы (44 байта) начиная со смещения off: flags, idx, голова, левая, правая, физическая */
function putBody(dv,off,o){
  const hd=hand(o.head),lf=hand(o.left),rt=hand(o.right),ph=o.phys||{};
  const a=packQuat(hd.q),b=packQuat(lf.q),c=packQuat(rt.q);
  dv.setUint8(off,(o.flags|0)&255);
  dv.setUint8(off+1,a.idx|(b.idx<<2)|(c.idx<<4));
  let p=off+2;
  for(const k of hd.p.slice(0,3)){dv.setInt16(p,mm(k),true);p+=2;}
  for(const k of a.c){dv.setInt16(p,k,true);p+=2;}
  for(const[h,qq]of[[lf,b],[rt,c]]){
    for(const k of h.p.slice(0,3)){dv.setInt16(p,mm(k),true);p+=2;}
    for(const k of qq.c){dv.setInt16(p,k,true);p+=2;}
  }
  dv.setInt16(p,mm(ph.x),true);dv.setInt16(p+2,mm(ph.z),true);dv.setInt16(p+4,q16(ph.yaw,1e4),true);
}
function getBody(dv,off){
  const flags=dv.getUint8(off),ix=dv.getUint8(off+1);
  let p=off+2;
  const rd3=()=>{const v=[dv.getInt16(p,true),dv.getInt16(p+2,true),dv.getInt16(p+4,true)];p+=6;return v;};
  const hp=rd3().map(v=>v/1000),hq=unpackQuat(ix&3,rd3());
  const lp=rd3().map(v=>v/1000),lq=unpackQuat((ix>>2)&3,rd3());
  const rp=rd3().map(v=>v/1000),rq=unpackQuat((ix>>4)&3,rd3());
  const ph={x:dv.getInt16(p,true)/1000,z:dv.getInt16(p+2,true)/1000,yaw:dv.getInt16(p+4,true)/1e4};
  return{flags,head:{p:hp,q:hq},left:{p:lp,q:lq},right:{p:rp,q:rq},phys:ph};
}
function encodePose(o){
  const buf=new ArrayBuffer(POSE_LEN),dv=new DataView(buf);
  dv.setUint8(0,PV);dv.setUint8(1,T_POSE);dv.setUint16(2,(o.seq|0)&0xFFFF,true);dv.setUint32(4,(Number(o.t)||0)>>>0,true);
  putBody(dv,8,o);
  return buf;
}
/* → объект позы или null (не тот размер, версия или тип) */
function decodePose(buf){
  if(!buf||buf.byteLength!==POSE_LEN)return null;
  const dv=new DataView(buf);
  if(dv.getUint8(0)!==PV||dv.getUint8(1)!==T_POSE)return null;
  const o=getBody(dv,8);o.seq=dv.getUint16(2,true);o.t=dv.getUint32(4,true);
  return o;
}
/* пачка: {tick,srv,items:[{slot,age (мс),...поза}]} — до 255 записей */
function encodeBatch(b){
  const items=(b.items||[]).slice(0,255),buf=new ArrayBuffer(BATCH_HEAD+items.length*REC_LEN),dv=new DataView(buf);
  dv.setUint8(0,PV);dv.setUint8(1,T_BATCH);dv.setUint16(2,(b.tick|0)&0xFFFF,true);dv.setUint32(4,(Number(b.srv)||0)>>>0,true);dv.setUint8(8,items.length);
  items.forEach((it,i)=>{
    const off=BATCH_HEAD+i*REC_LEN;
    dv.setUint8(off,(it.slot|0)&255);dv.setUint8(off+1,Math.max(0,Math.min(255,Math.floor((Number(it.age)||0)/4+.5))));
    putBody(dv,off+2,it);
  });
  return buf;
}
function decodeBatch(buf){
  if(!buf||buf.byteLength<BATCH_HEAD)return null;
  const dv=new DataView(buf);
  if(dv.getUint8(0)!==PV||dv.getUint8(1)!==T_BATCH)return null;
  const n=dv.getUint8(8);
  if(buf.byteLength!==BATCH_HEAD+n*REC_LEN)return null;
  const items=[];
  for(let i=0;i<n;i++){const off=BATCH_HEAD+i*REC_LEN,it=getBody(dv,off+2);it.slot=dv.getUint8(off);it.age=dv.getUint8(off+1)*4;items.push(it);}
  return{tick:dv.getUint16(2,true),srv:dv.getUint32(4,true),items};
}
VR.netproto={PV,T_POSE,T_BATCH,POSE_LEN,BODY_LEN,REC_LEN,encodePose,decodePose,encodeBatch,decodeBatch,packQuat,unpackQuat};
})();

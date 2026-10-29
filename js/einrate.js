/* einrate.js — зачётная игра «Эйнштейн» на клиенте (PLAN-einstein.md Э8): сид с сервера, отправка решения, очередь «vrl.einq».
   К сети не обращается (закон А2): всё через VR.Store.ein*. Включается флагом einRating (школьный шлем) или привязанным устройством ученика
   (там флага школы нет — решает сервер: выключен → 404 → игра локальная). Код ученика сюда не попадает: у шлема школы в памяти только хэш (E.student.ph),
   на диск он не пишется. Очередь — без кода, ≤ 50 записей, старше 24 ч выбрасывается. */
(function(){
'use strict';
const VR=window.VR||(window.VR={});
const QK='vrl.einq',QMAX=50,QTTL=86400000;
const REASON={repeat:'Эту головоломку ты уже решал.',not_issued:'Эта головоломка не выдавалась для зачёта.',fast:'Слишком быстро для зачёта.',slow:'Слишком долго для зачёта.',
  expired:'Срок этой головоломки вышел.',superseded:'Тебе выдали новую головоломку: в зачёт идёт последняя.',helped:'С помощью — в зачёт не идёт.'};
const num=(x,a,b)=>{x=Number(x);return isFinite(x)?Math.max(a,Math.min(b,x)):a;};
/* кто играет: {sid,ph} — шлем школы; {stu:true} — сеанс привязанного устройства; null — гость, учитель, нет хэша кода */
function who(E){
  const s=E&&E.student;if(!s||!s.id)return null;
  if(s.bound)return{stu:true};
  return typeof s.ph==='string'&&s.ph?{sid:String(s.id),ph:s.ph}:null;
}
function flagOn(){try{return !!(VR.flags&&VR.flags.on('einRating'));}catch(e){return false;}}
/* показывать «вне рейтинга»: функция включена (флаг или привязанное устройство) */
function visible(E){return flagOn()||!!(E&&E.student&&E.student.bound);}
function enabled(E){const w=who(E);return !!w&&(w.stu===true||flagOn());}
function qLoad(){
  let a=null;try{a=JSON.parse(localStorage.getItem(QK)||'[]');}catch(e){}
  const t=Date.now(),out=[];if(!Array.isArray(a))return out;
  for(const x of a){
    if(!x||typeof x!=='object')continue;
    const sid=typeof x.sid==='string'&&/^[\w-]{1,60}$/.test(x.sid)?x.sid:'';
    if(!sid||!Number.isInteger(x.seed)||x.seed<0||x.seed>4294967295||!Number.isFinite(x.ts)||t-x.ts>QTTL||x.ts>t+60000)continue;
    out.push({sid,seed:x.seed,time:num(x.time,0,1e7),moves:num(x.moves,1,9999)|0,helped:x.helped?1:0,src:typeof x.src==='string'?x.src.slice(0,20):'',ts:x.ts});
  }
  return out.slice(-QMAX);
}
function qSave(a){try{localStorage.setItem(QK,JSON.stringify(a.slice(-QMAX)));}catch(e){}}
function qPush(sid,rec){
  const a=qLoad();
  if(a.some(x=>x.sid===String(sid)&&x.seed===rec.seed))return;   /* тот же номер уже ждёт отправки */
  a.push({sid:String(sid),seed:rec.seed,time:rec.time,moves:rec.moves,helped:rec.helped?1:0,src:String(rec.src||'').slice(0,20),ts:Date.now()});qSave(a);
}
function recOf(x){return{seed:x.seed,time:x.time,moves:x.moves,helped:x.helped,src:x.src};}
/* номер головоломки от сервера; null — нет связи, 404 (рейтинг выключен), гость: тогда играем локальным номером */
async function fetchSeed(E,src){
  const w=who(E);if(!w||!enabled(E))return null;
  let r;try{r=await VR.Store.einSeed(w,src);}catch(e){return null;}
  const d=r&&r.status===200?r.data:null;
  return d&&Number.isInteger(d.seed)&&d.seed>=0&&d.seed<=4294967295?d.seed:null;
}
/* отправка решения: {status:200,rated,reason?} | {queued:true} (нет связи — в очередь) | {dropped:true} (сервер не принимает) | {skip:true} */
async function submit(E,rec){
  const w=who(E);if(!w||!enabled(E))return{skip:true};
  let r;try{r=await VR.Store.einSolve(w,rec);}catch(e){r={status:0,data:{}};}
  if(r.status===200){const d=r.data||{};return{status:200,rated:!!d.rated,reason:typeof d.reason==='string'?d.reason:''};}
  if(r.status===400||r.status===404)return{status:r.status,dropped:true};
  qPush(E.student.id,rec);return{status:r.status,queued:true};
}
let flushing=false;
/* отправить очередь этого же ученика; останавливается на первой неудаче */
async function flush(E){
  const w=who(E);if(!w||!enabled(E)||flushing)return 0;
  flushing=true;let n=0;
  try{
    const sid=String(E.student.id);
    for(const x of qLoad().filter(q=>q.sid===sid)){
      let r;try{r=await VR.Store.einSolve(w,recOf(x));}catch(e){break;}
      if(r.status===200||r.status===400||r.status===404){qSave(qLoad().filter(q=>!(q.sid===x.sid&&q.seed===x.seed&&q.ts===x.ts)));n++;}
      else break;
    }
  }finally{flushing=false;}
  return n;
}
/* слова для сообщения после победы */
function say(res){
  if(!res||res.skip||res.dropped)return '';
  if(res.queued)return ' Нет связи: решение отправится в рейтинг позже.';
  if(res.rated)return ' В рейтинг засчитано.';
  return res.reason&&res.reason!=='helped'?' '+(REASON[res.reason]||'В рейтинг не засчитано.'):'';
}
VR.einrate={who,enabled,visible,fetchSeed,submit,flush,say,queue:qLoad,REASON};
})();

/* errors.js — журнал ошибок в памяти и «границы» вокруг разделов (ядро, без зависимостей).
   Постоянное хранение журнала появится с кабинетом суперадмина; сейчас — только память вкладки. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const buf=[],MAX=50;
function log(err,ctx){
  const entry={ts:Date.now(),module:String(ctx&&ctx.module||'?').slice(0,60),msg:String(err&&err.message||err).slice(0,300)};
  buf.push(entry);while(buf.length>MAX)buf.shift();
  try{console.error(entry.module,err);}catch(e){}
  return entry;
}
function guard(moduleName,fn,fallbackView){
  const fail=e=>{
    log(e,{module:moduleName});
    if(typeof fallbackView==='function')try{fallbackView(e);}catch(e2){}
    return undefined;
  };
  return function(...args){
    let r;
    try{r=fn.apply(this,args);}catch(e){return fail(e);}
    if(r&&typeof r.then==='function')return r.then(v=>v,fail);
    return r;
  };
}
VR.errors={log,list:()=>buf.slice(),guard,
  fallbackHTML:'Этот раздел временно недоступен. Обновите страницу; если не поможет — сообщите администратору.'};
})();

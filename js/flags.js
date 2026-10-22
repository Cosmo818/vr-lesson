/* flags.js — флаги функций (ядро). Значения лежат в settings.flags; менять их может только страница учителя.
   Store вызывается только во время работы, не при загрузке. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const FLAG_RE=/^[a-z][A-Za-z0-9_]{0,39}$/;
const DEFAULTS=Object.freeze({chemLab:true});
function cur(){const f=VR.Store.settings().flags;return f&&typeof f==='object'?f:{};}
VR.flags={
  DEFAULTS,
  on(name){
    try{const f=cur();return typeof f[name]==='boolean'?f[name]:DEFAULTS[name]===true;}
    catch(e){return DEFAULTS[name]===true;}
  },
  list(){
    const o=Object.assign({},DEFAULTS);
    try{const f=cur();for(const k in f)if(typeof f[k]==='boolean')o[k]=f[k];}catch(e){}
    return o;
  },
  set(name,value){
    try{
      if(!FLAG_RE.test(String(name)))return false;
      VR.Store.setSettings({flags:Object.assign({},cur(),{[name]:!!value})});
      return true;
    }catch(e){return false;}
  }
};
})();

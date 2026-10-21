/* schema.js — формат данных и нормализация (ядро, без зависимостей).
   Неизвестные ключи настроек сохраняются: их мог записать более новый клиент. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const KINDS=['classes','students','tests','results','feedback','settings'];
const FLAG_RE=/^[a-z][A-Za-z0-9_]{0,39}$/;
const clampGrade=g=>{g=parseInt(g,10);return g>=1&&g<=11?g:5;};
const blank=()=>({v:2,classes:[],students:[],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{minutes:8,resetAt:0,updated:0}});
const isObj=x=>!!x&&typeof x==='object';
const RULES={
  students:{keep:s=>s&&s.id&&s.name,map:s=>({id:String(s.id),name:String(s.name).slice(0,40),grade:clampGrade(s.grade),classId:s.classId||null,pinHash:s.pinHash||null,created:s.created||0,updated:s.updated||s.created||0})},
  classes:{keep:c=>c&&c.id,map:c=>({id:String(c.id),grade:clampGrade(c.grade),letter:String(c.letter||'').slice(0,4),created:c.created||0,updated:c.updated||0})},
  results:{keep:r=>r&&r.id&&r.sid&&r.subj},
  feedback:{keep:f=>f&&f.id&&(f.text||f.kind)},
  tests:{keep:t=>t&&t.id&&Array.isArray(t.qs)}
};
function cleanFlags(f){
  const o={};let n=0;
  for(const k of Object.keys(f)){if(n>=100)break;if(!FLAG_RE.test(k))continue;const v=f[k],t=typeof v;/* неизвестные значения от более новых версий сохраняем (А6); flags.on читает только boolean */if(t==='boolean'||(t==='number'&&isFinite(v))||(t==='string'&&v.length<=200)){o[k]=v;n++;}}
  return o;
}
function settings(x){
  const s=Object.assign(blank().settings,x||{});
  if('flags' in s){
    const f=s.flags;
    if(!f||typeof f!=='object'||Array.isArray(f))delete s.flags;
    else s.flags=cleanFlags(f);
  }
  return s;
}
function validate(kind,data){
  if(kind==='settings'){const v=settings(data);return{ok:isObj(data),value:v,dropped:0};}
  const R=RULES[kind];
  if(!R||!Array.isArray(data))return{ok:false,value:[],dropped:0};
  const f=data.filter(R.keep),value=R.map?f.map(R.map):f,dropped=data.length-value.length;
  return{ok:dropped===0,value,dropped};
}
function db(x){
  if(!isObj(x))return blank();
  const o={v:2};
  o.students=validate('students',x.students).value;
  o.classes=validate('classes',x.classes).value;
  o.results=validate('results',x.results).value;
  o.disc=isObj(x.disc)?x.disc:{};
  o.feedback=validate('feedback',x.feedback).value;
  o.tests=validate('tests',x.tests).value;
  o.deleted=isObj(x.deleted)?x.deleted:{};
  o.settings=validate('settings',x.settings).value;
  return o;
}
function migrate(kind,data){return kind==='db'?db(data):validate(kind,data).value;}
VR.schema={VERSION:2,KINDS,clampGrade,blank,validate,migrate,db};
})();

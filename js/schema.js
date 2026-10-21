/* schema.js — формат данных и нормализация (ядро, без зависимостей).
   Неизвестные ключи настроек сохраняются: их мог записать более новый клиент. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const KINDS=['classes','students','tests','results','feedback','settings'];
const FLAG_RE=/^[a-z][A-Za-z0-9_]{0,39}$/;
const VERSION=3,DEFAULT_SCHOOL='school-default',NEW_FIELDS=['school','year','status'];
const clampGrade=g=>{g=parseInt(g,10);return g>=1&&g<=11?g:5;};
const okSchool=v=>typeof v==='string'&&v.length>=1&&v.length<=40;
const okYear=v=>typeof v==='number'&&Number.isInteger(v)&&v>=2000&&v<=2100;
const okStatus=v=>v==='active'||v==='archived';
const OKF={school:okSchool,year:okYear,status:okStatus};
/* начало учебного года по времени создания (UTC): август и позже — этот год, раньше — прошлый; нет времени — null */
function acadYear(ts){
  if(typeof ts!=='number'||!isFinite(ts)||ts<=0)return null;
  const d=new Date(ts);if(isNaN(d.getTime()))return null;
  const y=d.getUTCMonth()>=7?d.getUTCFullYear():d.getUTCFullYear()-1;
  return okYear(y)?y:null;
}
const blank=()=>({v:VERSION,classes:[],students:[],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{minutes:8,resetAt:0,updated:0}});
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
/* v3: новые поля копируются только если допустимы (недопустимые отбрасываются) */
function copyNew(src,out){for(const f of NEW_FIELDS)if(OKF[f](src[f]))out[f]=src[f];return out;}
/* перенос полей: старый клиент их отбрасывает, поэтому у победителя берём недостающие у проигравшей версии (А6, А11) */
function carry(winner,loser){
  if(!isObj(winner)||!isObj(loser))return winner;
  let o=null;
  for(const f of NEW_FIELDS)if(!OKF[f](winner[f])&&OKF[f](loser[f])){o=o||Object.assign({},winner);o[f]=loser[f];}
  return o||winner;
}
/* значения по умолчанию; порядок полей всегда один */
function fill(kind,item){
  const o=Object.assign({},item);for(const f of NEW_FIELDS)delete o[f];
  o.school=OKF.school(item.school)?item.school:DEFAULT_SCHOOL;
  o.year=okYear(item.year)?item.year:acadYear(item.created);
  o.status=okStatus(item.status)?item.status:'active';
  return o;
}
function validate(kind,data,opt){
  if(kind==='settings'){const v=settings(data);return{ok:isObj(data),value:v,dropped:0};}
  const R=RULES[kind];
  if(!R||!Array.isArray(data))return{ok:false,value:[],dropped:0};
  const f=data.filter(R.keep),dropped=data.length-f.length;
  let value=R.map?f.map(R.map):f;
  if(kind==='students'||kind==='classes'){const doFill=!(opt&&opt.fill===false);value=value.map((m,i)=>{copyNew(f[i],m);return doFill?fill(kind,m):m;});}
  return{ok:dropped===0,value,dropped};
}
function db(x,opt){
  if(!isObj(x))return blank();
  const o={v:VERSION};
  o.students=validate('students',x.students,opt).value;
  o.classes=validate('classes',x.classes,opt).value;
  o.results=validate('results',x.results).value;
  o.disc=isObj(x.disc)?x.disc:{};
  o.feedback=validate('feedback',x.feedback).value;
  o.tests=validate('tests',x.tests).value;
  o.deleted=isObj(x.deleted)?x.deleted:{};
  o.settings=validate('settings',x.settings).value;
  return o;
}
function migrate(kind,data){return kind==='db'?db(data):validate(kind,data).value;}
VR.schema={VERSION,DEFAULT_SCHOOL,NEW_FIELDS,KINDS,clampGrade,blank,validate,migrate,db,acadYear,carry,fill,okSchool,okYear,okStatus};
})();

/* regions.js — последовательный фильтр «регион → школа → класс / учитель» для кабинета директора (шаг 10).
   Только интерфейс: списки приходят из Store.options; всё, что от сервера, попадает на страницу через textContent. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
function fill(sel,items,placeholder,keep){
  const old=keep?sel.value:'';
  sel.textContent='';
  const o0=document.createElement('option');o0.value='';o0.textContent=placeholder;sel.appendChild(o0);
  for(const it of items||[]){const o=document.createElement('option');o.value=String(it.id);o.textContent=String(it.name||it.id);sel.appendChild(o);}
  if(old&&Array.from(sel.options).some(o=>o.value===old))sel.value=old;
}
/* sel: {region,school,cls,teacher}; onChange вызывается после каждого изменения фильтра с текущими значениями */
function cascade(sel,onChange){
  const S=VR.Store;
  const get=()=>({region:sel.region.value,school:sel.school.value,class:sel.cls.value,teacher:sel.teacher.value});
  async function load(level,parent,el,ph){
    const r=await S.options({level,parent});
    fill(el,r.status===200?r.data.items:[],ph);
    return r.status===200?r.data.items:[];
  }
  async function init(){
    const regs=await load('region','',sel.region,'Все регионы');
    sel.region.parentNode.hidden=regs.length<2;
    const sch=await load('school','',sel.school,'Все школы');
    if(sch.length===1){sel.school.value=sch[0].id;await below();}
    onChange(get());
  }
  async function below(){
    const s=sel.school.value;
    if(!s){fill(sel.cls,[],'Все классы');fill(sel.teacher,[],'Все учителя');return;}
    await Promise.all([load('class',s,sel.cls,'Все классы'),load('teacher',s,sel.teacher,'Все учителя')]);
  }
  sel.region.onchange=async()=>{const r=sel.region.value;const x=await S.options({level:'school',parent:r});fill(sel.school,x.status===200?x.data.items:[],'Все школы');await below();onChange(get());};
  sel.school.onchange=async()=>{await below();onChange(get());};
  sel.cls.onchange=()=>onChange(get());
  sel.teacher.onchange=()=>onChange(get());
  return{init,get,reloadBelow:below};
}
VR.regions={fill,cascade};
})();

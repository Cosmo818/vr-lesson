/* regions.js — последовательный фильтр «регион → район → школа → класс / учитель» для кабинета директора (шаг 10).
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
  const regs0=[];
  const reg=()=>sel.region.value||(regs0.length===1?regs0[0].id:'');
  const get=()=>({region:sel.region.value,district:sel.district?sel.district.value:'',school:sel.school.value,class:sel.cls.value,teacher:sel.teacher.value});
  async function load(level,parent,el,ph){
    const r=await S.options({level,parent});
    fill(el,r.status===200?r.data.items:[],ph);
    return r.status===200?r.data.items:[];
  }
  async function init(){
    const regs=await load('region','',sel.region,'Все регионы');
    regs0.length=0;regs.forEach(x=>regs0.push(x));
    sel.region.parentNode.hidden=regs.length<2;
    await loadDistricts();
    const sch=await load('school','',sel.school,'Все школы');
    if(sch.length===1){sel.school.value=sch[0].id;await below();}
    onChange(get());
  }
  async function loadDistricts(){
    if(!sel.district)return;
    const r=await S.options({level:'district',parent:reg()});
    const items=r.status===200?r.data.items:[];
    fill(sel.district,items,'Все районы');
    sel.district.parentNode.hidden=items.filter(x=>x.id).length<1;
  }
  async function schools(){
    const x=await S.options({level:'school',parent:sel.region.value,district:sel.district?sel.district.value:''});
    fill(sel.school,x.status===200?x.data.items:[],'Все школы');
  }
  /* обновить все списки на лету (после добавления школы, возврата на вкладку), сохраняя выбранное */
  async function refresh(){
    const k=get();
    const regs=await load('region','',sel.region,'Все регионы');regs0.length=0;regs.forEach(x=>regs0.push(x));
    sel.region.parentNode.hidden=regs.length<2;
    if(Array.from(sel.region.options).some(o=>o.value===k.region))sel.region.value=k.region;
    await loadDistricts();
    if(sel.district&&Array.from(sel.district.options).some(o=>o.value===k.district))sel.district.value=k.district;
    await schools();
    if(Array.from(sel.school.options).some(o=>o.value===k.school))sel.school.value=k.school;
    await below();
  }
  async function below(){
    const s=sel.school.value;
    if(!s){fill(sel.cls,[],'Все классы');fill(sel.teacher,[],'Все учителя');return;}
    await Promise.all([load('class',s,sel.cls,'Все классы'),load('teacher',s,sel.teacher,'Все учителя')]);
  }
  sel.region.onchange=async()=>{await loadDistricts();await schools();await below();onChange(get());};
  if(sel.district)sel.district.onchange=async()=>{await schools();await below();onChange(get());};
  sel.school.onchange=async()=>{await below();onChange(get());};
  sel.cls.onchange=()=>onChange(get());
  sel.teacher.onchange=()=>onChange(get());
  return{init,get,refresh,reloadBelow:below};
}
VR.regions={fill,cascade};
})();

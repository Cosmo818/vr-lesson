/* roomspec.js — формат комнаты, созданной в конструкторе (room/1): проверка, очистка, оценка нагрузки, шаблоны. Ядро без зависимостей (А2).
   Комната — это ДАННЫЕ: исполняемого кода в ней нет, неизвестные поля отбрасываются, числа и тексты ограничены. Читают её и страница учителя (редактор),
   и шлем (js/custom.js), и схема настроек (js/schema.js) — поэтому испорченная запись не может сломать приложение. Описание формата — docs/ROOM_SPEC.md. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const SCHEMA='room/1';
const LIM={blocks:60,panels:16,items:40,rooms:30,discover:6,title:40,hint:140,text:700,label:30,info:300,q:200,ans:80,explain:300,bytes:40000,coord:5.4};
const SHAPES={cube:'Куб',ball:'Шар',cyl:'Цилиндр',cone:'Конус',tetra:'Тетраэдр',octa:'Октаэдр',icosa:'Икосаэдр',dodeca:'Додекаэдр'};
const COLORS={red:['Красный','#ef4444'],orange:['Оранжевый','#f97316'],yellow:['Жёлтый','#facc15'],green:['Зелёный','#22c55e'],teal:['Бирюзовый','#14b8a6'],blue:['Синий','#3b82f6'],violet:['Фиолетовый','#8b5cf6'],pink:['Розовый','#ec4899'],white:['Белый','#f1f5f9'],gray:['Серый','#94a3b8']};
const PRESETS={
  lab:{title:'Лаборатория',env:{floor:[.07,.1,.18],wall:[.12,.17,.3],trim:[.2,.7,1],grid:[.25,.55,.9]}},
  sun:{title:'Светлый класс',env:{floor:[.42,.4,.36],wall:[.62,.66,.74],trim:[1,.8,.3],grid:[.9,.75,.3]}},
  forest:{title:'Лес',env:{floor:[.1,.22,.12],wall:[.16,.3,.2],trim:[.5,1,.5],grid:[.4,.9,.4]}},
  warm:{title:'Музей',env:{floor:[.14,.1,.06],wall:[.3,.21,.12],trim:[1,.75,.4],grid:[1,.75,.4]}},
  night:{title:'Ночь',env:{floor:[.04,.04,.09],wall:[.09,.08,.18],trim:[.7,.4,1],grid:[.6,.35,.9]}},
  space:{title:'Космос (открытое небо)',env:{open:true,floor:[.03,.04,.09],trim:[.3,.7,1],grid:[.3,.7,1]}}
};
const SOUNDS={none:'Без звука',ding:'Звонок',chime:'Колокольчик',low:'Низкий',high:'Высокий'};
const TYPES={text:'Текст',item:'Предмет',table:'Стол',question:'Вопрос',quiz:'Тест по предмету',portal:'Переход'};
const PANEL_TYPES=['text','question','quiz','portal'];
const ID_RE=/^[a-z][a-z0-9_-]{1,39}$/;
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const num=(v,lo,hi,d)=>{v=typeof v==='number'?v:parseFloat(v);if(!isFinite(v))return d;return Math.min(hi,Math.max(lo,v));};
const r1=v=>Math.round(v*10)/10;
const str=(v,max)=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max):'';
const oneOf=(v,set,d)=>typeof v==='string'&&Object.prototype.hasOwnProperty.call(set,v)?v:d;
const color=(v,d)=>{if(typeof v==='string'&&Object.prototype.hasOwnProperty.call(COLORS,v))return v;if(typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v))return v.toLowerCase();return d;};
const colorHex=v=>COLORS[v]?COLORS[v][1]:(/^#[0-9a-f]{6}$/i.test(v)?v:'#3b82f6');
const rid=()=>{let s='';const a='abcdefghijklmnopqrstuvwxyz0123456789';for(let i=0;i<6;i++)s+=a[(Math.random()*a.length)|0];return s;};
const newRoomId=()=>'c-'+rid();
const newBlockId=()=>'b'+rid().slice(0,5);
const pos=(b,d)=>({x:r1(num(b.x,-LIM.coord,LIM.coord,d.x)),z:r1(num(b.z,-LIM.coord,LIM.coord,d.z))});

/* поля блоков по типам: по ним строится форма в редакторе и по ним же идёт очистка */
const FIELDS={
  text:[
    {k:'title',label:'Заголовок',kind:'text',max:LIM.title,def:'Заголовок'},
    {k:'text',label:'Текст',kind:'area',max:LIM.text,def:''},
    {k:'w',label:'Ширина панели, м',kind:'num',min:1,max:4,step:.2,def:2.4},
    {k:'y',label:'Высота центра, м',kind:'num',min:.8,max:2.6,step:.1,def:1.7},
    {k:'accent',label:'Цвет рамки',kind:'color',def:'blue'}
  ],
  item:[
    {k:'label',label:'Название',kind:'text',max:LIM.label,def:'Предмет'},
    {k:'info',label:'Что рассказать, когда на предмет наведут и нажмут',kind:'area',max:LIM.info,def:''},
    {k:'shape',label:'Форма',kind:'select',opts:SHAPES,def:'cube'},
    {k:'color',label:'Цвет',kind:'color',def:'orange'},
    {k:'size',label:'Размер, м',kind:'num',min:.1,max:1.2,step:.05,def:.4},
    {k:'lift',label:'Высота над полом, м (стол — 0.8)',kind:'num',min:0,max:2.5,step:.1,def:0},
    {k:'grab',label:'Можно брать в руки и бросать',kind:'check',def:false},
    {k:'spin',label:'Медленно вращается',kind:'check',def:false},
    {k:'discover',label:'Считать открытием (+2 балла, один раз)',kind:'check',def:true},
    {k:'sound',label:'Звук при нажатии',kind:'select',opts:SOUNDS,def:'ding'}
  ],
  table:[
    {k:'w',label:'Длина, м',kind:'num',min:.4,max:4,step:.1,def:1.4},
    {k:'d',label:'Ширина, м',kind:'num',min:.4,max:3,step:.1,def:.8},
    {k:'h',label:'Высота, м',kind:'num',min:.4,max:1.2,step:.05,def:.8},
    {k:'color',label:'Цвет',kind:'color',def:'gray'}
  ],
  question:[
    {k:'q',label:'Вопрос',kind:'area',max:LIM.q,def:'Вопрос?'},
    {k:'a0',label:'Верный ответ',kind:'text',max:LIM.ans,def:'Верно'},
    {k:'a1',label:'Неверный ответ 1',kind:'text',max:LIM.ans,def:'Неверно'},
    {k:'a2',label:'Неверный ответ 2 (можно пусто)',kind:'text',max:LIM.ans,def:''},
    {k:'a3',label:'Неверный ответ 3 (можно пусто)',kind:'text',max:LIM.ans,def:''},
    {k:'explain',label:'Пояснение после ответа',kind:'area',max:LIM.explain,def:''},
    {k:'discover',label:'Верный ответ — открытие (+2 балла, один раз)',kind:'check',def:true},
    {k:'w',label:'Ширина панели, м',kind:'num',min:1.6,max:4,step:.2,def:2.8},
    {k:'y',label:'Высота центра, м',kind:'num',min:.8,max:2.6,step:.1,def:1.7}
  ],
  quiz:[
    {k:'subj',label:'Предмет теста',kind:'subject',def:'math'}
  ],
  portal:[
    {k:'to',label:'Куда ведёт',kind:'room',def:'hall'},
    {k:'label',label:'Надпись на двери',kind:'text',max:24,def:'Дверь'},
    {k:'accent',label:'Цвет двери',kind:'color',def:'teal'}
  ]
};

/* очистка одного блока: что не в списке — отбрасывается; возвращает блок или null */
function cleanBlock(b,subjOk){
  if(!isObj(b)||!Object.prototype.hasOwnProperty.call(TYPES,b.type))return null;
  const o={id:typeof b.id==='string'&&ID_RE.test(b.id)?b.id:newBlockId(),type:b.type};
  Object.assign(o,pos(b,{x:0,z:-3}));
  const F=FIELDS[b.type];
  for(const f of F){
    const v=b[f.k];
    if(f.kind==='text'||f.kind==='area')o[f.k]=str(v,f.max);
    else if(f.kind==='num')o[f.k]=num(v,f.min,f.max,f.def);
    else if(f.kind==='check')o[f.k]=typeof v==='boolean'?v:f.def;
    else if(f.kind==='color')o[f.k]=color(v,f.def);
    else if(f.kind==='select')o[f.k]=oneOf(v,f.opts,f.def);
    else if(f.kind==='subject')o[f.k]=subjOk(v)?v:null;
    else if(f.kind==='room')o[f.k]=typeof v==='string'&&ID_RE.test(v)?v:'hall';
  }
  if(b.type==='quiz'&&!o.subj)return null;
  if(b.type==='question'){
    if(!o.q||!o.a0||!o.a1)return null;
    const seen=new Set();for(const k of['a0','a1','a2','a3']){if(o[k]&&seen.has(o[k]))o[k]='';else if(o[k])seen.add(o[k]);}
    if(!o.a0||!o.a1)return null;
  }
  if(b.type==='item'){o.size=Math.round(o.size*100)/100;o.lift=r1(o.lift);}
  return o;
}

/* очистка всей комнаты. subjects — функция «такой предмет для теста есть?» (по умолчанию любой короткий id).
   Возвращает {spec, errors}: errors — что пришлось выбросить или исправить (для показа в редакторе). */
function clean(spec,subjOk){
  const errors=[];
  subjOk=subjOk||(v=>typeof v==='string'&&/^[a-z]{2,12}$/.test(v));
  const o={schema:SCHEMA,id:'',title:'',hint:'',env:'lab',spawn:{x:0,z:4},blocks:[],created:0,updated:0};
  if(!isObj(spec))return{spec:null,errors:['Это не комната.']};
  o.id=typeof spec.id==='string'&&ID_RE.test(spec.id)?spec.id:newRoomId();
  if(!/^c-/.test(o.id))o.id='c-'+o.id.replace(/^c-?/,'').slice(0,36);
  o.title=str(spec.title,LIM.title).trim()||'Новая комната';
  o.hint=str(spec.hint,LIM.hint).trim();
  o.env=oneOf(spec.env,PRESETS,'lab');
  if(isObj(spec.spawn))o.spawn={x:r1(num(spec.spawn.x,-LIM.coord,LIM.coord,0)),z:r1(num(spec.spawn.z,-LIM.coord,LIM.coord,4))};
  o.created=typeof spec.created==='number'&&isFinite(spec.created)?spec.created:0;
  o.updated=typeof spec.updated==='number'&&isFinite(spec.updated)?spec.updated:0;
  const ids=new Set();let panels=0,items=0,disc=0,discCut=false;
  const src=Array.isArray(spec.blocks)?spec.blocks:[];
  for(const b of src){
    if(o.blocks.length>=LIM.blocks){errors.push('Блоков больше '+LIM.blocks+': лишние убраны.');break;}
    const c=cleanBlock(b,subjOk);
    if(!c){errors.push('Блок «'+(isObj(b)&&TYPES[b.type]||'?')+'» неполный или неизвестный: убран.');continue;}
    if(PANEL_TYPES.includes(c.type)){if(panels>=LIM.panels){const m='Панелей больше '+LIM.panels+' (текст, вопрос, тест, переход): лишние убраны.';if(!errors.includes(m))errors.push(m);continue;}panels++;}
    if(c.type==='item'){if(items>=LIM.items){const m='Предметов больше '+LIM.items+': лишние убраны.';if(!errors.includes(m))errors.push(m);continue;}items++;}
    if(c.discover){if(disc>=LIM.discover){c.discover=false;discCut=true;}else disc++;}
    while(ids.has(c.id))c.id=newBlockId();
    ids.add(c.id);o.blocks.push(c);
  }
  if(discCut)errors.push('Открытий (баллов) в комнате не больше '+LIM.discover+': у остальных блоков отметка снята.');
  if(JSON.stringify(o).length>LIM.bytes){errors.push('Комната слишком большая.');return{spec:null,errors};}
  return{spec:o,errors};
}

/* оценка нагрузки: панели — самая дорогая часть (у каждой своя текстура) */
function cost(spec){
  const bl=spec&&Array.isArray(spec.blocks)?spec.blocks:[];
  const panels=bl.filter(b=>PANEL_TYPES.includes(b.type)).length,items=bl.filter(b=>b.type==='item').length;
  const grab=bl.filter(b=>b.type==='item'&&b.grab).length;
  const lite=panels<=8&&items<=25&&grab<=8,ok=panels<=LIM.panels&&items<=LIM.items;
  return{panels,items,grab,blocks:bl.length,level:!ok?'over':lite?'lite':'standard',
    text:!ok?'Слишком много: уберите лишнее.':lite?'Пойдёт на Quest 1, 2 и 3.':'Пойдёт на Quest 2 и 3; на Quest 1 может подтормаживать.'};
}

/* что можно «открыть» в комнате: ключи для цели «найди всё» */
function discoverKeys(spec){
  const k=[];
  for(const b of spec.blocks||[]){
    if((b.type==='item'||b.type==='question')&&b.discover)k.push(b.id);
  }
  return k;
}

const blockDefault=type=>{const o={id:newBlockId(),type,x:0,z:-3};for(const f of FIELDS[type])o[f.k]=f.def;if(type==='quiz')o.subj='math';return o;};

/* шаблоны: учитель начинает не с пустого места */
const TEMPLATES={
  empty:{title:'Пустая комната',text:'Только стены и дверь в холл. Добавьте блоки сами.',make:()=>({title:'Новая комната',env:'lab',blocks:[]})},
  expo:{title:'Выставка',text:'Стол с предметами: у каждого своё название и рассказ.',make:()=>({title:'Выставка',hint:'Нажми на предмет, чтобы узнать о нём.',env:'warm',blocks:[
    {type:'text',x:0,z:-5.4,y:2.2,w:3.2,title:'Выставка',text:'Нажми на предмет на столе и прочитай о нём. Каждый предмет — открытие.',accent:'orange'},
    {type:'table',x:0,z:-3,w:2.4,d:.9,h:.8,color:'gray'},
    {type:'item',x:-.8,z:-3,shape:'cube',color:'red',size:.3,lift:.8,label:'Красный куб',info:'Замените этот текст рассказом о предмете.'},
    {type:'item',x:0,z:-3,shape:'ball',color:'blue',size:.3,lift:.8,label:'Синий шар',info:'Замените этот текст рассказом о предмете.'},
    {type:'item',x:.8,z:-3,shape:'cone',color:'green',size:.3,lift:.8,label:'Зелёный конус',info:'Замените этот текст рассказом о предмете.',spin:true}
  ]})},
  quest:{title:'Мини-викторина',text:'Три вопроса на стенах и тест по предмету. Верный ответ — открытие.',make:()=>({title:'Мини-викторина',hint:'Ответь на вопросы на стенах.',env:'sun',blocks:[
    {type:'question',x:-5.4,z:-1.5,y:1.7,w:2.8,q:'Замените вопрос №1',a0:'Верный ответ',a1:'Неверный ответ',a2:'Ещё неверный',explain:'Пояснение после ответа.'},
    {type:'question',x:0,z:-5.4,y:1.7,w:2.8,q:'Замените вопрос №2',a0:'Верный ответ',a1:'Неверный ответ',explain:''},
    {type:'question',x:5.4,z:-1.5,y:1.7,w:2.8,q:'Замените вопрос №3',a0:'Верный ответ',a1:'Неверный ответ',explain:''},
    {type:'quiz',x:3.5,z:5.4,subj:'math'}
  ]})}
};

VR.roomspec={SCHEMA,LIM,SHAPES,COLORS,PRESETS,SOUNDS,TYPES,PANEL_TYPES,FIELDS,TEMPLATES,clean,cost,discoverKeys,blockDefault,newRoomId,newBlockId,colorHex,isRoomId:id=>typeof id==='string'&&/^c-[a-z0-9_-]{1,38}$/.test(id)};
})();

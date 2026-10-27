/* chemtree.js — химия как дерево комнат (Б65-Д, шаг 33): узел «Химия» с дверями в разделы.
   Универсальный стенд — прежняя комната `chem` (js/chem.js), не меняется. Разделы — тонкие комнаты поверх `VR.STANDS[id]`
   (стенд строит себя вокруг стола o={x,z}); пока стенда нет — стол и табличка «Раздел в разработке». Флаг `chemTree` (js/flags.js). */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,ROOMS=VR.ROOMS,{YL,YR,hubDoor}=VR.RU;
const STANDS=VR.STANDS=VR.STANDS||{};
const GREEN='#4ade80',TABLE={x:0,z:-2.4};
/* разделы: двери узла слева (сверху вниз по z) и справа */
const SECT=[
  {id:'chem-ion',title:'Растворы и ионы',color:'#38bdf8',wall:-1,z:-3,text:'Соль в воде распадается на ионы «+» и «–».'},
  {id:'chem-acid',title:'Кислоты и основания',color:'#f472b6',wall:-1,z:0,text:'Капли в колбу: цвет индикатора и шкала pH.'},
  {id:'chem-inorg',title:'Неорганика',color:'#fb923c',wall:-1,z:3,text:'Классы веществ и простые реакции.'},
  {id:'chem-org',title:'Органика',color:'#facc15',wall:1,z:-3,text:'Цепочка из углерода, названия веществ.'},
  {id:'chem-nuc',title:'Ядерная физика',color:'#c084fc',wall:1,z:0,text:'Ядра: слияние и распад.'},
  {id:'chem',title:'Универсальный стенд',color:GREEN,wall:1,z:3,pack:'chem-lab',text:'118 элементов, сосуды, склад, доска.'}
];
/* программа по классам (Б65-Д.4): [класс, тема, раздел] */
const PROG=[
  ['1–7','Вода, углекислый газ, метан из атомов','Универсальный стенд'],
  ['8','Таблица Менделеева, 118 элементов','Универсальный стенд'],
  ['8','Классы веществ, реакции, горение','Неорганика'],
  ['8','Кислоты, щёлочи, индикаторы','Кислоты и основания'],
  ['8–9','Растворы, ионы, ионный обмен','Растворы и ионы'],
  ['9','Строение ядра, радиоактивность','Ядерная физика'],
  ['9–11','Углеводороды, спирты, кислоты','Органика'],
  ['11','Повторение, шкала pH','Кислоты и основания']
];
const grade=E=>E.student&&E.student.grade?E.student.grade:5;
const open=(E,s)=>VR.Store.packOn(s.pack||s.id,grade(E));

function stubPanel(E,sec,msg){
  E.addPanel({w:2.4,h:.95,pos:[0,1.9,-5.86],yaw:0,accent:sec.color,draw:(c,p)=>{
    p.text(sec.title,40,26,{size:60,bold:true,color:sec.color,maxW:p.W-80});
    p.text(msg||'Раздел в разработке. Скоро здесь будет стенд.',40,112,{size:38,color:'#cbd5e1',maxW:p.W-80});
  }});
}

/* ---------- узел ---------- */
ROOMS['chem-hub']={
  title:'Химия',env:{floor:[.05,.14,.09],wall:[.1,.26,.17],trim:[.35,1,.6],grid:[.3,.9,.5]},spawn:{x:0,z:2.4},
  hint:'Химия: на карте — что изучают в каком классе. Двери ведут в разделы, а тест — справа от карты.',
  build(E,S){
    E.door(0,5.88,Math.PI,'hall','← Холл','#94a3b8');
    const g=grade(E);let n=0;
    for(const s of SECT){
      if(!open(E,s))continue;
      E.door(s.wall<0?-5.88:5.88,s.z,s.wall<0?YL:YR,s.id,s.title,s.color);n++;
    }
    S.doors=n;S.guest=g<8;
    E.addPanel({w:3,h:2,pos:[-1.2,1.6,-5.86],yaw:0,res:1280,keepTex:true,accent:GREEN,draw:(c,p)=>{
      p.text('Карта химии',40,24,{size:62,bold:true,color:GREEN});
      p.text(S.guest?'Разделы откроются с 8 класса — пока работает универсальный стенд.':'Что изучают в каком классе — выбери дверь.',40,104,{size:32,color:'#b8c7ea',maxW:p.W-80});
      PROG.forEach((r,i)=>{
        const y=170+i*78;
        p.text(r[0],40,y,{size:38,bold:true,color:'#fde68a'});
        p.text(r[1],190,y,{size:34,maxW:630});
        p.text(r[2],860,y+2,{size:30,color:'#94a3b8',maxW:p.W-900});
      });
    }});
    VR.makeQuiz(E,'chem',[2.3,1.5,-5.86],0);
  },
  targets(E,S){return[];},
  update(E,S,dt){},draw(E,S,add){}
};

/* ---------- разделы ---------- */
function section(sec){
  return{
    title:sec.title,env:ROOMS.chem.env,spawn:{x:0,z:-.9},
    hint:sec.title+': '+sec.text,
    build(E,S){
      hubDoor(E);S.stand=null;
      const st=STANDS[sec.id];
      if(st){
        try{st.build(E,S,TABLE);S.stand=st;}
        catch(e){S.stand=null;E.toast('Стенд временно недоступен','#fca5a5');E.addTable(TABLE.x,TABLE.z,1.6,.45,.85);stubPanel(E,sec,'Стенд временно недоступен.');}
      }else{E.addTable(TABLE.x,TABLE.z,1.6,.45,.85);stubPanel(E,sec);}
    },
    targets(E,S){return S.stand&&S.stand.targets?S.stand.targets(E,S)||[]:[];},
    pick(E,S,h,hit){return S.stand&&S.stand.pick?S.stand.pick(E,S,h,hit):null;},
    onGrab(E,S,b){if(S.stand&&S.stand.onGrab)S.stand.onGrab(E,S,b);},
    onRelease(E,S,b,sp){if(S.stand&&S.stand.onRelease)S.stand.onRelease(E,S,b,sp);},
    update(E,S,dt){if(S.stand&&S.stand.update)try{S.stand.update(E,S,dt);}catch(e){}},
    draw(E,S,add){if(S.stand&&S.stand.draw)try{S.stand.draw(E,S,add);}catch(e){}}
  };
}
for(const sec of SECT)if(sec.id!=='chem'&&sec.id!=='chem-nuc')ROOMS[sec.id]=section(sec);

/* ---------- ядерная физика = универсальный стенд в режиме «Ядра» ---------- */
ROOMS['chem-nuc']=Object.assign({},ROOMS.chem,{
  title:'Ядерная физика',
  hint:'Ядерная физика: бери элементы из таблицы, сливай ядра в левом сосуде и смотри распад справа. Режим «Ядра» уже включён.',
  build(E,S){ROOMS.chem.build(E,S);if(S.lab&&!S.nuclear)VR.chemLab.toggleMode(E,S);}
});

VR.chemTree={SECT,PROG};
})();

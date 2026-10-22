/* learn.js — обучающие комнаты «Первые шаги» (ученик) и «Обучение учителя»: как пользоваться управлением и ресурсом.
   В шлеме в руки кладётся модель контроллера (js/controllers.js), у каждой кнопки висит подпись, текущая кнопка мигает.
   За компьютером вместо контроллера показана схема мыши и клавиатуры. Шаги проверяются по действиям человека, любой можно пропустить. */
(function(){
'use strict';
const VR=window.VR,M=VR.M,TRS=VR.TRS,ROOMS=VR.ROOMS;
const {YR,backDoor}=VR.RU;
const wrap=a=>{while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a;};
const col=c=>VR.hex(c);

/* ---- шаги: у каждого свой текст для шлема (v) и для компьютера (d); hot — какая кнопка контроллера мигает ---- */
const STEPS={
  meet:{t:'Знакомься: твои контроллеры',v:'Это твои контроллеры. У каждой кнопки есть подпись. Покрути их в руках, нажми кнопки — нажатая загорится. Готов — жми «Дальше» (наведи луч и нажми курок).',manual:1,all:1,vr:1},
  look:{t:'Осмотрись',d:'Двигай мышью — взгляд поворачивается сам, курсор не упирается в край экрана. Если мышь не захвачена, щёлкни по экрану.',desk:1},
  walk:{t:'Иди',d:'Нажимай W A S D (стрелки тоже работают). С зажатым Shift — быстрее. Пройди несколько шагов.',desk:1},
  select:{t:'Выбери',v:'Наведи луч на зелёный шар и нажми КУРОК (указательный палец). Курок выбирает кнопки и двери.',d:'Наведи перекрестие на зелёный шар и щёлкни левой кнопкой мыши (или пробел).',hot:'trigger'},
  grab:{t:'Возьми предмет',v:'Поднеси руку к кубику на столе справа, зажми ХВАТ (средний палец) и подними. Отпусти хват — кубик упадёт. Брось его!',d:'Наведи перекрестие на кубик на столе справа, держи правую кнопку мыши (или E) — предмет у тебя в руке. Колесо — дальше/ближе. Отпусти — бросок.',hot:'grip'},
  teleport:{t:'Телепорт',v:'Потяни СТИК вперёд и держи — появится дуга. Выбери место на полу и отпусти стик.',hot:'stick',vr:1},
  turn:{t:'Поворот',v:'Отклони СТИК вбок — ты повернёшься на 30°. Так удобно осматриваться, не крутя шею.',hot:'stick',vr:1},
  back:{t:'Шаг назад',v:'Нажми СТИК назад (вниз) — шаг назад. Удобно, если подошёл слишком близко.',hot:'stick',vr:1},
  menu:{t:'Меню',v:'Нажми кнопку X на левом или A на правом контроллере — откроется меню. Там время, баллы и выход в холл.',d:'Нажми M или Tab — откроется меню. Там время, баллы и выход в холл.',hot:'b1'}
};
const ORDER_VR=['meet','select','grab','teleport','turn','back','menu'],ORDER_DESK=['look','walk','select','grab','menu'];
const PAGES=[
  ['Кабинет учителя','Всё управление — в кабинете на компьютере (страница teacher.html, кнопка «Кабинет учителя» на стартовом экране). Вкладки: Рейтинг, Классы и ученики, Комнаты, Конструкторы комнат и тестов, Отзывы, Данные и настройки.'],
  ['Ученики и классы','Заведи класс и учеников во вкладке «Классы и ученики». Ученик выбирает себя на стартовом экране и входит по своему коду. Баллы и результаты тестов попадают в «Рейтинг».'],
  ['Что видят дети','Вкладка «Комнаты» включает и выключает комнаты и блоки для класса. В «Данные и настройки» задаётся, сколько минут длится сеанс одного ученика.'],
  ['Свои комнаты','«Конструктор комнат»: собери комнату из блоков, «Войти в комнату» — проверишь прямо в редакторе. «Править в VR» откроет планшет-редактор на левой руке.'],
  ['Свои файлы','В конструкторе кнопка «Мои файлы»: модели .glb, звуки .wav, текстуры PNG и JPEG. Ученикам файл виден после одобрения директором школы.'],
  ['Шлемы и сервер','Шлем привязывается коротким кодом: «Данные и настройки» → «Код привязки». Код выдаёт директор в администрировании. Результаты шлемов собираются на сервере школы.'],
  ['Безопасность','Пароли, коды и ключи не пишем на стенах и в чатах. Ученику даём только его личный код входа.']
];

function lesson(teacher){
  return{
    title:teacher?'Обучение учителя':'Первые шаги',
    env:{floor:[.07,.1,.18],wall:[.12,.17,.3],trim:teacher?[.65,.5,1]:[.2,.9,.6],grid:[.25,.55,.9]},
    spawn:{x:0,z:1.2},
    hint:teacher?'Обучение учителя: сначала управление, потом как устроена платформа.':'Первые шаги: делай то, что написано на стене. Любой шаг можно пропустить.',
    build(E,S){
      const vr=!!E.session;
      S.vr=vr;S.teacher=teacher;S.order=(vr?ORDER_VR:ORDER_DESK).slice();
      if(teacher)for(let i=0;i<PAGES.length;i++)S.order.push('page'+i);
      S.order.push('end');S.i=0;S.done={};S.lp=[{},{}];S.lab=[{},{}];
      const reset=()=>{S.walked=S.turned=S.back=0;S.sel=false;S.grabbed=S.released=false;S.menuSeen=false;S.last=null;S.ok=false;S.okT=0;};
      S.reset=reset;reset();
      const cur=()=>S.order[S.i];
      S.go=d=>{S.i=Math.max(0,Math.min(S.order.length-1,S.i+d));reset();S.main.dirty=true;if(S.diag)S.diag.dirty=true;for(const hi of[0,1])for(const k in S.lab[hi])S.lab[hi][k].dirty=true;E.beep(660,.06);};
      /* главная панель на дальней стене */
      S.main=E.addPanel({w:3.4,h:2.4,pos:[0,1.65,-5.86],yaw:0,accent:teacher?'#a78bfa':'#22c55e',draw:(c,p)=>{
        const id=cur(),n=S.order.length-1;
        if(id==='end'){
          p.text(teacher?'Обучение пройдено!':'Ты прошёл обучение!',50,30,{size:66,bold:true,color:'#86efac'});
          p.text(vr?'Курок — выбрать · Хват — взять · Стик — идти и поворачиваться · X / A — меню.':'Мышь — взгляд · ЛКМ — выбрать · ПКМ или E — взять · WASD — идти · M — меню · F — полный экран.',50,130,{size:38,color:'#cbd5e1'});
          if(teacher)p.text('Дальше: кабинет учителя на компьютере. Эти семь экранов можно перечитать, нажав «Назад».',50,300,{size:34,color:'#b8c7ea'});
          p.button(50,560,420,100,'В холл',()=>E.goRoom('hall'),{bg:'#2563eb',size:44});
          p.button(500,560,420,100,'Заново',()=>{S.i=0;S.reset();S.go(0);},{bg:'#475569',size:44});
          p.button(950,560,260,100,'‹ Назад',()=>S.go(-1),{bg:'#334155',size:40});return;
        }
        const isPage=id.indexOf('page')===0,st=isPage?null:STEPS[id],pg=isPage?PAGES[+id.slice(4)]:null,man=isPage||st.manual;
        p.text('Шаг '+(S.i+1)+' из '+n+(isPage?'  ·  Как устроена платформа':''),50,26,{size:34,color:'#9fb0d6'});
        p.text(isPage?pg[0]:st.t,50,74,{size:68,bold:true,color:isPage?'#c4b5fd':'#fde68a'});
        p.text(isPage?pg[1]:(vr?st.v:st.d),50,172,{size:40,color:'#e2e8f0',maxY:480});
        if(!man){
          c.fillStyle=S.ok?'rgba(34,197,94,.25)':'rgba(255,255,255,.07)';c.fillRect(50,470,1100,64);
          p.text(S.ok?'✓ Получилось! Идём дальше…':'Жду, когда ты это сделаешь…',70,482,{size:38,bold:true,color:S.ok?'#86efac':'#9fb0d6'});
        }
        for(let k=0;k<n;k++){c.fillStyle=k<S.i?'#22c55e':k===S.i?'#fde68a':'#334155';c.beginPath();c.arc(70+k*38,580,11,0,7);c.fill();}
        p.button(50,620,300,86,'‹ Назад',()=>S.go(-1),{bg:'#334155',size:38,disabled:S.i===0});
        p.button(850,620,300,86,man?'Дальше ›':'Пропустить ›',()=>S.go(1),{bg:man?(isPage?'#7c3aed':'#16a34a'):'#475569',size:38});
      }});
      /* предметы для упражнений */
      S.ball=[-2.4,1.35,-4.2];
      E.addPanel({w:1.3,h:.4,pos:[-2.4,2.0,-4.2],yaw:0,accent:'#22c55e',draw:(c,p)=>p.text('Выбери меня',p.W/2,22,{size:56,bold:true,align:'center'})});
      const T=E.addTable(2.4,-3.9,.7,.35,.8);
      [[2.1,'cube',[.9,.25,.25]],[2.4,'cube',[.3,.5,.95]],[2.7,'ball',[.95,.85,.2]]].forEach(([x,sh,cl])=>E.addBody({shape:sh,p:[x,T.top+(sh==='cube'?.07:.055),-3.9],s:sh==='cube'?.14:.11,col:cl}));
      E.addPanel({w:1.3,h:.4,pos:[2.4,1.7,-4.2],yaw:0,accent:'#f59e0b',draw:(c,p)=>p.text('Возьми и брось',p.W/2,22,{size:52,bold:true,align:'center'})});
      backDoor(E);
      /* схема мыши и клавиатуры (на компьютере) */
      if(!vr){
        S.diag=E.addPanel({w:2.6,h:2.1,pos:[5.86,1.75,-1.2],yaw:YR,accent:'#38bdf8',draw:(c,p)=>drawDesk(c,p,cur())});
      }
    },
    targets(E,S){return[{c:S.ball,r:.34,id:'ball',sel:()=>{if(S.sel)return;S.sel=true;E.burst(S.ball,30);E.beep(780,.1);}}];},
    onGrab(E,S){S.grabbed=true;},
    onRelease(E,S){if(S.grabbed)S.released=true;},
    update(E,S,dt){
      const id=S.order[S.i],hp=E.headPose(),pos=hp.pos,yaw=Math.atan2(hp.f[0],hp.f[1]);
      if(S.last){
        const dx=pos[0]-S.last.x,dz=pos[2]-S.last.z,d=Math.hypot(dx,dz);
        if(d<3){S.walked+=d;S.back+=Math.max(0,-(dx*hp.f[0]+dz*hp.f[1]));}
        S.turned+=Math.abs(wrap(yaw-S.last.yaw));
      }
      S.last={x:pos[0],z:pos[2],yaw};
      if(E.menuOpen)S.menuSeen=true;
      /* выполнен ли текущий шаг */
      let ok=false;
      if(id==='look')ok=S.turned>=1.5;else if(id==='walk')ok=S.walked>=3;else if(id==='select')ok=S.sel;
      else if(id==='grab')ok=S.grabbed&&S.released;else if(id==='teleport')ok=S.walked>=1.2;else if(id==='turn')ok=S.turned>=.45;
      else if(id==='back')ok=S.back>=.25;else if(id==='menu')ok=S.menuSeen;
      if(ok&&!S.ok){S.ok=true;S.okT=1.2;S.main.dirty=true;E.beep(880,.1,'triangle');E.beep(1180,.14,'triangle');E.burst([0,1.8,-4.5],24);}
      if(S.ok&&S.okT>0){S.okT-=dt;if(S.okT<=0)S.go(1);}
      /* контроллеры: подсвеченная кнопка и подписи */
      const st=STEPS[id];E.ctlOpt=S.vr?{hot:st&&st.hot,t:E.t}:null;
      if(S.vr)labels(E,S,hp,dt);
    },
    leave(E,S){E.ctlOpt=null;},
    draw(E,S,add){
      const id=S.order[S.i],act=id==='select',pulse=.5+.5*Math.sin(E.t*5);
      add(E.mesh.sphere,TRS(S.ball[0],S.ball[1],S.ball[2],.5,.5,.5),S.sel?[.2,1,.5]:act?[.3,.9,.4]:[.25,.4,.3],S.sel?1:act?.4+pulse*.5:.15);
      if(S.vr)for(let hi=0;hi<2;hi++){
        const h=E.H[hi];if(!h.has||!S.lp[hi])continue;
        for(const p of VR.controllers.parts(hi)){
          const l=S.lp[hi][p.id],stp=STEPS[id]||{};if(!l||!(stp.all||stp.hot===p.id||(stp.hot==='b1'&&p.id==='b2')))continue;
          const a=mulPt(h.g,p.pos),on=STEPS[id]&&STEPS[id].hot===p.id;
          line(add,E.mesh.cube,a,l,on?.0035:.0018,on?[.3,1,.5]:[.55,.65,.9]);
        }
      }
    }
  };
}
const mulPt=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
function line(add,cube,a,b,th,cl){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],L=Math.hypot(dx,dy,dz);if(L<1e-4)return;
  const yaw=Math.atan2(dx,dz),pitch=-Math.asin(dy/L);
  add(cube,M.mul(M.trans((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),M.mul(M.rotY(yaw),M.mul(M.rotX(pitch),M.scale(th,th,L)))),cl,.8);
}
const LAB={
  trigger:['Курок','выбрать · нажать · взять'],
  grip:['Хват','взять предмет'],
  stick:['Стик','вперёд — телепорт\nвбок — поворот\nназад — шаг назад'],
  b1:[null,'открыть меню'],b2:[null,'открыть меню']
};
function labels(E,S,hp,dt){
  const ids=VR.controllers.parts(0).map(p=>p.id);
  for(let hi=0;hi<2;hi++){
    const h=E.H[hi],ps=VR.controllers.parts(hi);
    for(const p of ps){
      let pan=S.lab[hi][p.id];
      if(!pan){
        const tall=p.id==='stick',w=.22,hh=tall?.115:.06,name=LAB[p.id][0]||p.name;
        pan=S.lab[hi][p.id]=E.addPanel({w,h:hh,res:512,pos:[0,0,0],yaw:0,noHit:true,show:false,accent:'#38bdf8',draw:(c,pp)=>{
          const on=STEPS[S.order[S.i]]&&STEPS[S.order[S.i]].hot===p.id;
          if(on){c.strokeStyle='#4ade80';c.lineWidth=10;c.strokeRect(5,5,pp.W-10,pp.H-10);}
          pp.text(name,pp.W/2,10,{size:on?58:50,bold:true,align:'center',color:on?'#bbf7d0':'#e8efff'});
          pp.text(LAB[p.id][1],pp.W/2,tall?78:76,{size:tall?30:32,align:'center',color:'#b8c7ea',lh:36});
        }});
      }
      const stp=STEPS[S.order[S.i]]||{},vis=stp.all||stp.hot===p.id||(stp.hot==='b1'&&p.id==='b2');
      pan.show=!!h.has&&!!vis;
      if(!h.has||!vis)continue;
      const target=mulPt(h.g,p.lab),lp=S.lp[hi][p.id]||(S.lp[hi][p.id]=target.slice());
      for(let k=0;k<3;k++)lp[k]+=(target[k]-lp[k])*Math.min(1,dt*14);
      pan.model=TRS(lp[0],lp[1],lp[2],pan.w,pan.h,1,Math.atan2(hp.pos[0]-lp[0],hp.pos[2]-lp[2]));
    }
  }
}
/* схема мыши и клавиатуры: подсвечены органы, нужные на текущем шаге */
function drawDesk(c,p,id){
  const on=(...a)=>a.indexOf(id)>=0,W=p.W;
  const rr=(x,y,w,h,r,fill,hot)=>{c.fillStyle=hot?'#16a34a':fill||'#1e293b';c.strokeStyle=hot?'#bbf7d0':'#64748b';c.lineWidth=hot?6:3;c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();c.stroke();};
  const key=(x,y,w,l,hot)=>{rr(x,y,w,86,14,null,hot);p.text(l,x+w/2,y+22,{size:40,bold:true,align:'center',maxW:w});};
  p.text('Мышь и клавиатура',40,20,{size:54,bold:true});
  /* мышь */
  rr(90,150,230,340,110,'#1e293b',on('look'));
  rr(90,150,115,150,60,null,on('select'));rr(205,150,115,150,60,null,on('grab'));rr(176,190,48,80,22,'#475569',on('grab'));
  p.text('ЛКМ',148,215,{size:34,bold:true,align:'center',maxW:110});p.text('ПКМ',262,215,{size:34,bold:true,align:'center',maxW:110});
  p.text('мышь — взгляд',205,500,{size:34,align:'center',color:'#b8c7ea',maxW:300});
  /* WASD */
  const x0=470;key(x0+110,150,100,'W',on('walk'));key(x0,250,100,'A',on('walk'));key(x0+110,250,100,'S',on('walk'));key(x0+220,250,100,'D',on('walk'));
  key(x0-40,350,200,'Shift',on('walk'));key(x0+180,350,330,'Пробел',on('select'));
  key(x0+380,150,100,'E',on('grab'));key(x0+380,250,100,'M',on('menu'));key(x0+500,250,100,'F',false);
  /* подписи */
  const L=[['ЛКМ или Enter — выбрать, нажать',on('select')],['ПКМ или E (держать) — взять · колесо: дальше/ближе',on('grab')],['W A S D — идти · Shift — быстрее',on('walk')],['M или Tab — меню · F — полный экран · Esc — освободить мышь',on('menu')]];
  L.forEach(([t,h],i)=>p.text(t,40,560+i*52,{size:34,color:h?'#86efac':'#cbd5e1',bold:h,maxW:W-80}));
}
ROOMS.learn=lesson(false);
ROOMS.learnT=lesson(true);
/* кнопки входа — маленькая панель в холле, на задней стене между дверью информатики (x от -4.9 до -3.5) и панелью тестов учителя (от -1 до 1) */
VR.learn={hallPanel(E){
  E.addPanel({w:1.7,h:.9,pos:[-2.3,1.7,5.86],yaw:Math.PI,accent:'#22c55e',draw:(c,p)=>{
    p.text('Обучение',30,18,{size:52,bold:true});
    p.button(30,96,p.W-60,76,'Первые шаги',()=>E.goRoom('learn'),{bg:'#16a34a',size:38});
    p.button(30,190,p.W-60,76,'Для учителя',()=>E.goRoom('learnT'),{bg:'#7c3aed',size:38});
  }});
}};
})();

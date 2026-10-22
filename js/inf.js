/* inf.js — комната «Информатика» и её блоки наполнения (VR.PACKS).
   Блок = функция (E,S,o) -> панель; o = {pos,yaw,accent}. Какие блоки видит ученик, решает учитель по классам (Store.packOn).
   Логика блоков вынесена в чистые функции (VR.infTest) — их проверяют тесты. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,ROOMS=VR.ROOMS;
const {backDoor,YL,YR}=VR.RU;
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const pick=a=>a[rnd(0,a.length-1)];
const grade=E=>E.student&&E.student.grade?E.student.grade:5;
const band=E=>VR.Store.band(grade(E));

/* ---------- чистая логика ---------- */
/* робот: поле 5×5, робот смотрит вверх (dir 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево); команды F (вперёд), L, R */
const ROBOT_LEVELS=[
  {start:[0,4],star:[0,1],walls:[],max:6},
  {start:[0,4],star:[2,2],walls:[],max:8},
  {start:[0,4],star:[4,2],walls:[[0,2],[2,3]],max:12},
  {start:[2,4],star:[2,0],walls:[[2,2],[1,1],[3,3]],max:12}
];
const DX=[0,1,0,-1],DY=[-1,0,1,0];
function robotRun(level,prog){
  let x=level.start[0],y=level.start[1],d=0;const path=[[x,y]];let bump=false;
  const wall=(a,b)=>level.walls.some(w=>w[0]===a&&w[1]===b);
  for(const c of prog){
    if(c==='L')d=(d+3)%4;else if(c==='R')d=(d+1)%4;
    else{const nx=x+DX[d],ny=y+DY[d];if(nx<0||ny<0||nx>4||ny>4||wall(nx,ny)){bump=true;break;}x=nx;y=ny;path.push([x,y]);}
  }
  return{x,y,d,path,bump,win:x===level.star[0]&&y===level.star[1]};
}
function mixColor(r,g,b){return'rgb('+r+','+g+','+b+')';}
const RU32='АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
function caesar(word,k){
  let o='';for(const ch of word){const i=RU32.indexOf(ch);o+=i<0?ch:RU32[((i+k)%32+32)%32];}return o;
}
const WORDS={b:['ФАЙЛ','МЫШЬ','САЙТ','КОД','СЕТЬ'],c:['БРАУЗЕР','ПАРОЛЬ','ПРОЦЕССОР','АЛГОРИТМ','ПРИНТЕР'],d:['КОМПИЛЯТОР','ШИФРОВАНИЕ','ПРОТОКОЛ','ПЕРЕМЕННАЯ']};
const GATES={
  'И':(a,b)=>a&b,'ИЛИ':(a,b)=>a|b,'НЕ':a=>a^1,'ИСКЛ. ИЛИ':(a,b)=>a^b,'НЕ-И':(a,b)=>(a&b)^1
};
function bubbleStep(arr,st){ /* st={i,pass}; возвращает {arr,i,pass,swapped,done} — один шаг сравнения соседей */
  const a=arr.slice();let {i,pass}=st;
  if(i>=a.length-1-pass){i=0;pass++;}
  let swapped=false;
  if(a[i]>a[i+1]){const t=a[i];a[i]=a[i+1];a[i+1]=t;swapped=true;}
  const sorted=a.every((v,j)=>j===0||a[j-1]<=v);
  return{arr:a,i:i+1,pass,swapped,done:sorted,cmp:i};
}
VR.infTest={robotRun,ROBOT_LEVELS,caesar,RU32,GATES,bubbleStep,WORDS};

/* ---------- панели ---------- */
const P=VR.PACKS={};
const mk=(E,o,title,draw)=>E.addPanel({w:2.8,h:2.0,pos:o.pos,yaw:o.yaw,accent:o.accent,draw:(c,p)=>{p.text(title,36,20,{size:52,bold:true});draw(c,p);}});
const won=(E,key,label)=>{E.fanfare();E.discover('inf',key,label);};

P['inf-robot']=(E,S,o)=>{
  const b=band(E),levels=b==='a'?ROBOT_LEVELS.slice(0,2):ROBOT_LEVELS;
  const R={lv:0,prog:[],res:null,msg:'Собери программу и нажми «Пуск».'};
  const run=()=>{
    const L=levels[R.lv];R.res=robotRun(L,R.prog);
    if(R.res.win){R.msg='Звезда твоя! Команд: '+R.prog.length+'.';won(E,'robot'+R.lv,'Робот дошёл до звезды');}
    else R.msg=R.res.bump?'Робот упёрся в стену. Измени программу.':'Робот остановился не у звезды. Попробуй ещё.';
    pn.dirty=true;
  };
  const pn=mk(E,o,'Робот-исполнитель',(c,p)=>{
    const L=levels[R.lv],cell=70,gx=36,gy=96;
    for(let y=0;y<5;y++)for(let x=0;x<5;x++){
      c.fillStyle=L.walls.some(w=>w[0]===x&&w[1]===y)?'#475569':'#1e293b';c.fillRect(gx+x*cell,gy+y*cell,cell-4,cell-4);
    }
    if(R.res){c.fillStyle='rgba(34,211,238,.45)';for(const q of R.res.path)c.fillRect(gx+q[0]*cell+16,gy+q[1]*cell+16,cell-36,cell-36);}
    p.text('★',gx+L.star[0]*cell+14,gy+L.star[1]*cell+8,{size:46,color:'#fde047'});
    const rx=R.res?R.res.x:L.start[0],ry=R.res?R.res.y:L.start[1],rd=R.res?R.res.d:0;
    p.text('▲▶▼◀'[rd],gx+rx*cell+14,gy+ry*cell+8,{size:46,color:'#22d3ee'});
    p.text('Уровень '+(R.lv+1)+' из '+levels.length+'  ·  не больше '+L.max+' команд',420,96,{size:28,color:'#b8c7ea',maxW:570});
    p.text('Программа: '+(R.prog.length?R.prog.map(k=>({F:'↑',L:'↶',R:'↷'}[k])).join(' '):'пусто'),420,170,{size:40,bold:true,maxW:570});
    p.text(R.msg,420,300,{size:30,color:R.res&&R.res.win?'#86efac':'#cbd5e1',maxW:570});
    const full=R.prog.length>=L.max;
    p.button(36,470,150,84,'↑ вперёд',()=>{R.prog.push('F');R.res=null;pn.dirty=true;},{bg:'#0e7490',size:34,disabled:full});
    p.button(196,470,150,84,'↶ влево',()=>{R.prog.push('L');R.res=null;pn.dirty=true;},{bg:'#0e7490',size:34,disabled:full});
    p.button(356,470,150,84,'↷ вправо',()=>{R.prog.push('R');R.res=null;pn.dirty=true;},{bg:'#0e7490',size:34,disabled:full});
    p.button(516,470,150,84,'Стереть',()=>{R.prog.pop();R.res=null;pn.dirty=true;},{bg:'#475569',size:34});
    p.button(676,470,150,84,'Пуск',run,{bg:'#15803d',size:38,disabled:!R.prog.length});
    p.button(836,470,150,84,R.res&&R.res.win&&R.lv<levels.length-1?'Дальше':'Заново',()=>{
      if(R.res&&R.res.win&&R.lv<levels.length-1)R.lv++;R.prog=[];R.res=null;R.msg='Собери программу и нажми «Пуск».';pn.dirty=true;},{bg:'#334155',size:34});
  });
  return pn;
};

P['inf-colors']=(E,S,o)=>{
  const b=band(E),step=b==='a'?255:51;
  const newT=()=>{const f=()=>rnd(0,255/step)*step;return[f(),f(),f()];};
  const R={v:[0,0,0],t:newT(),done:false};
  while(R.t.every(x=>x===0))R.t=newT();
  const pn=mk(E,o,'Смешай цвет',(c,p)=>{
    c.fillStyle=mixColor(...R.t);c.fillRect(36,100,300,180);p.text('Нужен такой',36,288,{size:30,color:'#b8c7ea'});
    c.fillStyle=mixColor(...R.v);c.fillRect(380,100,300,180);p.text('У тебя',380,288,{size:30,color:'#b8c7ea'});
    p.text('Три лампы света складываются: красная + зелёная = жёлтый, все три = белый.',720,100,{size:30,color:'#cbd5e1',maxW:270});
    ['К','З','С'].forEach((nm,i)=>{
      const col=['#ef4444','#22c55e','#3b82f6'][i],x=36+i*325;
      p.button(x,350,80,84,'−',()=>{R.v[i]=Math.max(0,R.v[i]-step);chk();},{bg:col,size:46});
      p.text(nm+': '+R.v[i],x+92,372,{size:38,bold:true,maxW:116});
      p.button(x+210,350,80,84,'+',()=>{R.v[i]=Math.min(255,R.v[i]+step);chk();},{bg:col,size:46});
    });
    p.text(R.done?'Цвета совпали! Так экран получает любой цвет из трёх.':'Подбери такие же значения красного (К), зелёного (З), синего (С).',36,470,{size:32,color:R.done?'#86efac':'#cbd5e1',maxW:700});
    p.button(760,470,230,84,'Новый цвет',()=>{R.t=newT();R.v=[0,0,0];R.done=false;pn.dirty=true;},{bg:'#334155',size:34});
  });
  function chk(){const was=R.done;R.done=R.v.every((x,i)=>x===R.t[i]);if(R.done&&!was)won(E,'colors','Цвет собран из света');pn.dirty=true;}
  return pn;
};

P['inf-binary']=(E,S,o)=>{
  const b=band(E),n=b==='b'?4:8,max=b==='b'?15:b==='c'?100:255;
  const R={bits:new Array(n).fill(0),t:rnd(1,max),done:false};
  const val=()=>R.bits.reduce((s,x,i)=>s+x*Math.pow(2,n-1-i),0);
  const pn=mk(E,o,'Двоичные лампочки',(c,p)=>{
    p.text('Набери число '+R.t,36,92,{size:46,bold:true,color:'#fde047'});
    p.text('Сейчас: '+val(),560,98,{size:40,bold:true,color:R.done?'#86efac':'#e8efff'});
    const w=Math.min(110,Math.floor(940/n)),gap=Math.min(40,Math.floor((960-w*n)/(n-1||1))),x0=Math.round((1024-(w*n+gap*(n-1)))/2);
    R.bits.forEach((v,i)=>{
      const x=x0+i*(w+gap);
      p.text(String(Math.pow(2,n-1-i)),x+w/2,170,{size:34,align:'center',color:'#b8c7ea',maxW:w});
      p.button(x,222,w,w,v?'1':'0',()=>{R.bits[i]^=1;const was=R.done;R.done=val()===R.t;if(R.done&&!was)won(E,'binary'+n,'Число лампочками');pn.dirty=true;},{bg:v?'#facc15':'#334155',fg:v?'#0b1020':'#e2e8f0',size:56,r:w/2});
    });
    p.text(R.done?'Верно! Каждая лампочка — разряд: её вес складывается, если она горит.':'Нажимай лампочки. Над каждой — её вес, горящие складываются.',36,390,{size:32,color:R.done?'#86efac':'#cbd5e1',maxW:940});
    p.button(36,470,260,84,'Новое число',()=>{R.t=rnd(1,max);R.bits.fill(0);R.done=false;pn.dirty=true;},{bg:'#334155',size:34});
  });
  return pn;
};

P['inf-cipher']=(E,S,o)=>{
  const b=band(E),words=WORDS[b]||WORDS.b,R={};
  const newR=()=>{R.w=pick(words);R.k=rnd(1,6);R.enc=caesar(R.w,R.k);R.s=0;R.done=false;};newR();
  const pn=mk(E,o,'Шифр Цезаря',(c,p)=>{
    p.text('Каждая буква сдвинута по алфавиту. Подбери сдвиг назад, чтобы получилось слово.',36,90,{size:30,color:'#cbd5e1',maxW:940});
    p.text('Шифр:  '+R.enc,36,170,{size:60,bold:true,color:'#fde047'});
    p.text('Сдвиг назад на '+R.s+':  '+caesar(R.enc,-R.s),36,260,{size:60,bold:true,color:R.done?'#86efac':'#e8efff'});
    p.button(36,370,120,84,'−',()=>{R.s=Math.max(0,R.s-1);chk();},{bg:'#0e7490',size:50});
    p.button(176,370,120,84,'+',()=>{R.s=Math.min(31,R.s+1);chk();},{bg:'#0e7490',size:50});
    p.text(R.done?'Слово найдено! Чтобы расшифровать, надо знать сдвиг — это и есть «ключ».':'Нажимай + и − и смотри на результат.',330,380,{size:30,color:R.done?'#86efac':'#cbd5e1',maxW:660});
    p.button(36,470,260,84,'Другое слово',()=>{newR();pn.dirty=true;},{bg:'#334155',size:34});
  });
  function chk(){const was=R.done;R.done=R.s===R.k;if(R.done&&!was)won(E,'cipher','Шифр Цезаря расшифрован');pn.dirty=true;}
  return pn;
};

P['inf-gates']=(E,S,o)=>{
  const b=band(E),names=b==='c'?['И','ИЛИ','НЕ']:['И','ИЛИ','НЕ','ИСКЛ. ИЛИ','НЕ-И'];
  const R={};
  const newR=()=>{R.g=pick(names);R.a=0;R.b=0;const out=GATES[R.g](R.a,R.b);R.t=out^1;R.done=false;
    /* цель достижима для любых вентилей: у НЕ — оба значения, у остальных — тоже */};newR();
  const out=()=>GATES[R.g](R.a,R.b);
  const pn=mk(E,o,'Логические вентили',(c,p)=>{
    p.text('Вентиль: '+R.g,36,92,{size:48,bold:true,color:'#fde047'});
    p.text('Сделай выход равным '+R.t,520,100,{size:38,bold:true,maxW:470});
    p.button(36,200,150,110,'A = '+R.a,()=>{R.a^=1;chk();},{bg:R.a?'#facc15':'#334155',fg:R.a?'#0b1020':'#e2e8f0',size:46});
    if(R.g!=='НЕ')p.button(36,330,150,110,'B = '+R.b,()=>{R.b^=1;chk();},{bg:R.b?'#facc15':'#334155',fg:R.b?'#0b1020':'#e2e8f0',size:46});
    p.text('→ '+R.g+' →',210,290,{size:38,bold:true,color:'#22d3ee',maxW:440});
    p.text('Выход = '+out(),660,280,{size:52,bold:true,maxW:340,color:R.done?'#86efac':'#e8efff'});
    p.text(R.done?'Верно!':'Переключай входы A'+(R.g==='НЕ'?'':' и B')+' и смотри на выход.',230,390,{size:30,color:R.done?'#86efac':'#cbd5e1',maxW:760});
    p.button(36,470,260,84,'Другой вентиль',()=>{newR();pn.dirty=true;},{bg:'#334155',size:34});
  });
  function chk(){const was=R.done;R.done=out()===R.t;if(R.done&&!was)won(E,'gate','Логический вентиль');pn.dirty=true;}
  return pn;
};

P['inf-sort']=(E,S,o)=>{
  const n=band(E)==='c'?6:8;
  const R={};
  const newR=()=>{const a=[];for(let i=1;i<=n;i++)a.push(i);for(let i=n-1;i>0;i--){const j=rnd(0,i),t=a[i];a[i]=a[j];a[j]=t;}
    if(a.every((v,i)=>i===0||a[i-1]<=v)){a.reverse();}
    R.a=a;R.sel=-1;R.moves=0;R.st={i:0,pass:0};R.cmp=-1;R.done=false;};newR();
  const fin=()=>{R.done=R.a.every((v,i)=>i===0||R.a[i-1]<=v);if(R.done)won(E,'sort'+n,'Сортировка');};
  const pn=mk(E,o,'Сортировка пузырьком',(c,p)=>{
    const w=Math.floor(900/n)-10;
    R.a.forEach((v,i)=>{
      const h=v*38,x=36+i*(w+10);
      c.fillStyle=R.cmp===i||R.cmp+1===i&&R.cmp>=0?'#facc15':i===R.sel?'#22d3ee':'#3b82f6';
      c.fillRect(x,430-h,w,h);
      p.text(String(v),x+w/2,430-h-34,{size:30,align:'center',maxW:w});
      p.area(x,430-h-40,w,h+40,()=>{
        if(R.done)return;
        if(R.sel<0)R.sel=i;
        else if(Math.abs(R.sel-i)===1){const t=R.a[R.sel];R.a[R.sel]=R.a[i];R.a[i]=t;R.moves++;R.sel=-1;fin();}
        else R.sel=i===R.sel?-1:i;
        R.cmp=-1;pn.dirty=true;});
    });
    p.text(R.done?'Готово за '+R.moves+' обменов! Пузырёк «всплывает»: большие числа уходят вправо.':'Выбери столбик и соседний — они поменяются местами. Или нажми «Шаг»: так делает компьютер.',36,448,{size:28,color:R.done?'#86efac':'#cbd5e1',maxW:640});
    p.button(700,458,150,84,'Шаг',()=>{
      if(R.done)return;const r=bubbleStep(R.a,R.st);R.a=r.arr;R.st={i:r.i,pass:r.pass};R.cmp=r.cmp;if(r.swapped)R.moves++;R.sel=-1;fin();pn.dirty=true;},{bg:'#0e7490',size:36,disabled:R.done});
    p.button(860,458,130,84,'Заново',()=>{newR();pn.dirty=true;},{bg:'#334155',size:32});
  });
  return pn;
};

/* ---------- комната ---------- */
const SLOTS=[
  {pos:[-3.2,1.75,-5.86],yaw:0},{pos:[0,1.75,-5.86],yaw:0},{pos:[3.2,1.75,-5.86],yaw:0},
  {pos:[-5.86,1.75,-2.2],yaw:YL},{pos:[-5.86,1.75,2.4],yaw:YL},{pos:[5.86,1.75,-3.2],yaw:YR}
];
ROOMS.inf={
  title:'Информатика',env:{floor:[.03,.1,.14],wall:[.06,.18,.24],trim:[.13,.83,.93],grid:[.13,.83,.93]},
  hint:'Информатика: на стенах задания по твоему классу. Справа — тест.',
  build(E,S){
    backDoor(E);
    const g=grade(E),ids=(D.packs||[]).filter(p=>p.room==='inf'&&VR.Store.packOn(p.id,g)&&P[p.id]).map(p=>p.id);
    S.packs=ids;
    ids.slice(0,SLOTS.length).forEach((id,i)=>P[id](E,S,{pos:SLOTS[i].pos,yaw:SLOTS[i].yaw,accent:D.subjects.inf.color}));
    if(!ids.length)E.addPanel({w:2.8,h:.8,pos:[0,1.75,-5.86],yaw:0,accent:'#22d3ee',draw:(c,p)=>{p.text('Для твоего класса заданий пока нет.',36,30,{size:48,bold:true});p.text('Попроси учителя включить их.',36,100,{size:34,color:'#cbd5e1'});}});
    VR.makeQuiz(E,'inf',[5.86,1.5,1.5],YR);
  },
  targets(){return[];},
  draw(){}
};
})();

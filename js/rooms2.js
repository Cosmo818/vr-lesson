/* rooms2.js — комнаты: биология, обществознание, логика, история России. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,M=VR.M,TRS=VR.TRS,ROOMS=VR.ROOMS;
const {shuffle,faceTo,backDoor,YL,YR}=VR.RU;
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const quizAt=(E,subj)=>VR.makeQuiz(E,subj,[5.86,1.5,1.5],YR);
const hexc=VR.hex;

/* галерея: постаменты вдоль левой стены, подписи и общая панель с описанием */
function gallery(E,S,subj,items,title,intro,accent){
  S.g=items.map((it,i)=>({it,i,x:-4.3,z:-3+i*1.2,col:hexc(it.col),m:E.mesh[it.shape]||E.mesh.sphere}));
  S.gsel=-1;
  for(const g of S.g){
    E.addStatic(E.mesh.cyl,TRS(g.x,.45,g.z,.34,.9,.34),[.25,.22,.3]);E.addBox({x:g.x,z:g.z,hx:.17,hz:.17,top:.9});
    E.addPanel({w:1.0,h:.26,res:512,pos:[g.x,1.78,g.z],yaw:YL,accent:g.it.col,draw:(c,p)=>p.text(g.it.name,p.W/2,p.H/2-22,{size:38,bold:true,align:'center'})});
  }
  S.ginfo=E.addPanel({w:2.8,h:1.0,pos:[-5.86,2.4,0],yaw:YL,accent,draw:(c,p)=>{
    if(S.gsel<0){p.text(title,40,26,{size:56,bold:true});p.text(intro,40,108,{size:36,color:'#cbd5e1'});return;}
    const it=items[S.gsel];
    p.text(it.name,40,22,{size:58,bold:true,color:it.col});
    if(it.sub)p.text(it.sub,p.W-40,34,{size:36,align:'right',color:'#b8c7ea',maxW:300});
    p.text(it.text,40,106,{size:36,color:'#e2e8f0'});
  }});
  S.gpick=i=>{S.gsel=i;S.ginfo.dirty=true;E.discover(subj,'g_'+items[i].key,items[i].name);E.beep(700,.08);};
}
const galleryTargets=S=>S.g.map(g=>({c:[g.x,1.25,g.z],r:.3,id:'g'+g.i,sel:()=>S.gpick(g.i)}));
function galleryDraw(E,S,add){
  for(const g of S.g){const k=g.i===S.gsel?.48:.4;add(g.m,M.mul(M.trans(g.x,1.25+Math.sin(E.t*1.4+g.i)*.03,g.z),M.mul(M.rotY(E.t*.6+g.i),M.mul(M.rotX(.3),M.scale(k,k,k)))),g.col,g.i===S.gsel?.4:.08);}
}

/* ======================= БИОЛОГИЯ ======================= */
const CELL=[-2.3,1.5,-3.7],DNA0=[2.4,0,-3.8];
const ORG=[
  {key:'nucleus',name:'Ядро',p:[0,0,0],s:[.4,.4,.4],col:[.55,.3,.9],text:'Хранит ДНК — «инструкцию» для всей клетки. Окружено двойной мембраной.'},
  {key:'mito',name:'Митохондрия',p:[.48,.22,.18],s:[.32,.14,.14],col:[1,.55,.2],text:'«Энергетическая станция»: здесь из питательных веществ получается энергия в виде АТФ.'},
  {key:'mito',name:'Митохондрия',p:[-.42,-.32,.28],s:[.3,.13,.13],col:[1,.55,.2],text:'«Энергетическая станция»: здесь из питательных веществ получается энергия в виде АТФ.'},
  {key:'er',name:'Эндоплазматическая сеть',p:[-.25,.42,-.2],s:[.36,.06,.24],col:[.3,.75,.95],text:'Сеть каналов: по ней перемещаются вещества. На шероховатой ЭПС сидят рибосомы.'},
  {key:'golgi',name:'Аппарат Гольджи',p:[.36,-.38,-.22],s:[.28,.06,.2],col:[.95,.75,.3],text:'Упаковывает и сортирует вещества и отправляет их по назначению.'},
  {key:'lyso',name:'Лизосома',p:[-.55,.12,-.32],s:[.13,.13,.13],col:[.9,.3,.35],text:'Пузырёк с ферментами: переваривает ненужные частицы.'},
  {key:'chloro',name:'Хлоропласт',p:[.12,.56,.36],s:[.26,.12,.14],col:[.3,.85,.35],text:'Есть только у растений: здесь идёт фотосинтез. Зелёный из-за хлорофилла.'},
  {key:'vac',name:'Вакуоль',p:[.05,-.5,.42],s:[.26,.22,.22],col:[.6,.8,1],text:'Пузырь с клеточным соком. У растений большая и поддерживает форму клетки.'},
  {key:'ribo',name:'Рибосомы',p:[.25,.2,-.55],s:[.06,.06,.06],col:[.95,.95,.45],text:'Крошечные «фабрики» белка. В одной клетке их миллионы.'}
];
const DNA_SEQ='ATGCGTACCTGAATGC',BASE={A:[.95,.3,.3],T:[.3,.6,1],G:[.3,.85,.4],C:[.98,.85,.3]},PAIR={A:'T',T:'A',G:'C',C:'G'};
const CHAINS=[['Трава','Заяц','Лиса'],['Зерно','Мышь','Сова'],['Водоросли','Мелкая рыба','Щука'],['Листья','Гусеница','Синица','Ястреб'],['Планктон','Криль','Кит']];
ROOMS.bio={
  title:'Биология',env:{floor:[.14,.06,.12],wall:[.28,.12,.24],trim:[1,.5,.8],grid:[1,.5,.8]},
  hint:'Биология: выбери лучом часть клетки или ДНК. Слева на стене собери пищевую цепь.',
  build(E,S){
    backDoor(E);
    S.sel=null;S.rot=0;
    S.info=E.addPanel({w:2.6,h:1.0,pos:[0,2.35,-5.86],yaw:0,accent:'#f472b6',draw:(c,p)=>{
      if(!S.sel){p.text('Клетка и ДНК',40,26,{size:58,bold:true});p.text('Слева — модель клетки, справа — молекула ДНК. Наведи луч на часть клетки или на ДНК и нажми курок.',40,110,{size:36,color:'#cbd5e1'});return;}
      p.text(S.sel.name,40,22,{size:58,bold:true,color:'#fbcfe8'});p.text(S.sel.text,40,106,{size:36,color:'#e2e8f0'});
    }});
    E.addStatic(E.mesh.cyl,TRS(CELL[0],.25,CELL[2],.6,.5,.6),[.3,.2,.3]);
    E.addStatic(E.mesh.cyl,TRS(DNA0[0],.04,DNA0[2],.8,.08,.8),[.3,.2,.3]);
    /* пищевая цепь */
    const newChain=()=>{S.ci=(S.ci===undefined?rnd(0,CHAINS.length-1):(S.ci+1)%CHAINS.length);S.picked=[];S.opts=shuffle(CHAINS[S.ci].slice());S.fmsg='';};
    newChain();
    const pick=name=>{
      const ch=CHAINS[S.ci];
      if(S.picked.length>=ch.length)return;
      if(name===ch[S.picked.length]){S.picked.push(name);E.beep(600+S.picked.length*80,.08);
        if(S.picked.length===ch.length){S.fmsg='Верно! Энергия переходит от растений к животным.';E.chime();E.discover('bio','chain_'+S.ci,'Пищевая цепь: '+ch.join(' → '));}}
      else{S.fmsg='Не то звено. Цепь начинается с растения — попробуй снова.';S.picked=[];E.beep(200,.25,'sawtooth',.04);}
    };
    S.fc=E.addPanel({w:2.3,h:1.35,pos:[-5.86,1.6,.6],yaw:YL,accent:'#86efac',draw:(c,p)=>{
      const W=p.W,ch=CHAINS[S.ci];
      p.text('Пищевая цепь',36,24,{size:54,bold:true});
      p.text('Нажимай по порядку: кто кого ест, начиная с растения.',36,96,{size:32,color:'#cbd5e1'});
      p.text(S.picked.length?S.picked.join(' → ')+(S.picked.length<ch.length?' → …':''):'…',36,156,{size:40,bold:true,color:'#fde68a'});
      const bw=(W-72-(S.opts.length-1)*16)/S.opts.length;
      S.opts.forEach((o,i)=>p.button(36+i*(bw+16),236,bw,110,o,()=>pick(o),{bg:S.picked.includes(o)?'#15803d':'#334155',size:34,disabled:S.picked.includes(o)}));
      p.text(S.fmsg,36,370,{size:32,color:S.picked.length===ch.length?'#86efac':'#fca5a5',maxY:p.H-130});
      p.button(W-416,p.H-122,380,96,'Другая цепь',()=>newChain(),{bg:'#be185d',size:38});
    }});
    quizAt(E,'bio');
  },
  targets(E,S){
    const t=ORG.map((o,i)=>({c:orgPos(S,o),r:Math.max(...o.s)/2+.06,id:'org'+i,sel:()=>{S.sel=o;S.info.dirty=true;E.discover('bio','org_'+o.key,o.name);E.beep(700,.08);}}));
    for(const h of[.9,1.5,2.1])t.push({c:[DNA0[0],h,DNA0[2]],r:.36,id:'dna'+h,sel:()=>{S.sel={name:'ДНК',text:'Двойная спираль из двух цепочек. Основания соединяются парами: А — Т (красный — синий) и Г — Ц (зелёный — жёлтый). Шаг спирали — около 10 пар оснований.'};S.info.dirty=true;E.discover('bio','dna','Двойная спираль ДНК');E.beep(700,.08);}});
    return t;
  },
  update(E,S,dt){S.rot+=dt*.15;},
  draw(E,S,add){
    const R=M.mul(M.trans(CELL[0],CELL[1],CELL[2]),M.rotY(S.rot));
    for(const [rx,ry] of[[0,0],[Math.PI/2,0],[Math.PI/2,Math.PI/2]])add(E.mesh.circle,M.mul(R,M.mul(M.rotY(ry),M.mul(M.rotX(rx),M.scale(.95,1,.95)))),[1,.6,.85],1,3);
    add(E.mesh.sphere,M.mul(R,M.scale(.08,.08,.08)),[.35,.15,.45],.6);
    for(const o of ORG){
      const k=S.sel===o?1.15:1;
      if(o.key==='ribo'){for(let i=0;i<7;i++){const a=i*.9;add(E.mesh.ball,M.mul(R,TRS(o.p[0]+Math.cos(a)*.18,o.p[1]+Math.sin(a*1.3)*.15,o.p[2]+Math.sin(a)*.12,.05*k,.05*k,.05*k)),o.col,.3);}continue;}
      if(o.key==='golgi'||o.key==='er'){for(let i=0;i<3;i++)add(E.mesh.sphere,M.mul(R,TRS(o.p[0],o.p[1]+(i-1)*.07,o.p[2],o.s[0]*k*(1-i*.12),o.s[1]*k,o.s[2]*k)),o.col,S.sel===o?.4:.1);continue;}
      add(E.mesh.sphere,M.mul(R,TRS(o.p[0],o.p[1],o.p[2],o.s[0]*k,o.s[1]*k,o.s[2]*k)),o.col,S.sel===o?.45:.1);
    }
    const base=M.mul(M.trans(DNA0[0],0,DNA0[2]),M.rotY(E.t*.4));
    for(let i=0;i<DNA_SEQ.length;i++){
      const a=i*.62,y=.55+i*.125,b=DNA_SEQ[i],x=Math.cos(a)*.3,z=Math.sin(a)*.3;
      add(E.mesh.ball,M.mul(base,TRS(x,y,z,.08,.08,.08)),[.85,.85,.9],.2);
      add(E.mesh.ball,M.mul(base,TRS(-x,y,-z,.08,.08,.08)),[.85,.85,.9],.2);
      add(E.mesh.cube,M.mul(base,M.mul(M.trans(x*.5,y,z*.5),M.mul(M.rotY(-a),M.scale(.3,.035,.035)))),BASE[b],.35);
      add(E.mesh.cube,M.mul(base,M.mul(M.trans(-x*.5,y,-z*.5),M.mul(M.rotY(-a),M.scale(.3,.035,.035)))),BASE[PAIR[b]],.35);
    }
  }
};
function orgPos(S,o){const c=Math.cos(S.rot),s=Math.sin(S.rot);return[CELL[0]+c*o.p[0]+s*o.p[2],CELL[1]+o.p[1],CELL[2]-s*o.p[0]+c*o.p[2]];}

/* ======================= ОБЩЕСТВОЗНАНИЕ ======================= */
const CONCEPTS=[
  {key:'family',name:'Семья',col:'#f472b6',shape:'sphere',text:'Малая группа, основанная на браке или родстве. Здесь человек впервые учится жить вместе с другими.'},
  {key:'state',name:'Государство',col:'#60a5fa',shape:'cube',text:'Организация власти в стране: принимает законы, обеспечивает порядок, оборону и общественные службы.'},
  {key:'law',name:'Право',col:'#a78bfa',shape:'octa',text:'Система общеобязательных правил — законов, соблюдение которых обеспечивает государство.'},
  {key:'econ',name:'Экономика',col:'#facc15',shape:'cyl',text:'Хозяйство: производство, обмен, распределение и потребление товаров и услуг.'},
  {key:'culture',name:'Культура',col:'#34d399',shape:'icosa',text:'Всё, что создано человеком: язык, искусство, традиции, знания и ценности.'},
  {key:'edu',name:'Образование',col:'#fb923c',shape:'dodeca',text:'Получение знаний, умений и опыта — в семье, школе, университете и всю жизнь.'}
];
const BUDGET=1000;
const ITEMS=[['Продукты',450,1],['Проезд',150,1],['Тетради и ручки',120,1],['Подарок другу',200,0],['Кино с друзьями',250,0],['Новая игра',400,0],['Мороженое',80,0],['В копилку',100,2]];
ROOMS.soc={
  title:'Обществознание',env:{floor:[.14,.12,.05],wall:[.3,.26,.12],trim:[1,.85,.3],grid:[1,.85,.35]},
  hint:'Обществознание: составь бюджет на передней стене. Слева — главные понятия общества.',
  build(E,S){
    backDoor(E);
    gallery(E,S,'soc',CONCEPTS,'Основы общества','Наведи луч на фигуру на постаменте и нажми курок, чтобы узнать понятие.','#facc15');
    S.on=new Set();S.msg='';
    const total=()=>[...S.on].reduce((a,i)=>a+ITEMS[i][1],0);
    const check=()=>{
      const t=total(),needs=ITEMS.map((x,i)=>x[2]===1?i:-1).filter(i=>i>=0),miss=needs.filter(i=>!S.on.has(i));
      if(t>BUDGET){S.msg='Перерасход на '+(t-BUDGET)+' ₽! Убери что-то из желаний.';S.ok=false;E.beep(200,.25,'sawtooth',.04);}
      else if(miss.length){S.msg='Ты забыл необходимое: '+miss.map(i=>ITEMS[i][0]).join(', ')+'.';S.ok=false;E.beep(220,.2);}
      else{S.ok=true;S.msg='Бюджет сбалансирован! Остаток: '+(BUDGET-t)+' ₽'+(S.on.has(7)?', и ты ещё отложил в копилку.':'.');E.chime();E.discover('soc','budget','Семейный бюджет');}
      S.bp.dirty=true;
    };
    S.bp=E.addPanel({w:3.2,h:2.0,pos:[0,1.7,-5.86],yaw:0,accent:'#facc15',draw:(c,p)=>{
      const W=p.W,t=total();
      p.text('Бюджет на месяц: '+BUDGET+' ₽',36,26,{size:56,bold:true});
      p.text('Выбрано: '+t+' ₽   ·   Осталось: '+(BUDGET-t)+' ₽',36,104,{size:40,bold:true,color:t>BUDGET?'#f87171':'#fde68a'});
      ITEMS.forEach(([n,pr,ty],i)=>{
        const x=36+(i%2)*484,y=168+((i/2)|0)*88,on=S.on.has(i);
        p.button(x,y,464,76,(on?'✓ ':'')+n+' — '+pr+' ₽'+(ty===1?' (нужно)':ty===2?' (сбережения)':''),()=>{on?S.on.delete(i):S.on.add(i);S.msg='';},{bg:on?'#15803d':'#334155',size:32});
      });
      p.button(36,p.H-104,300,84,'Проверить',check,{bg:'#ca8a04',size:40});
      p.text(S.msg||'Сначала выбери всё необходимое, потом то, чего хочется.',360,p.H-100,{size:30,color:S.msg?(S.ok?'#86efac':'#fca5a5'):'#94a3b8',maxW:W-390});
    }});
    quizAt(E,'soc');
  },
  targets(E,S){return galleryTargets(S);},
  draw(E,S,add){galleryDraw(E,S,add);}
};

/* ======================= ЛОГИКА ======================= */
const HAN=[0,-3.7],PEGS=[-.75,0,.75],HTOP=.8;
function seqGen(band){
  const gens={
    ar:()=>{const a=rnd(1,9),d=rnd(2,9);return[0,1,2,3,4,5].map(i=>a+d*i);},
    dn:()=>{const a=rnd(30,60),d=rnd(2,6);return[0,1,2,3,4,5].map(i=>a-d*i);},
    geo:()=>{const a=rnd(1,3),r=rnd(2,3);return[0,1,2,3,4,5].map(i=>a*Math.pow(r,i));},
    sq:()=>{const s=rnd(1,4);return[0,1,2,3,4,5].map(i=>(i+s)*(i+s));},
    fib:()=>{const r=[rnd(1,4),rnd(1,5)];while(r.length<6)r.push(r[r.length-1]+r[r.length-2]);return r;},
    alt:()=>{const a=rnd(1,5),b=rnd(6,9),r=[rnd(1,9)];while(r.length<6)r.push(r[r.length-1]+(r.length%2?a:b));return r;},
    sq1:()=>{const s=rnd(1,3);return[0,1,2,3,4,5].map(i=>(i+s)*(i+s)+1);},
    pr:()=>{const P=[2,3,5,7,11,13,17,19,23,29,31,37],s=rnd(0,5);return P.slice(s,s+6);}
  };
  const pool={a:['ar','dn'],b:['ar','dn','geo','fib'],c:['ar','geo','sq','fib','alt'],d:['geo','sq','fib','alt','sq1','pr']}[band]||['ar'];
  const seq=gens[pool[rnd(0,pool.length-1)]](),ans=seq[5],opts=new Set([ans]);
  while(opts.size<4){const d=rnd(1,Math.max(3,Math.round(Math.abs(ans)*.25)));const v=ans+(Math.random()<.5?-d:d);if(v!==ans)opts.add(v);}
  return{shown:seq.slice(0,5),ans,opts:shuffle([...opts])};
}
ROOMS.logic={
  title:'Логика',env:{floor:[.04,.12,.13],wall:[.08,.22,.24],trim:[.3,1,.9],grid:[.3,1,.9]},
  hint:'Логика: перенеси Ханойскую башню на правый стержень. Слева — угадай число в ряду.',
  build(E,S){
    backDoor(E);
    E.addTable(HAN[0],HAN[1],1.25,.35,HTOP,[.2,.3,.35]);
    for(const x of PEGS)E.addStatic(E.mesh.cyl,TRS(x,HTOP+.28,HAN[1],.05,.56,.05),[.8,.75,.6]);
    const reset=n=>{S.n=n||S.n||3;S.pegs=[[],[],[]];for(let i=S.n;i>=1;i--)S.pegs[0].push(i);S.held=null;S.from=-1;S.moves=0;S.done=false;S.hmsg='';if(S.hp)S.hp.dirty=true;};
    reset(3);
    S.peg=i=>{
      if(S.done)return;
      if(S.held===null){if(!S.pegs[i].length){E.beep(200,.12);return;}S.held=S.pegs[i].pop();S.from=i;E.beep(600,.06);}
      else{
        const top=S.pegs[i][S.pegs[i].length-1];
        if(top!==undefined&&top<S.held){S.hmsg='Нельзя класть большой диск на меньший!';E.beep(180,.3,'sawtooth',.04);S.hp.dirty=true;return;}
        S.pegs[i].push(S.held);S.held=null;if(i!==S.from)S.moves++;S.hmsg='';E.beep(500,.06);
        if(S.pegs[2].length===S.n){S.done=true;const min=Math.pow(2,S.n)-1;S.hmsg=S.moves===min?'Идеально! За минимальное число ходов.':'Готово! Попробуй за '+min+' ходов.';E.fanfare();E.burst([.75,1.4,HAN[1]],50);E.discover('logic','hanoi'+S.n,'Ханойская башня из '+S.n+' дисков');}
      }
      S.hp.dirty=true;
    };
    S.hp=E.addPanel({w:2.6,h:1.05,pos:[0,2.15,-5.86],yaw:0,accent:'#2dd4bf',draw:(c,p)=>{
      const W=p.W,min=Math.pow(2,S.n)-1;
      p.text('Ханойская башня',36,22,{size:54,bold:true});
      p.text('Ходов: '+S.moves+'  ·  минимум: '+min,W-36,30,{size:38,bold:true,align:'right',color:'#fde68a',maxW:440});
      p.text(S.hmsg||'Перенеси все диски на правый стержень. Луч на стержень + курок: взять верхний диск, ещё раз — положить. Больший диск нельзя класть на меньший.',36,96,{size:31,color:S.hmsg?'#fde68a':'#cbd5e1',maxY:300});
      [3,4,5].forEach((n,i)=>p.button(36+i*190,p.H-110,170,88,n===5?'5 дисков':n+' диска',()=>reset(n),{active:S.n===n,activeBg:'#0d9488',bg:'#334155',size:34}));
      p.button(W-300,p.H-110,264,88,'Заново',()=>reset(S.n),{bg:'#0f766e',size:38});
    }});
    /* последовательности */
    const grade=()=>E.student&&E.student.grade?E.student.grade:5;
    const newSeq=()=>{S.sq=seqGen(VR.Store.band(grade()));S.smsg='';};
    S.streak=0;newSeq();
    const ans=v=>{
      const right=S.sq.ans;
      if(v===right){S.streak++;E.chime();if(S.streak===3)E.discover('logic','seq','Мастер последовательностей');newSeq();S.smsg='Верно! Серия: '+S.streak;}
      else{S.streak=0;E.beep(200,.25,'sawtooth',.04);newSeq();S.smsg='Неверно, правильно было '+right+'. Серия сброшена.';}
    };
    E.addPanel({w:2.3,h:1.25,pos:[-5.86,1.6,.4],yaw:YL,accent:'#5eead4',draw:(c,p)=>{
      const W=p.W;
      p.text('Какое число следующее?',36,24,{size:52,bold:true});
      p.text(S.sq.shown.join(',  ')+',  ?',W/2,120,{size:64,bold:true,align:'center',color:'#fde68a'});
      const bw=(W-72-48)/4;
      S.sq.opts.forEach((v,i)=>p.button(36+i*(bw+16),236,bw,110,String(v),()=>ans(v),{bg:'#334155',size:50}));
      p.text(S.smsg||'Найди закономерность. 3 верных ответа подряд — открытие!',36,380,{size:32,color:'#cbd5e1'});
      p.text('Серия: '+S.streak,W-36,p.H-70,{size:34,bold:true,align:'right',color:'#5eead4',maxW:300});
    }});
    quizAt(E,'logic');
  },
  targets(E,S){return PEGS.map((x,i)=>({c:[x,HTOP+.3,HAN[1]],r:.32,id:'peg'+i,sel:()=>S.peg(i)}));},
  draw(E,S,add){
    const cols=[[.95,.35,.35],[.98,.65,.25],[.95,.9,.3],[.4,.85,.45],[.35,.6,1]];
    S.pegs.forEach((pg,pi)=>pg.forEach((d,k)=>{const w=.12+d*.06;add(E.mesh.cyl,TRS(PEGS[pi],HTOP+.03+k*.055,HAN[1],w,.05,w),cols[d-1],.2);}));
    if(S.held!==null){const w=.12+S.held*.06;add(E.mesh.cyl,TRS(PEGS[S.from],HTOP+.75+Math.sin(E.t*4)*.02,HAN[1],w,.05,w),cols[S.held-1],.5);}
  }
};

/* ======================= ИСТОРИЯ РОССИИ ======================= */
const EVENTS=[
  ['862','Призвание Рюрика','По летописи, Рюрик призван княжить в Новгород. Начало династии Рюриковичей.'],
  ['988','Крещение Руси','Князь Владимир Святославич принимает христианство для всей Руси.'],
  ['1147','Первое упоминание Москвы','Москва впервые названа в летописи в связи с князем Юрием Долгоруким.'],
  ['1242','Ледовое побоище','Войско Александра Невского побеждает на льду Чудского озера.'],
  ['1380','Куликовская битва','Войско под руководством Дмитрия Донского одерживает победу на Куликовом поле.'],
  ['1480','Стояние на Угре','Противостояние на реке Угре. Его считают концом зависимости Руси от Орды.'],
  ['1547','Первый царь','Иван IV венчается на царство и становится первым русским царём.'],
  ['1613','Династия Романовых','Земский собор избирает царём Михаила Фёдоровича Романова.'],
  ['1703','Основание Петербурга','Пётр I закладывает Санкт-Петербург в устье Невы.'],
  ['1755','Московский университет','По проекту М. В. Ломоносова и при участии И. И. Шувалова основан Московский университет.'],
  ['1812','Отечественная война','Армия Наполеона вторгается в Россию. Бородинское сражение, главнокомандующий — М. И. Кутузов.'],
  ['1861','Отмена крепостного права','Александр II подписывает манифест об освобождении крестьян.'],
  ['1891','Транссибирская магистраль','Начинается строительство одной из самых длинных железных дорог мира.'],
  ['1922','Образование СССР','Образован Союз Советских Социалистических Республик.'],
  ['1941','Начало Великой Отечественной','22 июня 1941 года началась Великая Отечественная война.'],
  ['1945','День Победы','9 мая 1945 года — Победа в Великой Отечественной войне.'],
  ['1954','Первая АЭС','В Обнинске заработала первая в мире атомная электростанция, подключённая к сети.'],
  ['1957','Первый спутник','4 октября запущен первый искусственный спутник Земли.'],
  ['1961','Полёт Гагарина','12 апреля Юрий Гагарин совершает первый полёт человека в космос.'],
  ['1980','Олимпиада в Москве','В Москве проходят XXII летние Олимпийские игры.']
];
const SCI=[
  {key:'lomonosov',name:'Михаил Ломоносов',sub:'1711–1765',col:'#fbbf24',shape:'sphere',text:'Учёный-энциклопедист: химия, физика, астрономия, поэзия, мозаика. Открыл атмосферу у Венеры.'},
  {key:'mendeleev',name:'Дмитрий Менделеев',sub:'1834–1907',col:'#4ade80',shape:'cube',text:'В 1869 году открыл периодический закон и составил таблицу химических элементов.'},
  {key:'popov',name:'Александр Попов',sub:'1859–1906',col:'#60a5fa',shape:'cyl',text:'Один из изобретателей радио: в 1895 году показал прибор для приёма радиосигналов.'},
  {key:'pavlov',name:'Иван Павлов',sub:'1849–1936',col:'#f472b6',shape:'octa',text:'Физиолог, изучал пищеварение и условные рефлексы. Первый российский нобелевский лауреат (1904).'},
  {key:'tsiolkovsky',name:'Константин Циолковский',sub:'1857–1935',col:'#a78bfa',shape:'cone',text:'Основоположник теории космических полётов, вывел формулу движения ракеты.'},
  {key:'korolev',name:'Сергей Королёв',sub:'1907–1966',col:'#f87171',shape:'icosa',text:'Главный конструктор ракетно-космической техники: первый спутник (1957) и корабль «Восток» Гагарина (1961).'}
];
ROOMS.hist={
  title:'История России',env:{floor:[.14,.1,.06],wall:[.3,.21,.12],trim:[1,.75,.4],grid:[1,.75,.4]},
  hint:'История: выбирай события на ленте времени. Слева — галерея учёных.',
  build(E,S){
    backDoor(E);
    gallery(E,S,'hist',SCI,'Галерея учёных','Наведи луч на постамент и нажми курок, чтобы узнать об учёном.','#d6a066');
    S.ev=-1;
    S.tl=E.addPanel({w:4.8,h:2.0,res:1600,pos:[0,1.75,-5.86],yaw:0,accent:'#d6a066',draw:(c,p)=>{
      const W=p.W;
      p.text('Лента времени: история России до 1991 года',36,20,{size:50,bold:true});
      c.fillStyle='#d6a066';c.fillRect(36,178,W-72,6);c.fillRect(36,286,W-72,6);
      const per=10,bw=(W-72-(per-1)*12)/per;
      EVENTS.forEach((e,i)=>{const r=(i/per)|0,k=i%per;p.button(36+k*(bw+12),100+r*108,bw,72,e[0],()=>{S.ev=i;S.tl.dirty=true;E.discover('hist','ev_'+e[0],e[0]+' — '+e[1]);E.beep(700,.06);},{bg:S.ev===i?'#d6a066':'#3b2f22',fg:S.ev===i?'#1c1206':'#fde68a',size:40});});
      if(S.ev<0){p.text('Наведи луч на год и нажми курок. Каждое событие — новое открытие.',36,340,{size:38,color:'#cbd5e1'});return;}
      const e=EVENTS[S.ev];
      p.text(e[0],36,320,{size:120,bold:true,color:'#d6a066'});
      p.text(e[1],380,330,{size:56,bold:true,maxW:W-420});
      p.text(e[2],380,412,{size:40,color:'#e2e8f0',maxW:W-420,maxY:p.H-20});
    }});
    quizAt(E,'hist');
  },
  targets(E,S){return galleryTargets(S);},
  draw(E,S,add){galleryDraw(E,S,add);}
};
VR.rooms2Test={seqGen,EVENTS,CHAINS,ITEMS};
})();

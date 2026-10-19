/* rooms.js — комнаты: холл, математика, физика, химия, космос. В каждой предметной комнате есть тест. */
(function(){
'use strict';
const VR=window.VR,D=VR.DATA,M=VR.M,TRS=VR.TRS,G=VR.geo;
const ROOMS=VR.ROOMS={};
const ORDER=['math','phys','chem','space'];
const fmt=(x,d)=>x.toFixed(d===undefined?1:d).replace('.',',');
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;const t=a[i];a[i]=a[j];a[j]=t;}return a;};
const YL=Math.PI/2,YR=-Math.PI/2;
const faceTo=(pos,tx,tz)=>Math.atan2(tx-pos[0],tz-pos[2]);
const backDoor=(E,z)=>E.door(0,z||5.88,Math.PI,'hall','← Холл','#94a3b8');
VR.ORDER=ORDER;

/* ======================= ТЕСТ ======================= */
function makeQuiz(E,subj,pos,yaw){
  const sub=D.subjects[subj],Q={phase:'intro'};
  const grade=()=>E.student&&E.student.grade?E.student.grade:5;
  const band=()=>VR.Store.band(grade());
  const start=()=>{
    const pool=shuffle(D.Q[subj][band()].slice());
    Q.qs=pool.slice(0,5).map(q=>({q,order:shuffle(q.a.map((_,i)=>i))}));
    Q.i=0;Q.score=0;Q.ans=[];Q.phase='q';Q.t0=Date.now();
  };
  const answer=k=>{
    if(Q.phase!=='q')return;
    const it=Q.qs[Q.i],ok=it.order[k]===0;
    Q.pick=k;Q.ok=ok;if(ok){Q.score++;E.chime();}else E.beep(180,.3,'sawtooth',.04);
    Q.ans.push([it.q.id,ok?1:0]);Q.phase='fb';
  };
  const next=()=>{
    if(Q.phase!=='fb')return;
    Q.i++;if(Q.i<Q.qs.length){Q.phase='q';return;}
    Q.phase='res';const st=E.student;
    if(st&&st.id){VR.Store.addResult({sid:st.id,subj,band:band(),grade:grade(),score:Q.score,total:Q.qs.length,dur:Math.round((Date.now()-Q.t0)/1000),ans:Q.ans});Q.saved=true;}
    else Q.saved=false;
    if(Q.score===Q.qs.length){E.fanfare();E.burst([pos[0],pos[1]+.8,pos[2]],60);}else if(Q.score>=3)E.chime();
    E.menu.dirty=true;E.hud.dirty=true;
    if(E.hooks.onResult)E.hooks.onResult(subj,Q.score,Q.qs.length);
  };
  const p=E.addPanel({w:2,h:1.4,pos,yaw,accent:sub.color,draw:(c,p)=>{
    const W=p.W,H=p.H;
    if(Q.phase==='intro'){
      p.text('Тест: '+sub.title,40,34,{size:64,bold:true});
      p.text(D.bands[band()]+'  ·  5 вопросов',40,122,{size:40,color:'#b8c7ea'});
      let best='Ты ещё не проходил этот тест.';
      if(E.student&&E.student.id){const b=VR.Store.best(E.student.id)[subj];if(b.best!==null)best='Твой лучший результат: '+b.best+' из '+b.total+'  (попыток: '+b.attempts+')';}
      else best='Режим гостя: результат не сохранится.';
      p.text(best,40,196,{size:38});
      p.text('Сначала изучи комнату, потом проверь себя. Выбирай ответ лучом и нажимай курок.',40,270,{size:36,color:'#cbd5e1'});
      p.button(W/2-260,H-170,520,120,'Начать тест',start,{bg:sub.color,fg:'#0b1020',size:52});
    }else if(Q.phase==='q'){
      const it=Q.qs[Q.i];
      p.text('Вопрос '+(Q.i+1)+' из '+Q.qs.length,40,28,{size:34,color:'#b8c7ea'});
      for(let k=0;k<Q.qs.length;k++){c.fillStyle=k<Q.ans.length?(Q.ans[k][1]?'#22c55e':'#ef4444'):(k===Q.i?'#ffffff':'#475569');c.beginPath();c.arc(W-60-(Q.qs.length-1-k)*40,46,13,0,7);c.fill();}
      p.text(it.q.q,40,82,{size:44,bold:true,maxY:300});
      it.order.forEach((orig,k)=>p.button(40,306+k*100,W-80,86,it.q.a[orig],()=>answer(k),{bg:'#1e3a8a',size:36}));
    }else if(Q.phase==='fb'){
      const it=Q.qs[Q.i];
      p.text('Вопрос '+(Q.i+1)+' из '+Q.qs.length,40,28,{size:34,color:'#b8c7ea'});
      p.text(Q.ok?'✓ Верно!':'✗ Неверно',40,80,{size:68,bold:true,color:Q.ok?'#4ade80':'#f87171'});
      p.text('Правильный ответ: '+it.q.a[0],40,176,{size:42,bold:true,maxY:300});
      p.text(it.q.e,40,300,{size:38,color:'#cbd5e1',maxY:H-170});
      p.button(W/2-250,H-150,500,112,Q.i+1<Q.qs.length?'Дальше →':'Узнать результат',next,{bg:sub.color,fg:'#0b1020',size:46});
    }else{
      const n=Q.score>=Q.qs.length?3:Q.score>=4?2:Q.score>=3?1:0;
      p.text('Результат',40,30,{size:56,bold:true});
      p.text(Q.score+' из '+Q.qs.length,W/2,110,{size:120,bold:true,align:'center',color:n?'#4ade80':'#fbbf24'});
      p.text('★'.repeat(n)+'☆'.repeat(3-n),W/2,262,{size:84,align:'center',color:'#facc15'});
      const msg=['Попробуй ещё раз: изучи комнату внимательнее.','Неплохо, тест пройден!','Очень хорошо!','Отлично! Ты всё знаешь.'][n];
      p.text(msg,W/2,376,{size:40,align:'center'});
      p.text(Q.saved?'Результат сохранён':'Гость: результат не сохранён',W/2,436,{size:32,align:'center',color:'#94a3b8'});
      p.button(W/2-250,H-150,500,112,'Пройти ещё раз',start,{bg:'#334155',size:44});
    }
  }});
  p.quiz=Q;p.quizApi={start,answer,next};
  return p;
}
VR.makeQuiz=makeQuiz;

/* ======================= ХОЛЛ ======================= */
ROOMS.hall={
  title:'Холл',env:{floor:[.07,.1,.18],wall:[.12,.17,.3],trim:[.2,.7,1],grid:[.25,.55,.9]},
  hint:'Холл. Наведи луч на дверь или кнопку и нажми курок. Меню: кнопка A или X.',
  build(E,S){
    E.addPanel({w:3.4,h:2.2,pos:[0,1.65,-5.86],yaw:0,accent:'#3b82f6',draw:(c,p)=>{
      const st=E.student;
      p.text('Привет, '+(st?st.name:'гость')+'!',50,32,{size:66,bold:true});
      p.text((st&&st.grade?st.grade+' класс  ·  ':'')+'Выбери комнату, изучи её и пройди тест.',50,120,{size:36,color:'#b8c7ea'});
      const best=st&&st.id?VR.Store.best(st.id):null;
      ORDER.forEach((k,i)=>{
        const sub=D.subjects[k],x=50+(i%2)*474,y=186+((i/2)|0)*150;
        const b=best&&best[k].best!==null?'   ✓ '+best[k].best+'/'+best[k].total:'';
        p.button(x,y,450,130,sub.title+b,()=>E.goRoom(k),{bg:sub.color,fg:'#0b1020',size:48});
      });
      p.text('Стик вперёд и отпустить — телепорт  ·  Стик вбок — поворот\nКурок или хват рядом с предметом — взять  ·  Кнопка A или X — меню',50,500,{size:30,color:'#cbd5e1',lh:40});
    }});
    E.door(-5.88,-2.5,YL,'math',D.subjects.math.title,D.subjects.math.color);
    E.door(-5.88,2.2,YL,'phys',D.subjects.phys.title,D.subjects.phys.color);
    E.door(5.88,-2.5,YR,'chem',D.subjects.chem.title,D.subjects.chem.color);
    E.door(5.88,2.2,YR,'space',D.subjects.space.title,D.subjects.space.color);
    /* разминка: стол с предметами */
    const T=E.addTable(-2.7,-3.7,.7,.35,.8);
    [[-3.2,'cube',[.9,.25,.25]],[-2.95,'cube',[.25,.8,.35]],[-2.7,'cube',[.3,.5,.95]],[-2.42,'ball',[.95,.8,.2]],[-2.15,'ball',[.95,.95,.95]]]
      .forEach(([x,sh,col])=>E.addBody({shape:sh,p:[x,T.top+(sh==='cube'?.07:.055),-3.7],s:sh==='cube'?.14:.11,col}));
    E.addPanel({w:1.4,h:.6,pos:[-2.7,1.75,-3.95],yaw:0,accent:'#22c55e',draw:(c,p)=>{p.text('Возьми и брось',30,24,{size:52,bold:true});p.text('Поднеси руку к предмету, нажми хват или курок и отпусти в броске.',30,100,{size:32,color:'#cbd5e1'});}});
    /* красная кнопка */
    S.btn=[2.7,.97,-3.7];S.lampI=0;S.dip=0;S.cool=0;S.count=0;
    E.addStatic(E.mesh.cube,TRS(2.7,.45,-3.7,.5,.9,.5),[.35,.38,.45]);E.addBox({x:2.7,z:-3.7,hx:.25,hz:.25,top:.9});
    S.btnPanel=E.addPanel({w:1.4,h:.6,pos:[2.7,2.4,-3.95],yaw:0,accent:'#ef4444',draw:(c,p)=>{p.text('Красная кнопка',30,24,{size:52,bold:true});p.text('Нажми рукой или лучом с курком. Нажато: '+S.count,30,100,{size:32,color:'#cbd5e1'});}});
    S.press=h=>{
      if(S.cool>0)return;S.cool=.4;S.count++;S.lampI=(S.lampI+1)%5;S.dip=.03;S.btnPanel.dirty=true;
      E.burst([2.7,1.75,-3.7],36);E.beep(440+60*S.lampI,.15,'triangle');if(h)E.buzz(h,.6,50);
      E.discover('hall','button','Красная кнопка');
    };
  },
  targets(E,S){return[{c:S.btn,r:.2,id:'btn',sel:h=>S.press(h)}];},
  update(E,S,dt){
    S.cool=Math.max(0,S.cool-dt);S.dip=Math.max(0,S.dip-dt*.12);
    for(const h of E.H){
      if(!h.has||!E.session)continue;
      const d=Math.hypot(h.g[12]-2.7,h.g[14]+3.7);
      if(d<.17&&h.g[13]>.88&&h.g[13]<1.12){if(!h.poked){h.poked=true;S.press(h);}}else if(d>.25)h.poked=false;
    }
  },
  onRelease(E,S,b,sp){if(sp>2.5)E.discover('hall','throw','Первый бросок');},
  draw(E,S,add){
    const L=[[1,.3,.3],[.3,1,.4],[.3,.5,1],[1,.85,.2],[.9,.4,1]];
    add(E.mesh.cube,TRS(2.7,.95-S.dip,-3.7,.3,.1,.3),[.9,.15,.15],.15);
    add(E.mesh.sphere,TRS(2.7,1.75,-3.7,.45,.45,.45),L[S.lampI],1);
  }
};

/* ======================= МАТЕМАТИКА ======================= */
const GX=-5.8,GZ=-.6,UX=.38,GY=1.5,UY=.33;
const gz=X=>GZ-X*UX,gy=Y=>GY+Y*UY;
function curveSegs(fi,a,b){
  const f=[x=>a*x+b,x=>a*x*x+b,x=>a*Math.sin(b*x),x=>a/x][fi],segs=[],N=300;
  let px=-6,py=f(px);
  for(let i=1;i<=N;i++){
    const x=-6+12*i/N,y=f(x);
    const ok=isFinite(py)&&isFinite(y)&&Math.abs(py)<=3.5&&Math.abs(y)<=3.5&&!(fi===3&&px*x<=0);
    if(ok)segs.push([gz(px),gy(py),gz(x),gy(y)]);
    px=x;py=y;
  }
  return segs;
}
VR.curveSegs=curveSegs;
ROOMS.math={
  title:'Математика',env:{floor:[.08,.07,.2],wall:[.17,.14,.34],trim:[.6,.5,1],grid:[.5,.45,1]},
  hint:'Математика: выбери фигуру лучом, а на стене слева поиграй с графиками.',
  build(E,S){
    backDoor(E);
    S.sel=-1;
    const cols=[[.95,.45,.45],[.45,.75,1],[.5,.95,.6],[1,.8,.35],[.85,.55,1],[.4,.95,.95],[1,.6,.8],[.95,.95,.5]];
    S.sh=D.shapes.map((d,i)=>({d,i,x:-3.5+i,z:-3.7,col:cols[i],m:E.mesh[d.key]}));
    for(const s of S.sh){E.addStatic(E.mesh.cyl,TRS(s.x,.45,s.z,.34,.9,.34),[.25,.24,.42]);E.addBox({x:s.x,z:s.z,hx:.17,hz:.17,top:.9});}
    S.info=E.addPanel({w:2.4,h:1.0,pos:[0,2.3,-4.9],yaw:0,accent:'#818cf8',draw:(c,p)=>{
      if(S.sel<0){p.text('Фигуры',40,28,{size:60,bold:true});p.text('Наведи луч на фигуру и нажми курок. Сравни, сколько у неё вершин (В), рёбер (Р) и граней (Г).',40,118,{size:40,color:'#cbd5e1'});return;}
      const d=D.shapes[S.sel];let y=118;
      p.text(d.name,40,26,{size:66,bold:true,color:'#c7d2fe'});
      if(d.v){p.text('Вершин: '+d.v+'    Рёбер: '+d.e+'    Граней: '+d.f,40,y,{size:44,bold:true});y+=62;p.text('Формула Эйлера: '+d.v+' − '+d.e+' + '+d.f+' = '+(d.v-d.e+d.f),40,y,{size:40,color:'#fde68a'});y+=58;}
      else{p.text(d.formula,40,y,{size:46,bold:true,color:'#fde68a'});y+=68;}
      p.text(d.text,40,y,{size:36,color:'#cbd5e1'});
    }});
    /* доска графиков */
    E.addStatic(E.mesh.cube,TRS(GX-.04,1.5,GZ,.02,2.5,4.9),[.05,.05,.12]);
    const grid=[],axes=[];
    for(let X=-6;X<=6;X++)(X===0?axes:grid).push([gz(X),gy(-3.5),gz(X),gy(3.5)]);
    for(let Y=-3;Y<=3;Y++)(Y===0?axes:grid).push([gz(-6),gy(Y),gz(6),gy(Y)]);
    axes.push([gz(6),gy(0),gz(5.75),gy(.2)],[gz(6),gy(0),gz(5.75),gy(-.2)],[gz(0),gy(3.5),gz(.2),gy(3.25)],[gz(0),gy(3.5),gz(-.2),gy(3.25)]);
    E.addStatic(E.roomMesh(G.ribbonX(GX,grid,.006)),M.id(),[.3,.32,.55],1);
    E.addStatic(E.roomMesh(G.ribbonX(GX+.003,axes,.02)),M.id(),[.9,.92,1],1);
    S.curve=E.roomDyn(320*48);
    S.fn=0;S.par=D.functions[0].init.slice();
    S.upd=()=>{S.curve.set(G.ribbonX(GX+.006,curveSegs(S.fn,S.par[0],S.par[1]),.03));};
    S.upd();
    const setFn=i=>{S.fn=i;S.par=D.functions[i].init.slice();S.upd();S.ctl.dirty=true;E.discover('math','fn_'+D.functions[i].key,'График '+D.functions[i].name);};
    const bump=(k,d)=>{S.par[k]=Math.max(-5,Math.min(5,Math.round((S.par[k]+d)*10)/10));S.upd();S.ctl.dirty=true;};
    S.ctl=E.addPanel({w:1.75,h:1.55,pos:[-5.86,1.55,3.45],yaw:YL,accent:'#a5b4fc',draw:(c,p)=>{
      const F=D.functions[S.fn],W=p.W;
      p.text('Графики функций',36,26,{size:52,bold:true});
      D.functions.forEach((f,i)=>p.button(36+(i%2)*480,100+((i/2)|0)*104,460,90,f.name,()=>setFn(i),{active:i===S.fn,activeBg:'#6366f1',bg:'#1e293b',size:36}));
      const v=x=>fmt(x,1);
      const eq=[`y = ${v(S.par[0])}·x ${S.par[1]<0?'−':'+'} ${v(Math.abs(S.par[1]))}`,`y = ${v(S.par[0])}·x² ${S.par[1]<0?'−':'+'} ${v(Math.abs(S.par[1]))}`,`y = ${v(S.par[0])}·sin(${v(S.par[1])}·x)`,`y = ${v(S.par[0])} / x`][S.fn];
      p.text(eq,W/2,326,{size:58,bold:true,align:'center',color:'#fde68a'});
      let y=420;
      F.p.forEach((name,k)=>{if(name==='—')return;
        p.text(name+' = '+v(S.par[k]),36,y+18,{size:46,bold:true});
        p.button(W-380,y,160,84,'−',()=>bump(k,-.5),{bg:'#334155',size:56});
        p.button(W-200,y,160,84,'+',()=>bump(k,.5),{bg:'#334155',size:56});
        y+=104;});
      p.text(F.text,36,Math.max(y+10,630),{size:34,color:'#cbd5e1'});
    }});
    makeQuiz(E,'math',[5.86,1.5,1.5],YR);
  },
  targets(E,S){return S.sh.map(s=>({c:[s.x,1.25,s.z],r:.3,id:'sh'+s.i,sel:()=>{S.sel=s.i;S.info.dirty=true;E.discover('math','shape_'+s.d.key,s.d.name);E.beep(700,.08);}}));},
  draw(E,S,add){
    for(const s of S.sh){
      const k=s.i===S.sel?.5:.42,a=E.t*.6+s.i;
      add(s.m,M.mul(M.trans(s.x,1.25+Math.sin(E.t*1.5+s.i)*.03,s.z),M.mul(M.rotY(a),M.mul(M.rotX(.35),M.scale(k,k,k)))),s.col,s.i===S.sel?.35:.05);
    }
    add(S.curve,M.id(),[1,.85,.25],1);
  }
};

/* ======================= ФИЗИКА ======================= */
const PIV=[3.4,2.75,-3.8],TOWER=[1.6,-4.9],DROP_H=2;
ROOMS.phys={
  title:'Физика',env:{floor:[.16,.09,.05],wall:[.3,.17,.1],trim:[1,.6,.25],grid:[1,.6,.3]},
  hint:'Физика: меняй гравитацию на передней стене, бросай шары, качай маятник справа.',
  build(E,S){
    backDoor(E);
    S.gi=0;S.L=1.5;S.th=.3;S.w=0;S.lastT=null;S.period=null;S.prevW=0;S.drop=null;S.dropMsg='';
    const setG=i=>{
      S.gi=i;const g=D.gravity[i];E.gravity=g.g;
      if(g.g===0)for(const b of E.bodies)if(!b.held&&!b.fixed)b.v[1]+=.25+Math.random()*.3;
      S.period=null;S.lastT=null;S.gp.dirty=true;S.pp.dirty=true;
      E.discover('phys','g_'+g.key,'Гравитация: '+g.name);
    };
    const dropBall=()=>{
      const b=S.ball;b.p=[TOWER[0]+.27,DROP_H+b.s/2,TOWER[1]];b.v=[0,0,0];b.fixed=false;b.held=null;
      S.drop={t:0};S.dropMsg='Падает…';S.gp.dirty=true;E.beep(500,.08);
    };
    S.gp=E.addPanel({w:3.0,h:1.55,pos:[-1.3,1.75,-5.86],yaw:0,accent:'#fb923c',draw:(c,p)=>{
      const g=D.gravity[S.gi];
      p.text('Гравитация: '+g.name,36,24,{size:58,bold:true});
      p.text('g = '+fmt(g.g,g.g>=10?1:2)+' м/с²',p.W-36,32,{size:50,bold:true,align:'right',color:'#fde68a',maxW:400});
      D.gravity.forEach((x,i)=>p.button(36+i*192,104,178,88,x.name,()=>setG(i),{active:i===S.gi,activeBg:'#ea580c',bg:'#334155',size:32}));
      p.text(g.text,36,214,{size:36,color:'#cbd5e1'});
      p.text('Опыт: шар падает с высоты '+fmt(DROP_H,0)+' м (башня справа)',36,300,{size:36,bold:true});
      p.button(36,356,330,92,'Бросить шар',dropBall,{bg:'#ea580c',size:40});
      p.text(S.dropMsg,390,372,{size:34,color:'#fde68a',maxW:p.W-420});
    }});
    /* башня для опыта */
    E.addStatic(E.mesh.cyl,TRS(TOWER[0],1.2,TOWER[1],.07,2.4,.07),[.6,.6,.65]);
    E.addStatic(E.mesh.cube,TRS(TOWER[0]+.15,2.3,TOWER[1],.32,.04,.06),[.6,.6,.65]);
    for(let y=.5;y<=2;y+=.5)E.addStatic(E.mesh.cube,TRS(TOWER[0]+.05,y,TOWER[1],.14,.015,.03),[1,.8,.3],1);
    S.ball=E.addBody({shape:'ball',p:[TOWER[0]+.27,DROP_H+.07,TOWER[1]],s:.14,col:[1,.55,.2],em:.2});S.ball.fixed=true;
    /* стол с предметами для бросков */
    const T=E.addTable(-3.9,-1.6,.35,.7,.8);
    [[-2.1,'ball',[.9,.9,.95]],[-1.8,'ball',[.3,.8,1]],[-1.5,'cube',[.95,.4,.3]],[-1.2,'cube',[.5,.9,.4]]]
      .forEach(([z,sh,col])=>E.addBody({shape:sh,p:[-3.9,T.top+.07,z],s:sh==='cube'?.14:.12,col}));
    E.addPanel({w:1.3,h:.5,pos:[-5.86,1.6,-1.6],yaw:YL,accent:'#fb923c',draw:(c,p)=>{p.text('Бросай!',30,20,{size:50,bold:true});p.text('Сравни полёт на Луне, Юпитере и в невесомости.',30,90,{size:32,color:'#cbd5e1'});}});
    /* маятник */
    for(const dz of[-.8,.8])E.addStatic(E.mesh.cube,TRS(PIV[0],PIV[1]/2+.03,PIV[2]+dz,.07,PIV[1]+.06,.07),[.55,.55,.6]);
    E.addStatic(E.mesh.cube,TRS(PIV[0],PIV[1]+.03,PIV[2],.07,.07,1.67),[.55,.55,.6]);
    E.addBox({x:PIV[0],z:PIV[2]-.8,hx:.05,hz:.05,top:PIV[1]});E.addBox({x:PIV[0],z:PIV[2]+.8,hx:.05,hz:.05,top:PIV[1]});
    const bumpL=d=>{S.L=Math.max(.5,Math.min(2.3,Math.round((S.L+d)*100)/100));S.period=null;S.lastT=null;S.pp.dirty=true;};
    S.push=()=>{if(Math.abs(S.th)<.05&&Math.abs(S.w)<.1)S.th=.3;else S.w+=S.w>=0?.4:-.4;S.period=null;S.lastT=null;E.discover('phys','pendulum','Маятник');E.beep(600,.06);};
    S.pp=E.addPanel({w:1.7,h:1.35,pos:[5.86,1.6,-3.1],yaw:YR,accent:'#fdba74',draw:(c,p)=>{
      const g=E.gravity,W=p.W;
      p.text('Маятник',36,24,{size:56,bold:true});
      p.text('Длина нити L = '+fmt(S.L,2)+' м',36,108,{size:42,bold:true});
      p.button(W-370,96,160,80,'−',()=>bumpL(-.25),{bg:'#334155',size:54});
      p.button(W-196,96,160,80,'+',()=>bumpL(.25),{bg:'#334155',size:54});
      p.text('g = '+fmt(g,g>=10?1:2)+' м/с² ('+D.gravity[S.gi].name+')',36,204,{size:38,color:'#cbd5e1'});
      p.text(g>0?'По формуле: T = 2π√(L/g) = '+fmt(2*Math.PI*Math.sqrt(S.L/g),2)+' с':'Без тяжести маятник не качается, а крутится.',36,262,{size:38,color:'#fde68a',maxW:W-70});
      p.text('Измерено: '+(S.period?fmt(S.period,2)+' с':'жду полный взмах…'),36,370,{size:40,bold:true});
      p.button(36,p.H-150,420,110,'Толкнуть',S.push,{bg:'#ea580c',size:46});
      p.text('Маленький размах — точнее совпадает с формулой',490,p.H-140,{size:30,color:'#94a3b8',maxW:W-520});
    }});
    makeQuiz(E,'phys',[5.86,1.5,1.8],YR);
  },
  targets(E,S){const b=bob(S);return[{c:b,r:.2,id:'bob',sel:()=>S.push()}];},
  update(E,S,dt){
    const g=E.gravity,n=4,h=dt/n;
    for(let i=0;i<n;i++){S.w+=(-(g/S.L)*Math.sin(S.th)-.03*S.w)*h;S.th+=S.w*h;}
    if(S.prevW>0&&S.w<=0&&g>0){if(S.lastT!==null){S.period=E.t-S.lastT;S.pp.dirty=true;}S.lastT=E.t;}
    S.prevW=S.w;
    if(S.drop){
      const b=S.ball;
      if(b.held!==null){S.drop=null;S.dropMsg='Опыт прерван: шар взяли в руку.';S.gp.dirty=true;}
      else if(b.p[1]<=b.s/2+.002){
        const g0=D.gravity[S.gi].g;S.dropMsg='Время падения: '+fmt(S.drop.t,2)+' с.  По формуле √(2h/g) = '+fmt(Math.sqrt(2*DROP_H/g0),2)+' с';
        S.drop=null;S.gp.dirty=true;E.beep(300,.1);E.discover('phys','drop_'+D.gravity[S.gi].key,'Опыт с падением ('+D.gravity[S.gi].name+')');
      }else if(E.gravity===0&&S.drop.t>2.5){S.dropMsg='В невесомости шар не падает!';S.drop=null;S.gp.dirty=true;}
      if(S.drop)S.drop.t+=dt;
    }
  },
  draw(E,S,add){
    const b=bob(S),mx=(PIV[0]+b[0])/2,my=(PIV[1]+b[1])/2;
    add(E.mesh.cube,M.mul(M.trans(mx,my,PIV[2]),M.mul(M.rotZ(S.th),M.scale(.012,S.L,.012))),[.85,.85,.9],.5);
    add(E.mesh.sphere,TRS(b[0],b[1],b[2],.18,.18,.18),[1,.6,.2],.25);
  }
};
function bob(S){return[PIV[0]+S.L*Math.sin(S.th),PIV[1]-S.L*Math.cos(S.th),PIV[2]];}

/* ======================= ХИМИЯ ======================= */
const RX=-3.9,RTOP=.85,PLATE=[-3.9,1.3];
const DISP=[['H',-1.25],['O',-.6],['C',.05],['N',.7]];
ROOMS.chem={
  title:'Химия',env:{floor:[.05,.14,.09],wall:[.1,.26,.17],trim:[.35,1,.6],grid:[.3,.9,.5]},
  hint:'Химия: возьми атомы на столе слева и собери молекулу на светлом круге.',
  build(E,S){
    backDoor(E);
    S.el=-1;S.made=null;S.chk=0;S.comp={};S.hint=-1;
    S.found=new Set();
    if(E.student&&E.student.id)for(const k of VR.Store.discoveries(E.student.id))if(k.indexOf('chem:mol_')===0)S.found.add(k.slice(9));
    /* таблица Менделеева */
    S.pt=E.addPanel({w:4.6,h:1.9,res:1600,pos:[0,1.75,-5.86],yaw:0,accent:'#4ade80',draw:(c,p)=>{
      p.text('Таблица Менделеева: первые 20 элементов',30,24,{size:50,bold:true});
      const R=VR.ui.rrect;
      for(const el of D.elements){
        const [n,sym,name,,row,col,cat]=el,x=30+(col-1)*128,y=100+(row-1)*126,w=120,h=118;
        const hov=p.area(x,y,w,h,()=>{S.el=n-1;S.pt.dirty=true;E.discover('chem','el_'+sym,name+' '+sym);E.beep(700,.06);});
        const cc=D.elCats[cat][1];
        c.fillStyle=S.el===n-1?cc:'#1b2540';R(c,x,y,w,h,14);c.fill();
        c.lineWidth=hov?7:4;c.strokeStyle=hov?'#ffffff':cc;R(c,x+2,y+2,w-4,h-4,12);c.stroke();
        const fg=S.el===n-1?'#0b1020':'#e8efff';
        c.fillStyle=fg;c.font='26px sans-serif';c.textAlign='left';c.fillText(String(n),x+10,y+8);
        c.font='bold 54px sans-serif';c.textAlign='center';c.fillText(sym,x+w/2,y+36);
        c.font='18px sans-serif';c.fillText(name,x+w/2,y+94);c.textAlign='left';
      }
      const ix=1090;
      if(S.el<0){
        p.text('Нажми на элемент',ix,110,{size:42,bold:true,maxW:480});
        let y=180;for(const k in D.elCats){c.fillStyle=D.elCats[k][1];c.fillRect(ix,y+6,28,28);p.text(D.elCats[k][0],ix+44,y,{size:30,maxW:440});y+=48;}
      }else{
        const [n,sym,name,mass,,,cat,fact]=D.elements[S.el];
        p.text(sym,ix,96,{size:150,bold:true,color:D.elCats[cat][1]});
        p.text(name,ix+(sym.length>1?210:130),130,{size:52,bold:true,maxW:480-(sym.length>1?210:130)});
        p.text('№ '+n+'  ·  масса '+mass,ix+(sym.length>1?210:130),200,{size:30,color:'#b8c7ea',maxW:300});
        p.text(D.elCats[cat][0],ix,270,{size:32,color:D.elCats[cat][1],bold:true,maxW:480});
        p.text(fact,ix,326,{size:32,color:'#cbd5e1',maxW:480,maxY:640});
      }
    }});
    /* стол-реактор */
    E.addTable(RX,0,.45,1.75,RTOP,[.3,.32,.36]);
    for(const [el,z] of DISP)E.addStatic(E.mesh.cyl,TRS(RX,RTOP+.03,z,.3,.06,.3),D.atoms[el].col,.3);
    E.addStatic(E.mesh.disc,TRS(PLATE[0],RTOP+.005,PLATE[1],.3,1,.3),[.6,1,.8],.8);
    E.addStatic(E.mesh.circle,TRS(PLATE[0],RTOP+.01,PLATE[1],.32,1,.32),[1,1,1],1,3);
    const clear=()=>{for(const b of onPlate(E))E.removeBody(b);S.made=null;S.comp={};S.rp.dirty=true;};
    const hint=()=>{const left=D.molecules.filter(m=>!S.found.has(m.key));const list=left.length?left:D.molecules;S.hint=(S.hint+1)%list.length;S.hintM=list[S.hint];S.rp.dirty=true;};
    S.rp=E.addPanel({w:2.5,h:1.15,pos:[-5.86,1.95,.1],yaw:YL,accent:'#86efac',draw:(c,p)=>{
      const W=p.W;
      p.text('Реактор молекул',36,22,{size:52,bold:true});
      p.text('Собрано: '+S.found.size+' из '+D.molecules.length,W-36,32,{size:36,align:'right',color:'#86efac',maxW:420});
      const parts=Object.keys(S.comp).map(k=>k+' × '+S.comp[k]);
      if(S.made){const m=D.molecules.find(x=>x.key===S.made);p.text('Получилось: '+m.name+' '+m.formula,36,96,{size:46,bold:true,color:'#fde68a'});p.text(m.text,36,160,{size:32,color:'#cbd5e1',maxY:290});}
      else{p.text(parts.length?'На платформе: '+parts.join(', '):'Нажми на чашу с цветом атома, затем положи атомы на светлый круг.',36,100,{size:36,maxY:230});
        p.text(S.hintM?'Подсказка: '+S.hintM.name+' '+S.hintM.formula+' ('+Object.keys(S.hintM.f).map(k=>S.hintM.f[k]+' '+k).join(' + ')+')':'Белый — H, красный — O, серый — C, синий — N',36,232,{size:32,color:'#94a3b8'});}
      p.button(36,p.H-120,420,96,'Очистить круг',clear,{bg:'#334155',size:38});
      p.button(480,p.H-120,360,96,'Подсказка',hint,{bg:'#15803d',size:38});
    }});
    makeQuiz(E,'chem',[5.86,1.5,1.5],YR);
  },
  targets(E,S){return DISP.map(([el,z])=>({c:[RX,RTOP+.28,z],r:.2,id:'disp'+el,sel:()=>spawnAtom(E,el,z)}));},
  update(E,S,dt){
    S.chk-=dt;if(S.chk>0)return;S.chk=.25;
    const comp={};for(const b of onPlate(E))comp[b.data.el]=(comp[b.data.el]||0)+1;
    const key=Object.keys(comp).sort().map(k=>k+comp[k]).join('');
    if(key!==S.compKey){S.compKey=key;S.comp=comp;S.rp.dirty=true;}
    const m=D.molecules.find(x=>{const ks=Object.keys(x.f);return ks.length===Object.keys(comp).length&&ks.every(k=>comp[k]===x.f[k]);});
    const mk=m?m.key:null;
    if(mk!==S.made){
      S.made=mk;S.rp.dirty=true;
      if(m){S.found.add(m.key);E.burst([PLATE[0],RTOP+.4,PLATE[1]],40);E.fanfare();E.discover('chem','mol_'+m.key,m.name+' '+m.formula);if(S.hintM&&S.hintM.key===m.key)S.hintM=null;}
    }
  },
  draw(E,S,add){
    for(const [el,z] of DISP){const k=el==='H'?.08:.11;add(E.mesh.sphere,TRS(RX,RTOP+.28+Math.sin(E.t*2+z)*.03,z,k,k,k),D.atoms[el].col,.25);}
    if(S.made){
      const m=D.molecules.find(x=>x.key===S.made),base=M.mul(M.trans(PLATE[0],RTOP+.6,PLATE[1]),M.rotY(E.t*.8)),sc=2.2;
      for(const [el,x,y,z] of m.atoms){const k=el==='H'?.09:.13;add(E.mesh.sphere,M.mul(base,TRS(x*sc,y*sc,z*sc,k,k,k)),D.atoms[el].col,.3);}
    }
  }
};
function onPlate(E){return E.bodies.filter(b=>b.data&&b.data.el&&b.held===null&&Math.hypot(b.p[0]-PLATE[0],b.p[2]-PLATE[1])<.32&&b.p[1]<RTOP+.35&&b.p[1]>RTOP-.1);}
function spawnAtom(E,el,z){
  const atoms=E.bodies.filter(b=>b.data&&b.data.el);
  if(atoms.length>=20){const old=atoms.find(b=>b.held===null);if(old)E.removeBody(old);}
  const b=E.addBody({shape:'ball',p:[RX+.2,RTOP+.25,z],s:el==='H'?.08:.1,col:D.atoms[el].col,em:.2,data:{el}});
  b.v=[0,.5,0];E.beep(el==='H'?880:el==='O'?660:el==='C'?520:740,.07);
  return b;
}
VR.chemTest={onPlate,spawnAtom,PLATE,RTOP};

/* ======================= КОСМОС ======================= */
const SUN=[0,1.3,-2.9],PAD=[3.9,-2.7];
ROOMS.space={
  title:'Космос',env:{open:true,floor:[.05,.06,.11],trim:[.35,.6,1]},spawn:{x:0,z:1.2},
  hint:'Космос: выбери планету лучом. Слева весы для разных планет, справа запуск ракеты.',
  build(E,S){
    E.door(0,5.2,Math.PI,'hall','← Холл','#94a3b8');
    S.pl=D.planets.map((p,i)=>({d:p,ang:i*.9,pos:[SUN[0]+p.orbit,SUN[1],SUN[2]]}));
    S.moonAng=0;S.moonPos=[0,0,0];S.sel=null;S.mass=40;S.rk={st:'ready',y:0,v:0,t:0};
    S.info=E.addPanel({w:2.4,h:.95,pos:[SUN[0],2.75,SUN[2]],yaw:0,accent:'#38bdf8',draw:(c,p)=>{
      if(!S.sel){p.text('Солнечная система',40,26,{size:58,bold:true});p.text('Наведи луч на планету и нажми курок. Размеры и расстояния здесь не в масштабе.',40,112,{size:38,color:'#cbd5e1'});return;}
      p.text(S.sel.name,40,22,{size:64,bold:true,color:'#bae6fd'});
      p.text('Притяжение: '+fmt(S.sel.g,2)+' от земного',p.W-40,40,{size:34,align:'right',color:'#fde68a',maxW:520});
      p.text(S.sel.text,40,112,{size:38,color:'#cbd5e1'});
    }});
    const wp=[-4.1,1.5,-.4];
    const bump=d=>{S.mass=Math.max(15,Math.min(120,S.mass+d));S.wp.dirty=true;E.discover('space','scales','Вес на других планетах');};
    S.wp=E.addPanel({w:1.8,h:1.75,pos:wp,yaw:faceTo(wp,0,1.2),accent:'#7dd3fc',draw:(c,p)=>{
      const W=p.W;
      p.text('Что покажут весы?',36,24,{size:52,bold:true});
      p.text('На Земле: '+S.mass+' кг',36,104,{size:44,bold:true,color:'#fde68a'});
      p.button(W-370,92,160,80,'−',()=>bump(-5),{bg:'#334155',size:54});
      p.button(W-196,92,160,80,'+',()=>bump(5),{bg:'#334155',size:54});
      const rows=[D.planets[0],D.planets[1],D.planets[2],D.moon,D.planets[4],D.planets[5],D.planets[6],D.planets[7],D.planets[8]];
      let y=200;
      for(const r of rows){p.text(r.name,60,y,{size:36});p.text(fmt(S.mass*r.g,r.g*S.mass>=100?0:1)+' кг',W-60,y,{size:36,bold:true,align:'right',maxW:300});y+=50;}
      p.text('Масса не меняется. Меняется сила притяжения, то есть вес.',36,y+10,{size:30,color:'#94a3b8'});
    }});
    /* ракета */
    E.addStatic(E.mesh.cyl,TRS(PAD[0],.04,PAD[1],1.1,.08,1.1),[.35,.38,.45]);
    E.addStatic(E.mesh.cube,TRS(PAD[0]+.55,1.2,PAD[1],.08,2.4,.08),[.7,.3,.25]);
    E.addBox({x:PAD[0],z:PAD[1],hx:.55,hz:.55,top:.08});
    const launch=()=>{if(S.rk.st!=='ready')return;S.rk={st:'count',y:0,v:0,t:0,n:3};E.beep(600,.15);S.lp.dirty=true;E.discover('space','rocket','Запуск ракеты');};
    const lp=[2.9,1.5,-.5];
    S.lp=E.addPanel({w:1.6,h:1.15,pos:lp,yaw:faceTo(lp,0,1.2),accent:'#f87171',draw:(c,p)=>{
      const st=S.rk.st,W=p.W;
      p.text('Запуск ракеты',36,24,{size:54,bold:true});
      p.text(st==='count'?'Старт через '+S.rk.n+'…':st==='fly'?'Полёт! Скорость растёт.':st==='gone'?'Ракета ушла на орбиту.':'Ракета готова к старту.',36,106,{size:40,bold:true,color:'#fde68a'});
      p.text('12 апреля 1961 года Юрий Гагарин облетел Землю на «Востоке-1» за 108 минут. Чтобы остаться на орбите, нужна скорость 7,9 км/с.',36,170,{size:32,color:'#cbd5e1',maxY:p.H-140});
      p.button(W/2-200,p.H-128,400,104,'Пуск!',launch,{bg:'#dc2626',size:50,disabled:st!=='ready'});
    }});
    makeQuiz(E,'space',[4.2,1.5,2.4],faceTo([4.2,0,2.4],0,1.2));
  },
  targets(E,S){
    const t=S.pl.map((p,i)=>({c:p.pos,r:Math.max(p.d.r,.07)*1.4,id:'pl'+i,sel:()=>pick(E,S,p.d)}));
    t.push({c:S.moonPos,r:.07,id:'moon',sel:()=>pick(E,S,D.moon)});
    return t;
  },
  update(E,S,dt){
    for(const p of S.pl)if(p.d.orbit){p.ang+=p.d.speed*dt*.6;p.pos=[SUN[0]+p.d.orbit*Math.cos(p.ang),SUN[1],SUN[2]+p.d.orbit*Math.sin(p.ang)];}
    const ea=S.pl[3].pos;S.moonAng+=dt*1.6;S.moonPos=[ea[0]+.15*Math.cos(S.moonAng),ea[1],ea[2]+.15*Math.sin(S.moonAng)];
    const r=S.rk;r.t+=dt;
    if(r.st==='count'){const n=3-Math.floor(r.t);if(n!==r.n&&n>0){r.n=n;E.beep(600,.15);S.lp.dirty=true;}if(r.t>=3){r.st='fly';r.t=0;E.beep(200,.6,'sawtooth',.05);S.lp.dirty=true;}}
    else if(r.st==='fly'){
      r.v+=(2+r.t*3)*dt;r.y+=r.v*dt;
      for(let i=0;i<2;i++)E.particle([PAD[0]+(Math.random()-.5)*.1,r.y+.05,PAD[1]+(Math.random()-.5)*.1],[(Math.random()-.5)*.6,-1.5-Math.random(),(Math.random()-.5)*.6],Math.random()<.5?[1,.6,.1]:[1,.9,.4],.6,.06,0);
      if(r.y>45){r.st='gone';r.t=0;S.lp.dirty=true;}
    }else if(r.st==='gone'&&r.t>4){S.rk={st:'ready',y:0,v:0,t:0};S.lp.dirty=true;}
  },
  draw(E,S,add){
    for(const p of S.pl){
      const d=p.d,k=d.r*2*(S.sel===d?1.2:1);
      if(d.orbit)add(E.mesh.circle,TRS(SUN[0],SUN[1],SUN[2],d.orbit,1,d.orbit),[.3,.38,.6],1,3);
      add(E.mesh.sphere,TRS(p.pos[0],p.pos[1],p.pos[2],k,k,k),d.col,d.em||(S.sel===d?.5:.08));
      if(d.ring)add(E.mesh.disc,M.mul(M.trans(p.pos[0],p.pos[1],p.pos[2]),M.mul(M.rotX(.4),M.scale(d.r*1.9,1,d.r*1.9))),[.8,.7,.5],.4);
    }
    add(E.mesh.sphere,TRS(S.moonPos[0],S.moonPos[1],S.moonPos[2],.045,.045,.045),[.8,.8,.82],S.sel===D.moon?.5:.1);
    const r=S.rk;if(r.st!=='gone'){
      const y=r.y;
      add(E.mesh.cyl,TRS(PAD[0],.62+y,PAD[1],.24,1,.24),[.92,.92,.95],.15);
      add(E.mesh.cone,TRS(PAD[0],1.27+y,PAD[1],.24,.3,.24),[.9,.2,.2],.2);
      for(let i=0;i<3;i++){const a=i*2.094;add(E.mesh.cube,TRS(PAD[0]+Math.cos(a)*.15,.25+y,PAD[1]+Math.sin(a)*.15,.04,.3,.18,-a),[.85,.25,.2],.2);}
      add(E.mesh.sphere,TRS(PAD[0]+.08,.9+y,PAD[1]+.1,.07,.07,.07),[.3,.7,1],.6);
    }
  }
};
function pick(E,S,d){S.sel=d;S.info.dirty=true;E.discover('space','p_'+d.key,d.name);E.beep(700,.08);}
})();

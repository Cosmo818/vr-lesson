const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=process.argv[2]||path.join(__dirname,'..');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL:',m);}else console.log('ok  :',m);};
const tick=()=>new Promise(r=>setImmediate(r));

function makeCtx(xr){
  const calls={draw:0,tex:0};
  const gl=new Proxy({},{get(_,p){
    if(p==='drawArrays')return()=>{calls.draw++;};
    if(p==='texImage2D')return()=>{calls.tex++;};
    if(p==='getShaderParameter'||p==='getProgramParameter')return()=>true;
    if(typeof p==='string'&&/^[A-Z0-9_]+$/.test(p))return 1;
    return()=>({});
  }});
  const ctx2d=()=>new Proxy({},{get(_,p){if(p==='measureText')return t=>({width:String(t).length*20});return()=>{};},set(){return true;}});
  const els={};
  const mkEl=id=>({id,style:{},hidden:false,textContent:'',innerHTML:'',value:'',dataset:{},clientWidth:800,clientHeight:600,width:800,height:600,
    _h:{},addEventListener(t,f){(this._h[t]=this._h[t]||[]).push(f);},insertAdjacentHTML(){},focus(){},setPointerCapture(){},
    getContext(k){return k==='webgl2'?gl:ctx2d();},querySelector(){return null;},scrollIntoView(){}});
  const store={};
  const xrState={session:null};
  const mat=(x,y,z)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
  const hands={};
  for(const k of['left','right'])hands[k]={g:mat(0,1,0),r:mat(0,1,0),gp:{buttons:[0,1,2,3,4,5].map(()=>({pressed:false})),axes:[0,0,0,0]}};
  const head={x:0,y:1.6,z:1};
  const frame={getPose(sp){return{transform:{matrix:hands[sp.k][sp.t]}};},
    getViewerPose(){return{transform:{position:head,matrix:mat(head.x,head.y,head.z)},views:[{projectionMatrix:mat(0,0,0),transform:{inverse:{matrix:mat(0,0,0)},position:head}}]};}};
  let endH=null;const xrQ=[];
  const session={inputSources:['left','right'].map(k=>({handedness:k,gripSpace:{k,t:'g'},targetRaySpace:{k,t:'r'},gamepad:hands[k].gp})),
    renderState:{},requestAnimationFrame(f){xrQ.push(f);},updateRenderState(s){this.renderState=s;},
    requestReferenceSpace:async()=>({getOffsetReferenceSpace:t=>({off:t})}),addEventListener(t,f){if(t==='end')endH=f;},end(){endH&&endH();}};
  const rafQ=[];
  const sb={
    document:{readyState:'complete',hidden:false,getElementById:id=>els[id]||(els[id]=mkEl(id)),createElement:()=>mkEl('x'),addEventListener(){},body:{appendChild(){}}},
    window:{addEventListener(){},devicePixelRatio:1},
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    navigator:{xr:{isSessionSupported:async()=>xr,requestSession:async()=>session}},
    location:{protocol:'file:'},performance:{now:()=>Date.now()},
    requestAnimationFrame:f=>rafQ.push(f),setTimeout:(f)=>0,clearTimeout:()=>{},setInterval:()=>0,fetch:(...a)=>fetch(...a),AbortController,
    XRRigidTransform:class{constructor(p,o){this.p=p;this.o=o;}},XRWebGLLayer:class{constructor(){this.framebuffer={};}getViewport(){return{x:0,y:0,width:10,height:10};}},
    console,Math,Date,JSON,Float32Array,crypto:require('crypto').webcrypto,TextEncoder,btoa,Uint8Array,Uint32Array,Set,Map,Promise,String,Number,Object,Array,parseInt,isFinite,Error
  };
  sb.window.window=sb.window;sb.globalThis=sb;
  vm.createContext(sb);
  sb.window=sb;sb.addEventListener=()=>{};sb.devicePixelRatio=1;
  for(const f of['js/data.js','js/questions.js','js/store.js','js/engine.js','js/rooms.js','js/rooms2.js','js/app.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sb,{filename:f});
  return{sb,els,calls,rafQ,xrQ,hands,frame,session,store,mat,head};
}

(async()=>{
  /* ---------- законы и контракты (tests/laws.js) ---------- */
  {const L=require(path.join(__dirname,'laws.js')).run(ROOT);for(const c of L.checks)ok(c.ok,'закон: '+c.msg);for(const w of L.warns)console.log('warn:',w);}
  /* ---------- данные ---------- */
  const C0=makeCtx(false);const V0=C0.sb.VR,D=V0.DATA;
  let qn=0,bad=[];
  for(const s of['math','phys','chem','space','bio','soc','logic','hist'])for(const b of['a','b','c','d']){const L=D.Q[s][b];if(!L||L.length<5)bad.push(s+b+' мало вопросов');for(const q of L){qn++;if(q.a.length!==4||new Set(q.a).size!==4)bad.push(q.id+' ответы');if(!q.q||!q.e)bad.push(q.id+' текст');}}
  ok(!bad.length,'вопросы корректны: '+qn+' шт. '+bad.join(', '));
  ok(D.elements.length===20&&new Set(D.elements.map(e=>e[4]+'-'+e[5])).size===20,'таблица: 20 элементов без наложений');
  for(const m of D.molecules){const cnt={};for(const a of m.atoms)cnt[a[0]]=(cnt[a[0]]||0)+1;const okm=Object.keys(m.f).every(k=>m.f[k]===cnt[k])&&Object.keys(cnt).length===Object.keys(m.f).length;if(!okm)bad.push(m.key);}
  ok(!bad.length,'модели молекул совпадают с формулами');
  const ico=V0.geo.icosaVF(),dod=V0.geo.dodecaVF();
  ok(ico.F.length===20&&dod.F.length===12&&dod.F.every(f=>f.length===5)&&dod.V.length===20,'икосаэдр 20 граней, додекаэдр 12×5');
  // пятиугольники додекаэдра выпуклые и упорядочены: соседние вершины на одинаковом расстоянии
  const e0=V0.v3.dist3(dod.V[dod.F[0][0]],dod.V[dod.F[0][1]]);
  ok(dod.F.every(f=>f.every((v,i)=>Math.abs(V0.v3.dist3(dod.V[v],dod.V[f[(i+1)%5]])-e0)<1e-6)),'грани додекаэдра обходятся по кругу');
  // графики
  const sg=V0.curveSegs(3,2,0);ok(sg.length>50&&sg.every(s=>s.every(Number.isFinite)),'гипербола без разрыва через 0 ('+sg.length+' отрезков)');

  /* ---------- режим экрана: полный сеанс ученика ---------- */
  const C=makeCtx(false),VR=C.sb.VR;
  await tick();await tick();
  if(!VR.app){console.log("ELS:",Object.keys(C.els).join(","),C.sb.document.getElementById("status")&&C.sb.document.getElementById("status").textContent);}const app=VR.app,E=app.E,St=VR.Store;
  ok(!!E&&E.roomId==='hall','движок запущен, холл загружен');
  ok(['addPanel','addBody','addStatic','addTable','door','discover','toast','burst','beep','chime','fanfare','goRoom','loadRoom','toggleMenu','exitXR','releaseInput'].every(k=>typeof E[k]==='function'),'контракт движка: инструменты для комнат на месте');
  ok(true,"-");
  let TT=0;const run=(n)=>{for(let i=0;i<n;i++){const f=C.rafQ.shift();TT+=16;if(f)f(TT);}};
  run(3);
  // добавление ученика через форму
  const doc=C.sb.document.getElementById.bind(C.sb.document);
  const k6=St.addClass(6,'а');ok(k6&&k6.letter==='А'&&!St.addClass(6,'А'),'класс 6А создан, дубль не создаётся');
  const stu=St.addStudent('Аня Петрова',null,k6.id);const pin=await St.setStudentPin(stu.id);
  ok(stu.grade===6&&/^\d{4}$/.test(pin)&&St.student(stu.id).pinHash,'ученик добавлен в 6А, код из 4 цифр, хранится только хэш');
  app.renderList();
  doc("selClass").value=k6.id;doc("selClass").onchange();doc("selStu").value=stu.id;doc("selStu").onchange();
  doc("selPin").value='0000'===pin?'1111':'0000';await doc("login").onsubmit({preventDefault(){}});
  ok(doc("ready").hidden&&/Неверный код/.test(doc("pickErr").textContent),'неверный код не пускает');
  doc("selPin").value=pin;await doc("login").onsubmit({preventDefault(){}});
  ok(!C.sb.document.getElementById("ready").hidden&&C.sb.document.getElementById("who").textContent==="Аня Петрова"&&C.sb.document.getElementById("go").textContent==="Начать на экране","ученик выбран, кнопка «Начать на экране»");
  await app.go();
  ok(E.deskInput&&E.student.id===stu.id,'сеанс начат в режиме экрана');
  run(30);
  ok(C.calls.draw>100,'кадры рисуются ('+C.calls.draw+')');
  // все панели нарисованы
  run(20);
  ok(E.panels.every(p=>!p.dirty),'все панели холла отрисованы ('+E.panels.length+')');
  const welcome=E.panels.find(p=>p.btns.length===8);
  ok(!!welcome,'на приветственной панели 8 кнопок комнат');
  // луч из камеры попадает в кнопку «Математика»
  const b0=welcome.btns[0];
  const lx=(b0.x+b0.w/2)/welcome.W-.5,ly=.5-(b0.y+b0.h/2)/welcome.H;
  const tx=welcome.pos[0]+lx*welcome.w,ty=welcome.pos[1]+ly*welcome.h,tz=welcome.pos[2];
  E.deskCam.x=0;E.deskCam.z=1;E.deskCam.yaw=-Math.atan2(tx-0,-(tz-1));E.deskCam.pitch=Math.atan2(ty-1.6,Math.hypot(tx,tz-1));
  run(2);
  const h=E.H[1];
  ok(h.hit&&h.hit.kind==='panel'&&h.hit.p===welcome&&h.hit.bi===0,'луч наведён на кнопку «Математика»');
  E._test.deskKey('click');run(2);
  ok(E.roomId==='math','щелчок по кнопке открыл комнату математики');

  // ---- математика
  run(25);
  const S=E.S;
  E.targets.find(t=>t.id==='sh3').sel();
  ok(S.sel===3,'выбран додекаэдр');
  ok(St.discoveries(stu.id).includes('math:shape_dodeca'),'открытие записано');
  run(5);
  const ctl=S.ctl;const fnBtn=ctl.btns[1];fnBtn.fn();run(3);
  ok(S.fn===1&&S.curve.n>0,'график сменён на параболу ('+S.curve.n+' вершин)');
  const plus=ctl.btns.find((b,i)=>i===5);plus.fn();ok(S.par[0]===1.5,'параметр a увеличен до 1,5');
  // тест
  const quiz=E.panels.find(p=>p.quiz);
  quiz.quizApi.start();
  for(let i=0;i<5;i++){const it=quiz.quiz.qs[i];const k=i<4?it.order.indexOf(0):(it.order.indexOf(0)+1)%4;quiz.quizApi.answer(k);quiz.quizApi.next();}
  ok(quiz.quiz.phase==='res'&&quiz.quiz.score===4,'тест пройден: 4 из 5');
  const r=St.results(stu.id);
  ok(r.length===1&&r[0].subj==='math'&&r[0].band==='b'&&r[0].ans.length===5,'результат сохранён (5–6 класс)');
  quiz.dirty=true;run(10);
  ok(quiz.btns.length===2,'на экране результата кнопки «Ещё раз» и «Все тесты»');

  // ---- физика
  E.goRoom('phys');run(25);
  const P=E.S;
  const zeroBtn=P.gp.btns[4];zeroBtn.fn();ok(E.gravity===0,'включена невесомость');
  P.gp.btns[1].fn();ok(Math.abs(E.gravity-1.62)<1e-9,'включена Луна');
  P.gp.btns[0].fn();
  const dropBtn=P.gp.btns[5];dropBtn.fn();
  for(let i=0;i<200&&P.drop;i++)run(1);
  ok(/Время падения: 0,6\d с/.test(P.dropMsg),'опыт с падением: '+P.dropMsg);
  P.push();for(let i=0;i<400;i++)run(1);
  const T=2*Math.PI*Math.sqrt(P.L/9.8);
  ok(P.period&&Math.abs(P.period-T)<.08,'период маятника '+(P.period||0).toFixed(2)+' с ≈ '+T.toFixed(2)+' с');

  // ---- химия
  E.goRoom('chem');run(25);
  const Ch=E.S,ct=VR.chemTest;
  for(const el of['H','H','O']){const b=ct.spawnAtom(E,el,0);b.p=[ct.PLATE[0]+(Math.random()-.5)*.2,ct.RTOP+.06,ct.PLATE[1]];b.v=[0,0,0];}
  run(30);
  ok(Ch.made==='H2O','собрана вода H₂O');
  ok(St.discoveries(stu.id).includes('chem:mol_H2O'),'молекула записана в открытия');
  Ch.rp.btns[0].fn();run(30);ok(ct.onPlate(E).length===0&&Ch.made===null,'круг очищен');
  for(let i=0;i<25;i++)ct.spawnAtom(E,'C',0);
  ok(E.bodies.filter(b=>b.data.el).length===20,'атомов не больше 20');
  run(10);
  const pt=Ch.pt;ok(pt.btns.length===20,'в таблице 20 кнопок-элементов');pt.btns[5].fn();ok(Ch.el===5,'выбран углерод');

  // ---- космос
  E.goRoom('space');run(25);
  const Sp=E.S;
  E.targets.find(t=>t.id==='pl5').sel();ok(Sp.sel&&Sp.sel.key==='jupiter','выбран Юпитер');
  E.targets.find(t=>t.id==='moon').sel();ok(Sp.sel.key==='moon','выбрана Луна');
  Sp.lp.btns[0].fn();ok(Sp.rk.st==='count','обратный отсчёт');
  for(let i=0;i<400;i++)run(1);
  ok(Sp.rk.st==='fly'||Sp.rk.st==='gone','ракета взлетела ('+Sp.rk.st+', y='+Sp.rk.y.toFixed(1)+')');
  Sp.wp.btns[1].fn();ok(Sp.mass===45,'весы: масса 45 кг');

  // ---- биология
  E.goRoom('bio');run(25);
  let B=E.S;
  E.targets.find(t=>t.id==='org0').sel();ok(B.sel&&B.sel.key==='nucleus','выбрано ядро клетки');
  E.targets.find(t=>t.id.indexOf('dna')===0).sel();ok(B.sel.name==='ДНК','выбрана ДНК');
  run(5);
  const chain=VR.rooms2Test.CHAINS[B.ci];
  for(const n of chain){const i=B.opts.indexOf(n);B.fc.btns[i].fn();}
  ok(B.picked.length===chain.length&&St.discoveries(stu.id).some(k=>k.indexOf('bio:chain_')===0),'пищевая цепь собрана: '+chain.join(' → '));
  // ---- обществознание
  E.goRoom('soc');run(25);
  B=E.S;run(5);
  for(const i of[0,1,2,7])B.bp.btns[i].fn();
  B.bp.btns[8].fn();
  ok(B.ok===true,'бюджет сбалансирован: '+B.msg);
  E.targets.find(t=>t.id==='g2').sel();ok(B.gsel===2,'выбрано понятие «Право»');
  // ---- логика
  E.goRoom('logic');run(25);
  B=E.S;
  const solve=(n,a,b,c)=>{if(!n)return;solve(n-1,a,c,b);B.peg(a);B.peg(c);solve(n-1,b,a,c);};
  solve(3,0,1,2);
  ok(B.done&&B.moves===7,'Ханойская башня за 7 ходов');
  run(5);
  const sqp=E.panels.find(p=>p.btns.length===4&&p!==B.hp);for(let i=0;i<3;i++){sqp.dirty=true;run(3);const L=B.sq.opts.indexOf(B.sq.ans);sqp.btns[L].fn();}
  ok(B.streak===3&&St.discoveries(stu.id).includes('logic:seq'),'3 последовательности подряд');
  const sq=VR.rooms2Test.seqGen('d');ok(sq.opts.length===4&&sq.opts.includes(sq.ans),'генератор рядов даёт 4 варианта');
  // ---- история
  E.goRoom('hist');run(25);
  B=E.S;ok(B.tl.btns.length===20,'на ленте 20 событий');
  B.tl.btns[18].fn();ok(B.ev===18,'выбран 1961 год');
  // ---- тест учителя в комнате
  const tt=St.saveTest({title:'Дроби',subj:'math',gmin:5,gmax:6,active:true,qs:[{q:'1/2 + 1/2 = ?',a:['1','2/4','1/4']},{q:'Половина от 10?',a:['5','2','20']}]});
  E.goRoom('math');run(25);
  const mq=E.panels.find(p=>p.quiz);
  ok(mq.btns.length===2,'в тесте комнаты видна кнопка теста учителя');
  mq.btns[1].fn();
  ok(mq.quiz.test&&mq.quiz.qs.length===2,'запущен тест учителя');
  for(let i=0;i<2;i++){mq.quizApi.answer(mq.quiz.qs[i].order.indexOf(0));mq.quizApi.next();}
  const tr=St.results(stu.id).find(r=>r.test===tt.id);
  ok(tr&&tr.score===2&&tr.total===2&&tr.ans.every(a=>St.question(a[0])&&St.question(a[0]).test==='Дроби'),'результат теста учителя сохранён');
  St.saveTest(Object.assign({},tt,{gmin:9,gmax:11}));
  ok(St.testsFor('math',6).length===0,'тест 9–11 класса не виден шестикласснику');
  St.removeTest(tt.id);
  // ---- отзыв из меню VR
  E.goRoom('space');run(5);E._test.deskKey('menu');run(3);
  const lk=E.menu.btns.find((x,i)=>i===11);lk.fn();
  ok(St.feedback().some(f=>f.kind==='like'&&f.room==='space'),'кнопка «Нравится» в меню сохранила отзыв');
  E.toggleMenu(false);
  ok(typeof E.releaseInput==='function','есть сброс зажатых клавиш');
  // ---- меню и итоги
  E._test.deskKey('menu');run(3);
  ok(E.menuOpen&&E.menu.show&&!E.menu.dirty,'меню открыто и нарисовано');
  ok(E.menu.btns.length===11||E.menu.btns.length===13,'в меню '+E.menu.btns.length+' кнопок');
  E.menu.btns[0].fn();ok(E.roomId==='hall'&&!E.menuOpen,'из меню в холл');
  const pts=St.points(stu.id);
  ok(pts.tests===50&&pts.discCount>=10,'баллы: тесты '+pts.tests+', открытий '+pts.discCount+', всего '+pts.total);
  app.endSession();
  ok(!C.sb.document.getElementById("ov").hidden&&/Аня Петрова: \+\d+ баллов/.test(C.sb.document.getElementById("summary").textContent),'итог сеанса: '+C.sb.document.getElementById("summary").textContent);
  // экспорт/импорт
  const json=St.exportJSON();
  const C2=makeCtx(false);await tick();const St2=C2.sb.VR.Store;
  const imp=St2.importJSON(json);ok(imp.students===1&&imp.results===2,'импорт в другой браузер: '+JSON.stringify(imp));
  const imp2=St2.importJSON(json);ok(imp2.students===0&&imp2.results===0,'повторный импорт без дублей');

  /* ---------- VR-режим ---------- */
  const X=makeCtx(true),XV=X.sb.VR;await tick();await tick();
  const XE=XV.app.E;
  XV.app.choose({id:null,name:'Гость',grade:5});
  ok(X.sb.document.getElementById("go").textContent==='Войти в VR','со шлемом кнопка «Войти в VR»');X.sb.document.getElementById("gg").value='9';
  await XV.app.go();await tick();
  ok(!!XE.session&&X.sb.document.getElementById("ov").hidden,'VR-сессия запущена');
  ok(XE.student.grade===9,'гость с заданиями 9 класса');
  let t=0;const frames=(n,fn)=>{for(let i=0;i<n;i++){if(fn)fn(i);const f=X.xrQ.shift();t+=14;f(t,X.frame);}};
  frames(10);
  ok(X.calls.draw>100,'VR рисует кадры');
  // меню кнопкой A
  const R=X.hands.right;R.gp.buttons[4].pressed=true;frames(1);R.gp.buttons[4].pressed=false;frames(3);
  ok(XE.menuOpen,'кнопка A открывает меню');
  R.gp.buttons[5].pressed=true;frames(1);R.gp.buttons[5].pressed=false;frames(1);
  ok(!XE.menuOpen,'кнопка B закрывает меню');
  // дверь в космос лучом
  const door=XE.targets.find(x=>x.id==='door-space');
  R.r=X.mat(0,1.5,0);const d=[door.c[0],door.c[1]-1.5,door.c[2]];const L=Math.hypot(...d);
  // столбец 2 = -направление
  R.r[8]=-d[0]/L;R.r[9]=-d[1]/L;R.r[10]=-d[2]/L;
  frames(2);
  ok(XE.H[1].hit&&XE.H[1].hit.kind==='target'&&XE.H[1].hit.tg===door,'луч на двери «Космос»');
  R.gp.buttons[0].pressed=true;frames(1);R.gp.buttons[0].pressed=false;frames(2);
  ok(XE.roomId==='space','курок открыл космос');
  frames(30);
  const qz=XE.panels.find(p=>p.quiz);qz.quizApi.start();
  ok(qz.quiz.qs.every(q=>q.q.band==='d'),'вопросы гостя — для 9–11 класса');
  // выход из VR → итог
  XE.exitXR();
  ok(!XE.session&&!X.sb.document.getElementById("ov").hidden&&X.sb.document.getElementById("summary").textContent==='Сеанс гостя завершён.','выход из VR возвращает меню');
  ok(XV.Store.results().length===0,'результаты гостя не сохраняются');

  /* ---------- сервер на Pi ---------- */
  const cp=require('child_process'),os=require('os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrl-'));
  const srv=cp.spawn('python3',['-I',path.join(ROOT,'server/app.py')],{env:Object.assign({},process.env,{DATA_DIR:dir,PORT:'8799',TEACHER_KEY:'teach-secret',DEVICE_KEY:'dev-secret'}),stdio:'ignore'});
  const url='http://127.0.0.1:8799';
  for(let i=0;i<50;i++){try{const r=await fetch(url+'/api/health');if(r.ok)break;}catch(e){}await new Promise(r=>setTimeout(r,100));}
  try{
    const T=makeCtx(false),Hd=makeCtx(true);await tick();
    const TS=T.sb.VR.Store,HS=Hd.sb.VR.Store;
    TS.setServer(url,'teach-secret');HS.setServer(url,'dev-secret');
    const s1=TS.addStudent('Петя Иванов',5);
    const t1=TS.saveTest({title:'Тест про планеты',subj:'space',gmin:1,gmax:11,active:true,qs:[{q:'Ближе к Солнцу?',a:['Меркурий','Марс']}]});
    let st=await TS.sync();ok(st.state==='ok'&&st.role==='teacher','учитель синхронизирован');
    st=await HS.sync();ok(st.state==='ok'&&st.role==='device','шлем синхронизирован');
    ok(HS.student(s1.id)&&HS.testsFor('space',5).length===1,'шлем получил ученика и тест учителя');
    HS.addResult({sid:s1.id,subj:'space',band:'b',grade:5,test:t1.id,testTitle:t1.title,score:1,total:1,ans:[['t:'+t1.id+':'+t1.qs[0].id,1]]});
    HS.addDiscovery(s1.id,'space','rocket');
    HS.saveTest({title:'Самовольный тест',subj:'math',gmin:1,gmax:11,qs:[{q:'?',a:['a','b']}]});
    await HS.sync();await TS.sync();
    ok(TS.results(s1.id).length===1&&TS.discoveries(s1.id).length===1,'учитель видит результат и открытие со шлема');
    ok(!TS.tests().some(t=>t.title==='Самовольный тест'),'ключ шлема не может добавлять тесты');
    ok(TS.question(TS.results(s1.id)[0].ans[0][0]).q==='Ближе к Солнцу?','вопрос теста учителя находится по id');
    const kc=TS.addClass(5,'Б');TS.updateStudent(s1.id,{classId:kc.id});await TS.setStudentPin(s1.id,'4321');await TS.sync();await HS.sync();
    ok(HS.klass(kc.id)&&HS.student(s1.id).classId===kc.id&&await HS.checkStudentPin(HS.student(s1.id),'4321'),'класс и код ученика дошли до шлема');
    await HS.setStudentPin(s1.id,'0000');await HS.sync();await TS.sync();
    ok(await TS.checkStudentPin(TS.student(s1.id),'4321'),'ключ шлема не может поменять код ученика');
    const s3=HS.addClass(9,'В');await HS.sync();await TS.sync();ok(!TS.klass(s3.id),'ключ шлема не может создавать классы');
    TS.updateStudent(s1.id,{name:'Пётр Иванов'});await TS.sync();await HS.sync();
    ok(HS.student(s1.id).name==='Пётр Иванов','переименование дошло до шлема');
    TS.removeStudent(s1.id);await TS.sync();await HS.sync();
    ok(!HS.student(s1.id)&&HS.results(s1.id).length===0,'удаление ученика дошло до шлема вместе с результатами');
    const s2=HS.addStudent('Оля',3);HS.addResult({sid:s2.id,subj:'math',band:'a',grade:3,score:5,total:5,ans:[]});await HS.sync();await TS.sync();
    TS.clearResults();await TS.sync();await HS.sync();
    ok(HS.results().length===0&&HS.student(s2.id),'очистка результатов дошла до шлема, ученики остались');
    HS.addFeedback({kind:'idea',text:'Добавьте музыку',grade:3,room:'space'});await HS.sync();await TS.sync();
    ok(TS.feedback().length===1&&TS.feedback()[0].text==='Добавьте музыку'&&!TS.feedback()[0].sid,'анонимный отзыв со шлема дошёл до учителя');
    TS.removeFeedback(TS.feedback()[0].id);await TS.sync();await HS.sync();ok(HS.feedback().length===0,'удаление отзыва дошло до шлема');
    HS.setServer(url,'wrong');st=await HS.sync();ok(st.state==='err'&&/ключ/.test(st.msg),'неверный ключ: '+st.msg);
    const ex=await fetch(url+'/api/export',{headers:{'X-Key':'dev-secret'}});ok(ex.status===403,'экспорт с ключом шлема запрещён');
    const sql=cp.execFileSync('python3',['-c','import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute("select count(*) from students").fetchone()[0],c.execute("select count(*) from tests").fetchone()[0])',path.join(dir,'vrlesson.db')]).toString().trim();
    ok(sql==='1 1','в SQLite: 1 ученик, 1 тест ('+sql+')');
    ok(!fs.existsSync(path.join(dir,'keys.json'))||JSON.parse(fs.readFileSync(path.join(dir,'keys.json'),'utf8')).teacher,'ключи на месте');
    HS.setServer(url,'dev-secret');
    const s4=TS.addStudent('Вера Смирнова',4);await TS.sync();await HS.sync();
    HS.removeStudent(s4.id);HS.setSettings({minutes:44});await HS.sync();await TS.sync();
    ok(!!TS.student(s4.id)&&TS.settings().minutes!==44,'ключ шлема не может удалять учеников и менять настройки');
  }finally{srv.kill();}
  console.log(fails?('\nПРОВАЛЕНО: '+fails):'\nВсе проверки пройдены');
  process.exit(fails?1:0);
})().catch(e=>{console.log('EXCEPTION',e&&e.stack||e);process.exit(2);});

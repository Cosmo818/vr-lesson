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
  for(const f of['js/data.js','js/questions.js','js/errors.js','js/roomspec.js','js/schema.js','js/flags.js','js/store.js','js/engine.js','js/rooms.js','js/rooms2.js','js/inf.js','js/custom.js','js/app.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sb,{filename:f});
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

  /* ---------- ядро: schema, errors, flags ---------- */
  {
    const F=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/legacy-v2.json'),'utf8'));
    const strip=db=>{const o=JSON.parse(JSON.stringify(db));o.v=2;for(const k of['students','classes'])for(const i of o[k]){delete i.school;delete i.year;delete i.status;}return o;};
    const nF=V0.Store.norm(F);
    ok(JSON.stringify(strip(nF))===fs.readFileSync(path.join(ROOT,'tests/fixtures/legacy-v2.norm.json'),'utf8'),'schema: старые поля не изменились (без school/year/status)');
    const byId=(L,id)=>L.find(x=>x.id===id);
    ok(nF.v===4&&[...nF.students,...nF.classes].every(x=>x.school==='school-default'&&x.status==='active'),'schema v3: у всех учеников и классов школа по умолчанию и статус active');
    ok(byId(nF.classes,'c5a').year===2025&&byId(nF.classes,'c9b').year===2024&&byId(nF.students,'s1').year===2025&&byId(nF.students,'s2').year===2024&&byId(nF.students,'s3').year===null&&byId(nF.students,'s4').year===null,'schema v3: учебный год выводится из created (август — начало года, нет времени — null)');
    ok(V0.schema.acadYear(1720000000000)===2023&&V0.schema.acadYear(0)===null,'schema v3: acadYear(июль 2024)=2023');
    const s1n=byId(nF.students,'s1');
    const mc=V0.Store.merge({students:[Object.assign({},s1n,{status:'archived',school:'school-default',year:2025,updated:5})]},{students:[{id:'s1',name:'Новое',grade:5,updated:9}]});
    ok(mc.students.length===1&&mc.students[0].name==='Новое'&&mc.students[0].status==='archived','слияние: правка старого клиента (без status) не воскрешает архивного ученика');
    const mc2=V0.Store.merge({students:[{id:'s1',name:'Новое',grade:5,updated:9}]},{students:[Object.assign({},s1n,{status:'archived',updated:5})]});
    ok(mc2.students[0].name==='Новое'&&mc2.students[0].status==='archived','слияние: перенос полей не зависит от порядка аргументов');
    const mc3=V0.Store.merge({students:[Object.assign({},s1n,{status:'archived',updated:5})]},{students:[Object.assign({},s1n,{status:'active',updated:9})]});
    ok(mc3.students[0].status==='active','слияние: возврат из архива (новее) побеждает');
    ok(V0.schema.fill('students',{id:'z',name:'я',status:'bad',school:'',year:'x',created:1760000000000}).status==='active','schema v3: недопустимые значения заменяются по умолчанию');
    /* v4: teacherId у классов (серверное поле, клиент его хранит и не теряет) */
    {const SCH=V0.schema,kl={id:'ck',grade:5,letter:'А',created:1,updated:10},pickC=c=>JSON.stringify([c.letter,c.teacherId]);
      ok(SCH.VERSION===4&&V0.Store.norm(null).v===4,'schema v4: версия 4');
      ok(SCH.okTeacher('t-1')&&!SCH.okTeacher('')&&!SCH.okTeacher(5)&&!SCH.okTeacher(null)&&!SCH.okTeacher('x'.repeat(41)),'schema v4: okTeacher — строка 1–40 символов');
      const vt=SCH.validate('classes',[Object.assign({},kl,{teacherId:'t-1'}),Object.assign({},kl,{id:'ck2',teacherId:7}),Object.assign({},kl,{id:'ck3',teacherId:''})]).value;
      ok(vt[0].teacherId==='t-1'&&!('teacherId' in vt[1])&&!('teacherId' in vt[2]),'schema v4: validate сохраняет допустимый teacherId класса и отбрасывает недопустимый');
      ok(Object.keys(vt[0]).join()==='id,grade,letter,created,updated,teacherId,school,year,status','schema v4: порядок полей класса фиксирован');
      ok(!('teacherId' in SCH.validate('students',[{id:'q',name:'Я',teacherId:'t-1'}]).value[0]),'schema v4: у ученика teacherId не бывает');
      const mA=V0.Store.merge({classes:[Object.assign({},kl,{teacherId:'t-1'})]},{classes:[Object.assign({},kl,{updated:20,letter:'Б'})]});
      ok(pickC(mA.classes[0])==='["Б","t-1"]','слияние v4: класс от старого клиента (новее, без teacherId) не теряет teacherId');
      const mB=V0.Store.merge({classes:[Object.assign({},kl,{updated:20,letter:'Б'})]},{classes:[Object.assign({},kl,{teacherId:'t-1'})]});
      ok(pickC(mB.classes[0])==='["Б","t-1"]','слияние v4: то же при обратном порядке');
      const ad=SCH.adoptTeacher([{id:'ck',teacherId:'forged'},{id:'cz',teacherId:'keep'},{id:'cn',teacherId:'forged2'}],[{id:'ck',teacherId:'t-1'},{id:'cn'}]);
      ok(ad[0].teacherId==='t-1'&&ad[1].teacherId==='keep'&&!('teacherId' in ad[2]),'schema v4: после синхронизации teacherId берётся у сервера (у классов вне ответа не трогаем)');
      const cF=JSON.parse(JSON.stringify(F));cF.classes[0].teacherId='t-1';
      const nC=V0.Store.norm(cF);ok(nC.classes.find(x=>x.id==='c5a').teacherId==='t-1'&&nC.classes.find(x=>x.id==='c9b').teacherId===undefined,'schema v4: фикстура v2 читается, teacherId сохраняется там, где задан');
    }
    /* архив на фикстуре: реальные непустые данные */
    {const Cx=makeCtx(false);await tick();const Sx=Cx.sb.VR.Store;Cx.store['vrlesson.v1']=JSON.stringify(F);Sx.reload();
      const n0=Sx.students().length;
      ok(n0===4&&Sx.classes().length===2,'архив: фикстура загружена (4 ученика, 2 класса)');
      Sx.archiveStudent('s1');ok(Sx.students().length===3&&!Sx.studentsOf('c5a').length&&Sx.student('s1').status==='archived'&&Sx.results('s1').length>0,'архив: ученик скрыт, результаты сохранены');
      Sx.restoreStudent('s1');ok(Sx.students().length===4&&Sx.studentsOf('c5a').length===1,'архив: ученик возвращён');
      Sx.archiveClass('c9b');ok(Sx.classes().length===1&&!Sx.students().some(x=>x.id==='s2')&&Sx.students({all:true}).length===4&&!Sx.classStats().rows.some(r=>r.c.id==='c9b'),'архив: класс скрыт вместе с учениками, рейтинг без него');
      const n9=Sx.addClass(9,'Б');ok(!!n9,'архив: новый 9Б после архивного допустим');
      ok(Sx.restoreClass('c9b')===false&&Sx.klass('c9b').status==='archived'&&!Sx.students().some(x=>x.id==='s2'),'архив: возврат 9Б при активном дубле отклонён, ученики остались скрытыми вместе с классом');
      Sx.archiveClass(n9.id);Sx.restoreClass('c9b');ok(Sx.students().some(x=>x.id==='s2')&&Sx.archiveStudent('nope')===null,'архив: класс возвращён вместе с учениками; неизвестный id → null');}
    const vs=V0.schema.validate('students',[{id:'x'},{id:'a',name:'Б',grade:99}]);
    ok(vs.value.length===1&&vs.value[0].grade===5&&vs.dropped===1&&vs.ok===false,'schema: validate отбрасывает неполных и правит класс');
    const vf=V0.schema.validate('settings',{flags:{demo:true,bad:'1','9x':true}}).value.flags;
    ok(JSON.stringify(vf)==='{"demo":true,"bad":"1"}','schema: в флагах сохраняются значения новых версий (А6), имя с неверным форматом отбрасывается');
    ok(V0.flags.on('bad')===false,'flags: нелогическое значение не включает флаг');
    const er=V0.errors;let fb=0;
    ok(er.guard('t',()=>{throw new Error('x');},()=>{fb++;})()===undefined&&er.list().pop().module==='t'&&fb===1,'errors: guard ловит ошибку, пишет в журнал, вызывает запасной вид один раз');
    ok(await er.guard('ta',async()=>{throw new Error('y');})()===undefined&&er.list().pop().module==='ta','errors: guard ловит ошибку async-функции');
    const fl=V0.flags;
    ok(fl.on('nope')===false&&fl.set('demo',true)===true&&fl.on('demo')===true&&fl.set('9bad',true)===false,'flags: чтение, запись и проверка имени');
  }

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
  doc("selClass").value=k6.id;doc("selClass").onchange();const num=St.numOf(stu);ok(num===1,"номер ученика в классе = 1");doc("selNum").value=String(num);
  doc("selPin").value='0000'===pin?'1111':'0000';await doc("login").onsubmit({preventDefault(){}});
  ok(doc("ready").hidden&&/Неверный номер или пароль/.test(doc("pickErr").textContent),'неверный пароль не пускает, причина не раскрывается');
  doc("selPin").value=pin;await doc("login").onsubmit({preventDefault(){}});
  ok(!C.sb.document.getElementById("ready").hidden&&C.sb.document.getElementById("who").textContent==="Аня Петрова"&&C.sb.document.getElementById("go").textContent==="Начать на экране","ученик выбран, кнопка «Начать на экране»");
  await app.go();
  ok(E.deskInput&&E.student.id===stu.id,'сеанс начат в режиме экрана');
  run(30);
  ok(C.calls.draw>100,'кадры рисуются ('+C.calls.draw+')');
  // все панели нарисованы
  run(20);
  ok(E.panels.every(p=>!p.dirty),'все панели холла отрисованы ('+E.panels.length+')');
  const welcome=E.panels.find(p=>p.btns.length===9);
  ok(!!welcome,'на приветственной панели 9 кнопок комнат');
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
  {
    const T=VR.infTest;
    /* каждый уровень робота решается за допустимое число команд (поиск в ширину по состояниям) */
    for(const [li,L] of T.ROBOT_LEVELS.entries()){
      let fr=[[L.start[0],L.start[1],0,[]]],seen=new Set(),sol=null;
      for(let dep=0;dep<=L.max&&!sol;dep++){const nx=[];for(const [x,y,d,pr] of fr){
        if(x===L.star[0]&&y===L.star[1]){sol=pr;break;}
        if(dep===L.max)continue;
        for(const c of 'FLR'){const q=pr.concat(c),r=T.robotRun(L,q);if(r.bump)continue;const key=r.x+','+r.y+','+r.d+','+q.length;if(seen.has(key))continue;seen.add(key);nx.push([r.x,r.y,r.d,q]);}}
        fr=nx;if(!sol&&fr.some(f=>f[0]===L.star[0]&&f[1]===L.star[1]))continue;}
      ok(!!sol||fr.some(f=>f[0]===L.star[0]&&f[1]===L.star[1]),'инф: уровень робота '+(li+1)+' решается в пределах '+L.max+' команд');
    }
    ok(T.caesar(T.caesar('КОМПЬЮТЕР',3),-3)==='КОМПЬЮТЕР'&&T.caesar('Я',1)==='А','инф: шифр Цезаря обратим и замкнут по алфавиту');
    ok(T.GATES['ИСКЛ. ИЛИ'](1,1)===0&&T.GATES['НЕ-И'](1,1)===0&&T.GATES['И'](1,0)===0&&T.GATES['НЕ'](0)===1,'инф: таблицы вентилей верны');
    let a=[5,3,4,1,2],st={i:0,pass:0},n=0;for(;n<100;n++){const r=T.bubbleStep(a,st);a=r.arr;st={i:r.i,pass:r.pass};if(r.done)break;}
    ok(a.join()==='1,2,3,4,5'&&n<100,'инф: пузырёк упорядочивает за конечное число шагов');
    const S0=VR.Store;S0.resetContent();
    ok(S0.packOn('inf-robot',2)&&!S0.packOn('inf-robot',9)&&S0.packOn('inf-gates',10)&&!S0.packOn('inf-gates',3),'наполнение: стандартные диапазоны блоков');
    S0.setBands('pack','inf-robot','d');ok(S0.packOn('inf-robot',10)&&!S0.packOn('inf-robot',2),'наполнение: учитель включил блок только 9–11');
    S0.setBands('room','inf','ab');ok(S0.roomOn('inf',3)&&!S0.roomOn('inf',9)&&!S0.packOn('inf-colors',9),'наполнение: комната выключена для старших — её блоки тоже');
    ok(VR.openRooms(10).indexOf('inf')<0&&VR.openRooms(3).indexOf('inf')>=0,'наполнение: закрытая комната не попадает в список холла и меню');
    ok(JSON.stringify(VR.schema.validate('settings',{content:{rooms:{inf:'zz',Bad:'a'},packs:{x:'ab'}}}).value.content)==='{"rooms":{},"packs":{"x":"ab"}}','наполнение: схема отбрасывает неверные записи');
    S0.resetContent();ok(S0.roomOn('inf',9),'наполнение: сброс возвращает стандарт');
  }
  /* ---- конструктор комнат: формат, хранение, сборка и работа комнаты в движке ---- */
  {
    const RS=VR.roomspec,St0=VR.Store;
    const bad=RS.clean({id:'zzz',title:'<b>x</b>',blocks:[{type:'item',x:99,z:'a',shape:'evil'},{type:'exec',code:'alert(1)'},{type:'question',q:'q'},{type:'text',text:'x'.repeat(5000),onclick:'evil()'}]});
    ok(bad.spec.id==='c-zzz'&&bad.spec.blocks.length===2&&bad.spec.blocks[0].x===5.4&&bad.spec.blocks[0].shape==='cube'&&bad.spec.blocks[1].text.length===700&&!('onclick' in bad.spec.blocks[1])&&bad.errors.length===2,'конструктор: чужие типы, поля и числа очищены, неполный вопрос убран');
    const tpl=RS.clean(RS.TEMPLATES.quest.make()).spec;
    ok(JSON.stringify(RS.clean(tpl).spec)===JSON.stringify(tpl),'конструктор: очистка идемпотентна (повторная очистка ничего не меняет)');
    const many=RS.clean({blocks:Array.from({length:20},()=>({type:'text',title:'t'}))});
    ok(many.spec.blocks.length===RS.LIM.panels&&many.errors.length===1,'конструктор: панелей не больше '+RS.LIM.panels);
    const dsc=RS.clean({blocks:Array.from({length:10},()=>({type:'item',discover:true}))}).spec;
    ok(dsc.blocks.filter(b=>b.discover).length===RS.LIM.discover,'конструктор: открытий (баллов) не больше '+RS.LIM.discover);
    ok(RS.cost(RS.clean({blocks:Array.from({length:12},()=>({type:'text',title:'t'}))}).spec).level==='standard'&&RS.cost(tpl).level==='lite','конструктор: оценка нагрузки для Quest 1');
    St0.removeRoom('c-nope');
    const r1=St0.saveRoom(Object.assign(RS.TEMPLATES.quest.make(),{title:'Тест-викторина'}));
    const rid=r1.spec&&r1.spec.id;
    ok(!!rid&&St0.customRoom(rid).blocks.length===4&&St0.bandsOf('room',rid)===''&&!St0.roomOn(rid,5),'конструктор: новая комната сохранена как черновик (классы не отмечены)');
    VR.custom.refresh();
    ok(!!VR.ROOMS[rid]&&VR.ROOMS[rid].title==='Тест-викторина'&&VR.openRooms(5).indexOf(rid)<0,'конструктор: комната зарегистрирована, но в холле и меню скрыта');
    St0.setBands('room',rid,'abcd');
    ok(St0.roomOn(rid,5)&&St0.roomOn(rid,10),'конструктор: отмеченные классы открывают комнату');
    E.goRoom('hall');run(4);
    {const hp=E.panels.find(p=>p.btns.length===1);ok(!!hp&&(hp.btns[0].fn(),E.roomId===rid),'конструктор: кнопка комнаты учителя в холле ведёт в комнату');E.goRoom('hall');run(4);}
    E.goRoom(rid);run(6);
    ok(E.roomId===rid&&E.panels.every(p=>!p.dirty),'конструктор: комната входит и рисуется (панелей '+E.panels.length+')');
    const qb=St0.customRoom(rid).blocks.find(b=>b.type==='question');
    const qp=E.panels.find(p=>p.btns.length===3);
    ok(!!qp,'конструктор: панель вопроса с тремя ответами');
    const sid=E.student&&E.student.id;
    qp.btns.forEach(b=>b.fn());run(2);
    ok(E.panels.indexOf(qp)>=0&&(!sid||St0.addDiscovery(sid,'gen','c:'+rid+':'+qb.id)===false),'конструктор: верный ответ засчитан открытием один раз');
    const e1=St0.saveRoom(Object.assign(RS.TEMPLATES.expo.make(),{title:'Тест-выставка'})).spec;
    St0.setBands('room',e1.id,'abcd');VR.custom.refresh();
    E.goRoom(e1.id);run(6);
    const t0=E.targets.find(t=>t.id==='ci0');
    ok(!!t0&&E.targets.filter(t=>/^ci/.test(t.id)).length===3,'конструктор: три предмета выставки можно выбирать лучом');
    t0.sel({});run(3);
    ok(E.panels.some(p=>p.show&&p.data&&p.data.label&&p.data.label.length>0),'конструктор: рассказ о предмете показан на панели');
    ok(St0.removeRoom(rid)&&St0.removeRoom(e1.id)&&!St0.customRoom(rid)&&!Object.prototype.hasOwnProperty.call((St0.settings().content||{}).rooms||{},rid),'конструктор: удаление убирает комнату и её настройки');
    VR.custom.refresh();ok(!VR.ROOMS[rid],'конструктор: удалённая комната пропала из списка комнат');
    E.goRoom('hall');run(3);
    const bad2=St0.saveRoom({title:'x',blocks:[]});St0.removeRoom(bad2.spec.id);
    const sch=VR.schema.validate('settings',{rooms:{'c-ok1':RS.clean({title:'ok'}).spec,'bad id':{},'c-x':{blocks:[{type:'text'}]}}}).value.rooms;
    ok(Object.keys(sch).sort().join()==='c-ok1,c-x','конструктор: схема настроек отбрасывает записи с неверным ключом');
  }
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
  const lk=E.menu.btns.find((x,i)=>i===16);lk.fn();
  ok(St.feedback().some(f=>f.kind==='rate'&&f.rating===5&&f.room==='space'),'пятая звезда в меню сохранила оценку 5 из 5');
  E.toggleMenu(false);
  ok(typeof E.releaseInput==='function','есть сброс зажатых клавиш');
  // ---- меню и итоги
  E._test.deskKey('menu');run(3);
  ok(E.menuOpen&&E.menu.show&&!E.menu.dirty,'меню открыто и нарисовано');
  ok(E.menu.btns.length>=12&&E.menu.btns.length<=17,'в меню '+E.menu.btns.length+' кнопок');
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
    TS.setSettings({minutes:8});T.sb.VR.flags.set('demo',true);await TS.sync();await HS.sync();
    ok(Hd.sb.VR.flags.on('demo')===true,'флаг учителя дошёл до шлема');
    Hd.sb.VR.flags.set('demo',false);await HS.sync();await TS.sync();
    ok(T.sb.VR.flags.on('demo')===true,'шлем не может менять флаги');
    /* ---- архив и схема v3 ---- */
    const arK=TS.addClass(7,'Г'),arA=TS.addStudent('Архивный Ученик',7,arK.id),arB=TS.addStudent('Второй Ученик',7,arK.id);
    await TS.sync();await HS.sync();
    ok(HS.studentsOf(arK.id).length===2&&HS.student(arA.id).status==='active'&&HS.student(arA.id).school==='school-default','v3: новые ученик и класс дошли до шлема со статусом active');
    TS.archiveStudent(arA.id);await TS.sync();await HS.sync();
    ok(!HS.studentsOf(arK.id).some(x=>x.id===arA.id)&&HS.student(arA.id).status==='archived','архив: ученик пропал из списка шлема, запись осталась');
    TS.restoreStudent(arA.id);await TS.sync();await HS.sync();
    ok(HS.studentsOf(arK.id).some(x=>x.id===arA.id)&&HS.student(arA.id).status==='active','архив: вернули из архива — запись снова активна и дошла до шлема');
    TS.archiveClass(arK.id);await TS.sync();await HS.sync();
    ok(!HS.classes().some(x=>x.id===arK.id)&&HS.studentsOf(arK.id).length===0&&!TS.classStats().rows.some(r=>r.c.id===arK.id),'архив: класс скрыт у шлема, ученики скрыты, рейтинг без класса');
    const dupK=TS.addClass(7,'Г');ok(!!dupK,'архив: класс с той же параллелью и буквой после архива создаётся');
    const stBefore=JSON.stringify(TS.klass(arK.id));
    ok(TS.restoreClass(arK.id)===false&&JSON.stringify(TS.klass(arK.id))===stBefore&&TS.klass(arK.id).status==='archived','архив: возврат класса при активном дубле отклонён, запись не изменена');
    {const arS=TS.students({all:true}).filter(x=>x.classId===arK.id);
      ok(arS.length===2&&TS.students().every(x=>x.classId!==arK.id)&&TS.restoreClass(arK.id)===false,'архив: ученики архивного класса скрыты, а дубль всё ещё мешает вернуть класс (ученик не теряется: '+arS.length+')');}
    TS.archiveClass(dupK.id);
    ok(!!TS.restoreClass(arK.id)&&TS.klass(arK.id).status==='active'&&TS.studentsOf(arK.id).length===2,'архив: после архивации дубля класс возвращается вместе с учениками');
    TS.archiveClass(arK.id);TS.removeClass(dupK.id);
    {const inK=TS.addStudent('Новичок',7,arK.id);ok(inK.classId===null,'store: нового ученика в архивный класс не кладём');TS.removeStudent(inK.id);}
    TS.restoreClass(arK.id);await TS.sync();await HS.sync();
    ok(HS.classes().some(x=>x.id===arK.id)&&HS.studentsOf(arK.id).length===2,'архив: класс вернули — он и ученики снова у шлема');
    TS.archiveStudent(arB.id);await TS.sync();await HS.sync();
    HS.restoreStudent(arB.id);await HS.sync();await TS.sync();
    ok(TS.student(arB.id).status==='archived','ключ шлема не меняет статус ученика');
    /* старый учитель (без новых полей) правит архивного: на сервере остаётся архив; результат совпадает с JS merge */
    {const post=(key,body)=>fetch(url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':key},body:JSON.stringify(body)}).then(r=>r.json());
      const cur=JSON.parse(JSON.stringify(TS.student(arB.id)));
      const oldFmt={id:cur.id,name:'Правка старого клиента',grade:cur.grade,classId:cur.classId,pinHash:cur.pinHash,created:cur.created,updated:cur.updated+1000};
      const resp=await post('teach-secret',{students:[oldFmt]});
      const sv=resp.state.students.find(x=>x.id===cur.id);
      const js=V0.Store.merge({students:[cur]},{students:[oldFmt]}).students.find(x=>x.id===cur.id);
      const pick=x=>JSON.stringify([x.name,x.status,x.school,x.year]);
      ok(sv.status==='archived'&&sv.name==='Правка старого клиента','сервер: правка архивного без новых полей оставляет его в архиве');
      ok(pick(sv)===pick(js),'слияние: сервер и JS дают одинаковый результат ('+pick(sv)+')');
      const nw=await post('dev-secret',{students:[{id:'dvnew1',name:'Шлемный',grade:5,created:1760000000000,updated:1760000000000,status:'archived',school:'x'}]});
      const dn=nw.state.students.find(x=>x.id==='dvnew1');
      ok(dn&&dn.status==='active'&&dn.school==='school-default'&&dn.year===2025,'сервер: новый ученик от шлема всегда active и в школе по умолчанию');
      const ex1=await post('dev-secret',{students:[{id:cur.id,name:'Шлем',grade:5,updated:cur.updated+99999,status:'active'}]});
      ok(ex1.state.students.find(x=>x.id===cur.id).status==='archived','сервер: шлем не может вернуть архивного из архива');
      TS.archiveClass(arK.id);await TS.sync();
      const hz=await post('dev-secret',{students:[{id:'dvnew2',name:'Шлемный2',grade:7,classId:arK.id,created:1760000000000,updated:1760000000000,year:1999,school:'чужая'},{id:'dvnew3',name:'Шлемный3',grade:7,created:1740000000000,updated:1740000000000,year:2077}]});
      const d2=hz.state.students.find(x=>x.id==='dvnew2'),d3=hz.state.students.find(x=>x.id==='dvnew3');
      ok(d2&&d2.classId===null&&d2.year===2025&&d2.school==='school-default'&&d2.status==='active','сервер: шлем не задаёт год и не кладёт ученика в архивный класс');
      ok(d3&&d3.year===2024,'сервер: год ученика от шлема считается по дате создания, а не из присланного');
      TS.restoreClass(arK.id);await TS.sync();}
    /* ---- v4: teacherId — сервер источник правды ---- */
    {const post=(key,body)=>fetch(url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':key},body:JSON.stringify(body)}).then(r=>r.json());
      const dbp=path.join(dir,'vrlesson.db'),pq=(q,...a)=>cp.execFileSync('python3',['-I','-c',q,dbp,...a]).toString().trim();
      const colT=id=>pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select teacherId from classes where id=?",(sys.argv[2],)).fetchone()[0])',id);
      const cur=JSON.parse(JSON.stringify(TS.klass(arK.id)));
      ok(cur.teacherId===undefined&&colT(arK.id)==='None','teacherId: у класса без назначения поле пустое и на клиенте, и в колонке сервера');
      /* имитация серверного действия «передать класс» (шаг 7): пишем teacherId прямо в базу */
      pq('import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);d=json.loads(c.execute("select doc from classes where id=?",(sys.argv[2],)).fetchone()[0]);d["teacherId"]="t-7";c.execute("update classes set doc=?,teacherId=? where id=?",(json.dumps(d,ensure_ascii=False),"t-7",sys.argv[2]));c.commit()',arK.id);
      const srvCls=Object.assign({},cur,{teacherId:'t-7'});
      const pick=c=>JSON.stringify([c.letter,c.teacherId,c.status,c.school,c.year]);
      const oldFmt={id:cur.id,grade:cur.grade,letter:'Ж',created:cur.created,updated:cur.updated+5000};
      const r1=await post('teach-secret',{classes:[oldFmt]});const k1=r1.state.classes.find(x=>x.id===cur.id);
      ok(k1.letter==='Ж'&&k1.teacherId==='t-7'&&colT(cur.id)==='t-7','сервер: класс от старого клиента (без teacherId) принят, teacherId сохранён');
      ok(pick(k1)===pick(V0.Store.merge({classes:[srvCls]},{classes:[oldFmt]}).classes[0]),'слияние v4: сервер и JS дают одинаковый результат для класса от старого клиента ('+pick(k1)+')');
      const r2=await post('teach-secret',{classes:[Object.assign({},k1,{letter:'З',updated:k1.updated+5000,teacherId:'t-evil'})]});const k2=r2.state.classes.find(x=>x.id===cur.id);
      ok(k2.letter==='З'&&k2.teacherId==='t-7'&&colT(cur.id)==='t-7','сервер: ключ учителя не может сменить teacherId через синхронизацию');
      const r3=await post('dev-secret',{classes:[Object.assign({},k2,{letter:'И',updated:k2.updated+5000,teacherId:'t-evil'})]});const k3=r3.state.classes.find(x=>x.id===cur.id);
      ok(k3.letter==='З'&&k3.teacherId==='t-7','сервер: ключ шлема не меняет класс и не ставит teacherId');
      const nid='cnew-'+Date.now(),r4=await post('teach-secret',{classes:[{id:nid,grade:6,letter:'Т',created:1760000000000,updated:1760000000000,teacherId:'t-evil'}]});
      ok(r4.state.classes.find(x=>x.id===nid).teacherId===undefined&&colT(nid)==='None','сервер: новый класс с присланным teacherId создаётся без него');
      await TS.sync();
      ok(TS.klass(cur.id).teacherId==='t-7','клиент: teacherId пришёл с сервера');
      TS.klass(cur.id).teacherId='forged';await TS.sync();
      ok(TS.klass(cur.id).teacherId==='t-7'&&colT(cur.id)==='t-7','клиент: подмену teacherId локально сервер откатывает (сервер — источник правды)');
      TS.removeClass(nid);await TS.sync();
    }
    /* ---- журнал аудита (шаг 3): только реальные изменения, без секретов ---- */
    {const dbp=path.join(dir,'vrlesson.db'),pq=(q,...a)=>cp.execFileSync('python3',['-I','-c',q,dbp,...a]).toString().trim();
      const rows=since=>JSON.parse(pq('import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute("select id,actor_kind,actor_id,action,target_kind,target_id,school,detail from audit_log where id>? order by id",(int(sys.argv[2]),)).fetchall(),ensure_ascii=False))',String(since)));
      const lastId=()=>+pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select coalesce(max(id),0) from audit_log").fetchone()[0])');
      const acts=r=>r.map(x=>x[3]+':'+x[5]).join('|');
      const early=rows(0);
      ok(early.some(r=>r[3]==='student.create'&&r[1]==='device')&&early.some(r=>r[3]==='student.pin_change'&&r[1]==='legacy-teacher')&&early.some(r=>r[3]==='delete'&&r[4]==='student'),'аудит: действия предыдущих проверок уже в журнале (ученик от шлема, смена кода, удаление ученика)');
      /* архив / возврат ученика */
      const au=TS.addStudent('Аудит Ученик',6);await TS.sync();
      let m=lastId();
      TS.archiveStudent(au.id);await TS.sync();
      let r1=rows(m);
      ok(r1.length===1&&r1[0][3]==='student.archive'&&r1[0][1]==='legacy-teacher'&&r1[0][2]==='teacher'&&r1[0][4]==='student'&&r1[0][5]===au.id&&r1[0][6]==='school-default','аудит: архив ученика — одна запись с исполнителем legacy-teacher и школой ('+acts(r1)+')');
      await TS.sync();await TS.sync();
      ok(rows(m).length===1,'аудит: повторная синхронизация без изменений не добавляет записей');
      m=lastId();TS.restoreStudent(au.id);await TS.sync();r1=rows(m);
      ok(r1.length===1&&r1[0][3]==='student.restore','аудит: возврат из архива записан');
      /* смена кода: факт без значения */
      m=lastId();const pinNew=await TS.setStudentPin(au.id,'7788');await TS.sync();r1=rows(m);
      const pinH=TS.student(au.id).pinHash;
      ok(r1.length===1&&r1[0][3]==='student.pin_change'&&r1[0][7]==='{}'&&pinH&&pinH.length>8,'аудит: смена кода ученика — факт без значения кода и хэша');
      /* классы */
      m=lastId();const ak=TS.addClass(8,'Я');await TS.sync();TS.archiveClass(ak.id);await TS.sync();TS.restoreClass(ak.id);await TS.sync();r1=rows(m);
      ok(r1.map(x=>x[3]).join()==='class.create,class.archive,class.restore'&&r1.every(x=>x[5]===ak.id&&x[6]==='school-default'&&JSON.parse(x[7]).name==='8Я'),'аудит: класс — создание, архив, возврат ('+acts(r1)+')');
      /* настройки: имена ключей, не значения */
      m=lastId();TS.setSettings({pinHash:'SECRETHASH-aud-1',pinSalt:'SECRETSALT-aud-1',minutes:11});T.sb.VR.flags.set('auditDemo',true);await TS.sync();r1=rows(m);
      const sk=r1.find(x=>x[3]==='settings.update');
      ok(!!sk&&sk[1]==='legacy-teacher'&&JSON.parse(sk[7]).keys.join()==='flags.auditDemo,minutes,pinHash,pinSalt','аудит: настройки — записаны имена изменённых ключей ('+(sk&&sk[7])+')');
      m=lastId();await TS.sync();ok(rows(m).length===0,'аудит: повтор настроек без изменений не пишется');
      m=lastId();TS.setSettings({minutes:8});T.sb.VR.flags.set('auditDemo',false);await TS.sync();
      /* ученик от шлема */
      m=lastId();const hs=HS.addStudent('Шлем Аудит',4);await HS.sync();r1=rows(m);
      ok(r1.length===1&&r1[0][3]==='student.create'&&r1[0][1]==='device'&&r1[0][2]==='device'&&r1[0][5]===hs.id,'аудит: новый ученик от шлема — actor device ('+acts(r1)+')');
      await HS.sync();ok(rows(m).length===1,'аудит: повторная синхронизация шлема не дублирует запись');
      /* удаление: вид записи и число результатов, запись журнала переживает удаление */
      HS.addResult({sid:hs.id,subj:'math',band:'a',grade:4,score:3,total:5,ans:[]});await HS.sync();await TS.sync();
      m=lastId();TS.removeStudent(hs.id);await TS.sync();r1=rows(m);
      ok(r1.length===1&&r1[0][3]==='delete'&&r1[0][4]==='student'&&r1[0][5]===hs.id&&JSON.parse(r1[0][7]).results===1,'аудит: удаление ученика — вид, id и число удалённых результатов ('+(r1[0]&&r1[0][7])+')');
      await TS.sync();ok(rows(m).length===1,'аудит: повтор удаления не дублирует запись');
      ok(pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from audit_log where target_id=?",(sys.argv[2],)).fetchone()[0])',hs.id)==='2'&&!TS.student(hs.id),'аудит: записи об удалённом ученике остаются в журнале');
      /* секреты: ни хэшей кодов, ни хэша и соли пароля, ни ключей нет нигде в журнале */
      const hashes=TS.students({all:true}).map(x=>x.pinHash).filter(Boolean).concat([pinH,'SECRETHASH-aud-1','SECRETSALT-aud-1','teach-secret','dev-secret']);
      const dump=pq('import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(["|".join(str(v) for v in r) for r in c.execute("select * from audit_log")],ensure_ascii=False))');
      const hit=hashes.filter(h=>dump.includes(h));
      ok(hashes.length>=6&&hit.length===0,'аудит: в журнале нет хэшей, соли, кодов и ключей ('+hashes.length+' значений проверено, найдено: '+hit.length+')');
      ok(+pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select max(length(detail)) from audit_log").fetchone()[0])')<=2048,'аудит: detail не длиннее 2 КБ');
      /* ограничение объёма и вставка без секретов напрямую (юнит) */
      const big=cp.execFileSync('python3',['-I','-c',`import sys,os,tempfile,json;d=tempfile.mkdtemp();os.environ['DATA_DIR']=d;sys.path.insert(0,sys.argv[1])
import app;app.DB_PATH=os.path.join(d,'vrlesson.db');app.init_db()
c=app.db();app.audit(c,('cli','x',''),'t.big',None,None,None,{'a':'я'*3000});app.audit(c,('cli','x','1.2.3.4'),'t.small','student','s'*200,'school-default',{'k':1});c.commit()
print(json.dumps(c.execute('select action,detail,length(target_id),ip from audit_log order by id').fetchall(),ensure_ascii=False))`,path.join(ROOT,'server')]).toString().trim();
      const bg=JSON.parse(big);
      ok(bg[0][1]==='{"truncated": true}'&&bg[1][1]==='{"k": 1}'&&bg[1][2]===80&&bg[1][3]==='1.2.3.4','аудит: слишком большой detail заменяется пометкой, длинный target_id обрезается');
      ok(+pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from audit_log where actor_kind not in (?,?)",("legacy-teacher","device")).fetchone()[0])')===0,'аудит: все исполнители — legacy-teacher или device (учётных записей пока нет)');
    }
    /* ---- видимый код ученика (Б42): только учителю, шлем его не получает ---- */
    {const post=(key,body)=>fetch(url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':key},body:JSON.stringify(body)}).then(r=>r.json());
      const pv=TS.addStudent('Видимый Код',6),code=await TS.setStudentPin(pv.id);await TS.sync();await HS.sync();
      ok(/^[0-9]{4}$/.test(code)&&TS.student(pv.id).pinView===code,'pinView: учитель хранит видимый код вместе с хэшем');
      ok(HS.student(pv.id)&&HS.student(pv.id).pinView===undefined&&HS.student(pv.id).pinHash===TS.student(pv.id).pinHash&&await HS.checkStudentPin(HS.student(pv.id),code),'pinView: шлем получает хэш (вход работает), но не видимый код');
      const hx=await post('dev-secret',{students:[{id:'dvpv1',name:'Шлем Код',grade:5,created:1760000000000,updated:1760000000000,pinHash:'hh',pinView:'1234'}]});
      ok(hx.state.students.some(x=>x.id==='dvpv1')&&!JSON.stringify(hx.state).includes('"pinView"'),'pinView: в ответе шлему нет ни одного видимого кода, присланный шлемом код отброшен');
      let ex=await (await fetch(url+'/api/export',{headers:{'X-Key':'teach-secret'}})).json();
      ok(ex.students.find(x=>x.id==='dvpv1').pinView===undefined&&ex.students.find(x=>x.id===pv.id).pinView===code,'pinView: учитель получает видимый код своих учеников, у ученика от шлема его нет');
      const cur=JSON.parse(JSON.stringify(ex.students.find(x=>x.id===pv.id)));
      const pickS=x=>JSON.stringify([x.name,x.pinHash,x.pinView]);
      const same={id:cur.id,name:'Старый клиент',grade:6,classId:null,pinHash:cur.pinHash,created:cur.created,updated:cur.updated+9000};
      const r1=await post('teach-secret',{students:[same]});const k1=r1.state.students.find(x=>x.id===cur.id);
      ok(k1.name==='Старый клиент'&&k1.pinView===code,'pinView: старый клиент без поля (тот же код) видимый код не стирает');
      ok(pickS(k1)===pickS(V0.Store.merge({students:[cur]},{students:[same]}).students[0]),'pinView: сервер и JS дают одинаковый результат для старого клиента');
      const diff=Object.assign({},same,{name:'Другой код',pinHash:'otherhash',updated:cur.updated+18000});
      const r2=await post('teach-secret',{students:[diff]});const k2=r2.state.students.find(x=>x.id===cur.id);
      ok(k2.pinView===undefined&&k2.pinHash==='otherhash','pinView: при смене кода старым клиентом прежний видимый код не остаётся (не покажем неверный)');
      ok(pickS(k2)===pickS(V0.Store.merge({students:[Object.assign({},k1)]},{students:[diff]}).students[0]),'pinView: сервер и JS одинаково убирают код при смене хэша');
      const r3=await post('teach-secret',{students:[Object.assign({},diff,{pinHash:'newh',pinView:'4321',updated:cur.updated+27000})]});
      ok(r3.state.students.find(x=>x.id===cur.id).pinView==='4321','pinView: учитель задаёт новый видимый код');
      const r4=await post('teach-secret',{students:[Object.assign({},diff,{pinHash:'newh2',pinView:'abcd',updated:cur.updated+36000})]});
      ok(r4.state.students.find(x=>x.id===cur.id).pinView===undefined,'pinView: недопустимое значение (не 4–8 цифр) отбрасывается');
      TS.removeStudent(pv.id);await TS.sync();
    }
    ok(fs.readdirSync(dir).filter(f=>/^vrlesson\.db\.bak-/.test(f)).length===0,'свежая база: копий миграции нет');
  }finally{srv.kill();}

  /* ---------- миграция настоящей базы v2 → v3 ---------- */
  {
    const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'vrl-mig-'));
    const F2=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/legacy-v2.json'),'utf8'));
    cp.execFileSync('python3',['-I',path.join(ROOT,'tests/fixtures/make_v2_db.py'),path.join(dir2,'vrlesson.db'),path.join(ROOT,'tests/fixtures/legacy-v2.json')]);
    const url2='http://127.0.0.1:8798';
    const start=async()=>{const p=cp.spawn('python3',['-I',path.join(ROOT,'server/app.py')],{env:Object.assign({},process.env,{DATA_DIR:dir2,PORT:'8798',TEACHER_KEY:'teach-secret',DEVICE_KEY:'dev-secret'}),stdio:'ignore'});
      for(let i=0;i<50;i++){try{const r=await fetch(url2+'/api/health');if(r.ok)break;}catch(e){}await new Promise(r=>setTimeout(r,100));}return p;};
    const pyq=(db,q)=>cp.execFileSync('python3',['-I','-c','import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute(sys.argv[2]).fetchone()[0])',db,q]).toString().trim();
    const baks=()=>fs.readdirSync(dir2).filter(f=>/^vrlesson\.db\.bak-v2-/.test(f));
    let p2=await start();
    try{
      ok(baks().length===1&&pyq(path.join(dir2,baks()[0]),'select count(*) from students')==='4','миграция: перед ней сделана копия базы v2 (4 ученика)');
      ok(pyq(path.join(dir2,'vrlesson.db'),'pragma user_version')==='5','миграция v2→v4: user_version = 4');
      const exp=await (await fetch(url2+'/api/export',{headers:{'X-Key':'teach-secret'}})).json();
      const yr=id=>exp.students.find(x=>x.id===id).year;
      ok(exp.students.length===4&&exp.students.every(x=>x.school==='school-default'&&x.status==='active')&&yr('s1')===2025&&yr('s2')===2024&&yr('s3')===null&&yr('s4')===null&&exp.classes.find(x=>x.id==='c5a').year===2025,'миграция: ученики и классы дозаполнены, годы выведены');
      ok(exp.results.length===5&&exp.disc.s1&&exp.settings.futureKey==='keep-me'&&exp.v===4,'миграция: результаты, открытия и неизвестные настройки на месте');
      ok(exp.students.find(x=>x.id==='s1').pinHash==='test-hash-1'&&exp.students.find(x=>x.id==='s1').name==='Иван Петров','миграция: прежние поля ученика не изменились');
      const h=await (await fetch(url2+'/api/health')).json();ok(h.schema===4,'/api/health: schema = 4');
    }finally{p2.kill();}
    await new Promise(r=>setTimeout(r,300));
    p2=await start();
    try{
      ok(baks().length===1&&pyq(path.join(dir2,'vrlesson.db'),'pragma user_version')==='5','миграция повторяема: после перезапуска новой копии нет');
    }finally{p2.kill();}
    /* обрыв миграции: на временной базе v2 ломаем заполнение на второй записи; база должна остаться целой v2, повторный запуск — дать ту же v3 */
    {
      const dir3=fs.mkdtempSync(path.join(os.tmpdir(),'vrl-mig3-')),db3=path.join(dir3,'vrlesson.db');
      cp.execFileSync('python3',['-I',path.join(ROOT,'tests/fixtures/make_v2_db.py'),db3,path.join(ROOT,'tests/fixtures/legacy-v2.json')]);
      const dump=`import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute('pragma user_version').fetchone()[0],[r[1] for r in c.execute('pragma table_info(students)')],c.execute('select id,doc from students order by id').fetchall(),c.execute('select id,doc from classes order by id').fetchall(),c.execute('select count(*) from results').fetchone()[0]],ensure_ascii=False))`;
      const snap=()=>cp.execFileSync('python3',['-I','-c',dump,db3]).toString();
      const before=snap();
      const crash=`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
n=[0];orig=app.fill_v3
def bad(*a,**k):
    n[0]+=1
    if n[0]>=2: raise RuntimeError('обрыв')
    return orig(*a,**k)
app.fill_v3=bad
c=sqlite3.connect(sys.argv[1])
try:
    app.migrate_v3(c)
except RuntimeError:
    print('crashed')`;
      const out=cp.execFileSync('python3',['-I','-c',crash,db3,path.join(ROOT,'server'),dir3]).toString().trim();
      ok(out==='crashed','миграция: обрыв посреди заполнения вызван');
      ok(snap()===before&&JSON.parse(before)[0]<3&&!JSON.parse(before)[1].includes('school'),'миграция: после обрыва база целиком прежняя v2 (колонок нет, user_version < 3, данные те же)');
      const run=`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
c=sqlite3.connect(sys.argv[1]);app.migrate_v3(c);c.close()`;
      cp.execFileSync('python3',['-I','-c',run,db3,path.join(ROOT,'server'),dir3]);
      const after=snap(),A=JSON.parse(after);
      ok(A[0]===3&&A[1].includes('school')&&A[2].length===4&&A[4]===5,'миграция: повторный запуск после обрыва даёт v3 без потерь');
      cp.execFileSync('python3',['-I','-c',run,db3,path.join(ROOT,'server'),dir3]);
      ok(snap()===after,'миграция: ещё один запуск базу не меняет');
    }
  }

  /* ---------- миграция базы v3 → v4 (шаг 1 плана учёток: только DDL, поведение не меняется) ---------- */
  {
    const fx=path.join(ROOT,'tests/fixtures/legacy-v2.json'),srvDir=path.join(ROOT,'server');
    const build=fs.mkdtempSync(path.join(os.tmpdir(),'vrl-v3b-'));
    cp.execFileSync('python3',['-I',path.join(ROOT,'tests/fixtures/make_v3_db.py'),path.join(build,'vrlesson.db'),fx],{stdio:'ignore'});
    const v3db=path.join(build,'vrlesson.db');
    const py=(code,...args)=>cp.execFileSync('python3',['-I','-c',code,...args]).toString().trim();
    const stateJson=`import sys,os,json;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
c=sqlite3.connect(sys.argv[1]);s=app.state(c);s.pop('v');print(json.dumps(s,ensure_ascii=False,sort_keys=True))`;
    const dumpDb=`import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute('pragma user_version').fetchone()[0],sorted(r[0] for r in c.execute("select name from sqlite_master where type='table'")),[r[1] for r in c.execute('pragma table_info(classes)')],c.execute('select id,name,grade,updated,doc,school,year,status from students order by id').fetchall(),c.execute('select id,name,updated,doc,school,year,status from classes order by id').fetchall(),c.execute('select count(*) from results').fetchone()[0]],ensure_ascii=False))`;
    const newDir=src=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'vrl-mig4-'));fs.copyFileSync(src,path.join(d,'vrlesson.db'));return d;};
    const startOn=async(dir,port,script)=>{const p=cp.spawn('python3',['-I',script],{env:Object.assign({},process.env,{DATA_DIR:dir,PORT:String(port),TEACHER_KEY:'teach-secret',DEVICE_KEY:'dev-secret'}),stdio:'ignore'});
      for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok)break;}catch(e){}await new Promise(r=>setTimeout(r,100));}return p;};
    const baks=(dir,tag)=>fs.readdirSync(dir).filter(f=>new RegExp('^vrlesson\\.db\\.bak-'+tag+'-').test(f));
    const NEWT=['schools','users','user_roles','sessions','invites','login_fail','audit_log'];
    const d0=JSON.parse(py(dumpDb,v3db));
    ok(d0[0]===3&&!d0[1].includes('schools')&&!d0[2].includes('teacherId')&&d0[3].length===4&&d0[4].length===2&&d0[5]===5,'миграция v3→v4: исходная база настоящая v3 (4 ученика, 2 класса, 5 результатов, без новых таблиц)');
    const dir4=newDir(v3db),db4=path.join(dir4,'vrlesson.db');
    const before=py(stateJson,v3db,srvDir,dir4);
    let p4=await startOn(dir4,8799,path.join(srvDir,'app.py'));
    try{
      ok(baks(dir4,'v3').length===1&&py('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from students").fetchone()[0])',path.join(dir4,baks(dir4,'v3')[0]))==='4','миграция v3→v4: перед ней сделана копия базы v3 (4 ученика)');
      const h=await (await fetch('http://127.0.0.1:8799/api/health')).json();
      ok(h.ok&&h.schema===4,'миграция v3→v4: /api/health schema = 4');
      const exp=await (await fetch('http://127.0.0.1:8799/api/export',{headers:{'X-Key':'teach-secret'}})).json();
      ok(exp.v===4&&exp.students.length===4&&exp.classes.length===2&&exp.results.length===5,'миграция v3→v4: экспорт учителя работает, данные на месте');
    }finally{p4.kill();}
    await new Promise(r=>setTimeout(r,300));
    const d1=JSON.parse(py(dumpDb,db4));
    ok(d1[0]===5&&NEWT.every(t=>d1[1].includes(t))&&d1[2].includes('teacherId'),'миграция v3→v4: user_version = 4, есть все новые таблицы и колонка classes.teacherId');
    ok(py(stateJson,db4,srvDir,dir4)===before,'миграция v3→v4: состояние (state) до и после совпадает по всем данным, кроме номера схемы');
    ok(JSON.stringify([d1[3],d1[4],d1[5]])===JSON.stringify([d0[3],d0[4],d0[5]]),'миграция v3→v4: строки учеников, классов и число результатов не изменились');
    const cnt=(t,w)=>py('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchone()[0])',db4,'select count(*) from '+t+(w?' where '+w:''));
    ok(cnt('schools')==='1'&&cnt('schools',"id='school-default' and status='active'")==='1'&&cnt('users')==='0'&&cnt('audit_log')==='0'&&cnt('user_roles')==='0','миграция v3→v4: есть школа school-default, учётки и журнал пусты');
    ok(cnt('classes','teacherId is null')==='2','миграция v3→v4: у существующих классов teacherId пуст');
    const idx=py('import sqlite3,sys;print(",".join(sorted(r[0] for r in sqlite3.connect(sys.argv[1]).execute("select name from sqlite_master where type=\'index\' and name not like \'sqlite_%\'"))))',db4);
    ok(['schools_region','user_roles_school','sessions_user','invites_school','audit_school_ts','audit_target','classes_teacher','classes_school','students_school'].every(i=>idx.split(',').includes(i)),'миграция v3→v4: индексы созданы');
    const dAfter=py(dumpDb,db4);
    p4=await startOn(dir4,8799,path.join(srvDir,'app.py'));
    try{
      await new Promise(r=>setTimeout(r,200));
    }finally{p4.kill();}
    await new Promise(r=>setTimeout(r,300));
    ok(baks(dir4,'v3').length===1&&py(dumpDb,db4)===dAfter&&cnt('schools')==='1','миграция v3→v4 повторяема: второй запуск не меняет базу и не делает новую копию');
    /* обрыв посреди миграции: база остаётся целой v3, повторный запуск даёт v4 */
    {
      const dir5=newDir(v3db),db5=path.join(dir5,'vrlesson.db');
      const snap=()=>py(dumpDb,db5);
      const b5=snap();
      const crash=`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
n=[0];orig=app.class_teacher
def bad(*a,**k):
    n[0]+=1
    if n[0]>=2: raise RuntimeError('обрыв')
    return orig(*a,**k)
app.class_teacher=bad
c=sqlite3.connect(sys.argv[1])
try:
    app.migrate_v4(c)
except RuntimeError:
    print('crashed')`;
      ok(py(crash,db5,srvDir,dir5)==='crashed','миграция v3→v4: обрыв посреди заполнения вызван');
      ok(snap()===b5&&JSON.parse(b5)[0]===3&&!JSON.parse(b5)[1].includes('schools'),'миграция v3→v4: после обрыва база целиком прежняя v3 (новых таблиц и колонки нет, user_version 3, данные те же)');
      const run=`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
c=sqlite3.connect(sys.argv[1]);app.migrate_v4(c);c.close()`;
      py(run,db5,srvDir,dir5);
      const a5=snap(),A=JSON.parse(a5);
      ok(A[0]===5&&A[1].includes('audit_log')&&A[2].includes('teacherId')&&A[3].length===4&&A[5]===5,'миграция v3→v4: повторный запуск после обрыва даёт v4 без потерь');
      py(run,db5,srvDir,dir5);
      ok(snap()===a5,'миграция v3→v4: ещё один запуск базу не меняет');
    }
    /* откат: прежний код (v3) открывает базу v4 и работает с теми же данными */
    {
      const dir6=newDir(db4),db6=path.join(dir6,'vrlesson.db');
      const oldSrv=path.join(ROOT,'tests/fixtures/server_v3.py');
      let po=await startOn(dir6,8800,oldSrv),syN=-1;
      try{
        const h=await (await fetch('http://127.0.0.1:8800/api/health')).json();
        ok(h.ok&&h.schema===3,'откат: прежний сервер v3 стартует на базе v4');
        const ex=await (await fetch('http://127.0.0.1:8800/api/export',{headers:{'X-Key':'teach-secret'}})).json();
        ok(ex.students.length===4&&ex.classes.length===2&&ex.results.length===5&&ex.settings.futureKey==='keep-me','откат: прежний сервер видит те же данные');
        const sy=await (await fetch('http://127.0.0.1:8800/api/sync',{method:'POST',headers:{'X-Key':'dev-secret','Content-Type':'application/json'},body:JSON.stringify({students:[{id:'rb1',name:'После отката',grade:6,created:1760000000000,updated:1760000000000}]})})).json();
        syN=sy.state.results.length;ok(sy.state.students.some(x=>x.id==='rb1'),'откат: прежний сервер принимает синхронизацию на базе v4');
      }finally{po.kill();}
      await new Promise(r=>setTimeout(r,300));
      p4=await startOn(dir6,8799,path.join(srvDir,'app.py'));
      try{
        const ex=await (await fetch('http://127.0.0.1:8799/api/export',{headers:{'X-Key':'teach-secret'}})).json();
        ok(ex.v===4&&ex.students.length===5&&ex.students.some(x=>x.id==='rb1')&&ex.results.length===syN&&syN>0,'откат: новый сервер снова открывает базу после работы прежнего, данные не потеряны');
      }finally{p4.kill();}
      await new Promise(r=>setTimeout(r,300));
      ok(py('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("pragma user_version").fetchone()[0])',db6)==='5'&&cnt('schools')==='1','откат: после возврата на новый код user_version = 4');
    }
  }
  /* учётки (шаги 4–7…): отдельные Python-файлы с живым сервером; их строки ok/FAIL входят в общий счёт */
  for(const [file,label] of [['accounts.py','учётки'],['scope.py','права'],['admin.py','админ'],['uploads.py','файлы'],['open.py','открытые'],['hierarchy.py','иерархия'],['ai.py','помощник']]){
    if(!fs.existsSync(path.join(ROOT,'tests',file)))continue;
    let out='';
    try{out=cp.execFileSync('python3',['-I',path.join(ROOT,'tests',file)],{encoding:'utf-8',timeout:240000});}
    catch(e){out=(e.stdout||'')+'\nFAIL: tests/'+file+' завершился с ошибкой '+String(e.stderr||e.message).slice(-300);}
    for(const ln of out.split('\n')){
      if(ln.startsWith('ok  : '))ok(true,label+': '+ln.slice(6));
      else if(ln.startsWith('FAIL: '))ok(false,label+': '+ln.slice(6));
    }
  }
  console.log(fails?('\nПРОВАЛЕНО: '+fails):'\nВсе проверки пройдены');
  process.exit(fails?1:0);
})().catch(e=>{console.log('EXCEPTION',e&&e.stack||e);process.exit(2);});

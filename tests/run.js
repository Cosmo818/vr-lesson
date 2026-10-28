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
  for(const f of['js/data.js','js/questions.js','js/errors.js','js/roomspec.js','js/schema.js','js/flags.js','js/store.js','js/engine.js','js/rooms.js','js/rooms2.js','js/chem.js','js/chemtree.js','js/inf.js','js/chess.js','js/play.js','js/einstein.js','js/netproto.js','js/games.js','js/einroom.js','js/arena.js','js/custom.js','js/app.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sb,{filename:f});
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
  /* ---------- полная таблица и ядерная модель (Б65, шаги 28–29) ---------- */
  {
    const PT=D.ptable,N=V0.nuc,en=(z,a)=>({z,a}),near=(v,t,d)=>Math.abs(v-t)<=d;
    ok(PT.length===118&&new Set(PT.map(r=>r[0])).size===118,'ptable: 118 элементов с уникальными символами');
    ok(D.elements.every((e,i)=>PT[i][0]===e[1]&&PT[i][1]===e[2]&&PT[i][2]===e[3]),'ptable: первые 20 совпадают с D.elements');
    ok(PT.every(r=>D.elCats[r[4]]),'ptable: каждая категория есть в elCats');
    ok(PT.every((r,i)=>Number.isInteger(r[3])&&r[3]>=i+1&&r[3]<=300&&(i===0||r[3]>=2*(i+1)-2)),'ptable: массовые числа A разумны (Z ≤ A ≤ 300, A ≥ 2Z−2)');
    const sy={};PT.forEach(r=>sy[r[0]]=r[3]);
    ok(sy.H===1&&sy.He===4&&sy.C===12&&sy.O===16&&sy.Fe===56&&sy.Au===197&&sy.Pb===208&&sy.U===238&&sy.Og===294,'ptable: контрольные A (H, He, C, O, Fe, Au, Pb, U, Og)');
    ok(PT.every((r,i)=>{const z=i+1,brk=/^\[\d+\]$/.test(r[2]);return(brk===(z===43||z===61||z>=84&&z!==90&&z!==91&&z!==92))&&(brk||/^\d+(,\d+)?$/.test(r[2]));}),'ptable: масса — число, а [A] ровно у радиоактивных без Th, Pa, U');
    const cs=new Set();let cOk=true;for(let z=1;z<=118;z++){const c=N.cell(z);cs.add(c.row+','+c.col);if(c.col<1||c.col>18||![1,2,3,4,5,6,7,9,10].includes(c.row))cOk=false;}
    ok(cs.size===118&&cOk&&N.el(0)===null&&N.el(119)===null&&N.el(26).sym==='Fe'&&N.el(26).period===4&&N.el(92).rad&&!N.el(26).rad,'nuc: cell даёт 118 разных ячеек, el(Z) корректен');
    ok(Array.from({length:20},(_,i)=>N.be(i+1,PT[i][3])).every(b=>b&&b.exact),'nuc: у 20 первых элементов изотоп из таблицы есть в EX');
    const f1=N.fuse(en(6,12),en(2,4)),f2=N.fuse(en(8,16),en(2,4)),f3=N.fuse(en(6,12),en(6,12)),f4=N.fuse(en(6,12),en(8,16)),f5=N.fuse(en(1,1),en(3,7)),f6=N.fuse(en(2,4),en(2,4));
    ok(f1.ok&&f1.to[0].z===8&&f1.to[0].a===16&&near(f1.q,7.16,.01)&&f1.exact,'nuc: C-12 + He-4 → O-16, 7,16 МэВ');
    ok(near(f2.q,4.73,.01)&&near(f3.q,13.93,.02)&&f3.to[0].z===12&&near(f4.q,16.76,.02)&&near(f5.q,17.25,.02),'nuc: O+He, C+C, C+O, H+Li — энергии');
    ok(near(f6.q,-.09,.01)&&/распад[а-я]* на два/.test(V0.nuc.note(f6)),'nuc: He-4 + He-4 → Be-8, −0,09 МэВ, пояснение про распад');
    ok(N.fuse(en(1,1),en(1,1)).why==='pp'&&N.fuse(en(118,294),en(1,1)).why==='z>118','nuc: pp и Z > 118 — отказы');
    const ff=N.fuse(en(26,56),en(26,56));ok(ff.q<0&&!ff.exact,'nuc: Fe-56 + Fe-56 поглощает энергию, оценка');
    const sU=N.split(en(92,238)),fq=N.fissionQ(92,238);
    ok(sU.kind==='alpha'&&sU.to[0].z===90&&sU.to[0].a===234&&sU.to[1].z===2&&sU.q>2&&sU.q<9,'nuc: U-238 → Th-234 + He-4, альфа-распад');
    ok(N.split(en(92,235)).kind==='fission'&&N.split(en(92,235)).to.length===2&&N.split(en(82,208)).why==='stable'&&N.split(en(84,210)).kind==='alpha','nuc: U-235 — деление на 2 осколка; Pb-208 стабилен; Po-210 — альфа');
    ok(fq.q>150&&fq.q<230&&N.split(en(26,56)).why==='stable','nuc: принудительное деление U-238 ≈ 183 МэВ (fissionQ); Fe-56 стабилен, не распадается');
    const sh=N.split(en(2,4)),sl=N.split(en(3,7));
    ok(!sh.ok&&sh.why==='stable','nuc: He-4 стабилен');
    ok(!sl.ok&&sl.why==='stable','nuc: Li-7 стабилен');
    ok(N.split(en(1,1)).why==='h','nuc: у водорода делить нечего');
    {/* распад: одна модель для всех 118 элементов (Б65): сохранение Z и A, стабильные не распадаются */
      const cnt={};let bad=[];
      for(let z=1;z<=118;z++){const e=N.el(z),r=N.decayOf(z,e.a),k=r.ok?r.kind:r.why;cnt[k]=(cnt[k]||0)+1;
        if(r.ok){const sz=r.to.reduce((u,x)=>u+x.z,0)+(r.lz||0),sa=r.to.reduce((u,x)=>u+x.a,0)+r.n;if(sz!==z||sa!==e.a)bad.push(z);
          if(r.kind==='alpha'&&!(r.to.length===2&&r.to[1].z===2&&r.to[1].a===4&&r.to[0].z===z-2&&r.to[0].a===e.a-4))bad.push('α'+z);
          if(z<=82&&z!==43&&z!==61)bad.push('нестабильный '+z);}
        else if(z>=84||z===43||z===61)bad.push('не распадается '+z);}
      ok(bad.length===0,'распад: сохранение Z и A на всех 118, альфа = дочернее + He-4, Z ≤ 82 (кроме Tc, Pm) стабильны '+bad.join());
      ok(cnt.stable===80&&cnt.h===1&&cnt.beta===2&&cnt.alpha===35,'распад: 80 стабильных, H, 2 бета (Tc, Pm), 35 альфа '+JSON.stringify(cnt));
      const po=N.decayOf(84,210),c12=N.decayOf(6,12),bi=N.decayOf(83,209),f17=N.decayOf(9,17),u5=N.decayOf(92,235);
      ok(po.kind==='alpha'&&po.to[0].z===82&&po.to[0].a===206&&po.to[1].a===4,'распад: Po-210 → Pb-206 + He-4');
      ok(!c12.ok&&c12.why==='stable'&&!bi.ok&&!N.decayOf(26,56).ok&&!N.decayOf(9,19).ok,'распад: C-12, Bi-209, Fe-56, F-19 стабильны');
      ok(f17.kind==='beta'&&f17.to[0].z===8&&f17.to[0].a===17&&f17.lep==='e⁺','распад: F-17 → O-17 + e⁺ (бета-плюс)');
      ok(u5.to[0].z+u5.to[1].z===92&&u5.to[0].a+u5.to[1].a+u5.n===235&&u5.n>=2,'распад: U-235 — два осколка и нейтроны, Z и A сохраняются');
      ok(N.decayOf(4,8).to.length===2&&N.decayOf(4,8).to.every(x=>x.z===2&&x.a===4),'распад: Be-8 → 2 He-4');}
    ok(/0,42/.test(N.note(N.fuse(en(1,1),en(1,1))))&&/1,44/.test(N.note(N.fuse(en(1,1),en(1,1))))&&/аннигиляц/.test(N.note(N.fuse(en(1,1),en(1,1)))),'nuc: pp — 0,42 МэВ без аннигиляции и 1,44 МэВ с ней');
    ok(N.cond(34)&&N.cond(84)&&N.cond(85)&&N.cond(109)&&N.cond(118)&&!N.cond(26)&&!N.cond(108),'nuc: пометка «условно» у Se, Po, At и 109–118');
    ok(near(N.semf(26,56)/N.REF['26-56'],1,.01)&&near(N.semf(92,238)/N.REF['92-238'],1,.015),'nuc: формула Вайцзеккера в пределах 1 % / 1,5 % от справочника');
    ok(near(N.perGram(17.6,5)/3.4e8,1,.01)&&N.coalT(N.perGram(183,238))>2&&N.coalT(N.perGram(183,238))<3&&N.num(1.4e8)==='140 млн'&&N.fmtQ(f1)==='7,16 МэВ'&&N.fmtQ(ff).startsWith('≈ −'),'nuc: энергия на грамм, уголь, num и fmtQ');
    const cv=N.curve();ok(cv.length>60&&cv.every(p=>p[1]>=0&&p[1]<9.5)&&cv.some(p=>p[0]===56||p[0]>=55&&p[0]<=58),'nuc: curve() — график энергии связи на нуклон');
  }
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
    const strip=db=>{const o=JSON.parse(JSON.stringify(db));o.v=2;delete o.purged;for(const k of['students','classes'])for(const i of o[k]){delete i.school;delete i.year;delete i.status;}return o;};
    const nF=V0.Store.norm(F);
    ok(JSON.stringify(strip(nF))===fs.readFileSync(path.join(ROOT,'tests/fixtures/legacy-v2.norm.json'),'utf8'),'schema: старые поля не изменились (без school/year/status)');
    const byId=(L,id)=>L.find(x=>x.id===id);
    ok(nF.v===4&&[...nF.students,...nF.classes].every(x=>x.school==='school-default'&&x.status==='active'),'schema v3: у всех учеников и классов школа по умолчанию и статус active');
    ok(byId(nF.classes,'c5a').year===2025&&byId(nF.classes,'c9b').year===2024&&byId(nF.students,'s1').year===2025&&byId(nF.students,'s2').year===2024&&byId(nF.students,'s3').year===null&&byId(nF.students,'s4').year===null,'schema v3: учебный год выводится из created (август — начало года, нет времени — null)');
    ok(V0.schema.acadYear(1720000000000)===2023&&V0.schema.acadYear(0)===null,'schema v3: acadYear(июль 2024)=2023');
    const s1n=byId(nF.students,'s1');
    const mc=V0.Store.merge({students:[Object.assign({},s1n,{status:'archived',school:'school-default',year:2025,updated:5})]},{students:[{id:'s1',name:'Новое',grade:5,updated:9}]});
    const mt=V0.Store.merge({tests:[{id:'t1',title:'Новый',qs:[],updated:9}]},{tests:[{id:'t1',title:'Старый',qs:[],updated:5,author:'u1'}]});
    ok(mt.tests.length===1&&mt.tests[0].title==='Новый'&&mt.tests[0].author==='u1','слияние: автор теста сохраняется у победителя без поля (А11)');
    const mt2=V0.Store.merge({tests:[{id:'t1',title:'A',qs:[],updated:9,author:'local'}]},{tests:[{id:'t1',title:'B',qs:[],updated:5,author:'srv'}]});
    ok(mt2.tests[0].title==='A'&&mt2.tests[0].author==='srv','слияние: автор теста берётся из записи сервера (сторона B), а не из локальной (А11)');
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
  const Ch=E.S;
  run(10);
  {/* стенд «Химия» (Б65, шаг 30) */
    const L=VR.chemLab,N=VR.nuc,zb=()=>E.bodies.filter(b=>b.data&&b.data.zn),near=(v,t,d)=>Math.abs(v-t)<=d;
    const clr=()=>{for(const b of E.bodies.filter(b=>b.data&&(b.data.zn||b.data.mol)))E.removeBody(b);};
    const mk=(z,a,x,y,zz)=>{const b=L.makeBody(E,z,a,[x,y,zz]);b.v=[0,0,0];return b;};
    const pt=Ch.pt;ok(Ch.lab===true&&pt.btns.length===118&&pt.btns.every((b,i)=>b.z===i+1),'в таблице 118 кнопок, у каждой поле z');
    pt.btns[5].fn();ok(Ch.el===5&&St.discoveries(stu.id).includes('chem:el_C'),'выбран углерод, открытие chem:el_C');
    const fe=VR.ROOMS.chem.pick(E,Ch,E.H[1],{t:2,kind:'panel',p:Ch.pt,bi:25});
    ok(fe&&fe.data.zn===26&&fe.data.a===56&&E.bodies.includes(fe),'pick: из ячейки Fe появилось тело zn 26, a 56');
    ok(VR.ROOMS.chem.pick(E,Ch,E.H[1],{t:2,kind:'panel',p:Ch.board,bi:0})===null,'pick: по другой панели — null');
    clr();
    /* слияние: только по кнопке-табличке; атомы копятся */
    const press=i=>{const p=Ch.tabs[i];run(2);const bt=p.btns[0];if(!bt||bt.disabled)return false;bt.fn();run(2);return true;};
    mk(6,12,L.FV[0]-.06,.95,L.FV[1]);mk(2,4,L.FV[0]+.06,.95,L.FV[1]);run(80);
    ok(zb().length===2&&Ch.nuclear===false&&!Ch.vs[0].ready,'режим «Химия» по умолчанию: C + He — не вещество, табличка тусклая '+zb().length+Ch.nuclear+Ch.vs[0].ready);
    L.toggleMode(E,Ch);run(5);
    ok(Ch.nuclear===true&&zb().length===2&&Ch.last===null&&Ch.vs[0].ready===true,'слияние: само не срабатывает, табличка «Слияние» готова');
    ok(Ch.tabs[0].btns[0]&&!Ch.tabs[0].btns[0].disabled,'табличка слияния — активная кнопка, когда реакция возможна');
    ok(press(0),'нажатие на табличку слияния');
    const o16=zb();
    ok(o16.length===1&&o16[0].data.zn===8&&o16[0].data.a===16&&Ch.slots.includes(o16[0])&&Ch.last&&Ch.last.ok&&near(Ch.last.q,7.16,.02),'слияние C-12 + He-4 → O-16 по кнопке, результат лежит в гнезде склада, Q ≈ 7,16');
    ok(St.discoveries(stu.id).includes('chem:fusion')&&Ch.hist.length===1,'открытие chem:fusion, история реакций');
    ok(Ch.cur.z===8,'текущий элемент дерева — результат реакции');
    clr();run(3);
    /* распад и отказ */
    mk(92,238,L.DV[0],.95,L.DV[1]);run(80);
    ok(Ch.last.kind==='fusion'&&zb().length===1,'распад: сам не срабатывает');
    ok(press(2),'нажатие на табличку распада');
    const dz=zb().map(b=>b.data.zn+'-'+b.data.a).sort().join();
    ok(dz==='2-4,90-234'&&Ch.last.kind==='alpha'&&St.discoveries(stu.id).includes('chem:alpha'),'распад U-238 → Th-234 + He-4');
    ok(zb().every(b=>Ch.slots.includes(b))&&zb().length===2,'продукты распада — в гнёздах склада');
    clr();run(3);L.toggleMode(E,Ch);run(3);ok(Ch.nuclear===false,'режим «Химия»');const h0=Ch.hist.length;
    mk(1,1,L.FV[0]-.06,.95,L.FV[1]);mk(1,1,L.FV[0]+.06,.95,L.FV[1]);run(60);
    ok(Ch.vs[0].items.length===2||zb().length===2,'два протона лежат в сосуде');
    ok(Ch.vs[0].ready===true&&Ch.vs[0].plan.kind==='molecule','H + H в сосуде слияния — молекула H₂, а не ядерное слияние');
    clr();run(3);
    mk(1,1,L.DV[0],.95,L.DV[1]);run(60);
    ok(Ch.vs[1].ready===false&&!press(2)&&zb().length===1&&Ch.hist.length===h0,'кнопка распада водорода не реагирует');
    clr();run(3);
    mk(1,1,L.FV[0],.95,L.FV[1]);run(60);
    ok(Ch.vs[0].ready===false&&!press(0)&&zb().length===1,'кнопка слияния при одном атоме не реагирует');
    clr();run(3);
    /* вода по кнопке: атомы копятся без реакции */
    mk(1,1,L.FV[0],.95,L.FV[1]);run(40);mk(8,16,L.FV[0],.95,L.FV[1]);run(60);
    {const pl=Ch.vs[0].plan;ok(Ch.vs[0].items.length===2&&Ch.last.kind!=='molecule'&&!(pl&&pl.mol&&pl.mol.key==='H2O'),'H + O: сосуд копит атомы, воды ещё нет, реакция сама не пошла');}
    mk(1,1,L.FV[0],.95,L.FV[1]);run(60);
    ok(Ch.vs[0].items.length===3&&Ch.vs[0].plan&&Ch.vs[0].plan.kind==='molecule'&&Ch.vs[0].plan.mol.key==='H2O'&&Ch.last.kind!=='molecule','H + O + H: доступна вода, но сама не образуется');
    ok(press(0)&&Ch.last.kind==='molecule'&&Ch.last.mol.key==='H2O'&&zb().length===0&&Ch.vs[0].items.length===0&&Ch.slots.some(b=>b&&b.data.mol==='H2O'),'H + H + O по кнопке → молекула H2O в гнезде склада (атомы израсходованы)');
    ok(St.discoveries(stu.id).includes('chem:mol_H2O'),'вода записана в открытия');
    /* «Химия»: разложение молекулы в правом сосуде на атомы в склад */
    {const wb=Ch.slots.find(b=>b&&b.data.mol==='H2O');delete wb.data.sp;wb.p=[L.DV[0],.95,L.DV[1]];wb.v=[0,0,0];run(60);
      ok(Ch.vs[1].ready===true&&Ch.vs[1].plan.kind==='decomp'&&Ch.tabs[2].btns[0]&&!Ch.tabs[2].btns[0].disabled,'«Химия»: молекула воды в правом сосуде — табличка «Разложение» горит');
      ok(press(2)&&Ch.last.kind==='decomp'&&zb().map(b=>b.data.zn).sort().join()==='1,1,8'&&zb().every(b=>Ch.slots.includes(b))&&!E.bodies.some(b=>b.data.mol),'H2O → H + H + O: три атома в гнёздах склада, молекула израсходована');
      clr();run(3);mk(8,16,L.DV[0],.95,L.DV[1]);run(60);ok(Ch.vs[1].ready===false&&!press(2),'«Химия»: атом в правом сосуде не раскладывается');clr();run(3);}
    /* режим «Химия»: H + O не даёт ничего; режим «Ядра»: F-17, и его распад */
    mk(1,1,L.FV[0],.95,L.FV[1]);run(40);mk(8,16,L.FV[0],.95,L.FV[1]);run(60);
    ok(Ch.vs[0].ready===false&&!press(0)&&zb().length===2&&/Нет такого вещества/.test(Ch.vs[0].live),'«Химия»: H + O — кнопка тусклая, подсказка «нет такого вещества»');
    ok(L.treeOf(8,16).mols.length>=3&&L.treeOf(8,16).up.length===0,'«Химия»: вверх в дереве — молекулы с кислородом');
    L.toggleMode(E,Ch);run(5);
    ok(Ch.vs[0].ready===true&&Ch.vs[0].plan.kind==='fusion'&&press(0)&&Ch.last.to[0].z===9&&Ch.last.to[0].a===17,'«Ядра»: H + O → F-17 (ядерная реакция)');
    {const f=zb()[0];ok(zb().length===1&&f.data.zn===9&&f.data.a===17,'на столе ровно одно тело F-17');
      f.p=[L.DV[0],.95,L.DV[1]];f.v=[0,0,0];f.data.fresh=false;delete f.data.fresh;run(60);
      ok(Ch.vs[1].ready===true&&press(2)&&zb().length===1&&zb()[0].data.zn===8&&zb()[0].data.a===17&&Ch.last.kind==='beta','F-17 → O-17 + e⁺: на столе ровно одно тело O-17');}
    clr();run(3);
    mk(84,210,L.DV[0],.95,L.DV[1]);run(60);
    ok(press(2)&&zb().map(b=>b.data.zn+'-'+b.data.a).sort().join()==='2-4,82-206','Po-210 → Pb-206 + He-4: на столе ровно эти два тела');
    clr();run(3);mk(6,12,L.DV[0],.95,L.DV[1]);run(60);
    ok(Ch.vs[1].ready===false&&!press(2)&&zb().length===1,'C-12 стабилен: «Распад» тусклый');
    clr();run(3);L.toggleMode(E,Ch);run(3);
    /* сосуд слияния вмещает не больше 6 атомов */
    for(let i=0;i<7;i++){mk(2,4,L.FV[0],.95,L.FV[1]);run(30);}
    ok(Ch.vs[0].items.length===6,'в сосуд слияния помещается 6 атомов, седьмой отскакивает');
    clr();run(3);
    /* дерево элемента */
    {const tc=L.treeOf(6,12,true),sy=a=>a.map(u=>N.el(u.to.z).sym);
      ok(sy(tc.up).includes('O')&&sy(tc.up).includes('N'),'дерево C: +He → O, +H → N');
      const cn=tc.up.find(u=>u.to.z===7);ok(cn&&cn.r.exact&&near(cn.q,1.943,.01)&&tc.up.every(u=>u.r.exact||u.to.a>40),'дерево C: +H → N-13, Q = +1,94 МэВ (точные данные AME2020)');
      ok(tc.down===null&&L.treeOf(6,12).why==='stable','дерево C: вниз «не распадается (стабильно)», принудительного деления нет');
      const tu=L.treeOf(92,238,true);ok(tu.down&&tu.down.kind==='alpha'&&tu.up.length>0,'дерево U-238: альфа-распад и ветки слияния');
      ok(L.treeOf(1,1,true).down===null,'дерево H: распада нет');}
    /* корректность реакций (аудит 27.10.2026): составы молекул, сохранение Z и A, известные Q */
    {const N=VR.nuc,sub={'₀':0,'₁':1,'₂':2,'₃':3,'₄':4,'₅':5,'₆':6,'₇':7,'₈':8,'₉':9};let badMol=[];
      for(const m of VR.DATA.molecules){const comp={},re=/([A-Z][a-z]?)([₀-₉]*)/g;let x;while((x=re.exec(m.formula)))comp[x[1]]=(comp[x[1]]||0)+(x[2]?[...x[2]].reduce((u,c)=>u*10+sub[c],0):1);
        const at={};for(const q of m.atoms)at[q[0]]=(at[q[0]]||0)+1,
        same=(u,v)=>Object.keys(u).length===Object.keys(v).length&&Object.keys(u).every(k=>u[k]===v[k]);
        if(!same(comp,m.f)||!same(at,m.f))badMol.push(m.key);}
      ok(badMol.length===0,'молекулы: формула, состав и число атомов в модели совпадают ('+badMol+')');
      let bad=[];for(let z=1;z<=118;z++){const e=N.el(z),r=N.decayOf(z,e.a);if(!r.ok)continue;
        const zs=r.to.reduce((u,x)=>u+x.z,0),as=r.to.reduce((u,x)=>u+x.a,0),zl=r.kind==='beta'?r.lz:0;
        const A0=e.a+(r.kind==='fission'?1:0);if(zs+zl!==z||as+(r.n||0)!==A0&&!(r.kind==='fission'&&as+(r.n||0)===e.a))bad.push(z+'-'+e.a+' '+r.kind);}
      ok(bad.length===0,'распады всех 118 элементов сохраняют Z и A ('+bad+')');
      const q=(z,a)=>N.decayOf(z,a).q,near=(v,w,e)=>Math.abs(v-w)<e;
      ok(near(q(88,226),4.871,.01)&&near(q(84,210),5.407,.01)&&near(q(92,238),4.27,.01),'альфа-распад: Ra-226 4,87; Po-210 5,41; U-238 4,27 МэВ — по справочникам, не по формуле');
      const dt=N.fuse({z:1,a:2},{z:1,a:3}),he=N.fuse({z:2,a:3},{z:2,a:3});
      ok(dt.ok&&dt.n===1&&dt.to[0].z===2&&dt.to[0].a===4&&near(dt.q,17.59,.01),'D + T → He-4 + n, 17,59 МэВ');
      ok(he.ok&&he.to.length===3&&he.to.reduce((u,x)=>u+x.a,0)===6&&near(he.q,12.86,.01),'He-3 + He-3 → He-4 + 2p, 12,86 МэВ');
      ok(near(N.fuse({z:6,a:12},{z:2,a:4}).q,7.162,.005),'C-12 + He-4 → O-16, 7,16 МэВ');}
    Ch.nuclear=true;Ch.cur=null;L.setCur(Ch,92,238);run(3);E.paintPanel(Ch.tree);
    ok(Ch.tree.btns.length>=4&&Ch.tree.btns.some(b=>b.z===92)&&Ch.tree.btns.length===6,'дерево Fe нарисовано: области наведения есть (3 слияния, центр, 2 осколка); рамки за краем проверяет e2e_chem');
    {const i=Ch.tree.btns.findIndex(b=>b.z===93),hb=Ch.tree.btns[i];Ch.cardZ=0;Ch.tree.hover=i;L.update(E,Ch,.016);ok(Ch.tip===undefined&&Ch.cur.z===92&&Ch.cardZ===0,'наведение на узел дерева только подсвечивает: справочной панели слева нет, выбор не меняется');hb.fn(E.H[1]);L.update(E,Ch,.016);ok(Ch.cur.z===93&&Ch.cardZ===93&&Ch.el===92&&Ch.card.show,'курок на узле дерева выбирает элемент: центр дерева, ячейка в таблице и планшет (справка только там)');Ch.tree.hover=-1;L.update(E,Ch,.016);}
    Ch.nuclear=false;
    /* карточка в VR: на тыльной стороне левой руки, параллельно плоскости запястья */
    {const M=VR.M,g=M.mul(M.trans(1,1.2,-1),M.mul(M.rotY(.7),M.rotX(.3))),m=L.cardModel(g),nrm=(a,b,c)=>{const l=Math.hypot(a,b,c);return[a/l,b/l,c/l];},dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
      const n=nrm(m[8],m[9],m[10]),up=nrm(m[4],m[5],m[6]),hy=nrm(g[4],g[5],g[6]),hz=nrm(g[8],g[9],g[10]);
      ok(dot(n,hy)>.999,'карточка в VR: нормаль вдоль «вверх» ладонной системы руки (тыльная сторона кисти)');
      ok(dot(up,[-hz[0],-hz[1],-hz[2]])>.999,'карточка в VR: верх карточки — к пальцам');
      ok(Math.hypot(m[12]-g[12],m[13]-g[13],m[14]-g[14])<.12,'карточка в VR: центр у кисти');}
    /* карточка: X / I */
    {const was=Ch.cardOff;VR.ROOMS.chem.onX(E,Ch);ok(Ch.cardOff===!was,'X/I переключает карточку');VR.ROOMS.chem.onX(E,Ch);ok(Ch.cardOff===was,'повторное нажатие возвращает');}
    clr();
    /* склад: гнёзда не заходят друг на друга */
    {let mn=9;const pos=[];for(let i=0;i<20;i++)pos.push([L.SLOTX[i%5],L.SLOTZ[(i/5)|0]]);
      for(let i=0;i<20;i++)for(let j=i+1;j<20;j++)mn=Math.min(mn,Math.hypot(pos[i][0]-pos[j][0],pos[i][1]-pos[j][1]));
      ok(mn>=2*L.SLOTR+.025,'склад: расстояние между центрами гнёзд '+mn.toFixed(3)+' ≥ 2r + зазор');
      const vr=.3+.02;ok(pos.every(q=>[L.FV,L.DV].every(v=>Math.hypot(q[0]-v[0],q[1]-v[1])>vr+L.SLOTR)),'склад: гнёзда не заходят на сосуды');
      ok(pos.every(q=>q[1]-L.SLOTR>L.STAND.z-L.STAND.hz&&q[1]+L.SLOTR<-2.05),'склад: гнёзда в пределах стола и не под табличками');}
    /* склад */
    for(let i=0;i<20;i++)mk(6,12,L.SLOTX[i%5]+(i%2?.03:-.03),.95,L.SLOTZ[(i/5)|0]);
    run(10);ok(Ch.slots.filter(Boolean).length===20,'склад: занято 20 гнёзд');
    const x21=mk(6,12,0,.95,-2.4);run(1);
    ok(x21.data.fresh===true&&x21.v[2]>1&&Ch.slots.filter(Boolean).length===20,'склад: 21-й элемент получил скорость к игроку');
    clr();run(3);
    /* склад полон: результат реакции скатывается и растворяется */
    for(let i=0;i<20;i++)mk(6,12,L.SLOTX[i%5],.95,L.SLOTZ[(i/5)|0]);run(10);
    mk(1,1,L.FV[0]-.06,.95,L.FV[1]);mk(1,1,L.FV[0]+.06,.95,L.FV[1]);run(60);
    ok(press(0)&&E.bodies.some(b=>b.data.mol==='H2'&&b.data.fresh&&!Ch.slots.includes(b)),'склад полон: молекула H2 не легла в склад');
    run(300);ok(!E.bodies.some(b=>b.data.mol),'лишний результат скатился и растворился на полу');
    clr();run(3);
    /* пол растворяет */
    const fl=mk(8,16,2,.05,2);run(60);ok(!E.bodies.includes(fl),'тело на полу растворилось');
    const fl2=mk(8,16,2,.05,2);run(12);const s0=fl2.data.s0;ok(fl2.data.die!==undefined&&fl2.s<s0,'растворение началось');VR.ROOMS.chem.onGrab(E,Ch,fl2);
    ok(fl2.data.die===undefined&&fl2.s===s0&&E.bodies.includes(fl2),'растворение отменяется, если тело взяли');
    clr();
    /* лимит тел и атомы реактора */
    for(let i=0;i<L.MAXN;i++)mk(6,12,2,3+i*.01,2);
    ok(VR.ROOMS.chem.pick(E,Ch,E.H[1],{t:2,kind:'panel',p:Ch.pt,bi:25})===null&&zb().length===L.MAXN,'pick: 31-й элемент не создаётся');
    clr();
    /* геометрия: без перекрытий, по осям */
    {const tb=E.tables,sp=VR.ROOMS.chem.spawn;let ov=0;
      for(let i=0;i<tb.length;i++)for(let j=i+1;j<tb.length;j++)if(Math.abs(tb[i].x-tb[j].x)<tb[i].hx+tb[j].hx&&Math.abs(tb[i].z-tb[j].z)<tb[i].hz+tb[j].hz)ov++;
      ok(ov===0,'геометрия: столы не пересекаются');
      const seg=p=>{const c=Math.cos(p.yaw),s=Math.sin(p.yaw);return[[p.pos[0]-c*p.w/2,p.pos[2]+s*p.w/2],[p.pos[0]+c*p.w/2,p.pos[2]-s*p.w/2]];};
      const hits=(a,b,t)=>{let any=false;for(let k=0;k<=20;k++){const x=a[0]+(b[0]-a[0])*k/20,z=a[1]+(b[1]-a[1])*k/20;if(Math.abs(x-t.x)<t.hx&&Math.abs(z-t.z)<t.hz)any=true;}return any;};
      const bad=E.panels.filter(p=>!(p.data&&p.data.reset)&&!p.tilt&&p.pos[1]-p.h/2<2.5&&tb.some(t=>{const sg=seg(p);return hits(sg[0],sg[1],t);}));
      ok(bad.length===0,'геометрия: панели не пересекают столы ('+bad.length+')');
      const ax=p=>Math.abs(Math.sin(2*p.yaw))<1e-9,own=[Ch.pt,Ch.board,Ch.tree,Ch.modeTab].concat(Ch.tabs);
      ok(own.every(ax),'геометрия: таблица, таблички и доски стоят по осям (yaw кратен 90°)');
      ok(own.every(p=>{const n=[Math.sin(p.yaw),Math.cos(p.yaw)],d=[sp.x-p.pos[0],sp.z-p.pos[2]],l=Math.hypot(d[0],d[1]);return(n[0]*d[0]+n[1]*d[1])/l>.7;}),'геометрия: передняя сторона панелей стенда смотрит в сторону точки появления');
      {const row=Ch.tabs.concat([Ch.modeTab]).sort((u,v)=>u.pos[0]-v.pos[0]);let gap=9;for(let i=1;i<row.length;i++)gap=Math.min(gap,(row[i].pos[0]-row[i].w/2)-(row[i-1].pos[0]+row[i-1].w/2));ok(gap>=.03&&Math.abs(Ch.modeTab.tilt-Math.PI/4)<1e-9,'геометрия: таблички на кромке не перекрываются (зазор '+gap.toFixed(2)+' м), режим наклонён на 45°');}
      ok(!tb.some(t=>Math.abs(sp.x-t.x)<t.hx+.4&&Math.abs(sp.z-t.z)<t.hz+.4),'геометрия: точка появления вне столов (+0,4 м)');
      const rb=E.panels.filter(p=>p.data&&p.data.reset);
      ok(rb.length>=1&&rb.every(p=>Math.abs(Math.sin(2*p.yaw))<1e-9)&&rb.some(p=>Math.abs(p.pos[0]-1.38)<.01),'геометрия: кнопка сброса на столе стенда по оси стола');
      const bx=[Ch.board.pos[0]],t0=tb[0];ok(Math.abs(t0.x)<1e-9&&Math.abs(t0.z+2.4)<1e-9&&bx[0]-.0>t0.x+t0.hx+.5,'геометрия: стол стенда первый, доска правее него');}
    /* флаг выключен — прежняя комната */
  }
  {/* движок: keepTex и labelTex (Б65, шаг 27) */
    let nk=0,nn=0;
    const pk=E.addPanel({w:.5,h:.5,res:64,pos:[0,1.5,-3],keepTex:true,draw:()=>{nk++;}}),pn=E.addPanel({w:.5,h:.5,res:64,pos:[0,1.5,-3.1],draw:()=>{nn++;}});
    run(3);const k0=nk,n0=nn;pk.hover=3;pn.hover=3;run(3);
    ok(nk===k0&&nn>n0,'движок: панель keepTex не перерисовывается при наведении, обычная — перерисовывается');
    let lf=0;const f=()=>{lf++;};const t1=E.labelTex('t-a',f),t2=E.labelTex('t-a',f);
    ok(t1===t2&&lf===1,'движок: labelTex кэширует текстуру');
    pk.show=false;pn.show=false;
  }

  // ---- химия: дерево комнат (Б65-Д, шаг 33)
  {
    const T0=E.student,setG=g=>{E.student=Object.assign({},T0,{grade:g});};
    const ids=()=>E.staticTargets.map(t=>t.id).filter(i=>/^door-/.test(i));
    const go=id=>{E.goRoom(id);run(8);};
    const has=i=>ids().indexOf(i)>=0;
    setG(6);go('hall');
    ok(VR.entryOf('chem')==='chem-hub'&&VR.entryOf('math')==='math'&&has('door-chem-hub')&&!has('door-chem'),'дерево: дверь холла «Химия» ведёт в узел');
    {const w=E.panels.find(p=>p.btns.length===9),i=VR.openRooms(6).indexOf('chem');w.btns[i].fn();run(4);ok(E.roomId==='chem-hub','дерево: кнопка «Химия» на панели холла ведёт в узел');}
    VR.flags.set('chemTree',false);go('hall');
    ok(VR.entryOf('chem')==='chem'&&has('door-chem')&&!has('door-chem-hub'),'дерево: флаг chemTree выключен — дверь холла ведёт в химию');
    go('chem');ok(has('door-hall')&&!has('door-chem-hub'),'дерево: флаг выключен — из химии дверь назад в холл');
    VR.flags.set('chemTree',true);go('chem');
    ok(has('door-chem-hub')&&!has('door-hall'),'дерево: универсальный стенд — дверь назад в узел, не в холл');
    setG(5);go('chem-hub');
    ok(ids().sort().join()==='door-chem,door-hall'&&E.S.guest===true,'дерево: гость (5 класс) видит в узле только универсальный стенд и холл');
    setG(9);go('chem-hub');
    {const want=['door-chem','door-chem-acid','door-chem-inorg','door-chem-ion','door-chem-nuc','door-chem-org','door-hall'];
      ok(ids().sort().join()===want.join()&&E.S.doors===6,'дерево: 9 класс — шесть дверей разделов и холл');}
    run(6);
    {const ov=[];E.panels.forEach(p=>{E.paintPanel(p);if(p.over&&p.over.length)ov.push(p.W+'x'+p.H+':'+p.over.join('|'));});ok(ov.length===0,'дерево: панели узла нарисованы без выхода за край'+(ov.length?' — '+ov.join('; '):''));}
    {const fr=E.panels.filter(p=>Math.abs(p.yaw)<1e-9&&p.pos[2]<-5.5).sort((a,b)=>a.pos[0]-b.pos[0]);let gap=9;
      for(let i=1;i<fr.length;i++)gap=Math.min(gap,(fr[i].pos[0]-fr[i].w/2)-(fr[i-1].pos[0]+fr[i-1].w/2));
      ok(fr.length>=2&&gap>=.03,'дерево: карта и тест на передней стене не перекрываются (зазор '+gap.toFixed(2)+' м)');}
    {const dz=E.staticTargets.filter(t=>/^door-chem/.test(t.id)&&t.id!=='door-chem-hub').map(t=>[t.c[0]<0?'L':'R',t.c[2]]);
      let clash=0;for(let i=0;i<dz.length;i++)for(let j=i+1;j<dz.length;j++)if(dz[i][0]===dz[j][0]&&Math.abs(dz[i][1]-dz[j][1])<1.5)clash++;
      ok(clash===0,'дерево: двери узла не перекрываются');}
    VR.Store.setBands('pack','chem-org','');go('chem-hub');
    ok(!has('door-chem-org')&&has('door-chem-ion'),'дерево: учитель выключил блок «Органика» — двери органики нет');
    VR.Store.setBands('pack','chem-org','d');
    VR.Store.setBands('room','chem','ab');go('hall');
    ok(!has('door-chem-hub')&&!has('door-chem'),'дерево: комната «Химия» выключена для 9 класса — двери в холле нет');
    VR.Store.setBands('room','chem','abcd');
    go('chem-nuc');
    ok(E.S.nuclear===true&&has('door-chem-hub')&&!has('door-hall'),'дерево: ядерная физика — стенд в режиме «Ядра» и дверь в узел');
    for(const id of['chem-ion','chem-acid','chem-inorg','chem-org']){
      go(id);
      ok(has('door-chem-hub')&&!has('door-hall')&&E.tables.length===1&&E.S.stand===null&&E.panels.some(p=>p.pos[2]<-5.5)&&E.roomId===id,'дерево: '+id+' — заглушка: стол, табличка и дверь в узел');
    }
    VR.STANDS['chem-ion']={build(){throw new Error('сбой');}};go('chem-ion');
    ok(E.S.stand===null&&E.tables.length===1&&has('door-chem-hub'),'дерево: сбой стенда не ломает комнату (стол и дверь остаются)');
    VR.STANDS['chem-ion']={build(E2,S2,o){S2.o=o;E2.addTable(o.x,o.z,1.6,.45,.85);},update(E2,S2,dt){S2.t=(S2.t||0)+dt;}};go('chem-ion');run(5);
    ok(E.S.stand===VR.STANDS['chem-ion']&&E.S.o.x===0&&E.S.o.z===-2.4&&E.S.t>0,'дерево: стенд раздела строится вокруг стола {x:0,z:-2.4} и получает update');
    delete VR.STANDS['chem-ion'];
    E.student=T0;go('hall');
  }

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
  { /* шахматы: правила (perft), ИИ, комната «Игровая» */
    const C=VR.chess,pf=(f,d)=>C.perft(C.fromFEN(f),d);
    ok(pf(C.START,3)===8902&&pf(C.START,4)===197281,'шахматы: perft старта 8902 / 197281');
    ok(pf('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',3)===97862,'шахматы: perft Kiwipete (рокировка, взятие на проходе, шахи) 97862');
    ok(pf('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',4)===43238,'шахматы: perft позиции 3 (шпилька) 43238');
    ok(pf('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',3)===62379,'шахматы: perft позиции 5 (превращения) 62379');
    { const fx=JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','chess_perft.json'),'utf8')); let allOk=true;
      for(const ps of fx.positions){const q=C.fromFEN(ps.fen);ps.perft.forEach((v,i)=>{if(C.perft(q,i+1)!==v)allOk=false;});}
      ok(allOk,'шахматы: общий набор perft (tests/fixtures/chess_perft.json — тот же проверяет server/chess.py)'); }
    const mt=C.think(C.fromFEN('6k1/5ppp/8/8/8/8/8/3RK3 w - - 0 1'),2);
    ok(mt&&C.sqName(mt.m.f)+C.sqName(mt.m.t)==='d1d8','шахматы: ИИ находит мат в один ход');
    const hq=C.think(C.fromFEN('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1'),2);
    ok(hq&&hq.m.t===35,'шахматы: ИИ берёт зевнутого ферзя');
  }
  E.goRoom('play');run(25);
  { const C=VR.chess,Pl=E.S,tg=id=>E.targets.find(t=>t.id===id),bt=i=>Pl.panel.btns[i],cb=i=>Pl.cpanel.btns[i];
    ok(Pl.pos&&Pl.pos.t===1&&Pl.moves.length===20&&E.targets.filter(t=>/^c\d+$/.test(t.id)).length===64,'игровая: доска, 64 клетки, 20 ходов');
    tg('c12').sel({});ok(Pl.sel===12&&Pl.dests.length===2,'игровая: выбор пешки e2 показывает 2 хода');
    tg('c28').sel({});run(150);
    ok(Pl.hist.length===2&&Pl.pos.t===1,'игровая: ход e2–e4 и ответ компьютера');
    ok(Pl.cpanel.show===false,'игровая: панель настроек скрыта по умолчанию');
    Pl.panel.dirty=true;run(3);Pl.panel.btns[Pl.panel.btns.length-1].fn();ok(Pl.cpanel.show===true,'игровая: кнопка показывает панель настроек');
    Pl.cpanel.dirty=true;run(3);cb(7).fn();
    ok(Pl.hist.length===0&&C.toFEN(Pl.pos)===C.START,'игровая: «Отменить ход» возвращает начало');
    tg('c20').sel({});ok(Pl.sel===-1,'игровая: клик по пустой клетке без выбора ничего не делает');
    Pl.pos=C.fromFEN('8/P6k/8/8/8/8/8/K7 w - - 0 1');Pl.moves=C.legal(Pl.pos);
    tg('c48').sel({});tg('c56').sel({});ok(!!Pl.promo,'игровая: ход пешки на последнюю горизонталь спрашивает фигуру');
    Pl.panel.dirty=true;run(3);bt(0).fn();
    ok(!Pl.promo&&Pl.pos.b[56]===C.Q&&Pl.hist.length===1,'игровая: превращение в ферзя');
    run(5);Pl.cpanel.dirty=true;run(3);cb(5).fn();run(150);
    Pl.panel.dirty=true;run(3);Pl.panel.btns[Pl.panel.btns.length-1].fn();ok(Pl.cpanel.show===false,'игровая: та же кнопка скрывает панель настроек');
    ok(Pl.me===-1&&Pl.flip&&Pl.hist.length===1&&Pl.pos.t===-1,'игровая: за чёрных доска повёрнута, белые (компьютер) ходят первыми');
  }
  { /* Эйнштейн: логика и комната */
    const X=VR.einstein;let bad=0,rules=0;
    for(let s=1;s<=25;s++){const pz=X.generate(s),g=X.newGame(pz);
      for(let ch=true;ch;){ch=false;for(const r of pz.rules)if(X.applyRule(r,g.P))ch=true;}
      if(!g.P.solved()||!g.P.valid(pz.sol))bad++;rules+=pz.rules.length;}
    ok(bad===0&&rules>25*12,'эйнштейн: 25 головоломок решаются одними подсказками, решение верное (подсказок в среднем '+(rules/25).toFixed(1)+')');
    const a=X.generate(7),b=X.generate(7);
    ok(JSON.stringify(a.sol)===JSON.stringify(b.sol)&&JSON.stringify(a.rules)===JSON.stringify(b.rules),'эйнштейн: один и тот же сид — одна и та же головоломка (для соревнований)');
    const sol=a.sol.map(r=>r.slice());ok(sol.every(r=>r.slice().sort().join('')==='123456'),'эйнштейн: в каждой строке по 6 разных фишек');
    const g=X.newGame(a);let c0=-1,r0=-1;for(let r=0;r<6&&c0<0;r++)for(let c=0;c<6;c++)if(!g.P.defined(c,r)){c0=c;r0=r;break;}
    const wrong=[1,2,3,4,5,6].find(e=>e!==a.sol[r0][c0]&&g.P.can(c0,r0,e));
    ok(X.click(g,c0,r0,wrong,1)==='fail'&&g.status==='lose','эйнштейн: выбор неверной фишки — проигрыш');
    const g2=X.newGame(a);ok(X.click(g2,c0,r0,a.sol[r0][c0],3)==='fail','эйнштейн: исключение верной фишки — проигрыш');
    const g3=X.newGame(a);let last='';for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!g3.P.defined(c,r)&&g3.status==='play')last=X.click(g3,c,r,a.sol[r][c],1);
    ok(g3.status==='win'&&last==='win','эйнштейн: верные ходы ведут к победе');
  }
  E.goRoom('ein');run(25);
  { const Z=E.S,X=VR.einstein;
    ok(Z.g&&Z.g.status==='play'&&Z.field&&Z.hints&&Z.ctl,'эйнштейн-комната: три панели и партия');
    Z.field.dirty=true;Z.hints.dirty=true;Z.ctl.dirty=true;run(4);
    ok(Z.field.btns.length>=100&&Z.hints.btns.length>=15,'эйнштейн-комната: у поля и подсказок есть области нажатия ('+Z.field.btns.length+' / '+Z.hints.btns.length+')');
    ok(!Z.field.over.length&&!Z.hints.over.length&&!Z.ctl.over.length,'эйнштейн-комната: ничего не за краем панели');
    const g=Z.g,sol=g.pz.sol;let done=false;
    Z.mode='pick';let tries=0;
    while(g.status==='play'&&tries++<40){let hit=false;for(let r=0;r<6&&!hit;r++)for(let c=0;c<6&&!hit;c++)if(!g.P.defined(c,r)){Z.field.dirty=true;run(3);
      /* найти область нужной фишки: перебор областей клетки (c,r) */
      const x0=100+c*316,y0=24+r*232,e=sol[r][c],k=e-1,want=[x0+8+(k%3)*100,y0+16+((k/3)|0)*104];
      const bi=Z.field.btns.findIndex(b=>b.x===want[0]&&b.y===want[1]);if(bi>=0){Z.field.btns[bi].fn({});hit=true;}}
      if(!hit)break;}
    ok(g.status==='win'&&Z.ctl.dirty!==undefined,'эйнштейн-комната: клики по областям фишек решают головоломку ('+g.status+')');
  }
  { /* протокол поз: те же байты, что у server/netproto.py (tests/net_proto.py) */
    const NP=VR.netproto,fx=JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','net_frames.json'),'utf8')),hx=b=>Buffer.from(b).toString('hex'),fromHex=h=>{const b=Buffer.from(h,'hex');return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);};
    ok(fx.poses.every(c=>hx(NP.encodePose(c.input))===c.hex),'протокол: '+fx.poses.length+' эталонных кадров поз кодируются теми же байтами, что на сервере');
    ok(fx.poses.every(c=>hx(NP.encodePose(NP.decodePose(fromHex(c.hex))))===c.hex),'протокол: разбор и повторная сборка кадров стабильны');
    ok(hx(NP.encodeBatch(fx.batch.input))===fx.batch.hex&&NP.decodeBatch(fromHex(fx.batch.hex)).items.length===3,'протокол: пачка из 3 записей совпадает с серверной');
    const d0=NP.decodePose(fromHex(fx.poses[0].hex));ok(Math.abs(d0.head.p[0]-1.234)<6e-4&&d0.seq===7&&d0.t===123456,'протокол: значения позы с точностью до мм');
    ok(NP.decodePose(fromHex(fx.poses[0].hex.slice(0,100)))===null&&NP.decodeBatch(fromHex(fx.batch.hex.slice(0,-2)))===null&&NP.decodePose(new ArrayBuffer(52))===null,'протокол: плохие кадры (длина, версия, тип) отвергаются');
    const dn=NP.decodePose(fromHex(fx.poses[3].hex));ok(dn.head.p.every(v=>v===0)&&dn.head.q[3]===1,'протокол: NaN и нулевой кватернион безопасны');
  }
  { /* журнал игр, статистика, турниры, комната «Турниры» */
    const G=VR.games,T=G.tour,prevStu=E.student;G._reset();
    const bad=G.clean({games:[{id:'x',game:'chess',res:'win',sid:'a',name:'Ы'.repeat(99),t:-5},{id:'y',game:'nope',res:'win'},null,{game:'chess'}],tours:[{id:'t',game:'einstein',rounds:'xx'},{game:'x'}]});
    ok(bad.games.length===1&&bad.games[0].name.length===40&&bad.games[0].t===0&&bad.tours.length===1,'игры: проверка данных отбрасывает мусор и режет длину');
    const A={student:{id:'s1',name:'Аня',grade:6}},B={student:{id:'s2',name:'Боря',grade:6}},Gst={student:{id:null,name:'Гость',grade:5}};
    ok(G.finish(Gst,'einstein',{time:50})===null&&G.load().games.length===0,'игры: гостю результат не пишется');
    G.finish(A,'einstein',{time:300,seed:1,moves:40});G.finish(A,'einstein',{time:200,seed:2,moves:30});G.finish(A,'einstein',{time:100,helped:true,seed:3});G.finish(B,'einstein',{time:250,seed:4});G.finish(B,'einstein',{res:'lose',seed:5});
    G.finish(A,'chess',{res:'win',lvl:2,moves:30});G.finish(B,'chess',{res:'draw',lvl:1});G.finish(B,'chess',{res:'lose',lvl:3});
    const st=G.stats('s1');
    ok(st.einstein.best===200&&st.einstein.wins===3&&st.einstein.played===3&&st.einstein.avg===250&&st.chess.byLvl[2]===1,'игры: статистика ученика (лучшее без помощи 200, помощь не в зачёт)');
    const te=G.top('einstein',5);ok(te.length===2&&te[0].sid==='s1'&&te[0].best===200&&te[1].best===250,'игры: лучшие по «Эйнштейну» по времени');
    ok(G.top('chess',5)[0].sid==='s1'&&G.history(3).length===3&&G.history(3)[0].game==='chess','игры: лучшие в шахматах и история (новые сверху)');
    const m1=G.merge(G.load(),G.load());ok(m1.games.length===G.load().games.length,'игры: слияние с самим собой ничего не дублирует');
    /* турнир на 5 игроков: размер 8, три «пропуска» */
    const t=T.create('einstein','Тест','s1');['p1','p2','p3','p4','p5'].forEach((id,i)=>T.signup(t.id,id,'И'+i));
    ok(T.start(t.id)&&T.get(t.id).rounds.length===3&&T.get(t.id).rounds[0].filter(m=>m.bye).length===3&&T.progress(T.get(t.id)).all===4,'турнир: 5 игроков → сетка на 8, три пропуска, 4 игровых матча');
    ok(!T.signup(t.id,'p9','Z'),'турнир: после старта запись закрыта');
    const tm=id=>({p1:60,p2:70,p3:80,p4:90,p5:100}[id]);
    for(let guard=0;guard<30&&T.get(t.id).state==='run';guard++)for(const id of['p1','p2','p3','p4','p5']){const nx=T.next(t.id,id);if(nx)T.reportEinstein(t.id,nx.r,nx.i,id,{t:tm(id),moves:20});}
    const done=T.get(t.id);ok(done.state==='done'&&done.champ==='p1','турнир: побеждает самый быстрый (p1), сетка доиграна');
    /* ничья по времени — переигровка; ошибка у обоих — переигровка; ошибка у одного — проигрыш */
    const t2=T.create('einstein','','s1');T.signup(t2.id,'a','A');T.signup(t2.id,'b','B');T.start(t2.id);
    let nx=T.next(t2.id,'a');T.reportEinstein(t2.id,nx.r,nx.i,'a',{t:50,moves:10});T.reportEinstein(t2.id,nx.r,nx.i,'b',{t:50,moves:10});
    ok(T.get(t2.id).state==='run'&&T.get(t2.id).rounds[0][0].rep===1&&T.next(t2.id,'a'),'турнир: ровная ничья по времени — переигровка (новый сид)');
    nx=T.next(t2.id,'a');T.reportEinstein(t2.id,nx.r,nx.i,'a',{t:null});T.reportEinstein(t2.id,nx.r,nx.i,'b',{t:300,moves:5});
    ok(T.get(t2.id).champ==='b','турнир: ошибка у одного — победа соперника');
    const t3=T.create('chess','','s1');T.signup(t3.id,'x','X');T.signup(t3.id,'y','Y');T.start(t3.id);
    T.reportDuel(t3.id,0,0,'draw');const mm=T.get(t3.id).rounds[0][0];ok(mm.sw===true&&!mm.w,'турнир: ничья в шахматах — переигровка с обменом цветов');
    T.reportDuel(t3.id,0,0,'a');ok(T.get(t3.id).champ===mm.a,'турнир: победа в шахматах двигает сетку');
    ok(G.top('tours',3)[0].won>=1,'игры: лучшие по турнирам');
    ok(T.cancel(t3.id)&&!T.get(t3.id),'турнир: отмена удаляет турнир');
    /* комната «Турниры» */
    const t4=T.create('einstein','Класс','s1');T.signup(t4.id,'s1','Аня');T.signup(t4.id,'s2','Боря');
    E.student={id:'s1',name:'Аня',grade:6};
    E.goRoom('arena');run(25);const Ar=E.S;Ar.tid=t4.id;
    for(const p of[Ar.dash,Ar.brk,Ar.ctl]){p.dirty=true;}run(4);
    ok(!Ar.dash.over.length&&!Ar.brk.over.length&&!Ar.ctl.over.length,'арена: ничего не за краем панелей (запись)');
    ok(Ar.dash.btns.length===5,'арена: пять вкладок доски лучших');
    for(let i=0;i<5;i++){Ar.dash.btns[i].fn();run(3);}
    ok(!Ar.dash.over.length,'арена: все вкладки доски влезают');
    T.start(t4.id);Ar.brk.dirty=Ar.ctl.dirty=true;run(4);
    ok(!Ar.brk.over.length&&!Ar.ctl.over.length,'арена: сетка и управление в ходе турнира');
    const play=Ar.ctl.btns.find(b=>!b.disabled&&b.w>1000&&b.y<Ar.ctl.H-260);
    ok(!!play,'арена: у участника есть кнопка «Играть»');
    play.fn();run(20);
    ok(E.S.tid===t4.id&&E.S.mid==='0.0'&&E.S.g&&E.S.g.pz.seed===G.matchSeed(T.get(t4.id),0,0),'арена: «Играть» открывает турнирную головоломку с сидом матча');
    const sol=E.S.g.pz.sol;E.S.mode='pick';
    for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(!E.S.g.P.defined(c,r)&&E.S.g.status==='play'){E.S.field.dirty=true;run(3);const x0=100+c*316,y0=24+r*232,k=sol[r][c]-1;const bi=E.S.field.btns.findIndex(b=>b.x===x0+8+(k%3)*100&&b.y===y0+16+((k/3)|0)*104);if(bi>=0)E.S.field.btns[bi].fn({});}
    const rm=T.get(t4.id).rounds[0][0];
    ok(E.S.g.status==='win'&&(rm.ra||rm.rb),'арена: победа в турнирной партии записана в матч');
    E.student=prevStu;G._reset();
  }
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
  { /* лазерная указка учителя */
    const Lk=XE.laser;
    R.gp.buttons[3].pressed=true;frames(1);R.gp.buttons[3].pressed=false;frames(2);
    ok(!XE.laser.on&&!XE.laserState().on,'указка: нажатие стика у не-учителя ничего не включает');
    ok(XE.toggleLaser()===false&&!XE.laser.on,'указка: меню не включает её не-учителю');
    XE.hooks.isTeacher=()=>true;
    R.gp.buttons[3].pressed=true;frames(1);R.gp.buttons[3].pressed=false;frames(2);
    const st=XE.laserState();
    ok(XE.laser.on&&XE.laser.hi===1&&st.on&&st.o.length===3&&st.d.length===3,'указка: стик правой руки включает луч (начало и направление для сети)');
    const dr0=X.calls.draw;frames(3);ok(X.calls.draw>dr0,'указка: кадры с лучом рисуются');
    R.gp.buttons[3].pressed=true;frames(1);R.gp.buttons[3].pressed=false;frames(2);
    ok(!XE.laser.on,'указка: повторное нажатие выключает');
    ok(XE.toggleLaser(true)===true&&XE.laser.on&&XE.toggleLaser()===true&&!XE.laser.on,'указка: переключение из меню для учителя');
    const n0=XE.LASER_COLORS.length,c0=XE.laser.ci;XE.nextLaserColor();ok(XE.laser.ci===(c0+1)%n0&&n0===7&&XE.LASER_COLORS[n0-1].rainbow,'указка: цвета переключаются по кругу, последний — радуга');
    XE.setLaserColor(n0-1);XE.toggleLaser(true,1);const dr1=X.calls.draw;frames(4);ok(X.calls.draw>dr1&&XE.laserState().ci===n0-1,'указка: радужный луч рисуется, цвет уходит в состояние для сети');XE.toggleLaser(false);
    const hs=XE.hsv(0,1,1),hg=XE.hsv(1/3,1,1);ok(hs[0]===1&&hs[1]===0&&hg[1]===1&&hg[0]===0,'указка: перевод оттенка в цвет (красный и зелёный)');
    XE.setLaserColor(0);
    XE.menu.dirty=true;XE.toggleMenu(true);frames(3);ok(!XE.menu.over.length,'указка: меню с кнопкой «Указка» влезает');XE.toggleMenu(false);frames(1);
    XE.hooks.isTeacher=()=>false;
  }
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
  /* ---------- рука в шлеме: предмет вдоль указки, вращение стиком, запреты (очередь Айрата 27.10, п. 2–6) ---------- */
  {
    const M=XV.M,Hn=XE.H[1],ray=(th)=>{const c=Math.cos(th),s=Math.sin(th),m=X.mat(0,1.3,0);m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;};
    const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];};
    XE.loadRoom('chem');frames(3);
    /* запретные зоны телепорта: за столом и под ним нельзя, перед столом можно; в другой комнате зоны сбрасываются */
    ok(!XE.tpOk(0,-4,.4)&&!XE.tpOk(3.5,-3.6,.4)&&!XE.tpOk(0,-2.4,.4)&&!XE.tpOk(1.5,-2.2,.4)&&XE.tpOk(0,-1,.4)&&XE.tpOk(3,0,.4),'телепорт: за столом и под столом нельзя, перед столом и сбоку можно');
    /* таймер и планшет на левой руке не перекрываются; без смещения перекрывались бы */
    {const quad=(m)=>{const out=[];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const u=i/8-.5,v=j/8-.5;out.push([m[0]*u+m[4]*v+m[12],m[1]*u+m[5]*v+m[13],m[2]*u+m[6]*v+m[14]]);}return out;};
      const hudM=ao=>M.mul(M.trans(ao[0],ao[1],ao[2]),M.mul(M.rotX(-Math.PI/4),M.scale(XE.hud.w,XE.hud.h,1))),card=quad(XV.chemLab.cardModel(M.id()));
      const gap=ao=>{let d=1e9;for(const a of quad(hudM(ao)))for(const b of card)d=Math.min(d,Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]));return d;};
      ok(Array.isArray(XE.hud.attachOff)&&gap(XE.hud.attachOff)>.03&&gap([0,.045,.06])<.01,'таймер и планшет элементов на левой руке не перекрываются (зазор '+gap(XE.hud.attachOff).toFixed(3)+' м; со старым положением — пересечение)');}
    /* цвета маркера и пунктира дуги различаются (и для «можно», и для «нельзя») */
    {const dd=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);ok(dd(XE.tpCol.disc[0],XE.tpCol.arc[0])>.5&&dd(XE.tpCol.disc[1],XE.tpCol.arc[1])>.5,'дуга телепорта: цвет точки и пунктира разные');}
    /* предмет в руке: «дальше/ближе» вдоль указки (она наклонена на 35° от оси ручки), а не вдоль ручки */
    const th=.61,R=X.hands.right;R.g=X.mat(0,1.3,0);R.r=ray(th);R.gp.axes[2]=0;R.gp.axes[3]=0;frames(2);
    const fwd=norm([-R.r[8],-R.r[9],-R.r[10]]),gz=norm([-R.g[8],-R.g[9],-R.g[10]]);
    XE.gravity=0;const b=XV.chemLab.makeBody(XE,26,56,[0,1.3,-.05]);b.v=[0,0,0];
    for(const o of XE.bodies)if(o!==b)o.fixed=true;
    R.gp.buttons[1].pressed=true;frames(2);
    ok(b.held===1&&Hn.held===b,'хват рядом с рукой берёт предмет');
    const yaw0=XE.player.yaw,p0=b.p.slice();R.gp.axes[3]=-1;frames(25);R.gp.axes[3]=0;frames(1);
    const mv=norm([b.p[0]-p0[0],b.p[1]-p0[1],b.p[2]-p0[2]]),moved=Math.hypot(b.p[0]-p0[0],b.p[1]-p0[1],b.p[2]-p0[2]);
    ok(moved>.2&&dot3(mv,fwd)>.995&&dot3(mv,gz)<.9,'стик вперёд двигает предмет вдоль указки (cos к указке '+dot3(mv,fwd).toFixed(4)+', к ручке '+dot3(mv,gz).toFixed(3)+')');
    /* вращение вокруг оси указки стиком влево/вправо; игрок не поворачивается, дуга не включается */
    const c0=[b.m[0],b.m[1],b.m[2]],ax0=dot3(c0,fwd);R.gp.axes[2]=1;frames(25);R.gp.axes[2]=0;frames(1);
    const c1=norm([b.m[0],b.m[1],b.m[2]]),turned=Math.hypot(c1[0]-c0[0],c1[1]-c0[1],c1[2]-c0[2]);
    ok(turned>.3&&Math.abs(dot3(c1,fwd)-ax0)<.01,'стик вправо вращает предмет вокруг оси указки (поворот '+turned.toFixed(2)+', ось не уходит)');
    ok(XE.player.yaw===yaw0&&!Hn.aim,'пока предмет в руке, стик не поворачивает игрока и не включает телепорт');
    /* стик отклонён и предмет отпущен: телепорт и поворот не срабатывают, пока стик не вернулся в центр */
    R.gp.axes[3]=-1;frames(2);R.gp.buttons[1].pressed=false;frames(3);
    const tx=XE.player.tx,tz=XE.player.tz;
    ok(b.held===null&&!Hn.aim,'отпустил хват при отклонённом стике — дуга телепорта не включилась');
    R.gp.axes[3]=0;frames(3);
    ok(XE.player.tx===tx&&XE.player.tz===tz&&XE.player.yaw===yaw0,'вернул стик в центр — игрока не телепортировало и не повернуло');
    R.r=ray(.2);frames(1);R.gp.axes[3]=-1;frames(3);
    ok(Hn.aim===true,'после центра стика дуга телепорта включается снова');
    R.gp.axes[3]=0;frames(2);
    /* одна рука держит предмет, другой можно перемещаться (поворот правым стиком) */
    const Lh=X.hands.left;Lh.g=X.mat(-.3,1.3,0);Lh.r=ray(th);const b2=XV.chemLab.makeBody(XE,8,16,[-.3,1.3,-.05]);b2.v=[0,0,0];
    Lh.gp.buttons[1].pressed=true;frames(2);
    ok(XE.H[0].held===b2,'левая рука держит предмет');
    const y1=XE.player.yaw;R.gp.axes[2]=1;frames(2);R.gp.axes[2]=0;frames(2);
    ok(Math.abs(XE.player.yaw-y1)>.4&&XE.H[0].held===b2,'пока левая рука держит предмет, правым стиком можно поворачиваться');
    Lh.gp.buttons[1].pressed=false;frames(2);XE.gravity=9.8;
    XE.loadRoom('hall');frames(2);
    ok(XE.hud.attachOff===null&&XE.tpOk(0,-4,.4)===true,'в другой комнате смещение таймера и запретные зоны сброшены');
  }
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
    ok(HS.student(s1.id).status==='archived'&&!HS.students().some(x=>x.id===s1.id)&&!HS.studentByNum(null,HS.numOf(HS.student(s1.id)))&&HS.results(s1.id).length===1&&TS.results(s1.id).length===1,'удаление ученика = архив: дошло до шлема (не в списке входа), результат на месте');
    const s2=HS.addStudent('Оля',3);HS.addResult({sid:s2.id,subj:'math',band:'a',grade:3,score:5,total:5,ans:[]});await HS.sync();await TS.sync();
    TS.clearResults();await TS.sync();await HS.sync();
    ok(HS.results().length===0&&HS.student(s2.id),'очистка результатов дошла до шлема, ученики остались');
    HS.addFeedback({kind:'idea',text:'Добавьте музыку',grade:3,room:'space'});await HS.sync();await TS.sync();
    ok(TS.feedback().length===1&&TS.feedback()[0].text==='Добавьте музыку'&&!TS.feedback()[0].sid,'анонимный отзыв со шлема дошёл до учителя');
    TS.removeFeedback(TS.feedback()[0].id);await TS.sync();await HS.sync();ok(HS.feedback().length===0,'удаление отзыва дошло до шлема');
    HS.setServer(url,'wrong');st=await HS.sync();ok(st.state==='err'&&/ключ/.test(st.msg),'неверный ключ: '+st.msg);
    const ex=await fetch(url+'/api/export',{headers:{'X-Key':'dev-secret'}});ok(ex.status===403,'экспорт с ключом шлема запрещён');
    const sql=cp.execFileSync('python3',['-c','import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute("select count(*) from students").fetchone()[0],c.execute("select count(*) from tests").fetchone()[0])',path.join(dir,'vrlesson.db')]).toString().trim();
    ok(sql==='2 1','в SQLite: 2 ученика (один в архиве), 1 тест ('+sql+')');
    ok(cp.execFileSync('python3',['-c','import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute("select count(*) from students where status=\'archived\'").fetchone()[0],c.execute("select count(*) from results where sid=?",(sys.argv[2],)).fetchone()[0],c.execute("select count(*) from deleted where id=?",(sys.argv[2],)).fetchone()[0])',path.join(dir,'vrlesson.db'),s1.id]).toString().trim()==='1 1 0','в SQLite: удалённый учеником учителя ученик status=archived, его результат на месте, записи в deleted нет');
    ok(!fs.existsSync(path.join(dir,'keys.json'))||JSON.parse(fs.readFileSync(path.join(dir,'keys.json'),'utf8')).teacher,'ключи на месте');
    HS.setServer(url,'dev-secret');
    const s4=TS.addStudent('Вера Смирнова',4);await TS.sync();await HS.sync();
    HS.removeStudent(s4.id);HS.setSettings({minutes:44});await HS.sync();await TS.sync();
    ok(!!TS.student(s4.id)&&TS.student(s4.id).status==='active'&&TS.settings().minutes!==44,'ключ шлема не может удалять (архивировать) учеников и менять настройки');
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
      ok(early.some(r=>r[3]==='student.create'&&r[1]==='device')&&early.some(r=>r[3]==='student.pin_change'&&r[1]==='legacy-teacher')&&early.some(r=>r[3]==='student.archive'&&r[4]==='student'),'аудит: действия предыдущих проверок уже в журнале (ученик от шлема, смена кода, архив ученика)');
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
      const nRes=()=>+pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from results where sid=?",(sys.argv[2],)).fetchone()[0])',hs.id);
      m=lastId();TS.removeStudent(hs.id);await TS.sync();r1=rows(m);
      ok(r1.length===1&&r1[0][3]==='student.archive'&&r1[0][4]==='student'&&r1[0][5]===hs.id&&r1[0][7]==='{}'&&nRes()===1,'аудит: removeStudent = архив — запись student.archive, результаты на месте ('+acts(r1)+')');
      await TS.sync();ok(rows(m).length===1,'аудит: повтор не дублирует запись');
      /* надгробие от старого клиента: архив с via=tombstone, в deleted не пишется, результаты остаются */
      {const tk=TS.addStudent('Старый Клиент',6);HS.setServer(url,'dev-secret');await TS.sync();
        const rr=await fetch(url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':'teach-secret'},body:JSON.stringify({students:[],deleted:{[tk.id]:Date.now()+60000}})}).then(r=>r.json());
        m=lastId()-0;const q=pq('import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute("select status from students where id=?",(sys.argv[2],)).fetchone()[0],c.execute("select count(*) from deleted where id=?",(sys.argv[2],)).fetchone()[0],[r[0] for r in c.execute("select detail from audit_log where target_id=? and action=?",(sys.argv[2],"student.archive"))]]))',tk.id);
        ok(JSON.stringify(JSON.parse(q))===JSON.stringify(['archived',0,['{"via": "tombstone"}']])&&rr.state.students.find(x=>x.id===tk.id).status==='archived'&&!(tk.id in rr.state.deleted),'аудит: надгробие старого клиента — status=archived, в deleted нет, аудит student.archive с via=tombstone ('+q+')');}
      ok(pq('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select count(*) from audit_log where target_id=?",(sys.argv[2],)).fetchone()[0])',hs.id)==='2'&&TS.student(hs.id).status==='archived','аудит: записи об архивном ученике остаются в журнале, запись ученика на месте');
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
    /* ---- Б74 шаг 19: одно правило слияния в Node (Store.merge) и в живом сервере (merge_in), А11 ---- */
    {const post=(key,body)=>fetch(url+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Key':key},body:JSON.stringify(body)}).then(r=>r.json());
      const dbp=path.join(dir,'vrlesson.db'),purge=id=>cp.execFileSync('python3',['-I','-c','import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute("insert or replace into purged(id,ts,kind) values(?,?,?)",(sys.argv[2],int(sys.argv[3]),"test"));c.commit()',dbp,id,String(Date.now())]);
      const B0=Date.now()+5e6,u=n=>B0+n*1000,mk=(kind,id,name,upd,status)=>kind==='students'?{id,name,grade:6,classId:null,pinHash:null,created:B0,updated:u(upd),school:'school-default',year:2025,status:status||'active'}:{id,grade:6,letter:name,created:B0,updated:u(upd),school:'school-default',year:2025,status:status||'active'};
      const pick=(kind,x)=>kind==='students'?[x.name,x.status,x.updated]:[x.letter,x.status,x.updated];
      /* [название, D в базе (upd,имя,статус) | null, I присланное | null, T надгробие | null, hard, ожидание [имя,статус,upd] | null] */
      const CASES=[['надгробие новее записи',[10,'D'],null,20,0,['D','archived',20]],['надгробие старее записи',[10,'D'],null,5,0,['D','active',10]],
        ['правка новее, надгробие между',[10,'D'],[20,'I'],15,0,['I','active',20]],['надгробие новее правки',[10,'D'],[20,'I'],30,0,['I','archived',30]],
        ['равные updated, без надгробия',[10,'D'],[10,'I'],null,0,['D','active',10]],['равные updated, надгробие новее',[10,'D'],[10,'I'],11,0,['D','archived',11]],
        ['надгробие равно updated',[10,'D'],null,10,0,['D','active',10]],['уже в архиве, надгробие новее',[10,'D','archived'],null,20,0,['D','archived',10]],
        ['возврат после надгробия, надгробие повторно',[50,'D'],null,20,0,['D','active',50]],['новая запись и надгробие',null,[20,'I'],25,0,['I','archived',25]],
        ['присланное старее базы, надгробие между',[30,'D'],[10,'I'],20,0,['D','active',30]],['присланное архивное новее базы, надгробие старее',[10,'D'],[20,'I','archived'],15,0,['I','archived',20]],
        ['надгробие неизвестного id раньше записи',null,[20,'I'],25,0,['I','archived',25],1],
        ['id в purged',[10,'D'],[20,'I'],30,1,null]];
      let n=0,allOk=true,diffs=[];
      for(const kind of['students','classes'])for(const [nm,D,I,T,hard,exp,early] of CASES){
        const id='eq'+(++n)+'-'+kind[0]+Date.now().toString(36);
        if(hard)purge(id);
        const d=D&&mk(kind,id,D[1],D[0],D[2]),i=I&&mk(kind,id,I[1],I[0],I[2]);
        if(early)await post('teach-secret',{deleted:{[id]:u(T)}}); // надгробие неизвестного id записывается в deleted, запись приходит позже
        if(d)await post('teach-secret',{[kind]:[d]});
        const sv=await post('teach-secret',{[kind]:i?[i]:[],deleted:T!==null&&!early?{[id]:u(T)}:{}});
        const SA={students:[],classes:[],deleted:{},purged:hard?{[id]:1}:{}};if(d)SA[kind]=[d];
        const SB={[kind]:i?[i]:[],deleted:T!==null?{[id]:u(T)}:{}};
        const cl=V0.Store.merge(SA,SB)[kind].find(x=>x.id===id),sr=sv.state[kind].find(x=>x.id===id);
        const pc=cl?JSON.stringify(pick(kind,cl)):'нет',ps=sr?JSON.stringify(pick(kind,sr)):'нет';
        const want=exp?JSON.stringify([exp[0],exp[1],u(exp[2])]):'нет';
        if(pc!==ps||pc!==want){allOk=false;diffs.push(kind+' '+nm+': клиент '+pc+', сервер '+ps+', ждали '+want);}}
      ok(allOk,'равенство слияния: Store.merge (Node) и merge_in (живой сервер) на '+n+' краевых случаях дают один итог'+(diffs.length?' ('+diffs.join('; ')+')':''));
      /* результаты и открытия: архивный ученик — живут, жёстко стёртый — отбрасываются, одинаково на обеих сторонах */
      for(const [nm,hard,wantN] of[['ученик в архиве',0,1],['ученик в purged',1,0]]){
        const sid='eqr-'+hard+Date.now().toString(36),st=mk('students',sid,'R',10),rs={id:'r-'+sid,sid,subj:'math',band:'a',grade:6,score:3,total:5,ans:[],ts:Date.now()+9e6},dc={[sid]:{'x:y':Date.now()+9e6}};
        if(hard)purge(sid);else await post('teach-secret',{students:[st]});
        const sv=await post('teach-secret',{results:[rs],disc:dc,deleted:{[sid]:u(20)}});
        const cl=V0.Store.merge({students:hard?[]:[st],deleted:{},purged:hard?{[sid]:1}:{}},{results:[rs],disc:dc,deleted:{[sid]:u(20)}});
        const cn=[cl.results.filter(r=>r.sid===sid).length,Object.keys(cl.disc[sid]||{}).length],sn=[sv.state.results.filter(r=>r.sid===sid).length,Object.keys(sv.state.disc[sid]||{}).length];
        ok(JSON.stringify(cn)===JSON.stringify(sn)&&sn[0]===wantN&&sn[1]===wantN,'равенство слияния: результаты и открытия, '+nm+' — клиент '+cn+', сервер '+sn+' (ждали '+wantN+')');}
      /* (г) ключ шлема: надгробие и purged не применяются */
      {const id='eqh-'+Date.now().toString(36);await post('teach-secret',{students:[mk('students',id,'H',10)]});
        const hv=await post('dev-secret',{deleted:{[id]:u(99)},purged:{[id]:u(99)}});const x=hv.state.students.find(s=>s.id===id);
        ok(x&&x.status==='active'&&x.updated===u(10)&&!(id in hv.state.deleted)&&!(id in hv.state.purged),'ключ шлема: надгробие и присланное purged ничего не меняют (ученик активен, updated прежний)');}
      /* (д) purged не воскресает ни от нового, ни от старого клиента; присланное purged сервер игнорирует */
      {const id='eqp-'+Date.now().toString(36),rid='eqpr-'+id;await post('teach-secret',{students:[mk('students',id,'P',10)]});purge(id);
        const a1=await post('teach-secret',{students:[mk('students',id,'P2',500)],results:[{id:rid,sid:id,subj:'math',score:1,total:2,ts:Date.now()+9e6}],disc:{[id]:{'a:b':Date.now()+9e6}}});
        ok(!a1.state.students.some(x=>x.id===id)&&!a1.state.results.some(r=>r.sid===id)&&!a1.state.disc[id]&&id in a1.state.purged&&id in a1.state.deleted,'purged: id не воскресает ни записью ученика, ни результатами и открытиями; в ответе он и в purged, и в deleted');
        const a2=await post('teach-secret',{deleted:{[id]:u(900)},students:[mk('students',id,'P3',900)]});
        ok(!a2.state.students.some(x=>x.id===id),'purged: надгробие и запись «старого клиента» тоже не воскрешают');
        const fk='eqf-'+Date.now().toString(36);await post('teach-secret',{purged:{[fk]:1},deleted:{}});
        const a3=await post('teach-secret',{});ok(!(fk in a3.state.purged),'сервер игнорирует присланное purged');
        const loc=V0.Store.merge({students:[mk('students',id,'P',10)]},{purged:a1.state.purged,deleted:a1.state.deleted});
        ok(!loc.students.some(x=>x.id===id)&&id in loc.purged,'purged: клиентский merge тоже отбрасывает и возвращает purged');}
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
      ok(pyq(path.join(dir2,'vrlesson.db'),'pragma user_version')==='6','миграция v2→v6: user_version = 6');
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
      ok(baks().length===1&&pyq(path.join(dir2,'vrlesson.db'),'pragma user_version')==='6','миграция повторяема: после перезапуска новой копии нет');
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
c=sqlite3.connect(sys.argv[1]);s=app.state(c);s.pop('v');s.pop('purged',None);print(json.dumps(s,ensure_ascii=False,sort_keys=True))`;
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
    ok(d1[0]===6&&NEWT.every(t=>d1[1].includes(t))&&d1[2].includes('teacherId'),'миграция v3→v6: user_version = 6, есть все новые таблицы и колонка classes.teacherId');
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
      ok(py('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("pragma user_version").fetchone()[0])',db6)==='6'&&cnt('schools')==='1','откат: после возврата на новый код user_version = 6');
    }
    /* Б74, шаг 18: миграция v5→v6 и корзина */
    {
      const mk=()=>{const d=newDir(v3db);py(`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
c=sqlite3.connect(sys.argv[1]);app.migrate_v4(c);c.execute("INSERT OR REPLACE INTO deleted(id,ts) VALUES('old-x',1760000000001)");c.commit();c.close()`,path.join(d,'vrlesson.db'),srvDir,d);return d;};
      const dirB=mk(),dbB=path.join(dirB,'vrlesson.db');
      const q=(db,sql)=>py('import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchone()[0])',db,sql);
      ok(q(dbB,'pragma user_version')==='5'&&q(dbB,'select count(*) from deleted')==='2','Б74: исходная база v5 с надгробиями (gone1, old-x)');
      const dumpB=`import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute('pragma user_version').fetchone()[0],sorted(r[0] for r in c.execute("select name from sqlite_master")),(c.execute('select * from purged order by id').fetchall() if c.execute("select count(*) from sqlite_master where name='purged'").fetchone()[0] else []),c.execute('select id,doc from students order by id').fetchall(),c.execute('select count(*) from results').fetchone()[0]],ensure_ascii=False))`;
      /* обрыв посреди migrate_b74: база остаётся v5 */
      const crash=`import sys,os;sys.path.insert(0,sys.argv[2]);os.environ['DATA_DIR']=sys.argv[3]
import app,sqlite3
class P:
    def __init__(s,c): s.c=c
    @property
    def in_transaction(s): return s.c.in_transaction
    def commit(s): s.c.commit()
    def execute(s,sql,*a):
        if 'INTO purged' in sql: raise RuntimeError('обрыв')
        return s.c.execute(sql,*a)
c=sqlite3.connect(sys.argv[1])
try:
    app.migrate_b74(P(c))
except RuntimeError:
    print('crashed')`;
      const b0=py(dumpB,dbB);
      ok(py(crash,dbB,srvDir,dirB)==='crashed'&&py(dumpB,dbB)===b0&&JSON.parse(b0)[0]===5&&!JSON.parse(b0)[1].includes('purged'),'Б74: после обрыва migrate_b74 база прежняя (v5, таблиц purged/trash нет)');
      let pB=await startOn(dirB,8801,path.join(srvDir,'app.py'));
      try{
        ok(baks(dirB,'v5').length===1&&q(path.join(dirB,baks(dirB,'v5')[0]),'pragma user_version')==='5','Б74: перед миграцией сделана копия bak-v5');
        const h=await (await fetch('http://127.0.0.1:8801/api/health')).json();ok(h.ok&&h.schema===4,'Б74: /api/health schema = 4');
      }finally{pB.kill();}
      await new Promise(r=>setTimeout(r,300));
      const A1=JSON.parse(py(dumpB,dbB));
      ok(A1[0]===6&&JSON.stringify(A1[2].map(r=>[r[0],r[2]]))===JSON.stringify([['gone1','legacy'],['old-x','legacy']])&&A1[1].includes('trash')&&A1[4]===5,'Б74: user_version = 6, purged содержит все id из deleted, результаты на месте');
      ok(q(dbB,"select count(*) from pragma_table_info('uploads') where name in ('archived_at','archived_by')")==='2','Б74: у uploads есть archived_at и archived_by');
      const a1=py(dumpB,dbB);
      pB=await startOn(dirB,8801,path.join(srvDir,'app.py'));
      try{await new Promise(r=>setTimeout(r,200));}finally{pB.kill();}
      await new Promise(r=>setTimeout(r,300));
      ok(py(dumpB,dbB)===a1&&baks(dirB,'v5').length===1&&baks(dirB,'v6').length===0,'Б74: второй старт ничего не меняет и копий не делает');
      /* откат на код v3 */
      {
        const dirR=newDir(dbB);let po=await startOn(dirR,8802,path.join(ROOT,'tests/fixtures/server_v3.py'));
        try{const ex=await (await fetch('http://127.0.0.1:8802/api/export',{headers:{'X-Key':'teach-secret'}})).json();
          ok(ex.students.length===4&&ex.results.length===5,'Б74: откат — сервер v3 открывает базу v6 с теми же данными');}finally{po.kill();}
      }
      /* корзина на живом сервере */
      const T='http://127.0.0.1:8801',TK={'X-Key':'teach-secret','Content-Type':'application/json'},DK={'X-Key':'dev-secret','Content-Type':'application/json'};
      const sync=async(body,hd)=>(await (await fetch(T+'/api/sync',{method:'POST',headers:hd||TK,body:JSON.stringify(Object.assign({v:4,classes:[],students:[],results:[],disc:{},tests:[],feedback:[],deleted:{},settings:{}},body))})).json());
      const tr=(k)=>q(dbB,`select count(*) from trash where kind='${k}'`);
      pB=await startOn(dirB,8801,path.join(srvDir,'app.py'));
      try{
        const U=1790000000000;
        await sync({tests:[{id:'t74',title:'Дроби',subj:'math',updated:U,qs:[]}],feedback:[{id:'f74',ts:U,kind:'room',room:'a',rating:5,text:'норм'}],settings:{updated:U,rooms:{rm1:{id:'rm1',title:'Комната'},rm2:{id:'rm2',title:'Вторая'}}}});
        let sd=await sync({},DK);
        ok(sd.state.tests.some(x=>x.id==='t74')&&sd.state.feedback.some(x=>x.id==='f74'),'Б74: тест и отзыв дошли до шлема');
        await sync({deleted:{t74:U+1,f74:U+1,r2:U+1}});
        sd=await sync({},DK);
        ok(!sd.state.tests.some(x=>x.id==='t74')&&!sd.state.feedback.some(x=>x.id==='f74')&&!sd.state.results.some(x=>x.id==='r2'),'Б74: удалённые тест, отзыв и результат у шлема пропали');
        ok(tr('test')==='1'&&tr('feedback')==='1'&&tr('result')==='2'&&q(dbB,"select count(*) from tests where id='t74'")==='0'&&q(dbB,"select count(*) from results where id='r2'")==='0','Б74: тест, отзыв и результат — в trash, из своих таблиц убраны');
        ok(JSON.parse(q(dbB,"select doc from trash where kind='test'")).title==='Дроби'&&q(dbB,"select school from trash where kind='result'")==='school-default'&&q(dbB,"select actor_kind from trash where kind='test'")==='legacy-teacher','Б74: в корзине полный документ, школа и автор действия');
        await sync({deleted:{t74:U+2}});
        ok(tr('test')==='1','Б74: повторное надгробие корзину не дублирует');
        const nRes=q(dbB,'select count(*) from results');
        await sync({settings:{updated:U+3,rooms:{rm2:{id:'rm2',title:'Вторая'}}}});
        ok(tr('room')==='1'&&JSON.parse(q(dbB,"select doc from trash where kind='room'")).title==='Комната'&&q(dbB,"select json_extract(doc,'$.rooms.rm2.title') from settings")==='Вторая'&&q(dbB,"select json_extract(doc,'$.rooms.rm1') is null from settings")==='1','Б74: комната, убранная из rooms, — в trash (kind room), оставшаяся цела');
        const dk=py('import sqlite3,sys;r=sqlite3.connect(sys.argv[1]).execute("select sid,k from disc limit 1").fetchone();print(r[0]+" "+r[1])',dbB).split(' ');
        const R=1790000000000*2;
        await sync({settings:{updated:U+5,resetAt:R,rooms:{rm2:{id:'rm2',title:'Вторая'}}}});
        sd=await sync({},DK);
        ok(sd.state.results.length===0&&Object.keys(sd.state.disc).length===0&&q(dbB,'select count(*) from results')===nRes&&Number(nRes)>0,'Б74: «очистить результаты» — у шлема пусто, в базе строки прежние ('+nRes+')');
        await sync({disc:{[dk[0]]:{[dk[1]]:R+7}}});
        sd=await sync({},DK);
        ok(sd.state.disc[dk[0]]&&sd.state.disc[dk[0]][dk[1]]===R+7,'Б74: после очистки новое открытие той же пары доходит до шлема');
        await sync({tests:[{id:'t75',title:'Новый',subj:'math',updated:U+9,qs:[]}]});await sync({deleted:{t75:U+10}});
        const ex=await (await fetch(T+'/api/export',{headers:{'X-Key':'teach-secret'}})).json();
        ok(ex.results.length===0,'Б74: выгрузка тоже не отдаёт скрытые результаты');
      }finally{pB.kill();}
      await new Promise(r=>setTimeout(r,300));
      pB=await startOn(dirB,8801,path.join(srvDir,'app.py'));
      try{await new Promise(r=>setTimeout(r,200));}finally{pB.kill();}
      await new Promise(r=>setTimeout(r,300));
      ok(q(dbB,"select count(*) from deleted where id='t75'")==='1'&&q(dbB,"select count(*) from purged where id='t75'")==='0','Б74: после перезапуска мягкое надгробие не стало жёстким (purged без t75)');
    }
  }
  /* учётки (шаги 4–7…): отдельные Python-файлы с живым сервером; их строки ok/FAIL входят в общий счёт */
  for(const [file,label] of [['accounts.py','учётки'],['scope.py','права'],['admin.py','админ'],['uploads.py','файлы'],['open.py','открытые'],['hierarchy.py','иерархия'],['ai.py','помощник'],['history.py','история'],['purge.py','стирание'],['net_bots.py','hub-сессии'],['hub_ws.py','hub-WebSocket']]){
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

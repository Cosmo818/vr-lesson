/* custom.js — комнаты конструктора: из данных room/1 (js/roomspec.js) собирается обычная комната по контракту VR.ROOMS.id={title,hint,env,spawn,build,targets,draw,onGrab}.
   Свежее описание берётся из Store при каждом входе в комнату, поэтому правка учителя доходит до шлема после синхронизации без перезагрузки кода.
   Исполняемого кода в данных нет: блоки только рисуются и реагируют на указание (раздел 4 docs/ROOM_SPEC.md). */
(function(){
'use strict';
const VR=window.VR,M=VR.M,TRS=VR.TRS,ROOMS=VR.ROOMS,RS=VR.roomspec;
const {shuffle}=VR.RU;
const rgb=c=>VR.hex(RS.colorHex(c));
const SOUND={ding:[880,.12,'triangle'],chime:[1175,.2,'sine'],low:[260,.2,'triangle'],high:[1480,.1,'square']};
const yawTo=(x,z,sx,sz)=>Math.hypot(sx-x,sz-z)<.01?0:Math.atan2(sx-x,sz-z);
const grade=E=>E.student&&E.student.grade?E.student.grade:5;
const sound=(E,k)=>{const s=SOUND[k];if(s)E.beep(s[0],s[1],s[2]);};

function buildSpec(E,S,spec){
  const sp=spec.spawn,face=(x,z)=>yawTo(x,z,sp.x,sp.z);
  const subj='gen',key=b=>'c:'+spec.id+':'+b.id;
  S.keys=new Set(RS.discoverKeys(spec));S.found=new Set();S.goal=false;
  S.items=[];S.qs=[];
  const mark=b=>{
    if(!S.keys.has(b.id)||S.found.has(b.id))return;
    S.found.add(b.id);
    if(S.found.size===S.keys.size&&!S.goal){S.goal=true;setTimeout(()=>{try{E.fanfare();E.toast('Комната пройдена: всё найдено!','#86efac');}catch(e){}},1300);}
  };
  const find=b=>{E.discover(subj,key(b),(b.label||b.q||'Находка').slice(0,40));mark(b);};
  /* дверь в холл есть всегда: ученик не должен оказаться взаперти */
  E.door(0,5.88,Math.PI,'hall','← Холл','#94a3b8');
  let info=null;
  const showInfo=it=>{
    if(!info)info=E.addPanel({w:2.2,h:.9,pos:[0,2,0],yaw:0,accent:'#facc15',show:false,draw:(c,p)=>{
      const d=info.data;p.text(d.label||'',30,18,{size:50,bold:true});p.text(d.info||'',30,86,{size:34,color:'#e2e8f0',maxY:p.H-10});
    }});
    info.data={label:it.b.label||'Предмет',info:it.b.info};info.show=true;info.dirty=true;
    info.setPose([it.x,it.y+it.b.size/2+.6,it.z],face(it.x,it.z));
  };
  for(const b of spec.blocks){
    if(b.type==='text'){
      E.addPanel({w:b.w,h:Math.round(b.w*.7*100)/100,pos:[b.x,b.y,b.z],yaw:face(b.x,b.z),accent:RS.colorHex(b.accent),draw:(c,p)=>{
        p.text(b.title||'',36,24,{size:56,bold:true,maxW:p.W-72});
        p.text(b.text||'',36,110,{size:36,color:'#dbe6ff',maxW:p.W-72,maxY:p.H-16});
      }});
    }else if(b.type==='table'){
      E.addTable(b.x,b.z,b.w/2,b.d/2,b.h,rgb(b.color));
    }else if(b.type==='item'){
      const col=rgb(b.color),y=b.lift+b.size/2;
      if(b.grab){
        E.addBody({shape:b.shape==='cube'?'cube':'ball',mesh:E.mesh[b.shape],p:[b.x,y,b.z],s:b.size,col,data:{item:b.id}});
        S.items.push({b,x:b.x,y,z:b.z,grab:true});
      }else{
        S.items.push({b,x:b.x,y,z:b.z,m:E.mesh[b.shape]||E.mesh.cube,col,rot:0});
      }
    }else if(b.type==='question'){
      const R={picked:-1,ok:false};
      const opts=shuffle([b.a0,b.a1,b.a2,b.a3].filter(Boolean));
      S.qs.push(R);
      const pn=E.addPanel({w:b.w,h:Math.round(b.w*.72*100)/100,pos:[b.x,b.y,b.z],yaw:face(b.x,b.z),accent:'#34d399',draw:(c,p)=>{
        p.text(b.q,36,22,{size:42,bold:true,maxW:p.W-72,maxY:190});
        opts.forEach((o,i)=>{
          const picked=R.picked===i,good=o===b.a0;
          p.button(36,200+i*98,p.W-72,86,o,()=>{
            if(R.ok)return;R.picked=i;
            if(good){R.ok=true;E.fanfare();if(b.discover)find(b);else mark(b);}else{E.beep(200,.25,'sawtooth',.05);}
            pn.dirty=true;
          },{bg:picked?(good?'#15803d':'#b91c1c'):'#334155',size:34});
        });
        if(R.picked>=0){
          p.text(R.ok?'Верно!'+(b.explain?' '+b.explain:''):'Не совсем. Попробуй ещё раз.',36,200+opts.length*98+8,{size:30,color:R.ok?'#86efac':'#fca5a5',maxW:p.W-72,maxY:p.H-8});
        }
      }});
    }else if(b.type==='quiz'){
      VR.makeQuiz(E,b.subj,[b.x,1.5,b.z],face(b.x,b.z));
    }else if(b.type==='portal'){
      E.door(b.x,b.z,face(b.x,b.z),b.to,b.label||'Дверь',RS.colorHex(b.accent));
    }
  }
  S.showInfo=showInfo;S.find=find;S.sound=sound;
}

/* ---------- редактор прямо в шлеме: планшет на левой руке повторяет меню редактора (Б50) ---------- */
const ED={on:false,id:null,sel:null,hist:[],fut:[]};
const teacherOk=()=>{try{return +sessionStorage.getItem('vrl.editor')>Date.now();}catch(e){return false;}};
const copy=o=>JSON.parse(JSON.stringify(o));
const r05=v=>Math.round(v*20)/20;
const clampC=v=>Math.max(-RS.LIM.coord,Math.min(RS.LIM.coord,r05(v)));
const edBlock=(spec,id)=>spec&&spec.blocks.find(b=>b.id===id);
const fld=(b,k)=>(RS.FIELDS[b.type]||[]).find(f=>f.k===k);
function bump(b,k,d,mul){
  const f=fld(b,k);if(!f||typeof b[k]!=='number')return false;
  let v=mul?b[k]*d:b[k]+d;v=Math.round(Math.max(f.min,Math.min(f.max,v))*100)/100;
  if(v===b[k])return false;b[k]=v;return true;
}
function rebuild(E){const at=E.poseNow();E.loadRoom(ED.id);E.setPose(at.x,at.z,at.yaw);}
function commit(E,spec,before){
  const res=VR.Store.saveRoom(spec);
  if(!res.spec){E.toast(res.errors[0]||'Так нельзя','#fca5a5');E.beep(200,.2,'sawtooth',.05);return false;}
  if(before!==undefined){ED.hist.push(before);if(ED.hist.length>100)ED.hist.shift();ED.fut=[];}
  rebuild(E);return true;
}
function edit(E,fn){
  const cur=VR.Store.customRoom(ED.id);if(!cur)return;
  const spec=copy(cur),before=JSON.stringify(cur);
  if(fn(spec)===false){E.beep(200,.12,'sawtooth',.04);return;}
  commit(E,spec,before);
}
function undoRedo(E,back){
  const from=back?ED.hist:ED.fut,to=back?ED.fut:ED.hist;if(!from.length)return;
  const cur=VR.Store.customRoom(ED.id);to.push(JSON.stringify(cur));
  const spec=JSON.parse(from.pop());
  if(!commit(E,spec))from.push(to.pop());
}
/* вперёд для игрока: вектор взгляда и «вправо» от него */
function dirs(E){const f=E.headPose().f;return{f,r:[-f[1],f[0]]};}
function ahead(E,m){const h=E.headPose();return[clampC(h.pos[0]+h.f[0]*m),clampC(h.pos[2]+h.f[1]*m)];}
function move(E,dx,dz){edit(E,s=>{const b=edBlock(s,ED.sel);if(!b)return false;const x=clampC(b.x+dx),z=clampC(b.z+dz);if(x===b.x&&z===b.z)return false;b.x=x;b.z=z;});}
function vert(E,d){edit(E,s=>{const b=edBlock(s,ED.sel);if(!b)return false;return bump(b,b.type==='item'?'lift':b.type==='table'?'h':'y',d,false);});}
function grow(E,m){edit(E,s=>{const b=edBlock(s,ED.sel);if(!b)return false;let ch=false;
  if(b.type==='item')ch=bump(b,'size',m,true);else if(b.type==='table'){ch=bump(b,'w',m,true);ch=bump(b,'d',m,true)||ch;}else ch=bump(b,'w',m,true);return ch;});}
function addBlock(E,type){edit(E,s=>{
  const b=RS.blockDefault(type),p=ahead(E,1.5);b.x=p[0];b.z=p[1];
  if(type==='portal'){b.to='hall';}
  s.blocks.push(b);ED.sel=b.id;});}
const MOVES=[['◀ Лево',d=>[-d.r[0],-d.r[1]]],['Право ▶',d=>d.r],['▲ Дальше',d=>d.f],['▼ Ближе',d=>[-d.f[0],-d.f[1]]]];
function tabletDraw(E,S,c,p){
  const spec=VR.Store.customRoom(ED.id),b=spec&&edBlock(spec,ED.sel),W=p.W;
  p.text('Редактор: '+(spec?spec.title:''),30,18,{size:46,bold:true,maxW:W-60});
  const t3=(W-60-2*14)/3,t4=(W-60-3*14)/4,X3=i=>30+i*(t3+14),X4=i=>30+i*(t4+14);
  p.button(X3(0),88,t3,84,'↶ Назад',()=>undoRedo(E,true),{bg:'#475569',size:38,disabled:!ED.hist.length});
  p.button(X3(1),88,t3,84,'↷ Вперёд',()=>undoRedo(E,false),{bg:'#475569',size:38,disabled:!ED.fut.length});
  p.button(X3(2),88,t3,84,'Выйти',()=>{ED.on=false;try{sessionStorage.removeItem('vrl.editor');}catch(e){}rebuild(E);E.toast('Редактор закрыт.');},{bg:'#b91c1c',size:38});
  p.text('Добавить перед собой:',30,196,{size:32,color:'#b8c7ea'});
  const types=['text','item','table','question','quiz','portal'];
  types.forEach((k,i)=>p.button(X3(i%3),236+((i/3)|0)*92,t3,80,RS.TYPES[k],()=>addBlock(E,k),{bg:'#2563eb',size:34}));
  p.text(b?'Выбрано: '+blockTitle(b).slice(0,44):'Наведи луч на предмет или панель и нажми — он станет выбранным.',30,430,{size:32,color:b?'#fde68a':'#94a3b8',maxW:W-60,maxY:520});
  const d=dirs(E),st=.25;
  MOVES.forEach((m,i)=>p.button(X4(i),530,t4,84,m[0],()=>{const v=m[1](d);move(E,v[0]*st,v[1]*st);},{bg:'#0e7490',size:32,disabled:!b}));
  p.button(X4(0),628,t4,84,'▲ Выше',()=>vert(E,.1),{bg:'#0e7490',size:32,disabled:!b});
  p.button(X4(1),628,t4,84,'▼ Ниже',()=>vert(E,-.1),{bg:'#0e7490',size:32,disabled:!b});
  p.button(X4(2),628,t4,84,'Крупнее',()=>grow(E,1.15),{bg:'#0e7490',size:32,disabled:!b});
  p.button(X4(3),628,t4,84,'Мельче',()=>grow(E,1/1.15),{bg:'#0e7490',size:32,disabled:!b});
  p.button(X3(0),726,t3,84,'К себе',()=>edit(E,s=>{const k=edBlock(s,ED.sel);if(!k)return false;const a=ahead(E,1.5);k.x=a[0];k.z=a[1];}),{bg:'#0e7490',size:34,disabled:!b});
  p.button(X3(1),726,t3,84,'Копия',()=>edit(E,s=>{const k=edBlock(s,ED.sel);if(!k)return false;const n=copy(k);n.id=RS.newBlockId();n.x=clampC(k.x+.5);s.blocks.push(n);ED.sel=n.id;}),{bg:'#0e7490',size:34,disabled:!b});
  p.button(X3(2),726,t3,84,'Удалить',()=>edit(E,s=>{if(!edBlock(s,ED.sel))return false;s.blocks=s.blocks.filter(k=>k.id!==ED.sel);ED.sel=null;}),{bg:'#b91c1c',size:34,disabled:!b});
  p.text('Каждая правка сохраняется сразу. Подробности: «Конструктор комнат» в кабинете учителя.',30,830,{size:26,color:'#94a3b8',maxW:W-60,maxY:p.H-10});
}
const blockTitle=b=>(RS.TYPES[b.type]||b.type)+': '+(b.title||b.label||b.q||'');
function blockPos(b){return b.type==='item'?[b.x,b.lift+b.size/2,b.z]:b.type==='table'?[b.x,b.h,b.z]:b.type==='portal'||b.type==='quiz'?[b.x,1.4,b.z]:[b.x,b.y,b.z];}
function buildEditor(E,S,spec){
  S.edit=true;
  S.tablet=E.addPanel({w:.46,h:.46,res:1024,pos:[0,1.4,-1],yaw:0,accent:'#facc15',draw:(c,p)=>tabletDraw(E,S,c,p)});
  /* на экране (без шлема) планшет стоит перед лицом чуть слева */
  S.edTargets=spec.blocks.map(b=>{const c=blockPos(b),big=b.w?b.w*.3:.3;return{c,r:Math.max(.3,b.type==='item'?b.size*.8:big),id:'ed'+b.id,sel:()=>{ED.sel=b.id;S.tablet.dirty=true;E.beep(700,.05,'triangle',.04);}};});
}
function poseTablet(E,S){
  const t=S.tablet;if(!t)return;
  const hp=E.headPose().pos,L=E.H[0];let p;
  if(E.session&&L&&L.has)p=[L.g[12],L.g[13]+.22,L.g[14]];
  else{const h=E.headPose(),r=[-h.f[1],h.f[0]];p=[h.pos[0]+h.f[0]*.9-r[0]*.38,h.pos[1]-.12,h.pos[2]+h.f[1]*.9-r[1]*.38];}
  t.setPose(p,yawTo(p[0],p[2],hp[0],hp[2]));
}
function startEdit(E,id){
  if(!teacherOk()){E.toast('Редактор открывается из кабинета учителя: «Править в VR».','#fca5a5');return false;}
  if(!VR.Store.customRoom(id))return false;
  ED.on=true;ED.id=id;ED.sel=null;ED.hist=[];ED.fut=[];
  if(E.roomId===id)rebuild(E);else E.loadRoom(id);
  E.toast('Редактор: планшет у левой руки. Нажми на предмет, чтобы выбрать.','#fde68a');return true;
}

function register(id){
  if(ROOMS[id])return;
  ROOMS[id]={
    custom:true,
    /* движок читает env, spawn и hint до build, поэтому они — «живые» свойства: всегда свежее описание из Store */
    get title(){const s=VR.Store.customRoom(id);return s?s.title:'Комната';},
    get hint(){const s=VR.Store.customRoom(id);return s?(s.hint||s.title):'';},
    get env(){const s=VR.Store.customRoom(id);return(s&&RS.PRESETS[s.env]||RS.PRESETS.lab).env;},
    get spawn(){const s=VR.Store.customRoom(id);return s?{x:s.spawn.x,z:s.spawn.z}:{x:0,z:4};},
    build(E,S){
      const spec=VR.Store.customRoom(id);
      /* комнату удалили, пока ученик был в другой: возвращаем в холл, а не ломаем сцену */
      if(!spec){E.door(0,5.88,Math.PI,'hall','← Холл','#94a3b8');E.addPanel({w:2.6,h:.8,pos:[0,1.7,-5.86],yaw:0,accent:'#ef4444',draw:(c,p)=>p.text('Эту комнату убрал учитель.',36,26,{size:52,bold:true,maxW:p.W-72})});return;}
      buildSpec(E,S,spec);
      if(ED.on&&ED.id===id)buildEditor(E,S,spec);
    },
    targets(E,S){
      if(S.edit)return S.edTargets||[];
      return(S.items||[]).filter(it=>!it.grab).map((it,i)=>({c:[it.x,it.y,it.z],r:Math.max(.3,it.b.size*.7),id:'ci'+i,sel:()=>{
        S.sound(E,it.b.sound);E.burst([it.x,it.y,it.z],14);
        if(it.b.info||it.b.label)S.showInfo(it);
        if(it.b.discover)S.find(it.b);
      }}));
    },
    draw(E,S,add){
      if(S.edit){
        poseTablet(E,S);
        const b=ED.sel&&edBlock(VR.Store.customRoom(ED.id),ED.sel);
        if(b){const q=blockPos(b),k=.07,y=q[1]+(b.type==='item'?b.size/2:b.type==='table'?0:(b.w||1)*.35)+.25+Math.sin(E.t*4)*.04;add(E.mesh.sphere,M.mul(M.trans(q[0],y,q[2]),M.scale(k,k,k)),[1,.85,.2],.9);}
      }
      for(const it of S.items||[]){
        if(it.grab)continue;
        if(it.b.spin)it.rot+=.012;
        const k=it.b.size;
        add(it.m,M.mul(M.trans(it.x,it.y,it.z),M.mul(M.rotY(it.rot),M.scale(k,k,k))),it.col,.12);
      }
    },
    onGrab(E,S,b){
      const id=b&&b.data&&b.data.item;if(!id)return;
      const it=(S.items||[]).find(x=>x.b.id===id);if(!it)return;
      S.sound(E,it.b.sound);
      if(it.b.info||it.b.label)S.showInfo(it);
      if(it.b.discover)S.find(it.b);
    }
  };
}

/* приводит VR.ROOMS в соответствие с настройками: добавляет новые комнаты конструктора, убирает удалённые */
function refresh(){
  const list=VR.Store.customRooms(),ids=new Set(list.map(s=>s.id));
  for(const id of Object.keys(ROOMS))if(ROOMS[id].custom&&!ids.has(id))delete ROOMS[id];
  for(const s of list)register(s.id);
  return list;
}

/* панель «Комнаты учителя» в холле: открытые для класса комнаты конструктора (до 8) */
function hallPanel(E,g){
  const open=refresh().filter(s=>VR.Store.roomOn(s.id,g)).slice(0,8);
  if(!open.length)return;
  const H=96+open.length*86+20;
  E.addPanel({w:2,h:Math.round(H*2/1024*100)/100,pos:[3.9,1.7,5.86],yaw:Math.PI,accent:'#a78bfa',draw:(c,p)=>{
    p.text('Комнаты учителя',30,18,{size:52,bold:true});
    open.forEach((s,i)=>p.button(30,96+i*86,p.W-60,76,s.title,()=>E.goRoom(s.id),{bg:'#7c3aed',size:36}));
  }});
}

VR.custom={refresh,hallPanel,register,startEdit,editing:()=>ED.on?ED.id:null,teacherOk};
})();

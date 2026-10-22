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
    },
    targets(E,S){
      return(S.items||[]).filter(it=>!it.grab).map((it,i)=>({c:[it.x,it.y,it.z],r:Math.max(.3,it.b.size*.7),id:'ci'+i,sel:()=>{
        S.sound(E,it.b.sound);E.burst([it.x,it.y,it.z],14);
        if(it.b.info||it.b.label)S.showInfo(it);
        if(it.b.discover)S.find(it.b);
      }}));
    },
    draw(E,S,add){
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

VR.custom={refresh,hallPanel,register};
})();

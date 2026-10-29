/* einterm.js — терминал-стойка «Эйнштейн»: тумба и наклонный экран (2048×1536), на нём шапка, доска (поле, подсказки под ним и справа) и окно меню.
   Рисует через VR.einplay.draw*; партия G общая с комнатой (стена и терминал — два вида одной партии).
   Кнопки нажимаются тычком руки (VR.einterm.poke из update комнаты), фишки — лучом и курком (grip — убрать).
   Используется в комнате «Эйнштейн» (js/einroom.js) и в холле (ROOMS.hall в js/rooms.js). */
(function(){
'use strict';
const VR=window.VR,TRS=VR.TRS;
const TILT=.52,SW=.8,SH=.6,RES=2048,CY=1.10;/* наклон назад ~30°, размер экрана, центр по высоте */
const POKE_IN=.02,POKE_OUT=.05,LIFT=.05;/* глубина нажатия, отход для повтора, сдвиг точки наружу вдоль нормали */

/* внешняя нормаль экрана (мир): совпадает с поворотом в E.rayPanel */
function normal(T){const s=Math.sin(T.yaw),c=Math.cos(T.yaw);return[s*Math.cos(TILT),Math.sin(TILT),c*Math.cos(TILT)];}

function draw(E,T,c,p){
  const PL=VR.einplay,G=T.G;if(!G||!G.g)return;
  const g=G.g,cfg=Object.assign({},PL.CFG.term,{toggle:T.onToggle?{label:T.toggleLabel,fn:()=>T.onToggle(T)}:null});
  /* шапка 0…130 (название, время, «Начать» / «Пауза» / «Открыть клетку» / «Меню»), доска 134…1460, строка состояния */
  PL.drawBar(E,G,c,p,{x:0,y:0,w:RES,h:130},cfg);
  PL.drawBoard(E,G,c,p,{x:10,y:134,w:RES-20,h:1326},cfg);
  const st=g.status==='play'?(G.msg||('Фишки — лучом и курком, убрать — курок с боковой кнопкой. Головоломка № '+g.pz.seed+(G.tid?' (турнир)':'')+PL.note(E,G))):G.msg;
  p.text(st,24,1468,{size:28,lh:32,color:g.status==='lose'?'#fca5a5':g.status==='win'?'#86efac':'#cbd5e1',maxW:RES-48,maxY:1532});
}

/* opt: x, z, yaw, G (партия VR.einplay.create), toggleLabel, onToggle(term) */
function build(E,opt){
  opt=opt||{};
  const x=opt.x||0,z=opt.z||0,yaw=opt.yaw||0,G=opt.G;
  const T={x,z,yaw,G,onToggle:opt.onToggle||null,toggleLabel:opt.toggleLabel||'Стена ⇄ Терминал',shown:true,panel:null,statics:[],boxes:[]};
  const sw=Math.abs(Math.sin(yaw))>.7;
  T.statics.push(E.addStatic(E.mesh.cube,TRS(x,.41,z,.5,.82,.3,yaw),[.2,.22,.32]));
  T.boxes.push(E.addBox({x,z,hx:sw?.15:.25,hz:sw?.25:.15,top:.82}));
  T.panel=E.addPanel({w:SW,h:SH,res:RES,pos:[x,CY,z],yaw,tilt:TILT,accent:'#818cf8',draw:(c,p)=>draw(E,T,c,p)});
  /* перерисовка терминала при любом изменении партии (одна текстура, только по dirty) */
  if(G){const o=G.opt||(G.opt={}),prev=o.onDirty;o.onDirty=w=>{if(prev)prev(w);if(T.panel)T.panel.dirty=true;};}
  /* показать/скрыть: ссылки на панель и тумбу остаются, из сцены и столкновений они убираются */
  T.setShown=v=>{
    v=!!v;T.shown=v;T.panel.show=v;if(v)T.panel.dirty=true;
    for(const s of T.statics){const i=E.statics.indexOf(s);if(v&&i<0)E.statics.push(s);else if(!v&&i>=0)E.statics.splice(i,1);}
    for(const b of T.boxes){const i=E.boxes.indexOf(b);if(v&&i<0)E.boxes.push(b);else if(!v&&i>=0)E.boxes.splice(i,1);}
  };
  return T;
}

/* тычок рукой: точка руки h.g[12..14], луч из точки, сдвинутой на 5 см наружу, внутрь по нормали экрана */
function poke(E,T){
  if(!T||!T.panel||!T.shown||!T.panel.show)return;
  const p=T.panel,n=normal(T);
  for(const h of E.H){
    if(!h.has||!h.g){h._pokeEin=false;continue;}
    const o=[h.g[12]+n[0]*LIFT,h.g[13]+n[1]*LIFT,h.g[14]+n[2]*LIFT];
    const r=E.rayPanel(p,o,[-n[0],-n[1],-n[2]]);
    if(r&&r.t-LIFT<=POKE_IN){
      if(h._pokeEin)continue;
      h._pokeEin=true;
      for(let i=p.btns.length-1;i>=0;i--){const b=p.btns[i];
        if(!b.disabled&&r.px>=b.x&&r.px<=b.x+b.w&&r.py>=b.y&&r.py<=b.y+b.h){
          E.buzz(h,.4,30);E.beep(880,.04,'square',.03);p.dirty=true;
          try{b.fn(h);}catch(e){}
          break;}}
    }else if(!r||r.t-LIFT>POKE_OUT)h._pokeEin=false;
  }
}
VR.einterm={build,poke,draw,normal,TILT};
})();

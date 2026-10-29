/* einroom.js — комната «Эйнштейн»: головоломка 6x6 на трёх стенных панелях (поле, подсказки, управление) + «Сохранённые».
   Игра (состояние, рисование, курок, пауза) — в js/einplay.js (VR.einplay); здесь только стена: панели и список сохранённых.
   Результат победы отдаётся в VR.games.finish (js/games.js), если он есть. */
(function(){
'use strict';
const VR=window.VR,E1=VR.einstein,ROOMS=VR.ROOMS,PL=VR.einplay;
function favDraw(E,S,c,p){
  const g=S.g,W=p.W,X=24,F=VR.games&&VR.games.favs?VR.games.favs('einstein'):[];
  p.text('Сохранённые',X,14,{size:44,bold:true,maxW:W-48});
  const mine=F.includes(g.pz.seed);
  p.button(X,84,W-48,70,mine?'★ Убрать из сохранённых':'☆ Сохранить эту № '+g.pz.seed,()=>{if(VR.games&&VR.games.favToggle)VR.games.favToggle('einstein',g.pz.seed);S.favs.dirty=true;},{size:26,bg:mine?'#92400e':'#334155',disabled:!VR.games||!VR.games.favToggle});
  if(!F.length){p.text('Пока пусто. Сохрани понравившуюся головоломку — она останется на этом устройстве.',X,180,{size:26,color:'#94a3b8',maxW:W-48});return;}
  F.slice(0,9).forEach((sd,i)=>{const y=176+i*92;
    p.button(X,y,W-48-84,80,'№ '+sd,()=>{if(S.tid)return;PL.start(E,S,sd);},{size:30,bg:sd===g.pz.seed?'#15803d':'#1e293b',disabled:!!S.tid});
    p.button(W-X-72,y,72,80,'✕',()=>{VR.games.favToggle('einstein',sd);S.favs.dirty=true;},{size:30,bg:'#7f1d1d'});});
  if(F.length>9)p.text('и ещё '+(F.length-9),X,176+9*92,{size:24,color:'#94a3b8'});
}
function applyView(S){
  const t=S.view==='term'&&!!S.term;
  for(const p of[S.field,S.hints,S.ctl,S.favs])if(p){p.show=!t;if(!t)p.dirty=true;}
  if(S.term)S.term.setShown(t);
}
VR.einroomDrawHint=E1.drawHint;
ROOMS.ein={
  title:'Эйнштейн',env:{floor:[.06,.07,.14],wall:[.12,.14,.3],trim:[.55,.5,1],grid:[.35,.3,.8]},spawn:{x:0,z:-.4},
  hint:'Эйнштейн: открой все фишки 6×6 по подсказкам. Курок на фишку — выбрать её, курок при зажатой боковой кнопке (grip) — убрать.',
  build(E,S){
    VR.RU.backDoor(E);
    PL.create(E,{state:S,prefKey:'vrl.einprefs',onDirty(w){
      if(!w||w==='field'||w==='hints')if(S.field)S.field.dirty=true;
      if(!w||w==='ctl')if(S.ctl)S.ctl.dirty=true;
      if(!w||w==='favs')if(S.favs)S.favs.dirty=true;}});
    const pd=VR.games&&VR.games.pending;if(pd&&pd.game==='einstein'){S.tid=pd.tid;S.mid=pd.r+'.'+pd.i;S.nextSeed=pd.seed;VR.games.pending=null;}
    const flip=()=>{S.view=S.view==='term'?'wall':'term';PL.savePref(E,{view:S.view});applyView(S);};
    const WCFG=Object.assign({},PL.CFG.wall,{toggle:{label:'Стена ⇄ Терминал',fn:flip}});
    /* одна доска: поле 6×6, вертикальные подсказки под ним, горизонтальные справа; меню/правила/обучение — поверх неё */
    S.field=E.addPanel({w:4.2,h:2.52,res:2560,pos:[-.2,1.6,-4.2],yaw:0,accent:'#818cf8',draw:(c,p)=>PL.drawBoard(E,S,c,p,{x:8,y:8,w:p.W-16,h:p.H-16},WCFG)});
    S.hints=null;
    S.ctl=E.addPanel({w:1.4,h:1.1,res:768,pos:[-3.6,1.35,-4.2],yaw:0,accent:'#f59e0b',draw:(c,p)=>PL.drawCtl(E,S,c,p,{x:0,y:0,w:p.W,h:p.H})});
    S.favs=E.addPanel({w:1.4,h:2.4,res:768,pos:[3.4,1.55,-4.2],yaw:0,accent:'#fbbf24',draw:(c,p)=>favDraw(E,S,c,p)});
    PL.start(E,S,S.nextSeed,false,false);S.nextSeed=undefined;
    /* терминал-стойка: второй вид той же партии; переключение G.view не сбрасывает партию */
    S.term=VR.einterm?VR.einterm.build(E,{x:0,z:-2.0,yaw:0,G:S,toggleLabel:'Стена ⇄ Терминал',onToggle:flip}):null;
    applyView(S);
  },
  targets(){return[];},
  update(E,S,dt){PL.tick(E,S,dt);if(S.term)VR.einterm.poke(E,S.term);},
  draw(){}
};
})();

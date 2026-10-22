/* controllers.js — модель контроллера в руке (Touch / Touch Plus / обычный) и описание частей для подписей.
   Модель стилизованная, из простых форм (без загрузки из сети): положение кнопок схематично, как в обучающем режиме «Первые шаги».
   Система координат — пространство хвата (grip): -Z вперёд вдоль рукояти, +Y на сторону большого пальца, X поперёк. */
(function(){
'use strict';
const VR=window.VR,M=VR.M,TRS=VR.TRS;
/* какой у человека контроллер: по профилям WebXR (inputSource.profiles) */
function kind(h){
  const pr=(h&&h.src&&h.src.profiles)||[],has=s=>pr.some(p=>String(p).indexOf(s)>=0);
  if(has('touch-plus')||has('touch-pro'))return{id:'plus',title:'Meta Quest Touch Plus',ring:false,known:true};
  if(has('oculus-touch'))return{id:'touch',title:'Oculus Touch',ring:true,known:true};
  return{id:'generic',title:'Контроллер VR',ring:false,known:false};
}
/* части: кнопка gp.buttons[i], положение в пространстве хвата, где подписать (смещение подписи) */
function parts(hi){
  const inn=hi===0?1:-1,b1=hi===0?'X':'A',b2=hi===0?'Y':'B';
  return[
    {id:'trigger',btn:0,pos:[0,-.02,-.062],size:[.014,.032,.022],lab:[0,-.12,-.10],name:'Курок',sub:'указательный палец'},
    {id:'grip',btn:1,pos:[inn*.019,-.002,.004],size:[.008,.046,.03],lab:[inn*.13,-.06,.04],name:'Хват',sub:'средний палец'},
    {id:'stick',btn:3,pos:[inn*.008,.024,-.05],size:[.011,.012,.011],lab:[inn*.07,.13,-.10],name:'Стик',sub:'большой палец'},
    {id:'b1',btn:4,pos:[-inn*.021,.017,-.034],size:[.011,.006,.011],lab:[-inn*.13,.08,.02],name:b1,sub:'кнопка'},
    {id:'b2',btn:5,pos:[-inn*.021,.017,-.065],size:[.011,.006,.011],lab:[-inn*.14,.14,-.09],name:b2,sub:'кнопка'}
  ];
}
const BODY=[.36,.38,.45],PART=[.62,.66,.76],HOT=[1,.8,.2];
const pressed=(gp,i)=>!!(gp&&gp.buttons&&gp.buttons[i]&&(gp.buttons[i].pressed||gp.buttons[i].value>.5));
/* рисует контроллер: add — функция движка add(mesh,model,col,em); opt.hot — id подсвеченной части (мигает), opt.t — время */
function draw(add,mesh,h,hi,opt){
  opt=opt||{};const g=h.g,k=kind(h),gp=h.gp,tint=hi?[.95,.55,.2]:[.3,.55,1];
  /* рукоять вдоль оси Z */
  add(mesh.cyl,M.mul(g,M.mul(M.trans(0,-.004,.026),M.mul(M.rotX(Math.PI/2),M.scale(.032,.115,.032)))),BODY,.12);
  /* головка с кнопками */
  add(mesh.cyl,M.mul(g,M.mul(M.trans(0,.008,-.05),M.scale(.056,.016,.056))),BODY,.12);
  add(mesh.cyl,M.mul(g,M.mul(M.trans(0,.0,.07),M.scale(.034,.012,.034))),tint,.25);/* цветной торец: левая — синяя, правая — оранжевая */
  if(k.ring){/* кольцо слежения Touch: ряд бусин над головкой */
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2;add(mesh.ball,M.mul(g,M.mul(M.trans(Math.cos(a)*.052,.03+Math.sin(a)*.012,-.082+Math.sin(a)*.045),M.scale(.014,.014,.014))),[.5,.53,.62],.12);}
  }
  const hot=opt.hot&&Math.sin((opt.t||0)*7)>-.2;
  for(const p of parts(hi)){
    const on=pressed(gp,p.btn)||(p.id==='trigger'&&pressed(gp,0)),mark=hot&&opt.hot===p.id;
    const col=on?HOT:mark?[.3,1,.5]:PART,em=on?.8:mark?.9:.1;
    let x=p.pos[0],y=p.pos[1],z=p.pos[2];
    if(p.id==='stick'){const ax=gp&&gp.axes&&gp.axes.length>=4?gp.axes:[0,0,0,0];
      add(mesh.cyl,M.mul(g,M.mul(M.trans(x,y-.004,z),M.scale(.006,.014,.006))),PART,.05);
      x+=ax[2]*.009;z+=ax[3]*.009;add(mesh.ball,M.mul(g,M.mul(M.trans(x,y+.004,z),M.scale(.022,.016,.022))),col,em);continue;}
    if(p.id==='trigger'||p.id==='grip')add(mesh.cube,M.mul(g,M.mul(M.trans(x,y,z),M.scale(p.size[0],p.size[1],p.size[2]))),col,em);
    else add(mesh.cyl,M.mul(g,M.mul(M.trans(x,y,z),M.scale(.014,.007,.014))),col,em);
  }
}
VR.controllers={kind,parts,draw,pressed};
})();

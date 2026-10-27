/* arena.js — комната «Турниры»: три доски — лучшие игроки со статистикой и историей (VR.games), сетка турнира «на выбывание» и управление
   (создать, записаться, начать, сыграть свой матч). Данные — js/games.js, только на этом устройстве.
   Матч «Эйнштейна»: оба решают одну и ту же головоломку (сид матча), выигрывает быстрее; без помощи и без ошибок.
   Матч шахмат: партия вдвоём за одним шлемом (белые — первый в паре; ничья — переигровка с обменом цветов). */
(function(){
'use strict';
const VR=window.VR,G=VR.games,ROOMS=VR.ROOMS;
const GN={einstein:'Эйнштейн',chess:'Шахматы'};
const fmtT=s=>s==null?'—':Math.floor(s/60)+':'+String(Math.round(s)%60).padStart(2,'0');
const cut=(c,t,w)=>{t=String(t||'');while(t.length>1&&c.measureText(t).width>w)t=t.slice(0,-1);return t;};
const DTABS=['Эйнштейн','Шахматы','Турниры','Я','История'];
const RES={win:'победа',lose:'поражение',draw:'ничья',dnf:'без зачёта'};
const dt=ts=>{const d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
const me=E=>E.student&&E.student.id?{sid:String(E.student.id),name:E.student.name}:null;
function curTour(S){
  const L=G.tour.list();if(!L.length)return null;
  let t=S.tid&&G.tour.get(S.tid);if(!t){t=L.find(x=>x.state!=='done')||L[0];S.tid=t.id;}return t;
}
function refresh(S){S.dash.dirty=S.brk.dirty=S.ctl.dirty=true;}
/* ---------- доска лучших ---------- */
function dashDraw(E,S,c,p){
  const X=30,W=p.W-60,tb=S.dtab|0,m=me(E);
  p.text('Лучшие игроки',X,14,{size:50,bold:true,maxW:W});
  const bw=(W-4*10)/5;
  DTABS.forEach((t,i)=>p.button(X+i*(bw+10),84,bw,64,t,()=>{S.dtab=i;S.dash.dirty=true;},{size:26,active:i===tb,activeBg:'#0f766e',bg:'#1e293b'}));
  let y=180;c.textBaseline='middle';
  const row=(a,b,d,col,bold)=>{c.font=(bold?'bold ':'')+'32px sans-serif';c.fillStyle=col||'#e2e8f0';c.textAlign='left';c.fillText(a,X,y);c.fillText(cut(c,b,W-330),X+70,y);c.textAlign='right';c.fillText(d,p.W-X,y);y+=56;};
  const empty=t=>p.text(t,X,y-20,{size:32,color:'#94a3b8',maxW:W});
  if(tb===0){const r=G.top('einstein',8);if(!r.length)empty('Пока нет решённых головоломок.');r.forEach((x,i)=>row((i+1)+'.',x.name,fmtT(x.best)+' · '+x.wins+' поб.',i===0?'#fde68a':null,i===0));
    c.font='26px sans-serif';c.fillStyle='#64748b';c.textAlign='left';c.fillText('Лучшее время без помощи. Решено головоломок — справа.',X,p.H-40);}
  else if(tb===1){const r=G.top('chess',8);if(!r.length)empty('Пока нет побед в шахматах.');r.forEach((x,i)=>row((i+1)+'.',x.name,x.wins+' поб. из '+x.played,i===0?'#fde68a':null,i===0));}
  else if(tb===2){const r=G.top('tours',8);if(!r.length)empty('Пока нет победителей турниров.');r.forEach((x,i)=>row((i+1)+'.',x.name,x.won+' '+(x.won===1?'турнир':'турнира'),i===0?'#fde68a':null,i===0));}
  else if(tb===3){
    if(!m)empty('Войди как ученик — тогда здесь твоя статистика.');
    else{const s=G.stats(m.sid);
      p.text(m.name,X,y-30,{size:40,bold:true,maxW:W});y+=30;
      row('','Эйнштейн: сыграно '+s.einstein.played+', побед '+s.einstein.wins,'',null);
      row('','Лучшее время / среднее',fmtT(s.einstein.best)+' / '+fmtT(s.einstein.avg),'#bbf7d0');
      row('','Шахматы: сыграно '+s.chess.played,s.chess.w+'-'+s.chess.d+'-'+s.chess.l,null);
      row('','Побед над компьютером по уровням',s.chess.byLvl.join(' · '),'#bbf7d0');
      row('','Турниры: участий / побед',s.tours.played+' / '+s.tours.won,null);
    }}
  else{
    const h=G.history(9);if(!h.length)empty('Игр пока не было.');
    h.forEach(g=>{c.font='26px sans-serif';c.fillStyle='#94a3b8';c.textAlign='left';c.fillText(dt(g.ts),X,y);c.fillStyle='#e2e8f0';c.font='28px sans-serif';
      c.fillText(cut(c,g.name,200),X+190,y);c.fillStyle=g.res==='win'?'#86efac':g.res==='lose'?'#fca5a5':'#cbd5e1';
      c.fillText(GN[g.game]+' — '+RES[g.res]+(g.t!=null&&g.res==='win'?' '+fmtT(g.t):''),X+420,y);y+=50;});
  }
}
/* ---------- сетка турнира ---------- */
function brkDraw(E,S,c,p){
  const t=curTour(S),X=30;
  if(!t){p.text('Турнир',X,14,{size:50,bold:true,maxW:p.W});p.text('Турниров пока нет. Создай турнир на правой доске (нужно войти как ученик).',X,100,{size:34,color:'#94a3b8',maxW:p.W-60});return;}
  p.text(t.name,X,14,{size:46,bold:true,maxW:p.W-60});
  const stT=t.state==='signup'?'идёт запись':t.state==='run'?'идёт турнир':'завершён';
  p.text(GN[t.game]+' · '+stT+' · игроков: '+t.players.length,X,74,{size:28,color:'#94a3b8',maxW:p.W-60});
  if(t.state==='signup'){
    c.textBaseline='middle';c.textAlign='left';c.font='34px sans-serif';
    t.players.forEach((sid,i)=>{c.fillStyle='#e2e8f0';c.fillText((i+1)+'. '+cut(c,t.names[sid],p.W/2-120),X,170+i*52);});
    if(!t.players.length)p.text('Пока никто не записался.',X,150,{size:32,color:'#94a3b8',maxW:p.W-60});
    return;
  }
  const R=t.rounds.length,top=130,bot=p.H-30,colW=(p.W-2*X)/R,bw=colW-44,bh=78;
  const pos=[];
  for(let r=0;r<R;r++){pos[r]=[];const n=t.rounds[r].length,slot=(bot-top)/n;for(let i=0;i<n;i++)pos[r][i]=top+slot*(i+.5);}
  c.lineWidth=3;c.strokeStyle='#475569';
  for(let r=0;r<R-1;r++)for(let i=0;i<t.rounds[r].length;i++){const x0=X+r*colW+bw,x1=X+(r+1)*colW,y0=pos[r][i],y1=pos[r+1][i>>1];c.beginPath();c.moveTo(x0,y0);c.lineTo(x0+22,y0);c.lineTo(x0+22,y1);c.lineTo(x1,y1);c.stroke();}
  c.textBaseline='middle';
  for(let r=0;r<R;r++){
    c.fillStyle='#94a3b8';c.font='24px sans-serif';c.textAlign='left';c.fillText(r===R-1?'Финал':r===R-2&&R>2?'Полуфинал':'Круг '+(r+1),X+r*colW,112);
    t.rounds[r].forEach((m,i)=>{
      const x=X+r*colW,y=pos[r][i]-bh/2;
      c.fillStyle='#16213e';c.fillRect(x,y,bw,bh);c.strokeStyle=m.w?'#14b8a6':'#475569';c.lineWidth=2;c.strokeRect(x,y,bw,bh);
      [['a',0],['b',1]].forEach(([k,j])=>{
        const sid=m[k],ry=y+bh*(j?.75:.25);
        c.font=(m.w&&m.w===sid?'bold ':'')+'26px sans-serif';c.fillStyle=!sid?'#475569':m.w===sid?'#fde68a':m.w?'#64748b':'#e2e8f0';c.textAlign='left';
        const res=k==='a'?m.ra:m.rb,tail=res&&res.t!=null?' '+fmtT(res.t):res?' ✗':'';
        c.fillText(cut(c,sid?(t.names[sid]||'?'):(m.bye?'пропуск':'…'),bw-20-(tail?90:0)),x+10,ry);
        if(tail){c.textAlign='right';c.fillText(tail,x+bw-8,ry);}
      });
    });
  }
  if(t.state==='done'){c.font='bold 40px sans-serif';c.fillStyle='#fde68a';c.textAlign='right';c.fillText('Победитель: '+t.names[t.champ],p.W-X,52);}
}
/* ---------- управление ---------- */
function launch(E,S,t,nx){
  G.pending={tid:t.id,r:nx.r,i:nx.i,game:t.game,seed:nx.seed};
  E.goRoom(t.game==='einstein'?'ein':'play');
}
function ctlDraw(E,S,c,p){
  const X=30,W=p.W-60,m=me(E),t=curTour(S),L=G.tour.list();
  p.text('Управление',X,14,{size:46,bold:true,maxW:W});
  let y=84;
  if(!m){y=p.text('Войди как ученик: гостям турниры недоступны.',X,y,{size:30,color:'#fca5a5',maxW:W})+10;}
  const idx=t?L.findIndex(x=>x.id===t.id):-1;
  if(L.length>1){
    p.button(X,y,90,64,'‹',()=>{S.tid=L[(idx+1)%L.length].id;S.confirm=false;refresh(S);},{size:40,bg:'#334155'});
    p.button(p.W-X-90,y,90,64,'›',()=>{S.tid=L[(idx-1+L.length)%L.length].id;S.confirm=false;refresh(S);},{size:40,bg:'#334155'});
    p.text('Турнир '+(L.length-idx)+' из '+L.length,X+110,y+14,{size:30,maxW:W-220,color:'#cbd5e1'});
  }
  if(L.length>1)y+=84;
  const half=(W-14)/2;
  if(t&&t.state==='signup'){
    const inn=m&&t.players.indexOf(m.sid)>=0;
    p.button(X,y,W,70,inn?'Выйти из турнира':'Записаться',()=>{if(!m)return;if(inn)G.tour.leave(t.id,m.sid);else G.tour.signup(t.id,m.sid,m.name);refresh(S);},{size:34,bg:inn?'#475569':'#0f766e',disabled:!m});y+=84;
    p.button(X,y,W,70,'Начать турнир ('+t.players.length+')',()=>{if(G.tour.start(t.id)){E.fanfare();S.confirm=false;}refresh(S);},{size:34,bg:'#b45309',disabled:t.players.length<2});y+=84;
  }else if(t&&t.state==='run'){
    const nx=m&&G.tour.next(t.id,m.sid),pr=G.tour.progress(t);
    y=p.text('Сыграно матчей: '+pr.done+' из '+pr.all,X,y,{size:30,color:'#cbd5e1',maxW:W})+10;
    if(nx){
      const opp=nx.m.a===m.sid?nx.m.b:nx.m.a;
      y=p.text('Твой матч — против: '+(t.names[opp]||'?'),X,y,{size:32,bold:true,maxW:W})+8;
      p.button(X,y,W,76,t.game==='einstein'?'Играть: Эйнштейн':'Сыграть партию вдвоём',()=>launch(E,S,t,nx),{size:34,bg:'#0f766e'});y+=90;
    }else y=p.text(m&&t.players.indexOf(m.sid)>=0?'Сейчас у тебя нет матча: жди соперника или следующий круг.':'Ты не участвуешь в этом турнире.',X,y,{size:30,color:'#94a3b8',maxW:W})+10;
  }else if(t&&t.state==='done'){y=p.text('Победитель: '+t.names[t.champ],X,y,{size:38,bold:true,color:'#fde68a',maxW:W})+14;}
  if(t&&t.state!=='done'){
    p.button(X,p.H-250,W,64,S.confirm?'Точно отменить? Нажми ещё раз':'Отменить турнир',()=>{if(!S.confirm){S.confirm=true;S.ctl.dirty=true;return;}G.tour.cancel(t.id);S.tid=null;S.confirm=false;refresh(S);},{size:28,bg:S.confirm?'#b91c1c':'#334155'});
  }
  p.button(X,p.H-170,half,70,'Новый: Эйнштейн',()=>{if(m){const n=G.tour.create('einstein','',m.sid);S.tid=n.id;refresh(S);}},{size:26,bg:'#4338ca',disabled:!m});
  p.button(X+half+14,p.H-170,half,70,'Новый: шахматы',()=>{if(m){const n=G.tour.create('chess','',m.sid);S.tid=n.id;refresh(S);}},{size:26,bg:'#4338ca',disabled:!m});
  p.text('Данные игр — только на этом устройстве.',X,p.H-80,{size:24,color:'#64748b',maxW:W});
}
ROOMS.arena={
  title:'Турниры',env:{floor:[.1,.06,.1],wall:[.26,.12,.24],trim:[.96,.45,.72],grid:[.7,.3,.55]},spawn:{x:0,z:-.6},
  hint:'Турниры: слева лучшие игроки, в центре сетка, справа запись и кнопка «Играть».',
  build(E,S){
    VR.RU.backDoor(E);
    S.dtab=0;S.tid=null;S.confirm=false;
    S.dash=E.addPanel({w:2.8,h:2.3,res:1280,pos:[-3.5,1.6,-4.2],yaw:0,accent:'#f472b6',draw:(c,p)=>dashDraw(E,S,c,p)});
    S.brk=E.addPanel({w:3.6,h:2.3,res:1792,pos:[.4,1.6,-4.2],yaw:0,accent:'#a78bfa',draw:(c,p)=>brkDraw(E,S,c,p)});
    S.ctl=E.addPanel({w:2.4,h:2.3,res:1152,pos:[3.9,1.6,-4.2],yaw:0,accent:'#f59e0b',draw:(c,p)=>ctlDraw(E,S,c,p)});
    S.off=G.onChange(()=>{refresh(S);});
  },
  leave(E,S){if(S.off)G.offChange(S.off);},
  targets(){return[];},
  draw(){}
};
})();

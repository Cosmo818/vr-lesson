/* engine.js — маленький движок на WebGL2 + WebXR без внешних библиотек.
   Комнаты, панели с кнопками, предметы с физикой, луч, телепорт, поворот, меню. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};

/* ---------- математика: матрицы 4×4 по столбцам ---------- */
const M={
  id:()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
  mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;},
  trans(x,y,z){const m=M.id();m[12]=x;m[13]=y;m[14]=z;return m;},
  scale(x,y,z){const m=M.id();m[0]=x;m[5]=y;m[10]=z;return m;},
  rotY(a){const c=Math.cos(a),s=Math.sin(a),m=M.id();m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m;},
  rotX(a){const c=Math.cos(a),s=Math.sin(a),m=M.id();m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;},
  rotZ(a){const c=Math.cos(a),s=Math.sin(a),m=M.id();m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m;},
  persp(fov,asp,n,f){const t=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=t/asp;m[5]=t;m[10]=(f+n)/(n-f);m[11]=-1;m[14]=2*f*n/(n-f);return m;},
  inv(m){const o=new Float32Array(16);
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7],a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(!d)return M.id();d=1/d;
    o[0]=(a11*b11-a12*b10+a13*b09)*d;o[1]=(a02*b10-a01*b11-a03*b09)*d;o[2]=(a31*b05-a32*b04+a33*b03)*d;o[3]=(a22*b04-a21*b05-a23*b03)*d;
    o[4]=(a12*b08-a10*b11-a13*b07)*d;o[5]=(a00*b11-a02*b08+a03*b07)*d;o[6]=(a32*b02-a30*b05-a33*b01)*d;o[7]=(a20*b05-a22*b02+a23*b01)*d;
    o[8]=(a10*b10-a11*b08+a13*b06)*d;o[9]=(a01*b08-a00*b10-a03*b06)*d;o[10]=(a30*b04-a31*b02+a33*b00)*d;o[11]=(a21*b02-a20*b04-a23*b00)*d;
    o[12]=(a11*b07-a10*b09-a12*b06)*d;o[13]=(a00*b09-a01*b07+a02*b06)*d;o[14]=(a31*b01-a30*b03-a32*b00)*d;o[15]=(a20*b03-a21*b01+a22*b00)*d;return o;}
};
const TRS=(x,y,z,sx,sy,sz,ry)=>M.mul(M.trans(x,y,z),M.mul(M.rotY(ry||0),M.scale(sx,sy,sz)));
const norm3=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/l,v[1]/l,v[2]/l];};
const dist3=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const hex=h=>{h=String(h).replace('#','');return[parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];};
VR.M=M;VR.TRS=TRS;VR.v3={norm3,dist3,dot3,cross3};VR.hex=hex;

/* ---------- геометрия: позиция(3) нормаль(3) uv(2) ---------- */
const G=VR.geo={};
G.cube=()=>{
  const d=[],F=[[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]],[[1,0,0],[0,0,-1],[0,1,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]]];
  const uv=[[0,0],[1,0],[1,1],[0,1]];
  for(const [n,u,v] of F){
    const P=(a,b)=>[n[0]*.5+u[0]*a+v[0]*b,n[1]*.5+u[1]*a+v[1]*b,n[2]*.5+u[2]*a+v[2]*b];
    const q=[P(-.5,-.5),P(.5,-.5),P(.5,.5),P(-.5,.5)];
    for(const i of[0,1,2,0,2,3])d.push(...q[i],...n,...uv[i]);
  }
  return d;
};
G.sphere=(A,B)=>{
  A=A||16;B=B||12;const d=[];
  const p=(i,j)=>{const th=j/B*Math.PI,ph=i/A*2*Math.PI;const x=Math.sin(th)*Math.cos(ph),y=Math.cos(th),z=Math.sin(th)*Math.sin(ph);return[x*.5,y*.5,z*.5,x,y,z,i/A,j/B];};
  for(let j=0;j<B;j++)for(let i=0;i<A;i++){const a=p(i,j),b=p(i+1,j),c=p(i+1,j+1),e=p(i,j+1);d.push(...a,...c,...e,...a,...b,...c);}
  return d;
};
G.quad=()=>{const n=[0,0,1];return[-.5,-.5,0,...n,0,0,.5,-.5,0,...n,1,0,.5,.5,0,...n,1,1,-.5,-.5,0,...n,0,0,.5,.5,0,...n,1,1,-.5,.5,0,...n,0,1];};
G.disc=N=>{N=N||28;const d=[];for(let i=0;i<N;i++){const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2;d.push(0,0,0,0,1,0,.5,.5,Math.cos(a),0,Math.sin(a),0,1,0,0,0,Math.cos(b),0,Math.sin(b),0,1,0,0,0);}return d;};
G.circle=N=>{N=N||64;const d=[];for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;d.push(Math.cos(a),0,Math.sin(a),0,1,0,0,0);}return d;};
G.stars=(n,r)=>{let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;const d=[];for(let i=0;i<n;i++){const th=Math.acos(rnd()*1.9-.9),ph=rnd()*6.2832;d.push(r*Math.sin(th)*Math.cos(ph),r*Math.cos(th),r*Math.sin(th)*Math.sin(ph),0,1,0,0,0);}return d;};
G.cyl=N=>{N=N||20;const d=[];
  for(let i=0;i<N;i++){const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    const A0=[ca*.5,-.5,sa*.5,ca,0,sa,0,0],A1=[ca*.5,.5,sa*.5,ca,0,sa,0,1],B0=[cb*.5,-.5,sb*.5,cb,0,sb,1,0],B1=[cb*.5,.5,sb*.5,cb,0,sb,1,1];
    d.push(...A0,...B1,...A1,...A0,...B0,...B1);
    d.push(0,.5,0,0,1,0,.5,.5,ca*.5,.5,sa*.5,0,1,0,0,0,cb*.5,.5,sb*.5,0,1,0,0,0);
    d.push(0,-.5,0,0,-1,0,.5,.5,cb*.5,-.5,sb*.5,0,-1,0,0,0,ca*.5,-.5,sa*.5,0,-1,0,0,0);}
  return d;};
G.cone=N=>{N=N||20;const d=[];
  for(let i=0;i<N;i++){const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2,m=(a+b)/2;
    const na=norm3([Math.cos(a),.5,Math.sin(a)]),nb=norm3([Math.cos(b),.5,Math.sin(b)]),nm=norm3([Math.cos(m),.5,Math.sin(m)]);
    d.push(Math.cos(a)*.5,-.5,Math.sin(a)*.5,...na,0,0,0,.5,0,...nm,.5,1,Math.cos(b)*.5,-.5,Math.sin(b)*.5,...nb,1,0);
    d.push(0,-.5,0,0,-1,0,.5,.5,Math.cos(b)*.5,-.5,Math.sin(b)*.5,0,-1,0,0,0,Math.cos(a)*.5,-.5,Math.sin(a)*.5,0,-1,0,0,0);}
  return d;};
G.poly=(V,F)=>{
  let r=0;for(const v of V)r=Math.max(r,Math.hypot(v[0],v[1],v[2]));const k=.5/r,d=[];
  for(const f of F){
    const p=f.map(i=>[V[i][0]*k,V[i][1]*k,V[i][2]*k]),c=[0,0,0];
    for(const q of p){c[0]+=q[0];c[1]+=q[1];c[2]+=q[2];}
    const n=norm3(c);
    for(let j=1;j<p.length-1;j++)d.push(...p[0],...n,0,0,...p[j],...n,0,0,...p[j+1],...n,0,0);
  }
  return d;
};
G.tetraVF=()=>({V:[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],F:[[0,1,2],[0,1,3],[0,2,3],[1,2,3]]});
G.octaVF=()=>({V:[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],F:[[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,2,5],[1,5,3],[1,3,4],[1,4,2]]});
G.icosaVF=()=>{
  const t=(1+Math.sqrt(5))/2;
  const V=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
  const e=(a,b)=>Math.abs(dist3(V[a],V[b])-2)<1e-6,F=[];
  for(let a=0;a<12;a++)for(let b=a+1;b<12;b++)if(e(a,b))for(let c=b+1;c<12;c++)if(e(a,c)&&e(b,c))F.push([a,b,c]);
  return{V,F};
};
G.dodecaVF=()=>{
  const I=G.icosaVF();
  const V=I.F.map(f=>{const c=[0,0,0];for(const i of f){c[0]+=I.V[i][0];c[1]+=I.V[i][1];c[2]+=I.V[i][2];}return[c[0]/3,c[1]/3,c[2]/3];});
  const F=I.V.map((v,vi)=>{
    const fs=[];I.F.forEach((f,fi)=>{if(f.indexOf(vi)>=0)fs.push(fi);});
    const a=norm3(v);let u=Math.abs(a[0])<.9?[1,0,0]:[0,1,0];
    const du=dot3(u,a);u=norm3([u[0]-a[0]*du,u[1]-a[1]*du,u[2]-a[2]*du]);
    const w=cross3(a,u),ang=p=>Math.atan2(dot3(p,w),dot3(p,u));
    return fs.sort((x,y)=>ang(V[x])-ang(V[y]));
  });
  return{V,F};
};
/* лента (толстая линия) в вертикальной плоскости: точки [z,y], плоскость x = const, смотрит в +x */
G.ribbonX=(x,segs,th)=>{
  const d=[];
  for(const s of segs){
    const z1=s[0],y1=s[1],z2=s[2],y2=s[3];
    let dz=z2-z1,dy=y2-y1;const l=Math.hypot(dz,dy)||1;const nz=-dy/l*th/2,ny=dz/l*th/2;
    const a=[x,y1-ny,z1-nz],b=[x,y2-ny,z2-nz],c=[x,y2+ny,z2+nz],e=[x,y1+ny,z1+nz];
    for(const q of[a,b,c,a,c,e])d.push(q[0],q[1],q[2],1,0,0,0,0);
  }
  return d;
};

/* ---------- 2D-рисование на панелях ---------- */
function rrect(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function wrap(c,text,maxW){
  const words=String(text).split(' '),out=[];let line='';
  for(const w of words){const t=line?line+' '+w:w;if(c.measureText(t).width>maxW&&line){out.push(line);line=w;}else line=t;}
  if(line)out.push(line);return out.length?out:[''];
}
VR.ui={rrect,wrap};

/* ======================================================================= */
VR.createEngine=function(canvas){
  let gl=null;
  try{gl=canvas.getContext('webgl2',{xrCompatible:true,antialias:true,alpha:false});}catch(e){}
  if(!gl)throw new Error('В этом браузере нет WebGL2. Открой страницу в Meta Quest Browser или в Chrome.');

  const VS=`#version 300 es
in vec3 aPos;in vec3 aNor;in vec2 aUV;
uniform mat4 uProj,uView,uModel;uniform float uPS;
out vec3 vN;out vec3 vW;out vec2 vUV;
void main(){vec4 w=uModel*vec4(aPos,1.);vW=w.xyz;vN=mat3(uModel)*aNor;vUV=aUV;gl_Position=uProj*uView*w;gl_PointSize=uPS;}`;
  const FS=`#version 300 es
precision highp float;
in vec3 vN;in vec3 vW;in vec2 vUV;
uniform vec3 uCol,uCam,uGrid,uFog;uniform float uEm,uUV;uniform int uMode;uniform sampler2D uTex;
out vec4 o;
void main(){
 if(uMode==1){vec4 t=texture(uTex,vUV);if(t.a<.05)discard;o=vec4(t.rgb,1.);return;}
 if(uMode==3){o=vec4(uCol,1.);return;}
 vec3 n=normalize(vN);
 float d=max(dot(n,normalize(vec3(.4,.9,.3))),0.)*.6+.4;
 vec3 c=uCol;
 if(uMode==4){vec4 t=texture(uTex,vUV*uUV);c=t.rgb*uCol;}
 if(uMode==2){vec2 g=abs(fract(vW.xz-.5)-.5)/fwidth(vW.xz);float l=1.-min(min(g.x,g.y),1.);c=mix(c,uGrid,l*.6);}
 vec3 col=mix(c*d,c,uEm);
 float f=clamp(length(vW-uCam)/30.,0.,1.);col=mix(col,uFog,f*f*.8);
 o=vec4(col,1.);}`;
  const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Шейдер: '+gl.getShaderInfoLog(s));return s;};
  const prog=gl.createProgram();
  gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));
  gl.bindAttribLocation(prog,0,'aPos');gl.bindAttribLocation(prog,1,'aNor');gl.bindAttribLocation(prog,2,'aUV');
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error('Шейдер: '+gl.getProgramInfoLog(prog));
  const U={};
  for(const n of['uProj','uView','uModel','uCol','uEm','uMode','uPS','uUV','uTex','uCam','uGrid','uFog'])U[n]=gl.getUniformLocation(prog,n);

  function attrib(){
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,32,12);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,32,24);
  }
  function mkMesh(data,mode){
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
    attrib();gl.bindVertexArray(null);
    return{vao,buf,n:(data.length/8)|0,mode:mode===undefined?gl.TRIANGLES:mode};
  }
  function mkDyn(maxFloats,mode){
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,maxFloats*4,gl.DYNAMIC_DRAW);
    attrib();gl.bindVertexArray(null);
    const m={vao,buf,n:0,mode:mode===undefined?gl.TRIANGLES:mode,max:maxFloats};
    m.set=arr=>{const a=arr instanceof Float32Array?arr:new Float32Array(arr);const len=Math.min(a.length,maxFloats);gl.bindBuffer(gl.ARRAY_BUFFER,buf);if(len)gl.bufferSubData(gl.ARRAY_BUFFER,0,a,0,len);m.n=(len/8)|0;};
    return m;
  }
  function delMesh(m){try{gl.deleteBuffer(m.buf);gl.deleteVertexArray(m.vao);}catch(e){}}

  const mesh={
    cube:mkMesh(G.cube()),sphere:mkMesh(G.sphere()),ball:mkMesh(G.sphere(10,8)),quad:mkMesh(G.quad()),disc:mkMesh(G.disc()),
    circle:mkMesh(G.circle(),gl.LINE_STRIP),stars:mkMesh(G.stars(700,70),gl.POINTS),
    cyl:mkMesh(G.cyl()),cone:mkMesh(G.cone())
  };
  for(const k of['tetra','octa','icosa','dodeca']){const vf=G[k+'VF']();mesh[k]=mkMesh(G.poly(vf.V,vf.F));}

  /* ---------- состояние ---------- */
  const E={
    gl,M,TRS,mesh,canvas,rooms:{},room:null,roomId:null,S:{},
    bodies:[],panels:[],ui:[],boxes:[],targets:[],staticTargets:[],statics:[],envStatics:[],roomMeshes:[],conf:[],
    gravity:9.8,bound:5.4,ceil:2.9,open:false,spawn:{x:0,z:1},t:0,
    H:[{},{}],session:null,desk:true,deskInput:false,menuOpen:false,student:null,
    hooks:{},clear:[.04,.06,.12]
  };
  E.mkMesh=mkMesh;E.mkDyn=mkDyn;
  E.roomMesh=(data,mode)=>{const m=mkMesh(data,mode);E.roomMeshes.push(m);return m;};
  E.roomDyn=(max,mode)=>{const m=mkDyn(max,mode);E.roomMeshes.push(m);return m;};

  /* ---------- звук и вибрация ---------- */
  let actx=null;
  E.audio=()=>{try{if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();}catch(e){actx=null;}};
  E.beep=(f,d,type,v)=>{
    try{if(!actx)return;const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime;
      o.type=type||'sine';o.frequency.value=f;g.gain.value=v||.07;o.connect(g);g.connect(actx.destination);o.start();
      g.gain.exponentialRampToValueAtTime(.0001,t+(d||.1));o.stop(t+(d||.1)+.02);}catch(e){}
  };
  E.chime=()=>{E.beep(660,.12,'sine',.06);setTimeout(()=>E.beep(990,.18,'sine',.06),110);};
  E.fanfare=()=>{[523,659,784,1046].forEach((f,i)=>setTimeout(()=>E.beep(f,.18,'triangle',.06),i*120));};
  E.buzz=(h,a,ms)=>{try{const x=h&&h.src&&h.src.gamepad&&h.src.gamepad.hapticActuators&&h.src.gamepad.hapticActuators[0];if(x&&x.pulse)x.pulse(a||.5,ms||40);}catch(e){}};

  /* ---------- панели ---------- */
  function makePanel(o){
    const W=o.res||1024,H=Math.round(W*o.h/o.w);
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const p={w:o.w,h:o.h,pos:(o.pos||[0,1.5,-2]).slice(),yaw:o.yaw||0,W,H,cv,ctx:cv.getContext('2d'),tex:gl.createTexture(),
      draw:o.draw||(()=>{}),show:o.show!==false,btns:[],hover:-1,dirty:true,accent:o.accent||'#3b82f6',bg:o.bg||'#0f1830',
      noBg:!!o.noBg,noHit:!!o.noHit,attach:o.attach||null,model:null,data:o.data||{}};
    p.text=(str,x,y,t)=>{
      t=t||{};const c=p.ctx,size=t.size||40;c.font=(t.bold?'bold ':'')+size+'px sans-serif';c.fillStyle=t.color||'#e8efff';
      c.textAlign=t.align||'left';c.textBaseline='top';const lh=t.lh||Math.round(size*1.25);
      const maxW=t.maxW||(t.align==='center'?p.W-60:p.W-x-36);let yy=y;
      for(const para of String(str).split('\n')){for(const ln of wrap(c,para,maxW)){if(t.maxY&&yy+lh>t.maxY)break;c.fillText(ln,x,yy);yy+=lh;}}
      c.textAlign='left';return yy;
    };
    p.area=(x,y,w,h,fn,dis)=>{const i=p.btns.length;p.btns.push({x,y,w,h,fn,disabled:!!dis});return p.hover===i&&!dis;};
    p.button=(x,y,w,h,label,fn,t)=>{
      t=t||{};const c=p.ctx,hov=p.area(x,y,w,h,fn,t.disabled);
      c.fillStyle=t.disabled?'#283250':(t.active?(t.activeBg||'#16a34a'):(t.bg||'#2563eb'));rrect(c,x,y,w,h,t.r||18);c.fill();
      if(hov){c.fillStyle='rgba(255,255,255,.22)';rrect(c,x,y,w,h,t.r||18);c.fill();c.lineWidth=6;c.strokeStyle='#fff';rrect(c,x+3,y+3,w-6,h-6,t.r||18);c.stroke();}
      let size=t.size||40,lines;
      for(;;){c.font='bold '+size+'px sans-serif';lines=wrap(c,label,w-28);const tooWide=lines.some(l=>c.measureText(l).width>w-16);if((lines.length*size*1.15<=h-12&&!tooWide)||size<=18)break;size-=2;}
      c.fillStyle=t.disabled?'#7d88a8':(t.fg||'#fff');c.textAlign='center';c.textBaseline='middle';
      const lh=size*1.15;let yy=y+h/2-(lines.length-1)*lh/2;for(const l of lines){c.fillText(l,x+w/2,yy);yy+=lh;}
      c.textAlign='left';c.textBaseline='top';
    };
    p.setPose=(pos,yaw)=>{p.pos=pos.slice();p.yaw=yaw;p.model=null;};
    p.refresh=()=>{p.dirty=true;};
    return p;
  }
  function paint(p){
    const c=p.ctx;p.btns=[];
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,p.W,p.H);c.textBaseline='top';
    if(!p.noBg){c.fillStyle=p.bg;rrect(c,0,0,p.W,p.H,34);c.fill();c.lineWidth=8;c.strokeStyle=p.accent;rrect(c,4,4,p.W-8,p.H-8,30);c.stroke();}
    try{p.draw(c,p);}catch(e){try{console.log('panel draw error',e);}catch(_){}}
    gl.bindTexture(gl.TEXTURE_2D,p.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,p.cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    p.dirty=false;
  }
  E.paint=paint;
  /* ---------- текстуры и модели (Б51) ---------- */
  const texCache={},modelCache={};
  function glTex(src,repeat){
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    const w=repeat?gl.REPEAT:gl.CLAMP_TO_EDGE;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,w);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,w);
    return t;
  }
  /* нарисованная кодом текстура по имени (дерево, кирпич, трава…), с повтором */
  E.tex=name=>{if(texCache[name]!==undefined)return texCache[name];
    if(/^up:[0-9a-f]{12}$/.test(name)){/* текстура учителя: сразу серая заглушка, настоящая подставляется в тот же объект после загрузки */
      const c1=document.createElement('canvas');c1.width=c1.height=1;const g1=c1.getContext('2d');g1.fillStyle='#888';g1.fillRect(0,0,1,1);
      const t=texCache[name]=glTex(c1,true);
      VR.Store.getAsset(name,1024*1024).then(buf=>createImageBitmap(new Blob([buf]))).then(bm=>{if(bm.width>1024||bm.height>1024)throw 0;gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bm);gl.generateMipmap(gl.TEXTURE_2D);if(bm.close)bm.close();}).catch(()=>{});
      return t;}
    const cv=VR.assets&&VR.assets.proc(name);return texCache[name]=cv?glTex(cv,true):null;};
  /* модель .glb из папки assets/: Promise → {parts:[{m,color,tex}],min,max,tris}; одна и та же модель грузится один раз */
  E.loadModel=url=>{
    if(modelCache[url])return modelCache[url];
    return modelCache[url]=(async()=>{
      const buf=await VR.Store.getAsset(url,VR.assets.LIM.bytes),g=VR.assets.parseGLB(buf);
      const parts=g.parts.map(p=>{const o={m:mkMesh(Array.from(p.verts)),color:p.color,tex:null};
        if(p.image&&typeof createImageBitmap==='function')createImageBitmap(new Blob([p.image.bytes],{type:p.image.mime})).then(bm=>{o.tex=glTex(bm,false);}).catch(()=>{});
        return o;});
      return{parts,min:g.min,max:g.max,tris:g.tris};
    })().catch(e=>{delete modelCache[url];throw e;});
  };
  /* поставить загруженную модель: низ — на высоте y, высота — h метров, поворот yaw; возвращает список статичных частей */
  E.addModel=(g,x,y,z,h,yaw)=>{
    const hh=(g.max[1]-g.min[1])||1,k=h/hh,cx=(g.min[0]+g.max[0])/2,cz=(g.min[2]+g.max[2])/2;
    const base=M.mul(M.trans(x,y,z),M.mul(M.rotY(yaw||0),M.mul(M.scale(k,k,k),M.trans(-cx,-g.min[1],-cz))));
    return g.parts.map(p=>{
      const s={m:p.m,model:base,col:p.color,em:0,mode:p.tex?4:0,tex:p.tex,uv:1,_p:p};
      Object.defineProperty(s,'tex',{get(){return p.tex;}});Object.defineProperty(s,'mode',{get(){return p.tex?4:0;}});
      E.statics.push(s);return s;});
  };
  /* ---------- звуки из файлов (Б51): wav/ogg/mp3 из assets/, до 1 МБ; объёмный звук от места в комнате ---------- */
  const sndCache={},playing=new Set();
  E.loadSound=url=>{
    if(sndCache[url])return sndCache[url];
    return sndCache[url]=(async()=>{
      E.audio();if(!actx)throw new Error('Звук недоступен в этом браузере.');
      const buf=await VR.Store.getAsset(url,1024*1024);
      return await new Promise((ok,no)=>{try{actx.decodeAudioData(buf,ok,()=>no(new Error('Не удалось прочитать звук.')));}catch(e){no(e);}});
    })().catch(e=>{delete sndCache[url];throw e;});
  };
  /* o: {pos:[x,y,z], loop, vol}; возвращает объект с stop(); циклические звуки умолкают при смене комнаты */
  E.playSound=(buf,o)=>{
    o=o||{};if(!actx||!buf)return{stop(){}};
    const src=actx.createBufferSource(),g=actx.createGain();src.buffer=buf;src.loop=!!o.loop;g.gain.value=Math.max(0,Math.min(1,o.vol===undefined?.8:o.vol));
    let node=g;
    if(o.pos&&actx.createPanner){const p=actx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=1.2;p.rolloffFactor=1.2;
      if(p.positionX){p.positionX.value=o.pos[0];p.positionY.value=o.pos[1];p.positionZ.value=o.pos[2];}else p.setPosition(o.pos[0],o.pos[1],o.pos[2]);
      g.connect(p);node=p;}
    src.connect(g);node.connect(actx.destination);
    const h={src,loop:!!o.loop,stop(){try{src.stop();}catch(e){}playing.delete(h);}};
    src.onended=()=>playing.delete(h);playing.add(h);try{src.start();}catch(e){}return h;
  };
  E.stopSounds=()=>{for(const h of Array.from(playing))if(h.loop)h.stop();};
  function listen(){
    if(!actx||!actx.listener||!playing.size)return;
    const h=E.headPose(),l=actx.listener;
    try{if(l.positionX){l.positionX.value=h.pos[0];l.positionY.value=h.pos[1];l.positionZ.value=h.pos[2];l.forwardX.value=h.f[0];l.forwardY.value=0;l.forwardZ.value=h.f[1];l.upX.value=0;l.upY.value=1;l.upZ.value=0;}
    else{l.setPosition(h.pos[0],h.pos[1],h.pos[2]);l.setOrientation(h.f[0],0,h.f[1],0,1,0);}}catch(e){}
  }
  E.addPanel=o=>{const p=makePanel(o);E.panels.push(p);return p;};
  E.addUi=o=>{const p=makePanel(o);E.ui.push(p);return p;};
  const panelModel=p=>p.model||(p.model=TRS(p.pos[0],p.pos[1],p.pos[2],p.w,p.h,1,p.yaw));
  function rayPanel(p,o,d){
    const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
    const rx=o[0]-p.pos[0],ry=o[1]-p.pos[1],rz=o[2]-p.pos[2];
    const lox=c*rx-s*rz,loz=s*rx+c*rz,ldx=c*d[0]-s*d[2],ldz=s*d[0]+c*d[2];
    if(ldz>-1e-4||loz<=0)return null;
    const t=-loz/ldz,x=lox+ldx*t,y=ry+d[1]*t;
    if(Math.abs(x)>p.w/2||Math.abs(y)>p.h/2)return null;
    return{t,px:(x/p.w+.5)*p.W,py:(.5-y/p.h)*p.H};
  }
  E.rayPanel=rayPanel;
  const btnAt=(p,x,y)=>{for(let i=p.btns.length-1;i>=0;i--){const b=p.btns[i];if(!b.disabled&&x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)return i;}return -1;};

  /* ---------- служебные панели: меню, всплывающее сообщение, часы на руке ---------- */
  const toast=E.addUi({w:1.15,h:.3,res:1024,show:false,noHit:true,accent:'#facc15',draw:(c,p)=>{
    p.text(p.data.text||'',p.W/2,p.H/2-30-(p.data.lines-1)*26,{size:48,bold:true,align:'center',color:p.data.color||'#fff'});
  }});
  const toastEl=document.getElementById('toastBox');let toastT=0;
  E.toast=(text,color)=>{
    /* за столом (не в шлеме) сообщение — плашка внизу экрана на 5 секунд: меню и предметы её не закрывают */
    if(!E.session&&toastEl&&toastEl.classList){toastEl.textContent=text;toastEl.style.color=color||'#fff';toastEl.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{toastEl.hidden=true;},5000);return;}
    const c=toast.ctx;c.font='bold 48px sans-serif';toast.data.lines=Math.min(3,wrap(c,text,toast.W-60).length);
    toast.data.text=text;toast.data.color=color;toast.data.until=E.t+3.5;toast.show=true;toast.dirty=true;placeFront(toast,1.25,-.32);
  };
  const menu=E.addUi({w:1.25,h:1.4,res:900,show:false,accent:'#38bdf8',draw:(c,p)=>{if(E.hooks.menuDraw)E.hooks.menuDraw(c,p);}});
  E.menu=menu;
  E.toggleMenu=v=>{
    E.menuOpen=v===undefined?!E.menuOpen:!!v;menu.show=E.menuOpen;menu.dirty=true;
    if(E.menuOpen){placeFront(menu,1.0,-.12);E.beep(520,.06);}
  };
  const hud=E.addUi({w:.2,h:.1,res:512,attach:'left',noHit:true,accent:'#38bdf8',draw:(c,p)=>{
    const t=E.hooks.hud?E.hooks.hud():{a:'',b:''};
    p.text(t.a||'',24,22,{size:64,bold:true,color:t.alert?'#f87171':'#fff'});
    p.text(t.b||'',24,118,{size:56,color:'#b8c7ea'});
  }});
  E.hud=hud;

  /* ---------- предметы ---------- */
  E.addBody=o=>{
    const b={shape:o.shape||'cube',mesh:o.mesh||null,p:o.p.slice(),v:[0,0,0],s:o.s||.14,col:o.col||[.8,.8,.8],em:o.em||.1,
      m:M.id(),held:null,by:'',off:null,data:o.data||{},born:E.t};
    E.bodies.push(b);return b;
  };
  E.removeBody=b=>{const i=E.bodies.indexOf(b);if(i>=0)E.bodies.splice(i,1);for(const h of E.H)if(h.held===b)h.held=null;};
  E.addBox=b=>{E.boxes.push(b);return b;};
  E.addStatic=(m,model,col,em,mode,tex,uv)=>{const s={m,model,col,em:em||0,mode:mode||0,tex:tex||null,uv:uv||1};E.statics.push(s);return s;};
  E.addTable=(x,z,hx,hz,top,col,tex,uv)=>{
    E.addStatic(mesh.cube,TRS(x,top-.03,z,hx*2,.06,hz*2),tex?[1,1,1]:(col||[.45,.3,.2]),0,tex?4:0,tex||null,uv||1);
    for(const sx of[-1,1])for(const sz of[-1,1])E.addStatic(mesh.cube,TRS(x+sx*(hx-.06),(top-.06)/2,z+sz*(hz-.06),.06,top-.06,.06),[.25,.2,.16]);
    E.tables.push({x,z,hx,hz,top});
    return E.addBox({x,z,hx,hz,top});
  };
  /* кнопка «Сбросить стенд» стоит на каждом столе у переднего края, чтобы предметы, улетевшие со стола, возвращались одним нажатием */
  function addResetButtons(){
    for(const t of E.tables.slice(0,3)){if(t.hx<.3)continue;
      E.addPanel({w:.34,h:.1,res:340,pos:[t.x+t.hx-.2,t.top+.055,t.z+t.hz-.04],yaw:0,accent:'#64748b',draw:(c,p)=>{p.button(4,4,p.W-8,p.H-8,'Сбросить стенд',()=>E.resetStand(),{bg:'#475569',size:30});}});}
  }
  E.burst=(pos,n,cols,sp)=>{
    sp=sp||1;cols=cols||[[1,.3,.3],[.3,1,.4],[.3,.5,1],[1,.85,.2],[.9,.4,1]];
    for(let i=0;i<n;i++){
      if(E.conf.length>=160)E.conf.shift();
      const a=Math.random()*6.283,s=(.6+Math.random())*sp;
      E.conf.push({p:pos.slice(),v:[Math.cos(a)*s*.6,(1.5+Math.random()*1.5)*sp,Math.sin(a)*s*.6],col:cols[(Math.random()*cols.length)|0],life:1.6,g:6,size:.035});
    }
  };
  E.particle=(p,v,col,life,size,g)=>{if(E.conf.length>=160)E.conf.shift();E.conf.push({p:p.slice(),v:v.slice(),col,life,g:g||0,size:size||.04});};

  /* открытия: +2 балла за каждое новое */
  const guestDisc=new Set();
  E.discover=(subj,key,label)=>{
    let isNew=false;
    if(E.student&&E.student.id&&VR.Store)isNew=VR.Store.addDiscovery(E.student.id,subj,key);
    else if(!guestDisc.has(subj+key)){guestDisc.add(subj+key);isNew=true;}
    if(isNew){E.toast('Открытие: '+label+'  +2 балла','#fde68a');E.chime();menu.dirty=true;hud.dirty=true;}
    return isNew;
  };
  E.resetGuest=()=>guestDisc.clear();

  /* двери между комнатами */
  E.door=(x,z,yaw,roomId,label,color)=>{
    const col=hex(color),c=Math.cos(yaw),s=Math.sin(yaw);
    const R=(lx,ly,lz)=>[x+c*lx+s*lz,ly,z-s*lx+c*lz];
    for(const sx of[-.65,.65]){const q=R(sx,1.15,0);E.addStatic(mesh.cube,TRS(q[0],q[1],q[2],.12,2.3,.12,yaw),col,.6);}
    let q=R(0,2.3,0);E.addStatic(mesh.cube,TRS(q[0],q[1],q[2],1.42,.12,.12,yaw),col,.6);
    q=R(0,1.12,.02);E.addStatic(mesh.quad,TRS(q[0],q[1],q[2],1.18,2.2,1,yaw),[col[0]*.35,col[1]*.35,col[2]*.35+.05],.7);
    q=R(0,2.68,.03);
    E.addPanel({w:1.6,h:.42,pos:q,yaw,accent:color,draw:(cc,p)=>{p.text(label,p.W/2,p.H/2-38,{size:62,bold:true,align:'center'});}});
    const tc=R(0,1.2,.15);
    const t={c:tc,r:.8,id:'door-'+roomId,sel:()=>E.goRoom(roomId)};E.staticTargets.push(t);return t;
  };

  /* ---------- комнаты ---------- */
  E.loadRoom=id=>{
    const R=E.rooms[id];if(!R)return;
    if(E.room&&E.room.leave)try{E.room.leave(E,E.S);}catch(e){}
    for(const p of E.panels)try{gl.deleteTexture(p.tex);}catch(e){}
    for(const m of E.roomMeshes)delMesh(m);
    E.stopSounds();
    E.tables=[];E.panels=[];E.bodies=[];E.boxes=[];E.targets=[];E.staticTargets=[];E.statics=[];E.envStatics=[];E.roomMeshes=[];E.conf=[];
    E.gravity=9.8;for(const h of E.H){h.held=null;h.hit=null;}
    E.room=R;E.roomId=id;E.S={};
    const env=R.env||{};E.open=!!env.open;E.clear=env.open?[.01,.012,.03]:[.04,.06,.12];E.grid=env.grid||[.25,.55,.9];
    buildEnv(env);
    E.spawn=R.spawn||{x:0,z:-.5};
    R.build(E,E.S);
    addResetButtons();
    E.toggleMenu(false);
    respawn();
    if(E.hooks.onRoom)E.hooks.onRoom(id);
  };
  E.goRoom=id=>{E.beep(440,.08);E.beep(660,.12);E.loadRoom(id);const R=E.rooms[id];if(R&&R.hint)E.toast(R.hint);};
  function buildEnv(env){
    const S=E.envStatics,fl=env.floor||[.07,.1,.18];
    if(env.open){
      S.push({m:mesh.disc,model:TRS(0,0,0,5.7,1,5.7),col:fl,em:0,mode:0});
      S.push({m:mesh.circle,model:TRS(0,.01,0,5.7,1,5.7),col:env.trim||[.3,.7,1],em:1,mode:3});
      S.push({m:mesh.stars,model:M.id(),col:[1,1,1],em:1,mode:3,ps:2});
      return;
    }
    const w=env.wall||[.12,.17,.3],tr=env.trim||[.2,.7,1];
    S.push({m:mesh.quad,model:M.mul(M.rotX(-Math.PI/2),M.scale(12,12,1)),col:fl,em:0,mode:2});
    S.push({m:mesh.quad,model:M.mul(M.trans(0,3,0),M.mul(M.rotX(Math.PI/2),M.scale(12,12,1))),col:[w[0]*.6,w[1]*.6,w[2]*.6],em:0,mode:0});
    for(const [x,z,sx,sz] of[[0,-6,12,.2],[0,6,12,.2],[6,0,.2,12],[-6,0,.2,12]]){
      S.push({m:mesh.cube,model:TRS(x,1.5,z,sx,3,sz),col:w,em:0,mode:0});
      S.push({m:mesh.cube,model:TRS(x*.985,2.95,z*.985,sx>1?12:.25,.05,sz>1?12:.25),col:tr,em:1,mode:0});
      S.push({m:mesh.cube,model:TRS(x*.985,.05,z*.985,sx>1?12:.25,.1,sz>1?12:.25),col:[tr[0]*.5,tr[1]*.5,tr[2]*.5],em:.6,mode:0});
    }
  }

  /* ---------- игрок: мир = поворот(yaw)·реальная комната + сдвиг ---------- */
  let baseRef=null,refSpace=null,curFrame=null,moved=false;
  const P={yaw:0,tx:0,tz:0};
  const D={x:0,z:1,yaw:0,pitch:-.08,h:1.6,jy:0,jv:0};/* h — высота глаз (присед ниже), jy — высота прыжка */
  const eyeY=()=>D.h+D.jy;
  const R2=(yaw,x,z)=>[x*Math.cos(yaw)+z*Math.sin(yaw),-x*Math.sin(yaw)+z*Math.cos(yaw)];
  function applyPlayer(){
    if(!baseRef)return;
    const c=Math.cos(P.yaw),s=Math.sin(P.yaw),px=P.tx*c-P.tz*s,pz=P.tx*s+P.tz*c;
    refSpace=baseRef.getOffsetReferenceSpace(new XRRigidTransform({x:-px,y:0,z:-pz,w:1},{x:0,y:-Math.sin(P.yaw/2),z:0,w:Math.cos(P.yaw/2)}));
  }
  const headBase=()=>{const vp=curFrame&&baseRef&&curFrame.getViewerPose(baseRef);return vp?vp.transform.position:{x:0,z:0};};
  const headWorld=()=>{const vp=curFrame&&refSpace&&curFrame.getViewerPose(refSpace);return vp?vp.transform.position:{x:P.tx,z:P.tz};};
  function teleportTo(x,z){const h=headBase(),r=R2(P.yaw,h.x,h.z);P.tx=x-r[0];P.tz=z-r[1];applyPlayer();moved=true;}
  function turnBy(d){const hw=headWorld(),h=headBase();P.yaw+=d;const r=R2(P.yaw,h.x,h.z);P.tx=hw.x-r[0];P.tz=hw.z-r[1];applyPlayer();moved=true;}
  /* стик назад — шаг назад на полметра (против взгляда), не выходя за стены и мебель */
  function stepBack(){
    const hw=headWorld(),f=E.headPose().f,x=hw.x-f[0]*.5,z=hw.z-f[1]*.5;
    const inside=E.open?Math.hypot(x,z)<5.3:(Math.abs(x)<E.bound&&Math.abs(z)<E.bound);
    if(inside&&!E.boxes.some(b=>Math.abs(x-b.x)<b.hx+.3&&Math.abs(z-b.z)<b.hz+.3)){teleportTo(x,z);E.beep(420,.05,'sine',.03);}
  }
  function respawn(){
    D.x=E.spawn.x;D.z=E.spawn.z;D.yaw=0;D.pitch=-.08;D.h=1.6;D.jy=0;D.jv=0;
    if(E.session&&baseRef){P.yaw=0;teleportTo(E.spawn.x,E.spawn.z);}
  }
  E.respawn=respawn;E.player=P;E.deskCam=D;
  /* текущее место и поворот игрока и возврат на него: редактор пересобирает комнату после каждой правки, а человек остаётся где стоял */
  E.poseNow=()=>{if(E.session&&baseRef){const w=headWorld();return{x:w.x,z:w.z,yaw:P.yaw};}return{x:D.x,z:D.z,yaw:D.yaw};};
  E.setPose=(x,z,yaw)=>{if(E.session&&baseRef){P.yaw=yaw;teleportTo(x,z);}else{D.x=x;D.z=z;D.yaw=yaw;}};
  E.headPose=()=>{
    if(E.session&&curFrame&&refSpace){const vp=curFrame.getViewerPose(refSpace);if(vp){const m=vp.transform.matrix;const fx=-m[8],fz=-m[10],l=Math.hypot(fx,fz)||1;return{pos:[m[12],m[13],m[14]],f:[fx/l,fz/l]};}}
    return{pos:[D.x,eyeY(),D.z],f:[-Math.sin(D.yaw),-Math.cos(D.yaw)]};
  };
  function placeFront(p,dist,dy){const h=E.headPose();p.setPose([h.pos[0]+h.f[0]*dist,h.pos[1]+dy,h.pos[2]+h.f[1]*dist],Math.atan2(-h.f[0],-h.f[1]));}
  E.placeFront=placeFront;

  /* ---------- руки и ввод ---------- */
  const H=E.H;
  const pressed=(gp,i)=>!!(gp&&gp.buttons&&gp.buttons[i]&&gp.buttons[i].pressed);
  function setHand(h,g,r,src,gp,dt,withVel){
    h.has=true;h.src=src;h.gp=gp;h.g=g;h.r=r;
    h.ro=[r[12],r[13],r[14]];h.rd=norm3([-r[8],-r[9],-r[10]]);
    const pos=[g[12],g[13],g[14]];
    if(withVel&&h.prev&&!h.skipVel&&dt>0){const v=[(pos[0]-h.prev[0])/dt,(pos[1]-h.prev[1])/dt,(pos[2]-h.prev[2])/dt],o=h.vel||[0,0,0];h.vel=[o[0]*.5+v[0]*.5,o[1]*.5+v[1]*.5,o[2]*.5+v[2]*.5];}
    else if(!h.vel||h.skipVel)h.vel=[0,0,0];
    h.prev=pos;h.skipVel=false;
  }
  function readXR(frame,dt,withVel){
    for(const h of H)h.has=false;
    for(const src of E.session.inputSources){
      if(!src.gripSpace||!src.targetRaySpace)continue;
      const h=H[src.handedness==='left'?0:1];
      const gp=frame.getPose(src.gripSpace,refSpace),rp=frame.getPose(src.targetRaySpace,refSpace);
      if(!gp||!rp)continue;
      setHand(h,gp.transform.matrix,rp.transform.matrix,src,src.gamepad,dt,withVel);
    }
  }
  const deskPad={buttons:[0,1,2,3,4,5].map(()=>({pressed:false})),axes:[0,0,0,0]};
  let deskClick=false,deskMenu=false,deskGrab=false,mouseL=false,mouseR=false,reach=.5;
  function readDesk(dt){
    H[0].has=false;
    const cam=M.mul(M.trans(D.x,eyeY(),D.z),M.mul(M.rotY(D.yaw),M.rotX(D.pitch)));
    deskPad.buttons[0].pressed=deskClick||mouseL;deskClick=false;
    deskPad.buttons[1].pressed=deskGrab||mouseR;
    if(!H[1].held)reach=.5;
    deskPad.buttons[4].pressed=deskMenu;deskMenu=false;
    setHand(H[1],M.mul(cam,M.trans(.14,-.16,-reach)),cam,null,E.deskInput?deskPad:null,dt,true);
  }
  function nearestBody(pos,maxD){
    let best=null,bd=maxD;
    for(const b of E.bodies){if(b.held!==null||b.fixed)continue;const d=dist3(pos,b.p);if(d<bd){best=b;bd=d;}}
    return best;
  }
  /* предмет под перекрестием (рабочий стол): луч из центра экрана, ближе любых панелей и целей */
  function bodyOnRay(h,maxT){
    let best=null,bt=maxT;
    for(const b of E.bodies){if(b.held!==null||b.fixed)continue;const t=raySphere(h.ro,h.rd,b.p,Math.max(.12,b.s*.9));if(t!==null&&t<bt){best=b;bt=t;}}
    if(best){const r=rayHit(h);if(r&&r.t<bt)return null;}
    return best;
  }
  function release(h){
    const b=h.held;if(!b)return;
    /* с экрана (мышь) предмет не бросают рывком: скорость руки берётся от движения взгляда и была бы случайной — кладём мягко */
    const v=h.vel||[0,0,0],sp=Math.hypot(v[0],v[1],v[2]),lim=E.session?10:1.2,k=sp>lim?lim/sp:1;
    b.v=[v[0]*k,v[1]*k,v[2]*k];b.held=null;h.held=null;E.beep(300,.05);
    if(E.room&&E.room.onRelease)try{E.room.onRelease(E,E.S,b,sp*k);}catch(e){}
  }
  function raySphere(o,d,c,r){
    const ox=o[0]-c[0],oy=o[1]-c[1],oz=o[2]-c[2],b=ox*d[0]+oy*d[1]+oz*d[2],cc=ox*ox+oy*oy+oz*oz-r*r,disc=b*b-cc;
    if(disc<0)return null;const t=-b-Math.sqrt(disc);return t>0?t:null;
  }
  function rayHit(h){
    let best=null;
    for(const p of E.ui)if(p.show&&!p.noHit){const r=rayPanel(p,h.ro,h.rd);if(r&&(!best||r.t<best.t))best={t:r.t,kind:'panel',p,bi:btnAt(p,r.px,r.py)};}
    if(!(best&&best.p===menu))for(const p of E.panels)if(p.show&&!p.noHit){const r=rayPanel(p,h.ro,h.rd);if(r&&(!best||r.t<best.t))best={t:r.t,kind:'panel',p,bi:btnAt(p,r.px,r.py)};}
    if(!(best&&best.p===menu))for(const tg of E.targets){const t=raySphere(h.ro,h.rd,tg.c,tg.r);if(t!==null&&(!best||t<best.t))best={t,kind:'target',tg};}
    return best;
  }
  E.rayHit=rayHit;
  function aimTeleport(h){
    h.tp=null;const o=h.ro,d=h.rd;
    if(d[1]<-.05){const t=-o[1]/d[1];if(t>0&&t<12){const x=o[0]+d[0]*t,z=o[2]+d[2]*t;
      const inside=E.open?Math.hypot(x,z)<5.3:(Math.abs(x)<E.bound&&Math.abs(z)<E.bound);
      h.tp={x,z,valid:inside&&!E.boxes.some(b=>Math.abs(x-b.x)<b.hx+.4&&Math.abs(z-b.z)<b.hz+.4)};}}
  }
  function handleInput(){
    for(let hi=0;hi<2;hi++){
      const h=H[hi];
      if(!h.has){if(h.held)release(h);h.aim=false;h.tp=null;h.hit=null;continue;}
      const gp=h.gp,ok=gp&&gp.axes&&gp.axes.length>=4,ax=ok?gp.axes[2]:0,ay=ok?gp.axes[3]:0;
      const trig=pressed(gp,0),sq=pressed(gp,1),mb=pressed(gp,4)||pressed(gp,5);
      const trigDown=trig&&!h.trigPrev,sqDown=sq&&!h.sqPrev,mbDown=mb&&!h.mbPrev;
      h.trigPrev=trig;h.sqPrev=sq;h.mbPrev=mb;
      if(mbDown)E.toggleMenu();
      const gpos=[h.g[12],h.g[13],h.g[14]];let used=false;
      if(!h.held&&(trigDown||sqDown)){
        let b=nearestBody(gpos,E.session?.22:.42);
        if(!b&&!E.session&&hi===1)b=bodyOnRay(h,3);
        if(b){b.held=hi;b.by=sqDown?'sq':'trig';b.off=M.mul(M.inv(h.g),M.mul(M.trans(b.p[0],b.p[1],b.p[2]),b.m));h.held=b;used=true;E.buzz(h,.4,30);E.beep(520,.06);
          if(E.room&&E.room.onGrab)try{E.room.onGrab(E,E.S,b);}catch(e){}}
      }
      if(h.held&&!(h.held.by==='sq'?sq:trig))release(h);
      h.hit=(h.held||h.aim)?null:rayHit(h);
      if(trigDown&&!used&&!h.aim&&h.hit){
        if(h.hit.kind==='panel'){if(h.hit.bi>=0){const p=h.hit.p,b=p.btns[h.hit.bi];E.beep(880,.04,'square',.03);E.buzz(h,.3,25);p.dirty=true;try{b.fn(h);}catch(e){try{console.log('button error',e);}catch(_){}}}}
        else{try{h.hit.tg.sel(h);}catch(e){try{console.log('target error',e);}catch(_){}}}
      }
      if(!E.session)continue;
      if(!h.held){
        if(ay<-.6){h.aim=true;aimTeleport(h);}
        else if(h.aim&&ay>-.25){if(h.tp&&h.tp.valid){teleportTo(h.tp.x,h.tp.z);E.beep(660,.08);E.buzz(h,.3,30);}h.aim=false;h.tp=null;}
      }else{h.aim=false;h.tp=null;}
      if(ay>.7&&!h.held&&!h.stepLock){h.stepLock=true;stepBack();}else if(ay<.3)h.stepLock=false;
      if(Math.abs(ax)>.7&&!h.turnLock){h.turnLock=true;turnBy(ax>0?-Math.PI/6:Math.PI/6);}
      else if(Math.abs(ax)<.3)h.turnLock=false;
    }
  }

  /* ---------- физика ---------- */
  function stepBody(b,dt){
    if(b.fixed)return;
    if(b.held!==null){
      const h=H[b.held];
      if(h&&h.has){const m=M.mul(h.g,b.off);b.p=[m[12],m[13],m[14]];m[12]=m[13]=m[14]=0;b.m=m;b.v=[0,0,0];}
      return;
    }
    const hs=b.s/2,prevY=b.p[1],g=E.gravity;
    b.v[1]-=g*dt;
    if(g===0){b.v[0]*=.998;b.v[1]*=.998;b.v[2]*=.998;b.m=M.mul(M.rotY(dt*.6),b.m);}
    for(let k=0;k<3;k++)b.p[k]+=b.v[k]*dt;
    for(const bx of E.boxes){
      const dx=bx.hx+hs-Math.abs(b.p[0]-bx.x),dz=bx.hz+hs-Math.abs(b.p[2]-bx.z);
      if(dx>0&&dz>0&&b.p[1]<bx.top+hs&&b.p[1]>-1){
        if(prevY>=bx.top+hs-.03){b.p[1]=bx.top+hs;if(b.v[1]<0)b.v[1]=Math.abs(b.v[1])<.6?0:-b.v[1]*(b.shape==='ball'?.6:.25);b.v[0]*=.9;b.v[2]*=.9;}
        else if(dx<dz){b.p[0]+=(b.p[0]>=bx.x?1:-1)*dx;b.v[0]*=-.3;}
        else{b.p[2]+=(b.p[2]>=bx.z?1:-1)*dz;b.v[2]*=-.3;}
      }
    }
    if(b.p[1]<hs){
      b.p[1]=hs;
      if(b.v[1]<0)b.v[1]=Math.abs(b.v[1])<.6&&g>0?0:-b.v[1]*(b.shape==='ball'?.7:.3);
      b.v[0]*=.85;b.v[2]*=.85;
      if(b.shape==='cube'&&g>0)b.m=M.rotY(Math.atan2(b.m[8],b.m[0]));
    }
    if(!E.open&&b.p[1]>E.ceil-hs){b.p[1]=E.ceil-hs;if(b.v[1]>0)b.v[1]*=-.5;}
    const lim=(E.open?5.6:5.8)-hs;
    if(b.p[0]>lim){b.p[0]=lim;b.v[0]*=-.5;}if(b.p[0]<-lim){b.p[0]=-lim;b.v[0]*=-.5;}
    if(b.p[2]>lim){b.p[2]=lim;b.v[2]*=-.5;}if(b.p[2]<-lim){b.p[2]=-lim;b.v[2]*=-.5;}
    if(E.open&&b.p[1]>8){b.p[1]=8;b.v[1]=-Math.abs(b.v[1])*.5;}
  }

  /* ---------- общий шаг кадра ---------- */
  let hudT=0;
  function step(dt){
    E.t+=dt;
    if(E.deskInput||E.session)handleInput();
    else for(const h of H)h.hit=null;
    E.targets=E.room&&E.room.targets?E.staticTargets.concat(E.room.targets(E,E.S)):E.staticTargets;
    if(E.room&&E.room.update)try{E.room.update(E,E.S,dt);}catch(e){try{console.log('room update error',e);}catch(_){}}
    for(const b of E.bodies)stepBody(b,dt);
    for(const c of E.conf){c.v[1]-=c.g*dt;for(let k=0;k<3;k++)c.p[k]+=c.v[k]*dt;c.life-=dt;}
    for(let i=E.conf.length-1;i>=0;i--)if(E.conf[i].life<=0||E.conf[i].p[1]<0)E.conf.splice(i,1);
    if(toast.show&&E.t>toast.data.until)toast.show=false;
    hudT+=dt;if(hudT>1){hudT=0;hud.dirty=true;if(E.menuOpen)menu.dirty=true;}
    if(E.hooks.onFrame)try{E.hooks.onFrame(dt);}catch(e){}
    listen();
    const all=E.panels.concat(E.ui);
    for(const p of all)p._h=-1;
    for(const h of H)if(h.has&&h.hit&&h.hit.kind==='panel')h.hit.p._h=h.hit.bi;
    for(const p of all)if(p._h!==p.hover){p.hover=p._h;p.dirty=true;}
    let budget=E.session?2:4;
    for(const p of E.ui)if(p.dirty&&p.show&&budget>0&&!(p.attach&&!E.session)){paint(p);budget--;}
    for(const p of E.panels)if(p.dirty&&p.show&&budget>0){paint(p);budget--;}
  }

  /* ---------- отрисовка ---------- */
  let L=[];
  const add=(m,model,col,em,mode,tex,ps,uv)=>{L.push({m,model,col,em:em||0,mode:mode||0,tex:tex||null,ps:ps||1,uv:uv||1});};
  E.add=add;
  function buildDraw(head){
    L=[];
    for(const s of E.envStatics)L.push(s);
    for(const s of E.statics)L.push(s);
    if(E.room&&E.room.draw)try{E.room.draw(E,E.S,add);}catch(e){try{console.log('room draw error',e);}catch(_){}}
    for(const b of E.bodies)add(b.mesh||(b.shape==='cube'?mesh.cube:mesh.ball),M.mul(M.trans(b.p[0],b.p[1],b.p[2]),M.mul(b.m,M.scale(b.s,b.s,b.s))),b.col,b.em);
    for(const c of E.conf)add(mesh.cube,TRS(c.p[0],c.p[1],c.p[2],c.size,c.size,c.size,c.life*5),c.col,.8);
    for(let hi=0;hi<2;hi++){
      const h=H[hi];if(!h.has)continue;
      if(E.session){
        if(VR.controllers)VR.controllers.draw(add,mesh,h,hi,E.ctlOpt);
        else add(mesh.cube,M.mul(h.g,M.mul(M.trans(0,0,.04),M.scale(.045,.035,.13))),hi?[.95,.55,.2]:[.3,.55,1],.2);
        let len=2.5,col=[.6,.8,1];
        if(h.aim){col=h.tp&&h.tp.valid?[.3,1,.8]:[1,.3,.3];len=h.tp?Math.min(12,dist3(h.ro,[h.tp.x,0,h.tp.z])):1.5;if(h.tp)add(mesh.disc,TRS(h.tp.x,.02,h.tp.z,.35,1,.35),col,1);}
        else if(h.hit){len=h.hit.t;col=h.hit.kind==='panel'&&h.hit.bi<0?[.7,.75,.9]:[1,.9,.3];}
        if(!h.held)add(mesh.cube,M.mul(h.r,M.mul(M.trans(0,0,-len/2),M.scale(.004,.004,len))),col,1);
      }
      if(h.hit&&!h.aim){const q=[h.ro[0]+h.rd[0]*h.hit.t,h.ro[1]+h.rd[1]*h.hit.t,h.ro[2]+h.rd[2]*h.hit.t],k=E.session?.025:.012;add(mesh.sphere,TRS(q[0],q[1],q[2],k,k,k),[1,.9,.3],1);}
    }
    for(const p of E.panels)if(p.show)add(mesh.quad,panelModel(p),[1,1,1],0,1,p.tex);
    for(const p of E.ui){
      if(!p.show)continue;
      if(p.attach){
        if(!E.session)continue;const h=H[p.attach==='left'?0:1];if(!h.has)continue;
        add(mesh.quad,M.mul(h.g,M.mul(M.trans(0,.045,.06),M.mul(M.rotX(-Math.PI/4),M.scale(p.w,p.h,1)))),[1,1,1],0,1,p.tex);
      }else add(mesh.quad,panelModel(p),[1,1,1],0,1,p.tex);
    }
  }
  function render(proj,view,cam){
    gl.useProgram(prog);gl.uniform1i(U.uTex,0);
    gl.uniformMatrix4fv(U.uProj,false,proj);gl.uniformMatrix4fv(U.uView,false,view);gl.uniform3fv(U.uCam,cam);
    gl.uniform3fv(U.uGrid,E.grid||[.25,.55,.9]);gl.uniform3fv(U.uFog,E.clear);
    for(const o of L){
      gl.uniformMatrix4fv(U.uModel,false,o.model);gl.uniform3fv(U.uCol,o.col);
      gl.uniform1f(U.uEm,o.em||0);gl.uniform1i(U.uMode,o.mode||0);gl.uniform1f(U.uPS,o.ps||1);gl.uniform1f(U.uUV,o.uv||1);
      if(o.tex){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,o.tex);}
      if(o.m.n>0){gl.bindVertexArray(o.m.vao);gl.drawArrays(o.m.mode,0,o.m.n);}
    }
    gl.bindVertexArray(null);
  }

  /* ---------- VR-режим ---------- */
  let last=0,deskId=0;
  function xrFrame(t,frame){
    if(!E.session)return;
    E.session.requestAnimationFrame(xrFrame);
    curFrame=frame;
    const dt=last?Math.min(.05,(t-last)/1000):.016;last=t;
    readXR(frame,dt,true);
    step(dt);
    if(moved){for(const h of H)h.skipVel=true;readXR(frame,dt,false);moved=false;}
    const vp=frame.getViewerPose(refSpace);if(!vp)return;
    const layer=E.session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.enable(gl.DEPTH_TEST);
    gl.clearColor(E.clear[0],E.clear[1],E.clear[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const hp=vp.transform.position;buildDraw([hp.x,hp.y,hp.z]);
    for(const v of vp.views){const vpt=layer.getViewport(v),p=v.transform.position;gl.viewport(vpt.x,vpt.y,vpt.width,vpt.height);render(v.projectionMatrix,v.transform.inverse.matrix,[p.x,p.y,p.z]);}
  }
  function onEnd(){
    E.session=null;baseRef=null;refSpace=null;curFrame=null;last=0;
    for(const h of H){if(h.held)release(h);h.has=false;h.hit=null;}
    E.toggleMenu(false);
    if(E.hooks.onXREnd)try{E.hooks.onXREnd();}catch(e){}
    E.startDesk();
  }
  E.xrSupported=async()=>{try{return!!(navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr'));}catch(e){return false;}};
  E.enterXR=async()=>{
    E.audio();let s;
    try{s=await navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor']});}
    catch(e){throw new Error('Не удалось войти в VR: '+(e&&e.message||e));}
    try{
      if(gl.makeXRCompatible)await gl.makeXRCompatible();
      s.updateRenderState({baseLayer:new XRWebGLLayer(s,gl)});
      baseRef=await s.requestReferenceSpace('local-floor');
      E.session=s;E.desk=false;deskId++;
      s.addEventListener('end',onEnd);
      P.yaw=0;P.tx=E.spawn.x;P.tz=E.spawn.z;applyPlayer();last=0;
      s.requestAnimationFrame(xrFrame);
    }catch(e){E.session=null;try{s.end();}catch(_){}throw new Error('Ошибка запуска VR: '+(e&&e.message||e));}
  };
  E.exitXR=()=>{if(E.session)try{E.session.end();}catch(e){}};

  /* ---------- режим экрана (ПК / телефон / проверка без шлема) ---------- */
  const keys={};let drag=null,locked=false,lockFail=false,sens=.0022;
  /* сброс всех зажатых клавиш и кнопок: при потере фокуса, уходе со вкладки, отмене указателя */
  const releaseAll=()=>{for(const k in keys)keys[k]=false;drag=null;deskGrab=false;mouseL=mouseR=false;acc.x=acc.y=0;};
  /* накопленное движение мыши: применяется раз за кадр с плавностью, а не событием на каждый пиксель */
  const acc={x:0,y:0},MC={sens:1,smooth:.35,invY:false};
  /* графика (настройки производительности): масштаб разрешения, угол обзора, счётчик fps */
  const PF={scale:1,fov:60,fps:false,walk:.8,ease:true};E.perf=PF;const WV={x:0,z:0};  /* WV — текущая скорость ходьбы */
  E.setPerf=o=>{if(!o)return;if(typeof o.scale==='number'&&isFinite(o.scale))PF.scale=Math.max(.5,Math.min(1.5,o.scale));if(typeof o.fov==='number'&&isFinite(o.fov))PF.fov=Math.max(40,Math.min(100,o.fov));if(typeof o.fps==='boolean')PF.fps=o.fps;if(typeof o.walk==='number'&&isFinite(o.walk))PF.walk=Math.max(.4,Math.min(1.5,o.walk));if(typeof o.ease==='boolean')PF.ease=o.ease;if(E.hooks.onPerf)E.hooks.onPerf();};
  const fpsEl=document.getElementById('fpsBox');let fpsN=0,fpsT=0,fpsMax=0,dtS=.016;
  /* сброс стенда: комната собирается заново (предметы на столе как в начале), игрок остаётся на месте */
  E.resetStand=()=>{if(!E.roomId)return;const keep={x:D.x,z:D.z,yaw:D.yaw,pitch:D.pitch};E.loadRoom(E.roomId);if(E.deskInput&&!E.session)Object.assign(D,keep);E.toast('Стенд сброшен');};
  E.mouseCfg=MC;
  E.setMouseCfg=o=>{if(!o)return;if(typeof o.sens==='number'&&isFinite(o.sens))MC.sens=Math.max(.25,Math.min(3,o.sens));if(typeof o.smooth==='number'&&isFinite(o.smooth))MC.smooth=Math.max(0,Math.min(1,o.smooth));if(typeof o.invY==='boolean')MC.invY=o.invY;};
  /* состояние кнопок берём из маски buttons: при зажатых двух кнопках браузер второго нажатия не присылает, а по маске видно всё */
  const syncButtons=e=>{if(e.pointerType&&e.pointerType!=='mouse')return;if(typeof e.buttons!=='number')return;mouseL=!!(e.buttons&1);mouseR=!!(e.buttons&2);};
  E.releaseInput=releaseAll;
  /* ---- мышь как в шутерах: захват указателя (Pointer Lock), сырое движение, без упора в край экрана ----
     ЛКМ — выбрать / нажать / взять (держать), ПКМ или E — взять (держать), колесо — дальше/ближе, F — полный экран */
  const canLock=!!canvas.requestPointerLock;
  E.mouseLocked=()=>locked;
  /* сначала просим «сырое» движение (без ускорения системы); если браузер отказал — обычный захват; отказ обоих — запасной способ */
  let plainTried=false;
  const plainLock=()=>{plainTried=true;try{const r=canvas.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}};
  E.lockMouse=()=>{
    if(!canLock||locked)return;plainTried=false;
    try{const r=canvas.requestPointerLock({unadjustedMovement:true});if(r&&r.catch)r.catch(()=>{if(!plainTried)plainLock();});}
    catch(e){plainLock();}
  };
  E.unlockMouse=()=>{try{if(document.pointerLockElement)document.exitPointerLock();}catch(e){}};
  E.toggleFullscreen=()=>{
    const d=document,el=d.documentElement;
    try{if(d.fullscreenElement)d.exitFullscreen();else if(el.requestFullscreen){const r=el.requestFullscreen({navigationUI:'hide'});if(r&&r.catch)r.catch(()=>{});}}catch(e){}
    if(E.deskInput)E.lockMouse();
  };
  document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===canvas;if(locked)lockFail=false;else{mouseL=mouseR=false;}if(E.hooks.onLock)try{E.hooks.onLock(locked);}catch(e){}});
  document.addEventListener('pointerlockerror',()=>{if(!plainTried){plainLock();return;}lockFail=true;if(E.hooks.onLock)try{E.hooks.onLock(false,true);}catch(e){}});
  document.addEventListener('mousemove',e=>{
    if(!locked||!E.deskInput)return;
    const dx=e.movementX||0,dy=e.movementY||0;
    if(Math.abs(dx)>600||Math.abs(dy)>600)return;/* редкие скачки драйвера */
    acc.x+=dx;acc.y+=dy;
  });
  /* смена кнопки при другой уже зажатой приходит как pointermove с button>=0 (а не как pointerdown); обычное движение имеет button=-1 и состояние не трогает */
  window.addEventListener('pointermove',e=>{if(e.button>=0)syncButtons(e);},true);
  /* применить накопленное движение за кадр: доля копится по экспоненте, чем больше плавность, тем мягче догоняет взгляд */
  function applyLook(dt){
    if(!acc.x&&!acc.y)return;
    const tau=MC.smooth*.14,k=tau<=0?1:1-Math.exp(-dt/tau),mx=acc.x*k,my=acc.y*k;acc.x-=mx;acc.y-=my;
    if(Math.abs(acc.x)<.05)acc.x=0;if(Math.abs(acc.y)<.05)acc.y=0;
    const s=sens*MC.sens;D.yaw-=mx*s;D.pitch=Math.max(-1.5,Math.min(1.5,D.pitch-(MC.invY?-my:my)*s));
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{if(!locked)return;e.preventDefault();const b=H[1].held;if(b&&b.off){const z=b.off[14],st=Math.max(.06,Math.abs(z)*.12),nz=Math.max(-6,Math.min(-.3,z+Math.sign(e.deltaY)*st));b.off[14]=nz;}},{passive:false});  /* колесо от себя — предмет дальше, на себя — ближе, от любой дальности, где его взяли */
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&canLock&&!lockFail&&E.deskInput){
      if(!locked){if(e.button===0)E.lockMouse();return;}/* первый щелчок только захватывает мышь */
      syncButtons(e);if(!e.buttons){if(e.button===0)mouseL=true;else if(e.button===2)mouseR=true;}
      e.preventDefault();return;
    }
    if(e.button!==0&&e.pointerType==='mouse')return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};try{canvas.setPointerCapture(e.pointerId);}catch(_){}
  });
  /* запасной способ (телефон, мышь без захвата): тянуть пальцем / зажатой кнопкой */
  canvas.addEventListener('pointermove',e=>{
    if(!drag||!E.deskInput)return;
    if(e.pointerType==='mouse'&&e.buttons===0){drag=null;return;}
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
    if(drag.moved){D.yaw-=dx*.005;D.pitch=Math.max(-1.3,Math.min(1.3,D.pitch-dy*.005));drag.x=e.clientX;drag.y=e.clientY;}
  });
  const up=()=>{if(drag&&!drag.moved&&E.deskInput)deskClick=true;drag=null;};
  canvas.addEventListener('pointerup',up);
  window.addEventListener('pointerup',e=>{drag=null;if(e.pointerType==='mouse'||!e.pointerType){mouseL=!!(e.buttons&1);mouseR=!!(e.buttons&2);}});
  window.addEventListener('mouseup',e=>{mouseL=!!(e.buttons&1);mouseR=!!(e.buttons&2);},true);
  window.addEventListener('mousedown',e=>{if(locked){mouseL=!!(e.buttons&1);mouseR=!!(e.buttons&2);}},true);
  for(const ev of['pointercancel','lostpointercapture'])canvas.addEventListener(ev,()=>{drag=null;});
  window.addEventListener('blur',releaseAll);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
  window.addEventListener('keydown',e=>{
    if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
    keys[e.code]=true;if(!E.deskInput)return;
    if(e.code==='KeyE')deskGrab=true;
    if(e.code==='KeyM'||e.code==='Tab'){deskMenu=true;e.preventDefault();}
    if(e.code==='Space'||e.code==='ControlLeft'||e.code==='ControlRight')e.preventDefault();
    if(e.code==='Enter'&&!e.repeat){deskClick=true;e.preventDefault();}
    if(e.code==='KeyF'&&!e.repeat){E.toggleFullscreen();e.preventDefault();}
    if(e.code==='KeyR'&&!e.repeat&&!e.ctrlKey&&!e.metaKey){E.resetStand();e.preventDefault();}
    if(e.code==='BracketLeft'||e.code==='BracketRight'){E.setMouseCfg({sens:MC.sens*(e.code==='BracketRight'?1.2:1/1.2)});E.toast('Чувствительность мыши: '+Math.round(MC.sens*100)+'%');if(E.hooks.onMouseCfg)try{E.hooks.onMouseCfg(MC);}catch(_){}}
  });
  window.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyE')deskGrab=false;if(e.key==='Meta'||e.key==='Alt')releaseAll();});
  const crossEl=document.getElementById('cross');let crossHot=false;
  E.startDesk=()=>{
    const id=++deskId;let lt=0;E.desk=true;
    const f=t=>{
      if(id!==deskId||E.session)return;
      requestAnimationFrame(f);
      const dt=lt?Math.min(.05,(t-lt)/1000):.016;lt=t;
      dtS+=(dt-dtS)*.25;fpsN++;fpsT+=dt;fpsMax=Math.max(fpsMax,dt);
      if(fpsT>=.5){if(fpsEl){fpsEl.hidden=!PF.fps;if(PF.fps)fpsEl.textContent=Math.round(fpsN/fpsT)+' fps · худший кадр '+Math.round(fpsMax*1000)+' мс';}fpsN=0;fpsT=0;fpsMax=0;}
      if(E.deskInput){
        applyLook(dtS);
        /* присед (Ctrl или C) и прыжок (пробел): высота глаз плавно меняется, прыжок — по параболе, в воздухе управлять нельзя только высотой */
        const crouch=!!(keys.ControlLeft||keys.ControlRight||keys.KeyC);
        D.h+=((crouch?1.0:1.6)-D.h)*(1-Math.exp(-dt/.07));
        if(keys.Space&&D.jy<=.001&&!crouch)D.jv=3.1;
        if(D.jy>0||D.jv>0){D.jv-=9.8*dt;D.jy=Math.max(0,D.jy+D.jv*dt);if(D.jy===0)D.jv=0;}
        /* ходьба: желаемая скорость по клавишам, фактическая плавно догоняет её (резкий старт и стоп вызывают укачивание); по диагонали не быстрее */
        const base=(crouch?1.1:keys.ShiftLeft||keys.ShiftRight?3.6:2.2)*PF.walk,fx=-Math.sin(D.yaw),fz=-Math.cos(D.yaw),rx=Math.cos(D.yaw),rz=-Math.sin(D.yaw);
        let tx=0,tz=0;
        if(keys.KeyW||keys.ArrowUp){tx+=fx;tz+=fz;}
        if(keys.KeyS||keys.ArrowDown){tx-=fx;tz-=fz;}
        if(keys.KeyD||keys.ArrowRight){tx+=rx;tz+=rz;}
        if(keys.KeyA||keys.ArrowLeft){tx-=rx;tz-=rz;}
        const tl=Math.hypot(tx,tz);if(tl>1){tx/=tl;tz/=tl;}
        tx*=base;tz*=base;const ek=PF.ease?1-Math.exp(-dt/.12):1;WV.x+=(tx-WV.x)*ek;WV.z+=(tz-WV.z)*ek;
        if(Math.abs(WV.x)<.005&&!tx)WV.x=0;if(Math.abs(WV.z)<.005&&!tz)WV.z=0;
        D.x+=WV.x*dt;D.z+=WV.z*dt;
        if(keys.KeyQ)D.yaw+=1.5*dt;
        const lim=E.open?5.2:5.5;D.x=Math.max(-lim,Math.min(lim,D.x));D.z=Math.max(-lim,Math.min(lim,D.z));
      }else{D.yaw=Math.sin(t/6000)*.35;}
      readDesk(dt);
      step(dt);
      if(crossEl&&crossEl.classList){const hot=!!(H[1].hit||H[1].held);if(hot!==crossHot){crossHot=hot;crossEl.classList.toggle('hot',hot);}}
      const dpr=Math.max(.5,Math.min((window.devicePixelRatio||1)*PF.scale,2.5)),w=(canvas.clientWidth*dpr)|0,h=(canvas.clientHeight*dpr)|0;
      if(w>0&&h>0&&(canvas.width!==w||canvas.height!==h)){canvas.width=w;canvas.height=h;}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.enable(gl.DEPTH_TEST);
      gl.clearColor(E.clear[0],E.clear[1],E.clear[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const cam=[D.x,eyeY(),D.z],view=M.mul(M.rotX(-D.pitch),M.mul(M.rotY(-D.yaw),M.trans(-cam[0],-cam[1],-cam[2])));
      buildDraw(cam);render(M.persp(PF.fov*Math.PI/180,canvas.width/Math.max(1,canvas.height),.05,200),view,cam);
    };
    requestAnimationFrame(f);
  };
  E._test={step,readDesk,buildDraw,L:()=>L,setFrame:f=>{curFrame=f;},deskKey:k=>{if(k==='click')deskClick=true;if(k==='menu')deskMenu=true;if(k==='grab')deskGrab=true;if(k==='ungrab')deskGrab=false;}};
  return E;
};
})();

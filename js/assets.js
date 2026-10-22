/* assets.js — ресурсы урока без сети и без WebGL: разбор моделей GLB (glTF 2.0) и рисование текстур на канве.
   Разбор строгий: лимиты на размер и число треугольников, внешние ссылки и расширения не поддерживаются (Б51).
   Результат разбора — обычные массивы вершин в формате движка (позиция, нормаль, UV), движок сам создаёт из них сетки. */
(function(){
'use strict';
const VR=window.VR=window.VR||{};
const LIM={bytes:4*1024*1024,tris:20000,parts:32,img:1536*1024,nodes:200,depth:12};

/* ---- матрицы 4×4 (по столбцам), только то, что нужно для узлов glTF ---- */
const mul=(a,b)=>{const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;};
const ID=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fromTRS(t,q,s){
  const [x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  return[(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,(xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1];
}
const isNum=v=>typeof v==='number'&&isFinite(v);
const arrN=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(isNum);
const SIZE={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},NCOMP={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

function parseGLB(buf,lim){
  lim=Object.assign({},LIM,lim||{});
  if(!(buf instanceof ArrayBuffer)||buf.byteLength<28)throw new Error('Это не файл модели.');
  if(buf.byteLength>lim.bytes)throw new Error('Файл модели больше '+Math.round(lim.bytes/1048576)+' МБ.');
  const dv=new DataView(buf);
  if(dv.getUint32(0,true)!==0x46546C67||dv.getUint32(4,true)!==2)throw new Error('Нужен файл .glb версии 2.');
  if(dv.getUint32(8,true)>buf.byteLength)throw new Error('Файл модели обрезан.');
  let json=null,bin=null,off=12;
  while(off+8<=buf.byteLength){
    const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true),st=off+8;
    if(st+len>buf.byteLength)throw new Error('Файл модели повреждён.');
    if(type===0x4E4F534A&&!json){try{json=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,st,len)));}catch(e){throw new Error('В модели ошибка описания.');}}
    else if(type===0x004E4942&&!bin)bin=new Uint8Array(buf,st,len);
    off=st+((len+3)&~3);
  }
  if(!json||!bin)throw new Error('В модели нет данных.');
  for(const e of json.extensionsRequired||[])throw new Error('Расширение «'+e+'» не поддерживается.');
  const A=json.accessors||[],BV=json.bufferViews||[];
  const view=(bi)=>{const v=BV[bi];if(!v||(v.buffer||0)!==0||!isNum(v.byteLength))throw new Error('Модель: плохой блок данных.');const o=v.byteOffset||0;if(o<0||o+v.byteLength>bin.length)throw new Error('Модель: данные за границей.');return{o,len:v.byteLength,stride:v.byteStride||0};};
  function read(ai,want){
    const a=A[ai];if(!a||!isNum(a.count)||a.count<0||a.sparse)throw new Error('Модель: плохие данные.');
    if(a.count>lim.tris*3)throw new Error('В модели больше '+lim.tris+' треугольников. Упростите её.');
    const nc=NCOMP[a.type],cs=SIZE[a.componentType];if(!nc||!cs||(want&&nc!==want))throw new Error('Модель: неподдерживаемый формат данных.');
    const v=view(a.bufferView),el=nc*cs,stride=v.stride||el,base=v.o+(a.byteOffset||0);
    if(a.count&&base+(a.count-1)*stride+el>v.o+v.len)throw new Error('Модель: данные за границей.');
    const out=new Array(a.count*nc),d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
    for(let i=0;i<a.count;i++)for(let c=0;c<nc;c++){
      const p=base+i*stride+c*cs;let x;
      switch(a.componentType){case 5126:x=d.getFloat32(p,true);break;case 5123:x=d.getUint16(p,true);break;case 5125:x=d.getUint32(p,true);break;case 5121:x=d.getUint8(p);break;case 5122:x=d.getInt16(p,true);break;default:x=d.getInt8(p);}
      if(a.normalized){x=a.componentType===5121?x/255:a.componentType===5123?x/65535:a.componentType===5122?Math.max(x/32767,-1):a.componentType===5120?Math.max(x/127,-1):x;}
      out[i*nc+c]=x;
    }
    return out;
  }
  const parts=[],min=[1e9,1e9,1e9],max=[-1e9,-1e9,-1e9];let tris=0,nodes=0;
  const imgOf=ti=>{
    const t=(json.textures||[])[ti],im=t&&(json.images||[])[t.source];
    if(!im||im.uri!==undefined||im.bufferView===undefined)return null;/* только встроенные картинки */
    if(im.mimeType!=='image/png'&&im.mimeType!=='image/jpeg')return null;
    const v=view(im.bufferView);if(v.len>lim.img)throw new Error('В модели слишком тяжёлая картинка.');
    return{bytes:new Uint8Array(bin.buffer,bin.byteOffset+v.o,v.len),mime:im.mimeType};
  };
  function walk(ni,parent,depth){
    if(depth>lim.depth||++nodes>lim.nodes)throw new Error('В модели слишком много узлов.');
    const n=(json.nodes||[])[ni];if(!n)throw new Error('Модель: нет узла.');
    let m;
    if(n.matrix){if(!arrN(n.matrix,16))throw new Error('Модель: плохая матрица.');m=n.matrix;}
    else m=fromTRS(arrN(n.translation,3)?n.translation:[0,0,0],arrN(n.rotation,4)?n.rotation:[0,0,0,1],arrN(n.scale,3)?n.scale:[1,1,1]);
    m=mul(parent,m);
    if(n.mesh!==undefined){
      const me=(json.meshes||[])[n.mesh];if(!me)throw new Error('Модель: нет сетки.');
      for(const pr of me.primitives||[]){
        if(pr.mode!==undefined&&pr.mode!==4)continue;
        if(parts.length>=lim.parts)throw new Error('В модели слишком много частей.');
        const at=pr.attributes||{};if(at.POSITION===undefined)continue;
        const P=read(at.POSITION,3),N=at.NORMAL!==undefined?read(at.NORMAL,3):null,T=at.TEXCOORD_0!==undefined?read(at.TEXCOORD_0,2):null;
        const I=pr.indices!==undefined?read(pr.indices,1):null,cnt=I?I.length:P.length/3;
        if(cnt%3)throw new Error('Модель: не треугольники.');
        tris+=cnt/3;if(tris>lim.tris)throw new Error('В модели больше '+lim.tris+' треугольников. Упростите её.');
        const idx=i=>I?I[i]:i,vt=new Array(cnt*8);
        const tp=(i)=>{const j=idx(i)*3;if(!(j+2<P.length))throw new Error('Модель: индекс за границей.');return[m[0]*P[j]+m[4]*P[j+1]+m[8]*P[j+2]+m[12],m[1]*P[j]+m[5]*P[j+1]+m[9]*P[j+2]+m[13],m[2]*P[j]+m[6]*P[j+1]+m[10]*P[j+2]+m[14]];};
        for(let f=0;f<cnt;f+=3){
          const a=tp(f),b=tp(f+1),c=tp(f+2);
          let fn=[0,0,0];
          if(!N){const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];fn=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const l=Math.hypot(fn[0],fn[1],fn[2])||1;fn=fn.map(q=>q/l);}
          [a,b,c].forEach((p,k)=>{
            const o=(f+k)*8,j=idx(f+k);
            let nx=fn[0],ny=fn[1],nz=fn[2];
            if(N){const q=j*3;nx=m[0]*N[q]+m[4]*N[q+1]+m[8]*N[q+2];ny=m[1]*N[q]+m[5]*N[q+1]+m[9]*N[q+2];nz=m[2]*N[q]+m[6]*N[q+1]+m[10]*N[q+2];const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;}
            vt[o]=p[0];vt[o+1]=p[1];vt[o+2]=p[2];vt[o+3]=nx;vt[o+4]=ny;vt[o+5]=nz;
            vt[o+6]=T?T[j*2]:0;vt[o+7]=T?T[j*2+1]:0;
            for(let d=0;d<3;d++){if(p[d]<min[d])min[d]=p[d];if(p[d]>max[d])max[d]=p[d];}
          });
        }
        const mat=(json.materials||[])[pr.material]||{},pbr=mat.pbrMetallicRoughness||{};
        const col=arrN(pbr.baseColorFactor,4)?pbr.baseColorFactor.slice(0,3).map(q=>Math.max(0,Math.min(1,q))):[1,1,1];
        const bt=pbr.baseColorTexture;
        parts.push({verts:new Float32Array(vt),color:col,image:bt&&isNum(bt.index)?imgOf(bt.index):null});
      }
    }
    for(const c of n.children||[])walk(c,m,depth+1);
  }
  const sc=(json.scenes||[])[json.scene||0];
  for(const ni of(sc&&sc.nodes)||[])walk(ni,ID(),0);
  if(!parts.length)throw new Error('В модели нет видимых частей.');
  return{parts,min,max,tris};
}

/* ---- текстуры, нарисованные кодом: ничего скачивать не нужно ---- */
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const TEX={
  wood:{title:'Дерево',draw(c,S,r){c.fillStyle='#8a5a33';c.fillRect(0,0,S,S);for(let i=0;i<70;i++){c.fillStyle='rgba('+(r()<.5?'60,35,15':'190,135,80')+','+(.08+r()*.18)+')';const y=r()*S;c.fillRect(0,y,S,1+r()*4);}for(let i=0;i<6;i++){c.strokeStyle='rgba(50,28,10,.35)';c.lineWidth=2;c.beginPath();c.ellipse(r()*S,r()*S,10+r()*20,3+r()*5,0,0,6.3);c.stroke();}}},
  brick:{title:'Кирпич',draw(c,S,r){c.fillStyle='#bdb5a8';c.fillRect(0,0,S,S);const bh=S/8,bw=S/4;for(let y=0;y<8;y++)for(let x=-1;x<5;x++){const ox=(y%2)*bw/2,rr=150+r()*50;c.fillStyle='rgb('+rr+','+(60+r()*25)+','+(45+r()*20)+')';c.fillRect(x*bw+ox+3,y*bh+3,bw-6,bh-6);}}},
  grass:{title:'Трава',draw(c,S,r){c.fillStyle='#3f8f3a';c.fillRect(0,0,S,S);for(let i=0;i<2500;i++){c.fillStyle='rgba('+(30+r()*50)+','+(120+r()*90)+','+(30+r()*40)+',.55)';c.fillRect(r()*S,r()*S,1+r()*2,2+r()*4);}}},
  metal:{title:'Металл',draw(c,S,r){c.fillStyle='#8c95a1';c.fillRect(0,0,S,S);for(let i=0;i<260;i++){c.fillStyle='rgba('+(r()<.5?'255,255,255':'40,50,60')+','+(.05+r()*.12)+')';c.fillRect(0,r()*S,S,1);}}},
  tiles:{title:'Плитка',draw(c,S,r){const n=4,t=S/n;for(let y=0;y<n;y++)for(let x=0;x<n;x++){c.fillStyle=(x+y)%2?'#dbe7f3':'#b9cfe6';c.fillRect(x*t,y*t,t,t);c.strokeStyle='rgba(60,80,110,.5)';c.lineWidth=3;c.strokeRect(x*t,y*t,t,t);}}},
  sand:{title:'Песок',draw(c,S,r){c.fillStyle='#d9c48b';c.fillRect(0,0,S,S);for(let i=0;i<3500;i++){c.fillStyle='rgba('+(r()<.5?'120,95,50':'255,240,190')+','+(.15+r()*.3)+')';c.fillRect(r()*S,r()*S,1.5,1.5);}}},
  stone:{title:'Камень',draw(c,S,r){c.fillStyle='#7d7f86';c.fillRect(0,0,S,S);for(let i=0;i<500;i++){c.fillStyle='rgba('+(r()<.5?'40,40,50':'200,200,210')+','+(.06+r()*.16)+')';c.beginPath();c.arc(r()*S,r()*S,2+r()*10,0,6.3);c.fill();}}},
  paper:{title:'Бумага',draw(c,S,r){c.fillStyle='#f4efe2';c.fillRect(0,0,S,S);for(let i=0;i<1500;i++){c.fillStyle='rgba(120,100,60,'+(.03+r()*.06)+')';c.fillRect(r()*S,r()*S,2,2);}}}
};
function proc(name,size){
  const t=TEX[name];if(!t)return null;
  const S=size||256,cv=document.createElement('canvas');cv.width=cv.height=S;
  let seed=0;for(const ch of name)seed=seed*31+ch.charCodeAt(0);
  t.draw(cv.getContext('2d'),S,rng(seed));return cv;
}
VR.assets={LIM,parseGLB,proc,TEXTURES:Object.keys(TEX),textureTitle:k=>TEX[k]?TEX[k].title:k};
})();

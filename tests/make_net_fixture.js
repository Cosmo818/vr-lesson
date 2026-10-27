/* Пересобирает tests/fixtures/net_frames.json из js/netproto.js (запускать только при намеренном изменении формата кадра: pv++ и docs/NET_PROTOCOL.md). */
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.dirname(__dirname),sb={window:{VR:{}}};sb.window.window=sb.window;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(root,'js','netproto.js'),'utf8'),sb);
const NP=sb.window.VR.netproto,hex=b=>Buffer.from(b).toString('hex');
const q=(ax,ay,az,deg)=>{const h=deg*Math.PI/360,s=Math.sin(h)/Math.hypot(ax,ay,az);return[ax*s,ay*s,az*s,Math.cos(h)];};
const poses=[
 {name:'обычная поза',o:{seq:7,t:123456,flags:0b00100111,head:{p:[1.234,1.62,-2.5],q:q(0,1,0,35)},left:{p:[.9,1.1,-2.1],q:q(1,0,0,-20)},right:{p:[1.5,1.2,-2.3],q:q(0,0,1,70)},phys:{x:.4,z:-1.25,yaw:2.5}}},
 {name:'большой компонент отрицательный',o:{seq:1,t:5,flags:1,head:{p:[0,1.6,0],q:[0,0,0,-1]},left:{p:[0,0,0],q:[-.1,-.2,-.9,-.3]},right:{p:[0,0,0],q:[0,-1,0,0]},phys:{x:0,z:0,yaw:-3.1}}},
 {name:'координаты за ±32 м обрезаются',o:{seq:2,t:9,flags:0,head:{p:[40,-50,32.768],q:[0,0,0,1]},left:{p:[-33,33,0],q:[0,0,0,1]},right:{p:[0,0,0],q:[0,0,0,1]},phys:{x:100,z:-100,yaw:9}}},
 {name:'NaN и нулевой кватернион',o:{seq:3,t:10,flags:2,head:{p:['nan','inf',0],q:[0,0,0,0]},left:{p:[0,0,0],q:['nan',0,0,1]},right:{p:[0,0,0],q:[0,0,0,1]},phys:{x:'nan',z:0,yaw:'nan'}}},
 {name:'seq и время за пределом',o:{seq:65539,t:4294967301,flags:255,head:{p:[0,1.7,0],q:[0,.7071068,0,.7071068]},left:{p:[0,0,0],q:[0,0,0,1]},right:{p:[0,0,0],q:[0,0,0,1]},phys:{x:0,z:0,yaw:0}}}
];
const out={_comment:'Эталонные кадры протокола поз (docs/NET_PROTOCOL.md). hex — ожидаемое кодирование; JS и Python должны давать те же байты. Пересборка: node tests/make_net_fixture.js',poses:[],batch:null};
for(const c of poses){out.poses.push({name:c.name,input:c.o,hex:hex(NP.encodePose(JSON.parse(JSON.stringify(c.o,(k,v)=>v))))});}
const items=poses.slice(0,3).map((c,i)=>Object.assign({slot:i+1,age:i*37},c.o));
out.batch={input:{tick:65537,srv:1234567,items},hex:hex(NP.encodeBatch({tick:65537,srv:1234567,items}))};
fs.writeFileSync(path.join(root,'tests','fixtures','net_frames.json'),JSON.stringify(out,null,1)+'\n');
console.log('кадров',out.poses.length,'длины',out.poses.map(p=>p.hex.length/2).join(','),'пачка',out.batch.hex.length/2);

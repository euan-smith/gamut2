import Vue from 'vue';
import Vuex from 'vuex';
import bradfordCA from "./BradfordCA";
import {xyz2lab} from "./CIELab";
import {makeTesselation} from "./iecTesselation";

Vue.use(Vuex);

const refs = {
  rec2020: require('./rec2020.json')
};

const state = {
  dataSets:Object.keys(refs).map(k=>refData2dataSet(refs[k],k)),
  refData:0,
  testData:0,
  refGeo:null,
  testGeo:null,
  interGeo:null,
  refShow:{mesh:false, wire:true},
  testShow:{mesh:true, wire:false},
  interShow:{mesh:false, wire:false},
};
state.refGeo = makeWireFrame(makeCIELabMesh(state.dataSets[state.refData]));
state.testGeo = makeWireFrame(makeCIELabMesh(state.dataSets[state.testData]));
state.interGeo = makeWireFrame(makeInterGeo(state.refGeo, state.testGeo));

const mutations = {
  import(state, {data,name}){
    const ds=readData(data,name);
    state.dataSets = [...state.dataSets, ds];
  },
  setRef(state, idx){
    if (typeof state.dataSets[idx] === "undefined") idx = state.dataSets.length-1;
    if (state.refData !== idx){
      state.refData = idx;
      state.refGeo = makeWireFrame(makeCIELabMesh(state.dataSets[idx]));
      state.interGeo = makeWireFrame(makeInterGeo(state.refGeo, state.testGeo));
    }
  },
  setTest(state, idx){
    if (typeof state.dataSets[idx] === "undefined") idx = state.dataSets.length-1;
    if (state.testData !== idx){
      state.testData = idx;
      state.testGeo = makeWireFrame(makeCIELabMesh(state.dataSets[idx]));
      state.interGeo = makeWireFrame(makeInterGeo(state.refGeo, state.testGeo));
    }
  },
  toggleShow(state,[set,field]){
	  switch(set){
		  case "ref":
			state.refShow = Object.assign({},state.refShow, {[field]:!state.refShow[field]});
		  break;
      case "test":
        state.testShow = Object.assign({},state.testShow, {[field]:!state.testShow[field]});
        break;
      case "inter":
        state.interShow = Object.assign({},state.interShow, {[field]:!state.interShow[field]});
        break;
	  }
  }
};

const actions = {

};

const getters = {
  refData:state=>state.dataSets[state.refData],
  testData:state=>state.dataSets[state.testData],
  refGeo:state=>state.refGeo,
  testGeo:state=>state.testGeo,
  interGeo:state=>state.interGeo,
  sets:state=>state.dataSets.map(ds=>ds.name),
  refShow:state=>state.refShow,
  testShow:state=>state.testShow,
  interShow:state=>state.interShow,
};

export default new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
})

function* parseFile(s){
  for (let line of s.split('\n')){
    let a=line.split(/\s+/).map(Number.parseFloat).slice(0,7);
    if (a.length === 7 && ~a.some(Number.isNaN)) yield a;
  }
}


function readData(s,name) {
  const array = Array.from(parseFile(s));
  //first get a list of unique greyscale values
  const ugs=new Set();
  for(let a of array) for(let i=1;i<4;i++) ugs.add(a[i]);
  const gs=[...ugs].sort((a,b)=>a-b);
  //then build a map to find xyz values from the rgb
  const map = new Map();
  const sp=gs[gs.length-1]+1;
  for(let a of array){
    map.set((a[1]*sp+a[2])*sp+a[3],a.slice(4));
  }
  //get the required tesselation
  const {RGB,TRI} = makeTesselation(gs);
  //then use the map to build the xyz array
  const XYZ = RGB.map(rgb=>map.get((rgb[0]*sp+rgb[1])*sp+rgb[2]));
  if (XYZ.some(xyz=>!xyz)){
    console.log('RGB data missing from file');
    RGB.forEach((rgb,i)=>{
      if (!XYZ[i]) console.log(rgb);
    });
    throw new Error('RGB data missing!');
  }
  return {RGB, XYZ, TRI, name};
}

function refData2dataSet(refData,name){
  function mixrgb(rgb1,rgb2,lin){
    return [
      rgb1[0]*(1-lin)+rgb2[0]*lin,
      rgb1[1]*(1-lin)+rgb2[1]*lin,
      rgb1[2]*(1-lin)+rgb2[2]*lin,
    ]
  }
  const gs=refData.GS.sort((a,b)=>a-b),mx=gs[gs.length-1],mn=gs[0];
  const gs2lin=v=>Math.pow((v-mn)/(mx-mn),refData.gamma);
  const {RGB,TRI} = makeTesselation(gs);
  //First get the primaries in order 0K 1B 2G 3C 4R 5M 6Y 7W
  const primaries = refData.primaries.sort(tripleCompare);
  //Now for each RGB value get the XYZ from the supplied primaries
  const XYZ = RGB.map(function(rgb){
    const lr=gs2lin(rgb[0]),lg=gs2lin(rgb[1]),lb=gs2lin(rgb[2]);
    const pr=[];
    for(let n=0;n<4;n++) pr.push(mixrgb(primaries[n].slice(3),primaries[n+4].slice(3),lr));
    for(let n=0;n<2;n++) pr.push(mixrgb(pr[n],pr[n+2],lg));
    return mixrgb(pr[4],pr[5],lb);
  });
  return {RGB, XYZ, TRI, name};
}


function volume(Lab, TRI){
  let vol=0;
  for(let tri of TRI){
    const a=Lab[tri[0]], b=Lab[tri[1]], c=Lab[tri[2]];
    const v1=[b[0]-c[0],b[1]-c[1],b[2]-c[2]];
    const v2=[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    vol += (a[0]*(v1[1]*v2[2]-v1[2]*v2[1])
          + a[1]*(v1[2]*v2[0]-v1[0]*v2[2])
          + a[2]*(v1[0]*v2[1]-v1[1]*v2[0]))/6;
  }
  return vol;
}

const tripleCompare = (a,b) => a[0]!==b[0]?a[0]-b[0]: a[1]!==b[1]?a[1]-b[1] : a[2]-b[2];


function intersection2(BLAref, TRIref,BLAtest, TRItest, ){
  const cross = (v1,v2)=>[v1[1]*v2[2]-v1[2]*v2[1],v1[2]*v2[0]-v1[0]*v2[2],v1[0]*v2[1]-v1[1]*v2[0]];
  const vect = (v1,v2)=>[v2[0]-v1[0], v2[1]-v1[1], v2[2]-v1[2]];
  const dot = (v1,v2)=>v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2];
  const T=TRIref.map(([i0,i1,i2])=>{
    const v0=BLAref[i0], v1=BLAref[i1], v2=BLAref[i2];
    const e1=vect(v0,v1);
    const e2=vect(v0,v2);
    const o =vect(v0,[0,50,0]);
    const e2e1 = cross(e2,e1);
    const e2o = cross(e2,o);
    const oe1 = cross(o,e1);
    const e2oe1 = dot(e2,oe1);
    return [...e2e1,...e2o,...oe1,e2oe1];
  });
  const BLA = BLAtest.map(([b,L,a])=>{
    L-=50;
    const l=Math.sqrt(b*b+L*L+a*a),il=1/l;
    const dir=[b*il,L*il,a*il];
    for (let t of T){
      const idet = 1/(dot(dir,t.slice(0,3)));
      const d = t[9]*idet;
      if (d>=0){
        const u = dot(dir,t.slice(3,6))*idet;
        if (u>=-0.0001) {
          const v = dot(dir,t.slice(6,9))*idet;
          if (v>=-0.0001 && (u+v)<=1.0001) {
            return d>l*1.0001 ? [b,L+50,a] : [dir[0]*d, dir[1]*d+50, dir[2]*d];
          }
        }
      }
    }
  });
  return {BLA, TRI:TRItest};
}


function makeInterGeo(geo1,geo2){
  const {BLA:bla,TRI} = intersection2(geo1.bla,geo1.TRI, geo2.bla, geo2.TRI);

  const geometry = new THREE.Geometry();
  for (let i = 0; i < bla.length; i += 1) {
    geometry.vertices.push(new THREE.Vector3().fromArray(bla[i]));
    //geometry.vertexColors.push(new THREE.Color(cols[i]));
  }
  let normal;
  for (let i = 0; i < TRI.length; i += 1) {
    const a = new THREE.Vector3().fromArray(bla[TRI[i][0]]);
    const b = new THREE.Vector3().fromArray(bla[TRI[i][1]]);
    const c = new THREE.Vector3().fromArray(bla[TRI[i][2]]);
    normal  = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(c, a),
        new THREE.Vector3().subVectors(b, a),
      )
      .normalize();
    geometry.faces.push(
      new THREE.Face3(TRI[i][0], TRI[i][2], TRI[i][1], normal, [new THREE.Color(0x777777),new THREE.Color(0x777777),new THREE.Color(0x777777)])
    );
  }

  return {
    mesh:new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial( { vertexColors:THREE.VertexColors })
    ),
    vol:volume(bla,TRI),
    bla,
    TRI
  };

}

function makeCIELabMesh(s){
  const {RGB, XYZ, TRI} = s;
  const cols = RGB.map(c => (c[0]<<16) + (c[1]<<8) + c[2]);
  const offset = sumArrays(RGB).map(v=>-v/RGB.length);
  const points = offsetArrays(RGB,offset).map(p=>unitVector(p));

  const max = maxArray(XYZ, a=>a[1]);
  const bla = normArrays(XYZ,max).map(xyz2lab).map(p=>[p[2],p[0],p[1],]);

  const geometry = new THREE.Geometry();
  for (let i = 0; i < points.length; i += 1) {
    geometry.vertices.push(new THREE.Vector3().fromArray(bla[i]));
    //geometry.vertexColors.push(new THREE.Color(cols[i]));
  }
  let normal;
  for (let i = 0; i < TRI.length; i += 1) {
    const a = new THREE.Vector3().fromArray(bla[TRI[i][0]]);
    const b = new THREE.Vector3().fromArray(bla[TRI[i][1]]);
    const c = new THREE.Vector3().fromArray(bla[TRI[i][2]]);
    normal  = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(c, a),
        new THREE.Vector3().subVectors(b, a),
      )
      .normalize();
    geometry.faces.push(
      new THREE.Face3(TRI[i][0], TRI[i][2], TRI[i][1], normal, [new THREE.Color(cols[TRI[i][0]]),new THREE.Color(cols[TRI[i][2]]),new THREE.Color(cols[TRI[i][1]])])
    );
  }

  return {
    mesh:new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial( { vertexColors:THREE.VertexColors })
    ),
    vol:volume(bla,TRI),
    bla,
    TRI
  };
}

function sumArrays(d){
  return d.reduce((a,b)=>a?a.map((v,i)=>v+b[i]):b);
}

function offsetArrays(d,o){
  return d.map(a=>a.map((v,i)=>v+o[i]));
}

function mag(a){
  return Math.sqrt(a.reduce((t,v)=>t+v*v,0));
}

function unitVector(a){
  const d=mag(a);
  return a.map(v=>v/d);
}

function maxArray(a,fn){
  return a.reduce((m,dat)=>{
    let r;
    try {
      r = {val: fn(dat), dat};
    } catch (e){
      console.log('error',m,r);
      return m;
    }
    return m && m.val>=r.val ? m : r;
  },null).dat;
}

function normArrays(d,n){
  const D50 = [0.9642957, 1, 0.8251046];
  return bradfordCA(d,n,D50).map(a=>a.map((v,i)=>v/D50[i]));
}

function makeWireFrame({mesh,vol,bla,TRI}){
  const wire                = new THREE.WireframeHelper(mesh);
  wire.material.depthTest   = false;
  wire.material.opacity     = 0.25;
  wire.material.transparent = true;
  return {wire,mesh,vol,bla,TRI};
}

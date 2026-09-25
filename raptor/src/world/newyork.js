// New York at flight scale. Real NYC OTI footprint positions, roof heights and
// street alignment provide the city fabric; authored silhouettes provide the
// landmarks. Every metre remains in the flat ENU simulation frame until the
// existing PlanetObjectBender renders it. Three Z is NORTH in this engine.
import * as THREE from 'three';
import {
  Fn, attribute, uv, normalGeometry, materialColor, vec3, vec4, float,
  mix, smoothstep, fract, floor, sin, dot, max, select, uniform, output, positionWorld,
} from 'three/tsl';

export const NEWYORK_ORIGIN = Object.freeze({ lat:40.70, lon:-74.00, latM:111132, lonM:84395.51430552264 });
export const NYC_CHUNK_M = 2400;
const COLLISION_CELL_M = 180;
const V3_UP = new THREE.Vector3(0,1,0);
const PALETTE = [0xa49e93,0x95958e,0xa6a298,0xaaa79f,0x948778,0x846d5d,0x897367,0x788d96,0x879b9f,0x859399];

export function newYorkPoint(lat, lon, altitude=0) {
  return { x:(lon-NEWYORK_ORIGIN.lon)*NEWYORK_ORIGIN.lonM,
    y:altitude, z:(lat-NEWYORK_ORIGIN.lat)*NEWYORK_ORIGIN.latM };
}

// Locations are rounded geographic anchors; architectural models are original
// simplified flight-scale interpretations, not imported surveyed 3-D assets.
export const NEWYORK_LANDMARKS = Object.freeze([
  { id:'empire-state', name:'Empire State Building', lat:40.74844, lon:-73.98566, height:443.2, width:86, depth:57, year:1931, kind:'empire' },
  { id:'chrysler', name:'Chrysler Building', lat:40.75162, lon:-73.97550, height:318.9, width:53, depth:60, year:1930, kind:'chrysler' },
  { id:'one-world', name:'One World Trade Center', lat:40.71274, lon:-74.01338, height:541.3, width:61, depth:61, year:2014, kind:'world' },
  { id:'woolworth', name:'Woolworth Building', lat:40.71241, lon:-74.00829, height:241.4, width:58, depth:49, year:1913, kind:'gothic' },
  { id:'40-wall', name:'40 Wall Street', lat:40.70695, lon:-74.00902, height:282.5, width:54, depth:47, year:1930, kind:'gothic' },
  { id:'70-pine', name:'70 Pine Street', lat:40.70672, lon:-74.00772, height:290.2, width:46, depth:48, year:1932, kind:'deco' },
  { id:'30-rock', name:'30 Rockefeller Plaza', lat:40.75874, lon:-73.97867, height:259, width:130, depth:38, year:1933, kind:'rock' },
  { id:'un', name:'United Nations Secretariat', lat:40.74980, lon:-73.96765, height:154, width:87, depth:22, year:1952, kind:'slab' },
  { id:'metlife', name:'MetLife Building', lat:40.75349, lon:-73.97670, height:246, width:126, depth:52, year:1963, kind:'slab' },
  { id:'432-park', name:'432 Park Avenue', lat:40.76167, lon:-73.97189, height:425.5, width:28, depth:28, year:2015, kind:'slender' },
  { id:'central-park-tower', name:'Central Park Tower', lat:40.76631, lon:-73.98107, height:472.4, width:45, depth:47, year:2020, kind:'slender' },
  { id:'hudson-yards', name:'30 Hudson Yards', lat:40.75406, lon:-74.00276, height:387, width:67, depth:62, year:2019, kind:'modern' },
  { id:'liberty', name:'Statue of Liberty', lat:40.68925, lon:-74.04450, height:92.99, width:35, depth:35, year:1886, kind:'liberty' },
]);

// Tower anchors make each bridge a recognizable river crossing. Approaches
// descend to their real banks; the main deck remains clear of the water.
export const NEWYORK_BRIDGES = Object.freeze([
  { id:'brooklyn-bridge', name:'Brooklyn Bridge', a:[40.71048,-74.00229], b:[40.70475,-73.99467], span:486.3, deck:42, tower:84, width:26, stone:true },
  { id:'manhattan-bridge', name:'Manhattan Bridge', a:[40.71326,-73.99466], b:[40.70432,-73.98646], span:448.1, deck:43, tower:102, width:36 },
  { id:'williamsburg-bridge', name:'Williamsburg Bridge', a:[40.71797,-73.98237], b:[40.71160,-73.96799], span:487.7, deck:43, tower:94.5, width:36 },
  { id:'queensboro-bridge', name:'Queensboro Bridge', a:[40.75903,-73.96040], b:[40.75281,-73.94654], span:360, deck:43, tower:105, width:32, truss:true },
  { id:'george-washington-bridge', name:'George Washington Bridge', a:[40.84968,-73.95262], b:[40.85569,-73.96874], span:1067, deck:65, tower:184, width:36 },
  { id:'verrazzano-bridge', name:'Verrazzano-Narrows Bridge', a:[40.60814,-74.03952], b:[40.60020,-74.05982], span:1298, deck:70, tower:211, width:34 },
]);

function hash(n) { let x=Math.imul(n^0x9e3779b9,0x45d9f3b); x=Math.imul(x^(x>>>16),0x45d9f3b); return ((x^(x>>>16))>>>0)/4294967296; }
function eraAllows(year,era) { return era !== '2001-aftermath' || year <= 2001; }
function boxRadius(box) { return Math.hypot(box.w,box.d)*.5; }

function aerialMaterial(material,aerial) {
  if (!aerial) return material;
  material.fog=false;
  material.outputNode=Fn(() => {
    const radiance=aerial.composite ? aerial.composite(positionWorld,output.rgb)
      : output.rgb.mul(aerial.trans(positionWorld)).add(aerial.ins(positionWorld).mul(aerial.uSunI));
    return vec4(radiance,output.a);
  })();
  material.userData.cityAerial='hillaire';
  return material;
}

function facadeMaterial(night,aerial) {
  const material=new THREE.MeshStandardNodeMaterial({color:0xffffff,roughness:.74,metalness:.12,vertexColors:true});
  const size=attribute('citySize','vec4');
  const wall=normalGeometry.y.abs().lessThan(.5);
  const across=uv().x.mul(select(normalGeometry.x.abs().greaterThan(.5),size.z,size.x));
  const grid=vec3(across.div(3.1),uv().y.mul(size.y).div(3.7),size.w);
  const f=fract(grid.xy), derivative=max(grid.xy.dFdx().length(),grid.xy.dFdy().length());
  // Fade subpixel windows into the facade instead of creating crawling moiré
  // at flying speed. All geometry remains stable as the camera approaches.
  const detail=float(1).sub(smoothstep(.3,.85,derivative));
  const windows=smoothstep(.17,.28,f.x).mul(float(1).sub(smoothstep(.72,.83,f.x)))
    .mul(smoothstep(.18,.29,f.y)).mul(float(1).sub(smoothstep(.73,.84,f.y)))
    .mul(select(wall,detail,0));
  material.colorNode=materialColor.rgb.mul(mix(vec3(1),vec3(.43,.55,.63),windows));
  material.roughnessNode=mix(float(.8),float(.3),windows);
  const occupied=fract(sin(dot(floor(grid),vec3(12.9898,78.233,37.719))).mul(43758.5453)).greaterThan(.68);
  material.emissiveNode=vec3(1,.65,.32).mul(windows).mul(select(occupied,night,0));
  return aerialMaterial(material,aerial);
}

function mergeParts(parts) {
  const count=parts.reduce((sum,g)=>sum+g.attributes.position.count,0);
  const result=new THREE.BufferGeometry();
  for (const [name,itemSize] of [['position',3],['normal',3],['uv',2],['color',3],['citySize',4]]) {
    const target=new Float32Array(count*itemSize); let cursor=0;
    for (const g of parts) {
      target.set(g.attributes[name].array,cursor); cursor+=g.attributes[name].array.length;
    }
    result.setAttribute(name,new THREE.BufferAttribute(target,itemSize));
  }
  result.computeBoundingBox();result.computeBoundingSphere();
  for (const part of parts) part.dispose();
  return result;
}

function segmentHit(box,from,to,padding) {
  const aX=from[0]-box.x,aZ=from[1]-box.z,bX=to[0]-box.x,bZ=to[1]-box.z;
  // Inverse Three rotation around Y; north is the local Z coordinate.
  const a=[aX*box.c-aZ*box.s,from[2],aX*box.s+aZ*box.c];
  const b=[bX*box.c-bZ*box.s,to[2],bX*box.s+bZ*box.c];
  const lo=[-box.w*.5-padding,box.base-padding,-box.d*.5-padding];
  const hi=[box.w*.5+padding,box.top+padding,box.d*.5+padding];
  let enter=0,exit=1;
  for (let axis=0;axis<3;axis++) {
    const delta=b[axis]-a[axis];
    if (Math.abs(delta)<1e-10) { if(a[axis]<lo[axis]||a[axis]>hi[axis])return false;continue; }
    let t0=(lo[axis]-a[axis])/delta,t1=(hi[axis]-a[axis])/delta;
    if(t0>t1)[t0,t1]=[t1,t0];
    enter=Math.max(enter,t0);exit=Math.min(exit,t1);
    if(enter>exit)return false;
  }
  return true;
}

export class NewYorkCity {
  static async load(url,{terrain,era='modern',aerial=null}={}) {
    const response=await fetch(url);
    if(!response.ok)throw new Error(`New York city data failed (${response.status})`);
    return new NewYorkCity({terrain,era,aerial,buildings:await response.json()});
  }

  constructor({terrain=null,era='modern',aerial=null,buildings}={}) {
    if(!buildings || buildings.version!==1 || !Array.isArray(buildings.buildings))throw new Error('Invalid New York city snapshot');
    if(!['modern','2001-aftermath'].includes(era))throw new Error(`Unknown New York era: ${era}`);
    this.era=era;this.terrain=terrain;this.group=new THREE.Group();this.group.name='New York City';
    this.landmarks=[];this.chunks=[];this.colliders=[];this._cells=new Map();this._query=0;
    this._seen=[];this._disposed=false;this._night=uniform(0);this._materials=[];this._parts=new Map();
    this.facade=facadeMaterial(this._night,aerial);this._materials.push(this.facade);
    const simple=(color,roughness=.72,metalness=.1) => {
      const material=aerialMaterial(new THREE.MeshStandardNodeMaterial({color,roughness,metalness,vertexColors:true}),aerial);
      this._materials.push(material);return material;
    };
    this.stone=simple(0xd0c5b2,.9,.02);this.metal=simple(0x89969b,.42,.48);
    this.copper=simple(0x64a292,.72,.28);this.road=simple(0x4b5354,.95,.03);
    this.dark=simple(0x33464e,.62,.25);this.gold=simple(0xc9a561,.35,.55);
    this._makeBuildings(buildings.buildings);
    for(const landmark of NEWYORK_LANDMARKS)if(eraAllows(landmark.year,era))this._landmark(landmark);
    for(const bridge of NEWYORK_BRIDGES)this._bridge(bridge);
    this._flushParts();
    this.group.updateMatrixWorld(true);
    this.stats={buildings:this._buildingCount,landmarks:this.landmarks.length,bridges:NEWYORK_BRIDGES.length,
      chunks:this.chunks.length,drawCalls:this.chunks.length,colliders:this.colliders.length,era};
  }

  _ground(x,north,fallback=0) {
    const sampled=this.terrain?.heightAt(x,north);
    // A narrow coastal foundation may cross a DEM's shoreline pixel. Source
    // ground height anchors such footprints instead of dropping them in water.
    return Math.max(.8,Number.isFinite(sampled)&&sampled>=0?sampled:fallback);
  }

  _collider({x,z,w,d,base,top,angle=0,id,name}) {
    const box={x,z,w,d,base,top,c:Math.cos(angle),s:Math.sin(angle),id,name};
    const index=this.colliders.push(box)-1,r=boxRadius(box)+6;
    for(let cx=Math.floor((x-r)/COLLISION_CELL_M);cx<=Math.floor((x+r)/COLLISION_CELL_M);cx++)
      for(let cz=Math.floor((z-r)/COLLISION_CELL_M);cz<=Math.floor((z+r)/COLLISION_CELL_M);cz++) {
        const key=`${cx},${cz}`;let cell=this._cells.get(key);if(!cell)this._cells.set(key,cell=[]);cell.push(index);
      }
  }

  _makeBuildings(rows) {
    const buckets=new Map(), matrix=new THREE.Matrix4(), q=new THREE.Quaternion(), color=new THREE.Color();
    const anchors=NEWYORK_LANDMARKS.map(l=>({...l,...newYorkPoint(l.lat,l.lon)}));
    const wtc=newYorkPoint(40.7117,-74.0130);
    this._buildingCount=0;
    for(const row of rows) {
      const [x,z,w,d,h,angle,year,ground,id]=row;
      if(![x,z,w,d,h,angle,year,ground,id].every(Number.isFinite)||w<=0||d<=0||h<=0)continue;
      if(!eraAllows(year,this.era))continue;
      if(this.era==='2001-aftermath' && Math.abs(x-wtc.x)<210 && Math.abs(z-wtc.z)<265)continue;
      if(anchors.some(a=>Math.hypot(x-a.x,z-a.z)<Math.min(76,Math.max(a.width,a.depth)*.55)))continue;
      const base=this._ground(x,z,ground);
      const cx=Math.floor(x/NYC_CHUNK_M),cz=Math.floor(z/NYC_CHUNK_M),key=`${cx},${cz}`;
      let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket={cx,cz,rows:[]});
      bucket.rows.push({x,z,w,d,h,angle,base,id,year});
      this._collider({x,z,w,d,base,top:base+h,angle,id,name:'City building'});this._buildingCount++;
    }
    for(const bucket of buckets.values()) {
      const geometry=new THREE.BoxGeometry(1,1,1),size=new Float32Array(bucket.rows.length*4);
      const mesh=new THREE.InstancedMesh(geometry,this.facade,bucket.rows.length);
      mesh.name=`City blocks ${bucket.cx},${bucket.cz}`;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;
      let tallest=0;
      for(let i=0;i<bucket.rows.length;i++) {
        const b=bucket.rows[i];q.setFromAxisAngle(V3_UP,b.angle);
        matrix.compose(new THREE.Vector3(b.x,b.base+b.h*.5,b.z),q,new THREE.Vector3(b.w,b.h,b.d));
        mesh.setMatrixAt(i,matrix);size.set([b.w,b.h,b.d,hash(b.id)*1000],i*4);
        const palette=b.h>110&&b.year>1960?7+Math.floor(hash(b.id)*3):Math.floor(hash(b.id)*7);
        color.setHex(PALETTE[palette]).multiplyScalar(.89+hash(b.id+31)*.21);mesh.setColorAt(i,color);
        tallest=Math.max(tallest,b.h);
      }
      geometry.setAttribute('citySize',new THREE.InstancedBufferAttribute(size,4));
      mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
      mesh.computeBoundingBox();mesh.computeBoundingSphere();
      this.group.add(mesh);this.chunks.push({mesh,x:(bucket.cx+.5)*NYC_CHUNK_M,z:(bucket.cz+.5)*NYC_CHUNK_M,
        range:tallest>100?33000:22500});
    }
  }

  _part(geometry,material,position,scale,rotation=0,color=0xffffff,seed=0,quaternion=null) {
    let g=geometry.index?geometry.toNonIndexed():geometry; if(g!==geometry)geometry.dispose();
    const count=g.attributes.position.count,col=new THREE.Color(color),colors=new Float32Array(count*3),sizes=new Float32Array(count*4);
    for(let i=0;i<count;i++){colors.set([col.r,col.g,col.b],i*3);sizes.set([scale.x,scale.y,scale.z,seed],i*4);}
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.setAttribute('citySize',new THREE.BufferAttribute(sizes,4));
    const q=quaternion||new THREE.Quaternion().setFromAxisAngle(V3_UP,rotation);
    g.applyMatrix4(new THREE.Matrix4().compose(position,q,scale));
    const cx=Math.floor(position.x/NYC_CHUNK_M),cz=Math.floor(position.z/NYC_CHUNK_M),key=`${cx},${cz},${material.id}`;
    let bucket=this._parts.get(key);if(!bucket)this._parts.set(key,bucket={material,parts:[],cx,cz});bucket.parts.push(g);
  }

  _box(x,y,z,w,h,d,material=this.facade,angle=0,color=0xb5b0a7,seed=0) {
    this._part(new THREE.BoxGeometry(1,1,1),material,new THREE.Vector3(x,y+h*.5,z),new THREE.Vector3(w,h,d),angle,color,seed);
  }

  _cone(x,y,z,radius,height,material=this.metal,sides=8,topRadius=0,rotation=0) {
    this._part(new THREE.CylinderGeometry(topRadius/radius,1,1,sides),material,new THREE.Vector3(x,y+height*.5,z),
      new THREE.Vector3(radius,height,radius),rotation);
  }

  _beam(a,b,radius,material=this.metal) {
    const delta=new THREE.Vector3().subVectors(b,a),length=delta.length();if(length<.01)return;
    this._part(new THREE.CylinderGeometry(1,1,1,5),material,new THREE.Vector3().addVectors(a,b).multiplyScalar(.5),
      new THREE.Vector3(radius,length,radius),0,0xffffff,0,new THREE.Quaternion().setFromUnitVectors(V3_UP,delta.normalize()));
  }

  _landmark(info) {
    const p=newYorkPoint(info.lat,info.lon),base=this._ground(p.x,p.z,3),a=-Math.PI/6.15;
    const {x,z}=p,h=info.height,w=info.width,d=info.depth,seed=hash(Math.floor(x+z))*1000;
    this.landmarks.push({...info,x,z,base});
    // A union of individual visual tiers supplies collision, rather than a
    // full-height bounding prism around slender antennas and setbacks.
    const tier=(bottom,height,width,depth,material=this.facade,color=0xbdb8ac,rotation=a) => {
      this._box(x,base+bottom,z,width,height,depth,material,rotation,color,seed);
      this._collider({x,z,w:width,d:depth,base:base+bottom,top:base+bottom+height,angle:rotation,id:info.id,name:info.name});
    };
    const needle=(bottom,height,radius=2,material=this.metal) => {
      this._cone(x,base+bottom,z,radius,height,material,8,.35);
      this._collider({x,z,w:radius*2,d:radius*2,base:base+bottom,top:base+bottom+height,id:info.id,name:info.name});
    };
    if(info.kind==='liberty') {
      tier(0,11,35,35,this.stone,0xffffff,Math.PI/4);tier(11,19,23,23,this.stone,0xffffff,0);
      tier(30,17,16,16,this.stone,0xffffff,0);
      this._cone(x,base+47,z,8,27,this.copper,9,3.4);
      this._cone(x,base+74,z,2.8,6,this.copper,8,2.1);
      // Raised right arm, tablet and seven crown rays make Liberty readable
      // from the harbor at the monument's actual 93 m scale.
      this._beam(new THREE.Vector3(x+3,base+68,z),new THREE.Vector3(x+10,base+85,z),2.1,this.copper);
      this._cone(x+10,base+85,z,1.8,5,this.gold,8,.9);
      this._cone(x+10,base+90,z,1.7,3,this.gold,7,0);
      this._box(x-5,base+60,z+1,3.3,10,1.9,this.copper,.2,0xffffff);
      for(let i=0;i<7;i++){const t=i/6*Math.PI;this._beam(new THREE.Vector3(x,base+78,z),new THREE.Vector3(x+Math.cos(t)*6,base+78+Math.sin(t)*5,z),.32,this.copper);}
      this._collider({x,z,w:21,d:18,base:base+47,top:base+h,id:info.id,name:info.name});return;
    }
    if(info.kind==='empire') {
      tier(0,60,w,d);tier(60,33,w*.86,d*.87);tier(93,122,w*.61,d*.73);
      tier(215,75,w*.5,d*.64);tier(290,30,w*.39,d*.54);
      tier(320,23,22,23,this.stone,0xffffff);tier(343,27,15,16,this.stone,0xffffff);
      needle(370,11,5.5);needle(381,h-381,1.8);return;
    }
    if(info.kind==='chrysler') {
      tier(0,54,w,d);tier(54,71,w*.83,d*.84);tier(125,88,w*.68,d*.68);tier(213,35,w*.53,d*.54);
      for(let i=0;i<6;i++)this._cone(x,base+248+i*7,z,18.5-i*2.65,8,this.metal,4,Math.max(1,15-i*2.5),a+Math.PI/4);
      this._collider({x,z,w:31,d:31,base:base+248,top:base+290,angle:a,id:info.id,name:info.name});needle(289,h-289,1.8);return;
    }
    if(info.kind==='world') {
      tier(0,58,w,d,this.facade,0x9aacb3,Math.PI/4);
      // The octagonal taper preserves the faceted One WTC silhouette from
      // every approach without depending on a downloaded landmark model.
      this._cone(x,base+58,z,43,359,this.facade,8,28,Math.PI/8);
      for(let level=0;level<8;level++) {
        const bottom=58+359*level/8,height=359/8,radius=43-15*level/8;
        this._collider({x,z,w:radius*1.85,d:radius*1.85,base:base+bottom,top:base+bottom+height,id:info.id,name:info.name});
      }
      tier(417,6,33,33,this.metal,0xffffff,Math.PI/4);needle(423,h-423,1.5);return;
    }
    if(info.kind==='gothic'||info.kind==='deco') {
      tier(0,h*.38,w,d);tier(h*.38,h*.28,w*.7,d*.7);tier(h*.66,h*.17,w*.48,d*.5);
      this._cone(x,base+h*.83,z,w*.32,h*.13,info.kind==='gothic'?this.copper:this.stone,4,1,a+Math.PI/4);
      this._collider({x,z,w:w*.4,d:d*.4,base:base+h*.83,top:base+h*.96,angle:a,id:info.id,name:info.name});needle(h*.96,h*.04,.7);return;
    }
    if(info.kind==='rock') {tier(0,45,w,d*1.8);tier(45,165,w*.9,d);tier(210,h-210,w*.65,d*.9);return;}
    if(info.kind==='slender') {tier(0,h*.16,w*1.2,d*1.2,this.facade,0x9fadae);tier(h*.16,h*.84,w,d,this.facade,0xaebbbe);return;}
    if(info.kind==='modern') {tier(0,h*.25,w,d,this.facade,0x899da5);tier(h*.25,h*.65,w*.81,d*.85,this.facade,0x91a4ae);tier(h*.9,h*.1,w*.55,d*.8,this.metal,0xffffff);return;}
    tier(0,h,w,d,this.facade,info.id==='un'?0x7998a0:0xafa99d);
  }

  _bridge(info) {
    const a=newYorkPoint(...info.a),b=newYorkPoint(...info.b),dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    const tx=dx/length,tz=dz/length,nx=-tz,nz=tx,span=Math.min(info.span,length*.78),end=(length-span)*.5;
    const at=(t,y,side=0)=>new THREE.Vector3(a.x+tx*t+nx*side,y,a.z+tz*t+nz*side);
    const deckAngle=-Math.atan2(dz,dx);
    const aHeight=Math.min(info.deck+10,this._ground(a.x,a.z,3)+4),bHeight=Math.min(info.deck+10,this._ground(b.x,b.z,3)+4);
    const deckHeight=t=>t<end?aHeight+(info.deck-aHeight)*t/end:
      t>length-end?bHeight+(info.deck-bHeight)*(length-t)/end:info.deck;
    // Graded approaches meet the two banks; the river span is level. Short
    // oriented collision slabs preserve underflight without a giant solid box.
    for(let i=0;i<16;i++) {
      const t0=length*i/16,t1=length*(i+1)/16,y0=deckHeight(t0),y1=deckHeight(t1);
      const begin=at(t0,y0-1.5),finish=at(t1,y1-1.5),axis=new THREE.Vector3().subVectors(finish,begin);
      const xAxis=axis.clone().normalize(),zAxis=new THREE.Vector3(nx,0,nz),yAxis=new THREE.Vector3().crossVectors(zAxis,xAxis).normalize();
      const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis,yAxis,zAxis));
      const center=new THREE.Vector3().addVectors(begin,finish).multiplyScalar(.5);
      this._part(new THREE.BoxGeometry(1,1,1),this.road,center,new THREE.Vector3(axis.length(),3,info.width),0,0xffffff,0,orientation);
      this._collider({x:center.x,z:center.z,w:t1-t0,d:info.width,base:Math.min(y0,y1)-3,top:Math.max(y0,y1),angle:deckAngle,id:info.id,name:info.name});
    }
    const towerMat=info.stone?this.stone:this.metal;
    for(const distance of [end,length-end]) {
      for(const side of [-1,1]) {
        const p=at(distance,0,side*(info.width*.42));
        this._box(p.x,0,p.z,info.stone?13:7,info.tower,info.stone?13:7,towerMat,deckAngle,0xffffff);
        this._collider({x:p.x,z:p.z,w:info.stone?13:7,d:info.stone?13:7,base:0,top:info.tower,id:info.id,name:info.name});
      }
      for(const h of [info.deck+13,info.tower-7])this._beam(at(distance,h,-info.width*.45),at(distance,h,info.width*.45),info.stone?4.3:2.2,towerMat);
      if(!info.stone)this._beam(at(distance,info.deck+10,-info.width*.4),at(distance,info.tower-10,info.width*.4),1.4,this.metal);
      if(!info.stone)this._beam(at(distance,info.deck+10,info.width*.4),at(distance,info.tower-10,-info.width*.4),1.4,this.metal);
    }
    for(const side of [-1,1]) {
      const lateral=side*info.width*.43;
      const cableHeight=t=>{
        if(t<end)return aHeight+5+(info.tower-aHeight-5)*t/end;
        if(t>length-end)return bHeight+5+(info.tower-bHeight-5)*(length-t)/end;
        const u=(t-length*.5)/(span*.5);return info.deck+8+(info.tower-info.deck-8)*u*u;
      };
      const segments=info.span>900?72:48;
      for(let i=0;i<segments;i++) {
        const t0=length*i/segments,t1=length*(i+1)/segments;
        this._beam(at(t0,cableHeight(t0),lateral),at(t1,cableHeight(t1),lateral),1.1,this.metal);
        if(i%2===0)this._beam(at(t0,deckHeight(t0),lateral),at(t0,cableHeight(t0),lateral),.38,this.metal);
        if(info.truss&&i%2===0)this._beam(at(t0,deckHeight(t0)+2,lateral),at(t1,deckHeight(t1)+15,lateral),.7,this.metal);
        this._beam(at(t0,deckHeight(t0)+1,lateral),at(t1,deckHeight(t1)+1,lateral),1.1,this.metal);
      }
    }
  }

  _flushParts() {
    for(const {material,parts,cx,cz} of this._parts.values()) {
      const mesh=new THREE.Mesh(mergeParts(parts),material);mesh.name='New York landmarks and bridges';
      mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;this.group.add(mesh);
      this.chunks.push({mesh,x:(cx+.5)*NYC_CHUNK_M,z:(cz+.5)*NYC_CHUNK_M,range:39000});
    }
    this._parts.clear();
  }

  update(camera,elevationDeg=45) {
    const position=camera?.position||camera;
    if(position&&Number.isFinite(position.x)&&Number.isFinite(position.z)) {
      for(const chunk of this.chunks) {
        // Hysteresis prevents repeated visibility flips at the outer horizon.
        // At these distances the atmosphere has already softened the massing.
        const limit=chunk.range+(chunk.mesh.visible?1800:0);
        chunk.mesh.visible=(position.x-chunk.x)**2+(position.z-chunk.z)**2<limit*limit;
      }
    }
    this._night.value=Number.isFinite(elevationDeg)?Math.max(0,Math.min(1,(-elevationDeg+3)/9))*.85:0;
  }

  // from/to are ENU arrays (flight state arrays are accepted directly), or
  // {x:east,y:north,z:altitude}; never Three-space (east,altitude,north).
  intersectsSegment(from,to,padding=3) {
    const a=ArrayBuffer.isView(from)||Array.isArray(from)?from:[from.x,from.y,from.z];
    const b=ArrayBuffer.isView(to)||Array.isArray(to)?to:[to.x,to.y,to.z];
    if(![a[0],a[1],a[2],b[0],b[1],b[2]].every(Number.isFinite))return null;
    const pad=Math.max(0,Math.min(50,Number.isFinite(padding)?padding:3));
    const loX=Math.floor((Math.min(a[0],b[0])-pad)/COLLISION_CELL_M),hiX=Math.floor((Math.max(a[0],b[0])+pad)/COLLISION_CELL_M);
    const loZ=Math.floor((Math.min(a[1],b[1])-pad)/COLLISION_CELL_M),hiZ=Math.floor((Math.max(a[1],b[1])+pad)/COLLISION_CELL_M);
    const query=++this._query;
    // Reset/handoff can jump tens of kilometres; checking that teleport's full
    // enclosing grid would waste a frame. All city AABBs are cheaper then.
    if((hiX-loX+1)*(hiZ-loZ+1)>256) {
      for(const box of this.colliders)if(Math.min(a[2],b[2])<=box.top+pad&&segmentHit(box,a,b,pad))return box;
      return null;
    }
    for(let cx=loX;cx<=hiX;cx++)for(let cz=loZ;cz<=hiZ;cz++) {
      const cell=this._cells.get(`${cx},${cz}`);if(!cell)continue;
      for(const index of cell) {
        if(this._seen[index]===query)continue;this._seen[index]=query;
        const box=this.colliders[index];if(Math.min(a[2],b[2])>box.top+pad)continue;
        if(segmentHit(box,a,b,pad))return box;
      }
    }
    return null;
  }

  dispose() {
    if(this._disposed)return;this._disposed=true;
    for(const chunk of this.chunks)chunk.mesh.geometry.dispose();
    for(const material of this._materials)material.dispose();
    this.group.removeFromParent();this.group.clear();this._cells.clear();this.colliders.length=0;this.chunks.length=0;
  }
}

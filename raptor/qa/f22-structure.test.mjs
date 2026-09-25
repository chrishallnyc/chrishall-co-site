// Native geometry/pose regressions: no browser or GPU required.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildAirframeGeometry,F22_CANOPY} from '../src/aircraft/geometry/f22-airframe.js';
import {buildF22,updateF22Visuals} from '../src/aircraft/f22v3.js';
import {syncGearBays} from '../src/aircraft/gear-bays.js';
import {F22_LIFTING_CHARTS,chartUV} from '../src/aircraft/geometry/f22-uv.js';

async function geometryFixture(quality) {
 // Raster drawing and image loading are the only stubs. All aircraft
 // geometry, authored normals, rigs, cloning and LOD resources remain real.
 const load=THREE.TextureLoader.prototype.load,document=globalThis.document;
 THREE.TextureLoader.prototype.load=function(_url,onLoad){const texture=new THREE.Texture();queueMicrotask(()=>onLoad?.(texture));return texture;};
 globalThis.document={createElement(type){
  assert.equal(type,'canvas');const canvas={width:1,height:1};
  const pixels=(_x,_y,width,height)=>({data:new Uint8ClampedArray(width*height*4)});
  const context={canvas,getImageData:pixels,createImageData:(width,height)=>pixels(0,0,width,height)};
  for(const name of ['fillRect','strokeRect','clearRect','beginPath','closePath','moveTo','lineTo','arc',
    'fill','stroke','fillText','save','restore','rect','clip','putImageData'])context[name]=()=>{};
  canvas.getContext=()=>context;return canvas;
 }};
 try{const built=buildF22({quality});await built.ready;return built;}
 finally{THREE.TextureLoader.prototype.load=load;if(document===undefined)delete globalThis.document;else globalThis.document=document;}
}

function row(geometry,z){
 const p=geometry.attributes.position,values=[];
 for(let i=0;i<p.count;i++)if(Math.abs(p.getZ(i)-z)<1e-6)values.push([p.getX(i),p.getY(i),p.getZ(i)]);
 return values.sort((a,b)=>a[0]-b[0]);
}
for(const quality of ['high','medium','low'])test(`${quality} cockpit closures share exact nose and spine vertices`,()=>{
 const surfaces=buildAirframeGeometry({quality,cutOpenings:false});
 for(const side of ['R','L'])for(const [neighbor,z] of [['noseUpper',F22_CANOPY[0].z],['spineUpper',F22_CANOPY.at(-1).z]]){
  const cheek=row(surfaces.find(s=>s.name===`cockpitCheek${side}`).geometry,z);
  const border=row(surfaces.find(s=>s.name===`${neighbor}${side}`).geometry,z);
  assert(cheek.length>3,'A sampled border is required');
  assert.deepEqual(cheek,border,'Coincident analytic curves alone do not seal differently sampled triangle edges');
 }
 for(const surface of surfaces)surface.geometry.dispose();
});

for(const quality of ['high','medium','low'])test(`${quality} mirrored wing and stabilator retain authored normals at every visual LOD`,async()=>{
 const {group}=await geometryFixture(quality),levels=['high','medium','low'];
 for(const level of levels.slice(levels.indexOf(quality))){
  updateF22Visuals(group,{forceLevel:level});
  const suffix=level===quality?'':`:lod-${level}`;
  for(const [rightName,leftName] of [['wingRmesh','wingLmesh'],['stabRmesh','stabLmesh']]){
   const right=group.getObjectByName(rightName+suffix),left=group.getObjectByName(leftName+suffix);
   assert(right?.visible&&left?.visible,'Both actual selected LOD surfaces are visible');
   const r=right.geometry,l=left.geometry,p=r.attributes.position,q=l.attributes.position,n=r.attributes.normal,m=l.attributes.normal;
   assert(p.count>100,'Compare the sampled aircraft surface, not a primitive mirror fixture');
   assert.equal(p.count,q.count);assert.equal(n.count,m.count);assert.equal(r.index.count,l.index.count);
   for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++){
    const sign=axis===0?-1:1;
    assert(Math.abs(sign*p.getComponent(i,axis)-q.getComponent(i,axis))<1e-6,'Matched vertices reflect across aircraft X');
    assert(Math.abs(sign*n.getComponent(i,axis)-m.getComponent(i,axis))<1e-6,
      `${quality}/${level}/${leftName} vertex${i} normal axis${axis} lost its authored reflection`);
   }
   for(let i=0;i<r.index.count;i+=3){
    assert.equal(l.index.getX(i),r.index.getX(i));
    assert.equal(l.index.getX(i+1),r.index.getX(i+2),'Mirroring retains outward triangle winding');
    assert.equal(l.index.getX(i+2),r.index.getX(i+1));
   }
  }
 }
});

test('main gear doors clear the wheel throughout extension and return to the exact closed transform',async()=>{
 const built=await geometryFixture('low');
 const {group,parts}=built;updateF22Visuals(group,{forceLevel:'low'});
 syncGearBays(group,0,true);group.updateMatrixWorld(true);
 // Closed doors must carry their own side's lower-wing paint and retain the
 // neutral-parent detail coordinates, even after clipping and fairing bends.
 for(const [side,sign] of [['right',1],['left',-1]]){
  const mesh=group.getObjectByName(`gearDoor_${side}_1`).getObjectByName('gearDoorWing');
  const {uv,uv1,position}=mesh.geometry.attributes,chart=F22_LIFTING_CHARTS[`wingLower${sign<0?'Left':''}`];
  assert(uv.count>0);
  for(let i=0;i<uv.count;i++){
   const point=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
   const expected=chartUV(chart,uv1.getX(i),Math.abs(uv1.getY(i)));
   assert(sign*uv1.getY(i)>0,'Detail coordinates mirror with the owning wing');
   assert(Math.abs(uv1.getX(i)-point.z)<2e-6,'Longitudinal paint projection survives clipping');
   assert(Math.abs(uv.getX(i)-expected[0])<2e-6&&Math.abs(uv.getY(i)-expected[1])<2e-6,`${side} door uses its own lower-wing atlas`);
  }
 }
 const doors=[];group.traverse(o=>{if(o.userData.gearDoor&&!o.userData.gearDoor.nose&&o.name.endsWith('_0'))doors.push(o);});
 assert.equal(doors.length,2);
 const closed=doors.map(door=>({position:door.position.clone(),quaternion:door.quaternion.clone()}));
 const points=new Map();
 for(const door of doors){
  const samples=[];door.traverseVisible(mesh=>{
   if(!mesh.isMesh)return;mesh.updateMatrixWorld(true);
   const toDoor=new THREE.Matrix4().multiplyMatrices(door.matrixWorld.clone().invert(),mesh.matrixWorld);
   const p=mesh.geometry.attributes.position,index=mesh.geometry.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
   for(let i=0;i<index.count;i+=3){
    a.fromBufferAttribute(p,index.getX(i)).applyMatrix4(toDoor);b.fromBufferAttribute(p,index.getX(i+1)).applyMatrix4(toDoor);c.fromBufferAttribute(p,index.getX(i+2)).applyMatrix4(toDoor);
    // Dense barycentric sampling also catches crossings between the original
    // coarse low-LOD vertices. The required margin exceeds this sample pitch.
    const n=Math.max(1,Math.ceil(Math.max(a.distanceTo(b),a.distanceTo(c),b.distanceTo(c))/.025));
    for(let j=0;j<=n;j++)for(let k=0;k<=n-j;k++)samples.push(a.clone().multiplyScalar(1-(j+k)/n).addScaledVector(b,j/n).addScaledVector(c,k/n));
   }
  });points.set(door,samples);
 }
 let minimum=Infinity;
 for(let step=0;step<=40;step++){
  syncGearBays(group,step/40,true);group.updateMatrixWorld(true);
  for(const door of doors){
   const part=parts[door.name.includes('right')?'gearR':'gearL'],spec=part.userData.landingGear;
   const toWheel=new THREE.Matrix4().multiplyMatrices(part.matrixWorld.clone().invert(),door.matrixWorld);
   const center=new THREE.Vector3(...spec.wheelCenter),point=new THREE.Vector3();
   for(const sample of points.get(door)){
    point.copy(sample).applyMatrix4(toWheel).sub(center);
    // A full-width cylinder contains the actual rounded tire and hub.
    const clearance=Math.max(Math.abs(point.x)-spec.wheelWidth/2,Math.hypot(point.y,point.z)-spec.wheelRadius);
    minimum=Math.min(minimum,clearance);
   }
  }
 }
 assert(minimum>.025,`Door sweep margin ${minimum} must exceed the 25 mm sampling pitch`);
 syncGearBays(group,0,true);group.updateMatrixWorld(true);
 doors.forEach((door,i)=>{assert.deepEqual(door.position.toArray(),closed[i].position.toArray());assert.deepEqual(door.quaternion.toArray(),closed[i].quaternion.toArray());});
});

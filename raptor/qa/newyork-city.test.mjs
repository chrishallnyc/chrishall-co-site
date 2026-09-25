import './register-three.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const THREE=await import('three');
const {NewYorkCity,newYorkPoint,NEWYORK_LANDMARKS,NEWYORK_BRIDGES}=await import('../src/world/newyork.js');
const {PlanetObjectBender}=await import('../src/world/planetobjects.js');
const {PlanetCurvature}=await import('../src/world/planetcurvature.js');

const snapshot=rows=>({version:1,buildings:rows});
const terrain={heightAt:()=>12};
const simple=[9000,-9000,40,20,90,Math.PI/4,1980,5,1];

test('geography uses the engine positive-north Z convention and surveyed dimensions',()=>{
  assert.deepEqual(newYorkPoint(40.7,-74,400),{x:0,y:400,z:0});
  const liberty=newYorkPoint(40.68925,-74.0445);
  assert.ok(liberty.x<-3700&&liberty.x>-3800);
  assert.ok(liberty.z<-1100&&liberty.z>-1300);
  const empire=NEWYORK_LANDMARKS.find(l=>l.id==='empire-state');
  assert.equal(empire.height,443.2);
  assert.equal(NEWYORK_BRIDGES.length,6);
});

test('the baked official city snapshot is bounded, reproducible and covers the skyline',()=>{
  const data=JSON.parse(readFileSync(new URL('../assets/city/newyork-buildings.json',import.meta.url)));
  assert.deepEqual(data.center,[40.7,-74]);
  assert.ok(data.buildings.length>40000&&data.buildings.length<70000);
  for(const row of data.buildings) {
    assert.equal(row.length,9);
    assert.ok(row.every(Number.isFinite));
    assert.ok(row[2]>0&&row[3]>0&&row[4]>0&&row[4]<511);
  }
  const city=new NewYorkCity({terrain,buildings:data});
  assert.ok(city.stats.buildings>40000);
  let triangles=0;
  city.group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.count??1);
    assert.ok(mesh.geometry.attributes.citySize,'facade attributes exist on both instanced and merged geometry');
  });
  assert.ok(triangles<1200000,`${triangles} triangles exceed city budget`);
  assert.ok(city.stats.drawCalls<70,`${city.stats.drawCalls} meshes exceed city budget`);
  const camera=new THREE.PerspectiveCamera(60,1.6,1,100000),frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
  for(let i=0;i<24;i++) {
    const angle=i/24*Math.PI*2;
    camera.position.set(Math.cos(angle)*6000,1500,4500+Math.sin(angle)*6000);
    camera.lookAt(0,200,4500);camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const visible=city.chunks.filter(c=>frustum.intersectsObject(c.mesh)).length;
    assert.ok(visible<60,`${visible} city meshes visible on approach ${i}`);
  }
  city.dispose();
});

test('historical aftermath excludes modern towers and the World Trade Center site',()=>{
  const world=newYorkPoint(40.7117,-74.013);
  const rows=[simple,[...simple.slice(0,6),2010,5,2],
    [world.x,world.z,70,70,417,0,1973,5,3]];
  const city=new NewYorkCity({terrain,era:'2001-aftermath',buildings:snapshot(rows)});
  assert.equal(city.stats.buildings,1);
  assert.ok(city.landmarks.some(l=>l.id==='empire-state'));
  for(const id of ['one-world','432-park','central-park-tower','hudson-yards'])
    assert.ok(!city.landmarks.some(l=>l.id===id),`${id} did not exist in 2001`);
  assert.equal(city.intersectsSegment([world.x,world.z,50],[world.x,world.z,500]),null);
  city.dispose();
});

test('rotated building collisions detect tunneling, wing padding and clear overflight',()=>{
  const city=new NewYorkCity({terrain,buildings:snapshot([simple])});
  assert.equal(city.intersectsSegment([8900,-9000,50],[9100,-9000,50])?.id,1);
  assert.equal(city.intersectsSegment(new Float64Array([9000,-9100,50,999]),new Float64Array([9000,-8900,50,999]))?.id,1);
  assert.equal(city.intersectsSegment([8900,-9000,120],[9100,-9000,120]),null);
  // A line parallel to the long rotated face lies one metre beyond its edge.
  const c=Math.cos(simple[5]),s=Math.sin(simple[5]);
  const point=(x,z)=>[simple[0]+c*x+s*z,simple[1]-s*x+c*z,50];
  assert.equal(city.intersectsSegment(point(-10,11),point(10,11),0),null);
  assert.equal(city.intersectsSegment(point(-10,11),point(10,11),3)?.id,1);
  assert.equal(city.intersectsSegment([NaN,0,0],[0,0,0]),null);
  city.dispose();
});

test('bridge decks collide while aircraft can fly beneath the center span',()=>{
  const city=new NewYorkCity({terrain,buildings:snapshot([])});
  const bridge=NEWYORK_BRIDGES[0],a=newYorkPoint(...bridge.a),b=newYorkPoint(...bridge.b);
  const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
  assert.equal(city.intersectsSegment([x,z,bridge.deck-2],[x,z,bridge.deck+2],0)?.id,bridge.id);
  assert.equal(city.intersectsSegment([x-5,z,15],[x+5,z,15],0),null);
  city.dispose();
});

test('landmark setbacks leave airspace outside the actual upper silhouette',()=>{
  const city=new NewYorkCity({terrain,buildings:snapshot([])});
  const empire=city.landmarks.find(l=>l.id==='empire-state');
  assert.equal(city.intersectsSegment([empire.x,empire.z,400],[empire.x,empire.z,410],0)?.id,'empire-state');
  assert.equal(city.intersectsSegment([empire.x+30,empire.z,400],[empire.x+35,empire.z,410],0),null);
  city.dispose();
});

test('all city geometry follows existing curvature and stable static material contracts',()=>{
  const city=new NewYorkCity({terrain,buildings:snapshot([simple])});
  const curvature=new PlanetCurvature(),bender=new PlanetObjectBender(curvature);
  assert.doesNotThrow(()=>bender.attach(city.group,{staticSurface:true,stableInstances:true}));
  assert.doesNotThrow(()=>bender.update());
  city.group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    assert.ok(mesh.material.positionNode&&mesh.material.mrtNode);
    assert.ok(Number.isFinite(mesh.boundingSphere.radius));
  });
  const oldMaterial=city.facade,version=oldMaterial.version;
  city.update(new THREE.Vector3(100000,1000,100000),-8);bender.update();
  assert.ok(city.chunks.every(c=>!c.mesh.visible));
  city.update({position:new THREE.Vector3(0,1000,0)},45);bender.update();
  assert.equal(city.facade,oldMaterial);
  assert.equal(city.facade.version,version,'day/night does not compile a new material');
  assert.doesNotThrow(()=>{city.dispose();city.dispose();});
});

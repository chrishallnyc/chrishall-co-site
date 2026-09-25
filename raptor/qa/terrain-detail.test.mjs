import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/world/terrain.js';
import { PlanetCurvature } from '../src/world/planetcurvature.js';

function fixture({curved=true,capable=true}={}) {
 const curvature=curved?new PlanetCurvature():null;
 const terrain=new Terrain({minH:0,maxH:100,grid:32,sizeM:65536},new Float32Array(32*32),{width:32,height:32},'NELLIS',null,{},null,curvature,capable);
 const camera=new THREE.PerspectiveCamera(60,16/9,1,250000);camera.position.set(100,100,100);camera.lookAt(100,0,-1000);camera.updateMatrixWorld();
 const step=dt=>{curvature?.beginFrame(camera);terrain.update(camera,dt);curvature?.endFrame();};
 const dispose=()=>{terrain.grid.dispose();terrain.fineGrid?.dispose();terrain.material.dispose();terrain.tex.dispose();};
 return{terrain,camera,curvature,step,dispose};
}

for(const curved of [false,true])test(`actual ${curved?'curved':'flat'} Terrain pool drops fine draws after the final prior frame and retains its cache`,()=>{
 const f=fixture({curved});try{
  const {terrain:t}=f,heights=t.heights,material=t.material;
  t.setDetailTier('LOW');f.step(0);assert.equal(t.fineGrid,null);assert.equal(t.stats.fineNodes,0);assert.equal(t.stats.detailStrength,0);
  const positions=[[-1234,987],[0,0],[1243,-833]],before=positions.map(([x,z])=>t.heightAt(x,z));
  t.setDetailTier('HIGH');f.step(.05);assert.ok(t.stats.fineNodes>0);assert.ok(t.fineGrid);
  const cache=t.fineGrid;assert.equal(t.stats.previousDetailStrength,0);assert.ok(t.stats.detailStrength>0);assert.equal(t.stats.detailSettling,true);
  f.step(.25);assert.equal(t.stats.detailStrength,1);f.step(0);assert.equal(t.stats.detailSettling,false);
  const visible=t.pool.filter(m=>m.visible);assert.equal(visible.filter(m=>m.geometry===cache).length,t.stats.fineNodes);
  t.setDetailTier('MED');f.step(.3);assert.equal(t.stats.detailStrength,0);assert.equal(t.stats.previousDetailStrength,1);assert.ok(t.stats.fineNodes>0);
  f.step(0);assert.equal(t.stats.fineNodes,0);assert.equal(t.stats.detailSettling,false);assert.equal(t.fineGrid,cache);
  for(let n=0;n<4;n++){t.setDetailTier('ULTRA');f.step(.3);f.step(0);t.setDetailTier('LOW');f.step(.3);f.step(0);assert.equal(t.fineGrid,cache);}
  assert.equal(t.material,material);assert.equal(t.heights,heights);assert.deepEqual(positions.map(([x,z])=>t.heightAt(x,z)),before);
 }finally{f.dispose();}
});

test('HIGH prepares fine buffers before flight while distant terrain still selects coarse geometry',()=>{
 const f=fixture();try{
  f.terrain.setDetailTier('HIGH');
  const cache=f.terrain.fineGrid;assert.ok(cache);
  assert.ok(f.terrain.pool.every(m=>!m.visible&&m.geometry===f.terrain.grid));
  f.camera.position.set(0,50000,0);f.camera.lookAt(0,0,-1000);f.step(0);
  assert.equal(f.terrain.stats.fineNodes,0);assert.equal(f.terrain.fineGrid,cache);
  assert.ok(f.terrain.pool.filter(m=>m.visible).every(m=>m.geometry===f.terrain.grid));
  f.camera.position.set(100,100,100);f.camera.lookAt(100,0,-1000);f.step(0);
  assert.equal(f.terrain.fineGrid,cache);assert.ok(f.terrain.stats.fineNodes>0);
  assert.equal(f.terrain.stats.detailSettling,false,'First near draw does not allocate geometry');
  f.camera.position.set(0,50000,0);f.camera.lookAt(0,0,-1000);f.step(0);assert.equal(f.terrain.stats.fineNodes,0);assert.equal(f.terrain.fineGrid,cache);
 }finally{f.dispose();}
});

for(const tier of ['LOW','MED'])test(`${tier} never allocates fine buffers during preparation or near flight`,()=>{
 const f=fixture();try{
  f.terrain.setDetailTier(tier);assert.equal(f.terrain.prepareDetail(tier),null);
  for(let n=0;n<3;n++){f.step(.3);assert.equal(f.terrain.stats.fineNodes,0);assert.equal(f.terrain.fineGrid,null);}
 }finally{f.dispose();}
});

test('hard capability disable survives tier changes without creating fine buffers',()=>{
 const f=fixture({capable:false});try{
  for(const tier of ['LOW','HIGH','ULTRA','MED']){f.terrain.setDetailTier(tier);f.step(.3);assert.equal(f.terrain.stats.fineNodes,0);assert.equal(f.terrain.fineGrid,null);assert.equal(f.terrain.uDetailStrength.value,0);}
 }finally{f.dispose();}
});

test('curvature cut synchronizes prior strength and camera instead of creating stale morph motion',()=>{
 const f=fixture();try{
  f.step(0);f.terrain.setDetailTier('LOW');f.step(.1);assert.notEqual(f.terrain.uDetailStrength.value,f.terrain.uPreviousDetailStrength.value);
  f.curvature.invalidateHistory();f.camera.position.x+=500;f.step(.05);
  assert.equal(f.curvature.historyValid.value,false);assert.equal(f.terrain.uDetailStrength.value,f.terrain.uPreviousDetailStrength.value);
  assert.deepEqual(f.terrain.uDetailCamera.value.toArray(),f.terrain.uPreviousDetailCamera.value.toArray());
 }finally{f.dispose();}
});

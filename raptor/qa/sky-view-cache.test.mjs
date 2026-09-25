import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as T from 'three/tsl';
import {ObserverSkyViewCache} from '../src/world/sky-view-cache.js';
import {makeSkyRadiance} from '../src/world/sky-radiance.js';

function fixture() {
  const luts = {tTex:new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.HalfFloatType),
    msTex:new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.HalfFloatType)};
  for (const tex of Object.values(luts)) tex.minFilter=tex.magFilter=THREE.LinearFilter;
  const sources={uSunDir:T.uniform(new THREE.Vector3(.7,.5,.5).normalize()),uSunI:T.uniform(36),
    uMoonDir:T.uniform(new THREE.Vector3(-.4,.7,.4).normalize()),uMoonRatio:T.uniform(2.5e-6),
    uMoonColor:T.uniform(new THREE.Vector3(1,.98,.94)),uExposureGain:T.uniform(1)};
  const origin=T.uniform(new THREE.Vector3(10,3400,20)),observer=origin.value.clone();
  const renderer={target:{name:'borrowed target'},face:3,mip:2,mrt:{name:'borrowed MRT'},
    toneMapping:THREE.ACESFilmicToneMapping,autoClear:false,xr:{enabled:true},width:1920,height:1080,
    getDrawingBufferSize(v){return v.set(this.width,this.height);},
    getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},
    getActiveMipmapLevel(){return this.mip;},getMRT(){return this.mrt;},
    setRenderTarget(target,face=0,mip=0){Object.assign(this,{target,face,mip});},setMRT(mrt){this.mrt=mrt;}};
  const cache=new ObserverSkyViewCache({renderer,luts,sourceUniforms:sources,uFrameOrigin:origin});
  let draws=0;cache.quad.render=()=>{draws++;};
  return {cache,renderer,luts,sources,origin,observer,get draws(){return draws;},
    dispose(){cache.dispose();luts.tTex.dispose();luts.msTex.dispose();}};
}

test('sky cache follows physical observer, source and atmosphere changes in the same update',()=>{
  const f=fixture(),{cache,observer,origin,sources,luts}=f;
  try {
    assert(cache.update(observer));assert.equal(f.draws,1);
    assert.equal(cache.update(observer),false);
    observer.x+=700;origin.value.x+=700;observer.z-=400;origin.value.z-=400;
    assert.equal(cache.update(observer),false,'equivalent horizontal translation reuses radiance');
    for(const change of [()=>observer.y+=.01,()=>observer.x+=500,()=>sources.uSunDir.value.x+=.001,
      ()=>sources.uMoonDir.value.z-=.001,()=>sources.uMoonRatio.value*=2,()=>sources.uMoonColor.value.y*=.99,
      ()=>sources.uSunI.value*=2,()=>luts.tTex.needsUpdate=true,()=>luts.msTex.needsUpdate=true]){
      change();assert(cache.update(observer));assert(cache.uReady.value);
    }
    const y=observer.y;observer.y=NaN;assert.equal(cache.update(observer),false);assert(!cache.uReady.value);
    observer.y=y;assert(cache.update(observer));assert(cache.uReady.value);
  } finally {f.dispose();}
});

test('small render buffers use the direct sky and resize restores a fresh cache',()=>{
  const f=fixture();
  try {
    assert(f.cache.update(f.observer));f.renderer.width=640;f.renderer.height=360;
    assert.equal(f.cache.update(f.observer),false);assert(!f.cache.uReady.value);assert.equal(f.draws,1);
    f.observer.y+=100;assert.equal(f.cache.update(f.observer),false);
    f.renderer.width=1920;f.renderer.height=1080;
    assert(f.cache.update(f.observer));assert.equal(f.draws,2);assert(f.cache.uReady.value);
  } finally {f.dispose();}
});

test('sky bake restores renderer state on success and failure, and disposes only owned resources',()=>{
  const f=fixture(),r=f.renderer;
  const state=()=>[r.target,r.face,r.mip,r.mrt,r.toneMapping,r.autoClear,r.xr.enabled];
  const before=state();let targets=0,materials=0,borrowed=0;
  f.cache.target.addEventListener('dispose',()=>targets++);f.cache.material.addEventListener('dispose',()=>materials++);
  f.luts.tTex.addEventListener('dispose',()=>borrowed++);f.luts.msTex.addEventListener('dispose',()=>borrowed++);
  try {
    f.cache.update(f.observer);assert.deepEqual(state(),before);
    f.observer.y++;f.cache.quad.render=()=>{throw Error('draw failed');};
    const warn=console.warn;console.warn=()=>{};
    try {assert.equal(f.cache.update(f.observer),false);} finally {console.warn=warn;}
    assert.deepEqual(state(),before);assert(f.cache.stats.failed);assert(!f.cache.uReady.value);
    f.cache.dispose();f.cache.dispose();assert.equal(targets,1);assert.equal(materials,1);assert.equal(borrowed,0);
    assert.equal(f.cache.update(f.observer),false);
  } finally {f.dispose();}
});

test('sky cache compiles with the physical sky and cirrus on both pinned shader backends',()=>{
  for(const gl of [false,true]){
    const f=fixture(),r=new THREE.WebGPURenderer({canvas:{width:64,height:64,style:{},addEventListener(){},removeEventListener(){}},forceWebGL:gl});
    r.backend.renderer=r;r.hasFeature=()=>false;
    const cirrus=new THREE.DataTexture(new Uint8Array(4),2,2,THREE.RedFormat);
    cirrus.minFilter=cirrus.magFilter=THREE.LinearFilter;
    const radiance=makeSkyRadiance({luts:f.luts,sourceUniforms:f.sources,uFrameOrigin:f.origin,
      cirrusAtlas:cirrus,scatteringRadiance:f.cache.radiance,includeSolarDisc:true});
    const visible=new THREE.MeshBasicNodeMaterial({side:THREE.BackSide,fog:false,depthWrite:false});
    visible.colorNode=radiance(f.origin,T.normalize(T.positionWorld.sub(T.cameraPosition)));
    try {
      for(const [material,count] of [[f.cache.material,2],[visible,4]]){
        const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material);
        const b=new(gl?THREE.GLSLNodeBuilder:THREE.WGSLNodeBuilder)(mesh,r);
        b.scene=new THREE.Scene();b.camera=new THREE.PerspectiveCamera();b.build();
        const matches=b.fragmentShader.matchAll(gl?/uniform (?:highp )?sampler2D \w+/g:/var \w+ : texture_2d<f32>/g);
        assert.equal([...matches].length,count);mesh.geometry.dispose();
      }
    } finally {visible.dispose();cirrus.dispose();f.dispose();}
  }
});

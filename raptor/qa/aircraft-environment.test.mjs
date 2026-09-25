import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {uniform} from 'three/tsl';
import {SkyEnvironment, WaterSkyEnvironment} from '../src/world/sky-environment.js';
import {AircraftLighting} from '../src/aircraft/lighting.js';

function fixture(extra={}) {
 const saved={target:{name:'main'},face:2,mip:1,mrt:{name:'velocity'}};
 const state={...saved}, draws=[], published=[], scales=[];
 const renderer={coordinateSystem:THREE.WebGPUCoordinateSystem,reversedDepthBuffer:true,
  toneMapping:THREE.ACESFilmicToneMapping,autoClear:false,xr:{enabled:true},
  getRenderTarget:()=>state.target,getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.mip,
  getMRT:()=>state.mrt,setMRT:v=>state.mrt=v,
  setRenderTarget:(target,face=0,mip=0)=>Object.assign(state,{target,face,mip}),
  render:()=>draws.push({...state}),shadowMap:{}};
 const sources={uSunI:uniform(36),uSunDir:uniform(new THREE.Vector3(.3,.8,.4).normalize()),
  uMoonDir:uniform(new THREE.Vector3(0,-1,0)),uMoonRatio:uniform(.000001),uExposureGain:uniform(1)};
 const options={renderer,luts:{tTex:new THREE.Texture(),msTex:new THREE.Texture()},sourceUniforms:sources,
  publish:(texture,first)=>published.push({texture,first}),rescale:gain=>scales.push(gain),
  size:32,minInterval:4,...extra};
 const probe=new SkyEnvironment(options);
 probe._pmrem.fromCubemap=(texture,reuse)=>reuse || new THREE.RenderTarget(96,128);
 const camera=new THREE.PerspectiveCamera();camera.position.set(20,3000,-40);
 return {probe,renderer,state,saved,draws,published,scales,sources,camera,options};
}

test('probe freezes six faces and publishes only complete double-buffered captures',()=>{
 const f=fixture(),p=f.probe;p.warmUp(f.camera,0);
 assert.equal(f.draws.length,6);assert.equal(f.published.length,1);
 assert.deepEqual(f.draws.map(x=>x.face),[0,1,2,3,4,5]);
 assert(f.draws.every(x=>x.target===p.cubes[0]&&x.mrt===null));
 assert.deepEqual(f.state,f.saved);assert.equal(f.renderer.xr.enabled,true);
 assert.equal(f.renderer.autoClear,false);assert.equal(f.renderer.toneMapping,THREE.ACESFilmicToneMapping);
 p.invalidate('test');p.update(f.camera,1);
 const frozen=p.sources.uSunDir.value.clone();f.sources.uSunDir.value.set(1,0,0);
 f.camera.position.set(5000,100,-1000);
 for(let i=0;i<5;i++){p.update(f.camera,2+i);assert.equal(f.published.length,1);}
 assert(p.sources.uSunDir.value.equals(frozen));assert.equal(p.stats.facesRendered,12);
 p.update(f.camera,7);assert.equal(f.published.length,2);
 assert.notEqual(f.published[0].texture,f.published[1].texture);
 assert.equal(p.stats.convolutionCalls,2);assert.deepEqual(f.state,f.saved);p.dispose();
});

test('pre-exposure rescales without recapture and observer altitude invalidates aircraft probes',()=>{
 const observer=new THREE.Vector3(0,1000,0);const f=fixture({observer:()=>observer});
 f.probe.warmUp(f.camera,0);f.sources.uSunI.value=72;f.probe.update(f.camera,1);
 assert.equal(f.scales.at(-1),2);assert.equal(f.draws.length,6);
 observer.y=1700;f.probe.update(f.camera,5);
 assert.equal(f.probe.stats.lastReason,'translation');assert.equal(f.draws.length,7);f.probe.dispose();
});

test('a failed face restores main renderer state and retains the complete published map',()=>{
 const f=fixture();f.probe.warmUp(f.camera,0);f.probe.invalidate('failure-test');
 f.renderer.render=()=>{throw new Error('device capture failure');};
 const warn=console.warn;console.warn=()=>{};
 try{f.probe.update(f.camera,1);}finally{console.warn=warn;}
 assert.equal(f.probe.failed,true);assert.equal(f.published.length,1);assert.deepEqual(f.state,f.saved);
 assert.equal(f.renderer.xr.enabled,true);
 f.sources.uSunI.value=3600;f.probe.update(f.camera,2);
 assert.equal(f.scales.at(-1),100,'retained complete map still follows exposure after capture failure');
 assert.equal(f.published.length,1);f.probe.dispose();
});

test('water wrapper retains sea-level observer and its original environment intensity',()=>{
 const f=fixture(),material=new THREE.MeshPhysicalNodeMaterial();
 const water={mesh:{material},curvature:null};const p=new WaterSkyEnvironment({...f.options,water});
 p._pmrem.fromCubemap=()=>new THREE.RenderTarget(96,128);p.warmUp(f.camera,0);
 assert.equal(p.uObserver.value.y,1);assert.equal(material.envMapIntensity,.45);
 assert(material.envMap&&material.envNode);p.dispose();f.probe.dispose();
});

test('aircraft environment preserves coating layers and per-material intensity across publications',()=>{
 const f=fixture(),scene=new THREE.Scene(),sun=new THREE.DirectionalLight();
 const lighting=new AircraftLighting({renderer:f.renderer,atmosphere:{scene,sun},params:{shadows:false}});
 const map=new THREE.Texture(),scale=new THREE.Vector2(.2,.4);
 const source=new THREE.MeshPhysicalMaterial({envMapIntensity:.95,clearcoat:.3,
  clearcoatNormalMap:map,clearcoatNormalScale:scale,clearcoatRoughnessMap:map});
 const adapted=lighting.material(source);assert.equal(adapted.clearcoatNormalMap,map);
 assert(adapted.clearcoatNormalScale.equals(scale));
 const first=new THREE.Texture();lighting.setEnvironment(first);
 assert.equal(adapted.envMap,first);assert.equal(adapted.envMapIntensity,.95);
 const node=adapted.envNode;lighting.rescaleEnvironment(4);lighting.setEnvironment(new THREE.Texture());
 assert.equal(adapted.envNode,node);assert.equal(adapted.envMapIntensity,3.8);
 assert.equal(source.envMap,null);assert.equal(source.envMapIntensity,.95);
 lighting.dispose();f.probe.dispose();
});

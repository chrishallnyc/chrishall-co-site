// Compile the complete terrain receiver against the pinned Three distribution.
// No renderer.init(), browser, or GPU: this checks shader resources and source data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import * as T from 'three/tsl';
import {Terrain} from '../src/world/terrain.js';
import {TerrainSourceField} from '../src/world/terrainfield.js';
import {PlanetCurvature} from '../src/world/planetcurvature.js';
import {surfaceCelestialTransport} from '../src/world/celestial-surface.js';
import {cloudNoiseFromData} from '../src/world/cloudnoise.js';
import {makeVolCloudShadowNode} from '../src/world/volclouds.js';
import {AircraftLighting} from '../src/aircraft/lighting.js';
import {terrainMaterialNodes} from '../src/world/terrainmaterials.js';
import {aerialCompositeNode} from '../src/world/hillaire.js';

const canvas={width:1440,height:900,style:{},addEventListener(){},removeEventListener(){}};
const texture=name=>{
 const t=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1,THREE.RGBAFormat);
 t.name=name;return t;
};
const halfTexture=(name,width=1,height=1)=>{
 const t=new THREE.DataTexture(new Uint16Array(width*height*4),width,height,THREE.RGBAFormat,THREE.HalfFloatType);
 t.name=name;t.minFilter=t.magFilter=THREE.LinearFilter;return t;
};
const noise=cloudNoiseFromData({seed:1337,baseN:128,detailN:64,baseData:new Uint8Array(128**3*4),
 detailData:new Uint8Array(64**3*4),normalization:{lo:.25,hi:.875},resolution:'standard',version:1});
noise.baseTex.name='cloudBase3D';noise.detailTex.name='cloudDetail3D';
class GraphTerrain extends Terrain {
 getShoreField(){return this._graphShore||={tex:texture('terrainShoreDistance'),maxDist:1400};}
}
function compile(api,front){
 const renderer=new THREE.WebGPURenderer({canvas,forceWebGL:api==='glsl'});
 renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;renderer.hasCompatibility=()=>false;
 renderer.backend.capabilities||={};renderer.backend.capabilities.getUniformBufferLimit=()=>65536;
 const camera=new THREE.PerspectiveCamera(60,1.6,1,250000);
 camera.coordinateSystem=api==='wgsl'?THREE.WebGPUCoordinateSystem:THREE.WebGLCoordinateSystem;
 camera.position.set(0,2166,0);camera.lookAt(-1000,1000,1000);camera.updateProjectionMatrix();camera.updateMatrixWorld();
 const curvature=new PlanetCurvature();curvature.beginFrame(camera);curvature.endFrame();curvature.beginFrame(camera);
 const sunDir=T.uniform(new THREE.Vector3(.3,.8,.4).normalize()),moonDir=T.uniform(new THREE.Vector3(-.7,.2,-.3).normalize());
 const celestial={uSunDir:sunDir,uMoonDir:moonDir,uSunI:T.uniform(36),uMoonRatio:T.uniform(2.5e-6),
  uMoonColor:T.uniform(new THREE.Vector3(1,.93,.8)),uExposureGain:T.uniform(1),uNightSkyRadiance:T.uniform(new THREE.Vector3(.001,.002,.003)),uMoonAngularRadius:T.uniform(.0046)};
 const tTex=halfTexture('atmosphereTransmittance',256,64),msTex=halfTexture('atmosphereMultiscatter',32,32);
 const args={...celestial,tTex,msTex,uCamPos:T.uniform(camera.position.clone())};
 const solar=makeVolCloudShadowNode({noise,front,uSunDir:sunDir,curvature}),lunar=makeVolCloudShadowNode({noise,front,uSunDir:moonDir,curvature});
 const solarTr=surfaceCelestialTransport({direction:sunDir,curvature}),lunarTr=surfaceCelestialTransport({direction:moonDir,angularRadius:celestial.uMoonAngularRadius,curvature,lunarTransmission:true});
 const visibility=(projector,transport)=>T.Fn(()=>{
  const tr=transport(T.positionWorld).toVar(),result=T.vec3(0).toVar();
  T.If(tr.x.add(tr.y).add(tr.z).greaterThan(1e-8),()=>result.assign(projector(T.positionWorld).mul(tr)));
  return result;
 })();
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(0xffffff,1),moon=new THREE.DirectionalLight(0xffffff,.001),hemi=new THREE.HemisphereLight(0x739ac0,0x191714,.35);
 const lighting=new AircraftLighting({renderer,atmosphere:{scene,sun},params:{shadows:true,shadowSize:2048},curvature});
 lighting.setSunVisibility(visibility(solar,solarTr));moon.castShadow=true;moon.shadow.shadowNode=visibility(lunar,lunarTr);
 const aerial={composite:aerialCompositeNode(args,celestial.uSunI,{VALDEZ:.8,NELLIS:.42,MARIANAS:1}[front])};
 const source=front==='VALDEZ'?new TerrainSourceField({worldBounds:{xmin:-8000,xmax:8000,zmin:-12000,zmax:4000},
  width:16,height:16,minH:500,maxH:2600,blendWidthM:512},new Uint8Array(512).fill(80),new Uint8Array(1024).fill(128)):null;
 const drape={nrm:texture('terrainNormal'),albedo:texture('terrainAlbedo'),cover:texture('terrainImageryCoverage'),ao:texture('terrainAO')};
 const terrain=new GraphTerrain({minH:-15,maxH:3756,grid:32,sizeM:65536},new Float32Array(1024).fill(1600),{width:32,height:32},front,solar,drape,aerial,curvature,true,source);
 terrain.tex.name='terrainBaseHeight';terrain.update(camera);terrain.material.lightsNode=T.lights([sun,moon,hemi]);
 const pmrem=halfTexture('PMREM.cubeUv',768,1024);
 Object.assign(pmrem,{mapping:THREE.CubeUVReflectionMapping,isPMREMTexture:true,isRenderTargetTexture:true,
  colorSpace:THREE.LinearSRGBColorSpace,generateMipmaps:false});
 scene.environment=pmrem;scene.add(terrain.group,sun,moon,hemi);
 const mesh=terrain.pool[0];mesh.geometry=terrain.fineGrid;mesh.scale.set(2048,1,2048);mesh.updateMatrixWorld();
 const target=new THREE.RenderTarget(1440,900,{count:2});target.textures[0].name='output';target.textures[1].name='velocity';
 renderer.setRenderTarget(target);renderer.setMRT(T.mrt({output:T.output,velocity:T.velocity}));
 const builder=new(api==='wgsl'?THREE.WGSLNodeBuilder:THREE.GLSLNodeBuilder)(mesh,renderer);
 builder.scene=scene;builder.camera=camera;builder.environmentNode=T.texture(pmrem);
 // Existing upstream inline-Fn warnings are not native validation errors.
 const warn=console.warn,warnings=[];console.warn=(...v)=>warnings.push(v.join(' '));
 try {builder.build();} finally {console.warn=warn;}
 const code=builder.fragmentShader,uniforms=Object.values(builder.uniforms).flat();
 const fragmentBindings=api==='wgsl'?builder.getBindings().flatMap(g=>g.bindings)
  .filter(b=>b.isSampledTexture&&(b.visibility&2)).map(b=>b.name):null;
 const matches=api==='wgsl'?[...code.matchAll(/var\s+(nodeUniform\d+)\s*:\s*(texture_[^;]+);/g)]
  :[...code.matchAll(/uniform\s+([iu]?sampler\w+)\s+(nodeUniform\d+)\s*;/g)].map(m=>[m[0],m[2],m[1]]);
 const layout=matches.map(m=>({binding:m[1],type:m[2],name:uniforms.find(u=>u.name===m[1])?.node?.value?.name}));
 terrain.material.dispose();terrain.grid.dispose();terrain.fineGrid?.dispose();terrain.tex.dispose();terrain._graphShore?.tex.dispose();
 for(const t of Object.values(drape))t.dispose();source?.dispose();target.dispose();lighting.dispose();pmrem.dispose();tTex.dispose();msTex.dispose();
 return {layout,fragmentBindings,code,vertex:builder.vertexShader,warnings};
}
for(const api of ['wgsl','glsl'])for(const front of ['VALDEZ','NELLIS','MARIANAS']){
 test(`${api} full ${front} terrain fits 16 fragment textures with native shadows`,()=>{
  const {layout,fragmentBindings,code,vertex,warnings}=compile(api,front);
  if(fragmentBindings)assert.deepEqual([...fragmentBindings].sort(),layout.map(t=>t.binding).sort(),
   'Actual fragment-visible sampled bindings match WGSL declarations');
  assert(layout.length<=16,`Full receiver needs ${layout.length} sampled textures; minimum device supports 16`);
  assert.equal(layout.length,{VALDEZ:16,NELLIS:13,MARIANAS:14}[front]);
  for(const name of ['terrainBaseHeight','terrainNormal','terrainAlbedo','terrainImageryCoverage','terrainShoreDistance',
   'terrainAO','cloudBase3D','ShadowDepthTexture','DFG_LUT','PMREM.cubeUv','atmosphereTransmittance','atmosphereMultiscatter'])
   assert(layout.some(t=>t.name===name),'Retain '+name);
  if(front==='VALDEZ')for(const name of ['terrainSourceHeight','terrainSourceNormal','terrain-snow-slope-moments'])assert(layout.some(t=>t.name===name),'Retain '+name);
  if(front==='MARIANAS')assert(layout.some(t=>t.name==='cloudDetail3D'),'Retain tropical tower field');
  const arrays=layout.filter(t=>t.name==='terrain-surface-slope-moments');assert.equal(arrays.length,1);
  assert.equal(arrays[0].type,api==='wgsl'?'texture_2d_array<f32>':'sampler2DArray');
  const samples=code.split('\n').filter(line=>line.includes(arrays[0].binding+',')&&/textureSample\(|texture\(/.test(line));
  assert.equal(samples.length,4,'Two original orientations for each material field');
  for(const layer of [0,1])assert.equal(samples.filter(line=>new RegExp(api==='wgsl'?', '+layer+' \\);':', '+layer+' \\) \\);').test(line)).length,2,'Constant field layer '+layer);
  assert.match(vertex,/terrainPreviousDetailHeight/,'Retain previous terrain displacement');
  assert.match(code,/m1|location\( 1 \)/,'Retain velocity attachment');
  assert(warnings.every(w=>w.includes("Return statement used in an inline 'Fn()'")),'No unexpected builder warning');
 });
}

test('packed layers retain the original half-float fields, snow and filter settings',()=>{
 const {surface,snow}=terrainMaterialNodes({front:'VALDEZ',baseNormal:T.vec3(0,1,0),worldPosition:T.vec3(0,1400,0)}).textures;
 assert(surface?.isDataArrayTexture);assert.deepEqual([surface.image.width,surface.image.height,surface.image.depth],[256,256,2]);
 const words=256*256*4,sha=data=>createHash('sha256').update(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)).digest('hex');
 assert.equal(sha(surface.image.data.subarray(0,words)),'35173741fd3b5e97c43c24fc68e65344a3328500beb883d4879f8a111429b0a0','Original rock half-floats');
 assert.equal(sha(surface.image.data.subarray(words)),'2ade12c29cc752f18d9ff13d3af928d51a36a8d5150705b568f706ab7aaec5ee','Original aggregate half-floats');
 assert.equal(sha(snow.image.data),'434c94ae2457fca9188cb006ed788b0b3c8ce64674650bb67d16a9fb013f379b','Original snow half-floats');
 assert.deepEqual([snow.image.width,snow.image.height],[512,512]);
 for(const field of [surface,snow]){
  assert.equal(field.type,THREE.HalfFloatType);assert.equal(field.format,THREE.RGBAFormat);
  assert.equal(field.colorSpace,THREE.NoColorSpace);assert.equal(field.wrapS,THREE.RepeatWrapping);assert.equal(field.wrapT,THREE.RepeatWrapping);
  assert.equal(field.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(field.magFilter,THREE.LinearFilter);
  assert.equal(field.generateMipmaps,true);assert.equal(field.anisotropy,4);assert.equal(field.flipY,false);
 }
});

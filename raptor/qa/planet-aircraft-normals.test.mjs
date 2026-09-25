// Compile both optical normal layers with the pinned Three backends. No GPU.
// node --import ./raptor/qa/register-three.mjs --test raptor/qa/planet-aircraft-normals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as T from 'three/tsl';
import {PlanetObjectBender} from '../src/world/planetobjects.js';
import {PlanetCurvature} from '../src/world/planetcurvature.js';
import {joinSurfaces} from '../src/aircraft/weapons-bays.js';

const canvas={width:800,height:600,style:{},addEventListener(){},removeEventListener(){}};
function normalTexture(name,channel){
 const map=new THREE.DataTexture(new Uint8Array([144,116,251,255]),1,1,THREE.RGBAFormat);
 map.name=name;map.channel=channel;map.wrapS=map.wrapT=THREE.RepeatWrapping;return map;
}
function fixture({base=true,coat=true,side=THREE.FrontSide,tangent=false}={}){
 const geometry=new THREE.PlaneGeometry(4,3,2,2);
 const uv1=geometry.attributes.uv.clone();
 for(let i=0;i<uv1.count;i++)uv1.setXY(i,-uv1.getY(i)*3,uv1.getX(i)*4);
 geometry.setAttribute('uv1',uv1);if(tangent)geometry.computeTangents();
 const material=new THREE.MeshPhysicalMaterial({color:0x77838c,roughness:.58,clearcoat:.36,clearcoatRoughness:.48,side,
  normalMap:base?normalTexture('aircraft-base-normal',0):null,normalScale:new THREE.Vector2(.37,.21),
  clearcoatNormalMap:coat?normalTexture('aircraft-coat-normal',1):null,clearcoatNormalScale:new THREE.Vector2(.18,.09)});
 const mesh=new THREE.Mesh(geometry,material);mesh.position.set(14000,1200,-8000);mesh.updateMatrixWorld();
 const curvature=new PlanetCurvature(),normalCalls=[],normal=curvature.normalNode.bind(curvature);
 curvature.normalNode=(node,flat)=>{normalCalls.push({node,flat});return normal(node,flat);};
 const bender=new PlanetObjectBender(curvature);bender.attach(mesh);
 return {mesh,material,geometry,curvature,bender,normalCalls};
}
function compile(api,options={}){
 const f=fixture(options),renderer=new THREE.WebGPURenderer({canvas,forceWebGL:api==='glsl'});
 renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;renderer.hasCompatibility=()=>false;
 renderer.backend.capabilities||={};renderer.backend.capabilities.getUniformBufferLimit=()=>65536;
 const camera=new THREE.PerspectiveCamera(55,4/3,.5,200000);camera.position.set(0,1500,0);camera.updateMatrixWorld();
 camera.coordinateSystem=api==='wgsl'?THREE.WebGPUCoordinateSystem:THREE.WebGLCoordinateSystem;
 f.curvature.beginFrame(camera);f.curvature.endFrame();f.curvature.beginFrame(camera);
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(0xffffff,3);scene.add(f.mesh,sun);
 const nodeMaterial=renderer.library.fromMaterial(f.material);nodeMaterial.lightsNode=T.lights([sun]);f.mesh.material=nodeMaterial;
 let target;
 if(options.mrt!==false){target=new THREE.RenderTarget(800,600,{count:2});target.textures[0].name='output';target.textures[1].name='velocity';renderer.setRenderTarget(target);renderer.setMRT(T.mrt({output:T.output,velocity:T.velocity}));}
 const builder=new(api==='wgsl'?THREE.WGSLNodeBuilder:THREE.GLSLNodeBuilder)(f.mesh,renderer);builder.scene=scene;builder.camera=camera;
 const warnings=[],warn=console.warn;console.warn=(...v)=>warnings.push(v.join(' '));
 try{builder.build();}finally{console.warn=warn;}
 const uniforms=Object.values(builder.uniforms).flat();
 const names=uniforms.map(u=>u.node?.value?.name).filter(Boolean);
 const result={...f,vertex:builder.vertexShader,fragment:builder.fragmentShader,names,warnings};
 target?.dispose();f.material.normalMap?.dispose();f.material.clearcoatNormalMap?.dispose();nodeMaterial.dispose();f.material.dispose();f.geometry.dispose();
 return result;
}
for(const api of ['wgsl','glsl'])for(const layer of ['base','coat','both'])for(const mrt of [true,false]){
 test(`${api} planet aircraft ${layer} normal layers retain independent UVs and ${mrt?'velocity MRT':'color-only output'}`,()=>{
  const result=compile(api,{base:layer!=='coat',coat:layer!=='base',side:THREE.DoubleSide,mrt});
  const {vertex,fragment,names,warnings,normalCalls}=result;
  assert(names.includes('aircraft-base-normal')===(layer!=='coat'));
  assert(names.includes('aircraft-coat-normal')===(layer!=='base'));
  assert.match(vertex,/planetObject0UnbentViewPosition/);
  assert.match(fragment,api==='wgsl'?/dpdx\( planetObject0UnbentViewPosition \)/:/dFdx\( planetObject0UnbentViewPosition \)/,
   'Mapped tangent frames differentiate the original view position');
  assert.match(fragment,api==='wgsl'?/isFront/:/gl_FrontFacing/,'Double-sided material preserves sided normal basis');
  assert.equal(normalCalls.length,1+(layer==='both'?2:1),'One curvature normal transform for each mapped layer plus geometric fallback');
  assert(normalCalls.every(call=>call.flat===normalCalls[0].flat),'All normals refer to the same original map position');
  if(layer==='both')assert.notEqual(result.material.normalNode,result.material.clearcoatNormalNode,'Distinct base and coat normal graphs');
  if(layer!=='base')assert.match(vertex,/uv1/,'Coat map uses the metre-scale second UV attribute');
  if(mrt)assert.match(fragment,/\bm1\b/,'Velocity output survives normal-map adaptation');
  else assert.doesNotMatch(fragment,/\bm1\b/,'Color-only probe has no velocity attachment');
  assert(warnings.every(w=>w.includes("Return statement used in an inline 'Fn()'")),warnings.join('\n'));
 });
}
for(const api of ['wgsl','glsl'])test(`${api} authored UV0 tangents do not replace the independent UV1 coating frame`,()=>{
 const {vertex,fragment}=compile(api,{tangent:true,side:THREE.BackSide});
 assert.match(vertex,/tangent/,'Base layer retains the authored tangent');
 assert.match(vertex,/uv1/,'Clearcoat retains its own UV1 chart');
 assert.match(fragment,api==='wgsl'?/dpdx\( planetObject0UnbentViewPosition \)/:/dFdx\( planetObject0UnbentViewPosition \)/,
  'Clearcoat reconstructs its derivative frame even when UV0 has authored tangents');
});

test('planet bender rejects authored normal/MRT/deformation contracts',()=>{
 for(const property of ['normalNode','clearcoatNormalNode','mrtNode','positionNode','bumpMap','displacementMap']){
  const material=new THREE.MeshPhysicalMaterial();material[property]=property.endsWith('Map')?normalTexture(property,0):T.vec3(0,0,1);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material),bender=new PlanetObjectBender(new PlanetCurvature());
  assert.throws(()=>bender.attach(mesh),/existing deformation\/normal\/MRT contract/,property);
  material[property]?.dispose?.();material.dispose();mesh.geometry.dispose();
 }
});

test('planet clearcoat normal requires smooth RGBA physical material',()=>{
 for(const make of [()=>new THREE.MeshStandardMaterial(),()=>new THREE.MeshPhysicalMaterial({flatShading:true})]){
  const material=make();material.clearcoatNormalMap=normalTexture('invalid-coat',1);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material),bender=new PlanetObjectBender(new PlanetCurvature());
  assert.throws(()=>bender.attach(mesh),/mapped clearcoat normals need a smooth physical material/);
  material.clearcoatNormalMap.dispose();material.dispose();mesh.geometry.dispose();
 }
});

test('clipped aircraft skins retain the independent coating chart when joined',()=>{
 const a=new THREE.PlaneGeometry(),b=new THREE.PlaneGeometry();
 for(const [index,g] of [a,b].entries()){
  const detail=g.attributes.uv.clone();
  for(let i=0;i<detail.count;i++)detail.setXY(i,detail.getX(i)*4+index*8,-detail.getY(i)*3);
  g.setAttribute('uv1',detail);
 }
 const joined=joinSurfaces([a,b]);
 assert.deepEqual(Array.from(joined.attributes.uv1.array),[...a.attributes.uv1.array,...b.attributes.uv1.array]);
 assert.equal(joined.index.count,a.index.count+b.index.count);
 b.deleteAttribute('uv1');const lining=joinSurfaces([a,b]);
 assert.equal(lining.attributes.uv1,undefined,'Optional finish chart is omitted for plain interior/rim joins');
 assert(lining.attributes.uv&&lining.attributes.normal&&lining.attributes.position,'Structural attributes remain');
 for(const g of [a,b,joined,lining])g.dispose();
});

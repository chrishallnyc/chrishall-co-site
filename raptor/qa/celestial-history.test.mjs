import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import * as T from 'three/tsl';
import {Stars} from '../src/world/stars.js';
import {cloudTemporalResult} from '../src/world/cloudtemporal.js';

function dispose(stars) {
 for (const object of [...stars.pointSets, stars.moon, stars.halo]) {
  object.geometry.dispose(); object.material.dispose();
 }
}

test('celestial motion accepts only consecutive main-camera draws of the same geometry', () => {
 const stars=new Stars(undefined,{uExposureGain:T.uniform(1)},{catalogue:false});
 const camera=new THREE.PerspectiveCamera(),probe=new THREE.PerspectiveCamera();
 const renderer={getMRT:()=>T.mrt({output:T.output,velocity:T.velocity})};
 const update=(object,view=camera,r=renderer)=>{
  stars._motionHistoryValid.update({object,camera:view,renderer:r});
  return stars._motionHistoryValid.value;
 };
 try {
  stars.followCamera(camera);
  for(const object of [...stars.pointSets,stars.moon])assert.equal(update(object),false);
  stars.followCamera(camera);
  for(const object of [...stars.pointSets,stars.moon]){assert.equal(update(object),true);assert.equal(update(object),true);}
  const hidden=stars.pointSets[0];
  for(let i=0;i<12;i++){
   stars.followCamera(camera);
   for(const object of [stars.pointSets[1],stars.pointSets[2],stars.moon])assert.equal(update(object),true);
  }
  stars.followCamera(camera);assert.equal(update(hidden),false);assert.equal(update(hidden),false);
  stars.followCamera(camera);assert.equal(update(hidden),true);
  const old=hidden.geometry;hidden.geometry=old.clone();
  assert.equal(update(hidden),false);assert.equal(update(hidden),false);
  stars.followCamera(camera);assert.equal(update(hidden),true);hidden.geometry.dispose();hidden.geometry=old;
  stars.followCamera(camera);assert.equal(update(stars.moon),false);
  stars.followCamera(camera);assert.equal(update(stars.moon),true);
  const record=stars._motionHistory.get(stars.moon);
  stars.followCamera(camera);assert.equal(update(stars.moon,probe),false);
  assert.equal(update(stars.moon,camera,{getMRT:()=>null}),false);
  assert.equal(stars._motionHistory.get(stars.moon),record);
  stars.followCamera(camera);assert.equal(update(stars.moon),false);
  stars.followCamera(camera);assert.equal(update(stars.moon),true);
  stars.followCamera(probe);assert.equal(update(stars.moon,probe),false);
  stars.followCamera(probe);assert.equal(update(stars.moon,probe),true);
 } finally {dispose(stars);}
});

test('celestial shaders keep far depth and isolate motion updates from color-only passes',()=>{
 for(const mode of ['wgsl-reverse','wgsl-forward','glsl-log']){
  const gl=mode==='glsl-log',reverse=mode==='wgsl-reverse';
  const renderer=new THREE.WebGPURenderer({canvas:{width:64,height:32,style:{},addEventListener(){},removeEventListener(){}},forceWebGL:gl,reversedDepthBuffer:reverse,logarithmicDepthBuffer:gl});
  renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;
  const camera=new THREE.PerspectiveCamera(60,2,1,250000);camera.coordinateSystem=renderer.coordinateSystem;camera._reversedDepth=reverse;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const stars=new Stars(undefined,{uExposureGain:T.uniform(1)},{catalogue:false});stars.followCamera(camera);
  try {
   for(const withMotion of [true,false]){
    const target=new THREE.RenderTarget(64,32,{count:withMotion?2:1,type:THREE.HalfFloatType});target.textures[0].name='output';if(withMotion)target.textures[1].name='velocity';
    renderer.setRenderTarget(target);renderer.setMRT(withMotion?T.mrt({output:T.output,velocity:T.velocity}):null);
    for(const object of [stars.pointSets[0],stars.moon]){
     const b=new(gl?THREE.GLSLNodeBuilder:THREE.WGSLNodeBuilder)(object,renderer);b.scene=new THREE.Scene();b.camera=camera;b.build();
     assert.equal(object.material.depthWrite,false);assert.equal(object.material.depthTest,true);
     assert.match(b.fragmentShader,reverse?/output\.depth\s*=\s*0\.0;/:gl?/gl_FragDepth\s*=\s*1\.0;/:/output\.depth\s*=\s*1\.0;/);
     const velocityUpdates=nodes=>nodes.filter(n=>n===T.velocity||n.constructor===T.velocity.constructor).length;
     assert.equal(velocityUpdates(b.updateNodes),withMotion?1:0);
     assert.equal(velocityUpdates(b.updateAfterNodes),withMotion?1:0);
     assert.equal(b.updateNodes.filter(n=>n===stars._motionHistoryValid).length,withMotion?1:0);
     if(withMotion)assert.match(b.fragmentShader,/4\.0, 4\.0/);
    }
    target.dispose();
   }
  } finally {dispose(stars);}
 }
});

test('cloud motion shader preserves invalid scene history only while the background contributes',()=>{
 for(const gl of [false,true]){
  const renderer=new THREE.WebGPURenderer({canvas:{width:64,height:32,style:{},addEventListener(){},removeEventListener(){}},forceWebGL:gl,reversedDepthBuffer:!gl});renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;
  const camera=new THREE.PerspectiveCamera(60,2,1,250000);camera.coordinateSystem=renderer.coordinateSystem;camera._reversedDepth=!gl;camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const target=new THREE.RenderTarget(64,32,{type:THREE.HalfFloatType}),texture=new THREE.DataTexture(new Float32Array([4,4,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);renderer.setRenderTarget(target);
  const pass={cloudOptions:{uCamPos:T.uniform(new THREE.Vector3())},sceneDepth:T.texture(texture),sceneVelocity:T.texture(texture),_currentClip:T.uniform(camera.projectionMatrix.clone()),_previousClip:T.uniform(camera.projectionMatrix.clone()),_cameraView:T.uniform(new THREE.Matrix4()),_nearFar:T.uniform(new THREE.Vector2(1,250000)),_resetHistory:T.uniform(false)};
  const material=new THREE.MeshBasicNodeMaterial();material.fragmentNode=T.Fn(()=>cloudTemporalResult(pass,{color:T.vec4(1),alpha:T.uniform(.5),meanDistance:T.float(5000),sceneDistance:T.float(20000),rayDirection:T.vec3(0,0,-1)},!gl).get('motion'))();
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material),b=new(gl?THREE.GLSLNodeBuilder:THREE.WGSLNodeBuilder)(mesh,renderer);b.scene=new THREE.Scene();b.camera=camera;b.build();
  // Validate the actual compiled predicate, including its layer-weight guard.
  assert.match(b.fragmentShader,gl?/all\( equal\( (\w+), vec2\( 4\.0, 4\.0 \) \) \) && \( (\w+) < 1\.0 \)/:/all\( \( (\w+) == vec2<f32>\( 4\.0, 4\.0 \) \) \) && \( (\w+) < 1\.0 \)/);
  mesh.geometry.dispose();material.dispose();texture.dispose();target.dispose();
 }
});

test('Moon image failures retain the neutral texture and successful views preserve byte bounds',async()=>{
 const world=new URL('../src/world/stars.js',import.meta.url),source=await readFile(world,'utf8');
 const imported=source.replace(/from\s*(['"])(\.\.?\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,world).href}${q}`).replaceAll('import.meta.url',JSON.stringify(world.href));
 const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),originalLoad=THREE.ImageLoader.prototype.load,count=2048*1024*4;
 try {
  for(const name of ['valid-native','valid-offset-view','network-failure','zero-dimensions','wrong-dimensions','fractional-dimensions','oversized-dimensions','create-canvas-throws','context-missing','draw-throws','readback-throws','truncated-rgba','wrong-rgba-type']){
   let onload,onerror,canvas,rgba,created=0;
   THREE.ImageLoader.prototype.load=function(url,load,progress,error){assert(url.endsWith('/assets/sky/lroc-color-2k.jpg'));onload=load;onerror=error;return{};};
   Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(type){assert.equal(type,'canvas');created++;if(name==='create-canvas-throws')throw Error('canvas blocked');canvas={width:0,height:0,getContext(){if(name==='context-missing')return null;return{drawImage(){if(name==='draw-throws')throw Error('decode failed');},getImageData(){if(name==='readback-throws')throw Error('readback blocked');const offset=name==='valid-offset-view'?24:0;rgba=name==='wrong-rgba-type'?new Float32Array(8):new Uint8ClampedArray(new ArrayBuffer(count+offset+(offset?32:0)),offset,name==='truncated-rgba'?count-4:count);rgba[0]=17;rgba[rgba.length-1]=231;return{data:rgba};}};}};return canvas;}}});
   const module=await import('data:text/javascript;base64,'+Buffer.from(imported+`\nexport {skyTextures as qaSkyTextures};\n// ${name}`).toString('base64'));
   const maps=module.qaSkyTextures(),moon=maps.moon,before={image:moon.image,version:moon.version,sourceVersion:moon.source.version},events=[];
   moon.addEventListener('dispose',()=>events.push({image:moon.image,version:moon.version}));
   const image={width:2048,height:1024,naturalWidth:2048,naturalHeight:1024};
   if(name==='zero-dimensions')image.naturalWidth=0;if(name==='wrong-dimensions')image.naturalHeight=1025;if(name==='fractional-dimensions')image.naturalWidth=2048.5;if(name==='oversized-dimensions')image.naturalWidth=1e9;
   assert.doesNotThrow(()=>name==='network-failure'?onerror(Error('missing')):onload(image));
   if(name.startsWith('valid-')){
    assert.equal(moon.image.width,2048);assert.equal(moon.image.height,1024);assert.equal(moon.image.data.buffer,rgba.buffer);assert.equal(moon.image.data.byteOffset,rgba.byteOffset);assert.equal(moon.image.data.byteLength,count);assert.equal(moon.image.data[0],17);assert.equal(moon.image.data[count-1],231);
    assert.deepEqual(events,[{image:before.image,version:before.version}]);assert.equal(moon.version,before.version+1);assert.equal(moon.source.version,before.sourceVersion+1);
   }else{assert.equal(moon.image,before.image);assert.equal(moon.version,before.version);assert.equal(moon.source.version,before.sourceVersion);assert.equal(events.length,0);}
   if(canvas){assert.equal(canvas.width,1);assert.equal(canvas.height,1);}if(name.endsWith('dimensions'))assert.equal(created,0);
   assert.equal(module.qaSkyTextures(),maps);maps.star.dispose();moon.dispose();
  }
 }finally{THREE.ImageLoader.prototype.load=originalLoad;if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete globalThis.document;}
});

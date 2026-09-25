// Validate the authored data against the pinned renderer's actual sampler.
// node --import ./raptor/qa/register-three.mjs --test raptor/qa/aircraft-coating-detail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as T from 'three/tsl';
import {createCoatingDetail} from '../src/aircraft/coating-detail.js';

for (const [quality,size] of [['high',512],['medium',256]]) {
  test(`${quality} coating roughness carries varying scalar data in the sampled red channel`,()=>{
    const detail=createCoatingDetail(quality),map=detail.roughness;
    assert.equal(createCoatingDetail(quality),detail,'Repeated aircraft reuse the same physical maps');
    assert.equal(map.image.width,size);assert.equal(map.image.height,size);
    assert.equal(map.channel,1);assert.equal(map.colorSpace,THREE.NoColorSpace);
    assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.wrapT,THREE.RepeatWrapping);
    assert.equal(map.repeat.x,1/detail.tileMetres);assert.equal(map.repeat.y,1/detail.tileMetres);
    let min=255,max=0;
    for(let i=0;i<map.image.data.length;i+=4){
      const [r,g,b,a]=map.image.data.subarray(i,i+4);
      min=Math.min(min,r);max=Math.max(max,r);
      assert.equal(g,r);assert.equal(b,r);assert.equal(a,255);
    }
    assert(max-min>12,'The red sampler must see authored finish variation, not a constant packed-channel placeholder');
    assert(min>=185&&max<=250,'Finish variation remains within the restrained authored coating range');
  });
}

test('low coating omits physical detail allocations',()=>{
  assert.equal(createCoatingDetail('low'),null);
});

function compile(api){
  const detail=createCoatingDetail('medium'),geometry=new THREE.PlaneGeometry(2,2);
  geometry.setAttribute('uv1',geometry.attributes.uv.clone());
  const material=new THREE.MeshPhysicalMaterial({clearcoat:.10,clearcoatRoughness:.71,
    clearcoatRoughnessMap:detail.roughness});
  const mesh=new THREE.Mesh(geometry,material);
  const canvas={width:800,height:600,style:{},addEventListener(){},removeEventListener(){}};
  const renderer=new THREE.WebGPURenderer({canvas,forceWebGL:api==='glsl'});
  renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;renderer.hasCompatibility=()=>false;
  renderer.backend.capabilities||={};renderer.backend.capabilities.getUniformBufferLimit=()=>65536;
  const camera=new THREE.PerspectiveCamera(55,4/3,.5,200000);
  camera.coordinateSystem=api==='wgsl'?THREE.WebGPUCoordinateSystem:THREE.WebGLCoordinateSystem;
  const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(0xffffff,3);scene.add(mesh,sun);
  const nodeMaterial=renderer.library.fromMaterial(material);
  nodeMaterial.lightsNode=T.lights([sun]);mesh.material=nodeMaterial;
  const builder=new(api==='wgsl'?THREE.WGSLNodeBuilder:THREE.GLSLNodeBuilder)(mesh,renderer);
  builder.scene=scene;builder.camera=camera;
  const warnings=[],warn=console.warn;console.warn=(...values)=>warnings.push(values.join(' '));
  try{builder.build();}finally{console.warn=warn;}
  const maps=Object.values(builder.uniforms).flat().filter(uniform=>uniform.node?.value===detail.roughness);
  const result={fragment:builder.fragmentShader,vertex:builder.vertexShader,maps,warnings};
  nodeMaterial.dispose();material.dispose();geometry.dispose();
  return result;
}

for(const api of ['wgsl','glsl'])test(`${api} physical clearcoat consumes authored roughness red through its UV1 sample`,()=>{
  const {fragment,vertex,maps,warnings}=compile(api);
  assert.equal(maps.length,1,'Compile the real cached application-response texture');
  const name=maps[0].name;assert.match(name,/^\w+$/);
  const sampled=fragment.match(new RegExp(`(\\w+)\\s*=\\s*(?:textureSample|texture)\\(\\s*${name}\\s*,`));
  assert(sampled,'Find the actual texture sample rather than a similarly named uniform');
  assert.match(fragment,new RegExp(`ClearcoatRoughness\\s*=[^;]*\\b${sampled[1]}\\.x\\b`),
    'The pinned r185 physical shader reads this map from R, so that channel must carry the finish');
  assert.match(vertex,/\buv1\b/,'The map uses the metre-scaled secondary coating chart');
  assert.equal(warnings.length,0,warnings.join('\n'));
});

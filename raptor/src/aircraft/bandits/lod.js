import * as THREE from 'three';
import {withBuildQuality} from './quality.js';

const names=['high','medium','far'];
const instances=new WeakMap();
let blurResources=null;

function rotorBlur() {
  if(!blurResources) {
    const size=128,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));
      const inner=THREE.MathUtils.smoothstep(r,.11,.30),outer=1-THREE.MathUtils.smoothstep(r,.92,1);
      // Two finite shutter arcs follow the actual two blades. A uniform
      // filled circle looked like smoke even when the blade was visible.
      const angle=Math.atan2(-(y+.5-size/2),x+.5-size/2);
      let phase=(angle-.56+r*.12)%(Math.PI);if(phase<0)phase+=Math.PI;
      const exposure=Math.exp(-((Math.min(phase,Math.PI-phase)/.65)**2));
      const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(inner*outer*exposure*255);
    }
    const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
    texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
    texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
    blurResources={geometry:new THREE.PlaneGeometry(2.36,2.36),material:new THREE.MeshBasicMaterial({
      color:0x3e484d,map:texture,transparent:true,opacity:.21,depthWrite:false,side:THREE.DoubleSide,
    })};
    blurResources.material.name='bandit-propeller-motion-blur';
  }
  const mesh=new THREE.Mesh(blurResources.geometry,blurResources.material);
  mesh.name='bandit-propeller-blur';mesh.position.set(0,.018,-4.05);
  mesh.userData={role:'propeller-motion-blur',livery:false};return mesh;
}

function count(group) {
  let triangles=0,draws=0;
  group.traverseVisible(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count||o.geometry.getAttribute('position').count)/3;}});
  return {triangles,draws};
}

export function buildBanditLOD(kind,materials,build) {
  const levels=names.map((label,index)=>{
    const level=withBuildQuality(index,kind,()=>build(materials));
    level.name=`bandit-${kind}-lod-${label}`;level.userData.banditLODLevel=index;
    if(kind==='drone') {
      const rotor=level.getObjectByName('bandit-propeller');if(rotor)rotor.visible=index<2;
      level.add(rotorBlur());
    }
    return level;
  });
  const group=new THREE.Group();group.name=`bandit-${kind}`;
  group.userData.aircraft={...levels[0].userData.aircraft,lods:levels.map((level,index)=>({name:names[index],...count(level)})),lodThresholdPixels:[240,80]};
  group.userData.activeLOD='high';
  levels.forEach((level,index)=>{level.visible=index===0;group.add(level);});
  const size=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  group.userData.aircraft.maxDimension=Math.max(size.x,size.y,size.z);
  return group;
}

/**
 * Render-only update. Pass the projected maximum airframe dimension in CSS
 * pixels, plus elapsed render seconds. No flight or collision state changes.
 * forceLevel ('high'|'medium'|'far') is for inspection/transition fixtures.
 * All mutable references live in a WeakMap keyed by the cloned root group.
 */
export function updateBanditVisuals(group,{projectedPixels=Infinity,renderTime=0,forceLevel=null}={}) {
  let state=instances.get(group);
  if(!state) {
    const levels=names.map((_,index)=>group.children.find(child=>child.userData.banditLODLevel===index));
    if(levels.some(level=>!level))return;
    state={levels,rotors:levels.map(level=>level.getObjectByName('bandit-propeller')),
      blurs:levels.map(level=>level.getObjectByName('bandit-propeller-blur')),
      sensors:levels.map(level=>level.getObjectByName('bandit-sensor-gimbal')),
      fans:levels.map(level=>{const fans=[];level.traverse(object=>{if(object.name.startsWith('bandit-fan-'))fans.push(object);});return fans;}),
      level:0,initialized:false,phase:(group.id*.61803398875%1)*Math.PI*2};instances.set(group,state);
  }
  const px=Number.isFinite(projectedPixels)?Math.max(0,projectedPixels):Infinity;
  let level=state.level;
  const forced=names.indexOf(forceLevel);
  if(forced>=0)level=forced;
  else if(!state.initialized)level=px<80?2:px<240?1:0;
  else if(level===0&&px<216)level=px<72?2:1;
  else if(level===1)level=px>264?0:px<72?2:1;
  else if(level===2&&px>88)level=px>264?0:1;
  if(level!==state.level||!state.initialized)state.levels.forEach((object,index)=>{object.visible=index===level;});
  state.level=level;state.initialized=true;
  const rotor=state.rotors[level],time=Number.isFinite(renderTime)?renderTime:0;
  if(rotor&&level<2) {
    // Visual speed ~2,230 rpm. A non-integral frame ratio avoids a frozen-looking
    // shutter alias at 30/60 fps; phase differs between pooled clones.
    rotor.rotation.z=(time*37.2*Math.PI*2+state.phase)%(Math.PI*2);
  }
  const blur=state.blurs[level];if(blur)blur.rotation.z=(time*37.2*Math.PI*2+state.phase)%(Math.PI*2);
  for(const [index,fan]of state.fans[level].entries())fan.rotation.z=(time*(41.7+index*.13)*Math.PI*2+state.phase)%(Math.PI*2);
  const sensor=state.sensors[level];
  if(sensor){sensor.rotation.y=Math.sin(time*.24+state.phase)*.13;sensor.rotation.x=.04+Math.sin(time*.17+state.phase)*.035;}
  group.userData.activeLOD=names[level];
}

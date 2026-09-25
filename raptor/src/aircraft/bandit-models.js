// Pooled visual models. +Z forward, +Y up, in metres. Aircraft geometry,
// finish atlases and base materials are created only during pool startup;
// Object3D.clone(true) shares every GPU resource between the eight slots.
import * as THREE from 'three';
import {buildDrone,DRONE_EXTENT} from './bandits/drone.js';
import {buildTransport,TRANSPORT_EXTENT} from './bandits/transport.js';
import {buildFighter,FIGHTER_EXTENT} from './bandits/fighter.js';
import {createCoatings} from './bandits/coatings.js';
import {buildBanditLOD} from './bandits/lod.js';

export {createBanditLiveryCache} from './bandits/coatings.js';
export {updateBanditVisuals} from './bandits/lod.js';

const specs=[
  ['drone',DRONE_EXTENT,buildDrone],
  ['transport',TRANSPORT_EXTENT,buildTransport],
  ['fighter',FIGHTER_EXTENT,buildFighter],
];

export function buildBanditModels(paint=null,{quality='high'}={}) {
  const tier=String(quality).toLowerCase();
  const textureQuality=tier==='low'?'low':tier==='medium'||tier==='med'?'medium':'high';
  // Keep the original optional material argument as a tint adapter. Its
  // historical neutral colour becomes white, preserving the authored maps.
  // Team/ace recolours should use createBanditLiveryCache().apply().
  const neutral=new THREE.Color(0x78838c);
  return specs.map(([kind,extent,build])=>{
    const materials=createCoatings(kind,extent,textureQuality);
    if(paint?.color)materials.skin.color.setRGB(
      Math.min(1.6,paint.color.r/neutral.r),
      Math.min(1.6,paint.color.g/neutral.g),
      Math.min(1.6,paint.color.b/neutral.b),
    );
    const group=buildBanditLOD(kind,materials,build);
    group.userData.aircraft.textureQuality=textureQuality;
    return group;
  });
}

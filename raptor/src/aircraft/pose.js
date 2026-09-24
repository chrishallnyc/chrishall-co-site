// Render-only aircraft articulation. FlightModel state is read, never written.
// Angles are local to each authored hinge, AFTER its rest yaw/cant quaternion.
import * as THREE from 'three';
import { S } from '../sim/flight.js';
import { syncMainBayDoors } from './weapons-bays.js';
import { syncGearBays } from './gear-bays.js';

const DEG=Math.PI/180;
const SURFACES=[
  ['stabL',S.STABL,1,25],['stabR',S.STABR,1,25],
  ['flaperonL',S.FLAPL,1,20],['flaperonR',S.FLAPR,1,20],
  // FM Cn/rudder slope is negative: positive FM deflection yaws left.
  ['rudderL',S.RUDL,-1,30],['rudderR',S.RUDR,-1,30],
  // Positive FM TVC creates downward thrust; the exhaust points upward.
  ['nozzleL',S.TVCL,-1,20],['nozzleR',S.TVCR,-1,20],
];
const RIG_KEYS=['flaperonL','flaperonR','stabL','stabR','rudderL','rudderR','nozzleL','nozzleR','canopy','bayMain','baySideL','baySideR','gearNose','gearL','gearR'];
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export class AircraftPose {
  constructor(aircraft,parts=null) {
    this.aircraft=aircraft;
    this.parts=parts??Object.fromEntries(RIG_KEYS.map(name=>[name,aircraft.getObjectByName(name)]));
    for(const name of RIG_KEYS)if(!this.parts[name])throw new Error(`Aircraft pose is missing rig part ${name}`);
    const hinges=aircraft.userData.aircraft?.hinges??{};
    const bind=(name,axis)=>({name,part:this.parts[name],rest:this.parts[name].quaternion.clone(),
      axis:new THREE.Vector3(...(hinges[name]?.axis??axis)).normalize()});
    this.surfaces=SURFACES.map(([name,index,sign,limit])=>({
      ...bind(name,[1,0,0]),index,sign,
      min:hinges[name]?.minDeg??-limit,max:hinges[name]?.maxDeg??limit,
    }));
    this._rotation=new THREE.Quaternion();
    this.gearPosition=1;
  }

  // No allocations, easing state or time accumulation. The same previous and
  // current snapshots + alpha always produce exactly the same visual pose.
  update(previous,current,alpha) {
    const t=clamp(alpha,0,1),rotation=this._rotation;
    for(let i=0;i<this.surfaces.length;i++) {
      const binding=this.surfaces[i],index=binding.index;
      const degrees=clamp((previous[index]+(current[index]-previous[index])*t)*binding.sign,binding.min,binding.max);
      rotation.setFromAxisAngle(binding.axis,degrees*DEG);
      binding.part.quaternion.copy(binding.rest).multiply(rotation);
    }
    const gear=clamp(previous[S.GEAR]+(current[S.GEAR]-previous[S.GEAR])*t,0,1);
    this.gearPosition=gear;
    syncGearBays(this.aircraft,gear);
    syncMainBayDoors(this.parts);
  }
}

export function createAircraftPose(jet,parts=null) {
  const aircraft=parts?.nozzleL?.parent??(jet.userData.aircraft?jet:jet.getObjectByName('f22'));
  // The Player can also be constructed with a plain test marker. Production
  // F-22 groups always resolve above and validate their entire rig contract.
  return aircraft?new AircraftPose(aircraft,parts):null;
}

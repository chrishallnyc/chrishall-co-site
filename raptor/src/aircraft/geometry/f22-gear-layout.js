// Public-photo-derived undercarriage envelope; metres, nose -Z.
// Stops fit the authored tire volumes, not measured mechanism travel.
import * as THREE from 'three';
import { clipProjectedPolygon } from './clip-polygon.js';
import { WING, wingLE, wingTEeff, wingThick, foil } from './f22-planform.js';
export const NOSE_GEAR_OPENING = Object.freeze([[-.23,-5.10],[.23,-5.10],[.25,-4.93],[.25,-3.55],[-.25,-3.55],[-.25,-4.93]]);
export const MAIN_GEAR_RIGHT = Object.freeze([[1.02,1.65],[2.62,1.65],[2.82,1.83],[2.82,2.81],[2.62,2.99],[1.02,2.99]]);
export const MAIN_GEAR_LEFT = Object.freeze(MAIN_GEAR_RIGHT.map(([x,z])=>[-x,z]).reverse());
export const GEAR_OPENINGS = Object.freeze([NOSE_GEAR_OPENING,MAIN_GEAR_RIGHT,MAIN_GEAR_LEFT]);
export const GEAR_STOPS = Object.freeze({gearNose:118,gearR:93,gearL:-93});
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function gearWingBottom(x,z) {
  const local=(Math.abs(x)-WING.rootX)/Math.cos(WING.anhedral);
  const chord=wingTEeff(local)-wingLE(local),t=(z-wingLE(local))/chord;
  return WING.rootY-local*Math.sin(WING.anhedral)-wingThick(local)*foil(t)*Math.cos(WING.anhedral);
}
// The wheel lies flat below the thin outer wing root. A shallow fairing
// depresses only lower skin and fades back into the original sampled skin.
export function gearFairingY(x,y,z) {
  const ax=Math.abs(x);
  const plan=smooth(1.45,1.85,ax)*(1-smooth(2.62,2.97,ax))*smooth(1.22,1.62,z)*(1-smooth(3.02,3.37,z));
  const below=1-smooth(gearWingBottom(ax,z)+.012,gearWingBottom(ax,z)+.11,y);
  const depth=.45-.10*smooth(1.85,2.05,ax);
  return y-plan*below*Math.max(0,y+depth);
}

// An explicit shared station makes the body/wing lower-envelope join exact
// even when a low-quality cell otherwise straddles the fairing shoulder.
export function splitGearSkin(source) {
  let result=source;
  const stations=[...[1.45,1.85,1.90,2.05,2.62,2.97].flatMap(x=>[[0,x],[0,-x]]),...[1.22,1.62,3.02,3.37].map(z=>[1,z])];
  for(const [axis,edge] of stations) {
    const outline=axis?[[ -100,edge],[100,edge],[100,100],[-100,100]]:[[edge,-100],[100,-100],[100,100],[edge,100]],a=clipProjectedPolygon(result,outline),b=clipProjectedPolygon(result,outline,{subtract:false});
    const joined=new THREE.BufferGeometry(),indices=[];
    for(const [name,attribute]of Object.entries(result.attributes)) {
      const array=new Float32Array(a.attributes[name].array.length+b.attributes[name].array.length);
      array.set(a.attributes[name].array);array.set(b.attributes[name].array,a.attributes[name].array.length);
      joined.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize));
    }
    for(let i=0;i<a.index.count;i++)indices.push(a.index.getX(i));
    for(let i=0;i<b.index.count;i++)indices.push(b.index.getX(i)+a.attributes.position.count);
    joined.setIndex(indices);a.dispose();b.dispose();if(result!==source)result.dispose();result=joined;
  }
  return result;
}

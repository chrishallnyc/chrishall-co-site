// Compact distant forms retain what is visible through the canopy and around
// an extended wheel. The detailed cockpit/gear is built only once, on HIGH.
import * as THREE from 'three';
import { mergeDetails, F22_GEAR_DIMENSIONS } from './hardware.js';

function add(group, name, geometry, material, position = [0,0,0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.position.set(...position); group.add(mesh);
  return mesh;
}

function rod(group, name, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const mesh = add(group, name, new THREE.CylinderGeometry(radius,radius,direction.length(),8), material);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
}

export function buildF22CockpitSilhouette() {
  const group = new THREE.Group(); group.name = 'cockpitSilhouette';
  const dark = new THREE.MeshStandardMaterial({color:0x202a29,roughness:.8});
  dark.name = 'distant-cockpit';
  const helmet = new THREE.MeshStandardMaterial({color:0x9ea8a6,roughness:.48});
  helmet.name = 'distant-pilot-helmet';
  const body = new THREE.MeshStandardMaterial({color:0x465346,roughness:.9});
  body.name = 'distant-pilot-suit';
  add(group,'cockpitDepth',new THREE.BoxGeometry(.69,.035,2.08),dark,[0,.43,-5.58]);
  add(group,'coaming',new THREE.BoxGeometry(.72,.075,.42),dark,[0,.835,-6.31]);
  add(group,'seatBack',new THREE.BoxGeometry(.40,.64,.12),dark,[0,.75,-4.99]);
  add(group,'seatHeadrest',new THREE.BoxGeometry(.25,.19,.18),dark,[0,1.135,-4.96]);
  const torso = new THREE.SphereGeometry(1,10,7);torso.scale(.195,.275,.13);
  add(group,'pilotTorso',torso,body,[0,.822,-5.14]);
  const head = new THREE.SphereGeometry(1,12,8);head.scale(.116,.142,.140);
  add(group,'pilotHelmet',head,helmet,[0,1.239,-5.235]);
  const visor = new THREE.SphereGeometry(1,10,5,0,Math.PI,Math.PI*.32,Math.PI*.32);
  visor.scale(.120,.143,.151);visor.rotateY(Math.PI);
  add(group,'pilotVisor',visor,dark,[0,1.239,-5.235]);
  for(const side of [-1,1]) {
    rod(group,'pilotUpperArm',[side*.17,.965,-5.115],[side*.27,.74,-5.17],.069,body);
    rod(group,'pilotForearm',[side*.27,.74,-5.17],[side*.326,.68,-5.56],.054,body);
  }
  group.userData.f22LodVisible = ['medium','low'];
  return mergeDetails(group);
}

export function buildF22GearSilhouette(kind, side = 1) {
  const group = new THREE.Group();group.name = 'gearSilhouette';
  const main = kind === 'main', spec = F22_GEAR_DIMENSIONS[kind];
  const length = main ? 1.0031 : .91455;
  const wheel = [main ? side*.43 : 0,-length,main ? .22 : .08];
  const paint = new THREE.MeshStandardMaterial({color:0xa6acab,roughness:.58,metalness:.25});
  paint.name = 'distant-gear-paint';
  const rubber = new THREE.MeshStandardMaterial({color:0x171b1d,roughness:.91});
  rubber.name = 'distant-tire';
  const low = main ? [side*.25,-length+.11,.20] : [0,-length+spec.radius+.095,0];
  rod(group,'oleo',[0,main?0:-.05,0],low,main?.064:.047,paint);
  if(main) {
    rod(group,'axle',[side*.25,-length,.22],wheel,.06,paint);
  } else for(const s of [-1,1]) {
    rod(group,'fork',[s*spec.width*.56,low[1],0],[s*spec.width*.56,-length,.08],.027,paint);
  }
  const tire = new THREE.CylinderGeometry(spec.radius,spec.radius,spec.width*.92,20,1);
  tire.rotateZ(Math.PI/2);add(group,'groovedAircraftTire',tire,rubber,wheel);
  const hub = new THREE.CylinderGeometry(spec.rimRadius*.94,spec.rimRadius*.94,spec.width,16,1);
  hub.rotateZ(Math.PI/2);add(group,'wheelHub',hub,paint,wheel);
  group.userData.f22LodVisible = ['medium','low'];
  group.userData.landingGear = {kind,side,wheelCenter:wheel,wheelRadius:spec.radius,
    wheelWidth:spec.width,rimRadius:spec.rimRadius,attachment:[0,0,0],axleAxis:[1,0,0]};
  return mergeDetails(group);
}

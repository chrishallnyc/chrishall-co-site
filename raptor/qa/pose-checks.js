// Tests observable rig behavior and the actual Player.render integration.
// No screenshot or helper's private cached angle is used as the oracle.
import * as THREE from 'three';
import { FlightModel,S } from '../src/sim/flight.js';
import { AircraftPose } from '../src/aircraft/pose.js';
import { Player } from '../src/game/player.js';

export function inspectAircraftPose(group,parts) {
  const checks=[],check=(id,pass,detail=null)=>checks.push({id,pass:!!pass,severity:'error',detail});
  const saved=Object.fromEntries(Object.entries(parts).map(([name,part])=>[name,{part,q:part.quaternion.clone(),position:part.position.clone(),visible:part.visible}]));
  const parent=group.parent,transform={p:group.position.clone(),q:group.quaternion.clone(),s:group.scale.clone()};
  const root=new THREE.Group(),scene=new THREE.Scene();scene.add(root);root.add(group);
  const fm=new FlightModel();fm.initFlight({x:0,y:0,alt:2000,headingRad:0,speed:200,throttle:.8});
  const state=new Float64Array(fm.state),prev=new Float64Array(state),actuators=[S.STABL,S.STABR,S.FLAPL,S.FLAPR,S.RUDL,S.RUDR,S.TVCL,S.TVCR];
  for(const array of [state,prev])for(const slot of actuators)array[slot]=0;
  state[S.GEAR]=prev[S.GEAR]=1;
  const pose=new AircraftPose(group,parts),rest=Object.fromEntries(Object.entries(parts).map(([name,p])=>[name,p.quaternion.clone()]));
  const localPoint=(part,point)=>{
    root.updateMatrixWorld(true);
    return group.worldToLocal(part.localToWorld(new THREE.Vector3(...point)));
  };
  let player;
  try {
    pose.update(prev,state,1);
    check('pose:neutral-rest',Object.keys(rest).every(name=>1-Math.abs(parts[name].quaternion.dot(rest[name]))<1e-12));
    const controls=[['stabL',S.STABL,'y',-1,25],['stabR',S.STABR,'y',-1,25],
      ['flaperonL',S.FLAPL,'y',-1,20],['flaperonR',S.FLAPR,'y',-1,20],
      ['rudderL',S.RUDL,'x',-1,30],['rudderR',S.RUDR,'x',-1,30],
      ['nozzleL',S.TVCL,'y',1,20],['nozzleR',S.TVCR,'y',1,20]];
    // Repeat with a banked/yawed/translated parent; axis tests must survive it.
    root.position.set(113,700,-285);root.rotation.set(.22,.61,.82);
    for(const [name,slot,coordinate,sign,limit]of controls) {
      state[slot]=0;pose.update(prev,state,1);
      const neutral=localPoint(parts[name],[0,0,1]);
      const axis=group.userData.aircraft?.hinges?.[name]?.axis??[1,0,0];
      const hingeOrigin=localPoint(parts[name],[0,0,0]),hingeEnd=localPoint(parts[name],axis);
      state[slot]=12;pose.update(prev,state,1);
      const moved=localPoint(parts[name],[0,0,1]);
      check(`pose:physical-direction:${name}`,(moved[coordinate]-neutral[coordinate])*sign>.04,{neutral:neutral.toArray(),posed:moved.toArray(),coordinate,sign});
      check(`pose:hinge-stays-fixed:${name}`,hingeOrigin.distanceTo(localPoint(parts[name],[0,0,0]))<1e-8&&hingeEnd.distanceTo(localPoint(parts[name],axis))<1e-8);
      // A quarter of an actuator interval must produce a 3deg relative turn.
      pose.update(prev,state,.25);
      const angle=2*Math.acos(Math.min(1,Math.abs(parts[name].quaternion.dot(rest[name]))));
      check(`pose:interpolation:${name}`,Math.abs(angle-3*Math.PI/180)<1e-7,{degrees:angle*180/Math.PI});
      check(`pose:independent-actuator:${name}`,controls.every(([other])=>other===name||1-Math.abs(parts[other].quaternion.dot(rest[other]))<1e-12));
      for(const extreme of [-100,100]) {
        state[slot]=extreme;pose.update(prev,state,1);
        const stopped=2*Math.acos(Math.min(1,Math.abs(parts[name].quaternion.dot(rest[name]))))*180/Math.PI;
        check(`pose:actuator-stop:${name}:${Math.sign(extreme)}`,Math.abs(stopped-limit)<1e-7,{actual:stopped,expected:limit});
      }
      state[slot]=0;pose.update(prev,state,1);
    }
    const wheelCenter=name=>localPoint(parts[name],parts[name].userData.landingGear?.wheelCenter??[0,-1,0]);
    for(const fraction of [0,.25,.5,.75,1]) {
      state[S.GEAR]=prev[S.GEAR]=fraction;pose.update(prev,state,.5);
      const left=wheelCenter('gearL'),right=wheelCenter('gearR');
      check(`pose:gear-mirror:${fraction}`,Math.abs(left.x+right.x)<1e-6&&Math.abs(left.y-right.y)<1e-6&&Math.abs(left.z-right.z)<1e-6,{left:left.toArray(),right:right.toArray()});
      check(`pose:gear-visible:${fraction}`,['gearL','gearR','gearNose'].every(name=>parts[name].visible===(fraction>0)));
      if(fraction===1)check('pose:gear-deployed-stop',['gearL','gearR','gearNose'].every(name=>1-Math.abs(parts[name].quaternion.dot(rest[name]))<1e-12));
      if(fraction===0)for(const name of ['gearL','gearR','gearNose']) {
        const angle=2*Math.acos(Math.min(1,Math.abs(parts[name].quaternion.dot(rest[name]))));
        const expected=Math.abs(group.userData.aircraft?.hinges?.[name]?.stowedDeg??(name==='gearNose'?90:110));
        check(`pose:stowed-stop:${name}`,Math.abs(angle*180/Math.PI-expected)<1e-7,{actual:angle*180/Math.PI,expected});
      }
    }
    // Inputs are snapshots; identical calls must not accumulate pose drift.
    state[S.STABL]=17;state[S.TVCR]=-14;prev[S.GEAR]=0;state[S.GEAR]=1;
    pose.update(prev,state,.37);
    const repeated=Object.fromEntries(Object.entries(parts).map(([name,p])=>[name,p.quaternion.clone()]));
    for(let frame=0;frame<240;frame++)pose.update(prev,state,.37);
    check('pose:repeatable-without-drift',Object.keys(parts).every(name=>parts[name].quaternion.equals(repeated[name])));
    pose.update(prev,state,-2);
    check('pose:alpha-start-clamped',1-Math.abs(parts.stabL.quaternion.dot(rest.stabL))<1e-12&&!parts.gearNose.visible);
    pose.update(prev,state,2);
    check('pose:alpha-end-clamped',Math.abs(2*Math.acos(Math.min(1,Math.abs(parts.stabL.quaternion.dot(rest.stabL))))*180/Math.PI-17)<1e-7&&parts.gearNose.visible);
    check('pose:uncommanded-parts',['canopy','bayMain','baySideL','baySideR'].every(name=>1-Math.abs(parts[name].quaternion.dot(rest[name]))<1e-12));
    // Restore the authored rest before binding the actual Player.
    for(const [name,entry]of Object.entries(saved)){parts[name].quaternion.copy(entry.q);parts[name].visible=entry.visible;}
    group.position.set(0,0,0);group.rotation.set(0,Math.PI,0);group.scale.set(1,1,1);
    player=new Player(scene,{jet:root,spawn:{x:100,y:-500,alt:2000,headingRad:0,speed:200}});
    const a=player._prev,b=player.fm.state;
    b[S.PX]=120;b[S.PY]=-300;b[S.PZ]=2040;
    const qa=new THREE.Quaternion(a[S.QX],a[S.QY],a[S.QZ],a[S.QW]);
    const qb=qa.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.9));
    b[S.QX]=qb.x;b[S.QY]=qb.y;b[S.QZ]=qb.z;b[S.QW]=qb.w;
    for(const slot of actuators){a[slot]=0;b[slot]=16;}
    a[S.GEAR]=0;b[S.GEAR]=1;
    const bytes=array=>Array.from(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
    const beforeState=bytes(b),beforePrevious=bytes(a),hash=player.fm.hash(0x811c9dc5);
    const camera=new THREE.PerspectiveCamera();
    player.render(.25,camera,true);
    check('pose:player-position-interpolates',root.position.distanceTo(new THREE.Vector3(105,2010,-450))<1e-9,root.position.toArray());
    const expected=qa.clone().slerp(qb,.25),bodyForward=new THREE.Vector3(1,0,0).applyQuaternion(expected),bodyUp=new THREE.Vector3(0,0,-1).applyQuaternion(expected);
    const renderForward=new THREE.Vector3(0,0,1).applyQuaternion(root.quaternion),renderUp=new THREE.Vector3(0,1,0).applyQuaternion(root.quaternion);
    check('pose:player-attitude-interpolates',renderForward.distanceTo(new THREE.Vector3(bodyForward.x,bodyForward.z,bodyForward.y))<1e-8&&renderUp.distanceTo(new THREE.Vector3(bodyUp.x,bodyUp.z,bodyUp.y))<1e-8);
    const quarter=2*Math.acos(Math.min(1,Math.abs(parts.stabL.quaternion.dot(rest.stabL))));
    check('pose:player-applies-surfaces',Math.abs(quarter-4*Math.PI/180)<1e-7,{degrees:quarter*180/Math.PI});
    for(let frame=0;frame<121;frame++)player.render((frame%13)/12,camera,frame%2===0);
    check('pose:fm-state-bytes-unchanged',JSON.stringify(beforeState)===JSON.stringify(bytes(b))&&hash===player.fm.hash(0x811c9dc5));
    check('pose:previous-state-bytes-unchanged',JSON.stringify(beforePrevious)===JSON.stringify(bytes(a)));
    check('pose:rig-identities-preserved',Object.keys(saved).every(name=>saved[name].part===parts[name]));
  } finally {
    root.remove(group);if(parent)parent.add(group);
    group.position.copy(transform.p);group.quaternion.copy(transform.q);group.scale.copy(transform.s);
    for(const [name,entry]of Object.entries(saved)){parts[name].position.copy(entry.position);parts[name].quaternion.copy(entry.q);parts[name].visible=entry.visible;}
    group.updateMatrixWorld(true);
    // Test-owned weapon geometry/materials only; shared sprite maps are cached.
    scene.traverse(object=>{if(object.isMesh){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}});
  }
  return {checks,fixtureVersion:2};
}

// The city collider consumes actual adjacent simulation poses, even with gear
// down, and uses the normal recovery path without restoring weapon stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/game/player.js';
import { SimCore } from '../src/engine/sim.js';

globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
const spawn={x:0,y:-6000,alt:850,headingRad:0,speed:200};
function fixture(obstacles){
  const p=new Player(new THREE.Scene(),{jet:new THREE.Group(),spawn,obstacles});
  const sim=new SimCore(1);sim.addSystem(p);return {p,sim};
}
test('a structure crossing checks the swept flight segment and respawns with both gear states',()=>{
  for(const gearDown of [false,true]){
    let segment;
    const {p,sim}=fixture({intersectsSegment:(a,b,padding)=>{segment={a:[...a.slice(0,3)],b:[...b.slice(0,3)],padding};return {id:'building'};}});
    p.gearDown=gearDown;p.gun.ammo=57;p.missiles.ammo=2;
    sim.tick();
    assert.equal(segment.padding,3);
    assert.deepEqual(segment.a,[0,-6000,850]);
    assert.ok(segment.b[0]>segment.a[0],'real movement passes through the collision query');
    assert.equal(p.crashes,1);assert.equal(p.gun.ammo,57);assert.equal(p.missiles.ammo,2);
    assert.deepEqual([...p.fm.state.slice(0,3)],[0,-6000,850]);
    assert.deepEqual([...p._prev.slice(0,3)],[...p.fm.state.slice(0,3)]);
  }
});
test('a clear city segment and fronts without structures continue normal flight',()=>{
  for(const obstacles of [null,{intersectsSegment:()=>null}]){
    const {p,sim}=fixture(obstacles);for(let i=0;i<120;i++)sim.tick();
    assert.equal(p.crashes,0);assert.ok(p.fm.state[0]>190);
  }
});

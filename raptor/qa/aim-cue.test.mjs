import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAimCue} from '../src/game/aimcue.js';
const cue=patch=>projectAimCue({x:0,y:0,z:-1,width:1280,height:800,...patch});
test('an aim ahead shares the exact camera FOV projection',()=>{
 assert.deepEqual(cue(),{x:640,y:400,edge:false,behind:false,angle:0});
 const c=cue({x:.1,fov:60});assert.ok(Math.abs(c.x-(640+40/Math.tan(Math.PI/6)))<1e-8);
 assert.ok(cue({x:.1,fov:90}).x<c.x);
});
test('off-screen aims stay inside safe HUD margins in every quadrant',()=>{
 for(const x of [-20,0,20])for(const y of [-20,0,20]){
  if(!x&&!y)continue;const c=cue({x,y});assert.equal(c.edge,true);
  assert.ok(c.x>=64&&c.x<=1216);assert.ok(c.y>=100&&c.y<=700);
  assert.equal(Math.sign(c.x-640),Math.sign(x));assert.equal(Math.sign(400-c.y),Math.sign(y));
 }
});
test('behind-camera and exact-perpendicular aims have finite recovery cues',()=>{
 for(const v of [{x:0,y:0,z:1},{x:1,y:0,z:0},{x:-1,y:1,z:1}]){
  const c=cue(v);assert.equal(c.edge,true);assert.equal(c.behind,true);assert.ok([c.x,c.y,c.angle].every(Number.isFinite));
 }
 assert.equal(cue({z:1}).y,700);
});
test('wrapped toolbar and small screens preserve a visible edge cue',()=>{
 const c=cue({x:0,y:100,width:390,height:560,top:160});assert.equal(c.y,160);
 const small=cue({x:10,y:10,width:200,height:160,top:300});assert.ok(small.x>=30&&small.x<=170);assert.ok(small.y>=0&&small.y<=160);
});
test('invalid camera data never sends NaN coordinates to canvas',()=>{
 for(const patch of [{x:NaN},{y:Infinity},{width:0},{height:-2},{fov:NaN}])assert.equal(cue(patch),null);
});

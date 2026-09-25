import test from 'node:test';
import assert from 'node:assert/strict';
import {flightBrief} from '../src/game/flightbrief.js';
test('pause briefing uses authored labels and actual objective state with frozen remaining time',()=>{
 const state={sim:{time:61.5},script:{spec:{timeLimitS:300},objectiveSummary:()=>[
  {kind:'destroy_tag',labelId:9,count:2,need:3,done:false},
  {kind:'protect_tag',done:false,need:2,count:1},{kind:'reach_zone',done:true,need:1}
 ]},missionData:{lines:{9:'Clear the corridor'}}};
 const b=flightBrief(state);assert.equal(b.remaining,'3:59');assert.equal(b.completed,1);
 assert.deepEqual(b.objectives[0],{label:'Clear the corridor',status:'pending',protection:false,detail:'2 / 3'});
 assert.equal(b.objectives[1].detail,'Keep safe');assert.equal(b.total,2);
 state.match={over:1};assert.equal(flightBrief(state).objectives[1].status,'protected');
});
test('missing or untimed missions never advertise a fake countdown',()=>{
 assert.equal(flightBrief({}),null);
 assert.equal(flightBrief({script:{spec:{},objectiveSummary:()=>[]}}).remaining,null);
 assert.equal(flightBrief({sim:{time:90},script:{spec:{timeLimitS:60},objectiveSummary:()=>[]}}).remaining,'0:00');
});

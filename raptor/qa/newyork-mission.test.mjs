// Native simulation, no renderer/GPU/browser. Actual bandit routes, damage
// and Script outcomes prove this standalone mission can succeed and fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bandits } from '../src/game/bandits.js';
import { Player } from '../src/game/player.js';
import { Match } from '../src/game/match.js';
import { makeDirectory } from '../src/game/targets.js';
import { SimCore } from '../src/engine/sim.js';
import { Script } from '../src/game/script.js';
import { loadMission, specHash } from '../src/game/missions.js';
import { softDiscTexture } from '../src/engine/sprites.js';
import { CAMPAIGN, SCENARIOS, loadSortie, loadAuth, loadScenarioProgress, markDone, authSaveSucceeded } from '../src/campaign/authored.js';
import { loadRequestedFlight, FlightLoadError } from '../src/game/flightload.js';
import { validateFlightPlan, flightURL } from '../src/game/flightplan.js';
import { flightBrief } from '../src/game/flightbrief.js';
import { flightContinuation } from '../src/game/cockpit.js';
import { campaignCatalog, campaignProgress, PilotLog, FRONTS } from '../src/game/pilotlog.js';
import Y01 from '../src/campaign/sorties/newyork-01.js';

function storage() {
  const data=new Map();
  globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
  return data;
}

// Only the small sprite needs a canvas. Aircraft builders use their normal
// Node path, and the sim runs the production arrays and route integrator.
globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
softDiscTexture();
delete globalThis.document;

function harness(spec=Y01.spec) {
  const bandits=new Bandits(new THREE.Scene(),{quality:'low'});
  const match={over:0,blue:30};
  const player={fm:{state:new Float64Array(14)}};
  player.fm.state.set([spec.playerSpawn.x,spec.playerSpawn.y,spec.playerSpawn.alt]);
  const script=new Script(spec,{bandits,player,match});
  const sim={time:0,tickCount:0};
  function step() {
    sim.time=++sim.tickCount/120;
    bandits.tick(sim,1/120);
    script.tick(sim,1/120);
  }
  return {bandits,match,player,script,sim,step};
}
function gate(h) {
  const zone=Y01.spec.objectives.find(o=>o.kind==='reach_zone').zone;
  h.player.fm.state.set([zone.x,zone.y,2200]);h.step();
}

test('Y01 is a separately launched scenario with complete alternate-history briefing and no ground targets',async()=>{
  storage();
  const result=await loadRequestedFlight(new URLSearchParams('sortie=Y01'));
  assert.equal(result.spec.front,'NEWYORK');
  assert.equal(result.authored.standalone,true);
  assert.equal(result.meta.id,'Y01');
  assert.equal(SCENARIOS[0].title,'Harbor Watch');
  assert.equal(CAMPAIGN.length,30);assert.ok(!CAMPAIGN.some(s=>s.id==='Y01'));
  const text=[...result.meta.briefingIds,result.meta.contentNoteId].map(id=>result.lines[id]).join(' ');
  assert.match(text,/alternate history/i);assert.match(text,/offscreen/);assert.match(text,/invented/);
  assert.equal(result.spec.units.length,0);assert.equal(result.spec.bandits.length,2);
  assert.ok(result.spec.bandits.every(b=>b.kind==='transport'&&!b.engage&&!b.attackTag));
  assert.equal(result.spec.timeoutOutcome,-1);
  for(const c of result.spec.comms)assert.equal(typeof result.lines[c.lineId],'string');
  for(const o of result.spec.objectives)assert.equal(typeof result.lines[o.labelId],'string');
});

test('NYC flight URLs preserve safe free flight and allow the campaign to choose its own region',async()=>{
  for(const mode of ['practice','battle','operation']) {
    const plan=validateFlightPlan({front:'NEWYORK',mode,time:'golden'});
    assert.equal(plan.mode,'practice');assert.equal(plan.front,'NEWYORK');
    const query=new URLSearchParams(flightURL(plan));
    assert.equal(query.get('front'),'NEWYORK');assert.equal(query.get('nobattle'),'1');assert.equal(query.get('nomatch'),'1');
    assert.equal(query.get('tod'),'18.4');assert.equal(query.has('sortie'),false);
  }
  const query=new URLSearchParams(flightURL({front:'NEWYORK',mode:'campaign'},{front:'NELLIS',id:'N01'}));
  assert.equal(query.get('front'),'NELLIS');assert.equal(query.get('sortie'),'N01');
  await assert.rejects(loadRequestedFlight(new URLSearchParams('front=NEWYORK&op=1')),FlightLoadError);
  assert.equal(FRONTS.NEWYORK.operation,false);assert.equal(FRONTS.NEWYORK.battle,false);
});

test('disabling the aircraft pool rejects an air mission before renderer startup',async()=>{
  for(const request of ['sortie=Y01','mission=nellis-intercept-01']) {
    await assert.rejects(loadRequestedFlight(new URLSearchParams(request+'&bandits=0')),error=>
      error instanceof FlightLoadError&&/requires enemy aircraft/.test(error.cause.message));
  }
  const ground=await loadRequestedFlight(new URLSearchParams('mission=nellis-strike-01&bandits=0'));
  assert.equal(ground.spec.type,'strike');
});

test('harbor overwatch plus two actual target kills wins; one interception cannot end the mission',()=>{
  const h=harness();gate(h);
  assert.equal(h.script.objectiveSummary()[0].done,true);
  assert.equal(h.match.over,0);
  assert.equal(h.bandits.damage(0,90),true);h.step();
  assert.equal(h.script.objectiveSummary()[1].count,1);assert.equal(h.match.over,0);
  assert.equal(h.bandits.damage(1,90),true);h.step();
  assert.equal(h.match.over,1);assert.equal(h.bandits.kills,2);
  assert.ok(h.script.readComms().some(c=>c.lineId===1008));
  const state={...h,missionData:{spec:Y01.spec,lines:Y01.lines,meta:Y01}};
  const brief=flightBrief(state);
  assert.equal(brief.title,'Harbor Watch');assert.equal(brief.briefing.length,4);
  assert.equal(brief.completed,2);assert.equal(brief.objectives.filter(o=>o.status==='protected').length,2);
});

test('ordinary aim, throttle and missile inputs can complete the real flight within 200 seconds',()=>{
  // Production physics, instructor, target AI, missile seeker and guidance.
  // Flat harbor ground isolates airborne gameplay from the city collision
  // tests. No teleport, hp write or direct target-damage call is permitted.
  const spec=Y01.spec,scene=new THREE.Scene(),terrain={heightAt:()=>0};
  const bandits=new Bandits(scene,{terrain,quality:'low'}),ps=spec.playerSpawn;
  const player=new Player(scene,{jet:new THREE.Group(),terrain,
    spawn:{x:ps.x,y:ps.y,alt:ps.alt,headingRad:ps.headingDeg*Math.PI/180,speed:ps.speed},
    directory:makeDirectory({bandits})});
  bandits.player=player;
  const match=new Match(null,player,{airfield:spec.airfield});
  const script=new Script(spec,{player,bandits,match,terrain});
  const sim=new SimCore(spec.seed);
  for(const system of [bandits,player,script,match])sim.addSystem(system);
  const input={mouse:{dx:0,dy:0},fire:false,
    held:action=>action==='throttle_up'&&player.throttleCmd<1,
    pressed:action=>action==='fire_aam'&&input.fire,wheelDelta:()=>0};
  while(!match.over&&sim.time<200) {
    const st=player.fm.state;
    let x,y,z,range=Infinity,target=-1;
    if(!script.objectiveSummary()[0].done) {
      ({x,y}=spec.objectives[0].zone);z=ps.alt;
    } else {
      for(let i=0;i<2;i++)if(bandits.alive(i)){target=i;break;}
      if(target<0)break;
      const offset=target*14;
      x=bandits.state[offset];y=bandits.state[offset+1];z=bandits.state[offset+2];
      range=Math.hypot(x-st[0],y-st[1],z-st[2]);
    }
    const heading=Math.atan2(y-st[1],x-st[0]);
    const pitch=Math.max(-0.35,Math.min(0.35,Math.atan2(z-st[2],Math.hypot(x-st[0],y-st[1]))));
    const headingDelta=heading-player.aimHeading;
    input.mouse.dx=-Math.atan2(Math.sin(headingDelta),Math.cos(headingDelta))/0.0028;
    input.mouse.dy=-(pitch-player.aimPitch)/0.0028;
    input.fire=target>=0&&range<3500&&player.missiles.locked()&&!player.missiles.live.some(Boolean);
    player.feedInput(input);sim.tick();
  }
  assert.equal(match.over,1,`mission outcome after ${sim.time}s`);
  assert.ok(sim.time<200);assert.equal(player.crashes,0);assert.equal(player.hp,100);
  assert.equal(bandits.kills,2);assert.equal(player.missiles.kills,2);
  assert.equal(player.missiles.ammo,2,'two real missile interceptions leave two reserve missiles');
  assert.ok(script.objectiveSummary()[0].done,'the pilot flew through the overwatch gate');
});

test('interceptions alone do not skip the required harbor patrol waypoint',()=>{
  const h=harness();h.bandits.damage(0,90);h.bandits.damage(1,90);h.step();
  assert.equal(h.match.over,0);gate(h);assert.equal(h.match.over,1);
});

test('either protection fence ends the mission while the inbound is still airborne',()=>{
  for(const objective of Y01.spec.objectives.filter(o=>o.kind==='protect_tag')) {
    const h=harness();const z=objective.zone;
    h.bandits.state.set([z.x,z.y,2300],0);h.step();
    assert.equal(h.match.over,-1);
    assert.equal(h.bandits.alive(0),true,'protection failure occurs before an impact or kill');
    assert.equal(h.bandits.kills,0);
    assert.ok(h.script.objectiveSummary().find(o=>o.id===objective.id).failed);
    const hash=h.script.hash(0x12345678);h.bandits.damage(0,90);h.bandits.damage(1,90);h.step();
    assert.equal(h.match.over,-1,'late kills cannot overwrite a failed mission');
    assert.equal(h.script.hash(0x12345678),hash,'objective/comms state freezes at the outcome');
  }
});

test('both production routes reach their designated protection zones within the mission window',()=>{
  const arrivals=[];
  for(const remainingSlot of [0,1]) {
    const h=harness();gate(h);h.bandits.damage(1-remainingSlot,90);
    while(h.match.over===0 && h.sim.time<Y01.spec.timeLimitS+1)h.step();
    assert.equal(h.match.over,-1);
    const expected=remainingSlot===0?3:4;
    assert.equal(h.script.objectiveSummary().find(o=>o.id===expected).failed,true);
    assert.equal(h.bandits.alive(remainingSlot),true);
    assert.ok(h.sim.time>120&&h.sim.time<420,`track ${remainingSlot} has an interceptible approach: ${h.sim.time}s`);
    arrivals.push(h.sim.time);
  }
  assert.ok(arrivals[1]-arrivals[0]>50,'the second approach leaves time to move between contacts');
});

test('the deadline and exhausted lives fail without granting default defensive timeout victory',()=>{
  for(const reason of ['time','lives']) {
    const h=harness();gate(h);
    if(reason==='time')h.sim.time=481;else h.match.blue=0;
    h.script.tick(h.sim,1/120);assert.equal(h.match.over,-1);
  }
  assert.notEqual(specHash(Y01.spec),specHash({...Y01.spec,timeoutOutcome:1}));
  assert.throws(()=>loadMission({...Y01.spec,timeoutOutcome:0}),/timeoutOutcome/);
});

test('scenario completion persists separately and never unlocks or continues the linear campaign',()=>{
  const data=storage();
  markDone('N01');const before=data.get('raptor.auth.v1');const progress=campaignProgress();
  markDone('Y01');
  assert.equal(authSaveSucceeded(),true);assert.equal(loadScenarioProgress().done.Y01,1);
  assert.equal(data.get('raptor.auth.v1'),before);assert.equal(loadAuth().done.Y01,undefined);
  assert.equal(campaignProgress().completed,progress.completed);assert.equal(campaignProgress().next.id,progress.next.id);
  const continuation=flightContinuation({flags:new URLSearchParams('sortie=Y01'),match:{over:1},progressSaved:true},progress.next);
  assert.equal(continuation.nextMission,null);assert.equal(continuation.restartLabel,'Replay Harbor Watch');
  assert.equal(continuation.resultTitle,'Harbor Watch complete');
});

test('scenario saving reports a denied write accurately without changing campaign progress',()=>{
  const data=storage();markDone('N01');const before=data.get('raptor.auth.v1');
  localStorage.setItem=()=>{throw Error('quota');};markDone('Y01');
  assert.equal(authSaveSucceeded(),false);assert.deepEqual(loadScenarioProgress().done,{});
  assert.equal(data.get('raptor.auth.v1'),before);
});

test('the pilot log renders a separate scenario card without attempting an unsupported NYC operation',async()=>{
  storage();
  const control={scrollTop:0,clientHeight:480,getBoundingClientRect:()=>({top:0,bottom:40}),addEventListener(){}};
  control.querySelector=()=>control;
  const body={innerHTML:'',querySelector:()=>control,querySelectorAll:()=>[]};
  const catalog=await campaignCatalog();
  PilotLog.prototype.render.call({body,catalog,selected:'N01',filter:'ALL',query:'',status:'all'});
  assert.match(body.innerHTML,/Standalone scenarios/);assert.match(body.innerHTML,/Harbor Watch/);
  assert.match(body.innerHTML,/data-scenario="Y01"/);assert.doesNotMatch(body.innerHTML,/data-filter="NEWYORK"/);
  assert.equal(catalog.length,30);
});

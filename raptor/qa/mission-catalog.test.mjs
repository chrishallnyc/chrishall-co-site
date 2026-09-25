import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN, loadSortie } from '../src/campaign/authored.js';
import { filterMissions, missionStatus, missionPreparation } from '../src/game/missioncatalog.js';
import { winsAtTimeLimit } from '../src/game/missions.js';
import { Script } from '../src/game/script.js';

const catalog=CAMPAIGN.map((mission,index)=>({...mission,index,title:mission.id==='N01'?'First Blood':mission.id,
  type:'strike',typeLabel:'Strike',briefing:['A convoy in the valley.']}));
const saved={v:1,done:{N01:1,N02:1}};

test('mission filters combine search, region and actual campaign unlock status without changing progress',()=>{
  const before=JSON.stringify(saved);
  assert.deepEqual(filterMissions(catalog,saved,{status:'ready'}).map(m=>m.id),['V01']);
  assert.deepEqual(filterMissions(catalog,saved,{status:'completed'}).map(m=>m.id),['N01','N02']);
  assert.equal(filterMissions(catalog,saved,{status:'locked'}).length,27);
  assert.equal(filterMissions(catalog,saved,{front:'NELLIS',status:'ready'}).length,0);
  assert.deepEqual(filterMissions(catalog,saved,{front:'NELLIS',status:'completed',query:'  FIRST BLOOD  '}).map(m=>m.id),['N01']);
  assert.equal(JSON.stringify(saved),before);
  assert.equal(missionStatus(catalog[2],saved),'ready');
});

test('search uses whole query words across ID, title, region, readable type and briefing',()=>{
  assert.deepEqual(filterMissions(catalog,saved,{query:'n01'}).map(m=>m.id),['N01']);
  assert.equal(filterMissions(catalog,saved,{query:'VALDEZ valley strike'}).length,10);
  assert.equal(filterMissions(catalog,saved,{query:'not-present'}).length,0);
  const special=[{...catalog[0],title:'Écho over the Sound',type:'sead',typeLabel:'Air defense suppression'}];
  assert.equal(filterMissions(special,saved,{query:'echo suppression'}).length,1);
  assert.equal(filterMissions(special,saved,{query:'[.+*'}).length,0,'search treats input as text, never a regular expression');
});

test('a completed campaign remains searchable and replayable without a fabricated next mission',()=>{
  const complete={v:1,done:Object.fromEntries(CAMPAIGN.map(m=>[m.id,1]))};
  assert.equal(filterMissions(catalog,complete,{status:'ready'}).length,0);
  assert.equal(filterMissions(catalog,complete,{status:'completed'}).length,30);
  assert.equal(filterMissions(catalog,complete,{status:'locked'}).length,0);
});

test('preflight objectives distinguish actual victory conditions, protected tasks and navigation',async()=>{
  const n01=await loadSortie('N01'),before=JSON.stringify(n01.spec);
  assert.deepEqual(missionPreparation(n01),[
    {label:'Reach the mission area',count:null,purpose:'Navigation'},
    {label:'Destroy ground targets',count:4,purpose:'Required'},
    {label:'Destroy enemy aircraft',count:2,purpose:'Required'},
  ]);
  assert.equal(JSON.stringify(n01.spec),before);
  const v01=missionPreparation(await loadSortie('V01'));
  assert.ok(v01.some(objective=>objective.purpose==='Must hold'));
  for(const entry of CAMPAIGN){
    const sortie=await loadSortie(entry.id),rows=missionPreparation(sortie);
    assert.equal(rows.length,sortie.spec.objectives.length);
    assert.equal(rows.filter(row=>row.purpose===(winsAtTimeLimit(sortie.spec)?'For early victory':'Required')).length,sortie.spec.winWhen.length);
    assert.ok(rows.every(row=>typeof row.label==='string'&&row.label.length>0));
  }
});

test('standalone mission preparation honors explicit deadline outcomes over defensive type defaults',async()=>{
  const sortie=await loadSortie('Y01'),before=JSON.stringify(sortie.spec);
  assert.equal(winsAtTimeLimit(sortie.spec.type),true,'intercept normally wins at the deadline');
  assert.equal(winsAtTimeLimit(sortie.spec),false,'Harbor Watch explicitly requires both interceptions');
  assert.deepEqual(missionPreparation(sortie).map(row=>row.purpose),['Required','Required','Must hold','Must hold']);
  const match={over:0,blue:30},script=new Script(sortie.spec,{match});
  script.tick({time:sortie.spec.timeLimitS+.01},0);
  assert.equal(match.over,-1,'briefing agrees with actual scenario timeout defeat');
  const override={...sortie.spec,type:'strike',timeoutOutcome:1},otherMatch={over:0,blue:30};
  assert.equal(winsAtTimeLimit(override),true);
  new Script(override,{match:otherMatch}).tick({time:override.timeLimitS+.01},0);
  assert.equal(otherMatch.over,1,'an explicit timeout victory also takes precedence over offensive defaults');
  assert.equal(JSON.stringify(sortie.spec),before);
});

test('protection loss thresholds are not presented as target counts, and timeout victory remains an alternative',async()=>{
  const n03=await loadSortie('N03');
  n03.spec.objectives.forEach((objective,index)=>{
    if(objective.kind==='protect_tag')assert.equal(missionPreparation(n03)[index].count,null);
  });
  const v01=await loadSortie('V01'),match={over:0,blue:30};
  const script=new Script(v01.spec,{match});
  script.tick({time:v01.spec.timeLimitS+.01},0);
  assert.equal(match.over,1,'actual defense rules allow victory without the early kill objectives');
  assert.ok(missionPreparation(v01).some(row=>row.purpose==='For early victory'));
  assert.ok(missionPreparation(v01).every(row=>row.purpose!=='Required'));
});

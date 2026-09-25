import test from 'node:test';
import assert from 'node:assert/strict';
import {createPilotBackup,parsePilotBackup,restorePilotBackup,summarizePilotBackup,BACKUP_KEYS} from '../src/game/pilotbackup.js';
import {freshSave,genMission,reduceCampaign,operationChecksum} from '../src/campaign/engine.js';
import {DEFAULTS} from '../src/game/settings.js';
const store = initial => {
 const values=new Map(Object.entries(initial||{}));
 return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
};
const populated = () => {
 const fresh=freshSave('NELLIS');
 const operation=reduceCampaign(fresh,genMission(fresh),{over:1,simHash:'12345678'});
 return store({'raptor.auth.v1':JSON.stringify({v:1,done:{N01:1,N02:1}}),'raptor.op.v1:NELLIS':JSON.stringify(operation),
  'raptor.flight-school.v1':JSON.stringify({version:1,completedAt:1234567,completions:2}),
  'raptor.preflight.v1':JSON.stringify({front:'VALDEZ',mode:'battle',time:'golden'}),
  'raptor:bench:v3':'machine-specific','another-app':'private'});
};

test('portable profile round-trips progress, operations, normalized preferences and full shared bindings',()=>{
 const source=populated(),bindings={fire_mguns:[['KeyF'],['Mouse0']],gear:[['KeyF']],menu:[['Escape']],throttle_up:[]};
 const profile=createPilotBackup(source,{settings:{...DEFAULTS,tier:'HIGH',pointingDevice:'trackpad',muted:true},bindings});
 assert.deepEqual(summarizePilotBackup(profile),{missions:2,scenarios:0,operations:1,graduated:true,settings:true,bindings:true,createdAt:profile.createdAt});
 assert.equal(profile.entries['raptor:quality:v1'],'HIGH');
 assert.equal(Object.hasOwn(profile.entries,'another-app'),false);assert.equal(Object.hasOwn(profile.entries,'raptor:bench:v3'),false);
 const target=store({'another-app':'untouched','raptor:bench:v3':'existing-device-benchmark','raptor.op.v1:VALDEZ':'replaced'});
 restorePilotBackup(target,parsePilotBackup(JSON.stringify(profile)));
 assert.equal(target.getItem('another-app'),'untouched');assert.equal(target.getItem('raptor:bench:v3'),'existing-device-benchmark');
 assert.equal(target.getItem('raptor.op.v1:VALDEZ'),null);
 assert.deepEqual(JSON.parse(target.getItem('raptor:binds:v3')),bindings);
 assert.deepEqual(JSON.parse(target.getItem('raptor.op.v1:NELLIS')),profile.entries['raptor.op.v1:NELLIS']);
 assert.equal(JSON.parse(target.getItem('raptor.settings.v1')).pointingDevice,'trackpad');
});

test('New York profile preserves standalone completion separately from campaign and combat operations',()=>{
 const source=populated();
 source.setItem('raptor.scenarios.v1',JSON.stringify({v:1,done:{Y01:1}}));
 source.setItem('raptor.preflight.v1',JSON.stringify({front:'NEWYORK',mode:'practice',time:'golden'}));
 const profile=createPilotBackup(source);
 assert.equal(profile.entries['raptor.op.v1:NEWYORK'],undefined);
 assert.equal(summarizePilotBackup(profile).missions,2);
 assert.equal(summarizePilotBackup(profile).scenarios,1);
 assert.equal(summarizePilotBackup(profile).operations,1);
 const target=store();restorePilotBackup(target,profile);
 assert.deepEqual(JSON.parse(target.getItem('raptor.scenarios.v1')),{v:1,done:{Y01:1}});
 assert.deepEqual(JSON.parse(target.getItem('raptor.preflight.v1')),{front:'NEWYORK',mode:'practice',time:'golden'});
 for(const mutate of [
  value=>{value.entries['raptor.scenarios.v1'].done.N01=1;},
  value=>{value.entries['raptor.auth.v1'].done.Y01=1;},
  value=>{value.entries['raptor.op.v1:NEWYORK']=null;},
  value=>{value.entries['raptor.preflight.v1'].mode='operation';},
  value=>{value.entries['raptor.preflight.v1'].mode='battle';},
 ]){
  const changed=structuredClone(profile);mutate(changed);
  const before=[...target.values];assert.throws(()=>restorePilotBackup(target,changed));
  assert.deepEqual([...target.values],before);
 }
});

test('version-1 backups created before standalone scenarios preview and restore an empty scenario record',()=>{
 const older=createPilotBackup(populated());delete older.entries['raptor.scenarios.v1'];
 const parsed=parsePilotBackup(JSON.stringify(older));
 assert.equal(parsed.entries['raptor.scenarios.v1'],null);
 assert.equal(summarizePilotBackup(parsed).scenarios,0);
 const target=store({'raptor.scenarios.v1':JSON.stringify({v:1,done:{Y01:1}})});
 restorePilotBackup(target,parsed);
 assert.equal(target.getItem('raptor.scenarios.v1'),null);
});

test('restore rejects unknown keys, incomplete/future files, corrupt operation checksums and invalid records before writing',()=>{
 const valid=createPilotBackup(populated());
 const mutations=[
  value=>{value.version=2;},value=>{value.entries.unrelated='overwrite';},value=>{delete value.entries['raptor.auth.v1'];},
  value=>{value.entries['raptor.op.v1:NELLIS'].frontKm=8;},
  value=>{value.entries['raptor.auth.v1'].done.fake=1;},
  value=>{value.entries['raptor.settings.v1']={mouseSensitivity:100};},
  value=>{value.entries['raptor:binds:v3']={fire_mguns:[['Escape']]};},
  value=>{value.entries['raptor:binds:v3']={menu:[]};},
  value=>{value.entries['raptor:binds:v3']={throttle_up:[['WheelUp']]};},
  value=>{value.entries['raptor.flight-school.v1'].completions=-1;},
  value=>{const op=value.entries['raptor.op.v1:NELLIS'];op.aces[0].bonus='oops';op.sum=operationChecksum(op);},
 ];
 for(const mutate of mutations){
  const changed=structuredClone(valid);mutate(changed);
  const target=store({'raptor.auth.v1':'original'}),before=[...target.values];
  assert.throws(()=>restorePilotBackup(target,changed));assert.deepEqual([...target.values],before);
 }
 assert.throws(()=>parsePilotBackup('not JSON'),/valid JSON/);
 assert.throws(()=>parsePilotBackup(' '.repeat(262145)),/256 KB/);
});

test('export uses recovered live settings and bindings when their old stored JSON is damaged',()=>{
 const source=store({'raptor.settings.v1':'bad settings JSON','raptor:binds:v3':'bad binding JSON'});
 const backup=createPilotBackup(source,{settings:DEFAULTS,bindings:{throttle_up:[['KeyU']]}});
 assert.deepEqual(backup.entries['raptor.settings.v1'],DEFAULTS);
 assert.deepEqual(backup.entries['raptor:binds:v3'],{throttle_up:[['KeyU']]});
 assert.equal(source.getItem('raptor.settings.v1'),'bad settings JSON','export does not rewrite browser data');
});

test('temporary quota failure rolls back already-written records and preserves unrelated data',()=>{
 const profile=createPilotBackup(populated());
 const target=store({'raptor.auth.v1':'old campaign','raptor.op.v1:NELLIS':'old operation','another-app':'safe'});
 const before=[...target.values];let writes=0;
 const original=target.setItem;
 target.setItem=(key,value)=>{if(++writes===2)throw Error('quota');original(key,value);};
 assert.throws(()=>restorePilotBackup(target,profile),/previous profile was kept/);
 assert.deepEqual([...target.values],before);
});

test('blocked reads or writes cannot falsely claim an exported or restored profile',()=>{
 assert.throws(()=>createPilotBackup({getItem(){throw Error('blocked');}}),/No backup/);
 const profile=createPilotBackup(populated());
 assert.throws(()=>restorePilotBackup({getItem(){throw Error('blocked');}},profile),/Nothing was changed/);
 const target=store({'raptor.auth.v1':'original'});target.setItem=()=>{throw Error('blocked');};
 assert.throws(()=>restorePilotBackup(target,profile),/previous profile was kept/);
 assert.equal(target.getItem('raptor.auth.v1'),'original');
});

test('a rollback failure is reported honestly and backup export never mutates storage',()=>{
 const source=populated(),before=[...source.values];createPilotBackup(source);assert.deepEqual([...source.values],before);
 const target=store({'raptor.auth.v1':'old','raptor.op.v1:NELLIS':'old'});let writes=0;
 const original=target.setItem;target.setItem=(key,value)=>{if(++writes>=2)throw Error('blocked');original(key,value);};
 assert.throws(()=>restorePilotBackup(target,createPilotBackup(source)),/some records may have changed/);
});

test('an empty profile restores explicit defaults without importing machine benchmarks or legacy control keys',()=>{
 const profile=createPilotBackup(store());assert.equal(Object.keys(profile.entries).length,BACKUP_KEYS.length);
 const target=store({'raptor:quality:v1':'HIGH','raptor.settings.v1':'old','raptor:binds:v2':'old keys','another-app':'safe'});
 restorePilotBackup(target,profile);
 assert.deepEqual([...target.values],[['another-app','safe']]);
});

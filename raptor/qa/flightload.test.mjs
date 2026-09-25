import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRequestedFlight,requestedFlight,FlightLoadError,bootFailureMessage} from '../src/game/flightload.js';
const flags=value=>new URLSearchParams(value);
const emptyStorage=()=>{const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};return data;};

test('practice and quick battle load no mission modules',async()=>{
  let touched=false;
  const imports={missions:()=>{touched=true;throw Error('must not import');}};
  assert.equal(await loadRequestedFlight(flags('front=NELLIS&mode=practice'),imports),null);
  assert.equal(await loadRequestedFlight(flags('front=VALDEZ'),imports),null);
  assert.equal(touched,false);
});

test('an authored flight returns the requested validated mission and comms without saving progress',async()=>{
  const data=emptyStorage();
  const result=await loadRequestedFlight(flags('sortie=N01&front=NELLIS'));
  assert.equal(result.request.id,'N01');assert.equal(result.request.kind,'campaign');
  assert.equal(result.spec.front,'NELLIS');assert.ok(result.spec.objectives.length);
  assert.equal(result.authored.id,'N01');assert.equal(result.authored.saved,false);
  assert.ok(Object.keys(result.lines).length);assert.equal(data.size,0);
});

test('a built-in mission remains a scripted mission',async()=>{
  const result=await loadRequestedFlight(flags('mission=nellis-strike-01'));
  assert.equal(result.spec.type,'strike');assert.equal(result.request.kind,'mission');
  assert.equal(result.campaign,null);assert.equal(result.authored,null);
});

test('operation preparation reads the chosen region without recording a result',async()=>{
  const data=emptyStorage();
  const result=await loadRequestedFlight(flags('op=1&front=VALDEZ'));
  assert.equal(result.request.kind,'operation');assert.equal(result.spec.front,'VALDEZ');
  assert.equal(result.campaign.save.front,'VALDEZ');assert.equal(result.campaign.saved,false);
  assert.equal(data.size,0);
});

test('an unknown authored mission fails explicitly instead of producing a quick battle',async()=>{
  await assert.rejects(loadRequestedFlight(flags('sortie=N99')),error=>{
    assert.ok(error instanceof FlightLoadError);assert.equal(error.request.id,'N99');
    assert.match(error.cause.message,/unknown sortie/);return true;
  });
});

test('a mission module network failure stays a mission failure with its original cause',async()=>{
  const cause=Error('connection lost');
  await assert.rejects(loadRequestedFlight(flags('sortie=N01'),{missions:async()=>{throw cause;}}),error=>{
    assert.ok(error instanceof FlightLoadError);assert.equal(error.cause,cause);
    assert.equal(error.request.kind,'campaign');assert.equal(error.request.id,'N01');return true;
  });
});

test('an authored sortie download failure cannot resolve as an empty mission',async()=>{
  const cause=Error('sortie download failed');
  await assert.rejects(loadRequestedFlight(flags('sortie=V01'),{missions:async()=>({}),authored:async()=>({loadSortie:async()=>{throw cause;}})}),error=>error instanceof FlightLoadError&&error.cause===cause);
});

test('an unavailable operation fails instead of starting an unrelated battle',async()=>{
  const cause=Error('operation engine unavailable');
  await assert.rejects(loadRequestedFlight(flags('op=1&front=MARIANAS'),{missions:async()=>({}),operation:async()=>{throw cause;}}),error=>error instanceof FlightLoadError&&error.request.id==='MARIANAS'&&error.cause===cause);
});

test('mission links that disable required systems fail before importing or starting a simulation',async()=>{
  let imports=0;
  for(const conflict of ['nomatch=1','nobattle=1','demo=1','mode=practice']) {
    await assert.rejects(loadRequestedFlight(flags(`sortie=N01&${conflict}`),{missions:()=>{imports++;}}),FlightLoadError);
  }
  assert.equal(imports,0);
});

test('an unknown operation region fails explicitly',async()=>{
  await assert.rejects(loadRequestedFlight(flags('op=1&front=UNKNOWN')),error=>error instanceof FlightLoadError&&/Unknown operation region/.test(error.cause.message));
});

test('flight requests preserve established mission, sortie, operation precedence',()=>{
  assert.deepEqual(requestedFlight(flags('mission=nellis-strike-01&sortie=N01&op=1')),{kind:'mission',id:'nellis-strike-01'});
  assert.deepEqual(requestedFlight(flags('sortie=N01&op=1')),{kind:'campaign',id:'N01'});
});

test('recovery guidance identifies mission, graphics and file failures without leaking raw errors',()=>{
  const secret=Error('private diagnostic text');
  const mission=bootFailureMessage(new FlightLoadError('internal',{cause:secret,request:{kind:'campaign',id:'N01'}}),'mission');
  assert.match(mission.title,/MISSION/);assert.equal(mission.retry,'Retry mission');
  assert.match(bootFailureMessage(secret,'graphics-device').detail,/Low graphics/);
  assert.match(bootFailureMessage(secret,'warmup').detail,/Low graphics/);
  const file=bootFailureMessage(secret,'systems');assert.match(file.detail,/connection/);
  assert.doesNotMatch(JSON.stringify([mission,file]),/private diagnostic/);
});

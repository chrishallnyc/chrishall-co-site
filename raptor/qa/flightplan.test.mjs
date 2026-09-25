import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlightPlan,flightURL,hasFlightRequest} from '../src/game/flightplan.js';

test('a first-time or corrupt preflight selection chooses a safe practice flight',()=>{
  for(const value of [null,[],{mode:'unknown',front:'constructor',time:'night'}])assert.deepEqual(validateFlightPlan(value),{mode:'practice',front:'NELLIS',time:'noon'});
});
test('practice excludes enemies and the match timer while battle includes both',()=>{
  const practice=new URLSearchParams(flightURL({mode:'practice',front:'VALDEZ',time:'golden'}));
  assert.equal(practice.get('nobattle'),'1');assert.equal(practice.get('nomatch'),'1');assert.equal(practice.get('mode'),'practice');assert.equal(practice.get('tod'),'21.4');
  const battle=new URLSearchParams(flightURL({mode:'battle',front:'MARIANAS',time:'afternoon'}));
  assert.equal(battle.has('nobattle'),false);assert.equal(battle.has('nomatch'),false);assert.equal(battle.get('tod'),'15.5');
});
test('authored campaign uses its actual region and authored time of day',()=>{
  const query=new URLSearchParams(flightURL({mode:'campaign',front:'NELLIS',time:'noon'},{id:'V01',front:'VALDEZ'}));
  assert.equal(query.get('front'),'VALDEZ');assert.equal(query.get('sortie'),'V01');assert.equal(query.has('tod'),false);
  assert.equal(flightURL({mode:'campaign'},null),null);
});
test('operation uses its saved mission conditions rather than a stale preflight time',()=>{
  const query=new URLSearchParams(flightURL({mode:'operation',front:'MARIANAS',time:'golden'}));
  assert.equal(query.get('op'),'1');assert.equal(query.has('tod'),false);
});
test('analytics query parameters cannot unexpectedly launch a combat flight',()=>{
  assert.equal(hasFlightRequest(new URLSearchParams('?utm_source=link&ref=friend')),false);
  for(const search of ['?mode=practice','?front=NELLIS','?sortie=N01','?gl=1','?demo=1'])assert.equal(hasFlightRequest(new URLSearchParams(search)),true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { flightdeckFront, selectFlightMode } from '../src/game/flightdeck.js';
import { FRONTS } from '../src/game/pilotlog.js';
import { flightURL } from '../src/game/flightplan.js';

test('leaving campaign for battle or operation keeps its visible region, even after choosing New York',()=>{
  for(const front of ['NELLIS','VALDEZ','MARIANAS']) {
    const next={front,id:front[0]+'01'};
    const campaign=selectFlightMode({front:'NEWYORK',mode:'practice',time:'golden'},'campaign',next);
    assert.equal(flightdeckFront(campaign,next),front);
    for(const mode of ['battle','operation','practice']) {
      assert.notEqual(FRONTS[flightdeckFront(campaign,next)][mode],false);
      const selected=selectFlightMode(campaign,mode,next);
      assert.equal(selected.front,front);
      assert.equal(selected.mode,mode);
      assert.equal(selected.time,'golden');
      const query=new URLSearchParams(flightURL(selected));
      assert.equal(query.get('front'),front);
      assert.equal(query.get('op'),mode==='operation'?'1':null);
      assert.equal(query.get('nobattle'),mode==='practice'?'1':null);
    }
  }
});

test('New York outside an active campaign keeps its own supported flight modes',()=>{
  for(const currentMode of ['practice','campaign']) {
    const plan={front:'NEWYORK',mode:currentMode,time:'noon'};
    assert.equal(flightdeckFront(plan,null),'NEWYORK');
    assert.equal(FRONTS[flightdeckFront(plan,null)].battle,false);
    assert.equal(FRONTS[flightdeckFront(plan,null)].operation,false);
    for(const mode of ['practice','battle','operation']) {
      assert.deepEqual(selectFlightMode(plan,mode,null),{front:'NEWYORK',mode:'practice',time:'noon'});
    }
  }
});

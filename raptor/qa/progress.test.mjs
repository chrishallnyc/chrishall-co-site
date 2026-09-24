import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuth, saveAuth, markDone, authSaveSucceeded, isUnlocked } from '../src/campaign/authored.js';

function storage({denyRead=false,denyWrite=false}={}) {
  const data=new Map();
  globalThis.localStorage={
    getItem(key){if(denyRead)throw Error('read denied');return data.get(key)??null;},
    setItem(key,value){if(denyWrite)throw Error('write denied');data.set(key,String(value));},
  };
  return data;
}

test('a completed mission reports saved only after it is persisted and survives reload',()=>{
  storage();
  markDone('N01');
  assert.equal(authSaveSucceeded(),true);
  assert.equal(loadAuth().done.N01,1);
  assert.equal(isUnlocked(loadAuth(),1),true);
});

test('a failed mission save cannot inherit a successful status from a previous result',()=>{
  const data=storage();markDone('N01');assert.equal(authSaveSucceeded(),true);
  localStorage.setItem=()=>{throw Error('quota exceeded');};
  const result=markDone('N02');
  assert.equal(result.done.N02,1,'the current result is still known to the running game');
  assert.equal(authSaveSucceeded(),false,'debrief must report that saving failed');
  assert.equal(loadAuth().done.N01,1,'earlier completed missions stay intact');
  assert.equal(loadAuth().done.N02,undefined);
  assert.equal(JSON.parse(data.get('raptor.auth.v1')).done.N02,undefined);
});

test('fully denied browser storage does not report a completed mission as saved',()=>{
  storage({denyRead:true,denyWrite:true});
  assert.doesNotThrow(()=>markDone('N01'));
  assert.equal(authSaveSucceeded(),false);
  assert.deepEqual(loadAuth().done,{});
});

test('replaying an already persisted mission remains saved without needing another write',()=>{
  storage();markDone('N01');
  localStorage.setItem=()=>{throw Error('writes blocked');};
  markDone('N01');
  assert.equal(authSaveSucceeded(),true);
  assert.equal(loadAuth().done.N01,1);
});

test('the authored save API returns the actual write outcome',()=>{
  storage({denyWrite:true});
  assert.equal(saveAuth({v:1,done:{N01:1}}),false);
  storage();assert.equal(saveAuth({v:1,done:{N01:1}}),true);
});

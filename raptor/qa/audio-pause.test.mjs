import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioBus} from '../src/engine/audio.js';
import * as settings from '../src/game/settings.js';
import {Cockpit} from '../src/game/cockpit.js';
const data=new Map();
globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
globalThis.window={dispatchEvent(){}};
function audio(){const a=Object.create(AudioBus.prototype),gains=[];Object.assign(a,{muted:false,paused:false,ctx:{currentTime:5},muteGain:{gain:{setTargetAtTime:v=>gains.push(v)}}});return {a,gains};}
test('editing mute while paused cannot restore engine audio; resuming honors the saved mute',()=>{
const {a,gains}=audio();a.setPaused(true);a.setMute(true);a.setMute(false);assert.deepEqual(gains,[0,0,0]);a.setPaused(false);assert.equal(gains.at(-1),1);a.setMute(true);a.setPaused(true);a.setPaused(false);assert.equal(gains.at(-1),0);
});
test('mute works for the session when persistence is blocked',()=>{
const old=globalThis.localStorage;globalThis.localStorage={setItem(){throw Error('blocked')}};try{const {a,gains}=audio();assert.doesNotThrow(()=>a.setMute(true));assert.equal(gains.at(-1),0);}finally{globalThis.localStorage=old;}
});
test('an old audio-lab mute becomes visible and can be cleared or reset permanently',()=>{
data.clear();data.set('raptor:mute','1');assert.equal(settings.loadSettings().muted,true);settings.saveSettings({muted:false});assert.equal(settings.loadSettings().muted,false);data.delete(settings.KEY);settings.loadSettings();settings.resetSettings();assert.equal(settings.loadSettings().muted,false);
});
test('master mute and radio-off edits cancel an already speaking line',()=>{
let cancels=0;const ctx={voice:{cancel:()=>cancels++}};settings.applySettings({...settings.DEFAULTS,voice:true,masterVol:.5},ctx);assert.equal(cancels,0);settings.applySettings({...settings.DEFAULTS,voice:true,masterVol:0},ctx);settings.applySettings({...settings.DEFAULTS,voice:true,muted:true},ctx);settings.applySettings({...settings.DEFAULTS,voice:false},ctx);assert.equal(cancels,3);
});
test('pause silences speech even if the pilot enables radio after opening the menu',()=>{
  let paused=false;const old=globalThis.window;
  globalThis.window={speechSynthesis:{pause:()=>paused=true,resume:()=>paused=false}};
  try {settings.bindLive(null);settings.loadSettings();assert.equal(settings.current().voice,false);Cockpit.prototype.quiet.call({audio:null},true);assert.equal(paused,true);Cockpit.prototype.quiet.call({audio:null},false);assert.equal(paused,false);}
  finally{globalThis.window=old;}
});

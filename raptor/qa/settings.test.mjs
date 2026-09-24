import test from 'node:test';
import assert from 'node:assert/strict';
import * as settings from '../src/game/settings.js';
import * as quality from '../src/engine/quality.js';

const data=new Map();
globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
globalThis.window={devicePixelRatio:2,dispatchEvent(){}};
globalThis.matchMedia=()=>({matches:false});

test('old settings acquire usable interface and mouse defaults',()=>{
  const s=settings.validate({masterVol:.4,fov:75});
  assert.equal(s.fov,75);assert.equal(s.masterVol,.4);assert.equal(s.showHints,true);
  assert.equal(s.hudScale,1);assert.equal(s.mouseSensitivity,1);assert.equal(s.invertY,false);
  assert.equal(s.pointingDevice,'mouse');assert.equal(s.trackpadSensitivity,.65);assert.equal(s.gamepadSensitivity,1);
});
test('legacy hidden tips migrate quietly and checklist preferences are independent',()=>{
  assert.equal(settings.validate({showHints:false}).showChecklist,false);
  assert.equal(settings.validate({showHints:false,showChecklist:true}).showChecklist,true);
  assert.equal(settings.validate({showHints:true,showChecklist:false}).showChecklist,false);
});
test('corrupt settings cannot select inherited tier/palette names or nonfinite scales',()=>{
  const s=settings.validate({tier:'constructor',markerPalette:'toString',hudScale:Infinity,mouseSensitivity:-50,renderScale:'1.5',fov:999});
  assert.equal(s.tier,'AUTO');assert.equal(s.markerPalette,'default');assert.equal(s.hudScale,1);
  assert.equal(s.mouseSensitivity,.35);assert.equal(s.renderScale,null);assert.equal(s.fov,90);
});
test('audio changes do not resize the renderer or rebuild the camera projection',()=>{
  let resize=0,projection=0;
  const ctx={baseTier:'MED',renderer:{getPixelRatio:()=>2,setPixelRatio(){resize++;}},camera:{fov:60,updateProjectionMatrix(){projection++;}}};
  for(const volume of [.9,.7,.4,.1])settings.applySettings({...settings.DEFAULTS,masterVol:volume},ctx);
  assert.equal(resize,0,'volume dragged through four values must not resize GPU buffers');
  assert.equal(projection,0);
});
test('changed render scale and FOV apply exactly once; input options reach the live controls',()=>{
  let ratio=2,resize=0,projection=0,inputOptions,hudScale;
  const ctx={baseTier:'MED',renderer:{getPixelRatio:()=>ratio,setPixelRatio:v=>{ratio=v;resize++;}},camera:{fov:60,updateProjectionMatrix(){projection++;}},input:{setOptions:o=>inputOptions=o},hud:{setScale:s=>hudScale=s}};
  const value={...settings.DEFAULTS,renderScale:.75,fov:80,mouseSensitivity:1.5,invertY:true,hudScale:1.2};
  settings.applySettings(value,ctx);settings.applySettings(value,ctx);
  assert.equal(resize,1);assert.equal(projection,1);assert.equal(ratio,1.5);
  assert.deepEqual(inputOptions,{mouseSensitivity:1.5,gamepadSensitivity:1,invertY:true});assert.equal(hudScale,1.2);
});
test('new settings survive storage reload and default reset preserves other game data',()=>{
  data.clear();data.set('raptor.auth.v1','campaign-data');settings.bindLive(null);settings.loadSettings();
  settings.saveSettings({hudScale:1.3,showHints:false,showFps:true,mouseSensitivity:1.4,invertY:true});
  const s=settings.loadSettings();assert.equal(s.hudScale,1.3);assert.equal(s.showHints,false);assert.equal(s.showFps,true);assert.equal(s.mouseSensitivity,1.4);
  settings.resetSettings();assert.equal(settings.current().showHints,true);assert.equal(data.get('raptor.auth.v1'),'campaign-data');
});
test('corrupt benchmark/manual tier data is ignored, including prototype properties',()=>{
  data.clear();data.set('raptor:quality:v1','constructor');data.set('raptor:bench:v1',JSON.stringify({tier:'HIGH',backend:'webgpu',ms:'broken'}));
  assert.equal(quality.hasManualTier(),false);assert.equal(quality.savedBench(),null);
  assert.equal(quality.setTier('toString'),false);assert.deepEqual(quality.tierParams('constructor'),quality.TIERS.MED);
});
test('automatic quality respects a display-limited 60 fps scene and lowers a struggling tier',()=>{
  assert.equal(quality.benchPick(16.7,'webgpu','HIGH'),'HIGH');
  assert.equal(quality.benchPick(8.3,'webgpu','HIGH'),'HIGH');
  assert.equal(quality.benchPick(25,'webgpu','HIGH'),'MED');
  assert.equal(quality.benchPick(42,'webgpu','HIGH'),'LOW');
});
test('storage denial still permits quality selection and settings within this session',()=>{
  const original=globalThis.localStorage;
  globalThis.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
  try{
    quality.clearBench();assert.equal(quality.setTier('LOW'),true);assert.equal(quality.detectTier({backend:'webgpu'}),'LOW');
    quality.saveBench({tier:'MED',backend:'webgpu',ms:16.7});assert.equal(quality.savedBench().tier,'MED');
    settings.loadSettings();assert.doesNotThrow(()=>settings.saveSettings({masterVol:.5}));assert.equal(settings.current().masterVol,.5);
    assert.doesNotThrow(()=>settings.resetSettings());
  }finally{globalThis.localStorage=original;quality.clearBench();}
});

test('blocked settings reads report session-only state while malformed JSON remains recoverable',()=>{
  const original=globalThis.localStorage;
  try {
    globalThis.localStorage={...original,getItem(){throw Error('denied');}};
    settings.loadSettings();assert.equal(settings.storageAvailable(),false);
    assert.ok(Number.isFinite(settings.current().fov));
    globalThis.localStorage=original;data.set(settings.KEY,'{broken');
    settings.loadSettings();assert.equal(settings.storageAvailable(),true);
    assert.equal(settings.current().masterVol,settings.DEFAULTS.masterVol);
  }finally{globalThis.localStorage=original;data.clear();settings.loadSettings();}
});

test('denied settings writes update the actual options footer without discarding live values',async()=>{
  const { ControlsMenu }=await import('../src/game/controlsmenu.js');
  const original=globalThis.localStorage;
  data.clear();settings.bindLive(null);settings.loadSettings();
  const status={textContent:''},notice={textContent:''},indicator={classList:{toggle(){}}};
  let change;
  const slider={dataset:{setting:'masterVol'},type:'range',value:'.35',addEventListener(type,callback){if(type==='input')change=callback;}};
  const menu=Object.create(ControlsMenu.prototype);
  Object.assign(menu,{tab:'audio',input:{storageAvailable:true,actions:{},setOptions(){}},el:{
    querySelectorAll:selector=>selector==='[data-setting]'?[slider]:[],
    querySelector:selector=>({'[data-storage-status]':status,'.setup-notice':notice,'.save-indicator':indicator}[selector]),
  }});
  menu._wire();
  try {
    globalThis.localStorage={...original,setItem(){throw Error('quota exceeded');}};
    change();
    assert.equal(settings.current().masterVol,.35,'the current flight still receives the requested volume');
    assert.equal(settings.storageAvailable(),false);
    assert.match(status.textContent,/Options: session only/);
    assert.doesNotMatch(status.textContent,/save automatically/);
    assert.match(notice.textContent,/reset when you launch or reload/);
    assert.equal(data.has(settings.KEY),false,'a denied write must not be represented as persisted');
    menu.tab='controls';
    assert.match(menu._storageState().text,/aim options are session only/);
    assert.match(menu._storageState().text,/Keys saved/);
    globalThis.localStorage=original;
    settings.saveSettings({masterVol:.4});
    menu.tab='audio';menu.input.storageAvailable=false;menu._updateStorageStatus();
    assert.equal(settings.storageAvailable(),true);
    assert.equal(status.textContent,'Options save automatically','options status is independent of keybinding persistence');
  }finally{globalThis.localStorage=original;data.clear();settings.loadSettings();}
});

test('failed settings reset reports session-only defaults and retains the previous stored record',()=>{
  const original=globalThis.localStorage;
  data.clear();settings.loadSettings();settings.saveSettings({fov:80});
  try {
    globalThis.localStorage={...original,removeItem(){throw Error('denied');}};
    settings.resetSettings();
    assert.equal(settings.current().fov,settings.DEFAULTS.fov);
    assert.equal(settings.storageAvailable(),false);
    assert.equal(JSON.parse(data.get(settings.KEY)).fov,80);
    globalThis.localStorage=original;
    settings.loadSettings();assert.equal(settings.current().fov,80);
    settings.resetSettings();assert.equal(settings.storageAvailable(),true);
  }finally{globalThis.localStorage=original;data.clear();settings.loadSettings();}
});

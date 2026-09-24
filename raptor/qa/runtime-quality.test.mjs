import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootAssetTier, deviceTier, detectTier, isCompatibleBench, saveBench, setTier, hasManualTier } from '../src/engine/quality.js';
import { requestedBootAssets, describeBootAssets, assetsNeedReload, oceanFineResolution, terrainSourcePreset } from '../src/engine/bootassets.js';
import { qualityProfile, qualityWorkload } from '../src/engine/cloudquality.js';
import { QualityBenchmark } from '../src/engine/qualitybench.js';
import { TerrainDetailTransition, tierHasNearTerrain } from '../src/world/terraindetail.js';
import * as settings from '../src/game/settings.js';
import { ControlsMenu } from '../src/game/controlsmenu.js';

const storage = new Map();
globalThis.localStorage = { getItem:k=>storage.get(k)??null, setItem:(k,v)=>storage.set(k,String(v)), removeItem:k=>storage.delete(k) };
Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:12,deviceMemory:16},configurable:true});
globalThis.matchMedia=()=>({matches:false});
globalThis.window={devicePixelRatio:1};
const context = {backend:'webgpu',front:'VALDEZ',flags:new URLSearchParams(),sourceEnabled:true};
function assets(bootTier='HIGH',{source=true,fine=256,drape=true,hash='source-v1',normalHash='normal-v1'}={}) {
 return describeBootAssets({bootTier,terrain:{meta:{grid:4096},nearDetail:true,
  sourceField:source?{meta:{provenance:{sourceId:6412},sourceCrop:{row:1600,col:1600,size:3200},width:3200,height:3200,heightPackedSHA256:hash,normalPixelsSHA256:normalHash}}:null,
  drape:{albedo:drape?{image:{width:16384,height:16384}}:null}},water:{},fftOcean:true,
  fineOcean:{N:fine,tileM:32},cloudNoise:{version:1,seed:1337,normalization:{lo:.25,hi:.875},resolution:'standard',baseN:128,detailN:64},cloudMode:'native'});
}
const profile = (loaded,query='')=>qualityProfile({backend:'webgpu',front:'VALDEZ',mode:'native',pixelRatio:1,width:1440,height:900,
  workload:qualityWorkload(new URLSearchParams(query)),assets:loaded});
beforeEach(()=>{storage.clear();settings.bindLive(null);settings.loadSettings();navigator.hardwareConcurrency=12;navigator.deviceMemory=16;window.__RAPTOR=null;});

test('Auto reboots preserve desktop assets after selecting a lower render tier',()=>{
 const boot=bootAssetTier(context),request=requestedBootAssets(boot,context),loaded=assets(boot);
 assert.equal(boot,'HIGH');assert.deepEqual(request,{noise:'standard',fineOcean:256,source:'16'});
 saveBench({backend:'webgpu',tier:'MED',profile:profile(loaded)});
 assert.equal(detectTier({backend:'webgpu',profile:profile(loaded)}),'MED');
 assert.equal(bootAssetTier(context),'HIGH');
 assert.deepEqual(requestedBootAssets(bootAssetTier(context),context),request);
 assert.equal(detectTier({backend:'webgpu',profile:profile(assets(bootAssetTier(context)))}),'MED');
});

test('Auto upgrades on a heuristic MED device do not silently replace its asset pack',()=>{
 navigator.hardwareConcurrency=8;
 assert.equal(deviceTier(context),'MED');const boot=bootAssetTier(context);
 const loaded=assets(boot,{source:false,fine:128});saveBench({backend:'webgpu',tier:'HIGH',profile:profile(loaded)});
 assert.equal(detectTier({backend:'webgpu',profile:profile(loaded)}),'HIGH');
 assert.deepEqual(requestedBootAssets(bootAssetTier(context),context),{noise:'standard',fineOcean:128,source:'0'});
});

test('manual asset selection and explicit source/ocean overrides win over cached render quality',()=>{
 saveBench({backend:'webgpu',tier:'LOW',profile:profile(assets())});
 for(const [tier,fine,source,noise] of [['LOW',128,'0','standard'],['MED',128,'0','standard'],['HIGH',256,'16','standard'],['ULTRA',256,'16','ultra']]){
  setTier(tier);assert.equal(bootAssetTier(context),tier);
  assert.deepEqual(requestedBootAssets(tier,context),{noise,fineOcean:fine,source});
 }
 for(const value of ['0','128','256'])assert.equal(oceanFineResolution('HIGH',value),Number(value));
 for(const value of ['0','16'])assert.equal(terrainSourcePreset('LOW',value,'VALDEZ'),value);
 assert.equal(terrainSourcePreset('ULTRA','16','NELLIS'),'0');
 assert.equal(terrainSourcePreset('LOW','8','VALDEZ'),'0');assert.equal(terrainSourcePreset('LOW','slice','VALDEZ'),'0');
 assert.equal(requestedBootAssets('ULTRA',{...context,backend:'webgl'}).fineOcean,0);
 assert.equal(requestedBootAssets('ULTRA',{...context,backend:'webgl'}).source,'0');
 assert.equal(requestedBootAssets('LOW',{...context,backend:'webgl',flags:new URLSearchParams('terrainsource=16')}).source,'16');
 storage.set('raptor:quality:v1','BROKEN');assert.equal(bootAssetTier(context),'HIGH');
});

test('actual source, fine-ocean and drape fallbacks cannot reuse successful asset timings',()=>{
 const full=profile(assets());saveBench({backend:'webgpu',tier:'LOW',profile:full});
 for(const alternate of [assets('HIGH',{source:false}),assets('HIGH',{fine:0}),assets('HIGH',{drape:false}),assets('HIGH',{hash:'source-v2'})]){
  assert.notEqual(profile(alternate),full);assert.equal(detectTier({backend:'webgpu',profile:profile(alternate)}),'HIGH');
 }
 assert.equal(detectTier({backend:'webgpu',profile:full}),'LOW');
});

test('terrain cost overrides and policy version isolate saved workload identity',()=>{
 const full=profile(assets());
 for(const flag of ['terrainnear=0','drape=0','snowdetail=0','terrainmaterials=0','cloudshadow=old','terrainsource=0','terrainsource=8','terrainsource=16','terrainsource=slice'])assert.notEqual(profile(assets(),flag),full);
 assert.equal(profile(assets(),'drape=0&terrainnear=0'),profile(assets(),'terrainnear=0&drape=0'));
 assert.equal(profile(assets(),'yaw=100&tod=4'),full);
 assert.notEqual(profile({...assets(),version:'future-policy'}),full);
 for(const change of [{version:2},{seed:42},{normalization:[.2,.85]}])
  assert.notEqual(profile({...assets(),clouds:{...assets().clouds,...change}}),full);
});

test('cache selection and benchmark-start gate agree on malformed or incompatible records',()=>{
 const key=profile(assets()),options={backend:'webgpu',profile:key};
 for(const bad of [null,{}, {tier:'BROKEN',backend:'webgpu',profile:key},
  {tier:'LOW',backend:'webgl',profile:key},{tier:'LOW',backend:'webgpu',profile:'other-assets'}]){
  assert.equal(isCompatibleBench(bad,options),false);saveBench(bad);assert.equal(detectTier(options),'HIGH');
 }
 const valid={tier:'MED',backend:'webgpu',profile:key};assert.equal(isCompatibleBench(valid,options),true);
 saveBench(valid);assert.equal(detectTier(options),'MED');
});

test('near downgrade preserves the final prior frame before releasing fine geometry',()=>{
 const d=new TerrainDetailTransition();d.advance(0);d.setEnabled(false);
 let prior=1;
 for(const dt of [.07,.02,.09,.12]){d.advance(dt);assert.equal(d.previous,prior);assert.ok(d.current<=prior);prior=d.current;}
 assert.equal(d.current,0);assert.ok(d.previous>0);assert.equal(d.useFine,true);assert.equal(d.settling,true);
 d.advance(0);assert.equal(d.previous,0);assert.equal(d.useFine,false);assert.equal(d.settling,false);
});

test('near upgrades, rapid reversal and cuts preserve actual current/prior positions',()=>{
 const d=new TerrainDetailTransition();d.setEnabled(false);d.advance(0);
 assert.equal(d.current,0);d.setEnabled(true);d.advance(.11);
 const h=1500,parent=1480,first=parent+(h-parent)*d.current;
 assert.equal(d.previous,0);assert.ok(first>parent&&first<h);
 const atTurn=d.current;d.setEnabled(false);assert.equal(d.current,atTurn);d.advance(.07);
 assert.equal(d.previous,atTurn);assert.ok(d.current<atTurn);
 const priorPosition=parent+(h-parent)*d.previous;assert.equal(priorPosition,first);
 d.advance(.1,false);assert.equal(d.previous,d.current); // cut suppresses unrelated history
 d.advance(1);d.advance(0);assert.equal(d.useFine,false);
 d.setEnabled(true);d.advance(NaN);assert.equal(d.current,0);d.advance(-1);assert.equal(d.current,0);
 d.advance(.3);assert.equal(d.current,1);
});

test('hard disabled capability stays coarse; repeated menu application does not restart a fade',()=>{
 const disabled=new TerrainDetailTransition(false);disabled.setEnabled(true);disabled.advance(1);assert.equal(disabled.useFine,false);
 const d=new TerrainDetailTransition();d.advance(0);d.setEnabled(false);d.advance(.1);const strength=d.current;
 assert.equal(d.setEnabled(false),false);d.advance(.1);assert.ok(d.current<strength);d.advance(.1);assert.equal(d.current,0);
});

test('Auto excludes settling and upload frames without losing measurements of completed tiers',()=>{
 const q=new QualityBenchmark({tier:'HIGH',backend:'webgpu',warmup:2,samples:3});
 for(let i=0;i<4;i++)assert.equal(q.observe(40),null);
 const down=q.observe(40);assert.equal(down.tier,'MED');assert.equal(q.measurements.get('HIGH'),40);
 for(let i=0;i<20;i++)assert.equal(q.observe(200,{settling:true}),null);
 assert.equal(q.samples.length,0);assert.equal(q.remainingWarmup,2);assert.equal(q.measurements.get('HIGH'),40);
 for(let i=0;i<4;i++)assert.equal(q.observe(16.7),null);
 const result=q.observe(16.7);assert.equal(result.complete,true);assert.equal(result.tier,'MED');
});

function controlsHarness({bootTier='HIGH',baseTier='MED'}={}) {
 const transition=new TerrainDetailTransition(),bootRequest=requestedBootAssets(bootTier,context);
 const sourceField={id:6412},fineOcean={N:oceanFineResolution(bootTier)};const calls={tiers:[],ratios:[]};
 const state={tier:baseTier,assetReloadRequired:false,sourceField,fineOcean};window.__RAPTOR=state;
 const live={baseTier,renderer:{setPixelRatio:v=>calls.ratios.push(v)},
  applyCloudQuality:tier=>{calls.tiers.push(tier);state.tier=tier;},
  applyTerrainQuality:tier=>transition.setEnabled(tierHasNearTerrain(tier)),
  applyAssetQuality:()=>{const s=settings.current();state.assetReloadRequired=assetsNeedReload(bootRequest,requestedBootAssets(s.tier==='AUTO'?deviceTier(context):s.tier,context));}};
 settings.bindLive(live);transition.advance(0);
 const buttons=['AUTO','LOW','MED','HIGH','ULTRA'].map(tier=>({dataset:{tier},addEventListener(type,fn){this[type]=fn;}}));
 const reset={addEventListener(type,fn){this[type]=fn;}};
 const menu={el:{querySelectorAll:q=>q==='.tierchip'?buttons:[],querySelector:q=>q==='#setReset'?reset:null},
  _render(){this.html=ControlsMenu.prototype._settingsHtml.call(this);}};
 ControlsMenu.prototype._wireSettings.call(menu);menu._render();
 return{transition,sourceField,fineOcean,state,calls,live,menu,click:tier=>buttons.find(b=>b.dataset.tier===tier).click(),reset:()=>reset.click()};
}

test('real controls handlers update runtime tiers, fade down, and report only required asset reloads',()=>{
 saveBench({backend:'webgpu',tier:'MED',profile:profile(assets())});const h=controlsHarness();
 assert.match(h.menu.html,/AUTO \(MED\)/);assert.doesNotMatch(h.menu.html,/full detail after reload/);
 h.click('HIGH');assert.equal(h.transition.target,1);assert.equal(h.state.assetReloadRequired,false);assert.doesNotMatch(h.menu.html,/full detail after reload/);
 h.transition.advance(.3);h.transition.advance(0);
 h.click('LOW');assert.equal(h.state.tier,'LOW');assert.equal(h.transition.target,0);assert.equal(hasManualTier(),true);assert.equal(h.state.assetReloadRequired,true);
 assert.match(h.menu.html,/full detail after reload/);h.transition.advance(.3);assert.equal(h.transition.useFine,true);h.transition.advance(0);assert.equal(h.transition.useFine,false);
 assert.equal(h.calls.ratios.at(-1),.75);
 h.click('ULTRA');assert.equal(h.transition.target,1);assert.equal(h.state.assetReloadRequired,true);assert.equal(h.calls.ratios.at(-1),1.25);
 assert.equal(h.state.sourceField,h.sourceField);assert.equal(h.state.fineOcean,h.fineOcean);assert.equal(h.state.fineOcean.N,256);
});

test('controls Auto/reset restores live base quality and never swaps boot assets',()=>{
 const h=controlsHarness();h.click('ULTRA');h.transition.advance(.3);h.click('AUTO');
 assert.equal(hasManualTier(),false);assert.equal(settings.current().tier,'AUTO');assert.equal(h.calls.tiers.at(-1),'MED');assert.equal(h.state.tier,'MED');assert.equal(h.transition.target,0);
 assert.equal(h.state.assetReloadRequired,false);assert.match(h.menu.html,/re-benchmarks after reload/);
 h.click('LOW');settings.saveSettings({renderScale:.6});h.reset();
 assert.equal(settings.current().renderScale,null);assert.equal(h.calls.ratios.at(-1),1);assert.equal(h.transition.target,0);
 assert.equal(h.state.sourceField,h.sourceField);assert.equal(h.state.fineOcean,h.fineOcean);
});

test('live Auto base-tier changes propagate through settings without restarting the static pack',()=>{
 const h=controlsHarness();const q=new QualityBenchmark({tier:'HIGH',backend:'webgpu',warmup:0,samples:2});
 q.observe(40);const change=q.observe(40);assert.equal(change.tier,'MED');
 h.live.baseTier=change.tier;h.state.tier=change.tier;settings.applySettings(settings.current(),h.live);
 assert.equal(h.transition.target,0);assert.equal(h.state.assetReloadRequired,false);assert.equal(h.state.fineOcean.N,256);
 h.live.baseTier='HIGH';settings.applySettings(settings.current(),h.live);assert.equal(h.transition.target,1);
 assert.equal(h.state.sourceField,h.sourceField);
});

test("actual source normal-only revisions invalidate the loaded asset profile",()=>{
 assert.notEqual(profile(assets("HIGH",{normalHash:"normal-v1"})),profile(assets("HIGH",{normalHash:"normal-v2"})));
});

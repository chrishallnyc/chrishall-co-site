import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { float } from 'three/tsl';
import { AircraftLighting } from '../src/aircraft/lighting.js';
import { bootAssetTier, deviceTier, detectTier, isCompatibleBench, saveBench, setTier, hasManualTier, tierParams } from '../src/engine/quality.js';
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
globalThis.window={devicePixelRatio:1,dispatchEvent(){}};
const context = {backend:'webgpu',front:'VALDEZ',flags:new URLSearchParams(),sourceEnabled:true};
function assets(bootTier='HIGH',{source=true,fine=512,drape=true,hash='source-v1',normalHash='normal-v1',cirrus=(bootTier==='HIGH'||bootTier==='ULTRA'?8192:2048),noise=tierParams(bootTier).cloudNoise,imagery=null,photo=null}={}) {
 const [baseN,detailN]={standard:[128,64],high:[192,96],ultra:[256,128]}[noise];
 return describeBootAssets({bootTier,terrain:{meta:{grid:4096},nearDetail:true,
  sourceField:source?{meta:{provenance:{sourceId:6412},sourceCrop:{row:1600,col:1600,size:3200},width:3200,height:3200,heightPackedSHA256:hash,normalPixelsSHA256:normalHash}}:null,
  drape:{albedo:drape?{image:{width:16384,height:16384}}:null},geographicImagery:imagery,photoDetail:photo},water:{},fftOcean:true,
  fineOcean:{N:fine,tileM:32},cloudNoise:{version:1,seed:1337,normalization:{lo:.25,hi:.875},resolution:noise,baseN,detailN},cloudMode:'native',sky:{cirrusAtlas:{image:{width:cirrus,height:cirrus/2},userData:{source:'test-cirrus-v4',requestedResolution:cirrus}}}});
}
const profile = (loaded,query='')=>qualityProfile({backend:'webgpu',front:'VALDEZ',mode:'native',pixelRatio:1,width:1440,height:900,
  workload:qualityWorkload(new URLSearchParams(query)),assets:loaded});
beforeEach(()=>{storage.clear();settings.bindLive(null);settings.loadSettings();navigator.hardwareConcurrency=12;navigator.deviceMemory=16;window.__RAPTOR=null;});

test('Auto reboots preserve desktop assets after selecting a lower render tier',()=>{
 const boot=bootAssetTier(context),request=requestedBootAssets(boot,context),loaded=assets(boot);
 assert.equal(boot,'HIGH');assert.deepEqual(request,{cirrus:8192,noise:'high',fineOcean:512,source:'16'});
 saveBench({ms:16.7,backend:'webgpu',tier:'MED',profile:profile(loaded)});
 assert.equal(detectTier({backend:'webgpu',profile:profile(loaded)}),'MED');
 assert.equal(bootAssetTier(context),'HIGH');
 assert.deepEqual(requestedBootAssets(bootAssetTier(context),context),request);
 assert.equal(detectTier({backend:'webgpu',profile:profile(assets(bootAssetTier(context)))}),'MED');
});

test('Auto upgrades on a heuristic MED device do not silently replace its asset pack',()=>{
 navigator.hardwareConcurrency=8;
 assert.equal(deviceTier(context),'MED');const boot=bootAssetTier(context);
 const loaded=assets(boot,{source:false,fine:128});saveBench({ms:16.7,backend:'webgpu',tier:'HIGH',profile:profile(loaded)});
 assert.equal(detectTier({backend:'webgpu',profile:profile(loaded)}),'HIGH');
 assert.deepEqual(requestedBootAssets(bootAssetTier(context),context),{cirrus:2048,noise:'standard',fineOcean:128,source:'0'});
});

test('manual asset selection and explicit source/ocean overrides win over cached render quality',()=>{
 saveBench({ms:16.7,backend:'webgpu',tier:'LOW',profile:profile(assets())});
 for(const [tier,fine,source,noise] of [['LOW',128,'0','standard'],['MED',128,'0','standard'],['HIGH',512,'16','high'],['ULTRA',512,'16','ultra']]){
  setTier(tier);assert.equal(bootAssetTier(context),tier);
  assert.deepEqual(requestedBootAssets(tier,context),{cirrus:tier==='HIGH'||tier==='ULTRA'?8192:2048,noise,fineOcean:fine,source});
 }
 for(const value of ['0','128','256','512'])assert.equal(oceanFineResolution('HIGH',value),Number(value));
 for(const value of ['0','16'])assert.equal(terrainSourcePreset('LOW',value,'VALDEZ'),value);
 assert.equal(terrainSourcePreset('ULTRA','16','NELLIS'),'0');
 assert.equal(terrainSourcePreset('LOW','8','VALDEZ'),'0');assert.equal(terrainSourcePreset('LOW','slice','VALDEZ'),'0');
 assert.equal(requestedBootAssets('ULTRA',{...context,backend:'webgl'}).fineOcean,0);
 assert.equal(requestedBootAssets('ULTRA',{...context,backend:'webgl'}).source,'0');
 assert.equal(requestedBootAssets('LOW',{...context,backend:'webgl',flags:new URLSearchParams('terrainsource=16')}).source,'16');
 storage.set('raptor:quality:v1','BROKEN');assert.equal(bootAssetTier(context),'HIGH');
 for(const noise of ['standard','high','ultra'])
  assert.equal(requestedBootAssets('LOW',{...context,flags:new URLSearchParams({cloudnoise:noise})}).noise,noise);
 assert.equal(requestedBootAssets('HIGH',{...context,flags:new URLSearchParams('cloudnoise=invalid')}).noise,'high');
});

test('actual source, fine-ocean and drape fallbacks cannot reuse successful asset timings',()=>{
 const full=profile(assets());saveBench({ms:16.7,backend:'webgpu',tier:'LOW',profile:full});
 for(const alternate of [assets('HIGH',{source:false}),assets('HIGH',{fine:0}),assets('HIGH',{drape:false}),assets('HIGH',{hash:'source-v2'}),assets('HIGH',{noise:'standard'})]){
  assert.notEqual(profile(alternate),full);assert.equal(detectTier({backend:'webgpu',profile:profile(alternate)}),'HIGH');
 }
 assert.equal(detectTier({backend:'webgpu',profile:full}),'LOW');
});

test('terrain cost overrides and policy version isolate saved workload identity',()=>{
 const full=profile(assets());
 for(const flag of ['terrainnear=0','drape=0','geographicdetail=0','terrainphoto=0','skycache=0','snowdetail=0','terrainmaterials=0','cloudshadow=old','terrainsource=0','terrainsource=8','terrainsource=16','terrainsource=slice'])assert.notEqual(profile(assets(),flag),full);
 assert.equal(profile(assets(),'drape=0&terrainnear=0'),profile(assets(),'terrainnear=0&drape=0'));
 assert.equal(profile(assets(),'yaw=100&tod=4'),full);
 assert.notEqual(profile({...assets(),version:'future-policy'}),full);
 for(const change of [{version:2},{seed:42},{normalization:[.2,.85]}])
  assert.notEqual(profile({...assets(),clouds:{...assets().clouds,...change}}),full);
});

test('imagery and scanned materials profile stable loaded identities and coherent fallbacks',()=>{
 const manifest={schema:1,front:'NELLIS',imagePixels:2064,metresPerPixel:1,rows:6,columns:6,
  tileSizeM:2048,gutterPixels:8,worldBounds:{xmin:-6144,xmax:6144,zmin:-10240,zmax:2048},
  tiles:[{id:'r0c0',sha256:'a'.repeat(64)},{id:'r0c1',sha256:null}]};
 const imagery={supported:true,manifest,stats:{downloadedBytes:100},profile:{residents:['r0c0']}};
 const detail={version:'scanned-v2-uniform-scale',requested:true,eligible:true,status:'ready',
  hashes:{rock:'b'.repeat(64),snow:'c'.repeat(64)},load:{elapsedMs:20},packed:{bytes:100}};
 const photo={diagnostics:()=>detail};
 const loaded=assets('HIGH',{imagery,photo}),full=profile(loaded);
 assert.deepEqual(loaded.terrain.photo,{version:detail.version,requested:true,eligible:true,status:'ready',hashes:detail.hashes});
 assert.equal(loaded.terrain.imagery.tiles[0][1],manifest.tiles[0].sha256);
 imagery.stats.downloadedBytes=10000;imagery.profile.residents=['r0c1'];
 detail.load.elapsedMs=999;detail.packed.bytes=100000;
 assert.equal(profile(assets('HIGH',{imagery,photo})),full);
 for(const alternate of [
  assets('HIGH',{photo}),assets('HIGH',{imagery}),
  assets('HIGH',{imagery:{...imagery,supported:false},photo}),
  assets('HIGH',{imagery:{...imagery,manifest:{...manifest,tiles:[{...manifest.tiles[0],sha256:'d'.repeat(64)}]}},photo}),
  assets('HIGH',{imagery,photo:{diagnostics:()=>({...detail,status:'fallback',hashes:null})}}),
  assets('HIGH',{imagery,photo:{diagnostics:()=>({...detail,version:'next-scanned-policy'})}}),
  assets('HIGH',{imagery,photo:{diagnostics:()=>({...detail,hashes:{...detail.hashes,snow:'e'.repeat(64)}})}}),
 ]) assert.notEqual(profile(alternate),full);
 // The description is a snapshot; subsequent source-object mutation cannot
 // retroactively change the identity whose timings were recorded.
 manifest.tiles[0].sha256='f'.repeat(64);detail.hashes.rock='0'.repeat(64);
 assert.equal(profile(loaded),full);
});

test('cache selection and benchmark-start gate agree on malformed or incompatible records',()=>{
 const key=profile(assets()),options={backend:'webgpu',profile:key};
 for(const bad of [null,{}, {ms:16.7,tier:'BROKEN',backend:'webgpu',profile:key},
  {ms:16.7,tier:'LOW',backend:'webgl',profile:key},{ms:16.7,tier:'LOW',backend:'webgpu',profile:'other-assets'},
  ...[undefined,0,-1,NaN,Infinity].map(ms=>({ms,tier:'LOW',backend:'webgpu',profile:key}))]){
  assert.equal(isCompatibleBench(bad,options),false);saveBench(bad);assert.equal(detectTier(options),'HIGH');
 }
 const valid={ms:16.7,tier:'MED',backend:'webgpu',profile:key};assert.equal(isCompatibleBench(valid,options),true);
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

function controlsHarness({bootTier='HIGH',baseTier='MED',shadows=true}={}) {
 const transition=new TerrainDetailTransition(),bootRequest=requestedBootAssets(bootTier,context),autoTier=deviceTier(context);
 const sun=new THREE.DirectionalLight(),lighting=new AircraftLighting({renderer:{shadowMap:{}},
  atmosphere:{sun,scene:{}},params:tierParams(bootTier),shadows});
 lighting.setSunVisibility(float(1));
 const sourceField={id:6412},fineOcean={N:oceanFineResolution(bootTier)};const calls={tiers:[],ratios:[],closed:0};
 const state={ready:true,tier:baseTier,assetReloadRequired:false,sourceField,fineOcean};window.__RAPTOR=state;
 let ratio=1;
 const live={baseTier,renderer:{getPixelRatio:()=>ratio,setPixelRatio:v=>{ratio=v;calls.ratios.push(v);}},
  applyCloudQuality:tier=>{calls.tiers.push(tier);state.tier=tier;lighting.setQuality(tierParams(tier));},
  applyTerrainQuality:tier=>transition.setEnabled(tierHasNearTerrain(tier)),
  applyAssetQuality:()=>{
   const selected=settings.current().tier,desiredTier=selected==='AUTO'?autoTier:selected,shadowParams=tierParams(desiredTier);
   state.assetReloadRequired=assetsNeedReload(bootRequest,requestedBootAssets(desiredTier,context),{
    allocatedShadowSize:lighting.stats.allocatedShadowSize,
    requestedShadowSize:lighting.shadowRequested&&shadowParams.shadows?shadowParams.shadowSize:0,
   });
  }};
 settings.bindLive(live);transition.advance(0);
 const button=dataset=>({dataset,addEventListener(type,fn){this[type]=fn;}});
 const buttons=['AUTO','LOW','MED','HIGH','ULTRA'].map(quality=>button({quality}));
 const reset=button({action:'reset-settings'}),confirm=button({confirm:'reset'}),review=button({});
 const menu=Object.assign(Object.create(ControlsMenu.prototype),{tab:'display',input:{setOptions(){}},
  el:{querySelectorAll:q=>q==='[data-quality]'?buttons:q==='[data-action]'?[reset]:q==='[data-confirm]'?[confirm]:[],querySelector:q=>q==='[data-review-restart]'&&menu.html?.includes('data-review-restart')?review:null},
  close(){calls.closed++;},_render(){this.html=this._settingsHtml();this._wire();}});
 menu._render();
 return{transition,sourceField,fineOcean,state,calls,live,menu,lighting,sun,click:tier=>buttons.find(b=>b.dataset.quality===tier).click(),
  review:()=>review.click(),reset:()=>{reset.click();assert.equal(menu.confirming,'settings');confirm.click();}};
}

test('real controls handlers update runtime tiers, fade down, and report only required asset reloads',()=>{
 saveBench({ms:16.7,backend:'webgpu',tier:'MED',profile:profile(assets())});const h=controlsHarness();
 assert.match(h.menu.html,/MED is running/);assert.doesNotMatch(h.menu.html,/data-review-restart/);
 h.click('HIGH');assert.equal(h.transition.target,1);assert.equal(h.state.assetReloadRequired,false);assert.doesNotMatch(h.menu.html,/data-review-restart/);
 h.transition.advance(.3);h.transition.advance(0);
 h.click('LOW');assert.equal(h.state.tier,'LOW');assert.equal(h.transition.target,0);assert.equal(hasManualTier(),true);assert.equal(h.state.assetReloadRequired,true);
 assert.match(h.menu.html,/data-review-restart/);assert.match(h.menu.html,/unfinished flight will start over/);h.review();assert.equal(h.calls.closed,1);h.transition.advance(.3);assert.equal(h.transition.useFine,true);h.transition.advance(0);assert.equal(h.transition.useFine,false);
 assert.equal(h.calls.ratios.at(-1),.75);
 h.click('ULTRA');assert.equal(h.transition.target,1);assert.equal(h.state.assetReloadRequired,true);assert.equal(h.calls.ratios.at(-1),1.25);
 assert.equal(h.state.sourceField,h.sourceField);assert.equal(h.state.fineOcean,h.fineOcean);assert.equal(h.state.fineOcean.N,512);
});

test('controls Auto/reset restores live base quality and never swaps boot assets',()=>{
 const h=controlsHarness();h.click('ULTRA');h.transition.advance(.3);h.click('AUTO');
 assert.equal(hasManualTier(),false);assert.equal(settings.current().tier,'AUTO');assert.equal(h.calls.tiers.at(-1),'MED');assert.equal(h.state.tier,'MED');assert.equal(h.transition.target,0);
 assert.equal(h.state.assetReloadRequired,false);assert.match(h.menu.html,/MED is running/);assert.doesNotMatch(h.menu.html,/data-review-restart/);
 h.click('LOW');settings.saveSettings({renderScale:.6});h.reset();
 assert.equal(settings.current().renderScale,null);assert.equal(h.calls.ratios.at(-1),1);assert.equal(h.transition.target,0);
 assert.equal(h.state.sourceField,h.sourceField);assert.equal(h.state.fineOcean,h.fineOcean);
});

test('live Auto base-tier changes propagate through settings without restarting the static pack',()=>{
 const h=controlsHarness();const q=new QualityBenchmark({tier:'HIGH',backend:'webgpu',warmup:0,samples:2});
 q.observe(40);const change=q.observe(40);assert.equal(change.tier,'MED');
 h.live.baseTier=change.tier;h.state.tier=change.tier;settings.applySettings(settings.current(),h.live);
 assert.equal(h.transition.target,0);assert.equal(h.state.assetReloadRequired,false);assert.equal(h.state.fineOcean.N,512);
 h.live.baseTier='HIGH';settings.applySettings(settings.current(),h.live);assert.equal(h.transition.target,1);
 assert.equal(h.state.sourceField,h.sourceField);
});

test("actual source normal-only revisions invalidate the loaded asset profile",()=>{
 assert.notEqual(profile(assets("HIGH",{normalHash:"normal-v1"})),profile(assets("HIGH",{normalHash:"normal-v2"})));
});

test('cirrus boot selection honors the GPU texture limit and records actual fallback identity',()=>{
 for(const tier of ['LOW','MED'])assert.equal(requestedBootAssets(tier,context).cirrus,2048);
 for(const tier of ['HIGH','ULTRA']){
  assert.equal(requestedBootAssets(tier,context).cirrus,8192);
  assert.equal(requestedBootAssets(tier,{...context,textureLimit:4096}).cirrus,2048);
 }
 const full=assets(),fallback=assets('HIGH',{cirrus:2048});
 assert.notEqual(profile(full),profile(fallback));
 assert.notEqual(profile(full),profile({...full,sky:{cirrus:{...full.sky.cirrus,source:'neutral-fallback'}}}));
 const high=requestedBootAssets('HIGH',context),limited=requestedBootAssets('HIGH',{...context,textureLimit:4096});
 assert.equal(assetsNeedReload(high,limited),true);assert.equal(assetsNeedReload(high,{...high}),false);
});

test('same live tier still offers explicit restart when loaded assets differ',()=>{
 const h=controlsHarness({bootTier:'LOW',baseTier:'HIGH'});h.click('HIGH');
 assert.equal(h.state.tier,'HIGH');assert.equal(settings.current().tier,'HIGH');assert.equal(h.state.assetReloadRequired,true);
 assert.match(h.menu.html,/Full graphics detail needs a new flight/);assert.match(h.menu.html,/data-review-restart/);
 h.review();assert.equal(h.calls.closed,1);assert.equal(h.state.fineOcean.N,128);
});

test('LOW to MED reports the retained shadow resolution even with identical texture assets',()=>{
 settings.saveSettings({tier:'LOW'});
 const h=controlsHarness({bootTier:'LOW',baseTier:'LOW'}),map=new THREE.RenderTarget(512,512);
 h.sun.shadow.map=map;
 const size=h.sun.shadow.mapSize;
 try {
  assert.deepEqual(requestedBootAssets('LOW',context),requestedBootAssets('MED',context));
  assert.equal(h.lighting.stats.allocatedShadowSize,512);
  assert.equal(h.state.assetReloadRequired,false);
  h.click('MED');
  assert.equal(h.state.tier,'MED');assert.equal(h.lighting.stats.requestedShadowSize,1024);
  assert.equal(h.state.assetReloadRequired,true);
  assert.match(h.menu.html,/Full graphics detail needs a new flight/);
  assert.match(h.menu.html,/data-review-restart/);
  assert.equal(h.sun.shadow.map,map);assert.equal(h.sun.shadow.mapSize,size);
  assert.deepEqual(size.toArray(),[512,512]);assert.equal(h.lighting.stats.allocatedShadowSize,512);
  h.click('LOW');
  assert.equal(h.state.assetReloadRequired,false);assert.equal(h.lighting.shadows,false);
  assert.doesNotMatch(h.menu.html,/data-review-restart/);
  assert.equal(h.sun.shadow.map,map);assert.deepEqual(size.toArray(),[512,512]);
 } finally { map.dispose();h.lighting.dispose(); }
});

test('returning to a MED boot tier reuses its matching shadow allocation without a restart notice',()=>{
 settings.saveSettings({tier:'MED'});
 const h=controlsHarness({bootTier:'MED',baseTier:'MED'});
 h.click('LOW');assert.equal(h.state.assetReloadRequired,false);
 h.click('MED');
 assert.equal(h.lighting.stats.allocatedShadowSize,1024);assert.equal(h.lighting.stats.requestedShadowSize,1024);
 assert.equal(h.state.assetReloadRequired,false);assert.doesNotMatch(h.menu.html,/data-review-restart/);
 assert.deepEqual(h.sun.shadow.mapSize.toArray(),[1024,1024]);h.lighting.dispose();
});

test('explicitly disabled aircraft shadows do not request a resolution restart',()=>{
 settings.saveSettings({tier:'LOW'});
 const h=controlsHarness({bootTier:'LOW',baseTier:'LOW',shadows:false});h.click('MED');
 assert.equal(h.lighting.stats.allocatedShadowSize,512);assert.equal(h.lighting.stats.requestedShadowSize,0);
 assert.equal(h.lighting.shadows,false);assert.equal(h.state.assetReloadRequired,false);
 assert.doesNotMatch(h.menu.html,/data-review-restart/);h.lighting.dispose();
});

test('LOW to Auto reports the next MED boot allocation even when its live tier remains LOW',()=>{
 navigator.hardwareConcurrency=8;settings.saveSettings({tier:'LOW'});
 const h=controlsHarness({bootTier:'LOW',baseTier:'LOW'});h.click('AUTO');
 assert.equal(deviceTier(context),'MED');assert.equal(h.state.tier,'LOW');
 assert.equal(h.lighting.stats.requestedShadowSize,0);assert.equal(h.lighting.stats.allocatedShadowSize,512);
 assert.equal(h.state.assetReloadRequired,true);assert.match(h.menu.html,/data-review-restart/);
 assert.deepEqual(h.sun.shadow.mapSize.toArray(),[512,512]);h.lighting.dispose();
});

test('Auto benchmark downgrades do not request a restart of an already matching boot allocation',()=>{
 navigator.hardwareConcurrency=8;
 const h=controlsHarness({bootTier:'MED',baseTier:'LOW'});
 assert.equal(settings.current().tier,'AUTO');assert.equal(h.state.tier,'LOW');
 assert.equal(h.lighting.stats.allocatedShadowSize,1024);assert.equal(h.lighting.stats.requestedShadowSize,0);
 assert.equal(h.state.assetReloadRequired,false);assert.doesNotMatch(h.menu.html,/data-review-restart/);
 h.live.baseTier='MED';settings.applySettings(settings.current(),h.live);
 assert.equal(h.state.assetReloadRequired,false);assert.equal(h.lighting.stats.requestedShadowSize,1024);
 h.lighting.dispose();
});

test('blocked storage never promises that restart will preserve new graphics settings',()=>{
 const original=globalThis.localStorage;
 try{
  const h=controlsHarness({bootTier:'LOW',baseTier:'HIGH'});
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  h.click('HIGH');assert.equal(settings.storageAvailable(),false);assert.equal(h.state.assetReloadRequired,true);
  assert.match(h.menu.html,/Browser storage is unavailable/);assert.doesNotMatch(h.menu.html,/data-review-restart/);
  assert.match(h.menu.notice,/could not be saved/);
 }finally{globalThis.localStorage=original;settings.loadSettings();}
});

const {Cockpit}=await import('../src/game/cockpit.js');
function pauseHarness({tier='HIGH',next='HIGH',assetReloadRequired=false}={}){
 settings.bindLive(null);settings.saveSettings({tier:next});
 const buttons=new Map(),body={innerHTML:'',querySelectorAll:()=>[],querySelector(key){if(!buttons.has(key))buttons.set(key,{addEventListener(){},focus(){},append(){}});return buttons.get(key);}};
 const h=Object.assign(Object.create(Cockpit.prototype),{paused:true,reason:'manual',state:{tier,assetReloadRequired},controls:{open:false},guide:{open:false},log:{open:false},input:{},flags:new URLSearchParams(),pauseDialog:{body,el:{querySelector:()=>({}),setAttribute(){}},show(){}},confirmLeave(action,title){this.confirmation={action,title};}});
 const priorDocument=globalThis.document;
 globalThis.document={...priorDocument,createElement:()=>({querySelector:()=>({}),querySelectorAll:()=>[]})};
 try{h.showPause();}finally{globalThis.document=priorDocument;}
 return{h,body,buttons};
}

test('actual pause panel explains same-tier asset reloads and keeps restart behind confirmation',()=>{
 const {h,body,buttons}=pauseHarness({assetReloadRequired:true});
 assert.match(body.innerHTML,/needs a restart to load its full detail/);assert.match(body.innerHTML,/Restart with new graphics/);
 assert.doesNotMatch(body.innerHTML,/HIGH running · HIGH on restart/);assert.equal(h.confirmation,undefined);
 buttons.get('[data-restart]').onclick();assert.equal(h.confirmation.title,'Restart this flight?');assert.equal(typeof h.confirmation.action,'function');
 const ordinary=pauseHarness();assert.doesNotMatch(ordinary.body.innerHTML,/pause-graphics-note/);assert.match(ordinary.body.innerHTML,/Restart this flight/);
 const changed=pauseHarness({tier:'MED',next:'HIGH'});assert.match(changed.body.innerHTML,/MED running · HIGH on restart/);
});

test('actual pause panel reports unsaved graphics without promising a persisted preset',()=>{
 const original=globalThis.localStorage;
 try{
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const {body}=pauseHarness({assetReloadRequired:true});assert.match(body.innerHTML,/restarting may restore your previous settings/);
  assert.doesNotMatch(body.innerHTML,/Restart with new graphics/);assert.match(body.innerHTML,/Restart this flight/);
 }finally{globalThis.localStorage=original;settings.loadSettings();}
});

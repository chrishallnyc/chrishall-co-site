// Fast browser checks: preflight assets and failed mission recovery never need
// an active GPU flight. The adapter is deliberately held before allocation.
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const out=(process.env.RAPTOR_TEST_OUTPUT||new URL('../../.context/raptor-five/pass4/',import.meta.url).pathname).replace(/\/?$/,'/');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1'});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const staged=process.env.RAPTOR_STAGE_ROOT;
if(staged)await context.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(!['/index.html','/','/src/main.js','/src/game/flightdeck.js','/src/game/flightload.js','/assets/preflight/nellis.webp','/assets/preflight/valdez.webp','/assets/preflight/marianas.webp'].includes(path))return route.continue();
  const file=staged+(path==='/'?'/index.html':path);
  const body=await readFile(file);
  await route.fulfill({status:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.webp')?'image/webp':'text/html',body});
});
const results=[],errors=[],metrics={};
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const shot=name=>page.screenshot({path:out+name+'.png'});
try {
  const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto(origin,{waitUntil:'networkidle'});
  await check('preflight loads three small region previews without downloading flight terrain imagery',async()=>{
    await page.waitForSelector('.region-card');
    for(const front of ['nellis','valdez','marianas'])assert.ok(requests.includes(`/assets/preflight/${front}.webp`));
    assert.equal(requests.some(path=>path.includes('_albedo_4k.jpg')),false);
    const previews=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/preflight/')).map(r=>({name:r.name.split('/').pop(),encodedBodySize:r.encodedBodySize,transferSize:r.transferSize})));
    assert.equal(previews.length,3);assert.ok(previews.every(r=>r.encodedBodySize>0));
    const totalBytes=previews.reduce((total,r)=>total+r.encodedBodySize,0);assert.ok(totalBytes<200000);
    metrics.previews=previews;metrics.totalPreviewBytes=totalBytes;
    await shot('01-lightweight-preflight');
  });
  await page.addInitScript(()=>{
    window.__adapterRequests=0;
    Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:()=>{window.__adapterRequests++;return new Promise(()=>{});}}});
  });
  await page.route('**/src/campaign/sorties/nellis-01.js',route=>route.abort('failed'));
  await page.goto(origin+'?front=NELLIS&sortie=N01',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__RAPTOR?.failure);
  await check('a failed requested mission stops before graphics or a substitute battle starts',async()=>{
    const state=await page.evaluate(()=>({ready:__RAPTOR.ready,stage:__RAPTOR.bootStage,match:!!__RAPTOR.match,sim:!!__RAPTOR.sim,adapters:__adapterRequests}));
    assert.deepEqual(state,{ready:false,stage:'mission',match:false,sim:false,adapters:0});
    assert.match(await page.locator('#veil .status').textContent(),/MISSION COULDN’T LOAD/);
    assert.match(await page.locator('.boot-status-detail').textContent(),/selected mission/);
    assert.equal(await page.getByRole('button',{name:'Retry mission'}).evaluate(el=>el===document.activeElement),true);
    assert.equal(new URL(page.url()).searchParams.get('sortie'),'N01');
    assert.equal(await page.locator('[data-boot-step="mission"]').getAttribute('data-state'),'failed');
    await shot('02-mission-recovery');
  });
  await check('Retry keeps the selected mission and continues real loading stages when its file returns',async()=>{
    await page.unroute('**/src/campaign/sorties/nellis-01.js');
    await page.getByRole('button',{name:'Retry mission'}).click();
    await page.waitForFunction(()=>window.__RAPTOR?.bootStage==='graphics-device');
    assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);assert.equal(await page.evaluate(()=>__adapterRequests),1);
    assert.equal(new URL(page.url()).searchParams.get('sortie'),'N01');
    assert.equal(await page.locator('[data-boot-step="mission"]').getAttribute('data-state'),'complete');
    assert.equal(await page.locator('[data-boot-step="graphics-device"]').getAttribute('aria-current'),'step');
    assert.equal(await page.locator('.boot-announcement').getAttribute('role'),'status');
    await shot('03-real-preparation-stages');
  });
  await check('loading and recovery controls fit a narrow display and stay keyboard accessible',async()=>{
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const back=page.getByRole('link',{name:'Back to preflight'});const rect=await back.boundingBox();
    assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=844);
    await back.focus();assert.equal(await back.evaluate(el=>el===document.activeElement),true);await shot('04-narrow-loader');
  });
  await check('a missing game module has public recovery copy and a working return to preflight',async()=>{
    await page.route('**/src/main.js',route=>route.abort('failed'));
    await page.goto(origin,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Reload game'}).waitFor();
    assert.match(await page.locator('.boot-status-detail').textContent(),/connection/);
    assert.doesNotMatch(await page.locator('.boot-status-detail').textContent(),/local server/i);
    assert.equal(await page.getByRole('button',{name:'Reload game'}).evaluate(el=>el===document.activeElement),true);
    await shot('05-game-file-recovery');
    await page.unroute('**/src/main.js');await page.getByRole('link',{name:'Back to preflight'}).click();
    await page.waitForSelector('#flyBtn');assert.equal(new URL(page.url()).search,'');
  });
  assert.deepEqual(errors,[]);
} catch(error) {await shot('failure').catch(()=>{});throw error;}
finally {await writeFile(out+'results.json',JSON.stringify({passed:results.length,results,errors,metrics},null,2));await context.close();await browser.close();}

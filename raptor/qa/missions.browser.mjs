// Recorded regional/mission smoke checks. Result transitions are deliberately
// injected after actual flying; these do not claim to beat a campaign mission.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=(process.env.RAPTOR_TEST_OUTPUT||new URL('../../.context/raptor-playability/missions/',import.meta.url).pathname).replace(/\/?$/,'/');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1',args:['--window-size=1440,1000']});
const context=await browser.newContext({viewport:{width:1440,height:940},recordVideo:{dir:out,size:{width:1440,height:940}}});
await context.addInitScript(()=>{
  if(!localStorage.getItem('raptor.qa.initialized')){
    localStorage.setItem('raptor:quality:v1','LOW');
    localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'LOW',showFps:true,masterVol:.2,showHints:true}));
    localStorage.setItem('raptor.practice.introduced','true');
    localStorage.setItem('raptor.qa.initialized','true');
  }
});
const page=await context.newPage(),errors=[],results=[],metrics=[];
page.setDefaultTimeout(20000);
page.on('pageerror',e=>errors.push(e.message));
const snap=name=>page.screenshot({path:out+name+'.png'});
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const boot=async()=>{
  await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
  await page.waitForSelector('#veil',{state:'detached'});
  if(await page.evaluate(()=>__RAPTOR.paused))await page.locator('[data-resume]').click();
  await page.waitForFunction(()=>__RAPTOR.sim.time>1&&!__RAPTOR.paused);
};
const fly=async()=>{
  await page.keyboard.down('w');await page.waitForTimeout(750);await page.keyboard.up('w');
  await page.keyboard.down('a');await page.waitForTimeout(350);await page.keyboard.up('a');
  await page.keyboard.down('d');await page.waitForTimeout(350);await page.keyboard.up('d');
  await page.keyboard.press('r');
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(180);await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(900);
};
try{
  await page.goto(origin,{waitUntil:'networkidle'});
  await check('campaign starts from its named preflight briefing',async()=>{
    await page.locator('[data-mode="campaign"]').click();
    await page.waitForFunction(()=>!document.getElementById('flyBtn').disabled);
    assert.ok((await page.locator('#brief-title').textContent()).length>3);
    await snap('01-campaign-preflight');await page.locator('#flyBtn').click();await boot();
    assert.equal(new URL(page.url()).searchParams.get('sortie'),'N01');
    assert.ok(await page.evaluate(()=>!!__RAPTOR.match&&!!__RAPTOR.script));await fly();await snap('02-nellis-campaign');
  });
  await check('cannon responds to actual input during a campaign flight',async()=>{
    const before=await page.evaluate(()=>__RAPTOR.player.gun.ammo);
    await page.keyboard.down('1');await page.waitForTimeout(450);await page.keyboard.up('1');
    assert.ok(await page.evaluate(()=>__RAPTOR.player.gun.ammo)<before);
  });
  await check('completed campaign result saves and offers the next mission',async()=>{
    await page.evaluate(()=>{__RAPTOR.match.over=1;});
    await page.waitForSelector('.pause-dialog[open]');
    assert.match(await page.locator('.pause-dialog h2').textContent(),/Mission complete/);
    assert.equal(await page.evaluate(()=>__RAPTOR.progressSaved),true);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.auth.v1')).done.N01),1);
    await snap('03-campaign-debrief');await page.locator('[data-next]').click();await boot();
    assert.equal(new URL(page.url()).searchParams.get('sortie'),'N02');
  });
  await check('completed missions remain replayable with the next mission unlocked',async()=>{
    await page.locator('[data-flight-action="progress"]').click();
    await page.waitForSelector('[data-mission="N01"]');await page.locator('[data-mission="N01"]').click();
    assert.match(await page.locator('[data-launch-mission]').textContent(),/Replay/);
    assert.equal(await page.locator('[data-launch-mission]').isDisabled(),false);
    await page.locator('[data-mission="N02"]').click();assert.equal(await page.locator('[data-launch-mission]').isDisabled(),false);
    await snap('04-unlocked-progress');
  });
  await check('Valdez operation flies and saves a completed result in its own region',async()=>{
    await page.goto(origin+'?front=VALDEZ&op=1');await boot();await fly();await snap('05-valdez-operation');
    await page.evaluate(()=>{__RAPTOR.match.over=-1;});await page.waitForSelector('.pause-dialog[open]');
    assert.equal(await page.evaluate(()=>__RAPTOR.progressSaved),true);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.op.v1:VALDEZ')).sortieIndex),1);
    assert.equal(await page.evaluate(()=>localStorage.getItem('raptor.op.v1:MARIANAS')),null);
    await snap('06-operation-debrief');
  });
  await check('Marianas preserves high-quality graphics and adapts exposure asynchronously',async()=>{
    await page.evaluate(async()=>{const s=await import('/src/game/settings.js');s.saveSettings({tier:'HIGH',hudScale:1,showHints:false});});
    await page.goto(origin+'?front=MARIANAS&mode=practice&nobattle=1&nomatch=1&tod=12');await boot();
    assert.equal(await page.evaluate(()=>__RAPTOR.tier),'HIGH');
    assert.equal(await page.evaluate(()=>__RAPTOR.post),true);
    assert.equal(await page.evaluate(()=>__RAPTOR.volClouds),true);
    assert.equal(await page.evaluate(()=>__RAPTOR.autoExposure),true);
    await page.waitForFunction(()=>__RAPTOR.meter.samples>=3);
    await fly();await page.waitForTimeout(3000);await snap('07-marianas-high');
    const sample=await page.evaluate(async()=>{
      const frames=[];let last=performance.now();
      await new Promise(resolve=>{const start=last;function frame(now){if(!__RAPTOR.paused)frames.push(now-last);last=now;if(now-start>8000)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});
      const f=frames.filter(n=>n>0).sort((a,b)=>a-b);
      return {front:'MARIANAS',backend:__RAPTOR.backend,tier:__RAPTOR.tier,post:__RAPTOR.post,volClouds:__RAPTOR.volClouds,fftOcean:__RAPTOR.fftOcean,paused:__RAPTOR.paused,samples:f.length,medianMs:f[Math.floor(f.length*.5)],p95Ms:f[Math.floor(f.length*.95)],over50ms:f.filter(n=>n>50).length,meterSamples:__RAPTOR.meter.samples,exposureMultiplier:__RAPTOR.meter.mult,recording:true};
    });metrics.push(sample);console.log('METRICS '+JSON.stringify(sample));assert.ok(sample.samples>100);assert.equal(sample.paused,false);
    await page.keyboard.press('Escape');const t=await page.evaluate(()=>__RAPTOR.sim.time);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);
    await snap('08-high-paused');
  });
  await check('WebGL fallback can load and fly a practice session',async()=>{
    await page.evaluate(async()=>{const s=await import('/src/game/settings.js');s.saveSettings({tier:'LOW'});});
    await page.goto(origin+'?front=NELLIS&mode=practice&nobattle=1&nomatch=1&gl=1');await boot();
    assert.equal(await page.evaluate(()=>__RAPTOR.backend),'webgl');
    await fly();await snap('09-webgl-flight');
  });
  assert.deepEqual(errors,[]);
}catch(error){console.error(error);await snap('failure').catch(()=>{});throw error;}
finally{
  await writeFile(out+'results.json',JSON.stringify({passed:results.length,results,errors,metrics,note:'Campaign/operation results were injected to test saving/debrief, after real keyboard flight.'},null,2));
  const video=page.video();await context.close();await video.saveAs(out+'missions-playthrough.webm');await browser.close();console.log('RECORDING '+out+'missions-playthrough.webm');
}

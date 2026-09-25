// NYC integration: actual renderer/terrain/city, flight input, collision,
// standalone briefing and persistence. Result injection is limited to debrief
// UI checks; the native mission test flies both real interceptions separately.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.RAPTOR_BASE_URL||'http://127.0.0.1:8192/';
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/nyc/browser/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1'});
const context=await browser.newContext({viewport:{width:1440,height:940}});
await context.addInitScript(()=>{
 if(!localStorage.getItem('raptor.nyc.qa')){
  localStorage.setItem('raptor.nyc.qa','1');localStorage.setItem('raptor:quality:v1','HIGH');
  localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'HIGH',renderScale:.65,muted:true,showHints:false}));
  localStorage.setItem('raptor.practice.introduced','true');
 }
});
const page=await context.newPage(),errors=[],badResponses=[],passed=[];page.setDefaultTimeout(25000);
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push([r.status(),r.url()]);});
const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS '+name);};
const snap=name=>page.screenshot({path:out+name+'.png',fullPage:true});
const boot=async()=>{
 await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});
 assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);await page.waitForSelector('#veil',{state:'detached'});
};
let cityStats;
try{
 await page.goto(base);
 await check('New York is an explicit region with peaceful default and a separate story briefing',async()=>{
  await page.locator('#flight-customize summary').click();await page.locator('[data-front="NEWYORK"]').click();
  assert.equal(await page.locator('[data-front]').count(),4);
  assert.equal(await page.locator('[data-mode="battle"]').isDisabled(),true);
  assert.equal(await page.locator('[data-mode="operation"]').isDisabled(),true);
  assert.equal(await page.locator('[data-mode="campaign"]').isEnabled(),true);
  await page.locator('[data-customize-done]').click();assert.match(await page.locator('#launch-label').textContent(),/Practice flight · New York/);
  await page.locator('[data-scenario-brief]').click();await page.waitForSelector('[data-scenario-launch]');
  assert.match(await page.locator('.scenario-dialog').textContent(),/Alternate history/);
  assert.match(await page.locator('.scenario-dialog').textContent(),/September 11, 2001/);await snap('01-mission-briefing');
  await page.locator('[data-scenario-cancel]').click();await snap('02-newyork-preflight');
 });
 await check('NYC preflight and story briefing fit a narrow phone viewport',async()=>{
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-scenario-brief]').click();await page.waitForSelector('[data-scenario-launch]');
  assert.ok(await page.locator('[data-scenario-launch]').isVisible());await snap('03-mobile-briefing');
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:940});
 });
 await check('High WebGPU loads real geography, modern skyline and sheltered harbor',async()=>{
  await page.locator('#flyBtn').click();await boot();
  assert.equal(await page.evaluate(()=>__RAPTOR.backend),'webgpu');
  const info=await page.evaluate(()=>({front:__RAPTOR.atmosphere.frontName,era:__RAPTOR.city.era,stats:__RAPTOR.city.stats,water:!!__RAPTOR.water,photo:!!__RAPTOR.terrain.drape.albedo,oneWorld:__RAPTOR.city.landmarks.some(l=>l.id==='one-world')}));
  assert.equal(info.front,'NEWYORK');assert.equal(info.era,'modern');assert.equal(info.water,true);assert.equal(info.photo,true);assert.equal(info.oneWorld,true);assert.ok(info.stats.buildings>50000);cityStats=info.stats;
  if(await page.evaluate(()=>__RAPTOR.paused))await page.locator('[data-resume]').click();
  await page.waitForTimeout(1800);await snap('04-harbor-flight');
 });
 await check('loaded terrain places landmarks on land and both rivers below the water surface',async()=>{
  const heights=await page.evaluate(()=>{
   const locations=[[40.74844,-73.98566],[40.7033,-74.017],[40.6892,-74.0445],[40.738,-74.024],[40.728,-73.966]];
   return locations.map(([lat,lon])=>__RAPTOR.terrain.heightAt((lon+74)*84395.51430552264,(lat-40.7)*111132));
  });
  heights.slice(0,3).forEach(h=>assert.ok(h>0&&h<100));heights.slice(3).forEach(h=>assert.ok(h<-10));
 });
 await check('actual flight input rolls the aircraft and pause freezes the world',async()=>{
  await page.keyboard.down('d');await page.waitForTimeout(350);await page.keyboard.up('d');
  assert.ok(await page.evaluate(()=>Math.abs(__RAPTOR.player.hudState().roll))>5);
  await page.keyboard.press('Escape');const t=await page.evaluate(()=>__RAPTOR.sim.time);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);
  await page.locator('[data-resume]').click();
 });
 await check('New York golden hour and Midtown preserve working city materials',async()=>{
  await page.evaluate(()=>{__RAPTOR.player.debugCommand({pos:{x:-4100,y:3500,alt:700,headingDeg:24,speed:180}});__RAPTOR.setTimeOfDay(18.4);});
  await page.waitForTimeout(1800);await snap('05-midtown-golden');
  assert.equal(await page.evaluate(()=>__RAPTOR.player.crashes),0);
 });
 await check('a building strike uses physical collision and normal recovery',async()=>{
  const before=await page.evaluate(()=>__RAPTOR.player.crashes);
  await page.evaluate(()=>{const p=__RAPTOR.city.landmarks.find(l=>l.id==='empire-state');__RAPTOR.player.debugCommand({pos:{x:p.x,y:p.z,alt:p.base+100,headingDeg:90,speed:200}});});
  await page.waitForFunction(n=>__RAPTOR.player.crashes>n,before);assert.equal(await page.evaluate(()=>__RAPTOR.player.hp),100);
 });
 await check('Harbor Watch direct links pause for the briefing and use the aftermath city',async()=>{
  await page.goto(base+'?front=NEWYORK&sortie=Y01');await boot();
  assert.equal(await page.evaluate(()=>__RAPTOR.paused),true);assert.match(await page.locator('.pause-dialog').textContent(),/Harbor Watch/);
  assert.match(await page.locator('.pause-dialog').textContent(),/fictional scenario/);
  assert.equal(await page.evaluate(()=>__RAPTOR.city.era),'2001-aftermath');
  assert.equal(await page.evaluate(()=>__RAPTOR.city.landmarks.some(l=>l.id==='one-world')),false);
  assert.equal(await page.evaluate(()=>!!__RAPTOR.aftermath),true);
  const t=await page.evaluate(()=>__RAPTOR.sim.time);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);
  await snap('06-flight-briefing');await page.locator('[data-resume]').click();await page.waitForTimeout(2000);await snap('07-harbor-watch');
 });
 await check('standalone success saves separately and offers replay without advancing campaign',async()=>{
  const before=await page.evaluate(()=>localStorage.getItem('raptor.auth.v1'));
  await page.evaluate(()=>{__RAPTOR.match.over=1;});await page.waitForSelector('.pause-dialog[open]');
  assert.equal(await page.evaluate(()=>__RAPTOR.progressSaved),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('raptor.auth.v1')),before);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.scenarios.v1')).done.Y01),1);
  assert.equal(await page.locator('[data-next]').count(),0);assert.match(await page.locator('[data-replay-scenario]').textContent(),/Replay/);
  await snap('08-scenario-debrief');
 });
 await check('scenario replay returns to a fresh paused briefing with both targets restored',async()=>{
  await page.locator('[data-replay-scenario]').click();
  await Promise.all([page.waitForEvent('load'),page.locator('.confirm-dialog [data-confirm]').click()]);await boot();
  assert.equal(await page.evaluate(()=>__RAPTOR.match.over),0);
  assert.equal(await page.evaluate(()=>__RAPTOR.bandits.aliveCount()),2);
  assert.equal(await page.evaluate(()=>__RAPTOR.paused),true);
  assert.ok(await page.evaluate(()=>__RAPTOR.sim.time)<2);
  assert.match(await page.locator('[data-resume]').textContent(),/Begin Harbor Watch/);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.scenarios.v1')).done.Y01),1);
 });
 await check('WebGL fallback renders the same geographic city and flies',async()=>{
  await page.evaluate(async()=>{const s=await import('/src/game/settings.js');s.saveSettings({tier:'LOW',muted:true});});
  await page.goto(base+'?front=NEWYORK&mode=practice&gl=1&tod=12');await boot();
  assert.equal(await page.evaluate(()=>__RAPTOR.backend),'webgl');assert.equal(await page.evaluate(()=>__RAPTOR.city.stats.buildings),cityStats.buildings);
  if(await page.evaluate(()=>__RAPTOR.paused))await page.locator('[data-resume]').click();await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.up('w');await snap('09-webgl-city');
 });
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
} catch(e){await snap('failure').catch(()=>{});throw e;}
finally{await writeFile(out+'results.json',JSON.stringify({passed:passed.length,checks:passed,errors,badResponses,cityStats,note:'Debrief result is injected. Real mission success uses production inputs in newyork-mission.test.mjs.'},null,2));await browser.close();}

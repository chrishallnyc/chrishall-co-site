// Real AUTO/manual graphics integration on an isolated Retina browser profile.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=process.env.RAPTOR_TEST_OUTPUT||'.context/smoothness/browser';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
const ctx=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2});
await ctx.addInitScript(()=>{localStorage.setItem('raptor.practice.introduced','true');});
const page=await ctx.newPage(),checks=[],errors=[];page.setDefaultTimeout(120000);
page.on('pageerror',error=>errors.push(error.message));
const setRange=(selector,value)=>page.locator(selector).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const graphics=()=>page.evaluate(()=>({ratio:__RAPTOR.rendering.renderer.getPixelRatio(),budget:__RAPTOR.frameBudget,paused:__RAPTOR.paused,time:__RAPTOR.sim.time,settings:JSON.parse(localStorage.getItem('raptor.settings.v1')||'{}')}));
try{
 await page.goto((process.env.RAPTOR_BASE_URL||'http://localhost:8192/')+'?mode=practice');
 await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure);assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
 await page.locator('#veil').waitFor({state:'detached'});
 await check('Retina Auto bounds scene pixels while instruments retain full resolution',async()=>{
  const g=await graphics();assert(g.ratio*g.ratio*1280*800<=1_000_001);
  assert.equal(await page.evaluate(()=>__RAPTOR.hud.canvas.width),2560);
  assert.equal(await page.evaluate(()=>__RAPTOR.cloudPass.lightCache.stats.initialWarmup.complete),true);
 });
 await page.locator('[data-flight-action="settings"]').click();await page.locator('[data-tab="display"]').click();
 await check('manual quality bypasses Auto without advancing the paused flight',async()=>{
  const time=(await graphics()).time;await page.locator('[data-quality="HIGH"]').click();
  assert.equal((await graphics()).ratio,2);assert.equal((await graphics()).time,time);
 });
 await check('fixed scale and automatic resolution can be changed without resetting other preferences',async()=>{
  await page.locator('[data-quality="AUTO"]').click();
  await setRange('#setup-fov',75);
  await setRange('#setup-renderScale',0.6);
  assert.equal((await graphics()).ratio,1.2);assert.equal(await page.locator('[data-auto-resolution]').isEnabled(),true);
  await page.locator('[data-auto-resolution]').click();const g=await graphics();
  assert.equal(g.settings.renderScale,null);assert.equal(g.settings.fov,75);assert.equal(g.settings.tier,'AUTO');
  assert(g.ratio*g.ratio*1280*800<=1_000_001);assert.equal(await page.locator('[data-auto-resolution]').isDisabled(),true);
 });
 await page.locator('[data-tab="audio"]').click();
 await check('audio edits preserve the active rendering budget',async()=>{
  const ratio=(await graphics()).ratio;await setRange('#setup-masterVol',0.4);assert.equal((await graphics()).ratio,ratio);
 });
 await page.keyboard.press('Escape');if(await page.locator('[data-resume]').isVisible())await page.locator('[data-resume]').click();
 await page.waitForFunction(()=>!__RAPTOR.paused);
 await check('live resize keeps the Auto budget and pause freezes simulation',async()=>{
  await page.setViewportSize({width:1500,height:900});await page.waitForFunction(()=>__RAPTOR.frameBudget.pixels<=1_000_001&&__RAPTOR.rendering.renderer.domElement.width<=1100);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>__RAPTOR.paused);const time=(await graphics()).time;await page.waitForTimeout(300);assert.equal((await graphics()).time,time);
 });
 assert.deepEqual(errors,[]);await page.screenshot({path:out+'/settings-and-pause.png'});
 await writeFile(out+'/report.json',JSON.stringify({checks,errors,graphics:await graphics()},null,2));
}finally{await browser.close();}

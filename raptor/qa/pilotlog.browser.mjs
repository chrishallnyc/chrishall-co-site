// Campaign discovery and preparation in the real preflight, without a GPU boot.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-pilotlog/').replace(/\/?$/,'/');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>localStorage.setItem('raptor.auth.v1',JSON.stringify({v:1,done:{N01:1,N02:1}})));
const page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await page.goto(origin,{waitUntil:'networkidle'});await page.locator('[data-open="progress"]').click();
 await page.locator('[data-mission-search]').waitFor();
 await check('search preserves typing and finds mission IDs without unlocking future missions',async()=>{
  await page.locator('[data-mission-search]').pressSequentially('m10');
  assert.equal(await page.locator('[data-mission-search]').inputValue(),'m10');
  assert.equal(await page.locator('[data-mission-search]').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('[data-mission]').count(),1);
  assert.match(await page.locator('.mission-briefing h3').textContent(),/TYPHOON/);
  assert.equal(await page.locator('[data-launch-mission]').isDisabled(),true);
  await page.locator('[data-mission-search]').fill('defense suppression');
  assert.ok(await page.locator('[data-mission]').count()>0);
  assert.ok((await page.locator('.mission-row-type').allTextContents()).every(text=>text.includes('Air defense suppression')));
 });
 await check('completed, ready and locked filters reflect actual saved campaign progress',async()=>{
  await page.locator('[data-mission-search]').fill('');
  for(const [status,count] of [['completed',2],['ready',1],['locked',27]]){
   await page.locator('[data-mission-status]').selectOption(status);
   assert.equal(await page.locator('[data-mission]').count(),count);
  }
  await page.locator('[data-mission-status]').selectOption('ready');
  assert.equal(await page.locator('[data-mission="V01"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-launch-mission]').isEnabled(),true);
 });
 await check('empty filters have a recovery action and next mission bypasses prior filters',async()=>{
  await page.locator('[data-filter="NELLIS"]').click();
  assert.equal(await page.locator('.log-empty').isVisible(),true);
  assert.equal(await page.locator('.log-layout').isVisible(),false);
  await page.locator('[data-clear-mission-filters]').click();
  assert.equal(await page.locator('[data-mission]').count(),30);
  assert.equal(await page.locator('[data-mission-search]').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-mission-search]').fill('nothing matches this');
  await page.locator('[data-next-briefing]').click();
  assert.equal(await page.locator('[data-mission-search]').inputValue(),'');
  assert.equal(await page.locator('[data-mission-status]').inputValue(),'ready');
  assert.equal(await page.locator('.mission-briefing h3').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('[data-mission="V01"]').getAttribute('aria-pressed'),'true');
 });
 await check('preflight preparation shows authored requirements without starting a flight',async()=>{
  await page.locator('[data-mission-status]').selectOption('all');
  await page.locator('[data-mission-search]').fill('N01');
  await page.locator('.briefing-objectives summary').click();
  assert.match(await page.locator('.briefing-objectives').textContent(),/Destroy ground targets · 4 targets/);
  assert.equal(await page.locator('.briefing-objectives li').count(),3);
  assert.deepEqual(await page.locator('.briefing-objectives small').allTextContents(),['Navigation','Required','Required']);
  assert.match(await page.locator('[data-launch-mission]').textContent(),/Replay mission/);
  assert.equal(await page.evaluate(()=>__RAPTOR.ready),false);
  await page.screenshot({path:out+'mission-preparation.png'});
 });
 await check('changing a scrolled mission list reveals its new selection and explains defense victory',async()=>{
  await page.locator('[data-mission-search]').fill('');
  await page.locator('[data-mission="M10"]').click();
  await page.locator('[data-filter="NELLIS"]').click();
  assert.equal(await page.locator('[data-mission="N01"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.mission-list').evaluate(el=>el.scrollTop),0);
  await page.locator('[data-next-briefing]').click();
  await page.locator('.briefing-objectives summary').click();
  assert.match(await page.locator('.briefing-win-rule').textContent(),/Hold until the time limit to win/);
  assert.ok((await page.locator('.briefing-objectives small').allTextContents()).includes('For early victory'));
 });
 await check('search and mission preparation fit narrow screens and Escape restores focus',async()=>{
  for(const [width,height] of [[390,844],[375,667]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.locator('.pilot-log').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   assert.equal(await page.locator('.pilot-log .dialog-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  }
  await page.locator('[data-mission="V01"]').click();
  assert.equal(await page.locator('.mission-briefing h3').evaluate(el=>el===document.activeElement),true);
  const launch=await page.locator('[data-launch-mission]').boundingBox();
  assert.ok(launch.y>=0&&launch.y+launch.height<=page.viewportSize().height);
  await page.screenshot({path:out+'mission-preparation-narrow.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-open="progress"]').evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.auth.v1')).done),{N01:1,N02:1});
 });
 assert.deepEqual(errors,[]);
}catch(error){console.error(error);process.exitCode=1;await page.screenshot({path:out+'failure.png'}).catch(()=>{});}
finally{await writeFile(out+'results.json',JSON.stringify({checks,errors},null,2));await context.close();await browser.close();}

// Real practice flight and display/guidance checks in an isolated browser.
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const out=(process.env.RAPTOR_TEST_OUTPUT || '.context/raptor-five/guidance/').replace(/\/?$/, '/');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1',args:['--window-size=1440,1000']});
const context=await browser.newContext({viewport:{width:1440,height:940}}),page=await context.newPage(),checks=[],errors=[];
page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const resume=async()=>{await page.locator('.pause-dialog[open] [data-resume]').click();await page.waitForFunction(()=>!__RAPTOR.paused);};
try{
await page.addInitScript(()=>{localStorage.setItem('raptor:quality:v1','LOW');localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'LOW',pointingDevice:'trackpad'}));});
await page.goto((process.env.RAPTOR_BASE_URL || 'http://localhost:8082/')+'?mode=practice&front=NELLIS',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
await page.waitForSelector('#veil',{state:'detached'});await page.bringToFront();await resume();
await check('hiding the checklist leaves key reminders visible',async()=>{
await page.locator('[data-hide-checklist]').click();assert.equal(await page.locator('.practice-checklist').isVisible(),false);assert.equal(await page.locator('.flight-hints').isVisible(),true);
await page.locator('[data-flight-action="pause"]').click();await page.locator('[data-checklist]').click();await resume();assert.equal(await page.locator('.practice-checklist').isVisible(),true);
});
await check('flight coach reads measured flight and free-flight controls keep keyboard focus',async()=>{
await page.locator('[data-coach-retry]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
await page.waitForFunction(()=>__RAPTOR.cockpit.coach.course.index>=1,null,{timeout:120000});
assert.match(await page.locator('.practice-checklist h3').textContent(),/pace/);
await page.locator('[data-coach-free]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
assert.match(await page.locator('.practice-checklist h3').textContent(),/Your airspace/);await page.screenshot({path:out+'01-practice.png'});
});
await check('hidden key reminders can be restored from pause independently',async()=>{
await page.locator('.flight-hints button').click();await page.locator('[data-flight-action="pause"]').click();assert.match(await page.locator('[data-reminders]').textContent(),/Show/);await page.locator('[data-reminders]').click();await resume();assert.equal(await page.locator('.flight-hints').isVisible(),true);assert.equal(await page.locator('.practice-checklist').isVisible(),true);
});
await check('accessibility preview scales while the simulation remains frozen',async()=>{
await page.locator('[data-flight-action="settings"]').click();await page.locator('[data-tab="accessibility"]').click();const t=await page.evaluate(()=>__RAPTOR.sim.time);
await page.locator('#setup-hudScale').fill('1.4');await page.locator('#setup-subtitleScale').fill('1.6');assert.equal(await page.locator('.instrument-sample').evaluate(el=>el.style.getPropertyValue('--instrument-scale')),'1.4');
await page.locator('[data-palette="deuteranopia"]').click();assert.match(await page.locator('.sample-targets').innerHTML(),/#ffa03c/);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);await page.locator('.setup-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:out+'02-accessibility.png'});
});
await check('pending graphics offer a reviewable restart and cancel preserves flight',async()=>{
await page.locator('[data-tab="display"]').click();await page.locator('[data-quality="MED"]').click();assert.match(await page.locator('.graphics-status').textContent(),/new flight/);assert.equal(await page.locator('[data-quality="MED"]').getAttribute('aria-pressed'),'true');await page.locator('[data-review-restart]').click();await page.waitForSelector('.pause-dialog[open]');assert.match(await page.locator('[data-restart]').textContent(),/new graphics/);await page.locator('[data-restart]').click();await page.locator('.confirm-dialog [data-cancel]').click();assert.equal(await page.evaluate(()=>__RAPTOR.paused),true);await page.screenshot({path:out+'03-pause.png'});
});
await check('current mission briefing overrides a previously selected and filtered mission',async()=>{
// Force only the route context, not any completed progress or gameplay result.
await page.evaluate(()=>__RAPTOR.cockpit.flags.set('sortie','N01'));await page.locator('[data-pause="progress"]').click();await page.locator('[data-filter="VALDEZ"]').click();await page.keyboard.press('Escape');await page.locator('.pause-dialog[open] [data-pause="progress"]').click();await page.waitForSelector('[data-mission="N01"].selected');assert.match(await page.locator('.mission-briefing .eyebrow').textContent(),/Nellis \/ Mission 01/);await page.keyboard.press('Escape');
});
assert.deepEqual(errors,[]);
} catch(e){console.error(e);process.exitCode=1;await page.screenshot({path:out+'failure.png'});}finally{await writeFile(out+'results.json',JSON.stringify({checks,errors},null,2));await context.close();await browser.close();}

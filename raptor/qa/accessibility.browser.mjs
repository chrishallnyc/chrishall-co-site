// Native modal semantics, storage migration and example preview in a real browser.
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-five/accessibility/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1'}),page=await browser.newPage({viewport:{width:1440,height:940}}),results=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
try{
await page.addInitScript(()=>{if(!localStorage.getItem('qa-seeded')){localStorage.setItem('raptor:mute','1');localStorage.setItem('qa-seeded','1');}});
await page.goto(process.env.RAPTOR_BASE_URL||'http://localhost:8082/',{waitUntil:'networkidle'});
await check('native setup excludes the background from focus and the accessibility tree',async()=>{
await page.evaluate(()=>{const el=document.createElement('div');el.id='previously-inert';el.inert=true;document.body.append(el);});
await page.locator('[data-open="controls"]').first().click();assert.equal(await page.locator('#controls').evaluate(el=>el.matches(':modal')),true);
await page.locator('#flyBtn').evaluate(el=>el.focus());assert.equal(await page.evaluate(()=>document.activeElement.closest('#controls')!==null),true);const ax=await(await page.context().newCDPSession(page)).send('Accessibility.getFullAXTree');assert.equal(ax.nodes.some(node=>!node.ignored&&node.name?.value==='The sky is yours.'),false);
await page.locator('[data-bind="throttle_up"][data-slot="0"]').click();assert.equal(await page.locator('.setup-shell').evaluate(el=>el.inert),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.setup-shell').evaluate(el=>el.inert),false);
await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.open),'controls');assert.equal(await page.locator('#previously-inert').evaluate(el=>el.inert),true);
});
await check('legacy mute is visible, editable and persists as the chosen preference',async()=>{
assert.match(await page.locator('#setup-summary').textContent(),/Muted/);await page.locator('[data-open="settings"]').first().click();await page.locator('[data-tab="audio"]').click();assert.equal(await page.locator('#setup-muted').isChecked(),true);await page.locator('#setup-muted').uncheck();await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});assert.doesNotMatch(await page.locator('#setup-summary').textContent(),/Muted/);
});
await check('shared cannon defaults survive real UI saves and reloads',async()=>{
await page.locator('[data-open="controls"]').first().click();await page.locator('#controlSearch').fill('landing');await page.locator('[data-bind="gear"][data-slot="0"]').click();await page.keyboard.press('f');await page.locator('[data-resolve="share"]').click();await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await page.locator('[data-open="controls"]').first().click();await page.locator('[data-action="test"]').click();await page.keyboard.press('f');assert.match(await page.locator('#testLastInput').textContent(),/Fire cannon/);assert.match(await page.locator('#testLastInput').textContent(),/Landing gear/);await page.keyboard.press('Escape');
});
await check('instrument preview remains readable at large and narrow widths',async()=>{
await page.locator('[data-tab="accessibility"]').click();await page.locator('#setup-hudScale').fill('1.4');await page.locator('.setup-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:out+'01-instrument-preview.png'});
await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#controls').evaluate(el=>el.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.instrument-preview').isVisible(),true);await page.screenshot({path:out+'02-narrow-preview.png'});
});
assert.deepEqual(errors,[]);
}catch(e){console.error(e);process.exitCode=1;await page.screenshot({path:out+'failure.png'});}finally{await writeFile(out+'results.json',JSON.stringify({results,errors},null,2));await browser.close();}

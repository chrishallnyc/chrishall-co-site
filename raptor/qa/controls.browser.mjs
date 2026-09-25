// Run against the static RAPTOR server. Playwright is optional QA tooling;
// PLAYWRIGHT_MODULE may point to an existing installation on this machine.
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-playability/controls/', import.meta.url).pathname;
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:process.env.HEADED !== '1',args:['--window-size=1280,900']});
const context = await browser.newContext({viewport:{width:1280,height:840},recordVideo:{dir:out,size:{width:1280,height:840}}});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/src/boot.js', route => route.fulfill({contentType:'text/javascript',body:`
  import { Input } from './engine/input.js'; import { ControlsMenu } from './game/controlsmenu.js';
  document.getElementById('veil')?.remove(); document.getElementById('hangar')?.remove();
  window.testInput = new Input(window); window.testControls = new ControlsMenu(testInput); testControls.show();
`}));
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS '+name); };
try {
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.screenshot({path:out+'01-controls.png',fullPage:true});
  await check('only implemented controls visible, essentials first', async()=> {
    assert.equal(await page.locator('[data-action-id]').count(),8);
    await page.locator('[data-action="keys"]').click();
    assert.equal(await page.locator('.keyboard-layout > summary').evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-action="all-keys"]').click();
    assert.equal(await page.locator('#controlSearch').evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-category="all"]').click();
    assert.equal(await page.locator('[data-action-id]').count(),19);
  });
  await check('editing a control lower in the list preserves its scroll position', async()=>{
    await page.locator('[data-bind="debug"][data-slot="0"]').scrollIntoViewIfNeeded();
    const before=await page.locator('.setup-content').evaluate(el=>el.scrollTop);
    assert.ok(before>200);
    await page.locator('[data-bind="debug"][data-slot="0"]').click(); await page.keyboard.press('F6');
    const after=await page.locator('.setup-content').evaluate(el=>el.scrollTop);
    assert.ok(Math.abs(after-before)<40, `scroll moved from ${before} to ${after}`);
    await page.locator('[data-bind="debug"][data-slot="0"]').click(); await page.keyboard.press('Backquote');
  });
  await check('primary rebind preserves alternates and saves after reload', async()=>{
    await page.locator('[data-bind="throttle_up"][data-slot="0"]').click();
    await page.keyboard.press('u');
    assert.deepEqual(await page.evaluate(()=>testInput.actions.throttle_up.binds),[['KeyU'],['NumpadAdd'],['Equal']]);
    await page.reload({waitUntil:'networkidle'});
    assert.deepEqual(await page.evaluate(()=>testInput.actions.throttle_up.binds),[['KeyU'],['NumpadAdd'],['Equal']]);
  });
  await check('Escape cancels capture and leaves setup open', async()=>{
    await page.locator('[data-bind="throttle_up"][data-slot="0"]').click(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>testControls.open),true);
    assert.deepEqual(await page.evaluate(()=>testInput.actions.throttle_up.binds[0]),['KeyU']);
  });
  await check('search finds every category and stays focused while typing', async()=>{
    await page.locator('#controlSearch').fill('gear');
    assert.equal(await page.locator('[data-action-id]').count(),1);
    assert.equal(await page.locator('[data-action-id]').getAttribute('data-action-id'),'gear');
    assert.equal(await page.locator('#controlSearch').evaluate(el=>el===document.activeElement),true);
  });
  await check('conflicting capture offers explicit choice before mutation', async()=>{
    await page.locator('[data-bind="gear"][data-slot="0"]').click(); await page.keyboard.press('u');
    assert.equal(await page.locator('[data-resolve]').count(),3);
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds),[['KeyG']]);
    await page.screenshot({path:out+'02-conflict.png'});
    await page.locator('[data-resolve="replace"]').click();
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds),[['KeyU']]);
    assert.deepEqual(await page.evaluate(()=>testInput.actions.throttle_up.binds),[['NumpadAdd'],['Equal']]);
  });
  await check('add alternate and remove primary independently', async()=>{
    await page.locator('[data-bind="gear"][data-slot="1"]').click(); await page.keyboard.press('g');
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds),[['KeyU'],['KeyG']]);
    await page.locator('[data-remove="gear"][data-slot="0"]').click();
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds),[['KeyG']]);
  });
  await check('mouse button capture and wheel press bindings work', async()=>{
    await page.locator('#controlSearch').fill('missile');
    await page.locator('[data-bind="fire_aam"][data-slot="0"]').click();
    await page.locator('.capture-keys').click({button:'right'});
    assert.deepEqual(await page.evaluate(()=>testInput.actions.fire_aam.binds[0]),['Mouse2']);
    await page.locator('[data-bind="fire_aam"][data-slot="0"]').click();
    await page.locator('.capture-keys').hover(); await page.mouse.wheel(0,-100);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(()=>testInput.actions.fire_aam.binds[0]),['WheelUp']);
  });
  await check('wheel cannot be assigned to held flight action',async()=>{
    await page.locator('#controlSearch').fill('roll left');
    await page.locator('[data-bind="roll_left"][data-slot="0"]').click();
    await page.locator('.capture-keys').hover(); await page.mouse.wheel(0,100); await page.waitForTimeout(100);
    assert.match(await page.locator('#captureFeedback').textContent(),/needs a held key/);
    await page.keyboard.press('Escape');
  });
  await check('modifier capture releases cleanly and cancellation does not capture next input',async()=>{
    await page.locator('#controlSearch').fill('gear');
    await page.locator('[data-bind="gear"][data-slot="0"]').click();
    await page.keyboard.down('Shift'); await page.keyboard.press('g'); await page.keyboard.up('Shift');
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds[0]),['ShiftLeft','KeyG']);
    await page.locator('[data-bind="gear"][data-slot="0"]').click(); await page.keyboard.press('Escape');
    await page.locator('#controlSearch').fill('cannon');
    assert.equal(await page.locator('[data-action-id]').getAttribute('data-action-id'),'fire_mguns');
  });
  await check('test area identifies actions without entering flight state',async()=>{
    await page.locator('[data-action="test"]').click();
    await page.keyboard.down('a');
    assert.match(await page.locator('#testActions').textContent(),/Roll left/);
    assert.equal(await page.evaluate(()=>testInput.held('roll_left')),false);
    await page.screenshot({path:out+'03-test.png'});
    await page.keyboard.up('a'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.input-test').count(),0);
  });
  await check('reset requires confirmation and restores defaults',async()=>{
    await page.locator('[data-action="reset-binds"]').click();
    assert.equal(await page.locator('#confirmTitle').textContent(),'Reset your control keys?');
    await page.locator('[data-confirm="cancel"]').click();
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds[0]),['ShiftLeft','KeyG']);
    await page.locator('[data-action="reset-binds"]').click(); await page.locator('[data-confirm="reset"]').click();
    assert.deepEqual(await page.evaluate(()=>testInput.actions.gear.binds[0]),['KeyG']);
  });
  await check('custom modifier shortcut does not secretly activate the underlying flight key',async()=>{
    await page.locator('#controlSearch').fill('gear');
    await page.locator('[data-bind="gear"][data-slot="0"]').click();
    await page.keyboard.down('Shift'); await page.keyboard.press('w'); await page.keyboard.up('Shift');
    await page.locator('[data-action="close"]').click();
    await page.locator('#game').evaluate(el=>{el.tabIndex=-1;el.focus();});
    await page.keyboard.down('Shift'); await page.keyboard.down('w');
    assert.equal(await page.evaluate(()=>testInput.pressed('gear')),true);
    assert.equal(await page.evaluate(()=>testInput.held('throttle_up')),false);
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(()=>testInput.held('throttle_up')),true);
    await page.keyboard.up('w');
    await page.evaluate(()=>testControls.show());
    await page.locator('[data-action="reset-binds"]').click(); await page.locator('[data-confirm="reset"]').click();
  });
  await check('display, audio and accessibility sections have labeled controls',async()=>{
    for(const tab of ['display','audio','accessibility']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      assert.ok(await page.locator('[data-setting]').count()>0);
      await page.screenshot({path:out+`04-${tab}.png`});
    }
    await page.locator('[data-tab="controls"]').click();
  });
  await check('dialog focus trap wraps and Done closes/restores input',async()=>{
    await page.locator('[data-action="close"]').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.closest('#controls')!==null),true);
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.evaluate(()=>testControls.open),false);
    assert.equal(await page.evaluate(()=>testInput.suspended),false);
  });
  await check('responsive layout fits narrow viewport without horizontal overflow',async()=>{
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>testControls.show('controls'));
    await page.screenshot({path:out+'05-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.querySelector('#controls').scrollWidth<=390),true);
    for(const tab of ['display','accessibility']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      assert.equal(await page.evaluate(()=>document.querySelector('#controls').scrollWidth<=390),true);
    }
  });
  assert.deepEqual(errors,[]);
} catch (error) { console.error(error); await page.screenshot({path:out+'failure.png',fullPage:true}); process.exitCode=1; }
finally { await writeFile(out+'results.json',JSON.stringify({results,errors},null,2)); const video=page.video(); await context.close(); await video.saveAs(out+'controls-playthrough.webm'); await browser.close(); }

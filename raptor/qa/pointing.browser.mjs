// Isolated browser playthrough of mouse and MacBook trackpad profiles.
// Pointer motion is automated; this does not emulate physical macOS gestures.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = (process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-trackpad/playthrough/', import.meta.url).pathname).replace(/\/?$/, '/');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:process.env.HEADED !== '1',args:['--window-size=1440,1000']});
const context = await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
const page = await context.newPage(), errors = [], results = [];
page.setDefaultTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));
const check = async (name,fn) => { await fn(); results.push(name); console.log('PASS '+name); };
const snap = name => page.screenshot({path:out+name+'.png',fullPage:true});
const saved = () => page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.settings.v1')));
const slider = async (key,value) => page.locator(`[data-setting="${key}"]`).evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
const pause = async () => { await page.locator('[data-flight-action="pause"]').click();await page.locator('.pause-options > summary').click();await page.locator('[data-pause="controls"]').click(); await page.waitForFunction(()=>__RAPTOR.cockpit.paused); };
const resume = async () => {
  if (await page.locator('#controls').isVisible()) await page.locator('[data-action="close"]').click();
  // Native dialog close events open the pause sheet on the next task.
  // Wait for its button whenever flight is paused instead of racing a count.
  if (await page.evaluate(()=>__RAPTOR.cockpit.paused)) await page.locator('.pause-dialog[open] [data-resume]').click();
  await page.waitForFunction(()=>__RAPTOR.ready&&!__RAPTOR.cockpit.paused);
};
const motion = async () => {
  await page.mouse.move(750,460); await page.keyboard.press('r'); await page.waitForTimeout(80);
  const before = await page.evaluate(()=>__RAPTOR.player.aimHeading);
  await page.mouse.move(790,460,{steps:8}); await page.waitForTimeout(100);
  return before - await page.evaluate(()=>__RAPTOR.player.aimHeading);
};
try {
  await page.goto(origin,{waitUntil:'networkidle'});
  await check('mouse and MacBook trackpad choices are visible before launch and persist',async()=>{
    assert.equal(await page.locator('[data-deck-device="mouse"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-deck-device="trackpad"]').click();
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('[data-deck-device="trackpad"]').getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#setup-summary').textContent(),/Trackpad aiming/);
    await snap('01-trackpad-preflight');
  });
  await page.locator('[data-tune-aim]').click();
  await check('each device remembers its sensitivity and switching preserves custom keys',async()=>{
    assert.equal(await page.locator('[data-setting="trackpadSensitivity"]').inputValue(),'0.65');
    await slider('trackpadSensitivity',.55);
    await page.locator('#controlSearch').fill('gear');
    await page.locator('[data-bind="gear"][data-slot="0"]').click();await page.keyboard.press('j');
    await page.locator('[data-device="mouse"]').click();await slider('mouseSensitivity',1.4);
    await page.locator('[data-device="trackpad"]').click();
    assert.equal(await page.locator('[data-setting="trackpadSensitivity"]').inputValue(),'0.55');
    assert.equal((await saved()).mouseSensitivity,1.4);
    assert.deepEqual(await page.evaluate(()=>__RAPTOR.input.actions.gear.binds),[['KeyJ']]);
    await page.locator('#controlSearch').fill('');
    await snap('02-trackpad-controls');
  });
  await check('safe aim preview uses selected gain and inversion without activating the aircraft',async()=>{
    await page.locator('[data-action="test"]').click();
    await page.locator('.aim-test-surface').scrollIntoViewIfNeeded();
    let box=await page.locator('.aim-test-surface').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.locator('[data-test-recenter]').focus();await page.keyboard.press('Enter');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+10,{steps:5});
    assert.match(await page.locator('.aim-test-reading').textContent(),/3.5° right · 0.9° down/);
    await page.locator('[data-setting="invertY"]').check();
    await page.locator('[data-test-recenter]').click();
    box=await page.locator('.aim-test-surface').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2+20,{steps:5});
    assert.match(await page.locator('.aim-test-reading').textContent(),/1.8° up/);
    await page.locator('.input-test').focus();await page.keyboard.down('f');
    assert.match(await page.locator('#testActions').textContent(),/Fire cannon/);
    assert.equal(await page.evaluate(()=>__RAPTOR.input.held('fire_mguns')),false);
    await snap('03-safe-aim-preview');await page.keyboard.up('f');await page.keyboard.press('Escape');
    await page.locator('[data-setting="invertY"]').uncheck();
  });
  await check('controller sensitivity is independent and keyboard accessible',async()=>{
    await page.locator('.setup-controller-options summary').focus();await page.keyboard.press('Enter');
    await slider('gamepadSensitivity',1.2);
    const settings=await saved();assert.equal(settings.gamepadSensitivity,1.2);assert.equal(settings.trackpadSensitivity,.55);assert.equal(settings.mouseSensitivity,1.4);
  });
  await page.locator('[data-tab="display"]').click();await page.locator('[data-quality="LOW"]').click();await page.keyboard.press('Escape');
  await check('compact layouts keep both setup choices and controls inside the viewport',async()=>{
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#hangar').evaluate(el=>el.scrollWidth<=innerWidth),true);
    await page.locator('[data-tune-aim]').click();
    assert.equal(await page.locator('.setup-shell').evaluate(el=>el.scrollWidth<=innerWidth),true);
    await snap('04-compact-controls');await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:900});
  });
  await page.locator('#flyBtn').click();
  await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
  await page.waitForSelector('#veil',{state:'detached'});await resume();
  await check('trackpad profile launches with its gain and no held mouse button is needed to aim or fire',async()=>{
    assert.equal(await page.evaluate(()=>__RAPTOR.input.options.mouseSensitivity),.55);
    assert.equal(await page.evaluate(()=>__RAPTOR.input.options.gamepadSensitivity),1.2);
    assert.deepEqual(await page.evaluate(()=>__RAPTOR.input.actions.gear.binds),[['KeyJ']]);
    const aimDelta=await motion();assert.ok(Math.abs(aimDelta-40*.55*.0028)<.001,`trackpad aim delta ${aimDelta}`);
    const ammo=await page.evaluate(()=>__RAPTOR.player.gun.ammo);
    await page.keyboard.down('f');await page.mouse.move(820,450,{steps:12});await page.waitForTimeout(250);await page.keyboard.up('f');
    assert.ok(await page.evaluate(()=>__RAPTOR.player.gun.ammo)<ammo);
    assert.equal(await page.evaluate(()=>__RAPTOR.input.down.has('Mouse0')),false);
    await snap('05-trackpad-flight');
  });
  await check('ordinary keyboard keys control flight and H opens the paused guide without Fn',async()=>{
    const throttle=await page.evaluate(()=>__RAPTOR.player.throttleCmd);
    await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');
    assert.ok(await page.evaluate(()=>__RAPTOR.player.throttleCmd)>throttle);
    await page.keyboard.down('a');await page.waitForTimeout(200);await page.keyboard.up('a');
    assert.ok(Math.abs(await page.evaluate(()=>__RAPTOR.player.hudState().roll))>1,'held bank input changes actual aircraft attitude');
    await page.keyboard.press('h');await page.waitForSelector('.guide-dialog[open]');
    assert.match(await page.locator('.guide-steps').textContent(),/Slide one finger/);
    const t=await page.evaluate(()=>__RAPTOR.sim.time);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);
    await page.locator('[data-guide-done]').click();await resume();
  });
  await check('switching to mouse in flight restores its own gain and left-click cannon',async()=>{
    await pause();await page.locator('[data-device="mouse"]').click();await resume();
    assert.equal(await page.evaluate(()=>__RAPTOR.input.options.mouseSensitivity),1.4);
    assert.equal(await page.evaluate(()=>__RAPTOR.input.options.gamepadSensitivity),1.2);
    const aimDelta=await motion();assert.ok(Math.abs(aimDelta-40*1.4*.0028)<.001,`mouse aim delta ${aimDelta}`);
    const ammo=await page.evaluate(()=>__RAPTOR.player.gun.ammo);
    await page.mouse.down();await page.mouse.move(805,455,{steps:8});await page.waitForTimeout(200);await page.mouse.up();
    assert.ok(await page.evaluate(()=>__RAPTOR.player.gun.ammo)<ammo);
    await snap('06-mouse-flight');
  });
  await check('pointer capture works with either aiming profile and Escape always releases into pause',async()=>{
    for(const device of ['mouse','trackpad']) {
      await pause();await page.locator(`[data-device="${device}"]`).click();await resume();await page.bringToFront();
      await page.locator('[data-flight-action="capture"]').click();
      await page.waitForFunction(()=>document.pointerLockElement===document.getElementById('game'));
      await page.mouse.move(810,465,{steps:8});await page.waitForTimeout(150);
      await page.keyboard.press('Escape');await page.waitForFunction(()=>__RAPTOR.cockpit.paused&&!document.pointerLockElement);
      await resume();
    }
  });
  await check('reloading a flight retains the selected device, all gains and custom keys',async()=>{
    await page.reload();await page.waitForFunction(()=>window.__RAPTOR?.ready,null,{timeout:120000});
    assert.equal(await page.evaluate(()=>__RAPTOR.input.options.mouseSensitivity),.55);
    const settings=await saved();assert.equal(settings.pointingDevice,'trackpad');assert.equal(settings.mouseSensitivity,1.4);assert.equal(settings.gamepadSensitivity,1.2);
    assert.deepEqual(await page.evaluate(()=>__RAPTOR.input.actions.gear.binds),[['KeyJ']]);
  });
  assert.deepEqual(errors,[]);
} catch(error) {console.error(error);await snap('failure').catch(()=>{});throw error;}
finally {
  await writeFile(out+'results.json',JSON.stringify({passed:results.length,results,errors,physicalTrackpadTested:false},null,2));
  const video=page.video();await context.close();await video.saveAs(out+'mouse-trackpad-playthrough.webm');await browser.close();
  console.log('RECORDING '+out+'mouse-trackpad-playthrough.webm');
}

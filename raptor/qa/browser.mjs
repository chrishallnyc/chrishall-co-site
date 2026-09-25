// Real scene integration checks. Serve raptor/ as the web root first.
// An isolated, temporary browser context keeps the player's saves untouched.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = (process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-playability/integration/', import.meta.url).pathname).replace(/\/?$/, '/');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1',args:['--window-size=1440,1000']});
const context = await browser.newContext({viewport:{width:1440,height:940},recordVideo:{dir:out,size:{width:1440,height:940}}});
const page=await context.newPage(), errors=[],results=[];
page.setDefaultTimeout(15000);
page.on('pageerror',error=>errors.push(error.message));
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const snap=name=>page.screenshot({path:out+name+'.png',fullPage:true});
const paused=()=>page.waitForFunction(()=>window.__RAPTOR?.cockpit?.paused);
const running=()=>page.waitForFunction(()=>window.__RAPTOR?.ready&&!__RAPTOR.cockpit.paused);
const resume=async()=>{if(await page.locator('.pause-dialog[open]').count())await page.locator('[data-resume]').click();await running();};
const boot=async()=>{
  await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
  await page.waitForSelector('#veil',{state:'detached',timeout:15000});
};
const assertFrozen=async()=>{
  const t=await page.evaluate(()=>__RAPTOR.sim.time);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);
};
try{
  await page.goto(origin+'?utm_source=qa',{waitUntil:'networkidle'});
  await check('analytics links open preflight with visible setup actions',async()=>{
    assert.equal(await page.locator('#flyBtn').textContent(),'Start practice↗');
    assert.equal(await page.locator('[data-open="controls"]').count(),2);
    assert.equal(await page.locator('#veil').count(),0);
    await snap('01-preflight');
  });
  await check('controls are accessible before flight and typing cannot launch a game',async()=>{
    await page.locator('[data-open="controls"]').first().click();
    await page.locator('#controlSearch').fill('throttle');
    await page.keyboard.press('Enter');await page.keyboard.press('Space');
    assert.equal(await page.locator('#controls').isVisible(),true);
    assert.equal(await page.locator('canvas#game').getAttribute('data-ready'),null);
    assert.match(page.url(),/utm_source/);
    await page.keyboard.press('Escape');
  });
  await check('preflight region and conditions persist across reload',async()=>{
    await page.locator('[data-front="VALDEZ"]').click();await page.locator('[data-time="golden"]').click();
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('[data-front="VALDEZ"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-time="golden"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-front="NELLIS"]').click();await page.locator('[data-time="noon"]').click();
  });
  await check('pilot log shows readable missions, locks and matching filtered briefings',async()=>{
    await page.locator('[data-open="progress"]').first().click();
    await page.waitForSelector('[data-mission="N01"]');
    assert.equal(await page.locator('.mission-row').count(),30);
    await page.locator('[data-mission="N02"]').click();
    assert.equal(await page.locator('[data-launch-mission]').isDisabled(),true);
    await page.locator('[data-filter="VALDEZ"]').click();
    assert.equal(await page.locator('.mission-row').count(),10);
    assert.match(await page.locator('.mission-briefing .eyebrow').textContent(),/Valdez/);
    await snap('02-pilot-log');await page.keyboard.press('Escape');
  });
  await check('graphics can be selected before launch',async()=>{
    await page.locator('[data-open="settings"]').first().click();
    await page.locator('[data-quality="LOW"]').click();
    await page.keyboard.press('Escape');
    assert.match(await page.locator('#setup-summary').textContent(),/Performance/);
  });
  await page.locator('#flyBtn').click();await boot();
  await check('first practice flight starts safely paused without combat',async()=>{
    await paused();await assertFrozen();
    assert.match(await page.locator('.pause-dialog h2').textContent(),/first flight/);
    assert.equal(await page.evaluate(()=>__RAPTOR.tier),'LOW');
    assert.equal(await page.evaluate(()=>__RAPTOR.cockpit.coach.course.held),0);
    assert.equal(await page.evaluate(()=>__RAPTOR.match),null);
    assert.equal(await page.evaluate(()=>__RAPTOR.post),true);
    await snap('03-ready');
  });
  await check('resume focuses the aircraft and real keyboard input changes throttle',async()=>{
    await resume();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
    // Let the first visible scene finish GPU compilation before measuring
    // a held input; browser automation can otherwise release it during compile.
    await page.waitForFunction(()=>__RAPTOR.sim.time>.8);
    const before=await page.evaluate(()=>__RAPTOR.player.throttleCmd);
    await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
    assert.ok(await page.evaluate(()=>__RAPTOR.player.throttleCmd)>before,JSON.stringify(await page.evaluate(()=>({time:__RAPTOR.sim.time,paused:__RAPTOR.paused,throttle:__RAPTOR.player.throttleCmd,held:__RAPTOR.input.held('throttle_up'),live:__RAPTOR.player._live}))));
    await page.mouse.move(720,500);await page.mouse.move(725,497,{steps:5});
    await page.keyboard.down('a');await page.waitForTimeout(400);await page.keyboard.up('a');
    await page.keyboard.down('d');await page.waitForTimeout(400);await page.keyboard.up('d');
    await snap('04-practice-flight');
  });
  await check('toolbar click pauses without firing or advancing the simulation',async()=>{
    const ammo=await page.evaluate(()=>__RAPTOR.player.gun.ammo);
    await page.locator('[data-flight-action="pause"]').click();await paused();await assertFrozen();
    assert.equal(await page.evaluate(()=>__RAPTOR.player.gun.ammo),ammo);
    await snap('05-pause');
    await page.keyboard.press('Escape');await running();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
  });
  await check('in-flight rebind stays paused and becomes the actual flight key',async()=>{
    await page.locator('[data-flight-action="controls"]').click();await paused();await assertFrozen();
    await page.locator('[data-bind="throttle_up"][data-slot="0"]').click();await page.keyboard.press('u');
    await page.locator('[data-action="close"]').click();
    await page.waitForSelector('.pause-dialog[open]');await resume();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
    await page.keyboard.down('s');await page.waitForTimeout(500);await page.keyboard.up('s');
    const before=await page.evaluate(()=>__RAPTOR.player.throttleCmd);
    await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');
    assert.equal(await page.evaluate(()=>__RAPTOR.player.throttleCmd),before);
    await page.keyboard.down('u');await page.waitForTimeout(400);await page.keyboard.up('u');
    assert.ok(await page.evaluate(()=>__RAPTOR.player.throttleCmd)>before);
    assert.match(await page.locator('.flight-hints').textContent(),/U/);
  });
  await check('audio edits do not rebuild GPU buffers and accessibility settings apply',async()=>{
    await page.locator('[data-flight-action="settings"]').click();await paused();
    await page.evaluate(async()=>{window.qaSettings=await import('/src/game/settings.js');const r=qaSettings.getLiveCtx().renderer;window.qaResizes=0;const f=r.setPixelRatio;r.setPixelRatio=function(...args){qaResizes++;return f.apply(this,args);};});
    await page.locator('[data-tab="audio"]').click();await page.locator('#setup-masterVol').fill('0.35');
    assert.equal(await page.evaluate(()=>qaResizes),0);
    assert.equal(await page.evaluate(()=>qaSettings.current().masterVol),.35);
    await page.locator('[data-tab="accessibility"]').click();await page.locator('#setup-hudScale').fill('1.2');
    assert.equal(await page.evaluate(()=>__RAPTOR.hud.uiScale),1.2);
    await page.locator('[data-tab="display"]').click();await page.locator('#setup-fov').fill('70');
    assert.equal(await page.evaluate(()=>qaSettings.getLiveCtx().camera.fov),70);
    await page.locator('#setup-showFps').check();await snap('06-display');
    await page.keyboard.press('Escape');await page.waitForSelector('.pause-dialog[open]');await resume();
  });
  await check('guide to controls transition keeps keyboard focus inside the active menu',async()=>{
    await page.locator('[data-flight-action="guide"]').click();await paused();
    await page.locator('[data-guide-controls]').click();await page.waitForSelector('#controls.open');
    assert.equal(await page.evaluate(()=>document.activeElement.closest('#controls')!==null),true);
    await page.keyboard.press('Escape');await page.waitForSelector('.pause-dialog[open]');await resume();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
  });
  await check('a remapped pause shortcut can both pause and resume',async()=>{
    await page.locator('[data-flight-action="controls"]').click();
    await page.locator('#controlSearch').fill('pause');
    await page.locator('[data-bind="game_pause"][data-slot="0"]').click();await page.keyboard.press('o');
    await page.keyboard.press('Escape');await page.waitForSelector('.pause-dialog[open]');await resume();
    await page.keyboard.press('o');await paused();await assertFrozen();
    await page.keyboard.press('o');await running();
  });
  await check('losing focus pauses without automatic resume or held key leakage',async()=>{
    await page.keyboard.down('u');
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('u');
    await paused();await assertFrozen();
    assert.match(await page.locator('.pause-message').textContent(),/left the game window/);
    const before=await page.evaluate(()=>({time:__RAPTOR.sim.time,throttle:__RAPTOR.player.throttleCmd}));
    await resume();await page.waitForTimeout(150);
    const after=await page.evaluate(()=>({time:__RAPTOR.sim.time,throttle:__RAPTOR.player.throttleCmd}));
    assert.ok(after.time-before.time<.4);
    assert.equal(after.throttle,before.throttle);
  });
  await check('canceling a leave confirmation preserves flight and blocks resume underneath',async()=>{
    await page.keyboard.press('Escape');await paused();await page.locator('[data-hangar]').click();
    await page.evaluate(()=>__RAPTOR.cockpit.toggle());
    assert.equal(await page.evaluate(()=>__RAPTOR.cockpit.paused),true);await assertFrozen();
    await page.locator('.confirm-dialog [data-cancel]').click();
    assert.equal(await page.locator('.pause-dialog').getAttribute('open'),'');
    await resume();
  });
  await check('HUD can be hidden and restored with the documented shortcut',async()=>{
    await page.keyboard.press('Alt+z');await page.waitForFunction(()=>__RAPTOR.cockpit.hudHidden);
    await page.keyboard.press('Alt+z');await page.waitForFunction(()=>!__RAPTOR.cockpit.hudHidden);
  });
  await check('optional mouse capture keeps steering active and Escape releases it into pause',async()=>{
    await page.bringToFront();
    await page.evaluate(()=>{
      const canvas=document.getElementById('game'),request=canvas.requestPointerLock.bind(canvas);
      canvas.requestPointerLock=()=>{const result=request();result?.catch(error=>{window.qaCaptureError=error.name+': '+error.message;});return result;};
    });
    await page.locator('[data-flight-action="capture"]').click();
    // The browser sets pointerLockElement before it queues pointerlockchange.
    // Wait for the application's event handler as well as the native lock.
    await page.waitForFunction(()=>(document.pointerLockElement?.id==='game'
      && document.querySelector('[data-flight-action="capture"]').getAttribute('aria-pressed')==='true')
      ||window.qaCaptureError);
    assert.equal(await page.evaluate(()=>window.qaCaptureError),undefined);
    assert.equal(await page.locator('[data-flight-action="capture"]').getAttribute('aria-pressed'),'true');
    await page.mouse.move(740,465,{steps:8});await page.waitForTimeout(300);
    await snap('07-mouse-captured');
    await page.keyboard.press('Escape');await paused();await assertFrozen();
    assert.equal(await page.evaluate(()=>document.pointerLockElement),null);
    await resume();
  });
  await check('custom keys and options survive a new flight without another first-run interruption',async()=>{
    await page.reload();await boot();
    if(await page.evaluate(()=>__RAPTOR.cockpit.paused))await resume();
    assert.deepEqual(await page.evaluate(()=>__RAPTOR.input.actions.throttle_up.binds[0]),['KeyU']);
    assert.equal(await page.evaluate(()=>__RAPTOR.hud.uiScale),1.2);
    assert.equal(await page.evaluate(()=>__RAPTOR.cockpit.reason==='welcome'),false);
    await page.keyboard.down('u');await page.waitForTimeout(300);await page.keyboard.up('u');
    await page.waitForTimeout(1200);await snap('07-personalized-flight');
  });
  await check('return to preflight requires and honors explicit confirmation',async()=>{
    await page.keyboard.press('Escape');await paused();await page.locator('[data-hangar]').click();
    await page.locator('.confirm-dialog [data-confirm]').click();await page.waitForSelector('#flyBtn');
    assert.equal(new URL(page.url()).search,'');
  });
  await check('narrow preflight fits the viewport with usable region choices',async()=>{
    await page.setViewportSize({width:390,height:844});await snap('08-mobile-preflight');
    assert.equal(await page.evaluate(()=>document.getElementById('hangar').scrollWidth<=innerWidth),true);
    const r=await page.locator('[data-front="NELLIS"]').boundingBox();assert.ok(r.height>70&&r.width>300);
  });
  assert.deepEqual(errors,[]);
}catch(error){console.error(error);await snap('failure').catch(()=>{});throw error;}
finally{
  await writeFile(out+'results.json',JSON.stringify({passed:results.length,results,errors},null,2));
  const video=page.video();await context.close();await video.saveAs(out+'integration-playthrough.webm');await browser.close();
  console.log('RECORDING '+out+'integration-playthrough.webm');
}

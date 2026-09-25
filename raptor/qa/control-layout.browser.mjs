// The controls lab works before renderer boot; no GPU scene or real profile is used.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = (process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-next/controls/', import.meta.url).pathname).replace(/\/?$/, '/');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:process.env.HEADED !== '1'});
const context = await browser.newContext({viewport:{width:1280,height:800}});
const page = await context.newPage(), results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/src/main.js', route => route.fulfill({contentType:'text/javascript',body:`
  import { Input } from './engine/input.js'; import { ControlsMenu } from './game/controlsmenu.js';
  document.getElementById('veil')?.remove(); document.getElementById('hangar')?.remove();
  window.testInput = new Input(window); window.testControls = new ControlsMenu(testInput); testControls.show();
`}));
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS '+name); };
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('raptor.settings.v1')));
const slider = async (key, value) => page.locator(`[data-setting="${key}"]`).evaluate((el, value) => {el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}, value);
const map = code => page.locator(`[data-map-key="${code}"]`);
try {
  await page.goto(origin, {waitUntil:'networkidle'});
  await page.screenshot({path:out+'01-controls-initial.png'});
  await check('presets save only the selected device and custom gain has no false selected preset', async () => {
    await page.locator('[data-device="trackpad"]').click();
    await page.locator('[data-aim-preset="precise"]').click();
    assert.equal((await saved()).trackpadSensitivity, .45);
    assert.equal((await saved()).mouseSensitivity, 1);
    await slider('trackpadSensitivity', .55);
    assert.match(await page.locator('[data-aim-preset-status]').textContent(), /Custom.*0.55/);
    assert.equal(await page.locator('[data-aim-preset][aria-pressed="true"]').count(), 0);
    await page.locator('[data-device="mouse"]').click();
    assert.equal(await page.locator('[data-aim-preset="balanced"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-aim-preset="responsive"]').click();
    await page.locator('[data-device="trackpad"]').click();
    assert.equal((await saved()).mouseSensitivity, 1.4);
    assert.equal(await page.locator('[data-setting="trackpadSensitivity"]').inputValue(), '0.55');
  });
  await check('Edit keys reaches the visual map and selected keys edit their actual action', async () => {
    await page.locator('[data-action="keys"]').click();
    assert.equal(await page.locator('.keyboard-layout').evaluate(el => el.open), true);
    await map('KeyW').click();
    assert.match(await page.locator('.layout-inspector').textContent(), /Increase throttle/);
    await page.locator('[data-layout-edit="throttle_up"]').click(); await page.keyboard.press('u');
    assert.equal(await map('KeyW').count(), 0);
    assert.match(await map('KeyU').getAttribute('aria-label'), /Increase throttle/);
    assert.equal(await page.locator('[data-layout-edit="throttle_up"]').evaluate(el => el === document.activeElement), true);
    await page.screenshot({path:out+'02-keyboard-map.png'});
    await page.locator('[data-action="undo-keys"]').click();
    assert.equal(await map('KeyW').count(), 1);
    assert.equal(await map('KeyU').count(), 0);
  });
  await check('map edits preserve conflict choices, exact alternate slots and Escape recovery', async () => {
    await map('KeyF').click();
    await page.locator('[data-layout-edit="fire_mguns"]').click(); await page.keyboard.press('g');
    assert.match(await page.locator('#conflictTitle').textContent(), /already has a job/);
    await page.locator('[data-resolve="share"]').click();
    await map('KeyG').click();
    assert.equal(await page.locator('.layout-action').count(), 2);
    await page.locator('[data-layout-edit="gear"]').click(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-layout-edit="gear"]').evaluate(el => el === document.activeElement), true);
    await map('Mouse0').click();
    assert.equal(await page.locator('[data-layout-edit="fire_mguns"]').getAttribute('data-slot'), '1');
    await page.locator('[data-layout-edit="fire_mguns"]').click(); await page.keyboard.press('j');
    assert.deepEqual(await page.evaluate(() => testInput.actions.fire_mguns.binds), [['KeyG'], ['KeyJ'], ['Digit1']]);
    await map('Escape').click();
    assert.match(await page.locator('.layout-inspector').textContent(), /Always available/);
    assert.equal(await page.locator('[data-layout-edit="menu"]').count(), 0);
  });
  await check('shortcut keys expose the complete chord without making modifiers a false action', async () => {
    await map('KeyZ').click();
    assert.match(await map('KeyZ').textContent(), /⌥ \+ Z/);
    assert.match(await page.locator('.layout-inspector').textContent(), /Left Alt \/ Option \+ Z.*hold the full shortcut/);
    await page.reload({waitUntil:'networkidle'});
    assert.match(await map('KeyJ').getAttribute('aria-label'), /Fire cannon/);
    assert.match(await page.locator('[data-aim-preset-status]').textContent(), /Custom/);
  });
  await check('the map adds an alternate without replacing the current key and reaches the searchable editor', async () => {
    await map('KeyG').click();
    await page.locator('[data-layout-add="gear"]').click(); await page.keyboard.press('k');
    assert.deepEqual(await page.evaluate(() => testInput.actions.gear.binds), [['KeyG'], ['KeyK']]);
    assert.equal(await page.locator('[data-layout-edit="gear"]').getAttribute('data-slot'), '1');
    await page.locator('[data-action="all-keys"]').click();
    assert.equal(await page.locator('#controlSearch').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-action="undo-keys"]').click();
    assert.equal(await map('KeyK').count(), 0);
  });
  await check('custom shortcuts outside the laptop map remain visible, searchable and focusable', async () => {
    await map('Backquote').click();
    await page.locator('[data-layout-edit="debug"]').click(); await page.keyboard.press('Shift+F6');
    assert.match(await page.locator('.layout-extra [data-map-key="F6"]').textContent(), /⇧ \+ F6/);
    assert.match(await page.locator('.layout-inspector').textContent(), /Left Shift \+ F6/);
    assert.equal(await page.locator('[data-layout-edit="debug"]').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-layout-edit="debug"]').click(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-layout-edit="debug"]').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-action="all-keys"]').click(); await page.locator('#controlSearch').fill('F6');
    assert.equal(await page.locator('[data-action-id]').getAttribute('data-action-id'), 'debug');
    await page.locator('[data-action="undo-keys"]').click();
    assert.equal(await map('F6').count(), 0);
    await page.locator('#controlSearch').fill('');
  });
  await check('guided pointer exercise reacts to actual motion while keyboard input remains isolated', async () => {
    await page.locator('[data-aim-preset="balanced"]').click();
    await page.locator('[data-action="test"]').click();
    await page.locator('[data-test-targets]').click();
    const preview = page.locator('.aim-test-surface');
    await preview.scrollIntoViewIfNeeded();
    const box = await preview.boundingBox();
    let x=box.x+box.width/2, y=box.y+box.height/2;
    await page.mouse.move(x,y);
    const degree = .65*.0028*180/Math.PI;
    const moves = [[6,0],[-12,0],[6,-3],[0,6],[0,-3]];
    for (let i=0;i<moves.length;i++) {
      x+=moves[i][0]/degree; y+=moves[i][1]/degree;
      await page.mouse.move(x,y,{steps:5});
      await page.waitForTimeout(410);
      assert.match(await page.locator('[data-aim-exercise-status]').textContent(), i===4 ? /Comfort check complete/ : new RegExp(`Target ${i+2} of 5`));
    }
    await page.locator('.input-test').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#testLastInput').textContent(), 'Space → Launch missile');
    assert.equal(await page.evaluate(() => testInput.edge.size), 0);
    await page.screenshot({path:out+'03-aim-comfort-check.png'});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.input-test').count(), 0);
  });
  await check('the keyboard scrolls locally on a narrow viewport without widening the dialog', async () => {
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-action="keys"]').click();
    assert.equal(await page.locator('#controls').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.setup-shell').evaluate(el => el.scrollWidth <= innerWidth), true);
    await map('KeyJ').click();
    await page.screenshot({path:out+'04-narrow-keyboard.png'});
    await page.locator('[data-layout-edit="fire_mguns"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-layout-edit="fire_mguns"]').evaluate(el => el === document.activeElement), true);
  });
  await check('all aim targets remain reachable at minimum gain on a narrow screen without pointer capture', async () => {
    await slider('trackpadSensitivity', .35);
    await page.locator('[data-action="test"]').click();
    await page.locator('[data-test-targets]').click();
    const preview = page.locator('.aim-test-surface'); await preview.scrollIntoViewIfNeeded();
    const box = await preview.boundingBox(); let x=box.x+box.width/2, y=box.y+box.height/2;
    await page.mouse.move(x,y);
    const degree=.35*.0028*180/Math.PI, moves=[[6,0],[-12,0],[6,-3],[0,6],[0,-3]];
    for (let i=0;i<moves.length;i++) {
      x+=moves[i][0]/degree; y+=moves[i][1]/degree;
      assert.ok(x>box.x && x<box.x+box.width && y>box.y && y<box.y+box.height, 'target must fit the available pointer travel');
      await page.mouse.move(x,y,{steps:5}); await page.waitForTimeout(410);
      assert.match(await page.locator('[data-aim-exercise-status]').textContent(), i===4 ? /Comfort check complete/ : new RegExp(`Target ${i+2} of 5`));
    }
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    await page.screenshot({path:out+'05-narrow-aim-check.png'});
  });
  assert.deepEqual(errors, []);
} catch (error) { await page.screenshot({path:out+'failure.png'}).catch(()=>{}); throw error; }
finally {
  await writeFile(out+'results.json', JSON.stringify({results,errors}, null, 2));
  await context.close(); await browser.close();
}

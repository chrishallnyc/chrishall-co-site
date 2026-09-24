// Controls-only interaction checks; no flight or GPU scene is booted.
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = (process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-five/controls-history/', import.meta.url).pathname).replace(/\/?$/, '/');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:process.env.HEADED !== '1'});
const context = await browser.newContext({viewport:{width:1280,height:840}});
const page = await context.newPage(), results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
// A staging directory is optional; it lets a prepared patch be exercised before
// applying it to a shared checkout. Normal runs use the server's source files.
if (process.env.RAPTOR_SOURCE_OVERRIDE) {
  for (const file of ['src/engine/input.js','src/game/controlhistory.js','src/game/controlsmenu.js','src/game/controls.css']) {
    await page.route('**/' + file, route => readFile(process.env.RAPTOR_SOURCE_OVERRIDE + '/' + file, 'utf8').then(body =>
      route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body})));
  }
}
await page.route('**/src/main.js', route => route.fulfill({contentType:'text/javascript',body:`
  import { Input } from './engine/input.js'; import { ControlsMenu } from './game/controlsmenu.js';
  document.getElementById('veil')?.remove(); document.getElementById('hangar')?.remove();
  window.testInput = new Input(window); window.testControls = new ControlsMenu(testInput); testControls.show();
`}));
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS ' + name); };
const reset = async (seed = {}) => {
  await page.evaluate(seed => { localStorage.clear(); localStorage.setItem('raptor:binds:v3', JSON.stringify(seed)); }, seed);
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-category="all"]').click();
};
const binds = id => page.evaluate(id => testInput.actions[id].binds, id);
const edit = async (id, key) => { await page.locator(`[data-bind="${id}"][data-slot="0"]`).click(); await page.keyboard.press(key); };
try {
  await page.goto(origin, {waitUntil:'networkidle'});
  await check('a key edit can be undone and the old binding persists after reload', async () => {
    await reset(); await edit('gear', 'u');
    assert.deepEqual(await binds('gear'), [['KeyU']]);
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('gear'), [['KeyG']]);
    assert.equal(await page.locator('[data-action="undo-keys"]').isDisabled(), true);
    await page.reload({waitUntil:'networkidle'});
    assert.deepEqual(await binds('gear'), [['KeyG']]);
  });
  await check('missing essential warning opens the filtered repair list and removal can be undone', async () => {
    await reset({throttle_up:[['KeyU']]});
    await page.locator('[data-remove="throttle_up"][data-slot="0"]').click();
    await page.locator('[data-action="missing"]').click();
    assert.equal(await page.locator('[data-action-id]').count(), 1);
    assert.equal(await page.locator('[data-action-id]').getAttribute('data-action-id'), 'throttle_up');
    assert.equal(await page.locator('[data-bind="throttle_up"]').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('throttle_up'), [['KeyU']]);
    assert.match(await page.locator('.setup-empty').textContent(), /Every essential action has a key/);
  });
  await check('restoring one action leaves other custom actions alone and supports undo', async () => {
    await reset({gear:[['KeyU']], help:[['KeyI']]});
    await page.locator('[data-restore-action="gear"]').click();
    assert.deepEqual(await binds('gear'), [['KeyG']]);
    assert.deepEqual(await binds('help'), [['KeyI']]);
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('gear'), [['KeyU']]);
  });
  await check('restoring occupied defaults explains the affected actions and cancel changes nothing', async () => {
    await reset({gear:[], fire_aam:[['KeyG']]});
    await page.locator('[data-restore-action="gear"]').click();
    assert.match(await page.locator('#restoreTitle').textContent(), /Landing gear/);
    assert.match(await page.locator('.conflict-caution').textContent(), /Launch missile.*without a key/);
    assert.deepEqual(await binds('gear'), []);
    assert.deepEqual(await binds('fire_aam'), [['KeyG']]);
    await page.screenshot({path:out+'01-restore-conflict.png',fullPage:true});
    await page.locator('[data-restore-choice="cancel"]').click();
    assert.deepEqual(await binds('gear'), []);
    assert.deepEqual(await binds('fire_aam'), [['KeyG']]);
    assert.equal(await page.locator('[data-restore-action="gear"]').evaluate(el => el === document.activeElement), true);
  });
  await check('confirmed default restoration moves keys explicitly and undo restores both actions', async () => {
    await page.locator('[data-restore-action="gear"]').click();
    await page.locator('[data-restore-choice="move"]').click();
    assert.deepEqual(await binds('gear'), [['KeyG']]);
    assert.deepEqual(await binds('fire_aam'), []);
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('gear'), []);
    assert.deepEqual(await binds('fire_aam'), [['KeyG']]);
  });
  await check('Escape cancels action restore without closing setup or losing an earlier undo step', async () => {
    await reset({gear:[], fire_aam:[['KeyG']]});
    await edit('help', 'u');
    await page.locator('[data-restore-action="gear"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => testControls.open), true);
    assert.equal(await page.locator('#restoreTitle').count(), 0);
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('help'), [['KeyH'], ['F1']]);
  });
  await check('safe test retains a quick tap result while live held feedback clears', async () => {
    await reset();
    await page.locator('[data-action="test"]').click();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#testLastInput').textContent(), 'Space → Launch missile');
    assert.match(await page.locator('#testActions').textContent(), /No keys held/);
    assert.equal(await page.evaluate(() => testInput.edge.size), 0);
    await page.locator('[data-device="trackpad"]').click();
    assert.equal(await page.locator('#testLastInput').textContent(), 'Space → Launch missile');
    await page.screenshot({path:out+'02-retained-test-result.png',fullPage:true});
    await page.keyboard.press('Escape');
  });
  await check('search and missing filter coexist, and the public repair action focuses a missing key', async () => {
    await reset({fire_mguns:[]});
    await page.evaluate(() => testControls.showMissingControls());
    assert.equal(await page.locator('[data-action-id]').count(), 1);
    assert.equal(await page.locator('[data-bind="fire_mguns"]').evaluate(el => el === document.activeElement), true);
    await page.locator('#controlSearch').fill('landing');
    assert.equal(await page.locator('[data-action-id]').getAttribute('data-action-id'), 'gear');
    await page.locator('#controlSearch').fill('');
    await page.locator('[data-restore-action="fire_mguns"]').click();
    assert.equal(await page.locator('[data-action-id]').count(), 0);
    assert.match(await page.locator('.setup-empty').textContent(), /Every essential action has a key/);
  });
  await check('Undo and restore affordances fit the narrow controls layout', async () => {
    await reset({throttle_up:[['KeyU']], fire_mguns:[]});
    await page.setViewportSize({width:390,height:844});
    await edit('throttle_up', 'i');
    assert.equal(await page.evaluate(() => document.querySelector('#controls').scrollWidth <= 390), true);
    assert.equal(await page.locator('[data-action="undo-keys"]').isEnabled(), true);
    await page.screenshot({path:out+'03-narrow-controls.png',fullPage:true});
    await page.locator('[data-action="undo-keys"]').click();
    assert.deepEqual(await binds('throttle_up'), [['KeyU']]);
  });
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error); process.exitCode = 1;
  await page.screenshot({path:out+'failure.png',fullPage:true});
} finally {
  await writeFile(out+'results.json', JSON.stringify({results,errors}, null, 2));
  await context.close(); await browser.close();
}

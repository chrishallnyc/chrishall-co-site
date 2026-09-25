// Real flight/menu boundaries. Mission outcomes are not fabricated here.
import {pathToFileURL} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
const backend = process.env.RAPTOR_TEST_BACKEND || 'webgl';
const out = (process.env.RAPTOR_TEST_OUTPUT || '.context/raptor-tactical/').replace(/\/?$/, '/');
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
await context.addInitScript(() => {
  localStorage.setItem('raptor:quality:v1', 'LOW');
  localStorage.setItem('raptor.settings.v1', JSON.stringify({tier: 'LOW', muted: true, motionReduce: true}));
});
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(20000);
const check = async (name, fn) => {await fn(); checks.push(name); console.log('PASS ' + name);};
const boot = async query => {
  await page.goto(origin + query + (backend === 'webgl' ? '&gl=1' : ''), {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__RAPTOR?.ready || window.__RAPTOR?.failure, null, {timeout: 180000});
  assert.equal(await page.evaluate(() => __RAPTOR.failure), null);
  assert.equal(await page.evaluate(() => __RAPTOR.backend), backend);
  await page.waitForSelector('#veil', {state: 'detached'});
  if (await page.locator('.pause-dialog[open]').count()) await page.locator('[data-resume]').click();
  await page.waitForFunction(() => __RAPTOR.sim.time > .25 && !__RAPTOR.paused);
};
const snapshot = () => page.evaluate(() => ({
  time: __RAPTOR.sim.time, position: Array.from(__RAPTOR.player.fm.state),
  gun: __RAPTOR.player.gun.ammo, missiles: __RAPTOR.player.missiles.ammo,
  objectives: Array.from(__RAPTOR.script?.objState || []),
  progress: localStorage.getItem('raptor.auth.v1'),
}));
const openMap = async () => {await page.keyboard.press('m'); await page.waitForSelector('.tactical-dialog[open]');};
const resume = async () => {await page.locator('[data-tactical-resume]').click(); await page.waitForFunction(() => !__RAPTOR.paused);};
try {
  await boot('?sortie=N01&front=NELLIS');
  await check('M opens a real campaign chart and freezes simulation, weapons and progress', async () => {
    await openMap();
    assert.equal(await page.evaluate(() => __RAPTOR.input.suspended), true);
    assert.equal(await page.locator('.tactical-chart svg[role="img"]').count(), 1);
    assert.match(await page.locator('.tactical-airfield').textContent(), /HDG \d{3}°/);
    assert.ok(await page.locator('.tactical-objective').count());
    assert.ok(await page.locator('.tactical-radio li').count());
    const before = await snapshot();
    await page.keyboard.down('w'); await page.keyboard.down('f'); await page.keyboard.press('Space');
    await page.waitForTimeout(450); await page.keyboard.up('w'); await page.keyboard.up('f');
    assert.deepEqual(await snapshot(), before);
    await page.screenshot({path: out + 'tactical-campaign.png'});
  });
  await check('map shortcut closes back to flight without replaying held controls', async () => {
    await page.keyboard.press('m'); await page.waitForFunction(() => !__RAPTOR.paused);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
    assert.equal(await page.evaluate(() => __RAPTOR.input.held('fire_mguns')), false);
    assert.equal(await page.evaluate(() => __RAPTOR.player.input?.fireGun || false), false);
  });
  await check('map opened from Pause returns to Pause, while Resume explicitly flies', async () => {
    await page.keyboard.press('Escape'); await page.waitForSelector('.pause-dialog[open]');
    await page.locator('[data-tactical]').click(); await page.waitForSelector('.tactical-dialog[open]');
    assert.equal(await page.locator('.pause-dialog[open]').count(), 0);
    await page.keyboard.press('Escape'); await page.waitForSelector('.pause-dialog[open]');
    assert.equal(await page.evaluate(() => __RAPTOR.paused), true);
    await page.locator('[data-tactical]').click(); await page.waitForSelector('.tactical-dialog[open]');
    await resume();
    assert.equal(await page.locator('dialog[open]').count(), 0);
  });
  await check('radio history shows full received text and stays unchanged while paused', async () => {
    await openMap();
    const rows = await page.evaluate(() => __RAPTOR.script.readComms().filter(c => __RAPTOR.missionData.lines[c.lineId]));
    const received = await page.evaluate(() => __RAPTOR.missionData.lines[__RAPTOR.script.readComms()[0].lineId]);
    assert.equal(await page.locator('.tactical-radio li').count(), rows.length);
    assert.equal(await page.locator('.tactical-radio li p').first().textContent(), received);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.tactical-radio li p').first().textContent(), received);
  });
  await check('chart, full radio text and resume remain accessible on narrow screens', async () => {
    await page.setViewportSize({width: 390, height: 720});
    await page.waitForTimeout(100);
    for (const selector of ['.tactical-dialog', '.tactical-chart', '.tactical-radio']) {
      assert.equal(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth), true, selector);
    }
    const svg = await page.locator('.tactical-chart svg').boundingBox();
    assert.ok(svg.x >= 0 && svg.x + svg.width <= 390);
    await page.screenshot({path: out + 'tactical-narrow.png'});
    await page.locator('.tactical-radio').scrollIntoViewIfNeeded();
    await page.screenshot({path: out + 'radio-narrow.png'});
    await resume();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
    await page.setViewportSize({width: 1440, height: 1000});
  });
  await check('custom map controls update labels and ignore the previous shortcut', async () => {
    assert.equal(await page.evaluate(() => __RAPTOR.input.setBinding('map', 0, ['KeyJ'])), true);
    assert.match(await page.locator('[data-flight-action="map"]').textContent(), /J/);
    await page.keyboard.press('m'); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => __RAPTOR.paused), false);
    await page.keyboard.press('j'); await page.waitForSelector('.tactical-dialog[open]');
    await page.keyboard.press('j'); await page.waitForFunction(() => !__RAPTOR.paused);
    assert.equal(await page.evaluate(() => __RAPTOR.input.setBinding('map', 0, ['AltLeft', 'KeyJ'])), true);
    await page.keyboard.press('Alt+j'); await page.waitForSelector('.tactical-dialog[open]');
    await page.keyboard.press('Alt+j'); await page.waitForFunction(() => !__RAPTOR.paused);
  });
  await check('live radio subtitles wrap inside the real HUD at maximum size', async () => {
    // Freeze only presentation while changing viewport sizes. The received
    // message remains Script's actual first call; no future radio is injected.
    await page.evaluate(async () => {
      const s = __RAPTOR; s.sim.timescale = 0;
      const settings = await import('./src/game/settings.js');
      settings.saveSettings({subtitleScale: 1.6, hudScale: 1.4});
      // Previous checks may outlast the subtitle. Reuse its original time to
      // exercise its layout; restore the clock before the next flight.
      window.__radioTime = s.sim.time; s.sim.time = s.script.readComms()[0].t;
      const ctx = s.hud.ctx, draw = ctx.fillText, layer = s.hud.arcadeLayer;
      ctx.fillText = function(text, x, y, ...args) {
        if (this.textBaseline === 'top') window.__radioInk.push({text, x, y, width: this.measureText(text).width, font: this.font});
        return draw.call(this, text, x, y, ...args);
      };
      s.hud.arcadeLayer = function(...args) {window.__radioInk = []; return layer.apply(this, args);};
    });
    for (const [width, height] of [[1280, 800], [390, 720]]) {
      await page.setViewportSize({width, height});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => window.__radioInk?.some(row => row.text.startsWith('» ')));
      const lines = await page.evaluate(() => __radioInk);
      assert.ok(lines.length > 1, 'actual long call wraps');
      for (const line of lines) {
        assert.ok(line.x >= 0 && line.x + line.width <= width, JSON.stringify(line));
        assert.ok(line.y >= 0 && line.y + 20 < height - 108 * 1.4, JSON.stringify(line));
      }
      await page.screenshot({path: out + `radio-${width}.png`});
    }
    await page.evaluate(() => {
      const s = __RAPTOR, p = s.player.fm.state;
      s.battlefield.samLive[0] = 1;
      s.battlefield.sam.set([p[0] - 500, p[1] + 200, p[2], 400, -120, 0, 1, 100, 0, 0, 0]);
    });
    await page.waitForFunction(() => __radioInk.length === 0);
    await page.evaluate(() => __RAPTOR.battlefield.samLive.fill(0));
    await page.waitForFunction(() => __radioInk.length > 0);
    await page.evaluate(() => {
      const s = __RAPTOR, af = s.match.airfield, x = af.x + 200, y = af.y;
      s.player.debugCommand({pos: {x, y, alt: Math.max(0, s.player.terrain.heightAt(x, y)) + 200, headingDeg: 0, speed: 80}});
      s.player.gun.ammo = 100;
    });
    await page.waitForFunction(() => __radioInk.length === 0);
    await page.evaluate(() => {__RAPTOR.sim.time = window.__radioTime; __RAPTOR.sim.timescale = 1;});
    await page.setViewportSize({width: 1440, height: 1000});
  });
  await boot('?mode=practice&front=VALDEZ');
  await check('practice chart has a position and honest empty mission/radio state', async () => {
    await page.locator('[data-flight-action="map"]').click(); await page.waitForSelector('.tactical-dialog[open]');
    assert.match(await page.locator('.tactical-summary').textContent(), /No mission clock/);
    assert.equal(await page.locator('.tactical-objective').count(), 0);
    assert.equal(await page.locator('.tactical-airfield').count(), 0);
    assert.match(await page.locator('.tactical-radio').textContent(), /No radio messages received/);
    await page.screenshot({path: out + 'tactical-practice.png'});
    await resume();
  });
  assert.deepEqual(errors, []);
} catch (error) {await page.screenshot({path: out + 'failure.png'}).catch(() => {}); throw error;}
finally {await writeFile(out + 'results.json', JSON.stringify({backend, checks, errors}, null, 2)); await context.close(); await browser.close();}

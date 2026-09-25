// Real browser input, rendered pixels, sound lifecycle, responsive layout and
// shell transitions. Upgrade/result fixtures below test UI and persistence;
// they do not stand in for the simulation's native full-run gameplay tests.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.RAPTOR_BASE_URL || 'http://127.0.0.1:8193/arcade/';
const url = new URL(base); url.searchParams.set('qa', '1');
const out = (process.env.RAPTOR_TEST_OUTPUT || '.context/arcade/qa').replace(/\/?$/, '/');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
const contexts = [], checks = [], errors = [], badResponses = [], metrics = {};
let activePage;

async function newPage(options = {}, prepare) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', ...options });
  contexts.push(context);
  if (prepare) await prepare(context);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({ page: page.url(), message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ page: page.url(), message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) badResponses.push({ status: response.status(), url: response.url() }); });
  activePage = page;
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__PIXEL_RAPTOR?.ready);
  return page;
}
async function check(name, kind, fn) {
  const start = performance.now();
  await fn();
  checks.push({ name, kind, milliseconds: Math.round(performance.now() - start) });
  console.log('PASS ' + name);
}
const shot = (page, name) => page.screenshot({ path: out + name + '.png', fullPage: true });
const view = (page, expected) => page.waitForFunction(value => __PIXEL_RAPTOR.view === value, expected);
const snapshot = page => page.evaluate(() => __PIXEL_RAPTOR.snapshot);
const extraSizes = [[844, 390], [600, 800], [600, 450]];
async function launch(page) { await page.locator('#launch').click(); await view(page, 'playing'); }
async function freshLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function arenaPoint(page, x, y) {
  return page.locator('#game').evaluate((canvas, point) => {
    const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / 640, rect.height / 400);
    return { x: rect.left + (rect.width - 640 * scale) / 2 + point.x * scale,
      y: rect.top + (rect.height - 400 * scale) / 2 + point.y * scale };
  }, { x, y });
}
async function overlayFits(page, panel, label) {
  const bounds = await page.locator(panel).evaluate(element => {
    const box = element.getBoundingClientRect(), parent = document.querySelector('#screen').getBoundingClientRect();
    return { top: box.top, left: box.left, bottom: box.bottom, right: box.right,
      parentTop: parent.top, parentLeft: parent.left, parentBottom: parent.bottom, parentRight: parent.right,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(bounds.horizontalOverflow, false, label + ': no horizontal overflow');
  assert.ok(bounds.top >= bounds.parentTop - 1 && bounds.bottom <= bounds.parentBottom + 1,
    label + ': the complete panel fits vertically inside the game screen');
  assert.ok(bounds.left >= bounds.parentLeft - 1 && bounds.right <= bounds.parentRight + 1,
    label + ': the complete panel fits horizontally inside the game screen');
}
async function fixture(page, phase, score, time) {
  await page.evaluate(({ phase, score, time }) => {
    const s = __PIXEL_RAPTOR.getState();
    s.phase = phase; s.score = score; s.time = time; s.kills = Math.floor(score / 100);
    s.boss = null; s.enemies.length = 0; s.bullets.length = 0; s.telegraphs.length = 0;
    if (phase === 'lost') s.player.hp = 0;
    s._queuedEvents.push({ type: phase === 'won' ? 'win' : phase === 'lost' ? 'lose' : 'stage', stage: s.stage });
  }, { phase, score, time });
  await view(page, phase === 'upgrade' ? 'upgrade' : 'result');
}

try {
  const page = await newPage();
  await check('title offers one launch action and does not start audio before a gesture', 'real browser', async () => {
    assert.equal(await page.locator('#title-screen .primary:visible').count(), 1);
    assert.equal(await page.locator('#launch').isEnabled(), true);
    assert.match(await page.locator('#launch').textContent(), /Take flight/);
    assert.equal(await page.locator('#title-best').textContent(), '000000');
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.view), 'title');
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.getAudio().state), 'uninitialized');
    await shot(page, '01-title-desktop');
  });

  await check('all three previews render visibly different original scenery', 'rendered pixels', async () => {
    const colors = [];
    for (let stage = 0; stage < 3; stage++) {
      await page.locator(`[data-preview="${stage}"]`).click();
      await page.waitForTimeout(90);
      assert.equal(await page.locator('[data-preview][aria-pressed="true"]').count(), 1);
      const color = await page.locator('#game').evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, 640, 400).data;
        const sums = [0, 0, 0]; let samples = 0, distinct = new Set();
        for (let y = 0; y < 400; y += 8) for (let x = 0; x < 640; x += 8) {
          const i = (y * 640 + x) * 4;
          for (let c = 0; c < 3; c++) sums[c] += data[i + c];
          distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`); samples++;
        }
        return { mean: sums.map(value => value / samples), distinct: distinct.size };
      });
      assert.ok(color.distinct > 25, `stage ${stage} has richly painted scenery`);
      colors.push(color);
      await shot(page, `02-preview-${stage + 1}`);
    }
    for (let a = 0; a < colors.length; a++) for (let b = a + 1; b < colors.length; b++) {
      assert.ok(Math.hypot(...colors[a].mean.map((value, i) => value - colors[b].mean[i])) > 15,
        `stages ${a + 1} and ${b + 1} have distinct scene palettes`);
    }
    metrics.previewColors = colors;
    await page.locator('[data-preview="0"]').click();
  });

  await check('phone, landscape and tablet openings keep launch, setup and region choices separate', 'responsive layout', async () => {
    for (const [width, height] of [[390, 844], [320, 740], ...extraSizes]) {
      await freshLayout(page, width, height);
      const bounds = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
          launch: rect('#launch'), difficulty: rect('.difficulty'), note: rect('#difficulty-note'), route: rect('.route'), screen: rect('#screen') };
      });
      assert.equal(bounds.overflow, false, `${width}px has no horizontal overflow`);
      assert.ok(bounds.launch.x >= 0 && bounds.launch.right <= width && bounds.launch.bottom <= height, 'launch stays visible');
      assert.ok(bounds.launch.bottom <= bounds.difficulty.y + 1, 'launch and difficulty do not overlap');
      assert.ok(bounds.difficulty.bottom <= bounds.note.y + 1, 'difficulty and its explanation do not overlap');
      assert.ok(bounds.note.bottom + 5 <= bounds.route.y, 'setup copy does not collide with the region selector');
      assert.ok(bounds.route.bottom <= bounds.screen.bottom + 1, 'region selector stays inside its screen');
      const canvasShape = await page.locator('#game').evaluate(canvas => {
        const rect = canvas.getBoundingClientRect();
        return { fit: getComputedStyle(canvas).objectFit, aspect: rect.width / rect.height };
      });
      if (canvasShape.fit === 'fill') assert.ok(Math.abs(canvasShape.aspect - 1.6) < .012, `${width}x${height} preserves the arena aspect ratio`);
      await shot(page, `03-title-${width}x${height}`);
    }
    await freshLayout(page, 1440, 960);
  });

  await check('the short flight manual opens, closes and restores keyboard focus', 'real browser', async () => {
    await page.locator('#help').click();
    assert.equal(await page.locator('#help-dialog').evaluate(dialog => dialog.open), true);
    assert.match(await page.locator('#help-dialog').textContent(), /Cannons fire automatically/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#help-dialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'help');
  });

  await check('one click launches live flight and a real running Web Audio score', 'real browser', async () => {
    await page.locator('[data-difficulty="relaxed"]').click();
    await launch(page);
    await page.waitForFunction(() => __PIXEL_RAPTOR.getAudio().state === 'running' && __PIXEL_RAPTOR.getAudio().voices > 0);
    const sound = await page.evaluate(() => __PIXEL_RAPTOR.getAudio());
    assert.equal(sound.muted, false); assert.equal(sound.musicActive, true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
    assert.equal((await snapshot(page)).player.maxHp, 8);
    assert.equal(await page.locator('#flight-hud').isVisible(), true);
    assert.equal(await page.locator('#title-screen').isVisible(), false);
  });

  await check('keyboard flight, Space missiles and Shift dodge reach the live simulation', 'real gameplay input', async () => {
    const before = await snapshot(page);
    await page.keyboard.down('d'); await page.waitForTimeout(260); await page.keyboard.up('d');
    assert.ok((await snapshot(page)).player.x > before.player.x + 25, 'D moves the actual ship right');
    await page.keyboard.down('a'); await page.waitForTimeout(250); await page.keyboard.up('a');
    await page.keyboard.press('Space', { delay: 50 });
    await page.waitForFunction(() => __PIXEL_RAPTOR.snapshot.player.missileCooldown > 5);
    await page.keyboard.press('Shift', { delay: 50 });
    await page.waitForFunction(() => __PIXEL_RAPTOR.snapshot.player.rollCooldown > 2);
    assert.equal(await page.locator('#missile').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('#roll').getAttribute('aria-disabled'), 'true');
    assert.ok(await page.evaluate(() => __PIXEL_RAPTOR.getState().shots > 2), 'auto cannons fire without a fire button');
    await shot(page, '04-live-flight');
  });

  await check('real pointer aiming and automatic cannons destroy a normal arriving enemy', 'real gameplay input; no simulation mutation', async () => {
    await page.waitForFunction(() => !__PIXEL_RAPTOR.getState().bullets.some(bullet => bullet.kind === 'missile'), null, { timeout: 6000 });
    const before = await snapshot(page), deadline = Date.now() + 16000;
    const position = await arenaPoint(page, before.player.x, before.player.y);
    await page.mouse.move(position.x, position.y); await page.mouse.down();
    while (Date.now() < deadline && (await snapshot(page)).kills <= before.kills) {
      const target = await page.evaluate(() => {
        const s = __PIXEL_RAPTOR.getState();
        const enemy = s.enemies.filter(e => e.hp > 0 && e.y > 5 && e.y < 240).sort((a, b) => Math.abs(a.x - s.player.x) - Math.abs(b.x - s.player.x))[0];
        return enemy ? { x: enemy.x, y: 325 } : null;
      });
      if (target) { const point = await arenaPoint(page, target.x, target.y); await page.mouse.move(point.x, point.y, { steps: 3 }); }
      await page.waitForTimeout(150);
    }
    await page.mouse.up();
    const after = await snapshot(page);
    assert.ok(after.kills > before.kills, 'normal gameplay produces a kill');
    assert.ok(after.score > before.score, 'normal gameplay awards score');
    assert.ok(after.player.hp > 0);
    metrics.realFlight = { seconds: after.time, kills: after.kills, score: after.score };
    await shot(page, '05-earned-score');
  });

  await check('pause and loss of focus freeze simulation and stop the looping score', 'real browser lifecycle', async () => {
    await page.keyboard.press('Escape'); await view(page, 'pause');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'resume');
    const pausedTime = (await snapshot(page)).time;
    await page.waitForTimeout(250);
    assert.equal((await snapshot(page)).time, pausedTime);
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.getAudio().musicActive), false);
    for (const [width, height] of extraSizes) {
      await freshLayout(page, width, height);
      await overlayFits(page, '#pause-screen .menu-panel', `pause ${width}x${height}`);
      await shot(page, `04-pause-${width}x${height}`);
    }
    await freshLayout(page, 1440, 960);
    await page.locator('#resume').click(); await view(page, 'playing');
    await page.waitForFunction(time => __PIXEL_RAPTOR.snapshot.time > time + .1, pausedTime);
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await view(page, 'pause');
    const blurTime = (await snapshot(page)).time; await page.waitForTimeout(180);
    assert.equal((await snapshot(page)).time, blurTime);
    await page.locator('#resume').click(); await view(page, 'playing');
  });

  await check('standard controller Start toggles pause once per press', 'controlled navigator input; real game routing', async () => {
    await page.evaluate(() => {
      window.__testPad = { connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__testPad] });
      window.__testPad.buttons[9].pressed = true;
    });
    await view(page, 'pause'); await page.waitForTimeout(180); await view(page, 'pause');
    await page.evaluate(() => { window.__testPad.buttons[9].pressed = false; }); await page.waitForTimeout(80);
    await page.evaluate(() => { window.__testPad.buttons[9].pressed = true; }); await view(page, 'playing');
    await page.evaluate(() => { delete navigator.getGamepads; delete window.__testPad; });
  });

  await check('mute persists across reload and unmute restarts live audio without disturbing the flight', 'real browser persistence', async () => {
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.getAudio().muted), true);
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.getAudio().musicActive), false);
    await page.reload({ waitUntil: 'networkidle' }); await view(page, 'title');
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    await launch(page);
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.getAudio().voices), 0);
    await page.locator('#sound').click();
    await page.waitForFunction(() => __PIXEL_RAPTOR.getAudio().musicActive && __PIXEL_RAPTOR.getAudio().voices > 0);
    assert.equal(await page.evaluate(() => __PIXEL_RAPTOR.view), 'playing');
    const timestamps = await page.evaluate(() => new Promise(resolve => {
      const times = []; const sample = time => { times.push(time); if (times.length >= 91) resolve(times); else requestAnimationFrame(sample); }; requestAnimationFrame(sample);
    }));
    const intervals = timestamps.slice(1).map((value, i) => value - timestamps[i]).sort((a, b) => a - b);
    metrics.framePacing = { samples: intervals.length, medianMs: intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * .95)] };
    await page.locator('#pause').click();
  });

  const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await check('real touch dragging maps through portrait letterboxing and both touch abilities respond', 'real touch input', async () => {
    await launch(phone);
    const session = await phone.context().newCDPSession(phone);
    const from = await arenaPoint(phone, 320, 320), to = await arenaPoint(phone, 480, 240);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 6; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }] });
      await phone.waitForTimeout(60);
    }
    await phone.waitForTimeout(420);
    const moved = await snapshot(phone);
    assert.ok(Math.abs(moved.player.x - 480) < 10, `touch x is ${moved.player.x.toFixed(1)}, expected 480`);
    assert.ok(Math.abs(moved.player.y - 216) < 10, `touch y is ${moved.player.y.toFixed(1)}, expected finger offset at 216`);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.locator('#missile').tap(); await phone.waitForFunction(() => __PIXEL_RAPTOR.snapshot.player.missileCooldown > 5);
    await phone.locator('#roll').tap(); await phone.waitForFunction(() => __PIXEL_RAPTOR.snapshot.player.rollCooldown > 2);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(phone, '06-phone-flight');
    await session.detach(); await phone.locator('#pause').tap();
  });

  const transitions = await newPage();
  await launch(transitions);
  await check('first upgrade screen receives focus and equips the selected cannon upgrade', 'injected completion fixture; UI only', async () => {
    await fixture(transitions, 'upgrade', 8000, 65);
    assert.equal(await transitions.locator('[data-upgrade]').count(), 3);
    assert.equal(await transitions.evaluate(() => document.activeElement.dataset.upgrade), 'overdrive');
    assert.match(await transitions.locator('#next-region').textContent(), /RED CANYON/);
    const t = (await snapshot(transitions)).time; await transitions.waitForTimeout(160);
    assert.equal((await snapshot(transitions)).time, t, 'simulation waits while choosing');
    await shot(transitions, '07-upgrade');
    for (const [width, height] of extraSizes) {
      await freshLayout(transitions, width, height);
      await overlayFits(transitions, '.upgrade-panel', `upgrade ${width}x${height}`);
      await shot(transitions, `07-upgrade-${width}x${height}`);
    }
    await freshLayout(transitions, 1440, 960);
    await transitions.keyboard.press('Enter'); await view(transitions, 'playing');
    const after = await snapshot(transitions);
    assert.equal(after.stage, 1); assert.ok(after.player.fireRate > 1);
    assert.deepEqual(after.player.upgrades, ['overdrive']);
    assert.equal(await transitions.evaluate(() => document.activeElement.id), 'game');
  });

  await check('second upgrade equips rockets and final victory records a completed run once', 'injected completion fixtures; UI and storage only', async () => {
    await fixture(transitions, 'upgrade', 17000, 135);
    assert.match(await transitions.locator('#next-region').textContent(), /NEON HARBOR/);
    await transitions.locator('[data-upgrade="rockets"]').click(); await view(transitions, 'playing');
    const after = await snapshot(transitions);
    assert.equal(after.stage, 2); assert.ok(after.player.missileMax < 7);
    assert.deepEqual(after.player.upgrades, ['overdrive', 'rockets']);
    await fixture(transitions, 'won', 36000, 218);
    assert.match(await transitions.locator('#result-title').textContent(), /Ace of the skies/);
    assert.equal(await transitions.locator('#final-score').textContent(), '036000');
    assert.equal(await transitions.locator('#final-time').textContent(), '3:38');
    assert.equal(await transitions.evaluate(() => document.activeElement.id), 'retry');
    await transitions.waitForTimeout(180);
    const saved = await transitions.evaluate(() => JSON.parse(localStorage.getItem('raptor.arcade.v1')));
    assert.equal(saved.best, 36000); assert.equal(saved.runs, 1); assert.equal(saved.wins, 1);
    await shot(transitions, '08-victory');
    for (const [width, height] of extraSizes) {
      await freshLayout(transitions, width, height);
      await overlayFits(transitions, '.result-panel', `result ${width}x${height}`);
      await shot(transitions, `08-victory-${width}x${height}`);
    }
    await freshLayout(transitions, 1440, 960);
  });

  await check('replay starts fresh and a later loss preserves the personal best', 'real replay; injected defeat fixture for UI only', async () => {
    await transitions.locator('#retry').click(); await view(transitions, 'playing');
    const reset = await snapshot(transitions);
    assert.equal(reset.stage, 0); assert.equal(reset.score, 0); assert.equal(reset.kills, 0);
    assert.ok(reset.time < 1); assert.equal(reset.player.hp, reset.player.maxHp);
    assert.deepEqual(reset.player.upgrades, []); assert.equal(reset.player.missileMax, 7);
    await fixture(transitions, 'lost', 7000, 62);
    assert.match(await transitions.locator('#result-title').textContent(), /One more flight/);
    assert.equal(await transitions.locator('#final-time').textContent(), '1:02');
    const saved = await transitions.evaluate(() => JSON.parse(localStorage.getItem('raptor.arcade.v1')));
    assert.equal(saved.best, 36000); assert.equal(saved.runs, 2); assert.equal(saved.wins, 1);
    await shot(transitions, '09-defeat');
    await transitions.locator('#back-title').click(); await view(transitions, 'title');
    assert.equal(await transitions.locator('#title-best').textContent(), '036000');
    await transitions.reload({ waitUntil: 'networkidle' }); await view(transitions, 'title');
    assert.equal(await transitions.locator('#title-best').textContent(), '036000');
  });

  if (process.env.RAPTOR_FULL_FLIGHT === '1') {
    const flight = await newPage();
    await check('a full relaxed campaign earns all three boss kills and victory through real browser controls', 'real full flight; no state mutation or accelerated simulation', async () => {
      await flight.locator('[data-difficulty="relaxed"]').click();
      await launch(flight);
      const began = performance.now(), stages = new Set(), bosses = new Set(), patterns = new Set(), celebrations = new Set();
      const upgrades = [], timeline = [];
      let dragging = false, logAt = 0, lastState;
      while (performance.now() - began < 420000) {
        const current = await flight.evaluate(() => {
          const s = __PIXEL_RAPTOR.getState(), p = s.player;
          const targets = s.enemies.filter(e => e.hp > 0 && e.y > 0 && e.y < p.y - 45)
            .sort((a, b) => (b.kind === 'boss') - (a.kind === 'boss') || b.y - a.y);
          const target = targets[0], pickup = s.pickups.find(item => item.kind === 'power' || item.kind === 'repair');
          return { view: __PIXEL_RAPTOR.view, phase: s.phase, stage: s.stage, time: s.time, stageTime: s.stageTime,
            score: s.score, kills: s.kills, shots: s.shots, damageTaken: s.damageTaken, player: { ...p }, stageCleared: !!s.stageCleared,
            boss: s.boss ? { type: s.boss.bossType, name: s.boss.name, hp: s.boss.hp, maxHp: s.boss.maxHp, age: s.boss.age, pattern: s.boss.pattern } : null,
            targetX: Math.max(22, Math.min(618, pickup?.x ?? (target ? target.x + target.vx * .25 : 320))),
            targetY: Math.max(28, Math.min(376, pickup ? Math.max(240, pickup.y) : 320)),
            missile: p.missileCooldown <= 0 && s.enemies.some(e => e.hp > 0 && e.y > 0),
            roll: p.rollCooldown <= 0 && s.bullets.some(b => b.side === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 50) };
        });
        lastState = current;
        if (current.time >= logAt) {
          const progress = { seconds: +current.time.toFixed(1), stage: current.stage + 1, hp: current.player.hp, score: current.score, kills: current.kills,
            boss: current.boss ? `${current.boss.name} ${Math.max(0, Math.ceil(current.boss.hp))}/${current.boss.maxHp}` : null };
          timeline.push(progress); console.log('FLIGHT ' + JSON.stringify(progress)); logAt += 20;
        }
        if (current.phase === 'lost' || current.phase === 'won') break;
        if (current.view === 'upgrade') {
          if (dragging) { await flight.mouse.up(); dragging = false; }
          await shot(flight, `flight-sector-${current.stage + 1}-cleared`);
          const choice = current.stage === 0 ? 'overdrive' : 'rockets';
          await flight.locator(`[data-upgrade="${choice}"]`).click();
          await view(flight, 'playing'); upgrades.push(choice); continue;
        }
        assert.equal(current.view, 'playing', 'full flight has not unexpectedly paused');
        if (!stages.has(current.stage) && current.stageTime > 7) {
          stages.add(current.stage); await shot(flight, `flight-stage-${current.stage + 1}`);
        }
        if (current.boss) {
          patterns.add(current.boss.pattern);
          if (!bosses.has(current.boss.type) && current.boss.age > 4 && current.boss.hp > 0) {
            bosses.add(current.boss.type); await shot(flight, `flight-boss-${current.stage + 1}`);
          }
        }
        if (current.stageCleared && !celebrations.has(current.stage)) {
          celebrations.add(current.stage); await shot(flight, `flight-celebration-${current.stage + 1}`);
        }
        if (!dragging) {
          const at = await arenaPoint(flight, current.player.x, current.player.y);
          await flight.mouse.move(at.x, at.y); await flight.mouse.down(); dragging = true;
        }
        const target = await arenaPoint(flight, current.targetX, current.targetY);
        await flight.mouse.move(target.x, target.y);
        if (current.missile) await flight.keyboard.press('Space', { delay: 35 });
        if (current.roll) await flight.keyboard.press('Shift', { delay: 35 });
        await flight.waitForTimeout(18);
      }
      if (dragging) await flight.mouse.up();
      await shot(flight, lastState?.phase === 'won' ? 'flight-earned-victory' : 'flight-ended');
      metrics.fullFlight = { difficulty: 'relaxed', simulationSeconds: lastState?.time, wallSeconds: (performance.now() - began) / 1000,
        phase: lastState?.phase, score: lastState?.score, kills: lastState?.kills, damageTaken: lastState?.damageTaken,
        hp: lastState?.player.hp, maxHp: lastState?.player.maxHp, weapon: lastState?.player.weapon, upgrades,
        bosses: [...bosses], patterns: [...patterns], celebrations: [...celebrations], timeline };
      assert.equal(lastState?.phase, 'won', 'a mortal player wins through normal controls');
      assert.deepEqual(upgrades, ['overdrive', 'rockets']);
      assert.deepEqual([...bosses], ['carrier', 'mantis', 'leviathan']);
      assert.deepEqual([...celebrations], [0, 1, 2]);
      assert.ok(lastState.time > 180 && lastState.time < 360);
      assert.ok(lastState.player.hp > 0 && lastState.player.weapon === 3);
      assert.ok(lastState.score > 30000 && lastState.kills > 90);
      await view(flight, 'result');
      assert.equal(await flight.locator('#final-score').textContent(), String(Math.floor(lastState.score)).padStart(6, '0'));
      const saved = await flight.evaluate(() => JSON.parse(localStorage.getItem('raptor.arcade.v1')));
      assert.equal(saved.wins, 1); assert.equal(saved.runs, 1); assert.equal(saved.best, lastState.score);
    });
  }

  await check('valid JSON with corrupt preference types safely boots and records exactly one run', 'corrupt storage fixture', async () => {
    const corrupt = await newPage({}, context => context.addInitScript(() => {
      localStorage.setItem('raptor.arcade.v1', JSON.stringify({ reduced: { toString: null, valueOf: null },
        runs: { toString: null, valueOf: null }, wins: [], muted: 'false', best: -1, difficulty: 'unknown' }));
    }));
    assert.equal(await corrupt.locator('#title-best').textContent(), '000000');
    assert.equal(await corrupt.locator('#sound').getAttribute('aria-pressed'), 'true');
    await launch(corrupt); await fixture(corrupt, 'lost', 1100, 18);
    const stored = await corrupt.evaluate(() => JSON.parse(localStorage.getItem('raptor.arcade.v1')));
    assert.equal(stored.runs, 1); assert.equal(stored.wins, 0); assert.equal(stored.best, 1100);
    assert.equal(stored.muted, false); assert.equal(stored.reduced, null); assert.equal(stored.difficulty, 'arcade');
  });

  await check('invalid preference JSON recovers without preventing launch or saving a fresh result', 'corrupt storage fixture', async () => {
    const invalid = await newPage({}, context => context.addInitScript(() => { localStorage.setItem('raptor.arcade.v1', '{not valid json'); }));
    assert.equal(await invalid.locator('#launch').isEnabled(), true);
    await launch(invalid); await fixture(invalid, 'lost', 1200, 19);
    const stored = await invalid.evaluate(() => JSON.parse(localStorage.getItem('raptor.arcade.v1')));
    assert.equal(stored.runs, 1); assert.equal(stored.best, 1200);
    assert.doesNotMatch(await invalid.locator('#new-best').textContent(), /STORAGE UNAVAILABLE/);
  });

  await check('unavailable browser storage still permits flight, results and a session best', 'unavailable storage fixture', async () => {
    const unavailable = await newPage({}, context => context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage disabled by regression fixture', 'SecurityError'); } });
    }));
    await launch(unavailable); await fixture(unavailable, 'lost', 1300, 20);
    assert.match(await unavailable.locator('#new-best').textContent(), /SESSION BEST.*STORAGE UNAVAILABLE/);
    await unavailable.locator('#back-title').click(); await view(unavailable, 'title');
    assert.equal(await unavailable.locator('#title-best').textContent(), '001300');
  });

  await check('all exercised screens load without uncaught errors or failed resources', 'integration health', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
    assert.equal(metrics.framePacing.samples, 90);
  });
} catch (error) {
  process.exitCode = 1;
  console.error(error);
  metrics.failure = { name: error.name, message: error.message, stack: error.stack };
  if (activePage) await shot(activePage, 'failure').catch(() => {});
} finally {
  await writeFile(out + 'results.json', JSON.stringify({ passed: checks.length, checks, errors, badResponses, metrics,
    note: 'Keyboard, pointer, touch, cannon kills and abilities use normal browser input. Controller navigation uses a navigator fixture. Injected upgrade, victory and defeat checks cover UI/persistence only. '
      + (metrics.fullFlight ? 'The optional full browser flight separately uses only real pointer/keyboard input and upgrade button clicks, without simulation mutation or accelerated time; its earned outcome is recorded in metrics.fullFlight.'
        : 'Full-run native simulation tests validate campaign completion separately; RAPTOR_FULL_FLIGHT=1 also exercises an earned complete campaign through real browser controls.') }, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}

// Visual keyboard UX regression: a fresh browser profile and the real controls
// component, before renderer boot. No flight scene, account or GPU is required.
// PLAYWRIGHT_MODULE can point to the existing QA installation on this machine.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const out = (process.env.RAPTOR_TEST_OUTPUT || new URL('../../.context/raptor-keyboard/workshop/', import.meta.url).pathname).replace(/\/?$/, '/');
const origin = process.env.RAPTOR_BASE_URL || 'http://localhost:8082/';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(process.env.RAPTOR_RECORD === '1' ? { recordVideo: { dir: out, size: { width: 1280, height: 900 } } } : {}) });
const page = await context.newPage(), results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: `
  import { Input } from './engine/input.js'; import { ControlsMenu } from './game/controlsmenu.js';
  document.getElementById('veil')?.remove(); document.getElementById('hangar')?.remove();
  window.testInput = new Input(window); window.testControls = new ControlsMenu(testInput); testControls.show();
` }));
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS ' + name); };
const map = code => page.locator(`[data-map-key="${code}"]`);
const bindings = id => page.evaluate(id => testInput.actions[id].binds, id);
const layout = () => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(testInput.actions).map(([id, action]) => [id, action.binds]))));
const focused = locator => locator.evaluate(el => el === document.activeElement);
const undo = () => page.locator('[data-action="undo-keys"]').click();
const assign = async (code, id) => {
  await map(code).click();
  const picker = page.locator('details.map-assign');
  if (await picker.count() && !await picker.evaluate(el => el.open)) await picker.locator('summary').click();
  await page.locator('#mapAssignAction').selectOption(id);
  await page.locator('[data-map-assign]').click();
};
const edit = async (code, id, key) => {
  await map(code).click();
  await page.locator(`[data-layout-edit="${id}"]`).first().click();
  await page.keyboard.press(key);
};
const startRehearsal = async () => {
  const button = page.locator('[data-map-test]');
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await page.locator('.keyboard-stage').focus();
  assert.equal(await focused(page.locator('.keyboard-stage')), true);
};
const endRehearsal = async () => {
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-map-test]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => testControls.open), true);
};
const screenshot = async name => {
  await page.locator('.keyboard-layout > summary').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: out + name });
};
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('[data-action="keys"]').click();

  await check('the full keyboard is recognizable, with real modifier positions and an inverted-T arrow cluster', async () => {
    for (const code of ['Escape', 'F1', 'F12', 'Backquote', 'Backspace', 'Tab', 'CapsLock', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Space', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash']) {
      assert.equal(await map(code).count(), 1, code + ' must have one physical key');
      assert.ok(await map(code).getAttribute('aria-label'), code + ' must have an accessible name');
    }
    const boxes = await Promise.all(['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'].map(code => map(code).boundingBox()));
    const [left, up, down, right] = boxes;
    assert.ok(boxes.every(Boolean), 'all arrow keys should be rendered');
    assert.ok(up.y < down.y && left.x < down.x && down.x < right.x, 'arrows must form an inverted T');
    assert.ok(Math.abs((up.x + up.width / 2) - (down.x + down.width / 2)) < 3, 'up and down share a column');
    assert.ok(Math.abs(left.y - right.y) < 3, 'left and right share a row');
    assert.equal(await map('KeyJ').isEnabled(), true, 'an unused physical key is actionable');
    assert.match(await page.locator('.keyboard-layout').textContent(), /QWERTY|physical/i);
    await screenshot('01-recognizable-keyboard.png');
  });

  await check('an empty key adds an alternate, Undo restores the prior layout, and saved bindings survive reload', async () => {
    const before = await bindings('gear');
    await assign('KeyJ', 'gear');
    assert.deepEqual(await bindings('gear'), [...before, ['KeyJ']]);
    assert.match(await map('KeyJ').getAttribute('aria-label'), /Landing gear/);
    await undo();
    assert.deepEqual(await bindings('gear'), before);
    assert.doesNotMatch(await map('KeyJ').getAttribute('aria-label'), /Landing gear/);
    await assign('KeyJ', 'gear');
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await bindings('gear'), [...before, ['KeyJ']]);
    await map('KeyJ').click();
    assert.match(await page.locator('.layout-inspector').textContent(), /Landing gear/);
    await screenshot('02-assigned-alternate.png');
  });

  await check('assigning an occupied key asks before mutation and preserves Share, Move and Undo semantics', async () => {
    const before = await layout();
    await assign('KeyW', 'gear');
    assert.match(await page.locator('#conflictTitle').textContent(), /already has a job/);
    assert.equal(await layout(), before, 'opening the conflict must not mutate either action');
    await page.locator('[data-resolve="share"]').click();
    assert.ok((await bindings('throttle_up')).some(chord => chord.join('+') === 'KeyW'));
    assert.ok((await bindings('gear')).some(chord => chord.join('+') === 'KeyW'));
    await map('KeyW').click();
    assert.match(await page.locator('.layout-inspector').textContent(), /Increase throttle/);
    assert.match(await page.locator('.layout-inspector').textContent(), /Landing gear/);
    await undo();
    assert.equal(await layout(), before, 'Undo restores both sides of a shared assignment');
    await assign('KeyW', 'gear');
    await page.locator('[data-resolve="replace"]').click();
    assert.deepEqual(await bindings('throttle_up'), [['NumpadAdd'], ['Equal']]);
    assert.ok((await bindings('gear')).some(chord => chord.join('+') === 'KeyW'));
    await undo();
    assert.equal(await layout(), before, 'Undo restores the displaced action as well as the selected one');
  });

  await check('direct assignment cannot silently evict a fourth binding or take Escape', async () => {
    await assign('KeyK', 'fire_mguns');
    const full = await bindings('fire_mguns');
    assert.equal(full.length, 4);
    await map('KeyL').click();
    const option = page.locator('#mapAssignAction option[value="fire_mguns"]');
    assert.equal(await option.isDisabled(), true, 'a full action needs an explicit slot edit');
    assert.deepEqual(await bindings('fire_mguns'), full);
    const before = await layout();
    await map('Escape').click();
    assert.match(await page.locator('.layout-inspector').textContent(), /always (?:stays )?available|reserved/i);
    const assignButton = page.locator('[data-map-assign]');
    assert.ok(await assignButton.count() === 0 || await assignButton.isDisabled());
    assert.equal(await page.locator('[data-layout-edit="menu"]').count(), 0);
    assert.equal(await layout(), before);
    await undo();
    assert.equal((await bindings('fire_mguns')).length, 3);
  });

  await check('the map connects alternate controls and full modifier chords without hiding physical keys', async () => {
    await map('KeyW').click();
    for (const code of ['Equal', 'NumpadAdd']) assert.ok(await map(code).evaluate(el => el.classList.contains('key-related')), code + ' should be shown as the same action');
    await map('KeyZ').click();
    assert.ok(await map('AltLeft').evaluate(el => el.classList.contains('key-modifier')), 'Option is required for the HUD shortcut');
    assert.match(await page.locator('.layout-inspector').textContent(), /Alt|Option/);
    const count = await page.locator('.keyboard-board [data-map-key]').count();
    for (const filter of ['flight', 'weapons', 'systems', 'interface', 'available', 'all']) {
      await page.locator(`[data-map-filter="${filter}"]`).click();
      assert.equal(await page.locator(`[data-map-filter="${filter}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.keyboard-board [data-map-key]').count(), count, 'filtering must retain spatial positions');
      assert.equal(await map('KeyW').isVisible(), true);
    }
    await screenshot('03-chord-connections.png');
  });

  await check('one diagram Tab stop supports spatial arrows, board edges and an intentional inspector entry', async () => {
    await map('KeyW').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(map('KeyE')), true);
    assert.equal(await map('KeyE').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(map('KeyW')), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(map('KeyS')), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(map('KeyW')), true);
    await page.keyboard.press('Home');
    assert.equal(await focused(map('Escape')), true);
    await page.keyboard.press('End');
    assert.equal(await focused(map('ArrowRight')), true);
    assert.equal(await page.locator('.keyboard-board [data-map-key][tabindex="0"]').count(), 1);
    await map('KeyW').focus();
    await page.keyboard.press('Enter');
    assert.equal(await focused(page.locator('[data-layout-edit="throttle_up"]')), true, 'Enter should reach Change key, not an unrelated alternate chip');
    assert.equal(await page.locator('.setup-modal').count(), 0, 'inspecting must not start capture or save a change');
    await map('KeyW').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.keyboard-board').evaluate(el => el.contains(document.activeElement)), false, 'Tab should leave the diagram instead of traversing every key');
  });

  await check('map rehearsal lights real keys, retains tap feedback and never activates flight or edits bindings', async () => {
    const before = await layout();
    await startRehearsal();
    await page.keyboard.down('w');
    assert.match(await page.locator('#mapTestActions').textContent(), /Increase throttle/);
    assert.ok(await map('KeyW').evaluate(el => el.classList.contains('key-held')));
    assert.equal(await page.evaluate(() => testInput.held('throttle_up')), false);
    assert.equal(await page.evaluate(() => testInput.edge.size), 0);
    await page.keyboard.up('w');
    assert.equal(await page.locator('.key-held').count(), 0);
    assert.match(await page.locator('#mapTestLast').textContent(), /W.*Increase throttle/);
    await page.keyboard.press('Space');
    assert.match(await page.locator('#mapTestLast').textContent(), /Space.*Launch missile/);
    assert.equal(await layout(), before);
    await screenshot('04-safe-key-rehearsal.png');
    await endRehearsal();
  });

  await check('rehearsal keeps bottom-row keys and live action feedback visible together on laptop screens', async () => {
    for (const height of [900, 800]) {
      await page.setViewportSize({ width: 1280, height });
      await startRehearsal();
      await page.locator('.keyboard-layout > summary').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
      assert.match(await page.locator('#mapTestActions').textContent(), /Pitch up/);
      for (const selector of ['[data-map-key="ArrowDown"]', '[data-map-key="ShiftLeft"]', '#mapTestKeys', '#mapTestActions', '#mapTestLast']) {
        const visible = await page.locator(selector).evaluate(el => {
          const box = el.getBoundingClientRect(), pane = document.querySelector('.setup-content').getBoundingClientRect();
          const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1 && box.left >= 0 && box.right <= innerWidth && (centre === el || el.contains(centre));
        });
        assert.equal(visible, true, selector + ' should remain visible beside rehearsal feedback at 1280×' + height);
      }
      await screenshot(`04-rehearsal-laptop-${height}.png`);
      await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
      await endRehearsal();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await check('rapid wheel direction changes show transient input and release both directions cleanly', async () => {
    const before = await layout();
    await startRehearsal();
    await map('KeyW').hover();
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => document.querySelector('[data-map-key="WheelUp"]').classList.contains('key-held'));
    assert.match(await page.locator('#mapTestLast').textContent(), /Wheel up/);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.querySelector('[data-map-key="WheelDown"]').classList.contains('key-held'));
    assert.equal(await map('WheelUp').evaluate(el => el.classList.contains('key-held')), false);
    assert.match(await page.locator('#mapTestLast').textContent(), /Wheel down/);
    await page.waitForFunction(() => !document.querySelector('[data-map-key="WheelUp"]').classList.contains('key-held') && !document.querySelector('[data-map-key="WheelDown"]').classList.contains('key-held'));
    assert.equal(await page.locator('.key-held').count(), 0);
    assert.equal(await page.evaluate(() => testInput.edge.size), 0);
    assert.equal(await layout(), before);
    await endRehearsal();
  });

  await check('rehearsal resolves the same modifier priority and shared actions as flight', async () => {
    await edit('KeyG', 'gear', 'Shift+w');
    await startRehearsal();
    await page.keyboard.down('Shift'); await page.keyboard.down('w');
    const actions = await page.locator('#mapTestActions').textContent();
    assert.match(actions, /Landing gear/);
    assert.doesNotMatch(actions, /Increase throttle/);
    assert.ok(await map('ShiftLeft').evaluate(el => el.classList.contains('key-held')));
    assert.ok(await map('KeyW').evaluate(el => el.classList.contains('key-held')));
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    assert.match(await page.locator('#mapTestLast').textContent(), /Shift.*W.*Landing gear/);
    await page.keyboard.down('Control'); await page.keyboard.down('Alt');
    assert.match(await page.locator('#mapTestActions').textContent(), /Launch missile/);
    await page.keyboard.up('Alt'); await page.keyboard.up('Control');
    await endRehearsal();
    await undo();
    await assign('KeyW', 'gear'); await page.locator('[data-resolve="share"]').click();
    await startRehearsal(); await page.keyboard.down('w');
    assert.match(await page.locator('#mapTestActions').textContent(), /Increase throttle/);
    assert.match(await page.locator('#mapTestActions').textContent(), /Landing gear/);
    await page.keyboard.up('w'); await endRehearsal(); await undo();
  });

  await check('rehearsal clears missed keyups on blur and Command release and leaves Tab and typing usable', async () => {
    await startRehearsal(); await page.keyboard.down('a');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.locator('.key-held').count(), 0);
    await page.keyboard.up('a');
    await page.locator('.keyboard-stage').focus();
    // macOS can omit the letter keyup while a Command shortcut switches apps.
    // Dispatch this interrupted sequence so the browser itself is not closed.
    await page.evaluate(() => {
      const target = document.activeElement;
      for (const [type, code, metaKey] of [['keydown','MetaLeft',true], ['keydown','KeyW',true], ['keyup','MetaLeft',false]]) target.dispatchEvent(new KeyboardEvent(type, { code, key: code, metaKey, bubbles: true, cancelable: true }));
    });
    assert.equal(await page.locator('.key-held').count(), 0);
    assert.equal(await page.evaluate(() => testInput.edge.size), 0);
    await page.keyboard.press('Tab');
    assert.equal(await focused(page.locator('.keyboard-stage')), false);
    assert.match(await page.locator('#mapTestKeys').textContent(), /Rehearsal paused/);
    assert.equal(await page.evaluate(() => document.activeElement.closest('#controls') !== null), true);
    await startRehearsal();
    await page.locator('#controlSearch').click();
    await page.keyboard.type('gear');
    assert.equal(await page.locator('#controlSearch').inputValue(), 'gear');
    assert.equal(await focused(page.locator('#controlSearch')), true);
    assert.equal(await page.locator('.key-held').count(), 0);
    await page.locator('#controlSearch').fill('');
    if (await page.locator('[data-map-test]').getAttribute('aria-pressed') === 'true') await page.locator('[data-map-test]').click();
  });

  await check('the diagram scrolls locally, retains reachable inspection and does not widen the dialog at laptop and narrow widths', async () => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.locator('[data-action="keys"]').click();
      assert.equal(await page.locator('#controls').evaluate(el => el.scrollWidth <= innerWidth), true, width + 'px dialog overflow');
      assert.equal(await page.locator('.setup-shell').evaluate(el => el.scrollWidth <= innerWidth), true, width + 'px shell overflow');
      await map('ArrowRight').click();
      const visible = await map('ArrowRight').evaluate(el => {
        const key = el.getBoundingClientRect(), viewport = el.closest('.keyboard-viewport').getBoundingClientRect();
        return key.left >= viewport.left - 1 && key.right <= viewport.right + 1;
      });
      assert.equal(visible, true, 'selected right-edge keys must be scrollable into view at ' + width);
      assert.match(await page.locator('.layout-inspector').textContent(), /Roll right/);
      await page.locator('[data-layout-edit="roll_right"]').click();
      await page.keyboard.press('Escape');
      assert.equal(await focused(page.locator('[data-layout-edit="roll_right"]')), true, 'cancel returns to the selected slot');
      await screenshot(`05-responsive-${width}.png`);
    }
  });

  await check('collapsing the keyboard ends rehearsal and clears held input before reopening', async () => {
    await startRehearsal(); await page.keyboard.down('w');
    await page.locator('.keyboard-layout > summary').click();
    await page.waitForFunction(() => !document.querySelector('.keyboard-layout').open && document.querySelector('[data-map-test]').getAttribute('aria-pressed') === 'false');
    await page.keyboard.up('w');
    assert.equal(await page.locator('.key-held').count(), 0);
    assert.equal(await page.evaluate(() => testInput.down.size + testInput.edge.size), 0);
    await page.locator('.keyboard-layout > summary').click();
    assert.equal(await page.locator('.keyboard-layout').evaluate(el => el.open), true);
    assert.equal(await page.locator('[data-map-test]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.keyboard-board [data-map-key][tabindex="0"]').count(), 1);
  });

  await check('closing a rehearsed workshop restores the input boundary without held or queued actions', async () => {
    await startRehearsal(); await page.keyboard.down('w');
    await page.locator('[data-action="close"]').click();
    await page.keyboard.up('w');
    assert.equal(await page.evaluate(() => testControls.open), false);
    assert.equal(await page.evaluate(() => testInput.suspended), false);
    assert.equal(await page.evaluate(() => testInput.down.size + testInput.edge.size), 0);
    assert.equal(await page.evaluate(() => testInput.mouse.dx + testInput.mouse.dy), 0);
  });
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: out + 'failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile(out + 'results.json', JSON.stringify({ results, errors }, null, 2));
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(out + 'keyboard-workshop.webm');
  await browser.close();
}

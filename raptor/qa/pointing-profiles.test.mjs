import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, STORE_KEY, LEGACY_STORE_KEY } from '../src/engine/input.js';
import * as settings from '../src/game/settings.js';

function fixture(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  globalThis.matchMedia = () => ({ matches: false });
  const target = new EventTarget();
  const input = new Input(target);
  const dispatch = (name, properties) => {
    const event = new Event(name, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  settings.bindLive(null);
  settings.loadSettings();
  return { input, store, dispatch };
}

test('legacy aim settings preserve mouse and controller feel while adding a separate trackpad profile', () => {
  const { store } = fixture({ [settings.KEY]: JSON.stringify({ mouseSensitivity: 1.7, invertY: true }) });
  assert.equal(settings.current().pointingDevice, 'mouse');
  assert.deepEqual(settings.getAimOptions(), { mouseSensitivity: 1.7, gamepadSensitivity: 1.7, invertY: true });
  settings.saveSettings({ pointingDevice: 'trackpad' });
  const saved = JSON.parse(store.get(settings.KEY));
  assert.equal(saved.mouseSensitivity, 1.7);
  assert.equal(saved.gamepadSensitivity, 1.7, 'migration makes the previous controller gain explicit');
  settings.loadSettings();
  assert.deepEqual(settings.getAimOptions(), { mouseSensitivity: .65, gamepadSensitivity: 1.7, invertY: true });
});

test('invalid profile names and sensitivities recover independently', () => {
  const value = settings.validate({ pointingDevice: 'constructor', mouseSensitivity: -10, trackpadSensitivity: Infinity, gamepadSensitivity: '2' });
  assert.equal(value.pointingDevice, 'mouse');
  assert.equal(value.mouseSensitivity, .35);
  assert.equal(value.trackpadSensitivity, .65);
  assert.equal(value.gamepadSensitivity, 1, 'corrupt controller values do not inherit an unrelated mouse edit');
  assert.equal(settings.validate({ mouseSensitivity: .5 }).gamepadSensitivity, .5, 'a missing legacy controller value does inherit the old shared gain');
  assert.equal(settings.validate({ trackpadSensitivity: -2, gamepadSensitivity: 99 }).trackpadSensitivity, .35);
  assert.equal(settings.validate({ trackpadSensitivity: -2, gamepadSensitivity: 99 }).gamepadSensitivity, 2);
});

test('mouse and trackpad gains survive switching, reload, and independent controller edits', () => {
  fixture();
  settings.saveSettings({ mouseSensitivity: 1.4, trackpadSensitivity: .55, gamepadSensitivity: 1.2 });
  settings.saveSettings({ pointingDevice: 'trackpad' });
  settings.loadSettings();
  assert.deepEqual(settings.getAimOptions(), { mouseSensitivity: .55, gamepadSensitivity: 1.2, invertY: false });
  settings.saveSettings({ pointingDevice: 'mouse' });
  settings.loadSettings();
  assert.deepEqual(settings.getAimOptions(), { mouseSensitivity: 1.4, gamepadSensitivity: 1.2, invertY: false });
  settings.saveSettings({ gamepadSensitivity: .8 });
  assert.equal(settings.current().mouseSensitivity, 1.4);
  assert.equal(settings.current().trackpadSensitivity, .55);
});

test('a live profile change drops motion sampled with the old gain but preserves held flight keys', () => {
  const { input, dispatch } = fixture();
  settings.bindLive({ input });
  dispatch('keydown', { code: 'KeyW' });
  dispatch('mousemove', { clientX: 150, clientY: 100, movementX: 100, movementY: 20 });
  assert.equal(input.mouse.dx, 100);
  settings.saveSettings({ pointingDevice: 'trackpad' });
  assert.equal(input.mouse.dx, 0);
  assert.equal(input.mouse.dy, 0);
  assert.equal(input.held('throttle_up'), true);
  dispatch('mousemove', { clientX: 250, clientY: 120, movementX: 100, movementY: 20 });
  assert.equal(input.mouse.dx, 65);
  assert.equal(input.mouse.dy, 13);
  settings.bindLive(null);
});

test('ordinary audio edits do not discard pending aim motion', () => {
  const { input, dispatch } = fixture();
  settings.bindLive({ input });
  dispatch('mousemove', { clientX: 20, clientY: 10, movementX: 20, movementY: 10 });
  settings.saveSettings({ masterVol: .5 });
  assert.equal(input.mouse.dx, 20);
  assert.equal(input.mouse.dy, 10);
  settings.bindLive(null);
});

test('controller aim stays identical across pointing profiles and responds only to its own gain', () => {
  const { input, dispatch } = fixture();
  input.attachGamepad({ supported: true, axes: { aimX: .5, aimY: -.25 } });
  const pointerSamples = [];
  const controllerSamples = [];
  for (const pointingDevice of ['mouse', 'trackpad']) {
    input.setOptions(settings.getAimOptions({ ...settings.DEFAULTS, pointingDevice }));
    dispatch('mousemove', { clientX: 100, clientY: 20, movementX: 100, movementY: 20 });
    pointerSamples.push(input.mouse.dx);
    input.consumeFrame();
    input.sampleGamepad(1 / 60);
    controllerSamples.push([input.mouse.dx, input.mouse.dy]);
    input.consumeFrame();
  }
  assert.deepEqual(pointerSamples, [100, 65]);
  assert.deepEqual(controllerSamples[0], controllerSamples[1]);
  input.setOptions({ gamepadSensitivity: 2 });
  input.sampleGamepad(1 / 60);
  assert.equal(input.mouse.dx, controllerSamples[0][0] * 2);
  assert.equal(input.mouse.dy, controllerSamples[0][1] * 2);
  input.consumeFrame();
  dispatch('mousemove', { clientX: 100, clientY: 20, movementX: 100, movementY: 20 });
  assert.equal(input.mouse.dx, 65, 'controller tuning must not retune trackpad motion');
});

test('changing inversion clears old motion and applies the new direction to pointer and controller', () => {
  const { input, dispatch } = fixture();
  input.attachGamepad({ supported: true, axes: { aimX: 0, aimY: 1 } });
  dispatch('mousemove', { clientX: 0, clientY: 10, movementX: 0, movementY: 10 });
  input.setOptions({ invertY: true });
  assert.equal(input.mouse.dy, 0);
  dispatch('mousemove', { clientX: 0, clientY: 20, movementX: 0, movementY: 10 });
  assert.equal(input.mouse.dy, -10);
  input.consumeFrame();
  input.sampleGamepad(1 / 60);
  assert.ok(input.mouse.dy < 0);
});

test('pointing-device selection preserves custom keys and does not add implicit keyboard bindings', () => {
  const bindings = JSON.stringify({ throttle_up: [['KeyU']], fire_mguns: [['KeyJ']] });
  const { input, store } = fixture({ [STORE_KEY]: bindings });
  settings.bindLive({ input });
  settings.saveSettings({ pointingDevice: 'trackpad' });
  settings.saveSettings({ pointingDevice: 'mouse' });
  assert.deepEqual(input.actions.throttle_up.binds, [['KeyU']]);
  assert.deepEqual(input.actions.fire_mguns.binds, [['KeyJ']]);
  assert.equal(store.get(STORE_KEY), bindings);
  settings.bindLive(null);
});

test('direct input options clamp independent gains and ignore nonfinite updates', () => {
  const { input } = fixture();
  input.setOptions({ mouseSensitivity: -2, gamepadSensitivity: 100 });
  assert.equal(input.options.mouseSensitivity, .35);
  assert.equal(input.options.gamepadSensitivity, 2);
  input.setOptions({ mouseSensitivity: Infinity, gamepadSensitivity: NaN });
  assert.equal(input.options.mouseSensitivity, .35);
  assert.equal(input.options.gamepadSensitivity, 2);
});

test('new keyboard-friendly defaults cannot steal keys from an existing custom layout', () => {
  const bindings = JSON.stringify({ gear: [['KeyF']], wheel_brakes: [['KeyH']] });
  const { input, store, dispatch } = fixture({ [STORE_KEY]: bindings });
  assert.deepEqual(input.actions.gear.binds, [['KeyF']]);
  assert.deepEqual(input.actions.wheel_brakes.binds, [['KeyH']]);
  assert.equal(input.actions.fire_mguns.binds.some((chord) => chord.includes('KeyF')), false);
  assert.equal(input.actions.help.binds.some((chord) => chord.includes('KeyH')), false);
  assert.equal(input.actions.fire_mguns.binds.some((chord) => chord.includes('Mouse0')), true);
  assert.equal(input.actions.help.binds.some((chord) => chord.includes('F1')), true);
  dispatch('keydown', { code: 'KeyF' });
  assert.equal(input.pressed('gear'), true);
  assert.equal(input.held('fire_mguns'), false);
  dispatch('keydown', { code: 'KeyH' });
  assert.equal(input.pressed('help'), false);
  assert.equal(store.get(STORE_KEY), bindings, 'reading a saved layout never silently rewrites it');
});

test('an explicitly shared or unbound cannon layout stays authoritative', () => {
  const shared = fixture({ [STORE_KEY]: JSON.stringify({ fire_mguns: [['KeyF']], gear: [['KeyF']] }) }).input;
  assert.deepEqual(shared.actions.fire_mguns.binds, [['KeyF']]);
  const unbound = fixture({ [STORE_KEY]: JSON.stringify({ fire_mguns: [], help: [], gear: [['KeyF']] }) }).input;
  assert.deepEqual(unbound.actions.fire_mguns.binds, []);
  assert.deepEqual(unbound.actions.help.binds, []);
});

test('new pilots can fire and open the guide without a click or a function key', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'KeyF' });
  assert.equal(input.held('fire_mguns'), true);
  dispatch('keyup', { code: 'KeyF' });
  assert.equal(input.held('fire_mguns'), false);
  dispatch('keydown', { code: 'KeyH' });
  assert.equal(input.pressed('help'), true);
});

test('new defaults cannot crowd out effective legacy cannon alternatives', () => {
  const { input } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ fire_cannons: [['KeyU'], ['KeyJ']] }) });
  assert.deepEqual(input.actions.fire_mguns.binds, [['Mouse0'], ['Digit1'], ['KeyU'], ['KeyJ']]);
});

test('a deliberate legacy cannon alias keeps its shared key during default migration', () => {
  const { input } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ fire_cannons: 'KeyF', gear: 'KeyF' }) });
  assert.equal(input.actions.fire_mguns.binds.some((chord) => chord.length === 1 && chord[0] === 'KeyF'), true);
  assert.deepEqual(input.actions.gear.binds, [['KeyF']]);
});

test('unassigned Command shortcuts stay with the browser and do not fire flight actions', () => {
  for (const meta of ['MetaLeft', 'MetaRight']) {
    for (const code of ['KeyR', 'KeyW', 'KeyF']) {
      const { input, dispatch } = fixture();
      dispatch('keydown', { code: meta, metaKey: true });
      const event = dispatch('keydown', { code, metaKey: true });
      assert.equal(event.defaultPrevented, false, `${meta} + ${code} belongs to the browser`);
      assert.deepEqual([...input.edge], []);
      assert.equal(input.held('fire_mguns'), false);
      assert.equal(input.held('throttle_up'), false);
    }
  }
});

test('Command suppresses an already held flight key and release clears it even without its keyup', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'KeyW' });
  assert.equal(input.held('throttle_up'), true);
  input.consumeFrame();
  dispatch('keydown', { code: 'MetaLeft', metaKey: true });
  assert.equal(input.held('throttle_up'), false, 'typing a browser shortcut must stop accelerating');
  dispatch('keyup', { code: 'MetaLeft', metaKey: false });
  assert.equal(input.held('throttle_up'), false, 'a swallowed W keyup must not leave throttle held');
  assert.equal(input.down.size, 0);
  dispatch('keydown', { code: 'KeyW', metaKey: false });
  assert.equal(input.held('throttle_up'), true, 'a fresh ordinary press still works');
});

test('explicit Command chords work without also activating the ordinary flight binding', () => {
  const { input, dispatch } = fixture();
  assert.equal(input.setBinding('fire_mguns', 0, ['MetaRight', 'KeyW']), true);
  dispatch('keydown', { code: 'MetaRight', metaKey: true });
  const event = dispatch('keydown', { code: 'KeyW', metaKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.held('fire_mguns'), true);
  assert.equal(input.held('throttle_up'), false);
  input.consumeFrame();
  const repeat = dispatch('keydown', { code: 'KeyW', metaKey: true, repeat: true });
  assert.equal(repeat.defaultPrevented, true);
  assert.equal(input.pressed('fire_mguns'), false, 'repeats must not create another action edge');
  dispatch('keyup', { code: 'MetaRight', metaKey: false });
  assert.equal(input.held('fire_mguns'), false);
  assert.equal(input.held('throttle_up'), false, 'missing W keyup must not revive its ordinary action');
});

test('quickly releasing an explicit Command shortcut retains its intentional single-press action', () => {
  const { input, dispatch } = fixture();
  input.setBinding('gear', 0, ['MetaLeft', 'KeyG']);
  dispatch('keydown', { code: 'MetaLeft', metaKey: true });
  dispatch('keydown', { code: 'KeyG', metaKey: true });
  dispatch('keyup', { code: 'MetaLeft', metaKey: false });
  assert.equal(input.pressed('gear'), true, 'the next frame must still receive the deliberate press');
  assert.equal(input.down.size, 0);
  input.consumeFrame();
  assert.equal(input.pressed('gear'), false);
});

test('Escape remains an always-available pause key while Command is held', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'MetaLeft', metaKey: true });
  const event = dispatch('keydown', { code: 'Escape', metaKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.pressed('menu'), true);
});

test('a fresh key with Command released repairs stale modifier state when its keyup was omitted too', () => {
  const { input, dispatch } = fixture();
  input.setBinding('fire_mguns', 0, ['MetaLeft', 'KeyF']);
  dispatch('keydown', { code: 'MetaLeft', metaKey: true });
  dispatch('keydown', { code: 'KeyF', metaKey: true });
  assert.equal(input.held('fire_mguns'), true);
  input.consumeFrame();
  dispatch('keydown', { code: 'KeyW', metaKey: false });
  assert.equal(input.held('fire_mguns'), false);
  assert.equal(input.held('throttle_up'), true);
  assert.deepEqual([...input.down], ['KeyW']);
});

test('Command changes do not alter Shift or the legacy Control + Option missile chord', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'ShiftLeft', metaKey: false });
  dispatch('keydown', { code: 'KeyW', shiftKey: true, metaKey: false });
  assert.equal(input.held('throttle_up'), true);
  input.clear();
  dispatch('keydown', { code: 'ControlLeft', ctrlKey: true, metaKey: false });
  dispatch('keydown', { code: 'AltLeft', ctrlKey: true, altKey: true, metaKey: false });
  assert.equal(input.pressed('fire_aam'), true);
});

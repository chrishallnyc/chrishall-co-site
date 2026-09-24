import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, STORE_KEY, LEGACY_STORE_KEY, validChord } from '../src/engine/input.js';
import { ACTIVE_ACTIONS } from '../src/engine/binds.js';
import { GamepadInput, deadzone } from '../src/engine/gamepad.js';

function fixture(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const target = new EventTarget();
  const input = new Input(target);
  const dispatch = (name, props = {}) => {
    const event = new Event(name, { cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event); return event;
  };
  return { input, store, dispatch, target };
}

test('editor only exposes actions consumed by the game', () => {
  const { input } = fixture();
  assert.equal(input.actions.fire_mguns.label, 'Fire cannon');
  assert.equal(input.actions.drop_bomb, undefined);
  assert.deepEqual(input.actions.fire_aam.binds[0], ['Space']);
  assert.ok(Object.keys(ACTIVE_ACTIONS).length < 25);
});

test('editing primary preserves alternates and all bindings reload', () => {
  const { input, target } = fixture();
  const alternates = input.actions.throttle_up.binds.slice(1);
  assert.equal(input.setBinding('throttle_up', 0, ['KeyU']), true);
  assert.deepEqual(input.actions.throttle_up.binds.slice(1), alternates);
  assert.equal(input.setBinding('throttle_up', 3, ['KeyO']), true);
  const fresh = new Input(target);
  assert.deepEqual(fresh.actions.throttle_up.binds, [['KeyU'], ...alternates, ['KeyO']]);
});

test('unbound actions persist instead of silently regaining defaults', () => {
  const { input, target } = fixture();
  assert.equal(input.setBinding('gear', 0, null), true);
  assert.deepEqual(new Input(target).actions.gear.binds, []);
});

test('valid v2 records migrate independently from malformed entries', () => {
  const { input } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ gear: 'KeyU', throttle_up: null, yaw_right: 'AltLeft+KeyL' }) });
  assert.deepEqual(input.actions.gear.binds, [['KeyU']]);
  assert.deepEqual(input.actions.throttle_up.binds, ACTIVE_ACTIONS.throttle_up.binds);
  assert.deepEqual(input.actions.yaw_right.binds, [['AltLeft', 'KeyL']]);
});

test('v3 takes precedence over legacy layouts, including an empty default profile', () => {
  const { input } = fixture({ [STORE_KEY]: '{}', [LEGACY_STORE_KEY]: JSON.stringify({ gear: 'KeyU' }) });
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
});

test('legacy cannon preferences migrate into visible alternates without a hidden fire alias', () => {
  const { input, target, dispatch } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ fire_cannons: 'KeyU' }) });
  assert.deepEqual(input.actions.fire_mguns.binds, [['KeyF'], ['Mouse0'], ['Digit1'], ['KeyU']]);
  assert.equal(input.actions.fire_cannons, undefined);
  assert.equal(input.setBinding('fire_mguns', 3, ['KeyO']), true);
  assert.deepEqual(new Input(target).actions.fire_mguns.binds, [['KeyF'], ['Mouse0'], ['Digit1'], ['KeyO']]);
  dispatch('keydown', { code: 'KeyU' });
  assert.equal(input.held('fire_mguns'), false);
});

test('existing v2 pilots keep the effective cannon default as a visible alternate', () => {
  const { input } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ fire_mguns: 'KeyU' }) });
  assert.deepEqual(input.actions.fire_mguns.binds, [['KeyU'], ['Mouse0'], ['Digit2']]);
});

test('explicitly unbound cannon layouts are not revived by legacy migration', () => {
  const legacy = JSON.stringify({ fire_mguns: '', fire_cannons: '' });
  assert.deepEqual(fixture({ [LEGACY_STORE_KEY]: legacy }).input.actions.fire_mguns.binds, []);
  const current = JSON.stringify({ fire_mguns: [] });
  assert.deepEqual(fixture({ [STORE_KEY]: current, [LEGACY_STORE_KEY]: JSON.stringify({ fire_cannons: 'KeyU' }) }).input.actions.fire_mguns.binds, []);
});

test('corrupt binding entries and prototype-looking IDs do not corrupt the layout', () => {
  const { input } = fixture({ [STORE_KEY]: '{"gear":[["KeyU"]],"yaw_left":[[]],"__proto__":[["KeyX"]],"menu":[]}' });
  assert.deepEqual(input.actions.gear.binds, [['KeyU']]);
  assert.deepEqual(input.actions.yaw_left.binds, [['KeyQ']]);
  assert.deepEqual(input.actions.menu.binds, [['Escape']]);
});

test('Escape cannot be removed, moved, rebound or hidden by saved layouts', () => {
  const { input } = fixture({ [STORE_KEY]: JSON.stringify({ menu: [['KeyU']], fire_aam: [['Escape']] }) });
  assert.deepEqual(input.actions.menu.binds, [['Escape'], ['KeyU']]);
  assert.equal(input.setBinding('menu', 0, null), false);
  assert.equal(input.setBinding('menu', 0, ['KeyL']), false);
  assert.equal(input.setBinding('gear', 0, ['Escape'], { resolve: 'replace' }), false);
});

test('conflicting binding requires an explicit decision and cancel preserves both actions', () => {
  const { input } = fixture();
  assert.equal(input.setBinding('gear', 0, ['KeyW']), false);
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
  assert.deepEqual(input.findConflicts('gear', ['KeyW']).map(({ id }) => id), ['throttle_up']);
});

test('move binding removes only the conflict and keeps other alternates', () => {
  const { input } = fixture();
  assert.equal(input.setBinding('gear', 0, ['KeyW'], { resolve: 'replace' }), true);
  assert.deepEqual(input.actions.gear.binds, [['KeyW']]);
  assert.deepEqual(input.actions.throttle_up.binds, [['NumpadAdd'], ['Equal']]);
});

test('share binding deliberately triggers both actions', () => {
  const { input, dispatch } = fixture();
  input.setBinding('gear', 0, ['KeyW'], { resolve: 'share' });
  dispatch('keydown', { code: 'KeyW' });
  assert.equal(input.pressed('gear'), true);
  assert.equal(input.held('throttle_up'), true);
});

test('longer chord owns held and edge input without secretly activating a flight key', () => {
  const { input, dispatch } = fixture();
  input.setBinding('gear', 0, ['AltLeft', 'KeyW']);
  dispatch('keydown', { code: 'AltLeft' });
  dispatch('keydown', { code: 'KeyW' });
  assert.equal(input.pressed('gear'), true);
  assert.equal(input.pressed('throttle_up'), false);
  assert.equal(input.held('throttle_up'), false);
  dispatch('keyup', { code: 'AltLeft' });
  assert.equal(input.held('throttle_up'), true);
});

test('an unrelated held modifier does not suppress flight controls', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'ShiftLeft' });
  dispatch('keydown', { code: 'KeyW' });
  assert.equal(input.held('throttle_up'), true);
});

test('deliberate shared held controls both remain active', () => {
  const { input, dispatch } = fixture();
  input.setBinding('yaw_left', 0, ['KeyW'], { resolve: 'share' });
  dispatch('keydown', { code: 'KeyW' });
  assert.equal(input.held('yaw_left'), true);
  assert.equal(input.held('throttle_up'), true);
});

test('duplicate alternates are rejected and modifier prefixes compare independent of order', () => {
  const { input } = fixture();
  assert.equal(input.setBinding('gear', 1, ['KeyG']), false);
  input.setBinding('gear', 0, ['AltLeft', 'ShiftLeft', 'KeyL']);
  assert.equal(input.findConflicts('fire_aam', ['ShiftLeft', 'AltLeft', 'KeyL'])[0].id, 'gear');
});

test('wheel bindings fire press actions, clear next frame and cannot pretend to be held controls', () => {
  const { input, dispatch } = fixture();
  assert.equal(input.setBinding('roll_left', 0, ['WheelUp']), false);
  assert.equal(input.setBinding('fire_aam', 0, ['WheelUp']), true);
  const event = dispatch('wheel', { deltaY: -100 });
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.pressed('fire_aam'), true);
  input.consumeFrame();
  assert.equal(input.pressed('fire_aam'), false);
  assert.equal(input.down.has('WheelUp'), false);
});

test('opening setup clears held keys, pending missiles and accumulated mouse motion', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'Space' });
  dispatch('keydown', { code: 'KeyW' });
  dispatch('mousemove', { movementX: 100, movementY: 30, clientX: 100, clientY: 100 });
  input.suspended = true;
  assert.equal(input.down.size, 0); assert.equal(input.edge.size, 0);
  assert.equal(input.mouse.dx, 0);
  dispatch('mousemove', { movementX: 100, movementY: 30 });
  input.suspended = false;
  assert.equal(input.pressed('fire_aam'), false); assert.equal(input.held('throttle_up'), false);
  assert.equal(input.mouse.dx, 0);
});

test('losing focus clears both held controls and queued edge actions', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'Space' }); dispatch('keydown', { code: 'KeyW' });
  dispatch('blur');
  assert.equal(input.pressed('fire_aam'), false); assert.equal(input.held('throttle_up'), false);
});

test('UI clicks, typed text and pointer motion do not feed the aircraft', () => {
  const { input, dispatch } = fixture();
  const target = { closest: () => ({}) };
  dispatch('keydown', { code: 'KeyW', target }); dispatch('mousedown', { button: 0, target });
  dispatch('mousemove', { movementX: 100, movementY: 30, target });
  assert.equal(input.held('throttle_up'), false); assert.equal(input.held('fire_mguns'), false);
  assert.equal(input.mouse.dx, 0);
});

test('unbound Tab remains available for keyboard access to the flight toolbar', () => {
  const { dispatch } = fixture();
  assert.equal(dispatch('keydown', { code: 'Tab' }).defaultPrevented, false);
});

test('Escape still pauses if keyboard focus is on a flight toolbar button', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'Escape', target: { closest: () => ({}) } });
  assert.equal(input.pressed('menu'), true);
});

test('held shortcut repeats suppress browser behavior without repeating action edges', () => {
  const { input, dispatch } = fixture();
  dispatch('keydown', { code: 'F1' });
  input.consumeFrame();
  const repeat = dispatch('keydown', { code: 'F1', repeat: true });
  assert.equal(repeat.defaultPrevented, true);
  assert.equal(input.pressed('help'), false);
});

test('mouse sensitivity and inversion apply once and clear between frames', () => {
  const { input, dispatch } = fixture();
  input.setOptions({ mouseSensitivity: 0.5, invertY: true });
  dispatch('mousemove', { movementX: 20, movementY: 10, clientX: 10, clientY: 10 });
  assert.equal(input.mouse.dx, 10); assert.equal(input.mouse.dy, -5);
  input.consumeFrame(); assert.equal(input.mouse.dx, 0);
});

test('denied storage keeps edits usable for the current session', () => {
  const { input } = fixture();
  localStorage.setItem = () => { throw new Error('storage denied'); };
  assert.doesNotThrow(() => input.setBinding('gear', 0, ['KeyU']));
  assert.equal(input.storageAvailable, false);
  assert.deepEqual(input.actions.gear.binds, [['KeyU']]);
  assert.doesNotThrow(() => input.resetBinds());
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
});

test('reset persists defaults even when a previous legacy profile exists', () => {
  const { input, target } = fixture({ [LEGACY_STORE_KEY]: JSON.stringify({ gear: 'KeyU' }) });
  input.resetBinds();
  assert.deepEqual(new Input(target).actions.gear.binds, [['KeyG']]);
});

test('invalid or excessive chords cannot enter runtime', () => {
  assert.equal(validChord(['<script>']), false);
  assert.equal(validChord(['KeyA', 'KeyA']), false);
  assert.equal(validChord([]), false);
  assert.equal(validChord(['AltLeft', 'ShiftLeft', 'ControlLeft', 'KeyA', 'KeyB']), false);
});

test('gamepad disconnect zeros axes and unmapped HOTAS is not guessed', () => {
  let pads = [{ connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0.5, -0.6, 0.2, 0.8], buttons: [] }];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  const pad = new GamepadInput(); pad.update();
  assert.ok(pad.axes.roll > 0); assert.ok(pad.axes.throttleRel > 0);
  pads = []; pad.update();
  assert.equal(pad.connected, false); assert.ok(Object.values(pad.axes).every((v) => v === 0));
  pads = [{ connected: true, mapping: '', axes: [1, 1, 1, 1], buttons: [] }]; pad.update();
  assert.equal(pad.supported, false); assert.ok(Object.values(pad.axes).every((v) => v === 0));
});

test('standard controller buttons trigger once; suspension blocks buttons and aim', () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const raw = { connected: true, mapping: 'standard', index: 0, axes: [0, 0, 1, 0], buttons };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [raw] } });
  const { input } = fixture(), pad = new GamepadInput(); input.attachGamepad(pad);
  buttons[5].pressed = true; pad.update();
  assert.equal(input.pressed('fire_aam'), true);
  pad.update(); assert.equal(input.pressed('fire_aam'), false);
  input.sampleGamepad(1 / 60); assert.ok(input.mouse.dx > 0);
  input.suspended = true; input.sampleGamepad(1 / 60);
  assert.equal(input.mouse.dx, 0); assert.equal(input.pressed('fire_aam'), false);
});

test('controller deadzone is continuous and does not turn light input into full roll', () => {
  assert.equal(deadzone(0.1), 0); assert.equal(deadzone(-0.1), 0);
  assert.ok(deadzone(0.2) > 0 && deadzone(0.2) < 0.2);
  assert.equal(deadzone(1), 1); assert.equal(deadzone(-1), -1);
});

test('a browser that denies gamepad access does not break keyboard flight', () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => { throw new Error('permission policy'); } } });
  const pad = new GamepadInput();
  assert.doesNotThrow(() => pad.update());
  assert.equal(pad.connected, false);
  assert.ok(Object.values(pad.axes).every((value) => value === 0));
});

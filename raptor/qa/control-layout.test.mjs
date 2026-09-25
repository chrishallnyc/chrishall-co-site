import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, STORE_KEY } from '../src/engine/input.js';
import { DEFAULTS } from '../src/game/settings.js';
import { aimPresetState, mappedControls } from '../src/game/controlsmenu.js';

function input(seed = {}) {
  const store = new Map([[STORE_KEY, JSON.stringify(seed)]]);
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  return new Input(new EventTarget());
}

test('the visual layout follows current remaps, alternates and intentionally unbound actions', () => {
  const controls = input({ throttle_up: [['KeyU'], ['Mouse4']], gear: [] });
  const map = mappedControls(controls.actions);
  assert.equal(map.has('KeyW'), false);
  assert.equal(map.has('KeyG'), false);
  assert.deepEqual(map.get('KeyU').map(({id, slot}) => ({id, slot})), [{id:'throttle_up',slot:0}]);
  assert.deepEqual(map.get('Mouse4').map(({id, slot}) => ({id, slot})), [{id:'throttle_up',slot:1}]);
  assert.equal(map.get('Escape')[0].locked, true);
});

test('the layout exposes complete shortcuts on their trigger, including multiple bindings', () => {
  const controls = input();
  controls.setBinding('fire_mguns', 0, ['KeyG'], {resolve:'share'});
  controls.setBinding('help', 0, ['AltRight', 'KeyG']);
  const before = JSON.stringify(controls.actions);
  const map = mappedControls(controls.actions);
  assert.deepEqual(map.get('KeyG').map(entry => entry.id), ['fire_mguns', 'gear', 'help']);
  assert.deepEqual(map.get('KeyG').find(entry => entry.id === 'help').chord, ['AltRight', 'KeyG']);
  assert.equal(map.has('AltRight'), false, 'a shortcut modifier is not advertised as a standalone action');
  assert.deepEqual(map.get('AltLeft')[0].chord, ['ControlLeft', 'AltLeft'], 'a modifier-only chord still has a real trigger');
  assert.equal(JSON.stringify(controls.actions), before, 'reading the map never changes the control layout');
});

test('aim preset labels are derived from the selected device gain, with independent defaults', () => {
  assert.equal(aimPresetState(DEFAULTS).selected, 'balanced');
  const trackpad = aimPresetState({...DEFAULTS, pointingDevice:'trackpad', mouseSensitivity:1.4});
  assert.equal(trackpad.key, 'trackpadSensitivity');
  assert.equal(trackpad.selected, 'balanced');
  assert.equal(trackpad.value, .65);
  assert.equal(aimPresetState({...DEFAULTS, mouseSensitivity:1.4}).selected, 'responsive');
  assert.equal(aimPresetState({...DEFAULTS, pointingDevice:'trackpad', trackpadSensitivity:.45}).selected, 'precise');
});

test('fine-tuned gain is honestly custom and revisiting a preset gain restores its label', () => {
  assert.equal(aimPresetState({...DEFAULTS, mouseSensitivity:1.05}).label, 'Custom');
  assert.equal(aimPresetState({...DEFAULTS, pointingDevice:'trackpad', trackpadSensitivity:.6}).selected, 'custom');
  assert.equal(aimPresetState({...DEFAULTS, mouseSensitivity:.6500000000000001}).selected, 'precise');
});

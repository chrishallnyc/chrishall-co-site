import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_ACTIONS } from '../src/engine/binds.js';
import {
  KEYBOARD_BOUNDS, KEYBOARD_ROWS, KEYBOARD_KEYS, KEYBOARD_CODES, POINTER_KEYS,
  ACTION_TOKENS, CATEGORY_LABELS, bindingMap, keyDescriptor, moveKeyboardFocus,
} from '../src/game/keyboardlayout.js';

test('MacBook geometry includes a full physical US keyboard without overlapping keys', () => {
  assert.equal(KEYBOARD_ROWS.length, 6);
  assert.equal(KEYBOARD_CODES.size, KEYBOARD_KEYS.length);
  for (const item of KEYBOARD_KEYS) {
    assert.ok(item.x >= 0 && item.y >= 0, item.code);
    assert.ok(item.width > 0 && item.height > 0, item.code);
    assert.ok(item.x + item.width <= KEYBOARD_BOUNDS.width, item.code);
    assert.ok(item.y + item.height <= KEYBOARD_BOUNDS.height, item.code);
    assert.ok(item.label && item.name, item.code);
  }
  for (let a = 0; a < KEYBOARD_KEYS.length; a++) {
    for (let b = a + 1; b < KEYBOARD_KEYS.length; b++) {
      const left = KEYBOARD_KEYS[a], right = KEYBOARD_KEYS[b];
      const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      assert.ok(overlapX <= 0 || overlapY <= 0, `${left.code} overlaps ${right.code}`);
    }
  }
  for (const code of [
    ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => `Key${letter}`),
    ...[...'0123456789'].map(number => `Digit${number}`),
    ...Array.from({length:12}, (_, i) => `F${i + 1}`),
    'Escape', 'Backspace', 'Tab', 'CapsLock', 'Enter', 'Space',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
    'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
    'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Fn', 'TouchID',
  ]) assert.equal(KEYBOARD_CODES.has(code), true, `missing ${code}`);
});

test('the bottom row preserves the inverted-T arrows and OS-only key distinction', () => {
  const left = keyDescriptor('ArrowLeft'), up = keyDescriptor('ArrowUp');
  const down = keyDescriptor('ArrowDown'), right = keyDescriptor('ArrowRight');
  assert.equal(up.x, down.x);
  assert.equal(up.y + up.height, down.y);
  assert.equal(left.y, down.y);
  assert.equal(right.y, down.y);
  assert.ok(left.x < up.x && right.x > up.x);
  assert.equal(keyDescriptor('Fn').bindable, false);
  assert.equal(keyDescriptor('TouchID').bindable, false);
  assert.equal(keyDescriptor('F1').bindable, true);
  assert.equal(keyDescriptor('ShiftRight').name, 'Right Shift');
  assert.equal(KEYBOARD_CODES.has('ControlRight'), false, 'external keyboards can add keys absent from the MacBook');
});

test('pointer and external-keyboard inputs retain readable descriptors', () => {
  assert.deepEqual(POINTER_KEYS.map(item => item.code), ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'WheelUp', 'WheelDown']);
  assert.equal(keyDescriptor('NumpadAdd').label, 'Num +');
  assert.equal(keyDescriptor('Numpad7').label, 'Num 7');
  assert.equal(keyDescriptor('PageDown').external, true);
  assert.equal(keyDescriptor('Mouse4').name, 'Mouse button 5');
  assert.equal(keyDescriptor('Backspace').name, 'Delete / Backspace');
});

test('binding descriptors follow alternates, shared keys and modifier-only triggers without mutating actions', () => {
  const actions = structuredClone(ACTIVE_ACTIONS);
  actions.throttle_up.binds = [['KeyU'], ['ShiftRight', 'KeyW'], ['Mouse4']];
  actions.gear.binds = [['KeyF']];
  actions.help.binds = [];
  const before = JSON.stringify(actions), map = bindingMap(actions);
  assert.deepEqual(map.get('KeyU').map(({id,slot}) => ({id,slot})), [{id:'throttle_up',slot:0}]);
  assert.deepEqual(map.get('KeyW')[0].chord, ['ShiftRight', 'KeyW']);
  assert.equal(map.has('ShiftRight'), false);
  assert.deepEqual(map.get('AltLeft')[0].chord, ['ControlLeft', 'AltLeft']);
  assert.deepEqual(map.get('KeyF').map(item => item.id), ['fire_mguns', 'gear']);
  assert.equal(map.get('KeyF')[0].category, 'weapons');
  assert.equal(map.get('KeyF')[1].category, 'systems');
  assert.equal(map.get('KeyU')[0].essential, true);
  assert.equal(map.get('Escape')[0].locked, true);
  assert.equal(map.has('KeyH'), false);
  assert.equal(JSON.stringify(actions), before);
  map.get('KeyW')[0].chord[0] = 'AltRight';
  assert.equal(JSON.stringify(actions), before, 'inspector metadata cannot change live bindings');
});

test('all implemented actions receive a visible category and concise token', () => {
  for (const item of bindingMap(ACTIVE_ACTIONS).values()) {
    for (const descriptor of item) {
      assert.ok(CATEGORY_LABELS[descriptor.category], descriptor.id);
      assert.ok(ACTION_TOKENS[descriptor.id], descriptor.id);
    }
  }
  assert.equal(bindingMap(ACTIVE_ACTIONS).get('KeyZ')[0].category, 'interface');
  assert.equal(bindingMap(ACTIVE_ACTIONS).get('Backquote')[0].category, 'interface');
});

test('roving focus follows staggered rows without trapping focus at wide keys', () => {
  assert.equal(moveKeyboardFocus('KeyW', 'left'), 'KeyQ');
  assert.equal(moveKeyboardFocus('KeyW', 'right'), 'KeyE');
  assert.equal(moveKeyboardFocus('KeyW', 'up'), 'Digit2');
  assert.equal(moveKeyboardFocus('KeyW', 'down'), 'KeyS');
  assert.equal(moveKeyboardFocus('KeyS', 'up'), 'KeyW');
  assert.equal(moveKeyboardFocus('Tab', 'down'), 'CapsLock');
  assert.equal(moveKeyboardFocus('Backslash', 'down'), 'Enter');
  assert.equal(moveKeyboardFocus('Enter', 'down'), 'ShiftRight');
  assert.equal(moveKeyboardFocus('Space', 'up'), 'KeyB');
  assert.equal(moveKeyboardFocus('ArrowUp', 'down'), 'ArrowDown');
  assert.equal(moveKeyboardFocus('ArrowDown', 'up'), 'ArrowUp');
  assert.equal(moveKeyboardFocus('ArrowDown', 'left'), 'ArrowLeft');
  assert.equal(moveKeyboardFocus('ArrowDown', 'right'), 'ArrowRight');
  assert.equal(moveKeyboardFocus('ArrowUp', 'left'), 'ArrowLeft');
  assert.equal(moveKeyboardFocus('ArrowUp', 'right'), 'ArrowRight');
  assert.equal(moveKeyboardFocus('ArrowLeft', 'up'), 'ArrowUp');
  assert.equal(moveKeyboardFocus('ArrowRight', 'up'), 'ArrowUp');
  assert.equal(moveKeyboardFocus('ArrowUp', 'up'), 'ShiftRight');
});

test('roving focus remains bounded, skips OS-only keys and supports filtered boards', () => {
  assert.equal(moveKeyboardFocus('Escape', 'left'), 'Escape');
  assert.equal(moveKeyboardFocus('Escape', 'up'), 'Escape');
  assert.equal(moveKeyboardFocus('F12', 'right'), 'F12');
  assert.equal(moveKeyboardFocus('ArrowRight', 'right'), 'ArrowRight');
  assert.equal(moveKeyboardFocus('ArrowDown', 'down'), 'ArrowDown');
  assert.equal(moveKeyboardFocus('ControlLeft', 'left'), 'ControlLeft');
  assert.equal(moveKeyboardFocus('KeyW', 'home'), 'Escape');
  assert.equal(moveKeyboardFocus('KeyW', 'end'), 'ArrowRight');
  assert.equal(moveKeyboardFocus('ControlLeft', 'previous'), 'ShiftRight');
  assert.equal(moveKeyboardFocus('F12', 'next'), 'Backquote');
  assert.equal(moveKeyboardFocus('missing', 'right'), 'Escape');
  assert.equal(moveKeyboardFocus('KeyW', 'right', []), null);
  const flightKeys = KEYBOARD_KEYS.filter(item => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(item.code));
  assert.equal(moveKeyboardFocus('KeyW', 'down', flightKeys), 'KeyS');
  assert.equal(moveKeyboardFocus('KeyA', 'right', flightKeys), 'KeyS');
  assert.equal(moveKeyboardFocus('KeyD', 'right', flightKeys), 'KeyD');
});

test('every browser-bindable key is reachable from Escape using only arrow navigation', () => {
  const available = KEYBOARD_KEYS.filter(item => item.bindable);
  const visited = new Set(['Escape']), queue = ['Escape'];
  while (queue.length) {
    const code = queue.shift();
    for (const direction of ['left', 'right', 'up', 'down']) {
      const target = moveKeyboardFocus(code, direction);
      if (!visited.has(target)) { visited.add(target); queue.push(target); }
    }
  }
  assert.deepEqual(available.filter(item => !visited.has(item.code)).map(item => item.code), []);
  assert.equal(visited.size, available.length);
});

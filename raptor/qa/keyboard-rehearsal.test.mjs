import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/engine/input.js';
import { ControlsMenu } from '../src/game/controlsmenu.js';

function rehearsal(t) {
  const previousDocument = globalThis.document;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  }});
  const document = new EventTarget();
  globalThis.document = document;
  const input = new Input(new EventTarget());
  input.suspended = true;
  const stage = { contains: target => target === stage };
  document.activeElement = stage;
  const readouts = new Map(['#mapTestKeys', '#mapTestActions', '#mapTestLast'].map(id => [id, {textContent:''}]));
  const menu = Object.create(ControlsMenu.prototype);
  Object.assign(menu, {
    open: true, input, testing: false, mapTesting: true, capturing: null, pending: null,
    testDown: new Set(), lastTest: null,
    el: {
      querySelector: selector => selector === '.keyboard-stage' ? stage : readouts.get(selector) || null,
      querySelectorAll: () => [],
    },
  });
  t.after(() => {
    clearTimeout(menu._testWheelTimeout);
    input.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  });
  const key = (code, metaKey = false) => ({
    code, key: code, metaKey, repeat: false, target: {closest: () => null},
    preventDefault() {}, stopPropagation() {},
  });
  const wheel = deltaY => ({
    deltaY, target: {closest: () => stage}, preventDefault() {}, stopPropagation() {},
  });
  return {menu, input, key, wheel, readout: id => readouts.get(id).textContent};
}

test('opposite wheel directions replace the transient rehearsal input and expire after 500 ms', async t => {
  const {menu, input, wheel} = rehearsal(t);
  menu.testDown.add('KeyW');
  menu._onWheel(wheel(-10));
  assert.deepEqual([...menu.testDown], ['KeyW', 'WheelUp']);
  menu._onWheel(wheel(10));
  assert.deepEqual([...menu.testDown], ['KeyW', 'WheelDown'], 'changing direction must not strand the canceled timer’s wheel code');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.deepEqual([...menu.testDown], ['KeyW'], 'both wheel directions expire without releasing held keyboard controls');
  assert.equal(input.down.size, 0);
  assert.equal(input.edge.size, 0, 'rehearsal never queues gameplay actions');
});

test('the next ordinary keydown repairs a missed Command release before resolving rehearsal actions', t => {
  const {menu, input, key, readout} = rehearsal(t);
  for (const modifier of ['MetaLeft', 'MetaRight']) {
    menu.testDown.clear();
    menu._onKey(key(modifier, true));
    menu._onKey(key('KeyW', true));
    assert.deepEqual([...menu.testDown], [modifier, 'KeyW']);
    assert.equal(readout('#mapTestActions'), 'No action uses this input.', 'Command shortcuts do not accelerate the aircraft');
    // macOS can omit the Command and letter keyups. The next event says
    // Command is no longer held, so the stale chord must be discarded.
    menu._onKey(key('KeyF', false));
    assert.deepEqual([...menu.testDown], ['KeyF']);
    assert.equal(readout('#mapTestActions'), 'Fire cannon');
  }
  assert.equal(input.down.size, 0);
  assert.equal(input.edge.size, 0);
});

test('an ordinary keyup with Command released clears the stale rehearsal chord', t => {
  const {menu, key, readout} = rehearsal(t);
  for (const modifier of ['MetaLeft', 'MetaRight']) {
    menu.testDown = new Set([modifier, 'KeyW', 'KeyF']);
    menu._onKeyUp(key('KeyF', false));
    assert.equal(menu.testDown.size, 0);
    assert.equal(readout('#mapTestActions'), 'No keys held. Nothing fires or moves.');
  }
});

test('releasing Command clears letters whose keyup macOS omitted without reviving their plain actions', t => {
  const {menu, key, readout} = rehearsal(t);
  menu._onKey(key('MetaLeft', true));
  menu._onKey(key('KeyW', true));
  menu._onKeyUp(key('MetaLeft', false));
  assert.equal(menu.testDown.size, 0);
  assert.equal(readout('#mapTestActions'), 'No keys held. Nothing fires or moves.');
});

test('a Command shortcut whose modifier keydown was outside rehearsal cannot masquerade as plain flight input', t => {
  const {menu, input, key, readout} = rehearsal(t);
  // A pilot can enter the rehearsal with Command already held. Its side is
  // unknown, so do not invent a MetaLeft/MetaRight binding or report plain W.
  menu._onKey(key('KeyW', true));
  assert.equal(input.keyboardHeld('throttle_up', menu.testDown), false);
  assert.doesNotMatch(readout('#mapTestActions'), /Increase throttle/);
  assert.doesNotMatch(readout('#mapTestLast'), /Increase throttle/);
  menu._onKey(key('KeyW', false));
  assert.equal(readout('#mapTestActions'), 'Increase throttle', 'ordinary controls work once Command is released');
});

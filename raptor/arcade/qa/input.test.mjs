import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasPoint, readController, stick } from '../src/input.js';

test('pointer coordinates preserve the arena on desktop, scaled and portrait letterboxed layouts', () => {
  assert.deepEqual(canvasPoint(640, 400, { left: 0, top: 0, width: 1280, height: 800 }), { x: 320, y: 200 });
  assert.deepEqual(canvasPoint(190, 280, { left: 10, top: 100, width: 360, height: 360 }), { x: 320, y: 200 });
  assert.deepEqual(canvasPoint(10, 167.5, { left: 10, top: 100, width: 360, height: 360 }), { x: 0, y: 0 });
  assert.deepEqual(canvasPoint(99, 99, { left: 0, top: 0, width: 0, height: 0 }), { x: 320, y: 320 });
});

test('controller deadzone prevents drift; directional pads and abilities use standard browser mappings', () => {
  assert.equal(stick(.13), 0); assert.equal(stick(-.1), 0); assert.equal(stick(NaN), 0);
  assert.equal(stick(-1), -1); assert.equal(stick(1), 1);
  const pad = { connected: true, axes: [.5, -.5], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  pad.buttons[0].pressed = true; pad.buttons[14].pressed = true;
  assert.deepEqual(readController(pad), { x: -1, y: stick(-.5), missile: true, roll: false, pause: false });
  assert.deepEqual(readController(null), { x: 0, y: 0, missile: false, roll: false, pause: false });
});

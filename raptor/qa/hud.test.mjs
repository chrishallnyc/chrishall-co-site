import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD } from '../src/game/hud.js';

// Exercise the real drawing pass. Only the canvas/DOM are replaced: recording
// transformed coordinates catches mixing the world overlays' CSS pixels with
// the instruments' adjustable logical pixels.
function fixture(t, nativeDpr) {
  const width = 1280, height = 800, marks = [], stack = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const point = (x, y) => ({
    x: transform[0] * x + transform[2] * y + transform[4],
    y: transform[1] * x + transform[3] * y + transform[5],
  });
  const canvas = { style: {}, remove() {}, getContext: () => ctx };
  const ctx = {
    canvas,
    setTransform(...matrix) { transform = matrix; },
    save() { stack.push([...transform]); },
    restore() { assert.ok(stack.length, 'balanced canvas saves'); transform = stack.pop(); },
    clearRect() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillRect() {}, strokeText() {},
    fillText(text, x, y) { marks.push({ kind: 'text', text, ...point(x, y) }); },
    arc(x, y, radius) {
      marks.push({ kind: 'arc', radius, renderedRadius: radius * transform[0], ...point(x, y) });
    },
    strokeRect(x, y, w, h) {
      marks.push({ kind: 'rect', width: w, height: h,
        renderedWidth: w * transform[0], renderedHeight: h * transform[3], ...point(x, y) });
    },
  };
  const parent = { appendChild() {}, getBoundingClientRect: () => ({ width, height }) };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.window = { innerWidth: width, innerHeight: height, devicePixelRatio: nativeDpr,
    addEventListener() {}, removeEventListener() {} };
  globalThis.document = { body: parent, createElement: () => canvas };
  const hud = new HUD({ parent });
  t.after(() => {
    hud.dispose();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
  });
  return { hud, marks, stack, width, height };
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} vs ${expected}`);
}

for (const nativeDpr of [1, 2]) {
  for (const scale of [0.8, 1, 1.4]) {
    test(`HUD scale ${scale} at DPR ${nativeDpr} preserves world projection and screen edges`, t => {
      const { hud, marks, stack, width, height } = fixture(t, nativeDpr);
      const drawOverlay = (layer, bottomOffset) => ctx => {
        // main.js projects world positions into the canvas's physical CSS box.
        const w = ctx.canvas.width / nativeDpr, h = ctx.canvas.height / nativeDpr;
        ctx.fillText(`${layer} center`, w / 2, h / 2);
        ctx.fillText(`${layer} bottom`, w / 2, h - bottomOffset);
        // A hook may change its transform without affecting later instruments.
        ctx.setTransform(9, 0, 0, 9, 200, 300);
      };
      hud.arcadeLayer = drawOverlay('mid', 34);
      hud.arcadeTopLayer = drawOverlay('top', 58);
      hud.setScale(scale);
      hud.update({ speedKt: 420, altFt: 12000, throttle: 80 });

      assert.equal(hud.canvas.width, width * nativeDpr);
      assert.equal(hud.canvas.height, height * nativeDpr);
      for (const layer of ['mid', 'top']) {
        const center = marks.find(mark => mark.text === `${layer} center`);
        close(center.x, width / 2 * nativeDpr, `${layer} projected center x`);
        close(center.y, height / 2 * nativeDpr, `${layer} projected center y`);
        const bottom = marks.find(mark => mark.text === `${layer} bottom`);
        close(bottom.x, width / 2 * nativeDpr, `${layer} bottom center x`);
        close(bottom.y, (height - (layer === 'mid' ? 34 : 58)) * nativeDpr, `${layer} bottom margin`);
      }

      const boresight = marks.find(mark => mark.kind === 'arc' && mark.radius === 2);
      close(boresight.x, width / 2 * nativeDpr, 'core boresight center x');
      close(boresight.y, height / 2 * nativeDpr, 'core boresight center y');
      close(boresight.renderedRadius, 2 * scale * nativeDpr, 'core boresight scale');
      const speedBox = marks.find(mark => mark.kind === 'rect' && mark.width === 58);
      close(speedBox.renderedWidth, 58 * scale * nativeDpr, 'core tape scale');
      close(speedBox.x, (74 - 29) * scale * nativeDpr, 'core tape inset');
      const throttle = marks.find(mark => mark.text === 'THR');
      close(throttle.x, (width - 20 * scale) * nativeDpr, 'core throttle right margin');
      assert.equal(stack.length, 0, 'drawing restores every saved transform');
    });
  }
}

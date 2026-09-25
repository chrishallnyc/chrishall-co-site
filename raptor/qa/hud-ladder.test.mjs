import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD, rungPoint, pxPerDegree, VFOV_DEG, LADDER_RUNG_STEP, LADDER_GAP, LADDER_HALF_W } from '../src/game/hud.js';

function canvasRecorder() {
  const strokes = [], labels = [], stack = [];
  let path = [], dash = [], style = {};
  const ctx = {
    beginPath() { path = []; },
    moveTo(x, y) { path.push(x, y); },
    lineTo(x, y) { path.push(x, y); },
    setLineDash(value) { dash = [...value]; },
    save() { stack.push({ ...style }); },
    restore() { style = stack.pop(); },
    stroke() { strokes.push({ ...style, dash: [...dash], points: [...path] }); },
    strokeText(text, x, y) { labels.push({ pass: 'halo', text, x, y, ...style }); },
    fillText(text, x, y) { labels.push({ pass: 'fill', text, x, y, ...style }); },
  };
  for (const property of ['font', 'textAlign', 'textBaseline', 'globalCompositeOperation', 'strokeStyle', 'lineWidth', 'lineJoin']) {
    Object.defineProperty(ctx, property, { set(value) { style[property] = value; }, get() { return style[property]; } });
  }
  return { ctx, strokes, labels, stack };
}

// Public rungPoint remains the independent geometry oracle. It rotates each
// point separately; the drawing pass instead fills shared scalar buffers.
function expected(hud, pitch, roll) {
  const batches = { solid: [], dashed: [], horizon: [] }, labels = [];
  const half = VFOV_DEG / 2 + LADDER_RUNG_STEP * 2;
  const lo = Math.ceil((pitch - half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;
  const hi = Math.floor((pitch + half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;
  const point = (rung, x, y = 0) => rungPoint(rung, pitch, roll, hud.cx, hud.cy, hud.pxPerDeg, x, y);
  const segment = (array, a, b) => array.push(a.x, a.y, b.x, b.y);
  for (let rung = lo; rung <= hi; rung += LADDER_RUNG_STEP) {
    if (Math.abs(rung) > 90) continue;
    for (const side of [-1, 1]) {
      const end = side * (LADDER_GAP + LADDER_HALF_W);
      segment(batches[rung === 0 ? 'horizon' : rung < 0 ? 'dashed' : 'solid'], point(rung, side * LADDER_GAP), point(rung, end));
      if (rung !== 0) {
        segment(batches.solid, point(rung, end), point(rung, end, Math.sign(rung) * 9));
        labels.push({ text: String(Math.abs(rung)), ...point(rung, end, Math.sign(rung) * 20), textAlign: side < 0 ? 'right' : 'left' });
      }
    }
  }
  return { batches, labels };
}

function verify(hud, pitch, roll) {
  const output = canvasRecorder(), reference = expected(hud, pitch, roll);
  hud._drawLadder(output.ctx, pitch, roll);
  const actual = output.strokes.filter((_, index) => index % 2 === 1);
  const wanted = ['solid', 'dashed', 'horizon'].filter(key => reference.batches[key].length);
  assert.equal(actual.length, wanted.length);
  for (let index = 0; index < wanted.length; index++) {
    const key = wanted[index], points = reference.batches[key];
    assert.deepEqual(actual[index].points, points, `${pitch}/${roll}: ${key} geometry`);
    assert.deepEqual(actual[index].dash, key === 'dashed' ? [7, 6] : []);
    assert.equal(actual[index].lineWidth, key === 'horizon' ? 2 : 1.4);
    const halo = output.strokes[index * 2];
    assert.deepEqual(halo.points, points); assert.equal(halo.globalCompositeOperation, 'source-over');
    assert.equal(halo.lineWidth, actual[index].lineWidth + 2.4);
  }
  assert.equal(output.labels.length, reference.labels.length * 2);
  for (let index = 0; index < reference.labels.length; index++) {
    const { text, x, y, textAlign } = reference.labels[index];
    for (const label of output.labels.slice(index * 2, index * 2 + 2)) {
      assert.equal(label.text, text); assert.equal(label.x, x); assert.equal(label.y, y);
      assert.equal(label.textAlign, textAlign); assert.equal(label.textBaseline, 'middle');
    }
  }
  assert.equal(output.stack.length, 0, 'all canvas state is restored');
  return output;
}

test('ladder canvas geometry matches public pitch/roll math at every compass bank, viewport and UI scale', () => {
  const hud = Object.create(HUD.prototype);
  for (const [width, height] of [[375, 667], [1280, 800], [2560, 1440]]) {
    for (const scale of [.8, 1, 1.4]) {
      Object.assign(hud, { cx: width / scale / 2, cy: height / scale / 2, pxPerDeg: pxPerDegree(height / scale) });
      for (const pitch of [-90, -89.999, -30, -.001, 0, .001, 29.999, 30, 89.999, 90]) {
        for (const roll of [-180, -90, -45, 0, 45, 90, 180]) verify(hud, pitch, roll);
      }
    }
  }
});

test('changing pitch never reuses stale negative rungs, labels or horizon from earlier frames', () => {
  const hud = Object.assign(Object.create(HUD.prototype), { cx: 640, cy: 400, pxPerDeg: 20 });
  for (const pitch of [60, -60, 0, 150, 0, -150, 90, -90, 12.01, 12, -.001, .001]) {
    const output = verify(hud, pitch, 61.4);
    if (Math.abs(pitch) > 120) {
      assert.equal(output.strokes.length, 0); assert.equal(output.labels.length, 0);
    }
  }
});

test('multiple HUDs and repeated unchanged frames have independent, stable geometry', () => {
  const first = Object.assign(Object.create(HUD.prototype), { cx: 640, cy: 400, pxPerDeg: 20 });
  const second = Object.assign(Object.create(HUD.prototype), { cx: 187.5, cy: 333.5, pxPerDeg: 16.675 });
  const before = verify(first, -24, 83);
  verify(second, 72, -130); verify(second, 0, 0);
  const after = verify(first, -24, 83);
  assert.deepEqual(after.strokes, before.strokes); assert.deepEqual(after.labels, before.labels);
});

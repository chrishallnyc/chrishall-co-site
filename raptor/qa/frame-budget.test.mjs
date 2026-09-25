import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget } from '../src/engine/framebudget.js';
import * as settings from '../src/game/settings.js';

globalThis.window = { devicePixelRatio: 2 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const budget = (options = {}) => new FrameBudget({ width: 1440, height: 900, pixelRatio: 2,
  warmup: 0, settleFrames: 0, ...options });
const frames = (b, count, ms = 16.7, options) => {
  const changes = [];
  for (let i = 0; i < count; i++) {
    const change = b.observe(typeof ms === 'function' ? ms(i) : ms, options);
    if (change) changes.push(change);
  }
  return changes;
};

test('AUTO initially bounds Retina output pixels without exceeding a tier request', () => {
  const b = budget();
  close(b.getPixelRatio(), Math.sqrt(1_000_000 / (1440 * 900)));
  assert.equal(b.diagnostics.pixels, 1_000_000);
  assert.equal(b.diagnostics.requestedPixelRatio, 2);
  close(b.diagnostics.resolutionFactor, b.getPixelRatio() / 2);
  close(b.configure({ width: 800, height: 600, pixelRatio: 1 }), 1);
  close(b.configure({ width: 3840, height: 2160, pixelRatio: 1 }), Math.sqrt(1_000_000 / (3840 * 2160)));
});

test('sustained missed refreshes lower resolution only after warming and a full window', () => {
  const b = budget({ warmup: 30, settleFrames: 45 });
  const initial = b.getPixelRatio();
  assert.deepEqual(frames(b, 89, 33.3), []);
  close(b.getPixelRatio(), initial);
  const change = b.observe(33.3);
  close(change.pixelRatio, initial * .9);
  assert.equal(change.median, 33.3);
  assert.equal(change.reason, 'sustained-frame-time');
  assert.equal(b.diagnostics.remainingWarmup, 45);
  assert.equal(b.diagnostics.adjustments, 1);
  assert.deepEqual(frames(b, 104, 33.3), []);
  assert.ok(b.observe(33.3));
});

test('frequent missed frames are detected even when the median remains at 60 Hz', () => {
  const b = budget();
  const changes = frames(b, 60, i => i % 5 === 0 ? 33.3 : 16.7);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].median, 16.7);
  assert.equal(changes[0].slowFraction, .2);
  assert.equal(changes[0].reason, 'frequent-missed-frames');
  const occasional = budget(), initial = occasional.getPixelRatio();
  assert.deepEqual(frames(occasional, 300, i => i % 10 === 0 ? 50 : 16.7), []);
  close(occasional.getPixelRatio(), initial);
});

test('steady display-limited play retains its resolution and never oscillates upward', () => {
  const b = budget();
  const initial = b.getPixelRatio();
  assert.deepEqual(frames(b, 600), []);
  close(b.getPixelRatio(), initial);
  assert.equal(frames(b, 60, 33.3).length, 1);
  const reduced = b.getPixelRatio();
  assert.deepEqual(frames(b, 600, 8.3), []);
  close(b.getPixelRatio(), reduced);
  assert.equal(b.diagnostics.adjustments, 1);
});

test('pause, hiding, terrain settling and benchmarking invalidate partial sample windows', () => {
  for (const guard of ['paused', 'hidden', 'settling', 'benchmarking', 'manual', 'changed']) {
    const b = budget({ settleFrames: 45 });
    frames(b, 59, 33.3);
    assert.equal(b.observe(33.3, { [guard]: true }), null, guard);
    assert.equal(b.diagnostics.samples, 0, guard);
    assert.equal(b.diagnostics.remainingWarmup, 45, guard);
    assert.deepEqual(frames(b, 104, 33.3), [], guard);
    assert.ok(b.observe(33.3), guard);
  }
});

test('gross stalls and invalid frame intervals cannot lower the pixel budget', () => {
  for (const ms of [250, 1000, 0, -1, NaN, Infinity]) {
    const b = budget({ settleFrames: 2 });
    frames(b, 59, 33.3);
    assert.equal(b.observe(ms), null);
    assert.equal(b.diagnostics.adjustments, 0);
    assert.equal(b.diagnostics.samples, 0);
    assert.equal(b.diagnostics.remainingWarmup, 2);
  }
});

test('persistent slowness reaches a bounded floor without endless resolution loss', () => {
  const b = budget();
  const changes = frames(b, 1200, 80);
  assert.equal(changes.length, 3);
  assert.equal(b.diagnostics.pixelBudget, 550_000);
  assert.equal(b.diagnostics.pixels, 550_000);
  close(b.getPixelRatio(), Math.sqrt(550_000 / (1440 * 900)));
  const tiny = budget({ width: 640, height: 480, pixelRatio: 1 });
  assert.deepEqual(frames(tiny, 600, 80), []);
  close(tiny.getPixelRatio(), 1);
});

test('viewport and tier changes preserve learned work limits and rewarm measurements', () => {
  const b = budget({ settleFrames: 45 });
  frames(b, 60, 33.3);
  const learned = b.diagnostics.pixelBudget;
  frames(b, 45 + 59, 33.3);
  b.configure({ width: 1920, height: 1080 });
  assert.equal(b.diagnostics.pixelBudget, learned);
  assert.equal(b.diagnostics.pixels, learned);
  assert.equal(b.diagnostics.samples, 0);
  assert.deepEqual(frames(b, 104, 33.3), []);
  assert.ok(b.observe(33.3));
  b.configure({ pixelRatio: .5 });
  close(b.getPixelRatio(), .5);
  assert.equal(b.diagnostics.remainingWarmup, 45);
});

test('unrelated settings edits preserve both the learned ratio and a partial window', () => {
  const b = budget({ settleFrames: 45 });
  frames(b, 60, 33.3);
  frames(b, 45 + 20, 16.7);
  let ratio = b.getPixelRatio(), resizes = 0;
  const ctx = { baseTier: 'MED',
    renderer: { getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; resizes++; } },
    autoPixelRatio: requested => b.configure({ width: 1440, height: 900, pixelRatio: requested }) };
  for (const masterVol of [.8, .6, .3, 0]) {
    settings.applySettings({ ...settings.DEFAULTS, masterVol }, ctx);
  }
  assert.equal(resizes, 0);
  assert.equal(b.diagnostics.samples, 20);
  assert.equal(b.diagnostics.remainingWarmup, 0);
  close(ratio, b.getPixelRatio());
});

test('manual presets and explicit render scale immediately bypass AUTO resolution', () => {
  const b = budget();
  frames(b, 120, 33.3);
  let ratio = b.getPixelRatio(), calls = 0;
  const ctx = { baseTier: 'MED',
    renderer: { getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; } },
    autoPixelRatio: requested => { calls++; return b.configure({ pixelRatio: requested }); } };
  settings.applySettings({ ...settings.DEFAULTS, tier: 'HIGH' }, ctx);
  assert.equal(ratio, 2);
  settings.applySettings({ ...settings.DEFAULTS, renderScale: .65 }, ctx);
  assert.equal(ratio, 1.3);
  assert.equal(calls, 0);
  settings.applySettings(settings.DEFAULTS, ctx);
  close(ratio, b.getPixelRatio());
  assert.equal(calls, 1);
  const learned = b.pixelBudget;
  assert.equal(b.configure({ enabled: false }), 2);
  assert.deepEqual(frames(b, 600, 100), []);
  assert.equal(b.pixelBudget, learned);
  assert.equal(b.configure({ enabled: true }), ratio);
});

test('a malformed AUTO callback cannot exceed a player request or break renderer size', () => {
  for (const autoRatio of [NaN, Infinity, -1, 0, 10]) {
    let ratio = 1;
    settings.applySettings(settings.DEFAULTS, { baseTier: 'MED',
      renderer: { getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; } },
      autoPixelRatio: () => autoRatio });
    assert.equal(ratio, 2);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FrameBudget } from '../src/engine/framebudget.js';
import { QualityBenchmark } from '../src/engine/qualitybench.js';
import { hasManualTier, saveBench } from '../src/engine/quality.js';
import * as SETTINGS from '../src/game/settings.js';

// Exercise the shipped boot/settings/frame wiring without allocating a GPU.
// Running main's code catches integration errors that a controller-only test
// cannot: applying a ratio twice, overriding a manual setting, or forgetting
// to reset temporal history when the frame loop changes the drawing buffer.
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = main.indexOf(start), to = main.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `main.js wiring is present: ${start}`);
  return main.slice(from, to);
}
const boot = between('  const frameBudget = new FrameBudget(', '  // MAXFI A1: TRAA');
const resize = between('  window.addEventListener("resize", () => {', '  // public hooks');
const frame = between('  function frame(now) {', '    if (input.pressed("debug"))');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function harness({ benchmark = null } = {}) {
  const storage = new Map(), windowEvents = new Map(), documentEvents = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  globalThis.window = { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
    addEventListener: (type, fn) => windowEvents.set(type, fn), dispatchEvent() {} };
  const document = { hidden: false, addEventListener: (type, fn) => documentEvents.set(type, fn) };
  SETTINGS.bindLive(null);
  SETTINGS.loadSettings();
  let ratio = 2, now = 0;
  const calls = { ratios: [], sizes: 0, history: 0, exposure: 0 };
  const state = { tier: 'MED' };
  const renderer = { getPixelRatio: () => ratio,
    setPixelRatio: value => { ratio = value; calls.ratios.push(value); },
    setSize: () => { calls.sizes++; } };
  const terrain = { stats: { detailSettling: false } };
  const cockpit = { paused: false, guide: { open: false }, log: { open: false } };
  const env = {
    FrameBudget, SETTINGS, state, renderer, bootRenderScale: null,
    window, document, camera: { fov: 60, updateProjectionMatrix() {} },
    audio: null, input: { pressed: () => false, setOptions() {}, sampleGamepad() {}, clear() {} },
    hud: null, player: null, voice: null, controls: { open: false }, cockpit,
    sim: { timescale: 1 }, radioSuspended: false, gamepad: { update() {}, pressed: () => false },
    post: { invalidateHistory: () => { calls.history++; } }, meter: { reset: () => { calls.exposure++; } },
    qualityBenchmark: benchmark, hasManualTier, terrain, frameNo: 0, last: 0,
    benchViewport: '1440/900/2', backend: 'webgpu', saveBench,
    benchProfile: 'integration-test', bootCloudQuality: { mode: 'native' }, volPre: null,
    requestAnimationFrame() {}, soundscape: null, commsAudio: null, killCam: null, match: null,
  };
  const program = new Function(...Object.keys(env), `${boot}\n${resize}\n${frame}\n  }\nreturn { frame, frameBudget };`);
  const runtime = program(...Object.values(env));
  return { ...runtime, state, terrain, cockpit, calls, document, storage,
    ratio: () => ratio,
    tick: (ms = 16.7, count = 1) => { for (let i = 0; i < count; i++) runtime.frame(now += ms); },
    visibility: hidden => { document.hidden = hidden; documentEvents.get('visibilitychange')(); },
    resize: (width, height) => { window.innerWidth = width; window.innerHeight = height; windowEvents.get('resize')(); },
  };
}

test('main applies AUTO from the requested DPR once and preserves explicit quality choices', () => {
  const h = harness();
  close(h.ratio(), Math.sqrt(1_000_000 / (1440 * 900)));
  h.tick(16.7, 240);
  assert.equal(h.calls.ratios.length, 1);
  assert.equal(h.calls.history, 0);
  SETTINGS.saveSettings({ tier: 'HIGH' });
  h.tick(33.3, 240);
  assert.equal(h.ratio(), 2);
  assert.equal(h.frameBudget.enabled, false);
  SETTINGS.saveSettings({ tier: 'AUTO', renderScale: .65 });
  h.tick(33.3, 240);
  assert.equal(h.ratio(), 1.3);
  assert.equal(h.frameBudget.enabled, false);
  SETTINGS.saveSettings({ renderScale: null });
  h.tick();
  assert.equal(h.frameBudget.enabled, true);
  close(h.ratio(), Math.sqrt(1_000_000 / (1440 * 900)));
  assert.equal(h.storage.has('raptor:bench:v3'), false);
  assert.equal(JSON.parse(h.storage.get(SETTINGS.KEY)).renderScale, null);
});

test('main resets temporal and exposure history once per measured resolution change', () => {
  const h = harness(), initial = h.ratio();
  h.tick(33.3, 89);
  assert.equal(h.calls.ratios.length, 1);
  h.tick(33.3);
  close(h.ratio(), initial * .9);
  assert.equal(h.calls.history, 1);
  assert.equal(h.calls.exposure, 1);
  h.tick(16.7, 65);
  const samples = h.frameBudget.diagnostics.samples;
  for (const masterVol of [.8, .5, .1]) SETTINGS.saveSettings({ masterVol });
  assert.equal(h.frameBudget.diagnostics.samples, samples);
  assert.equal(h.calls.ratios.length, 2);
  h.tick(16.7, 240);
  close(h.ratio(), initial * .9);
  assert.equal(h.calls.history, 1);
  assert.equal(SETTINGS.current().renderScale, null);
});

test('main discards partial budget windows on pause, visibility, and viewport changes', () => {
  const h = harness();
  h.tick(33.3, 89);
  h.cockpit.paused = true;
  h.tick(33.3, 10);
  assert.equal(h.frameBudget.diagnostics.samples, 0);
  h.cockpit.paused = false;
  h.tick(33.3, 104);
  assert.equal(h.calls.ratios.length, 1);
  h.visibility(true);
  h.tick(33.3, 120);
  assert.equal(h.frameBudget.diagnostics.samples, 0);
  h.visibility(false);
  h.tick(33.3, 104);
  assert.equal(h.calls.ratios.length, 1);
  h.resize(1920, 1080);
  h.tick(33.3);
  close(h.ratio(), Math.sqrt(1_000_000 / (1920 * 1080)));
  assert.equal(h.frameBudget.diagnostics.samples, 0);
  assert.equal(h.frameBudget.diagnostics.remainingWarmup, 44);
  assert.equal(h.calls.sizes, 1);
  const resizes = h.calls.ratios.length;
  h.tick(16.7, 240);
  assert.equal(h.calls.ratios.length, resizes);
});

test('main finishes tier benchmarking before sampling the session pixel budget', () => {
  const h = harness({ benchmark: new QualityBenchmark({ tier: 'MED', backend: 'webgpu', warmup: 0, samples: 3 }) });
  h.tick(33.3, 2);
  assert.equal(h.frameBudget.diagnostics.status, 'benchmarking');
  assert.equal(h.frameBudget.diagnostics.samples, 0);
  h.tick(16.7, 7);
  assert.ok(h.state.bench);
  assert.equal(h.frameBudget.diagnostics.samples, 0);
  assert.equal(h.state.bench.profile, 'integration-test');
  assert.equal(h.frameBudget.diagnostics.adjustments, 0);
});

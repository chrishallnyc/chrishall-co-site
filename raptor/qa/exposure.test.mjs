import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const paths = {
      three: '../vendor/three.webgpu.min.js',
      'three/webgpu': '../vendor/three.webgpu.min.js',
      'three/tsl': '../vendor/three.tsl.min.js',
    };
    if (paths[specifier]) return { url: new URL(paths[specifier], import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const THREE = await import('../vendor/three.webgpu.min.js');
const { vec4 } = await import('../vendor/three.tsl.min.js');
const { AsyncExposure, averageLuminance } = await import('../src/engine/exposure.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let resolveRead, rejectRead;
  const originalTarget = { name: 'scene' }, originalMRT = { name: 'color+velocity' };
  const renderer = {
    target: originalTarget, mrt: originalMRT, reads: 0, renders: 0,
    toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace,
    getRenderTarget() { return this.target; }, setRenderTarget(v) { this.target = v; },
    getMRT() { return this.mrt; }, setMRT(v) { this.mrt = v; },
    compileAsync: async () => {},
    render() { this.renders++; },
    readRenderTargetPixelsAsync() {
      this.reads++;
      return new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
    },
  };
  const meter = new AsyncExposure(renderer, vec4(1, 1, 1, 1));
  return { renderer, meter, originalTarget, originalMRT,
    resolve: () => resolveRead(new Uint8Array(64 * 16 * 4).fill(128)),
    reject: () => rejectRead(new Error('GPU unavailable')),
  };
}

test('log luminance stays finite for black and preserves white', () => {
  assert.ok(Math.abs(averageLuminance(new Uint8Array([0, 0, 0, 255])) - 0.001) < 1e-12);
  assert.ok(Math.abs(averageLuminance(new Uint8Array([255, 255, 255, 255])) - 1) < 1e-12);
  assert.equal(averageLuminance(new Uint8Array()), 0);
});

test('meter returns immediately, never queues overlapping reads, and restores render state', async () => {
  const f = fixture();
  await f.meter.init();
  f.meter.step(0.2);
  assert.equal(f.meter.pending, true);
  assert.equal(f.meter.samples, 0);
  assert.equal(f.renderer.target, f.originalTarget);
  assert.equal(f.renderer.mrt, f.originalMRT);
  f.meter.step(0.4);
  assert.equal(f.renderer.reads, 1);
  assert.equal(f.renderer.renders, 1);
  f.resolve();
  await flush();
  assert.equal(f.meter.pending, false);
  assert.equal(f.meter.samples, 1);
  assert.ok(f.meter.desired < 1);
  assert.ok(f.meter.desired >= 0.55);
  f.meter.dispose();
});

test('paused frames do not advance exposure or start GPU reads', () => {
  const { meter, renderer } = fixture();
  meter.desired = 2;
  for (let i = 0; i < 30; i++) meter.step(0);
  assert.equal(meter.mult, 1);
  assert.equal(renderer.reads, 0);
  meter.dispose();
});

test('a sample uses the exposure of the rendered frame, before next-frame adaptation', async () => {
  const { meter, resolve } = fixture();
  meter.mult = 1;
  meter.desired = 0.55;
  meter.step(0.2);
  assert.ok(meter.mult < 1); // the next frame has started adapting
  resolve();
  await flush();
  // This gray sample came from exposure 1, not the new, darker multiplier.
  const expected = Math.pow(0.42 / (128 / 255), 0.6);
  assert.ok(Math.abs(meter.desired - expected) < 1e-12);
  meter.dispose();
});

test('adaptation depends on elapsed time rather than frame count', () => {
  const run = (fps) => {
    const { meter } = fixture();
    meter.pending = true; // this test isolates adaptation from new light samples
    meter.desired = 2;
    for (let i = 0; i < fps; i++) meter.step(1 / fps);
    const result = meter.mult;
    meter.dispose();
    return result;
  };
  assert.ok(Math.abs(run(30) - run(144)) < 1e-10);
});

test('GPU readback failure keeps the last exposure and stops retrying', async () => {
  const { meter, renderer, reject } = fixture();
  const warn = console.warn;
  console.warn = () => {};
  try {
    meter.mult = 1.25;
    meter.desired = 1.25;
    meter.step(0.2);
    reject();
    await flush();
    assert.equal(meter.failed, true);
    assert.equal(meter.pending, false);
    meter.step(10);
    assert.equal(renderer.reads, 1);
    assert.equal(meter.mult, 1.25);
  } finally { console.warn = warn; meter.dispose(); }
});

test('disposing an in-flight meter ignores its late result', async () => {
  const { meter, resolve } = fixture();
  meter.step(0.2);
  meter.dispose();
  resolve();
  await flush();
  assert.equal(meter.samples, 0);
  assert.equal(meter.desired, 1);
});

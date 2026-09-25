import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AsyncExposureMeter, displayLogAverage } from '../src/engine/exposure-meter.js';

function pixels(size, stride = size * 4, value = 76) {
  const bytes = new Uint8Array((size - 1) * stride + size * 4).fill(251);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * stride + x * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = value;
    bytes[i + 3] = 255;
  }
  return bytes;
}
function fixture() {
  let clock = 0;
  const reads = [], disposed = [];
  const target = {}, mrt = {};
  const source = new THREE.RenderTarget(1440, 900).texture;
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace,
    toneMappingExposure: .18, autoClear: false, xr: { enabled: true }, target, face: 4, mip: 2, mrt,
    getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.face; },
    getActiveMipmapLevel() { return this.mip; }, getMRT() { return this.mrt; },
    setMRT(value) { this.mrt = value; },
    setRenderTarget(value, face = 0, mip = 0) { this.target = value; this.face = face; this.mip = mip; },
    render() { assert.equal(this.mrt, null); assert.equal(this.xr.enabled, false); },
    readRenderTargetPixelsAsync() {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      reads.push({ resolve, reject }); return promise;
    },
  };
  const meter = new AsyncExposureMeter(renderer, () => source, { now: () => clock });
  for (const [name, object] of Object.entries({ target: meter._target, material: meter._material,
    placeholder: meter._placeholder, source })) object.addEventListener('dispose', () => disposed.push(name));
  return { meter, reads, disposed, tick(time) { clock = time; meter.update(); },
    assertRestored() {
      assert.equal(renderer.target, target); assert.equal(renderer.mrt, mrt);
      assert.equal(renderer.face, 4); assert.equal(renderer.mip, 2);
      assert.equal(renderer.autoClear, false); assert.equal(renderer.xr.enabled, true);
    } };
}

test('GPU row padding cannot bias the exposure measurement', () => {
  for (const size of [16, 32]) {
    const expected = 76 / 255;
    for (const stride of [size * 4, 256]) {
      assert.ok(Math.abs(displayLogAverage(pixels(size, stride), size) - expected) < 1e-12);
    }
  }
  assert.throws(() => displayLogAverage(new Float32Array(1024), 16));
  assert.throws(() => displayLogAverage(new Uint8Array(2048), 16));
});

test('slow GPU reads stay singular and camera cuts discard stale exposure', async () => {
  const f = fixture();
  f.tick(.2);
  for (let frame = 0; frame < 120; frame++) f.tick(.3 + frame / 60);
  assert.equal(f.reads.length, 1); f.assertRestored();
  f.meter.reset();
  f.reads[0].resolve(pixels(16, 256, 0));
  await f.meter._pending;
  assert.equal(f.meter.mult, 1); assert.equal(f.meter.state.samples, 0);
  assert.equal(f.meter.state.discarded, 1); assert.equal(f.meter.state.pending, false);
  f.meter.dispose();
});

test('disposing during readback defers owned resources and preserves the input', async () => {
  const f = fixture(); f.tick(.2); f.meter.dispose(); f.meter.dispose();
  assert.deepEqual(f.disposed, []);
  f.reads[0].resolve(pixels(16)); await f.meter._pending;
  assert.deepEqual(f.disposed.sort(), ['material', 'placeholder', 'target']);
  f.tick(10); f.meter.reset();
  assert.equal(f.reads.length, 1); assert.equal(f.meter.state.status, 'disposed');
});

test('readback failure returns to palette exposure without retrying every frame', async () => {
  const f = fixture(); f.meter.state.mult = 1.5; f.tick(.2);
  f.reads[0].reject(new Error('GPU read rejected')); await f.meter._pending;
  assert.equal(f.meter.mult, 1); assert.equal(f.meter.state.status, 'palette');
  for (let frame = 0; frame < 120; frame++) f.tick(1 + frame / 60);
  assert.equal(f.reads.length, 1); assert.equal(f.meter.state.errors, 1); f.assertRestored();
  f.meter.dispose();
});

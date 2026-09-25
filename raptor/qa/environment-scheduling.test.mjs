import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { SkyEnvironment, SkyEnvironmentScheduler } from '../src/world/sky-environment.js';

function fixture(label, operations) {
  const scales = [], publications = [];
  const state = { target: null, face: 0, mip: 0, mrt: null };
  let probe;
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: true,
    xr: { enabled: false }, shadowMap: {},
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip, getMRT: () => state.mrt,
    setMRT: mrt => { state.mrt = mrt; },
    setRenderTarget: (target, face = 0, mip = 0) => Object.assign(state, { target, face, mip }),
    render: () => operations.push({ label, kind: 'face', face: probe.face,
      irradiance: probe.sources.uSunI.value, origin: probe.uObserver.value.clone() }),
  };
  const sources = { uSunI: uniform(36), uSunDir: uniform(new THREE.Vector3(0, 1, 0)) };
  probe = new SkyEnvironment({ renderer, label, sourceUniforms: sources,
    luts: { tTex: new THREE.Texture(), msTex: new THREE.Texture() }, size: 32,
    publish: texture => publications.push(texture), rescale: gain => scales.push(gain),
  });
  probe._pmrem.fromCubemap = (texture, reuse) => {
    operations.push({ label, kind: 'convolve' });
    return reuse || new THREE.RenderTarget(96, 128);
  };
  return { probe, renderer, sources, publications, scales };
}

test('shared reflection budget keeps captures frozen, fair, and limited to one GPU operation per frame', () => {
  const operations = [], a = fixture('aircraft', operations), b = fixture('water', operations);
  const scheduler = new SkyEnvironmentScheduler(), probes = [a.probe, b.probe];
  const camera = new THREE.PerspectiveCamera();
  for (const probe of probes) { probe.warmUp(camera, 0); probe.invalidate('test'); }
  const firstMaps = [a.publications[0], b.publications[0]];
  operations.length = 0;
  try {
    for (let frame = 1; frame <= 14; frame++) {
      camera.position.set(frame * 1000, 2000, 0);
      a.sources.uSunI.value = 100 + frame; b.sources.uSunI.value = 200 + frame;
      const before = operations.length, scalesBefore = [a.scales.length, b.scales.length];
      scheduler.update(probes, camera, frame / 60);
      assert.equal(operations.length - before, 1, `frame ${frame} has one face or convolution`);
      assert(a.scales.length > scalesBefore[0] && b.scales.length > scalesBefore[1],
        'both published maps follow live exposure on every frame');
      if (frame < 12) assert.deepEqual(a.publications, [firstMaps[0]]);
      if (frame < 14) assert.deepEqual(b.publications, [firstMaps[1]]);
    }
    for (const [label, f, irradiance, originX] of [
      ['aircraft', a, 101, 1000], ['water', b, 202, 2000],
    ]) {
      const faces = operations.filter(op => op.label === label && op.kind === 'face');
      assert.deepEqual(faces.map(op => op.face), [0, 1, 2, 3, 4, 5]);
      assert(faces.every(op => op.irradiance === irradiance && op.origin.x === originX),
        'a capture retains its own lighting and observer while another probe advances');
      assert.equal(f.publications.length, 2);
      assert.notEqual(f.publications[1], f.publications[0], 'complete publication swaps buffers');
    }
    assert.deepEqual(operations.slice(0, 10).map(op => op.label),
      Array.from({ length: 10 }, (_, i) => i % 2 ? 'water' : 'aircraft'));
    assert.equal(operations[11].kind, 'convolve', 'a complete capture publishes before another face');
    assert.equal(scheduler.update(probes, camera, .3), null, 'clean probes submit no work');
  } finally { probes.forEach(probe => probe.dispose()); }
});

test('ready publications share the budget and neither probe starves under repeated invalidation', () => {
  const operations = [], a = fixture('a', operations), b = fixture('b', operations);
  const scheduler = new SkyEnvironmentScheduler(), probes = [a.probe, b.probe];
  const camera = new THREE.PerspectiveCamera();
  try {
    // Simultaneously ready captures are possible when joining the shared scheduler.
    for (const probe of probes) {
      probe._begin(camera, 0, 'test');
      for (let face = 0; face < 6; face++) probe._renderFace();
    }
    operations.length = 0;
    scheduler.update(probes, camera, 1); scheduler.update(probes, camera, 2);
    assert.deepEqual(operations.map(op => [op.label, op.kind]), [['a', 'convolve'], ['b', 'convolve']]);
    operations.length = 0;
    for (let frame = 0; frame < 42; frame++) {
      probes.forEach(probe => probe.invalidate('continuous-change'));
      const before = operations.length;
      scheduler.update(probes, camera, 3 + frame / 60);
      assert.equal(operations.length - before, 1);
    }
    assert.equal(a.publications.length, 4); assert.equal(b.publications.length, 4);
    assert.equal(a.probe.stats.facesRendered, b.probe.stats.facesRendered);
  } finally { probes.forEach(probe => probe.dispose()); }
});

test('a failed probe retains exposure updates while healthy probes keep progressing', () => {
  const operations = [], a = fixture('failed', operations), b = fixture('healthy', operations);
  const scheduler = new SkyEnvironmentScheduler(), probes = [null, a.probe, b.probe];
  const camera = new THREE.PerspectiveCamera();
  for (const probe of [a.probe, b.probe]) { probe.warmUp(camera, 0); probe.invalidate('test'); }
  a.renderer.render = () => { throw new Error('capture unavailable'); };
  const warn = console.warn; console.warn = () => {};
  try {
    scheduler.update(probes, camera, 1);
    assert.equal(a.probe.failed, true);
    a.sources.uSunI.value = 72;
    for (let frame = 0; frame < 7; frame++) scheduler.update(probes, camera, 1 + frame / 60);
    assert.equal(a.scales.at(-1), 2, 'failed probe still rescales its last complete map');
    assert.equal(a.publications.length, 1); assert.equal(b.publications.length, 2);
    assert.equal(scheduler.update([], camera, 2), null);
    assert.equal(scheduler.update([null, a.probe], camera, 2), null);
  } finally {
    console.warn = warn; a.probe.dispose(); b.probe.dispose();
  }
});

test('invalidation failure is isolated before selecting another healthy probe', () => {
  const operations = [], a = fixture('failed', operations), b = fixture('healthy', operations);
  const camera = new THREE.PerspectiveCamera(), scheduler = new SkyEnvironmentScheduler();
  a.probe._reason = () => { throw new Error('observer unavailable'); };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(scheduler.update([a.probe, b.probe], camera, 0), b.probe);
    assert.equal(a.probe.failed, true);
    assert.deepEqual(operations.map(op => [op.label, op.kind]), [['healthy', 'face']]);
  } finally {
    console.warn = warn; a.probe.dispose(); b.probe.dispose();
  }
});

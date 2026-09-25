// Actual cache scheduling and pinned WGSL generation, without a browser/GPU.
// Mock dispatch checks ownership/publication; it does not measure GPU time.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { CloudLightCache, CLOUD_LIGHT_CACHE_DEFAULTS as defaults } from '../src/world/cloudlightcache.js';
import { PlanetCurvature, bendPoint, unbendPoint } from '../src/world/planetcurvature.js';
import { cloudNoiseFromData } from '../src/world/cloudnoise.js';
import { decodeCloudNoise } from '../src/world/cloudnoiseencoding.js';

// Decode the checked-in field instead of baking a second recipe or using a
// zero-filled mock. All fixtures share these immutable input textures.
const assets = new URL('../assets/cloudnoise/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('1337-standard.json', assets), 'utf8'));
const data = { ...manifest };
for (const channel of ['base', 'detail']) {
  const bytes = new Uint8Array(gunzipSync(await readFile(new URL(manifest[channel].file, assets))));
  decodeCloudNoise(bytes, manifest[channel + 'N']);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest[channel].sha256);
  data[channel + 'Data'] = bytes;
}
const noise = cloudNoiseFromData(data);
after(() => { for (const texture of [noise.baseTex, noise.detailTex, noise.jitterTex]) texture.dispose(); });

function fixture(front = 'MARIANAS', night = false) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(6082, 1900, 8938);
  const curvature = new PlanetCurvature();
  curvature.beginFrame(camera); curvature.endFrame();
  const sun = uniform(new THREE.Vector3(.7, night ? -.5 : .5, .5).normalize());
  const moon = uniform(new THREE.Vector3(-.3, .7, .5).normalize());
  const cache = new CloudLightCache({ noise, front, curvature, camera, uSunDir: sun,
    aerial: { celestial: { uMoonDir: moon } } });
  return { cache, camera, curvature, sun, moon,
    tick(renderer = { compute() {} }) {
      curvature.beginFrame(camera);
      cache.update(renderer);
      curvature.endFrame();
    } };
}

function untilReady(f, renderer) {
  let frames = 0;
  while (f.cache._sources.some(source => !source.hasData)) {
    f.tick(renderer);
    assert(++frames < 500, 'cold production finishes in bounded updates');
  }
  return frames;
}

for (const front of ['NELLIS', 'VALDEZ', 'MARIANAS']) {
  test(`${front} publishes complete source volumes with one bounded staging texture`, () => {
    const f = fixture(front), { cache } = f;
    const textures = new Set([...cache._sources.map(source => source.texture), cache._staging]);
    const coverage = new Map();
    let dispatches = 0, maxSamples = 0, maxBytes = 0;
    const renderer = { compute(node) {
      const job = cache._job, source = job.source;
      assert.equal(node, source.compute);
      assert(node.count > 0 && node.count <= 640, 'at most 640 columns per frame');
      assert.equal(source.producer.offset.value, job.completed);
      assert.equal(source.producer.storage.value, cache._staging);
      assert(!cache._sources.some(source => source.texture === cache._staging), 'partial output cannot be sampled');
      assert(cache.producerCurvature.origin.value.equals(job.origin));
      if (!coverage.has(job)) coverage.set(job, new Uint8Array(job.count));
      const written = coverage.get(job);
      for (let i = job.completed; i < job.completed + node.count; i++) {
        assert.equal(written[i], 0, 'each column is produced exactly once'); written[i]++;
      }
      dispatches++;
      maxSamples = Math.max(maxSamples, node.count * job.lattice.cells.z
        * Math.ceil(defaults.depthStepM / defaults.integrationStepM));
    } };
    const tick = () => { f.tick(renderer); maxBytes = Math.max(maxBytes, cache.stats.bytes); };
    try {
      let frames = 0;
      while (cache._sources.some(source => !source.hasData)) { tick(); assert(++frames < 500); }
      for (const written of coverage.values()) assert(written.every(count => count === 1));
      assert.equal(cache.stats.bakes, 4);
      assert.equal(new Set([...cache._sources.map(source => source.texture), cache._staging]).size, 5);
      assert([...cache._sources.map(source => source.texture), cache._staging].every(texture => textures.has(texture)));
      const completedDispatches = dispatches;
      for (let i = 0; i < 60; i++) tick();
      assert.equal(dispatches, completedDispatches, 'stationary frames reuse all four volumes');

      const published = cache._sources.map(source => ({ texture: source.texture, origin: source.frame.origin.value.clone() }));
      f.camera.position.x += defaults.refreshOriginDriftM + 100;
      tick();
      assert(cache._job);
      assert(cache._sources.every(source => source.valid.value), 'refresh retains still-valid front volumes');
      for (let i = 0; i < 4; i++) {
        assert.equal(cache._sources[i].texture, published[i].texture);
        assert(cache._sources[i].frame.origin.value.equals(published[i].origin));
      }
      let refreshFrames = 0;
      while (cache.stats.bakes < 8) { tick(); assert(++refreshFrames < 500); }
      assert(cache._sources.every(source => source.frame.origin.value.equals(f.curvature.origin.value)));
      assert(maxSamples <= 2_616_320, 'nominal density work is bounded per update');
      assert(maxBytes < 230 * 1024 * 1024, 'four visible volumes plus staging remain bounded');

      let disposed = 0;
      for (const texture of textures) texture.addEventListener('dispose', () => disposed++);
      cache.dispose(); cache.dispose();
      assert.equal(disposed, 5);
      assert(cache._sources.every(source => !source.valid.value));
      assert.throws(() => f.tick(renderer), /disposed/);
    } finally { cache.dispose(); }
  });
}

test('source and camera cuts reject stale or failed producers without publishing partial data', () => {
  const f = fixture(), { cache } = f;
  let dispatches = 0;
  const renderer = { compute() { dispatches++; } };
  try {
    untilReady(f, renderer);
    f.sun.value.applyAxisAngle(new THREE.Vector3(0, 1, 0), .0003);
    f.tick(renderer);
    const obsolete = cache._job;
    assert(obsolete);
    const publications = cache.stats.bakes;
    f.sun.value.applyAxisAngle(new THREE.Vector3(0, 1, 0), .1);
    f.tick(renderer);
    assert(cache.stats.discarded >= 1);
    assert.notEqual(cache._job, obsolete);
    assert.equal(cache.stats.bakes, publications);
    assert(!cache._sources[0].valid.value);
    assert(cache._sources[2].valid.value && cache._sources[3].valid.value);
    let frames = 0;
    while (!cache._sources[0].valid.value) { f.tick(renderer); assert(++frames < 100); }

    cache.enabled = false;
    const beforeDisabled = dispatches;
    f.tick(renderer);
    assert(cache._sources.every(source => !source.valid.value));
    assert.equal(dispatches, beforeDisabled);
    cache.enabled = true; f.tick(renderer);
    assert(cache._sources[0].valid.value);

    f.camera.position.x += defaults.maxOriginDriftM + 100;
    f.tick(renderer);
    assert(cache._sources.every(source => !source.valid.value));
    const beforeFailure = cache.stats.bakes;
    assert.throws(() => f.tick({ compute() { throw Error('producer failed'); } }), /producer failed/);
    assert.equal(cache._job, null);
    assert.equal(cache.stats.bakes, beforeFailure);
    assert(cache._sources.every(source => !source.valid.value));
    f.tick(renderer); assert(cache._job);
    const moon = f.moon.value.clone(); f.moon.value.set(NaN, 0, 0);
    f.tick(renderer);
    assert.equal(cache._job, null);
    assert(cache._sources.every(source => !source.valid.value));
    f.moon.value.copy(moon); f.tick(renderer); assert(cache._job);
  } finally { cache.dispose(); }
});

for (const night of [false, true]) {
  test(`${night ? 'night' : 'day'} primary and sky caches stay valid through bounded moving-camera schedules`, () => {
    for (const fps of [13, 30, 60]) for (const speedMps of [200, 240, 600]) {
      const f = fixture('MARIANAS', night), primary = night ? 1 : 0;
      try {
        untilReady(f);
        for (let frame = 0; frame < 600; frame++) {
          f.camera.position.x += speedMps / fps;
          f.tick();
          for (const kind of [primary, 2, 3]) assert(f.cache._sources[kind].valid.value,
            `source ${kind}, ${fps} fps scheduling, ${speedMps} m/s, frame ${frame}`);
          assert(f.cache.stats.lastBatchDensitySamples <= 2_616_320);
        }
        // Secondary celestial work may be preempted; its direct-light
        // fallback remains available. These are schedules, not GPU FPS.
      } finally { f.cache.dispose(); }
    }
  });
}

test('frozen-frame/source reuse stays inside the physical endpoint coverage guard', () => {
  let seed = 129831;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const unit = () => new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
  let maximum = 0;
  for (let i = 0; i < 10000; i++) {
    const point = new THREE.Vector3((random() - .5) * 48000, 500 + random() * 5000, (random() - .5) * 48000);
    const angle = random() * Math.PI * 2, zero = new THREE.Vector2();
    const origin = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(defaults.maxOriginDriftM);
    const oldDirection = unit(), direction = oldDirection.clone().applyAxisAngle(unit(), defaults.maxSourceAngleRad).normalize();
    const distance = random() * 6180;
    const actual = bendPoint(unbendPoint(bendPoint(point, origin).addScaledVector(direction, distance), origin), zero);
    const stored = bendPoint(point, zero).addScaledVector(oldDirection, distance);
    maximum = Math.max(maximum, actual.distanceTo(stored));
  }
  assert(maximum < defaults.coverageGuardM, `sampled endpoint deviation ${maximum} m`);
});

test('every compute producer declares its own density textures on the same pinned renderer', () => {
  const renderer = new THREE.WebGPURenderer({ canvas: { width: 64, height: 64, style: {},
    addEventListener() {}, removeEventListener() {} } });
  renderer.backend.renderer = renderer; renderer.hasFeature = () => false;
  for (const front of ['NELLIS', 'VALDEZ', 'MARIANAS']) {
    const f = fixture(front);
    try {
      untilReady(f);
      for (const source of f.cache._sources) {
        const builder = new THREE.WGSLNodeBuilder(source.compute, renderer); builder.build();
        const shader = builder.computeShader;
        const declared = new Set([...shader.matchAll(/var\s+(nodeUniform\d+)\s*:\s*texture_/g)].map(match => match[1]));
        const used = new Set([...shader.matchAll(/texture(?:Sample(?:Level)?|Load|Store)\(\s*(nodeUniform\d+)/g)].map(match => match[1]));
        assert.equal(declared.size, 3, 'base/detail density textures and one output');
        assert.deepEqual([...used].filter(name => !declared.has(name)), [], 'no binding leaked from an earlier producer');
        assert.match(shader, /texture_storage_3d<rgba16float, write>/);
        assert.match(shader, /pack2x16float/); assert.match(shader, /unpack2x16float/);
        assert.doesNotMatch(shader, /textureSample\(|undefined|NaN/);
      }
    } finally { f.cache.dispose(); }
  }
});

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QualityBenchmark } from '../src/engine/qualitybench.js';
import { qualityProfile, qualityWorkload, cloudQuality, cloudOptionsFromFlags, QUALITY_PROFILE_VERSION } from '../src/engine/cloudquality.js';
import { detectTier, hasManualTier, setTier, saveBench, isCompatibleBench } from '../src/engine/quality.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { hardwareConcurrency: 12, deviceMemory: 16 }, configurable: true,
});
globalThis.matchMedia = () => ({ matches: false });
beforeEach(() => storage.clear());

const profile = (front = 'NELLIS', query = '') => qualityProfile({
  backend: 'webgpu', mode: 'native', renderScale: null, pixelRatio: 1,
  width: 1440, height: 900, front, workload: qualityWorkload(new URLSearchParams(query)),
});

test('a stored benchmark applies only to the measured front and rendering path', () => {
  const measured = profile();
  saveBench({ ms: 16.7, tier: 'LOW', backend: 'webgpu', profile: measured });
  assert.equal(detectTier({ backend: 'webgpu', profile: measured }), 'LOW');
  for (const other of [profile('MARIANAS'), profile('NELLIS', 'noterrain=1'),
    profile('NELLIS', 'vclouds=0'), profile('NELLIS', 'post=0'),
    profile('NELLIS', 'curvature=0'), profile('NELLIS', 'reversedepth=1')]) {
    assert.equal(detectTier({ backend: 'webgpu', profile: other }), 'HIGH');
  }
  assert.equal(profile('NELLIS', 'ao=1&post=0'), profile('NELLIS', 'post=0&ao=1'));
  assert.equal(profile('NELLIS', 'yaw=20&tod=17'), measured);
});

test('valid manual quality wins; corrupt manual values do not suppress auto selection', () => {
  saveBench({ ms: 16.7, tier: 'LOW', backend: 'webgpu', profile: profile() });
  setTier('ULTRA');
  assert.equal(hasManualTier(), true);
  assert.equal(detectTier({ backend: 'webgpu', profile: profile() }), 'ULTRA');
  storage.set('raptor:quality:v1', 'BROKEN');
  assert.equal(hasManualTier(), false);
  assert.equal(detectTier({ backend: 'webgpu', profile: profile() }), 'LOW');
});

test('water rendering overrides cannot reuse the default workload benchmark', () => {
  const measured = profile();
  const record = { ms: 16.7, tier: 'LOW', backend: 'webgpu', profile: measured };
  saveBench(record);
  assert.equal(detectTier({ backend: 'webgpu', profile: measured }), 'LOW');
  for (const query of ['watergrid=legacy', 'waterslopes=legacy', 'watershadow=0', 'waterenvsize=64', 'aircraftAir=0', 'aircraftShadows=0', 'reverseDepth=0', 'skycache=0', 'geographicdetail=0', 'terrainphoto=0']) {
    const options = { backend: 'webgpu', profile: profile('NELLIS', query) };
    assert.equal(isCompatibleBench(record, options), false, query);
    assert.equal(detectTier(options), 'HIGH', query);
  }
  assert.equal(profile('NELLIS', 'watergrid=legacy&waterenvsize=64'),
    profile('NELLIS', 'waterenvsize=64&watergrid=legacy'));
});

test('auto quality measures each workload once and cannot oscillate after a failed upgrade', () => {
  const bench = new QualityBenchmark({ tier: 'MED', backend: 'webgpu', warmup: 2, samples: 3 });
  const visited = [], costs = { LOW: 16.7, MED: 16.7, HIGH: 33.3 };
  let result;
  for (let frame = 0; frame < 20 && !result?.complete; frame++) {
    if (visited.at(-1) !== bench.tier) visited.push(bench.tier);
    result = bench.observe(costs[bench.tier]);
  }
  assert.equal(result?.complete, true);
  assert.equal(result.tier, 'MED');
  assert.equal(result.median, costs.MED);
  assert.deepEqual(visited, ['MED', 'HIGH']);
  assert.equal(bench.observe(16.7), null);
});

test('hidden frames restart warmup and user changes cancel the benchmark', () => {
  const bench = new QualityBenchmark({ tier: 'HIGH', backend: 'webgpu', warmup: 2, samples: 3 });
  for (let frame = 0; frame < 4; frame++) bench.observe(16.7);
  bench.observe(1000, { hidden: true });
  for (let frame = 0; frame < 4; frame++) assert.equal(bench.observe(16.7), null);
  assert.equal(bench.observe(16.7).complete, true);
  for (const reason of ['manual', 'changed']) {
    const interrupted = new QualityBenchmark({ tier: 'HIGH', backend: 'webgpu' });
    assert.deepEqual(interrupted.observe(16.7, { [reason]: true }), { cancelled: true });
    assert.equal(interrupted.observe(16.7), null);
  }
});

test('noise resolution is independent of output scale and native mode remains full resolution', () => {
  assert.equal(cloudQuality('LOW', { mode: 'native' }).scale, 1);
  assert.equal(cloudQuality('LOW', { mode: 'adaptive', noise: 'ultra' }).noise, 'ultra');
  assert.equal(cloudQuality('HIGH', { mode: 'adaptive', scale: .5 }).scale, .5);
  assert.throws(() => cloudQuality('HIGH', { mode: 'adaptive', scale: 0 }));
  for (const [tier, noise] of [['LOW', 'standard'], ['MED', 'standard'], ['HIGH', 'high'], ['ULTRA', 'ultra']]) {
    assert.equal(cloudQuality(tier).noise, noise);
    for (const selected of ['standard', 'high', 'ultra']) {
      assert.equal(cloudQuality(tier, cloudOptionsFromFlags(new URLSearchParams({ cloudnoise: selected }))).noise, selected);
    }
  }
  assert.equal(cloudQuality('HIGH', cloudOptionsFromFlags(new URLSearchParams('cloudnoise=unknown'))).noise, 'high');
  assert.throws(() => cloudQuality('HIGH', { noise: 'unknown' }), /noise resolution/);
});

// Execute the actual boot decision code with renderer/adapter test doubles.
// No shader, browser or GPU is needed to cover constructor and fallback paths.
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const rendererStart = mainSource.indexOf('async function makeRenderer(canvas) {');
const rendererEnd = mainSource.indexOf('\nasync function boot()', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'Actual renderer boot function is available');
const rendererSource = mainSource.slice(rendererStart, rendererEnd);
const postStart = mainSource.indexOf('      post = buildPost(renderer, scene, camera, {');
const postEnd = mainSource.indexOf('\n    } catch (err)', postStart);
assert.ok(postStart >= 0 && postEnd > postStart, 'Actual post options are available');
const postSource = mainSource.slice(postStart, postEnd);

async function rendererBoot(query = '', { adapter = true, requestFails = false, initFails = false, silentFallback = false } = {}) {
  const calls = [], warnings = [];
  let adapterCalls = 0, canvasReplacements = 0, sorted = 0, disposed = 0;
  class Renderer {
    constructor(options) {
      this.options = options; calls.push(options);
      this.backend = { isWebGPUBackend: !options.forceWebGL && !silentFallback };
      this.reversedDepthBuffer = !!options.reversedDepthBuffer;
      this.logarithmicDepthBuffer = !!options.logarithmicDepthBuffer;
    }
    async init() { if (initFails && !this.options.forceWebGL) throw Error('Mock WebGPU init failure'); }
    dispose() { disposed++; }
  }
  const navigator = { gpu: { async requestAdapter() {
    adapterCalls++; if (requestFails) throw Error('Mock adapter rejection');
    return adapter ? { limits: { maxTextureDimension2D: 16384, maxBufferSize: 4294967296 } } : null;
  } } };
  const makeRenderer = new Function('THREE', 'navigator', 'location', 'installReversedDepthSort', 'freshCanvas', 'console',
    `${rendererSource}; return makeRenderer;`)(
      { WebGPURenderer: Renderer }, navigator, { search: query ? '?' + query : '' },
      () => { sorted++; }, () => { canvasReplacements++; return { fresh: true }; },
      { warn: (...args) => warnings.push(args) });
  const result = await makeRenderer({ original: true });
  return { ...result, calls, warnings, adapterCalls, canvasReplacements, sorted, disposed };
}
function postDepthOption(query, actualReversedDepth) {
  // The real buildPost call supplies these exact options; do not duplicate
  // its rawtaa predicate in the test.
  return new Function('renderer', 'flags', 'buildPost',
    `const scene = {}, camera = {}, CloudPass = null; let post; ${postSource}; return post;`)(
      { reversedDepthBuffer: actualReversedDepth }, new URLSearchParams(query),
      (_renderer, _scene, _camera, options) => options).rawDepthSelection;
}
function reportedDepthMode(renderer) {
  const assignment = mainSource.match(/^  state\.depthMode = .+;$/m)?.[0];
  assert.ok(assignment, 'Actual depth-mode reporting is available');
  return new Function('renderer', `const state = {}; ${assignment}; return state.depthMode;`)(renderer);
}

test('actual renderer boot defaults to reverse only on WebGPU and preserves forward opt-out', async () => {
  for (const [query, reversed] of [['', true], ['reversedepth=1', true], ['reversedepth=0', false]]) {
    const r = await rendererBoot(query);
    assert.equal(r.backend, 'webgpu'); assert.equal(r.renderer.reversedDepthBuffer, reversed);
    assert.equal(r.renderer.logarithmicDepthBuffer, false);
    assert.equal(reportedDepthMode(r.renderer), reversed ? 'reversed-float32' : 'forward');
    assert.equal(r.calls.length, 1); assert.equal(r.sorted, 1); assert.equal(r.warnings.length, 0);
    assert.equal(r.calls[0].requiredLimits.maxTextureDimension2D, 16384);
  }
  const forced = await rendererBoot('gl=1&reversedepth=1');
  assert.equal(forced.backend, 'webgl'); assert.equal(forced.adapterCalls, 0);
  assert.equal(forced.renderer.reversedDepthBuffer, false); assert.equal(forced.calls[0].forceWebGL, true);
  assert.equal(forced.renderer.logarithmicDepthBuffer, true);
});

test('actual WebGL boot defaults to log depth, preserves opt-out, and never changes WebGPU', async () => {
  for (const [query, logarithmic] of [['gl=1', true], ['gl=1&logdepth=1', true], ['gl=1&logdepth=0', false]]) {
    const r = await rendererBoot(query);
    assert.equal(r.backend, 'webgl'); assert.equal(r.renderer.logarithmicDepthBuffer, logarithmic);
    assert.equal(r.renderer.reversedDepthBuffer, false); assert.equal(r.calls[0].antialias, true);
    assert.equal(reportedDepthMode(r.renderer), logarithmic ? 'logarithmic' : 'forward');
  }
  for (const query of ['logdepth=0', 'logdepth=1']) {
    const r = await rendererBoot(query);
    assert.equal(r.backend, 'webgpu'); assert.equal(r.renderer.logarithmicDepthBuffer, false);
    assert.equal(r.renderer.reversedDepthBuffer, true);
  }
});

test('actual WebGPU failures construct a log WebGL renderer and never retain raw reverse selection', async () => {
  for (const config of [{ adapter: false }, { requestFails: true }, { initFails: true }, { silentFallback: true }]) {
    const r = await rendererBoot('', config);
    assert.equal(r.backend, 'webgl'); assert.equal(r.renderer.reversedDepthBuffer, false);
    assert.equal(r.renderer.logarithmicDepthBuffer, true);
    assert.equal(r.calls.at(-1).forceWebGL, true);
    assert.equal(postDepthOption('', r.renderer.reversedDepthBuffer), false);
    assert.equal(postDepthOption('rawtaa=1', r.renderer.reversedDepthBuffer), false);
    if (config.initFails || config.silentFallback) assert.equal(r.canvasReplacements, 1);
    if (config.silentFallback) assert.equal(r.disposed, 1);
    const ordinary = await rendererBoot('logdepth=0', config);
    assert.equal(ordinary.backend, 'webgl'); assert.equal(ordinary.renderer.logarithmicDepthBuffer, false);
    assert.equal(reportedDepthMode(ordinary.renderer), 'forward');
  }
});

test('actual post options enable raw selection by default only for actual reverse depth', () => {
  for (const [query, reversed, raw] of [
    ['', true, true], ['rawtaa=1', true, true], ['rawtaa=0', true, false],
    ['', false, false], ['rawtaa=1', false, false], ['rawtaa=0', false, false],
  ]) assert.equal(postDepthOption(query, reversed), raw, `${query}, actual reverse=${reversed}`);
});

test('current graphics policy rejects old no-flag timing records, then caches the new workload normally', () => {
  const measured = profile(), prefix = QUALITY_PROFILE_VERSION + '/';
  assert.ok(measured.startsWith(prefix));
  // This is the previous exact key format, before the explicit policy prefix.
  const legacyProfile = measured.slice(prefix.length);
  const legacy = { ms: 16.7, tier: 'LOW', backend: 'webgpu', profile: legacyProfile };
  saveBench(legacy);
  const options = { backend: 'webgpu', profile: measured };
  assert.equal(isCompatibleBench(legacy, options), false); // main instantiates a benchmark
  assert.equal(detectTier(options), 'HIGH');
  const previous = { ...legacy, profile: 'graphics-atmosphere-v3/' + legacyProfile };
  saveBench(previous);
  assert.equal(isCompatibleBench(previous, options), false);
  assert.equal(detectTier(options), 'HIGH');
  saveBench({ ...legacy, profile: measured });
  assert.equal(detectTier(options), 'LOW');
  for (const flag of ['reversedepth=0', 'logdepth=0', 'rawtaa=0']) {
    assert.notEqual(profile('NELLIS', flag), measured);
    assert.equal(detectTier({ ...options, profile: profile('NELLIS', flag) }), 'HIGH');
  }
  setTier('ULTRA'); assert.equal(detectTier(options), 'ULTRA');
});

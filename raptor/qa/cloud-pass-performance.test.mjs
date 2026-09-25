// Shader construction, camera algebra and real pass/cache scheduling; no GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as T from 'three/tsl';
import { AdaptiveCloudPass } from '../src/world/adaptivecloudpass.js';
import { SpatialCloudPass } from '../src/world/spatialcloudpass.js';
import { PlanetCurvature } from '../src/world/planetcurvature.js';

function fixture(Class = AdaptiveCloudPass, { curved = true, physical = true } = {}) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 1, 200000);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem; camera._reversedDepth = true;
  camera.position.set(1000, 1800, -2500); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const curvature = curved ? new PlanetCurvature() : null;
  curvature?.beginFrame(camera); curvature?.endFrame();
  // Small nonzero texture fixtures exercise the actual shader binding graph.
  // Density accuracy/asset content are covered by the cloud-light-cache suite.
  const baseData = Uint8Array.from({ length: 4 ** 3 * 4 }, (_, i) => (i * 37) % 256);
  const baseTex = new THREE.Data3DTexture(baseData, 4, 4, 4);
  const detailTex = new THREE.Data3DTexture(baseData.slice(), 4, 4, 4);
  const jitterTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const noise = { baseData, baseN: 4, detailN: 4, baseTex, detailTex, jitterTex };
  const tData = new Float32Array([.9, .8, .7, 1]);
  const tTex = new THREE.DataTexture(tData, 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const source = new THREE.RenderTarget(960, 600, { count: 2, depthTexture: new THREE.DepthTexture(960, 600) });
  const sun = T.uniform(new THREE.Vector3(.7, .5, .5).normalize());
  const moon = T.uniform(new THREE.Vector3(-.3, .7, .5).normalize());
  const aerial = { uSunI: T.uniform(36), trans: () => T.vec3(1), ins: () => T.vec3(0),
    celestial: { uMoonDir: moon, uMoonRatio: T.uniform(2.5e-6),
      uMoonColor: T.uniform(new THREE.Vector3(1, .98, .94)), uNightSkyRadiance: T.uniform(new THREE.Vector3(.001, .001, .001)) },
    ...(physical ? { sourceTransport: { luts: { tTex, tData, tW: 1, tH: 1 } } } : {}) };
  const pass = new Class({ beauty: T.texture(source.textures[0]), depth: T.texture(source.depthTexture),
    velocity: T.texture(source.textures[1]), camera, curvature, front: 'NELLIS', noise, aerial,
    uSunDir: sun, uCamPos: T.uniform(camera.position.clone()), uTime: T.uniform(0) });
  return { pass, camera, curvature, source, noise,
    dispose() { pass.dispose(); source.dispose(); [baseTex, detailTex, jitterTex, tTex].forEach(t => t.dispose()); } };
}

function compiler() {
  const renderer = new THREE.WebGPURenderer({ canvas: { width: 960, height: 600, style: {},
    addEventListener() {}, removeEventListener() {} } });
  renderer.backend.renderer = renderer; renderer.hasFeature = () => false;
  return renderer;
}

function setup(pass, renderer = compiler()) {
  pass.setup({ renderer, getSharedContext: () => ({}) });
  return renderer;
}

function compile(material, target, renderer, camera) {
  renderer.setRenderTarget(target); renderer.setMRT(null);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const builder = new THREE.WGSLNodeBuilder(mesh, renderer);
  builder.scene = new THREE.Scene(); builder.camera = camera;
  try { builder.build(); return builder; }
  finally { mesh.geometry.dispose(); }
}

function drawFixture(f) {
  const events = [], clearColor = new THREE.Color(.2, .3, .4);
  const r = { target: f.source, face: 2, mip: 1, mrt: { borrowed: true }, renderObject: null,
    clearAlpha: .4, scissor: true, pixelRatio: 1.5, width: 960, height: 600,
    toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .7,
    outputColorSpace: THREE.SRGBColorSpace, autoClear: false,
    getRenderTarget() { return this.target; },
    setRenderTarget(target, face = 0, mip = 0) { Object.assign(this, { target, face, mip }); },
    getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    getMRT() { return this.mrt; }, setMRT(mrt) { this.mrt = mrt; },
    getRenderObjectFunction() { return this.renderObject; }, setRenderObjectFunction(value) { this.renderObject = value; },
    getClearColor(target) { return target.copy(clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(color, alpha) { clearColor.set(color); this.clearAlpha = alpha; },
    getScissorTest() { return this.scissor; }, setScissorTest(value) { this.scissor = value; },
    getPixelRatio() { return this.pixelRatio; }, setPixelRatio(value) { this.pixelRatio = value; },
    getDrawingBufferSize(target) { return target.set(this.width, this.height); },
    compute(node) { events.push(['cache', node.count]); },
  };
  f.pass._layerQuad.render = () => events.push(['layer', r.target.width, r.target.height]);
  f.pass._quad.render = () => events.push(['full', r.target.width, r.target.height, f.pass._resetHistory.value]);
  const state = () => [r.target, r.face, r.mip, r.mrt, r.renderObject, clearColor.clone(), r.clearAlpha,
    r.scissor, r.pixelRatio, r.toneMapping, r.toneMappingExposure, r.outputColorSpace, r.autoClear];
  return { renderer: r, events, state };
}

test('view-space cloud stop factors equal the original world/view round trip for unscaled cameras', () => {
  for (const reversed of [false, true]) for (const fov of [35, 60, 110]) for (const aspect of [.6, 16 / 9, 3]) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, .1, 300000);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem; camera._reversedDepth = reversed;
    camera.position.set(12000, 2400, -8000); camera.rotation.set(.8, 1.7, -1.2);
    camera.setViewOffset(1920, 1080, .31, -.42, 1920, 1080); camera.updateMatrixWorld();
    for (const x of [0, .001, .5, .999, 1]) for (const y of [0, .001, .5, .999, 1]) {
      const view = new THREE.Vector3(x * 2 - 1, 1 - y * 2, .5).applyMatrix4(camera.projectionMatrixInverse);
      const oldWorld = new THREE.Vector4(view.x, view.y, view.z, 0).applyMatrix4(camera.matrixWorld);
      const length = Math.hypot(oldWorld.x, oldWorld.y, oldWorld.z);
      oldWorld.divideScalar(length).applyMatrix4(camera.matrixWorldInverse);
      const factor = -view.z / view.length();
      assert(Math.abs(factor + oldWorld.z) < 1e-12);
      // Meter-space stop thresholds remain invariant, including wide-FOV corners.
      assert(Math.abs(200000 * (factor + oldWorld.z)) < 1e-7);
    }
  }
});

test('spatial composition binds only inverse projection for its scene-stop guide', () => {
  const f = fixture(SpatialCloudPass), renderer = compiler();
  try {
    f.pass._compositionMaterial.fragmentNode = f.pass._compositionNode();
    f.pass._captureRawCamera();
    const b = compile(f.pass._compositionMaterial, f.pass.outputTarget, renderer, f.camera);
    const matrices = b.uniforms.fragment.filter(u => u.node?.value?.isMatrix4);
    assert.deepEqual(matrices.map(u => u.node.value), [f.pass._nowProjectionInverse.value]);
    assert.match(b.fragmentShader, /normalize\(/);
    assert.doesNotMatch(b.fragmentShader, /undefined|NaN/);
  } finally { f.dispose(); }
});

test('adaptive low-resolution and repair shaders each bind all four shared light volumes', () => {
  const f = fixture(), renderer = setup(f.pass);
  try {
    const cache = f.pass.lightCache;
    assert(cache); setup(f.pass, renderer); assert.equal(f.pass.lightCache, cache, 'setup reuses owned cache');
    const textures = cache._sources.map(source => source.texture);
    for (const [material, target] of [[f.pass._layerMaterial, f.pass.layerTarget], [f.pass._material, f.pass.renderTarget]]) {
      const b = compile(material, target, renderer, f.camera);
      const bindings = new Set(b.uniforms.fragment.map(u => u.node?.value));
      for (const texture of textures) assert(bindings.has(texture), 'each integration has the same source texture');
      const declared = new Set([...b.fragmentShader.matchAll(/var\s+(nodeUniform\d+)\s*:\s*texture_/g)].map(m => m[1]));
      const used = new Set([...b.fragmentShader.matchAll(/texture(?:Sample(?:Level)?|Load)\(\s*(nodeUniform\d+)/g)].map(m => m[1]));
      assert.deepEqual([...used].filter(name => !declared.has(name)), [], 'no binding leaks between material builders');
      assert.doesNotMatch(b.fragmentShader, /undefined|NaN/);
    }
  } finally { f.dispose(); }
});

test('adaptive cache dispatch is shared by both draws and preserves temporal and renderer state', () => {
  const f = fixture(); setup(f.pass);
  const { renderer, events, state } = drawFixture(f), before = state();
  try {
    f.pass.updateBefore({ renderer, frameId: 1 });
    assert.deepEqual(events.map(e => e[0]), ['cache', 'layer', 'full']);
    assert(events[0][1] <= 640); assert.deepEqual(events[1].slice(1), [644, 402]);
    assert.deepEqual(events[2].slice(1), [960, 600, true]); assert.deepEqual(state(), before);
    f.pass.updateBefore({ renderer, frameId: 1 }); assert.equal(events.length, 3, 'one bounded cache batch per frame');
    events.length = 0; f.pass.updateBefore({ renderer, frameId: 2 });
    assert.equal(events.at(-1)[3], false, 'steady flight retains motion history');
    events.length = 0; f.pass.setCloudScale(1); f.pass.updateBefore({ renderer, frameId: 3 });
    assert.deepEqual(events.map(e => e[0]), ['cache', 'full']);
    assert.equal(f.pass.layerTarget.width, 1); assert.equal(events.at(-1)[3], true);
    assert.equal(f.pass.getTextureNode('depth').value, f.pass.renderTarget.depthTexture);
    renderer.width = 800; renderer.height = 500;
    f.pass.updateBefore({ renderer, frameId: 4 });
    assert.deepEqual(events.at(-1), ['full', 800, 500, true]);
    f.camera.position.x += 1000; f.curvature.beginFrame(f.camera);
    f.pass.updateBefore({ renderer, frameId: 5 }); assert.equal(events.at(-1)[3], true);
    assert.deepEqual(state(), before);
  } finally { f.dispose(); }
});

test('failed adaptive draw restores state and rejects history until a successful retry', () => {
  const f = fixture(); setup(f.pass);
  const { renderer, state } = drawFixture(f), before = state();
  try {
    f.pass.updateBefore({ renderer, frameId: 1 });
    const draw = f.pass._quad.render;
    f.pass._quad.render = () => { throw Error('draw failed'); };
    assert.throws(() => f.pass.updateBefore({ renderer, frameId: 2 }), /draw failed/);
    assert(!f.pass._historyValid); assert.deepEqual(state(), before);
    f.pass._quad.render = draw;
    f.pass.updateBefore({ renderer, frameId: 2 });
    assert(f.pass._resetHistory.value); assert(f.pass._historyValid); assert.deepEqual(state(), before);
  } finally { f.dispose(); }
});

test('adaptive cache disposal is idempotent and leaves scene/noise inputs owned by their caller', () => {
  const f = fixture(); setup(f.pass);
  let owned = 0, borrowed = 0;
  const resources = [f.pass.layerTarget, f.pass.renderTarget, f.pass._layerMaterial, f.pass._material,
    f.pass.lightCache._staging, ...f.pass.lightCache._sources.map(s => s.texture)];
  resources.forEach(resource => resource.addEventListener('dispose', () => owned++));
  [f.source, f.noise.baseTex, f.noise.detailTex, f.noise.jitterTex].forEach(resource => resource.addEventListener('dispose', () => borrowed++));
  try {
    f.pass.dispose(); f.pass.dispose();
    assert.equal(owned, resources.length); assert.equal(borrowed, 0);
    assert.throws(() => f.pass.updateBefore({}), /disposed/);
  } finally { f.dispose(); }
});

test('adaptive legacy lighting, flat worlds and non-WebGPU backends retain uncached integration', () => {
  for (const options of [{ physical: false }, { curved: false }, { webgpu: false }]) {
    const f = fixture(AdaptiveCloudPass, options);
    try {
      setup(f.pass, { backend: { isWebGPUBackend: options.webgpu !== false } });
      assert.equal(f.pass.lightCache, undefined);
    } finally { f.dispose(); }
  }
});

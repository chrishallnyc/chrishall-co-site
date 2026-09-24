// App-owned temporal lifecycle regression: actual r185 updateBefore and NodeFrame,
// with drawing/copy IO replaced by a small render-target contract fixture.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { passTexture, texture } from 'three/tsl';
import { TemporalResolveNode } from '../src/engine/temporalresolve.js';

function run(Class, { boot = false, directScene = false, failResolve = false, retry = false } = {}) {
  const events = [], rows = [], camera = new THREE.PerspectiveCamera(60, 1.6, 1, 250000);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem; camera._reversedDepth = true;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  let activeTarget = null, mrt = null, renderObject = null, clearAlpha = 1, scissor = false, pixelRatio = 1;
  const clearColor = new THREE.Color(), frame = new THREE.NodeFrame();
  let node, resolveFailed = false;
  const initializeTarget = target => {
    if (target.depthTexture) {
      target.depthTexture.image.width = target.width;
      target.depthTexture.image.height = target.height;
    }
  };
  const renderer = {
    toneMapping: 0, toneMappingExposure: 1, outputColorSpace: THREE.LinearSRGBColorSpace, autoClear: true,
    getRenderTarget: () => activeTarget, setRenderTarget: value => { activeTarget = value; },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getRenderObjectFunction: () => renderObject, setRenderObjectFunction: value => { renderObject = value; },
    getPixelRatio: () => pixelRatio, setPixelRatio: value => { pixelRatio = value; },
    getMRT: () => mrt, setMRT: value => { mrt = value; },
    getClearColor: target => target.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor: (color, alpha) => { clearColor.set(color); clearAlpha = alpha; },
    getScissorTest: () => scissor, setScissorTest: value => { scissor = value; },
    getDrawingBufferSize: target => target.set(960, 600),
    initRenderTarget: target => { initializeTarget(target); events.push({ action: 'init', width: target.width, height: target.height }); },
    copyTextureToTexture: (source, target) => {
      assert.equal(source.width, target.width, 'Native texture copy widths match');
      assert.equal(source.height, target.height, 'Native texture copy heights match');
      events.push({ action: 'copy', source: source.name, target: target.name, size: [target.width, target.height] });
    },
    render(object) {
      frame.renderId++; events.push({ action: 'resolve-start' });
      assert.equal(object.material, node._resolveMaterial, 'Actual vendor resolve quad');
      // Producer setup is lazy until the first resolve material compiles.
      producer.prepared = true; scene.prepared = true;
      frame.updateBeforeNode(producer);
      events.push({ action: 'resolve', size: [activeTarget.width, activeTarget.height],
        input: [producer.renderTarget.width, producer.renderTarget.height], reset: node._resetThisFrame.value });
      if (failResolve && (!retry || !resolveFailed)) { resolveFailed = true; throw Error('Controlled resolve failure'); }
    },
  };
  frame.renderer = renderer;
  class Producer extends THREE.TempNode {
    constructor(name, dependency = null) {
      super('vec4'); this.name = name; this.dependency = dependency;
      this.updateBeforeType = THREE.NodeUpdateType.FRAME;
      this.renderTarget = new THREE.RenderTarget(boot ? 1 : 1440, boot ? 1 : 900,
        { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(boot ? 1 : 1440, boot ? 1 : 900) });
      this.renderTarget.texture.name = name;
      this.renderTarget.depthTexture.name = name + '-depth'; this.calls = 0;
      this.prepared = !boot;
      if (name === 'beauty') this.invalidateHistory = () => events.push({ action: 'invalidate-beauty' });
      if (name === 'scene') this.setSize = (width, height) => {
        events.push({ action: 'size-scene', size: [width, height] });
        this.renderTarget.setSize(width, height);
      };
    }
    updateBefore(current) {
      assert.equal(this.prepared, true, 'No producer execution before lazy material/attachment setup');
      if (this.dependency) current.updateBeforeNode(this.dependency);
      this.calls++; this.renderTarget.setSize(960, 600); initializeTarget(this.renderTarget);
      events.push({ action: this.name, jitterSize: [camera.view.fullWidth, camera.view.fullHeight] });
    }
  }
  const scene = new Producer('scene'), producer = directScene ? scene : new Producer('beauty', scene);
  node = new Class(passTexture(producer, producer.renderTarget.texture), texture(producer.renderTarget.depthTexture), texture(new THREE.Texture()), camera);
  node._velocityNode = { setProjectionMatrix() {} };
  node._needsPostProcessingSync = boot;
  if (!boot) {
    node.setSize(1440, 900); node._resetPending = false;
    node._lastProjection = { camera, near: camera.near, far: camera.far,
      aspect: camera.aspect, fov: camera.fov, zoom: camera.zoom };
    node._lastPosition.copy(camera.position); node._lastRotation.copy(camera.quaternion);
  }
  for (let i = 0; i < (failResolve && !retry ? 1 : 2); i++) {
    frame.frameId++; const before = events.length, sceneBefore = scene.calls, producerBefore = producer.calls;
    if (!boot || i > 0) node.setViewOffset(960, 600); // Real render-pipeline callback.
    let error = null;
    try { frame.updateBeforeNode(node); } catch (e) { error = e.message; }
    rows.push({ frame: i, events: events.slice(before), resetPending: node._resetPending,
      reset: node._resetThisFrame.value, size: [node._resolveRenderTarget.width, node._resolveRenderTarget.height],
      historySize: [node._historyRenderTarget.width, node._historyRenderTarget.height],
      sceneDraws: scene.calls - sceneBefore, producerDraws: producer.calls - producerBefore, error });
    node.clearViewOffset();
  }
  node.dispose(); scene.renderTarget.dispose(); if (producer !== scene) producer.renderTarget.dispose();
  return rows;
}


for (const directScene of [false, true]) test(`first resized frame seeds exact full-size history (${directScene ? 'scene' : 'cloud'} producer)`, () => {
  const rows = run(TemporalResolveNode, { directScene });
  for (const [i, row] of rows.entries()) {
    assert.equal(row.error, null);
    assert.deepEqual(row.size, [960, 600]); assert.deepEqual(row.historySize, [960, 600]);
    assert.equal(row.reset, i === 0); assert.equal(row.resetPending, false);
    assert.equal(row.sceneDraws, 1); assert.equal(row.producerDraws, 1);
    const renderStart = row.events.findIndex(e => e.action === 'resolve-start');
    assert.ok(row.events.findIndex(e => e.action === 'scene') > renderStart,
      'Producer renders only inside the native resolve dependency');
    if (i === 0 && !directScene) assert.ok(row.events.some(e => e.action === 'invalidate-beauty'),
      'Pre-sized cloud target still resets its motion history');
    assert.ok(row.events.some(e => e.action === 'copy' && e.source.endsWith('-depth')));
    assert.ok(row.events.filter(e => e.jitterSize).every(e => e.jitterSize[0] === 960 && e.jitterSize[1] === 600));
  }
});

test('initial producer setup remains lazy until native resolve compilation', () => {
  const rows = run(TemporalResolveNode, { boot: true });
  assert.ok(rows.every(row => row.error === null && row.sceneDraws === 1 && row.producerDraws === 1));
  assert.deepEqual(rows[0].size, [1, 1], 'Retain the pinned vendor initialization before its first dependency setup');
  assert.deepEqual(rows[1].size, [960, 600]);
  assert.equal(rows[1].reset, true);
  assert.ok(rows[1].events.some(e => e.action === 'copy' && e.source.endsWith('-depth')));
});

test('failed resize resolve preserves its reset through a successful retry', () => {
  const rows = run(TemporalResolveNode, { failResolve: true, retry: true });
  assert.equal(rows[0].error, 'Controlled resolve failure');
  assert.equal(rows[0].resetPending, true);
  assert.equal(rows[1].error, null);
  assert.equal(rows[1].reset, true); assert.equal(rows[1].resetPending, false);
  assert.deepEqual(rows[1].size, [960, 600]);
});

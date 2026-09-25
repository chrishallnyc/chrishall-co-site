import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installCameraHandedness, useENUCamera, useENUF22Frame } from '../src/engine/renderhandedness.js';
import { Player } from '../src/game/player.js';
import { S } from '../src/sim/flight.js';
import { SimCore } from '../src/engine/sim.js';

globalThis.document = { createElement: () => ({ getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
}) }) };

function view(heading = Math.PI / 2) {
  const camera = useENUCamera(new THREE.PerspectiveCamera(60, 16 / 9, 1, 120000));
  camera.position.set(0, 1000, 0);
  camera.lookAt(Math.cos(heading) * 10000, 1000, Math.sin(heading) * 10000);
  camera.updateMatrixWorld(true);
  return camera;
}
function near(a, b, message) { assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} vs ${b}`); }

test('geographic right projects right for every cardinal heading, with exact unprojection', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const camera = view(heading);
    // Physical right is clockwise from the ENU heading (east, then north).
    const point = new THREE.Vector3(Math.cos(heading) * 5000 + Math.sin(heading) * 1000,
      1000, Math.sin(heading) * 5000 - Math.cos(heading) * 1000);
    const ndc = point.clone().project(camera);
    assert.ok(ndc.x > 0, `heading ${heading}: geographic right must appear right`);
    assert.ok(ndc.clone().unproject(camera).distanceTo(point) < 1e-6);
    near(camera.matrixWorldInverse.determinantAffine(), -1, 'reflected view determinant');
  }
});

test('both camera update methods, lookAt and clones retain reflected view', () => {
  const camera = view();
  const clone = camera.clone();
  assert.equal(useENUCamera(camera), camera, 'installation is idempotent');
  for (const candidate of [camera, clone]) {
    candidate.position.set(0, 1000, -5000);
    candidate.lookAt(0, 1000, 0);
    for (const update of ['updateMatrixWorld', 'updateWorldMatrix']) {
      candidate[update](true);
      near(candidate.matrixWorldInverse.determinantAffine(), -1, update);
      assert.ok(new THREE.Vector3(1000, 1000, 0).project(candidate).x > 0);
      const identity = candidate.matrixWorld.clone().multiply(candidate.matrixWorldInverse);
      identity.elements.forEach((v, i) => near(v, i % 5 === 0 ? 1 : 0, 'world/view inverse'));
    }
  }
});

test('rightward pointer input selects a visually rightward course without changing simulation conventions', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const player = new Player(new THREE.Scene(), { jet: new THREE.Group(),
      spawn: { x: 0, y: 0, alt: 1000, headingRad: heading, speed: 200 } });
    const sim = new SimCore(1); sim.addSystem(player);
    player._mouseDx = 30;
    sim.tick();
    assert.ok(player.aimHeading < heading, 'positive mouse travel retains clockwise ENU course');
    const target = new THREE.Vector3(Math.cos(player.aimHeading) * 5000, 1000,
      Math.sin(player.aimHeading) * 5000).project(view(heading));
    assert.ok(target.x > 0, 'new aim course appears to the right');
  }
});

test('F-22 nose, starboard and up follow the real simulation basis through banks and headings', () => {
  const scene = new THREE.Scene(), jet = new THREE.Group(), model = new THREE.Group();
  model.rotation.y = Math.PI; jet.add(model); scene.add(jet);
  const player = new Player(scene, { jet, spawn: { x: 0, y: 0, alt: 1000, headingRad: 0, speed: 200 } });
  for (const heading of [0, Math.PI / 2, Math.PI]) for (const bank of [-0.8, 0, 0.8]) {
    player.fm.setAttitude(heading, 0.2, bank);
    player._prev.set(player.fm.state);
    player.render(1, view(), true);
    scene.updateMatrixWorld(true);
    const state = player.fm.state, q = new THREE.Quaternion(state[S.QX], state[S.QY], state[S.QZ], state[S.QW]);
    for (const [label, local, body] of [
      ['nose', [0, 0, -1], [1, 0, 0]], ['starboard', [1, 0, 0], [0, 1, 0]], ['up', [0, 1, 0], [0, 0, -1]],
    ]) {
      const enu = new THREE.Vector3(...body).applyQuaternion(q);
      const expected = new THREE.Vector3(enu.x, enu.z, enu.y);
      const actual = new THREE.Vector3(...local).transformDirection(model.matrixWorld);
      assert.ok(actual.distanceTo(expected) < 1e-8, `${label} matches physical orientation at bank ${bank}`);
    }
  }
  useENUF22Frame(jet);
  assert.equal(jet.scale.x, -1, 'TestWorld/Player handoff does not double-reflect');
});

function gpuFixture() {
  const backend = new THREE.WebGPUBackend({});
  // Exercise r185's actual primitive-state implementation; pipeline creation
  // is reduced to its descriptor boundary so Node needs no GPU device.
  backend.createRenderPipeline = function (object) {
    const state = this.pipelineUtils._getPrimitiveState(object.object, object.geometry, object.material);
    if (object.fail) throw new Error('pipeline failed');
    return state;
  };
  backend.getRenderCacheKey = () => 'same-shader';
  backend.needsRenderUpdate = () => false;
  installCameraHandedness({ backend });
  return backend;
}
function renderObject(camera, objectReflected = false, side = THREE.FrontSide) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ side }));
  object.scale.x = objectReflected ? -1 : 1;
  object.updateMatrixWorld(true);
  return { object, geometry: object.geometry, material: object.material, camera };
}

test('WebGPU front-face winding combines camera, object and material parity using the pinned backend', () => {
  const backend = gpuFixture(), ordinary = new THREE.PerspectiveCamera(), reflected = view();
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    for (const objectReflected of [false, true]) {
      const normal = backend.createRenderPipeline(renderObject(ordinary, objectReflected, side));
      const mirror = backend.createRenderPipeline(renderObject(reflected, objectReflected, side));
      assert.notEqual(normal.frontFace, mirror.frontFace);
      assert.equal(normal.cullMode, mirror.cullMode, 'material sidedness is preserved');
      const opposite = backend.createRenderPipeline(renderObject(ordinary, !objectReflected, side));
      assert.equal(mirror.frontFace, opposite.frontFace, 'two reflections cancel');
    }
  }
});

test('WebGPU cache keys separate reflected flight and ordinary shadow/probe cameras and notice parity changes', () => {
  const backend = gpuFixture(), camera = view(), object = renderObject(camera);
  const reflectedKey = backend.getRenderCacheKey(object);
  assert.equal(backend.needsRenderUpdate(object), false);
  camera.scale.x = 1; camera.updateMatrixWorld(true);
  assert.equal(backend.needsRenderUpdate(object), true, 'existing render object cannot reuse wrong winding');
  assert.notEqual(backend.getRenderCacheKey(object), reflectedKey);
  assert.equal(backend.needsRenderUpdate(object), false, 'steady view does not recreate pipelines');
  assert.equal(installCameraHandedness({ backend }), false, 'backend installation is idempotent');
});

test('WebGPU pipeline failures restore ordinary pass state', () => {
  const backend = gpuFixture(), object = renderObject(view()); object.fail = true;
  assert.throws(() => backend.createRenderPipeline(object), /pipeline failed/);
  const ordinary = renderObject(new THREE.PerspectiveCamera());
  const outsidePass = backend.pipelineUtils._getPrimitiveState(ordinary.object, ordinary.geometry, ordinary.material);
  assert.equal(outsidePass.frontFace, backend.createRenderPipeline(ordinary).frontFace);
});

test('WebGL draw winding combines camera/object parity and restores state after a failed draw', () => {
  const backend = new THREE.WebGLBackend({}), seen = [];
  backend.state = { setMaterial: (material, reflected, clipping) => { seen.push({ reflected, clipping }); } };
  backend.draw = function (object) {
    this.state.setMaterial(object.material, object.object.matrixWorld.determinantAffine() < 0, 3);
    if (object.fail) throw new Error('draw failed');
  };
  installCameraHandedness({ backend });
  for (const reflected of [false, true]) for (const objectReflected of [false, true]) {
    backend.draw(renderObject(reflected ? view() : new THREE.PerspectiveCamera(), objectReflected));
    assert.deepEqual(seen.at(-1), { reflected: reflected !== objectReflected, clipping: 3 });
  }
  const broken = renderObject(view()); broken.fail = true;
  assert.throws(() => backend.draw(broken), /draw failed/);
  backend.state.setMaterial(broken.material, false, 0);
  assert.deepEqual(seen.at(-1), { reflected: false, clipping: 0 }, 'failed reflected draw cannot leak into another pass');
});

test('unsupported backend contracts fail explicitly before a reflected view can be installed', () => {
  assert.throws(() => installCameraHandedness({ backend: {} }), /Unsupported renderer/);
  assert.throws(() => installCameraHandedness({ backend: { isWebGPUBackend: true } }), /Unsupported WebGPU/);
  assert.throws(() => installCameraHandedness({ backend: { isWebGLBackend: true, draw() {} } }), /Unsupported WebGL/);
});

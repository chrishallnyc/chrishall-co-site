// Real Three transforms and FlightFX; no renderer, browser or GPU required.
// Run with --import ./raptor/qa/register-three.mjs, like other native QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightFX } from '../src/game/flightfx.js';

function fixture() {
  const scene = new THREE.Scene(), carrier = new THREE.Group(), jet = new THREE.Group(), rig = new THREE.Group();
  const nozzleL = new THREE.Group(), nozzleR = new THREE.Group();
  nozzleL.position.set(-1.3, .2, 4); nozzleR.position.set(1.3, .2, 4);
  rig.rotation.y = Math.PI; rig.add(nozzleL, nozzleR); jet.add(rig); carrier.add(jet); scene.add(carrier);
  const fx = new FlightFX(scene, { jetGroup: jet, parts: { nozzleL, nozzleR } });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(250, 50, -100);
  return { scene, carrier, jet, rig, nozzleL, nozzleR, fx, camera };
}

// Compose the mathematical world pose independently of Three's update flags
// or the effect's path traversal. Manual world matrices remain authoritative.
function expectedWorld(object) {
  if (!object.matrixWorldAutoUpdate) return object.matrixWorld.clone();
  const local = object.matrixAutoUpdate
    ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale)
    : object.matrix.clone();
  return object.parent ? expectedWorld(object.parent).multiply(local) : local;
}
function closeArray(actual, expected, label) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-8,
    `${label}[${i}]: ${actual[i]} != ${expected[i]}`);
}

test('effect anchors, world-fixed trails and plume camera track current articulated poses before rendering', () => {
  const { scene, carrier, jet, rig, nozzleL, nozzleR, fx, camera } = fixture();
  carrier.position.set(1200, 50, -900); carrier.rotation.set(.1, .3, -.1);
  for (let frame = 0; frame < 90; frame++) {
    jet.position.set(frame * 2, 100 + frame / 3, -frame);
    jet.rotation.set(Math.sin(frame / 13) * .3, frame / 100, Math.cos(frame / 19) * .2);
    nozzleL.rotation.x = Math.sin(frame / 7) * .25;
    nozzleR.rotation.x = -Math.cos(frame / 11) * .25;
    carrier.rotation.y += .001; // parent is deliberately not refreshed first
    if (frame === 20) {
      // Matrix-managed local rigs must inherit subsequent aircraft motion.
      for (const object of [rig, nozzleL]) { object.updateMatrix(); object.matrixAutoUpdate = false; }
    }
    if (frame >= 20 && frame < 40) nozzleL.matrix.makeRotationX(frame / 90).setPosition(-1.3, .2, 4);
    if (frame === 40) { rig.matrixAutoUpdate = true; nozzleL.matrixAutoUpdate = true; }
    if (frame === 50) {
      const pivot = new THREE.Group(); pivot.rotation.y = .2; pivot.position.set(1, 2, 3);
      rig.add(pivot); pivot.add(nozzleL, fx._tipR);
    }
    if (frame === 70) {
      nozzleR.matrixWorldAutoUpdate = false;
      nozzleR.matrixWorld.makeRotationY(.7).setPosition(2000, 400, -600);
    }
    fx.update({ nz: 5, alphaDeg: 20, mach: .9 }, 1.1, 1 / 60, camera, frame >= 45 ? 1 : 0);
    for (const [anchor, position, direction] of [
      [fx._tipL, fx._pTipL], [fx._tipR, fx._pTipR],
      [fx._nozL, fx._pNozL, fx._aftL], [fx._nozR, fx._pNozR, fx._aftR],
    ]) {
      const matrix = expectedWorld(anchor);
      closeArray(position.toArray(), new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), `frame ${frame} anchor`);
      if (direction) closeArray(direction.toArray(), new THREE.Vector3(0, 0, 1).transformDirection(matrix).toArray(), 'exhaust axis');
    }
    closeArray(fx._worldFixed.matrixWorld.elements, new THREE.Matrix4().elements, 'world-fixed trail basis');
    for (const plume of [fx._plumeL, fx._plumeR]) {
      const expected = camera.position.clone().applyMatrix4(expectedWorld(plume.volume.mesh).invert());
      closeArray(plume.volume.camera.value.toArray(), expected.toArray(), 'plume local camera');
    }
    // Ordinary render traversal still publishes every deferred visual pose.
    scene.updateMatrixWorld(true);
    scene.traverse(object => closeArray(object.matrixWorld.elements, expectedWorld(object).elements, 'rendered world pose'));
  }
});

test('effect preparation visits only its ancestor paths regardless of inactive aircraft detail', () => {
  const { scene, jet, rig, fx, camera } = fixture();
  let detailVisits = 0;
  for (let i = 0; i < 1200; i++) {
    const detail = new THREE.Object3D(); detail.position.set(i, 1, 2); detail.visible = i % 3 === 0;
    const update = detail.updateMatrix;
    detail.updateMatrix = function () { detailVisits++; return update.call(this); };
    rig.add(detail);
  }
  const paths = [scene, jet, rig, fx._tipL, fx._tipR, fx._nozL, fx._nozR];
  const visits = new Map();
  for (const object of paths) {
    const update = object.updateWorldMatrix;
    object.updateWorldMatrix = function (...args) {
      visits.set(this, (visits.get(this) || 0) + 1); return update.apply(this, args);
    };
  }
  for (let frame = 0; frame < 120; frame++) {
    jet.position.x += 2;
    fx.update({ nz: 1, alphaDeg: 3, mach: .8 }, .5, 1 / 60, camera);
  }
  assert.equal(detailVisits, 0, 'FlightFX must not force a full visual subtree update');
  assert.ok(paths.every(object => visits.get(object) === 120), 'shared ancestors update once per effect frame');
  scene.updateMatrixWorld(true);
  assert.equal(detailVisits, 1200, 'the normal renderer traversal still owns all visible and hidden detail');
  const detail = rig.children.at(-1);
  closeArray(detail.matrixWorld.elements, expectedWorld(detail).elements, 'deferred detail has the current pose');
});

// CPU-only culling/material/history checks. No renderer or GPU required.
// node --test raptor/qa/planet-object-update.test.mjs
import './register-three.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { PlanetObjectBender } = await import('../src/world/planetobjects.js');
const { PlanetCurvature } = await import('../src/world/planetcurvature.js');

const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(12, 6, 20), new THREE.MeshBasicMaterial());
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);

function trackTransforms(root) {
  const calls = new Map();
  root.traverse(object => {
    const update = object.updateWorldMatrix;
    object.updateWorldMatrix = function(...args) {
      calls.set(this, (calls.get(this) || 0) + 1);
      return update.apply(this, args);
    };
  });
  return calls;
}

function containsRenderedVertices(object, curvature) {
  const sphere = object.boundingSphere.clone().applyMatrix4(object.matrixWorld);
  const p = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const positions = object.geometry.attributes.position;
  for (let instance = 0; instance < (object.isInstancedMesh ? object.count : 1); instance++) {
    if (object.isInstancedMesh) object.getMatrixAt(instance, matrix); else matrix.identity();
    matrix.premultiply(object.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      curvature.forward(p, p);
      assert.ok(sphere.center.distanceTo(p) <= sphere.radius + 1e-7, 'curved vertex stays inside the rendered culling sphere');
    }
  }
}

test('hidden pooled hierarchies do no material, matrix, or bounds work; visible ancestors update once', () => {
  const scene = new THREE.Scene(), pool = new THREE.Group(); scene.add(pool);
  const slots = [], objects = [];
  for (let i = 0; i < 8; i++) {
    const slot = new THREE.Group(); slot.visible = i === 0; pool.add(slot); slots.push(slot);
    for (let j = 0; j < 3; j++) { const object = mesh(); slot.add(object); objects.push(object); }
  }
  const bender = new PlanetObjectBender(new PlanetCurvature()); bender.attach(pool);
  const calls = trackTransforms(scene), prepared = [];
  const prepare = bender._prepareMaterial;
  bender._prepareMaterial = function(object, ...rest) { prepared.push(object); return prepare.call(this, object, ...rest); };
  bender.update();
  assert.equal(prepared.length, 3);
  assert.equal(calls.size, 6, 'scene, pool, visible slot, and its three meshes');
  assert.ok([...calls.values()].every(count => count === 1));
  for (const object of objects.slice(3)) {
    assert.equal(calls.has(object), false);
    assert.equal(object.boundingSphere, undefined);
  }
  calls.clear(); prepared.length = 0;
  slots[1].visible = true; slots[1].position.set(7000, 1200, -8000);
  bender.update();
  assert.equal(prepared.length, 6);
  assert.ok([...calls.values()].every(count => count === 1));
  for (const object of objects.slice(3, 6)) containsRenderedVertices(object, bender.curvature);
  // Overlapping registrations must not duplicate a mesh's work.
  bender.attach(objects[0]); calls.clear(); prepared.length = 0; bender.update();
  assert.equal(bender._bindings.length, objects.length);
  assert.equal(prepared.length, 6);
  assert.ok([...calls.values()].every(count => count === 1));
});

test('external parents, reparenting, changing curvature origins, and manual transforms retain valid bounds', () => {
  const scene = new THREE.Scene(), a = new THREE.Group(), b = new THREE.Group(), object = mesh();
  scene.add(a, b); a.add(object);
  a.position.set(18000, 2500, -26000); a.rotation.set(0.1, 0.6, -0.2); a.scale.set(1.3, 0.8, 2);
  b.position.set(-14000, 1500, 17000); b.rotation.set(-0.2, -0.8, 0.3);
  object.position.set(30, 4, -11);
  const curvature = new PlanetCurvature(), bender = new PlanetObjectBender(curvature);
  bender.attach(object); bender.update(); containsRenderedVertices(object, curvature);
  a.visible = false; a.position.x += 2000;
  const held = object.matrixWorld.clone(); bender.update();
  assert.deepEqual(object.matrixWorld.elements, held.elements, 'hidden external parent suspends the mesh');
  b.add(object); curvature.origin.value.set(-18000, 16000); bender.update();
  containsRenderedVertices(object, curvature);
  const expected = new THREE.Matrix4().multiplyMatrices(b.matrixWorld, object.matrix);
  assert.deepEqual(object.matrixWorld.elements, expected.elements, 'reparented mesh uses its current parent');
  object.matrixAutoUpdate = false;
  object.matrix.makeTranslation(60, 90, 120); bender.update();
  containsRenderedVertices(object, curvature);
  object.matrixWorldAutoUpdate = false;
  object.matrixWorld.makeTranslation(4000, 700, 5000); bender.update();
  close(object.matrixWorld.elements[12], 4000, 'manual world matrix remains authoritative');
  containsRenderedVertices(object, curvature);
});

test('unchanged materials retain programs; hidden livery swaps and in-place material arrays adapt on reveal', () => {
  const root = new THREE.Group(), object = mesh(); root.add(object);
  const bender = new PlanetObjectBender(new PlanetCurvature()); bender.attach(root); bender.update();
  const original = object.material, version = original.version, position = original.positionNode;
  for (let i = 0; i < 5; i++) bender.update();
  assert.equal(original.version, version); assert.equal(original.positionNode, position);
  const replacement = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.8 });
  root.visible = false; object.material = replacement; bender.update();
  assert.equal(replacement.positionNode, undefined);
  root.visible = true; bender.update();
  assert.ok(replacement.positionNode && replacement.mrtNode);
  assert.equal(replacement.alphaTest, 1e-5);
  const array = [original, replacement]; object.material = array; bender.update();
  const third = new THREE.MeshBasicMaterial(); array[1] = third; bender.update();
  assert.ok(third.positionNode && third.mrtNode, 'in-place slot replacement is detected');
  const fourth = new THREE.MeshBasicMaterial(); array.push(fourth); bender.update();
  assert.ok(fourth.positionNode && fourth.mrtNode, 'in-place array growth is detected');
  const versions = array.map(material => material.version); bender.update();
  assert.deepEqual(array.map(material => material.version), versions);
});

test('instance bounds catch up after hidden updates and count shrink/regrowth without another upload', () => {
  const root = new THREE.Group();
  const object = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial(), 3);
  root.add(object); root.position.set(10000, 400, -11000);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 3; i++) object.setMatrixAt(i, m.makeTranslation(i * 120, 0, 0));
  object.instanceMatrix.needsUpdate = true; object.count = 1;
  const curvature = new PlanetCurvature(), bender = new PlanetObjectBender(curvature);
  bender.attach(root, { stableInstances: true }); bender.update();
  const firstRadius = object.boundingSphere.radius;
  object.count = 3; bender.update(); containsRenderedVertices(object, curvature);
  assert.ok(object.boundingSphere.radius > firstRadius * 5);
  object.count = 1; bender.update(); close(object.boundingSphere.radius, firstRadius, 'shrunk instance bounds');
  root.visible = false; object.setMatrixAt(2, m.makeTranslation(700, 20, 50));
  object.instanceMatrix.needsUpdate = true; object.count = 3; bender.update();
  root.position.x += 500; root.visible = true; bender.update(); containsRenderedVertices(object, curvature);
  assert.ok(object.boundingBox.max.x >= 705);
});

test('world-fixed effect anchors stay fixed and visibility gaps reject stale temporal history', () => {
  const scene = new THREE.Scene(), jet = new THREE.Group(), fixed = new THREE.Group(), object = mesh();
  scene.add(jet); jet.add(fixed); fixed.add(object); fixed.matrixAutoUpdate = false;
  jet.position.set(15000, 2800, -7000); jet.rotation.y = 0.5; jet.updateMatrixWorld(true);
  fixed.matrix.copy(jet.matrixWorld).invert(); object.position.set(15010, 2798, -7005);
  const bender = new PlanetObjectBender(new PlanetCurvature()); bender.attach(jet); bender.update();
  const world = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
  close(world.distanceTo(object.position), 0, 'world-fixed anchor cancels the jet transform');
  bender._objectHistoryValid.update({ object }); assert.equal(bender._objectHistoryValid.value, false);
  bender.update(); bender._objectHistoryValid.update({ object }); assert.equal(bender._objectHistoryValid.value, true);
  jet.visible = false; bender.update(); bender.update();
  jet.visible = true; bender.update(); bender._objectHistoryValid.update({ object });
  assert.equal(bender._objectHistoryValid.value, false, 'first visible draw rejects pre-hide history');
  bender.update(); bender._objectHistoryValid.update({ object }); assert.equal(bender._objectHistoryValid.value, true);
  containsRenderedVertices(object, bender.curvature);
});

// Exercise the real effect/terrain objects and pinned renderer traversal;
// mock only GPU submission so these checks require no browser or adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightFX } from '../src/game/flightfx.js';
import { Terrain } from '../src/world/terrain.js';
import { withWarmupResources } from '../src/engine/renderwarmup.js';

class WarmupTerrain extends Terrain {
  _buildMaterial() { return new THREE.MeshBasicMaterial(); }
}

function fixture(tier = 'HIGH') {
  const scene = new THREE.Scene(), jet = new THREE.Group(), rig = new THREE.Group();
  const nozzleL = new THREE.Group(), nozzleR = new THREE.Group();
  rig.add(nozzleL, nozzleR); jet.add(rig); scene.add(jet);
  const fx = new FlightFX(scene, { jetGroup: jet, parts: { nozzleL, nozzleR } });
  const terrain = new WarmupTerrain({ minH: 0, maxH: 100, grid: 32, sizeM: 65536 },
    new Float32Array(32 * 32), { width: 32, height: 32 });
  terrain.setDetailTier(tier); scene.add(terrain.group);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 250000);
  camera.position.set(0, 50000, 0); camera.lookAt(0, 0, -1000); camera.updateMatrixWorld();
  terrain.update(camera, 0);
  const roots = jet.getObjectsByProperty('name', 'F119-exhaust');
  const celestial = new THREE.Group(); celestial.visible = false; scene.add(celestial);
  const dispose = () => {
    terrain.grid.dispose(); terrain.fineGrid?.dispose(); terrain.material.dispose(); terrain.tex.dispose();
    // Engine geometry/textures are shared module resources, as in the game.
    jet.traverse(object => { if (object.isMesh) object.material.dispose(); });
    fx._vortMesh.geometry.dispose(); fx._smokeMesh.geometry.dispose();
  };
  return { scene, jet, rig, fx, terrain, camera, roots, celestial, dispose };
}

function snapshot(root) {
  const state = [];
  root.traverse(object => state.push({ object, visible: object.visible, cull: object.frustumCulled,
    geometry: object.geometry, material: object.material, count: object.count,
    position: object.position.toArray(), scale: object.scale.toArray(), quaternion: object.quaternion.toArray() }));
  return state;
}

// Use the vendored renderer's actual list construction and resource-update
// order. In particular, zero-count instances still prepare their resources.
const rendererMethods = Object.getPrototypeOf(THREE.WebGPURenderer.prototype);
function preparedResources(scene, camera) {
  const listed = [], geometries = new Set(), materials = new Set();
  const renderer = { _projectObject: rendererMethods._projectObject, sortObjects: false, backend: {},
    _currentRenderBundle: null, _currentRenderContext: {},
    _objects: { get: (object, material) => ({ object, material }) },
    _nodes: { needsRefresh: () => true, updateBefore() {}, updateForRender() {} },
    _geometries: { updateForRender: object => geometries.add(object.object.geometry) },
    _bindings: { updateForRender() {} },
    _pipelines: { updateForRender: object => materials.add(object.material), isReady: () => false },
  };
  renderer._projectObject(scene, camera, 0, { push: (object, geometry, material, order, depth, group) =>
    listed.push({ object, geometry, material, group }) }, null);
  for (const { object, material, group } of listed)
    rendererMethods._renderObjectDirect.call(renderer, object, material, scene, camera, null, group);
  return { listed, geometries, materials };
}

test('loading draw prepares real hidden exhaust and existing fine terrain resources, then restores the spawn view', () => {
  const f = fixture();
  try {
    const { scene, jet, fx, terrain, camera, roots, celestial } = f;
    assert.equal(roots.length, 2); assert(roots.every(root => !root.visible));
    assert.equal(terrain.stats.fineNodes, 0, 'distant spawn still selects the coarse grid');
    const before = snapshot(scene), terrainStats = { ...terrain.stats };
    const effectState = [fx._t, fx._abStage, fx._smokeStage, fx._vortPool.liveCount, fx._smokePool.liveCount];
    const cold = preparedResources(scene, camera);
    assert(!cold.geometries.has(terrain.fineGrid));
    const exhaustMeshes = roots.flatMap(root => root.children.filter(object => object.isMesh));
    assert(exhaustMeshes.every(mesh => !cold.materials.has(mesh.material)));
    assert(cold.materials.has(fx._vortMesh.material), 'an empty visible particle pool is already prepared');
    const result = withWarmupResources({ exhaustRoots: roots, terrain, visible: [celestial] }, () => {
      const warm = preparedResources(scene, camera);
      assert(exhaustMeshes.every(mesh => warm.materials.has(mesh.material)));
      assert(warm.geometries.has(terrain.fineGrid), 'the prepared fine grid reaches buffer upload');
      assert(celestial.visible);
      for (const plume of [fx._plumeL, fx._plumeR]) {
        assert.equal(plume.volume.stage.value, 0); assert.equal(plume.glow.material.opacity, 0);
      }
      assert.deepEqual([fx._t, fx._abStage, fx._smokeStage, fx._vortPool.liveCount, fx._smokePool.liveCount], effectState);
      return 'draw submitted';
    });
    assert.equal(result, 'draw submitted');
    assert.deepEqual(snapshot(scene), before);
    assert.deepEqual(terrain.stats, terrainStats);
    const clean = preparedResources(scene, camera);
    assert.deepEqual(clean.listed.map(item => item.object), cold.listed.map(item => item.object));
    assert(!clean.geometries.has(terrain.fineGrid));
    assert.equal(jet.children.length, 2, 'no temporary scene objects or effects remain');
  } finally { f.dispose(); }
});

test('a failed warmup restores hidden ancestors, culling, geometry and original visibility', () => {
  const f = fixture();
  try {
    f.rig.visible = false; f.terrain.group.visible = false;
    f.terrain.pool.forEach(mesh => { mesh.visible = false; });
    f.terrain.pool[0].frustumCulled = true;
    f.roots[1].visible = true;
    const before = snapshot(f.scene), failure = new Error('GPU submission failed');
    assert.throws(() => withWarmupResources({ exhaustRoots: [...f.roots, f.roots[0]],
      terrain: f.terrain, visible: [f.celestial, f.celestial] }, () => {
      assert(f.rig.visible && f.terrain.group.visible);
      assert(f.terrain.pool[0].visible); assert(!f.terrain.pool[0].frustumCulled);
      assert.equal(f.terrain.pool[0].geometry, f.terrain.fineGrid);
      throw failure;
    }), error => error === failure);
    assert.deepEqual(snapshot(f.scene), before);
  } finally { f.dispose(); }
});

for (const tier of ['LOW', 'MED']) test(`${tier} warmup does not allocate or substitute near terrain`, () => {
  const f = fixture(tier);
  try {
    const before = snapshot(f.scene);
    assert.equal(f.terrain.fineGrid, null);
    withWarmupResources({ terrain: f.terrain }, () => {
      assert.equal(f.terrain.fineGrid, null);
      assert.deepEqual(snapshot(f.scene), before);
      assert(preparedResources(f.scene, f.camera).geometries.has(f.terrain.grid));
    });
    assert.deepEqual(snapshot(f.scene), before);
  } finally { f.dispose(); }
});

test('an already visible fine grid needs no terrain substitution; missing optional systems are safe', () => {
  const f = fixture();
  try {
    f.camera.position.set(100, 100, 100); f.camera.lookAt(100, 0, -1000); f.camera.updateMatrixWorld();
    f.terrain.update(f.camera, 0);
    assert(f.terrain.stats.fineNodes > 0);
    const before = snapshot(f.scene);
    withWarmupResources({ terrain: f.terrain }, () => assert.deepEqual(snapshot(f.scene), before));
    assert.equal(withWarmupResources({}, () => 42), 42);
  } finally { f.dispose(); }
});

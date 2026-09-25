import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/world/terrain.js';
import { PlanetCurvature } from '../src/world/planetcurvature.js';
import { TERRAIN_DETAIL_SELECT_M } from '../src/world/terraingrid.js';

// Culling is independent of the material graph. Keep these tests focused
// on the CPU hierarchy, pool order and conservative geographic support.
class CullingTerrain extends Terrain {
  _buildMaterial() { return new THREE.MeshBasicMaterial(); }
}
function fixture(curved = false) {
  const grid = 129, heights = new Float32Array(grid * grid);
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++)
    heights[z * grid + x] = Math.sin(x * .37) * 1200 + Math.cos(z * .21) * 800 + x * 5;
  const curvature = curved ? new PlanetCurvature() : null;
  const source = { expandBounds(mins, maxs) {
    // Geographic source support must reach every ancestor before caching.
    mins[173] = -5300; maxs[880] = 7600;
  } };
  const terrain = new CullingTerrain({ grid, minH: -2000, maxH: 3000, sizeM: 65536 },
    heights, { width: grid, height: grid }, 'NELLIS', null, {}, null, curvature, true, source);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 1, 250000);
  const dispose = () => {
    terrain.grid.dispose(); terrain.fineGrid?.dispose(); terrain.material.dispose(); terrain.tex.dispose();
  };
  return { terrain, curvature, camera, dispose };
}

function scanLeaves(terrain, level, ix, iz) {
  const width = 32, span = width >> level;
  let min = Infinity, max = -Infinity;
  for (let z = iz * span; z < (iz + 1) * span; z++)
    for (let x = ix * span; x < (ix + 1) * span; x++) {
      min = Math.min(min, terrain.leafMin[z * width + x]);
      max = Math.max(max, terrain.leafMax[z * width + x]);
    }
  return [min, max];
}

// Independent version of the prior traversal: scan leaves for each node,
// record every selection, then truncate to the fixed pool capacity.
function referenceSelection(terrain, camera) {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    camera.coordinateSystem, camera.reversedDepth);
  const box = new THREE.Box3(), selected = [];
  function visit(level, ix, iz) {
    const size = terrain.size / 2 ** level;
    const cx = -terrain.size / 2 + (ix + .5) * size;
    const cz = terrain.size / 2 - (iz + .5) * size;
    const [min, max] = scanLeaves(terrain, level, ix, iz);
    box.min.set(cx - size / 2, min - 70, cz - size / 2);
    box.max.set(cx + size / 2, max + 10, cz + size / 2);
    terrain.curvature?.bounds(box, box);
    if (!frustum.intersectsBox(box)) return;
    const dist = Math.hypot(Math.max(Math.abs(camera.position.x - cx) - size / 2, 0),
      Math.max(camera.position.y - box.max.y, box.min.y - camera.position.y, 0),
      Math.max(Math.abs(camera.position.z - cz) - size / 2, 0));
    if (level === 5 || dist > size * 2.2) {
      selected.push({ position: [cx, 0, cz], scale: [size, 1, size], level,
        fine: terrain.detailTransition.useFine && level === 5 && dist < TERRAIN_DETAIL_SELECT_M });
      return;
    }
    for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(level + 1, ix * 2 + x, iz * 2 + z);
  }
  visit(0, 0, 0);
  return selected;
}

test('cached bounds exactly equal the prior leaf scan for every node after source expansion', () => {
  const f = fixture();
  try {
    for (let level = 0; level <= 5; level++) {
      const width = 2 ** level;
      for (let z = 0; z < width; z++) for (let x = 0; x < width; x++)
        assert.deepEqual([f.terrain._nodeMin[level][z * width + x], f.terrain._nodeMax[level][z * width + x]],
          scanLeaves(f.terrain, level, x, z));
    }
    assert.equal(f.terrain._nodeMin[0][0], -5300);
    assert.equal(f.terrain._nodeMax[0][0], 7600);
    assert.equal(f.terrain._nodeMin[5], f.terrain.leafMin);
    assert.equal(f.terrain._nodeMax[5], f.terrain.leafMax);
  } finally { f.dispose(); }
});

for (const curved of [false, true]) test(`${curved ? 'curved' : 'flat'} cached traversal preserves selection, order and pool reuse`, () => {
  const f = fixture(curved), { terrain, camera, curvature } = f;
  try {
    terrain.setDetailTier('HIGH');
    const selection = terrain._selection, records = selection.slice();
    for (const [position, target] of [
      [[100, 100, 100], [100, 0, -1000]],
      [[-32000, 900, 28000], [0, 0, 0]],
      [[31000, 3000, -32000], [0, 0, 0]],
      [[0, 50000, 0], [0, 0, -1000]],
      [[90000, 12000, 90000], [0, 0, 0]],
      [[90000, 12000, 90000], [100000, 18000, 100000]],
    ]) {
      camera.position.fromArray(position); camera.lookAt(...target); camera.updateMatrixWorld();
      curvature?.beginFrame(camera);
      terrain.update(camera, .016);
      const expected = referenceSelection(terrain, camera), count = Math.min(expected.length, terrain.pool.length);
      assert.equal(terrain.stats.nodes, count);
      assert.equal(terrain.stats.overflow, expected.length - count);
      assert.equal(terrain.stats.fineNodes, expected.slice(0, count).filter(node => node.fine).length);
      for (let i = 0; i < terrain.pool.length; i++) {
        const mesh = terrain.pool[i];
        assert.equal(mesh.visible, i < count);
        if (i >= count) continue;
        assert.deepEqual(mesh.position.toArray(), expected[i].position);
        assert.deepEqual(mesh.scale.toArray(), expected[i].scale);
        assert.equal(mesh.geometry, expected[i].fine ? terrain.fineGrid : terrain.grid);
      }
      assert.equal(terrain._selection, selection);
      assert.ok(selection.every((node, i) => node === records[i]));
      curvature?.endFrame();
    }
  } finally { f.dispose(); }
});

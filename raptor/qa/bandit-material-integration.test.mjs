// Actual N02 ace/model/material setup, without an adapter or canvas renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Bandits } from '../src/game/bandits.js';
import { updateBanditVisuals } from '../src/aircraft/bandit-models.js';
import { AircraftLighting } from '../src/aircraft/lighting.js';
import { PlanetObjectBender, attachRaptorPlanetObjects } from '../src/world/planetobjects.js';
import { PlanetCurvature } from '../src/world/planetcurvature.js';
import { softDiscTexture } from '../src/engine/sprites.js';
import N02 from '../src/campaign/sorties/nellis-02.js';

function skin(group) {
  let found;
  group.traverse(mesh => { if (!found && mesh.isMesh && mesh.userData.livery) found = mesh; });
  assert(found, 'real fighter model exposes a livery coating');
  return found;
}

test('N02 mission livery receives lighting ownership before planet adaptation and survives every LOD', () => {
  // Prime the small sprite texture. The aircraft builders' documented Node
  // path omits canvas painting; tiny real maps retain its coating contract.
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  softDiscTexture(); delete globalThis.document;
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight();
  const bandits = new Bandits(scene, { quality: 'MED' });
  const curvature = new PlanetCurvature(), bender = new PlanetObjectBender(curvature);
  const lighting = new AircraftLighting({ renderer: { shadowMap: {} },
    atmosphere: { scene, sun, sky: { uSunDir: uniform(new THREE.Vector3(0, 1, 0)) } },
    params: { shadows: false }, curvature });
  const paint = new THREE.DataTexture(new Uint8Array([180, 190, 195, 255]), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const base = skin(bandits._variants[0][2]).material;
  base.map = paint; base.normalMap = normal;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 120000);
  const spawn = N02.spec.playerSpawn;
  camera.position.set(spawn.x, spawn.alt, spawn.y); camera.updateMatrixWorld();
  const world = { jet: new THREE.Group() };
  scene.add(world.jet);
  try {
    // Preserve the real boot order: register the pool, then let the mission
    // assign JACKAL's ace livery, then attach all ordinary planet meshes.
    lighting.register(bandits.root);
    assert.deepEqual(bandits.spawnFlight(N02.spec.bandits), [0]);
    const aceGroup = bandits._variants[0][2], aceSource = skin(aceGroup).material;
    assert.equal(aceSource.type, 'MeshPhysicalMaterial');
    assert.equal(aceSource.userData.livery, 'ace');
    assert.equal(lighting.materials.has(aceSource), false, 'mission assigned a new material after registration');
    const hash = bandits.hash(0x12345678);
    assert.doesNotThrow(() => {
      attachRaptorPlanetObjects(bender, { world, bandits, aircraftLighting: lighting });
      bandits.render(1, camera, 900, 0);
      lighting.refreshMaterials();
      bender.update();
    }, 'first mission warmup must not clone an already-deformed livery');
    assert.equal(bandits.hash(0x12345678), hash, 'material setup never changes mission simulation');
    const adapted = skin(aceGroup).material;
    assert.equal(adapted, lighting.materials.get(aceSource));
    assert.equal(adapted.type, 'MeshPhysicalNodeMaterial');
    assert.equal(bender._materials.get(adapted), 'moving');
    assert(adapted.positionNode && adapted.normalNode && adapted.mrtNode);
    assert.equal(adapted.map, paint); assert.equal(adapted.normalMap, normal);
    assert(adapted.color.equals(aceSource.color), 'ace color survives lighting and curvature');
    for (const source of [base, aceSource]) {
      assert(!source.positionNode && !source.normalNode && !source.mrtNode,
        'livery source remains unmodified; renderer-owned material carries planet nodes');
    }
    for (const level of ['high', 'medium', 'far', 'high']) {
      updateBanditVisuals(aceGroup, { forceLevel: level });
      lighting.refreshMaterials(); bender.update();
      assert.equal(aceGroup.userData.activeLOD, level);
      aceGroup.traverseVisible(mesh => {
        if (mesh.isMesh && mesh.userData.livery) assert.equal(mesh.material, adapted);
      });
    }

    // Later hidden pool activation must use the same ownership order, keep
    // tint sources clean, and reuse a previously prepared ace variant.
    for (const [side, aceId, livery] of [[1, -1, 'blue'], [0, -1, 'red'], [0, 1, 'ace']]) {
      const [slot] = bandits.spawnFlight([{ ...N02.spec.bandits[0], side, aceId }]);
      const group = bandits._variants[slot][2];
      lighting.refreshMaterials(); bandits.render(1, camera, 900, 0); bender.update();
      assert.equal(group.userData.livery, livery);
      assert.equal(bender._materials.get(skin(group).material), 'moving');
      if (livery === 'ace') assert.equal(skin(group).material, adapted);
    }
  } finally {
    lighting.dispose(); bandits._liveryCache.dispose(); paint.dispose(); normal.dispose();
    const geometries = new Set(); bandits.root.traverse(mesh => { if (mesh.isMesh) geometries.add(mesh.geometry); });
    for (const geometry of geometries) geometry.dispose();
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore);
    else delete globalThis.document;
  }
});

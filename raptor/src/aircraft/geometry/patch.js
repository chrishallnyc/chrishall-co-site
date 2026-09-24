// A surface patch has its own UV chart and deliberate normal boundary.
// Keep charts separate at creases; adjacent smooth patches can share an
// analytic normal function instead of welding unrelated coincident vertices.
import * as THREE from 'three';
import { cleanSurface } from './cleanup.js';

export function surfacePatch(evaluate, {
  uSegments = 24,
  vSegments = 24,
  reverse = false,
  uv = (u, v) => [u, v],
  normal = null,
  name = 'aircraftSurface',
} = {}) {
  const count = (uSegments + 1) * (vSegments + 1);
  const positions = new Float32Array(count * 3);
  const texcoords = new Float32Array(count * 2);
  const normals = normal ? new Float32Array(count * 3) : null;
  for (let j = 0; j <= vSegments; j++) {
    const v = j / vSegments;
    for (let i = 0; i <= uSegments; i++) {
      const u = i / uSegments, index = j * (uSegments + 1) + i;
      const position = evaluate(u, v);
      const texcoord = uv(u, v, position);
      positions.set(position, index * 3);
      texcoords.set(texcoord, index * 2);
      if (normal) normals.set(normal(u, v, position), index * 3);
    }
  }
  const indices = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  function triangle(i, j, k) {
    a.fromArray(positions, i * 3);
    b.fromArray(positions, j * 3);
    c.fromArray(positions, k * 3);
    ab.subVectors(b, a); ac.subVectors(c, a);
    if (ab.cross(ac).lengthSq() < 1e-18) return;
    if (reverse) indices.push(i, k, j);
    else indices.push(i, j, k);
  }
  for (let j = 0; j < vSegments; j++) {
    for (let i = 0; i < uSegments; i++) {
      const a = j * (uSegments + 1) + i, b = a + uSegments + 1;
      triangle(a, a + 1, b);
      triangle(a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(texcoords, 2));
  geometry.setIndex(indices);
  if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  cleanSurface(geometry);
  if (!normal) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function mirrorSurface(geometry, axis = 'x') {
  const component = { x: 0, y: 1, z: 2 }[axis];
  if (component === undefined) throw new Error(`Invalid mirror axis: ${axis}`);
  const mirrored = geometry.clone();
  for (const name of ['position', 'normal']) {
    const attribute = mirrored.getAttribute(name);
    if (!attribute) continue;
    for (let i = 0; i < attribute.count; i++) {
      attribute.setComponent(i, component, -attribute.getComponent(i, component));
    }
    attribute.needsUpdate = true;
  }
  const index = mirrored.index;
  if (!index) throw new Error('Surface patches must be indexed before mirroring');
  for (let i = 0; i < index.count; i += 3) {
    const j = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, j);
  }
  index.needsUpdate = true;
  mirrored.computeBoundingBox();
  mirrored.computeBoundingSphere();
  return mirrored;
}

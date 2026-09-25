import * as THREE from 'three';
import { F22_LIFTING_CHARTS, chartUV } from './f22-uv.js';

// Map movable surfaces in their neutral parent frame. Their paint therefore
// meets the fixed wing/fin exactly and travels with the mesh when articulated.
export function coatLiftingSurface(geometry, kind, neutralMatrix = null, sideSign = null) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2), point = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i);
    if (neutralMatrix) point.applyMatrix4(neutralMatrix);
    const face = n.getY(i) < 0 ? (kind === 'fin' ? 'Negative' : 'Lower') : (kind === 'fin' ? 'Positive' : 'Upper');
    // Tail codes appear only on the outward faces. Separate blank inboard
    // charts preserve the same physical paint coordinates and readable type.
    const inboard = kind === 'fin' && sideSign !== null && (sideSign > 0 ? n.getY(i) >= 0 : n.getY(i) < 0);
    uv.set(chartUV(F22_LIFTING_CHARTS[kind + (inboard ? 'Inner' : '') + face], point.z, Math.abs(point.x)), i * 2);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

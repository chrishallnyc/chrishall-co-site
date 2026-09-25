import * as THREE from 'three';
import { F22_BODY_CHARTS, chartUV } from './f22-uv.js';

// Small lofts use the same world-space paint charts as the structural skin.
// Split at chart boundaries instead of interpolating across atlas islands.
export function coatBodySurface(source) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    const chart = ny > .38 ? 'upper' : ny < -.38 ? 'lower' : 'outer';
    for (let j = i; j < i + 3; j++) uv.set(chartUV(F22_BODY_CHARTS[chart],
      p.getZ(j), chart === 'outer' ? p.getY(j) : p.getX(j)), j * 2);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

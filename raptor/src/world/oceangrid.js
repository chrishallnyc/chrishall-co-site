// Camera-centered ocean grid with a smooth density gradient. One continuous
// topology avoids ring cracks and discrete LOD changes. All shader sampling
// stays in world space; moving the mesh changes sampling locations, not waves.
import * as THREE from 'three';

export const OCEAN_GRID_SPAN = 32000;
export const OCEAN_GRID_VERTS = 384;
export const OCEAN_GRID_WARP = 6.0;

export function oceanGridAxis(span = OCEAN_GRID_SPAN, verts = OCEAN_GRID_VERTS, warp = OCEAN_GRID_WARP) {
  if (!(span > 0) || !Number.isInteger(verts) || verts < 2 || !(warp >= 0)) {
    throw new RangeError('Invalid ocean grid dimensions');
  }
  const half = span / 2, axis = new Float32Array(verts);
  const denominator = warp > 1e-5 ? Math.sinh(warp) : 1;
  for (let i = 0; i < verts; i++) {
    const u = i * 2 / (verts - 1) - 1;
    axis[i] = half * (warp > 1e-5 ? Math.sinh(warp * u) / denominator : u);
  }
  return axis;
}

export function makeOceanGrid({ span = OCEAN_GRID_SPAN, verts = OCEAN_GRID_VERTS, warp = OCEAN_GRID_WARP } = {}) {
  const axis = oceanGridAxis(span, verts, warp);
  const geometry = new THREE.PlaneGeometry(span, span, verts - 1, verts - 1).rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const spacing = new Float32Array(verts * verts);
  const axisSpacing = new Float32Array(verts);
  for (let i = 0; i < verts; i++) {
    axisSpacing[i] = Math.max(
      i > 0 ? axis[i] - axis[i - 1] : 0,
      i + 1 < verts ? axis[i + 1] - axis[i] : 0,
    );
  }
  for (let j = 0; j < verts; j++) for (let i = 0; i < verts; i++) {
    const k = j * verts + i;
    positions.setXYZ(k, axis[i], 0, axis[j]);
    // Conservative footprint of the adjacent geometry, in world meters.
    // Filtering by this actual cell size suppresses undersampled waves.
    spacing[k] = Math.max(axisSpacing[i], axisSpacing[j]);
  }
  geometry.setAttribute('waterGridSpacing', new THREE.BufferAttribute(spacing, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// Forward depth can quantize the baked -15m placeholder floor onto the
// opaque far sea. Remove only that proven hidden floor, never actual land
// or the mixed coast/near-water triangles. Reverse depth needs no mask.
import * as THREE from 'three';
import { If, Discard, uniform, dot, max } from 'three/tsl';

const geometryCoverage = new WeakMap();
const FRAME_SLOP_M = 512;
const identity = o => o.position.lengthSq() === 0 && o.quaternion.x === 0 &&
  o.quaternion.y === 0 && o.quaternion.z === 0 && o.quaternion.w === 1 &&
  o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1;

// Inscribe the actual polygon. For a curved ocean, also stop before a
// triangle could dip to the placeholder floor. Taylor's Hessian bound is
// conservative: interpolation sag <= .5 * max|H| * triangleDiameter^2.
// This is cached geometry work, not a shader or per-frame triangle walk.
export function oceanCoverage(geometry, radius = null, floorHeight = -15) {
  const prior = geometryCoverage.get(geometry);
  if (prior?.planetRadius === radius && prior?.floorHeight === floorHeight) return prior;
  const meta = geometry.userData.planetOcean, p = geometry.getAttribute('position'), index = geometry.index;
  if (meta?.innerShape !== 'near-grid-square' || !index || !p) return null;
  const outerStart = p.count - meta.angularSegments;
  let limit = Infinity, inner = 0;
  for (let i = 0; i < meta.boundaryVertices; i++) inner = Math.max(inner, Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
  for (let i = 0; i < p.count; i++) if (p.getY(i) !== 0) return null;
  for (let i = outerStart; i < p.count; i++) {
    const j = i + 1 === p.count ? outerStart : i + 1;
    const ax = p.getX(i), az = p.getZ(i), bx = p.getX(j), bz = p.getZ(j);
    limit = Math.min(limit, Math.abs(ax * bz - az * bx) / Math.hypot(bx - ax, bz - az));
  }
  if (radius) {
    const r = meta.outerRadius + FRAME_SLOP_M;
    if (!(r < radius)) return null;
    const hessian = radius * radius / (radius * radius - r * r) ** 1.5;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      let diameter = 0, nearestVertex = Infinity;
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3];
        diameter = Math.max(diameter, Math.hypot(p.getX(a) - p.getX(b), p.getZ(a) - p.getZ(b)));
        nearestVertex = Math.min(nearestVertex, Math.hypot(p.getX(a), p.getZ(a)));
      }
      // A further 2m leaves room for float arithmetic and floor tolerance.
      if (.5 * hessian * diameter * diameter >= -floorHeight - 2) {
        limit = Math.min(limit, Math.max(0, nearestVertex - diameter));
      }
    }
  }
  const result = { inner, radius: limit, planetRadius: radius, floorHeight };
  geometryCoverage.set(geometry, result);
  return result;
}

export class OceanFloorOcclusion {
  constructor(meta) {
    // This sentinel is an explicit bake_terrain.py contract, not a generic
    // elevation threshold. Unknown/new bathymetry keeps all its geometry.
    this.knownFloor = meta.minH === -15;
    this.threshold = meta.minH + Math.max(.001, (meta.maxH - meta.minH) / 65535 * .25);
    this.enabled = uniform(false);
    this.center = uniform(new THREE.Vector2());
    this.inner = uniform(0);
    this.radiusSquared = uniform(0);
  }

  update(water, camera) {
    this.enabled.value = false;
    const far = water?.far, material = far?.material;
    if (!this.knownFloor || !far?.visible || !material?.visible || material.transparent || material.opacity !== 1 ||
        !material.colorWrite || material.wireframe || material.side === THREE.BackSide || material.clippingPlanes?.length ||
        !material.depthWrite || material.alphaTest > 0 || !camera.layers.test(far.layers) || camera.position.y <= 1 ||
        far.position.y !== 0 || far.quaternion.x !== 0 || far.quaternion.y !== 0 || far.quaternion.z !== 0 ||
        far.scale.x !== 1 || far.scale.y !== 1 || far.scale.z !== 1) return;
    let ancestor = far.parent;
    for (; ancestor && !ancestor.isScene; ancestor = ancestor.parent) if (!ancestor.visible || !identity(ancestor)) return;
    if (!ancestor?.visible || !identity(ancestor)) return;
    if (water.curvature && Math.hypot(far.position.x - water.curvature.origin.value.x,
      far.position.z - water.curvature.origin.value.y) > FRAME_SLOP_M) return;
    const coverage = oceanCoverage(far.geometry, water.curvature?.radius || null);
    if (!coverage || coverage.radius <= coverage.inner) return;
    this.center.value.set(far.position.x, far.position.z);
    this.inner.value = coverage.inner;
    this.radiusSquared.value = coverage.radius ** 2;
    this.enabled.value = true;
  }

  discardHidden(wp, sampleHeightLevel0, builder) {
    if (!this.knownFloor || builder.renderer.reversedDepthBuffer === true) return;
    If(this.enabled, () => {
      const relative = wp.xz.sub(this.center).toVar('oceanFloorRelative');
      const inFarWater = max(relative.x.abs(), relative.y.abs()).greaterThan(this.inner)
        .and(dot(relative, relative).lessThan(this.radiusSquared));
      If(inFarWater.and(wp.y.lessThanEqual(this.threshold)), () => {
        // Explicit level 0: a coastline must never become the ocean floor
        // just because its mip-averaged height or ortho color looks like sea.
        If(sampleHeightLevel0().lessThanEqual(this.threshold), () => { Discard(); });
      });
    });
  }
}

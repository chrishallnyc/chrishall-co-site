import * as THREE from 'three';
import { FIN, finThick, foil } from './geometry/f22-planform.js';
import { coatBodySurface } from './geometry/f22-body-coating-uv.js';
import { mirrorSurface } from './geometry/patch.js';
import { cleanSurface } from './geometry/cleanup.js';
import { f22Quality } from './f22-quality.js';

function boomSection(geometry, z) {
  const p = geometry.attributes.position, index = geometry.index;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3);
    const za = p.getZ(a), zb = p.getZ(b);
    if (Math.abs(zb - za) < 1e-9 || z < Math.min(za, zb) - 1e-8 || z > Math.max(za, zb) + 1e-8) continue;
    const x = THREE.MathUtils.lerp(p.getX(a), p.getX(b), (z - za) / (zb - za));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  if (!(maxX > minX)) throw new Error(`Fin root has no boom cross-section at Z=${z}`);
  return { minX, maxX };
}

const cubic = (a, b, c, d, t) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;

// The caller passes the actual right boom before its temporary geometry is
// disposed. Lower attachments ray-fit that surface; no duplicate boom shape
// parameters can drift away from the visible skin.
export function buildFinRootFairings({ boomGeometry, coating, quality = 'high' }) {
  quality = f22Quality(quality);
  const [longitudinal, sideSegments] = quality === 'high' ? [42, 6] : quality === 'medium' ? [24, 4] : [12, 3];
  boomGeometry.computeBoundingBox();
  const startZ = boomGeometry.boundingBox.min.z + .00001, endZ = boomGeometry.boundingBox.max.z - .025;
  const stations = Array.from({ length: longitudinal + 1 }, (_, i) =>
    THREE.MathUtils.lerp(startZ, FIN.rootTE, i / longitudinal));
  for (let i = 1; i <= sideSegments; i++) stations.push(THREE.MathUtils.lerp(FIN.rootTE, endZ, i / sideSegments));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const boom = new THREE.Mesh(boomGeometry, material), ray = new THREE.Raycaster();
  const spanX = Math.sin(FIN.cant), spanY = Math.cos(FIN.cant);
  const positions = [], indices = [], rings = [];
  const surfaceY = (x, z) => {
    ray.set(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(boom, false)[0];
    if (!hit) throw new Error(`Fin-root attachment misses boom at X=${x}, Z=${z}`);
    return hit.point.y;
  };
  for (const z of stations) {
    const { minX, maxX } = boomSection(boomGeometry, z), width = maxX - minX;
    const centre = THREE.MathUtils.clamp(FIN.rootX, minX + width * .30, maxX - width * .30);
    const aft = THREE.MathUtils.smoothstep(z, FIN.rootTE, endZ);
    const thickness = finThick(0) * foil((z - FIN.rootLE) / (FIN.rootTE - FIN.rootLE));
    // Overlap the lower fin by 6 mm in its span direction. This hides the
    // join without changing the calibrated fin top, cant, or outer silhouette.
    const a = [FIN.rootX - spanY * thickness + spanX * .006, FIN.rootY + spanX * thickness + spanY * .006];
    const b = [FIN.rootX + spanY * thickness + spanX * .006, FIN.rootY - spanX * thickness + spanY * .006];
    if (aft > 0) {
      // Continue behind the fin root as a short toe buried in the boom.
      // A vertical end cap here looked like an open triangular wall.
      const buriedY = surfaceY(centre, z) - .018;
      for (const point of [a, b]) {
        point[0] = THREE.MathUtils.lerp(point[0], centre, aft);
        point[1] = THREE.MathUtils.lerp(point[1], buriedY, aft);
      }
    }
    const halfWidth = Math.min(.16, width * .24) * (1 - .75 * aft);
    const c = [centre + halfWidth, 0], d = [centre - halfWidth, 0];
    const buriedLimit = Math.min(a[1], b[1]) - .025;
    c[1] = Math.min(surfaceY(c[0], z) - .018, buriedLimit);
    d[1] = Math.min(surfaceY(d[0], z) - .018, buriedLimit);
    const ring = [a, b];
    const side = (top, foot, direction, t) => {
      const handle = Math.min(.12, (top[1] - foot[1]) * .35);
      return [
        cubic(top[0], top[0] - spanX * handle, foot[0] + direction * .035, foot[0], t),
        cubic(top[1], top[1] - spanY * handle, foot[1] + .015, foot[1], t),
      ];
    };
    for (let i = 1; i <= sideSegments; i++) ring.push(side(b, c, 1, i / sideSegments));
    ring.push(d);
    for (let i = sideSegments - 1; i > 0; i--) ring.push(side(a, d, -1, i / sideSegments));
    rings.push(ring);
    for (const [x, y] of ring) positions.push(x, y, z);
  }
  material.dispose();
  const stride = rings[0].length;
  for (let row = 0; row < stations.length - 1; row++) for (let col = 0; col < stride; col++) {
    const a = row * stride + col, b = row * stride + (col + 1) % stride;
    const c = a + stride, d = b + stride;
    indices.push(a, c, b, b, c, d);
  }
  for (const [row, front] of [[0, true], [stations.length - 1, false]]) {
    const ring = rings[row], z = front ? startZ : endZ, base = positions.length / 3;
    positions.push(ring.reduce((s, p) => s + p[0], 0) / stride,
      ring.reduce((s, p) => s + p[1], 0) / stride, z);
    for (const [x, y] of ring) positions.push(x, y, z);
    for (let col = 0; col < stride; col++) {
      const a = base + 1 + col, b = base + 1 + (col + 1) % stride;
      if (front) indices.push(base, a, b); else indices.push(base, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); cleanSurface(geometry); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const group = new THREE.Group(); group.name = 'finRootFairings';
  for (const [side, raw] of [['R', geometry], ['L', mirrorSurface(geometry)]]) {
    const mesh = new THREE.Mesh(coatBodySurface(raw), coating); mesh.name = `finRootFairing${side}`;
    group.add(mesh); raw.dispose();
  }
  return group;
}

// The far ocean starts at the exact square perimeter of the near grid.
// A short zipper joins that detailed boundary to the coarse radial rings,
// eliminating overlapping depths without changing the spherical horizon.
import * as THREE from "three";
import { PLANET_OCEAN_EXTENT_M } from "./planetcurvature.js";
import { oceanGridAxis, OCEAN_GRID_SPAN } from "./oceangrid.js";

export const FAR_OCEAN_INNER_M = OCEAN_GRID_SPAN / 2;
export const FAR_OCEAN_RADIAL_SEGMENTS = 96;
export const FAR_OCEAN_ANGULAR_SEGMENTS = 128;
const TAU = Math.PI * 2;

export function oceanGridBoundary(geometry = null) {
  const position = geometry?.getAttribute("position");
  const axis = position ? null : oceanGridAxis();
  const n = position ? Math.sqrt(position.count) : axis.length;
  if (!Number.isInteger(n) || n < 2) throw new RangeError("Expected a square near-ocean grid");
  const point = (i, j) => {
    const k = j * n + i;
    return position ? [position.getX(k), position.getY(k), position.getZ(k)] : [axis[i], 0, axis[j]];
  };
  const boundary = [];
  for (let i = 0; i < n; i++) boundary.push(point(i, 0));
  for (let j = 1; j < n; j++) boundary.push(point(n - 1, j));
  for (let i = n - 2; i >= 0; i--) boundary.push(point(i, n - 1));
  for (let j = n - 2; j > 0; j--) boundary.push(point(0, j));
  // Clockwise in XZ gives the same upward face winding as the near grid.
  return boundary.map(p => ({ p, angle: (Math.atan2(-p[2], p[0]) + TAU) % TAU }))
    .sort((a, b) => a.angle - b.angle);
}

export function makeFarOcean({
  nearGeometry = null, outerRadius = PLANET_OCEAN_EXTENT_M,
  radialSegments = FAR_OCEAN_RADIAL_SEGMENTS, angularSegments = FAR_OCEAN_ANGULAR_SEGMENTS,
} = {}) {
  if (!Number.isInteger(radialSegments) || radialSegments < 1 || !Number.isInteger(angularSegments) || angularSegments < 4) {
    throw new RangeError("Invalid far-ocean tessellation");
  }
  const boundary = oceanGridBoundary(nearGeometry), startAngle = boundary[0].angle;
  const radius = Math.max(...boundary.map(({ p }) => Math.hypot(p[0], p[2])));
  const minRingRadius = radius / Math.cos(Math.PI / angularSegments);
  if (!(outerRadius > minRingRadius)) throw new RangeError("Far ocean must enclose the near grid");
  const angles = [startAngle];
  for (let i = 0; i < angularSegments; i++) {
    const a = i * TAU / angularSegments;
    angles.push(a < startAngle ? a + TAU : a);
  }
  // Corner rays are constraints: a zipper must switch square sides at the
  // exact corner, otherwise a triangle can cut through the square interior.
  const maxX = Math.max(...boundary.map(({ p }) => Math.abs(p[0])));
  const maxZ = Math.max(...boundary.map(({ p }) => Math.abs(p[2])));
  for (const { p, angle } of boundary) {
    if (Math.abs(p[0]) === maxX && Math.abs(p[2]) === maxZ) angles.push(angle < startAngle ? angle + TAU : angle);
  }
  angles.sort((a, b) => a - b);
  const ringAngles = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-10);
  const positions = boundary.flatMap(({ p }) => p), indices = [];
  const firstRadius = radialSegments === 1 ? outerRadius : Math.min(minRingRadius + 256, (minRingRadius + outerRadius) / 2);
  const rings = [];
  for (let ring = 0; ring < radialSegments; ring++) {
    const r = radialSegments === 1 ? outerRadius : firstRadius + (outerRadius - firstRadius) * ring / (radialSegments - 1);
    const ids = [];
    for (const a of ringAngles) { ids.push(positions.length / 3); positions.push(Math.cos(a) * r, 0, -Math.sin(a) * r); }
    rings.push(ids);
  }
  const innerCount = boundary.length, outerCount = ringAngles.length, first = rings[0];
  let i = 0, j = 0;
  while (i < innerCount || j < outerCount) {
    const a = i % innerCount, b = first[j % outerCount];
    const nextA = i < innerCount ? boundary[(i + 1) % innerCount].angle + (i + 1 >= innerCount ? TAU : 0) : Infinity;
    const nextB = j < outerCount ? ringAngles[(j + 1) % outerCount] + (j + 1 >= outerCount ? TAU : 0) : Infinity;
    if (Math.abs(nextA - nextB) < 1e-10) {
      const c = (i + 1) % innerCount, d = first[(j + 1) % outerCount];
      indices.push(a, b, c, c, b, d); i++; j++;
    } else if (nextA < nextB) { indices.push(a, b, (i + 1) % innerCount); i++; }
    else { indices.push(a, b, first[(j + 1) % outerCount]); j++; }
  }
  for (let ring = 1; ring < rings.length; ring++) for (let k = 0; k < outerCount; k++) {
    const next = (k + 1) % outerCount, a = rings[ring - 1][k], b = rings[ring][k], c = rings[ring - 1][next], d = rings[ring][next];
    indices.push(a, b, c, c, b, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const count = positions.length / 3, normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    normals[k * 3 + 1] = 1;
    uvs[k * 2] = positions[k * 3] / (2 * outerRadius) + .5;
    uvs[k * 2 + 1] = .5 - positions[k * 3 + 2] / (2 * outerRadius);
  }
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("waterGridSpacing", new THREE.BufferAttribute(new Float32Array(count).fill(OCEAN_GRID_SPAN), 1));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.planetOcean = { innerShape: "near-grid-square", boundaryVertices: innerCount, outerRadius,
    radialSegments, angularSegments: outerCount, firstRadius };
  return geometry;
}

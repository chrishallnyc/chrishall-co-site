// Exact polygon boundaries on sampled skins. Keep original indexed vertices
// for untouched triangles; only intersections allocate new interpolated data.
import * as THREE from 'three';
import { cleanSurface } from './cleanup.js';

export function clipProjectedPolygon(source, polygon, { axes = [0, 2], subtract = true } = {}) {
  const geometry = source.clone(), entries = Object.entries(geometry.attributes);
  const arrays = Object.fromEntries(entries.map(([name, a]) => [name, Array.from(a.array)]));
  const position = arrays.position, indices = [], original = geometry.index;
  const count = original?.count ?? geometry.attributes.position.count;
  const minU = Math.min(...polygon.map(p => p[0])), maxU = Math.max(...polygon.map(p => p[0]));
  const minV = Math.min(...polygon.map(p => p[1])), maxV = Math.max(...polygon.map(p => p[1]));
  const area = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - p[1] * q[0];
  }, 0), winding = Math.sign(area);
  if (!winding) throw new Error('A clipping polygon must have area');
  const coordinate = (index, axis) => position[index * 3 + axis];
  function intersection(a, b, t) {
    if (t < 1e-8) return a;
    if (t > 1 - 1e-8) return b;
    const index = position.length / 3;
    for (const [name, attribute] of entries) {
      const values = arrays[name], size = attribute.itemSize;
      for (let j = 0; j < size; j++) values.push(values[a * size + j] + (values[b * size + j] - values[a * size + j]) * t);
    }
    return index;
  }
  function partition(vertices, a, b) {
    const signed = index => winding * ((b[0] - a[0]) * (coordinate(index, axes[1]) - a[1]) -
      (b[1] - a[1]) * (coordinate(index, axes[0]) - a[0]));
    const inside = [], outside = [];
    for (let i = 0; i < vertices.length; i++) {
      const from = vertices[i], to = vertices[(i + 1) % vertices.length];
      const d0 = signed(from), d1 = signed(to), in0 = d0 >= -1e-9, in1 = d1 >= -1e-9;
      (in0 ? inside : outside).push(from);
      if (in0 !== in1) {
        const crossed = intersection(from, to, THREE.MathUtils.clamp(d0 / (d0 - d1), 0, 1));
        inside.push(crossed); outside.push(crossed);
      }
    }
    return { inside, outside };
  }
  const append = vertices => { for (let i = 1; i < vertices.length - 1; i++) indices.push(vertices[0], vertices[i], vertices[i + 1]); };
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map(j => original ? original.getX(i + j) : i + j);
    const u = triangle.map(j => coordinate(j, axes[0])), v = triangle.map(j => coordinate(j, axes[1]));
    if (Math.max(...u) < minU || Math.min(...u) > maxU || Math.max(...v) < minV || Math.min(...v) > maxV) {
      if (subtract) append(triangle);
      continue;
    }
    let remainder = triangle;
    for (let edge = 0; edge < polygon.length && remainder.length >= 3; edge++) {
      const result = partition(remainder, polygon[edge], polygon[(edge + 1) % polygon.length]);
      if (subtract) append(result.outside);
      remainder = result.inside;
    }
    if (!subtract) append(remainder);
  }
  for (const [name, attribute] of entries) geometry.setAttribute(name,
    new THREE.Float32BufferAttribute(arrays[name], attribute.itemSize, attribute.normalized));
  geometry.setIndex(indices); cleanSurface(geometry);
  const normal = geometry.attributes.normal;
  if (normal) for (let i = 0; i < normal.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    if (length > 1e-12) normal.setXYZ(i, normal.getX(i) / length, normal.getY(i) / length, normal.getZ(i) / length);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

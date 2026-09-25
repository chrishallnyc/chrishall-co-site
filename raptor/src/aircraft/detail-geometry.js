// Small authored forms shared by the cockpit and undercarriage. Coordinates
// are metres. These helpers produce ordinary BufferGeometry on both backends.
import * as THREE from 'three';

export const vector = p => new THREE.Vector3(...p);

export function addDetail(group, name, geometry, material, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

export function tintGeometry(geometry, color) {
  const c = new THREE.Color(color), values = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) values.push(c.r, c.g, c.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(values, 3));
  return geometry;
}

export function patchGeometry(sample, columns = 20, rows = 12, flip = false) {
  const positions = [], uvs = [], indices = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    positions.push(...sample(i / columns, j / rows));
    uvs.push(i / columns, j / rows);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * (columns + 1) + i, b = a + 1, c = a + columns + 1, d = c + 1;
    if (flip) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Stations: { y, x?, z?, w, d, exponent? }. A sculpted ring loft, with caps
// separate from the sidewall so soft body normals do not roll over the ends.
export function ringLoft(stations, segments = 24) {
  const p = [], uv = [], idx = [];
  for (let j = 0; j < stations.length; j++) {
    const s = stations[j];
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, e = s.exponent ?? 1;
      const cx = Math.cos(a), sz = Math.sin(a);
      p.push((s.x ?? 0) + Math.sign(cx) * Math.abs(cx) ** e * s.w,
        s.y, (s.z ?? 0) + Math.sign(sz) * Math.abs(sz) ** e * s.d);
      uv.push(i / segments, j / (stations.length - 1));
    }
  }
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  for (const end of [0, stations.length - 1]) {
    const s = stations[end], center = p.length / 3;
    p.push(s.x ?? 0, s.y, s.z ?? 0); uv.push(.5, .5);
    for (let i = 0; i <= segments; i++) {
      const source = (end * (segments + 1) + i) * 3;
      p.push(...p.slice(source, source + 3));
      uv.push(.5 + Math.cos(i / segments * Math.PI * 2) * .5,
        .5 + Math.sin(i / segments * Math.PI * 2) * .5);
    }
    for (let i = 0; i < segments; i++) {
      if (end === 0) idx.push(center, center + i + 1, center + i + 2);
      else idx.push(center, center + i + 2, center + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function roundedBlock(width, height, depth, radius = .008) {
  const r = Math.min(radius, width / 4, height / 4, depth / 4);
  const w = width / 2 - r, h = height / 2 - r;
  const q = Math.min(r * .75, w, h);
  const shape = new THREE.Shape();
  // Round the face corners as well as the depth bevel. A square source path
  // produces eight conspicuous diagonal corners even with more bevel steps.
  shape.moveTo(-w+q,-h); shape.lineTo(w-q,-h); shape.quadraticCurveTo(w,-h,w,-h+q);
  shape.lineTo(w,h-q); shape.quadraticCurveTo(w,h,w-q,h);
  shape.lineTo(-w+q,h); shape.quadraticCurveTo(-w,h,-w,h-q);
  shape.lineTo(-w,-h+q); shape.quadraticCurveTo(-w,-h,-w+q,-h); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * r, bevelEnabled: true,
    bevelThickness: r, bevelSize: r, bevelSegments: 3, steps: 1, curveSegments: 3 });
  g.translate(0, 0, -depth / 2 + r);
  return g;
}

export function rodDetail(group, name, from, to, radius, material, endRadius = radius, segments = 12) {
  const a = vector(from), b = vector(to), delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(endRadius, radius, delta.length(), segments, 1);
  const mesh = addDetail(group, name, g, material, a.add(b).multiplyScalar(.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

export function hoseGeometry(points, radius, segments = 32, radialSegments = 8, ribs = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(vector));
  if (!ribs) return new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
  const frames = curve.computeFrenetFrames(segments, false);
  return patchGeometry((u, v) => {
    const i = Math.round(v * segments), p = curve.getPointAt(v), a = u * Math.PI * 2;
    const r = radius * (1 + .14 * Math.cos(v * Math.PI * 2 * ribs));
    return p.addScaledVector(frames.normals[i], r * Math.cos(a))
      .addScaledVector(frames.binormals[i], r * Math.sin(a)).toArray();
  }, radialSegments, segments);
}

// A strap following the body, not a rigid rectangular prism through it.
export function strapGeometry(points, width, widthAxis = [1, 0, 0], segments = 18) {
  const curve = new THREE.CatmullRomCurve3(points.map(vector)), axis = vector(widthAxis).normalize();
  return patchGeometry((u, v) => curve.getPoint(v).addScaledVector(axis, (u - .5) * width).toArray(), 2, segments);
}

export function quadGeometry(corners, rect = [0, 0, 1, 1]) {
  // Corners: bottom-left, bottom-right, top-right, top-left as viewed from front.
  const [u, v, w, h] = rect, geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([u, 1-v-h, u+w, 1-v-h, u+w, 1-v, u, 1-v], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  return geometry;
}

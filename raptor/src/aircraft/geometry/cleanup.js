import * as THREE from 'three';

// Parametric noses and sharp airfoil tips intentionally collapse rows of
// vertices. Discard their zero-area faces and unused vertices before normal
// generation, retaining separate vertices wherever an authored crease exists.
export function cleanSurface(geometry) {
  const p = geometry.attributes.position, source = geometry.index;
  const indices = [], used = new Uint8Array(p.count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0, count = source?.count ?? p.count; i < count; i += 3) {
    const ia = source ? source.getX(i) : i;
    const ib = source ? source.getX(i + 1) : i + 1;
    const ic = source ? source.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() < 1e-18) continue;
    indices.push(ia, ib, ic); used[ia] = used[ib] = used[ic] = 1;
  }
  const remap = new Uint32Array(p.count);
  let count = 0;
  for (let i = 0; i < used.length; i++) if (used[i]) remap[i] = count++;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const compact = new THREE.BufferAttribute(new attribute.array.constructor(count * attribute.itemSize), attribute.itemSize, attribute.normalized);
    for (let i = 0; i < used.length; i++) if (used[i]) compact.copyAt(remap[i], attribute, i);
    geometry.setAttribute(name, compact);
  }
  geometry.setIndex(indices.map(i => remap[i]));
  return geometry;
}

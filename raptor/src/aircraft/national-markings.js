// Subdued national markings: port upper / starboard lower, pointing forward.
// Separate thin ink geometry allows the structural coating atlas to stay
// shared without incorrectly mirroring the aircraft's asymmetric markings.
import * as THREE from 'three';

const ink = new THREE.MeshStandardMaterial({ color: 0x56656d, roughness: .73,
  metalness: .025, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  depthWrite: false });
ink.name = 'F-22 low-visibility marking ink';

export function addWingInsignia(wing, sign) {
  const upper = sign < 0, face = upper ? 1 : -1;
  const cx = sign * 3.63, cz = 3.68, radius = .176;
  const star = new THREE.Path();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, r = radius * (i % 2 ? .382 : 1);
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    if (i) star.lineTo(x, z); else star.moveTo(x, z);
  }
  star.closePath();
  const circle = new THREE.Shape();circle.absarc(0, 0, radius * 1.10, 0, Math.PI * 2);
  circle.holes.push(star);
  const shapes = [circle];
  for (const side of [-1, 1]) {
    const a = side * radius * .91, b = side * radius * 2.18;
    const min = Math.min(a, b), max = Math.max(a, b), shape = new THREE.Shape();
    shape.moveTo(min, -.068);shape.lineTo(max, -.068);shape.lineTo(max, .068);shape.lineTo(min, .068);shape.closePath();
    const hole = new THREE.Path();hole.moveTo(min + .014, -.047);hole.lineTo(min + .014, .047);
    hole.lineTo(max - .014, .047);hole.lineTo(max - .014, -.047);hole.closePath();shape.holes.push(hole);
    shapes.push(shape);
    const stripe = new THREE.Shape();stripe.moveTo(min + .01, -.007);stripe.lineTo(max - .01, -.007);
    stripe.lineTo(max - .01, .007);stripe.lineTo(min + .01, .007);stripe.closePath();shapes.push(stripe);
  }
  const geometry = new THREE.ShapeGeometry(shapes, 24), positions = geometry.attributes.position;
  const wingMesh = wing.children.find(child => child.isMesh && child.name.startsWith('wing'));
  if (!wingMesh) throw new Error('Wing marking requires its structural wing mesh');
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  // Reflection/clipping can retain a source geometry's cached bounds. The
  // local-space probe needs bounds recomputed from the final wing vertices.
  wingMesh.geometry.computeBoundingBox();wingMesh.geometry.computeBoundingSphere();
  const probe = new THREE.Mesh(wingMesh.geometry, probeMaterial), ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -face, 0);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + cx, z = positions.getY(i) + cz;
    ray.ray.origin.set(x, face * 2, z);
    const hit = ray.intersectObject(probe, false)[0];
    if (!hit) throw new Error(`National marking falls outside ${wing.name} at x=${x}, z=${z}`);
    positions.setXYZ(i, x, hit.point.y + face * .0007, z);
  }
  // XY→XZ points downward. Port upper surface reverses that winding.
  if (upper) for (let i = 0; i < geometry.index.count; i += 3) {
    const b = geometry.index.getX(i + 1);geometry.index.setX(i + 1, geometry.index.getX(i + 2));geometry.index.setX(i + 2, b);
  }
  geometry.computeVertexNormals();geometry.computeBoundingSphere();probeMaterial.dispose();
  const mesh = new THREE.Mesh(geometry, ink);mesh.name = 'nationalInsignia';
  mesh.userData.aircraftDecal = true;mesh.userData.excludeAO = true;wing.add(mesh);return mesh;
}

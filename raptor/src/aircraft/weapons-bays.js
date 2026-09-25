import * as THREE from 'three';
import { MAIN_BAYS } from './geometry/f22-bay-layout.js';
import { airframeBottom, buildAirframeGeometry } from './geometry/f22-airframe.js';
import { clipProjectedPolygon } from './geometry/clip-polygon.js';
import { mergeDetails } from './hardware.js';
import { panelStructure,addFormedRib } from './bay-structure.js';
import { rodDetail,hoseGeometry } from './detail-geometry.js';

const pairedDoors = new WeakMap();
const DOOR_OFFSET = .002, DOOR_THICKNESS = .018;

export function joinSurfaces(surfaces) {
  const geometry = new THREE.BufferGeometry(), index = [];
  if (!surfaces.length) return geometry;
  // Clipped skin carries both its authored atlas and metre-scale finish UVs.
  // Preserve every compatible common attribute; interior-only joins can omit
  // optional charts that are absent from their simple thickness/rim geometry.
  for (const [name,first] of Object.entries(surfaces[0].attributes)) {
    if (!surfaces.every(surface=>{
      const attribute=surface.attributes[name];
      return attribute && attribute.itemSize===first.itemSize && attribute.normalized===first.normalized &&
        attribute.array.constructor===first.array.constructor;
    })) continue;
    const size=first.itemSize;
    const values = new first.array.constructor(surfaces.reduce((n, surface) => n + surface.attributes[name].array.length, 0));
    let offset = 0;
    for (const surface of surfaces) {
      values.set(surface.attributes[name].array, offset);
      offset += surface.attributes[name].array.length;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values,size,first.normalized));
  }
  let offset = 0;
  for (const surface of surfaces) {
    for (let i = 0; i < surface.index.count; i++) index.push(surface.index.getX(i) + offset);
    offset += surface.attributes.position.count;
  }
  geometry.setIndex(index);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// The cut triangulation creates additional vertices along the polygon. Use
// those exact boundary segments for both the door thickness and cavity walls;
// independently sampling the analytic skin leaves visible cracks at creases.
export function perimeterEdges(geometry, outline) {
  const p = geometry.attributes.position, edges = new Map();
  const point = i => [p.getX(i), p.getY(i), p.getZ(i)];
  const key = value => value.map(v => Math.round(v * 1e6)).join(',');
  const onEdge = (point, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const along = ((point[0] - a[0]) * dx + (point[2] - a[1]) * dz) / length;
    return along >= -1e-6 && along <= length + 1e-6 &&
      Math.abs(dx * (point[2] - a[1]) - dz * (point[0] - a[0])) <= length * 1e-6;
  };
  for (let i = 0; i < geometry.index.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = point(geometry.index.getX(i + j)), b = point(geometry.index.getX(i + (j + 1) % 3));
    if (!outline.some((v, edge) => onEdge(a, v, outline[(edge + 1) % outline.length]) &&
        onEdge(b, v, outline[(edge + 1) % outline.length]))) continue;
    const ka = key(a), kb = key(b), edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (edges.has(edgeKey)) edges.delete(edgeKey);
    else edges.set(edgeKey, [a, b]);
  }
  return [...edges.values()];
}

export function edgeStrip(edges, lowerHeight, upperHeight, inward = false) {
  const positions = [], uv = [], indices = [];
  for (const [a, b] of edges) {
    const first = positions.length / 3, length = Math.hypot(...a.map((v, i) => v - b[i]));
    positions.push(a[0], lowerHeight(a), a[2], b[0], lowerHeight(b), b[2],
      a[0], upperHeight(a), a[2], b[0], upperHeight(b), b[2]);
    uv.push(0, 0, length, 0, 0, 1, length, 1);
    // The lower skin faces down: reversing its edge winding faces outward
    // through the thickness. The fixed cavity uses the opposite side.
    if (inward) indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
    else indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function buildMainWeaponsBays(coating, quality = 'high') {
  const cavity = new THREE.Group(); cavity.name = 'mainWeaponBayInterior';
  const liner = new THREE.MeshStandardMaterial({ color: 0x9a9e98, roughness: .77, metalness: .12 });
  liner.name = 'weapon-bay-liner';
  const rail = new THREE.MeshStandardMaterial({ color: 0x6d7678, roughness: .58, metalness: .47 });
  rail.name = 'weapon-bay-hardware';
  const structure = new THREE.MeshStandardMaterial({color:0x87978e,roughness:.71,metalness:.19});
  structure.name = 'weapon-bay-formed-structure';
  const add = (parent, name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; parent.add(mesh); return mesh;
  };
  const source = buildAirframeGeometry({ quality, cutOpenings: false });
  const lowerSkins = source.filter(surface => /^(keel|intakeLowerRamp)/.test(surface.name));
  const doors = MAIN_BAYS.map((outline, index) => {
    const sign = index ? 1 : -1, hingeX = sign * .715;
    const pivot = new THREE.Group(); pivot.name = index ? 'mainBayCounterDoor' : 'bayMain';
    pivot.position.set(hingeX, airframeBottom(hingeX, .45), .45);
    const patches = lowerSkins.map(surface => clipProjectedPolygon(surface.geometry, outline, { subtract: false }));
    const skin = joinSurfaces(patches); patches.forEach(patch => patch.dispose());
    skin.translate(0, -DOOR_OFFSET, 0);
    const boundary = perimeterEdges(skin, outline);
    const reinforcement=panelStructure(skin,outline,structure,{quality,normalSign:-1,lift:DOOR_THICKNESS+.001,
      depth:.025,width:.038,fractions:[.18,.40,.63,.84],name:'mainDoorInnerStructure',offset:pivot.position.clone().negate()});
    for(const z of [-1.04,.42,1.98])rodDetail(reinforcement,'doorHingeKnuckle',
      [hingeX,airframeBottom(hingeX,z)+.025,z-.064],[hingeX,airframeBottom(hingeX,z)+.025,z+.064],.019,structure,.019,quality==='low'?6:10);
    pivot.add(mergeDetails(reinforcement));
    const inner = skin.clone(), p = inner.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + DOOR_THICKNESS);
    for (let i = 0; i < inner.index.count; i += 3) {
      const b = inner.index.getX(i + 1); inner.index.setX(i + 1, inner.index.getX(i + 2)); inner.index.setX(i + 2, b);
    }
    inner.computeVertexNormals();
    const rim = edgeStrip(boundary, p => p[1], p => p[1] + DOOR_THICKNESS);
    const lining = joinSurfaces([inner, rim]); inner.dispose(); rim.dispose();
    for (const geometry of [skin, lining]) geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    add(pivot, 'bayDoorSkin', skin, coating);
    add(pivot, 'bayDoorLiner', lining, liner);

    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
    const ceiling = new THREE.ShapeGeometry(shape), cp = ceiling.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setXYZ(i, cp.getX(i), -.265, cp.getY(i));
    ceiling.computeVertexNormals(); add(cavity, 'bayCeiling', ceiling, liner);
    add(cavity, 'bayWall', edgeStrip(boundary, p => p[1] + DOOR_OFFSET, () => -.265, true), liner);
    for (const x of [.19, .49]) {
      const beam = add(cavity, 'ejectorRail', new THREE.BoxGeometry(.032, .056, 3.25), rail);
      beam.position.set(sign * x, -.305, .45);
    }
    for (const z of [-.93, .29, 1.55]) {
      const brace = add(cavity, 'bayCrossBrace', new THREE.BoxGeometry(.51, .024, .034), rail);
      brace.position.set(sign * .34, -.289, z);
    }
    // These are the broad blank surfaces seen from a low oblique view.
    // Reinforce their actual inward-facing walls, leaving the coated outside
    // of the opened doors uninterrupted.
    for(const [x,inward] of [[sign*.715,-sign],[sign*.035,sign]]){
      const normal=new THREE.Vector3(inward,0,0);
      for(const z of [-1.07,.02,1.12,2.09]){
        const bottom=airframeBottom(x,z)+.075;
        addFormedRib(cavity,'bayWallFrame',[new THREE.Vector3(x,bottom,z),new THREE.Vector3(x,-.305,z)],
          [normal,normal],.038,.025,structure,quality);
      }
      const points=[],normals=[];
      const segments=quality==='low'?6:quality==='medium'?12:20;
      for(let i=0;i<=segments;i++){const z=-1.17+3.34*i/segments;points.push(new THREE.Vector3(x,airframeBottom(x,z)+.08,z));normals.push(normal);}
      addFormedRib(cavity,'bayWallLowerChannel',points,normals,.034,.022,structure,quality);
    }
    if(quality!=='low'){
      const line=add(cavity,'bayServiceLine',hoseGeometry([[sign*.670,-.36,-1.04],[sign*.670,-.335,-.82],
        [sign*.670,-.335,1.90],[sign*.635,-.40,2.08]],.008,24,6),rail);
      line.userData.aircraftInteriorDetail=true;
    }
    pivot.userData.weaponBay = { side: sign, outline, closedAngle: 0, openAngle: sign * 95 };
    return pivot;
  });
  source.forEach(surface => surface.geometry.dispose());
  doors[0].userData.counterDoor = doors[1].name;
  pairedDoors.set(doors[0], doors[1]);
  return { primary: doors[0], counter: doors[1], cavity: mergeDetails(cavity) };
}

// Preserve the established single public bayMain control. The second door
// mirrors its angle around its own physical hinge instead of a centre pivot.
export function syncMainBayDoors(parts) {
  const primary = parts.bayMain;
  if (!primary?.userData.counterDoor) return;
  let counter = pairedDoors.get(primary);
  if (!counter) {
    counter = primary.parent?.getObjectByName(primary.userData.counterDoor);
    if (counter) pairedDoors.set(primary, counter);
  }
  if (counter) counter.quaternion.copy(primary.quaternion).invert();
}

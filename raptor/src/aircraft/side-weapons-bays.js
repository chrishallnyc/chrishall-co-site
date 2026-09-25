import * as THREE from 'three';
import { buildAirframeGeometry } from './geometry/f22-airframe.js';
import { clipProjectedPolygon } from './geometry/clip-polygon.js';
import { SIDE_BAY_AXES, SIDE_BAY_OUTLINE, SIDE_BAY_OPEN_DEGREES } from './geometry/f22-side-bay-layout.js';
import { joinSurfaces, perimeterEdges } from './weapons-bays.js';
import { mergeDetails } from './hardware.js';
import { panelStructure,surfaceSampler,addFormedRib } from './bay-structure.js';
import { rodDetail } from './detail-geometry.js';

const THICKNESS = .018;
const toBoundaryProjection = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

function reverseFaces(geometry) {
  const index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
  }
  geometry.computeVertexNormals(); return geometry;
}

// Boundary winding comes from the skin itself. Reversing that edge on the
// connecting face produces a closed shell for either side of the aircraft.
function connectEdges(edges, transform, inward = false) {
  const position = [], uv = [], index = [];
  for (const [a, b] of edges) {
    const i = position.length / 3, c = transform(a), d = transform(b);
    position.push(...a, ...b, ...c, ...d); uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    if (inward) index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    else index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index); geometry.computeVertexNormals(); return geometry;
}

function interiorX(x, z, sign) {
  const t = THREE.MathUtils.smoothstep(z, -.70, .30);
  // The forward wall tapers clear of the existing intake duct.
  return x - sign * (.12 + .14 * t);
}

export function buildSideWeaponsBays(coating, quality = 'high') {
  const source = buildAirframeGeometry({ quality, cutOpenings: false });
  const cavity = new THREE.Group(); cavity.name = 'sideWeaponBayInteriors';
  const liner = new THREE.MeshStandardMaterial({ color: 0x969d98, roughness: .77, metalness: .12 });
  liner.name = 'side-weapon-bay-liner';
  const hardware = new THREE.MeshStandardMaterial({ color: 0x64706f, roughness: .63, metalness: .43 });
  hardware.name = 'side-weapon-bay-hardware';
  const structure=new THREE.MeshStandardMaterial({color:0x84958c,roughness:.72,metalness:.18});
  structure.name='side-bay-formed-structure';
  const add = (parent, name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; parent.add(mesh); return mesh;
  };
  const doors = [1, -1].map(sign => {
    const surface = source.find(s => s.name === `intakeOuterWall${sign > 0 ? 'R' : 'L'}`);
    const skin = clipProjectedPolygon(surface.geometry, SIDE_BAY_OUTLINE, { axes: SIDE_BAY_AXES, subtract: false });
    const projected = skin.clone().applyMatrix4(toBoundaryProjection);
    const boundary = perimeterEdges(projected, SIDE_BAY_OUTLINE).map(edge => edge.map(([z, x, y]) => [x, y, z]));
    projected.dispose();
    const pivot = new THREE.Group(); pivot.name = sign > 0 ? 'baySideR' : 'baySideL';
    const hingeZ = -.565, hingeY = .020;
    const probe = new THREE.Mesh(surface.geometry, coating);
    const ray = new THREE.Raycaster(new THREE.Vector3(sign * 10, hingeY, hingeZ), new THREE.Vector3(-sign, 0, 0));
    const hit = ray.intersectObject(probe, false)[0];
    if (!hit) throw new Error(`Side weapon bay ${pivot.name} has no upper hinge support`);
    pivot.position.set(hit.point.x, hingeY, hingeZ);
    pivot.userData.weaponBay = { side: sign, closedAngle: 0, openAngle: sign * SIDE_BAY_OPEN_DEGREES };
    const doorStructure=panelStructure(skin,SIDE_BAY_OUTLINE,structure,{quality,axes:SIDE_BAY_AXES,normalSign:-1,
      lift:THICKNESS+.001,depth:.018,width:.035,fractions:[.18,.42,.67,.86],name:'sideDoorInnerStructure',offset:pivot.position.clone().negate()});
    for(const z of [-1.82,-.56,.73])rodDetail(doorStructure,'sideDoorHingeKnuckle',
      [pivot.position.x-sign*.020,hingeY,z-.055],[pivot.position.x-sign*.020,hingeY,z+.055],.017,structure,.017,quality==='low'?6:10);
    pivot.add(mergeDetails(doorStructure));

    const inner = reverseFaces(skin.clone().translate(-sign * THICKNESS, 0, 0));
    const rim = connectEdges(boundary, ([x, y, z]) => [x - sign * THICKNESS, y, z]);
    const lining = joinSurfaces([inner, rim]); inner.dispose(); rim.dispose();
    const back = skin.clone(), p = back.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, interiorX(p.getX(i), p.getZ(i), sign));
    back.computeVertexNormals();
    add(cavity, 'sideBayBack', back, liner);
    cavity.add(panelStructure(back,SIDE_BAY_OUTLINE,structure,{quality,axes:SIDE_BAY_AXES,
      depth:.016,width:.034,fractions:[.18,.43,.67,.86],name:`sideBayBackStructure${sign}`}));
    const sampleBack=surfaceSampler(back,SIDE_BAY_AXES);
    for(const y of [-.22,-.54]){
      const points=[],normals=[];
      const segments=quality==='low'?6:quality==='medium'?11:18;
      for(let i=0;i<=segments;i++){
        const sample=sampleBack(-2.17+3.05*i/segments,y);if(!sample)continue;
        points.push(sample.point.addScaledVector(sample.normal,.021));normals.push(sample.normal);
      }
      addFormedRib(cavity,'sideBayEquipmentRail',points,normals,.037,.014,hardware,quality);
    }
    add(cavity, 'sideBayWalls', connectEdges(boundary,
      ([x, y, z]) => [interiorX(x, z, sign), y, z], true), liner);

    // Restrained fixed mounting pads; no loadout is implied by the empty bay.
    for (const z of [-1.80, -.63, .54]) {
      const y = -.36;
      ray.set(new THREE.Vector3(sign * 10, y, z), new THREE.Vector3(-sign, 0, 0));
      const support = ray.intersectObject(probe, false)[0];
      if (!support) throw new Error(`Side weapon bay ${pivot.name} has no equipment support`);
      const pad = add(cavity, 'sideBayMount', new THREE.BoxGeometry(.045, .10, .16), hardware);
      pad.position.set(interiorX(support.point.x, z, sign) + sign * .025, y, z);
    }
    for (const geometry of [skin, lining]) geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    add(pivot, 'sideBayDoorSkin', skin, coating);
    add(pivot, 'sideBayDoorLiner', lining, liner);
    return pivot;
  });
  source.forEach(surface => surface.geometry.dispose());
  return { right: doors[0], left: doors[1], cavity: mergeDetails(cavity) };
}

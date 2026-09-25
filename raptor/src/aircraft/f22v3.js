// F-22 Raptor. The established import URL remains stable; aircraft metadata
// records the structural revision. Forward -Z, starboard +X, up +Y, metres.
// buildF22({quality}) returns {group, parts, ready}; the original 15 rig keys
// and direct-root nozzle pivots remain stable. `ready` resolves static maps.
// Reference-derived body/canopy data is in geometry/f22-airframe.js; physical
// attachments are declared once in model metadata and consumed by FlightFX.

import * as THREE from "three";
import { buildCockpit } from "./cockpit.js";
import { airframeHardware, mergeDetails, F22_GEAR_DIMENSIONS } from "./hardware.js";
import { buildAirframeGeometry, airframeTop, F22_CANOPY, canopySection, F22_NOZZLE, F22_DIMENSIONS } from "./geometry/f22-airframe.js";
import { surfacePatch } from "./geometry/patch.js";
import { cleanSurface } from "./geometry/cleanup.js";
import { createF22Coating } from "./f22-materials.js";
import { buildMainWeaponsBays } from './weapons-bays.js';
import { buildSideWeaponsBays } from './side-weapons-bays.js';
import { prepareGearWing, buildGearBays, syncGearBays, buildGearDetail, addGearStays } from './gear-bays.js';
import { GEAR_STOPS } from './geometry/f22-gear-layout.js';
import { buildFinRootFairings } from './fin-root-fairing.js';
import { addWingInsignia } from './national-markings.js';
import { buildF119Nozzle } from './f119-nozzle.js';
import { F22_LEVELS, F22_GEOMETRY_QUALITY, f22Quality } from './f22-quality.js';
import { registerF22LodResources, bindF22Lod, updateF22Visuals, F22_LOD_THRESHOLDS } from './f22-lod.js';
import { buildF22CockpitSilhouette, buildF22GearSilhouette } from './f22-detail-lod.js';
export { updateF22Visuals } from './f22-lod.js';
import { coatBodySurface } from './geometry/f22-body-coating-uv.js';
import { coatLiftingSurface } from './geometry/f22-coating-uv.js';
import { WING, TAIL, FIN, foil, wingLE, wingTE, wingTEeff, wingThick,
  stabLE, stabTE, finLE, finTE, finHinge, finThick } from './geometry/f22-planform.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- materials
function makeMaterials(quality) {
  return {
    skin: new THREE.MeshStandardMaterial({
      // Match the mapped coating on untextured controls and intake lips.
      color: 0x828b8f, roughness: 0.65, metalness: 0.07, vertexColors: true,
    }),
    canopy: new THREE.MeshPhysicalMaterial({
      color: 0xf1f3ed, roughness: 0.032, metalness: 0,
      transmission: quality === 'low' ? 0 : .94, transparent: quality === 'low',
      opacity: quality === 'low' ? .34 : 1, depthWrite: quality !== 'low', thickness: .018, ior: 1.52,
      attenuationColor: 0xcabb87, attenuationDistance: .42,
      specularColor: 0xf2dfb8, specularIntensity: .9,
      clearcoat: .65, clearcoatRoughness: 0.045, envMapIntensity: 1.0,
      iridescence: .12, iridescenceIOR: 1.3, iridescenceThicknessRange: [190, 240],
      side: THREE.FrontSide,
    }),
    dark: new THREE.MeshStandardMaterial({      // nozzle / exhaust metal
      // heat-tint gradient (straw->blue->scorched) rides in vertex colors
      color: 0x585d65, roughness: 0.35, metalness: 0.8, vertexColors: true,
    }),
    inlet: new THREE.MeshStandardMaterial({     // duct/exhaust cavity
      color: 0x0b0c0e, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide,
    }),
  };
}

// ------------------------------------------------------------ loft helpers

// Superellipse half cross-section, top-center -> chine -> bottom-center.
// s = { w, yt, yb, yc, nu, nl }. crease=true duplicates the chine vertex so
// the indexed loft gets a crisp edge there (upper/lower normals split).
function halfSection(s, KU, KL, crease = true) {
  const pts = [];
  for (let i = 0; i <= KU; i++) {
    const a = (i / KU) * Math.PI * 0.5;
    pts.push([
      s.w * Math.pow(Math.sin(a), 2 / s.nu),
      s.yc + (s.yt - s.yc) * Math.pow(Math.cos(a), 2 / s.nu),
    ]);
  }
  if (crease) pts.push([s.w, s.yc]);
  for (let i = 1; i <= KL; i++) {
    const a = (i / KL) * Math.PI * 0.5;
    pts.push([
      s.w * Math.pow(Math.cos(a), 2 / s.nl),
      s.yc + (s.yb - s.yc) * Math.pow(Math.sin(a), 2 / s.nl),
    ]);
  }
  return pts;
}

// Full ring (array of [x,y]) from a half-section: mirror the port side.
function fullRing(half) {
  const ring = half.slice();
  for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1]]);
  return ring;
}

// Indexed smooth loft. rings = arrays of [x,y,z], equal length, closed.
// Duplicated (coincident) columns produce degenerate quads => hard creases.
// Caps get their own duplicated rim vertices (crease at the rim).
function loft(rings, capStart, capEnd) {
  const P = rings[0].length, R = rings.length;
  const pos = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    const a0 = i * P, b0 = (i + 1) * P;
    for (let j = 0; j < P; j++) {
      const k = (j + 1) % P;
      idx.push(a0 + j, b0 + j, b0 + k, a0 + j, b0 + k, a0 + k);
    }
  }
  const cap = (ring, front) => {
    let cx = 0, cy = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const base = pos.length / 3;
    pos.push(cx / P, cy / P, cz / P);
    for (const p of ring) pos.push(p[0], p[1], p[2]);
    for (let j = 0; j < P; j++) {
      const k = (j + 1) % P;
      if (front) idx.push(base, base + 1 + j, base + 1 + k);
      else idx.push(base, base + 1 + k, base + 1 + j);
    }
  };
  if (capStart) cap(rings[0], true);
  if (capEnd) cap(rings[R - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  cleanSurface(g);
  g.computeVertexNormals();
  return g;
}

// Mirror an INDEXED geometry across the YZ plane with corrected winding.
function mirrorGeom(geom) {
  const g = geom.clone();
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  p.needsUpdate = true;
  const idx = g.index;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  idx.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}

// Rotate planform points about the origin in the XZ plane. rotXZ(p, ang)
// maps the direction (cos ang, sin ang) onto local +x — align a hinge line
// with ang = atan2(dz, dx), then mount the pivot with rotation.y = -ang.
function rotXZ(pts, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map((p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]);
}

// ------------------------------------------- lifting-surface loft (airfoil)
// stations: { x, zLE, zTE, cut, th } in surface-local coords (+x span-wise,
// +z aft, thickness ±y). cut (<= zTE) chops the section at a blunt wall
// (flap notch); prof(t) = half-thickness envelope over FULL-chord fraction t.
// Ring order: LE -> bottom -> TE wall -> top -> LE (outward winding for
// stations advancing +x). Sharp LE/TE collapse to crease-duplicated columns.
function surfGeometry(stations, M, prof, capRoot = true, capTip = true) {
  const rings = [];
  for (const st of stations) {
    const c = st.zTE - st.zLE;
    const tc = c > 1e-8 ? ((st.cut ?? st.zTE) - st.zLE) / c : 0;
    const ring = [];
    for (let i = 0; i <= M; i++) {              // bottom, LE -> cut TE
      const t = tc * (i / M);
      ring.push([st.x, -st.th * prof(t), st.zLE + c * t]);
    }
    ring.push([st.x, -st.th * prof(tc), st.zLE + c * tc]);   // TE wall
    ring.push([st.x, st.th * prof(tc), st.zLE + c * tc]);
    for (let i = M; i >= 0; i--) {              // top, cut TE -> LE
      const t = tc * (i / M);
      ring.push([st.x, st.th * prof(t), st.zLE + c * t]);
    }
    rings.push(ring);
  }
  return loft(rings, capRoot, capTip);
}

// airfoil: rounded LE, max depth ~37% chord, sharp TE (normalized to 1)
// control surface: blunt LE (hinge face), linear wedge to a sharp TE
const wedge = (t) => 1 - t;

// Vertex tints are only used by small untextured hardware.
function whiteColors(geom) {
  const n = geom.getAttribute("position").count;
  const col = new Float32Array(n * 3).fill(1);
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}
function tintColors(geom, rgb) {                // constant per-part tint
  const n = geom.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// -------------------------------------------------------- tail booms
// Side pods flanking the nozzles: the stab pivots bury into them and the
// fins ride their inboard shoulder — gives the F-22 aft shelf silhouette.
const BOOM = [
  { z: 4.90, cx: 1.78, w: .39, yt: .28, yb: -.32, yc: .04 },
  { z: 5.885, cx: 1.66, w: .43, yt: .20, yb: -.26, yc: .01 },
  { z: 6.75, cx: 1.40, w: .31, yt: .11, yb: -.20, yc: -.01 },
  { z: 7.948, cx: 1.16, w: .03, yt: .01, yb: -.03, yc: -.01 },
];
function boomGeometry(detail) {
  return loft(BOOM.map(s => fullRing(halfSection({ ...s, nu: 2.7, nl: 2.5 }, detail.boomUpper, detail.boomLower))
    .map(p => [p[0] + s.cx, p[1], s.z])), false, true);
}

// ------------------------------------------------------------- canopy
// Continuous open glazing follows the measured canopy stations; a separate
// seal and rim meet the explicit cockpit opening.
function canopyGeometry(detail) {
  return surfacePatch((u, v) => {
    const z = F22_CANOPY[0].z + (F22_CANOPY.at(-1).z - F22_CANOPY[0].z) * v;
    const c = canopySection(z), angle = (u - .5) * Math.PI;
    return [c.w * Math.sin(angle), c.sill + (c.top - c.sill) * Math.pow(Math.max(0, Math.cos(angle)), .9), z];
  }, { uSegments: detail.canopyU, vSegments: detail.canopyV, reverse: true, name: 'canopyGlazing' });
}
function canopyFrameGeometry(detail) {
  const rings = [];
  for (let i = 0; i <= detail.frame; i++) {
    const z = F22_CANOPY[0].z + (F22_CANOPY.at(-1).z - F22_CANOPY[0].z) * i / detail.frame;
    const c = canopySection(z);
    const section = [[c.w * 1.02, c.sill + .012], [c.w * 1.07, c.sill - .045],
      [c.w * .98, c.sill - .043], [c.w * .98, c.sill + .004]];
    rings.push(section.map(([x,y]) => [x,y,z]));
  }
  const right = loft(rings, true, true), left = mirrorGeom(right);
  const positions = new Float32Array(right.attributes.position.array.length + left.attributes.position.array.length);
  const indices = [...right.index.array, ...Array.from(left.index.array, i => i + right.attributes.position.count)];
  positions.set(right.attributes.position.array); positions.set(left.attributes.position.array, right.attributes.position.array.length);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------- wing (right)
// Clipped delta: LE sweep 42 deg, TE forward sweep 17 deg, raked tip.
// Local +X runs outboard; the shared planform also drives texture authoring.
const W_ROOT_X = WING.rootX, W_SPAN = WING.span;
const FLAP_D = WING.flapDepth, FLAP_X1 = WING.flapSpan;
const W_TIP_RAKE_X = WING.clippedTipStart;

function wingGeometry(detail) {
  const xs = [];
  for (let i = 0; i <= detail.wing; i++) xs.push((i / detail.wing) * W_SPAN);
  xs.push(FLAP_X1 - 0.02, FLAP_X1 + 0.02, W_TIP_RAKE_X);
  xs.sort((a, b) => a - b);
  const stations = xs.map((x) => ({
    x, zLE: wingLE(x), zTE: wingTEeff(x),
    cut: x <= FLAP_X1 ? wingTE(x) - FLAP_D : undefined,
    th: wingThick(x),
  }));
  return surfGeometry(stations, detail.chord, foil);
}

// flaperon: hinge line = wing notch front edge (17 deg sweep). Geometry in
// hinge-local coords (+x outboard along the hinge); pivot rotation.y=-ang.
// rotation.x > 0 = TE down on the right wing (mirrored group flips it).
const FLAP_HZ0 = wingTE(0) - FLAP_D;            // hinge z at root, wing-local
const FLAP_ANG = Math.atan2((wingTE(FLAP_X1) - FLAP_D) - FLAP_HZ0, FLAP_X1);
function flapGeometry(detail) {
  const L = Math.hypot(FLAP_X1, (wingTE(FLAP_X1) - FLAP_D) - FLAP_HZ0);
  const [teR, teT] = rotXZ([
    [0, FLAP_D], [FLAP_X1, wingTE(FLAP_X1) - FLAP_HZ0],
  ].map((p) => [p[0], p[1]]), FLAP_ANG);
  const zTE = (x) => teR[1] + (teT[1] - teR[1]) * (x - teR[0]) / (teT[0] - teR[0]);
  const stations = [0, L * 0.5, L].map((x) => ({
    x, zLE: 0, zTE: zTE(x), th: wingThick(x * FLAP_X1 / L) * foil(1 - FLAP_D /
      (wingTE(x * FLAP_X1 / L) - wingLE(x * FLAP_X1 / L))),
  }));
  return surfGeometry(stations, detail.control, wedge);
}

// -------------------------------------------------------- stabilator (right)
// All-moving pentagonal tailplane; lateral X hinge at TAIL.pivot.
// rotation.x sense identical to v2 (geometry z-aft in pivot-local coords).
const ST_PIVOT = new THREE.Vector3(...TAIL.pivot), ST_SPAN = TAIL.span;
function stabGeometry(detail) {
  const xs = [...Array.from({length: detail.tail + 1}, (_,i) => ST_SPAN * i / detail.tail), 1.635, 1.740].sort((a,b) => a-b);
  return surfGeometry(xs.map(x => ({ x, zLE: stabLE(x), zTE: stabTE(x), th: .074 - .053 * x / ST_SPAN })), detail.chord, foil);
}

// -------------------------------------------------------- vertical tail
// Canted 28 deg outboard: built flat (span along +X), rolled +62 deg (R).
// Fin-local: x = up-along-fin, z = chord (aft +). Rudder on the TE.
const FIN_SPAN = FIN.span;

function finGeometry(detail) {                        // fixed fin, blunt at hinge
  const stations = [];
  for (let i = 0; i <= detail.fin; i++) {
    const x = (i / detail.fin) * FIN_SPAN;
    stations.push({ x, zLE: finLE(x), zTE: finTE(x), cut: finHinge(x),
                    th: finThick(x) });
  }
  return surfGeometry(stations, detail.finChord, foil);
}
const RUD_ANG = Math.atan2(FIN.hingeTip - FIN.hingeRoot, FIN_SPAN);
function rudderGeometry(detail) {
  // Author the complete polygon in fin coordinates before moving it into
  // the hinge frame. Starting hinge-aligned stations at X=0 clipped away
  // the negative-X root trailing corner and lifted the rudder off its base.
  const stations = Array.from({ length: detail.fin + 1 }, (_, i) => {
    const x = FIN_SPAN * i / detail.fin;
    return { x, zLE: finHinge(x), zTE: finTE(x),
      th: finThick(x) * foil((finHinge(x) - finLE(x)) / (finTE(x) - finLE(x))) };
  });
  return surfGeometry(stations, detail.control, wedge)
    .translate(0, 0, -FIN.hingeRoot).rotateY(RUD_ANG);
}

// ================================================================ buildF22
function buildStructure({ level, mats, bodyFinish, liftingFinish }) {
  const detail = F22_GEOMETRY_QUALITY[level];
  const group = new THREE.Group();
  group.name = "f22";
  const parts = {};
  const add = (mesh, name) => { mesh.name = name; group.add(mesh); return mesh; };
  const skin = (geom, name, parent, coating) => {
    if (!coating && !geom.getAttribute("color")) whiteColors(geom);
    if (coating && !geom.getAttribute("uv")) coatLiftingSurface(geom, coating);
    const m = new THREE.Mesh(geom, coating ? liftingFinish.material : mats.skin);
    m.name = name;
    (parent || group).add(m);
    return m;
  };

  // Reference-derived airframe: open intakes share their boundaries with the
  // upper engine roofs, outer walls and lower ramps. No closed hull crosses
  // the mouths. Independent charts retain detail on vertical surfaces.
  const airframe = buildAirframeGeometry({quality:level});
  const airframeGroup = new THREE.Group(); airframeGroup.name = 'airframe';
  for (const surface of airframe) {
    const material = surface.material === 'duct' ? mats.inlet : bodyFinish.material;
    const mesh = new THREE.Mesh(surface.geometry, material);
    mesh.name = surface.name; airframeGroup.add(mesh);
  }
  const boomGeom = boomGeometry(detail);
  const finRoots=buildFinRootFairings({boomGeometry:boomGeom,coating:bodyFinish.material,quality:level});
  for(const child of [...finRoots.children])airframeGroup.add(child);
  const booms = [boomGeom, mirrorGeom(boomGeom)];
  booms.forEach((geometry, index) => {
    const mesh = new THREE.Mesh(coatBodySurface(geometry), bodyFinish.material);
    mesh.name = index === 0 ? 'boomR' : 'boomL'; airframeGroup.add(mesh);
    geometry.dispose();
  });
  group.add(mergeDetails(airframeGroup));

  // ---- canopy: aft sill pivot; positive local X raises the forward glazing.
  const canPivot = new THREE.Group();
  canPivot.position.set(0, 1.193, -3.81);
  const canGeom = canopyGeometry(detail);
  canGeom.translate(0, -1.193, 3.81);
  const glass = new THREE.Mesh(canGeom, mats.canopy);
  glass.name = "canopyGlass";
  canPivot.add(glass);
  const frameGeom = canopyFrameGeometry(detail);
  frameGeom.translate(0, -1.193, 3.81);
  tintColors(frameGeom, [0.58, 0.59, 0.62]);   // dark sill frame, not gold
  skin(frameGeom, "canopyFrame", canPivot);
  add(canPivot, "canopy");
  parts.canopy = canPivot;

  // ---- wings (slight anhedral; rotation.z sense verified in the lab)
  let wingGeomR = wingGeometry(detail);
  const wingR = new THREE.Group();
  wingR.position.set(W_ROOT_X, 0.15, 0);
  wingR.rotation.z = -WING.anhedral;                  // drops the +X tip
  coatLiftingSurface(wingGeomR, "wing");
  const gearWing=prepareGearWing(wingGeomR);wingGeomR=gearWing.geometry;
  skin(wingGeomR, "wingRmesh", wingR, "wing");
  add(wingR, "wingR");
  const wingL = new THREE.Group();
  wingL.position.set(-W_ROOT_X, 0.15, 0);
  wingL.rotation.z = WING.anhedral;
  skin(mirrorGeom(wingGeomR), "wingLmesh", wingL, "wing");
  add(wingL, "wingL");
  addWingInsignia(wingL,-1);addWingInsignia(wingR,1);
  group.add(buildGearBays(bodyFinish.material,liftingFinish.material,level,gearWing.lowerWorld,gearWing.upperWorld));
  gearWing.lowerWorld.dispose();gearWing.upperWorld.dispose();

  for (const [wing, sign, color] of [[wingR, 1, 0x7cad97], [wingL, -1, 0x9e5148]]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 6),
      new THREE.MeshStandardMaterial({color, emissive:color, emissiveIntensity:.28, roughness:.22}));
    lens.name = "navigationLens";
    lens.scale.set(.6,.6,2.8);
    lens.position.set(sign*(W_SPAN-.04),.008,3.75);
    wing.add(lens);
  }

  // flaperons: pivot local +X outboard along the hinge; rotation.x > 0 =
  // TE down on the right wing. The left flap is a mirrored geometry with a
  // mirrored hinge yaw (the wingL group itself is NOT mirrored).
  const flapGeom = flapGeometry(detail);
  const mkFlap = (mirrored) => {
    const pv = new THREE.Group();
    pv.position.set(0, 0, FLAP_HZ0);            // wing-local root hinge point
    pv.rotation.y = mirrored ? FLAP_ANG : -FLAP_ANG;
    const geometry = mirrored ? mirrorGeom(flapGeom) : flapGeom.clone();
    pv.updateMatrix(); coatLiftingSurface(geometry, 'wing', pv.matrix);
    skin(geometry, 'flapMesh', pv, 'wing');
    return pv;
  };
  parts.flaperonR = mkFlap(false); wingR.add(parts.flaperonR);
  parts.flaperonL = mkFlap(true); wingL.add(parts.flaperonL);
  parts.flaperonR.name = "flaperonR"; parts.flaperonL.name = "flaperonL";

  // ---- stabilators (all-moving; hinge axis = X, lateral)
  const stabGeom = stabGeometry(detail);
  const stabR = new THREE.Group();
  stabR.position.copy(ST_PIVOT);
  coatLiftingSurface(stabGeom, "tail");
  skin(stabGeom, "stabRmesh", stabR, "tail");
  add(stabR, "stabR"); parts.stabR = stabR;
  const stabL = new THREE.Group();
  stabL.position.set(-ST_PIVOT.x, ST_PIVOT.y, ST_PIVOT.z);
  skin(mirrorGeom(stabGeom), "stabLmesh", stabL, "tail");
  add(stabL, "stabL"); parts.stabL = stabL;

  // ---- twin verticals canted 28 deg outboard (roll 62/118 deg from flat)
  const finGeom = finGeometry(detail);
  coatLiftingSurface(finGeom, "fin");
  const rudGeom = rudderGeometry(detail);
  // fin geometry is shared by both sides: the whole fin-local frame is
  // rolled (62 deg right / 118 deg left), so no geometry mirror (v2 scheme).
  const mkTail = (sideSign) => {
    const fin = new THREE.Group();
    fin.position.set(FIN.rootX * sideSign, FIN.rootY, 0);
    fin.rotation.z = sideSign > 0 ? 62 * DEG : 118 * DEG;
    const fixedFin=finGeom.clone(); coatLiftingSurface(fixedFin, "fin", undefined, sideSign);
    skin(fixedFin, "finMesh", fin, "fin");
    const rud = new THREE.Group();
    rud.position.set(0, 0, FIN.hingeRoot);
    rud.rotation.y = -RUD_ANG;
    const rudder = rudGeom.clone();
    rud.updateMatrix(); coatLiftingSurface(rudder, 'fin', rud.matrix, sideSign);
    skin(rudder, 'rudMesh', rud, 'fin');
    fin.add(rud);
    return { fin, rud };
  };
  const tR = mkTail(1), tL = mkTail(-1);
  add(tR.fin, "finR"); add(tL.fin, "finL");
  parts.rudderR = tR.rud; parts.rudderL = tL.rud;
  parts.rudderR.name = "rudderR"; parts.rudderL.name = "rudderL";

  // ---- nozzles: reference-located pivots remain DIRECT children of the group;
  // hinge axis = X (2D pitch vectoring); exit plane at pivot-local z=1.36.
  parts.nozzleR = buildF119Nozzle({ quality:level });
  parts.nozzleR.position.set(F22_NOZZLE.x, F22_NOZZLE.y, F22_NOZZLE.z);
  add(parts.nozzleR, 'nozzleR');
  parts.nozzleL = parts.nozzleR.clone(true);
  parts.nozzleL.position.x = -F22_NOZZLE.x;
  add(parts.nozzleL, 'nozzleL');

  // Main weapon bays have conforming skins, separate physical hinges and
  // enclosed interiors. The public left-door controller mirrors its partner.
  const mainBays = buildMainWeaponsBays(bodyFinish.material, level);
  parts.bayMain = mainBays.primary;
  add(mainBays.primary, 'bayMain');
  add(mainBays.counter, 'mainBayCounterDoor');
  group.add(mainBays.cavity);
  const sideBays=buildSideWeaponsBays(bodyFinish.material,level);
  parts.baySideR=sideBays.right;parts.baySideL=sideBays.left;
  add(sideBays.right,'baySideR');add(sideBays.left,'baySideL');group.add(sideBays.cavity);

  // ---- manufacturer's nominal tire dimensions and photo-calibrated gear
  // mounts. All three deployed contact patches sit at y=-1.973 metres.
  parts.gearNose = new THREE.Group();
  parts.gearNose.position.set(0, -.76, -3.81);
  add(parts.gearNose, "gearNose");
  parts.gearR = new THREE.Group();
  parts.gearR.position.set(1.22, -.50, 2.10);
  add(parts.gearR, "gearR");
  parts.gearL = new THREE.Group();
  parts.gearL.position.set(-1.22, -.50, 2.10);
  add(parts.gearL, "gearL");

  group.userData.aircraft = {
    version: 4, forward: [0, 0, -1], ...F22_DIMENSIONS,
    attachments: {
      nozzleL: { part: 'nozzleL', position: [0, 0, F22_NOZZLE.exit], direction: [0, 0, 1] },
      nozzleR: { part: 'nozzleR', position: [0, 0, F22_NOZZLE.exit], direction: [0, 0, 1] },
      wingtipL: { part: null, position: [-6.78, -.1183, 3.76] },
      wingtipR: { part: null, position: [6.78, -.1183, 3.76] },
    },
    hinges: {
      ...Object.fromEntries(Object.keys(parts).map(name => [name, {
        axis: name.startsWith('bay') ? [0, 0, 1] : [1, 0, 0],
        minDeg: name.startsWith('nozzle') ? -20 : -25,
        maxDeg: name.startsWith('nozzle') ? 20 : 25,
      }])),
      canopy: { axis: [1, 0, 0], minDeg: 0, maxDeg: 65 },
      bayMain: { axis: [0, 0, 1], minDeg: -100, maxDeg: 0 },
      baySideR: {axis:[0,0,1],minDeg:0,maxDeg:80},
      baySideL: {axis:[0,0,1],minDeg:-80,maxDeg:0},
      flaperonL: { axis: [1, 0, 0], minDeg: -20, maxDeg: 20 },
      flaperonR: { axis: [1, 0, 0], minDeg: -20, maxDeg: 20 },
      rudderL: { axis: [1, 0, 0], minDeg: -30, maxDeg: 30 },
      rudderR: { axis: [1, 0, 0], minDeg: -30, maxDeg: 30 },
      gearNose: { axis: [1, 0, 0], minDeg: 0, maxDeg: GEAR_STOPS.gearNose, stowedDeg: GEAR_STOPS.gearNose, deployedDeg: 0 },
      gearR: { axis: [0, 0, 1], minDeg: 0, maxDeg: GEAR_STOPS.gearR, stowedDeg: GEAR_STOPS.gearR, deployedDeg: 0 },
      gearL: { axis: [0, 0, 1], minDeg: GEAR_STOPS.gearL, maxDeg: 0, stowedDeg: GEAR_STOPS.gearL, deployedDeg: 0 },
    },
  };
  return { group, parts };
}


// One immutable geometry/resource family per selected quality. Every instance
// gets independent pivots and mesh transforms, including cloned nozzle rigs.
// Lower tiers never construct the high cockpit or request the high atlases.
const modelResources = new Map();

function createResources(quality) {
  const mats = makeMaterials(quality);
  const bodyFinish = createF22Coating('body', quality);
  const liftingFinish = createF22Coating('lifting', quality);
  const structures = {};
  for (const level of F22_LEVELS.slice(F22_LEVELS.indexOf(quality)))
    structures[level] = buildStructure({level,mats,bodyFinish,liftingFinish});
  const primary = structures[quality];
  registerF22LodResources(quality, structures);
  const {group,parts} = primary;
  if (quality === 'high') {
    const cockpit = buildCockpit({canopyStations:F22_CANOPY});
    cockpit.userData.f22LodVisible = ['high'];group.add(cockpit);
    const hardware = airframeHardware(airframeTop);
    hardware.userData.f22LodVisible = ['high'];group.add(hardware);
  }
  group.add(buildF22CockpitSilhouette());
  for (const [name,kind,side,length] of [
    ['gearNose','nose',1,.91455],['gearR','main',1,1.0031],['gearL','main',-1,1.0031],
  ]) {
    if (quality === 'high') {
      const spec = F22_GEAR_DIMENSIONS[kind];
      const detailed = buildGearDetail(length,spec.radius,spec.width,{kind,side});
      detailed.name = 'gearDetail';detailed.userData.f22LodVisible = ['high'];
      parts[name].add(detailed);
    }
    const silhouette = buildF22GearSilhouette(kind,side);
    parts[name].userData.landingGear = {...silhouette.userData.landingGear};
    parts[name].add(silhouette);
  }
  addGearStays(group);
  group.userData.aircraft.lod = {quality,level:quality,thresholds:{...F22_LOD_THRESHOLDS}};
  // Alternate structures contribute geometry only. Retain the primary
  // materials, including any future scene-specific atmospheric decoration.
  const retained = new Set();group.traverse(object=>{if(object.material)retained.add(object.material);});
  for(const [level,built] of Object.entries(structures)) if(level !== quality)
    built.group.traverse(object=>{if(object.material && !retained.has(object.material))object.material.dispose();});
  bindF22Lod(group);
  const ready = Promise.all([bodyFinish.ready,liftingFinish.ready]);
  // Texture loaders already report failures. Mark the aggregate handled for
  // synchronous game callers while retaining rejection for awaited lab/QA.
  ready.catch(() => {});
  return {group,partNames:Object.keys(parts),ready};
}

export function buildF22({quality='high',geometryLevel} = {}) {
  quality = f22Quality(quality);
  let resource = modelResources.get(quality);
  if (!resource) {resource=createResources(quality);modelResources.set(quality,resource);}
  const group = resource.group.clone(true);
  const parts = Object.fromEntries(resource.partNames.map(name=>[name,group.getObjectByName(name)]));
  bindF22Lod(group);
  syncGearBays(group,1);
  if (geometryLevel !== undefined) updateF22Visuals(group,{forceLevel:geometryLevel});
  return {group,parts,ready:resource.ready};
}

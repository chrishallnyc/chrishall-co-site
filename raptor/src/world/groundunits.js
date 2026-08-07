// RAPTOR ground/naval unit models (phase 9 prep) — procedural low-poly
// BufferGeometry/primitive composition, real-world scale in meters,
// +Z forward / Y up (matches the F-22 and terrain convention). Each
// buildX() returns { group, parts } where `parts` exposes named
// sub-groups for gameplay aiming/animation (turret yaw, barrel pitch,
// radar spin, missile-tube hinge). No textures — silhouette + material
// tone carries readability at gameplay distance.

import * as THREE from "three";

// ---------- shared materials (cheap: reused across units) ----------
const MAT = {
  olive: new THREE.MeshStandardMaterial({ color: 0x4c5738, roughness: 0.85, metalness: 0.15 }),
  oliveDk: new THREE.MeshStandardMaterial({ color: 0x38412a, roughness: 0.85, metalness: 0.15 }),
  track: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9, metalness: 0.3 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.5, metalness: 0.8 }),
  radar: new THREE.MeshStandardMaterial({ color: 0xd6d8d2, roughness: 0.4, metalness: 0.35 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.15, metalness: 0.6 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8a8264, roughness: 0.9, metalness: 0.05 }),
  canvas: new THREE.MeshStandardMaterial({ color: 0x5c5a48, roughness: 0.95, metalness: 0.0 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95, metalness: 0.0 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 0.6, metalness: 0.5 }),
  missile: new THREE.MeshStandardMaterial({ color: 0xcaccc4, roughness: 0.45, metalness: 0.2 }),
  missileTip: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.3 }),
  hull: new THREE.MeshStandardMaterial({ color: 0x707a7e, roughness: 0.65, metalness: 0.35 }),
  hullDk: new THREE.MeshStandardMaterial({ color: 0x484f52, roughness: 0.7, metalness: 0.3 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x54595b, roughness: 0.85, metalness: 0.1 }),
  vls: new THREE.MeshStandardMaterial({ color: 0x2f3335, roughness: 0.75, metalness: 0.25 }),
  super: new THREE.MeshStandardMaterial({ color: 0x868e90, roughness: 0.6, metalness: 0.25 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.6, metalness: 0.05 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xd9b545, roughness: 0.7, metalness: 0.0 }),
  cargoRed: new THREE.MeshStandardMaterial({ color: 0xa8422c, roughness: 0.7, metalness: 0.1 }),
  cargoBlue: new THREE.MeshStandardMaterial({ color: 0x2c6486, roughness: 0.7, metalness: 0.1 }),
  cargoTeal: new THREE.MeshStandardMaterial({ color: 0x2c8074, roughness: 0.7, metalness: 0.1 }),
  hullCargo: new THREE.MeshStandardMaterial({ color: 0x5c3d33, roughness: 0.8, metalness: 0.15 }),
};

// ---------- geometry helpers ----------
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function m(geo, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}
function grp(name) { const g = new THREE.Group(); g.name = name; return g; }

// axis-aligned cylinder, default axis Y (vertical)
function cyl(r1, r2, h, mat, seg = 10) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); }

// wedge: XZ-plane isoceles triangle (-w/2,0)-(w/2,0)-(0,d) extruded 0..h in Y.
// Used for tapered bow/stern hull sections and sloped glacis plates.
function wedge(w, h, d, mat) {
  const w2 = w / 2;
  const P = [
    [-w2, 0, 0], [w2, 0, 0], [0, 0, d], // bottom triangle
    [-w2, h, 0], [w2, h, 0], [0, h, d], // top triangle
  ];
  const faces = [
    [0, 2, 1], [3, 4, 5],           // bottom cap, top cap
    [0, 1, 4], [0, 4, 3],           // back rect
    [1, 2, 5], [1, 5, 4],           // right slope
    [2, 0, 3], [2, 3, 5],           // left slope
  ];
  const pos = [];
  for (const f of faces) for (const i of f) pos.push(...P[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// exported so the lab viewer can report per-unit triangle counts
export function triCount(group) {
  let n = 0;
  group.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return Math.round(n);
}

// =====================================================================
// (1) ZSU-style SPAAG — tracked hull, rotating turret + 4-barrel cluster,
// spinning radar dish. parts.turret (yaw), parts.barrels (pitch cluster),
// parts.radarDish (continuous spin) are the aimable/animated members.
// =====================================================================
export function buildZSU() {
  const group = grp("zsu");
  const parts = {};

  const hullW = 2.6, hullL = 6.3, hullH = 1.05;
  const trackH = 0.72, deckY = trackH + hullH / 2;

  const hull = grp("hull");
  hull.add(m(box(hullW, hullH, hullL), MAT.olive));
  const glacis = wedge(hullW, hullH * 0.6, 0.85, MAT.oliveDk);
  glacis.position.set(0, -hullH * 0.2, hullL / 2);
  hull.add(glacis);
  hull.position.y = deckY;
  group.add(hull);
  parts.hull = hull;

  for (const side of [-1, 1]) {
    const trk = grp("track");
    const trkX = side * (hullW / 2 + 0.38);
    trk.add(m(box(0.56, trackH, hullL + 0.3), MAT.track, trkX, trackH / 2, 0));
    for (let i = 0; i < 6; i++) {
      const wz = -hullL / 2 + 0.55 + (i * (hullL - 1.1)) / 5;
      const wheel = cyl(0.33, 0.33, 0.5, MAT.track, 10);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(trkX, 0.36, wz);
      trk.add(wheel);
      const hub = cyl(0.14, 0.14, 0.54, MAT.hub, 8);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(trkX + side * 0.28, 0.36, wz);
      trk.add(hub);
    }
    group.add(trk);
  }

  const turret = grp("turret");
  turret.position.set(0, deckY + hullH / 2, -0.2);
  turret.add(m(box(2.1, 1.0, 2.1), MAT.oliveDk, 0, 0.5, 0));
  turret.add(m(box(1.5, 0.55, 0.5), MAT.oliveDk, 0, 0.55, 1.05));

  const barrels = grp("barrels");
  barrels.position.set(0, 0.65, 1.15);
  const bLen = 2.3, bR = 0.055;
  for (const [bx, by] of [[-0.22, 0.16], [0.22, 0.16], [-0.22, -0.14], [0.22, -0.14]]) {
    const b = cyl(bR, bR, bLen, MAT.barrel, 8);
    b.rotation.x = Math.PI / 2;
    b.position.set(bx, by, bLen / 2);
    barrels.add(b);
  }
  turret.add(barrels);
  parts.barrels = barrels;

  const radarDish = grp("radarDish");
  radarDish.position.set(0, 1.55, -0.85);
  radarDish.add(cyl(0.05, 0.05, 0.9, MAT.oliveDk, 6)); // mast pole
  const dish = cyl(0.4, 0.08, 0.2, MAT.radar, 10);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 0.55, 0);
  radarDish.add(dish);
  turret.add(radarDish);
  parts.radarDish = radarDish;

  parts.turret = turret;
  group.add(turret);

  return { group, parts };
}

// =====================================================================
// (2a) SAM TEL — wheeled 6x6 truck, rotating launcher ring, 4-tube rack
// that hinges from stowed (horizontal) to raised (near-vertical).
// parts.launcher (yaw), parts.tubes (hinge/pitch).
// =====================================================================
export function buildSamTel() {
  const group = grp("sam_tel");
  const parts = {};

  const chassisW = 2.9, chassisL = 9.6, deckY = 1.35;
  const chassis = grp("chassis");
  chassis.add(m(box(chassisW, 0.9, chassisL), MAT.olive, 0, deckY, 0));
  const cab = m(box(2.5, 1.5, 2.1), MAT.oliveDk, 0, deckY + 1.1, chassisL / 2 - 1.3);
  chassis.add(cab);
  chassis.add(m(box(2.3, 0.7, 0.15), MAT.glass, 0, deckY + 1.55, chassisL / 2 - 0.28));
  chassis.add(m(box(2.7, 0.4, chassisL - 3.2), MAT.tan, 0, deckY + 0.65, -0.9)); // rear bed rails
  group.add(chassis);
  parts.cab = cab;

  for (let i = 0; i < 3; i++) {
    const az = -chassisL / 2 + 1.6 + i * 2.9;
    for (const side of [-1, 1]) {
      const wheel = cyl(0.55, 0.55, 0.42, MAT.tire, 12);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (chassisW / 2 + 0.1), 0.55, az);
      group.add(wheel);
    }
  }

  const launcher = grp("launcher");
  launcher.position.set(0, deckY + 0.85, -1.0);
  launcher.add(m(box(2.6, 0.3, 3.2), MAT.oliveDk, 0, 0, 0)); // turntable base
  parts.launcher = launcher;
  group.add(launcher);

  const tubes = grp("tubes");
  tubes.position.set(0, 0.15, -1.2);
  tubes.rotation.x = -0.55; // stowed/transit-raised default pose
  const tubeLen = 4.2, tubeR = 0.24;
  const rackXY = [[-0.75, 0.35], [0.75, 0.35], [-0.75, -0.35], [0.75, -0.35]];
  for (const [tx, ty] of rackXY) {
    const t = grp("tube");
    const body = cyl(tubeR, tubeR, tubeLen, MAT.missile, 10);
    body.rotation.x = Math.PI / 2;
    body.position.z = tubeLen / 2;
    const nose = cyl(0, tubeR, 0.5, MAT.missileTip, 10);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = tubeLen + 0.25;
    t.add(body, nose);
    t.position.set(tx, ty, 0);
    tubes.add(t);
  }
  launcher.add(tubes);
  parts.tubes = tubes;

  return { group, parts };
}

// =====================================================================
// (2b) SAM engagement-radar trailer — towed platform, generator cabinet,
// central mast with a continuously-rotating tracking dish.
// parts.dish (continuous spin).
// =====================================================================
export function buildSamRadar() {
  const group = grp("sam_radar");
  const parts = {};

  const bedW = 2.5, bedL = 6.4, deckY = 1.05;
  group.add(m(box(bedW, 0.55, bedL), MAT.tan, 0, deckY, 0));
  group.add(m(box(0.35, 0.35, 1.4), MAT.tan, 0, deckY - 0.25, bedL / 2 + 0.7)); // tow tongue
  group.add(m(box(0.9, 0.7, 1.1), MAT.oliveDk, bedW / 2 - 0.1, deckY + 0.63, -bedL / 2 + 1.0)); // generator cabinet
  const fuelDrum = cyl(0.3, 0.3, 0.9, MAT.hub, 10);
  fuelDrum.position.set(-bedW / 2 + 0.35, deckY + 0.73, -bedL / 2 + 1.0);
  group.add(fuelDrum);
  const cableReel = cyl(0.35, 0.35, 0.25, MAT.oliveDk, 12);
  cableReel.position.set(bedW / 2 - 0.1, deckY + 0.4, bedL / 2 - 1.0);
  group.add(cableReel);
  for (const [lx, lz] of [[-1.05, -2.9], [1.05, -2.9], [-1.05, 2.9], [1.05, 2.9]]) {
    group.add(m(box(0.18, 0.55, 0.18), MAT.hub, lx, 0.7, lz)); // corner leveling jacks
  }

  for (let i = 0; i < 2; i++) {
    const az = -bedL / 2 + 1.2 + i * (bedL - 2.4);
    for (const side of [-1, 1]) {
      const wheel = cyl(0.48, 0.48, 0.36, MAT.tire, 12);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (bedW / 2 + 0.08), 0.48, az);
      group.add(wheel);
    }
  }
  const mast = grp("mast");
  mast.position.set(0, deckY + 0.28, 0);
  mast.add(cyl(0.14, 0.18, 1.9, MAT.hullDk, 8).translateY(0.95));
  group.add(mast);

  const dish = grp("dish");
  dish.position.set(0, 1.9, 0);
  const face = cyl(1.05, 0.15, 0.35, MAT.radar, 14);
  face.rotation.x = Math.PI / 2;
  dish.add(face);
  // feed horn
  const feed = cyl(0.05, 0.12, 0.7, MAT.hub, 8);
  feed.rotation.x = Math.PI / 2;
  feed.position.z = 0.85;
  dish.add(feed);
  mast.add(dish);
  parts.dish = dish;
  parts.mast = mast;

  return { group, parts };
}

// =====================================================================
// (3) Generic supply truck — cab + canvas-covered cargo bed.
// =====================================================================
export function buildSupplyTruck() {
  const group = grp("supply_truck");
  const parts = {};

  const chassisW = 2.4, chassisL = 7.4, deckY = 1.05;
  group.add(m(box(chassisW, 0.5, chassisL), MAT.oliveDk, 0, deckY, 0));

  const cab = grp("cab");
  cab.position.set(0, deckY + 0.75, chassisL / 2 - 1.1);
  cab.add(m(box(2.3, 1.5, 2.0), MAT.olive));
  cab.add(m(box(2.15, 0.7, 0.12), MAT.glass, 0, 0.5, 0.96));
  cab.add(m(box(2.3, 0.35, 0.3), MAT.hub, 0, -0.92, 1.05)); // front bumper
  group.add(cab);
  parts.cab = cab;

  // spare tire, tailgate-mounted
  const spare = cyl(0.5, 0.5, 0.3, MAT.tire, 12);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, deckY + 0.55, -chassisL / 2 - 0.05);
  group.add(spare);

  // side mirrors + tow hitch — cheap greebles, help the cab read at range
  for (const side of [-1, 1]) {
    const mirror = m(box(0.1, 0.3, 0.35), MAT.hub, side * 1.28, deckY + 0.95, chassisL / 2 - 0.2);
    group.add(mirror);
  }
  group.add(m(box(0.3, 0.25, 0.4), MAT.hub, 0, deckY - 0.15, -chassisL / 2 - 0.15));
  group.add(m(box(2.2, 0.3, 0.15), MAT.oliveDk, 0, deckY + 0.4, -chassisL / 2 - 0.1)); // tailgate
  for (const side of [-1, 1]) {
    const tank = cyl(0.24, 0.24, 1.3, MAT.hub, 10);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(side * (chassisW / 2 + 0.06), deckY - 0.28, 0.8);
    group.add(tank);
  }

  const bed = grp("bed");
  bed.position.set(0, deckY + 0.5, -1.0);
  bed.add(m(box(2.35, 1.0, 4.6), MAT.oliveDk, 0, 0.5, 0)); // side walls (solid block, cheap)
  const tarp = m(new THREE.CylinderGeometry(1.25, 1.25, 4.6, 8, 1, false, 0, Math.PI), MAT.canvas, 0, 1.0, 0);
  tarp.rotation.z = Math.PI / 2;
  tarp.rotation.y = Math.PI / 2;
  bed.add(tarp);
  group.add(bed);
  parts.bed = bed;

  for (let i = 0; i < 2; i++) {
    const az = -chassisL / 2 + 1.5 + i * 4.2;
    for (const side of [-1, 1]) {
      const wheel = cyl(0.5, 0.5, 0.36, MAT.tire, 12);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (chassisW / 2 + 0.08), 0.5, az);
      group.add(wheel);
    }
  }

  return { group, parts };
}

// =====================================================================
// naval shared helpers
// =====================================================================

// hull: flat-transom box + a tapered bow wedge, waterline at local y=0
function navalHull(beam, height, midLen, bowLen, draft, hullMat) {
  const h = grp("hull");
  h.add(m(box(beam, height, midLen), hullMat, 0, height / 2 - draft, 0));
  const bow = wedge(beam, height, bowLen, hullMat);
  bow.position.set(0, -draft, midLen / 2);
  h.add(bow);
  return h;
}

function gunTurret(barrelLen, barrelR, bodyW, bodyH, bodyD, bodyMat, barrelMat) {
  const yaw = grp("turretYaw");
  yaw.add(m(box(bodyW, bodyH, bodyD), bodyMat, 0, bodyH / 2, 0));
  const pitch = grp("turretPitch");
  pitch.position.set(0, bodyH * 0.6, bodyD * 0.3);
  const barrel = cyl(barrelR, barrelR, barrelLen, barrelMat, 8);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = barrelLen / 2;
  pitch.add(barrel);
  yaw.add(pitch);
  return { yaw, pitch };
}

// =====================================================================
// (4) Destroyer ~155m — bow-flared hull, tiered superstructure, mast with
// rotating radar, 2 gun turrets (fore/aft, yaw+pitch), VLS deck grid.
// =====================================================================
export function buildDestroyer() {
  const group = grp("destroyer");
  const parts = {};

  const beam = 19, height = 15, draft = 4.5;
  const bowLen = 22, midLen = 133; // total 155m
  const hull = navalHull(beam, height, midLen, bowLen, draft, MAT.hull);
  group.add(hull);
  parts.hull = hull;

  const deckY = height - draft; // main deck, above waterline

  // fore gun turret
  const foreGun = gunTurret(6.5, 0.16, 3.4, 2.4, 3.6, MAT.hullDk, MAT.barrel);
  foreGun.yaw.position.set(0, deckY, midLen / 2 - 8);
  group.add(foreGun.yaw);
  parts.turretFore = foreGun.yaw;
  parts.turretForeBarrel = foreGun.pitch;

  // aft gun turret — sits in the open deck gap between the superstructure and
  // the aft hangar block so the (wider) hangar doesn't occlude it in 3/4 views
  const aftGun = gunTurret(6.5, 0.16, 3.4, 2.4, 3.6, MAT.hullDk, MAT.barrel);
  aftGun.yaw.rotation.y = Math.PI;
  aftGun.yaw.position.set(0, deckY, -15);
  group.add(aftGun.yaw);
  parts.turretAft = aftGun.yaw;
  parts.turretAftBarrel = aftGun.pitch;

  // VLS deck grid between fore turret and superstructure
  const vlsGrid = grp("vlsGrid");
  vlsGrid.position.set(0, deckY + 0.08, midLen / 2 - 22);
  const cols = 6, rows = 4, cell = 1.5, gap = 0.35;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c - (cols - 1) / 2) * (cell + gap);
      const cz = (r - (rows - 1) / 2) * (cell + gap);
      vlsGrid.add(m(box(cell, 0.16, cell), MAT.vls, cx, 0, cz));
    }
  }
  group.add(vlsGrid);
  parts.vlsGrid = vlsGrid;

  // tiered superstructure amidships-forward
  const super1 = m(box(15, 9, 26), MAT.super, 0, deckY + 4.5, midLen / 2 - 46);
  const super2 = m(box(9, 5, 14), MAT.super, 0, deckY + 11.5, midLen / 2 - 44);
  const super3 = m(box(5, 3.5, 7), MAT.super, 0, deckY + 15.25, midLen / 2 - 42);
  group.add(super1, super2, super3);

  // aft helicopter hangar block near stern
  group.add(m(box(11, 5.5, 14), MAT.super, 0, deckY + 2.75, -midLen / 2 + 22));

  // mast + rotating radar + whip antennas
  const radarMast = grp("radarMast");
  radarMast.position.set(0, deckY + 17, midLen / 2 - 42);
  radarMast.add(cyl(0.5, 0.9, 8, MAT.hullDk, 8).translateY(4));
  const array = m(box(3.2, 3.2, 0.4), MAT.radar, 0, 8.5, 0.6);
  radarMast.add(array);
  for (const [ax, az] of [[-1.6, -0.5], [1.6, -0.5]]) radarMast.add(m(new THREE.CylinderGeometry(0.03, 0.03, 5, 5), MAT.hullDk, ax, 6.5, az));
  group.add(radarMast);
  parts.radarMast = radarMast;

  // ship's boat on a davit, amidships — small warship-specific greeble
  const boat = grp("boat");
  boat.position.set(beam / 2 - 1.2, deckY + 6, midLen / 2 - 55);
  boat.add(m(box(1.6, 0.7, 4.2), MAT.hullDk));
  group.add(boat);

  return { group, parts };
}

// =====================================================================
// (5) Carrier ~330m — angled deck with painted lines, island, deck-edge
// elevator hints. parts.island, parts.radarMast.
// =====================================================================
export function buildCarrier() {
  const group = grp("carrier");
  const parts = {};

  const hullBeam = 34, height = 18, draft = 6;
  const bowLen = 34, midLen = 266; // hull length 300m
  const hull = navalHull(hullBeam, height, midLen, bowLen, draft, MAT.hull);
  group.add(hull);
  parts.hull = hull;

  const deckY = height - draft;

  // flight deck: wider than hull, overhangs both sides, ~330m overall
  const deckLen = 320, deckBeam = 62;
  const flightDeck = m(box(deckBeam, 1.2, deckLen), MAT.deck, 0, deckY + 0.6, -5);
  group.add(flightDeck);

  // angled landing deck (port-aft), offset ~9 degrees off the axial line
  const angled = grp("angledDeck");
  angled.position.set(-6, deckY + 1.25, -deckLen / 2 + 70);
  angled.rotation.y = THREE.MathUtils.degToRad(9);
  angled.add(m(box(20, 0.1, 150), MAT.deck));
  // paint stripes (thin raised boxes, near-zero extrusion to avoid z-fight)
  angled.add(m(box(0.6, 0.12, 140), MAT.yellow, 0, 0.08, 0));
  group.add(angled);

  // bow/axial deck centerline + foul lines
  const centerline = m(box(0.5, 0.12, 200), MAT.white, 4, deckY + 1.32, 40);
  group.add(centerline);

  // island superstructure, starboard side ~60% aft of bow
  const island = grp("island");
  island.position.set(hullBeam / 2 + 6.5, deckY + 1.2, -deckLen / 2 + 130);
  island.add(m(box(11, 16, 34), MAT.super, 0, 8, 0));
  island.add(m(box(7, 4, 10), MAT.super, 0, 18, -6));
  group.add(island);
  parts.island = island;

  const radarMast = grp("radarMast");
  radarMast.position.set(0, 20, -8);
  radarMast.add(cyl(0.3, 0.5, 6, MAT.hullDk, 8).translateY(3));
  radarMast.add(m(box(2.4, 2.4, 0.3), MAT.radar, 0, 6.3, 0.5));
  island.add(radarMast);
  parts.radarMast = radarMast;

  // deck-edge elevator hints: platforms overhanging PAST the flight-deck
  // edge (not under it — a box fully under the main deck box is invisible),
  // stepped down slightly to read as a lower external platform
  const elevators = grp("elevators");
  for (const [ex, ez] of [[-deckBeam / 2 - 5, -deckLen / 2 + 40], [deckBeam / 2 + 5, -deckLen / 2 + 100], [-deckBeam / 2 - 5, -deckLen / 2 + 200]]) {
    elevators.add(m(box(12, 0.6, 16), MAT.deck, ex, deckY + 0.3, ez));
  }
  group.add(elevators);
  parts.elevators = elevators;

  // parked aircraft on the forward deck (clear of the angled landing strip
  // aft) — cheap blocky silhouettes that read unmistakably as "carrier"
  const flock = grp("parkedAircraft");
  const rows = [[-10, 30], [4, 42], [-6, 58], [10, 70], [-11, 84], [3, 96], [-9, 110], [6, 122], [-4, 136], [11, 146]];
  for (const [ax, az] of rows) {
    const plane = grp("plane");
    plane.add(m(box(2.0, 1.3, 15), MAT.super, 0, 0.65, 0));
    plane.add(m(box(11, 0.35, 4.4), MAT.super, 0, 0.9, -2.5));
    plane.add(m(box(0.25, 1.4, 2.2), MAT.super, 0, 1.6, -6.5)); // tail fin
    plane.rotation.y = 0.06;
    plane.position.set(ax, deckY + 1.2, az);
    flock.add(plane);
  }
  group.add(flock);

  return { group, parts };
}

// =====================================================================
// (6) Generic cargo/container ship — stern accommodation block, deck
// stacked containers.
// =====================================================================
export function buildCargoShip() {
  const group = grp("cargo_ship");
  const parts = {};

  const beam = 28, height = 17, draft = 5.5;
  const bowLen = 20, midLen = 150; // total 190m
  const hull = navalHull(beam, height, midLen, bowLen, draft, MAT.hullCargo);
  group.add(hull);
  parts.hull = hull;

  const deckY = height - draft;

  // stern accommodation block + funnel
  const superstructure = grp("superstructure");
  superstructure.position.set(0, deckY, -midLen / 2 + 14);
  superstructure.add(m(box(18, 14, 16), MAT.super, 0, 7, 0));
  superstructure.add(m(box(10, 4, 8), MAT.super, 0, 16, -1));
  superstructure.add(cyl(1.6, 1.9, 5, MAT.hullDk, 10).translateY(19).translateZ(-3));
  group.add(superstructure);
  parts.superstructure = superstructure;

  // deck cargo: rows of stacked containers, alternating colors
  const containerMats = [MAT.cargoRed, MAT.cargoBlue, MAT.cargoTeal];
  const cw = 2.4, cl = 6.1, ch = 2.6;
  const bays = 10, rowsAcross = 4, stackH = 3;
  const deckStart = midLen / 2 - bowLen * 0.6;
  for (let bay = 0; bay < bays; bay++) {
    const cz = deckStart - bay * (cl + 0.3);
    if (cz < -midLen / 2 + 30) break; // clear of the accommodation block
    for (let row = 0; row < rowsAcross; row++) {
      const cx = (row - (rowsAcross - 1) / 2) * (cw + 0.2);
      for (let s = 0; s < stackH; s++) {
        const mat = containerMats[(bay + row + s) % containerMats.length];
        group.add(m(box(cw, ch, cl), mat, cx, deckY + ch / 2 + s * ch, cz));
      }
    }
  }

  return { group, parts };
}

// ---------- registry ----------
export const UNITS = {
  zsu: buildZSU,
  sam_tel: buildSamTel,
  sam_radar: buildSamRadar,
  supply_truck: buildSupplyTruck,
  destroyer: buildDestroyer,
  carrier: buildCarrier,
  cargo_ship: buildCargoShip,
};

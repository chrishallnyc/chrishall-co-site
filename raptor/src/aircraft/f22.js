// F-22 Raptor — procedural lofted model.
//
// AXIS CONVENTION (documented for the whole sim):
//   forward = -Z  (nose tip at z = -9.46, nozzle exits at z = +9.46;
//   the aft sting fairing tapers out slightly beyond, to z = +9.62)
//   +X = starboard (pilot's right), +Y = up.
//   Origin: mid-length, fuselage waterline (y=0 ~ fuselage centerline).
//   Length 18.92 m, wingspan 13.56 m, height ~5.08 m (fin tips to wheel bottoms).
//
// buildF22() -> { group, parts }
//   parts = { flaperonL/R, stabL/R, rudderL/R, nozzleL/R, canopy,
//             bayMain, baySideL/R, gearNose, gearL/R }
//   Every part is a Group positioned AT its hinge; hinge axis documented inline.
//
// Geometry style: lofted superellipse cross-sections (chined forebody -> wide
// flat blended fuselage), slab-lofted flying surfaces. Non-indexed + computed
// normals = faceted shading on purpose.

import * as THREE from "three";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- materials
function makeMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({
      color: 0xa8adb5, roughness: 0.5, metalness: 0.35,
    }),
    canopy: new THREE.MeshStandardMaterial({
      // gold reads via vertex colors (fresnel-ish rim gradient baked per-vertex)
      // + a faint emissive so it stays gold with no env map.
      color: 0xffffff, vertexColors: true, roughness: 0.16, metalness: 0.55,
      emissive: 0x7a5514, emissiveIntensity: 0.35,
      transparent: true, opacity: 0.62, side: THREE.DoubleSide,
    }),
    dark: new THREE.MeshStandardMaterial({      // nozzle / exhaust metal
      color: 0x26282c, roughness: 0.38, metalness: 0.85,
    }),
    inlet: new THREE.MeshStandardMaterial({     // duct/exhaust cavity
      color: 0x0c0d0f, roughness: 0.95, metalness: 0.1,
    }),
    gear: new THREE.MeshStandardMaterial({
      color: 0x8f9399, roughness: 0.6, metalness: 0.5,
    }),
    tire: new THREE.MeshStandardMaterial({
      color: 0x17181a, roughness: 0.92, metalness: 0.0,
    }),
  };
}

// ------------------------------------------------------------ loft helpers

// Superellipse half cross-section, top-center -> chine -> bottom-center.
// s = { w:half-width at chine, yt:top y, yb:bottom y, yc:chine y,
//       nu:upper exponent, nl:lower exponent }  (n<2 pointy/chined, n>2 boxy)
function halfSection(s, KU, KL) {
  const pts = [];
  for (let i = 0; i <= KU; i++) {
    const a = (i / KU) * Math.PI * 0.5;
    pts.push([
      s.w * Math.pow(Math.sin(a), 2 / s.nu),
      s.yc + (s.yt - s.yc) * Math.pow(Math.cos(a), 2 / s.nu),
    ]);
  }
  for (let i = 1; i <= KL; i++) {
    const a = (i / KL) * Math.PI * 0.5;
    pts.push([
      s.w * Math.pow(Math.cos(a), 2 / s.nl),
      s.yc + (s.yb - s.yc) * Math.pow(Math.sin(a), 2 / s.nl),
    ]);
  }
  return pts; // KU+KL+1 points, right side only
}

// Full ring (array of [x,y]) from a half-section: mirror left side.
function fullRing(half) {
  const ring = half.slice();
  for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1]]);
  return ring;
}

// Loft rings (arrays of [x,y,z], equal length, closed) into flat-shaded tris.
function loft(rings, capStart, capEnd) {
  const pos = [];
  const P = rings[0].length;
  const push = (p) => { pos.push(p[0], p[1], p[2]); };
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < P; j++) {
      const k = (j + 1) % P;
      // outward winding for rings ordered top->starboard->bottom->port
      push(A[j]); push(B[j]); push(B[k]);
      push(A[j]); push(B[k]); push(A[k]);
    }
  }
  const cap = (ring, front) => {
    let cx = 0, cy = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const c = [cx / ring.length, cy / ring.length, cz / ring.length];
    for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      if (front) { push(c); push(ring[j]); push(ring[k]); }
      else { push(c); push(ring[k]); push(ring[j]); }
    }
  };
  if (capStart) cap(rings[0], true);
  if (capEnd) cap(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Centripetal-ish Catmull-Rom over a station table column.
function crom(rows, col, z) {
  let i = 0;
  while (i < rows.length - 2 && z > rows[i + 1].z) i++;
  const p0 = rows[Math.max(0, i - 1)], p1 = rows[i],
        p2 = rows[Math.min(rows.length - 1, i + 1)],
        p3 = rows[Math.min(rows.length - 1, i + 2)];
  const t = p2.z === p1.z ? 0 : (z - p1.z) / (p2.z - p1.z);
  const a = p0[col], b = p1[col], c = p2[col], d = p3[col];
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t +
                (-a + 3 * b - 3 * c + d) * t * t * t);
}

// Flat slab from a planform outline (points [[x,z],...] walked CCW seen from
// +Y). tFor(pt) -> half-thickness at that outline point. Top+bottom+rim.
function slab(outline, tFor) {
  const v2 = outline.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos = [];
  const push = (p, y) => { pos.push(p[0], y, p[1]); };
  for (const tr of tris) {           // top face (+y), CCW from above
    push(outline[tr[0]], tFor(outline[tr[0]]));
    push(outline[tr[2]], tFor(outline[tr[2]]));
    push(outline[tr[1]], tFor(outline[tr[1]]));
  }
  for (const tr of tris) {           // bottom face
    push(outline[tr[0]], -tFor(outline[tr[0]]));
    push(outline[tr[1]], -tFor(outline[tr[1]]));
    push(outline[tr[2]], -tFor(outline[tr[2]]));
  }
  for (let j = 0; j < outline.length; j++) {   // rim
    const k = (j + 1) % outline.length;
    const a = outline[j], b = outline[k];
    const ta = tFor(a), tb = tFor(b);
    push(a, ta); push(a, -ta); push(b, -tb);
    push(a, ta); push(b, -tb); push(b, tb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Mirror a geometry across the YZ plane (x -> -x) with corrected winding.
function mirrorGeom(geom) {
  const g = geom.clone();
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i += 3) {  // swap v1,v2 of each tri + negate x
    for (const off of [0, 1, 2]) p.setX(i + off, -p.getX(i + off));
    const x1 = p.getX(i + 1), y1 = p.getY(i + 1), z1 = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x1, y1, z1);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------- fuselage
// Station table nose->tail. Narrow chined diamond forebody; the chine edge
// then flares outboard along a straight ~35-deg plan diagonal (the LERX /
// intake-lip line, z -3.6 -> -2.4) to full width, and the mid-body runs
// nearly straight-sided (w ~2.25, boxy exponents = broad flat lifting body)
// before boat-tailing into the nozzles. The top-view silhouette lives
// entirely in this loft; the intake wedges tuck just under the chine.
const FUS = [
  { z: -9.46, w: 0.02, yt: 0.14, yb: 0.10, yc: 0.12, nu: 1.8, nl: 1.8 },
  { z: -8.60, w: 0.28, yt: 0.28, yb: -0.06, yc: 0.11, nu: 1.8, nl: 1.8 },
  { z: -7.60, w: 0.60, yt: 0.40, yb: -0.28, yc: 0.09, nu: 1.7, nl: 1.9 },
  { z: -6.80, w: 0.84, yt: 0.48, yb: -0.44, yc: 0.08, nu: 1.8, nl: 2.0 },
  { z: -5.60, w: 1.06, yt: 0.58, yb: -0.58, yc: 0.10, nu: 2.0, nl: 2.2 },
  { z: -4.40, w: 1.24, yt: 0.64, yb: -0.70, yc: 0.11, nu: 2.3, nl: 2.4 },
  { z: -4.00, w: 1.31, yt: 0.66, yb: -0.75, yc: 0.11, nu: 2.4, nl: 2.5 },
  { z: -3.60, w: 1.36, yt: 0.68, yb: -0.80, yc: 0.10, nu: 2.6, nl: 2.6 },
  { z: -3.20, w: 1.48, yt: 0.71, yb: -0.83, yc: 0.09, nu: 2.9, nl: 2.8 },
  { z: -2.80, w: 1.70, yt: 0.77, yb: -0.89, yc: 0.09, nu: 3.6, nl: 3.1 },
  { z: -2.40, w: 1.98, yt: 0.80, yb: -0.92, yc: 0.09, nu: 4.2, nl: 3.4 },
  { z: -2.00, w: 2.20, yt: 0.82, yb: -0.94, yc: 0.10, nu: 4.6, nl: 3.5 },
  { z: -1.60, w: 2.25, yt: 0.84, yb: -0.95, yc: 0.12, nu: 5.0, nl: 3.6 },
  { z: -0.80, w: 2.25, yt: 0.86, yb: -0.96, yc: 0.11, nu: 5.4, nl: 3.7 },
  { z:  0.00, w: 2.25, yt: 0.88, yb: -0.97, yc: 0.10, nu: 5.6, nl: 3.8 },
  { z:  1.60, w: 2.24, yt: 0.87, yb: -0.97, yc: 0.08, nu: 5.6, nl: 3.8 },
  { z:  3.20, w: 2.22, yt: 0.80, yb: -0.94, yc: 0.06, nu: 5.4, nl: 3.6 },
  { z:  4.80, w: 2.17, yt: 0.72, yb: -0.86, yc: 0.04, nu: 5.0, nl: 3.3 },
  { z:  6.40, w: 2.00, yt: 0.58, yb: -0.66, yc: 0.02, nu: 4.0, nl: 2.8 },
  { z:  7.60, w: 1.74, yt: 0.46, yb: -0.42, yc: 0.00, nu: 3.2, nl: 2.3 },
  { z:  8.20, w: 1.60, yt: 0.40, yb: -0.30, yc: 0.00, nu: 2.8, nl: 2.1 },
  { z:  8.60, w: 1.50, yt: 0.42, yb: -0.30, yc: 0.00, nu: 2.6, nl: 2.0 },
];

function fuselageGeometry() {
  const KU = 9, KL = 9, N = 96;
  const z0 = FUS[0].z, z1 = FUS[FUS.length - 1].z;
  const rings = [];
  for (let i = 0; i <= N; i++) {
    // densify toward the nose (curvature lives there)
    const u = i / N;
    const z = z0 + (z1 - z0) * (u * u * 0.35 + u * 0.65);
    const s = {
      w: crom(FUS, "w", z), yt: crom(FUS, "yt", z), yb: crom(FUS, "yb", z),
      yc: crom(FUS, "yc", z), nu: crom(FUS, "nu", z), nl: crom(FUS, "nl", z),
    };
    s.nu = Math.max(1.4, s.nu); s.nl = Math.max(1.4, s.nl);
    s.w = Math.max(0.02, s.w);
    rings.push(fullRing(halfSection(s, KU, KL)).map((p) => [p[0], p[1], z]));
  }
  return loft(rings, true, true);
}

// ------------------------------------------------------------- canopy
// Bubble canopy, well forward. Separate mesh under a rear-hinge pivot.
const CAN = [
  { z: -6.95, w: 0.07, yt: 0.52, yb: 0.40, yc: 0.46, nu: 2.1, nl: 3.0 },
  { z: -6.30, w: 0.46, yt: 0.90, yb: 0.36, yc: 0.56, nu: 2.2, nl: 3.0 },
  { z: -5.60, w: 0.60, yt: 1.24, yb: 0.32, yc: 0.62, nu: 2.2, nl: 3.0 },
  { z: -4.90, w: 0.62, yt: 1.32, yb: 0.30, yc: 0.62, nu: 2.2, nl: 3.0 },
  { z: -4.30, w: 0.56, yt: 1.16, yb: 0.32, yc: 0.58, nu: 2.2, nl: 3.0 },
  { z: -3.72, w: 0.12, yt: 0.78, yb: 0.40, yc: 0.52, nu: 2.1, nl: 3.0 },
];

function canopyGeometry() {
  const rings = [];
  const z0 = CAN[0].z, z1 = CAN[CAN.length - 1].z, N = 26;
  for (let i = 0; i <= N; i++) {
    const z = z0 + (z1 - z0) * (i / N);
    const s = {
      w: Math.max(0.03, crom(CAN, "w", z)), yt: crom(CAN, "yt", z),
      yb: crom(CAN, "yb", z), yc: crom(CAN, "yc", z),
      nu: crom(CAN, "nu", z), nl: 3.0,
    };
    rings.push(fullRing(halfSection(s, 8, 4)).map((p) => [p[0], p[1], z]));
  }
  return loft(rings, true, true);
}

// Bake a fresnel-ish gold gradient into vertex colors: grazing surfaces
// (|normal.y| small = sills/rim) go hot gold, the crown stays deep amber.
// View-independent approximation — good enough with no env map.
function tintCanopy(geom) {
  const p = geom.getAttribute("position"), n = geom.getAttribute("normal");
  const col = new Float32Array(p.count * 3);
  const deep = [0.76, 0.54, 0.20], hot = [1.0, 0.88, 0.48];
  for (let i = 0; i < p.count; i++) {
    const f = Math.pow(1 - Math.min(1, Math.abs(n.getY(i))), 1.5);
    const t = Math.min(1, 0.35 + 0.65 * f);
    col[i * 3]     = deep[0] + (hot[0] - deep[0]) * t;
    col[i * 3 + 1] = deep[1] + (hot[1] - deep[1]) * t;
    col[i * 3 + 2] = deep[2] + (hot[2] - deep[2]) * t;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// ------------------------------------------------------------- wing (right)
// Trapezoid: LE sweep 42 deg, TE forward sweep ~17 deg, clipped tip.
// Root rides the nacelle shoulder at x=1.95; tip at x=6.78 (13.56 m span).
// Geometry is built in WING-LOCAL coords (root LE x=0) under a group at
// (1.95, 0.30, 0) rolled -3 deg (slight anhedral).
const W_ROOT_X = 1.60;                          // buried root (body w ~2.16)
const W_SPAN = 6.78 - W_ROOT_X;                 // 5.18
const W_ROOT_LE = -1.25, W_TIP_LE = W_ROOT_LE + W_SPAN * Math.tan(42 * DEG);
const W_TIP_TE = W_TIP_LE + 1.60;               // tip chord
const W_ROOT_TE = W_TIP_TE + W_SPAN * Math.tan(17 * DEG);
const FLAP_D = 0.90;                            // flap chord along z
const FLAP_X1 = 3.90;                           // flap outboard end (local)
const wingTE = (x) => W_ROOT_TE - x * Math.tan(17 * DEG);

function wingOutline() {
  // CCW seen from above (+Y): LE root -> tip -> raked tip TE -> flap notch
  return [
    [0, W_ROOT_LE],
    [W_SPAN, W_TIP_LE],
    [W_SPAN - 0.24, W_TIP_TE],                  // clipped tip, slight rake
    [FLAP_X1, wingTE(FLAP_X1)],
    [FLAP_X1, wingTE(FLAP_X1) - FLAP_D],
    [0, wingTE(0) - FLAP_D],
  ];
}
const wingThick = (p) => 0.15 - 0.125 * (p[0] / W_SPAN); // root .15 -> tip .025

// Rotate planform points about origin in the XZ plane (for hinge-local frames).
function rotXZ(pts, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map((p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]);
}

// -------------------------------------------------------- stabilator (right)
// All-moving. Root tucks behind the wing TE on the tail boom (x=1.30);
// pivot = lateral X axis through z=7.55, y=0.15.
const ST_PIVOT = new THREE.Vector3(1.30, 0.15, 7.40);
function stabOutline() {                        // pivot-local (x out, z aft)
  const pts = [
    [1.30, 5.70], [4.30, 8.15], [4.30, 8.90], [1.30, 9.25],
  ].map((p) => [p[0] - ST_PIVOT.x, p[1] - ST_PIVOT.z]);
  return pts;
}
const stabThick = (p) => 0.06 - 0.038 * (p[0] / 3.0);

// -------------------------------------------------------- vertical tail
// Canted 28 deg outboard. Built flat (span along +X) then rolled +62 deg (R).
// Fin-local: x = up-along-fin, z = chord (aft +).
const FIN_SPAN = 2.95;
const FIN = {
  rootLE: 3.25, rootTE: 7.40, tipLE: 4.75, tipTE: 6.00,
  hingeRoot: 6.30, hingeTip: 5.55,             // rudder hinge line
};
function finOutline() {                         // fixed fin (fwd of hinge)
  return [
    [0, FIN.rootLE], [FIN_SPAN, FIN.tipLE],
    [FIN_SPAN, FIN.hingeTip], [0, FIN.hingeRoot],
  ];
}
function rudderOutlineLocal() {
  // hinge-local: origin at root hinge, local +x along hinge toward tip
  const ang = Math.atan2(FIN.hingeTip - FIN.hingeRoot, FIN_SPAN); // ~ -14 deg
  const pts = [
    [0, 0], [FIN_SPAN, FIN.hingeTip - FIN.hingeRoot],
    [FIN_SPAN, FIN.tipTE - FIN.hingeRoot], [0, FIN.rootTE - FIN.hingeRoot],
  ];
  return { pts: rotXZ(pts, -ang), ang };
}
const finThick = (p) => 0.055 - 0.035 * (p[0] / FIN_SPAN);

// -------------------------------------------------------- nozzles
// Twin rectangular 2D thrust-vectoring nozzles. Local +z aft, 0 at pivot.
function nozzleGeometry() {
  const secs = [
    { z: 0.00, w: 0.53, yt: 0.50, yb: -0.50, nu: 2.2 },
    { z: 0.55, w: 0.51, yt: 0.42, yb: -0.42, nu: 3.0 },
    { z: 1.00, w: 0.49, yt: 0.34, yb: -0.34, nu: 3.6 }, // throat
    { z: 1.36, w: 0.50, yt: 0.42, yb: -0.42, nu: 4.0 }, // divergent exit
  ];
  const rings = secs.map((s) =>
    fullRing(halfSection({ w: s.w, yt: s.yt, yb: s.yb, yc: 0, nu: s.nu, nl: s.nu }, 6, 6))
      .map((p) => [p[0], p[1], s.z]));
  return loft(rings, false, false);
}
function nozzleCapGeometry() {                  // dark cavity disc, recessed
  const s = { w: 0.44, yt: 0.34, yb: -0.34, yc: 0, nu: 3.4, nl: 3.4 };
  const ring = fullRing(halfSection(s, 6, 6)).map((p) => [p[0], p[1], 1.18]);
  return loft([ring, ring.map((p) => [p[0] * 0.02, p[1] * 0.02, 1.18])], false, true);
}

// -------------------------------------------------------- aft sting
// Centerline interfairing between/behind the nozzles ("beaver tail"):
// flattened wedge lofted from inside the boat-tail to a near-point aft
// of the nozzle exit plane.
const STING = [
  { z: 7.30, w: 0.58, yt: 0.34, yb: -0.34 },
  { z: 8.30, w: 0.46, yt: 0.27, yb: -0.26 },
  { z: 9.10, w: 0.30, yt: 0.17, yb: -0.14 },
  { z: 9.62, w: 0.05, yt: 0.05, yb: -0.01 },
];
function stingGeometry() {
  const rings = STING.map((s) =>
    fullRing(halfSection({ w: s.w, yt: s.yt, yb: s.yb, yc: (s.yt + s.yb) * 0.5,
                           nu: 2.6, nl: 2.4 }, 5, 5))
      .map((p) => [p[0], p[1], s.z]));
  return loft(rings, false, true);
}

// -------------------------------------------------------- intake (right)
// Swept caret wedge under the chine flare: the lip's top edge rides just
// beneath (and a hair proud of) the loft's LERX diagonal, so the plan
// silhouette stays one continuous line. Lip raked — inboard-top corner
// leads, outboard corners trail far aft along the diagonal. Crisp lip =
// thin skin rim band between the outer edge and the dark cavity. The
// diverter step is a dark splitter plate just inboard of the duct wall,
// in the gap off the forebody skin.
function quadRing(corners, n) {                 // corners [OT,OB,IB,IT] xyz
  const pts = [];
  for (let s = 0; s < 4; s++) {
    const a = corners[s], b = corners[(s + 1) % 4];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                a[2] + (b[2] - a[2]) * t]);
    }
  }
  return pts;
}
function shrinkRing(corners, k, dz) {           // toward centroid, pushed aft
  let cx = 0, cy = 0, cz = 0;
  for (const c of corners) { cx += c[0]; cy += c[1]; cz += c[2]; }
  cx /= 4; cy /= 4; cz /= 4;
  return corners.map((c) => [cx + (c[0] - cx) * k, cy + (c[1] - cy) * k,
                             cz + (c[2] - cz) * k + dz]);
}
const INT_F = [                                 // front lip  [OT,OB,IB,IT]
  [2.16, -0.02, -2.75], [2.12, -0.95, -2.55], [1.44, -0.88, -3.45], [1.36, 0.09, -3.75],
];
const INT_B = [                                 // back ring (sinks into loft)
  [2.20,  0.06, -1.95], [2.14, -0.92, -1.95], [1.50, -0.86, -1.95], [1.86, 0.14, -1.95],
];
function intakeGeometry() {
  const N = 4;
  const front = quadRing(INT_F, N);
  const back = quadRing(INT_B, N);
  const rim = quadRing(shrinkRing(INT_F, 0.97, 0.01), N);
  // shallow dark base right behind the lip plane — deep recess would let the
  // flaring loft skin poke through the aperture and wash it out
  const throat = quadRing(shrinkRing(INT_F, 0.85, 0.12), N);
  // NB ring order: lip band + duct must WIND toward -z (viewed from ahead,
  // looking into the opening) — [outer,inner] order winds aft and gets culled.
  return {
    body: loft([front, back], false, true),     // capped: rear sinks into loft
    lip: loft([rim, front], false, false),      // hairline bright lip edge
    cap: loft([throat, rim], true, false),      // dark duct aperture + base
  };
}

// -------------------------------------------------------- placeholder bits
function gearLeg(mats, strutLen, wheelR, wheelW) {
  // Pivot group at the retraction hinge; strut hangs -Y, wheel at the foot.
  const g = new THREE.Group();
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, strutLen, 12), mats.gear);
  strut.position.y = -strutLen / 2;
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 18), mats.tire);
  wheel.rotation.z = Math.PI / 2;
  wheel.position.y = -strutLen;
  g.add(strut, wheel);
  return g;
}

function doorSlab(mats, w, h, d) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.skin);
}

// ================================================================ buildF22
export function buildF22() {
  const mats = makeMaterials();
  const group = new THREE.Group();
  group.name = "f22";
  const parts = {};
  const add = (mesh, name) => { mesh.name = name; group.add(mesh); return mesh; };

  // ---- fuselage + aft sting + canopy
  add(new THREE.Mesh(fuselageGeometry(), mats.skin), "fuselage");
  add(new THREE.Mesh(stingGeometry(), mats.skin), "sting");

  // canopy: pivot at REAR sill (hinge axis = X). rotation.x < 0 lifts the
  // front edge (opens). Bubble is well forward: z -6.95 .. -3.72.
  const canPivot = new THREE.Group();
  canPivot.position.set(0, 0.5, -3.72);
  const canGeom = canopyGeometry();
  tintCanopy(canGeom);
  canGeom.translate(0, -0.5, 3.72);             // into pivot-local space
  canPivot.add(new THREE.Mesh(canGeom, mats.canopy));
  add(canPivot, "canopy");
  parts.canopy = canPivot;

  // ---- wings (slight anhedral -3 deg via roll at the root)
  const wingGeomR = slab(wingOutline(), wingThick);
  const wingR = new THREE.Group();
  wingR.position.set(W_ROOT_X, 0.42, 0);
  wingR.rotation.z = 3 * DEG;                  // +roll drops the +X tip
  wingR.add(new THREE.Mesh(wingGeomR, mats.skin));
  add(wingR, "wingR");
  const wingL = new THREE.Group();
  wingL.position.set(-W_ROOT_X, 0.42, 0);
  wingL.rotation.z = -3 * DEG;
  wingL.add(new THREE.Mesh(mirrorGeom(wingGeomR), mats.skin));
  add(wingL, "wingL");

  // flaperons: hinge line parallel to the TE (17 deg fwd sweep).
  // Pivot local +X runs OUTBOARD along the hinge; rotation.x > 0 = TE DOWN
  // on the right wing (mirrored group flips the visual sense on the left).
  const hz0 = wingTE(0) - FLAP_D, hz1 = wingTE(FLAP_X1) - FLAP_D;
  const hAng = Math.atan2(hz0 - hz1, FLAP_X1);  // sweep of hinge (+ fwd out)
  const flapPtsWing = [
    [0, hz0], [FLAP_X1, hz1],
    [FLAP_X1, wingTE(FLAP_X1)], [0, wingTE(0)],
  ].map((p) => [p[0], p[1] - hz0]);             // origin at root hinge
  const flapLocal = rotXZ(flapPtsWing, hAng);   // local +x along hinge
  const flapGeom = slab(flapLocal, () => 0.03);
  const mkFlap = () => {
    const pv = new THREE.Group();
    pv.position.set(0, 0, hz0);                 // in wing-local space
    pv.rotation.y = hAng;
    pv.add(new THREE.Mesh(flapGeom, mats.skin));
    return pv;
  };
  parts.flaperonR = mkFlap(); wingR.add(parts.flaperonR);
  parts.flaperonL = mkFlap(); wingL.add(parts.flaperonL);
  parts.flaperonR.name = "flaperonR"; parts.flaperonL.name = "flaperonL";

  // ---- stabilators (all-moving; hinge axis = X, lateral).
  // rotation.x > 0 pitches the TE UP (aircraft nose-down command).
  const stabGeom = slab(stabOutline(), stabThick);
  const stabR = new THREE.Group();
  stabR.position.copy(ST_PIVOT);
  stabR.add(new THREE.Mesh(stabGeom, mats.skin));
  add(stabR, "stabR"); parts.stabR = stabR;
  const stabL = new THREE.Group();
  stabL.position.set(-ST_PIVOT.x, ST_PIVOT.y, ST_PIVOT.z);
  stabL.add(new THREE.Mesh(mirrorGeom(stabGeom), mats.skin));
  add(stabL, "stabL"); parts.stabL = stabL;

  // ---- twin verticals, canted 28 deg outboard. Fin built span-along-+X
  // then rolled: right fin rotation.z = +62 deg (90-28), left mirrored.
  const finGeom = slab(finOutline(), finThick);
  const { pts: rudPts, ang: rudAng } = rudderOutlineLocal();
  const rudGeom = slab(rudPts, () => 0.028);
  const mkTail = (sideSign) => {
    const fin = new THREE.Group();
    fin.position.set(1.60 * sideSign, 0.42, 0);
    // span built along +X; roll it up-and-outboard: R = 62 deg, L = 118 deg
    fin.rotation.z = sideSign > 0 ? 62 * DEG : 118 * DEG;
    fin.add(new THREE.Mesh(finGeom, mats.skin));
    // rudder pivot: origin at ROOT hinge point, local +X along hinge toward
    // the tip. rotation.x deflects the rudder (TE swings laterally).
    const rud = new THREE.Group();
    rud.position.set(0, 0, FIN.hingeRoot);
    rud.rotation.y = rudAng;
    rud.add(new THREE.Mesh(rudGeom, mats.skin));
    fin.add(rud);
    return { fin, rud };
  };
  const tR = mkTail(1), tL = mkTail(-1);
  add(tR.fin, "finR"); add(tL.fin, "finL");
  parts.rudderR = tR.rud; parts.rudderL = tL.rud;
  parts.rudderR.name = "rudderR"; parts.rudderL.name = "rudderL";

  // ---- nozzles: pivot at (x, 0, 8.10); hinge axis = X (2D pitch vectoring).
  // rotation.x < 0 deflects exhaust DOWN.
  const nozGeom = nozzleGeometry();
  const nozCap = nozzleCapGeometry();
  const mkNozzle = (x) => {
    const pv = new THREE.Group();
    pv.position.set(x, 0, 8.10);
    pv.add(new THREE.Mesh(nozGeom, mats.dark));
    pv.add(new THREE.Mesh(nozCap, mats.inlet));
    return pv;
  };
  parts.nozzleR = mkNozzle(0.75); add(parts.nozzleR, "nozzleR");
  parts.nozzleL = mkNozzle(-0.75); add(parts.nozzleL, "nozzleL");

  // ---- intakes: caret wedge + crisp lip band + dark cavity + diverter
  // splitter plate (dark, just inboard of the duct wall).
  const intk = intakeGeometry();
  add(new THREE.Mesh(intk.body, mats.skin), "intakeR");
  add(new THREE.Mesh(intk.lip, mats.skin), "intakeLipR");
  add(new THREE.Mesh(intk.cap, mats.inlet), "intakeCapR");
  add(new THREE.Mesh(mirrorGeom(intk.body), mats.skin), "intakeL");
  add(new THREE.Mesh(mirrorGeom(intk.lip), mats.skin), "intakeLipL");
  add(new THREE.Mesh(mirrorGeom(intk.cap), mats.inlet), "intakeCapL");
  const mkDiverter = (sideSign) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.5), mats.inlet);
    m.position.set(1.33 * sideSign, -0.35, -3.05);
    m.rotation.z = -0.10 * sideSign;            // lean matches the duct wall
    m.rotation.y = 0.14 * sideSign;             // splay follows the wall aft
    return m;
  };
  add(mkDiverter(1), "diverterR");
  add(mkDiverter(-1), "diverterL");

  // ---- weapons bays (placeholder doors at true hinge lines)
  // bayMain: ventral centerline bay. Hinge along -Z-axis line at the LEFT
  // door edge (x=-0.62, y=-0.97). rotation.z < 0 swings the door down/open.
  parts.bayMain = new THREE.Group();
  parts.bayMain.position.set(-0.62, -0.99, 0.55);
  const mainDoor = doorSlab(mats, 1.24, 0.03, 3.5);
  mainDoor.position.x = 0.62;
  parts.bayMain.add(mainDoor);
  add(parts.bayMain, "bayMain");

  // baySideR/L: cheek AIM-9 bays under the intakes. Hinge along the TOP
  // edge (axis = Z). rotation.z > 0 (R) / < 0 (L) swings the door outboard.
  const mkSideBay = (sideSign) => {
    const pv = new THREE.Group();
    pv.position.set(2.19 * sideSign, -0.10, 0.45);   // flush on the wider body
    const door = doorSlab(mats, 0.04, 0.72, 1.9);
    door.position.y = -0.36;
    pv.add(door);
    return pv;
  };
  parts.baySideR = mkSideBay(1); add(parts.baySideR, "baySideR");
  parts.baySideL = mkSideBay(-1); add(parts.baySideL, "baySideL");

  // ---- landing gear (placeholders; shown extended).
  // All three retract FORWARD: hinge axis = X at the bay ceiling;
  // rotation.x -> -90 deg folds the leg forward into the bay.
  parts.gearNose = gearLeg(mats, 1.35, 0.17, 0.12);
  parts.gearNose.position.set(0, -0.5, -5.3);
  add(parts.gearNose, "gearNose");
  parts.gearR = gearLeg(mats, 1.0, 0.26, 0.20);
  parts.gearR.position.set(1.85, -0.9, 1.9);
  add(parts.gearR, "gearR");
  parts.gearL = gearLeg(mats, 1.0, 0.26, 0.20);
  parts.gearL.position.set(-1.85, -0.9, 1.9);
  add(parts.gearL, "gearL");

  return { group, parts };
}

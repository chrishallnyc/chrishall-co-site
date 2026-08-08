// F-22 Raptor v3 — high-fidelity procedural lofted model.
//
// Same contract as f22.js (v2): buildF22() -> { group, parts }
//   parts = { flaperonL/R, stabL/R, rudderL/R, nozzleL/R, canopy,
//             bayMain, baySideL/R, gearNose, gearL/R }
//   forward = -Z (nose z=-9.46, nozzle exits z=+9.46), +X starboard, +Y up.
//   Length 18.92 m, span 13.56 m. Nozzle pivots are DIRECT children of the
//   "f22" group at (±0.75, 0, 8.10) with the exit at pivot-local z=1.36
//   (flightfx.js nests the AB plume there and reads parts.nozzleL.parent).
//
// v3 over v2:
//   - indexed smooth-shaded lofts with a duplicated-vertex CREASE at the
//     chine (v2 was non-indexed flat-shaded => razor-flat faceted sides)
//   - 24-station fuselage: drooped radome, chined diamond forebody, canopy
//     sill cheeks, dorsal spine fairing behind the canopy, wide flat
//     lifting mid-body, boat-tail + tail booms for the stab/fin mounts
//   - smooth bubble canopy (gold MeshPhysicalMaterial + baked fresnel
//     vertex tint) with a separate sill frame band
//   - wings/stabs/fins lofted with real airfoil thickness profiles
//     (rounded LE, sharp TE, blunt flap-notch walls) instead of slabs
//   - caret intakes with raked lips and a deep dark duct
//   - 2D TVC nozzles: near-rectangular convergent/divergent shell with a
//     horizontal paddle seam crease, external paddle plates, dark interior
//   - procedural PBR paint via vertex colors (no textures, no UVs):
//     Have-Glass gray-blue base with subtly darker RAM radome / chine +
//     leading-edge tape / dorsal spine, 4-8% panel-line rows at the loft
//     stations, belly counter-shade, straw->blue->scorched heat tint on
//     the TVC petals, toned canopy sill frame

import * as THREE from "three";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- materials
function makeMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({
      // Have-Glass gray-blue RAM overcoat: painted absorber, NOT bare metal.
      // Tone zones (radome, LEs, spine, panel rows) ride in vertex colors.
      // (#5c646e family, lifted a half-step: metalness eats diffuse energy
      // in the env-map-less lab and the jet went near-black on the side)
      color: 0x666e78, roughness: 0.55, metalness: 0.35, vertexColors: true,
    }),
    canopy: new THREE.MeshPhysicalMaterial({
      // gold via baked fresnel-ish vertex gradient + faint emissive (reads
      // gold with no env map); physical so a future env map lights it right.
      color: 0xffffff, vertexColors: true, roughness: 0.1, metalness: 0.45,
      clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.2,
      emissive: 0x6f4d12, emissiveIntensity: 0.38,
      transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    }),
    dark: new THREE.MeshStandardMaterial({      // nozzle / exhaust metal
      // heat-tint gradient (straw->blue->scorched) rides in vertex colors
      color: 0x585d65, roughness: 0.35, metalness: 0.8, vertexColors: true,
    }),
    inlet: new THREE.MeshStandardMaterial({     // duct/exhaust cavity
      color: 0x0b0c0e, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide,
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
  g.computeVertexNormals();
  return g;
}

// Catmull-Rom over a station table column (clamped ends).
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
    const tc = ((st.cut ?? st.zTE) - st.zLE) / c;
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
const foil = (t) => 2.439 * Math.sqrt(Math.max(0, t)) * Math.pow(1 - t, 0.85);
// control surface: blunt LE (hinge face), linear wedge to a sharp TE
const wedge = (t) => Math.min(1, t / 0.1) * (1 - t) / 0.9;

// ------------------------------------------------------------- vertex color
// All airframe tints are LINEAR-space multipliers over mats.skin's base coat
// (vertex colors multiply material.color). 1.0 = base Have-Glass; RAM zones
// (radome, leading edges, dorsal spine) sit subtly darker; panel lines are
// 4-8% perceptual dips at the natural loft stations.
const RAM_LE   = [0.68, 0.69, 0.73];  // leading-edge RAM tape (keeps blue lean)
const RAM_NOSE = [0.78, 0.76, 0.72];  // radome coating (drier, warmer gray)
const SPINE    = [0.80, 0.81, 0.85];  // dorsal RAM panels behind the canopy
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothT = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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

// panel-line dip: 1.0 -> (1-depth) triangular falloff around each band.
// hw must exceed the local loft ring spacing or a band can miss every row.
function panelDip(v, bands, depth, hw) {
  let k = 0;
  for (const b of bands) {
    const d = Math.abs(v - b);
    if (d < hw) k = Math.max(k, 1 - d / hw);
  }
  return 1 - depth * k;
}

// fuselage/boom/sting bake: radome RAM cap, chine RAM band on the forebody,
// dorsal spine panels, belly counter-shade, panel-line dips at the natural
// stations (radome joint, canopy sill, intake join, wing root, booms), and
// the aft heat scorch around the engine bay.
const PANEL_BANDS = [-7.55, -6.55, -2.95, -1.70, 0.9, 2.35, 3.5, 5.0, 6.05];
function bakeFuselageColors(geom) {
  const p = geom.getAttribute("position"), nr = geom.getAttribute("normal");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nr.getY(i);
    let c = [1, 1, 1];
    // radome: subtly darker/drier coating with a crisp joint at z~-7.5
    c = mix3(c, RAM_NOSE, 1 - smoothT(-7.65, -7.35, z));
    // chine RAM band on the forebody (crease sits at (w(z), yc(z)))
    if (z > -9.2 && z < -2.4) {
      const d = Math.hypot(Math.abs(x) - crom(FUS, "w", z), y - crom(FUS, "yc", z));
      c = mix3(c, RAM_LE, 1 - smoothT(0.05, 0.22, d));
    }
    // dorsal spine panels behind the canopy
    const sp = smoothT(-3.15, -2.55, z) * (1 - smoothT(2.2, 3.4, z)) *
               smoothT(0.5, 0.85, ny);
    c = mix3(c, SPINE, sp);
    // belly counter-shade: undersides a touch lighter (kills the flat read)
    let v = 1 + 0.05 * smoothT(0.25, 0.75, -ny);
    v *= panelDip(z, PANEL_BANDS, 0.11, 0.09);
    if (z > 5.6) {                              // engine-bay heat scorch
      const f = Math.min(1, (z - 5.6) / 2.7);
      v *= 1 - f * (y < -0.1 ? 0.42 : 0.30);
    }
    col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// wing bake (wing-local: +x span, +z aft): LE RAM tape, root-join row where
// the wing emerges from the loft (model |x|=2.26 -> wing-local ~0.66), one
// mid-span panel row. Mirrors survive mirrorGeom (colors ride the vertices).
function bakeWingColors(geom) {
  const p = geom.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = clamp01(p.getX(i) / W_SPAN) * W_SPAN, z = p.getZ(i);
    const c = mix3([1, 1, 1], RAM_LE, 1 - smoothT(0.20, 0.90, z - wingLE(x)));
    const v = panelDip(x, [0.70, 2.60], 0.10, 0.30);
    col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// stab bake (stab-local): LE RAM tape + root shadow row at the boom
function bakeStabColors(geom) {
  const p = geom.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = Math.max(0, p.getX(i)), z = p.getZ(i);
    const c = mix3([1, 1, 1], RAM_LE, 1 - smoothT(0.10, 0.60, z - stabLE(x)));
    const v = panelDip(x, [0.0], 0.10, 0.35);
    col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// fin bake (fin-local: x up-along-fin, z chord): LE RAM tape, slightly
// darker tip fairing, root shadow row at the boom shoulder
function bakeFinColors(geom) {
  const p = geom.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = Math.max(0, p.getX(i)), z = p.getZ(i);
    let c = mix3([1, 1, 1], RAM_LE, 1 - smoothT(0.10, 0.60, z - finLE(x)));
    c = mix3(c, [0.86, 0.87, 0.90], smoothT(FIN_SPAN - 0.45, FIN_SPAN - 0.1, x));
    const v = panelDip(x, [0.0], 0.10, 0.35);
    col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// F119 petal heat tint over mats.dark: gunmetal -> straw -> blue -> scorched
// dark toward the exit (nozzle-local z 0 -> 1.36).
const HEAT = [
  [0.00, [0.72, 0.73, 0.76]],                   // shrouded fwd shell: gunmetal
  [0.42, [0.90, 0.90, 0.92]],
  [0.62, [1.90, 1.35, 0.55]],                   // straw (tints the metal glint)
  [0.85, [0.55, 0.75, 1.55]],                   // blue
  [1.00, [0.30, 0.28, 0.33]],                   // scorched exit lip
];
function bakeNozzleHeat(geom) {
  const p = geom.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = clamp01(p.getZ(i) / 1.36);
    let j = 0;
    while (j < HEAT.length - 2 && t > HEAT[j + 1][0]) j++;
    const f = clamp01((t - HEAT[j][0]) / (HEAT[j + 1][0] - HEAT[j][0]));
    const c = mix3(HEAT[j][1], HEAT[j + 1][1], f);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// ------------------------------------------------------------- fuselage
// 24 stations nose->tail. Drooped radome tip; sharp chine (crease) rising
// from y=.02 at the tip to the wing-root shoulder ~.47; canopy-sill cheeks
// z -6..-3; dorsal spine fairing right behind the canopy; broad flat
// mid-body (w 2.26); boat-tail into the nozzle shelf.
const FUS = [
  { z: -9.46, w: 0.02, yt: 0.05, yb: -0.01, yc: 0.02, nu: 1.9, nl: 1.9 },
  { z: -8.90, w: 0.22, yt: 0.16, yb: -0.12, yc: 0.03, nu: 1.9, nl: 1.9 },
  { z: -8.20, w: 0.44, yt: 0.28, yb: -0.24, yc: 0.04, nu: 1.85, nl: 2.0 },
  { z: -7.40, w: 0.66, yt: 0.39, yb: -0.37, yc: 0.06, nu: 1.9, nl: 2.1 },
  { z: -6.60, w: 0.86, yt: 0.47, yb: -0.48, yc: 0.08, nu: 2.0, nl: 2.2 },
  { z: -5.90, w: 1.02, yt: 0.53, yb: -0.58, yc: 0.10, nu: 2.1, nl: 2.2 },
  { z: -5.20, w: 1.14, yt: 0.56, yb: -0.66, yc: 0.13, nu: 2.2, nl: 2.3 },
  { z: -4.60, w: 1.24, yt: 0.58, yb: -0.73, yc: 0.16, nu: 2.3, nl: 2.4 },
  { z: -4.00, w: 1.33, yt: 0.60, yb: -0.80, yc: 0.19, nu: 2.4, nl: 2.4 },
  { z: -3.55, w: 1.42, yt: 0.62, yb: -0.86, yc: 0.22, nu: 2.5, nl: 2.5 },
  { z: -3.10, w: 1.66, yt: 0.68, yb: -0.90, yc: 0.27, nu: 2.7, nl: 2.6 },
  { z: -2.60, w: 1.94, yt: 0.78, yb: -0.94, yc: 0.32, nu: 2.9, nl: 2.7 },
  { z: -2.10, w: 2.14, yt: 0.88, yb: -0.96, yc: 0.37, nu: 3.0, nl: 2.7 },
  { z: -1.60, w: 2.23, yt: 0.93, yb: -0.97, yc: 0.41, nu: 3.0, nl: 2.7 },
  { z: -0.80, w: 2.26, yt: 0.95, yb: -0.98, yc: 0.45, nu: 3.0, nl: 2.7 },
  { z:  0.00, w: 2.26, yt: 0.95, yb: -0.98, yc: 0.47, nu: 3.0, nl: 2.7 },
  { z:  1.20, w: 2.24, yt: 0.92, yb: -0.97, yc: 0.47, nu: 3.0, nl: 2.7 },
  { z:  2.40, w: 2.20, yt: 0.86, yb: -0.95, yc: 0.46, nu: 2.9, nl: 2.6 },
  { z:  3.60, w: 2.14, yt: 0.78, yb: -0.91, yc: 0.43, nu: 2.9, nl: 2.6 },
  { z:  4.80, w: 2.04, yt: 0.68, yb: -0.83, yc: 0.38, nu: 2.8, nl: 2.5 },
  { z:  6.00, w: 1.88, yt: 0.57, yb: -0.68, yc: 0.30, nu: 2.6, nl: 2.4 },
  { z:  7.00, w: 1.70, yt: 0.48, yb: -0.50, yc: 0.22, nu: 2.4, nl: 2.3 },
  { z:  7.80, w: 1.55, yt: 0.42, yb: -0.36, yc: 0.14, nu: 2.3, nl: 2.2 },
  { z:  8.60, w: 1.42, yt: 0.38, yb: -0.26, yc: 0.08, nu: 2.2, nl: 2.1 },
  { z:  9.00, w: 1.33, yt: 0.33, yb: -0.20, yc: 0.05, nu: 2.2, nl: 2.1 },
];

function fuselageGeometry() {
  const KU = 16, KL = 14, N = 210;
  const z0 = FUS[0].z, z1 = FUS[FUS.length - 1].z;
  const rings = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;                       // densify toward the nose
    const z = z0 + (z1 - z0) * (u * u * 0.35 + u * 0.65);
    const s = {
      w: crom(FUS, "w", z), yt: crom(FUS, "yt", z), yb: crom(FUS, "yb", z),
      yc: crom(FUS, "yc", z), nu: crom(FUS, "nu", z), nl: crom(FUS, "nl", z),
    };
    s.nu = Math.max(1.5, s.nu); s.nl = Math.max(1.5, s.nl);
    s.w = Math.max(0.02, s.w);
    rings.push(fullRing(halfSection(s, KU, KL)).map((p) => [p[0], p[1], z]));
  }
  return loft(rings, true, true);
}

// -------------------------------------------------------- tail booms
// Side pods flanking the nozzles: the stab pivots bury into them and the
// fins ride their inboard shoulder — gives the F-22 aft shelf silhouette.
const BOOM = [
  { z: 5.30, w: 0.30, yt: 0.28, yb: -0.18, yc: 0.06 },
  { z: 6.60, w: 0.40, yt: 0.32, yb: -0.24, yc: 0.05 },
  { z: 7.80, w: 0.38, yt: 0.26, yb: -0.19, yc: 0.04 },
  { z: 8.80, w: 0.28, yt: 0.16, yb: -0.11, yc: 0.02 },
  { z: 9.40, w: 0.06, yt: 0.04, yb: -0.02, yc: 0.01 },
];
function boomGeometry() {
  const rings = BOOM.map((s) =>
    fullRing(halfSection({ ...s, nu: 2.5, nl: 2.5 }, 7, 6))
      .map((p) => [p[0] + 1.72, p[1] + 0.06, s.z]));
  return loft(rings, false, true);
}

// -------------------------------------------------------- aft sting
// Centerline interfairing between/behind the nozzles ("beaver tail").
const STING = [
  { z: 6.80, w: 0.62, yt: 0.38, yb: -0.34 },
  { z: 8.00, w: 0.50, yt: 0.28, yb: -0.24 },
  { z: 9.00, w: 0.34, yt: 0.16, yb: -0.12 },
  { z: 9.62, w: 0.06, yt: 0.04, yb: -0.02 },
];
function stingGeometry() {
  const rings = STING.map((s) =>
    fullRing(halfSection({ w: s.w, yt: s.yt, yb: s.yb, yc: (s.yt + s.yb) * 0.5,
                           nu: 2.4, nl: 2.4 }, 6, 6))
      .map((p) => [p[0], p[1], s.z]));
  return loft(rings, false, true);
}

// ------------------------------------------------------------- canopy
// Smooth bubble, well forward (z -6.0..-2.95, peak y 1.24 at ~27% length).
// The rear rim fades into the rising dorsal spine of the fuselage loft.
const CAN = [
  { z: -6.00, w: 0.06, yt: 0.565, yb: 0.50 },
  { z: -5.60, w: 0.36, yt: 0.80, yb: 0.46 },
  { z: -5.10, w: 0.54, yt: 1.07, yb: 0.42 },
  { z: -4.60, w: 0.62, yt: 1.26, yb: 0.40 },
  { z: -4.15, w: 0.62, yt: 1.28, yb: 0.40 },
  { z: -3.70, w: 0.56, yt: 1.16, yb: 0.42 },
  { z: -3.30, w: 0.44, yt: 0.99, yb: 0.46 },
  { z: -2.95, w: 0.10, yt: 0.72, yb: 0.55 },
];
function canopyGeometry() {
  const rings = [];
  const z0 = CAN[0].z, z1 = CAN[CAN.length - 1].z, N = 44;
  for (let i = 0; i <= N; i++) {
    const z = z0 + (z1 - z0) * (i / N);
    const s = {
      w: Math.max(0.03, crom(CAN, "w", z)), yt: crom(CAN, "yt", z),
      yb: crom(CAN, "yb", z), nu: 2.05, nl: 2.6,
    };
    s.yc = s.yb + (s.yt - s.yb) * 0.28;
    rings.push(fullRing(halfSection(s, 13, 4, false)).map((p) => [p[0], p[1], z]));
  }
  return loft(rings, true, true);
}
function canopyFrameGeometry() {                // sill band under the glass
  const rings = [];
  const z0 = CAN[0].z + 0.02, z1 = CAN[CAN.length - 1].z - 0.02, N = 30;
  for (let i = 0; i <= N; i++) {
    const z = z0 + (z1 - z0) * (i / N);
    const yb = crom(CAN, "yb", z);
    const s = {
      w: Math.max(0.04, crom(CAN, "w", z) + 0.035),
      yt: yb + 0.10, yb: yb - 0.07, nu: 2.3, nl: 2.3,
    };
    s.yc = (s.yt + s.yb) * 0.5;
    rings.push(fullRing(halfSection(s, 6, 3, false)).map((p) => [p[0], p[1], z]));
  }
  return loft(rings, true, true);
}

// Bake a fresnel-ish gold gradient into vertex colors: grazing surfaces
// (|normal.y| small) go hot gold, the crown stays deep amber.
function tintCanopy(geom) {
  const p = geom.getAttribute("position"), n = geom.getAttribute("normal");
  const col = new Float32Array(p.count * 3);
  const deep = [0.72, 0.5, 0.18], hot = [1.0, 0.88, 0.48];
  for (let i = 0; i < p.count; i++) {
    const f = Math.pow(1 - Math.min(1, Math.abs(n.getY(i))), 1.5);
    const t = Math.min(1, 0.32 + 0.68 * f);
    col[i * 3]     = deep[0] + (hot[0] - deep[0]) * t;
    col[i * 3 + 1] = deep[1] + (hot[1] - deep[1]) * t;
    col[i * 3 + 2] = deep[2] + (hot[2] - deep[2]) * t;
  }
  geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// ------------------------------------------------------------- wing (right)
// Clipped delta: LE sweep 42 deg, TE forward sweep 17 deg, raked tip.
// Built in WING-LOCAL coords (root x=0 buried at model x=1.60, tip x=5.18
// => model 6.78 = 13.56 m span) under a group at (1.60, 0.50, 0).
const W_ROOT_X = 1.60, W_SPAN = 5.18;
const TAN42 = Math.tan(42 * DEG), TAN17 = Math.tan(17 * DEG);
const W_ROOT_LE = -1.25;
const W_ROOT_TE = W_ROOT_LE + W_SPAN * TAN42 + 1.60 + W_SPAN * TAN17; // 6.597
const wingLE = (x) => W_ROOT_LE + x * TAN42;
const wingTE = (x) => W_ROOT_TE - x * TAN17;
const FLAP_D = 0.90, FLAP_X1 = 3.90;
const W_TIP_RAKE_X = 4.94;                      // rake from here to the tip
const wingTEeff = (x) => {
  if (x <= W_TIP_RAKE_X) return wingTE(x);
  const t = (x - W_TIP_RAKE_X) / (W_SPAN - W_TIP_RAKE_X);
  return wingTE(W_TIP_RAKE_X) * (1 - t) + (wingLE(W_SPAN) + 0.85) * t;
};
const wingThick = (x) => 0.16 - 0.125 * Math.pow(x / W_SPAN, 0.9);

function wingGeometry() {
  const xs = [];
  for (let i = 0; i <= 20; i++) xs.push((i / 20) * W_SPAN);
  xs.push(FLAP_X1 - 0.02, FLAP_X1 + 0.02, W_TIP_RAKE_X);
  xs.sort((a, b) => a - b);
  const stations = xs.map((x) => ({
    x, zLE: wingLE(x), zTE: wingTEeff(x),
    cut: x <= FLAP_X1 ? wingTE(x) - FLAP_D : undefined,
    th: wingThick(x),
  }));
  return surfGeometry(stations, 18, foil);
}

// flaperon: hinge line = wing notch front edge (17 deg sweep). Geometry in
// hinge-local coords (+x outboard along the hinge); pivot rotation.y=-ang.
// rotation.x > 0 = TE down on the right wing (mirrored group flips it).
const FLAP_HZ0 = wingTE(0) - FLAP_D;            // hinge z at root, wing-local
const FLAP_ANG = Math.atan2((wingTE(FLAP_X1) - FLAP_D) - FLAP_HZ0, FLAP_X1);
function flapGeometry() {
  const L = Math.hypot(FLAP_X1, (wingTE(FLAP_X1) - FLAP_D) - FLAP_HZ0);
  const [teR, teT] = rotXZ([
    [0, FLAP_D], [FLAP_X1, wingTE(FLAP_X1) - FLAP_HZ0],
  ].map((p) => [p[0], p[1]]), FLAP_ANG);
  const zTE = (x) => teR[1] + (teT[1] - teR[1]) * (x - teR[0]) / (teT[0] - teR[0]);
  const stations = [0, L * 0.5, L].map((x) => ({
    x, zLE: 0, zTE: zTE(x), th: 0.05 - 0.02 * (x / L),
  }));
  return surfGeometry(stations, 10, wedge);
}

// -------------------------------------------------------- stabilator (right)
// All-moving, on the tail boom. Pivot = lateral X axis at (1.72, 0.08, 7.40).
// rotation.x sense identical to v2 (geometry z-aft in pivot-local coords).
const ST_PIVOT = new THREE.Vector3(1.72, 0.08, 7.40);
const stabLE = (x) => -1.80 + 0.92 * x;         // ~42.6 deg LE sweep
function stabGeometry() {
  const span = 2.95;
  const zTE = (x) => 1.95 - 0.102 * x;
  const stations = [];
  for (let i = 0; i <= 9; i++) {
    const x = (i / 9) * span;
    stations.push({ x, zLE: stabLE(x), zTE: zTE(x), th: 0.085 - 0.055 * (x / span) });
  }
  return surfGeometry(stations, 14, foil);
}

// -------------------------------------------------------- vertical tail
// Canted 28 deg outboard: built flat (span along +X), rolled +62 deg (R).
// Fin-local: x = up-along-fin, z = chord (aft +). Rudder on the TE.
const FIN_SPAN = 3.20;
const FIN = { rootLE: 2.55, rootTE: 7.15, tipLE: 5.00, tipTE: 6.35,
              hingeRoot: 5.90, hingeTip: 5.70 };
const finLE = (x) => FIN.rootLE + x * (FIN.tipLE - FIN.rootLE) / FIN_SPAN;
const finTE = (x) => FIN.rootTE + x * (FIN.tipTE - FIN.rootTE) / FIN_SPAN;
const finHinge = (x) => FIN.hingeRoot + x * (FIN.hingeTip - FIN.hingeRoot) / FIN_SPAN;
const finThick = (x) => 0.11 - 0.065 * (x / FIN_SPAN);

function finGeometry() {                        // fixed fin, blunt at hinge
  const stations = [];
  for (let i = 0; i <= 9; i++) {
    const x = (i / 9) * FIN_SPAN;
    stations.push({ x, zLE: finLE(x), zTE: finTE(x), cut: finHinge(x),
                    th: finThick(x) });
  }
  return surfGeometry(stations, 14, foil);
}
const RUD_ANG = Math.atan2(FIN.hingeTip - FIN.hingeRoot, FIN_SPAN);
function rudderGeometry() {
  const L = Math.hypot(FIN_SPAN, FIN.hingeTip - FIN.hingeRoot);
  const [teR, teT] = rotXZ([
    [0, FIN.rootTE - FIN.hingeRoot],
    [FIN_SPAN, FIN.tipTE - FIN.hingeRoot],
  ], RUD_ANG);
  const zTE = (x) => teR[1] + (teT[1] - teR[1]) * (x - teR[0]) / (teT[0] - teR[0]);
  const stations = [0, L * 0.5, L].map((x) => ({
    x, zLE: 0, zTE: zTE(x), th: 0.05 - 0.028 * (x / L),
  }));
  return surfGeometry(stations, 10, wedge);
}

// -------------------------------------------------------- nozzles
// Twin 2D TVC nozzles: near-rectangular convergent/divergent shell (the
// chine crease doubles as the paddle/side-plate seam), external paddle
// plates, dark recessed interior. Local +z aft, exit at z=1.36 (flightfx).
const NOZ = [
  { z: 0.00, w: 0.580, yt: 0.40, n: 2.4 },
  { z: 0.30, w: 0.565, yt: 0.38, n: 3.0 },
  { z: 0.62, w: 0.545, yt: 0.34, n: 3.8 },
  { z: 0.95, w: 0.525, yt: 0.28, n: 4.8 },      // throat
  { z: 1.36, w: 0.545, yt: 0.37, n: 6.0 },      // divergent exit
];
function nozzleGeometry() {
  const rings = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const z = (i / N) * 1.36;
    const w = crom(NOZ, "w", z), yt = crom(NOZ, "yt", z),
          n = Math.max(2, crom(NOZ, "n", z));
    rings.push(fullRing(halfSection({ w, yt, yb: -yt, yc: 0, nu: n, nl: n }, 9, 9))
      .map((p) => [p[0], p[1], z]));
  }
  return loft(rings, false, false);
}
function nozzleInteriorGeometry() {             // dark cavity + deep cap
  const ring = (k, z) =>
    fullRing(halfSection({ w: 0.545 * k, yt: 0.37 * k, yb: -0.37 * k, yc: 0,
                           nu: 5.5, nl: 5.5 }, 8, 8))
      .map((p) => [p[0], p[1], z]);
  return loft([ring(0.93, 1.355), ring(0.6, 1.02)], false, true);
}
function paddlePlate(top) {                     // external divergent flap
  const g = new THREE.BoxGeometry(0.82, 0.045, 0.5);
  const m = new THREE.Matrix4();
  const tilt = Math.atan2(0.37 - 0.28, 0.41) * (top ? -1 : 1);
  m.makeRotationX(tilt);
  g.applyMatrix4(m);
  g.translate(0, top ? 0.345 : -0.345, 1.14);
  return g;
}

// -------------------------------------------------------- intake (right)
// Caret inlet under the chine flare: raked parallelogram lip (inboard-top
// corner leads), crisp lip band, deep dark duct, diverter splitter plate.
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
function shrinkQuad(corners, k, dz) {           // toward centroid, pushed aft
  let cx = 0, cy = 0, cz = 0;
  for (const c of corners) { cx += c[0]; cy += c[1]; cz += c[2]; }
  cx /= 4; cy /= 4; cz /= 4;
  return corners.map((c) => [cx + (c[0] - cx) * k, cy + (c[1] - cy) * k,
                             cz + (c[2] - cz) * k + dz]);
}
const INT_F = [                                 // front lip [OT,OB,IB,IT]
  // parallelogram sheared inboard toward the bottom (caret lean)
  [2.24, 0.06, -2.70], [1.96, -0.92, -2.42], [1.26, -0.84, -3.10], [1.32, 0.22, -3.72],
];
const INT_B = [                                 // back ring (sinks into loft)
  [2.26, 0.12, -1.70], [2.04, -0.94, -1.70], [1.44, -0.86, -1.70], [1.86, 0.30, -1.70],
];
function intakeGeometry() {
  const N = 6;
  const front = quadRing(INT_F, N);
  const back = quadRing(INT_B, N);
  const rim = quadRing(shrinkQuad(INT_F, 0.965, 0.015), N);
  const d1 = quadRing(shrinkQuad(INT_F, 0.90, 0.12), N);
  const d2 = quadRing(shrinkQuad(INT_F, 0.74, 0.55), N);
  const d3 = quadRing(shrinkQuad(INT_F, 0.52, 1.05), N);
  return {
    body: loft([front, back], false, true),     // outer wedge, sinks into loft
    lip: loft([rim, front], false, false),      // hairline bright lip edge
    duct: loft([d3, d2, d1, rim], true, false), // deep dark duct + throat cap
  };
}

// -------------------------------------------------------- placeholder bits
function gearLeg(mats, strutLen, wheelR, wheelW) {
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
  const g = new THREE.BoxGeometry(w, h, d);
  // RAM-family tint: the side-bay door corner clips out of the lower hull
  // bevel (pre-existing), and a base-coat slab there read as a white beacon
  // against the dark belly — toned down it reads as an access panel.
  tintColors(g, [0.55, 0.56, 0.60]);
  return new THREE.Mesh(g, mats.skin);
}

// ================================================================ buildF22
export function buildF22() {
  const mats = makeMaterials();
  const group = new THREE.Group();
  group.name = "f22";
  const parts = {};
  const add = (mesh, name) => { mesh.name = name; group.add(mesh); return mesh; };
  const skin = (geom, name, parent) => {
    if (!geom.getAttribute("color")) whiteColors(geom);
    const m = new THREE.Mesh(geom, mats.skin);
    m.name = name;
    (parent || group).add(m);
    return m;
  };

  // ---- fuselage + booms + aft sting
  const fusGeom = fuselageGeometry();
  bakeFuselageColors(fusGeom);
  skin(fusGeom, "fuselage");
  const boomGeom = boomGeometry();
  bakeFuselageColors(boomGeom);
  skin(boomGeom, "boomR");
  skin(mirrorGeom(boomGeom), "boomL");
  const stingGeom = stingGeometry();
  bakeFuselageColors(stingGeom);
  skin(stingGeom, "sting");

  // ---- canopy: pivot at REAR sill (hinge axis = X; rotation.x < 0 opens)
  const canPivot = new THREE.Group();
  canPivot.position.set(0, 0.55, -2.95);
  const canGeom = canopyGeometry();
  tintCanopy(canGeom);
  canGeom.translate(0, -0.55, 2.95);
  const glass = new THREE.Mesh(canGeom, mats.canopy);
  glass.name = "canopyGlass";
  canPivot.add(glass);
  const frameGeom = canopyFrameGeometry();
  frameGeom.translate(0, -0.55, 2.95);
  tintColors(frameGeom, [0.58, 0.59, 0.62]);   // dark sill frame, not gold
  skin(frameGeom, "canopyFrame", canPivot);
  add(canPivot, "canopy");
  parts.canopy = canPivot;

  // ---- wings (slight anhedral; rotation.z sense verified in the lab)
  const wingGeomR = wingGeometry();
  bakeWingColors(wingGeomR);
  const wingR = new THREE.Group();
  wingR.position.set(W_ROOT_X, 0.50, 0);
  wingR.rotation.z = -2 * DEG;                  // drops the +X tip
  skin(wingGeomR, "wingRmesh", wingR);
  add(wingR, "wingR");
  const wingL = new THREE.Group();
  wingL.position.set(-W_ROOT_X, 0.50, 0);
  wingL.rotation.z = 2 * DEG;
  skin(mirrorGeom(wingGeomR), "wingLmesh", wingL);
  add(wingL, "wingL");

  // flaperons: pivot local +X outboard along the hinge; rotation.x > 0 =
  // TE down on the right wing. The left flap is a mirrored geometry with a
  // mirrored hinge yaw (the wingL group itself is NOT mirrored).
  const flapGeom = flapGeometry();
  tintColors(flapGeom, [0.95, 0.95, 0.97]);    // control surface reads as its own panel
  const mkFlap = (mirrored) => {
    const pv = new THREE.Group();
    pv.position.set(0, 0, FLAP_HZ0);            // wing-local root hinge point
    pv.rotation.y = mirrored ? FLAP_ANG : -FLAP_ANG;
    skin(mirrored ? mirrorGeom(flapGeom) : flapGeom.clone(), "flapMesh", pv);
    return pv;
  };
  parts.flaperonR = mkFlap(false); wingR.add(parts.flaperonR);
  parts.flaperonL = mkFlap(true); wingL.add(parts.flaperonL);
  parts.flaperonR.name = "flaperonR"; parts.flaperonL.name = "flaperonL";

  // ---- stabilators (all-moving; hinge axis = X, lateral)
  const stabGeom = stabGeometry();
  bakeStabColors(stabGeom);
  const stabR = new THREE.Group();
  stabR.position.copy(ST_PIVOT);
  skin(stabGeom, "stabRmesh", stabR);
  add(stabR, "stabR"); parts.stabR = stabR;
  const stabL = new THREE.Group();
  stabL.position.set(-ST_PIVOT.x, ST_PIVOT.y, ST_PIVOT.z);
  skin(mirrorGeom(stabGeom), "stabLmesh", stabL);
  add(stabL, "stabL"); parts.stabL = stabL;

  // ---- twin verticals canted 28 deg outboard (roll 62/118 deg from flat)
  const finGeom = finGeometry();
  bakeFinColors(finGeom);
  const rudGeom = rudderGeometry();
  tintColors(rudGeom, [0.95, 0.95, 0.97]);
  // fin geometry is shared by both sides: the whole fin-local frame is
  // rolled (62 deg right / 118 deg left), so no geometry mirror (v2 scheme).
  const mkTail = (sideSign) => {
    const fin = new THREE.Group();
    fin.position.set(1.58 * sideSign, 0.30, 0);
    fin.rotation.z = sideSign > 0 ? 62 * DEG : 118 * DEG;
    skin(finGeom.clone(), "finMesh", fin);
    const rud = new THREE.Group();
    rud.position.set(0, 0, FIN.hingeRoot);
    rud.rotation.y = -RUD_ANG;
    skin(rudGeom.clone(), "rudMesh", rud);
    fin.add(rud);
    return { fin, rud };
  };
  const tR = mkTail(1), tL = mkTail(-1);
  add(tR.fin, "finR"); add(tL.fin, "finL");
  parts.rudderR = tR.rud; parts.rudderL = tL.rud;
  parts.rudderR.name = "rudderR"; parts.rudderL.name = "rudderL";

  // ---- nozzles: pivots at (±0.75, 0, 8.10), DIRECT children of the group;
  // hinge axis = X (2D pitch vectoring); exit plane at pivot-local z=1.36.
  const nozGeom = nozzleGeometry();
  bakeNozzleHeat(nozGeom);
  const nozInt = nozzleInteriorGeometry();
  const padT = paddlePlate(true), padB = paddlePlate(false);
  tintColors(padT, [0.52, 0.58, 0.80]);        // external paddles: blued heat
  tintColors(padB, [0.52, 0.58, 0.80]);
  const mkNozzle = (x) => {
    const pv = new THREE.Group();
    pv.position.set(x, 0, 8.10);
    pv.add(new THREE.Mesh(nozGeom, mats.dark));
    pv.add(new THREE.Mesh(nozInt, mats.inlet));
    pv.add(new THREE.Mesh(padT, mats.dark));
    pv.add(new THREE.Mesh(padB, mats.dark));
    return pv;
  };
  parts.nozzleR = mkNozzle(0.75); add(parts.nozzleR, "nozzleR");
  parts.nozzleL = mkNozzle(-0.75); add(parts.nozzleL, "nozzleL");

  // ---- intakes: caret wedge + lip band + deep dark duct + diverter plate
  const intk = intakeGeometry();
  tintColors(intk.body, [0.93, 0.94, 0.96]);   // wedge reads as its own panel
  tintColors(intk.lip, [0.70, 0.71, 0.74]);    // RAM-taped lip edge
  skin(intk.body, "intakeR");
  skin(intk.lip, "intakeLipR");
  add(new THREE.Mesh(intk.duct, mats.inlet), "intakeDuctR");
  skin(mirrorGeom(intk.body), "intakeL");
  skin(mirrorGeom(intk.lip), "intakeLipL");
  add(new THREE.Mesh(mirrorGeom(intk.duct), mats.inlet), "intakeDuctL");
  const mkDiverter = (sideSign) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.5), mats.inlet);
    m.position.set(1.30 * sideSign, -0.30, -2.75);
    m.rotation.z = -0.10 * sideSign;
    m.rotation.y = 0.14 * sideSign;
    return m;
  };
  add(mkDiverter(1), "diverterR");
  add(mkDiverter(-1), "diverterL");

  // ---- weapons bays (placeholder doors at true hinge lines; same
  // hinge conventions as v2)
  // keel dips to -0.964 at the door edge — park the closed door fully
  // inside the hull (it emerges when swung open on its -Z hinge line)
  parts.bayMain = new THREE.Group();
  parts.bayMain.position.set(-0.62, -0.90, 0.55);
  const mainDoor = doorSlab(mats, 1.24, 0.03, 3.5);
  mainDoor.position.x = 0.62;
  parts.bayMain.add(mainDoor);
  add(parts.bayMain, "bayMain");
  const mkSideBay = (sideSign) => {
    const pv = new THREE.Group();
    // buried inside the lower hull bevel (the loft tucks in fast below the
    // chine); the pivot sits at the hinge line and the door emerges when
    // swung outboard — closed, it stays hidden like the real flush panel.
    pv.position.set(1.70 * sideSign, -0.10, 0.45);
    pv.rotation.z = 0.35 * sideSign;                 // lean with the side
    const door = doorSlab(mats, 0.04, 0.72, 1.9);
    door.position.y = -0.36;
    pv.add(door);
    return pv;
  };
  parts.baySideR = mkSideBay(1); add(parts.baySideR, "baySideR");
  parts.baySideL = mkSideBay(-1); add(parts.baySideL, "baySideL");

  // ---- landing gear (placeholders, extended; retract forward like v2)
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

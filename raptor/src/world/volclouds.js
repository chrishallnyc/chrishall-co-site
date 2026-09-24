import { cloudCelestialLight, cloudCelestialSources } from "./night-cloud-lighting.js";
// Full-resolution volumetric clouds with adaptive extinction and distributed
// illumination. The CPU oracle and TSL builders share the density recipe;
// CloudPass reuses one integration for color, motion, and physical depth.
// Explicit function layouts share density/light helpers in both backends.

import * as THREE from "three";
import {
  Fn, If, Loop, Break, Continue, uniform, texture, texture3D, uv, vec3, vec4, float, int,
  exp, pow, sqrt, dot, normalize, clamp, max, min, abs, mix, smoothstep, select,
  fract, length, and, getViewPosition, screenCoordinate,
} from "three/tsl";
import { createCloudGeometry } from "./cloudgeometry.js";
import { cloudPointAtmosphere } from "./cloud-point-lighting.js";

// ---------------------------------------------------------------------------
// Per-front layer presets — single source of truth for BOTH emitters.
// base/top/towerTop in world meters (y-up), *Repeat = noise tiling periods in
// meters, coverage = target areal cloud fraction (enforced by quantile — see
// covThreshold), sigma = extinction m^-1 at density 1, maxLen = in-slab march
// cap, erode = detail erosion strength, shadowFloor = ground cloud-shadow
// floor (makeVolCloudShadowNode; values mirror clouds.js CLOUD_CLIMATES).
// ---------------------------------------------------------------------------
const FRONTS = {
  // Cumulus profiles use taller, more varied crowns than stratocumulus.
  NELLIS: {   // scattered fair-weather cumulus, high desert bases
    coverage: 0.30, base: 2700, top: 4700,
    covRepeat: 18000, baseRepeat: 4200, detailRepeat: 850,
    covSharp: 2.6, baseRound: 0.10, topSoft: 0.55, erode: 0.36,
    sigma: 0.035, maxLen: 22000, shadow3D: true, shadowFloor: 0.45, coreSupport: 0.74,
  },
  VALDEZ: {   // broken stratocumulus deck: thin, flat, wide cells
    coverage: 0.55, base: 1100, top: 2400,
    covRepeat: 14000, baseRepeat: 7000, detailRepeat: 1050,
    covSharp: 1.9, baseRound: 0.16, topSoft: 0.40, erode: 0.34,
    sigma: 0.05, maxLen: 16000, shadow3D: false, shadowFloor: 0.62,
  },
  MARIANAS: { // trade cumulus deck + isolated towers to 5200 (tower mask ch.)
    coverage: 0.38, base: 550, top: 1900,
    towerTop: 5200, towerRepeat: 28000, towerLo: 0.72, towerHi: 0.90, towerCov: 0.45,
    covRepeat: 18000, baseRepeat: 4200, detailRepeat: 750,
    // PASS-2 #6: baseRound 0.08 -> 0.13 + baseRelief 0.30 — the trade deck's
    // underside printed as a knife-straight 550m plane (base fade was 108m
    // and the shared 0.16 relief too shallow for a deck this thin)
    covSharp: 2.2, baseRound: 0.13, topSoft: 0.60, erode: 0.35, baseRelief: 0.30,
    sigma: 0.04, maxLen: 22000, shadow3D: true, shadowFloor: 0.50, coreSupport: 0.74,
  },
};

// Fixed physical weather planes: densifying the volume does not move them.
// Quantile sampling below interpolates the identical plane as both samplers.
import { CLOUD_COV_SLICE as COV_SLICE, CLOUD_TOWER_SLICE as TOWER_SLICE, CLOUD_JITTER_N as JITTER_N } from "./cloudnoiserecipe.js";
export { makeCloudNoise, loadCloudNoise } from "./cloudnoise.js";
// Distance-based adaptive view integration; sampling is independent of scene depth.
const MARCH_MAX = 384;
const T_MIN = 0.015;
const ALBEDO = 0.97;
const ENTRY_MAX = 58000;
const MS_A = [0.57, 0.28, 0.15];
const MS_K = [1.0, 0.22, 0.05];
const MS_PMIX = [0.0, 0.7, 1.0];
const ISO_PHASE = 1 / (4 * Math.PI);
const BASE_RELIEF = 0.16;
// Remove the last background leakage in dense cloud while preserving the
// integrated mean source radiance.
const WHITEOUT_T = 0.06;
const BOUND_NOISE_T = 6000, BOUND_NOISE_REPEAT = 8.0;
const CAP_FADE0 = 0.85;
const LIGHT_SUN_ENDS = [24,60,114,195,317,499,772,1182,1797,2720,4104,6180];
const LIGHT_SKY_ENDS = [100,600,3600];

// ---------------------------------------------------------------------------
// Seeded noise bake. Local mulberry32 — NOT Math.random, NOT the sim's RNG
// (render-side asset, but byte-identical across runs so QA can hash it).
// ---------------------------------------------------------------------------
// Shared with the offline asset baker in cloudnoiserecipe.js.

// ---------------------------------------------------------------------------
// CPU sampling — mirrors GPU LinearFilter + RepeatWrapping exactly: texel
// centers at (i+0.5)/N, trilinear, bytes/255.
// ---------------------------------------------------------------------------
function tri4(data, N, u, v, w, out) {
  const fx = u * N - 0.5, fy = v * N - 0.5, fz = w * N - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const wr = (i) => ((i % N) + N) % N;
  const X0 = wr(x0), X1 = wr(x0 + 1), Y0 = wr(y0), Y1 = wr(y0 + 1), Z0 = wr(z0), Z1 = wr(z0 + 1);
  const i000 = ((Z0 * N + Y0) * N + X0) * 4, i100 = ((Z0 * N + Y0) * N + X1) * 4;
  const i010 = ((Z0 * N + Y1) * N + X0) * 4, i110 = ((Z0 * N + Y1) * N + X1) * 4;
  const i001 = ((Z1 * N + Y0) * N + X0) * 4, i101 = ((Z1 * N + Y0) * N + X1) * 4;
  const i011 = ((Z1 * N + Y1) * N + X0) * 4, i111 = ((Z1 * N + Y1) * N + X1) * 4;
  for (let c = 0; c < 4; c++) {
    const a = data[i000 + c] * (1 - tx) + data[i100 + c] * tx;
    const b = data[i010 + c] * (1 - tx) + data[i110 + c] * tx;
    const d = data[i001 + c] * (1 - tx) + data[i101 + c] * tx;
    const e = data[i011 + c] * (1 - tx) + data[i111 + c] * tx;
    out[c] = ((a * (1 - ty) + b * ty) * (1 - tz) + (d * (1 - ty) + e * ty) * tz) / 255;
  }
}

// coverage quantile: the threshold on the COV_SLICE plane of base.r whose
// exceedance fraction equals the front's coverage — the areal cloud fraction
// is the preset number whatever the noise distribution did (same trick as the
// billboard bake). Cached per noise object; identical constant in BOTH
// emitters (baked into the TSL graph at build).
function covThreshold(noise, coverage) {
  if (!noise._covSorted) {
    const N = noise.baseN, fy = COV_SLICE * N - 0.5;
    const j0 = Math.floor(fy), ty = fy - j0;
    const y0 = ((j0 % N) + N) % N, y1 = (y0 + 1) % N;
    const row = new Float32Array(N * N);
    // At 128^3 the physical weather slice lands exactly on a texel plane;
    // at 256^3 it lies halfway between two. Quantiles must sample that same
    // interpolated plane as CPU tri4 and the GPU, never round to either side.
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const a = noise.baseData[((z * N + y0) * N + x) * 4];
        const b = noise.baseData[((z * N + y1) * N + x) * 4];
        row[z * N + x] = (a * (1 - ty) + b * ty) / 255;
      }
    }
    noise._covSorted = row.sort();
  }
  const s = noise._covSorted;
  return s[Math.min(Math.floor((1 - coverage) * s.length), s.length - 1)];
}

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothUnit = (x) => { const t = sat(x); return t * t * (3 - 2 * t); };

// coverage stage (steps 1-3), the CPU twin of tslDensityBuilders' field():
// ONE implementation shared by cpuDensity and cpuCoverage so the oracle and
// the ground-shadow projector can never drift apart. s4 is the caller's
// scratch vec4 (cpuDensity keeps reusing it for the later stages).
function cpuCoverageStage(noise, P, covQ, x, z, s4) {
  // 1. coverage — base.r on the COV_SLICE plane at covRepeat (2D weather field);
  //    .b of the SAME fetch drives the underside base relief (step 4)
  tri4(noise.baseData, noise.baseN, x / P.covRepeat, COV_SLICE, z / P.covRepeat, s4);
  const baseL = P.base + s4[2] * (P.baseRelief ?? BASE_RELIEF) * (P.top - P.base);
  // 2. quantile remap: 0 at the coverage boundary, sharpened toward 1
  const weatherStrength = sat((s4[0] - covQ) / Math.max(1 - covQ, 1e-4));
  let covAmt = sat(weatherStrength * P.covSharp);
  let growth = weatherStrength;
  // 3. towers (MARIANAS): detail.a on the TOWER_SLICE plane raises the local
  //    top toward towerTop and forces coverage in the core
  // A weather cell has a rolling crown, not a shared horizontal ceiling.
  // Both channels are already in the weather fetch. Stay within the slab.
  const crown = s4[1] * 0.65 + s4[3] * 0.35;
  let topL = P.top - (1 - crown) * (P.top - P.base) * (P.shadow3D ? 0.38 : 0.16);
  if (P.towerTop) {
    tri4(noise.detailData, noise.detailN, x / P.towerRepeat, TOWER_SLICE, z / P.towerRepeat, s4);
    const tw = sat((s4[3] - P.towerLo) / (P.towerHi - P.towerLo));
    topL += (P.towerTop - topL) * tw;
    covAmt = sat(covAmt + tw * P.towerCov);
    growth = Math.max(growth, tw);
  }
  // Weak edges of a weather cell form shallow cloud; its rising core can
  // reach the full crown. This tapers the side profile without changing the
  // coverage footprint or adding another noise sample.
  // Keep the unsaturated weather strength: covAmt reaches 1 well before
  // the cell center, so using it for growth would flatten the whole core.
  const shallow = P.shadow3D ? 0.50 : 0.72;
  topL = baseL + (topL - baseL) * (shallow + (1 - shallow) * Math.sqrt(growth));
  return { covAmt, topL, baseL };
}

// the coverage stage alone, 0..1 — the float64 oracle for the ground-shadow
// projector (makeVolCloudShadowNode samples this exact stage on the GPU)
export function cpuCoverage(noise, front, x, z) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  return cpuCoverageStage(noise, P, covQ, x, z, [0, 0, 0, 0]).covAmt;
}

// ---------------------------------------------------------------------------
// THE DENSITY RECIPE — emitter 1 of 2 (float64 oracle). Steps 1..8 mirror
// tslDensityBuilders below 1:1 (steps 1-3 live in cpuCoverageStage above).
// ---------------------------------------------------------------------------
export function cpuDensity(noise, front, x, y, z) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  const s4 = [0, 0, 0, 0];

  // steps 1-3: coverage + towers (shared stage — see cpuCoverageStage)
  const { covAmt, topL, baseL } = cpuCoverageStage(noise, P, covQ, x, z, s4);
  if (covAmt <= 0) return 0;
  // 4. height gradient — round base, anvil-less soft top (Schneider/Nubis);
  //    the base is the RELIEF-lifted baseL (>= P.base always: outside-slab
  //    zero is preserved), so undersides get 875-1750m lumps instead of a slab
  const hf = (y - baseL) / (topL - baseL);
  if (hf <= 0 || hf >= 1) return 0;
  const grad = smoothUnit(hf / P.baseRound) * (1 - smoothUnit((hf - P.topSoft) / (1 - P.topSoft)));
  // 5. base shape: broad weather mass plus positively weighted inverted
  // Worley lobes. Inverted Worley peaks are billow centers; subtracting them
  // in a second remap suppressed the lobes and left extruded weather slabs.
  tri4(noise.baseData, noise.baseN, x / P.baseRepeat, y / P.baseRepeat, z / P.baseRepeat, s4);
  const wfbm = s4[1] * 0.625 + s4[2] * 0.25 + s4[3] * 0.125;
  const rawShape = Math.max(s4[0] * 0.35 + wfbm * 1.8 - 0.40, 0);
  // A smooth shoulder approaches 1 without clipping the brightest 6.6%
  // of billow peaks into shared plateaus. Low and middle densities retain
  // their contrast; that contrast is the actual three-dimensional shape.
  const shoulder = Math.max(rawShape - 0.80, 0);
  const shape = rawShape - shoulder * shoulder / (shoulder + 0.20);
  // 6. coverage remap (higher coverage lowers the threshold), softened by covAmt
  // Even the wettest weather core retains a three-dimensional boundary.
  // Letting its support reach 1 fills every low-frequency valley, leaving
  // only the height envelope to define a broad, almost level roof.
  const support = covAmt * (P.coreSupport ?? 1);
  let d = sat((shape * grad - (1 - support)) / Math.max(support, 1e-4)) * covAmt;
  if (d <= 0) return 0;
  // 7. detail erosion: wispy at the base, billowy at the top. Erosion height
  //    uses the BASE layer span (not the tower-raised span) — both emitters.
  tri4(noise.detailData, noise.detailN, x / P.detailRepeat, y / P.detailRepeat, z / P.detailRepeat, s4);
  const dfbm = s4[0] * 0.625 + s4[1] * 0.25 + s4[2] * 0.125;
  const hfE = sat((y - P.base) / (P.top - P.base));
  const e = (dfbm + (1 - 2 * dfbm) * sat(hfE * 5)) * P.erode;
  // 8. final density 0..1
  return sat((d - e) / (1 - e));
}

// ---------------------------------------------------------------------------
// THE DENSITY RECIPE — emitter 2 of 2 (TSL), staged for the march's fetch
// budget. Same numbered steps as cpuDensity, split at the natural gate
// points so empty air costs 1-2 fetches per step instead of 4:
//   field  = steps 1-3 (coverage + towers, the slowly-varying 2D fields)
//   gradAt = step  4   (pure ALU given the field)
//   shape6 = steps 5-6 (base-shape fetch + coverage remap)
//   erode8 = steps 7-8 (detail fetch + erosion)
// All Fn so the shader emits ONE function per stage however often it's called.
// ---------------------------------------------------------------------------
function tslDensityBuilders(noise, P, covQ) {
  const invCovQ = Math.max(1 - covQ, 1e-4);

  // steps 1-3 -> vec3(covAmt, topL, baseL)
  const field = Fn(([p]) => {
    // 1. coverage (.b of the same fetch = underside base relief, step 4)
    const c4 = texture3D(noise.baseTex,
      vec3(p.x.div(P.covRepeat), COV_SLICE, p.z.div(P.covRepeat)));
    const baseL = float(P.base).add(c4.b.mul((P.baseRelief ?? BASE_RELIEF) * (P.top - P.base)));
    // 2. quantile remap
    const weatherStrength = clamp(c4.r.sub(covQ).div(invCovQ), 0.0, 1.0).toVar();
    const covAmt = clamp(weatherStrength.mul(P.covSharp), 0.0, 1.0).toVar();
    const growth = weatherStrength.toVar();
    // 3. towers
    const crown = c4.g.mul(0.65).add(c4.a.mul(0.35));
    const topL = float(P.top).sub(crown.oneMinus()
      .mul((P.top - P.base) * (P.shadow3D ? 0.38 : 0.16))).toVar();
    if (P.towerTop) {
      const tw = clamp(texture3D(noise.detailTex,
        vec3(p.x.div(P.towerRepeat), TOWER_SLICE, p.z.div(P.towerRepeat))).a
        .sub(P.towerLo).div(P.towerHi - P.towerLo), 0.0, 1.0);
      topL.assign(mix(topL, float(P.towerTop), tw));
      covAmt.assign(clamp(covAmt.add(tw.mul(P.towerCov)), 0.0, 1.0));
      growth.assign(max(growth, tw));
    }
    const shallow = P.shadow3D ? 0.50 : 0.72;
    topL.assign(baseL.add(topL.sub(baseL)
      .mul(sqrt(growth).mul(1 - shallow).add(shallow))));
    return vec3(covAmt, topL, baseL);
  }).setLayout({ name: "cloudDensityField", type: "vec3", inputs: [{ name: "p", type: "vec3" }] });

  // 4. height gradient — round base, anvil-less soft top (ALU only)
  const gradAt = (y, topL, baseL) => {
    const hf = y.sub(baseL).div(topL.sub(baseL));
    return smoothstep(0.0, P.baseRound, hf)
      .mul(smoothstep(P.topSoft, 1.0, hf).oneMinus());
  };

  // steps 5-6 -> pre-erosion density
  const shape6 = Fn(([p, covAmt, grad]) => {
    // 5. base shape
    const b = texture3D(noise.baseTex, p.div(P.baseRepeat));
    const wfbm = b.g.mul(0.625).add(b.b.mul(0.25)).add(b.a.mul(0.125));
    const rawShape = max(b.r.mul(0.35).add(wfbm.mul(1.8)).sub(0.40), 0.0).toVar();
    const shoulder = max(rawShape.sub(0.80), 0.0).toVar();
    const shape = rawShape.sub(shoulder.mul(shoulder).div(shoulder.add(0.20)));
    // 6. coverage remap
    const support = covAmt.mul(P.coreSupport ?? 1);
    return clamp(shape.mul(grad).sub(support.oneMinus()).div(max(support, 1e-4)), 0.0, 1.0)
      .mul(covAmt);
  }).setLayout({ name: "cloudDensityShape", type: "float", inputs: [
    { name: "p", type: "vec3" }, { name: "covAmt", type: "float" }, { name: "grad", type: "float" },
  ] });

  // steps 7-8 -> final density
  const erode8 = Fn(([p, d]) => {
    // 7. detail erosion
    const det = texture3D(noise.detailTex, p.div(P.detailRepeat));
    const dfbm = det.r.mul(0.625).add(det.g.mul(0.25)).add(det.b.mul(0.125));
    const hfE = clamp(p.y.sub(P.base).div(P.top - P.base), 0.0, 1.0);
    const e = mix(dfbm, dfbm.oneMinus(), clamp(hfE.mul(5.0), 0.0, 1.0)).mul(P.erode);
    // 8. final density
    return clamp(d.sub(e).div(e.oneMinus()), 0.0, 1.0);
  }).setLayout({ name: "cloudDensityErode", type: "float", inputs: [
    { name: "p", type: "vec3" }, { name: "d", type: "float" },
  ] });

  return { field, gradAt, shape6, erode8 };
}

// ---------------------------------------------------------------------------
// Ground cloud-shadow projector — the volumetric twin of clouds.js
// makeCloudShadowNode (bind the returned visibility to the direct light's
// shadow node; range [shadowFloor..1]).
// Projects from the ground point up the sun ray to the slab's mid-altitude
// and samples the SAME GPU coverage plane the march's field() stage samples
// (base.r on COV_SLICE at covRepeat) with the same quantile threshold +
// covSharp remap — the shadow sits under the visible cloud by construction.
// The coverage field is STATIC (the march never advects it; only interior
// detail drifts with uTime), so there is NO time scroll here — flipping that
// would be the drift bug. 1 texture tap (+1 tower tap on MARIANAS), no
// loops, no If-staging: a pure smooth function of wp, jitter/TRAA-
// independent by construction (VOLUMETRIC LAW).
// ---------------------------------------------------------------------------
export function makeVolCloudShadowNode({ noise, front, uSunDir, curvature = null }) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  const invCovQ = Math.max(1 - covQ, 1e-4);       // same constant field() bakes
  const midAlt = (P.base + P.top) / 2;            // main-deck casting plane
  const towerMid = P.towerTop ? (P.base + P.towerTop) / 2 : 0;
  const floor = P.shadowFloor ?? 0.55;
  const geometry = curvature ? createCloudGeometry(curvature) : null;
  return function volCloudShadow(renderWp) {
    const wp = geometry ? geometry.toMap(renderWp) : renderWp;
    const sun = normalize(uSunDir);
    const sy = max(sun.y, 0.08); // low-sun ray-length clamp (billboard contract)
    // project up the sun ray to the deck's mid-altitude; max(,0) keeps
    // terrain poking above the deck from projecting backwards
    let hit;
    if (geometry) {
      // Keep the established low-Sun slope clamp, normalized for sphere roots.
      const direction = normalize(vec3(sun.x, sy, sun.z));
      const roots = geometry.roots(renderWp, direction, midAlt);
      const t = select(wp.y.lessThan(midAlt).and(roots.z.greaterThan(0)), max(roots.y, 0), 0);
      hit = renderWp.xz.add(direction.xz.mul(t));
    } else {
      const t = max(float(midAlt).sub(wp.y), 0.0).div(sy);
      hit = wp.xz.add(sun.xz.mul(t));
    }
    // steps 1-2 of the march's coverage stage (field()), verbatim
    const weather = texture3D(noise.baseTex,
      vec3(hit.x.div(P.covRepeat), COV_SLICE, hit.y.div(P.covRepeat)));
    const growth = clamp(weather.r.sub(covQ).div(invCovQ), 0.0, 1.0);
    const deckBase = float(P.base).add(weather.b.mul((P.baseRelief ?? BASE_RELIEF) * (P.top - P.base)));
    const crown = weather.g.mul(0.65).add(weather.a.mul(0.35));
    const envelopeTop = float(P.top).sub(crown.oneMinus().mul((P.top - P.base) * (P.shadow3D ? 0.38 : 0.16)));
    const shallow = P.shadow3D ? 0.50 : 0.72;
    const deckTop = deckBase.add(envelopeTop.sub(deckBase).mul(sqrt(growth).mul(1 - shallow).add(shallow)));
    // The inexpensive weather-column approximation only counts cloud above
    // the receiver. In particular, an exposed mountain cannot be shadowed
    // by a lower deck merely because its XZ coordinate lies under coverage.
    const deckRemaining = clamp(deckTop.sub(wp.y).div(max(deckTop.sub(deckBase), 1)), 0, 1);
    let covAmt = clamp(growth.mul(P.covSharp), 0.0, 1.0).mul(deckRemaining);
    if (P.towerTop) {
      // step 3: MARIANAS towers are a separate additive coverage term in
      // field() — one extra tap, projected at the TOWER column's own
      // mid-altitude so the dominant casters shadow where they stand
      let hitT;
      if (geometry) {
        const direction = normalize(vec3(sun.x, sy, sun.z));
        const roots = geometry.roots(renderWp, direction, towerMid);
        const tT = select(wp.y.lessThan(towerMid).and(roots.z.greaterThan(0)), max(roots.y, 0), 0);
        hitT = renderWp.xz.add(direction.xz.mul(tT));
      } else {
        const tT = max(float(towerMid).sub(wp.y), 0.0).div(sy);
        hitT = wp.xz.add(sun.xz.mul(tT));
      }
      const tw = clamp(texture3D(noise.detailTex,
        vec3(hitT.x.div(P.towerRepeat), TOWER_SLICE, hitT.y.div(P.towerRepeat))).a
        .sub(P.towerLo).div(P.towerHi - P.towerLo), 0.0, 1.0);
      const towerTop = mix(float(P.top), float(P.towerTop), tw);
      const towerRemaining = clamp(towerTop.sub(wp.y).div(max(towerTop.sub(P.base), 1)), 0, 1);
      covAmt = clamp(covAmt.add(tw.mul(P.towerCov).mul(towerRemaining)), 0.0, 1.0);
    }
    const dayGate = smoothstep(0.03, 0.12, sun.y); // shadows die past sunset
    return mix(float(1.0), float(floor), covAmt.mul(dayGate));
  };
}

// dual-lobe Henyey-Greenstein
const hg = (c, g) =>
  float((1 - g * g) / (4 * Math.PI)).div(pow(c.mul(-2 * g).add(1 + g * g), 1.5));

// every node built by this module registers its camera-matrix uniforms here;
// updateCamera refreshes them all (one volumetric front per page in practice)
const _camRegistry = [];
export function updateCamera(camera) {
  for (const r of _camRegistry) {
    r.uProjInv.value.copy(camera.projectionMatrixInverse);
    r.uCamWorld.value.copy(camera.matrixWorld);
  }
}

// ---------------------------------------------------------------------------
// The composite node. beauty/depth: texture nodes from the game's scenePass.
// camera: seeds the matrix uniforms (then updateCamera keeps them fresh).
// uSunDir/uCamPos/uTime: shared uniforms (three-frame y-up world meters).
// front: "NELLIS" | "VALDEZ" | "MARIANAS". noise: makeCloudNoise result.
// aerial: null | { trans(wp)->vec3, ins(wp)->vec3, uSunI } (hillaire pair;
// ins is unit-sun, scaled by uSunI here exactly like terrain/water do).
// Returns vec4: rgb = beauty with clouds composited over it, a = 1.
// ---------------------------------------------------------------------------

// Every light ray samples the same final density as the view ray. Staging
// avoids shape/detail fetches in empty weather or outside the layer slab.
function makeSegmentLighting(P, density, topAll, geometry = null, dualSource = false, relativeOmission = .001) {
  const lightDensity = Fn(([renderP]) => {
    const p = geometry ? geometry.toMap(renderP).toVar('cloudLightMapPoint') : renderP;
    // The column clips every interval to the cloud slab before sampling.
    // Only the weather/shape/detail gates remain inside this shared helper.
    const value = float(0.0).toVar();
    const f = density.field(p).toVar();
    const grad = density.gradAt(p.y, f.y, f.z).toVar();
    If(f.x.mul(grad).greaterThan(1e-3), () => {
      const shape = density.shape6(p, f.x, grad).toVar();
      If(shape.greaterThan(0.002), () => {
        value.assign(density.erode8(p, shape));
      });
    });
    return value;
  }).setLayout({ name: 'cloudLightDensity', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

  // Growing intervals are gentler than the earlier doubling ladder. Clip
  // the final interval at the real slab exit, so a midpoint outside the slab
  // cannot erase the remaining in-cloud part of that interval.
  const makeColumn = (name, ends) => Fn(([p, direction]) => {
    const column = float(0.0).toVar();
    let slabDistance;
    if (geometry) {
      const interval = geometry.shell(p, direction, P.base, topAll).toVar();
      slabDistance = select(interval.x.lessThan(ends[ends.length - 1]),
        interval.y.clamp(0, ends[ends.length - 1]), 0.0).toVar();
    } else {
      const upward = direction.y.greaterThanEqual(0.0);
      const safeY = select(upward, max(direction.y, 1e-5), min(direction.y, -1e-5));
      slabDistance = select(upward, float(topAll).sub(p.y), float(P.base).sub(p.y))
        .div(safeY).clamp(0, ends[ends.length - 1]).toVar();
    }
    let start = 0;
    for (const end of ends) {
      const intervalStart = start;
      let active = slabDistance.greaterThan(intervalStart);
      // All three scattering orders are negligible only at optical depth
      // 160: the least-attenuated order is then exp(-8). Checking sooner
      // would add a serial dependency while its conservative bound proves
      // an early exit impossible. Most fronts need no such branch at all.
      if (start * P.sigma >= 160) active = active.and(column.mul(P.sigma).lessThan(160));
      If(active, () => {
        const finish = min(slabDistance, end).toVar();
        column.addAssign(lightDensity(p.add(direction.mul(finish.add(intervalStart).mul(0.5))))
          .mul(finish.sub(intervalStart)));
      });
      start = end;
    }
    return column.mul(P.sigma);
  }).setLayout({ name, type: 'float', inputs: [
    { name: 'p', type: 'vec3' }, { name: 'direction', type: 'vec3' },
  ] });
  const sunColumn = makeColumn('cloudSunColumn', LIGHT_SUN_ENDS);
  const skyColumn = makeColumn('cloudSkyColumn', LIGHT_SKY_ENDS);
  const skyDirections = [[0.7453559924999299,2/3,0],[-0.7453559924999299,2/3,0]];
  const diffuseTransfer = (tau) => {
    let sum = float(0.0);
    for (let j = 0; j < MS_A.length; j++) {
      sum = sum.add(exp(tau.mul(-MS_K[j])).mul(MS_A[j]));
    }
    return sum;
  };

  if (dualSource) return Fn(([p, sunDirection, solarPhase, solarColor, moonDirection, lunarPhase, lunarColor, skyColor]) => {
    const sky = float(0).toVar();
    for (const direction of skyDirections) {
      sky.addAssign(diffuseTransfer(skyColumn(p, vec3(...direction))).div(skyDirections.length));
    }
    const diffuse = skyColor.mul(sky).toVar();
    const direct = vec3(0).toVar();
    // exp(-k*tau) <= 1 for every nonnegative density column. The zero-column
    // response is therefore an upper bound on each RGB source contribution.
    // Skip only if ALL channels fit within the allowed fraction of the
    // actual retained diffuse RGB. Zero tolerance is the strict reference.
    const sourceColumn = (direction, phase, color) => {
      let transferBound = float(0);
      for (let j = 0; j < MS_A.length; j++) {
        transferBound = transferBound.add(mix(phase, float(ISO_PHASE), MS_PMIX[j]).mul(MS_A[j]));
      }
      const upper = color.mul(transferBound).toVar();
      const limit = diffuse.mul(relativeOmission).toVar();
      const significant = upper.x.greaterThan(limit.x).or(upper.y.greaterThan(limit.y)).or(upper.z.greaterThan(limit.z));
      If(max(max(color.x, color.y), color.z).greaterThan(0).and(significant), () => {
        const tau = sunColumn(p, direction).toVar();
        const transfer = float(0).toVar();
        for (let j = 0; j < MS_A.length; j++) {
          transfer.addAssign(exp(tau.mul(-MS_K[j]))
            .mul(mix(phase, float(ISO_PHASE), MS_PMIX[j])).mul(MS_A[j]));
        }
        direct.addAssign(color.mul(transfer));
      });
    };
    sourceColumn(sunDirection, solarPhase, solarColor);
    sourceColumn(moonDirection, lunarPhase, lunarColor);
    return direct.add(diffuse);
  }).setLayout({ name: 'cloudSegmentRadiance', type: 'vec3', inputs: [
    { name: 'p', type: 'vec3' }, { name: 'sunDirection', type: 'vec3' },
    { name: 'solarPhase', type: 'float' }, { name: 'solarColor', type: 'vec3' },
    { name: 'moonDirection', type: 'vec3' }, { name: 'lunarPhase', type: 'float' },
    { name: 'lunarColor', type: 'vec3' }, { name: 'skyColor', type: 'vec3' },
  ] });

  return Fn(([p, sunDirection, phaseV, sunColor, skyColor]) => {
    const sunlight = float(0.0).toVar();
    If(sunDirection.y.greaterThan(-0.02), () => {
      const tau = sunColumn(p, sunDirection).toVar();
      // Energy-bounded multiple-scattering approximation. The first octave
      // uses actual Beer extinction; higher orders broaden toward isotropy.
      for (let j = 0; j < MS_A.length; j++) {
        sunlight.addAssign(exp(tau.mul(-MS_K[j]))
          .mul(mix(phaseV, float(ISO_PHASE), MS_PMIX[j])).mul(MS_A[j]));
      }
    });
    const sky = float(0.0).toVar();
    for (const direction of skyDirections) {
      sky.addAssign(diffuseTransfer(skyColumn(p, vec3(...direction))).div(skyDirections.length));
    }
    return sunColor.mul(sunlight).add(skyColor.mul(sky));
  }).setLayout({ name: 'cloudSegmentRadiance', type: 'vec3', inputs: [
    { name: 'p', type: 'vec3' }, { name: 'sunDirection', type: 'vec3' },
    { name: 'phaseV', type: 'float' }, { name: 'sunColor', type: 'vec3' },
    { name: 'skyColor', type: 'vec3' },
  ] });
}

export function volCloudsNode({ beauty, depth, camera, uSunDir, uCamPos, uTime, front, noise, aerial, emit = null, curvature = null, jitterCoordinate = null }) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  const density = tslDensityBuilders(noise, P, covQ);
  const topAll = P.towerTop || P.top;
  const geometry = curvature ? createCloudGeometry(curvature) : null;
  const physicalSources = aerial?.sourceTransport && aerial?.celestial;
  const pointAtmosphere = physicalSources ? cloudPointAtmosphere({
    ...aerial.sourceTransport, curvature, referenceAltitude: (P.base + P.top) * .5,
  }) : null;
  const segmentRadiance = makeSegmentLighting(P, density, topAll, geometry, !!physicalSources,
    aerial?.sourceTransport?.relativeOmission ?? .001);
  const uSunE = aerial ? aerial.uSunI : uniform(36.0); // unit-sun -> scene HDR scale

  const uProjInv = uniform(new THREE.Matrix4());
  const uCamWorld = uniform(new THREE.Matrix4());
  if (camera) {
    uProjInv.value.copy(camera.projectionMatrixInverse);
    uCamWorld.value.copy(camera.matrixWorld);
    // TRAA applies its view jitter after the main frame update. Sample the
    // scene camera immediately before this fullscreen draw, when its inverse
    // matches the depth texture. The draw's own camera is orthographic.
    uProjInv.onRenderUpdate(() => uProjInv.value.copy(camera.projectionMatrixInverse));
    uCamWorld.onRenderUpdate(() => uCamWorld.value.copy(camera.matrixWorld));
  }
  _camRegistry.push({ uProjInv, uCamWorld });

  return Fn(() => {
    const suv = uv();
    const bg = beauty.sample(suv); // lazy: layer-only emit does not read scene color

    // view ray + scene distance from ONE depth unprojection (getViewPosition
    // owns the per-backend NDC-z convention, same as GTAONode)
    const vpos = getViewPosition(suv, depth.sample(suv).r, uProjInv);
    const rel = uCamWorld.mul(vec4(vpos, 1.0)).xyz.sub(uCamPos);
    const sceneDist = max(length(rel), 1e-3).toVar();
    const dir = rel.div(sceneDist).toVar();

    // Render rays intersect the same spherical altitude shell as terrain and
    // water. Density is still evaluated in the original flat map field.
    let tIn, tOut, naturalEnd;
    if (geometry) {
      const interval = geometry.shell(uCamPos, dir, P.base, topAll).toVar();
      tIn = interval.x.toVar();
      naturalEnd = min(interval.y, tIn.add(P.maxLen)).toVar();
      tOut = min(naturalEnd, sceneDist).toVar();
    } else {
      const dy = dir.y;
      const dySafe = select(abs(dy).lessThan(1e-5),
        select(dy.greaterThanEqual(0.0), float(1e-5), float(-1e-5)), dy);
      const tA = float(P.base).sub(uCamPos.y).div(dySafe);
      const tB = float(topAll).sub(uCamPos.y).div(dySafe);
      tIn = max(min(tA, tB), 0.0).toVar();
      naturalEnd = min(max(tA, tB), tIn.add(P.maxLen)).toVar();
      tOut = min(naturalEnd, sceneDist).toVar();
    }
    const hit = and(tOut.greaterThan(tIn), tIn.lessThan(ENTRY_MAX));

    const T = float(1.0).toVar();       // view-path transmittance
    const acc = vec3(0.0).toVar();      // accumulated cloud radiance
    const dsum = float(0.0).toVar();    // transmittance-weighted distance sums
    const integrationEnd = float(0.0).toVar();
    const sceneIndependent = float(0.0).toVar();
    const wsum = float(0.0).toVar();    //   (for the aerial representative point)

    If(hit, () => {
      // per-pixel per-frame jittered start: noise + golden-ratio time scroll —
      // TRAA downstream integrates the march noise away
      const rayNoise = texture(noise.jitterTex, (jitterCoordinate || screenCoordinate).div(JITTER_N)).level(0).r
        .mul(255 / 256).add(0.5 / 256);
      const jit = fract(rayNoise.add(fract(uTime.mul(74.1638))));

      // World-space sampling is independent of the background's depth. The
      // old sky/geometry budgets changed dt at the horizon, moving the light
      // anchor by 76m and drawing a visible stripe through the same cloud.
      const fineStepAt = (distance) => mix(25.0, 80.0,
        clamp(distance.sub(1000.0).div(5000.0), 0.0, 1.0));
      const t = tIn.toVar();
      const previousT = tIn.toVar();

      // Illumination depends on the scattering point, not on which cloud
      // boundary the ray encountered first. Phase and incident colors are
      // constant per ray; occlusion is integrated at each scattering point.
      let sunN, phaseV, sunCol, skyCol, sources;
      if (physicalSources) {
        sources = cloudCelestialSources({ viewDir: dir, uSunDir, uSunI: uSunE,
          ...aerial.celestial, albedo: ALBEDO });
        skyCol = sources.sky;
      } else if (aerial?.celestial) {
        const celestial = cloudCelestialLight({ viewDir: dir, uSunDir, uSunI: uSunE,
          ...aerial.celestial, albedo: ALBEDO });
        sunN = celestial.direction; phaseV = celestial.phase;
        sunCol = celestial.direct; skyCol = celestial.sky;
      } else {
        sunN = normalize(uSunDir).toVar();
        const cosT = dot(dir, sunN);
        phaseV = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3).toVar();
        const sunEl = sunN.y;
        const warm = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.35, sunEl));
        sunCol = warm.mul(uSunE).mul(smoothstep(-0.02, 0.08, sunEl)).mul(ALBEDO).toVar();
        skyCol = vec3(0.45, 0.62, 0.95).mul(uSunE).mul(0.05 * ALBEDO)
          .mul(smoothstep(-0.08, 0.25, sunEl)).toVar();
      }

      // fade-not-clip at the march bounds (PASS-1 #5): rays entering near
      // ENTRY_MAX dissolve into the haze instead of a hard slab silhouette,
      // and the maxLen travel cap tapers over its last 15% instead of
      // guillotining mid-cloud. Smooth, monotonic, low-contrast — TRAA-safe.
      // PASS-2 #6: both fades are camera-centered CIRCLES — at a constant
      // deck they print as ruler edges (screen-horizontal lines). One detail
      // fetch at a fixed point along the ray wobbles each ray's fade window
      // (+-, features ~1.8km): the circle becomes a noisy shoreline. Smooth
      // in dir, jitter-independent, completes before the hard tOut clip.
      const fadePoint = uCamPos.add(dir.mul(BOUND_NOISE_T));
      const nB = texture3D(noise.detailTex,
        (geometry ? geometry.toMap(fadePoint) : fadePoint)
          .div(P.detailRepeat * BOUND_NOISE_REPEAT)).g.toVar();
      const entryFade = smoothstep(
        float(ENTRY_MAX).mul(mix(0.62, 0.78, nB)),
        float(ENTRY_MAX).mul(mix(0.90, 1.0, nB)), tIn).oneMinus().toVar();
      const tCap0 = tIn.add(float(P.maxLen).mul(mix(0.60, CAP_FADE0, nB)));
      const tCap1 = tIn.add(float(P.maxLen).mul(mix(CAP_FADE0, 1.0, nB)));

      // Integrate actual endpoint intervals, including the density-positive
      // to density-zero exit segment. The previous loop dropped that tail.
      // The first sample is exactly at tIn, so a camera inside cloud also
      // starts with the correct extinction instead of a synthetic zero.
      const pendingCoarseEnd = float(-1.0).toVar('cloudPendingCoarseEnd');
      const pendingFineEnd = float(-1.0).toVar('cloudPendingFineEnd');
      const previousSigma = float(0.0).toVar();
      const fineMode = float(0.0).toVar();
      const emptySamples = float(0.0).toVar();
      Loop({ start: int(0), end: int(MARCH_MAX), type: 'int', condition: '<' }, ({ i }) => {
        const renderP = uCamPos.add(dir.mul(t)).toVar();
        const p = geometry ? geometry.toMap(renderP).toVar('cloudViewMapPoint') : renderP;
        const sampleDensity = float(0.0).toVar();
        // staged density: coverage field first (1-2 fetches), base shape and
        // detail erosion only where the previous stage says cloud can exist —
        // empty air is the common case and must stay near-free
        const f = density.field(p).toVar();
        const covAmt = f.x, topL = f.y;
        const grad = density.gradAt(p.y, topL, f.z).toVar();
        const gateVal = covAmt.mul(grad).toVar();
        // A coarse empty-weather step may discover a cloud only at its far
        // endpoint. Revisit the interval at fine spacing BEFORE committing
        // extinction or lighting; otherwise one 280m interval scatters in air.
        // Reserve the existing final budget tail for guaranteed ray coverage.
        const entryFineStep = fineStepAt(previousT).toVar('cloudEntryFineStep');
        If(i.lessThan(MARCH_MAX - 32).and(gateVal.greaterThan(0.01))
          .and(t.sub(previousT).greaterThan(entryFineStep.mul(1.05))), () => {
          pendingCoarseEnd.assign(max(pendingCoarseEnd, t));
          t.assign(min(previousT.add(entryFineStep), tOut));
          fineMode.assign(1.0);
          emptySamples.assign(0.0);
          Continue();
        });
        If(gateVal.greaterThan(1e-3), () => {
          const d6 = density.shape6(p, covAmt, grad).toVar();
          If(d6.greaterThan(0.002), () => {
            sampleDensity.assign(density.erode8(p, d6));
          });
        });
        const capFade = smoothstep(tCap0, tCap1, t).oneMinus();
        const sigma = sampleDensity.mul(entryFade).mul(capFade).mul(P.sigma).toVar();
        const interval = t.sub(previousT).toVar();
        // Bound visible-front quadrature error without shrinking every step.
        // Refine ordinary fine intervals at most to half their spacing where
        // endpoint optical-depth change exceeds 0.03 and >=10% light remains.
        // Rejected endpoints never mutate previousSigma, previousT, T or acc.
        const frontOpticalChange = abs(sigma.sub(previousSigma)).mul(interval)
          .toVar('cloudFrontOpticalChange');
        If(i.lessThan(MARCH_MAX - 32).and(T.greaterThan(0.1))
          .and(interval.greaterThan(entryFineStep.mul(0.55)))
          .and(interval.lessThanEqual(entryFineStep.mul(1.05)))
          .and(frontOpticalChange.greaterThan(0.03)), () => {
          pendingFineEnd.assign(max(pendingFineEnd, t));
          t.assign(min(previousT.add(max(entryFineStep.mul(0.5), interval.mul(0.5))), tOut));
          fineMode.assign(1.0);
          emptySamples.assign(0.0);
          Continue();
        });
        const tau = sigma.add(previousSigma).mul(0.5).mul(interval).toVar();
        If(tau.greaterThan(1e-7), () => {
          const stepT = exp(tau.negate()).toVar();
          // Exact scatter centroid for the homogeneous segment represented
          // by this trapezoid. The small-tau expansion avoids cancellation.
          const centroid = select(tau.greaterThan(0.05),
            float(1.0).div(max(tau, 1e-5)).sub(stepT.div(max(stepT.oneMinus(), 1e-5))),
            float(0.5).sub(tau.div(12.0)).add(tau.mul(tau).mul(tau).div(720.0)));
          const scatterT = previousT.add(interval.mul(centroid)).toVar();
          const w = T.mul(stepT.oneMinus()).toVar();
          const scatterPoint = uCamPos.add(dir.mul(scatterT)).toVar();
          if (physicalSources) {
            const solarAtPoint = pointAtmosphere(scatterPoint, sources.solarDirection,
              sources.solarColor).toVar();
            const lunarAtPoint = pointAtmosphere(scatterPoint, sources.lunarDirection,
              sources.lunarColor, aerial.celestial.uMoonAngularRadius).toVar();
            acc.addAssign(segmentRadiance(scatterPoint, sources.solarDirection, sources.solarPhase,
              solarAtPoint, sources.lunarDirection, sources.lunarPhase, lunarAtPoint, skyCol).mul(w));
          } else {
            acc.addAssign(segmentRadiance(scatterPoint, sunN, phaseV, sunCol, skyCol).mul(w));
          }
          dsum.addAssign(w.mul(scatterT));
          wsum.addAssign(w);
          T.mulAssign(stepT);
        });
        // Preserve every discovered far endpoint after a rejected interval. A
        // midpoint-only rewind followed by a full step could skip its peak.
        If(t.greaterThanEqual(pendingCoarseEnd), () => { pendingCoarseEnd.assign(-1.0); });
        If(t.greaterThanEqual(pendingFineEnd), () => { pendingFineEnd.assign(-1.0); });
        previousSigma.assign(sigma);
        previousT.assign(t);
        If(T.lessThan(T_MIN).or(t.greaterThanEqual(tOut)), () => { Break(); });

        // Enter fine mode before the three-dimensional body appears. Two
        // clear samples release it, avoiding a step-size toggle at its edge.
        If(gateVal.greaterThan(0.01), () => { fineMode.assign(1.0); });
        If(gateVal.lessThan(0.003), () => {
          emptySamples.addAssign(1.0);
          If(emptySamples.greaterThanEqual(2.0), () => { fineMode.assign(0.0); });
        }).Else(() => { emptySamples.assign(0.0); });
        const fineStep = fineStepAt(t).toVar();
        const step = mix(clamp(fineStep.mul(3.5), 90.0, 280.0), fineStep, fineMode).toVar();
        If(i.equal(0), () => { step.mulAssign(jit); });
        // The analytic distance curve fits the budget. Reserve a bounded
        // coarse tail for future parameter changes instead of ever clipping
        // a ray merely because its iteration budget ended.
        If(i.greaterThanEqual(MARCH_MAX - 32), () => {
          step.assign(max(step, tOut.sub(t).div(max(float(MARCH_MAX - 1).sub(float(i)), 1.0))));
        });
        let nextEnd = min(t.add(step), tOut);
        nextEnd = min(nextEnd, select(pendingCoarseEnd.greaterThan(t), pendingCoarseEnd, tOut));
        nextEnd = min(nextEnd, select(pendingFineEnd.greaterThan(t), pendingFineEnd, tOut));
        t.assign(nextEnd);
      });
      integrationEnd.assign(previousT);
      // A result can be reused across different opaque backgrounds only when
      // opacity terminated it or its complete slab/cap interval was integrated.
      sceneIndependent.assign(select(T.lessThan(T_MIN)
        .or(sceneDist.greaterThanEqual(naturalEnd)), 1.0, 0.0));
    });

    // Preserve the existing dense-cloud opacity remap. With distributed
    // lighting this rescales the integrated average source, not a single
    // per-ray light value; no claim of jitter cancellation is made.
    const Tvis = max(T.sub(WHITEOUT_T).div(1 - WHITEOUT_T), 0.0).toVar();
    acc.mulAssign(Tvis.oneMinus().div(max(T.oneMinus(), 1e-4)));

    // aerial perspective at the mean scatter distance: distant clouds sit IN
    // the haze (inscatter weighted by cloud alpha — clear pixels keep the
    // in-material aerial the beauty already carries)
    const alpha = Tvis.oneMinus();
    if (aerial) {
      If(alpha.greaterThan(0.002), () => {
        const wpRep = uCamPos.add(dir.mul(dsum.div(max(wsum, 1e-4)))).toVar();
        acc.assign(acc.mul(aerial.trans(wpRep))
          .add(aerial.ins(wpRep).mul(uSunE).mul(alpha)));
      });
    }

    const color = vec4(bg.rgb.mul(Tvis).add(acc), 1.0);
    // A compositor can reuse the same integration for motion and real depth.
    // Standalone callers keep the original RGBA node API.
    if (emit) return emit({ color, alpha, meanDistance: dsum.div(max(wsum, 1e-4)),
      sceneDistance: sceneDist, rayDirection: dir,
      radiance: acc, transmittance: Tvis, viewDepth: vpos.z.negate(),
      integrationEnd, sceneIndependent });
    return color;
  })();
}

// Shared bounds for full-resolution cloud rejection before reconstruction.
export function cloudLayerBounds(front) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  return { base: P.base, top: P.towerTop || P.top, maxLen: P.maxLen, entryMax: ENTRY_MAX };
}

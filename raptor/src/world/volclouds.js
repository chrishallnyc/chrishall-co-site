// Volumetric clouds — MAXFI B3 rung 1: a full-res single-pass raymarch that
// rides the post chain between the scene pass and TRAA (the jittered march is
// exactly the noise TRAA's history filter integrates away). Supersedes the
// billboard field visually; clouds.js stays as the fallback tier AND keeps
// owning the ground cloud-shadow projector (known gap, journaled: the volume
// does not shadow the terrain yet).
//
// House pattern (hillaire.js, shipped 3x): ONE density recipe, TWO emitters —
// cpuDensity is the float64 oracle the battery gates, tslDensity emits the
// SAME steps as nodes. The step comments are numbered 1..8 in BOTH emitters;
// change one side, change both.
//
// March architecture (module contract):
//   - full-res composite node: beauty/depth in, beauty-with-clouds-over out.
//     traa() wraps its input in convertToTexture(), so this node renders once
//     into TRAA's input RT — no private pass needed. Insert in post.js as
//     `taa = traa(cloudsNode, depth, vel, camera)` instead of beauty.
//   - slab march: the view ray is clipped to the [base, top] altitude slab,
//     capped by scene depth (geometry closer than slab entry skips the march
//     entirely), by 58km of entry distance (the aerial haze owns the sky past
//     that), and by maxLen of in-slab travel; 40-56 steps scaled by slab
//     length (~450m target step), early Break under T < 0.015. Density is
//     staged (coverage field -> base shape -> detail erosion, each behind an
//     If) so empty air costs 1-2 texture fetches per step, not 4.
//   - measured (Dawn/Metal, native 2560x1440, depth at far so EVERY pixel
//     marches the full slab — the pathological worst case, aerial wired):
//     NELLIS in-layer 1.5ms, NELLIS below-layer 1.4ms, VALDEZ over-deck
//     1.9ms, MARIANAS tower slab 2.3ms. In-game frames sit under these
//     (terrain occlusion + slab misses skip the march per-pixel).
//   - jitter: interleaved-gradient-noise over screenCoordinate + golden-ratio
//     uTime scroll offsets the march start per pixel per frame. Render-side
//     only — the sim never reads clouds.
//   - lighting: 5-tap Beer-Lambert shadow march toward uSunDir (cheap density
//     = the recipe without detail erosion, over-estimate compensated by
//     SUN_SHADOW_K), dual-lobe Henyey-Greenstein (g +0.6 forward / -0.25
//     back), sky-ish ambient shaded by height in layer. Direct sun gates out
//     just below the horizon and ambient follows the sky down — clouds go
//     dark before the sky does.
//   - aerial perspective: accumulated cloud light is pushed through the
//     Hillaire trans/inscatter pair at the transmittance-weighted mean
//     scatter distance, so distant clouds sit IN the haze instead of popping
//     against the horizon (closes the journaled billboard gap).
//   - compositing: out = beauty*T + cloudLight (cloudLight already carries
//     the per-step (1-stepT) energy weights).
//
// Camera API: the node never reads the camera inside the node graph — the
// projection-inverse and world matrices live in mat4 uniforms seeded at
// construction. updateCamera(camera) (module export) refreshes the matrices
// of every node built by this module; call it once per frame (main.js:
// `vol.VC.updateCamera?.(camera)`).

import * as THREE from "three";
import {
  Fn, If, Loop, Break, uniform, texture3D, uv, vec2, vec3, vec4, float, int,
  exp, pow, dot, normalize, clamp, max, min, abs, mix, smoothstep, select,
  fract, length, and, getViewPosition, screenCoordinate,
} from "three/tsl";

// ---------------------------------------------------------------------------
// Per-front layer presets — single source of truth for BOTH emitters.
// base/top/towerTop in world meters (y-up), *Repeat = noise tiling periods in
// meters, coverage = target areal cloud fraction (enforced by quantile — see
// covThreshold), sigma = extinction m^-1 at density 1, maxLen = in-slab march
// cap, erode = detail erosion strength.
// ---------------------------------------------------------------------------
const FRONTS = {
  NELLIS: {   // scattered fair-weather cumulus, high desert bases
    coverage: 0.30, base: 2700, top: 4300,
    covRepeat: 26000, baseRepeat: 8000, detailRepeat: 1100,
    covSharp: 2.6, baseRound: 0.10, topSoft: 0.55, erode: 0.28,
    sigma: 0.035, maxLen: 22000,
  },
  VALDEZ: {   // broken stratocumulus deck: thin, flat, wide cells
    coverage: 0.55, base: 1100, top: 2400,
    covRepeat: 30000, baseRepeat: 11000, detailRepeat: 1500,
    covSharp: 2.5, baseRound: 0.16, topSoft: 0.40, erode: 0.20,
    sigma: 0.05, maxLen: 16000,
  },
  MARIANAS: { // trade cumulus deck + isolated towers to 5200 (tower mask ch.)
    coverage: 0.38, base: 550, top: 1900,
    towerTop: 5200, towerRepeat: 42000, towerLo: 0.72, towerHi: 0.90, towerCov: 0.45,
    covRepeat: 24000, baseRepeat: 6500, detailRepeat: 900,
    covSharp: 2.2, baseRound: 0.08, topSoft: 0.60, erode: 0.35,
    sigma: 0.04, maxLen: 22000,
  },
};

// shared recipe constants — texel-center-aligned slices so the CPU trilinear
// and the GPU sampler read the identical texel plane
const BASE_N = 96, DETAIL_N = 32;
const COV_SLICE = 48.5 / BASE_N;     // base.r on this v-plane = the 2D weather field
const TOWER_SLICE = 16.5 / DETAIL_N; // detail.a on this v-plane = the 2D tower mask
const STEPS_MIN = 40, STEPS_MAX = 56, STEP_TARGET = 450; // march step sizing (m)
const T_MIN = 0.015;                 // early-out transmittance
const SUN_TAPS = [40, 100, 220, 460, 950]; // shadow-march distances (m)
const SUN_SHADOW_K = 0.8;            // cheap density skips erosion -> overestimates OD
const ALBEDO = 0.97;                 // single-scatter albedo folded into the sun term
const ENTRY_MAX = 58000;             // slab entries past this are pure haze

// ---------------------------------------------------------------------------
// Seeded noise bake. Local mulberry32 — NOT Math.random, NOT the sim's RNG
// (render-side asset, but byte-identical across runs so QA can hash it).
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// tileable inverted Worley: F^3 feature points (one per cell), 27-neighbor
// scan with wrapped cells; value = saturate(1 - dist_in_cells), peak 1 at
// feature points
function worleyField(N, F, rnd) {
  const pts = new Float64Array(F * F * F * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const out = new Float32Array(N * N * N);
  let k = 0;
  for (let z = 0; z < N; z++) {
    const pz = ((z + 0.5) / N) * F, cz = Math.floor(pz);
    for (let y = 0; y < N; y++) {
      const py = ((y + 0.5) / N) * F, cy = Math.floor(py);
      for (let x = 0; x < N; x++) {
        const px = ((x + 0.5) / N) * F, cx = Math.floor(px);
        let m = 1e9;
        for (let dz = -1; dz <= 1; dz++) {
          const az = cz + dz, wz = az < 0 ? az + F : az >= F ? az - F : az;
          for (let dy = -1; dy <= 1; dy++) {
            const ay = cy + dy, wy = ay < 0 ? ay + F : ay >= F ? ay - F : ay;
            for (let dx = -1; dx <= 1; dx++) {
              const ax = cx + dx, wx = ax < 0 ? ax + F : ax >= F ? ax - F : ax;
              const bi = ((wz * F + wy) * F + wx) * 3;
              const ex = ax + pts[bi] - px, ey = ay + pts[bi + 1] - py, ez = az + pts[bi + 2] - pz;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 < m) m = d2;
            }
          }
        }
        const v = 1 - Math.sqrt(m);
        out[k++] = v < 0 ? 0 : v;
      }
    }
  }
  return out;
}

// tileable gradient (Perlin) noise: wrapped lattice, seeded unit gradients
function perlinGrads(F, rnd) {
  const g = new Float64Array(F * F * F * 3);
  for (let i = 0; i < g.length; i += 3) {
    let x, y, z, l;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; }
    while (l < 1e-4 || l > 1);
    l = 1 / Math.sqrt(l);
    g[i] = x * l; g[i + 1] = y * l; g[i + 2] = z * l;
  }
  return g;
}

function perlinFbmField(N, F0, octaves, rnd) {
  const tables = [];
  for (let o = 0; o < octaves; o++) tables.push(perlinGrads(F0 << o, rnd));
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(N * N * N);
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += 1 / (1 << o);
  let k = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let o = 0; o < octaves; o++) {
          const F = F0 << o, g = tables[o];
          const px = ((x + 0.5) / N) * F, py = ((y + 0.5) / N) * F, pz = ((z + 0.5) / N) * F;
          const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
          const fx = px - x0, fy = py - y0, fz = pz - z0;
          const sx = fade(fx), sy = fade(fy), sz = fade(fz);
          let acc = 0;
          for (let c = 0; c < 8; c++) {
            const ix = c & 1, iy = (c >> 1) & 1, iz = (c >> 2) & 1;
            const wx = (x0 + ix) % F, wy = (y0 + iy) % F, wz = (z0 + iz) % F;
            const gi = ((wz * F + wy) * F + wx) * 3;
            const d = g[gi] * (fx - ix) + g[gi + 1] * (fy - iy) + g[gi + 2] * (fz - iz);
            const w = (ix ? sx : 1 - sx) * (iy ? sy : 1 - sy) * (iz ? sz : 1 - sz);
            acc += d * w;
          }
          sum += acc / (1 << o);
        }
        out[k++] = 0.5 + (sum / norm) * 0.75; // ~[0,1], centered
      }
    }
  }
  return out;
}

// 2D tileable inverted Worley for the tower mask (constant across w slices)
function worley2D(N, F, rnd) {
  const pts = new Float64Array(F * F * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const out = new Float32Array(N * N);
  let k = 0;
  for (let y = 0; y < N; y++) {
    const py = ((y + 0.5) / N) * F, cy = Math.floor(py);
    for (let x = 0; x < N; x++) {
      const px = ((x + 0.5) / N) * F, cx = Math.floor(px);
      let m = 1e9;
      for (let dy = -1; dy <= 1; dy++) {
        const ay = cy + dy, wy = ay < 0 ? ay + F : ay >= F ? ay - F : ay;
        for (let dx = -1; dx <= 1; dx++) {
          const ax = cx + dx, wx = ax < 0 ? ax + F : ax >= F ? ax - F : ax;
          const bi = (wy * F + wx) * 2;
          const ex = ax + pts[bi] - px, ey = ay + pts[bi + 1] - py;
          const d2 = ex * ex + ey * ey;
          if (d2 < m) m = d2;
        }
      }
      const v = 1 - Math.sqrt(m);
      out[k++] = v < 0 ? 0 : v;
    }
  }
  return out;
}

function make3DTexture(bytes, N) {
  const tex = new THREE.Data3DTexture(bytes, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false; // far-field aliasing is TRAA's job (v1)
  tex.needsUpdate = true;
  return tex;
}

const B = (v) => {
  const b = Math.round(v * 255);
  return b < 0 ? 0 : b > 255 ? 255 : b;
};

// Base 96^3 RGBA8: R = low-freq Perlin-Worley (Perlin fbm dilated by the G
// worley, then min/max stretched to full range), G/B/A = inverted Worley at
// 2/4/8x the base frequency. Detail 32^3 RGBA8: R/G/B = inverted Worley at
// 2/4/8 cells (erosion fbm), A = the 2D TOWER MASK (constant across w).
// One PRNG stream, fixed draw order -> byte-identical for a given seed.
export function makeCloudNoise(seed = 1337) {
  const rnd = mulberry32(seed);
  const N = BASE_N;

  const wG = worleyField(N, 8, rnd);
  const wB = worleyField(N, 16, rnd);
  const wA = worleyField(N, 32, rnd);
  const pn = perlinFbmField(N, 4, 3, rnd);

  const baseData = new Uint8Array(N * N * N * 4);
  // R = remap(perlin, worley-1, 1) — the classic Perlin-Worley dilation
  const r = new Float32Array(N * N * N);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < r.length; i++) {
    const w = wG[i];
    let v = (pn[i] - (w - 1)) / (2 - w);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    r[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const stretch = hi > lo ? 1 / (hi - lo) : 1; // full-range R (QA gates std dev)
  for (let i = 0; i < r.length; i++) {
    baseData[i * 4] = B((r[i] - lo) * stretch);
    baseData[i * 4 + 1] = B(wG[i]);
    baseData[i * 4 + 2] = B(wB[i]);
    baseData[i * 4 + 3] = B(wA[i]);
  }

  const D = DETAIL_N;
  const dR = worleyField(D, 2, rnd);
  const dG = worleyField(D, 4, rnd);
  const dB = worleyField(D, 8, rnd);
  const tw = worley2D(D, 2, rnd);
  const detailData = new Uint8Array(D * D * D * 4);
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < D; x++) {
        const i = (z * D + y) * D + x;
        detailData[i * 4] = B(dR[i]);
        detailData[i * 4 + 1] = B(dG[i]);
        detailData[i * 4 + 2] = B(dB[i]);
        detailData[i * 4 + 3] = B(tw[z * D + x]); // tower mask over (u,w) plane
      }
    }
  }

  return {
    baseTex: make3DTexture(baseData, N),
    detailTex: make3DTexture(detailData, D),
    baseData, detailData, baseN: N, detailN: D,
  };
}

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
    const N = noise.baseN, j = Math.round(COV_SLICE * N - 0.5);
    const row = new Float32Array(N * N);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) row[z * N + x] = noise.baseData[((z * N + j) * N + x) * 4] / 255;
    }
    noise._covSorted = row.sort();
  }
  const s = noise._covSorted;
  return s[Math.min(Math.floor((1 - coverage) * s.length), s.length - 1)];
}

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// THE DENSITY RECIPE — emitter 1 of 2 (float64 oracle). Steps 1..8 mirror
// tslDensityBuilders below 1:1.
// ---------------------------------------------------------------------------
export function cpuDensity(noise, front, x, y, z) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  const s4 = [0, 0, 0, 0];

  // 1. coverage — base.r on the COV_SLICE plane at covRepeat (2D weather field)
  tri4(noise.baseData, noise.baseN, x / P.covRepeat, COV_SLICE, z / P.covRepeat, s4);
  // 2. quantile remap: 0 at the coverage boundary, sharpened toward 1
  let covAmt = sat(((s4[0] - covQ) / Math.max(1 - covQ, 1e-4)) * P.covSharp);
  // 3. towers (MARIANAS): detail.a on the TOWER_SLICE plane raises the local
  //    top toward towerTop and forces coverage in the core
  let topL = P.top;
  if (P.towerTop) {
    tri4(noise.detailData, noise.detailN, x / P.towerRepeat, TOWER_SLICE, z / P.towerRepeat, s4);
    const tw = sat((s4[3] - P.towerLo) / (P.towerHi - P.towerLo));
    topL = P.top + (P.towerTop - P.top) * tw;
    covAmt = sat(covAmt + tw * P.towerCov);
  }
  if (covAmt <= 0) return 0;
  // 4. height gradient — round base, anvil-less soft top (Schneider/Nubis)
  const hf = (y - P.base) / (topL - P.base);
  if (hf <= 0 || hf >= 1) return 0;
  const grad = sat(hf / P.baseRound) * (1 - sat((hf - P.topSoft) / (1 - P.topSoft)));
  // 5. base shape: Perlin-Worley eroded by the Worley fbm
  tri4(noise.baseData, noise.baseN, x / P.baseRepeat, y / P.baseRepeat, z / P.baseRepeat, s4);
  const wfbm = s4[1] * 0.625 + s4[2] * 0.25 + s4[3] * 0.125;
  const shape = sat((s4[0] - (wfbm - 1)) / (2 - wfbm));
  // 6. coverage remap (higher coverage lowers the threshold), softened by covAmt
  let d = sat((shape * grad - (1 - covAmt)) / Math.max(covAmt, 1e-4)) * covAmt;
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

  // steps 1-3 -> vec2(covAmt, topL)
  const field = Fn(([p]) => {
    // 1. coverage
    const cov = texture3D(noise.baseTex,
      vec3(p.x.div(P.covRepeat), COV_SLICE, p.z.div(P.covRepeat))).r;
    // 2. quantile remap
    const covAmt = clamp(cov.sub(covQ).div(invCovQ).mul(P.covSharp), 0.0, 1.0).toVar();
    // 3. towers
    const topL = float(P.top).toVar();
    if (P.towerTop) {
      const tw = clamp(texture3D(noise.detailTex,
        vec3(p.x.div(P.towerRepeat), TOWER_SLICE, p.z.div(P.towerRepeat))).a
        .sub(P.towerLo).div(P.towerHi - P.towerLo), 0.0, 1.0);
      topL.assign(mix(float(P.top), float(P.towerTop), tw));
      covAmt.assign(clamp(covAmt.add(tw.mul(P.towerCov)), 0.0, 1.0));
    }
    return vec2(covAmt, topL);
  });

  // 4. height gradient — round base, anvil-less soft top (ALU only)
  const gradAt = (y, topL) => {
    const hf = y.sub(P.base).div(topL.sub(P.base));
    return clamp(hf.div(P.baseRound), 0.0, 1.0)
      .mul(clamp(hf.sub(P.topSoft).div(1 - P.topSoft).oneMinus(), 0.0, 1.0));
  };

  // steps 5-6 -> pre-erosion density
  const shape6 = Fn(([p, covAmt, grad]) => {
    // 5. base shape
    const b = texture3D(noise.baseTex, p.div(P.baseRepeat));
    const wfbm = b.g.mul(0.625).add(b.b.mul(0.25)).add(b.a.mul(0.125));
    const shape = clamp(b.r.sub(wfbm.sub(1.0)).div(float(2.0).sub(wfbm)), 0.0, 1.0);
    // 6. coverage remap
    return clamp(shape.mul(grad).sub(covAmt.oneMinus()).div(max(covAmt, 1e-4)), 0.0, 1.0)
      .mul(covAmt);
  });

  // steps 7-8 -> final density
  const erode8 = Fn(([p, d]) => {
    // 7. detail erosion
    const det = texture3D(noise.detailTex, p.div(P.detailRepeat));
    const dfbm = det.r.mul(0.625).add(det.g.mul(0.25)).add(det.b.mul(0.125));
    const hfE = clamp(p.y.sub(P.base).div(P.top - P.base), 0.0, 1.0);
    const e = mix(dfbm, dfbm.oneMinus(), clamp(hfE.mul(5.0), 0.0, 1.0)).mul(P.erode);
    // 8. final density
    return clamp(d.sub(e).div(e.oneMinus()), 0.0, 1.0);
  });

  return { field, gradAt, shape6, erode8 };
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
export function volCloudsNode({ beauty, depth, camera, uSunDir, uCamPos, uTime, front, noise, aerial }) {
  const P = FRONTS[front] || FRONTS.NELLIS;
  const covQ = covThreshold(noise, P.coverage);
  const density = tslDensityBuilders(noise, P, covQ);
  const topAll = P.towerTop || P.top;
  const uSunE = aerial ? aerial.uSunI : uniform(36.0); // unit-sun -> scene HDR scale

  const uProjInv = uniform(new THREE.Matrix4());
  const uCamWorld = uniform(new THREE.Matrix4());
  if (camera) {
    uProjInv.value.copy(camera.projectionMatrixInverse);
    uCamWorld.value.copy(camera.matrixWorld);
  }
  _camRegistry.push({ uProjInv, uCamWorld });

  return Fn(() => {
    const suv = uv();
    const bg = beauty.sample(suv).toVar();

    // view ray + scene distance from ONE depth unprojection (getViewPosition
    // owns the per-backend NDC-z convention, same as GTAONode)
    const vpos = getViewPosition(suv, depth.sample(suv).r, uProjInv);
    const rel = uCamWorld.mul(vec4(vpos, 1.0)).xyz.sub(uCamPos);
    const sceneDist = max(length(rel), 1e-3).toVar();
    const dir = rel.div(sceneDist).toVar();

    // ray/slab clip: [base, topAll] segment, capped by scene depth + maxLen
    const dy = dir.y;
    const dySafe = select(abs(dy).lessThan(1e-5),
      select(dy.greaterThanEqual(0.0), float(1e-5), float(-1e-5)), dy);
    const tA = float(P.base).sub(uCamPos.y).div(dySafe);
    const tB = float(topAll).sub(uCamPos.y).div(dySafe);
    const tIn = max(min(tA, tB), 0.0).toVar();
    const tOut = min(min(max(tA, tB), sceneDist), tIn.add(P.maxLen)).toVar();
    const hit = and(tOut.greaterThan(tIn), tIn.lessThan(ENTRY_MAX));

    const T = float(1.0).toVar();       // view-path transmittance
    const acc = vec3(0.0).toVar();      // accumulated cloud radiance
    const dsum = float(0.0).toVar();    // transmittance-weighted distance sums
    const wsum = float(0.0).toVar();    //   (for the aerial representative point)

    If(hit, () => {
      // per-pixel per-frame jittered start: IGN + golden-ratio time scroll —
      // TRAA downstream integrates the march noise away
      const ign = fract(fract(screenCoordinate.x.mul(0.06711056)
        .add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189));
      const jit = fract(ign.add(fract(uTime.mul(74.1638))));

      // 40-56 steps scaled by slab length (~STEP_TARGET m per step)
      const nSteps = clamp(tOut.sub(tIn).div(STEP_TARGET), STEPS_MIN, STEPS_MAX).floor().toVar();
      const dt = tOut.sub(tIn).div(nSteps).toVar();
      const t = tIn.add(dt.mul(jit)).toVar();

      // sun geometry — constant per pixel
      const sunN = normalize(uSunDir).toVar();
      const cosT = dot(dir, sunN);
      const phaseV = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3).toVar();
      const sunEl = sunN.y;
      // twilight energy ordering: direct dies just below the horizon, ambient
      // follows the sky down — clouds go dark BEFORE the sky does
      const warm = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.35, sunEl));
      const sunCol = warm.mul(uSunE).mul(smoothstep(-0.02, 0.08, sunEl)).mul(ALBEDO).toVar();
      const ambCol = vec3(0.45, 0.62, 0.95).mul(uSunE).mul(0.05)
        .mul(smoothstep(-0.08, 0.25, sunEl)).toVar();

      Loop({ start: int(0), end: int(nSteps), type: 'int', condition: '<' }, () => {
        const p = uCamPos.add(dir.mul(t)).toVar();
        // staged density: coverage field first (1-2 fetches), base shape and
        // detail erosion only where the previous stage says cloud can exist —
        // empty air is the common case and must stay near-free
        const f = density.field(p).toVar();
        const covAmt = f.x, topL = f.y;
        const grad = density.gradAt(p.y, topL).toVar();
        If(covAmt.mul(grad).greaterThan(1e-3), () => {
          const d6 = density.shape6(p, covAmt, grad).toVar();
          If(d6.greaterThan(0.002), () => {
            const dens = density.erode8(p, d6).toVar();
            If(dens.greaterThan(0.002), () => {
              const sigma = dens.mul(P.sigma);
              const stepT = exp(sigma.mul(dt).negate()).toVar();
              // Beer-Lambert shadow march toward the sun. Approximation: the
              // taps reuse the anchor's coverage field (covRepeat >> tap
              // reach) so each tap is ONE base-shape fetch; the erosion skip
              // over-estimates OD, compensated by SUN_SHADOW_K.
              const od = float(0.0).toVar();
              let prev = 0;
              for (const sd of SUN_TAPS) {
                const sp = p.add(sunN.mul(sd));
                od.addAssign(density.shape6(sp, covAmt, density.gradAt(sp.y, topL))
                  .mul(sd - prev));
                prev = sd;
              }
              const tSun = exp(od.mul(-P.sigma * SUN_SHADOW_K));
              const hfA = clamp(p.y.sub(P.base).div(P.top - P.base), 0.0, 1.0);
              const S = sunCol.mul(tSun).mul(phaseV).add(ambCol.mul(mix(0.35, 1.0, hfA)));
              const w = T.mul(stepT.oneMinus()); // energy this step scatters to the eye
              acc.addAssign(S.mul(w));
              dsum.addAssign(w.mul(t));
              wsum.addAssign(w);
              T.mulAssign(stepT);
            });
          });
        });
        If(T.lessThan(T_MIN), () => { Break(); });
        t.addAssign(dt);
      });
    });

    // aerial perspective at the mean scatter distance: distant clouds sit IN
    // the haze (inscatter weighted by cloud alpha — clear pixels keep the
    // in-material aerial the beauty already carries)
    const alpha = T.oneMinus();
    if (aerial) {
      If(alpha.greaterThan(0.002), () => {
        const wpRep = uCamPos.add(dir.mul(dsum.div(max(wsum, 1e-4)))).toVar();
        acc.assign(acc.mul(aerial.trans(wpRep))
          .add(aerial.ins(wpRep).mul(uSunE).mul(alpha)));
      });
    }

    return vec4(bg.rgb.mul(T).add(acc), 1.0);
  })();
}

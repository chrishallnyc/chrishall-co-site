// FFT ocean — Tessendorf spectral water in TSL compute (MAXFI A4, v1: one
// 256² cascade). createFFTOcean() returns GPU-resident displacement and
// normal/foam maps regenerated per frame by a 19-dispatch compute chain.
// water.js (Gerstner) stays untouched as the WebGL2/LOW fallback. House
// pattern per hillaire.js: the CPU reference (cpuIFFT2D — the same Stockham
// radix the GPU butterflies run, pure JS) and spectrum stats are exported for
// the QA oracle; GPU compute is WebGPU-only and never runs under headless QA.
//
// CONTRACT (game wiring is written against this — do not deviate):
//   createFFTOcean(renderer, { front, N = 256, tileM = 320, seed = 1337 })
//     -> { dispTex, normTex, tileM, N, update(timeSec) } | null
//   dispTex  RGBA16F N×N storage: xyz = displacement meters (x,z horizontal
//            choppy, y up), a unused. RepeatWrapping — sample with
//            uv = worldXZ / tileM (+u = +x world, +v = +z world).
//   normTex  RGBA16F N×N storage: xyz = world-space normal (y-up),
//            a = foam 0..1 (Jacobian whitecaps, accumulated with decay).
//   update(timeSec) submits the compute chain (call once per render frame;
//            zero per-frame JS allocations). First call compiles 19 pipelines
//            through Dawn — warm it once behind the loading veil.
//   Returns null unless renderer.backend.isWebGPUBackend === true
//   (feature-detected defensively; never throws).
//
// SPECTRUM (documented exactly; every magnitude is then PINNED — amplitude
// discipline: the Gerstner baseline's restraint was hard-won, ±12m once read
// as absurd. Shape comes from physics, total variance is normalized so
// Hs = 4·sqrt(m0) hits the front target exactly):
//   VALDEZ (protected fjord, short-fetch wind sea):
//     JONSWAP U10 = 6 m/s, fetch = 20 km, gamma = 3.3, dir = 335°, cos^4
//     spreading, Hs pinned 0.50 m, choppiness 0.8. 1D peak: wp =
//     22·(g²/(U·F))^(1/3) ≈ 2.04 rad/s → λp ≈ 15 m (2D peak ~19 m).
//   MARIANAS (open Pacific, developed wind sea + swell):
//     wind lobe: JONSWAP U10 = 11 m/s, fetch = 800 km (PM-capped: wp =
//       max(fetch law, 0.855·g/U10) = 0.76 rad/s → λp ≈ 106 m), gamma = 2.2,
//       dir = 65°, cos^2 spreading, 55% of variance.
//     swell lobe: Gaussian in |k| at λ0 = 180 m (σk = 0.012 rad/m), dir =
//       40°, cos^48 spreading (narrow), 45% of variance.
//     Hs pinned 2.00 m total, choppiness 1.2.
//   Both wear the small-wave anti-alias cutoff exp(−k²ℓ²), ℓ = ½·(tileM/N),
//   and the 1D frequency spectrum maps to 2D k-space via S(ω)·(dω/dk)/k.
//
// PIPELINE (per frame, 19 dispatches ≤ the 24 budget):
//   1  evolve      h0Tex(k) → ping: ĥ(k,t) = ĥ0(k)e^{iωt} + ĥ0*(−k)e^{−iωt},
//                  ω = √(g|k|), packed into two complex lanes (see PACKING).
//   16 butterflies Stockham radix-2 gather, log2(N) horizontal + log2(N)
//                  vertical, ping↔pong storage textures, both complex lanes
//                  butterflied in the same dispatch. Unnormalized inverse
//                  DFT (Tessendorf's sum h = Σ ĥ e^{ikx} carries no 1/N²).
//   1  disp        unpack + choppiness scale → dispTex.
//   1  normal/foam finite-difference normals from displaced positions
//                  (documented choice: cheaper than 2 extra slope IFFTs and
//                  exact enough at 1.25 m texel pitch), Jacobian foam
//                  J = JxxJzz − JxzJzx with foam = max(prev·decay, new),
//                  foam history in a ping-pong pair (two prebuilt compute
//                  nodes alternate; normTex stays one stable texture).
//
// PACKING (two real signals per complex IFFT — one RGBA texel = 2 complex):
//   lane rg = Ĥ + i·D̂x = Ĥ·(1 + kx/|k|)   (D̂x = −i·(kx/|k|)·Ĥ)
//   lane ba = D̂z + i·0  = −i·(kz/|k|)·Ĥ
//   Both spectra are Hermitian, so after the 2D IFFT: h = Re(rg),
//   Dx = Im(rg), Dz = Re(ba). Three real fields ride ONE complex FFT ladder.
//   FFT scratch (ping/pong) is RGBA32F — 16 chained fp16 butterflies measured
//   too lossy for the Jacobian's finite differences; rgba32float is a core
//   storage-writable format. Outputs stay RGBA16F per contract (rgba16float
//   is also core storage-writable — verified in the vendored r185 build).
//
// TSL compute idiom (r185, verified against the vendored build):
//   Fn(() => { ... textureStore(tex, ivec2, vec4) ... })().compute(N*N)
//   — textureStore auto-.toStack()s and StorageTextureNode defaults to
//   write-only access; renderer.compute() accepts a prebuilt array and
//   batches all dispatches into one submit.

import * as THREE from "three";
import {
  Fn, uniform, textureStore, textureLoad, instanceIndex,
  float, int, uint, vec3, vec4, ivec2,
  sin, cos, sqrt, max, clamp, normalize, cross, select,
} from "three/tsl";

const G = 9.81;

// ---------------------------------------------------------------------------
// Per-front spectra. frac = share of the pinned total variance per lobe.
// ---------------------------------------------------------------------------
const SPECTRA = {
  VALDEZ: {
    hsTarget: 0.5, chop: 0.8,
    foamThresh: 0.72, foamGain: 2.0, foamTauSec: 4.0,
    lobes: [
      { kind: "jonswap", U10: 6.0, fetchKm: 20, gamma: 3.3, dirDeg: 335, spreadPow: 4, frac: 1.0 },
    ],
  },
  MARIANAS: {
    hsTarget: 2.0, chop: 1.2,
    foamThresh: 0.80, foamGain: 2.2, foamTauSec: 6.0,
    lobes: [
      { kind: "jonswap", U10: 11.0, fetchKm: 800, gamma: 2.2, dirDeg: 65, spreadPow: 2, frac: 0.55 },
      { kind: "swell", lambdaM: 180, sigmaK: 0.012, dirDeg: 40, spreadPow: 48, frac: 0.45 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) + Box-Muller — h0 must be identical on every
// machine; Math.random is banned here.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// two independent N(0,1) draws
function gauss2(rand) {
  const u1 = 1 - rand(); // (0,1] — keeps log() finite
  const u2 = rand();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

// unnormalized directional mode density for one lobe at wave vector (kx,kz)
function lobeP(lobe, k, kx, kz) {
  const cosD = (kx * lobe._dx + kz * lobe._dz) / k;
  if (cosD <= 0) return 0; // one-sided: no energy against the wind/swell
  const D = Math.pow(cosD, lobe.spreadPow);
  if (lobe.kind === "swell") {
    const dk = k - lobe._k0;
    return Math.exp(-(dk * dk) / (2 * lobe.sigmaK * lobe.sigmaK)) * (D / k);
  }
  const w = Math.sqrt(G * k);
  const wp = lobe._wp;
  const sig = w <= wp ? 0.07 : 0.09;
  const rr = Math.exp(-((w - wp) * (w - wp)) / (2 * sig * sig * wp * wp));
  const Sw = Math.pow(w, -5) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(lobe.gamma, rr);
  return Sw * (G / (2 * w)) * (D / k); // S(ω)·dω/dk·(1/k): 1D freq → 2D k-space
}

function prepLobes(S) {
  return S.lobes.map((l) => {
    const rad = (l.dirDeg * Math.PI) / 180;
    const out = { ...l, _dx: Math.sin(rad), _dz: Math.cos(rad) };
    if (l.kind === "swell") {
      out._k0 = (2 * Math.PI) / l.lambdaM;
    } else {
      const wFetch = 22 * Math.pow((G * G) / (l.U10 * l.fetchKm * 1000), 1 / 3);
      const wPM = (0.855 * G) / l.U10; // fully-developed floor
      out._wp = Math.max(wFetch, wPM);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// buildH0 — the ONE h0 generator (CPU, seeded). Texel (x,y) holds
// rg = ĥ0(k), ba = ĥ0*(−k) (conjugate mirror pre-baked so the GPU evolve
// pass is a single load). k is in DFT bin order: m = x < N/2 ? x : x−N, so
// the IFFT needs no (−1)^(x+y) sign correction.
// ---------------------------------------------------------------------------
function buildH0(front, N, tileM, seed) {
  const S = SPECTRA[front] || SPECTRA.MARIANAS;
  const lobes = prepLobes(S);
  const nL = lobes.length;
  const dk = (2 * Math.PI) / tileM;
  const half = N / 2;
  const ell = (tileM / N) * 0.5; // small-wave anti-alias cutoff length

  // pass 1: raw analytic density per lobe (for per-lobe variance pinning)
  const Praw = new Float64Array(N * N * nL);
  const sums = new Float64Array(nL);
  for (let y = 0; y < N; y++) {
    const n = y < half ? y : y - N;
    for (let x = 0; x < N; x++) {
      const m = x < half ? x : x - N;
      if (m === 0 && n === 0) continue; // no DC
      // Nyquist row/column has no +N/2 partner bin, which breaks the exact
      // Hermitian symmetry of the −i·(k/|k|)·Ĥ choppy spectra and leaks
      // cross-talk between the packed lanes (caught by the QA oracle at
      // ~3e-4 m). Those are 2-texel waves, 91% killed by the anti-alias
      // cutoff anyway — zero them.
      if (m === -half || n === -half) continue;
      const kx = dk * m, kz = dk * n;
      const k = Math.hypot(kx, kz);
      const supp = Math.exp(-k * k * ell * ell);
      for (let l = 0; l < nL; l++) {
        const p = lobeP(lobes[l], k, kx, kz) * supp;
        Praw[(y * N + x) * nL + l] = p;
        sums[l] += p;
      }
    }
  }

  // pinning: time-averaged variance m0 = 2·Σ|ĥ0(k)|² and E[|ĥ0|²] = P, so
  // per lobe: 2·scale·ΣPraw = frac·(Hs/4)².
  const m0Target = (S.hsTarget / 4) * (S.hsTarget / 4);
  const scale = lobes.map((l, i) => (sums[i] > 0 ? (l.frac * m0Target) / (2 * sums[i]) : 0));

  // pass 2: seeded gaussian draws (fixed row-major order), realized stats,
  // analytic peak tracking
  const rand = mulberry32(seed);
  const tmp = new Float64Array(N * N * 2); // ĥ0 complex, row-major
  let sumAmp2 = 0, peakP = 0, peakK = 0;
  for (let y = 0; y < N; y++) {
    const n = y < half ? y : y - N;
    for (let x = 0; x < N; x++) {
      const m = x < half ? x : x - N;
      const i = y * N + x;
      const [g0, g1] = gauss2(rand); // always draw: stream stays texel-locked
      let P = 0;
      for (let l = 0; l < nL; l++) P += Praw[i * nL + l] * scale[l];
      const amp = Math.sqrt(P / 2); // ĥ0 = (ξr + iξi)·√(P/2)
      tmp[2 * i] = g0 * amp;
      tmp[2 * i + 1] = g1 * amp;
      sumAmp2 += (g0 * g0 + g1 * g1) * amp * amp;
      if (P > peakP) {
        peakP = P;
        peakK = Math.hypot(dk * m, dk * n);
      }
    }
  }

  // pack rg = ĥ0(k), ba = ĥ0*(−k)
  const data = new Float32Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const j = ((N - y) % N) * N + ((N - x) % N);
      data[4 * i] = tmp[2 * i];
      data[4 * i + 1] = tmp[2 * i + 1];
      data[4 * i + 2] = tmp[2 * j];
      data[4 * i + 3] = -tmp[2 * j + 1];
    }
  }

  return {
    data, S,
    significantWaveHeight: 4 * Math.sqrt(2 * sumAmp2),        // realized, from the field
    peakWavelengthM: peakK > 0 ? (2 * Math.PI) / peakK : 0,   // analytic argmax
  };
}

// ---------------------------------------------------------------------------
// cpuSpectrumStats — QA oracle: Hs realized from the h0 field, peak
// wavelength from the discretized analytic spectrum.
// ---------------------------------------------------------------------------
export function cpuSpectrumStats(front, { N = 256, tileM = 320, seed = 1337 } = {}) {
  const b = buildH0(front, N, tileM, seed);
  return { significantWaveHeight: b.significantWaveHeight, peakWavelengthM: b.peakWavelengthM };
}

// ---------------------------------------------------------------------------
// cpuIFFT2D — QA oracle: the EXACT radix the GPU butterflies implement
// (Stockham radix-2 gather, log2(N) horizontal + log2(N) vertical passes),
// pure JS float64. Unnormalized inverse DFT:
//   out[y][x] = Σ_kz Σ_kx in[kz][kx] · e^{+2πi(kx·x + kz·y)/N}
// complexArray: interleaved (re,im), row-major, length 2·N·N. Returns a new
// Float64Array, same layout. N must be a power of two.
// ---------------------------------------------------------------------------
export function cpuIFFT2D(complexArray, N) {
  let src = Float64Array.from(complexArray);
  let dst = new Float64Array(2 * N * N);
  const stages = Math.round(Math.log2(N));
  for (const horizontal of [true, false]) {
    for (let s = 0; s < stages; s++) {
      const p = 1 << s;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const j = horizontal ? x : y;               // index along transform axis
          const q = (j / (2 * p)) | 0, r = j % (2 * p), k = r % p;
          const t = q * p + k;
          const i0 = horizontal ? y * N + t : t * N + x;
          const i1 = horizontal ? y * N + t + N / 2 : (t + N / 2) * N + x;
          const ar = src[2 * i0], ai = src[2 * i0 + 1];
          const br = src[2 * i1], bi = src[2 * i1 + 1];
          const ang = (Math.PI * k) / p;              // inverse: e^{+iπk/p}
          const wc = Math.cos(ang), ws = Math.sin(ang);
          const tr = br * wc - bi * ws, ti = br * ws + bi * wc;
          const sgn = r < p ? 1 : -1;
          const o = 2 * (y * N + x);
          dst[o] = ar + sgn * tr;
          dst[o + 1] = ai + sgn * ti;
        }
      }
      const swap = src; src = dst; dst = swap;
    }
  }
  return src; // 2·log2(N) passes = even swap count: result landed back in src
}

// ---------------------------------------------------------------------------
// createFFTOcean — the GPU pipeline.
// ---------------------------------------------------------------------------
export function createFFTOcean(renderer, { front, N = 256, tileM = 320, seed = 1337 } = {}) {
  try {
    if (!renderer || !renderer.backend || renderer.backend.isWebGPUBackend !== true) return null;
    if (typeof renderer.compute !== "function") return null;
    const log2N = Math.log2(N);
    if (!Number.isInteger(log2N) || N < 8) return null;

    const built = buildH0(front, N, tileM, seed);
    const S = built.S;
    const TEXELS = N * N;
    const halfN = N / 2;
    const dkVal = (2 * Math.PI) / tileM;
    const dxm = tileM / N; // texel pitch in meters

    // -- textures ----------------------------------------------------------
    const h0Tex = new THREE.DataTexture(built.data, N, N, THREE.RGBAFormat, THREE.FloatType);
    h0Tex.needsUpdate = true; // Nearest + flipY:false DataTexture defaults are right

    const makeStorage = (type, repeat) => {
      const t = new THREE.StorageTexture(N, N);
      t.type = type;
      t.generateMipmaps = false;
      t.flipY = false;
      if (repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; // Linear filter default stays
      } else {
        t.minFilter = t.magFilter = THREE.NearestFilter; // scratch: textureLoad only
      }
      return t;
    };
    const pingTex = makeStorage(THREE.FloatType, false);  // FFT scratch: fp32
    const pongTex = makeStorage(THREE.FloatType, false);
    const dispTex = makeStorage(THREE.HalfFloatType, true);
    const normTex = makeStorage(THREE.HalfFloatType, true);
    const foamA = makeStorage(THREE.HalfFloatType, false); // foam history pair
    const foamB = makeStorage(THREE.HalfFloatType, false);

    // -- uniforms ----------------------------------------------------------
    const uTime = uniform(0);
    const uFoamDecay = uniform(1);

    const texelOf = () => {
      const x = instanceIndex.mod(uint(N)).toVar();
      const y = instanceIndex.div(uint(N)).toVar();
      return { x, y, coord: ivec2(int(x), int(y)) };
    };

    // -- pass 1: time evolution + lane packing ------------------------------
    const evolve = Fn(() => {
      const { x, y, coord } = texelOf();
      const mx = select(x.lessThan(uint(halfN)), int(x), int(x).sub(int(N)));
      const mz = select(y.lessThan(uint(halfN)), int(y), int(y).sub(int(N)));
      const kx = float(mx).mul(dkVal).toVar();
      const kz = float(mz).mul(dkVal).toVar();
      const kLen = sqrt(kx.mul(kx).add(kz.mul(kz))).toVar();
      const kInv = select(kLen.greaterThan(1e-6), float(1.0).div(kLen), float(0.0)).toVar();
      const h0 = textureLoad(h0Tex, coord).toVar(); // rg = ĥ0(k), ba = ĥ0*(−k)
      const wt = sqrt(kLen.mul(G)).mul(uTime).toVar();
      const c = cos(wt).toVar(), s = sin(wt).toVar();
      // Ĥ(k,t) = ĥ0(k)·e^{iωt} + ĥ0*(−k)·e^{−iωt}
      const hr = h0.x.mul(c).sub(h0.y.mul(s)).add(h0.z.mul(c)).add(h0.w.mul(s)).toVar();
      const hi = h0.x.mul(s).add(h0.y.mul(c)).sub(h0.z.mul(s)).add(h0.w.mul(c)).toVar();
      const f1 = kx.mul(kInv).add(1.0);  // lane rg = Ĥ·(1 + kx/|k|) = Ĥ + i·D̂x
      const g = kz.mul(kInv);            // lane ba = −i·(kz/|k|)·Ĥ = D̂z
      textureStore(pingTex, coord, vec4(hr.mul(f1), hi.mul(f1), hi.mul(g), hr.mul(g).negate()));
    })().compute(TEXELS);

    // -- passes 2..17: Stockham radix-2 gather butterflies -------------------
    // per output j: q = j/(2p), r = j%(2p), k = r%p, t = q·p+k;
    // out = src[t] ± e^{+iπk/p}·src[t+N/2]  (+ for r<p) — both lanes at once.
    const makeButterfly = (src, dst, p, horizontal) => Fn(() => {
      const { x, y, coord } = texelOf();
      const j = horizontal ? x : y;
      const q = j.div(uint(2 * p)).toVar();
      const r = j.mod(uint(2 * p)).toVar();
      const k = r.mod(uint(p)).toVar();
      const t = q.mul(uint(p)).add(k).toVar();
      const t2 = t.add(uint(halfN)).toVar();
      const c0 = horizontal ? ivec2(int(t), int(y)) : ivec2(int(x), int(t));
      const c1 = horizontal ? ivec2(int(t2), int(y)) : ivec2(int(x), int(t2));
      const u0 = textureLoad(src, c0).toVar();
      const u1 = textureLoad(src, c1).toVar();
      const ang = float(k).mul(Math.PI / p).toVar();
      const wc = cos(ang).toVar(), ws = sin(ang).toVar();
      const re = u1.xz.mul(wc).sub(u1.yw.mul(ws)).toVar(); // both lanes: complex mul
      const im = u1.xz.mul(ws).add(u1.yw.mul(wc)).toVar();
      const sgn = select(r.lessThan(uint(p)), float(1.0), float(-1.0));
      textureStore(dst, coord, u0.add(vec4(re.x, im.x, re.y, im.y).mul(sgn)));
    })().compute(TEXELS);

    const fftPasses = [];
    let cur = pingTex, nxt = pongTex;
    for (const horizontal of [true, false]) {
      for (let s = 0; s < log2N; s++) {
        fftPasses.push(makeButterfly(cur, nxt, 1 << s, horizontal));
        const swap = cur; cur = nxt; nxt = swap;
      }
    }
    const finalTex = cur; // parity-safe: wherever the last butterfly landed

    // -- pass 18: unpack + choppiness → dispTex ------------------------------
    const chop = S.chop;
    const dispPass = Fn(() => {
      const { coord } = texelOf();
      const v = textureLoad(finalTex, coord).toVar(); // (h, Dx, Dz, ~0)
      textureStore(dispTex, coord, vec4(v.y.mul(chop), v.x, v.z.mul(chop), 0.0));
    })().compute(TEXELS);

    // -- pass 19: finite-difference normals + Jacobian foam ------------------
    // Central differences of the displaced positions (choppy included, so the
    // Jacobian sees the final geometry). Foam history ping-pongs A↔B via two
    // prebuilt nodes; normTex is written every frame and stays stable.
    const makeNormalPass = (foamSrc, foamDst) => Fn(() => {
      const { x, y, coord } = texelOf();
      const xe = ivec2(int(x.add(uint(1)).mod(uint(N))), int(y));
      const xw = ivec2(int(x.add(uint(N - 1)).mod(uint(N))), int(y));
      const zs = ivec2(int(x), int(y.add(uint(1)).mod(uint(N))));
      const zn = ivec2(int(x), int(y.add(uint(N - 1)).mod(uint(N))));
      const dE = textureLoad(dispTex, xe).toVar();
      const dW = textureLoad(dispTex, xw).toVar();
      const dS = textureLoad(dispTex, zs).toVar();
      const dN = textureLoad(dispTex, zn).toVar();
      const T = vec3(float(2 * dxm).add(dE.x.sub(dW.x)), dE.y.sub(dW.y), dE.z.sub(dW.z)).toVar();
      const B = vec3(dS.x.sub(dN.x), dS.y.sub(dN.y), float(2 * dxm).add(dS.z.sub(dN.z))).toVar();
      const nrm = normalize(cross(B, T)).toVar(); // flat sea → +y
      const inv2 = 1 / (2 * dxm);
      const jxx = dE.x.sub(dW.x).mul(inv2).add(1.0);
      const jzz = dS.z.sub(dN.z).mul(inv2).add(1.0);
      const jxz = dS.x.sub(dN.x).mul(inv2);
      const jzx = dE.z.sub(dW.z).mul(inv2);
      const J = jxx.mul(jzz).sub(jxz.mul(jzx)).toVar();
      const fresh = clamp(float(S.foamThresh).sub(J).mul(S.foamGain), 0.0, 1.0);
      const prev = textureLoad(foamSrc, coord).x;
      const foam = max(prev.mul(uFoamDecay), fresh).toVar();
      textureStore(normTex, coord, vec4(nrm, foam));
      textureStore(foamDst, coord, vec4(foam, 0.0, 0.0, 0.0));
    })().compute(TEXELS);

    const base = [evolve, ...fftPasses, dispPass];
    const passesEven = [...base, makeNormalPass(foamA, foamB)];
    const passesOdd = [...base, makeNormalPass(foamB, foamA)];

    // -- per-frame driver (no allocations) -----------------------------------
    let lastT = null, frame = 0;
    const update = (timeSec) => {
      uTime.value = timeSec;
      const dt = lastT === null ? 1 / 60 : Math.min(Math.max(timeSec - lastT, 0), 0.25);
      lastT = timeSec;
      uFoamDecay.value = Math.exp(-dt / S.foamTauSec);
      renderer.compute(frame & 1 ? passesOdd : passesEven);
      frame++;
    };

    return { dispTex, normTex, tileM, N, update };
  } catch (err) {
    return null; // contract: feature-detect defensively, never throw
  }
}

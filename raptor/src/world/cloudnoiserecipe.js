// Deterministic cloud render asset recipe. Frequencies/feature points are
// independent of raster resolution. No sim RNG, network, or browser APIs.
// Canonical 128^3 normalization preserves existing 128/64 output byte for byte.
export const CLOUD_NOISE_VERSION = 1;
export const CLOUD_JITTER_N = 128;
export const CLOUD_NOISE_SIZES = Object.freeze({
  standard: Object.freeze({ baseN: 128, detailN: 64 }),
  high: Object.freeze({ baseN: 192, detailN: 96 }),
  ultra: Object.freeze({ baseN: 256, detailN: 128 }),
});
// Physical field coordinates remain unchanged when the texture gets denser.
export const CLOUD_COV_SLICE = 64.5 / 128;
export const CLOUD_TOWER_SLICE = 32.5 / 64;

export function mulberry32(seed) {
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
function worleyField(N, F, pts) {
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

function perlinFbmField(N, F0, octaves, tables) {
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
function worley2D(N, F, pts) {
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

const byte = v => Math.max(0, Math.min(255, Math.round(v * 255)));
const dilate = (p, w) => Math.max(0, Math.min(1, (p - (w - 1)) / (2 - w)));

export function cloudNoiseSize(options = {}) {
  const size = CLOUD_NOISE_SIZES[options.resolution || "standard"];
  if (!size) throw new RangeError("Unknown cloud-noise resolution");
  const baseN = options.baseN ?? size.baseN, detailN = options.detailN ?? size.detailN;
  if (!Object.values(CLOUD_NOISE_SIZES).some(s => s.baseN === baseN && s.detailN === detailN)) {
    throw new RangeError("Cloud-noise sizes must be 128/64, 192/96 or 256/128");
  }
  return { baseN, detailN, resolution: baseN === 256 ? "ultra" : baseN === 192 ? "high" : "standard" };
}

export function prepareCloudNoiseRecipe(seed = 1337) {
  const rnd = mulberry32(seed);
  const points = (F, dimensions) => Float64Array.from({ length: F ** dimensions * dimensions }, rnd);
  // Keep the exact original draw order, including rejected gradient vectors.
  return {
    seed: seed >>> 0,
    base: [points(8, 3), points(16, 3), points(32, 3)],
    perlin: [perlinGrads(4, rnd), perlinGrads(8, rnd), perlinGrads(16, rnd)],
    detail: [points(2, 3), points(4, 3), points(8, 3)],
    tower: points(2, 2),
  };
}

function canonicalRange(w, p) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < w.length; i++) {
    const v = dilate(p[i], w[i]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}

export function bakeCloudNoiseData(seed = 1337, options = {}) {
  const { baseN: N, detailN: D, resolution } = cloudNoiseSize(options);
  const recipe = prepareCloudNoiseRecipe(seed);
  // Always use the existing physical field's 128^3 range. Re-normalizing at
  // 256^3 would change density everywhere just because more extrema are found.
  let w = worleyField(128, 8, recipe.base[0]);
  let p = perlinFbmField(128, 4, 3, recipe.perlin);
  const normalization = canonicalRange(w, p);
  const stretch = normalization.hi > normalization.lo ? 1 / (normalization.hi - normalization.lo) : 1;
  if (N !== 128) {
    w = worleyField(N, 8, recipe.base[0]);
    p = perlinFbmField(N, 4, 3, recipe.perlin);
  }
  const baseData = new Uint8Array(N ** 3 * 4);
  for (let i = 0; i < w.length; i++) {
    // The old intermediate raw-R array was Float32, so preserve its rounding.
    baseData[i * 4] = byte((Math.fround(dilate(p[i], w[i])) - normalization.lo) * stretch);
    baseData[i * 4 + 1] = byte(w[i]);
  }
  w = p = null;
  // Pack/release one channel at a time: the offline Ultra bake need not hold
  // four 64 MiB fields plus its output and an extra raw-R field concurrently.
  for (let c = 1; c < 3; c++) {
    const field = worleyField(N, 8 << c, recipe.base[c]);
    for (let i = 0; i < field.length; i++) baseData[i * 4 + c + 1] = byte(field[i]);
  }
  const detailData = new Uint8Array(D ** 3 * 4);
  for (let c = 0; c < 3; c++) {
    const field = worleyField(D, 2 << c, recipe.detail[c]);
    for (let i = 0; i < field.length; i++) detailData[i * 4 + c] = byte(field[i]);
  }
  const tower = worley2D(D, 2, recipe.tower);
  for (let z = 0; z < D; z++) for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    detailData[((z * D + y) * D + x) * 4 + 3] = byte(tower[z * D + x]);
  }
  return {
    version: CLOUD_NOISE_VERSION, seed: seed >>> 0, resolution,
    baseN: N, detailN: D, baseData, detailData, normalization,
    coverageSlice: CLOUD_COV_SLICE, towerSlice: CLOUD_TOWER_SLICE,
  };
}

// Continuous reference field for offline resolution error measurements.
// This is never part of the renderer's density recipe or frame loop.
export function sampleCloudNoiseField(recipe, normalization, u, v, w) {
  const wrap = (i, n) => ((i % n) + n) % n;
  const worley = (F, pts, dimensions = 3) => {
    const p = [u * F, v * F, w * F], cell = p.map(Math.floor);
    let nearest = Infinity;
    for (let dz = dimensions === 3 ? -1 : 0; dz <= (dimensions === 3 ? 1 : 0); dz++) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = [cell[0] + dx, cell[1] + dy, cell[2] + dz];
        const j = (dimensions === 3 ? (wrap(a[2], F) * F + wrap(a[1], F)) * F + wrap(a[0], F)
          : wrap(a[1], F) * F + wrap(a[0], F)) * dimensions;
        let d = 0;
        for (let i = 0; i < dimensions; i++) d += (a[i] + pts[j + i] - p[i]) ** 2;
        nearest = Math.min(nearest, d);
      }
    }
    return Math.max(0, 1 - Math.sqrt(nearest));
  };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  let sum = 0;
  for (let o = 0; o < 3; o++) {
    const F = 4 << o, g = recipe.perlin[o];
    const pos = [u * F, v * F, w * F], floor = pos.map(Math.floor);
    const f = pos.map((x, i) => x - floor[i]), s = f.map(fade);
    let acc = 0;
    for (let c = 0; c < 8; c++) {
      const a = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
      const gi = ((wrap(floor[2] + a[2], F) * F + wrap(floor[1] + a[1], F)) * F + wrap(floor[0] + a[0], F)) * 3;
      const d = g[gi] * (f[0] - a[0]) + g[gi + 1] * (f[1] - a[1]) + g[gi + 2] * (f[2] - a[2]);
      acc += d * a.reduce((weight, x, i) => weight * (x ? s[i] : 1 - s[i]), 1);
    }
    sum += acc / (1 << o);
  }
  const baseW = [8, 16, 32].map((F, i) => worley(F, recipe.base[i]));
  const perlin = .5 + sum / 1.75 * .75;
  const r = (dilate(perlin, baseW[0]) - normalization.lo) / (normalization.hi - normalization.lo);
  const base = [Math.max(0, Math.min(1, r)), ...baseW];
  const detail = [2, 4, 8].map((F, i) => worley(F, recipe.detail[i]));
  // Tower is the same 2D field over (u,w), not (u,v).
  const oldV = v;
  v = w;
  detail.push(worley(2, recipe.tower, 2));
  v = oldV;
  return { base, detail };
}

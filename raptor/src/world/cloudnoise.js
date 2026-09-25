import * as THREE from "three";
import { decodeCloudNoise, CLOUD_NOISE_ENCODING } from "./cloudnoiseencoding.js";
import {
  bakeCloudNoiseData, cloudNoiseSize, mulberry32, CLOUD_NOISE_VERSION,
  CLOUD_COV_SLICE, CLOUD_TOWER_SLICE, CLOUD_JITTER_N as JITTER_N,
} from "./cloudnoiserecipe.js";

function make3DTexture(bytes, N) {
  const tex = new THREE.Data3DTexture(bytes, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeJitterTexture(seed) {
  const random = mulberry32(seed ^ 0x5bd1e995);
  const n = JITTER_N;
  const white = Float32Array.from({ length: n * n }, random);
  const score = new Float32Array(n * n);
  const order = Array.from({ length: n * n }, (_, i) => i);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) neighbors += white[((y + dy + n) % n) * n + (x + dx + n) % n];
        }
      }
      score[y * n + x] = white[y * n + x] - neighbors / 8;
    }
  }
  order.sort((a, b) => score[a] - score[b]);
  const data = new Uint8Array(n * n * 4);
  for (let rank = 0; rank < order.length; rank++) {
    const i = order[rank] * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.floor(rank * 256 / order.length);
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function cloudNoiseFromData(data) {
  const size = cloudNoiseSize(data);
  if (data.baseData.length !== size.baseN ** 3 * 4 || data.detailData.length !== size.detailN ** 3 * 4) {
    throw new Error("Invalid cloud-noise byte count");
  }
  return {
    ...data, ...size,
    coverageSlice: CLOUD_COV_SLICE, towerSlice: CLOUD_TOWER_SLICE,
    baseTex: make3DTexture(data.baseData, size.baseN),
    detailTex: make3DTexture(data.detailData, size.detailN),
    jitterTex: makeJitterTexture(data.seed),
  };
}

// Explicit synchronous bake, suitable for the small fallback or offline tools.
// Runtime Ultra selection goes through loadCloudNoise: never bake 256^3 on boot.
export function makeCloudNoise(seed = 1337, options = {}) {
  return cloudNoiseFromData(bakeCloudNoiseData(seed, options));
}

const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  b => b.toString(16).padStart(2, "0")).join("");

async function loadAssetAttempt(baseURL, seed, resolution, signal) {
  const size = cloudNoiseSize({ resolution });
  const manifestURL = new URL(`${seed >>> 0}-${resolution}.json`, baseURL);
  const response = await fetch(manifestURL, { signal });
  if (!response.ok) throw new Error(`Cloud-noise manifest HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.version !== CLOUD_NOISE_VERSION || manifest.seed !== (seed >>> 0)
    || manifest.baseN !== size.baseN || manifest.detailN !== size.detailN || manifest.encoding !== CLOUD_NOISE_ENCODING
    || manifest.coverageSlice !== CLOUD_COV_SLICE || manifest.towerSlice !== CLOUD_TOWER_SLICE
    || !Number.isFinite(manifest.normalization?.lo) || !Number.isFinite(manifest.normalization?.hi)
    || manifest.normalization.hi <= manifest.normalization.lo) {
    throw new Error("Cloud-noise manifest recipe mismatch");
  }
  const read = async (entry, n, filename) => {
    const expected = n ** 3 * 4;
    // Dimensions are trusted constants; downloaded metadata cannot grow an
    // arbitrary texture allocation or redirect these assets to another origin.
    if (entry?.bytes !== expected || entry.file !== filename || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Invalid cloud-noise asset descriptor");
    }
    const r = await fetch(new URL(filename, manifestURL), { signal });
    if (!r.ok) throw new Error(`Cloud-noise asset HTTP ${r.status}`);
    let bytes = new Uint8Array(await r.arrayBuffer());
    // Accommodate both ordinary .gz static files and a server which already
    // inflated them through Content-Encoding. Verify decoded bytes either way.
    if (bytes.length !== expected) {
      if (typeof DecompressionStream === "undefined") throw new Error("Gzip decompression unavailable");
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      // Stop an invalid/corrupted expanding file at the exact bounded raw size.
      const reader = stream.getReader(), decoded = new Uint8Array(expected);
      let offset = 0;
      try {
        for (;;) {
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (offset + value.length > expected) throw new Error("Cloud-noise decoded data exceeds expected size");
          decoded.set(value, offset); offset += value.length;
        }
      } finally {
        await reader.cancel();
      }
      if (offset !== expected) throw new Error("Truncated cloud-noise data");
      bytes = decoded;
    }
    signal?.throwIfAborted();
    decodeCloudNoise(bytes, n);
    if (await sha256(bytes) !== entry.sha256) throw new Error("Cloud-noise checksum mismatch");
    return bytes;
  };
  const prefix = `${seed >>> 0}-${resolution}`;
  const [baseData, detailData] = await Promise.all([
    read(manifest.base, size.baseN, `${prefix}-base.rgba8.d3.gz`),
    read(manifest.detail, size.detailN, `${prefix}-detail.rgba8.d3.gz`),
  ]);
  return cloudNoiseFromData({
    ...size, version: CLOUD_NOISE_VERSION, seed: seed >>> 0, normalization: manifest.normalization,
    baseData, detailData, source: "asset",
  });
}

// Cancel a sibling fetch/decode when one channel fails before trying fallback.
async function loadAsset(baseURL, seed, resolution, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try { return await loadAssetAttempt(baseURL, seed, resolution, controller.signal); }
  finally {
    controller.abort();
    signal?.removeEventListener("abort", cancel);
  }
}

export async function loadCloudNoise({
  seed = 1337, resolution = "standard",
  baseURL = new URL("../../assets/cloudnoise/", import.meta.url),
  signal, fallback = true, onFallback,
} = {}) {
  cloudNoiseSize({ resolution });
  const directory = new URL(baseURL, import.meta.url);
  if (!directory.pathname.endsWith("/")) throw new Error("Cloud-noise baseURL must be a directory");
  const attempts = resolution === "ultra" && fallback ? ["ultra", "standard"] : [resolution];
  let lastError;
  for (const target of attempts) {
    try { return await loadAsset(directory, seed, target, signal); }
    catch (error) {
      if (signal?.aborted || !fallback) throw error;
      lastError = error;
      onFallback?.({ from: target, to: target === "ultra" ? "standard asset" : "standard bake", error });
    }
  }
  // The original 128/64 generator is the final offline/missing-asset fallback.
  // Returning the actual resolution lets the caller report a degraded choice.
  const noise = makeCloudNoise(seed);
  noise.source = "bake";
  noise.fallbackReason = lastError?.message;
  return noise;
}

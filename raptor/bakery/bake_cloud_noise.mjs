// Run from any directory: node raptor/bakery/bake_cloud_noise.mjs [standard|high|ultra] [seed]
// Reproducible local source assets; no network or external texture input.
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { bakeCloudNoiseData } from "../src/world/cloudnoiserecipe.js";
import { encodeCloudNoise, CLOUD_NOISE_ENCODING } from "../src/world/cloudnoiseencoding.js";

const resolution = process.argv[2] || "standard";
const seed = process.argv[3] === undefined ? 1337 : Number(process.argv[3]);
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be an unsigned 32-bit integer");
const start = performance.now();
const data = bakeCloudNoiseData(seed, { resolution });
const manifest = { version: data.version, seed, resolution: data.resolution,
  baseN: data.baseN, detailN: data.detailN, coverageSlice: data.coverageSlice,
  towerSlice: data.towerSlice, normalization: data.normalization };
const directory = new URL("../assets/cloudnoise/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const channel of ["base", "detail"]) {
  const bytes = data[channel + "Data"];
  const file = `${seed}-${data.resolution}-${channel}.rgba8.d3.gz`;
  const encoded = encodeCloudNoise(bytes, data[channel + "N"]);
  const compressed = gzipSync(encoded, { level: 6 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(new URL(file, directory), compressed);
  manifest[channel] = { file, bytes: bytes.length, sha256 };
  console.log(JSON.stringify({ resolution, channel, rawBytes: bytes.length, gzipBytes: compressed.length, sha256 }));
}
manifest.encoding = CLOUD_NOISE_ENCODING;
await writeFile(new URL(`${seed}-${data.resolution}.json`, directory), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ elapsedMs: performance.now() - start, manifest: `${seed}-${data.resolution}.json` }));

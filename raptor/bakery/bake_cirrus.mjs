// Run: node raptor/bakery/bake_cirrus.mjs --size=8192 (or --size=2048)
// Original deterministic 2048²/8192² R8 optical-density atlases. Offline only;
// no photographs, external textures, runtime baking, or network input.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const N = Number(args.get('size') || 8192);
if (![2048, 8192].includes(N)) throw new RangeError('Cirrus size must be 2048 or 8192');
const BASE = 2048, SCALE = N / BASE;
const RECIPE = Object.freeze({
  version: 4,
  seed: 0x5e173801,
  patches: 38,
  veilScale: 1.85,
  targetMean: .0075,
  fineFibres: N === 8192,
});
const directory = new URL(args.get('output') || '../assets/clouds/', import.meta.url);

function rng(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}

const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoother(x - ix), fy = smoother(y - iy);
  return mix(mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx), fy);
}

function normal(random) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-8, random()))) * Math.cos(2 * Math.PI * random());
}

function moisturePatches() {
  const random = rng(RECIPE.seed), range = (a, b) => a + (b - a) * random();
  // Uneven moisture regions create groups and clear gaps. Thin packets are
  // elongated at constant area instead of forming isolated cotton-like ovals.
  const groups = Array.from({ length: 8 }, () => ({
    x: range(0, BASE), y: range(0, BASE), angle: range(-.7, .65),
  }));
  const patches = [];
  for (let i = 0; i < RECIPE.patches; i++) {
    const group = groups[Math.floor(random() * groups.length)];
    let w = range(18, 67), l = range(48, 155) * (random() < .18 ? 1.65 : 1);
    const angle = group.angle + range(-.30, .30);
    if (l / w < 2.8) {
      const area = l * w;
      l = Math.sqrt(area * 2.8);
      w = area / l;
    }
    patches.push({
      x: (group.x + normal(random) * 155 + BASE * 4) % BASE,
      y: (group.y + normal(random) * 105 + BASE * 4) % BASE,
      l, w, angle, c: Math.cos(angle), s: Math.sin(angle),
      seed: i * 73 + RECIPE.seed,
      opacity: range(.16, .42), bend: range(-.24, .24) * w,
    });
    // Preserve the recipe's deterministic random stream. These draws were
    // reserved for cell-source positions; fall streaks use a separate stream.
    range(-.35, .05);
    range(-.25, .25);
  }
  return patches;
}

function brokenVeils(patches) {
  const field = new Float32Array(N * N);
  for (const p of patches) {
    const extent = Math.ceil((p.l * 1.6 + p.w * 2.4) * SCALE);
    const x0 = Math.floor(p.x * SCALE - extent), y0 = Math.floor(p.y * SCALE - extent);
    for (let dy = 0; dy < extent * 2; dy++) for (let dx = 0; dx < extent * 2; dx++) {
      const x = (x0 + dx + .5) / SCALE - p.x, y = (y0 + dy + .5) / SCALE - p.y;
      const u = x * p.c + y * p.s, v = -x * p.s + y * p.c, un = u / p.l;
      if (Math.abs(un) > 1.65) continue;
      // Slowly varying independent shear, with no global sine warp or spine.
      const warp = (noise(un * .9 + 14, v / p.w * .65 + 9, p.seed) - .5) * p.w * .35;
      const vv = v - p.bend * un * un - warp;
      const moisture = Math.pow(noise(un * 2.3 + 19, vv / p.w * 1.8 - 4, p.seed + 13), 1.4);
      const envelope = Math.exp(-Math.pow(Math.abs(un) / .88, 3.2)
        - Math.pow(Math.abs(vv) / (p.w * (.72 + .25 * un)), 2.4)) * moisture;
      if (envelope < .001) continue;
      const turbulentV = vv + (noise(u / 105 + 17, vv / 42 - 8, p.seed + 3) - .5) * 6
        + (noise(u / 27 - 7, vv / 17 + 4, p.seed + 29) - .5) * 1.2;
      const independentShear = (noise(vv / p.w * 1.1 + 7, un * .7 - 8, p.seed + 47) - .5) * u * .15;
      // Unequal fibrous scales retain a continuous veil without cell contours.
      const a = noise(u / 42 + 9, turbulentV / 3.1 - 5, p.seed + 7);
      const b = noise(u / 17 - 3, (turbulentV + independentShear) / 1.7 + 7, p.seed + 11);
      const c = noise(u / 6 + 8, (turbulentV - independentShear * .5) / 1.1 + 2, p.seed + 17);
      // The 8K tier resolves a second family of ice-crystal filaments at
      // 29 m across / 190 m along. Two texels across its smallest lattice
      // cell keeps this structure sampleable before the runtime mip filter.
      const d = RECIPE.fineFibres
        ? noise(u / 3.2 - 19, (turbulentV + independentShear * .25) / .50 + 13, p.seed + 53)
        : .5;
      const fibres = .26 * a + .44 * b + .30 * c;
      const soft = Math.pow(.62 * noise(u / 39 - 4, vv / 19 + 19, p.seed + 37)
        + .38 * noise(u / 13 + 17, vv / 9 + 3, p.seed + 41), 1.85);
      const filament = RECIPE.fineFibres ? .35 + 1.65 * Math.pow(d, 1.5) : 1;
      const density = envelope * p.opacity * soft * (.32 + 1.85 * Math.pow(fibres, 1.4)) * filament * RECIPE.veilScale;
      field[((y0 + dy + N * 4) % N) * N + (x0 + dx + N * 4) % N] += density;
    }
  }
  return field;
}

function brush(field, x, y, sigma, strength) {
  x *= SCALE; y *= SCALE; sigma *= SCALE;
  const reach = Math.ceil(sigma * 2.8), ix = Math.floor(x), iy = Math.floor(y);
  for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
    const dx = ix + ox + .5 - x, dy = iy + oy + .5 - y;
    const weight = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    if (weight > .01) field[((iy + oy + N * 4) % N) * N + (ix + ox + N * 4) % N] += weight * strength;
  }
}

function fallStreaks(patches, field) {
  const random = rng(RECIPE.seed + 113), range = (a, b) => a + (b - a) * random();
  for (const p of patches) {
    const cells = 2 + Math.floor(random() * 4);
    for (let cell = 0; cell < cells; cell++) {
      const sx = normal(random) * p.l * .26, sy = normal(random) * p.w * .46;
      const radius = range(3, 11), length = p.l * range(.25, .9), bend = range(-.15, .45) * p.w;
      const heading = range(-.15, .15), fibres = 12 + Math.floor(random() * 26);
      for (let f = 0; f < fibres; f++) {
        const birth = range(-.18, .28), death = range(.38, 1), offset = normal(random) * radius;
        const along = normal(random) * radius * .8, width = range(.75, 2.3);
        const strength = p.opacity * range(.012, .042), fall = range(.25, 1.3);
        const microSeed = Math.floor(range(1, 1e6));
        const steps = Math.ceil((death - birth) * length / 1.3);
        for (let k = 0; k <= steps; k++) {
          const t = birth + (death - birth) * k / steps, age = k / steps;
          const u = sx + along + t * length;
          const v = sy + offset * (1 - .30 * age) + heading * t * length + bend * t * t * fall
            + (noise(t * 3 + 17, offset * .06, microSeed) - .5) * width * 2;
          const px = p.x + u * p.c - v * p.s, py = p.y + u * p.s + v * p.c;
          // Independent starts, ends and widths prevent regularly spaced teeth.
          const gate = Math.pow(Math.sin(Math.PI * age), 1.35)
            * (.20 + .8 * noise(t * 5 + 2, offset * .13 + 5, p.seed + cell * 11));
          brush(field, px, py, width * (1.2 - .6 * age), strength * gate);
        }
      }
    }
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const v of body) crc = crcTable[(crc ^ v) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function png(data) {
  const header = Buffer.alloc(13), raw = Buffer.alloc(N * (N + 1));
  header.writeUInt32BE(N, 0);
  header.writeUInt32BE(N, 4);
  header[8] = 8; // 8-bit grayscale, PNG color type zero.
  for (let y = 0; y < N; y++) Buffer.from(data.buffer, data.byteOffset + y * N, N).copy(raw, y * (N + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const patches = moisturePatches(), field = brokenVeils(patches);
fallStreaks(patches, field);
// An offline density budget prevents shape changes from silently adding light.
// Continuous rolloff retains low-density veil and filtered soft terminations.
let gainLo = 0, gainHi = 12;
for (let i = 0; i < 20; i++) {
  const gain = (gainLo + gainHi) / 2;
  let sum = 0;
  for (const v of field) sum += -Math.expm1(-v * gain);
  if (sum / field.length > RECIPE.targetMean) gainHi = gain;
  else gainLo = gain;
}
const encodingGain = (gainLo + gainHi) / 2;
const density = Uint8Array.from(field, v => Math.round(255 * (-Math.expm1(-v * encodingGain))));
const bytes = png(density), sha256 = data => createHash('sha256').update(data).digest('hex');
const histogram = new Uint32Array(256);
for (const v of density) histogram[v]++;
let accumulated = 0, p99 = 0;
for (; p99 < 255; p99++) {
  accumulated += histogram[p99];
  if (accumulated >= density.length * .99) break;
}
const manifest = {
  file: N === 8192 ? 'cirrus-density-8k.png' : 'cirrus-density.png', generator: 'bakery/bake_cirrus.mjs', referenceGrid: BASE, recipe: { ...RECIPE, encodingGain },
  width: N, height: N, channels: 1, format: 'R8', bytes: bytes.length,
  sha256: sha256(bytes), decodedSha256: sha256(density),
  mean: density.reduce((sum, v) => sum + v, 0) / density.length / 255,
  coverageAbove8: histogram.slice(9).reduce((sum, v) => sum + v, 0) / density.length,
  coverageAbove32: histogram.slice(33).reduce((sum, v) => sum + v, 0) / density.length,
  p99, maximum: histogram.findLastIndex(n => n > 0),
  sampling: { flipY: false, wrap: 'repeat', periodM: 120000, altitudeM: 10000,
    windMetersPerSecond: [18, 7], opticalDepthScale: .22 },
  provenance: 'Original procedural field; no photographic pixels or external bitmap input.',
};
mkdirSync(directory, { recursive: true });
writeFileSync(new URL(manifest.file, directory), bytes);
writeFileSync(new URL(manifest.file.replace('.png', '.json'), directory), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ file: manifest.file, bytes: manifest.bytes, sha256: manifest.sha256,
  decodedSha256: manifest.decodedSha256, mean: manifest.mean }));

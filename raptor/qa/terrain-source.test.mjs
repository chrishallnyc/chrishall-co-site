// Portable scalar/ownership regression checks. Native shader/image evidence
// is maintained separately; these tests need only Node and pinned Three.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {TerrainSourceField} from '../src/world/terrainfield.js';
import {Terrain} from '../src/world/terrain.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const width = 8, packed = new Uint8Array(width * width * 2);
  const normals = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < width; row++) for (let col = 0; col < width; col++) {
    const q = 240 + col * 257 + row * 131, k = (row * width + col) * 2;
    packed[k] = q >> 8; packed[k + 1] = q & 255;
  }
  const meta = {front: 'VALDEZ', width, height: width, minH: 100, maxH: 165.535,
    worldBounds: {xmin: -16, xmax: 16, zmin: -16, zmax: 16}, blendWidthM: 4,
    heightFile: 'h.png', normalFile: 'n.png', heightPackedSHA256: sha(packed),
    normalPixelsSHA256: sha(normals)};
  return {meta, packed, normals};
}

test('source scalar interpolation preserves centers, orientation and byte carries', () => {
  const {meta, packed, normals} = fixture(), field = new TerrainSourceField(meta, packed, normals);
  const h = (col, row) => 100 + (240 + col * 257 + row * 131) / 1000;
  try {
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      assert.ok(Math.abs(field.sourceHeightAt(-14 + col * 4, 14 - row * 4) - h(col, row)) < 1e-12);
    }
    assert.ok(Math.abs(field.sourceHeightAt(-11, 13) - h(.75, .25)) < 1e-12);
    assert.ok(Math.abs(field.sourceHeightAt(0, 0) - h(3.5, 3.5)) < 1e-12);
    assert.equal(field.sourceHeightAt(-100, 100), h(0, 0));
    assert.equal(field.sourceHeightAt(100, -100), h(7, 7));
    assert.equal(field.heightTexture.image.data, packed);
    assert.equal(field.normalTexture.image.data, normals);
  } finally { field.dispose(); }
});

test('collar weight and derivative join the base continuously, including corners', () => {
  const {meta, packed, normals} = fixture(), field = new TerrainSourceField(meta, packed, normals);
  const base = (x, z) => 90 + x * .02 - z * .03, epsilon = 1e-4;
  try {
    for (const [x, z] of [[-16, 0], [16, 0], [0, -16], [0, 16], [-16, -16], [20, 0]]) {
      assert.deepEqual(field.weightGradientAt(x, z).map(v => v === 0 ? 0 : v), [0, 0, 0]);
      assert.equal(field.heightAt(x, z, base), base(x, z));
    }
    assert.equal(field.weightAt(0, 0), 1);
    assert.equal(field.weightAt(-14, 14), .25);
    for (const [x, z] of [[-14, 0], [14, 0], [0, -13], [0, 13], [-14, 14]]) {
      const [w, dx, dz] = field.weightGradientAt(x, z);
      assert.equal(w, field.weightAt(x, z));
      assert.ok(Math.abs(dx - (field.weightAt(x + epsilon, z) - field.weightAt(x - epsilon, z)) / (2 * epsilon)) < 1e-8);
      assert.ok(Math.abs(dz - (field.weightAt(x, z + epsilon) - field.weightAt(x, z - epsilon)) / (2 * epsilon)) < 1e-8);
      assert.equal(field.heightAt(x, z, base), base(x, z) + w * (field.sourceHeightAt(x, z) - base(x, z)));
    }
    for (const e of [1e-2, 1e-3, 1e-4]) {
      assert.ok(field.weightAt(-16 + e, 0) < e * e);
      assert.ok(Math.abs(field.weightGradientAt(-16 + e, 0)[1]) < e);
    }
    field.setEnabled(false);
    assert.equal(field.heightAt(0, 0, base), base(0, 0));
  } finally { field.dispose(); }
});

test('source support bounds contain collar interpolation and disposal is idempotent', () => {
  const {meta, packed, normals} = fixture();
  packed[0] = 255; packed[1] = 255; // A maximum at the blend ring corner.
  const field = new TerrainSourceField(meta, packed, normals), count = 8;
  const min = new Float64Array(count * count).fill(90), max = new Float64Array(count * count).fill(90);
  let heightDisposals = 0, normalDisposals = 0;
  field.heightTexture.addEventListener('dispose', () => heightDisposals++);
  field.normalTexture.addEventListener('dispose', () => normalDisposals++);
  try {
    field.expandBounds(min, max, 64, count);
    for (let iz = 0; iz < 257; iz++) for (let ix = 0; ix < 257; ix++) {
      const x = -31.99 + ix / 256 * 63.98, z = -31.99 + iz / 256 * 63.98;
      const index = Math.floor((32 - z) / 8) * count + Math.floor((x + 32) / 8);
      const h = field.heightAt(x, z, () => 90);
      assert.ok(h >= min[index] - 1e-10 && h <= max[index] + 1e-10, `Bound excludes ${x},${z}`);
    }
    assert.equal(max[0], 90); assert.ok(max.some(h => h > 150));
  } finally { field.dispose(); field.dispose(); }
  assert.equal(heightDisposals, 1); assert.equal(normalDisposals, 1);
  assert.equal(field.packed, null); assert.equal(field.normalPixels, null);
  assert.equal(field.heightTexture.image.data, null); assert.equal(field.normalTexture.image.data, null);
  assert.throws(() => field.setEnabled(true), /disposed/);
});

// Canvas/fetch are intentionally tiny deterministic substitutes. Hashes use
// real Web Crypto; failures exercise the actual Terrain.load fallback path.
async function browserFixture(fault, callback) {
  const {meta, packed, normals} = fixture(), saved = new Map(), warnings = [], calls = [], closed = [], canvases = [];
  const put = (key, value) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {configurable: true, writable: true, value}); };
  const oldWarn = console.warn;
  const height = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  for (let i = 0; i < packed.length / 2; i++) height.set(packed.subarray(i * 2, i * 2 + 2), i * 4);
  class Canvas {
    constructor(width = 8, height = 8) { Object.assign(this, {width, height}); canvases.push(this); }
    getContext() {
      let source;
      return {drawImage(image) {source = image.url;}, getImageData() {
        const pixels = (source?.endsWith('/n.png') ? normals : height).slice();
        if ((fault === 'height-corrupt' && source?.endsWith('/h.png')) || (fault === 'normal-corrupt' && source?.endsWith('/n.png'))) pixels[21] ^= 1;
        return {data: pixels};
      }};
    }
  }
  try {
    put('crypto', webcrypto); put('OffscreenCanvas', Canvas); put('document', {createElement: () => new Canvas()});
    put('Image', class {constructor() {this.width = this.height = 8;} async decode() {}});
    put('createImageBitmap', async blob => ({url: blob.url, width: 8, height: 8, close() {closed.push(blob.url);}}));
    put('fetch', async url => {
      url = String(url); calls.push(url);
      return {url, ok: !(fault === 'normal-404' && url.endsWith('/n.png')), status: 404, blob: async () => ({url}),
        json: async () => url.endsWith('_meta.json') ? {grid: 8, sizeM: 65536, minH: 100, maxH: 200, drape: []}
          : {...meta, ...(fault === 'missing-hash' ? {normalPixelsSHA256: null} : {}), ...(fault === 'wrong-front' ? {front: 'NELLIS'} : {})}};
    });
    console.warn = (...args) => warnings.push(args.join(' '));
    return await callback({calls, closed, canvases, warnings});
  } finally {
    console.warn = oldWarn;
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}

test('loader rejects same-size corrupt bytes and retains a coherent canonical terrain', async () => {
  for (const fault of ['none', 'height-corrupt', 'normal-corrupt', 'normal-404', 'missing-hash', 'wrong-front']) {
    await browserFixture(fault, async ({calls, closed, canvases, warnings}) => {
      const terrain = await Terrain.load('https://fixture.invalid/base', 'VALDEZ', null,
        {drape: null, nearDetail: false, sourceManifest: 'https://fixture.invalid/field.json'});
      try {
        if (fault === 'none') {
          assert.ok(terrain.sourceField); assert.equal(warnings.length, 0);
          assert.equal(terrain.heightAt(0, 0), terrain.sourceField.sourceHeightAt(0, 0));
          assert.equal(closed.length, 2);
        } else {
          assert.equal(terrain.sourceField, null); assert.equal(warnings.length, 1);
          assert.equal(terrain.heightAt(0, 0), terrain.baseHeightAt(0, 0));
          if (fault.endsWith('corrupt')) assert.match(warnings[0], /checksum mismatch/);
          if (fault === 'height-corrupt') assert.ok(calls.every(url => !url.endsWith('/n.png')));
        }
        // The first canvas belongs to canonical terrain; only source staging
        // canvases are released by the new source loader.
        assert.ok(canvases.slice(1).every(canvas => canvas.width === 1 && canvas.height === 1));
      } finally {
        terrain.group.removeFromParent(); terrain.material.dispose(); terrain.grid.dispose();
        terrain.fineGrid?.dispose(); terrain.tex.dispose(); terrain.sourceField?.dispose();
      }
    });
  }
});

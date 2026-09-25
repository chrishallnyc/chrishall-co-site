import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { decodeCloudNoise } from '../src/world/cloudnoiseencoding.js';
import { CLOUD_COV_SLICE, CLOUD_TOWER_SLICE, CLOUD_NOISE_SIZES } from '../src/world/cloudnoiserecipe.js';
import { decodeBrightStars } from '../src/world/starcatalog.js';
import { buildFineSpectrum } from '../src/world/oceanfinespectrum.js';

for (const resolution of ['standard', 'ultra']) {
  test(`${resolution} cloud assets decode to the documented exact field`, async () => {
    const folder = new URL('../assets/cloudnoise/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL(`1337-${resolution}.json`, folder), 'utf8'));
    assert.equal(manifest.coverageSlice, CLOUD_COV_SLICE);
    assert.equal(manifest.towerSlice, CLOUD_TOWER_SLICE);
    for (const channel of ['base', 'detail']) {
      const n = CLOUD_NOISE_SIZES[resolution][`${channel}N`], entry = manifest[channel];
      const encoded = gunzipSync(await readFile(new URL(entry.file, folder)));
      assert.equal(encoded.length, 4 * n ** 3);
      const decoded = decodeCloudNoise(encoded, n);
      assert.equal(createHash('sha256').update(decoded).digest('hex'), entry.sha256);
    }
  });
}

test('the real star catalog rejects truncated and duplicate records', async () => {
  const bytes = await readFile(new URL('../assets/sky/bright-stars-v6.bin', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const stars = decodeBrightStars(buffer);
  assert.equal(stars.length, 5080);
  assert.ok(stars.some(star => star.hr === 424 && star.dec > 89));
  assert.throws(() => decodeBrightStars(buffer.slice(0, -1)));
  const corrupted = buffer.slice(0), view = new DataView(corrupted);
  view.setUint16(24 + 18, view.getUint16(24, true), true);
  assert.throws(() => decodeBrightStars(corrupted));
});

test('higher water detail retains existing wave phases and does not duplicate macro energy', () => {
  for (const front of ['VALDEZ', 'MARIANAS']) {
    const low = buildFineSpectrum(front, { N: 128 }), high = buildFineSpectrum(front, { N: 256 });
    for (const spectrum of [low, high]) {
      assert.ok(Math.abs(spectrum.totalVariance - spectrum.resolvedVariance - spectrum.tailVariance) < 1e-15);
      assert.ok(spectrum.tailVariance >= 0);
      assert.ok(spectrum.minK > spectrum.kMin);
    }
    let compared = 0;
    for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
      const i = (z * 128 + x) * 4;
      if (low.data[i] === 0 && low.data[i + 1] === 0) continue;
      const mx = x < 64 ? x : x - 128, mz = z < 64 ? z : z - 128;
      const j = (((mz + 256) % 256) * 256 + (mx + 256) % 256) * 4;
      for (let channel = 0; channel < 4; channel++) assert.equal(low.data[i + channel], high.data[j + channel]);
      compared++;
    }
    assert.ok(compared > 1000);
  }
});

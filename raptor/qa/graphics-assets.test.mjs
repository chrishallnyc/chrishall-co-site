import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { LinearFilter, RepeatWrapping } from 'three';
import { decodeCloudNoise } from '../src/world/cloudnoiseencoding.js';
import { loadCloudNoise } from '../src/world/cloudnoise.js';
import { CLOUD_COV_SLICE, CLOUD_TOWER_SLICE, CLOUD_NOISE_SIZES, cloudNoiseSize } from '../src/world/cloudnoiserecipe.js';
import { decodeBrightStars } from '../src/world/starcatalog.js';
import { buildFineSpectrum } from '../src/world/oceanfinespectrum.js';

for (const resolution of ['standard', 'high', 'ultra']) {
  test(`${resolution} cloud assets decode to the documented exact field`, async () => {
    const folder = new URL('../assets/cloudnoise/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL(`1337-${resolution}.json`, folder), 'utf8'));
    assert.equal(manifest.resolution, resolution);
    assert.deepEqual(cloudNoiseSize({ resolution }), { ...CLOUD_NOISE_SIZES[resolution], resolution });
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

test('High cloud loading uses the production assets and preserves bounded fallback and abort behavior', async t => {
  const originalFetch = globalThis.fetch, folder = new URL('../assets/cloudnoise/', import.meta.url);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const standard = JSON.parse(await readFile(new URL('1337-standard.json', folder), 'utf8'));
  const high = JSON.parse(await readFile(new URL('1337-high.json', folder), 'utf8'));
  try {
    for (const mode of ['gzip', 'inflated', 'missing-high', 'missing-all', 'checksum', 'dimensions', 'aborted']) {
      await t.test(mode, async () => {
        const requests = [], fallbacks = [];
        let noise;
        globalThis.fetch = async (url, { signal } = {}) => {
          signal?.throwIfAborted();
          assert.equal(new URL('.', url).href, folder.href, 'the default loader uses shipped assets');
          const name = new URL(url).pathname.split('/').at(-1);
          requests.push(name);
          if (mode === 'missing-all' || (mode === 'missing-high' && name.startsWith('1337-high'))) {
            return new Response('', { status: 404 });
          }
          let bytes = await readFile(url);
          if (name.endsWith('.json') && (mode === 'checksum' || mode === 'dimensions')) {
            const manifest = JSON.parse(bytes);
            if (mode === 'checksum') manifest.base.sha256 = '0'.repeat(64);
            else manifest.baseN = 191;
            bytes = Buffer.from(JSON.stringify(manifest));
          }
          if (mode === 'inflated' && name.endsWith('.gz')) bytes = gunzipSync(bytes);
          return new Response(bytes);
        };
        const controller = new AbortController();
        if (mode === 'aborted') controller.abort(new Error('cancelled'));
        try {
          const pending = loadCloudNoise({ resolution: 'high', signal: controller.signal,
            fallback: !['checksum', 'dimensions'].includes(mode),
            onFallback: ({ from, to }) => fallbacks.push({ from, to }) });
          if (['checksum', 'dimensions', 'aborted'].includes(mode)) {
            await assert.rejects(pending, mode === 'checksum' ? /checksum/ : mode === 'dimensions' ? /recipe mismatch/ : /cancelled/);
            if (mode === 'dimensions') assert.deepEqual(requests, ['1337-high.json']);
            if (mode === 'aborted') assert.deepEqual(requests, []);
            assert.deepEqual(fallbacks, []);
            return;
          }
          noise = await pending;
          const fallback = mode.startsWith('missing'), manifest = fallback ? standard : high;
          assert.equal(noise.resolution, fallback ? 'standard' : 'high');
          assert.equal(noise.source, mode === 'missing-all' ? 'bake' : 'asset');
          for (const channel of ['base', 'detail']) {
            assert.equal(hash(noise[channel + 'Data']), manifest[channel].sha256);
            const texture = noise[channel + 'Tex'], n = manifest[channel + 'N'];
            assert.deepEqual([texture.image.width, texture.image.height, texture.image.depth], [n, n, n]);
            assert.equal(texture.minFilter, LinearFilter);
            assert.equal(texture.wrapR, RepeatWrapping);
            assert.equal(texture.generateMipmaps, false);
          }
          assert.deepEqual(fallbacks, fallback ? [
            { from: 'high', to: 'standard asset' },
            ...(mode === 'missing-all' ? [{ from: 'standard', to: 'standard bake' }] : []),
          ] : []);
        } finally {
          for (const texture of [noise?.baseTex, noise?.detailTex, noise?.jitterTex]) texture?.dispose();
        }
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

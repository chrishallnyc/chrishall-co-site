import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTerrainImagery } from '../src/world/terrain-imagery-loader.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = { manifestURL: new URL('https://example.test/manifest.json'), timeoutMs: 10 };
test('optional imagery deadline includes a late module and cannot allocate after timeout', async () => {
  let constructed = 0, failures = 0;
  const stream = await loadTerrainImagery({ ...options,
    importStream: async () => { await delay(30); return { TerrainImageryStream: class { constructor() { constructed++; } } }; },
    onFailure: () => failures++,
  });
  assert.equal(stream, null); await delay(40);
  assert.equal(constructed, 0); assert.equal(failures, 1);
});
test('optional imagery deadline covers a manifest body that resolves late', async () => {
  const previous = globalThis.fetch; let constructed = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => { await delay(30); return {}; } });
  try {
    const stream = await loadTerrainImagery({ ...options,
      importStream: async () => ({ TerrainImageryStream: class { constructor() { constructed++; } } }),
    });
    assert.equal(stream, null); await delay(40); assert.equal(constructed, 0);
  } finally { globalThis.fetch = previous; }
});
test('manifest failure falls back and successful initialization transfers device limits', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const importStream = async () => ({ TerrainImageryStream: class { constructor(options) { Object.assign(this, options); } } });
    assert.equal(await loadTerrainImagery({ ...options, importStream }), null);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1 }) });
    const stream = await loadTerrainImagery({ ...options, importStream, maxTextureSize: 4096, maxTextureArrayLayers: 256 });
    assert.deepEqual(stream.manifest, { version: 1 }); assert.equal(stream.maxTextureSize, 4096); assert.equal(stream.maxTextureArrayLayers, 256);
  } finally { globalThis.fetch = previous; }
});

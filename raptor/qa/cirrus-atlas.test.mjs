import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Exercise the actual module without browser, network or GPU. Fresh module
// queries create new singletons, as page reloads would in production.
export async function runCirrusLoaderContracts(loaderURL) {
  const originalLoad = THREE.ImageLoader.prototype.load;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const results = [];
  let state;
  THREE.ImageLoader.prototype.load = function (url, onLoad, _progress, onError) {
    const call = { url, onLoad, onError };
    state.pending.push(call);
    state.requests.push({ url, canvasesAtRequest: state.canvases.map(c => [c.width, c.height]) });
    return {};
  };
  globalThis.document = {
    createElement(type) {
      assert.equal(type, 'canvas');
      const canvas = {
        width: 0, height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              if (state.failReadback) throw Error('Simulated canvas readback failure');
              const data = new Uint8Array(canvas.width * canvas.height * 4);
              data[0] = 31; data[1] = 213;
              data[data.length - 4] = 197; data[data.length - 3] = 249;
              return { data };
            },
          };
        },
      };
      state.canvases.push(canvas);
      return canvas;
    },
  };

  async function start(name, resolution) {
    state = { name, pending: [], requests: [], canvases: [], failReadback: false, disposed: 0 };
    const url = new URL(loaderURL);
    url.searchParams.set('cirrus-contract', `${Date.now()}-${results.length}-${name}`);
    const module = await import(url.href);
    state.atlas = module.getCirrusAtlas(resolution);
    state.atlas.addEventListener('dispose', () => state.disposed++);
    state.version = state.atlas.version;
    assert.equal(module.getCirrusAtlas(2048), state.atlas, 'One page owns one atlas');
    assert.equal(state.requests.length, 1);
    assert.equal(state.atlas.userData.requestedResolution, resolution);
    assert.equal(state.atlas.userData.source, 'placeholder');
  }

  function reply(size, success = true) {
    const call = state.pending.shift();
    assert.ok(call, 'A loader request is pending');
    const filename = size === 8192 ? 'cirrus-density-8k.png' : 'cirrus-density.png';
    assert.equal(new URL(call.url).pathname.split('/').at(-1), filename);
    if (success) call.onLoad({ width: size, height: size });
    else call.onError(Error('Simulated download failure'));
  }

  async function finish({ ready, size, source, requests }) {
    assert.equal(await state.atlas.userData.ready, ready);
    const { atlas } = state;
    assert.deepEqual([atlas.image.width, atlas.image.height], [size, size]);
    assert.equal(atlas.userData.source, source);
    assert.equal(state.requests.length, requests);
    assert.equal(state.pending.length, 0);
    assert.ok(state.canvases.every(c => c.width === 1 && c.height === 1), 'Canvas cleanup precedes readiness');
    assert.equal(state.disposed, ready ? 1 : 0, 'Replace placeholder GPU storage only after successful decoding');
    assert.equal(atlas.version > state.version, ready, 'Publish a new texture version only after success');
    if (ready) {
      assert.ok(atlas.image.data instanceof Uint8Array);
      assert.equal(atlas.image.data.length, size * size);
      assert.equal(atlas.image.data[0], 31);
      assert.equal(atlas.image.data.at(-1), 197, 'Preserve the final red-channel texel');
    } else {
      assert.deepEqual([...atlas.image.data], [0], 'Exhausted fallback remains a clear black texel');
    }
    results.push({ case: state.name, ready, requested: atlas.userData.requestedResolution,
      actual: [size, size], source, bytes: atlas.image.data.byteLength,
      requests: state.requests, releasedCanvases: state.canvases.length });
  }

  try {
    await start('invalid-8k-dimensions-fall-back-before-canvas', 8192);
    state.pending.shift().onLoad({ width: 1, height: 1 });
    assert.equal(state.canvases.length, 0, 'Reject unexpected dimensions before canvas allocation');
    reply(2048);
    await finish({ ready: true, size: 2048, source: 'fallback', requests: 2 });

    await start('8k-decode-failure-releases-canvas-before-fallback', 8192);
    state.failReadback = true;
    reply(8192);
    assert.deepEqual(state.requests[1].canvasesAtRequest, [[1, 1]], 'Release 8K backing store before requesting 2K');
    state.failReadback = false;
    reply(2048);
    await finish({ ready: true, size: 2048, source: 'fallback', requests: 2 });

    await start('8k-download-failure-loads-2k', 8192);
    reply(8192, false);
    reply(2048);
    await finish({ ready: true, size: 2048, source: 'fallback', requests: 2 });

    await start('2k-download-failure-keeps-clear-placeholder', 2048);
    reply(2048, false);
    await finish({ ready: false, size: 1, source: 'placeholder', requests: 1 });

    await start('8k-and-2k-download-failures-keep-clear-placeholder', 8192);
    reply(8192, false);
    reply(2048, false);
    await finish({ ready: false, size: 1, source: 'placeholder', requests: 2 });

    await start('2k-decode-failure-keeps-clear-placeholder', 2048);
    state.failReadback = true;
    reply(2048);
    await finish({ ready: false, size: 1, source: 'placeholder', requests: 1 });

    await start('invalid-2k-fallback-keeps-clear-placeholder', 8192);
    reply(8192, false);
    state.pending.shift().onLoad({ width: 2048, height: 2047 });
    assert.equal(state.canvases.length, 0);
    await finish({ ready: false, size: 1, source: 'placeholder', requests: 2 });

    await start('valid-2k-is-published-before-readiness', 2048);
    reply(2048);
    await finish({ ready: true, size: 2048, source: 'asset', requests: 1 });

    await start('valid-8k-is-published-before-readiness', 8192);
    reply(8192);
    await finish({ ready: true, size: 8192, source: 'asset', requests: 1 });
    return results;
  } finally {
    THREE.ImageLoader.prototype.load = originalLoad;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
}


test('cirrus loader publishes valid data and releases decode canvases across success and fallbacks', async () => {
  await runCirrusLoaderContracts(new URL('../src/world/celestial-nodes.js', import.meta.url));
});

test('shipped cirrus atlases match their manifests and native texture dimensions', async () => {
  for (const [name, size] of [['cirrus-density', 2048], ['cirrus-density-8k', 8192]]) {
    const directory = new URL('../assets/clouds/', import.meta.url);
    const [encoded, manifest] = await Promise.all([
      readFile(new URL(name + '.png', directory)),
      readFile(new URL(name + '.json', directory), 'utf8').then(JSON.parse),
    ]);
    assert.equal(encoded.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([encoded.readUInt32BE(16), encoded.readUInt32BE(20)], [size, size]);
    assert.deepEqual([manifest.width, manifest.height, manifest.channels], [size, size, 1]);
    assert.equal(encoded.length, manifest.bytes);
    assert.equal(createHash('sha256').update(encoded).digest('hex'), manifest.sha256);
    assert.equal(manifest.recipe.version, 4);
    assert.equal(manifest.recipe.fineFibres, size === 8192);
  }
});

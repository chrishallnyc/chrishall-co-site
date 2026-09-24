import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStudy } from '../audio-tools/render.mjs';

test('failed manifest persistence rejects the study and stops later captures', async () => {
  const originalFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map([['raptor:mute', '1']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  } });
  try {
    for (const status of [403, 500]) {
      const requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response('manifest unavailable', { status });
      };
      // No DSP implementation is needed to exercise the real persistence loop.
      await assert.rejects(renderStudy({ batch: 'manifest-failure', versions: [],
        names: ['idle', 'military'], loadSamples: false }),
      new RegExp(`Manifest capture failed: ${status} manifest unavailable`));
      assert.equal(requests.length, 1, 'do not continue to the next scene');
      assert.equal(requests[0].url, '/capture/manifest-failure/manifest.json');
      assert.equal(JSON.parse(requests[0].options.body).scenes[0].id, 'idle');
      assert.equal(saved.get('raptor:mute'), '1');
    }
    globalThis.fetch = async () => new Response(null, { status: 201 });
    const manifest = await renderStudy({ batch: 'manifest-success', versions: [],
      names: ['idle', 'military'], loadSamples: false });
    assert.equal(manifest.scenes.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});

import { loadEngineTexture } from '../src/engine/audio-assets.js';
import { AudioBus } from '../src/engine/audio.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const reject = async (promise, pattern) => {
  try { await promise; } catch (error) { assert(pattern.test(error.message), error.message); return; }
  throw new Error('Expected request to fail');
};
const response = bytes => ({ ok: true, arrayBuffer: async () => bytes });
const unitTests = [
  ['HTTP failure rejects before decoding', async () => {
    let decoded = false;
    await reject(loadEngineTexture({ decodeAudioData: () => { decoded = true; } }, {
      fetcher: async () => ({ ok: false, status: 404 }),
    }), /404/);
    assert(!decoded, 'failed HTTP data must never enter the decoder');
  }],
  ['oversized asset is rejected before decoding', async () => {
    await reject(loadEngineTexture({ decodeAudioData: () => { throw new Error('should not decode'); } }, {
      fetcher: async () => response(new ArrayBuffer(2_000_001)),
    }), /size budget/);
  }],
  ['decoder receives an independent encoded buffer', async () => {
    const bytes = new ArrayBuffer(24);
    new Uint8Array(bytes)[0] = 91;
    let received;
    const result = await loadEngineTexture({ decodeAudioData: async data => {
      received = data; new Uint8Array(data)[0] = 0;
      return { numberOfChannels: 1, duration: 8 };
    } }, { fetcher: async () => response(bytes) });
    assert(received !== bytes && new Uint8Array(bytes)[0] === 91, 'decoding must not detach/mutate cached bytes');
    assert(result.duration === 8, 'valid decoded loop is returned');
  }],
  ['invalid channel layout or duration is rejected', async () => {
    for (const metadata of [{ numberOfChannels: 2, duration: 8 }, { numberOfChannels: 1, duration: 30 }]) {
      await reject(loadEngineTexture({ decodeAudioData: async () => metadata }, {
        fetcher: async () => response(new ArrayBuffer(20)),
      }), /short mono loop/);
    }
  }],
];

const rms = (buffer, from = 0.8) => {
  const data = buffer.getChannelData(0), start = Math.floor(from * buffer.sampleRate);
  let sum = 0;
  for (let i = start; i < data.length; i++) {
    assert(Number.isFinite(data[i]) && Math.abs(data[i]) < 1, 'finite PCM with headroom');
    sum += data[i] ** 2;
  }
  return Math.sqrt(sum / (data.length - start));
};

const browserTests = [
  ['shipped texture decodes and supplements afterburner only', async () => {
    const make = async (ab, sample) => {
      const ctx = new OfflineAudioContext(2, 48000 * 3, 48000);
      const texture = sample ? await loadEngineTexture(ctx) : null;
      const bus = new AudioBus({ context: ctx, texture });
      bus.setMute(false);
      bus.engine.setState({ throttle: 1, ab, ias: 0 });
      try { return await ctx.startRendering(); } finally { bus.dispose(); }
    };
    const idle = await make(0, false), texturedIdle = await make(0, true);
    let max = 0;
    const a = idle.getChannelData(0), b = texturedIdle.getChannelData(0);
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    assert(max < 1e-6, `full-power texture must be silent without afterburner, diff ${max}`);
    const burner = await make(1, true);
    const power = rms(burner);
    assert(power > rms(idle), 'textured afterburner must add audible power');
    return { idleDifference: max, afterburnerRms: power };
  }],
  ['failed fetch preserves deterministic procedural output', async () => {
    const make = async fail => {
      const ctx = new OfflineAudioContext(2, 48000 * 2, 48000);
      const bus = new AudioBus({ context: ctx });
      bus.setMute(false);
      bus.engine.setState({ throttle: 1, ab: 1 });
      if (fail) {
        const ok = await bus.loadTextures({ fetcher: async () => ({ ok: false, status: 503 }) });
        assert(!ok && bus.engine.textureStatus === 'fallback', 'failed request must settle to fallback');
      }
      try { return await ctx.startRendering(); } finally { bus.dispose(); }
    };
    const a = (await make(false)).getChannelData(0), b = (await make(true)).getChannelData(0);
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    assert(max < 1e-6, `asset failure changed procedural sound: ${max}`);
    return { maximumDifference: max };
  }],
  ['loading once avoids duplicate voices and late completion cannot revive disposal', async () => {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const bus = new AudioBus({ context: ctx });
    let fulfill, requests = 0;
    const bytes = await (await fetch('/assets/audio/f119-afterburner.wav')).arrayBuffer();
    const fetcher = () => { requests++; return new Promise(resolve => { fulfill = resolve; }); };
    const first = bus.loadTextures({ fetcher });
    const second = bus.loadTextures({ fetcher });
    assert(first === second && requests === 1, 'concurrent loads must share one operation');
    const before = bus.engine.sources.length;
    bus.dispose();
    fulfill(response(bytes));
    assert(await first === false, 'disposed bus must reject late texture attachment');
    assert(bus.engine.sources.length === before, 'disposal must prevent new source allocation');
    return { requests, sourceCount: before };
  }],
];

export async function runAudioAssetTests() {
  const cases = typeof OfflineAudioContext === 'function' ? [...unitTests, ...browserTests] : unitTests;
  const results = [];
  let storage, previousMute;
  try { storage = globalThis.localStorage; previousMute = storage?.getItem('raptor:mute'); } catch (_) {}
  try {
    // Keep each comparison's initial mixer state identical. The finally block
    // restores the user's preference even when a render or assertion fails.
    try { storage?.setItem('raptor:mute', '0'); } catch (_) {}
    for (const [name, run] of cases) {
      try { results.push({ name, passed: true, details: await run() }); }
      catch (error) { results.push({ name, passed: false, error: error.stack || error.message }); }
    }
  } finally {
    try {
      if (previousMute == null) storage?.removeItem('raptor:mute');
      else storage?.setItem('raptor:mute', previousMute);
    } catch (_) {}
  }
  return { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { test } = await import('node:test');
  for (const [name, run] of unitTests) test(name, run);
}

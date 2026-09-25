// Optional authored textures. The procedural graph stays usable while loading
// and when a file cannot be fetched/decoded. No service or runtime API calls.
export const ENGINE_TEXTURE_URL = '/assets/audio/f119-afterburner.wav';
const encoded = new Map();

export async function loadEngineTexture(ctx, { url = ENGINE_TEXTURE_URL, fetcher = globalThis.fetch } = {}) {
  if (typeof fetcher !== 'function') throw new Error('Audio texture fetch unavailable');
  // Only share the shipped asset fetch. Injected test/custom loaders stay isolated.
  const cache = fetcher === globalThis.fetch && url === ENGINE_TEXTURE_URL;
  let pending = cache && encoded.get(url);
  if (!pending) {
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Audio texture HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 2_000_000) throw new Error('Audio texture exceeds its size budget');
        return bytes;
      } finally { clearTimeout(timer); }
    })();
    if (cache) {
      encoded.set(url, pending);
      pending.catch(() => encoded.delete(url));
    }
  }
  // decodeAudioData may detach its input and resamples for this context.
  const buffer = await ctx.decodeAudioData((await pending).slice(0));
  if (buffer.numberOfChannels !== 1 || buffer.duration < 2 || buffer.duration > 15) {
    throw new Error('Audio texture must be a short mono loop');
  }
  return buffer;
}

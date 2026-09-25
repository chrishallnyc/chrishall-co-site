// Optional detail must never hold up the playable base terrain. The deadline
// covers module loading, manifest transfer and parsing, including late imports.
export async function loadTerrainImagery({ manifestURL, maxTextureSize, maxTextureArrayLayers,
  timeoutMs = 3000, onFailure, importStream = () => import('./terrain-imagery-stream.js') }) {
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Terrain imagery initialization timed out');
        controller.abort(error); reject(error);
      }, timeoutMs);
    });
    const load = (async () => {
      const { TerrainImageryStream } = await importStream();
      controller.signal.throwIfAborted();
      const response = await fetch(manifestURL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Terrain imagery manifest HTTP ${response.status}`);
      const manifest = await response.json();
      controller.signal.throwIfAborted();
      return new TerrainImageryStream({ manifest, baseURL: manifestURL, maxTextureSize, maxTextureArrayLayers });
    })();
    return await Promise.race([load, deadline]);
  } catch (error) {
    onFailure?.(error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

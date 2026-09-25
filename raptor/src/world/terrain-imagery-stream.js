// Optional geographic imagery. One four-layer array; unavailable data leaves
// the existing terrain intact. This module owns no render loop or material.
import * as THREE from 'three';
import { uniform } from 'three/tsl';

const SHA256 = /^[a-f0-9]{64}$/;
const abortError = () => Object.assign(new Error('Imagery request aborted'), { name: 'AbortError' });
const checkAbort = signal => { if (signal.aborted) throw abortError(); };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function validateImageryManifest(meta) {
  const b = meta?.worldBounds, n = meta?.imagePixels, size = meta?.tileSizeM;
  if (!b || ![b.xmin, b.xmax, b.zmin, b.zmax, size, meta.metresPerPixel].every(Number.isFinite)
    || !Number.isInteger(meta.rows) || !Number.isInteger(meta.columns) || meta.rows < 2 || meta.columns < 2
    || meta.rows > 64 || meta.columns > 64 || !Number.isInteger(n) || n < 2 || n > 4096
    || !Number.isInteger(meta.interiorPixels) || meta.interiorPixels < 1
    || !Number.isInteger(meta.gutterPixels) || meta.gutterPixels < 1
    || n !== meta.interiorPixels + 2 * meta.gutterPixels || meta.metresPerPixel <= 0
    || size !== meta.interiorPixels * meta.metresPerPixel
    || b.xmax - b.xmin !== meta.columns * size || b.zmax - b.zmin !== meta.rows * size
    || !Array.isArray(meta.tiles) || meta.tiles.length !== meta.rows * meta.columns) {
    throw new Error('Invalid geographic imagery manifest geometry');
  }
  const ids = new Set(), cells = new Set(), gutter = meta.gutterPixels * meta.metresPerPixel;
  for (const tile of meta.tiles) {
    const bounds = tile.worldBounds, image = tile.imageWorldBounds;
    if (typeof tile.id !== 'string' || ids.has(tile.id) || !Number.isInteger(tile.row) || !Number.isInteger(tile.column)
      || tile.row < 0 || tile.column < 0 || tile.row >= meta.rows || tile.column >= meta.columns
      || cells.has(`${tile.row}:${tile.column}`) || !bounds || !image
      || bounds.xmin !== b.xmin + tile.column * size || bounds.xmax !== bounds.xmin + size
      || bounds.zmax !== b.zmax - tile.row * size || bounds.zmin !== bounds.zmax - size
      || image.xmin !== bounds.xmin - gutter || image.xmax !== bounds.xmax + gutter
      || image.zmin !== bounds.zmin - gutter || image.zmax !== bounds.zmax + gutter
      || typeof tile.blank !== 'boolean') throw new Error('Invalid geographic imagery tile geometry');
    if (!tile.blank && (typeof tile.file !== 'string' || !/^[a-zA-Z0-9_./-]+\.webp$/.test(tile.file)
      || tile.file.startsWith('/') || tile.file.split('/').includes('..') || !SHA256.test(tile.sha256)
      || !Number.isInteger(tile.bytes) || tile.bytes < 1 || tile.bytes > 8_000_000)) {
      throw new Error('Invalid geographic imagery tile asset');
    }
    ids.add(tile.id); cells.add(`${tile.row}:${tile.column}`);
  }
}

export function imageryQuartet(meta, x, z) {
  const b = meta.worldBounds;
  if (![x, z].every(Number.isFinite) || x < b.xmin || x > b.xmax || z < b.zmin || z > b.zmax) return [];
  const col = clamp(Math.floor((x - b.xmin) / meta.tileSizeM - .5), 0, meta.columns - 2);
  const row = clamp(Math.floor((b.zmax - z) / meta.tileSizeM - .5), 0, meta.rows - 2);
  return meta.tiles.filter(tile => tile.column >= col && tile.column <= col + 1 && tile.row >= row && tile.row <= row + 1)
    .sort((a, b) => {
      const distance = t => (x - (t.worldBounds.xmin + t.worldBounds.xmax) / 2) ** 2
        + (z - (t.worldBounds.zmin + t.worldBounds.zmax) / 2) ** 2;
      return distance(a) - distance(b) || a.row - b.row || a.column - b.column;
    });
}

export function imageryMipBytes(imagePixels, layers = 4) {
  let pixels = 0;
  for (let n = imagePixels; n > 0; n = Math.floor(n / 2)) pixels += n * n;
  return pixels * layers * 4;
}

async function loadImageryPixels({ url, signal, width, height, expectedSHA256, expectedBytes, onBytes }) {
  const response = await fetch(url, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`Imagery fetch failed (${response.status})`);
  const chunks = [], reader = response.body?.getReader();
  if (!reader) throw new Error('Imagery response stream unavailable');
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      onBytes?.(value.byteLength);
      if (length > expectedBytes) { await reader.cancel(); throw new Error('Imagery response exceeds its manifest'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  checkAbort(signal);
  if (length !== expectedBytes) throw new Error('Imagery response length does not match its manifest');
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  chunks.length = 0;
  if (!globalThis.crypto?.subtle) throw new Error('Imagery integrity verification unavailable');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedSHA256) throw new Error('Imagery asset checksum mismatch');
  checkAbort(signal);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), {
    colorSpaceConversion: 'none', imageOrientation: 'none', premultiplyAlpha: 'none',
  });
  let canvas;
  try {
    checkAbort(signal);
    if (bitmap.width !== width || bitmap.height !== height) throw new Error('Imagery dimensions do not match its manifest');
    canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Imagery pixel decode unavailable');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    checkAbort(signal);
    return pixels;
  } finally { bitmap.close(); if (canvas) { canvas.width = 1; canvas.height = 1; } }
}

export class TerrainImageryStream {
  constructor({ manifest, baseURL, maxHeightAboveGroundM = 2500, maxConcurrent = 2,
    requestTimeoutMs = 15000, maxTextureSize = 2048, maxTextureArrayLayers = 4,
    fadeDurationMs = 600, clock = () => performance.now(), loadPixels = loadImageryPixels } = {}) {
    validateImageryManifest(manifest);
    if (!Number.isFinite(maxHeightAboveGroundM) || maxHeightAboveGroundM <= 0
      || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2
      || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 60000
      || !Number.isFinite(maxTextureSize) || maxTextureSize < 1
      || !Number.isFinite(maxTextureArrayLayers) || maxTextureArrayLayers < 1
      || !Number.isFinite(fadeDurationMs) || fadeDurationMs <= 0 || typeof clock !== 'function'
      || typeof loadPixels !== 'function') throw new Error('Invalid imagery stream configuration');
    this.manifest = manifest; this.baseURL = new URL(baseURL).href;
    this.maxHeightAboveGroundM = maxHeightAboveGroundM; this.maxConcurrent = maxConcurrent;
    this.requestTimeoutMs = requestTimeoutMs;
    // Defaults respect the minimum WebGL2 size. The caller may pass actual
    // device limits to enable 2064-pixel guttered imagery on larger hardware.
    this.supported = manifest.imagePixels <= maxTextureSize && maxTextureArrayLayers >= 4;
    this.fadeDurationMs = fadeDurationMs; this._clock = clock;
    this._loadPixels = loadPixels; this._disposed = false; this._allocated = false; this._data = null;
    this._desired = new Map(); this._requests = new Map(); this._promises = new Set(); this._failed = new Set();
    this._serial = 0; this._fullUploadPending = false;
    this.enabled = uniform(false);
    this.texture = new THREE.DataArrayTexture(new Uint8Array(16), 1, 1, 4);
    Object.assign(this.texture, { name: 'nellisGeographicImagery', format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, flipY: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, anisotropy: 4, unpackAlignment: 1 });
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.slots = Array.from({ length: 4 }, (_, layer) => ({ layer, tileId: null, requestId: null,
      ready: uniform(false), opacity: uniform(0), edgeOpen: uniform(new THREE.Vector4(1, 1, 1, 1)),
      bounds: uniform(new THREE.Vector4()), imageBounds: uniform(new THREE.Vector4()), _fadeStart: null }));
    this.stats = { requests: 0, downloadedBytes: 0, completedAssetBytes: 0, publishedTiles: 0, aborted: 0, failed: 0,
      obsoleteResults: 0, observedTextureUploads: 0, lastError: null, cpuBackingBytes: 16,
      logicalGPUBytesWithMips: 16, sourcePixelBytesPublished: 0 };
    this.texture.onUpdate = () => {
      this._fullUploadPending = false; this.stats.observedTextureUploads++;
      const now = this._clock();
      for (const slot of this.slots) if (slot.ready.value && slot._fadeStart === null) slot._fadeStart = now;
    };
  }

  update({ x, z, heightAboveGroundM, enabled = true }) {
    if (this._disposed) return;
    this._advanceFades();
    const active = this.supported && !!enabled && Number.isFinite(heightAboveGroundM) && heightAboveGroundM <= this.maxHeightAboveGroundM;
    const tiles = active ? imageryQuartet(this.manifest, x, z) : [];
    this.enabled.value = active && tiles.length > 0;
    this._desired = new Map(tiles.filter(t => !t.blank).map(t => [t.id, t]));
    for (const request of this._requests.values()) {
      if (!this._desired.has(request.tile.id) && !request.controller.signal.aborted) {
        clearTimeout(request.timer);
        request.controller.abort(); this.stats.aborted++;
      }
    }
    this._pump();
  }

  _advanceFades() {
    const now = this._clock();
    for (const slot of this.slots) {
      const t = slot._fadeStart === null ? 0 : clamp((now - slot._fadeStart) / this.fadeDurationMs, 0, 1);
      slot.opacity.value = t * t * (3 - 2 * t);
    }
    this._refreshEdges();
  }

  _refreshEdges() {
    for (const slot of this.slots) {
      const b = slot.bounds.value, openness = [1, 1, 1, 1];
      if (slot.ready.value) for (const neighbor of this.slots) {
        if (neighbor === slot || !neighbor.ready.value) continue;
        const n = neighbor.bounds.value, open = 1 - neighbor.opacity.value;
        if (n.y === b.y && n.w === b.w) {
          if (n.z === b.x) openness[0] = open; // west
          if (n.x === b.z) openness[2] = open; // east
        }
        if (n.x === b.x && n.z === b.z) {
          if (n.w === b.y) openness[1] = open; // south
          if (n.y === b.w) openness[3] = open; // north
        }
      }
      slot.edgeOpen.value.fromArray(openness);
    }
  }

  _pump() {
    if (this._disposed) return;
    for (const tile of this._desired.values()) {
      if (this._requests.size >= this.maxConcurrent) return;
      if (this._requests.has(tile.id) || this._failed.has(tile.id) || this.slots.some(s => s.tileId === tile.id)) continue;
      const slot = this.slots.find(s => s.requestId === null && (s.tileId === null || !this._desired.has(s.tileId)));
      if (!slot) return;
      const request = { tile, slot, serial: ++this._serial, controller: new AbortController() };
      slot.requestId = request.serial; this._requests.set(tile.id, request); this.stats.requests++;
      request.timer = setTimeout(() => {
        if (this._disposed || request.controller.signal.aborted) return;
        this._failed.add(tile.id); this.stats.failed++; this.stats.aborted++;
        this.stats.lastError = { tile: tile.id, message: 'Imagery request timed out' };
        request.controller.abort();
      }, this.requestTimeoutMs);
      const promise = this._load(request);
      this._promises.add(promise);
      promise.finally(() => { this._promises.delete(promise); });
    }
  }

  async _load(request) {
    const { tile, slot, controller, serial } = request;
    try {
      const n = this.manifest.imagePixels;
      const pixels = await this._loadPixels({ url: new URL(tile.file, this.baseURL).href, signal: controller.signal,
        width: n, height: n, expectedSHA256: tile.sha256, expectedBytes: tile.bytes,
        onBytes: count => { this.stats.downloadedBytes += count; } });
      this.stats.completedAssetBytes += tile.bytes;
      if (this._disposed || controller.signal.aborted || !this._desired.has(tile.id) || slot.requestId !== serial) {
        this.stats.obsoleteResults++; return;
      }
      if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== n * n * 4) {
        throw new Error('Imagery decoded pixel count mismatch');
      }
      // Source alpha is binary. Zero hidden RGB so SRGB hardware decoding and
      // linear mip filtering produce premultiplied linear RGB/coverage. The
      // material must composite base*(1-a*w)+sample.rgb*w, not multiply twice.
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0 && pixels[i] !== 255) throw new Error('Unexpected imagery coverage alpha');
        if (pixels[i] === 0) pixels[i - 3] = pixels[i - 2] = pixels[i - 1] = 0;
      }
      if (!this._allocated) {
        this._data = new Uint8Array(n * n * 4 * 4);
        this.texture.dispose(); // Keep the binding identity; recreate storage once.
        this.texture.image = { data: this._data, width: n, height: n, depth: 4 };
        this.texture.clearLayerUpdates(); this._fullUploadPending = true; this._allocated = true;
        this.stats.cpuBackingBytes = this._data.byteLength;
        this.stats.logicalGPUBytesWithMips = imageryMipBytes(n);
      }
      const offset = slot.layer * n * n * 4;
      this._data.set(pixels, offset);
      if (!this._fullUploadPending) this.texture.addLayerUpdate(slot.layer);
      this.texture.needsUpdate = true;
      const b = tile.worldBounds, image = tile.imageWorldBounds;
      slot.bounds.value.set(b.xmin, b.zmin, b.xmax, b.zmax);
      slot.imageBounds.value.set(image.xmin, image.zmin, image.xmax, image.zmax);
      slot.tileId = tile.id; slot.ready.value = true; slot.opacity.value = 0; slot._fadeStart = null;
      this._refreshEdges();
      this.stats.publishedTiles++; this.stats.sourcePixelBytesPublished += pixels.byteLength;
    } catch (error) {
      if (error?.name !== 'AbortError' && !controller.signal.aborted && !this._disposed) {
        this._failed.add(tile.id); this.stats.failed++; this.stats.lastError = { tile: tile.id, message: String(error.message || error) };
      }
    } finally {
      clearTimeout(request.timer);
      if (slot.requestId === serial) slot.requestId = null;
      if (this._requests.get(tile.id) === request) this._requests.delete(tile.id);
      this._pump();
    }
  }

  retryFailed() { if (!this._disposed) { this._failed.clear(); this._pump(); } }

  async whenSettled() {
    while (this._promises.size) await Promise.all([...this._promises]);
  }

  get profile() {
    return { ...this.stats, disposed: this._disposed, supported: this.supported, active: this.enabled.value,
      pending: this._requests.size, wanted: [...this._desired.keys()],
      residents: this.slots.filter(s => s.ready.value).map(s => ({ layer: s.layer, tile: s.tileId, opacity: s.opacity.value })),
      failedTiles: [...this._failed] };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.enabled.value = false; this._desired.clear();
    for (const request of this._requests.values()) {
      clearTimeout(request.timer);
      if (!request.controller.signal.aborted) { request.controller.abort(); this.stats.aborted++; }
    }
    for (const slot of this.slots) { slot.ready.value = false; slot.opacity.value = 0; slot.tileId = null; }
    this.texture.dispose(); this.texture.image.data = null; this.texture.onUpdate = null;
    this._data = null; this.stats.cpuBackingBytes = 0; this.stats.logicalGPUBytesWithMips = 0;
  }
}

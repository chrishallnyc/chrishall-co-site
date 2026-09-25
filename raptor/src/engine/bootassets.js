// Static assets are selected independently of Auto's cached/live render tier.
// The source loader may use terrainSourcePreset once its assets are enabled;
// this module never loads or swaps a geographic field.
import { tierParams } from './quality.js';

export const ASSET_PROFILE_VERSION = 'boot-assets-v3/near-grid-v1/cirrus-v4/fine-ocean-v2/cloud-noise-v2/geographic-imagery-v1';

export function cirrusAtlasResolution(tier, textureLimit = 8192) {
  return (tier === 'HIGH' || tier === 'ULTRA') && textureLimit >= 8192 ? 8192 : 2048;
}

export function oceanFineResolution(tier, override = null) {
  if (override === '0') return 0;
  if (override === '128') return 128;
  if (override === '256') return 256;
  if (override === '512') return 512;
  return tier === 'HIGH' || tier === 'ULTRA' ? 512 : 128;
}

export function terrainSourcePreset(tier, override = null, front = 'NELLIS', backend = 'webgpu') {
  if (front !== 'VALDEZ') return '0';
  if (['0', '16'].includes(override)) return override;
  if (backend !== 'webgpu') return '0';
  return tier === 'HIGH' || tier === 'ULTRA' ? '16' : '0';
}

export function requestedBootAssets(tier, { backend, front, flags,
  hasTerrain = true, hasOcean = true, sourceEnabled = false, textureLimit = 8192 } = {}) {
  const noise = flags?.get('cloudnoise');
  const highDetail = tier === 'HIGH' || tier === 'ULTRA';
  return {
    cirrus: cirrusAtlasResolution(tier, textureLimit),
    noise: ['standard', 'high', 'ultra'].includes(noise) ? noise : tierParams(tier).cloudNoise,
    fineOcean: hasOcean && backend === 'webgpu' && flags?.get('ocean') !== 'gerstner'
      ? oceanFineResolution(tier, flags?.get('waterfine')) : 0,
    source: sourceEnabled && hasTerrain
      ? terrainSourcePreset(tier, flags?.get('terrainsource'), front, backend) : '0',
    photo: hasTerrain && highDetail && front === 'VALDEZ'
      && flags?.get('terrainmaterials') !== '0' && flags?.get('terrainphoto') !== '0',
    geographic: hasTerrain && highDetail && front === 'NELLIS' && backend === 'webgpu'
      && flags?.get('drape') !== '0' && flags?.get('geographicdetail') !== '0',
  };
}

function imageSize(texture) {
  const image = texture?.image;
  return image ? [image.width || image.naturalWidth || 0, image.height || image.naturalHeight || 0] : null;
}

function imageryIdentity(stream) {
  if (!stream) return null;
  const meta = stream.manifest;
  // Resident tiles and fade/upload counters change during flight. The
  // validated source geometry and content hashes identify the fixed pack.
  return {
    supported: stream.supported,
    schema: meta.schema, front: meta.front,
    imagePixels: meta.imagePixels, metresPerPixel: meta.metresPerPixel,
    grid: [meta.rows, meta.columns], tileSizeM: meta.tileSizeM, gutterPixels: meta.gutterPixels,
    worldBounds: { ...meta.worldBounds },
    tiles: meta.tiles.map(tile => [tile.id, tile.sha256]),
  };
}

function photoIdentity(detail) {
  if (!detail) return null;
  const { version, status, requested, eligible, hashes } = detail.diagnostics();
  return { version, status, requested, eligible, hashes: hashes ? { ...hashes } : null };
}

// Called only after the loaders settle. Missing/fallback data receives a
// different profile from a successful full asset load on the next boot.
export function describeBootAssets({ bootTier, terrain = null, water = null,
  fftOcean = false, fineOcean = null, cloudNoise = null, cloudMode = 'billboard', sky = null } = {}) {
  const source = terrain?.sourceField?.meta;
  const drape = terrain?.drape;
  return Object.freeze({
    version: ASSET_PROFILE_VERSION,
    bootTier,
    sky: sky ? { cirrus: { dimensions: imageSize(sky.cirrusAtlas),
      source: sky.cirrusAtlas.userData.source, requested: sky.cirrusAtlas.userData.requestedResolution } } : null,
    terrain: terrain ? {
      grid: terrain.meta.grid,
      nearCapability: !!terrain.nearDetail,
      source: source ? { id: source.provenance?.sourceId ?? null,
        crop: source.sourceCrop ? { row: source.sourceCrop.row, col: source.sourceCrop.col,
          size: source.sourceCrop.size } : null, width: source.width, height: source.height,
        sha256: source.heightPackedSHA256 || source.heightSHA256 || null,
        normalSHA256: source.normalPixelsSHA256 || null } : null,
      drape: { albedo: imageSize(drape?.albedo), cover: imageSize(drape?.cover),
        normal: imageSize(drape?.nrm), ao: imageSize(drape?.ao) },
      imagery: imageryIdentity(terrain.geographicImagery),
      photo: photoIdentity(terrain.photoDetail),
    } : null,
    ocean: !water ? null : { mode: fftOcean ? 'fft' : 'gerstner',
      macroN: fftOcean ? 256 : 0, fineN: fftOcean ? fineOcean?.N || 0 : 0,
      fineTileM: fftOcean ? fineOcean?.tileM || 0 : 0, spectrum: 1 },
    clouds: { mode: cloudMode, version: cloudNoise?.version ?? null, seed: cloudNoise?.seed ?? null,
      normalization: cloudNoise?.normalization
        ? [cloudNoise.normalization.lo, cloudNoise.normalization.hi] : null,
      resolution: cloudNoise?.resolution ?? null,
      baseN: cloudNoise?.baseN ?? null, detailN: cloudNoise?.detailN ?? null },
  });
}

export function assetsNeedReload(bootRequest, nextRequest, shadowStats = null) {
  return bootRequest.cirrus !== nextRequest.cirrus
    || bootRequest.noise !== nextRequest.noise
    || bootRequest.fineOcean !== nextRequest.fineOcean
    || bootRequest.source !== nextRequest.source
    || bootRequest.photo !== nextRequest.photo
    || bootRequest.geographic !== nextRequest.geographic
    // Shadow resolution stays fixed for the compiled target's lifetime.
    // Disabled shadows need no resize; enabling them can reveal a mismatch
    // even when both tiers use the same texture assets (LOW -> MED).
    || (shadowStats?.requestedShadowSize > 0
      && shadowStats.requestedShadowSize !== shadowStats.allocatedShadowSize);
}

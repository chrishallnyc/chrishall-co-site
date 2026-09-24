// Change this default only after the reduced-resolution path passes visual
// and two-target GPU comparisons. The native compositor remains available.
export const DEFAULT_CLOUD_MODE = 'native';
import { tierParams } from './quality.js';

// No-flag WebGPU now uses reversed depth + raw nearest-depth selection.
// Old timing records measured a different default even with the same assets.
export const QUALITY_PROFILE_VERSION = 'graphics-depth-v2';

export function cloudQuality(tier, { mode = DEFAULT_CLOUD_MODE, scale, noise } = {}) {
  if (mode !== 'native' && mode !== 'adaptive') throw new Error('Unknown cloud mode');
  if (scale !== undefined && (!Number.isFinite(scale) || scale < .5 || scale > 1)) {
    throw new Error('Cloud scale must be between 0.5 and 1');
  }
  if (noise !== undefined && noise !== 'standard' && noise !== 'ultra') throw new Error('Unknown cloud noise resolution');
  const params = tierParams(tier);
  return Object.freeze({ mode,
    scale: mode === 'native' ? 1 : (scale ?? params.cloudScale),
    noise: noise ?? params.cloudNoise,
  });
}

export function cloudOptionsFromFlags(flags) {
  const mode = flags.get('cloudmode');
  const value = flags.get('cloudscale');
  const scale = value === null ? undefined : Number(value);
  const noise = flags.get('cloudnoise');
  return {
    mode: mode === 'native' || mode === 'adaptive' ? mode : DEFAULT_CLOUD_MODE,
    ...(Number.isFinite(scale) && scale >= .5 && scale <= 1 ? { scale } : {}),
    ...(noise === 'standard' || noise === 'ultra' ? { noise } : {}),
  };
}

// A saved timing applies only to this workload. Asset and compositor choice
// are fixed before materials compile; runtime quality changes scale only.
export function qualityProfile({ backend, mode, renderScale, pixelRatio, scale, noise, width, height,
  front = 'NELLIS', workload = '', assets = null }) {
  return `${QUALITY_PROFILE_VERSION}/${backend}/${mode}/${scale ?? 'tier'}/${noise ?? 'tier'}/${renderScale ?? 'tier'}/${Math.min(pixelRatio || 1, 2)}/${width ?? 'unknown'}x${height ?? 'unknown'}/${front}/${workload}/${assets ? encodeURIComponent(JSON.stringify(assets)) : 'assets-unspecified'}`;
}

// A sky-only, flat-world, or fallback QA run must not select the saved tier
// for the full game. Pose/time still vary within a front; this key isolates
// distinct rendering paths, not every possible view of the same workload.
export function qualityWorkload(flags) {
  return ['post', 'vclouds', 'atmo', 'curvature', 'noterrain', 'nowater', 'waterenv',
    'ocean', 'waterfine', 'watergrid', 'waterslopes', 'watershadow', 'waterenvsize',
    'terrainnear', 'drape', 'snowdetail', 'terrainmaterials', 'terrainsource', 'cloudshadow', 'cloudtransport', 'ao', 'chain', 'reversedepth', 'logdepth', 'rawtaa', 'nobattle', 'nomatch']
    .filter(key => flags.has(key))
    .map(key => `${key}=${encodeURIComponent(flags.get(key))}`).join('&');
}

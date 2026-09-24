import * as THREE from "three";
import { Fn, cameraPosition, float, vec2, vec3, dot, normalize, max, abs, sqrt, select, exp, pow, smoothstep, fwidth, texture, time } from "three/tsl";
import { DARK_SKY_RADIANCE } from "./celestial.js";

const PLANET_RADIUS_KM = 6360;
const CIRRUS_ALTITUDE_KM = 10;
const CIRRUS_RADIUS_KM = PLANET_RADIUS_KM + CIRRUS_ALTITUDE_KM;
const CIRRUS_PERIOD_M = 120000;

let cirrusAtlas;
export function getCirrusAtlas(resolution = 2048) {
  if (cirrusAtlas) return cirrusAtlas;
  // An offline density atlas preserves natural tapered fibres at several
  // scales. Mip filtering integrates distant strands instead of aliasing
  // thresholded shader noise. A black placeholder keeps failed loads clear.
  cirrusAtlas = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
  cirrusAtlas.colorSpace = THREE.NoColorSpace;
  cirrusAtlas.wrapS = cirrusAtlas.wrapT = THREE.RepeatWrapping;
  cirrusAtlas.minFilter = THREE.LinearMipmapLinearFilter;
  cirrusAtlas.magFilter = THREE.LinearFilter;
  cirrusAtlas.generateMipmaps = true;
  cirrusAtlas.flipY = false;
  cirrusAtlas.needsUpdate = true;
  // This singleton is selected once by Sky at boot; celestial transmission
  // and both atmosphere paths reuse the same object and opacity field.
  const atlas = cirrusAtlas;
  atlas.userData.requestedResolution = resolution;
  atlas.userData.source = 'placeholder';
  atlas.userData.ready = typeof document === 'undefined' ? Promise.resolve(false) : new Promise(resolve => {
    const failed = size => {
      if (size === 8192) load(2048);
      else resolve(false);
    };
    const load = size => new THREE.ImageLoader().load(new URL(size === 8192
      ? '../../assets/clouds/cirrus-density-8k.png' : '../../assets/clouds/cirrus-density.png', import.meta.url).href, image => {
      let canvas = null, loaded = false;
      try {
      if (image.width !== size || image.height !== size) throw new Error('Unexpected cirrus dimensions');
      canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      const density = new Uint8Array(image.width * image.height);
      for (let i = 0; i < density.length; i++) density[i] = rgba[i * 4];
      // A placeholder may already own immutable 1x1 storage on either backend.
      atlas.dispose();
      atlas.image = { data: density, width: image.width, height: image.height };
      atlas.userData.source = size === resolution ? 'asset' : 'fallback';
      atlas.needsUpdate = true;
      loaded = true;
      } catch (_) { /* Retry the smaller atlas, then retain a clear sky. */ }
      finally { if (canvas) canvas.width = canvas.height = 1; }
      if (loaded) resolve(true); else failed(size);
    }, undefined, () => failed(size));
    load(resolution);
  });
  return cirrusAtlas;
}

// The observer's geometric horizon dips below the horizontal in flight.
// Clip each pixel of a finite source against it, rather than fading the
// whole solar disc at one sea-level elevation. Refraction is not modeled.
export const horizonVisibility = Fn(([dir]) => {
  const radius = max(cameraPosition.y, 0).mul(0.001).add(PLANET_RADIUS_KM);
  const horizon = sqrt(max(float(1).sub(float(PLANET_RADIUS_KM).div(radius).pow(2)), 0)).negate();
  const edge = max(fwidth(dir.y).mul(0.5), 0.00001);
  return smoothstep(horizon.sub(edge), horizon.add(edge), dir.y);
});


export function cirrusOpticalDepthNode(atlas = getCirrusAtlas()) {
  return Fn(([dir]) => {
    const cameraRadius = max(cameraPosition.y, 0).mul(0.001).add(PLANET_RADIUS_KM);
    const b = cameraRadius.mul(dir.y);
    const c = cameraRadius.mul(cameraRadius).sub(CIRRUS_RADIUS_KM * CIRRUS_RADIUS_KM);
    const discriminant = b.mul(b).sub(c);
    const root = sqrt(max(discriminant, 0));
    const near = b.negate().sub(root), far = b.negate().add(root);
    const distance = select(near.greaterThan(0), near, far);
    const valid = select(discriminant.greaterThanEqual(0).and(distance.greaterThan(0)), 1, 0);
    const hit = vec3(0, cameraRadius, 0).add(dir.mul(max(distance, 0)));
    const up = normalize(hit);
    const worldXZ = cameraPosition.xz.add(hit.xz.mul(1000)).sub(vec2(18, 7).mul(time));
    const density = texture(atlas, worldXZ.div(CIRRUS_PERIOD_M).add(0.5)).r;
    const slant = float(1).div(max(abs(dot(dir, up)), 0.30));
    // Distance haze hides repeated tiles at very low angles. Fade through
    // the zero-thickness sheet while crossing it; volumetric immersion is
    // deliberately the responsibility of the existing lower cloud deck.
    const farFade = float(1).sub(smoothstep(80, 190, distance));
    const crossing = smoothstep(0.03, 0.30, abs(cameraRadius.sub(CIRRUS_RADIUS_KM)));
    return density.mul(0.22).mul(slant).mul(valid).mul(farFade).mul(crossing).mul(horizonVisibility(dir));
  });
}

// Exact same projected optical depth for stars, the Moon, and the sky.
export const cirrusTransmission = Fn(([dir]) => exp(cirrusOpticalDepthNode()(dir).negate()));

// Stable finite air mass near the horizon. RGB extinction preserves warm
// low stars and the Moon's copper horizon tint; it is never an opacity fade
// tied only to the Sun's elevation.
export const stellarAirTransmission = Fn(([dir]) => {
  const mu = max(dir.y, 0);
  const airMass = float(1).div(mu.add(exp(mu.mul(-11)).mul(0.025)));
  const altitude = max(cameraPosition.y, 0);
  const tau = vec3(0.0464, 0.1085, 0.2648).mul(exp(altitude.div(-8000)))
    .add(exp(altitude.div(-1200)).mul(0.025));
  return exp(tau.mul(airMass).negate()).mul(horizonVisibility(dir));
});

// Thin mesopause emission shell (van Rhijn path length). This radiance is
// physically tiny: darkness remains dark until the exposure adapts. There
// is no max(gradient, blueColor) floor and no procedural luminous nebula.
export const airglowRadiance = Fn(([dir]) => {
  const radius = max(cameraPosition.y, 0).mul(0.001).add(PLANET_RADIUS_KM);
  const ratio = radius.div(PLANET_RADIUS_KM + 90);
  const vanRhijn = float(1).div(sqrt(max(float(1).sub(ratio.pow(2).mul(float(1).sub(dir.y.pow(2)))), 0.01)));
  const transmission = pow(stellarAirTransmission(dir), vec3(0.20));
  return vec3(0.78, 1.06, 0.91).mul(DARK_SKY_RADIANCE).mul(vanRhijn).mul(transmission).mul(horizonVisibility(dir));
});

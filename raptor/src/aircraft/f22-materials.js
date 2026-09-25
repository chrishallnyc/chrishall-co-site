import * as THREE from 'three';
import { createCoatingDetail } from './coating-detail.js';

const textureSets = new Map();

// 4K colour is reserved for the close aircraft. Normal/ORM data is half that
// resolution; lower quality variants are baked rather than resized at boot.
export function createF22Coating(kind = 'body', quality = 'high') {
  if (!['body', 'lifting'].includes(kind)) throw new Error(`Unknown F-22 atlas: ${kind}`);
  if (!['high', 'medium', 'low'].includes(quality)) quality = 'high';
  const key = `${kind}-${quality}`;
  let textures = textureSets.get(key);
  if (!textures) {
    const loader = new THREE.TextureLoader(), ready = [];
    textures = {};
    for (const channel of ['color', 'normal', 'orm']) {
      const url = new URL(`./textures/f22/${kind}-${quality}-${channel}.png`, import.meta.url).href;
      let texture;
      const promise = new Promise((resolve, reject) => {
        texture = loader.load(url, resolve, undefined, reject);
      });
      texture.name = `F-22 ${kind} ${quality} ${channel}`;
      texture.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = quality === 'low' ? 4 : 8;
      texture.channel = 0;
      textures[channel] = texture; ready.push(promise);
    }
    textures.ready = Promise.all(ready);
    // Preserve an observable rejected ready promise for QA, while avoiding
    // an unhandled rejection when the synchronous game builder is used.
    textures.ready.catch(error => console.error('[F-22] Coating load failed:', error));
    textureSets.set(key, textures);
  }
  const detail = createCoatingDetail(quality);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: textures.color, normalMap: textures.normal,
    // The authoring tool now differentiates millimetre relief in metres.
    // Preserve those slopes instead of attenuating an arbitrary height field.
    normalScale: new THREE.Vector2(.82, .82),
    aoMap: textures.orm, aoMapIntensity: .6,
    roughnessMap: textures.orm, roughness: 1,
    metalnessMap: textures.orm, metalness: 1, envMapIntensity: .95,
    specularIntensity: .90, specularColor: new THREE.Color(0xf0efeb),
    clearcoat: detail ? .10 : .045, clearcoatRoughness: .71,
    clearcoatNormalMap: detail?.normal ?? null,
    clearcoatNormalScale: new THREE.Vector2(.55, .55),
    clearcoatRoughnessMap: detail?.roughness ?? null,
  });
  material.name = `F-22 layered ${kind} ${quality} service coating`;
  material.userData.f22Coating = { revision: 2, atlas: kind, quality,
    normalUnits: 'metres', microTileMetres: detail?.tileMetres ?? null };
  return { material, ready: textures.ready };
}

// Small shared response maps for the formed nozzle sheets. They describe
// longitudinal brushing and oxidation, without painting light onto the metal.
import * as THREE from 'three';

const resources = new Map();
function grain(x, y) {
  let n = Math.imul(x + 487, 374761393) ^ Math.imul(y + 97, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function trackNoise(u, count, seed) {
  const x=u*count,i=Math.floor(x),t=x-i,s=t*t*(3-2*t);
  const a=grain(i%count,seed),b=grain((i+1)%count,seed);return a+(b-a)*s;
}

export function f119Detail(quality) {
  if (quality === 'low') return null;
  if (resources.has(quality)) return resources.get(quality);
  const width = quality === 'medium' ? 128 : 256, height = width / 2;
  const normal = new Uint8Array(width * height * 4), response = new Uint8Array(normal.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4;
    // Long brush tracks with a weak, slow change along the gas-flow direction.
    // Widths are intentionally below the geometry's formed seam scale.
    const track = (trackNoise(u,37,1)-.5)*1.2+(trackNoise(u,103,2)-.5)*.45;
    const cloud = Math.sin(u * Math.PI * 8 + .4 * Math.sin(v * Math.PI * 2));
    const roughness = .84 + .045 * track + .025 * cloud + .006 * (grain(x, y) - .5);
    response.set([255, Math.round(roughness * 255), 0, 255], i);
    const nx = .020*(trackNoise((u+1/width)%1,37,1)-trackNoise((u+1-1/width)%1,37,1));
    const ny = .0006 * Math.sin(v * Math.PI * 4 + u * Math.PI * 2);
    const inv = 1 / Math.hypot(nx, ny, 1);
    normal.set([Math.round((nx * inv * .5 + .5) * 255),
      Math.round((ny * inv * .5 + .5) * 255), Math.round((inv * .5 + .5) * 255), 255], i);
  }
  const texture = (data, name) => {
    const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    map.name = `F119 ${quality} ${name}`; map.colorSpace = THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = quality === 'medium' ? 4 : 8;
    map.needsUpdate = true; return map;
  };
  const result = {normal: texture(normal, 'brushed normal'), roughness: texture(response, 'oxide roughness')};
  resources.set(quality, result);
  return result;
}

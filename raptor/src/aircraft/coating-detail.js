// Shared, metre-scaled topcoat detail. Small non-colour textures describe
// physical response only: no fake lighting, dirt, or per-frame raster work.
import * as THREE from 'three';

const sets = new Map();
const TILE_METRES = .48;

function hash(x, y) {
  let n = Math.imul(x + 379, 374761393) ^ Math.imul(y + 917, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// Periodic smooth noise keeps the small tile continuous across mip levels.
function noise(u, v, cellsX, cellsY) {
  const x = u * cellsX, y = v * cellsY, ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const at = (a, b) => hash((a % cellsX + cellsX) % cellsX, (b % cellsY + cellsY) % cellsY);
  const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
  const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

export function createCoatingDetail(quality) {
  if (quality === 'low') return null;
  if (sets.has(quality)) return sets.get(quality);
  const size = quality === 'medium' ? 256 : 512;
  const heights = new Float32Array(size * size), normal = new Uint8Array(size * size * 4);
  const response = new Uint8Array(normal.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    // Micrometre relief, deliberately much finer and weaker than panel gaps.
    heights[i] = (noise(u, v, 18, 26) - .5) * .000045
      + (noise(u, v, 113, 97) - .5) * .000014;
    const gloss = .87 + (noise(u, v, 11, 71) - .5) * .16
      + (noise(u, v, 113, 97) - .5) * .06;
    // r185's node material samples clearcoat roughness from R. This is a
    // dedicated scalar map, so replicate it in RGB for both node rendering
    // and the conventional material channel convention; never pack it as ORM.
    const value = Math.round(gloss * 255);
    response.set([value, value, value, 255], i * 4);
  }
  const texel = TILE_METRES / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (a, b) => heights[((b + size) % size) * size + (a + size) % size];
    const nx = (at(x - 1, y) - at(x + 1, y)) / (2 * texel);
    const ny = (at(x, y - 1) - at(x, y + 1)) / (2 * texel);
    const inv = 1 / Math.hypot(nx, ny, 1);
    normal.set([Math.round((nx * inv * .5 + .5) * 255),
      Math.round((ny * inv * .5 + .5) * 255), Math.round((inv * .5 + .5) * 255), 255], (y * size + x) * 4);
  }
  const texture = (data, name) => {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    map.name = `F-22 ${quality} ${name}`;
    map.colorSpace = THREE.NoColorSpace;
    map.channel = 1; // uv1 contains neutral-surface distances in metres.
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1 / TILE_METRES, 1 / TILE_METRES);
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = quality === 'medium' ? 4 : 8;
    map.needsUpdate = true;
    return map;
  };
  const detail = { normal: texture(normal, 'topcoat micro normal'),
    roughness: texture(response, 'topcoat application response'), tileMetres: TILE_METRES };
  sets.set(quality, detail);
  return detail;
}

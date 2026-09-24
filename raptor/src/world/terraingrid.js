// Nested 127/254-interval grids. Fine boundary odd vertices are collapsed
// to coarse vertices in the index buffer, so every new outer edge exactly
// matches the existing coarse grid. The skirt remains a separate ring.
import * as THREE from 'three';
export const TERRAIN_COARSE_INTERVALS = 127;
export const TERRAIN_FINE_INTERVALS = TERRAIN_COARSE_INTERVALS * 2;
export const TERRAIN_DETAIL_FULL_M = 600;
export const TERRAIN_DETAIL_END_M = 1600;
export const TERRAIN_DETAIL_SELECT_M = 1800;
export function createTerrainGrid(intervals = TERRAIN_COARSE_INTERVALS) {
  const fine = intervals === TERRAIN_FINE_INTERVALS;
  if (intervals !== TERRAIN_COARSE_INTERVALS && !fine) throw new RangeError('Unsupported terrain grid');
  const n = intervals + 3, verts = [], skirt = [], index = [];
  for (let j=0;j<n;j++) for (let i=0;i<n;i++) {
    verts.push(Math.min(Math.max(i-1,0),intervals)/intervals-.5, 0,
      Math.min(Math.max(j-1,0),intervals)/intervals-.5);
    skirt.push(i===0||j===0||i===n-1||j===n-1?1:0);
  }
  const id = (i,j) => {
    if (fine) {
      if ((j<=1||j>=n-2) && i>1 && i<n-2 && (i-1)%2) i--;
      if ((i<=1||i>=n-2) && j>1 && j<n-2 && (j-1)%2) j--;
    }
    return j*n+i;
  };
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++) {
    const a=id(i,j),b=id(i+1,j),c=id(i,j+1),d=id(i+1,j+1);
    if(a!==c&&c!==b&&b!==a)index.push(a,c,b);
    if(b!==c&&c!==d&&d!==b)index.push(b,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geometry.setAttribute('skirt',new THREE.Float32BufferAttribute(skirt,1));
  geometry.setAttribute('terrainDetail',new THREE.Float32BufferAttribute(new Float32Array(n*n).fill(fine?1:0),1));
  geometry.setIndex(index);
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e9);
  geometry.userData.terrainIntervals=intervals;
  return geometry;
}

// Tiny procedural sprite textures (no assets). The instanced smoke/trail
// quads read as hard squares without an alpha falloff — a radial soft disc
// fixes all of them at once (missile trails, SAM plumes, wreck smoke).

import * as THREE from "three";

let _soft = null;
export function softDiscTexture() {
  if (_soft) return _soft;
  const N = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const cx = cv.getContext("2d");
  const g = cx.createRadialGradient(N / 2, N / 2, N * 0.08, N / 2, N / 2, N * 0.5);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, N, N);
  _soft = new THREE.CanvasTexture(cv);
  _soft.colorSpace = THREE.NoColorSpace;
  return _soft;
}

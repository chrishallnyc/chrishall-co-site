// Render-only F119 exhaust: a bounded radiance volume plus a recessed glow.
// Geometry remains attached to the vectoring nozzle; no simulation writes.
import * as THREE from 'three';
import { createEngineVolume, updateEngineVolume } from './exhaust-volume.js';

let resources;
function plumeResources() {
  if (resources) return resources;
  const glowSize = 128, glow = new Uint8Array(glowSize * glowSize * 4);
  for (let y = 0; y < glowSize; y++) for (let x = 0; x < glowSize; x++) {
    const u = (x + .5) / glowSize * 2 - 1, v = (y + .5) / glowSize * 2 - 1;
    const edge = Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)) ** 2);
    const center = Math.exp(-((u * u + v * v) * 2));
    const i = (y * glowSize + x) * 4;
    glow[i] = 255; glow[i + 1] = 142 + Math.round(103 * center);
    glow[i + 2] = 60 + Math.round(165 * center); glow[i + 3] = Math.round(255 * edge * Math.sqrt(center));
  }
  const glowTexture = new THREE.DataTexture(glow, glowSize, glowSize);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.magFilter = THREE.LinearFilter; glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  resources = { glowTexture, glowGeometry: new THREE.PlaneGeometry(1.02, .46) };
  return resources;
}

export function createExhaustPlume(anchor, side = 0) {
  const r = plumeResources(), group = new THREE.Group();
  group.name = 'F119-exhaust'; group.position.copy(anchor.position);
  group.userData.aircraftEffect = true; group.visible = false;
  const volume = createEngineVolume(); group.add(volume.mesh);
  const glowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.35, 1.35, 1.35),
    map: r.glowTexture, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false });
  const glow = new THREE.Mesh(r.glowGeometry, glowMaterial);
  glow.name = 'afterburner-throat-radiance';
  // This sits inside the convergent section, so the paddles occlude it.
  glow.position.z = -.90; group.add(glow);
  anchor.parent.add(group);
  return { group, volume, glow, side };
}

export function updateExhaustPlume(plume, stage, length, time, cameraPosition) {
  plume.group.visible = stage > .005;
  if (!plume.group.visible) return;
  const flicker = 1 + .035 * Math.sin(time * 43 + plume.side * 3) + .018 * Math.sin(time * 89 + plume.side);
  updateEngineVolume(plume.volume, stage * flicker, length, time + plume.side * .13, cameraPosition);
  plume.glow.material.opacity = stage * (.62 + .06 * flicker);
}

import { REVISION } from 'three';

const installed = new WeakSet();

// r185 reverses each sorted render list for reverse depth. That also reverses
// explicit group/render priorities and stable IDs: stars then draw over clouds.
// Counter-reverse those keys here, leaving the distance comparison unchanged
// so the renderer's final reversal still gives the correct depth order.
// Install after renderer.init(), when WebGL's clip-control support is known.
export function installReversedDepthOrderGuard(renderer) {
  if (REVISION !== '185' || !renderer.reversedDepthBuffer || installed.has(renderer)) return false;
  const priority = (a, b) => b.groupOrder - a.groupOrder || b.renderOrder - a.renderOrder;
  renderer.setOpaqueSort((a, b) => priority(a, b) || a.z - b.z || b.id - a.id);
  renderer.setTransparentSort((a, b) => priority(a, b) || b.z - a.z || b.id - a.id);
  installed.add(renderer);
  return true;
}

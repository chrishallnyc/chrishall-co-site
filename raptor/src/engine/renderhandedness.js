import { REVISION } from 'three';

const cameras = new WeakSet();
const backends = new WeakSet();

// Simulation is east/north/up; existing world assets use east/up/north.
// That axis swap is a reflection. Keep the established world/simulation
// contracts and present them with a reflected view: east is screen-right
// when looking north. Projection and its inverse remain ordinary, so HUD
// projection, picking, temporal history and depth reconstruction agree.
export function useENUCamera(camera) {
  if (cameras.has(camera)) return camera;
  if (REVISION !== '185' || !camera?.isCamera)
    throw new Error('ENU camera requires the pinned Three r185 camera contract.');
  const update = camera.updateMatrixWorld;
  const updateWorld = camera.updateWorldMatrix;
  const clone = camera.clone;
  // r185 Camera intentionally removes scale when building its inverse.
  // Preserve this one intentional reflection after BOTH update paths.
  camera.updateMatrixWorld = function (...args) {
    update.apply(this, args);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  };
  camera.updateWorldMatrix = function (...args) {
    updateWorld.apply(this, args);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  };
  camera.clone = function (...args) { return useENUCamera(clone.apply(this, args)); };
  camera.scale.x = -Math.abs(camera.scale.x);
  cameras.add(camera);
  camera.updateMatrixWorld(true);
  return camera;
}

function reflectedView(renderObject) {
  return (renderObject.camera?.matrixWorldInverse.determinantAffine() ?? 1) < 0;
}

// Three accounts for mirrored objects when choosing front-face winding,
// but assumes an ordinary camera. Include view parity as well. This is
// scoped per render object/camera: shadow, environment and fullscreen
// cameras keep their own winding. Do not edit the pinned vendor bundle.
export function installCameraHandedness(renderer) {
  const backend = renderer?.backend;
  if (backends.has(backend)) return false;
  if (REVISION !== '185') throw new Error('Camera handedness adapter requires Three r185.');
  if (backend?.isWebGPUBackend) {
    const pipeline = backend.pipelineUtils;
    const primitive = pipeline?._getPrimitiveState;
    const create = backend.createRenderPipeline;
    const cacheKey = backend.getRenderCacheKey;
    const needsUpdate = backend.needsRenderUpdate;
    if (![primitive, create, cacheKey, needsUpdate].every(fn => typeof fn === 'function'))
      throw new Error('Unsupported WebGPU camera handedness contract.');
    let reflected = false;
    const parity = new WeakMap();
    pipeline._getPrimitiveState = function (...args) {
      const state = primitive.apply(this, args);
      if (reflected) state.frontFace = state.frontFace === 'cw' ? 'ccw' : 'cw';
      return state;
    };
    backend.createRenderPipeline = function (renderObject, ...args) {
      const previous = reflected;
      reflected = reflectedView(renderObject);
      parity.set(renderObject, reflected);
      try { return create.call(this, renderObject, ...args); }
      finally { reflected = previous; }
    };
    backend.getRenderCacheKey = function (renderObject) {
      const mirrored = reflectedView(renderObject);
      parity.set(renderObject, mirrored);
      return `${cacheKey.call(this, renderObject)},view-reflected:${Number(mirrored)}`;
    };
    backend.needsRenderUpdate = function (renderObject) {
      const changed = needsUpdate.call(this, renderObject);
      const mirrored = reflectedView(renderObject);
      const previous = parity.get(renderObject);
      parity.set(renderObject, mirrored);
      return changed || previous !== mirrored;
    };
  } else if (backend?.isWebGLBackend) {
    const draw = backend.draw;
    const material = backend.state?.setMaterial;
    if (typeof draw !== 'function' || typeof material !== 'function')
      throw new Error('Unsupported WebGL camera handedness contract.');
    let reflected = false;
    backend.state.setMaterial = function (value, objectReflected, ...args) {
      return material.call(this, value, Boolean(objectReflected) !== reflected, ...args);
    };
    backend.draw = function (renderObject, ...args) {
      const previous = reflected;
      reflected = reflectedView(renderObject);
      try { return draw.call(this, renderObject, ...args); }
      finally { reflected = previous; }
    };
  } else throw new Error('Unsupported renderer for ENU camera handedness.');
  backends.add(backend);
  return true;
}

export function installENUView(renderer, camera) {
  installCameraHandedness(renderer);
  return useENUCamera(camera);
}

// F-22 models are authored in the ordinary right-handed frame (-Z nose,
// +X starboard). Their outer +Z-forward flight frame needs the same axis
// reflection as the view to preserve aircraft chirality and readable paint.
// Bandit models already author +Z nose/+X starboard; do not reflect those.
export function useENUF22Frame(group) {
  group.scale.x = -Math.abs(group.scale.x);
  return group;
}

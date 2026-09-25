import { REVISION } from 'three';

const installed = new WeakSet();

// r185's WebGL attribute uploader binds then unbinds ELEMENT_ARRAY_BUFFER
// without invalidating the cached VAO/index state. During the first full
// scene frame this can erase the terrain VAO's index binding; subsequent
// tiles then skip rebinding because the cache still claims it is present.
// Isolate index uploads on the default VAO using the backend's own reset.
// This compatibility guard is deliberately revision-scoped and can be
// removed after an upstream renderer upgrade passes qa/game-lighting.mjs.
export function installWebGLIndexStateGuard(renderer) {
  const backend = renderer.backend;
  if (REVISION !== '185' || !backend?.isWebGLBackend || installed.has(backend)) return false;
  if (!backend.state?.resetVertexState || !backend.createIndexAttribute || !backend.updateAttribute) return false;
  const create = backend.createIndexAttribute;
  const update = backend.updateAttribute;
  backend.createIndexAttribute = function (attribute) {
    this.state.resetVertexState();
    return create.call(this, attribute);
  };
  backend.updateAttribute = function (attribute) {
    const storage = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    if (this.get(storage).bufferType === this.gl.ELEMENT_ARRAY_BUFFER)
      this.state.resetVertexState();
    return update.call(this, attribute);
  };
  installed.add(backend);
  return true;
}

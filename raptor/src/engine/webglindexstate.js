// Pinned Three r185 WebGL index uploads bind/unbind ELEMENT_ARRAY_BUFFER
// directly. That changes the active VAO while its cached index binding stays
// unchanged, so a subsequent shared-geometry draw can skip a required bind.
// Scope this repair to one renderer; WebGPU and ordinary attribute updates
// are untouched. Recheck this workaround when updating the vendored backend.
const installed = new WeakSet();

export function installWebGLIndexStateFix(renderer) {
  const backend = renderer.backend;
  if (!backend?.isWebGLBackend || installed.has(backend)) return false;
  const state = backend.state, gl = backend.gl;
  if (!state?.resetVertexState || !backend.createIndexAttribute || !backend.updateAttribute) return false;
  const create = backend.createIndexAttribute, update = backend.updateAttribute;
  backend.createIndexAttribute = function(attribute) {
    const result = create.call(this, attribute);
    // The old VAO's element binding may have changed during allocation.
    // Reset both actual GL binding and cache; the next draw rebinds its pair.
    state.resetVertexState();
    return result;
  };
  backend.updateAttribute = function(attribute) {
    const storage = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    const isIndex = this.get(storage).bufferType === gl.ELEMENT_ARRAY_BUFFER;
    const result = update.call(this, attribute);
    if (isIndex) state.resetVertexState();
    return result;
  };
  installed.add(backend);
  return true;
}

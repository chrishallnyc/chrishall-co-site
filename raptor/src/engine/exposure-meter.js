// Display-referred exposure feedback from an already-rendered HDR texture.
// The tiny draw has no pass-node dependencies; readback never blocks a frame.
import * as THREE from "three";
import { Fn, uniform, texture, uv, vec2, vec3, vec4, toneMapping, workingToColorSpace } from "three/tsl";

export function displayLogAverage(bytes, size) {
  if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) throw new Error("Exposure readback must contain RGBA8 bytes.");
  const packedStride = size * 4;
  // The pinned WebGPU backend RETURNS the 256-byte padded rows rather than
  // stripping padding. WebGL/other backends can return tightly packed data.
  const paddedStride = Math.ceil(packedStride / 256) * 256;
  const paddedLength = (size - 1) * paddedStride + packedStride;
  if (bytes.byteLength !== size * packedStride && bytes.byteLength < paddedLength) throw new Error("Exposure readback has an unknown row stride.");
  const stride = bytes.byteLength >= paddedLength ? paddedStride : packedStride;
  if (bytes.byteLength < (size - 1) * stride + packedStride) throw new Error("Exposure readback is incomplete.");
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * stride + x * 4;
    const luma = (.2126 * bytes[i] + .7152 * bytes[i + 1] + .0722 * bytes[i + 2]) / 255;
    sum += Math.log(Math.max(luma, .001));
  }
  return Math.exp(sum / (size * size));
}

export function adaptExposure(multiplier, sampledMultiplier, average, target, elapsedSeconds) {
  const desired = THREE.MathUtils.clamp(sampledMultiplier * Math.pow(target / Math.max(average, .001), .6), .55, 2.3);
  // Same feedback law and 1s/3s rates as the existing meter. The elapsed
  // time is real accepted-sample time, not the most recent frame dt × 12.
  const duration = desired > multiplier ? 1 : 3;
  return multiplier + (desired - multiplier) * Math.min(Math.max(elapsedSeconds, 0) / duration, 1);
}

export class AsyncExposureMeter {
  constructor(renderer, getTexture, { size = 16, intervalSeconds = .2,
    now = () => performance.now() / 1000 } = {}) {
    if (![16, 32].includes(size)) throw new Error("Exposure target must be 16 or 32 pixels square.");
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error("Exposure interval must be positive.");
    this.renderer = renderer; this.getTexture = getTexture; this.size = size;
    this.intervalSeconds = intervalSeconds; this.now = now;
    this.state = { mult: 1, frame: 0, pending: false, samples: 0, requests: 0,
      discarded: 0, errors: 0, average: null, latencyMs: 0, drawCpuMs: 0, status: "ready" };
    this.disposed = false; this.disabled = false; this.generation = 0;
    this._lastLaunch = this._lastAccepted = now(); this._pending = null;
    this._released = false;
    this._placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this._source = texture(this._placeholder);
    this._exposure = uniform(renderer.toneMappingExposure).setName("meterCapturedExposure");
    this._target = new THREE.RenderTarget(size, size, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this._target.texture.name = "ExposureMeter.displayRGBA8";
    this._material = new THREE.NodeMaterial({ fog: false, depthTest: false, depthWrite: false, toneMapped: false });
    this._toneMapping = renderer.toneMapping; this._outputColorSpace = renderer.outputColorSpace;
    this._buildShader();
    this._quad = new THREE.QuadMesh(this._material);
  }

  get mult() { return this.state.mult; }

  _buildShader() {
    // Tone map/encode EACH stratified sample before averaging. Averaging
    // HDR first would let a tiny Sun/glint dominate a whole meter cell.
    const mapping = this._toneMapping, colorSpace = this._outputColorSpace;
    const displayColor = Fn(([hdr, capturedExposure]) => {
      const mapped = toneMapping(mapping, capturedExposure, vec4(hdr, 1));
      return workingToColorSpace(vec4(mapped.rgb, 1), colorSpace).rgb.clamp(0, 1);
    }).setLayout({ name: "meterDisplayColor", type: "vec3", inputs: [{ name: "hdr", type: "vec3" }, { name: "capturedExposure", type: "float" }] });
    this._material.fragmentNode = Fn(() => {
      const sum = vec3(0).toVar();
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const offset = vec2((x + .5) / 4 - .5, (y + .5) / 4 - .5).div(this.size);
        sum.addAssign(displayColor(this._source.sample(uv().add(offset)).level(0).rgb, this._exposure));
      }
      return vec4(sum.div(16), 1);
    })();
    this._material.needsUpdate = true;
  }

  // Call after post.post.render(), once the source's current image exists.
  // This function deliberately returns no promise and performs no await.
  update({ target = .42 } = {}) {
    if (this.disposed || this.disabled) return;
    const now = this.now(); this.state.frame++;
    if (this._pending || now - this._lastLaunch < this.intervalSeconds) return;
    if (!Number.isFinite(target) || target <= 0) return;
    let source;
    try { source = this.getTexture(); } catch (error) { this._fail(error); return; }
    if (!source?.isTexture || source.isNode || (source.image?.width || 0) < 2 || (source.image?.height || 0) < 2) return;
    const renderer = this.renderer;
    this._source.value = source;
    this._exposure.value = renderer.toneMappingExposure;
    if (this._toneMapping !== renderer.toneMapping || this._outputColorSpace !== renderer.outputColorSpace) {
      this._toneMapping = renderer.toneMapping; this._outputColorSpace = renderer.outputColorSpace;
      this._buildShader();
    }
    const sample = { generation: this.generation, multiplier: this.mult, target, started: now };
    this._lastLaunch = now;
    const old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), mrt: renderer.getMRT(),
      autoClear: renderer.autoClear, xr: renderer.xr?.enabled };
    const start = this.now();
    try {
      renderer.setMRT(null); renderer.autoClear = true;
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.setRenderTarget(this._target);
      this._quad.render(renderer);
    } catch (error) {
      this._fail(error); return;
    } finally {
      renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
      renderer.autoClear = old.autoClear; if (renderer.xr) renderer.xr.enabled = old.xr;
      this.state.drawCpuMs = (this.now() - start) * 1000;
    }
    this.state.pending = true; this.state.requests++;
    let readback;
    try { readback = renderer.readRenderTargetPixelsAsync(this._target, 0, 0, this.size, this.size); }
    catch (error) { this.state.pending = false; this._fail(error); return; }
    this._pending = Promise.resolve(readback).then(bytes => {
      if (this.disposed || sample.generation !== this.generation) { this.state.discarded++; return; }
      const now = this.now(), average = displayLogAverage(bytes, this.size);
      this.state.mult = adaptExposure(this.mult, sample.multiplier, average, sample.target, now - this._lastAccepted);
      this._lastAccepted = now; this.state.average = average; this.state.samples++;
      this.state.latencyMs = (now - sample.started) * 1000;
    }).catch(error => {
      if (!this.disposed && sample.generation === this.generation) this._fail(error);
    }).finally(() => {
      this._pending = null; this.state.pending = false;
      if (this.disposed) this._release();
    });
  }

  // Resizes, scene/time cuts, or a resumed tab can discard an old readback.
  // No second read is launched while its first GPU buffer is still pending.
  reset() {
    if (this.disposed) return;
    this.generation++; this.state.mult = 1;
    this._lastLaunch = this._lastAccepted = this.now();
  }

  _fail(error) {
    this.disabled = true; this.generation++; this.state.errors++;
    this.state.mult = 1; this.state.status = "palette";
    this.state.error = String(error?.message || error);
  }

  _release() {
    if (this._released) return;
    this._released = true; this._target.dispose(); this._material.dispose(); this._placeholder.dispose();
    // The input texture and Three's shared QuadMesh geometry are not ours.
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.state.status = "disposed";
    if (!this._pending) this._release();
  }
}

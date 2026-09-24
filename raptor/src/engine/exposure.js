// The GPU downsamples the completed scene; an asynchronous staging read keeps
// exposure metering off the frame's critical path. Canvas getImageData on the
// WebGPU canvas used to stall the main thread for 24–42 ms every 12 frames.
import * as THREE from "three";
import { renderOutput } from "three/tsl";

// RGBA8 rows are exactly 256 bytes, matching WebGPU's readback alignment.
// 1024 samples retain the original log-average meter without padded rows.
const WIDTH = 64, HEIGHT = 16;
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));

export function averageLuminance(pixels) {
  let sum = 0;
  const count = pixels.length / 4;
  if (!count) return 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    sum += Math.log(Math.max(value, 0.001));
  }
  return Math.exp(sum / count);
}

export class AsyncExposure {
  constructor(renderer, sourceNode) {
    this.renderer = renderer;
    this.mult = 1;
    this.desired = 1;
    this.pending = false;
    this.failed = false;
    this.samples = 0;
    this.lastLuminance = null;
    this._elapsed = 0;
    this._disposed = false;
    this.target = new THREE.RenderTarget(WIDTH, HEIGHT, {
      type: THREE.UnsignedByteType, depthBuffer: false,
    });
    this.target.texture.name = "RAPTOR.exposure";
    this.material = new THREE.NodeMaterial();
    this.material.name = "RAPTOR.exposure";
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.fragmentNode = renderOutput(sourceNode, renderer.toneMapping, renderer.outputColorSpace);
    this.quad = new THREE.QuadMesh(this.material);
  }

  // Compile while the loading veil is up; never wait for compilation in flight.
  async init() {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    try {
      renderer.setMRT(null);
      renderer.setRenderTarget(this.target);
      await renderer.compileAsync(this.quad, this.quad.camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMRT);
    }
    return this;
  }

  // Call after post.render(). A pending sample never queues another read.
  // dt=0 freezes adaptation and sampling alongside the paused simulation.
  step(dt) {
    if (this._disposed || this.failed || !(dt > 0)) return;
    // The frame just rendered with the previous multiplier. Adaptation below
    // prepares the next frame, so its value must not bias this frame's sample.
    const sampleMult = this.mult;
    this.mult += (this.desired - this.mult) * (1 - Math.exp(-dt / (this.desired > this.mult ? 1 : 3)));
    this._elapsed += dt;
    if (this.pending || this._elapsed < 0.2) return;
    this._elapsed = 0;
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousMRT = renderer.getMRT();
    this.pending = true;
    try {
      renderer.setMRT(null);
      renderer.setRenderTarget(this.target);
      this.quad.render(renderer);
      renderer.readRenderTargetPixelsAsync(this.target, 0, 0, WIDTH, HEIGHT)
        .then((pixels) => {
          if (this._disposed) return;
          const average = averageLuminance(pixels);
          this.lastLuminance = average;
          this.desired = clamp(sampleMult * Math.pow(0.42 / Math.max(average, 0.001), 0.6), 0.55, 2.3);
          this.samples++;
        })
        .catch((error) => this._fail(error))
        .finally(() => { this.pending = false; });
    } catch (error) {
      this.pending = false;
      this._fail(error);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMRT);
    }
  }

  _fail(error) {
    if (this._disposed || this.failed) return;
    this.failed = true;
    // Keep the last successful exposure; unsupported readback must never
    // break flight or retry an expensive failing operation every frame.
    console.warn("Exposure metering unavailable:", error?.message || error);
  }

  dispose() {
    this._disposed = true;
    this.target.dispose();
    this.material.dispose();
  }
}

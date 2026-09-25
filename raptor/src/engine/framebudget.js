// AUTO keeps the native cloud/shading path, but gives it a bounded pixel
// workload. A sustained slow scene can spend fewer pixels during this flight;
// a fast scene never raises resolution again and creates a quality oscillation.
// This budget is deliberately not a persisted, player-selected render scale.
export class FrameBudget {
  constructor({ width = 1, height = 1, pixelRatio = 1, enabled = true,
    maxPixels = 1_000_000, minPixels = 550_000, step = .9,
    warmup = 30, settleFrames = 45, samples = 60 } = {}) {
    this.maxPixels = positive(maxPixels, 1_000_000);
    this.minPixels = Math.min(this.maxPixels, positive(minPixels, 550_000));
    this.step = Math.min(.95, Math.max(.8, positive(step, .9)));
    this.warmup = Math.max(0, Math.floor(warmup) || 0);
    this.settleFrames = Math.max(0, Math.floor(settleFrames) || 0);
    this.sampleCount = Math.max(1, Math.floor(samples) || 60);
    this.pixelBudget = this.maxPixels;
    this.samples = [];
    this.adjustments = 0;
    this.lastMeasurement = null;
    this.configure({ width, height, pixelRatio, enabled });
    this.remainingWarmup = this.warmup;
  }

  // pixelRatio is the tier/device request, never the current backing-buffer
  // ratio. Keeping an absolute pixel budget also bounds Retina and large
  // windows without persisting a setting that depends on their dimensions.
  configure({ width = this.width, height = this.height,
    pixelRatio = this.requestedPixelRatio, enabled = this.enabled } = {}) {
    const nextWidth = positive(width, 1), nextHeight = positive(height, 1);
    const nextRatio = positive(pixelRatio, 1), nextEnabled = !!enabled;
    const changed = nextWidth !== this.width || nextHeight !== this.height
      || nextRatio !== this.requestedPixelRatio || nextEnabled !== this.enabled;
    this.width = nextWidth;
    this.height = nextHeight;
    this.requestedPixelRatio = nextRatio;
    this.enabled = nextEnabled;
    if (changed) this._reset(nextEnabled ? 'warming' : 'manual');
    return this.getPixelRatio();
  }

  getPixelRatio() {
    return this.enabled ? Math.min(this.requestedPixelRatio,
      Math.sqrt(this.pixelBudget / (this.width * this.height))) : this.requestedPixelRatio;
  }

  get diagnostics() {
    const pixelRatio = this.getPixelRatio();
    return { enabled: this.enabled, status: this.status, pixelRatio,
      requestedPixelRatio: this.requestedPixelRatio,
      resolutionFactor: pixelRatio / this.requestedPixelRatio,
      pixels: Math.round(this.width * this.height * pixelRatio * pixelRatio),
      pixelBudget: Math.round(this.pixelBudget), minPixels: this.minPixels,
      remainingWarmup: this.remainingWarmup, samples: this.samples.length,
      adjustments: this.adjustments, lastMeasurement: this.lastMeasurement };
  }

  observe(ms, { paused = false, hidden = false, settling = false,
    benchmarking = false, manual = false, changed = false } = {}) {
    // A tab suspension, asset upload, or resize says nothing about steady GPU
    // capacity. Discard the partial window and let the workload settle again.
    if (!this.enabled || manual) { this._reset('manual'); return null; }
    if (paused || hidden || settling || benchmarking || changed
      || !Number.isFinite(ms) || ms <= 0 || ms >= 250) {
      this._reset(benchmarking ? 'benchmarking' : 'settling');
      return null;
    }
    if (this.remainingWarmup > 0) {
      this.remainingWarmup--;
      this.status = 'warming';
      return null;
    }
    this.status = 'monitoring';
    this.samples.push(ms);
    if (this.samples.length < this.sampleCount) return null;
    const sorted = this.samples.sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)];
    const slowFraction = sorted.reduce((count, value) => count + (value > 25), 0) / sorted.length;
    this.lastMeasurement = { median, p95, slowFraction };
    this.samples.length = 0;
    if (median <= 18.5 && slowFraction < .2) return null;

    const ratio = this.getPixelRatio();
    const currentPixels = this.width * this.height * ratio * ratio;
    // Tiny/mobile viewports can already be below the floor at their requested
    // ratio. Never increase them, and never turn a slow CPU scene into an
    // indefinitely shrinking image.
    if (currentPixels <= this.minPixels + 1) { this.status = 'floor'; return null; }
    this.pixelBudget = Math.max(this.minPixels,
      Math.min(this.pixelBudget, currentPixels * this.step * this.step));
    this.adjustments++;
    this._reset('adjusting');
    return { pixelRatio: this.getPixelRatio(), ...this.lastMeasurement,
      reason: median > 18.5 ? 'sustained-frame-time' : 'frequent-missed-frames' };
  }

  _reset(status) {
    this.samples.length = 0;
    this.remainingWarmup = this.settleFrames;
    this.status = status;
  }
}

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

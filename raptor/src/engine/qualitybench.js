import { benchPick } from './quality.js';
const ORDER = ['LOW', 'MED', 'HIGH']; // Vsync cannot establish Ultra headroom.

// Bounded, measured tier selection. Each tried workload gets a fresh warmup
// and sample window. A failed higher tier is never repeatedly retried merely
// because the reduced workload later reaches display refresh rate.
export class QualityBenchmark {
  constructor({ tier, backend, warmup = 90, samples = 120 }) {
    this.tier = tier;
    this.backend = backend;
    this.warmup = warmup;
    this.sampleCount = samples;
    this.remainingWarmup = warmup;
    this.samples = [];
    this.measurements = new Map();
    this.complete = false;
  }

  observe(ms, { hidden = false, manual = false, changed = false, settling = false } = {}) {
    if (this.complete) return null;
    if (manual || changed) {
      this.complete = true;
      return { cancelled: true };
    }
    // A hidden tab or a large pause invalidates the settle window, not just
    // one sample: background scheduling or terrain morph/upload work must
    // never persist a lower tier. Other completed tier measurements survive.
    if (hidden || settling || !Number.isFinite(ms) || ms <= 0 || ms >= 250) {
      this.samples.length = 0;
      this.remainingWarmup = this.warmup;
      return null;
    }
    if (this.remainingWarmup > 0) { this.remainingWarmup--; return null; }
    this.samples.push(ms);
    if (this.samples.length < this.sampleCount) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.measurements.set(this.tier, median);
    const requested = ORDER.indexOf(benchPick(median, this.backend));
    const current = ORDER.indexOf(this.tier);
    let next = this.tier;
    if (requested < current) {
      // Try the highest unmeasured tier below the failing workload. This
      // keeps MED available after a slow HIGH, rather than jumping to LOW.
      for (let i = current - 1; i >= requested; i--) {
        if (!this.measurements.has(ORDER[i])) { next = ORDER[i]; break; }
        if (ORDER.indexOf(benchPick(this.measurements.get(ORDER[i]), this.backend)) >= i) break;
      }
    } else if (requested > current) {
      for (let i = current + 1; i <= requested; i++) {
        if (!this.measurements.has(ORDER[i])) { next = ORDER[i]; break; }
        const measured = this.measurements.get(ORDER[i]);
        if (ORDER.indexOf(benchPick(measured, this.backend)) < i) break;
      }
    }
    if (next !== this.tier) {
      this.tier = next;
      this.samples.length = 0;
      this.remainingWarmup = this.warmup;
      return { tier: next, complete: false, measuredTier: ORDER[current], median };
    }
    // Prefer the highest measured tier that sustained its acceptance band.
    // LOW is the bounded fallback even when no tier reaches the target.
    let selected = 'LOW';
    for (let i = 0; i < ORDER.length; i++) {
      const measured = this.measurements.get(ORDER[i]);
      if (measured !== undefined && ORDER.indexOf(benchPick(measured, this.backend)) >= i) selected = ORDER[i];
    }
    this.complete = true;
    this.tier = selected;
    return { tier: selected, complete: true, median: this.measurements.get(selected) ?? median,
      measurements: Object.fromEntries(this.measurements) };
  }
}

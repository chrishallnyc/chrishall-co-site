// A numerical origin for absolute ocean time; frequencies keep their physical
// dispersion and are never quantized to a common repeating period.
import { floor } from "three/tsl";

export const OCEAN_EPOCH_SECONDS = 512;
const TAU = 2 * Math.PI;

// Inline expression: no named function captures uniforms across graph builders.
// Clamp only the rounding overshoot at the principal interval endpoints.
export function oceanPrincipalPhase(phase) {
  const p = phase.toVar();
  return p.sub(floor(p.add(Math.PI).div(TAU)).mul(TAU)).clamp(-Math.PI, Math.PI);
}

// Takes ownership of data. Both original and reusable output stay CPU-side;
// the existing DataTexture uses .data and keeps the same identity throughout.
export class OceanClock {
  constructor(data, N, tileM, capillary = false) {
    if (!(data instanceof Float32Array) || data.length !== N * N * 4 ||
        !Number.isInteger(N) || N < 2 || N % 2 || !(tileM > 0) || !Number.isFinite(tileM)) {
      throw new TypeError("Invalid ocean clock spectrum");
    }
    this.original = data;
    this.data = new Float32Array(data);
    this.omega = new Float64Array(N * N);
    this.N = N;
    this.maxOmega = 0;
    this.epoch = this.outputEpoch = this.pendingEpoch = 0;
    this.residual = this.pendingResidual = 0;
    this.prepared = false;
    this.disposed = false;
    const dk = TAU / tileM;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const mx = x < N / 2 ? x : x - N, mz = z < N / 2 ? z : z - N;
      const k = Math.hypot(mx * dk, mz * dk);
      const w = Math.sqrt(9.81 * k + (capillary ? .0000722 * k * k * k : 0));
      if (!Number.isFinite(w)) throw new RangeError("Nonfinite ocean dispersion");
      this.omega[z * N + x] = w;
      this.maxOmega = Math.max(this.maxOmega, w);
    }
  }

  // Prepare without publishing texture versions or time uniforms. A caller can
  // stage both cascades, then commit both before submitting either compute pass.
  prepare(time) {
    this.prepared = false;
    if (this.disposed || typeof time !== "number" || !Number.isFinite(time)) return false;
    const epoch = OCEAN_EPOCH_SECONDS * Math.floor(time / OCEAN_EPOCH_SECONDS);
    const residual = time - epoch;
    if (!Number.isFinite(epoch) || !Number.isFinite(this.maxOmega * epoch) ||
        !(residual >= 0 && residual < OCEAN_EPOCH_SECONDS)) return false;
    if (epoch !== this.outputEpoch) {
      const source = this.original, out = this.data, N = this.N;
      if (epoch === 0) out.set(source); // Restore exact original Float32 bits.
      else for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x, j = ((N - z) % N) * N + (N - x) % N;
        if (i > j) continue;
        const a = i * 4, b = j * 4;
        const ar = source[a], ai = source[a + 1], br = source[b], bi = source[b + 1];
        if (!(ar || ai || br || bi)) continue; // Zero support is invariant.
        const phase = (this.omega[i] * epoch) % TAU, c = Math.cos(phase), s = Math.sin(phase);
        const ar1 = Math.fround(ar * c - ai * s), ai1 = Math.fround(ar * s + ai * c);
        const br1 = Math.fround(br * c - bi * s), bi1 = Math.fround(br * s + bi * c);
        out[a] = ar1; out[a + 1] = ai1; out[a + 2] = br1; out[a + 3] = -bi1;
        out[b] = br1; out[b + 1] = bi1; out[b + 2] = ar1; out[b + 3] = -ai1;
      }
      this.outputEpoch = epoch;
    }
    this.pendingEpoch = epoch;
    this.pendingResidual = residual;
    this.prepared = true;
    return true;
  }

  commit(texture, timeUniform) {
    if (!this.prepared || this.disposed) return false;
    if (this.pendingEpoch !== this.epoch) texture.needsUpdate = true;
    this.epoch = this.pendingEpoch;
    this.residual = this.pendingResidual;
    timeUniform.value = this.residual;
    this.prepared = false;
    return true;
  }

  dispose(texture) {
    if (this.disposed) return;
    if (texture?.image?.data === this.data) texture.image.data = null;
    this.disposed = true;
    this.prepared = false;
    this.original = this.data = this.omega = null;
  }
}

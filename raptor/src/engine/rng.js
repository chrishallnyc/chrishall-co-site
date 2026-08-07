// Deterministic RNG + hashing. Everything the sim randomizes MUST come through
// SfcRng — never Math.random — or replays, lockstep MP, and QA hashes all break.

export function splitmix32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export class SfcRng {
  constructor(seed = 1) { this.reseed(seed); }
  reseed(seed) {
    const g = splitmix32(seed >>> 0);
    this.a = g(); this.b = g(); this.c = g(); this.d = g();
    for (let i = 0; i < 12; i++) this.u32();
    return this;
  }
  u32() {
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = this.d + 1 | 0;
    this.a = this.b ^ this.b >>> 9;
    this.b = this.c + (this.c << 3) | 0;
    this.c = (this.c << 21 | this.c >>> 11) + t | 0;
    return t >>> 0;
  }
  // [0,1)
  f() { return this.u32() / 4294967296; }
  range(lo, hi) { return lo + (hi - lo) * this.f(); }
  int(n) { return this.u32() % n; }
}

// FNV-1a over arbitrary numeric sequences, folded through a Float64 view so
// hash(state) is bit-exact for identical simulations.
const _f64 = new Float64Array(1);
const _u8 = new Uint8Array(_f64.buffer);

export function hashBegin() { return 0x811c9dc5 >>> 0; }

export function hashNum(h, x) {
  _f64[0] = x;
  for (let i = 0; i < 8; i++) {
    h ^= _u8[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function hashArray(h, arr) {
  for (let i = 0; i < arr.length; i++) h = hashNum(h, arr[i]);
  return h;
}

export function hashHex(h) { return (h >>> 0).toString(16).padStart(8, "0"); }

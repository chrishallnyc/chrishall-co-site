// Fixed-timestep deterministic simulation core.
// Rules: systems read/write ONLY sim-owned state + sim.rng; no wall-clock, no
// Math.random, no per-frame data. Render interpolates between prev/curr states.

import { SfcRng, hashBegin, hashNum, hashArray, hashHex } from "./rng.js";

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
const MAX_CATCHUP_TICKS = 10; // beyond this we drop time rather than spiral

export class SimCore {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.rng = new SfcRng(this.seed);
    this.tickCount = 0;
    this.time = 0;               // sim seconds == tickCount * DT
    this.timescale = 1;
    this.systems = [];           // { name, tick(sim), hash?(h)=>h, state? }
    this._acc = 0;
  }

  addSystem(sys) { this.systems.push(sys); return sys; }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.rng.reseed(this.seed);
    this.tickCount = 0;
    this.time = 0;
    this._acc = 0;
    for (const s of this.systems) s.reset && s.reset(this);
  }

  tick() {
    for (const s of this.systems) s.tick && s.tick(this, DT);
    this.tickCount++;
    this.time = this.tickCount * DT;
  }

  // Advance by real elapsed seconds; returns interpolation alpha for render.
  advance(elapsed) {
    this._acc += elapsed * this.timescale;
    let n = 0;
    while (this._acc >= DT && n < MAX_CATCHUP_TICKS) {
      this.tick();
      this._acc -= DT;
      n++;
    }
    if (this._acc >= DT) this._acc = this._acc % DT; // drop unpayable debt
    return this._acc / DT;
  }

  stateHash() {
    let h = hashBegin();
    h = hashNum(h, this.tickCount);
    h = hashNum(h, this.rng.a); h = hashNum(h, this.rng.b);
    h = hashNum(h, this.rng.c); h = hashNum(h, this.rng.d);
    for (const s of this.systems) {
      if (s.hash) h = s.hash(h);
      else if (s.state && s.state.length !== undefined) h = hashArray(h, s.state);
    }
    return hashHex(h);
  }
}

// Headless determinism probe: two fresh sims, same seed, a stress kernel that
// exercises rng + float math, n ticks each — must hash identical. Pure function
// of (seed, n): the same pair must also match across page loads and machines.
export function determinismProbe(n = 600, seed = 0xC0FFEE) {
  const mk = () => {
    const sim = new SimCore(seed);
    const st = new Float64Array(64);
    sim.addSystem({
      name: "probe",
      state: st,
      tick(s, dt) {
        for (let i = 0; i < st.length; i++) {
          const j = (i + 1) % st.length;
          st[i] += Math.sin(st[j] * 1.7 + s.time) * dt + (s.rng.f() - 0.5) * 1e-3;
        }
      },
    });
    for (let i = 0; i < n; i++) sim.tick();
    return sim.stateHash();
  };
  const a = mk(), b = mk();
  return { a, b, equal: a === b, n, seed };
}

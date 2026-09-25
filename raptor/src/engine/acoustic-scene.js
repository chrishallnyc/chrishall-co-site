// A bounded acoustic world, separate from the deterministic flight simulation.
// World vectors use the renderer's [east, up, north] meters. One persistent
// voice follows each aircraft/missile; a recycled missile has a new identity.
import { SfcRng } from './rng.js';

const C = 343;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = v => Math.hypot(...v);
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v, fallback = [0, 0, -1]) => { const n = length(v); return n > 0.0001 ? v.map(x => x / n) : fallback; };
const validVector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const smooth = (p, value, now, tau = 0.06) => p.setTargetAtTime(value, now, tau);
function biquad(ctx, type, hz, Q = 0.707) {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = Q; return f;
}
function volume(ctx, value) { const g = ctx.createGain(); g.gain.value = value; return g; }
function noise(ctx, rng, seconds, pink) {
  const n = Math.round(ctx.sampleRate * seconds), overlap = Math.round(ctx.sampleRate * 0.08);
  const raw = new Float32Array(n + overlap);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng.f() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    raw[i] = pink ? (b0 + b1 + b2 + w * 0.1848) * 0.2 : w * 0.7;
  }
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate), d = buffer.getChannelData(0);
  d.set(raw.subarray(0, n));
  for (let i = 0; i < overlap; i++) d[i] = raw[n + i] * (1 - i / overlap) + raw[i] * i / overlap;
  return buffer;
}

// Exposed independently of Web Audio for geometry/physics regression tests.
export function relativeAcoustics(listener, source) {
  const delta = subtract(source.position, listener.position);
  const distance = length(delta), direction = unit(delta);
  const listenerRadial = clamp(dot(listener.velocity || [0, 0, 0], direction), -0.75 * C, 0.75 * C);
  const sourceRadial = clamp(dot(source.velocity || [0, 0, 0], direction), -0.75 * C, 0.75 * C);
  // Sonic booms are separate pressure transients, not infinite pitch changes.
  const doppler = clamp((C + listenerRadial) / (C + sourceRadial), 0.45, 2.4);
  const reference = source.kind === 'missile' ? 28 : 110;
  const attenuation = reference / (reference + Math.max(0, distance - 8));
  return { distance, direction, doppler, attenuation,
    pan: clamp(dot(direction, listener.right || [1, 0, 0]), -1, 1),
    cutoff: clamp(14000 / (1 + distance / 850), 450, 14000) };
}

class MovingVoice {
  constructor(scene, source) {
    this.scene = scene; this.ctx = scene.ctx; this.id = source.id; this.kind = source.kind;
    const ctx = this.ctx;
    this.sources = [];
    this.nodes = [];
    this.retiring = false; this.end = Infinity;
    this.mix = volume(ctx, 0);
    this.air = biquad(ctx, 'lowpass', 12000);
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse'; this.panner.rolloffFactor = 0; // attenuation is explicit above
    this.panner.coneInnerAngle = this.kind === 'aircraft' ? 100 : 360;
    this.panner.coneOuterAngle = this.kind === 'aircraft' ? 280 : 360;
    this.panner.coneOuterGain = this.kind === 'aircraft' ? 0.38 : 1;
    this.mix.connect(this.air).connect(this.panner).connect(this.kind === 'missile' ? scene.missiles : scene.aircraft);
    this.nodes.push(this.mix, this.air, this.panner);
    const bed = ctx.createBufferSource(); bed.buffer = scene.pink; bed.loop = true;
    const detail = ctx.createBufferSource(); detail.buffer = scene.white; detail.loop = true;
    this.bed = bed; this.detail = detail;
    const core = biquad(ctx, 'lowpass', this.kind === 'missile' ? 800 : 1800);
    const rumble = biquad(ctx, 'highpass', this.kind === 'missile' ? 80 : 35);
    const hiss = biquad(ctx, 'bandpass', this.kind === 'missile' ? 2400 : 850, 0.7);
    this.hissGain = volume(ctx, this.kind === 'missile' ? 0.3 : 0.04);
    this.coreGain = volume(ctx, 1);
    bed.connect(rumble).connect(core).connect(this.coreGain).connect(this.mix);
    detail.connect(hiss).connect(this.hissGain).connect(this.mix);
    this.core = core; this.hiss = hiss; this.rumble = rumble;
    this.nodes.push(core, rumble, hiss, this.hissGain, this.coreGain);
    this.sources.push(bed, detail);
    // A little shaft detail differentiates aircraft from rocket exhaust.
    if (this.kind === 'aircraft') {
      this.shaft = ctx.createOscillator(); this.shaft.type = 'triangle';
      const level = volume(ctx, 0.012);
      this.shaft.connect(level).connect(this.mix); this.shaft.start();
      this.nodes.push(level); this.sources.push(this.shaft);
    }
    bed.start(ctx.currentTime, scene.rng.f() * scene.pink.duration);
    detail.start(ctx.currentTime, scene.rng.f() * scene.white.duration);
  }

  update(source, acoustics) {
    const now = this.ctx.currentTime, p = this.panner;
    for (const [param, v] of [[p.positionX, source.position[0]], [p.positionY, source.position[1]], [p.positionZ, source.position[2]]]) smooth(param, v, now, 0.025);
    const velocity = source.velocity || [0, 0, 0], rear = unit(velocity).map(v => -v);
    for (const [param, v] of [[p.orientationX, rear[0]], [p.orientationY, rear[1]], [p.orientationZ, rear[2]]]) smooth(param, v, now, 0.1);
    const power = clamp(source.power ?? 0.6, 0, 1.5);
    const speed = length(velocity);
    let emitted;
    if (this.kind === 'missile') {
      const motor = source.motor === 'boost' ? 1 : source.motor === 'sustain' ? 0.44 : 0;
      // Coasting missiles retain a brief close-pass aerodynamic hiss.
      const near = clamp(1 - acoustics.distance / 160, 0, 1);
      emitted = 0.9 * motor + 0.32 * near * clamp(speed / 600, 0, 1.5);
      // An extinguished motor loses its combustion body. The close pass
      // remains a narrower aerodynamic rush, rather than a quiet rocket.
      smooth(this.coreGain.gain, motor ? 1 : 0, now, 0.06);
      smooth(this.hissGain.gain, motor === 1 ? 0.22 : motor ? 0.38 : 0.9, now, 0.06);
      smooth(this.core.frequency, 500 + 2400 * motor, now, 0.05);
      smooth(this.hiss.frequency, (motor ? 1150 + 800 * motor : 2300) * acoustics.doppler, now);
      smooth(this.hiss.Q, motor ? 0.7 : 1.1, now);
    } else {
      const cls = source.aircraftClass;
      const weight = cls === 'transport' ? 1.25 : cls === 'drone' ? 0.5 : 1;
      const intake = speed > 0.1 ? clamp((1 - dot(unit(velocity), acoustics.direction)) * 0.5, 0, 1) : 0.5;
      emitted = (0.22 + 0.85 * power) * weight;
      // The existing exhaust cone controls level; intake direction also
      // changes the balance between fan detail and the heavier exhaust bed.
      smooth(this.coreGain.gain, 1 - 0.28 * intake, now, 0.1);
      smooth(this.hissGain.gain, 0.025 + 0.08 * intake * (0.4 + 0.6 * power), now, 0.1);
      smooth(this.rumble.frequency, 35 + 190 * intake, now, 0.1);
      smooth(this.core.frequency, (450 + 2000 * power) * acoustics.doppler, now, 0.1);
      smooth(this.hiss.frequency, (500 + 1300 * power) * acoustics.doppler, now, 0.1);
      smooth(this.shaft.frequency, (cls === 'transport' ? 70 + 90 * power : 110 + 240 * power) * acoustics.doppler, now, 0.08);
    }
    smooth(this.bed.playbackRate, acoustics.doppler, now, 0.06);
    smooth(this.detail.playbackRate, acoustics.doppler, now, 0.06);
    smooth(this.air.frequency, acoustics.cutoff, now, 0.1);
    smooth(this.mix.gain, emitted * acoustics.attenuation * 0.65, now, 0.055);
    this.retiring = false; this.end = Infinity;
    this.distance = acoustics.distance; this.score = source.score;
  }

  retire(now) {
    if (this.retiring) return;
    this.retiring = true;
    this.retiredAt = now;
    this.end = now + 0.18;
    this.mix.gain.cancelAndHoldAtTime(now);
    this.mix.gain.setTargetAtTime(0, now, 0.025);
    for (const source of this.sources) {
      source.onended = () => this.dispose();
      try { source.stop(this.end); } catch (_) { /* already retired */ }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch (_) {} source.disconnect(); }
    for (const node of this.nodes) node.disconnect();
    if (this.scene.voices.get(this.id) === this) this.scene.voices.delete(this.id);
  }
}

export class AcousticScene {
  constructor(ctx, destination, { seed = 119, maxVoices = 12, onListener = null } = {}) {
    this.ctx = ctx; this.rng = new SfcRng(seed); this.maxVoices = Math.floor(clamp(maxVoices, 1, 16));
    const routes = destination.aircraft ? destination : { aircraft: destination, missile: destination };
    this.aircraft = volume(ctx, 1); this.aircraft.connect(routes.aircraft);
    this.missiles = volume(ctx, 1); this.missiles.connect(routes.missile);
    this.pink = noise(ctx, this.rng, 3.83, true); this.white = noise(ctx, this.rng, 2.71, false);
    this.voices = new Map(); this.paused = false; this.disposed = false;
    this.onListener = onListener;
    this.stats = { candidates: 0, voices: 0, dropped: 0 };
  }

  update({ listener, sources = [] } = {}) {
    if (this.paused || this.disposed || !listener || !validVector(listener.position)) return;
    const now = this.ctx.currentTime, target = this.ctx.listener;
    const forward = unit(listener.forward || [0, 0, -1]), up = unit(listener.up || [0, 1, 0]);
    for (const [param, value] of [
      [target.positionX, listener.position[0]], [target.positionY, listener.position[1]], [target.positionZ, listener.position[2]],
      [target.forwardX, forward[0]], [target.forwardY, forward[1]], [target.forwardZ, forward[2]],
      [target.upX, up[0]], [target.upY, up[1]], [target.upZ, up[2]],
    ]) smooth(param, value, now, 0.025);
    this.onListener?.(listener);
    for (const voice of this.voices.values()) if (voice.end <= now) voice.dispose();
    const candidates = [];
    for (const source of sources) {
      if (source.id == null || !['aircraft', 'missile'].includes(source.kind) || !validVector(source.position)) continue;
      const acoustic = relativeAcoustics(listener, source);
      if (acoustic.distance > (source.kind === 'missile' ? 3500 : 14000)) continue;
      const coast = source.kind === 'missile' && !['boost', 'sustain'].includes(source.motor);
      if (coast && acoustic.distance > 250) continue;
      const priority = clamp(source.priority ?? 1, 0.1, 5);
      const audibility = coast ? clamp((250 - acoustic.distance) / 180, 0, 1) : 1;
      const score = acoustic.attenuation * priority * audibility * (source.kind === 'missile' ? 1.5 : 1);
      candidates.push({ source: { ...source, score }, acoustic, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, this.maxVoices);
    const wanted = new Set(selected.map(c => c.source.id));
    for (const voice of this.voices.values()) if (!wanted.has(voice.id)) voice.retire(now);
    for (const candidate of selected) {
      let voice = this.voices.get(candidate.source.id);
      if (voice?.retiring) { voice.dispose(); voice = null; }
      if (!voice) {
        // Release tails count toward the budget too. Never allocate unbounded
        // short-lived voices when nearest-source ordering changes each frame.
        if (this.voices.size >= this.maxVoices) {
          let victim = null, quietest = Infinity;
          for (const old of this.voices.values()) {
            if (!old.retiring) continue; // never steal a still-selected source
            const residual = old.score * Math.exp(-Math.max(0, now - old.retiredAt) / 0.025);
            if (residual < quietest) { quietest = residual; victim = old; }
          }
          // A close, salient new source should not wait 180ms behind quiet
          // retirement tails. Similar sources get time to fade naturally;
          // only a materially stronger candidate cuts a remaining tail.
          if (!victim || candidate.score <= Math.max(0.002, quietest * 1.75)) continue;
          victim.dispose(); // free the slot before constructing its replacement
        }
        voice = new MovingVoice(this, candidate.source);
        this.voices.set(candidate.source.id, voice);
      }
      voice.update(candidate.source, candidate.acoustic);
    }
    const admitted = selected.filter(({ source }) => {
      const voice = this.voices.get(source.id);
      return voice && !voice.retiring;
    }).length;
    this.stats = { candidates: candidates.length, voices: this.voices.size,
      dropped: candidates.length - admitted };
  }

  setPaused(paused) { this.paused = !!paused; if (paused) this.clear(); }
  clear() { for (const voice of [...this.voices.values()]) voice.dispose(); this.stats.voices = 0; }
  dispose() { if (this.disposed) return; this.disposed = true; this.clear(); this.aircraft.disconnect(); this.missiles.disconnect(); }
}

// Airframe sounds have their own group fader, separate from engine power.
export class AirframeVoice {
  constructor(ctx, destination, { seed = 220 } = {}) {
    this.ctx = ctx;
    const rng = new SfcRng(seed);
    this.dry = volume(ctx, 1); this.dry.connect(destination);
    this.active = volume(ctx, 0); this.active.connect(this.dry);
    this.noise = ctx.createBufferSource(); this.noise.buffer = noise(ctx, rng, 4.13, true); this.noise.loop = true;
    this.rolling = volume(ctx, 0); this.rollFilter = biquad(ctx, 'lowpass', 180);
    this.noise.connect(this.rollFilter).connect(this.rolling).connect(this.active);
    this.gear = volume(ctx, 0); this.gearFilter = biquad(ctx, 'bandpass', 620, 1.6);
    this.noise.connect(this.gearFilter).connect(this.gear).connect(this.active);
    this.gearAir = volume(ctx, 0);
    this.gearAirHighpass = biquad(ctx, 'highpass', 180);
    this.gearAirLowpass = biquad(ctx, 'lowpass', 900);
    this.noise.connect(this.gearAirHighpass).connect(this.gearAirLowpass).connect(this.gearAir).connect(this.active);
    this.brakes = volume(ctx, 0); this.brakeFilter = biquad(ctx, 'bandpass', 1800, 0.8);
    this.noise.connect(this.brakeFilter).connect(this.brakes).connect(this.active);
    this.hydraulic = ctx.createOscillator(); this.hydraulic.type = 'sine'; this.hydraulic.frequency.value = 175;
    this.hydraulicGain = volume(ctx, 0); this.hydraulic.connect(this.hydraulicGain).connect(this.active);
    this.noise.start(); this.hydraulic.start();
    this.state = {};
  }
  setState(state = {}) {
    this.state = state;
    const now = this.ctx.currentTime, active = state.active !== false;
    const rolling = state.weightOnWheels ? clamp(Math.abs(state.wheelSpeed || 0) / 90, 0, 1.4) : 0;
    // Ground contact load is independent of aerodynamic G. An omitted value
    // means ordinary loaded contact for direct auditions; explicit zero is zero.
    const requestedLoad = state.groundLoad ?? 1;
    const groundLoad = Number.isFinite(requestedLoad) ? clamp(requestedLoad, 0, 2) : 1;
    const ias = Number.isFinite(state.ias) ? clamp(state.ias, 0, 800) : 0;
    const exposure = clamp(state.gearPosition || 0, 0, 1);
    // IAS squared tracks dynamic pressure; exposed gear continues to disturb
    // the airflow after the actuator has stopped at its endpoint.
    const gearPressure = Math.min(2.56, (ias / 250) ** 2) * exposure;
    const moving = active && !!state.gearMoving;
    smooth(this.active.gain, active ? 1 : 0, now, 0.06);
    smooth(this.rolling.gain, rolling * 0.24 * groundLoad, now, 0.12);
    smooth(this.rollFilter.frequency, 100 + rolling * 250, now, 0.15);
    smooth(this.gear.gain, moving ? 0.018 : 0, now, 0.035);
    smooth(this.hydraulicGain.gain, moving ? 0.005 : 0, now, 0.06);
    smooth(this.gearAir.gain, gearPressure * 0.09, now, 0.18);
    smooth(this.gearAirLowpass.frequency, 600 + ias * 4.5, now, 0.15);
    smooth(this.brakes.gain, rolling * groundLoad * clamp(state.brake || 0, 0, 1) * 0.025, now, 0.1);
  }
  dispose() {
    for (const src of [this.noise, this.hydraulic]) { try { src.stop(); } catch (_) {} src.disconnect(); }
    this.dry.disconnect();
  }
}

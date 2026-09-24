// Hybrid F119 soundscape. All noise is seeded independently of the sim;
// loops and weapon envelopes run on the audio clock, never JS timers.
import { SfcRng } from "./rng.js";
import { AcousticScene, AirframeVoice } from "./acoustic-scene.js";
import { loadEngineTexture } from "./audio-assets.js";

const MUTE_KEY = "raptor:mute";
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const targets = new WeakMap();
function smooth(param, value, now, seconds = 0.08) {
  if (targets.get(param) === value) return;
  targets.set(param, value);
  param.setTargetAtTime(value, now, seconds);
}
function filter(ctx, type, frequency, Q = 0.707) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = Q;
  return node;
}
function gain(ctx, value = 1) {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}
function loop(ctx, buffer, offset = 0) {
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.start(0, offset);
  return node;
}
function stop(source) {
  try { source.stop(); } catch (_) { /* already stopped */ }
  source.disconnect();
}
function normalize(data, peak = 0.9) {
  let max = 0, mean = 0;
  for (const v of data) mean += v;
  mean /= data.length;
  for (let i = 0; i < data.length; i++) { data[i] -= mean; max = Math.max(max, Math.abs(data[i])); }
  if (max) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
}
function noiseBuffer(ctx, rng, seconds = 3, pink = false) {
  // Generate an extra overlap, then fold it into the start. Unlike fading
  // the tail to sample zero, this preserves continuity at the actual seam.
  const length = Math.round(ctx.sampleRate * seconds);
  const fade = Math.round(ctx.sampleRate * 0.08);
  const raw = new Float32Array(length + fade);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng.f() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    raw[i] = pink ? (b0 + b1 + b2 + w * 0.1848) * 0.2 : w * 0.8;
  }
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  data.set(raw.subarray(0, length));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = raw[length + i] * (1 - t) + raw[i] * t;
  }
  return buffer;
}
function noiseLayer(ctx, source, low, high, level, destination) {
  const hp = filter(ctx, "highpass", low);
  const lp = filter(ctx, "lowpass", high);
  const volume = gain(ctx, level);
  source.connect(hp).connect(lp).connect(volume).connect(destination);
  return { hp, lp, volume };
}

export class EngineVoice {
  constructor(ctx, destination, rng = new SfcRng(1337)) {
    this.ctx = ctx;
    this.doppler = 1;
    this.state = {};
    this.sources = [];
    this.textureStatus = 'procedural';
    this.dry = gain(ctx);
    this.activeGain = gain(ctx);
    this.duckGain = gain(ctx);
    this.cabin = filter(ctx, "lowpass", 12000);
    this.distFilter = filter(ctx, "lowpass", 20000);
    this.distGain = gain(ctx);
    this.activeGain.connect(this.cabin).connect(this.duckGain).connect(this.dry)
      .connect(this.distFilter).connect(this.distGain).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };
    this.engines = [];
    for (const side of [-1, 1]) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = side * 0.3;
      pan.connect(this.activeGain);
      const pink = loop(ctx, noiseBuffer(ctx, rng, 3.7 + side * 0.23, true));
      const white = loop(ctx, noiseBuffer(ctx, rng, 2.9 + side * 0.17));
      this.sources.push(pink, white);
      const core = noiseLayer(ctx, pink, 28, 310, 0, pan);
      const exhaust = noiseLayer(ctx, pink, 130, 2600, 0, pan);
      const burner = noiseLayer(ctx, pink, 32, 1700, 0, pan);
      // Broad fan/compressor resonances give the turbine a rotating-machine
      // texture instead of one uniform hiss. These are authored relationships,
      // not literal F119 blade counts; shared noise avoids isolated sine tones.
      const turbineFilter = filter(ctx, "bandpass", 750, 1.6);
      const turbineGain = gain(ctx, 0);
      white.connect(turbineFilter).connect(turbineGain).connect(pan);
      const compressorFilter = filter(ctx, "bandpass", 1400, 2.8);
      const compressorGain = gain(ctx, 0);
      white.connect(compressorFilter).connect(compressorGain).connect(turbineGain);
      const bladeFilter = filter(ctx, "bandpass", 2000, 2.4);
      const bladeGain = gain(ctx, 0);
      white.connect(bladeFilter).connect(bladeGain).connect(turbineGain);
      // Very quiet detuned shaft harmonics add identity, without the former
      // 3.5 kHz sine whistle sitting above the entire soundscape.
      const shaft = ctx.createOscillator();
      shaft.type = "triangle";
      const shaftGain = gain(ctx, 0);
      shaft.connect(shaftGain).connect(pan);
      shaft.start();
      const flutter = ctx.createOscillator();
      flutter.frequency.value = 23 + side * 1.3;
      const flutterGain = gain(ctx, 0);
      flutter.connect(flutterGain).connect(burner.volume.gain);
      flutter.start();
      this.sources.push(shaft, flutter);
      const wind = noiseLayer(ctx, white, 480, 4600, 0, pan);
      const buffet = noiseLayer(ctx, pink, 24, 155, 0, pan);
      this.engines.push({ side, pan, pink, white, core, exhaust, burner, turbineFilter, turbineGain, compressorFilter, compressorGain, bladeFilter, bladeGain, shaft, shaftGain, flutter, flutterGain, wind, buffet });
    }
    this.setState();
  }

  setState({ throttle = 0, ab = 0, powerInput = "command", ias = 0, mach = 0, g = 1, aoa = 0, view = "external", active = true, fuelStarved = false } = {}) {
    this.state = { throttle: clamp(throttle, 0, 1), ab: clamp(ab, 0, 1), powerInput: powerInput === "spool" ? "spool" : "command", ias: clamp(ias, 0, 1600), mach: clamp(mach, 0, 4), g: clamp(g, -5, 15), aoa: clamp(aoa, -90, 90), view, active, fuelStarved };
    this._apply();
  }

  _apply() {
    const { throttle, ab, powerInput, ias, mach, g, aoa, view, active, fuelStarved } = this.state;
    const combustion = fuelStarved ? 0 : 1;
    const now = this.ctx.currentTime;
    const responseChanged = this._powerInput !== powerInput;
    this._powerInput = powerInput;
    // Gameplay supplies a spool state that already includes the flight
    // model's engine lag. Only dezipper it; manual/lab commands still spool.
    const power = (param, value, commandLag) => {
      if (responseChanged) targets.delete(param);
      smooth(param, value, now, powerInput === "spool" ? 0.06 : commandLag);
    };
    const n2 = Math.pow(throttle, 0.72);
    const wind = Math.pow(Math.min(1.5, ias / 650), 1.6);
    const load = Math.max(clamp((Math.abs(g) - 3) / 6, 0, 1), clamp((Math.abs(aoa) - 12) / 23, 0, 1));
    const transonic = Math.max(0, 1 - Math.abs(mach - 1) / 0.1);
    smooth(this.activeGain.gain, active ? 1 : 0, now, active ? 0.22 : 0.1);
    smooth(this.cabin.frequency, view === "cockpit" ? 760 : 12000, now, 0.22);
    for (const e of this.engines) {
      const pitch = this.doppler * (1 + e.side * 0.008);
      power(e.core.lp.frequency, (180 + n2 * 270) * pitch, 0.65);
      power(e.core.volume.gain, (0.055 + 0.15 * n2) * combustion, 0.5);
      power(e.exhaust.lp.frequency, (650 + n2 * 2450) * pitch, 0.6);
      power(e.exhaust.volume.gain, (0.045 + 0.23 * n2 * n2) * combustion, 0.5);
      const fanFrequency = (300 + 1100 * n2) * pitch;
      power(e.turbineFilter.frequency, fanFrequency, 0.75);
      power(e.compressorFilter.frequency, fanFrequency * 1.87, 0.75);
      power(e.bladeFilter.frequency, fanFrequency * 2.63, 0.75);
      // Upper compressor detail emerges progressively under load. The existing
      // turbine group level is retained, so this is a change of character.
      power(e.compressorGain.gain, 0.1 + 0.62 * n2 * n2, 0.6);
      power(e.bladeGain.gain, 0.18 * n2 * n2 * n2, 0.6);
      power(e.turbineGain.gain, (0.027 + 0.048 * n2) * combustion, 0.6);
      power(e.shaft.frequency, (95 + 260 * n2) * pitch, 0.75);
      power(e.shaftGain.gain, (0.0015 + 0.004 * n2) * combustion, 0.6);
      power(e.burner.volume.gain, (e.texture ? 0.21 : 0.37) * ab * combustion, 0.35);
      power(e.burner.lp.frequency, 1500 + 1900 * ab, 0.2);
      power(e.flutter.frequency, (23 + e.side * 1.3 + 14 * n2) * pitch, 0.4);
      power(e.flutterGain.gain, 0.028 * ab * combustion, 0.16);
      smooth(e.wind.volume.gain, wind * (view === "cockpit" ? 0.13 : 0.17), now, 0.25);
      smooth(e.wind.lp.frequency, 2800 + 2800 * Math.min(1, ias / 800), now, 0.4);
      smooth(e.buffet.volume.gain, (0.22 * load + 0.065 * transonic) * Math.min(1, ias / 160), now, 0.12);
      if (e.texture) {
        power(e.texture.volume.gain, 0.78 * ab * combustion, 0.35);
        power(e.texture.src.playbackRate, (0.98 + n2 * 0.035) * pitch, 0.6);
      }
    }
  }

  setTexture(buffer) {
    if (this.disposed || this.textureStatus === 'ready') return false;
    if (!buffer || buffer.numberOfChannels !== 1 || buffer.duration < 2) return false;
    for (const e of this.engines) {
      // Different phases/rates retain the source's detail without a phase-locked
      // mono duplicate. Only afterburner uses this recorded full-power texture.
      const src = loop(this.ctx, buffer, e.side < 0 ? 0 : buffer.duration * 0.43);
      const hp = filter(this.ctx, 'highpass', 120);
      const lp = filter(this.ctx, 'lowpass', 7800);
      const volume = gain(this.ctx, 0);
      src.connect(hp).connect(lp).connect(volume).connect(e.pan);
      e.texture = { src, hp, lp, volume };
      this.sources.push(src);
    }
    this.textureStatus = 'ready';
    this._apply();
    return true;
  }

  setDucking(value) { smooth(this.duckGain.gain, clamp(value, 0, 1), this.ctx.currentTime, value < 1 ? 0.08 : 0.4); }
  setDopplerFactor(f) { this.doppler = clamp(f, 0.5, 2); this._apply(); }
  dispose() { this.disposed = true; this.sources.forEach(stop); this.dry.disconnect(); this.distGain.disconnect(); }
}

function cannonBuffer(ctx, rng) {
  const sr = ctx.sampleRate;
  // Six seconds of individually authored rounds. Six barrel weights supply
  // light mechanical modulation; noise/metal modes vary independently per round.
  // Exact 100 Hz phase is baked at each sample rate, including 44.1 kHz.
  const buffer = ctx.createBuffer(1, sr * 6, sr);
  const data = buffer.getChannelData(0);
  const barrels = [1, 0.94, 0.98, 0.91, 0.96, 0.93];
  for (let round = 0; round < 600; round++) {
    const start = Math.round(round * sr / 100);
    const weight = barrels[round % 6] * (0.87 + rng.f() * 0.13);
    const bodyHz = 145 + rng.f() * 90, metalHz = 1050 + rng.f() * 550;
    let low = 0, previous = 0;
    for (let j = 0; j < Math.round(sr * 0.018); j++) {
      const t = j / sr, w = rng.f() * 2 - 1;
      low += (1 - Math.exp(-TAU * 2200 / sr)) * (w - low);
      const crack = (w - 0.22 * previous) * 1.15 * Math.exp(-t / 0.00085);
      const body = Math.sin(TAU * bodyHz * t) * 0.17 * Math.exp(-t / 0.0038);
      const grit = low * 0.5 * Math.exp(-t / 0.0026);
      const mechanism = Math.sin(TAU * metalHz * t) * 0.055 * Math.exp(-t / 0.0022);
      data[(start + j) % data.length] += (crack + body + grit + mechanism) * weight * Math.min(1, t / 0.00006);
      previous = w;
    }
  }
  normalize(data);
  return buffer;
}

export class GunVoice {
  constructor(ctx, destination, rng = new SfcRng(6102)) {
    this.ctx = ctx;
    this.rate = 100;
    this.buf = cannonBuffer(ctx, rng);
    this.burstGain = gain(ctx, 0);
    this.dry = gain(ctx);
    this.distFilter = filter(ctx, "lowpass", 10000);
    this.cabin = filter(ctx, 'lowpass', 12000);
    this.distGain = gain(ctx);
    this.burstGain.connect(this.cabin).connect(this.distFilter).connect(this.distGain).connect(this.dry).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };
    this.voices = new Set();
    this.maxVoices = 3;
    this.bursts = 0;
    this.doppler = 1;
    this.src = null;
    this.current = null;
    this._firing = false;
    this._end = Infinity;
  }
  get firing() { return this._firing && this.ctx.currentTime < this._end; }
  _stopAt(voice, at) {
    voice.end = Math.min(voice.end, at);
    voice.src.stop(voice.end);
  }
  _start() {
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.end <= now) { voice.cleanup(); continue; }
      voice.volume.gain.cancelAndHoldAtTime(now);
      voice.volume.gain.setTargetAtTime(0, now, 0.002);
      this._stopAt(voice, now + 0.012);
    }
    while (this.voices.size >= this.maxVoices) {
      const voice = this.voices.values().next().value;
      stop(voice.src); voice.cleanup();
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf; src.loop = true; src.playbackRate.value = this.doppler;
    const volume = gain(this.ctx, 0);
    src.connect(volume).connect(this.burstGain);
    const voice = { src, volume, end: Infinity, released: false, cleanup: () => {
      if (voice.released) return;
      voice.released = true; src.onended = null;
      src.disconnect(); volume.disconnect(); this.voices.delete(voice);
      if (this.current === voice) { this.current = null; this.src = null; }
    } };
    this.voices.add(voice); src.onended = voice.cleanup;
    // Begin on a round boundary, not an arbitrary phase of a silent loop.
    // A coprime stride rotates through all 600 authored rounds across bursts.
    const round = (this.bursts++ * 73) % 600;
    const offset = Math.round(round * this.ctx.sampleRate / this.rate) / this.ctx.sampleRate;
    volume.gain.setTargetAtTime(1, now, 0.0005);
    src.start(now, offset);
    this.src = src;
    this.current = voice;
  }
  fire(on) {
    if (this.disposed || (!!on === this._firing && this._end === Infinity)) return;
    const now = this.ctx.currentTime;
    if (on && (!this.firing || this._end !== Infinity)) this._start();
    this.burstGain.gain.cancelAndHoldAtTime(now);
    this.burstGain.gain.setTargetAtTime(on ? 0.88 : 0, now, on ? 0.001 : 0.012);
    if (!on) for (const voice of this.voices) this._stopAt(voice, now + 0.1);
    this._firing = !!on;
    this._end = Infinity;
    this.onFire?.(!!on);
  }
  burst(seconds = 0.5) {
    if (this.disposed) return;
    this.fire(true);
    this._end = this.ctx.currentTime + clamp(seconds, 0.02, 10);
    this.burstGain.gain.setTargetAtTime(0, this._end, 0.012);
    if (this.current) this._stopAt(this.current, this._end + 0.1);
  }
  setPerspective(view) { smooth(this.cabin.frequency, view === 'cockpit' ? 2900 : 12000, this.ctx.currentTime, 0.18); }
  setDopplerFactor(f) {
    this.doppler = clamp(f, 0.5, 2);
    for (const voice of this.voices) smooth(voice.src.playbackRate, this.doppler, this.ctx.currentTime, 0.05);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this._firing = false;
    for (const voice of this.voices) { voice.src.onended = null; stop(voice.src); voice.cleanup(); }
    this.dry.disconnect();
  }
}

function cueBuffer(ctx, { period, tone, pulses, sustain = false }) {
  const sr = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(sr * period), sr);
  const data = buffer.getChannelData(0);
  const paired = pulses.length > 1;
  let referenceEnergy = 0, coloredEnergy = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    let envelope = 0, pulseAge = 0;
    for (const [start, duration] of pulses) {
      const p = t - start;
      if (p >= 0 && p < duration) {
        envelope = Math.min(1, p / 0.008, (duration - p) / 0.018);
        pulseAge = p;
      }
    }
    // Scan rounds off within each ping; lock stays clean; paired launch pulses
    // get a brief harmonic edge. Pitch, pulse geometry and carrier phase stay
    // fixed, so threat identity never depends on a delayed or louder onset.
    const second = sustain ? 0.07 : paired ? 0.1 + 0.18 * Math.exp(-pulseAge / 0.016)
      : 0.045 + 0.115 * Math.exp(-pulseAge / 0.018);
    const third = paired ? 0.04 * Math.exp(-pulseAge / 0.014) : 0;
    const fundamental = Math.sin(TAU * tone * t);
    const harmonic = Math.sin(TAU * tone * 2 * t);
    const level = envelope * (sustain ? 0.8 + 0.2 * Math.sin(TAU * 5 * t) : 1);
    const reference = Math.fround((fundamental + 0.16 * harmonic) * level);
    data[i] = (fundamental + second * harmonic + third * Math.sin(TAU * tone * 3 * t)) * level;
    referenceEnergy += reference * reference;
    coloredEnergy += data[i] * data[i];
  }
  // Maintain each cue's original RMS while changing harmonic balance.
  const levelMatch = coloredEnergy > 0 ? Math.sqrt(referenceEnergy / coloredEnergy) : 1;
  for (let i = 0; i < data.length; i++) data[i] *= levelMatch;
  return buffer;
}

export class LockTones {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.SCAN_FREQ = 620;
    this.LOCK_FREQ = 930;
    this.LAUNCH_FREQ = 1240;
    this.dry = gain(ctx);
    this.distGain = gain(ctx);
    this.distFilter = filter(ctx, "lowpass", 4500);
    this.dry.connect(this.distFilter).connect(this.distGain).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };
    this.cues = {};
    this.active = new Set();
    this.maxVoices = 4;
    const specs = {
      scan: { period: 0.9, tone: 620, pulses: [[0, 0.075]] },
      lock: { period: 0.3, tone: 930, pulses: [[0, 0.23]], sustain: true },
      launch: { period: 0.48, tone: 1240, pulses: [[0, 0.09], [0.14, 0.09]] },
    };
    for (const [mode, spec] of Object.entries(specs)) {
      this.cues[mode] = { buffer: cueBuffer(ctx, spec) };
    }
    this.mode = "off";
    this.doppler = 1;
  }
  setMode(mode) {
    if (!["off", "scan", "lock", "launch"].includes(mode)) mode = "off";
    if (this.disposed || mode === this.mode) return;
    const now = this.ctx.currentTime;
    for (const voice of this.active) {
      if (voice.end <= now) { voice.cleanup(); continue; }
      if (voice.end !== Infinity) continue;
      voice.end = now + 0.07;
      voice.volume.gain.cancelAndHoldAtTime(now);
      voice.volume.gain.setTargetAtTime(0, now, 0.008);
      voice.src.stop(voice.end);
    }
    this.mode = mode;
    const levels = { scan: 0.05, lock: 0.067, launch: 0.105 };
    if (mode !== 'off') {
      // Start each newly acquired state at the beginning of its first pulse.
      // Pre-running silent loops could delay scan by825ms or incoming by250ms.
      // Short release tails count toward the cap during rapidly changing locks.
      while (this.active.size >= this.maxVoices) {
        const oldest = this.active.values().next().value;
        oldest.src.onended = null;
        stop(oldest.src); oldest.cleanup();
      }
      const src = this.ctx.createBufferSource();
      src.buffer = this.cues[mode].buffer; src.loop = true;
      src.playbackRate.value = this.doppler;
      const volume = gain(this.ctx, levels[mode]);
      src.connect(volume).connect(this.dry);
      const voice = { src, volume, end: Infinity, released: false, cleanup: () => {
        if (voice.released) return;
        voice.released = true; src.disconnect(); volume.disconnect(); this.active.delete(voice);
      } };
      this.active.add(voice);
      src.onended = voice.cleanup;
      src.start(now, 0);
    }
    this.onMode?.(mode);
  }
  setDopplerFactor(f) {
    this.doppler = clamp(f, 0.5, 2);
    for (const voice of this.active) smooth(voice.src.playbackRate, this.doppler, this.ctx.currentTime);
  }
  dispose() {
    this.disposed = true;
    for (const voice of this.active) { voice.src.onended = null; stop(voice.src); voice.cleanup(); }
    this.distGain.disconnect();
  }
}

const EFFECTS = {
  missile: { duration: 1.05, level: 0.5 },
  explosion: { duration: 2.8, level: 0.72 },
  impact: { duration: 0.48, level: 0.48 },
  flare: { duration: 0.3, level: 0.26 },
  sonic: { duration: 1.1, level: 0.36 },
  afterburner: { duration: 0.8, level: 0.26 },
  gear_start: { duration: 0.3, level: 0.16 },
  gear_lock: { duration: 0.45, level: 0.23 },
  touchdown: { duration: 0.9, level: 0.48 },
  fuel_out: { duration: 1.2, level: 0.12 },
};

function fracturePattern(kind, variationDraw) {
  if (kind !== 'explosion' && kind !== 'impact') return [];
  // Reuse entropy from the existing variation draw. Authoring these layers
  // must not move the shared RNG sequence for other effects or playback.
  const rng = new SfcRng(((variationDraw * 4294967296) >>> 0) ^ (kind === 'explosion' ? 0x584c4f44 : 0x484954));
  const blast = kind === 'explosion';
  return Array.from({ length: blast ? 6 : 3 }, (_, i) => {
    const frequency = (blast ? 650 : 900) + rng.f() * 1600;
    return { start: (blast ? 0.04 + i * 0.061 : 0.009 + i * 0.026) + rng.f() * (blast ? 0.024 : 0.009),
      decay: (blast ? 0.019 : 0.009) + rng.f() * (blast ? 0.028 : 0.016),
      level: (blast ? 0.14 : 0.16) * (1 - i * 0.075) * (0.75 + rng.f() * 0.5),
      frequency, overtone: frequency * (1.37 + rng.f() * 0.31) };
  });
}

function effectBuffer(ctx, rng, kind, duration) {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0, mid = 0, phase = 0;
  const variationDraw = rng.f(), variation = 0.9 + variationDraw * 0.2;
  const fractures = fracturePattern(kind, variationDraw);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate, w = rng.f() * 2 - 1;
    low += (1 - Math.exp(-TAU * 160 / ctx.sampleRate)) * (w - low);
    mid += (1 - Math.exp(-TAU * 1500 / ctx.sampleRate)) * (w - mid);
    phase += TAU * (38 + 90 * Math.exp(-t * 15)) * variation / ctx.sampleRate;
    let v = 0;
    if (kind === "explosion") {
      const turbulence = 0.88 + 0.12 * Math.sin(TAU * (17 + variationDraw * 9) * t);
      v = 3 * low * turbulence * Math.exp(-t / 0.55)
        + 0.12 * Math.sin(phase) * Math.exp(-t / 0.13)
        + 0.45 * (mid - low) * Math.exp(-t / 0.16)
        + 0.5 * mid * Math.exp(-t / 0.026) + 0.28 * w * Math.exp(-t / 0.009);
    } else if (kind === "missile") {
      const body = Math.min(1, t / 0.07) * Math.exp(-t / 0.21);
      v = (mid * 0.95 + low * 1.5) * body + w * 0.38 * Math.exp(-t / 0.008);
    } else if (kind === "impact") {
      v = w * 0.42 * Math.exp(-t / 0.006) + mid * 0.55 * Math.exp(-t / 0.042)
        + low * 1.2 * Math.exp(-t / 0.068)
        + (Math.sin(TAU * 190 * variation * t) * 0.12 + Math.sin(TAU * 437 * variation * t) * 0.065) * Math.exp(-t / 0.03);
    } else if (kind === "flare") {
      v = w * (0.55 * Math.exp(-t / 0.007) + 0.12 * Math.exp(-t / 0.055));
    } else if (kind === "sonic") {
      const second = Math.max(0, t - 0.095);
      v = low * 2 * Math.exp(-t / 0.2) + Math.sin(phase) * 0.35 * Math.exp(-t / 0.16)
        + (t > 0.095 ? low * Math.exp(-second / 0.13) : 0);
    } else if (kind === 'gear_start' || kind === 'gear_lock') {
      v = (mid * 0.4 + Math.sin(TAU * 145 * t) * 0.25) * Math.exp(-t / 0.026)
        + Math.sin(TAU * 410 * t) * 0.07 * Math.exp(-t / 0.085);
      if (kind === 'gear_lock' && t > 0.075) v += low * 1.8 * Math.exp(-(t - 0.075) / 0.03);
    } else if (kind === 'touchdown') {
      v = (Math.sin(TAU * 63 * t) * 0.48 + low * 2) * Math.exp(-t / 0.15)
        + mid * 0.3 * Math.exp(-t / 0.045);
    } else if (kind === 'fuel_out') {
      v = (low * 1.6 + mid * 0.25) * Math.exp(-t / 0.22);
    } else {
      v = (low * 2.5 + mid * 0.6) * Math.min(1, t / 0.055) * Math.exp(-t / 0.18);
    }
    for (const fragment of fractures) {
      const age = t - fragment.start, life = fragment.decay * 7;
      if (age <= 0 || age >= life) continue;
      const envelope = (1 - Math.exp(-age / 0.0012)) * Math.exp(-age / fragment.decay) * Math.min(1, (life - age) / 0.008);
      v += fragment.level * envelope * ((w - mid) * 0.9
        + Math.sin(TAU * fragment.frequency * age) * 0.12 + Math.sin(TAU * fragment.overtone * age) * 0.08);
    }
    data[i] = v * Math.min(1, t / 0.0015) * Math.min(1, (duration - t) / 0.08);
  }
  normalize(data);
  // DC correction above can move the endpoints; fade them back to zero.
  const fade = Math.round(ctx.sampleRate * 0.003);
  for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[data.length - 1 - i] *= i / fade; }
  return buffer;
}

function effectPriority(kind, requested) {
  if (Number.isFinite(requested)) return clamp(requested, 0.1, 5);
  if (kind === "impact" || kind === "fuel_out") return 3;
  if (kind === "explosion" || kind === "missile" || kind === "touchdown") return 2;
  return 1;
}

function effectImportance(voice, now) {
  const pending = Math.max(0, voice.start - now);
  // Future wavefronts are cheap to replace. An audible attack gets a small
  // continuity bias, while a decaying tail gradually gives its slot back.
  const envelope = pending > 0 ? 1 / (1 + pending * 2)
    : 1.15 * Math.exp(-Math.max(0, now - voice.start) / (voice.duration * 0.28));
  return voice.priority * voice.level * envelope / (1 + voice.distance / 650);
}

const effectCutoff = distance => Math.max(500, 10500 / (1 + distance / 1100));
const REFLECTION_SEND = { explosion: 1, impact: 0.5, missile: 0.2, sonic: 0.45, afterburner: 0.15, flare: 0.05, touchdown: 0.2 };
const effectReflection = (kind, distance) => (REFLECTION_SEND[kind] || 0) * (1 + 0.6 * clamp(distance / 3000, 0, 1));

export class CombatEffects {
  constructor(ctx, destination, rng = new SfcRng(22)) {
    this.ctx = ctx;
    this.rng = rng;
    this.dry = gain(ctx);
    this.dry.connect(destination);
    this.active = new Set();
    this.listenerPosition = null;
    this.maxVoices = 20;
    this.buffers = {};
    for (const [kind, spec] of Object.entries(EFFECTS)) this.buffers[kind] = Array.from({ length: 3 }, () => effectBuffer(ctx, rng, kind, spec.duration));
    // A quiet stereo reflection tail puts impacts in space; dry transients
    // remain immediate and precise. There is no reverb on cockpit alerts.
    this.room = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, Math.round(ctx.sampleRate * 0.7), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let smoothed = 0;
      for (let i = 0; i < d.length; i++) {
        smoothed += 0.22 * (rng.f() * 2 - 1 - smoothed);
        const t = i / ctx.sampleRate;
        d[i] = t < 0.035 ? 0 : smoothed * Math.exp(-(t - 0.035) / 0.12);
      }
    }
    this.room.buffer = impulse;
    this.roomGain = gain(ctx, 0.13);
    this.room.connect(this.roomGain).connect(this.dry);
  }

  updateListener(position) {
    if (this.disposed || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return;
    this.listenerPosition = position.slice();
    const now = this.ctx.currentTime;
    for (const voice of this.active) {
      if (!voice.position) continue;
      voice.currentDistance = Math.hypot(...voice.position.map((value, i) => value - position[i]));
      // Arrival and the audible tail use today's listener geometry. Retain
      // the original emission distance/start for propagation and scheduling.
      voice.lowpass.frequency.setTargetAtTime(effectCutoff(voice.currentDistance), now, 0.06);
      smooth(voice.reflectionSend.gain, effectReflection(voice.kind, voice.currentDistance), now, 0.12);
    }
  }

  play(kind, { distance = 0, pan = 0, strength = 1, delay = 0, sourceId, position, priority } = {}) {
    const spec = EFFECTS[kind];
    if (!spec || this.paused || this.disposed) return null;
    const now = this.ctx.currentTime;
    delay = clamp(delay, 0, 6);
    // Gameplay deduplicates a detonation by source identity. Distinct simultaneous
    // events must still sound; a per-kind cooldown would drop nearby hits.
    distance = clamp(distance, 0, 100000);
    strength = clamp(strength, 0, 2);
    if (distance > 18000 || strength <= 0) return null;
    // Expired sources are pruned here too, since offline render callbacks
    // (and busy background tabs) need not dispatch onended immediately.
    for (const voice of this.active) if (voice.end <= now) voice.cleanup();
    if (sourceId != null && [...this.active].some(voice => voice.sourceId === sourceId && voice.kind === kind)) return null;
    const incoming = { start: now + delay, duration: spec.duration, distance,
      priority: effectPriority(kind, priority), level: spec.level * strength };
    if (this.active.size >= this.maxVoices) {
      let victim = null, weakest = Infinity;
      for (const voice of this.active) {
        // A minor event cannot cut off a more important audible cue merely
        // because its tail has become quiet.
        if (voice.start <= now && voice.priority > incoming.priority) continue;
        const importance = effectImportance(voice, now);
        if (importance < weakest) { weakest = importance; victim = voice; }
      }
      if (!victim || effectImportance(incoming, now) <= weakest * 1.1) return null;
      // Stop pending playback before releasing its nodes. Preemption never
      // leaves detached scheduled sources or extra release voices alive.
      victim.src.onended = null;
      stop(victim.src);
      victim.cleanup();
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[kind][this.rng.int(3)];
    src.playbackRate.value = 0.96 + this.rng.f() * 0.08;
    const world = Array.isArray(position) && position.length === 3 && position.every(Number.isFinite);
    const currentDistance = world && this.listenerPosition
      ? Math.hypot(...position.map((value, i) => value - this.listenerPosition[i])) : distance;
    const lowpass = filter(this.ctx, "lowpass", effectCutoff(currentDistance));
    const volume = gain(this.ctx, incoming.level / (world ? 1 : 1 + distance / 650));
    const panner = world ? this.ctx.createPanner() : this.ctx.createStereoPanner();
    if (world) {
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 180; panner.rolloffFactor = 1;
      panner.positionX.value = position[0]; panner.positionY.value = position[1]; panner.positionZ.value = position[2];
    } else panner.pan.value = clamp(pan, -1, 1);
    src.connect(lowpass).connect(volume).connect(panner).connect(this.dry);
    // Close mechanisms stay dry; impacts are tight, while distant detonations
    // retain more diffuse space around their direct pressure front.
    const reflectionSend = gain(this.ctx, effectReflection(kind, currentDistance));
    panner.connect(reflectionSend).connect(this.room);
    const voice = { ...incoming, src, sourceId, kind, lowpass, reflectionSend, position: world ? position.slice() : null, currentDistance,
      duration: spec.duration / src.playbackRate.value,
      end: now + delay + spec.duration / src.playbackRate.value, released: false, cleanup: () => {
      if (voice.released) return;
      voice.released = true;
      src.disconnect(); lowpass.disconnect(); volume.disconnect(); panner.disconnect(); reflectionSend.disconnect(); this.active.delete(voice);
    } };
    this.active.add(voice);
    src.onended = voice.cleanup;
    src.start(now + delay);
    return voice;
  }
  stopAll() {
    for (const voice of this.active) { stop(voice.src); voice.cleanup(); }
    // Clear convolver history as well, so a stopped audition has no tail.
    const impulse = this.room.buffer;
    this.room.buffer = null;
    this.room.buffer = impulse;
  }
  dispose() { this.disposed = true; this.stopAll(); this.room.disconnect(); this.roomGain.disconnect(); this.dry.disconnect(); }
}

export class AudioBus {
  constructor({ seed = 1337, context = null, paused = false, loadSamples = !context, texture = null } = {}) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = context || new Ctx({ latencyHint: "interactive" });
    this.ownsContext = !context;
    this.rng = new SfcRng(seed);
    this.master = gain(this.ctx, 0.9);
    this.engineGroup = gain(this.ctx);
    this.engineGroup.connect(this.master);
    this.engineVolume = 1;
    this.uiVolume = 1;
    this.weapons = gain(this.ctx);
    this.weapons.connect(this.master);
    this.highpass = filter(this.ctx, "highpass", 24);
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    // The compressor catches sustained peaks. A transparent soft ceiling
    // catches sub-attack transients and keeps the actual output below 0 dBFS.
    this.ceiling = this.ctx.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.17 * (1 - Math.exp(-(a - 0.8) / 0.17)));
    }
    this.ceiling.curve = curve;
    this.ceiling.oversample = "2x";
    this.muteGain = gain(this.ctx);
    this.pauseGain = gain(this.ctx, paused ? 0 : 1);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.65;
    this.master.connect(this.highpass).connect(this.limiter).connect(this.ceiling)
      .connect(this.muteGain).connect(this.pauseGain).connect(this.analyser).connect(this.ctx.destination);
    this.muted = false;
    try { this.muted = globalThis.localStorage?.getItem(MUTE_KEY) === "1"; } catch (_) { /* storage may be unavailable */ }
    this.muteGain.gain.value = this.muted ? 0 : 1;
    this.engine = new EngineVoice(this.ctx, this.engineGroup, this.rng);
    this.airframe = new AirframeVoice(this.ctx, this.engineGroup, { seed: seed + 220 });
    this.scene = new AcousticScene(this.ctx, { aircraft: this.engineGroup, missile: this.weapons }, {
      seed: seed + 119, onListener: listener => this.effects.updateListener(listener.position),
    });
    this.gun = new GunVoice(this.ctx, this.weapons, this.rng);
    this.locks = new LockTones(this.ctx, this.master);
    this.effects = new CombatEffects(this.ctx, this.weapons, this.rng);
    this.locks.onMode = () => this._duck();
    this.radioActive = false;
    this.paused = !!paused;
    this.effects.paused = this.paused;
    this.scene.setPaused(this.paused);
    this.hidden = false;
    this.disposed = false;
    if (texture) this.engine.setTexture(texture);
    this.ready = texture || !loadSamples ? Promise.resolve(!!texture) : this.loadTextures();
    if (this.ownsContext) this._armGestureResume();
  }
  loadTextures(options) {
    if (this.disposed) return Promise.resolve(false);
    if (this.engine.textureStatus === 'ready') return Promise.resolve(true);
    if (this._textureLoad) return this._textureLoad;
    this.engine.textureStatus = 'loading';
    this._textureLoad = (async () => {
      try {
        const texture = await loadEngineTexture(this.ctx, options);
        if (this.disposed) return false;
        return this.engine.setTexture(texture);
      } catch (error) {
        if (!this.disposed) this.engine.textureStatus = 'fallback';
        this.textureError = error.message;
        return false;
      }
    })();
    return this._textureLoad;
  }
  _duck() {
    const launch = this.uiVolume > 0 && this.locks.mode === "launch";
    const radio = this.uiVolume > 0 && this.radioActive;
    const target = this.engineVolume * (radio ? 0.48 : launch ? 0.65 : 1);
    // Make room during the first warning pulse; rising transitions keep the
    // softer recovery, including radio clearing while a launch is still active.
    const seconds = radio ? 0.08 : launch && target < this.engineGroup.gain.value ? 0.045 : 0.3;
    smooth(this.engineGroup.gain, target, this.ctx.currentTime, seconds);
  }
  setEngineVolume(value) { this.engineVolume = clamp(value, 0, 1); this._duck(); }
  setUiVolume(value) {
    this.uiVolume = clamp(value, 0, 1);
    smooth(this.locks.dry.gain, this.uiVolume, this.ctx.currentTime, 0.02);
    // An inaudible warning or radio call should not pull the engine down.
    this._duck();
  }
  setRadioActive(active) { this.radioActive = !!active; this._duck(); }
  setWeaponsVolume(value) { smooth(this.weapons.gain, clamp(value, 0, 1), this.ctx.currentTime, 0.02); }
  async resume() {
    if (this.disposed || this.hidden || !this.ownsContext) return false;
    try { if (this.ctx.state === "suspended" || this.ctx.state === "interrupted") await this.ctx.resume(); } catch (_) { return false; }
    return this.ctx.state === "running";
  }
  _armGestureResume() {
    this._gesture = () => { this.resume(); };
    this._visibility = () => { this.hidden = document.hidden; this._applyPause(); if (!this.hidden) this.resume(); };
    this._pagehide = (event) => {
      if (event.persisted) { this.hidden = true; this._applyPause(); }
      else this.dispose();
    };
    this._pageshow = () => { this.hidden = document.hidden; this._applyPause(); this.resume(); };
    for (const event of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(event, this._gesture, { passive: true });
    document.addEventListener("visibilitychange", this._visibility);
    window.addEventListener("pagehide", this._pagehide);
    window.addEventListener("pageshow", this._pageshow);
    this.hidden = document.hidden;
    this._applyPause();
    this.resume();
  }
  setPaused(paused) { if (this.paused !== !!paused) { this.paused = !!paused; this._applyPause(); } }
  _applyPause() {
    const paused = this.paused || this.hidden;
    smooth(this.pauseGain.gain, paused ? 0 : 1, this.ctx.currentTime, paused ? 0.015 : 0.1);
    this.effects.paused = paused;
    this.scene.setPaused(paused);
    if (paused) { this.gun.fire(false); this.locks.setMode("off"); this.effects.stopAll(); }
  }
  setMute(value) {
    this.muted = !!value;
    smooth(this.muteGain.gain, this.muted ? 0 : 1, this.ctx.currentTime, 0.01);
    try { globalThis.localStorage?.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch (_) { /* audio still works without storage */ }
  }
  toggleMute() { this.setMute(!this.muted); return this.muted; }
  playAt(voice, { dist = 500, closingVel = 0 } = {}) {
    if (!voice?._distNode) return;
    dist = clamp(dist, 0, 100000);
    const now = this.ctx.currentTime;
    smooth(voice._distNode.gainNode.gain, Math.min(1, 60 / Math.max(dist, 60)), now);
    smooth(voice._distNode.filterNode.frequency, Math.max(300, 18000 / (1 + dist / 800)), now);
    voice.setDopplerFactor?.(clamp(343 / Math.max(171.5, 343 - closingVel), 0.5, 2));
  }
  getFrequencyData() { const a = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(a); return a; }
  getTimeDomainData() { const a = new Uint8Array(this.analyser.fftSize); this.analyser.getByteTimeDomainData(a); return a; }
  bandEnergyHz(lo, hi) {
    const data = this.getFrequencyData(), binHz = this.ctx.sampleRate / 2 / data.length;
    let sum = 0, n = 0;
    for (let i = Math.max(0, Math.ceil(lo / binHz)); i < Math.min(data.length, Math.floor(hi / binHz) + 1); i++) { sum += data[i]; n++; }
    return n ? sum / n : 0;
  }
  totalEnergy() { const data = this.getFrequencyData(); return data.reduce((a, b) => a + b, 0) / data.length; }
  rms() {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ownsContext) {
      for (const event of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(event, this._gesture);
      document.removeEventListener("visibilitychange", this._visibility);
      window.removeEventListener("pagehide", this._pagehide);
      window.removeEventListener("pageshow", this._pageshow);
    }
    this.engine.dispose(); this.airframe.dispose(); this.scene.dispose(); this.gun.dispose(); this.locks.dispose(); this.effects.dispose();
    this.analyser.disconnect(); this.master.disconnect(); this.weapons.disconnect(); this.engineGroup.disconnect();
    if (this.ownsContext && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
  }
}

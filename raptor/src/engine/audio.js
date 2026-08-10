// RAPTOR audio foundation (phase 13 groundwork, synth-first). Pure Web Audio —
// no samples, no THREE dependency. Everything here is procedural: buffers are
// baked once at construction (noise beds, impulse trains, beep loops) then
// looped by the audio clock, so timing-critical voices (the gun) never drift
// the way a setInterval scheduler would. AudioBus is the only export game code
// needs; EngineVoice/GunVoice/LockTones are exported too for labs + QA.

import { SfcRng } from "./rng.js";

const MUTE_KEY = "raptor:mute";

// ---- shared synth helpers -------------------------------------------------

function biquad(ctx, type, freq, Q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (Q !== undefined) f.Q.value = Q;
  return f;
}

function loopedSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

// Leaky-integrator ("brownish") noise: every sample nudges toward the last
// value by a fraction of a fresh white sample. Small leak = slow/deep motion
// (good for LFO-style jitter), larger leak = broadband rumble texture.
function brownishSamples(len, rng, leak) {
  const data = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = rng.f() * 2 - 1;
    last += leak * (white - last);
    data[i] = last;
  }
  return data;
}

function normalize(data, peak) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

// Crossfades the buffer's tail into its head so a looped play has no click
// at the seam.
function loopFade(data, fadeLen) {
  const n = data.length;
  const fl = Math.min(fadeLen, n >> 1);
  for (let i = 0; i < fl; i++) {
    const t = i / fl;
    const tailIdx = n - fl + i;
    data[tailIdx] = data[tailIdx] * (1 - t) + data[i] * t;
  }
}

// Broadband noise bed shared by the engine's bandpass network. Flat (white)
// spectrum deliberately: the bandpasses are what carve out core/mid/AB/
// airflow character by sweeping their center frequency, so the source must
// be spectrally neutral or sweeping the center frequency would also sweep
// across the source's own energy contour (brown noise falls off ~1/f² and
// would make a LOWER filter center sound louder than a higher one regardless
// of downstream gain — fought every attempt to balance idle vs full power).
function makeLoopedWhiteNoise(ctx, rng, seconds) {
  const len = Math.round(ctx.sampleRate * seconds);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = (rng.f() * 2 - 1) * 0.9;
  loopFade(data, Math.round(ctx.sampleRate * 0.03));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

// Slow random-walk control signal, remapped to [0,1] so it only ever adds
// upward jitter when fed into a GainNode's .gain AudioParam. This is the
// "random LFO gain jitter from a seeded PRNG" the afterburner crackle uses —
// deterministic given the same seed, sample-accurate, no timers involved.
function makeSlowRandomWalkBuffer(ctx, rng, seconds, leak) {
  const len = Math.round(ctx.sampleRate * seconds);
  const data = brownishSamples(len, rng, leak);
  normalize(data, 1);
  for (let i = 0; i < len; i++) data[i] = (data[i] + 1) * 0.5;
  loopFade(data, Math.round(ctx.sampleRate * 0.1));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

// One M61 round: a short decaying noise crack, zero-padded to exactly
// round(sampleRate/rate) samples. Looping THIS buffer from t=0 forever means
// the impulse phase never resets — firing on/off is just a gain gate, so the
// repetition rate stays exact regardless of when the gate opens (no JS timer
// in the loop at all, unlike setInterval which drifts and gets throttled in
// background tabs).
function makeRoundBuffer(ctx, rate) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.round(sr / rate));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const crackLen = Math.min(len, Math.round(sr * 0.004));
  for (let i = 0; i < crackLen; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.0007);
    d[i] = (Math.random() * 2 - 1) * env;
  }
  return buf;
}

// One beep cycle (square-wave tone burst + envelope, silence for the rest of
// the period), looped the same way as the gun round — exact rate, no timers.
function makeBeepLoopBuffer(ctx, { period, tone, on, attack, decay }) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.round(sr * period));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const onLen = Math.min(len, Math.round(sr * on));
  const atk = Math.max(1, Math.round(sr * attack));
  const dec = Math.max(1, Math.round(sr * decay));
  for (let i = 0; i < onLen; i++) {
    const t = i / sr;
    let env = 1;
    if (i < atk) env = i / atk;
    else if (i > onLen - dec) env = Math.max(0, (onLen - i) / dec);
    d[i] = Math.sign(Math.sin(2 * Math.PI * tone * t)) * env * 0.9;
  }
  return buf;
}

// ---- EngineVoice: F119 synth ----------------------------------------------
// Layers: core rumble (40-120Hz bandpass) + mid (250-900Hz bandpass), both
// swept by N2%; a sawtooth sub also pitched by N2%; a whine oscillator
// (1.2-3.5kHz) tracking throttle directly; an afterburner layer (extra
// 60-400Hz noise band + seeded-PRNG crackle jitter); airflow noise (highpass
// noise scaling with IAS, independent of throttle). One shared noise buffer
// feeds every noise-based layer.
export class EngineVoice {
  constructor(ctx, destination, rng) {
    this.ctx = ctx;
    this.state = { throttle: 0, ab: 0, ias: 0 };
    this.doppler = 1;

    this.noiseBuf = makeLoopedWhiteNoise(ctx, rng, 4);
    this.noiseSrc = loopedSource(ctx, this.noiseBuf);

    // core + AB are cascaded pairs of bandpass biquads (4th-order effective
    // rolloff): a single 2nd-order bandpass only falls off ~6dB/octave, which
    // let their skirts bleed noticeably into the mid/whine register once
    // loud — a second stage in series keeps the passband shape but rolls off
    // far enough away to stay out of the higher bands.
    this.coreFilter = biquad(ctx, "bandpass", 70, 0.9);
    this.coreFilter2 = biquad(ctx, "bandpass", 70, 0.9);
    this.coreGain = ctx.createGain();
    this.midFilter = biquad(ctx, "bandpass", 400, 2.2);
    this.midFilter2 = biquad(ctx, "bandpass", 400, 2.2);
    this.midGain = ctx.createGain();
    this.abFilter = biquad(ctx, "bandpass", 180, 1.5);
    this.abFilter2 = biquad(ctx, "bandpass", 180, 1.5);
    this.abGain = ctx.createGain();
    this.abGain.gain.value = 0;
    this.airFilter = biquad(ctx, "highpass", 4500, 0.7);
    this.airFilter2 = biquad(ctx, "highpass", 4500, 0.7);
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;

    this.noiseSrc.connect(this.coreFilter).connect(this.coreFilter2).connect(this.coreGain);
    this.noiseSrc.connect(this.midFilter).connect(this.midFilter2).connect(this.midGain);
    this.noiseSrc.connect(this.abFilter).connect(this.abFilter2).connect(this.abGain);
    this.noiseSrc.connect(this.airFilter).connect(this.airFilter2).connect(this.airGain);

    // afterburner crackle: a slow seeded random walk added on top of abGain's
    // base level, scaled by AB intensity so it's silent whenever AB is off.
    this.crackleBuf = makeSlowRandomWalkBuffer(ctx, rng, 6, 0.003);
    this.crackleSrc = loopedSource(ctx, this.crackleBuf);
    this.crackleScale = ctx.createGain();
    this.crackleScale.gain.value = 0;
    this.crackleSrc.connect(this.crackleScale).connect(this.abGain.gain);

    // sawtooth is rich in harmonics by nature (~1/n falloff) — a gentle
    // lowpass keeps its upper harmonics from bleeding into the whine/mid
    // register while leaving its fundamental + lower harmonics for presence.
    this.sawOsc = ctx.createOscillator();
    this.sawOsc.type = "sawtooth";
    this.sawOsc.frequency.value = 55;
    this.sawFilter = biquad(ctx, "lowpass", 500, 0.7);
    this.sawGain = ctx.createGain();
    this.sawOsc.connect(this.sawFilter).connect(this.sawGain);

    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = "sine";
    this.whineOsc.frequency.value = 1200;
    this.whineGain = ctx.createGain();
    this.whineOsc.connect(this.whineGain);

    this.dry = ctx.createGain();
    for (const g of [this.coreGain, this.midGain, this.abGain, this.airGain, this.sawGain, this.whineGain]) {
      g.connect(this.dry);
    }

    // distance/doppler stub chain (see AudioBus.playAt)
    this.distFilter = biquad(ctx, "lowpass", 20000, 0.7);
    this.distGain = ctx.createGain();
    this.dry.connect(this.distFilter).connect(this.distGain).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };

    this.noiseSrc.start();
    this.crackleSrc.start();
    this.sawOsc.start();
    this.whineOsc.start();

    this.setState(this.state);
  }

  setState({ throttle = 0, ab = 0, ias = 0 } = {}) {
    this.state = {
      throttle: Math.min(1, Math.max(0, throttle)),
      ab: Math.min(1, Math.max(0, ab)),
      ias: Math.max(0, ias),
    };
    this._apply();
  }

  _apply() {
    const { throttle, ab, ias } = this.state;
    const now = this.ctx.currentTime;
    const RAMP = 0.08;
    const n2 = Math.pow(throttle, 0.7); // spool-up curve: quick rise, then flattens
    const iasNorm = Math.min(1, ias / 500);
    const d = this.doppler;

    // levels are deliberately modest pre-limiter: idle must sit well below
    // the brickwall threshold so full+AB has real headroom to grow into,
    // rather than both states getting flattened onto the same ceiling. The
    // idle floor is intentionally quiet (a wide idle->full swing in dB) —
    // idle hum should be subtle, AB should be dramatic.
    const coreFreq = (40 + 80 * n2) * d;
    this.coreFilter.frequency.setTargetAtTime(coreFreq, now, RAMP);
    this.coreFilter2.frequency.setTargetAtTime(coreFreq, now, RAMP);
    this.coreGain.gain.setTargetAtTime(0.04 + 0.55 * n2, now, RAMP);

    const midFreq = (250 + 400 * n2) * d;
    this.midFilter.frequency.setTargetAtTime(midFreq, now, RAMP);
    this.midFilter2.frequency.setTargetAtTime(midFreq, now, RAMP);
    this.midGain.gain.setTargetAtTime(0.006 + 0.11 * n2, now, RAMP);

    this.sawOsc.frequency.setTargetAtTime((55 + 55 * n2) * d, now, RAMP);
    this.sawGain.gain.setTargetAtTime(0.004 + 0.05 * n2, now, RAMP);

    this.whineOsc.frequency.setTargetAtTime((1200 + 2300 * throttle) * d, now, RAMP);
    this.whineGain.gain.setTargetAtTime(0.003 + 0.03 * throttle, now, RAMP);

    this.abFilter.frequency.setTargetAtTime(180 * d, now, RAMP);
    this.abFilter2.frequency.setTargetAtTime(180 * d, now, RAMP);
    this.abGain.gain.setTargetAtTime(ab * 0.65, now, RAMP);
    this.crackleScale.gain.setTargetAtTime(ab * 0.18, now, RAMP);

    this.airGain.gain.setTargetAtTime(0.003 + 0.015 * iasNorm, now, RAMP);
  }

  setDopplerFactor(f) {
    this.doppler = Math.min(2, Math.max(0.5, f));
    this._apply();
  }
}

// ---- GunVoice: M61A2 -------------------------------------------------------
// 100Hz impulse train (6000rpm) baked into one looping buffer; firing is a
// gain gate on top of a source that has been running since construction, so
// the impulse phase — and therefore the rate — never drifts.
export class GunVoice {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.rate = 100;
    this.buf = makeRoundBuffer(ctx, this.rate);
    this.src = loopedSource(ctx, this.buf);

    this.burstGain = ctx.createGain();
    this.burstGain.gain.value = 0;
    this.distFilter = biquad(ctx, "lowpass", 20000, 0.7);
    this.distGain = ctx.createGain();
    this.dry = ctx.createGain(); // group fader (settings weapons channel, D-081) — burstGain stays the fire gate
    this.src.connect(this.burstGain).connect(this.distFilter).connect(this.distGain).connect(this.dry).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };

    this.src.start();
    this.firing = false;
    this._burstTimer = null;
  }

  fire(on) {
    this.firing = !!on;
    const now = this.ctx.currentTime;
    this.burstGain.gain.cancelScheduledValues(now);
    this.burstGain.gain.setTargetAtTime(this.firing ? 1 : 0, now, 0.002);
  }

  // convenience for UI/AI callers: fire for a fixed duration then stop.
  burst(seconds = 0.5) {
    this.fire(true);
    clearTimeout(this._burstTimer);
    this._burstTimer = setTimeout(() => this.fire(false), seconds * 1000);
  }

  setDopplerFactor(f) {
    this.src.playbackRate.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }
}

// ---- LockTones: WT-style RWR/seeker beeps ---------------------------------
// Slow scan beep and fast lock beep are baked beep-loop buffers (exact rate,
// same trick as the gun); continuous launch warble is a live square
// oscillator with an LFO frequency-modulating it, since it isn't periodic —
// it's a continuous tone that itself wobbles.
export class LockTones {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.SCAN_FREQ = 720;
    this.LOCK_FREQ = 1100;
    this.LAUNCH_FREQ = 1900;

    this.scanBuf = makeBeepLoopBuffer(ctx, { period: 0.65, tone: this.SCAN_FREQ, on: 0.09, attack: 0.006, decay: 0.05 });
    this.lockBuf = makeBeepLoopBuffer(ctx, { period: 0.16, tone: this.LOCK_FREQ, on: 0.05, attack: 0.004, decay: 0.03 });
    this.scanSrc = loopedSource(ctx, this.scanBuf);
    this.lockSrc = loopedSource(ctx, this.lockBuf);
    this.scanGain = ctx.createGain();
    this.scanGain.gain.value = 0;
    this.lockGain = ctx.createGain();
    this.lockGain.gain.value = 0;
    this.scanSrc.connect(this.scanGain);
    this.lockSrc.connect(this.lockGain);

    this.launchOsc = ctx.createOscillator();
    this.launchOsc.type = "square";
    this.launchOsc.frequency.value = this.LAUNCH_FREQ;
    this.launchLfo = ctx.createOscillator();
    this.launchLfo.type = "sine";
    this.launchLfo.frequency.value = 9;
    this.launchLfoGain = ctx.createGain();
    this.launchLfoGain.gain.value = 300;
    this.launchLfo.connect(this.launchLfoGain).connect(this.launchOsc.frequency);
    this.launchGain = ctx.createGain();
    this.launchGain.gain.value = 0;
    this.launchOsc.connect(this.launchGain);

    this.dry = ctx.createGain();
    for (const g of [this.scanGain, this.lockGain, this.launchGain]) g.connect(this.dry);

    this.distFilter = biquad(ctx, "lowpass", 20000, 0.7);
    this.distGain = ctx.createGain();
    this.dry.connect(this.distFilter).connect(this.distGain).connect(destination);
    this._distNode = { gainNode: this.distGain, filterNode: this.distFilter };

    this.scanSrc.start();
    this.lockSrc.start();
    this.launchOsc.start();
    this.launchLfo.start();

    this.mode = "off"; // "off" | "scan" | "lock" | "launch"
  }

  setMode(mode) {
    this.mode = mode;
    const now = this.ctx.currentTime;
    this.scanGain.gain.setTargetAtTime(mode === "scan" ? 1 : 0, now, 0.01);
    this.lockGain.gain.setTargetAtTime(mode === "lock" ? 1 : 0, now, 0.01);
    this.launchGain.gain.setTargetAtTime(mode === "launch" ? 1 : 0, now, 0.01);
  }

  setDopplerFactor(f) {
    this.scanSrc.playbackRate.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.lockSrc.playbackRate.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }
}

// ---- AudioBus ---------------------------------------------------------------
export class AudioBus {
  constructor({ seed = 1337 } = {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.rng = new SfcRng(seed); // audio-only RNG — never the sim's, so audio
                                  // callbacks can't perturb replay/lockstep hashes

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    // brickwall-ish limiter: stays transparent under normal levels (hard
    // knee, high ratio) and only clamps hard once a peak actually threatens
    // 0dBFS — a low threshold here would behave like an always-on compressor
    // and flatten the very dynamic range (idle hum vs AB roar) voices rely on.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    this.muteGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.6;

    // analyser taps post-mute so muting reads back as silence, but
    // pre-limiter: DynamicsCompressorNode's spec-mandated automatic makeup
    // gain reshapes levels independent of the actual voice mix, which made
    // spectrum readings a function of the limiter's curve as much as the
    // synths. The limiter still guards the real output from clipping.
    this.master.connect(this.muteGain);
    this.muteGain.connect(this.analyser);
    this.muteGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this.muted = localStorage.getItem(MUTE_KEY) === "1";
    this.muteGain.gain.value = this.muted ? 0 : 1;

    this._armGestureResume();

    this.engine = new EngineVoice(this.ctx, this.master, this.rng);
    this.gun = new GunVoice(this.ctx, this.master);
    this.locks = new LockTones(this.ctx, this.master);
  }

  // Autoplay policy: the context starts (or lands) suspended until a real
  // user gesture resumes it. Headless QA sidesteps this entirely by launching
  // Chromium with --autoplay-policy=no-user-gesture-required, so the
  // immediate resume() below just succeeds there.
  _armGestureResume() {
    const tryResume = () => { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); };
    tryResume();
    const events = ["pointerdown", "keydown", "touchstart"];
    const onGesture = () => {
      tryResume();
      events.forEach((e) => window.removeEventListener(e, onGesture));
    };
    events.forEach((e) => window.addEventListener(e, onGesture));
  }

  setMute(m) {
    this.muted = !!m;
    this.muteGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.01);
    localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
  }

  toggleMute() {
    this.setMute(!this.muted);
    return this.muted;
  }

  // Distance/doppler stub: inverse-distance gain, distance-lowpass, and a
  // playbackRate/frequency doppler factor from closing velocity. Foundation
  // for later phases (wingmen, bandits, ground/naval units heard from the
  // cockpit) — not wired into gameplay yet.
  playAt(voice, { dist = 500, closingVel = 0 } = {}) {
    if (!voice || !voice._distNode) return;
    const now = this.ctx.currentTime;
    const REF_DIST = 60; // meters — unity gain at/inside this range
    const gain = Math.min(1, REF_DIST / Math.max(dist, REF_DIST));
    voice._distNode.gainNode.gain.setTargetAtTime(gain, now, 0.05);
    const cutoff = Math.max(300, 18000 - dist * 5);
    voice._distNode.filterNode.frequency.setTargetAtTime(cutoff, now, 0.05);
    const SPEED_OF_SOUND = 343;
    const doppler = Math.min(2, Math.max(0.5, SPEED_OF_SOUND / Math.max(1, SPEED_OF_SOUND - closingVel)));
    if (voice.setDopplerFactor) voice.setDopplerFactor(doppler);
  }

  // ---- analyser helpers: used by audiolab.html + the QA battery, and handy
  // for future in-cockpit VU/RWR-volume readouts.
  getFrequencyData() {
    const a = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(a);
    return a;
  }

  getTimeDomainData() {
    const a = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(a);
    return a;
  }

  bandEnergyHz(lo, hi) {
    const data = this.getFrequencyData();
    const binHz = (this.ctx.sampleRate / 2) / data.length;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i++) {
      const f = i * binHz;
      if (f >= lo && f <= hi) { sum += data[i]; n++; }
    }
    return n ? sum / n : 0;
  }

  totalEnergy() {
    const data = this.getFrequencyData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length;
  }

  rms() {
    const data = this.getTimeDomainData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }
}

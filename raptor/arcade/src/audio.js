/**
 * An original, small Web Audio score. Nothing is fetched or decoded.
 * Call start() from a user gesture. update() follows the simulation, while
 * setPaused() is an independent pause switch for the shell. Dispatch each
 * simulation event once through event(); update() does not consume events.
 */

const LOOKAHEAD = 0.12;
const TICK_MS = 40;
const MAX_VOICES = 48;
const NOTE = n => 440 * 2 ** ((n - 69) / 12);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// One eight-bar phrase, with space for the action between its answers.
// Entries are [sixteenth, semitones from the lead tonic, duration in sixteenths].
const MELODY = [
  [[0, 0, 2.4], [4, -5, 1.4], [6, 3, 2.6], [10, 2, 1.5], [12, 0, 3]],
  [[2, 0, 2.6], [6, 3, 2.5], [10, 7, 1.5], [13, 3, 2.5]],
  [[0, -2, 2.4], [4, 3, 1.5], [6, 7, 2.5], [10, 5, 1.5], [12, 3, 3]],
  [[2, 2, 2], [5, 5, 2.5], [9, 0, 2.5], [13, -2, 2.5]],
  [[0, 0, 2.5], [4, 3, 1.5], [6, 5, 2.5], [10, 3, 1.5], [12, 0, 3]],
  [[0, -2, 3], [5, 0, 2.5], [9, 3, 2.5], [13, 2, 2.5]],
  [[2, 3, 2.5], [6, 0, 2.5], [10, -4, 2.5], [14, -2, 1.5]],
  [[0, -1, 2.5], [4, 2, 2.5], [8, -5, 3], [13, -1, 2]],
];
const HARMONY = [
  [0, [0, 3, 7, 10]], [-4, [0, 4, 7, 11]],
  [3, [0, 4, 7, 9]], [-2, [0, 4, 7, 14]],
  [0, [0, 3, 7, 10]], [-7, [0, 3, 7, 10]],
  [-4, [0, 4, 7, 11]], [-5, [0, 4, 7, 10]],
];
const SCORES = [
  { tonic: 50, bpm: 116, cutoff: 2400, arp: 0.025, lead: 0.066 },
  { tonic: 52, bpm: 124, cutoff: 2150, arp: 0.032, lead: 0.064 },
  { tonic: 53, bpm: 120, cutoff: 2800, arp: 0.029, lead: 0.060 },
];
const RATE_LIMITS = {
  shoot: 0.085, enemyHit: 0.07, playerHit: 0.12, explosion: 0.04,
  pickup: 0.07, missile: 0.12, roll: 0.16, boss: 1.4,
  stage: 0.5, win: 1, lose: 1,
};

export class ArcadeAudio {
  constructor({ volume = 0.62 } = {}) {
    this.context = null;
    this.muted = false;
    this.volume = Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.62;
    this.stage = 0;
    this._started = false;
    this._destroyed = false;
    this._manualPaused = false;
    this._gamePaused = true;
    this._timer = null;
    this._voices = new Set();
    this._last = new Map();
    this._step = 0;
    this._next = 0;
    this._shot = 0;
    this._boss = false;
    this._danger = false;
  }

  async start() {
    if (this._destroyed) return false;
    try {
      if (!this.context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return false;
        this.context = new Context({ latencyHint: 'interactive' });
        const ctx = this.context;
        this._master = ctx.createGain();
        this._music = ctx.createGain();
        this._sfx = ctx.createGain();
        this._music.gain.value = 0.65;
        this._sfx.gain.value = 0.85;
        this._master.gain.value = this.muted ? 0 : this.volume;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 16;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.16;
        this._music.connect(this._master);
        this._sfx.connect(this._master);
        this._master.connect(limiter);
        limiter.connect(ctx.destination);
        this._limiter = limiter;
        this._noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const noise = this._noiseBuffer.getChannelData(0);
        // Deterministic noise: a reload never changes the mix or consumes the
        // game's random stream. A slight low-pass removes harsh ultrasonic fizz.
        let seed = 0x73a4d15, last = 0;
        for (let i = 0; i < noise.length; i++) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          last = last * 0.16 + ((seed >>> 0) / 2147483648 - 1) * 0.84;
          noise[i] = last;
        }
        const real = new Float32Array(17), imaginary = new Float32Array(17);
        for (let n = 1; n < 17; n++) {
          imaginary[n] = Math.sin(Math.PI * n * 0.3) / (n ** 1.55);
        }
        this._wave = ctx.createPeriodicWave(real, imaginary);
        this._stateListener = () => this._syncScheduler();
        ctx.addEventListener?.('statechange', this._stateListener);
      }
      // This is the only place that creates or resumes an AudioContext. The
      // caller invokes start() on Start, Resume, or the sound button gesture.
      if (this.context.state !== 'running' && this.context.state !== 'closed') await this.context.resume();
      if (this._destroyed || this.context?.state !== 'running') return false;
      this._started = true;
      this._syncScheduler();
      return true;
    } catch {
      // Sound is an enhancement; denied autoplay or a disconnected device must
      // never prevent the game from starting or throw an unhandled rejection.
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.context && this._master) {
      const now = this.context.currentTime;
      this._master.gain.cancelScheduledValues(now);
      this._master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.012);
      if (this.muted) this._stopVoices();
    }
    this._syncScheduler();
  }

  setPaused(paused) {
    this._manualPaused = Boolean(paused);
    this._syncScheduler();
  }

  setStage(index) {
    if (!Number.isFinite(index)) return;
    const stage = clamp(Math.floor(index), 0, SCORES.length - 1);
    if (stage === this.stage) return;
    this.stage = stage;
    this._boss = false;
    this._step = 0;
    this._stopVoices('music');
    this._next = (this.context?.currentTime || 0) + 0.06;
  }

  update(state) {
    if (!state) return;
    this.setStage(state.stage);
    if (typeof state.phase === 'string') this._gamePaused = state.phase !== 'playing';
    const player = state.player;
    const health = player?.health ?? player?.hp;
    const maxHealth = player?.maxHealth ?? player?.maxHp ?? 100;
    this._danger = Number.isFinite(health) && health > 0 && health / maxHealth < 0.3;
    if ('boss' in state) this._boss = Boolean(state.boss && state.boss.hp !== 0);
    this._syncScheduler();
  }

  event(event) {
    if (!event || !this._started || this._destroyed || this.muted || this.context?.state !== 'running') return;
    const type = typeof event === 'string' ? event : event.type;
    const key = type === 'hit' ? (event.side === 'player' ? 'playerHit' : 'enemyHit') : type;
    if (!(key in RATE_LIMITS)) return;
    if (this._manualPaused && !['win', 'lose', 'stage'].includes(type)) return;
    const now = this.context.currentTime;
    if (now - (this._last.get(key) ?? -Infinity) < RATE_LIMITS[key]) return;
    this._last.set(key, now);
    const t = now + 0.005;
    const pan = Number.isFinite(event.x) ? clamp((event.x / 640 - 0.5) * 1.2, -0.7, 0.7) : 0;
    switch (type) {
      case 'shoot':
        this._tone(780, t, 0.058, 0.047, { end: 320, shape: 'triangle', cutoff: 2600, pan: (++this._shot % 2 ? -0.12 : 0.12), attack: 0.002 });
        break;
      case 'hit':
        if (event.side === 'player') {
          this._noise(t, 0.16, 0.16, { frequency: 920, end: 240, q: 0.8, filter: 'lowpass' });
          this._tone(190, t, 0.19, 0.15, { end: 61, shape: 'sawtooth', cutoff: 820 });
        } else {
          this._noise(t, 0.065, 0.07, { frequency: 2100, end: 720, q: 1.4, pan });
          this._tone(440, t, 0.045, 0.024, { end: 160, shape: 'triangle', pan });
        }
        break;
      case 'explosion': {
        const large = event.size === 'large' || Number(event.size) > 1;
        this._noise(t, large ? 0.66 : 0.27, large ? 0.27 : 0.16,
          { frequency: large ? 1900 : 2400, end: 90, filter: 'lowpass', pan });
        this._tone(large ? 102 : 146, t, large ? 0.65 : 0.3, large ? 0.29 : 0.15,
          { end: large ? 28 : 47, shape: 'sine', attack: 0.004, pan });
        break;
      }
      case 'missile':
        this._tone(142, t, 0.48, 0.29, { end: 35, shape: 'sine', attack: 0.004 });
        this._noise(t, 0.48, 0.19, { frequency: 1450, end: 220, q: 0.7, filter: 'lowpass', attack: 0.02 });
        this._tone(330, t, 0.12, 0.055, { end: 165, cutoff: 1100, shape: 'triangle' });
        break;
      case 'roll':
        this._noise(t, 0.36, 0.105, { frequency: 420, end: 3100, q: 0.6, attack: 0.055, pan: -0.25, panEnd: 0.25 });
        this._tone(330, t, 0.3, 0.043, { end: 660, shape: 'triangle', attack: 0.03 });
        break;
      case 'pickup': {
        const notes = event.kind === 'repair' ? [74, 77, 81] : event.kind === 'score' ? [81, 86] : [74, 81, 86];
        notes.forEach((n, i) => this._tone(NOTE(n), t + i * 0.055, 0.19, 0.083,
          { shape: 'sine', pan: (i - 1) * 0.15 }));
        break;
      }
      case 'boss':
        this._boss = true;
        [0, 0.22].forEach(offset => {
          this._tone(NOTE(SCORES[this.stage].tonic - 12), t + offset, 0.42, 0.15, { shape: 'triangle', cutoff: 700 });
          this._noise(t + offset, 0.24, 0.105, { frequency: 650, end: 90, filter: 'lowpass' });
        });
        break;
      case 'stage':
        this.setStage(event.stage);
        this._stinger([0, 4, 7, 11, 12], t, 0.095, true);
        break;
      case 'win':
        this._gamePaused = true;
        this._syncScheduler();
        this._stinger([0, 7, 12, 11, 7, 12], t, 0.14, true);
        break;
      case 'lose':
        this._gamePaused = true;
        this._syncScheduler();
        this._stinger([7, 3, 2, 0], t, 0.19, false);
        break;
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._clearTimer();
    this._stopVoices();
    if (this.context) {
      this.context.removeEventListener?.('statechange', this._stateListener);
      const closing = this.context.close();
      closing?.catch?.(() => {});
    }
    this._music?.disconnect();
    this._sfx?.disconnect();
    this._master?.disconnect();
    this._limiter?.disconnect();
    this._noiseBuffer = null;
    this._wave = null;
  }

  _clearTimer() {
    if (this._timer !== null) globalThis.clearInterval(this._timer);
    this._timer = null;
  }

  _syncScheduler() {
    const playing = this._started && !this._destroyed && !this.muted &&
      !this._manualPaused && !this._gamePaused && this.context?.state === 'running';
    if (!playing) {
      if (this._timer !== null) {
        this._clearTimer();
        this._stopVoices('music');
      }
      return;
    }
    if (this._timer !== null) return;
    this._next = this.context.currentTime + 0.045;
    this._tick();
    this._timer = globalThis.setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') { this._syncScheduler(); return; }
    // Do not replay a backlog after a sleeping tab or a long rendering frame.
    if (this._next < ctx.currentTime - 0.16) this._next = ctx.currentTime + 0.025;
    let count = 0;
    while (this._next < ctx.currentTime + LOOKAHEAD && count++ < 8) {
      this._musicStep(this._step++, this._next);
      this._next += 60 / SCORES[this.stage].bpm / 4;
    }
  }

  _musicStep(step, t) {
    const score = SCORES[this.stage], beat = 60 / score.bpm, sixteenth = beat / 4;
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const [offset, intervals] = HARMONY[bar], root = score.tonic + offset;
    const intensity = this._boss ? 1.17 : 1;
    const music = { bus: 'music' };

    // Warm, short pad voicings leave room for the melody and hit sounds.
    if (s === 0) {
      intervals.forEach((interval, i) => this._tone(NOTE(root + interval + 12), t, beat * 3.8, 0.028,
        { ...music, shape: 'triangle', cutoff: 1400, attack: 0.08, release: 0.25, pan: (i - 1.5) * 0.18 }));
    }
    // A syncopated octave bass, with a fifth leading into the next bar.
    if ([0, 3, 6, 8, 11, 14].includes(s)) {
      const interval = s === 14 ? 7 : (s === 6 || s === 11 ? 12 : 0);
      this._tone(NOTE(root - 12 + interval), t, sixteenth * (s === 0 || s === 8 ? 2.7 : 1.6), 0.145 * intensity,
        { ...music, shape: 'triangle', cutoff: 550, attack: 0.006, release: 0.045 });
    }
    // Alternating stereo arpeggios are quiet texture, not a competing tune.
    if (s % 2 === 0) {
      const pattern = this.stage === 1 ? [0, 2, 1, 3, 2, 0, 3, 1] : [0, 1, 2, 3, 2, 1, 3, 1];
      this._tone(NOTE(root + 24 + intervals[pattern[s / 2]]), t, sixteenth * 1.3, score.arp,
        { ...music, shape: 'sine', attack: 0.008, pan: s % 4 ? 0.32 : -0.32 });
    }
    const melody = MELODY[bar].find(note => note[0] === s);
    if (melody) {
      const note = score.tonic + 24 + melody[1];
      this._tone(NOTE(note), t, sixteenth * melody[2], score.lead,
        { ...music, shape: 'pulse', cutoff: score.cutoff, attack: 0.009, release: 0.075, vibrato: true });
      // A single, softer echo supplies depth without a global reverb wash.
      this._tone(NOTE(note), t + sixteenth * 3, sixteenth * Math.min(melody[2], 1.8), score.lead * 0.19,
        { ...music, shape: 'triangle', cutoff: 1500, pan: bar % 2 ? -0.3 : 0.3 });
    }
    if (s === 0 || s === 8 || (s === 11 && (bar % 2 || this._boss))) this._kick(t, intensity);
    if (s === 4 || s === 12) this._snare(t, intensity);
    if (s % 2 === 0 || (this._boss && s % 4 === 3)) {
      this._noise(t, s === 14 ? 0.10 : 0.035, s % 4 === 0 ? 0.045 : 0.029,
        { ...music, filter: 'highpass', frequency: 5100, pan: s % 4 ? 0.21 : -0.16 });
    }
    // A low heartbeat changes the arrangement without a piercing warning beep.
    if (this._danger && s === 15) this._tone(57, t, 0.09, 0.075, { ...music, shape: 'sine', end: 42 });
  }

  _kick(t, intensity) {
    this._tone(148, t, 0.23, 0.29 * intensity, { bus: 'music', shape: 'sine', end: 40, attack: 0.002 });
    this._noise(t, 0.025, 0.055, { bus: 'music', filter: 'lowpass', frequency: 1400 });
  }

  _snare(t, intensity) {
    this._noise(t, 0.13, 0.095 * intensity, { bus: 'music', frequency: 1700, q: 0.7, pan: 0.08 });
    this._tone(183, t, 0.095, 0.07, { bus: 'music', shape: 'triangle', end: 112 });
  }

  _stinger(notes, t, spacing, bright) {
    const tonic = SCORES[this.stage].tonic;
    notes.forEach((note, i) => this._tone(NOTE(tonic + 24 + note), t + i * spacing,
      i === notes.length - 1 ? 0.75 : 0.24, bright ? 0.10 : 0.072,
      { shape: bright ? 'pulse' : 'triangle', cutoff: bright ? 2900 : 1700, release: 0.2, pan: (i / notes.length - 0.5) * 0.25 }));
    const end = t + (notes.length - 1) * spacing;
    [0, bright ? 4 : 3, 7].forEach((interval, i) => this._tone(NOTE(tonic + 12 + interval), end, 1.05, 0.067,
      { shape: 'triangle', attack: 0.045, release: 0.3, pan: (i - 1) * 0.25 }));
    this._tone(NOTE(tonic - 12), end, 1.1, 0.17, { shape: 'sine', attack: 0.01, release: 0.3 });
  }

  _tone(frequency, t, duration, gain, options = {}) {
    if (!this.context || this._destroyed) return;
    const ctx = this.context, osc = ctx.createOscillator();
    if (options.shape === 'pulse') osc.setPeriodicWave(this._wave);
    else osc.type = options.shape || 'triangle';
    osc.frequency.setValueAtTime(Math.max(16, frequency), t);
    if (options.end) osc.frequency.exponentialRampToValueAtTime(Math.max(16, options.end), t + duration * 0.8);
    // A tiny authored pitch curve, without an extra always-running LFO node.
    if (options.vibrato && duration > 0.2) {
      osc.detune.setValueAtTime(0, t + 0.10);
      for (let dt = 0.14, i = 0; dt < duration; dt += 0.075, i++) {
        osc.detune.linearRampToValueAtTime(i % 2 ? -5 : 5, t + dt);
      }
    }
    this._voice(osc, t, duration, gain, { filter: 'lowpass', frequency: options.cutoff || 6000, ...options });
  }

  _noise(t, duration, gain, options = {}) {
    if (!this.context || this._destroyed) return;
    const source = this.context.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;
    this._voice(source, t, duration, gain, { filter: 'bandpass', frequency: 2200, ...options });
  }

  _voice(source, t, duration, gain, options) {
    const ctx = this.context, bus = options.bus || 'sfx';
    // Keep sound storms bounded. Prefer retiring a scheduled echo or old music
    // voice before sacrificing the player's hit, missile, or completion cue.
    while (this._voices.size >= MAX_VOICES) {
      const candidate = [...this._voices].find(v => v.bus === 'music') || this._voices.values().next().value;
      this._retire(candidate, 0.008);
    }
    const envelope = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.frequency, t);
    filter.Q.value = options.q ?? 0.65;
    if (options.end && source.buffer) filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.end), t + duration);
    const attack = Math.min(options.attack ?? 0.004, duration * 0.35);
    const release = options.release ?? Math.min(0.035, duration * 0.25);
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(gain, t + attack);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.075), t + duration);
    envelope.gain.linearRampToValueAtTime(0, t + duration + release);
    source.connect(filter);
    filter.connect(envelope);
    let pan = null;
    if (ctx.createStereoPanner && (options.pan || options.panEnd)) {
      pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(options.pan || 0, t);
      if (options.panEnd != null) pan.pan.linearRampToValueAtTime(options.panEnd, t + duration);
      envelope.connect(pan);
      pan.connect(bus === 'music' ? this._music : this._sfx);
    } else envelope.connect(bus === 'music' ? this._music : this._sfx);
    const voice = { source, envelope, filter, pan, bus, done: false };
    const disconnect = () => {
      if (voice.done) return;
      voice.done = true;
      this._voices.delete(voice);
      source.disconnect(); filter.disconnect(); envelope.disconnect(); pan?.disconnect();
    };
    voice.disconnect = disconnect;
    source.onended = disconnect;
    this._voices.add(voice);
    source.start(t);
    source.stop(t + duration + release + 0.01);
  }

  _retire(voice, fade = 0.025) {
    if (!voice || voice.done) return;
    const now = this.context.currentTime;
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setTargetAtTime(0, now, Math.max(0.002, fade / 4));
    try { voice.source.stop(now + fade); } catch { voice.disconnect(); }
    // Remove from the budget immediately; onended releases the actual nodes.
    this._voices.delete(voice);
  }

  _stopVoices(bus) {
    if (!this.context) return;
    for (const voice of this._voices) if (!bus || voice.bus === bus) this._retire(voice);
  }
}

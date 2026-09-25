// Native PCM regressions for irregular engine motion. Serve raptor/ and run
// await (await import('/tests/engine-motion.test.mjs')).runEngineMotionTests()
import { EngineVoice } from '../src/engine/audio.js';
import { loadEngineTexture } from '../src/engine/audio-assets.js';
import { measure } from './audio.test.mjs';

const assert = (ok, message) => { if (!ok) throw Error(message); };

async function lifecycle(sampleRate) {
  const ctx = new OfflineAudioContext(2, Math.round(sampleRate * 4.5), sampleRate);
  const live = new Set();
  let created = 0;
  for (const method of ['createBufferSource', 'createOscillator']) {
    const create = ctx[method].bind(ctx);
    ctx[method] = (...args) => {
      const source = create(...args), start = source.start.bind(source);
      created++;
      source.start = (...values) => { start(...values); live.add(source); };
      source.addEventListener('ended', () => live.delete(source), { once: true });
      return source;
    };
  }
  const voice = new EngineVoice(ctx, ctx.destination);
  try {
    voice.setTexture(await loadEngineTexture(ctx));
    const sourceBudget = created;
    assert(sourceBudget <= 10 && voice.textureStatus === 'ready', 'loaded engine must stay within ten sources');
    const seams = voice.engines.map(engine => {
      const pcm = engine.flutter.buffer.getChannelData(0);
      let total = 0, differences = 0;
      for (let i = 0; i < pcm.length; i++) {
        total += pcm[i];
        if (i) differences += (pcm[i] - pcm[i - 1]) ** 2;
      }
      const mean = total / pcm.length, derivativeRms = Math.sqrt(differences / (pcm.length - 1));
      const wrapDerivative = Math.abs(pcm[0] - pcm.at(-1));
      assert(Math.abs(mean) < 1e-6, `pressure control must not bias carrier speed, mean ${mean}`);
      assert(derivativeRms > 0 && wrapDerivative < 3 * derivativeRms, 'control wrap must not introduce an exceptional derivative');
      return { mean, derivativeRms, wrapDerivative, duration: engine.flutter.buffer.duration };
    });
    const base = { throttle: 1, ab: 1, powerInput: 'spool', ias: 0, view: 'external' };
    voice.setState(base);
    let pressureAfterStarvation;
    const events = Array.from({ length: 20 }, (_, i) => [0.2 + i * .025, () => voice.setState({ ...base, throttle: .6 + i * .02 })]);
    events.push([.8, () => voice.setState(base)], [1, () => voice.setState({ ...base, fuelStarved: true })],
      [2.25, () => {
        pressureAfterStarvation = voice.engines.map(e => ({ body: e.pressureGain.gain.value, motion: e.pressureMotion.gain.value }));
        voice.setState({ ...base, fuelStarved: true, ias: 600, g: 8, aoa: 20 });
      }], [3.8, () => voice.dispose()]);
    const tasks = events.map(([at, apply]) => ctx.suspend(at).then(async () => { try { apply(); } finally { await ctx.resume(); } }));
    const [buffer] = await Promise.all([ctx.startRendering(), ...tasks]);
    const powered = measure(buffer, .85, .99), starved = measure(buffer, 1.9, 2.15);
    const wind = measure(buffer, 3.1, 3.6), disposed = measure(buffer, 4), full = measure(buffer);
    assert(powered.rms > .005, 'fuel-cut check must start with audible engine power');
    assert(starved.rms < 1e-6, `fuel-starved pressure/combustion must settle silent at zero airspeed: ${starved.rms}`);
    assert(pressureAfterStarvation.every(e => Math.abs(e.body) < 1e-6 && Math.abs(e.motion) < 1e-6), 'fuel loss must gate both pressure body and pressure modulation');
    assert(wind.rms > .005, 'wind and aerodynamic buffet must remain after fuel loss');
    assert(created === sourceBudget, 'continuous state changes must not allocate looping sources');
    assert(live.size === 0 && disposed.rms < 1e-6, 'dispose must end every source and silence the graph');
    assert(full.finite && full.peak < 1, 'powered, starved and aerodynamic states must remain finite and unclipped');
    return { sourceBudget, created, remainingSources: live.size, seams, pressureAfterStarvation, powered, starved, wind, disposed, peak: full.peak };
  } finally { voice.dispose(); }
}

async function recurrence(sampleRate) {
  const seconds = 12, warmup = 2, ctx = new OfflineAudioContext(1, (seconds + warmup) * sampleRate, sampleRate);
  // Native anti-alias filtering precedes 2 kHz analysis. This path is a
  // measurement tap; it does not substitute or modify the shipped engine.
  const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
  for (const node of [a, b]) { node.type = 'lowpass'; node.frequency.value = 800; node.Q.value = Math.SQRT1_2; }
  a.connect(b).connect(ctx.destination);
  const voice = new EngineVoice(ctx, a);
  try {
    voice.setTexture(await loadEngineTexture(ctx));
    voice.setState({ throttle: .7, ias: 340, view: 'external', powerInput: 'spool' });
    const buffer = await ctx.startRendering(), full = measure(buffer, warmup);
    assert(full.finite && full.peak < 1, 'recurrence measurement must use valid native PCM');
    const source = buffer.getChannelData(0), rate = 2000, pcm = new Float64Array(seconds * rate);
    for (let i = 0; i < pcm.length; i++) {
      const start = Math.round((warmup + i / rate) * sampleRate), end = Math.round((warmup + (i + 1) / rate) * sampleRate);
      for (let j = start; j < end; j++) pcm[i] += source[j];
      pcm[i] /= end - start;
    }
    const mean = pcm.reduce((sum, x) => sum + x, 0) / pcm.length;
    for (let i = 0; i < pcm.length; i++) pcm[i] -= mean;
    const peaks = [];
    for (const center of [3.47, 3.93]) {
      let peak = -1, peakLag;
      // Search either side: changing a carrier's mean rate alone must not
      // pass by moving the same exact-repeat peak a few milliseconds.
      for (let lag = Math.round((center - .1) * rate); lag <= Math.round((center + .1) * rate); lag++) {
        let dot = 0, left = 0, right = 0;
        for (let i = lag; i < pcm.length; i++) { const x = pcm[i - lag], y = pcm[i]; dot += x * y; left += x * x; right += y * y; }
        const correlation = dot / Math.sqrt(left * right);
        if (correlation > peak) { peak = correlation; peakLag = lag / rate; }
      }
      // Original stationary carriers measured about .48-.50. This leaves
      // room for device-rate differences while rejecting their old footprint.
      assert(peak < .25, `strong carrier repetition near ${center}s: ${peak} at ${peakLag}s`);
      peaks.push({ originalPeriod: center, peakLag, correlation: peak });
    }
    return { duration: seconds, analysisRate: rate, peaks, pcm: full };
  } finally { voice.dispose(); a.disconnect(); b.disconnect(); }
}

export async function runEngineMotionTests({ sampleRates = [44100, 48000], log = false } = {}) {
  const tests = [];
  for (const sampleRate of sampleRates) for (const [name, run] of [
    ['engine pressure motion keeps centered seams, bounded ownership and fuel/disposal gates', lifecycle],
    ['engine carrier recurrence is reduced without merely shifting loop periods', recurrence],
  ]) {
    const started = performance.now();
    try { tests.push({ name, sampleRate, status: 'passed', metrics: await run(sampleRate), durationMs: Math.round(performance.now() - started) }); }
    catch (error) { tests.push({ name, sampleRate, status: 'failed', error: error.stack || error.message, durationMs: Math.round(performance.now() - started) }); }
    if (log) console.info(`[engine-motion] ${tests.at(-1).status}: ${name} (${sampleRate} Hz)`);
  }
  return { passed: tests.filter(t => t.status === 'passed').length, failed: tests.filter(t => t.status === 'failed').length, tests };
}

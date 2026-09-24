// Native Web Audio response checks. The FlightModel owns physical spool lag;
// its 120 Hz state is sampled here at the renderer's representative 60 Hz.
import { AudioBus } from '../src/engine/audio.js';
import { FlightModel, S } from '../src/sim/flight.js';
import { ENGINE } from '../src/sim/f22data.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const WARMUP = 6;
const FRAME_RATE = 60;

function crossing(trace, key, threshold, rising = true) {
  return trace.find(point => rising ? point[key] >= threshold : point[key] <= threshold)?.time ?? null;
}

async function measureScenario({ id, initialThrottle, initialAb = 0, throttle, input = 'spool', physical = true, duration = 5, sampleRate = 48000, pulseSeconds, switchAt }) {
  const context = new OfflineAudioContext(2, Math.ceil((WARMUP + duration + 0.1) * sampleRate), sampleRate);
  const bus = new AudioBus({ context, seed: 1337, loadSamples: true });
  await bus.ready;
  bus.setMute(false);
  const fm = new FlightModel();
  fm.initFlight({ alt: 6000, speed: 240, throttle: initialThrottle });
  fm.state[S.ABL] = fm.state[S.ABR] = initialAb;
  const state = () => ({
    throttle: physical ? (fm.state[S.SPL] + fm.state[S.SPR]) / 2 : initialThrottle,
    ab: physical ? (fm.state[S.ABL] + fm.state[S.ABR]) / 2 : initialAb,
    powerInput: input, ias: 0, mach: 0, g: 1, aoa: 0, view: 'external', active: true,
  });
  bus.engine.setState(state());
  const trace = [];
  const voice = bus.engine.engines[0];
  const dryStart = state().throttle ** 0.72;
  const dryEnd = (physical ? ENGINE.idleFraction + (1 - ENGINE.idleFraction) * Math.min(throttle, 1) : Math.min(throttle, 1)) ** 0.72;
  const controls = { throttle, aimPitch: 0, aimYaw: 0, gearDown: false };
  const scheduled = Array.from({ length: Math.round(duration * FRAME_RATE) + 1 }, (_, frame) => {
    const time = frame / FRAME_RATE;
    return context.suspend(WARMUP + time).then(async () => {
      try {
        if (physical && frame) for (let i = 0; i < 2; i++) fm.tick(1 / 120, controls, { groundH: 0 });
        const next = state();
        if (!physical) { next.throttle = Math.min(throttle, 1); next.ab = throttle > 1 ? 1 : 0; }
        if (pulseSeconds !== undefined && time >= pulseSeconds) { next.throttle = initialThrottle; next.ab = initialAb; }
        if (switchAt !== undefined && time >= switchAt) next.powerInput = 'spool';
        const targetN2 = next.throttle ** 0.72;
        const audioN2 = (voice.shaft.frequency.value / (1 + voice.side * 0.008) - 95) / 260;
        trace.push({ time: context.currentTime - WARMUP,
          targetDry: (targetN2 - dryStart) / (dryEnd - dryStart || 1),
          audioDry: (audioN2 - dryStart) / (dryEnd - dryStart || 1),
          targetAb: next.ab, audioAb: voice.texture.volume.gain.value / 0.78,
          targetSpool: next.throttle, audioN2,
        });
        bus.engine.setState(next);
      } finally { await context.resume(); }
    });
  });
  try {
    const [buffer] = await Promise.all([context.startRendering(), ...scheduled]);
    let sum = 0, peak = 0, finite = true, clipped = 0;
    const start = Math.round(WARMUP * sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const pcm = buffer.getChannelData(channel);
      for (let i = start; i < pcm.length; i++) {
        finite &&= Number.isFinite(pcm[i]);
        peak = Math.max(peak, Math.abs(pcm[i])); sum += pcm[i] ** 2;
        if (Math.abs(pcm[i]) >= 1) clipped++;
      }
    }
    const abRising = initialAb === 0;
    const targetDry90 = crossing(trace, 'targetDry', 0.9);
    const audioDry90 = crossing(trace, 'audioDry', 0.9);
    const targetAb90 = crossing(trace, 'targetAb', abRising ? 0.9 : 0.1, abRising);
    const audioAb90 = crossing(trace, 'audioAb', abRising ? 0.9 : 0.1, abRising);
    return { id, sampleRate, input, physical, pulseSeconds, switchAt, textureStatus: bus.engine.textureStatus,
      pcm: { finite, clipped, peak, rms: Math.sqrt(sum / ((buffer.length - start) * buffer.numberOfChannels)) },
      response: { targetDry90, audioDry90, dryExtraLag: targetDry90 === null || audioDry90 === null ? null : audioDry90 - targetDry90,
        targetAb90, audioAb90, abExtraLag: targetAb90 === null || audioAb90 === null ? null : audioAb90 - targetAb90 },
      atOneSecond: trace.reduce((best, point) => Math.abs(point.time - 1) < Math.abs(best.time - 1) ? point : best), trace };
  } finally { bus.dispose(); }
}

export async function measureEngineResponses({ sampleRate = 48000 } = {}) {
  const cases = [
    { id: 'simulated-idle-to-afterburner', initialThrottle: 0, throttle: 1.1 },
    { id: 'simulated-afterburner-to-idle', initialThrottle: 1, initialAb: 1, throttle: 0 },
    { id: 'already-spooled-step', initialThrottle: 0, throttle: 1.1, physical: false, duration: 2 },
    { id: 'manual-command-step', initialThrottle: 0, throttle: 1.1, input: 'command', physical: false, duration: 2 },
    { id: 'already-spooled-short-pulse', initialThrottle: 0, throttle: 1.1, physical: false, pulseSeconds: 0.1, duration: 1 },
    { id: 'command-to-spool-during-rise', initialThrottle: 0, throttle: 1.1, input: 'command', physical: false, switchAt: 0.25, duration: 1 },
  ];
  const results = [];
  for (const spec of cases) results.push(await measureScenario({ ...spec, sampleRate }));
  return results;
}

export async function runEngineResponseTests({ log = true, sampleRate = 48000 } = {}) {
  const results = await measureEngineResponses({ sampleRate });
  const tests = [
    ['simulated dry and afterburner response stays close to the flight model', () => {
      for (const result of results.slice(0, 2)) {
        assert(result.response.dryExtraLag !== null && result.response.dryExtraLag <= 0.1, `${result.id}: dry lag ${result.response.dryExtraLag}`);
        assert(result.response.abExtraLag !== null && result.response.abExtraLag <= 0.1, `${result.id}: AB lag ${result.response.abExtraLag}`);
      }
    }],
    ['already-spooled steps are dezippered while manual commands retain authored spool', () => {
      const fast = results[2], manual = results[3];
      assert(fast.response.audioDry90 > 0.1 && fast.response.audioDry90 <= 0.17, `spool step needs a short ramp: ${fast.response.audioDry90}`);
      assert(fast.response.audioAb90 > 0.1 && fast.response.audioAb90 <= 0.17, `AB step needs a short ramp: ${fast.response.audioAb90}`);
      assert(manual.response.audioDry90 > 1.6 && manual.response.audioDry90 < 1.9, `manual dry spool changed: ${manual.response.audioDry90}`);
      assert(manual.response.audioAb90 > 0.75 && manual.response.audioAb90 < 0.9, `manual AB spool changed: ${manual.response.audioAb90}`);
    }],
    ['engine transitions produce finite PCM with output headroom', () => {
      for (const result of results) {
        assert(result.textureStatus === 'ready', `${result.id}: afterburner texture must be loaded`);
        assert(result.pcm.finite && result.pcm.clipped === 0 && result.pcm.peak < 1, `${result.id}: invalid/clipped PCM`);
        assert(result.pcm.rms > 0.001, `${result.id}: missing PCM`);
      }
    }],
    ['short spool pulses release promptly and changing input mode retimes an unchanged target', () => {
      const pulse = results[4], switching = results[5];
      const top = Math.max(...pulse.trace.map(point => point.audioAb));
      const release = pulse.trace.find(point => point.time >= 0.4);
      assert(top > 0.75 && top < 0.9, `a short pulse should be smoothed, not erased or instantaneous: ${top}`);
      assert(Math.abs(release.audioDry) < 0.01 && release.audioAb < 0.01, `short-pulse tail persisted: ${JSON.stringify(release)}`);
      const settled = switching.trace.find(point => point.time >= 0.5);
      assert(settled.audioDry > 0.98 && settled.audioAb > 0.99, `unchanged target did not adopt the spool response: ${JSON.stringify(settled)}`);
    }],
  ];
  const checks = tests.map(([name, run]) => {
    try { run(); if (log) console.log('PASS', name); return { name, pass: true }; }
    catch (error) { if (log) console.error('FAIL', name, error.message); return { name, pass: false, error: error.message }; }
  });
  return { passed: checks.filter(check => check.pass).length, failed: checks.filter(check => !check.pass).length, checks, results };
}

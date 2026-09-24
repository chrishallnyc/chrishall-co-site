// Native Web Audio warning timing/lifecycle regressions. Serve raptor/ and run:
//   await (await import('/tests/warnings.test.mjs')).runWarningTests()
import { AudioBus, LockTones } from '../src/engine/audio.js';
import { measure } from './audio.test.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function render({ duration = 1.5, sampleRate = 48000, create = ctx => new LockTones(ctx, ctx.destination), events = [], setup, afterRender }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const voice = create(ctx);
  setup?.(voice, ctx);
  const scheduled = events.map(([when, apply]) => ctx.suspend(when).then(async () => {
    try { await apply(voice, ctx); } finally { await ctx.resume(); }
  }));
  try {
    const [buffer] = await Promise.all([ctx.startRendering(), ...scheduled]);
    return { buffer, details: await afterRender?.(voice, ctx) };
  } finally {
    if (ctx.state === 'suspended') await ctx.resume();
    voice.dispose();
  }
}

function onsetMs(buffer, when) {
  const samples = buffer.getChannelData(0);
  const first = Math.ceil(when * buffer.sampleRate);
  for (let i = first; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 0.00001) return (i / buffer.sampleRate - when) * 1000;
  }
  return Infinity;
}

const tests = [
  ['warning mode entry starts the first pulse regardless of global clock phase', async () => {
    const results = [];
    // These times fall inside the old free-running buffers' silent gaps.
    // Include late entry and both common device sample rates.
    for (const sampleRate of [44100, 48000]) {
      for (const [mode, when] of [['scan', 0.076], ['scan', 1.29], ['lock', 0.242], ['lock', 1.17], ['launch', 0.231], ['launch', 1.91]]) {
        let began;
        const { buffer } = await render({ duration: when + 0.12, sampleRate,
          events: [[when, (voice, ctx) => { began = ctx.currentTime; voice.setMode(mode); }]],
        });
        const latencyMs = onsetMs(buffer, began);
        const attack = measure(buffer, began + 0.008, began + 0.045);
        assert(latencyMs < 12, `${mode} at ${when}s/${sampleRate}Hz waited ${latencyMs}ms for its first pulse`);
        assert(attack.finite && attack.rms > 0.005, `${mode}: first pulse must have audible body, RMS ${attack.rms}`);
        results.push({ mode, sampleRate, requestedAt: when, began, latencyMs, attackRms: attack.rms });
      }
    }
    return results;
  }],
  ['unchanged mode preserves one voice and the intended pulse cadence', async () => {
    let original, began, peakVoices = 0;
    const events = [[0.11, (voice, ctx) => {
      voice.setMode('scan'); original = [...voice.active][0]; began = ctx.currentTime;
    }], ...Array.from({ length: 36 }, (_, i) => [0.14 + i * 0.022, voice => {
      voice.setMode('scan');
      peakVoices = Math.max(peakVoices, voice.active.size);
      assert(voice.active.size === 1 && voice.active.has(original), 'same-mode frames must keep the current source');
    }]), [1.12, voice => voice.setMode('off')]];
    const { buffer } = await render({ duration: 1.4, events });
    const firstPulse = measure(buffer, began + 0.012, began + 0.05).rms;
    const gap = measure(buffer, began + 0.11, began + 0.86).rms;
    const nextPulse = measure(buffer, began + 0.915, began + 0.95).rms;
    assert(firstPulse > 0.005 && nextPulse > 0.005, 'both scheduled scan pulses must be audible');
    assert(gap < 0.000001, `repeated state updates must not restart pulses during their gap, RMS ${gap}`);
    return { peakVoices, firstPulse, gap, nextPulse };
  }],
  ['rapid mode changes remain bounded and off releases every warning tail', async () => {
    let peakVoices = 0;
    const modes = ['scan', 'lock', 'launch'];
    const events = Array.from({ length: 72 }, (_, i) => [0.02 + i * 0.009, voice => {
      voice.setMode(modes[i % modes.length]);
      peakVoices = Math.max(peakVoices, voice.active.size);
      assert(voice.active.size <= voice.maxVoices && voice.maxVoices <= 4, 'active sources and release tails must share a bounded budget');
    }]);
    events.push([0.75, voice => voice.setMode('off')]);
    const { buffer, details } = await render({ duration: 1.3, events,
      afterRender: voice => ({ remainingVoices: voice.active.size, mode: voice.mode }),
    });
    const active = measure(buffer, 0.08, 0.65), tail = measure(buffer, 0.95).rms;
    assert(peakVoices === 4, 'churn must actually exercise the warning voice cap');
    assert(active.finite && active.rms > 0.005 && active.peak < 1, 'mode churn must remain finite, audible, and unclipped');
    assert(tail < 0.000001, `off must stop warning output, tail RMS ${tail}`);
    assert(details.mode === 'off' && details.remainingVoices === 0, 'ended warning sources must remove their bookkeeping');
    return { peakVoices, tail, ...details, peak: active.peak };
  }],
  ['bus pause clears warnings and resume waits for a new threat state', async () => {
    let modeOnPause, modeOnResume;
    const { buffer, details } = await render({ duration: 2.2,
      create: ctx => new AudioBus({ context: ctx }),
      setup: bus => { bus.setMute(false); bus.engine.dry.gain.value = 0; },
      events: [
        [0.2, bus => bus.locks.setMode('launch')],
        [0.65, bus => { bus.setPaused(true); modeOnPause = bus.locks.mode; }],
        [1.1, bus => { bus.setPaused(false); modeOnResume = bus.locks.mode; }],
        [1.3, bus => bus.locks.setMode('scan')],
        [1.7, bus => bus.locks.setMode('off')],
      ],
      afterRender: bus => ({ remainingVoices: bus.locks.active.size }),
    });
    const before = measure(buffer, 0.225, 0.27).rms;
    const paused = measure(buffer, 0.95, 1.08).rms;
    const resumed = measure(buffer, 1.16, 1.27).rms;
    const reacquired = measure(buffer, 1.325, 1.355).rms;
    assert(before > 0.005 && reacquired > 0.005, 'warnings must sound before pause and after a fresh acquisition');
    assert(modeOnPause === 'off' && modeOnResume === 'off', 'pause must clear the old threat state');
    assert(paused < 0.000001 && resumed < 0.000001, 'the previous warning must not leak through pause or restart itself');
    assert(details.remainingVoices === 0, 'warning tails must finish after clearing the new threat');
    return { before, paused, resumed, reacquired, modeOnPause, modeOnResume, ...details };
  }],
  ['disposal releases both active and retiring warning sources', async () => {
    let remainingVoices;
    const { buffer } = await render({ duration: 0.9, events: [
      [0.1, voice => voice.setMode('scan')],
      [0.13, voice => voice.setMode('launch')],
      [0.155, voice => { voice.dispose(); remainingVoices = voice.active.size; voice.setMode('lock'); }],
    ] });
    const before = measure(buffer, 0.115, 0.15).rms, tail = measure(buffer, 0.3).rms;
    assert(before > 0.005, 'disposal must be tested with audible warnings');
    assert(remainingVoices === 0 && tail < 0.000001, 'disposing warnings must stop current sources and pending release tails');
    return { before, remainingVoices, tail };
  }],
];

export async function runWarningTests({ names, log = false } = {}) {
  assert(typeof OfflineAudioContext === 'function', 'Run warnings.test.mjs in a browser with OfflineAudioContext');
  const started = performance.now(), results = [];
  const savedMute = localStorage.getItem('raptor:mute');
  try {
    for (const [name, run] of tests) {
      if (names && !names.some(fragment => name.includes(fragment))) continue;
      const began = performance.now();
      try { results.push({ name, status: 'passed', metrics: await run(), durationMs: Math.round(performance.now() - began) }); }
      catch (error) { results.push({ name, status: 'failed', error: error.stack || error.message, durationMs: Math.round(performance.now() - began) }); }
      if (log) console.info(`[warnings] ${results.at(-1).status}: ${name}`);
    }
  } finally {
    if (savedMute === null) localStorage.removeItem('raptor:mute');
    else localStorage.setItem('raptor:mute', savedMute);
  }
  return { passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length, durationMs: Math.round(performance.now() - started), tests: results };
}

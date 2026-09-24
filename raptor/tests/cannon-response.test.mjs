// Native cannon trigger/voice-lifecycle regressions. No device or timer needed.
import { GunVoice } from '../src/engine/audio.js';
import { measure } from './audio.test.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function render({ sampleRate = 48000, duration = 1, events = [], setup, afterRender }) {
  const context = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
  const gun = new GunVoice(context, context.destination);
  setup?.(gun, context);
  const scheduled = events.map(([at, action]) => context.suspend(at).then(async () => {
    try { await action(gun, context); } finally { await context.resume(); }
  }));
  try {
    const [buffer] = await Promise.all([context.startRendering(), ...scheduled]);
    return { buffer, details: await afterRender?.(gun, context) };
  } finally {
    if (context.state === 'suspended') await context.resume();
    gun.dispose();
  }
}

function safePcm(buffer, label) {
  const result = measure(buffer);
  assert(result.finite && result.peak < 1, `${label}: nonfinite or clipped PCM (${result.peak})`);
  assert(result.rms > 0.001, `${label}: test requires audible output`);
  return result;
}

const tests = [
  ['first-round attack is independent of the idle audio-clock phase', async sampleRate => {
    const trials = [];
    for (let i = 0; i < 18; i++) {
      let began;
      const { buffer } = await render({ sampleRate, duration: 0.65,
        events: [[0.2 + i * 0.0113, (gun, context) => { began = context.currentTime; gun.burst(0.025); }]],
      });
      // Index an exact sample count; floating time-to-frame flooring can
      // otherwise make equal 3 ms windows differ by one sample.
      const pcm = buffer.getChannelData(0), first = Math.round(began * sampleRate);
      const frames = Math.round(sampleRate * 0.003);
      let sum = 0, peak = 0;
      for (let j = 0; j < frames; j++) { const v = pcm[first + j]; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      const attack = { rms: Math.sqrt(sum / frames), peak };
      safePcm(buffer, 'first round');
      assert(attack.rms > 0.02, `missing first-round body at ${began}: ${attack.rms}`);
      trials.push({ began, rms: attack.rms, peak: attack.peak });
    }
    const rangeDb = key => 20 * Math.log10(Math.max(...trials.map(trial => trial[key])) / Math.min(...trials.map(trial => trial[key])));
    const rmsRangeDb = rangeDb('rms'), peakRangeDb = rangeDb('peak');
    assert(rmsRangeDb < 0.1 && peakRangeDb < 0.1, `global idle phase changed the onset: RMS ${rmsRangeDb}dB / peak ${peakRangeDb}dB`);
    return { rmsRangeDb, peakRangeDb, trials };
  }],
  ['successive taps retain authored round variation and retire after release', async sampleRate => {
    const starts = [], sources = [], offsets = [];
    let initialVoices;
    const { buffer, details } = await render({ sampleRate, duration: 3.3,
      setup: gun => { initialVoices = gun.voices.size; },
      events: Array.from({ length: 8 }, (_, i) => [0.1 + i * 0.38, (gun, context) => {
        starts.push(context.currentTime); gun.burst(0.04); sources.push(gun.current.src);
        offsets.push(((gun.bursts - 1) * 73) % 600);
      }]),
      afterRender: gun => ({ voices: gun.voices.size, current: gun.current, src: gun.src, firing: gun.firing }),
    });
    const pcm = safePcm(buffer, 'successive taps');
    const data = buffer.getChannelData(0), frames = Math.round(sampleRate * 0.003);
    const attacks = starts.map(start => data.slice(Math.round(start * sampleRate), Math.round(start * sampleRate) + frames));
    const pairDifferences = attacks.slice(1).map((attack, index) => {
      let sum = 0;
      for (let i = 0; i < frames; i++) sum += (attack[i] - attacks[index][i]) ** 2;
      return Math.sqrt(sum / frames);
    });
    assert(initialVoices === 0, 'an idle cannon must not run a silent looping source');
    assert(new Set(sources).size === starts.length, 'each separated tap must create its own trigger source');
    assert(pairDifferences.every(value => value > 0.003), `successive attacks were flattened into identical samples: ${pairDifferences}`);
    assert(details.voices === 0 && details.current === null && details.src === null && !details.firing, 'natural burst release must clear source ownership');
    assert(measure(buffer, 3.1).rms < 0.000001, 'released taps must become silent');
    return { initialVoices, offsets, pairDifferences, remainingVoices: details.voices, pcm };
  }],
  ['rapid retriggers share a three-source budget and disposal cannot restart them', async sampleRate => {
    let maxVoices = 0, atDispose;
    const events = Array.from({ length: 35 }, (_, i) => [0.1 + i * 0.0035, gun => {
      gun.burst(0.04);
      maxVoices = Math.max(maxVoices, gun.voices.size);
      assert(gun.voices.size <= 3, 'release tails must count toward the cannon source cap');
    }]);
    events.push([0.24, gun => {
      gun.dispose();
      const end = gun._end;
      gun.burst(0.2); gun.fire(true); gun.setDopplerFactor(1.2); gun.dispose();
      atDispose = { voices: gun.voices.size, current: gun.current, src: gun.src, firing: gun.firing, endUnchanged: gun._end === end };
    }]);
    const { buffer } = await render({ sampleRate, duration: 0.7, events });
    const pcm = safePcm(buffer, 'rapid retrigger');
    const tail = measure(buffer, 0.3).rms;
    assert(maxVoices === 3, 'rapid retrigger test must exercise the voice cap');
    assert(atDispose.voices === 0 && atDispose.current === null && atDispose.src === null && !atDispose.firing && atDispose.endUnchanged, 'disposed cannon must remain retired and ignore new triggers');
    assert(tail < 0.000001, `disposed sources leaked PCM: ${tail}`);
    return { maxVoices, atDispose, tail, pcm };
  }],
  ['promoting a scheduled burst to held fire survives the previous stop deadline', async sampleRate => {
    const cases = [];
    // Promote once during the burst and once during its scheduled release.
    for (const promoteAt of [0.14, 0.22]) {
      let burstSource, heldSource, afterDeadline, repeatedSource, finalVoices;
      const { buffer } = await render({ sampleRate, duration: 1.1, events: [
        [0.1, gun => { gun.burst(0.08); burstSource = gun.current.src; }],
        [promoteAt, gun => { gun.fire(true); heldSource = gun.current.src; }],
        [0.38, gun => { afterDeadline = gun.firing; gun.fire(true); repeatedSource = gun.current.src; }],
        [0.72, gun => gun.fire(false)],
        [1, gun => { finalVoices = gun.voices.size; }],
      ] });
      const pcm = safePcm(buffer, 'burst to held');
      const beforeDeadline = measure(buffer, 0.245, 0.275).rms;
      const after = measure(buffer, 0.38, 0.65).rms;
      const tail = measure(buffer, 0.93).rms;
      assert(heldSource !== burstSource, 'a held trigger needs a source without the old scheduled stop');
      assert(heldSource === repeatedSource, 'repeated held-fire frames must not restart the current source');
      assert(afterDeadline && after > beforeDeadline * 0.6, `held fire was cut at the previous scheduled stop: ${after}`);
      assert(finalVoices === 0 && tail < 0.000001, 'released held fire must retire its source');
      cases.push({ promoteAt, beforeDeadline, afterDeadline, afterRms: after, tail, finalVoices, pcm });
    }
    return cases;
  }],
  ['Doppler reaches active sources and new triggers without creating voices', async sampleRate => {
    let beforeTrigger, started, during;
    const { buffer } = await render({ sampleRate, duration: 0.65, events: [
      [0.1, gun => { gun.setDopplerFactor(1.3); beforeTrigger = gun.voices.size; gun.fire(true); started = gun.current.src.playbackRate.value; }],
      [0.2, gun => gun.setDopplerFactor(0.7)],
      [0.4, gun => { during = gun.current.src.playbackRate.value; gun.fire(false); }],
    ] });
    const pcm = safePcm(buffer, 'Doppler');
    assert(beforeTrigger === 0 && Math.abs(started - 1.3) < 0.00001, 'a new source must inherit Doppler without an idle loop');
    assert(during > 0.7 && during < 0.73, `active source Doppler did not smooth toward target: ${during}`);
    return { beforeTrigger, started, during, pcm };
  }],
];

export async function runCannonResponseTests({ sampleRates = [44100, 48000], log = false } = {}) {
  const results = [];
  for (const sampleRate of sampleRates) for (const [name, run] of tests) {
    try { results.push({ name, sampleRate, status: 'passed', metrics: await run(sampleRate) }); }
    catch (error) { results.push({ name, sampleRate, status: 'failed', error: error.stack || error.message }); }
    if (log) console.info(`[cannon] ${results.at(-1).status}: ${sampleRate}Hz ${name}`);
  }
  return { passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status === 'failed').length, tests: results };
}

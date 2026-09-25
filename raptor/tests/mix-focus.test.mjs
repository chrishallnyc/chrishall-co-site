// Native PCM regression for selective engine masking, scheduling and user mix.
// Serve raptor/ and call (await import('/tests/mix-focus.test.mjs')).runMixFocusTests().
import { AudioBus } from '../src/engine/audio.js';

const assert = (condition, message) => { if (!condition) throw Error(message); };
const rms = (pcm, start, end, rate) => {
  let energy = 0;
  const lo = Math.round(start * rate), hi = Math.round(end * rate);
  for (let i = lo; i < hi; i++) energy += pcm[i] ** 2;
  return Math.sqrt(energy / (hi - lo));
};
const dbRatio = (a, b) => 20 * Math.log10(Math.max(a, 1e-12) / Math.max(b, 1e-12));
function difference(a, b, channel, start, end) {
  const x = a.buffer.getChannelData(channel), y = b.buffer.getChannelData(channel);
  let maximum = 0;
  for (let i = Math.round(start * a.sampleRate); i < Math.round(end * a.sampleRate); i++) maximum = Math.max(maximum, Math.abs(x[i] - y[i]));
  return maximum;
}

async function render({ sampleRate, volume = 0.43, weapons = 1, ui = 1, events = [] }) {
  // Channels0/1: actual master processing.2/3: engine before/after selective
  // masking.4/5: native presence-band taps.6/7: native low-body-band taps.
  const ctx = new OfflineAudioContext(8, Math.ceil(sampleRate * 6.8), sampleRate);
  const bus = new AudioBus({ context: ctx, seed: 1337, loadSamples: true });
  const taps = [];
  let merger;
  try {
    await bus.ready; bus.setMute(false); bus.setEngineVolume(volume); bus.setWeaponsVolume(weapons); bus.setUiVolume(ui);
    bus.engine.setState({ throttle: 1, ab: 0.6, ias: 460, mach: 0.95, powerInput: 'spool', active: true, view: 'external' });
    // State changes still create real gun/warning sources and invoke the real
    // mixer. Remove only their audible outputs to isolate the engine response.
    bus.gun.dry.disconnect(); bus.locks.dry.disconnect();
    assert(bus.engineFocus, 'selective engine mixer is present');
    merger = ctx.createChannelMerger(8); merger.channelInterpretation = 'discrete'; merger.connect(ctx.destination);
    const split = ctx.createChannelSplitter(2); bus.analyser.disconnect(); bus.analyser.connect(split);
    split.connect(merger, 0, 0); split.connect(merger, 1, 1); taps.push(split);
    function tap(node, channel, frequency) {
      const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; node.connect(mono); taps.push(mono);
      if (frequency) {
        const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = frequency; band.Q.value = 1;
        mono.connect(band).connect(merger, 0, channel); taps.push(band);
      } else mono.connect(merger, 0, channel);
    }
    for (const [node, channel] of [[bus.engineGroup, 2], [bus.engineFocus, 3]]) {
      tap(node, channel); tap(node, channel + 2, 1400); tap(node, channel + 4, 160);
    }
    const scheduled = events.map(([at, action]) => ctx.suspend(at).then(async () => {
      try { action(bus); } finally { await ctx.resume(); }
    }));
    const [buffer] = await Promise.all([ctx.startRendering(), ...scheduled]);
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) {
      assert(Number.isFinite(value), 'all native stem and delivered PCM must be finite');
      if (channel < 2) peak = Math.max(peak, Math.abs(value));
    }
    assert(peak < 1, `delivered engine PCM must retain headroom: ${peak}`);
    const ratio = (channel, start, end) => dbRatio(rms(buffer.getChannelData(channel + 1), start, end, sampleRate), rms(buffer.getChannelData(channel), start, end, sampleRate));
    return { buffer, sampleRate, peak, presence: (start, end) => ratio(4, start, end), body: (start, end) => ratio(6, start, end) };
  } finally { bus.dispose(); for (const node of taps) node.disconnect(); merger?.disconnect(); }
}

export async function runMixFocusTests({ sampleRates = [44100, 48000], log = false } = {}) {
  const savedMute = localStorage.getItem('raptor:mute');
  const result = { passed: 0, failed: 0, tests: [] };
  try {
    localStorage.setItem('raptor:mute', '0');
    for (const sampleRate of sampleRates) {
      const reference = await render({ sampleRate });
      const cases = [
        ['finite cannon burst opens spectral space and recovers on the audio clock', async () => {
          const value = await render({ sampleRate, events: [[2, bus => bus.gun.burst(0.65)]] });
          const presence = value.presence(2.18, 2.5), body = value.body(2.18, 2.5), recovered = value.presence(3.8, 4.2);
          assert(presence < -2, `cannon must reduce actual engine presence energy: ${presence}dB`);
          assert(body > -1 && body < 0.2, `low engine body must survive selective masking: ${body}dB`);
          assert(Math.abs(recovered) < 0.15, `finite burst must recover without a JS timer or later state update: ${recovered}dB`);
          return { presenceDb: presence, bodyDb: body, recoveredDb: recovered, peak: value.peak };
        }],
        ['burst release preserves radio then threat priority before recovering', async () => {
          const value = await render({ sampleRate, events: [[2, bus => bus.gun.burst(1)], [2.4, bus => bus.setRadioActive(true)],
            [3.2, bus => bus.locks.setMode('launch')], [4, bus => bus.setRadioActive(false)], [5, bus => bus.locks.setMode('off')]] });
          const radio = value.presence(3.45, 3.85), threat = value.presence(4.6, 4.9), recovered = value.presence(6.2, 6.7);
          assert(radio < -2, `scheduled gun end must not erase ongoing radio space: ${radio}dB`);
          assert(threat < -1 && threat > radio + 0.5, `radio ending must retain the milder active threat space: ${radio}/${threat}dB`);
          assert(Math.abs(recovered) < 0.15, `all cues ending must restore engine spectrum: ${recovered}dB`);
          return { radioDb: radio, threatDb: threat, recoveredDb: recovered, peak: value.peak };
        }],
        ['muted weapons do not change engine PCM during real finite bursts', async () => {
          const value = await render({ sampleRate, weapons: 0, events: [[2, bus => bus.gun.burst(1)]] });
          const maximumDifference = Math.max(...[0, 1, 3].map(channel => difference(reference, value, channel, 1.8, 5)));
          assert(maximumDifference < 1e-6, `inaudible weapons altered engine PCM: ${maximumDifference}`);
          return { maximumDifference, peak: value.peak };
        }],
        ['muted warning and radio channels do not change actual engine PCM', async () => {
          const value = await render({ sampleRate, ui: 0, events: [[2, bus => bus.locks.setMode('launch')],
            [2.2, bus => bus.setRadioActive(true)], [3.2, bus => bus.setRadioActive(false)], [4, bus => bus.locks.setMode('off')]] });
          const maximumDifference = Math.max(...[0, 1, 3].map(channel => difference(reference, value, channel, 1.8, 5)));
          assert(maximumDifference < 1e-6, `inaudible warning/radio altered engine PCM: ${maximumDifference}`);
          return { maximumDifference, peak: value.peak };
        }],
        ['repeated user engine fader updates preserve active masking and its final level', async () => {
          const value = await render({ sampleRate, events: [[2, bus => bus.gun.burst(0.8)],
            ...[2.1, 2.2, 2.3, 2.4, 2.5].map(at => [at, bus => bus.setEngineVolume(0.43)])] });
          const beforeFilterDifference = difference(reference, value, 2, 1.8, 5);
          const settledDifference = difference(reference, value, 3, 5.8, 6.7);
          assert(value.presence(2.3, 2.65) < -2, 'reapplying the fader must not cancel active spectral space');
          assert(beforeFilterDifference < 1e-6, `weapon focus changed the chosen engine level: ${beforeFilterDifference}`);
          assert(settledDifference < 1e-6, `recovery did not restore the user-selected PCM level: ${settledDifference}`);
          return { beforeFilterDifference, settledDifference, peak: value.peak };
        }],
      ];
      for (const [name, check] of cases) {
        try { const metrics = await check(); result.passed++; result.tests.push({ name, sampleRate, status: 'passed', metrics }); }
        catch (error) { result.failed++; result.tests.push({ name, sampleRate, status: 'failed', error: error.stack || String(error) }); }
        if (log) console.log(result.tests.at(-1));
      }
    }
    return result;
  } finally { if (savedMute === null) localStorage.removeItem('raptor:mute'); else localStorage.setItem('raptor:mute', savedMute); }
}

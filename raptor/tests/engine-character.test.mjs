// Native regression for the authored turbine bank's gate and source ownership.
import { EngineVoice } from '../src/engine/audio.js';
import { measure } from './audio.test.mjs';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export async function runEngineCharacterTests({ sampleRates = [44100, 48000] } = {}) {
  const tests = [];
  for (const sampleRate of sampleRates) for (const action of ['fuel loss', 'dispose']) {
    const ctx = new OfflineAudioContext(2, Math.round(sampleRate * 3.2), sampleRate);
    let created = 0;
    const live = new Set();
    for (const kind of ['createBufferSource', 'createOscillator']) {
      const create = ctx[kind].bind(ctx);
      ctx[kind] = (...args) => {
        const source = create(...args); created++;
        const start = source.start.bind(source);
        source.start = (...values) => { start(...values); live.add(source); };
        source.addEventListener('ended', () => live.delete(source), { once: true });
        return source;
      };
    }
    const voice = new EngineVoice(ctx, ctx.destination);
    const initialSources = created;
    const base = { throttle: 1, ab: 0, powerInput: 'spool', ias: 0, g: 1, aoa: 0, view: 'external' };
    voice.setState(base);
    const events = Array.from({ length: 30 }, (_, i) => [0.3 + i / 40, () => voice.setState({ ...base, throttle: 0.55 + i / 70 })]);
    events.push([1.2, () => voice.setState(base)], [1.6, () => {
      if (action === 'dispose') voice.dispose();
      else voice.setState({ ...base, fuelStarved: true });
    }]);
    const scheduled = events.map(([at, apply]) => ctx.suspend(at).then(async () => { try { apply(); } finally { await ctx.resume(); } }));
    try {
      const [buffer] = await Promise.all([ctx.startRendering(), ...scheduled]);
      const active = measure(buffer, 1.25, 1.55), tail = measure(buffer, 2.5), full = measure(buffer);
      assert(active.rms > 0.005, 'the turbine gate must be tested under audible dry power');
      assert(tail.rms < 0.000001, `${action}: added turbine detail leaked after its gate, RMS ${tail.rms}`);
      assert(full.finite && full.peak < 1, 'the engine must render finite PCM below full scale');
      assert(created === initialSources, 'power changes must not allocate new looping sources');
      if (action === 'dispose') assert(live.size === 0, 'disposal must stop every owned source');
      tests.push({ sampleRate, action, status: 'passed', initialSources, created, liveSources: live.size, active, tail, full });
    } catch (error) {
      tests.push({ sampleRate, action, status: 'failed', error: error.stack || error.message });
    } finally { voice.dispose(); }
  }
  return { passed: tests.filter(test => test.status === 'passed').length, failed: tests.filter(test => test.status === 'failed').length, tests };
}

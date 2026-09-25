import { AudioBus } from '../src/engine/audio.js';
import { applySettings, DEFAULTS } from '../src/game/settings.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function render({ mode = 'off', ui = 0, radio = false, volume = 0.42, events = [], settings = false } = {}) {
  const ctx = new OfflineAudioContext(2, 48000 * 4, 48000);
  const bus = new AudioBus({ context: ctx });
  if (settings) applySettings({ ...DEFAULTS, uiVol: ui, engineVol: volume, weaponsVol: 0.55 }, { audio: bus });
  else { bus.setEngineVolume(volume); bus.setUiVolume(ui); }
  bus.engine.setState({ throttle: 0.7, ias: 300, view: 'external' });
  bus.locks.setMode(mode); bus.setRadioActive(radio);
  const observations = {};
  const pending = events.map(([time, action]) => ctx.suspend(time).then(async () => {
    try { action(bus, observations); } finally { await ctx.resume(); }
  }));
  try {
    const [pcm] = await Promise.all([ctx.startRendering(), ...pending]);
    let peak = 0;
    for (let c = 0; c < 2; c++) for (const v of pcm.getChannelData(c)) {
      assert(Number.isFinite(v), 'PCM must be finite'); peak = Math.max(peak, Math.abs(v));
    }
    assert(peak < 1, 'Output retains headroom');
    return { pcm, observations, peak, gain: bus.engineGroup.gain.value, weapons: bus.weapons.gain.value, ui: bus.uiVolume };
  } finally { bus.dispose(); }
}

export async function runMixPreferenceTests({ log = false } = {}) {
  const saved = localStorage.getItem('raptor:mute'); localStorage.setItem('raptor:mute', '0');
  const result = { passed: 0, failed: 0, tests: [] };
  const tests = [
    ['silent warnings leave the engine at the user-selected level', async () => {
      const reference = await render(), incoming = await render({ mode: 'launch' });
      let difference = 0;
      for (let c = 0; c < 2; c++) {
        const a = reference.pcm.getChannelData(c), b = incoming.pcm.getChannelData(c);
        for (let i = 48000 * 2; i < a.length; i++) difference = Math.max(difference, Math.abs(a[i] - b[i]));
      }
      assert(difference < 0.000001, `An inaudible cue must not change settled engine PCM: ${difference}`);
      assert(Math.abs(incoming.gain - 0.42) < 0.001, 'Silent warning preserves engine fader');
      return { difference, gain: incoming.gain, peak: incoming.peak };
    }],
    ['warning fader changes restore and reapply priority without changing cadence', async () => {
      let voice;
      const value = await render({ mode: 'launch', ui: 1, events: [
        [0.5, (bus, out) => { voice = [...bus.locks.active][0]; out.ducked = bus.engineGroup.gain.value; bus.setUiVolume(0); }],
        [1.5, (bus, out) => { out.restored = bus.engineGroup.gain.value; bus.setUiVolume(1); }],
        [2, (bus, out) => { out.duckedAgain = bus.engineGroup.gain.value; out.sameCue = bus.locks.active.has(voice); bus.locks.setMode('off'); }],
        [3.5, (bus, out) => { out.cleared = bus.engineGroup.gain.value; }],
      ] });
      const o = value.observations;
      assert(Math.abs(o.ducked - 0.42 * 0.65) < 0.002, 'Audible incoming cue ducks to the existing depth');
      assert(o.restored > 0.41 && o.restored <= 0.421, 'Muting the cue recovers the chosen engine level');
      assert(Math.abs(o.duckedAgain - 0.42 * 0.65) < 0.002, 'Re-enabling reapplies priority');
      assert(o.sameCue, 'Fader changes preserve the active warning cadence/source');
      assert(o.cleared > 0.415 && o.cleared <= 0.421, 'Threat clear preserves user gain');
      return o;
    }],
    ['radio priority respects the shared UI fader', async () => {
      const silent = await render({ mode: 'launch', ui: 0, radio: true, volume: 0.37 });
      const audible = await render({ mode: 'launch', ui: 1, radio: true, volume: 0.37 });
      assert(Math.abs(silent.gain - 0.37) < 0.001, 'Muted radio/warnings must not drive hidden ducking');
      assert(Math.abs(audible.gain - 0.37 * 0.48) < 0.001, 'Audible radio keeps its priority and depth');
      return { silent: silent.gain, audible: audible.gain };
    }],
    ['real game settings route UI volume through the priority mixer', async () => {
      const value = await render({ settings: true, mode: 'launch', ui: 0, volume: 0.37 });
      assert(value.ui === 0 && Math.abs(value.gain - 0.37) < 0.001, 'Game settings must suppress inaudible ducking');
      assert(Math.abs(value.weapons - 0.55) < 0.001, 'UI changes preserve the weapons fader');
      return { ui: value.ui, engine: value.gain, weapons: value.weapons };
    }],
  ];
  try {
    for (const [name, check] of tests) {
      try { const metrics = await check(); result.passed++; result.tests.push({ name, status: 'passed', metrics }); }
      catch (error) { result.failed++; result.tests.push({ name, status: 'failed', error: error.stack || String(error) }); }
      if (log) console.log(result.tests.at(-1));
    }
    return result;
  } finally { if (saved === null) localStorage.removeItem('raptor:mute'); else localStorage.setItem('raptor:mute', saved); }
}

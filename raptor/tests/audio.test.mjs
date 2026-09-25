// Real browser Web Audio regression tests. Serve raptor/ and run in DevTools:
//   await (await import('/tests/audio.test.mjs')).runAudioTests()
// The same expression works in a browser automation page.evaluate(). No audio
// device, autoplay permission, npm dependencies, or simulated AudioNodes needed.
import { AudioBus } from '../src/engine/audio.js';

const SAMPLE_RATE = 48000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function measure(buffer, start = 0, end = buffer.duration) {
  const lo = Math.max(0, Math.floor(start * buffer.sampleRate));
  const hi = Math.min(buffer.length, Math.floor(end * buffer.sampleRate));
  let peak = 0, energy = 0, sideEnergy = 0, finite = true;
  const channelRms = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let sum = 0;
    for (let i = lo; i < hi; i++) {
      const sample = samples[i];
      finite &&= Number.isFinite(sample);
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
    }
    energy += sum;
    channelRms.push(Math.sqrt(sum / Math.max(1, hi - lo)));
  }
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
  for (let i = lo; i < hi; i++) sideEnergy += ((left[i] - right[i]) * 0.5) ** 2;
  return {
    rms: Math.sqrt(energy / Math.max(1, (hi - lo) * buffer.numberOfChannels)),
    peak,
    sideRms: Math.sqrt(sideEnergy / Math.max(1, hi - lo)),
    channelRms,
    finite,
  };
}

function audible(buffer, label, start = 0, end = buffer.duration) {
  const metrics = measure(buffer, start, end);
  assert(metrics.finite, `${label}: all output samples must be finite`);
  assert(metrics.rms > 0.00005, `${label}: expected audible output, RMS ${metrics.rms}`);
  return metrics;
}

async function render({ duration = 3, setup = () => {}, events = [], sampleRate = SAMPLE_RATE, paused = false } = {}) {
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const bus = new AudioBus({ seed: 1337, context, paused });
  bus.setMute(false);
  setup(bus, context);
  let renderingFinished = false;
  const scheduled = events.map(([time, apply]) => context.suspend(time).then(async () => {
    try {
      await apply(bus, context);
    } finally {
      await context.resume();
    }
  }));
  try {
    const [buffer] = await Promise.all([context.startRendering(), ...scheduled]);
    renderingFinished = true;
    return buffer;
  } finally {
    // A failed scheduled assertion must not leave a suspended render hanging.
    if (!renderingFinished && context.state === 'suspended') await context.resume();
    bus.dispose();
  }
}

function silentEngine(bus) {
  bus.engine.setState({ active: false });
  bus.locks.setMode('off');
}

async function engine(state, duration = 3) {
  return render({ duration, setup: bus => bus.engine.setState({
    active: true, throttle: 0, ab: 0, ias: 0, mach: 0, g: 1, aoa: 0,
    view: 'external', ...state,
  }) });
}

const tests = [
  ['engine has distinct idle, military, and afterburner power', async () => {
    const idle = audible(await engine({ throttle: 0.05 }), 'idle', 1.2);
    const military = audible(await engine({ throttle: 1 }), 'military', 1.2);
    const afterburner = audible(await engine({ throttle: 1, ab: 1 }), 'afterburner', 1.2);
    assert(military.rms > idle.rms * 1.35, `military should grow from idle: ${military.rms} vs ${idle.rms}`);
    assert(afterburner.rms > military.rms * 1.08, `afterburner should add weight: ${afterburner.rms} vs ${military.rms}`);
    return { idle, military, afterburner };
  }],
  ['engine produces a stereo field and changes with cockpit perspective', async () => {
    const outside = await engine({ throttle: 0.85, ab: 0.2, ias: 320, mach: 0.8, view: 'external' });
    const inside = await engine({ throttle: 0.85, ab: 0.2, ias: 320, mach: 0.8, view: 'cockpit' });
    const exterior = audible(outside, 'exterior', 1.2);
    const cockpit = audible(inside, 'cockpit', 1.2);
    assert(exterior.sideRms > exterior.rms * 0.015, 'the exterior engine should have audible stereo width');
    const a = outside.getChannelData(0), b = inside.getChannelData(0);
    let difference = 0;
    for (let i = SAMPLE_RATE; i < a.length; i++) difference += (a[i] - b[i]) ** 2;
    const differenceRms = Math.sqrt(difference / (a.length - SAMPLE_RATE));
    assert(differenceRms > exterior.rms * 0.08, 'cockpit filtering must make an audible perspective change');
    return { exterior, cockpit, differenceRms };
  }],
  ['airspeed and aerodynamic load change the sound independently of throttle', async () => {
    const base = await engine({ throttle: 0.4, ias: 80, g: 1, aoa: 0, view: 'cockpit' });
    const fast = await engine({ throttle: 0.4, ias: 480, g: 1, aoa: 0, view: 'cockpit' });
    const loaded = await engine({ throttle: 0.4, ias: 480, g: 8, aoa: 22, view: 'cockpit' });
    const slowMetrics = audible(base, 'slow', 1.2);
    const fastMetrics = audible(fast, 'fast', 1.2);
    const loadMetrics = audible(loaded, 'loaded', 1.2);
    assert(fastMetrics.rms > slowMetrics.rms * 1.02, 'increasing airspeed must add audible airflow');
    let difference = 0;
    const a = fast.getChannelData(0), b = loaded.getChannelData(0);
    for (let i = SAMPLE_RATE; i < a.length; i++) difference += (a[i] - b[i]) ** 2;
    const loadDifferenceRms = Math.sqrt(difference / (a.length - SAMPLE_RATE));
    assert(loadDifferenceRms > fastMetrics.rms * 0.01, 'high G / angle of attack must add audible airframe load');
    return { slow: slowMetrics, fast: fastMetrics, loaded: loadMetrics, loadDifferenceRms };
  }],
  ['the same seed reproduces engine and cannon audio', async () => {
    const make = () => render({ duration: 1.8, setup: bus => {
      bus.engine.setState({ active: true, throttle: 0.8, ab: 0.5, ias: 260, view: 'external' });
      bus.gun.burst(0.6);
      bus.effects.play('missile', { distance: 30, pan: 0.4 });
    } });
    const first = await make(), second = await make();
    let maximumDifference = 0;
    for (let ch = 0; ch < 2; ch++) {
      const a = first.getChannelData(ch), b = second.getChannelData(ch);
      for (let i = 0; i < a.length; i++) maximumDifference = Math.max(maximumDifference, Math.abs(a[i] - b[i]));
    }
    assert(maximumDifference < 0.000001, `same seed should reproduce PCM, max difference ${maximumDifference}`);
    return { maximumDifference };
  }],
  ['every combat effect renders a finite audible transient', async () => {
    const results = {};
    for (const kind of ['missile', 'explosion', 'impact', 'flare', 'sonic', 'afterburner']) {
      const buffer = await render({ duration: 4, setup: silentEngine,
        events: [[0.4, bus => bus.effects.play(kind, { distance: 20, pan: 0, strength: 1 })]],
      });
      results[kind] = audible(buffer, kind, 0.4);
      assert(results[kind].peak < 1, `${kind}: output should retain headroom`);
      const tail = measure(buffer, 3.7).rms;
      assert(tail < 0.00001, `${kind}: transient must end, tail RMS ${tail}`);
    }
    return results;
  }],
  ['effects communicate left/right position and distance', async () => {
    const effect = options => render({ duration: 2, setup: silentEngine,
      events: [[0.4, bus => bus.effects.play('impact', { strength: 1, ...options })]],
    });
    const left = audible(await effect({ pan: -0.9, distance: 15 }), 'left impact', 0.4);
    const right = audible(await effect({ pan: 0.9, distance: 15 }), 'right impact', 0.4);
    const far = audible(await effect({ pan: 0, distance: 1500 }), 'distant impact', 0.4);
    assert(left.channelRms[0] > left.channelRms[1] * 1.8, 'a left impact should favor the left channel');
    assert(right.channelRms[1] > right.channelRms[0] * 1.8, 'a right impact should favor the right channel');
    assert(far.rms < left.rms * 0.65, 'distant impacts must sound quieter than nearby impacts');
    return { left, right, far };
  }],
  ['simultaneous explosions preserve both positions and audible voices', async () => {
    let allocatedVoices = 0;
    const make = both => render({ duration: 2, setup: silentEngine, events: [[0.4, bus => {
      const left = bus.effects.play('explosion', { distance: 15, pan: -1, strength: 1 });
      assert(left, 'the first explosion must allocate a voice');
      if (both) {
        const right = bus.effects.play('explosion', { distance: 15, pan: 1, strength: 1 });
        assert(right && right !== left, 'a distinct simultaneous explosion must allocate its own voice');
        allocatedVoices = bus.effects.active.size;
      }
    }]] });
    const leftOnly = audible(await make(false), 'left explosion', 0.4, 1.5);
    const both = audible(await make(true), 'simultaneous explosions', 0.4, 1.5);
    assert(allocatedVoices === 2, `both explosions should remain active, got ${allocatedVoices}`);
    assert(both.channelRms[1] > leftOnly.channelRms[1] * 3, 'the second explosion must be audible on the right');
    assert(both.channelRms[0] > leftOnly.channelRms[0] * 0.5, 'the original left explosion must remain audible');
    return { allocatedVoices, leftOnly, both };
  }],
  ['cannon burst release follows the audio clock without a wall-clock timer', async () => {
    let firingAfterRelease;
    const buffer = await render({ duration: 2, setup: silentEngine, events: [
      [0.4, bus => bus.gun.burst(0.3)],
      [1.1, bus => { firingAfterRelease = bus.gun.firing; }],
    ] });
    const attack = audible(buffer, 'cannon burst', 0.46, 0.65);
    const tail = measure(buffer, 1.3).rms;
    assert(tail < 0.00001, `cannon must finish during fast offline rendering, tail RMS ${tail}`);
    assert(firingAfterRelease === false, 'firing state must follow scheduled burst release');
    return { attack, tail, firingAfterRelease };
  }],
  ['held cannon fire remains continuous until released', async () => {
    const buffer = await render({ duration: 6.5, setup: silentEngine, events: [
      [0.4, bus => bus.gun.fire(true)],
      [5.3, bus => bus.gun.fire(false)],
    ] });
    const beginning = audible(buffer, 'initial sustained fire', 0.7, 1.3);
    const sustained = audible(buffer, 'late sustained fire', 4.5, 5.1);
    assert(sustained.rms > beginning.rms * 0.5, 'held fire must not decay or run out of scheduled rounds');
    const tail = measure(buffer, 6).rms;
    assert(tail < 0.00001, `released cannon should fall silent, RMS ${tail}`);
    return { beginning, sustained, tail };
  }],
  ['weapons volume controls the cannon and one-shot effects together', async () => {
    const buffer = await render({ duration: 2.5, setup: bus => {
      silentEngine(bus);
      bus.setWeaponsVolume(0);
    }, events: [[0.75, bus => {
      bus.gun.fire(true);
      bus.effects.play('explosion', { distance: 10, strength: 1 });
      bus.effects.play('missile', { distance: 10, strength: 1 });
    }]] });
    const metrics = measure(buffer, 1.1);
    assert(metrics.rms < 0.00001, `weapons fader at zero must silence every weapon, RMS ${metrics.rms}`);
    return metrics;
  }],
  ['pause and mute silence the complete combat mix', async () => {
    const results = {};
    for (const control of ['pause', 'mute']) {
      const buffer = await render({ duration: 2.3, setup: bus => {
        bus.engine.setState({ active: true, throttle: 1, ab: 1, ias: 400, view: 'external' });
        bus.gun.fire(true);
        bus.locks.setMode('launch');
        bus.effects.play('explosion', { distance: 10, strength: 1 });
      }, events: [[0.7, bus => control === 'pause' ? bus.setPaused(true) : bus.setMute(true)]] });
      const before = audible(buffer, `${control} before gate`, 0.2, 0.65);
      const after = measure(buffer, 1.5).rms;
      assert(after < 0.00001, `${control} must silence all channels, RMS ${after}`);
      results[control] = { before, after };
    }
    return results;
  }],
  ['a bus created paused stays silent while saved mixer levels are applied', async () => {
    let blockedEffect;
    const buffer = await render({ duration: 2.5, paused: true, setup: bus => {
      bus.engine.setState({ active: true, throttle: 1, ab: 1, ias: 400, view: 'external' });
      bus.gun.fire(true);
      bus.locks.setMode('launch');
      blockedEffect = bus.effects.play('explosion', { distance: 10 });
      // These represent restored settings applied before the first frame.
      bus.master.gain.setTargetAtTime(0.3, 0, 0.02);
      bus.engine.dry.gain.setTargetAtTime(0.5, 0, 0.02);
      bus.setWeaponsVolume(0.25);
    }, events: [[1.2, bus => bus.setPaused(false)]] });
    const startup = measure(buffer, 0, 1.18);
    const resumed = audible(buffer, 'unpaused configured mix', 1.7, 2.4);
    assert(startup.peak === 0, `initial pause must prevent even a startup transient, peak ${startup.peak}`);
    assert(blockedEffect === null, 'one-shot effects must not allocate while the bus starts paused');
    return { startup, resumed };
  }],
  ['44.1 kHz rendering keeps combat finite and releases a scheduled cannon burst', async () => {
    let firingAfterRelease;
    const buffer = await render({ duration: 2.5, sampleRate: 44100, setup: bus => {
      bus.engine.setState({ active: true, throttle: 0.8, ab: 0.5, ias: 300, view: 'external' });
    }, events: [
      [0.5, bus => {
        bus.engine.setState({ active: false });
        bus.gun.burst(0.3);
        bus.effects.play('flare', { pan: 0.4 });
      }],
      [1.5, bus => { firingAfterRelease = bus.gun.firing; }],
    ] });
    const engineMetrics = audible(buffer, '44.1 kHz engine', 0.2, 0.45);
    const cannon = audible(buffer, '44.1 kHz cannon', 0.55, 0.75);
    const all = measure(buffer);
    const tail = measure(buffer, 2).rms;
    assert(all.finite && all.peak < 1, 'the complete 44.1 kHz mix must be finite and retain headroom');
    assert(firingAfterRelease === false, 'the cannon burst state must release at 44.1 kHz');
    assert(tail < 0.00001, `44.1 kHz cannon release must become silent, RMS ${tail}`);
    return { sampleRate: buffer.sampleRate, engine: engineMetrics, cannon, peak: all.peak, tail, firingAfterRelease };
  }],
  ['radio ducking preserves the engine and restores its level afterward', async () => {
    const buffer = await render({ duration: 4.5, setup: bus => {
      bus.engine.setState({ active: true, throttle: 0.85, ab: 0, ias: 280, view: 'cockpit' });
    }, events: [
      [1.3, bus => bus.setRadioActive(true)],
      [2.8, bus => bus.setRadioActive(false)],
    ] });
    const normal = audible(buffer, 'normal engine', 0.7, 1.2);
    const ducked = audible(buffer, 'ducked engine', 2, 2.7);
    const restored = audible(buffer, 'restored engine', 3.7, 4.4);
    assert(ducked.rms < normal.rms * 0.85, 'radio callouts must make space in the engine mix');
    assert(restored.rms > ducked.rms * 1.2, 'the engine level must recover after a callout');
    return { normal, ducked, restored };
  }],
  ['dense combat retains headroom and enforces the one-shot voice cap', async () => {
    let peakVoices = 0, voiceLimit = 0, voicesAfterTails = -1;
    // A continuing salvo verifies the budget across frames as voices finish
    // and new impacts arrive, as well as during its first crowded instant.
    const salvo = Array.from({ length: 12 }, (_, step) => [0.6 + step * 0.06, bus => {
      voiceLimit = bus.effects.maxVoices;
      for (let i = 0; i < 16; i++) {
        bus.effects.play(['explosion', 'impact', 'missile', 'flare'][i % 4], {
          distance: 5, pan: (i % 9 - 4) / 4, strength: 1,
        });
        peakVoices = Math.max(peakVoices, bus.effects.active.size);
      }
      assert(Number.isInteger(voiceLimit) && voiceLimit > 0 && voiceLimit <= 32, 'a finite voice budget must be defined');
      assert(peakVoices <= voiceLimit, `one-shot voice cap exceeded: ${peakVoices} > ${voiceLimit}`);
    }]);
    const buffer = await render({ duration: 5.5, setup: bus => {
      bus.engine.setState({ active: true, throttle: 1, ab: 1, ias: 550, g: 9, aoa: 25, view: 'external' });
      bus.gun.fire(true);
      bus.locks.setMode('launch');
    }, events: [
      ...salvo,
      [4.8, bus => { voicesAfterTails = bus.effects.active.size; }],
    ] });
    const metrics = audible(buffer, 'dense combat', 0.6);
    assert(metrics.peak <= 0.98, `dense combat must retain final-output headroom, peak ${metrics.peak}`);
    assert(peakVoices === voiceLimit, `the salvo must actually exercise the voice cap: peak ${peakVoices}, cap ${voiceLimit}`);
    assert(voicesAfterTails === 0, `finished one-shots must release their nodes, active ${voicesAfterTails}`);
    return { ...metrics, peakVoices, voiceLimit, voicesAfterTails };
  }],
  ['disposing a bus silences active voices and releases one-shots', async () => {
    let remainingVoices = -1;
    const buffer = await render({ duration: 2.2, setup: bus => {
      bus.engine.setState({ active: true, throttle: 1, ab: 1, ias: 350, view: 'external' });
      bus.gun.fire(true);
      bus.locks.setMode('launch');
      bus.effects.play('explosion', { distance: 10 });
    }, events: [[0.7, bus => {
      bus.dispose();
      remainingVoices = bus.effects.active.size;
    }]] });
    const before = audible(buffer, 'before disposal', 0.2, 0.65);
    const after = measure(buffer, 1.1).rms;
    assert(after < 0.000001, `disposal must stop output, RMS ${after}`);
    assert(remainingVoices === 0, 'disposal must release active one-shot voices');
    return { before, after, remainingVoices };
  }],
];

export async function runAudioTests({ names, log = false } = {}) {
  assert(typeof OfflineAudioContext === 'function', 'Run audio.test.mjs in a browser with OfflineAudioContext');
  const started = performance.now();
  const originalMute = localStorage.getItem('raptor:mute');
  const results = [];
  try {
    for (const [name, run] of tests) {
      if (names && !names.some(fragment => name.includes(fragment))) continue;
      const testStarted = performance.now();
      try {
        const metrics = await run();
        results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - testStarted), metrics });
      } catch (error) {
        results.push({ name, status: 'failed', durationMs: Math.round(performance.now() - testStarted), error: error.stack || String(error) });
      }
      if (log) console.info(`[audio] ${results.at(-1).status}: ${name}`);
    }
  } finally {
    if (originalMute === null) localStorage.removeItem('raptor:mute');
    else localStorage.setItem('raptor:mute', originalMute);
  }
  return {
    passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status === 'failed').length,
    durationMs: Math.round(performance.now() - started),
    tests: results,
  };
}

export { measure };

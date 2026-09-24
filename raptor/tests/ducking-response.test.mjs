// Native mixer-envelope checks, independent of engine texture and compressor.
// Run in a browser: await (await import('/tests/ducking-response.test.mjs')).runDuckingResponseTests()
import { AudioBus } from '../src/engine/audio.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function trace(sampleRate, events, duration = 8) {
  const ctx = new OfflineAudioContext(1, duration * sampleRate, sampleRate);
  const bus = new AudioBus({ context: ctx });
  // Feed a native constant through the actual engine-group gain. Bypass only
  // the sound generators and mastering so PCM directly exposes its envelope.
  bus.engine.distGain.disconnect(); bus.airframe.dry.disconnect();
  bus.analyser.disconnect(); bus.engineGroup.disconnect();
  bus.engineGroup.connect(ctx.destination);
  const probe = ctx.createConstantSource(); probe.offset.value = 0.1;
  probe.connect(bus.engineGroup); probe.start();
  const times = {};
  const jobs = events.map(([time, id, apply]) => ctx.suspend(time).then(async () => {
    try { times[id] = ctx.currentTime; apply(bus); } finally { await ctx.resume(); }
  }));
  try {
    const [buffer] = await Promise.all([ctx.startRendering(), ...jobs]);
    const pcm = buffer.getChannelData(0);
    assert(pcm.every(Number.isFinite), 'gain envelope must contain finite PCM');
    const at = (id, offset) => pcm[Math.round((times[id] + offset) * sampleRate)] * 10;
    return { at, times };
  } finally { probe.stop(); probe.disconnect(); bus.dispose(); }
}

export async function runDuckingResponseTests({ sampleRates = [44100, 48000], log = false } = {}) {
  assert(typeof OfflineAudioContext === 'function', 'Run in a browser with OfflineAudioContext');
  const tests = [];
  const check = (name, sampleRate, run) => {
    try { const metrics = run(); tests.push({ name, sampleRate, status: 'passed', metrics }); }
    catch (error) { tests.push({ name, sampleRate, status: 'failed', error: error.stack || error.message }); }
    if (log) console.info(`[ducking] ${tests.at(-1).status}: ${name} (${sampleRate} Hz)`);
  };
  for (const sampleRate of sampleRates) {
    const launch = await trace(sampleRate, [
      [0, 'volume', bus => bus.setEngineVolume(0.6)],
      [2, 'launch', bus => bus.locks.setMode('launch')],
      [2.03, 'repeat', bus => { bus.locks.setMode('launch'); bus.setEngineVolume(0.6); }],
      [2.06, 'repeat-again', bus => bus.setEngineVolume(0.6)],
      [4, 'clear', bus => bus.locks.setMode('off')],
    ]);
    check('launch makes room within the first pulse without restarting on repeated updates', sampleRate, () => {
      const first45ms = launch.at('launch', 0.045) / 0.6;
      const first90ms = launch.at('launch', 0.09) / 0.6;
      assert(first45ms > 0.77 && first45ms < 0.79, `45 ms normalized gain ${first45ms}`);
      assert(first90ms > 0.69 && first90ms < 0.71, `90 ms normalized gain ${first90ms}`);
      return { first45ms, first90ms };
    });
    check('launch retains depth, user engine volume, and gradual recovery', sampleRate, () => {
      const settled = launch.at('launch', 1);
      const recovery100ms = launch.at('clear', 0.1) / 0.6;
      const recovery300ms = launch.at('clear', 0.3) / 0.6;
      const recovered = launch.at('clear', 2.5);
      assert(Math.abs(settled - 0.39) < 0.0001, `settled gain ${settled}`);
      assert(recovery100ms > 0.74 && recovery100ms < 0.76, `100 ms recovery ${recovery100ms}`);
      assert(recovery300ms > 0.86 && recovery300ms < 0.88, `300 ms recovery ${recovery300ms}`);
      assert(Math.abs(recovered / 0.6 - 1) < 0.001, `user gain after recovery ${recovered}`);
      return { settled, recovery100ms, recovery300ms, recovered };
    });
    const priority = await trace(sampleRate, [
      [0, 'volume', bus => bus.setEngineVolume(0.4)],
      [1.5, 'scan', bus => bus.locks.setMode('scan')],
      [2, 'launch', bus => bus.locks.setMode('launch')],
      [3, 'radio', bus => bus.setRadioActive(true)],
      [3.2, 'lock-during-radio', bus => bus.locks.setMode('lock')],
      [3.4, 'launch-during-radio', bus => bus.locks.setMode('launch')],
      [4, 'radio-clear', bus => bus.setRadioActive(false)],
      [6, 'lock', bus => bus.locks.setMode('lock')],
    ]);
    check('radio retains priority, depth, and its existing 80 ms response', sampleRate, () => {
      const radio80ms = priority.at('radio', 0.08) / 0.4;
      const radioSettled = priority.at('radio', 0.9) / 0.4;
      assert(radio80ms > 0.53 && radio80ms < 0.55, `radio 80 ms gain ${radio80ms}`);
      assert(Math.abs(radioSettled - 0.48) < 0.0001, `radio settled gain ${radioSettled}`);
      return { radio80ms, radioSettled };
    });
    check('radio-to-launch rises gradually and scan/lock restore the user gain', sampleRate, () => {
      const scan = priority.at('scan', 0.4);
      const fallback80ms = priority.at('radio-clear', 0.08) / 0.4;
      const fallbackSettled = priority.at('radio-clear', 1.8) / 0.4;
      const lock = priority.at('lock', 1.8);
      assert(Math.abs(scan - 0.4) < 0.0012, `scan changed the engine multiplier ${scan}`);
      assert(fallback80ms > 0.51 && fallback80ms < 0.53, `radio-to-launch recovery ${fallback80ms}`);
      assert(Math.abs(fallbackSettled - 0.65) < 0.001, `launch fallback depth ${fallbackSettled}`);
      assert(Math.abs(lock - 0.4) < 0.0005, `lock changed recovered user gain ${lock}`);
      return { scan, fallback80ms, fallbackSettled, lock };
    });
  }
  return { passed: tests.filter(test => test.status === 'passed').length,
    failed: tests.filter(test => test.status === 'failed').length, tests };
}

// Geometry runs in Node with no DOM. The same module adds real Web Audio
// scheduling/PCM checks in a browser with OfflineAudioContext:
//   await (await import('/tests/acoustic-scene.test.mjs')).runAcousticSceneTests()
import { AcousticScene, AirframeVoice, relativeAcoustics } from '../src/engine/acoustic-scene.js';
import { AudioBus, CombatEffects } from '../src/engine/audio.js';
import { prepareOfflineHrtf } from '../audio-tools/offline-hrtf.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const close = (actual, expected, epsilon = 1e-9) => assert(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, got ${actual}`);
const listener = { position: [0, 0, 0], velocity: [0, 0, 0], right: [1, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
const aircraft = (patch = {}) => ({ id: 'aircraft:1', kind: 'aircraft', aircraftClass: 'fighter', position: [80, 0, -20],
  velocity: [0, 0, 0], power: 0.8, motor: 'cruise', priority: 1, ...patch });
const missile = (patch = {}) => ({ id: 'missile:1', kind: 'missile', position: [70, 0, -20],
  velocity: [-400, 0, 0], power: 1, motor: 'boost', priority: 1, ...patch });

function effectsBus(ctx) {
  const bus = new AudioBus({ context: ctx, seed: 614, loadSamples: false });
  bus.muteGain.gain.value = 1;
  bus.engine.setState({ active: false });
  // Isolate the weapons route while retaining the actual bus listener hook
  // and limiter. Engine shutdown itself has a deliberate short fade.
  bus.engineGroup.gain.value = 0;
  bus.scene.update({ listener, sources: [] });
  return bus;
}

function measure(buffer, begin = 0, end = buffer.duration) {
  const lo = Math.floor(begin * buffer.sampleRate), hi = Math.min(buffer.length, Math.floor(end * buffer.sampleRate));
  const rms = [];
  let finite = true, peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const samples = buffer.getChannelData(c);
    let sum = 0;
    for (let i = lo; i < hi; i++) { finite &&= Number.isFinite(samples[i]); sum += samples[i] ** 2; peak = Math.max(peak, Math.abs(samples[i])); }
    rms.push(Math.sqrt(sum / Math.max(1, hi - lo)));
  }
  return { rms: Math.sqrt(rms.reduce((s, v) => s + v * v, 0) / rms.length), channels: rms, finite, peak };
}

async function render({ duration = 2, create, setup, events = [] }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * duration), 48000);
  const releaseHrtf = prepareOfflineHrtf(ctx);
  const instance = create(ctx);
  setup?.(instance, ctx);
  const scheduled = events.map(([when, apply]) => ctx.suspend(when).then(async () => {
    try { await apply(instance, ctx); } finally { await ctx.resume(); }
  }));
  try {
    const [buffer] = await Promise.all([ctx.startRendering(), ...scheduled]);
    return buffer;
  } finally {
    if (ctx.state === 'suspended') await ctx.resume();
    instance.dispose();
    releaseHrtf();
  }
}

const geometryTests = [
  ['stationary and co-moving sources have no Doppler shift', () => {
    close(relativeAcoustics(listener, aircraft()).doppler, 1);
    const velocity = [270, 20, -50];
    close(relativeAcoustics({ ...listener, velocity }, aircraft({ velocity })).doppler, 1);
  }],
  ['source approach raises pitch and recession lowers it', () => {
    const approach = relativeAcoustics(listener, aircraft({ position: [100, 0, 0], velocity: [-100, 0, 0] }));
    const recede = relativeAcoustics(listener, aircraft({ position: [100, 0, 0], velocity: [100, 0, 0] }));
    close(approach.doppler, 343 / 243);
    close(recede.doppler, 343 / 443);
  }],
  ['listener motion contributes the correct Doppler sign', () => {
    const toward = relativeAcoustics({ ...listener, velocity: [80, 0, 0] }, aircraft({ position: [100, 0, 0] }));
    const away = relativeAcoustics({ ...listener, velocity: [-80, 0, 0] }, aircraft({ position: [100, 0, 0] }));
    close(toward.doppler, 423 / 343);
    close(away.doppler, 263 / 343);
  }],
  ['distance attenuates and darkens both world-source classes', () => {
    for (const make of [aircraft, missile]) {
      const near = relativeAcoustics(listener, make({ position: [20, 0, 0] }));
      const far = relativeAcoustics(listener, make({ position: [2000, 0, 0] }));
      assert(near.attenuation > far.attenuation * 5, 'distance must substantially reduce the source');
      assert(near.cutoff > far.cutoff, 'distant sources must lose high-frequency energy');
      assert(near.attenuation <= 1 && far.attenuation > 0, 'attenuation is bounded');
    }
  }],
  ['stereo bearing follows camera right rather than a fixed world axis', () => {
    close(relativeAcoustics(listener, aircraft({ position: [100, 0, 0] })).pan, 1);
    close(relativeAcoustics(listener, aircraft({ position: [-100, 0, 0] })).pan, -1);
    close(relativeAcoustics({ ...listener, right: [0, 0, -1] }, aircraft({ position: [0, 0, 100] })).pan, -1);
  }],
  ['coincident and supersonic geometry remains finite and pitch-bounded', () => {
    for (const position of [[0, 0, 0], [1e-8, 0, 0], [500, 0, 0]]) {
      for (const speed of [-2000, 0, 2000]) {
        const a = relativeAcoustics(listener, missile({ position, velocity: [speed, 0, 0] }));
        assert([a.distance, a.pan, a.attenuation, a.cutoff, a.doppler, ...a.direction].every(Number.isFinite), 'geometry must be finite');
        assert(a.doppler >= 0.45 && a.doppler <= 2.4, 'supersonic motion cannot produce a pitch singularity');
      }
    }
  }],
];

const audioTests = [
  ['a moving aircraft crosses the HRTF stereo field', async () => {
    const events = Array.from({ length: 13 }, (_, i) => [0.1 + i * 0.06, scene => scene.update({ listener,
      sources: [aircraft({ position: [-150 + i * 25, 0, -60], velocity: [300, 0, 0] })] })]);
    const buffer = await render({ duration: 1.2, create: ctx => new AcousticScene(ctx, ctx.destination), events });
    const left = measure(buffer, 0.18, 0.3), right = measure(buffer, 0.9, 1.1);
    assert(left.finite && right.finite, 'moving source output must be finite');
    assert(left.channels[0] > left.channels[1] * 1.1, 'approaching left source must favor the left ear');
    assert(right.channels[1] > right.channels[0] * 1.1, 'departing right source must favor the right ear');
    return { left, right };
  }],
  ['retiring world emitters release their nodes and become silent', async () => {
    let voicesAfter;
    const buffer = await render({ duration: 1.5, create: ctx => new AcousticScene(ctx, ctx.destination), events: [
      [0.1, scene => scene.update({ listener, sources: [aircraft()] })],
      [0.65, scene => scene.update({ listener, sources: [] })],
      [1.1, scene => { scene.update({ listener, sources: [] }); voicesAfter = scene.voices.size; }],
    ] });
    assert(measure(buffer, 0.25, 0.6).rms > 0.00005, 'aircraft should be audible before retirement');
    const tail = measure(buffer, 1.1).rms;
    assert(tail < 0.000001, `retired source leaked output: ${tail}`);
    assert(voicesAfter === 0, 'retired sources must release their nodes');
    return { tail, voicesAfter };
  }],
  ['a source selected again during its release tail resumes immediately', async () => {
    let before, after, resumed;
    const buffer = await render({ duration: 1.2, create: ctx => new AcousticScene(ctx, ctx.destination), events: [
      [0.1, scene => { scene.update({ listener, sources: [aircraft()] }); before = scene.voices.get('aircraft:1'); }],
      [0.5, scene => scene.update({ listener, sources: [] })],
      [0.54, scene => { scene.update({ listener, sources: [aircraft()] }); after = scene.voices.get('aircraft:1'); resumed = after && !after.retiring; }],
    ] });
    assert(resumed, 'reselected voice must not wait for the original scheduled stop');
    assert(after !== before, 'a source with an irreversible scheduled stop must be safely replaced');
    const signal = measure(buffer, 0.75, 1.1);
    assert(signal.rms > 0.00005, 'the old stop must not silence the renewed source');
    return signal;
  }],
  ['silent distant coasting missiles cannot consume the world voice budget', async () => {
    let sources;
    const buffer = await render({ duration: 0.9, create: ctx => new AcousticScene(ctx, ctx.destination, { maxVoices: 2 }), events: [
      [0.1, scene => {
        scene.update({ listener, sources: [aircraft(), ...Array.from({ length: 12 }, (_, i) => missile({ id: `coast:${i}`, position: [300 + i, 0, 0], motor: 'coast', power: 0 }))] });
        sources = [...scene.voices.keys()];
      }],
    ] });
    assert(sources.length === 1 && sources[0] === 'aircraft:1', 'silent coast voices must not reserve slots');
    assert(measure(buffer, 0.3).rms > 0.00005, 'the remaining aircraft must stay audible');
    return { sources };
  }],
  ['world-source retirement and rank churn stay inside the voice cap', async () => {
    let peakVoices = 0;
    const events = Array.from({ length: 14 }, (_, step) => [0.05 + step * 0.055, scene => {
      scene.update({ listener, sources: Array.from({ length: 12 }, (_, i) => aircraft({
        id: `a:${(step + i) % 18}`, position: [40 + i * 50, 0, -30], priority: 2 - i * 0.1,
      })) });
      peakVoices = Math.max(peakVoices, scene.voices.size);
      assert(scene.voices.size <= 4, 'release tails and new sources must share the bounded voice budget');
    }]);
    const buffer = await render({ duration: 1.1, create: ctx => new AcousticScene(ctx, ctx.destination, { maxVoices: 4 }), events });
    assert(peakVoices === 4, 'the test must actually exercise the voice limit');
    assert(measure(buffer, 0.2).finite, 'rank churn cannot introduce nonfinite PCM');
    return { peakVoices };
  }],
  ['an imminent close missile replaces a quiet tail before the original release deadline', async () => {
    let immediate, voices, disposed;
    const old = [];
    const buffer = await render({ duration: 0.9, create: ctx => new AcousticScene(ctx, ctx.destination), events: [
      [0.1, scene => {
        scene.update({ listener, sources: Array.from({ length: 12 }, (_, i) => aircraft({ id: `distant:${i}`, position: [5000 + i * 100, 0, -100] })) });
        old.push(...scene.voices.values());
        assert(old.length === 12, 'the complete production voice budget must be occupied');
      }],
      [0.4, scene => {
        scene.update({ listener, sources: [missile({ id: 'imminent', position: [30, 0, -20], velocity: [-600, 0, 0] })] });
        immediate = !!scene.voices.get('imminent') && !scene.voices.get('imminent').retiring;
        voices = scene.voices.size;
        disposed = old.filter((voice) => voice.disposed).length;
        assert(scene.stats.dropped === 0, 'the admitted threat must not be reported dropped');
      }],
    ] });
    assert(immediate, 'the incoming source must be allocated in the same update, not after a 180ms tail');
    assert(voices <= 12 && disposed === 1, 'one old tail must be released before allocating the bounded replacement');
    const before = measure(buffer, 0.25, 0.35), early = measure(buffer, 0.44, 0.52);
    assert(early.rms > before.rms * 2, 'the close pass must actually sound before the old 0.58s release deadline');
    return { voices, disposed, before, early };
  }],
  ['similar replacement sources let the old tail fade before reclaiming its slot', async () => {
    let immediate, later, old, deferred;
    await render({ duration: 0.9, create: ctx => new AcousticScene(ctx, ctx.destination, { maxVoices: 1 }), events: [
      [0.1, scene => { scene.update({ listener, sources: [aircraft()] }); old = scene.voices.get('aircraft:1'); }],
      [0.4, scene => {
        scene.update({ listener, sources: [aircraft({ id: 'similar' })] });
        immediate = scene.voices.has('similar'); deferred = scene.stats.dropped;
        assert(!old.disposed, 'an equally salient candidate should not cut an unfaded tail');
      }],
      [0.46, scene => { scene.update({ listener, sources: [aircraft({ id: 'similar' })] }); later = scene.voices.has('similar'); }],
    ] });
    assert(!immediate && deferred === 1, 'deferred allocation must be accurately reported');
    assert(later && old.disposed, 'a quiet enough release tail should yield its slot promptly');
  }],
  ['pausing a scene clears sources and permits a clean restart', async () => {
    let afterPause;
    const buffer = await render({ duration: 1.3, create: ctx => new AcousticScene(ctx, ctx.destination), events: [
      [0.1, scene => scene.update({ listener, sources: [aircraft()] })],
      [0.45, scene => { scene.setPaused(true); scene.update({ listener, sources: [aircraft()] }); afterPause = scene.voices.size; }],
      [0.8, scene => { scene.setPaused(false); scene.update({ listener, sources: [aircraft()] }); }],
    ] });
    assert(afterPause === 0, 'pause must release all continuous sources');
    assert(measure(buffer, 0.58, 0.75).rms < 0.000001, 'paused sources must be silent');
    assert(measure(buffer, 1, 1.2).rms > 0.00005, 'resume must rebuild a live source');
    return { afterPause };
  }],
  ['airframe mechanisms, ground roll, and inactive state have distinct output', async () => {
    const buffer = await render({ duration: 2.2, create: ctx => new AirframeVoice(ctx, ctx.destination), events: [
      [0.1, voice => voice.setState({ active: true, gearMoving: true })],
      [0.65, voice => voice.setState({ active: true, weightOnWheels: true, wheelSpeed: 80, brake: 0.7 })],
      [1.2, voice => voice.setState({ active: false })],
    ] });
    const gear = measure(buffer, 0.3, 0.55), rolling = measure(buffer, 0.9, 1.15), tail = measure(buffer, 1.9).rms;
    assert(gear.rms > 0.00005, 'actual gear travel should produce hydraulic/mechanism sound');
    assert(rolling.rms > gear.rms * 1.5, 'ground roll should have more body than the actuator');
    assert(tail < 0.000001, 'inactive airframe must fade to silence');
    return { gear, rolling, tail };
  }],
  ['ground load preserves zero and increases rolling sound continuously', async () => {
    const measurements = [];
    for (const groundLoad of [0, 0.0001, 0.5, 1, 2, undefined, null]) {
      const buffer = await render({ duration: 1.1, create: ctx => new AirframeVoice(ctx, ctx.destination),
        setup: voice => voice.setState({ active: true, weightOnWheels: true, wheelSpeed: 90, brake: 0.5, groundLoad }),
      });
      measurements.push(measure(buffer, 0.65, 1.1));
    }
    assert(measurements[0].rms === 0, 'explicitly unloaded contact must not produce rolling or braking noise');
    assert(measurements[1].rms < measurements[3].rms * 0.001, 'near-zero load must approach zero continuously');
    close(measurements[2].rms / measurements[3].rms, 0.5, 1e-5);
    close(measurements[4].rms / measurements[3].rms, 2, 1e-5);
    close(measurements[5].rms, measurements[3].rms, 1e-8);
    close(measurements[6].rms, measurements[3].rms, 1e-8);
    assert(measurements.every(result => result.finite && result.peak < 1), 'bounded contact loading must remain finite with headroom');
    return { rms: measurements.map(result => result.rms), peak: Math.max(...measurements.map(result => result.peak)) };
  }],
  ['settled deployed gear airflow depends on exposure and indicated airspeed', async () => {
    const states = [{ gearPosition: 0, ias: 250 }, { gearPosition: 1, ias: 0 },
      { gearPosition: 0.5, ias: 250 }, { gearPosition: 1, ias: 125 }, { gearPosition: 1, ias: 250 }];
    const measurements = [];
    for (const state of states) {
      const buffer = await render({ duration: 1.2, create: ctx => new AirframeVoice(ctx, ctx.destination),
        setup: voice => voice.setState({ active: true, weightOnWheels: false, gearMoving: false, groundLoad: 0, ...state }),
      });
      measurements.push(measure(buffer, 0.8, 1.2));
    }
    assert(measurements[0].rms === 0 && measurements[1].rms === 0, 'retracted or motionless gear must not invent aerodynamic noise');
    assert(measurements[4].rms > 0.0005, 'deployed gear must remain audible after its actuator stops');
    close(measurements[2].rms / measurements[4].rms, 0.5, 1e-5);
    assert(measurements[3].rms < measurements[4].rms * 0.35, 'lower dynamic pressure must reduce settled gear airflow');
    assert(measurements.every(result => result.finite && result.peak < 0.2), 'gear airflow should remain a restrained finite layer');
    return { states, measurements };
  }],
  ['gear actuators stop independently of deployed airflow and inactive airframe fades both', async () => {
    let motor, hydraulics;
    const buffer = await render({ duration: 2.2, create: ctx => new AirframeVoice(ctx, ctx.destination), events: [
      [0.1, voice => voice.setState({ active: true, gearMoving: true, gearPosition: 0.5, ias: 200, groundLoad: 0 })],
      [0.6, voice => voice.setState({ active: true, gearMoving: false, gearPosition: 1, ias: 200, groundLoad: 0 })],
      [1.05, voice => { motor = voice.gear.gain.value; hydraulics = voice.hydraulicGain.gain.value; }],
      [1.2, voice => voice.setState({ active: false, gearPosition: 1, ias: 200, groundLoad: 0 })],
    ] });
    const settled = measure(buffer, 0.9, 1.1), inactive = measure(buffer, 1.9, 2.2);
    assert(motor < 1e-5 && hydraulics < 1e-5, 'locked gear must release both actuator components');
    assert(settled.rms > 0.0005, 'aerodynamic gear noise must continue after mechanical travel');
    assert(inactive.rms < 1e-6, 'inactive state must fade all airframe branches to silence');
    assert(settled.finite && inactive.finite, 'gear transitions must stay finite');
    return { motor, hydraulics, settled, inactive };
  }],
  ['propagation uses the audio clock and duplicate emission IDs play once', async () => {
    let voices, duplicate;
    const buffer = await render({ duration: 2, create: ctx => new CombatEffects(ctx, ctx.destination), events: [
      [0.1, effects => { effects.play('explosion', { delay: 0.8, sourceId: 'detonation:1' }); voices = effects.active.size; }],
      [0.2, effects => { duplicate = effects.play('explosion', { delay: 0.8, sourceId: 'detonation:1' }); voices = Math.max(voices, effects.active.size); }],
    ] });
    const before = measure(buffer, 0, 0.86).rms, after = measure(buffer, 0.93, 1.4).rms;
    assert(before < 0.0000001, 'distant detonation must not sound before its propagation delay');
    assert(after > 0.00005, 'the scheduled detonation must arrive without a wall-clock timer');
    assert(duplicate === null && voices === 1, 'the same emission ID must not layer twice');
    return { before, after, voices };
  }],
  ['clearing effects cancels sounds whose propagation has not arrived', async () => {
    let remaining;
    const buffer = await render({ duration: 2, create: ctx => new CombatEffects(ctx, ctx.destination), events: [
      [0.1, effects => effects.play('explosion', { delay: 1, sourceId: 'pending:1' })],
      [0.6, effects => { effects.stopAll(); remaining = effects.active.size; }],
    ] });
    const signal = measure(buffer);
    assert(signal.rms < 0.0000001, 'cancelled future sound must never arrive after pause/reset');
    assert(remaining === 0, 'clearing must also release future source nodes');
    return signal;
  }],
  ['nearby player impact and death preempt a full queue of distant pending effects', async () => {
    let impact, death, count, released = 0;
    const queued = [];
    const buffer = await render({ duration: 1.2, create: ctx => new CombatEffects(ctx, ctx.destination), events: [
      [0.1, effects => {
        for (let i = 0; i < effects.maxVoices; i++) queued.push(effects.play('explosion', {
          sourceId: `distant:${i}`, distance: 8000, delay: 5, strength: 0.5,
        }));
        assert(effects.active.size === effects.maxVoices, 'test must fill the real production voice budget');
      }],
      [0.2, effects => {
        impact = effects.play('impact', { sourceId: 'player:hit', distance: 0, priority: 3 });
        death = effects.play('explosion', { sourceId: 'player:death', distance: 0, priority: 4, strength: 1.3 });
        count = effects.active.size;
        released = queued.filter((v) => v.released).length;
        assert(count <= effects.maxVoices, 'preemption must never exceed the voice cap');
      }],
    ] });
    assert(impact && death, 'immediate personal combat feedback must survive a distant propagation queue');
    assert(released === 2, 'preempted pending sources must be explicitly released');
    const signal = measure(buffer, 0.21, 0.8);
    assert(signal.finite && signal.rms > 0.0001, 'salient replacement events must actually be audible');
    return { count, released, signal };
  }],
  ['a preempted future source never starts after its replacement ends', async () => {
    let pending, replacement;
    const buffer = await render({ duration: 2, create: ctx => new CombatEffects(ctx, ctx.destination),
      setup: effects => { effects.maxVoices = 1; }, events: [
        [0.1, effects => { pending = effects.play('explosion', { sourceId: 'far:1', distance: 6000, delay: 0.7 }); }],
        [0.2, effects => { replacement = effects.play('impact', { sourceId: 'near:1', priority: 3 }); }],
      ],
    });
    assert(pending.released && replacement, 'replacement must stop and dispose the scheduled victim');
    assert(measure(buffer, 0.21, 0.45).rms > 0.00005, 'replacement should be heard');
    const late = measure(buffer, 1.5).rms;
    assert(late < 0.0000001, `preempted future explosion leaked after its original start time: ${late}`);
    return { late };
  }],
  ['lower-importance sounds cannot evict a higher-priority audible cue', async () => {
    let protectedVoice, rejected;
    const buffer = await render({ duration: 1.7, create: ctx => new CombatEffects(ctx, ctx.destination),
      setup: effects => { effects.maxVoices = 1; }, events: [
        [0.1, effects => { protectedVoice = effects.play('impact', { sourceId: 'critical:1', priority: 4, strength: 0.15 }); }],
        [0.12, effects => {
          rejected = effects.play('explosion', { sourceId: 'minor:1', priority: 1, strength: 2 });
          assert(!protectedVoice.released, 'the higher-priority audible cue must retain its source');
        }],
      ],
    });
    assert(rejected === null, 'volume alone must not let a minor effect steal a critical audible cue');
    assert(measure(buffer, 0.11, 0.25).rms > 0.00001, 'protected cue must actually render');
    assert(measure(buffer, 1.5).rms < 0.0000001, 'the rejected long explosion must never play');
  }],
  ['delayed world effects use the listener position at reception', async () => {
    const capture = async move => render({ duration: 1.5, create: ctx => {
      const effects = new CombatEffects(ctx, ctx.destination), scene = new AcousticScene(ctx, ctx.destination);
      scene.update({ listener, sources: [] });
      return { effects, scene, dispose() { effects.dispose(); scene.dispose(); } };
    }, events: [
      [0.1, ({ effects }) => effects.play('explosion', { delay: 0.8, sourceId: 'moving-listener:1', position: [100, 0, -10], distance: 100, pan: 1 })],
      // Use the real renderer's smoothed listener update. A raw .value write
      // inside native Chrome OfflineAudioContext leaves an inactive HRTF
      // panner's geometry cached; the production setTargetAtTime path updates it.
      [0.5, ({ scene }) => scene.update({ listener: { ...listener, position: move ? [200, 0, 0] : [0, 0, 0] }, sources: [] })],
    ] });
    const stationary = measure(await capture(false), 0.905, 1.1);
    const arrival = measure(await capture(true), 0.905, 1.1);
    assert(stationary.channels[1] > stationary.channels[0] * 1.05, 'the unmoved listener must first hear the source on its original side');
    assert(arrival.channels[0] > arrival.channels[1] * 1.05, 'a listener crossing the source before arrival must hear it on the new side');
    return { stationary, arrival };
  }],
  ['world effect filtering follows approach and recession without rescheduling propagation', async () => {
    let voice, initial, arrival, departing;
    const position = [2000, 0, -20];
    const buffer = await render({ duration: 2, create: effectsBus, events: [
      [0.1, bus => {
        voice = bus.effects.play('explosion', { position, distance: 2000, delay: 0.8, sourceId: 'filter-motion' });
        initial = { cutoff: voice.lowpass.frequency.value, start: voice.start, end: voice.end };
        position[0] = 50000; // Callers may recycle their event storage after emission.
      }],
      [0.4, bus => bus.scene.update({ listener: { ...listener, position: [1900, 0, 0] }, sources: [] })],
      [0.85, () => { arrival = voice.lowpass.frequency.value; }],
      [1, bus => bus.scene.update({ listener: { ...listener, position: [-2000, 0, 0] }, sources: [] })],
      [1.4, () => { departing = voice.lowpass.frequency.value; }],
    ] });
    assert(arrival > initial.cutoff * 2.4, 'approach before arrival must restore the nearby blast high frequencies');
    assert(departing < arrival * 0.3, 'recession during the audible tail must darken the blast again');
    close(voice.start, initial.start); close(voice.end, initial.end); close(voice.distance, 2000);
    assert(voice.position[0] === 2000, 'the effect must retain its emission position independently of caller mutation');
    assert(measure(buffer, 0, 0.87).rms < 0.0000001, 'listener updates must not bypass the original propagation delay');
    const signal = measure(buffer, 0.91, 1.8);
    assert(signal.finite && signal.rms > 0.00005 && signal.peak < 1, 'the changed spectrum must render finite audible PCM within the bus headroom');
    return { initialCutoff: initial.cutoff, arrivalCutoff: arrival, departingCutoff: departing, signal };
  }],
  ['listener motion leaves nonspatial effect auditions unchanged', async () => {
    const capture = move => render({ duration: 1.4, create: effectsBus, events: [
      [0.1, bus => bus.effects.play('explosion', { distance: 1500, pan: 0.4, delay: 0.3 })],
      [0.2, bus => { if (move) bus.scene.update({ listener: { ...listener, position: [9000, 1000, -3000] }, sources: [] }); }],
      [0.6, bus => { if (move) bus.scene.update({ listener: { ...listener, position: [-5000, 0, 6000] }, sources: [] }); }],
    ] });
    const still = await capture(false), moved = await capture(true);
    let maximumDifference = 0;
    for (let c = 0; c < still.numberOfChannels; c++) {
      const a = still.getChannelData(c), b = moved.getChannelData(c);
      for (let i = 0; i < a.length; i++) maximumDifference = Math.max(maximumDifference, Math.abs(a[i] - b[i]));
    }
    assert(maximumDifference < 1e-8, 'stereo mechanical cues and lab auditions must retain their original distance/pan behavior');
    return { maximumDifference };
  }],
  ['listener updates preserve world effect limits and pause cancellation', async () => {
    const voices = []; let allocated, afterPause;
    const buffer = await render({ duration: 2, create: effectsBus, events: [
      [0.1, bus => {
        for (let i = 0; i < bus.effects.maxVoices; i++) voices.push(bus.effects.play('explosion', {
          position: [1500 + i, 0, -20], distance: 1500 + i, delay: 1.2, sourceId: `world-limit:${i}`,
        }));
        allocated = bus.effects.active.size;
        bus.scene.update({ listener: { ...listener, position: [1400, 0, 0] }, sources: [] });
      }],
      [0.4, bus => {
        bus.setPaused(true); afterPause = bus.effects.active.size;
        bus.scene.update({ listener: { ...listener, position: [NaN, 0, 0] }, sources: [] });
      }],
      [0.8, bus => { bus.setPaused(false); bus.scene.update({ listener, sources: [] }); }],
    ] });
    assert(allocated === 20 && afterPause === 0, 'spatial filtering must not change the bounded effect allocation or cancellation');
    assert(voices.every(voice => voice.released), 'every cancelled world emitter must release its nodes');
    const signal = measure(buffer);
    assert(signal.finite && signal.peak < 1e-7, 'cancelled propagation cannot return when the listener resumes');
    return { allocated, afterPause, signal };
  }],
];

export async function runAcousticSceneTests({ geometryOnly = typeof OfflineAudioContext !== 'function', names, log = false } = {}) {
  const results = [];
  const selected = [...geometryTests, ...(geometryOnly ? [] : audioTests)];
  for (const [name, run] of selected) {
    if (names && !names.some((part) => name.includes(part))) continue;
    const begin = performance.now();
    try { results.push({ name, status: 'passed', metrics: await run(), durationMs: Math.round(performance.now() - begin) }); }
    catch (error) { results.push({ name, status: 'failed', error: error.stack || String(error), durationMs: Math.round(performance.now() - begin) }); }
    if (log) console.info(`[acoustic-scene] ${results.at(-1).status}: ${name}`);
  }
  return { passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length,
    skippedAudio: geometryOnly ? audioTests.length : 0, tests: results };
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { test } = await import('node:test');
  for (const [name, run] of geometryTests) test(name, run);
}

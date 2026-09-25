// Native material checks. Scheduling mechanics remain in cannon-response.test.
import { CombatEffects, GunVoice } from '../src/engine/audio.js';
import { measure } from './audio.test.mjs';
import { prepareOfflineHrtf } from '../audio-tools/offline-hrtf.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const cases = [
  ['dispersion stages preserve the first pressure front within a fixed memory budget', async sampleRate => {
    const ctx = new OfflineAudioContext(2, 1, sampleRate);
    const effects = new CombatEffects(ctx, ctx.destination);
    try {
      const original = effects.buffers.explosion, stages = effects.explosionStages;
      assert(stages.length === 9 && stages[0] === original, 'the close stage must reuse original material');
      let additionalBytes = 0, maximumAdjacentDb = 0;
      for (let stage = 0; stage < stages.length; stage++) for (let variant = 0; variant < 3; variant++) {
        const buffer = stages[stage][variant], data = buffer.getChannelData(0), near = original[variant].getChannelData(0);
        assert(buffer.length === near.length && buffer.numberOfChannels === 1, 'material shape/duration changed');
        let energy = 0, previousEnergy = 0;
        const previous = stages[Math.max(0, stage - 1)][variant].getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          assert(Number.isFinite(data[i]) && Math.abs(data[i]) <= 1, 'nonfinite or clipped material');
          if (i < Math.floor(sampleRate * .012)) assert(data[i] === near[i], 'first pressure front changed');
          energy += data[i] * data[i]; previousEnergy += previous[i] * previous[i];
        }
        maximumAdjacentDb = Math.max(maximumAdjacentDb, Math.abs(10 * Math.log10(energy / previousEnergy)));
        if (stage) additionalBytes += data.byteLength;
      }
      assert(new Set(stages.flat()).size === 27, 'stages must be shared immutable buffers, not per-event material');
      assert(additionalBytes <= Math.round(sampleRate * 2.8) * 4 * 3 * 8, 'distance material exceeded its fixed byte budget');
      assert(maximumAdjacentDb < .8, `adjacent material level changed abruptly: ${maximumAdjacentDb}dB`);
      return { stages: stages.length, additionalBytes, maximumAdjacentDb };
    } finally { effects.dispose(); }
  }],
  ['world material uses current listener distance and retains scheduled arrival', async sampleRate => {
    const ctx = new OfflineAudioContext(2, 1, sampleRate), release = prepareOfflineHrtf(ctx);
    const effects = new CombatEffects(ctx, ctx.destination);
    try {
      effects.updateListener([1700, 0, 0]);
      const close = effects.play('explosion', { distance: 1800, position: [1800, 0, 0], delay: .75 });
      assert(close.currentDistance === 100 && effects.buffers.explosion.includes(close.src.buffer), 'stale emission distance chose distant material');
      effects.stopAll(); effects.updateListener([-1800, 0, 0]);
      const distant = effects.play('explosion', { distance: 20, position: [0, 0, 0], delay: .75 });
      const expectedStage = Math.round((1800 - 180) / (2400 - 180) * 8);
      assert(distant.currentDistance === 1800 && effects.explosionStages[expectedStage].includes(distant.src.buffer), 'current distant listener did not choose dispersed material');
      assert(close.start === .75 && distant.start === .75, 'material choice changed propagation timing');
      return { closeDistance: close.currentDistance, distantDistance: distant.currentDistance, arrival: distant.start, expectedStage };
    } finally { effects.dispose(); release(); }
  }],
  ['dense dispersed blasts retain one source per voice, arrival silence and disposal', async sampleRate => {
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * .9), sampleRate);
    const effects = new CombatEffects(ctx, ctx.destination);
    const created = new Set(), stopped = new Set(), makeSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = makeSource(), stop = source.stop.bind(source);
      created.add(source);
      source.stop = (...args) => { stopped.add(source); return stop(...args); };
      return source;
    };
    let maximumVoices = 0;
    for (let i = 0; i < 28; i++) {
      const voice = effects.play('explosion', { distance: 200 + i * 75, delay: .2, strength: .05, sourceId: `blast-${i}` });
      if (voice) assert(voice.start === .2, 'a material bank delayed the scheduled attack');
      maximumVoices = Math.max(maximumVoices, effects.active.size);
      assert(effects.active.size <= 20 && created.size - stopped.size <= 20, 'distance material exceeded the effect voice/source budget');
      assert(new Set([...effects.active].map(v => v.src)).size === effects.active.size, 'a voice acquired extra scheduled sources');
    }
    const ended = ctx.suspend(.6).then(async () => { effects.dispose(); await ctx.resume(); });
    try {
      const [buffer] = await Promise.all([ctx.startRendering(), ended]);
      const before = measure(buffer, 0, .2), body = measure(buffer, .22, .55), after = measure(buffer, .7);
      assert(before.peak === 0, 'a propagated blast sounded before arrival');
      assert(body.finite && body.peak < 1 && body.rms > .0001, 'the dispersed-blast control must produce finite audible PCM');
      assert(after.peak === 0 && effects.active.size === 0 && created.size === stopped.size, 'disposal retained blast playback');
      return { maximumVoices, before: before.peak, body, after: after.peak, remaining: effects.active.size };
    } finally { effects.dispose(); }
  }],
  ['cannon body release is finite and decays to silence after the final round', async sampleRate => {
    const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * .85), sampleRate);
    const gun = new GunVoice(ctx, ctx.destination);
    const jobs = [[.1, true], [.4, false]].map(([at, on]) => ctx.suspend(at).then(async () => { gun.fire(on); await ctx.resume(); }));
    try {
      const [buffer] = await Promise.all([ctx.startRendering(), ...jobs]);
      const full = measure(buffer), body = measure(buffer, .2, .38), release = measure(buffer, .43, .49), late = measure(buffer, .68);
      assert(full.finite && full.peak < 1 && body.rms > .01, 'cannon material must be finite, unclipped and present');
      assert(release.rms > .0001 && release.rms < body.rms * .2, 'release must be a quiet retained body, not continued firing');
      assert(late.peak < .00001 && gun.voices.size === 0, 'passive cannon release did not die away');
      return { full, body, release, late, remaining: gun.voices.size };
    } finally { gun.dispose(); }
  }],
];

export async function runWeaponMaterialTests({ sampleRates = [44100, 48000], names = [], log = false } = {}) {
  const tests = [];
  for (const sampleRate of sampleRates) for (const [name, run] of cases) {
    if (names.length && !names.some(part => name.includes(part))) continue;
    try { tests.push({ name, sampleRate, status: 'passed', metrics: await run(sampleRate) }); }
    catch (error) { tests.push({ name, sampleRate, status: 'failed', error: error.stack || String(error) }); }
    if (log) console.info(`[weapon-material] ${tests.at(-1).status}: ${sampleRate}Hz ${name}`);
  }
  return { passed: tests.filter(t => t.status === 'passed').length, failed: tests.filter(t => t.status === 'failed').length, tests };
}

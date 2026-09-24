// Reproducible, uncompressed stimuli from the delivered browser audio graph.
// All timing runs on OfflineAudioContext's clock, including the legacy gun.
import { prepareOfflineHrtf } from './offline-hrtf.mjs';
const WARMUP = 3;
const baseState = { throttle: 0.65, ab: 0, ias: 340, mach: 0.8, g: 1, aoa: 3, view: 'external', active: true };
const state = changes => bus => bus.engine.setState({ ...baseState, ...changes });
const fire = on => bus => bus.gun.fire(on);
const effect = (kind, options) => bus => bus.effects?.play(kind, options);
const mode = value => bus => bus.locks.setMode(value);
const listener = { position: [0, 0, 0], velocity: [0, 0, 0], right: [1, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
const motion = (duration, sources) => Array.from({ length: Math.ceil(duration * 20) + 1 }, (_, i) => {
  const time = i / 20;
  return [time, bus => bus.scene?.update({ listener, sources: sources(time) })];
});

export const SCENES = [
  { id: 'power-sweep', title: 'Idle to military to afterburner', duration: 20,
    purpose: 'Spool response, power contrast, ignition, release, and tonal identity.',
    initial: { throttle: 0.08, ias: 0, mach: 0 },
    events: [[4, state({ throttle: 0.55, ias: 220 })], [8, state({ throttle: 1, ias: 420, mach: 0.95 })],
      [12, state({ throttle: 1, ab: 1, ias: 600, mach: 1.3 })], [16, state({ throttle: 0.2, ab: 0, ias: 260 })]],
    markers: [[0, 'Idle'], [4, 'Cruise'], [8, 'Military'], [12, 'Afterburner'], [16, 'Throttle back']] },
  { id: 'idle', title: 'Steady idle', duration: 12, initial: { throttle: 0.08, ias: 0, mach: 0 },
    purpose: 'Low-power texture, isolated tonal components, steady-state loop behavior.' },
  { id: 'military', title: 'Steady military power', duration: 12, initial: { throttle: 1, ias: 420, mach: 0.95 },
    purpose: 'Full dry-power body, treble balance, bass translation, stereo.' },
  { id: 'afterburner', title: 'Steady afterburner', duration: 12, initial: { throttle: 1, ab: 1, ias: 600, mach: 1.3 },
    purpose: 'Burner texture, weight, harshness, headroom under sustained power.' },
  { id: 'cockpit-cruise', title: 'Cockpit cruise', duration: 12, initial: { view: 'cockpit' },
    purpose: 'Interior filtering, sustained-listening comfort, airflow balance.' },
  { id: 'exterior-cruise', title: 'Exterior cruise', duration: 12, initial: {},
    purpose: 'Exterior engine body, stereo image, audible repetition.' },
  { id: 'cannon', title: 'Cannon hold and burst', duration: 12, engineSilent: true,
    purpose: 'Mechanical attack, sustained texture, release, and short bursts.',
    events: [[0.4, fire(true)], [6.4, fire(false)], [8, fire(true)], [8.25, fire(false)], [9.3, fire(true)], [9.8, fire(false)]],
    markers: [[0.4, 'Hold trigger'], [6.4, 'Release'], [8, 'Short burst'], [9.3, 'Half-second burst']] },
  { id: 'alerts', title: 'Seeker and incoming warning in flight', duration: 12, initial: { throttle: 0.75 },
    purpose: 'Alert urgency, loudness balance, fatigue, and engine masking.',
    events: [[0.5, mode('scan')], [3.5, mode('lock')], [6.5, mode('launch')], [10, mode('off')]],
    markers: [[0.5, 'Search'], [3.5, 'Lock'], [6.5, 'Incoming'], [10, 'Clear']] },
  { id: 'combat', title: 'Crowded combat pass', duration: 16, initial: { throttle: 0.95, ab: 0.65, ias: 460 },
    purpose: 'Weapon separation, alert intelligibility, spatial events, full-mix dynamics.',
    events: [[1, mode('launch')], [1.6, effect('missile', { pan: -0.7, distance: 30 })],
      [2, fire(true)], [2.5, effect('explosion', { pan: 0.8, distance: 180 })],
      [3.4, effect('impact', { pan: 0, strength: 0.8 })], [4.4, fire(false)], [5, mode('off')],
      [6, effect('flare', { pan: -0.4 })], [6.3, effect('flare', { pan: 0.4 })],
      [7, effect('missile', { pan: 0.75, distance: 50 })], [8, effect('explosion', { pan: -0.8, distance: 450 })],
      [8.4, effect('explosion', { pan: 0.6, distance: 900 })], [9, fire(true)], [10, fire(false)],
      [11, state({ throttle: 1, ab: 1, ias: 600, mach: 1.3 })], [11, effect('afterburner', {})]],
    markers: [[1, 'Incoming'], [1.6, 'Launch left'], [2, 'Cannon'], [2.5, 'Explosion right'], [6, 'Flares'], [8, 'Distant explosions'], [11, 'Afterburner']] },
  { id: 'long-cruise', title: 'Forty-second sustained cruise', duration: 40, initial: {},
    purpose: 'Fatigue audition and diagnostics for periodic texture and loop recurrence.' },
  { id: 'moving-aircraft', title: 'Fighter approach and departure', duration: 12, engineSilent: true, candidateOnly: true,
    purpose: 'One continuous fighter pass: motion, pitch shift, exhaust directionality, and stereo position.',
    events: motion(11.5, t => [{ id: 'fighter-pass', kind: 'aircraft', aircraftClass: 'fighter',
      position: [-1500 + 280 * t, 120, -70], velocity: [280, 0, 0], power: 0.95, priority: 1 }]),
    markers: [[0, 'Approach from left'], [5.36, 'Closest pass'], [8, 'Departure right']] },
  { id: 'missile-passes', title: 'Missile boost, sustain, and coast passes', duration: 12, engineSilent: true, candidateOnly: true,
    purpose: 'Three identical close-pass trajectories with different motor phases; compare propulsion with aerodynamic hiss.',
    events: motion(11.5, t => {
      const pass = Math.min(2, Math.floor(t / 4)), phase = t - pass * 4;
      return phase > 3.5 ? [] : [{ id: 'missile-pass:' + pass, kind: 'missile',
        position: [-640 + 400 * phase, 25, -55], velocity: [400, 0, 0], power: 1,
        motor: ['boost', 'sustain', 'coast'][pass], priority: 2 }];
    }), markers: [[0, 'Boost'], [1.6, 'Close pass'], [4, 'Sustain'], [5.6, 'Close pass'], [8, 'Coast'], [9.6, 'Close pass']] },
  { id: 'airframe-ground', title: 'Gear, touchdown, rollout, and braking', duration: 12, engineSilent: true, candidateOnly: true,
    purpose: 'Gear airflow and mechanical events followed by a decelerating runway bed; no engine masks the airframe details.',
    events: [[0.5, bus => { bus.airframe?.setState({ active: true, gearMoving: true }); bus.effects?.play('gear_start'); }],
      ...Array.from({ length: 34 }, (_, i) => [0.5 + i * 0.05, bus => bus.airframe?.setState({ active: true,
        gearMoving: true, gearPosition: i / 34, ias: 180, groundLoad: 0 })]),
      [2.2, bus => { bus.airframe?.setState({ active: true, gearMoving: false, gearPosition: 1, ias: 180, groundLoad: 0 }); bus.effects?.play('gear_lock'); }],
      [3, effect('touchdown', { strength: 0.9 })],
      ...Array.from({ length: 171 }, (_, i) => [3 + i * 0.05, bus => bus.airframe?.setState({ active: true,
        gearPosition: 1, ias: Math.max(0, 90 - i * 0.54) * 1.94384,
        weightOnWheels: true, wheelSpeed: Math.max(0, 90 - i * 0.54), groundLoad: 1, brake: i > 50 ? 0.85 : 0 })])],
    markers: [[0.5, 'Gear moving'], [2.2, 'Gear locks'], [3, 'Touchdown'], [5.5, 'Brake and decelerate'], [11.4, 'Stop']] },
  { id: 'dense-world', title: 'Dense aircraft, missiles, gun, and warning mix', duration: 16, candidateOnly: true,
    initial: { throttle: 1, ab: 0.8, ias: 500, mach: 1.15, g: 4, aoa: 12 },
    purpose: 'Busy production mix: eight aircraft, four missile slots, gun bursts, incoming warning, and delayed detonations.',
    events: [...motion(15.5, t => {
      const aircraft = Array.from({ length: 8 }, (_, i) => {
        const angle = t * 0.26 + i * Math.PI / 4;
        return { id: 'combat-aircraft:' + i, kind: 'aircraft', aircraftClass: i === 7 ? 'transport' : 'fighter',
          position: [360 * Math.sin(angle), 80 + i * 20, -450 + 240 * Math.cos(angle)],
          velocity: [93.6 * Math.cos(angle), 0, -62.4 * Math.sin(angle)], power: 0.7 + i * 0.04, priority: 1 };
      });
      const missiles = Array.from({ length: 4 }, (_, i) => {
        const age = (t + i * 0.7) % 5;
        return { id: 'combat-missile:' + i + ':' + Math.floor((t + i * 0.7) / 5), kind: 'missile',
          position: [-1000 + 430 * age, 25 + i * 25, -50 - i * 35], velocity: [430, 0, 0],
          motor: age < 1.2 ? 'boost' : age < 3.2 ? 'sustain' : 'coast', power: 1, priority: 2 };
      });
      return [...aircraft, ...missiles];
    }), [0.5, mode('launch')], [2, fire(true)], [4, fire(false)], [6, fire(true)], [7.2, fire(false)],
      [4.5, effect('explosion', { position: [400, 80, -600], distance: 725, pan: 0.55, delay: 725 / 343, sourceId: 'study-explosion:1' })],
      [8.5, effect('explosion', { position: [-550, 60, -300], distance: 630, pan: -0.87, delay: 630 / 343, sourceId: 'study-explosion:2' })],
      [10, mode('off')], [12, state({ throttle: 0.65, ab: 0, ias: 420, view: 'cockpit' })]],
    markers: [[0.5, 'Incoming warning'], [2, 'Cannon'], [6.61, 'First delayed blast'], [10, 'Threat clears'], [10.34, 'Second delayed blast'], [12, 'Cockpit / lower power']] },
];

export function encodeFloatWav(buffer, startSeconds = 0) {
  const start = Math.round(startSeconds * buffer.sampleRate);
  const frames = buffer.length - start, channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + frames * channels * 4), view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); text(36, 'data');
  view.setUint32(40, frames * channels * 4, true);
  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) view.setFloat32(44 + (i * channels + ch) * 4, data[ch][start + i], true);
  return bytes;
}

async function renderScene(AudioBus, scene, sampleRate, loadSamples) {
  const ctx = new OfflineAudioContext(2, Math.ceil((WARMUP + scene.duration) * sampleRate), sampleRate);
  const releaseHrtf = scene.candidateOnly ? prepareOfflineHrtf(ctx) : () => {};
  const bus = new AudioBus({ seed: 1337, context: ctx, loadSamples });
  if (bus.ready) await bus.ready;
  bus.setMute(false);
  bus.engine.setState({ ...baseState, ...scene.initial });
  if (scene.engineSilent) bus.engine.dry.gain.value = 0;
  const grouped = new Map();
  for (const [at, apply] of scene.events || []) {
    if (!grouped.has(at)) grouped.set(at, []);
    grouped.get(at).push(apply);
  }
  const scheduled = [...grouped].map(([at, actions]) => ctx.suspend(WARMUP + at).then(async () => {
    try { for (const apply of actions) await apply(bus, ctx); } finally { await ctx.resume(); }
  }));
  try {
    const [buffer] = await Promise.all([ctx.startRendering(), ...scheduled]);
    return { wav: encodeFloatWav(buffer, WARMUP), capabilities: { combatEffects: !!bus.effects, cockpit: 'view' in bus.engine.state,
      textureStatus: bus.engine.textureStatus || 'legacy procedural', textureError: bus.textureError || null,
      offlineHrtfPreparation: scene.candidateOnly ? 'retained silent HRTF panner before startRendering; no sleep' : 'not needed' } };
  } finally {
    bus.dispose?.();
    releaseHrtf();
  }
}

export async function renderStudy({ batch = 'initial', names = null, versions = ['before', 'candidate'], sampleRate = 48000, loadSamples = true, onProgress = () => {} } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(batch)) throw new Error('Use a simple batch name');
  const implementations = {}, sourceSnapshots = { dependencies: {} }, frozen = new Map(), visiting = new Set();
  const importPattern = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'])([^"']+)(["'])/g;
  async function freezeModule(url, version = null) {
    if (frozen.has(url.href)) return frozen.get(url.href);
    if (visiting.has(url.href)) throw new Error(`The capture snapshotter requires an acyclic audio module graph: ${url}`);
    visiting.add(url.href);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Audio source unavailable: ${response.status}`);
    const source = await response.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const snapshot = { sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), source };
    if (version) sourceSnapshots[version] = snapshot;
    else sourceSnapshots.dependencies[url.pathname] = snapshot;
    const children = new Map();
    for (const match of source.matchAll(importPattern)) {
      const path = match[2];
      if (!/^(?:\.\.?\/|\/)/.test(path)) continue;
      const child = new URL(path, url);
      children.set(path, await freezeModule(child));
    }
    // Every scene imports this immutable graph. Concurrent production edits
    // cannot silently combine multiple revisions in a single capture batch.
    const adapted = source.replace(importPattern, (_, prefix, path, suffix) => prefix + (children.get(path) || path) + suffix)
      .replace(/\bimport\.meta\.url\b/g, JSON.stringify(url.href));
    const moduleUrl = URL.createObjectURL(new Blob([adapted], { type: 'text/javascript' }));
    frozen.set(url.href, moduleUrl);
    visiting.delete(url.href);
    return moduleUrl;
  }
  for (const version of versions) {
    const url = new URL(version === 'before' ? '/__baseline.js' : `/src/engine/audio.js?capture=${batch}`, location.href);
    implementations[version] = await import(await freezeModule(url, version));
  }
  const originalMute = localStorage.getItem('raptor:mute');
  const assets = {};
  if (loadSamples && versions.includes('candidate')) {
    const assetUrl = '/assets/audio/f119-afterburner.wav';
    const response = await fetch(assetUrl, { cache: 'no-store' });
    if (response.ok) {
      const bytes = await response.arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes);
      assets[assetUrl] = { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    } else assets[assetUrl] = { status: response.status, available: false };
  }
  const manifest = {
    batch, recordedAt: new Date().toISOString(), sampleRate, format: '32-bit float stereo WAV',
    warmupSeconds: WARMUP, seed: 1337, browser: navigator.userAgent, sourceSnapshots, loadSamples, assets,
    baselineAdapter: 'Original DSP unchanged. Injected OfflineAudioContext; disabled real-context gesture resume; seeded formerly Math.random cannon with SfcRng(6102); gun edges driven by audio-clock events, not the legacy burst timer.',
    limitations: 'Legacy has no positional combat effects or cockpit/load controls. Added-palette combat compares delivered experiences, not equivalent source inventories. There is no recorded aircraft ground-truth reference.',
    scenes: [],
  };
  try {
    for (const scene of SCENES) {
      if (names && !names.includes(scene.id)) continue;
      if (scene.candidateOnly && versions.includes('before')) continue;
      const entry = { ...scene, events: undefined, files: {} };
      for (const version of versions) {
        onProgress(`Rendering ${scene.id} / ${version}`);
        const result = await renderScene(implementations[version].AudioBus, scene, sampleRate, loadSamples);
        const filename = `${scene.id}--${version}.wav`;
        const response = await fetch(`/capture/${batch}/${filename}`, { method: 'POST', body: result.wav });
        if (!response.ok) throw new Error(`Capture failed: ${response.status} ${await response.text()}`);
        entry.files[version] = { filename, bytes: result.wav.byteLength, capabilities: result.capabilities };
        onProgress(`Saved ${scene.id} / ${version}`);
      }
      manifest.scenes.push(entry);
      const response = await fetch(`/capture/${batch}/manifest.json`, { method: 'POST', body: JSON.stringify(manifest, null, 2) });
      if (!response.ok) throw new Error(`Manifest capture failed: ${response.status} ${await response.text()}`);
    }
  } finally {
    if (originalMute === null) localStorage.removeItem('raptor:mute');
    else localStorage.setItem('raptor:mute', originalMute);
    for (const moduleUrl of frozen.values()) URL.revokeObjectURL(moduleUrl);
  }
  return manifest;
}

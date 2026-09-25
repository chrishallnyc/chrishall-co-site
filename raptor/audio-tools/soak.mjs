// Development-only real-time stability measurement. No uploaded audio, API
// services, power-management changes, or audible hardware output.
export function durationSeconds(value = '10m') {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h)?\s*$/.exec(String(value));
  const seconds = match && Number(match[1]) * ({ s: 1, m: 60, h: 3600 }[match[2] || 's']);
  if (!(seconds >= 5 && seconds <= 86400)) throw new Error('Duration must be 5 seconds through 24 hours (for example 10m or 24h)');
  return seconds;
}

export function completionStatus({ reason, frames, sampleRate, requestedSeconds, failureCount = 0, interruptionCount = 0 }) {
  if (failureCount) return 'failed';
  if (reason !== 'complete') return 'stopped';
  if (interruptionCount) return 'interrupted';
  return frames / sampleRate >= requestedSeconds ? 'completed' : 'incomplete';
}

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const utc = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = async (promise, label, milliseconds = 5000) => {
  let timeout;
  try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
  finally { clearTimeout(timeout); }
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');

// Stateless seeded variation: frame rate and missed callbacks cannot change
// future recipes. The production AudioBus has its own separately seeded RNG.
const random = (seed, id) => {
  let n = (seed ^ Math.imul(id + 1, 0x9e3779b9)) | 0;
  n = Math.imul(n ^ n >>> 16, 0x21f0aaad); n = Math.imul(n ^ n >>> 15, 0x735a2d97);
  return ((n ^ n >>> 15) >>> 0) / 4294967296;
};

export function flightRecipe(seconds, seed = 1337) {
  const t = seconds % 120, lap = Math.floor(seconds / 120), heading = seconds * 0.018;
  const position = [Math.sin(heading) * 400, 900 + Math.sin(seconds * 0.03) * 100, Math.cos(heading) * 400];
  const listener = { position, velocity: [Math.cos(heading) * 7.2, Math.cos(seconds * 0.03) * 3, -Math.sin(heading) * 7.2],
    right: [Math.cos(heading), 0, Math.sin(heading)], forward: [Math.sin(heading), 0, -Math.cos(heading)], up: [0, 1, 0] };
  const sources = [];
  for (let i = 0; i < 8; i++) {
    const phase = seconds * (0.1 + i * 0.008) + random(seed, i) * Math.PI * 2, radius = 75 + i * 120;
    sources.push({ id: `aircraft:${Math.floor(seconds / 18)}:${i}`, kind: 'aircraft', aircraftClass: ['fighter', 'drone', 'transport'][i % 3],
      position: [position[0] + Math.cos(phase) * radius, position[1] + 30 + i * 16, position[2] + Math.sin(phase) * radius],
      velocity: [-Math.sin(phase) * radius * (0.1 + i * 0.008), 0, Math.cos(phase) * radius * (0.1 + i * 0.008)],
      power: 0.45 + random(seed, i + lap * 11) * 0.55, motor: 'cruise', age: t, priority: 1 });
  }
  for (let i = 0; i < 10; i++) {
    const life = seconds + i * 0.53, age = life % 5, x = -1500 + age * 600, z = 25 + i * 34;
    sources.push({ id: `missile:${i}:${Math.floor(life / 5)}`, kind: 'missile',
      position: [position[0] + x, position[1] + 6 + i * 4, position[2] - z], velocity: [600, 0, 0],
      power: 1, motor: age < 1.5 ? 'boost' : age < 3 ? 'sustain' : 'coast', age, priority: i === 0 ? 4 : 1.5 });
  }
  const paused = t >= 88 && t < 91, muted = t >= 95 && t < 98;
  const gearPosition = t < 3 ? t / 3 : t < 10 ? 1 : t < 13 ? (13 - t) / 3 : t < 106 ? 0 : clamp((t - 106) / 3, 0, 1);
  const wow = t < 8 || t >= 110, wheelSpeed = t < 8 ? t * 18 : t >= 110 ? (120 - t) * 13 : 0;
  const ias = wow ? wheelSpeed * 1.94384 : 350 + Math.sin(t * 0.09) * 250;
  return { listener, sources, paused, muted,
    engine: { throttle: 0.25 + 0.75 * clamp(t / 14, 0, 1), ab: t >= 12 && t < 35 ? 1 : 0,
      // Synthetic DSP workload: alternate already-solved spool input with
      // the default command-response path during every two-minute cycle.
      ...(t < 60 ? { powerInput: 'spool' } : {}), ias,
      mach: 0.6 + Math.sin(t * 0.045) * 0.55, g: 1 + Math.max(0, Math.sin(t * 0.12)) * 7,
      aoa: Math.max(0, Math.sin(t * 0.08)) * 24, view: t < 60 ? 'external' : 'cockpit', active: !paused, fuelStarved: t >= 102 && t < 106 },
    airframe: { gearPosition, gearMoving: (t > 0 && t < 3) || (t > 10 && t < 13) || (t > 106 && t < 109),
      weightOnWheels: wow, wheelSpeed, brake: t >= 112 ? 0.8 : 0, groundLoad: wow ? 1 : 0, ias,
      fuelStarved: t >= 102 && t < 106, active: !paused },
    firing: !paused && t >= 15 && t < 80 && t % 7 < 0.75,
    alert: paused ? 'off' : ['off', 'scan', 'lock', 'launch'][Math.floor(t / 6) % 4], radio: t >= 72 && t < 79,
  };
}

// Tracks scheduled/running sources, including orphaned loops which disappear
// from a voice collection without being stopped. Records hold no AudioNode
// references; ended/stopped records are discarded, so the observer stays bounded.
export class SourceTracker {
  constructor() { this.sources = new Map(); this.serial = 0; this.created = {}; this.highWater = 0; }
  context(ctx, destination, generation) {
    const tracker = this, cache = new Map();
    return new Proxy(ctx, { get(target, key) {
      if (key === 'destination') return destination;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (cache.has(key)) return cache.get(key);
      const call = (...args) => {
        const node = value.apply(target, args);
        if (String(key).startsWith('create')) tracker.created[key] = (tracker.created[key] || 0) + 1;
        if (['createBufferSource', 'createOscillator', 'createConstantSource'].includes(key)) {
          const id = ++tracker.serial, record = { id, generation, kind: key, start: Infinity, end: Infinity };
          const start = node.start.bind(node), stop = node.stop.bind(node);
          node.start = (...values) => { const result = start(...values); record.start = Math.max(ctx.currentTime, values[0] || 0); tracker.sources.set(id, record); tracker.highWater = Math.max(tracker.highWater, tracker.sources.size); return result; };
          node.stop = (...values) => { const result = stop(...values); record.end = Math.min(record.end, Math.max(ctx.currentTime, values[0] || 0)); return result; };
          node.addEventListener('ended', () => tracker.sources.delete(id), { once: true });
        }
        return node;
      };
      cache.set(key, call); return call;
    } });
  }
  snapshot(now, generation) {
    for (const [id, source] of this.sources) if (source.end <= now) this.sources.delete(id);
    let retired = 0;
    for (const source of this.sources.values()) if (source.generation !== generation) retired++;
    return { activeScheduledSources: this.sources.size, retiredGenerationSources: retired, sourceHighWater: this.highWater, created: { ...this.created } };
  }
}

export const METER_SOURCE = `
class RaptorSoakMeter extends AudioWorkletProcessor {
  constructor() {
    super(); this.totalFrames=0; this.seq=0; this.expected=false; this.grace=0; this.silentFrames=0; this.reset();
    this.port.onmessage=({data})=>{
      if(data.type==='expect'){this.expected=data.active;this.grace=currentFrame+sampleRate;this.silentFrames=0;}
      if(data.type==='flush')this.report(data.id);
    };
  }
  reset(){this.frames=0;this.samples=0;this.sum=0;this.peak=0;this.nonfinite=0;this.clipped=0;this.maxSilence=0;}
  report(id=null){this.port.postMessage({type:'pcm',id,seq:++this.seq,frame:currentFrame,totalFrames:this.totalFrames,frames:this.frames,samples:this.samples,sum:this.sum,peak:this.peak,nonfinite:this.nonfinite,clipped:this.clipped,maxExpectedSilenceFrames:this.maxSilence});this.reset();}
  process(inputs,outputs){
    const output=outputs[0], input=inputs[0], frames=output[0]?.length||128;
    let blockSum=0;
    for(const channel of input)for(const v of channel){
      this.samples++;if(!Number.isFinite(v)){this.nonfinite++;continue;}
      const a=Math.abs(v);this.peak=Math.max(this.peak,a);if(a>=1)this.clipped++;this.sum+=v*v;blockSum+=v*v;
    }
    // PCM is measured above. The worklet itself writes silence, independently
    // of the final zero-gain hardware safeguard.
    for(const channel of output)channel.fill(0);
    this.frames+=frames;this.totalFrames+=frames;
    if(this.expected&&currentFrame>this.grace&&blockSum<1e-12)this.silentFrames+=frames;else this.silentFrames=0;
    this.maxSilence=Math.max(this.maxSilence,this.silentFrames);
    if(this.frames>=sampleRate)this.report();return true;
  }
}
registerProcessor('raptor-soak-meter',RaptorSoakMeter);
`;

async function frozenAudio() {
  const modules = {}, urls = new Map(), visiting = new Set();
  const pattern = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'])([^"']+)(["'])/g;
  async function freeze(url) {
    if (urls.has(url.href)) return urls.get(url.href);
    if (visiting.has(url.href)) throw new Error('Audio snapshot import cycle');
    visiting.add(url.href);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Source snapshot HTTP ${response.status}: ${url.pathname}`);
    const source = await response.text(), children = new Map();
    modules[url.pathname] = { sha256: await digest(new TextEncoder().encode(source)), source };
    for (const match of source.matchAll(pattern)) if (/^(?:\.\.?\/|\/)/.test(match[2])) children.set(match[2], await freeze(new URL(match[2], url)));
    const adapted = source.replace(pattern, (_, prefix, path, suffix) => prefix + (children.get(path) || path) + suffix)
      .replace(/\bimport\.meta\.url\b/g, JSON.stringify(url.href));
    const frozen = URL.createObjectURL(new Blob([adapted], { type: 'text/javascript' }));
    urls.set(url.href, frozen); visiting.delete(url.href); return frozen;
  }
  try {
    const { AudioBus } = await import(await freeze(new URL('/src/engine/audio.js', location.href)));
    const sourceHash = await digest(new TextEncoder().encode(Object.keys(modules).sort().map(path => `${path}:${modules[path].sha256}`).join('\n')));
    return { AudioBus, modules, sourceHash, dispose: () => { for (const url of urls.values()) URL.revokeObjectURL(url); } };
  } catch (error) { for (const url of urls.values()) URL.revokeObjectURL(url); throw error; }
}

async function save(batch, filename, value, keepalive = false) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/capture/${batch}/${filename}.json`, { method: 'POST', body: JSON.stringify(value),
      headers: { 'Content-Type': 'application/json' }, signal: controller.signal, keepalive });
    if (!response.ok) throw new Error(`Local capture HTTP ${response.status}`);
    return response.json();
  } finally { clearTimeout(timeout); }
}

const blankPcm = () => ({ frames: 0, samples: 0, sum: 0, peak: 0, nonfinite: 0, clipped: 0, maxExpectedSilenceFrames: 0 });
const mergePcm = (a, b) => {
  for (const key of ['frames', 'samples', 'sum', 'nonfinite', 'clipped']) a[key] += b[key];
  a.peak = Math.max(a.peak, b.peak); a.maxExpectedSilenceFrames = Math.max(a.maxExpectedSilenceFrames, b.maxExpectedSilenceFrames);
};
const pcmReport = (p, sampleRate) => ({ ...p, rms: Math.sqrt(p.sum / Math.max(1, p.samples)), audioSeconds: p.frames / sampleRate,
  maxExpectedSilenceSeconds: p.maxExpectedSilenceFrames / sampleRate });

export async function startSoak({ duration = '10m', batch = `soak-${Date.now()}`, seed = 1337, recreateSeconds = 300, onProgress = () => {} } = {}) {
  const requestedSeconds = durationSeconds(duration);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(batch)) throw new Error('Use a capture name of 1–80 letters, digits, underscores, or hyphens');
  if (!Number.isFinite(recreateSeconds) || recreateSeconds < 15 || recreateSeconds > 3600) throw new Error('Recreation interval must be 15–3600 seconds');
  if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new Error('This soak requires real-time AudioContext and AudioWorklet');
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const silence = ctx.createGain(); silence.gain.value = 0; silence.connect(ctx.destination);
  // Preserve the initial gesture before source snapshot/asset awaits. Nothing
  // connects to the hardware except a gain which is already exactly zero.
  const unlocked = ctx.resume();
  let graph, bus, meter, texture, timer, generation = 0, finishing = false, finalResult;
  const tracker = new SourceTracker(), originalMute = localStorage.getItem('raptor:mute');
  const restoreMute = () => { if (originalMute === null) localStorage.removeItem('raptor:mute'); else localStorage.setItem('raptor:mute', originalMute); };
  const totals = blankPcm(), minutes = [], failures = [], interruptions = [], events = {};
  let interval = blankPcm(), lastMeterAt = performance.now(), expected = null, saveQueue = Promise.resolve(), tickCount = 0;
  let maximumSceneVoices = 0, maximumEffectVoices = 0, longestTickGap = 0, lateTicks = 0, interruptionCount = 0;
  let suspensionSeconds = 0, recreations = 0, startPerformance, startWall, audioStart, lastTick, lastWall, lastAudio, lastEvent = -1, lastMinute = 0, nextRecreation = recreateSeconds, previousRecipe;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const note = (type, details = {}) => { events[type] = (events[type] || 0) + 1; return { type, utc: utc(), audioSeconds: ctx.currentTime - (audioStart || 0), ...details }; };
  const fault = (type, details = {}) => { if (!failures.some(f => f.type === type)) failures.push(note(type, details)); };
  const interrupted = (type, details = {}) => { interruptionCount++; if (interruptions.length < 128) interruptions.push(note(type, details)); };
  const snapshot = status => ({ schema: 1, batch, status, startedAt: startWall ? new Date(startWall).toISOString() : null, updatedAt: utc(),
    requestedSeconds, elapsedWallSeconds: startWall ? (Date.now() - startWall) / 1000 : 0, audioClockSeconds: audioStart === undefined ? 0 : ctx.currentTime - audioStart,
    pcm: pcmReport(totals, ctx.sampleRate), sourceHash: graph?.sourceHash, contextState: ctx.state, visibility: document.visibilityState,
    resources: { ...tracker.snapshot(ctx.currentTime, generation), generation, recreations, maximumSceneVoices, maximumEffectVoices,
      currentSceneVoices: bus?.scene.voices.size || 0, currentEffectVoices: bus?.effects.active.size || 0,
      usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null },
    scheduler: { tickCount, longestTickGap, lateTicks, intentionalSuspensionSeconds: suspensionSeconds },
    events: { ...events }, interruptionCount, interruptions: [...interruptions], failures: [...failures], savedMinutes: minutes.length,
    qualification: 'A completed result requires the requested real PCM duration, no detected failures, and no unplanned scheduler/audio-clock interruption. It is not a sound-quality rating.' });
  const queueSave = (filename, value) => { saveQueue = saveQueue.then(() => save(batch, filename, value)).catch(error => fault('capture-write', { message: error.message })); };
  const expectedSignal = value => { if (expected !== value) { expected = value; meter.port.postMessage({ type: 'expect', active: value }); } };
  async function replaceBus(initial = false) {
    const begin = performance.now(), beginWall = Date.now();
    await bounded(ctx.suspend(), 'AudioContext suspension');
    if (bus) {
      bus.dispose();
      const old = tracker.snapshot(ctx.currentTime, generation + 1);
      if (old.retiredGenerationSources) fault('sources-survived-dispose', old);
      recreations++;
    }
    generation++;
    bus = new graph.AudioBus({ context: tracker.context(ctx, silence, generation), seed, paused: true, loadSamples: true, texture });
    bus.analyser.disconnect(); bus.analyser.connect(meter);
    bus.setMute(false); restoreMute(); await bus.ready;
    if (bus.engine.textureStatus !== 'ready') fault('recorded-texture-not-ready', { textureStatus: bus.engine.textureStatus });
    bus.setPaused(false); expected = null; expectedSignal(true);
    if (initial) { startPerformance = performance.now(); startWall = Date.now(); audioStart = ctx.currentTime; apply(0, 0); }
    await bounded(ctx.resume(), 'AudioContext resume');
    if (!initial) {
      const elapsed = (performance.now() - begin) / 1000, wallElapsed = (Date.now() - beginWall) / 1000;
      suspensionSeconds += elapsed;
      if (elapsed > 2 || wallElapsed > 2) interrupted('prolonged-bus-recreation', { performanceSeconds: elapsed, wallSeconds: wallElapsed });
    }
    note(initial ? 'bus-created' : 'bus-recreated');
  }
  function apply(seconds, dt) {
    const recipe = flightRecipe(seconds, seed);
    for (const [name, value, before] of [
      ['cannon', recipe.firing, previousRecipe?.firing], ['alert', recipe.alert, previousRecipe?.alert],
      ['radio-duck', recipe.radio, previousRecipe?.radio], ['perspective', recipe.engine.view, previousRecipe?.engine.view],
      ['gear-moving', recipe.airframe.gearMoving, previousRecipe?.airframe.gearMoving],
      ['weight-on-wheels', recipe.airframe.weightOnWheels, previousRecipe?.airframe.weightOnWheels],
    ]) if (value !== before) note(`${name}:${value}`);
    previousRecipe = recipe;
    if (bus.paused !== recipe.paused) { note(recipe.paused ? 'pause' : 'resume'); bus.setPaused(recipe.paused); }
    if (bus.muted !== recipe.muted) { note(recipe.muted ? 'mute' : 'unmute'); bus.setMute(recipe.muted); restoreMute(); }
    bus.engine.setState(recipe.engine); bus.gun.setPerspective(recipe.engine.view);
    bus.airframe.setState(recipe.airframe); bus.setRadioActive(recipe.radio);
    bus.gun.fire(recipe.firing); bus.locks.setMode(recipe.alert);
    bus.scene.update({ listener: recipe.listener, sources: recipe.sources, dt });
    expectedSignal(!recipe.paused && !recipe.muted);
    const event = Math.floor(seconds);
    if (event === lastEvent) return;
    // Do not flood delayed effects to catch up after a suspended main thread.
    if (lastEvent >= 0 && event > lastEvent + 1) note('skipped-recipe-seconds', { count: event - lastEvent - 1 });
    lastEvent = event;
    const t = event % 120, id = `soak:${event}`;
    const oneShot = { 0: 'gear_start', 3: 'gear_lock', 8: 'missile', 10: 'gear_start', 12: 'afterburner', 13: 'gear_lock',
      35: 'sonic', 60: 'impact', 102: 'fuel_out', 106: 'gear_start', 109: 'gear_lock', 110: 'touchdown' }[t];
    if (oneShot) { bus.effects.play(oneShot, { sourceId: id, priority: t === 60 ? 4 : 2 }); note(oneShot); }
    if (t % 4 === 2) {
      const distance = 80 + random(seed, event) * 2100, angle = random(seed, event + 1) * Math.PI * 2;
      const position = [recipe.listener.position[0] + Math.cos(angle) * distance, recipe.listener.position[1] + 15, recipe.listener.position[2] + Math.sin(angle) * distance];
      bus.effects.play('explosion', { distance, position, delay: Math.min(6, distance / 343), sourceId: `${id}:explosion` }); note('delayed-explosion');
    }
    if (t === 83) {
      for (let i = 0; i < 28; i++) bus.effects.play('explosion', { distance: 1800 + i * 15, delay: 6, strength: 0.5, sourceId: `${id}:queue:${i}` });
      bus.effects.play('impact', { priority: 4, sourceId: `${id}:player` }); note('saturated-effects-then-impact');
    }
  }
  async function finish(reason = 'stopped') {
    if (finishing) return done;
    finishing = true; clearTimeout(timer);
    try {
      if (meter) expectedSignal(false);
      if (meter && ctx.state === 'running') {
        const id = Date.now(); meter.port.postMessage({ type: 'flush', id });
        for (let i = 0; i < 20 && meter.lastFlush !== id; i++) await sleep(50);
        if (meter.lastFlush !== id) fault('pcm-flush-timeout');
      }
      await bounded(ctx.suspend(), 'Final AudioContext suspension');
    } catch (error) { fault('finish-audio', { message: error.message }); }
    try { bus?.dispose(); } catch (error) { fault('bus-dispose', { message: error.message }); }
    const retired = tracker.snapshot(ctx.currentTime, generation + 1);
    if (retired.retiredGenerationSources) fault('sources-survived-final-dispose', retired);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    meter?.disconnect(); silence.disconnect(); restoreMute(); graph?.dispose();
    await bounded(ctx.close(), 'AudioContext close').catch(error => { fault('context-close', { message: error.message }); });
    await saveQueue;
    const status = completionStatus({ reason, frames: totals.frames, sampleRate: ctx.sampleRate, requestedSeconds, failureCount: failures.length, interruptionCount });
    finalResult = { ...snapshot(status), endedAt: utc(), reason, continuousDurationPassed: status === 'completed',
      minutes, finalInterval: pcmReport(interval, ctx.sampleRate) };
    try { await save(batch, 'result', finalResult); await save(batch, 'latest', finalResult); }
    catch (error) { fault('final-capture-write', { message: error.message }); finalResult.status = 'failed'; finalResult.continuousDurationPassed = false; finalResult.failures = [...failures]; }
    try { onProgress(finalResult); } finally { resolveDone(finalResult); }
    return finalResult;
  }
  function visibility() { note(`visibility-${document.visibilityState}`); }
  function pagehide() {
    interrupted('pagehide');
    navigator.sendBeacon(`/capture/${batch}/latest.json`, new Blob([JSON.stringify({ ...snapshot('interrupted'), endedAt: utc(), reason: 'pagehide', continuousDurationPassed: false })], { type: 'application/json' }));
    void finish('pagehide');
  }
  async function tick() {
    if (finishing) return;
    try {
      const now = performance.now(), wall = Date.now(), audio = ctx.currentTime;
      const delta = (now - lastTick) / 1000, wallDelta = (wall - lastWall) / 1000, audioDelta = audio - lastAudio;
      longestTickGap = Math.max(longestTickGap, delta); if (delta > 0.15) lateTicks++;
      if (delta > 1 || wallDelta > 1 || Math.abs(wallDelta - delta) > 1) interrupted('scheduler-or-system-interruption', { performanceGap: delta, wallGap: wallDelta, audioGap: audioDelta, visibility: document.visibilityState });
      if (delta < 1 && Math.abs(delta - audioDelta) > 0.5) interrupted('audio-clock-discontinuity', { performanceGap: delta, audioGap: audioDelta, state: ctx.state });
      lastTick = now; lastWall = wall; lastAudio = audio; tickCount++;
      const seconds = audio - audioStart;
      if (now - lastMeterAt > 5000) { fault('pcm-clock-stalled', { secondsSincePcm: (now - lastMeterAt) / 1000, contextState: ctx.state }); await finish('clock-stalled'); return; }
      if (totals.frames / ctx.sampleRate >= requestedSeconds) { await finish('complete'); return; }
      if (seconds >= nextRecreation) {
        await replaceBus(); nextRecreation = ctx.currentTime - audioStart + recreateSeconds;
        lastTick = performance.now(); lastWall = Date.now(); lastAudio = ctx.currentTime; lastMeterAt = performance.now();
      }
      apply(ctx.currentTime - audioStart, Math.min(delta, 0.25));
      const resources = tracker.snapshot(ctx.currentTime, generation);
      maximumSceneVoices = Math.max(maximumSceneVoices, bus.scene.voices.size);
      maximumEffectVoices = Math.max(maximumEffectVoices, bus.effects.active.size);
      if (bus.scene.voices.size > bus.scene.maxVoices || bus.effects.active.size > bus.effects.maxVoices || resources.activeScheduledSources > 96 || resources.retiredGenerationSources) {
        fault('resource-budget', resources); await finish('resource-budget'); return;
      }
      const minute = Math.floor(seconds / 60);
      if (minute > lastMinute) {
        const entry = { minute, utc: utc(), ...pcmReport(interval, ctx.sampleRate), resources, contextState: ctx.state, events: { ...events },
          longestTickGap, usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
        minutes.push(entry); interval = blankPcm(); lastMinute = minute;
        queueSave(`minute-${String(minute).padStart(4, '0')}`, entry); queueSave('latest', snapshot('running'));
      }
      if (tickCount % 20 === 0) onProgress(snapshot('running'));
      timer = setTimeout(tick, Math.max(0, 50 - (performance.now() - now)));
    } catch (error) { fault('harness-exception', { message: error.stack }); await finish('exception'); }
  }
  try {
    await bounded(unlocked, 'AudioContext gesture resume');
    await bounded(ctx.suspend(), 'Initial AudioContext suspension'); graph = await frozenAudio();
    const response = await fetch('/assets/audio/f119-afterburner.wav', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Required engine texture HTTP ${response.status}`);
    const bytes = await response.arrayBuffer(), textureHash = await digest(bytes);
    texture = await ctx.decodeAudioData(bytes.slice(0));
    const workletUrl = URL.createObjectURL(new Blob([METER_SOURCE], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(workletUrl); } finally { URL.revokeObjectURL(workletUrl); }
    meter = new AudioWorkletNode(ctx, 'raptor-soak-meter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    meter.connect(silence);
    meter.port.onmessage = ({ data }) => {
      if (data.type !== 'pcm') return;
      lastMeterAt = performance.now(); mergePcm(totals, data); mergePcm(interval, data);
      if (data.id !== null) meter.lastFlush = data.id;
      if (data.nonfinite) fault('nonfinite-pcm', { samples: data.nonfinite });
      if (data.clipped) fault('clipped-pcm', { samples: data.clipped, peak: data.peak });
      if (data.maxExpectedSilenceFrames > 3 * ctx.sampleRate) fault('unexpected-silence', { seconds: data.maxExpectedSilenceFrames / ctx.sampleRate });
    };
    const harnessResponse = await fetch(import.meta.url, { cache: 'no-store' }), harnessSource = await harnessResponse.text();
    await save(batch, 'manifest', { schema: 1, preparedAt: utc(), requestedSeconds, recreateSeconds, seed, sampleRate: ctx.sampleRate,
      sourceHash: graph.sourceHash, modules: graph.modules, harness: { sha256: await digest(new TextEncoder().encode(harnessSource)), source: harnessSource },
      texture: { url: '/assets/audio/f119-afterburner.wav', sha256: textureHash, bytes: bytes.byteLength, duration: texture.duration },
      userAgent: navigator.userAgent, silentOutput: 'Bus destination is a zero-gain proxy from construction; PCM worklet independently outputs zeros.',
      limits: { movingVoices: 12, effects: 20, activeScheduledSources: 96, interruptionDetails: 128 },
      limitations: 'A synthetic deterministic DSP workload, not a flight-simulation replay or sound-quality judgment. Counts active scheduled sources and production voice budgets; JS heap is optional and does not measure native audio memory. No forced garbage collection. Hidden visibility is recorded; actual callback gaps/audio interruption disqualify continuous completion.' });
    await replaceBus(true);
    lastTick = performance.now(); lastWall = Date.now(); lastAudio = ctx.currentTime; lastMeterAt = lastTick;
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide);
    note(`visibility-${document.visibilityState}`);
    queueSave('latest', snapshot('running')); void tick();
    return { done, stop: () => finish('stopped'), snapshot: () => finalResult || snapshot('running') };
  } catch (error) {
    bus?.dispose(); meter?.disconnect(); silence.disconnect(); graph?.dispose(); restoreMute(); await bounded(ctx.close(), 'Failed-start AudioContext close').catch(() => {}); throw error;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeAudio } from '../src/audio.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  record(value, time) {
    assert.ok(Number.isFinite(value), 'finite automation value');
    assert.ok(Number.isFinite(time) && time >= 0, 'valid automation time');
    this.value = value;
    this.events.push({ value, time });
  }
  setValueAtTime(value, time) { this.record(value, time); }
  linearRampToValueAtTime(value, time) { this.record(value, time); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.record(value, time); }
  setTargetAtTime(value, time, constant) { assert.ok(constant > 0); this.record(value, time); }
  cancelScheduledValues(time) { assert.ok(Number.isFinite(time)); }
}
class Node {
  connect(target) { assert.ok(target); return target; }
  disconnect() { this.disconnected = true; }
}
class Source extends Node {
  constructor(ctx) {
    super(); this.ctx = ctx; this.frequency = new Parameter(); this.detune = new Parameter();
    ctx.sources.push(this);
  }
  setPeriodicWave(wave) { assert.ok(wave); }
  start(time) { assert.ok(time >= this.ctx.currentTime); this.started = time; }
  stop(time) { assert.ok(Number.isFinite(time)); this.stopped = time; }
}
class Context {
  static created = 0;
  static blocked = false;
  constructor() {
    Context.created++;
    this.state = Context.blocked ? 'suspended' : 'running';
    this.currentTime = 0; this.sampleRate = 48000; this.sources = []; this.destination = new Node();
    this.resumeCount = 0;
  }
  createGain() { return Object.assign(new Node(), { gain: new Parameter(1) }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, new Parameter()])));
  }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createPeriodicWave(real, imaginary) { assert.equal(real.length, imaginary.length); return {}; }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Parameter(), Q: new Parameter() }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Parameter() }); }
  addEventListener() {}
  removeEventListener() {}
  async resume() { this.resumeCount++; if (Context.blocked) throw new Error('Autoplay denied'); this.state = 'running'; }
  async close() {
    this.state = 'closed';
    for (const source of this.sources) source.onended?.();
  }
}

async function withAudio(fn) {
  const originalContext = globalThis.AudioContext;
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const timers = new Map(); let timerId = 0;
  Context.created = 0; Context.blocked = false;
  globalThis.AudioContext = Context;
  globalThis.setInterval = (callback, ms) => { assert.equal(ms, 40); timers.set(++timerId, callback); return timerId; };
  globalThis.clearInterval = id => timers.delete(id);
  const audio = new ArcadeAudio();
  try { await fn(audio, timers); }
  finally {
    audio.destroy();
    if (originalContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalContext;
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
  }
}

test('audio remains silent and creates no context until explicitly started', () => withAudio(async (audio, timers) => {
  audio.setMuted(true);
  audio.update({ phase: 'playing', stage: 1 });
  audio.event({ type: 'missile' });
  assert.equal(Context.created, 0);
  assert.equal(timers.size, 0);
  assert.equal(await audio.start(), true);
  assert.equal(Context.created, 1);
  assert.equal(audio.context.sources.length, 0);
  audio.setMuted(false);
  assert.equal(timers.size, 1);
  assert.ok(audio.context.sources.length > 0);
}));

test('manual pause, simulation screens, mute and destroy each stop the score', () => withAudio(async (audio, timers) => {
  await audio.start();
  audio.update({ phase: 'playing', stage: 0 });
  assert.equal(timers.size, 1);
  audio.setPaused(true);
  audio.update({ phase: 'playing', stage: 0 });
  assert.equal(timers.size, 0, 'simulation update cannot override the shell pause');
  assert.equal(audio._voices.size, 0);
  audio.setPaused(false);
  assert.equal(timers.size, 1);
  audio.update({ phase: 'upgrade', stage: 0 });
  audio.setPaused(false);
  assert.equal(timers.size, 0, 'shell resume cannot start music behind the upgrade screen');
  audio.update({ phase: 'playing', stage: 1 });
  audio.setMuted(true);
  assert.equal(timers.size, 0);
  audio.setMuted(false);
  assert.equal(timers.size, 1);
  audio.destroy();
  audio.destroy();
  assert.equal(timers.size, 0);
  assert.equal(audio.context.state, 'closed');
  assert.equal(audio._voices.size, 0);
  assert.equal(await audio.start(), false);
}));

test('a denied resume is safe and update never retries autoplay', () => withAudio(async (audio, timers) => {
  Context.blocked = true;
  assert.equal(await audio.start(), false);
  audio.update({ phase: 'playing', stage: 2 });
  audio.setMuted(false);
  audio.setPaused(false);
  audio.event({ type: 'win' });
  assert.equal(audio.context.resumeCount, 1);
  assert.equal(timers.size, 0);
  assert.equal(audio.context.sources.length, 0);
  Context.blocked = false;
  assert.equal(await audio.start(), true);
  assert.equal(timers.size, 1);
}));

test('retry clears boss intensity and an interrupted device resumes only on an explicit start', () => withAudio(async (audio, timers) => {
  await audio.start();
  audio.update({ phase: 'playing', stage: 0, boss: { hp: 40 } });
  assert.equal(audio._boss, true);
  audio.update({ phase: 'lost', stage: 0, boss: { hp: 40 } });
  audio.update({ phase: 'playing', stage: 0, boss: null });
  assert.equal(audio._boss, false, 'starting another run is no longer a boss encounter');
  audio.context.state = 'interrupted';
  audio.update({ phase: 'playing', stage: 0, boss: null });
  assert.equal(timers.size, 0);
  assert.equal(audio.context.resumeCount, 0);
  assert.equal(await audio.start(), true);
  assert.equal(audio.context.resumeCount, 1);
  assert.equal(timers.size, 1);
}));

test('rapid fire is rate limited and prolonged combat has a bounded voice budget', () => withAudio(async audio => {
  await audio.start();
  for (let i = 0; i < 1000; i++) audio.event({ type: 'shoot' });
  assert.equal(audio.context.sources.length, 1, 'one audible gunshot within the same time window');
  for (let i = 0; i < 160; i++) {
    audio.context.currentTime += 0.13;
    audio.event({ type: 'explosion', size: i % 2 ? 'large' : 'small', x: i * 3 });
    audio.event({ type: 'shoot' });
    audio.event({ type: 'hit', side: i % 2 ? 'player' : 'enemy' });
    audio.event({ type: 'missile' });
    assert.ok(audio._voices.size <= 48, 'audio budget never exceeds 48 active voices');
  }
  for (const source of audio.context.sources) {
    assert.ok(Number.isFinite(source.started));
    assert.ok(Number.isFinite(source.stopped), 'every source has an explicit end');
  }
}));

test('all three scores and completion stingers schedule valid audio; a sleeping tab does not replay a backlog', () => withAudio(async (audio, timers) => {
  await audio.start();
  for (let stage = 0; stage < 3; stage++) {
    audio.update({ phase: 'playing', stage, player: { hp: 20, maxHp: 100 } });
    for (let bar = 0; bar < 8; bar++) {
      for (let step = 0; step < 16; step++) audio._musicStep(bar * 16 + step, audio.context.currentTime + 0.02 + step * 0.13);
      audio.context.currentTime += 2.2;
    }
    for (const event of [{ type: 'pickup', kind: 'repair' }, { type: 'pickup', kind: 'score' }, { type: 'roll' }, { type: 'boss' }]) {
      audio.event(event); audio.context.currentTime += 0.3;
    }
  }
  audio.context.currentTime += 120;
  const before = audio.context.sources.length;
  audio._tick();
  assert.ok(audio.context.sources.length - before < 25, 'no burst of two minutes of buffered music');
  audio.event({ type: 'win' });
  assert.equal(timers.size, 0);
  assert.ok([...audio._voices].some(voice => voice.bus === 'sfx'), 'completion music survives stopping the looping score');
  audio.context.currentTime += 3;
  audio.event({ type: 'lose' });
  audio.context.currentTime += 3;
  audio.event({ type: 'stage', stage: 0 });
  assert.equal(audio.stage, 0);
}));

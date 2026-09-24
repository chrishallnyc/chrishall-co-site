import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { durationSeconds, completionStatus, flightRecipe, SourceTracker, METER_SOURCE } from '../audio-tools/soak.mjs';

test('duration accepts explicit day runs without silently rounding or accepting unbounded input', () => {
  assert.equal(durationSeconds(), 600);
  assert.equal(durationSeconds('24h'), 86400);
  assert.equal(durationSeconds('2.5m'), 150);
  for (const value of ['Infinity', '25h', '4s', 'ten minutes', '-1h']) assert.throws(() => durationSeconds(value));
});

test('a short or interrupted run cannot qualify as a continuous full-day result', () => {
  const day = { reason: 'complete', frames: 86400 * 48000, sampleRate: 48000, requestedSeconds: 86400 };
  assert.equal(completionStatus(day), 'completed');
  assert.equal(completionStatus({ ...day, frames: 130 * 48000 }), 'incomplete');
  assert.equal(completionStatus({ ...day, interruptionCount: 1 }), 'interrupted');
  assert.equal(completionStatus({ ...day, reason: 'stopped' }), 'stopped');
  assert.equal(completionStatus({ ...day, failureCount: 1 }), 'failed');
});

test('seeded flight scene stays finite, bounded, and independent of callback history across a day', () => {
  const ids = new Set();
  for (let t = 0; t < 86400; t += 17.3) {
    const scene = flightRecipe(t, 501);
    assert.equal(scene.sources.length, 18);
    assert.equal(new Set(scene.sources.map(source => source.id)).size, 18);
    for (const source of scene.sources) {
      assert.ok([...source.position, ...source.velocity, source.power, source.age, source.priority].every(Number.isFinite));
      assert.ok(source.age >= 0);
    }
    assert.ok([...scene.listener.position, ...scene.listener.velocity].every(Number.isFinite));
    if (t < 60) for (const source of scene.sources) ids.add(source.id);
  }
  assert.ok(ids.size > 18, 'identities must churn instead of reusing an immortal emitter');
  const before = flightRecipe(63.5, 501); flightRecipe(763.25, 87);
  assert.deepEqual(flightRecipe(63.5, 501), before);
  assert.notDeepEqual(flightRecipe(63.5, 501), flightRecipe(63.5, 502));
});

test('recipe exercises actual airframe API fields and pause/mute boundaries', () => {
  assert.equal(flightRecipe(1).airframe.gearMoving, true);
  assert.equal(flightRecipe(11).airframe.gearMoving, true);
  assert.equal(flightRecipe(14).airframe.gearMoving, false);
  assert.equal(flightRecipe(4).airframe.weightOnWheels, true);
  assert.equal(flightRecipe(14).airframe.weightOnWheels, false);
  assert.equal(flightRecipe(115).airframe.weightOnWheels, true);
  assert.ok(flightRecipe(115).airframe.brake > 0);
  assert.equal(flightRecipe(4).airframe.groundLoad, 1);
  assert.equal(flightRecipe(14).airframe.groundLoad, 0);
  assert.equal(flightRecipe(115).airframe.ias, flightRecipe(115).engine.ias);
  assert.equal(flightRecipe(14).engine.powerInput, 'spool');
  assert.equal(flightRecipe(74).engine.powerInput, undefined, 'the second half exercises the default command-response input');
  assert.equal(flightRecipe(89).paused, true);
  assert.equal(flightRecipe(89).firing, false);
  assert.equal(flightRecipe(92).paused, false);
  assert.equal(flightRecipe(96).muted, true);
  assert.equal(flightRecipe(99).muted, false);
});

function fakeContext() {
  const sources = [];
  return { currentTime: 0, destination: { hardware: true }, sources,
    createBufferSource() {
      const node = { start() {}, stop() {}, addEventListener(type, handler) { this.ended = handler; } };
      sources.push(node); return node;
    },
  };
}

test('source tracking catches abandoned loops across generations and counts scheduled sources until stopped', () => {
  const real = fakeContext(), silence = {}, tracker = new SourceTracker();
  const first = tracker.context(real, silence, 1);
  assert.equal(first.destination, silence, 'constructor output must already route into hardware silence');
  const loop = first.createBufferSource(); loop.start();
  const pending = first.createBufferSource(); pending.start(6);
  assert.equal(tracker.snapshot(0, 1).activeScheduledSources, 2);
  assert.equal(tracker.snapshot(0, 2).retiredGenerationSources, 2, 'new generation must not conceal orphaned voices');
  pending.stop(2); real.currentTime = 1;
  assert.equal(tracker.snapshot(1, 1).activeScheduledSources, 2);
  real.currentTime = 2;
  assert.equal(tracker.snapshot(2, 1).activeScheduledSources, 1);
  loop.stop();
  assert.equal(tracker.snapshot(2, 2).retiredGenerationSources, 0);
});

test('ended callbacks release natural effects and tracking storage remains bounded under churn', () => {
  const real = fakeContext(), tracker = new SourceTracker(), ctx = tracker.context(real, {}, 1);
  for (let i = 0; i < 10000; i++) {
    const source = ctx.createBufferSource(); source.start(); source.ended();
  }
  assert.equal(tracker.sources.size, 0);
  assert.equal(tracker.created.createBufferSource, 10000);
  assert.equal(tracker.highWater, 1);
});

function meterHarness() {
  const messages = [];
  const context = { currentFrame: 0, sampleRate: 128, registerProcessor(name, constructor) { this.Meter = constructor; },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(message) { messages.push(message); } }; } } };
  vm.createContext(context);
  // registerProcessor is a standalone browser callback, so capture explicitly.
  context.registerProcessor = (name, constructor) => { context.Meter = constructor; };
  vm.runInContext(METER_SOURCE, context);
  const meter = new context.Meter();
  const process = input => {
    const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
    meter.process([input], [output]); context.currentFrame += 128;
    assert.ok(output.every(channel => channel.every(value => value === 0)), 'meter must emit silence even when input is corrupt');
    return messages.at(-1);
  };
  return { meter, messages, process };
}

test('PCM worklet measures real values, counts nonfinite/clipped samples, and outputs only silence', () => {
  const { process } = meterHarness();
  const left = new Float32Array(128).fill(0.25), right = new Float32Array(128).fill(-0.25);
  left[0] = NaN; left[1] = Infinity; right[0] = 1.1;
  const result = process([left, right]);
  assert.equal(result.frames, 128); assert.equal(result.samples, 256);
  assert.equal(result.nonfinite, 2); assert.equal(result.clipped, 1);
  assert.ok(result.peak > 1 && result.peak < 1.2);
  assert.ok(Number.isFinite(result.sum));
});

test('PCM heartbeat covers silent input and only diagnoses silence when active signal is expected', () => {
  const { meter, process, messages } = meterHarness();
  for (let i = 0; i < 5; i++) assert.equal(process([]).maxExpectedSilenceFrames, 0);
  meter.port.onmessage({ data: { type: 'expect', active: true } });
  for (let i = 0; i < 6; i++) process([new Float32Array(128)]);
  assert.ok(messages.at(-1).maxExpectedSilenceFrames >= 4 * 128);
  meter.port.onmessage({ data: { type: 'expect', active: false } });
  assert.equal(process([]).maxExpectedSilenceFrames, 0);
  meter.port.onmessage({ data: { type: 'flush', id: 7 } });
  assert.equal(messages.at(-1).id, 7);
  assert.equal(messages.at(-1).totalFrames, 12 * 128);
});

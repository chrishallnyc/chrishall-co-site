import test from 'node:test';
import assert from 'node:assert/strict';
import { AcousticScene, relativeAcoustics } from '../src/engine/acoustic-scene.js';
import { AcousticContext } from './acoustic-fixture.mjs';

const listener = () => ({ position: [0, 0, 0], velocity: [0, 0, 0], right: [1, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] });
const aircraft = (id, distance = 100) => ({ id, kind: 'aircraft', aircraftClass: 'fighter', position: [distance, 0, 0],
  velocity: [-100, 0, 0], priority: 1, power: .8 });
const fixture = (maxVoices = 12) => {
  const context = new AcousticContext();
  return { context, scene: new AcousticScene(context, context.destination, { maxVoices }), listener: listener() };
};

test('reused acoustics refresh every field, retain output identity and never modify caller vectors', () => {
  const own = listener(), source = aircraft('a'), out = {}, before = structuredClone([own, source]);
  assert.equal(relativeAcoustics(own, source, out), out);
  const direction = out.direction;
  assert.deepEqual(out, relativeAcoustics(own, source));
  assert.deepEqual([own, source], before);
  for (const distance of [0, 1e-8, .0001, .00011, 100, -100, 12000]) {
    source.position[0] = distance;
    source.velocity[0] = distance > 0 ? 300 : -300;
    relativeAcoustics(own, source, out);
    assert.equal(out.direction, direction);
    assert.deepEqual(out, relativeAcoustics(own, source));
    assert.ok(Object.values(out).flat().every(Number.isFinite));
  }
  const first = relativeAcoustics(own, source), second = relativeAcoustics(own, source);
  first.direction[0] = 123;
  assert.notEqual(first.direction, second.direction, 'default callers still receive independent snapshots');
  assert.notEqual(second.direction[0], 123);
});

test('moving voices update exact position, Doppler and normalized exhaust parameters without stale scratch', () => {
  const f = fixture(), source = aircraft('a');
  try {
    f.scene.update({ listener: f.listener, sources: [source] });
    const voice = f.scene.voices.get('a'), pool = f.scene._candidatePool.slice();
    const candidate = pool[0], direction = candidate.acoustic.direction;
    assert.equal(voice.bed.playbackRate.value, 343 / 243);
    assert.equal(voice.panner.orientationX.value, 1);
    assert.equal(voice.panner.orientationY.value, -0);
    const input = structuredClone(source);
    for (let frame = 1; frame <= 120; frame++) {
      f.context.currentTime = frame / 60;
      source.position[0] = 100 + frame; source.position[1] = frame * 2;
      source.velocity[0] = frame; source.velocity[1] = -frame;
      const expected = relativeAcoustics(f.listener, source), speed = Math.hypot(...source.velocity);
      f.scene.update({ listener: f.listener, sources: [source] });
      assert.equal(f.scene.voices.get('a'), voice, 'continuous source retains its audio nodes');
      assert.equal(voice.distance, expected.distance);
      assert.equal(voice.bed.playbackRate.value, expected.doppler);
      assert.equal(voice.air.frequency.value, expected.cutoff);
      assert.equal(voice.panner.positionX.value, source.position[0]);
      assert.equal(voice.panner.positionY.value, source.position[1]);
      assert.equal(voice.panner.orientationX.value, -source.velocity[0] / speed);
      assert.equal(f.scene._candidatePool.length, 1);
      assert.equal(f.scene._candidatePool[0], candidate);
      assert.equal(candidate.acoustic.direction, direction);
      assert.equal(candidate.source, null, 'scratch releases caller data after the update');
    }
    assert.equal(source.score, undefined, 'ranking must not write a score into caller state');
    assert.equal(source.id, input.id);
    assert.equal(f.context.nodes.filter(node => node.id.startsWith('panner:')).length, 1);
    source.velocity = undefined; f.listener.forward = [0, 0, 0]; f.listener.up = [0, 0, 0];
    f.scene.update({ listener: f.listener, sources: [source] });
    assert.equal(voice.panner.orientationZ.value, 1, 'stationary-source fallback is retained');
    assert.equal(f.context.listener.forwardZ.value, -1);
    assert.equal(f.context.listener.upZ.value, -1, 'degenerate listener vectors preserve the established fallback');
  } finally { f.scene.dispose(); }
});

test('ranking retains stable ties and budgets through reorder, duplicate IDs and out-of-range candidates', () => {
  const f = fixture(2), sources = [aircraft('a'), aircraft('b'), aircraft('c')];
  try {
    f.scene.update({ listener: f.listener, sources });
    assert.deepEqual([...f.scene.voices.keys()], ['a', 'b']);
    assert.deepEqual(f.scene.stats, { candidates: 3, voices: 2, dropped: 1 });
    f.context.currentTime = 1;
    // A much nearer candidate preempts the fading tail, never a selected voice.
    sources[2].position[0] = 9;
    const invalid = { ...aircraft('invalid'), position: [NaN, 0, 0] };
    const far = aircraft('far', 15000);
    f.scene.update({ listener: f.listener, sources: [far, sources[2], invalid, sources[1]] });
    assert.deepEqual([...f.scene.voices.keys()], ['b', 'c']);
    assert.deepEqual(f.scene.stats, { candidates: 2, voices: 2, dropped: 0 });
    assert.ok(f.scene._candidatePool.every(candidate => candidate.source === null));
    // Equal-score source duplicates retain the same counting contract, while
    // a single audio voice still owns that source's identity.
    f.scene.update({ listener: f.listener, sources: [sources[2], sources[2]] });
    assert.equal(f.scene.voices.size, 2, 'the unselected voice is still fading');
    assert.deepEqual(f.scene.stats, { candidates: 2, voices: 2, dropped: 0 });
    f.context.currentTime += .2;
    f.scene.update({ listener: f.listener, sources: [] });
    assert.equal(f.scene.voices.size, 1);
    f.context.currentTime += .2;
    f.scene.update({ listener: f.listener, sources: [] });
    assert.equal(f.scene.voices.size, 0);
  } finally { f.scene.dispose(); }
});

test('missile motor transitions, pause and resume rebuild state without retaining old candidates', () => {
  const f = fixture(1), source = { ...aircraft('m', 100), kind: 'missile', motor: 'boost', velocity: [-400, 0, 0] };
  try {
    f.scene.update({ listener: f.listener, sources: [source] });
    let voice = f.scene.voices.get('m');
    assert.equal(voice.coreGain.gain.value, 1); assert.equal(voice.hissGain.gain.value, .22);
    source.motor = 'sustain'; f.scene.update({ listener: f.listener, sources: [source] });
    assert.equal(voice.coreGain.gain.value, 1); assert.equal(voice.hissGain.gain.value, .38);
    source.motor = 'coast'; f.scene.update({ listener: f.listener, sources: [source] });
    assert.equal(voice.coreGain.gain.value, 0); assert.equal(voice.hissGain.gain.value, .9);
    source.position[0] = 251; f.scene.update({ listener: f.listener, sources: [source] });
    assert.equal(f.scene.stats.candidates, 0); assert(voice.retiring);
    f.scene.setPaused(true); assert.equal(f.scene.voices.size, 0); assert(voice.disposed);
    source.position[0] = 100;
    f.scene.update({ listener: f.listener, sources: [source] }); assert.equal(f.scene.voices.size, 0);
    f.scene.setPaused(false); f.scene.update({ listener: f.listener, sources: [source] });
    assert.notEqual(f.scene.voices.get('m'), voice);
    assert.equal(f.scene.voices.size, 1);
    assert.equal(f.scene._candidatePool[0].source, null);
  } finally { f.scene.dispose(); }
});

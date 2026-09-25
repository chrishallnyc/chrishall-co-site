// Actual presentation methods with Three's math, without a renderer or GPU.
import './register-three.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { Player } = await import('../src/game/player.js');
const { Bandits, MAX_BANDITS, SLOTS_B } = await import('../src/game/bandits.js');
import { FlightCoach, TrainingCourse } from '../src/game/flightcoach.js';
import { S } from '../src/sim/flight.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }),
};

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);

function playerFixture() {
  const player = new Player(new THREE.Scene(), {
    jet: new THREE.Group(), spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 },
  });
  player.gun.render = player.missiles.render = () => {};
  player.fm.setAttitude(0, 0, 0);
  player._prev.set(player.fm.state);
  return { player, camera: new THREE.PerspectiveCamera() };
}

test('visual HUD and pipper state follow the visible aircraft while authoritative telemetry stays current', () => {
  const { player, camera } = playerFixture();
  player.fm.setAttitude(Math.PI / 2, 0, 0);
  player.fm.state[S.PX] += 40;
  player.fm.state[S.PZ] += 80;
  player.fm.state[S.VX] = 400;
  const authoritative = player.hudState();
  const state = [...player.fm.state], previous = [...player._prev];
  const aim = [player.aimHeading, player.aimPitch];
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    player.render(alpha, camera, true, 0);
    const hud = player.hudState({ presentation: true });
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.jet.quaternion);
    close(hud.heading, (Math.atan2(forward.x, forward.z) * 180 / Math.PI + 360) % 360, 'HUD heading follows jet');
    close(hud.altFt, player.jet.position.y * 3.28084, 'HUD altitude follows jet');
    close(hud.speedKt, (200 + 200 * alpha) * 1.94384, 'speed tape interpolates velocity');
    const shown = player.renderState;
    close(shown[S.PX], player.jet.position.x, 'pipper east');
    close(shown[S.PY], player.jet.position.z, 'pipper north');
    close(shown[S.PZ], player.jet.position.y, 'pipper altitude');
    const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(shown[S.QX], shown[S.QY], shown[S.QZ], shown[S.QW]));
    close(nose.distanceTo(new THREE.Vector3(forward.x, forward.z, forward.y)), 0, 'pipper attitude follows jet');
    assert.deepEqual(player.hudState(), authoritative, 'coaching and pause telemetry remain authoritative');
  }
  assert.deepEqual([...player.fm.state], state);
  assert.deepEqual([...player._prev], previous);
  assert.deepEqual([player.aimHeading, player.aimPitch], aim);
});

test('visual heading crosses north by the short quaternion path and cuts reset presentation immediately', () => {
  const { player, camera } = playerFixture();
  player.fm.setAttitude(89 * Math.PI / 180, 0, 0);
  player._prev.set(player.fm.state);
  player.fm.setAttitude(91 * Math.PI / 180, 0, 0);
  player.render(0.5, camera, true, 0);
  const heading = player.hudState({ presentation: true }).heading;
  assert.ok(heading < 1e-8 || heading > 360 - 1e-8, `north crossing: ${heading}`);
  player.debugCommand({ pos: { x: 10000, y: 20000, alt: 9000, headingDeg: 180, speed: 100 } });
  assert.deepEqual(player.hudState({ presentation: true }), player.hudState());
  player.recoverFlight();
  assert.deepEqual(player.hudState({ presentation: true }), player.hudState());
});

test('damage feedback has equal lifetime across refresh rates and does not age on HUD reads', () => {
  for (const fps of [30, 60, 144]) {
    const { player, camera } = playerFixture();
    player.hitFlash = 0.5;
    let elapsed = 0;
    while (elapsed < 0.25 - 1e-10) {
      const dt = Math.min(1 / fps, 0.25 - elapsed);
      player.render(1, camera, true, dt);
      elapsed += dt;
    }
    close(player.hitFlash, 0.25, `${fps} fps half-life`);
    for (let i = 0; i < 20; i++) player.hudState({ presentation: true });
    player.render(1, camera, true, 0);
    close(player.hitFlash, 0.25, 'redraw/paused lifetime');
    player.render(1, camera, true, 0.25);
    close(player.hitFlash, 0, 'elapsed half second');
  }
});

test('damage feedback uses the presentation clock independently of simulation speed', () => {
  for (const timescale of [0, .25, 1, 4]) {
    const { player, camera } = playerFixture();
    player.hitFlash = .5;
    player.render(1, camera, true, .25 * timescale, .25);
    close(player.hitFlash, .25, `${timescale}x simulation`);
  }
});

function banditFixture() {
  // Skip asset construction; exercise the production render path and its
  // real Three transforms. Empty GPU mesh sinks only record upload intent.
  const mesh = () => ({ count: 0, instanceMatrix: {}, setMatrixAt() {} });
  const model = new THREE.Group();
  model.userData.aircraft = { maxDimension: 12 };
  const bandits = Object.assign(Object.create(Bandits.prototype), {
    state: new Float64Array(MAX_BANDITS * SLOTS_B), _prev: new Float64Array(MAX_BANDITS * SLOTS_B),
    live: new Uint8Array(MAX_BANDITS), kind: new Uint8Array(MAX_BANDITS), aceId: new Int32Array(MAX_BANDITS).fill(-1),
    _turn: new Float64Array(MAX_BANDITS), _visualFrame: {}, _renderAlpha: 1,
    groups: [new THREE.Group()], _variants: [[model]], mLive: [], brLive: [],
    mslMesh: mesh(), brMesh: mesh(), mslTrail: mesh(), smokeMesh: mesh(),
    mslPuffs: [{ x: 0, y: 0, z: 0, age: 0 }], smokePuffs: [{ x: 0, y: 0, z: 0, age: 0 }],
    _m4: new THREE.Matrix4(), _q: new THREE.Quaternion(), _dir: new THREE.Vector3(), _sc: new THREE.Vector3(),
  });
  bandits.live[0] = 1;
  bandits.state.set([80, 120, 2000, 200, 0, 0, 60]);
  bandits._prev.set([40, 100, 1900, 200, 0, 0, 60]);
  return { bandits, camera: new THREE.PerspectiveCamera() };
}

test('air marker positions match the displayed target without changing targeting state', () => {
  const { bandits, camera } = banditFixture();
  const state = [...bandits.state], previous = [...bandits._prev];
  const position = new Float64Array(3);
  for (const alpha of [0, 0.25, 0.5, 1]) {
    bandits.render(alpha, camera, 720, 0);
    bandits.renderPosition(0, position);
    const shown = bandits.groups[0].position;
    assert.deepEqual([...position], [shown.x, shown.z, shown.y]);
  }
  assert.deepEqual([...bandits.state], state);
  assert.deepEqual([...bandits._prev], previous);
});

test('bandit smoke and missile puffs use elapsed time at 30, 60 and 144 fps', () => {
  for (const fps of [30, 60, 144]) {
    const { bandits, camera } = banditFixture();
    for (let frame = 0; frame < fps; frame++) bandits.render(1, camera, 720, 1 / fps);
    close(bandits.mslPuffs[0].age, 1, `${fps} fps missile trail`);
    close(bandits.smokePuffs[0].age, 1, `${fps} fps ace smoke`);
    bandits.render(1, camera, 720, 0);
    close(bandits.smokePuffs[0].age, 1, 'zero-time frame');
  }
});

function coachFixture() {
  const readout = { writes: 0, set innerHTML(value) { this.writes++; this.value = value; } };
  const nodes = { '[data-coach-readout]': readout, '[data-coach-feedback]': {}, '[data-coach-seconds]': {}, progress: {} };
  const classes = new Map();
  const coach = Object.assign(Object.create(FlightCoach.prototype), {
    course: new TrainingCourse({ storage: null }), state: {}, visible: true, paused: false, paintElapsed: 0,
    progressEl: nodes.progress,
    el: { querySelector: selector => nodes[selector], classList: { toggle: (name, value) => classes.set(name, value) } },
    refreshes: [], refresh() { this.refreshes.push(this.course.snapshot()); },
  });
  const telemetry = { heading: 90, altFt: 11000, pitch: 0, roll: 0, speedKt: 380, throttle: 80, aglFt: 2000 };
  return { coach, readout, nodes, classes, telemetry };
}

test('coach acknowledges target entry and exit immediately while retaining numeric readout nodes', () => {
  const { coach, readout, nodes, classes, telemetry } = coachFixture();
  coach.update(1 / 120, { ...telemetry, roll: 30 });
  assert.equal(readout.writes, 1, 'first valid sample initializes the readout');
  coach.update(1 / 120, telemetry);
  assert.equal(classes.get('on-target'), true);
  assert.equal(nodes['[data-coach-feedback]'].textContent, 'On target. Hold steady');
  assert.equal(readout.writes, 1, 'numeric content is retained between scheduled refreshes');
  coach.update(1 / 120, { ...telemetry, roll: 30 });
  assert.equal(classes.get('on-target'), false);
  assert.match(nodes['[data-coach-feedback]'].textContent, /Ease the bank/);
  assert.equal(readout.writes, 1);
  coach.update(0.25, telemetry);
  assert.equal(readout.writes, 2);
});

test('lesson success refreshes immediately and paused telemetry earns no progress or redraws', () => {
  const { coach, readout, telemetry } = coachFixture();
  coach.course.anchor(telemetry);
  coach.course.held = 4 - 1 / 120;
  assert.equal(coach.update(1 / 120, telemetry), true);
  assert.equal(coach.refreshes.length, 1);
  assert.equal(coach.refreshes[0].id, 'throttle');
  coach.state.paused = true;
  const held = coach.course.held;
  coach.update(0.25, { ...telemetry, throttle: 65 });
  assert.equal(coach.course.held, held);
  assert.equal(readout.writes, 0);
});

test('coach progress advances between numeric updates and freezes while paused or hidden', () => {
  const { coach, readout, nodes, telemetry } = coachFixture();
  coach.update(1 / 120, telemetry);
  const first = nodes.progress.value;
  coach.update(1 / 120, telemetry);
  close(nodes.progress.value, first + 1 / 120, 'next-frame progress');
  assert.equal(readout.writes, 1, 'numeric telemetry remains throttled');
  const shown = nodes.progress.value;
  for (const pause of ['paused', 'state']) {
    coach.paused = pause === 'paused';
    coach.state.paused = pause === 'state';
    coach.update(0.1, telemetry);
    close(nodes.progress.value, shown, 'paused progress');
  }
  coach.paused = coach.state.paused = false;
  coach.visible = false;
  coach.update(1 / 120, telemetry);
  close(nodes.progress.value, shown, 'hidden progress avoids DOM work');
  coach.visible = true;
  coach.update(1 / 120, telemetry);
  close(nodes.progress.value, coach.course.held, 'visible progress catches up');
});

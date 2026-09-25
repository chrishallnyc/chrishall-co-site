// Render-only trail/camera regressions, using the real pinned Three math
// and effect objects without a renderer or GPU.
// Run: node --test raptor/qa/flight-presentation.test.mjs
import './register-three.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { FlightFX } = await import('../src/game/flightfx.js');
const { Player } = await import('../src/game/player.js');

globalThis.document = {
  createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }),
};

const highG = { nz: 5, alphaDeg: 20, mach: 0.8 };
const level = { nz: 1, alphaDeg: 3, mach: 0.8 };

function effectFixture() {
  const scene = new THREE.Scene(), jet = new THREE.Group(), rig = new THREE.Group();
  const nozzleL = new THREE.Group(), nozzleR = new THREE.Group();
  rig.add(nozzleL, nozzleR); jet.add(rig); scene.add(jet);
  const fx = new FlightFX(scene, { jetGroup: jet, parts: { nozzleL, nozzleR } });
  const camera = new THREE.PerspectiveCamera();
  fx.update(highG, 0, 0, camera);
  return { fx, jet, camera };
}

function snapshot(fx) {
  return fx._vortPool.order.map((index) => ({ ...fx._vortPool.items[index] }));
}

function close(a, b, message, tolerance = 1e-8) {
  assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);
}

function runTrail(intervals, seconds = 1) {
  const { fx, jet, camera } = effectFixture();
  let time = 0, frame = 0;
  while (time < seconds - 1e-10) {
    const dt = Math.min(intervals[frame++ % intervals.length], seconds - time);
    time += dt;
    jet.position.x = time * 200;
    fx.update(highG, 0, dt, camera);
  }
  return snapshot(fx);
}

test('vortex density, spacing, and age match across 30, 60, and 144 fps', () => {
  const reference = runTrail([1 / 60]);
  assert.equal(reference.length, 222, '111 emission pairs over one second');
  for (const intervals of [[1 / 30], [1 / 144], [1 / 144, 1 / 30, 1 / 60, 1 / 120]]) {
    const actual = runTrail(intervals);
    assert.equal(actual.length, reference.length);
    actual.forEach((p, i) => {
      for (const key of ['x', 'y', 'z', 'age']) close(p[key], reference[i][key], `particle ${i} ${key}`);
    });
  }
  for (let i = 2; i < reference.length; i += 2) {
    close(reference[i].x - reference[i - 2].x, 1.8, '200 m/s × 9 ms sample spacing');
  }
});

test('long frames restart at the tip without a particle burst or a bridged segment', () => {
  const { fx, jet, camera } = effectFixture();
  jet.position.x = 200;
  fx.update(highG, 0, 1, camera);
  const particles = snapshot(fx);
  assert.equal(particles.length, 2);
  close(particles[0].x, fx._pTipL.x, 'left current tip');
  close(particles[1].x, fx._pTipR.x, 'right current tip');
  assert.equal(particles[0].age, 0);
  jet.position.x += 20;
  fx.update(highG, 0, 0.1, camera);
  assert.ok(fx._vortPool.liveCount <= 26, 'at most 12 new pairs per frame');
});

test('nearby pose cuts clear old trails and never interpolate across a respawn', () => {
  const { fx, jet, camera } = effectFixture();
  jet.position.x = 10;
  fx.update(highG, 0, 0.05, camera);
  assert.equal(fx._vortPool.liveCount, 10);
  jet.position.x += 5; // deliberately below the fallback distance threshold
  fx.update(highG, 0, 1 / 60, camera, 1);
  const particles = snapshot(fx);
  assert.equal(particles.length, 2);
  close(particles[0].x, fx._pTipL.x, 'new left tip');
  close(particles[1].x, fx._pTipR.x, 'new right tip');
  assert.ok(particles.every((p) => p.age === 0));
});

test('unannounced large teleports also discard trail history', () => {
  const { fx, jet, camera } = effectFixture();
  jet.position.x = 10;
  fx.update(highG, 0, 0.05, camera);
  jet.position.x = 4000;
  fx.update(highG, 0, 1 / 60, camera);
  assert.equal(fx._vortPool.liveCount, 2);
  assert.ok(snapshot(fx).every((p) => p.x > 3900));
});

test('zero elapsed time leaves particles unchanged and gate changes do not bridge gaps', () => {
  const { fx, jet, camera } = effectFixture();
  jet.position.x = 10;
  fx.update(highG, 0, 0.05, camera);
  const before = snapshot(fx);
  fx.update(highG, 0, 0, camera);
  assert.deepEqual(snapshot(fx), before);
  jet.position.x = 20;
  fx.update(level, 0, 0.05, camera);
  jet.position.x = 30;
  fx.update(highG, 0, 0.05, camera);
  const fresh = snapshot(fx).filter((p) => p.age === 0);
  assert.equal(fresh.length, 2);
  close(fresh[0].x, fx._pTipL.x, 'reactivated left tip');
  close(fresh[1].x, fx._pTipR.x, 'reactivated right tip');
});

test('sustained condensation stays inside the existing 320-particle allocation', () => {
  const particles = runTrail([1 / 30], 10);
  assert.ok(particles.length >= 264 && particles.length <= 268);
  assert.ok(particles.every((p) => p.age <= 1.2));
});

function playerFixture() {
  const jet = new THREE.Group();
  const player = new Player(new THREE.Scene(), {
    jet, spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 },
  });
  player.gun.render = player.missiles.render = () => {};
  player.fm.setAttitude(0, 0, 0);
  player._prev.set(player.fm.state);
  const camera = new THREE.PerspectiveCamera();
  player.render(1, camera, false, 1 / 60);
  return { player, camera, jet };
}

test('horizon easing has the same elapsed-time response at 30 and 144 fps', () => {
  const run = (fps) => {
    const { player, camera } = playerFixture();
    player.fm.setAttitude(0.8, 0.2, 0.8);
    player._prev.set(player.fm.state);
    const simState = Array.from(player.fm.state);
    let elapsed = 0;
    while (elapsed < 0.1 - 1e-10) {
      const dt = Math.min(1 / fps, 0.1 - elapsed);
      player.render(1, camera, false, dt);
      elapsed += dt;
    }
    assert.deepEqual(Array.from(player.fm.state), simState);
    const target = player._camUpTarget.clone().normalize();
    assert.ok(camera.up.angleTo(target) > 0.001, 'horizon follows through a short easing interval');
    assert.ok(camera.up.angleTo(target) < new THREE.Vector3(0, 1, 0).angleTo(target));
    return camera.up;
  };
  close(run(30).distanceTo(run(144)), 0, 'camera up after 100 ms');
});

test('horizon easing preserves the immediate forward aim and resets on a pose cut', () => {
  const { player, camera, jet } = playerFixture();
  player.fm.setAttitude(0.8, 0.2, 0.8);
  player._prev.set(player.fm.state);
  player.render(1, camera, false, 1 / 144);
  const target = player._renderForward.clone().multiplyScalar(120).add(jet.position);
  const desiredDirection = target.sub(camera.position).normalize();
  close(camera.getWorldDirection(new THREE.Vector3()).distanceTo(desiredDirection), 0, 'immediate look direction');
  const revision = player.renderPoseVersion;
  player.debugCommand({ pos: { x: 10, y: -6000, alt: 3400, headingDeg: 0, speed: 200 } });
  assert.equal(player.renderPoseVersion, revision + 1);
  player.render(1, camera, false, 1 / 144);
  close(camera.up.distanceTo(player._camUpTarget.clone().normalize()), 0, 'cut initializes camera up');
  player.recoverFlight();
  assert.equal(player.renderPoseVersion, revision + 2);
});

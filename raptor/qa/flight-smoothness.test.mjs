// Pure render regressions: the vendored Three math is real; only procedural
// sprite painting is stubbed so these checks need no GPU or npm install.
// Run: node --test raptor/qa/flight-smoothness.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return {
      url: new URL('../vendor/three.core.min.js', import.meta.url).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});
const THREE = await import('../vendor/three.core.min.js');
const { Player } = await import('../src/game/player.js');
const { S } = await import('../src/sim/flight.js');
const { SimCore, DT } = await import('../src/engine/sim.js');

globalThis.document = {
  createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }),
};

function fixture() {
  const jet = new THREE.Group();
  const player = new Player(new THREE.Scene(), {
    jet, spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 },
  });
  const camera = new THREE.PerspectiveCamera();
  player.gun.render = () => {};
  player.missiles.render = () => {};
  player.fm.setAttitude(0, 0, 0);
  player._prev.set(player.fm.state);
  return { player, camera, jet };
}

function close(a, b, message, tolerance = 1e-8) {
  assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);
}

test('aircraft attitude interpolates on the same timeline as its position', () => {
  const { player, camera, jet } = fixture();
  player.fm.setAttitude(Math.PI / 2, 0, 0);
  player.render(0.25, camera, true, 1 / 144);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(jet.quaternion);
  close(forward.x, Math.cos(Math.PI / 8), 'interpolated east');
  close(forward.y, 0, 'interpolated altitude');
  close(forward.z, Math.sin(Math.PI / 8), 'interpolated north');
});

test('camera distance does not pump when frame intervals alternate', () => {
  const { player, camera, jet } = fixture();
  player.render(1, camera, false, 1 / 60);
  const initialOffset = camera.position.clone().sub(jet.position);
  for (let frame = 0; frame < 120; frame++) {
    const dt = [1 / 144, 1 / 30, 1 / 60, 1 / 120][frame % 4];
    player.fm.state[S.PX] += 220 * dt;
    player._prev.set(player.fm.state);
    player.render(1, camera, false, dt);
    const offset = camera.position.clone().sub(jet.position);
    close(offset.distanceTo(initialOffset), 0, 'aircraft-relative camera offset');
  }
});

test('camera bank response has the same time constant at 30 and 144 fps', () => {
  const run = (fps) => {
    const { player, camera, jet } = fixture();
    player.render(1, camera, false, 1 / 60);
    player.fm.setAttitude(0.8, 0.2, 0.4);
    player._prev.set(player.fm.state);
    for (let i = 0; i < fps / 2; i++) player.render(1, camera, false, 1 / fps);
    return camera.position.clone().sub(jet.position);
  };
  close(run(30).distanceTo(run(144)), 0, 'half-second response', 1e-7);
});

test('respawn never interpolates a flight path from the crash to the spawn', () => {
  const { player, camera, jet } = fixture();
  player.fm.state[S.PX] = 8000;
  player.fm.state[S.PZ] = 40;
  player._prev.set(player.fm.state);
  player.reset();
  player.render(0.1, camera, true, 1 / 60);
  close(jet.position.x, player.spawn.x, 'spawn east');
  close(jet.position.y, player.spawn.alt, 'spawn altitude');
  close(jet.position.z, player.spawn.y, 'spawn north');
});

test('weapon visuals age by elapsed simulation time and freeze when paused', () => {
  const { player, camera } = fixture();
  const elapsed = [];
  player.gun.render = (dt) => elapsed.push(dt);
  player.missiles.render = (dt) => elapsed.push(dt);
  player.render(1, camera, true, 0.025);
  player.render(1, camera, true, 0);
  assert.deepEqual(elapsed, [0.025, 0.025, 0, 0]);
});

test('rendering leaves deterministic flight state untouched', () => {
  const { player, camera } = fixture();
  player.fm.setAttitude(0.8, 0.2, 0.4);
  const state = Array.from(player.fm.state);
  for (const alpha of [0, 0.3, 0.75, 1]) player.render(alpha, camera, false, 1 / 90);
  assert.deepEqual(Array.from(player.fm.state), state);
});

test('recenter aligns aim to the aircraft and clears queued mouse movement', () => {
  const { player } = fixture();
  player.fm.setAttitude(0.65, 0.3, 0.2);
  player.aimHeading = -2;
  player.aimPitch = -0.4;
  player._mouseDx = 900;
  player._mouseDy = -300;
  const state = Array.from(player.fm.state);
  player.recenterAim();
  close(player.aimHeading, 0.65, 'recentered heading');
  close(player.aimPitch, 0.3, 'recentered pitch');
  assert.equal(player._mouseDx, 0);
  assert.equal(player._mouseDy, 0);
  assert.deepEqual(Array.from(player.fm.state), state);
});

test('changing the cannon binding cannot leave a hidden legacy fire key active', () => {
  const { player } = fixture();
  const input = {
    mouse: { dx: 0, dy: 0 }, wheelDelta: () => 0, pressed: () => false,
    held: (action) => action === 'fire_cannons',
  };
  player.feedInput(input);
  assert.equal(player._live.fire, 0);
  input.held = (action) => action === 'fire_mguns';
  player.feedInput(input);
  assert.equal(player._live.fire, 1);
});

test('gamepad stick input preserves proportional roll and throttle authority', () => {
  const { player } = fixture();
  const input = {
    mouse: { dx: 0, dy: 0 }, wheelDelta: () => 0, pressed: () => false,
    held: () => false, axis: (name) => name === 'roll' ? -0.3 : 0.6,
  };
  player.feedInput(input);
  close(player._live.rollL, 0.3, 'left stick fraction');
  close(player._live.rollR, 0, 'no right roll');
  close(player._live.thrUp, 0.6, 'throttle fraction');
  close(player._live.thrDn, 0, 'no throttle decrease');
  input.held = (name) => name === 'roll_left' || name === 'throttle_up';
  player.feedInput(input);
  assert.equal(player._live.rollL, 1);
  assert.equal(player._live.thrUp, 1);
});

test('pausing before the next fixed tick discards queued weapons, gear, and mouse input', () => {
  const { player } = fixture();
  const sim = new SimCore(1);
  sim.addSystem(player);
  const missileRequests = [], gunRequests = [];
  player.missiles.tick = (_sim, _dt, _fm, _battlefield, fire) => missileRequests.push(fire);
  player.gun.tick = (_sim, _dt, _fm, fire) => gunRequests.push(fire);
  player.aimHeading = 0.3;
  player.aimPitch = 0.1;
  player.feedInput({
    mouse: { dx: 20, dy: -10 }, wheelDelta: () => 1,
    held: (name) => name === 'fire_mguns' || name === 'roll_left' || name === 'throttle_up',
    pressed: (name) => name === 'gear' || name === 'fire_aam',
  });
  sim.advance(DT / 4);
  assert.equal(sim.tickCount, 0);
  const throttle = player.throttleCmd;
  player.clearInput();
  sim.advance(DT);
  assert.equal(sim.tickCount, 1);
  assert.deepEqual(missileRequests, [false]);
  assert.deepEqual(gunRequests, [false]);
  assert.equal(player.gearDown, false);
  assert.equal(player.aimHeading, 0.3);
  assert.equal(player.aimPitch, 0.1);
  assert.equal(player.throttleCmd, throttle);
});

test('airborne HUD reports real speed and Mach before the first simulation tick', () => {
  const { player } = fixture();
  assert.equal(player.fm.out.V, 0); // derived physics outputs have not run yet
  const before = Array.from(player.fm.state);
  const hud = player.hudState();
  close(hud.speedKt, player.spawn.speed * 1.94384, 'initial airspeed');
  const soundSpeed = Math.sqrt(1.4 * 287.053 * (288.15 - 0.0065 * player.spawn.alt));
  close(hud.mach, player.spawn.speed / soundSpeed, 'initial Mach');
  assert.deepEqual(Array.from(player.fm.state), before);
});

test('HUD reads current velocity through respawn and true zero-speed states', () => {
  const { player } = fixture();
  player.fm.out.V = 500;
  player.fm.out.mach = 1.6;
  player.reset();
  close(player.hudState().speedKt, player.spawn.speed * 1.94384, 'respawn airspeed');
  player.fm.state[S.VX] = player.fm.state[S.VY] = player.fm.state[S.VZ] = 0;
  assert.equal(player.hudState().speedKt, 0);
  assert.equal(player.hudState().mach, 0);
  player.fm.state[S.VX] = 300;
  player.fm.state[S.VY] = 400;
  close(player.hudState().speedKt, 500 * 1.94384, 'current velocity magnitude');
});

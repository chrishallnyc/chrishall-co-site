// Exercise the public player input through the real 120 Hz flight model.
// Renderer math is real; only the procedural sprite canvas is stubbed.
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
const { SimCore } = await import('../src/engine/sim.js');

globalThis.document = {
  createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }),
};

function fixture() {
  const player = new Player(new THREE.Scene(), {
    jet: new THREE.Group(),
    spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 },
  });
  const sim = new SimCore(1);
  sim.addSystem(player);
  return { player, sim };
}

function input({ dx = 0, dy = 0, held = [], pressed = [] } = {}) {
  return {
    mouse: { dx, dy }, held: (action) => held.includes(action),
    pressed: (action) => pressed.includes(action), wheelDelta: () => 0,
  };
}

function fly(player, sim, seconds, controls = {}) {
  player.feedInput(input(controls));
  for (let i = 0; i < Math.round(seconds * 120); i++) sim.tick();
}

const radians = (degrees) => degrees * Math.PI / 180;
const close = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) < tolerance,
  `${message}: expected ${expected}, got ${actual}`,
);

test('horizontal pointer travel turns the aircraft toward the aim point in both directions', () => {
  for (const dx of [-100, 100]) {
    const { player, sim } = fixture();
    fly(player, sim, 8, { dx });
    const expectedHeading = 90 + dx * 0.0028 * 180 / Math.PI;
    close(player.hudState().heading, expectedHeading, 0.3, 'pointer-commanded heading');
    assert.equal(player.crashes, 0);
    assert.ok(player.hudState().speedKt > 300);
    assert.ok(Math.abs(player.hudState().roll) < 2, 'wings level as the turn finishes');
  }
});

test('vertical pointer aim holds the requested flight path instead of continuously pulling G', () => {
  for (const dy of [-100, 100]) {
    const { player, sim } = fixture();
    fly(player, sim, 8, { dy });
    const st = player.fm.state;
    const flightPath = Math.atan2(st[S.VZ], Math.hypot(st[S.VX], st[S.VY]));
    close(flightPath, -dy * 0.0028, radians(1), 'commanded climb / descent angle');
    assert.ok(Math.abs(player.hudState().pitch) < 25, 'small aim movement cannot sustain a runaway pitch command');
    assert.equal(player.crashes, 0);
  }
});

test('a stationary pointer maintains heading and altitude without hidden steering input', () => {
  const { player, sim } = fixture();
  fly(player, sim, 20);
  close(player.hudState().heading, 90, 0.01, 'initial heading');
  close(player.fm.state[S.PZ], player.spawn.alt, 10, 'level-flight altitude');
  assert.equal(player.crashes, 0);
  assert.ok(player.hudState().speedKt > 300);
});

test('manual bank and keyboard pitch remain available with the mouse instructor', () => {
  for (const [action, sign] of [['roll_left', -1], ['roll_right', 1]]) {
    const { player, sim } = fixture();
    fly(player, sim, 0.4, { held: [action] });
    assert.ok(player.hudState().roll * sign > 8, action);
  }
  for (const [action, sign] of [['pitch_up', 1], ['pitch_down', -1]]) {
    const { player, sim } = fixture();
    fly(player, sim, 0.35, { held: [action] });
    assert.ok(player.aimPitch * sign > radians(15), action);
    fly(player, sim, 8);
    assert.ok(player.hudState().pitch * sign > 10, `${action} changes actual flight`);
  }
});

test('keyboard and pointer pitch share the same hard limit at both extremes', () => {
  for (const [action, dy, sign] of [['pitch_up', -2000, 1], ['pitch_down', 2000, -1]]) {
    const { player, sim } = fixture();
    fly(player, sim, 0.25, { dy, held: [action] });
    close(player.aimPitch, radians(80) * sign, 1e-12, 'final clamped aim');
  }
});

test('practice recovery restores controllable flight and discards queued actions without refilling weapons', () => {
  const { player, sim } = fixture();
  player.debugCommand({ pos: { x: 6000, y: 2000, alt: 20, speed: 50 }, throttle: 0 });
  player.fm.setAttitude(2, -0.5, 2.4);
  player.hp = 12;
  player.crashes = 3;
  player.gearDown = true;
  player.gun.ammo = 37;
  player.missiles.ammo = 1;
  player.feedInput(input({ dx: 1000, dy: 1000, held: ['fire_mguns', 'throttle_down'], pressed: ['gear', 'fire_aam'] }));
  const tickCount = sim.tickCount;
  player.recoverFlight();
  assert.equal(sim.tickCount, tickCount, 'recovery does not advance the world');
  assert.equal(player.crashes, 3, 'recovery does not change combat statistics');
  assert.equal(player.gun.ammo, 37);
  assert.equal(player.missiles.ammo, 1);
  assert.equal(player.hp, 100);
  assert.equal(player.throttleCmd, 0.8);
  assert.equal(player.gearDown, false);
  assert.equal(player.fm.state[S.GEAR], 0);
  assert.equal(player.aimPitch, 0);
  assert.equal(player.aimHeading, player.spawn.headingRad);
  assert.deepEqual(Array.from(player._prev), Array.from(player.fm.state));
  assert.equal(player._cameraReady, false);
  assert.ok(Object.values(player._live).every((value) => value === 0));
  sim.tick();
  assert.equal(player.throttleCmd, 0.8);
  assert.equal(player.gearDown, false);
  assert.equal(player.gun.ammo, 37, 'a held cannon cannot fire after recovery');
  assert.equal(player.missiles.ammo, 1);
  assert.equal(player.aimPitch, 0);
  assert.equal(player.aimHeading, player.spawn.headingRad);
});

test('terrain crash respawns with flight-ready throttle, retracted gear, and no held weapon input', () => {
  const { player, sim } = fixture();
  player.debugCommand({ pos: { x: 6000, y: 2000, alt: 0.5, speed: 40 }, throttle: 0 });
  player.feedInput(input({ held: ['throttle_down'], pressed: ['fire_aam'] }));
  sim.tick();
  assert.equal(player.crashes, 1);
  assert.equal(player.throttleCmd, 0.8);
  assert.equal(player.gearDown, false);
  assert.ok(Object.values(player._live).every((value) => value === 0));
  assert.equal(player.fm.state[S.PZ], player.spawn.alt);
});

test('bank readout distinguishes inverted attitudes from upright shallow banks', () => {
  const { player } = fixture();
  for (const roll of [-175, -120, -45, 0, 45, 120, 175]) {
    player.fm.setAttitude(0.7, 0.25, radians(roll));
    close(player.hudState().roll, roll, 1e-8, 'full-circle bank');
  }
});

test('keyboard rudder turns establish a new heading that stays after releasing the key', () => {
  for (const [action, sign] of [['yaw_left', -1], ['yaw_right', 1]]) {
    const { player, sim } = fixture();
    fly(player, sim, 4, { held: [action] });
    const newHeading = player.hudState().heading;
    assert.ok((newHeading - 90) * sign > 45, 'keyboard can make a substantial turn');
    fly(player, sim, 12);
    close(player.hudState().heading, newHeading, 0.3, 'released course is retained');
    assert.ok(Math.abs(player.hudState().roll) < 2, 'aircraft levels after release');
    assert.equal(player.crashes, 0);
  }
});

test('manual bank establishes its resulting heading without changing a keyboard pitch target', () => {
  for (const action of ['roll_left', 'roll_right']) {
    const { player, sim } = fixture();
    fly(player, sim, 0.2, { held: ['pitch_up'] });
    const pitch = player.aimPitch;
    fly(player, sim, 2, { held: [action] });
    const heading = player.hudState().heading;
    fly(player, sim, 12);
    close(player.hudState().heading, heading, 0.3, 'post-bank course');
    assert.equal(player.aimPitch, pitch, 'manual turn must not erase the commanded climb');
  }
});

test('simultaneous pointer aim and manual roll preserve the pointer target through release', () => {
  for (const action of ['roll_left', 'roll_right']) {
    const { player, sim } = fixture();
    fly(player, sim, 0.5, { held: [action], dx: 100, dy: -20 });
    const heading = player.aimHeading, pitch = player.aimPitch;
    fly(player, sim, 0.5, { held: [action] });
    assert.equal(player.aimHeading, heading, 'target persists between pointer strokes');
    fly(player, sim, 12);
    assert.equal(player.aimHeading, heading, 'release cannot overwrite pointer aim');
    assert.equal(player.aimPitch, pitch);
    close(player.hudState().heading, 90 - heading * 180 / Math.PI, 0.3, 'pointer destination');
  }
});

test('pointer motion arriving during a manual turn or on its release takes precedence', () => {
  for (const release of [false, true]) {
    const { player, sim } = fixture();
    fly(player, sim, 0.5, { held: ['yaw_right'] });
    const prior = player.aimHeading;
    fly(player, sim, 0.1, { held: release ? [] : ['yaw_right'], dx: -80 });
    const target = prior + 80 * 0.0028;
    close(player.aimHeading, target, 1e-12, 'new pointer heading');
    fly(player, sim, 12);
    close(player.aimHeading, target, 1e-12, 'new pointer heading survives release');
  }
});

test('recenter uses the existing flight path without changing attitude, throttle, or queued pitch keys', () => {
  const { player } = fixture();
  player.fm.setAttitude(0.65, 0.3, 0.2);
  player.fm.state[S.VX] = 160;
  player.fm.state[S.VY] = 80;
  player.fm.state[S.VZ] = -20;
  player.feedInput(input({ dx: 900, dy: -300, held: ['pitch_down'] }));
  const before = Array.from(player.fm.state);
  player.recenterAim();
  close(player.aimHeading, Math.atan2(80, 160), 1e-12, 'velocity heading');
  close(player.aimPitch, Math.atan2(-20, Math.hypot(160, 80)), 1e-12, 'velocity pitch');
  assert.deepEqual(Array.from(player.fm.state), before);
  assert.equal(player.throttleCmd, 0.8);
  assert.equal(player._mouseDx, 0);
  assert.equal(player._mouseDy, 0);
  assert.equal(player._live.pitchDn, 1, 'an explicit pitch key remains effective');
});

test('recenter falls back to attitude at very low speed and remains finite in a vertical descent', () => {
  const { player } = fixture();
  player.fm.setAttitude(0.65, 0.3, 0.2);
  player.fm.state[S.VX] = player.fm.state[S.VY] = player.fm.state[S.VZ] = 0;
  player.recenterAim();
  close(player.aimHeading, 0.65, 1e-12, 'stationary nose heading');
  close(player.aimPitch, 0.3, 1e-12, 'stationary nose pitch');
  player.fm.state[S.VZ] = -50;
  player.recenterAim();
  close(player.aimHeading, 0.65, 1e-12, 'vertical flight has no horizontal course');
  close(player.aimPitch, radians(-80), 1e-12, 'vertical pitch uses safe limit');
});

test('repeated recenters do not ratchet level flight into an angle-of-attack climb', () => {
  const { player, sim } = fixture();
  fly(player, sim, 10);
  const altitude = player.fm.state[S.PZ];
  for (let i = 0; i < 5; i++) {
    player.recenterAim();
    fly(player, sim, 20);
  }
  close(player.fm.state[S.PZ], altitude, 80, '100-second altitude drift');
  assert.ok(Math.abs(player.aimPitch) < radians(0.3), 'recenter must not accumulate nose alpha');
  assert.equal(player.crashes, 0);
});

test('recovering a slow inverted aircraft remains stable through a twenty-second flight', () => {
  for (const speed of [30, 60, 100]) {
    const { player, sim } = fixture();
    player.debugCommand({ pos: { x: 0, y: 0, alt: 900, speed }, throttle: 0 });
    player.fm.setAttitude(2, -0.7, 2.3);
    fly(player, sim, 5);
    player.recoverFlight();
    fly(player, sim, 20);
    assert.ok(Array.from(player.fm.state).every(Number.isFinite));
    close(player.fm.state[S.PZ], player.spawn.alt, 10, 'recovered flight altitude');
    close(player.hudState().heading, 90, 0.1, 'recovered flight heading');
    assert.ok(player.hudState().speedKt > 300);
    assert.equal(player.crashes, 0);
  }
});

test('pointer and keyboard flight retain consistent authority at 16, 30, 60, and 120 fps', () => {
  const endings = [];
  for (const fps of [16, 30, 60, 120]) {
    const { player, sim } = fixture();
    for (let i = 0; i < fps * 30; i++) {
      const elapsed = i / fps;
      player.feedInput(input({
        held: elapsed < 1 ? ['throttle_up'] : [],
        dx: elapsed < 2 ? 20 / fps : 0,
        dy: elapsed < 2 ? -3 / fps : 0,
      }));
      sim.advance(1 / fps);
    }
    assert.equal(sim.tickCount, 3600);
    assert.equal(player.crashes, 0);
    endings.push({ position: Array.from(player.fm.state).slice(0, 3), hud: player.hudState() });
  }
  for (const ending of endings.slice(1)) {
    close(ending.hud.heading, endings[0].hud.heading, 1e-7, 'cadence-independent heading');
    close(ending.hud.pitch, endings[0].hud.pitch, 0.001, 'cadence-independent pitch');
    assert.ok(Math.hypot(...ending.position.map((v, i) => v - endings[0].position[i])) < 1,
      'input sampling varies the 30-second trajectory by less than one metre');
  }
});

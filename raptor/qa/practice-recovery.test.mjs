// Exercise recovery/configuration advice against the actual 120 Hz aircraft.
// Only the weapons' procedural sprite canvas is stubbed; no renderer is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { practiceGuidance, practiceGearGuidance } from '../src/game/practiceguidance.js';

async function withPlayer(run) {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'three' ? { url: new URL('../vendor/three.core.min.js', import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context);
  } });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
  try {
    const THREE = await import('../vendor/three.core.min.js');
    const { Player } = await import('../src/game/player.js');
    const { SimCore, DT } = await import('../src/engine/sim.js');
    const player = new Player(new THREE.Scene(), { jet: new THREE.Group(), spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 } });
    const sim = new SimCore(1); sim.addSystem(player);
    const held = new Set(), pressed = new Set();
    const input = { mouse: { dx: 0, dy: 0 }, held: id => held.has(id), pressed: id => pressed.has(id), wheelDelta: () => 0 };
    const tick = () => { player.feedInput(input); sim.tick(); pressed.clear(); };
    const telemetry = () => ({ ...player.hudState(), aglFt: player.fm.out.agl * 3.28084 });
    await run({ player, sim, input, held, pressed, tick, telemetry, DT });
  } finally {
    hooks.deregister();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
}

test('an excessive climb can be recovered using the advised controls without teleporting or changing the physics', async context => {
  await withPlayer(({ player, sim, input, held, tick, telemetry, DT }) => {
    held.add('pitch_up');
    let warning;
    for (let frame = 0; frame < 40 / DT; frame++) {
      tick();
      if (practiceGuidance(telemetry()).id === 'high-alpha') { warning = telemetry(); break; }
    }
    assert.ok(warning, 'a sustained excessive climb produces measured high angle of attack');
    const warnedAt = sim.time;
    held.delete('pitch_up'); held.add('throttle_up');
    player.recenterAim(); // The same method as the live Center aim action.
    let unloadedAt, acceleratedAt;
    for (let frame = 0; frame < 30 / DT; frame++) {
      const current = telemetry();
      if (current.aoa < 20 && unloadedAt === undefined) unloadedAt = sim.time;
      if (current.speedKt >= 190 && acceleratedAt === undefined) acceleratedAt = sim.time;
      // After rebuilding speed, gently return the aim to the horizon.
      if (acceleratedAt !== undefined) {
        const rate = 2 * Math.PI / 180 * DT;
        input.mouse.dy = -Math.max(-rate, Math.min(rate, -player.aimPitch)) / .0028;
      }
      tick();
    }
    const recovered = telemetry();
    assert.ok(unloadedAt - warnedAt < 2, 'centering aim promptly unloads the aircraft');
    assert.ok(acceleratedAt - warnedAt < 5, 'adding power rebuilds usable airspeed');
    assert.equal(player.crashes, 0);
    assert.ok(recovered.aglFt > 900);
    assert.ok(recovered.aoa < 10);
    assert.ok(Math.abs(recovered.verticalSpeedFpm) < 300);
    assert.equal(practiceGuidance(recovered).id, 'steady');
    context.diagnostic(`Recovery cue at ${warnedAt.toFixed(1)} s; angle of attack below 20° in ${(unloadedAt - warnedAt).toFixed(1)} s; above 190 kt in ${(acceleratedAt - warnedAt).toFixed(1)} s; no reset or crash.`);
  });
});

test('gear hints follow real actuator travel and disappear after complete retraction or practice reset', async () => {
  await withPlayer(({ player, pressed, tick, telemetry, DT }) => {
    tick();
    assert.equal(practiceGearGuidance(telemetry()), null);
    pressed.add('gear'); tick();
    assert.equal(telemetry().gearDown, true);
    assert.ok(telemetry().gearPosition > 0 && telemetry().gearPosition < 1);
    assert.equal(practiceGearGuidance(telemetry()).id, 'gear-extending');
    for (let frame = 0; frame < 4 / DT; frame++) tick();
    assert.equal(telemetry().gearPosition, 1);
    assert.equal(practiceGearGuidance(telemetry()).id, 'gear-down');
    pressed.add('gear'); tick();
    assert.equal(telemetry().gearDown, false);
    assert.equal(practiceGearGuidance(telemetry()).id, 'gear-retracting');
    for (let frame = 0; frame < 4 / DT; frame++) tick();
    assert.equal(telemetry().gearPosition, 0);
    assert.equal(practiceGearGuidance(telemetry()), null);
    pressed.add('gear'); tick();
    assert.equal(practiceGearGuidance(telemetry()).id, 'gear-extending');
    player.recoverFlight();
    assert.equal(practiceGearGuidance(telemetry()), null, 'practice reset publishes actual retracted gear immediately');
    assert.equal(player.crashes, 0);
  });
});
